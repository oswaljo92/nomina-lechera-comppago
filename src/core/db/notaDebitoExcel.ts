import * as ExcelJS from 'exceljs';
import { esFechaValida } from '../parser/numeros.ts';
import type { RegistroGuardado } from './repo.ts';
import type { TipoNomina } from '../types.ts';

/** Fila del Excel externo, ya parseada (sin normalizar todavía el código). */
export interface FilaNdExcel {
  fechaNota: string; // ISO
  /** '' si el Excel no trae columna de código (formato usado en la práctica
   * hoy por el usuario) — el emparejamiento cae entonces solo por nombre. */
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
  /** "Bs. a Pagar x Dif." en céntimos, exactamente como Excel lo muestra
   * según el formato de la celda (ej. "#,##0" -> bolívar entero, redondeo
   * normal de Excel). Solo si la celda no tiene formato se redondea hacia
   * arriba al bolívar entero (convención de `calcularNotaDebito`). Todas las
   * demás columnas numéricas también se guardan como Excel las muestra. */
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

/**
 * Cuántos decimales muestra un formato numérico de Excel ("#,##0" -> 0,
 * "0.000" -> 3). Null si es "General"/sin formato (Excel muestra el valor
 * tal cual). Solo mira la primera sección (positivos) del formato.
 */
export function decimalesDeFormato(numFmt: string | undefined): number | null {
  if (!numFmt || /^general$/i.test(numFmt.trim())) return null;
  const seccion = numFmt
    .split(';')[0]!
    .replace(/"[^"]*"/g, '') // textos literales
    .replace(/\[[^\]]*\]/g, '') // colores / condiciones
    .replace(/\\./g, ''); // caracteres escapados
  if (!/[0#?]/.test(seccion)) return null;
  const m = seccion.match(/\.([0#?]+)/);
  return m ? m[1]!.length : 0;
}

/** Redondea como Excel al mostrar: mitad hacia afuera del cero, corrigiendo
 * el ruido de coma flotante (82950.15751 -> 82950; 22.5776150000004 -> 22.578). */
export function redondearComoExcel(valor: number, decimales: number): number {
  const factor = 10 ** decimales;
  const escalado = Number((Math.abs(valor) * factor).toPrecision(15));
  return (Math.sign(valor) * Math.round(escalado)) / factor;
}

/** El número tal como Excel lo MUESTRA en la celda (según su formato), no el
 * valor crudo con todos los decimales que arrastra de otras fórmulas. */
function celdaANumeroVisible(celda: ExcelJS.Cell): number | null {
  const crudo = celdaANumero(valorDeCelda(celda.value));
  if (crudo === null) return null;
  const decimales = decimalesDeFormato(celda.numFmt);
  return decimales === null ? crudo : redondearComoExcel(crudo, decimales);
}

/** Si la celda es una fórmula, su resultado guardado; si no, el valor. */
function valorDeCelda(valor: unknown): unknown {
  if (valor && typeof valor === 'object' && !(valor instanceof Date) && 'result' in valor) {
    return (valor as { result: unknown }).result;
  }
  return valor;
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

/**
 * Compara el nombre del registro (PDF, `nombrePdf`) contra el del Excel
 * (`nombreExcel`). Tolera el truncado a ~30 caracteres que el PDF le hace al
 * nombre — pero SOLO en esa dirección (el del Excel empieza con el del PDF),
 * nunca al revés: permitir la dirección contraria hacía que un nombre corto
 * del Excel (ej. "DIAMAGRO") calzara por prefijo con CUALQUIER registro cuyo
 * nombre completo empezara igual (ej. "DIAMAGRO, C.A."), generando
 * ambigüedad entre dos proveedores realmente distintos.
 */
function nombresCoinciden(nombrePdf: string, nombreExcel: string): boolean {
  const pdf = normalizarNombre(nombrePdf);
  const excel = normalizarNombre(nombreExcel);
  if (!pdf || !excel) return false;
  return excel.startsWith(pdf);
}

function emparejar(fila: FilaNdExcel, candidatosDelTipo: RegistroGuardado[]): FilaNdResuelta {
  let porCodigo: RegistroGuardado[] = [];
  if (fila.codigoExcel) {
    const codigoExcel = normalizarCodigo(fila.codigoExcel);
    porCodigo = candidatosDelTipo.filter((r) => normalizarCodigo(r.leido.codigo) === codigoExcel);
    if (porCodigo.length === 1) {
      return { fila, emparejamiento: 'codigo', candidatos: porCodigo };
    }
  }

  // El nombre exacto manda sobre el prefijo: si dos proveedores reales
  // distintos comparten un prefijo (ej. "DIAMAGRO" y "DIAMAGRO, C.A."), el
  // que calza exacto no debe quedar en duda solo porque el otro también
  // "empieza igual". El prefijo (tolerando el truncado a ~30 caracteres del
  // PDF) es el segundo intento, no el primero.
  const excelNorm = normalizarNombre(fila.proveedorExcel);
  const porNombreExacto = candidatosDelTipo.filter((r) => normalizarNombre(r.leido.nombre) === excelNorm);
  if (porNombreExacto.length === 1) {
    return { fila, emparejamiento: 'nombre', candidatos: porNombreExacto };
  }

  const porNombre =
    porNombreExacto.length === 0
      ? candidatosDelTipo.filter((r) => nombresCoinciden(r.leido.nombre, fila.proveedorExcel))
      : porNombreExacto;
  if (porNombre.length === 1) {
    return { fila, emparejamiento: 'nombre', candidatos: porNombre };
  }

  // Ambiguo (0 o 2+ candidatos): se deja para resolución manual, con lo que
  // se haya encontrado como sugerencia.
  return { fila, emparejamiento: 'sin-emparejar', candidatos: porCodigo.length > 0 ? porCodigo : porNombre };
}

/** Quita acentos, pasa a minúsculas y colapsa cualquier signo/espacio, para
 * comparar encabezados sin depender de tildes, "$", "/" o mayúsculas. */
function normalizarEncabezado(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Encabezado (normalizado) -> número de columna, leído de la fila 1. Así el
 * archivo puede traer las columnas en el orden que sea, con o sin la
 * columna "Código de Proveedor" (opcional) — no depende de posiciones fijas. */
function mapaEncabezados(filaEncabezado: ExcelJS.Row): Map<string, number> {
  const mapa = new Map<string, number>();
  filaEncabezado.eachCell({ includeEmpty: false }, (celda, col) => {
    const texto = celdaATexto(celda.value);
    if (!texto) return;
    mapa.set(normalizarEncabezado(texto), col);
  });
  return mapa;
}

/**
 * Lee el Excel externo con las notas de débito ya calculadas. Las columnas
 * se identifican por su encabezado (fila 1), no por posición fija, porque en
 * la práctica el archivo real del usuario no siempre trae la columna
 * "Código de Proveedor" (opcional — si falta, el emparejamiento cae directo
 * a por nombre). Encabezados esperados: Fecha Nota Débito, Código de
 * Proveedor (opcional), Fábrica, SAP, Proveedor, Litros Enviados, $/Lts,
 * Litros Transportados, $/Flete, Bs x Lts Inicio, Bs x Lts Ajustado,
 * Dif x Lts, Bs. a Pagar x Dif.
 *
 * El tipo de cada fila se infiere de cuál columna de litros trae dato
 * (Enviados -> leche, Transportados -> transporte); una fila con ambas o
 * ninguna se reporta como error y se omite. El emparejamiento contra los
 * registros ya cargados se intenta primero por código (normalizando ceros a
 * la izquierda) y, si no calza o la columna no existe, por nombre.
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

  const encabezados = mapaEncabezados(hoja.getRow(1));
  const colFecha = encabezados.get('fecha nota debito');
  const colCodigo = encabezados.get('codigo de proveedor');
  const colFabrica = encabezados.get('fabrica');
  const colSap = encabezados.get('sap');
  const colProveedor = encabezados.get('proveedor');
  const colLitrosEnviados = encabezados.get('litros enviados');
  const colPrecioLts = encabezados.get('lts');
  const colLitrosTransportados = encabezados.get('litros transportados');
  const colPrecioFlete = encabezados.get('flete');
  const colBsInicio = encabezados.get('bs x lts inicio');
  const colBsAjustado = encabezados.get('bs x lts ajustado');
  const colDif = encabezados.get('dif x lts');
  const colBsAPagar = encabezados.get('bs a pagar x dif');

  const faltantes: string[] = [];
  if (!colFecha) faltantes.push('Fecha Nota Debito');
  if (!colProveedor) faltantes.push('Proveedor');
  if (!colLitrosEnviados) faltantes.push('Litros Enviados');
  if (!colLitrosTransportados) faltantes.push('Litros Transportados');
  if (!colBsAPagar) faltantes.push('Bs. a Pagar x Dif.');
  if (faltantes.length > 0) {
    errores.push(
      `No se reconocen estas columnas en la fila 1 del Excel: ${faltantes.join(', ')}. Revisa que los encabezados coincidan (no hace falta el mismo orden, pero sí el mismo texto).`,
    );
    return { filas: [], errores };
  }

  hoja.eachRow((fila, numeroFila) => {
    if (numeroFila === 1) return; // encabezado
    const celdaFecha = fila.getCell(colFecha!).value;
    if (celdaFecha === null || celdaFecha === undefined || celdaFecha === '') return; // fila vacía

    const fechaNota = celdaAFechaIso(celdaFecha);
    if (!fechaNota) {
      errores.push(`Fila ${numeroFila}: la fecha "${String(celdaFecha)}" no se reconoce.`);
      return;
    }

    const proveedorExcel = celdaATexto(fila.getCell(colProveedor!).value);
    if (!proveedorExcel) {
      errores.push(`Fila ${numeroFila} (${fechaNota}): falta el nombre del proveedor.`);
      return;
    }

    const litrosEnviados = celdaANumeroVisible(fila.getCell(colLitrosEnviados!));
    const litrosTransportados = celdaANumeroVisible(fila.getCell(colLitrosTransportados!));
    const tieneLeche = litrosEnviados !== null && litrosEnviados > 0;
    const tieneTransporte = litrosTransportados !== null && litrosTransportados > 0;
    if (tieneLeche === tieneTransporte) {
      errores.push(
        `Fila ${numeroFila} (${proveedorExcel}): debe traer litros enviados O litros transportados, no ambos ni ninguno.`,
      );
      return;
    }

    const celdaBsAPagar = fila.getCell(colBsAPagar!);
    const bsAPagar = celdaANumeroVisible(celdaBsAPagar);
    if (bsAPagar === null) {
      errores.push(`Fila ${numeroFila} (${proveedorExcel}): "Bs. a Pagar x Dif." no es un número válido.`);
      return;
    }

    parseadas.push({
      fechaNota,
      codigoExcel: colCodigo ? (celdaATexto(fila.getCell(colCodigo).value) ?? '') : '',
      fabricaExcel: colFabrica ? celdaATexto(fila.getCell(colFabrica).value) : null,
      sapExcel: colSap ? celdaATexto(fila.getCell(colSap).value) : null,
      proveedorExcel,
      litrosEnviados,
      precioUsdLts: colPrecioLts ? celdaANumeroVisible(fila.getCell(colPrecioLts)) : null,
      litrosTransportados,
      precioUsdFlete: colPrecioFlete ? celdaANumeroVisible(fila.getCell(colPrecioFlete)) : null,
      bsXLtsInicio: colBsInicio ? celdaANumeroVisible(fila.getCell(colBsInicio)) : null,
      bsXLtsAjustado: colBsAjustado ? celdaANumeroVisible(fila.getCell(colBsAjustado)) : null,
      difXLts: colDif ? celdaANumeroVisible(fila.getCell(colDif)) : null,
      // Si la celda tiene formato, el monto es exactamente el que Excel
      // muestra (ya redondeado por celdaANumeroVisible). Sin formato
      // ("General") se mantiene la convención de bolívar entero hacia arriba.
      centimos:
        decimalesDeFormato(celdaBsAPagar.numFmt) === null
          ? Math.ceil(bsAPagar) * 100
          : Math.round(bsAPagar * 100),
      tipo: tieneLeche ? 'leche' : 'transporte',
    });
  });

  const filas = parseadas.map((f) => emparejar(f, registrosPorTipo.get(f.tipo) ?? []));
  return { filas, errores };
}
