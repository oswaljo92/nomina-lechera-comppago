import { useState } from 'react';
import { useApp } from '../estado.tsx';
import { Aviso, Campo, Confirmar, Dato, Modal, Pastilla, Tarjeta, Vacio } from '../components/comunes.tsx';
import * as repo from '../../core/db/repo.ts';
import {
  cambiarActivo,
  cambiarRol,
  contarAdministradores,
  crearUsuario,
  eliminarUsuario,
  listarUsuarios,
  restablecerContrasena,
  sugerirTemporal,
  validarContrasena,
} from '../../core/auth/usuarios.ts';
import { leerImagenComoDataUrl } from '../util/imagen.ts';
import {
  analizarPaquete,
  exportarPaquete,
  importarPaquete,
  leerPaquete,
  paqueteABlob,
  type Informe,
  type Paquete,
} from '../../core/sync/paquete.ts';
import { fechaAMostrar, formatearBs } from '../../core/parser/numeros.ts';
import { esArchivoSqlite } from '../../core/db/basedatos.ts';
import { useRespaldarYBorrar } from '../components/RespaldarYBorrar.tsx';
import type { ConceptoCatalogo, Empresa, TipoNomina } from '../../core/types.ts';

type Pestana = 'empresas' | 'conceptos' | 'nombres' | 'usuarios' | 'datos' | 'sistema';

export function Ajustes() {
  const { usuario } = useApp();
  const [pestana, setPestana] = useState<Pestana>('empresas');

  const pestanas: { id: Pestana; titulo: string; corto: string; soloAdmin: boolean }[] = [
    { id: 'empresas', titulo: 'Empresas y fábricas', corto: 'Empresas', soloAdmin: true },
    { id: 'conceptos', titulo: 'Catálogo de conceptos', corto: 'Conceptos', soloAdmin: true },
    { id: 'nombres', titulo: 'Nombres de proveedores', corto: 'Nombres', soloAdmin: false },
    { id: 'usuarios', titulo: 'Usuarios', corto: 'Usuarios', soloAdmin: true },
    { id: 'datos', titulo: 'Exportar e importar', corto: 'Datos', soloAdmin: false },
    { id: 'sistema', titulo: 'Sistema', corto: 'Sistema', soloAdmin: false },
  ];

  const actual = pestanas.find((p) => p.id === pestana)!;
  // Con credenciales por usuario, el rol basta: ya se demostró la identidad al
  // iniciar sesión y no hay ninguna clave adicional que reintroducir.
  const sinPermiso = actual.soloAdmin && usuario?.rol !== 'admin';

  return (
    <>
      <div className="cabecera-pagina">
        <div>
          <h1>Ajustes</h1>
          <p>Configuración de la aplicación. Las secciones marcadas son de administrador.</p>
        </div>
      </div>

      <div className="pestanas">
        {pestanas.map((p) => (
          <button
            key={p.id}
            className={`btn${pestana === p.id ? ' primario' : ''}`}
            onClick={() => setPestana(p.id)}
          >
            {p.soloAdmin && '🔒 '}
            <span className="etiqueta-larga">{p.titulo}</span>
            <span className="etiqueta-corta-inline">{p.corto}</span>
          </button>
        ))}
      </div>

      {sinPermiso ? (
        <Tarjeta titulo="Sección de administración">
          <Aviso nivel="aviso" titulo="No tienes acceso">
            Tu usuario es normal. Solo un administrador puede entrar aquí. Puedes seguir trabajando
            con normalidad: cargar nóminas, generar comprobantes, cargar tasas y exportar histórico.
          </Aviso>
        </Tarjeta>
      ) : (
        <>
          {pestana === 'empresas' && <SeccionEmpresas />}
          {pestana === 'conceptos' && <SeccionConceptos />}
          {pestana === 'nombres' && <SeccionNombres />}
          {pestana === 'usuarios' && <SeccionUsuarios />}
          {pestana === 'datos' && <SeccionDatos />}
          {pestana === 'sistema' && <SeccionSistema />}
        </>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────

function SeccionEmpresas() {
  const { db, usuario, cambiado, version } = useApp();
  void version;
  const empresas = repo.listarEmpresas(db);
  const fabricas = repo.listarFabricas(db);
  const [editando, setEditando] = useState<Empresa | 'nueva' | null>(null);

  return (
    <>
      <Tarjeta
        titulo="Empresas"
        descripcion="Los datos que encabezan el comprobante. Puedes tener varias y asignar cuál corresponde a cada fábrica."
        acciones={
          <button className="btn primario" onClick={() => setEditando('nueva')}>
            Nueva empresa
          </button>
        }
        ajustado
      >
        {empresas.length === 0 ? (
          <Vacio icono="🏢" titulo="No hay empresas registradas">
            Sin empresa, los comprobantes salen con un encabezado vacío.
          </Vacio>
        ) : (
          <div className="tabla-envoltura tabla-adaptable">
            <table className="tabla">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>Logo</th>
                  <th>Razón social</th>
                  <th>RIF</th>
                  <th>Dirección fiscal</th>
                  <th>Fábricas</th>
                  <th style={{ textAlign: 'right' }} />
                </tr>
              </thead>
              <tbody>
                {empresas.map((e) => {
                  const suyas = fabricas.filter((f) => f.empresaId === e.id);
                  return (
                    <tr key={e.id}>
                      <td>
                        {e.logo ? (
                          <img src={e.logo} alt="" style={{ maxWidth: 52, maxHeight: 40 }} />
                        ) : (
                          <span className="tenue pequeno">—</span>
                        )}
                      </td>
                      <td className="nombre-prov principal">{e.razonSocial}</td>
                      <td className="mono pequeno" data-etiqueta="RIF">{e.rif}</td>
                      <td className="pequeno" data-etiqueta="Dirección">{e.direccionFiscal}</td>
                      <td className="pequeno">
                        {suyas.length === 0 ? (
                          <Pastilla tono="aviso">Ninguna</Pastilla>
                        ) : (
                          suyas.map((f) => `${f.fabricaCod} ${f.fabricaNom}`).join(', ')
                        )}
                      </td>
                      <td className="acciones-celda">
                        <button className="btn chico" onClick={() => setEditando(e)}>
                          Editar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>

      <Tarjeta
        titulo="Qué empresa encabeza cada fábrica"
        descripcion="Las fábricas se detectan solas al cargar un PDF. Al generar un comprobante se usa la empresa asignada a la fábrica de ese proveedor."
        ajustado
      >
        {fabricas.length === 0 ? (
          <Vacio icono="🏭" titulo="Aún no se ha detectado ninguna fábrica">
            Aparecerán aquí en cuanto cargues la primera nómina.
          </Vacio>
        ) : (
          <div className="tabla-envoltura tabla-adaptable">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fábrica</th>
                  <th>Empresa asignada</th>
                </tr>
              </thead>
              <tbody>
                {fabricas.map((f) => (
                  <tr key={f.fabricaCod}>
                    <td className="principal">
                      <span className="nombre-prov">
                        {f.fabricaCod} · {f.fabricaNom}
                      </span>
                    </td>
                    <td>
                      <select
                        value={f.empresaId ?? ''}
                        onChange={(e) => {
                          if (!usuario) return;
                          void repo
                            .asignarEmpresaAFabrica(db, usuario, f.fabricaCod, e.target.value || null)
                            .then(() => cambiado());
                        }}
                      >
                        <option value="">— Sin asignar —</option>
                        {empresas.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.razonSocial}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>

      {editando && (
        <FormularioEmpresa
          empresa={editando === 'nueva' ? null : editando}
          alCerrar={() => setEditando(null)}
        />
      )}
    </>
  );
}

function FormularioEmpresa({
  empresa,
  alCerrar,
}: {
  empresa: Empresa | null;
  alCerrar: () => void;
}) {
  const { db, usuario, cambiado } = useApp();
  const [razon, setRazon] = useState(empresa?.razonSocial ?? '');
  const [rif, setRif] = useState(empresa?.rif ?? '');
  const [direccion, setDireccion] = useState(empresa?.direccionFiscal ?? '');
  const [telefono, setTelefono] = useState(empresa?.telefono ?? '');
  const [email, setEmail] = useState(empresa?.email ?? '');
  const [logo, setLogo] = useState<string | null>(empresa?.logo ?? null);
  const [error, setError] = useState<string | null>(null);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  const valido = razon.trim().length > 0 && rif.trim().length > 0;

  return (
    <>
      <Modal
        titulo={empresa ? 'Editar empresa' : 'Nueva empresa'}
        descripcion="Estos datos encabezan el comprobante de los proveedores de sus fábricas."
        alCerrar={alCerrar}
        pie={
          <>
            {empresa && (
              <>
                <button className="btn peligro" onClick={() => setConfirmarBorrado(true)}>
                  Eliminar
                </button>
                <span className="crece" />
              </>
            )}
            <button className="btn" onClick={alCerrar}>
              Cancelar
            </button>
            <button className="btn primario" disabled={!valido} onClick={guardar}>
              Guardar
            </button>
          </>
        }
      >
        {error && <Aviso nivel="error">{error}</Aviso>}
        <Campo etiqueta="Razón social">
          <input type="text" value={razon} onChange={(e) => setRazon(e.target.value)} />
        </Campo>
        <div className="linea">
          <Campo etiqueta="RIF">
            <input
              type="text"
              value={rif}
              placeholder="J-12345678-9"
              onChange={(e) => setRif(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Teléfono (opcional)">
            <input type="text" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
          </Campo>
        </div>
        <Campo etiqueta="Dirección fiscal" ayuda="Tal como debe aparecer impresa.">
          <textarea rows={2} value={direccion} onChange={(e) => setDireccion(e.target.value)} />
        </Campo>
        <Campo etiqueta="Correo (opcional)">
          <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Campo>
        <Campo etiqueta="Logo" ayuda="PNG o JPG. Se reduce a 480px y se guarda dentro de la base.">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                setLogo(await leerImagenComoDataUrl(f));
                setError(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          />
        </Campo>
        {logo && (
          <div className="entre">
            <img src={logo} alt="Logo" style={{ maxHeight: 76, borderRadius: 6 }} />
            <button className="btn sutil chico" onClick={() => setLogo(null)}>
              Quitar logo
            </button>
          </div>
        )}
      </Modal>

      {confirmarBorrado && empresa && (
        <Confirmar
          titulo="Eliminar la empresa"
          peligro
          textoConfirmar="Eliminar"
          mensaje="Las fábricas que la tuvieran asignada quedarán sin empresa y sus comprobantes saldrán con el encabezado vacío hasta que asignes otra."
          alCerrar={() => setConfirmarBorrado(false)}
          alConfirmar={() => {
            if (!usuario) return;
            void repo.eliminarEmpresa(db, usuario, empresa.id).then(() => {
              cambiado();
              alCerrar();
            });
          }}
        />
      )}
    </>
  );

  function guardar() {
    if (!usuario) return;
    void repo
      .guardarEmpresa(db, usuario, {
        ...(empresa ? { id: empresa.id } : {}),
        razonSocial: razon.trim(),
        rif: rif.trim(),
        direccionFiscal: direccion.trim(),
        telefono: telefono.trim(),
        email: email.trim(),
        logo,
      })
      .then(() => {
        cambiado();
        alCerrar();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }
}

// ─────────────────────────────────────────────────────────────

function SeccionConceptos() {
  const { db, usuario, cambiado, version } = useApp();
  void version;
  const catalogo = repo.listarCatalogo(db);
  const sinClasificar = catalogo.filter((c) => !c.clasificado);

  return (
    <Tarjeta
      titulo="Catálogo de conceptos"
      descripcion="Define qué significa cada código del reporte y si descuenta del Total a Facturar."
      ajustado
    >
      {sinClasificar.length > 0 && (
        <div style={{ padding: 16, paddingBottom: 0 }}>
          <Aviso nivel="error" titulo={`${sinClasificar.length} concepto(s) sin clasificar`}>
            Las nóminas que los usen no se pueden guardar hasta que los definas.
          </Aviso>
        </div>
      )}
      <div className="tabla-envoltura tabla-adaptable">
        <table className="tabla">
          <thead>
            <tr>
              <th style={{ width: 70 }}>Código</th>
              <th>Nombre</th>
              <th style={{ width: 140 }}>Clase</th>
              <th style={{ width: 200 }}>¿Resta del total a facturar?</th>
              <th style={{ width: 120 }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {catalogo.map((c) => (
              <FilaConcepto
                key={c.codigo}
                concepto={c}
                alGuardar={(nuevo) => {
                  if (!usuario) return;
                  void repo.guardarConcepto(db, usuario, nuevo).then(() => cambiado());
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: 16 }}>
        <p className="tenue pequeno" style={{ margin: 0 }}>
          El ISLR va sin marcar a propósito: es una retención, no un descuento. El proveedor factura
          el monto completo y la empresa se lo retiene, así que no reduce lo facturable.
        </p>
      </div>
    </Tarjeta>
  );
}

function FilaConcepto({
  concepto,
  alGuardar,
}: {
  concepto: ConceptoCatalogo;
  alGuardar: (c: ConceptoCatalogo) => void;
}) {
  const [nombre, setNombre] = useState(concepto.nombre);

  return (
    <tr>
      <td className="mono principal">Concepto {concepto.codigo}</td>
      <td>
        <input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onBlur={() => {
            if (nombre.trim() && nombre !== concepto.nombre) {
              alGuardar({ ...concepto, nombre: nombre.trim(), clasificado: true });
            }
          }}
        />
      </td>
      <td>
        <select
          value={concepto.clase}
          onChange={(e) =>
            alGuardar({
              ...concepto,
              clase: e.target.value as 'pago' | 'deduccion',
              restaFacturacion: e.target.value === 'pago' ? false : concepto.restaFacturacion,
              clasificado: true,
            })
          }
        >
          <option value="pago">Pago</option>
          <option value="deduccion">Deducción</option>
        </select>
      </td>
      <td>
        {concepto.clase === 'deduccion' ? (
          <label className="check" style={{ marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={concepto.restaFacturacion}
              onChange={(e) =>
                alGuardar({ ...concepto, restaFacturacion: e.target.checked, clasificado: true })
              }
            />
            <span>{concepto.restaFacturacion ? 'Sí, descuenta' : 'No (retención)'}</span>
          </label>
        ) : (
          <span className="tenue pequeno">No aplica</span>
        )}
      </td>
      <td>
        {concepto.clasificado ? (
          <Pastilla tono="ok">Clasificado</Pastilla>
        ) : (
          <Pastilla tono="error">Sin clasificar</Pastilla>
        )}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────

function SeccionNombres() {
  const { db, usuario, cambiado, version, puedo } = useApp();
  void version;
  const [tipo, setTipo] = useState<TipoNomina>('leche');
  const nombres = repo.nombresCompletos(db, tipo);
  const editable = puedo('editar-nombres');

  const proveedores = db.todos<{ codigo: string; nombre: string }>(
    `SELECT r.codigo AS codigo, MAX(r.nombre) AS nombre
       FROM registros r JOIN nominas n ON n.id = r.nomina_id
      WHERE n.tipo = ?
      GROUP BY r.codigo
      ORDER BY nombre`,
    [tipo],
  );

  return (
    <Tarjeta
      titulo="Nombres completos de proveedores"
      descripcion="El reporte corta los nombres a unos 30 caracteres. Escribe aquí el nombre completo una sola vez y se usará en todos los comprobantes de ese proveedor."
      acciones={
        <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoNomina)}>
          <option value="leche">Proveedores de leche</option>
          <option value="transporte">Transportistas</option>
        </select>
      }
      ajustado
    >
      {proveedores.length === 0 ? (
        <Vacio icono="✍️" titulo="Aún no hay proveedores de este tipo" />
      ) : (
        <div className="tabla-envoltura tabla-adaptable" style={{ maxHeight: 560, overflowY: 'auto' }}>
          <table className="tabla">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Código</th>
                <th style={{ width: 300 }}>Nombre en el reporte</th>
                <th>Nombre completo para el comprobante</th>
              </tr>
            </thead>
            <tbody>
              {proveedores.map((p) => (
                <tr key={p.codigo}>
                  <td className="mono principal">Código {p.codigo}</td>
                  <td className="pequeno tenue" data-etiqueta="En el reporte">{p.nombre}</td>
                  <td>
                    <input
                      type="text"
                      defaultValue={nombres.get(p.codigo) ?? ''}
                      placeholder={p.nombre}
                      disabled={!editable}
                      onBlur={(e) => {
                        if (!usuario) return;
                        const nuevo = e.target.value.trim();
                        if (nuevo === (nombres.get(p.codigo) ?? '')) return;
                        void repo
                          .guardarNombreCompleto(db, usuario, tipo, p.codigo, nuevo)
                          .then(() => cambiado());
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Tarjeta>
  );
}

// ─────────────────────────────────────────────────────────────

function SeccionUsuarios() {
  const { db, usuario, cambiado, version } = useApp();
  void version;
  const usuarios = listarUsuarios(db);
  const admins = contarAdministradores(db);

  const [nombre, setNombre] = useState('');
  const [rol, setRol] = useState<'admin' | 'normal'>('normal');
  const [clave, setClave] = useState(() => sugerirTemporal());
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aEliminar, setAEliminar] = useState<string | null>(null);
  const [aRestablecer, setARestablecer] = useState<string | null>(null);

  function fallo(e: unknown) {
    setError(e instanceof Error ? e.message : String(e));
  }

  return (
    <>
      {admins === 1 && (
        <Aviso nivel="aviso" titulo="Solo hay un administrador">
          No existe código de recuperación: si olvidas tu contraseña, nadie podrá restablecerla y se
          perderá el acceso administrativo. Crea un segundo administrador y cada uno podrá
          restablecer la contraseña del otro.
        </Aviso>
      )}
      {error && <Aviso nivel="error">{error}</Aviso>}
      {aviso && <Aviso nivel="ok">{aviso}</Aviso>}

      <Tarjeta
        titulo="Crear un usuario"
        descripcion="Recibirá una contraseña temporal y tendrá que definir la suya al entrar por primera vez."
      >
        <div className="linea">
          <Campo etiqueta="Nombre">
            <input
              type="text"
              value={nombre}
              placeholder="Nombre de la persona"
              onChange={(e) => setNombre(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Rol">
            <select value={rol} onChange={(e) => setRol(e.target.value as 'admin' | 'normal')}>
              <option value="normal">Normal — trabaja, no borra</option>
              <option value="admin">Administrador — puede borrar y administrar</option>
            </select>
          </Campo>
        </div>
        <div className="linea">
          <Campo
            etiqueta="Contraseña temporal"
            ayuda="Entrégasela por un medio seguro. La cambiará al entrar."
          >
            <input type="text" className="mono" value={clave} onChange={(e) => setClave(e.target.value)} />
          </Campo>
          <button className="btn" onClick={() => setClave(sugerirTemporal())}>
            Generar otra
          </button>
          <button
            className="btn primario"
            disabled={nombre.trim().length === 0 || validarContrasena(clave) !== null}
            onClick={() => {
              if (!usuario) return;
              setError(null);
              setAviso(null);
              void crearUsuario(db, usuario, {
                nombre,
                rol,
                contrasena: clave,
                debeCambiar: true,
              })
                .then((creado) => {
                  setAviso(
                    `Usuario «${creado.nombre}» creado. Su contraseña temporal es ${clave} — entrégasela y pídele que la cambie al entrar.`,
                  );
                  setNombre('');
                  setClave(sugerirTemporal());
                  cambiado();
                })
                .catch(fallo);
            }}
          >
            Crear usuario
          </button>
        </div>
      </Tarjeta>

      <Tarjeta titulo={`Usuarios (${usuarios.length})`} ajustado>
        <div className="tabla-envoltura tabla-adaptable">
          <table className="tabla">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Último acceso</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => {
                const esYo = u.id === usuario?.id;
                const ultimoAdmin = u.rol === 'admin' && u.activo && admins === 1;
                return (
                  <tr key={u.id}>
                    <td data-etiqueta="Nombre">
                      <span className="nombre-prov">{u.nombre}</span>
                      {esYo && <span className="sub"> · eres tú</span>}
                      {u.debeCambiar && (
                        <div className="sub">Debe definir su contraseña al entrar</div>
                      )}
                    </td>
                    <td data-etiqueta="Rol">
                      <select
                        value={u.rol}
                        disabled={ultimoAdmin}
                        title={ultimoAdmin ? 'Es el único administrador activo' : undefined}
                        onChange={(e) => {
                          if (!usuario) return;
                          setError(null);
                          void cambiarRol(db, usuario, u.id, e.target.value as 'admin' | 'normal')
                            .then(() => cambiado())
                            .catch(fallo);
                        }}
                      >
                        <option value="normal">Normal</option>
                        <option value="admin">Administrador</option>
                      </select>
                    </td>
                    <td data-etiqueta="Estado">
                      {u.activo ? (
                        <Pastilla tono="ok">Activo</Pastilla>
                      ) : (
                        <Pastilla tono="neutra">Desactivado</Pastilla>
                      )}
                      {u.bloqueadoHasta && new Date(u.bloqueadoHasta) > new Date() && (
                        <div>
                          <Pastilla tono="error">Frenado por intentos</Pastilla>
                        </div>
                      )}
                    </td>
                    <td data-etiqueta="Último acceso" className="pequeno">
                      {u.ultimoAcceso
                        ? new Date(u.ultimoAcceso).toLocaleString('es-VE', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })
                        : 'Nunca'}
                    </td>
                    <td className="acciones-celda">
                      <button
                        className="btn chico"
                        disabled={esYo}
                        onClick={() => setARestablecer(u.id)}
                      >
                        Restablecer clave
                      </button>
                      <button
                        className="btn sutil chico"
                        disabled={esYo || ultimoAdmin}
                        onClick={() => {
                          if (!usuario) return;
                          setError(null);
                          void cambiarActivo(db, usuario, u.id, !u.activo)
                            .then(() => cambiado())
                            .catch(fallo);
                        }}
                      >
                        {u.activo ? 'Desactivar' : 'Activar'}
                      </button>
                      <button
                        className="btn sutil chico peligro"
                        disabled={esYo || ultimoAdmin}
                        onClick={() => setAEliminar(u.id)}
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      {aRestablecer && usuario && (
        <ModalRestablecer
          nombre={usuarios.find((u) => u.id === aRestablecer)?.nombre ?? ''}
          alCerrar={() => setARestablecer(null)}
          alAceptar={(temporal) => {
            setError(null);
            void restablecerContrasena(db, usuario, aRestablecer, temporal)
              .then(() => {
                setAviso(
                  `Contraseña restablecida. La temporal es ${temporal} — entrégasela y tendrá que cambiarla al entrar.`,
                );
                cambiado();
                setARestablecer(null);
              })
              .catch(fallo);
          }}
        />
      )}

      {aEliminar && usuario && (
        <Confirmar
          titulo="Eliminar el usuario"
          peligro
          textoConfirmar="Eliminar"
          mensaje="Las entradas que dejó en la bitácora se conservan con su nombre; solo deja de poder entrar. Si prefieres conservar la cuenta por si vuelve, desactívala en vez de eliminarla."
          alCerrar={() => setAEliminar(null)}
          alConfirmar={() => {
            void eliminarUsuario(db, usuario, aEliminar)
              .then(() => cambiado())
              .catch(fallo);
          }}
        />
      )}
    </>
  );
}

function ModalRestablecer({
  nombre,
  alCerrar,
  alAceptar,
}: {
  nombre: string;
  alCerrar: () => void;
  alAceptar: (temporal: string) => void;
}) {
  const [temporal, setTemporal] = useState(() => sugerirTemporal());
  const problema = validarContrasena(temporal);

  return (
    <Modal
      titulo={`Restablecer la contraseña de ${nombre}`}
      descripcion="Se asignará una contraseña temporal que esa persona deberá cambiar al entrar."
      alCerrar={alCerrar}
      pie={
        <>
          <button className="btn" onClick={alCerrar}>
            Cancelar
          </button>
          <button
            className="btn primario"
            disabled={problema !== null}
            onClick={() => alAceptar(temporal)}
          >
            Restablecer
          </button>
        </>
      }
    >
      <Campo etiqueta="Contraseña temporal">
        <input
          type="text"
          className="mono"
          value={temporal}
          onChange={(e) => setTemporal(e.target.value)}
        />
      </Campo>
      {problema && <Aviso nivel="aviso">{problema}</Aviso>}
      <div className="acciones">
        <button className="btn chico" onClick={() => setTemporal(sugerirTemporal())}>
          Generar otra
        </button>
      </div>
      <Aviso nivel="info">
        Apúntala antes de continuar: no se vuelve a mostrar y solo queda guardado su hash.
      </Aviso>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────

function SeccionDatos() {
  const { db, usuario, plataforma, cambiado, reemplazarBase, version, puedo } = useApp();
  void version;
  const nominas = repo.listarNominas(db);
  const vinculos = repo.vinculosProveedor(db);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set(nominas.map((n) => n.id)));
  const [informe, setInforme] = useState<{ paquete: Paquete; informe: Informe } | null>(null);
  const [mensaje, setMensaje] = useState<{ nivel: 'ok' | 'error'; texto: string } | null>(null);
  const [confirmarRestaurar, setConfirmarRestaurar] = useState<Uint8Array | null>(null);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const { respaldado: respaldadoParaBorrar, descargarRespaldo, borrarTodo } = useRespaldarYBorrar(
    db,
    plataforma,
    reemplazarBase,
    'respaldo_antes_de_borrar_comppago',
  );

  return (
    <>
      {mensaje && <Aviso nivel={mensaje.nivel === 'ok' ? 'ok' : 'error'}>{mensaje.texto}</Aviso>}

      <Tarjeta
        titulo="Exportar histórico"
        descripcion="Genera un archivo .lecdb con las nóminas que elijas, para que un colega lo importe en su copia de CompPago."
      >
        {nominas.length === 0 ? (
          <Vacio icono="📤" titulo="No hay nóminas que exportar" />
        ) : (
          <>
            <div className="tabla-envoltura tabla-adaptable" style={{ maxHeight: 280, overflowY: 'auto' }}>
              <table className="tabla">
                <tbody>
                  {nominas.map((n) => (
                    <tr key={n.id}>
                      <td style={{ width: 34 }}>
                        <input
                          type="checkbox"
                          checked={elegidas.has(n.id)}
                          onChange={() => {
                            const c = new Set(elegidas);
                            if (c.has(n.id)) c.delete(n.id);
                            else c.add(n.id);
                            setElegidas(c);
                          }}
                        />
                      </td>
                      <td>
                        <span className="nombre-prov">
                          Nº {n.numero}/{n.anio}
                        </span>
                        <div className="sub">
                          {n.tipo === 'leche' ? 'Leche' : 'Transporte'} · {n.registros} proveedores ·{' '}
                          {fechaAMostrar(n.fechaIni)} al {fechaAMostrar(n.fechaFin)}
                        </div>
                      </td>
                      <td className="num">{formatearBs(n.neto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="acciones" style={{ marginTop: 12 }}>
              <button
                className="btn primario"
                disabled={elegidas.size === 0 || !puedo('exportar') || !usuario}
                onClick={() => {
                  if (!usuario) return;
                  const paquete = exportarPaquete(db, usuario, [...elegidas]);
                  const fecha = new Date().toISOString().slice(0, 10);
                  void plataforma.archivos
                    .guardar(`historico_comppago_${fecha}.lecdb`, paqueteABlob(paquete))
                    .then(() =>
                      setMensaje({
                        nivel: 'ok',
                        texto: `Se exportaron ${elegidas.size} nómina(s), junto con el catálogo, las empresas, las tasas y los nombres de proveedores.`,
                      }),
                    );
                }}
              >
                Exportar {elegidas.size} nómina(s)
              </button>
            </div>
          </>
        )}
      </Tarjeta>

      <Tarjeta
        titulo="Importar histórico"
        descripcion="Fusiona un archivo .lecdb con lo que ya tienes. Nunca borra ni sobrescribe: lo repetido se omite y se te informa."
      >
        <button
          className="btn primario"
          disabled={!puedo('importar')}
          onClick={() => {
            void plataforma.archivos.abrir('.lecdb,.json').then((archivo) => {
              if (!archivo) return;
              const paquete = leerPaquete(archivo.bytes);
              if (!paquete) {
                setMensaje({
                  nivel: 'error',
                  texto: 'Ese archivo no es un histórico de CompPago.',
                });
                return;
              }
              setInforme({ paquete, informe: analizarPaquete(db, paquete) });
            });
          }}
        >
          Elegir archivo .lecdb
        </button>
      </Tarjeta>

      <Tarjeta
        titulo="Respaldo completo"
        descripcion="Copia exacta de toda la base de datos. Sirve para recuperación, no para fusionar."
      >
        <div className="acciones">
          <button
            className="btn"
            onClick={() => {
              const fecha = new Date().toISOString().slice(0, 10);
              const bytes = db.exportar();
              void plataforma.archivos.guardar(
                `respaldo_comppago_${fecha}.db`,
                new Blob([new Uint8Array(bytes) as unknown as ArrayBufferView<ArrayBuffer>], {
                  type: 'application/octet-stream',
                }),
              );
            }}
          >
            Descargar respaldo
          </button>
          <button
            className="btn peligro"
            disabled={!puedo('restaurar-respaldo')}
            onClick={() => {
              void plataforma.archivos.abrir('.db').then((archivo) => {
                if (!archivo) return;
                if (!esArchivoSqlite(archivo.bytes)) {
                  setMensaje({
                    nivel: 'error',
                    texto: 'Ese archivo no es una base de datos de CompPago.',
                  });
                  return;
                }
                setConfirmarRestaurar(archivo.bytes);
              });
            }}
          >
            Restaurar respaldo
          </button>
        </div>
        <p className="tenue pequeno" style={{ marginTop: 10, marginBottom: 0 }}>
          Restaurar <strong>reemplaza todo</strong> lo que hay en este equipo, incluida la bitácora.
          Para traer datos de un colega sin perder los tuyos usa Importar.
        </p>
        <div className="sep" />
        <Dato etiqueta="Los datos viven en" valor={plataforma.db.ubicacion()} pequeno />
      </Tarjeta>

      {puedo('restaurar-respaldo') && (
        <Tarjeta
          titulo="Zona de peligro"
          descripcion="Vacía la base entera de este equipo para empezar de cero, como en una instalación nueva."
        >
          <Aviso nivel="aviso" titulo="Qué se borra">
            Nóminas, usuarios y contraseñas, empresas, tasas, catálogo clasificado y la bitácora.
            No se puede deshacer. Descarga un respaldo antes de continuar.
          </Aviso>
          <div className="acciones" style={{ marginTop: 12 }}>
            <button className="btn" onClick={descargarRespaldo}>
              ⬇ Descargar respaldo
            </button>
            <button
              className="btn peligro"
              disabled={!respaldadoParaBorrar}
              onClick={() => setConfirmarBorrado(true)}
            >
              Empezar de cero
            </button>
          </div>
          {respaldadoParaBorrar && (
            <Aviso nivel="ok">Respaldo descargado. Ya puedes empezar de cero si quieres.</Aviso>
          )}
        </Tarjeta>
      )}

      {puedo('vincular-proveedor') && (
        <Tarjeta
          titulo="Vínculos leche-transporte"
          descripcion="Proveedores confirmados como la misma persona en los dos reportes. Se combinan en un solo comprobante automáticamente cada semana, sin volver a preguntar."
        >
          {vinculos.length === 0 ? (
            <Vacio icono="🔗" titulo="No hay vínculos todavía">
              Se sugieren solos en Comprobantes cuando el mismo RIF/cédula aparece en leche y en
              transporte de la misma semana ganadera.
            </Vacio>
          ) : (
            <div className="tabla-envoltura tabla-adaptable">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Código leche</th>
                    <th>Código transporte</th>
                    <th>Estado</th>
                    <th>Actualizado</th>
                    <th style={{ textAlign: 'right' }} />
                  </tr>
                </thead>
                <tbody>
                  {vinculos.map((v) => (
                    <tr key={v.id}>
                      <td className="principal">{v.codigoLeche}</td>
                      <td className="principal">{v.codigoTransporte}</td>
                      <td data-etiqueta="Estado">
                        <Pastilla tono={v.estado === 'confirmado' ? 'ok' : 'neutra'}>
                          {v.estado === 'confirmado' ? 'Vinculado' : 'Descartado'}
                        </Pastilla>
                      </td>
                      <td className="pequeno" data-etiqueta="Actualizado">
                        {fechaAMostrar(v.actualizadoEn.slice(0, 10))}
                      </td>
                      <td className="acciones-celda">
                        <button
                          className="btn sutil chico"
                          onClick={() => {
                            if (!usuario) return;
                            void repo
                              .desvincularProveedor(db, usuario, v.codigoLeche, v.codigoTransporte)
                              .then(() => cambiado());
                          }}
                        >
                          {v.estado === 'confirmado' ? 'Desvincular' : 'Reconsiderar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Tarjeta>
      )}

      {informe && usuario && (
        <ModalImportar
          paquete={informe.paquete}
          informe={informe.informe}
          alCerrar={() => setInforme(null)}
          alImportar={(claves) => {
            void importarPaquete(db, usuario, informe.paquete, claves).then((r) => {
              cambiado();
              setInforme(null);
              setMensaje({
                nivel: 'ok',
                texto: `Importadas ${r.nominas} nómina(s) con ${r.registros} registros. Además: ${r.tasas} tasas, ${r.conceptos} conceptos, ${r.empresas} empresas y ${r.nombres} nombres. Se omitieron ${r.omitidas}.`,
              });
            });
          }}
        />
      )}

      {confirmarRestaurar && (
        <Confirmar
          titulo="Restaurar el respaldo"
          peligro
          textoConfirmar="Reemplazar todo"
          mensaje="Se descartará por completo la base actual de este equipo —nóminas, usuarios, empresas, tasas y bitácora— y se sustituirá por la del archivo. Esto no se puede deshacer."
          alCerrar={() => setConfirmarRestaurar(null)}
          alConfirmar={() => void reemplazarBase(confirmarRestaurar)}
        />
      )}

      {confirmarBorrado && (
        <Confirmar
          titulo="Empezar de cero"
          peligro
          textoConfirmar="Sí, borrar todo"
          mensaje="Se borrará por completo la base de este equipo —nóminas, usuarios, empresas, tasas y bitácora— y la aplicación quedará como recién instalada. Esto no se puede deshacer."
          alCerrar={() => setConfirmarBorrado(false)}
          alConfirmar={borrarTodo}
        />
      )}
    </>
  );
}

function ModalImportar({
  paquete,
  informe,
  alCerrar,
  alImportar,
}: {
  paquete: Paquete;
  informe: Informe;
  alCerrar: () => void;
  alImportar: (claves: Set<string>) => void;
}) {
  const nuevas = informe.filas.filter((f) => f.estado === 'nueva');
  const [elegidas, setElegidas] = useState<Set<string>>(new Set(nuevas.map((f) => f.clave)));

  return (
    <Modal
      ancho
      titulo="Importar histórico"
      descripcion={`Archivo creado el ${new Date(informe.creadoEn).toLocaleString('es-VE')} por ${informe.origenUsuario}.`}
      alCerrar={alCerrar}
      pie={
        <>
          <button className="btn" onClick={alCerrar}>
            Cancelar
          </button>
          <button
            className="btn primario"
            disabled={!informe.valido}
            onClick={() => alImportar(elegidas)}
          >
            Importar {elegidas.size} nómina(s)
          </button>
        </>
      }
    >
      {!informe.valido ? (
        <Aviso nivel="error" titulo="No se puede importar">
          {informe.error}
        </Aviso>
      ) : (
        <>
          <div className="rejilla cuatro" style={{ marginBottom: 14 }}>
            <Dato etiqueta="Nóminas nuevas" valor={String(nuevas.length)} />
            <Dato
              etiqueta="Ya existentes"
              valor={String(informe.filas.filter((f) => f.estado !== 'nueva').length)}
            />
            <Dato etiqueta="Tasas nuevas" valor={String(informe.tasasNuevas)} />
            <Dato etiqueta="Nombres nuevos" valor={String(informe.nombresNuevos)} />
          </div>

          {informe.conceptosNuevos.length > 0 && (
            <Aviso nivel="aviso" titulo="Conceptos nuevos">
              Llegan {informe.conceptosNuevos.join(', ')}. Se agregan <strong>sin clasificar</strong>{' '}
              aunque vinieran clasificados en el origen, para que un administrador de este equipo
              decida si descuentan del total a facturar.
            </Aviso>
          )}

          <div className="tabla-envoltura tabla-adaptable" style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table className="tabla">
              <thead>
                <tr>
                  <th style={{ width: 34 }} />
                  <th>Nómina</th>
                  <th className="num">Registros</th>
                  <th className="num">Neto</th>
                  <th>Situación</th>
                </tr>
              </thead>
              <tbody>
                {informe.filas.map((f) => (
                  <tr key={f.clave}>
                    <td>
                      <input
                        type="checkbox"
                        checked={elegidas.has(f.clave)}
                        disabled={f.estado !== 'nueva'}
                        onChange={() => {
                          const c = new Set(elegidas);
                          if (c.has(f.clave)) c.delete(f.clave);
                          else c.add(f.clave);
                          setElegidas(c);
                        }}
                      />
                    </td>
                    <td>
                      <span className="nombre-prov">
                        Nº {f.numero}/{f.anio}
                      </span>
                      <div className="sub">{f.tipo === 'leche' ? 'Leche' : 'Transporte'}</div>
                    </td>
                    <td className="num">{f.registros}</td>
                    <td className="num">{formatearBs(f.neto)}</td>
                    <td className="pequeno">
                      <Pastilla
                        tono={
                          f.estado === 'nueva' ? 'ok' : f.estado === 'duplicada' ? 'neutra' : 'aviso'
                        }
                      >
                        {f.estado}
                      </Pastilla>
                      <div className="sub">{f.detalle}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tenue pequeno" style={{ marginTop: 10, marginBottom: 0 }}>
            Se importarán además {paquete.empresas?.length ?? 0} empresa(s) y{' '}
            {paquete.tasas?.length ?? 0} tasa(s), agregando solo lo que aquí falte.
          </p>
        </>
      )}
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────

function SeccionSistema() {
  const { plataforma, db, version } = useApp();
  void version;
  const usuarios = listarUsuarios(db);

  return (
    <>
      <Tarjeta titulo="Acceso y trazabilidad">
        <p className="tenue">
          Cada persona entra con su propio usuario y contraseña. Para cambiar la tuya, abre «Mi
          cuenta» desde tu nombre en la barra lateral.
        </p>
        <div className="rejilla tres">
          <Dato etiqueta="Usuarios registrados" valor={String(usuarios.length)} />
          <Dato
            etiqueta="Administradores activos"
            valor={String(contarAdministradores(db))}
            nota={contarAdministradores(db) === 1 ? 'Conviene tener dos' : undefined}
          />
          <Dato
            etiqueta="Usuarios desactivados"
            valor={String(usuarios.filter((u) => !u.activo).length)}
          />
        </div>
        <div className="sep" />
        <p className="tenue pequeno" style={{ marginBottom: 0 }}>
          De las contraseñas solo se guarda su hash PBKDF2-SHA256 con 600.000 iteraciones y una sal
          distinta por usuario. Tras varios intentos fallidos el acceso se frena con una espera que
          crece, y ese freno vive en la base de datos: recargar la página no lo esquiva.
        </p>
      </Tarjeta>

      <Tarjeta titulo="Información del sistema">
        <div className="rejilla dos">
          <Dato etiqueta="Entorno" valor={plataforma.etiqueta} pequeno />
          <Dato etiqueta="Base de datos" valor={plataforma.db.ubicacion()} pequeno />
        </div>
        <div className="sep" />
        <p className="tenue pequeno" style={{ marginBottom: 0 }}>
          Los PDF que cargas se procesan íntegramente en este equipo. Ni los archivos ni los datos de
          los proveedores viajan por la red en ningún momento; puedes comprobarlo desconectando el
          WiFi y usando la aplicación con normalidad.
        </p>
      </Tarjeta>
    </>
  );
}
