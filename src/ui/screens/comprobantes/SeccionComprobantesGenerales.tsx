import { useEffect, useState } from 'react';
import { useApp } from '../../estado.tsx';
import { Aviso, Dato, Modal, Pastilla, Semaforo, Tarjeta } from '../../components/comunes.tsx';
import { ModalConceptoManual } from '../../components/ModalConceptoManual.tsx';
import { ModalNotaDebito } from '../../components/ModalNotaDebito.tsx';
import { ModalVinculo } from '../../components/ModalVinculo.tsx';
import { ModalGrupoMismoTipo } from '../../components/ModalGrupoMismoTipo.tsx';
import { VistaPrevia } from '../../components/VistaPrevia.tsx';
import * as repo from '../../../core/db/repo.ts';
import {
  construirComprobante,
  type ContextoComprobante,
  type DatosComprobante,
} from '../../../core/receipt/comprobante.ts';
import { construirComprobanteCombinado } from '../../../core/receipt/comprobanteCombinado.ts';
import { construirComprobanteAgrupado } from '../../../core/receipt/comprobanteAgrupado.ts';
import { datosConNdPorSap, gruposNdPorSap } from '../../../core/receipt/notaDebitoSap.ts';
import type { OpcionesDibujo } from '../../../core/receipt/dibujo.ts';
import { nombreLote } from '../../../core/receipt/nombreArchivo.ts';
import {
  empaquetarZip,
  generarComprobantes,
  generarNotasDebito,
  type Formato,
  type ItemAGenerar,
} from '../../salida/generar.ts';
import { formatearBs, formatearEntero } from '../../../core/parser/numeros.ts';
import type { NivelValidacion, TipoNomina } from '../../../core/types.ts';
import type { FechasNomina } from '../Comprobantes.tsx';

export function SeccionComprobantesGenerales({
  nomina,
  formato,
  opciones,
  fechas,
  irAConfiguracion,
}: {
  nomina: repo.NominaResumen;
  formato: Formato;
  opciones: OpcionesDibujo;
  fechas: FechasNomina;
  irAConfiguracion: (codigo: string) => void;
}) {
  const { db, usuario, plataforma, cambiado, puedo } = useApp();

  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [busqueda, setBusqueda] = useState('');
  const [fabrica, setFabrica] = useState('');
  const [soloConNd, setSoloConNd] = useState(false);

  const [dialogo, setDialogo] = useState<
    | { tipo: 'manual'; ids: string[] }
    | { tipo: 'nd'; ids: string[] }
    | { tipo: 'previa'; id: string; cual: 'factura' | 'nd' }
    | { tipo: 'vinculo'; candidato: repo.CandidatoVinculo }
    | { tipo: 'grupo'; candidato: repo.CandidatoGrupoMismoTipo }
    | null
  >(null);
  const [progreso, setProgreso] = useState<{ hechos: number; total: number; nombre: string } | null>(
    null,
  );
  const [mensaje, setMensaje] = useState<{ nivel: 'ok' | 'error'; texto: string } | null>(null);

  useEffect(() => {
    setSeleccion(new Set());
  }, [nomina.id]);

  const registros = repo.registrosDeNomina(db, nomina.id);
  const descargas = repo.descargasDeNomina(db, nomina.id);
  const catalogo = repo.catalogoMapa(db);
  const tasas = repo.tasasMapa(db);
  const nombresFull = repo.nombresCompletos(db, nomina.tipo);
  const precios = repo.preciosProveedor(db, nomina.tipo);
  const ndImportada = repo.ndImportadaMapa(db, nomina.id);

  const ctx: ContextoComprobante = {
    catalogo,
    empresaPorFabrica: (cod) => repo.empresaDeFabrica(db, cod),
    nombreCompleto: (codigo) => nombresFull.get(codigo),
    tasas,
    ndImportada,
    fechaFactura: fechas.factura,
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
  const ndImportadaOtro = otraNomina ? repo.ndImportadaMapa(db, otraNomina.id) : new Map();
  const ctxOtro: ContextoComprobante = {
    catalogo,
    empresaPorFabrica: (cod) => repo.empresaDeFabrica(db, cod),
    nombreCompleto: (codigo) => nombresFullOtro.get(codigo),
    tasas,
    ndImportada: ndImportadaOtro,
    fechaFactura: fechas.factura,
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
    const contraparteCodigo = nomina.tipo === 'leche' ? vinculo.codigoTransporte : vinculo.codigoLeche;
    return {
      codigo: contraparteCodigo,
      cargada: otrosRegistros.some((x) => x.leido.codigo === contraparteCodigo),
    };
  }

  // ── Agrupación del mismo tipo: mecanismo separado y excluyente del
  //    vínculo cruzado leche-transporte de arriba. Vive dentro de una sola
  //    nómina/tipo, así que no hace falta lógica de nómina hermana.
  const candidatosGrupo = repo.candidatosGrupoMismoTipo(db, nomina.tipo, nomina.anio, nomina.numero);
  const candidatoGrupoPorCodigo = new Map(
    candidatosGrupo.flatMap((c) => c.registros.map((r) => [r.leido.codigo, c] as const)),
  );
  const grupoPorCodigo = new Map(
    repo
      .gruposMismoTipo(db)
      .filter((g) => g.tipo === nomina.tipo)
      .flatMap((g) => g.codigos.map((c) => [c, g] as const)),
  );

  /** Resuelve un registro a lo que hay que generar: individual, combinado
   * con su contraparte cruzada si ya está vinculado, o agrupado con otros
   * códigos del mismo tipo si ya está agrupado (excluyentes entre sí). */
  function unidadDe(r: (typeof registros)[number]): {
    registroIds: string[];
    datos: DatosComprobante;
    combinado: boolean;
  } {
    const contraparteCodigo = contraparteDe(r.leido.codigo)?.codigo;
    const contraparte = contraparteCodigo
      ? otrosRegistros.find((x) => x.leido.codigo === contraparteCodigo)
      : undefined;

    if (contraparte) {
      const combinado =
        nomina.tipo === 'leche'
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

    const grupo = grupoPorCodigo.get(r.leido.codigo);
    const miembros = grupo
      ? grupo.codigos
          .map((c) => registros.find((x) => x.leido.codigo === c))
          .filter((x): x is (typeof registros)[number] => x !== undefined)
      : [];
    if (grupo && miembros.length > 1) {
      const agrupado = construirComprobanteAgrupado(
        miembros.map((m) => ({ registro: m.leido, manuales: m.manuales, paramsNd: m.notaDebito, ctx })),
        grupo.principal,
      );
      return { registroIds: miembros.map((m) => m.id), datos: agrupado, combinado: true };
    }

    return { registroIds: [r.id], datos: datosDe(r), combinado: false };
  }

  // ── Notas de débito importadas que comparten SAP y fábrica: se tratan
  //    como el mismo proveedor real solo para la ND (no para la factura,
  //    que sigue generándose por separado por código) — ver notaDebitoSap.ts.
  const registrosPorId = new Map([...registros, ...otrosRegistros].map((r) => [r.id, r]));
  const gruposSap = gruposNdPorSap([
    ...repo.notasDebitoImportadasDeNomina(db, nomina.id),
    ...(otraNomina ? repo.notasDebitoImportadasDeNomina(db, otraNomina.id) : []),
  ]);

  /** Igual que `unidadDe`, pero si el registro comparte SAP+fábrica con
   * otro(s), la ND que devuelve es la combinada de todos ellos (misma nota,
   * una línea por miembro, monto sumado tal cual el Excel). Solo para las
   * acciones de "Vista"/"Comprobante" de ND — la factura usa `unidadDe`. */
  function unidadParaNd(r: (typeof registros)[number]): { registroIds: string[]; datos: DatosComprobante } {
    const grupo = gruposSap.get(r.id);
    if (!grupo) return unidadDe(r);
    return {
      registroIds: grupo.miembros.map((m) => m.registroId),
      datos: datosConNdPorSap(unidadDe(r).datos, grupo, registrosPorId),
    };
  }

  const fabricas = [...new Set(registros.map((r) => r.leido.fabricaCod))].sort();

  const visibles = registros.filter((r) => {
    if (fabrica && r.leido.fabricaCod !== fabrica) return false;
    if (soloConNd && !r.notaDebito && !ndImportada.has(r.leido.codigo)) return false;
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

  async function descargar(ids: string[], formatoDescarga: Formato, comoLote: boolean) {
    if (!usuario || ids.length === 0) return;
    setMensaje(null);
    const items: ItemAGenerar[] = registros
      .filter((r) => ids.includes(r.id))
      .map((r) => {
        const u = unidadDe(r);
        return { registroIds: u.registroIds, datos: u.datos, numeroNomina: nomina.numero };
      });

    setProgreso({ hechos: 0, total: items.length, nombre: '' });
    try {
      const archivos = await generarComprobantes(items, {
        formato: formatoDescarga,
        opciones,
        alAvanzar: (hechos, total, nombre) => setProgreso({ hechos, total, nombre }),
      });

      if (comoLote && archivos.length > 1) {
        const zip = await empaquetarZip(archivos);
        await plataforma.archivos.guardar(nombreLote(nomina.anio, nomina.numero, nomina.tipo), zip);
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
            formato: formatoDescarga,
            archivo: a.nombre,
          })),
        ),
      );
      cambiado();
      setMensaje({
        nivel: 'ok',
        texto:
          comoLote && archivos.length > 1
            ? `Se generó un ZIP con ${archivos.length} comprobantes en ${formatoDescarga.toUpperCase()}.`
            : `Se descargó ${archivos.length} comprobante(s) en ${formatoDescarga.toUpperCase()}.`,
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

  /** true si la unidad (individual, combinada o agrupada) tiene una ND calculable. */
  function ndAplica(datos: DatosComprobante): boolean {
    if (datos.notaDebitoAgrupada) return datos.notaDebitoAgrupada.aplica;
    return datos.notaDebitoCombinada ? datos.notaDebitoCombinada.aplica : Boolean(datos.notaDebito?.aplica);
  }

  /**
   * Nota de débito como documento aparte (ver `dibujarNotaDebito`), no como
   * sección del comprobante completo. Omite en silencio los proveedores sin
   * ND calculable (el botón por fila ya no aparece para ellos; en el lote
   * puede haber una mezcla, así que aquí sí hace falta filtrar y avisar).
   */
  async function descargarNd(ids: string[], formatoDescarga: Formato, comoLote: boolean) {
    if (!usuario) return;
    setMensaje(null);
    const candidatosDescarga = registros.filter((r) => ids.includes(r.id));
    const omitidos = candidatosDescarga.filter((r) => !ndAplica(unidadParaNd(r).datos)).length;
    const items: ItemAGenerar[] = candidatosDescarga
      .filter((r) => ndAplica(unidadParaNd(r).datos))
      .map((r) => {
        const u = unidadParaNd(r);
        return { registroIds: u.registroIds, datos: u.datos, numeroNomina: nomina.numero };
      });

    if (items.length === 0) {
      setMensaje({ nivel: 'error', texto: 'Ninguno de los seleccionados tiene una nota de débito calculable.' });
      return;
    }

    setProgreso({ hechos: 0, total: items.length, nombre: '' });
    try {
      const archivos = await generarNotasDebito(items, {
        formato: formatoDescarga,
        opciones,
        alAvanzar: (hechos, total, nombre) => setProgreso({ hechos, total, nombre }),
      });

      if (comoLote && archivos.length > 1) {
        const zip = await empaquetarZip(archivos);
        await plataforma.archivos.guardar(nombreLote(nomina.anio, nomina.numero, 'notas-debito'), zip);
      } else {
        for (const a of archivos) await plataforma.archivos.guardar(a.nombre, a.blob);
      }

      await repo.registrarDescargas(
        db,
        usuario,
        archivos.flatMap((a) =>
          a.registroIds.map((registroId) => ({ registroId, folio: a.folio, formato: formatoDescarga, archivo: a.nombre })),
        ),
      );
      cambiado();
      const base =
        comoLote && archivos.length > 1
          ? `Se generó un ZIP con ${archivos.length} nota(s) de débito en ${formatoDescarga.toUpperCase()}.`
          : `Se descargó ${archivos.length} nota(s) de débito en ${formatoDescarga.toUpperCase()}.`;
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
      {mensaje && <Aviso nivel={mensaje.nivel === 'ok' ? 'ok' : 'error'}>{mensaje.texto}</Aviso>}

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
            onClick={() => void descargar(elegidos.map((r) => r.id), formato, true)}
          >
            ⬇ ZIP Factura
          </button>
          <button
            className="btn chico"
            disabled={
              elegidos.filter((r) => ndAplica(unidadParaNd(r).datos)).length === 0 ||
              progreso !== null ||
              !puedo('generar-comprobante')
            }
            onClick={() => void descargarNd(elegidos.map((r) => r.id), formato, true)}
          >
            ⬇ ZIP ND
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
                <th className="compacta" style={{ textAlign: 'right' }}>Vista</th>
                <th className="compacta" style={{ width: 40, textAlign: 'right' }} title="Concepto manual">+</th>
                <th className="compacta" style={{ width: 40, textAlign: 'right' }} title="Nota de débito">⚙</th>
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
                const candidatoGrupo = candidatoGrupoPorCodigo.get(r.leido.codigo);
                const grupo = grupoPorCodigo.get(r.leido.codigo);
                // La unidad (individual, combinada o SAP) es la que de verdad
                // decide si hay ND que descargar aparte — el `nd` de arriba
                // es solo del lado de esta fila, no del combinado.
                const ndDescargable = ndAplica(unidadParaNd(r).datos);
                const tieneNd = Boolean(r.notaDebito) || ndImportada.has(r.leido.codigo) || gruposSap.has(r.id);
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
                          style={{ marginTop: 8 }}
                          onClick={() => setDialogo({ tipo: 'vinculo', candidato })}
                        >
                          🔗 posible vínculo con {otroTipo === 'leche' ? 'leche' : 'flete'}
                        </button>
                      )}
                      {contraparte?.cargada && (
                        <div style={{ marginTop: 8 }}>
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
                        <div className="tenue pequeno" style={{ marginTop: 8 }}>
                          🔗 vinculado — falta cargar la nómina de{' '}
                          {otroTipo === 'leche' ? 'leche' : 'flete'} de esta semana
                        </div>
                      )}
                      {!contraparte && candidatoGrupo && (
                        <button
                          className="btn sutil chico"
                          style={{ marginTop: 8 }}
                          onClick={() => setDialogo({ tipo: 'grupo', candidato: candidatoGrupo })}
                        >
                          🔗 posible agrupación con{' '}
                          {candidatoGrupo.registros
                            .filter((x) => x.leido.codigo !== r.leido.codigo)
                            .map((x) => x.leido.codigo)
                            .join(', ')}
                        </button>
                      )}
                      {!contraparte && grupo && grupo.codigos.length > 1 && (
                        <div style={{ marginTop: 8 }}>
                          <Pastilla tono="ok">
                            🔗 agrupado con{' '}
                            {grupo.codigos.filter((c) => c !== r.leido.codigo).join(', ')}
                          </Pastilla>{' '}
                          {puedo('vincular-proveedor') && (
                            <button
                              className="btn sutil chico"
                              onClick={() => {
                                if (!usuario) return;
                                void repo
                                  .quitarDeGrupoMismoTipo(db, usuario, r.leido.codigo)
                                  .then(() => cambiado());
                              }}
                            >
                              ✕ desagrupar
                            </button>
                          )}
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
                        <Pastilla tono={tieneNd ? 'ok' : 'neutra'}>{tieneNd ? 'Con ND' : 'Sin ND'}</Pastilla>
                      </div>
                    </td>
                    <td className="acciones-celda compacta">
                      <button
                        className="btn sutil chico"
                        title="Ver factura"
                        onClick={() => setDialogo({ tipo: 'previa', id: r.id, cual: 'factura' })}
                      >
                        👁
                      </button>
                      {ndDescargable && (
                        <button
                          className="btn sutil chico"
                          title="Ver nota de débito"
                          onClick={() => setDialogo({ tipo: 'previa', id: r.id, cual: 'nd' })}
                        >
                          🧾
                        </button>
                      )}
                    </td>
                    <td className="acciones-celda compacta">
                      <button
                        className="btn sutil chico"
                        title="Agregar concepto manual"
                        disabled={!puedo('concepto-manual')}
                        onClick={() => setDialogo({ tipo: 'manual', ids: [r.id] })}
                      >
                        +
                      </button>
                    </td>
                    <td className="acciones-celda compacta">
                      <button
                        className="btn sutil chico"
                        title="Configurar nota de débito"
                        onClick={() => irAConfiguracion(r.leido.codigo)}
                      >
                        ⚙
                      </button>
                    </td>
                    <td className="acciones-celda">
                      <button
                        className="btn chico"
                        disabled={progreso !== null || !puedo('generar-comprobante')}
                        onClick={() => void descargar([r.id], formato, false)}
                      >
                        Factura
                      </button>
                      {ndDescargable && (
                        <button
                          className="btn chico"
                          title="Descargar solo la nota de débito"
                          disabled={progreso !== null || !puedo('generar-comprobante')}
                          onClick={() => void descargarNd([r.id], formato, false)}
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
                <td colSpan={5} />
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
          codigosImportados={new Set(ndImportada.keys())}
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
          titulo={dialogo.cual === 'nd' ? 'Vista previa de la nota de débito' : 'Vista previa del comprobante'}
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
                onClick={() => void descargar([registroPrevia.id], formato, false)}
              >
                Descargar factura
              </button>
              {ndAplica(unidadParaNd(registroPrevia).datos) && (
                <button
                  className="btn primario"
                  disabled={!puedo('generar-comprobante')}
                  onClick={() => void descargarNd([registroPrevia.id], formato, false)}
                >
                  Descargar ND
                </button>
              )}
            </>
          }
        >
          <VistaPrevia
            datos={dialogo.cual === 'nd' ? unidadParaNd(registroPrevia).datos : unidadDe(registroPrevia).datos}
            opciones={opciones}
            cual={dialogo.cual}
          />
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

      {dialogo?.tipo === 'grupo' && usuario && (
        <ModalGrupoMismoTipo
          candidato={dialogo.candidato}
          puedeVincular={puedo('vincular-proveedor')}
          alCerrar={() => setDialogo(null)}
          alConfirmar={() => {
            void repo
              .confirmarGrupoMismoTipo(
                db,
                usuario,
                dialogo.candidato.tipo,
                dialogo.candidato.registros.map((r) => r.leido.codigo),
              )
              .then(() => cambiado())
              .catch((e: unknown) => {
                setMensaje({ nivel: 'error', texto: e instanceof Error ? e.message : String(e) });
              });
          }}
          alRechazar={() => {
            void repo
              .descartarCandidatoGrupoMismoTipo(db, usuario, dialogo.candidato.tipo, dialogo.candidato.documento)
              .then(() => cambiado());
          }}
        />
      )}
    </>
  );
}
