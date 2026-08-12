import { construirFilas, type ItemCrudo, type PaginaLayout } from './layout.ts';

/**
 * Puente entre pdf.js y el layout de la aplicación.
 *
 * Se tipa de forma estructural en lugar de importar los tipos de pdfjs-dist
 * porque el navegador usa la compilación moderna y el script de pruebas usa la
 * compilación «legacy» para Node. Ambas cumplen esta forma, así que el parser
 * y sus pruebas comparten exactamente el mismo código de extracción.
 */
export interface PaginaPdf {
  getViewport(opciones: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: unknown[] }>;
}

export interface DocumentoPdf {
  numPages: number;
  getPage(numero: number): Promise<PaginaPdf>;
}

interface ItemTexto {
  str?: unknown;
  width?: unknown;
  transform?: unknown;
}

export async function paginasDesdePdf(doc: DocumentoPdf): Promise<PaginaLayout[]> {
  const paginas: PaginaLayout[] = [];

  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n);
    const vista = pagina.getViewport({ scale: 1 });
    const contenido = await pagina.getTextContent();

    const crudos: ItemCrudo[] = [];
    for (const bruto of contenido.items) {
      const it = bruto as ItemTexto;
      const t = it.transform;
      if (typeof it.str !== 'string' || !Array.isArray(t)) continue;
      const x = Number(t[4]);
      const y = Number(t[5]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      crudos.push({
        str: it.str,
        x,
        y,
        width: Number.isFinite(Number(it.width)) ? Number(it.width) : 0,
      });
    }

    paginas.push({
      numero: n,
      ancho: vista.width,
      alto: vista.height,
      filas: construirFilas(crudos),
    });
  }

  return paginas;
}
