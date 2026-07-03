import type { VicutApi } from "./index.js";

declare global {
  interface Window {
    vicut: VicutApi;
  }
}

export {};
