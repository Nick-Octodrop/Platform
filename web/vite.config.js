import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = (env.VITE_API_URL || "http://localhost:8000").trim();
  return {
    plugins: [react()],
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
