"""
词云生成器 - 图形界面

用法:
    python gui.py
"""

from __future__ import annotations

import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from PIL import Image, ImageTk

from wordcloud_generator import find_chinese_font, generate_wordcloud, read_text

try:
    import windnd

    HAS_DND = True
except ImportError:
    HAS_DND = False

PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_SAMPLE = PROJECT_ROOT / "data" / "sample.txt"
OUTPUT_DIR = PROJECT_ROOT / "output"

COLORMAPS = ["viridis", "plasma", "cool", "spring", "summer", "autumn", "hot"]
BACKGROUNDS = ["white", "black", "#f5f5f5", "#1a1a2e"]


class WordCloudApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("词云生成器 · Python程序设计展示")
        self.geometry("960x640")
        self.minsize(800, 560)

        self.input_path: Path | None = DEFAULT_SAMPLE if DEFAULT_SAMPLE.exists() else None
        self.preview_image: ImageTk.PhotoImage | None = None
        self._generating = False

        self._build_ui()
        self._bind_drop()
        self._update_file_label()

        if find_chinese_font() is None:
            messagebox.showwarning(
                "字体提示",
                "未检测到系统中文字体，生成词云时可能失败。\n"
                "请确认 C:\\Windows\\Fonts 下存在 msyh.ttc 或 simhei.ttf。",
            )

    def _build_ui(self) -> None:
        style = ttk.Style(self)
        style.configure("Title.TLabel", font=("Microsoft YaHei", 14, "bold"))
        style.configure("Hint.TLabel", font=("Microsoft YaHei", 9), foreground="#666")
        style.configure("Drop.TFrame", relief="groove", borderwidth=2)

        header = ttk.Frame(self, padding=(16, 12, 16, 4))
        header.pack(fill="x")
        ttk.Label(header, text="中文词云生成器", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            header,
            text="选择或拖入 .txt 文本文件，点击「生成词云」即可预览与保存",
            style="Hint.TLabel",
        ).pack(anchor="w", pady=(4, 0))

        body = ttk.Frame(self, padding=16)
        body.pack(fill="both", expand=True)
        body.columnconfigure(1, weight=1)
        body.rowconfigure(0, weight=1)

        # 左侧控制区
        left = ttk.Frame(body, width=280)
        left.grid(row=0, column=0, sticky="ns", padx=(0, 12))
        left.grid_propagate(False)

        drop_hint = "将 .txt 文件拖放到此处" if HAS_DND else "点击下方按钮选择文件"
        self.drop_frame = ttk.Frame(left, style="Drop.TFrame", padding=16)
        self.drop_frame.pack(fill="x", pady=(0, 12))

        ttk.Label(self.drop_frame, text="📄 文本文件", font=("Microsoft YaHei", 11, "bold")).pack()
        ttk.Label(self.drop_frame, text=drop_hint, style="Hint.TLabel", wraplength=220).pack(pady=(6, 10))
        self.file_label = ttk.Label(
            self.drop_frame, text="未选择文件", wraplength=220, foreground="#333"
        )
        self.file_label.pack(pady=(0, 10))
        ttk.Button(self.drop_frame, text="选择文件…", command=self._choose_file).pack(fill="x")

        settings = ttk.LabelFrame(left, text="生成设置", padding=12)
        settings.pack(fill="x", pady=(0, 12))

        ttk.Label(settings, text="配色方案").pack(anchor="w")
        self.colormap_var = tk.StringVar(value="viridis")
        ttk.Combobox(
            settings,
            textvariable=self.colormap_var,
            values=COLORMAPS,
            state="readonly",
        ).pack(fill="x", pady=(4, 10))

        ttk.Label(settings, text="背景颜色").pack(anchor="w")
        self.bg_var = tk.StringVar(value="white")
        ttk.Combobox(
            settings,
            textvariable=self.bg_var,
            values=BACKGROUNDS,
            state="readonly",
        ).pack(fill="x", pady=(4, 10))

        self.generate_btn = ttk.Button(
            left, text="生成词云", command=self._on_generate
        )
        self.generate_btn.pack(fill="x", ipady=6)

        self.status_var = tk.StringVar(value="就绪")
        ttk.Label(left, textvariable=self.status_var, style="Hint.TLabel", wraplength=240).pack(
            anchor="w", pady=(10, 0)
        )

        # 右侧预览区
        preview_frame = ttk.LabelFrame(body, text="词云预览", padding=8)
        preview_frame.grid(row=0, column=1, sticky="nsew")
        preview_frame.rowconfigure(0, weight=1)
        preview_frame.columnconfigure(0, weight=1)

        self.canvas = tk.Canvas(preview_frame, bg="#fafafa", highlightthickness=0)
        self.canvas.grid(row=0, column=0, sticky="nsew")
        self.canvas.create_text(
            280, 200,
            text="生成后将在此显示词云",
            fill="#aaa",
            font=("Microsoft YaHei", 12),
            tags="placeholder",
        )

        # 底部词频
        freq_frame = ttk.LabelFrame(self, text="高频词 Top 10", padding=(16, 8))
        freq_frame.pack(fill="x", padx=16, pady=(0, 16))

        self.freq_text = tk.Text(
            freq_frame, height=3, wrap="word", font=("Consolas", 10),
            relief="flat", bg=self.cget("bg"),
        )
        self.freq_text.pack(fill="x")
        self.freq_text.config(state="disabled")

    def _bind_drop(self) -> None:
        if not HAS_DND:
            return
        windnd.hook_dropfiles(self, func=self._on_drop)

    def _on_drop(self, files: list[bytes] | tuple) -> None:
        if not files:
            return
        raw = files[0]
        path_str = raw.decode("gbk") if isinstance(raw, bytes) else str(raw)
        self._set_input_file(Path(path_str))

    def _choose_file(self) -> None:
        path = filedialog.askopenfilename(
            title="选择文本文件",
            filetypes=[("文本文件", "*.txt"), ("所有文件", "*.*")],
            initialdir=str(PROJECT_ROOT / "data"),
        )
        if path:
            self._set_input_file(Path(path))

    def _set_input_file(self, path: Path) -> None:
        if path.suffix.lower() != ".txt":
            messagebox.showerror("格式错误", "请选择 .txt 文本文件")
            return
        if not path.exists():
            messagebox.showerror("文件不存在", str(path))
            return
        self.input_path = path
        self._update_file_label()
        self.status_var.set(f"已选择: {path.name}")

    def _update_file_label(self) -> None:
        if self.input_path and self.input_path.exists():
            self.file_label.config(text=self.input_path.name)
        else:
            self.file_label.config(text="未选择文件")

    def _on_generate(self) -> None:
        if self._generating:
            return
        if self.input_path is None or not self.input_path.exists():
            messagebox.showinfo("提示", "请先选择一个 .txt 文本文件")
            return

        self._generating = True
        self.generate_btn.config(state="disabled")
        self.status_var.set("正在分词并生成词云，请稍候…")

        thread = threading.Thread(target=self._generate_worker, daemon=True)
        thread.start()

    def _generate_worker(self) -> None:
        try:
            text = read_text(self.input_path)
            output_path = OUTPUT_DIR / "wordcloud_gui.png"
            wc = generate_wordcloud(
                text,
                output_path,
                background_color=self.bg_var.get(),
                colormap=self.colormap_var.get(),
            )
            freq = wc.words_
            top_words = sorted(freq.items(), key=lambda x: x[1], reverse=True)[:10]
            self.after(0, lambda: self._on_success(output_path, top_words, len(text)))
        except Exception as exc:
            self.after(0, lambda: self._on_error(str(exc)))

    def _on_success(self, image_path: Path, top_words: list, text_len: int) -> None:
        self._show_preview(image_path)
        self._show_freq(top_words)
        self.status_var.set(
            f"生成完成 · {text_len} 字符 · 已保存至 output/wordcloud_gui.png"
        )
        self._generating = False
        self.generate_btn.config(state="normal")

    def _on_error(self, message: str) -> None:
        messagebox.showerror("生成失败", message)
        self.status_var.set("生成失败")
        self._generating = False
        self.generate_btn.config(state="normal")

    def _show_preview(self, image_path: Path) -> None:
        img = Image.open(image_path)
        canvas_w = max(self.canvas.winfo_width(), 400)
        canvas_h = max(self.canvas.winfo_height(), 300)
        img.thumbnail((canvas_w - 16, canvas_h - 16), Image.Resampling.LANCZOS)

        self.preview_image = ImageTk.PhotoImage(img)
        self.canvas.delete("all")
        self.canvas.create_image(
            canvas_w // 2, canvas_h // 2,
            image=self.preview_image, anchor="center",
        )

    def _show_freq(self, top_words: list) -> None:
        lines = "  ".join(f"{word}({score:.2f})" for word, score in top_words)
        self.freq_text.config(state="normal")
        self.freq_text.delete("1.0", "end")
        self.freq_text.insert("1.0", lines or "无")
        self.freq_text.config(state="disabled")


def main() -> None:
    app = WordCloudApp()
    app.mainloop()


if __name__ == "__main__":
    main()
