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
 * `guardar` deja una copia permanente con fecha en `release/respaldos-datos/`
 * (nunca se borra sola) y anota cuál es en `.pendiente-restaurar`.
 * `restaurar` devuelve SOLO esa copia anotada: si `datos/` estaba vacía a
 * propósito (p. ej. el usuario pidió empezar sin base para restaurar otra),
 * no hay nada anotado y no se vuelve a poner ningún respaldo viejo. Si una
 * compilación falla a medias, la anotación queda y la siguiente `restaurar`
 * la completa.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const datos = path.join(raiz, 'release', 'win-unpacked', 'datos');
const respaldos = path.join(raiz, 'release', 'respaldos-datos');
const anotacion = path.join(respaldos, '.pendiente-restaurar');

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
    fs.writeFileSync(anotacion, sello);
    console.log(`✔ Datos de la app respaldados en ${path.relative(raiz, destino)}`);
  }
} else if (accion === 'restaurar') {
  if (!fs.existsSync(anotacion)) {
    console.log('· No se respaldaron datos en esta compilación: no hay nada que restaurar.');
  } else {
    const sello = fs.readFileSync(anotacion, 'utf8').trim();
    const origen = path.join(respaldos, sello);
    if (tieneArchivos(datos)) {
      console.log('· release/win-unpacked/datos ya tiene datos: no se toca.');
    } else if (!tieneArchivos(origen)) {
      console.error(`✘ No se encontró el respaldo ${sello} para restaurar.`);
      process.exit(1);
    } else {
      fs.mkdirSync(datos, { recursive: true });
      fs.cpSync(origen, datos, { recursive: true });
      console.log(`✔ Datos de la app restaurados desde ${path.join('release', 'respaldos-datos', sello)}`);
    }
    fs.rmSync(anotacion);
  }
} else {
  console.error('Uso: node scripts/datos-escritorio.mjs guardar|restaurar');
  process.exit(1);
}
