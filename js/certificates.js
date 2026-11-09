/* Certificates: one template per type, click-to-place name, Excel/paste names, PNG/PDF ZIP. */
(function () {
  "use strict";
  const { $, store, toast, download, safeName, uniqueNamer, parsePeople, EMAIL_RE, mail, writeMailKit } = window.MMS;

  const DEFAULT_STYLE = { x: 0.5, y: 0.5, size: 6, maxW: 60, font: "Great Vibes", color: "#1f2a44", bold: false, align: "center", textCase: "title" };
  let uid = 0;
  const savedStyles = store.get("certStyles", {}); // keyed by type label, so "Winner" keeps its spot next event
  const groups = [];
  let active = null;
  let format = store.get("certFormat", "pdf");
  let dragging = false;

  const canvas = $("#preview");
  const ctx = canvas.getContext("2d");

  function newGroup(label, copyFrom) {
    const style = Object.assign({}, DEFAULT_STYLE, copyFrom ? copyFrom.style : {}, savedStyles[label.toLowerCase()] || {});
    const g = { id: ++uid, label, img: null, imgName: "", style, text: "" };
    groups.push(g);
    return g;
  }

  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/s$/, "");
  function findGroup(label) { return groups.find((g) => norm(g.label) === norm(label)); }

  // ---------- names ----------
  function people(g) { return parsePeople(g.text).filter((p) => p.name); }

  function caseName(name, mode) {
    if (mode === "upper") return name.toUpperCase();
    if (mode === "title") return name.toLowerCase().replace(/(^|[\s\-'.])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
    return name;
  }

  // ---------- drawing ----------
  function fontStr(st, px) { return `${st.bold ? 700 : 400} ${px}px "${st.font}"`; }

  async function ensureFont(st) {
    try { await document.fonts.load(fontStr(st, 40), "Aa"); } catch (e) { /* system font */ }
  }

  function drawName(c, w, h, st, rawName) {
    const name = caseName(rawName, st.textCase);
    let px = (st.size / 100) * h;
    const maxW = (st.maxW / 100) * w;
    c.font = fontStr(st, px);
    while (c.measureText(name).width > maxW && px > 8) { px *= 0.96; c.font = fontStr(st, px); }
    c.fillStyle = st.color;
    c.textAlign = st.align;
    c.textBaseline = "middle";
    c.fillText(name, st.x * w, st.y * h);
    return px;
  }

  function render() {
    const g = active;
    const has = g && g.img;
    canvas.classList.toggle("show", !!has);
    $("#previewEmpty").hidden = !!has;
    $("#previewTitle").textContent = g ? `Preview — ${g.label}` : "Preview";
    if (!has) { $("#posInfo").textContent = ""; return; }
    const w = g.img.naturalWidth, h = g.img.naturalHeight;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(g.img, 0, 0);
    const st = g.style;
    const sample = $("#fSample").value.trim() || people(g)[0]?.name || "Participant Name";
    const px = drawName(ctx, w, h, st, sample);
    // guide: max-width box (preview only)
    const maxW = (st.maxW / 100) * w;
    const left = st.align === "center" ? st.x * w - maxW / 2 : st.align === "left" ? st.x * w : st.x * w - maxW;
    ctx.save();
    ctx.setLineDash([Math.max(6, w / 150), Math.max(4, w / 220)]);
    ctx.lineWidth = Math.max(1.5, w / 900);
    ctx.strokeStyle = "rgba(59,47,217,.65)";
    ctx.strokeRect(left, st.y * h - px * 0.75, maxW, px * 1.5);
    ctx.restore();
    $("#posInfo").textContent = `${w}×${h}px · name at ${Math.round(st.x * 100)}%, ${Math.round(st.y * 100)}%`;
  }

  // ---------- UI sync ----------
  function renderChips() {
    const box = $("#groupChips");
    box.innerHTML = "";
    groups.forEach((g) => {
      const b = document.createElement("button");
      b.className = "chip" + (g === active ? " active" : "");
      b.innerHTML = `<span class="dot ${g.img ? "ok" : ""}"></span><span></span><span class="count">${people(g).length}</span>`;
      b.children[1].textContent = g.label;
      b.title = g.img ? g.imgName : "No template yet";
      b.addEventListener("click", () => select(g));
      box.appendChild(b);
    });
    $("#removeGroup").disabled = groups.length < 2;
  }

  function syncControls() {
    const g = active, st = g.style;
    $("#tplFor").textContent = "— " + g.label;
    $("#namesFor").textContent = "— " + g.label;
    $("#tplLabel").innerHTML = g.img ? `✔ ${escapeHtml(g.imgName)} <u>(change)</u>` : "Drop your PNG/JPG certificate here or <u>browse</u>";
    $("#tplDrop").classList.toggle("has", !!g.img);
    $("#fFont").value = st.font;
    $("#fColor").value = st.color;
    $("#fSize").value = Math.round(st.size * 10);
    $("#fMax").value = st.maxW;
    $("#fCase").value = st.textCase;
    $("#fAlign").value = st.align;
    $("#fBold").checked = st.bold;
    $("#namesBox").value = g.text;
    updateLabels();
    updateStats();
  }

  function updateLabels() {
    $("#fSizeVal").textContent = active.style.size.toFixed(1) + "% of height";
    $("#fMaxVal").textContent = active.style.maxW + "% of width";
  }

  function updateStats() {
    const list = people(active);
    const withMail = list.filter((p) => p.email).length;
    const total = groups.reduce((n, g) => n + people(g).length, 0);
    const dupes = list.length - new Set(list.map((p) => p.name.toLowerCase())).size;
    let html = list.length
      ? `<span class="ok">${list.length} names</span> in ${escapeHtml(active.label)} · ${withMail} with email`
      : "No names yet";
    if (groups.length > 1) html += ` · <b>${total}</b> across all types`;
    if (dupes) html += ` · <span class="warn">${dupes} duplicate name(s) — files get (2), (3)…</span>`;
    $("#namesStats").innerHTML = html;
  }

  function select(g) { active = g; renderChips(); syncControls(); ensureFont(g.style).then(render); }

  function saveStyle() {
    savedStyles[active.label.toLowerCase()] = active.style;
    store.set("certStyles", savedStyles);
    store.set("certGroups", groups.map((g) => g.label));
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // ---------- template loading ----------
  function loadTemplate(file) {
    if (!file) return;
    if (!/image\/(png|jpe?g)/.test(file.type)) { toast("Please use a PNG or JPG image. (Export your design as PNG.)", true); return; }
    const img = new Image();
    img.onload = () => {
      active.img = img; active.imgName = file.name;
      renderChips(); syncControls(); ensureFont(active.style).then(render);
      toast(`Template loaded for ${active.label} — click where the name goes`);
    };
    img.onerror = () => toast("Couldn't read that image.", true);
    img.src = URL.createObjectURL(file);
  }

  // ---------- Excel import ----------
  function importSheet(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(reader.result), { type: "array" });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false });
        const hIdx = rows.findIndex((r) => r.some((c) => /name/i.test(String(c))));
        let nameCol = 0, mailCol = -1, catCol = -1, start = 0;
        if (hIdx >= 0 && hIdx < 10) {
          const h = rows[hIdx].map((c) => String(c).trim().toLowerCase());
          nameCol = h.findIndex((c) => /(^|\s)(full\s*)?name/.test(c) && !/mail|team|event/.test(c));
          if (nameCol < 0) nameCol = h.findIndex((c) => /name/.test(c));
          mailCol = h.findIndex((c) => /mail/.test(c));
          catCol = h.findIndex((c) => /category|type|award|position|result|prize|certificate/.test(c));
          start = hIdx + 1;
        }
        const buckets = new Map();
        let count = 0;
        rows.slice(start).forEach((r) => {
          const name = String(r[nameCol] || "").trim();
          if (!name) return;
          let email = mailCol >= 0 ? String(r[mailCol] || "").trim() : "";
          if (!email) { const m = r.join(" ").match(EMAIL_RE); email = m ? m[0] : ""; }
          const cat = catCol >= 0 ? String(r[catCol] || "").trim() : "";
          let g = cat ? findGroup(cat) : active;
          if (!g) { g = newGroup(cat, active); }
          if (!buckets.has(g)) buckets.set(g, []);
          buckets.get(g).push(email ? `${name}, ${email}` : name);
          count++;
        });
        if (!count) { toast("No names found. Make sure there's a 'Name' column.", true); return; }
        buckets.forEach((lines, g) => (g.text = lines.join("\n")));
        // drop empty default type if the sheet brought its own categories
        if (catCol >= 0) {
          for (let i = groups.length - 1; i >= 0; i--) if (!buckets.has(groups[i]) && !groups[i].img && !people(groups[i]).length && groups.length > 1) groups.splice(i, 1);
        }
        active = buckets.has(active) ? active : buckets.keys().next().value;
        saveStyle(); renderChips(); syncControls(); render();
        const parts = Array.from(buckets.entries()).map(([g, l]) => `${l.length} ${g.label}`);
        toast(`Imported ${count} names: ${parts.join(", ")}`);
      } catch (e) {
        console.error(e);
        toast("Couldn't read that file: " + e.message, true);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function sampleSheet() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "Email", "Category"],
      ["Venkatesh Ragipati", "venkatesh.r@company.com", "Winner"],
      ["Priya Sharma", "priya.s@company.com", "Runner-up"],
      ["Arjun Kumar", "arjun.k@company.com", "Participant"],
    ]);
    ws["!cols"] = [{ wch: 26 }, { wch: 30 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Names");
    XLSX.writeFile(wb, "certificate-names-sample.xlsx");
  }

  // ---------- generation ----------
  const tick = () => new Promise((r) => setTimeout(r, 0));

  async function generate() {
    const targets = ($("#allGroups").checked ? groups : [active]).filter((g) => people(g).length);
    if (!targets.length) { toast("Add some names first.", true); return; }
    const missing = targets.filter((g) => !g.img);
    if (missing.length) { toast(`Upload a template for: ${missing.map((g) => g.label).join(", ")}`, true); select(missing[0]); return; }

    const btn = $("#genCerts"), prog = $("#certProg"), bar = prog.firstElementChild, lbl = prog.lastElementChild;
    btn.disabled = true; prog.hidden = false;
    const total = targets.reduce((n, g) => n + people(g).length, 0);
    let done = 0;
    const zip = new JSZip();
    const event = $("#certEvent").value.trim();
    const multi = targets.length > 1;
    const fmts = format === "both" ? ["png", "pdf"] : [format];
    const attachFmt = format === "png" ? "png" : "pdf";
    const mailRows = [];
    const off = document.createElement("canvas");
    const oc = off.getContext("2d");

    try {
      for (const g of targets) {
        await ensureFont(g.style);
        const w = g.img.naturalWidth, h = g.img.naturalHeight;
        off.width = w; off.height = h;
        const namers = {};
        for (const p of people(g)) {
          oc.clearRect(0, 0, w, h);
          oc.drawImage(g.img, 0, 0);
          drawName(oc, w, h, g.style, p.name);
          const display = caseName(p.name, g.style.textCase === "upper" ? "title" : g.style.textCase);
          const base = safeName(display);
          let attachPath = "";
          for (const f of fmts) {
            const dir = (multi ? safeName(g.label) + "/" : "") + (fmts.length > 1 ? f.toUpperCase() + "/" : "");
            namers[dir] = namers[dir] || uniqueNamer();
            const file = dir + namers[dir](base) + "." + f;
            if (f === "png") {
              const blob = await new Promise((r) => off.toBlob(r, "image/png"));
              zip.file(file, blob, { compression: "STORE" });
            } else {
              const pdf = new jspdf.jsPDF({ orientation: w >= h ? "landscape" : "portrait", unit: "pt", format: [w * 0.75, h * 0.75], compress: true });
              pdf.addImage(off.toDataURL("image/jpeg", 0.93), "JPEG", 0, 0, w * 0.75, h * 0.75, undefined, "FAST");
              pdf.setProperties({ title: `${event ? event + " – " : ""}${p.name}` });
              zip.file(file, pdf.output("blob"), { compression: "STORE" });
            }
            if (f === attachFmt) attachPath = file;
          }
          mailRows.push([display, p.email, g.label, attachPath.replace(/\//g, "\\")]);
          done++;
          bar.style.width = (done / total) * 100 + "%";
          lbl.textContent = `${done} / ${total}`;
          if (done % 3 === 0) await tick();
        }
      }
      const m = mail();
      writeMailKit(zip, {
        subject: m.certSubject, body: m.certBody,
        constants: { Event: event || "the event" },
        header: ["Name", "Email", "Category", "File"], rows: mailRows,
      });
      lbl.textContent = "Zipping…";
      await tick();
      const blob = await zip.generateAsync({ type: "blob" });
      download(blob, `${safeName(event || "Certificates")} - Certificates.zip`);
      const noMail = mailRows.filter((r) => !r[1]).length;
      toast(`✔ ${total} certificates ready` + (noMail ? ` (${noMail} without email)` : ""));
    } catch (e) {
      console.error(e);
      toast("Something went wrong: " + e.message, true);
    } finally {
      btn.disabled = false;
      setTimeout(() => { prog.hidden = true; bar.style.width = "0"; }, 1500);
    }
  }

  // ---------- events ----------
  function bind() {
    $("#tplInput").addEventListener("change", (e) => { loadTemplate(e.target.files[0]); e.target.value = ""; });
    const drop = $("#tplDrop");
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => loadTemplate(e.dataTransfer.files[0]));

    const place = (e) => {
      const r = canvas.getBoundingClientRect();
      active.style.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      active.style.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      render();
    };
    canvas.addEventListener("pointerdown", (e) => { dragging = true; canvas.setPointerCapture(e.pointerId); place(e); });
    canvas.addEventListener("pointermove", (e) => { if (dragging) place(e); });
    canvas.addEventListener("pointerup", () => { dragging = false; saveStyle(); });

    const styleInputs = {
      fFont: (v) => (active.style.font = v), fColor: (v) => (active.style.color = v),
      fSize: (v) => (active.style.size = v / 10), fMax: (v) => (active.style.maxW = +v),
      fCase: (v) => (active.style.textCase = v), fAlign: (v) => (active.style.align = v),
    };
    Object.entries(styleInputs).forEach(([id, set]) => $("#" + id).addEventListener("input", async (e) => {
      set(e.target.value); updateLabels(); saveStyle(); await ensureFont(active.style); render();
    }));
    $("#fBold").addEventListener("change", async (e) => { active.style.bold = e.target.checked; saveStyle(); await ensureFont(active.style); render(); });
    $("#fSample").addEventListener("input", render);

    // Arrow keys nudge the name when the preview is hovered
    document.addEventListener("keydown", (e) => {
      if (!canvas.matches(":hover") || !active.img || !/^Arrow/.test(e.key)) return;
      e.preventDefault();
      const step = e.shiftKey ? 0.01 : 0.002;
      if (e.key === "ArrowLeft") active.style.x -= step;
      if (e.key === "ArrowRight") active.style.x += step;
      if (e.key === "ArrowUp") active.style.y -= step;
      if (e.key === "ArrowDown") active.style.y += step;
      saveStyle(); render();
    });

    $("#namesBox").addEventListener("input", (e) => {
      active.text = e.target.value; updateStats(); renderChips();
      if (!$("#fSample").value.trim()) render();
    });
    $("#xlsInput").addEventListener("change", (e) => { if (e.target.files[0]) importSheet(e.target.files[0]); e.target.value = ""; });
    $("#sampleXls").addEventListener("click", sampleSheet);

    $("#addGroup").addEventListener("click", () => {
      const label = (prompt("Name of the certificate type (e.g. Winner, Runner-up, Participant):") || "").trim();
      if (!label) return;
      if (findGroup(label)) { toast("That type already exists."); select(findGroup(label)); return; }
      const g = newGroup(label, active);
      saveStyle(); select(g);
    });
    $("#renameGroup").addEventListener("click", () => {
      const label = (prompt("Rename type:", active.label) || "").trim();
      if (!label || label === active.label) return;
      active.label = label; saveStyle(); renderChips(); syncControls(); render();
    });
    $("#removeGroup").addEventListener("click", () => {
      if (groups.length < 2) return;
      if (people(active).length && !confirm(`Remove "${active.label}" and its ${people(active).length} names?`)) return;
      groups.splice(groups.indexOf(active), 1);
      store.set("certGroups", groups.map((g) => g.label));
      select(groups[0]);
    });

    document.querySelectorAll("#fmtSeg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.fmt === format);
      b.addEventListener("click", () => {
        format = b.dataset.fmt; store.set("certFormat", format);
        document.querySelectorAll("#fmtSeg button").forEach((x) => x.classList.toggle("active", x === b));
      });
    });
    $("#genCerts").addEventListener("click", generate);

    const ev = $("#certEvent");
    ev.value = store.get("certEvent", "");
    ev.addEventListener("input", () => store.set("certEvent", ev.value));
  }

  document.addEventListener("DOMContentLoaded", () => {
    const labels = store.get("certGroups", ["Participant"]);
    labels.forEach((l) => newGroup(l));
    active = groups[0];
    bind();
    renderChips(); syncControls(); render();
    // redraw once web fonts finish loading
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(render);
  });
})();
