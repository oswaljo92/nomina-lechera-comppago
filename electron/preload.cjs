'use strict';

/**
 * Puente entre el proceso principal y la interfaz.
 *
 * Se expone una superficie mínima y concreta —leer y escribir la base, guardar
 * y abrir un archivo— en lugar de dar acceso a Node. El renderizador nunca
 * puede tocar el sistema de archivos por su cuenta.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lectorocr', {
  esEscritorio: true,
  version: process.versions.electron,

  leerDb: () => ipcRenderer.invoke('db:leer'),
  escribirDb: (bytes) => ipcRenderer.invoke('db:escribir', bytes),
  rutaDb: () => ipcRenderer.invoke('db:ruta'),

  guardarArchivo: (nombre, bytes) => ipcRenderer.invoke('archivo:guardar', nombre, bytes),
  abrirArchivo: (extensiones) => ipcRenderer.invoke('archivo:abrir', extensiones),

  copiarTexto: (texto) => ipcRenderer.invoke('portapapeles:texto', texto),
  copiarImagenPng: (bytes) => ipcRenderer.invoke('portapapeles:imagen', bytes),
});
