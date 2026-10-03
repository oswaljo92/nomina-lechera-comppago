import { useState } from 'react';
import { useApp } from '../../estado.tsx';
import { Aviso, Confirmar, Modal, Pastilla, Tarjeta, Vacio } from '../../components/comunes.tsx';
import { ModalConceptoManual } from '../../components/ModalConceptoManual.tsx';
import { ModalNotaDebito } from '../../components/ModalNotaDebito.tsx';
import { ModalImportarNotaDebito } from '../../components/ModalImportarNotaDebito.tsx';
import { ModalResolverNotaDebito } from '../../components/ModalResolverNotaDebito.tsx';
import { VistaPrevia } from '../../components/VistaPrevia.tsx';
import * as repo from '../../../core/db/repo.ts';
import { leerLibroNotasDebitoImportadas, type LecturaLibroNd } from '../../../core/db/notaDebitoExcel.ts';
import { construirComprobante, type ContextoComprobante, type DatosComprobante } from '../../../core/receipt/comprobante.ts';
import { construirComprobanteCombinado } from '../../../core/receipt/comprobanteCombinado.ts';
import { construirComprobanteAgrupado } from '../../../core/receipt/comprobanteAgrupado.ts';
import { datosConNdPorSap, gruposNdPorSap } from '../../../core/receipt/notaDebitoSap.ts';
import { OPCIONES_DIBUJO } from '../../../core/receipt/dibujo.ts';
import { generarNotasDebito, type Formato, type ItemAGenerar } from '../../salida/generar.ts';
import { fechaAMostrar, formatearBs, formatearEntero, formatearFijo } from '../../../core/parser/numeros.ts';
import { NombreConCopia } from '../../components/NombreConCopia.tsx';
import { leerAtajo, textoAtajo, useAtajosCopia } from '../../util/atajos.ts';
import { avisoCopiaMultiple, copiarEnSerie } from '../../util/copiaEnSerie.ts';

/** Igual que la vista del Excel: 3 decimales en precios/tasas, vacío si no hay dato. */
function celdaDecimal(n: number | null): string {
  return n === null ? '' : formatearFijo(n, 3);
}

/** Monto como lo muestra el Excel ("82.950"); con céntimos solo si los trae. */
function montoComoExcel(centimos: number): string {
  return centimos % 100 === 0 ? formatearFijo(centimos / 100, 0) : formatearBs(centimos);
}
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
  formato,
  filtroInicial,
}: {
  nomina: repo.NominaResumen;
  fechas: FechasNomina;
  formato: Formato;
  filtroInicial: string | null;
}) {
  const { db, usuario, plataforma, cambiado, puedo } = useApp();

  const [busqueda, setBusqueda] = useState(filtroInicial ?? '');
  const [importacion, setImportacion] = useState<LecturaLibroNd | null>(null);
  const [importando, setImportando] = useState(false);
  const [filaAResolver, setFilaAResolver] = useState<NotaDebitoImportada | null>(null);
  const [dialogo, setDialogo] = useState<
    { tipo: 'manual'; ids: string[] } | { tipo: 'nd'; ids: string[] } | { tipo: 'previa-nd'; registroId: string } | null
  >(null);
  const [mensaje, setMensaje] = useState<{ nivel: 'ok' | 'error'; texto: string } | null>(null);
  const [progreso, setProgreso] = useState(false);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [copiando, setCopiando] = useState<{ hechos: number; total: number } | null>(null);
  const [aEliminar, setAEliminar] = useState<NotaDebitoImportada | null>(null);

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

  const catalogo = repo.catalogoMapa(db);
  const nombresFull = repo.nombresCompletos(db, nomina.tipo);
  const nombresFullOtro = otraNomina ? repo.nombresCompletos(db, otroTipo) : new Map<string, string>();
  const ndImportada = repo.ndImportadaMapa(db, nomina.id);
  const ndImportadaOtro = otraNomina ? repo.ndImportadaMapa(db, otraNomina.id) : new Map();

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

  // Mismos vínculos/grupos ya confirmados que usa "Comprobantes generales",
  // para que generar la ND desde aquí produzca exactamente el mismo
  // documento (combinado/agrupado) que generarla desde allá — esta columna
  // no crea un mecanismo de generación nuevo, solo un atajo al que ya existe.
  const vinculoPorCodigo = new Map(
    repo
      .vinculosProveedor(db)
      .filter((v) => v.estado === 'confirmado')
      .map((v) => [nomina.tipo === 'leche' ? v.codigoLeche : v.codigoTransporte, v]),
  );
  function contraparteDe(codigo: string): string | null {
    const vinculo = vinculoPorCodigo.get(codigo);
    if (!vinculo) return null;
    return nomina.tipo === 'leche' ? vinculo.codigoTransporte : vinculo.codigoLeche;
  }
  const grupoPorCodigo = new Map(
    repo
      .gruposMismoTipo(db)
      .filter((g) => g.tipo === nomina.tipo)
      .flatMap((g) => g.codigos.map((c) => [c, g] as const)),
  );

  function unidadDe(r: (typeof registros)[number]): { registroIds: string[]; datos: DatosComprobante } {
    const contraparteCodigo = contraparteDe(r.leido.codigo);
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
      return { registroIds: [r.id, contraparte.id], datos: combinado };
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
      return { registroIds: miembros.map((m) => m.id), datos: agrupado };
    }

    return { registroIds: [r.id], datos: construirComprobante(r.leido, r.manuales, r.notaDebito, ctx) };
  }

  function ndAplica(datos: DatosComprobante): boolean {
    if (datos.notaDebitoAgrupada) return datos.notaDebitoAgrupada.aplica;
    return datos.notaDebitoCombinada ? datos.notaDebitoCombinada.aplica : Boolean(datos.notaDebito?.aplica);
  }

  // ── Notas de débito importadas que comparten SAP y fábrica: se tratan
  //    como el mismo proveedor real solo para la ND (no para la factura,
  //    que sigue generándose por separado por código) — ver notaDebitoSap.ts.
  const registrosPorId = new Map([...registros, ...otrosRegistros].map((r) => [r.id, r]));
  const gruposSap = gruposNdPorSap([
    ...repo.notasDebitoImportadasDeNomina(db, nomina.id),
    ...(otraNomina ? repo.notasDebitoImportadasDeNomina(db, otraNomina.id) : []),
  ]);

  function unidadParaNd(r: (typeof registros)[number]): { registroIds: string[]; datos: DatosComprobante } {
    const grupo = gruposSap.get(r.id);
    if (!grupo) return unidadDe(r);
    return {
      registroIds: grupo.miembros.map((m) => m.registroId),
      datos: datosConNdPorSap(unidadDe(r).datos, grupo, registrosPorId),
    };
  }

  async function descargarSoloNd(registro: (typeof registros)[number]) {
    if (!usuario) return;
    setMensaje(null);
    const u = unidadParaNd(registro);
    if (!ndAplica(u.datos)) {
      setMensaje({ nivel: 'error', texto: 'Este proveedor no tiene una nota de débito calculable.' });
      return;
    }
    setProgreso(true);
    try {
      const items: ItemAGenerar[] = [{ registroIds: u.registroIds, datos: u.datos, numeroNomina: nomina.numero }];
      const archivos = await generarNotasDebito(items, { formato, opciones: OPCIONES_DIBUJO });
      for (const a of archivos) await plataforma.archivos.guardar(a.nombre, a.blob);
      await repo.registrarDescargas(
        db,
        usuario,
        archivos.flatMap((a) => a.registroIds.map((registroId) => ({ registroId, folio: a.folio, formato, archivo: a.nombre }))),
      );
      cambiado();
      setMensaje({ nivel: 'ok', texto: `Se descargó la nota de débito en ${formato.toUpperCase()}.` });
    } catch (error) {
      setMensaje({
        nivel: 'error',
        texto: `No se pudo generar la nota de débito: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setProgreso(false);
    }
  }

  /**
   * Imagen (PNG) de la ND de cada registro al portapapeles, una por una (ver
   * `copiarEnSerie`). Dos filas que terminan en la misma ND (p. ej. mismo
   * SAP sumado) se copian una sola vez. Cuenta como entrega. Devuelve
   * cuántas imágenes se copiaron.
   */
  async function copiarImagenesNd(lista: (typeof registros)[number][]): Promise<number> {
    if (!usuario) return 0;
    setMensaje(null);
    const vistas = new Set<string>();
    const unidades = lista.flatMap((r) => {
      const u = unidadParaNd(r);
      const clave = [...u.registroIds].sort().join('|');
      if (vistas.has(clave) || !ndAplica(u.datos)) return [];
      vistas.add(clave);
      return [u];
    });
    if (unidades.length === 0) throw new Error('ninguna de las filas elegidas tiene una nota de débito calculable.');

    const entregadas: Awaited<ReturnType<typeof generarNotasDebito>> = [];
    try {
      await copiarEnSerie(
        plataforma,
        unidades.map((u) => ({
          obtener: async () => {
            const [archivo] = await generarNotasDebito(
              [{ registroIds: u.registroIds, datos: u.datos, numeroNomina: nomina.numero }],
              { formato: 'png', opciones: OPCIONES_DIBUJO },
            );
            entregadas.push(archivo!);
            return archivo!.blob;
          },
        })),
        (hechos, total) => total > 1 && setCopiando({ hechos, total }),
      );
    } finally {
      setCopiando(null);
      if (entregadas.length > 0) {
        await repo.registrarDescargas(
          db,
          usuario,
          entregadas.flatMap((a) =>
            a.registroIds.map((registroId) => ({
              registroId,
              folio: a.folio,
              formato: 'png' as const,
              archivo: `${a.nombre} (copiado)`,
            })),
          ),
        );
        cambiado();
      }
    }
    return unidades.length;
  }

  const filasImportadas = repo.notasDebitoImportadasDeNomina(db, nomina.id);
  const filasImportadasOtro = otraNomina ? repo.notasDebitoImportadasDeNomina(db, otraNomina.id) : [];
  const quitadas = repo.notasDebitoQuitadasDeNomina(db, nomina.id);
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

  function alternar(id: string) {
    const copia = new Set(seleccion);
    if (copia.has(id)) copia.delete(id);
    else copia.add(id);
    setSeleccion(copia);
  }
  const seleccionadas = visibles.filter((f) => seleccion.has(f.id));
  const todasVisiblesElegidas = visibles.length > 0 && visibles.every((f) => seleccion.has(f.id));

  // ── Atajos de teclado: copian lo de las filas marcadas ──────────────
  async function atajoCopiarImagen() {
    if (copiando || progreso) return;
    if (seleccionadas.length === 0) {
      setMensaje({ nivel: 'error', texto: 'Marca al menos una fila (casilla de la izquierda) para copiar con el atajo.' });
      return;
    }
    const lista = seleccionadas.flatMap((f) => {
      const r = registroDe(f);
      return r && f.tipo === nomina.tipo ? [r] : [];
    });
    try {
      const n = await copiarImagenesNd(lista);
      setMensaje(
        n > 1
          ? await avisoCopiaMultiple(plataforma, n, 'imágenes')
          : { nivel: 'ok', texto: 'Imagen de la nota de débito copiada. Pégala con Ctrl + V.' },
      );
    } catch (e) {
      setMensaje({ nivel: 'error', texto: `No se pudo copiar: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  async function atajoCopiarNombre() {
    if (copiando) return;
    if (seleccionadas.length === 0) {
      setMensaje({ nivel: 'error', texto: 'Marca al menos una fila (casilla de la izquierda) para copiar con el atajo.' });
      return;
    }
    const nombres = [...new Set(seleccionadas.map((f) => registroDe(f)?.leido.nombre ?? f.proveedorExcel))];
    setMensaje(null);
    try {
      await copiarEnSerie(
        plataforma,
        nombres.map((n) => ({ obtener: async () => n })),
        (hechos, total) => total > 1 && setCopiando({ hechos, total }),
      );
      setMensaje(
        nombres.length > 1
          ? await avisoCopiaMultiple(plataforma, nombres.length, 'nombres')
          : { nivel: 'ok', texto: `Nombre copiado: ${nombres[0]}` },
      );
    } catch (e) {
      setMensaje({ nivel: 'error', texto: `No se pudo copiar: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setCopiando(null);
    }
  }

  useAtajosCopia(db, {
    copiarImagen: () => void atajoCopiarImagen(),
    copiarNombre: () => void atajoCopiarNombre(),
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
          <div className="buscador buscador-mitad">
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
            {seleccionadas.length > 0 && `${seleccionadas.length} seleccionada(s) · `}
            {visibles.length} de {filasImportadas.length} filas importadas
          </span>
        </div>

        {filasImportadas.length > 0 && (
          <p className="tenue pequeno ayuda-atajos">
            Marca una o varias filas y presiona <kbd>{textoAtajo(leerAtajo(db, 'copiarImagen'))}</kbd> para
            copiar la imagen de su nota de débito, o <kbd>{textoAtajo(leerAtajo(db, 'copiarNombre'))}</kbd>{' '}
            para copiar el nombre. Con varias filas, cada una queda aparte en el historial del
            portapapeles (Win + V). Los atajos se cambian en Ajustes → Sistema.
          </p>
        )}

        {copiando && (
          <Aviso nivel="info">
            Copiando {copiando.hechos} de {copiando.total}… no cambies de ventana hasta que termine.
          </Aviso>
        )}

        {filasImportadas.length === 0 ? (
          <Vacio icono="🧾" titulo="Todavía no se ha importado ninguna nota de débito">
            Usa el botón «Importar Excel» de arriba para subir el archivo con los montos ya
            calculados.
          </Vacio>
        ) : (
          <div className="tabla-envoltura tabla-adaptable envoltura-nd">
            <table className="tabla tabla-nd">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input
                      type="checkbox"
                      checked={todasVisiblesElegidas}
                      onChange={() =>
                        setSeleccion(todasVisiblesElegidas ? new Set() : new Set(visibles.map((f) => f.id)))
                      }
                      aria-label="Seleccionar todas las filas visibles"
                    />
                  </th>
                  <th>Proveedor</th>
                  <th className="num">Litros</th>
                  <th className="num">$/Lts · $/Flete</th>
                  <th className="num">Bs x Lts Inicio</th>
                  <th className="num">Bs x Lts Ajustado</th>
                  <th className="num">Dif x Lts</th>
                  <th>Fecha ND</th>
                  <th className="num">Bs. a Pagar x Dif.</th>
                  <th>Estado</th>
                  <th>Generar ND</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((f) => {
                  const registro = registroDe(f);
                  const etiqueta = ETIQUETA_EMPAREJAMIENTO[f.emparejamiento];
                  const litros = (f.tipo === 'leche' ? f.litrosEnviados : f.litrosTransportados) ?? 0;
                  const codigo = registro ? registro.leido.codigo : f.codigoExcel;
                  return (
                    <tr key={f.id} className={seleccion.has(f.id) ? 'elegida' : undefined}>
                      <td className="selector">
                        <input
                          type="checkbox"
                          checked={seleccion.has(f.id)}
                          onChange={() => alternar(f.id)}
                          aria-label={`Seleccionar ${registro?.leido.nombre ?? f.proveedorExcel}`}
                        />
                      </td>
                      <td className="principal">
                        {registro ? (
                          <NombreConCopia
                            nombre={registro.leido.nombre}
                            tituloImagen="Copiar nota de débito como imagen"
                            alCopiarImagen={
                              f.tipo === nomina.tipo
                                ? () => copiarImagenesNd([registro]).then(() => undefined)
                                : undefined
                            }
                            imagenDeshabilitada={progreso || copiando !== null || !puedo('generar-comprobante')}
                            alError={(texto) => setMensaje({ nivel: 'error', texto })}
                          />
                        ) : (
                          <span className="tenue">{f.proveedorExcel}</span>
                        )}
                        <div className="sub">
                          {codigo ? `${codigo} · ` : ''}
                          {f.tipo === 'leche' ? 'Leche' : 'Transporte'}
                        </div>
                      </td>
                      <td className="num" data-etiqueta="Litros">{formatearEntero(litros)}</td>
                      <td className="num" data-etiqueta={f.tipo === 'leche' ? '$/Lts' : '$/Flete'}>
                        {celdaDecimal(f.tipo === 'leche' ? f.precioUsdLts : f.precioUsdFlete)}
                      </td>
                      <td className="num" data-etiqueta="Bs x Lts Inicio">{celdaDecimal(f.bsXLtsInicio)}</td>
                      <td className="num" data-etiqueta="Bs x Lts Ajustado">{celdaDecimal(f.bsXLtsAjustado)}</td>
                      <td className="num" data-etiqueta="Dif x Lts">{celdaDecimal(f.difXLts)}</td>
                      <td className="sin-salto" data-etiqueta="Fecha ND">{fechaAMostrar(f.fechaNota)}</td>
                      <td className="num" data-etiqueta="Bs. a Pagar x Dif.">{montoComoExcel(f.centimos)}</td>
                      <td data-etiqueta="Estado">
                        <Pastilla tono={etiqueta.tono}>{etiqueta.texto}</Pastilla>
                      </td>
                      <td className="botonera-nd">
                        {registro && f.tipo === nomina.tipo ? (
                          <div className="botonera">
                            <button
                              className="btn chico"
                              title="Ver nota de débito"
                              onClick={() => setDialogo({ tipo: 'previa-nd', registroId: registro.id })}
                            >
                              🧾 Ver
                            </button>
                            <button
                              className="btn chico primario"
                              disabled={progreso || !puedo('generar-comprobante')}
                              onClick={() => void descargarSoloNd(registro)}
                            >
                              Descargar ND
                            </button>
                          </div>
                        ) : (
                          <span className="tenue pequeno">
                            {registro
                              ? `Ver en la nómina de ${f.tipo === 'leche' ? 'leche' : 'transporte'}`
                              : 'Empareja primero'}
                          </span>
                        )}
                      </td>
                      <td className="botonera-nd">
                        <div className="botonera">
                          {!f.registroId && (
                            <button
                              className="btn chico primario"
                              disabled={!puedo('nota-debito')}
                              onClick={() => setFilaAResolver(f)}
                            >
                              Emparejar
                            </button>
                          )}
                          {registro && (
                            <>
                              <button
                                className="btn chico"
                                title="Agregar concepto manual"
                                disabled={!puedo('concepto-manual')}
                                onClick={() => setDialogo({ tipo: 'manual', ids: [registro.id] })}
                              >
                                + Concepto
                              </button>
                              <button
                                className="btn chico"
                                title="Configurar nota de débito manual (se ignora mientras haya import)"
                                disabled={!puedo('nota-debito')}
                                onClick={() => setDialogo({ tipo: 'nd', ids: [registro.id] })}
                              >
                                $ ND manual
                              </button>
                            </>
                          )}
                          <button
                            className="btn chico peligro"
                            disabled={!puedo('nota-debito')}
                            title="La saca del cálculo; queda abajo en «Notas de débito quitadas» para restaurarla"
                            onClick={() => {
                              void repo.quitarNotaDebitoImportada(db, usuario!, f.id).then(() => {
                                cambiado();
                                setMensaje({
                                  nivel: 'ok',
                                  texto: `Se quitó la nota de débito de ${registro?.leido.nombre ?? f.proveedorExcel}. Puedes restaurarla abajo, en «Notas de débito quitadas».`,
                                });
                              });
                            }}
                          >
                            Quitar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>

      {quitadas.length > 0 && (
        <Tarjeta
          titulo={`Notas de débito quitadas (${quitadas.length})`}
          descripcion="No cuentan para ningún comprobante mientras estén aquí. «Restaurar» la vuelve a usar tal cual; «Eliminar» la borra para siempre."
        >
          <div className="tabla-envoltura tabla-adaptable">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Proveedor</th>
                  <th className="num">Litros</th>
                  <th>Fecha ND</th>
                  <th className="num">Bs. a Pagar x Dif.</th>
                  <th>Quitada el</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {quitadas.map((f) => {
                  const registro = registroDe(f);
                  const codigo = registro ? registro.leido.codigo : f.codigoExcel;
                  const litros = (f.tipo === 'leche' ? f.litrosEnviados : f.litrosTransportados) ?? 0;
                  return (
                    <tr key={f.id}>
                      <td className="principal">
                        <span className="nombre-prov">{registro ? registro.leido.nombre : f.proveedorExcel}</span>
                        <div className="sub">
                          {codigo ? `${codigo} · ` : ''}
                          {f.tipo === 'leche' ? 'Leche' : 'Transporte'}
                        </div>
                      </td>
                      <td className="num" data-etiqueta="Litros">{formatearEntero(litros)}</td>
                      <td className="sin-salto" data-etiqueta="Fecha ND">{fechaAMostrar(f.fechaNota)}</td>
                      <td className="num" data-etiqueta="Bs. a Pagar x Dif.">{montoComoExcel(f.centimos)}</td>
                      <td className="sin-salto" data-etiqueta="Quitada el">
                        {f.quitadaEn ? fechaAMostrar(f.quitadaEn.slice(0, 10)) : ''}
                      </td>
                      <td className="botonera-nd">
                        <div className="botonera botonera-fila">
                          <button
                            className="btn chico primario"
                            disabled={!puedo('nota-debito')}
                            onClick={() => {
                              void repo
                                .restaurarNotaDebitoImportada(db, usuario!, f.id)
                                .then(() => {
                                  cambiado();
                                  setMensaje({
                                    nivel: 'ok',
                                    texto: `Se restauró la nota de débito de ${registro?.leido.nombre ?? f.proveedorExcel}.`,
                                  });
                                })
                                .catch((e: unknown) =>
                                  setMensaje({
                                    nivel: 'error',
                                    texto: `No se pudo restaurar: ${e instanceof Error ? e.message : String(e)}`,
                                  }),
                                );
                            }}
                          >
                            Restaurar
                          </button>
                          <button
                            className="btn chico peligro"
                            disabled={!puedo('nota-debito')}
                            onClick={() => setAEliminar(f)}
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Tarjeta>
      )}

      {aEliminar && (
        <Confirmar
          titulo="Eliminar para siempre"
          mensaje={`La nota de débito de «${registroDe(aEliminar)?.leido.nombre ?? aEliminar.proveedorExcel}» se borrará y ya no se podrá restaurar (solo volviendo a importar el Excel).`}
          textoConfirmar="Eliminar"
          peligro
          alCerrar={() => setAEliminar(null)}
          alConfirmar={() => {
            const id = aEliminar.id;
            setAEliminar(null);
            void repo.eliminarNotaDebitoImportada(db, usuario!, id).then(() => cambiado());
          }}
        />
      )}

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

      {dialogo?.tipo === 'previa-nd' && (
        <Modal
          ancho
          titulo="Vista previa de la nota de débito"
          descripcion="Así se verá el PDF y la imagen que descargues."
          alCerrar={() => setDialogo(null)}
          pie={
            <button className="btn" onClick={() => setDialogo(null)}>
              Cerrar
            </button>
          }
        >
          <VistaPrevia
            datos={unidadParaNd(registros.find((r) => r.id === dialogo.registroId)!).datos}
            opciones={OPCIONES_DIBUJO}
            cual="nd"
          />
        </Modal>
      )}
    </>
  );
}
