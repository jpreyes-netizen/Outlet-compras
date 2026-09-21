/* ═══════════════════════════════════════════════════════════════════════════
   SERVICE WORKER — Outlet de Puertas ERP
   Estrategia deliberadamente conservadora: el riesgo real de un SW mal hecho
   es servir JS viejo después de un deploy y dejar la app rota sin que nadie
   entienda por qué.

     · Navegación (HTML)      → network-first (el deploy se ve al instante)
     · /assets/* con hash     → cache-first (Vite versiona el nombre, es inmutable)
     · Resto del mismo origen → network-first con fallback a caché
     · Supabase y externos    → NUNCA se cachean (siempre a la red)

   Además deja listos los handlers de Web Push para la etapa de notificaciones.
   ═══════════════════════════════════════════════════════════════════════════ */

const VERSION = 'v1'
const CACHE = 'outlet-erp-' + VERSION
const SHELL = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png']

/* ── Instalación: precachea el shell mínimo ── */
self.addEventListener('install', ev => {
  ev.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL).catch(() => {}))   // si algo falla, no bloquea la instalación
      .then(() => self.skipWaiting())
  )
})

/* ── Activación: limpia cachés de versiones anteriores ── */
self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

/* ── Permite a la app forzar la actualización sin recargar a la fuerza ── */
self.addEventListener('message', ev => {
  if (ev.data && ev.data.type === 'SKIP_WAITING') self.skipWaiting()
})

/* ── Fetch ── */
self.addEventListener('fetch', ev => {
  const req = ev.request
  if (req.method !== 'GET') return

  let url
  try { url = new URL(req.url) } catch (e) { return }

  // Todo lo que no sea del propio origen (Supabase, Storage, APIs) va directo a la red.
  if (url.origin !== self.location.origin) return

  // Navegación: red primero para que los deploys se tomen de inmediato.
  if (req.mode === 'navigate') {
    ev.respondWith(
      fetch(req)
        .then(res => {
          const copia = res.clone()
          caches.open(CACHE).then(c => c.put('/index.html', copia)).catch(() => {})
          return res
        })
        .catch(() => caches.match('/index.html').then(r => r || Response.error()))
    )
    return
  }

  // Bundles de Vite: el nombre lleva hash, así que el contenido nunca cambia.
  if (url.pathname.startsWith('/assets/')) {
    ev.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res && res.status === 200) {
          const copia = res.clone()
          caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {})
        }
        return res
      }))
    )
    return
  }

  // Resto del origen: red primero, caché como red de seguridad sin internet.
  ev.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copia = res.clone()
          caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {})
        }
        return res
      })
      .catch(() => caches.match(req))
  )
})

/* ═══ WEB PUSH — listo para cuando se active el canal de notificaciones ═══ */

self.addEventListener('push', ev => {
  let d = {}
  try { d = ev.data ? ev.data.json() : {} } catch (e) { d = { body: ev.data ? ev.data.text() : '' } }

  const titulo = d.title || 'Outlet ERP'
  const opts = {
    body: d.body || '',
    icon: d.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || 'outlet-erp',
    renotify: true,
    requireInteraction: !!d.requireInteraction,
    vibrate: [180, 80, 180],
    data: { url: d.url || '/', ...(d.data || {}) },
  }
  ev.waitUntil(
    self.registration.showNotification(titulo, opts)
      .then(() => {
        // Badge en el icono (iOS 16.4+ y Android)
        if (self.navigator && self.navigator.setAppBadge && typeof d.badgeCount === 'number') {
          return self.navigator.setAppBadge(d.badgeCount).catch(() => {})
        }
      })
  )
})

self.addEventListener('notificationclick', ev => {
  ev.notification.close()
  const destino = (ev.notification.data && ev.notification.data.url) || '/'
  ev.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
      for (const c of lista) {
        if (c.url.indexOf(self.location.origin) === 0 && 'focus' in c) {
          if ('navigate' in c && destino !== '/') { try { c.navigate(destino) } catch (e) {} }
          return c.focus()
        }
      }
      return self.clients.openWindow(destino)
    })
  )
})
