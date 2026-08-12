/**
 * Empaqueta la versión de escritorio y prepara la documentación para el
 * departamento de sistemas.
 *
 * Se genera una CARPETA comprimida, no un ejecutable auto-extraíble. El
 * empaquetado «portable» de Electron se descomprime solo en %TEMP% y arranca
 * desde ahí, que es un patrón que muchas políticas corporativas bloquean por
 * ser el que usa el malware. Descomprimir a mano y ejecutar desde una carpeta
 * normal evita ese motivo de bloqueo concreto.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origen = path.join(raiz, 'release', 'win-unpacked');
const salida = path.join(raiz, 'release');

if (!fs.existsSync(origen)) {
  console.error(`No existe ${origen}. Ejecuta antes: npm run electron:build`);
  process.exit(1);
}

const paquete = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
const version = paquete.version;
const nombreProducto = paquete.build.productName; // "Nómina Lechera CompPago"
const nombreExe = paquete.build.win.executableName; // "CompPago" — sin espacios ni tildes
const nombreZip = `${nombreExe}-${version}-windows.zip`;
const rutaZip = path.join(salida, nombreZip);

// ── ZIP mínimo (almacenado + deflate), sin dependencias externas ──

function crc32(buf) {
  let tabla = crc32.tabla;
  if (!tabla) {
    tabla = crc32.tabla = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabla[n] = c;
    }
  }
  let crc = -1;
  for (const b of buf) crc = tabla[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function listar(dir, base = '') {
  const salida = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    const relativo = base ? `${base}/${entrada.name}` : entrada.name;
    if (entrada.isDirectory()) salida.push(...listar(completo, relativo));
    else salida.push({ ruta: completo, nombre: `${nombreExe}/${relativo}` });
  }
  return salida;
}

function fechaDos(d) {
  const hora = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xffff;
  const fecha = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  return { hora, fecha };
}

function escribirZip(archivos, destino) {
  const locales = [];
  const centrales = [];
  let desplazamiento = 0;

  for (const a of archivos) {
    const datos = fs.readFileSync(a.ruta);
    const comprimido = zlib.deflateRawSync(datos, { level: 6 });
    const usarDeflate = comprimido.length < datos.length;
    const cuerpo = usarDeflate ? comprimido : datos;
    const nombre = Buffer.from(a.nombre, 'utf8');
    const { hora, fecha } = fechaDos(fs.statSync(a.ruta).mtime);
    const crc = crc32(datos);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(usarDeflate ? 8 : 0, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(fecha, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(cuerpo.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    locales.push(local, nombre, cuerpo);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(usarDeflate ? 8 : 0, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(fecha, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(cuerpo.length, 20);
    central.writeUInt32LE(datos.length, 24);
    central.writeUInt16LE(nombre.length, 28);
    central.writeUInt32LE(desplazamiento, 42);
    centrales.push(central, nombre);

    desplazamiento += local.length + nombre.length + cuerpo.length;
  }

  const cuerpoCentral = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(cuerpoCentral.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);

  fs.writeFileSync(destino, Buffer.concat([...locales, cuerpoCentral, fin]));
}

const archivos = listar(origen);
escribirZip(archivos, rutaZip);

const bytesZip = fs.readFileSync(rutaZip);
const shaZip = crypto.createHash('sha256').update(bytesZip).digest('hex');
const rutaExe = path.join(origen, `${nombreExe}.exe`);
const shaExe = fs.existsSync(rutaExe)
  ? crypto.createHash('sha256').update(fs.readFileSync(rutaExe)).digest('hex')
  : `(no se encontró ${nombreExe}.exe)`;

const hoja = `HOJA INFORMATIVA PARA EL DEPARTAMENTO DE SISTEMAS
=================================================

Aplicación:  ${nombreProducto} ${version}
Propósito:   Leer los reportes de nómina ganadera en PDF (Gan0584 y Gan0594) y
             generar los comprobantes de pago de cada proveedor.
Fabricante:  Aplicación interna. NO está firmada digitalmente.

ARCHIVOS Y HUELLAS
------------------
${nombreZip}
  SHA-256: ${shaZip}
  Tamaño:  ${(bytesZip.length / 1024 / 1024).toFixed(2)} MB

${nombreExe}.exe (dentro del ZIP, en ${nombreExe}/)
  SHA-256: ${shaExe}

QUÉ HACE Y QUÉ NO HACE
----------------------
- NO requiere privilegios de administrador. El manifiesto declara «asInvoker»
  y la aplicación nunca solicita elevación.
- NO se instala. Se descomprime en una carpeta y se ejecuta desde ahí.
- NO escribe en %TEMP%, ni en el registro, ni en Archivos de programa.
- NO establece conexiones de red. No tiene actualizador automático, ni
  telemetría, ni ninguna llamada saliente. Funciona con el equipo desconectado.
- Guarda sus datos en un único archivo SQLite, en la subcarpeta «datos» que
  crea junto al ejecutable.
- Los PDF que procesa nunca salen del equipo.

PERMISOS NECESARIOS
-------------------
- Lectura y ejecución sobre la carpeta donde se descomprima.
- Escritura sobre la subcarpeta «datos» dentro de esa misma carpeta.
No hace falta ningún otro permiso.

TECNOLOGÍA
----------
Electron ${paquete.devDependencies?.electron ?? ''} (el mismo motor de navegador que usan
Visual Studio Code, Teams y Slack). La interfaz se sirve por un protocolo
interno de la propia aplicación, sin servidor local ni puertos abiertos.

SI LA POLÍTICA IMPIDE EJECUTARLO
--------------------------------
Si AppLocker, WDAC o una regla ASR bloquean los ejecutables no firmados, esta
versión no podrá correr y no hay forma de sortearlo desde la aplicación. Para
ese caso existe una versión web equivalente que funciona dentro del navegador
corporativo, sin instalar nada y sin ser un ejecutable.

Generado el ${new Date().toISOString().slice(0, 10)}.
`;

fs.writeFileSync(path.join(salida, 'HOJA-PARA-SISTEMAS.txt'), hoja, 'utf8');

console.log(`✔ ${path.relative(raiz, rutaZip)}  (${(bytesZip.length / 1024 / 1024).toFixed(2)} MB, ${archivos.length} archivos)`);
console.log(`  SHA-256 ${shaZip}`);
console.log(`✔ ${path.relative(raiz, path.join(salida, 'HOJA-PARA-SISTEMAS.txt'))}`);
