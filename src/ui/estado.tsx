import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { BaseDatos } from '../core/db/basedatos.ts';
import { Persistencia, obtenerPlataforma, type Plataforma } from '../platform/index.ts';
import { puede } from '../core/auth/permisos.ts';
import type { Permiso, Usuario } from '../core/types.ts';

interface Contexto {
  plataforma: Plataforma;
  db: BaseDatos;
  /** Usuario con la sesión iniciada, o null si aún no ha entrado nadie. */
  usuario: Usuario | null;
  /** Se incrementa tras cada cambio; las pantallas lo usan para releer. */
  version: number;

  iniciarSesion(usuario: Usuario): void;
  cerrarSesion(): void;
  /** Refresca los datos del usuario en sesión tras editarlo. */
  refrescarUsuario(usuario: Usuario): void;
  /** Marca la base como modificada, la persiste y refresca la interfaz. */
  cambiado(): void;
  refrescar(): void;
  guardarYa(): Promise<void>;
  /** Reemplaza la base entera (restaurar respaldo o empezar de cero). */
  reemplazarBase(bytes: Uint8Array | null): Promise<void>;
  puedo(permiso: Permiso): boolean;
}

const Ctx = createContext<Contexto | null>(null);

export function useApp(): Contexto {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp fuera del proveedor de estado.');
  return ctx;
}

type Arranque =
  | { estado: 'cargando' }
  | { estado: 'error'; mensaje: string }
  | { estado: 'listo'; plataforma: Plataforma; db: BaseDatos };

export function ProveedorApp({ children }: { children: ReactNode }) {
  const [arranque, setArranque] = useState<Arranque>({ estado: 'cargando' });
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [version, setVersion] = useState(0);
  const persistencia = useRef<Persistencia | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const plataforma = await obtenerPlataforma();
        const bytes = await plataforma.db.cargar();
        const db = await BaseDatos.abrir(plataforma.localizarWasm, bytes);
        if (!vivo) return;
        // Una base de un modelo anterior no se toca: la interfaz ofrecerá
        // respaldarla antes de reemplazarla.
        if (!db.desactualizada) {
          persistencia.current = new Persistencia(plataforma, () => db.exportar(), {
            alFallar: (e) => {
              console.error('No se pudo guardar la base de datos:', e);
              alert(
                'No se pudo guardar la base de datos. Revisa el espacio disponible y vuelve a intentarlo antes de cerrar la aplicación.',
              );
            },
          });
        }
        setArranque({ estado: 'listo', plataforma, db });
      } catch (error) {
        if (!vivo) return;
        setArranque({
          estado: 'error',
          mensaje: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const refrescar = useCallback(() => setVersion((v) => v + 1), []);

  const cambiado = useCallback(() => {
    persistencia.current?.marcarSucio();
    setVersion((v) => v + 1);
  }, []);

  const guardarYa = useCallback(async () => {
    await persistencia.current?.volcar();
  }, []);

  const valor = useMemo<Contexto | null>(() => {
    if (arranque.estado !== 'listo') return null;
    const { plataforma, db } = arranque;
    return {
      plataforma,
      db,
      usuario,
      version,
      iniciarSesion: setUsuario,
      cerrarSesion: () => setUsuario(null),
      refrescarUsuario: setUsuario,
      cambiado,
      refrescar,
      guardarYa,
      reemplazarBase: async (bytes) => {
        // Escribir bytes vacíos deja el archivo en cero y al recargar se crea
        // una base nueva. Recargar es lo más honesto: toda la interfaz vuelve a
        // leer desde cero y no queda nada de la anterior en memoria.
        await plataforma.db.guardar(bytes ?? new Uint8Array(0));
        location.reload();
      },
      puedo: (permiso) => puede(usuario, permiso),
    };
  }, [arranque, usuario, version, cambiado, refrescar, guardarYa]);

  if (arranque.estado === 'cargando') {
    return (
      <div className="acceso">
        <div className="caja">
          <div className="cuerpo" style={{ textAlign: 'center', padding: '40px 24px' }}>
            <div style={{ fontSize: 34, marginBottom: 10 }}>📄</div>
            <h1>CompPago</h1>
            <p className="tenue">Abriendo la base de datos…</p>
          </div>
        </div>
      </div>
    );
  }

  if (arranque.estado === 'error') {
    return (
      <div className="acceso">
        <div className="caja">
          <header>
            <h1>No se pudo iniciar</h1>
            <p>La aplicación no logró abrir su base de datos.</p>
          </header>
          <div className="cuerpo">
            <div className="aviso-caja error">
              <strong>Detalle del error</strong>
              {arranque.mensaje}
            </div>
            <p className="tenue pequeno">
              Si esto ocurre en el navegador, comprueba que no estés en modo incógnito y que el
              sitio tenga permiso para almacenar datos.
            </p>
          </div>
          <footer>
            <button className="btn primario ancho" onClick={() => location.reload()}>
              Reintentar
            </button>
          </footer>
        </div>
      </div>
    );
  }

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
