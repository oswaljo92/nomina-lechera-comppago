import { useState } from 'react';
import { useApp } from '../estado.tsx';
import { Aviso, Campo } from '../components/comunes.tsx';
import { crearUsuario, validarContrasena, validarNombre } from '../../core/auth/usuarios.ts';
import { guardarEmpresa } from '../../core/db/repo.ts';
import { leerImagenComoDataUrl } from '../util/imagen.ts';

/**
 * Asistente de primer arranque.
 *
 * Crea el primer usuario administrador y, si se quiere, la primera empresa.
 * Ya no hay clave de administrador compartida: cada persona tendrá la suya.
 */
export function PrimerArranque({ alTerminar }: { alTerminar: () => void }) {
  const { db, iniciarSesion, cambiado, guardarYa } = useApp();
  const [paso, setPaso] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const [nombre, setNombre] = useState('');
  const [clave, setClave] = useState('');
  const [clave2, setClave2] = useState('');
  const [razon, setRazon] = useState('');
  const [rif, setRif] = useState('');
  const [direccion, setDireccion] = useState('');
  const [logo, setLogo] = useState<string | null>(null);

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
            Vamos a crear tu usuario administrador. Todo se guarda únicamente en este equipo.
          </p>
        </header>

        <div className="cuerpo">
          <div className="pasos">
            {[1, 2].map((n) => (
              <div key={n} className={`paso${paso >= n ? ' hecho' : ''}`} />
            ))}
          </div>

          {error && (
            <Aviso nivel="error" titulo="No se pudo continuar">
              {error}
            </Aviso>
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

        {paso < 3 && (
          <footer>
            {paso === 1 && (
              <button
                className="btn primario ancho"
                disabled={!paso1Listo}
                onClick={() => setPaso(2)}
              >
                Continuar
              </button>
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
