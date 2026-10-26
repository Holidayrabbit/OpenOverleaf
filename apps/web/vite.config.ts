import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 43123,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:43124",
        changeOrigin: true,
        timeout: 300_000,
        proxyTimeout: 300_000,
      },
      "/ws": {
        target: "ws://127.0.0.1:43124",
        ws: true,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 43123,
    strictPort: true,
  },
  optimizeDeps: {
    include: ["pdfjs-dist"],
  },
});
