import { useState } from 'react';
import { useApp } from '../estado.tsx';
import { Aviso } from '../components/comunes.tsx';
import { useRespaldarYBorrar } from '../components/RespaldarYBorrar.tsx';

/**
 * Pantalla que aparece cuando el archivo guardado pertenece a una versión
 * anterior del esquema.
 *
 * No se borra nada en silencio: primero se ofrece descargar la base tal cual
 * está, y solo entonces se puede reemplazar. Empezar de cero fue una decisión
 * deliberada, pero perder los datos sin querer no lo sería.
 */
export function BaseAnterior() {
  const { db, plataforma, reemplazarBase } = useApp();
  const { respaldado, descargarRespaldo, borrarTodo } = useRespaldarYBorrar(
    db,
    plataforma,
    reemplazarBase,
    `comppago_version${db.versionArchivo}`,
  );
  const [confirmando, setConfirmando] = useState(false);

  return (
    <div className="acceso">
      <div className="caja">
        <header>
          <h1>Hay datos de una versión anterior</h1>
          <p>
            La aplicación cambió a un sistema de usuarios con contraseña propia, y el archivo
            guardado usa el modelo anterior de perfiles sin credenciales.
          </p>
        </header>

        <div className="cuerpo">
          <Aviso nivel="aviso" titulo="Qué va a pasar">
            Para continuar hay que reemplazar la base por una nueva y volver a configurar la
            aplicación. Se perderán las nóminas, empresas, tasas y la bitácora que hubiera.
          </Aviso>

          <p className="tenue pequeno">
            Descarga primero una copia. Es un archivo SQLite estándar, así que podrás consultarlo
            después con cualquier herramienta aunque esta aplicación ya no lo abra.
          </p>

          <button className="btn ancho" onClick={descargarRespaldo}>
            ⬇ Descargar copia de los datos actuales
          </button>

          {respaldado && (
            <Aviso nivel="ok">
              Copia descargada. Ya puedes reemplazar la base con tranquilidad.
            </Aviso>
          )}
        </div>

        <footer>
          {confirmando ? (
            <div className="acciones" style={{ width: '100%' }}>
              <button className="btn" onClick={() => setConfirmando(false)}>
                Cancelar
              </button>
              <button className="btn peligro crece" onClick={borrarTodo}>
                Sí, borrar y empezar de cero
              </button>
            </div>
          ) : (
            <button className="btn primario ancho" onClick={() => setConfirmando(true)}>
              Empezar de cero
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
