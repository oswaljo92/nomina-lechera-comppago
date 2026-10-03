/**
 * Prueba del núcleo: base de datos, usuarios y contraseñas, permisos, carga de
 * nóminas, cálculos y bitácora encadenada.
 *
 *   npm run test:core
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import { BaseDatos } from '../src/core/db/basedatos.ts';
import { verificarBitacora, contarBitacora, leerBitacora } from '../src/core/db/bitacora.ts';
import * as repo from '../src/core/db/repo.ts';
import {
  cambiarActivo,
  cambiarPropiaContrasena,
  cambiarRol,
  comprobarCredenciales,
  contarAdministradores,
  crearUsuario,
  eliminarUsuario,
  hayUsuarios,
  listarUsuarios,
  restablecerContrasena,
  sugerirTemporal,
  validarContrasena,
} from '../src/core/auth/usuarios.ts';
import { puede } from '../src/core/auth/permisos.ts';
import { paginasDesdePdf, type DocumentoPdf } from '../src/core/parser/desdePdfjs.ts';
import { parseNomina } from '../src/core/parser/parseNomina.ts';
import {
  calcularNotaDebito,
  calcularRegistro,
  resolverNotaDebito,
  bsAUsd,
  usdABs,
} from '../src/core/calc/calcular.ts';
import { construirComprobanteAgrupado } from '../src/core/receipt/comprobanteAgrupado.ts';
import { construirComprobante, type ContextoComprobante } from '../src/core/receipt/comprobante.ts';
import { decimalesDeFormato, normalizarCodigo, redondearComoExcel } from '../src/core/db/notaDebitoExcel.ts';
import { datosConNdPorSap, gruposNdPorSap } from '../src/core/receipt/notaDebitoSap.ts';
import { dibujarNotaDebito, OPCIONES_DIBUJO } from '../src/core/receipt/dibujo.ts';
import { validarAtajo, textoAtajo } from '../src/ui/util/atajosReglas.ts';
import type { NotaDebitoImportada } from '../src/core/types.ts';
import { sha256DeBytes } from '../src/core/auth/hash.ts';
import {
  formatearBs,
  formatearDecimal,
  semanaGanaderaDe,
  semanasGanaderasDelAnio,
} from '../src/core/parser/numeros.ts';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const V = '\x1b[32m';
const R = '\x1b[31m';
const G = '\x1b[90m';
const N = '\x1b[0m';
const B = '\x1b[1m';

let fallos = 0;
function ok(condicion: boolean, titulo: string, detalle = ''): void {
  if (condicion) {
    console.log(`  ${V}✔${N} ${titulo}${detalle ? `  ${G}${detalle}${N}` : ''}`);
  } else {
    console.log(`  ${R}✘ ${titulo}${detalle ? `  ${detalle}` : ''}${N}`);
    fallos++;
  }
}

async function esperaError(fn: () => Promise<unknown>, titulo: string): Promise<void> {
  try {
    await fn();
    ok(false, titulo, 'no lanzó error');
  } catch (e) {
    ok(true, titulo, (e as Error).message);
  }
}

const localizarWasm = (archivo: string) => path.join(raiz, 'node_modules/sql.js/dist/', archivo);

// ═══ Base de datos y esquema ═══
console.log(`\n${B}Base de datos${N}`);
const db = await BaseDatos.abrir(localizarWasm, null);
ok(db.valorMeta('version_esquema') === '2', 'Esquema creado en versión 2');
ok(!db.desactualizada, 'Una base nueva no se marca como desactualizada');
ok(repo.listarCatalogo(db).length === 8, 'Catálogo sembrado', `${repo.listarCatalogo(db).length} conceptos`);
const c0999 = repo.listarCatalogo(db).find((c) => c.codigo === '0999');
ok(c0999 !== undefined && !c0999.clasificado, 'El 0999 se siembra SIN clasificar');
const cIslr = repo.listarCatalogo(db).find((c) => c.codigo === '0487');
ok(cIslr !== undefined && !cIslr.restaFacturacion, 'El ISLR no resta del Total a Facturar');

// ═══ Usuarios y contraseñas ═══
console.log(`\n${B}Usuarios y contraseñas${N}`);
ok(!hayUsuarios(db), 'Al inicio no hay ningún usuario');
ok(validarContrasena('corta') !== null, 'Rechaza una contraseña demasiado corta');
ok(validarContrasena('solamenteletras') !== null, 'Rechaza una contraseña sin números');
ok(validarContrasena('Ganadera2026') === null, 'Acepta una contraseña válida');

const admin = await crearUsuario(db, null, {
  nombre: 'Oswaldo',
  rol: 'admin',
  contrasena: 'Ganadera2026',
});
ok(hayUsuarios(db) && admin.rol === 'admin', 'Primer administrador creado');
ok(
  db.escalar("SELECT COUNT(*) FROM usuarios WHERE hash = 'Ganadera2026'") === 0,
  'La contraseña NO se guarda en claro',
);
await esperaError(
  () => crearUsuario(db, admin, { nombre: 'oswaldo', rol: 'normal', contrasena: 'Otra2026aa' }),
  'Rechaza nombres repetidos sin distinguir mayúsculas',
);

const colega = await crearUsuario(db, admin, {
  nombre: 'Colega',
  rol: 'normal',
  contrasena: 'Temporal2026',
  debeCambiar: true,
});
ok(listarUsuarios(db).length === 2, 'Dos usuarios registrados');
ok(colega.debeCambiar, 'El usuario creado debe cambiar su contraseña al entrar');

// ═══ Inicio de sesión ═══
console.log(`\n${B}Inicio de sesión${N}`);
const bien = await comprobarCredenciales(db, admin.id, 'Ganadera2026');
ok(bien.ok, 'Entra con la contraseña correcta');
ok(bien.ok && bien.usuario.ultimoAcceso !== null, 'Registra el último acceso');

const mal = await comprobarCredenciales(db, admin.id, 'Incorrecta1');
ok(!mal.ok, 'Rechaza la contraseña incorrecta', mal.ok ? '' : mal.motivo);

// Cada quien tiene su propia contraseña: la de uno no abre la cuenta del otro.
const cruzada = await comprobarCredenciales(db, colega.id, 'Ganadera2026');
ok(!cruzada.ok, 'La contraseña de un usuario NO sirve para otro');

// El freno por intentos fallidos vive en la base, no en memoria.
for (let i = 0; i < 5; i++) await comprobarCredenciales(db, colega.id, 'malamala1');
const frenado = await comprobarCredenciales(db, colega.id, 'malamala1');
ok(!frenado.ok, 'Tras varios fallos se frena el acceso', frenado.ok ? '' : frenado.motivo);
const bloqueado = listarUsuarios(db).find((u) => u.id === colega.id)!;
ok(bloqueado.bloqueadoHasta !== null, 'El bloqueo queda guardado en la base de datos');
const recargada = await BaseDatos.abrir(localizarWasm, db.exportar());
const trasRecargar = listarUsuarios(recargada).find((u) => u.id === colega.id)!;
ok(trasRecargar.bloqueadoHasta !== null, 'Recargar la aplicación NO esquiva el bloqueo');

// Se libera el freno para continuar con el resto de la prueba.
db.correr('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?', [
  colega.id,
]);
const recuperado = await comprobarCredenciales(db, colega.id, 'Temporal2026');
ok(recuperado.ok, 'Con la contraseña correcta vuelve a entrar');
ok(recuperado.ok && recuperado.usuario.debeCambiar, 'Se le exige definir contraseña propia');

await cambiarPropiaContrasena(db, colega, 'Temporal2026', 'Propia2026x');
const yaCambiada = listarUsuarios(db).find((u) => u.id === colega.id)!;
ok(!yaCambiada.debeCambiar, 'Tras cambiarla ya no se le exige');
ok((await comprobarCredenciales(db, colega.id, 'Propia2026x')).ok, 'La contraseña nueva funciona');
ok(!(await comprobarCredenciales(db, colega.id, 'Temporal2026')).ok, 'La temporal ya no funciona');
await esperaError(
  () => cambiarPropiaContrasena(db, colega, 'Incorrecta9', 'Otra2026aa'),
  'No cambia la contraseña sin la actual correcta',
);

// ═══ Permisos ═══
console.log(`\n${B}Permisos${N}`);
ok(puede(colega, 'cargar-nomina'), 'Usuario normal PUEDE cargar nóminas');
ok(puede(colega, 'generar-comprobante'), 'Usuario normal PUEDE generar comprobantes');
ok(puede(colega, 'exportar') && puede(colega, 'importar'), 'Usuario normal PUEDE exportar e importar');
ok(!puede(colega, 'borrar'), 'Usuario normal NO puede borrar');
ok(!puede(colega, 'gestionar-usuarios'), 'Usuario normal NO puede gestionar usuarios');
ok(!puede(colega, 'editar-empresas'), 'Usuario normal NO puede editar empresas');
ok(!puede(colega, 'clasificar-conceptos'), 'Usuario normal NO puede clasificar conceptos');
ok(puede(admin, 'borrar') && puede(admin, 'gestionar-usuarios'), 'El administrador sí puede todo eso');

// ═══ Protección del último administrador ═══
// Sin código de recuperación, quedarse sin administradores sería irreversible.
console.log(`\n${B}Protección del último administrador${N}`);
ok(contarAdministradores(db) === 1, 'Solo hay un administrador');
await esperaError(() => eliminarUsuario(db, admin, admin.id), 'No deja eliminarse a sí mismo');
await esperaError(
  () => cambiarRol(db, colega, admin.id, 'normal'),
  'No deja degradar al único administrador',
);
await esperaError(
  () => cambiarActivo(db, colega, admin.id, false),
  'No deja desactivar al único administrador',
);

const admin2 = await crearUsuario(db, admin, {
  nombre: 'Segundo Admin',
  rol: 'admin',
  contrasena: 'Respaldo2026',
});
ok(contarAdministradores(db) === 2, 'Con un segundo administrador ya son dos');
await cambiarRol(db, admin2, admin.id, 'normal');
ok(contarAdministradores(db) === 1, 'Ahora sí se puede degradar al primero');
await cambiarRol(db, admin2, admin.id, 'admin');

const temporal = sugerirTemporal();
await restablecerContrasena(db, admin, colega.id, temporal);
const restablecido = await comprobarCredenciales(db, colega.id, temporal);
ok(restablecido.ok, 'Un administrador puede restablecer la contraseña de otro');
ok(restablecido.ok && restablecido.usuario.debeCambiar, 'La restablecida obliga a cambiarla');

await cambiarActivo(db, admin, colega.id, false);
const desactivado = await comprobarCredenciales(db, colega.id, temporal);
ok(!desactivado.ok, 'Un usuario desactivado no puede entrar', desactivado.ok ? '' : desactivado.motivo);
await cambiarActivo(db, admin, colega.id, true);

// ═══ Empresas por fábrica ═══
console.log(`\n${B}Empresas asignadas por fábrica${N}`);
const empresaA = await repo.guardarEmpresa(db, admin, {
  razonSocial: 'EMPRESA UNO, C.A.',
  rif: 'J-12345678-9',
  direccionFiscal: 'Av. Principal, El Vigía, Mérida',
  telefono: '',
  email: '',
  logo: null,
});
const empresaB = await repo.guardarEmpresa(db, admin, {
  razonSocial: 'EMPRESA DOS, C.A.',
  rif: 'J-98765432-1',
  direccionFiscal: 'Zona Industrial, Quenaca',
  telefono: '',
  email: '',
  logo: null,
});
ok(repo.listarEmpresas(db).length === 2, 'Dos empresas registradas');

// ═══ Carga de las nóminas reales ═══
console.log(`\n${B}Carga de nóminas${N}`);
async function cargar(archivo: string): Promise<string> {
  const bytes = new Uint8Array(fs.readFileSync(path.join(raiz, 'fixtures', archivo)));
  // pdf.js se APROPIA del ArrayBuffer que recibe, así que el hash se calcula
  // antes y a getDocument se le entrega siempre una copia.
  const sha = await sha256DeBytes(bytes);
  const doc = (await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
    .promise) as unknown as DocumentoPdf;
  const nomina = parseNomina(await paginasDesdePdf(doc));
  repo.sembrarConceptosDesconocidos(db, nomina);
  await repo.guardarConcepto(db, admin, {
    codigo: '0999',
    nombre: 'Ajuste',
    clase: 'deduccion',
    restaFacturacion: true,
    clasificado: true,
  });
  return repo.guardarNomina(db, admin, nomina, archivo, sha, repo.catalogoMapa(db));
}

const idLeche = await cargar('GAN0584_3.pdf');
const idTransporte = await cargar('GAN0594_3.pdf');
const nominas = repo.listarNominas(db);
ok(nominas.length === 2, 'Dos nóminas guardadas');

const leche = nominas.find((n) => n.tipo === 'leche')!;
ok(leche.registros === 76, 'Nómina de leche con 76 proveedores', `${leche.registros}`);
ok(leche.bruto === 36977618791, 'Bruto de leche persistido exacto', formatearBs(leche.bruto));
ok(leche.neto === 36884196434, 'Neto de leche persistido exacto', formatearBs(leche.neto));
ok(leche.usuarioNombre === 'Oswaldo', 'La nómina queda atribuida a quien la cargó');

const transporte = nominas.find((n) => n.tipo === 'transporte')!;
ok(transporte.registros === 16, 'Nómina de transporte con 16 rutas', `${transporte.registros}`);

await esperaError(
  () => cargar('GAN0584_3.pdf'),
  'Rechaza cargar dos veces la misma nómina (tipo, año, número)',
);

const fabricas = repo.listarFabricas(db);
ok(
  fabricas.length === 3,
  'Tres fábricas detectadas',
  fabricas.map((f) => `${f.fabricaCod} ${f.fabricaNom}`).join(' · '),
);
await repo.asignarEmpresaAFabrica(db, admin, '04', empresaA.id);
await repo.asignarEmpresaAFabrica(db, admin, '26', empresaA.id);
await repo.asignarEmpresaAFabrica(db, admin, '08', empresaB.id);
ok(repo.empresaDeFabrica(db, '04')?.id === empresaA.id, 'EL VIGIA (04) → Empresa Uno');
ok(repo.empresaDeFabrica(db, '26')?.id === empresaA.id, 'BARINAS (26) → Empresa Uno');
ok(repo.empresaDeFabrica(db, '08')?.id === empresaB.id, 'QUENACA (08) → Empresa Dos');

// ═══ Total a Facturar ═══
console.log(`\n${B}Total a Facturar${N}`);
const registrosLeche = repo.registrosDeNomina(db, idLeche);
const prolamar = registrosLeche.find((r) => r.leido.codigo === '008351')!;
ok(prolamar.bruto === 3676728753, 'PROLAMAR bruto', formatearBs(prolamar.bruto));
ok(prolamar.neto === 3674472488, 'PROLAMAR neto a pagar', formatearBs(prolamar.neto));
ok(
  prolamar.totalFacturar === 3676728753,
  'PROLAMAR total a facturar = bruto (el ISLR no resta)',
  formatearBs(prolamar.totalFacturar),
);

const grippi = registrosLeche.find((r) => r.leido.codigo === '000627')!;
ok(grippi.bruto === 20446370, 'GRIPPI bruto', formatearBs(grippi.bruto));
ok(grippi.neto === 12027914, 'GRIPPI neto a pagar', formatearBs(grippi.neto));
ok(
  grippi.totalFacturar === 12027914,
  'GRIPPI total a facturar (0051 y 0999 sí restan)',
  formatearBs(grippi.totalFacturar),
);

const enQuenaca = registrosLeche.find((r) => r.leido.fabricaCod === '08');
ok(
  enQuenaca !== undefined &&
    repo.empresaDeFabrica(db, enQuenaca.leido.fabricaCod)?.razonSocial === 'EMPRESA DOS, C.A.',
  'Un proveedor de QUENACA encabeza con la Empresa Dos',
  enQuenaca?.leido.nombre,
);

// ═══ Semana ganadera por calendario ═══
console.log(`\n${B}Semana ganadera por calendario${N}`);
{
  // Regresión: la primera versión devolvía siempre las fechas de la semana 1
  // del año (nunca avanzaba el inicio de semana según el número calculado).
  const s31 = semanaGanaderaDe('2026-07-30'); // dentro de semana 31, según nóminas reales
  ok(s31.numero === 31 && s31.anio === 2026, 'Semana 31/2026 calculada correctamente', JSON.stringify(s31));
  ok(s31.fechaIni === '2026-07-29' && s31.fechaFin === '2026-08-04', 'Con las fechas correctas (no las de la semana 1)', JSON.stringify(s31));

  const s32 = semanaGanaderaDe('2026-08-05');
  ok(
    s32.numero === 32 && s32.fechaIni === '2026-08-05' && s32.fechaFin === '2026-08-11',
    'Semana 32/2026 (miércoles exacto) calculada correctamente',
    JSON.stringify(s32),
  );

  // Semana 1 = la que contiene el 1° de enero, aunque empiece en diciembre del año anterior.
  const s1 = semanaGanaderaDe('2026-01-01');
  ok(s1.anio === 2026 && s1.numero === 1, 'Semana 1/2026 contiene el 1° de enero', JSON.stringify(s1));

  const todas2026 = semanasGanaderasDelAnio(2026);
  ok(todas2026.length === 52 || todas2026.length === 53, 'El año tiene 52 o 53 semanas', String(todas2026.length));
  const numerosUnicos = new Set(todas2026.map((s) => s.numero));
  ok(numerosUnicos.size === todas2026.length, 'Sin números de semana repetidos');
  const fechasUnicas = new Set(todas2026.map((s) => s.fechaIni));
  ok(fechasUnicas.size === todas2026.length, 'Sin fechas de inicio repetidas (el bug original las repetía todas)');
  ok(
    todas2026.every((s, i) => i === 0 || s.fechaIni > todas2026[i - 1]!.fechaIni),
    'Las semanas quedan en orden estrictamente creciente de fecha',
  );
}

// ═══ Tasas BCV y nota de débito ═══
console.log(`\n${B}Tasas BCV y nota de débito${N}`);
const paramsNd = {
  precioUsd: 2.45,
  fechaFactura: '2026-06-15',
  fechaNota: '2026-06-18',
  fechaCalculo: 'factura' as const,
};

const sinTasas = calcularNotaDebito(paramsNd, 74790, '2026-06-03', new Map());
ok(!sinTasas.aplica, 'Sin tasas cargadas NO calcula', sinTasas.aplica ? '' : sinTasas.motivo);
ok(
  !sinTasas.aplica && sinTasas.fechasFaltantes.length === 2,
  'Informa exactamente qué fechas faltan',
  !sinTasas.aplica ? sinTasas.fechasFaltantes.join(', ') : '',
);

await repo.guardarTasa(db, admin, '2026-06-03', 200);
await repo.guardarTasa(db, admin, '2026-06-15', 210);
await repo.guardarTasa(db, admin, '2026-06-18', 215);

const nd = calcularNotaDebito(paramsNd, 74790, '2026-06-03', repo.tasasMapa(db));
ok(nd.aplica, 'Con tasas cargadas sí calcula');
if (nd.aplica) {
  ok(
    nd.diferenciaTasa === 10,
    'Diferencia de tasa positiva cuando sube',
    `${nd.tasaFin} − ${nd.tasaIni} = ${nd.diferenciaTasa}`,
  );
  ok(nd.centimos === 183235500, 'Monto = 74.790 × 2,45 × 10', `${formatearBs(nd.centimos)} Bs`);
}

const ndPorNota = calcularNotaDebito(
  { ...paramsNd, fechaCalculo: 'nota' },
  74790,
  '2026-06-03',
  repo.tasasMapa(db),
);
ok(
  // 74.790 L × 2,45 $/L × (215 − 200) = 2.748.532,50 Bs -> redondeado
  // hacia arriba al bolívar entero: 2.748.533,00 Bs.
  ndPorNota.aplica && ndPorNota.centimos === 274853300,
  'Usando la fecha de nota de débito el monto cambia (redondeado al Bs entero)',
  ndPorNota.aplica ? `${formatearBs(ndPorNota.centimos)} Bs` : '',
);

const tasaIni = repo.tasasMapa(db).get('2026-06-03')!;
ok(
  Math.abs(bsAUsd(490, tasaIni) - 2.45) < 1e-9,
  'Conversión Bs → $ del precio de leche',
  `490 Bs ÷ 200 = ${formatearDecimal(bsAUsd(490, tasaIni))} $`,
);
ok(
  Math.abs(usdABs(2.45, tasaIni) - 490) < 1e-9,
  'Conversión $ → Bs del precio de leche',
  `2,45 $ × 200 = ${formatearDecimal(usdABs(2.45, tasaIni))} Bs`,
);

// ═══ Conceptos manuales: informativos ═══
console.log(`\n${B}Conceptos manuales${N}`);
await repo.agregarConceptoManual(db, admin, [prolamar.id], {
  codigo: 'M01',
  nombre: 'Ajuste de calidad',
  centimos: 5000000,
  litros: 500,
  efecto: null,
});
const prolamar2 = repo.registrosDeNomina(db, idLeche).find((r) => r.id === prolamar.id)!;
ok(prolamar2.manuales.length === 1, 'Concepto manual guardado');
const recalculo = calcularRegistro(prolamar2.leido, repo.catalogoMapa(db), prolamar2.manuales, null);
ok(recalculo.bruto === prolamar.bruto, 'El concepto manual NO altera el bruto');
ok(recalculo.neto === prolamar.neto, 'El concepto manual NO altera el neto a pagar');
ok(recalculo.totalFacturar === prolamar.totalFacturar, 'El concepto manual NO altera el total a facturar');
ok(recalculo.manuales.length === 1, 'Pero sí aparece en el comprobante');

// ═══ Conceptos manuales: con efecto (suma/resta), editar y eliminar ═══
const manualId = prolamar2.manuales[0]!.id;
await repo.agregarConceptoManual(db, admin, [prolamar.id], {
  codigo: '0090',
  nombre: 'Faltante',
  centimos: 200000,
  litros: 30,
  efecto: 'resta',
});
const prolamar3 = repo.registrosDeNomina(db, idLeche).find((r) => r.id === prolamar.id)!;
const recalculo2 = calcularRegistro(prolamar3.leido, repo.catalogoMapa(db), prolamar3.manuales, null);
ok(recalculo2.neto === prolamar.neto - 200000, 'Con efecto "resta" SÍ baja el neto a pagar');
ok(
  recalculo2.totalFacturar === prolamar.totalFacturar - 200000,
  'Con efecto "resta" SÍ baja el total a facturar',
);
ok(recalculo2.bruto === prolamar.bruto, 'Pero el bruto sigue intacto');

await repo.editarConceptoManual(db, admin, manualId, {
  codigo: 'M01',
  nombre: 'Ajuste de calidad',
  centimos: 5000000,
  litros: 500,
  efecto: 'suma',
});
const prolamar4 = repo.registrosDeNomina(db, idLeche).find((r) => r.id === prolamar.id)!;
const editado = prolamar4.manuales.find((m) => m.id === manualId)!;
ok(editado.efecto === 'suma', 'editarConceptoManual actualiza el efecto');
const recalculo3 = calcularRegistro(prolamar4.leido, repo.catalogoMapa(db), prolamar4.manuales, null);
ok(
  recalculo3.neto === prolamar.neto + 5000000 - 200000,
  'El neto refleja la suma editada y la resta del otro concepto',
);

await repo.eliminarConceptoManual(db, admin, manualId);
const prolamar5 = repo.registrosDeNomina(db, idLeche).find((r) => r.id === prolamar.id)!;
ok(prolamar5.manuales.length === 1, 'eliminarConceptoManual quita solo ese concepto');

// ═══ Bitácora encadenada ═══
console.log(`\n${B}Bitácora encadenada${N}`);
const total = contarBitacora(db);
ok(total > 20, 'La bitácora acumuló entradas', `${total} entradas`);
const v1 = await verificarBitacora(db);
ok(v1.intacta, 'Cadena íntegra', v1.mensaje);

const acciones = new Set(leerBitacora(db, 1000).map((e) => e.accion));
ok(acciones.has('iniciar-sesion'), 'Registra los inicios de sesión');
ok(acciones.has('acceso-fallido'), 'Registra los intentos fallidos');
ok(acciones.has('cambiar-contrasena'), 'Registra los cambios de contraseña');
ok(acciones.has('restablecer-contrasena'), 'Registra los restablecimientos');
ok(acciones.has('cambiar-rol'), 'Registra los cambios de rol');
ok(acciones.has('cargar-nomina'), 'Registra la carga de nóminas');
ok(acciones.has('crear-usuario'), 'Registra la creación de usuarios');
ok(acciones.has('cargar-tasa'), 'Registra la carga de tasas');

// Cada manipulación se prueba sobre una copia limpia, para que un ataque no
// enmascare al siguiente y cada detección sea concluyente por sí sola.
const respaldoIntegro = db.exportar();

const dbAlterada = await BaseDatos.abrir(localizarWasm, respaldoIntegro);
dbAlterada.correr('UPDATE bitacora SET detalle = \'{"alterado":true}\' WHERE id = 3');
const v2 = await verificarBitacora(dbAlterada);
ok(!v2.intacta && v2.rotaEn === 3, 'Detecta una entrada MODIFICADA', v2.mensaje);

const dbBorrada = await BaseDatos.abrir(localizarWasm, respaldoIntegro);
dbBorrada.correr('DELETE FROM bitacora WHERE id = 5');
const v3 = await verificarBitacora(dbBorrada);
ok(!v3.intacta && v3.rotaEn === 6, 'Detecta una entrada BORRADA por el medio', v3.mensaje);

const dbTruncada = await BaseDatos.abrir(localizarWasm, respaldoIntegro);
dbTruncada.correr('DELETE FROM bitacora WHERE id >= ?', [total - 1]);
const v4 = await verificarBitacora(dbTruncada);
ok(!v4.intacta, 'Detecta una bitácora TRUNCADA por el final', v4.mensaje);

const dbVaciada = await BaseDatos.abrir(localizarWasm, respaldoIntegro);
dbVaciada.correr('DELETE FROM bitacora');
const v5 = await verificarBitacora(dbVaciada);
ok(!v5.intacta, 'Detecta una bitácora BORRADA COMPLETA', v5.mensaje);

const v6 = await verificarBitacora(db);
ok(v6.intacta, 'La base original sigue íntegra tras las pruebas');

// ═══ Persistencia ═══
console.log(`\n${B}Persistencia${N}`);
const bytes = db.exportar();
ok(bytes.length > 0, 'La base se exporta a bytes', `${(bytes.length / 1024).toFixed(0)} KB`);
ok(
  String.fromCharCode(...bytes.slice(0, 15)) === 'SQLite format 3',
  'El archivo es un SQLite estándar, legible por cualquier herramienta',
);
const db2 = await BaseDatos.abrir(localizarWasm, bytes);
ok(repo.listarNominas(db2).length === 2, 'Al reabrir conserva las nóminas');
ok(listarUsuarios(db2).length === 3, 'Al reabrir conserva los usuarios');
ok(
  (await comprobarCredenciales(db2, admin.id, 'Ganadera2026')).ok,
  'Al reabrir las contraseñas siguen funcionando',
);

// ═══ Base de una versión anterior ═══
console.log(`\n${B}Base de una versión anterior${N}`);
const dbVieja = await BaseDatos.abrir(localizarWasm, null);
dbVieja.fijarMeta('version_esquema', '1');
const reabierta = await BaseDatos.abrir(localizarWasm, dbVieja.exportar());
ok(reabierta.desactualizada, 'Detecta un archivo del modelo anterior');
ok(reabierta.versionArchivo === 1, 'Informa qué versión tenía', String(reabierta.versionArchivo));
ok(reabierta.exportar().length > 0, 'Se puede respaldar antes de reemplazarla');

// ═══ Agrupación del mismo tipo ═══
console.log(`\n${B}Agrupación del mismo tipo${N}`);
{
  await repo.confirmarGrupoMismoTipo(db, admin, 'leche', [prolamar.leido.codigo, grippi.leido.codigo]);
  const grupo = repo.grupoDeCodigo(db, 'leche', prolamar.leido.codigo);
  ok(
    grupo !== null && grupo.codigos.length === 2,
    'Agrupa 2 códigos de leche',
    grupo ? grupo.codigos.join(', ') : '',
  );
  ok(grupo?.principal === prolamar.leido.codigo, 'El primero confirmado queda como principal');

  const ctxAgrupado: ContextoComprobante = {
    catalogo: repo.catalogoMapa(db),
    empresaPorFabrica: (cod) => repo.empresaDeFabrica(db, cod),
    nombreCompleto: () => undefined,
    tasas: repo.tasasMapa(db),
    ndImportada: new Map(),
    fechaFactura: leche.fechaFin,
    titulo: 'PAGO DE LECHE FRESCA',
    tipo: 'leche',
    anio: leche.anio,
    numero: leche.numero,
    fechaIni: leche.fechaIni,
    fechaFin: leche.fechaFin,
  };
  const agrupado = construirComprobanteAgrupado(
    [
      { registro: prolamar.leido, manuales: prolamar.manuales, paramsNd: prolamar.notaDebito, ctx: ctxAgrupado },
      { registro: grippi.leido, manuales: grippi.manuales, paramsNd: grippi.notaDebito, ctx: ctxAgrupado },
    ],
    grupo!.principal,
  );
  ok(
    agrupado.bruto === prolamar.bruto + grippi.bruto,
    'El bruto agrupado es la suma de ambos códigos',
    formatearBs(agrupado.bruto),
  );
  ok(
    agrupado.totalFacturar === prolamar.totalFacturar + grippi.totalFacturar,
    'El total a facturar agrupado también suma ambos',
  );
  ok(agrupado.agrupado?.miembros.length === 2, 'Guarda el desglose de ambos códigos miembro');

  const registrosTransporte = repo.registrosDeNomina(db, idTransporte);
  const rutaLibre = registrosTransporte[0]!;
  await esperaError(
    () => repo.confirmarVinculo(db, admin, prolamar.leido.codigo, rutaLibre.leido.codigo, null),
    'No deja vincular cruzado un código ya agrupado (exclusión mutua)',
  );

  await repo.quitarDeGrupoMismoTipo(db, admin, grippi.leido.codigo);
  ok(
    repo.grupoDeCodigo(db, 'leche', prolamar.leido.codigo) === null,
    'Al sacar un miembro de un grupo de 2, se disuelve entero',
  );

  const otroLeche = registrosLeche.find(
    (r) => r.leido.codigo !== prolamar.leido.codigo && r.leido.codigo !== grippi.leido.codigo,
  )!;
  await repo.confirmarVinculo(db, admin, otroLeche.leido.codigo, rutaLibre.leido.codigo, null);
  await esperaError(
    () =>
      repo.confirmarGrupoMismoTipo(db, admin, 'leche', [otroLeche.leido.codigo, grippi.leido.codigo]),
    'No deja agrupar un código ya vinculado cruzado (exclusión mutua)',
  );
  await repo.desvincularProveedor(db, admin, otroLeche.leido.codigo, rutaLibre.leido.codigo);
}

// ═══ Nota de débito importada ═══
console.log(`\n${B}Nota de débito importada${N}`);
{
  ok(normalizarCodigo('9119') === normalizarCodigo('009119'), 'Normaliza ceros a la izquierda');
  ok(normalizarCodigo('569') !== normalizarCodigo('5690'), 'No confunde códigos de distinto valor');
  ok(normalizarCodigo('000000') === '0', 'Un código de puros ceros no rompe (cae a "0")');
  ok(decimalesDeFormato('#,##0') === 0, 'Formato "#,##0" -> 0 decimales');
  ok(decimalesDeFormato('0.000') === 3, 'Formato "0.000" -> 3 decimales');
  ok(decimalesDeFormato('#,##0.000') === 3, 'Formato "#,##0.000" -> 3 decimales');
  ok(decimalesDeFormato('General') === null && decimalesDeFormato(undefined) === null, 'Sin formato -> valor crudo');
  ok(redondearComoExcel(82950.1575100001, 0) === 82950, 'Monto crudo 82950,157 se ve 82.950 (no 82.951)');
  ok(redondearComoExcel(22.577615000000037, 3) === 22.578, 'Dif crudo 22,5776150...04 se ve 22,578');
  ok(redondearComoExcel(1154816.5, 0) === 1154817, 'Mitad redondea hacia arriba como Excel');
  ok(redondearComoExcel(-0.0005, 3) === -0.001, 'Negativos: mitad hacia afuera del cero');

  const tasasVacias = new Map<string, number>();
  const sinImport = new Map<string, { centimos: number; fechaNota: string }>();
  const conImport = new Map([[prolamar.leido.codigo, { centimos: 123456, fechaNota: '2026-08-04' }]]);

  const resultadoSinImport = resolverNotaDebito(
    prolamar.leido.codigo,
    null,
    prolamar.leido.litrosTotal,
    leche.fechaIni,
    tasasVacias,
    sinImport,
  );
  ok(resultadoSinImport === null, 'Sin params ni import, no hay nada que resolver');

  const resultadoImportado = resolverNotaDebito(
    prolamar.leido.codigo,
    null,
    prolamar.leido.litrosTotal,
    leche.fechaIni,
    tasasVacias,
    conImport,
  );
  ok(
    resultadoImportado?.aplica === true && resultadoImportado.centimos === 123456,
    'El import gana aunque no haya params ni tasas configuradas',
  );
  ok(
    resultadoImportado?.aplica === true && resultadoImportado.origen === 'importado',
    'Queda marcado con origen "importado"',
  );

  const ctxImportado: ContextoComprobante = {
    catalogo: repo.catalogoMapa(db),
    empresaPorFabrica: (cod) => repo.empresaDeFabrica(db, cod),
    nombreCompleto: () => undefined,
    tasas: repo.tasasMapa(db),
    ndImportada: conImport,
    fechaFactura: leche.fechaFin,
    titulo: 'PAGO DE LECHE FRESCA',
    tipo: 'leche',
    anio: leche.anio,
    numero: leche.numero,
    fechaIni: leche.fechaIni,
    fechaFin: leche.fechaFin,
  };
  const comprobanteImportado = construirComprobante(
    prolamar.leido,
    prolamar.manuales,
    prolamar.notaDebito,
    ctxImportado,
  );
  ok(
    comprobanteImportado.notaDebito?.aplica === true && comprobanteImportado.notaDebito.centimos === 123456,
    'construirComprobante usa el override importado de punta a punta',
  );
}

// ═══ Nota de débito importada: quitar / restaurar ═══
console.log(`\n${B}Nota de débito importada: quitar y restaurar${N}`);
{
  const filaGuardar = (centimos: number): repo.FilaNdImportadaAGuardar => ({
    nominaId: leche.id,
    registroId: prolamar.id,
    tipo: 'leche',
    codigoExcel: '',
    proveedorExcel: 'PRUEBA QUITAR',
    fabricaExcel: 'VIGIA',
    sapExcel: '9999999',
    fechaNota: '2026-10-01',
    litrosEnviados: 100,
    litrosTransportados: 0,
    precioUsdLts: 0.8,
    precioUsdFlete: null,
    bsXLtsInicio: 1,
    bsXLtsAjustado: 2,
    difXLts: 1,
    centimos,
    emparejamiento: 'nombre',
  });
  await repo.guardarNotasDebitoImportadas(db, admin, leche.id, [filaGuardar(111100)]);
  const vigente = repo.notasDebitoImportadasDeNomina(db, leche.id).find((f) => f.proveedorExcel === 'PRUEBA QUITAR')!;
  ok(repo.ndImportadaMapa(db, leche.id).get(prolamar.leido.codigo)?.centimos === 111100, 'Recién importada, cuenta para la ND');

  await repo.quitarNotaDebitoImportada(db, admin, vigente.id);
  ok(!repo.notasDebitoImportadasDeNomina(db, leche.id).some((f) => f.id === vigente.id), 'Quitada: sale de la lista vigente');
  ok(repo.notasDebitoQuitadasDeNomina(db, leche.id).some((f) => f.id === vigente.id && f.quitadaEn), 'Quitada: aparece en «quitadas» con su fecha');
  ok(!repo.ndImportadaMapa(db, leche.id).has(prolamar.leido.codigo), 'Quitada: ya no cuenta para la ND');

  await repo.restaurarNotaDebitoImportada(db, admin, vigente.id);
  ok(repo.ndImportadaMapa(db, leche.id).get(prolamar.leido.codigo)?.centimos === 111100, 'Restaurada: vuelve a contar tal cual');

  // Reimportar con una quitada pendiente: entra como vigente nueva, y la
  // quitada no se puede restaurar mientras exista otra vigente.
  await repo.quitarNotaDebitoImportada(db, admin, vigente.id);
  await repo.guardarNotasDebitoImportadas(db, admin, leche.id, [filaGuardar(222200)]);
  ok(repo.ndImportadaMapa(db, leche.id).get(prolamar.leido.codigo)?.centimos === 222200, 'Reimportar con una quitada guardada no choca');
  await esperaError(() => repo.restaurarNotaDebitoImportada(db, admin, vigente.id), 'No se restaura si el proveedor ya tiene otra vigente');

  await repo.eliminarNotaDebitoImportada(db, admin, vigente.id);
  ok(!repo.notasDebitoQuitadasDeNomina(db, leche.id).some((f) => f.id === vigente.id), 'Eliminar la borra definitivamente');
  const nueva = repo.notasDebitoImportadasDeNomina(db, leche.id).find((f) => f.proveedorExcel === 'PRUEBA QUITAR')!;
  await repo.eliminarNotaDebitoImportada(db, admin, nueva.id);

  // ── Reimportar REEMPLAZA (no duplica), también las pendientes ──
  const pendiente = (nombre: string): repo.FilaNdImportadaAGuardar => ({
    ...filaGuardar(5000),
    registroId: null,
    proveedorExcel: nombre,
    sapExcel: '8888888',
    emparejamiento: 'pendiente',
  });
  const lote = () => [filaGuardar(333300), pendiente('PENDIENTE UNO'), pendiente('PENDIENTE DOS')];
  const vigentesAntes = repo.notasDebitoImportadasDeNomina(db, leche.id).length;
  await repo.guardarNotasDebitoImportadas(db, admin, leche.id, lote());
  await repo.guardarNotasDebitoImportadas(db, admin, leche.id, lote());
  const r3 = await repo.guardarNotasDebitoImportadas(db, admin, leche.id, lote());
  ok(
    repo.notasDebitoImportadasDeNomina(db, leche.id).length === vigentesAntes + 3,
    'Importar el mismo Excel 3 veces deja las filas una sola vez (pendientes incluidas)',
    String(repo.notasDebitoImportadasDeNomina(db, leche.id).length),
  );
  ok(r3.reemplazadas === vigentesAntes + 3, 'Informa cuántas reemplazó', String(r3.reemplazadas));

  // Emparejo a mano una pendiente y reimporto: el emparejamiento manual se conserva.
  const pend = repo.notasDebitoImportadasDeNomina(db, leche.id).find((f) => f.proveedorExcel === 'PENDIENTE UNO')!;
  await repo.resolverNotaDebitoImportada(db, admin, pend.id, grippi.id);
  const r4 = await repo.guardarNotasDebitoImportadas(db, admin, leche.id, lote());
  const trasReimportar = repo.notasDebitoImportadasDeNomina(db, leche.id).find((f) => f.proveedorExcel === 'PENDIENTE UNO')!;
  ok(
    trasReimportar.registroId === grippi.id && trasReimportar.emparejamiento === 'manual' && r4.manualesConservadas === 1,
    'Reimportar conserva lo que se emparejó a mano',
  );
  ok(
    repo.notasDebitoImportadasDeNomina(db, leche.id).filter((f) => f.proveedorExcel.startsWith('PENDIENTE')).length === 2,
    'Sin duplicados tras conservar el manual',
  );
  for (const f of repo.notasDebitoImportadasDeNomina(db, leche.id)) {
    if (f.proveedorExcel === 'PRUEBA QUITAR' || f.proveedorExcel.startsWith('PENDIENTE')) {
      await repo.eliminarNotaDebitoImportada(db, admin, f.id);
    }
  }
}

// ═══ Nota de débito: mismo SAP + misma fábrica se suman ═══
console.log(`\n${B}Nota de débito: mismo SAP se suma (misma fábrica)${N}`);
{
  const otroLeche = registrosLeche.find(
    (r) => r.leido.codigo !== prolamar.leido.codigo && r.leido.codigo !== grippi.leido.codigo,
  )!;
  const rutaLibre = repo.registrosDeNomina(db, idTransporte)[0]!;

  const filaBase: Omit<NotaDebitoImportada, 'registroId' | 'tipo' | 'centimos' | 'fabricaExcel'> = {
    id: 'ndi_test_1',
    nominaId: leche.id,
    codigoExcel: '',
    proveedorExcel: 'DIAMAGRO',
    sapExcel: '3001137',
    fechaNota: '2026-08-04',
    litrosEnviados: null,
    litrosTransportados: null,
    precioUsdLts: null,
    precioUsdFlete: null,
    bsXLtsInicio: null,
    bsXLtsAjustado: null,
    difXLts: null,
    emparejamiento: 'nombre',
  };
  const filaA: NotaDebitoImportada = {
    ...filaBase,
    id: 'ndi_test_a',
    registroId: prolamar.id,
    tipo: 'leche',
    fabricaExcel: 'VIGIA',
    centimos: 6535600,
  };
  const filaB: NotaDebitoImportada = {
    ...filaBase,
    id: 'ndi_test_b',
    registroId: grippi.id,
    tipo: 'leche',
    fabricaExcel: 'VIGIA',
    centimos: 37845700,
  };
  const filaOtraFabrica: NotaDebitoImportada = {
    ...filaBase,
    id: 'ndi_test_c',
    registroId: otroLeche.id,
    tipo: 'leche',
    sapExcel: '3002290',
    fabricaExcel: 'BARINAS',
    centimos: 1000000,
  };
  const filaMismoSapOtraFabrica: NotaDebitoImportada = {
    ...filaBase,
    id: 'ndi_test_d',
    registroId: rutaLibre.id,
    tipo: 'transporte',
    sapExcel: '3002290',
    fabricaExcel: 'VIGIA',
    centimos: 2000000,
  };

  const grupos = gruposNdPorSap([filaA, filaB, filaOtraFabrica, filaMismoSapOtraFabrica]);
  ok(grupos.get(prolamar.id)?.centimosTotal === 44381300, 'Suma los céntimos de ambas filas tal cual el Excel');
  ok(grupos.get(grippi.id)?.centimosTotal === 44381300, 'El otro miembro del grupo ve el mismo total');
  ok(!grupos.has(otroLeche.id), 'Mismo SAP en otra fábrica no se agrupa con nada (fila sola)');
  ok(!grupos.has(rutaLibre.id), 'Mismo SAP que otroLeche pero distinta fábrica tampoco se agrupa entre sí');

  const registrosPorId = new Map([
    [prolamar.id, prolamar],
    [grippi.id, grippi],
  ]);
  const datosBase = construirComprobante(prolamar.leido, prolamar.manuales, null, {
    catalogo: repo.catalogoMapa(db),
    empresaPorFabrica: (cod) => repo.empresaDeFabrica(db, cod),
    nombreCompleto: () => undefined,
    tasas: repo.tasasMapa(db),
    ndImportada: new Map(),
    fechaFactura: leche.fechaFin,
    titulo: 'PAGO DE LECHE FRESCA',
    tipo: 'leche',
    anio: leche.anio,
    numero: leche.numero,
    fechaIni: leche.fechaIni,
    fechaFin: leche.fechaFin,
  });
  const datosConSap = datosConNdPorSap(datosBase, grupos.get(prolamar.id)!, registrosPorId);
  const textosNd = dibujarNotaDebito(datosConSap, OPCIONES_DIBUJO, (t, tam) => t.length * tam * 0.5)
    .primitivas.flatMap((p) => (p.tipo === 'texto' ? [p.texto] : []));
  ok(
    textosNd.includes('Fecha de Nota de débito 04/08/2026'),
    'La ND sumada por SAP imprime la fecha de nota que trae el Excel',
    JSON.stringify(textosNd.filter((t) => t.includes('Fecha'))),
  );
  ok(datosConSap.notaDebito === null, 'La ND individual se reemplaza por la del grupo');
  ok(datosConSap.notaDebitoAgrupada?.centimos === 44381300, 'El total combinado queda en notaDebitoAgrupada');
  ok(
    datosConSap.notaDebitoAgrupada?.porCodigo.length === 2,
    'Una línea por miembro del grupo',
    String(datosConSap.notaDebitoAgrupada?.porCodigo.length),
  );
  ok(
    Boolean(
      datosConSap.notaDebitoAgrupada?.porCodigo.every(
        (p) => p.resultado?.aplica && p.resultado.origen === 'importado',
      ),
    ),
    'Cada línea queda marcada como importada (no fabrica tasas)',
  );
  ok(
    datosConSap.bruto === datosBase.bruto && datosConSap.litrosTotal === datosBase.litrosTotal,
    'No toca litros/bruto — solo la ND cambia, la factura de cada código sigue separada',
  );

  // Mismo SAP, pero un miembro es leche y el otro transporte (ej. RUBEN
  // DARIO GOMEZ GOMEZ en el Excel real): las líneas se etiquetan Leche/Flete
  // en vez de por código, igual que el combinado leche+flete de siempre.
  const filaLeche: NotaDebitoImportada = { ...filaA, id: 'ndi_test_mix_leche', tipo: 'leche' };
  const filaTransporte: NotaDebitoImportada = {
    ...filaBase,
    id: 'ndi_test_mix_transporte',
    registroId: rutaLibre.id,
    tipo: 'transporte',
    fabricaExcel: 'VIGIA',
    centimos: 9000000,
  };
  const gruposMixtos = gruposNdPorSap([filaLeche, filaTransporte]);
  const datosConSapMixto = datosConNdPorSap(
    datosBase,
    gruposMixtos.get(prolamar.id)!,
    new Map([...registrosPorId, [rutaLibre.id, rutaLibre]]),
  );
  ok(
    Boolean(
      datosConSapMixto.notaDebitoAgrupada?.porCodigo.some((p) => p.codigo === 'Leche') &&
        datosConSapMixto.notaDebitoAgrupada?.porCodigo.some((p) => p.codigo === 'Flete'),
    ),
    'Mezcla leche+transporte etiqueta Leche/Flete en vez de por código',
    JSON.stringify(datosConSapMixto.notaDebitoAgrupada?.porCodigo.map((p) => p.codigo)),
  );
  const infoMixta = datosConSapMixto.notaDebitoAgrupada?.porCodigo.map((p) =>
    p.resultado?.aplica ? p.resultado.informativo : undefined,
  );
  ok(
    Boolean(
      infoMixta?.every((i) => i !== undefined) &&
        infoMixta.some((i) => i!.tipo === 'leche' && i!.codigo === prolamar.leido.codigo) &&
        infoMixta.some((i) => i!.tipo === 'transporte' && i!.codigo === rutaLibre.leido.codigo),
    ),
    'Cada línea del grupo SAP lleva sus datos "A Modo Informativo" (código y servicio)',
    JSON.stringify(infoMixta),
  );
}

console.log(`
${B}Nota de débito: datos "A Modo Informativo"${N}`);
{
  const conInfo = new Map([
    [
      '009119',
      {
        centimos: 30869300,
        fechaNota: '2026-09-10',
        informativo: { tipo: 'leche' as const, litros: 14002, precioUsd: 0.83, bsXLtsInicio: 664.975, bsXLtsAjustado: 687.022, difXLts: 22.046 },
      },
    ],
  ]);
  const res = resolverNotaDebito('009119', null, 14002, '2026-08-12', new Map(), conInfo);
  ok(
    res?.aplica === true &&
      res.informativo?.codigo === '009119' &&
      res.informativo.bsXLtsAjustado === 687.022 &&
      res.informativo.precioUsd === 0.83 &&
      res.informativo.difXLts === 22.046,
    'resolverNotaDebito pasa los datos del Excel con el código del proveedor',
    JSON.stringify(res),
  );
}

console.log(`
${B}Atajos de teclado (3 teclas, sin conflictos)${N}`);
{
  const at = (ctrl: boolean, alt: boolean, shift: boolean, codigo: string) => ({ ctrl, alt, shift, codigo });
  ok(validarAtajo(at(true, false, true, 'KeyF')) === null, 'Ctrl + Shift + F es válido');
  ok(validarAtajo(at(false, true, true, 'KeyK')) === null, 'Alt + Shift + K es válido');
  ok(validarAtajo(at(true, false, true, 'F7')) === null, 'Ctrl + Shift + F7 es válido');
  ok(validarAtajo(at(true, false, false, 'KeyF')) !== null, 'Ctrl + F (2 teclas) se rechaza');
  ok(validarAtajo(at(true, true, false, 'KeyQ')) !== null, 'Ctrl + Alt (AltGr) se rechaza');
  ok(validarAtajo(at(true, true, true, 'KeyF')) !== null, '4 teclas se rechazan');
  ok(validarAtajo(at(true, false, true, 'KeyI')) !== null, 'Ctrl + Shift + I (herramientas) se rechaza');
  ok(validarAtajo(at(true, false, true, 'KeyV')) !== null, 'Ctrl + Shift + V (pegar sin formato) se rechaza');
  ok(validarAtajo(at(true, false, true, 'Digit1')) !== null, 'Ctrl + Shift + número (idioma) se rechaza');
  ok(textoAtajo(at(true, false, true, 'KeyF')) === 'Ctrl + Shift + F', 'Se muestra legible');
}

// ═══ Borrado ═══
console.log(`\n${B}Borrado en cascada${N}`);
const antes = Number(db2.escalar('SELECT COUNT(*) FROM registros') ?? 0);
await repo.eliminarNomina(db2, admin, idTransporte);
const despues = Number(db2.escalar('SELECT COUNT(*) FROM registros') ?? 0);
ok(antes - despues === 16, 'Eliminar una nómina arrastra sus registros', `${antes} → ${despues}`);
ok(repo.listarNominas(db2).length === 1, 'Queda una sola nómina');
ok(
  leerBitacora(db2, 5).some((e) => e.accion === 'eliminar-nomina'),
  'El borrado queda registrado en la bitácora',
);

console.log('');
if (fallos > 0) {
  console.error(`${R}${B}${fallos} comprobación(es) fallaron.${N}\n`);
  process.exit(1);
}
console.log(`${V}${B}Núcleo verificado: usuarios, permisos, cálculos, bitácora y persistencia.${N}\n`);
