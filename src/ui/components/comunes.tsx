import { useEffect, useRef, type ReactNode } from 'react';
import type { NivelValidacion } from '../../core/types.ts';

export function Tarjeta({
  titulo,
  descripcion,
  acciones,
  ajustado,
  children,
}: {
  titulo?: ReactNode;
  descripcion?: ReactNode;
  acciones?: ReactNode;
  ajustado?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="tarjeta">
      {(titulo || acciones) && (
        <header>
          <div>
            {titulo && <h2>{titulo}</h2>}
            {descripcion && <p>{descripcion}</p>}
          </div>
          {acciones && <div className="acciones">{acciones}</div>}
        </header>
      )}
      <div className={`cuerpo${ajustado ? ' ajustado' : ''}`}>{children}</div>
    </section>
  );
}

export function Dato({
  etiqueta,
  valor,
  nota,
  pequeno,
}: {
  etiqueta: string;
  valor: ReactNode;
  nota?: ReactNode;
  pequeno?: boolean;
}) {
  return (
    <div className="dato">
      <div className="etiqueta">{etiqueta}</div>
      <div className={`valor${pequeno ? ' pequeno' : ''}`}>{valor}</div>
      {nota && <div className="nota">{nota}</div>}
    </div>
  );
}

export function Aviso({
  nivel,
  titulo,
  children,
}: {
  nivel: 'ok' | 'aviso' | 'error' | 'info';
  titulo?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`aviso-caja ${nivel}`}>
      {titulo && <strong>{titulo}</strong>}
      {children}
    </div>
  );
}

const ICONO_NIVEL: Record<NivelValidacion, string> = { ok: '●', aviso: '▲', error: '✕' };
const TEXTO_NIVEL: Record<NivelValidacion, string> = {
  ok: 'Cuadra',
  aviso: 'Con avisos',
  error: 'No cuadra',
};

export function Semaforo({ nivel, texto }: { nivel: NivelValidacion; texto?: string }) {
  return (
    <span className={`pastilla ${nivel}`}>
      {ICONO_NIVEL[nivel]} {texto ?? TEXTO_NIVEL[nivel]}
    </span>
  );
}

export function Pastilla({
  tono = 'neutra',
  children,
}: {
  tono?: 'ok' | 'aviso' | 'error' | 'info' | 'neutra';
  children: ReactNode;
}) {
  return <span className={`pastilla ${tono}`}>{children}</span>;
}

export function Vacio({
  icono = '📭',
  titulo,
  children,
}: {
  icono?: string;
  titulo: string;
  children?: ReactNode;
}) {
  return (
    <div className="vacio">
      <span className="icono">{icono}</span>
      <strong>{titulo}</strong>
      {children && <p style={{ marginTop: 6 }}>{children}</p>}
    </div>
  );
}

export function Modal({
  titulo,
  descripcion,
  ancho,
  alCerrar,
  pie,
  children,
}: {
  titulo: ReactNode;
  descripcion?: ReactNode;
  ancho?: boolean;
  alCerrar: () => void;
  pie?: ReactNode;
  children: ReactNode;
}) {
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') alCerrar();
    };
    document.addEventListener('keydown', alTeclear);
    // El foco entra al diálogo para que se pueda operar con el teclado.
    caja.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    return () => document.removeEventListener('keydown', alTeclear);
  }, [alCerrar]);

  return (
    <div
      className="modal-fondo"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) alCerrar();
      }}
    >
      <div className={`modal${ancho ? ' ancho' : ''}`} role="dialog" aria-modal="true" ref={caja}>
        <header>
          <div>
            <h2>{titulo}</h2>
            {descripcion && <p>{descripcion}</p>}
          </div>
          <button className="cerrar" onClick={alCerrar} aria-label="Cerrar">
            ×
          </button>
        </header>
        <div className="cuerpo">{children}</div>
        {pie && <footer>{pie}</footer>}
      </div>
    </div>
  );
}

export function Campo({
  etiqueta,
  ayuda,
  children,
}: {
  etiqueta: ReactNode;
  ayuda?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="campo">
      <label>{etiqueta}</label>
      {children}
      {ayuda && <div className="ayuda">{ayuda}</div>}
    </div>
  );
}

export function Check({
  marcado,
  alCambiar,
  etiqueta,
  ayuda,
  deshabilitado,
}: {
  marcado: boolean;
  alCambiar: (v: boolean) => void;
  etiqueta: ReactNode;
  ayuda?: ReactNode;
  deshabilitado?: boolean;
}) {
  return (
    <label className="check" style={{ marginBottom: 8 }}>
      <input
        type="checkbox"
        checked={marcado}
        disabled={deshabilitado}
        onChange={(e) => alCambiar(e.target.checked)}
      />
      <span>
        {etiqueta}
        {ayuda && <small>{ayuda}</small>}
      </span>
    </label>
  );
}

/** Diálogo de confirmación para acciones que no se pueden deshacer. */
export function Confirmar({
  titulo,
  mensaje,
  textoConfirmar = 'Confirmar',
  peligro,
  alConfirmar,
  alCerrar,
}: {
  titulo: string;
  mensaje: ReactNode;
  textoConfirmar?: string;
  peligro?: boolean;
  alConfirmar: () => void;
  alCerrar: () => void;
}) {
  return (
    <Modal
      titulo={titulo}
      alCerrar={alCerrar}
      pie={
        <>
          <button className="btn" onClick={alCerrar}>
            Cancelar
          </button>
          <button
            className={`btn ${peligro ? 'peligro' : 'primario'}`}
            onClick={() => {
              alConfirmar();
              alCerrar();
            }}
          >
            {textoConfirmar}
          </button>
        </>
      }
    >
      {mensaje}
    </Modal>
  );
}
