/**
 * Kiosk 控制台 v3 - ECharts 动态词云 + 敏感词 + 实时同步
 */
(() => {
  "use strict";

  const BG_PRESETS = {
    "gradient-1": ["#dce4f7", "#c8d4f0", "#e2e8f8"],
    "gradient-2": ["#e4d9f5", "#d4c4ef", "#ebe2f8"],
    "gradient-3": ["#d4ece6", "#c0e0d6", "#e0f0ea"],
    "solid-dark": ["#2a3148", "#343d58", "#2a3148"],
    "solid-light": ["#f5f7fc", "#e8edf7", "#f0f4fa"],
  };

  const chartEl = document.getElementById("wordcloud-chart");
  const stageEl = document.getElementById("wordcloud-stage");
  const bgLayer = document.getElementById("background-layer");
  const emptyHint = document.getElementById("empty-hint");
  const syncIndicator = document.getElementById("sync-indicator");
  const sourceTabs = document.getElementById("source-tabs");
  const btnClearCloud = document.getElementById("btn-clear-cloud");
  const btnRecStart = document.getElementById("btn-rec-start");
  const btnRecPause = document.getElementById("btn-rec-pause");
  const btnRecEnd = document.getElementById("btn-rec-end");
  const audioUpload = document.getElementById("audio-upload");
  const btnAdd = document.getElementById("btn-add");
  const btnLoadDemo = document.getElementById("btn-load-demo");
  const btnReset = document.getElementById("btn-reset");
  const btnExport = document.getElementById("btn-export");
  const btnDownload = document.getElementById("btn-download");
  const btnSubmitSpeech = document.getElementById("btn-submit-speech");
  const btnClearSpeech = document.getElementById("btn-clear-speech");
  const wordInput = document.getElementById("word-input");
  const speechEditor = document.getElementById("speech-editor");
  const interimText = document.getElementById("interim-text");
  const speechStatus = document.getElementById("speech-status");
  const statTotal = document.getElementById("stat-total");
  const statUnique = document.getElementById("stat-unique");
  const toast = document.getElementById("toast");
  const bgUpload = document.getElementById("bg-upload");
  const maskUpload = document.getElementById("mask-upload");
  const shapeStrip = document.getElementById("shape-strip");
  const shapeOutlineGuide = document.getElementById("shape-outline-guide");
  const segmentEngineEl = document.getElementById("segment-engine");

  let recognition = null;
  /** @type {'idle'|'recording'|'paused'|'transcribing'} */
  let recorderState = "idle";
  let toastTimer = null;
  let renderPending = false;
  let holdAnchor = "";
  let sessionCommitted = "";
  let holdFinal = "";
  let holdInterim = "";
  let micGranted = false;
  let micPreparing = false;
  let stopTimer = null;
  let recognitionBusy = false;
  let playbackAudio = null;

  async function init() {
    WordCloudChart.init(chartEl);
    SyncHub.init();
    buildShapeStrip();
    applyBackground();
    updateShapeOutlineGuide();
    await Segmenter.probeJiebaApi();
    updateSegmentBadge();
    await initManualInput();
    bindEvents();

    SyncHub.subscribe((payload) => {
      if (WordStore.applySnapshot(payload)) {
        onRemoteUpdate();
        setSyncStatus(true);
      }
    });

    initSpeech();
    document.addEventListener("pointerdown", prewarmMicrophone, { once: true, capture: true });
    prewarmMicrophone();
    updateSourceTabs();
    refreshAll();
    SyncHub.fetchRemoteState().then((remote) => {
      if (remote && WordStore.applySnapshot(remote)) refreshAll();
      updateSyncMode();
    });

    requestAnimationFrame(() => WordCloudChart.resize());
    window.addEventListener("resize", debounce(() => {
      WordCloudChart.resize();
    }, 200));
    window.addEventListener("orientationchange", () => {
      setTimeout(() => WordCloudChart.resize(), 300);
    });
    window.addEventListener("online", async () => {
      await Segmenter.probeJiebaApi(true);
      updateSegmentBadge();
    });
    window.addEventListener("offline", updateSegmentBadge);
  }

  function updateSegmentBadge() {
    if (!segmentEngineEl) return;
    if (!navigator.onLine) {
      segmentEngineEl.textContent = "分词: 离线";
      segmentEngineEl.className = "segment-badge segment-offline";
      segmentEngineEl.title = "无网络连接，使用本地词典分词";
      return;
    }
    if (Segmenter.isJiebaAvailable()) {
      segmentEngineEl.textContent = "分词: jieba";
      segmentEngineEl.className = "segment-badge segment-jieba";
      const url = Segmenter.getActiveSegmentUrl();
      segmentEngineEl.title = url
        ? `在线 jieba 分词\n${url}`
        : "在线 jieba 分词";
      return;
    }
    segmentEngineEl.textContent = "分词: 本地词典";
    segmentEngineEl.className = "segment-badge segment-local";
    segmentEngineEl.title = "未连接 jieba 服务（请运行 python web/serve.py 并安装 jieba）";
  }

  function setSyncStatus(ok) {
    if (!syncIndicator) return;
    if (SyncHub.isServerMode()) {
      syncIndicator.textContent = ok ? "● 已同步" : "○ 同步中断";
      syncIndicator.classList.toggle("offline", !ok);
      return;
    }
    syncIndicator.textContent = "● 在线";
    syncIndicator.classList.remove("offline");
  }

  function updateSyncMode() {
    setSyncStatus(true);
  }

  function onRemoteUpdate() {
    refreshChart(false);
    updateStats();
    updateSourceTabs();
    emptyHint.classList.toggle("hidden", !WordStore.isEmpty());
    btnDownload.disabled = WordStore.isEmpty();
    applyBackground();
    buildShapeStrip();
    updateShapeOutlineGuide();
  }

  function updateSourceTabs() {
    if (!sourceTabs) return;
    const src = WordStore.getDisplaySource();
    sourceTabs.querySelectorAll(".source-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.source === src);
    });
  }

  function buildShapeStrip() {
    if (!shapeStrip) return;
    const { shapeMask } = WordStore.getShapeMask();
    shapeStrip.innerHTML = "";

    for (const [id, meta] of Object.entries(ShapeMask.SHAPES)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `shape-btn${shapeMask === id ? " active" : ""}`;
      btn.dataset.shape = id;
      btn.title = meta.label;
      btn.innerHTML = `<span class="shape-icon" aria-hidden="true">${meta.icon}</span><span class="shape-label">${meta.label}</span>`;
      btn.addEventListener("click", () => selectShape(id));
      shapeStrip.appendChild(btn);
    }
    if (shapeMask === "custom") {
      shapeStrip.querySelectorAll(".shape-btn").forEach((b) => b.classList.remove("active"));
    }
  }

  async function updateShapeOutlineGuide() {
    if (!shapeOutlineGuide) return;
    const { shapeMask, customMaskImage } = WordStore.getShapeMask();
    const shape = shapeMask === "custom" ? "custom" : shapeMask;
    try {
      if (shape === "custom" && customMaskImage) {
        ShapeMask.setCustomMask(customMaskImage);
      }
      const { w, h } = ShapeMask.MASK_SIZE;
      const canvas = await ShapeMask.getOutlineGuide(shape, w, h);
      if (canvas) {
        shapeOutlineGuide.style.backgroundImage = `url(${canvas.toDataURL("image/png")})`;
        shapeOutlineGuide.classList.add("is-visible");
      } else {
        shapeOutlineGuide.style.backgroundImage = "";
        shapeOutlineGuide.classList.remove("is-visible");
      }
    } catch (err) {
      console.warn("轮廓引导加载失败", err);
      shapeOutlineGuide.style.backgroundImage = "";
      shapeOutlineGuide.classList.remove("is-visible");
    }
  }

  function selectShape(shape) {
    WordStore.setShapeMask(shape);
    shapeStrip?.querySelectorAll(".shape-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.shape === shape);
    });
    updateShapeOutlineGuide();
    refreshChart(true);
    const label = shape === "custom" ? "自定义" : (ShapeMask.SHAPES[shape]?.label || shape);
    showToast(`已切换为${label}词云`);
  }

  async function initManualInput() {
    if (!wordInput || typeof DemoSample === "undefined") return;
    const text = DemoSample.getManualIntroText();
    wordInput.value = text;
    if (WordStore.isAllEmpty()) {
      await ingestText(text, "manual");
    }
  }

  async function loadDemoSample() {
    WordStore.clearAll();
    const text = DemoSample.getText();
    if (wordInput) wordInput.value = text;
    const result = await ingestText(text, "manual");
    if (result.added > 0) {
      showToast(`已载入形状预览示例（${result.added} 个词）`);
    } else {
      showToast("示例载入失败，请重试");
    }
  }

  function bindEvents() {
    btnRecStart?.addEventListener("click", () => {
      if (recorderState === "paused") resumeRecording();
      else if (recorderState === "idle") startRecording();
    });
    btnRecPause?.addEventListener("click", pauseRecording);
    btnRecEnd?.addEventListener("click", endRecording);

    audioUpload?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (file) transcribeAudioFile(file);
    });

    sourceTabs?.addEventListener("click", (e) => {
      const btn = e.target.closest(".source-tab");
      if (!btn) return;
      WordStore.setDisplaySource(btn.dataset.source);
      updateSourceTabs();
      refreshChart(true);
      updateStats();
      emptyHint.classList.toggle("hidden", !WordStore.isEmpty());
      btnDownload.disabled = WordStore.isEmpty();
    });

    btnClearCloud?.addEventListener("click", () => {
      if (WordStore.isEmpty()) {
        showToast("当前词云已为空");
        return;
      }
      const labels = { voice: "语音", manual: "手动", all: "全部" };
      const label = labels[WordStore.getDisplaySource()] || "当前";
      WordStore.clearDisplay();
      refreshAll();
      showToast(`已清空${label}词云`);
    });

    btnSubmitSpeech.addEventListener("click", submitSpeechEditor);
    btnClearSpeech.addEventListener("click", () => {
      speechEditor.value = "";
      interimText.textContent = "";
      resetSpeechSession();
    });

    btnAdd.addEventListener("click", submitManualInput);
    btnLoadDemo?.addEventListener("click", loadDemoSample);
    wordInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submitManualInput();
      }
    });
    btnDownload.addEventListener("click", downloadWordCloudImage);

    btnReset.addEventListener("click", () => {
      if (!confirm("确定清空所有词云数据（语音 + 手动）？")) return;
      WordStore.clearAll();
      speechEditor.value = "";
      resetSpeechSession();
      refreshAll();
      showToast("全部词云已清空");
    });

    btnExport.addEventListener("click", exportData);

    document.querySelectorAll(".color-swatch").forEach((btn) => {
      btn.addEventListener("click", () => {
        WordStore.setBackground(btn.dataset.bg);
        document.querySelectorAll(".color-swatch").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        applyBackground();
      });
    });

    bgUpload.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      readFileAsDataURL(file, (url) => {
        WordStore.setCustomBgImage(url);
        applyBackground();
        showToast("页面背景已更新");
      });
      e.target.value = "";
    });

    maskUpload.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      readFileAsDataURL(file, (url) => {
        WordStore.setCustomMaskImage(url);
        shapeStrip?.querySelectorAll(".shape-btn").forEach((b) => b.classList.remove("active"));
        updateShapeOutlineGuide();
        refreshChart(true);
        showToast("自定义形状已应用");
      });
      e.target.value = "";
    });
  }

  function readFileAsDataURL(file, cb) {
    const reader = new FileReader();
    reader.onload = () => cb(reader.result);
    reader.readAsDataURL(file);
  }

  async function ensureMicrophone() {
    if (micGranted) return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast("当前浏览器不支持麦克风");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      micGranted = true;
      return true;
    } catch (_) {
      showToast("请允许浏览器使用麦克风权限");
      return false;
    }
  }

  async function prewarmMicrophone() {
    if (micGranted || micPreparing) return;
    micPreparing = true;
    await ensureMicrophone();
    micPreparing = false;
  }

  function resetSpeechSession() {
    holdAnchor = "";
    sessionCommitted = "";
    holdFinal = "";
    holdInterim = "";
  }

  function updateRecordingUI() {
    const recording = recorderState === "recording";
    const paused = recorderState === "paused";
    const busy = recorderState === "transcribing";
    const active = recording || paused;

    btnRecStart?.classList.toggle("recording", recording);
    btnRecStart.disabled = busy || recording;
    if (btnRecStart && !busy) {
      btnRecStart.textContent = paused ? "继续录音" : "开始录音";
    }
    btnRecPause.disabled = busy || !recording;
    btnRecEnd.disabled = busy || !active;
    document.getElementById("rec-controls")?.classList.toggle("is-busy", busy);
    document.getElementById("rec-controls")?.classList.toggle("is-session-active", active);
  }

  function flushRecognitionToEditor() {
    speechEditor.value = holdAnchor + sessionCommitted + holdFinal + holdInterim;
    holdAnchor = speechEditor.value;
    sessionCommitted = "";
    holdFinal = "";
    holdInterim = "";
  }

  function appendToSpeechEditor(text) {
    const t = (text || "").trim();
    if (!t) return;
    const cur = speechEditor.value.trim();
    speechEditor.value = cur ? `${cur}\n${t}` : t;
    speechEditor.scrollTop = speechEditor.scrollHeight;
  }

  function updateSpeechEditorDisplay() {
    speechEditor.value = holdAnchor + sessionCommitted + holdFinal + holdInterim;
    speechEditor.scrollTop = speechEditor.scrollHeight;
    if (holdInterim) {
      interimText.textContent = `实时识别：${holdInterim}`;
    } else if (recorderState === "recording") {
      interimText.textContent = "正在聆听，请说话…";
    } else if (recorderState === "paused") {
      interimText.textContent = "已暂停，点击「继续录音」可接着录入";
    } else if (recorderState === "transcribing") {
      interimText.textContent = "正在识别上传的录音…";
    } else if (!speechEditor.value) {
      interimText.textContent = "";
    }
  }

  function initSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      speechStatus.textContent = "语音不可用";
      speechStatus.classList.add("unsupported");
      btnRecStart.disabled = true;
      btnRecPause.disabled = true;
      btnRecEnd.disabled = true;
      return;
    }
    updateRecordingUI();

    recognition = new SR();
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let finalPart = "";
      let interimPart = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript || "";
        if (!text) continue;
        if (result.isFinal) finalPart += text;
        else interimPart += text;
      }
      holdFinal = finalPart;
      holdInterim = interimPart;
      updateSpeechEditorDisplay();
    };

    recognition.onerror = (e) => {
      const err = e.error;
      if (err === "no-speech") {
        if (recorderState === "recording") interimText.textContent = "未检测到语音，请继续说话…";
        return;
      }
      if (err === "aborted") return;
      if (err === "not-allowed") {
        micGranted = false;
        showToast("麦克风权限被拒绝，请在浏览器设置中允许");
      } else if (err !== "network") {
        showToast(`语音识别异常：${err}`);
      }
      if (recorderState === "recording") endRecording(false);
    };

    recognition.onend = () => {
      recognitionBusy = false;
      if (recorderState !== "recording") return;

      const current = speechEditor.value.slice(holdAnchor.length);
      sessionCommitted = current;
      holdFinal = "";
      holdInterim = "";

      setTimeout(() => {
        if (recorderState !== "recording" || recognitionBusy) return;
        try {
          recognition.start();
          recognitionBusy = true;
        } catch (_) {
          endRecording(false);
        }
      }, 100);
    };

    recognition.onstart = () => {
      recognitionBusy = true;
      speechStatus.textContent = "聆听中…";
      speechStatus.classList.add("listening");
    };
  }

  function tryStartRecognition() {
    try {
      recognition.start();
      recognitionBusy = true;
    } catch (err) {
      if (err.name === "InvalidStateError") {
        try { recognition.stop(); } catch (_) { /* ignore */ }
        setTimeout(() => {
          if (recorderState !== "recording") return;
          try {
            recognition.start();
            recognitionBusy = true;
          } catch (_) {
            endRecording(false);
          }
        }, 150);
      } else {
        showToast("无法启动语音识别");
        endRecording(false);
      }
    }
  }

  async function startRecording() {
    if (!recognition || recorderState === "recording" || recorderState === "transcribing") return;

    if (!micGranted) {
      const ok = await ensureMicrophone();
      if (!ok) return;
    }

    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }

    holdAnchor = speechEditor.value;
    if (holdAnchor.trim() && !holdAnchor.endsWith("\n")) holdAnchor += "\n";
    sessionCommitted = "";
    holdFinal = "";
    holdInterim = "";

    recorderState = "recording";
    updateRecordingUI();
    interimText.textContent = "正在聆听，请说话…";
    speechStatus.textContent = "录音中";
    speechStatus.classList.add("listening");

    tryStartRecognition();
  }

  function resumeRecording() {
    if (!recognition || recorderState !== "paused") return;
    recorderState = "recording";
    holdFinal = "";
    holdInterim = "";
    updateRecordingUI();
    interimText.textContent = "正在聆听，请说话…";
    speechStatus.textContent = "录音中";
    speechStatus.classList.add("listening");
    tryStartRecognition();
  }

  function pauseRecording() {
    if (!recognition || recorderState !== "recording") return;

    recorderState = "paused";
    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }

    try {
      recognition.stop();
    } catch (_) { /* ignore */ }

    setTimeout(() => {
      flushRecognitionToEditor();
      updateRecordingUI();
      speechStatus.textContent = "已暂停";
      speechStatus.classList.remove("listening");
      interimText.textContent = "已暂停，点击「继续录音」可接着录入";
    }, 320);
  }

  function endRecording(flush = true) {
    if (!recognition) return;
    if (recorderState !== "recording" && recorderState !== "paused") return;

    recorderState = "idle";
    updateRecordingUI();
    speechStatus.textContent = "就绪";
    speechStatus.classList.remove("listening");

    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
      stopTimer = null;
      if (flush) flushRecognitionToEditor();
      interimText.textContent = speechEditor.value.trim()
        ? "识别完成，可编辑后提交"
        : "";
      try {
        recognition.stop();
      } catch (_) { /* ignore */ }
    }, 380);
  }

  async function tryServerTranscribe(file) {
    if (!SyncHub.isServerMode()) return null;
    try {
      const fd = new FormData();
      fd.append("audio", file, file.name || "audio.wav");
      const res = await fetch("/api/transcribe", { method: "POST", body: fd });
      if (!res.ok) return null;
      const data = await res.json();
      return (data.text || "").trim() || null;
    } catch (_) {
      return null;
    }
  }

  async function transcribeAudioByPlayback(file) {
    if (!recognition) {
      showToast("当前浏览器不支持语音识别");
      return;
    }
    const ok = await ensureMicrophone();
    if (!ok) return;

    holdAnchor = speechEditor.value;
    if (holdAnchor.trim() && !holdAnchor.endsWith("\n")) holdAnchor += "\n";
    sessionCommitted = "";
    holdFinal = "";
    holdInterim = "";

    const url = URL.createObjectURL(file);
    playbackAudio = new Audio(url);

    return new Promise((resolve) => {
      const cleanup = () => {
        URL.revokeObjectURL(url);
        playbackAudio = null;
        recorderState = "idle";
        updateRecordingUI();
        speechStatus.textContent = "就绪";
        speechStatus.classList.remove("listening");
      };

      const finish = (flush) => {
        try { recognition.stop(); } catch (_) { /* ignore */ }
        setTimeout(() => {
          if (flush) flushRecognitionToEditor();
          cleanup();
          interimText.textContent = speechEditor.value.trim()
            ? "录音文件识别完成，可编辑后提交"
            : "未识别到有效内容，请换清晰录音重试";
          resolve();
        }, 450);
      };

      playbackAudio.onended = () => finish(true);
      playbackAudio.onerror = () => {
        showToast("无法播放该音频文件");
        finish(false);
      };

      recorderState = "transcribing";
      updateRecordingUI();
      speechStatus.textContent = "识别中…";
      interimText.textContent = "正在播放并识别录音，请稍候…";

      try {
        recognition.start();
        recognitionBusy = true;
      } catch (_) {
        showToast("无法启动语音识别");
        cleanup();
        resolve();
        return;
      }

      playbackAudio.play().catch(() => {
        showToast("无法播放音频，请检查格式（推荐 wav/mp3）");
        finish(false);
      });
    });
  }

  async function transcribeAudioFile(file) {
    if (!file) return;
    if (recorderState === "recording" || recorderState === "paused") {
      endRecording(true);
      await new Promise((r) => setTimeout(r, 400));
    }

    recorderState = "transcribing";
    updateRecordingUI();
    speechStatus.textContent = "识别中…";
    interimText.textContent = "正在识别上传的录音…";

    let text = await tryServerTranscribe(file);
    if (!text) {
      await transcribeAudioByPlayback(file);
      if (speechEditor.value.trim()) {
        showToast("录音已识别到文字");
      }
      return;
    }

    appendToSpeechEditor(text);
    recorderState = "idle";
    updateRecordingUI();
    speechStatus.textContent = "就绪";
    interimText.textContent = "录音识别完成，可编辑后提交";
    showToast("录音已识别到文字");
  }

  async function submitSpeechEditor() {
    const text = speechEditor.value.trim();
    if (!text) { showToast("请先输入或说出内容"); return; }
    const result = await ingestText(text, "voice");
    if (result.added > 0) {
      speechEditor.value = "";
      resetSpeechSession();
      showToast(`已提交 ${result.added} 个词到语音词云${result.blocked.length ? `，拦截 ${result.blocked.length} 个敏感词` : ""}`);
    } else if (result.blocked.length) {
      showToast(`内容含敏感词已被拦截：${result.blocked.join("、")}`);
    } else {
      showToast("未识别到有效词汇");
    }
  }

  async function submitManualInput() {
    const text = wordInput.value.trim();
    if (!text) return;
    const result = await ingestText(text, "manual");
    if (result.added > 0) {
      showToast(`已提交 ${result.added} 个词（${Segmenter.getLastEngine() === "jieba" ? "jieba" : "本地词典"}）${result.blocked.length ? `，拦截敏感词 ${result.blocked.length} 个` : ""}`);
    } else if (result.blocked.length) {
      showToast(`含敏感词已拦截：${result.blocked.join("、")}`);
    } else {
      showToast("未识别到有效词汇");
    }
  }

  async function ingestText(text, source = "manual") {
    const words = await Segmenter.extractWordsAsync(text);
    WordStore.setDisplaySource(source);
    updateSourceTabs();
    const result = WordStore.addWords(words, source);
    if (result.added > 0) {
      refreshChart(true);
      updateStats();
      updateSegmentBadge();
      emptyHint.classList.toggle("hidden", !WordStore.isEmpty());
      btnDownload.disabled = false;
    }
    return result;
  }

  async function refreshChart(animate) {
    if (renderPending) return;
    renderPending = true;
    const list = WordStore.getList();
    const { shapeMask, customMaskImage } = WordStore.getShapeMask();
    emptyHint.classList.toggle("hidden", list.length > 0);
    btnDownload.disabled = list.length === 0;

    await Promise.all([
      WordCloudChart.render(list, shapeMask, customMaskImage),
      updateShapeOutlineGuide(),
    ]);
    renderPending = false;
  }

  function refreshAll() {
    updateStats();
    updateSourceTabs();
    applyBackground();
    buildShapeStrip();
    updateShapeOutlineGuide();
    const { background } = WordStore.getBackground();
    document.querySelectorAll(".color-swatch").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.bg === background);
    });
    refreshChart(false);
  }

  function updateStats() {
    const { total, unique, displayed } = WordStore.getStats();
    statTotal.textContent = total;
    statUnique.textContent = unique > displayed ? `${displayed}/${unique}` : String(unique);
  }

  function applyBackground() {
    const { background, customBgImage } = WordStore.getBackground();
    const isDark = background === "solid-dark" && !customBgImage;
    document.body.classList.toggle("theme-dark", isDark);

    if (customBgImage) {
      bgLayer.style.background = `url(${customBgImage}) center/cover no-repeat`;
      return;
    }
    const colors = BG_PRESETS[background] || BG_PRESETS["gradient-1"];
    bgLayer.style.background = `linear-gradient(145deg, ${colors[0]} 0%, ${colors[1]} 50%, ${colors[2]} 100%)`;
  }

  function isMobileDevice() {
    return /Android|iPhone|iPad|iPod|Mobile|MicroMessenger|WeiBo/i.test(navigator.userAgent);
  }

  async function downloadWordCloudImage() {
    if (WordStore.isEmpty()) { showToast("词云为空"); return; }
    showToast("正在生成高清图片…");

    const exportEl = stageEl.querySelector(".stage-body") || stageEl;
    const rect = exportEl.getBoundingClientRect();
    const list = WordStore.getList();
    const { shapeMask, customMaskImage } = WordStore.getShapeMask();
    const filename = `词云_${formatDate()}.png`;
    const mobile = isMobileDevice();
    const exportW = mobile
      ? Math.max(600, Math.min(window.innerWidth - 24, 900))
      : Math.max(rect.width, 400);
    const exportH = mobile
      ? Math.max(450, Math.min(exportW * 0.75, 680))
      : Math.max(rect.height, 300);

    try {
      const exportCanvas = await WordCloudChart.exportPNG({
        list,
        shape: shapeMask,
        customMaskUrl: customMaskImage,
        width: exportW,
        height: exportH,
        drawBackground: drawStageBackground,
      });

      if (!exportCanvas) {
        showToast("导出失败，请确认词云已显示后再试");
        return;
      }

      const dataUrl = exportCanvas.toDataURL("image/png");
      const blob = await new Promise((resolve) => {
        exportCanvas.toBlob((b) => resolve(b), "image/png");
      });

      if (mobile) {
        showMobileSaveDialog(dataUrl, blob, filename);
        return;
      }

      if (blob) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        showToast("词云图已下载");
      } else {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = filename;
        a.click();
        showToast("词云图已下载");
      }
    } catch (err) {
      console.error(err);
      showToast("导出失败：" + (err.message || "未知错误"));
    }
  }

  function showMobileSaveDialog(dataUrl, blob, filename) {
    let overlay = document.getElementById("save-preview-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "save-preview-overlay";
      overlay.className = "save-preview-overlay";
      overlay.hidden = true;
      overlay.innerHTML = `
        <div class="save-preview-box">
          <p class="save-preview-title">保存词云图</p>
          <p class="save-preview-hint">长按图片可保存到相册；或点击下方按钮分享</p>
          <img id="save-preview-img" class="save-preview-img" alt="词云图" />
          <div class="save-preview-actions">
            <button type="button" id="save-preview-share" class="btn-primary">分享 / 保存到相册</button>
            <a id="save-preview-download" class="btn-secondary save-download-link" download>尝试直接下载</a>
            <button type="button" id="save-preview-close" class="btn-ghost">关闭</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector("#save-preview-close").addEventListener("click", () => {
        overlay.hidden = true;
      });
    }

    const img = overlay.querySelector("#save-preview-img");
    const shareBtn = overlay.querySelector("#save-preview-share");
    const downloadLink = overlay.querySelector("#save-preview-download");

    img.src = dataUrl;
    downloadLink.href = dataUrl;
    downloadLink.download = filename;

    shareBtn.onclick = async () => {
      if (blob && navigator.share) {
        try {
          const file = new File([blob], filename, { type: "image/png" });
          if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file], title: "词云图" });
            showToast("已通过系统分享保存");
            return;
          }
        } catch (e) {
          if (e?.name === "AbortError") return;
        }
      }
      showToast("请长按上方图片，选择「存储图像」或「保存图片」");
    };

    overlay.hidden = false;
    showToast("可长按图片保存，或点「分享/保存到相册」");
  }

  async function drawStageBackground(ctx, w, h) {
    const { background, customBgImage } = WordStore.getBackground();

    const stageGrad = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, w * 0.55);
    stageGrad.addColorStop(0, "rgba(124,147,255,0.22)");
    stageGrad.addColorStop(1, "transparent");

    if (customBgImage) {
      const img = await loadImage(customBgImage);
      ctx.drawImage(img, 0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(0, 0, w, h);
    } else {
      const colors = BG_PRESETS[background] || BG_PRESETS["gradient-1"];
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, colors[0]);
      grad.addColorStop(0.5, colors[1]);
      grad.addColorStop(1, colors[2]);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.fillStyle = stageGrad;
    ctx.fillRect(0, 0, w, h);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function formatDate() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function exportData() {
    const blob = new Blob([WordStore.exportJSON()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ciyun-data-${Date.now()}.json`;
    a.click();
    showToast("数据已导出");
  }

  function showToast(msg) {
    if (!msg) return;
    toast.hidden = false;
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
      toast.hidden = true;
    }, 2800);
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function showBootError(msg) {
    const box = document.getElementById("boot-error");
    const msgEl = document.getElementById("boot-error-msg");
    if (box && msgEl) { msgEl.textContent = msg; box.hidden = false; }
  }

  if (typeof echarts === "undefined") {
    showBootError("ECharts 未加载，请通过「启动词云.bat」访问");
  } else {
    try {
      init().catch((err) => { console.error(err); showBootError(err.message); });
    } catch (err) {
      console.error(err);
      showBootError(err.message);
    }
  }
})();
