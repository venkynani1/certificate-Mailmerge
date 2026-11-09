/*
 * Finds the text on an uploaded certificate (like Canva's "Grab Text") so every piece of text
 * becomes a clickable, editable block. Uses Tesseract.js (loaded on first use).
 */
(function (root) {
  "use strict";
  const TESS_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  let loading = null, worker = null;

  function loadLib() {
    if (root.Tesseract) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = TESS_URL; s.onload = res; s.onerror = () => rej(new Error("Couldn't load the text reader (check internet)"));
      document.head.appendChild(s);
    });
    return loading;
  }

  async function getWorker() {
    await loadLib();
    if (!worker) worker = await root.Tesseract.createWorker("eng");
    return worker;
  }

  const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
  const alnum = (t) => (t.match(/[A-Za-z0-9]/g) || []).length;

  /** img: HTMLImageElement. Returns blocks in 0..1 coordinates: [{x,y,w,h,text,lines,align}] */
  async function detect(img, onProgress) {
    const W = img.naturalWidth, H = img.naturalHeight;
    // scale to a size the reader likes: big enough for small print, small enough to be quick
    const scale = W < 1200 ? 2 : W > 2800 ? 2600 / W : 1;
    const c = document.createElement("canvas");
    c.width = Math.round(W * scale); c.height = Math.round(H * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    onProgress && onProgress("Reading the text on your certificate…");
    const w = await getWorker();
    const { data } = await w.recognize(c, {}, { blocks: true });

    // 1. lines -> clean segments (drop junk words, split lines with big gaps, e.g. two signatures)
    const items = [];
    (data.blocks || []).forEach((b) => b.paragraphs.forEach((p) => p.lines.forEach((ln) => {
      const words = ln.words.filter((wd) => alnum(wd.text) > 0 && wd.confidence >= 45).sort((a, z) => a.bbox.x0 - z.bbox.x0);
      if (!words.length) return;
      const hgt = median(words.map((wd) => wd.bbox.y1 - wd.bbox.y0));
      let seg = [];
      const flush = () => {
        if (!seg.length) return;
        const text = seg.map((wd) => wd.text).join(" ").trim();
        const conf = seg.reduce((s, wd) => s + wd.confidence, 0) / seg.length;
        if (alnum(text) >= 2 && conf >= 55) {
          items.push({
            x0: Math.min(...seg.map((wd) => wd.bbox.x0)), y0: Math.min(...seg.map((wd) => wd.bbox.y0)),
            x1: Math.max(...seg.map((wd) => wd.bbox.x1)), y1: Math.max(...seg.map((wd) => wd.bbox.y1)),
            text, h: hgt,
          });
        }
        seg = [];
      };
      words.forEach((wd, i) => {
        if (i && wd.bbox.x0 - words[i - 1].bbox.x1 > hgt * 4) flush();
        seg.push(wd);
      });
      flush();
    })));
    items.sort((a, z) => a.y0 - z.y0 || a.x0 - z.x0);

    // 2. stack neighbouring lines of the same size into paragraphs
    const blocks = [];
    items.forEach((it) => {
      const cx = (it.x0 + it.x1) / 2;
      const b = blocks.find((bl) => {
        const last = bl.lines[bl.lines.length - 1];
        const ratio = Math.max(it.h, last.h) / Math.max(1, Math.min(it.h, last.h));
        const gap = it.y0 - last.y1;
        const lcx = (last.x0 + last.x1) / 2;
        const overlap = Math.min(it.x1, last.x1) - Math.max(it.x0, last.x0);
        return ratio < 1.35 && gap < last.h * 0.9 && gap > -last.h * 0.5 &&
          (Math.abs(cx - lcx) < c.width * 0.12 || overlap > 0.5 * Math.min(it.x1 - it.x0, last.x1 - last.x0));
      });
      if (b) b.lines.push(it); else blocks.push({ lines: [it] });
    });

    return blocks.map((b) => {
      const x0 = Math.min(...b.lines.map((l) => l.x0)), x1 = Math.max(...b.lines.map((l) => l.x1));
      const y0 = Math.min(...b.lines.map((l) => l.y0)), y1 = Math.max(...b.lines.map((l) => l.y1));
      let align = "center";
      if (b.lines.length > 1) {
        const lefts = b.lines.map((l) => l.x0), centers = b.lines.map((l) => (l.x0 + l.x1) / 2);
        const spread = (a) => Math.max(...a) - Math.min(...a);
        if (spread(lefts) < spread(centers) * 0.5) align = "left";
      }
      return {
        x: x0 / c.width, y: y0 / c.height, w: (x1 - x0) / c.width, h: (y1 - y0) / c.height,
        text: b.lines.map((l) => l.text).join(" "),
        lines: b.lines.length, align,
        upper: b.lines.every((l) => l.text === l.text.toUpperCase()),
      };
    });
  }

  root.TextDetect = { detect, preload: () => getWorker().catch(() => {}) };
})(window);
