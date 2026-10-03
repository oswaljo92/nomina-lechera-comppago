import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { ArchivoAbierto, Plataforma } from './tipos.ts';

/**
 * Adaptador para Electron.
 *
 * Habla con el proceso principal a través del puente `window.lectorocr` que
 * define electron/preload.cjs. La interfaz se sirve por el esquema app://, así
 * que la carga del WebAssembly funciona con la misma URL relativa que en la web.
 */

export interface PuenteEscritorio {
  esEscritorio: true;
  version: string;
  leerDb(): Promise<Uint8Array | null>;
  escribirDb(bytes: Uint8Array): Promise<void>;
  rutaDb(): Promise<string>;
  guardarArchivo(nombre: string, bytes: Uint8Array): Promise<string | null>;
  abrirArchivo(extensiones: string[]): Promise<ArchivoAbierto | null>;
  copiarTexto(texto: string): Promise<void>;
  copiarImagenPng(bytes: Uint8Array): Promise<void>;
  historialPortapapeles(): Promise<boolean | null>;
}

declare global {
  interface Window {
    lectorocr?: PuenteEscritorio;
  }
}

export function puenteEscritorio(): PuenteEscritorio | null {
  return window.lectorocr ?? null;
}

/** Convierte «.pdf,application/pdf» en ['pdf'] para el diálogo nativo. */
function extensionesDe(accept: string): string[] {
  const exts = accept
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.startsWith('.'))
    .map((t) => t.slice(1));
  return exts.length > 0 ? exts : ['*'];
}

export async function crearPlataformaEscritorio(puente: PuenteEscritorio): Promise<Plataforma> {
  let ruta = 'datos/lectorocr.db';
  try {
    ruta = await puente.rutaDb();
  } catch {
    /* si falla se muestra la ruta relativa, que igual orienta al usuario */
  }

  return {
    nombre: 'escritorio',
    etiqueta: `Escritorio · Electron ${puente.version}`,
    localizarWasm: () => wasmUrl,

    db: {
      cargar: () => puente.leerDb(),
      guardar: (bytes) => puente.escribirDb(bytes),
      ubicacion: () => ruta,
    },

    archivos: {
      async guardar(nombre, datos) {
        const bytes = new Uint8Array(await datos.arrayBuffer());
        return puente.guardarArchivo(nombre, bytes);
      },
      abrir: (accept) => puente.abrirArchivo(extensionesDe(accept)),
    },

    portapapeles: {
      copiarTexto: (texto) => puente.copiarTexto(texto),
      async copiarImagen(png) {
        await puente.copiarImagenPng(new Uint8Array(await png.arrayBuffer()));
      },
      historialActivo: () => puente.historialPortapapeles(),
    },
  };
}
