/*
 * Certificate engine — the "Canva" part.
 *  - eraseRegion(): wipes old text inside a box and rebuilds the background from the pixels
 *    around the box (Coons-patch blend of the four edges), so gradients stay smooth.
 *  - analyseRegion(): guesses the old text's colour, size and line spacing so the new text matches.
 *  - drawLayer(): writes rich text (**bold**, ^sup^, new lines, wrapping, letter spacing) into a box,
 *    shrinking it if it doesn't fit.
 */
(function (root) {
  "use strict";

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- erase ----------
  function boxPx(layer, W, H) {
    const x0 = clamp(Math.round(layer.x * W), 0, W - 1);
    const y0 = clamp(Math.round(layer.y * H), 0, H - 1);
    const x1 = clamp(Math.round((layer.x + layer.w) * W), x0 + 1, W - 1);
    const y1 = clamp(Math.round((layer.y + layer.h) * H), y0 + 1, H - 1);
    return { x0, y0, x1, y1 };
  }

  // Running median smooths out letter strokes that poke across the box edge.
  function smoothStrip(strip, n) {
    const win = Math.max(5, Math.min(41, Math.round(n / 25) | 1));
    const half = win >> 1;
    const out = new Float32Array(strip.length);
    const buf = [];
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < n; i++) {
        buf.length = 0;
        for (let k = i - half; k <= i + half; k++) { const j = clamp(k, 0, n - 1); buf.push(strip[j * 3 + c]); }
        buf.sort((a, b) => a - b);
        out[i * 3 + c] = buf[half];
      }
    }
    return out;
  }

  // Average a few pixels just outside the box along one edge.
  function edgeStrip(d, W, H, from, to, fixed, horizontal, dir) {
    const n = to - from + 1;
    const strip = new Float32Array(n * 3);
    let ok = false;
    for (let i = 0; i < n; i++) {
      let r = 0, g = 0, b = 0, cnt = 0;
      for (let k = 2; k <= 5; k++) {
        const x = horizontal ? from + i : fixed + dir * k;
        const y = horizontal ? fixed + dir * k : from + i;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const p = (y * W + x) * 4;
        r += d[p]; g += d[p + 1]; b += d[p + 2]; cnt++;
      }
      if (cnt) { strip[i * 3] = r / cnt; strip[i * 3 + 1] = g / cnt; strip[i * 3 + 2] = b / cnt; ok = true; }
    }
    return ok ? smoothStrip(strip, n) : null;
  }

  function fillPlan(d, W, H, b) {
    const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
    let top = edgeStrip(d, W, H, b.x0, b.x1, b.y0, true, -1);
    let bot = edgeStrip(d, W, H, b.x0, b.x1, b.y1, true, 1);
    let lef = edgeStrip(d, W, H, b.y0, b.y1, b.x0, false, -1);
    let rig = edgeStrip(d, W, H, b.y0, b.y1, b.x1, false, 1);
    top = top || bot; bot = bot || top; lef = lef || rig; rig = rig || lef;
    if (!top && !lef) return null;
    const useH = !!(lef && rig), useV = !!(top && bot);
    return (x, y, out) => {
      const u = w > 1 ? (x - b.x0) / (w - 1) : 0.5;
      const v = h > 1 ? (y - b.y0) / (h - 1) : 0.5;
      const xi = x - b.x0, yi = y - b.y0;
      for (let c = 0; c < 3; c++) {
        if (useH && useV) {
          const Hc = (1 - u) * lef[yi * 3 + c] + u * rig[yi * 3 + c];
          const Vc = (1 - v) * top[xi * 3 + c] + v * bot[xi * 3 + c];
          const c00 = (top[c] + lef[c]) / 2, c10 = (top[(w - 1) * 3 + c] + rig[c]) / 2;
          const c01 = (bot[c] + lef[(h - 1) * 3 + c]) / 2, c11 = (bot[(w - 1) * 3 + c] + rig[(h - 1) * 3 + c]) / 2;
          const B = (1 - u) * (1 - v) * c00 + u * (1 - v) * c10 + (1 - u) * v * c01 + u * v * c11;
          out[c] = Hc + Vc - B;
        } else if (useH) out[c] = (1 - u) * lef[yi * 3 + c] + u * rig[yi * 3 + c];
        else out[c] = (1 - v) * top[xi * 3 + c] + v * bot[xi * 3 + c];
      }
    };
  }

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    const n = m ? parseInt(m[1], 16) : 0xffffff;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) { return "#" + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join(""); }

  /** Erase layer boxes on ctx (which already holds the template). */
  function eraseAll(ctx, W, H, layers) {
    const todo = layers.filter((l) => l.w > 0 && l.h > 0 && l.erase !== "none" && l.edited !== false);
    if (!todo.length) return;
    const img = ctx.getImageData(0, 0, W, H);
    const src = new Uint8ClampedArray(img.data); // sample edges from the untouched template
    const d = img.data, px = [0, 0, 0];
    todo.forEach((l) => {
      const b = boxPx(l, W, H);
      if (l.erase === "color") {
        const [r, g, bl] = hexToRgb(l.eraseColor);
        for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) { const p = (y * W + x) * 4; d[p] = r; d[p + 1] = g; d[p + 2] = bl; }
        return;
      }
      const f = fillPlan(src, W, H, b);
      if (!f) return;
      for (let y = b.y0; y <= b.y1; y++) {
        for (let x = b.x0; x <= b.x1; x++) {
          f(x, y, px);
          const p = (y * W + x) * 4;
          // a whisper of noise hides banding on smooth gradients
          const n = ((x * 7919 + y * 104729) % 7) / 7 - 0.5;
          d[p] = px[0] + n; d[p + 1] = px[1] + n; d[p + 2] = px[2] + n; d[p + 3] = 255;
        }
      }
    });
    ctx.putImageData(img, 0, 0);
  }

  /** Grow the box until no letter strokes cross its edges, then add a little padding. */
  function snapToInk(ctx, W, H, layer) {
    const d = ctx.getImageData(0, 0, W, H).data;
    let { x0, y0, x1, y1 } = boxPx(layer, W, H);
    const bw = x1 - x0, bh = y1 - y0;
    const maxX = Math.max(10, bw * 0.35), maxY = Math.max(10, bh * 0.8);
    const ox0 = x0, ox1 = x1, oy0 = y0, oy1 = y1;
    const lineInk = (horizontal, fixed, from, to) => {
      if (fixed < 0 || (horizontal ? fixed >= H : fixed >= W)) return 0;
      const n = to - from + 1;
      if (n < 3) return 0;
      const strip = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const x = horizontal ? from + i : fixed, y = horizontal ? fixed : from + i;
        const p = (y * W + x) * 4;
        strip[i * 3] = d[p]; strip[i * 3 + 1] = d[p + 1]; strip[i * 3 + 2] = d[p + 2];
      }
      const med = smoothStrip(strip, n);
      let ink = 0;
      for (let i = 0; i < n; i++) {
        const dd = Math.abs(strip[i * 3] - med[i * 3]) + Math.abs(strip[i * 3 + 1] - med[i * 3 + 1]) + Math.abs(strip[i * 3 + 2] - med[i * 3 + 2]);
        if (dd > 70) ink++;
      }
      return ink;
    };
    const growV = () => {
      let changed = true, guard = 0;
      while (changed && guard++ < 400) {
        changed = false;
        if (y0 > 0 && oy0 - y0 < maxY && lineInk(true, y0, x0, x1) > 0) { y0--; changed = true; }
        if (y1 < H - 1 && y1 - oy1 < maxY && lineInk(true, y1, x0, x1) > 0) { y1++; changed = true; }
      }
    };
    // a column has ink if any pixel differs from the background just above/below the box
    const px = (x, y, c) => d[(y * W + x) * 4 + c];
    const refAvg = (x, yFrom, dir) => {
      const o = [0, 0, 0]; let n = 0;
      for (let k = 3; k <= 6; k++) { const y = yFrom + dir * k; if (y < 0 || y >= H) continue; for (let c = 0; c < 3; c++) o[c] += px(x, y, c); n++; }
      return n ? o.map((v) => v / n) : null;
    };
    const colInk = (x) => {
      let t = refAvg(x, y0, -1), b = refAvg(x, y1, 1);
      t = t || b; b = b || t; if (!t) return false;
      for (let y = y0; y <= y1; y++) {
        const v = (y - y0) / Math.max(1, y1 - y0);
        let dd = 0;
        for (let c = 0; c < 3; c++) dd += Math.abs(px(x, y, c) - ((1 - v) * t[c] + v * b[c]));
        if (dd > 90) return true;
      }
      return false;
    };
    const growH = () => {
      const gap = Math.max(6, (y1 - y0) * 1.6);       // letter + word spacing allowed
      const reach = Math.max(bw * 1.0, (y1 - y0) * 4);
      let last = x0;
      for (let x = x0 - 1; x >= Math.max(0, ox0 - reach) && last - x <= gap; x--) if (colInk(x)) last = x;
      x0 = last;
      last = x1;
      for (let x = x1 + 1; x <= Math.min(W - 1, ox1 + reach) && x - last <= gap; x++) if (colInk(x)) last = x;
      x1 = last;
    };
    growV(); growH(); growV();
    const pad = Math.max(2, Math.round(H * 0.002));
    x0 = clamp(x0 - pad, 0, W - 1); y0 = clamp(y0 - pad, 0, H - 1);
    x1 = clamp(x1 + pad, 0, W - 1); y1 = clamp(y1 + pad, 0, H - 1);
    layer.x = x0 / W; layer.y = y0 / H; layer.w = (x1 - x0) / W; layer.h = (y1 - y0) / H;
  }

  /** Guess colour / size / line height of the text currently inside the box. */
  function analyseRegion(ctx, W, H, layer) {
    const b = boxPx(layer, W, H);
    const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
    const d = ctx.getImageData(0, 0, W, H).data;
    const f = fillPlan(d, W, H, b);
    if (!f) return null;
    const bg = [0, 0, 0];
    const diffs = new Float32Array(w * h);
    let maxD = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      f(b.x0 + x, b.y0 + y, bg);
      const p = ((b.y0 + y) * W + b.x0 + x) * 4;
      const dd = Math.abs(d[p] - bg[0]) + Math.abs(d[p + 1] - bg[1]) + Math.abs(d[p + 2] - bg[2]);
      diffs[y * w + x] = dd;
      if (dd > maxD) maxD = dd;
    }
    if (maxD < 60) return null; // nothing that looks like text
    const thr = maxD * 0.5;
    let r = 0, g = 0, bl = 0, n = 0;
    const rows = new Uint32Array(h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dd = diffs[y * w + x];
      if (dd < thr) continue;
      rows[y]++;
      if (dd > maxD * 0.85) { const p = ((b.y0 + y) * W + b.x0 + x) * 4; r += d[p]; g += d[p + 1]; bl += d[p + 2]; n++; }
    }
    const runs = (pred) => {
      const out = []; let st = -1;
      for (let y = 0; y <= h; y++) {
        const on = y < h && pred(y);
        if (on && st < 0) st = y;
        if (!on && st >= 0) { if (y - st >= 2) out.push([st, y - 1]); st = -1; }
      }
      return out;
    };
    const maxRow = Math.max.apply(null, Array.from(rows));
    if (!maxRow) return null;
    // dense "core" rows = x-height of mixed-case text, or the full cap height of CAPS text
    const cores = runs((y) => rows[y] >= maxRow * 0.4);
    const inks = runs((y) => rows[y] >= Math.max(1, maxRow * 0.04));
    if (!cores.length) return null;
    const med = (arr) => arr.slice().sort((p, q) => p - q)[arr.length >> 1];
    const coreH = med(cores.map((c) => c[1] - c[0] + 1));
    // how far ink reaches above/below the first core band tells caps from mixed case
    const c0 = cores[0];
    const ink0 = inks.find((k) => k[0] <= c0[1] && k[1] >= c0[0]) || c0;
    const caps = (ink0[1] - ink0[0] + 1) / coreH < 1.3;
    const sizePx = caps ? coreH / 0.7 : coreH / 0.53;
    const out = { color: n ? rgbToHex(r / n, g / n, bl / n) : null, lines: cores.length, caps };
    out.sizePct = (sizePx / H) * 100;
    if (cores.length > 1) {
      const pitch = (cores[cores.length - 1][0] - cores[0][0]) / (cores.length - 1);
      out.lineHeight = clamp(pitch / sizePx, 0.9, 2.4);
    }
    return out;
  }

  // ---------- text ----------
  function caseName(name, mode) {
    if (mode === "upper") return name.toUpperCase();
    if (mode === "title") return name.toLowerCase().replace(/(^|[\s\-'.])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
    return name;
  }

  function fillText(text, vars, layer) {
    return String(text || "").replace(/\{(\w+)\}/g, (m, k) => {
      const key = Object.keys(vars).find((v) => v.toLowerCase() === k.toLowerCase());
      if (!key) return m;
      return key.toLowerCase() === "name" ? caseName(vars[key], layer.textCase) : vars[key];
    });
  }

  // "**bold**", "^th^", newlines -> tokens
  function tokenize(text) {
    const tokens = [];
    let bold = false, sup = false, buf = "";
    const flush = () => {
      if (!buf) return;
      buf.split(/(\s+)/).forEach((w) => { if (w) tokens.push({ t: w, bold, sup, space: /^\s+$/.test(w) }); });
      buf = "";
    };
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "*" && s[i + 1] === "*") { flush(); bold = !bold; i++; continue; }
      if (ch === "^") { flush(); sup = !sup; continue; }
      if (ch === "\n") { flush(); tokens.push({ br: true }); continue; }
      if (ch === "\r") continue;
      buf += ch;
    }
    flush();
    return tokens;
  }

  function fontFor(layer, tok, px) {
    const weight = tok.bold ? 700 : layer.weight || 400;
    const size = tok.sup ? px * 0.58 : px;
    return `${weight} ${size}px "${layer.font}"`;
  }

  function layout(ctx, layer, tokens, px, maxW) {
    const ls = (layer.spacing || 0) * px;
    if ("letterSpacing" in ctx) ctx.letterSpacing = ls + "px";
    const lines = [[]];
    const widths = [0];
    const measure = (tok) => { ctx.font = fontFor(layer, tok, px); return ctx.measureText(tok.t).width + (("letterSpacing" in ctx) ? 0 : ls * tok.t.length); };
    tokens.forEach((tok) => {
      if (tok.br) { lines.push([]); widths.push(0); return; }
      const wTok = measure(tok);
      const li = lines.length - 1;
      if (layer.wrap && !tok.space && widths[li] > 0 && widths[li] + wTok > maxW) {
        // drop trailing space, start new line
        while (lines[li].length && lines[li][lines[li].length - 1].space) widths[li] -= lines[li].pop().w;
        lines.push([]); widths.push(0);
      }
      const l = lines.length - 1;
      if (tok.space && lines[l].length === 0) return; // no leading spaces
      lines[l].push(Object.assign({}, tok, { w: wTok }));
      widths[l] += wTok;
    });
    lines.forEach((ln, i) => { while (ln.length && ln[ln.length - 1].space) widths[i] -= ln.pop().w; });
    return { lines, widths, maxWidth: Math.max.apply(null, widths) };
  }

  /** Draw one text layer. Returns the font size used (px). */
  function drawLayer(ctx, W, H, layer, vars) {
    if (!(layer.w > 0 && layer.h > 0) || layer.edited === false) return 0;
    const text = fillText(layer.text, vars, layer).trim();
    if (!text) return 0;
    const tokens = tokenize(text);
    const bx = layer.x * W, by = layer.y * H, bw = layer.w * W, bh = layer.h * H;
    const lh = layer.lineHeight || 1.25;
    let px = (layer.size / 100) * H;
    let lay = layout(ctx, layer, tokens, px, bw);
    let guard = 0;
    // shrink until it fits the box (a little vertical slack so tight boxes don't shrink single lines)
    while (guard++ < 80 && px > 6 && (lay.maxWidth > bw || lay.lines.length * lh * px > Math.max(bh * 1.35, px * lh * 1.01))) {
      px *= 0.96;
      lay = layout(ctx, layer, tokens, px, bw);
    }
    ctx.save();
    ctx.fillStyle = layer.color || "#ffffff";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const total = lay.lines.length * lh * px;
    let y = by + bh / 2 - total / 2 + (lh * px) / 2;
    lay.lines.forEach((ln, i) => {
      const lw = lay.widths[i];
      let x = layer.align === "left" ? bx : layer.align === "right" ? bx + bw - lw : bx + (bw - lw) / 2;
      ln.forEach((tok) => {
        ctx.font = fontFor(layer, tok, px);
        ctx.fillText(tok.t, x, tok.sup ? y - px * 0.28 : y);
        x += tok.w;
      });
      y += lh * px;
    });
    ctx.restore();
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    return px;
  }

  function fontsOf(layers) {
    const set = new Set();
    layers.forEach((l) => { set.add(`${l.weight || 400} 40px "${l.font}"`); set.add(`700 40px "${l.font}"`); });
    return Array.from(set);
  }

  root.CertEngine = { eraseAll, analyseRegion, snapToInk, drawLayer, caseName, fillText, fontsOf, hexToRgb, rgbToHex };
})(typeof window !== "undefined" ? window : globalThis);
