import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Relative base so the built site works at https://<user>.github.io/midi-average/
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
});
