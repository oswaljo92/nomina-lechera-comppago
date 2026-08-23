# Handoff

## 1. Objetivo

Nómina Lechera CompPago: lee los reportes GAN0584 (leche) y GAN0594
(transporte) y genera comprobantes de pago por proveedor. Sesiones cubiertas
hasta ahora: arranque/restauración de datos, navegación en tableta, tasas del
BCV por Excel, el gran rediseño del comprobante (unión leche+flete), carga en
lote, un rediseño completo de Tasas BCV (borrado, paginación, buscador, año),
conceptos manuales financieros y nota de débito desglosada, "Cerrar sesión"
en el riel, semana ganadera calculada por calendario (sin depender de
nóminas cargadas), la Nota de Débito como documento independiente
descargable, corrección visual de la celda "Tasa BCV" y del botón "Cerrar
sesión", varios ajustes de texto/alineación en la Nota de Débito, y la
última tanda: interruptor para unir/separar factura y ND, agrupación de
2+ códigos del mismo tipo (mismo proveedor con varios códigos de leche o de
transporte), y un selector de formato único (PDF/Imagen) que simplifica la
descarga de factura y ND por separado.

## 2. Estado actual

Todo está implementado, tipado sin errores (`npm run check`), pasa
`test:core`/`test:parser` (incluidas pruebas nuevas de la agrupación mismo
tipo: suma correcta, exclusión mutua con vínculos cruzados, disolución de
grupo), se probó a mano en el navegador con datos reales de `entradas/`
(candidato de agrupación real detectado y confirmado, factura combinada
descargada y leída, desglose por código verificado, interruptor de
separar ND verificado persistente tras recargar), está commiteado y
pusheado a `origin/master`, y compilado en
`release/CompPago-1.3.0-windows.zip` (`npm run electron:build` completo).

**Versión actual: `1.3.0`** (subida en esta tanda, ver sección 3).

Últimos commits:

```
(este commit) Interruptor unir/separar ND, agrupación de códigos del mismo tipo, selector de formato único; sube a 1.3.0
0100869 Corrige alineación de Tasa BCV, botón de cerrar sesión y ajustes de Nota de Débito; sube a 1.2.0
486eed7 Cerrar sesión en el riel, semanas ganaderas por calendario, y Nota de Débito independiente
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

**Navegación en tableta / carga en lote / Tasas BCV (primer rediseño)**
- `src/ui/App.tsx` — `NavPrincipal`/`PerfilPie` extraídos; menú hamburguesa +
  cajón lateral en el tramo 640–1023px.
- `src/ui/screens/Cargar.tsx` — botón "Guardar todas las listas (N)"; las
  nóminas bloqueadas (duplicado, conceptos sin clasificar) se quedan
  visibles en su tarjeta sin perderse mientras no se cambie de pantalla.
- `src/ui/screens/Tasas.tsx` — primer rediseño: eliminar individual/lote con
  confirmación, paginación real, buscador, filtro de año, columna "Semana
  ganadera" solo con el número, aviso si "Dif. Cambio" del Excel viene vacía.
- `src/ui/components/MiCuenta.tsx` — alineación de campos de contraseña.

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

**Comprobante: ND desglosada por leche/flete, conceptos manuales financieros, versión automática**
- `src/core/receipt/dibujo.ts` — cajas "TOTAL A FACTURAR"/"NETO A PAGAR"
  intercambiadas (orden y color); debajo de "NOTA DE DÉBITO" aparece el
  desglose Leche/Flete y una tabla SERV/LITROS/PRECIO $/L/TASA INICIO/TASA
  FINAL; se quitó el texto "Información de referencia...".
- `src/core/calc/calcular.ts` — ND redondeada hacia arriba (`Math.ceil`).
- `src/core/types.ts` + `src/core/db/esquema.ts`/`basedatos.ts` —
  `ConceptoManual.efecto: 'suma'|'resta'|null`; columna `efecto` agregada de
  forma **aditiva** (`ALTER TABLE`, sin subir `VERSION_ESQUEMA`).
- `src/core/calc/calcular.ts` — `calcularRegistro` suma/resta los manuales
  con `efecto` al neto y al total a facturar (nunca al bruto/deducciones).
- `src/core/db/repo.ts` — `agregarConceptoManual` con `efecto`; nueva
  `editarConceptoManual`.
- `src/ui/components/ModalConceptoManual.tsx` — elegir del catálogo o crear
  nuevo, checkbox de afectar totales, lista "Ya agregados" con
  Editar/Eliminar, litros como "N L sin pagar".
- `vite.config.ts` + `src/vite-env.d.ts` — `__APP_VERSION__` inyectada desde
  `package.json` en build time; se muestra en "Mi cuenta".

**Nota clave de arquitectura** (para no repetir la confusión): las columnas
Neto/Total a facturar de la **tabla** de `Comprobantes.tsx` son valores
**guardados** en `registros` (calculados una sola vez al cargar la nómina,
con `manuales: []`, ver `repo.ts:300`) — los conceptos manuales **no** las
actualizan ahí. Donde sí se recalculan en vivo es en `comprobante.ts`/
`comprobanteCombinado.ts` (lo que arma el PDF real). Para ver el efecto de un
concepto manual hay que mirar la vista previa/PDF, no la tabla de la lista.

### Sesión anterior

**"Cerrar sesión" al riel lateral** (`src/ui/App.tsx`, `src/ui/components/MiCuenta.tsx`, `src/ui/estilos.css`)
- `PerfilPie` (en `App.tsx`) gana un botón "Cerrar sesión" propio, entre el
  chip de perfil y la línea "Escritorio · Electron...". Se quitó del pie del
  modal "Mi cuenta" en escritorio/tableta.
- **Excepción teléfono**: en `<640px` el riel completo está oculto
  (`.marca, .pie-lateral { display: none; }`), así que el botón se mantiene
  en el modal *solo* ahí, mostrado con la clase `.salir-movil`.
- **Bug encontrado y corregido durante la prueba**: la regla
  `.salir-movil { display: none; }` no aplicaba porque `.btn` (definida más
  abajo en `estilos.css`) también fija `display` y le ganaba por orden de
  aparición, pese a tener la misma especificidad. Se resolvió subiendo la
  especificidad a `.btn.salir-movil` en ambas reglas (ocultar en desktop,
  mostrar en el tramo teléfono).

**Tasas BCV: semana ganadera por calendario, import más inteligente, edición con lápiz**
- `src/core/parser/numeros.ts` — nuevas `semanaGanaderaDe(fecha)` y
  `semanasGanaderasDelAnio(anio)`: calculan la semana ganadera (miércoles a
  martes, semana 1 = la que contiene el 1° de enero) por **calendario
  puro**, confirmado con el usuario como la regla real. Ya no depende de que
  haya una nómina cargada que cubra esa fecha.
- **Bug real encontrado y corregido durante la prueba**: la primera versión
  de `semanaGanaderaDe` calculaba bien el `numero` de semana, pero
  `fechaIni`/`fechaFin` siempre devolvían las fechas de la **semana 1** del
  año, sin importar qué semana fuera (nunca avanzaba el punto de partida).
  Se notó porque la nueva tarjeta de calendario mostraba las mismas fechas
  "31/12 al 06/01" en las 52 semanas. Corregido avanzando el inicio
  `(numero - 1) * 7` días; se agregaron pruebas de regresión en
  `scripts/test-core.ts` (sección "Semana ganadera por calendario").
  Verificado que las fechas calculadas coinciden exactamente con las
  nóminas reales (semana 31: 29/07–04/08, semana 32: 05/08–11/08).
- `src/ui/screens/Tasas.tsx` — nueva tarjeta "Calendario de semanas
  ganaderas" (selector de año + lista de las ~52 semanas, de solo lectura);
  la columna "Semana ganadera" de la tabla principal ya siempre muestra un
  número, no depende de nóminas.
- Al importar Excel: si una fecha ya existe con la **misma** tasa, se
  muestra "Igual, no se reemplaza" y no se reescribe (antes siempre
  sobreescribía, generando una entrada de bitácora innecesaria incluso sin
  cambios reales). `ModalImportarTasas` ahora distingue Nueva/Reemplaza/Igual.
- La celda "Tasa BCV" pasó de ser un `<input>` siempre visible a texto de
  solo lectura con un lápiz (✏️) que aparece al pasar el mouse — clic para
  editar en el momento (Enter/blur guarda y vuelve a modo texto). En modo
  tarjeta (móvil, sin hover real) el lápiz queda siempre visible.

**Nota de Débito como documento independiente**
- `src/core/receipt/dibujo.ts` — se extrajeron tres bloques reutilizables de
  `dibujarComprobante`: `dibujarEncabezadoEmpresa`, `dibujarBloqueIdentificacion`
  (título parametrizable) y `dibujarDetalleNd` (desglose Leche/Flete + tabla
  SERV/LITROS/PRECIO/TASA). Nueva función exportada `dibujarNotaDebito(datos,
  opciones, medir)`: mismo encabezado de empresa/proveedor que el
  comprobante completo, pero el cuerpo se reduce a una caja
  "DIFERENCIA DE PRECIO SEMANA {numero}" + el desglose de la ND — sin
  litros, conceptos, Bruto, Neto a pagar ni Total a facturar.
- `src/core/receipt/nombreArchivo.ts` — nueva `nombreNotaDebito(...)` (igual
  que `nombreComprobante` con sufijo `_ND`).
- `src/ui/salida/generar.ts` — `generarDocumentos` interno generalizado
  (recibe qué función de dibujo/nombre usar); `generarComprobantes` y la
  nueva `generarNotasDebito` son ahora dos wrappers delgados sobre lo mismo.
- `src/ui/screens/Comprobantes.tsx` — botón "ND" por fila (solo si
  `nd?.aplica`, individual/combinado vía `unidadDe`) y botón de lote
  "⬇ ZIP notas de débito" en la barra-lote (omite en silencio los
  proveedores sin ND calculable y avisa cuántos se omitieron).
- **Verificado de punta a punta**: se descargó el PDF real (interceptando el
  `<a download>` que genera `plataforma.archivos.guardar` en modo web) y se
  leyó con la herramienta de lectura de PDF — contenido correcto, incluido
  el caso combinado leche+flete.

**Empaquetado de escritorio**
- `scripts/pack-desktop.mjs` — **bug real encontrado y corregido**: el
  proyecto vive dentro de una carpeta sincronizada por OneDrive
  (`C:\Users\usuario\OneDrive\...`), que usa "reparse points" en algunas
  carpetas (p. ej. `release\win-unpacked\resources\app.asar.unpacked`).
  `fs.readdirSync(..., {withFileTypes:true})` reportaba esa carpeta como
  symlink (`Dirent.isSymbolicLink() === true`) en vez de carpeta normal, y
  el script intentaba `readFileSync` sobre ella → `EISDIR`, con lo que el
  ZIP y la hoja para sistemas no se regeneraban (aunque el `.exe` sí se
  compilaba bien). Corregido usando `fs.statSync` (que sigue el enlace de
  verdad) en vez de los flags de `Dirent`. Confirmado con
  `npm run electron:build` completo y `node scripts/pack-desktop.mjs` solo.

**Limpieza incidental (no relacionada con lo pedido, encontrada de paso)**
- `src/core/receipt/nombreArchivo.ts`, función `sanearNombre` — el regex que
  quita caracteres de control (`.replace(/[\x00-\x1f\x7f]/g, '')`) tenía,
  desde **antes de esta sesión**, bytes de control crudos escritos
  literalmente dentro del archivo fuente (incluido un byte nulo real) en vez
  de la forma escapada `\x00-\x1f\x7f`. Funcionaba igual en runtime, pero
  `git diff` mostraba el archivo como binario. Se reemplazó por la forma de
  texto escapada, sin cambiar el comportamiento — verificado con
  `npm run check`/`test:core` y confirmando `0` bytes nulos en el archivo.

### Sesión anterior (2): Tasa BCV, botón riel, alineación de ND

**Tasa BCV: corregido el desfase de la línea en modo lectura**
(`src/ui/screens/Tasas.tsx`)
- Causa raíz: la clase `.tasa-editable` (`display: flex`) estaba puesta
  directamente sobre el `<td>` de la celda "Tasa BCV". Un `<td>` con
  `display: flex` deja de comportarse como celda de tabla normal y su altura
  ya no se sincroniza con el resto de la fila, lo que producía el borde
  descuadrado frente a la columna "Dif. Cambio" vecina.
- Fix: el `<td>` vuelve a ser una celda normal (`className="num"` a secas);
  `tasa-editable` se movió a un `<span>` interno que envuelve solo el texto +
  el botón lápiz en modo lectura. El modo edición (el `<input>`) no necesita
  el wrapper — ya se alinea a la derecha por `text-align: right` de
  `table.tabla td.num` y de `.numero`.
- Verificado en el navegador: la celda mide exactamente lo mismo (42.4px,
  mismo `bottom`) que "Dif. Cambio" en la misma fila.

**Botón "Cerrar sesión" del riel con apariencia real de botón**
(`src/ui/estilos.css`)
- `.btn-salir-riel` (usado por `PerfilPie` en `App.tsx`) era un `<button>`
  sin ningún estilo de botón (sin fondo ni borde, subrayado al hover — se
  veía como un enlace de texto). Se rediseñó como caja bordeada
  (`inline-flex`, `padding: 7px 13px`, `border-radius: var(--radio-s)`,
  borde y fondo translúcidos en el tono rojizo que ya tenía), siguiendo el
  mismo lenguaje visual que `.chip-usuario`/`.nav button` (los otros
  controles del riel oscuro), en vez de la paleta clara de `.btn`.
- Se ajustó el override dentro del cajón de navegación
  (`.cajon-nav .btn-salir-riel`) para que mantenga `display: inline-flex` en
  vez de `display: block` con padding manual, y no reintroduzca el look de
  enlace plano ahí.

**Nota de Débito (y comprobante de pago, que comparte el mismo dibujo): 4 ajustes de texto/alineación**
(`src/core/receipt/dibujo.ts`)
- Todo vive en la función compartida `dibujarBloqueIdentificacion` (usada
  tanto por `dibujarComprobante` como por `dibujarNotaDebito`) y en
  `dibujarDetalleNd`, así que los cambios aplican **a la vez** a ambos
  documentos.
- Título del documento de ND: `'NOTA DE DÉBITO'` → `'COMPROBANTE NOTA DE
  DEBITO'` (solo en la llamada desde `dibujarNotaDebito`; el rótulo "NOTA DE
  DÉBITO" que aparece como línea de totales dentro del comprobante completo
  no se tocó, es un rótulo distinto).
- Se quitó la línea "Pago de Leche Fresca/Nómina de Rutas · Fábrica ...";
  la línea de arriba ("Nómina Nº … · Año … · del … al …") pasó de alineada
  a la izquierda a centrada (`alineacion: 'centro'`, `x = (izq+der)/2`).
- Las fechas pasaron de "Factura {fecha} · Nota de débito {fecha}" a "Fecha
  de Factura {fecha} · Fecha de Nota de débito {fecha}" (en los tres casos:
  leche, flete y simple), manteniendo los prefijos "Leche ·"/"Flete ·" en el
  caso combinado.
- **Bug real encontrado durante la verificación visual**: dentro de la caja
  "DIFERENCIA DE PRECIO SEMANA N", el encabezado de la tabla ("SERV LITROS
  PRECIO $/L TASA INICIO TASA FINAL") se dibujaba a solo 4pt del borde
  inferior de la barra verde del título — casi tocándola. Corregido en
  `dibujarDetalleNd`/`altoDetalleNd`: el encabezado ahora se dibuja a 9pt de
  distancia (antes 4pt) y su alto reservado subió de 12 a 16pt (para que
  `altoCaja`, calculado en `dibujarNotaDebito`/`dibujarComprobante`, siga
  incluyendo exactamente el espacio real dibujado).
- **Verificado de punta a punta dos veces**: se descargó el PDF real de la
  ND (antes y después del ajuste de espaciado) y del comprobante de pago
  normal para el mismo proveedor, interceptando la descarga y leyendo el PDF
  generado — los 4 ajustes se ven correctos en ambos documentos.

### Esta sesión

**Fase A — Selector de formato único + acciones "Factura"/"ND"**
(`src/ui/screens/Comprobantes.tsx`)
- Reemplaza los botones "PDF"/"IMG"/"ND" (fila) y "⬇ ZIP en PDF"/"⬇ ZIP en
  imagen"/"⬇ ZIP notas de débito" (lote) por un único `<select>` "PDF/Imagen"
  en la barra superior + dos acciones simples: "Factura" y "ND" (fila),
  "⬇ ZIP Factura" y "⬇ ZIP ND" (lote), cada una usando el formato elegido.
  El botón "ND" ya no está fijo a `'pdf'`. El modal de vista previa se
  simplificó igual ("Descargar factura"/"Descargar ND").
- No se tocó `src/ui/salida/generar.ts`: `formato` ya era un parámetro
  independiente de qué se dibuja (`dibujarComprobante` vs
  `dibujarNotaDebito`), confirmado explorando el código antes de tocar nada
  — este cambio fue puro cableado de UI.

**Fase B — Interruptor "unir/separar" factura y ND (persistente)**
(`src/core/receipt/dibujo.ts`, `src/ui/screens/Comprobantes.tsx`)
- Nuevo campo `OpcionesDibujo.separarNd` (default `false`). En
  `dibujarComprobante`, `mostrarNd` pasa a exigir también `!opciones.separarNd`
  — con el interruptor activo, la factura ya no dibuja la caja/tabla de ND,
  pero sí conserva las líneas de referencia "Fecha de Factura/Nota de
  débito". `dibujarNotaDebito` no cambia.
- Nueva casilla en el modal "⚙ Contenido": "Separar la nota de débito en un
  documento aparte". A diferencia de las otras 3 casillas (de sesión), esta
  se guarda con `db.ajuste('separarFacturaNd')`/`fijarAjuste(...)` — clave
  **global**, no por nómina.
- **Bug real encontrado y corregido durante la verificación**: la primera
  versión de `fijarOpciones` llamaba a `db.fijarAjuste(...)` pero **no**
  llamaba a `cambiado()` — sin eso, `persistencia.current?.marcarSucio()`
  nunca se dispara y el cambio se queda solo en la base sql.js en memoria,
  sin volcarse a OPFS. Al recargar la página el interruptor volvía a
  aparecer desmarcado. Se corrigió agregando `cambiado()` (mismo patrón que
  `fijarFechas`, que sí lo hacía). Verificado con una recarga completa real
  del navegador: el interruptor sigue marcado después.

**Fase C — Agrupar códigos del mismo tipo (mecanismo nuevo y paralelo)**
- No se tocó nada de `vinculos_proveedor`/`ModalVinculo.tsx`/"Vínculos
  leche-transporte" en Ajustes — sigue exactamente igual. Se agregó un
  mecanismo **separado e independiente**, mutuamente excluyente con ese
  (un código participa en uno u otro, nunca en los dos — validado en ambos
  sentidos con una guarda en `confirmarVinculo` y en
  `confirmarGrupoMismoTipo`).
- `src/core/db/esquema.ts` — tabla nueva `grupo_mismo_tipo` (una fila por
  código; todas las filas con el mismo `grupo_id` son un grupo; un miembro
  marcado `principal`) + `grupo_mismo_tipo_descartado` (para no re-sugerir
  un documento ya rechazado). Ambas aditivas, sin subir `VERSION_ESQUEMA`.
- `src/core/db/repo.ts` — `candidatosGrupoMismoTipo` (agrupa por
  `digitosDocumento`, reusado sin cambios de `identidad.ts`),
  `gruposMismoTipo`, `grupoDeCodigo`, `confirmarGrupoMismoTipo` (funde
  grupos si algún código ya estaba agrupado), `quitarDeGrupoMismoTipo`
  (disuelve el grupo entero si queda 1 solo miembro),
  `descartarCandidatoGrupoMismoTipo`.
- `src/core/receipt/comprobanteAgrupado.ts` (nuevo) —
  `construirComprobanteAgrupado(miembros, principalCodigo)`: análogo a
  `comprobanteCombinado.ts` pero para N registros del mismo tipo en vez de
  2 de tipos distintos; suma bruto/deducciones/neto/total a facturar con
  `.reduce()`, identidad toma la del miembro principal, folio
  `codigos.join('+')`.
- `src/core/types.ts`/`comprobante.ts` — tipos **agregados**, no se tocaron
  los existentes: `NotaDebitoAgrupada` (análogo a `NotaDebitoCombinada` pero
  con `porCodigo: Array<{codigo, resultado}>`), `DatosComprobante.agrupado`
  (análogo a `.combinado` pero con `miembros: Array<...>`),
  `LineaConcepto.origenCodigo` (nuevo campo opcional, separado de `origen`).
- `src/core/receipt/dibujo.ts` — `datosDetalleNd`/`altoDetalleNd`/
  `dibujarDetalleNd` generalizados: el desglose "Leche: X / Flete: Y" pasa a
  ser una lista `desglose: {etiqueta, centimos}[]` de N líneas (antes 2 fijas),
  cubriendo también `notaDebitoAgrupada`. El divisor "LECHE"/"FLETE" entre
  líneas de conceptos (`marcaOrigen`) se generalizó igual para mostrar
  "CÓDIGO {código}" cuando la línea trae `origenCodigo` en vez de `origen`.
- `src/ui/components/ModalGrupoMismoTipo.tsx` (nuevo, patrón de
  `ModalVinculo.tsx`): candidato = lista de 2+ registros del mismo tipo con
  el mismo documento.
- `src/ui/screens/Ajustes.tsx` — nueva tarjeta "Agrupar códigos del mismo
  tipo" (separada de "Vínculos leche-transporte"): una fila por grupo,
  botón "Desagrupar" por código.
- `src/ui/screens/Comprobantes.tsx` — `unidadDe()` gana una rama nueva:
  si no hay `contraparte` cruzada (son excluyentes), busca `grupoDeCodigo`
  y arma el comprobante agrupado; píldora "🔗 agrupado con {códigos}" +
  botón "✕ desagrupar", y "🔗 posible agrupación con {códigos}" para
  candidatos sin confirmar (mismo patrón visual que el vínculo cruzado).
- **Verificado de punta a punta con datos reales**: al cargar
  `GAN0584_4.pdf`, la app detectó solo un candidato real —dos códigos de
  leche (009170 y 008911, "CARLOS EDUARDO SIMOZA MONTIL") con el mismo
  RIF—, se confirmó desde el botón de la fila, y se descargó/leyó la
  factura combinada resultante: litros y montos exactamente la suma de
  ambos códigos, con el desglose "CÓDIGO 009170"/"CÓDIGO 008911" visible
  en la lista de conceptos.

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
- Para inspeccionar una imagen o PDF grande generado en el navegador de
  pruebas (p. ej. la vista previa del comprobante, o una descarga real):
  interceptar `Node.prototype.appendChild` para capturar el `href` (`blob:`)
  del `<a download>` que crea `plataforma.archivos.guardar`; luego
  `fetch(href)` + `arrayBuffer()` + `btoa()` para obtener el base64. Si el
  string excede el límite de una respuesta de `javascript_tool`, la
  herramienta lo guarda en un `.txt` (JSON `[{type,text}]`) — usar Node para
  extraer el base64 y decodificarlo a un archivo real (`.png` o `.pdf`). La
  herramienta `Read` lee PDFs directamente, no hace falta convertir a imagen.
- Para reducir una imagen grande antes de codificarla: dibujarla en un
  `<canvas>` a un ancho razonable (~700px) antes de `toDataURL()`.
- **Cuidado al relayar un base64 grande (>4-5k caracteres) de vuelta al
  navegador de pruebas a mano.** Un PDF de ND se decodificó una vez con
  "incorrect data check" (zlib) pese a que el largo en bytes coincidía —
  la causa fue una duplicación accidental de un tramo al copiar el string
  por partes, no un problema del navegador ni del código. Si un PDF
  "descargado" sale con formas/rectángulos rotos o texto faltante al
  leerlo, sospechar primero de la transcripción del base64 (verificar
  longitud exacta de cada tramo con Node antes de concatenar) antes de
  tocar el código de dibujo.
- **`onBlur` de React no se dispara con un evento sintético.** Despachar
  `input.dispatchEvent(new Event('blur', {bubbles:true}))` por script NO
  activa el `onBlur` de React (que se implementa sobre `focusout` con su
  propio sistema de delegación) — hay que llamar `input.blur()` de verdad
  sobre el elemento que tiene el foco (comprobar con
  `document.activeElement === input`).
- **Si `git diff` muestra un archivo de texto como "Binary files differ"**,
  buscar un byte nulo embebido (`Buffer` con `indexOf(0) !== -1`) — puede
  ser un carácter de control crudo escrito sin querer dentro de un literal
  de regex (`/[<bytes crudos>]/`) en vez de su forma escapada
  (`\x00`/`\u0000`). El `Read` tool lo puede mostrar como si fueran espacios
  invisibles sin dar ninguna pista.
- `exceljs` no tiene `Buffer` de Node disponible en el build principal — se
  resolvió con `as any` en `workbook.xlsx.load()`, comentado.
- **Migraciones de esquema**: `VERSION_ESQUEMA` (en `esquema.ts`) es
  deliberadamente destructivo — subirlo hace que `BaseAnterior.tsx` fuerce a
  respaldar y vaciar toda la base. Para agregar una columna nueva a una
  tabla existente sin romper archivos ya guardados, usar el patrón de
  `basedatos.ts`: `PRAGMA table_info(tabla)` para ver si la columna ya
  existe, y si no, `ALTER TABLE ... ADD COLUMN` dentro de `migrar()`, sin
  tocar `VERSION_ESQUEMA`.
- **Cualquier escritura con `db.fijarAjuste`/`db.correr` que deba
  sobrevivir a un recargar necesita también llamar a `cambiado()`.**
  `cambiado()` es lo que dispara `persistencia.current?.marcarSucio()` (el
  volcado a OPFS/disco); sin esa llamada, el cambio queda solo en la base
  sql.js en memoria de esa sesión y desaparece al recargar. No es automático
  por escribir en la base — hay que acordarse de llamarlo explícitamente en
  cada handler que persista algo nuevo (visto con el interruptor
  `separarNd`, sección 3).
- **El proyecto vive dentro de una carpeta sincronizada por OneDrive.** Esto
  puede hacer que Node reporte mal ciertas carpetas (reparse points) como
  symlinks vía `Dirent.isSymbolicLink()`/`isDirectory()`. Si un script que
  recorre archivos falla con `EISDIR` o `EINVAL: invalid argument, readlink`,
  usar `fs.statSync(ruta)` (que resuelve el enlace de verdad) en vez de los
  flags de `Dirent` de `readdirSync(..., {withFileTypes:true})`.
- El servidor de pruebas del navegador necesita `.claude/launch.json` en la
  carpeta raíz (`C:\Users\usuario\OneDrive\OSWALDO\LACTALIS\.claude\launch.json`,
  no dentro de `nomina-lechera-comppago\.claude\`) apuntando a
  `npm --prefix nomina-lechera-comppago run dev`, puerto 5173 — ya está
  creado, no hace falta rehacerlo.
- El navegador de pruebas usa almacenamiento OPFS persistente por origen: la
  sesión de usuario y los datos cargados sobreviven entre reinicios del
  servidor de dev dentro de la misma sesión de trabajo, pero **no**
  sobreviven a un `location.reload()` completo del login (hay que volver a
  iniciar sesión, aunque los datos previamente guardados siguen ahí). No es
  la base de datos real de Electron, es aparte.

## 5. Próximos pasos

1. Cargar los datos de empresa por fábrica en Ajustes para que los
   comprobantes reales no muestren "Sin empresa" (único pendiente real de
   negocio).
2. Si se agregan más PDF de referencia, van en `entradas/` (ya no existe
   `ejemplos/`).
3. Al hacer la próxima tanda de cambios, recordar correr
   `npm run electron:build` completo (no solo `pack-desktop.mjs` suelto) si
   se quiere entregar una versión nueva, y subir `package.json` según el
   criterio de la sección 3 antes de compilar/commitear.
