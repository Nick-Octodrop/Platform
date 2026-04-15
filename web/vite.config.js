import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = (env.VITE_API_URL || "http://localhost:8000").trim();
  const buildId = String(Date.now());
  const builtAt = new Date().toISOString();
  const enableDevPwa = env.VITE_ENABLE_DEV_PWA === "1";
  return {
    define: {
      __OCTO_BUILD_ID__: JSON.stringify(buildId),
    },
    plugins: [
      react(),
      {
        name: "octo-build-meta",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "build-meta.json",
            source: JSON.stringify({ buildId, builtAt }, null, 2),
          });
        },
      },
      VitePWA({
        registerType: "prompt",
        injectRegister: null,
        devOptions: {
          enabled: enableDevPwa,
          suppressWarnings: true,
        },
        includeAssets: ["icons/icon.svg", "icons/maskable-icon.svg"],
        manifest: {
          id: "/",
          name: "Octodrop Platform",
          short_name: "Octodrop",
          description: "Octodrop workspace platform for mobile and desktop.",
          categories: ["business", "productivity", "utilities"],
          theme_color: "#111827",
          background_color: "#111827",
          display: "standalone",
          display_override: ["window-controls-overlay", "standalone", "browser"],
          start_url: "/home",
          scope: "/",
          prefer_related_applications: false,
          launch_handler: {
            client_mode: ["focus-existing", "auto"],
          },
          shortcuts: [
            {
              name: "Home",
              short_name: "Home",
              description: "Open the Octodrop home dashboard.",
              url: "/home",
              icons: [{ src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" }],
            },
            {
              name: "Apps",
              short_name: "Apps",
              description: "Browse installed workspace apps.",
              url: "/apps",
              icons: [{ src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" }],
            },
            {
              name: "Settings",
              short_name: "Settings",
              description: "Open workspace and account settings.",
              url: "/settings",
              icons: [{ src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" }],
            },
            {
              name: "Notifications",
              short_name: "Alerts",
              description: "View notifications and activity.",
              url: "/notifications",
              icons: [{ src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" }],
            }
          ],
          icons: [
            {
              src: "/icons/icon.svg",
              sizes: "any",
              type: "image/svg+xml",
              purpose: "any"
            },
            {
              src: "/icons/maskable-icon.svg",
              sizes: "any",
              type: "image/svg+xml",
              purpose: "maskable"
            }
          ]
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: false,
        }
      }),
    ],
    server: {
      port: 5173,
      proxy: {
        "/__octo_api__": {
          target: proxyTarget,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/__octo_api__/, ""),
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("react-router-dom")) return "vendor-router";
            if (id.includes("@supabase/supabase-js")) return "vendor-supabase";
            if (id.includes("react-resizable-panels") || id.includes("react-window")) return "vendor-ui";
            return undefined;
          },
        },
      },
    },
  };
});
