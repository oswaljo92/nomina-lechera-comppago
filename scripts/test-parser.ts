/**
 * Prueba del parser contra los reportes reales de fixtures/.
 *
 *   npm run test:parser
 *
 * Sale con código 1 si alguna nómina no cuadra, de modo que sirva también
 * como verificación automática antes de un despliegue.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import { paginasDesdePdf, type DocumentoPdf } from '../src/core/parser/desdePdfjs.ts';
import { parseNomina } from '../src/core/parser/parseNomina.ts';
import { validarNomina } from '../src/core/parser/validar.ts';
import { formatearBs, formatearEntero, fechaAMostrar } from '../src/core/parser/numeros.ts';
import { CATALOGO_INICIAL, catalogoComoMapa } from '../src/core/calc/catalogo.ts';
import { calcularRegistro } from '../src/core/calc/calcular.ts';
import type { NominaLeida } from '../src/core/types.ts';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirFixtures = path.join(raiz, 'fixtures');

const V = '[32m'; // verde
const A = '[33m'; // ámbar
const R = '[31m'; // rojo
const G = '[90m'; // gris
const N = '[0m';
const B = '[1m';

// Para la prueba se da por clasificado todo lo que el catálogo trae, incluido
// el 0999, de modo que el resultado refleje el cuadre aritmético y no el
// bloqueo administrativo (que se prueba aparte, más abajo).
const catalogoPrueba = catalogoComoMapa(
  CATALOGO_INICIAL.map((c) => ({ ...c, clasificado: true })),
);

async function leer(archivo: string): Promise<NominaLeida> {
  const datos = new Uint8Array(fs.readFileSync(archivo));
  const doc = (await pdfjs.getDocument({ data: datos, useSystemFonts: true })
    .promise) as unknown as DocumentoPdf;
  return parseNomina(await paginasDesdePdf(doc));
}

let fallos = 0;

const archivos = fs
  .readdirSync(dirFixtures)
  .filter((f) => f.toLowerCase().endsWith('.pdf'))
  .sort();

if (archivos.length === 0) {
  console.error(`${R}No hay PDFs en fixtures/${N}`);
  process.exit(1);
}

for (const nombreArchivo of archivos) {
  const nomina = await leer(path.join(dirFixtures, nombreArchivo));
  const val = validarNomina(nomina, catalogoPrueba);
  const c = nomina.cabecera;

  console.log(`\n${B}══════ ${nombreArchivo} ══════${N}`);
  console.log(
    `${c.titulo}  ·  ${c.reporte}  ·  tipo «${c.tipo}»  ·  ${nomina.paginas} páginas`,
  );
  console.log(
    `Año ${c.anio} · Nómina Nº ${c.numero} · del ${fechaAMostrar(c.fechaIni)} al ${fechaAMostrar(c.fechaFin)}`,
  );
  console.log(
    `Fábricas: ${nomina.fabricas.map((f) => `${f.codigo} ${f.nombre}`).join(' · ') || '—'}`,
  );

  // ── Conceptos encontrados ──
  const usos = new Map<string, { pago: number; ded: number; total: number }>();
  for (const r of nomina.registros) {
    for (const cp of r.conceptos) {
      const u = usos.get(cp.codigo) ?? { pago: 0, ded: 0, total: 0 };
      if (cp.columna === 'pago') u.pago++;
      else u.ded++;
      u.total += cp.centimos;
      usos.set(cp.codigo, u);
    }
  }
  console.log(`\n${B}Conceptos${N}`);
  for (const [cod, u] of [...usos].sort()) {
    const def = catalogoPrueba.get(cod);
    const etiqueta = def ? def.nombre : `${R}DESCONOCIDO${N}`;
    const clase = u.pago > 0 ? 'pago' : 'deducción';
    console.log(
      `  ${cod}  ${etiqueta.padEnd(20)} ${clase.padEnd(10)} ${String(u.pago + u.ded).padStart(3)} usos   ${formatearBs(u.total).padStart(18)} Bs`,
    );
  }

  // ── Totales ──
  const sumaBruto = nomina.registros.reduce(
    (a, r) => a + r.conceptos.filter((x) => x.columna === 'pago').reduce((s, x) => s + x.centimos, 0),
    0,
  );
  const sumaDed = nomina.registros.reduce(
    (a, r) => a + r.conceptos.filter((x) => x.columna === 'deduccion').reduce((s, x) => s + x.centimos, 0),
    0,
  );

  console.log(`\n${B}Cuadre global${N}`);
  console.log(`  Registros leídos          ${String(nomina.registros.length).padStart(18)}`);
  console.log(`  Suma de pagos             ${formatearBs(sumaBruto).padStart(18)} Bs`);
  console.log(`  Suma de deducciones       ${formatearBs(sumaDed).padStart(18)} Bs`);
  console.log(`  Neto calculado            ${formatearBs(sumaBruto - sumaDed).padStart(18)} Bs`);
  if (nomina.totalGeneral) {
    console.log(`  ${G}Total General del PDF     ${formatearBs(nomina.totalGeneral.bruto ?? 0).padStart(18)} Bs${N}`);
    console.log(`  ${G}Deducción del PDF         ${formatearBs(nomina.totalGeneral.deduccion ?? 0).padStart(18)} Bs${N}`);
    console.log(`  ${G}Neto del PDF              ${formatearBs(nomina.totalGeneral.neto ?? 0).padStart(18)} Bs${N}`);
  } else {
    const fb = nomina.totalesFabrica;
    console.log(`  ${G}Sin «Total General»; se contrasta contra ${fb.length} total(es) por fábrica${N}`);
    console.log(`  ${G}Suma Total Fábrica        ${formatearBs(fb.reduce((a, t) => a + (t.bruto ?? 0), 0)).padStart(18)} Bs${N}`);
  }

  // ── Ejemplo de cálculo con el motor real ──
  const ejemplo = nomina.registros[0];
  if (ejemplo) {
    const calc = calcularRegistro(ejemplo, catalogoPrueba, [], null);
    console.log(`\n${B}Ejemplo de cálculo — ${ejemplo.nombre}${N}`);
    console.log(`  Ruta ${ejemplo.ruta} · Código ${ejemplo.codigo} · Fábrica ${ejemplo.fabricaCod} ${ejemplo.fabricaNom}`);
    console.log(`  Cédula ${ejemplo.cedula ?? '—'} · RIF ${ejemplo.rif ?? '—'}`);
    console.log(`  Banco ${ejemplo.banco ?? '—'} · Cuenta ${ejemplo.cuenta ?? '—'}`);
    console.log(`  Litros ${formatearEntero(ejemplo.litrosTotal ?? 0)} en ${ejemplo.litrosDia.length} día(s)`);
    for (const l of calc.lineas) {
      const signo = l.clase === 'pago' ? '+' : '−';
      const marca = l.restaFacturacion ? ' (resta de la facturación)' : '';
      console.log(`    ${signo} ${l.codigo} ${l.nombre.padEnd(20)} ${formatearBs(l.centimos).padStart(18)} Bs${marca}`);
    }
    console.log(`  ${B}Bruto             ${formatearBs(calc.bruto).padStart(18)} Bs${N}`);
    console.log(`  ${B}Deducciones       ${formatearBs(calc.deducciones).padStart(18)} Bs${N}`);
    console.log(`  ${B}NETO A PAGAR      ${formatearBs(calc.neto).padStart(18)} Bs${N}`);
    console.log(`  ${B}TOTAL A FACTURAR  ${formatearBs(calc.totalFacturar).padStart(18)} Bs${N}`);
  }

  // ── Validación ──
  const icono = val.nivel === 'ok' ? `${V}✔${N}` : val.nivel === 'aviso' ? `${A}▲${N}` : `${R}✘${N}`;
  console.log(
    `\n${B}Validación${N}  ${icono}  ${V}${val.resumen.ok} ok${N} · ${A}${val.resumen.avisos} aviso(s)${N} · ${R}${val.resumen.errores} error(es)${N}`,
  );

  for (const h of val.hallazgos) {
    const col = h.nivel === 'error' ? R : h.nivel === 'aviso' ? A : G;
    console.log(`  ${col}[${h.nivel}] ${h.mensaje}${N}`);
    if (h.esperado !== undefined) console.log(`        PDF dice  ${h.esperado}`);
    if (h.obtenido !== undefined) console.log(`        calculado ${h.obtenido}`);
  }

  val.porRegistro.forEach((v, i) => {
    if (v.nivel === 'ok') return;
    const r = nomina.registros[i]!;
    const col = v.nivel === 'error' ? R : A;
    console.log(`  ${col}${r.nombre} (cód. ${r.codigo}, pág. ${r.pagina})${N}`);
    for (const h of v.hallazgos) {
      console.log(`     ${col}· ${h.mensaje}${N}`);
      if (h.esperado !== undefined) console.log(`         PDF dice  ${h.esperado}`);
      if (h.obtenido !== undefined) console.log(`         calculado ${h.obtenido}`);
    }
  });

  if (val.nivel === 'error') fallos++;
}

// ── Prueba del bloqueo por concepto sin clasificar ──
console.log(`\n${B}══════ Bloqueo por concepto sin clasificar ══════${N}`);
{
  const catalogoReal = catalogoComoMapa(CATALOGO_INICIAL);
  const nomina = await leer(path.join(dirFixtures, archivos[0]!));
  const val = validarNomina(nomina, catalogoReal);
  const usa0999 = nomina.registros.some((r) => r.conceptos.some((c) => c.codigo === '0999'));
  if (usa0999) {
    const bloquea = val.codigosSinClasificar.includes('0999');
    console.log(
      bloquea
        ? `  ${V}✔${N} El 0999 aparece en el reporte y la validación lo marca como sin clasificar.`
        : `  ${R}✘ El 0999 aparece pero la validación NO lo bloqueó.${N}`,
    );
    if (!bloquea) fallos++;
  } else {
    console.log(`  ${G}El primer reporte no usa 0999; prueba omitida.${N}`);
  }
}

console.log('');
if (fallos > 0) {
  console.error(`${R}${B}${fallos} nómina(s) con errores de cuadre.${N}\n`);
  process.exit(1);
}
console.log(`${V}${B}Todas las nóminas cuadran contra los totales impresos en el PDF.${N}\n`);
