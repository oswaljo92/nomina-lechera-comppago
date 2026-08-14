import * as ExcelJS from 'exceljs';
import { esFechaValida, fechaAMostrar } from '../parser/numeros.ts';

/** Una fila ya calculada, lista para mostrarse en pantalla o exportarse. */
export interface FilaTasaExcel {
  fecha: string; // ISO
  dia: string;
  semanaGanadera: string;
  tasa: number;
  difCambio: number | null;
  esJueves: boolean;
}

const ENCABEZADOS = ['FECHA', 'DIA', 'SEMANA GANADERA', 'TASA BCV', 'DIF. CAMBIO'];

export async function construirLibroTasas(filas: FilaTasaExcel[]): Promise<Uint8Array> {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Tasas');

  hoja.addRow(ENCABEZADOS).font = { bold: true };
  hoja.columns = [{ width: 12 }, { width: 14 }, { width: 18 }, { width: 14 }, { width: 14 }];

  for (const f of filas) {
    const fila = hoja.addRow([fechaAMostrar(f.fecha), f.dia, f.semanaGanadera, f.tasa, f.difCambio]);
    if (f.esJueves) fila.font = { bold: true };
  }

  const buffer = await libro.xlsx.writeBuffer();
  return new Uint8Array(buffer as unknown as ArrayBuffer);
}

export interface FilaTasaImportada {
  fecha: string; // ISO
  tasa: number;
}

export interface LecturaLibroTasas {
  filas: FilaTasaImportada[];
  errores: string[];
  /** true si hubo filas válidas y ninguna traía algo en la columna DIF. CAMBIO. */
  difCambioVacio: boolean;
}

/** "15/07/2026" o un objeto Date de Excel -> "2026-07-15". Null si no se reconoce. */
function celdaAFechaIso(valor: unknown): string | null {
  if (valor instanceof Date) {
    const anio = valor.getUTCFullYear();
    const mes = String(valor.getUTCMonth() + 1).padStart(2, '0');
    const dia = String(valor.getUTCDate()).padStart(2, '0');
    const iso = `${anio}-${mes}-${dia}`;
    return esFechaValida(iso) ? iso : null;
  }
  if (typeof valor === 'string') {
    const texto = valor.trim();
    if (esFechaValida(texto)) return texto;
    const m = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const [, d, mes, anio] = m;
      const iso = `${anio}-${mes!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
      return esFechaValida(iso) ? iso : null;
    }
  }
  return null;
}

function celdaATasa(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor) && valor > 0) return valor;
  if (typeof valor === 'string') {
    const n = Number(valor.trim().replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * Solo lee FECHA (columna 1) y TASA BCV (columna 4). DIA, SEMANA GANADERA y
 * DIF. CAMBIO son contexto para quien lee el archivo: no se guardan en
 * ningún lado, se recalculan siempre a partir de las nóminas y tasas ya
 * cargadas. La columna DIF. CAMBIO sí se inspecciona (columna 5), pero solo
 * para avisar si vino vacía — su valor nunca se usa.
 */
export async function leerLibroTasas(bytes: Uint8Array): Promise<LecturaLibroTasas> {
  const libro = new ExcelJS.Workbook();
  // La firma de tipos de exceljs pide un `Buffer` de Node; en el navegador
  // (web y Electron, que cargan el mismo build) el paquete acepta bytes
  // planos en tiempo de ejecución.
  await libro.xlsx.load(bytes as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  const hoja = libro.worksheets[0];

  const filas: FilaTasaImportada[] = [];
  const errores: string[] = [];
  if (!hoja) {
    errores.push('El archivo no tiene ninguna hoja.');
    return { filas, errores, difCambioVacio: false };
  }

  let huboDifCambio = false;

  hoja.eachRow((fila, numeroFila) => {
    if (numeroFila === 1) return; // encabezado
    const celdaFecha = fila.getCell(1).value;
    const celdaTasa = fila.getCell(4).value;
    const celdaDifCambio = fila.getCell(5).value;
    if (celdaFecha === null || celdaFecha === undefined) return; // fila vacía, se ignora

    const fecha = celdaAFechaIso(celdaFecha);
    const tasa = celdaATasa(celdaTasa);
    if (!fecha) {
      errores.push(`Fila ${numeroFila}: la fecha "${String(celdaFecha)}" no se reconoce.`);
      return;
    }
    if (tasa === null) {
      errores.push(`Fila ${numeroFila} (${fecha}): la tasa "${String(celdaTasa)}" no es un número válido.`);
      return;
    }
    filas.push({ fecha, tasa });
    if (celdaDifCambio !== null && celdaDifCambio !== undefined && String(celdaDifCambio).trim() !== '') {
      huboDifCambio = true;
    }
  });

  return { filas, errores, difCambioVacio: filas.length > 0 && !huboDifCambio };
}
