import { useEffect, useRef } from 'react';
import type { BaseDatos } from '../../core/db/basedatos.ts';
import { ACCIONES_ATAJO, esTeclaModificadora, leerAtajo, mismoAtajo, type Atajo, type AccionAtajo } from './atajosReglas.ts';

export * from './atajosReglas.ts';

export function atajoDeEvento(e: KeyboardEvent): Atajo {
  return { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, codigo: e.code };
}

/**
 * Escucha los atajos de copiado mientras la pantalla que lo use esté
 * montada. Los manejadores se leen siempre en su versión más reciente (no
 * hace falta memorizarlos).
 */
export function useAtajosCopia(
  db: BaseDatos,
  manejadores: Partial<Record<AccionAtajo, () => void>>,
): void {
  const ref = useRef(manejadores);
  ref.current = manejadores;

  useEffect(() => {
    function alPresionar(e: KeyboardEvent) {
      if (e.repeat || e.metaKey || esTeclaModificadora(e.code)) return;
      const presionado = atajoDeEvento(e);
      for (const { accion } of ACCIONES_ATAJO) {
        const manejador = ref.current[accion];
        if (manejador && mismoAtajo(presionado, leerAtajo(db, accion))) {
          e.preventDefault();
          manejador();
          return;
        }
      }
    }
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  }, [db]);
}
