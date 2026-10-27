import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url))

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
    // the 404 world, and the plain page an arrow sends you to (/home)
    rollupOptions: { input: { main: page('index.html'), home: page('home.html') } },
  },
})
