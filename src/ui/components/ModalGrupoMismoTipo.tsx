import { Aviso, Modal } from './comunes.tsx';
import type { CandidatoGrupoMismoTipo } from '../../core/db/repo.ts';

/**
 * Confirma o descarta un candidato de agrupación entre 2+ códigos del MISMO
 * tipo (ej. dos rutas de transporte, o dos códigos de leche) detectado por
 * RIF/cédula. Mecanismo separado del vínculo leche+transporte: no se une
 * nada a ciegas, alguien tiene que decidir.
 */
export function ModalGrupoMismoTipo({
  candidato,
  puedeVincular,
  alCerrar,
  alConfirmar,
  alRechazar,
}: {
  candidato: CandidatoGrupoMismoTipo;
  puedeVincular: boolean;
  alCerrar: () => void;
  alConfirmar: () => void;
  alRechazar: () => void;
}) {
  return (
    <Modal
      titulo={`Posible agrupación de ${candidato.tipo === 'leche' ? 'leche' : 'transporte'}`}
      descripcion="Se encontró el mismo RIF/cédula en varios códigos de este reporte."
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
            No es el mismo proveedor
          </button>
          <button
            className="btn primario"
            disabled={!puedeVincular}
            onClick={() => {
              alConfirmar();
              alCerrar();
            }}
          >
            Agrupar
          </button>
        </>
      }
    >
      {!puedeVincular && (
        <Aviso nivel="aviso">Solo un administrador puede confirmar o descartar agrupaciones.</Aviso>
      )}
      <div className="rejilla dos" style={{ marginBottom: 14 }}>
        {candidato.registros.map((r) => (
          <div key={r.id}>
            <div className="tenue pequeno">Código {r.leido.codigo}</div>
            <div>{r.leido.nombre}</div>
            <div className="tenue pequeno">Ruta {r.leido.ruta}</div>
          </div>
        ))}
      </div>
      <p className="tenue pequeno">
        Documento en común: {candidato.documento}. Al agrupar, estos códigos se combinan en un solo
        comprobante (con el desglose de cada uno) automáticamente en cada semana futura, sin volver
        a preguntar. Si rechazas, no se vuelve a sugerir este grupo.
      </p>
    </Modal>
  );
}
