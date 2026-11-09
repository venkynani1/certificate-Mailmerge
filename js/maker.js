/*
 * Power Automate maker — personal emails for any occasion (credentials, links, reminders)
 * without building a new flow: participants sheet (+ optional details sheet) + common values +
 * an email with chips -> the same "Mail Merge" ZIP the imported flow already sends.
 */
(function () {
  "use strict";
  const { $, $$, store, toast, download, safeName, EMAIL_RE, writeMailKit, chips } = window.MMS;
  const { chipEditor, insertChip, toEditorHtml, fromEditor, escHtml, fillVars } = chips;

  const SNO = /^(s\.?\s*no\.?|sl\.?\s*no\.?|sr\.?\s*no\.?|serial(\s*(no\.?|number))?|no\.?|#|s\.?n\.?)$/i;
  const isEmpCol = (h) => /\b(emp(loyee)?|associate|staff)\s*(id|code|no\.?|number)\b/i.test(h) || /^(emp|empid|emp\.?\s*id|id)$/i.test(h.trim());
  const isMailCol = (h) => /e-?mail|mail\s*id/i.test(h);
  const isNameCol = (h) => /name/i.test(h) && !/user\s*name|username|login|file|event|team|course/i.test(h);

  const saved = store.get("maker", {});
  const state = {
    people: [],            // [{name, emp, email, src}]
    peopleFile: "",
    details: null,         // {file, fields:[..], key:"emp"|"email"|"name"|"order", rows:[{key, values:{}}]}
    common: saved.common || [{ label: "Portal link", value: "" }],
    idx: 0,
  };
  let lastEditor = "pkBody";

  // ---------- sheets ----------
  function readSheet(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => {
        try {
          const wb = XLSX.read(new Uint8Array(r.result), { type: "array" });
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false })
            .map((row) => row.map((c) => String(c == null ? "" : c).trim()));
          const hIdx = rows.findIndex((row) => row.filter(Boolean).length >= 1);
          if (hIdx < 0) throw new Error("The sheet is empty.");
          const raw = rows[hIdx];
          const body = rows.slice(hIdx + 1).filter((row) => row.some(Boolean));
          // keep real columns: has a header (not S.No) or has any data
          const cols = [];
          const seen = {};
          raw.forEach((h, i) => {
            let name = h || "";
            if (name && SNO.test(name)) return;
            if (!name && !body.some((row) => row[i])) return;
            if (!name) name = "Column " + (i + 1);
            const base = name; let n = 2;
            while (seen[name.toLowerCase()]) name = `${base} ${n++}`;
            seen[name.toLowerCase()] = true;
            cols.push({ name, i });
          });
          res({ cols, rows: body.map((row) => Object.fromEntries(cols.map((c) => [c.name, row[c.i] || ""]))) });
        } catch (e) { rej(e); }
      };
      r.onerror = () => rej(new Error("Couldn't read the file."));
      r.readAsArrayBuffer(file);
    });
  }
  const normEmp = (v) => String(v || "").replace(/\s+/g, "").replace(/\.0+$/, "");
  const normName = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  async function loadPeople(file) {
    try {
      const { cols, rows } = await readSheet(file);
      const nameC = cols.find((c) => isNameCol(c.name));
      const empC = cols.find((c) => isEmpCol(c.name));
      const mailC = cols.find((c) => isMailCol(c.name));
      if (!nameC && !empC && !mailC) throw new Error("Couldn't find Name / Emp ID / Email columns.");
      state.people = rows.map((r) => ({
        name: nameC ? r[nameC.name] : "",
        emp: empC ? normEmp(r[empC.name]) : "",
        rawMail: mailC ? r[mailC.name] : "",
      })).filter((p) => p.name || p.emp || p.rawMail);
      state.peopleFile = file.name;
      state.cols = { name: nameC && nameC.name, emp: empC && empC.name, mail: mailC && mailC.name };
      resolveEmails();
      state.idx = 0;
      refresh();
      toast(`Loaded ${state.people.length} participants`);
    } catch (e) { console.error(e); toast("Participants sheet: " + e.message, true); }
  }

  function resolveEmails() {
    const domain = ($("#pkDomain").value.trim().replace(/^@/, "") || "hexaware.com");
    state.people.forEach((p) => {
      const m = String(p.rawMail || "").match(EMAIL_RE);
      if (m) { p.email = m[0]; p.src = "sheet"; }
      else if (p.emp) { p.email = `${p.emp}@${domain}`; p.src = "emp id"; }
      else { p.email = ""; p.src = ""; }
    });
  }

  async function loadDetails(file) {
    try {
      const { cols, rows } = await readSheet(file);
      const empC = cols.find((c) => isEmpCol(c.name));
      const mailC = cols.find((c) => isMailCol(c.name));
      const nameC = cols.find((c) => isNameCol(c.name));
      const keyCols = [empC, mailC, nameC].filter(Boolean).map((c) => c.name);
      const fields = cols.map((c) => c.name).filter((n) => !keyCols.includes(n));
      if (!fields.length) throw new Error("No detail columns found (only Name / Emp ID / Email).");
      const key = empC ? "emp" : mailC ? "email" : nameC ? "name" : "order";
      const keyCol = empC || mailC || nameC;
      state.details = {
        file: file.name, fields, key,
        keyLabel: keyCol ? keyCol.name : "row order",
        rows: rows.map((r) => ({
          key: key === "emp" ? normEmp(r[keyCol.name]) : key === "email" ? String(r[keyCol.name]).toLowerCase() : key === "name" ? normName(r[keyCol.name]) : "",
          values: Object.fromEntries(fields.map((f) => [f, r[f]])),
        })),
      };
      refresh();
      toast(`Details loaded: ${fields.join(", ")}`);
    } catch (e) { console.error(e); toast("Details sheet: " + e.message, true); }
  }

  function detailsFor(p, i) {
    const d = state.details;
    if (!d) return {};
    let row;
    if (d.key === "order") row = d.rows[i];
    else if (d.key === "emp") row = d.rows.find((r) => r.key && r.key === p.emp);
    else if (d.key === "email") row = d.rows.find((r) => r.key && r.key === String(p.email).toLowerCase());
    else row = d.rows.find((r) => r.key && r.key === normName(p.name));
    return row ? row.values : null;
  }

  // ---------- variables & email ----------
  function commonVars() {
    return Object.fromEntries(state.common.filter((c) => c.label.trim()).map((c) => [c.label.trim(), c.value]));
  }
  function varsFor(p, i) {
    const det = detailsFor(p, i) || {};
    return Object.assign({ Name: p.name || "Participant", "Emp ID": p.emp, Email: p.email }, det, commonVars());
  }
  function labels() {
    const l = { Name: "Participant name", "Emp ID": "Emp ID", Email: "Email" };
    (state.details ? state.details.fields : []).forEach((f) => (l[f] = f));
    if (state.details) l.Details = "All details (table)";
    Object.keys(commonVars()).forEach((k) => (l[k] = k));
    return l;
  }

  const linkify = (html) => html.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1">$1</a>');
  function detailsTable(vars) {
    if (!state.details) return "";
    const th = 'style="background:#3b2fd9;color:#fff;text-align:left;padding:6px 10px;border:1px solid #444"';
    const td = 'style="padding:6px 10px;border:1px solid #444"';
    return '<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt;margin:6px 0">' +
      state.details.fields.map((f) => `<tr><th ${th}>${escHtml(f)}</th><td ${td}>${linkify(escHtml(vars[f] == null ? "" : vars[f]))}</td></tr>`).join("") + "</table>";
  }
  function build(p, vars) {
    const body = fromEditor($("#pkBody"));
    const html = body.split(/\{Details\}/i).map((chunk) => linkify(escHtml(fillVars(chunk, vars)).replace(/\r?\n/g, "<br>"))).join(detailsTable(vars));
    const greet = $("#pkGreet").checked ? `Dear ${escHtml(vars.Name || "Participant")},<br><br>` : "";
    return {
      subject: fillVars(fromEditor($("#pkSubject")).replace(/\{Details\}/gi, ""), vars).replace(/\s+/g, " ").trim(),
      html: '<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#222">' + greet + html + "</div>",
    };
  }
  function unknownVars() {
    const known = Object.keys(labels()).map((k) => k.toLowerCase());
    const text = fromEditor($("#pkSubject")) + "\n" + fromEditor($("#pkBody"));
    return Array.from(new Set((text.match(/\{([^{}\n]+)\}/g) || []).map((t) => t.slice(1, -1)).filter((v) => !known.includes(v.toLowerCase()))));
  }

  // ---------- UI ----------
  function renderCommon() {
    const box = $("#pkCommon");
    box.innerHTML = "";
    state.common.forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "common-row";
      row.innerHTML = `<input type="text" placeholder="Name, e.g. Portal link" /><input type="text" placeholder="Value, e.g. https://…" /><button title="Remove">✕</button>`;
      const [lab, val, del] = row.children;
      lab.value = c.label; val.value = c.value;
      lab.addEventListener("input", () => { c.label = lab.value; saveState(); renderChipButtons(); renderPreview(); });
      lab.addEventListener("change", () => refreshEditors());
      val.addEventListener("input", () => { c.value = val.value; saveState(); renderPreview(); });
      del.addEventListener("click", () => { state.common.splice(i, 1); saveState(); renderCommon(); refresh(); });
      box.appendChild(row);
    });
  }

  function renderChipButtons() {
    const box = $("#pkChipButtons");
    box.innerHTML = "";
    const add = (v, label, cls) => {
      const b = document.createElement("button");
      b.className = "btn ghost small ins-chip " + (cls || "");
      b.textContent = "+ " + label;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => { insertChip(lastEditor, v, labels()); $("#" + lastEditor).dispatchEvent(new Event("input")); });
      box.appendChild(b);
    };
    add("Name", "Participant name"); add("Emp ID", "Emp ID"); add("Email", "Email");
    if (state.details) { state.details.fields.forEach((f) => add(f, f, "k-col")); add("Details", "All details (table)", "k-col"); }
    Object.keys(commonVars()).forEach((k) => add(k, k, "k-common"));
  }

  // re-draw editors so new/renamed fields show as chips
  function refreshEditors() {
    ["pkSubject", "pkBody"].forEach((id) => {
      const el = $("#" + id);
      const text = fromEditor(el);
      el.innerHTML = toEditorHtml(text, labels());
    });
  }

  function renderStats() {
    const ps = $("#pkPeopleStats");
    if (!state.people.length) ps.innerHTML = "";
    else {
      const noMail = state.people.filter((p) => !p.email).length;
      const fromSheet = state.people.filter((p) => p.src === "sheet").length;
      ps.innerHTML = `<span class="ok">${state.people.length} participants</span> from ${escHtml(state.peopleFile)} · ${fromSheet} email from sheet, ${state.people.length - fromSheet - noMail} from Emp ID` +
        (noMail ? ` · <span class="warn">${noMail} without Emp ID or email (skipped)</span>` : "");
    }
    const ds = $("#pkDetailsStats");
    $("#pkDetailsClear").hidden = !state.details;
    if (!state.details) { ds.innerHTML = ""; return; }
    const d = state.details;
    const missing = state.people.filter((p, i) => !detailsFor(p, i)).length;
    ds.innerHTML = `<span class="ok">${d.rows.length} rows</span> from ${escHtml(d.file)} · columns: <b>${d.fields.map(escHtml).join(", ")}</b> · matched by <b>${escHtml(d.keyLabel)}</b>` +
      (state.people.length && missing ? ` · <span class="warn">${missing} participant(s) have no details row</span>` : "");
  }

  function renderTable() {
    const box = $("#pkTable");
    if (!state.people.length) { box.innerHTML = '<p class="muted small" style="padding:10px">Upload the participants sheet to see everyone here.</p>'; return; }
    const fields = state.details ? state.details.fields : [];
    const head = ["#", "Name", "Email", "Emp ID"].concat(fields);
    const rows = state.people.slice(0, 500).map((p, i) => {
      const det = detailsFor(p, i);
      const bad = !p.email || (state.details && !det);
      return `<tr class="${bad ? "bad" : ""}" data-i="${i}"><td>${i + 1}</td><td>${escHtml(p.name)}</td><td>${escHtml(p.email || "—")}<span class="src">${p.src}</span></td><td>${escHtml(p.emp)}</td>` +
        fields.map((f) => `<td>${det ? escHtml(det[f] || "") : '<span class="warn">no row</span>'}</td>`).join("") + "</tr>";
    }).join("");
    box.innerHTML = `<table><tr>${head.map((h) => `<th>${escHtml(h)}</th>`).join("")}</tr>${rows}</table>` +
      (state.people.length > 500 ? `<p class="muted small" style="padding:6px 10px">…and ${state.people.length - 500} more</p>` : "");
    box.querySelectorAll("tr[data-i]").forEach((tr) => tr.addEventListener("click", () => { state.idx = +tr.dataset.i; renderPreview(); }));
  }

  function renderPreview() {
    const box = $("#pkMail");
    const n = state.people.length;
    $("#pkWho").textContent = n ? `${state.idx + 1} / ${n}` : "sample";
    const p = n ? state.people[state.idx] : { name: "Venkatesh Ragipati", emp: "2000168956", email: "2000168956@hexaware.com" };
    const vars = varsFor(p, state.idx);
    const e = build(p, vars);
    const unk = unknownVars();
    box.innerHTML = `<div class="mp-subject"><span>To</span>${escHtml(p.email || "—")}</div><div class="mp-subject"><span>Subject</span>${escHtml(e.subject)}</div><div class="mp-body">${e.html}</div>` +
      (unk.length ? `<div class="mp-subject warn">Unknown field(s): ${unk.map((u) => "{" + escHtml(u) + "}").join(", ")} — add a column or common value with that name, or remove it.</div>` : "");
  }

  function refresh() { renderStats(); renderChipButtons(); refreshEditors(); renderTable(); renderPreview(); }

  function saveState() {
    store.set("maker", {
      common: state.common, subject: fromEditor($("#pkSubject")), body: fromEditor($("#pkBody")),
      greet: $("#pkGreet").checked, domain: $("#pkDomain").value.trim(),
    });
  }

  // ---------- generate ----------
  async function generate() {
    if (!state.people.length) { toast("Upload the participants sheet first.", true); return; }
    const unk = unknownVars();
    if (unk.length) { toast(`The email uses ${unk.map((u) => "{" + u + "}").join(", ")} which isn't a column or common value.`, true); return; }
    const emptyCommon = state.common.filter((c) => c.label.trim() && !c.value.trim()).map((c) => c.label);
    if (emptyCommon.length && !confirm(`These common values are empty: ${emptyCommon.join(", ")}. Continue anyway?`)) return;
    let list = state.people.map((p, i) => ({ p, i, det: detailsFor(p, i) }));
    if (state.details) {
      const missing = list.filter((x) => !x.det);
      if (missing.length) {
        const names = missing.slice(0, 5).map((x) => x.p.name || x.p.emp).join(", ");
        if (!confirm(`${missing.length} participant(s) have no row in the details sheet (${names}${missing.length > 5 ? "…" : ""}).\n\nOK = skip them and send to the rest.\nCancel = stop and fix the sheet.`)) return;
        list = list.filter((x) => x.det);
      }
    }
    const btn = $("#pkGen"); btn.disabled = true;
    try {
      const zip = new JSZip();
      const people = list.map(({ p, i }) => ({ name: p.name, email: p.email, files: [], vars: varsFor(p, i) }));
      const subjectName = fromEditor($("#pkSubject")).replace(/\{[^}]*\}/g, "").trim() || "Mail";
      const kit = await writeMailKit(zip, { kind: "custom", people, event: subjectName, build: (p, vars) => build(p, vars) });
      download(await zip.generateAsync({ type: "blob" }), `${safeName(subjectName)} - Mail.zip`);
      toast(`✔ Mail ZIP for ${kit.count} people` + (kit.test ? " · TEST mode: 3 emails to you" : kit.noEmail ? ` · ${kit.noEmail} without email skipped` : ""));
    } catch (e) { console.error(e); toast("Couldn't build the ZIP: " + e.message, true); }
    finally { btn.disabled = false; }
  }

  // ---------- init ----------
  document.addEventListener("DOMContentLoaded", () => {
    const subj = chipEditor("pkSubject", true), body = chipEditor("pkBody", false);
    $("#pkDomain").value = saved.domain || "hexaware.com";
    $("#pkGreet").checked = saved.greet !== false;
    subj.innerHTML = toEditorHtml(saved.subject != null ? saved.subject : "Your login details", labels());
    body.innerHTML = toEditorHtml(saved.body != null ? saved.body :
      "Here are your details:\n\n{Details}\n\nPlease keep them safe and reach out if you have any questions.\n\nRegards,\nEarly Careers Team", labels());
    [subj, body].forEach((el) => {
      el.addEventListener("focus", () => (lastEditor = el.id));
      el.addEventListener("input", () => { saveState(); renderPreview(); });
    });
    $("#pkGreet").addEventListener("change", () => { saveState(); renderPreview(); });
    $("#pkDomain").addEventListener("input", () => { saveState(); resolveEmails(); renderStats(); renderTable(); renderPreview(); });
    $("#pkPeople").addEventListener("change", (e) => { if (e.target.files[0]) loadPeople(e.target.files[0]); e.target.value = ""; });
    $("#pkDetails").addEventListener("change", (e) => { if (e.target.files[0]) loadDetails(e.target.files[0]); e.target.value = ""; });
    $("#pkDetailsClear").addEventListener("click", () => { state.details = null; refresh(); });
    $("#pkAddCommon").addEventListener("click", () => { state.common.push({ label: "", value: "" }); renderCommon(); const ins = $$("#pkCommon input"); ins[ins.length - 2].focus(); });
    $("#pkPrev").addEventListener("click", () => { if (state.people.length) { state.idx = (state.idx - 1 + state.people.length) % state.people.length; renderPreview(); } });
    $("#pkNext").addEventListener("click", () => { if (state.people.length) { state.idx = (state.idx + 1) % state.people.length; renderPreview(); } });
    $("#pkGen").addEventListener("click", generate);
    renderCommon();
    refresh();
  });
})();
