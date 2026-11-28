import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./index.css";
import "./i18n";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/** Fade out the boot splash from index.html. The first visit in a session lets the logo finish
 * drawing (about one second); later loads, and reduced motion, remove it as soon as React paints. */
function hideBootSplash() {
  const boot = document.getElementById("boot");
  if (!boot) return;
  let first = false;
  try {
    first = !sessionStorage.getItem("payani.boot");
    sessionStorage.setItem("payani.boot", "1");
  } catch { /* storage unavailable: treat as a repeat visit */ }
  const reduce = typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const elapsed = performance.now();
  const wait = first && !reduce ? Math.max(0, 1250 - elapsed) : 0;
  window.setTimeout(() => {
    boot.classList.add("done");
    window.setTimeout(() => boot.remove(), 400);
  }, wait);
}
requestAnimationFrame(hideBootSplash);
