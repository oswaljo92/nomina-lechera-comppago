import { useEffect, useState } from 'react';
import { useApp } from '../estado.tsx';
import { Aviso, Tarjeta } from './comunes.tsx';
import {
  ACCIONES_ATAJO,
  ATAJOS_POR_DEFECTO,
  atajoDeEvento,
  esTeclaModificadora,
  guardarAtajo,
  leerAtajo,
  mismoAtajo,
  textoAtajo,
  validarAtajo,
  type AccionAtajo,
} from '../util/atajos.ts';

/**
 * Ajustes → Sistema: cambiar los atajos de copiar imagen / copiar nombre.
 * Al pulsar «Cambiar» se escucha la siguiente combinación; Esc cancela.
 */
export function ConfigAtajos() {
  const { db, cambiado, version } = useApp();
  void version;
  const [grabando, setGrabando] = useState<AccionAtajo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    if (!grabando) return;
    const accion = grabando;
    function alPresionar(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        setGrabando(null);
        return;
      }
      if (e.repeat || esTeclaModificadora(e.code)) return; // se espera la tecla final
      if (e.metaKey) {
        setError('La tecla Windows es del sistema operativo: no se puede usar.');
        return;
      }
      const atajo = atajoDeEvento(e);
      const motivo = validarAtajo(atajo);
      if (motivo) {
        setError(motivo);
        return;
      }
      const otra = ACCIONES_ATAJO.find((a) => a.accion !== accion && mismoAtajo(leerAtajo(db, a.accion), atajo));
      if (otra) {
        setError(`${textoAtajo(atajo)} ya está asignado a «${otra.titulo}».`);
        return;
      }
      guardarAtajo(db, accion, atajo);
      cambiado();
      setGrabando(null);
      setError(null);
      setOk(`Listo: «${ACCIONES_ATAJO.find((a) => a.accion === accion)!.titulo}» ahora es ${textoAtajo(atajo)}.`);
    }
    // En captura: así ningún otro atajo de la app se dispara mientras tanto.
    window.addEventListener('keydown', alPresionar, true);
    return () => window.removeEventListener('keydown', alPresionar, true);
  }, [grabando, db, cambiado]);

  return (
    <Tarjeta
      titulo="Atajos de teclado"
      descripcion="Copian al portapapeles lo de las filas marcadas en Comprobantes (factura) y en Notas de Débito (nota de débito). Siempre son de 3 teclas: Ctrl + Shift + letra, o Alt + Shift + letra."
    >
      {error && <Aviso nivel="error">{error}</Aviso>}
      {ok && !grabando && <Aviso nivel="ok">{ok}</Aviso>}

      <div className="lista-atajos">
        {ACCIONES_ATAJO.map(({ accion, titulo, ayuda }) => {
          const actual = leerAtajo(db, accion);
          const esDefecto = mismoAtajo(actual, ATAJOS_POR_DEFECTO[accion]);
          const enCaptura = grabando === accion;
          return (
            <div key={accion} className="fila-atajo">
              <div className="crece">
                <strong>{titulo}</strong>
                <div className="tenue pequeno">{ayuda}</div>
              </div>
              <kbd className={enCaptura ? 'grabando' : undefined}>
                {enCaptura ? 'Presiona la combinación… (Esc cancela)' : textoAtajo(actual)}
              </kbd>
              <div className="acciones">
                <button
                  className={`btn chico${enCaptura ? '' : ' primario'}`}
                  onClick={() => {
                    setOk(null);
                    setError(null);
                    setGrabando(enCaptura ? null : accion);
                  }}
                >
                  {enCaptura ? 'Cancelar' : 'Cambiar'}
                </button>
                <button
                  className="btn chico"
                  disabled={esDefecto || enCaptura}
                  onClick={() => {
                    const defecto = ATAJOS_POR_DEFECTO[accion];
                    const otra = ACCIONES_ATAJO.find(
                      (a) => a.accion !== accion && mismoAtajo(leerAtajo(db, a.accion), defecto),
                    );
                    if (otra) {
                      setError(`No se puede restablecer: ${textoAtajo(defecto)} lo tiene «${otra.titulo}».`);
                      return;
                    }
                    guardarAtajo(db, accion, defecto);
                    cambiado();
                    setError(null);
                    setOk(`«${titulo}» volvió a ${textoAtajo(defecto)}.`);
                  }}
                >
                  Restablecer
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Tarjeta>
  );
}
