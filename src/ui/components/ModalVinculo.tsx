import { Aviso, Dato, Modal } from './comunes.tsx';
import type { CandidatoVinculo } from '../../core/db/repo.ts';

/**
 * Confirma o descarta un candidato de vínculo leche+transporte detectado por
 * RIF/cédula. No se une nada a ciegas: alguien tiene que decidir, porque un
 * cruce equivocado mezclaría el dinero de dos personas reales.
 */
export function ModalVinculo({
  candidato,
  puedeVincular,
  alCerrar,
  alConfirmar,
  alRechazar,
}: {
  candidato: CandidatoVinculo;
  puedeVincular: boolean;
  alCerrar: () => void;
  alConfirmar: () => void;
  alRechazar: () => void;
}) {
  return (
    <Modal
      titulo="Posible vínculo leche + transporte"
      descripcion="Se encontró el mismo RIF/cédula en los dos reportes de esta semana."
      alCerrar={alCerrar}
      pie={
        <>
          <button className="btn" onClick={alCerrar}>
            Cerrar
          </button>
          <button
            className="btn peligro"
            disabled={!puedeVincular}
            onClick={() => {
              alRechazar();
              alCerrar();
            }}
          >
            No es la misma persona
          </button>
          <button
            className="btn primario"
            disabled={!puedeVincular}
            onClick={() => {
              alConfirmar();
              alCerrar();
            }}
          >
            Vincular
          </button>
        </>
      }
    >
      {!puedeVincular && (
        <Aviso nivel="aviso">Solo un administrador puede confirmar o descartar vínculos.</Aviso>
      )}
      <div className="rejilla dos" style={{ marginBottom: 14 }}>
        <Dato
          etiqueta="Leche"
          valor={candidato.registroLeche.leido.nombre}
          nota={`Código ${candidato.registroLeche.leido.codigo}`}
        />
        <Dato
          etiqueta="Transporte"
          valor={candidato.registroTransporte.leido.nombre}
          nota={`Ruta ${candidato.registroTransporte.leido.ruta}`}
        />
      </div>
      <p className="tenue pequeno">
        Documento en común: {candidato.documento}. Al vincular, este proveedor se combina en un
        solo comprobante automáticamente en cada semana futura, sin volver a preguntar. Si
        rechazas, no se vuelve a sugerir esta pareja.
      </p>
    </Modal>
  );
}
