import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';
import { ESQUEMA_SQL, VERSION_ESQUEMA } from './esquema.ts';
import { CATALOGO_INICIAL } from '../calc/catalogo.ts';

export type Parametro = SqlValue;
export type Fila = Record<string, SqlValue>;

let motor: SqlJsStatic | null = null;

/** Comprueba la cabecera estándar de SQLite, sin llegar a abrir el archivo. */
export function esArchivoSqlite(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.slice(0, 15)) === 'SQLite format 3';
}

/**
 * Lee la versión del esquema sin asumir que las tablas existan: un archivo
 * recién creado no tiene ni siquiera `meta`, y una base de otra versión podría
 * tener una forma distinta.
 */
function leerVersion(db: Database): number {
  try {
    const resultado = db.exec("SELECT valor FROM meta WHERE clave = 'version_esquema'");
    const valor = resultado[0]?.values?.[0]?.[0];
    return valor === undefined || valor === null ? 0 : Number(valor);
  } catch {
    return 0;
  }
}

/**
 * Carga el módulo WebAssembly de SQLite una sola vez por sesión.
 * `localizarWasm` la resuelve cada plataforma: en la web es la URL que Vite
 * genera para el .wasm, en Electron la ruta dentro del paquete.
 */
export async function iniciarMotor(localizarWasm: (archivo: string) => string): Promise<SqlJsStatic> {
  if (!motor) motor = await initSqlJs({ locateFile: localizarWasm });
  return motor;
}

/**
 * Envoltorio delgado sobre sql.js.
 *
 * La base vive en memoria y se vuelca a bytes para persistirla. A esta escala
 * —del orden de cien registros por semana— el volcado completo es
 * imperceptible, y a cambio el mismo código sirve igual sobre el sistema de
 * archivos privado del navegador que sobre un archivo en disco en Electron.
 */
export class BaseDatos {
  private db: Database;
  /**
   * `true` cuando el archivo abierto pertenece a una versión anterior del
   * esquema. En ese caso NO se toca nada: la interfaz ofrece descargar un
   * respaldo antes de reemplazarla. Aplicar el esquema nuevo por encima
   * dejaría una base a medio camino entre dos modelos.
   */
  readonly desactualizada: boolean;
  readonly versionArchivo: number;

  private constructor(db: Database, desactualizada: boolean, versionArchivo: number) {
    this.db = db;
    this.desactualizada = desactualizada;
    this.versionArchivo = versionArchivo;
  }

  static async abrir(
    localizarWasm: (archivo: string) => string,
    bytes?: Uint8Array | null,
  ): Promise<BaseDatos> {
    const sql = await iniciarMotor(localizarWasm);
    const db = bytes && bytes.length > 0 ? new sql.Database(bytes) : new sql.Database();

    const version = leerVersion(db);
    if (version > 0 && version < VERSION_ESQUEMA) {
      return new BaseDatos(db, true, version);
    }

    const base = new BaseDatos(db, false, version);
    base.migrar(version);
    return base;
  }

  /** Crea una base nueva y vacía, descartando la que hubiera. */
  static async crearVacia(localizarWasm: (archivo: string) => string): Promise<BaseDatos> {
    return BaseDatos.abrir(localizarWasm, null);
  }

  /** Crea el esquema y siembra el catálogo la primera vez. */
  private migrar(version: number): void {
    this.db.exec(ESQUEMA_SQL);

    if (version === 0) {
      for (const c of CATALOGO_INICIAL) {
        this.correr(
          `INSERT OR IGNORE INTO conceptos_catalogo
             (codigo, nombre, clase, resta_facturacion, clasificado)
           VALUES (?, ?, ?, ?, ?)`,
          [c.codigo, c.nombre, c.clase, c.restaFacturacion ? 1 : 0, c.clasificado ? 1 : 0],
        );
      }
    }
    this.fijarMeta('version_esquema', String(VERSION_ESQUEMA));
  }

  // ── consultas ──────────────────────────────────────────────

  todos<T = Fila>(sql: string, params: Parametro[] = []): T[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const filas: T[] = [];
      while (stmt.step()) filas.push(stmt.getAsObject() as T);
      return filas;
    } finally {
      stmt.free();
    }
  }

  uno<T = Fila>(sql: string, params: Parametro[] = []): T | null {
    return this.todos<T>(sql, params)[0] ?? null;
  }

  /** Primer valor de la primera fila; útil para COUNT, MAX y similares. */
  escalar(sql: string, params: Parametro[] = []): SqlValue | null {
    const fila = this.uno(sql, params);
    if (!fila) return null;
    const claves = Object.keys(fila);
    return claves.length > 0 ? (fila[claves[0]!] ?? null) : null;
  }

  correr(sql: string, params: Parametro[] = []): void {
    this.db.run(sql, params);
  }

  ejecutar(sql: string): void {
    this.db.exec(sql);
  }

  /**
   * Ejecuta `fn` dentro de una transacción. Si lanza, se deshace todo.
   * Importa porque guardar una nómina toca cinco tablas y una a medias sería
   * peor que ninguna.
   */
  transaccion<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const salida = fn();
      this.db.exec('COMMIT');
      return salida;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Igual que `transaccion` pero admite trabajo asíncrono, como el hashing de
   * la bitácora. sql.js es de un solo hilo y no reentra, así que no hay riesgo
   * de que otra operación se cuele mientras se espera.
   */
  async transaccionAsync<T>(fn: () => Promise<T>): Promise<T> {
    this.db.exec('BEGIN');
    try {
      const salida = await fn();
      this.db.exec('COMMIT');
      return salida;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  // ── meta y ajustes ─────────────────────────────────────────

  valorMeta(clave: string): string | null {
    const v = this.escalar('SELECT valor FROM meta WHERE clave = ?', [clave]);
    return typeof v === 'string' ? v : null;
  }

  fijarMeta(clave: string, valor: string): void {
    this.correr(
      'INSERT INTO meta (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor',
      [clave, valor],
    );
  }

  ajuste(clave: string): string | null {
    const v = this.escalar('SELECT valor FROM ajustes WHERE clave = ?', [clave]);
    return typeof v === 'string' ? v : null;
  }

  fijarAjuste(clave: string, valor: string): void {
    this.correr(
      'INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor',
      [clave, valor],
    );
  }

  // ── persistencia ───────────────────────────────────────────

  exportar(): Uint8Array {
    return this.db.export();
  }

  cerrar(): void {
    this.db.close();
  }
}
