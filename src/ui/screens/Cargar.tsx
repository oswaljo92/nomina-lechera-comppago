import { useCallback, useRef, useState } from 'react';
import { useApp } from '../estado.tsx';
import { Aviso, Dato, Semaforo, Tarjeta } from '../components/comunes.tsx';
import { ErrorParseo, leerPdf, type PdfLeido } from '../../core/parser/cargarPdf.ts';
import { validarNomina } from '../../core/parser/validar.ts';
import { fechaAMostrar, formatearBs, formatearEntero } from '../../core/parser/numeros.ts';
import * as repo from '../../core/db/repo.ts';
import type { ConceptoCatalogo, ValidacionNomina } from '../../core/types.ts';

type Estado =
  | { fase: 'leyendo'; nombre: string }
  | { fase: 'error'; nombre: string; mensaje: string; detalle?: string }
  | { fase: 'listo'; nombre: string; pdf: PdfLeido; validacion: ValidacionNomina; duplicada: string | null }
  | { fase: 'guardada'; nombre: string; resumen: string };

export function Cargar({ alGuardar }: { alGuardar: (nominaId: string) => void }) {
  const { db, usuario, cambiado, puedo } = useApp();
  const [estados, setEstados] = useState<Estado[]>([]);
  const [encima, setEncima] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const procesar = useCallback(
    async (archivos: File[]) => {
      const pdfs = archivos.filter((a) => a.name.toLowerCase().endsWith('.pdf'));
      if (pdfs.length === 0) {
        setEstados([
          { fase: 'error', nombre: '—', mensaje: 'Arrastra archivos PDF. No se admiten otros formatos.' },
        ]);
        return;
      }

      setEstados(pdfs.map((a) => ({ fase: 'leyendo', nombre: a.name })));

      const resultados: Estado[] = [];
      for (const archivo of pdfs) {
        try {
          const pdf = await leerPdf(archivo);
          if (pdf.sinTexto) {
            resultados.push({
              fase: 'error',
              nombre: archivo.name,
              mensaje: 'Este PDF no tiene capa de texto.',
              detalle:
                'Parece un documento escaneado. CompPago lee los reportes originales del sistema ganadero, que sí traen texto. Pide el archivo original en vez de una copia escaneada o fotografiada.',
            });
            continue;
          }

          // Los códigos que el catálogo no conoce se dan de alta sin clasificar
          // para que un administrador los revise antes de guardar la nómina.
          const nuevos = repo.sembrarConceptosDesconocidos(db, pdf.nomina);
          if (nuevos.length > 0) cambiado();

          const validacion = validarNomina(pdf.nomina, repo.catalogoMapa(db));
          const c = pdf.nomina.cabecera;
          const ya = repo.buscarNomina(db, c.tipo, c.anio, c.numero);

          resultados.push({
            fase: 'listo',
            nombre: archivo.name,
            pdf,
            validacion,
            duplicada: ya
              ? `Ya existe la nómina Nº ${ya.numero} de ${ya.anio} (${ya.tipo}), cargada el ${new Date(ya.procesadoEn).toLocaleString('es-VE')} por ${ya.usuarioNombre}.`
              : null,
          });
        } catch (error) {
          resultados.push({
            fase: 'error',
            nombre: archivo.name,
            mensaje: error instanceof Error ? error.message : String(error),
            detalle: error instanceof ErrorParseo ? error.detalle : undefined,
          });
        }
      }
      setEstados(resultados);
    },
    [db, cambiado],
  );

  async function guardar(indice: number) {
    const estado = estados[indice];
    if (!estado || estado.fase !== 'listo' || !usuario) return;
    try {
      const id = await repo.guardarNomina(
        db,
        usuario,
        estado.pdf.nomina,
        estado.pdf.archivo,
        estado.pdf.sha256,
        repo.catalogoMapa(db),
      );
      cambiado();
      const c = estado.pdf.nomina.cabecera;
      setEstados((prev) =>
        prev.map((e, i) =>
          i === indice
            ? {
                fase: 'guardada',
                nombre: estado.nombre,
                resumen: `Nómina Nº ${c.numero} de ${c.anio} · ${estado.pdf.nomina.registros.length} proveedores`,
              }
            : e,
        ),
      );
      alGuardar(id);
    } catch (error) {
      setEstados((prev) =>
        prev.map((e, i) =>
          i === indice
            ? {
                fase: 'error',
                nombre: estado.nombre,
                mensaje: error instanceof Error ? error.message : String(error),
              }
            : e,
        ),
      );
    }
  }

  return (
    <>
      <div className="cabecera-pagina">
        <div>
          <h1>Cargar nómina</h1>
          <p>
            Arrastra el reporte de proveedores de leche (Gan0584), el de rutas de transporte
            (Gan0594) o ambos a la vez. Se leen sin salir de este equipo.
          </p>
        </div>
      </div>

      <div
        className={`soltar${encima ? ' encima' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setEncima(true);
        }}
        onDragLeave={() => setEncima(false)}
        onDrop={(e) => {
          e.preventDefault();
          setEncima(false);
          void procesar([...e.dataTransfer.files]);
        }}
        onClick={() => entrada.current?.click()}
      >
        <span className="icono">📄</span>
        <strong>Arrastra aquí los PDF</strong>
        <span>o haz clic para elegirlos. Puedes soltar los dos reportes a la vez.</span>
        <input
          ref={entrada}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            void procesar([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>

      <div style={{ marginTop: 18 }}>
        {estados.map((estado, i) => (
          <FichaArchivo
            key={`${estado.nombre}-${i}`}
            estado={estado}
            puedeClasificar={puedo('clasificar-conceptos')}
            puedeCargar={puedo('cargar-nomina')}
            alClasificar={(c) => {
              if (!usuario) return;
              void repo.guardarConcepto(db, usuario, c).then(() => {
                cambiado();
                setEstados((prev) =>
                  prev.map((e) =>
                    e.fase === 'listo'
                      ? { ...e, validacion: validarNomina(e.pdf.nomina, repo.catalogoMapa(db)) }
                      : e,
                  ),
                );
              });
            }}
            alGuardar={() => void guardar(i)}
          />
        ))}
      </div>
    </>
  );
}

function FichaArchivo({
  estado,
  puedeClasificar,
  puedeCargar,
  alClasificar,
  alGuardar,
}: {
  estado: Estado;
  puedeClasificar: boolean;
  puedeCargar: boolean;
  alClasificar: (c: ConceptoCatalogo) => void;
  alGuardar: () => void;
}) {
  if (estado.fase === 'leyendo') {
    return (
      <Tarjeta titulo={estado.nombre}>
        <p className="tenue">Leyendo el PDF…</p>
      </Tarjeta>
    );
  }

  if (estado.fase === 'error') {
    return (
      <Tarjeta titulo={estado.nombre}>
        <Aviso nivel="error" titulo="No se pudo procesar">
          {estado.mensaje}
          {estado.detalle && (
            <div className="pequeno" style={{ marginTop: 6, opacity: 0.85 }}>
              {estado.detalle}
            </div>
          )}
        </Aviso>
      </Tarjeta>
    );
  }

  if (estado.fase === 'guardada') {
    return (
      <Tarjeta titulo={estado.nombre}>
        <Aviso nivel="ok" titulo="Guardada">
          {estado.resumen}. Ya puedes generar sus comprobantes.
        </Aviso>
      </Tarjeta>
    );
  }

  const { pdf, validacion } = estado;
  const c = pdf.nomina.cabecera;
  const sinClasificar = validacion.codigosSinClasificar;
  const hayErrores = validacion.nivel === 'error';
  const bloqueado = sinClasificar.length > 0 || estado.duplicada !== null || !puedeCargar;

  const sumaBruto = pdf.nomina.registros.reduce(
    (a, r) => a + r.conceptos.filter((x) => x.columna === 'pago').reduce((s, x) => s + x.centimos, 0),
    0,
  );
  const sumaDed = pdf.nomina.registros.reduce(
    (a, r) =>
      a + r.conceptos.filter((x) => x.columna === 'deduccion').reduce((s, x) => s + x.centimos, 0),
    0,
  );
  const litros = pdf.nomina.registros.reduce((a, r) => a + (r.litrosTotal ?? 0), 0);

  return (
    <Tarjeta
      titulo={`${c.titulo} · ${estado.nombre}`}
      descripcion={`Nómina Nº ${c.numero} · Año ${c.anio} · del ${fechaAMostrar(c.fechaIni)} al ${fechaAMostrar(c.fechaFin)} · ${pdf.nomina.paginas} páginas`}
      acciones={
        <>
          <Semaforo nivel={validacion.nivel} />
          <button className="btn primario" disabled={bloqueado} onClick={alGuardar}>
            Guardar nómina
          </button>
        </>
      }
    >
      {estado.duplicada && (
        <Aviso nivel="aviso" titulo="Esta nómina ya está cargada">
          {estado.duplicada} Si necesitas volver a cargarla, un administrador debe eliminar primero
          la existente desde el Histórico.
        </Aviso>
      )}

      {!puedeCargar && (
        <Aviso nivel="aviso">Tu usuario no tiene permiso para cargar nóminas.</Aviso>
      )}

      <div className="rejilla cuatro" style={{ marginBottom: 14 }}>
        <Dato etiqueta="Proveedores" valor={formatearEntero(pdf.nomina.registros.length)} />
        <Dato etiqueta="Litros" valor={formatearEntero(litros)} />
        <Dato etiqueta="Bruto" valor={`${formatearBs(sumaBruto)}`} nota="Bs" pequeno />
        <Dato etiqueta="Neto" valor={`${formatearBs(sumaBruto - sumaDed)}`} nota="Bs" pequeno />
      </div>

      {/* Cuadre contra los totales impresos en el propio PDF */}
      <h3 style={{ marginBottom: 8 }}>Cuadre contra el PDF</h3>
      <div className="tabla-envoltura tabla-adaptable" style={{ marginBottom: 14 }}>
        <table className="tabla">
          <thead>
            <tr>
              <th>Concepto</th>
              <th className="num">Calculado por CompPago</th>
              <th className="num">Impreso en el PDF</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            <FilaCuadre
              etiqueta="Suma de pagos"
              calculado={sumaBruto}
              declarado={pdf.nomina.totalGeneral?.bruto ?? totalFabricas(pdf, 'bruto')}
            />
            <FilaCuadre
              etiqueta="Suma de deducciones"
              calculado={sumaDed}
              declarado={pdf.nomina.totalGeneral?.deduccion ?? totalFabricas(pdf, 'deduccion')}
            />
            <FilaCuadre
              etiqueta="Neto"
              calculado={sumaBruto - sumaDed}
              declarado={pdf.nomina.totalGeneral?.neto ?? totalFabricas(pdf, 'neto')}
            />
          </tbody>
        </table>
      </div>
      <p className="tenue pequeno">
        {pdf.nomina.totalGeneral
          ? 'Contrastado contra el «Total General» que imprime el reporte.'
          : `Este reporte no imprime «Total General»; se contrasta contra la suma de sus ${pdf.nomina.totalesFabrica.length} totales por fábrica.`}
      </p>

      {sinClasificar.length > 0 && (
        <ClasificadorConceptos
          codigos={sinClasificar}
          pdf={pdf}
          puedeClasificar={puedeClasificar}
          alClasificar={alClasificar}
        />
      )}

      {hayErrores && (
        <Aviso nivel="error" titulo="Hay diferencias que revisar">
          <ul>
            {validacion.hallazgos
              .filter((h) => h.nivel === 'error' && h.codigo !== 'concepto-sin-clasificar')
              .map((h, i) => (
                <li key={i}>
                  {h.mensaje}
                  {h.esperado && ` — el PDF dice ${h.esperado} y se calculó ${h.obtenido}`}
                </li>
              ))}
          </ul>
        </Aviso>
      )}

      <div className="rejilla tres" style={{ marginTop: 12 }}>
        <Dato
          etiqueta="Proveedores que cuadran"
          valor={formatearEntero(validacion.resumen.ok)}
          pequeno
        />
        <Dato etiqueta="Con avisos" valor={formatearEntero(validacion.resumen.avisos)} pequeno />
        <Dato etiqueta="Con errores" valor={formatearEntero(validacion.resumen.errores)} pequeno />
      </div>

      {pdf.nomina.fabricas.length > 0 && (
        <p className="tenue pequeno" style={{ marginTop: 12 }}>
          Fábricas detectadas:{' '}
          {pdf.nomina.fabricas.map((f) => `${f.codigo} ${f.nombre}`).join(' · ')}
        </p>
      )}
    </Tarjeta>
  );
}

function totalFabricas(pdf: PdfLeido, campo: 'bruto' | 'deduccion' | 'neto'): number | null {
  const totales = pdf.nomina.totalesFabrica;
  if (totales.length === 0) return null;
  return totales.reduce((a, t) => a + (t[campo] ?? 0), 0);
}

function FilaCuadre({
  etiqueta,
  calculado,
  declarado,
}: {
  etiqueta: string;
  calculado: number;
  declarado: number | null;
}) {
  const cuadra = declarado !== null && declarado === calculado;
  return (
    <tr>
      <td>{etiqueta}</td>
      <td className="num">{formatearBs(calculado)}</td>
      <td className="num">{declarado === null ? '—' : formatearBs(declarado)}</td>
      <td>
        {declarado === null ? (
          <Semaforo nivel="aviso" texto="Sin dato en el PDF" />
        ) : cuadra ? (
          <Semaforo nivel="ok" texto="Exacto" />
        ) : (
          <Semaforo
            nivel="error"
            texto={`Difiere en ${formatearBs(Math.abs(declarado - calculado))}`}
          />
        )}
      </td>
    </tr>
  );
}

function ClasificadorConceptos({
  codigos,
  pdf,
  puedeClasificar,
  alClasificar,
}: {
  codigos: string[];
  pdf: PdfLeido;
  puedeClasificar: boolean;
  alClasificar: (c: ConceptoCatalogo) => void;
}) {
  return (
    <Aviso nivel="error" titulo={`${codigos.length} código(s) de concepto sin clasificar`}>
      <p style={{ marginTop: 4 }}>
        La nómina no se guarda hasta que se sepa qué son y si descuentan del total a facturar.
        Calcular a ciegas produciría comprobantes con cifras equivocadas.
      </p>
      {!puedeClasificar && (
        <p style={{ marginBottom: 0 }}>
          Tu usuario no puede clasificar conceptos. Pídeselo a un administrador.
        </p>
      )}
      {puedeClasificar && (
        <div style={{ marginTop: 10 }}>
          {codigos.map((codigo) => (
            <FormularioConcepto
              key={codigo}
              codigo={codigo}
              pdf={pdf}
              alClasificar={alClasificar}
            />
          ))}
        </div>
      )}
    </Aviso>
  );
}

function FormularioConcepto({
  codigo,
  pdf,
  alClasificar,
}: {
  codigo: string;
  pdf: PdfLeido;
  alClasificar: (c: ConceptoCatalogo) => void;
}) {
  const usos = pdf.nomina.registros.flatMap((r) => r.conceptos.filter((c) => c.codigo === codigo));
  const columna = usos[0]?.columna ?? 'deduccion';
  const total = usos.reduce((a, u) => a + u.centimos, 0);

  const [nombre, setNombre] = useState('');
  const [clase, setClase] = useState<'pago' | 'deduccion'>(columna);
  const [resta, setResta] = useState(false);

  return (
    <div
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--borde)',
        borderRadius: 'var(--radio-s)',
        padding: 12,
        marginBottom: 8,
        color: 'var(--texto)',
      }}
    >
      <div className="entre" style={{ marginBottom: 8 }}>
        <strong className="mono">{codigo}</strong>
        <span className="tenue pequeno">
          {usos.length} uso(s) · {formatearBs(total)} Bs · aparece en la columna de {columna}
        </span>
      </div>
      <div className="linea">
        <div className="campo">
          <label>Nombre del concepto</label>
          <input
            type="text"
            value={nombre}
            placeholder="Ej: Insumos Ganaderos"
            onChange={(e) => setNombre(e.target.value)}
          />
        </div>
        <div className="campo" style={{ maxWidth: 150 }}>
          <label>Clase</label>
          <select value={clase} onChange={(e) => setClase(e.target.value as 'pago' | 'deduccion')}>
            <option value="pago">Pago</option>
            <option value="deduccion">Deducción</option>
          </select>
        </div>
      </div>
      {clase === 'deduccion' && (
        <label className="check" style={{ margin: '10px 0' }}>
          <input type="checkbox" checked={resta} onChange={(e) => setResta(e.target.checked)} />
          <span>
            Descuenta del Total a Facturar
            <small>
              Márcalo para descuentos reales (insumos, faltantes). Déjalo sin marcar para
              retenciones como el ISLR, que no reducen lo que el proveedor debe facturar.
            </small>
          </span>
        </label>
      )}
      <button
        className="btn primario chico"
        disabled={nombre.trim().length === 0}
        onClick={() =>
          alClasificar({
            codigo,
            nombre: nombre.trim(),
            clase,
            restaFacturacion: clase === 'deduccion' && resta,
            clasificado: true,
          })
        }
      >
        Clasificar {codigo}
      </button>
    </div>
  );
}
