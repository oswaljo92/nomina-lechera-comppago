/**
 * Protege la base de datos de la app de escritorio durante `electron:build`.
 *
 * La app guarda sus datos en `datos/` JUNTO AL EJECUTABLE. Si se usa la app
 * directamente desde `release/win-unpacked`, esa carpeta vive ahí dentro, y
 * electron-builder BORRA `release/win-unpacked` completa en cada compilación
 * (así se perdió una base real el 03/10/2026). Por eso el build hace:
 *
 *   node scripts/datos-escritorio.mjs guardar    (antes de electron-builder)
 *   ...electron-builder + pack-desktop (el zip sale SIN datos)...
 *   node scripts/datos-escritorio.mjs restaurar  (al final)
 *
 * `guardar` deja además una copia permanente con fecha en
 * `release/respaldos-datos/`, que no se borra nunca sola. `restaurar` también
 * funciona si una compilación anterior falló a medias: vuelve a poner el
 * respaldo más reciente si `win-unpacked/datos` no existe.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const datos = path.join(raiz, 'release', 'win-unpacked', 'datos');
const respaldos = path.join(raiz, 'release', 'respaldos-datos');

const accion = process.argv[2];

function tieneArchivos(dir) {
  return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
}

if (accion === 'guardar') {
  if (!tieneArchivos(datos)) {
    console.log('· No hay datos en release/win-unpacked/datos: nada que respaldar.');
  } else {
    const sello = new Date().toISOString().replace(/[:.]/g, '-');
    const destino = path.join(respaldos, sello);
    fs.mkdirSync(destino, { recursive: true });
    fs.cpSync(datos, destino, { recursive: true });
    console.log(`✔ Datos de la app respaldados en ${path.relative(raiz, destino)}`);
  }
} else if (accion === 'restaurar') {
  if (tieneArchivos(datos)) {
    console.log('· release/win-unpacked/datos ya existe: no se toca.');
  } else if (!tieneArchivos(respaldos)) {
    console.log('· No hay respaldos de datos que restaurar.');
  } else {
    const ultimo = fs.readdirSync(respaldos).sort().at(-1);
    fs.mkdirSync(datos, { recursive: true });
    fs.cpSync(path.join(respaldos, ultimo), datos, { recursive: true });
    console.log(`✔ Datos de la app restaurados desde ${path.join('release', 'respaldos-datos', ultimo)}`);
  }
} else {
  console.error('Uso: node scripts/datos-escritorio.mjs guardar|restaurar');
  process.exit(1);
}
