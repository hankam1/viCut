import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/outfit";
import "./styles/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { applyTheme, getTheme } from "./lib/theme.js";

applyTheme(getTheme());

// Промах drag&drop мимо зоны не должен уводить окно на file:// — гасим
// навигацию по умолчанию; обработчики зон срабатывают раньше (на всплытии).
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => event.preventDefault());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
