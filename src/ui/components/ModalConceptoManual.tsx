import { useState } from 'react';
import { Aviso, Campo, Check, Confirmar, Modal } from './comunes.tsx';
import { formatearBs, formatearEntero } from '../../core/parser/numeros.ts';
import type { ConceptoCatalogo, ConceptoManual } from '../../core/types.ts';

export interface DatosConceptoManual {
  codigo: string;
  nombre: string;
  centimos: number;
  litros: number | null;
  /** null = informativo. 'suma'/'resta' ajustan neto a pagar y total a facturar. */
  efecto: 'suma' | 'resta' | null;
}

/**
 * Sugerencia de efecto al elegir un concepto ya conocido del catálogo: si es
 * de la columna «pago», normalmente suma; si es una deducción que ya resta
 * del total a facturar (p. ej. 0090 Faltante, 0092 Agua Transporte), resta
 * también aquí. El usuario puede cambiarlo igual, es solo un punto de partida.
 */
function sugerirEfecto(c: ConceptoCatalogo): { afecta: boolean; efecto: 'suma' | 'resta' } {
  if (c.clase === 'pago') return { afecta: true, efecto: 'suma' };
  if (c.clase === 'deduccion' && c.restaFacturacion) return { afecta: true, efecto: 'resta' };
  return { afecta: false, efecto: 'resta' };
}

/**
 * Alta, edición y borrado de conceptos manuales para uno o varios
 * proveedores. Por defecto son informativos; si se marca «Afecta…», ajustan
 * el neto a pagar y el total a facturar (nunca el bruto ni las deducciones,
 * que siempre reflejan solo lo impreso en el PDF).
 */
export function ModalConceptoManual({
  cantidad,
  catalogo,
  existentes,
  alCerrar,
  alAceptar,
  alEditar,
  alEliminar,
}: {
  cantidad: number;
  catalogo: ConceptoCatalogo[];
  existentes?: ConceptoManual[];
  alCerrar: () => void;
  alAceptar: (datos: DatosConceptoManual) => void;
  alEditar?: (id: string, datos: DatosConceptoManual) => void;
  alEliminar?: (id: string) => void;
}) {
  const [modo, setModo] = useState<'elegir' | 'nuevo'>(catalogo.length > 0 ? 'elegir' : 'nuevo');
  const [editando, setEditando] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [monto, setMonto] = useState('');
  const [litros, setLitros] = useState('');
  const [afecta, setAfecta] = useState(false);
  const [efecto, setEfecto] = useState<'suma' | 'resta'>('resta');
  const [aEliminar, setAEliminar] = useState<string | null>(null);

  const centimos = parseMonto(monto);
  const litrosNum = litros.trim() === '' ? null : Number(litros.replace(/\./g, ''));
  const litrosValido = litrosNum === null || (Number.isFinite(litrosNum) && litrosNum >= 0);
  const valido =
    codigo.trim().length > 0 && nombre.trim().length > 0 && centimos !== null && litrosValido;

  function limpiar() {
    setEditando(null);
    setCodigo('');
    setNombre('');
    setMonto('');
    setLitros('');
    setAfecta(false);
    setEfecto('resta');
  }

  function elegirDelCatalogo(cod: string) {
    setCodigo(cod);
    const c = catalogo.find((x) => x.codigo === cod);
    if (!c) return;
    setNombre(c.nombre);
    const sugerencia = sugerirEfecto(c);
    setAfecta(sugerencia.afecta);
    setEfecto(sugerencia.efecto);
  }

  function editar(m: ConceptoManual) {
    setModo('nuevo');
    setEditando(m.id);
    setCodigo(m.codigo);
    setNombre(m.nombre);
    setMonto(formatearBs(m.centimos));
    setLitros(m.litros !== null ? String(m.litros) : '');
    setAfecta(m.efecto !== null);
    setEfecto(m.efecto ?? 'resta');
  }

  function enviar() {
    if (centimos === null) return;
    const datos: DatosConceptoManual = {
      codigo: codigo.trim(),
      nombre: nombre.trim(),
      centimos,
      litros: litrosNum,
      efecto: afecta ? efecto : null,
    };
    if (editando && alEditar) alEditar(editando, datos);
    else alAceptar(datos);
    limpiar();
  }

  return (
    <Modal
      titulo="Conceptos adicionales"
      descripcion={
        editando
          ? 'Editando un concepto ya guardado.'
          : `Se agregará a ${cantidad} proveedor${cantidad === 1 ? '' : 'es'}.`
      }
      alCerrar={alCerrar}
      pie={
        <>
          <button className="btn" onClick={alCerrar}>
            Cerrar
          </button>
          {editando && (
            <button className="btn" onClick={limpiar}>
              Cancelar edición
            </button>
          )}
          <button className="btn primario" disabled={!valido} onClick={enviar}>
            {editando ? 'Guardar cambios' : 'Agregar'}
          </button>
        </>
      }
    >
      {existentes && existentes.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 8 }}>Ya agregados</h3>
          {existentes.map((m) => (
            <div key={m.id} className="entre" style={{ padding: '8px 0', borderBottom: '1px solid var(--borde)' }}>
              <div>
                <strong className="mono">{m.codigo}</strong> {m.nombre}
                {m.litros !== null && <span className="tenue pequeno"> · {formatearEntero(m.litros)} L</span>}
                <div className="tenue pequeno">
                  {m.efecto === 'suma' && 'Suma al neto y al total a facturar'}
                  {m.efecto === 'resta' && 'Resta del neto y del total a facturar'}
                  {m.efecto === null && 'Informativo, no afecta ningún total'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong>{formatearBs(m.centimos)} Bs</strong>
                <button className="btn sutil chico" onClick={() => editar(m)}>
                  Editar
                </button>
                {alEliminar && (
                  <button className="btn sutil chico peligro" onClick={() => setAEliminar(m.id)}>
                    Eliminar
                  </button>
                )}
              </div>
            </div>
          ))}
          <div className="sep" />
        </div>
      )}

      {!editando && (
        <div className="linea" style={{ marginBottom: 12 }}>
          <button
            className={`btn chico ${modo === 'elegir' ? 'primario' : 'sutil'}`}
            disabled={catalogo.length === 0}
            onClick={() => setModo('elegir')}
          >
            Elegir uno existente
          </button>
          <button
            className={`btn chico ${modo === 'nuevo' ? 'primario' : 'sutil'}`}
            onClick={() => {
              setModo('nuevo');
              setCodigo('');
              setNombre('');
            }}
          >
            Crear nuevo
          </button>
        </div>
      )}

      {!editando && modo === 'elegir' && (
        <Campo etiqueta="Concepto del catálogo">
          <select value={codigo} onChange={(e) => elegirDelCatalogo(e.target.value)}>
            <option value="">Selecciona uno…</option>
            {catalogo.map((c) => (
              <option key={c.codigo} value={c.codigo}>
                {c.codigo} · {c.nombre}
              </option>
            ))}
          </select>
        </Campo>
      )}

      {(editando || modo === 'nuevo') && (
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
      )}

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
        <Campo
          etiqueta="Litros (opcional)"
          ayuda={
            litrosNum !== null
              ? `Se mostrará como "${formatearEntero(litrosNum)} L sin pagar" en el comprobante`
              : 'Solo se muestra; no descuenta litros.'
          }
        >
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

      <div style={{ marginTop: 12 }}>
        <Check
          marcado={afecta}
          alCambiar={setAfecta}
          etiqueta="Afecta el Neto a pagar y el Total a facturar"
        />
        {afecta && (
          <div className="linea" style={{ marginTop: -4, marginBottom: 8 }}>
            <label className="check">
              <input
                type="radio"
                checked={efecto === 'suma'}
                onChange={() => setEfecto('suma')}
              />
              <span>Suma</span>
            </label>
            <label className="check">
              <input
                type="radio"
                checked={efecto === 'resta'}
                onChange={() => setEfecto('resta')}
              />
              <span>Resta</span>
            </label>
          </div>
        )}
      </div>

      <Aviso nivel="info">
        {afecta
          ? `Sumará/Restará del Neto a pagar y del Total a facturar, según lo elegido arriba.`
          : 'Es informativo: no afecta ningún total.'}
      </Aviso>

      {aEliminar && alEliminar && (
        <Confirmar
          titulo="Eliminar el concepto"
          peligro
          textoConfirmar="Eliminar definitivamente"
          mensaje={<p>Se eliminará este concepto adicional. No se puede deshacer.</p>}
          alCerrar={() => setAEliminar(null)}
          alConfirmar={() => alEliminar(aEliminar)}
        />
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
