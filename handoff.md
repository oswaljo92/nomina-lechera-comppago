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
sesión", varios ajustes de texto/alineación en la Nota de Débito, el
interruptor para unir/separar factura y ND, agrupación de 2+ códigos del
mismo tipo (mismo proveedor con varios códigos de leche o de transporte),
un selector de formato único (PDF/Imagen) que simplifica la descarga de
factura y ND por separado, el bug del botón "ND" que no aparecía para
proveedores agrupados, dos ajustes de tabla (desbordamiento horizontal en
escritorio, espaciado en tarjeta móvil), un bug real de espaciado en la
Nota de Débito de un grupo (el desglose por código quedaba pegado al borde
de la caja verde), confirmado también con datos reales de transporte (no
solo leche), la tabla de Comprobantes dividida en dos pestañas
("Comprobantes generales" / "Notas de Débito"), la columna de acciones
separada en tres (Vista, Configuración, Comprobante) para que los botones
se alineen bien en todos los tamaños de pantalla, la importación de notas
de débito ya calculadas desde un Excel externo (empareja por código o por
nombre con lo ya cargado y reemplaza el cálculo automático por tasas BCV),
3 ajustes de contenido en la nota de débito como documento aparte (título,
sin fecha de factura, sin la leyenda de monto repetido), redondeo hacia
arriba del monto importado, una columna nueva en la pestaña "Notas de
Débito" para generar/descargar la ND directamente desde ahí, separar
concepto manual de configuración de ND en Comprobantes generales, y la
última tanda: corrección del import de Excel real (el archivo del usuario
no trae columna "Código de Proveedor", el parser ahora lee por nombre de
encabezado en vez de posición fija), corrección de un bug de emparejamiento
por nombre (un nombre corto calzaba por prefijo con uno largo de otro
proveedor distinto), y una funcionalidad nueva: sumar automáticamente el
monto de la ND cuando el mismo SAP (y la misma fábrica) aparece en 2+ filas
del Excel, generando una sola nota de débito con desglose por línea, sin
tocar la factura de cada código.

## 2. Estado actual

Todo está implementado, tipado sin errores (`npm run check`), pasa
`test:core`/`test:parser` (con pruebas nuevas de `decimalesDeFormato`/
`redondearComoExcel`), se probó a mano en el navegador con el Excel real
(`entradas/ND CALCULADA.xlsx`) y las nóminas `GAN0584_6`/`GAN0594_6`: la
pestaña Notas de Débito muestra cada número exactamente como la vista del
Excel (82.950, 12.779, 1.154.817; 0,850 / 680,999 / 703,577 / 22,578), y los
botones 📋/🖼 junto al nombre copian el nombre y el PNG real de la factura
(o de la ND en su pestaña). Está commiteado y pusheado a `origin/master`, y
compilado en `release/CompPago-1.8.0-windows.zip` (`npm run electron:build`
completo).

**Versión actual: `1.8.0`** (subida en esta tanda, ver sección 3).

Últimos commits:

```
(este commit) ND importada con los números exactos que muestra el Excel; botones copiar nombre/imagen; sube a 1.8.0
bff9260 Corrige import de Excel sin columna de código y emparejamiento por nombre; suma ND por SAP; sube a 1.7.0
92ea542 Separa concepto manual de configuración de ND en Comprobantes generales; sube a 1.6.0
fcf0bc8 Muestra siempre la fecha de factura en la factura; título "COMPROBANTE"; sube a 1.5.2
8d54813 Redondea la ND al bolívar entero, no al céntimo; sube a 1.5.1
15c5650 Ajustes de contenido de la ND separada, redondeo hacia arriba, columna Generar ND; sube a 1.5.0
d2efde1 Pestañas Comprobantes/ND, columnas Vista-Config-Comprobante, import de ND por Excel; sube a 1.4.0
(anterior) Corrige espaciado del desglose por código en la ND; sube a 1.3.2
f61f0d7 Corrige boton ND en agrupados y ajustes de tabla (desborde/espaciado); sube a 1.3.1
c4bb01c Interruptor unir/separar ND, agrupación de códigos del mismo tipo, selector de formato único; sube a 1.3.0
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

### Sesión anterior (3): interruptor unir/separar ND, agrupación mismo tipo, selector de formato

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

### Sesión anterior (4): botón ND en agrupados, desborde/espaciado de tabla

**Bug real: el botón "ND" no aparecía en proveedores agrupados**
(`src/ui/screens/Comprobantes.tsx`)
- `ndAplica(datos)` solo miraba `datos.notaDebitoCombinada`/`datos.notaDebito`
  — nunca se actualizó para revisar `datos.notaDebitoAgrupada` al agregar la
  Fase C de la sesión anterior. Resultado: para cualquier unidad agrupada
  (mismo tipo) con ND aplicable, el botón "ND" por fila, el de la barra de
  lote y el del modal de vista previa se quedaban ocultos aunque la columna
  "Nota de débito"/pastilla "Con ND" sí mostraran el valor (esas sí leen el
  registro individual, no `unidadDe`). Corregido agregando la rama que
  faltaba: `if (datos.notaDebitoAgrupada) return datos.notaDebitoAgrupada.aplica;`.
  Reportado por el usuario con una captura real donde solo aparecía
  "Factura"; verificado que tras el fix aparece "Factura ND" en la misma
  fila.

**Tabla de Comprobantes: desbordamiento horizontal en escritorio**
(`src/ui/estilos.css`)
- A 1280px de ventana (portátil típico con el riel de 232px), la tabla
  necesitaba ~1138px pero el contenedor solo tenía 979px disponibles →
  scroll horizontal, con la columna "Comprobante" cortada (tal como se ve
  en la captura del usuario). Dos causas, ambas de especificidad CSS:
  1. `table.tabla th` ya tenía `white-space: nowrap` implícito porque la
     regla compartida `table.tabla td.num, table.tabla th.num` (más
     específica, `.num` en ambos) forzaba `nowrap` también en los
     encabezados numéricos ("Total a facturar", "Nota de débito", etc.),
     obligando a la columna a ser tan ancha como la palabra del
     encabezado en mayúsculas en vez de como el dato. Se separó la regla:
     `white-space: nowrap` queda solo en `td.num` (el dato nunca debe
     partirse); el `th.num` hereda `white-space: normal` de la regla base
     `table.tabla th` y puede envolver a 2 líneas.
  2. `table.tabla td.acciones-celda` tenía `white-space: nowrap`, obligando
     a los 5 botones de la fila (👁 + $ Factura ND) a quedar en una sola
     línea sin importar el ancho disponible. Se quitó el `nowrap` y se le
     puso `max-width: 160px`: ahora los botones envuelven a 2-3 líneas
     dentro de un ancho acotado en vez de estirar la columna.
  - **Verificado**: a 1280px la tabla ya no desborda (`scrollWidth ===
    clientWidth`, medido con el navegador de pruebas), sin tocar
    `table-layout` ni el resto de columnas.

**Tarjeta móvil: más espacio entre el nombre y el vínculo/grupo**
(`src/ui/screens/Comprobantes.tsx`)
- Los bloques "posible vínculo"/"combinado con"/"posible agrupación"/
  "agrupado con" bajo el nombre del proveedor tenían `marginTop: 4` —
  quedaban muy pegados a la línea de código/ruta de arriba. Subido a
  `marginTop: 8` en los 4 bloques (deja igual el de la columna "Estado",
  que no es parte de esta queja). Verificado en el navegador a 375px: no
  hay overflow horizontal ni recorte, solo más aire vertical.

### Sesión anterior (5): verificación con transporte real, espaciado del desglose en la ND

**Verificado con datos reales de transporte, no solo leche**
- El usuario pidió confirmar que la agrupación del mismo tipo funciona
  igual para transporte (no solo para leche, único caso probado antes).
  `entradas/GAN0594_4.pdf` trae un candidato real: "MARCOS TULIO GOMEZ
  GOMEZ" con los códigos 000569 y 000596 (mismo RIF). Se confirmó el
  grupo, se activó "Separar la nota de débito" y se descargaron ambos
  documentos por separado: la factura (sin ND) mostró el total sumado con
  "CÓDIGO 000569"/"CÓDIGO 000596" en la lista de conceptos (pagos y
  deducciones), y la ND aparte mostró "DIFERENCIA DE PRECIO SEMANA 31"
  sumada con el desglose "000569: X Bs" / "000596: Y Bs" y una fila por
  código en la tabla SERV/LITROS/PRECIO/TASA — igual que con leche, porque
  `construirComprobanteAgrupado`/`dibujarDetalleNd` nunca distinguen tipo.

**Bug real: el desglose por código en la ND quedaba pegado a la caja
verde** (`src/core/receipt/dibujo.ts`)
- Al revisar la ND del grupo de transporte se notó que las líneas
  "000569: 194.484,43 Bs" / "000596: 97.222,33 Bs" se dibujaban a solo 4pt
  del borde inferior de la barra verde "DIFERENCIA DE PRECIO SEMANA N" —
  el mismo tipo de bug de espaciado ya corregido antes para el encabezado
  SERV/LITROS/..., pero que se había quedado sin arreglar en esta otra
  línea (`dibujarDetalleNd`, el bloque `desglose.forEach`, que seguía
  usando `y + 4` en vez de `y + 9`). Corregido subiendo el primer renglón a
  `y + 9` y sumando 5pt extra al alto reservado en `altoDetalleNd` (para
  que la caja siga incluyendo exactamente el espacio dibujado). Afecta por
  igual al caso combinado (Leche/Flete) y al agrupado (N códigos), ya que
  comparten la misma función.
- **Truco de verificación que evitó otra ronda de corrupción de base64**:
  en vez de interceptar el `<a download>` y pasar el PDF por
  base64/`javascript_tool` (que ya había fallado dos veces por
  transcripción, ver más abajo), esta vez se dejó que el navegador
  guardara el archivo de verdad en `C:\Users\usuario\Downloads\` (el
  entorno de pruebas SÍ escribe ahí) y se leyó ese archivo directamente
  con la herramienta `Read` — sin ningún paso manual de por medio, cero
  riesgo de corrupción. Cuando el archivo queda como `.tmp` (un segundo
  clic de descarga seguido puede quedar pendiente de confirmación del
  navegador), copiarlo con extensión `.pdf` antes de leerlo: la
  herramienta `Read` decide cómo interpretar el archivo por su extensión,
  no por el contenido.

### Sesión anterior (6): pestañas Comprobantes/ND, columnas Vista-Config-Comprobante, import de ND por Excel

El usuario pidió tres cosas relacionadas: (1) que la tabla de Comprobantes
tenga una columna "Vista" (ver factura / ver ND por separado) y una columna
"Configuración" (acceso a ND y conceptos manuales por proveedor), dejando la
columna "Comprobante" solo con las descargas y bien alineada en todos los
tamaños de pantalla; (2) una pestaña nueva "Notas de Débito" dentro de
Comprobantes (la tabla actual pasa a llamarse "Comprobantes generales")
para importar un Excel con la ND ya calculada y evitar transcribir precios
a mano; (3) que ese Excel traiga una columna "Código de Proveedor" nueva
(el mismo código que ya existe en los GAN, ej. `009119`, pero sin los ceros
a la izquierda) para emparejar automáticamente con lo ya cargado.

**Restructuración de `Comprobantes.tsx` en pestañas** — el archivo (antes
1018 líneas, un solo componente) se dividió en tres:
- `src/ui/screens/Comprobantes.tsx`: shell fino, mantiene lo compartido por
  las dos pestañas (nómina seleccionada, formato, opciones de contenido del
  PDF —incluida `separarNd`—, fechas del documento) y el estado de qué
  pestaña está activa.
- `src/ui/screens/comprobantes/SeccionComprobantesGenerales.tsx` (nuevo):
  toda la tabla de siempre, funcionalmente igual, con el split de columnas
  descrito abajo.
- `src/ui/screens/comprobantes/SeccionNotasDebito.tsx` (nuevo): la pestaña
  de importación de Excel.
- Las pestañas reusan el patrón `.pestanas`/`useState<Pestana>` que ya
  existía en `Ajustes.tsx` (no se inventó nada nuevo de CSS para esto).

**Columnas Vista / Configuración / Comprobante**
(`SeccionComprobantesGenerales.tsx`, `estilos.css`)
- La columna "Comprobante" (5 botones: 👁, +, $, Factura, ND) se partió en
  tres: "Vista" (👁 ver factura, 🧾 ver ND — reemplaza al 👁 combinado de
  antes), "Config." (⚙, lleva a la pestaña Notas de Débito filtrada a ese
  proveedor) y "Comprobante" (solo Factura/ND, las descargas).
- **Regresión encontrada y corregida en el momento**: agregar 2 columnas
  nuevas volvió a desbordar la tabla a 1280px (163px de más), el mismo tipo
  de problema ya resuelto una vez para la columna única. Se corrigió en
  capas: encabezado "⚙" en vez de "Configuración" (ahorra ~70px), botones
  de Vista sin texto (👁/🧾 en vez de "👁 Factura"/"👁 ND"), y una clase CSS
  nueva `.compacta` (padding 6px en vez de 10px) para las columnas de solo
  ícono, más reducir el padding base de la tabla de `7px 10px` a `7px 8px`.
  Verificado con `scrollWidth - clientWidth` en el navegador: quedó en 2px
  (imperceptible, antes eran 163px).
- El botón "⚙" apunta a `irAConfiguracion(codigo)` en el shell, que cambia
  de pestaña y precarga el buscador de "Notas de Débito" con ese código —
  ahí la fila del proveedor sigue teniendo los botones "+ Concepto"/"$ ND
  manual" de siempre (mismos modales `ModalConceptoManual`/`ModalNotaDebito`,
  sin cambios), para no perder ninguna función.

**Nota de débito importada de Excel** — mecanismo nuevo y automático: una
vez que una fila del Excel queda emparejada a un registro, su monto
reemplaza por completo el cálculo por tasas BCV para ese proveedor/semana,
sin ningún interruptor por proveedor.
- `src/core/db/esquema.ts`: tabla nueva `notas_debito_importadas` (aditiva,
  sin subir `VERSION_ESQUEMA`), 1 fila por código del Excel, `registro_id`
  nullable (pendiente de emparejar a mano) con índice único parcial
  (`WHERE registro_id IS NOT NULL`) para que un registro no reciba dos
  imports. Guarda también las columnas crudas del Excel (fábrica, SAP,
  litros, precios) para auditoría, aunque solo `centimos` participa en el
  cálculo.
- `src/core/db/notaDebitoExcel.ts` (nuevo): `leerLibroNotasDebitoImportadas`,
  mismo patrón que `tasasExcel.ts`. El tipo de cada fila (leche/transporte)
  se infiere de cuál columna de litros trae dato. Emparejamiento: primero
  por **código normalizado** (`normalizarCodigo`: quita todo lo no numérico
  y los ceros a la izquierda en ambos lados — `"9119"` ~ `"009119"`), si no
  calza por **nombre** (tolerando el truncado a ~30 caracteres del PDF); si
  ninguno o hay ambigüedad, `'sin-emparejar'`.
- `src/core/calc/calcular.ts`: `resolverNotaDebito(codigo, params, litros,
  fechaIniSemana, tasas, ndImportada)` — si hay import para ese código lo
  devuelve directo (sin mirar tasas/params/litros), si no cae a
  `calcularNotaDebito` de siempre. Sustituye a `calcularNotaDebito` en los 3
  constructores (`comprobante.ts`, `comprobanteCombinado.ts` una vez por
  lado, `comprobanteAgrupado.ts` una vez por código) — cada uno recibe el
  override vía un nuevo campo `ContextoComprobante.ndImportada: Map<codigo,
  {centimos, fechaNota}>`. `ModalNotaDebito.tsx` (el editor manual) se dejó
  intacto pero gana un aviso: "N de M proveedores ya tienen ND importada,
  el documento final usará ese valor".
- `NotaDebitoCalculada` ganó un campo opcional `origen?: 'calculado' |
  'importado'`. **Importante para el dibujo**: un import no tiene
  tasaIni/tasaFin/precioUsd reales, así que `dibujarDetalleNd` (dibujo.ts)
  ahora excluye del cuadro SERV/LITROS/PRECIO/TASA cualquier línea con
  `origen === 'importado'` (para no imprimir tasas inventadas), pero la
  mantiene en el desglose de montos por código/lado (con un caso especial
  agregado: si solo hay 1 fuente aplicable y es importada, igual se muestra
  como línea de desglose, porque antes esa rama solo aparecía con 2+
  fuentes).
- `src/core/db/repo.ts`: `notasDebitoImportadasDeNomina`, `ndImportadaMapa`,
  `guardarNotasDebitoImportadas` (lote, secuencial dentro de una
  transacción, como `guardarTasa`/`guardarNotaDebito`, por la bitácora
  encadenada), `resolverNotaDebitoImportada` (emparejamiento manual — ojo:
  también corrige `nomina_id` de la fila a la del registro elegido, no se
  queda con la nómina donde se subió el Excel), `eliminarNotaDebitoImportada`.
  Ninguna llama a `cambiado()` — eso lo hace siempre la UI que las invoca.
- **Diseño para Excel mixto (leche+transporte en el mismo archivo)**: el
  Excel real del usuario trae filas de ambos tipos a la vez (columna
  "Litros Enviados" vs "Litros Transportados"). El emparejamiento busca
  candidatos tanto en la nómina actualmente abierta como en su "nómina
  hermana" (mismo año/semana, tipo opuesto, si está cargada) — igual que ya
  hace el mecanismo de vínculos cruzados. Cada fila importada guarda el
  `nomina_id` real del registro con el que quedó (no el de la pestaña donde
  se subió el archivo), para que abrir la pestaña "Notas de Débito" de
  CUALQUIERA de las dos nóminas muestre sus filas correctas.
- UI: `ModalImportarNotaDebito.tsx` (nuevo, patrón de `ModalImportarTasas`
  de Tasas.tsx) clasifica en Por código / Por nombre / Sin emparejar antes
  de confirmar. `ModalResolverNotaDebito.tsx` (nuevo) deja elegir a mano el
  registro correcto para una fila sin emparejar (excluye los registros que
  ya tienen otra ND importada asignada).
- **Bug real encontrado y corregido durante la prueba**: en la tabla de la
  pestaña "Notas de Débito", los litros mostrados venían de
  `f.litrosEnviados ?? f.litrosTransportados ?? 0` — como `??` solo cae al
  siguiente valor si el de la izquierda es `null`/`undefined` (no si es
  `0`), una fila de transporte con `litrosEnviados: 0` (el valor por
  defecto para la columna que no le corresponde) siempre mostraba `0` en
  vez de sus litros reales. Corregido eligiendo explícitamente por `tipo`:
  `f.tipo === 'leche' ? f.litrosEnviados : f.litrosTransportados`.
- **Verificado de punta a punta con datos reales**: se cargó la nómina de
  transporte real (`entradas/GAN0594_4.pdf`, inyectando los PDF vía
  `fetch()` + `DataTransfer` a un `<input type=file>` copiado temporalmente
  a `public/`, sin pasar bytes por ningún parámetro de texto), se generó un
  Excel de prueba con `exceljs` (3 filas: una con código sin ceros que
  calza con "MARCOS TULIO GOMEZ GOMEZ" 000569, una que solo empareja por
  nombre con "BERNABE DE JESUS ANDRADE RON" 000626, una sin coincidencia),
  se importó (el modal clasificó las 3 correctamente), se resolvió a mano
  la fila pendiente, se recargó la página completa y se confirmó que la
  resolución persistió. En "Comprobantes generales", sin ninguna tasa BCV
  cargada en toda la sesión, la columna "Nota de débito" mostró el monto
  importado exacto (194.484,43 Bs) — confirmando que el override no
  depende de tasas. Se descargó la ND y la factura reales y se leyeron con
  `Read`: la ND muestra "DIFERENCIA DE PRECIO SEMANA 31 194.484,43 Bs" +
  "Flete: 194.484,43 Bs" sin ninguna tabla SERV/LITROS/PRECIO/TASA (correcto,
  no hay tasas reales que mostrar); la factura normal embebe la misma caja
  de ND igual de limpia. Se verificó también el modo tarjeta a 375px: las 3
  columnas nuevas aparecen como 3 bloques de botones separados, sin
  desborde horizontal.
- Pruebas nuevas en `scripts/test-core.ts` (sección "Nota de débito
  importada"): normalización de código (`"9119"` ~ `"009119"`, pero
  `"569"` no calza con `"5690"`), `resolverNotaDebito` gana aunque no haya
  params/tasas, queda marcado `origen: 'importado'`, y `construirComprobante`
  lo aplica de punta a punta.

### Sesión anterior (7): ajustes de contenido en la ND separada, redondeo, columna "Generar ND"

El usuario pidió 4 cosas puntuales sobre la nota de débito (ND) como
documento independiente (`dibujarNotaDebito`), sin tocar el comprobante de
pago normal (que sigue embebiendo la ND igual que siempre cuando NO está
activado "Separar la nota de débito"):

1. **Redondeo hacia arriba del monto importado**
   (`src/core/db/notaDebitoExcel.ts`) — `calcularNotaDebito` ya redondeaba
   hacia arriba (`Math.ceil`) desde antes; el import de Excel usaba
   `Math.round` (al más cercano). Cambiado a `Math.ceil` para que ambos
   caminos usen la misma convención.
2. **Título**: `'COMPROBANTE NOTA DE DEBITO'` → `'NOTA DE DEBITO'`, solo en
   la llamada desde `dibujarNotaDebito` (el rótulo "NOTA DE DÉBITO" dentro
   del comprobante normal es otro texto, no se tocó).
3. **Sin "Fecha de Factura" en la ND separada**: `dibujarBloqueIdentificacion`
   (compartida con el comprobante normal) ganó un parámetro
   `soloFechaNota` (default `false`); cuando es `true` solo imprime "Fecha
   de Nota de débito {fecha}" (con el prefijo "Leche ·"/"Flete ·" si es
   combinado), sin "Fecha de Factura". Solo `dibujarNotaDebito` lo pasa en
   `true`; `dibujarComprobante` sigue mostrando ambas fechas como siempre.
4. **Sin la leyenda "Leche: X Bs"/"Flete: X Bs" bajo el total**:
   `dibujarDetalleNd` ganó un parámetro `ocultarDesglose` (default
   `false`); en `true` no dibuja las líneas de desglose (el monto ya está
   en el título de la caja verde) pero sigue mostrando la tabla
   SERV/LITROS/PRECIO/TASA si aplica. Solo `dibujarNotaDebito` lo pasa en
   `true` — el comprobante normal sigue mostrando el desglose como
   siempre (es útil ahí porque el monto no aparece repetido en ningún otro
   lado del documento).

**Columna nueva "Generar ND" en la pestaña "Notas de Débito"**
(`src/ui/screens/comprobantes/SeccionNotasDebito.tsx`, `Comprobantes.tsx`)
- Pedido explícito: poder generar/descargar la ND directamente desde la
  tabla de esa pestaña, sin afectar cómo se genera desde "Comprobantes
  generales". Se replicó ahí (no se refactorizó ni se tocó
  `SeccionComprobantesGenerales.tsx`) la misma lógica de resolución
  `unidadDe` (vínculo cruzado leche-transporte / grupo del mismo tipo /
  individual) para que el documento generado desde esta pestaña sea
  **exactamente el mismo** que generaría "Comprobantes generales" para ese
  proveedor — no es un mecanismo de generación nuevo, es un atajo al que
  ya existe.
- Columna con dos botones por fila (solo si la fila ya está emparejada a
  un registro **de la nómina actualmente abierta** — un registro de la
  nómina "hermana" del otro tipo, que sí puede aparecer en esta tabla si
  el Excel traía filas mixtas, muestra en su lugar "Ver en la nómina de
  leche/transporte", ya que abrir esa nómina desde aquí queda fuera de
  alcance de este pedido): 🧾 vista previa (reusa `VistaPrevia` con
  `cual="nd"`) y "Descargar ND" (reusa `generarNotasDebito`, mismo patrón
  que `descargarNd` en `SeccionComprobantesGenerales`). `Comprobantes.tsx`
  (el shell) pasa `formato` como prop nueva a `SeccionNotasDebito` para
  que respete el mismo selector PDF/Imagen del encabezado.
- **Verificado de punta a punta**: se descargó la ND de un proveedor desde
  esta columna nueva y se leyó el PDF real — título "NOTA DE DEBITO", solo
  fecha de ND, sin leyenda de desglose, monto correcto. Se descargó
  también la factura normal del mismo proveedor desde "Comprobantes
  generales" y se confirmó que no cambió nada (mismo título "COMPROBANTE
  DE PAGO", ambas fechas, sigue con la leyenda "Flete: X Bs" dentro de su
  caja de ND).

### Sesión anterior (8): la ND redondea al bolívar entero, no al céntimo

El usuario reportó (con captura) que el monto de la ND seguía saliendo con
centavos (ej. "1.564.989,78 Bs") después de la tanda anterior, donde ya se
había agregado `Math.ceil` — pero ese redondeo era **al céntimo** (subía
la fracción de céntimo, pero dejaba los céntimos visibles). Se preguntó
para confirmar y el usuario aclaró: quiere redondeo **al bolívar entero**,
sin céntimos, para que la factura salga en un monto limpio.

- `src/core/calc/calcular.ts` (`calcularNotaDebito`): `centimos:
  Math.ceil(montoUsd * diferenciaTasa * 100)` → `Math.ceil(montoUsd *
  diferenciaTasa) * 100` — primero redondea el monto en Bs hacia arriba,
  luego lo convierte a céntimos (que quedan siempre en `.00`).
- `src/core/db/notaDebitoExcel.ts`: mismo cambio, `Math.ceil(bsAPagar *
  100)` → `Math.ceil(bsAPagar) * 100`.
- No hizo falta tocar `NotaDebitoCombinada`/`NotaDebitoAgrupada`: su
  `centimos` es una suma de valores ya redondeados al bolívar (múltiplos
  de 100), y la suma de múltiplos de 100 sigue siendo múltiplo de 100, así
  que el total combinado/agrupado también sale limpio automáticamente.
- Prueba en `scripts/test-core.ts` actualizada: el caso que antes esperaba
  `2.748.532,50 Bs` ahora espera `2.748.533,00 Bs` (74.790 L × 2,45 $/L ×
  15 Bs de diferencia = 2.748.532,50 Bs exactos, redondeados hacia arriba
  al bolívar entero).
- **Verificado en el navegador**: se generó un Excel de prueba con
  "Bs. a Pagar x Dif." = 1.564.989,22 y el modal de importación mostró
  correctamente **1.564.990,00** (sin céntimos) antes de confirmar nada
  (se canceló el import de prueba para no ensuciar la base).

### Sesión anterior (9): la factura siempre muestra su "Fecha de Factura"; título "COMPROBANTE"

El usuario pidió dos cosas sobre el comprobante de pago (factura, no la ND
separada):

1. **Que la factura muestre siempre su "Fecha de Factura"**, igual de
   confiable que como la ND separada muestra su propia fecha. Se descubrió
   la causa raíz al revisar el código: la fecha de factura que se imprime
   hoy salía de `datos.notaDebito.fechaFactura` (o de
   `notaDebitoCombinada.leche/transporte.fechaFactura`) — es decir, **solo
   existía si el proveedor tenía una nota de débito configurada y
   aplicable**. Un proveedor sin ND (la mayoría, en la práctica) no
   mostraba ninguna fecha de factura en absoluto.
2. **Quitar la palabra "PAGO" del título**: "COMPROBANTE DE PAGO" →
   "COMPROBANTE" (solo en la factura; el título de la ND separada, ya
   cambiado en una tanda anterior a "NOTA DE DEBITO", no se tocó).

**Solución** (`src/core/receipt/comprobante.ts`,
`comprobanteCombinado.ts`, `comprobanteAgrupado.ts`, `dibujo.ts`, y las
pantallas que arman el contexto):
- `DatosComprobante` y `ContextoComprobante` ganan un campo `fechaFactura`
  nuevo, **independiente** de `notaDebito`/`notaDebitoCombinada` — viene
  directo del campo "Fecha de factura" del panel "Fechas del documento"
  (`fechas.factura` en el shell `Comprobantes.tsx`), no de la ND.
  `construirComprobante` lo toma de `ctx.fechaFactura`;
  `construirComprobanteCombinado` de `ctxLeche.fechaFactura` (el lado
  leche manda, mismo criterio que ya usan folio/empresa/título ahí);
  `construirComprobanteAgrupado` de `principal.ctx.fechaFactura`.
  `SeccionComprobantesGenerales.tsx`/`SeccionNotasDebito.tsx` pasan
  `fechaFactura: fechas.factura` tanto en `ctx` como en `ctxOtro` (la
  nómina hermana no tiene su propio ajuste de fechas cargado en esta
  pantalla, así que se usa el mismo valor configurado aquí como
  aproximación razonable — es el caso común, ambas nóminas de la semana
  comparten fecha de factura).
- `dibujarBloqueIdentificacion` (dibujo.ts) se reordenó: ya no arma una
  sola línea combinada "Fecha de Factura X · Fecha de Nota de débito Y"
  condicionada a que hubiera ND. Ahora, si **no** es la ND separada
  (`!soloFechaNota`), siempre imprime primero `Fecha de Factura
  {datos.fechaFactura}` en su propia línea; después, si
  `opciones.mostrarNotaDebito` y la ND aplica, añade una línea aparte
  "Fecha de Nota de débito {fecha}" (con prefijo "Leche ·"/"Flete ·" si es
  combinado) — ya no repite "Fecha de Factura" ahí. La ND separada
  (`soloFechaNota`) sigue exactamente igual: solo su propia fecha, la de
  factura no aplica a ese documento.
- Título: `'COMPROBANTE DE PAGO'` → `'COMPROBANTE'` en la llamada desde
  `dibujarComprobante`.
- **Verificado de punta a punta con datos reales**: se cambió la "Fecha de
  factura" del panel a una fecha distintiva (10/08/2026) y se descargaron
  dos facturas del mismo proveedor de transporte real —una sin ND
  ("DANY DARIO ZAMORA ROMERO"): antes no mostraba ninguna fecha, ahora
  muestra "Fecha de Factura 10/08/2026" y título "COMPROBANTE"; otra con ND
  ("BERNABE DE JESUS ANDRADE RON"): muestra "Fecha de Factura 10/08/2026"
  y, en línea aparte, "Fecha de Nota de débito 04/08/2026" (la fecha
  propia de esa ND importada, sin cambiar). Se descargó también la ND
  separada de este último y se confirmó que sigue mostrando solo su fecha
  propia, sin "Fecha de Factura" — no se rompió nada de la tanda anterior.

### Sesión anterior (10): separar "Concepto manual" de "Configurar ND" en Comprobantes generales

Tras la restructuración en pestañas de una tanda anterior, la columna
"Comprobante" había quedado como: Vista / **Configuración (⚙, un solo
botón)** / Comprobante — el botón ⚙ único navegaba a la pestaña "Notas de
Débito" tanto para configurar la ND como para agregar un concepto manual
(el modal de concepto manual solo quedaba accesible desde ahí, por fila).
El usuario pidió separar eso en dos accesos independientes y que el de
"concepto manual" vuelva a estar disponible directo en "Comprobantes
generales" (no había razón para que dependiera de la pestaña de ND, ya
que un concepto manual **solo afecta a la factura**, no tiene relación con
la nota de débito).

**Cambio** (`src/ui/screens/comprobantes/SeccionComprobantesGenerales.tsx`,
`src/ui/estilos.css`):
- La columna única "⚙ Configuración" se separó en dos columnas
  compactas: **"+"** (título "Concepto manual") y **"⚙"** (título "Nota de
  débito"). El botón "+" ahora abre `ModalConceptoManual` directo para esa
  fila (`setDialogo({tipo:'manual', ids:[r.id]})`), igual que como
  funcionaba antes de la restructuración en pestañas — ya no navega a
  ninguna pestaña. El botón "⚙" no cambió de comportamiento: sigue
  llamando a `irAConfiguracion(r.leido.codigo)` (cambia a la pestaña
  "Notas de Débito" filtrada a ese proveedor), porque configurar la ND sí
  tiene sentido hacerlo desde ese espacio (ahí es donde vive también el
  import de Excel).
- **Regresión de desborde, otra vez** (misma clase de bug ya visto dos
  veces en tandas anteriores): agregar la columna "+" volvió a desbordar
  la tabla a 1280px (71px de más). Se corrigió recortando el padding base
  de toda la tabla (`table.tabla th, td`) de `7px 8px` a `7px 5px`, y el
  de las columnas compactas (`.compacta`, ya eran Vista/⚙, ahora suman 3
  con la nueva "+") de `6px` a `4px` por lado. Quedó en ~5px de desborde
  (imperceptible, mismo margen que se aceptó la vez anterior).
- **Verificado en el navegador**: a 1280px la tabla no desborda; clic en
  "+" abre el modal de concepto manual ahí mismo sin cambiar de pantalla;
  clic en "⚙" sigue llevando a "Notas de Débito" filtrada al código de esa
  fila; en modo tarjeta a 375px los 4 bloques de acciones (Vista / + /
  ⚙ / Comprobante) se ven con buen espacio, sin apretarse.

### Sesión anterior (11): import de Excel real corregido, emparejamiento por nombre corregido, suma de ND por SAP

El usuario reportó que el Excel real de ND (`entradas/ND CALCULADA.xlsx`,
generado por su propio proceso, no un archivo de prueba) daba error al
importarlo, y pidió que los códigos de SAP repetidos se sumen al generar
los comprobantes.

**Bug real: el parser asumía una columna que el archivo real no tiene**
(`src/core/db/notaDebitoExcel.ts`) — el diseño original (de la tanda que
agregó el import de Excel) asumía que la columna 2 siempre era "Código de
Proveedor" (agregada a pedido del usuario en su momento). El archivo real
que el usuario usa en la práctica **no tiene esa columna**: sus columnas
son Fecha, Fábrica, SAP, Proveedor, Litros Enviados, ... (el orden
original, sin el código). Leer por posición fija hacía que todo se
desalineara — la columna "Fábrica" se leía como código, "SAP" como
fábrica, "Proveedor" como SAP, "Litros Enviados" como proveedor, etc. — y
el error final que veía el usuario era "debe traer litros enviados O
litros transportados, no ambos ni ninguno" en todas las filas, porque las
columnas de litros reales quedaban leyendo precios en su lugar.
- **Corregido**: el parser ahora identifica cada columna **por el texto de
  su encabezado** (fila 1), no por posición — así funciona con o sin la
  columna "Código de Proveedor" (opcional), y no depende del orden exacto.
  Se agregó `normalizarEncabezado()` (quita acentos/signos/mayúsculas) y
  `mapaEncabezados()` para construir el mapa nombre→columna. Si faltan
  columnas esenciales (Fecha, Proveedor, Litros Enviados/Transportados,
  Bs. a Pagar x Dif.), se avisa con un mensaje claro en vez de fallar fila
  por fila.

**Bug real: un nombre corto calzaba por prefijo con uno largo de OTRO
proveedor** — al probar con datos reales apareció el caso "DIAMAGRO" (un
proveedor) vs "DIAMAGRO, C.A." (otro proveedor **distinto**, mismo SAP
mismo dueño real pero registrado con dos nombres). El emparejamiento por
nombre toleraba el truncado del PDF comparando en las dos direcciones
(`a.startsWith(b) || b.startsWith(a)`), lo que hacía que el nombre corto
"DIAMAGRO" (Excel) calzara por prefijo con el registro "DIAMAGRO, C.A."
(PDF) — y viceversa —, dejando ambas filas como ambiguas ("2 candidatos")
en vez de emparejar cada una con su propio código exacto.
- **Corregido**: ahora se prueba primero el nombre **exacto** (normalizado);
  solo si no hay ningún exacto se intenta el prefijo tolerante (para el
  caso real de truncado del PDF), y esa tolerancia quedó restringida a una
  sola dirección (el nombre del Excel puede ser más largo que el del PDF
  truncado, nunca al revés) — evita que un nombre corto "adopte" por error
  candidatos de un nombre largo no relacionado.

**Nueva funcionalidad: sumar la ND cuando el mismo SAP se repite (misma
fábrica)** (`src/core/receipt/notaDebitoSap.ts`, nuevo archivo) — se
consultó con el usuario antes de construir esto, con ejemplos reales de su
propio archivo (3 patrones encontrados: mismo SAP en leche+transporte,
mismo SAP en fábricas distintas, mismo SAP y misma fábrica con nombres casi
idénticos). Quedó definido así:
- Se combina **solo cuando el SAP Y la fábrica coinciden** — el mismo SAP
  en una fábrica distinta (ej. "AGROLACTEOS EL PRIVILEGIO" en Vigia y en
  Barinas) se deja **separado**, a pedido explícito del usuario ("sepáralo
  por fábricas por si se presenta más adelante").
- Se combina **solo la nota de débito**, nunca la factura: cada código
  sigue generando su propio comprobante con sus propios litros/bruto/
  deducciones, exactamente igual que antes. Es automático (sin pantalla de
  confirmación) porque el SAP es una señal confiable — a diferencia de los
  vínculos/agrupaciones existentes (por RIF/cédula), que sí requieren
  confirmación manual en Ajustes.
- La ND combinada muestra **una línea por miembro** con el monto tal cual
  lo trae el Excel de cada fila (sin recalcular nada) y el total sumado:
  si todos los miembros son del mismo tipo, la línea dice "CÓDIGO N" (igual
  que ya hace la agrupación del mismo tipo existente); si mezcla leche y
  transporte, dice "Leche"/"Flete" (igual que el combinado leche+flete
  existente). Reutiliza el tipo `NotaDebitoAgrupada` ya existente — no hizo
  falta tocar `dibujo.ts` para el dibujo en sí, solo ampliar cuándo se
  muestra el desglose (ver abajo).
- Implementación: `gruposNdPorSap(filas)` agrupa las `NotaDebitoImportada`
  ya emparejadas por `sapExcel`+`fabricaExcel` (2+ filas); `datosConNdPorSap`
  reemplaza `notaDebito`/`notaDebitoCombinada`/`notaDebitoAgrupada` de un
  `DatosComprobante` ya construido por la versión combinada del grupo, sin
  tocar litros/bruto/deducciones. Ambas pantallas
  (`SeccionComprobantesGenerales.tsx`, `SeccionNotasDebito.tsx`) ganan una
  función `unidadParaNd(r)` — análoga a `unidadDe(r)` pero para las
  acciones de ND específicamente (vista previa 🧾, "Descargar ND", ZIP ND) —
  que aplica el grupo SAP si corresponde; las acciones de factura siguen
  usando `unidadDe(r)` sin cambios.
- **Ajuste necesario en `dibujo.ts`**: `dibujarNotaDebito` ocultaba el
  desglose ("Leche: X Bs") **siempre**, sin condición (fix de una tanda
  anterior, para no repetir un monto único). Con 2+ códigos reales
  combinados por SAP, ese desglose deja de ser redundante — es la única
  forma de ver qué códigos componen el total. Se cambió la condición para
  ocultar el desglose **solo cuando tiene 1 línea o menos** (sigue oculto
  para el caso de siempre, ND individual o con una sola fuente aplicable) y
  mostrarlo cuando tiene 2+ (el caso SAP, y también ahora un combinado
  leche+flete calculado por tasas con ambos lados aplicando, que antes
  tampoco lo mostraba — cambio de comportamiento menor pero consistente
  con el mismo criterio).
- **Verificado de punta a punta con el archivo Excel real completo**
  (`entradas/ND CALCULADA.xlsx`, 130 filas, cargando ambas nóminas reales
  de leche y transporte): tras los dos fixes de parseo/emparejamiento, se
  importó sin errores de columnas; "DIAMAGRO"/"DIAMAGRO, C.A." (SAP
  3001137, ambos Vigia) emparejaron correctamente cada uno con su propio
  código; se descargó la ND de "DIAMAGRO" (008169) y se leyó el PDF real:
  título "NOTA DE DEBITO", total "443.813,00 Bs" (65.356 + 378.457,
  redondeado), desglose "CÓDIGO 008169: 65.356,00 Bs" / "CÓDIGO 009120:
  378.457,00 Bs"; se descargó también la factura normal de 008169 y se
  confirmó que muestra sus propios litros (6.126) y su propio monto de ND
  (65.356,00 Bs) sin combinar nada — exactamente el comportamiento
  acordado. El caso mixto leche+transporte (etiquetas "Leche"/"Flete") no
  tenía datos completos en este archivo real para probarlo en el navegador
  (esas filas del Excel venían con la fecha en blanco, así que el parser
  las descarta correctamente con un aviso) — se cubrió con una prueba
  unitaria nueva en `scripts/test-core.ts` en su lugar.

### Esta sesión: números exactos como el Excel + copiar nombre/imagen

Pedido 1: al importar el Excel de ND, ver los números exactos de la vista
del Excel. Causa: las celdas traen el valor crudo (ej. Bs. a Pagar
82950,1575…) y el Excel solo lo MUESTRA redondeado por su formato
(`#,##0` → 82.950); la app hacía `Math.ceil` y daba 82.951. Eso explica
también que la ND sumada de DIAMAGRO saliera 443.813 en la sesión anterior:
con los valores visibles del Excel son 65.355 + 378.456 = **443.811** (y la
suma cruda es 443.811,10, coincide).

- `src/core/db/notaDebitoExcel.ts`: nuevas `decimalesDeFormato(numFmt)`
  (decimales del formato de la celda; null si "General") y
  `redondearComoExcel(valor, dec)` (mitad hacia afuera del cero, con
  `toPrecision(15)` contra el ruido de coma flotante). `celdaANumeroVisible`
  lo aplica a TODAS las columnas numéricas y acepta celdas fórmula
  (`{formula, result}`). `centimos` = valor visible × 100; solo si la celda
  no tiene formato se mantiene el ceil al bolívar entero.
- `src/core/parser/numeros.ts`: `formatearFijo(n, dec)` (decimales fijos
  como Excel: 0,850 en vez de 0,85).
- `SeccionNotasDebito.tsx`: la tabla suma columnas $/Lts·$/Flete, Bs x Lts
  Inicio, Bs x Lts Ajustado y Dif x Lts (3 decimales); el monto se ve como
  en el Excel (82.950, sin ",00" si es entero).
- Las filas importadas ANTES de 1.8.0 conservan el monto viejo (ceil) en la
  base: hay que volver a importar el Excel para corregirlas.

Pedido 2: copiar el nombre del productor y copiar la imagen directo desde
la tabla (aparte de descargar PDF/imagen), ambos botones pegados al nombre.

- `src/platform/tipos.ts`: nueva sección `portapapeles` (`copiarTexto`,
  `copiarImagen(png)`). Web → `navigator.clipboard`; escritorio → IPC
  `portapapeles:texto`/`portapapeles:imagen` en `electron/main.cjs`
  (`clipboard.writeText`, `clipboard.writeImage(nativeImage.createFromBuffer)`),
  expuestos en `electron/preload.cjs`.
- `src/ui/components/NombreConCopia.tsx` (nuevo): nombre + 📋 + 🖼, marca ✓
  1,5 s al copiar; los errores van al aviso de la pantalla. CSS
  `.nombre-con-copia`/`.botones-copia`/`.btn.copiar`: los dos botones van en
  un grupo `nowrap`, así en nombres largos bajan juntos.
- Comprobantes generales: 🖼 copia la FACTURA (`unidadDe`, PNG escala 3).
  Notas de Débito: 🖼 copia la ND (`unidadParaNd`, respeta la suma por
  SAP); solo en filas emparejadas del tipo de la nómina activa. Copiar
  cuenta como entrega en `registrarDescargas` (archivo "… (copiado)").
- Verificación: el panel de navegador de pruebas niega el permiso de
  portapapeles (se vio el aviso de error correcto); con el portapapeles
  simulado se confirmó el texto exacto y un PNG real (1786×1617 factura,
  1786×1440 ND). En Electron se usa el portapapeles nativo, sin permisos.

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
- **Para cargar un PDF/Excel de prueba real (`entradas/...`) en el
  navegador de pruebas sin pasar los bytes por ningún parámetro de texto**:
  copiar el archivo temporalmente a `public/` (Vite lo sirve tal cual en la
  raíz), y en el navegador hacer `fetch('/archivo.pdf').then(r =>
  r.arrayBuffer())` para construir un `File`/`DataTransfer` directamente en
  la página y asignarlo al `<input type=file>` (o combinarlo con el truco
  de interceptar `.click()` de arriba si el input lo crea
  `plataforma.archivos.abrir`). Los bytes viajan disco → servidor Vite →
  `fetch` del navegador, nunca a través de un tool call — evita por
  completo el riesgo de corrupción del base64 manual descrito más abajo.
  Borrar la copia de `public/` al terminar (no debe quedar commiteada).
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
- **Mejor manera de leer un PDF/imagen descargado en el navegador de
  pruebas: NO pasarlo por base64 a mano.** Relayar un base64 grande
  (>4-5k caracteres) copiándolo de vuelta manualmente es propenso a
  corrupción silenciosa — pasó varias veces con PDFs de ND/factura que
  salían con formas/rectángulos rotos o texto faltante al leerlos, y en
  cada caso el archivo real generado por la app estaba perfecto (se
  confirmó comparando SHA-256 del lado del navegador
  `crypto.subtle.digest('SHA-256', bytes)` contra el archivo decodificado
  en disco). El entorno de pruebas SÍ escribe descargas reales en
  `C:\Users\usuario\Downloads\` — es mucho más simple y 100% confiable
  dejar que el botón de descarga real guarde el archivo ahí y leerlo
  directamente con `Read`, sin ningún paso de base64 de por medio. Si el
  archivo queda con extensión `.tmp` (puede pasar en descargas seguidas
  sin gesto de usuario real), copiarlo con extensión `.pdf` antes de
  leerlo — `Read` decide cómo interpretarlo por la extensión. Reservar el
  truco de `Node.prototype.appendChild`/base64 solo para cuando de verdad
  no hay alternativa (por ejemplo, comparar bytes exactos sin depender del
  disco).
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
