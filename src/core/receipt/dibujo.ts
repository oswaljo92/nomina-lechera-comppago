import { fechaAMostrar, formatearBs, formatearDecimal, formatearEntero } from '../parser/numeros.ts';
import type { DatosComprobante } from './comprobante.ts';
import type { NotaDebitoCalculada } from '../types.ts';

/**
 * Descripción del comprobante como una lista de primitivas de dibujo.
 *
 * El primer intento fotografiaba el DOM con html-to-image. Se descartó por un
 * motivo concreto: esa técnica rasteriza mediante un <foreignObject> de SVG,
 * que el navegador solo resuelve mientras la página se está pintando. Bastaba
 * con minimizar la ventana o cambiar de pestaña para que un lote de decenas de
 * comprobantes se quedara congelado a la espera.
 *
 * Dibujando explícitamente se gana además que el PDF lleve texto de verdad
 * —seleccionable y buscable— en lugar de una imagen, y que el paquete pese
 * bastante menos al no arrastrar el rasterizador.
 *
 * Las coordenadas van en PUNTOS tipográficos sobre una página A4 vertical, que
 * es la unidad nativa del PDF. El renderizador de canvas solo multiplica por la
 * escala que necesite.
 */

/** Ancho A4 vertical en puntos. El alto se ajusta al contenido. */
export const ANCHO_PT = 595.28;
/** Alto mínimo, para que un comprobante corto siga pareciendo un documento. */
const ALTO_MINIMO_PT = 500;
const MARGEN = 40;
const ANCHO_UTIL = ANCHO_PT - MARGEN * 2;

/**
 * El signo menos tipográfico (−) no existe en la codificación de las fuentes
 * estándar del PDF. Se usa el guion normal para que la imagen y el PDF salgan
 * idénticos carácter por carácter.
 */
const MENOS = '-';

export const COLORES = {
  tinta: '#16211c',
  tenue: '#55635b',
  suave: '#7d8a82',
  verde: '#0f2e24',
  verdeClaro: '#dcf0e6',
  linea: '#dfe3dd',
  lineaFuerte: '#c3cabf',
  blanco: '#ffffff',
  aviso: '#7a4d00',
  avisoFondo: '#fdf1dc',
  error: '#8c1d18',
  errorFondo: '#fbe6e4',
  panel: '#fbfcfa',
} as const;

export type Alineacion = 'izq' | 'der' | 'centro';
export type Peso = 'normal' | 'bold';

export type Primitiva =
  | {
      tipo: 'rect';
      x: number;
      y: number;
      ancho: number;
      alto: number;
      relleno?: string;
      borde?: string;
      grosor?: number;
      radio?: number;
    }
  | { tipo: 'linea'; x1: number; y1: number; x2: number; y2: number; color: string; grosor: number }
  | {
      tipo: 'texto';
      x: number;
      /** Línea base del texto. */
      y: number;
      texto: string;
      tam: number;
      peso: Peso;
      color: string;
      alineacion: Alineacion;
    }
  | { tipo: 'imagen'; x: number; y: number; ancho: number; alto: number; dataUrl: string };

/** Mide el ancho de un texto. Lo provee cada renderizador. */
export type Medidor = (texto: string, tam: number, peso: Peso) => number;

export interface OpcionesDibujo {
  mostrarLitrosDia: boolean;
  mostrarBanco: boolean;
  mostrarNotaDebito: boolean;
  /** Si es true, la factura no dibuja la caja/tabla de ND (queda solo como
   * documento aparte vía `dibujarNotaDebito`); las fechas de referencia en
   * el bloque de identificación se mantienen igual. */
  separarNd: boolean;
}

export const OPCIONES_DIBUJO: OpcionesDibujo = {
  mostrarLitrosDia: false,
  mostrarBanco: false,
  mostrarNotaDebito: true,
  separarNd: false,
};

class Lienzo {
  primitivas: Primitiva[] = [];
  private medir: Medidor;

  constructor(medir: Medidor) {
    this.medir = medir;
  }

  rect(p: Omit<Extract<Primitiva, { tipo: 'rect' }>, 'tipo'>): void {
    this.primitivas.push({ tipo: 'rect', ...p });
  }

  linea(x1: number, y: number, x2: number, color: string = COLORES.linea, grosor = 0.6): void {
    this.primitivas.push({ tipo: 'linea', x1, y1: y, x2, y2: y, color, grosor });
  }

  texto(
    texto: string,
    x: number,
    y: number,
    opciones: { tam?: number; peso?: Peso; color?: string; alineacion?: Alineacion } = {},
  ): void {
    if (!texto) return;
    this.primitivas.push({
      tipo: 'texto',
      x,
      y,
      texto,
      tam: opciones.tam ?? 9,
      peso: opciones.peso ?? 'normal',
      color: opciones.color ?? COLORES.tinta,
      alineacion: opciones.alineacion ?? 'izq',
    });
  }

  imagen(dataUrl: string, x: number, y: number, ancho: number, alto: number): void {
    this.primitivas.push({ tipo: 'imagen', x, y, ancho, alto, dataUrl });
  }

  /** Parte un texto en las líneas que quepan en `ancho`. */
  partir(texto: string, ancho: number, tam: number, peso: Peso = 'normal'): string[] {
    const palabras = texto.split(/\s+/).filter(Boolean);
    const lineas: string[] = [];
    let actual = '';
    for (const palabra of palabras) {
      const tentativa = actual ? `${actual} ${palabra}` : palabra;
      if (this.medir(tentativa, tam, peso) <= ancho || actual === '') {
        actual = tentativa;
      } else {
        lineas.push(actual);
        actual = palabra;
      }
    }
    if (actual) lineas.push(actual);
    return lineas;
  }

  /** Recorta con puntos suspensivos si no cabe. */
  recortar(texto: string, ancho: number, tam: number, peso: Peso = 'normal'): string {
    if (this.medir(texto, tam, peso) <= ancho) return texto;
    let corto = texto;
    while (corto.length > 1 && this.medir(`${corto}…`, tam, peso) > ancho) {
      corto = corto.slice(0, -1);
    }
    return `${corto}…`;
  }
}

export interface Hoja {
  primitivas: Primitiva[];
  /** Alto en puntos, calculado a partir del contenido. */
  alto: number;
}

/**
 * Logo/razón social/RIF/dirección/contacto, más el aviso si la fábrica no
 * tiene empresa asignada. Igual en el comprobante completo y en la nota de
 * débito independiente.
 */
function dibujarEncabezadoEmpresa(
  l: Lienzo,
  datos: DatosComprobante,
  izq: number,
  der: number,
  y0: number,
): number {
  let y = y0;
  const altoLogo = 62;
  const xTextoEmpresa = izq + (datos.empresa?.logo ? altoLogo + 14 : 0);

  if (datos.empresa?.logo) {
    l.imagen(datos.empresa.logo, izq, y, altoLogo, altoLogo);
  }

  let yEmpresa = y + 13;
  l.texto(
    l.recortar(datos.empresa?.razonSocial ?? 'EMPRESA SIN CONFIGURAR', der - xTextoEmpresa, 14, 'bold'),
    xTextoEmpresa,
    yEmpresa,
    { tam: 14, peso: 'bold', color: COLORES.verde },
  );
  yEmpresa += 14;
  l.texto(`RIF: ${datos.empresa?.rif ?? '—'}`, xTextoEmpresa, yEmpresa, {
    tam: 9,
    peso: 'bold',
    color: COLORES.tenue,
  });
  yEmpresa += 11;
  for (const linea of l.partir(datos.empresa?.direccionFiscal ?? '', der - xTextoEmpresa, 8.5)) {
    l.texto(linea, xTextoEmpresa, yEmpresa, { tam: 8.5, color: COLORES.tenue });
    yEmpresa += 10;
  }
  const contacto = [datos.empresa?.telefono, datos.empresa?.email].filter(Boolean).join('   ·   ');
  if (contacto) {
    l.texto(contacto, xTextoEmpresa, yEmpresa, { tam: 8.5, color: COLORES.tenue });
    yEmpresa += 10;
  }

  y = Math.max(y + altoLogo, yEmpresa) + 6;
  l.linea(izq, y, der, COLORES.verde, 2.2);
  y += 16;

  if (!datos.empresa) {
    const alto = 26;
    l.rect({
      x: izq,
      y: y - 10,
      ancho: ANCHO_UTIL,
      alto,
      relleno: COLORES.avisoFondo,
      borde: COLORES.aviso,
      grosor: 0.6,
      radio: 4,
    });
    l.texto(
      l.recortar(
        `La fábrica ${datos.fabricaCod} ${datos.fabricaNom} no tiene empresa asignada en Ajustes.`,
        ANCHO_UTIL - 16,
        8.5,
      ),
      izq + 8,
      y + 6,
      { tam: 8.5, color: COLORES.aviso },
    );
    y += alto + 8;
  }

  return y;
}

/**
 * Título del documento + folio + nómina/fechas + datos del proveedor. Igual
 * en el comprobante completo y en la nota de débito independiente, salvo el
 * título (parametrizado) y las fechas de factura/ND (siempre visibles aquí,
 * porque en la nota de débito son el dato principal).
 */
function dibujarBloqueIdentificacion(
  l: Lienzo,
  datos: DatosComprobante,
  izq: number,
  der: number,
  y0: number,
  opciones: OpcionesDibujo,
  titulo: string,
): number {
  let y = y0;

  l.texto(titulo, izq, y, { tam: 13, peso: 'bold', color: COLORES.verde });
  l.texto('FOLIO', der, y - 8, { tam: 7, peso: 'bold', color: COLORES.suave, alineacion: 'der' });
  l.texto(datos.folio, der, y + 2, { tam: 12, peso: 'bold', color: COLORES.verde, alineacion: 'der' });
  y += 14;
  if (datos.combinado) {
    l.texto('COMBINADO · LECHE + FLETE', izq, y, { tam: 7.5, peso: 'bold', color: COLORES.tenue });
    y += 11;
  }
  l.texto(
    `Nómina Nº ${datos.numero}  ·  Año ${datos.anio}  ·  del ${fechaAMostrar(datos.fechaIni)} al ${fechaAMostrar(datos.fechaFin)}`,
    (izq + der) / 2,
    y,
    { tam: 9, color: COLORES.tenue, alineacion: 'centro' },
  );
  y += 11;
  l.linea(izq, y, der);
  y += 18;

  // ── Proveedor ──
  l.texto(l.recortar(datos.proveedor.nombre, ANCHO_UTIL, 13, 'bold'), izq, y, {
    tam: 13,
    peso: 'bold',
  });
  y += 14;

  // Fecha de factura y de nota de débito, junto al nombre: es lo primero que
  // el proveedor necesita saber para facturar con la fecha correcta.
  if (opciones.mostrarNotaDebito) {
    const lineasFecha: string[] = [];
    if (datos.notaDebitoCombinada) {
      const { leche, transporte } = datos.notaDebitoCombinada;
      if (leche?.aplica) {
        lineasFecha.push(
          `Leche · Fecha de Factura ${fechaAMostrar(leche.fechaFactura)}   ·   Fecha de Nota de débito ${fechaAMostrar(leche.fechaNota)}`,
        );
      }
      if (transporte?.aplica) {
        lineasFecha.push(
          `Flete · Fecha de Factura ${fechaAMostrar(transporte.fechaFactura)}   ·   Fecha de Nota de débito ${fechaAMostrar(transporte.fechaNota)}`,
        );
      }
    } else if (datos.notaDebito?.aplica) {
      lineasFecha.push(
        `Fecha de Factura ${fechaAMostrar(datos.notaDebito.fechaFactura)}   ·   Fecha de Nota de débito ${fechaAMostrar(datos.notaDebito.fechaNota)}`,
      );
    }
    for (const linea of lineasFecha) {
      l.texto(linea, izq, y, { tam: 9, peso: 'bold', color: COLORES.verde });
      y += 12;
    }
  }

  const campos: [string, string][] = [
    [datos.tipo === 'leche' ? 'CÓDIGO GANADERO' : 'CÓDIGO DE RUTA', datos.proveedor.codigo],
    ['RUTA', datos.proveedor.ruta],
    ['CÉDULA', datos.proveedor.cedula ?? '—'],
    ['RIF', datos.proveedor.rif ?? '—'],
  ];
  if (datos.combinado) {
    campos.push(['CÓD. TRANSPORTE', datos.combinado.transporte.codigo]);
    campos.push(['RUTA TRANSPORTE', datos.combinado.transporte.ruta]);
  }
  if (opciones.mostrarBanco) {
    campos.push(['BANCO', datos.proveedor.banco ?? '—']);
    campos.push(['CUENTA', datos.proveedor.cuenta ?? '—']);
  }

  const porFila = 4;
  const anchoCampo = ANCHO_UTIL / porFila;
  campos.forEach((campo, i) => {
    const fila = Math.floor(i / porFila);
    const col = i % porFila;
    const x = izq + col * anchoCampo;
    const yy = y + fila * 26;
    l.texto(campo[0], x, yy, { tam: 6.5, peso: 'bold', color: COLORES.suave });
    l.texto(l.recortar(campo[1], anchoCampo - 8, 9.5, 'bold'), x, yy + 11, {
      tam: 9.5,
      peso: 'bold',
    });
  });
  y += Math.ceil(campos.length / porFila) * 26 + 4;
  l.linea(izq, y, der);
  y += 16;

  return y;
}

/** Filas de la tabla de cálculo de ND (por Leche/Flete si combinado, por
 * código si agrupado, una sola si es individual). */
function datosDetalleNd(datos: DatosComprobante): {
  desglose: { etiqueta: string; centimos: number }[];
  filasTabla: { serv: string; r: NotaDebitoCalculada }[];
} {
  const nd = datos.notaDebito;
  const ndComb = datos.notaDebitoCombinada;
  const ndAgr = datos.notaDebitoAgrupada;

  if (ndAgr) {
    const aplicables = ndAgr.porCodigo.filter(
      (p): p is { codigo: string; resultado: NotaDebitoCalculada } => Boolean(p.resultado?.aplica),
    );
    return {
      desglose:
        aplicables.length > 1
          ? aplicables.map((p) => ({ etiqueta: p.codigo, centimos: p.resultado.centimos }))
          : [],
      filasTabla: aplicables.map((p) => ({ serv: p.codigo, r: p.resultado })),
    };
  }

  const dosLineasNd = Boolean(ndComb?.aplica && ndComb.leche?.aplica && ndComb.transporte?.aplica);
  const filasTabla: { serv: string; r: NotaDebitoCalculada }[] = [];
  if (ndComb) {
    if (ndComb.leche?.aplica) filasTabla.push({ serv: 'Leche', r: ndComb.leche });
    if (ndComb.transporte?.aplica) filasTabla.push({ serv: 'Flete', r: ndComb.transporte });
  } else if (nd?.aplica) {
    filasTabla.push({ serv: datos.tipo === 'leche' ? 'Leche' : 'Flete', r: nd });
  }
  return {
    desglose: dosLineasNd
      ? [
          { etiqueta: 'Leche', centimos: filasTabla.find((f) => f.serv === 'Leche')!.r.centimos },
          { etiqueta: 'Flete', centimos: filasTabla.find((f) => f.serv === 'Flete')!.r.centimos },
        ]
      : [],
    filasTabla,
  };
}

/** Alto que ocupa `dibujarDetalleNd` para el caso en que la ND sí aplica. */
function altoDetalleNd(desgloseLength: number, filasTablaLength: number): number {
  return (
    (desgloseLength > 0 ? desgloseLength * 9 + 5 : 0) +
    (filasTablaLength > 0 ? 16 + filasTablaLength * 9 + 6 : 0)
  );
}

/**
 * Desglose por Leche/Flete (combinado) o por código (agrupado) del monto de
 * ND, cuando hay más de una fuente aplicando, + tabla con los datos del
 * cálculo (SERV, LITROS, PRECIO $/L, TASA INICIO, TASA FINAL), sin mostrar
 * la multiplicación. Reusado por el comprobante completo y por la nota de
 * débito independiente.
 */
function dibujarDetalleNd(l: Lienzo, datos: DatosComprobante, izq: number, y0: number): number {
  let y = y0;
  const { desglose, filasTabla } = datosDetalleNd(datos);

  desglose.forEach((d, i) => {
    l.texto(`${d.etiqueta}: ${formatearBs(d.centimos)} Bs`, izq + 12, y + 9 + i * 9, {
      tam: 7.5,
      color: COLORES.tenue,
    });
  });
  if (desglose.length > 0) y += desglose.length * 9 + 5;

  if (filasTabla.length > 0) {
    const cols = [izq + 12, izq + 60, izq + 130, izq + 210, izq + 290];
    ['SERV', 'LITROS', 'PRECIO $/L', 'TASA INICIO', 'TASA FINAL'].forEach((h, i) =>
      l.texto(h, cols[i]!, y + 9, { tam: 6.5, peso: 'bold', color: COLORES.suave }),
    );
    y += 16;
    filasTabla.forEach(({ serv, r }) => {
      l.texto(serv, cols[0]!, y, { tam: 7.5, color: COLORES.tenue });
      l.texto(formatearEntero(r.litrosBase), cols[1]!, y, { tam: 7.5, color: COLORES.tenue });
      l.texto(formatearDecimal(r.precioUsd, 4), cols[2]!, y, { tam: 7.5, color: COLORES.tenue });
      l.texto(formatearDecimal(r.tasaIni), cols[3]!, y, { tam: 7.5, color: COLORES.tenue });
      l.texto(formatearDecimal(r.tasaFin), cols[4]!, y, { tam: 7.5, color: COLORES.tenue });
      y += 9;
    });
    y += 6;
  }
  return y;
}

export function dibujarComprobante(
  datos: DatosComprobante,
  opciones: OpcionesDibujo,
  medir: Medidor,
): Hoja {
  const l = new Lienzo(medir);
  const izq = MARGEN;
  const der = ANCHO_PT - MARGEN;
  let y = MARGEN;

  y = dibujarEncabezadoEmpresa(l, datos, izq, der, y);
  y = dibujarBloqueIdentificacion(l, datos, izq, der, y, opciones, 'COMPROBANTE DE PAGO');

  // ── Litros ──
  if (datos.litrosTotal !== null) {
    l.texto('LITROS DE LA SEMANA', izq, y, { tam: 6.5, peso: 'bold', color: COLORES.suave });
    y += 15;
    l.texto(formatearEntero(datos.litrosTotal), izq, y, { tam: 17, peso: 'bold' });
    const anchoNumero = medir(formatearEntero(datos.litrosTotal), 17, 'bold');
    l.texto('litros', izq + anchoNumero + 6, y, { tam: 9.5, peso: 'bold', color: COLORES.tenue });
    y += 6;

    if (opciones.mostrarLitrosDia && datos.litrosDia.length > 0) {
      y += 10;
      let x = izq;
      for (const dia of datos.litrosDia) {
        const etiqueta = `${fechaAMostrar(dia.fecha).slice(0, 5)}  ${formatearEntero(dia.litros)}`;
        const ancho = medir(etiqueta, 8, 'normal') + 14;
        if (x + ancho > der) {
          x = izq;
          y += 18;
        }
        l.rect({
          x,
          y: y - 9,
          ancho,
          alto: 15,
          relleno: COLORES.panel,
          borde: COLORES.linea,
          grosor: 0.6,
          radio: 3,
        });
        l.texto(etiqueta, x + 7, y + 1, { tam: 8, color: COLORES.tinta });
        x += ancho + 5;
      }
      y += 8;
    }
    y += 14;
  }

  // ── Conceptos ──
  const xCodigo = izq;
  const xNombre = izq + 42;
  const xMonto = der;

  l.texto('CONCEPTOS', izq, y, { tam: 6.5, peso: 'bold', color: COLORES.suave });
  y += 14;

  // Divisor sutil entre lo que viene de cada lado: leche/flete si es
  // combinado, o el código si es agrupado (mismo tipo) — para que quede
  // claro de dónde salió cada línea sin inventar un segundo "CONCEPTOS".
  let origenPrevio: string | undefined;
  function marcaOrigen(linea: { origen?: 'leche' | 'flete'; origenCodigo?: string }): void {
    const clave = linea.origen ?? linea.origenCodigo;
    if (!clave || clave === origenPrevio) return;
    origenPrevio = clave;
    const etiqueta = linea.origen ? (linea.origen === 'leche' ? 'LECHE' : 'FLETE') : `CÓDIGO ${linea.origenCodigo}`;
    l.rect({
      x: izq,
      y: y - 8,
      ancho: 3,
      alto: 10,
      relleno: linea.origen === 'flete' ? COLORES.suave : COLORES.verde,
    });
    l.texto(etiqueta, izq + 8, y, { tam: 6.5, peso: 'bold', color: COLORES.tenue });
    y += 12;
  }

  for (const linea of datos.pagos) {
    marcaOrigen(linea);
    l.texto(linea.codigo, xCodigo, y, { tam: 8, color: COLORES.tenue });
    l.texto(l.recortar(linea.nombre, xMonto - xNombre - 110, 9.5), xNombre, y, { tam: 9.5 });
    l.texto(formatearBs(linea.centimos), xMonto, y, { tam: 9.5, alineacion: 'der' });
    y += 6;
    l.linea(izq, y, der, '#eef1ed', 0.5);
    y += 11;
  }
  l.linea(izq, y - 6, der, COLORES.lineaFuerte, 1);
  l.texto('Bruto', xNombre, y + 5, { tam: 9.5, peso: 'bold' });
  l.texto(formatearBs(datos.bruto), xMonto, y + 5, { tam: 9.5, peso: 'bold', alineacion: 'der' });
  y += 22;

  if (datos.deducciones.length > 0) {
    origenPrevio = undefined;
    for (const linea of datos.deducciones) {
      marcaOrigen(linea);
      l.texto(linea.codigo, xCodigo, y, { tam: 8, color: COLORES.tenue });
      l.texto(l.recortar(linea.nombre, xMonto - xNombre - 110, 9.5), xNombre, y, {
        tam: 9.5,
      });
      l.texto(`${MENOS} ${formatearBs(linea.centimos)}`, xMonto, y, { tam: 9.5, alineacion: 'der' });
      y += 6;
      l.linea(izq, y, der, '#eef1ed', 0.5);
      y += 11;
    }
    l.linea(izq, y - 6, der, COLORES.lineaFuerte, 1);
    l.texto('Total deducciones', xNombre, y + 5, { tam: 9.5, peso: 'bold' });
    l.texto(`${MENOS} ${formatearBs(datos.totalDeducciones)}`, xMonto, y + 5, {
      tam: 9.5,
      peso: 'bold',
      alineacion: 'der',
    });
    y += 22;
  }

  // ── Totales ──
  y += 6;
  const nd = datos.notaDebito;
  const ndComb = datos.notaDebitoCombinada;
  const ndAgr = datos.notaDebitoAgrupada;
  const mostrarNd =
    opciones.mostrarNotaDebito &&
    !opciones.separarNd &&
    (nd !== null || ndComb !== undefined || ndAgr !== undefined);
  const { desglose, filasTabla } = datosDetalleNd(datos);

  // Si ningún lado aplica, `filasTabla` queda vacío (ver arriba) — hace
  // falta un alto fijo aparte para los motivos en rojo de esa rama.
  const aplicaNd = ndAgr ? ndAgr.aplica : ndComb ? ndComb.aplica : Boolean(nd?.aplica);

  const filasTotales = 2 + (mostrarNd ? 1 : 0);
  const altoFila = 26;
  const altoDetalle = !mostrarNd ? 0 : aplicaNd ? altoDetalleNd(desglose.length, filasTabla.length) : 16;
  const altoCaja = filasTotales * altoFila + altoDetalle;

  l.rect({
    x: izq,
    y,
    ancho: ANCHO_UTIL,
    alto: altoCaja,
    borde: COLORES.verde,
    grosor: 1.4,
    radio: 5,
  });

  // Total a facturar, destacado en negativo (antes era Neto a pagar: se
  // intercambió el orden y los colores a pedido).
  l.rect({ x: izq + 1, y: y + 1, ancho: ANCHO_UTIL - 2, alto: altoFila - 1, relleno: COLORES.verde });
  l.texto('TOTAL A FACTURAR', izq + 12, y + 17, { tam: 9.5, peso: 'bold', color: COLORES.blanco });
  l.texto(`${formatearBs(datos.totalFacturar)} Bs`, der - 12, y + 18, {
    tam: 13,
    peso: 'bold',
    color: COLORES.blanco,
    alineacion: 'der',
  });
  y += altoFila;

  l.rect({ x: izq + 1, y, ancho: ANCHO_UTIL - 2, alto: altoFila, relleno: COLORES.verdeClaro });
  l.linea(izq, y, der, COLORES.linea, 0.6);
  l.texto('NETO A PAGAR', izq + 12, y + 17, { tam: 9.5, peso: 'bold' });
  l.texto(`${formatearBs(datos.neto)} Bs`, der - 12, y + 18, {
    tam: 13,
    peso: 'bold',
    alineacion: 'der',
  });
  y += altoFila;

  if (mostrarNd) {
    l.linea(izq, y, der, COLORES.linea, 0.6);
    if (aplicaNd) {
      const centimosNd = ndAgr ? ndAgr.centimos : ndComb ? ndComb.centimos : (nd as { centimos: number }).centimos;
      l.texto('NOTA DE DÉBITO', izq + 12, y + 17, { tam: 9.5, peso: 'bold' });
      l.texto(`${formatearBs(centimosNd)} Bs`, der - 12, y + 18, {
        tam: 13,
        peso: 'bold',
        alineacion: 'der',
      });
      y += altoFila;
      y = dibujarDetalleNd(l, datos, izq, y);
    } else {
      l.rect({ x: izq + 1, y, ancho: ANCHO_UTIL - 2, alto: altoFila + altoDetalle, relleno: COLORES.errorFondo });
      l.texto('NOTA DE DÉBITO', izq + 12, y + 16, { tam: 9.5, peso: 'bold', color: COLORES.error });
      const motivos: string[] = ndAgr
        ? ndAgr.porCodigo
            .filter((p) => p.resultado && !p.resultado.aplica)
            .map((p) => `${p.codigo}: ${(p.resultado as { motivo: string }).motivo}`)
        : ndComb
        ? [
            ndComb.leche && !ndComb.leche.aplica ? `Leche: ${ndComb.leche.motivo}` : null,
            ndComb.transporte && !ndComb.transporte.aplica ? `Flete: ${ndComb.transporte.motivo}` : null,
          ].filter((m): m is string => m !== null)
        : [`No calculada: ${(nd as { motivo: string }).motivo}`];
      motivos.slice(0, 2).forEach((m, i) => {
        l.texto(l.recortar(m, ANCHO_UTIL - 24, 7.5), izq + 12, y + 27 + i * 9, {
          tam: 7.5,
          color: COLORES.error,
        });
      });
      y += altoFila + altoDetalle;
    }
  }

  y += 18;

  // ── Conceptos manuales ──
  if (datos.manuales.length > 0) {
    const alto = 20 + datos.manuales.length * 14;
    l.rect({
      x: izq,
      y,
      ancho: ANCHO_UTIL,
      alto,
      relleno: COLORES.panel,
      borde: COLORES.lineaFuerte,
      grosor: 0.6,
      radio: 5,
    });
    l.texto('CONCEPTOS ADICIONALES', izq + 12, y + 14, {
      tam: 6.5,
      peso: 'bold',
      color: COLORES.suave,
    });
    let yy = y + 27;
    for (const m of datos.manuales) {
      l.texto(m.codigo, izq + 12, yy, { tam: 8, color: COLORES.tenue });
      const etiqueta = m.litros !== null ? `${m.nombre}  ·  ${formatearEntero(m.litros)} L sin pagar` : m.nombre;
      l.texto(l.recortar(etiqueta, ANCHO_UTIL - 190, 9), xNombre + 12, yy, { tam: 9 });
      const signo = m.efecto === 'suma' ? '+ ' : m.efecto === 'resta' ? `${MENOS} ` : '';
      l.texto(`${signo}${formatearBs(m.centimos)}`, der - 12, yy, { tam: 9, alineacion: 'der' });
      yy += 14;
    }
    y += alto + 14;
  }

  // ── Pie ──
  // La hoja se ajusta al contenido en lugar de forzar un A4 completo. Un
  // comprobante corto dejaría media página en blanco, que al enviarse por
  // WhatsApp se ve como una imagen medio vacía.
  const yPie = Math.max(y + 14, ALTO_MINIMO_PT - MARGEN - 12);
  l.linea(izq, yPie - 10, der);
  l.texto(`Folio ${datos.folio}`, der, yPie, { tam: 7, color: COLORES.suave, alineacion: 'der' });

  return { primitivas: l.primitivas, alto: Math.round(yPie + MARGEN - 8) };
}

/**
 * Nota de débito como documento independiente: mismo encabezado de
 * empresa/proveedor que el comprobante de pago completo, pero el cuerpo se
 * reduce a "DIFERENCIA DE PRECIO SEMANA N" + el desglose de la ND — sin
 * litros, conceptos, Bruto, Neto a pagar ni Total a facturar.
 *
 * Debe llamarse solo cuando la ND aplica (el botón que la ofrece ya se
 * oculta si no); si de todos modos se llama sin que aplique, se dibuja un
 * aviso en vez de fallar.
 */
export function dibujarNotaDebito(
  datos: DatosComprobante,
  opciones: OpcionesDibujo,
  medir: Medidor,
): Hoja {
  const l = new Lienzo(medir);
  const izq = MARGEN;
  const der = ANCHO_PT - MARGEN;
  let y = MARGEN;

  y = dibujarEncabezadoEmpresa(l, datos, izq, der, y);
  y = dibujarBloqueIdentificacion(
    l,
    datos,
    izq,
    der,
    y,
    { ...opciones, mostrarNotaDebito: true },
    'COMPROBANTE NOTA DE DEBITO',
  );

  const nd = datos.notaDebito;
  const ndComb = datos.notaDebitoCombinada;
  const ndAgr = datos.notaDebitoAgrupada;
  const aplica = ndAgr ? ndAgr.aplica : ndComb ? ndComb.aplica : Boolean(nd?.aplica);

  y += 6;
  if (aplica) {
    const centimosNd = ndAgr ? ndAgr.centimos : ndComb ? ndComb.centimos : (nd as { centimos: number }).centimos;
    const { desglose, filasTabla } = datosDetalleNd(datos);
    const altoFila = 26;
    const altoCaja = altoFila + altoDetalleNd(desglose.length, filasTabla.length);

    l.rect({ x: izq, y, ancho: ANCHO_UTIL, alto: altoCaja, borde: COLORES.verde, grosor: 1.4, radio: 5 });
    l.rect({ x: izq + 1, y: y + 1, ancho: ANCHO_UTIL - 2, alto: altoFila - 1, relleno: COLORES.verde });
    l.texto(`DIFERENCIA DE PRECIO SEMANA ${datos.numero}`, izq + 12, y + 17, {
      tam: 9.5,
      peso: 'bold',
      color: COLORES.blanco,
    });
    l.texto(`${formatearBs(centimosNd)} Bs`, der - 12, y + 18, {
      tam: 13,
      peso: 'bold',
      color: COLORES.blanco,
      alineacion: 'der',
    });
    y += altoFila;
    y = dibujarDetalleNd(l, datos, izq, y);
  } else {
    const alto = 42;
    l.rect({
      x: izq,
      y,
      ancho: ANCHO_UTIL,
      alto,
      relleno: COLORES.errorFondo,
      borde: COLORES.error,
      grosor: 0.6,
      radio: 5,
    });
    l.texto('NOTA DE DÉBITO NO CALCULADA', izq + 12, y + 16, {
      tam: 9.5,
      peso: 'bold',
      color: COLORES.error,
    });
    const motivo = ndAgr
      ? (ndAgr.porCodigo.find((p) => p.resultado && !p.resultado.aplica)?.resultado as
          | { motivo: string }
          | undefined
        )?.motivo ?? ''
      : ndComb
      ? ([
          ndComb.leche && !ndComb.leche.aplica ? ndComb.leche.motivo : null,
          ndComb.transporte && !ndComb.transporte.aplica ? ndComb.transporte.motivo : null,
        ].find((m): m is string => m !== null) ?? '')
      : ((nd as { motivo: string } | null)?.motivo ?? '');
    l.texto(l.recortar(motivo, ANCHO_UTIL - 24, 7.5), izq + 12, y + 30, { tam: 7.5, color: COLORES.error });
    y += alto;
  }

  y += 18;

  const yPie = Math.max(y + 14, ALTO_MINIMO_PT - MARGEN - 12);
  l.linea(izq, yPie - 10, der);
  l.texto(`Folio ${datos.folio}`, der, yPie, { tam: 7, color: COLORES.suave, alineacion: 'der' });

  return { primitivas: l.primitivas, alto: Math.round(yPie + MARGEN - 8) };
}
