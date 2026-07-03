import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    // Движок бандлится в main — в пакете приложения нет node_modules.
    plugins: [externalizeDepsPlugin({ exclude: ["@vicut/core", "zod"] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@vicut/core", "zod"] })],
  },
  renderer: {
    plugins: [react(), tailwindcss()],
  },
});
