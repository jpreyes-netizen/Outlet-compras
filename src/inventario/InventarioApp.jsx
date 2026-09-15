/* ════════════════════════════════════════════════════════════════════
   InventarioApp.jsx — Análisis de Stock
   Outlet de Puertas SpA

   Consolidación (sep 2026). Antes: 14 pestañas y dos sistemas en
   paralelo — unas leían un Excel subido a mano y recalculaban en el
   navegador con engine.js, otra leía las vistas SQL. Los resultados no
   coincidían, y el cálculo del cliente arrastraba supuestos que no
   aplican a nuestra demanda: normalidad, sin corrección por quiebre y
   CD contado como sala de venta.

   Ahora: cuatro pestañas, una sola fuente. Los datos entran solos desde
   BSALE todas las noches; no hay carga manual de archivos.

     Torre     dónde está el dinero y dónde se está perdiendo
     Comprar   qué entra al próximo contenedor, por retorno del capital
     Reponer   qué le falta a cada sala y qué puede cubrir el CD
     Sistema   salud de la fuente y política por tipo de producto

   La ficha de producto se abre haciendo clic en cualquier fila.
   ════════════════════════════════════════════════════════════════════ */

import { useState, useEffect } from 'react'
import { signOut } from '../supabase'
import { scopeIn, roleIn } from '../core/permisos'
import { Cargando, ErrorBox, INK, SLATE, LINE, NAVY, AMBAR } from './invUI'
import { InvTorre } from './InvTorre'
import { InvComprar } from './InvComprar'
import { InvReponer } from './InvReponer'
import { InvProducto } from './InvProducto'
import { InvSistema } from './InvSistema'
import {
  fetchKpiSku, fetchRed, fetchPrioridad, fetchAsignacion, fetchSalud,
} from './invData'

const TABS = [
  { k: 'torre',   l: 'Torre' },
  { k: 'comprar', l: 'Comprar' },
  { k: 'reponer', l: 'Reponer' },
  { k: 'sistema', l: 'Sistema' },
]

/* Sucursal asignada al usuario → sucursal_id canónico.
   El CD no es sala de venta: no aparece como alcance de tienda. */
const SCOPE = {
  'suc-lg': 'suc-lg', 'suc-la': 'suc-la', 'suc-maipu': 'suc-maipu',
  'com-lg': 'suc-lg', 'ops-lg': 'suc-lg',
}
const ROLES_SIN_COMPRA = ['jefe_tienda', 'jefe_bodega', 'cajero', 'vendedor']

export function InventarioApp({ cu, setAppActual }) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' ? window.innerWidth < 768 : false)
  const [tab, setTab] = useState('torre')
  const [skuAbierto, setSkuAbierto] = useState(null)
  const [filtroCelda, setFiltroCelda] = useState(null)

  const [kpiSku, setKpiSku] = useState([])
  const [red, setRed] = useState([])
  const [prioridad, setPrioridad] = useState([])
  const [asignacion, setAsignacion] = useState([])
  const [salud, setSalud] = useState({})
  const [cargando, setCargando] = useState(true)
  const [err, setErr] = useState('')

  const [scope, setScope] = useState(null)
  const [rolApp, setRolApp] = useState(null)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /* Rol y alcance: se busca en inventario y se cae a finanzas/compras,
     igual que hacía la versión anterior. */
  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        let rol = await roleIn(cu, 'inventario')
        if (!rol) rol = await roleIn(cu, 'finanzas')
        if (!rol) rol = await roleIn(cu, 'compras')
        let s = await scopeIn(cu, 'inventario')
        if (!s) s = await scopeIn(cu, 'finanzas')
        if (!s) s = await scopeIn(cu, 'compras')
        if (!vivo) return
        setRolApp(rol)
        if (s && SCOPE[s]) setScope(SCOPE[s])
      } catch { /* sin restricción: se ve la red completa */ }
    })()
    return () => { vivo = false }
  }, [cu])

  useEffect(() => {
    let vivo = true
    ;(async () => {
      setCargando(true); setErr('')
      try {
        const [k, r, p, a, s] = await Promise.all([
          fetchKpiSku(), fetchRed(), fetchPrioridad(), fetchAsignacion(), fetchSalud(),
        ])
        if (!vivo) return
        setKpiSku(k); setRed(r); setPrioridad(p); setAsignacion(a); setSalud(s)
      } catch (e) { if (vivo) setErr(e.message) }
      if (vivo) setCargando(false)
    })()
    return () => { vivo = false }
  }, [])

  const kpiVisible = scope ? kpiSku.filter(f => f.sucursal_id === scope) : kpiSku
  const puedeComprar = !ROLES_SIN_COMPRA.includes(rolApp || '')
  const tabsVisibles = TABS.filter(t => t.k !== 'comprar' || puedeComprar)
  const pendientes = +salud.rebuild_lotes_pendientes || 0

  const cerrarSesion = async () => {
    try { await signOut() } catch { /* sesión ya expirada */ }
    ;['erp_cu_id', 'outlet_app_actual'].forEach(k => localStorage.removeItem(k))
    window.location.reload()
  }

  const btnHdr = {
    padding: '5px 11px', fontSize: 12, border: `1px solid ${LINE}`, borderRadius: 4,
    background: '#fff', color: SLATE, cursor: 'pointer', font: 'inherit',
  }

  return (
    <div style={{
      fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif",
      padding: isMobile ? '0 10px 40px' : '0 20px 40px',
      background: '#F5F5F7', minHeight: '100vh', fontSize: 14, color: INK,
    }}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#F5F5F7}
        ::-webkit-scrollbar{width:8px;height:8px}
        ::-webkit-scrollbar-thumb{background:#C7C7CC;border-radius:4px}
      `}</style>

      <div style={{
        position: 'sticky', top: 0, zIndex: 40, background: 'rgba(245,245,247,.94)',
        backdropFilter: 'blur(16px)', paddingTop: 12, marginBottom: 10,
        borderBottom: `1px solid ${LINE}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 9 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: isMobile ? 16 : 19, fontWeight: 700, letterSpacing: '-.03em' }}>
              Análisis de Stock
            </div>
            <div style={{ fontSize: 11, color: SLATE }}>
              {cu?.nombre}{scope ? ' · alcance limitado a su sala' : ''}
              {salud.stock_ultimo_snapshot ? ` · inventario al ${salud.stock_ultimo_snapshot}` : ''}
            </div>
          </div>
          <button style={btnHdr} onClick={() => {
            try { localStorage.removeItem('outlet_app_actual') } catch { /* storage bloqueado */ }
            setAppActual?.(null)
          }}>Apps</button>
          <button style={btnHdr} onClick={cerrarSesion}>Salir</button>
        </div>

        <div style={{ display: 'flex', gap: 3, overflowX: 'auto', paddingBottom: 9 }}>
          {tabsVisibles.map(t => (
            <button key={t.k} onClick={() => { setTab(t.k); setSkuAbierto(null) }}
              style={{
                padding: isMobile ? '6px 12px' : '7px 17px', border: 0, borderRadius: 4,
                cursor: 'pointer', fontSize: isMobile ? 12 : 13, fontWeight: 600,
                whiteSpace: 'nowrap', flexShrink: 0, font: 'inherit',
                background: tab === t.k ? NAVY : 'transparent',
                color: tab === t.k ? '#fff' : SLATE,
              }}>{t.l}</button>
          ))}
        </div>
      </div>

      {pendientes > 0 && (
        <div style={{
          background: AMBAR + '12', border: `1px solid ${AMBAR}40`, borderRadius: 4,
          padding: '7px 11px', marginBottom: 10, fontSize: 12,
        }}>
          Reconstrucción del histórico en curso: quedan <b>{pendientes}</b> lotes.
          Las cifras de demanda y cobertura son provisionales hasta que termine.
        </div>
      )}

      {cargando && <Cargando>Cargando análisis…</Cargando>}
      {err && <ErrorBox>No se pudo cargar el análisis: {err}</ErrorBox>}

      {!cargando && !err && (
        skuAbierto
          ? <InvProducto sku={skuAbierto} onCerrar={() => setSkuAbierto(null)} />
          : <>
              {tab === 'torre' && (
                <InvTorre kpiSku={kpiVisible} red={red} filtroCelda={filtroCelda}
                          setFiltroCelda={setFiltroCelda} onProducto={setSkuAbierto} />
              )}
              {tab === 'comprar' && puedeComprar && (
                <InvComprar prioridad={prioridad} onProducto={setSkuAbierto} />
              )}
              {tab === 'reponer' && (
                <InvReponer kpiSku={kpiVisible} asignacion={asignacion}
                            scopeUsuario={scope} onProducto={setSkuAbierto} />
              )}
              {tab === 'sistema' && <InvSistema />}
            </>
      )}
    </div>
  )
}
