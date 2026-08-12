import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { ArchivoAbierto, Plataforma } from './tipos.ts';

const NOMBRE_DB = 'lectorocr.db';
const IDB_BASE = 'lectorocr';
const IDB_ALMACEN = 'archivos';

/**
 * Adaptador para navegador.
 *
 * La base de datos se guarda en OPFS —el sistema de archivos privado del
 * origen—, que sobrevive al cierre del navegador y no pide permisos. Si el
 * navegador no lo soporta se cae a IndexedDB, que está en todas partes. La
 * diferencia es solo de rendimiento: en ambos casos se persisten los mismos
 * bytes de SQLite y el archivo exportado es idéntico.
 */

let modoAlmacen: 'opfs' | 'indexeddb' | 'memoria' = 'memoria';

async function opfsDisponible(): Promise<boolean> {
  try {
    if (!navigator.storage?.getDirectory) return false;
    const raiz = await navigator.storage.getDirectory();
    return typeof raiz.getFileHandle === 'function';
  } catch {
    return false;
  }
}

// ── OPFS ──────────────────────────────────────────────────────

async function opfsLeer(): Promise<Uint8Array | null> {
  const raiz = await navigator.storage.getDirectory();
  try {
    const handle = await raiz.getFileHandle(NOMBRE_DB, { create: false });
    const archivo = await handle.getFile();
    if (archivo.size === 0) return null;
    return new Uint8Array(await archivo.arrayBuffer());
  } catch {
    return null; // aún no existe
  }
}

async function opfsEscribir(bytes: Uint8Array): Promise<void> {
  const raiz = await navigator.storage.getDirectory();
  const handle = await raiz.getFileHandle(NOMBRE_DB, { create: true });
  // createWritable escribe en un archivo temporal y solo lo publica al
  // cerrarlo, así que un corte a mitad no deja la base a medio escribir.
  const flujo = await handle.createWritable();
  await flujo.write(
    new Blob([new Uint8Array(bytes) as unknown as ArrayBufferView<ArrayBuffer>]),
  );
  await flujo.close();
}

// ── IndexedDB (respaldo) ──────────────────────────────────────

function abrirIdb(): Promise<IDBDatabase> {
  return new Promise((resolver, rechazar) => {
    const peticion = indexedDB.open(IDB_BASE, 1);
    peticion.onupgradeneeded = () => {
      if (!peticion.result.objectStoreNames.contains(IDB_ALMACEN)) {
        peticion.result.createObjectStore(IDB_ALMACEN);
      }
    };
    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => rechazar(peticion.error ?? new Error('No se pudo abrir IndexedDB.'));
  });
}

async function idbLeer(): Promise<Uint8Array | null> {
  const db = await abrirIdb();
  try {
    return await new Promise<Uint8Array | null>((resolver, rechazar) => {
      const tx = db.transaction(IDB_ALMACEN, 'readonly');
      const peticion = tx.objectStore(IDB_ALMACEN).get(NOMBRE_DB);
      peticion.onsuccess = () => {
        const v = peticion.result;
        resolver(v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : null);
      };
      peticion.onerror = () => rechazar(peticion.error);
    });
  } finally {
    db.close();
  }
}

async function idbEscribir(bytes: Uint8Array): Promise<void> {
  const db = await abrirIdb();
  try {
    await new Promise<void>((resolver, rechazar) => {
      const tx = db.transaction(IDB_ALMACEN, 'readwrite');
      tx.objectStore(IDB_ALMACEN).put(new Uint8Array(bytes), NOMBRE_DB);
      tx.oncomplete = () => resolver();
      tx.onerror = () => rechazar(tx.error);
    });
  } finally {
    db.close();
  }
}

// ── Entrega y apertura de archivos ────────────────────────────

function descargar(nombre: string, datos: Blob): void {
  const url = URL.createObjectURL(datos);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Se libera con retraso: revocar de inmediato aborta la descarga en algunos
  // navegadores porque aún no han empezado a leer el blob.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function pedirArchivo(accept: string): Promise<ArchivoAbierto | null> {
  return new Promise((resolver) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    let resuelto = false;
    const terminar = (valor: ArchivoAbierto | null) => {
      if (resuelto) return;
      resuelto = true;
      input.remove();
      resolver(valor);
    };
    input.addEventListener('change', async () => {
      const archivo = input.files?.[0];
      if (!archivo) return terminar(null);
      terminar({ nombre: archivo.name, bytes: new Uint8Array(await archivo.arrayBuffer()) });
    });
    // Si el usuario cancela no se dispara ningún evento fiable en todos los
    // navegadores; `cancel` cubre los modernos y el foco cubre el resto.
    input.addEventListener('cancel', () => terminar(null));
    document.body.appendChild(input);
    input.click();
  });
}

export async function crearPlataformaWeb(): Promise<Plataforma> {
  modoAlmacen = (await opfsDisponible()) ? 'opfs' : 'indexeddb';

  // Pide al navegador que no descarte el almacenamiento por falta de espacio.
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* no es crítico: solo reduce el riesgo de que el navegador limpie datos */
  }

  return {
    nombre: 'web',
    etiqueta: modoAlmacen === 'opfs' ? 'Navegador · OPFS' : 'Navegador · IndexedDB',
    localizarWasm: () => wasmUrl,

    db: {
      cargar: () => (modoAlmacen === 'opfs' ? opfsLeer() : idbLeer()),
      guardar: (bytes) => (modoAlmacen === 'opfs' ? opfsEscribir(bytes) : idbEscribir(bytes)),
      ubicacion: () =>
        modoAlmacen === 'opfs'
          ? 'Almacenamiento privado del navegador (OPFS), en este equipo'
          : 'IndexedDB del navegador, en este equipo',
    },

    archivos: {
      async guardar(nombre, datos) {
        descargar(nombre, datos);
        return null; // el navegador no revela la carpeta de descargas
      },
      abrir: pedirArchivo,
    },
  };
}
