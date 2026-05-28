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
  const controlPanel = document.getElementById("control-panel");
  const panelSourceSections = document.querySelectorAll("[data-panel-source]");
  const btnClearCloud = document.getElementById("btn-clear-cloud");
  const btnRecStart = document.getElementById("btn-rec-start");
  const btnRecPause = document.getElementById("btn-rec-pause");
  const btnRecEnd = document.getElementById("btn-rec-end");
  const btnAdd = document.getElementById("btn-add");
  const btnLoadDemo = document.getElementById("btn-load-demo");
  const btnReset = document.getElementById("btn-reset");
  const btnExport = document.getElementById("btn-export");
  const btnDownload = document.getElementById("btn-download");
  const btnClearSpeech = document.getElementById("btn-clear-speech");
  const wordInput = document.getElementById("word-input");
  const wordListEditor = document.getElementById("word-list-editor");
  const speechWordListEditor = document.getElementById("speech-word-list-editor");
  const speechEditor = document.getElementById("speech-editor");
  const interimText = document.getElementById("interim-text");
  const speechStatus = document.getElementById("speech-status");
  const localServerBox = document.getElementById("local-server-box");
  const localServerHint = document.getElementById("local-server-hint");
  const localServerNote = document.getElementById("local-server-note");
  const btnStartLocalServer = document.getElementById("btn-start-local-server");
  const btnMobileBrowserVoice = document.getElementById("btn-mobile-browser-voice");
  const mobileLanBox = document.getElementById("mobile-lan-box");
  const mobileLanUrl = document.getElementById("mobile-lan-url");
  const btnCopyLanUrl = document.getElementById("btn-copy-lan-url");
  const mobileVoiceTip = document.getElementById("mobile-voice-tip");
  const LAUNCHER_URL = "http://127.0.0.1:8764";
  const statTotal = document.getElementById("stat-total");
  const statUnique = document.getElementById("stat-unique");
  const toast = document.getElementById("toast");
  const bgUpload = document.getElementById("bg-upload");
  const maskUpload = document.getElementById("mask-upload");
  const shapeStrip = document.getElementById("shape-strip");
  const shapeOutlineGuide = document.getElementById("shape-outline-guide");
  const segmentEngineEl = document.getElementById("segment-engine");
  const clientBadgeEl = document.getElementById("client-badge");

  let recognition = null;
  /** @type {'idle'|'recording'|'paused'} */
  let recorderState = "idle";
  let toastTimer = null;
  let renderPending = false;
  let holdAnchor = "";
  /** 本会话已确定的识别文本（跨多次 recognition 重启累加） */
  let sessionCommitted = "";
  /** 当前这一次 recognition 实例内已确定的文本 */
  let instanceFinal = "";
  /** 当前正在识别的临时文本 */
  let holdInterim = "";
  let stopTimer = null;
  let recognitionBusy = false;
  let recognitionStarting = false;
  let recWatchdog = null;
  let restartAttempts = 0;
  let lastSpeechResultAt = 0;
  const MAX_REC_RESTART = 20;
  /** @type {'server'|'webspeech'|'none'} */
  let speechMode = "webspeech";
  let serverTranscribeOk = false;
  let serverTranscribeOnCurrentPage = false;
  let mediaStream = null;
  let mediaRecorder = null;
  /** @type {Blob[]} */
  let transcribeQueue = [];
  let transcribeBusy = false;
  let firstServerTranscribe = true;
  let localServerStarting = false;
  let localServerPollTimer = null;
  /** @type {string|null} 本机词云服务地址（由端口扫描得到） */
  let detectedLocalServerUrl = null;
  const TRANSCRIBE_SLICE_MS = 2500;
  const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

  async function init() {
    WordCloudChart.init(chartEl);
    SyncHub.init();
    buildShapeStrip();
    applyBackground();
    updateShapeOutlineGuide();
    await Segmenter.init();
    const userDictEl = document.getElementById("user-dict-input");
    if (userDictEl && !userDictEl.value) {
      userDictEl.value = Segmenter.getUserDictText();
    }
    updateSegmentBadge();
    updateClientBadge();
    await initManualInput();
    bindEvents();

    SyncHub.subscribe((payload) => {
      if (WordStore.applySnapshot(payload)) {
        onRemoteUpdate();
        setSyncStatus(true);
      }
    });

    await initSpeech();
    await updateLocalServerBox();
    await updateMobileLanBox();
    setTimeout(async () => {
      if (shouldUseMobileBrowserSpeech()) return;
      if (canUseServerSpeechHere()) {
        updateLocalServerBox();
        return;
      }
      if (await probeServerTranscribe()) {
        if (canUseServerSpeechHere()) {
          speechMode = "server";
          speechStatus.textContent = "本地 Whisper";
          speechStatus.title = "本地语音识别已就绪，不依赖 Google";
          speechStatus.classList.remove("unsupported");
        }
        updateLocalServerBox();
        updateMobileLanBox();
      }
    }, 2500);
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
      if (!shouldUseMobileBrowserSpeech()) {
        await probeServerTranscribe();
        if (canUseServerSpeechHere()) {
          speechMode = "server";
          speechStatus.textContent = "本地 Whisper";
          speechStatus.title = "本地语音识别已就绪";
        }
        updateLocalServerBox();
        updateMobileLanBox();
      }
      updateSegmentBadge();
      updateMobileVoiceTip();
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
      segmentEngineEl.title = url ? `在线 jieba 分词\n${url}` : "在线 jieba 分词";
      return;
    }
    const n = Segmenter.getDictSize?.() || 0;
    segmentEngineEl.textContent = n > 0 ? `分词: 词典(${n})` : "分词: 本地";
    segmentEngineEl.className = "segment-badge segment-local";
    segmentEngineEl.title = n > 0
      ? `已加载 ${n} 个领域词；运行 python web/serve.py 可启用 jieba\n可在「自定义词条」补充误拆词`
      : "未连接 jieba，请运行 python web/serve.py 或添加自定义词条";
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

  function isSpeechDraftActive() {
    return !!(speechEditor?.value.trim() || speechWordListEditor?.value.trim());
  }

  function updateClientBadge() {
    if (!clientBadgeEl) return;
    const id = WordStore.getClientId?.() || ClientSession.getClientId();
    clientBadgeEl.textContent = id;
    clientBadgeEl.title = `本机编号 ${id} · 词云数据仅保存在本浏览器`;
  }

  async function probeLauncher() {
    try {
      const res = await fetch(`${LAUNCHER_URL}/api/status`, {
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  function isLocalServerConnected() {
    return speechMode === "server" && canUseServerSpeechHere();
  }

  async function updateLocalServerBox() {
    if (!localServerBox) return;

    if (shouldUseMobileBrowserSpeech()) {
      localServerBox.classList.add("hidden");
      return;
    }

    if (isLocalServerConnected()) {
      localServerBox.classList.add("hidden");
      btnMobileBrowserVoice?.classList.add("hidden");
      return;
    }

    localServerBox.classList.remove("hidden");

    btnStartLocalServer?.classList.remove("hidden");
    btnMobileBrowserVoice?.classList.add("hidden");

    const launcher = await probeLauncher();

    if (localServerStarting) {
      if (localServerHint) {
        localServerHint.textContent = "正在启动本地服务，首次约需 30–60 秒（加载 Whisper 模型）…";
      }
      if (btnStartLocalServer) {
        btnStartLocalServer.disabled = true;
        btnStartLocalServer.textContent = "启动中…";
      }
      return;
    }

    if (btnStartLocalServer) {
      btnStartLocalServer.disabled = false;
    }

    const openUrl = launcher?.serverUrl || detectedLocalServerUrl;
    if (openUrl && !serverTranscribeOnCurrentPage) {
      if (localServerHint) {
        localServerHint.textContent = "本机服务已运行，点击进入本地词云页面即可使用语音";
      }
      if (btnStartLocalServer) btnStartLocalServer.textContent = "进入本地词云（启用语音）";
      return;
    }

    if (openUrl && serverTranscribeOnCurrentPage && !canUseServerSpeechHere()) {
      if (localServerHint) {
        localServerHint.textContent = "请刷新页面或点击下方按钮重新连接本地语音识别";
      }
      if (btnStartLocalServer) btnStartLocalServer.textContent = "重新连接本地语音";
      return;
    }

    if (launcher?.launcher) {
      if (localServerHint) {
        localServerHint.textContent = "点击下方按钮，即可启动本地 Whisper 语音识别";
      }
      if (btnStartLocalServer) btnStartLocalServer.textContent = "启动本地服务";
      if (localServerNote) {
        localServerNote.textContent = "首次点按钮即可；若助手未配置会引导下载安装程序（仅需一次）";
      }
      return;
    }

    if (localServerHint) {
      localServerHint.textContent = "首次需配置启动助手（仅需一次），之后点按钮即可使用语音";
    }
    if (btnStartLocalServer) btnStartLocalServer.textContent = "首次配置并启动";
    if (localServerNote) {
      localServerNote.textContent = "首次点「首次配置并启动」会下载安装程序（仅需运行一次）· 之后点按钮即可使用语音";
    }
  }

  async function updateMobileLanBox() {
    if (!mobileLanBox || ClientSession.IS_MOBILE || !canUseServerSpeechHere()) {
      mobileLanBox?.classList.add("hidden");
      return;
    }
    try {
      const res = await fetch("/api/host-info", { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error("no host info");
      const data = await res.json();
      if (!data.lanUrl) {
        mobileLanBox.classList.add("hidden");
        return;
      }
      mobileLanUrl.textContent = `手机与电脑同一 WiFi，浏览器打开：${data.lanUrl}`;
      mobileLanBox.classList.remove("hidden");
      if (btnCopyLanUrl) btnCopyLanUrl.dataset.url = data.lanUrl;
    } catch (_) {
      mobileLanBox.classList.add("hidden");
    }
  }

  function shouldUseMobileBrowserSpeech() {
    return ClientSession.IS_MOBILE && ClientSession.MOBILE_PREFER_BROWSER_SPEECH;
  }

  function updateMobileVoiceTip() {
    if (!mobileVoiceTip) return;
    const show = shouldUseMobileBrowserSpeech() && speechMode === "webspeech";
    mobileVoiceTip.classList.toggle("hidden", !show);
  }

  function setupMobileBrowserSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      speechMode = "none";
      speechStatus.textContent = "语音不可用";
      speechStatus.title = "请换用 Chrome / Edge 手机浏览器";
      speechStatus.classList.add("unsupported");
      btnRecStart.disabled = true;
      btnRecPause.disabled = true;
      btnRecEnd.disabled = true;
      return false;
    }
    speechMode = "webspeech";
    recognition = createRecognitionInstance();
    speechStatus.textContent = "浏览器识别";
    speechStatus.title = "手机浏览器内置识别，无需安装";
    speechStatus.classList.remove("unsupported");
    btnRecStart.disabled = false;
    btnRecPause.disabled = false;
    btnRecEnd.disabled = false;
    return true;
  }

  async function startLocalServerFromPanel() {
    if (localServerStarting || shouldUseMobileBrowserSpeech()) return;

    const launcher = await probeLauncher();
    const openUrl = launcher?.serverUrl || detectedLocalServerUrl;

    if (openUrl && !serverTranscribeOnCurrentPage) {
      window.location.href = openUrl;
      return;
    }

    if (!launcher?.launcher) {
      downloadInstallHelper();
      showToast("已下载「安装本地服务.bat」，请运行它（仅需一次），本页将自动检测并跳转");
      if (localServerHint) {
        localServerHint.textContent = "请运行刚下载的安装程序… 完成后将自动跳转到本地词云";
      }
      startLocalServerPoll((url) => {
        showToast("本地服务已就绪，正在跳转…");
        window.location.href = url;
      });
      return;
    }

    localServerStarting = true;
    await updateLocalServerBox();

    try {
      const res = await fetch(`${LAUNCHER_URL}/api/start`, {
        method: "POST",
        signal: AbortSignal.timeout(120000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.serverUrl) {
        throw new Error(data.error || "启动失败");
      }

      showToast(data.alreadyRunning ? "本地服务已在运行，正在跳转…" : "本地服务已启动，正在跳转…");
      window.location.href = data.serverUrl;
    } catch (err) {
      showToast(err.message || "启动失败，请运行 web\\安装本地服务.bat");
      localServerStarting = false;
      await updateLocalServerBox();
    }
  }

  function onRemoteUpdate() {
    refreshChart(false);
    updateStats();
    updateSourceTabsUI();
    emptyHint.classList.toggle("hidden", !WordStore.isEmpty());
    btnDownload.disabled = WordStore.isEmpty();
    applyBackground();
    buildShapeStrip();
    updateShapeOutlineGuide();
  }

  function syncPanelWordLists(source) {
    if (source === "voice" && !isSpeechDraftActive() && recorderState === "idle") {
      syncSpeechWordListFromStore();
    } else if (source === "manual") {
      syncWordListFromStore();
    }
  }

  function updatePanelSections() {
    const src = WordStore.getDisplaySource();
    panelSourceSections.forEach((section) => {
      const sectionSource = section.dataset.panelSource;
      const visible = src === "all" || src === sectionSource;
      section.classList.toggle("panel-hidden", !visible);
      section.setAttribute("aria-hidden", visible ? "false" : "true");
    });
    if (controlPanel) {
      controlPanel.dataset.panelMode = src;
    }
  }

  function updateSourceTabsUI() {
    if (!sourceTabs) return;
    const src = WordStore.getDisplaySource();
    sourceTabs.querySelectorAll(".source-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.source === src);
    });
    updatePanelSections();
  }

  function updateSourceTabs() {
    updateSourceTabsUI();
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

  function wordsToEditorText(words) {
    return words.filter(Boolean).join(" ");
  }

  function parseWordsFromEditor(text) {
    if (!text || !text.trim()) return [];
    return text.trim().split(/[\s,，;；、]+/).map((w) => w.trim()).filter(Boolean);
  }

  function listToEditorText(entries) {
    const tokens = [];
    for (const [word, count] of entries) {
      for (let i = 0; i < count; i++) tokens.push(word);
    }
    return tokens.join(" ");
  }

  function syncWordListEditor(editor, source) {
    if (!editor) return;
    const list = WordStore.getFullListForSource(source);
    editor.value = list.length > 0 ? listToEditorText(list) : "";
  }

  function syncWordListFromStore() {
    syncWordListEditor(wordListEditor, "manual");
  }

  function syncSpeechWordListFromStore() {
    syncWordListEditor(speechWordListEditor, "voice");
  }

  async function extractWordsToEditor(textEl, editorEl, emptyMsg, silent) {
    const text = textEl?.value.trim();
    if (!text) {
      showToast(emptyMsg);
      return;
    }
    const words = await Segmenter.extractWordsAsync(text);
    if (editorEl) editorEl.value = wordsToEditorText(words);
    updateSegmentBadge();
    if (!silent) showToast(`已提取 ${words.length} 个词，可在下方编辑后提交`);
    return words;
  }

  async function extractToWordList() {
    return extractWordsToEditor(wordInput, wordListEditor, "请先在上方输入文本");
  }

  async function extractSpeechToWordList(silent) {
    const words = await extractWordsToEditor(
      speechEditor,
      speechWordListEditor,
      "请先在识别结果中输入或录入内容",
    );
    if (!silent && words?.length) {
      showToast(`已提取 ${words.length} 个词，可在下方编辑后提交`);
    }
    return words;
  }

  async function submitWordListForSource(editor, source, sourceLabel) {
    if (!editor) return;
    const words = parseWordsFromEditor(editor.value);
    if (words.length === 0) {
      showToast("词汇列表为空，请先提取或输入词汇");
      return;
    }
    WordStore.setDisplaySource(source);
    updateSourceTabs();
    const result = WordStore.replaceWords(words, source);
    if (result.added > 0) {
      await refreshChart(true);
      updateStats();
      updateSegmentBadge();
      emptyHint.classList.toggle("hidden", !WordStore.isEmpty());
      btnDownload.disabled = false;
      showToast(`已提交 ${result.added} 个词到${sourceLabel}词云${result.blocked.length ? `，拦截 ${result.blocked.length} 个敏感词` : ""}`);
    } else if (result.blocked.length) {
      showToast(`含敏感词已拦截：${result.blocked.join("、")}`);
    } else {
      showToast("未识别到有效词汇");
    }
  }

  async function submitWordList() {
    return submitWordListForSource(wordListEditor, "manual", "手动");
  }

  async function submitSpeechWordList() {
    return submitWordListForSource(speechWordListEditor, "voice", "语音");
  }

  async function copyWordListFromEditor(editor) {
    const text = editor?.value.trim();
    if (!text) {
      showToast("暂无词汇可复制");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast("词汇已复制到剪贴板");
    } catch (_) {
      editor.select();
      document.execCommand("copy");
      showToast("词汇已复制");
    }
  }

  async function copyWordList() {
    return copyWordListFromEditor(wordListEditor);
  }

  async function copySpeechWordList() {
    return copyWordListFromEditor(speechWordListEditor);
  }

  async function resegmentFromSource(textEl, editorEl, emptyMsg, source, sourceLabel) {
    const text = textEl?.value.trim();
    if (!text) {
      showToast(emptyMsg);
      return;
    }
    const words = source === "voice"
      ? await extractSpeechToWordList()
      : await extractToWordList();
    if (!words?.length) return;
    WordStore.setDisplaySource(source);
    updateSourceTabs();
    WordStore.clearDisplay();
    const result = WordStore.replaceWords(words, source);
    const engine = Segmenter.getLastEngine() === "jieba" ? "jieba" : "词典";
    if (result.added > 0) {
      await refreshChart(true);
      updateStats();
      updateSegmentBadge();
      emptyHint.classList.toggle("hidden", !WordStore.isEmpty());
      btnDownload.disabled = false;
      showToast(`已重新分词${sourceLabel}（${engine}），共 ${result.added} 个词`);
    } else {
      showToast("重新分词未得到有效词汇");
    }
  }

  async function resegmentManual() {
    return resegmentFromSource(wordInput, wordListEditor, "请先在文本框中输入内容", "manual", "");
  }

  async function resegmentSpeech() {
    return resegmentFromSource(speechEditor, speechWordListEditor, "请先在识别结果中输入或录入内容", "voice", "语音");
  }

  async function appendFromSource(textEl, editorEl, source, sourceLabel) {
    const text = textEl?.value.trim();
    if (!text) {
      showToast(source === "voice" ? "请先输入或说出内容" : "请先输入文本");
      return;
    }
    const words = await Segmenter.extractWordsAsync(text);
    if (words.length === 0) {
      showToast("未识别到有效词汇");
      return;
    }
    if (editorEl) {
      const existing = parseWordsFromEditor(editorEl.value);
      editorEl.value = wordsToEditorText(existing.concat(words));
    }
    WordStore.setDisplaySource(source);
    updateSourceTabs();
    const result = WordStore.addWords(words, source);
    if (result.added > 0) {
      await refreshChart(true);
      updateStats();
      updateSegmentBadge();
      emptyHint.classList.toggle("hidden", !WordStore.isEmpty());
      btnDownload.disabled = false;
      const engine = Segmenter.getLastEngine() === "jieba" ? "jieba" : "词典";
      showToast(`已追加 ${result.added} 个词到${sourceLabel}（${engine}）${result.blocked.length ? `，拦截 ${result.blocked.length} 个` : ""}`);
    } else if (result.blocked.length) {
      showToast(`含敏感词已拦截：${result.blocked.join("、")}`);
    }
  }

  function saveUserDictFromPanel() {
    const el = document.getElementById("user-dict-input");
    if (!el) return;
    const lines = el.value.split(/[\n,，;；]+/).map((s) => s.trim()).filter(Boolean);
    Segmenter.saveUserDict(lines);
    updateSegmentBadge();
    showToast(`已保存 ${lines.length} 个自定义词条`);
  }

  async function initManualInput() {
    if (wordInput) wordInput.value = "";
    if (wordListEditor) wordListEditor.value = "";
    if (speechWordListEditor) speechWordListEditor.value = "";
  }

  async function loadDemoSample() {
    WordStore.clearAll();
    const text = DemoSample.getText();
    if (wordInput) wordInput.value = text;
    const result = await ingestText(text, "manual");
    syncWordListFromStore();
    if (result.added > 0) {
      showToast(`已载入形状预览示例（${result.added} 个词）`);
    } else {
      showToast("示例载入失败，请重试");
    }
  }

  function bindEvents() {
    btnRecStart?.addEventListener("click", async () => {
      if (recorderState === "paused") await resumeRecording();
      else if (recorderState === "idle") await startRecording();
    });
    btnRecPause?.addEventListener("click", pauseRecording);
    btnRecEnd?.addEventListener("click", endRecording);
    btnStartLocalServer?.addEventListener("click", startLocalServerFromPanel);
    btnMobileBrowserVoice?.addEventListener("click", () => {
      setupMobileBrowserSpeech();
      updateMobileVoiceTip();
      showToast("已启用浏览器识别，请点击「开始录音」");
    });
    btnCopyLanUrl?.addEventListener("click", () => {
      const url = btnCopyLanUrl.dataset.url;
      if (!url) return;
      navigator.clipboard?.writeText(url).then(
        () => showToast("已复制，请在手机浏览器粘贴打开"),
        () => showToast(url),
      );
    });

    sourceTabs?.addEventListener("click", (e) => {
      const btn = e.target.closest(".source-tab");
      if (!btn) return;
      WordStore.setDisplaySource(btn.dataset.source);
      updateSourceTabsUI();
      syncPanelWordLists(btn.dataset.source);
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

    document.getElementById("btn-speech-append")?.addEventListener("click", submitSpeechAppend);
    document.getElementById("btn-speech-resegment")?.addEventListener("click", resegmentSpeech);
    document.getElementById("btn-speech-extract-words")?.addEventListener("click", extractSpeechToWordList);
    document.getElementById("btn-speech-copy-words")?.addEventListener("click", copySpeechWordList);
    document.getElementById("btn-speech-submit-words")?.addEventListener("click", submitSpeechWordList);
    btnClearSpeech?.addEventListener("click", () => {
      speechEditor.value = "";
      if (speechWordListEditor) speechWordListEditor.value = "";
      interimText.textContent = "";
      resetSpeechSession();
    });

    btnAdd.addEventListener("click", submitManualInput);
    btnLoadDemo?.addEventListener("click", loadDemoSample);
    document.getElementById("btn-resegment")?.addEventListener("click", resegmentManual);
    document.getElementById("btn-extract-words")?.addEventListener("click", extractToWordList);
    document.getElementById("btn-copy-words")?.addEventListener("click", copyWordList);
    document.getElementById("btn-submit-words")?.addEventListener("click", submitWordList);
    document.getElementById("btn-save-user-dict")?.addEventListener("click", saveUserDictFromPanel);
    wordInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        extractToWordList();
      }
    });
    wordListEditor?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submitWordList();
      }
    });
    speechEditor?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        extractSpeechToWordList();
      }
    });
    speechWordListEditor?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submitSpeechWordList();
      }
    });
    btnDownload.addEventListener("click", downloadWordCloudImage);

    btnReset.addEventListener("click", () => {
      if (!confirm("确定清空所有词云数据（语音 + 手动）？")) return;
      WordStore.clearAll();
      speechEditor.value = "";
      if (speechWordListEditor) speechWordListEditor.value = "";
      resetSpeechSession();
      refreshAll();
      showToast("全部词云已清空");
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (recorderState === "recording") {
          commitInstanceTranscript();
          paintSpeechEditor();
        }
        return;
      }
      if (recorderState === "recording") {
        scheduleRecognitionRestart(250);
      }
    });

    window.addEventListener("pageshow", (e) => {
      if (e.persisted && recorderState === "recording") {
        scheduleRecognitionRestart(350);
      }
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

  function getLiveTranscript() {
    return holdAnchor + sessionCommitted + instanceFinal + holdInterim;
  }

  function commitInstanceTranscript() {
    sessionCommitted += instanceFinal + holdInterim;
    instanceFinal = "";
    holdInterim = "";
  }

  function resetSpeechSession() {
    holdAnchor = "";
    sessionCommitted = "";
    instanceFinal = "";
    holdInterim = "";
    lastSpeechResultAt = 0;
  }

  function paintSpeechEditor() {
    if (!speechEditor) return;
    const text = getLiveTranscript();
    if (speechEditor.value !== text) {
      speechEditor.value = text;
    }
    speechEditor.classList.toggle("is-recording", recorderState === "recording");
    interimText?.classList.toggle("is-live", recorderState === "recording" && !!holdInterim);
    speechEditor.scrollTop = speechEditor.scrollHeight;

    if (holdInterim) {
      interimText.textContent = `实时识别：${holdInterim}`;
    } else if (recorderState === "recording") {
      if (speechMode === "server") {
        if (transcribeBusy) {
          interimText.textContent = "正在识别上一段，请继续说话…";
        } else {
          interimText.textContent = "本地识别中，约每 2 秒更新一次识别结果";
        }
      } else {
        const silentMs = lastSpeechResultAt ? Date.now() - lastSpeechResultAt : 0;
        if (lastSpeechResultAt && silentMs > 4000) {
          interimText.textContent = ClientSession.IS_MOBILE
            ? "未收到识别结果，请换 Chrome/Edge，或检查麦克风与网络"
            : "浏览器识别无响应：请运行 python web/serve.py 启用本地识别，或换用 Edge";
        } else {
          interimText.textContent = "正在聆听，请说话…";
        }
      }
    } else if (recorderState === "paused") {
      interimText.textContent = "已暂停，点击「继续录音」可接着录入";
    } else if (!speechEditor.value.trim()) {
      interimText.textContent = "";
    } else if (recorderState === "idle") {
      interimText.textContent = "识别完成，可编辑后提交";
    }
  }

  function flushRecognitionToEditor() {
    commitInstanceTranscript();
    speechEditor.value = getLiveTranscript();
    holdAnchor = speechEditor.value;
    sessionCommitted = "";
    instanceFinal = "";
    holdInterim = "";
  }

  function startRecWatchdog() {
    stopRecWatchdog();
    recWatchdog = setInterval(() => {
      if (recorderState !== "recording") return;
      paintSpeechEditor();
      if (speechMode === "webspeech" && !recognitionBusy && !recognitionStarting) {
        scheduleRecognitionRestart(60);
      }
    }, 1500);
  }

  function stopRecWatchdog() {
    if (recWatchdog) {
      clearInterval(recWatchdog);
      recWatchdog = null;
    }
  }

  function scheduleRecognitionRestart(delay = 150) {
    if (recorderState !== "recording") return;
    setTimeout(() => {
      if (recorderState === "recording" && !recognitionBusy && !recognitionStarting) {
        tryStartRecognition();
      }
    }, delay);
  }

  function bindRecognitionHandlers(rec) {
    rec.onresult = (event) => {
      if (recorderState !== "recording") return;
      lastSpeechResultAt = Date.now();
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript || "";
        if (!text) continue;
        if (result.isFinal) instanceFinal += text;
        else interim += text;
      }
      holdInterim = interim;
      paintSpeechEditor();
    };

    rec.onerror = (e) => {
      const err = e.error;
      recognitionStarting = false;
      if (err === "no-speech") {
        if (recorderState === "recording") scheduleRecognitionRestart(300);
        return;
      }
      if (err === "aborted") return;
      if (err === "not-allowed") {
        showToast("麦克风权限被拒绝，请在浏览器设置中允许");
        endRecording(true);
        return;
      }
      if (err === "network") {
        interimText.textContent = "网络异常：Chrome 语音识别需访问 Google 服务，请检查网络或换用 Edge";
        scheduleRecognitionRestart(800);
        return;
      }
      if (err === "service-not-allowed") {
        showToast("当前页面无法使用麦克风，请用 HTTPS 或 localhost 打开");
        endRecording(true);
        return;
      }
      if (recorderState === "recording") scheduleRecognitionRestart(500);
    };

    rec.onend = () => {
      recognitionBusy = false;
      recognitionStarting = false;
      if (recorderState !== "recording") return;
      commitInstanceTranscript();
      paintSpeechEditor();
      scheduleRecognitionRestart(ClientSession.IS_MOBILE ? 300 : 120);
    };

    rec.onstart = () => {
      recognitionBusy = true;
      recognitionStarting = false;
      restartAttempts = 0;
      lastSpeechResultAt = Date.now();
      speechStatus.textContent = "聆听中…";
      speechStatus.classList.add("listening");
      interimText.textContent = "正在聆听，请说话…";
    };

    rec.onspeechstart = () => {
      lastSpeechResultAt = Date.now();
      interimText.textContent = "已检测到语音…";
    };

    rec.onsoundstart = () => {
      if (recorderState === "recording" && !holdInterim) {
        interimText.textContent = "正在接收声音…";
      }
    };
  }

  function createRecognitionInstance() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const rec = new SR();
    rec.lang = "zh-CN";
    rec.continuous = !ClientSession.IS_MOBILE;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    bindRecognitionHandlers(rec);
    return rec;
  }

  function stopRecognitionEngine() {
    recognitionBusy = false;
    recognitionStarting = false;
    if (!recognition) return;
    try {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onstart = null;
    } catch (_) { /* ignore */ }
    try {
      recognition.abort();
    } catch (_) {
      try { recognition.stop(); } catch (_2) { /* ignore */ }
    }
  }

  function recreateRecognition() {
    stopRecognitionEngine();
    recognition = createRecognitionInstance();
  }

  function updateRecordingUI() {
    const recording = recorderState === "recording";
    const paused = recorderState === "paused";
    const active = recording || paused;

    btnRecStart?.classList.toggle("recording", recording);
    btnRecStart.disabled = recording;
    if (btnRecStart) {
      btnRecStart.textContent = paused ? "继续录音" : "开始录音";
    }
    btnRecPause.disabled = !recording;
    btnRecEnd.disabled = !active;
    document.getElementById("rec-controls")?.classList.toggle("is-session-active", active);
  }

  function isOnLocalKioskOrigin() {
    return LOCAL_HOSTS.has(window.location.hostname);
  }

  function getLocalServerUrlFromPort(port) {
    return port ? `http://127.0.0.1:${port}/` : null;
  }

  async function scanLocalServerPorts() {
    for (const port of [8765, 8766, 8767, 8080]) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/transcribe/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (data.available) {
          return { port, url: getLocalServerUrlFromPort(port) };
        }
      } catch (_) { /* try next */ }
    }
    return null;
  }

  async function probeServerTranscribe() {
    detectedLocalServerUrl = null;
    serverTranscribeOnCurrentPage = false;

    try {
      const res = await fetch("/api/transcribe/health", {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.available) {
          serverTranscribeOk = true;
          serverTranscribeOnCurrentPage = true;
          detectedLocalServerUrl = `${window.location.origin}/`;
          return true;
        }
      }
    } catch (_) { /* 当前页不是本地服务 */ }

    if (!ClientSession.IS_MOBILE) {
      const found = await scanLocalServerPorts();
      if (found) {
        serverTranscribeOk = true;
        detectedLocalServerUrl = found.url;
        return true;
      }
    }

    serverTranscribeOk = false;
    return false;
  }

  function canUseServerSpeechHere() {
    return serverTranscribeOnCurrentPage;
  }

  function downloadInstallHelper() {
    const batUrl = new URL("安装本地服务.bat", window.location.href).href;
    const a = document.createElement("a");
    a.href = batUrl;
    a.download = "安装本地服务.bat";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function stopLocalServerPoll() {
    if (localServerPollTimer) {
      clearInterval(localServerPollTimer);
      localServerPollTimer = null;
    }
  }

  function startLocalServerPoll(onReady) {
    stopLocalServerPoll();
    let tries = 0;
    localServerPollTimer = setInterval(async () => {
      tries += 1;
      const launcher = await probeLauncher();
      if (launcher?.serverRunning && launcher.serverUrl) {
        stopLocalServerPoll();
        onReady(launcher.serverUrl);
        return;
      }
      if (tries >= 90) stopLocalServerPoll();
    }, 2000);
  }

  function pickRecorderMimeType() {
    const types = ClientSession.IS_MOBILE
      ? ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"]
      : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return "";
  }

  function enqueueTranscribeChunk(blob) {
    if (!blob || blob.size < 128) return;
    transcribeQueue.push(blob);
    drainTranscribeQueue();
  }

  async function transcribeChunk(blob) {
    const res = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": blob.type || "audio/webm" },
      body: blob,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `识别失败 (${res.status})`);
    }
    return (data.text || "").trim();
  }

  async function drainTranscribeQueue() {
    if (transcribeBusy || transcribeQueue.length === 0) return;
    if (recorderState !== "recording" && recorderState !== "paused") return;

    transcribeBusy = true;
    const blob = transcribeQueue.shift();
    holdInterim = firstServerTranscribe
      ? "首次识别正在加载模型，约需 10–30 秒…"
      : "正在识别…";
    paintSpeechEditor();

    try {
      const text = await transcribeChunk(blob);
      if (text && (recorderState === "recording" || recorderState === "paused")) {
        sessionCommitted += text;
        lastSpeechResultAt = Date.now();
        firstServerTranscribe = false;
      }
    } catch (err) {
      console.warn("本地语音识别失败", err);
      if (recorderState === "recording") {
        interimText.textContent = `识别出错：${err.message || err}`;
      }
    } finally {
      holdInterim = "";
      transcribeBusy = false;
      paintSpeechEditor();
      if (transcribeQueue.length > 0) drainTranscribeQueue();
    }
  }

  async function waitTranscribeQueueIdle(maxMs = 12000) {
    const start = Date.now();
    while ((transcribeBusy || transcribeQueue.length > 0) && Date.now() - start < maxMs) {
      await new Promise((r) => setTimeout(r, 120));
      if (!transcribeBusy && transcribeQueue.length > 0) drainTranscribeQueue();
    }
  }

  function stopMediaCapture() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      try { mediaRecorder.stop(); } catch (_) { /* ignore */ }
    }
    mediaRecorder = null;
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
  }

  async function startServerRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast("当前浏览器不支持麦克风");
      recorderState = "idle";
      updateRecordingUI();
      return;
    }

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (_) {
      showToast("请允许浏览器使用麦克风");
      recorderState = "idle";
      updateRecordingUI();
      return;
    }

    const mimeType = pickRecorderMimeType();
    try {
      mediaRecorder = mimeType
        ? new MediaRecorder(mediaStream, { mimeType })
        : new MediaRecorder(mediaStream);
    } catch (_) {
      showToast("无法启动录音");
      stopMediaCapture();
      recorderState = "idle";
      updateRecordingUI();
      return;
    }

    transcribeQueue = [];
    transcribeBusy = false;
    lastSpeechResultAt = Date.now();

    mediaRecorder.ondataavailable = (e) => {
      if (e.data?.size) enqueueTranscribeChunk(e.data);
    };
    mediaRecorder.onerror = () => showToast("录音异常，请重试");

    mediaRecorder.start(TRANSCRIBE_SLICE_MS);
    startRecWatchdog();
    interimText.textContent = "本地识别中，请说话…";
    paintSpeechEditor();
  }

  async function initSpeech() {
    if (shouldUseMobileBrowserSpeech()) {
      setupMobileBrowserSpeech();
      updateRecordingUI();
      updateLocalServerBox();
      updateMobileVoiceTip();
      return;
    }

    await probeServerTranscribe();

    if (canUseServerSpeechHere()) {
      speechMode = "server";
      speechStatus.textContent = "本地 Whisper";
      speechStatus.title = "本地语音识别已就绪，不依赖 Google";
      speechStatus.classList.remove("unsupported");
      btnRecStart.disabled = false;
      btnRecPause.disabled = false;
      btnRecEnd.disabled = false;
      updateRecordingUI();
      updateLocalServerBox();
      updateMobileLanBox();
      updateMobileVoiceTip();
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      speechMode = "webspeech";
      recognition = createRecognitionInstance();
      speechStatus.textContent = "就绪";
      speechStatus.classList.remove("unsupported");
      btnRecStart.disabled = false;
      updateRecordingUI();
      updateLocalServerBox();
      updateMobileVoiceTip();
      return;
    }

    speechMode = "none";
    speechStatus.textContent = "语音不可用";
    speechStatus.classList.add("unsupported");
    btnRecStart.disabled = true;
    btnRecPause.disabled = true;
    btnRecEnd.disabled = true;
    updateLocalServerBox();
    updateMobileVoiceTip();
  }

  function tryStartRecognition() {
    if (!recognition || recorderState !== "recording") return;
    if (recognitionBusy || recognitionStarting) return;

    recognitionStarting = true;
    try {
      recognition.start();
    } catch (err) {
      recognitionStarting = false;
      if (err.name === "InvalidStateError") {
        try { recognition.stop(); } catch (_) { /* ignore */ }
        scheduleRecognitionRestart(200);
        return;
      }
      restartAttempts += 1;
      if (restartAttempts >= MAX_REC_RESTART) {
        showToast("语音识别启动失败，请点「结束录音」后重试");
        return;
      }
      recreateRecognition();
      scheduleRecognitionRestart(400);
    }
  }

  async function beginRecordingSession() {
    holdAnchor = speechEditor?.value || "";
    if (holdAnchor.trim() && !holdAnchor.endsWith("\n")) holdAnchor += "\n";
    sessionCommitted = "";
    instanceFinal = "";
    holdInterim = "";
    lastSpeechResultAt = 0;
    restartAttempts = 0;

    recorderState = "recording";
    updateRecordingUI();
    interimText.textContent = speechMode === "server" ? "正在启动本地识别…" : "正在启动麦克风…";
    speechStatus.textContent = "录音中";
    speechStatus.classList.add("listening");
    paintSpeechEditor();
    speechEditor?.focus();
    if (!ClientSession.IS_MOBILE) {
      speechEditor?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    if (speechMode === "server") {
      await startServerRecording();
      return;
    }

    if (!recognition) recreateRecognition();
    startRecWatchdog();
    tryStartRecognition();
  }

  async function startRecording() {
    if (recorderState === "recording") return;

    if (speechMode === "none") {
      await probeServerTranscribe();
      if (serverTranscribeOk) speechMode = "server";
      else if (!recognition) recreateRecognition();
      if (speechMode === "none" && !recognition) {
        showToast("语音识别不可用，请运行 python web/serve.py");
        return;
      }
    }

    if (speechMode === "webspeech" && !recognition) {
      recreateRecognition();
      if (!recognition) {
        showToast("当前浏览器不支持语音输入");
        return;
      }
    }

    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }

    WordStore.setDisplaySource("voice");
    updateSourceTabs();
    await beginRecordingSession();
  }

  async function resumeRecording() {
    if (recorderState !== "paused") return;
    if (speechMode === "webspeech" && !recognition) return;

    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }

    await beginRecordingSession();
  }

  async function pauseRecording() {
    if (recorderState !== "recording") return;

    recorderState = "paused";
    stopRecWatchdog();
    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }

    if (speechMode === "server") {
      stopMediaCapture();
      await waitTranscribeQueueIdle();
      commitInstanceTranscript();
    } else {
      commitInstanceTranscript();
      stopRecognitionEngine();
    }

    flushRecognitionToEditor();
    paintSpeechEditor();
    updateRecordingUI();
    speechStatus.textContent = "已暂停";
    speechStatus.classList.remove("listening");
    interimText.textContent = "已暂停，点击「继续录音」可接着录入";
  }

  async function endRecording(flush = true) {
    if (recorderState !== "recording" && recorderState !== "paused") return;

    recorderState = "idle";
    stopRecWatchdog();
    updateRecordingUI();
    speechStatus.textContent = speechMode === "server" ? "本地识别就绪" : "就绪";
    speechStatus.classList.remove("listening");

    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = null;

    if (speechMode === "server") {
      stopMediaCapture();
      if (flush) await waitTranscribeQueueIdle();
    } else if (recognition) {
      stopRecognitionEngine();
      recreateRecognition();
    }

    if (flush) {
      commitInstanceTranscript();
      flushRecognitionToEditor();
      paintSpeechEditor();
    } else {
      instanceFinal = "";
      holdInterim = "";
    }
  }

  async function submitSpeechAppend() {
    return appendFromSource(speechEditor, speechWordListEditor, "voice", "语音");
  }

  async function submitManualInput() {
    return appendFromSource(wordInput, wordListEditor, "manual", "手动");
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
    return { ...result, words };
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
