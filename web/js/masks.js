/**
 * 词云形状 Mask：仅轮廓环带区域可排词（文字沿形状边缘显示）
 * ECharts wordCloud 规则：mask 白色区域可放置文字，黑色为透明背景
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

  const MASK_SIZE = { w: 1200, h: 900 };

  function cacheKey(shape, w, h) {
    return `outline-v3-${shape}-${w}-${h}-${customMaskDataUrl ? "c" : ""}`;
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

  function binaryFromImageData(data, width, height) {
    const bin = new Uint8Array(width * height);
    for (let p = 0; p < width * height; p++) {
      bin[p] = data[p * 4] > 127 ? 1 : 0;
    }
    return bin;
  }

  function writeBinaryToImageData(data, binary, width, height) {
    for (let p = 0; p < width * height; p++) {
      const v = binary[p] ? 255 : 0;
      data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = v;
      data[p * 4 + 3] = 255;
    }
  }

  function dilateBinary(binary, width, height, radius) {
    if (radius <= 0) return binary.slice();
    const src = binary;
    const out = new Uint8Array(width * height);
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
    return out;
  }

  function erodeBinary(binary, width, height, radius) {
    if (radius <= 0) return binary.slice();
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!binary[y * width + x]) continue;
        let keep = true;
        for (let dy = -radius; dy <= radius && keep; dy++) {
          for (let dx = -radius; dx <= radius && keep; dx++) {
            if (dx * dx + dy * dy > radius * radius) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height || !binary[ny * width + nx]) {
              keep = false;
            }
          }
        }
        if (keep) out[y * width + x] = 1;
      }
    }
    return out;
  }

  /** 实心形状 → 仅保留边缘环带（词语沿轮廓排列） */
  function solidToOutlineRing(solid, width, height, bandWidth) {
    let band = Math.max(4, Math.round(bandWidth));
    let inner = erodeBinary(solid, width, height, band);
    let edge = new Uint8Array(width * height);
    let count = 0;

    for (let attempt = 0; attempt < 6; attempt++) {
      edge.fill(0);
      count = 0;
      for (let p = 0; p < width * height; p++) {
        if (solid[p] && !inner[p]) {
          edge[p] = 1;
          count++;
        }
      }
      if (count > width * 0.002) break;
      band = Math.max(2, Math.floor(band * 0.65));
      inner = erodeBinary(solid, width, height, band);
    }

    if (count < width * 0.001) {
      return dilateBinary(solid, width, height, 1);
    }

    const thicken = Math.max(1, Math.round(Math.min(width, height) * 0.004));
    return dilateBinary(edge, width, height, thicken);
  }

  function computeBandWidth(width, height, shape) {
    const base = Math.min(width, height) * (shape === "rectangle" ? 0.028 : 0.024);
    return Math.max(8, Math.min(Math.round(base), 28));
  }

  function canvasFromBinary(binary, width, height) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(width, height);
    writeBinaryToImageData(imageData.data, binary, width, height);
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  function buildOutlineMaskFromSolid(solid, width, height, shape) {
    const band = computeBandWidth(width, height, shape);
    const edge = solidToOutlineRing(solid, width, height, band);
    return canvasFromBinary(edge, width, height);
  }

  function drawRectangle(ctx, w, h) {
    fillWhite(ctx);
    const pad = Math.min(w, h) * 0.06;
    ctx.fillRect(pad, pad, w - pad * 2, h - pad * 2);
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
    const size = Math.min(w, h) * 0.44;
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
    const outer = Math.min(w, h) * 0.47;
    const inner = outer * 0.4;
    fillWhite(ctx);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (Math.PI / 5) * i - Math.PI / 2;
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
    const rw = Math.min(w, h) * 0.46;
    const rh = Math.min(w, h) * 0.52;
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
    const base = Math.min(w, h) * 0.14;
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

  const DRAWERS = {
    rectangle: drawRectangle,
    circle: drawCircle,
    heart: drawHeart,
    star: drawStar,
    cloud: drawCloud,
    diamond: drawDiamond,
  };

  function fillInteriorHoles(data, width, height) {
    const white = (p) => data[p * 4] > 127;
    const outside = new Uint8Array(width * height);
    const stack = [];

    for (let x = 0; x < width; x++) {
      stack.push(x, (height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
      stack.push(y * width, y * width + width - 1);
    }

    while (stack.length) {
      const p = stack.pop();
      if (outside[p] || white(p)) continue;
      outside[p] = 1;
      const x = p % width;
      const y = (p / width) | 0;
      if (x > 0) stack.push(p - 1);
      if (x < width - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - width);
      if (y < height - 1) stack.push(p + width);
    }

    for (let p = 0; p < width * height; p++) {
      if (!white(p) && !outside[p]) {
        data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = 255;
        data[p * 4 + 3] = 255;
      }
    }
  }

  function imageDataToSolidSilhouette(imageData) {
    const { width, height, data } = imageData;
    let lightPixels = 0;
    const lum = new Float32Array(width * height);

    for (let p = 0; p < width * height; p++) {
      const i = p * 4;
      const a = data[i + 3] / 255;
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      lum[p] = l * a + 255 * (1 - a);
      if (lum[p] > 200) lightPixels++;
    }
    const whiteBackground = lightPixels > width * height * 0.4;

    for (let p = 0; p < width * height; p++) {
      const i = p * 4;
      const a = data[i + 3];
      const l = lum[p];
      let inside;
      if (whiteBackground) {
        inside = a > 20 && l < 220;
      } else {
        inside = a > 20 && l > 55;
      }
      const v = inside ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }

    fillInteriorHoles(data, width, height);
    return binaryFromImageData(data, width, height);
  }

  function buildShapeMask(shape, width, height) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);
    const drawer = DRAWERS[shape] || drawCircle;
    drawer(ctx, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const solid = binaryFromImageData(imageData.data, width, height);
    return buildOutlineMaskFromSolid(solid, width, height, shape);
  }

  function buildCustomMask(dataUrl, width, height) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, width, height);

        const scale = Math.min(width / img.width, height / img.height) * 0.88;
        const dw = img.width * scale;
        const dh = img.height * scale;
        const dx = (width - dw) / 2;
        const dy = (height - dh) / 2;

        ctx.drawImage(img, dx, dy, dw, dh);
        const imageData = ctx.getImageData(0, 0, width, height);
        let solid = imageDataToSolidSilhouette(imageData);

        let filled = 0;
        for (let p = 0; p < solid.length; p++) filled += solid[p];
        if (filled < width * height * 0.005) {
          solid = dilateBinary(solid, width, height, 2);
        }

        resolve(buildOutlineMaskFromSolid(solid, width, height, "custom"));
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
    MASK_SIZE,
    getMask,
    setCustomMask,
    clearCustomMask,
    getCustomMaskDataUrl,
    invalidateCache,
    buildShapeMask,
  };
})();

window.ShapeMask = ShapeMask;
