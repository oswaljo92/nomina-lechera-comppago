/** Tamaño máximo del logo ya redimensionado, en píxeles del lado mayor. */
const LADO_MAXIMO = 480;
/** Peso máximo del archivo original que se acepta. */
const BYTES_MAXIMOS = 4 * 1024 * 1024;

/**
 * Convierte una imagen a data-URI para guardarla dentro de la base.
 *
 * Se redimensiona antes de guardar: un logo de cámara de 4000px pesaría varios
 * megas, y esa base viaja completa en cada exportación y en cada respaldo.
 */
export async function leerImagenComoDataUrl(archivo: File): Promise<string> {
  if (!archivo.type.startsWith('image/')) {
    throw new Error('El archivo seleccionado no es una imagen.');
  }
  if (archivo.size > BYTES_MAXIMOS) {
    throw new Error('La imagen pesa más de 4 MB. Usa una versión más liviana.');
  }

  const bitmap = await createImageBitmap(archivo);
  try {
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
    const ancho = Math.max(1, Math.round(bitmap.width * escala));
    const alto = Math.max(1, Math.round(bitmap.height * escala));

    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext('2d');
    if (!ctx) throw new Error('El navegador no pudo procesar la imagen.');
    ctx.drawImage(bitmap, 0, 0, ancho, alto);

    // PNG conserva la transparencia, que es lo normal en un logo.
    return lienzo.toDataURL('image/png');
  } finally {
    bitmap.close();
  }
}
