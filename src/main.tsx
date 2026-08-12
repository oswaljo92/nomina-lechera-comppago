import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/estilos.css';
import { ProveedorApp } from './ui/estado.tsx';
import { App } from './ui/App.tsx';

const raiz = document.getElementById('root');
if (!raiz) throw new Error('No se encontró el contenedor #root.');

createRoot(raiz).render(
  <StrictMode>
    <ProveedorApp>
      <App />
    </ProveedorApp>
  </StrictMode>,
);

// El service worker deja la aplicación funcionando sin conexión una vez
// cargada. Solo aplica a la versión web: en Electron los archivos ya son
// locales y registrarlo no aportaría nada.
if ('serviceWorker' in navigator && !window.lectorocr && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    // Ruta relativa a la página: así funciona igual servido en la raíz del
    // dominio que en un subdirectorio.
    void navigator.serviceWorker.register('./sw.js').catch((error: unknown) => {
      console.warn('No se pudo registrar el service worker:', error);
    });
  });
}
