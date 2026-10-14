/* ════════════════════════════════════════════════════════════════════
   InventarioApp.jsx — Análisis de stock · Outlet de Puertas
   Mismo shell que Finanzas y RRHH: menú ERP compartido
   (components/MenuErp: barra de módulos, ruta de navegación, contadores
   y contexto), paneles y planillas DataGrid, avisos con sonner.
   FinMenu.jsx no se toca: es de Finanzas.

   Principio de diseño: las pantallas resumen y visualizan; el detalle
   vive en la Base de datos. Todo indicador, barra o celda que tenga "›"
   lleva a la base ya filtrada (irABase), con un "Volver" a la pantalla
   de origen. La ficha de un producto se abre en un panel lateral para
   no perder la pantalla ni los filtros.
   ════════════════════════════════════════════════════════════════════ */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Toaster, toast } from 'sonner'
import { signOut } from '../supabase'
import { scopeIn, roleIn } from '../core/permisos'
import { MenuSuperior, MenuMovil, menuVisible, ubicar } from '../components/MenuErp'
import { Cargando, ErrorBox, Drawer, Enlace, ESTILOS_INV, NAVY, SLATE, BORDE, FONDO } from './invUI'
import {
  fetchBaseProductos, fetchPosiciones, fetchMovimientos, fetchPrioridad, fetchScorecard, fetchComparable,
  fetchCapitalBodega, fetchCapacidadResumen, fetchPareto, fetchHistoria, fetchPoliticas, fetchSalud, fetchConfig,
  CONFIG_DEFECTO, nombreSuc,
} from './invData'
import { informeInventario } from './invInforme'
import { InvResumen } from './InvResumen'
import { InvComparativo } from './InvComparativo'
import { InvPareto } from './InvPareto'
import { InvMatriz } from './InvMatriz'
import { InvCapital } from './InvCapital'
import { InvAbastecimiento } from './InvAbastecimiento'
import { InvBase, TITULOS_BASE } from './InvBase'
import { InvSistema } from './InvSistema'
import { InvProducto } from './InvProducto'
import { InvGlosario } from './InvGlosario'

const ROLES_SIN_COMPRA = ['jefe_tienda', 'jefe_bodega', 'cajero', 'vendedor']
const SCOPE = { 'suc-lg': 'suc-lg', 'suc-la': 'suc-la', 'suc-maipu': 'suc-maipu', 'com-lg': 'suc-lg', 'ops-lg': 'suc-lg' }

/* Menú: misma estructura que Finanzas (módulo › grupo › opción) */
const MENU = [
  { k: 'resumen', l: 'Resumen', grupos: [
    { l: 'Inventario', items: [{ l: 'Panel general', hoja: 'resumen' }] },
  ]},
  { k: 'analisis', l: 'Análisis', grupos: [
    { l: 'Red y salas', items: [{ l: 'Comparativo por sala', hoja: 'comparativo' }] },
    { l: 'Surtido', items: [{ l: 'Pareto por categoría', hoja: 'pareto' }, { l: 'Matriz ABC × XYZ', hoja: 'matriz' }] },
  ]},
  { k: 'capital', l: 'Capital y espacio', grupos: [
    { l: 'Capital', items: [
      { l: 'Alertas de inmovilizado', hoja: 'capital', sub: 'alertas' },
      { l: 'Dinero y cobertura por bodega', hoja: 'capital', sub: 'dinero' },
    ]},
    { l: 'Espacio', items: [{ l: 'Capacidad de bodega', hoja: 'capital', sub: 'capacidad' }] },
  ]},
  { k: 'abast', l: 'Abastecimiento', grupos: [
    { l: 'Decidir', items: [
      { l: 'Qué comprar', hoja: 'comprar', compra: true },  // oculto para roles de tienda: ver `menu` más abajo
      { l: 'Qué reponer y mover', hoja: 'reponer' },
    ]},
  ]},
  { k: 'base', l: 'Base de datos', grupos: [
    { l: 'Planillas', items: [
      { l: TITULOS_BASE.productos, hoja: 'base', sub: 'productos' },
      { l: TITULOS_BASE.movimientos, hoja: 'base', sub: 'movimientos' },
      { l: TITULOS_BASE.posiciones, hoja: 'base', sub: 'posiciones' },
    ]},
  ]},
  { k: 'config', l: 'Configuración', grupos: [
    { l: 'Reglas', items: [{ l: 'Reglas y políticas', hoja: 'sistema', sub: 'reglas' }] },
    { l: 'Datos', items: [{ l: 'Estado de los datos', hoja: 'sistema', sub: 'datos' }] },
  ]},
]
const AYUDA = [{ l: 'Glosario de indicadores', hoja: 'glosario' }]
const HOJAS = new Set([...MENU.flatMap(m => m.grupos.flatMap(g => g.items.map(i => i.hoja))), 'glosario'])
const SUB_DEFECTO = { capital: 'alertas', base: 'productos', sistema: 'reglas' }

/* Qué datos necesita cada pantalla (se piden una vez, al entrar) */
const FUENTES = {
  base: fetchBaseProductos, posiciones: fetchPosiciones, movimientos: fetchMovimientos, prioridad: fetchPrioridad,
  scorecard: fetchScorecard, comparable: fetchComparable, capital: fetchCapitalBodega, capRes: fetchCapacidadResumen,
  pareto: fetchPareto, historia: fetchHistoria, politicas: fetchPoliticas, salud: fetchSalud, cfg: fetchConfig,
}
const SIEMPRE = ['salud', 'cfg', 'capital']
function necesita(hoja, sub) {
  switch (hoja) {
    case 'resumen':     return ['base', 'scorecard', 'movimientos']
    case 'comparativo': return ['scorecard', 'comparable']
    case 'pareto':      return ['pareto']
    case 'matriz':      return ['base']
    case 'capital':     return sub === 'capacidad' ? ['capRes'] : sub === 'dinero' ? ['historia'] : ['base', 'historia', 'politicas']
    case 'comprar':     return ['prioridad']
    case 'reponer':     return ['base', 'movimientos']
    case 'base':        return [sub === 'movimientos' ? 'movimientos' : sub === 'posiciones' ? 'posiciones' : 'base']
    default:            return []
  }
}
const VACIO = { salud: {}, cfg: CONFIG_DEFECTO }

export function InventarioApp({ cu, setAppActual }) {
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 900 : false)
  const [hoja, setHoja] = useState(() => { try { const h = localStorage.getItem('inv_hoja'); return HOJAS.has(h) ? h : 'resumen' } catch { return 'resumen' } })
  const [subs, setSubs] = useState(() => { try { return JSON.parse(localStorage.getItem('inv_subs') || '{}') || {} } catch { return {} } })
  const [consulta, setConsulta] = useState(null)        // { dataset, filtros, titulo, origen:{hoja, sub} }
  const [skuAbierto, setSkuAbierto] = useState(null)
  const [scope, setScope] = useState(null)
  const [rolApp, setRolApp] = useState(null)
  const [datos, setDatos] = useState({})
  const [err, setErr] = useState('')
  const pedidos = useRef(new Set())
  const d = k => datos[k] ?? VACIO[k] ?? []

  const sub = subs[hoja] ?? SUB_DEFECTO[hoja]
  const puedeComprar = !ROLES_SIN_COMPRA.includes(rolApp || '')

  useEffect(() => {
    const r = () => setIsMobile(window.innerWidth < 900)
    window.addEventListener('resize', r); return () => window.removeEventListener('resize', r)
  }, [])
  useEffect(() => { try { localStorage.setItem('inv_hoja', hoja); localStorage.setItem('inv_subs', JSON.stringify(subs)) } catch { /* sin storage */ } }, [hoja, subs])

  /* Rol y alcance (inventario → finanzas → compras) */
  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        let rol = await roleIn(cu, 'inventario'); if (!rol) rol = await roleIn(cu, 'finanzas'); if (!rol) rol = await roleIn(cu, 'compras')
        let s = await scopeIn(cu, 'inventario'); if (!s) s = await scopeIn(cu, 'finanzas'); if (!s) s = await scopeIn(cu, 'compras')
        if (!vivo) return
        setRolApp(rol); if (s && SCOPE[s]) setScope(SCOPE[s])
      } catch { /* sin restricción */ }
    })()
    return () => { vivo = false }
  }, [cu])

  /* Carga perezosa con caché */
  const cargar = useCallback(async (claves, forzar = false) => {
    const faltan = claves.filter(k => forzar || !pedidos.current.has(k))
    if (!faltan.length) return
    faltan.forEach(k => pedidos.current.add(k)); setErr('')
    try {
      const res = await Promise.all(faltan.map(k => FUENTES[k]()))
      setDatos(prev => ({ ...prev, ...Object.fromEntries(faltan.map((k, i) => [k, res[i]])) }))
    } catch (e) { faltan.forEach(k => pedidos.current.delete(k)); setErr(e.message) }
  }, [])
  useEffect(() => { cargar([...SIEMPRE, ...necesita(hoja, sub)]) }, [hoja, sub, cargar])

  /* Navegación del menú: entra "limpio" (sin filtros heredados) */
  const ir = useCallback((h, s) => {
    setHoja(h); if (s !== undefined) setSubs(m => ({ ...m, [h]: s }))
    if (h === 'base') setConsulta(null)
    setSkuAbierto(null)
    try { window.scrollTo({ top: 0 }) } catch { /* jsdom */ }
  }, [])

  /* El mecanismo único de la app: ir a la base de datos ya filtrada */
  const irABase = useCallback((dataset, filtros = {}, titulo) => {
    setConsulta({ dataset, filtros, titulo, origen: hoja === 'base' ? null : { hoja, sub } })
    setHoja('base'); setSubs(m => ({ ...m, base: dataset })); setSkuAbierto(null)
    try { window.scrollTo({ top: 0 }) } catch { /* jsdom */ }
  }, [hoja, sub])

  const recargarAlertas = () => cargar(['base', 'capital'], true)
  const recargarConfig = () => cargar(['cfg', 'base', 'capital', 'capRes', 'posiciones', 'pareto'], true)

  const menu = menuVisible(MENU.map(m => ({ ...m, grupos: m.grupos.map(g => ({ ...g, items: g.items.map(i => i.compra ? { ...i, si: () => puedeComprar } : i) })) })),
                           cu, () => true)
  const capital = d('capital'), cfg = d('cfg'), salud = d('salud')
  const capitalVisible = scope ? capital.filter(c => c.sucursal_id === scope) : capital
  const nAlertas = capitalVisible.reduce((a, c) => a + (+c.alertas_abiertas || 0), 0)   // contador en el menú, como RRHH
  const listo = necesita(hoja, sub).every(k => k in datos) && SIEMPRE.every(k => k in datos)
  const usuario = cu?.email || cu?.nombre || null
  const origen = consulta?.origen ? ubicar(MENU, consulta.origen.hoja, consulta.origen.sub, AYUDA) : null

  const informe = async formato => {
    const id = toast.loading('Armando el informe…')
    try {
      // Usa lo ya cargado; sólo pide lo que falta (sin duplicar consultas)
      const get = k => (k in datos ? datos[k] : FUENTES[k]())
      const [base, scorecard, movimientos, prioridad] = await Promise.all(
        ['base', 'scorecard', 'movimientos', puedeComprar ? 'prioridad' : null].map(k => k ? get(k) : []))
      informeInventario({ formato, capital: capitalVisible, base, scorecard, movimientos, prioridad: puedeComprar ? prioridad : [], scope, cfg })
      toast.success('Informe descargado', { id })
    } catch (e) { toast.error('No se pudo generar: ' + e.message, { id }) }
  }

  const props = { cfg, scope, irABase, onProducto: setSkuAbierto, ir }
  const cerrarSesion = async () => {
    try { await signOut() } catch { /* expirada */ }
    ;['erp_cu_id', 'outlet_app_actual'].forEach(k => localStorage.removeItem(k)); window.location.reload()
  }
  const contexto = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 11.5, color: SLATE, flexWrap: 'wrap' }}>
      <span title={salud.kpi_actualizado ? `Indicadores recalculados ${salud.kpi_actualizado}` : undefined}>
        Inventario al <b style={{ color: '#1C1C1E' }}>{salud.stock_ultimo_snapshot || '—'}</b>
        {scope ? <> · sólo <b style={{ color: '#1C1C1E' }}>{nombreSuc(scope)}</b></> : null}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        Informe completo
        <button onClick={() => informe('pdf')} style={btnInf}>PDF</button>
        <button onClick={() => informe('excel')} style={btnInf}>Excel</button>
      </span>
    </span>
  )
  const propsMenu = {
    menu, hoja, sub, onIr: ir, usuario: cu, rolNombre: scope ? `Alcance: ${nombreSuc(scope)}` : (rolApp || 'Usuario'),
    rolColor: NAVY, marca: 'Inventario', ayuda: AYUDA, badges: { 'capital|alertas': nAlertas }, contexto,
    onApps: () => { try { localStorage.removeItem('outlet_app_actual') } catch { /* */ } setAppActual?.(null) }, onSalir: cerrarSesion,
  }

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif", background: FONDO, minHeight: '100vh', fontSize: 14 }}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:${FONDO};overflow-x:hidden}
        input:focus,select:focus,textarea:focus{border-color:${NAVY}!important;box-shadow:0 0 0 3px rgba(22,33,62,0.08)}
        ::-webkit-scrollbar{width:10px;height:10px}
        ::-webkit-scrollbar-track{background:${FONDO};border-radius:5px}
        ::-webkit-scrollbar-thumb{background:#C7C7CC;border-radius:5px;border:2px solid ${FONDO}}
        table{font-size:13px}
        ${ESTILOS_INV}
        @media (max-width:899px){ body{font-size:13px} table{font-size:11px} button{min-height:34px} }
      `}</style>
      {isMobile ? <MenuMovil {...propsMenu} /> : <MenuSuperior {...propsMenu} />}

      <main style={{ padding: isMobile ? '10px 10px 40px' : '14px 22px 40px', maxWidth: 1920, margin: '0 auto' }}>
        {err && <ErrorBox>No se pudo cargar: {err} <Enlace onClick={() => cargar([...SIEMPRE, ...necesita(hoja, sub)], true)}>Reintentar</Enlace></ErrorBox>}
        {!err && !listo && <Cargando>Cargando…</Cargando>}

        {!err && listo && <>
          {hoja === 'resumen' && <InvResumen {...props} base={d('base')} capital={capitalVisible} scorecard={d('scorecard')} movimientos={d('movimientos')} />}
          {hoja === 'comparativo' && <InvComparativo {...props} scorecard={d('scorecard')} comparable={d('comparable')} pendientes={+salud.rebuild_lotes_pendientes || 0} />}
          {hoja === 'pareto' && <InvPareto {...props} pareto={d('pareto')} />}
          {hoja === 'matriz' && <InvMatriz {...props} base={d('base')} />}
          {hoja === 'capital' && <InvCapital {...props} sub={sub} capital={capital} base={d('base')} capRes={d('capRes')}
                                              historia={d('historia')} politicas={d('politicas')} />}
          {hoja === 'comprar' && puedeComprar && <InvAbastecimiento {...props} vista="comprar" prioridad={d('prioridad')} />}
          {hoja === 'reponer' && <InvAbastecimiento {...props} vista="reponer" base={d('base')} movimientos={d('movimientos')} />}
          {hoja === 'base' && (
            <InvBase dataset={sub} filas={d(sub === 'movimientos' ? 'movimientos' : sub === 'posiciones' ? 'posiciones' : 'base')}
              consulta={consulta?.dataset === sub ? consulta : null} cfg={cfg} scope={scope} onProducto={setSkuAbierto}
              setFiltros={f => setConsulta(c => ({ ...(c?.dataset === sub ? c : { dataset: sub, origen: null }), filtros: f, titulo: c?.dataset === sub ? c.titulo : undefined }))}
              onVolver={origen ? () => ir(consulta.origen.hoja, consulta.origen.sub) : null} origenNombre={origen?.it?.l} />
          )}
          {hoja === 'sistema' && <InvSistema sub={sub} usuario={usuario} onConfigCambiada={recargarConfig} salud={salud} />}
          {hoja === 'glosario' && <InvGlosario cfg={cfg} />}
        </>}
      </main>

      <Drawer abierto={!!skuAbierto} onCerrar={() => setSkuAbierto(null)} titulo={skuAbierto || ''} sub="Ficha del producto">
        {skuAbierto && <InvProducto sku={skuAbierto} usuario={usuario} onCambio={recargarAlertas}
                                    irABase={(ds, f, t) => irABase(ds, f, t)} />}
      </Drawer>
      <Toaster richColors position="top-right" />
    </div>
  )
}

const btnInf = { border: `1px solid ${BORDE}`, background: '#fff', color: NAVY, borderRadius: 6, padding: '3px 10px', fontWeight: 700, fontSize: 11.5, cursor: 'pointer', font: 'inherit' }
