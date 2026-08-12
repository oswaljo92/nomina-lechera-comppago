import { useState } from 'react';
import type { BaseDatos } from '../../core/db/basedatos.ts';
import type { Plataforma } from '../../platform/tipos.ts';

/**
 * Estado y acciones compartidas por las pantallas que permiten vaciar la base
 * entera (BaseAnterior y el botón de pánico de Ajustes): no dejan borrar hasta
 * que se descargó un respaldo.
 */
export function useRespaldarYBorrar(
  db: BaseDatos,
  plataforma: Plataforma,
  reemplazarBase: (bytes: Uint8Array | null) => Promise<void>,
  prefijoArchivo: string,
) {
  const [respaldado, setRespaldado] = useState(false);

  function descargarRespaldo() {
    const fecha = new Date().toISOString().slice(0, 10);
    const bytes = db.exportar();
    void plataforma.archivos
      .guardar(
        `${prefijoArchivo}_${fecha}.db`,
        new Blob([new Uint8Array(bytes) as unknown as ArrayBufferView<ArrayBuffer>], {
          type: 'application/octet-stream',
        }),
      )
      .then(() => setRespaldado(true));
  }

  function borrarTodo() {
    void reemplazarBase(null);
  }

  return { respaldado, descargarRespaldo, borrarTodo };
}
