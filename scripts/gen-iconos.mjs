/**
 * Genera los iconos PNG de la PWA sin depender de ninguna librería gráfica.
 *
 * Chrome no considera instalable una aplicación cuyo manifiesto solo trae
 * iconos SVG, y arrastrar una dependencia de rasterizado para dibujar un
 * rectángulo verde con una hoja blanca sería desproporcionado. Se escribe el
 * PNG a mano: cabecera, píxeles y CRC.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destino = path.join(raiz, 'public');

const VERDE = [22, 84, 63];
const VERDE_OSCURO = [15, 46, 36];
const BLANCO = [255, 255, 255];
const GRIS = [200, 210, 203];

function dibujar(lado) {
  const px = Buffer.alloc(lado * lado * 4);
  const radio = Math.round(lado * 0.22);

  // Las coordenadas se redondean sin excepción: un índice fraccionario no
  // apunta a ningún píxel del búfer y el trazo se pierde en silencio.
  const poner = (xf, yf, [r, g, b], a = 255) => {
    const x = Math.round(xf);
    const y = Math.round(yf);
    if (x < 0 || y < 0 || x >= lado || y >= lado) return;
    const i = (y * lado + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };

  // Fondo: cuadrado de esquinas redondeadas.
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const dx = Math.max(radio - x, x - (lado - 1 - radio), 0);
      const dy = Math.max(radio - y, y - (lado - 1 - radio), 0);
      if (dx * dx + dy * dy <= radio * radio) {
        // Degradado suave de arriba abajo.
        const t = y / lado;
        const c = VERDE.map((v, i) => Math.round(v + (VERDE_OSCURO[i] - v) * t));
        poner(x, y, c);
      }
    }
  }

  // Hoja de papel centrada.
  const hojaAncho = Math.round(lado * 0.44);
  const hojaAlto = Math.round(lado * 0.56);
  const hx = Math.round((lado - hojaAncho) / 2);
  const hy = Math.round((lado - hojaAlto) / 2);
  const esquina = Math.round(hojaAncho * 0.3);

  for (let y = hy; y < hy + hojaAlto; y++) {
    for (let x = hx; x < hx + hojaAncho; x++) {
      // Esquina superior derecha doblada.
      const desdeDerecha = hx + hojaAncho - x;
      const desdeArriba = y - hy;
      if (desdeArriba < esquina && desdeDerecha < esquina - desdeArriba) continue;
      poner(x, y, BLANCO);
    }
  }
  // Triángulo del doblez.
  for (let d = 0; d < esquina; d++) {
    for (let k = 0; k < esquina - d; k++) {
      poner(hx + hojaAncho - 1 - k, hy + d, GRIS);
    }
  }

  // Renglones de texto.
  const margen = Math.round(hojaAncho * 0.16);
  const grosor = Math.max(2, Math.round(lado * 0.022));
  let yy = hy + Math.round(hojaAlto * 0.42);
  for (let linea = 0; linea < 4; linea++) {
    const largo = linea === 3 ? Math.round((hojaAncho - margen * 2) * 0.55) : hojaAncho - margen * 2;
    for (let y = yy; y < yy + grosor; y++) {
      for (let x = hx + margen; x < hx + margen + largo; x++) {
        poner(x, y, linea === 3 ? VERDE : GRIS);
      }
    }
    yy += Math.round(grosor * 2.6);
  }

  return px;
}

function crc32(buf) {
  let c;
  const tabla = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = tabla[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

function png(lado, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Cada línea va precedida por su byte de filtro (0 = sin filtro).
  const bruto = Buffer.alloc(lado * (lado * 4 + 1));
  for (let y = 0; y < lado; y++) {
    bruto[y * (lado * 4 + 1)] = 0;
    px.copy(bruto, y * (lado * 4 + 1) + 1, y * lado * 4, (y + 1) * lado * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(bruto, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(destino, { recursive: true });
for (const lado of [192, 512]) {
  const archivo = path.join(destino, `icono-${lado}.png`);
  fs.writeFileSync(archivo, png(lado, dibujar(lado)));
  console.log(`Generado ${path.relative(raiz, archivo)}`);
}
