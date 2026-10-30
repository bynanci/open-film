import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { buildContributionPlugin } from "../../scripts/build-attribution.mjs";

export default defineConfig({
  plugins: [
    vue(),
    buildContributionPlugin(fileURLToPath(new URL("../..", import.meta.url))),
  ],
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4310" },
  },
  clearScreen: false,
});
