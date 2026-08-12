import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // Rutas relativas: imprescindible para que el mismo dist/ funcione
  // servido por HTTPS (web) y cargado con file:// desde Electron.
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@core': r('./src/core'),
      '@ui': r('./src/ui'),
      '@platform': r('./src/platform'),
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          pdfjs: ['pdfjs-dist'],
          sqljs: ['sql.js'],
          salida: ['jspdf', 'jszip'],
        },
      },
      // jsPDF trae un import dinámico opcional a html2canvas para su método
      // .html(), que esta app no usa: el comprobante se dibuja con las
      // primitivas nativas de jsPDF (rect/line/text/addImage). Sin excluirlo,
      // Rollup igual empaqueta esos ~200 KB (48 KB gzip) de peso muerto.
      external: ['html2canvas'],
    },
  },
  // sql.js se publica como CommonJS. Debe pasar por el pre-empaquetado de Vite
  // para que su export por defecto exista también en desarrollo; el .wasm no se
  // ve afectado porque se importa aparte con «?url».
  server: { port: 5173 },
});
