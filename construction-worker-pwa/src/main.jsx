import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import "./styles.css";

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    window.__octoPwaApplyUpdate = updateSW;
    window.dispatchEvent(new CustomEvent("octo:pwa-update-ready"));
  },
  onOfflineReady() {
    window.dispatchEvent(new CustomEvent("octo:pwa-offline-ready"));
  },
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
