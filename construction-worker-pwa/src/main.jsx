import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import "./styles.css";

const trackedSwRegistrations = new WeakSet();

function dispatchPwaUpdateReady() {
  window.__octoPwaUpdateReady = true;
  window.dispatchEvent(new CustomEvent("octo:pwa-update-ready"));
}

function wireServiceWorkerRegistration(registration) {
  if (!registration) return;
  window.__octoPwaSwRegistration = registration;
  if (registration.waiting) {
    dispatchPwaUpdateReady();
  }
  if (trackedSwRegistrations.has(registration)) return;
  trackedSwRegistrations.add(registration);

  const watchInstallingWorker = (worker) => {
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        dispatchPwaUpdateReady();
      }
    });
  };

  if (registration.installing) {
    watchInstallingWorker(registration.installing);
  }
  registration.addEventListener("updatefound", () => {
    watchInstallingWorker(registration.installing);
  });
}

const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    window.__octoPwaApplyUpdate = updateSW;
    wireServiceWorkerRegistration(registration);
  },
  onNeedRefresh() {
    window.__octoPwaApplyUpdate = updateSW;
    dispatchPwaUpdateReady();
  },
  onOfflineReady() {
    window.dispatchEvent(new CustomEvent("octo:pwa-offline-ready"));
  },
});

if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => wireServiceWorkerRegistration(registration));
  }).catch(() => {
    // ignore registration lookup failures
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
