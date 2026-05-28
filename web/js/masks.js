/**
 * 词云形状 Mask 生成器
 * wordcloud2.js 规则：mask 上较亮的区域可放置文字
 */
const ShapeMask = (() => {
  /** @type {Map<string, HTMLCanvasElement>} */
  const cache = new Map();
  let customMaskDataUrl = null;

  const SHAPES = {
    rectangle: { label: "矩形", icon: "▭" },
    circle: { label: "圆形", icon: "●" },
    heart: { label: "心形", icon: "♥" },
    star: { label: "星形", icon: "★" },
    cloud: { label: "云朵", icon: "☁" },
    diamond: { label: "菱形", icon: "◆" },
  };

  function cacheKey(shape, w, h) {
    return `${shape}-${w}-${h}-${customMaskDataUrl ? "custom" : ""}`;
  }

  function createCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  function fillWhite(ctx) {
    ctx.fillStyle = "#ffffff";
  }

  function drawRectangle(ctx, w, h) {
    fillWhite(ctx);
    ctx.fillRect(0, 0, w, h);
  }

  function drawCircle(ctx, w, h) {
    const r = Math.min(w, h) * 0.42;
    fillWhite(ctx);
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHeart(ctx, w, h) {
    const cx = w / 2;
    const cy = h / 2;
    const size = Math.min(w, h) * 0.38;
    fillWhite(ctx);
    ctx.beginPath();
    ctx.moveTo(cx, cy + size * 0.95);
    ctx.bezierCurveTo(cx - size * 1.6, cy + size * 0.2, cx - size * 0.9, cy - size * 0.7, cx, cy - size * 0.15);
    ctx.bezierCurveTo(cx + size * 0.9, cy - size * 0.7, cx + size * 1.6, cy + size * 0.2, cx, cy + size * 0.95);
    ctx.closePath();
    ctx.fill();
  }

  function drawStar(ctx, w, h) {
    const cx = w / 2;
    const cy = h / 2;
    const outer = Math.min(w, h) * 0.42;
    const inner = outer * 0.45;
    const points = 5;
    fillWhite(ctx);
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (Math.PI / points) * i - Math.PI / 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawDiamond(ctx, w, h) {
    const cx = w / 2;
    const cy = h / 2;
    const rw = Math.min(w, h) * 0.4;
    const rh = Math.min(w, h) * 0.48;
    fillWhite(ctx);
    ctx.beginPath();
    ctx.moveTo(cx, cy - rh);
    ctx.lineTo(cx + rw, cy);
    ctx.lineTo(cx, cy + rh);
    ctx.lineTo(cx - rw, cy);
    ctx.closePath();
    ctx.fill();
  }

  function drawCloud(ctx, w, h) {
    fillWhite(ctx);
    const cx = w / 2;
    const cy = h / 2;
    const base = Math.min(w, h) * 0.12;
    const blobs = [
      [cx - base * 2.2, cy + base * 0.3, base * 1.5],
      [cx - base * 0.8, cy - base * 0.5, base * 1.8],
      [cx + base * 1.2, cy - base * 0.3, base * 1.6],
      [cx + base * 2.5, cy + base * 0.5, base * 1.3],
      [cx, cy + base * 0.8, base * 2.2],
    ];
    for (const [x, y, r] of blobs) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const DRAWERS = {
    rectangle: drawRectangle,
    circle: drawCircle,
    heart: drawHeart,
    star: drawStar,
    cloud: drawCloud,
    diamond: drawDiamond,
  };

  function buildShapeMask(shape, width, height) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);
    const drawer = DRAWERS[shape] || drawCircle;
    drawer(ctx, width, height);
    return canvas;
  }

  function buildCustomMask(dataUrl, width, height) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, width, height);

        const scale = Math.min(width / img.width, height / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        const dx = (width - dw) / 2;
        const dy = (height - dh) / 2;

        ctx.drawImage(img, dx, dy, dw, dh);
        const imageData = ctx.getImageData(0, 0, width, height);
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          const alpha = d[i + 3];
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const bright = alpha > 30 && lum > 40;
          d[i] = d[i + 1] = d[i + 2] = bright ? 255 : 0;
          d[i + 3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas);
      };
      img.onerror = () => reject(new Error("无法加载自定义形状图片"));
      img.src = dataUrl;
    });
  }

  function getMask(shape, width, height) {
    if (shape === "rectangle") return null;

    if (shape === "custom" && customMaskDataUrl) {
      const key = cacheKey("custom", width, height);
      if (cache.has(key)) return Promise.resolve(cache.get(key));
      return buildCustomMask(customMaskDataUrl, width, height).then((canvas) => {
        cache.set(key, canvas);
        return canvas;
      });
    }

    const key = cacheKey(shape, width, height);
    if (!cache.has(key)) {
      cache.set(key, buildShapeMask(shape, width, height));
    }
    return Promise.resolve(cache.get(key));
  }

  function setCustomMask(dataUrl) {
    customMaskDataUrl = dataUrl;
    cache.clear();
  }

  function clearCustomMask() {
    customMaskDataUrl = null;
    cache.clear();
  }

  function getCustomMaskDataUrl() {
    return customMaskDataUrl;
  }

  function invalidateCache() {
    cache.clear();
  }

  return {
    SHAPES,
    getMask,
    setCustomMask,
    clearCustomMask,
    getCustomMaskDataUrl,
    invalidateCache,
    buildShapeMask,
  };
})();

window.ShapeMask = ShapeMask;
