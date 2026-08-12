import { calcularNotaDebito, calcularRegistro } from '../calc/calcular.ts';
import type {
  ConceptoCatalogo,
  ConceptoManual,
  Empresa,
  LineaConcepto,
  LitrosDia,
  ParametrosNotaDebito,
  RegistroLeido,
  ResultadoNotaDebito,
  TipoNomina,
} from '../types.ts';

/** Datos ya resueltos que el comprobante dibuja sin volver a calcular nada. */
export interface DatosComprobante {
  folio: string;
  empresa: Empresa | null;
  titulo: string;
  tipo: TipoNomina;
  anio: number;
  numero: number;
  fechaIni: string;
  fechaFin: string;
  fabricaCod: string;
  fabricaNom: string;
  proveedor: {
    nombre: string;
    codigo: string;
    ruta: string;
    cedula: string | null;
    rif: string | null;
    banco: string | null;
    cuenta: string | null;
  };
  litrosTotal: number | null;
  litrosDia: LitrosDia[];
  pagos: LineaConcepto[];
  deducciones: LineaConcepto[];
  bruto: number;
  totalDeducciones: number;
  neto: number;
  totalFacturar: number;
  manuales: ConceptoManual[];
  notaDebito: ResultadoNotaDebito | null;
}

export interface ContextoComprobante {
  catalogo: Map<string, ConceptoCatalogo>;
  empresaPorFabrica: (fabricaCod: string) => Empresa | null;
  nombreCompleto: (codigo: string) => string | undefined;
  tasas: Map<string, number>;
  titulo: string;
  tipo: TipoNomina;
  anio: number;
  numero: number;
  fechaIni: string;
  fechaFin: string;
}

/** `2026-23-008351` — identifica el comprobante de forma única y rastreable. */
export function folioDe(anio: number, numero: number, codigo: string): string {
  return `${anio}-${numero}-${codigo}`;
}

export function construirComprobante(
  registro: RegistroLeido,
  manuales: ConceptoManual[],
  paramsNd: ParametrosNotaDebito | null,
  ctx: ContextoComprobante,
): DatosComprobante {
  const calc = calcularRegistro(registro, ctx.catalogo, manuales, null);

  const notaDebito: ResultadoNotaDebito | null = paramsNd
    ? calcularNotaDebito(paramsNd, registro.litrosTotal, ctx.fechaIni, ctx.tasas)
    : null;

  return {
    folio: folioDe(ctx.anio, ctx.numero, registro.codigo),
    empresa: ctx.empresaPorFabrica(registro.fabricaCod),
    titulo: ctx.titulo,
    tipo: ctx.tipo,
    anio: ctx.anio,
    numero: ctx.numero,
    fechaIni: ctx.fechaIni,
    fechaFin: ctx.fechaFin,
    fabricaCod: registro.fabricaCod,
    fabricaNom: registro.fabricaNom,
    proveedor: {
      nombre: ctx.nombreCompleto(registro.codigo) ?? registro.nombre,
      codigo: registro.codigo,
      ruta: registro.ruta,
      cedula: registro.cedula,
      rif: registro.rif,
      banco: registro.banco,
      cuenta: registro.cuenta,
    },
    litrosTotal: registro.litrosTotal,
    litrosDia: registro.litrosDia,
    pagos: calc.lineas.filter((l) => l.clase === 'pago'),
    deducciones: calc.lineas.filter((l) => l.clase === 'deduccion'),
    bruto: calc.bruto,
    totalDeducciones: calc.deducciones,
    neto: calc.neto,
    totalFacturar: calc.totalFacturar,
    manuales,
    notaDebito,
  };
}
