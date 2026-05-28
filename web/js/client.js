/**
 * 终端会话标识 — 每台浏览器独立保存词云数据
 */
const ClientSession = (() => {
  const CLIENT_ID_KEY = "ciyun-client-id";
  const DISPLAY_SOURCE_KEY = "ciyun-display-source";

  function getClientId() {
    try {
      let id = sessionStorage.getItem(CLIENT_ID_KEY);
      if (!id) {
        const raw = typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        id = `c_${raw.replace(/-/g, "").slice(0, 8)}`;
        sessionStorage.setItem(CLIENT_ID_KEY, id);
      }
      return id;
    } catch (_) {
      return "c_local";
    }
  }

  function getDisplaySource() {
    try {
      const v = sessionStorage.getItem(DISPLAY_SOURCE_KEY);
      if (v === "voice" || v === "manual" || v === "all") return v;
    } catch (_) { /* ignore */ }
    return "voice";
  }

  function setDisplaySource(source) {
    try {
      sessionStorage.setItem(DISPLAY_SOURCE_KEY, source);
    } catch (_) { /* ignore */ }
  }

  const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile|webOS/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 0 && window.innerWidth < 820);

  /** 手机端默认使用浏览器语音识别（无需电脑/安装） */
  const MOBILE_PREFER_BROWSER_SPEECH = true;

  return {
    getClientId,
    getDisplaySource,
    setDisplaySource,
    IS_MOBILE,
    MOBILE_PREFER_BROWSER_SPEECH,
  };
})();

window.ClientSession = ClientSession;
