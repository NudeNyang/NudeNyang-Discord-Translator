// Panels stay mounted so switching services never discards a draft or secret.
export function createProviderAccordion(root, onToggle = () => {}) {
  const rows = [...root.querySelectorAll(".provider-row")]
    .filter(row => row.querySelector(".provider-summary"));
  function setOpen(provider, { focus = false } = {}) {
    for (const row of rows) {
      const button = row.querySelector(".provider-summary");
      const panel = row.querySelector(".provider-panel");
      const open = row.dataset.provider === provider;
      if (!open && panel.contains(root.ownerDocument.activeElement)) button.focus();
      button.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
      if (open && focus) button.focus();
    }
    onToggle();
  }
  for (const row of rows) {
    const button = row.querySelector(".provider-summary");
    button.addEventListener("click", () => {
      setOpen(button.getAttribute("aria-expanded") === "true" ? null : row.dataset.provider);
    });
  }
  return { open: setOpen };
}
