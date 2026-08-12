import type { BaseDatos, Fila } from './basedatos.ts';
import { sha256Hex } from '../auth/hash.ts';
import type { Autor, EntradaBitacora, VerificacionBitacora } from '../types.ts';

/** Hash previo de la primera entrada: no hay nada antes que ella. */
export const GENESIS = '0'.repeat(64);

/**
 * Bitácora encadenada.
 *
 * Cada entrada guarda el hash de la anterior y su propio hash calculado sobre
 * todos sus campos más ese enlace. Alterar o eliminar una línea invalida todas
 * las posteriores, y `verificarBitacora` lo señala con nombre y número.
 *
 * Alcance real: esto DETECTA manipulación, no la impide. Quien tenga el archivo
 * y conozca el algoritmo podría recalcular la cadena entera. Frente a la
 * amenaza que importa aquí —alguien borra algo y lo niega— es eficaz; para
 * cerrar el hueco por completo haría falta cifrar la base, que se descartó.
 */
function cadenaCanonica(e: Omit<EntradaBitacora, 'hash'>): string {
  return [
    e.id,
    e.ts,
    e.usuarioId,
    e.usuarioNombre,
    e.accion,
    e.entidad,
    e.entidadId,
    e.detalle,
    e.hashPrev,
  ].join(''); // separador de unidad: no puede aparecer en los campos
}

export async function registrarBitacora(
  db: BaseDatos,
  autor: Autor,
  accion: string,
  entidad: string,
  entidadId: string,
  detalle: Record<string, unknown> = {},
): Promise<EntradaBitacora> {
  const ultima = db.uno<Fila>('SELECT id, hash FROM bitacora ORDER BY id DESC LIMIT 1');
  const id = Number(ultima?.['id'] ?? 0) + 1;
  const hashPrev = typeof ultima?.['hash'] === 'string' ? ultima['hash'] : GENESIS;

  const parcial: Omit<EntradaBitacora, 'hash'> = {
    id,
    ts: new Date().toISOString(),
    usuarioId: autor.id,
    usuarioNombre: autor.nombre,
    accion,
    entidad,
    entidadId,
    detalle: JSON.stringify(detalle),
    hashPrev,
  };

  const hash = await sha256Hex(cadenaCanonica(parcial));

  db.correr(
    `INSERT INTO bitacora
       (id, ts, usuario_id, usuario_nombre, accion, entidad, entidad_id, detalle, hash_prev, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      parcial.id,
      parcial.ts,
      parcial.usuarioId,
      parcial.usuarioNombre,
      parcial.accion,
      parcial.entidad,
      parcial.entidadId,
      parcial.detalle,
      parcial.hashPrev,
      hash,
    ],
  );

  // Ancla: el hash de la última entrada y cuántas hay. Sin esto, truncar la
  // bitácora por el final la dejaría perfectamente encadenada y por tanto
  // indetectable, porque no quedaría ningún enlace colgando.
  db.fijarMeta('bitacora_ultimo_hash', hash);
  db.fijarMeta('bitacora_conteo', String(id));

  return { ...parcial, hash };
}

function aEntrada(f: Fila): EntradaBitacora {
  return {
    id: Number(f['id']),
    ts: String(f['ts']),
    usuarioId: String(f['usuario_id']),
    usuarioNombre: String(f['usuario_nombre']),
    accion: String(f['accion']),
    entidad: String(f['entidad']),
    entidadId: String(f['entidad_id']),
    detalle: String(f['detalle']),
    hashPrev: String(f['hash_prev']),
    hash: String(f['hash']),
  };
}

export function leerBitacora(db: BaseDatos, limite = 500, desplazamiento = 0): EntradaBitacora[] {
  return db
    .todos<Fila>('SELECT * FROM bitacora ORDER BY id DESC LIMIT ? OFFSET ?', [
      limite,
      desplazamiento,
    ])
    .map(aEntrada);
}

export function contarBitacora(db: BaseDatos): number {
  return Number(db.escalar('SELECT COUNT(*) FROM bitacora') ?? 0);
}

/** Recalcula la cadena completa y localiza la primera entrada que no cuadra. */
export async function verificarBitacora(db: BaseDatos): Promise<VerificacionBitacora> {
  const entradas = db.todos<Fila>('SELECT * FROM bitacora ORDER BY id ASC').map(aEntrada);
  const anclaHash = db.valorMeta('bitacora_ultimo_hash');
  const anclaConteo = Number(db.valorMeta('bitacora_conteo') ?? '0');

  if (entradas.length === 0) {
    if (anclaConteo > 0) {
      return {
        intacta: false,
        entradas: 0,
        rotaEn: 1,
        mensaje: `La bitácora está vacía pero debería tener ${anclaConteo} entradas: se borró completa.`,
      };
    }
    return { intacta: true, entradas: 0, rotaEn: null, mensaje: 'La bitácora está vacía.' };
  }

  let esperadoPrev = GENESIS;
  for (const e of entradas) {
    if (e.hashPrev !== esperadoPrev) {
      return {
        intacta: false,
        entradas: entradas.length,
        rotaEn: e.id,
        mensaje: `La cadena se rompe en la entrada ${e.id}: su enlace al hash anterior no corresponde. Se eliminó o alteró alguna entrada previa.`,
      };
    }
    const recalculado = await sha256Hex(cadenaCanonica(e));
    if (recalculado !== e.hash) {
      return {
        intacta: false,
        entradas: entradas.length,
        rotaEn: e.id,
        mensaje: `La entrada ${e.id} fue modificada: su contenido no corresponde con su hash.`,
      };
    }
    esperadoPrev = e.hash;
  }

  // La cadena enlaza bien, pero eso solo prueba que no se tocó por el medio.
  // El ancla es lo que delata que se cortó por el final.
  const ultima = entradas[entradas.length - 1]!;
  if (anclaHash !== null && ultima.hash !== anclaHash) {
    return {
      intacta: false,
      entradas: entradas.length,
      rotaEn: ultima.id,
      mensaje: `Faltan entradas al final: la bitácora termina en la ${ultima.id} pero el ancla registra ${anclaConteo} entradas. Se truncó el registro.`,
    };
  }

  return {
    intacta: true,
    entradas: entradas.length,
    rotaEn: null,
    mensaje: `Cadena íntegra: las ${entradas.length} entradas enlazan correctamente.`,
  };
}
