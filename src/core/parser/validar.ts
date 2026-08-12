import { formatearBs, formatearEntero } from './numeros.ts';
import type {
  ConceptoCatalogo,
  Hallazgo,
  NivelValidacion,
  NominaLeida,
  RegistroLeido,
  ValidacionNomina,
  ValidacionRegistro,
} from '../types.ts';

/**
 * Contrasta lo extraído contra los totales que el propio PDF declara.
 *
 * Esta capa existe porque un parser posicional puede fallar en silencio: si una
 * banda se corre, los números siguen saliendo pero equivocados. Al obligar a
 * que las sumas cuadren con el «Total General» impreso en el reporte, un error
 * de lectura se convierte en un error visible en pantalla.
 */
export function validarNomina(
  nomina: NominaLeida,
  catalogo: Map<string, ConceptoCatalogo>,
): ValidacionNomina {
  const porRegistro = nomina.registros.map((r) => validarRegistro(r, catalogo));
  const hallazgos: Hallazgo[] = [];

  // ── Códigos de concepto desconocidos o sin clasificar ──
  const sinClasificar = new Set<string>();
  for (const r of nomina.registros) {
    for (const c of r.conceptos) {
      const def = catalogo.get(c.codigo);
      if (!def || !def.clasificado) sinClasificar.add(c.codigo);
    }
  }

  // ── Cuadre global ──
  const sumaBruto = sumar(nomina.registros.map((r) => sumaConceptos(r, 'pago')));
  const sumaDeduccion = sumar(nomina.registros.map((r) => sumaConceptos(r, 'deduccion')));
  const sumaNeto = sumaBruto - sumaDeduccion;

  if (nomina.totalGeneral) {
    comparar(
      hallazgos,
      'total-general-bruto',
      'La suma de los pagos no coincide con el Total General del PDF',
      nomina.totalGeneral.bruto,
      sumaBruto,
    );
    comparar(
      hallazgos,
      'total-general-deduccion',
      'La suma de las deducciones no coincide con el Total General del PDF',
      nomina.totalGeneral.deduccion,
      sumaDeduccion,
    );
    comparar(
      hallazgos,
      'total-general-neto',
      'La suma de los netos no coincide con el Total General del PDF',
      nomina.totalGeneral.neto,
      sumaNeto,
    );
  } else if (nomina.totalesFabrica.length > 0) {
    // El reporte de rutas no imprime «Total General»; en ese caso el contraste
    // se hace contra la suma de los totales por fábrica.
    const fbBruto = sumar(nomina.totalesFabrica.map((t) => t.bruto ?? 0));
    const fbDed = sumar(nomina.totalesFabrica.map((t) => t.deduccion ?? 0));
    const fbNeto = sumar(nomina.totalesFabrica.map((t) => t.neto ?? 0));
    comparar(hallazgos, 'total-fabricas-bruto', 'La suma de los pagos no coincide con los totales por fábrica', fbBruto, sumaBruto);
    comparar(hallazgos, 'total-fabricas-deduccion', 'La suma de las deducciones no coincide con los totales por fábrica', fbDed, sumaDeduccion);
    comparar(hallazgos, 'total-fabricas-neto', 'La suma de los netos no coincide con los totales por fábrica', fbNeto, sumaNeto);
  } else {
    hallazgos.push({
      nivel: 'aviso',
      codigo: 'sin-total-declarado',
      mensaje:
        'El PDF no trae «Total General» ni «Total Fábrica», así que no hay contra qué contrastar el cuadre global.',
    });
  }

  if (nomina.registros.length === 0) {
    hallazgos.push({
      nivel: 'error',
      codigo: 'sin-registros',
      mensaje: 'No se detectó ningún proveedor en el PDF.',
    });
  }

  for (const codigo of sinClasificar) {
    hallazgos.push({
      nivel: 'error',
      codigo: 'concepto-sin-clasificar',
      mensaje: `El código de concepto ${codigo} no está clasificado en el catálogo. Clasifícalo antes de guardar la nómina.`,
      obtenido: codigo,
    });
  }

  const resumen = {
    registros: porRegistro.length,
    ok: porRegistro.filter((v) => v.nivel === 'ok').length,
    avisos: porRegistro.filter((v) => v.nivel === 'aviso').length,
    errores: porRegistro.filter((v) => v.nivel === 'error').length,
  };

  const nivel = peorNivel([
    ...hallazgos.map((h) => h.nivel),
    ...porRegistro.map((v) => v.nivel),
  ]);

  return { nivel, hallazgos, porRegistro, codigosSinClasificar: [...sinClasificar], resumen };
}

export function validarRegistro(
  r: RegistroLeido,
  catalogo: Map<string, ConceptoCatalogo>,
): ValidacionRegistro {
  const hallazgos: Hallazgo[] = [];

  if (r.conceptos.length === 0) {
    hallazgos.push({
      nivel: 'error',
      codigo: 'sin-conceptos',
      mensaje: 'No se leyó ningún concepto de pago para este proveedor.',
    });
  }

  const bruto = sumaConceptos(r, 'pago');
  const deducciones = sumaConceptos(r, 'deduccion');
  const neto = bruto - deducciones;

  // El PDF puede omitir la celda de deducción cuando vale cero.
  const deduccionPdf = r.deduccionPdf ?? (deducciones === 0 ? 0 : null);

  comparar(hallazgos, 'bruto-no-cuadra', 'La suma de los pagos no coincide con el bruto impreso', r.brutoPdf, bruto);
  comparar(hallazgos, 'deduccion-no-cuadra', 'La suma de las deducciones no coincide con la deducción impresa', deduccionPdf, deducciones);
  comparar(hallazgos, 'neto-no-cuadra', 'Bruto menos deducciones no coincide con el neto impreso', r.netoPdf, neto);

  // Litros: la suma de los días debe dar el total de la semana.
  if (r.litrosTotal !== null && r.litrosDia.length > 0) {
    const suma = r.litrosDia.reduce((a, d) => a + d.litros, 0);
    if (suma !== r.litrosTotal) {
      hallazgos.push({
        nivel: 'aviso',
        codigo: 'litros-no-cuadran',
        mensaje: 'La suma de los litros diarios no coincide con el total de la semana',
        esperado: formatearEntero(r.litrosTotal),
        obtenido: formatearEntero(suma),
      });
    }
  }

  // La columna del PDF y la clase del catálogo deben decir lo mismo.
  for (const c of r.conceptos) {
    const def = catalogo.get(c.codigo);
    if (def && def.clasificado && def.clase !== c.columna) {
      hallazgos.push({
        nivel: 'aviso',
        codigo: 'clase-discrepante',
        mensaje: `El concepto ${c.codigo} está en el catálogo como «${def.clase}» pero el PDF lo trae en la columna de ${c.columna}.`,
      });
    }
  }

  return { nivel: peorNivel(hallazgos.map((h) => h.nivel)), hallazgos };
}

// ─────────────────────────────────────────────────────────────

export function sumaConceptos(r: RegistroLeido, columna: 'pago' | 'deduccion'): number {
  return r.conceptos.reduce((a, c) => (c.columna === columna ? a + c.centimos : a), 0);
}

function sumar(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}

/**
 * Compara un valor declarado por el PDF contra el calculado. Al trabajar en
 * céntimos enteros la comparación es exacta y no necesita tolerancia.
 */
function comparar(
  destino: Hallazgo[],
  codigo: string,
  mensaje: string,
  declarado: number | null,
  calculado: number,
): void {
  if (declarado === null) {
    destino.push({
      nivel: 'aviso',
      codigo: `${codigo}-ausente`,
      mensaje: `${mensaje}: el PDF no imprime ese total, no hay contra qué contrastar.`,
      obtenido: formatearBs(calculado),
    });
    return;
  }
  if (declarado !== calculado) {
    destino.push({
      nivel: 'error',
      codigo,
      mensaje,
      esperado: formatearBs(declarado),
      obtenido: formatearBs(calculado),
    });
  }
}

export function peorNivel(niveles: NivelValidacion[]): NivelValidacion {
  if (niveles.includes('error')) return 'error';
  if (niveles.includes('aviso')) return 'aviso';
  return 'ok';
}
