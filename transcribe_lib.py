"""本地语音转文字 — openai-whisper + PyAV 解码（无需单独安装 ffmpeg）"""

from __future__ import annotations

import io
import os
import shutil
import tempfile
import threading

HAS_WHISPER = False
HAS_AV = False
WHISPER_IMPORT_ERROR = ""
AV_IMPORT_ERROR = ""

try:
    import whisper  # noqa: F401

    HAS_WHISPER = True
except ImportError:
    WHISPER_IMPORT_ERROR = "pip install openai-whisper"

try:
    import av  # noqa: F401

    HAS_AV = True
except ImportError:
    AV_IMPORT_ERROR = "pip install av"

HAS_FFMPEG = shutil.which("ffmpeg") is not None
WHISPER_MODEL_NAME = "tiny"

_model = None
_model_lock = threading.Lock()


def is_available() -> bool:
    return HAS_WHISPER and (HAS_AV or HAS_FFMPEG)


def get_status() -> dict:
    if is_available():
        decode = "pyav" if HAS_AV else "ffmpeg"
        return {
            "available": True,
            "engine": "whisper",
            "model": WHISPER_MODEL_NAME,
            "decode": decode,
        }
    if not HAS_WHISPER:
        return {"available": False, "engine": None, "error": WHISPER_IMPORT_ERROR}
    if not HAS_AV and not HAS_FFMPEG:
        return {"available": False, "engine": "whisper", "error": "pip install av"}
    return {"available": False, "error": "语音识别未就绪"}


def warm_up() -> None:
    """后台预加载 whisper 模型，避免首次识别等待过久"""
    if not is_available():
        return

    def _run() -> None:
        try:
            _load_model()
        except Exception as exc:
            print(f"[whisper] 模型预加载失败: {exc}", file=__import__("sys").stderr)

    threading.Thread(target=_run, daemon=True).start()


def _load_model():
    global _model
    with _model_lock:
        if _model is None:
            import whisper

            print(f"[whisper] 正在加载模型 {WHISPER_MODEL_NAME}…")
            _model = whisper.load_model(WHISPER_MODEL_NAME)
            print("[whisper] 模型已就绪")
        return _model


def _decode_with_pyav(data: bytes):
    import av
    import numpy as np

    container = av.open(io.BytesIO(data))
    if not container.streams.audio:
        return np.array([], dtype=np.float32)

    resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=16000)
    chunks: list = []

    for frame in container.decode(audio=0):
        resampled = resampler.resample(frame)
        for out_frame in resampled:
            chunks.append(out_frame.to_ndarray().flatten())

    if not chunks:
        return np.array([], dtype=np.float32)

    pcm = np.concatenate(chunks).astype(np.float32) / 32768.0
    return pcm


def _transcribe_file(path: str) -> str:
    model = _load_model()
    result = model.transcribe(path, language="zh", fp16=False, task="transcribe")
    return (result.get("text") or "").strip()


def transcribe_bytes(data: bytes, suffix: str = ".webm") -> str:
    if not is_available():
        status = get_status()
        raise RuntimeError(status.get("error") or "语音识别不可用")
    if not data or len(data) < 128:
        return ""

    if HAS_AV:
        import whisper

        audio = _decode_with_pyav(data)
        if audio.size < 1600:
            return ""
        model = _load_model()
        audio = whisper.pad_or_trim(audio)
        mel = whisper.log_mel_spectrogram(audio).to(model.device)
        options = whisper.DecodingOptions(language="zh", fp16=False)
        result = whisper.decode(model, mel, options)
        return (result.text or "").strip()

    fd, path = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    try:
        with open(path, "wb") as f:
            f.write(data)
        return _transcribe_file(path)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
