/**
 * 敏感词过滤模块
 * 提交词云前拦截，支持精确匹配与包含匹配
 */
const SensitiveFilter = (() => {
  // 可按需扩展：每行一个词，支持 classroom / 公开演示场景
  const SENSITIVE_WORDS = [
    // 脏话辱骂
    "傻逼", "傻B", "sb", "SB", "草泥马", "他妈的", "TMD", "tmd", "去死", "滚蛋",
    "废物", "白痴", "智障", "贱人", "狗屎", "混蛋", "王八蛋", "神经病",
    // 涉政敏感（示例，请按实际需要补充）
    "法轮功", "台独", "藏独", "港独", "分裂国家", "颠覆政权",
    // 色情低俗
    "色情", "裸体", "性交", "约炮", "嫖娼", "卖淫",
    // 暴力恐怖
    "杀人", "爆炸", "恐怖袭击", "枪支", "毒品", "贩毒",
    // 广告诈骗
    "刷单", "兼职打字", "日赚千元", "加微信", "免费领取",
  ];

  const exactSet = new Set(SENSITIVE_WORDS.map((w) => w.toLowerCase()));

  function normalize(word) {
    return word.trim().toLowerCase();
  }

  function isSensitive(word) {
    const w = normalize(word);
    if (!w) return false;
    if (exactSet.has(w)) return true;
    for (const s of SENSITIVE_WORDS) {
      const sl = s.toLowerCase();
      if (w.includes(sl) || sl.includes(w)) {
        if (w.length >= 2 || sl.length <= 3) return true;
      }
    }
    return false;
  }

  /**
   * 过滤词汇列表
   * @returns {{ allowed: string[], blocked: string[] }}
   */
  function filterWords(words) {
    const allowed = [];
    const blocked = [];
    const seenBlocked = new Set();

    for (const raw of words) {
      const word = raw.trim();
      if (!word) continue;
      if (isSensitive(word)) {
        if (!seenBlocked.has(word)) {
          blocked.push(word);
          seenBlocked.add(word);
        }
      } else {
        allowed.push(word);
      }
    }
    return { allowed, blocked };
  }

  return { filterWords, isSensitive, SENSITIVE_WORDS };
})();

window.SensitiveFilter = SensitiveFilter;
