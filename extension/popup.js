const api = globalThis.chrome ?? globalThis.whale;
const enabled = document.querySelector("#enabled");
const site = document.querySelector("#site");
const connection = document.querySelector("#connection");
const connectionText = document.querySelector("#connection-text");
const detail = document.querySelector("#detail");
const commandShortcut = document.querySelector("#command-shortcut");
const restore = document.querySelector("#restore");
const targetLanguage = document.querySelector("#target-language");
const alwaysTranslateSite = document.querySelector("#always-translate-site");
const usage = document.querySelector("#usage");
const openSettings = document.querySelector("#open-settings");
const LANGUAGE_OPTIONS = [
  ["ko", "한국어"], ["en", "English"], ["ja", "日本語"], ["zh", "简体中文"],
  ["zh-Hant", "繁體中文"], ["pt-BR", "Português (Brasil)"], ["hi", "हिन्दी"],
  ["es-419", "Español (Latinoamérica)"], ["de", "Deutsch"], ["ru", "Русский"],
  ["id", "Bahasa Indonesia"], ["fr", "Français"], ["tr", "Türkçe"], ["ar", "العربية"],
  ["vi", "Tiếng Việt"], ["it", "Italiano"], ["pl", "Polski"], ["uk", "Українська"],
  ["ms", "Bahasa Melayu"], ["nl", "Nederlands"], ["th", "ไทย"], ["fil", "Filipino"],
  ["bn", "বাংলা"], ["ur", "اردو"], ["ta", "தமிழ்"], ["fa", "فارسی"], ["he", "עברית"], ["cs", "Čeština"],
];
let appStatus = null;

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
  usage.textContent = `이 페이지 요청 ${status?.requestCount ?? 0}회 · 전송 ${(status?.sentChars ?? 0).toLocaleString()}자`;
  if (status?.usageLimit) usage.textContent += ` / 한도 ${Number(status.usageLimit).toLocaleString()}자`;
  usage.classList.toggle("warning", Boolean(status?.usageLimited));
  targetLanguage.value = status?.targetLanguage && status.targetLanguage !== "display"
    ? status.targetLanguage
    : "";
  alwaysTranslateSite.checked = status?.sitePolicy === "always";
  alwaysTranslateSite.disabled = !status?.supported;
  targetLanguage.disabled = !status?.supported;
}

function renderConnection(response) {
  connection.className = "connection";
  if (response?.type === "status") {
    appStatus = response;
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
  for (const [value, label] of LANGUAGE_OPTIONS) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    targetLanguage.append(option);
  }
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
  targetLanguage.addEventListener("change", async () => {
    if (!tab?.id) return;
    const updated = await tabMessage(tab.id, {
      type: "nudenyang-set-target-language",
      targetLanguage: targetLanguage.value,
    });
    if (updated) {
      status = updated;
      renderPageStatus(status);
    }
  });
  alwaysTranslateSite.addEventListener("change", async () => {
    if (!tab?.id || !tab.url || !appStatus?.webSettings) return;
    const hostname = new URL(tab.url).hostname.toLowerCase().replace(/^www\./, "");
    const sitePolicies = { ...(appStatus.webSettings.sitePolicies ?? {}) };
    if (alwaysTranslateSite.checked) sitePolicies[hostname] = "always";
    else delete sitePolicies[hostname];
    const response = await nativeRequest({
      type: "webSettingsUpdate",
      requestId: `site-${Date.now()}`,
      patch: { web_site_policies: sitePolicies },
    });
    if (response?.type !== "webSettings") {
      alwaysTranslateSite.checked = status?.sitePolicy === "always";
      detail.textContent = response?.message ?? "사이트 설정을 변경하지 못했습니다.";
      return;
    }
    appStatus.webSettings = response.webSettings;
    const updated = await tabMessage(tab.id, {
      type: "nudenyang-apply-web-settings",
      webSettings: response.webSettings,
    });
    if (updated) {
      status = updated;
      renderPageStatus(status);
    }
  });
  openSettings.addEventListener("click", async () => {
    const response = await nativeRequest({ type: "openWebSettings", requestId: `settings-${Date.now()}` });
    if (response?.type !== "opened") {
      detail.textContent = response?.message ?? "웹 번역 설정을 열지 못했습니다.";
    }
  });
}

void initialize();
