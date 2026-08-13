const root = document.querySelector("#translations");

function render(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  root.replaceChildren(
    ...items.map((item) => {
      const element = document.createElement("div");
      element.className = "translation";
      element.dataset.id = item.id;
      element.textContent = item.text;
      element.style.left = `${item.left}px`;
      element.style.top = `${item.top}px`;
      element.style.width = `${item.width}px`;
      element.style.minHeight = `${item.height}px`;
      return element;
    }),
  );
}

window.__TAURI__.event.listen("accessibility-overlay-updated", ({ payload }) => {
  render(payload);
});
