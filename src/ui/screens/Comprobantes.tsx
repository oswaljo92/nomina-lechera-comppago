import { useMemo, useState } from 'react';
import { useApp } from '../estado.tsx';
import { Modal, Tarjeta, Vacio } from '../components/comunes.tsx';
import * as repo from '../../core/db/repo.ts';
import { OPCIONES_DIBUJO, type OpcionesDibujo } from '../../core/receipt/dibujo.ts';
import { fechaAMostrar } from '../../core/parser/numeros.ts';
import type { Formato } from '../salida/generar.ts';
import { SeccionComprobantesGenerales } from './comprobantes/SeccionComprobantesGenerales.tsx';
import { SeccionNotasDebito } from './comprobantes/SeccionNotasDebito.tsx';

export interface FechasNomina {
  factura: string;
  nota: string;
}

type PestanaComprobantes = 'generales' | 'notas-debito';

/**
 * Shell: mantiene lo que comparten las dos pestañas (nómina seleccionada,
 * formato de descarga, opciones de contenido del PDF, fechas del documento)
 * y delega el resto a cada sección.
 */
export function Comprobantes({ nominaIdInicial }: { nominaIdInicial?: string }) {
  const { db, cambiado, version } = useApp();
  void version;

  const nominas = repo.listarNominas(db);
  const [nominaId, setNominaId] = useState<string>(nominaIdInicial ?? nominas[0]?.id ?? '');
  const nomina = nominas.find((n) => n.id === nominaId) ?? nominas[0] ?? null;

  const [pestana, setPestana] = useState<PestanaComprobantes>('generales');
  const [filtroCodigoNd, setFiltroCodigoNd] = useState<string | null>(null);

  const [formato, setFormato] = useState<Formato>('pdf');
  const [dialogoOpciones, setDialogoOpciones] = useState(false);
  // `separarNd` es la única opción que se guarda de forma permanente (ajuste
  // global); las demás son de sesión, como siempre.
  const [opciones, setOpciones] = useState<OpcionesDibujo>(() => ({
    ...OPCIONES_DIBUJO,
    separarNd: db.ajuste('separarFacturaNd') === '1',
  }));

  function fijarOpciones(nuevas: OpcionesDibujo) {
    setOpciones(nuevas);
    db.fijarAjuste('separarFacturaNd', nuevas.separarNd ? '1' : '0');
    cambiado();
  }

  // Las dos fechas viven junto a la nómina: se fijan una vez y valen para
  // todos sus comprobantes, en las dos pestañas.
  const claveFechas = `fechas:${nominaId}`;
  const fechas: FechasNomina = useMemo(() => {
    const guardado = db.ajuste(claveFechas);
    if (guardado) {
      try {
        return JSON.parse(guardado) as FechasNomina;
      } catch {
        /* si el ajuste está corrupto se cae al valor por defecto */
      }
    }
    const fin = nomina?.fechaFin ?? '';
    return { factura: fin, nota: fin };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveFechas, nomina?.fechaFin, version]);

  function fijarFechas(nuevas: FechasNomina) {
    db.fijarAjuste(claveFechas, JSON.stringify(nuevas));
    cambiado();
  }

  function irAConfiguracion(codigo: string) {
    setFiltroCodigoNd(codigo);
    setPestana('notas-debito');
  }

  if (!nomina) {
    return (
      <Tarjeta titulo="Comprobantes">
        <Vacio icono="📄" titulo="Todavía no hay nóminas cargadas">
          Ve a «Cargar nómina» y sube el PDF del reporte para empezar.
        </Vacio>
      </Tarjeta>
    );
  }

  return (
    <>
      <div className="cabecera-pagina">
        <div>
          <h1>Comprobantes de pago</h1>
          <p>
            Selecciona proveedores para generar sus comprobantes uno a uno o en lote. El encabezado
            de cada uno usa la empresa asignada a su fábrica.
          </p>
        </div>
        <div className="acciones">
          <select value={nominaId} onChange={(e) => setNominaId(e.target.value)}>
            {nominas.map((n) => (
              <option key={n.id} value={n.id}>
                Nº {n.numero}/{n.anio} · {n.tipo === 'leche' ? 'Leche' : 'Transporte'} ·{' '}
                {n.registros} proveedores
              </option>
            ))}
          </select>
          <select
            value={formato}
            onChange={(e) => setFormato(e.target.value as Formato)}
            title="Formato de descarga"
          >
            <option value="pdf">PDF</option>
            <option value="png">Imagen</option>
          </select>
          <button className="btn" onClick={() => setDialogoOpciones(true)}>
            ⚙ Contenido
          </button>
        </div>
      </div>

      <Tarjeta
        titulo="Fechas del documento"
        descripcion="Se usan para calcular y para imprimir las notas de débito de esta nómina."
      >
        <div className="linea">
          <div className="campo">
            <label>Fecha de factura</label>
            <input
              type="date"
              value={fechas.factura}
              onChange={(e) => fijarFechas({ ...fechas, factura: e.target.value })}
            />
          </div>
          <div className="campo">
            <label>Fecha de nota de débito</label>
            <input
              type="date"
              value={fechas.nota}
              onChange={(e) => fijarFechas({ ...fechas, nota: e.target.value })}
            />
          </div>
          <div className="campo">
            <label>Semana ganadera</label>
            <input
              type="text"
              readOnly
              value={`Nº ${nomina.numero} · ${fechaAMostrar(nomina.fechaIni)} al ${fechaAMostrar(nomina.fechaFin)}`}
            />
          </div>
        </div>
      </Tarjeta>

      <div className="pestanas">
        <button
          className={`btn${pestana === 'generales' ? ' primario' : ''}`}
          onClick={() => setPestana('generales')}
        >
          Comprobantes generales
        </button>
        <button
          className={`btn${pestana === 'notas-debito' ? ' primario' : ''}`}
          onClick={() => setPestana('notas-debito')}
        >
          Notas de Débito
        </button>
      </div>

      {pestana === 'generales' && (
        <SeccionComprobantesGenerales
          nomina={nomina}
          formato={formato}
          opciones={opciones}
          fechas={fechas}
          irAConfiguracion={irAConfiguracion}
        />
      )}
      {pestana === 'notas-debito' && (
        <SeccionNotasDebito nomina={nomina} fechas={fechas} formato={formato} filtroInicial={filtroCodigoNd} />
      )}

      {dialogoOpciones && (
        <Modal
          titulo="Contenido del comprobante"
          descripcion="Se aplica a todos los comprobantes que generes."
          alCerrar={() => setDialogoOpciones(false)}
          pie={
            <button className="btn primario" onClick={() => setDialogoOpciones(false)}>
              Listo
            </button>
          }
        >
          <label className="check">
            <input
              type="checkbox"
              checked={opciones.mostrarLitrosDia}
              onChange={(e) => setOpciones({ ...opciones, mostrarLitrosDia: e.target.checked })}
            />
            <span>
              Mostrar el desglose de litros por día
              <small>Además del total de la semana, que siempre aparece.</small>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={opciones.mostrarBanco}
              onChange={(e) => setOpciones({ ...opciones, mostrarBanco: e.target.checked })}
            />
            <span>
              Mostrar banco y número de cuenta
              <small>
                Se leen del reporte y se guardan siempre; decide si quieres que salgan impresos.
              </small>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={opciones.mostrarNotaDebito}
              onChange={(e) => setOpciones({ ...opciones, mostrarNotaDebito: e.target.checked })}
            />
            <span>
              Mostrar la nota de débito
              <small>Solo aparece en los proveedores que tengan una configurada.</small>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={opciones.separarNd}
              onChange={(e) => fijarOpciones({ ...opciones, separarNd: e.target.checked })}
            />
            <span>
              Separar la nota de débito en un documento aparte
              <small>
                Si está desmarcado, la ND aparece dentro de la factura (como hoy); si la marcas, la
                factura sale limpia y la ND se descarga por separado con el botón "ND". Esta opción
                queda guardada para siempre, no se resetea entre sesiones.
              </small>
            </span>
          </label>
        </Modal>
      )}
    </>
  );
}
