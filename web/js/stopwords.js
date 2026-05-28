/**
 * 中文停用词过滤（词云展示与入库前过滤）
 */
const StopwordsFilter = (() => {
  const WORDS = [
    "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
    "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有",
    "看", "好", "自己", "这", "那", "他", "她", "它", "们", "与", "及", "等",
    "可以", "能够", "通过", "进行", "以及", "其中", "这种", "这些", "那些",
    "啊", "呢", "吧", "吗", "嗯", "哦", "什么", "怎么", "那个", "这个",
    "然后", "因为", "所以", "但是", "如果", "我们", "他们", "你们",
    "让", "将", "被", "把", "对", "从", "向", "以", "为", "所", "还",
    "才", "能", "或", "而", "且", "并", "于", "其", "之", "地", "得", "过",
    "来", "给", "用", "由", "把", "被", "让", "又", "再", "还", "都", "只",
    "已经", "还是", "就是", "不是", "什么", "怎么", "为什么", "哪里", "哪个",
    "多少", "怎样", "如何", "这里", "那里", "这样", "那样", "这么", "那么",
    "非常", "十分", "比较", "更加", "最", "更", "太", "挺", "真的", "觉得",
    "认为", "知道", "看到", "听到", "出来", "进去", "起来", "下去", "过来",
    "过去", "一下", "一点", "一些", "一种", "一样", "一直", "一定", "可能",
    "应该", "需要", "希望", "开始", "继续", "完成", "实现", "使用", "包括",
    "根据", "按照", "关于", "对于", "由于", "为了", "作为", "成为", "具有",
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "to", "of", "in",
    "for", "on", "with", "at", "by", "from", "as", "into", "through", "during",
    "before", "after", "above", "below", "between", "under", "again", "further",
    "then", "once", "here", "there", "when", "where", "why", "how", "all",
    "each", "few", "more", "most", "other", "some", "such", "no", "nor", "not",
    "only", "own", "same", "so", "than", "too", "very", "just", "and", "but",
    "if", "or", "because", "until", "while", "this", "that", "these", "those",
    "it", "its", "they", "them", "their", "we", "us", "our", "you", "your",
    "he", "him", "his", "she", "her", "i", "me", "my",
  ];

  const stopSet = new Set(WORDS.map((w) => w.toLowerCase()));

  function normalize(word) {
    return word.trim().toLowerCase();
  }

  function isStopword(word) {
    const w = normalize(word);
    if (!w) return true;
    if (stopSet.has(w)) return true;
    if (w.length === 1 && /[\u4e00-\u9fff]/.test(w)) return true;
    return false;
  }

  function filterWords(words) {
    const allowed = [];
    const stopped = [];
    const seen = new Set();
    for (const raw of words) {
      const word = raw.trim();
      if (!word) continue;
      if (isStopword(word)) {
        if (!seen.has(word)) {
          stopped.push(word);
          seen.add(word);
        }
      } else {
        allowed.push(word);
      }
    }
    return { allowed, stopped };
  }

  return { filterWords, isStopword, stopSet };
})();

window.StopwordsFilter = StopwordsFilter;
