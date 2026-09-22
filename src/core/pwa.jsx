import { useEffect, useState } from 'react'

/* ═══════════════════════════════════════════════════════════════════════════
   PWA — instalación en iOS / Android y aviso de nueva versión
   · Android / Chrome de escritorio: el evento beforeinstallprompt permite
     instalar con un botón.
   · iOS: Apple no expone ese evento. La única vía es Compartir → Agregar a
     pantalla de inicio, y además SOLO desde Safari (Chrome en iPhone no
     instala PWAs reales). Por eso en iOS mostramos instrucciones.
   Importante: en iOS las notificaciones push solo funcionan si la app quedó
   instalada en la pantalla de inicio. Desde una pestaña del navegador no hay
   push, es una restricción de Apple, no del código.
   ═══════════════════════════════════════════════════════════════════════════ */

export const esIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export const esSafari = () =>
  /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(navigator.userAgent)

export const estaInstalada = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true

/* ── Registro del service worker ── */
export function registrarSW(onNuevaVersion) {
  if (!('serviceWorker' in navigator)) return

  // OJO: React monta despues de que 'load' ya ocurrio, asi que un
  // addEventListener('load', ...) aca NUNCA se dispara y el SW no se registra.
  // Hay que comprobar readyState y registrar de inmediato si ya cargo.
  const hacer = () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        // Detecta un SW nuevo esperando para activarse
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing
          if (!sw) return
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              if (typeof onNuevaVersion === 'function') onNuevaVersion(reg)
            }
          })
        })
        // Revisa si hay versión nueva cada 30 min y al volver a la pestaña
        setInterval(() => { reg.update().catch(() => {}) }, 30 * 60 * 1000)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {})
        })
      })
      .catch(() => {})
  }

  if (document.readyState === 'complete') hacer()
  else window.addEventListener('load', hacer, { once: true })
}

/* ── Escucha al service worker cuando el usuario toca una notificación ──
   El SW manda {type:'DEEPLINK', url}. Fijar el hash no basta: deeplink.js
   parsea una sola vez al cargar el bundle, así que hay que recargar para que
   la navegación ocurra de verdad. Es un instante y garantiza que el destino
   se respete siempre. */
export function escucharDeepLinks() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('message', ev => {
    const d = ev.data
    if (!d || d.type !== 'DEEPLINK' || !d.url) return
    try {
      const destino = new URL(d.url, window.location.origin)
      const mismoSitio = destino.pathname === window.location.pathname
      if (mismoSitio && destino.hash && destino.hash !== window.location.hash) {
        window.location.hash = destino.hash
        window.location.reload()
      } else {
        window.location.href = destino.toString()
      }
    } catch (e) {
      window.location.href = d.url
    }
  })
}

/* ── Banner de instalación + aviso de actualización ── */
export function PwaBanner() {
  const [prompt, setPrompt] = useState(null)      // evento beforeinstallprompt (Android)
  const [verIOS, setVerIOS] = useState(false)     // instrucciones iOS
  const [nuevaVer, setNuevaVer] = useState(null)  // registro con SW esperando
  const [oculto, setOculto] = useState(() => {
    try { return localStorage.getItem('pwa_banner_off') === '1' } catch (e) { return false }
  })

  useEffect(() => {
    const onPrompt = ev => { ev.preventDefault(); setPrompt(ev) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    const onInstalada = () => { setPrompt(null); setVerIOS(false) }
    window.addEventListener('appinstalled', onInstalada)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalada)
    }
  }, [])

  useEffect(() => {
    registrarSW(reg => setNuevaVer(reg))
    escucharDeepLinks()
  }, [])

  const cerrar = () => {
    setOculto(true)
    try { localStorage.setItem('pwa_banner_off', '1') } catch (e) {}
  }

  const instalar = async () => {
    if (!prompt) return
    prompt.prompt()
    try { await prompt.userChoice } catch (e) {}
    setPrompt(null)
  }

  const actualizar = () => {
    if (nuevaVer && nuevaVer.waiting) nuevaVer.waiting.postMessage({ type: 'SKIP_WAITING' })
    setTimeout(() => window.location.reload(), 250)
  }

  /* Aviso de versión nueva — prioridad sobre el banner de instalación */
  if (nuevaVer) {
    return (
      <Barra color="#1F4E79">
        <span style={{ flex: 1 }}>Hay una versión nueva del ERP disponible.</span>
        <button onClick={actualizar} style={btnClaro}>Actualizar</button>
        <button onClick={() => setNuevaVer(null)} style={btnX}>✕</button>
      </Barra>
    )
  }

  if (oculto || estaInstalada()) return null

  /* Android / escritorio con soporte nativo de instalación */
  if (prompt) {
    return (
      <Barra color="#16213e">
        <span style={{ flex: 1 }}>Instala el ERP en tu dispositivo para abrirlo como app.</span>
        <button onClick={instalar} style={btnClaro}>Instalar</button>
        <button onClick={cerrar} style={btnX}>✕</button>
      </Barra>
    )
  }

  /* iOS: instrucciones manuales */
  if (esIOS()) {
    if (!esSafari()) {
      return (
        <Barra color="#16213e">
          <span style={{ flex: 1 }}>Para instalar la app en iPhone, abre esta página en <b>Safari</b>.</span>
          <button onClick={cerrar} style={btnX}>✕</button>
        </Barra>
      )
    }
    return (
      <>
        <Barra color="#16213e">
          <span style={{ flex: 1 }}>Instala el ERP en tu iPhone para abrirlo como app y recibir avisos.</span>
          <button onClick={() => setVerIOS(true)} style={btnClaro}>Cómo</button>
          <button onClick={cerrar} style={btnX}>✕</button>
        </Barra>
        {verIOS && (
          <div onClick={() => setVerIOS(false)} style={{
            position: 'fixed', inset: 0, background: 'rgba(15,18,35,.6)', zIndex: 9999,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}>
            <div onClick={ev => ev.stopPropagation()} style={{
              background: '#fff', borderRadius: '16px 16px 0 0', padding: 22, width: '100%',
              maxWidth: 480, fontFamily: '-apple-system,BlinkMacSystemFont,system-ui,sans-serif',
            }}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 14 }}>Instalar en iPhone</div>
              <Paso n="1" t="Toca el botón Compartir" d="El cuadrado con la flecha hacia arriba, en la barra inferior de Safari." />
              <Paso n="2" t="Elige “Agregar a pantalla de inicio”" d="Está más abajo en la lista de opciones." />
              <Paso n="3" t="Confirma con “Agregar”" d="El icono del ERP queda junto al resto de tus apps." />
              <div style={{ marginTop: 14, padding: '10px 12px', background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 8, fontSize: 12, color: '#075985' }}>
                Los avisos de validación de pagos solo llegan si abres el ERP desde este icono, no desde una pestaña de Safari.
              </div>
              <button onClick={() => setVerIOS(false)} style={{
                width: '100%', marginTop: 16, padding: 12, borderRadius: 10, border: 'none',
                background: '#16213e', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}>Entendido</button>
            </div>
          </div>
        )}
      </>
    )
  }

  return null
}

function Barra({ color, children }) {
  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9998,
      background: color, color: '#fff', padding: '10px 14px',
      paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
      display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5,
      fontFamily: '-apple-system,BlinkMacSystemFont,system-ui,sans-serif',
      boxShadow: '0 -2px 12px rgba(0,0,0,.2)',
    }}>{children}</div>
  )
}

function Paso({ n, t, d }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
      <div style={{
        width: 24, height: 24, borderRadius: 12, background: '#16213e', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 800, flexShrink: 0,
      }}>{n}</div>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{t}</div>
        <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{d}</div>
      </div>
    </div>
  )
}

const btnClaro = { background: '#fff', color: '#16213e', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }
const btnX = { background: 'rgba(255,255,255,.15)', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 9px', fontSize: 12, cursor: 'pointer' }
