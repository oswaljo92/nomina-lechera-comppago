import { useState } from 'react';
import { Modal, Vacio } from './comunes.tsx';
import type { RegistroGuardado } from '../../core/db/repo.ts';
import type { NotaDebitoImportada } from '../../core/types.ts';

function palabras(texto: string): string[] {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((p) => p.length >= 3);
}

/** Emparejamiento manual de una fila de ND importada que no se pudo
 * reconocer sola, ni por código ni por nombre. Los candidatos que comparten
 * más palabras con el nombre del Excel salen primero (ej. "NANCY CARRERO" →
 * "NANCY YUDITH CARRERO PERNIA"). */
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
  const [busqueda, setBusqueda] = useState('');

  const delExcel = new Set(palabras(fila.proveedorExcel));
  const puntaje = (r: RegistroGuardado) => palabras(r.leido.nombre).filter((p) => delExcel.has(p)).length;
  const ordenados = [...candidatos].sort(
    (a, b) => puntaje(b) - puntaje(a) || a.leido.nombre.localeCompare(b.leido.nombre),
  );
  const t = busqueda.trim().toLowerCase();
  const visibles = t
    ? ordenados.filter((r) => `${r.leido.nombre} ${r.leido.codigo} ${r.leido.ruta}`.toLowerCase().includes(t))
    : ordenados;

  function confirmar(id: string) {
    alConfirmar(id);
    alCerrar();
  }

  return (
    <Modal
      titulo="Emparejar nota de débito importada"
      descripcion={`"${fila.proveedorExcel}"${fila.codigoExcel ? ` (código ${fila.codigoExcel} en el Excel)` : ''} no coincidió con ningún proveedor cargado. Elige a cuál corresponde.`}
      alCerrar={alCerrar}
      pie={
        <>
          <button className="btn" onClick={alCerrar}>
            Cancelar
          </button>
          <button className="btn primario" disabled={!elegido} onClick={() => confirmar(elegido)}>
            Emparejar
          </button>
        </>
      }
    >
      {candidatos.length === 0 ? (
        <Vacio icono="🔍" titulo="No hay proveedores disponibles de este tipo sin ND asignada" />
      ) : (
        <>
          <div className="filtros">
            <div className="buscador" style={{ flex: '1 1 auto' }}>
              <span className="lupa">🔍</span>
              <input
                type="text"
                autoFocus
                placeholder="Buscar por nombre, código o ruta"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
            </div>
            <span className="tenue pequeno">
              {visibles.length} de {candidatos.length}
            </span>
          </div>

          {visibles.length === 0 ? (
            <Vacio icono="🔍" titulo="Ningún proveedor coincide con la búsqueda" />
          ) : (
            <div className="lista-elegible" role="listbox" aria-label="Proveedores">
              {visibles.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="option"
                  aria-selected={elegido === r.id}
                  className={`opcion-elegible${elegido === r.id ? ' elegida' : ''}`}
                  onClick={() => setElegido(r.id)}
                  onDoubleClick={() => confirmar(r.id)}
                >
                  <span className="nombre-prov">{r.leido.nombre}</span>
                  <span className="sub">
                    {r.leido.codigo} · ruta {r.leido.ruta}
                    {puntaje(r) > 0 && ' · parecido al nombre del Excel'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
