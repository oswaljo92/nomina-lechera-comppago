# Resumen de sesión — Nómina Lechera CompPago

Cierre de la sesión de desarrollo. Este documento resume todo lo construido, de inicio a fin, para retomar el trabajo en una nueva sesión.

## Qué es la aplicación

Lee dos formatos de reporte PDF de nómina ganadera venezolana (sin OCR, extracción de texto vía pdf.js):

- **GAN0584_3.pdf** — "PAGO DE LECHE FRESCA" (proveedores de leche)
- **GAN0594_3.pdf** — "NOMINA DE RUTAS" (transportistas)

Y genera comprobantes de pago individuales por proveedor, descargables en PDF/PNG uno por uno o en lote (ZIP).

## Carpeta activa del proyecto

```
C:\Users\usuario\OneDrive\OSWALDO\STARTUP\nomina-lechera-comppago
```

⚠️ La carpeta anterior `...\STARTUP\lectorOCR` **sigue existiendo intacta** — no se pudo eliminar ni renombrar porque Windows la mantiene bloqueada mientras esa sesión de Claude Code sigue abierta (era su directorio de trabajo fijado). Es segura de borrar manualmente en cuanto cierres esa sesión. Todo lo válido y actual está en `nomina-lechera-comppago`.

## Funcionalidad completa (todo implementado y verificado)

1. **Parser de PDF** con validación cuadrada contra los totales que el propio PDF declara (céntimos enteros, sin tolerancias de coma flotante).
2. **Motor de cálculo**: catálogo de conceptos configurable, flag "resta facturación", cálculo de Nota de Débito por diferencial cambiario (tasa BCV).
3. **Base de datos SQLite** (sql.js / WebAssembly, portátil entre web y Electron) con:
   - Tabla `usuarios` (admin/normal) con contraseñas hasheadas (PBKDF2-SHA256, 600.000 iteraciones, salt por usuario).
   - Bloqueo por fuerza bruta persistido en BD (sobrevive recargas/reinicios).
   - Bitácora (audit log) con encadenamiento criptográfico de hashes, con detección de manipulación Y de truncamiento/borrado.
   - Protección de "último administrador": no se puede borrar/desactivar/degradar al único admin activo (no hay recuperación de contraseña por diseño explícito del usuario).
4. **Multi-empresa por fábrica**: cada código de fábrica del PDF se asocia a una empresa (logo, RIF, dirección) que encabeza el comprobante.
5. **Comprobante**: renderizado con primitivas nativas de jsPDF (rect/line/text/addImage) — NO captura de DOM, para evitar el bug de cuelgue cuando la pestaña pierde foco de pintado.
6. **Diseño adaptable** (responsive) en toda la app, incluida Electron:
   - Container queries (no media queries de viewport) para las tablas, porque el ancho del sidebar distorsiona el ancho de viewport disponible.
   - 3 tramos: móvil (<640px, barra inferior), tablet (640–1023px, riel de iconos), escritorio (≥1024px, sidebar completo).
   - Tablas se convierten en tarjetas en pantallas angostas.
7. **Exportar/importar** histórico (.lecdb) con fusión, respaldo y restauración.
8. **Electron solo Windows** (sin soporte macOS): ventana redimensionable con geometría recordada entre sesiones, empaquetado como carpeta descomprimible (no "portable" auto-extraíble, para evitar heurísticas de antivirus/AppLocker).
9. **PWA web** como objetivo principal de despliegue.

## Los dos grandes cambios de esta sesión

### Fase 1 — Responsivo + sistema de usuarios (reemplazo de la clave compartida)

Petición original: hacer toda la app (incluida Electron) responsiva, y sustituir la clave única de administrador por un sistema de usuarios propio (admin/normal), sin código de recuperación.

Decisiones del usuario:
- Todos los usuarios (no solo admins) tienen contraseña propia.
- Recuperación de contraseña: **solo otro administrador puede resetearla** — explícitamente sin código de recuperación, pese a que se advirtió el riesgo de que un único admin pierda el acceso para siempre.
- Se empezó de cero (no se migraron datos del esquema anterior).
- El enfoque de responsividad de tablas quedó a mi criterio (investigar la mejor manera).

Se implementó: tabla `usuarios`, módulo `src/core/auth/usuarios.ts` completo (crear, listar, cambiar rol, activar/desactivar, resetear contraseña, comprobar credenciales con bloqueo progresivo), pantallas de inicio de sesión y gestión de usuarios, guardas de "último administrador", y el sistema CSS de container queries.

### Fase 2 — Renombrado de marca

Petición: renombrar la app a **"Nómina Lechera CompPago"** y renombrar la carpeta principal del proyecto.

Se actualizó branding en: `package.json` (nombre, appId, productName, executableName "CompPago"), `index.html`, `manifest.webmanifest`, service worker, pantallas de bienvenida/login/ajustes, texto del footer del comprobante generado (documento real que reciben los proveedores), README, y el script de empaquetado `pack-desktop.mjs` (ahora lee el nombre de producto/ejecutable dinámicamente desde `package.json` en vez de tenerlo hardcodeado).

El renombrado de carpeta se resolvió con `robocopy` (copia completa a la carpeta nueva) en vez de `Rename-Item`, porque Windows no permite renombrar el directorio de trabajo activo de un proceso — ver nota arriba sobre la carpeta vieja.

**Identificadores internos dejados sin cambiar a propósito** (para no romper compatibilidad con datos ya guardados, y porque el usuario planea usar esta app como módulo dentro de otra más grande a futuro — momento en que sí convendrá revisarlos para evitar colisiones de nombres):
- `window.lectorocr` (bridge de Electron)
- `lectorocr.db` (nombre del archivo SQLite)
- `IDB_BASE = 'lectorocr'` (IndexedDB en web)
- `app://lectorocr/index.html` (protocolo interno de Electron)
- `.claude/launch.json` → `"name": "lectorocr"`

También se descubrió y corrigió peso muerto en el build: jsPDF importa opcionalmente `html2canvas` (~200 KB / 48 KB gzip) para un método `.html()` que esta app no usa. Se excluyó con `rollupOptions.external: ['html2canvas']` en `vite.config.ts` (solo en la carpeta nueva).

## Verificación realizada

- `npm run check` (tipos) — limpio.
- `scripts/test-parser.ts` — 76 proveedores de leche cuadran exactamente con el "Total General" del PDF (369.776.187,91 Bs); 16 rutas de transporte cuadran con los "Total Fabrica" (19.952.738,12 Bs).
- `scripts/test-core.ts` — 102 aserciones: CRUD de usuarios, login éxito/fallo/bloqueo persistente, cambio de contraseña forzado, aislamiento de contraseñas entre usuarios, matriz completa de permisos, protecciones de último-admin, detección de esquema desactualizado, más todos los tests previos de nómina/cálculo/bitácora.
- `npm run build` — exitoso, sin el chunk de `html2canvas`.
- Verificación visual en navegador de la marca nueva ("Nómina Lechera CompPago" / "CompPago").

## Pendiente / próximos pasos posibles

- Nada pendiente explícitamente pedido. El usuario cerrará esta sesión para abrir una nueva desde la carpeta `nomina-lechera-comppago`.
- Cuando el usuario retome el plan de "usar esta app como módulo de una app más grande", revisar los identificadores internos listados arriba (`lectorocr`) para evitar colisiones de namespace en el host.
- Borrar manualmente la carpeta vieja `lectorOCR` una vez cerrada esta sesión (el bloqueo de Windows se libera al terminar el proceso).
