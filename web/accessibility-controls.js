import { COMPACT_LANGUAGE_LABELS, LANGUAGE_OPTIONS } from "./languages.mjs";

const invoke = window.__TAURI__.core.invoke;
const trigger = document.querySelector("#language-trigger");
const code = document.querySelector("#language-code");
const menu = document.querySelector("#language-menu");
const search = document.querySelector("#language-search");
const options = document.querySelector("#language-options");

let selectedLanguage = "ko";

function renderOptions(query = "") {
  const needle = query.trim().toLocaleLowerCase();
  const matches = LANGUAGE_OPTIONS.filter(([value, label, compact, english]) =>
    [value, label, compact, english].some((candidate) =>
      candidate.toLocaleLowerCase().includes(needle),
    ),
  );
  if (matches.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "검색 결과가 없습니다.";
    options.replaceChildren(empty);
    return;
  }
  options.replaceChildren(
    ...matches.map(([value, label, compact]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "language-option";
      button.role = "option";
      button.dataset.value = value;
      button.setAttribute("aria-selected", String(value === selectedLanguage));
      const name = document.createElement("span");
      name.textContent = label;
      const short = document.createElement("b");
      short.textContent = compact;
      button.append(name, short);
      button.addEventListener("click", async () => {
        if (value !== selectedLanguage) {
          const updated = await invoke("settings_update", {
            patch: { target_language: value },
          });
          selectedLanguage = updated.target_language;
          code.textContent = COMPACT_LANGUAGE_LABELS[selectedLanguage] || selectedLanguage.toUpperCase();
        }
        await closeMenu();
      });
      return button;
    }),
  );
}

async function openMenu() {
  menu.hidden = false;
  trigger.hidden = true;
  trigger.setAttribute("aria-expanded", "true");
  await invoke("accessibility_controls_resize", { expanded: true });
  renderOptions();
  search.focus();
}

async function closeMenu() {
  menu.hidden = true;
  trigger.hidden = false;
  trigger.setAttribute("aria-expanded", "false");
  search.value = "";
  await invoke("accessibility_controls_resize", { expanded: false });
}

trigger.addEventListener("click", () => {
  openMenu().catch(() => closeMenu());
});

search.addEventListener("input", () => renderOptions(search.value));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !menu.hidden) closeMenu();
});
window.addEventListener("blur", () => {
  if (!menu.hidden) closeMenu();
});

window.__TAURI__.event.listen("accessibility-controls-updated", ({ payload }) => {
  selectedLanguage = payload?.displayLanguage || "ko";
  code.textContent = COMPACT_LANGUAGE_LABELS[selectedLanguage] || selectedLanguage.toUpperCase();
  if (!menu.hidden) renderOptions(search.value);
});
