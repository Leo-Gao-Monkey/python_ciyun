/**
 * 中文分词 - Intl.Segmenter + 标点切分 + 长句二次拆分 + 常用词词典
 */
const Segmenter = (() => {
  const MAX_WORD_LEN = 8;

  const STOPWORDS = new Set([
    "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
    "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有",
    "看", "好", "自己", "这", "那", "他", "她", "它", "们", "与", "及", "等",
    "可以", "能够", "通过", "进行", "以及", "其中", "这种", "这些", "那些",
    "啊", "呢", "吧", "吗", "嗯", "哦", "什么", "怎么", "那个", "这个",
    "然后", "因为", "所以", "但是", "如果", "我们", "他们", "你们",
    "让", "将", "被", "把", "对", "从", "向", "以", "为", "所", "还", "就",
    "才", "能", "会", "要", "或", "而", "且", "并", "于", "其", "之", "地",
    "得", "过", "来", "去", "给", "用", "由", "到", "把", "被", "让",
  ]);

  // 常用词词典（按长度降序，优先最长匹配）
  const DICT_LIST = [
    "Python", "python", "程序设计", "可视化", "词云", "数据分析", "机器学习",
    "深度学习", "自然语言", "工程能力", "开发效率", "可读性", "学习者",
    "入门编程", "实际问题", "面向对象", "数据结构", "逻辑", "实现", "解决",
    "提升", "强调", "适合", "理想", "语言", "代码", "编程", "开发", "学习",
    "入门", "效率", "能力", "工程", "实际", "问题", "快速", "可读", "程序",
    "设计", "课程", "学生", "教学", "实践", "项目", "函数", "变量", "循环",
    "条件", "模块", "算法", "网络", "自动化", "脚本", "测试", "调试", "语法",
    "框架", "接口", "数据库", "文本", "处理", "统计", "模型", "模式", "自动",
    "升级", "交互", "展示", "输入", "输出", "文件", "系统", "计算机", "科学",
    "技术", "应用", "基础", "高级", "方法", "工具", "平台", "环境", "安装",
    "运行", "执行", "编译", "解释", "对象", "继承", "多态", "封装", "异常",
    "迭代", "表达", "计算", "数值", "图形", "图像", "报表", "图表", "组件",
    "服务", "云端", "本地", "在线",
  ].sort((a, b) => b.length - a.length);

  let zhSegmenter = null;
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    try {
      zhSegmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
    } catch (_) {
      zhSegmenter = null;
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

  /** 词典正向最大匹配（处理 Intl 无法切开的超长中文） */
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
        // 双字 fallback
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

    const intlWords = segmentByIntl(trimmed);
    if (intlWords.length > 0) return intlWords;

    if (trimmed.length > MAX_WORD_LEN) return dictSegment(trimmed);

    return isValidWord(trimmed) ? [trimmed] : [];
  }

  function extractWords(text) {
    if (!text || !text.trim()) return [];

    const normalized = text.trim();
    const results = [];

    // 先按标点与空白切分为短语，再对每个短语分词
    const chunks = normalized.split(/[\s,，。！？；：、""''""''（）()\[\]【】《》<>·…—\-/\\|]+/);

    for (const chunk of chunks) {
      results.push(...segmentChunk(chunk));
    }

    // 若仍为空且原文无标点，整句再走一遍
    if (results.length === 0 && chunks.length === 1) {
      results.push(...segmentByIntl(normalized));
      if (results.length === 0 && normalized.length > MAX_WORD_LEN) {
        results.push(...dictSegment(normalized));
      }
    }

    return results;
  }

  /** 重新拆分词库中过长的词条（加载历史数据时调用） */
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

  return { extractWords, resplitLongEntries, STOPWORDS, MAX_WORD_LEN };
})();

window.Segmenter = Segmenter;
