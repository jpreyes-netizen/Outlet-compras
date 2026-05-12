import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js'],
  },
})