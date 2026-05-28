/**
 * 词云形状 Mask 生成器
 * ECharts wordCloud：mask 上较亮区域可放置文字
 */
const ShapeMask = (() => {
  /** @type {Map<string, HTMLCanvasElement>} */
  const cache = new Map();
  let customMaskDataUrl = null;
  let chinaSvgDataUrl = null;

  const SHAPES = {
    rectangle: { label: "矩形", icon: "▭" },
    circle: { label: "圆形", icon: "●" },
    heart: { label: "心形", icon: "♥" },
    star: { label: "星形", icon: "★" },
    cloud: { label: "云朵", icon: "☁" },
    diamond: { label: "菱形", icon: "◆" },
    china: { label: "中国地图", icon: "🗺" },
  };

  const MASK_SIZE = { w: 1024, h: 768 };

  function cacheKey(shape, w, h) {
    return `${shape}-${w}-${h}-${customMaskDataUrl ? "c" : ""}`;
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
    const r = Math.min(w, h) * 0.46;
    fillWhite(ctx);
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHeart(ctx, w, h) {
    const cx = w / 2;
    const cy = h / 2;
    const size = Math.min(w, h) * 0.42;
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
    const outer = Math.min(w, h) * 0.46;
    const inner = outer * 0.42;
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
    const rw = Math.min(w, h) * 0.44;
    const rh = Math.min(w, h) * 0.5;
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
    const base = Math.min(w, h) * 0.13;
    const blobs = [
      [cx - base * 2.2, cy + base * 0.3, base * 1.55],
      [cx - base * 0.8, cy - base * 0.5, base * 1.85],
      [cx + base * 1.2, cy - base * 0.3, base * 1.65],
      [cx + base * 2.5, cy + base * 0.5, base * 1.35],
      [cx, cy + base * 0.8, base * 2.25],
    ];
    for (const [x, y, r] of blobs) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** 膨胀白色区域，让自定义/复杂轮廓能容纳更多词 */
  function dilateMask(data, width, height, radius) {
    const src = new Uint8Array(width * height);
    for (let p = 0; p < width * height; p++) {
      src[p] = data[p * 4] > 127 ? 1 : 0;
    }
    const out = new Uint8Array(src);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!src[y * width + x]) continue;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx * dx + dy * dy > radius * radius) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              out[ny * width + nx] = 1;
            }
          }
        }
      }
    }
    for (let p = 0; p < width * height; p++) {
      const v = out[p] ? 255 : 0;
      data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = v;
      data[p * 4 + 3] = 255;
    }
  }

  function applyMaskFromLuminance(imageData, options = {}) {
    const { width, height, data } = imageData;
    const { dilate = 0, invert = false } = options;

    let lightPixels = 0;
    const lum = new Float32Array(width * height);
    for (let p = 0; p < width * height; p++) {
      const i = p * 4;
      const a = data[i + 3] / 255;
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      lum[p] = l * a + 255 * (1 - a);
      if (lum[p] > 200) lightPixels++;
    }
    const whiteBackground = lightPixels > width * height * 0.45;

    for (let p = 0; p < width * height; p++) {
      const i = p * 4;
      const a = data[i + 3];
      const l = lum[p];
      let inside;
      if (whiteBackground) {
        inside = a > 24 && l < 215;
      } else {
        inside = a > 24 && l > 50;
      }
      if (invert) inside = !inside;
      const v = inside ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }

    if (dilate > 0) dilateMask(data, width, height, dilate);
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

    if (shape === "china") {
      return buildChinaMaskSync(canvas, width, height) || canvas;
    }

    const drawer = DRAWERS[shape] || drawCircle;
    drawer(ctx, width, height);
    return canvas;
  }

  function drawChinaFallback(ctx, w, h) {
    fillWhite(ctx);
    const cx = w / 2;
    const cy = h / 2;
    const s = Math.min(w, h) * 0.44;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.52, cy - s * 0.08);
    ctx.bezierCurveTo(cx - s * 0.48, cy - s * 0.58, cx - s * 0.08, cy - s * 0.78, cx + s * 0.28, cy - s * 0.68);
    ctx.bezierCurveTo(cx + s * 0.58, cy - s * 0.55, cx + s * 0.78, cy - s * 0.22, cx + s * 0.72, cy + s * 0.12);
    ctx.bezierCurveTo(cx + s * 0.66, cy + s * 0.42, cx + s * 0.42, cy + s * 0.65, cx + s * 0.1, cy + s * 0.72);
    ctx.bezierCurveTo(cx - s * 0.2, cy + s * 0.78, cx - s * 0.48, cy + s * 0.58, cx - s * 0.58, cy + s * 0.28);
    ctx.bezierCurveTo(cx - s * 0.64, cy + s * 0.02, cx - s * 0.58, cy - s * 0.05, cx - s * 0.52, cy - s * 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + s * 0.38, cy + s * 0.15, s * 0.09, s * 0.15, 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx - s * 0.12, cy + s * 0.48, s * 0.07, s * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function buildChinaMaskSync(canvas, width, height) {
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);
    drawChinaFallback(ctx, width, height);
    return canvas;
  }

  function loadChinaSvgMask(width, height) {
    if (!chinaSvgDataUrl) {
      chinaSvgDataUrl = new URL("assets/china-map.svg", window.location.href).href;
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, width, height);
        const scale = Math.min(width / img.width, height / img.height) * 0.92;
        const dw = img.width * scale;
        const dh = img.height * scale;
        const dx = (width - dw) / 2;
        const dy = (height - dh) / 2;
        ctx.drawImage(img, dx, dy, dw, dh);
        const imageData = ctx.getImageData(0, 0, width, height);
        applyMaskFromLuminance(imageData, { dilate: 2 });
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas);
      };
      img.onerror = () => {
        resolve(buildChinaMaskSync(createCanvas(width, height), width, height));
      };
      img.src = chinaSvgDataUrl;
    });
  }

  function buildCustomMask(dataUrl, width, height) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, width, height);

        const scale = Math.min(width / img.width, height / img.height) * 0.95;
        const dw = img.width * scale;
        const dh = img.height * scale;
        const dx = (width - dw) / 2;
        const dy = (height - dh) / 2;

        ctx.drawImage(img, dx, dy, dw, dh);
        const imageData = ctx.getImageData(0, 0, width, height);
        applyMaskFromLuminance(imageData, { dilate: 4 });
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas);
      };
      img.onerror = () => reject(new Error("无法加载自定义形状图片"));
      img.src = dataUrl;
    });
  }

  function getMask(shape, width, height) {
    if (shape === "custom" && customMaskDataUrl) {
      const key = cacheKey("custom", width, height);
      if (cache.has(key)) return Promise.resolve(cache.get(key));
      return buildCustomMask(customMaskDataUrl, width, height).then((canvas) => {
        cache.set(key, canvas);
        return canvas;
      });
    }

    if (shape === "china") {
      const key = cacheKey("china", width, height);
      if (cache.has(key)) return Promise.resolve(cache.get(key));
      return loadChinaSvgMask(width, height).then((canvas) => {
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

  function getMaskFillRatio(shape, width, height) {
    const key = cacheKey(shape, width, height);
    const canvas = cache.get(key);
    if (!canvas) return 0.5;
    const ctx = canvas.getContext("2d");
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let bright = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 127) bright++;
    }
    return bright / (canvas.width * canvas.height);
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
    MASK_SIZE,
    getMask,
    getMaskFillRatio,
    setCustomMask,
    clearCustomMask,
    getCustomMaskDataUrl,
    invalidateCache,
    buildShapeMask,
  };
})();

window.ShapeMask = ShapeMask;
