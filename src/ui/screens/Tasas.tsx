import { useState } from 'react';
import { useApp } from '../estado.tsx';
import { Aviso, Pastilla, Tarjeta, Vacio } from '../components/comunes.tsx';
import * as repo from '../../core/db/repo.ts';
import { diasEntre, fechaAMostrar, formatearDecimal } from '../../core/parser/numeros.ts';

/**
 * Carga manual de las tasas del BCV.
 *
 * La aplicación no supone tasas: si falta la de una fecha usada en un cálculo,
 * la nota de débito no se genera y se dice qué falta. Rellenar el hueco con la
 * tasa del día anterior produciría un monto plausible pero equivocado, y nadie
 * lo notaría.
 */
export function Tasas() {
  const { db, usuario, cambiado, version, puedo } = useApp();
  void version;

  const tasas = repo.listarTasas(db);
  const mapa = new Map(tasas.map((t) => [t.fecha, t.tasa]));
  const nominas = repo.listarNominas(db);
  const editable = puedo('cargar-tasas');

  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [valor, setValor] = useState('');
  const [error, setError] = useState<string | null>(null);

  function guardar(f: string, v: string) {
    if (!usuario) return;
    const numero = Number(v.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(numero) || numero <= 0) {
      setError('La tasa debe ser un número mayor que cero. Ej: 210,45');
      return;
    }
    setError(null);
    void repo.guardarTasa(db, usuario, f, numero).then(() => cambiado());
  }

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

      {/* Estado de cobertura por semana ganadera cargada */}
      {nominas.length > 0 && (
        <Tarjeta
          titulo="Cobertura por semana ganadera"
          descripcion="Los días de cada nómina cargada y si tienen tasa. El día de inicio es el que usa el cálculo de la nota de débito."
        >
          {[...new Map(nominas.map((n) => [`${n.anio}-${n.numero}`, n])).values()].map((n) => {
            const dias = diasEntre(n.fechaIni, n.fechaFin);
            const faltan = dias.filter((d) => !mapa.has(d));
            return (
              <div key={`${n.anio}-${n.numero}`} style={{ marginBottom: 14 }}>
                <div className="entre" style={{ marginBottom: 6 }}>
                  <strong>
                    Nómina Nº {n.numero} · {n.anio}
                  </strong>
                  {faltan.length === 0 ? (
                    <Pastilla tono="ok">Semana completa</Pastilla>
                  ) : (
                    <Pastilla tono="aviso">Faltan {faltan.length} de {dias.length} días</Pastilla>
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
          })}
        </Tarjeta>
      )}

      <Tarjeta titulo={`Todas las tasas (${tasas.length})`} ajustado>
        {tasas.length === 0 ? (
          <Vacio icono="💱" titulo="Aún no has cargado ninguna tasa">
            Sin tasas no se pueden calcular notas de débito.
          </Vacio>
        ) : (
          <div className="tabla-envoltura tabla-adaptable" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th className="num">Bs por dólar</th>
                  <th style={{ textAlign: 'right' }} />
                </tr>
              </thead>
              <tbody>
                {tasas.map((t) => (
                  <tr key={t.fecha}>
                    <td className="principal">{fechaAMostrar(t.fecha)}</td>
                    <td className="num" data-etiqueta="Bs por dólar">{formatearDecimal(t.tasa, 4)}</td>
                    <td className="acciones-celda">
                      <button
                        className="btn sutil chico"
                        disabled={!editable || !usuario}
                        onClick={() => {
                          if (!usuario) return;
                          void repo.eliminarTasa(db, usuario, t.fecha).then(() => cambiado());
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
        )}
      </Tarjeta>
    </>
  );
}
