import type { BaseDatos, Fila } from '../db/basedatos.ts';
import { registrarBitacora } from '../db/bitacora.ts';
import { nuevoId } from '../auth/hash.ts';
import * as repo from '../db/repo.ts';
import type {
  Autor,
  ConceptoCatalogo,
  Empresa,
  TasaBcv,
  TipoNomina,
} from '../types.ts';

/**
 * Intercambio de histórico entre equipos.
 *
 * El paquete es JSON y no una copia de la base: al importar hay que FUSIONAR
 * con lo que el otro equipo ya tenga, sin borrarle nada. Un archivo SQLite solo
 * sabría reemplazar. Para reemplazar está la restauración de respaldo, que es
 * una operación distinta y solo de administrador.
 */

export const FORMATO = 'lectorocr-export';
export const VERSION_PAQUETE = 1;

export interface RegistroExportado {
  nombre: string;
  ruta: string;
  codigo: string;
  fabricaCod: string;
  fabricaNom: string;
  cedula: string | null;
  rif: string | null;
  banco: string | null;
  cuenta: string | null;
  litrosTotal: number | null;
  bruto: number;
  deduccion: number;
  neto: number;
  totalFacturar: number;
  validacion: string;
  pagina: number;
  conceptos: { codigo: string; centimos: number; columna: string }[];
  litrosDia: { fecha: string; litros: number }[];
  manuales: { codigo: string; nombre: string; centimos: number; litros: number | null }[];
  notaDebito: {
    precioUsd: number;
    fechaFactura: string;
    fechaNota: string;
    fechaCalculo: string;
  } | null;
}

export interface NominaExportada {
  tipo: TipoNomina;
  anio: number;
  numero: number;
  fechaIni: string;
  fechaFin: string;
  reporte: string;
  archivo: string;
  sha256: string;
  procesadoEn: string;
  usuarioNombre: string;
  registros: RegistroExportado[];
}

export interface Paquete {
  formato: typeof FORMATO;
  version: number;
  creadoEn: string;
  origenUsuario: string;
  catalogo: ConceptoCatalogo[];
  empresas: Empresa[];
  fabricas: { codigo: string; nombre: string; empresaRif: string | null }[];
  tasas: TasaBcv[];
  nombres: { tipo: TipoNomina; codigo: string; nombreCompleto: string }[];
  nominas: NominaExportada[];
}

// ─────────────────────────────────────────────────────────────
// Exportar
// ─────────────────────────────────────────────────────────────

export function exportarPaquete(db: BaseDatos, autor: Autor, nominaIds: string[]): Paquete {
  const empresas = repo.listarEmpresas(db);
  const porId = new Map(empresas.map((e) => [e.id, e]));

  const nominas: NominaExportada[] = [];
  for (const id of nominaIds) {
    const cab = db.uno<Fila>('SELECT * FROM nominas WHERE id = ?', [id]);
    if (!cab) continue;
    const autorNomina = db.uno<Fila>('SELECT nombre FROM usuarios WHERE id = ?', [String(cab['usuario_id'])]);

    nominas.push({
      tipo: String(cab['tipo']) === 'leche' ? 'leche' : 'transporte',
      anio: Number(cab['anio']),
      numero: Number(cab['numero']),
      fechaIni: String(cab['fecha_ini']),
      fechaFin: String(cab['fecha_fin']),
      reporte: String(cab['reporte']),
      archivo: String(cab['archivo']),
      sha256: String(cab['sha256']),
      procesadoEn: String(cab['procesado_en']),
      usuarioNombre: autorNomina ? String(autorNomina['nombre']) : '—',
      registros: repo.registrosDeNomina(db, id).map((r) => ({
        nombre: r.leido.nombre,
        ruta: r.leido.ruta,
        codigo: r.leido.codigo,
        fabricaCod: r.leido.fabricaCod,
        fabricaNom: r.leido.fabricaNom,
        cedula: r.leido.cedula,
        rif: r.leido.rif,
        banco: r.leido.banco,
        cuenta: r.leido.cuenta,
        litrosTotal: r.leido.litrosTotal,
        bruto: r.bruto,
        deduccion: r.deduccion,
        neto: r.neto,
        totalFacturar: r.totalFacturar,
        validacion: r.validacion,
        pagina: r.leido.pagina,
        conceptos: r.leido.conceptos.map((c) => ({
          codigo: c.codigo,
          centimos: c.centimos,
          columna: c.columna,
        })),
        litrosDia: r.leido.litrosDia.map((l) => ({ fecha: l.fecha, litros: l.litros })),
        manuales: r.manuales.map((m) => ({
          codigo: m.codigo,
          nombre: m.nombre,
          centimos: m.centimos,
          litros: m.litros,
        })),
        notaDebito: r.notaDebito
          ? {
              precioUsd: r.notaDebito.precioUsd,
              fechaFactura: r.notaDebito.fechaFactura,
              fechaNota: r.notaDebito.fechaNota,
              fechaCalculo: r.notaDebito.fechaCalculo,
            }
          : null,
      })),
    });
  }

  return {
    formato: FORMATO,
    version: VERSION_PAQUETE,
    creadoEn: new Date().toISOString(),
    origenUsuario: autor.nombre,
    catalogo: repo.listarCatalogo(db),
    empresas,
    // Las fábricas viajan referidas al RIF y no al id interno, que es distinto
    // en cada instalación.
    fabricas: repo.listarFabricas(db).map((f) => ({
      codigo: f.fabricaCod,
      nombre: f.fabricaNom,
      empresaRif: f.empresaId ? (porId.get(f.empresaId)?.rif ?? null) : null,
    })),
    tasas: repo.listarTasas(db),
    nombres: (['leche', 'transporte'] as TipoNomina[]).flatMap((tipo) =>
      [...repo.nombresCompletos(db, tipo)].map(([codigo, nombreCompleto]) => ({
        tipo,
        codigo,
        nombreCompleto,
      })),
    ),
    nominas,
  };
}

export function paqueteABlob(paquete: Paquete): Blob {
  return new Blob([JSON.stringify(paquete, null, 1)], { type: 'application/json' });
}

// ─────────────────────────────────────────────────────────────
// Analizar antes de importar
// ─────────────────────────────────────────────────────────────

export type EstadoNomina = 'nueva' | 'duplicada' | 'conflicto';

export interface FilaInforme {
  clave: string;
  tipo: TipoNomina;
  anio: number;
  numero: number;
  registros: number;
  neto: number;
  estado: EstadoNomina;
  detalle: string;
}

export interface Informe {
  valido: boolean;
  error?: string;
  creadoEn: string;
  origenUsuario: string;
  filas: FilaInforme[];
  tasasNuevas: number;
  conceptosNuevos: string[];
  empresasNuevas: string[];
  nombresNuevos: number;
}

export function leerPaquete(bytes: Uint8Array): Paquete | null {
  try {
    const texto = new TextDecoder().decode(bytes);
    const dato = JSON.parse(texto) as Paquete;
    if (dato?.formato !== FORMATO) return null;
    if (!Array.isArray(dato.nominas)) return null;
    return dato;
  } catch {
    return null;
  }
}

export function analizarPaquete(db: BaseDatos, paquete: Paquete): Informe {
  if (paquete.version > VERSION_PAQUETE) {
    return {
      valido: false,
      error: `El archivo fue creado por una versión más nueva de CompPago (formato ${paquete.version}). Actualiza esta aplicación para poder importarlo.`,
      creadoEn: paquete.creadoEn,
      origenUsuario: paquete.origenUsuario,
      filas: [],
      tasasNuevas: 0,
      conceptosNuevos: [],
      empresasNuevas: [],
      nombresNuevos: 0,
    };
  }

  const existentes = repo.listarNominas(db);
  const filas: FilaInforme[] = paquete.nominas.map((n) => {
    const clave = `${n.tipo}|${n.anio}|${n.numero}`;
    const neto = n.registros.reduce((a, r) => a + r.neto, 0);
    const ya = existentes.find((e) => e.tipo === n.tipo && e.anio === n.anio && e.numero === n.numero);

    if (!ya) {
      return { clave, tipo: n.tipo, anio: n.anio, numero: n.numero, registros: n.registros.length, neto, estado: 'nueva', detalle: 'No existe en este equipo. Se agregará.' };
    }
    if (ya.registros === n.registros.length && ya.neto === neto) {
      return { clave, tipo: n.tipo, anio: n.anio, numero: n.numero, registros: n.registros.length, neto, estado: 'duplicada', detalle: 'Ya existe con los mismos datos. Se omitirá.' };
    }
    return {
      clave,
      tipo: n.tipo,
      anio: n.anio,
      numero: n.numero,
      registros: n.registros.length,
      neto,
      estado: 'conflicto',
      detalle: `Ya existe pero con datos distintos: aquí tiene ${ya.registros} registros y un neto de ${ya.neto / 100}. Se omitirá para no pisar lo tuyo.`,
    };
  });

  const tasasActuales = repo.tasasMapa(db);
  const catalogoActual = new Set(repo.listarCatalogo(db).map((c) => c.codigo));
  const rifsActuales = new Set(repo.listarEmpresas(db).map((e) => e.rif));
  const nombresActuales = new Set(
    (['leche', 'transporte'] as TipoNomina[]).flatMap((t) =>
      [...repo.nombresCompletos(db, t).keys()].map((c) => `${t}:${c}`),
    ),
  );

  return {
    valido: true,
    creadoEn: paquete.creadoEn,
    origenUsuario: paquete.origenUsuario,
    filas,
    tasasNuevas: (paquete.tasas ?? []).filter((t) => !tasasActuales.has(t.fecha)).length,
    conceptosNuevos: (paquete.catalogo ?? [])
      .filter((c) => !catalogoActual.has(c.codigo))
      .map((c) => c.codigo),
    empresasNuevas: (paquete.empresas ?? [])
      .filter((e) => !rifsActuales.has(e.rif))
      .map((e) => e.razonSocial),
    nombresNuevos: (paquete.nombres ?? []).filter(
      (n) => !nombresActuales.has(`${n.tipo}:${n.codigo}`),
    ).length,
  };
}

// ─────────────────────────────────────────────────────────────
// Importar
// ─────────────────────────────────────────────────────────────

export interface ResultadoImportacion {
  nominas: number;
  registros: number;
  tasas: number;
  conceptos: number;
  empresas: number;
  nombres: number;
  omitidas: number;
}

/**
 * Fusiona el paquete. Solo AGREGA: nunca sobrescribe ni borra nada de lo que ya
 * hay en este equipo. Las nóminas duplicadas o en conflicto se omiten y se
 * informan.
 */
export async function importarPaquete(
  db: BaseDatos,
  autor: Autor,
  paquete: Paquete,
  clavesAImportar: Set<string>,
): Promise<ResultadoImportacion> {
  const res: ResultadoImportacion = {
    nominas: 0,
    registros: 0,
    tasas: 0,
    conceptos: 0,
    empresas: 0,
    nombres: 0,
    omitidas: 0,
  };

  await db.transaccionAsync(async () => {
    // Conceptos nuevos: llegan SIN clasificar aunque vinieran clasificados en
    // el origen, para que un administrador de este equipo los revise.
    const catalogoActual = new Set(repo.listarCatalogo(db).map((c) => c.codigo));
    for (const c of paquete.catalogo ?? []) {
      if (catalogoActual.has(c.codigo)) continue;
      db.correr(
        `INSERT OR IGNORE INTO conceptos_catalogo (codigo, nombre, clase, resta_facturacion, clasificado)
         VALUES (?, ?, ?, ?, 0)`,
        [c.codigo, c.nombre, c.clase, c.restaFacturacion ? 1 : 0],
      );
      res.conceptos++;
    }

    // Empresas: se identifican por RIF, que es lo estable entre instalaciones.
    const porRif = new Map(repo.listarEmpresas(db).map((e) => [e.rif, e]));
    for (const e of paquete.empresas ?? []) {
      if (porRif.has(e.rif)) continue;
      const id = nuevoId('e_');
      db.correr(
        `INSERT INTO empresas (id, razon_social, rif, direccion_fiscal, telefono, email, logo)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, e.razonSocial, e.rif, e.direccionFiscal, e.telefono, e.email, e.logo],
      );
      porRif.set(e.rif, { ...e, id });
      res.empresas++;
    }

    for (const f of paquete.fabricas ?? []) {
      const yaAsignada = db.uno<Fila>('SELECT empresa_id FROM fabricas WHERE codigo = ?', [f.codigo]);
      const destino = f.empresaRif ? (porRif.get(f.empresaRif)?.id ?? null) : null;
      if (yaAsignada && yaAsignada['empresa_id']) {
        // Ya tiene empresa aquí: se respeta la decisión local.
        db.correr('UPDATE fabricas SET nombre = ? WHERE codigo = ?', [f.nombre, f.codigo]);
      } else {
        db.correr(
          `INSERT INTO fabricas (codigo, nombre, empresa_id) VALUES (?, ?, ?)
           ON CONFLICT(codigo) DO UPDATE SET nombre = excluded.nombre, empresa_id = excluded.empresa_id`,
          [f.codigo, f.nombre, destino],
        );
      }
    }

    const tasasActuales = repo.tasasMapa(db);
    for (const t of paquete.tasas ?? []) {
      if (tasasActuales.has(t.fecha)) continue;
      db.correr('INSERT INTO tasas_bcv (fecha, tasa, usuario_id, creado_en) VALUES (?, ?, ?, ?)', [
        t.fecha,
        t.tasa,
        autor.id,
        new Date().toISOString(),
      ]);
      res.tasas++;
    }

    for (const n of paquete.nombres ?? []) {
      const ya = db.escalar('SELECT COUNT(*) FROM nombres_full WHERE tipo = ? AND codigo = ?', [
        n.tipo,
        n.codigo,
      ]);
      if (Number(ya) > 0) continue;
      db.correr('INSERT INTO nombres_full (tipo, codigo, nombre_completo) VALUES (?, ?, ?)', [
        n.tipo,
        n.codigo,
        n.nombreCompleto,
      ]);
      res.nombres++;
    }

    for (const n of paquete.nominas) {
      const clave = `${n.tipo}|${n.anio}|${n.numero}`;
      if (!clavesAImportar.has(clave)) {
        res.omitidas++;
        continue;
      }
      const yaExiste = db.escalar(
        'SELECT COUNT(*) FROM nominas WHERE tipo = ? AND anio = ? AND numero = ?',
        [n.tipo, n.anio, n.numero],
      );
      if (Number(yaExiste) > 0) {
        res.omitidas++;
        continue;
      }

      const idNomina = nuevoId('n_');
      db.correr(
        `INSERT INTO nominas
           (id, tipo, anio, numero, fecha_ini, fecha_fin, reporte, archivo, sha256, usuario_id, procesado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          idNomina,
          n.tipo,
          n.anio,
          n.numero,
          n.fechaIni,
          n.fechaFin,
          n.reporte,
          n.archivo,
          n.sha256,
          autor.id,
          n.procesadoEn,
        ],
      );
      res.nominas++;

      for (const r of n.registros) {
        const rid = nuevoId('r_');
        db.correr(
          `INSERT INTO registros
             (id, nomina_id, nombre, ruta, codigo, fabrica_cod, fabrica_nom, cedula, rif,
              banco, cuenta, litros_total, bruto, deduccion, neto, total_facturar, validacion, pagina)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            rid,
            idNomina,
            r.nombre,
            r.ruta,
            r.codigo,
            r.fabricaCod,
            r.fabricaNom,
            r.cedula,
            r.rif,
            r.banco,
            r.cuenta,
            r.litrosTotal,
            r.bruto,
            r.deduccion,
            r.neto,
            r.totalFacturar,
            r.validacion,
            r.pagina,
          ],
        );
        res.registros++;

        r.conceptos.forEach((c, i) => {
          db.correr(
            'INSERT INTO conceptos (registro_id, orden, codigo, centimos, columna) VALUES (?, ?, ?, ?, ?)',
            [rid, i, c.codigo, c.centimos, c.columna],
          );
        });
        for (const l of r.litrosDia) {
          db.correr(
            'INSERT OR REPLACE INTO litros_dia (registro_id, fecha, litros) VALUES (?, ?, ?)',
            [rid, l.fecha, l.litros],
          );
        }
        for (const m of r.manuales) {
          db.correr(
            `INSERT INTO conceptos_manual (id, registro_id, codigo, nombre, centimos, litros, usuario_id, creado_en)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [nuevoId('m_'), rid, m.codigo, m.nombre, m.centimos, m.litros, autor.id, new Date().toISOString()],
          );
        }
        if (r.notaDebito) {
          db.correr(
            `INSERT INTO notas_debito
               (registro_id, precio_usd, fecha_factura, fecha_nota, fecha_calculo, usuario_id, actualizado_en)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              rid,
              r.notaDebito.precioUsd,
              r.notaDebito.fechaFactura,
              r.notaDebito.fechaNota,
              r.notaDebito.fechaCalculo,
              autor.id,
              new Date().toISOString(),
            ],
          );
        }
      }
    }

    await registrarBitacora(db, autor, 'importar-historico', 'paquete', paquete.creadoEn, {
      origen: paquete.origenUsuario,
      ...res,
    });
  });

  return res;
}
