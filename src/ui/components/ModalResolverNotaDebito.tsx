import { useState } from 'react';
import { Modal, Vacio } from './comunes.tsx';
import type { RegistroGuardado } from '../../core/db/repo.ts';
import type { NotaDebitoImportada } from '../../core/types.ts';

/** Emparejamiento manual de una fila de ND importada que no se pudo
 * reconocer sola, ni por código ni por nombre. */
export function ModalResolverNotaDebito({
  fila,
  candidatos,
  alCerrar,
  alConfirmar,
}: {
  fila: NotaDebitoImportada;
  candidatos: RegistroGuardado[];
  alCerrar: () => void;
  alConfirmar: (registroId: string) => void;
}) {
  const [elegido, setElegido] = useState('');

  return (
    <Modal
      titulo="Emparejar nota de débito importada"
      descripcion={`"${fila.proveedorExcel}" (código ${fila.codigoExcel} en el Excel) no coincidió con ningún proveedor cargado. Elige a cuál corresponde.`}
      alCerrar={alCerrar}
      pie={
        <>
          <button className="btn" onClick={alCerrar}>
            Cancelar
          </button>
          <button
            className="btn primario"
            disabled={!elegido}
            onClick={() => {
              alConfirmar(elegido);
              alCerrar();
            }}
          >
            Emparejar
          </button>
        </>
      }
    >
      {candidatos.length === 0 ? (
        <Vacio icono="🔍" titulo="No hay proveedores disponibles de este tipo sin ND asignada" />
      ) : (
        <select
          value={elegido}
          onChange={(e) => setElegido(e.target.value)}
          size={Math.min(10, candidatos.length + 1)}
          style={{ width: '100%' }}
        >
          <option value="" disabled>
            Elige un proveedor…
          </option>
          {candidatos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.leido.codigo} · {r.leido.nombre} · ruta {r.leido.ruta}
            </option>
          ))}
        </select>
      )}
    </Modal>
  );
}
