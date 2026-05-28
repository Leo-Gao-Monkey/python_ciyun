/**
 * 词云形状 Mask：词语填满形状内部（白=可排词，黑=透明背景）
 * 对应需求：矩形 / 圆形 / 心形 / 星形 / 云朵 / 菱形
 */
const ShapeMask = (() => {
  /** @type {Map<string, HTMLCanvasElement>} */
  const cache = new Map();
  const outlineCache = new Map();
  let customMaskDataUrl = null;

  const SHAPES = {
    rectangle: { label: "矩形", icon: "▭", pyecharts: "rect" },
    circle: { label: "圆形", icon: "●", pyecharts: "circle" },
    heart: { label: "心形", icon: "♥", pyecharts: "heart" },
    star: { label: "星形", icon: "★", pyecharts: "star" },
    cloud: { label: "云朵", icon: "☁", pyecharts: "cloud" },
    diamond: { label: "菱形", icon: "◆", pyecharts: "diamond" },
  };

  const MASK_SIZE = { w: 500, h: 350 };

  const REF = { w: 500, h: 350 };

  function refScale(w, h) {
    return { sx: w / REF.w, sy: h / REF.h };
  }

  /** 与「词云预期效果.html」一致的黑色实心遮罩（maskImage 直接使用） */
  function buildReferenceMask(shape, width, height) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#000000";
    const drawer = REF_DRAWERS[shape];
    if (drawer) drawer(ctx, width, height);
    return canvas;
  }

  function drawRefRectangle(ctx, w, h) {
    const { sx, sy } = refScale(w, h);
    ctx.fillRect(40 * sx, 70 * sy, 420 * sx, 210 * sy);
  }

  function drawRefCircle(ctx, w, h) {
    const { sx, sy } = refScale(w, h);
    ctx.beginPath();
    ctx.arc(250 * sx, 175 * sy, 135 * Math.min(sx, sy), 0, Math.PI * 2);
    ctx.fill();
  }

  function drawRefHeart(ctx, w, h) {
    const { sx, sy } = refScale(w, h);
    ctx.beginPath();
    ctx.moveTo(250 * sx, 295 * sy);
    ctx.bezierCurveTo(60 * sx, 185 * sy, 90 * sx, 55 * sy, 190 * sx, 85 * sy);
    ctx.bezierCurveTo(225 * sx, 95 * sy, 240 * sx, 120 * sy, 250 * sx, 145 * sy);
    ctx.bezierCurveTo(260 * sx, 120 * sy, 275 * sx, 95 * sy, 310 * sx, 85 * sy);
    ctx.bezierCurveTo(410 * sx, 55 * sy, 440 * sx, 185 * sy, 250 * sx, 295 * sy);
    ctx.fill();
  }

  function drawRefStar(ctx, w, h) {
    const { sx, sy } = refScale(w, h);
    const cx = 250 * sx;
    const cy = 175 * sy;
    const outer = 150 * Math.min(sx, sy);
    const inner = 65 * Math.min(sx, sy);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const angle = (Math.PI / 5) * i - Math.PI / 2;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawRefCloud(ctx, w, h) {
    const { sx, sy } = refScale(w, h);
    ctx.beginPath();
    ctx.arc(170 * sx, 190 * sy, 75 * Math.min(sx, sy), Math.PI * 0.5, Math.PI * 1.5);
    ctx.arc(225 * sx, 120 * sy, 85 * Math.min(sx, sy), Math.PI, Math.PI * 1.85);
    ctx.arc(315 * sx, 130 * sy, 80 * Math.min(sx, sy), Math.PI * 1.15, Math.PI * 2);
    ctx.arc(360 * sx, 200 * sy, 70 * Math.min(sx, sy), Math.PI * 1.5, Math.PI * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(165 * sx, 160 * sy, 205 * sx, 105 * sy);
  }

  function drawRefDiamond(ctx, w, h) {
    const { sx, sy } = refScale(w, h);
    ctx.beginPath();
    ctx.moveTo(250 * sx, 35 * sy);
    ctx.lineTo(455 * sx, 175 * sy);
    ctx.lineTo(250 * sx, 315 * sy);
    ctx.lineTo(45 * sx, 175 * sy);
    ctx.closePath();
    ctx.fill();
  }

  const REF_DRAWERS = {
    rectangle: drawRefRectangle,
    circle: drawRefCircle,
    heart: drawRefHeart,
    star: drawRefStar,
    cloud: drawRefCloud,
    diamond: drawRefDiamond,
  };

  function cacheKey(shape, w, h) {
    return `ref-demo-v1-${shape}-${w}-${h}-${customMaskDataUrl ? "c" : ""}`;
  }

  function createCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  function binaryFromBlackMaskCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    const { width, height, data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const bin = new Uint8Array(width * height);
    for (let p = 0; p < width * height; p++) {
      const i = p * 4;
      bin[p] = data[i + 3] > 127 && data[i] + data[i + 1] + data[i + 2] < 384 ? 1 : 0;
    }
    return bin;
  }

  function solidFromDrawer(shape, width, height) {
    return binaryFromBlackMaskCanvas(buildReferenceMask(shape, width, height));
  }

  /** 实心 mask：与预期效果 HTML 相同，黑色区域可排词 */
  function buildShapeMask(shape, width, height) {
    return buildReferenceMask(shape, width, height);
  }

  function binaryFromImageData(data, width, height) {
    const bin = new Uint8Array(width * height);
    for (let p = 0; p < width * height; p++) {
      bin[p] = data[p * 4] > 127 ? 1 : 0;
    }
    return bin;
  }

  function canvasFromBinaryBlackMask(binary, width, height) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(width, height);
    const { data } = imageData;
    for (let p = 0; p < width * height; p++) {
      const i = p * 4;
      if (binary[p]) {
        data[i] = data[i + 1] = data[i + 2] = 0;
        data[i + 3] = 255;
      } else {
        data[i + 3] = 0;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
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

  function canvasFromBinary(binary, width, height) {
    return canvasFromBinaryBlackMask(binary, width, height);
  }

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

  /** 虚化轮廓：形状整体淡色填充 + Canvas 高斯模糊（预期效果图） */
  function buildOutlineGuideFromSolid(solid, width, height) {
    const band = Math.max(4, Math.round(Math.min(width, height) * 0.014));
    const inner = erodeBinary(solid, width, height, band);

    const src = createCanvas(width, height);
    const sctx = src.getContext("2d");
    const imageData = sctx.createImageData(width, height);
    const { data } = imageData;

    for (let p = 0; p < width * height; p++) {
      if (!solid[p]) continue;
      const i = p * 4;
      const isEdge = !inner[p];
      data[i] = 118;
      data[i + 1] = 142;
      data[i + 2] = 218;
      data[i + 3] = isEdge ? 130 : 55;
    }
    sctx.putImageData(imageData, 0, 0);

    const out = createCanvas(width, height);
    const octx = out.getContext("2d");
    const blurPx = Math.max(8, Math.round(Math.min(width, height) * 0.028));
    octx.filter = `blur(${blurPx}px)`;
    octx.drawImage(src, 0, 0);
    octx.filter = "none";

    octx.globalAlpha = 0.55;
    octx.filter = `blur(${Math.max(4, Math.round(blurPx * 0.45))}px)`;
    octx.drawImage(src, 0, 0);
    octx.globalAlpha = 1;
    octx.filter = "none";

    return out;
  }

  function buildOutlineGuide(shape, width, height) {
    const solid = solidFromDrawer(shape, width, height);
    return buildOutlineGuideFromSolid(solid, width, height);
  }

  function buildCustomOutlineGuide(dataUrl, width, height) {
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
        let solid = imageDataToSolidSilhouette(ctx.getImageData(0, 0, width, height));
        let filled = 0;
        for (let p = 0; p < solid.length; p++) filled += solid[p];
        if (filled < width * height * 0.005) {
          solid = dilateBinary(solid, width, height, 2);
        }
        resolve(buildOutlineGuideFromSolid(solid, width, height));
      };
      img.onerror = () => reject(new Error("无法加载自定义形状"));
      img.src = dataUrl;
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

        const scale = Math.min(width / img.width, height / img.height) * 0.88;
        const dw = img.width * scale;
        const dh = img.height * scale;
        const dx = (width - dw) / 2;
        const dy = (height - dh) / 2;

        ctx.drawImage(img, dx, dy, dw, dh);
        let solid = imageDataToSolidSilhouette(ctx.getImageData(0, 0, width, height));

        let filled = 0;
        for (let p = 0; p < solid.length; p++) filled += solid[p];
        if (filled < width * height * 0.005) {
          solid = dilateBinary(solid, width, height, 2);
        }

        resolve(canvasFromBinary(solid, width, height));
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

  function getOutlineGuide(shape, width, height) {
    const oKey = `outline-blur-v2-${shape}-${width}-${height}-${customMaskDataUrl ? "c" : ""}`;
    if (outlineCache.has(oKey)) {
      return Promise.resolve(outlineCache.get(oKey));
    }

    if (shape === "custom" && customMaskDataUrl) {
      return buildCustomOutlineGuide(customMaskDataUrl, width, height).then((canvas) => {
        outlineCache.set(oKey, canvas);
        return canvas;
      });
    }

    const canvas = buildOutlineGuide(shape, width, height);
    outlineCache.set(oKey, canvas);
    return Promise.resolve(canvas);
  }

  function setCustomMask(dataUrl) {
    customMaskDataUrl = dataUrl;
    cache.clear();
    outlineCache.clear();
  }

  function clearCustomMask() {
    customMaskDataUrl = null;
    cache.clear();
    outlineCache.clear();
  }

  function getCustomMaskDataUrl() {
    return customMaskDataUrl;
  }

  function invalidateCache() {
    cache.clear();
    outlineCache.clear();
  }

  return {
    SHAPES,
    MASK_SIZE,
    getMask,
    getOutlineGuide,
    setCustomMask,
    clearCustomMask,
    getCustomMaskDataUrl,
    invalidateCache,
    buildShapeMask,
  };
})();

window.ShapeMask = ShapeMask;
