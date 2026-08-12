import { useState } from 'react';
import { useApp } from '../estado.tsx';
import { Aviso, Campo } from '../components/comunes.tsx';
import {
  contarAdministradores,
  crearUsuario,
  listarUsuarios,
  validarContrasena,
  validarNombre,
} from '../../core/auth/usuarios.ts';
import { guardarEmpresa, listarNominas } from '../../core/db/repo.ts';
import { BaseDatos, esArchivoSqlite } from '../../core/db/basedatos.ts';
import { leerImagenComoDataUrl } from '../util/imagen.ts';
import type { ArchivoAbierto } from '../../platform/tipos.ts';

type Paso = 'inicio' | 1 | 2 | 3 | 'restaurar';

interface VistaPrevia {
  desactualizada: boolean;
  usuarios: number;
  admins: number;
  nominas: number;
}

/**
 * Asistente de primer arranque.
 *
 * Ofrece dos caminos: crear el primer usuario administrador desde cero, o
 * restaurar un archivo .db que ya traiga usuarios, empresas e histórico —
 * para no reconfigurar todo al pasar de la web al programa de escritorio o a
 * otro equipo. Ya no hay clave de administrador compartida: cada persona
 * tendrá la suya.
 */
export function PrimerArranque({ alTerminar }: { alTerminar: () => void }) {
  const { db, plataforma, iniciarSesion, cambiado, guardarYa, reemplazarBase } = useApp();
  const [paso, setPaso] = useState<Paso>('inicio');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const [nombre, setNombre] = useState('');
  const [clave, setClave] = useState('');
  const [clave2, setClave2] = useState('');
  const [razon, setRazon] = useState('');
  const [rif, setRif] = useState('');
  const [direccion, setDireccion] = useState('');
  const [logo, setLogo] = useState<string | null>(null);

  const [archivoElegido, setArchivoElegido] = useState<ArchivoAbierto | null>(null);
  const [previa, setPrevia] = useState<VistaPrevia | null>(null);
  const [cargandoPrevia, setCargandoPrevia] = useState(false);
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null);

  async function finalizar(conEmpresa: boolean) {
    setError(null);
    setOcupado(true);
    try {
      const admin = await crearUsuario(db, null, {
        nombre,
        rol: 'admin',
        contrasena: clave,
      });
      if (conEmpresa && razon.trim() && rif.trim()) {
        await guardarEmpresa(db, admin, {
          razonSocial: razon.trim(),
          rif: rif.trim(),
          direccionFiscal: direccion.trim(),
          telefono: '',
          email: '',
          logo,
        });
      }
      cambiado();
      await guardarYa();
      setPaso(3);
      // El aviso sobre el segundo administrador se muestra antes de entrar.
      setTimeout(() => {
        iniciarSesion(admin);
        alTerminar();
      }, 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOcupado(false);
    }
  }

  async function elegirArchivoRestaurar() {
    setErrorArchivo(null);
    const archivo = await plataforma.archivos.abrir('.db');
    if (!archivo) return;
    if (!esArchivoSqlite(archivo.bytes)) {
      setErrorArchivo('Ese archivo no es una base de datos de CompPago.');
      return;
    }
    setCargandoPrevia(true);
    try {
      const previaDb = await BaseDatos.abrir(plataforma.localizarWasm, archivo.bytes);
      setArchivoElegido(archivo);
      setPrevia(
        previaDb.desactualizada
          ? { desactualizada: true, usuarios: 0, admins: 0, nominas: 0 }
          : {
              desactualizada: false,
              usuarios: listarUsuarios(previaDb).length,
              admins: contarAdministradores(previaDb),
              nominas: listarNominas(previaDb).length,
            },
      );
    } catch (e) {
      setErrorArchivo(
        e instanceof Error ? e.message : 'No se pudo leer el archivo. Puede estar dañado.',
      );
    } finally {
      setCargandoPrevia(false);
    }
  }

  function elegirOtroArchivo() {
    setArchivoElegido(null);
    setPrevia(null);
    setErrorArchivo(null);
  }

  async function confirmarRestaurarArchivo() {
    if (!archivoElegido) return;
    setOcupado(true);
    // reemplazarBase recarga la página al terminar; no hace falta más manejo
    // de estado aquí.
    await reemplazarBase(archivoElegido.bytes);
  }

  const problemaNombre = nombre.length > 0 ? validarNombre(nombre) : null;
  const problemaClave = clave.length > 0 ? validarContrasena(clave) : null;
  const coinciden = clave.length > 0 && clave === clave2;
  const paso1Listo = problemaNombre === null && problemaClave === null && coinciden;

  return (
    <div className="acceso">
      <div className="caja">
        <header>
          <h1>Bienvenido a Nómina Lechera CompPago</h1>
          <p>
            {paso === 'inicio' || paso === 'restaurar'
              ? 'Todo se guarda únicamente en este equipo.'
              : 'Vamos a crear tu usuario administrador. Todo se guarda únicamente en este equipo.'}
          </p>
        </header>

        <div className="cuerpo">
          {typeof paso === 'number' && (
            <div className="pasos">
              {[1, 2].map((n) => (
                <div key={n} className={`paso${paso >= n ? ' hecho' : ''}`} />
              ))}
            </div>
          )}

          {error && (
            <Aviso nivel="error" titulo="No se pudo continuar">
              {error}
            </Aviso>
          )}

          {paso === 'inicio' && (
            <>
              <h2 style={{ marginBottom: 10 }}>¿Cómo quieres empezar?</h2>
              <div className="opciones-arranque">
                <button type="button" className="opcion-arranque" onClick={() => setPaso(1)}>
                  <span className="icono">🆕</span>
                  <span className="texto">
                    <span className="titulo">Crear cuenta nueva</span>
                    <span className="detalle">
                      Configura la aplicación desde cero: tu usuario administrador y, si quieres,
                      los datos de tu empresa.
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="opcion-arranque"
                  onClick={() => setPaso('restaurar')}
                >
                  <span className="icono">📂</span>
                  <span className="texto">
                    <span className="titulo">Ya tengo datos guardados</span>
                    <span className="detalle">
                      Sube el archivo de base de datos de la web o del programa de escritorio y
                      entra directo con tus cuentas de siempre.
                    </span>
                  </span>
                </button>
              </div>
            </>
          )}

          {paso === 'restaurar' && (
            <>
              <h2 style={{ marginBottom: 10 }}>Restaurar datos existentes</h2>
              <p className="tenue pequeno">
                Elige el archivo <code>.db</code> que descargaste desde{' '}
                <em>Ajustes → Respaldo completo</em>, o el que ya tenías guardado de otra
                instalación. Trae tus usuarios, empresas e histórico tal como estaban.
              </p>

              {errorArchivo && (
                <Aviso nivel="error" titulo="No se pudo continuar">
                  {errorArchivo}
                </Aviso>
              )}

              {!archivoElegido && (
                <button
                  type="button"
                  className="btn primario ancho"
                  disabled={cargandoPrevia}
                  onClick={() => void elegirArchivoRestaurar()}
                >
                  {cargandoPrevia ? 'Leyendo…' : '📂 Elegir archivo'}
                </button>
              )}

              {archivoElegido && previa && (
                <>
                  {previa.desactualizada ? (
                    <Aviso nivel="aviso" titulo={archivoElegido.nombre}>
                      Es un archivo de una versión anterior de la app. Se puede continuar, pero
                      antes de tocar nada se ofrecerá descargar un respaldo y decidir qué hacer.
                    </Aviso>
                  ) : (
                    <Aviso nivel="ok" titulo={archivoElegido.nombre}>
                      {previa.usuarios} usuario(s) ({previa.admins} administrador(es)) y{' '}
                      {previa.nominas} nómina(s) cargada(s).
                    </Aviso>
                  )}
                  <div className="acciones" style={{ width: '100%', marginTop: 4 }}>
                    <button className="btn" disabled={ocupado} onClick={elegirOtroArchivo}>
                      Elegir otro archivo
                    </button>
                    <button
                      className="btn primario crece"
                      disabled={ocupado}
                      onClick={() => void confirmarRestaurarArchivo()}
                    >
                      {ocupado ? 'Restaurando…' : 'Restaurar y entrar'}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {paso === 1 && (
            <>
              <h2 style={{ marginBottom: 10 }}>1 · Tu usuario</h2>
              <p className="tenue pequeno">
                Serás administrador: podrás crear más usuarios, borrar histórico, clasificar
                conceptos y editar los datos de las empresas.
              </p>
              <Campo etiqueta="Tu nombre" ayuda="Es el que aparecerá en la bitácora.">
                <input
                  type="text"
                  value={nombre}
                  placeholder="Oswaldo"
                  autoComplete="username"
                  onChange={(e) => setNombre(e.target.value)}
                />
              </Campo>
              <Campo
                etiqueta="Tu contraseña"
                ayuda="Mínimo 8 caracteres, combinando letras y números."
              >
                <input
                  type="password"
                  value={clave}
                  autoComplete="new-password"
                  onChange={(e) => setClave(e.target.value)}
                />
              </Campo>
              <Campo etiqueta="Repite la contraseña">
                <input
                  type="password"
                  value={clave2}
                  autoComplete="new-password"
                  onChange={(e) => setClave2(e.target.value)}
                />
              </Campo>
              {problemaNombre && <Aviso nivel="aviso">{problemaNombre}</Aviso>}
              {problemaClave && <Aviso nivel="aviso">{problemaClave}</Aviso>}
              {clave2.length > 0 && !coinciden && (
                <Aviso nivel="aviso">Las dos contraseñas no coinciden.</Aviso>
              )}

              <Aviso nivel="info" titulo="Guarda bien esta contraseña">
                No hay código de recuperación ni correo desde donde restablecerla. Si eres el único
                administrador y la olvidas, se pierde el acceso administrativo. En cuanto entres,
                crea un segundo administrador: cualquiera de los dos puede restablecer la
                contraseña del otro.
              </Aviso>
            </>
          )}

          {paso === 2 && (
            <>
              <h2 style={{ marginBottom: 10 }}>2 · Datos de tu empresa</h2>
              <p className="tenue pequeno">
                Encabezan el comprobante. Puedes registrar más empresas después y decidir cuál
                corresponde a cada fábrica; si prefieres, salta este paso y hazlo luego en Ajustes.
              </p>
              <Campo etiqueta="Razón social">
                <input type="text" value={razon} onChange={(e) => setRazon(e.target.value)} />
              </Campo>
              <Campo etiqueta="RIF">
                <input
                  type="text"
                  value={rif}
                  placeholder="J-12345678-9"
                  onChange={(e) => setRif(e.target.value)}
                />
              </Campo>
              <Campo etiqueta="Dirección fiscal" ayuda="Tal como debe aparecer en el comprobante.">
                <textarea rows={2} value={direccion} onChange={(e) => setDireccion(e.target.value)} />
              </Campo>
              <Campo etiqueta="Logo" ayuda="Opcional. PNG o JPG; se guarda dentro de la base.">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      setLogo(await leerImagenComoDataUrl(f));
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err));
                    }
                  }}
                />
              </Campo>
              {logo && (
                <img src={logo} alt="Logo" style={{ maxHeight: 70, marginTop: 6, borderRadius: 6 }} />
              )}
            </>
          )}

          {paso === 3 && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
              <h2>Listo</h2>
              <p className="tenue">Entrando…</p>
            </div>
          )}
        </div>

        {paso !== 3 && (
          <footer>
            {paso === 'restaurar' && !archivoElegido && (
              <button className="btn ancho" onClick={() => setPaso('inicio')}>
                ‹ Volver
              </button>
            )}
            {paso === 1 && (
              <div className="acciones" style={{ width: '100%' }}>
                <button className="btn" onClick={() => setPaso('inicio')}>
                  Atrás
                </button>
                <button
                  className="btn primario crece"
                  disabled={!paso1Listo}
                  onClick={() => setPaso(2)}
                >
                  Continuar
                </button>
              </div>
            )}
            {paso === 2 && (
              <div className="acciones" style={{ width: '100%' }}>
                <button className="btn" disabled={ocupado} onClick={() => setPaso(1)}>
                  Atrás
                </button>
                <button
                  className="btn crece"
                  disabled={ocupado}
                  onClick={() => void finalizar(false)}
                >
                  Saltar por ahora
                </button>
                <button
                  className="btn primario crece"
                  disabled={ocupado || razon.trim().length === 0 || rif.trim().length === 0}
                  onClick={() => void finalizar(true)}
                >
                  {ocupado ? 'Creando…' : 'Crear y entrar'}
                </button>
              </div>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}
