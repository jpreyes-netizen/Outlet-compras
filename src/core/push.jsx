import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

/* ═══════════════════════════════════════════════════════════════════════════
   WEB PUSH — suscripción del dispositivo
   Notificación real en la pantalla bloqueada, con sonido. Gratis, sin Meta.

   IMPORTANTE (iPhone): Apple solo permite push si la app está instalada en la
   pantalla de inicio. Desde una pestaña de Safari el objeto PushManager ni
   siquiera existe. Por eso acá detectamos el caso y mostramos instrucciones
   en vez de un botón que no haría nada.
   ═══════════════════════════════════════════════════════════════════════════ */

const esIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const instalada = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true

/* base64url → Uint8Array, formato que exige pushManager.subscribe */
function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

function bufToB64(buf) {
  return window.btoa(String.fromCharCode.apply(null, new Uint8Array(buf)))
}

/* Estados posibles: 'no_soportado' | 'requiere_instalar' | 'inactivo' | 'activo' | 'bloqueado' */
export function usePush(cu) {
  const [estado, setEstado] = useState('inactivo')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  const evaluar = async () => {
    if (!('serviceWorker' in navigator)) { setEstado('no_soportado'); return }

    // iPhone sin instalar: el push simplemente no existe en ese contexto
    if (esIOS() && !instalada()) { setEstado('requiere_instalar'); return }

    if (!('PushManager' in window) || !('Notification' in window)) { setEstado('no_soportado'); return }
    if (Notification.permission === 'denied') { setEstado('bloqueado'); return }

    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      setEstado(sub ? 'activo' : 'inactivo')
    } catch (e) {
      setEstado('inactivo')
    }
  }

  useEffect(() => { evaluar() }, [])

  const activar = async () => {
    setCargando(true); setError('')
    try {
      const permiso = await Notification.requestPermission()
      if (permiso !== 'granted') {
        setEstado(permiso === 'denied' ? 'bloqueado' : 'inactivo')
        return
      }

      const { data: cfg, error: eCfg } = await supabase
        .from('config_sistema').select('valor').eq('clave', 'vapid_public_key').maybeSingle()
      if (eCfg || !cfg?.valor) { setError('Falta la clave pública VAPID en config_sistema'); return }

      const reg = await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8Array(cfg.valor),
        })
      }

      const raw = sub.toJSON()
      const p256dh = raw?.keys?.p256dh || bufToB64(sub.getKey('p256dh'))
      const auth = raw?.keys?.auth || bufToB64(sub.getKey('auth'))

      const { error: eUp } = await supabase.from('push_subscriptions').upsert({
        usuario_id: cu?.id || null,
        usuario_nombre: cu?.nombre || cu?.correo || '',
        endpoint: sub.endpoint,
        p256dh,
        auth,
        user_agent: navigator.userAgent.slice(0, 300),
        eventos: ['validacion_nueva'],
        activo: true,
        fallos: 0,
      }, { onConflict: 'endpoint' })

      if (eUp) { setError(eUp.message); return }
      setEstado('activo')
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setCargando(false)
    }
  }

  const desactivar = async () => {
    setCargando(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await supabase.from('push_subscriptions').update({ activo: false }).eq('endpoint', sub.endpoint)
        await sub.unsubscribe()
      }
      setEstado('inactivo')
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setCargando(false)
    }
  }

  return { estado, cargando, error, activar, desactivar, reevaluar: evaluar }
}

/* ── Botón listo para pegar en cualquier cabecera ── */
export function BotonPush({ cu }) {
  const { estado, cargando, error, activar, desactivar } = usePush(cu)
  const [verAyuda, setVerAyuda] = useState(false)

  if (estado === 'no_soportado') return null

  const base = {
    padding: '6px 12px', borderRadius: 8, fontSize: 11.5, fontWeight: 700,
    cursor: 'pointer', border: '1px solid transparent', whiteSpace: 'nowrap',
  }

  if (estado === 'requiere_instalar') {
    return (
      <>
        <button onClick={() => setVerAyuda(true)}
          style={{ ...base, background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' }}>
          🔔 Activar avisos
        </button>
        {verAyuda && (
          <div onClick={() => setVerAyuda(false)} style={{
            position: 'fixed', inset: 0, background: 'rgba(15,18,35,.6)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              background: '#fff', borderRadius: 14, padding: 22, maxWidth: 420, width: '100%',
            }}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>Instalar el ERP en el iPhone</div>
              <div style={{ fontSize: 12.5, color: '#6B7280', marginBottom: 16 }}>
                Apple solo permite avisos si la app está en la pantalla de inicio. Desde una pestaña de
                Safari no llegan, y no hay forma de saltarse ese paso.
              </div>
              {[
                ['1', 'Toca el botón Compartir', 'El cuadrado con la flecha hacia arriba, abajo en Safari.'],
                ['2', 'Elige "Agregar a pantalla de inicio"', 'Está más abajo en la lista de opciones.'],
                ['3', 'Confirma con "Agregar"', 'Queda el icono junto al resto de tus apps.'],
                ['4', 'Abre el ERP desde ese icono', 'Vuelve acá y toca "Activar avisos" de nuevo.'],
              ].map(([n, t, d]) => (
                <div key={n} style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
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
              ))}
              <button onClick={() => setVerAyuda(false)} style={{
                width: '100%', marginTop: 8, padding: 12, borderRadius: 10, border: 'none',
                background: '#16213e', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}>Entendido</button>
            </div>
          </div>
        )}
      </>
    )
  }

  if (estado === 'bloqueado') {
    return (
      <span title="Habilita las notificaciones para este sitio en los ajustes del navegador"
        style={{ ...base, background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA', cursor: 'help' }}>
        🔕 Avisos bloqueados
      </span>
    )
  }

  if (estado === 'activo') {
    return (
      <button onClick={desactivar} disabled={cargando} title={error || 'Este dispositivo recibe avisos'}
        style={{ ...base, background: '#ECFDF5', color: '#047857', border: '1px solid #A7F3D0' }}>
        {cargando ? '…' : '🔔 Avisos activos'}
      </button>
    )
  }

  return (
    <button onClick={activar} disabled={cargando} title={error || ''}
      style={{ ...base, background: '#1F4E79', color: '#fff' }}>
      {cargando ? 'Activando…' : '🔔 Activar avisos'}
    </button>
  )
}
