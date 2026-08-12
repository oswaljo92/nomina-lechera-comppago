import type { BaseDatos, Fila } from '../db/basedatos.ts';
import { registrarBitacora } from '../db/bitacora.ts';
import {
  ITERACIONES_PBKDF2,
  derivarPbkdf2,
  generarSaltHex,
  nuevoId,
  verificarClave,
} from './hash.ts';
import type { Autor, Rol, Usuario } from '../types.ts';

/**
 * Usuarios con credenciales propias.
 *
 * Cada persona tiene su contraseña; no existe una clave de administrador
 * compartida. Eso es lo que hace útil a la bitácora: mientras cualquiera podía
 * elegir el perfil de un colega, lo que quedaba anotado a su nombre no probaba
 * nada.
 *
 * De la contraseña solo se guarda su hash PBKDF2-SHA256 con 600 000
 * iteraciones y una sal distinta por usuario.
 */

/** Intentos fallidos permitidos antes de empezar a frenar. */
const INTENTOS_LIBRES = 5;
/** Espera base del freno, que se duplica con cada fallo posterior. */
const ESPERA_BASE_MS = 30_000;
const ESPERA_MAXIMA_MS = 15 * 60_000;

export function validarContrasena(clave: string): string | null {
  if (clave.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (!/[a-zA-Z]/.test(clave) || !/[0-9]/.test(clave)) {
    return 'La contraseña debe combinar letras y números.';
  }
  return null;
}

export function validarNombre(nombre: string): string | null {
  const limpio = nombre.trim();
  if (limpio.length < 2) return 'El nombre debe tener al menos 2 caracteres.';
  if (limpio.length > 40) return 'El nombre no puede pasar de 40 caracteres.';
  return null;
}

function aUsuario(f: Fila): Usuario {
  return {
    id: String(f['id']),
    nombre: String(f['nombre']),
    rol: String(f['rol']) === 'admin' ? 'admin' : 'normal',
    activo: Number(f['activo']) === 1,
    debeCambiar: Number(f['debe_cambiar']) === 1,
    intentosFallidos: Number(f['intentos_fallidos'] ?? 0),
    bloqueadoHasta: typeof f['bloqueado_hasta'] === 'string' ? f['bloqueado_hasta'] : null,
    creadoEn: String(f['creado_en']),
    ultimoAcceso: typeof f['ultimo_acceso'] === 'string' ? f['ultimo_acceso'] : null,
  };
}

// ─────────────────────────────────────────────────────────────
// Consultas
// ─────────────────────────────────────────────────────────────

export function listarUsuarios(db: BaseDatos): Usuario[] {
  return db
    .todos<Fila>('SELECT * FROM usuarios ORDER BY rol DESC, nombre COLLATE NOCASE')
    .map(aUsuario);
}

export function usuariosActivos(db: BaseDatos): Usuario[] {
  return listarUsuarios(db).filter((u) => u.activo);
}

export function obtenerUsuario(db: BaseDatos, id: string): Usuario | null {
  const f = db.uno<Fila>('SELECT * FROM usuarios WHERE id = ?', [id]);
  return f ? aUsuario(f) : null;
}

export function hayUsuarios(db: BaseDatos): boolean {
  return Number(db.escalar('SELECT COUNT(*) FROM usuarios') ?? 0) > 0;
}

/** Administradores activos. Es la cifra que protege del bloqueo total. */
export function contarAdministradores(db: BaseDatos): number {
  return Number(
    db.escalar("SELECT COUNT(*) FROM usuarios WHERE rol = 'admin' AND activo = 1") ?? 0,
  );
}

/**
 * Sin código de recuperación, el último administrador activo es el único que
 * puede repartir permisos. Si se le elimina, desactiva o degrada, nadie podría
 * volver a administrar la aplicación: por eso las tres operaciones se bloquean.
 */
function comprobarUltimoAdmin(db: BaseDatos, objetivo: Usuario, accion: string): void {
  if (objetivo.rol !== 'admin' || !objetivo.activo) return;
  if (contarAdministradores(db) > 1) return;
  throw new Error(
    `No puedes ${accion} al único administrador activo. Crea otro administrador antes, o el acceso administrativo se perdería para siempre.`,
  );
}

// ─────────────────────────────────────────────────────────────
// Alta y modificación
// ─────────────────────────────────────────────────────────────

export async function crearUsuario(
  db: BaseDatos,
  autor: Autor | null,
  datos: { nombre: string; rol: Rol; contrasena: string; debeCambiar?: boolean },
): Promise<Usuario> {
  const problemaNombre = validarNombre(datos.nombre);
  if (problemaNombre) throw new Error(problemaNombre);
  const problemaClave = validarContrasena(datos.contrasena);
  if (problemaClave) throw new Error(problemaClave);

  const nombre = datos.nombre.trim();
  const repetido = db.escalar('SELECT COUNT(*) FROM usuarios WHERE nombre = ? COLLATE NOCASE', [
    nombre,
  ]);
  if (Number(repetido) > 0) throw new Error(`Ya existe un usuario llamado «${nombre}».`);

  const salt = generarSaltHex();
  const hash = await derivarPbkdf2(datos.contrasena, salt, ITERACIONES_PBKDF2);
  const id = nuevoId('u_');
  const ahora = new Date().toISOString();

  db.correr(
    `INSERT INTO usuarios
       (id, nombre, rol, activo, hash, salt, iteraciones, debe_cambiar,
        intentos_fallidos, bloqueado_hasta, creado_por, creado_en, ultimo_acceso)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, 0, NULL, ?, ?, NULL)`,
    [
      id,
      nombre,
      datos.rol,
      hash,
      salt,
      ITERACIONES_PBKDF2,
      datos.debeCambiar ? 1 : 0,
      autor?.id ?? null,
      ahora,
    ],
  );

  const creado = obtenerUsuario(db, id)!;
  await registrarBitacora(db, autor ?? creado, 'crear-usuario', 'usuario', id, {
    nombre,
    rol: datos.rol,
  });
  return creado;
}

export async function cambiarRol(
  db: BaseDatos,
  autor: Autor,
  id: string,
  rol: Rol,
): Promise<void> {
  const objetivo = obtenerUsuario(db, id);
  if (!objetivo) throw new Error('Ese usuario ya no existe.');
  if (objetivo.rol === rol) return;
  if (rol === 'normal') comprobarUltimoAdmin(db, objetivo, 'quitarle el rol de administrador');

  db.correr('UPDATE usuarios SET rol = ? WHERE id = ?', [rol, id]);
  await registrarBitacora(db, autor, 'cambiar-rol', 'usuario', id, {
    nombre: objetivo.nombre,
    de: objetivo.rol,
    a: rol,
  });
}

export async function cambiarActivo(
  db: BaseDatos,
  autor: Autor,
  id: string,
  activo: boolean,
): Promise<void> {
  const objetivo = obtenerUsuario(db, id);
  if (!objetivo) throw new Error('Ese usuario ya no existe.');
  if (!activo) {
    if (objetivo.id === autor.id) throw new Error('No puedes desactivar tu propio usuario.');
    comprobarUltimoAdmin(db, objetivo, 'desactivar');
  }

  db.correr('UPDATE usuarios SET activo = ? WHERE id = ?', [activo ? 1 : 0, id]);
  await registrarBitacora(db, autor, activo ? 'activar-usuario' : 'desactivar-usuario', 'usuario', id, {
    nombre: objetivo.nombre,
  });
}

export async function eliminarUsuario(db: BaseDatos, autor: Autor, id: string): Promise<void> {
  const objetivo = obtenerUsuario(db, id);
  if (!objetivo) throw new Error('Ese usuario ya no existe.');
  if (objetivo.id === autor.id) throw new Error('No puedes eliminar tu propio usuario.');
  comprobarUltimoAdmin(db, objetivo, 'eliminar');

  db.correr('DELETE FROM usuarios WHERE id = ?', [id]);
  await registrarBitacora(db, autor, 'eliminar-usuario', 'usuario', id, {
    nombre: objetivo.nombre,
    rol: objetivo.rol,
  });
}

/** Un administrador asigna una contraseña temporal a otro usuario. */
export async function restablecerContrasena(
  db: BaseDatos,
  autor: Autor,
  id: string,
  temporal: string,
): Promise<void> {
  const objetivo = obtenerUsuario(db, id);
  if (!objetivo) throw new Error('Ese usuario ya no existe.');
  const problema = validarContrasena(temporal);
  if (problema) throw new Error(problema);

  const salt = generarSaltHex();
  const hash = await derivarPbkdf2(temporal, salt, ITERACIONES_PBKDF2);
  db.correr(
    `UPDATE usuarios
        SET hash = ?, salt = ?, iteraciones = ?, debe_cambiar = 1,
            intentos_fallidos = 0, bloqueado_hasta = NULL
      WHERE id = ?`,
    [hash, salt, ITERACIONES_PBKDF2, id],
  );
  await registrarBitacora(db, autor, 'restablecer-contrasena', 'usuario', id, {
    nombre: objetivo.nombre,
  });
}

/** El propio usuario cambia su contraseña, comprobando la anterior. */
export async function cambiarPropiaContrasena(
  db: BaseDatos,
  usuario: Usuario,
  actual: string,
  nueva: string,
): Promise<void> {
  const resultado = await comprobarCredenciales(db, usuario.id, actual, { registrar: false });
  if (!resultado.ok) throw new Error('La contraseña actual no es correcta.');

  const problema = validarContrasena(nueva);
  if (problema) throw new Error(problema);
  if (actual === nueva) throw new Error('La contraseña nueva debe ser distinta de la actual.');

  const salt = generarSaltHex();
  const hash = await derivarPbkdf2(nueva, salt, ITERACIONES_PBKDF2);
  db.correr(
    `UPDATE usuarios SET hash = ?, salt = ?, iteraciones = ?, debe_cambiar = 0 WHERE id = ?`,
    [hash, salt, ITERACIONES_PBKDF2, usuario.id],
  );
  await registrarBitacora(db, usuario, 'cambiar-contrasena', 'usuario', usuario.id, {});
}

// ─────────────────────────────────────────────────────────────
// Inicio de sesión
// ─────────────────────────────────────────────────────────────

export type ResultadoAcceso =
  | { ok: true; usuario: Usuario }
  | { ok: false; motivo: string; esperaMs?: number };

/** Milisegundos que quedan de bloqueo, o 0 si el usuario puede intentarlo. */
export function esperaRestante(usuario: Usuario, ahora = Date.now()): number {
  if (!usuario.bloqueadoHasta) return 0;
  const hasta = Date.parse(usuario.bloqueadoHasta);
  return Number.isFinite(hasta) ? Math.max(0, hasta - ahora) : 0;
}

/**
 * Comprueba unas credenciales.
 *
 * El freno por intentos fallidos vive en la base y no en memoria, de modo que
 * recargar la página o reabrir la aplicación no lo esquive.
 */
export async function comprobarCredenciales(
  db: BaseDatos,
  usuarioId: string,
  contrasena: string,
  opciones: { registrar?: boolean } = {},
): Promise<ResultadoAcceso> {
  const registrar = opciones.registrar !== false;
  const usuario = obtenerUsuario(db, usuarioId);
  if (!usuario) return { ok: false, motivo: 'Ese usuario ya no existe.' };
  if (!usuario.activo) {
    return { ok: false, motivo: 'Este usuario está desactivado. Pídele a un administrador que lo reactive.' };
  }

  const espera = esperaRestante(usuario);
  if (espera > 0) {
    return {
      ok: false,
      motivo: `Demasiados intentos fallidos. Espera ${Math.ceil(espera / 1000)} segundos antes de volver a intentarlo.`,
      esperaMs: espera,
    };
  }

  const fila = db.uno<Fila>('SELECT hash, salt, iteraciones FROM usuarios WHERE id = ?', [usuarioId]);
  if (!fila) return { ok: false, motivo: 'Ese usuario ya no existe.' };

  const correcta = await verificarClave(
    contrasena,
    String(fila['salt']),
    Number(fila['iteraciones']),
    String(fila['hash']),
  );

  if (!correcta) {
    const fallos = usuario.intentosFallidos + 1;
    let bloqueadoHasta: string | null = null;
    if (fallos > INTENTOS_LIBRES) {
      const factor = Math.min(2 ** (fallos - INTENTOS_LIBRES - 1), ESPERA_MAXIMA_MS / ESPERA_BASE_MS);
      bloqueadoHasta = new Date(Date.now() + ESPERA_BASE_MS * factor).toISOString();
    }
    db.correr('UPDATE usuarios SET intentos_fallidos = ?, bloqueado_hasta = ? WHERE id = ?', [
      fallos,
      bloqueadoHasta,
      usuarioId,
    ]);
    if (registrar) {
      await registrarBitacora(db, usuario, 'acceso-fallido', 'usuario', usuarioId, {
        intentos: fallos,
      });
    }
    return {
      ok: false,
      motivo: bloqueadoHasta
        ? `Contraseña incorrecta. Por seguridad hay que esperar antes del próximo intento.`
        : `Contraseña incorrecta. Te quedan ${INTENTOS_LIBRES - fallos + 1} intento(s) antes de que se aplique una espera.`,
    };
  }

  db.correr(
    'UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = ? WHERE id = ?',
    [new Date().toISOString(), usuarioId],
  );
  if (registrar) {
    await registrarBitacora(db, usuario, 'iniciar-sesion', 'usuario', usuarioId, {});
  }
  return { ok: true, usuario: obtenerUsuario(db, usuarioId)! };
}

/** Contraseña temporal legible, para cuando un administrador restablece otra. */
export function sugerirTemporal(): string {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digitos = '23456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let salida = '';
  for (let i = 0; i < 6; i++) salida += letras[bytes[i]! % letras.length];
  for (let i = 6; i < 10; i++) salida += digitos[bytes[i]! % digitos.length];
  return salida;
}
