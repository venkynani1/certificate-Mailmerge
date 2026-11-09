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

  // ---------- email text ----------
  const DEFAULT_MAIL = {
    certSubject: "Your certificate – {Event}",
    certBody:
      "Dear {Name},\n\nThank you for being part of {Event}. Please find your certificate attached.\n\nWe appreciate your enthusiasm and look forward to seeing you at future events.\n\nRegards,\nEarly Careers Team",
    vSubject: "Your {Brand} voucher – {Event}",
    vBody:
      "Dear {Name},\n\nThank you for your enthusiastic participation in {Event}.\n\nAs a token of appreciation, here are your {Brand} voucher details:\n\nReference ID: {RefID}\nPIN: {Pin}\nExpiry Date: {Expiry}\nAmount: {Amount}\n\nRegards,\nEarly Careers Team",
  };
  const mailFields = { certSubject: "#mCertSubject", certBody: "#mCertBody", vSubject: "#mVSubject", vBody: "#mVBody", cc: "#mCc", testEmail: "#mTestEmail" };
  function initMail() {
    const saved = store.get("mail", {});
    Object.entries(mailFields).forEach(([k, sel]) => {
      const el = $(sel);
      el.value = saved[k] != null ? saved[k] : DEFAULT_MAIL[k] || "";
      el.addEventListener("input", () => { const s = store.get("mail", {}); s[k] = el.value; store.set("mail", s); syncTestFlag(); });
    });
    const t = $("#mTest");
    t.checked = !!saved.test;
    t.addEventListener("change", () => { const s = store.get("mail", {}); s.test = t.checked; store.set("mail", s); syncTestFlag(); });
    $("#mReset").addEventListener("click", () => {
      Object.entries(DEFAULT_MAIL).forEach(([k, v]) => ($(mailFields[k]).value = v));
      const s = store.get("mail", {}); Object.keys(DEFAULT_MAIL).forEach((k) => delete s[k]); store.set("mail", s);
      toast("Email text reset");
    });
    syncTestFlag();
  }
  function mail() {
    const o = {};
    Object.entries(mailFields).forEach(([k, sel]) => (o[k] = $(sel).value.trim()));
    o.test = $("#mTest").checked && EMAIL_RE.test(o.testEmail);
    return o;
  }
  function syncTestFlag() {
    const on = mail().test;
    $$(".test-flag").forEach((el) => (el.hidden = !on));
    if ($("#mTest").checked && !EMAIL_RE.test($("#mTestEmail").value)) $("#mTestWarn").hidden = false; else $("#mTestWarn").hidden = true;
  }
  function textToHtml(text) {
    const esc = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return '<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">' + esc.replace(/\r?\n/g, "<br>") + "</div>";
  }
  function fillVars(text, vars) {
    return String(text || "").replace(/\{(\w+)\}/g, (m, k) => {
      const key = Object.keys(vars).find((v) => v.toLowerCase() === k.toLowerCase());
      return key ? String(vars[key] == null ? "" : vars[key]) : m;
    });
  }
  const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // Excel file with a real Excel *table* named MailList — Power Automate's
  // "List rows present in a table" only reads tables, not plain cells.
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
   * Writes the "Mail Merge" folder for Power Automate:
   *   Mail Merge/mail-list.xlsx  (table MailList: Email, Name, Subject, Body, FileName, File, Cc)
   * people = [{ email, name, file (path inside "Mail Merge/"), vars }]
   * Subject/Body are filled in per person here, so one flow works for every event.
   */
  async function writeMailKit(zip, { subject, body, people }) {
    const m = mail();
    // people without an email can't be sent to — they're left out of the list
    let list = m.test ? people.slice(0, 3) : people.filter((p) => p.email);
    const rows = list.map((p) => {
      const vars = Object.assign({ Name: p.name || "Participant" }, p.vars || {});
      const subj = (m.test ? "[TEST] " : "") + fillVars(subject, vars);
      const html = textToHtml(fillVars(body, vars));
      const to = m.test ? m.testEmail : p.email;
      const fileName = p.file ? p.file.split("/").pop() : "";
      return [to, p.name || "", subj, html, fileName, p.file || "", m.test ? "" : m.cc];
    });
    zip.file("Mail Merge/mail-list.xlsx", await buildMailXlsx(["Email", "Name", "Subject", "Body", "FileName", "File", "Cc"], rows));
    zip.file("READ ME - how to send.txt",
      "Send these emails with Power Automate (one-time setup: see the 'Send emails' tab in the app).\r\n\r\n" +
      "1. Extract this ZIP.\r\n" +
      "2. In OneDrive, delete the old 'Mail Merge' folder.\r\n" +
      "3. Drag the new 'Mail Merge' folder into OneDrive (My files).\r\n" +
      "4. Open make.powerautomate.com > My flows > 'Mail Merge - Send' > Run.\r\n" +
      (m.test ? "\r\nTEST MODE: only 3 emails, all sent to " + m.testEmail + ".\r\n" : ""));
    return { count: rows.length, test: m.test, noEmail: people.filter((p) => !p.email).length };
  }

  window.MMS = { $, $$, store, toast, download, safeName, uniqueNamer, toCsv, parsePeople, EMAIL_RE, mail, writeMailKit, buildMailXlsx, showTab };

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
