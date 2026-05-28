/**
 * ECharts 词云 — maskImage 形状 + 按词量自适应字号填满轮廓
 */
const WordCloudChart = (() => {
  const COLORS = [
    "#2563eb", "#16a34a", "#dc2626", "#9333ea",
    "#f97316", "#0891b2", "#db2777", "#65a30d",
  ];

  const ROTATION_RANGE = [-20, 20];
  const ROTATION_STEP = 15;
  const MASK_REF_AREA = 500 * 350;
  const COVERAGE_TARGET = 0.68;

  /** @type {echarts.ECharts | null} */
  let chart = null;
  let containerEl = null;
  let currentMaskImage = null;
  let currentShape = "circle";
  let maskFillRatio = 0.38;

  function init(container) {
    containerEl = container;
    container.style.background = "transparent";
    chart = echarts.init(container, null, { renderer: "canvas" });
    return chart;
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function loadMaskImage(dataUrl) {
    return new Promise((resolve, reject) => {
      if (!dataUrl) {
        currentMaskImage = null;
        maskFillRatio = 1;
        resolve(null);
        return;
      }
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        currentMaskImage = img;
        resolve(img);
      };
      img.onerror = () => reject(new Error("形状图片加载失败"));
      img.src = dataUrl;
    });
  }

  function fillRatioFromCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    const { width, height, data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let shape = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 127 && data[i] + data[i + 1] + data[i + 2] < 384) shape++;
    }
    return shape / (width * height);
  }

  function getContainerScale() {
    if (!containerEl) return 1;
    const w = containerEl.clientWidth || 500;
    const h = containerEl.clientHeight || 350;
    return Math.sqrt((w * h) / MASK_REF_AREA);
  }

  /**
   * 根据唯一词数、遮罩面积、词长估算字号，使词语尽量铺满形状内部
   */
  function computeAdaptiveLayout(list, forExport = false) {
    const n = Math.max(list.length, 1);
    const fill = maskFillRatio || 0.38;
    const shapeArea = MASK_REF_AREA * fill;
    const charSlots = list.reduce((sum, [word]) => sum + Math.max(word.length, 1), 0);
    const avgLen = charSlots / n;

    let maxFont = Math.sqrt(shapeArea / (n * avgLen * 0.44)) * 1.18;

    if (n <= 4) maxFont *= 1.45;
    else if (n <= 8) maxFont *= 1.32;
    else if (n <= 14) maxFont *= 1.2;
    else if (n <= 22) maxFont *= 1.1;
    else if (n >= 50) maxFont *= 0.9;
    else if (n >= 75) maxFont *= 0.82;

    maxFont *= getContainerScale();
    if (forExport) maxFont *= 1.06;

    maxFont = clamp(Math.round(maxFont), 32, 112);

    const minRatio = n <= 6 ? 0.48 : n <= 12 ? 0.42 : n <= 25 ? 0.36 : 0.3;
    const minFont = clamp(Math.round(maxFont * minRatio), 14, maxFont - 4);

    let gridSize = 4;
    if (n >= 65) gridSize = 5;
    else if (n >= 90) gridSize = 6;

    return { gridSize, sizeRange: [minFont, maxFont], minRatio };
  }

  function boostLayout(layout, factor = 1.15) {
    const [minF, maxF] = layout.sizeRange;
    return {
      ...layout,
      sizeRange: [
        clamp(Math.round(minF * factor), 14, 100),
        clamp(Math.round(maxF * factor), minF + 8, 120),
      ],
    };
  }

  /** 词频映射到字号区间，低频词也保留足够大小以填充边缘 */
  function prepareWordData(list, layout) {
    const sorted = [...list].sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) return [];

    const maxC = sorted[0][1];
    const minC = sorted[sorted.length - 1][1];
    const floor = layout.minRatio;
    const [minS, maxS] = layout.sizeRange;

    return sorted.map(([name, count]) => {
      let t = maxC === minC ? 1 : (count - minC) / (maxC - minC);
      t = floor + t * (1 - floor);
      return {
        name,
        value: minS + t * (maxS - minS),
        count,
      };
    });
  }

  function buildOption(data, layout, forExport = false) {
    const useMask = !!currentMaskImage;
    const wordData = prepareWordData(data, layout);

    const series = {
      type: "wordCloud",
      maskImage: useMask ? currentMaskImage : undefined,
      left: "center",
      top: "center",
      width: "100%",
      height: "100%",
      gridSize: layout.gridSize,
      sizeRange: layout.sizeRange,
      rotationRange: ROTATION_RANGE,
      rotationStep: ROTATION_STEP,
      shrinkToFit: true,
      drawOutOfBound: false,
      layoutAnimation: !forExport,
      textStyle: {
        fontFamily: "Microsoft YaHei, PingFang SC, sans-serif",
        fontWeight: "bold",
        color() {
          return COLORS[Math.floor(Math.random() * COLORS.length)];
        },
      },
      emphasis: {
        focus: "self",
        textStyle: { shadowBlur: 8, shadowColor: "#999" },
      },
      data: wordData,
    };

    return {
      backgroundColor: "transparent",
      animation: !forExport,
      animationDuration: forExport ? 0 : 600,
      animationDurationUpdate: forExport ? 0 : 1000,
      tooltip: {
        show: !forExport,
        formatter: (p) => `${p.name}：${p.data?.count ?? p.value} 次`,
      },
      series: [series],
    };
  }

  function measureWordCoverage(chartInst, maskImg) {
    if (!chartInst || !maskImg) return 1;

    const chartCanvas = captureFromChart(chartInst, 1);
    if (!chartCanvas?.width) return 1;

    const w = chartCanvas.width;
    const h = chartCanvas.height;
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = w;
    maskCanvas.height = h;
    const mctx = maskCanvas.getContext("2d");
    mctx.drawImage(maskImg, 0, 0, w, h);
    const maskPx = mctx.getImageData(0, 0, w, h).data;
    const wordPx = chartCanvas.getContext("2d").getImageData(0, 0, w, h).data;

    let shapePixels = 0;
    let covered = 0;
    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      const inShape = maskPx[i + 3] > 127 && maskPx[i] + maskPx[i + 1] + maskPx[i + 2] < 384;
      if (!inShape) continue;
      shapePixels++;
      if (wordPx[i + 3] > 35) covered++;
    }
    return shapePixels > 0 ? covered / shapePixels : 1;
  }

  function waitUntilReady(chartInst, timeoutMs = 6000) {
    return new Promise((resolve) => {
      if (!chartInst) {
        resolve(false);
        return;
      }
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        chartInst.off("finished", done);
        setTimeout(() => resolve(true), 400);
      };
      chartInst.on("finished", done);
      setTimeout(done, timeoutMs);
    });
  }

  async function renderWithLayout(list, layout, exportMode) {
    chart.resize();
    chart.clear();
    chart.setOption(buildOption(list, layout, exportMode), {
      notMerge: true,
      lazyUpdate: false,
    });
    chart.resize();
    await waitUntilReady(chart, exportMode ? 9000 : 6000);
    chart.resize();
  }

  async function resolveMask(shape, customMaskUrl) {
    currentShape = shape;
    const { w: maskW, h: maskH } = ShapeMask.MASK_SIZE;

    try {
      if (shape === "custom" && customMaskUrl) {
        ShapeMask.setCustomMask(customMaskUrl);
      }
      const canvas = await ShapeMask.getMask(
        shape === "custom" ? "custom" : shape,
        maskW,
        maskH,
      );
      if (!canvas) {
        currentMaskImage = null;
        maskFillRatio = 1;
        return null;
      }
      maskFillRatio = fillRatioFromCanvas(canvas);
      return loadMaskImage(canvas.toDataURL("image/png"));
    } catch (err) {
      console.warn("Mask 加载失败", err);
      currentMaskImage = null;
      maskFillRatio = 1;
      return null;
    }
  }

  async function render(list, shape, customMaskUrl, exportMode = false) {
    if (!chart) return;
    await resolveMask(shape, customMaskUrl);

    if (!list || list.length === 0) {
      chart.clear();
      return;
    }

    let layout = computeAdaptiveLayout(list, exportMode);
    await renderWithLayout(list, layout, exportMode);

    if (!exportMode && currentMaskImage && list.length <= 80) {
      const coverage = measureWordCoverage(chart, currentMaskImage);
      if (coverage < COVERAGE_TARGET && layout.sizeRange[1] < 115) {
        layout = boostLayout(layout, coverage < 0.45 ? 1.28 : 1.16);
        await renderWithLayout(list, layout, false);
      }
    }
  }

  function captureFromChart(chartInst, pixelRatio = 2) {
    if (!chartInst) return null;
    const zr = chartInst.getZr();
    if (zr?.painter?.getRenderedCanvas) {
      try {
        return zr.painter.getRenderedCanvas({ backgroundColor: "transparent", pixelRatio });
      } catch (_) { /* fallback */ }
    }
    const domCanvas = chartInst.getDom()?.querySelector("canvas");
    if (domCanvas?.width > 0) {
      const out = document.createElement("canvas");
      out.width = domCanvas.width;
      out.height = domCanvas.height;
      out.getContext("2d").drawImage(domCanvas, 0, 0);
      return out;
    }
    return null;
  }

  async function exportPNG({ list, shape, customMaskUrl, width, height, drawBackground }) {
    if (!list?.length) return null;

    const pr = 2;
    const w = Math.max(Math.round(width), 400);
    const h = Math.max(Math.round(height), 500);
    const outW = w * pr;
    const outH = h * pr;

    const host = document.createElement("div");
    host.style.cssText = `position:fixed;left:-99999px;top:0;width:${w}px;height:${h}px;opacity:0;pointer-events:none;`;
    document.body.appendChild(host);

    const exportChart = echarts.init(host, null, { renderer: "canvas" });
    const savedMask = currentMaskImage;
    const savedShape = currentShape;
    const savedRatio = maskFillRatio;

    try {
      await resolveMask(shape, customMaskUrl);
      const layout = computeAdaptiveLayout(list, true);
      exportChart.resize({ width: w, height: h });
      exportChart.clear();
      exportChart.setOption(buildOption(list, layout, true), { notMerge: true });
      await waitUntilReady(exportChart, 10000);

      const chartCanvas = captureFromChart(exportChart, pr);
      if (!chartCanvas?.width) return null;

      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = outW;
      exportCanvas.height = outH;
      const ctx = exportCanvas.getContext("2d");

      if (drawBackground) await drawBackground(ctx, outW, outH);
      ctx.drawImage(chartCanvas, 0, 0, outW, outH);
      return exportCanvas;
    } finally {
      exportChart.dispose();
      host.remove();
      currentMaskImage = savedMask;
      currentShape = savedShape;
      maskFillRatio = savedRatio;
      if (chart && containerEl) {
        chart.resize();
        await render(list, shape, customMaskUrl, false);
      }
    }
  }

  function resize() {
    chart?.resize();
  }

  function dispose() {
    chart?.dispose();
    chart = null;
  }

  return { init, render, exportPNG, resize, dispose };
})();

window.WordCloudChart = WordCloudChart;
