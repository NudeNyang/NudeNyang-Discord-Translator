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

  function icon(paths) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "provider-action-icon");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    for (const data of paths) {
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("d", data);
      svg.append(path);
    }
    return svg;
  }

  function label(button, name, copy) {
    button.dataset.tooltip = translate(copy);
    button.setAttribute("aria-label", `${name} · ${translate(copy)}`);
  }

  for (const [browser, name] of BROWSERS) {
    const row = document.createElement("div");
    row.className = "provider-row web-client-row";
    row.dataset.browser = browser;
    const identity = document.createElement("div");
    identity.className = "provider-identity web-client-identity";
    const mark = document.createElement("span");
    mark.className = "provider-mark browser-mark";
    const image = document.createElement("img");
    image.src = `./assets/browser-${browser}.png`;
    image.alt = "";
    image.width = 28;
    image.height = 28;
    mark.append(image);
    const title = document.createElement("strong");
    title.textContent = name;
    const status = document.createElement("strong");
    status.className = "web-client-status";
    identity.append(mark, title);
    const connection = document.createElement("div");
    connection.className = "provider-connection";
    const statusBox = document.createElement("div");
    statusBox.className = "provider-status";
    const actions = document.createElement("div");
    actions.className = "web-client-actions";
    const action = document.createElement("button");
    action.type = "button";
    action.className = "button secondary provider-icon-button";
    actions.append(action);
    const detail = document.createElement("span");
    detail.className = "web-client-detail";
    detail.id = `web-client-detail-${browser}`;
    detail.setAttribute("role", "status");
    action.setAttribute("aria-describedby", detail.id);
    statusBox.append(status, detail);
    connection.append(statusBox, actions);
    row.append(identity, connection);
    root.append(row);
    const entry = { row, statusBox, status, action, detail, name, busy: false, checkingSince: null, error: null };
    rows.set(browser, entry);
    action.addEventListener("click", () => { void act(browser, action.dataset.action); });
  }

  function render() {
    for (const [browser, entry] of rows) {
      const installation = installations.find(value => value.browser === browser);
      const client = clients.find(value => value.browser === browser);
      const disabled = installation?.connectionEnabled === false;
      const state = disabled ? "disabled" : browserConnectionState(client, now(), entry.checkingSince);
      if (state === "connected") entry.checkingSince = null;
      entry.row.dataset.state = state;
      entry.statusBox.dataset.state = entry.error || loadFailed ? "error" : state;
      text(entry.status, loading ? "확인 중" : disabled ? "사용 중지됨" : state === "connected" ? "연결됨"
        : state === "checking" ? "확인 중" : installation && !installation.storeAvailable ? "스토어 심사 중" : "연결 필요");
      const disconnect = state === "connected";
      const action = disconnect ? "disconnect" : "connect";
      if (entry.action.dataset.action !== action) {
        entry.action.dataset.action = action;
        const paths = ["M9 15l6 -6", "M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464", "M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463"];
        if (disconnect) paths.push("M17 22v-2", "M20 17h2", "M2 7h2", "M7 2v2");
        entry.action.replaceChildren(icon(paths));
      }
      entry.action.classList.toggle("provider-action", !disconnect);
      entry.action.classList.toggle("provider-disconnect", disconnect);
      label(entry.action, entry.name, disconnect ? "연결 해제" : "연결");
      entry.action.disabled = loading || entry.busy || (!disconnect && !disabled && (!installation?.installed || !installation?.storeAvailable));
      entry.row.setAttribute("aria-busy", String(entry.busy));
      const detail = entry.error || (loadFailed ? "브라우저 연결을 확인하지 못했습니다. 다시 시도하십시오."
        : disabled || state === "checking" ? ""
          : state === "connected" ? (client?.extensionVersion ? `v${client.extensionVersion}` : "")
            : entry.checkingSince !== null ? "브라우저에서 확장 프로그램을 열어 연결을 확인하십시오."
              : loading ? ""
                : !installation?.installed ? "브라우저 설치를 찾지 못했습니다."
                  : "");
      text(entry.detail, detail);
      entry.detail.hidden = !detail;
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

  function needsSetup() {
    // Do not claim that installation is required while status is unknown.
    return !loading && !loadFailed && !BROWSERS.some(([browser]) => {
      const installation = installations.find(value => value.browser === browser);
      const client = clients.find(value => value.browser === browser);
      return installation?.connectionEnabled !== false
        && browserConnectionState(client, now()) === "connected";
    });
  }

  async function act(browser, action) {
    const entry = rows.get(browser);
    if (!entry || entry.busy || entry.action.disabled) return;
    entry.busy = true;
    entry.error = null;
    entry.checkingSince = action === "connect" ? now() : null;
    render();
    try {
      await invoke(action === "connect" ? "browser_connect" : "browser_disconnect", { browser });
      // A poll started before this save may contain the previous enabled flag.
      // Drain it, then fetch the confirmed choice before making the button usable.
      if (refreshing) await refreshing;
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
  return { render, refresh, needsSetup };
}
