# Nómina Lechera CompPago

Lee los reportes de nómina ganadera en PDF y genera los comprobantes de pago de
cada proveedor.

Todo el procesamiento ocurre en el equipo del usuario. Ni los PDF ni los datos
de los proveedores viajan por la red en ningún momento; se puede comprobar
usando la aplicación con la conexión apagada.

---

## Los cuatro números del comprobante

```
BRUTO             = Σ conceptos de clase «pago»
NETO A PAGAR      = Bruto − todas las deducciones
TOTAL A FACTURAR  = Bruto − solo las deducciones marcadas «resta facturación»
NOTA DE DÉBITO    = litros × precio $/L × ( tasa[fecha elegida] − tasa[inicio de semana] )
```

El **ISLR no resta** del total a facturar: es una retención, no un descuento.
El proveedor factura el monto completo y la empresa se lo retiene. Los
descuentos operativos —insumos, faltantes, agua de transporte— sí restan.

Los **conceptos manuales son informativos**: aparecen en el comprobante pero no
alteran ninguna de las cuatro cifras.

### Catálogo de conceptos

| Código | Nombre | Clase | ¿Resta de lo facturable? |
|---|---|---|---|
| 0003 | Flete | Pago | — |
| 0039 | Leche Fresca | Pago | — |
| 0051 | Insumos Ganaderos | Deducción | Sí |
| 0090 | Faltante | Deducción | Sí |
| 0092 | Agua Transporte | Deducción | Sí |
| 0486 / 0487 | ISLR | Deducción | No (retención) |
| 0999 | *sin clasificar* | Deducción | **pendiente** |

Si un PDF trae un código que el catálogo no conoce, **la aplicación se niega a
guardar esa nómina** hasta que un administrador lo clasifique. Calcular a
ciegas produciría comprobantes con cifras equivocadas sin que nadie lo notara.

---

## Uso

```bash
npm install
npm run dev          # desarrollo en http://localhost:5173
npm run build        # compila la versión web en dist/
npm run check        # comprobación de tipos
npm run test:parser  # lectura de los PDF de fixtures/ y su cuadre
npm run test:core    # usuarios, permisos, base de datos, cálculos y bitácora
```

### Publicar la versión web

`npm run build` deja todo en `dist/`. Es un sitio estático: sirve la carpeta
tal cual en Cloudflare Pages, Netlify, GitHub Pages o el IIS interno de la
empresa. Requiere **HTTPS**, porque el almacenamiento persistente del navegador
(OPFS) solo funciona en contexto seguro.

Una vez abierta, la aplicación se puede **instalar como PWA** desde el propio
navegador: queda con su ícono en el menú de inicio, abre en ventana propia y
funciona sin conexión. Es la forma recomendada de usarla en un equipo
corporativo, porque no es un ejecutable y no pasa por SmartScreen ni AppLocker.

### Compilar la versión de escritorio (solo Windows)

```bash
npm run build
npx electron-builder --win dir
node scripts/pack-desktop.mjs
```

La aplicación de escritorio es **solo para Windows**: no se compila ni se mantiene para
macOS ni Linux. La ventana recuerda su tamaño y posición entre sesiones, y admite
estrecharse hasta 380 px para comprobar el diseño adaptable sin salir de ella.

Deja en `release/`:

- `CompPago-1.0.0-windows.zip` — carpeta comprimida, se descomprime y se
  ejecuta `CompPago.exe` sin instalar nada.
- `HOJA-PARA-SISTEMAS.txt` — huellas SHA-256 y lista de permisos, por si hay
  que pedir autorización al departamento de sistemas.

---

## Sobre las restricciones corporativas

**No se puede garantizar que el .exe corra en una laptop con políticas
restrictivas.** Estas son las mitigaciones aplicadas y su alcance real:

| Medida | Qué evita |
|---|---|
| Se distribuye como carpeta comprimida, no como auto-extraíble | No se ejecuta desde `%TEMP%`, que es el patrón que más políticas bloquean |
| Manifiesto `asInvoker` | Nunca pide elevación ni clave de administrador |
| Base de datos junto al ejecutable, no en `AppData` | No toca rutas vigiladas |
| Sin red, sin actualizador, sin telemetría | No genera tráfico que dispare alertas |

Frente a **SmartScreen** basta con *Más información → Ejecutar de todas formas*,
sin privilegios. Frente a **AppLocker o WDAC** no hay nada que hacer desde la
aplicación: si la política prohíbe ejecutables no firmados, no correrá. Para ese
caso está la versión web, que es la principal.

*Nota:* el ejecutable conserva el ícono genérico de Electron porque el paso que
lo personaliza va unido al de firma digital, y ese se desactivó (intenta crear
enlaces simbólicos que Windows no permite sin privilegios elevados). Al añadir
un certificado de firma se resuelven ambas cosas a la vez.

---

## Usuarios y trazabilidad

Cada persona entra con **su propio usuario y contraseña**. No hay ninguna clave
compartida. Eso es lo que hace útil a la bitácora: mientras cualquiera podía
elegir el nombre de un colega para entrar, lo que quedaba anotado a su nombre no
probaba nada.

- **Contraseña por usuario**, guardada solo como hash PBKDF2-SHA256 con 600 000
  iteraciones y una sal distinta para cada uno.
- **Freno a la fuerza bruta**: tras 5 intentos fallidos el acceso se bloquea con
  una espera que se duplica en cada fallo. El contador vive en la base de datos,
  así que recargar la página o reabrir la aplicación no lo esquiva.
- **Contraseñas temporales**: al crear un usuario o restablecerle la contraseña
  se le asigna una temporal, y la aplicación le obliga a definir la suya en el
  primer inicio de sesión.
- **Bitácora encadenada**: cada entrada guarda el hash de la anterior y el
  sistema ancla el hash de la última. Detecta modificaciones, borrados
  intermedios, truncados por el final y borrado completo. Registra también los
  inicios de sesión, los intentos fallidos y los cambios de contraseña. Nadie
  puede eliminarla, ni siquiera un administrador.

  *Alcance honesto:* el encadenado **detecta** manipulación, no la impide. Quien
  tenga el archivo de base de datos y conozca el algoritmo podría reconstruir la
  cadena entera. Frente al caso real —que alguien borre algo y lo niegue— es
  eficaz. Para cerrar ese hueco por completo haría falta cifrar la base.

### ⚠ No hay recuperación de contraseña

No existe código de recuperación ni correo desde donde restablecerla: **solo un
administrador puede restablecer la contraseña de otro usuario**. La consecuencia
es concreta: si queda un único administrador y olvida la suya, el acceso
administrativo se pierde de forma definitiva. Los datos siguen ahí, pero para
recuperar el control habría que restaurar un respaldo anterior.

Para que ese escenario sea difícil de alcanzar, la aplicación **bloquea**
eliminar, desactivar o degradar al último administrador activo, y muestra un
aviso permanente mientras solo haya uno. **Crea siempre un segundo
administrador**: cada uno podrá restablecer la contraseña del otro.

### Permisos

| Acción | Normal | Admin |
|---|---|---|
| Cargar nóminas, consultar, generar comprobantes | ✅ | ✅ |
| Conceptos manuales, notas de débito, tasas BCV | ✅ | ✅ |
| Exportar e importar histórico | ✅ | ✅ |
| Ver la bitácora · cambiar su propia contraseña | ✅ | ✅ |
| Borrar nóminas o histórico | ❌ | ✅ |
| Crear, editar y eliminar usuarios | ❌ | ✅ |
| Restablecer la contraseña de otro usuario | ❌ | ✅ |
| Editar empresas y clasificar conceptos | ❌ | ✅ |
| Borrar la bitácora | ❌ | ❌ |

## Diseño adaptable

La interfaz funciona desde un teléfono de 360 px hasta un monitor ancho, y en la
aplicación de escritorio la ventana se puede estrechar hasta 380 px.

| Ancho de ventana | Navegación | Contenido |
|---|---|---|
| < 640 px | Barra inferior con iconos | Tarjetas · modales a pantalla completa · botones de 44 px |
| 640–1023 px | Riel lateral de iconos | Según el ancho disponible |
| ≥ 1024 px | Barra lateral completa | Tabla |

Las **tablas** no deciden su forma por el ancho de la ventana sino por el de su
propio contenedor, con `@container`. La diferencia importa: con la barra lateral
ocupando 232 px, un portátil de 1024 px deja 792 px de contenido, y mirando la
ventana se le darían tarjetas sin necesidad. Por debajo de 760 px de contenedor
cada fila pasa a ser una tarjeta y cada celda muestra su encabezado, porque sin
la cabecera de la tabla las cifras quedarían sin identificar.

Se descartaron las alternativas habituales: el **desplazamiento horizontal** con
9 columnas hace perder de vista de quién es cada cifra, y las **columnas
prioritarias** obligan a esconder justo lo que se va a mirar (neto, total a
facturar, nota de débito).

---

## Compartir el histórico con un colega

- **Exportar / Importar** (`.lecdb`) — fusiona sin borrar. Compara por
  `(tipo, año, número)`, informa qué es nuevo, duplicado o conflictivo, y solo
  agrega. Los conceptos que lleguen del otro equipo entran **sin clasificar**
  aunque vinieran clasificados, para que un administrador local los revise.
- **Respaldo / Restaurar** (`.db`) — copia exacta de toda la base. Restaurar
  **reemplaza todo**, incluida la bitácora. Es para recuperación, no para
  fusionar.

---

## Arquitectura

```
src/core/       Parser, validación, cálculos, base de datos, bitácora,
                permisos y sincronización. Sin dependencias de plataforma.
src/ui/         React: pantallas y renderizado del comprobante.
src/platform/   Contrato { db.cargar/guardar, archivos.guardar/abrir }
                y sus dos adaptadores.
electron/       Proceso principal y puente del escritorio.
fixtures/       PDF reales usados como prueba del parser.
```

Web y escritorio comparten prácticamente todo el código: solo cambia el
adaptador de plataforma.

| Capa | Elección | Motivo |
|---|---|---|
| Lectura de PDF | `pdfjs-dist` por coordenadas | Los reportes traen texto; el OCR solo añadiría errores |
| Base de datos | `sql.js` (SQLite en WebAssembly) | SQLite real sin módulos nativos que recompilar por plataforma |
| Persistencia web | OPFS, con IndexedDB de respaldo | Sobrevive al cierre del navegador |
| Persistencia escritorio | `datos/lectorocr.db` (el nombre del archivo interno se mantiene por compatibilidad) junto al .exe | Hace la aplicación realmente portable |
| Comprobante | Dibujo explícito → canvas (PNG) y jsPDF (PDF) | Ver abajo |

### Por qué el comprobante se dibuja en vez de fotografiarse

El primer diseño capturaba el DOM con `html-to-image`. Se descartó al comprobar
que esa técnica rasteriza mediante un `<foreignObject>` de SVG, que el navegador
solo resuelve **mientras la página se está pintando**: bastaba con minimizar la
ventana o cambiar de pestaña para que un lote de decenas de comprobantes se
quedara congelado.

Dibujar el comprobante como una lista de primitivas y renderizarla dos veces
—canvas para el PNG, jsPDF para el PDF— resuelve eso y de paso deja el **texto
del PDF seleccionable y buscable**, en lugar de ser una imagen.

### Detalles del formato

- Los montos se manejan como **enteros de céntimos**, no como decimales de coma
  flotante. La validación compara sumas contra los totales impresos en el PDF, y
  con céntimos enteros esa comparación es exacta y no necesita tolerancias.
- El PDF usa las fuentes estándar (WinAnsi), que cubren el español completo. Los
  signos tipográficos que no existen en esa codificación se sustituyen por su
  equivalente ASCII para que la imagen y el PDF salgan idénticos.
- La hoja **se ajusta al contenido** en lugar de forzar un A4 completo: un
  comprobante corto dejaría media página en blanco, que enviado por WhatsApp se
  ve como una imagen a medias.

### Nombres de archivo

```
LACTEOS PROLAMAR C.A._23_008351.pdf
└── nombre ───────────┘ └┘ └──────┘
                    nómina  código del proveedor
```

El reporte corta los nombres a unos 30 caracteres. En *Ajustes → Nombres de
proveedores* se escribe el nombre completo una sola vez por código y se usa en
todos sus comprobantes.
