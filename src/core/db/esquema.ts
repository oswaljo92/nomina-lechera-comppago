/**
 * Esquema de la base de datos.
 *
 * Es SQLite real, aunque corra sobre WebAssembly: el archivo resultante se
 * puede abrir con DB Browser o cualquier herramienta estándar. Eso importa
 * porque el archivo ES el mecanismo de respaldo y de traspaso entre equipos.
 *
 * Los montos se guardan como INTEGER de céntimos (ver src/core/types.ts).
 *
 * Versión 2: cada persona tiene su propio usuario con contraseña. Sustituye al
 * modelo anterior de perfiles sin credenciales más una única clave de
 * administrador compartida. El cambio importa para la bitácora: mientras
 * cualquiera podía elegir el perfil de un colega, lo que quedaba registrado a
 * su nombre no probaba nada.
 */

export const VERSION_ESQUEMA = 2;

export const ESQUEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

-- Un usuario por persona, con su propia contraseña.
CREATE TABLE IF NOT EXISTS usuarios (
  id                TEXT PRIMARY KEY,
  nombre            TEXT NOT NULL UNIQUE,
  rol               TEXT NOT NULL CHECK (rol IN ('admin','normal')),
  activo            INTEGER NOT NULL DEFAULT 1,
  -- PBKDF2-SHA256. La contraseña en claro nunca toca el disco.
  hash              TEXT NOT NULL,
  salt              TEXT NOT NULL,
  iteraciones       INTEGER NOT NULL,
  -- Obliga a definir contraseña propia en el siguiente inicio de sesión.
  debe_cambiar      INTEGER NOT NULL DEFAULT 0,
  -- Freno a la fuerza bruta. Vive en la base para que recargar no lo esquive.
  intentos_fallidos INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta   TEXT,
  creado_por        TEXT,
  creado_en         TEXT NOT NULL,
  ultimo_acceso     TEXT
);

CREATE TABLE IF NOT EXISTS empresas (
  id               TEXT PRIMARY KEY,
  razon_social     TEXT NOT NULL,
  rif              TEXT NOT NULL,
  direccion_fiscal TEXT NOT NULL,
  telefono         TEXT NOT NULL DEFAULT '',
  email            TEXT NOT NULL DEFAULT '',
  logo             TEXT
);

-- Qué empresa encabeza el comprobante según la fábrica que traiga el PDF.
CREATE TABLE IF NOT EXISTS fabricas (
  codigo     TEXT PRIMARY KEY,
  nombre     TEXT NOT NULL,
  empresa_id TEXT REFERENCES empresas(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS conceptos_catalogo (
  codigo            TEXT PRIMARY KEY,
  nombre            TEXT NOT NULL,
  clase             TEXT NOT NULL CHECK (clase IN ('pago','deduccion')),
  resta_facturacion INTEGER NOT NULL DEFAULT 0,
  clasificado       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS nominas (
  id           TEXT PRIMARY KEY,
  tipo         TEXT NOT NULL CHECK (tipo IN ('leche','transporte')),
  anio         INTEGER NOT NULL,
  numero       INTEGER NOT NULL,
  fecha_ini    TEXT NOT NULL,
  fecha_fin    TEXT NOT NULL,
  reporte      TEXT NOT NULL,
  archivo      TEXT NOT NULL,
  sha256       TEXT NOT NULL,
  usuario_id   TEXT NOT NULL,
  procesado_en TEXT NOT NULL,
  UNIQUE (tipo, anio, numero)
);

CREATE TABLE IF NOT EXISTS registros (
  id             TEXT PRIMARY KEY,
  nomina_id      TEXT NOT NULL REFERENCES nominas(id) ON DELETE CASCADE,
  nombre         TEXT NOT NULL,
  ruta           TEXT NOT NULL,
  codigo         TEXT NOT NULL,
  fabrica_cod    TEXT NOT NULL,
  fabrica_nom    TEXT NOT NULL,
  cedula         TEXT,
  rif            TEXT,
  banco          TEXT,
  cuenta         TEXT,
  litros_total   INTEGER,
  bruto          INTEGER NOT NULL,
  deduccion      INTEGER NOT NULL,
  neto           INTEGER NOT NULL,
  total_facturar INTEGER NOT NULL,
  validacion     TEXT NOT NULL,
  pagina         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_registros_nomina ON registros(nomina_id);
CREATE INDEX IF NOT EXISTS idx_registros_codigo ON registros(codigo);

CREATE TABLE IF NOT EXISTS conceptos (
  registro_id TEXT NOT NULL REFERENCES registros(id) ON DELETE CASCADE,
  orden       INTEGER NOT NULL,
  codigo      TEXT NOT NULL,
  centimos    INTEGER NOT NULL,
  columna     TEXT NOT NULL CHECK (columna IN ('pago','deduccion')),
  PRIMARY KEY (registro_id, orden)
);

CREATE TABLE IF NOT EXISTS litros_dia (
  registro_id TEXT NOT NULL REFERENCES registros(id) ON DELETE CASCADE,
  fecha       TEXT NOT NULL,
  litros      INTEGER NOT NULL,
  PRIMARY KEY (registro_id, fecha)
);

-- Conceptos añadidos a mano. Por defecto informativos (efecto NULL); si
-- efecto es 'suma'/'resta', ajustan el neto a pagar y el total a facturar.
CREATE TABLE IF NOT EXISTS conceptos_manual (
  id          TEXT PRIMARY KEY,
  registro_id TEXT NOT NULL REFERENCES registros(id) ON DELETE CASCADE,
  codigo      TEXT NOT NULL,
  nombre      TEXT NOT NULL,
  centimos    INTEGER NOT NULL,
  litros      INTEGER,
  efecto      TEXT,
  usuario_id  TEXT NOT NULL,
  creado_en   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_manual_registro ON conceptos_manual(registro_id);

CREATE TABLE IF NOT EXISTS notas_debito (
  registro_id    TEXT PRIMARY KEY REFERENCES registros(id) ON DELETE CASCADE,
  precio_usd     REAL NOT NULL,
  fecha_factura  TEXT NOT NULL,
  fecha_nota     TEXT NOT NULL,
  fecha_calculo  TEXT NOT NULL CHECK (fecha_calculo IN ('factura','nota')),
  usuario_id     TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

-- Precio propio de cada proveedor; se recuerda de una semana a otra.
CREATE TABLE IF NOT EXISTS precios_proveedor (
  tipo           TEXT NOT NULL,
  codigo         TEXT NOT NULL,
  precio_usd     REAL NOT NULL,
  actualizado_en TEXT NOT NULL,
  PRIMARY KEY (tipo, codigo)
);

CREATE TABLE IF NOT EXISTS tasas_bcv (
  fecha      TEXT PRIMARY KEY,
  tasa       REAL NOT NULL,
  usuario_id TEXT NOT NULL,
  creado_en  TEXT NOT NULL
);

-- Nombre completo de los proveedores que el PDF trunca a ~30 caracteres.
CREATE TABLE IF NOT EXISTS nombres_full (
  tipo            TEXT NOT NULL,
  codigo          TEXT NOT NULL,
  nombre_completo TEXT NOT NULL,
  PRIMARY KEY (tipo, codigo)
);

-- Vínculo persistente entre un proveedor de leche y una ruta de transporte
-- que pertenecen a la misma persona. Se detecta comparando el RIF/cédula del
-- PDF, pero se guarda por código —como precios_proveedor y nombres_full—
-- para que no haga falta reconfirmarlo cada semana.
CREATE TABLE IF NOT EXISTS vinculos_proveedor (
  id                TEXT PRIMARY KEY,
  codigo_leche      TEXT NOT NULL,
  codigo_transporte TEXT NOT NULL,
  estado            TEXT NOT NULL CHECK (estado IN ('confirmado','rechazado')),
  -- Documento normalizado que motivó la sugerencia; solo para auditoría, no
  -- participa en el emparejamiento una vez confirmado.
  documento         TEXT,
  usuario_id        TEXT NOT NULL,
  creado_en         TEXT NOT NULL,
  actualizado_en    TEXT NOT NULL,
  UNIQUE (codigo_leche, codigo_transporte)
);
CREATE INDEX IF NOT EXISTS idx_vinculo_leche ON vinculos_proveedor(codigo_leche);
CREATE INDEX IF NOT EXISTS idx_vinculo_transporte ON vinculos_proveedor(codigo_transporte);
-- Un código de leche (o de transporte) solo puede tener UN vínculo
-- confirmado a la vez. Los rechazados no cuentan.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vinculo_leche_confirmado
  ON vinculos_proveedor(codigo_leche) WHERE estado = 'confirmado';
CREATE UNIQUE INDEX IF NOT EXISTS idx_vinculo_transporte_confirmado
  ON vinculos_proveedor(codigo_transporte) WHERE estado = 'confirmado';

CREATE TABLE IF NOT EXISTS descargas (
  id          TEXT PRIMARY KEY,
  registro_id TEXT NOT NULL REFERENCES registros(id) ON DELETE CASCADE,
  folio       TEXT NOT NULL,
  formato     TEXT NOT NULL,
  archivo     TEXT NOT NULL,
  usuario_id  TEXT NOT NULL,
  creado_en   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_descargas_registro ON descargas(registro_id);

-- Bitácora encadenada: cada entrada incluye el hash de la anterior, de modo
-- que alterar o borrar una línea rompe la cadena y queda a la vista.
-- No se borra nunca, ni siquiera con usuario administrador.
CREATE TABLE IF NOT EXISTS bitacora (
  id            INTEGER PRIMARY KEY,
  ts            TEXT NOT NULL,
  usuario_id    TEXT NOT NULL,
  usuario_nombre TEXT NOT NULL,
  accion        TEXT NOT NULL,
  entidad       TEXT NOT NULL,
  entidad_id    TEXT NOT NULL,
  detalle       TEXT NOT NULL,
  hash_prev     TEXT NOT NULL,
  hash          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ajustes (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
`;
