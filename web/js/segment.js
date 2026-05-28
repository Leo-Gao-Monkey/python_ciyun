/**
 * 中文分词 — 有网络优先 jieba；离线加载 data/keywords.txt + 用户自定义词
 */
const Segmenter = (() => {
  const MAX_WORD_LEN = 12;
  const API_TIMEOUT_MS = 15000;
  const HEALTH_TIMEOUT_MS = 6000;
  const USER_DICT_KEY = "ciyun-user-keywords";
  const KEYWORDS_URL = "data/keywords.txt";

  const STOPWORDS = new Set([
    "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
    "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有",
    "看", "好", "自己", "这", "那", "他", "她", "它", "们", "与", "及", "等",
    "可以", "能够", "通过", "进行", "以及", "其中", "这种", "这些", "那些",
    "啊", "呢", "吧", "吗", "嗯", "哦", "什么", "怎么", "那个", "这个",
    "然后", "因为", "所以", "但是", "如果", "我们", "他们", "你们",
    "让", "将", "被", "把", "对", "从", "向", "以", "为", "所", "还",
    "才", "能", "或", "而", "且", "并", "于", "其", "之", "地",
    "得", "过", "来", "去", "给", "用", "由",
    "作为", "已经", "多个", "不同", "整个", "不仅", "而是", "例如", "之一",
    "正在", "为了", "虽然", "然而", "因此", "其", "并", "被", "将",
    "之一", "之二", "之三", "其中", "各种", "某个", "某些", "每个",
  ]);

  /** @type {string[]} */
  let dictList = [];
  let dictReady = false;
  let initPromise = null;

  /** @type {boolean | null} */
  let jiebaAvailable = null;
  let lastEngine = "local";
  let activeSegmentUrl = "";

  function rebuildDictList(extra = []) {
    const seen = new Set();
    const merged = [];
    for (const w of [...extra, ...loadUserDict(), ...dictList]) {
      const term = String(w).trim();
      if (term.length < 2 || seen.has(term)) continue;
      seen.add(term);
      merged.push(term);
    }
    dictList = merged.sort((a, b) => b.length - a.length);
  }

  function loadUserDict() {
    try {
      const raw = localStorage.getItem(USER_DICT_KEY);
      if (!raw) return [];
      return raw.split(/[\n,，;；]+/).map((s) => s.trim()).filter((s) => s.length >= 2);
    } catch (_) {
      return [];
    }
  }

  function saveUserDict(lines) {
    const text = lines.filter((s) => s.trim().length >= 2).join("\n");
    localStorage.setItem(USER_DICT_KEY, text);
    rebuildDictList();
  }

  function getUserDictText() {
    return loadUserDict().join("\n");
  }

  async function loadKeywordsFile() {
    const bases = [
      KEYWORDS_URL,
      "../data/keywords.txt",
      "/data/keywords.txt",
    ];
    for (const url of bases) {
      try {
        const res = await fetch(url, { cache: "no-cache" });
        if (!res.ok) continue;
        const text = await res.text();
        const words = text.split("\n")
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"))
          .map((line) => line.split(/\s+/)[0])
          .filter((w) => w.length >= 2);
        if (words.length > 0) {
          dictList = words;
          return words.length;
        }
      } catch (_) {
        /* try next path */
      }
    }
    return 0;
  }

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      await loadKeywordsFile();
      rebuildDictList();
      dictReady = true;
      if (isNetworkAvailable()) {
        await probeJiebaApi(true);
      }
    })();
    return initPromise;
  }

  function isNetworkAvailable() {
    return typeof navigator === "undefined" ? true : navigator.onLine;
  }

  function normalizeSegmentUrl(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  function getSegmentApiUrls() {
    const urls = [];
    const cfg = normalizeSegmentUrl(window.CIYUN_CONFIG?.segmentApi);
    if (cfg) urls.push(cfg);
    const same = normalizeSegmentUrl(`${window.location.origin}/api/segment`);
    if (!urls.includes(same)) urls.push(same);
    if (!urls.includes("/api/segment")) urls.push("/api/segment");
    return [...new Set(urls)];
  }

  function healthUrl(segmentUrl) {
    const base = normalizeSegmentUrl(segmentUrl);
    if (base.endsWith("/api/segment")) return `${base}/health`;
    return `${base}/health`;
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  function isValidWord(word) {
    if (!word) return false;
    const trimmed = word.trim();
    if (!trimmed || trimmed.length > MAX_WORD_LEN) return false;
    if (STOPWORDS.has(trimmed)) return false;
    if (/^[a-zA-Z]+$/.test(trimmed)) return trimmed.length >= 2;
    if (/^[\u4e00-\u9fff]+$/.test(trimmed)) return trimmed.length >= 2;
    if (/[\u4e00-\u9fff]/.test(trimmed) || /[a-zA-Z]/.test(trimmed)) {
      return trimmed.length >= 2;
    }
    return false;
  }

  function dictSegment(text) {
    const words = [];
    let i = 0;
    const s = text.trim();
    while (i < s.length) {
      if (/[a-zA-Z]/.test(s[i])) {
        const m = s.slice(i).match(/^[a-zA-Z]+/);
        if (m) {
          words.push(m[0]);
          i += m[0].length;
          continue;
        }
      }
      if (/[\u4e00-\u9fff]/.test(s[i])) {
        let matched = false;
        for (const term of dictList) {
          if (/^[\u4e00-\u9fff]+$/.test(term) && s.startsWith(term, i)) {
            words.push(term);
            i += term.length;
            matched = true;
            break;
          }
        }
        if (matched) continue;
        if (i + 2 <= s.length) {
          const two = s.slice(i, i + 2);
          if (!STOPWORDS.has(two)) words.push(two);
          i += 2;
        } else {
          i += 1;
        }
        continue;
      }
      i += 1;
    }
    return words.filter(isValidWord);
  }

  /** 按中英文连续块切分，避免标点打断整词 */
  function extractWordsLocal(text) {
    if (!text || !text.trim()) return [];
    const results = [];
    const runs = text.match(/[a-zA-Z]+|[\u4e00-\u9fff]+/g) || [];
    for (const run of runs) {
      if (/^[a-zA-Z]+$/i.test(run)) {
        if (isValidWord(run)) results.push(run);
      } else {
        results.push(...dictSegment(run));
      }
    }
    return results;
  }

  async function probeJiebaApi(force = false) {
    if (!force && jiebaAvailable !== null) return jiebaAvailable;
    if (!isNetworkAvailable()) {
      jiebaAvailable = false;
      activeSegmentUrl = "";
      return false;
    }
    for (const url of getSegmentApiUrls()) {
      try {
        const res = await fetchWithTimeout(healthUrl(url), { method: "GET" }, HEALTH_TIMEOUT_MS);
        if (!res.ok) continue;
        const data = await res.json();
        if (data.available && data.engine === "jieba") {
          jiebaAvailable = true;
          activeSegmentUrl = url;
          return true;
        }
      } catch (_) { /* next */ }
    }
    jiebaAvailable = false;
    activeSegmentUrl = "";
    return false;
  }

  async function segmentWithJieba(text) {
    if (!isNetworkAvailable()) return null;
    if (jiebaAvailable === null) await probeJiebaApi(true);
    if (!jiebaAvailable) return null;

    const urls = activeSegmentUrl
      ? [activeSegmentUrl, ...getSegmentApiUrls().filter((u) => u !== activeSegmentUrl)]
      : getSegmentApiUrls();

    for (const url of urls) {
      try {
        const res = await fetchWithTimeout(
          url,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          },
          API_TIMEOUT_MS,
        );
        if (!res.ok) continue;
        const data = await res.json();
        if (!Array.isArray(data.words)) continue;
        const words = data.words.map((w) => String(w).trim()).filter(isValidWord);
        if (words.length === 0) continue;
        lastEngine = "jieba";
        jiebaAvailable = true;
        activeSegmentUrl = url;
        return words;
      } catch (_) { /* next */ }
    }
    jiebaAvailable = false;
    activeSegmentUrl = "";
    return null;
  }

  async function extractWordsAsync(text) {
    if (!text || !text.trim()) return [];
    await init();

    if (isNetworkAvailable()) {
      const jiebaWords = await segmentWithJieba(text);
      if (jiebaWords && jiebaWords.length > 0) return jiebaWords;
    }

    lastEngine = dictReady ? "dict" : "local";
    return extractWordsLocal(text);
  }

  function extractWords(text) {
    return extractWordsLocal(text);
  }

  function getLastEngine() {
    return lastEngine;
  }

  function isJiebaAvailable() {
    return jiebaAvailable === true;
  }

  function getActiveSegmentUrl() {
    return activeSegmentUrl;
  }

  function getDictSize() {
    return dictList.length;
  }

  function resplitLongEntries(entries) {
    const map = new Map();
    for (const [key, count] of entries) {
      if (key.length > MAX_WORD_LEN && /[\u4e00-\u9fff]/.test(key)) {
        const parts = extractWordsLocal(key);
        if (parts.length > 0) {
          for (const p of parts) map.set(p, (map.get(p) || 0) + count);
          continue;
        }
      }
      map.set(key, (map.get(key) || 0) + count);
    }
    return map;
  }

  if (typeof window !== "undefined") {
    window.addEventListener("online", () => {
      jiebaAvailable = null;
      probeJiebaApi(true);
    });
    window.addEventListener("offline", () => {
      jiebaAvailable = false;
      activeSegmentUrl = "";
      lastEngine = "dict";
    });
  }

  return {
    init,
    extractWords,
    extractWordsAsync,
    probeJiebaApi,
    getLastEngine,
    isJiebaAvailable,
    getActiveSegmentUrl,
    getDictSize,
    getUserDictText,
    saveUserDict,
    resplitLongEntries,
    STOPWORDS,
    MAX_WORD_LEN,
  };
})();

window.Segmenter = Segmenter;
