/* Apply before styles load to avoid a flash of the wrong theme. */
(() => {
  "use strict";
  const key = "rom-nostalg.theme.v1";
  const root = document.documentElement;
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const valid = (value) => value === "dark" || value === "light";
  let preference;
  try { preference = localStorage.getItem(key); } catch { /* Session-only fallback. */ }

  function apply(theme) {
    root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#16151b" : "#f5f3ee");
    const button = document.getElementById("theme-toggle");
    if (button) {
      button.setAttribute("aria-pressed", String(theme === "dark"));
      button.title = theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro";
      document.getElementById("theme-label").textContent = theme === "dark" ? "Escuro" : "Claro";
    }
  }

  function sync() { apply(valid(preference) ? preference : system.matches ? "dark" : "light"); }
  sync();
  system.addEventListener("change", () => { if (!valid(preference)) sync(); });
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) { preference = event.newValue; sync(); }
  });
  document.addEventListener("DOMContentLoaded", () => {
    sync();
    document.getElementById("theme-toggle").addEventListener("click", () => {
      preference = root.dataset.theme === "dark" ? "light" : "dark";
      apply(preference);
      try { localStorage.setItem(key, preference); } catch { /* Keep active in this tab. */ }
    });
  }, { once: true });
})();
