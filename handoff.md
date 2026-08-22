# Handoff

## 1. Objetivo

Nómina Lechera CompPago: lee los reportes GAN0584 (leche) y GAN0594
(transporte) y genera comprobantes de pago por proveedor. Sesiones cubiertas
hasta ahora: arranque/restauración de datos, navegación en tableta, tasas del
BCV por Excel, el gran rediseño del comprobante (unión leche+flete), carga en
lote, un rediseño completo de Tasas BCV (borrado, paginación, buscador, año),
y la última tanda: nota de débito desglosada por leche/flete, conceptos
manuales que ahora pueden afectar el neto/total a facturar, y versión
automática de la app.

## 2. Estado actual

Todo está implementado, tipado sin errores (`npm run check`), pasa
`test:core`/`test:parser`, se probó a mano en el navegador (incluido el flujo
completo de vínculo leche+flete con los PDF reales de `entradas/`), está
commiteado y pusheado a `origin/master`, y compilado en
`release/win-unpacked/CompPago.exe`.

**Versión actual: `1.1.0`** (antes fija en `1.0.0` desde el commit inicial;
ver sección 3 sobre el mecanismo nuevo). Últimos commits:

```
cb31545 Comprobante: ND desglosada, conceptos manuales financieros y versión automática
e0fb5c4 Cargar en lote, perfil en el menú hamburguesa y rediseño de Tasas BCV
f5bb1b8 Rediseño del comprobante: Bs/L, columna Transf., zoom y unión leche+flete
```

Pendiente de decisión del usuario, no de código:

- Las fábricas de los PDF de prueba no tienen empresa asignada en Ajustes
  (los comprobantes muestran "Sin empresa" / "EMPRESA SIN CONFIGURAR"). No es
  un bug, falta cargarlo para nóminas reales.

Ya resuelto (no repetir):

- El duplicado "OSCAR ALBERTO PEREZ AÑEZ" en `GAN0594_4.pdf` (rutas 000581 y
  000140) es intencional: misma ruta, dos empresas distintas. No se debe
  unir.
- `ejemplos/` se eliminó; su contenido (los 4 PDF reales de semana 31/32) se
  movió a `entradas/`, que es ahora la única carpeta para PDF de prueba/reales
  (protegida en `.gitignore`). No crear una tercera carpeta.

## 3. Archivos y cambios

### Sesiones anteriores (ya en `master` antes de esta sesión)

**Arranque / restaurar / botón de pánico**
- `src/ui/screens/PrimerArranque.tsx` — paso inicial para elegir crear
  cuenta o restaurar un `.db` existente, con vista previa antes de confirmar.
- `src/core/db/basedatos.ts` — `esArchivoSqlite()`.
- `src/ui/components/RespaldarYBorrar.tsx` — hook compartido
  respaldar-antes-de-borrar.
- `src/ui/screens/BaseAnterior.tsx` — usa ese hook; aparece cuando
  `versionArchivo < VERSION_ESQUEMA` (ver nota sobre migraciones abajo).
- `src/ui/screens/Ajustes.tsx` — tarjeta "Zona de peligro" (vaciar la base).

**Navegación en tableta (primera versión)**
- `src/ui/App.tsx` — `NavPrincipal` extraído; menú hamburguesa + cajón
  lateral en el tramo 640–1023px.
- `src/ui/estilos.css` — reglas de ese tramo.

**Tasas del BCV (primera versión: carga manual)**
- `src/core/parser/numeros.ts` — `nombreDia()`.
- `src/core/db/tasasExcel.ts` — construir/leer el libro de Excel.
- `src/ui/screens/Tasas.tsx` — selector de semana ganadera, edición masiva,
  import/export a Excel.

**Comprobante (rediseño grande): Bs/L, Transf., unión leche+flete**
- `src/core/receipt/dibujo.ts` — precio en Bs/L, insignia y secciones del
  comprobante combinado.
- `src/core/types.ts` — `litrosTransf`, `LineaConcepto.origen`,
  `NotaDebitoCombinada`, permiso `vincular-proveedor`.
- `src/core/parser/parseNomina.ts` — columna "Transf." en transporte.
- `src/core/db/esquema.ts` — tabla `vinculos_proveedor`.
- `src/core/identidad.ts` — `digitosDocumento()`.
- `src/core/db/repo.ts` — `candidatosVinculo`, `vinculosProveedor`,
  `confirmarVinculo`, `rechazarVinculo`, `desvincularProveedor`,
  `vinculoConfirmadoDe`.
- `src/core/receipt/comprobanteCombinado.ts` — `construirComprobanteCombinado()`.
- `src/ui/components/ModalVinculo.tsx` — confirmar/descartar un vínculo.
- `src/ui/screens/Comprobantes.tsx` — detección de candidatos, `unidadDe()`.
- `src/ui/screens/Ajustes.tsx` — sección "Vínculos leche-transporte".

### Esta sesión

**Cargar nómina: guardado en lote** (`src/ui/screens/Cargar.tsx`)
- Botón "Guardar todas las listas (N)" cuando hay 2+ nóminas sin errores
  listas para guardar. Guarda secuencialmente (`guardarUno` extraído de
  `guardar`). Las que quedan bloqueadas (duplicado, conceptos sin
  clasificar) se quedan visibles en su propia tarjeta con su botón
  individual — no se pierden, no hace falta volver a soltar el archivo
  mientras no se cambie de pantalla (no hay persistencia en base de datos
  de "pendientes", es solo el estado de React de esa pantalla).

**Mi cuenta y navegación (`src/ui/components/MiCuenta.tsx`, `src/ui/App.tsx`, `src/ui/estilos.css`)**
- Alineados los campos "Contraseña nueva"/"Repítela" (el desajuste era por
  `align-items: flex-end` en `.linea` combinado con que solo uno de los dos
  campos tenía texto de ayuda; se movió el texto de ayuda fuera de la fila).
- El cajón hamburguesa (tramo tableta 640–1023px) ahora muestra el bloque de
  perfil completo al fondo (antes solo mostraba los enlaces de navegación) —
  se extrajo `PerfilPie` y se usa tanto en el riel de escritorio como en el
  cajón, con overrides de CSS para que no se reduzca a solo ícono ahí dentro.
- **Esta sesión, segunda tanda:** "Cerrar sesión" se movió del pie del modal
  a debajo del bloque de perfil; debajo de eso ahora aparece
  "Creado por Oswaldo Hernández · versión X.Y.Z".

**Tasas BCV: rediseño completo** (`src/ui/screens/Tasas.tsx`, `src/core/db/tasasExcel.ts`, `src/ui/estilos.css`)
- Eliminar tasas individual o en lote, con confirmación (`<Confirmar>`, antes
  no existía ninguna confirmación).
- Paginación real (números de página + elipsis + selector 10/20/50/100) en
  vez del scroll interno que tenía la tabla.
- Buscador (mismo patrón que Comprobantes) y selector de año (por defecto
  "Todos los años").
- Columna "Semana ganadera" muestra solo el número (antes "Nº 32 · 2026").
- Al importar un Excel, si la columna "Dif. Cambio" del archivo viene
  vacía, se muestra un aviso explicando que se calcula sola (esa columna
  nunca se ha importado, solo se mostraba/exportaba).

**Comprobante: nota de débito desglosada** (`src/core/receipt/dibujo.ts`, `src/core/calc/calcular.ts`)
- Se intercambió el orden/colores de las dos cajas: ahora "TOTAL A
  FACTURAR" va primero con el fondo verde oscuro, y "NETO A PAGAR" segundo
  con el verde claro (antes era al revés).
- La nota de débito se redondea hacia arriba (`Math.ceil`, antes
  `Math.round`) — único punto de cálculo (`calcularNotaDebito`), cubre
  también cada lado de un comprobante combinado.
- Debajo de "NOTA DE DÉBITO [total]" ahora aparece, cuando el proveedor está
  vinculado (leche+flete): dos líneas chicas "Leche: X Bs" / "Flete: Y Bs" (el
  desglose del monto), y debajo una tabla con columnas SERV, LITROS,
  PRECIO $/L, TASA INICIO, TASA FINAL — reemplaza el texto de fórmula que
  había antes. Precio ya en dólares por litro (antes se mostraba convertido a
  Bs/L).

**Conceptos manuales, ahora con efecto financiero opcional**
- `src/core/types.ts` — `ConceptoManual.efecto: 'suma' | 'resta' | null`
  (`null` = informativo, el comportamiento de siempre).
- `src/core/db/esquema.ts` + `src/core/db/basedatos.ts` — columna nueva
  `efecto` en `conceptos_manual`. **Importante:** esta migración es aditiva
  (`ALTER TABLE ... ADD COLUMN`, guardado por un `PRAGMA table_info` check
  dentro de `migrar()`) y **no** subió `VERSION_ESQUEMA` — ese número solo
  debe subir para cambios que rompen compatibilidad, porque
  `BaseAnterior.tsx` fuerza a respaldar y borrar toda la base cuando
  `versionArchivo < VERSION_ESQUEMA`. Si en el futuro hace falta otra
  columna/tabla aditiva, seguir el mismo patrón (no tocar
  `VERSION_ESQUEMA`).
- `src/core/calc/calcular.ts` — `calcularRegistro` ahora suma/resta
  `centimos` de los manuales con `efecto` al **neto** y al **total a
  facturar** (nunca al bruto ni a las deducciones, que siguen reflejando
  solo lo impreso en el PDF, para no romper el cuadre contra el PDF de
  `Cargar.tsx`).
- `src/core/db/repo.ts` — `agregarConceptoManual` ahora recibe `efecto`;
  nueva función `editarConceptoManual` (antes solo existía alta y borrado,
  y el borrado ni siquiera estaba conectado a la UI).
- `src/ui/components/ModalConceptoManual.tsx` — rediseño: elegir un
  concepto ya existente del catálogo (con sugerencia automática de
  suma/resta según su `clase`/`restaFacturacion` — p. ej. los códigos 0090
  "Faltante" y 0092 "Agua Transporte" sugieren "resta") o crear uno nuevo;
  checkbox "Afecta el Neto a pagar y el Total a facturar" con radio
  Suma/Resta; lista "Ya agregados" con Editar/Eliminar cuando el modal se
  abre para un solo proveedor; el campo Litros ahora se anuncia como
  "N L sin pagar" en el comprobante. Se quitó el aviso fijo "Es
  informativo" (ya no siempre es cierto).
- `src/core/receipt/dibujo.ts` — se quitó el texto
  "Información de referencia. No afecta..."; los montos con `efecto`
  llevan un prefijo `+`/`-`.
- `src/ui/screens/Comprobantes.tsx` — pasa `catalogo` y `existentes` al
  modal, conecta `alEditar`/`alEliminar`.

**Nota clave de arquitectura** (para no repetir la confusión de esta
sesión): las columnas Neto/Total a facturar que se ven en la **tabla** de
`Comprobantes.tsx` son valores **guardados** en `registros` (calculados una
sola vez al cargar la nómina, con `manuales: []` — ver `repo.ts:300`). Los
conceptos manuales **no** actualizan esas columnas de la tabla. Donde sí se
recalculan en vivo con los manuales reales es en `comprobante.ts` y
`comprobanteCombinado.ts` (`calcularRegistro(..., manuales, ...)`), que es lo
que arma el PDF/imagen real. Si se necesita ver el efecto de un concepto
manual, hay que mirar la vista previa/PDF, no la tabla de la lista.

**Versión automática de la app**
- `vite.config.ts` — lee `package.json` en build time y expone
  `__APP_VERSION__` vía `define`.
- `src/vite-env.d.ts` (nuevo) — `declare const __APP_VERSION__: string;`.
- `package.json` — `version` subido de `1.0.0` a `1.1.0`.
- **Convención a seguir de ahora en adelante** (no hay automatización real,
  es un criterio a aplicar en cada tanda de cambios antes de commitear):
  `patch` = corrección de errores sin funcionalidad nueva; `minor` =
  funcionalidad nueva o cambios de UI que no rompen datos existentes; `major`
  = cambios que rompen compatibilidad de datos (equivalente a subir
  `VERSION_ESQUEMA`) o rediseños grandes de flujo. El número sale de
  `package.json`, así que una vez editado el próximo build ya lo muestra
  solo.

**Empaquetado**
- `npm run electron:build` genera `release/win-unpacked/CompPago.exe` y
  `release/CompPago-1.1.0-windows.zip`. Se corrió al final de esta sesión.

## 4. Intentos fallidos / notas técnicas

- Automatizar clics de mouse (`computer.left_click`) no siempre disparaba
  los manejadores de React en el navegador de pruebas — hubo que usar
  `elemento.click()` por JavaScript directo.
- Asignar archivos a un `<input type=file>` con `DataTransfer` a veces falla
  (longitud 0) sin razón clara la primera vez; repetir el mismo código
  suele funcionar. Verificar el resultado antes de asumir que falló.
- Para simular la elección de un archivo en el diálogo nativo (usado en
  `plataforma.archivos.abrir`, que crea un `<input type=file>` dinámico y
  llama a `.click()`), se puede interceptar sobrescribiendo temporalmente
  `HTMLInputElement.prototype.click` para que, si `this.type === 'file'`,
  asigne un `DataTransfer` propio y dispare `change` en vez de abrir el
  diálogo del sistema operativo. Útil para probar importaciones de Excel
  por script.
- Para inspeccionar una imagen grande generada en el navegador de pruebas
  (p. ej. la vista previa del comprobante, que es un `<img>` con `blob:`
  URL): hay que reducirla con un `<canvas>` a un ancho razonable (~700px)
  antes de pedir el `toDataURL()`, porque el string base64 completo excede
  el límite de tokens de una sola respuesta de `javascript_tool`. Si aun
  así excede el límite, la herramienta guarda el resultado en un archivo
  `.txt` (formato JSON `[{type,text}]`) — usar Node/Bash para extraer la
  parte base64 y decodificarla a un `.png` real antes de leerla con `Read`.
- `exceljs` no tiene `Buffer` de Node disponible en el build principal — se
  resolvió con `as any` en `workbook.xlsx.load()`, comentado.
- **Migraciones de esquema**: `VERSION_ESQUEMA` (en `esquema.ts`) es
  deliberadamente destructivo — subirlo hace que `BaseAnterior.tsx` fuerce a
  respaldar y vaciar toda la base. Para agregar una columna nueva a una
  tabla existente sin romper archivos ya guardados, usar el patrón de
  `basedatos.ts`: `PRAGMA table_info(tabla)` para ver si la columna ya
  existe, y si no, `ALTER TABLE ... ADD COLUMN` dentro de `migrar()`, sin
  tocar `VERSION_ESQUEMA`.
- El servidor de pruebas del navegador necesita `.claude/launch.json` en la
  carpeta raíz (`C:\Users\usuario\OneDrive\OSWALDO\LACTALIS\.claude\launch.json`,
  no dentro de `nomina-lechera-comppago\.claude\`) apuntando a
  `npm --prefix nomina-lechera-comppago run dev`, puerto 5173 — ya está
  creado, no hace falta rehacerlo.
- El navegador de pruebas usa almacenamiento OPFS persistente por origen: la
  sesión de usuario ("Oswaldo") y los datos cargados (incluidas las 4
  nóminas de `entradas/` y varias tasas de prueba de 2024-2026) sobreviven
  entre reinicios del servidor de dev dentro de la misma sesión de trabajo.
  No es la base de datos real de Electron, es aparte.

## 5. Próximos pasos

1. Cargar los datos de empresa por fábrica en Ajustes para que los
   comprobantes reales no muestren "Sin empresa" (único pendiente real).
2. Si se agregan más PDF de referencia, van en `entradas/` (ya no existe
   `ejemplos/`).
3. Al hacer la próxima tanda de cambios, recordar subir `package.json`
   (`npm version patch|minor|major` o edición manual) según el criterio de
   la sección 3, antes de compilar/commitear.
