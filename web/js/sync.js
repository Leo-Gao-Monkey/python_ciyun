/**
 * 跨标签 / 跨设备实时同步
 * - 本地 serve.py：SSE + POST 多屏同步
 * - GitHub Pages 等静态托管：仅 localStorage + BroadcastChannel（同设备多标签）
 */
const SyncHub = (() => {
  const CHANNEL = "ciyun-kiosk-sync";
  let broadcast = null;
  let eventSource = null;
  /** @type {Set<Function>} */
  const listeners = new Set();
  let pushing = false;
  let serverAvailable = null;

  const isLocalDev = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);

  try {
    broadcast = new BroadcastChannel(CHANNEL);
    broadcast.onmessage = (e) => {
      if (e.data?.type === "state") notify(e.data.payload, "broadcast");
    };
  } catch (_) {
    broadcast = null;
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notify(payload, source) {
    for (const fn of listeners) {
      try { fn(payload, source); } catch (err) { console.error(err); }
    }
  }

  function connectSSE() {
    if (eventSource || serverAvailable === false) return;
    eventSource = new EventSource("/api/events");
    eventSource.addEventListener("update", (e) => {
      serverAvailable = true;
      try {
        const payload = JSON.parse(e.data);
        notify(payload, "sse");
      } catch (err) {
        console.warn("SSE 解析失败", err);
      }
    });
    eventSource.onerror = () => {
      serverAvailable = false;
      eventSource?.close();
      eventSource = null;
      if (isLocalDev) {
        setTimeout(connectSSE, 5000);
      }
    };
  }

  function listenStorage() {
    window.addEventListener("storage", (e) => {
      if (e.key !== WordStore.STORAGE_KEY || !e.newValue) return;
      try {
        notify(JSON.parse(e.newValue), "storage");
      } catch (_) { /* ignore */ }
    });
  }

  async function pushToServer(state) {
    if (pushing || serverAvailable === false) return;
    pushing = true;
    try {
      const res = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      if (res.ok) serverAvailable = true;
    } catch (_) {
      serverAvailable = false;
    } finally {
      pushing = false;
    }
  }

  function broadcastState(state) {
    broadcast?.postMessage({ type: "state", payload: state });
    if (isLocalDev || serverAvailable !== false) {
      pushToServer(state);
    }
  }

  async function fetchRemoteState() {
    if (!isLocalDev && serverAvailable === false) return null;
    try {
      const res = await fetch("/api/state");
      if (!res.ok) {
        serverAvailable = false;
        return null;
      }
      serverAvailable = true;
      return await res.json();
    } catch (_) {
      serverAvailable = false;
      return null;
    }
  }

  function isServerMode() {
    return serverAvailable === true;
  }

  function isStaticHost() {
    return !isLocalDev && serverAvailable !== true;
  }

  /** 本地 serve.py 或已确认可用的 API 服务 */
  function canUseBackendApi() {
    if (isLocalDev) return true;
    if (serverAvailable === true) return true;
    return !!(window.CIYUN_CONFIG?.segmentApi);
  }

  function init() {
    listenStorage();
    if (isLocalDev) {
      connectSSE();
      return;
    }
    fetchRemoteState().finally(() => {
      if (serverAvailable === true) connectSSE();
    });
  }

  return {
    init,
    subscribe,
    broadcastState,
    fetchRemoteState,
    isServerMode,
    isStaticHost,
    canUseBackendApi,
    isLocalDev,
  };
})();

window.SyncHub = SyncHub;
