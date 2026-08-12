import { useEffect, useState } from 'react';
import { previsualizar } from '../salida/generar.ts';
import type { DatosComprobante } from '../../core/receipt/comprobante.ts';
import type { OpcionesDibujo } from '../../core/receipt/dibujo.ts';

/**
 * Vista previa del comprobante.
 *
 * Genera el PNG de verdad, con el mismo código que produce el archivo que se
 * descarga. Así lo que se ve en pantalla no es una aproximación: es el
 * documento.
 */
export function VistaPrevia({
  datos,
  opciones,
}: {
  datos: DatosComprobante;
  opciones: OpcionesDibujo;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    let creada: string | null = null;

    void previsualizar(datos, opciones)
      .then((nueva) => {
        creada = nueva;
        if (vivo) setUrl(nueva);
        else URL.revokeObjectURL(nueva);
      })
      .catch((e: unknown) => {
        if (vivo) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      vivo = false;
      if (creada) URL.revokeObjectURL(creada);
    };
  }, [datos, opciones]);

  if (error) {
    return (
      <div className="aviso-caja error">
        <strong>No se pudo componer la vista previa</strong>
        {error}
      </div>
    );
  }

  return (
    <div className="previsualizacion">
      {url ? (
        <img
          src={url}
          alt="Vista previa del comprobante"
          style={{ width: '100%', maxWidth: 560, height: 'auto', boxShadow: '0 4px 24px rgba(0,0,0,.3)' }}
        />
      ) : (
        <div style={{ color: '#fff', padding: 40 }}>Componiendo el comprobante…</div>
      )}
    </div>
  );
}
