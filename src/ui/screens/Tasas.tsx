import { useState } from 'react';
import { useApp } from '../estado.tsx';
import { Aviso, Dato, Modal, Pastilla, Tarjeta, Vacio } from '../components/comunes.tsx';
import * as repo from '../../core/db/repo.ts';
import type { NominaResumen } from '../../core/db/repo.ts';
import { diasEntre, fechaAMostrar, formatearDecimal, nombreDia } from '../../core/parser/numeros.ts';
import {
  construirLibroTasas,
  leerLibroTasas,
  type FilaTasaExcel,
  type FilaTasaImportada,
} from '../../core/db/tasasExcel.ts';

function semanaDe(fecha: string, semanas: NominaResumen[]): NominaResumen | undefined {
  return semanas.find((s) => fecha >= s.fechaIni && fecha <= s.fechaFin);
}

function esJueves(fecha: string): boolean {
  return new Date(`${fecha}T00:00:00Z`).getUTCDay() === 4;
}

function construirFilas(
  tasas: { fecha: string; tasa: number }[],
  semanas: NominaResumen[],
  mapa: Map<string, number>,
): FilaTasaExcel[] {
  return tasas.map((t) => {
    const semana = semanaDe(t.fecha, semanas);
    const tasaMiercoles = semana ? mapa.get(semana.fechaIni) : undefined;
    const difCambio = semana && tasaMiercoles !== undefined ? t.tasa - tasaMiercoles : null;
    return {
      fecha: t.fecha,
      dia: nombreDia(t.fecha),
      semanaGanadera: semana ? `Nº ${semana.numero} · ${semana.anio}` : '',
      tasa: t.tasa,
      difCambio,
      esJueves: esJueves(t.fecha),
    };
  });
}

/**
 * Carga manual de las tasas del BCV.
 *
 * La aplicación no supone tasas: si falta la de una fecha usada en un cálculo,
 * la nota de débito no se genera y se dice qué falta. Rellenar el hueco con la
 * tasa del día anterior produciría un monto plausible pero equivocado, y nadie
 * lo notaría.
 */
export function Tasas() {
  const { db, usuario, plataforma, cambiado, version, puedo } = useApp();
  void version;

  const tasas = repo.listarTasas(db);
  const mapa = new Map(tasas.map((t) => [t.fecha, t.tasa]));
  const nominas = repo.listarNominas(db);
  const semanas = [...new Map(nominas.map((n) => [`${n.anio}-${n.numero}`, n])).values()];
  const editable = puedo('cargar-tasas');
  const filas = construirFilas(tasas, semanas, mapa);

  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [valor, setValor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [semanaElegida, setSemanaElegida] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [valorMasivo, setValorMasivo] = useState('');
  const [importacion, setImportacion] = useState<{
    filas: FilaTasaImportada[];
    errores: string[];
  } | null>(null);

  const claveSemana =
    semanaElegida && semanas.some((s) => `${s.anio}-${s.numero}` === semanaElegida)
      ? semanaElegida
      : semanas[0]
        ? `${semanas[0].anio}-${semanas[0].numero}`
        : null;
  const semanaActual = semanas.find((s) => `${s.anio}-${s.numero}` === claveSemana);

  function parsearTasa(v: string): number | null {
    const numero = Number(v.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(numero) && numero > 0 ? numero : null;
  }

  function guardar(f: string, v: string) {
    if (!usuario) return;
    const numero = parsearTasa(v);
    if (numero === null) {
      setError('La tasa debe ser un número mayor que cero. Ej: 210,45');
      return;
    }
    setError(null);
    void repo.guardarTasa(db, usuario, f, numero).then(() => cambiado());
  }

  async function guardarMasivo(fechas: string[], v: string) {
    if (!usuario) return;
    const numero = parsearTasa(v);
    if (numero === null) {
      setError('La tasa debe ser un número mayor que cero. Ej: 210,45');
      return;
    }
    setError(null);
    // Secuencial, no Promise.all: la bitácora encadena cada entrada con el
    // hash de la anterior calculando "id = último + 1" antes de insertar, así
    // que dos guardarTasa concurrentes pueden leer el mismo último id y
    // chocar al insertar.
    for (const f of fechas) {
      await repo.guardarTasa(db, usuario, f, numero);
    }
    cambiado();
    setSeleccion(new Set());
    setValorMasivo('');
  }

  async function descargarExcel() {
    // La tabla en pantalla queda como está; el Excel siempre sale ordenado
    // de fecha menor a mayor, más fácil de revisar semana a semana.
    const filasAscendentes = [...filas].sort((a, b) => a.fecha.localeCompare(b.fecha));
    const bytes = await construirLibroTasas(filasAscendentes);
    const fechaHoy = new Date().toISOString().slice(0, 10);
    await plataforma.archivos.guardar(
      `tasas_comppago_${fechaHoy}.xlsx`,
      new Blob([new Uint8Array(bytes) as unknown as ArrayBufferView<ArrayBuffer>], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
  }

  async function importarExcel() {
    const archivo = await plataforma.archivos.abrir('.xlsx');
    if (!archivo) return;
    const lectura = await leerLibroTasas(archivo.bytes);
    setImportacion(lectura);
  }

  async function confirmarImportacion() {
    if (!usuario || !importacion) return;
    // Secuencial por la misma razón que guardarMasivo: la bitácora no
    // tolera inserciones concurrentes.
    for (const f of importacion.filas) {
      await repo.guardarTasa(db, usuario, f.fecha, f.tasa);
    }
    cambiado();
    setImportacion(null);
  }

  const todosSeleccionados = filas.length > 0 && filas.every((f) => seleccion.has(f.fecha));

  return (
    <>
      <div className="cabecera-pagina">
        <div>
          <h1>Tasas del BCV</h1>
          <p>
            Se cargan a mano, día por día. Sirven para calcular las notas de débito por diferencial
            cambiario y para convertir el precio de la leche entre bolívares y dólares.
          </p>
        </div>
      </div>

      {!editable && <Aviso nivel="aviso">Tu usuario no puede cargar tasas.</Aviso>}
      {error && <Aviso nivel="error">{error}</Aviso>}

      <Tarjeta titulo="Agregar o corregir una tasa">
        <div className="linea">
          <div className="campo">
            <label>Fecha</label>
            <input
              type="date"
              value={fecha}
              disabled={!editable}
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>
          <div className="campo">
            <label>Bolívares por dólar</label>
            <input
              type="text"
              className="numero"
              value={valor}
              placeholder="210,4500"
              disabled={!editable}
              onChange={(e) => setValor(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  guardar(fecha, valor);
                  setValor('');
                }
              }}
            />
          </div>
          <button
            className="btn primario"
            disabled={!editable || valor.trim() === ''}
            onClick={() => {
              guardar(fecha, valor);
              setValor('');
            }}
          >
            Guardar
          </button>
        </div>
        {mapa.has(fecha) && (
          <p className="tenue pequeno" style={{ marginTop: 8 }}>
            Ya hay una tasa para esa fecha ({formatearDecimal(mapa.get(fecha)!, 4)}). Guardar la
            reemplazará.
          </p>
        )}
      </Tarjeta>

      {/* Estado de cobertura de la semana ganadera elegida */}
      {semanas.length > 0 && (
        <Tarjeta
          titulo="Cobertura por semana ganadera"
          descripcion="Los días de la nómina elegida y si tienen tasa. El día de inicio es el que usa el cálculo de la nota de débito."
          acciones={
            <select value={claveSemana ?? ''} onChange={(e) => setSemanaElegida(e.target.value)}>
              {semanas.map((s) => (
                <option key={`${s.anio}-${s.numero}`} value={`${s.anio}-${s.numero}`}>
                  Nómina Nº {s.numero} · {s.anio}
                </option>
              ))}
            </select>
          }
        >
          {semanaActual &&
            (() => {
              const dias = diasEntre(semanaActual.fechaIni, semanaActual.fechaFin);
              const faltan = dias.filter((d) => !mapa.has(d));
              return (
                <div>
                  <div className="entre" style={{ marginBottom: 6 }}>
                    <strong>
                      Nómina Nº {semanaActual.numero} · {semanaActual.anio}
                    </strong>
                    {faltan.length === 0 ? (
                      <Pastilla tono="ok">Semana completa</Pastilla>
                    ) : (
                      <Pastilla tono="aviso">
                        Faltan {faltan.length} de {dias.length} días
                      </Pastilla>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {dias.map((d, i) => {
                      const tiene = mapa.has(d);
                      return (
                        <div
                          key={d}
                          className="dato"
                          style={{
                            minWidth: 116,
                            padding: '7px 9px',
                            borderColor: tiene ? 'var(--borde)' : 'var(--error)',
                          }}
                        >
                          <div className="etiqueta">
                            {fechaAMostrar(d).slice(0, 5)}
                            {i === 0 && ' · inicio'}
                          </div>
                          {tiene ? (
                            <div className="valor pequeno">{formatearDecimal(mapa.get(d)!, 4)}</div>
                          ) : (
                            <input
                              type="text"
                              className="numero"
                              placeholder="Sin tasa"
                              disabled={!editable}
                              style={{ padding: '2px 5px', fontSize: 12, marginTop: 3 }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') guardar(d, e.currentTarget.value);
                              }}
                              onBlur={(e) => {
                                if (e.currentTarget.value.trim()) guardar(d, e.currentTarget.value);
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
        </Tarjeta>
      )}

      <Tarjeta
        titulo={`Todas las tasas (${tasas.length})`}
        ajustado
        acciones={
          <>
            <button className="btn chico" onClick={() => void descargarExcel()}>
              ⬇ Descargar Excel
            </button>
            <button className="btn chico" disabled={!editable} onClick={() => void importarExcel()}>
              ⬆ Importar Excel
            </button>
          </>
        }
      >
        {tasas.length === 0 ? (
          <Vacio icono="💱" titulo="Aún no has cargado ninguna tasa">
            Sin tasas no se pueden calcular notas de débito.
          </Vacio>
        ) : (
          <>
            {seleccion.size > 0 && (
              <div className="barra-lote">
                <span className="conteo">{seleccion.size} seleccionada(s)</span>
                <input
                  type="text"
                  className="numero"
                  placeholder="Nueva tasa"
                  value={valorMasivo}
                  onChange={(e) => setValorMasivo(e.target.value)}
                  style={{ width: 110 }}
                />
                <button
                  className="btn chico primario"
                  disabled={valorMasivo.trim() === ''}
                  onClick={() => void guardarMasivo([...seleccion], valorMasivo)}
                >
                  Aplicar a {seleccion.size} seleccionada(s)
                </button>
                <button className="btn chico" onClick={() => setSeleccion(new Set())}>
                  Cancelar
                </button>
              </div>
            )}
            <div className="tabla-envoltura tabla-adaptable" style={{ maxHeight: 420, overflowY: 'auto' }}>
              <table className="tabla">
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>
                      <input
                        type="checkbox"
                        checked={todosSeleccionados}
                        onChange={() => {
                          setSeleccion(
                            todosSeleccionados ? new Set() : new Set(filas.map((f) => f.fecha)),
                          );
                        }}
                      />
                    </th>
                    <th>Fecha</th>
                    <th>Día</th>
                    <th>Semana ganadera</th>
                    <th className="num">Tasa BCV</th>
                    <th className="num">Dif. cambio</th>
                    <th style={{ textAlign: 'right' }} />
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.fecha} style={f.esJueves ? { background: 'var(--verde-50)' } : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          checked={seleccion.has(f.fecha)}
                          onChange={() => {
                            const copia = new Set(seleccion);
                            if (copia.has(f.fecha)) copia.delete(f.fecha);
                            else copia.add(f.fecha);
                            setSeleccion(copia);
                          }}
                        />
                      </td>
                      <td className="principal">{fechaAMostrar(f.fecha)}</td>
                      <td>{f.dia}</td>
                      <td>{f.semanaGanadera || '—'}</td>
                      <td className="num" data-etiqueta="Tasa BCV">
                        <input
                          key={`${f.fecha}:${f.tasa}`}
                          type="text"
                          className="numero"
                          defaultValue={formatearDecimal(f.tasa, 4)}
                          disabled={!editable}
                          style={{ padding: '2px 5px', fontSize: 12, width: 90 }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') guardar(f.fecha, e.currentTarget.value);
                          }}
                          onBlur={(e) => {
                            if (e.currentTarget.value.trim()) guardar(f.fecha, e.currentTarget.value);
                          }}
                        />
                      </td>
                      <td
                        className="num"
                        data-etiqueta="Dif. cambio"
                        style={f.esJueves ? { fontWeight: 700 } : undefined}
                      >
                        {f.difCambio === null ? '—' : formatearDecimal(f.difCambio, 4)}
                      </td>
                      <td className="acciones-celda">
                        <button
                          className="btn sutil chico"
                          disabled={!editable || !usuario}
                          onClick={() => {
                            if (!usuario) return;
                            void repo.eliminarTasa(db, usuario, f.fecha).then(() => cambiado());
                          }}
                        >
                          Quitar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Tarjeta>

      {importacion && (
        <ModalImportarTasas
          importacion={importacion}
          existentes={mapa}
          alCerrar={() => setImportacion(null)}
          alImportar={() => void confirmarImportacion()}
        />
      )}
    </>
  );
}

function ModalImportarTasas({
  importacion,
  existentes,
  alCerrar,
  alImportar,
}: {
  importacion: { filas: FilaTasaImportada[]; errores: string[] };
  existentes: Map<string, number>;
  alCerrar: () => void;
  alImportar: () => void;
}) {
  const nuevas = importacion.filas.filter((f) => !existentes.has(f.fecha));
  const reemplazan = importacion.filas.filter((f) => existentes.has(f.fecha));

  return (
    <Modal
      ancho
      titulo="Importar tasas desde Excel"
      alCerrar={alCerrar}
      pie={
        <>
          <button className="btn" onClick={alCerrar}>
            Cancelar
          </button>
          <button
            className="btn primario"
            disabled={importacion.filas.length === 0}
            onClick={alImportar}
          >
            Importar {importacion.filas.length} tasa(s)
          </button>
        </>
      }
    >
      {importacion.errores.length > 0 && (
        <Aviso nivel="aviso" titulo="Algunas filas no se pudieron leer">
          {importacion.errores.join(' · ')}
        </Aviso>
      )}

      {importacion.filas.length === 0 ? (
        <Vacio icono="💱" titulo="No hay filas válidas para importar" />
      ) : (
        <>
          <div className="rejilla cuatro" style={{ marginBottom: 14 }}>
            <Dato etiqueta="Fechas nuevas" valor={String(nuevas.length)} />
            <Dato etiqueta="Reemplazan una tasa" valor={String(reemplazan.length)} />
          </div>
          <div className="tabla-envoltura tabla-adaptable" style={{ maxHeight: 280, overflowY: 'auto' }}>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th className="num">Tasa BCV</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {importacion.filas.map((f) => (
                  <tr key={f.fecha}>
                    <td className="principal">{fechaAMostrar(f.fecha)}</td>
                    <td className="num">{formatearDecimal(f.tasa, 4)}</td>
                    <td>
                      {existentes.has(f.fecha) ? (
                        <Pastilla tono="aviso">Reemplaza</Pastilla>
                      ) : (
                        <Pastilla tono="ok">Nueva</Pastilla>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
