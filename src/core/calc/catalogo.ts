import type { ConceptoCatalogo } from '../types.ts';

/**
 * Catálogo inicial de conceptos.
 *
 * `restaFacturacion` es la regla de negocio central del TOTAL A FACTURAR:
 *
 *   TOTAL A FACTURAR = Bruto − Σ deducciones con restaFacturacion = true
 *
 * El ISLR queda deliberadamente en `false`. Es una retención, no un descuento:
 * el proveedor factura el monto completo y la empresa le retiene el impuesto,
 * de modo que el ISLR no reduce lo que hay que facturar.
 *
 * El 0999 aparece en los reportes reales pero su significado no está
 * confirmado, así que se entrega SIN clasificar a propósito: la aplicación se
 * niega a guardar una nómina que lo contenga hasta que un administrador diga
 * qué es y si descuenta de la facturación.
 */
export const CATALOGO_INICIAL: ConceptoCatalogo[] = [
  { codigo: '0003', nombre: 'Flete', clase: 'pago', restaFacturacion: false, clasificado: true },
  { codigo: '0039', nombre: 'Leche Fresca', clase: 'pago', restaFacturacion: false, clasificado: true },
  { codigo: '0051', nombre: 'Insumos Ganaderos', clase: 'deduccion', restaFacturacion: true, clasificado: true },
  { codigo: '0090', nombre: 'Faltante', clase: 'deduccion', restaFacturacion: true, clasificado: true },
  { codigo: '0092', nombre: 'Agua Transporte', clase: 'deduccion', restaFacturacion: true, clasificado: true },
  { codigo: '0486', nombre: 'ISLR', clase: 'deduccion', restaFacturacion: false, clasificado: true },
  { codigo: '0487', nombre: 'ISLR', clase: 'deduccion', restaFacturacion: false, clasificado: true },
  { codigo: '0999', nombre: 'Sin clasificar', clase: 'deduccion', restaFacturacion: false, clasificado: false },
];

export function catalogoComoMapa(lista: ConceptoCatalogo[]): Map<string, ConceptoCatalogo> {
  return new Map(lista.map((c) => [c.codigo, c]));
}

/** Definición provisional para un código que el PDF trae y el catálogo no. */
export function conceptoProvisional(codigo: string, clase: 'pago' | 'deduccion'): ConceptoCatalogo {
  return { codigo, nombre: 'Sin clasificar', clase, restaFacturacion: false, clasificado: false };
}
