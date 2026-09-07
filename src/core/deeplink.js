// src/core/deeplink.js
// ═══════════════════════════════════════════════════════════════════════════
// DEEP LINK · navegación directa desde correos del ERP
//
// Formato:  https://<app>/#go/<app>/<modulo>/<tab>?param=valor&...
// Ejemplo:  #go/rrhh/asistencia/hhee?suc=suc-mp&desde=2026-08-31&hasta=2026-09-06
//
// Se parsea UNA sola vez al cargar el bundle y se limpia el hash de la URL.
// Cada nivel de la app (App.jsx → RrhhApp → AsistenciaApp) consume su parte
// como valor INICIAL de estado; el RBAC existente sigue mandando: si el
// usuario no tiene acceso al destino, los guards actuales lo redirigen igual
// que siempre. Si el usuario no tiene sesión, el hash ya fue consumido aquí
// (module scope), así que el destino sobrevive al paso por el login.
// ═══════════════════════════════════════════════════════════════════════════
let _dl = null
try {
  const h = window.location.hash || ''
  if (h.startsWith('#go/')) {
    const [path, qs] = h.slice(4).split('?')
    const [app, modulo, tab] = path.split('/').filter(Boolean)
    _dl = {
      app:    app    || null,
      modulo: modulo || null,
      tab:    tab    || null,
      params: Object.fromEntries(new URLSearchParams(qs || '')),
    }
    // Limpia el hash para que recargas posteriores no re-naveguen
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
} catch { _dl = null }

export const deepLink = _dl
