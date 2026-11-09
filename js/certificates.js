/*
 * Certificates: one template per type, text boxes that wipe & replace the template's own text,
 * Excel/paste names, PNG/PDF ZIP.
 */
(function () {
  "use strict";
  const { $, store, toast, download, safeName, uniqueNamer, parsePeople, EMAIL_RE, mail, writeMailKit } = window.MMS;
  const E = window.CertEngine;

  const LAYER_DEFAULT = {
    x: 0, y: 0, w: 0, h: 0, text: "", font: "Montserrat", weight: 500, size: 4, spacing: 0,
    color: "#ffffff", align: "center", textCase: "title", lineHeight: 1.3, wrap: false, erase: "auto", eraseColor: "#ffffff",
  };
  let uid = 0, lid = 0;
  const savedLayouts = store.get("certLayouts", {}); // keyed by type label
  const groups = [];
  let active = null;
  let format = store.get("certFormat", "pdf");
  let mode = null; // {kind:'draw', layerId} | {kind:'pick', field}
  let drag = null;

  const canvas = $("#preview");
  const ctx = canvas.getContext("2d");

  // ---------- model ----------
  function newLayer(over) { return Object.assign({ id: ++lid }, LAYER_DEFAULT, over || {}); }
  function cloneLayers(ls) { return ls.map((l) => newLayer(Object.assign({}, l, { id: undefined }))); }

  function newGroup(label, copyFrom) {
    const saved = savedLayouts[label.toLowerCase()];
    const layers = saved && saved.length ? cloneLayers(saved)
      : copyFrom ? cloneLayers(copyFrom.layers)
      : [newLayer({ text: "{Name}" })];
    const g = { id: ++uid, label, img: null, imgName: "", layers, sel: null, clean: null, cleanKey: "", orig: null, text: "" };
    g.sel = g.layers[0].id;
    groups.push(g);
    return g;
  }
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/s$/, "");
  function findGroup(label) { return groups.find((g) => norm(g.label) === norm(label)); }
  function people(g) { return parsePeople(g.text).filter((p) => p.name); }
  function selLayer() { return active.layers.find((l) => l.id === active.sel) || null; }
  function drawn(l) { return l.w > 0 && l.h > 0; }

  function save() {
    groups.forEach((g) => (savedLayouts[g.label.toLowerCase()] = g.layers.map((l) => Object.assign({}, l))));
    store.set("certLayouts", savedLayouts);
    store.set("certGroups", groups.map((g) => g.label));
  }

  // ---------- rendering ----------
  function vars(name, g) {
    return { Name: name, Event: $("#certEvent").value.trim(), Category: g.label };
  }

  function eraseKey(g) {
    return g.imgName + "|" + JSON.stringify(g.layers.map((l) => [l.x, l.y, l.w, l.h, l.erase, l.eraseColor]));
  }

  // Template with the old text wiped — cached until boxes change.
  function cleanBase(g) {
    const key = eraseKey(g);
    if (g.clean && g.cleanKey === key) return g.clean;
    const W = g.img.naturalWidth, H = g.img.naturalHeight;
    const c = g.clean || document.createElement("canvas");
    c.width = W; c.height = H;
    const cx = c.getContext("2d", { willReadFrequently: true });
    cx.drawImage(g.img, 0, 0);
    E.eraseAll(cx, W, H, g.layers);
    g.clean = c; g.cleanKey = key;
    return c;
  }

  function original(g) {
    if (g.orig) return g.orig;
    const c = document.createElement("canvas");
    c.width = g.img.naturalWidth; c.height = g.img.naturalHeight;
    c.getContext("2d", { willReadFrequently: true }).drawImage(g.img, 0, 0);
    return (g.orig = c);
  }

  async function ensureFonts(layers) {
    try { await Promise.all(E.fontsOf(layers).map((f) => document.fonts.load(f, "Aa"))); } catch (e) { /* system font */ }
  }

  function render() {
    const g = active;
    const has = g && g.img;
    canvas.classList.toggle("show", !!has);
    $("#previewEmpty").hidden = !!has;
    $("#previewTitle").textContent = g ? `Preview — ${g.label}` : "Preview";
    if (!has) { $("#posInfo").textContent = ""; return; }
    const W = g.img.naturalWidth, H = g.img.naturalHeight;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    // while dragging, skip the (slower) wipe and show the original under the box
    ctx.drawImage(drag ? original(g) : cleanBase(g), 0, 0);
    const sample = $("#fSample").value.trim() || people(g)[0]?.name || "Participant Name";
    if (!drag) g.layers.forEach((l) => E.drawLayer(ctx, W, H, l, vars(sample, g)));
    if ($("#showBoxes").checked || drag || mode) drawOverlays(g, W, H);
    const L = selLayer();
    $("#posInfo").textContent = `${W}×${H}px` + (L && drawn(L) ? ` · box at ${Math.round(L.x * 100)}%, ${Math.round(L.y * 100)}%` : "");
  }

  function drawOverlays(g, W, H) {
    const u = Math.max(1.5, W / 900);
    g.layers.forEach((l, i) => {
      if (!drawn(l)) return;
      const sel = l.id === g.sel;
      const x = l.x * W, y = l.y * H, w = l.w * W, h = l.h * H;
      ctx.save();
      ctx.lineWidth = sel ? u * 2 : u;
      ctx.setLineDash(sel ? [] : [u * 5, u * 4]);
      ctx.strokeStyle = sel ? "#ff3d71" : "rgba(255,61,113,.7)";
      ctx.strokeRect(x, y, w, h);
      // label tag
      const tag = String(i + 1);
      const fs = Math.max(12, W / 70);
      ctx.font = `700 ${fs}px Inter, sans-serif`;
      ctx.fillStyle = sel ? "#ff3d71" : "rgba(255,61,113,.8)";
      ctx.fillRect(x, y - fs * 1.3, ctx.measureText(tag).width + fs * 0.8, fs * 1.3);
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.fillText(tag, x + fs * 0.4, y - fs * 0.65);
      if (sel) { const hs = handleSize(); ctx.fillStyle = "#ff3d71"; ctx.fillRect(x + w - hs / 2, y + h - hs / 2, hs, hs); }
      ctx.restore();
    });
  }

  function handleSize() { const r = canvas.getBoundingClientRect(); return Math.max(10, (14 * canvas.width) / Math.max(1, r.width)); }

  // ---------- side panel ----------
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

  function renderLayers() {
    const box = $("#layerList");
    box.innerHTML = "";
    active.layers.forEach((l, i) => {
      const b = document.createElement("button");
      b.className = "layer" + (l.id === active.sel ? " active" : "");
      b.innerHTML = `<span class="tag">${i + 1}</span><span class="txt"></span>${drawn(l) ? "" : '<span class="warn">draw box</span>'}`;
      b.children[1].textContent = l.text.replace(/\n/g, " ⏎ ") || "(empty)";
      b.addEventListener("click", () => {
        active.sel = l.id; renderLayers(); syncProps();
        if (!drawn(l) && active.img) startDraw(l);
        render();
      });
      box.appendChild(b);
    });
    $("#delLayer").disabled = !selLayer();
  }

  function syncProps() {
    const l = selLayer();
    $("#layerProps").classList.toggle("disabled", !l);
    if (!l) return;
    $("#lText").value = l.text;
    $("#lFont").value = l.font;
    $("#lWeight").value = String(l.weight);
    $("#lSize").value = Math.round(l.size * 10);
    $("#lSpace").value = Math.round(l.spacing * 100);
    $("#lColor").value = l.color;
    $("#lAlign").value = l.align;
    $("#lCase").value = l.textCase;
    $("#lLine").value = Math.round(l.lineHeight * 100);
    $("#lWrap").checked = l.wrap;
    $("#lErase").value = l.erase;
    $("#lEraseColor").value = l.eraseColor;
    $("#lEraseColorWrap").hidden = l.erase !== "color";
    labels();
  }
  function labels() {
    const l = selLayer(); if (!l) return;
    $("#lSizeVal").textContent = l.size.toFixed(1) + "%";
    $("#lSpaceVal").textContent = l.spacing.toFixed(2) + " em";
    $("#lLineVal").textContent = l.lineHeight.toFixed(2);
  }

  function syncGroup() {
    const g = active;
    $("#tplFor").textContent = "— " + g.label;
    $("#namesFor").textContent = "— " + g.label;
    $("#tplLabel").innerHTML = g.img ? `✔ ${escapeHtml(g.imgName)} <u>(change)</u>` : "Drop your PNG/JPG certificate here or <u>browse</u>";
    $("#tplDrop").classList.toggle("has", !!g.img);
    $("#namesBox").value = g.text;
    renderLayers(); syncProps(); updateStats();
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

  function select(g) {
    active = g; setMode(null); renderChips(); syncGroup();
    ensureFonts(g.layers).then(render);
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function setMode(m) {
    mode = m;
    canvas.classList.toggle("drawing", !!m);
    const hint = $("#drawHint");
    hint.hidden = !m;
    if (m && m.kind === "draw") hint.textContent = "✏️ Drag on the preview to draw a box over the old text (cover it fully, a little extra is fine)";
    if (m && m.kind === "pick") hint.textContent = "🎯 Click on the certificate to pick that colour";
  }
  function startDraw(l) {
    if (!active.img) { toast("Upload the template first.", true); return; }
    active.sel = l.id; setMode({ kind: "draw", layerId: l.id }); render();
    $("#previewBox").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ---------- template ----------
  function loadTemplate(file) {
    if (!file) return;
    if (!/image\/(png|jpe?g)/.test(file.type)) { toast("Please use a PNG or JPG image. (Export your design as PNG.)", true); return; }
    const img = new Image();
    img.onload = () => {
      active.img = img; active.imgName = file.name; active.clean = null; active.orig = null; active.cleanKey = "";
      renderChips(); syncGroup();
      ensureFonts(active.layers).then(render);
      const first = active.layers.find((l) => !drawn(l));
      if (first) { startDraw(first); toast("Now drag a box over the name on the template"); }
      else toast(`Template loaded for ${active.label} — boxes kept from last time`);
    };
    img.onerror = () => toast("Couldn't read that image.", true);
    img.src = URL.createObjectURL(file);
  }

  // After a box is drawn, copy the old text's look so the new text matches.
  function matchOldText(l) {
    const g = active;
    const octx = original(g).getContext("2d", { willReadFrequently: true });
    E.snapToInk(octx, g.img.naturalWidth, g.img.naturalHeight, l);
    const a = E.analyseRegion(octx, g.img.naturalWidth, g.img.naturalHeight, l);
    if (!a) return;
    if (a.color) l.color = a.color;
    if (a.lines > 1) { l.wrap = true; if (a.lineHeight) l.lineHeight = +a.lineHeight.toFixed(2); }
    if (a.sizePct) l.size = Math.max(0.5, +a.sizePct.toFixed(1));
    if (/\{name\}/i.test(l.text) && a.caps) l.textCase = "upper";
    if (a.lines === 1) l.wrap = /\{name\}/i.test(l.text) ? false : l.wrap;
  }

  // ---------- canvas interaction ----------
  function pt(e) {
    const r = canvas.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height), sx: canvas.width / r.width };
  }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  function hit(p) {
    const W = canvas.width, H = canvas.height, hs = handleSize();
    const order = active.layers.slice().sort((a, b) => (a.id === active.sel ? -1 : b.id === active.sel ? 1 : 0));
    for (const l of order) {
      if (!drawn(l)) continue;
      const px = p.x * W, py = p.y * H;
      const x1 = (l.x + l.w) * W, y1 = (l.y + l.h) * H;
      if (Math.abs(px - x1) <= hs && Math.abs(py - y1) <= hs) return { l, how: "resize" };
      if (px >= l.x * W && px <= x1 && py >= l.y * H && py <= y1) return { l, how: "move" };
    }
    return null;
  }

  function pickColor(p) {
    const W = canvas.width, H = canvas.height;
    const d = original(active).getContext("2d", { willReadFrequently: true }).getImageData(Math.min(W - 1, Math.round(p.x * W)), Math.min(H - 1, Math.round(p.y * H)), 1, 1).data;
    const hex = E.rgbToHex(d[0], d[1], d[2]);
    const l = selLayer(); if (!l) return;
    l[mode.field] = hex;
    setMode(null); syncProps(); save(); render();
    toast("Colour picked: " + hex);
  }

  function bindCanvas() {
    canvas.addEventListener("pointerdown", (e) => {
      if (!active.img) return;
      const p = pt(e);
      if (mode && mode.kind === "pick") { pickColor(p); return; }
      canvas.setPointerCapture(e.pointerId);
      if (mode && mode.kind === "draw") {
        const l = active.layers.find((x) => x.id === mode.layerId);
        drag = { how: "draw", l, sx: p.x, sy: p.y };
        Object.assign(l, { x: p.x, y: p.y, w: 0, h: 0 });
        return;
      }
      const h = hit(p);
      if (!h) return;
      active.sel = h.l.id; renderLayers(); syncProps();
      drag = { how: h.how, l: h.l, sx: p.x, sy: p.y, ox: h.l.x, oy: h.l.y, ow: h.l.w, oh: h.l.h };
      render();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!active.img) return;
      const p = pt(e);
      if (!drag) {
        if (mode) return;
        const h = hit(p);
        canvas.style.cursor = h ? (h.how === "resize" ? "nwse-resize" : "move") : "default";
        return;
      }
      const l = drag.l;
      if (drag.how === "draw") {
        l.x = Math.min(drag.sx, p.x); l.y = Math.min(drag.sy, p.y);
        l.w = Math.abs(p.x - drag.sx); l.h = Math.abs(p.y - drag.sy);
      } else if (drag.how === "move") {
        l.x = clamp01(drag.ox + p.x - drag.sx); l.y = clamp01(drag.oy + p.y - drag.sy);
        l.x = Math.min(l.x, 1 - l.w); l.y = Math.min(l.y, 1 - l.h);
      } else {
        l.w = Math.max(0.01, Math.min(1 - l.x, drag.ow + p.x - drag.sx));
        l.h = Math.max(0.005, Math.min(1 - l.y, drag.oh + p.y - drag.sy));
      }
      render();
    });
    const end = async () => {
      if (!drag) return;
      const d = drag; drag = null;
      if (d.how === "draw") {
        setMode(null);
        if (d.l.w < 0.01 || d.l.h < 0.005) { Object.assign(d.l, { w: 0, h: 0 }); toast("Box too small — drag a bigger box over the text.", true); }
        else { matchOldText(d.l); syncProps(); if (!d.l.text) setTimeout(() => $("#lText").focus(), 50); }
        renderLayers();
      }
      save();
      await ensureFonts(active.layers);
      render();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && mode) { setMode(null); render(); return; }
      const l = selLayer();
      if (!l || !drawn(l) || !/^Arrow/.test(e.key) || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (!$("#tab-certs").classList.contains("active")) return;
      e.preventDefault();
      const step = e.shiftKey ? 0.01 : 0.001;
      if (e.key === "ArrowLeft") l.x -= step;
      if (e.key === "ArrowRight") l.x += step;
      if (e.key === "ArrowUp") l.y -= step;
      if (e.key === "ArrowDown") l.y += step;
      l.x = clamp01(Math.min(l.x, 1 - l.w)); l.y = clamp01(Math.min(l.y, 1 - l.h));
      save(); render();
    });
  }

  // ---------- Excel ----------
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
          if (!g) g = newGroup(cat, active);
          if (!buckets.has(g)) buckets.set(g, []);
          buckets.get(g).push(email ? `${name}, ${email}` : name);
          count++;
        });
        if (!count) { toast("No names found. Make sure there's a 'Name' column.", true); return; }
        buckets.forEach((lines, g) => (g.text = lines.join("\n")));
        if (catCol >= 0) {
          for (let i = groups.length - 1; i >= 0; i--) if (!buckets.has(groups[i]) && !groups[i].img && !people(groups[i]).length && groups.length > 1) groups.splice(i, 1);
        }
        active = buckets.has(active) ? active : buckets.keys().next().value;
        save(); renderChips(); syncGroup(); render();
        toast(`Imported ${count} names: ${Array.from(buckets.entries()).map(([g, l]) => `${l.length} ${g.label}`).join(", ")}`);
      } catch (e) { console.error(e); toast("Couldn't read that file: " + e.message, true); }
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

  // ---------- generate ----------
  const tick = () => new Promise((r) => setTimeout(r, 0));

  async function generate() {
    const targets = ($("#allGroups").checked ? groups : [active]).filter((g) => people(g).length);
    if (!targets.length) { toast("Add some names first.", true); return; }
    const missing = targets.filter((g) => !g.img);
    if (missing.length) { toast(`Upload a template for: ${missing.map((g) => g.label).join(", ")}`, true); select(missing[0]); return; }
    const noName = targets.filter((g) => !g.layers.some((l) => drawn(l) && /\{name\}/i.test(l.text)));
    if (noName.length) { toast(`Draw a box with {Name} on: ${noName.map((g) => g.label).join(", ")}`, true); select(noName[0]); return; }

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
        await ensureFonts(g.layers);
        const W = g.img.naturalWidth, H = g.img.naturalHeight;
        const base = cleanBase(g);
        off.width = W; off.height = H;
        const namers = {};
        const nameLayer = g.layers.find((l) => /\{name\}/i.test(l.text)) || {};
        for (const p of people(g)) {
          oc.drawImage(base, 0, 0);
          g.layers.forEach((l) => E.drawLayer(oc, W, H, l, vars(p.name, g)));
          const display = E.caseName(p.name, nameLayer.textCase === "upper" ? "title" : nameLayer.textCase || "asis");
          const fileBase = safeName(display);
          let attachPath = "";
          for (const f of fmts) {
            const dir = (multi ? safeName(g.label) + "/" : "") + (fmts.length > 1 ? f.toUpperCase() + "/" : "");
            namers[dir] = namers[dir] || uniqueNamer();
            const file = dir + namers[dir](fileBase) + "." + f;
            if (f === "png") {
              zip.file(file, await new Promise((r) => off.toBlob(r, "image/png")), { compression: "STORE" });
            } else {
              const pdf = new jspdf.jsPDF({ orientation: W >= H ? "landscape" : "portrait", unit: "pt", format: [W * 0.75, H * 0.75], compress: true });
              pdf.addImage(off.toDataURL("image/jpeg", 0.93), "JPEG", 0, 0, W * 0.75, H * 0.75, undefined, "FAST");
              pdf.setProperties({ title: `${event ? event + " – " : ""}${display}` });
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
      download(await zip.generateAsync({ type: "blob" }), `${safeName(event || "Certificates")} - Certificates.zip`);
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
    bindCanvas();

    const props = {
      lText: (l, v) => (l.text = v), lFont: (l, v) => (l.font = v), lWeight: (l, v) => (l.weight = +v),
      lSize: (l, v) => (l.size = v / 10), lSpace: (l, v) => (l.spacing = v / 100), lColor: (l, v) => (l.color = v),
      lAlign: (l, v) => (l.align = v), lCase: (l, v) => (l.textCase = v), lLine: (l, v) => (l.lineHeight = v / 100),
      lErase: (l, v) => (l.erase = v), lEraseColor: (l, v) => (l.eraseColor = v),
    };
    Object.entries(props).forEach(([id, set]) => $("#" + id).addEventListener("input", async (e) => {
      const l = selLayer(); if (!l) return;
      set(l, e.target.value); labels();
      if (id === "lErase") $("#lEraseColorWrap").hidden = l.erase !== "color";
      if (id === "lText") renderLayers();
      save(); await ensureFonts(active.layers); render();
    }));
    $("#lWrap").addEventListener("change", (e) => { const l = selLayer(); if (!l) return; l.wrap = e.target.checked; save(); render(); });
    $("#lPick").addEventListener("click", () => { if (!active.img) return; setMode({ kind: "pick", field: "color" }); render(); });
    $("#lPickErase").addEventListener("click", () => { if (!active.img) return; setMode({ kind: "pick", field: "eraseColor" }); render(); });

    $("#addLayer").addEventListener("click", () => {
      const cur = selLayer();
      const l = newLayer(cur ? { font: cur.font, color: cur.color, weight: 400, wrap: true } : { wrap: true });
      active.layers.push(l); active.sel = l.id;
      renderLayers(); syncProps(); save();
      startDraw(l);
    });
    $("#delLayer").addEventListener("click", () => {
      const l = selLayer(); if (!l) return;
      active.layers = active.layers.filter((x) => x !== l);
      active.sel = active.layers[0] ? active.layers[0].id : null;
      setMode(null); renderLayers(); syncProps(); save(); render();
    });
    $("#fSample").addEventListener("input", render);
    $("#showBoxes").addEventListener("change", render);
    $("#certEvent").addEventListener("input", render);

    $("#namesBox").addEventListener("input", (e) => { active.text = e.target.value; updateStats(); renderChips(); render(); });
    $("#xlsInput").addEventListener("change", (e) => { if (e.target.files[0]) importSheet(e.target.files[0]); e.target.value = ""; });
    $("#sampleXls").addEventListener("click", sampleSheet);

    $("#addGroup").addEventListener("click", () => {
      const label = (prompt("Name of the certificate type (e.g. Winner, Runner-up, Participant):") || "").trim();
      if (!label) return;
      if (findGroup(label)) { toast("That type already exists."); select(findGroup(label)); return; }
      const g = newGroup(label, active);
      save(); select(g);
    });
    $("#renameGroup").addEventListener("click", () => {
      const label = (prompt("Rename type:", active.label) || "").trim();
      if (!label || label === active.label) return;
      active.label = label; save(); renderChips(); syncGroup(); render();
    });
    $("#removeGroup").addEventListener("click", () => {
      if (groups.length < 2) return;
      if (people(active).length && !confirm(`Remove "${active.label}" and its ${people(active).length} names?`)) return;
      groups.splice(groups.indexOf(active), 1);
      save(); select(groups[0]);
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
    store.get("certGroups", ["Participant"]).forEach((l) => newGroup(l));
    active = groups[0];
    bind();
    renderChips(); syncGroup(); render();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(render);
  });
})();
