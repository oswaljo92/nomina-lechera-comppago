import type { Permiso, Rol, Usuario } from '../types.ts';

/**
 * Matriz de permisos.
 *
 * Un usuario normal hace todo el trabajo diario —cargar nóminas, consultar,
 * generar comprobantes, cargar tasas, exportar e importar— y cada acción queda
 * en la bitácora con su nombre. Lo que no puede es BORRAR ni administrar:
 * eliminar histórico, gestionar usuarios, cambiar los datos de las empresas,
 * clasificar conceptos del catálogo o restaurar un respaldo.
 *
 * Al tener cada persona su propia contraseña, el rol se comprueba contra el
 * usuario que inició sesión y no hace falta reintroducir ninguna clave.
 */
const PERMISOS_NORMAL: readonly Permiso[] = [
  'cargar-nomina',
  'consultar',
  'generar-comprobante',
  'concepto-manual',
  'nota-debito',
  'cargar-tasas',
  'exportar',
  'importar',
  'editar-nombres',
  'ver-bitacora',
];

const PERMISOS_ADMIN: readonly Permiso[] = [
  ...PERMISOS_NORMAL,
  'clasificar-conceptos',
  'borrar',
  'gestionar-usuarios',
  'editar-empresas',
  'restaurar-respaldo',
];

export function permisosDe(rol: Rol): readonly Permiso[] {
  return rol === 'admin' ? PERMISOS_ADMIN : PERMISOS_NORMAL;
}

export function puede(usuario: Usuario | null, permiso: Permiso): boolean {
  if (!usuario || !usuario.activo) return false;
  return permisosDe(usuario.rol).includes(permiso);
}

export const ETIQUETAS_PERMISO: Record<Permiso, string> = {
  'cargar-nomina': 'Cargar nóminas',
  consultar: 'Consultar histórico',
  'generar-comprobante': 'Generar y descargar comprobantes',
  'concepto-manual': 'Agregar conceptos manuales',
  'nota-debito': 'Configurar notas de débito',
  'cargar-tasas': 'Cargar tasas del BCV',
  exportar: 'Exportar histórico',
  importar: 'Importar histórico',
  'editar-nombres': 'Corregir nombres de proveedores',
  'ver-bitacora': 'Ver la bitácora',
  'clasificar-conceptos': 'Clasificar conceptos del catálogo',
  borrar: 'Borrar nóminas e histórico',
  'gestionar-usuarios': 'Crear y administrar usuarios',
  'editar-empresas': 'Editar datos de las empresas',
  'restaurar-respaldo': 'Restaurar un respaldo completo',
};
