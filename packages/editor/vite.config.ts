import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3005,
    proxy: {
      "/api": "http://localhost:3011",
      "/preview": {
        target: "http://localhost:3011",
        ws: true,
      },
      "/ws": {
        target: "ws://localhost:3011",
        ws: true,
      },
    },
  },
});
