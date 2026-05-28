/**
 * 大屏展示页 - 仅渲染词云，SSE 无刷新同步
 */
(() => {
  "use strict";

  const BG_PRESETS = {
    "gradient-1": ["#dce4f7", "#c8d4f0", "#e2e8f8"],
    "gradient-2": ["#e4d9f5", "#d4c4ef", "#ebe2f8"],
    "gradient-3": ["#d4ece6", "#c0e0d6", "#e0f0ea"],
    "solid-dark": ["#2a3148", "#343d58", "#2a3148"],
    "solid-light": ["#f5f7fc", "#e8edf7", "#f0f4fa"],
  };

  const chartEl = document.getElementById("wordcloud-chart");
  const bgLayer = document.getElementById("background-layer");
  const emptyHint = document.getElementById("empty-hint");
  const syncIndicator = document.getElementById("sync-indicator");
  const statTotal = document.getElementById("stat-total");
  const statUnique = document.getElementById("stat-unique");
  const displaySourceEl = document.getElementById("display-source");

  const SOURCE_LABELS = { voice: "语音词云", manual: "手动词云", all: "全部词云" };

  let renderPending = false;

  function init() {
    WordCloudChart.init(chartEl);
    SyncHub.init();

    SyncHub.subscribe((payload) => {
      if (WordStore.applySnapshot(payload)) {
        applyBackground();
        refreshChart();
        updateStats();
        updateSourceLabel();
        setSyncStatus(true);
      }
    });

    SyncHub.fetchRemoteState().then((remote) => {
      if (remote) WordStore.applySnapshot(remote);
      applyBackground();
      refreshChart();
      updateStats();
      updateSourceLabel();
      updateSyncMode();
    });

    window.addEventListener("resize", debounce(() => WordCloudChart.resize(), 200));
    requestAnimationFrame(() => WordCloudChart.resize());
  }

  function setSyncStatus(ok) {
    if (!syncIndicator) return;
    if (SyncHub.isServerMode()) {
      syncIndicator.textContent = ok ? "● 实时同步" : "○ 连接中断";
      syncIndicator.classList.toggle("offline", !ok);
      return;
    }
    syncIndicator.textContent = "● 在线展示";
    syncIndicator.classList.remove("offline");
  }

  function updateSyncMode() {
    setSyncStatus(true);
  }

  async function refreshChart() {
    if (renderPending) return;
    renderPending = true;
    const list = WordStore.getList();
    const { shapeMask, customMaskImage } = WordStore.getShapeMask();
    emptyHint.classList.toggle("hidden", list.length > 0);
    await WordCloudChart.render(list, shapeMask, customMaskImage);
    renderPending = false;
  }

  function updateStats() {
    const { total, unique } = WordStore.getStats();
    statTotal.textContent = total;
    statUnique.textContent = unique;
  }

  function updateSourceLabel() {
    if (!displaySourceEl) return;
    const src = WordStore.getDisplaySource();
    displaySourceEl.textContent = SOURCE_LABELS[src] || "词云";
  }

  function applyBackground() {
    const { background, customBgImage } = WordStore.getBackground();
    const isDark = background === "solid-dark" && !customBgImage;
    document.body.classList.toggle("theme-dark", isDark);

    if (customBgImage) {
      bgLayer.style.background = `url(${customBgImage}) center/cover no-repeat`;
      return;
    }
    const colors = BG_PRESETS[background] || BG_PRESETS["gradient-1"];
    bgLayer.style.background = `linear-gradient(145deg, ${colors[0]} 0%, ${colors[1]} 50%, ${colors[2]} 100%)`;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  if (typeof echarts === "undefined") {
    document.getElementById("boot-error-msg").textContent = "ECharts 未加载";
    document.getElementById("boot-error").hidden = false;
  } else {
    init();
  }
})();
