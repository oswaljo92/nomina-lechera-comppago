/**
 * Contrato entre la lógica de la aplicación y su entorno.
 *
 * Todo lo que cambia entre la versión web y la de escritorio vive detrás de
 * esta interfaz: dónde se guarda la base de datos y cómo se entrega un archivo
 * al usuario. El resto del código —parser, cálculos, base de datos, interfaz—
 * es exactamente el mismo en ambas.
 */

export type NombrePlataforma = 'web' | 'escritorio';

export interface ArchivoAbierto {
  nombre: string;
  bytes: Uint8Array;
}

export interface Plataforma {
  nombre: NombrePlataforma;
  /** Texto corto para la barra de estado: «Navegador · OPFS», «Escritorio». */
  etiqueta: string;
  /** Dónde encontrar el .wasm de SQLite. */
  localizarWasm(archivo: string): string;

  db: {
    cargar(): Promise<Uint8Array | null>;
    guardar(bytes: Uint8Array): Promise<void>;
    /** Descripción de dónde vive la base, para mostrarla en Ajustes. */
    ubicacion(): string;
  };

  archivos: {
    /**
     * Entrega un archivo al usuario. Devuelve la ruta donde quedó, o null si
     * el entorno no la conoce (el navegador no revela la carpeta de descargas).
     */
    guardar(nombre: string, datos: Blob): Promise<string | null>;
    /** Pide un archivo al usuario. `accept` en formato de input file. */
    abrir(accept: string): Promise<ArchivoAbierto | null>;
  };

  /** Portapapeles del sistema, para pegar directo en WhatsApp, correo,
   * etc. sin pasar por un archivo descargado. */
  portapapeles: {
    copiarTexto(texto: string): Promise<void>;
    /** `png` debe ser una imagen PNG. */
    copiarImagen(png: Blob): Promise<void>;
    /** Si el Historial del portapapeles de Windows (Win + V) está activo;
     * null si el entorno no puede saberlo (navegador). */
    historialActivo(): Promise<boolean | null>;
  };
}
