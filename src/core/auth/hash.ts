/**
 * Primitivas criptográficas, todas sobre WebCrypto.
 *
 * Se usa WebCrypto y no una librería porque está disponible tal cual en el
 * navegador y en Electron, así que la versión web y la de escritorio derivan
 * exactamente el mismo hash y una base de datos creada en una abre en la otra.
 */

/** PBKDF2 con este número de iteraciones para la clave de administrador. */
export const ITERACIONES_PBKDF2 = 600_000;

const codificador = new TextEncoder();

export function bytesAHex(bytes: Uint8Array): string {
  let salida = '';
  for (const b of bytes) salida += b.toString(16).padStart(2, '0');
  return salida;
}

export async function sha256Hex(texto: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', codificador.encode(texto));
  return bytesAHex(new Uint8Array(buffer));
}

export function generarSaltHex(bytes = 16): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return bytesAHex(b);
}

export async function derivarPbkdf2(
  clave: string,
  saltHex: string,
  iteraciones = ITERACIONES_PBKDF2,
): Promise<string> {
  const material = await crypto.subtle.importKey(
    'raw',
    codificador.encode(clave),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: codificador.encode(saltHex),
      iterations: iteraciones,
      hash: 'SHA-256',
    },
    material,
    256,
  );
  return bytesAHex(new Uint8Array(bits));
}

/**
 * Comparación en tiempo constante. Con un hash local el riesgo de un ataque de
 * temporización es teórico, pero el coste de hacerlo bien es una línea.
 */
export function igualesEnTiempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

export async function verificarClave(
  clave: string,
  saltHex: string,
  iteraciones: number,
  hashEsperado: string,
): Promise<boolean> {
  const hash = await derivarPbkdf2(clave, saltHex, iteraciones);
  return igualesEnTiempoConstante(hash, hashEsperado);
}

/**
 * Código de recuperación de un solo uso, en grupos de cuatro para poder
 * copiarlo a mano sin error. Se omiten las letras y dígitos que se confunden
 * al leerlos (I, O, 0, 1).
 */
export function generarCodigoRecuperacion(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const letras = [...bytes].map((b) => alfabeto[b % alfabeto.length]);
  const grupos: string[] = [];
  for (let i = 0; i < letras.length; i += 4) grupos.push(letras.slice(i, i + 4).join(''));
  return grupos.join('-');
}

/** Identificador único para filas nuevas. */
export function nuevoId(prefijo = ''): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return `${prefijo}${Date.now().toString(36)}${bytesAHex(b)}`;
}

/** SHA-256 de un archivo, para detectar que una nómina ya se cargó. */
export async function sha256DeBytes(bytes: Uint8Array): Promise<string> {
  const copia = new Uint8Array(bytes);
  const buffer = await crypto.subtle.digest('SHA-256', copia);
  return bytesAHex(new Uint8Array(buffer));
}
