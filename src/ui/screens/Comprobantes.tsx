import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../estado.tsx';
import { Aviso, Dato, Modal, Pastilla, Semaforo, Tarjeta, Vacio } from '../components/comunes.tsx';
import { ModalConceptoManual } from '../components/ModalConceptoManual.tsx';
import { ModalNotaDebito } from '../components/ModalNotaDebito.tsx';
import { ModalVinculo } from '../components/ModalVinculo.tsx';
import { VistaPrevia } from '../components/VistaPrevia.tsx';
import * as repo from '../../core/db/repo.ts';
import { construirComprobante, type ContextoComprobante, type DatosComprobante } from '../../core/receipt/comprobante.ts';
import { construirComprobanteCombinado } from '../../core/receipt/comprobanteCombinado.ts';
import { OPCIONES_DIBUJO, type OpcionesDibujo } from '../../core/receipt/dibujo.ts';
import { nombreLote } from '../../core/receipt/nombreArchivo.ts';
import {
  empaquetarZip,
  generarComprobantes,
  generarNotasDebito,
  type Formato,
  type ItemAGenerar,
} from '../salida/generar.ts';
import { fechaAMostrar, formatearBs, formatearEntero } from '../../core/parser/numeros.ts';
import type { NivelValidacion, TipoNomina } from '../../core/types.ts';

interface FechasNomina {
  factura: string;
  nota: string;
}

export function Comprobantes({ nominaIdInicial }: { nominaIdInicial?: string }) {
  const { db, usuario, plataforma, cambiado, version, puedo } = useApp();
  void version;

  const nominas = repo.listarNominas(db);
  const [nominaId, setNominaId] = useState<string>(nominaIdInicial ?? nominas[0]?.id ?? '');
  const nomina = nominas.find((n) => n.id === nominaId) ?? nominas[0] ?? null;

  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [busqueda, setBusqueda] = useState('');
  const [fabrica, setFabrica] = useState('');
  const [soloConNd, setSoloConNd] = useState(false);
  const [opciones, setOpciones] = useState<OpcionesDibujo>(OPCIONES_DIBUJO);

  const [dialogo, setDialogo] = useState<
    | { tipo: 'manual'; ids: string[] }
    | { tipo: 'nd'; ids: string[] }
    | { tipo: 'previa'; id: string }
    | { tipo: 'opciones' }
    | { tipo: 'vinculo'; candidato: repo.CandidatoVinculo }
    | null
  >(null);
  const [progreso, setProgreso] = useState<{ hechos: number; total: number; nombre: string } | null>(
    null,
  );
  const [mensaje, setMensaje] = useState<{ nivel: 'ok' | 'error'; texto: string } | null>(null);

  // Las dos fechas viven junto a la nómina: se fijan una vez y valen para todos
  // sus comprobantes.
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

  useEffect(() => {
    setSeleccion(new Set());
  }, [nominaId]);

  if (!nomina) {
    return (
      <Tarjeta titulo="Comprobantes">
        <Vacio icono="📄" titulo="Todavía no hay nóminas cargadas">
          Ve a «Cargar nómina» y sube el PDF del reporte para empezar.
        </Vacio>
      </Tarjeta>
    );
  }

  const registros = repo.registrosDeNomina(db, nomina.id);
  const descargas = repo.descargasDeNomina(db, nomina.id);
  const catalogo = repo.catalogoMapa(db);
  const tasas = repo.tasasMapa(db);
  const nombresFull = repo.nombresCompletos(db, nomina.tipo);
  const precios = repo.preciosProveedor(db, nomina.tipo);

  const ctx: ContextoComprobante = {
    catalogo,
    empresaPorFabrica: (cod) => repo.empresaDeFabrica(db, cod),
    nombreCompleto: (codigo) => nombresFull.get(codigo),
    tasas,
    titulo: nomina.tipo === 'leche' ? 'PAGO DE LECHE FRESCA' : 'NOMINA DE RUTAS',
    tipo: nomina.tipo,
    anio: nomina.anio,
    numero: nomina.numero,
    fechaIni: nomina.fechaIni,
    fechaFin: nomina.fechaFin,
  };

  // ── Vínculos leche+transporte: solo se calculan candidatos/contraparte
  //    para la nómina "hermana" de la misma semana ganadera, si está cargada.
  const otroTipo: TipoNomina = nomina.tipo === 'leche' ? 'transporte' : 'leche';
  const otraNomina = repo.buscarNomina(db, otroTipo, nomina.anio, nomina.numero);
  const otrosRegistros = otraNomina ? repo.registrosDeNomina(db, otraNomina.id) : [];
  const nombresFullOtro = otraNomina ? repo.nombresCompletos(db, otroTipo) : new Map<string, string>();
  const ctxOtro: ContextoComprobante = {
    catalogo,
    empresaPorFabrica: (cod) => repo.empresaDeFabrica(db, cod),
    nombreCompleto: (codigo) => nombresFullOtro.get(codigo),
    tasas,
    titulo: otroTipo === 'leche' ? 'PAGO DE LECHE FRESCA' : 'NOMINA DE RUTAS',
    tipo: otroTipo,
    anio: nomina.anio,
    numero: nomina.numero,
    fechaIni: otraNomina?.fechaIni ?? nomina.fechaIni,
    fechaFin: otraNomina?.fechaFin ?? nomina.fechaFin,
  };

  const candidatos = repo.candidatosVinculo(db, nomina.anio, nomina.numero);
  const candidatoPorCodigo = new Map(
    candidatos.map((c) => [
      nomina.tipo === 'leche' ? c.registroLeche.leido.codigo : c.registroTransporte.leido.codigo,
      c,
    ]),
  );
  const vinculoPorCodigo = new Map(
    repo
      .vinculosProveedor(db)
      .filter((v) => v.estado === 'confirmado')
      .map((v) => [nomina.tipo === 'leche' ? v.codigoLeche : v.codigoTransporte, v]),
  );

  function contraparteDe(codigo: string): { codigo: string; cargada: boolean } | null {
    const vinculo = vinculoPorCodigo.get(codigo);
    if (!vinculo) return null;
    const contraparteCodigo = nomina!.tipo === 'leche' ? vinculo.codigoTransporte : vinculo.codigoLeche;
    return {
      codigo: contraparteCodigo,
      cargada: otrosRegistros.some((x) => x.leido.codigo === contraparteCodigo),
    };
  }

  /** Resuelve un registro a lo que hay que generar: individual, o combinado
   * con su contraparte si ya está vinculado y esa nómina está cargada. */
  function unidadDe(r: (typeof registros)[number]): {
    registroIds: string[];
    datos: DatosComprobante;
    combinado: boolean;
  } {
    const contraparteCodigo = contraparteDe(r.leido.codigo)?.codigo;
    const contraparte = contraparteCodigo
      ? otrosRegistros.find((x) => x.leido.codigo === contraparteCodigo)
      : undefined;

    if (!contraparte) {
      return { registroIds: [r.id], datos: datosDe(r), combinado: false };
    }

    const combinado =
      nomina!.tipo === 'leche'
        ? construirComprobanteCombinado(
            r.leido, r.manuales, r.notaDebito, ctx,
            contraparte.leido, contraparte.manuales, contraparte.notaDebito, ctxOtro,
          )
        : construirComprobanteCombinado(
            contraparte.leido, contraparte.manuales, contraparte.notaDebito, ctxOtro,
            r.leido, r.manuales, r.notaDebito, ctx,
          );

    return { registroIds: [r.id, contraparte.id], datos: combinado, combinado: true };
  }

  const fabricas = [...new Set(registros.map((r) => r.leido.fabricaCod))].sort();

  const visibles = registros.filter((r) => {
    if (fabrica && r.leido.fabricaCod !== fabrica) return false;
    if (soloConNd && !r.notaDebito) return false;
    if (busqueda.trim()) {
      const t = busqueda.trim().toLowerCase();
      const heno = `${r.leido.nombre} ${r.leido.codigo} ${r.leido.ruta} ${r.leido.rif ?? ''} ${r.leido.cedula ?? ''}`;
      if (!heno.toLowerCase().includes(t)) return false;
    }
    return true;
  });

  const elegidos = registros.filter((r) => seleccion.has(r.id));
  const todosVisiblesElegidos = visibles.length > 0 && visibles.every((r) => seleccion.has(r.id));

  function alternar(id: string) {
    const copia = new Set(seleccion);
    if (copia.has(id)) copia.delete(id);
    else copia.add(id);
    setSeleccion(copia);
  }

  function datosDe(r: (typeof registros)[number]) {
    return construirComprobante(r.leido, r.manuales, r.notaDebito, ctx);
  }

  async function descargar(ids: string[], formato: Formato, comoLote: boolean) {
    if (!usuario || ids.length === 0) return;
    setMensaje(null);
    const items: ItemAGenerar[] = registros
      .filter((r) => ids.includes(r.id))
      .map((r) => {
        const u = unidadDe(r);
        return { registroIds: u.registroIds, datos: u.datos, numeroNomina: nomina!.numero };
      });

    setProgreso({ hechos: 0, total: items.length, nombre: '' });
    try {
      const archivos = await generarComprobantes(items, {
        formato,
        opciones,
        alAvanzar: (hechos, total, nombre) => setProgreso({ hechos, total, nombre }),
      });

      if (comoLote && archivos.length > 1) {
        const zip = await empaquetarZip(archivos);
        await plataforma.archivos.guardar(
          nombreLote(nomina!.anio, nomina!.numero, nomina!.tipo),
          zip,
        );
      } else {
        for (const a of archivos) await plataforma.archivos.guardar(a.nombre, a.blob);
      }

      await repo.registrarDescargas(
        db,
        usuario,
        archivos.flatMap((a) =>
          a.registroIds.map((registroId) => ({
            registroId,
            folio: a.folio,
            formato,
            archivo: a.nombre,
          })),
        ),
      );
      cambiado();
      setMensaje({
        nivel: 'ok',
        texto:
          comoLote && archivos.length > 1
            ? `Se generó un ZIP con ${archivos.length} comprobantes en ${formato.toUpperCase()}.`
            : `Se descargó ${archivos.length} comprobante(s) en ${formato.toUpperCase()}.`,
      });
    } catch (error) {
      setMensaje({
        nivel: 'error',
        texto: `No se pudieron generar los comprobantes: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setProgreso(null);
    }
  }

  /** true si la unidad (individual o combinada leche+flete) tiene una ND calculable. */
  function ndAplica(datos: DatosComprobante): boolean {
    return datos.notaDebitoCombinada ? datos.notaDebitoCombinada.aplica : Boolean(datos.notaDebito?.aplica);
  }

  /**
   * Nota de débito como documento aparte (ver `dibujarNotaDebito`), no como
   * sección del comprobante completo. Omite en silencio los proveedores sin
   * ND calculable (el botón por fila ya no aparece para ellos; en el lote
   * puede haber una mezcla, así que aquí sí hace falta filtrar y avisar).
   */
  async function descargarNd(ids: string[], formato: Formato, comoLote: boolean) {
    if (!usuario) return;
    setMensaje(null);
    const candidatos = registros.filter((r) => ids.includes(r.id));
    const omitidos = candidatos.filter((r) => !ndAplica(unidadDe(r).datos)).length;
    const items: ItemAGenerar[] = candidatos
      .filter((r) => ndAplica(unidadDe(r).datos))
      .map((r) => {
        const u = unidadDe(r);
        return { registroIds: u.registroIds, datos: u.datos, numeroNomina: nomina!.numero };
      });

    if (items.length === 0) {
      setMensaje({ nivel: 'error', texto: 'Ninguno de los seleccionados tiene una nota de débito calculable.' });
      return;
    }

    setProgreso({ hechos: 0, total: items.length, nombre: '' });
    try {
      const archivos = await generarNotasDebito(items, {
        formato,
        opciones,
        alAvanzar: (hechos, total, nombre) => setProgreso({ hechos, total, nombre }),
      });

      if (comoLote && archivos.length > 1) {
        const zip = await empaquetarZip(archivos);
        await plataforma.archivos.guardar(
          nombreLote(nomina!.anio, nomina!.numero, 'notas-debito'),
          zip,
        );
      } else {
        for (const a of archivos) await plataforma.archivos.guardar(a.nombre, a.blob);
      }

      await repo.registrarDescargas(
        db,
        usuario,
        archivos.flatMap((a) =>
          a.registroIds.map((registroId) => ({ registroId, folio: a.folio, formato, archivo: a.nombre })),
        ),
      );
      cambiado();
      const base =
        comoLote && archivos.length > 1
          ? `Se generó un ZIP con ${archivos.length} nota(s) de débito en ${formato.toUpperCase()}.`
          : `Se descargó ${archivos.length} nota(s) de débito en ${formato.toUpperCase()}.`;
      setMensaje({
        nivel: 'ok',
        texto: omitidos > 0 ? `${base} Se omitieron ${omitidos} sin ND calculable.` : base,
      });
    } catch (error) {
      setMensaje({
        nivel: 'error',
        texto: `No se pudieron generar las notas de débito: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setProgreso(null);
    }
  }

  const registroPrevia =
    dialogo?.tipo === 'previa' ? registros.find((r) => r.id === dialogo.id) : undefined;

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
          <button className="btn" onClick={() => setDialogo({ tipo: 'opciones' })}>
            ⚙ Contenido
          </button>
        </div>
      </div>

      {mensaje && (
        <Aviso nivel={mensaje.nivel === 'ok' ? 'ok' : 'error'}>{mensaje.texto}</Aviso>
      )}

      {progreso && (
        <Tarjeta>
          <strong>
            Generando {progreso.hechos} de {progreso.total}…
          </strong>
          <div className="tenue pequeno">{progreso.nombre}</div>
          <div className="barra-progreso">
            <div style={{ width: `${(progreso.hechos / progreso.total) * 100}%` }} />
          </div>
        </Tarjeta>
      )}

      {/* Fechas de factura y nota de débito: valen para toda la nómina */}
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

      <Tarjeta ajustado>
        <div className="filtros">
          <div className="buscador">
            <span className="lupa">🔍</span>
            <input
              type="text"
              placeholder="Buscar por nombre, código, ruta o RIF"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
          <select value={fabrica} onChange={(e) => setFabrica(e.target.value)}>
            <option value="">Todas las fábricas</option>
            {fabricas.map((f) => (
              <option key={f} value={f}>
                {f} · {registros.find((r) => r.leido.fabricaCod === f)?.leido.fabricaNom ?? ''}
              </option>
            ))}
          </select>
          <label className="check" style={{ marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={soloConNd}
              onChange={(e) => setSoloConNd(e.target.checked)}
            />
            <span>Solo con nota de débito</span>
          </label>
          <span className="crece" />
          <span className="tenue pequeno">
            {visibles.length} de {registros.length} proveedores
          </span>
        </div>

        <div className="barra-lote">
          <button
            className="btn chico"
            onClick={() => {
              const copia = new Set(seleccion);
              if (todosVisiblesElegidos) visibles.forEach((r) => copia.delete(r.id));
              else visibles.forEach((r) => copia.add(r.id));
              setSeleccion(copia);
            }}
          >
            {todosVisiblesElegidos ? 'Quitar selección' : 'Seleccionar los visibles'}
          </button>
          <button className="btn chico" onClick={() => setSeleccion(new Set())}>
            Ninguno
          </button>
          <span className="conteo">{elegidos.length} seleccionados</span>
          <span className="crece" />
          <button
            className="btn chico"
            disabled={elegidos.length === 0 || !puedo('concepto-manual')}
            onClick={() => setDialogo({ tipo: 'manual', ids: elegidos.map((r) => r.id) })}
          >
            + Concepto manual
          </button>
          <button
            className="btn chico"
            disabled={elegidos.length === 0 || !puedo('nota-debito')}
            onClick={() => setDialogo({ tipo: 'nd', ids: elegidos.map((r) => r.id) })}
          >
            $ Nota de débito
          </button>
          <button
            className="btn chico"
            disabled={elegidos.length === 0 || progreso !== null || !puedo('generar-comprobante')}
            onClick={() => void descargar(elegidos.map((r) => r.id), 'pdf', true)}
          >
            ⬇ ZIP en PDF
          </button>
          <button
            className="btn chico"
            disabled={elegidos.length === 0 || progreso !== null || !puedo('generar-comprobante')}
            onClick={() => void descargar(elegidos.map((r) => r.id), 'png', true)}
          >
            ⬇ ZIP en imagen
          </button>
          <button
            className="btn chico"
            disabled={
              elegidos.filter((r) => ndAplica(unidadDe(r).datos)).length === 0 ||
              progreso !== null ||
              !puedo('generar-comprobante')
            }
            onClick={() => void descargarNd(elegidos.map((r) => r.id), 'pdf', true)}
          >
            ⬇ ZIP notas de débito
          </button>
        </div>

        <div className="tabla-envoltura tabla-adaptable">
          <table className="tabla">
            <thead>
              <tr>
                <th style={{ width: 34 }} />
                <th>Proveedor</th>
                <th>Fábrica</th>
                <th className="num">Litros</th>
                <th className="num">Neto a pagar</th>
                <th className="num">Total a facturar</th>
                <th className="num">Nota de débito</th>
                <th>Estado</th>
                <th style={{ textAlign: 'right' }}>Comprobante</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((r) => {
                const datos = datosDe(r);
                const nd = datos.notaDebito;
                const yaDescargado = descargas.get(r.id);
                const candidato = candidatoPorCodigo.get(r.leido.codigo);
                const contraparte = contraparteDe(r.leido.codigo);
                // La unidad (individual o combinada) es la que de verdad
                // decide si hay ND que descargar aparte — el `nd` de arriba
                // es solo del lado de esta fila, no del combinado.
                const ndDescargable = ndAplica(unidadDe(r).datos);
                return (
                  <tr key={r.id} className={seleccion.has(r.id) ? 'elegida' : undefined}>
                    <td className="selector">
                      <input
                        type="checkbox"
                        checked={seleccion.has(r.id)}
                        onChange={() => alternar(r.id)}
                        aria-label={`Seleccionar ${r.leido.nombre}`}
                      />
                    </td>
                    <td className="principal">
                      <div className="nombre-prov">{datos.proveedor.nombre}</div>
                      <div className="sub">
                        {r.leido.codigo} · ruta {r.leido.ruta}
                        {r.manuales.length > 0 && ` · ${r.manuales.length} concepto(s) manual(es)`}
                        {yaDescargado && ` · descargado ${yaDescargado.length} vez(ces)`}
                      </div>
                      {candidato && (
                        <button
                          className="btn sutil chico"
                          style={{ marginTop: 4 }}
                          onClick={() => setDialogo({ tipo: 'vinculo', candidato })}
                        >
                          🔗 posible vínculo con {otroTipo === 'leche' ? 'leche' : 'flete'}
                        </button>
                      )}
                      {contraparte?.cargada && (
                        <div style={{ marginTop: 4 }}>
                          <Pastilla tono="ok">🔗 combinado con {contraparte.codigo}</Pastilla>{' '}
                          {puedo('vincular-proveedor') && (
                            <button
                              className="btn sutil chico"
                              onClick={() => {
                                if (!usuario) return;
                                const codigoLeche = nomina.tipo === 'leche' ? r.leido.codigo : contraparte.codigo;
                                const codigoTransporte =
                                  nomina.tipo === 'leche' ? contraparte.codigo : r.leido.codigo;
                                void repo
                                  .desvincularProveedor(db, usuario, codigoLeche, codigoTransporte)
                                  .then(() => cambiado());
                              }}
                            >
                              ✕ desvincular
                            </button>
                          )}
                        </div>
                      )}
                      {contraparte && !contraparte.cargada && (
                        <div className="tenue pequeno" style={{ marginTop: 4 }}>
                          🔗 vinculado — falta cargar la nómina de{' '}
                          {otroTipo === 'leche' ? 'leche' : 'flete'} de esta semana
                        </div>
                      )}
                    </td>
                    <td className="pequeno" data-etiqueta="Fábrica">
                      {r.leido.fabricaCod} {r.leido.fabricaNom}
                      {!datos.empresa && (
                        <div>
                          <Pastilla tono="aviso">Sin empresa</Pastilla>
                        </div>
                      )}
                    </td>
                    <td className="num" data-etiqueta="Litros">{formatearEntero(r.leido.litrosTotal ?? 0)}</td>
                    <td className="num" data-etiqueta="Neto a pagar">{formatearBs(r.neto)}</td>
                    <td className="num" data-etiqueta="Total a facturar">{formatearBs(r.totalFacturar)}</td>
                    <td className="num" data-etiqueta="Nota de débito">
                      {!nd ? (
                        <span className="tenue">—</span>
                      ) : nd.aplica ? (
                        formatearBs(nd.centimos)
                      ) : (
                        <Pastilla tono="error">Falta tasa</Pastilla>
                      )}
                    </td>
                    <td data-etiqueta="Estado">
                      <Semaforo nivel={(r.validacion as NivelValidacion) ?? 'ok'} />
                      <div style={{ marginTop: 4 }}>
                        <Pastilla tono={r.notaDebito ? 'ok' : 'neutra'}>
                          {r.notaDebito ? 'Con ND' : 'Sin ND'}
                        </Pastilla>
                      </div>
                    </td>
                    <td className="acciones-celda">
                      <button
                        className="btn sutil chico"
                        title="Vista previa"
                        onClick={() => setDialogo({ tipo: 'previa', id: r.id })}
                      >
                        👁
                      </button>
                      <button
                        className="btn sutil chico"
                        title="Agregar concepto manual"
                        disabled={!puedo('concepto-manual')}
                        onClick={() => setDialogo({ tipo: 'manual', ids: [r.id] })}
                      >
                        +
                      </button>
                      <button
                        className="btn sutil chico"
                        title="Nota de débito"
                        disabled={!puedo('nota-debito')}
                        onClick={() => setDialogo({ tipo: 'nd', ids: [r.id] })}
                      >
                        $
                      </button>
                      <button
                        className="btn chico"
                        disabled={progreso !== null || !puedo('generar-comprobante')}
                        onClick={() => void descargar([r.id], 'pdf', false)}
                      >
                        PDF
                      </button>
                      <button
                        className="btn chico"
                        disabled={progreso !== null || !puedo('generar-comprobante')}
                        onClick={() => void descargar([r.id], 'png', false)}
                      >
                        IMG
                      </button>
                      {ndDescargable && (
                        <button
                          className="btn chico"
                          title="Descargar solo la nota de débito"
                          disabled={progreso !== null || !puedo('generar-comprobante')}
                          onClick={() => void descargarNd([r.id], 'pdf', false)}
                        >
                          ND
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Totales de lo visible</td>
                <td className="num">
                  {formatearEntero(visibles.reduce((a, r) => a + (r.leido.litrosTotal ?? 0), 0))}
                </td>
                <td className="num">{formatearBs(visibles.reduce((a, r) => a + r.neto, 0))}</td>
                <td className="num">
                  {formatearBs(visibles.reduce((a, r) => a + r.totalFacturar, 0))}
                </td>
                <td className="num">
                  {formatearBs(
                    visibles.reduce((a, r) => {
                      const nd = datosDe(r).notaDebito;
                      return a + (nd?.aplica ? nd.centimos : 0);
                    }, 0),
                  )}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* En modo tarjeta el pie de la tabla queda oculto, así que los totales
            se repiten aquí para no perderlos en pantallas pequeñas. */}
        <div className="resumen-tarjetas rejilla cuatro" style={{ padding: 12 }}>
          <Dato
            etiqueta="Litros visibles"
            valor={formatearEntero(visibles.reduce((a, r) => a + (r.leido.litrosTotal ?? 0), 0))}
            pequeno
          />
          <Dato
            etiqueta="Neto a pagar"
            valor={formatearBs(visibles.reduce((a, r) => a + r.neto, 0))}
            pequeno
          />
          <Dato
            etiqueta="Total a facturar"
            valor={formatearBs(visibles.reduce((a, r) => a + r.totalFacturar, 0))}
            pequeno
          />
          <Dato
            etiqueta="Notas de débito"
            valor={formatearBs(
              visibles.reduce((a, r) => {
                const nd = datosDe(r).notaDebito;
                return a + (nd?.aplica ? nd.centimos : 0);
              }, 0),
            )}
            pequeno
          />
        </div>
      </Tarjeta>

      {/* ── Diálogos ── */}

      {dialogo?.tipo === 'manual' && usuario && (
        <ModalConceptoManual
          cantidad={dialogo.ids.length}
          catalogo={repo.listarCatalogo(db)}
          existentes={
            dialogo.ids.length === 1 ? registros.find((r) => r.id === dialogo.ids[0])?.manuales : undefined
          }
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
          registros={registros.filter((r) => dialogo.ids.includes(r.id))}
          fechaIniSemana={nomina.fechaIni}
          fechaFactura={fechas.factura}
          fechaNota={fechas.nota}
          tasas={tasas}
          preciosGuardados={precios}
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
            void repo
              .guardarNotaDebito(db, usuario, dialogo.ids, params, precioPorRegistro)
              .then(() => {
                cambiado();
                setDialogo(null);
              });
          }}
        />
      )}

      {dialogo?.tipo === 'previa' && registroPrevia && (
        <Modal
          ancho
          titulo="Vista previa del comprobante"
          descripcion="Así se verá el PDF y la imagen que descargues."
          alCerrar={() => setDialogo(null)}
          pie={
            <>
              <button className="btn" onClick={() => setDialogo(null)}>
                Cerrar
              </button>
              <button
                className="btn primario"
                disabled={!puedo('generar-comprobante')}
                onClick={() => void descargar([registroPrevia.id], 'pdf', false)}
              >
                Descargar PDF
              </button>
              <button
                className="btn primario"
                disabled={!puedo('generar-comprobante')}
                onClick={() => void descargar([registroPrevia.id], 'png', false)}
              >
                Descargar imagen
              </button>
            </>
          }
        >
          <VistaPrevia datos={unidadDe(registroPrevia).datos} opciones={opciones} />
        </Modal>
      )}

      {dialogo?.tipo === 'vinculo' && usuario && (
        <ModalVinculo
          candidato={dialogo.candidato}
          puedeVincular={puedo('vincular-proveedor')}
          alCerrar={() => setDialogo(null)}
          alConfirmar={() => {
            void repo
              .confirmarVinculo(
                db,
                usuario,
                dialogo.candidato.registroLeche.leido.codigo,
                dialogo.candidato.registroTransporte.leido.codigo,
                dialogo.candidato.documento,
              )
              .then(() => cambiado())
              .catch((e: unknown) => {
                setMensaje({ nivel: 'error', texto: e instanceof Error ? e.message : String(e) });
              });
          }}
          alRechazar={() => {
            void repo
              .rechazarVinculo(
                db,
                usuario,
                dialogo.candidato.registroLeche.leido.codigo,
                dialogo.candidato.registroTransporte.leido.codigo,
                dialogo.candidato.documento,
              )
              .then(() => cambiado());
          }}
        />
      )}

      {dialogo?.tipo === 'opciones' && (
        <Modal
          titulo="Contenido del comprobante"
          descripcion="Se aplica a todos los comprobantes que generes."
          alCerrar={() => setDialogo(null)}
          pie={
            <button className="btn primario" onClick={() => setDialogo(null)}>
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
        </Modal>
      )}
    </>
  );
}
