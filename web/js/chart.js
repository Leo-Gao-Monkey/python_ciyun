/**
 * ECharts 动态交互词云
 */
const WordCloudChart = (() => {
  const COLORS = [
    "#5b6fd6", "#7c3aed", "#0891b2", "#059669",
    "#d97706", "#dc2626", "#db2777", "#4f46e5",
    "#0e7490", "#b45309", "#1d4ed8", "#334155",
  ];

  const SHAPE_MAP = {
    rectangle: "circle",
    circle: "circle",
    heart: "cardioid",
    star: "star",
    diamond: "diamond",
    cloud: "circle",
    custom: "circle",
  };

  /** @type {echarts.ECharts | null} */
  let chart = null;
  let containerEl = null;
  let currentMaskImage = null;
  let currentShape = "circle";

  function init(container) {
    containerEl = container;
    container.style.background = "transparent";
    chart = echarts.init(container, null, { renderer: "canvas" });
    return chart;
  }

  function loadMaskImage(dataUrl) {
    return new Promise((resolve, reject) => {
      if (!dataUrl) {
        currentMaskImage = null;
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () => {
        currentMaskImage = img;
        resolve(img);
      };
      img.onerror = () => reject(new Error("形状图片加载失败"));
      img.src = dataUrl;
    });
  }

  async function resolveMask(shape, customMaskUrl) {
    currentShape = shape;
    if (shape === "custom" && customMaskUrl) {
      return loadMaskImage(customMaskUrl);
    }
    if (shape === "cloud" || shape === "rectangle") {
      const canvas = ShapeMask.buildShapeMask(shape, 800, 600);
      return loadMaskImage(canvas.toDataURL("image/png"));
    }
    currentMaskImage = null;
    return null;
  }

  function buildOption(data, shape, forExport = false) {
    const echartsShape = SHAPE_MAP[shape] || "circle";
    const isFullRect = shape === "rectangle";
    const useMask = currentMaskImage && (shape === "custom" || shape === "cloud" || shape === "rectangle");

    const series = {
      type: "wordCloud",
      shape: useMask ? "circle" : echartsShape,
      left: "center",
      top: "center",
      width: isFullRect ? "98%" : "92%",
      height: isFullRect ? "98%" : "92%",
      sizeRange: forExport ? [18, 88] : [14, 68],
      rotationRange: [-45, 45],
      rotationStep: 15,
      gridSize: forExport ? 8 : 10,
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
        textStyle: { shadowBlur: 12, shadowColor: "rgba(91,111,214,0.5)" },
      },
      data: data.map(([name, value]) => ({ name, value })),
    };

    if (useMask) {
      series.maskImage = currentMaskImage;
    }

    return {
      backgroundColor: "transparent",
      animation: !forExport,
      animationDuration: forExport ? 0 : 600,
      animationDurationUpdate: forExport ? 0 : 1000,
      tooltip: { show: !forExport, formatter: (p) => `${p.name}：${p.value} 次` },
      series: [series],
    };
  }

  function waitUntilReady(chartInst, timeoutMs = 4000) {
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
        setTimeout(() => resolve(true), 200);
      };
      chartInst.on("finished", done);
      setTimeout(done, timeoutMs);
    });
  }

  async function render(list, shape, customMaskUrl, exportMode = false) {
    if (!chart) return;
    await resolveMask(shape, customMaskUrl);

    if (!list || list.length === 0) {
      chart.clear();
      return;
    }

    chart.clear();
    chart.setOption(buildOption(list, shape, exportMode), {
      notMerge: true,
      lazyUpdate: false,
    });

    if (exportMode) {
      chart.resize();
      await waitUntilReady(chart, 5000);
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

  /** 使用独立离屏 Chart 导出，避免与页面渲染叠加 */
  async function exportPNG({ list, shape, customMaskUrl, width, height, drawBackground }) {
    if (!list?.length) return null;

    const pr = 2;
    const w = Math.max(Math.round(width), 400);
    const h = Math.max(Math.round(height), 300);
    const outW = w * pr;
    const outH = h * pr;

    const host = document.createElement("div");
    host.style.cssText = `position:fixed;left:-99999px;top:0;width:${w}px;height:${h}px;opacity:0;pointer-events:none;`;
    document.body.appendChild(host);

    const exportChart = echarts.init(host, null, { renderer: "canvas" });
    const savedMask = currentMaskImage;
    const savedShape = currentShape;

    try {
      await resolveMask(shape, customMaskUrl);
      exportChart.resize({ width: w, height: h });
      exportChart.clear();
      exportChart.setOption(buildOption(list, shape, true), { notMerge: true });
      await waitUntilReady(exportChart, 6000);

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
