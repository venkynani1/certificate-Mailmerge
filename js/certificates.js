/*
 * Certificates — Canva-style editor.
 * Upload a finished certificate PNG; the app finds every piece of text on it. Click a text to select,
 * double-click to type over it right on the certificate. Edited text is wiped from the design (background
 * rebuilt to match) and redrawn; untouched text stays pixel-perfect. Then names -> PNG/PDF ZIP.
 */
(function () {
  "use strict";
  const { $, store, toast, download, safeName, uniqueNamer, parsePeople, EMAIL_RE, mail, writeMailKit } = window.MMS;
  const E = window.CertEngine;

  const LAYER_DEFAULT = {
    x: 0, y: 0, w: 0, h: 0, ex: 0, ey: 0, ew: 0, eh: 0, text: "", orig: "", edited: true, auto: false,
    font: "Montserrat", weight: 500, size: 4, spacing: 0, color: "#ffffff", align: "center",
    textCase: "title", lineHeight: 1.3, wrap: false, erase: "auto", eraseColor: "#ffffff",
  };
  const NAME_HINT = /award|present|certif(y|ies)\s+that|conferred|recogni[sz]|this is to/i;
  let uid = 0, lid = 0;
  const savedLayouts = store.get("certLayouts2", {});
  const groups = [];
  let active = null;
  let format = store.get("certFormat", "pdf");
  let mode = null;        // {kind:'draw', layerId} | {kind:'pick', field}
  let drag = null;
  let hoverId = null;
  let editing = null;     // {l, before, wasEdited}

  const canvas = $("#preview");
  const ctx = canvas.getContext("2d");
  const stage = $("#stage");
  const editor = $("#inlineEdit");
  const bar = $("#floatBar");

  // ---------- model ----------
  function newLayer(over) { return Object.assign({}, LAYER_DEFAULT, over || {}, { id: ++lid }); }
  function newGroup(label) {
    const g = { id: ++uid, label, img: null, imgName: "", layers: [], sel: null, clean: null, cleanKey: "", orig: null, text: "", detecting: false };
    groups.push(g);
    return g;
  }
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/s$/, "");
  function findGroup(label) { return groups.find((g) => norm(g.label) === norm(label)); }
  function people(g) { return parsePeople(g.text).filter((p) => p.name); }
  function selLayer() { return active && active.layers.find((l) => l.id === active.sel) || null; }
  function hasBox(l) { return l.w > 0 && l.h > 0; }
  const isName = (l) => /\{name\}/i.test(l.text) && l.edited;

  function save() {
    groups.forEach((g) => {
      if (!g.img) return;
      savedLayouts[g.label.toLowerCase()] = g.layers.filter((l) => l.edited).map((l) => Object.assign({}, l));
    });
    store.set("certLayouts2", savedLayouts);
    store.set("certGroups", groups.map((g) => g.label));
  }

  // ---------- canvases ----------
  function original(g) {
    if (g.orig) return g.orig;
    const c = document.createElement("canvas");
    c.width = g.img.naturalWidth; c.height = g.img.naturalHeight;
    c.getContext("2d", { willReadFrequently: true }).drawImage(g.img, 0, 0);
    return (g.orig = c);
  }
  function eraseRegions(g) {
    return g.layers.filter((l) => l.edited && l.erase !== "none").map((l) => ({
      x: l.ew ? l.ex : l.x, y: l.ew ? l.ey : l.y, w: l.ew || l.w, h: l.eh || l.h, erase: l.erase, eraseColor: l.eraseColor,
    }));
  }
  function cleanBase(g) {
    const regions = eraseRegions(g);
    const key = g.imgName + "|" + JSON.stringify(regions);
    if (g.clean && g.cleanKey === key) return g.clean;
    const W = g.img.naturalWidth, H = g.img.naturalHeight;
    const c = g.clean || document.createElement("canvas");
    c.width = W; c.height = H;
    const cx = c.getContext("2d", { willReadFrequently: true });
    cx.drawImage(g.img, 0, 0);
    E.eraseAll(cx, W, H, regions);
    g.clean = c; g.cleanKey = key;
    return c;
  }
  async function ensureFonts(layers) {
    try { await Promise.all(E.fontsOf(layers).map((f) => document.fonts.load(f, "Aa"))); } catch (e) { /* system font */ }
  }
  function vars(name, g) { return { Name: name, Event: $("#certEvent").value.trim(), Category: g.label }; }

  // ---------- render ----------
  function render() {
    const g = active;
    const has = !!(g && g.img);
    stage.classList.toggle("show", has);
    $("#previewEmpty").hidden = has;
    $("#previewTitle").textContent = "Preview";
    if (!has) { $("#posInfo").textContent = ""; placeUi(); return; }
    const W = g.img.naturalWidth, H = g.img.naturalHeight;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    ctx.drawImage(cleanBase(g), 0, 0);
    const sample = $("#fSample").value.trim() || people(g)[0]?.name || "Participant Name";
    g.layers.forEach((l) => { if (!editing || editing.l !== l) E.drawLayer(ctx, W, H, l, vars(sample, g)); });
    drawOverlays(g, W, H);
    const L = selLayer();
    $("#posInfo").textContent = g.detecting ? "Reading text…" : `${W}×${H}px` + (L ? ` · ${L.edited ? "edited" : "original"} text selected` : " · click any text to edit");
    placeUi();
  }

  function drawOverlays(g, W, H) {
    const u = Math.max(1.5, W / 900);
    const showAll = $("#showBoxes").checked;
    g.layers.forEach((l) => {
      if (!hasBox(l)) return;
      const sel = l.id === g.sel, hov = l.id === hoverId;
      if (!sel && !hov && !(showAll && l.edited) && !mode) return;
      if (editing && editing.l === l) return;
      const x = l.x * W, y = l.y * H, w = l.w * W, h = l.h * H;
      ctx.save();
      ctx.lineWidth = sel ? u * 2 : u * 1.4;
      ctx.setLineDash(sel ? [] : [u * 5, u * 4]);
      ctx.strokeStyle = sel ? "#ff3d71" : hov ? "rgba(255,61,113,.95)" : "rgba(255,61,113,.45)";
      ctx.strokeRect(x - u * 2, y - u * 2, w + u * 4, h + u * 4);
      if (sel && l.edited) { const hs = handleSize(); ctx.fillStyle = "#ff3d71"; ctx.fillRect(x + w - hs / 2, y + h - hs / 2, hs, hs); }
      ctx.restore();
    });
  }
  function handleSize() { const r = canvas.getBoundingClientRect(); return Math.max(10, (14 * canvas.width) / Math.max(1, r.width)); }

  // Floating toolbar + inline editor sit on top of the canvas, in CSS pixels.
  function placeUi() {
    const l = selLayer();
    const show = !!(l && active.img && hasBox(l) && !mode && !drag);
    bar.hidden = !show;
    if (!show) { if (editing) commitEdit(); return; }
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    const bx = l.x * cw, by = l.y * ch, bw = l.w * cw, bh = l.h * ch;
    bar.classList.toggle("editing", !!editing);
    bar.classList.toggle("is-edited", !!l.edited);
    $("#fbColor").value = l.color;
    const above = by > 52;
    bar.style.left = Math.min(Math.max(bx + bw / 2, 150), cw - 150) + "px";
    bar.style.top = (above ? by - 10 : by + bh + 10 + 40) + "px";
    if (editing) {
      const scale = cw / canvas.width;
      const px = (l.size / 100) * canvas.height * scale;
      Object.assign(editor.style, {
        left: bx + "px", top: by + "px", width: bw + "px", minHeight: bh + "px",
        fontFamily: `"${l.font}", sans-serif`, fontWeight: l.weight, fontSize: px + "px", color: l.color,
        letterSpacing: l.spacing + "em", lineHeight: l.lineHeight, textAlign: l.align,
        alignItems: l.align === "left" ? "flex-start" : l.align === "right" ? "flex-end" : "center",
        whiteSpace: l.wrap ? "pre-wrap" : "pre",
      });
    }
  }

  // ---------- making a block editable ----------
  // First time a detected text is touched: cover it fully, remember where to wipe, copy its look.
  function prepare(l) {
    if (l.edited) return;
    const g = active, W = g.img.naturalWidth, H = g.img.naturalHeight;
    const octx = original(g).getContext("2d", { willReadFrequently: true });
    E.snapToInk(octx, W, H, l);
    Object.assign(l, { ex: l.x, ey: l.y, ew: l.w, eh: l.h });
    const a = E.analyseRegion(octx, W, H, l);
    if (a) {
      if (a.color) l.color = a.color;
      if (a.sizePct) l.size = Math.max(0.5, +a.sizePct.toFixed(1));
      if (a.lines > 1) { l.wrap = true; if (a.lineHeight) l.lineHeight = +a.lineHeight.toFixed(2); }
      if (a.caps) l.textCase = "upper";
    }
    if (!l.text) l.text = l.orig;
    matchSpacing(l, W, H, a);
    l.edited = true;
  }

  // Spaced-out headings (e.g. "V E N K A T E S H"): compare the original width with the
  // natural width of the same words and turn the difference into letter spacing.
  const measureCtx = document.createElement("canvas").getContext("2d");
  function matchSpacing(l, W, H, a) {
    if (!l.orig || !a || a.lines !== 1) return;
    const px = (l.size / 100) * H;
    const text = l.textCase === "upper" ? l.orig.toUpperCase() : l.orig;
    measureCtx.font = `${l.weight} ${px}px "${l.font}"`;
    if ("letterSpacing" in measureCtx) measureCtx.letterSpacing = "0px";
    const natural = measureCtx.measureText(text).width;
    const target = l.ew * W - Math.max(4, H * 0.004);
    const gaps = Math.max(1, text.length - 1);
    const sp = (target - natural) / gaps / px;
    if (sp > 0.05) l.spacing = +Math.min(0.9, sp).toFixed(2);
  }

  // ---------- inline editing ----------
  const escHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  function toHtml(markup) {
    let out = "", bold = false, sup = false;
    const s = String(markup);
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "*" && s[i + 1] === "*") { out += bold ? "</b>" : "<b>"; bold = !bold; i++; continue; }
      if (s[i] === "^") { out += sup ? "</sup>" : "<sup>"; sup = !sup; continue; }
      if (s[i] === "\n") { out += "<br>"; continue; }
      out += escHtml(s[i]);
    }
    if (sup) out += "</sup>"; if (bold) out += "</b>";
    return out;
  }
  function fromHtml(rootEl) {
    const walk = (node) => {
      if (node.nodeType === 3) return node.nodeValue.replace(/ /g, " ");
      if (node.nodeType !== 1) return "";
      const tag = node.tagName;
      if (tag === "BR") return "\n";
      let inner = Array.from(node.childNodes).map(walk).join("");
      const fws = node.style ? node.style.fontWeight : "";
      const fw = fws === "bold" || fws === "bolder" ? 700 : parseInt(fws, 10);
      const unbold = fws === "normal" || (fw && fw < 600);
      if ((tag === "B" || tag === "STRONG" || fw >= 600) && !unbold && inner.trim()) {
        // keep spaces outside the ** markers so words don't run together
        const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
        inner = m[1] + "**" + m[2] + "**" + m[3];
      }
      if ((tag === "SUP" || (node.style && node.style.verticalAlign === "super")) && inner.trim()) inner = "^" + inner.trim() + "^";
      if ((tag === "DIV" || tag === "P") && node !== rootEl && node.previousSibling) inner = "\n" + inner;
      return inner;
    };
    return walk(rootEl).replace(/\*\*\*\*/g, "").replace(/\n+$/, "").replace(/\^\^/g, "");
  }

  async function startEdit(l) {
    if (!l || !active.img) return;
    if (editing && editing.l !== l) commitEdit();
    if (editing) return;
    const wasEdited = l.edited;
    prepare(l);
    editing = { l, before: l.text, wasEdited };
    active.sel = l.id;
    editor.innerHTML = toHtml(l.text);
    editor.hidden = false;
    try { document.execCommand("styleWithCSS", false, false); } catch (e) { /* older browsers */ }
    await ensureFonts(active.layers);
    render(); renderLayers(); syncProps();
    editor.focus();
    const r = document.createRange(); r.selectNodeContents(editor);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function commitEdit(cancel) {
    if (!editing) return;
    const { l, before, wasEdited } = editing;
    const text = cancel ? before : fromHtml(editor).trim();
    editing = null;
    editor.hidden = true;
    l.text = text;
    if (!wasEdited && (cancel || norm(text) === norm(l.orig))) restore(l, true);
    updateEvent(active);
    save(); renderLayers(); syncProps(); render();
  }
  function restore(l, silent) {
    if (!l || !l.auto) return;
    Object.assign(l, { edited: false, text: l.orig, x: l.ex || l.x, y: l.ey || l.y, w: l.ew || l.w, h: l.eh || l.h });
    if (!silent) { save(); renderLayers(); syncProps(); render(); }
  }
  function makeName(l) {
    if (!l) return;
    if (editing && editing.l === l) { document.execCommand("insertText", false, "{Name}"); return; }
    prepare(l);
    const caps = l.textCase === "upper" || (l.orig && l.orig === l.orig.toUpperCase());
    Object.assign(l, { text: "{Name}", wrap: false, textCase: caps ? "upper" : "title" });
    // longer names need room: widen the text area around the same centre (the wiped area stays put)
    const cx = l.x + l.w / 2, nw = Math.min(0.9, Math.max(l.w * 1.3, 0.5));
    l.w = Math.min(nw, 2 * Math.min(cx, 1 - cx)); l.x = cx - l.w / 2;
    save(); renderLayers(); syncProps(); ensureFonts(active.layers).then(render);
    toast("This is now the name — each certificate gets its own name here");
  }

  editor.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); commitEdit(true); }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitEdit(); }
    if (e.key === "Enter" && editing && !editing.l.wrap && !e.shiftKey) { e.preventDefault(); commitEdit(); }
  });
  editor.addEventListener("blur", () => setTimeout(() => { if (editing && !bar.contains(document.activeElement) && document.activeElement !== editor) commitEdit(); }, 120));
  editor.addEventListener("paste", (e) => { e.preventDefault(); document.execCommand("insertText", false, (e.clipboardData || window.clipboardData).getData("text")); });

  bar.addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); }); // keep editor focus
  bar.addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const l = selLayer(); if (!l) return;
    const act = b.dataset.act;
    if (act === "edit") return startEdit(l);
    if (act === "name") return makeName(l);
    if (act === "bold") { document.execCommand("bold"); return; }
    if (act === "sup") { document.execCommand("superscript"); return; }
    if (act === "done") return commitEdit();
    if (act === "restore") { if (editing) commitEdit(true); return restore(l); }
    if (act === "bigger" || act === "smaller") {
      prepare(l); l.size = +(l.size * (act === "bigger" ? 1.08 : 0.92)).toFixed(2);
      save(); syncProps(); await ensureFonts(active.layers); render();
    }
  });
  $("#fbColor").addEventListener("input", (e) => {
    const l = selLayer(); if (!l) return;
    prepare(l); l.color = e.target.value; save(); syncProps();
    if (editing) editor.style.color = l.color; else render();
  });

  // ---------- side panel ----------
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function renderChips() {
    const box = $("#groupChips");
    if (!box) return;
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
    if ($("#removeGroup")) $("#removeGroup").disabled = groups.length < 2;
  }

  function renderLayers() {
    const box = $("#layerList");
    box.innerHTML = "";
    active.layers.forEach((l) => {
      const b = document.createElement("button");
      b.className = "layer" + (l.id === active.sel ? " active" : "") + (l.edited ? "" : " untouched");
      const badge = isName(l) ? '<span class="badge name">Name</span>' : l.edited ? '<span class="badge edited">Edited</span>' : "";
      b.innerHTML = `<span class="txt"></span>${badge}${hasBox(l) ? "" : '<span class="warn">draw box</span>'}`;
      b.children[0].textContent = (l.edited ? l.text : l.orig).replace(/\*\*|\^/g, "").replace(/\n/g, " ") || "(empty)";
      b.title = l.edited && l.orig ? "Original: " + l.orig : "";
      b.addEventListener("click", () => { if (editing) commitEdit(); active.sel = l.id; setMode(null); renderLayers(); syncProps(); render(); if (!hasBox(l)) startDraw(l); });
      b.addEventListener("dblclick", () => startEdit(l));
      box.appendChild(b);
    });
    const l = selLayer();
    $("#delLayer").disabled = !l;
    $("#makeName").disabled = !l;
    $("#restoreLayer").disabled = !(l && l.auto && l.edited);
  }

  function syncProps() {
    const l = selLayer();
    $("#layerProps").classList.toggle("disabled", !l);
    if (!l) return;
    $("#lText").value = l.edited ? l.text : l.orig;
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

  // Event name = the text between quotes on the certificate, e.g. participating in “Mavericks AI Edge…”
  let eventTouched = false;
  function plain(t) { return String(t || "").replace(/\*\*|\^/g, ""); }
  function quotedEvent(g) {
    const texts = g.layers.map((l) => plain(l.edited ? l.text : l.orig));
    for (const t of texts) {
      const m = t.match(/["“”„«»'‘’]{1,2}\s*([^"“”„«»]{3,}?)\s*["“”„«»]/);
      if (m) {
        return m[1].replace(/\bAl\b/g, "AI").replace(/\s+:/g, " :").replace(/\s{2,}/g, " ").replace(/[.,;]+$/, "").trim();
      }
    }
    return "";
  }
  function updateEvent(g) {
    if (eventTouched) return;
    const ev = quotedEvent(g);
    if (!ev) return;
    const input = $("#certEvent");
    if (input.value !== ev) { input.value = ev; store.set("certEvent", ev); }
  }

  function setStatus(text, kind) {
    const el = $("#ocrStatus");
    el.textContent = text;
    el.className = "ocr-status" + (kind ? " " + kind : "");
  }

  function syncGroup() {
    const g = active;
    $("#tplLabel").innerHTML = g.img ? `✔ ${escapeHtml(g.imgName)} <u>(change)</u>` : "Drop your PNG/JPG certificate here or <u>browse</u>";
    $("#tplDrop").classList.toggle("has", !!g.img);
    $("#namesBox").value = g.text;
    if (!g.img) setStatus("Upload a template — the app finds all the text on it.");
    else if (!g.detecting) setStatus(statusText(g), "ok");
    renderLayers(); syncProps(); updateStats();
  }
  function statusText(g) {
    const n = g.layers.filter((l) => l.auto).length;
    const named = g.layers.some(isName);
    return (n ? `Found ${n} text blocks. ` : "") + (named ? "✔ Name field set. Click any other text (title, date…) to change it." : "Click the name on the certificate, then press 👤 Name.");
  }

  function updateStats() {
    const list = people(active);
    const withMail = list.filter((p) => p.email).length;
    const dupes = list.length - new Set(list.map((p) => p.name.toLowerCase())).size;
    let html = list.length ? `<span class="ok">${list.length} names</span> · ${withMail} with email` : "No names yet";
    if (dupes) html += ` · <span class="warn">${dupes} duplicate name(s) — files get (2), (3)…</span>`;
    $("#namesStats").innerHTML = html;
  }

  function select(g) {
    if (editing) commitEdit();
    active = g; setMode(null); renderChips(); syncGroup();
    ensureFonts(g.layers).then(render);
  }

  function setMode(m) {
    mode = m;
    canvas.classList.toggle("drawing", !!m);
    const hint = $("#drawHint");
    hint.hidden = !m;
    if (m && m.kind === "draw") hint.textContent = "✏️ Drag on the certificate to draw a box over the text (Esc to cancel)";
    if (m && m.kind === "pick") hint.textContent = "🎯 Click on the certificate to pick that colour";
  }
  function startDraw(l) {
    if (!active.img) { toast("Upload the template first.", true); return; }
    if (editing) commitEdit();
    active.sel = l.id; setMode({ kind: "draw", layerId: l.id }); render();
  }

  // ---------- template + text detection ----------
  function iou(a, b) {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const inter = ix * iy, uni = a.w * a.h + b.w * b.h - inter;
    return uni > 0 ? inter / uni : 0;
  }

  async function detectText(g) {
    g.detecting = true;
    setStatus("🔍 Reading the text on your certificate… (first time takes ~10 seconds)", "busy");
    render();
    let blocks = [];
    try { blocks = await window.TextDetect.detect(g.img); }
    catch (e) { console.error(e); }
    g.detecting = false;
    const saved = (savedLayouts[g.label.toLowerCase()] || []);
    g.layers = blocks.map((b) => newLayer({
      x: b.x, y: b.y, w: b.w, h: b.h, text: b.text, orig: b.text, edited: false, auto: true,
      align: b.align, wrap: b.lines > 1, weight: 500,
    }));
    // bring back edits from last time when the same design is uploaded again
    const used = new Set();
    saved.forEach((s) => {
      const region = { x: s.ew ? s.ex : s.x, y: s.ew ? s.ey : s.y, w: s.ew || s.w, h: s.eh || s.h };
      const match = g.layers.find((l) => !used.has(l) && iou(l, region) > 0.3);
      if (match) {
        used.add(match);
        Object.assign(match, Object.assign({}, s, { id: match.id, orig: match.orig, auto: true }));
      } else if (!s.auto) g.layers.push(newLayer(Object.assign({}, s, { id: undefined })));
    });
    // guess the name: the short line right after "awarded to / presented to / certify that"
    if (!g.layers.some(isName)) {
      const byY = g.layers.filter((l) => l.auto).sort((a, b) => a.y - b.y);
      const i = byY.findIndex((l) => NAME_HINT.test(l.orig));
      const cand = i >= 0 ? byY.slice(i + 1).find((l) => l.orig.split(/\s+/).length <= 5 && !NAME_HINT.test(l.orig)) : null;
      if (cand) {
        const prev = active; active = g; makeName(cand); active = prev;
        g.sel = cand.id;
        toast(`Set “${cand.orig}” as the name. Click other text (title, date) to change it.`);
      }
    }
    if (!blocks.length) setStatus("Couldn't read the text automatically. Use “+ Add text box” and drag over the text you want to change.", "");
    eventTouched = false;
    updateEvent(g);
    if (g === active) { syncGroup(); await ensureFonts(g.layers); render(); }
    save();
  }

  function loadTemplate(file) {
    if (!file) return;
    if (!/image\/(png|jpe?g)/.test(file.type)) { toast("Please use a PNG or JPG image. (In Canva: Share ▸ Download ▸ PNG.)", true); return; }
    if (editing) commitEdit(true);
    const img = new Image();
    img.onload = () => {
      const g = active;
      Object.assign(g, { img, imgName: file.name, clean: null, orig: null, cleanKey: "", layers: [], sel: null });
      renderChips(); syncGroup(); render();
      detectText(g);
    };
    img.onerror = () => toast("Couldn't read that image.", true);
    img.src = URL.createObjectURL(file);
  }

  // ---------- canvas interaction ----------
  function pt(e) {
    const r = canvas.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  function hit(p) {
    const W = canvas.width, H = canvas.height, hs = handleSize(), pad = hs * 0.4;
    const sel = selLayer();
    if (sel && sel.edited && hasBox(sel)) {
      const x1 = (sel.x + sel.w) * W, y1 = (sel.y + sel.h) * H;
      if (Math.abs(p.x * W - x1) <= hs && Math.abs(p.y * H - y1) <= hs) return { l: sel, how: "resize" };
    }
    const inside = active.layers.filter((l) => hasBox(l) &&
      p.x * W >= l.x * W - pad && p.x * W <= (l.x + l.w) * W + pad && p.y * H >= l.y * H - pad && p.y * H <= (l.y + l.h) * H + pad);
    if (!inside.length) return null;
    inside.sort((a, b) => (a.id === active.sel ? -1 : b.id === active.sel ? 1 : a.w * a.h - b.w * b.h));
    return { l: inside[0], how: "move" };
  }

  function pickColor(p) {
    const W = canvas.width, H = canvas.height;
    const d = original(active).getContext("2d", { willReadFrequently: true })
      .getImageData(Math.min(W - 1, Math.round(p.x * W)), Math.min(H - 1, Math.round(p.y * H)), 1, 1).data;
    const l = selLayer(); if (!l) return;
    prepare(l);
    l[mode.field] = E.rgbToHex(d[0], d[1], d[2]);
    setMode(null); syncProps(); save(); render();
  }

  function bindCanvas() {
    canvas.addEventListener("pointerdown", (e) => {
      if (!active.img || active.detecting) return;
      const p = pt(e);
      if (mode && mode.kind === "pick") { pickColor(p); return; }
      if (mode && mode.kind === "draw") {
        canvas.setPointerCapture(e.pointerId);
        const l = active.layers.find((x) => x.id === mode.layerId);
        drag = { how: "draw", l, sx: p.x, sy: p.y };
        Object.assign(l, { x: p.x, y: p.y, w: 0, h: 0 });
        return;
      }
      const h = hit(p);
      if (editing && (!h || h.l !== editing.l)) commitEdit();
      if (!h) { active.sel = null; renderLayers(); syncProps(); render(); return; }
      const wasSel = h.l.id === active.sel;
      active.sel = h.l.id; renderLayers(); syncProps();
      // only text you've edited can be moved; original text stays where the designer put it
      if (wasSel && h.l.edited) {
        canvas.setPointerCapture(e.pointerId);
        drag = { how: h.how, l: h.l, sx: p.x, sy: p.y, ox: h.l.x, oy: h.l.y, ow: h.l.w, oh: h.l.h, moved: false };
      }
      render();
    });
    canvas.addEventListener("dblclick", (e) => {
      if (!active.img || mode) return;
      const h = hit(pt(e));
      if (h) startEdit(h.l);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!active.img) return;
      const p = pt(e);
      if (!drag) {
        if (mode) return;
        const h = hit(p);
        const id = h ? h.l.id : null;
        canvas.style.cursor = !h ? "default" : h.how === "resize" ? "nwse-resize" : h.l.id === active.sel && h.l.edited ? "move" : "pointer";
        if (id !== hoverId) { hoverId = id; render(); }
        return;
      }
      const l = drag.l;
      if (drag.how === "draw") {
        l.x = Math.min(drag.sx, p.x); l.y = Math.min(drag.sy, p.y);
        l.w = Math.abs(p.x - drag.sx); l.h = Math.abs(p.y - drag.sy);
      } else if (drag.how === "move") {
        l.x = clamp01(Math.min(drag.ox + p.x - drag.sx, 1 - l.w)); l.y = clamp01(Math.min(drag.oy + p.y - drag.sy, 1 - l.h));
      } else {
        l.w = Math.max(0.01, Math.min(1 - l.x, drag.ow + p.x - drag.sx));
        l.h = Math.max(0.005, Math.min(1 - l.y, drag.oh + p.y - drag.sy));
      }
      drag.moved = true;
      render();
    });
    const end = async () => {
      if (!drag) return;
      const d = drag; drag = null;
      if (d.how === "draw") {
        setMode(null);
        if (d.l.w < 0.01 || d.l.h < 0.005) {
          Object.assign(d.l, { w: 0, h: 0 }); toast("Box too small — drag over the text.", true);
        } else {
          d.l.edited = false; d.l.orig = d.l.orig || "";
          prepare(d.l);
          renderLayers(); syncProps(); save(); await ensureFonts(active.layers); render();
          startEdit(d.l);
          return;
        }
        renderLayers();
      }
      save(); await ensureFonts(active.layers); render();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", () => { if (!drag && hoverId) { hoverId = null; render(); } });
    window.addEventListener("resize", placeUi);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && mode) { setMode(null); render(); return; }
      if (!$("#tab-certs").classList.contains("active") || editing) return;
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      const l = selLayer();
      if (!l) return;
      if (e.key === "Enter") { e.preventDefault(); startEdit(l); return; }
      if (!l.edited || !/^Arrow/.test(e.key)) return;
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
        let nameCol = 0, mailCol = -1, start = 0;
        if (hIdx >= 0 && hIdx < 10) {
          const h = rows[hIdx].map((c) => String(c).trim().toLowerCase());
          nameCol = h.findIndex((c) => /(^|\s)(full\s*)?name/.test(c) && !/mail|team|event/.test(c));
          if (nameCol < 0) nameCol = h.findIndex((c) => /name/.test(c));
          mailCol = h.findIndex((c) => /mail/.test(c));
          // one certificate design per run — category columns are ignored
          start = hIdx + 1;
        }
        const buckets = new Map();
        let count = 0;
        rows.slice(start).forEach((r) => {
          const name = String(r[nameCol] || "").trim();
          if (!name) return;
          let email = mailCol >= 0 ? String(r[mailCol] || "").trim() : "";
          if (!email) { const m = r.join(" ").match(EMAIL_RE); email = m ? m[0] : ""; }
          const g = active;
          if (!buckets.has(g)) buckets.set(g, []);
          buckets.get(g).push(email ? `${name}, ${email}` : name);
          count++;
        });
        if (!count) { toast("No names found. Make sure there's a 'Name' column.", true); return; }
        buckets.forEach((lines, g) => (g.text = lines.join("\n")));
        save(); renderChips(); syncGroup(); render();
        toast(`Imported ${count} names`);
      } catch (e) { console.error(e); toast("Couldn't read that file: " + e.message, true); }
    };
    reader.readAsArrayBuffer(file);
  }

  function sampleSheet() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "Email"],
      ["Venkatesh Ragipati", "venkatesh.r@company.com"],
      ["Priya Sharma", "priya.s@company.com"],
      ["Arjun Kumar", "arjun.k@company.com"],
    ]);
    ws["!cols"] = [{ wch: 28 }, { wch: 32 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Names");
    XLSX.writeFile(wb, "certificate-names-sample.xlsx");
  }

  // ---------- generate ----------
  const tick = () => new Promise((r) => setTimeout(r, 0));

  async function generate() {
    if (editing) commitEdit();
    const targets = [active].filter((g) => people(g).length);
    if (!targets.length) { toast("Add some names first.", true); return; }
    const missing = targets.filter((g) => !g.img);
    if (missing.length) { toast("Upload the certificate template first.", true); return; }
    const noName = targets.filter((g) => !g.layers.some((l) => isName(l) && hasBox(l)));
    if (noName.length) { toast("Click the name on the certificate and press 👤 Name first.", true); return; }

    const btn = $("#genCerts"), prog = $("#certProg"), pbar = prog.firstElementChild, lbl = prog.lastElementChild;
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
        const nameLayer = g.layers.find(isName) || {};
        for (const p of people(g)) {
          oc.drawImage(base, 0, 0);
          g.layers.forEach((l) => E.drawLayer(oc, W, H, l, vars(p.name, g)));
          const display = E.caseName(p.name, nameLayer.textCase === "upper" ? "title" : nameLayer.textCase || "asis");
          const fileBase = safeName(display);
          let attachPath = "";
          for (const f of fmts) {
            namers[f] = namers[f] || uniqueNamer();
            const fname = namers[f](fileBase) + "." + f;
            const file = "Mail Merge/" + fname;
            if (f === "png") {
              zip.file(file, await new Promise((r) => off.toBlob(r, "image/png")), { compression: "STORE" });
            } else {
              const pdf = new jspdf.jsPDF({ orientation: W >= H ? "landscape" : "portrait", unit: "pt", format: [W * 0.75, H * 0.75], compress: true });
              pdf.addImage(off.toDataURL("image/jpeg", 0.93), "JPEG", 0, 0, W * 0.75, H * 0.75, undefined, "FAST");
              pdf.setProperties({ title: `${event ? event + " – " : ""}${display}` });
              zip.file(file, pdf.output("blob"), { compression: "STORE" });
            }
            if (f === attachFmt) attachPath = fname;
          }
          mailRows.push({ name: display, email: p.email, file: attachPath, vars: { Event: event } });
          done++;
          pbar.style.width = (done / total) * 100 + "%";
          lbl.textContent = `${done} / ${total}`;
          if (done % 3 === 0) await tick();
        }
      }
      const m = mail();
      const kit = await writeMailKit(zip, { subject: m.certSubject, body: m.certBody, people: mailRows });
      lbl.textContent = "Zipping…";
      await tick();
      download(await zip.generateAsync({ type: "blob" }), `${safeName(event || "Certificates")} - Certificates.zip`);
      toast(`✔ ${total} certificates ready` + (kit.test ? " · TEST mode: 3 emails to you" : kit.noEmail ? ` · ${kit.noEmail} without email won't be mailed` : ""));
    } catch (e) {
      console.error(e);
      toast("Something went wrong: " + e.message, true);
    } finally {
      btn.disabled = false;
      setTimeout(() => { prog.hidden = true; pbar.style.width = "0"; }, 1500);
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
      if (editing) commitEdit();
      prepare(l);
      set(l, e.target.value); labels();
      if (id === "lErase") $("#lEraseColorWrap").hidden = l.erase !== "color";
      if (id === "lText") { renderLayers(); updateEvent(active); }
      save(); await ensureFonts(active.layers); render();
    }));
    $("#lWrap").addEventListener("change", (e) => { const l = selLayer(); if (!l) return; prepare(l); l.wrap = e.target.checked; save(); render(); });
    $("#lPick").addEventListener("click", () => { if (!active.img || !selLayer()) return; setMode({ kind: "pick", field: "color" }); render(); });
    $("#lPickErase").addEventListener("click", () => { if (!active.img || !selLayer()) return; setMode({ kind: "pick", field: "eraseColor" }); render(); });

    $("#makeName").addEventListener("click", () => makeName(selLayer()));
    $("#restoreLayer").addEventListener("click", () => restore(selLayer()));
    $("#addLayer").addEventListener("click", () => {
      if (!active.img) { toast("Upload the template first.", true); return; }
      const cur = selLayer();
      const l = newLayer(cur ? { font: cur.font, color: cur.color, weight: 400, wrap: true } : { wrap: true });
      active.layers.push(l); active.sel = l.id;
      renderLayers(); syncProps();
      startDraw(l);
    });
    $("#delLayer").addEventListener("click", () => {
      const l = selLayer(); if (!l) return;
      if (editing) commitEdit(true);
      if (l.auto) { prepare(l); l.text = ""; toast("Text removed from the design — ↺ Restore original brings it back"); }
      else active.layers = active.layers.filter((x) => x !== l);
      if (!l.auto) active.sel = null;
      setMode(null); renderLayers(); syncProps(); save(); render();
    });
    $("#fSample").addEventListener("input", render);
    $("#showBoxes").addEventListener("change", render);
    $("#certEvent").addEventListener("input", render);

    $("#namesBox").addEventListener("input", (e) => { active.text = e.target.value; updateStats(); renderChips(); render(); });
    $("#xlsInput").addEventListener("change", (e) => { if (e.target.files[0]) importSheet(e.target.files[0]); e.target.value = ""; });
    $("#sampleXls").addEventListener("click", sampleSheet);

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
    ev.addEventListener("input", () => { eventTouched = true; store.set("certEvent", ev.value); });
  }

  document.addEventListener("DOMContentLoaded", () => {
    newGroup("Certificate");
    active = groups[0];
    bind();
    renderChips(); syncGroup(); render();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(render);
    // warm up the text reader in the background so the first upload is quick
    setTimeout(() => window.TextDetect && window.TextDetect.preload(), 1500);
  });
})();
