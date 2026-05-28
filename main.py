"""
词云本地展示项目 - 主程序入口

用法:
    python gui.py                           # 启动图形界面（推荐）
    python main.py                          # 使用默认示例文本
    python main.py -i data/sample.txt       # 指定输入文件
    python main.py -i data/sample.txt -o output/my_cloud.png
    python main.py --show                   # 生成后在窗口中展示
"""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib.pyplot as plt

from wordcloud_generator import find_chinese_font, generate_wordcloud, read_text


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="中文词云生成与展示工具")
    parser.add_argument(
        "-i", "--input",
        default="data/sample.txt",
        help="输入文本文件路径（默认: data/sample.txt）",
    )
    parser.add_argument(
        "-o", "--output",
        default="output/wordcloud.png",
        help="输出图片路径（默认: output/wordcloud.png）",
    )
    parser.add_argument(
        "--width", type=int, default=1200,
        help="图片宽度（默认: 1200）",
    )
    parser.add_argument(
        "--height", type=int, default=800,
        help="图片高度（默认: 800）",
    )
    parser.add_argument(
        "--bg", default="white",
        help="背景颜色（默认: white，可设为 black 等）",
    )
    parser.add_argument(
        "--colormap", default="viridis",
        help="配色方案（默认: viridis，可选 plasma、cool 等）",
    )
    parser.add_argument(
        "--show", action="store_true",
        help="生成后在窗口中展示词云",
    )
    return parser.parse_args()


def show_wordcloud(image_path: Path) -> None:
    """在 matplotlib 窗口中展示词云图片"""
    plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "sans-serif"]
    plt.rcParams["axes.unicode_minus"] = False

    img = plt.imread(str(image_path))
    plt.figure(figsize=(12, 8))
    plt.imshow(img)
    plt.axis("off")
    plt.title("词云展示", fontsize=16, pad=12)
    plt.tight_layout()
    plt.show()


def main() -> None:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)

    print("=" * 50)
    print("  词云本地展示项目")
    print("=" * 50)

    font = find_chinese_font()
    print(f"字体: {font or '未找到（将报错）'}")
    print(f"输入: {input_path.resolve()}")
    print(f"输出: {output_path.resolve()}")
    print("-" * 50)

    text = read_text(input_path)
    print(f"文本长度: {len(text)} 字符")

    wc = generate_wordcloud(
        text,
        output_path,
        width=args.width,
        height=args.height,
        background_color=args.bg,
        colormap=args.colormap,
    )

    # 输出词频 Top 10，便于课堂讲解
    freq = wc.words_
    top_words = sorted(freq.items(), key=lambda x: x[1], reverse=True)[:10]
    print("\n高频词 Top 10:")
    for rank, (word, count) in enumerate(top_words, 1):
        print(f"  {rank:2d}. {word:<8s} {count:.4f}")

    print(f"\n词云已保存至: {output_path.resolve()}")

    if args.show:
        show_wordcloud(output_path)


if __name__ == "__main__":
    main()
