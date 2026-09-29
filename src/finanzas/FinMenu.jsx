import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react'

/* ══════════════════════════════════════════════════════════════════════
   MENÚ DE FINANZAS — barra superior tipo ERP (Laudus / Contaline)
   · El menú se organiza por cómo trabaja el usuario, no por cómo está repartido el código:
     cada opción apunta a (hoja, sub) y abre la pantalla exacta.
   · Visibilidad: capability de la hoja + capability propia (si tiene) + roles (si tiene).
   · Interacción: hover abre (con intención), clic alterna (táctil), Esc cierra,
     flechas navegan, Ctrl/⌘+K abre "Ir a…". Menos movimiento si el sistema lo pide.
   ══════════════════════════════════════════════════════════════════════ */

const NAVY = '#16213E', NAVY_2 = '#223058', INK = '#1C1C1E', SLATE = '#6E6E73'
const BORDE = '#E5E7EB', TINTE = '#EEF1F7', VERDE = '#1E7A44'

const ROLES_SOCIOS = ['admin', 'admin_sistema', 'dir_general', 'dir_negocios']

/* Capability de cada hoja (se conservan las históricas: RBAC y localStorage intactos) */
export const CAP_HOJA = {
  inicio: 'fin.dashboard', analisis: 'fin.presupuesto', pmo_gestion: null,
  conciliacion: 'fin.conciliacion', compras_pagos: 'fin.conciliacion', contabilidad: 'fin.conciliacion',
  tesoreria: 'fin.tesoreria', flujocaja: 'fin.conciliacion', gastos: 'gm.dashboard',
  eerr: 'fin.presupuesto', presupuesto: 'fin.presupuesto', presupuesto_ant: 'fin.presupuesto',
}

/* Arquitectura de información: módulo → grupos → opciones */
export const MENU = [
  { k: 'inicio', l: 'Inicio', grupos: [
    { l: 'Mi día', items: [
      { l: 'Qué hacer hoy', hoja: 'inicio' },
      { l: 'Tareas y reuniones', hoja: 'pmo_gestion' },
      { l: 'Indicadores de mi cargo', hoja: 'contabilidad', sub: 'kpis' },
    ]},
    { l: 'Dirección', items: [
      { l: 'Análisis ejecutivo', hoja: 'analisis' },
    ]},
  ]},
  { k: 'contab', l: 'Contabilidad', grupos: [
    { l: 'Registro', items: [
      { l: 'Comprobantes', hoja: 'contabilidad', sub: 'comprobantes' },
      { l: 'Por clasificar', hoja: 'contabilidad', sub: 'porclasificar' },
      { l: 'Pagos a socios', hoja: 'contabilidad', sub: 'socios', roles: ROLES_SOCIOS },
      { l: 'Plan de cuentas', hoja: 'contabilidad', sub: 'plan' },
    ]},
    { l: 'Libros', items: [
      { l: 'Libro diario', hoja: 'contabilidad', sub: 'diario' },
      { l: 'Libro mayor', hoja: 'contabilidad', sub: 'mayor' },
      { l: 'Libro de compras', hoja: 'contabilidad', sub: 'compras' },
      { l: 'Libro de ventas', hoja: 'contabilidad', sub: 'ventas' },
      { l: 'Libro de banco', hoja: 'contabilidad', sub: 'banco' },
    ]},
    { l: 'Estados financieros', items: [
      { l: 'Balance general e indicadores', hoja: 'contabilidad', sub: 'indicadores' },
      { l: 'Balance de 8 columnas', hoja: 'contabilidad', sub: 'balance' },
      { l: 'Estado de resultados', hoja: 'contabilidad', sub: 'eerrdev' },
      { l: 'Resultado por sucursal', hoja: 'contabilidad', sub: 'eerr_sucursal' },
      { l: 'Flujo de efectivo (NIC 7)', hoja: 'contabilidad', sub: 'flujo_nic7' },
      { l: 'Kardex de inventario (PMP)', hoja: 'contabilidad', sub: 'kardex' },
    ]},
    { l: 'Cierre y cumplimiento', items: [
      { l: 'Cierre de mes', hoja: 'contabilidad', sub: 'cierre' },
      { l: 'Cierre de ejercicio', hoja: 'contabilidad', sub: 'ejercicio' },
      { l: 'Tributario (F29)', hoja: 'contabilidad', sub: 'tributario' },
      { l: 'Ventas contra BSALE', hoja: 'contabilidad', sub: 'control' },
      { l: 'Centro de control', hoja: 'contabilidad', sub: 'centro_control' },
      { l: 'Auditoría', hoja: 'contabilidad', sub: 'auditoria' },
      { l: 'Indicadores de auditoría', hoja: 'contabilidad', sub: 'kpis_auditoria' },
    ]},
  ]},
  { k: 'compras', l: 'Compras y pagos', grupos: [
    { l: 'Facturas de proveedores', items: [
      { l: 'Imputar facturas', hoja: 'compras_pagos', sub: 'imputar' },
      { l: 'Vincular a orden de compra', hoja: 'compras_pagos', sub: 'vincular_oc' },
    ]},
    { l: 'Cuentas por pagar', items: [
      { l: 'Auxiliar de proveedores', hoja: 'contabilidad', sub: 'cxp' },
      { l: 'Pagos de órdenes de compra', hoja: 'compras_pagos', sub: 'pagos_oc' },
      { l: 'Proveedores de materia prima', hoja: 'compras_pagos', sub: 'proveedoresmp' },
    ]},
    { l: 'Reportes', items: [
      { l: 'Resumen de compras', hoja: 'compras_pagos', sub: 'dashboard' },
      { l: 'Órdenes de compra', hoja: 'compras_pagos', sub: 'dashboard_oc' },
    ]},
  ]},
  { k: 'bancos', l: 'Bancos', grupos: [
    { l: 'Conciliación', items: [
      { l: 'Conciliar movimientos', hoja: 'conciliacion', sub: 'conciliar' },
      { l: 'Clasificación masiva', hoja: 'conciliacion', sub: 'masivo' },
      { l: 'Análisis de movimientos', hoja: 'conciliacion', sub: 'analisis' },
    ]},
    { l: 'Cartolas', items: [
      { l: 'Importar cartolas', hoja: 'conciliacion', sub: 'cartolas' },
      { l: 'Cartola de tesorería', hoja: 'tesoreria', sub: 'cartola', cap: 'fin.teso.cartola' },
    ]},
  ]},
  { k: 'teso', l: 'Tesorería', grupos: [
    { l: 'Caja diaria', items: [
      { l: 'Cierre del día', hoja: 'tesoreria', sub: 'cierre', cap: 'fin.teso.cierre' },
      { l: 'Cuadratura y análisis', hoja: 'tesoreria', sub: 'cuadratura', cap: 'fin.teso.analisis' },
      { l: 'Depósitos y abonos', hoja: 'tesoreria', sub: 'depositos', cap: 'fin.teso.depositos' },
      { l: 'Abonos de clientes', hoja: 'tesoreria', sub: 'abonos', cap: 'fin.teso.abonos' },
      { l: 'Validación de pagos', hoja: 'tesoreria', sub: 'validaciones', cap: 'fin.teso.validaciones' },
    ]},
    { l: 'Flujo de caja', items: [
      { l: 'Flujo mensual', hoja: 'flujocaja', sub: 'mensual' },
      { l: 'Flujo semanal', hoja: 'flujocaja', sub: 'semanal' },
      { l: 'Proyección de compromisos', hoja: 'flujocaja', sub: 'compromisos' },
      { l: 'Análisis de riesgo', hoja: 'flujocaja', sub: 'analisis' },
    ]},
    { l: 'Caja chica', items: [
      { l: 'Resumen de caja chica', hoja: 'gastos', sub: 'dashboard', cap: 'gm.dashboard' },
      { l: 'Movimientos de caja chica', hoja: 'gastos', sub: 'movs', cap: 'gm.movimientos' },
    ]},
  ]},
  { k: 'gestion', l: 'Control de gestión', grupos: [
    { l: 'Presupuesto', items: [
      { l: 'Control presupuestario', hoja: 'presupuesto', sub: 'control' },
      { l: 'Edición del presupuesto', hoja: 'presupuesto', sub: 'edicion' },
      { l: 'Presupuesto de caja', hoja: 'presupuesto', sub: 'caja' },
      { l: 'Versiones y aprobación', hoja: 'presupuesto', sub: 'versiones' },
    ]},
    { l: 'Resultados', items: [
      { l: 'Resultado real contra presupuesto', hoja: 'eerr' },
      { l: 'Presupuesto anterior (consulta)', hoja: 'presupuesto_ant' },
    ]},
  ]},
]

export const AYUDA = [
  { l: 'Glosario contable', hoja: 'contabilidad', sub: 'glosario' },
]

/* Filtra el menú según permisos del usuario */
export function menuVisible(cu, pasaCap) {
  const ok = it => pasaCap(CAP_HOJA[it.hoja]) && (!it.cap || pasaCap(it.cap)) && (!it.roles || it.roles.includes(cu?.rol))
  return MENU.map(m => ({ ...m, grupos: m.grupos.map(g => ({ ...g, items: g.items.filter(ok) })).filter(g => g.items.length) }))
    .filter(m => m.grupos.length)
}

/* Ubica (hoja, sub) en el menú: módulo, grupo y opción, para la ruta de navegación */
export function ubicar(menu, hoja, sub) {
  let primero = null
  for (const m of menu) for (const g of m.grupos) for (const it of g.items) {
    if (it.hoja !== hoja) continue
    if (!primero) primero = { m, g, it }
    if ((it.sub ?? null) === (sub ?? null)) return { m, g, it }
  }
  const ayuda = AYUDA.find(a => a.hoja === hoja && a.sub === sub)
  if (ayuda) return { m: { k: 'ayuda', l: 'Ayuda' }, g: { l: 'Ayuda' }, it: ayuda }
  return primero
}

/* Panel desplegable que se corre a la izquierda si no cabe en la pantalla */
function PanelModulo({ children, style, ...rest }) {
  const ref = useRef(null)
  const [dx, setDx] = useState(0)
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (r) { const exceso = r.right - (window.innerWidth - 10); setDx(exceso > 0 ? -Math.min(exceso, r.left - 10) : 0) }
  }, [])
  return <div ref={ref} {...rest} style={{ ...style, transform: dx ? `translateX(${dx}px)` : undefined }}>{children}</div>
}

const esActivo = (it, hoja, sub) => it.hoja === hoja && (it.sub ? it.sub === sub : true)
const reduce = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/* ─────────────────────────── ESCRITORIO ─────────────────────────── */
export function MenuSuperior({ menu, hoja, sub, onIr, usuario, rolNombre, rolColor, onApps, onSalir }) {
  const [abierto, setAbierto] = useState(null)       // k del módulo con panel abierto
  const [buscar, setBuscar] = useState(false)
  const [userMenu, setUserMenu] = useState(false)
  const tAbrir = useRef(null), tCerrar = useRef(null)
  const barra = useRef(null)
  const activo = ubicar(menu, hoja, sub)

  const programarAbrir = k => { clearTimeout(tCerrar.current); clearTimeout(tAbrir.current); tAbrir.current = setTimeout(() => setAbierto(k), abierto ? 0 : 90) }
  const programarCerrar = () => { clearTimeout(tAbrir.current); tCerrar.current = setTimeout(() => setAbierto(null), 180) }
  const ir = it => { setAbierto(null); setUserMenu(false); onIr(it.hoja, it.sub) }

  // Ctrl/⌘+K abre "Ir a…"; Esc cierra todo
  useEffect(() => {
    const h = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setBuscar(true); setAbierto(null) }
      if (e.key === 'Escape') { setAbierto(null); setUserMenu(false) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  // Clic fuera cierra
  useEffect(() => {
    const h = e => { if (barra.current && !barra.current.contains(e.target)) { setAbierto(null); setUserMenu(false) } }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // Teclado dentro del panel: flechas recorren las opciones
  const onKeyPanel = e => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return
    const items = [...e.currentTarget.querySelectorAll('[data-menuitem]')]
    const i = items.indexOf(document.activeElement)
    const j = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)
    items[j]?.focus(); e.preventDefault()
  }

  return (
    <div ref={barra} style={{ position: 'sticky', top: 0, zIndex: 60 }}>
      <style>{`
        .fm-mod:focus-visible,.fm-it:focus-visible,.fm-btn:focus-visible{outline:2px solid #9DB4FF;outline-offset:2px}
        .fm-it:hover,.fm-it:focus{background:${TINTE}}
        .fm-panel{animation:fmIn 120ms ease-out}
        @keyframes fmIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
        @media (prefers-reduced-motion: reduce){.fm-panel{animation:none}}
        @media (max-width:1180px){.fm-kbd{display:none}.fm-ira{min-width:0!important}.fm-mod{padding:0 9px!important}}
        @media (max-width:1060px){.fm-brand-sub,.fm-ira-txt{display:none}}
      `}</style>
      {/* Barra de módulos */}
      <nav aria-label="Módulos de Finanzas" style={{ background: NAVY, height: 48, display: 'flex', alignItems: 'stretch', padding: '0 14px', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', paddingRight: 14, marginRight: 6, borderRight: '1px solid rgba(255,255,255,0.12)' }}>
          <span style={{ color: '#fff', fontWeight: 800, fontSize: 14, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>Outlet de Puertas</span>
          <span className="fm-brand-sub" style={{ color: 'rgba(255,255,255,0.55)', fontWeight: 500, fontSize: 13, marginLeft: 6 }}>Finanzas</span>
        </div>
        {menu.map(m => {
          const esMod = activo?.m?.k === m.k
          const open = abierto === m.k
          return (
            <div key={m.k} style={{ position: 'relative', display: 'flex' }}
              onMouseEnter={() => programarAbrir(m.k)} onMouseLeave={programarCerrar}>
              <button className="fm-mod" aria-haspopup="true" aria-expanded={open}
                onClick={() => setAbierto(open ? null : m.k)}
                onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setAbierto(m.k); setTimeout(() => document.querySelector(`[data-panel="${m.k}"] [data-menuitem]`)?.focus(), 0) } }}
                style={{
                  background: open ? NAVY_2 : 'transparent', border: 'none', cursor: 'pointer', color: '#fff',
                  fontSize: 13, fontWeight: esMod ? 700 : 500, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6,
                  boxShadow: esMod ? `inset 0 -3px 0 #fff` : 'none', opacity: esMod || open ? 1 : 0.86, whiteSpace: 'nowrap',
                }}>
                {m.l}
                <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true" style={{ opacity: 0.6, transform: open ? 'rotate(180deg)' : 'none', transition: reduce() ? 'none' : 'transform 120ms' }}><path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg>
              </button>
              {open && (
                <PanelModulo className="fm-panel" data-panel={m.k} role="menu" aria-label={m.l} onKeyDown={onKeyPanel}
                  style={{
                    position: 'absolute', top: 48, left: 0, background: '#fff', border: `1px solid ${BORDE}`, borderTop: 'none',
                    borderRadius: '0 0 10px 10px', boxShadow: '0 16px 36px rgba(22,33,62,0.16)', padding: '14px 8px 10px',
                    display: 'grid', gridTemplateColumns: `repeat(${Math.min(m.grupos.length, 4)}, minmax(200px, auto))`, gap: '4px 10px', zIndex: 70,
                  }}>
                  {m.grupos.map(g => (
                    <div key={g.l} role="group" aria-label={g.l} style={{ minWidth: 200 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, padding: '2px 10px 6px' }}>{g.l}</div>
                      {g.items.map(it => {
                        const act = esActivo(it, hoja, sub)
                        return (
                          <button key={it.l} data-menuitem role="menuitem" className="fm-it" onClick={() => ir(it)}
                            style={{
                              display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', borderRadius: 6,
                              background: act ? TINTE : 'transparent', padding: '6px 10px', fontSize: 12.5, color: act ? NAVY : INK,
                              fontWeight: act ? 700 : 400, boxShadow: act ? `inset 3px 0 0 ${VERDE}` : 'none', whiteSpace: 'nowrap',
                            }}>{it.l}</button>
                        )
                      })}
                    </div>
                  ))}
                </PanelModulo>
              )}
            </div>
          )
        })}
        <div style={{ flex: 1 }} />
        {/* Utilidades */}
        <button className="fm-btn fm-ira" onClick={() => setBuscar(true)} title="Ir a una pantalla (Ctrl+K)" aria-label="Ir a una pantalla"
          style={{ alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, color: 'rgba(255,255,255,0.85)', fontSize: 12, padding: '6px 10px', cursor: 'pointer', minWidth: 170 }}>
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" fill="none" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" /></svg>
          <span className="fm-ira-txt" style={{ flex: 1, textAlign: 'left' }}>Ir a…</span>
          <kbd className="fm-kbd" style={{ fontSize: 10, opacity: 0.7, fontFamily: 'inherit' }}>Ctrl K</kbd>
        </button>
        <div style={{ position: 'relative', display: 'flex', marginLeft: 6 }}>
          <button className="fm-btn" onClick={() => setUserMenu(v => !v)} aria-haspopup="true" aria-expanded={userMenu}
            style={{ alignSelf: 'center', background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px' }}>
            <span style={{ width: 28, height: 28, borderRadius: 28, background: 'rgba(255,255,255,0.14)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
              {String(usuario?.nombre ?? '?').split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase()}
            </span>
          </button>
          {userMenu && (
            <div className="fm-panel" role="menu" style={{ position: 'absolute', right: 0, top: 48, background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 10, boxShadow: '0 16px 36px rgba(22,33,62,0.16)', padding: 8, minWidth: 230, zIndex: 70 }}>
              <div style={{ padding: '6px 10px 10px', borderBottom: `1px solid ${BORDE}`, marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>{usuario?.nombre}</div>
                <div style={{ fontSize: 11.5, color: rolColor ?? SLATE, fontWeight: 600 }}>{rolNombre}</div>
              </div>
              {AYUDA.map(a => <button key={a.l} role="menuitem" className="fm-it" onClick={() => ir(a)} style={itemPlano}>{a.l}</button>)}
              <button role="menuitem" className="fm-it" onClick={() => { setUserMenu(false); onApps() }} style={itemPlano}>Cambiar de aplicación</button>
              <button role="menuitem" className="fm-it" onClick={onSalir} style={{ ...itemPlano, color: '#B42318' }}>Cerrar sesión</button>
            </div>
          )}
        </div>
      </nav>
      {/* Ruta de navegación */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${BORDE}`, padding: '8px 22px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: SLATE, minHeight: 36 }}>
        {activo ? (<>
          <span>{activo.m.l}</span><Chevron /><span>{activo.g.l}</span><Chevron />
          <span style={{ color: INK, fontWeight: 700, fontSize: 13.5 }}>{activo.it.l}</span>
        </>) : <span>Finanzas</span>}
      </div>
      {buscar && <IrA menu={menu} onIr={it => { setBuscar(false); onIr(it.hoja, it.sub) }} onCerrar={() => setBuscar(false)} />}
    </div>
  )
}

const itemPlano = { display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, padding: '7px 10px', fontSize: 12.5, color: INK }
const Chevron = () => <svg width="7" height="10" viewBox="0 0 7 10" aria-hidden="true"><path d="M1 1l4 4-4 4" stroke="#B0B4BC" strokeWidth="1.5" fill="none" /></svg>

/* ─────────────── "Ir a…": busca cualquier pantalla por nombre, grupo o módulo ─────────────── */
function IrA({ menu, onIr, onCerrar }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef(null)
  const todos = useMemo(() => [
    ...menu.flatMap(m => m.grupos.flatMap(g => g.items.map(it => ({ it, ruta: `${m.l} › ${g.l}` })))),
    ...AYUDA.map(it => ({ it, ruta: 'Ayuda' })),
  ], [menu])
  const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const res = useMemo(() => {
    const t = norm(q.trim())
    if (!t) return todos.slice(0, 12)
    const palabras = t.split(/\s+/)
    const puntaje = x => {
      const n = norm(x.it.l)
      if (n.startsWith(t)) return 3
      if (palabras.every(p => n.includes(p))) return 2
      return 1
    }
    return todos.filter(x => palabras.every(p => norm(`${x.it.l} ${x.ruta}`).includes(p)))
      .map((x, i) => ({ ...x, s: puntaje(x), i })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, 12)
  }, [q, todos])
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { setSel(0) }, [q])
  const onKey = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(res.length - 1, s + 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)) }
    if (e.key === 'Enter' && res[sel]) onIr(res[sel].it)
    if (e.key === 'Escape') onCerrar()
  }
  return (
    <div role="dialog" aria-modal="true" aria-label="Ir a una pantalla" onMouseDown={onCerrar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,24,48,0.35)', zIndex: 90, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '12vh' }}>
      <div onMouseDown={e => e.stopPropagation()} style={{ width: 'min(560px, 92vw)', background: '#fff', borderRadius: 12, boxShadow: '0 24px 60px rgba(15,24,48,0.3)', overflow: 'hidden' }}>
        <input ref={input} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
          placeholder="Escribe una pantalla: diario, cierre, cartola, presupuesto…"
          aria-label="Buscar pantalla"
          style={{ width: '100%', border: 'none', borderBottom: `1px solid ${BORDE}`, padding: '14px 16px', fontSize: 15, outline: 'none', color: INK }} />
        <div role="listbox" style={{ maxHeight: 380, overflowY: 'auto', padding: 6 }}>
          {res.length === 0 && <div style={{ padding: '14px 12px', fontSize: 13, color: SLATE }}>No hay pantallas con ese nombre. Prueba con otra palabra, por ejemplo "libro" o "caja".</div>}
          {res.map((x, i) => (
            <button key={`${x.it.hoja}-${x.it.sub}-${x.it.l}`} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => onIr(x.it)}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', borderRadius: 8, padding: '9px 12px', background: i === sel ? TINTE : 'transparent' }}>
              <span style={{ fontSize: 13.5, color: INK, fontWeight: i === sel ? 700 : 500 }}>{x.it.l}</span>
              <span style={{ fontSize: 12, color: SLATE, whiteSpace: 'nowrap' }}>{x.ruta}</span>
            </button>
          ))}
        </div>
        <div style={{ borderTop: `1px solid ${BORDE}`, padding: '8px 14px', fontSize: 11.5, color: SLATE, display: 'flex', gap: 14 }}>
          <span>↑ ↓ para moverte</span><span>Enter para abrir</span><span>Esc para cerrar</span>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────── MÓVIL: cajón con acordeón ─────────────────────────── */
export function MenuMovil({ menu, hoja, sub, onIr, usuario, rolNombre, onApps, onSalir }) {
  const [abierto, setAbierto] = useState(false)
  const [mod, setMod] = useState(null)
  const [buscar, setBuscar] = useState(false)
  const activo = ubicar(menu, hoja, sub)
  useEffect(() => { if (abierto) setMod(activo?.m?.k ?? null) }, [abierto]) // eslint-disable-line react-hooks/exhaustive-deps
  const ir = useCallback(it => { setAbierto(false); onIr(it.hoja, it.sub) }, [onIr])
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 60 }}>
      <div style={{ background: NAVY, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', minHeight: 52 }}>
        <button onClick={() => setAbierto(true)} aria-label="Abrir menú" className="fm-btn"
          style={{ width: 38, height: 38, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.12)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true"><path d="M1 1h16M1 7h16M1 13h16" stroke="#fff" strokeWidth="1.8" /></svg>
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>{activo ? `${activo.m.l} › ${activo.g.l}` : 'Finanzas'}</div>
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activo?.it?.l ?? 'Finanzas'}</div>
        </div>
        <button onClick={() => setBuscar(true)} aria-label="Ir a una pantalla" className="fm-btn"
          style={{ width: 38, height: 38, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.12)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" stroke="#fff" strokeWidth="1.8" fill="none" /><path d="M11 11l3.5 3.5" stroke="#fff" strokeWidth="1.8" /></svg>
        </button>
      </div>
      {abierto && (
        <div role="dialog" aria-modal="true" aria-label="Menú de Finanzas" onClick={() => setAbierto(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,24,48,0.4)', zIndex: 90 }}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 'min(330px, 88vw)', background: '#fff', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ background: NAVY, color: '#fff', padding: '16px 16px 14px' }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>Outlet de Puertas <span style={{ fontWeight: 500, opacity: 0.6 }}>Finanzas</span></div>
              <div style={{ fontSize: 12.5, marginTop: 6 }}>{usuario?.nombre}</div>
              <div style={{ fontSize: 11.5, opacity: 0.65 }}>{rolNombre}</div>
            </div>
            <div style={{ flex: 1, padding: 8 }}>
              {menu.map(m => (
                <div key={m.k} style={{ borderBottom: `1px solid ${BORDE}` }}>
                  <button onClick={() => setMod(mod === m.k ? null : m.k)} aria-expanded={mod === m.k}
                    style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: 'none', background: 'transparent', padding: '12px 8px', fontSize: 14, fontWeight: activo?.m?.k === m.k ? 800 : 600, color: NAVY, cursor: 'pointer' }}>
                    {m.l}
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{ transform: mod === m.k ? 'rotate(180deg)' : 'none' }}><path d="M1 3l4 4 4-4" stroke={NAVY} strokeWidth="1.6" fill="none" /></svg>
                  </button>
                  {mod === m.k && m.grupos.map(g => (
                    <div key={g.l} style={{ padding: '0 8px 8px' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: SLATE, padding: '4px 8px' }}>{g.l}</div>
                      {g.items.map(it => {
                        const act = esActivo(it, hoja, sub)
                        return <button key={it.l} onClick={() => ir(it)} style={{ ...itemPlano, padding: '10px 12px', fontSize: 14, background: act ? TINTE : 'transparent', fontWeight: act ? 700 : 400, color: act ? NAVY : INK, boxShadow: act ? `inset 3px 0 0 ${VERDE}` : 'none' }}>{it.l}</button>
                      })}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div style={{ padding: 12, borderTop: `1px solid ${BORDE}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {AYUDA.map(a => <button key={a.l} onClick={() => ir(a)} style={{ ...itemPlano, fontSize: 14 }}>{a.l}</button>)}
              <button onClick={() => { setAbierto(false); onApps() }} style={{ ...itemPlano, fontSize: 14 }}>Cambiar de aplicación</button>
              <button onClick={onSalir} style={{ ...itemPlano, fontSize: 14, color: '#B42318' }}>Cerrar sesión</button>
            </div>
          </div>
        </div>
      )}
      {buscar && <IrA menu={menu} onIr={it => { setBuscar(false); onIr(it.hoja, it.sub) }} onCerrar={() => setBuscar(false)} />}
    </div>
  )
}
