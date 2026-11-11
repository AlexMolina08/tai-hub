import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { labSandboxPlugin } from './scripts/lab-sandbox.mjs'
import { labOfflinePlugin } from './scripts/lab-offline.mjs'
import { labProgramPlugin } from './scripts/lab-program.mjs'
import { labHtmlPlugin } from './scripts/lab-html.mjs'

export default defineConfig({
  base: '/tai-hub/',
  plugins: [
    labSandboxPlugin(),
    labProgramPlugin(),
    labHtmlPlugin(),
    labOfflinePlugin(),
    {
      name: 'local-development-html',
      apply: 'serve',
      transformIndexHtml: {
        order: 'pre',
        handler: html => html.replace(/    <meta http-equiv="Content-Security-Policy"[^\n]+\n/, ''),
      },
    },
    react(),
    viteStaticCopy({
      targets: ['cmaps', 'standard_fonts', 'wasm', 'iccs'].map(dir => ({
        src: `node_modules/pdfjs-dist/${dir}`,
        dest: 'pdfjs',
      })),
    }),
  ],
  optimizeDeps: { include: ['minisearch', 'pdfjs-dist/legacy/build/pdf.mjs'] },
  server: { port: 5173, strictPort: true },
  build: { target: 'safari16.4', sourcemap: false },
})
