export type Theme = "dark" | "light" | "system";

const STORAGE_KEY = "vicut-theme";

export function getTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "system" ? stored : "dark";
}

export function applyTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  document.documentElement.dataset["theme"] = theme;
}
