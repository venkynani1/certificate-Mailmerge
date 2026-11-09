/* Shared helpers: tabs, toasts, downloads, CSV, saved settings, email text. */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  // ---------- tabs ----------
  function showTab(name) {
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    $$(".panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
    store.set("tab", name);
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest(".tab");
    if (t) showTab(t.dataset.tab);
    const g = e.target.closest("[data-goto]");
    if (g) { e.preventDefault(); showTab(g.dataset.goto); window.scrollTo(0, 0); }
  });

  // ---------- storage (best effort) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("mms." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("mms." + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  // ---------- toast ----------
  let toastTimer;
  function toast(msg, isError) {
    const el = $("#toast");
    el.textContent = msg;
    el.className = "toast" + (isError ? " error" : "");
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), isError ? 6000 : 3500);
  }

  // ---------- files ----------
  function download(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  function safeName(s) {
    return String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "") || "Untitled";
  }
  function uniqueNamer() {
    const seen = new Map();
    return (base) => {
      const k = base.toLowerCase();
      const n = (seen.get(k) || 0) + 1;
      seen.set(k, n);
      return n === 1 ? base : `${base} (${n})`;
    };
  }

  // ---------- CSV (UTF-8 with BOM so Excel opens names correctly) ----------
  function toCsv(rows) {
    const q = (v) => {
      const s = String(v == null ? "" : v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return "﻿" + rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
  }

  const EMAIL_RE = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  // "Name, email" | "Name<TAB>email" | "email" | "Name"
  function parsePeople(text) {
    return String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const m = line.match(EMAIL_RE);
      const email = m ? m[0] : "";
      let name = m ? line.replace(m[0], "") : line;
      name = name.replace(/[<>]/g, " ").replace(/[\t,;]+/g, " ").replace(/\s+/g, " ").trim();
      return { name, email };
    });
  }

  // ---------- email text (chip editor) ----------
  // You only write the message. "Dear <name>," is added for you, and the event / brand / name are
  // chips that can't be half-deleted, so a stray brace can never break the email.
  const VAR_LABEL = { Name: "Participant name", Event: "Event name", Brand: "Voucher brand" };
  const DEFAULT_MAIL = {
    certSubject: "Your certificate – {Event}",
    certBody: "Thank you for being part of {Event}. Please find your certificate attached.\n\nWe appreciate your enthusiasm and look forward to seeing you at future events.\n\nRegards,\nEarly Careers Team",
    vSubject: "Your {Brand} voucher – {Event}",
    vBody: "Thank you for your enthusiastic participation in {Event}.\n\nAs a token of appreciation, here are your {Brand} voucher details:",
    vClosing: "Regards,\nEarly Careers Team",
  };
  const escHtml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const chipHtml = (v) => `<span class="var-chip" contenteditable="false" data-var="${v}">${VAR_LABEL[v]}</span>`;
  function toEditorHtml(text) {
    return escHtml(text).replace(/\{(Name|Event|Brand)\}/gi, (m, v) => chipHtml(v.charAt(0).toUpperCase() + v.slice(1).toLowerCase())).replace(/\n/g, "<br>");
  }
  function fromEditor(el) {
    const walk = (n, first) => {
      if (n.nodeType === 3) return n.nodeValue.replace(/​/g, "").replace(/ /g, " ");
      if (n.nodeType !== 1) return "";
      if (n.dataset && n.dataset.var) return "{" + n.dataset.var + "}";
      if (n.tagName === "BR") return "\n";
      const inner = Array.from(n.childNodes).map((c, i) => walk(c, i === 0)).join("");
      return (n.tagName === "DIV" || n.tagName === "P") && n !== el && !first ? "\n" + inner : inner;
    };
    return walk(el, true).replace(/\n$/, "");
  }
  const editors = {};
  function chipEditor(id, single) {
    const el = $("#" + id);
    el.addEventListener("paste", (e) => { e.preventDefault(); document.execCommand("insertText", false, (e.clipboardData || window.clipboardData).getData("text").replace(single ? /\s*\n\s*/g : /$^/, " ")); });
    el.addEventListener("keydown", (e) => { if (single && e.key === "Enter") e.preventDefault(); });
    el.addEventListener("drop", (e) => e.preventDefault());
    editors[id] = el;
    return el;
  }
  function insertChip(id, v) {
    const el = editors[id];
    el.focus();
    const sel = window.getSelection();
    if (!sel.rangeCount || !el.contains(sel.anchorNode)) { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
    document.execCommand("insertHTML", false, chipHtml(v) + "​");
  }

  const mailFields = { certSubject: "mCertSubject", certBody: "mCertBody", vSubject: "mVSubject", vBody: "mVBody", vClosing: "mVClosing" };
  function initMail() {
    const saved = store.get("mail2", {});
    Object.entries(mailFields).forEach(([k, id]) => {
      const el = chipEditor(id, /Subject/.test(k));
      el.innerHTML = toEditorHtml(saved[k] != null ? saved[k] : DEFAULT_MAIL[k]);
      el.addEventListener("input", () => { const s = store.get("mail2", {}); s[k] = fromEditor(el); store.set("mail2", s); renderMailPreview(); });
    });
    $$(".ins-chip").forEach((b) => {
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => { insertChip(b.dataset.target, b.dataset.var); editors[b.dataset.target].dispatchEvent(new Event("input")); });
    });
    const te = $("#mTestEmail"), t = $("#mTest");
    te.value = saved.testEmail || "";
    t.checked = !!saved.test;
    te.addEventListener("input", () => { const s = store.get("mail2", {}); s.testEmail = te.value.trim(); store.set("mail2", s); syncTestFlag(); });
    t.addEventListener("change", () => { const s = store.get("mail2", {}); s.test = t.checked; store.set("mail2", s); syncTestFlag(); });
    $("#mReset").addEventListener("click", () => {
      Object.entries(mailFields).forEach(([k, id]) => (editors[id].innerHTML = toEditorHtml(DEFAULT_MAIL[k])));
      const s = store.get("mail2", {}); Object.keys(DEFAULT_MAIL).forEach((k) => delete s[k]); store.set("mail2", s);
      renderMailPreview(); toast("Email text reset");
    });
    $$("[data-preview]").forEach((b) => b.addEventListener("click", () => {
      $$("[data-preview]").forEach((x) => x.classList.toggle("active", x === b)); renderMailPreview();
    }));
    syncTestFlag(); renderMailPreview();
  }
  function mail() {
    const o = {};
    Object.entries(mailFields).forEach(([k, id]) => (o[k] = fromEditor(editors[id]).trim()));
    o.testEmail = $("#mTestEmail").value.trim();
    o.test = $("#mTest").checked && EMAIL_RE.test(o.testEmail);
    return o;
  }
  function syncTestFlag() {
    const on = mail().test;
    $$(".test-flag").forEach((el) => (el.hidden = !on));
    $("#mTestWarn").hidden = !($("#mTest").checked && !EMAIL_RE.test($("#mTestEmail").value));
  }

  function fillVars(text, vars) {
    return String(text || "").replace(/\{(\w+)\}/g, (m, k) => {
      const key = Object.keys(vars).find((v) => v.toLowerCase() === k.toLowerCase());
      return key ? String(vars[key] == null ? "" : vars[key]) : m;
    });
  }
  const textHtml = (t, vars) => escHtml(fillVars(t, vars)).replace(/\r?\n/g, "<br>");
  function voucherTable(v) {
    const th = 'style="background:#70AD47;color:#fff;text-align:left;padding:6px 10px;border:1px solid #444"';
    const td = 'style="padding:6px 10px;border:1px solid #444"';
    const cols = [["Reference ID", v.RefID], ["Pin", v.Pin], ["Expiry Date", v.Expiry], ["Amount", v.Amount]];
    return `<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt;margin:8px 0"><tr>${cols.map((c) => `<th ${th}>${c[0]}</th>`).join("")}</tr>` +
      `<tr>${cols.map((c) => `<td ${td}>${escHtml(c[1] == null ? "" : c[1])}</td>`).join("")}</tr></table>`;
  }
  // kind: "cert" | "voucher"
  function buildEmail(kind, m, vars) {
    const greet = `Dear ${escHtml(vars.Name || "Participant")},<br><br>`;
    let html = greet + (kind === "cert" ? textHtml(m.certBody, vars) : textHtml(m.vBody, vars) + "<br>" + voucherTable(vars) + "<br>" + textHtml(m.vClosing, vars));
    html = '<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#222">' + html + "</div>";
    const subject = fillVars(kind === "cert" ? m.certSubject : m.vSubject, vars).replace(/\s+/g, " ").trim();
    return { subject, html };
  }
  function renderMailPreview() {
    const box = $("#mailPreview"); if (!box) return;
    const kind = ($("[data-preview].active") || {}).dataset?.preview || "cert";
    const ev = ($("#certEvent") && $("#certEvent").value.trim()) || ($("#vEvent") && $("#vEvent").value.trim()) || "Mavericks AI Edge";
    const vars = { Name: "Venkatesh Ragipati", Event: kind === "cert" ? ev : (($("#vEvent") && $("#vEvent").value.trim()) || ev), Brand: ($("#vBrand") && $("#vBrand").value.trim()) || "Amazon",
      RefID: "H6V6-UX3PPG-DGEY", Pin: "6014879723006652", Expiry: "2027-10-13", Amount: "1000" };
    const e = buildEmail(kind, mail(), vars);
    box.innerHTML = `<div class="mp-subject"><span>Subject</span>${escHtml(e.subject)}</div><div class="mp-body">${e.html}</div>`;
  }
  const xmlEsc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // Excel file with a real Excel table named MailList — for checking the list (and hand-built flows).
  async function buildMailXlsx(header, rows) {
    const data = rows.length ? rows : [header.map(() => "")];
    const ws = XLSX.utils.aoa_to_sheet([header].concat(data));
    ws["!cols"] = header.map((h) => ({ wch: h === "Body" ? 60 : h === "Subject" ? 40 : 28 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "MailList");
    const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const z = await JSZip.loadAsync(bytes);
    const lastCol = String.fromCharCode(64 + header.length);
    const ref = `A1:${lastCol}${data.length + 1}`;
    z.file("xl/tables/table1.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="MailList" displayName="MailList" ref="${ref}" totalsRowShown="0">` +
      `<autoFilter ref="${ref}"/><tableColumns count="${header.length}">` +
      header.map((h, i) => `<tableColumn id="${i + 1}" name="${xmlEsc(h)}"/>`).join("") +
      `</tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`);
    z.file("xl/worksheets/_rels/sheet1.xml.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdTbl1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/></Relationships>');
    let sheet = await z.file("xl/worksheets/sheet1.xml").async("string");
    if (!/xmlns:r=/.test(sheet)) sheet = sheet.replace("<worksheet ", '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
    sheet = sheet.replace(/<autoFilter[^>]*\/>/, "").replace("</worksheet>", '<tableParts count="1"><tablePart r:id="rIdTbl1"/></tableParts></worksheet>');
    z.file("xl/worksheets/sheet1.xml", sheet);
    let ct = await z.file("[Content_Types].xml").async("string");
    ct = ct.replace("</Types>", '<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>');
    z.file("[Content_Types].xml", ct);
    return z.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  /**
   * Writes the "Mail Merge" folder read by the Power Automate flow:
   *   Mail Merge/mail-list.json            index: which parts to send
   *   Mail Merge/mail-list-part-NNN.json   people, max ~60k characters per part (Power Automate
   *                                        can't decode more than 131,072 characters at once)
   *   Mail Merge/mail-list.xlsx            same people as an Excel table, to check
   * people = [{ name, email, files: [{Name, Path}], vars }]
   */
  const PART_CHARS = 60000;
  async function writeMailKit(zip, { kind, people, event }) {
    const m = mail();
    const list = m.test ? people.slice(0, 3) : people.filter((p) => p.email);
    const records = list.map((p) => {
      const vars = Object.assign({}, p.vars || {}, { Name: p.name || "Participant" });
      const e = buildEmail(kind, m, vars);
      return {
        Email: m.test ? m.testEmail : p.email,
        Name: p.name || "",
        Subject: (m.test ? "[TEST] " : "") + e.subject,
        Body: e.html,
        Files: (p.files || []).map((f) => ({ Name: f.Name, Path: f.Path })),
      };
    });
    const parts = [];
    let cur = [], size = 2;
    records.forEach((r) => {
      const n = JSON.stringify(r).length + 1;
      if (cur.length && size + n > PART_CHARS) { parts.push(cur); cur = []; size = 2; }
      cur.push(r); size += n;
    });
    if (cur.length) parts.push(cur);
    const names = parts.map((_, i) => `mail-list-part-${String(i + 1).padStart(3, "0")}.json`);
    parts.forEach((part, i) => zip.file("Mail Merge/" + names[i], JSON.stringify(part)));
    zip.file("Mail Merge/mail-list.json", JSON.stringify({
      version: 2, kind, event: event || "", createdAt: new Date().toISOString(), count: records.length, test: m.test, parts: names,
    }, null, 1));
    const header = ["Email", "Name", "Subject", "Attachments"];
    zip.file("Mail Merge/mail-list.xlsx", await buildMailXlsx(header, records.map((r) => [r.Email, r.Name, r.Subject, r.Files.map((f) => f.Name).join(", ")])));
    zip.file("READ ME - how to send.txt",
      "HOW TO SEND (one-time setup is in the app's 'Send emails' tab)\r\n\r\n" +
      "1. In File Explorer open 'OneDrive - Hexaware' and DELETE the old 'Mail Merge' folder.\r\n" +
      "2. Right-click this ZIP > Extract All > Browse > choose 'OneDrive - Hexaware' > Extract.\r\n" +
      "3. make.powerautomate.com > My flows > 'Mail Merge - Send' > Run > Run flow.\r\n\r\n" +
      `This mailing: ${records.length} email(s)` + (m.test ? `, TEST MODE - all sent to ${m.testEmail}` : "") + ".\r\n");
    const biggest = Math.max(0, ...people.map((p) => (p.files || []).reduce((t, f) => t + (f.size || 0), 0)));
    return { count: records.length, test: m.test, noEmail: people.filter((p) => !p.email).length, parts: names.length, biggestMB: biggest / 1048576 };
  }

  window.MMS = { $, $$, store, toast, download, safeName, uniqueNamer, toCsv, parsePeople, EMAIL_RE, mail, writeMailKit, buildMailXlsx, renderMailPreview, showTab };

  // ---------- installable app ----------
  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); installPrompt = e;
    const b = document.getElementById("installBtn"); if (b) b.hidden = false;
  });
  window.addEventListener("appinstalled", () => { const b = document.getElementById("installBtn"); if (b) b.hidden = true; toast("Installed — open Mail Merge Studio from your Start menu / home screen"); });
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  document.addEventListener("DOMContentLoaded", () => {
    const ib = document.getElementById("installBtn");
    if (ib) ib.addEventListener("click", async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; ib.hidden = true; });
    initMail();
    const t = store.get("tab", "certs");
    if (document.getElementById("tab-" + t)) showTab(t);
    if (!window.JSZip || !window.jspdf || !window.XLSX) {
      toast("Couldn't load helper libraries — check your internet connection and reload.", true);
    }
  });
})();
