/* Service worker de CompPago.
   Su único fin es que la aplicación abra sin conexión una vez cargada, cosa
   que importa en una laptop corporativa donde la red puede estar filtrada.

   No cachea nada por adelantado porque los nombres de archivo llevan hash y
   cambian en cada compilación: usa «stale-while-revalidate», que sirve al
   instante lo ya visto y a la vez busca la versión nueva para la próxima. */

const CACHE = 'comppago-v1';

self.addEventListener('install', (evento) => {
  self.skipWaiting();
  evento.waitUntil(caches.open(CACHE));
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys();
      await Promise.all(nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;

  evento.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const guardado = await cache.match(peticion);

      const red = fetch(peticion)
        .then((respuesta) => {
          if (respuesta.ok && respuesta.type === 'basic') {
            cache.put(peticion, respuesta.clone());
          }
          return respuesta;
        })
        .catch(() => null);

      if (guardado) {
        // Se refresca en segundo plano para la próxima visita.
        evento.waitUntil(red);
        return guardado;
      }

      const respuesta = await red;
      if (respuesta) return respuesta;

      // Sin conexión y sin copia: si es una navegación, se sirve el índice.
      if (peticion.mode === 'navigate') {
        const indice = await cache.match('./index.html');
        if (indice) return indice;
      }
      return new Response('Sin conexión y sin copia local de este recurso.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    })(),
  );
});
