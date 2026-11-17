import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import vue from "@astrojs/vue";
import tailwindcss from "@tailwindcss/vite";

const apiTarget = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? "http://localhost:4321",
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [vue()],
  security: { checkOrigin: true },
  devToolbar: { enabled: false },
  server: { port: 4321, host: true },
  vite: {
    plugins: [tailwindcss()],
    // Pre-bundle island dependencies so the dev server does not re-optimise (and 504) on first use.
    optimizeDeps: { include: ["chart.js/auto", "chart.js", "jsqr"] },
    // In development the browser reaches the API through the same origin, as it does behind the load balancer in production.
    server: { proxy: { "/api": { target: apiTarget, changeOrigin: false } } },
  },
});
