"""统一中文分词 — jieba + 领域词典（serve.py / wordcloud_generator 共用）"""

from __future__ import annotations

import re
from pathlib import Path

try:
    import jieba

    HAS_JIEBA = True
except ImportError:
    HAS_JIEBA = False

PROJECT_ROOT = Path(__file__).resolve().parent

STOPWORDS = {
    "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
    "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有",
    "看", "好", "自己", "这", "那", "他", "她", "它", "们", "与", "及", "等",
    "可以", "能够", "通过", "进行", "以及", "其中", "这种", "这些", "那些",
    "作为", "已经", "多个", "不同", "整个", "不仅", "而是", "例如", "之一",
    "正在", "可以", "我们", "他们", "你们", "这种", "那种", "为了", "因为",
    "所以", "但是", "如果", "虽然", "然而", "因此", "其中", "其", "并",
    "被", "将", "对", "从", "向", "以", "为", "所", "还", "才", "或",
    "而", "且", "于", "之", "地", "得", "过", "来", "去", "给", "用", "由",
}

# 强制整词切分（防止 jieba 误拆）
FORCE_TERMS = [
    "人工智能", "自然语言处理", "自然语言", "机器学习", "深度学习", "数据分析",
    "数据挖掘", "语音识别", "文本处理", "词云可视化", "动态词云", "程序设计",
    "自动化办公", "Web开发", "系统设计", "项目开发", "模型训练", "数据清洗",
    "数据科学", "数字经济", "条件判断", "循环结构", "函数设计", "文件操作",
    "动态可视化", "中文分词", "词频统计", "智慧教学", "课堂互动", "舆情监测",
    "数据决策", "文本分析", "声音数据", "智能分析", "数据处理", "编程能力",
    "界面交互", "创新实践", "综合素养", "工程实践", "交互展示", "可视化",
    "大数据", "云计算", "新媒体", "数据思维", "创新思维", "人工智能系统",
    "人工智能领域", "人工智能应用", "人工智能相关", "程序设计能力", "数据分析能力",
    "界面交互能力", "创新实践能力", "人工智能应用能力", "编程语言", "基础语法",
    "程序开发", "应用技术", "语音输入", "文本内容", "分词技术", "文本主题",
    "图形方式", "交互词云", "图形边界", "形状轮廓", "颜色搭配", "词语大小",
    "数据展示", "讨论热点", "市场反馈", "用户关注", "设计理念", "可视化表达",
    "主题内容", "应用场景", "真实项目", "解决问题", "工程实践能力", "核心能力",
    "智能分析能力", "Python", "pyecharts", "ECharts",
    "jieba", "Counter",
]

_initialized = False


def _keyword_paths() -> list[Path]:
    return [
        PROJECT_ROOT / "data" / "keywords.txt",
        PROJECT_ROOT / "web" / "data" / "keywords.txt",
    ]


def load_keyword_lines() -> list[str]:
    words: list[str] = []
    seen: set[str] = set()
    for path in _keyword_paths():
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            word = line.split()[0].strip()
            if len(word) >= 2 and word not in seen:
                seen.add(word)
                words.append(word)
    for term in FORCE_TERMS:
        if term not in seen and len(term) >= 2:
            seen.add(term)
            words.append(term)
    return words


def init_jieba() -> None:
    global _initialized
    if _initialized or not HAS_JIEBA:
        return
    for word in load_keyword_lines():
        jieba.add_word(word, freq=100000)
    for term in FORCE_TERMS:
        jieba.suggest_freq(term, tune=True)
    jieba.initialize()
    _initialized = True


def segment_list(text: str, stopwords: set[str] | None = None) -> list[str]:
    """分词并返回词列表。"""
    if not HAS_JIEBA:
        return []
    init_jieba()
    stop = stopwords or STOPWORDS
    words: list[str] = []
    for word in jieba.cut(text):
        word = word.strip()
        if len(word) < 2:
            continue
        if word in stop:
            continue
        if re.fullmatch(r"[\W_]+", word):
            continue
        words.append(word)
    return words


def segment_joined(text: str, stopwords: set[str] | None = None) -> str:
    return " ".join(segment_list(text, stopwords))
