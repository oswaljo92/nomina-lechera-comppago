import * as ExcelJS from 'exceljs';
import { esFechaValida } from '../parser/numeros.ts';
import type { RegistroGuardado } from './repo.ts';
import type { TipoNomina } from '../types.ts';

/** Fila del Excel externo, ya parseada (sin normalizar todavía el código). */
export interface FilaNdExcel {
  fechaNota: string; // ISO
  codigoExcel: string;
  fabricaExcel: string | null;
  sapExcel: string | null;
  proveedorExcel: string;
  litrosEnviados: number | null;
  precioUsdLts: number | null;
  litrosTransportados: number | null;
  precioUsdFlete: number | null;
  bsXLtsInicio: number | null;
  bsXLtsAjustado: number | null;
  difXLts: number | null;
  /** "Bs. a Pagar x Dif." convertido a céntimos, redondeado hacia arriba
   * (misma convención que `calcularNotaDebito`, nunca al más cercano). */
  centimos: number;
  tipo: TipoNomina;
}

export type EmparejamientoNd = 'codigo' | 'nombre' | 'sin-emparejar';

export interface FilaNdResuelta {
  fila: FilaNdExcel;
  emparejamiento: EmparejamientoNd;
  /** Vacío si no hay candidatos; 1 elemento si el emparejamiento fue
   * automático; 2+ si quedó ambiguo y hace falta elegir a mano. */
  candidatos: RegistroGuardado[];
}

export interface LecturaLibroNd {
  filas: FilaNdResuelta[];
  errores: string[];
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

/** Acepta positivos, negativos y cero (a diferencia de una tasa BCV, estos
 * montos sí pueden ser negativos, p.ej. si la tasa bajó en la semana). */
function celdaANumero(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string') {
    const limpio = valor.trim();
    if (limpio === '') return null;
    const n = Number(limpio.replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function celdaATexto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const t = String(valor).trim();
  return t === '' ? null : t;
}

/** Quita todo lo que no sea dígito y los ceros a la izquierda, para que
 * "9119" (Excel) y "009119" (PDF/DB) se reconozcan como el mismo código. */
export function normalizarCodigo(codigo: string): string {
  const soloDigitos = codigo.replace(/\D/g, '');
  const sinCeros = soloDigitos.replace(/^0+/, '');
  return sinCeros || '0';
}

function normalizarNombre(nombre: string): string {
  return nombre.trim().toUpperCase().replace(/\s+/g, ' ');
}

/** Tolera el truncado a ~30 caracteres que el PDF le hace al nombre. */
function nombresCoinciden(a: string, b: string): boolean {
  const na = normalizarNombre(a);
  const nb = normalizarNombre(b);
  if (!na || !nb) return false;
  return na === nb || na.startsWith(nb) || nb.startsWith(na);
}

function emparejar(fila: FilaNdExcel, candidatosDelTipo: RegistroGuardado[]): FilaNdResuelta {
  const codigoExcel = normalizarCodigo(fila.codigoExcel);
  const porCodigo = candidatosDelTipo.filter((r) => normalizarCodigo(r.leido.codigo) === codigoExcel);
  if (porCodigo.length === 1) {
    return { fila, emparejamiento: 'codigo', candidatos: porCodigo };
  }

  const porNombre = candidatosDelTipo.filter((r) => nombresCoinciden(r.leido.nombre, fila.proveedorExcel));
  if (porNombre.length === 1) {
    return { fila, emparejamiento: 'nombre', candidatos: porNombre };
  }

  // Ambiguo (0 o 2+ candidatos): se deja para resolución manual, con lo que
  // se haya encontrado como sugerencia.
  return { fila, emparejamiento: 'sin-emparejar', candidatos: porCodigo.length > 0 ? porCodigo : porNombre };
}

/**
 * Lee el Excel externo con las notas de débito ya calculadas. Columnas (en
 * este orden): Fecha Nota Débito, Código de Proveedor, Fábrica, SAP,
 * Proveedor, Litros Enviados, $/Lts, Litros Transportados, $/Flete,
 * Bs x Lts Inicio, Bs x Lts Ajustado, Dif x Lts, Bs. a Pagar x Dif.
 *
 * El tipo de cada fila se infiere de cuál columna de litros trae dato
 * (Enviados -> leche, Transportados -> transporte); una fila con ambas o
 * ninguna se reporta como error y se omite. El emparejamiento contra los
 * registros ya cargados se intenta primero por código (normalizando ceros a
 * la izquierda) y, si no calza, por nombre — igual que pidió el usuario.
 */
export async function leerLibroNotasDebitoImportadas(
  bytes: Uint8Array,
  registrosPorTipo: Map<TipoNomina, RegistroGuardado[]>,
): Promise<LecturaLibroNd> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(bytes as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  const hoja = libro.worksheets[0];

  const errores: string[] = [];
  const parseadas: FilaNdExcel[] = [];
  if (!hoja) {
    errores.push('El archivo no tiene ninguna hoja.');
    return { filas: [], errores };
  }

  hoja.eachRow((fila, numeroFila) => {
    if (numeroFila === 1) return; // encabezado
    const celdaFecha = fila.getCell(1).value;
    if (celdaFecha === null || celdaFecha === undefined || celdaFecha === '') return; // fila vacía

    const fechaNota = celdaAFechaIso(celdaFecha);
    if (!fechaNota) {
      errores.push(`Fila ${numeroFila}: la fecha "${String(celdaFecha)}" no se reconoce.`);
      return;
    }

    const codigoExcel = celdaATexto(fila.getCell(2).value);
    const proveedorExcel = celdaATexto(fila.getCell(5).value);
    if (!codigoExcel || !proveedorExcel) {
      errores.push(`Fila ${numeroFila} (${fechaNota}): falta el código o el nombre del proveedor.`);
      return;
    }

    const litrosEnviados = celdaANumero(fila.getCell(6).value);
    const litrosTransportados = celdaANumero(fila.getCell(8).value);
    const tieneLeche = litrosEnviados !== null && litrosEnviados > 0;
    const tieneTransporte = litrosTransportados !== null && litrosTransportados > 0;
    if (tieneLeche === tieneTransporte) {
      errores.push(
        `Fila ${numeroFila} (${proveedorExcel}): debe traer litros enviados O litros transportados, no ambos ni ninguno.`,
      );
      return;
    }

    const bsAPagar = celdaANumero(fila.getCell(13).value);
    if (bsAPagar === null) {
      errores.push(`Fila ${numeroFila} (${proveedorExcel}): "Bs. a Pagar x Dif." no es un número válido.`);
      return;
    }

    parseadas.push({
      fechaNota,
      codigoExcel,
      fabricaExcel: celdaATexto(fila.getCell(3).value),
      sapExcel: celdaATexto(fila.getCell(4).value),
      proveedorExcel,
      litrosEnviados,
      precioUsdLts: celdaANumero(fila.getCell(7).value),
      litrosTransportados,
      precioUsdFlete: celdaANumero(fila.getCell(9).value),
      bsXLtsInicio: celdaANumero(fila.getCell(10).value),
      bsXLtsAjustado: celdaANumero(fila.getCell(11).value),
      difXLts: celdaANumero(fila.getCell(12).value),
      centimos: Math.ceil(bsAPagar * 100),
      tipo: tieneLeche ? 'leche' : 'transporte',
    });
  });

  const filas = parseadas.map((f) => emparejar(f, registrosPorTipo.get(f.tipo) ?? []));
  return { filas, errores };
}
