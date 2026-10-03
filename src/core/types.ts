/**
 * Modelo de dominio de CompPago.
 *
 * CONVENCIÓN DE DINERO
 * --------------------
 * Todos los montos en bolívares se manejan como ENTEROS DE CÉNTIMOS.
 * 36.767.287,53 Bs  ->  3676728753
 *
 * El motivo es que la validación compara sumas contra los totales que el
 * propio PDF declara, y con números de coma flotante esa comparación exige
 * tolerancias arbitrarias. Con céntimos enteros la igualdad es exacta.
 * Usa `aCentimos()` para leer y `formatearBs()` para mostrar.
 *
 * Excepciones deliberadas: `precioUsd` y las tasas del BCV son valores de
 * configuración (no sumas acumuladas), se manejan como número decimal y solo
 * el resultado final de la nota de débito se redondea a céntimos.
 */

export type TipoNomina = 'leche' | 'transporte';

/** En qué banda de la tabla apareció el monto dentro del PDF. */
export type ColumnaMonto = 'pago' | 'deduccion';

/** Cómo trata el motor de cálculo un código de concepto. */
export type ClaseConcepto = 'pago' | 'deduccion';

// ─────────────────────────────────────────────────────────────
// Lectura del PDF
// ─────────────────────────────────────────────────────────────

export interface Fabrica {
  codigo: string; // '04'
  nombre: string; // 'EL VIGIA'
}

export interface CabeceraNomina {
  tipo: TipoNomina;
  reporte: string; // 'Gan0584' | 'Gan0594'
  titulo: string; // 'PAGO DE LECHE FRESCA'
  anio: number; // 2026
  numero: number; // 23  (la "semana ganadera")
  fechaIni: string; // '2026-06-03'  ISO
  fechaFin: string; // '2026-06-09'
}

export interface ConceptoLeido {
  codigo: string; // '0003'
  centimos: number; // 75208824
  columna: ColumnaMonto; // banda del PDF donde apareció
}

export interface LitrosDia {
  fecha: string; // '2026-06-06' ISO
  litros: number;
}

export interface RegistroLeido {
  /** Nombre tal como viene en el PDF (puede estar truncado a ~30 caracteres). */
  nombre: string;
  ruta: string; // '0300' (leche) | '000569' (transporte)
  /** Código de proveedor: la columna "Gan" en leche, la ruta en transporte. */
  codigo: string;
  fabricaCod: string;
  fabricaNom: string;
  cedula: string | null; // 'V-17771173'
  rif: string | null; // 'J295290535'
  banco: string | null;
  cuenta: string | null;
  litrosTotal: number | null;
  litrosDia: LitrosDia[];
  /**
   * Litros transferidos entre fábricas/compañías (columna "Transf." de
   * GAN0594). Solo algunas rutas de transporte la traen, y cuando aparece
   * suele ser porque esa ruta no tiene tabla de litros por día — ver el
   * repliegue a `litrosTotal` al final de `parseNomina()`.
   */
  litrosTransf: number | null;
  conceptos: ConceptoLeido[];
  /** Totales tal como los declara el PDF; sirven para validar lo calculado. */
  brutoPdf: number | null;
  deduccionPdf: number | null;
  netoPdf: number | null;
  pagina: number;
}

export interface TotalesDeclarados {
  bruto: number | null;
  deduccion: number | null;
  neto: number | null;
}

export interface TotalFabrica extends TotalesDeclarados {
  fabricaCod: string;
  fabricaNom: string;
  pagina: number;
}

export interface NominaLeida {
  cabecera: CabeceraNomina;
  registros: RegistroLeido[];
  totalesFabrica: TotalFabrica[];
  /** El "Total General:" del final del reporte. Null si el PDF no lo trae. */
  totalGeneral: TotalesDeclarados | null;
  fabricas: Fabrica[];
  paginas: number;
}

// ─────────────────────────────────────────────────────────────
// Validación
// ─────────────────────────────────────────────────────────────

export type NivelValidacion = 'ok' | 'aviso' | 'error';

export interface Hallazgo {
  nivel: NivelValidacion;
  codigo: string; // identificador estable de la regla, p.ej. 'bruto-no-cuadra'
  mensaje: string;
  esperado?: string;
  obtenido?: string;
}

export interface ValidacionRegistro {
  nivel: NivelValidacion;
  hallazgos: Hallazgo[];
}

export interface ValidacionNomina {
  nivel: NivelValidacion;
  /** Hallazgos que afectan a la nómina entera (cuadre del Total General, etc.). */
  hallazgos: Hallazgo[];
  /** Índice del registro dentro de `NominaLeida.registros` -> su validación. */
  porRegistro: ValidacionRegistro[];
  /** Códigos de concepto vistos en el PDF que no están en el catálogo. */
  codigosSinClasificar: string[];
  resumen: {
    registros: number;
    ok: number;
    avisos: number;
    errores: number;
  };
}

// ─────────────────────────────────────────────────────────────
// Catálogo de conceptos (configurable por el administrador)
// ─────────────────────────────────────────────────────────────

export interface ConceptoCatalogo {
  codigo: string; // '0051'
  nombre: string; // 'Insumos Ganaderos'
  clase: ClaseConcepto;
  /**
   * Si es `true`, este concepto se descuenta del TOTAL A FACTURAR.
   * El ISLR es `false`: es una retención, el proveedor factura el monto
   * completo y la empresa se lo retiene.
   */
  restaFacturacion: boolean;
  /** `false` mientras el administrador no lo haya revisado. Bloquea el guardado. */
  clasificado: boolean;
}

// ─────────────────────────────────────────────────────────────
// Cálculo
// ─────────────────────────────────────────────────────────────

/**
 * Concepto añadido a mano. Por defecto es informativo (`efecto: null`): no
 * altera ningún total. Si `efecto` es 'suma' o 'resta', ajusta el neto a
 * pagar y el total a facturar (nunca el bruto ni las deducciones, que
 * siempre reflejan solo lo impreso en el PDF).
 */
export interface ConceptoManual {
  id: string;
  codigo: string;
  nombre: string;
  centimos: number;
  litros: number | null; // informativo
  efecto: 'suma' | 'resta' | null;
}

export type FechaCalculoNd = 'factura' | 'nota';

export interface ParametrosNotaDebito {
  /** Precio de la leche en dólares por litro. */
  precioUsd: number;
  fechaFactura: string; // ISO
  fechaNota: string; // ISO
  /** Cuál de las dos fechas se usa para buscar la tasa del BCV. */
  fechaCalculo: FechaCalculoNd;
}

export interface NotaDebitoCalculada {
  aplica: true;
  /** Ausente o 'calculado' = por tasas BCV (de siempre); 'importado' = viene
   * de un Excel externo y reemplaza el cálculo (ver NotaDebitoImportada). */
  origen?: 'calculado' | 'importado';
  precioUsd: number;
  litrosBase: number;
  fechaFactura: string;
  fechaNota: string;
  fechaCalculo: FechaCalculoNd;
  /** Fecha efectivamente usada para la tasa final. */
  fechaTasaFin: string;
  fechaTasaIni: string; // = inicio de la semana ganadera
  tasaIni: number;
  tasaFin: number;
  diferenciaTasa: number; // tasaFin - tasaIni  (positiva si la tasa subió)
  montoUsd: number;
  centimos: number;
  /** Solo en las importadas: los datos del Excel para la tabla "A Modo
   * Informativo" de la nota de débito (no participan en ningún cálculo). */
  informativo?: InformativoNdImportada;
}

/** Datos de una fila del Excel de ND, tal como los muestra el Excel. */
export interface InformativoNdImportada {
  codigo: string;
  tipo: TipoNomina;
  litros: number | null;
  /** $/Lts (leche) o $/Flete (transporte). */
  precioUsd: number | null;
  bsXLtsInicio: number | null;
  bsXLtsAjustado: number | null;
}

/** ND importada ya emparejada, lista para reemplazar el cálculo por tasas. */
export interface NdImportadaResumen {
  centimos: number;
  fechaNota: string;
  informativo?: Omit<InformativoNdImportada, 'codigo'>;
}

export interface NotaDebitoNoCalculable {
  aplica: false;
  motivo: string;
  fechasFaltantes: string[];
}

export type ResultadoNotaDebito = NotaDebitoCalculada | NotaDebitoNoCalculable;

/**
 * Nota de débito de un comprobante combinado (leche + flete): cada lado
 * calcula la suya de forma independiente —puede tener su propio
 * litros/precio/fechas— y se muestra un único monto sumado.
 */
export interface NotaDebitoCombinada {
  aplica: boolean;
  /** Suma de los `centimos` de los lados con `aplica: true`. */
  centimos: number;
  leche: ResultadoNotaDebito | null;
  transporte: ResultadoNotaDebito | null;
}

export interface LineaConcepto {
  codigo: string;
  nombre: string;
  clase: ClaseConcepto;
  restaFacturacion: boolean;
  centimos: number;
  /** Solo se usa en comprobantes combinados, para etiquetar de dónde vino. */
  origen?: 'leche' | 'flete';
  /** Solo se usa en comprobantes agrupados (mismo tipo), para etiquetar de
   * qué código vino la línea. Independiente de `origen`. */
  origenCodigo?: string;
}

/**
 * Nota de débito de un comprobante agrupado (2+ códigos del mismo tipo):
 * cada código calcula la suya de forma independiente y se muestra un único
 * monto sumado, con el desglose por código disponible aparte.
 */
export interface NotaDebitoAgrupada {
  aplica: boolean;
  /** Suma de los `centimos` de los códigos con `aplica: true`. */
  centimos: number;
  porCodigo: Array<{ codigo: string; resultado: ResultadoNotaDebito | null }>;
}

export interface RegistroCalculado {
  registro: RegistroLeido;
  lineas: LineaConcepto[];
  bruto: number;
  deducciones: number;
  neto: number;
  /** Bruto menos las deducciones marcadas con `restaFacturacion`. */
  totalFacturar: number;
  manuales: ConceptoManual[];
  notaDebito: ResultadoNotaDebito | null;
  validacion: ValidacionRegistro;
}

// ─────────────────────────────────────────────────────────────
// Empresas y su asignación por fábrica
// ─────────────────────────────────────────────────────────────

export interface Empresa {
  id: string;
  razonSocial: string;
  rif: string;
  direccionFiscal: string;
  telefono: string;
  email: string;
  /** Imagen en data-URI. */
  logo: string | null;
}

/**
 * Qué empresa encabeza el comprobante según la fábrica que traiga el PDF.
 * Ej: '04' -> empresa A, '26' -> empresa A, '08' -> empresa B.
 */
export interface AsignacionFabrica {
  fabricaCod: string;
  fabricaNom: string;
  empresaId: string | null;
}

// ─────────────────────────────────────────────────────────────
// Usuarios, permisos y bitácora
// ─────────────────────────────────────────────────────────────

export type Rol = 'admin' | 'normal';

export interface Usuario {
  id: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  /** Obliga a definir contraseña propia en el siguiente inicio de sesión. */
  debeCambiar: boolean;
  intentosFallidos: number;
  /** ISO. Mientras no se alcance, el inicio de sesión está frenado. */
  bloqueadoHasta: string | null;
  creadoEn: string;
  ultimoAcceso: string | null;
}

/** Lo mínimo que la bitácora necesita para atribuir una acción. */
export type Autor = Pick<Usuario, 'id' | 'nombre'>;

export type Permiso =
  | 'cargar-nomina'
  | 'consultar'
  | 'generar-comprobante'
  | 'concepto-manual'
  | 'nota-debito'
  | 'cargar-tasas'
  | 'exportar'
  | 'importar'
  | 'editar-nombres'
  | 'ver-bitacora'
  | 'clasificar-conceptos'
  | 'borrar'
  | 'gestionar-usuarios'
  | 'editar-empresas'
  | 'restaurar-respaldo'
  | 'vincular-proveedor';

export interface EntradaBitacora {
  id: number;
  ts: string; // ISO
  usuarioId: string;
  usuarioNombre: string;
  accion: string;
  entidad: string;
  entidadId: string;
  detalle: string; // JSON serializado
  hashPrev: string;
  hash: string;
}

export interface VerificacionBitacora {
  intacta: boolean;
  entradas: number;
  /** Id de la primera entrada cuya cadena no cuadra. */
  rotaEn: number | null;
  mensaje: string;
}

// ─────────────────────────────────────────────────────────────
// Tasas del BCV
// ─────────────────────────────────────────────────────────────

export interface TasaBcv {
  fecha: string; // ISO
  tasa: number; // Bs por dólar
}

// ─────────────────────────────────────────────────────────────
// Notas de débito importadas de Excel
// ─────────────────────────────────────────────────────────────

/**
 * Fila de un Excel externo con la ND ya calculada, ya persistida (emparejada
 * a un registro cargado, o pendiente de emparejar a mano). Cuando queda
 * emparejada, su `centimos` reemplaza por completo el cálculo automático por
 * tasas BCV para ese registro (ver `resolverNotaDebito` en calcular.ts).
 */
export interface NotaDebitoImportada {
  id: string;
  nominaId: string;
  /** null mientras esté pendiente de emparejar a mano. */
  registroId: string | null;
  tipo: TipoNomina;
  /** Código tal como vino en el Excel (sin normalizar), p.ej. "9119". */
  codigoExcel: string;
  proveedorExcel: string;
  fabricaExcel: string | null;
  sapExcel: string | null;
  fechaNota: string; // ISO
  litrosEnviados: number | null;
  litrosTransportados: number | null;
  precioUsdLts: number | null;
  precioUsdFlete: number | null;
  bsXLtsInicio: number | null;
  bsXLtsAjustado: number | null;
  difXLts: number | null;
  /** "Bs. a Pagar x Dif." del Excel, en céntimos. */
  centimos: number;
  emparejamiento: 'codigo' | 'nombre' | 'manual' | 'pendiente';
}
