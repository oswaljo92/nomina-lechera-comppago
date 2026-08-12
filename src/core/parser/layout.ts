/**
 * Reconstrucción de la tabla a partir de las coordenadas del PDF.
 *
 * Los reportes Gan0584 y Gan0594 no traen estructura de tabla: son cadenas de
 * texto posicionadas. Lo que sí tienen es una retícula de columnas en
 * posiciones X constantes.
 *
 * Las bandas de abajo salen de medir el borde IZQUIERDO real de cada celda en
 * los dos reportes completos, sin redondear. Importa insistir en «sin
 * redondear»: los montos van alineados a la derecha, de modo que su borde
 * izquierdo se corre según cuántos dígitos tengan, y las filas de «Total
 * Fábrica» usan una alineación unos 4pt distinta a la de los registros. Con
 * coordenadas redondeadas los rangos parecen limpios y en realidad se pisan.
 *
 *   columna      izquierdas observadas    banda
 *   nombre       22,5 – 68,5              [  0, 145)
 *   ruta        151,5                     [145, 178)
 *   gan         179   194,9               [178, 210)
 *   concepto    218   222,9               [210, 240)
 *   pago        262   – 275,0             [240, 315)
 *   deducción   334,4 – 347,0             [315, 372)
 *   neto        387,8 – 406,0             [372, 455)
 *   litros      461,0 – 721                [455,  ∞)
 *
 * Los huecos entre bandas son deliberados: dejan sitio para que un monto más
 * largo que los vistos hasta ahora se extienda hacia la izquierda sin caer en
 * la columna vecina.
 */

export interface ItemCrudo {
  str: string;
  /** transform[4] de pdf.js */
  x: number;
  /** transform[5] de pdf.js */
  y: number;
  width: number;
}

export interface ItemLayout {
  texto: string;
  x: number;
  ancho: number;
  /** Borde derecho; útil porque los montos están alineados a la derecha. */
  xFin: number;
}

export interface FilaLayout {
  y: number;
  items: ItemLayout[];
}

export interface PaginaLayout {
  numero: number;
  ancho: number;
  alto: number;
  filas: FilaLayout[];
}

export const BANDAS = {
  nombre: [0, 145],
  ruta: [145, 178],
  gan: [178, 210],
  concepto: [210, 240],
  pago: [240, 315],
  deduccion: [315, 372],
  neto: [372, 455],
  serie: [455, 10_000],
} as const;

export type NombreBanda = keyof typeof BANDAS;

export function enBanda(x: number, banda: NombreBanda): boolean {
  const [ini, fin] = BANDAS[banda];
  return x >= ini && x < fin;
}

export function itemsEn(fila: FilaLayout, banda: NombreBanda): ItemLayout[] {
  return fila.items.filter((i) => enBanda(i.x, banda));
}

export function primerEn(fila: FilaLayout, banda: NombreBanda): ItemLayout | null {
  return itemsEn(fila, banda)[0] ?? null;
}

/**
 * Agrupa los items en filas por su coordenada Y.
 *
 * La tolerancia es deliberadamente pequeña (2pt). En estos reportes hay líneas
 * separadas por solo 3pt —por ejemplo la fila de totales y la del banco, que
 * conviven a alturas 507 y 504—, así que una tolerancia mayor las fundiría en
 * una sola fila y mezclaría datos de conceptos distintos.
 */
export function construirFilas(items: ItemCrudo[], tolerancia = 2): FilaLayout[] {
  const utiles = items
    .filter((i) => i.str.trim().length > 0)
    .map((i) => ({ ...i, str: i.str.trim() }))
    .sort((a, b) => b.y - a.y);

  const filas: FilaLayout[] = [];
  for (const it of utiles) {
    const item: ItemLayout = {
      texto: it.str,
      x: it.x,
      ancho: it.width,
      xFin: it.x + it.width,
    };
    const ultima = filas[filas.length - 1];
    if (ultima && Math.abs(ultima.y - it.y) <= tolerancia) {
      ultima.items.push(item);
    } else {
      filas.push({ y: it.y, items: [item] });
    }
  }

  for (const f of filas) f.items.sort((a, b) => a.x - b.x);
  return filas;
}

/** Concatena el texto de una fila; solo para mensajes de diagnóstico. */
export function textoFila(fila: FilaLayout): string {
  return fila.items.map((i) => i.texto).join(' ');
}
