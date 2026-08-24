const api = globalThis.chrome ?? globalThis.whale;
const enabled = document.querySelector("#enabled");
const site = document.querySelector("#site");
const connection = document.querySelector("#connection");
const connectionText = document.querySelector("#connection-text");
const detail = document.querySelector("#detail");
const commandShortcut = document.querySelector("#command-shortcut");
const restore = document.querySelector("#restore");

function queryTabs(query) {
  return new Promise((resolve) => api.tabs.query(query, resolve));
}

async function activeTab() {
  const [lastFocused] = await queryTabs({ active: true, lastFocusedWindow: true });
  if (lastFocused) return lastFocused;
  const [current] = await queryTabs({ active: true, currentWindow: true });
  return current;
}

function tabMessage(tabId, message) {
  return new Promise((resolve) => api.tabs.sendMessage(tabId, message, (response) => {
    if (api.runtime.lastError) resolve(null);
    else resolve(response);
  }));
}

function nativeRequest(request) {
  return new Promise((resolve) => api.runtime.sendMessage({ type: "nudenyang-native-request", request }, resolve));
}

function extensionCommands() {
  return new Promise((resolve) => {
    if (!api.commands?.getAll) {
      resolve([]);
      return;
    }
    api.commands.getAll((commands) => {
      void api.runtime.lastError;
      resolve(commands ?? []);
    });
  });
}

function renderCommandShortcut(commands) {
  const shortcut = commands.find((command) => command.name === "toggle-page-translation")?.shortcut ?? "";
  commandShortcut.textContent = shortcut ? shortcut.replaceAll("+", " + ") : "미지정";
  commandShortcut.classList.toggle("unassigned", !shortcut);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function pageStatus(tabId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await tabMessage(tabId, { type: "nudenyang-status" });
    if (response) return response;
    await wait(120);
  }
  return null;
}

function renderPageStatus(status) {
  enabled.checked = status?.enabled ?? false;
  enabled.disabled = !status?.supported;
  restore.disabled = !status?.supported;
  if (!status) {
    site.textContent = "이 페이지와 연결할 수 없습니다. 페이지를 새로고침해 주십시오.";
  } else if (status.supported && status.manualOnly && !status.enabled) {
    site.textContent = "F4 또는 토글을 켜면 번역을 시작합니다.";
  } else if (status.supported) {
    site.textContent = `${status.site.toUpperCase()} · 번역된 텍스트 ${status.translatedNodes}개`;
  } else {
    site.textContent = "이 페이지는 아직 지원되지 않습니다.";
  }
  if (status?.lastError) detail.textContent = status.lastError;
}

function renderConnection(response) {
  connection.className = "connection";
  if (response?.type === "status") {
    connection.classList.add(response.ready ? "ready" : "waiting");
    connectionText.textContent = response.ready ? "Windows 앱 연결됨" : "번역 모델 준비 중";
    detail.textContent = `${response.translator} · ${response.targetLanguage.toUpperCase()} 번역`;
  } else {
    connection.classList.add("error");
    connectionText.textContent = "Windows 앱 연결 필요";
    detail.textContent = response?.message ?? "NudeNyang Windows 앱을 먼저 실행해 주십시오.";
  }
}

async function initialize() {
  const commandsPromise = extensionCommands();
  const tab = await activeTab();
  let status = tab?.id ? await pageStatus(tab.id) : null;
  renderPageStatus(status);
  renderConnection(await nativeRequest({ type: "status", requestId: `popup-${Date.now()}` }));
  renderCommandShortcut(await commandsPromise);

  enabled.addEventListener("change", async () => {
    if (!tab?.id) return;
    const previous = status?.enabled ?? false;
    const updated = await tabMessage(tab.id, { type: "nudenyang-set-enabled", enabled: enabled.checked });
    if (updated) {
      status = updated;
      renderPageStatus(status);
    } else {
      enabled.checked = previous;
      site.textContent = "이 페이지와 연결할 수 없습니다. 페이지를 새로고침해 주십시오.";
    }
  });
  restore.addEventListener("click", async () => {
    if (tab?.id) {
      const updated = await tabMessage(tab.id, { type: "nudenyang-restore" });
      if (updated) {
        status = updated;
        renderPageStatus(status);
        site.textContent = `${status.site.toUpperCase()} · 원문으로 복원되었습니다.`;
      } else {
        site.textContent = "이 페이지와 연결할 수 없습니다. 페이지를 새로고침해 주십시오.";
      }
    }
  });
}

void initialize();
