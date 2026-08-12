import { useState } from 'react';
import { useApp } from '../estado.tsx';
import { Aviso, Campo, Dato, Modal } from './comunes.tsx';
import { cambiarPropiaContrasena, validarContrasena } from '../../core/auth/usuarios.ts';
import { fechaAMostrar } from '../../core/parser/numeros.ts';

/** Datos del usuario en sesión, cambio de contraseña y cierre de sesión. */
export function MiCuenta({ alCerrar, alSalir }: { alCerrar: () => void; alSalir: () => void }) {
  const { db, usuario, plataforma, cambiado } = useApp();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [nueva2, setNueva2] = useState('');
  const [mensaje, setMensaje] = useState<{ nivel: 'ok' | 'error'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  if (!usuario) return null;

  const problema = nueva.length > 0 ? validarContrasena(nueva) : null;
  const coinciden = nueva.length > 0 && nueva === nueva2;

  async function guardar() {
    if (!usuario) return;
    setOcupado(true);
    setMensaje(null);
    try {
      await cambiarPropiaContrasena(db, usuario, actual, nueva);
      cambiado();
      setActual('');
      setNueva('');
      setNueva2('');
      setMensaje({ nivel: 'ok', texto: 'Contraseña actualizada.' });
    } catch (e) {
      setMensaje({ nivel: 'error', texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal
      titulo="Mi cuenta"
      descripcion={usuario.rol === 'admin' ? 'Administrador' : 'Usuario normal'}
      alCerrar={alCerrar}
      pie={
        <>
          <button className="btn peligro" onClick={alSalir}>
            Cerrar sesión
          </button>
          <span className="crece" />
          <button className="btn" onClick={alCerrar}>
            Cerrar
          </button>
        </>
      }
    >
      <div className="rejilla dos" style={{ marginBottom: 16 }}>
        <Dato etiqueta="Usuario" valor={usuario.nombre} pequeno />
        <Dato
          etiqueta="Último acceso"
          valor={
            usuario.ultimoAcceso
              ? new Date(usuario.ultimoAcceso).toLocaleString('es-VE', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })
              : '—'
          }
          nota={`Creado el ${fechaAMostrar(usuario.creadoEn.slice(0, 10))}`}
          pequeno
        />
      </div>

      <h3 style={{ marginBottom: 10 }}>Cambiar mi contraseña</h3>
      {mensaje && <Aviso nivel={mensaje.nivel === 'ok' ? 'ok' : 'error'}>{mensaje.texto}</Aviso>}

      <Campo etiqueta="Contraseña actual">
        <input
          type="password"
          value={actual}
          autoComplete="current-password"
          onChange={(e) => setActual(e.target.value)}
        />
      </Campo>
      <div className="linea">
        <Campo etiqueta="Contraseña nueva" ayuda="Mínimo 8 caracteres, con letras y números.">
          <input
            type="password"
            value={nueva}
            autoComplete="new-password"
            onChange={(e) => setNueva(e.target.value)}
          />
        </Campo>
        <Campo etiqueta="Repítela">
          <input
            type="password"
            value={nueva2}
            autoComplete="new-password"
            onChange={(e) => setNueva2(e.target.value)}
          />
        </Campo>
      </div>
      {problema && <Aviso nivel="aviso">{problema}</Aviso>}
      <button
        className="btn primario"
        disabled={ocupado || !actual || !coinciden || problema !== null}
        onClick={() => void guardar()}
      >
        {ocupado ? 'Guardando…' : 'Cambiar contraseña'}
      </button>

      <div className="sep" />
      <p className="tenue pequeno" style={{ margin: 0 }}>
        {plataforma.etiqueta} · datos en {plataforma.db.ubicacion()}
      </p>
    </Modal>
  );
}
