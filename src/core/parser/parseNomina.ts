import {
  enBanda,
  itemsEn,
  primerEn,
  type FilaLayout,
  type ItemLayout,
  type PaginaLayout,
} from './layout.ts';
import { aCentimos, aEntero, fechaDdMmEnSemana, fechaDdMmYyyy } from './numeros.ts';
import type {
  CabeceraNomina,
  ConceptoLeido,
  Fabrica,
  NominaLeida,
  RegistroLeido,
  TipoNomina,
  TotalesDeclarados,
  TotalFabrica,
} from '../types.ts';

/** Textos que ocupan la banda del nombre pero no son un proveedor. */
const ETIQUETAS = new Set([
  'Cedula:',
  'Cédula:',
  'RIF:',
  'Total Fabrica:',
  'Total Fábrica:',
  'Total General:',
  'Año',
  'Ano',
  'Ruta',
  'Página:',
  'Pagina:',
]);

const RE_RUTA = /^\d{4,6}$/;
const RE_CONCEPTO = /^\d{4}$/;
const RE_DIA = /^\d{2}\/\d{2}$/;

export class ErrorParseo extends Error {
  detalle: string | undefined;

  constructor(message: string, detalle?: string) {
    super(message);
    this.name = 'ErrorParseo';
    this.detalle = detalle;
  }
}

/** Estado mutable mientras se acumulan las filas de un mismo proveedor. */
interface EnCurso {
  reg: RegistroLeido;
  /** Columnas «Total» y dd/mm de la fila inicial, para emparejar los litros. */
  encabezadosLitros: ItemLayout[];
  litrosCapturados: boolean;
  totalesCapturados: boolean;
  esperandoBanco: boolean;
}

/**
 * Lee un reporte completo.
 *
 * La lectura es por flujo de filas, no por bloques recortados, porque cuando un
 * proveedor no cabe en lo que resta de la página el reporte lo continúa en la
 * siguiente REPITIENDO su nombre, ruta y código. Esa fila repetida se distingue
 * de un proveedor nuevo en que no trae código de concepto: todo registro
 * genuino estrena su primera línea de concepto en su fila inicial.
 */
export function parseNomina(paginas: PaginaLayout[]): NominaLeida {
  if (paginas.length === 0) throw new ErrorParseo('El PDF no tiene páginas legibles.');

  const cabecera = leerCabecera(paginas[0]!);
  const registros: RegistroLeido[] = [];
  const totalesFabrica: TotalFabrica[] = [];
  const fabricasVistas = new Map<string, Fabrica>();
  let totalGeneral: TotalesDeclarados | null = null;
  let actual: EnCurso | null = null;

  for (const pagina of paginas) {
    const fabrica = leerFabrica(pagina);
    if (fabrica) fabricasVistas.set(fabrica.codigo, fabrica);

    for (const fila of pagina.filas) {
      if (esFilaDeEncabezado(fila)) continue;

      const tipoTotal = tipoFilaTotal(fila);
      if (tipoTotal === 'fabrica') {
        totalesFabrica.push({
          fabricaCod: fabrica?.codigo ?? '',
          fabricaNom: fabrica?.nombre ?? '',
          pagina: pagina.numero,
          ...leerTernaMontos(fila),
        });
        actual = null;
        continue;
      }
      if (tipoTotal === 'general') {
        totalGeneral = leerTernaMontos(fila);
        actual = null;
        continue;
      }

      if (esInicioRegistro(fila, actual, pagina.numero, cabecera.tipo)) {
        actual = crearRegistro(fila, fabrica, pagina.numero, cabecera.tipo);
        registros.push(actual.reg);
      }

      if (actual) acumular(actual, fila, cabecera);
    }
  }

  return {
    cabecera,
    registros,
    totalesFabrica,
    totalGeneral,
    fabricas: [...fabricasVistas.values()],
    paginas: paginas.length,
  };
}

// ─────────────────────────────────────────────────────────────
// Cabecera del reporte
// ─────────────────────────────────────────────────────────────

function leerCabecera(pagina: PaginaLayout): CabeceraNomina {
  const todo = pagina.filas.map((f) => f.items.map((i) => i.texto).join(' ')).join(' \n ');

  let tipo: TipoNomina;
  let titulo: string;
  if (/PAGO DE LECHE FRESCA/i.test(todo)) {
    tipo = 'leche';
    titulo = 'PAGO DE LECHE FRESCA';
  } else if (/NOMINA DE RUTAS/i.test(todo)) {
    tipo = 'transporte';
    titulo = 'NOMINA DE RUTAS';
  } else {
    throw new ErrorParseo(
      'No reconozco este reporte.',
      'Se esperaba «PAGO DE LECHE FRESCA» (Gan0584) o «NOMINA DE RUTAS» (Gan0594) en la primera página.',
    );
  }

  const reporte = /Rep\.\s*(Gan\d+)/i.exec(todo)?.[1] ?? (tipo === 'leche' ? 'Gan0584' : 'Gan0594');

  const fila = pagina.filas.find((f) => f.items.some((i) => i.texto === 'Año' || i.texto === 'Ano'));
  if (!fila) {
    throw new ErrorParseo(
      'No encuentro la fila de cabecera del reporte.',
      'Se esperaba una línea con «Año … Nom. … del … al … Fab …».',
    );
  }

  const anio = aEntero(siguienteA(fila, ['Año', 'Ano'])?.texto ?? '');
  const numero = aEntero(siguienteA(fila, ['Nom.', 'Nom'])?.texto ?? '');
  const fechaIni = fechaDdMmYyyy(siguienteA(fila, ['del'])?.texto ?? '');
  const fechaFin = fechaDdMmYyyy(siguienteA(fila, ['al'])?.texto ?? '');

  const faltan: string[] = [];
  if (anio === null) faltan.push('el año');
  if (numero === null) faltan.push('el número de nómina');
  if (!fechaIni) faltan.push('la fecha inicial');
  if (!fechaFin) faltan.push('la fecha final');
  if (faltan.length > 0 || anio === null || numero === null || !fechaIni || !fechaFin) {
    throw new ErrorParseo(
      `No pude leer ${faltan.join(', ')} de la cabecera.`,
      fila.items.map((i) => i.texto).join(' '),
    );
  }

  return { tipo, reporte, titulo, anio, numero, fechaIni, fechaFin };
}

function leerFabrica(pagina: PaginaLayout): Fabrica | null {
  const fila = pagina.filas.find((f) => f.items.some((i) => i.texto === 'Fab'));
  if (!fila) return null;
  const idx = fila.items.findIndex((i) => i.texto === 'Fab');
  const codigo = fila.items[idx + 1]?.texto?.trim();
  const nombre = fila.items
    .slice(idx + 2)
    .map((i) => i.texto)
    .join(' ')
    .trim();
  if (!codigo || !nombre) return null;
  return { codigo, nombre };
}

function siguienteA(fila: FilaLayout, etiquetas: string[]): ItemLayout | null {
  const idx = fila.items.findIndex((i) => etiquetas.includes(i.texto));
  if (idx < 0) return null;
  return fila.items[idx + 1] ?? null;
}

// ─────────────────────────────────────────────────────────────
// Clasificación de filas
// ─────────────────────────────────────────────────────────────

/** Título, banda de campos, encabezados de columna, paginación y pie. */
function esFilaDeEncabezado(fila: FilaLayout): boolean {
  const textos = fila.items.map((i) => i.texto);
  if (textos.some((t) => /^(PAGO DE LECHE FRESCA|NOMINA DE RUTAS)$/i.test(t))) return true;
  if (textos.some((t) => t === 'Año' || t === 'Ano' || t === 'Fab')) return true;
  if (textos.some((t) => /^P[áa]gina:?$/i.test(t) || /^P[áa]gina:\s*\d+$/i.test(t))) return true;
  if (textos.some((t) => /^Rep\./i.test(t))) return true;
  // Fila de encabezados de columna: «Ruta … Cod … Pago … Deduccion … Neto».
  if (textos.includes('Cod') && (textos.includes('Ruta') || textos.includes('Pago'))) return true;
  return false;
}

/**
 * Decide si una fila abre un registro nuevo o continúa el que está en curso.
 *
 * Cuando un proveedor no cabe en lo que resta de la página, el reporte lo
 * continúa arriba de la siguiente repitiendo nombre, ruta y código —y a veces
 * arrastrando además una línea de concepto nueva, como hace FRANCISCO JAVIER
 * RAMIREZ con su ISLR—. Por eso la presencia de un concepto no sirve para
 * distinguir los dos casos y hay que mirar la identidad.
 *
 * La condición de continuación es doble: identidad idéntica Y registro iniciado
 * en una página anterior. Exigir el cambio de página evita fundir dos
 * proveedores homónimos que aparecieran seguidos dentro de la misma página.
 */
function esInicioRegistro(
  fila: FilaLayout,
  actual: EnCurso | null,
  pagina: number,
  tipo: TipoNomina,
): boolean {
  const nombre = primerEn(fila, 'nombre');
  if (!nombre || ETIQUETAS.has(nombre.texto)) return false;

  const ruta = itemsEn(fila, 'ruta').find((i) => RE_RUTA.test(i.texto));
  if (!ruta) return false;

  if (!actual) return true;
  if (actual.reg.pagina === pagina) return true;

  const mismaIdentidad =
    actual.reg.nombre === nombre.texto.trim() &&
    actual.reg.ruta === ruta.texto &&
    actual.reg.codigo === codigoProveedor(fila, ruta.texto, tipo);
  return !mismaIdentidad;
}

/**
 * En «leche» el proveedor se identifica por la columna «Gan». En «transporte»
 * esa columna no existe: su lugar lo ocupa «Transf.» —el número de litros
 * transferidos— y el identificador es la propia ruta. Leer la banda sin mirar
 * el tipo de reporte haría que un valor de transferencia sin coma de miles
 * («684») se colara como código de proveedor.
 */
function codigoProveedor(fila: FilaLayout, ruta: string, tipo: TipoNomina): string {
  if (tipo !== 'leche') return ruta;
  return itemsEn(fila, 'gan').find((i) => /^\d{3,6}$/.test(i.texto))?.texto ?? ruta;
}

function tipoFilaTotal(fila: FilaLayout): 'fabrica' | 'general' | null {
  const nombre = primerEn(fila, 'nombre');
  if (!nombre) return null;
  if (/^Total\s+F[áa]brica/i.test(nombre.texto)) return 'fabrica';
  if (/^Total\s+General/i.test(nombre.texto)) return 'general';
  return null;
}

function leerTernaMontos(fila: FilaLayout): TotalesDeclarados {
  return {
    bruto: montoEn(fila, 'pago'),
    deduccion: montoEn(fila, 'deduccion'),
    neto: montoEn(fila, 'neto'),
  };
}

function montoEn(fila: FilaLayout, banda: 'pago' | 'deduccion' | 'neto'): number | null {
  for (const item of itemsEn(fila, banda)) {
    const c = aCentimos(item.texto);
    if (c !== null) return c;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Acumulación de un registro
// ─────────────────────────────────────────────────────────────

function crearRegistro(
  fila: FilaLayout,
  fabrica: Fabrica | null,
  pagina: number,
  tipo: TipoNomina,
): EnCurso {
  const nombre = primerEn(fila, 'nombre')!.texto.trim();
  const ruta = itemsEn(fila, 'ruta').find((i) => RE_RUTA.test(i.texto))!.texto;

  return {
    reg: {
      nombre,
      ruta,
      codigo: codigoProveedor(fila, ruta, tipo),
      fabricaCod: fabrica?.codigo ?? '',
      fabricaNom: fabrica?.nombre ?? '',
      cedula: null,
      rif: null,
      banco: null,
      cuenta: null,
      litrosTotal: null,
      litrosDia: [],
      conceptos: [],
      brutoPdf: null,
      deduccionPdf: null,
      netoPdf: null,
      pagina,
    },
    encabezadosLitros: itemsEn(fila, 'serie').filter(
      (i) => /^Total$/i.test(i.texto) || RE_DIA.test(i.texto),
    ),
    litrosCapturados: false,
    totalesCapturados: false,
    esperandoBanco: false,
  };
}

function acumular(estado: EnCurso, fila: FilaLayout, cabecera: CabeceraNomina): void {
  const r = estado.reg;

  // — conceptos —
  const cod = itemsEn(fila, 'concepto').find((i) => RE_CONCEPTO.test(i.texto));
  if (cod) {
    const pago = montoEn(fila, 'pago');
    const ded = montoEn(fila, 'deduccion');
    const concepto: ConceptoLeido | null =
      pago !== null
        ? { codigo: cod.texto, centimos: pago, columna: 'pago' }
        : ded !== null
          ? { codigo: cod.texto, centimos: ded, columna: 'deduccion' }
          : null;
    if (concepto) r.conceptos.push(concepto);
  } else if (!estado.totalesCapturados) {
    // — totales del registro: fila sin concepto con valor en la banda de neto —
    const neto = montoEn(fila, 'neto');
    if (neto !== null) {
      r.netoPdf = neto;
      r.brutoPdf = montoEn(fila, 'pago');
      r.deduccionPdf = montoEn(fila, 'deduccion');
      estado.totalesCapturados = true;
    }
  }

  // — cédula y RIF —
  const etiqueta = primerEn(fila, 'nombre');
  if (etiqueta && r.cedula === null && /^C[ée]dula:/i.test(etiqueta.texto)) {
    r.cedula = leerDocumento(fila, etiqueta.xFin);
  }
  if (etiqueta && r.rif === null && /^RIF:/i.test(etiqueta.texto)) {
    r.rif = leerDocumento(fila, etiqueta.xFin);
  }

  // — banco y número de cuenta —
  for (const item of itemsEn(fila, 'serie')) {
    const mCuenta = /DEP[OÓ]SITO[^\n]*?N\.?\s*(\d{15,25})/i.exec(item.texto);
    if (mCuenta) {
      r.cuenta = mCuenta[1] ?? r.cuenta;
      estado.esperandoBanco = true;
    } else if (estado.esperandoBanco && r.banco === null && esNombreBanco(item.texto)) {
      r.banco = item.texto.trim();
      estado.esperandoBanco = false;
    }
  }

  // — litros: valores emparejados con los encabezados de la fila inicial —
  if (!estado.litrosCapturados && estado.encabezadosLitros.length > 0) {
    capturarLitros(estado, fila, cabecera.fechaIni);
  }
}

/**
 * Los litros viven en dos filas: la del inicio del registro trae los
 * encabezados («Total» y las fechas dd/mm) y una posterior trae los valores,
 * alineados en las mismas columnas. Se emparejan por cercanía en X: el paso
 * entre columnas es de 36pt, así que 15 deja margen sin invadir la vecina.
 */
function capturarLitros(estado: EnCurso, fila: FilaLayout, fechaIni: string): void {
  const valores = itemsEn(fila, 'serie')
    .map((i) => ({ x: i.x, n: aEntero(i.texto) }))
    .filter((v): v is { x: number; n: number } => v.n !== null);
  if (valores.length === 0) return;

  for (const enc of estado.encabezadosLitros) {
    let mejor: { x: number; n: number } | null = null;
    let mejorDist = 15;
    for (const v of valores) {
      const d = Math.abs(v.x - enc.x);
      if (d < mejorDist) {
        mejorDist = d;
        mejor = v;
      }
    }
    if (!mejor) continue;

    if (/^Total$/i.test(enc.texto)) {
      estado.reg.litrosTotal = mejor.n;
    } else {
      const fecha = fechaDdMmEnSemana(enc.texto, fechaIni);
      if (fecha) estado.reg.litrosDia.push({ fecha, litros: mejor.n });
    }
  }

  estado.reg.litrosDia.sort((a, b) => a.fecha.localeCompare(b.fecha));
  estado.litrosCapturados = true;
}

/** Lee el valor que sigue a la etiqueta «Cedula:» o «RIF:» dentro de su banda. */
function leerDocumento(fila: FilaLayout, xDespuesDe: number): string | null {
  const partes = fila.items
    .filter((i) => enBanda(i.x, 'nombre') && i.x >= xDespuesDe)
    .map((i) => i.texto.trim())
    .filter((t) => t.length > 0);
  if (partes.length === 0) return null;

  // Forma "V" + "17771173" -> "V-17771173".
  if (partes.length >= 2 && /^[VEJPGvejpg]$/.test(partes[0]!) && /^\d+$/.test(partes[1]!)) {
    return `${partes[0]!.toUpperCase()}-${partes[1]}`;
  }
  const unido = partes.join('');
  return unido.length > 0 ? unido : null;
}

function esNombreBanco(texto: string): boolean {
  const t = texto.trim();
  if (t.length < 6) return false;
  if (RE_DIA.test(t) || /^\d/.test(t)) return false;
  if (/^Total$/i.test(t)) return false;
  return /^[A-ZÑÁÉÍÓÚ][A-ZÑÁÉÍÓÚ .,'-]+$/.test(t);
}
