import { useState } from 'react';
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

export function App() {
  const { db, usuario, plataforma, version, guardarYa, cerrarSesion } = useApp();
  const [pantalla, setPantalla] = useState<Pantalla>('cargar');
  const [nominaAbierta, setNominaAbierta] = useState<string | undefined>();
  const [miCuenta, setMiCuenta] = useState(false);
  // El asistente se decide UNA vez, al montar, y solo él decide cuándo termina.
  // Si se recalculara en cada render, crear el usuario bastaría para que la
  // condición dejara de cumplirse y el asistente desapareciera a mitad.
  const [enArranque, setEnArranque] = useState(() => !db.desactualizada && !hayUsuarios(db));
  void version;

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
        </div>

        <nav className="nav">
          {enlaces.map((e) => (
            <button
              key={e.id}
              aria-current={pantalla === e.id}
              title={e.titulo}
              aria-label={e.titulo}
              onClick={() => ir(e.id)}
            >
              <span className="icono">{e.icono}</span>
              <span className="etiqueta-nav">{e.titulo}</span>
              <span className="etiqueta-corta">{e.corto}</span>
              {e.cuenta !== undefined && e.cuenta > 0 && <span className="cuenta">{e.cuenta}</span>}
            </button>
          ))}
        </nav>

        <div className="pie-lateral">
          <button className="chip-usuario ancho" onClick={() => setMiCuenta(true)}>
            <span className={`avatar chico${usuario.rol === 'admin' ? ' admin' : ''}`}>
              {inicial}
            </span>
            <span>
              <span className="perfil">{usuario.nombre}</span>
              <span className="rol">
                {usuario.rol === 'admin' ? 'Administrador' : 'Usuario normal'}
              </span>
            </span>
          </button>
          <div className="entorno">{plataforma.etiqueta}</div>
        </div>
      </aside>

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
