import type { BaseDatos, Fila } from './basedatos.ts';
import { registrarBitacora } from './bitacora.ts';
import { nuevoId } from '../auth/hash.ts';
import { calcularRegistro } from '../calc/calcular.ts';
import { digitosDocumento } from '../identidad.ts';
import type {
  AsignacionFabrica,
  Autor,
  ConceptoCatalogo,
  ConceptoLeido,
  ConceptoManual,
  Empresa,
  LitrosDia,
  NominaLeida,
  NotaDebitoImportada,
  ParametrosNotaDebito,
  RegistroLeido,
  TasaBcv,
  TipoNomina,
  NdImportadaResumen,
} from '../types.ts';

// El alta y la autenticación de usuarios viven en src/core/auth/usuarios.ts.

// ─────────────────────────────────────────────────────────────
// Empresas y su asignación por fábrica
// ─────────────────────────────────────────────────────────────

function aEmpresa(f: Fila): Empresa {
  return {
    id: String(f['id']),
    razonSocial: String(f['razon_social']),
    rif: String(f['rif']),
    direccionFiscal: String(f['direccion_fiscal']),
    telefono: String(f['telefono'] ?? ''),
    email: String(f['email'] ?? ''),
    logo: typeof f['logo'] === 'string' ? f['logo'] : null,
  };
}

export function listarEmpresas(db: BaseDatos): Empresa[] {
  return db.todos<Fila>('SELECT * FROM empresas ORDER BY razon_social').map(aEmpresa);
}

export async function guardarEmpresa(
  db: BaseDatos,
  autor: Autor,
  empresa: Omit<Empresa, 'id'> & { id?: string },
): Promise<Empresa> {
  const id = empresa.id ?? nuevoId('e_');
  db.correr(
    `INSERT INTO empresas (id, razon_social, rif, direccion_fiscal, telefono, email, logo)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       razon_social = excluded.razon_social,
       rif = excluded.rif,
       direccion_fiscal = excluded.direccion_fiscal,
       telefono = excluded.telefono,
       email = excluded.email,
       logo = excluded.logo`,
    [
      id,
      empresa.razonSocial,
      empresa.rif,
      empresa.direccionFiscal,
      empresa.telefono,
      empresa.email,
      empresa.logo,
    ],
  );
  await registrarBitacora(db, autor, empresa.id ? 'editar-empresa' : 'crear-empresa', 'empresa', id, {
    razonSocial: empresa.razonSocial,
    rif: empresa.rif,
  });
  return { ...empresa, id };
}

export async function eliminarEmpresa(db: BaseDatos, autor: Autor, id: string): Promise<void> {
  const e = db.uno<Fila>('SELECT razon_social FROM empresas WHERE id = ?', [id]);
  db.correr('DELETE FROM empresas WHERE id = ?', [id]);
  await registrarBitacora(db, autor, 'eliminar-empresa', 'empresa', id, {
    razonSocial: e ? String(e['razon_social']) : '',
  });
}

export function listarFabricas(db: BaseDatos): AsignacionFabrica[] {
  return db
    .todos<Fila>('SELECT * FROM fabricas ORDER BY codigo')
    .map((f) => ({
      fabricaCod: String(f['codigo']),
      fabricaNom: String(f['nombre']),
      empresaId: typeof f['empresa_id'] === 'string' ? f['empresa_id'] : null,
    }));
}

/** Da de alta las fábricas que aparecen en un PDF, sin tocar las ya asignadas. */
export function registrarFabricas(db: BaseDatos, fabricas: { codigo: string; nombre: string }[]): void {
  for (const f of fabricas) {
    db.correr(
      `INSERT INTO fabricas (codigo, nombre, empresa_id) VALUES (?, ?, NULL)
       ON CONFLICT(codigo) DO UPDATE SET nombre = excluded.nombre`,
      [f.codigo, f.nombre],
    );
  }
}

export async function asignarEmpresaAFabrica(
  db: BaseDatos,
  autor: Autor,
  fabricaCod: string,
  empresaId: string | null,
): Promise<void> {
  db.correr('UPDATE fabricas SET empresa_id = ? WHERE codigo = ?', [empresaId, fabricaCod]);
  await registrarBitacora(db, autor, 'asignar-empresa', 'fabrica', fabricaCod, { empresaId });
}

/** Empresa que debe encabezar el comprobante de una fábrica dada. */
export function empresaDeFabrica(db: BaseDatos, fabricaCod: string): Empresa | null {
  const f = db.uno<Fila>(
    `SELECT e.* FROM fabricas f JOIN empresas e ON e.id = f.empresa_id WHERE f.codigo = ?`,
    [fabricaCod],
  );
  return f ? aEmpresa(f) : null;
}

// ─────────────────────────────────────────────────────────────
// Catálogo de conceptos
// ─────────────────────────────────────────────────────────────

function aConcepto(f: Fila): ConceptoCatalogo {
  return {
    codigo: String(f['codigo']),
    nombre: String(f['nombre']),
    clase: String(f['clase']) === 'pago' ? 'pago' : 'deduccion',
    restaFacturacion: Number(f['resta_facturacion']) === 1,
    clasificado: Number(f['clasificado']) === 1,
  };
}

export function listarCatalogo(db: BaseDatos): ConceptoCatalogo[] {
  return db.todos<Fila>('SELECT * FROM conceptos_catalogo ORDER BY codigo').map(aConcepto);
}

export function catalogoMapa(db: BaseDatos): Map<string, ConceptoCatalogo> {
  return new Map(listarCatalogo(db).map((c) => [c.codigo, c]));
}

export async function guardarConcepto(
  db: BaseDatos,
  autor: Autor,
  c: ConceptoCatalogo,
): Promise<void> {
  db.correr(
    `INSERT INTO conceptos_catalogo (codigo, nombre, clase, resta_facturacion, clasificado)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(codigo) DO UPDATE SET
       nombre = excluded.nombre,
       clase = excluded.clase,
       resta_facturacion = excluded.resta_facturacion,
       clasificado = excluded.clasificado`,
    [c.codigo, c.nombre, c.clase, c.restaFacturacion ? 1 : 0, c.clasificado ? 1 : 0],
  );
  await registrarBitacora(db, autor, 'clasificar-concepto', 'concepto', c.codigo, {
    nombre: c.nombre,
    clase: c.clase,
    restaFacturacion: c.restaFacturacion,
  });
}

/** Alta provisional de los códigos nuevos que trae un PDF, sin clasificar. */
export function sembrarConceptosDesconocidos(db: BaseDatos, nomina: NominaLeida): string[] {
  const nuevos: string[] = [];
  const existentes = new Set(listarCatalogo(db).map((c) => c.codigo));
  for (const r of nomina.registros) {
    for (const c of r.conceptos) {
      if (existentes.has(c.codigo)) continue;
      existentes.add(c.codigo);
      nuevos.push(c.codigo);
      db.correr(
        `INSERT OR IGNORE INTO conceptos_catalogo
           (codigo, nombre, clase, resta_facturacion, clasificado)
         VALUES (?, 'Sin clasificar', ?, 0, 0)`,
        [c.codigo, c.columna],
      );
    }
  }
  return nuevos;
}

// ─────────────────────────────────────────────────────────────
// Nóminas
// ─────────────────────────────────────────────────────────────

export interface NominaResumen {
  id: string;
  tipo: TipoNomina;
  anio: number;
  numero: number;
  fechaIni: string;
  fechaFin: string;
  reporte: string;
  archivo: string;
  usuarioNombre: string;
  procesadoEn: string;
  registros: number;
  bruto: number;
  deduccion: number;
  neto: number;
  totalFacturar: number;
}

export function listarNominas(db: BaseDatos): NominaResumen[] {
  return db
    .todos<Fila>(
      `SELECT n.*, COALESCE(u.nombre, '—') AS usuario_nombre,
              COUNT(r.id) AS n_registros,
              COALESCE(SUM(r.bruto), 0) AS s_bruto,
              COALESCE(SUM(r.deduccion), 0) AS s_deduccion,
              COALESCE(SUM(r.neto), 0) AS s_neto,
              COALESCE(SUM(r.total_facturar), 0) AS s_facturar
         FROM nominas n
         LEFT JOIN usuarios u ON u.id = n.usuario_id
         LEFT JOIN registros r ON r.nomina_id = n.id
        GROUP BY n.id
        ORDER BY n.anio DESC, n.numero DESC, n.tipo`,
    )
    .map((f) => ({
      id: String(f['id']),
      tipo: String(f['tipo']) === 'leche' ? 'leche' : 'transporte',
      anio: Number(f['anio']),
      numero: Number(f['numero']),
      fechaIni: String(f['fecha_ini']),
      fechaFin: String(f['fecha_fin']),
      reporte: String(f['reporte']),
      archivo: String(f['archivo']),
      usuarioNombre: String(f['usuario_nombre']),
      procesadoEn: String(f['procesado_en']),
      registros: Number(f['n_registros']),
      bruto: Number(f['s_bruto']),
      deduccion: Number(f['s_deduccion']),
      neto: Number(f['s_neto']),
      totalFacturar: Number(f['s_facturar']),
    }));
}

export function buscarNomina(
  db: BaseDatos,
  tipo: TipoNomina,
  anio: number,
  numero: number,
): NominaResumen | null {
  return (
    listarNominas(db).find((n) => n.tipo === tipo && n.anio === anio && n.numero === numero) ?? null
  );
}

export function nominaPorHash(db: BaseDatos, sha256: string): NominaResumen | null {
  const f = db.uno<Fila>('SELECT id FROM nominas WHERE sha256 = ?', [sha256]);
  if (!f) return null;
  const id = String(f['id']);
  return listarNominas(db).find((n) => n.id === id) ?? null;
}

/**
 * Guarda una nómina completa. Todo ocurre en una transacción: si algo falla a
 * mitad, no queda una nómina con la mitad de sus proveedores.
 */
export async function guardarNomina(
  db: BaseDatos,
  autor: Autor,
  nomina: NominaLeida,
  archivo: string,
  sha256: string,
  catalogo: Map<string, ConceptoCatalogo>,
): Promise<string> {
  const id = nuevoId('n_');
  const c = nomina.cabecera;

  await db.transaccionAsync(async () => {
    db.correr(
      `INSERT INTO nominas
         (id, tipo, anio, numero, fecha_ini, fecha_fin, reporte, archivo, sha256, usuario_id, procesado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        c.tipo,
        c.anio,
        c.numero,
        c.fechaIni,
        c.fechaFin,
        c.reporte,
        archivo,
        sha256,
        autor.id,
        new Date().toISOString(),
      ],
    );

    registrarFabricas(db, nomina.fabricas);

    for (const r of nomina.registros) {
      const calc = calcularRegistro(r, catalogo, [], null);
      const rid = nuevoId('r_');
      db.correr(
        `INSERT INTO registros
           (id, nomina_id, nombre, ruta, codigo, fabrica_cod, fabrica_nom, cedula, rif,
            banco, cuenta, litros_total, bruto, deduccion, neto, total_facturar, validacion, pagina)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rid,
          id,
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
          calc.bruto,
          calc.deducciones,
          calc.neto,
          calc.totalFacturar,
          calc.validacion.nivel,
          r.pagina,
        ],
      );
      r.conceptos.forEach((cp, i) => {
        db.correr(
          'INSERT INTO conceptos (registro_id, orden, codigo, centimos, columna) VALUES (?, ?, ?, ?, ?)',
          [rid, i, cp.codigo, cp.centimos, cp.columna],
        );
      });
      for (const l of r.litrosDia) {
        db.correr('INSERT OR REPLACE INTO litros_dia (registro_id, fecha, litros) VALUES (?, ?, ?)', [
          rid,
          l.fecha,
          l.litros,
        ]);
      }
    }

    await registrarBitacora(db, autor, 'cargar-nomina', 'nomina', id, {
      tipo: c.tipo,
      anio: c.anio,
      numero: c.numero,
      registros: nomina.registros.length,
      archivo,
      sha256,
    });
  });

  return id;
}

export async function eliminarNomina(db: BaseDatos, autor: Autor, id: string): Promise<void> {
  const n = db.uno<Fila>('SELECT tipo, anio, numero FROM nominas WHERE id = ?', [id]);
  if (!n) throw new Error('Esa nómina ya no existe.');
  const registros = Number(db.escalar('SELECT COUNT(*) FROM registros WHERE nomina_id = ?', [id]) ?? 0);
  db.correr('DELETE FROM nominas WHERE id = ?', [id]);
  await registrarBitacora(db, autor, 'eliminar-nomina', 'nomina', id, {
    tipo: String(n['tipo']),
    anio: Number(n['anio']),
    numero: Number(n['numero']),
    registrosEliminados: registros,
  });
}

// ─────────────────────────────────────────────────────────────
// Registros
// ─────────────────────────────────────────────────────────────

export interface RegistroGuardado {
  id: string;
  nominaId: string;
  leido: RegistroLeido;
  bruto: number;
  deduccion: number;
  neto: number;
  totalFacturar: number;
  validacion: string;
  manuales: ConceptoManual[];
  notaDebito: ParametrosNotaDebito | null;
}

function conceptosDe(db: BaseDatos, registroId: string): ConceptoLeido[] {
  return db
    .todos<Fila>('SELECT * FROM conceptos WHERE registro_id = ? ORDER BY orden', [registroId])
    .map((f) => ({
      codigo: String(f['codigo']),
      centimos: Number(f['centimos']),
      columna: String(f['columna']) === 'pago' ? 'pago' : 'deduccion',
    }));
}

function litrosDe(db: BaseDatos, registroId: string): LitrosDia[] {
  return db
    .todos<Fila>('SELECT * FROM litros_dia WHERE registro_id = ? ORDER BY fecha', [registroId])
    .map((f) => ({ fecha: String(f['fecha']), litros: Number(f['litros']) }));
}

function manualesDe(db: BaseDatos, registroId: string): ConceptoManual[] {
  return db
    .todos<Fila>('SELECT * FROM conceptos_manual WHERE registro_id = ? ORDER BY creado_en', [
      registroId,
    ])
    .map((f) => {
      const efecto = f['efecto'];
      return {
        id: String(f['id']),
        codigo: String(f['codigo']),
        nombre: String(f['nombre']),
        centimos: Number(f['centimos']),
        litros: f['litros'] === null ? null : Number(f['litros']),
        efecto: efecto === 'suma' || efecto === 'resta' ? efecto : null,
      };
    });
}

function notaDebitoDe(db: BaseDatos, registroId: string): ParametrosNotaDebito | null {
  const f = db.uno<Fila>('SELECT * FROM notas_debito WHERE registro_id = ?', [registroId]);
  if (!f) return null;
  return {
    precioUsd: Number(f['precio_usd']),
    fechaFactura: String(f['fecha_factura']),
    fechaNota: String(f['fecha_nota']),
    fechaCalculo: String(f['fecha_calculo']) === 'factura' ? 'factura' : 'nota',
  };
}

function aRegistro(db: BaseDatos, f: Fila): RegistroGuardado {
  const id = String(f['id']);
  return {
    id,
    nominaId: String(f['nomina_id']),
    leido: {
      nombre: String(f['nombre']),
      ruta: String(f['ruta']),
      codigo: String(f['codigo']),
      fabricaCod: String(f['fabrica_cod']),
      fabricaNom: String(f['fabrica_nom']),
      cedula: typeof f['cedula'] === 'string' ? f['cedula'] : null,
      rif: typeof f['rif'] === 'string' ? f['rif'] : null,
      banco: typeof f['banco'] === 'string' ? f['banco'] : null,
      cuenta: typeof f['cuenta'] === 'string' ? f['cuenta'] : null,
      litrosTotal: f['litros_total'] === null ? null : Number(f['litros_total']),
      // Solo tiene sentido durante el parseo: para cuando se guarda, ya se
      // replegó a litrosTotal y no hay columna propia en la base.
      litrosTransf: null,
      litrosDia: litrosDe(db, id),
      conceptos: conceptosDe(db, id),
      brutoPdf: Number(f['bruto']),
      deduccionPdf: Number(f['deduccion']),
      netoPdf: Number(f['neto']),
      pagina: Number(f['pagina']),
    },
    bruto: Number(f['bruto']),
    deduccion: Number(f['deduccion']),
    neto: Number(f['neto']),
    totalFacturar: Number(f['total_facturar']),
    validacion: String(f['validacion']),
    manuales: manualesDe(db, id),
    notaDebito: notaDebitoDe(db, id),
  };
}

export function registrosDeNomina(db: BaseDatos, nominaId: string): RegistroGuardado[] {
  return db
    .todos<Fila>('SELECT * FROM registros WHERE nomina_id = ? ORDER BY pagina, nombre', [nominaId])
    .map((f) => aRegistro(db, f));
}

/** Todas las apariciones de un proveedor a lo largo de las semanas. */
export interface AparicionProveedor {
  nomina: NominaResumen;
  registro: RegistroGuardado;
}

export function historialProveedor(
  db: BaseDatos,
  tipo: TipoNomina,
  codigo: string,
): AparicionProveedor[] {
  const nominas = new Map(listarNominas(db).map((n) => [n.id, n]));
  return db
    .todos<Fila>(
      `SELECT r.* FROM registros r
         JOIN nominas n ON n.id = r.nomina_id
        WHERE n.tipo = ? AND r.codigo = ?
        ORDER BY n.anio DESC, n.numero DESC`,
      [tipo, codigo],
    )
    .map((f) => aRegistro(db, f))
    .flatMap((registro) => {
      const nomina = nominas.get(registro.nominaId);
      return nomina ? [{ nomina, registro }] : [];
    });
}

// ─────────────────────────────────────────────────────────────
// Conceptos manuales, notas de débito y precios
// ─────────────────────────────────────────────────────────────

export interface DatosConceptoManual {
  codigo: string;
  nombre: string;
  centimos: number;
  litros: number | null;
  efecto: 'suma' | 'resta' | null;
}

export async function agregarConceptoManual(
  db: BaseDatos,
  autor: Autor,
  registroIds: string[],
  datos: DatosConceptoManual,
): Promise<void> {
  await db.transaccionAsync(async () => {
    for (const rid of registroIds) {
      db.correr(
        `INSERT INTO conceptos_manual
           (id, registro_id, codigo, nombre, centimos, litros, efecto, usuario_id, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nuevoId('m_'),
          rid,
          datos.codigo,
          datos.nombre,
          datos.centimos,
          datos.litros,
          datos.efecto,
          autor.id,
          new Date().toISOString(),
        ],
      );
    }
    await registrarBitacora(db, autor, 'concepto-manual', 'registro', registroIds.join(','), {
      ...datos,
      registros: registroIds.length,
    });
  });
}

export async function editarConceptoManual(
  db: BaseDatos,
  autor: Autor,
  id: string,
  datos: DatosConceptoManual,
): Promise<void> {
  db.correr(
    'UPDATE conceptos_manual SET codigo = ?, nombre = ?, centimos = ?, litros = ?, efecto = ? WHERE id = ?',
    [datos.codigo, datos.nombre, datos.centimos, datos.litros, datos.efecto, id],
  );
  await registrarBitacora(db, autor, 'editar-concepto-manual', 'registro', id, { ...datos });
}

export async function eliminarConceptoManual(
  db: BaseDatos,
  autor: Autor,
  id: string,
): Promise<void> {
  const m = db.uno<Fila>('SELECT registro_id, nombre FROM conceptos_manual WHERE id = ?', [id]);
  db.correr('DELETE FROM conceptos_manual WHERE id = ?', [id]);
  await registrarBitacora(db, autor, 'quitar-concepto-manual', 'registro', m ? String(m['registro_id']) : '', {
    nombre: m ? String(m['nombre']) : '',
  });
}

export async function guardarNotaDebito(
  db: BaseDatos,
  autor: Autor,
  registroIds: string[],
  params: ParametrosNotaDebito,
  precioPorRegistro: Map<string, number>,
): Promise<void> {
  await db.transaccionAsync(async () => {
    for (const rid of registroIds) {
      const precio = precioPorRegistro.get(rid) ?? params.precioUsd;
      db.correr(
        `INSERT INTO notas_debito
           (registro_id, precio_usd, fecha_factura, fecha_nota, fecha_calculo, usuario_id, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(registro_id) DO UPDATE SET
           precio_usd = excluded.precio_usd,
           fecha_factura = excluded.fecha_factura,
           fecha_nota = excluded.fecha_nota,
           fecha_calculo = excluded.fecha_calculo,
           usuario_id = excluded.usuario_id,
           actualizado_en = excluded.actualizado_en`,
        [
          rid,
          precio,
          params.fechaFactura,
          params.fechaNota,
          params.fechaCalculo,
          autor.id,
          new Date().toISOString(),
        ],
      );
    }
    await registrarBitacora(db, autor, 'nota-debito', 'registro', registroIds.join(','), {
      ...params,
      registros: registroIds.length,
    });
  });
}

export async function quitarNotaDebito(
  db: BaseDatos,
  autor: Autor,
  registroIds: string[],
): Promise<void> {
  await db.transaccionAsync(async () => {
    for (const rid of registroIds) {
      db.correr('DELETE FROM notas_debito WHERE registro_id = ?', [rid]);
    }
    await registrarBitacora(db, autor, 'quitar-nota-debito', 'registro', registroIds.join(','), {
      registros: registroIds.length,
    });
  });
}

export function preciosProveedor(db: BaseDatos, tipo: TipoNomina): Map<string, number> {
  return new Map(
    db
      .todos<Fila>('SELECT codigo, precio_usd FROM precios_proveedor WHERE tipo = ?', [tipo])
      .map((f) => [String(f['codigo']), Number(f['precio_usd'])]),
  );
}

export function guardarPrecioProveedor(
  db: BaseDatos,
  tipo: TipoNomina,
  codigo: string,
  precioUsd: number,
): void {
  db.correr(
    `INSERT INTO precios_proveedor (tipo, codigo, precio_usd, actualizado_en)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tipo, codigo) DO UPDATE SET
       precio_usd = excluded.precio_usd,
       actualizado_en = excluded.actualizado_en`,
    [tipo, codigo, precioUsd, new Date().toISOString()],
  );
}

// ─────────────────────────────────────────────────────────────
// Tasas del BCV
// ─────────────────────────────────────────────────────────────

export function listarTasas(db: BaseDatos): TasaBcv[] {
  return db
    .todos<Fila>('SELECT fecha, tasa FROM tasas_bcv ORDER BY fecha DESC')
    .map((f) => ({ fecha: String(f['fecha']), tasa: Number(f['tasa']) }));
}

export function tasasMapa(db: BaseDatos): Map<string, number> {
  return new Map(listarTasas(db).map((t) => [t.fecha, t.tasa]));
}

export async function guardarTasa(
  db: BaseDatos,
  autor: Autor,
  fecha: string,
  tasa: number,
): Promise<void> {
  if (!Number.isFinite(tasa) || tasa <= 0) throw new Error('La tasa debe ser un número mayor que cero.');
  db.correr(
    `INSERT INTO tasas_bcv (fecha, tasa, usuario_id, creado_en) VALUES (?, ?, ?, ?)
     ON CONFLICT(fecha) DO UPDATE SET tasa = excluded.tasa, usuario_id = excluded.usuario_id, creado_en = excluded.creado_en`,
    [fecha, tasa, autor.id, new Date().toISOString()],
  );
  await registrarBitacora(db, autor, 'cargar-tasa', 'tasa', fecha, { tasa });
}

export async function eliminarTasa(db: BaseDatos, autor: Autor, fecha: string): Promise<void> {
  db.correr('DELETE FROM tasas_bcv WHERE fecha = ?', [fecha]);
  await registrarBitacora(db, autor, 'eliminar-tasa', 'tasa', fecha, {});
}

// ─────────────────────────────────────────────────────────────
// Nombres completos y descargas
// ─────────────────────────────────────────────────────────────

export function nombresCompletos(db: BaseDatos, tipo: TipoNomina): Map<string, string> {
  return new Map(
    db
      .todos<Fila>('SELECT codigo, nombre_completo FROM nombres_full WHERE tipo = ?', [tipo])
      .map((f) => [String(f['codigo']), String(f['nombre_completo'])]),
  );
}

export async function guardarNombreCompleto(
  db: BaseDatos,
  autor: Autor,
  tipo: TipoNomina,
  codigo: string,
  nombreCompleto: string,
): Promise<void> {
  const limpio = nombreCompleto.trim();
  if (limpio.length === 0) {
    db.correr('DELETE FROM nombres_full WHERE tipo = ? AND codigo = ?', [tipo, codigo]);
  } else {
    db.correr(
      `INSERT INTO nombres_full (tipo, codigo, nombre_completo) VALUES (?, ?, ?)
       ON CONFLICT(tipo, codigo) DO UPDATE SET nombre_completo = excluded.nombre_completo`,
      [tipo, codigo, limpio],
    );
  }
  await registrarBitacora(db, autor, 'editar-nombre', 'proveedor', `${tipo}:${codigo}`, {
    nombreCompleto: limpio,
  });
}

export async function registrarDescargas(
  db: BaseDatos,
  autor: Autor,
  items: { registroId: string; folio: string; formato: string; archivo: string }[],
): Promise<void> {
  await db.transaccionAsync(async () => {
    for (const it of items) {
      db.correr(
        `INSERT INTO descargas (id, registro_id, folio, formato, archivo, usuario_id, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          nuevoId('d_'),
          it.registroId,
          it.folio,
          it.formato,
          it.archivo,
          autor.id,
          new Date().toISOString(),
        ],
      );
    }
    await registrarBitacora(db, autor, 'descargar-comprobante', 'registro', String(items.length), {
      cantidad: items.length,
      formatos: [...new Set(items.map((i) => i.formato))],
    });
  });
}

export interface Descarga {
  folio: string;
  formato: string;
  archivo: string;
  usuarioNombre: string;
  creadoEn: string;
}

export function descargasDeNomina(db: BaseDatos, nominaId: string): Map<string, Descarga[]> {
  const salida = new Map<string, Descarga[]>();
  const filas = db.todos<Fila>(
    `SELECT d.*, COALESCE(u.nombre, '—') AS usuario_nombre
       FROM descargas d
       JOIN registros r ON r.id = d.registro_id
       LEFT JOIN usuarios u ON u.id = d.usuario_id
      WHERE r.nomina_id = ?
      ORDER BY d.creado_en DESC`,
    [nominaId],
  );
  for (const f of filas) {
    const rid = String(f['registro_id']);
    const lista = salida.get(rid) ?? [];
    lista.push({
      folio: String(f['folio']),
      formato: String(f['formato']),
      archivo: String(f['archivo']),
      usuarioNombre: String(f['usuario_nombre']),
      creadoEn: String(f['creado_en']),
    });
    salida.set(rid, lista);
  }
  return salida;
}

// ─────────────────────────────────────────────────────────────
// Vínculos leche-transporte (comprobante combinado)
// ─────────────────────────────────────────────────────────────

export interface CandidatoVinculo {
  registroLeche: RegistroGuardado;
  registroTransporte: RegistroGuardado;
  documento: string;
}

/**
 * Candidatos de vínculo para una semana ganadera: mismo documento
 * (RIF/cédula normalizado) en leche y en transporte, excluyendo pares que ya
 * se resolvieron antes (confirmados O rechazados).
 */
export function candidatosVinculo(db: BaseDatos, anio: number, numero: number): CandidatoVinculo[] {
  const nominaLeche = buscarNomina(db, 'leche', anio, numero);
  const nominaTransporte = buscarNomina(db, 'transporte', anio, numero);
  if (!nominaLeche || !nominaTransporte) return [];

  const registrosLeche = registrosDeNomina(db, nominaLeche.id);
  const registrosTransporte = registrosDeNomina(db, nominaTransporte.id);

  const resueltos = new Set(
    db
      .todos<Fila>('SELECT codigo_leche, codigo_transporte FROM vinculos_proveedor')
      .map((f) => `${String(f['codigo_leche'])}::${String(f['codigo_transporte'])}`),
  );

  const candidatos: CandidatoVinculo[] = [];
  for (const rl of registrosLeche) {
    const digL = digitosDocumento(rl.leido.rif) ?? digitosDocumento(rl.leido.cedula);
    if (!digL) continue;
    for (const rt of registrosTransporte) {
      const digT = digitosDocumento(rt.leido.rif) ?? digitosDocumento(rt.leido.cedula);
      if (digT !== digL) continue;
      if (resueltos.has(`${rl.leido.codigo}::${rt.leido.codigo}`)) continue;
      candidatos.push({ registroLeche: rl, registroTransporte: rt, documento: digL });
    }
  }
  return candidatos;
}

export interface VinculoProveedor {
  id: string;
  codigoLeche: string;
  codigoTransporte: string;
  estado: 'confirmado' | 'rechazado';
  documento: string | null;
  usuarioId: string;
  creadoEn: string;
  actualizadoEn: string;
}

function aVinculo(f: Fila): VinculoProveedor {
  return {
    id: String(f['id']),
    codigoLeche: String(f['codigo_leche']),
    codigoTransporte: String(f['codigo_transporte']),
    estado: String(f['estado']) === 'rechazado' ? 'rechazado' : 'confirmado',
    documento: typeof f['documento'] === 'string' ? f['documento'] : null,
    usuarioId: String(f['usuario_id']),
    creadoEn: String(f['creado_en']),
    actualizadoEn: String(f['actualizado_en']),
  };
}

export function vinculosProveedor(db: BaseDatos): VinculoProveedor[] {
  return db
    .todos<Fila>('SELECT * FROM vinculos_proveedor ORDER BY actualizado_en DESC')
    .map(aVinculo);
}

export function vinculoConfirmadoDe(
  db: BaseDatos,
  tipo: TipoNomina,
  codigo: string,
): VinculoProveedor | null {
  const columna = tipo === 'leche' ? 'codigo_leche' : 'codigo_transporte';
  const f = db.uno<Fila>(
    `SELECT * FROM vinculos_proveedor WHERE ${columna} = ? AND estado = 'confirmado'`,
    [codigo],
  );
  return f ? aVinculo(f) : null;
}

async function guardarVinculo(
  db: BaseDatos,
  autor: Autor,
  codigoLeche: string,
  codigoTransporte: string,
  documento: string | null,
  estado: 'confirmado' | 'rechazado',
): Promise<void> {
  const ahora = new Date().toISOString();
  db.correr(
    `INSERT INTO vinculos_proveedor
       (id, codigo_leche, codigo_transporte, estado, documento, usuario_id, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(codigo_leche, codigo_transporte) DO UPDATE SET
       estado = excluded.estado,
       documento = excluded.documento,
       usuario_id = excluded.usuario_id,
       actualizado_en = excluded.actualizado_en`,
    [nuevoId('v_'), codigoLeche, codigoTransporte, estado, documento, autor.id, ahora, ahora],
  );
  await registrarBitacora(
    db,
    autor,
    estado === 'confirmado' ? 'confirmar-vinculo' : 'rechazar-vinculo',
    'vinculo',
    `${codigoLeche}::${codigoTransporte}`,
    { codigoLeche, codigoTransporte, documento },
  );
}

/** Vincula un proveedor de leche con una ruta de transporte. Se recuerda de
 * una semana a otra: no hace falta reconfirmarlo en cada carga. */
export async function confirmarVinculo(
  db: BaseDatos,
  autor: Autor,
  codigoLeche: string,
  codigoTransporte: string,
  documento: string | null,
): Promise<void> {
  const yaLeche = vinculoConfirmadoDe(db, 'leche', codigoLeche);
  if (yaLeche && yaLeche.codigoTransporte !== codigoTransporte) {
    throw new Error(
      `Este proveedor de leche ya está vinculado a la ruta ${yaLeche.codigoTransporte}. Desvincúlalo primero.`,
    );
  }
  const yaTransporte = vinculoConfirmadoDe(db, 'transporte', codigoTransporte);
  if (yaTransporte && yaTransporte.codigoLeche !== codigoLeche) {
    throw new Error(
      `Esta ruta ya está vinculada al proveedor de leche ${yaTransporte.codigoLeche}. Desvincúlala primero.`,
    );
  }
  // Exclusión mutua con la agrupación del mismo tipo: un código participa en
  // un solo mecanismo de combinación a la vez.
  if (grupoDeCodigo(db, 'leche', codigoLeche)) {
    throw new Error(
      `El código de leche ${codigoLeche} ya está agrupado con otros del mismo tipo. Desagrúpalo primero.`,
    );
  }
  if (grupoDeCodigo(db, 'transporte', codigoTransporte)) {
    throw new Error(
      `El código de transporte ${codigoTransporte} ya está agrupado con otros del mismo tipo. Desagrúpalo primero.`,
    );
  }
  await guardarVinculo(db, autor, codigoLeche, codigoTransporte, documento, 'confirmado');
}

/** Descarta una sugerencia para que no se vuelva a proponer cada semana. */
export async function rechazarVinculo(
  db: BaseDatos,
  autor: Autor,
  codigoLeche: string,
  codigoTransporte: string,
  documento: string | null,
): Promise<void> {
  await guardarVinculo(db, autor, codigoLeche, codigoTransporte, documento, 'rechazado');
}

/** Deshace un vínculo (confirmado o rechazado) para que vuelva a poder
 * sugerirse o decidirse desde cero. */
export async function desvincularProveedor(
  db: BaseDatos,
  autor: Autor,
  codigoLeche: string,
  codigoTransporte: string,
): Promise<void> {
  db.correr('DELETE FROM vinculos_proveedor WHERE codigo_leche = ? AND codigo_transporte = ?', [
    codigoLeche,
    codigoTransporte,
  ]);
  await registrarBitacora(db, autor, 'desvincular-proveedor', 'vinculo', `${codigoLeche}::${codigoTransporte}`, {
    codigoLeche,
    codigoTransporte,
  });
}

// ─────────────────────────────────────────────────────────────
// Agrupación del mismo tipo (2+ códigos de leche, o 2+ de transporte, que
// son el mismo proveedor). Mecanismo separado del de vínculos leche-
// transporte de arriba: un código participa en uno u otro, nunca en ambos
// (la exclusión mutua se valida en confirmarVinculo/confirmarGrupoMismoTipo).
// ─────────────────────────────────────────────────────────────

export interface CandidatoGrupoMismoTipo {
  tipo: TipoNomina;
  documento: string;
  registros: RegistroGuardado[];
}

/**
 * Candidatos de agrupación dentro de una nómina: registros del mismo tipo
 * con el mismo documento (RIF/cédula normalizado), excluyendo documentos ya
 * descartados y grupos donde ya están todos juntos.
 */
export function candidatosGrupoMismoTipo(
  db: BaseDatos,
  tipo: TipoNomina,
  anio: number,
  numero: number,
): CandidatoGrupoMismoTipo[] {
  const nomina = buscarNomina(db, tipo, anio, numero);
  if (!nomina) return [];
  const registros = registrosDeNomina(db, nomina.id);

  const porDocumento = new Map<string, RegistroGuardado[]>();
  for (const r of registros) {
    const dig = digitosDocumento(r.leido.rif) ?? digitosDocumento(r.leido.cedula);
    if (!dig) continue;
    const lista = porDocumento.get(dig) ?? [];
    lista.push(r);
    porDocumento.set(dig, lista);
  }

  const descartados = new Set(
    db
      .todos<Fila>('SELECT documento FROM grupo_mismo_tipo_descartado WHERE tipo = ?', [tipo])
      .map((f) => String(f['documento'])),
  );
  const gruposDeCodigo = new Map(
    db
      .todos<Fila>('SELECT codigo, grupo_id FROM grupo_mismo_tipo WHERE tipo = ?', [tipo])
      .map((f) => [String(f['codigo']), String(f['grupo_id'])]),
  );

  const candidatos: CandidatoGrupoMismoTipo[] = [];
  for (const [documento, lista] of porDocumento) {
    if (lista.length < 2 || descartados.has(documento)) continue;
    const grupoIds = new Set(lista.map((r) => gruposDeCodigo.get(r.leido.codigo)).filter(Boolean));
    // Si todos ya están en el mismo grupo, no hace falta volver a sugerirlo.
    if (grupoIds.size === 1 && lista.every((r) => gruposDeCodigo.has(r.leido.codigo))) continue;
    candidatos.push({ tipo, documento, registros: lista });
  }
  return candidatos;
}

export interface GrupoMismoTipo {
  grupoId: string;
  tipo: TipoNomina;
  codigos: string[];
  principal: string;
}

function gruposDesdeFilas(filas: Fila[]): GrupoMismoTipo[] {
  const porGrupo = new Map<string, Fila[]>();
  for (const f of filas) {
    const grupoId = String(f['grupo_id']);
    const lista = porGrupo.get(grupoId) ?? [];
    lista.push(f);
    porGrupo.set(grupoId, lista);
  }
  return [...porGrupo.entries()].map(([grupoId, lista]) => {
    const filaPrincipal = lista.find((f) => Number(f['principal']) === 1) ?? lista[0]!;
    return {
      grupoId,
      tipo: String(lista[0]!['tipo']) as TipoNomina,
      codigos: lista.map((f) => String(f['codigo'])),
      principal: String(filaPrincipal['codigo']),
    };
  });
}

export function gruposMismoTipo(db: BaseDatos): GrupoMismoTipo[] {
  return gruposDesdeFilas(db.todos<Fila>('SELECT * FROM grupo_mismo_tipo ORDER BY creado_en DESC'));
}

/** Si el código pertenece a un grupo, lo devuelve completo (con sus demás
 * miembros); si no, `null`. */
export function grupoDeCodigo(db: BaseDatos, tipo: TipoNomina, codigo: string): GrupoMismoTipo | null {
  const fila = db.uno<Fila>('SELECT grupo_id FROM grupo_mismo_tipo WHERE tipo = ? AND codigo = ?', [
    tipo,
    codigo,
  ]);
  if (!fila) return null;
  const filas = db.todos<Fila>('SELECT * FROM grupo_mismo_tipo WHERE grupo_id = ?', [
    String(fila['grupo_id']),
  ]);
  return gruposDesdeFilas(filas)[0] ?? null;
}

/** Agrupa 2+ códigos del mismo tipo. Si alguno ya pertenece a un grupo, el
 * resto se fusiona en ese mismo grupo. */
export async function confirmarGrupoMismoTipo(
  db: BaseDatos,
  autor: Autor,
  tipo: TipoNomina,
  codigos: string[],
): Promise<void> {
  if (codigos.length < 2) throw new Error('Un grupo necesita al menos 2 códigos.');

  for (const codigo of codigos) {
    const cruzado = vinculoConfirmadoDe(db, tipo, codigo);
    if (cruzado) {
      const contraparte = tipo === 'leche' ? cruzado.codigoTransporte : cruzado.codigoLeche;
      throw new Error(
        `El código ${codigo} ya está vinculado con ${contraparte} (leche-transporte). Desvincúlalo primero para poder agruparlo con otros del mismo tipo.`,
      );
    }
  }

  const grupoExistente = codigos
    .map((c) => db.uno<Fila>('SELECT grupo_id FROM grupo_mismo_tipo WHERE codigo = ?', [c]))
    .find((f): f is Fila => f !== null);
  const grupoId = grupoExistente ? String(grupoExistente['grupo_id']) : nuevoId('g_');

  const filaPrincipal = db.uno<Fila>(
    'SELECT codigo FROM grupo_mismo_tipo WHERE grupo_id = ? AND principal = 1',
    [grupoId],
  );
  const principal = filaPrincipal ? String(filaPrincipal['codigo']) : codigos[0]!;

  const ahora = new Date().toISOString();
  for (const codigo of codigos) {
    db.correr(
      `INSERT INTO grupo_mismo_tipo (codigo, tipo, grupo_id, principal, usuario_id, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(codigo) DO UPDATE SET
         grupo_id = excluded.grupo_id,
         actualizado_en = excluded.actualizado_en`,
      [codigo, tipo, grupoId, codigo === principal ? 1 : 0, autor.id, ahora, ahora],
    );
  }
  await registrarBitacora(db, autor, 'confirmar-grupo-mismo-tipo', 'grupo_mismo_tipo', grupoId, {
    tipo,
    codigos,
  });
}

/** Saca un código de su grupo. Si solo queda un miembro, el grupo se
 * disuelve por completo (un grupo de 1 no tiene sentido). */
export async function quitarDeGrupoMismoTipo(db: BaseDatos, autor: Autor, codigo: string): Promise<void> {
  const fila = db.uno<Fila>('SELECT grupo_id FROM grupo_mismo_tipo WHERE codigo = ?', [codigo]);
  if (!fila) return;
  const grupoId = String(fila['grupo_id']);
  db.correr('DELETE FROM grupo_mismo_tipo WHERE codigo = ?', [codigo]);

  const restantes = db.todos<Fila>('SELECT * FROM grupo_mismo_tipo WHERE grupo_id = ?', [grupoId]);
  if (restantes.length === 1) {
    db.correr('DELETE FROM grupo_mismo_tipo WHERE grupo_id = ?', [grupoId]);
  } else if (restantes.length > 1 && !restantes.some((f) => Number(f['principal']) === 1)) {
    db.correr('UPDATE grupo_mismo_tipo SET principal = 1 WHERE codigo = ?', [
      String(restantes[0]!['codigo']),
    ]);
  }

  await registrarBitacora(db, autor, 'quitar-de-grupo-mismo-tipo', 'grupo_mismo_tipo', grupoId, { codigo });
}

/** Descarta un candidato de agrupación para que no se vuelva a sugerir. */
export async function descartarCandidatoGrupoMismoTipo(
  db: BaseDatos,
  autor: Autor,
  tipo: TipoNomina,
  documento: string,
): Promise<void> {
  db.correr(
    `INSERT INTO grupo_mismo_tipo_descartado (tipo, documento, usuario_id, creado_en)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tipo, documento) DO NOTHING`,
    [tipo, documento, autor.id, new Date().toISOString()],
  );
  await registrarBitacora(db, autor, 'descartar-grupo-mismo-tipo', 'grupo_mismo_tipo', `${tipo}::${documento}`, {
    tipo,
    documento,
  });
}

// ─────────────────────────────────────────────────────────────
// Notas de débito importadas de Excel
// ─────────────────────────────────────────────────────────────

function aNotaDebitoImportada(f: Fila): NotaDebitoImportada {
  return {
    id: String(f['id']),
    nominaId: String(f['nomina_id']),
    registroId: typeof f['registro_id'] === 'string' ? f['registro_id'] : null,
    tipo: String(f['tipo']) as TipoNomina,
    codigoExcel: String(f['codigo_excel']),
    proveedorExcel: String(f['proveedor_excel']),
    fabricaExcel: typeof f['fabrica_excel'] === 'string' ? f['fabrica_excel'] : null,
    sapExcel: typeof f['sap_excel'] === 'string' ? f['sap_excel'] : null,
    fechaNota: String(f['fecha_nota']),
    litrosEnviados: f['litros_enviados'] === null ? null : Number(f['litros_enviados']),
    litrosTransportados: f['litros_transportados'] === null ? null : Number(f['litros_transportados']),
    precioUsdLts: f['precio_usd_lts'] === null ? null : Number(f['precio_usd_lts']),
    precioUsdFlete: f['precio_usd_flete'] === null ? null : Number(f['precio_usd_flete']),
    bsXLtsInicio: f['bs_x_lts_inicio'] === null ? null : Number(f['bs_x_lts_inicio']),
    bsXLtsAjustado: f['bs_x_lts_ajustado'] === null ? null : Number(f['bs_x_lts_ajustado']),
    difXLts: f['dif_x_lts'] === null ? null : Number(f['dif_x_lts']),
    centimos: Number(f['centimos']),
    emparejamiento: String(f['emparejamiento']) as NotaDebitoImportada['emparejamiento'],
    quitadaEn: typeof f['quitada_en'] === 'string' ? f['quitada_en'] : null,
  };
}

export function notasDebitoImportadasDeNomina(db: BaseDatos, nominaId: string): NotaDebitoImportada[] {
  return db
    .todos<Fila>(
      'SELECT * FROM notas_debito_importadas WHERE nomina_id = ? AND quitada_en IS NULL ORDER BY creado_en',
      [nominaId],
    )
    .map(aNotaDebitoImportada);
}

/** Las que el usuario quitó (más reciente primero): no cuentan para nada
 * hasta que se restauren. */
export function notasDebitoQuitadasDeNomina(db: BaseDatos, nominaId: string): NotaDebitoImportada[] {
  return db
    .todos<Fila>(
      'SELECT * FROM notas_debito_importadas WHERE nomina_id = ? AND quitada_en IS NOT NULL ORDER BY quitada_en DESC',
      [nominaId],
    )
    .map(aNotaDebitoImportada);
}

/** Código de registro -> override importado, solo de las filas ya
 * emparejadas de esta nómina. Para inyectar en ContextoComprobante.ndImportada. */
export function ndImportadaMapa(
  db: BaseDatos,
  nominaId: string,
): Map<string, NdImportadaResumen> {
  const filas = db.todos<Fila>(
    `SELECT r.codigo AS codigo, ndi.centimos AS centimos, ndi.fecha_nota AS fecha_nota,
            ndi.tipo AS tipo, ndi.litros_enviados AS litros_enviados,
            ndi.litros_transportados AS litros_transportados, ndi.precio_usd_lts AS precio_usd_lts,
            ndi.precio_usd_flete AS precio_usd_flete, ndi.bs_x_lts_inicio AS bs_x_lts_inicio,
            ndi.bs_x_lts_ajustado AS bs_x_lts_ajustado, ndi.dif_x_lts AS dif_x_lts
     FROM notas_debito_importadas ndi
     JOIN registros r ON r.id = ndi.registro_id
     WHERE ndi.nomina_id = ? AND ndi.registro_id IS NOT NULL AND ndi.quitada_en IS NULL`,
    [nominaId],
  );
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return new Map(
    filas.map((f) => {
      const tipo = f['tipo'] === 'transporte' ? 'transporte' : 'leche';
      return [
        String(f['codigo']),
        {
          centimos: Number(f['centimos']),
          fechaNota: String(f['fecha_nota']),
          informativo: {
            tipo,
            litros: num(tipo === 'leche' ? f['litros_enviados'] : f['litros_transportados']),
            precioUsd: num(tipo === 'leche' ? f['precio_usd_lts'] : f['precio_usd_flete']),
            bsXLtsInicio: num(f['bs_x_lts_inicio']),
            bsXLtsAjustado: num(f['bs_x_lts_ajustado']),
            difXLts: num(f['dif_x_lts']),
          },
        },
      ];
    }),
  );
}

export interface FilaNdImportadaAGuardar {
  /** Nómina "dueña" de la fila: la del registro emparejado (puede ser la
   * nómina hermana, si el Excel trae también filas del otro tipo), o la
   * nómina que se estaba viendo al importar, mientras esté pendiente. */
  nominaId: string;
  registroId: string | null;
  tipo: TipoNomina;
  codigoExcel: string;
  proveedorExcel: string;
  fabricaExcel: string | null;
  sapExcel: string | null;
  fechaNota: string;
  litrosEnviados: number | null;
  litrosTransportados: number | null;
  precioUsdLts: number | null;
  precioUsdFlete: number | null;
  bsXLtsInicio: number | null;
  bsXLtsAjustado: number | null;
  difXLts: number | null;
  centimos: number;
  emparejamiento: 'codigo' | 'nombre' | 'pendiente';
}

/** Guarda en lote una importación ya confirmada (filas emparejadas y
 * pendientes). Secuencial dentro de una transacción, como guardarNotaDebito,
 * por la bitácora encadenada. */
export async function guardarNotasDebitoImportadas(
  db: BaseDatos,
  autor: Autor,
  sesionNominaId: string,
  filas: FilaNdImportadaAGuardar[],
): Promise<void> {
  await db.transaccionAsync(async () => {
    const ahora = new Date().toISOString();
    for (const f of filas) {
      db.correr(
        `INSERT INTO notas_debito_importadas
           (id, nomina_id, registro_id, tipo, codigo_excel, proveedor_excel, fabrica_excel, sap_excel,
            fecha_nota, litros_enviados, litros_transportados, precio_usd_lts, precio_usd_flete,
            bs_x_lts_inicio, bs_x_lts_ajustado, dif_x_lts, centimos, emparejamiento,
            usuario_id, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(registro_id) WHERE registro_id IS NOT NULL AND quitada_en IS NULL DO UPDATE SET
           codigo_excel = excluded.codigo_excel,
           proveedor_excel = excluded.proveedor_excel,
           fabrica_excel = excluded.fabrica_excel,
           sap_excel = excluded.sap_excel,
           fecha_nota = excluded.fecha_nota,
           litros_enviados = excluded.litros_enviados,
           litros_transportados = excluded.litros_transportados,
           precio_usd_lts = excluded.precio_usd_lts,
           precio_usd_flete = excluded.precio_usd_flete,
           bs_x_lts_inicio = excluded.bs_x_lts_inicio,
           bs_x_lts_ajustado = excluded.bs_x_lts_ajustado,
           dif_x_lts = excluded.dif_x_lts,
           centimos = excluded.centimos,
           emparejamiento = excluded.emparejamiento,
           actualizado_en = excluded.actualizado_en`,
        [
          nuevoId('ndi_'),
          f.nominaId,
          f.registroId,
          f.tipo,
          f.codigoExcel,
          f.proveedorExcel,
          f.fabricaExcel,
          f.sapExcel,
          f.fechaNota,
          f.litrosEnviados,
          f.litrosTransportados,
          f.precioUsdLts,
          f.precioUsdFlete,
          f.bsXLtsInicio,
          f.bsXLtsAjustado,
          f.difXLts,
          f.centimos,
          f.emparejamiento,
          autor.id,
          ahora,
          ahora,
        ],
      );
    }
    await registrarBitacora(db, autor, 'importar-nota-debito', 'nomina', sesionNominaId, {
      filas: filas.length,
      emparejadas: filas.filter((f) => f.registroId !== null).length,
      pendientes: filas.filter((f) => f.registroId === null).length,
    });
  });
}

/** Resolución manual de una fila pendiente: le asigna un registro y pasa a
 * emparejamiento 'manual'. */
export async function resolverNotaDebitoImportada(
  db: BaseDatos,
  autor: Autor,
  id: string,
  registroId: string,
): Promise<void> {
  const registro = db.uno<Fila>('SELECT nomina_id FROM registros WHERE id = ?', [registroId]);
  if (!registro) throw new Error('El registro elegido no existe.');
  db.correr(
    `UPDATE notas_debito_importadas
     SET registro_id = ?, nomina_id = ?, emparejamiento = 'manual', actualizado_en = ?
     WHERE id = ?`,
    [registroId, String(registro['nomina_id']), new Date().toISOString(), id],
  );
  await registrarBitacora(db, autor, 'resolver-nota-debito-importada', 'registro', registroId, { id });
}

/** "Quitar": la fila deja de contar (el proveedor vuelve a su ND calculada
 * o a ninguna) pero queda guardada para poder restaurarla. */
export async function quitarNotaDebitoImportada(db: BaseDatos, autor: Autor, id: string): Promise<void> {
  db.correr('UPDATE notas_debito_importadas SET quitada_en = ? WHERE id = ? AND quitada_en IS NULL', [
    new Date().toISOString(),
    id,
  ]);
  await registrarBitacora(db, autor, 'quitar-nota-debito-importada', 'nota_debito_importada', id, {});
}

/** Vuelve a poner vigente una ND quitada. Falla si su proveedor ya tiene
 * otra ND importada vigente (p. ej. se reimportó el Excel después). */
export async function restaurarNotaDebitoImportada(db: BaseDatos, autor: Autor, id: string): Promise<void> {
  const fila = db.uno<Fila>('SELECT registro_id FROM notas_debito_importadas WHERE id = ?', [id]);
  if (!fila) throw new Error('La nota de débito ya no existe.');
  if (fila['registro_id'] !== null) {
    const vigente = db.uno<Fila>(
      'SELECT id FROM notas_debito_importadas WHERE registro_id = ? AND quitada_en IS NULL',
      [fila['registro_id'] as string],
    );
    if (vigente) {
      throw new Error(
        'ese proveedor ya tiene otra nota de débito importada vigente. Quita esa primero si quieres usar esta.',
      );
    }
  }
  db.correr('UPDATE notas_debito_importadas SET quitada_en = NULL, actualizado_en = ? WHERE id = ?', [
    new Date().toISOString(),
    id,
  ]);
  await registrarBitacora(db, autor, 'restaurar-nota-debito-importada', 'nota_debito_importada', id, {});
}

/** Borrado definitivo (solo desde el apartado de quitadas). */
export async function eliminarNotaDebitoImportada(db: BaseDatos, autor: Autor, id: string): Promise<void> {
  db.correr('DELETE FROM notas_debito_importadas WHERE id = ?', [id]);
  await registrarBitacora(db, autor, 'eliminar-nota-debito-importada', 'nota_debito_importada', id, {});
}
