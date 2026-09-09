import { Aviso, Dato, Modal, Pastilla, Vacio } from './comunes.tsx';
import { formatearBs } from '../../core/parser/numeros.ts';
import type { LecturaLibroNd } from '../../core/db/notaDebitoExcel.ts';

/**
 * Vista previa de una importación de ND antes de guardarla, mismo patrón que
 * `ModalImportarTasas` (Tasas.tsx): clasifica las filas y deja confirmar.
 */
export function ModalImportarNotaDebito({
  importacion,
  alCerrar,
  alImportar,
}: {
  importacion: LecturaLibroNd;
  alCerrar: () => void;
  alImportar: () => void;
}) {
  const porCodigo = importacion.filas.filter((f) => f.emparejamiento === 'codigo');
  const porNombre = importacion.filas.filter((f) => f.emparejamiento === 'nombre');
  const sinEmparejar = importacion.filas.filter((f) => f.emparejamiento === 'sin-emparejar');

  return (
    <Modal
      ancho
      titulo="Importar notas de débito desde Excel"
      alCerrar={alCerrar}
      pie={
        <>
          <button className="btn" onClick={alCerrar}>
            Cancelar
          </button>
          <button className="btn primario" disabled={importacion.filas.length === 0} onClick={alImportar}>
            Importar {importacion.filas.length} fila(s)
          </button>
        </>
      }
    >
      {importacion.errores.length > 0 && (
        <Aviso nivel="aviso" titulo="Algunas filas no se pudieron leer">
          {importacion.errores.join(' · ')}
        </Aviso>
      )}
      {sinEmparejar.length > 0 && (
        <Aviso nivel="info" titulo="Filas sin emparejar">
          {sinEmparejar.length} fila(s) no coincidieron con ningún proveedor cargado ni por código ni
          por nombre. Se importan igual como pendientes; podrás emparejarlas a mano desde la tabla.
        </Aviso>
      )}
      {importacion.filas.length === 0 ? (
        <Vacio icono="🧾" titulo="No hay filas válidas para importar" />
      ) : (
        <>
          <div className="rejilla cuatro" style={{ marginBottom: 14 }}>
            <Dato etiqueta="Emparejadas por código" valor={String(porCodigo.length)} />
            <Dato etiqueta="Emparejadas por nombre" valor={String(porNombre.length)} />
            <Dato etiqueta="Sin emparejar" valor={String(sinEmparejar.length)} />
          </div>
          <div className="tabla-envoltura tabla-adaptable" style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Proveedor</th>
                  <th>Código</th>
                  <th className="num">Monto</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {importacion.filas.map((f, i) => (
                  <tr key={i}>
                    <td className="principal">{f.fila.proveedorExcel}</td>
                    <td data-etiqueta="Código">{f.fila.codigoExcel}</td>
                    <td className="num" data-etiqueta="Monto">{formatearBs(f.fila.centimos)}</td>
                    <td data-etiqueta="Estado">
                      {f.emparejamiento === 'codigo' && <Pastilla tono="ok">Por código</Pastilla>}
                      {f.emparejamiento === 'nombre' && <Pastilla tono="info">Por nombre</Pastilla>}
                      {f.emparejamiento === 'sin-emparejar' && <Pastilla tono="aviso">Sin emparejar</Pastilla>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
