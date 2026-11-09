/*
 * Voucher Word builder.
 * Takes the original Hexaware template (.docx), keeps its styles, fonts, logo and
 * Krishna's signature, and rewrites the body: one page per voucher.
 * Works in the browser (global JSZip) and in Node (pass JSZip in) for testing.
 */
(function (root) {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // "Thank you for **{event}**" -> runs with bold where ** ** is used.
  function runsXml(text, baseBold) {
    const parts = String(text).split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== "");
    return parts.map((p) => {
      const bold = baseBold || /^\*\*[^*]+\*\*$/.test(p);
      const t = /^\*\*[^*]+\*\*$/.test(p) ? p.slice(2, -2) : p;
      const rPr = bold ? "<w:rPr><w:b/><w:bCs/></w:rPr>" : "";
      return `<w:r>${rPr}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
    }).join("");
  }

  function para(text, opts) {
    opts = opts || {};
    const pPr = opts.bold ? "<w:pPr><w:rPr><w:b/><w:bCs/></w:rPr></w:pPr>" : "";
    if (!text) return `<w:p>${pPr}</w:p>`;
    return `<w:p>${pPr}${runsXml(text, !!opts.bold)}</w:p>`;
  }

  // Fill in placeholders. {event} is always bold, like the original letter.
  function fill(text, v, data) {
    return String(text)
      .replace(/\{event\}/gi, data.eventName ? `**${data.eventName}**` : "")
      .replace(/\{brand\}/gi, data.brand || "")
      .replace(/\{amount\}/gi, v ? v.amount : "")
      .replace(/\{expiry\}/gi, v ? v.expiry : "");
  }

  const CELL_MAR = '<w:tcMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tcMar>';
  const WIDTHS = [760, 2350, 2250, 3065, 1200];

  function cell(text, i, header) {
    const b = 'w:val="single" w:sz="8" w:space="0" w:color="auto"';
    const borders = `<w:tcBorders><w:top ${header ? b : 'w:val="nil"'}/><w:left ${i === 0 ? b : 'w:val="nil"'}/><w:bottom ${b}/><w:right ${b}/></w:tcBorders>`;
    const shd = header ? '<w:shd w:val="clear" w:color="auto" w:fill="70AD47"/>' : "";
    const rPr = header ? '<w:rPr><w:b/><w:bCs/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>' : '<w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>';
    return `<w:tc><w:tcPr><w:tcW w:w="${WIDTHS[i]}" w:type="dxa"/>${borders}${shd}${CELL_MAR}<w:vAlign w:val="center"/></w:tcPr>` +
      `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr><w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p></w:tc>`;
  }

  function tableXml(v, sno, headers) {
    const row = (cells, header) =>
      `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="301"/></w:trPr>${cells.map((c, i) => cell(c, i, header)).join("")}</w:tr>`;
    return `<w:tbl><w:tblPr><w:tblW w:w="9625" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>` +
      `<w:tblGrid>${WIDTHS.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>` +
      row(headers, true) + row([String(sno), v.ref, v.pin, v.expiry, v.amount], false) + `</w:tbl>`;
  }

  // Pull the logo paragraph (anchored image) and signature paragraph out of the template.
  function extractPieces(docXml) {
    const paras = docXml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
    const logo = paras.find((p) => p.includes("<wp:anchor"));
    const sig = paras.find((p) => p.includes("<wp:inline"));
    if (!logo || !sig) throw new Error("Template is missing the logo or signature image.");
    return { logo, sig };
  }

  let idCounter = 1000;
  function uniqueIds(xml) {
    // Each copied picture needs its own drawing id or Word may report the file as damaged.
    return xml.replace(/(<wp:docPr id=")\d+/g, (m, a) => a + (++idCounter))
      .replace(/(<pic:cNvPr id=")\d+/g, (m, a) => a + idCounter)
      .replace(/ wp14:anchorId="[0-9A-F]+"/g, "").replace(/ wp14:editId="[0-9A-F]+"/g, "")
      .replace(/ w14:paraId="[0-9A-F]+"/g, "").replace(/ w14:textId="[0-9A-F]+"/g, "");
  }

  function pageBreakBefore(logoXml) {
    return logoXml.replace("<w:pPr>", "<w:pPr><w:pageBreakBefore/>");
  }

  function blockXml(v, index, data, pieces) {
    let logo = uniqueIds(pieces.logo);
    if (index > 0) logo = pageBreakBefore(logo);
    const out = [logo, para(""), para(fill(data.greeting, v, data), { bold: true })];
    data.paragraphs.forEach((p) => out.push(para(fill(p, v, data))));
    const sno = data.serialMode === "running" ? index + 1 : 1;
    out.push(tableXml(v, sno, data.headers));
    if (data.closing) {
      out.push(para(""));
      data.closing.forEach((p) => out.push(para(fill(p, v, data))));
    }
    out.push(para(""), para(""));
    out.push(uniqueIds(pieces.sig));
    out.push(para(data.signName, { bold: true }));
    out.push(para(data.signTitle, { bold: true }));
    return out.join("");
  }

  /**
   * data = { eventName, brand, greeting, paragraphs[], closing[], signName, signTitle,
   *          headers[5], serialMode: "one"|"running" }
   * vouchers = [{ref, pin, expiry, amount}]
   * returns Promise<Blob|Buffer>
   */
  async function buildVoucherDocx(JSZip, templateBytes, data, vouchers, outType) {
    const zip = await JSZip.loadAsync(templateBytes);
    const docXml = await zip.file("word/document.xml").async("string");
    const pieces = extractPieces(docXml);
    const start = docXml.indexOf("<w:body>") + "<w:body>".length;
    const sectIdx = docXml.lastIndexOf("<w:sectPr");
    const body = vouchers.map((v, i) => blockXml(v, i, data, pieces)).join("");
    const newXml = docXml.slice(0, start) + body + docXml.slice(sectIdx);
    zip.file("word/document.xml", newXml);
    // Fresh document properties (title) so the file doesn't carry the old event's name.
    const core = zip.file("docProps/core.xml");
    if (core) {
      let c = await core.async("string");
      c = c.replace(/<dc:title>[\s\S]*?<\/dc:title>/, "").replace(/<dc:title\/>/, "");
      zip.file("docProps/core.xml", c);
    }
    return zip.generateAsync({
      type: outType || "blob",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      compression: "DEFLATE",
    });
  }

  // ---------- Paste parser ----------
  const REF_RE = /^(?=.*[A-Z])[A-Z0-9]{3,}(?:-[A-Z0-9]{2,})+$/i;

  function parseVouchers(text) {
    const tokens = String(text || "").split(/[\t\r\n]+/).map((t) => t.trim()).filter(Boolean);
    const out = [];
    const problems = [];
    for (let i = 0; i < tokens.length; i++) {
      if (!REF_RE.test(tokens[i])) continue;
      const v = { ref: tokens[i], pin: tokens[i + 1] || "", expiry: tokens[i + 2] || "", amount: tokens[i + 3] || "" };
      const issues = [];
      if (!/^\d{6,}$/.test(v.pin.replace(/\s/g, ""))) issues.push("PIN doesn't look numeric");
      if (!/\d{4}|\d{1,2}[\/\-.]\d{1,2}/.test(v.expiry)) issues.push("expiry date missing");
      if (!/^[₹$]?\s?[\d,]+(\.\d+)?$/.test(v.amount)) issues.push("amount missing");
      v.issues = issues;
      if (issues.length) problems.push(`Row ${out.length + 1} (${v.ref}): ${issues.join(", ")}`);
      out.push(v);
      i += 3;
    }
    return { vouchers: out, problems };
  }

  function simplifyExpiry(s) {
    const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return s;
    const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m[2] - 1];
    return `${m[3]}-${mon}-${m[1]}`;
  }

  const api = { buildVoucherDocx, parseVouchers, simplifyExpiry, runsXml };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VoucherDocx = api;
})(typeof window !== "undefined" ? window : globalThis);
