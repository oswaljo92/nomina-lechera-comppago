import { calcularNotaDebito, calcularRegistro } from '../calc/calcular.ts';
import type {
  ConceptoManual,
  NotaDebitoCombinada,
  ParametrosNotaDebito,
  RegistroLeido,
} from '../types.ts';
import { folioDe, type ContextoComprobante, type DatosComprobante } from './comprobante.ts';

/**
 * Comprobante único para un proveedor que es a la vez ganadero (leche) y
 * transportista (flete) de la misma semana ganadera. Cada lado calcula su
 * propia nota de débito con sus propios litros/precio/fechas —son
 * configuraciones independientes por registro— y se muestra un solo monto
 * sumado, nunca dos secciones de ND separadas.
 */
export function construirComprobanteCombinado(
  registroLeche: RegistroLeido,
  manualesLeche: ConceptoManual[],
  paramsNdLeche: ParametrosNotaDebito | null,
  ctxLeche: ContextoComprobante,
  registroTransporte: RegistroLeido,
  manualesTransporte: ConceptoManual[],
  paramsNdTransporte: ParametrosNotaDebito | null,
  ctxTransporte: ContextoComprobante,
): DatosComprobante {
  const calcLeche = calcularRegistro(registroLeche, ctxLeche.catalogo, manualesLeche, null);
  const calcTransporte = calcularRegistro(
    registroTransporte,
    ctxTransporte.catalogo,
    manualesTransporte,
    null,
  );

  const ndLeche = paramsNdLeche
    ? calcularNotaDebito(paramsNdLeche, registroLeche.litrosTotal, ctxLeche.fechaIni, ctxLeche.tasas)
    : null;
  const ndTransporte = paramsNdTransporte
    ? calcularNotaDebito(
        paramsNdTransporte,
        registroTransporte.litrosTotal,
        ctxTransporte.fechaIni,
        ctxTransporte.tasas,
      )
    : null;

  const notaDebitoCombinada: NotaDebitoCombinada | undefined =
    ndLeche || ndTransporte
      ? {
          aplica: Boolean(ndLeche?.aplica) || Boolean(ndTransporte?.aplica),
          centimos:
            (ndLeche?.aplica ? ndLeche.centimos : 0) + (ndTransporte?.aplica ? ndTransporte.centimos : 0),
          leche: ndLeche,
          transporte: ndTransporte,
        }
      : undefined;

  return {
    folio: folioDe(ctxLeche.anio, ctxLeche.numero, `${registroLeche.codigo}+${registroTransporte.codigo}`),
    empresa: ctxLeche.empresaPorFabrica(registroLeche.fabricaCod),
    titulo: 'PAGO DE LECHE FRESCA + NÓMINA DE RUTAS',
    tipo: 'leche',
    anio: ctxLeche.anio,
    numero: ctxLeche.numero,
    fechaIni: ctxLeche.fechaIni,
    fechaFin: ctxLeche.fechaFin,
    fabricaCod: registroLeche.fabricaCod,
    fabricaNom: registroLeche.fabricaNom,
    proveedor: {
      nombre: ctxLeche.nombreCompleto(registroLeche.codigo) ?? registroLeche.nombre,
      codigo: registroLeche.codigo,
      ruta: registroLeche.ruta,
      cedula: registroLeche.cedula ?? registroTransporte.cedula,
      rif: registroLeche.rif ?? registroTransporte.rif,
      banco: registroLeche.banco,
      cuenta: registroLeche.cuenta,
    },
    litrosTotal: registroLeche.litrosTotal,
    litrosDia: registroLeche.litrosDia,
    pagos: [
      ...calcLeche.lineas.filter((l) => l.clase === 'pago').map((l) => ({ ...l, origen: 'leche' as const })),
      ...calcTransporte.lineas
        .filter((l) => l.clase === 'pago')
        .map((l) => ({ ...l, origen: 'flete' as const })),
    ],
    deducciones: [
      ...calcLeche.lineas
        .filter((l) => l.clase === 'deduccion')
        .map((l) => ({ ...l, origen: 'leche' as const })),
      ...calcTransporte.lineas
        .filter((l) => l.clase === 'deduccion')
        .map((l) => ({ ...l, origen: 'flete' as const })),
    ],
    bruto: calcLeche.bruto + calcTransporte.bruto,
    totalDeducciones: calcLeche.deducciones + calcTransporte.deducciones,
    neto: calcLeche.neto + calcTransporte.neto,
    totalFacturar: calcLeche.totalFacturar + calcTransporte.totalFacturar,
    manuales: [...manualesLeche, ...manualesTransporte],
    notaDebito: null,
    notaDebitoCombinada,
    combinado: {
      leche: {
        codigo: registroLeche.codigo,
        ruta: registroLeche.ruta,
        fabricaCod: registroLeche.fabricaCod,
        fabricaNom: registroLeche.fabricaNom,
      },
      transporte: {
        codigo: registroTransporte.codigo,
        ruta: registroTransporte.ruta,
        fabricaCod: registroTransporte.fabricaCod,
        fabricaNom: registroTransporte.fabricaNom,
      },
    },
  };
}
