import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import {
  ANCHO_PT,
  dibujarComprobante,
  dibujarNotaDebito,
  type Hoja,
  type Medidor,
  type OpcionesDibujo,
  type Peso,
  type Primitiva,
} from '../../core/receipt/dibujo.ts';
import { nombreComprobante, nombreNotaDebito, nombreUnico } from '../../core/receipt/nombreArchivo.ts';
import type { DatosComprobante } from '../../core/receipt/comprobante.ts';

export type Formato = 'pdf' | 'png';

export interface ArchivoGenerado {
  nombre: string;
  blob: Blob;
  folio: string;
  /** Uno para un comprobante normal, dos cuando es un combinado leche+flete. */
  registroIds: string[];
}

export interface ItemAGenerar {
  registroIds: string[];
  datos: DatosComprobante;
  numeroNomina: number;
}

/** Píxeles por punto en el PNG. A 3× el texto queda nítido impreso y en móvil. */
const ESCALA_PNG = 3;

// ─────────────────────────────────────────────────────────────
// Medición
// ─────────────────────────────────────────────────────────────

let docMedidor: jsPDF | null = null;

/**
 * Mide con las métricas reales de la Helvetica del PDF.
 *
 * Se usa la misma medida para el PDF y para el PNG a propósito: así el reparto
 * de líneas y los recortes son idénticos en los dos formatos, y el proveedor
 * recibe exactamente el mismo documento pida el que pida.
 */
export function crearMedidor(): Medidor {
  if (!docMedidor) docMedidor = new jsPDF({ unit: 'pt', format: 'a4' });
  const doc = docMedidor;
  return (texto, tam, peso) => {
    doc.setFont('helvetica', peso === 'bold' ? 'bold' : 'normal');
    doc.setFontSize(tam);
    return doc.getTextWidth(texto);
  };
}

// ─────────────────────────────────────────────────────────────
// Renderizado a PNG
// ─────────────────────────────────────────────────────────────

function fuenteCanvas(tam: number, peso: Peso, escala: number): string {
  return `${peso === 'bold' ? '600 ' : ''}${tam * escala}px Helvetica, Arial, "Segoe UI", sans-serif`;
}

async function aCanvas(hoja: Hoja, escala: number): Promise<HTMLCanvasElement> {
  const { primitivas } = hoja;
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(ANCHO_PT * escala);
  lienzo.height = Math.round(hoja.alto * escala);
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new Error('El navegador no permitió crear el lienzo de dibujo.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  ctx.textBaseline = 'alphabetic';

  // Las imágenes se cargan antes de dibujar nada para no dejar huecos.
  const imagenes = new Map<string, HTMLImageElement>();
  await Promise.all(
    primitivas
      .filter((p): p is Extract<Primitiva, { tipo: 'imagen' }> => p.tipo === 'imagen')
      .map(
        (p) =>
          new Promise<void>((resolver) => {
            const img = new Image();
            img.onload = () => {
              imagenes.set(p.dataUrl, img);
              resolver();
            };
            // Un logo ilegible no debe impedir emitir el comprobante.
            img.onerror = () => resolver();
            img.src = p.dataUrl;
          }),
      ),
  );

  for (const p of primitivas) {
    switch (p.tipo) {
      case 'rect': {
        ctx.beginPath();
        const x = p.x * escala;
        const y = p.y * escala;
        const w = p.ancho * escala;
        const h = p.alto * escala;
        const r = (p.radio ?? 0) * escala;
        if (r > 0) ctx.roundRect(x, y, w, h, r);
        else ctx.rect(x, y, w, h);
        if (p.relleno) {
          ctx.fillStyle = p.relleno;
          ctx.fill();
        }
        if (p.borde) {
          ctx.strokeStyle = p.borde;
          ctx.lineWidth = (p.grosor ?? 1) * escala;
          ctx.stroke();
        }
        break;
      }
      case 'linea': {
        ctx.beginPath();
        ctx.moveTo(p.x1 * escala, p.y1 * escala);
        ctx.lineTo(p.x2 * escala, p.y2 * escala);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.grosor * escala;
        ctx.stroke();
        break;
      }
      case 'texto': {
        ctx.font = fuenteCanvas(p.tam, p.peso, escala);
        ctx.fillStyle = p.color;
        ctx.textAlign = p.alineacion === 'der' ? 'right' : p.alineacion === 'centro' ? 'center' : 'left';
        ctx.fillText(p.texto, p.x * escala, p.y * escala);
        break;
      }
      case 'imagen': {
        const img = imagenes.get(p.dataUrl);
        if (!img) break;
        // Se encaja dentro del recuadro sin deformar el logo.
        const razon = Math.min(p.ancho / img.width, p.alto / img.height);
        const w = img.width * razon;
        const h = img.height * razon;
        ctx.drawImage(
          img,
          (p.x + (p.ancho - w) / 2) * escala,
          (p.y + (p.alto - h) / 2) * escala,
          w * escala,
          h * escala,
        );
        break;
      }
    }
  }

  return lienzo;
}

async function aPng(hoja: Hoja, escala = ESCALA_PNG): Promise<Blob> {
  const lienzo = await aCanvas(hoja, escala);
  return new Promise<Blob>((resolver, rechazar) => {
    lienzo.toBlob((blob) => {
      if (blob) resolver(blob);
      else rechazar(new Error('El navegador no pudo generar la imagen del comprobante.'));
    }, 'image/png');
  });
}

// ─────────────────────────────────────────────────────────────
// Renderizado a PDF
// ─────────────────────────────────────────────────────────────

/**
 * Las fuentes estándar del PDF usan WinAnsi, que cubre el español completo pero
 * no los signos tipográficos «finos». Se sustituyen por su equivalente ASCII en
 * lugar de dejar que salgan como basura.
 */
const SUSTITUCIONES: Record<string, string> = {
  '−': '-',
  '–': '-',
  '—': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '…': '...',
  ' ': ' ',
};

function paraPdf(texto: string): string {
  let salida = '';
  for (const c of texto) {
    const reemplazo = SUSTITUCIONES[c];
    if (reemplazo !== undefined) salida += reemplazo;
    else if (c.codePointAt(0)! <= 0xff) salida += c;
    // Cualquier otro carácter fuera de Latin-1 se omite antes que corromper el texto.
  }
  return salida;
}

function aRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function aPdf(hoja: Hoja): Blob {
  // La página toma la altura del contenido: una hoja por proveedor, sin medio
  // folio en blanco al final.
  //
  // La orientación debe corresponderse con la proporción real. jsPDF NORMALIZA
  // el formato según ella: con 'portrait' fuerza que el lado menor sea el
  // ancho, de modo que una hoja más ancha que alta saldría con las dimensiones
  // intercambiadas y el contenido de la derecha recortado. En la imagen no se
  // notaría, porque el lienzo no pasa por esa normalización.
  const doc = new jsPDF({
    unit: 'pt',
    format: [ANCHO_PT, hoja.alto],
    orientation: hoja.alto >= ANCHO_PT ? 'portrait' : 'landscape',
    compress: true,
  });

  for (const p of hoja.primitivas) {
    switch (p.tipo) {
      case 'rect': {
        if (p.relleno) doc.setFillColor(...aRgb(p.relleno));
        if (p.borde) doc.setDrawColor(...aRgb(p.borde));
        doc.setLineWidth(p.grosor ?? 1);
        const estilo = p.relleno && p.borde ? 'FD' : p.relleno ? 'F' : 'S';
        const r = p.radio ?? 0;
        if (r > 0) doc.roundedRect(p.x, p.y, p.ancho, p.alto, r, r, estilo);
        else doc.rect(p.x, p.y, p.ancho, p.alto, estilo);
        break;
      }
      case 'linea': {
        doc.setDrawColor(...aRgb(p.color));
        doc.setLineWidth(p.grosor);
        doc.line(p.x1, p.y1, p.x2, p.y2);
        break;
      }
      case 'texto': {
        doc.setFont('helvetica', p.peso === 'bold' ? 'bold' : 'normal');
        doc.setFontSize(p.tam);
        doc.setTextColor(...aRgb(p.color));
        doc.text(paraPdf(p.texto), p.x, p.y, {
          align: p.alineacion === 'der' ? 'right' : p.alineacion === 'centro' ? 'center' : 'left',
        });
        break;
      }
      case 'imagen': {
        try {
          const props = doc.getImageProperties(p.dataUrl);
          const razon = Math.min(p.ancho / props.width, p.alto / props.height);
          const w = props.width * razon;
          const h = props.height * razon;
          doc.addImage(p.dataUrl, 'PNG', p.x + (p.ancho - w) / 2, p.y + (p.alto - h) / 2, w, h);
        } catch {
          // Un logo que el PDF no sepa leer no debe impedir emitir el comprobante.
        }
        break;
      }
    }
  }

  return doc.output('blob');
}

// ─────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────

export interface OpcionesGeneracion {
  formato: Formato;
  opciones: OpcionesDibujo;
  alAvanzar?: (hechos: number, total: number, nombre: string) => void;
}

type Dibujador = (datos: DatosComprobante, opciones: OpcionesDibujo, medir: Medidor) => Hoja;
type Nombrador = (
  nombreProveedor: string,
  numeroNomina: number,
  codigoProveedor: string,
  extension: Formato,
) => string;

async function generarDocumentos(
  items: ItemAGenerar[],
  { formato, opciones, alAvanzar }: OpcionesGeneracion,
  dibujar: Dibujador,
  nombrar: Nombrador,
): Promise<ArchivoGenerado[]> {
  const medir = crearMedidor();
  const usados = new Set<string>();
  const salida: ArchivoGenerado[] = [];

  for (const [i, item] of items.entries()) {
    const hoja = dibujar(item.datos, opciones, medir);
    const blob = formato === 'png' ? await aPng(hoja) : aPdf(hoja);

    const nombre = nombreUnico(
      nombrar(item.datos.proveedor.nombre, item.numeroNomina, item.datos.proveedor.codigo, formato),
      usados,
    );

    salida.push({ nombre, blob, folio: item.datos.folio, registroIds: item.registroIds });
    alAvanzar?.(i + 1, items.length, nombre);

    // Cede el hilo para que la barra de progreso avance de verdad durante un
    // lote largo, en lugar de congelar la interfaz hasta el final.
    if (i % 5 === 4) await new Promise((r) => setTimeout(r, 0));
  }

  return salida;
}

export async function generarComprobantes(
  items: ItemAGenerar[],
  opcionesGen: OpcionesGeneracion,
): Promise<ArchivoGenerado[]> {
  return generarDocumentos(items, opcionesGen, dibujarComprobante, nombreComprobante);
}

/** Nota de débito como documento independiente (ver `dibujarNotaDebito`). */
export async function generarNotasDebito(
  items: ItemAGenerar[],
  opcionesGen: OpcionesGeneracion,
): Promise<ArchivoGenerado[]> {
  return generarDocumentos(items, opcionesGen, dibujarNotaDebito, nombreNotaDebito);
}

export async function empaquetarZip(archivos: ArchivoGenerado[]): Promise<Blob> {
  const zip = new JSZip();
  for (const a of archivos) zip.file(a.nombre, a.blob);
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

/** Vista previa: se genera el PNG real, así que muestra el resultado exacto. */
export async function previsualizar(
  datos: DatosComprobante,
  opciones: OpcionesDibujo,
): Promise<string> {
  const hoja = dibujarComprobante(datos, opciones, crearMedidor());
  // Escala menor: en pantalla no hace falta calidad de impresión.
  return URL.createObjectURL(await aPng(hoja, 2));
}
