import { useState } from 'react';
import { useApp } from '../estado.tsx';
import { Aviso, Pastilla, Tarjeta, Vacio } from '../components/comunes.tsx';
import { contarBitacora, leerBitacora, verificarBitacora } from '../../core/db/bitacora.ts';
import type { VerificacionBitacora } from '../../core/types.ts';

const ETIQUETAS: Record<string, string> = {
  'iniciar-sesion': 'Inició sesión',
  'acceso-fallido': 'Intento de acceso fallido',
  'cambiar-contrasena': 'Cambió su contraseña',
  'restablecer-contrasena': 'Restableció la contraseña de un usuario',
  'cambiar-rol': 'Cambió el rol de un usuario',
  'activar-usuario': 'Activó un usuario',
  'desactivar-usuario': 'Desactivó un usuario',
  'cargar-nomina': 'Cargó una nómina',
  'eliminar-nomina': 'Eliminó una nómina',
  'crear-usuario': 'Creó un usuario',
  'eliminar-usuario': 'Eliminó un usuario',
  'crear-empresa': 'Creó una empresa',
  'editar-empresa': 'Editó una empresa',
  'eliminar-empresa': 'Eliminó una empresa',
  'asignar-empresa': 'Asignó empresa a una fábrica',
  'clasificar-concepto': 'Clasificó un concepto',
  'cargar-tasa': 'Cargó una tasa del BCV',
  'eliminar-tasa': 'Eliminó una tasa',
  'concepto-manual': 'Agregó un concepto manual',
  'quitar-concepto-manual': 'Quitó un concepto manual',
  'nota-debito': 'Configuró notas de débito',
  'quitar-nota-debito': 'Quitó notas de débito',
  'descargar-comprobante': 'Descargó comprobantes',
  'editar-nombre': 'Corrigió el nombre de un proveedor',
  'importar-historico': 'Importó histórico',
};

export function BitacoraPantalla() {
  const { db, version } = useApp();
  void version;

  const [pagina, setPagina] = useState(0);
  const [verificacion, setVerificacion] = useState<VerificacionBitacora | null>(null);
  const [verificando, setVerificando] = useState(false);

  const porPagina = 60;
  const total = contarBitacora(db);
  const entradas = leerBitacora(db, porPagina, pagina * porPagina);

  return (
    <>
      <div className="cabecera-pagina">
        <div>
          <h1>Bitácora</h1>
          <p>
            Registro de todo lo que se hace en la aplicación. Cada entrada guarda el hash de la
            anterior, de modo que alterar o borrar una línea rompe la cadena y queda a la vista.
            Nadie puede borrarla, ni siquiera un administrador.
          </p>
        </div>
        <button
          className="btn primario"
          disabled={verificando}
          onClick={() => {
            setVerificando(true);
            void verificarBitacora(db)
              .then(setVerificacion)
              .finally(() => setVerificando(false));
          }}
        >
          {verificando ? 'Verificando…' : 'Verificar integridad'}
        </button>
      </div>

      {verificacion && (
        <Aviso
          nivel={verificacion.intacta ? 'ok' : 'error'}
          titulo={verificacion.intacta ? 'Cadena íntegra' : 'La cadena está rota'}
        >
          {verificacion.mensaje}
        </Aviso>
      )}

      <Aviso nivel="info" titulo="Hasta dónde llega esta garantía">
        El encadenado <strong>detecta</strong> manipulaciones; no las impide. Quien tenga el archivo
        de base de datos y conozca el algoritmo podría reconstruir la cadena entera. Frente al caso
        real —que alguien borre algo y lo niegue— es eficaz; para cerrar ese hueco por completo
        haría falta cifrar la base.
      </Aviso>

      <Tarjeta titulo={`${total} entradas`} ajustado>
        {entradas.length === 0 ? (
          <Vacio icono="📓" titulo="La bitácora está vacía" />
        ) : (
          <>
            <div className="tabla-envoltura tabla-adaptable">
              <table className="tabla">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>Nº</th>
                    <th>Cuándo</th>
                    <th>Quién</th>
                    <th>Qué hizo</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {entradas.map((e) => (
                    <tr key={e.id}>
                      <td className="mono pequeno principal">Entrada Nº {e.id}</td>
                      <td className="pequeno nowrap" data-etiqueta="Cuándo">
                        {new Date(e.ts).toLocaleString('es-VE', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </td>
                      <td data-etiqueta="Quién">
                        <span className="nombre-prov">{e.usuarioNombre}</span>
                      </td>
                      <td data-etiqueta="Acción">
                        <Pastilla tono={e.accion.startsWith('eliminar') ? 'error' : 'neutra'}>
                          {ETIQUETAS[e.accion] ?? e.accion}
                        </Pastilla>
                      </td>
                      <td className="pequeno tenue" data-etiqueta="Detalle" style={{ maxWidth: 420, wordBreak: 'break-word' }}>
                        {resumirDetalle(e.detalle)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total > porPagina && (
              <div className="filtros" style={{ borderTop: '1px solid var(--borde)', borderBottom: 0 }}>
                <button
                  className="btn chico"
                  disabled={pagina === 0}
                  onClick={() => setPagina((p) => p - 1)}
                >
                  ← Más recientes
                </button>
                <span className="tenue pequeno">
                  {pagina * porPagina + 1}–{Math.min((pagina + 1) * porPagina, total)} de {total}
                </span>
                <button
                  className="btn chico"
                  disabled={(pagina + 1) * porPagina >= total}
                  onClick={() => setPagina((p) => p + 1)}
                >
                  Más antiguas →
                </button>
              </div>
            )}
          </>
        )}
      </Tarjeta>
    </>
  );
}

/** El detalle se guarda como JSON; aquí se muestra legible y acotado. */
function resumirDetalle(detalle: string): string {
  try {
    const objeto = JSON.parse(detalle) as Record<string, unknown>;
    const partes = Object.entries(objeto)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .slice(0, 6)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
    return partes.join(' · ') || '—';
  } catch {
    return detalle;
  }
}
