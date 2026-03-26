import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = (env.VITE_API_URL || "http://localhost:8000").trim();
  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "prompt",
        injectRegister: null,
        includeAssets: ["icons/icon.svg", "icons/maskable-icon.svg"],
        manifest: {
          id: "/",
          name: "Octodrop Platform",
          short_name: "Octodrop",
          description: "Octodrop workspace platform for mobile and desktop.",
          theme_color: "#111827",
          background_color: "#111827",
          display: "standalone",
          start_url: "/home",
          scope: "/",
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
  };
});
