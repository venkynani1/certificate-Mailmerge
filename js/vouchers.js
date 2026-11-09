/* Vouchers: editable letter + pasted voucher codes -> Word doc (one page per voucher) + Power Automate mail kit. */
(function () {
  "use strict";
  const { $, store, toast, download, safeName, uniqueNamer, parsePeople, mail, writeMailKit } = window.MMS;
  const V = window.VoucherDocx;

  const DEFAULT_LETTER = {
    greeting: "Dear Candidate,",
    body:
      "Thank you for your enthusiastic participation in the {event}.\n\n" +
      "We sincerely appreciate the time, effort, creativity, and innovative thinking you demonstrated during the event. Your contribution helped make the {event} a great success and reflects our culture of innovation and continuous learning.\n\n" +
      "As a token of appreciation for your participation, please find your {brand} voucher details below:",
    closing: "",
    signName: "Krishna Balagurunathan",
    signTitle: "Chief Mentor & Head-Early Career",
  };
  const HEADERS = ["S.No", "Reference ID", "Pin", "Expiry Date", "Amount"];
  const fields = { vEvent: "event", vBrand: "brand", vSerial: "serial", vGreeting: "greeting", vBody: "body", vClosing: "closing", vSignName: "signName", vSignTitle: "signTitle", vPaste: "paste", vRecipients: "recipients" };
  let templateBytes = null;
  let logoUrl = "", sigUrl = "";

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function loadTemplate() {
    templateBytes = b64ToBytes(window.VOUCHER_TEMPLATE_B64);
    try {
      const zip = await JSZip.loadAsync(templateBytes);
      const rels = await zip.file("word/_rels/document.xml.rels").async("string");
      const doc = await zip.file("word/document.xml").async("string");
      const target = (pattern) => {
        const m = doc.match(pattern);
        const id = m && m[0].match(/r:embed="([^"]+)"/);
        const t = id && rels.match(new RegExp('Id="' + id[1] + '"[^>]*Target="([^"]+)"'));
        return t ? "word/" + t[1] : null;
      };
      const logo = target(/<wp:anchor[\s\S]*?r:embed="[^"]+"/);
      const sig = target(/<wp:inline[\s\S]*?r:embed="[^"]+"/);
      if (logo) logoUrl = URL.createObjectURL(await zip.file(logo).async("blob"));
      if (sig) sigUrl = URL.createObjectURL(await zip.file(sig).async("blob"));
    } catch (e) { console.warn("preview images", e); }
  }

  function letterData() {
    const paras = (t) => t.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
    return {
      eventName: $("#vEvent").value.trim(),
      brand: $("#vBrand").value.trim(),
      greeting: $("#vGreeting").value.trim(),
      paragraphs: paras($("#vBody").value),
      closing: paras($("#vClosing").value),
      signName: $("#vSignName").value.trim(),
      signTitle: $("#vSignTitle").value.trim(),
      headers: HEADERS,
      serialMode: $("#vSerial").value,
    };
  }

  function vouchers() {
    const { vouchers, problems } = V.parseVouchers($("#vPaste").value);
    if ($("#vSimplify").checked) vouchers.forEach((v) => (v.expiry = V.simplifyExpiry(v.expiry)));
    return { vouchers, problems };
  }

  // ---------- preview ----------
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function inline(text, d, v) {
    const filled = String(text)
      .replace(/\{event\}/gi, d.eventName ? `**${d.eventName}**` : "<span style='color:#b54708'>[event name]</span>")
      .replace(/\{brand\}/gi, d.brand || "")
      .replace(/\{amount\}/gi, v ? v.amount : "")
      .replace(/\{expiry\}/gi, v ? v.expiry : "");
    return filled.split(/(\*\*[^*]+\*\*)/g).map((p) => /^\*\*[^*]+\*\*$/.test(p) ? `<b>${esc(p.slice(2, -2))}</b>` : (p.includes("<span") ? p : esc(p))).join("");
  }

  function renderPreview() {
    const d = letterData();
    const { vouchers: list, problems } = vouchers();
    const v = list[0] || { ref: "XXXX-XXXXXX-XXXX", pin: "0000000000000000", expiry: "2027-10-13 00:00:00 UTC", amount: "1000" };
    const html = [];
    html.push(`<div class="p-logo">${logoUrl ? `<img src="${logoUrl}" alt="Hexaware">` : "<b>HEXAWARE</b>"}</div>`);
    html.push(`<p><b>${inline(d.greeting, d, v)}</b></p>`);
    d.paragraphs.forEach((p) => html.push(`<p>${inline(p, d, v)}</p>`));
    html.push(`<table><tr>${HEADERS.map((h) => `<th>${h}</th>`).join("")}</tr><tr><td>1</td><td>${esc(v.ref)}</td><td>${esc(v.pin)}</td><td>${esc(v.expiry)}</td><td>${esc(v.amount)}</td></tr></table>`);
    d.closing.forEach((p) => html.push(`<p>${inline(p, d, v)}</p>`));
    html.push(`<div class="p-sig">${sigUrl ? `<img src="${sigUrl}" alt="Signature">` : ""}</div>`);
    html.push(`<p class="p-sign">${esc(d.signName)}</p><p class="p-sign">${esc(d.signTitle)}</p>`);
    $("#vPaper").innerHTML = html.join("");
    $("#vPrevInfo").textContent = list.length ? `Page 1 of ${list.length}` : "Sample data";

    const st = $("#vStats");
    if (!$("#vPaste").value.trim()) st.innerHTML = "";
    else if (!list.length) st.innerHTML = `<span class="warn">No vouchers recognised — each needs a Reference ID like H6V6-UX3PPG-DGEY followed by Pin, Expiry, Amount.</span>`;
    else {
      const total = list.reduce((s, x) => s + (parseFloat(String(x.amount).replace(/[^\d.]/g, "")) || 0), 0);
      const dupRefs = list.length - new Set(list.map((x) => x.ref)).size;
      st.innerHTML = `<span class="ok">${list.length} vouchers</span> · total ${total.toLocaleString("en-IN")}` +
        (dupRefs ? ` · <span class="warn">${dupRefs} duplicate Reference ID(s)</span>` : "") +
        (problems.length ? `<ul class="warn">${problems.slice(0, 5).map((p) => `<li>${esc(p)}</li>`).join("")}${problems.length > 5 ? `<li>…and ${problems.length - 5} more</li>` : ""}</ul>` : "");
    }
    renderRecipientStats(list.length);
  }

  function recipients() { return parsePeople($("#vRecipients").value); }
  function renderRecipientStats(nV) {
    const r = recipients();
    const el = $("#vRecStats");
    if (!r.length) { el.innerHTML = ""; return; }
    const bad = r.filter((p) => !p.email).length;
    let h = `<span class="ok">${r.length} recipients</span>`;
    if (nV && r.length !== nV) h += ` · <span class="warn">${nV} vouchers vs ${r.length} recipients — only ${Math.min(nV, r.length)} will be paired</span>`;
    if (bad) h += ` · <span class="warn">${bad} line(s) without an email</span>`;
    el.innerHTML = h;
  }

  // ---------- actions ----------
  function check(list) {
    const d = letterData();
    if (!list.length) { toast("Paste the voucher details first.", true); return null; }
    if (!d.eventName) { toast("Enter the event name.", true); $("#vEvent").focus(); return null; }
    return d;
  }

  async function genDoc() {
    const { vouchers: list } = vouchers();
    const d = check(list); if (!d) return;
    const btn = $("#vGen"); btn.disabled = true;
    try {
      const blob = await V.buildVoucherDocx(JSZip, templateBytes, d, list, "blob");
      download(blob, `${safeName(d.eventName)} - Vouchers.docx`);
      toast(`✔ Word document with ${list.length} page(s) downloaded`);
    } catch (e) { console.error(e); toast("Couldn't build the document: " + e.message, true); }
    finally { btn.disabled = false; }
  }

  async function genKit() {
    const { vouchers: list } = vouchers();
    const d = check(list); if (!d) return;
    const r = recipients();
    if (!r.length) { toast("Paste the recipients (in voucher order) first.", true); $("#vRecipients").focus(); return; }
    const n = Math.min(list.length, r.length);
    if (r.length !== list.length && !confirm(`${list.length} vouchers but ${r.length} recipients. Pair the first ${n} only?`)) return;
    const btn = $("#vKit"); btn.disabled = true;
    try {
      const zip = new JSZip();
      const namer = uniqueNamer();
      const people = [];
      for (let i = 0; i < n; i++) {
        const v = list[i], p = r[i];
        // each person's own voucher page goes with their email as a Word attachment
        const file = namer(safeName(p.name || p.email.split("@")[0])) + ".docx";
        zip.file("Mail Merge/" + file, await V.buildVoucherDocx(JSZip, templateBytes, d, [v], "blob"));
        people.push({
          name: p.name || "Candidate", email: p.email, file,
          vars: { Event: d.eventName, Brand: d.brand, RefID: v.ref, Pin: v.pin, Expiry: v.expiry, Amount: v.amount },
        });
      }
      zip.file(`${safeName(d.eventName)} - Vouchers (all pages).docx`, await V.buildVoucherDocx(JSZip, templateBytes, d, list, "blob"));
      const m = mail();
      const kit = await writeMailKit(zip, { subject: m.vSubject, body: m.vBody, people });
      const blob = await zip.generateAsync({ type: "blob" });
      download(blob, `${safeName(d.eventName)} - Voucher mail kit.zip`);
      toast(`✔ Mail kit for ${kit.count} people downloaded` + (kit.test ? " · TEST mode: 3 emails to you" : ""));
    } catch (e) { console.error(e); toast("Couldn't build the mail kit: " + e.message, true); }
    finally { btn.disabled = false; }
  }

  function resetLetter() {
    $("#vGreeting").value = DEFAULT_LETTER.greeting;
    $("#vBody").value = DEFAULT_LETTER.body;
    $("#vClosing").value = DEFAULT_LETTER.closing;
    $("#vSignName").value = DEFAULT_LETTER.signName;
    $("#vSignTitle").value = DEFAULT_LETTER.signTitle;
    save(); renderPreview();
  }

  function save() {
    const s = {};
    Object.entries(fields).forEach(([id, k]) => (s[k] = $("#" + id).value));
    s.simplify = $("#vSimplify").checked;
    store.set("voucher", s);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const s = store.get("voucher", {});
    const defaults = { greeting: DEFAULT_LETTER.greeting, body: DEFAULT_LETTER.body, closing: DEFAULT_LETTER.closing, signName: DEFAULT_LETTER.signName, signTitle: DEFAULT_LETTER.signTitle, brand: "Amazon", serial: "one" };
    Object.entries(fields).forEach(([id, k]) => {
      const el = $("#" + id);
      if (s[k] != null) el.value = s[k]; else if (defaults[k] != null) el.value = defaults[k];
      el.addEventListener("input", () => { save(); renderPreview(); });
    });
    $("#vSimplify").checked = !!s.simplify;
    ["vSimplify"].forEach((id) => $("#" + id).addEventListener("change", () => { save(); renderPreview(); }));
    $("#vReset").addEventListener("click", resetLetter);
    $("#vGen").addEventListener("click", genDoc);
    $("#vKit").addEventListener("click", genKit);
    await loadTemplate();
    renderPreview();
  });
})();
