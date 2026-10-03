import type { BaseDatos } from '../../core/db/basedatos.ts';

/**
 * Atajos de teclado configurables para copiar al portapapeles las filas
 * seleccionadas de las tablas de comprobantes (imagen o nombre).
 *
 * Siempre son de 3 teclas: dos modificadores + una tecla. Solo se admiten
 * Ctrl+Shift+… y Alt+Shift+…: Ctrl+Alt+… es AltGr en los teclados en español
 * (escribe @, #, €…) y la tecla Windows es del sistema operativo. Se compara
 * por la tecla FÍSICA (`KeyboardEvent.code`), así el atajo funciona igual con
 * cualquier distribución de teclado.
 */

export type AccionAtajo = 'copiarImagen' | 'copiarNombre';

export interface Atajo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** `KeyboardEvent.code`: "KeyF", "Digit5", "F7"… */
  codigo: string;
}

export const ACCIONES_ATAJO: { accion: AccionAtajo; titulo: string; ayuda: string }[] = [
  {
    accion: 'copiarImagen',
    titulo: 'Copiar imagen',
    ayuda: 'Copia la imagen del comprobante (o de la nota de débito) de las filas seleccionadas.',
  },
  {
    accion: 'copiarNombre',
    titulo: 'Copiar nombre',
    ayuda: 'Copia el nombre del productor de las filas seleccionadas.',
  },
];

export const ATAJOS_POR_DEFECTO: Record<AccionAtajo, Atajo> = {
  copiarImagen: { ctrl: true, alt: false, shift: true, codigo: 'KeyF' }, // F de "foto"
  copiarNombre: { ctrl: true, alt: false, shift: true, codigo: 'KeyL' }, // L de "letras"
};

/** Combinaciones Ctrl+Shift+… ya usadas por Windows, Chromium/Electron o
 * por la edición de texto (rehacer, pegar sin formato…). */
const RESERVADAS_CTRL_SHIFT = new Set([
  'KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyG', 'KeyI', 'KeyJ', 'KeyM', 'KeyN', 'KeyO',
  'KeyP', 'KeyQ', 'KeyR', 'KeyS', 'KeyT', 'KeyU', 'KeyV', 'KeyW', 'KeyZ',
]);

const CLAVE_AJUSTE = (accion: AccionAtajo) => `atajo.${accion}`;

export function esTeclaModificadora(codigo: string): boolean {
  return /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/.test(codigo);
}

/** Texto legible: "Ctrl + Shift + F". */
export function textoAtajo(a: Atajo): string {
  const tecla = a.codigo.startsWith('Key')
    ? a.codigo.slice(3)
    : a.codigo.startsWith('Digit')
      ? a.codigo.slice(5)
      : a.codigo;
  return [a.ctrl && 'Ctrl', a.alt && 'Alt', a.shift && 'Shift', tecla].filter(Boolean).join(' + ');
}

export function mismoAtajo(a: Atajo, b: Atajo): boolean {
  return a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.codigo === b.codigo;
}

/** null si el atajo es válido; si no, el motivo para mostrárselo al usuario. */
export function validarAtajo(a: Atajo): string | null {
  const modificadores = [a.ctrl, a.alt, a.shift].filter(Boolean).length;
  if (modificadores !== 2) {
    return 'El atajo debe ser de 3 teclas: dos modificadores (Ctrl + Shift o Alt + Shift) y una letra o número.';
  }
  if (a.ctrl && a.alt) {
    return 'Ctrl + Alt no se permite: en los teclados en español es AltGr (escribe @, #, €) y Ctrl + Alt + Supr es del sistema.';
  }
  if (a.ctrl && a.shift) {
    if (!/^Key[A-Z]$/.test(a.codigo) && !/^F([1-9]|1[0-2])$/.test(a.codigo)) {
      return 'Con Ctrl + Shift usa una letra (A–Z) o una tecla F1–F12. Los números cambian el idioma del teclado en Windows.';
    }
    if (RESERVADAS_CTRL_SHIFT.has(a.codigo)) {
      return `${textoAtajo(a)} ya lo usa Windows, el programa o la edición de texto. Elige otra letra.`;
    }
  }
  if (a.alt && a.shift) {
    // Con F o dígitos varias apps de Windows ya lo usan: solo letras.
    if (!/^Key[A-Z]$/.test(a.codigo)) return 'Con Alt + Shift usa una letra (A–Z).';
  }
  return null;
}

export function leerAtajo(db: BaseDatos, accion: AccionAtajo): Atajo {
  const crudo = db.ajuste(CLAVE_AJUSTE(accion));
  if (crudo) {
    try {
      const a = JSON.parse(crudo) as Atajo;
      if (typeof a.codigo === 'string' && validarAtajo(a) === null) return a;
    } catch {
      /* valor dañado: se usa el de fábrica */
    }
  }
  return ATAJOS_POR_DEFECTO[accion];
}

/** Guarda el atajo (quien llama debe invocar `cambiado()` después). */
export function guardarAtajo(db: BaseDatos, accion: AccionAtajo, atajo: Atajo): void {
  db.fijarAjuste(CLAVE_AJUSTE(accion), JSON.stringify(atajo));
}
