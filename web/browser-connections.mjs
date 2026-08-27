export const BROWSERS = Object.freeze([
  ["chrome", "Google Chrome"],
  ["whale", "Naver Whale"],
  ["firefox", "Mozilla Firefox"],
]);
const RECENT_CONNECTION_MS = 240_000;
const CHECK_WAIT_MS = 90_000;

export function browserConnectionState(client, now, checkingSince = null) {
  const seen = Number(client?.lastSeenAt);
  const recent = Number.isFinite(seen) && seen > 0 && seen <= now && now - seen < RECENT_CONNECTION_MS;
  if (checkingSince !== null && (!recent || seen < checkingSince)) {
    return now - checkingSince < CHECK_WAIT_MS ? "checking" : "unconfirmed";
  }
  return recent ? "connected" : "unconfirmed";
}

// Keep each row/button alive across polling so focus and concurrent setup flows
// survive another browser connecting. This screen never navigates or starts translation.
export function createBrowserConnections({ root, invoke, translate = value => value, now = Date.now }) {
  const document = root.ownerDocument;
  const rows = new Map();
  let clients = [];
  let installations = [];
  let loading = true;
  let refreshing = null;
  let loadFailed = false;
  root.replaceChildren();

  function text(element, value) {
    const translated = translate(value);
    if (element.textContent !== translated) element.textContent = translated;
  }

  for (const [browser, name] of BROWSERS) {
    const row = document.createElement("div");
    row.className = "web-client-row";
    row.dataset.browser = browser;
    const identity = document.createElement("div");
    identity.className = "web-client-identity";
    const title = document.createElement("strong");
    title.textContent = name;
    const version = document.createElement("span");
    const status = document.createElement("span");
    status.className = "web-client-status";
    identity.append(title, version, status);
    const actions = document.createElement("div");
    actions.className = "web-client-actions";
    const connect = document.createElement("button");
    connect.type = "button";
    connect.className = "button secondary";
    connect.dataset.action = "connect";
    const check = document.createElement("button");
    check.type = "button";
    check.className = "button secondary";
    check.dataset.action = "check";
    actions.append(connect, check);
    const detail = document.createElement("p");
    detail.className = "web-client-detail";
    detail.id = `web-client-detail-${browser}`;
    detail.setAttribute("role", "status");
    connect.setAttribute("aria-describedby", detail.id);
    check.setAttribute("aria-describedby", detail.id);
    row.append(identity, actions, detail);
    root.append(row);
    const entry = { row, version, status, connect, check, detail, name, busy: false, checkingSince: null, error: null };
    rows.set(browser, entry);
    connect.addEventListener("click", () => { void act(browser, "connect"); });
    check.addEventListener("click", () => { void act(browser, "check"); });
  }

  function render() {
    for (const [browser, entry] of rows) {
      const installation = installations.find(value => value.browser === browser);
      const client = clients.find(value => value.browser === browser);
      const state = browserConnectionState(client, now(), entry.checkingSince);
      if (state === "connected") entry.checkingSince = null;
      entry.row.dataset.state = state;
      text(entry.status, loading ? "확인 중" : state === "connected" ? "연결됨" : state === "checking" ? "확인 중" : "연결 확인 대기");
      entry.version.textContent = client?.extensionVersion ? `v${client.extensionVersion}` : "";
      text(entry.connect, state === "connected" ? "스토어 열기" : "연결");
      text(entry.check, "연결 확인");
      entry.connect.setAttribute("aria-label", `${entry.name} · ${entry.connect.textContent}`);
      entry.check.setAttribute("aria-label", `${entry.name} · ${entry.check.textContent}`);
      entry.connect.disabled = loading || entry.busy || !installation?.installed || !installation?.storeAvailable;
      entry.check.disabled = loading || entry.busy;
      entry.row.setAttribute("aria-busy", String(entry.busy));
      const detail = entry.error || (loadFailed ? "브라우저 연결을 확인하지 못했습니다. 다시 시도하십시오."
        : state === "checking" ? "설치를 승인한 뒤 기다리거나, 브라우저에서 확장 프로그램을 열어 연결을 확인하십시오."
          : state === "connected" ? "번역할 사이트에서 NudeNyang 확장 프로그램을 눌러 번역을 시작하십시오."
            : entry.checkingSince !== null ? "브라우저에서 확장 프로그램을 열어 연결을 확인하십시오."
              : loading ? "확인 중"
                : !installation?.installed ? "브라우저 설치를 찾지 못했습니다."
                  : !installation.storeAvailable ? "스토어 심사 중"
                    : "설치를 승인한 뒤 기다리거나, 브라우저에서 확장 프로그램을 열어 연결을 확인하십시오.");
      text(entry.detail, detail);
    }
  }

  function refresh() {
    if (refreshing) return refreshing;
    refreshing = Promise.all([invoke("browser_clients_status"), invoke("browser_installations")])
      .then(([nextClients, nextInstallations]) => {
        clients = nextClients;
        installations = nextInstallations;
        loadFailed = false;
      })
      .catch(() => { loadFailed = true; })
      .finally(() => { loading = false; refreshing = null; render(); });
    return refreshing;
  }

  async function act(browser, action) {
    const entry = rows.get(browser);
    if (!entry || entry.busy || (action === "connect" ? entry.connect.disabled : entry.check.disabled)) return;
    entry.busy = true;
    entry.error = null;
    entry.checkingSince = now();
    render();
    try {
      if (action === "connect") await invoke("browser_open_extension_store", { browser });
      else await invoke("browser_repair_connection");
      await refresh();
    } catch (error) {
      entry.checkingSince = null;
      entry.error = String(error).includes("browser_not_found") ? "브라우저 설치를 찾지 못했습니다."
        : String(error).includes("store_unavailable") ? "스토어 심사 중"
          : "브라우저 연결을 확인하지 못했습니다. 다시 시도하십시오.";
    } finally {
      entry.busy = false;
      render();
    }
  }

  render();
  return { render, refresh };
}
