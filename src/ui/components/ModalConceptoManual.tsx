import { useState } from 'react';
import { Aviso, Campo, Modal } from './comunes.tsx';
import { formatearBs } from '../../core/parser/numeros.ts';

export interface DatosConceptoManual {
  codigo: string;
  nombre: string;
  centimos: number;
  litros: number | null;
}

/**
 * Alta de un concepto informativo.
 *
 * El diálogo insiste en que no altera ninguna cifra porque es justo lo que uno
 * esperaría que hiciera: se llama «concepto» y lleva un monto. Dejarlo
 * ambiguo llevaría a que alguien lo use creyendo que descuenta.
 */
export function ModalConceptoManual({
  cantidad,
  alCerrar,
  alAceptar,
}: {
  cantidad: number;
  alCerrar: () => void;
  alAceptar: (datos: DatosConceptoManual) => void;
}) {
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [monto, setMonto] = useState('');
  const [litros, setLitros] = useState('');

  const centimos = parseMonto(monto);
  const litrosNum = litros.trim() === '' ? null : Number(litros.replace(/\./g, ''));
  const litrosValido = litrosNum === null || (Number.isFinite(litrosNum) && litrosNum >= 0);
  const valido =
    codigo.trim().length > 0 && nombre.trim().length > 0 && centimos !== null && litrosValido;

  return (
    <Modal
      titulo="Agregar concepto adicional"
      descripcion={`Se agregará a ${cantidad} proveedor${cantidad === 1 ? '' : 'es'}.`}
      alCerrar={alCerrar}
      pie={
        <>
          <button className="btn" onClick={alCerrar}>
            Cancelar
          </button>
          <button
            className="btn primario"
            disabled={!valido}
            onClick={() =>
              alAceptar({
                codigo: codigo.trim(),
                nombre: nombre.trim(),
                centimos: centimos ?? 0,
                litros: litrosNum,
              })
            }
          >
            Agregar
          </button>
        </>
      }
    >
      <Aviso nivel="info" titulo="Es informativo">
        Aparece en el comprobante como concepto adicional, pero no modifica el bruto, ni el neto a
        pagar, ni el total a facturar.
      </Aviso>

      <div className="linea">
        <Campo etiqueta="Código" ayuda="El que tú definas, p. ej. M01.">
          <input
            type="text"
            value={codigo}
            maxLength={10}
            placeholder="M01"
            onChange={(e) => setCodigo(e.target.value)}
          />
        </Campo>
        <Campo etiqueta="Nombre del concepto">
          <input
            type="text"
            value={nombre}
            placeholder="Ajuste de calidad"
            onChange={(e) => setNombre(e.target.value)}
          />
        </Campo>
      </div>

      <div className="linea" style={{ marginTop: 12 }}>
        <Campo
          etiqueta="Monto en Bs"
          ayuda={
            centimos !== null ? `Se guardará como ${formatearBs(centimos)} Bs` : 'Ej: 50.000,00'
          }
        >
          <input
            type="text"
            className="numero"
            value={monto}
            placeholder="50.000,00"
            onChange={(e) => setMonto(e.target.value)}
          />
        </Campo>
        <Campo etiqueta="Litros (opcional)" ayuda="Solo se muestra; no descuenta litros.">
          <input
            type="text"
            className="numero"
            value={litros}
            placeholder="500"
            onChange={(e) => setLitros(e.target.value)}
          />
        </Campo>
      </div>

      {monto.trim().length > 0 && centimos === null && (
        <Aviso nivel="aviso">
          No entiendo ese monto. Escríbelo como 50.000,00 o como 50000.00.
        </Aviso>
      )}
    </Modal>
  );
}

/**
 * Acepta el monto tanto en formato venezolano (50.000,00) como anglosajón
 * (50,000.00) o simple (50000). Se decide por el último separador que aparezca:
 * si va seguido de dos dígitos al final, es el decimal.
 */
export function parseMonto(texto: string): number | null {
  const t = texto.trim();
  if (t.length === 0) return null;
  if (!/^[\d.,\s]+$/.test(t)) return null;

  const limpio = t.replace(/\s/g, '');
  const ultimaComa = limpio.lastIndexOf(',');
  const ultimoPunto = limpio.lastIndexOf('.');
  const corte = Math.max(ultimaComa, ultimoPunto);

  let entero: string;
  let decimales = '00';
  if (corte >= 0 && limpio.length - corte - 1 <= 2 && limpio.length - corte - 1 > 0) {
    entero = limpio.slice(0, corte).replace(/[.,]/g, '');
    decimales = limpio.slice(corte + 1).padEnd(2, '0');
  } else {
    entero = limpio.replace(/[.,]/g, '');
  }

  if (!/^\d+$/.test(entero) || !/^\d{2}$/.test(decimales)) return null;
  const valor = Number(entero) * 100 + Number(decimales);
  return Number.isFinite(valor) ? valor : null;
}
