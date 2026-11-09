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
  const mailFields = { certSubject: "#mCertSubject", certBody: "#mCertBody", vSubject: "#mVSubject", vBody: "#mVBody", from: "#mFrom", cc: "#mCc" };
  function initMail() {
    const saved = store.get("mail", {});
    Object.entries(mailFields).forEach(([k, sel]) => {
      const el = $(sel);
      el.value = saved[k] != null ? saved[k] : DEFAULT_MAIL[k] || "";
      el.addEventListener("input", () => { const s = store.get("mail", {}); s[k] = el.value; store.set("mail", s); });
    });
    $("#mReset").addEventListener("click", () => {
      Object.entries(DEFAULT_MAIL).forEach(([k, v]) => ($(mailFields[k]).value = v));
      const s = store.get("mail", {}); Object.keys(DEFAULT_MAIL).forEach((k) => delete s[k]); store.set("mail", s);
      toast("Email text reset");
    });
  }
  function mail() {
    const o = {};
    Object.entries(mailFields).forEach(([k, sel]) => (o[k] = $(sel).value.trim()));
    return o;
  }
  function textToHtml(text) {
    const esc = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return '<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">' + esc.replace(/\r?\n/g, "<br>\n") + "</div>";
  }
  // Fills constants (event, brand) now; per-person {Name}, {RefID}… are filled by the Outlook macro.
  function writeMailKit(zip, { subject, body, constants, rows, header }) {
    const sub = (s) => Object.entries(constants || {}).reduce((acc, [k, v]) => acc.split("{" + k + "}").join(v), s);
    const m = mail();
    zip.file("mail-list.csv", toCsv([header].concat(rows)));
    zip.file("email-subject.txt", "﻿" + sub(subject));
    zip.file("email-body.html", "﻿" + textToHtml(sub(body)));
    if (m.from) zip.file("email-from.txt", m.from);
    if (m.cc) zip.file("email-cc.txt", m.cc);
    zip.file("HOW-TO-SEND.txt",
      "1. Extract this ZIP to a folder.\r\n" +
      "2. In classic Outlook press Alt+F8, run SendBulkMail, and pick this folder.\r\n" +
      "3. Choose 'No' to save as Drafts first (recommended), or 'Yes' to send now.\r\n" +
      "(First time only: import outlook/BulkMailer.bas from the repo via Alt+F11 > File > Import File.)\r\n");
  }

  window.MMS = { $, $$, store, toast, download, safeName, uniqueNamer, toCsv, parsePeople, EMAIL_RE, mail, writeMailKit, showTab };

  document.addEventListener("DOMContentLoaded", () => {
    initMail();
    const t = store.get("tab", "certs");
    if (document.getElementById("tab-" + t)) showTab(t);
    if (!window.JSZip || !window.jspdf || !window.XLSX) {
      toast("Couldn't load helper libraries — check your internet connection and reload.", true);
    }
  });
})();
