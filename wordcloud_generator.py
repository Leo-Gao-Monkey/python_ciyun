"""词云生成核心模块"""

from __future__ import annotations

import os
import re
from pathlib import Path

import jieba
from wordcloud import WordCloud


# Windows 常见中文字体路径
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",   # 微软雅黑
    r"C:\Windows\Fonts\simhei.ttf",   # 黑体
    r"C:\Windows\Fonts\simsun.ttc",   # 宋体
]

# 过滤掉无意义的虚词
STOPWORDS = {
    "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
    "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有",
    "看", "好", "自己", "这", "那", "他", "她", "它", "们", "与", "及", "等",
    "可以", "能够", "通过", "进行", "以及", "其中", "这种", "这些", "那些",
}


def find_chinese_font() -> str | None:
    """查找系统中可用的中文字体"""
    for font_path in FONT_CANDIDATES:
        if os.path.exists(font_path):
            return font_path
    return None


def read_text(file_path: str | Path) -> str:
    """读取文本文件"""
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"文件不存在: {path}")
    return path.read_text(encoding="utf-8")


def segment_text(text: str, stopwords: set[str] | None = None) -> str:
    """
    使用 jieba 对中文文本分词，并过滤停用词与无效字符。
    返回以空格分隔的词串，供 WordCloud 使用。
    """
    stopwords = stopwords or STOPWORDS
    words = jieba.cut(text)
    filtered = []
    for word in words:
        word = word.strip()
        if len(word) < 2:
            continue
        if word in stopwords:
            continue
        if re.fullmatch(r"[\W_]+", word):
            continue
        filtered.append(word)
    return " ".join(filtered)


def generate_wordcloud(
    text: str,
    output_path: str | Path,
    *,
    width: int = 1200,
    height: int = 800,
    background_color: str = "white",
    colormap: str = "viridis",
    max_words: int = 200,
    font_path: str | None = None,
) -> WordCloud:
    """
    根据文本生成词云并保存为图片。

    Returns:
        WordCloud 对象，可用于进一步展示或统计
    """
    font_path = font_path or find_chinese_font()
    if font_path is None:
        raise RuntimeError(
            "未找到中文字体，请手动指定 font_path，"
            "或将字体文件放入 fonts/ 目录"
        )

    segmented = segment_text(text)
    if not segmented.strip():
        raise ValueError("分词结果为空，请检查输入文本")

    wc = WordCloud(
        font_path=font_path,
        width=width,
        height=height,
        background_color=background_color,
        colormap=colormap,
        max_words=max_words,
        margin=10,
        random_state=42,
    )
    wc.generate(segmented)

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    wc.to_file(str(output))
    return wc
