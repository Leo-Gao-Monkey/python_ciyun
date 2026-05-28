/**
 * 词频存储 - 语音与手动分开展示
 */
const WordStore = (() => {
  const STORAGE_KEY = "ciyun-kiosk-v4";

  /** @type {Map<string, number>} */
  let voiceFrequencies = new Map();
  /** @type {Map<string, number>} */
  let manualFrequencies = new Map();
  /** @type {'voice'|'manual'|'all'} */
  let displaySource = "voice";

  let background = "gradient-1";
  let customBgImage = null;
  let shapeMask = "circle";
  let customMaskImage = null;
  let revision = 0;

  /** 词云图最多展示的高频词数量 */
  const MAX_CLOUD_WORDS = 50;

  function mergeMaps(a, b) {
    const out = new Map(a);
    for (const [k, v] of b) out.set(k, (out.get(k) || 0) + v);
    return out;
  }

  function mapToObj(m) {
    return Object.fromEntries(m);
  }

  function objToMap(o) {
    return new Map(Object.entries(o || {}));
  }

  function emit() {
    SyncHub.broadcastState(getSnapshot());
  }

  function getSnapshot() {
    return {
      revision,
      voiceFrequencies: mapToObj(voiceFrequencies),
      manualFrequencies: mapToObj(manualFrequencies),
      displaySource,
      background,
      customBgImage,
      shapeMask,
      customMaskImage,
      updatedAt: new Date().toISOString(),
    };
  }

  function applySnapshot(data, silent = true) {
    if (!data) return false;
    if (data.revision != null && data.revision <= revision && revision > 0) {
      return false;
    }

    // 兼容 v3 单 map 数据
    if (data.frequencies && !data.voiceFrequencies) {
      manualFrequencies = objToMap(data.frequencies);
      voiceFrequencies = new Map();
    } else {
      voiceFrequencies = objToMap(data.voiceFrequencies);
      manualFrequencies = objToMap(data.manualFrequencies);
    }

    displaySource = data.displaySource || "voice";
    background = data.background || "gradient-1";
    customBgImage = data.customBgImage || null;
    shapeMask = data.shapeMask || "circle";
    if (shapeMask === "china") shapeMask = "circle";
    customMaskImage = data.customMaskImage || null;
    revision = data.revision || revision;

    if (customMaskImage) ShapeMask.setCustomMask(customMaskImage);
    else if (shapeMask !== "custom") ShapeMask.clearCustomMask();
    ShapeMask.invalidateCache();

    resplitIfNeeded();

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(getSnapshot()));
    } catch (_) { /* ignore */ }

    return true;
  }

  function resplitIfNeeded() {
    for (const map of [voiceFrequencies, manualFrequencies]) {
      let needs = false;
      for (const k of map.keys()) {
        if (k.length > Segmenter.MAX_WORD_LEN) { needs = true; break; }
      }
      if (needs) {
        const fixed = Segmenter.resplitLongEntries(map);
        if (map === voiceFrequencies) voiceFrequencies = fixed;
        else manualFrequencies = fixed;
      }
    }
  }

  function load() {
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        raw = localStorage.getItem("ciyun-kiosk-v3");
      }
      if (!raw) return;
      applySnapshot(JSON.parse(raw), true);
    } catch (err) {
      console.warn("读取本地数据失败", err);
      voiceFrequencies = new Map();
      manualFrequencies = new Map();
    }
  }

  function save() {
    revision += 1;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(getSnapshot()));
    } catch (err) {
      console.warn("保存失败", err);
    }
    emit();
  }

  function targetMap(source) {
    return source === "voice" ? voiceFrequencies : manualFrequencies;
  }

  function addWords(words, source = "manual") {
    if (!words || words.length === 0) return { added: 0, blocked: [], stopped: [] };

    const { allowed: sensAllowed, blocked } = SensitiveFilter.filterWords(words);
    const { allowed, stopped } = StopwordsFilter.filterWords(sensAllowed);
    const map = targetMap(source);
    let added = 0;

    for (const word of allowed) {
      const parts = word.length > Segmenter.MAX_WORD_LEN
        ? Segmenter.extractWords(word)
        : [word];
      for (const p of parts) {
        if (!p.trim() || StopwordsFilter.isStopword(p)) continue;
        map.set(p, (map.get(p) || 0) + 1);
        added += 1;
      }
    }
    if (added > 0) save();
    return { added, blocked, stopped };
  }

  /** 用词汇列表替换指定来源的词频（用于编辑后重新提交） */
  function replaceWords(words, source = "manual") {
    if (!words || words.length === 0) {
      targetMap(source).clear();
      save();
      return { added: 0, blocked: [], stopped: [] };
    }

    const { allowed: sensAllowed, blocked } = SensitiveFilter.filterWords(words);
    const { allowed, stopped } = StopwordsFilter.filterWords(sensAllowed);
    const map = targetMap(source);
    map.clear();
    let added = 0;

    for (const word of allowed) {
      const parts = word.length > Segmenter.MAX_WORD_LEN
        ? Segmenter.extractWords(word)
        : [word];
      for (const p of parts) {
        if (!p.trim() || StopwordsFilter.isStopword(p)) continue;
        map.set(p, (map.get(p) || 0) + 1);
        added += 1;
      }
    }
    save();
    return { added, blocked, stopped };
  }

  function getFullListForSource(source) {
    const map = source === "voice" ? voiceFrequencies
      : source === "manual" ? manualFrequencies
        : mergeMaps(voiceFrequencies, manualFrequencies);
    return Array.from(map.entries())
      .filter(([word]) => !StopwordsFilter.isStopword(word))
      .sort((a, b) => b[1] - a[1]);
  }

  function getActiveMap() {
    if (displaySource === "all") return mergeMaps(voiceFrequencies, manualFrequencies);
    return displaySource === "voice" ? voiceFrequencies : manualFrequencies;
  }

  function getFullList() {
    return Array.from(getActiveMap().entries())
      .filter(([word]) => !StopwordsFilter.isStopword(word))
      .sort((a, b) => b[1] - a[1]);
  }

  function getList() {
    return getFullList().slice(0, MAX_CLOUD_WORDS);
  }

  function getStats() {
    const full = getFullList();
    const list = getList();
    let total = 0;
    for (const [, count] of full) total += count;
    return {
      total,
      unique: full.length,
      displayed: list.length,
      maxDisplay: MAX_CLOUD_WORDS,
    };
  }

  function isEmpty() {
    return getList().length === 0;
  }

  function isAllEmpty() {
    return voiceFrequencies.size === 0 && manualFrequencies.size === 0;
  }

  /** 清空当前展示来源的词云 */
  function clearDisplay() {
    if (displaySource === "all") {
      voiceFrequencies = new Map();
      manualFrequencies = new Map();
    } else if (displaySource === "voice") {
      voiceFrequencies = new Map();
    } else {
      manualFrequencies = new Map();
    }
    save();
  }

  /** 清空全部词云数据 */
  function clearAll() {
    voiceFrequencies = new Map();
    manualFrequencies = new Map();
    save();
  }

  function setDisplaySource(source) {
    if (displaySource === source) return;
    displaySource = source;
    save();
  }

  function getDisplaySource() {
    return displaySource;
  }

  function exportJSON() {
    return JSON.stringify(getSnapshot(), null, 2);
  }

  function setBackground(value) {
    background = value;
    customBgImage = null;
    save();
  }

  function setCustomBgImage(dataUrl) {
    customBgImage = dataUrl;
    background = "custom";
    save();
  }

  function getBackground() {
    return { background, customBgImage };
  }

  function setShapeMask(shape) {
    shapeMask = shape;
    if (shape !== "custom") {
      customMaskImage = null;
      ShapeMask.clearCustomMask();
    }
    ShapeMask.invalidateCache();
    save();
  }

  function setCustomMaskImage(dataUrl) {
    customMaskImage = dataUrl;
    shapeMask = "custom";
    ShapeMask.setCustomMask(dataUrl);
    ShapeMask.invalidateCache();
    save();
  }

  function getShapeMask() {
    return { shapeMask, customMaskImage };
  }

  load();

  return {
    STORAGE_KEY,
    addWords,
    replaceWords,
    getList,
    getFullList,
    getFullListForSource,
    getStats,
    MAX_CLOUD_WORDS,
    isEmpty,
    isAllEmpty,
    clearDisplay,
    clearAll,
    setDisplaySource,
    getDisplaySource,
    exportJSON,
    setBackground,
    setCustomBgImage,
    getBackground,
    setShapeMask,
    setCustomMaskImage,
    getShapeMask,
    applySnapshot,
    getSnapshot,
  };
})();

window.WordStore = WordStore;
