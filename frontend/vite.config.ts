import path from "node:path";
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@shared", replacement: path.resolve(__dirname, "../shared") },
      { find: /^viem$/, replacement: path.resolve(__dirname, "./node_modules/viem/_esm/index.js") },
    ],
  },
  server: {
    fs: {
      allow: [".."],
    },
  },
})
