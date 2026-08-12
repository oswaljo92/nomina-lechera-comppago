import { useEffect, useState } from 'react';
import { useApp } from '../estado.tsx';
import { Aviso, Campo, Vacio } from '../components/comunes.tsx';
import {
  cambiarPropiaContrasena,
  comprobarCredenciales,
  esperaRestante,
  usuariosActivos,
  validarContrasena,
} from '../../core/auth/usuarios.ts';
import type { Usuario } from '../../core/types.ts';

/**
 * Inicio de sesión.
 *
 * Se elige el usuario de una lista y se escribe su contraseña. Con un equipo
 * pequeño no hay motivo para ocultar quién existe, y evita tener que recordar
 * un nombre de usuario exacto.
 */
export function IniciarSesion() {
  const { db, iniciarSesion, cambiado, plataforma, version } = useApp();
  void version;

  const usuarios = usuariosActivos(db);
  const [elegido, setElegido] = useState<Usuario | null>(usuarios.length === 1 ? usuarios[0]! : null);

  if (!elegido) {
    return (
      <div className="acceso">
        <div className="caja">
          <header>
            <h1>¿Quién eres?</h1>
            <p>Elige tu usuario para continuar.</p>
          </header>
          <div className="cuerpo">
            {usuarios.length === 0 ? (
              <Vacio icono="👤" titulo="No hay usuarios activos">
                Todos los usuarios están desactivados. Restaura un respaldo para recuperar el
                acceso.
              </Vacio>
            ) : (
              <div className="lista-perfiles">
                {usuarios.map((u) => (
                  <button key={u.id} onClick={() => setElegido(u)}>
                    <span className={`avatar${u.rol === 'admin' ? ' admin' : ''}`}>
                      {u.nombre.trim().charAt(0).toUpperCase()}
                    </span>
                    <span>
                      <strong style={{ display: 'block' }}>{u.nombre}</strong>
                      <span className="tenue pequeno">
                        {u.rol === 'admin' ? 'Administrador' : 'Usuario normal'}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <footer>
            <p className="tenue pequeno" style={{ margin: 0 }}>
              Datos guardados en: {plataforma.db.ubicacion()}
            </p>
          </footer>
        </div>
      </div>
    );
  }

  return (
    <FormularioAcceso
      usuario={elegido}
      puedeVolver={usuarios.length > 1}
      alVolver={() => setElegido(null)}
      alEntrar={(u) => {
        cambiado();
        iniciarSesion(u);
      }}
      db={db}
      cambiado={cambiado}
    />
  );
}

function FormularioAcceso({
  usuario,
  puedeVolver,
  alVolver,
  alEntrar,
  db,
  cambiado,
}: {
  usuario: Usuario;
  puedeVolver: boolean;
  alVolver: () => void;
  alEntrar: (u: Usuario) => void;
  db: ReturnType<typeof useApp>['db'];
  cambiado: () => void;
}) {
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [espera, setEspera] = useState(() => esperaRestante(usuario));
  // Tras validar la contraseña temporal, se exige definir una propia.
  const [cambio, setCambio] = useState<Usuario | null>(null);
  const [nueva, setNueva] = useState('');
  const [nueva2, setNueva2] = useState('');

  // Cuenta atrás visible mientras dure el freno por intentos fallidos.
  useEffect(() => {
    if (espera <= 0) return;
    const id = setInterval(() => {
      setEspera((ms) => Math.max(0, ms - 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [espera]);

  async function entrar() {
    setOcupado(true);
    setError(null);
    try {
      const resultado = await comprobarCredenciales(db, usuario.id, clave);
      cambiado();
      if (!resultado.ok) {
        setError(resultado.motivo);
        setEspera(resultado.esperaMs ?? esperaRestante({ ...usuario, bloqueadoHasta: null }));
        const refrescado = usuariosActivos(db).find((u) => u.id === usuario.id);
        if (refrescado) setEspera(esperaRestante(refrescado));
        setClave('');
        return;
      }
      if (resultado.usuario.debeCambiar) {
        setCambio(resultado.usuario);
        return;
      }
      alEntrar(resultado.usuario);
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarCambio() {
    if (!cambio) return;
    setOcupado(true);
    setError(null);
    try {
      await cambiarPropiaContrasena(db, cambio, clave, nueva);
      cambiado();
      alEntrar({ ...cambio, debeCambiar: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  if (cambio) {
    const problema = nueva.length > 0 ? validarContrasena(nueva) : null;
    const coinciden = nueva.length > 0 && nueva === nueva2;
    return (
      <div className="acceso">
        <div className="caja">
          <header>
            <h1>Define tu contraseña</h1>
            <p>
              Tu contraseña actual es temporal, asignada por un administrador. Elige una propia para
              continuar.
            </p>
          </header>
          <div className="cuerpo">
            {error && <Aviso nivel="error">{error}</Aviso>}
            <Campo etiqueta="Contraseña nueva" ayuda="Mínimo 8 caracteres, con letras y números.">
              <input
                type="password"
                value={nueva}
                autoComplete="new-password"
                onChange={(e) => setNueva(e.target.value)}
              />
            </Campo>
            <Campo etiqueta="Repite la contraseña">
              <input
                type="password"
                value={nueva2}
                autoComplete="new-password"
                onChange={(e) => setNueva2(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && coinciden && !problema) void confirmarCambio();
                }}
              />
            </Campo>
            {problema && <Aviso nivel="aviso">{problema}</Aviso>}
            {nueva2.length > 0 && !coinciden && (
              <Aviso nivel="aviso">Las dos contraseñas no coinciden.</Aviso>
            )}
          </div>
          <footer>
            <button
              className="btn primario ancho"
              disabled={ocupado || !coinciden || problema !== null}
              onClick={() => void confirmarCambio()}
            >
              {ocupado ? 'Guardando…' : 'Guardar y entrar'}
            </button>
          </footer>
        </div>
      </div>
    );
  }

  const frenado = espera > 0;

  return (
    <div className="acceso">
      <div className="caja">
        <header>
          <div className="entre">
            <div>
              <h1>{usuario.nombre}</h1>
              <p>{usuario.rol === 'admin' ? 'Administrador' : 'Usuario normal'}</p>
            </div>
            <span className={`avatar${usuario.rol === 'admin' ? ' admin' : ''}`}>
              {usuario.nombre.trim().charAt(0).toUpperCase()}
            </span>
          </div>
        </header>
        <div className="cuerpo">
          {error && <Aviso nivel="error">{error}</Aviso>}
          {frenado && (
            <Aviso nivel="aviso" titulo="Acceso frenado">
              Espera {Math.ceil(espera / 1000)} segundo(s) antes del próximo intento.
            </Aviso>
          )}
          <Campo etiqueta="Contraseña">
            <input
              type="password"
              value={clave}
              autoFocus
              autoComplete="current-password"
              disabled={frenado || ocupado}
              onChange={(e) => setClave(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && clave && !frenado) void entrar();
              }}
            />
          </Campo>
        </div>
        <footer>
          <div className="acciones" style={{ width: '100%' }}>
            {puedeVolver && (
              <button className="btn" onClick={alVolver} disabled={ocupado}>
                Cambiar de usuario
              </button>
            )}
            <button
              className="btn primario crece"
              disabled={ocupado || frenado || clave.length === 0}
              onClick={() => void entrar()}
            >
              {ocupado ? 'Comprobando…' : 'Entrar'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
