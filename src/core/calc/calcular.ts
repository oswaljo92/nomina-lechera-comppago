import { validarRegistro } from '../parser/validar.ts';
import { fechaAMostrar } from '../parser/numeros.ts';
import { conceptoProvisional } from './catalogo.ts';
import type {
  ConceptoCatalogo,
  ConceptoManual,
  LineaConcepto,
  ParametrosNotaDebito,
  RegistroCalculado,
  RegistroLeido,
  ResultadoNotaDebito,
  TasaBcv,
} from '../types.ts';

/**
 * Motor de cálculo. Todo lo que el comprobante muestra sale de aquí.
 *
 *   BRUTO             = Σ conceptos de clase «pago»
 *   DEDUCCIONES       = Σ conceptos de clase «deducción»
 *   NETO A PAGAR      = Bruto − Deducciones + Σ manuales con efecto
 *   TOTAL A FACTURAR  = Bruto − Σ deducciones marcadas «restaFacturacion» + Σ manuales con efecto
 *
 * Bruto y Deducciones nunca incluyen conceptos manuales: siempre reflejan
 * solo lo impreso en el PDF, para no romper el cuadre contra el PDF que se
 * hace al cargar la nómina. Un concepto manual sin `efecto` (el valor por
 * defecto) sigue siendo puramente informativo, como siempre.
 */
export function calcularRegistro(
  registro: RegistroLeido,
  catalogo: Map<string, ConceptoCatalogo>,
  manuales: ConceptoManual[],
  notaDebito: ResultadoNotaDebito | null,
): RegistroCalculado {
  const lineas: LineaConcepto[] = registro.conceptos.map((c) => {
    const def = catalogo.get(c.codigo) ?? conceptoProvisional(c.codigo, c.columna);
    return {
      codigo: c.codigo,
      nombre: def.nombre,
      clase: def.clase,
      restaFacturacion: def.restaFacturacion,
      centimos: c.centimos,
    };
  });

  let bruto = 0;
  let deducciones = 0;
  let restaDeFacturacion = 0;

  for (const l of lineas) {
    if (l.clase === 'pago') {
      bruto += l.centimos;
    } else {
      deducciones += l.centimos;
      if (l.restaFacturacion) restaDeFacturacion += l.centimos;
    }
  }

  const ajusteManual = manuales.reduce(
    (acc, m) => acc + (m.efecto === 'suma' ? m.centimos : m.efecto === 'resta' ? -m.centimos : 0),
    0,
  );

  return {
    registro,
    lineas,
    bruto,
    deducciones,
    neto: bruto - deducciones + ajusteManual,
    totalFacturar: bruto - restaDeFacturacion + ajusteManual,
    manuales,
    notaDebito,
    validacion: validarRegistro(registro, catalogo),
  };
}

// ─────────────────────────────────────────────────────────────
// Nota de débito por diferencial cambiario
// ─────────────────────────────────────────────────────────────

/**
 *   NOTA DE DÉBITO = litros × precio $/L × ( tasa[fecha elegida] − tasa[inicio de semana] )
 *
 * El orden de la resta es deliberado: da positivo cuando la tasa sube, que es
 * el caso normal, y negativo en el caso contrario. Si falta la tasa de alguna
 * de las dos fechas no se calcula nada: se devuelve el motivo para que la
 * interfaz lo muestre en rojo y el usuario cargue la tasa que falta.
 */
export function calcularNotaDebito(
  params: ParametrosNotaDebito,
  litros: number | null,
  fechaIniSemana: string,
  tasas: Map<string, number>,
): ResultadoNotaDebito {
  const fechaTasaFin = params.fechaCalculo === 'factura' ? params.fechaFactura : params.fechaNota;

  const faltantes: string[] = [];
  const tasaIni = tasas.get(fechaIniSemana);
  const tasaFin = tasas.get(fechaTasaFin);
  if (tasaIni === undefined) faltantes.push(fechaIniSemana);
  if (tasaFin === undefined) faltantes.push(fechaTasaFin);

  if (faltantes.length > 0) {
    const lista = faltantes.map(fechaAMostrar).join(' y ');
    return {
      aplica: false,
      motivo: `Falta la tasa del BCV del ${lista}. Cárgala en la sección Tasas BCV para poder calcular.`,
      fechasFaltantes: faltantes,
    };
  }

  if (litros === null || litros <= 0) {
    return {
      aplica: false,
      motivo: 'El proveedor no tiene litros en esta nómina, así que no hay base sobre la cual calcular.',
      fechasFaltantes: [],
    };
  }

  if (!Number.isFinite(params.precioUsd) || params.precioUsd <= 0) {
    return {
      aplica: false,
      motivo: 'Falta indicar el precio de la leche en dólares por litro.',
      fechasFaltantes: [],
    };
  }

  const diferenciaTasa = tasaFin! - tasaIni!;
  const montoUsd = litros * params.precioUsd;

  return {
    aplica: true,
    precioUsd: params.precioUsd,
    litrosBase: litros,
    fechaFactura: params.fechaFactura,
    fechaNota: params.fechaNota,
    fechaCalculo: params.fechaCalculo,
    fechaTasaIni: fechaIniSemana,
    fechaTasaFin,
    tasaIni: tasaIni!,
    tasaFin: tasaFin!,
    diferenciaTasa,
    montoUsd,
    // Redondeada hacia arriba (nunca al más cercano), incluso si el monto
    // fuera negativo: es la decisión explícita para la nota de débito.
    centimos: Math.ceil(montoUsd * diferenciaTasa * 100),
  };
}

/**
 * Igual que `calcularNotaDebito`, pero si el código tiene una nota de débito
 * importada de Excel (ver `notas_debito_importadas`), ESA gana de forma
 * incondicional — sin mirar tasas/params/litros. No hay alternancia por
 * proveedor: es automático en cuanto el import queda emparejado.
 */
export function resolverNotaDebito(
  codigo: string,
  params: ParametrosNotaDebito | null,
  litros: number | null,
  fechaIniSemana: string,
  tasas: Map<string, number>,
  ndImportada: Map<string, { centimos: number; fechaNota: string }>,
): ResultadoNotaDebito | null {
  const importada = ndImportada.get(codigo);
  if (importada) {
    return {
      aplica: true,
      origen: 'importado',
      precioUsd: 0,
      litrosBase: litros ?? 0,
      fechaFactura: params?.fechaFactura ?? importada.fechaNota,
      fechaNota: importada.fechaNota,
      fechaCalculo: params?.fechaCalculo ?? 'nota',
      fechaTasaFin: '',
      fechaTasaIni: '',
      tasaIni: 0,
      tasaFin: 0,
      diferenciaTasa: 0,
      montoUsd: 0,
      centimos: importada.centimos,
    };
  }
  return params ? calcularNotaDebito(params, litros, fechaIniSemana, tasas) : null;
}

// ─────────────────────────────────────────────────────────────
// Conversión del precio de la leche
// ─────────────────────────────────────────────────────────────

/** Bolívares por litro -> dólares por litro, a la tasa dada. */
export function bsAUsd(bs: number, tasa: number): number {
  if (!Number.isFinite(bs) || !Number.isFinite(tasa) || tasa <= 0) return 0;
  return bs / tasa;
}

/** Dólares por litro -> bolívares por litro, a la tasa dada. */
export function usdABs(usd: number, tasa: number): number {
  if (!Number.isFinite(usd) || !Number.isFinite(tasa) || tasa <= 0) return 0;
  return usd * tasa;
}

export function tasasComoMapa(tasas: TasaBcv[]): Map<string, number> {
  return new Map(tasas.map((t) => [t.fecha, t.tasa]));
}
