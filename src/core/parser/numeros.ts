/**
 * Lectura y formateo de números y fechas.
 *
 * El PDF viene en formato anglosajón: la coma separa miles y el punto separa
 * decimales ("36,015,199.29"). La aplicación muestra en formato venezolano
 * ("36.015.199,29"). Estas dos convenciones no deben mezclarse nunca: todo lo
 * que sale del PDF pasa por `aCentimos`, y todo lo que se muestra pasa por
 * `formatearBs`.
 */

/** Detecta un monto del PDF: 1 o más dígitos con comas de miles y 2 decimales. */
const RE_MONTO = /^-?\d{1,3}(?:,\d{3})*\.\d{2}$|^-?\d+\.\d{2}$/;
/** Detecta un entero con comas de miles: "74790", "10,868". */
const RE_ENTERO = /^-?\d{1,3}(?:,\d{3})*$|^-?\d+$/;

/**
 * "36,015,199.29" -> 3601519929 (céntimos).
 * Se parte el texto en entero y decimales para no pasar nunca por coma
 * flotante, de modo que las sumas de validación sean exactas.
 */
export function aCentimos(texto: string): number | null {
  const t = texto.trim();
  if (!RE_MONTO.test(t)) return null;
  const negativo = t.startsWith('-');
  const limpio = (negativo ? t.slice(1) : t).replace(/,/g, '');
  const punto = limpio.indexOf('.');
  const entero = limpio.slice(0, punto);
  const decimales = limpio.slice(punto + 1);
  const centimos = Number(entero) * 100 + Number(decimales);
  if (!Number.isFinite(centimos)) return null;
  return negativo ? -centimos : centimos;
}

/** "10,868" -> 10868. Devuelve null si no es un entero limpio. */
export function aEntero(texto: string): number | null {
  const t = texto.trim();
  if (!RE_ENTERO.test(t)) return null;
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function esMonto(texto: string): boolean {
  return RE_MONTO.test(texto.trim());
}

/** 3601519929 -> "36.015.199,29" */
export function formatearBs(centimos: number): string {
  const negativo = centimos < 0;
  const abs = Math.abs(Math.round(centimos));
  const entero = Math.floor(abs / 100);
  const dec = String(abs % 100).padStart(2, '0');
  return `${negativo ? '-' : ''}${agruparMiles(entero)},${dec}`;
}

/** 74790 -> "74.790" */
export function formatearEntero(n: number): string {
  const negativo = n < 0;
  return `${negativo ? '-' : ''}${agruparMiles(Math.abs(Math.round(n)))}`;
}

/** Formatea un decimal suelto (precios, tasas) con hasta `dec` decimales. */
export function formatearDecimal(n: number, dec = 2): string {
  if (!Number.isFinite(n)) return '—';
  const negativo = n < 0;
  const abs = Math.abs(n);
  const entero = Math.floor(abs);
  const resto = abs - entero;
  let decimales = resto.toFixed(dec).slice(2);
  // Quita ceros sobrantes pero conserva al menos dos decimales.
  while (decimales.length > 2 && decimales.endsWith('0')) decimales = decimales.slice(0, -1);
  return `${negativo ? '-' : ''}${agruparMiles(entero)},${decimales}`;
}

/** Formatea con exactamente `dec` decimales, como lo muestra Excel con un
 * formato fijo ("0.000"): 0.85 -> "0,850", 82950 -> "82.950" (dec = 0). */
export function formatearFijo(n: number, dec: number): string {
  if (!Number.isFinite(n)) return '—';
  const negativo = n < 0;
  const [entero, decimales] = Math.abs(n).toFixed(dec).split('.');
  const enteroAgrupado = agruparMiles(Number(entero));
  return `${negativo ? '-' : ''}${enteroAgrupado}${decimales ? `,${decimales}` : ''}`;
}

function agruparMiles(n: number): string {
  const s = String(n);
  let salida = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) salida += '.';
    salida += s[i];
  }
  return salida;
}

// ─────────────────────────────────────────────────────────────
// Fechas
// ─────────────────────────────────────────────────────────────

/** "03/06/2026" -> "2026-06-03". Null si no encaja. */
export function fechaDdMmYyyy(texto: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  if (!dd || !mm || !yyyy) return null;
  const iso = `${yyyy}-${mm}-${dd}`;
  return esFechaValida(iso) ? iso : null;
}

/**
 * Las columnas de litros por día traen solo "06/06" sin año. Se resuelve
 * eligiendo el año que deja la fecha más cerca del inicio de la semana, para
 * que una semana que cruza el 31 de diciembre no se vaya un año entero.
 */
export function fechaDdMmEnSemana(texto: string, fechaIni: string): string | null {
  const m = /^(\d{2})\/(\d{2})$/.exec(texto.trim());
  if (!m) return null;
  const [, dd, mm] = m;
  const anioBase = Number(fechaIni.slice(0, 4));
  if (!Number.isFinite(anioBase)) return null;

  const refe = Date.parse(`${fechaIni}T00:00:00Z`);
  let mejor: string | null = null;
  let mejorDist = Infinity;
  for (const anio of [anioBase - 1, anioBase, anioBase + 1]) {
    const iso = `${anio}-${mm}-${dd}`;
    if (!esFechaValida(iso)) continue;
    const dist = Math.abs(Date.parse(`${iso}T00:00:00Z`) - refe);
    if (dist < mejorDist) {
      mejorDist = dist;
      mejor = iso;
    }
  }
  return mejor;
}

export function esFechaValida(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** "2026-06-03" -> "03/06/2026" */
export function fechaAMostrar(iso: string | null | undefined): string {
  if (!iso || !esFechaValida(iso)) return '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** "2026-06-03" -> "Miércoles" */
export function nombreDia(iso: string): string {
  if (!esFechaValida(iso)) return '—';
  const nombre = new Date(`${iso}T00:00:00Z`).toLocaleDateString('es-VE', {
    weekday: 'long',
    timeZone: 'UTC',
  });
  return nombre.charAt(0).toUpperCase() + nombre.slice(1);
}

/** Días del rango [ini, fin] inclusive, en ISO. */
export function diasEntre(ini: string, fin: string): string[] {
  if (!esFechaValida(ini) || !esFechaValida(fin)) return [];
  const salida: string[] = [];
  let t = Date.parse(`${ini}T00:00:00Z`);
  const hasta = Date.parse(`${fin}T00:00:00Z`);
  // Cota de seguridad: una nómina nunca abarca más de un mes.
  for (let i = 0; t <= hasta && i < 60; i++) {
    salida.push(new Date(t).toISOString().slice(0, 10));
    t += 86_400_000;
  }
  return salida;
}

/** Miércoles (UTC) que empieza la semana ganadera que contiene el 1° de enero de `anio`. */
function inicioSemanaGanaderaDelAnio(anio: number): Date {
  const enero1 = new Date(Date.UTC(anio, 0, 1));
  // getUTCDay(): 0=domingo … 3=miércoles … 6=sábado.
  const diasDesdeMiercoles = (enero1.getUTCDay() - 3 + 7) % 7;
  const inicio = new Date(enero1);
  inicio.setUTCDate(enero1.getUTCDate() - diasDesdeMiercoles);
  return inicio;
}

export interface SemanaGanadera {
  anio: number;
  numero: number;
  fechaIni: string;
  fechaFin: string;
}

/**
 * Semana ganadera de una fecha: bloques fijos de 7 días, de miércoles a
 * martes; la semana 1 del año es la que contiene el 1° de enero. Es un
 * cálculo de calendario puro — no depende de que haya ninguna nómina
 * cargada que cubra esa fecha.
 */
export function semanaGanaderaDe(fechaIso: string): SemanaGanadera {
  const d = new Date(`${fechaIso}T00:00:00Z`);
  let anio = d.getUTCFullYear();
  let inicio = inicioSemanaGanaderaDelAnio(anio);
  if (d < inicio) {
    anio -= 1;
    inicio = inicioSemanaGanaderaDelAnio(anio);
  } else {
    const inicioSiguiente = inicioSemanaGanaderaDelAnio(anio + 1);
    if (d >= inicioSiguiente) {
      anio += 1;
      inicio = inicioSiguiente;
    }
  }
  const dias = Math.floor((d.getTime() - inicio.getTime()) / 86_400_000);
  const numero = Math.floor(dias / 7) + 1;
  // `inicio` es el arranque de la semana 1 del año — hay que avanzarlo
  // (numero - 1) semanas para llegar al inicio de la semana real de `d`.
  const inicioSemana = new Date(inicio);
  inicioSemana.setUTCDate(inicio.getUTCDate() + (numero - 1) * 7);
  const fin = new Date(inicioSemana);
  fin.setUTCDate(inicioSemana.getUTCDate() + 6);
  return {
    anio,
    numero,
    fechaIni: inicioSemana.toISOString().slice(0, 10),
    fechaFin: fin.toISOString().slice(0, 10),
  };
}

/** Todas las semanas ganaderas del año, en orden (52 o 53 según el año). */
export function semanasGanaderasDelAnio(anio: number): SemanaGanadera[] {
  const salida: SemanaGanadera[] = [];
  let inicio = inicioSemanaGanaderaDelAnio(anio);
  let numero = 1;
  while (true) {
    const semana = semanaGanaderaDe(inicio.toISOString().slice(0, 10));
    if (semana.anio !== anio) break;
    salida.push(semana);
    inicio = new Date(inicio);
    inicio.setUTCDate(inicio.getUTCDate() + 7);
    numero += 1;
    if (numero > 54) break; // cota de seguridad
  }
  return salida;
}
