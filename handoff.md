# Handoff

## 1. Objetivo

Nómina Lechera CompPago: lee los reportes GAN0584 (leche) y GAN0594
(transporte) y genera comprobantes de pago por proveedor. Esta sesión cubrió
el arranque/restauración de datos, la navegación en tableta, las tasas del
BCV por Excel, y un rediseño grande del comprobante (incluida la unión de
comprobantes leche+flete).

## 2. Estado actual

Todo lo de esta sesión está implementado, tipado sin errores
(`npm run check`), pasa `test:core`/`test:parser`, se probó a mano en el
navegador (incluido el flujo completo de vínculo leche+flete con PDF reales)
y está compilado en `release/win-unpacked/CompPago.exe`.

Pendiente de decisión del usuario, no de código:

- En `GAN0594_4.pdf` (nómina 31) "OSCAR ALBERTO PEREZ AÑEZ" aparece dos veces
  bajo rutas distintas (000581 y 000140), con el nombre en orden invertido en
  una de ellas. Falta confirmar si son la misma ruta duplicada o dos reales.
- Las fábricas de los PDF de prueba no tienen empresa asignada en Ajustes
  (los comprobantes muestran "Sin empresa" / "EMPRESA SIN CONFIGURAR"). No es
  un bug, falta cargarlo para nóminas reales.
- Los PDF reales de semana 31/32 que el usuario ya tenía viven en `ejemplos/`
  (no en `entradas/`, la carpeta que se creó para eso) — ambas carpetas están
  protegidas en `.gitignore`.

## 3. Archivos y cambios

**Arranque / restaurar / botón de pánico**
- `src/ui/screens/PrimerArranque.tsx` — paso inicial para elegir crear
  cuenta o restaurar un `.db` existente, con vista previa antes de confirmar.
- `src/core/db/basedatos.ts` — `esArchivoSqlite()`.
- `src/ui/components/RespaldarYBorrar.tsx` (nuevo) — hook compartido
  respaldar-antes-de-borrar.
- `src/ui/screens/BaseAnterior.tsx` — usa ese hook en vez de código propio.
- `src/ui/screens/Ajustes.tsx` — tarjeta "Zona de peligro" (vaciar la base).

**Navegación en tableta**
- `src/ui/App.tsx` — `NavPrincipal` extraído; menú hamburguesa + cajón
  lateral en el tramo 640–1023px (antes el nombre "CompPago" se cortaba).
- `src/ui/estilos.css` — reglas de ese tramo; `.pestanas` de Ajustes pasa de
  scroll horizontal a `flex-wrap`.

**Tasas del BCV**
- `src/core/parser/numeros.ts` — `nombreDia()`.
- `src/core/db/tasasExcel.ts` (nuevo) — construir/leer el libro de Excel.
- `src/ui/screens/Tasas.tsx` — selector de semana ganadera, tabla con
  selección múltiple y edición masiva, import/export a Excel (siempre
  ascendente por fecha al exportar), fila del jueves resaltada.
- `package.json` / `package-lock.json` — dependencia `exceljs`.

**Comprobante (última tanda, 7 partes)**
- `src/core/receipt/dibujo.ts` — precio en Bs/L (a la tasa de la fecha de
  cálculo), fecha de factura/ND movida junto al proveedor, sin la nota de
  "retención" en ISLR, sin el pie "Documento generado por CompPago…",
  insignia y secciones para el comprobante combinado.
- `src/core/types.ts` — `litrosTransf`, `LineaConcepto.origen`,
  `NotaDebitoCombinada`, permiso `vincular-proveedor`.
- `src/core/parser/parseNomina.ts` — captura la columna "Transf." en
  transporte y la usa como `litrosTotal` solo si no hay tabla de litros por
  día.
- `src/core/db/esquema.ts` — tabla `vinculos_proveedor`.
- `src/core/identidad.ts` (nuevo) — `digitosDocumento()` para comparar
  RIF/cédula entre reportes.
- `src/core/db/repo.ts` — `candidatosVinculo`, `vinculosProveedor`,
  `confirmarVinculo`, `rechazarVinculo`, `desvincularProveedor`,
  `vinculoConfirmadoDe`.
- `src/core/auth/permisos.ts` — `vincular-proveedor` solo admin.
- `src/core/receipt/comprobante.ts` — `DatosComprobante` gana
  `notaDebitoCombinada?`/`combinado?` (opcionales, no rompen lo existente).
- `src/core/receipt/comprobanteCombinado.ts` (nuevo) —
  `construirComprobanteCombinado()`.
- `src/ui/components/VistaPrevia.tsx` — clic para ampliar/achicar.
- `src/ui/components/ModalVinculo.tsx` (nuevo) — confirmar o descartar un
  candidato de vínculo.
- `src/ui/screens/Comprobantes.tsx` — detección de candidatos, `unidadDe()`
  (resuelve individual o combinado), badges por fila, descarga combinada
  registrando ambos `registroId`.
- `src/ui/screens/Ajustes.tsx` — sección "Vínculos leche-transporte".
- `src/ui/salida/generar.ts` — `registroId` → `registroIds: string[]`.
- `.gitignore` — `/entradas/`, `/ejemplos/` (PDF con datos reales de
  proveedores).

## 4. Intentos fallidos

- Automatizar clics de mouse (`computer.left_click`) no siempre disparaba
  los manejadores de React en el navegador de pruebas (login, botón
  hamburguesa) — hubo que usar `elemento.click()` por JavaScript directo. Es
  una limitación del entorno de pruebas, no un bug de la app.
- Asignar archivos a un `<input type=file>` con `DataTransfer` falló una vez
  (longitud 0) sin razón clara; al repetir exactamente el mismo código sí
  funcionó. Si hace falta subir archivos por script de nuevo, verificar el
  resultado antes de asumir que falló.
- `exceljs` no tiene un `Buffer` de Node disponible en el build principal
  (no se incluye `@types/node` ahí a propósito). Se resolvió con `as any` en
  `workbook.xlsx.load()`, comentado, en vez de pelear con los tipos.
- Un `mkdir` se ejecutó por error durante una fase de solo-lectura (modo
  plan), creando `entradas/` antes de tener autorización. No causó daño,
  pero fue un descuido a evitar.

## 5. Próximos pasos

1. Decidir sobre "OSCAR ALBERTO PEREZ AÑEZ" duplicado en `GAN0594_4.pdf`
   (rutas 000581 y 000140).
2. Cargar los datos de empresa por fábrica en Ajustes para que los
   comprobantes reales no muestren "Sin empresa".
3. Cargar en la app (no solo verificar por script) los PDF reales de
   `ejemplos/` — semanas 31 y 32 — y confirmar visualmente el comprobante
   combinado y la columna Transf. con datos de producción.
4. Si se van a compartir más PDF de referencia, pegarlos en `entradas/`
   (vacía hoy) en vez de crear una tercera carpeta.
5. Revisar si conviene mover el contenido de `ejemplos/` a `entradas/` para
   no tener dos carpetas con el mismo propósito.
