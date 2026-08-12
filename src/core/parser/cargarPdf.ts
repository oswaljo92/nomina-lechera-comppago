import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { paginasDesdePdf, type DocumentoPdf } from './desdePdfjs.ts';
import { parseNomina, ErrorParseo } from './parseNomina.ts';
import { sha256DeBytes } from '../auth/hash.ts';
import type { NominaLeida } from '../types.ts';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfLeido {
  nomina: NominaLeida;
  sha256: string;
  archivo: string;
  /** Si el PDF no trae capa de texto; explica por qué no se pudo leer nada. */
  sinTexto: boolean;
}

/**
 * Lee un PDF de nómina en el navegador.
 *
 * pdf.js se APROPIA del ArrayBuffer que recibe: lo transfiere al worker y deja
 * el original desprendido. Por eso el hash se calcula antes y a getDocument se
 * le entrega siempre una copia; de lo contrario los bytes quedan inservibles
 * para cualquier otro uso posterior.
 */
export async function leerPdf(archivo: File): Promise<PdfLeido> {
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const sha256 = await sha256DeBytes(bytes);

  const tarea = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const doc = (await tarea.promise) as unknown as DocumentoPdf;
  const paginas = await paginasDesdePdf(doc);

  const totalItems = paginas.reduce((a, p) => a + p.filas.length, 0);
  if (totalItems === 0) {
    return {
      nomina: nominaVacia(),
      sha256,
      archivo: archivo.name,
      sinTexto: true,
    };
  }

  const nomina = parseNomina(paginas);
  return { nomina, sha256, archivo: archivo.name, sinTexto: false };
}

function nominaVacia(): NominaLeida {
  return {
    cabecera: {
      tipo: 'leche',
      reporte: '',
      titulo: '',
      anio: 0,
      numero: 0,
      fechaIni: '',
      fechaFin: '',
    },
    registros: [],
    totalesFabrica: [],
    totalGeneral: null,
    fabricas: [],
    paginas: 0,
  };
}

export { ErrorParseo };
