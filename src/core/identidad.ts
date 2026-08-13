/**
 * Normalización de RIF/cédula para comparar la identidad de un proveedor
 * entre los dos reportes (leche y transporte), que no comparten ningún
 * código de proveedor en común.
 */

/** Letra de tipo de documento venezolano al inicio (V, E, J, P, G). */
const LETRA_DOC = /^[VEJPG]/;

/**
 * Solo los dígitos del documento, sin la letra de tipo ni separadores. Es la
 * clave de emparejamiento: 'V-17771173', '17771173' y 'V17771173' colapsan
 * al mismo valor '17771173'. Devuelve null si quedan muy pocos dígitos como
 * para ser un documento real (evita falsos positivos).
 */
export function digitosDocumento(doc: string | null): string | null {
  if (!doc) return null;
  const limpio = doc.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const sinLetra = limpio.replace(LETRA_DOC, '');
  return sinLetra.length >= 6 ? sinLetra : null;
}
