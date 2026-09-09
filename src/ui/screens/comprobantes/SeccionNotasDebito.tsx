import { useState } from 'react';
import { useApp } from '../../estado.tsx';
import { Aviso, Pastilla, Tarjeta, Vacio } from '../../components/comunes.tsx';
import { ModalConceptoManual } from '../../components/ModalConceptoManual.tsx';
import { ModalNotaDebito } from '../../components/ModalNotaDebito.tsx';
import { ModalImportarNotaDebito } from '../../components/ModalImportarNotaDebito.tsx';
import { ModalResolverNotaDebito } from '../../components/ModalResolverNotaDebito.tsx';
import * as repo from '../../../core/db/repo.ts';
import { leerLibroNotasDebitoImportadas, type LecturaLibroNd } from '../../../core/db/notaDebitoExcel.ts';
import { formatearBs, formatearEntero } from '../../../core/parser/numeros.ts';
import type { NotaDebitoImportada, TipoNomina } from '../../../core/types.ts';
import type { FechasNomina } from '../Comprobantes.tsx';

const ETIQUETA_EMPAREJAMIENTO: Record<NotaDebitoImportada['emparejamiento'], { texto: string; tono: 'ok' | 'info' | 'aviso' }> = {
  codigo: { texto: 'Por código', tono: 'ok' },
  nombre: { texto: 'Por nombre', tono: 'info' },
  manual: { texto: 'Manual', tono: 'info' },
  pendiente: { texto: 'Pendiente', tono: 'aviso' },
};

export function SeccionNotasDebito({
  nomina,
  fechas,
  filtroInicial,
}: {
  nomina: repo.NominaResumen;
  fechas: FechasNomina;
  filtroInicial: string | null;
}) {
  const { db, usuario, plataforma, cambiado, puedo } = useApp();

  const [busqueda, setBusqueda] = useState(filtroInicial ?? '');
  const [importacion, setImportacion] = useState<LecturaLibroNd | null>(null);
  const [importando, setImportando] = useState(false);
  const [filaAResolver, setFilaAResolver] = useState<NotaDebitoImportada | null>(null);
  const [dialogo, setDialogo] = useState<
    { tipo: 'manual'; ids: string[] } | { tipo: 'nd'; ids: string[] } | null
  >(null);
  const [mensaje, setMensaje] = useState<{ nivel: 'ok' | 'error'; texto: string } | null>(null);

  const registros = repo.registrosDeNomina(db, nomina.id);
  const tasas = repo.tasasMapa(db);
  const precios = repo.preciosProveedor(db, nomina.tipo);
  const otroTipo: TipoNomina = nomina.tipo === 'leche' ? 'transporte' : 'leche';
  const otraNomina = repo.buscarNomina(db, otroTipo, nomina.anio, nomina.numero);
  const otrosRegistros = otraNomina ? repo.registrosDeNomina(db, otraNomina.id) : [];

  const registrosPorTipo = new Map([
    [nomina.tipo, registros],
    [otroTipo, otrosRegistros],
  ]);

  const filasImportadas = repo.notasDebitoImportadasDeNomina(db, nomina.id);
  const filasImportadasOtro = otraNomina ? repo.notasDebitoImportadasDeNomina(db, otraNomina.id) : [];
  const registroIdsUsados = new Set(
    [...filasImportadas, ...filasImportadasOtro].flatMap((f) => (f.registroId ? [f.registroId] : [])),
  );

  function registroDe(f: NotaDebitoImportada) {
    if (!f.registroId) return undefined;
    const lista = f.tipo === nomina.tipo ? registros : otrosRegistros;
    return lista.find((r) => r.id === f.registroId);
  }

  const visibles = filasImportadas.filter((f) => {
    if (!busqueda.trim()) return true;
    const t = busqueda.trim().toLowerCase();
    const nombre = registroDe(f)?.leido.nombre ?? f.proveedorExcel;
    const codigo = registroDe(f)?.leido.codigo ?? f.codigoExcel;
    return `${nombre} ${codigo}`.toLowerCase().includes(t);
  });

  async function importarExcel() {
    setMensaje(null);
    const archivo = await plataforma.archivos.abrir('.xlsx');
    if (!archivo) return;
    setImportando(true);
    try {
      const lectura = await leerLibroNotasDebitoImportadas(archivo.bytes, registrosPorTipo);
      setImportacion(lectura);
    } catch (error) {
      setMensaje({
        nivel: 'error',
        texto: `No se pudo leer el archivo: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setImportando(false);
    }
  }

  return (
    <>
      {mensaje && <Aviso nivel={mensaje.nivel === 'ok' ? 'ok' : 'error'}>{mensaje.texto}</Aviso>}

      <Tarjeta
        titulo="Notas de débito importadas"
        descripcion="Sube un Excel con la ND ya calculada por proveedor/transportista: se empareja con lo ya cargado por código o por nombre y reemplaza el cálculo automático por tasas BCV."
        acciones={
          <button className="btn" disabled={importando || !puedo('nota-debito')} onClick={() => void importarExcel()}>
            Importar Excel
          </button>
        }
      >
        <div className="filtros">
          <div className="buscador">
            <span className="lupa">🔍</span>
            <input
              type="text"
              placeholder="Buscar por nombre o código"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
          <span className="crece" />
          <span className="tenue pequeno">
            {visibles.length} de {filasImportadas.length} filas importadas
          </span>
        </div>

        {filasImportadas.length === 0 ? (
          <Vacio icono="🧾" titulo="Todavía no se ha importado ninguna nota de débito">
            Usa el botón «Importar Excel» de arriba para subir el archivo con los montos ya
            calculados.
          </Vacio>
        ) : (
          <div className="tabla-envoltura tabla-adaptable">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Proveedor</th>
                  <th>Código</th>
                  <th className="num">Litros</th>
                  <th>Fecha ND</th>
                  <th className="num">Bs. a Pagar x Dif.</th>
                  <th>Estado</th>
                  <th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((f) => {
                  const registro = registroDe(f);
                  const etiqueta = ETIQUETA_EMPAREJAMIENTO[f.emparejamiento];
                  const litros = (f.tipo === 'leche' ? f.litrosEnviados : f.litrosTransportados) ?? 0;
                  return (
                    <tr key={f.id}>
                      <td className="principal">
                        {registro ? registro.leido.nombre : <span className="tenue">{f.proveedorExcel}</span>}
                        <div className="sub">{f.tipo === 'leche' ? 'Leche' : 'Transporte'}</div>
                      </td>
                      <td data-etiqueta="Código">{registro ? registro.leido.codigo : f.codigoExcel}</td>
                      <td className="num" data-etiqueta="Litros">{formatearEntero(litros)}</td>
                      <td data-etiqueta="Fecha ND">{f.fechaNota}</td>
                      <td className="num" data-etiqueta="Bs. a Pagar x Dif.">{formatearBs(f.centimos)}</td>
                      <td data-etiqueta="Estado">
                        <Pastilla tono={etiqueta.tono}>{etiqueta.texto}</Pastilla>
                      </td>
                      <td className="acciones-celda">
                        {!f.registroId && (
                          <button
                            className="btn chico"
                            disabled={!puedo('nota-debito')}
                            onClick={() => setFilaAResolver(f)}
                          >
                            Emparejar
                          </button>
                        )}
                        {registro && (
                          <>
                            <button
                              className="btn sutil chico"
                              title="Agregar concepto manual"
                              disabled={!puedo('concepto-manual')}
                              onClick={() => setDialogo({ tipo: 'manual', ids: [registro.id] })}
                            >
                              + Concepto
                            </button>
                            <button
                              className="btn sutil chico"
                              title="Configurar nota de débito manual (se ignora mientras haya import)"
                              disabled={!puedo('nota-debito')}
                              onClick={() => setDialogo({ tipo: 'nd', ids: [registro.id] })}
                            >
                              $ ND manual
                            </button>
                          </>
                        )}
                        <button
                          className="btn sutil chico peligro"
                          disabled={!puedo('nota-debito')}
                          onClick={() => {
                            void repo.eliminarNotaDebitoImportada(db, usuario!, f.id).then(() => cambiado());
                          }}
                        >
                          Quitar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>

      {importacion && (
        <ModalImportarNotaDebito
          importacion={importacion}
          alCerrar={() => setImportacion(null)}
          alImportar={() => {
            if (!usuario) return;
            const filas: repo.FilaNdImportadaAGuardar[] = importacion.filas.map((f) => {
              const registro = f.candidatos.length === 1 && f.emparejamiento !== 'sin-emparejar' ? f.candidatos[0] : undefined;
              return {
                nominaId: registro ? registro.nominaId : nomina.id,
                registroId: registro ? registro.id : null,
                tipo: f.fila.tipo,
                codigoExcel: f.fila.codigoExcel,
                proveedorExcel: f.fila.proveedorExcel,
                fabricaExcel: f.fila.fabricaExcel,
                sapExcel: f.fila.sapExcel,
                fechaNota: f.fila.fechaNota,
                litrosEnviados: f.fila.litrosEnviados,
                litrosTransportados: f.fila.litrosTransportados,
                precioUsdLts: f.fila.precioUsdLts,
                precioUsdFlete: f.fila.precioUsdFlete,
                bsXLtsInicio: f.fila.bsXLtsInicio,
                bsXLtsAjustado: f.fila.bsXLtsAjustado,
                difXLts: f.fila.difXLts,
                centimos: f.fila.centimos,
                emparejamiento: f.emparejamiento === 'sin-emparejar' ? 'pendiente' : f.emparejamiento,
              };
            });
            void repo.guardarNotasDebitoImportadas(db, usuario, nomina.id, filas).then(() => {
              cambiado();
              setImportacion(null);
              setMensaje({ nivel: 'ok', texto: `Se importaron ${filas.length} fila(s).` });
            });
          }}
        />
      )}

      {filaAResolver && (
        <ModalResolverNotaDebito
          fila={filaAResolver}
          candidatos={(filaAResolver.tipo === nomina.tipo ? registros : otrosRegistros).filter(
            (r) => !registroIdsUsados.has(r.id),
          )}
          alCerrar={() => setFilaAResolver(null)}
          alConfirmar={(registroId) => {
            if (!usuario) return;
            void repo.resolverNotaDebitoImportada(db, usuario, filaAResolver.id, registroId).then(() => {
              cambiado();
              setFilaAResolver(null);
            });
          }}
        />
      )}

      {dialogo?.tipo === 'manual' && usuario && (
        <ModalConceptoManual
          cantidad={dialogo.ids.length}
          catalogo={repo.listarCatalogo(db)}
          existentes={registros.find((r) => r.id === dialogo.ids[0])?.manuales}
          alCerrar={() => setDialogo(null)}
          alAceptar={(datos) => {
            void repo.agregarConceptoManual(db, usuario, dialogo.ids, datos).then(() => {
              cambiado();
              setDialogo(null);
            });
          }}
          alEditar={(id, datos) => {
            void repo.editarConceptoManual(db, usuario, id, datos).then(() => {
              cambiado();
              setDialogo(null);
            });
          }}
          alEliminar={(id) => {
            void repo.eliminarConceptoManual(db, usuario, id).then(() => {
              cambiado();
              setDialogo(null);
            });
          }}
        />
      )}

      {dialogo?.tipo === 'nd' && usuario && (
        <ModalNotaDebito
          registros={[...registros, ...otrosRegistros].filter((r) => dialogo.ids.includes(r.id))}
          fechaIniSemana={nomina.fechaIni}
          fechaFactura={fechas.factura}
          fechaNota={fechas.nota}
          tasas={tasas}
          preciosGuardados={precios}
          codigosImportados={new Set(filasImportadas.filter((f) => f.registroId).map((f) => registroDe(f)?.leido.codigo ?? ''))}
          alCerrar={() => setDialogo(null)}
          alQuitar={() => {
            void repo.quitarNotaDebito(db, usuario, dialogo.ids).then(() => {
              cambiado();
              setDialogo(null);
            });
          }}
          alAceptar={({ params, precioPorRegistro, preciosPropios }) => {
            for (const [codigo, precio] of preciosPropios) {
              repo.guardarPrecioProveedor(db, nomina.tipo, codigo, precio);
            }
            void repo.guardarNotaDebito(db, usuario, dialogo.ids, params, precioPorRegistro).then(() => {
              cambiado();
              setDialogo(null);
            });
          }}
        />
      )}
    </>
  );
}
