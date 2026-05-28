/**
 * 中文分词 — 有网络时优先 jieba（/api/segment），离线回退词典分词
 */
const Segmenter = (() => {
  const MAX_WORD_LEN = 8;
  const API_TIMEOUT_MS = 15000;
  const HEALTH_TIMEOUT_MS = 6000;

  const STOPWORDS = new Set([
    "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
    "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有",
    "看", "好", "自己", "这", "那", "他", "她", "它", "们", "与", "及", "等",
    "可以", "能够", "通过", "进行", "以及", "其中", "这种", "这些", "那些",
    "啊", "呢", "吧", "吗", "嗯", "哦", "什么", "怎么", "那个", "这个",
    "然后", "因为", "所以", "但是", "如果", "我们", "他们", "你们",
    "让", "将", "被", "把", "对", "从", "向", "以", "为", "所", "还",
    "才", "能", "或", "而", "且", "并", "于", "其", "之", "地",
    "得", "过", "来", "去", "给", "用", "由", "把", "被", "让",
    "作为", "已经", "多个", "不同", "整个", "不仅", "而是", "例如",
  ]);

  const DICT_LIST = [
    "Python", "python", "人工智能", "自然语言处理", "数据挖掘", "语音识别", "文本处理",
    "系统设计", "项目开发", "模型训练", "数据清洗", "云计算", "数据科学", "课堂教学",
    "动态词云", "交互展示", "词频统计", "中文分词", "创新实践", "程序设计", "可视化",
    "数据分析", "机器学习", "深度学习", "词云", "词云可视化", "自动化办公", "Web开发",
    "数字经济", "条件判断", "循环结构", "函数设计", "文件操作", "动态可视化", "数据思维",
    "创新思维", "舆情监测", "课堂互动", "智慧教学", "数据决策", "文本分析", "大数据",
    "声音数据", "工程实践", "智能分析", "数据处理", "编程能力", "界面交互", "综合素养",
    "pyecharts", "ECharts", "jieba", "Counter", "自然语言", "工程能力", "开发效率",
    "面向对象", "数据结构", "基础语法", "图形边界", "形状轮廓", "颜色搭配", "词语大小",
    "热点关键词", "市场反馈", "用户评价", "讨论热点", "新媒体运营",
    "企业管理", "程序开发", "应用技术", "程序设计能力", "数据分析能力", "界面交互能力",
    "创新实践能力", "人工智能应用", "人工智能系统", "人工智能领域", "人工智能相关",
    "人工智能应用能力", "程序设计", "课程", "学生", "教学", "实践", "项目", "函数",
    "变量", "循环", "条件", "模块", "算法", "网络", "自动化", "脚本", "测试", "调试",
    "语法", "框架", "接口", "数据库", "文本", "处理", "统计", "模型", "模式", "自动",
    "交互", "展示", "输入", "输出", "文件", "系统", "计算机", "科学", "技术", "应用",
    "基础", "高级", "方法", "工具", "平台", "环境", "运行", "执行", "对象", "继承",
    "多态", "封装", "异常", "计算", "数值", "图形", "图像", "图表", "组件", "服务",
    "云端", "本地", "在线", "语言", "代码", "编程", "开发", "学习", "设计", "能力",
    "工程", "问题", "程序", "效率", "逻辑", "实现",
  ].sort((a, b) => b.length - a.length);

  let zhSegmenter = null;
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    try {
      zhSegmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
    } catch (_) {
      zhSegmenter = null;
    }
  }

  /** @type {boolean | null} */
  let jiebaAvailable = null;
  let lastEngine = "local";
  let activeSegmentUrl = "";

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
        for (const term of DICT_LIST) {
          if (!/^[\u4e00-\u9fff]+$/.test(term)) continue;
          if (s.startsWith(term, i)) {
            words.push(term);
            i += term.length;
            matched = true;
            break;
          }
        }
        if (matched) continue;
        if (i + 2 <= s.length) {
          words.push(s.slice(i, i + 2));
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

  function segmentByIntl(text) {
    if (!zhSegmenter) return [];
    const words = [];
    for (const { segment, isWordLike } of zhSegmenter.segment(text)) {
      const word = segment.trim();
      if (!word) continue;
      if (word.length > MAX_WORD_LEN && /[\u4e00-\u9fff]/.test(word)) {
        words.push(...dictSegment(word));
        continue;
      }
      if (isWordLike || /^[a-zA-Z]{2,}$/.test(word)) {
        if (isValidWord(word)) words.push(word);
      } else if (/[\u4e00-\u9fff]{2,}/.test(word)) {
        words.push(...dictSegment(word));
      }
    }
    return words;
  }

  function segmentChunk(chunk) {
    if (!chunk) return [];
    const trimmed = chunk.trim();
    if (!trimmed) return [];

    if (/^[a-zA-Z\s]+$/.test(trimmed)) {
      return trimmed.split(/\s+/).filter(isValidWord);
    }

    if (/[\u4e00-\u9fff]/.test(trimmed)) {
      const dictWords = dictSegment(trimmed);
      if (dictWords.length > 0) return dictWords;
    }

    const intlWords = segmentByIntl(trimmed);
    if (intlWords.length > 0) return intlWords;

    if (trimmed.length > MAX_WORD_LEN) return dictSegment(trimmed);

    return isValidWord(trimmed) ? [trimmed] : [];
  }

  function extractWords(text) {
    if (!text || !text.trim()) return [];

    const normalized = text.trim();
    const results = [];
    const chunks = normalized.split(/[\s,，。！？；：、""''""''（）()\[\]【】《》<>·…—\-/\\|]+/);

    for (const chunk of chunks) {
      results.push(...segmentChunk(chunk));
    }

    if (results.length === 0 && chunks.length === 1) {
      results.push(...segmentChunk(normalized));
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
      } catch (_) {
        /* try next endpoint */
      }
    }

    jiebaAvailable = false;
    activeSegmentUrl = "";
    return false;
  }

  async function segmentWithJieba(text) {
    if (!isNetworkAvailable()) return null;

    if (jiebaAvailable === null) {
      await probeJiebaApi(true);
    }
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
      } catch (_) {
        /* try next endpoint */
      }
    }

    jiebaAvailable = false;
    activeSegmentUrl = "";
    return null;
  }

  async function extractWordsAsync(text) {
    if (!text || !text.trim()) return [];

    if (isNetworkAvailable()) {
      const jiebaWords = await segmentWithJieba(text);
      if (jiebaWords && jiebaWords.length > 0) return jiebaWords;
    }

    lastEngine = "local";
    return extractWords(text);
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

  function resplitLongEntries(entries) {
    const map = new Map();
    for (const [key, count] of entries) {
      if (key.length > MAX_WORD_LEN && /[\u4e00-\u9fff]/.test(key)) {
        const parts = extractWords(key);
        if (parts.length > 0) {
          for (const p of parts) {
            map.set(p, (map.get(p) || 0) + count);
          }
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
      lastEngine = "local";
    });
  }

  return {
    extractWords,
    extractWordsAsync,
    probeJiebaApi,
    getLastEngine,
    isJiebaAvailable,
    getActiveSegmentUrl,
    resplitLongEntries,
    STOPWORDS,
    DICT_LIST,
    MAX_WORD_LEN,
  };
})();

window.Segmenter = Segmenter;
