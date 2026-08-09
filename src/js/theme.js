// theme.js — dark/light toggle, persisted on-device.
const THEME_KEY = "ui_theme";

export function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || "dark";
  document.documentElement.setAttribute("data-theme", saved);
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(THEME_KEY, next);
  return next;
}
