import { useEffect, useRef, useState } from 'react';
import { useApp } from './estado.tsx';
import { contarAdministradores, hayUsuarios } from '../core/auth/usuarios.ts';
import { listarCatalogo, listarNominas } from '../core/db/repo.ts';
import { PrimerArranque } from './screens/PrimerArranque.tsx';
import { IniciarSesion } from './screens/IniciarSesion.tsx';
import { BaseAnterior } from './screens/BaseAnterior.tsx';
import { Cargar } from './screens/Cargar.tsx';
import { Comprobantes } from './screens/Comprobantes.tsx';
import { Tasas } from './screens/Tasas.tsx';
import { Historico } from './screens/Historico.tsx';
import { BitacoraPantalla } from './screens/BitacoraPantalla.tsx';
import { Ajustes } from './screens/Ajustes.tsx';
import { MiCuenta } from './components/MiCuenta.tsx';

type Pantalla = 'cargar' | 'comprobantes' | 'tasas' | 'historico' | 'bitacora' | 'ajustes';

interface Enlace {
  id: Pantalla;
  icono: string;
  titulo: string;
  corto: string;
  cuenta?: number;
}

interface UsuarioSesion {
  nombre: string;
  rol: string;
}

/**
 * Bloque de perfil (avatar, nombre, rol, entorno) que abre "Mi cuenta". Se
 * reutiliza tanto en el pie del riel lateral como al fondo del cajón que
 * abre el botón hamburguesa, para que el perfil sea alcanzable en ambos.
 */
function PerfilPie({
  usuario,
  entorno,
  onAbrir,
}: {
  usuario: UsuarioSesion;
  entorno: string;
  onAbrir: () => void;
}) {
  const inicial = usuario.nombre.trim().charAt(0).toUpperCase();
  return (
    <div className="pie-lateral">
      <button className="chip-usuario ancho" onClick={onAbrir}>
        <span className={`avatar chico${usuario.rol === 'admin' ? ' admin' : ''}`}>{inicial}</span>
        <span>
          <span className="perfil">{usuario.nombre}</span>
          <span className="rol">{usuario.rol === 'admin' ? 'Administrador' : 'Usuario normal'}</span>
        </span>
      </button>
      <div className="entorno">{entorno}</div>
    </div>
  );
}

/**
 * Lista de navegación. Se usa tanto en el riel permanente (donde en tableta
 * el CSS la reduce a solo íconos) como dentro del cajón que abre el botón
 * hamburguesa (donde el CSS fuerza etiquetas completas, como en escritorio).
 */
function NavPrincipal({
  enlaces,
  pantalla,
  ir,
  alSeleccionar,
}: {
  enlaces: Enlace[];
  pantalla: Pantalla;
  ir: (id: Pantalla) => void;
  alSeleccionar?: () => void;
}) {
  return (
    <nav className="nav">
      {enlaces.map((e) => (
        <button
          key={e.id}
          aria-current={pantalla === e.id}
          title={e.titulo}
          aria-label={e.titulo}
          onClick={() => {
            ir(e.id);
            alSeleccionar?.();
          }}
        >
          <span className="icono">{e.icono}</span>
          <span className="etiqueta-nav">{e.titulo}</span>
          <span className="etiqueta-corta">{e.corto}</span>
          {e.cuenta !== undefined && e.cuenta > 0 && <span className="cuenta">{e.cuenta}</span>}
        </button>
      ))}
    </nav>
  );
}

export function App() {
  const { db, usuario, plataforma, version, guardarYa, cerrarSesion } = useApp();
  const [pantalla, setPantalla] = useState<Pantalla>('cargar');
  const [nominaAbierta, setNominaAbierta] = useState<string | undefined>();
  const [miCuenta, setMiCuenta] = useState(false);
  // Solo tiene efecto visual en el tramo tableta (el CSS lo ignora fuera de
  // ese rango); si la ventana se agranda con el cajón abierto, el media
  // query deja de aplicar «display: flex» y desaparece solo, sin necesidad
  // de escuchar el resize.
  const [menuAbierto, setMenuAbierto] = useState(false);
  const cajonRef = useRef<HTMLDivElement>(null);
  // El asistente se decide UNA vez, al montar, y solo él decide cuándo termina.
  // Si se recalculara en cada render, crear el usuario bastaría para que la
  // condición dejara de cumplirse y el asistente desapareciera a mitad.
  const [enArranque, setEnArranque] = useState(() => !db.desactualizada && !hayUsuarios(db));
  void version;

  useEffect(() => {
    if (!menuAbierto) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuAbierto(false);
    };
    document.addEventListener('keydown', alTeclear);
    cajonRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => document.removeEventListener('keydown', alTeclear);
  }, [menuAbierto]);

  if (db.desactualizada) return <BaseAnterior />;
  if (enArranque) return <PrimerArranque alTerminar={() => setEnArranque(false)} />;
  if (!usuario) return <IniciarSesion />;

  const nominas = listarNominas(db);
  const sinClasificar = listarCatalogo(db).filter((c) => !c.clasificado).length;
  const soloUnAdmin = usuario.rol === 'admin' && contarAdministradores(db) === 1;

  const enlaces: Enlace[] = [
    { id: 'cargar', icono: '📥', titulo: 'Cargar nómina', corto: 'Cargar' },
    {
      id: 'comprobantes',
      icono: '🧾',
      titulo: 'Comprobantes',
      corto: 'Compro.',
      cuenta: nominas.length,
    },
    { id: 'tasas', icono: '💱', titulo: 'Tasas BCV', corto: 'Tasas' },
    { id: 'historico', icono: '🗂', titulo: 'Histórico', corto: 'Histór.' },
    { id: 'bitacora', icono: '📓', titulo: 'Bitácora', corto: 'Bitác.' },
    {
      id: 'ajustes',
      icono: '⚙️',
      titulo: 'Ajustes',
      corto: 'Ajustes',
      cuenta: (sinClasificar || 0) + (soloUnAdmin ? 1 : 0) || undefined,
    },
  ];

  function abrirNomina(id: string) {
    setNominaAbierta(id);
    setPantalla('comprobantes');
  }

  function ir(id: Pantalla) {
    setPantalla(id);
    if (id !== 'comprobantes') setNominaAbierta(undefined);
  }

  const inicial = usuario.nombre.trim().charAt(0).toUpperCase();

  return (
    <div className="app">
      {/* Cabecera compacta: solo visible en pantallas pequeñas, donde la barra
          lateral se convierte en una barra inferior sin espacio para el perfil. */}
      <header className="cabecera-movil">
        <div className="marca-movil">
          <strong>CompPago</strong>
        </div>
        <button className="chip-usuario" onClick={() => setMiCuenta(true)}>
          <span className={`avatar chico${usuario.rol === 'admin' ? ' admin' : ''}`}>{inicial}</span>
          <span className="nombre-usuario">{usuario.nombre}</span>
        </button>
      </header>

      <aside className="lateral">
        <div className="marca">
          <strong>CompPago</strong>
          <span>Nómina Lechera · Comprobantes de pago</span>
          <button
            type="button"
            className="boton-menu"
            aria-expanded={menuAbierto}
            aria-controls="cajon-nav-tableta"
            aria-label={menuAbierto ? 'Cerrar menú' : 'Abrir menú'}
            onClick={() => setMenuAbierto((v) => !v)}
          >
            ☰
          </button>
        </div>

        <NavPrincipal enlaces={enlaces} pantalla={pantalla} ir={ir} />

        <PerfilPie
          usuario={usuario}
          entorno={plataforma.etiqueta}
          onAbrir={() => setMiCuenta(true)}
        />
      </aside>

      {/* Siempre montado: la visibilidad la decide el CSS del tramo tableta,
          para que al agrandar la ventana con el cajón abierto desaparezca
          solo, sin depender de un listener de resize. */}
      <div
        id="cajon-nav-tableta"
        className={`fondo-menu${menuAbierto ? ' abierto' : ''}`}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setMenuAbierto(false);
        }}
      >
        <div className="cajon-nav" role="dialog" aria-modal="true" ref={cajonRef}>
          <div className="cajon-cabecera">
            <strong>CompPago</strong>
            <button className="cerrar" onClick={() => setMenuAbierto(false)} aria-label="Cerrar menú">
              ×
            </button>
          </div>
          <NavPrincipal
            enlaces={enlaces}
            pantalla={pantalla}
            ir={ir}
            alSeleccionar={() => setMenuAbierto(false)}
          />
          <PerfilPie
            usuario={usuario}
            entorno={plataforma.etiqueta}
            onAbrir={() => {
              setMiCuenta(true);
              setMenuAbierto(false);
            }}
          />
        </div>
      </div>

      <main className="principal">
        <div className="contenido">
          {pantalla === 'cargar' && <Cargar alGuardar={abrirNomina} />}
          {pantalla === 'comprobantes' && <Comprobantes nominaIdInicial={nominaAbierta} />}
          {pantalla === 'tasas' && <Tasas />}
          {pantalla === 'historico' && <Historico alAbrirNomina={abrirNomina} />}
          {pantalla === 'bitacora' && <BitacoraPantalla />}
          {pantalla === 'ajustes' && <Ajustes />}
        </div>
      </main>

      {miCuenta && (
        <MiCuenta
          alCerrar={() => setMiCuenta(false)}
          alSalir={() => {
            void guardarYa().then(() => {
              setMiCuenta(false);
              cerrarSesion();
            });
          }}
        />
      )}
    </div>
  );
}
