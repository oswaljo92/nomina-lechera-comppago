import { useEffect, useState } from 'react';
import { useApp } from '../estado.tsx';

/**
 * Nombre del proveedor con dos botones pegados a él: 📋 copia el nombre y 🖼
 * copia la imagen del comprobante al portapapeles, para pegarlos directo en
 * WhatsApp o en un correo sin descargar ningún archivo. Cada botón marca ✓ un
 * momento para confirmar que se copió.
 */
export function NombreConCopia({
  nombre,
  tituloImagen,
  alCopiarImagen,
  imagenDeshabilitada = false,
  alError,
}: {
  nombre: string;
  tituloImagen?: string;
  /** Si falta, no se muestra el botón de imagen. */
  alCopiarImagen?: () => Promise<void>;
  imagenDeshabilitada?: boolean;
  alError: (mensaje: string) => void;
}) {
  const { plataforma } = useApp();
  const [hecho, setHecho] = useState<'nombre' | 'imagen' | null>(null);
  const [copiandoImagen, setCopiandoImagen] = useState(false);

  useEffect(() => {
    if (!hecho) return;
    const t = setTimeout(() => setHecho(null), 1500);
    return () => clearTimeout(t);
  }, [hecho]);

  async function copiarNombre() {
    try {
      await plataforma.portapapeles.copiarTexto(nombre);
      setHecho('nombre');
    } catch (e) {
      alError(`No se pudo copiar el nombre: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function copiarImagen() {
    if (!alCopiarImagen) return;
    setCopiandoImagen(true);
    try {
      await alCopiarImagen();
      setHecho('imagen');
    } catch (e) {
      alError(`No se pudo copiar la imagen: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCopiandoImagen(false);
    }
  }

  return (
    <div className="nombre-con-copia">
      <span className="nombre-prov">{nombre}</span>
      <span className="botones-copia">
        <button
          type="button"
          className={`btn sutil copiar${hecho === 'nombre' ? ' hecho' : ''}`}
          title="Copiar nombre"
          aria-label={`Copiar nombre de ${nombre}`}
          onClick={() => void copiarNombre()}
        >
          {hecho === 'nombre' ? '✓' : '📋'}
        </button>
        {alCopiarImagen && (
          <button
            type="button"
            className={`btn sutil copiar${hecho === 'imagen' ? ' hecho' : ''}`}
            title={tituloImagen ?? 'Copiar imagen'}
            aria-label={tituloImagen ?? 'Copiar imagen'}
            disabled={imagenDeshabilitada || copiandoImagen}
            onClick={() => void copiarImagen()}
          >
            {hecho === 'imagen' ? '✓' : copiandoImagen ? '…' : '🖼'}
          </button>
        )}
      </span>
    </div>
  );
}
