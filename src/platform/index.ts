import { crearPlataformaEscritorio, puenteEscritorio } from './escritorio.ts';
import { crearPlataformaWeb } from './web.ts';
import type { Plataforma } from './tipos.ts';

export type { Plataforma, ArchivoAbierto, NombrePlataforma } from './tipos.ts';

let cache: Plataforma | null = null;

/** Detecta el entorno una sola vez y devuelve su adaptador. */
export async function obtenerPlataforma(): Promise<Plataforma> {
  if (cache) return cache;
  const puente = puenteEscritorio();
  cache = puente ? await crearPlataformaEscritorio(puente) : await crearPlataformaWeb();
  return cache;
}

/**
 * Guardado con retardo.
 *
 * Cada cambio marca la base como sucia y programa un volcado; los cambios
 * seguidos se agrupan en una sola escritura. Además se fuerza el volcado
 * cuando la pestaña pasa a segundo plano o se cierra, que es cuando se pierden
 * los datos si uno se confía solo del temporizador.
 */
export class Persistencia {
  private plataforma: Plataforma;
  private obtenerBytes: () => Uint8Array;
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private guardando: Promise<void> | null = null;
  private pendiente = false;
  private retardoMs: number;
  private alFallar: (error: unknown) => void;

  constructor(
    plataforma: Plataforma,
    obtenerBytes: () => Uint8Array,
    opciones: { retardoMs?: number; alFallar?: (error: unknown) => void } = {},
  ) {
    this.plataforma = plataforma;
    this.obtenerBytes = obtenerBytes;
    this.retardoMs = opciones.retardoMs ?? 800;
    this.alFallar = opciones.alFallar ?? ((e) => console.error('No se pudo guardar la base:', e));
    this.instalarGanchos();
  }

  marcarSucio(): void {
    this.pendiente = true;
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => void this.volcar(), this.retardoMs);
  }

  /** Fuerza el guardado y espera a que termine. */
  async volcar(): Promise<void> {
    if (this.temporizador) {
      clearTimeout(this.temporizador);
      this.temporizador = null;
    }
    if (!this.pendiente) return;
    // Si ya hay un volcado en curso se espera y se vuelve a intentar, para no
    // solapar dos escrituras sobre el mismo archivo.
    if (this.guardando) {
      await this.guardando;
      return this.volcar();
    }
    this.pendiente = false;
    this.guardando = (async () => {
      try {
        await this.plataforma.db.guardar(this.obtenerBytes());
      } catch (error) {
        this.pendiente = true;
        this.alFallar(error);
      } finally {
        this.guardando = null;
      }
    })();
    return this.guardando;
  }

  private instalarGanchos(): void {
    const alOcultar = () => {
      if (document.visibilityState === 'hidden') void this.volcar();
    };
    document.addEventListener('visibilitychange', alOcultar);
    window.addEventListener('pagehide', () => void this.volcar());
  }
}
