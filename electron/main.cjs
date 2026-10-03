'use strict';

/**
 * Proceso principal de la versión de escritorio.
 *
 * Dos decisiones importantes:
 *
 * 1. La interfaz NO se carga con file://. Se sirve por un esquema propio
 *    (app://) registrado como estándar y seguro. Con file:// el navegador
 *    interno bloquea fetch() —y sin fetch no se puede cargar el WebAssembly de
 *    SQLite— y además el origen queda opaco, que inhabilita el almacenamiento
 *    persistente. Con app:// el código del renderizador es idéntico al de la
 *    versión web.
 *
 * 2. La base de datos vive en una carpeta «datos» JUNTO AL EJECUTABLE, no en
 *    AppData. Es lo que hace la aplicación realmente portable: se copia la
 *    carpeta a un pendrive y se lleva con todo su histórico.
 */

const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, clipboard, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { pathToFileURL } = require('node:url');

const DEV = !app.isPackaged;
const RAIZ_DIST = path.join(__dirname, '..', 'dist');

// La carpeta de datos acompaña al ejecutable para que la app sea portable.
const DIR_BASE = app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..');
const DIR_DATOS = path.join(DIR_BASE, 'datos');
const RUTA_DB = path.join(DIR_DATOS, 'lectorocr.db');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const RUTA_VENTANA = path.join(DIR_DATOS, 'ventana.json');

function asegurarDirDatos() {
  if (!fsSync.existsSync(DIR_DATOS)) fsSync.mkdirSync(DIR_DATOS, { recursive: true });
}

/** Tamaño y posición de la última sesión, si siguen siendo válidos. */
function leerEstadoVentana() {
  try {
    // Se quita la marca de orden de bytes antes de interpretar el JSON: basta
    // con que alguien abra y guarde este archivo con el Bloc de notas para que
    // aparezca, y JSON.parse falla con ella.
    const texto = fsSync.readFileSync(RUTA_VENTANA, 'utf8').replace(/^﻿/, '');
    const guardado = JSON.parse(texto);
    if (typeof guardado?.width !== 'number' || typeof guardado?.height !== 'number') return null;
    if (guardado.width < 380 || guardado.height < 600) return null;
    return guardado;
  } catch {
    return null;
  }
}

function guardarEstadoVentana(ventana) {
  try {
    if (ventana.isDestroyed()) return;
    const { x, y, width, height } = ventana.getNormalBounds();
    asegurarDirDatos();
    fsSync.writeFileSync(
      RUTA_VENTANA,
      JSON.stringify({ x, y, width, height, maximizada: ventana.isMaximized() }),
    );
  } catch {
    // Recordar la geometría es una comodidad: si falla, no debe estorbar.
  }
}

function crearVentana() {
  const previo = leerEstadoVentana();

  const ventana = new BrowserWindow({
    width: previo?.width ?? 1440,
    height: previo?.height ?? 900,
    ...(previo && typeof previo.x === 'number' ? { x: previo.x, y: previo.y } : {}),
    // Mínimo deliberadamente bajo: así se puede estrechar la ventana hasta el
    // tramo de teléfono y comprobar el diseño adaptable sin salir de la app.
    minWidth: 380,
    minHeight: 600,
    backgroundColor: '#0f1512',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (previo?.maximizada) ventana.maximize();

  ventana.once('ready-to-show', () => ventana.show());

  let pendiente = null;
  const recordar = () => {
    clearTimeout(pendiente);
    pendiente = setTimeout(() => guardarEstadoVentana(ventana), 400);
  };
  ventana.on('resize', recordar);
  ventana.on('move', recordar);
  ventana.on('close', () => {
    clearTimeout(pendiente);
    guardarEstadoVentana(ventana);
  });

  // Nada de navegar fuera de la aplicación ni de abrir ventanas nuevas: los
  // enlaces externos se delegan al navegador del sistema.
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  ventana.webContents.on('will-navigate', (evento, url) => {
    const permitido = DEV ? url.startsWith('http://localhost:5173') : url.startsWith('app://');
    if (!permitido) evento.preventDefault();
  });

  if (DEV) {
    ventana.loadURL('http://localhost:5173');
  } else {
    ventana.loadURL('app://lectorocr/index.html');
  }
}

app.whenReady().then(() => {
  asegurarDirDatos();

  protocol.handle('app', (peticion) => {
    const { pathname } = new URL(peticion.url);
    const relativo = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    const destino = path.join(RAIZ_DIST, relativo);
    // Cortafuegos contra salirse de dist/ con «..» en la ruta.
    if (!destino.startsWith(RAIZ_DIST)) {
      return new Response('No encontrado', { status: 404 });
    }
    return net.fetch(pathToFileURL(destino).toString());
  });

  crearVentana();
});

// Esta versión es solo para Windows: al cerrar la ventana se cierra la
// aplicación, sin la excepción que macOS necesitaría.
app.on('window-all-closed', () => {
  app.quit();
});

// ── Puente con el renderizador ────────────────────────────────

ipcMain.handle('db:leer', async () => {
  try {
    const bytes = await fs.readFile(RUTA_DB);
    return bytes.length > 0 ? new Uint8Array(bytes) : null;
  } catch {
    return null; // aún no existe
  }
});

ipcMain.handle('db:escribir', async (_evento, bytes) => {
  asegurarDirDatos();
  // Escritura atómica: primero a un temporal y luego se renombra, para que un
  // corte de luz a mitad no deje la base corrupta.
  const temporal = `${RUTA_DB}.tmp`;
  await fs.writeFile(temporal, Buffer.from(bytes));
  await fs.rename(temporal, RUTA_DB);
});

ipcMain.handle('db:ruta', () => RUTA_DB);

ipcMain.handle('archivo:guardar', async (evento, nombre, bytes) => {
  const ventana = BrowserWindow.fromWebContents(evento.sender);
  const extension = path.extname(nombre).replace('.', '') || '*';
  const opciones = {
    defaultPath: path.join(DIR_BASE, nombre),
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  };
  const resultado = ventana
    ? await dialog.showSaveDialog(ventana, opciones)
    : await dialog.showSaveDialog(opciones);
  if (resultado.canceled || !resultado.filePath) return null;
  await fs.writeFile(resultado.filePath, Buffer.from(bytes));
  return resultado.filePath;
});

ipcMain.handle('portapapeles:texto', (_evento, texto) => {
  clipboard.writeText(String(texto));
});

ipcMain.handle('portapapeles:imagen', (_evento, bytesPng) => {
  const imagen = nativeImage.createFromBuffer(Buffer.from(bytesPng));
  if (imagen.isEmpty()) throw new Error('No se pudo leer la imagen para copiarla.');
  clipboard.writeImage(imagen);
});

ipcMain.handle('archivo:abrir', async (evento, extensiones) => {
  const ventana = BrowserWindow.fromWebContents(evento.sender);
  const opciones = {
    properties: ['openFile'],
    filters: [{ name: 'Archivos admitidos', extensions: extensiones }],
  };
  const resultado = ventana
    ? await dialog.showOpenDialog(ventana, opciones)
    : await dialog.showOpenDialog(opciones);
  const ruta = resultado.filePaths?.[0];
  if (resultado.canceled || !ruta) return null;
  const bytes = await fs.readFile(ruta);
  return { nombre: path.basename(ruta), bytes: new Uint8Array(bytes) };
});
