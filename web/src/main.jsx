import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import "./styles.css";
import { applyTheme, getInitialTheme } from "./theme/theme.js";

applyTheme(getInitialTheme());
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
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
