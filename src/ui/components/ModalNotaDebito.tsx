import { useMemo, useState } from 'react';
import { Aviso, Campo, Modal, Pastilla } from './comunes.tsx';
import {
  bsAUsd,
  calcularNotaDebito,
  usdABs,
} from '../../core/calc/calcular.ts';
import {
  fechaAMostrar,
  formatearBs,
  formatearDecimal,
  formatearEntero,
} from '../../core/parser/numeros.ts';
import type { FechaCalculoNd, ParametrosNotaDebito } from '../../core/types.ts';
import type { RegistroGuardado } from '../../core/db/repo.ts';

export interface ResultadoModalNd {
  params: ParametrosNotaDebito;
  precioPorRegistro: Map<string, number>;
  /** Precios que el usuario cambió en una fila concreta, para recordarlos. */
  preciosPropios: Map<string, number>;
}

/**
 * Configuración de la nota de débito por diferencial cambiario.
 *
 *   NOTA DE DÉBITO = litros × precio $/L × ( tasa[fecha elegida] − tasa[inicio de semana] )
 *
 * El precio se puede escribir en bolívares o en dólares; se convierten entre sí
 * con la tasa del día de inicio de la semana ganadera, que es la misma que sirve
 * de referencia en el cálculo.
 */
export function ModalNotaDebito({
  registros,
  fechaIniSemana,
  fechaFactura,
  fechaNota,
  tasas,
  preciosGuardados,
  codigosImportados,
  alCerrar,
  alAceptar,
  alQuitar,
}: {
  registros: RegistroGuardado[];
  fechaIniSemana: string;
  fechaFactura: string;
  fechaNota: string;
  tasas: Map<string, number>;
  preciosGuardados: Map<string, number>;
  /** Códigos que ya tienen una ND importada de Excel: el documento final
   * usará ese valor sin importar lo que se configure aquí. */
  codigosImportados?: Set<string>;
  alCerrar: () => void;
  alAceptar: (resultado: ResultadoModalNd) => void;
  alQuitar: () => void;
}) {
  const tasaIni = tasas.get(fechaIniSemana);
  const [fechaCalculo, setFechaCalculo] = useState<FechaCalculoNd>('factura');
  const [precioUsd, setPrecioUsd] = useState('');
  const [precioBs, setPrecioBs] = useState('');
  const [propios, setPropios] = useState<Map<string, number>>(new Map());

  const general = Number(precioUsd.replace(',', '.'));
  const generalValido = Number.isFinite(general) && general > 0;

  const params: ParametrosNotaDebito = {
    precioUsd: generalValido ? general : 0,
    fechaFactura,
    fechaNota,
    fechaCalculo,
  };

  const fechaUsada = fechaCalculo === 'factura' ? fechaFactura : fechaNota;
  const tasaFin = tasas.get(fechaUsada);
  const faltanTasas: string[] = [];
  if (tasaIni === undefined) faltanTasas.push(fechaIniSemana);
  if (tasaFin === undefined) faltanTasas.push(fechaUsada);

  /** Precio efectivo: el propio del proveedor manda sobre el general. */
  const precioDe = (r: RegistroGuardado): number =>
    propios.get(r.id) ?? preciosGuardados.get(r.leido.codigo) ?? (generalValido ? general : 0);

  const filas = useMemo(
    () =>
      registros.map((r) => {
        const precio = precioDe(r);
        const resultado = calcularNotaDebito(
          { ...params, precioUsd: precio },
          r.leido.litrosTotal,
          fechaIniSemana,
          tasas,
        );
        const origen = propios.has(r.id)
          ? 'editado'
          : preciosGuardados.has(r.leido.codigo)
            ? 'propio'
            : 'general';
        return { r, precio, resultado, origen };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registros, propios, preciosGuardados, general, fechaCalculo, tasas, fechaIniSemana],
  );

  const totalNd = filas.reduce((a, f) => a + (f.resultado.aplica ? f.resultado.centimos : 0), 0);
  const calculables = filas.filter((f) => f.resultado.aplica).length;

  function fijarDesdeUsd(valor: string) {
    setPrecioUsd(valor);
    const n = Number(valor.replace(',', '.'));
    setPrecioBs(Number.isFinite(n) && tasaIni ? formatearDecimal(usdABs(n, tasaIni), 4) : '');
  }

  function fijarDesdeBs(valor: string) {
    setPrecioBs(valor);
    const n = Number(valor.replace(/\./g, '').replace(',', '.'));
    setPrecioUsd(Number.isFinite(n) && tasaIni ? String(Number(bsAUsd(n, tasaIni).toFixed(6))) : '');
  }

  return (
    <Modal
      ancho
      titulo="Nota de débito por diferencial cambiario"
      descripcion={`${registros.length} proveedor${registros.length === 1 ? '' : 'es'} seleccionado${registros.length === 1 ? '' : 's'}.`}
      alCerrar={alCerrar}
      pie={
        <>
          <button className="btn peligro" onClick={alQuitar}>
            Quitar nota de débito
          </button>
          <span className="crece" />
          <button className="btn" onClick={alCerrar}>
            Cancelar
          </button>
          <button
            className="btn primario"
            disabled={calculables === 0}
            onClick={() =>
              alAceptar({
                params,
                precioPorRegistro: new Map(filas.map((f) => [f.r.id, f.precio])),
                preciosPropios: new Map(
                  [...propios].flatMap(([id, precio]) => {
                    const reg = registros.find((r) => r.id === id);
                    return reg ? [[reg.leido.codigo, precio] as [string, number]] : [];
                  }),
                ),
              })
            }
          >
            Aplicar a {calculables} proveedor{calculables === 1 ? '' : 'es'}
          </button>
        </>
      }
    >
      {codigosImportados && registros.some((r) => codigosImportados.has(r.leido.codigo)) && (
        <Aviso nivel="info" titulo="Algunos ya tienen una ND importada de Excel">
          {registros.filter((r) => codigosImportados.has(r.leido.codigo)).length} de {registros.length}{' '}
          proveedores seleccionados ya tienen una nota de débito importada desde la pestaña «Notas de
          Débito»; el documento final usará ese valor, sin importar lo que configures aquí.
        </Aviso>
      )}

      {faltanTasas.length > 0 && (
        <Aviso nivel="error" titulo="Faltan tasas del BCV">
          No hay tasa cargada para {faltanTasas.map(fechaAMostrar).join(' y ')}. Cárgalas en la
          sección «Tasas BCV» y vuelve aquí: sin ellas no se calcula nada, para no inventar cifras.
        </Aviso>
      )}

      <div className="rejilla dos">
        <div>
          <h3 style={{ marginBottom: 8 }}>Fecha que fija la tasa</h3>
          <Campo
            etiqueta="¿Cuál fecha usa el cálculo?"
            ayuda="La otra fecha se imprime en el comprobante solo como referencia."
          >
            <select
              value={fechaCalculo}
              onChange={(e) => setFechaCalculo(e.target.value as FechaCalculoNd)}
            >
              <option value="factura">Fecha de factura — {fechaAMostrar(fechaFactura)}</option>
              <option value="nota">Fecha de nota de débito — {fechaAMostrar(fechaNota)}</option>
            </select>
          </Campo>

          <div className="rejilla tres">
            <div className="dato">
              <div className="etiqueta">Tasa inicio semana</div>
              <div className="valor pequeno">
                {tasaIni !== undefined ? formatearDecimal(tasaIni, 4) : '— falta'}
              </div>
              <div className="nota">{fechaAMostrar(fechaIniSemana)}</div>
            </div>
            <div className="dato">
              <div className="etiqueta">Tasa de cálculo</div>
              <div className="valor pequeno">
                {tasaFin !== undefined ? formatearDecimal(tasaFin, 4) : '— falta'}
              </div>
              <div className="nota">{fechaAMostrar(fechaUsada)}</div>
            </div>
            <div className="dato">
              <div className="etiqueta">Diferencia</div>
              <div className="valor pequeno">
                {tasaIni !== undefined && tasaFin !== undefined
                  ? formatearDecimal(tasaFin - tasaIni, 4)
                  : '—'}
              </div>
              <div className="nota">Bs por dólar</div>
            </div>
          </div>
        </div>

        <div>
          <h3 style={{ marginBottom: 8 }}>Precio de la leche</h3>
          <p className="tenue pequeno" style={{ marginTop: 0 }}>
            Escribe uno de los dos y el otro se calcula con la tasa del inicio de semana. Se aplica
            a todos los seleccionados, salvo a quienes tengan precio propio.
          </p>
          <div className="linea">
            <Campo etiqueta="Dólares por litro">
              <input
                type="text"
                className="numero"
                value={precioUsd}
                placeholder="2,45"
                onChange={(e) => fijarDesdeUsd(e.target.value)}
              />
            </Campo>
            <Campo etiqueta="Bolívares por litro">
              <input
                type="text"
                className="numero"
                value={precioBs}
                placeholder="490,00"
                disabled={tasaIni === undefined}
                onChange={(e) => fijarDesdeBs(e.target.value)}
              />
            </Campo>
          </div>
          <div className="dato" style={{ marginTop: 4 }}>
            <div className="etiqueta">Total de notas de débito</div>
            <div className="valor">{formatearBs(totalNd)} Bs</div>
            <div className="nota">
              {calculables} de {registros.length} se pueden calcular
            </div>
          </div>
        </div>
      </div>

      <div className="sep" />

      <div className="tabla-envoltura" style={{ maxHeight: 300, overflowY: 'auto' }}>
        <table className="tabla">
          <thead>
            <tr>
              <th>Proveedor</th>
              <th className="num">Litros</th>
              <th className="num">Precio $/L</th>
              <th>Origen</th>
              <th className="num">Nota de débito</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(({ r, precio, resultado, origen }) => (
              <tr key={r.id}>
                <td>
                  <div className="nombre-prov">{r.leido.nombre}</div>
                  <div className="sub">
                    {r.leido.codigo} · ruta {r.leido.ruta}
                  </div>
                </td>
                <td className="num">{formatearEntero(r.leido.litrosTotal ?? 0)}</td>
                <td className="num" style={{ width: 120 }}>
                  <input
                    type="text"
                    className="numero"
                    style={{ padding: '3px 6px', fontSize: 12 }}
                    value={precio > 0 ? String(precio) : ''}
                    placeholder="—"
                    onChange={(e) => {
                      const n = Number(e.target.value.replace(',', '.'));
                      const copia = new Map(propios);
                      if (e.target.value.trim() === '') copia.delete(r.id);
                      else if (Number.isFinite(n)) copia.set(r.id, n);
                      setPropios(copia);
                    }}
                  />
                </td>
                <td>
                  <Pastilla tono={origen === 'general' ? 'neutra' : 'info'}>
                    {origen === 'general' ? 'General' : origen === 'propio' ? 'Propio' : 'Editado'}
                  </Pastilla>
                </td>
                <td className="num">
                  {resultado.aplica ? (
                    formatearBs(resultado.centimos)
                  ) : (
                    <span className="tenue pequeno">No calculable</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tenue pequeno" style={{ marginTop: 8 }}>
        Los precios que edites aquí quedan guardados para ese proveedor y se recordarán en las
        próximas semanas.
      </p>
    </Modal>
  );
}
