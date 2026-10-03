import { calcularRegistro, resolverNotaDebito } from '../calc/calcular.ts';
import type {
  ConceptoCatalogo,
  ConceptoManual,
  Empresa,
  LineaConcepto,
  LitrosDia,
  NotaDebitoAgrupada,
  NotaDebitoCombinada,
  ParametrosNotaDebito,
  RegistroLeido,
  ResultadoNotaDebito,
  TipoNomina,
  NdImportadaResumen,
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
  /** Fecha de factura configurada en "Fechas del documento", independiente
   * de si hay nota de débito aplicable — siempre visible en la factura. */
  fechaFactura: string;
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
  /** Solo presentes en un comprobante combinado (leche + flete). */
  notaDebitoCombinada?: NotaDebitoCombinada;
  combinado?: {
    leche: { codigo: string; ruta: string; fabricaCod: string; fabricaNom: string };
    transporte: { codigo: string; ruta: string; fabricaCod: string; fabricaNom: string };
  };
  /** Solo presente en un comprobante agrupado (2+ códigos del mismo tipo).
   * Mutuamente excluyente con `combinado`. */
  notaDebitoAgrupada?: NotaDebitoAgrupada;
  agrupado?: {
    tipo: TipoNomina;
    miembros: Array<{ codigo: string; ruta: string; fabricaCod: string; fabricaNom: string }>;
  };
}

export interface ContextoComprobante {
  catalogo: Map<string, ConceptoCatalogo>;
  empresaPorFabrica: (fabricaCod: string) => Empresa | null;
  nombreCompleto: (codigo: string) => string | undefined;
  tasas: Map<string, number>;
  /** Código de registro -> nota de débito importada de Excel (si existe),
   * que reemplaza el cálculo por tasas para ese código. Vacío en la
   * mayoría de las nóminas. */
  ndImportada: Map<string, NdImportadaResumen>;
  /** Fecha de factura configurada en "Fechas del documento" para esta
   * nómina — se imprime en la factura siempre, tenga o no ND aplicable. */
  fechaFactura: string;
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

  const notaDebito: ResultadoNotaDebito | null = resolverNotaDebito(
    registro.codigo,
    paramsNd,
    registro.litrosTotal,
    ctx.fechaIni,
    ctx.tasas,
    ctx.ndImportada,
  );

  return {
    folio: folioDe(ctx.anio, ctx.numero, registro.codigo),
    empresa: ctx.empresaPorFabrica(registro.fabricaCod),
    titulo: ctx.titulo,
    tipo: ctx.tipo,
    anio: ctx.anio,
    numero: ctx.numero,
    fechaIni: ctx.fechaIni,
    fechaFin: ctx.fechaFin,
    fechaFactura: ctx.fechaFactura,
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
