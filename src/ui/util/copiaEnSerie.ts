import type { Plataforma } from '../../platform/tipos.ts';

/**
 * Pausa entre una copia y la siguiente. El Historial del portapapeles de
 * Windows (Win + V) guarda cada contenido nuevo como una entrada aparte,
 * pero si dos llegan casi juntos puede quedarse solo con el último. Con
 * ~1 s entre copias se probó en Windows 11 que guarda todas, incluso
 * imágenes del tamaño real del comprobante.
 */
const PAUSA_MS = 900;

export interface ElementoACopiar {
  /** Lo que se copia: texto, o una imagen PNG. */
  obtener: () => Promise<string | Blob>;
}

/**
 * Copia los elementos uno por uno al portapapeles para que cada uno quede
 * como una entrada separada del historial de Windows (Win + V) y se pueda
 * pegar individualmente, p. ej. en WhatsApp. Se copian en orden inverso: así
 * en Win + V (que muestra lo más reciente arriba) quedan en el mismo orden
 * que en la tabla, y el primero de la tabla es además lo que pega Ctrl + V.
 */
export async function copiarEnSerie(
  plataforma: Plataforma,
  elementos: ElementoACopiar[],
  alAvanzar?: (hechos: number, total: number) => void,
): Promise<void> {
  const enOrden = [...elementos].reverse();
  for (const [i, el] of enOrden.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, PAUSA_MS));
    const valor = await el.obtener();
    if (typeof valor === 'string') await plataforma.portapapeles.copiarTexto(valor);
    else await plataforma.portapapeles.copiarImagen(valor);
    alAvanzar?.(i + 1, enOrden.length);
  }
}

/** Texto para el aviso al terminar una copia de varias filas. */
export async function avisoCopiaMultiple(
  plataforma: Plataforma,
  cantidad: number,
  que: 'imágenes' | 'nombres',
): Promise<{ nivel: 'ok' | 'error'; texto: string }> {
  const historial = await plataforma.portapapeles.historialActivo();
  if (historial === false) {
    return {
      nivel: 'error',
      texto: `Se copiaron ${cantidad} ${que}, pero el Historial del portapapeles de Windows está apagado, así que solo quedó la última. Actívalo con Win + V → «Activar» y vuelve a presionar el atajo.`,
    };
  }
  return {
    nivel: 'ok',
    texto: `Se copiaron ${cantidad} ${que}. En WhatsApp presiona Win + V para elegir y pegar cada una por separado (Ctrl + V pega la primera de la tabla).`,
  };
}
