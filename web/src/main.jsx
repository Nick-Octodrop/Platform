import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import "./styles.css";
import { applyBrandColors, applyTheme, getBrandColors, getInitialTheme } from "./theme/theme.js";

applyTheme(getInitialTheme());
applyBrandColors(getBrandColors());

if (typeof document !== "undefined" && typeof navigator !== "undefined") {
  const ua = navigator.userAgent || "";
  const isIosTouch = /iPad|iPhone|iPod/.test(ua);
  if (isIosTouch) {
    document.documentElement.classList.add("octo-ios-touch");
  }
}

function isStandaloneDisplay() {
  if (typeof window === "undefined") return false;
  const displayStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const navigatorStandalone = typeof window.navigator?.standalone === "boolean" && window.navigator.standalone;
  return Boolean(displayStandalone || navigatorStandalone);
}

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    window.__octoWebUpdateReady = true;
    window.__octoWebApplyUpdate = updateSW;
    window.dispatchEvent(new CustomEvent("octo:web-pwa-update-ready"));
  },
});
const root = createRoot(document.getElementById("root"));
root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
