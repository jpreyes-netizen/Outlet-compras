/* ════════════════════════════════════════════════════════════════════
   InventarioApp.jsx — Análisis de Stock
   Outlet de Puertas SpA

   Consolidación (sep 2026). Antes: 14 pestañas y dos sistemas en
   paralelo — unas leían un Excel subido a mano y recalculaban en el
   navegador con engine.js, otra leía las vistas SQL. Los resultados no
   coincidían, y el cálculo del cliente arrastraba supuestos que no
   aplican a nuestra demanda: normalidad, sin corrección por quiebre y
   CD contado como sala de venta.

   Seis pestañas, una sola fuente; cada pestaña pide sus datos al abrirse. Los datos entran solos desde
   BSALE todas las noches; no hay carga manual de archivos.

     Torre     dónde está el dinero y dónde se está perdiendo
     Salas     la hoja del gerente: cada ubicación con las mismas preguntas
     Capital   dinero y espacio detenidos: inmovilizados, cobertura, capacidad
     Comprar   qué entra al próximo contenedor, por retorno del capital
     Reponer   qué le falta a cada sala y qué puede cubrir el CD
     Sistema   salud de la fuente y política por tipo de producto

   La ficha de producto se abre haciendo clic en cualquier fila.
   ════════════════════════════════════════════════════════════════════ */

import { useState, useEffect, useCallback, useRef } from 'react'
import { signOut } from '../supabase'
import { scopeIn, roleIn } from '../core/permisos'
import { Cargando, ErrorBox, INK, SLATE, LINE, NAVY, AMBAR } from './invUI'
import { InvTorre } from './InvTorre'
import { InvComprar } from './InvComprar'
import { InvReponer } from './InvReponer'
import { InvProducto } from './InvProducto'
import { InvSistema } from './InvSistema'
import { InvSalas } from './InvSalas'
import { InvCapital } from './InvCapital'
import {
  fetchKpiSku, fetchRed, fetchPrioridad, fetchAsignacion, fetchSalud, fetchPoliticas,
  fetchScorecard, fetchComparable, fetchRebalanceo, fetchConfig, fetchHistoria,
  fetchCapitalBodega, fetchCapacidadResumen, fetchCapacidad, fetchPareto, fetchInmovilizado,
  CONFIG_DEFECTO,
} from './invData'

/* Cada conjunto de datos se pide una sola vez y sólo cuando una pestaña lo necesita.
   Abrir la app pedía 13 consultas a la vez; en una base de 1 GB eso es evitable. */
const FUENTES = {
  kpiSku: fetchKpiSku, red: fetchRed, salud: fetchSalud, scorecard: fetchScorecard, capital: fetchCapitalBodega,
  cfg: fetchConfig, pareto: fetchPareto, prioridad: fetchPrioridad, asignacion: fetchAsignacion,
  comparable: fetchComparable, rebalanceo: fetchRebalanceo, capRes: fetchCapacidadResumen,
  capacidad: fetchCapacidad, inmov: fetchInmovilizado, historia: fetchHistoria, politicas: fetchPoliticas,
}
const NECESITA = {
  base:    ['kpiSku', 'salud', 'scorecard', 'capital', 'cfg'],   // cabecera, contador de alertas y Torre
  torre:   ['red', 'pareto'],
  salas:   ['comparable', 'rebalanceo'],
  capital: ['capRes', 'capacidad', 'inmov', 'historia', 'politicas'],
  comprar: ['prioridad'],
  reponer: ['asignacion', 'rebalanceo'],
  sistema: [],
}
const VACIO = { salud: {}, cfg: CONFIG_DEFECTO }

const TABS = [
  { k: 'torre',   l: 'Torre' },
  { k: 'salas',   l: 'Salas' },
  { k: 'capital', l: 'Capital' },
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

  const [datos, setDatos] = useState({})
  const [enCurso, setEnCurso] = useState(0)
  const [err, setErr] = useState('')
  const pedidos = useRef(new Set())
  const d = k => datos[k] ?? VACIO[k] ?? []

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

  const cargar = useCallback(async (claves, forzar = false) => {
    const faltan = claves.filter(k => forzar || !pedidos.current.has(k))
    if (!faltan.length) return
    faltan.forEach(k => pedidos.current.add(k))
    setEnCurso(n => n + 1); setErr('')
    try {
      const res = await Promise.all(faltan.map(k => FUENTES[k]()))
      setDatos(prev => ({ ...prev, ...Object.fromEntries(faltan.map((k, i) => [k, res[i]])) }))
    } catch (e) {
      faltan.forEach(k => pedidos.current.delete(k))     // permite reintentar
      setErr(e.message)
    }
    setEnCurso(n => n - 1)
  }, [])

  useEffect(() => { cargar([...NECESITA.base, ...NECESITA.torre]) }, [cargar])
  useEffect(() => { cargar(NECESITA[tab] || []) }, [tab, cargar])

  // Tras gestionar una alerta o cambiar umbrales, sólo se refresca lo afectado
  const recargarCapital = () => cargar(['inmov', 'capital'], true)
  const recargarPorConfig = () => cargar(['cfg', 'inmov', 'capital', 'capRes', 'capacidad', 'pareto'], true)

  const kpiSku = d('kpiSku'), capital = d('capital'), scorecard = d('scorecard'), salud = d('salud'), cfg = d('cfg')
  const kpiVisible = scope ? kpiSku.filter(f => f.sucursal_id === scope) : kpiSku
  const puedeComprar = !ROLES_SIN_COMPRA.includes(rolApp || '')
  const tabsVisibles = TABS.filter(t => t.k !== 'comprar' || puedeComprar)
  const pendientes = +salud.rebuild_lotes_pendientes || 0
  const scTorre = scorecard.find(r => r.sucursal_id === (scope || 'red'))
  const capitalVisible = scope ? capital.filter(c => c.sucursal_id === scope) : capital
  // Contador: alertas que nadie ha tomado todavía (no todos los detenidos)
  const nAlertas = capitalVisible.reduce((a, c) => a + (+c.alertas_abiertas || 0), 0)
  const listo = claves => claves.every(k => k in datos)
  const cargandoBase = !listo(NECESITA.base)
  const cargandoTab = !listo(NECESITA[tab] || [])
  const usuario = cu?.email || cu?.nombre || null

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
              {salud.kpi_actualizado ? ` · indicadores ${salud.kpi_actualizado}` : ''}
              {enCurso > 0 && !cargandoBase ? ' · actualizando…' : ''}
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
              }}>{t.l}{t.k === 'capital' && nAlertas > 0 && (
                <span title={`${nAlertas} alertas sin gestionar: productos con más de ${cfg.dias_lento} días sin moverse`} style={{
                  marginLeft: 6, padding: '0 6px', borderRadius: 8, fontSize: 10.5, fontWeight: 800,
                  background: tab === t.k ? '#fff' : '#B42318', color: tab === t.k ? '#B42318' : '#fff',
                }}>{nAlertas}</span>
              )}</button>
          ))}
        </div>
      </div>

      {pendientes > 0 && (
        <div style={{
          background: AMBAR + '12', border: `1px solid ${AMBAR}40`, borderRadius: 4,
          padding: '7px 11px', marginBottom: 10, fontSize: 12,
        }}>
          Cargando historia de ventas anterior: quedan <b>{pendientes}</b> lotes.
          La comparación contra el año anterior y la rotación anual son provisionales hasta que termine.
        </div>
      )}

      {err && <ErrorBox>No se pudo cargar el análisis: {err} <button onClick={() => cargar(NECESITA[tab] || [], true)}
        style={{ marginLeft: 8, border: 0, background: 'none', color: NAVY, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', font: 'inherit' }}>
        Reintentar</button></ErrorBox>}
      {(cargandoBase || (cargandoTab && !skuAbierto)) && !err && <Cargando>Cargando análisis…</Cargando>}

      {!cargandoBase && !err && (
        skuAbierto
          ? <InvProducto sku={skuAbierto} onCerrar={() => setSkuAbierto(null)} />
          : !cargandoTab && <>
              {tab === 'torre' && (
                <InvTorre kpiSku={kpiVisible} red={d('red')} sc={scTorre} capital={capitalVisible} pareto={d('pareto')} cfg={cfg}
                          onIrCapital={() => setTab('capital')} filtroCelda={filtroCelda}
                          setFiltroCelda={setFiltroCelda} onProducto={setSkuAbierto} />
              )}
              {tab === 'salas' && (
                <InvSalas scorecard={scorecard} comparable={d('comparable')} rebalanceo={d('rebalanceo')}
                          kpiSku={kpiSku} compListo={pendientes === 0} onProducto={setSkuAbierto} />
              )}
              {tab === 'capital' && (
                <InvCapital capital={capital} capRes={d('capRes')} capacidad={d('capacidad')} inmov={d('inmov')}
                            historia={d('historia')} politicas={d('politicas')} cfg={cfg} scope={scope} usuario={usuario}
                            onProducto={setSkuAbierto} onRecargar={recargarCapital} onIrSistema={() => setTab('sistema')} />
              )}
              {tab === 'comprar' && puedeComprar && (
                <InvComprar prioridad={d('prioridad')} onProducto={setSkuAbierto} />
              )}
              {tab === 'reponer' && (
                <InvReponer kpiSku={kpiVisible} asignacion={d('asignacion')} rebalanceo={d('rebalanceo')}
                            scopeUsuario={scope} onProducto={setSkuAbierto} />
              )}
              {tab === 'sistema' && <InvSistema usuario={usuario} onConfigCambiada={recargarPorConfig} />}
            </>
      )}
    </div>
  )
}
