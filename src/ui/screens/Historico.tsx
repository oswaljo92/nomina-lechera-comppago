import { useState } from 'react';
import { useApp } from '../estado.tsx';
import { Confirmar, Dato, Pastilla, Tarjeta, Vacio } from '../components/comunes.tsx';
import * as repo from '../../core/db/repo.ts';
import { fechaAMostrar, formatearBs, formatearEntero } from '../../core/parser/numeros.ts';
import type { TipoNomina } from '../../core/types.ts';

export function Historico({ alAbrirNomina }: { alAbrirNomina: (id: string) => void }) {
  const { db, usuario, cambiado, version, puedo } = useApp();
  void version;

  const nominas = repo.listarNominas(db);
  const [proveedor, setProveedor] = useState<{ tipo: TipoNomina; codigo: string } | null>(null);
  const [aEliminar, setAEliminar] = useState<string | null>(null);

  if (nominas.length === 0) {
    return (
      <Tarjeta titulo="Histórico">
        <Vacio icono="🗂" titulo="No hay nóminas en el histórico">
          Cuando cargues y guardes una nómina aparecerá aquí, con su evolución semana a semana.
        </Vacio>
      </Tarjeta>
    );
  }

  return (
    <>
      <div className="cabecera-pagina">
        <div>
          <h1>Histórico</h1>
          <p>
            Todas las nóminas procesadas en este equipo. Haz clic en un proveedor para ver su
            evolución entre semanas.
          </p>
        </div>
      </div>

      <div className="rejilla cuatro" style={{ marginBottom: 16 }}>
        <Dato etiqueta="Nóminas" valor={formatearEntero(nominas.length)} />
        <Dato
          etiqueta="Proveedores procesados"
          valor={formatearEntero(nominas.reduce((a, n) => a + n.registros, 0))}
        />
        <Dato
          etiqueta="Neto acumulado"
          valor={formatearBs(nominas.reduce((a, n) => a + n.neto, 0))}
          nota="Bs"
          pequeno
        />
        <Dato
          etiqueta="Total a facturar acumulado"
          valor={formatearBs(nominas.reduce((a, n) => a + n.totalFacturar, 0))}
          nota="Bs"
          pequeno
        />
      </div>

      <Tarjeta titulo="Nóminas procesadas" ajustado>
        <div className="tabla-envoltura tabla-adaptable">
          <table className="tabla">
            <thead>
              <tr>
                <th>Nómina</th>
                <th>Periodo</th>
                <th>Tipo</th>
                <th className="num">Proveedores</th>
                <th className="num">Neto</th>
                <th className="num">A facturar</th>
                <th>Cargada por</th>
                <th style={{ textAlign: 'right' }} />
              </tr>
            </thead>
            <tbody>
              {nominas.map((n) => (
                <tr key={n.id}>
                  <td className="principal">
                    <div className="nombre-prov">Nómina Nº {n.numero}</div>
                    <div className="sub">{n.anio}</div>
                  </td>
                  <td className="pequeno" data-etiqueta="Periodo">
                    {fechaAMostrar(n.fechaIni)} al {fechaAMostrar(n.fechaFin)}
                  </td>
                  <td data-etiqueta="Tipo">
                    <Pastilla tono={n.tipo === 'leche' ? 'info' : 'neutra'}>
                      {n.tipo === 'leche' ? 'Leche' : 'Transporte'}
                    </Pastilla>
                  </td>
                  <td className="num" data-etiqueta="Proveedores">{formatearEntero(n.registros)}</td>
                  <td className="num" data-etiqueta="Neto">{formatearBs(n.neto)}</td>
                  <td className="num" data-etiqueta="A facturar">{formatearBs(n.totalFacturar)}</td>
                  <td className="pequeno" data-etiqueta="Cargada por">
                    {n.usuarioNombre}
                    <div className="sub">{new Date(n.procesadoEn).toLocaleDateString('es-VE')}</div>
                  </td>
                  <td className="acciones-celda">
                    <button className="btn chico" onClick={() => alAbrirNomina(n.id)}>
                      Comprobantes
                    </button>
                    {puedo('borrar') && (
                      <button className="btn sutil chico peligro" onClick={() => setAEliminar(n.id)}>
                        Eliminar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      <BuscadorProveedor alElegir={setProveedor} />

      {proveedor && (
        <EvolucionProveedor
          tipo={proveedor.tipo}
          codigo={proveedor.codigo}
          alCerrar={() => setProveedor(null)}
        />
      )}

      {aEliminar && usuario && (
        <Confirmar
          titulo="Eliminar la nómina"
          peligro
          textoConfirmar="Eliminar definitivamente"
          mensaje={
            <>
              <p>
                Se borrarán la nómina y todos sus registros, conceptos manuales, notas de débito y
                registro de descargas. No se puede deshacer.
              </p>
              <p style={{ marginBottom: 0 }}>
                La bitácora conservará constancia de este borrado con tu nombre.
              </p>
            </>
          }
          alCerrar={() => setAEliminar(null)}
          alConfirmar={() => {
            void repo.eliminarNomina(db, usuario, aEliminar).then(() => cambiado());
          }}
        />
      )}
    </>
  );
}

function BuscadorProveedor({
  alElegir,
}: {
  alElegir: (v: { tipo: TipoNomina; codigo: string }) => void;
}) {
  const { db, version } = useApp();
  void version;
  const [texto, setTexto] = useState('');

  const resultados =
    texto.trim().length < 2
      ? []
      : db
          .todos<{ tipo: string; codigo: string; nombre: string; apariciones: number }>(
            `SELECT n.tipo AS tipo, r.codigo AS codigo, MAX(r.nombre) AS nombre, COUNT(*) AS apariciones
               FROM registros r JOIN nominas n ON n.id = r.nomina_id
              WHERE r.nombre LIKE ? OR r.codigo LIKE ?
              GROUP BY n.tipo, r.codigo
              ORDER BY apariciones DESC, nombre
              LIMIT 25`,
            [`%${texto.trim()}%`, `%${texto.trim()}%`],
          )
          .map((f) => ({ ...f, tipo: (f.tipo === 'leche' ? 'leche' : 'transporte') as TipoNomina }));

  return (
    <Tarjeta
      titulo="Evolución de un proveedor"
      descripcion="Busca por nombre o código para comparar sus litros y montos entre semanas."
    >
      <div className="buscador" style={{ maxWidth: 420 }}>
        <span className="lupa">🔍</span>
        <input
          type="text"
          placeholder="Nombre o código del proveedor"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
      </div>
      {resultados.length > 0 && (
        <div className="tabla-envoltura tabla-adaptable" style={{ marginTop: 12 }}>
          <table className="tabla">
            <tbody>
              {resultados.map((r) => (
                <tr key={`${r.tipo}-${r.codigo}`}>
                  <td>
                    <span className="nombre-prov">{r.nombre}</span>
                    <div className="sub">
                      {r.codigo} · {r.tipo === 'leche' ? 'Leche' : 'Transporte'} · {r.apariciones}{' '}
                      semana(s)
                    </div>
                  </td>
                  <td className="acciones-celda">
                    <button
                      className="btn chico"
                      onClick={() => alElegir({ tipo: r.tipo, codigo: r.codigo })}
                    >
                      Ver evolución
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Tarjeta>
  );
}

function EvolucionProveedor({
  tipo,
  codigo,
  alCerrar,
}: {
  tipo: TipoNomina;
  codigo: string;
  alCerrar: () => void;
}) {
  const { db, version } = useApp();
  void version;
  const historial = repo.historialProveedor(db, tipo, codigo);
  if (historial.length === 0) return null;

  // Del más antiguo al más reciente, para leer la evolución de izquierda a derecha.
  const filas = [...historial].reverse();

  return (
    <Tarjeta
      titulo={historial[0]!.registro.leido.nombre}
      descripcion={`Código ${codigo} · ${tipo === 'leche' ? 'Proveedor de leche' : 'Transportista'} · ${historial.length} semana(s)`}
      acciones={
        <button className="btn chico" onClick={alCerrar}>
          Cerrar
        </button>
      }
      ajustado
    >
      <div className="tabla-envoltura tabla-adaptable">
        <table className="tabla">
          <thead>
            <tr>
              <th>Semana</th>
              <th>Periodo</th>
              <th className="num">Litros</th>
              <th className="num">Variación</th>
              <th className="num">Neto</th>
              <th className="num">Variación</th>
              <th className="num">A facturar</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => {
              const previa = filas[i - 1];
              const litros = f.registro.leido.litrosTotal ?? 0;
              const litrosPrev = previa?.registro.leido.litrosTotal ?? null;
              const netoPrev = previa?.registro.neto ?? null;
              return (
                <tr key={f.nomina.id}>
                  <td className="principal">
                    <span className="nombre-prov">Semana Nº {f.nomina.numero}</span>
                    <div className="sub">{f.nomina.anio}</div>
                  </td>
                  <td className="pequeno">
                    {fechaAMostrar(f.nomina.fechaIni)} al {fechaAMostrar(f.nomina.fechaFin)}
                  </td>
                  <td className="num" data-etiqueta="Litros">{formatearEntero(litros)}</td>
                  <td className="num">
                    <Variacion actual={litros} previo={litrosPrev} formato={formatearEntero} />
                  </td>
                  <td className="num" data-etiqueta="Neto">{formatearBs(f.registro.neto)}</td>
                  <td className="num">
                    <Variacion actual={f.registro.neto} previo={netoPrev} formato={formatearBs} />
                  </td>
                  <td className="num" data-etiqueta="A facturar">{formatearBs(f.registro.totalFacturar)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Tarjeta>
  );
}

function Variacion({
  actual,
  previo,
  formato,
}: {
  actual: number;
  previo: number | null;
  formato: (n: number) => string;
}) {
  if (previo === null) return <span className="tenue">—</span>;
  const delta = actual - previo;
  if (delta === 0) return <span className="tenue">sin cambio</span>;
  const pct = previo !== 0 ? Math.round((delta / previo) * 1000) / 10 : null;
  return (
    <span style={{ color: delta > 0 ? 'var(--ok)' : 'var(--error)' }}>
      {delta > 0 ? '▲' : '▼'} {formato(Math.abs(delta))}
      {pct !== null && <span className="pequeno"> ({pct > 0 ? '+' : ''}{pct}%)</span>}
    </span>
  );
}
