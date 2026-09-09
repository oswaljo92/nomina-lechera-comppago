import { calcularRegistro, resolverNotaDebito } from '../calc/calcular.ts';
import type {
  ConceptoManual,
  NotaDebitoAgrupada,
  ParametrosNotaDebito,
  RegistroLeido,
} from '../types.ts';
import { folioDe, type ContextoComprobante, type DatosComprobante } from './comprobante.ts';

export interface MiembroAgrupado {
  registro: RegistroLeido;
  manuales: ConceptoManual[];
  paramsNd: ParametrosNotaDebito | null;
  ctx: ContextoComprobante;
}

/**
 * Comprobante único para 2+ códigos del MISMO tipo (ej. dos rutas de
 * transporte, o dos códigos de leche) que son en realidad el mismo
 * proveedor: cada código calcula su propia nota de débito de forma
 * independiente y se suman en un solo total, con el desglose por código
 * disponible para el dibujo. Mecanismo separado e independiente del
 * combinado leche+flete de `comprobanteCombinado.ts` — nunca se mezclan.
 */
export function construirComprobanteAgrupado(
  miembros: MiembroAgrupado[],
  principalCodigo: string,
): DatosComprobante {
  if (miembros.length < 2) {
    throw new Error('Un comprobante agrupado necesita al menos 2 miembros.');
  }
  const principal = miembros.find((m) => m.registro.codigo === principalCodigo) ?? miembros[0]!;

  const calculados = miembros.map((m) => ({
    m,
    calc: calcularRegistro(m.registro, m.ctx.catalogo, m.manuales, null),
    nd: resolverNotaDebito(
      m.registro.codigo,
      m.paramsNd,
      m.registro.litrosTotal,
      m.ctx.fechaIni,
      m.ctx.tasas,
      m.ctx.ndImportada,
    ),
  }));

  const notaDebitoAgrupada: NotaDebitoAgrupada | undefined = calculados.some((c) => c.nd)
    ? {
        aplica: calculados.some((c) => c.nd?.aplica),
        centimos: calculados.reduce((a, c) => a + (c.nd?.aplica ? c.nd.centimos : 0), 0),
        porCodigo: calculados.map((c) => ({ codigo: c.m.registro.codigo, resultado: c.nd })),
      }
    : undefined;

  const litrosTotal = calculados.some((c) => c.m.registro.litrosTotal !== null)
    ? calculados.reduce((a, c) => a + (c.m.registro.litrosTotal ?? 0), 0)
    : null;

  return {
    folio: folioDe(
      principal.ctx.anio,
      principal.ctx.numero,
      miembros.map((m) => m.registro.codigo).join('+'),
    ),
    empresa: principal.ctx.empresaPorFabrica(principal.registro.fabricaCod),
    titulo: principal.ctx.titulo,
    tipo: principal.ctx.tipo,
    anio: principal.ctx.anio,
    numero: principal.ctx.numero,
    fechaIni: principal.ctx.fechaIni,
    fechaFin: principal.ctx.fechaFin,
    fechaFactura: principal.ctx.fechaFactura,
    fabricaCod: principal.registro.fabricaCod,
    fabricaNom: principal.registro.fabricaNom,
    proveedor: {
      nombre: principal.ctx.nombreCompleto(principal.registro.codigo) ?? principal.registro.nombre,
      codigo: principal.registro.codigo,
      ruta: principal.registro.ruta,
      cedula: principal.registro.cedula,
      rif: principal.registro.rif,
      banco: principal.registro.banco,
      cuenta: principal.registro.cuenta,
    },
    litrosTotal,
    litrosDia: miembros.flatMap((m) => m.registro.litrosDia),
    pagos: calculados.flatMap((c) =>
      c.calc.lineas
        .filter((l) => l.clase === 'pago')
        .map((l) => ({ ...l, origenCodigo: c.m.registro.codigo })),
    ),
    deducciones: calculados.flatMap((c) =>
      c.calc.lineas
        .filter((l) => l.clase === 'deduccion')
        .map((l) => ({ ...l, origenCodigo: c.m.registro.codigo })),
    ),
    bruto: calculados.reduce((a, c) => a + c.calc.bruto, 0),
    totalDeducciones: calculados.reduce((a, c) => a + c.calc.deducciones, 0),
    neto: calculados.reduce((a, c) => a + c.calc.neto, 0),
    totalFacturar: calculados.reduce((a, c) => a + c.calc.totalFacturar, 0),
    manuales: miembros.flatMap((m) => m.manuales),
    notaDebito: null,
    notaDebitoAgrupada,
    agrupado: {
      tipo: principal.ctx.tipo,
      miembros: miembros.map((m) => ({
        codigo: m.registro.codigo,
        ruta: m.registro.ruta,
        fabricaCod: m.registro.fabricaCod,
        fabricaNom: m.registro.fabricaNom,
      })),
    },
  };
}
