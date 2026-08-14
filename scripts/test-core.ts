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
import { calcularNotaDebito, calcularRegistro, bsAUsd, usdABs } from '../src/core/calc/calcular.ts';
import { sha256DeBytes } from '../src/core/auth/hash.ts';
import { formatearBs, formatearDecimal } from '../src/core/parser/numeros.ts';

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
  // 74.790 L × 2,45 $/L × (215 − 200) = 2.748.532,50 Bs
  ndPorNota.aplica && ndPorNota.centimos === 274853250,
  'Usando la fecha de nota de débito el monto cambia',
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
