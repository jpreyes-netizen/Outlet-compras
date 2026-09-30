import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react'

/* ══════════════════════════════════════════════════════════════════════
   MENÚ DE LOGÍSTICA — barra superior idéntica a Finanzas (FinMenu.jsx) · 30-sep-2026
   · Presentacional: el menú (módulo → grupos → opciones) y sus permisos los arma
     el shell (LogisticaApp.jsx). Cada opción apunta a (hoja, sub).
   · Hover abre con intención, clic alterna (táctil), Esc cierra, flechas navegan,
     Ctrl/⌘+K abre "Ir a…". Respeta "menos movimiento".
   · Extras de Logística: ubicación activa (fija por perfil; selector solo si hay
     varias opciones), campana de pendientes y utilidades en el menú de usuario.
   · FinMenu.jsx no se toca: Finanzas sigue con su propio archivo.
   ══════════════════════════════════════════════════════════════════════ */

export const NAVY = '#16213E', NAVY_2 = '#223058', INK = '#1C1C1E', SLATE = '#6E6E73'
export const BORDE = '#E5E7EB', TINTE = '#EEF1F7', VERDE = '#1E7A44', ROJO = '#B42318', FONDO = '#F4F5F7'

/* Ubica (hoja, sub) en el menú: módulo, grupo y opción, para la ruta de navegación */
export function ubicar(menu, hoja, sub) {
  let primero = null
  for (const m of menu) for (const g of m.grupos) for (const it of g.items) {
    if (it.hoja !== hoja) continue
    if (!primero) primero = { m, g, it }
    if ((it.sub ?? null) === (sub ?? null)) return { m, g, it }
  }
  return primero
}

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
const itemPlano = { display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, padding: '7px 10px', fontSize: 12.5, color: INK }
const Chevron = () => <svg width="7" height="10" viewBox="0 0 7 10" aria-hidden="true"><path d="M1 1l4 4-4 4" stroke="#B0B4BC" strokeWidth="1.5" fill="none" /></svg>
const iniciales = n => String(n ?? '?').split(' ').filter(Boolean).map(x => x[0]).slice(0, 2).join('').toUpperCase()

/* Campana de pendientes */
function Campana({ alertas, oscuro = true }) {
  if (!alertas) return null
  const n = alertas.n || 0
  return (
    <button className="lm-btn" onClick={alertas.onClick} aria-label={n ? `${n} pendientes de tu atención` : 'Sin pendientes'}
      title={n ? `${n} pendiente(s) de tu atención` : 'Sin pendientes'}
      style={{ position: 'relative', alignSelf: 'center', width: 34, height: 34, borderRadius: 8, border: 'none', cursor: 'pointer',
        background: oscuro ? 'rgba(255,255,255,0.1)' : TINTE, color: oscuro ? '#fff' : NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8a4.2 4.2 0 0 0-4.2 4.2v2.6L2.5 11h11l-1.3-2.4V6A4.2 4.2 0 0 0 8 1.8zM6.3 12.6a1.8 1.8 0 0 0 3.4 0" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" /></svg>
      {n > 0 && (
        <span style={{ position: 'absolute', top: -3, right: -3, minWidth: 17, height: 17, borderRadius: 9, padding: '0 4px', fontSize: 10, fontWeight: 800,
          lineHeight: '17px', textAlign: 'center', color: '#fff', background: alertas.urgente ? ROJO : '#B25E09', border: `2px solid ${oscuro ? NAVY : '#fff'}` }}>{n}</span>
      )}
    </button>
  )
}

/* Ubicación activa: texto fijo (perfil) o selector compacto (varias opciones) */
function Ubicacion({ ubicacion, grande = false }) {
  if (!ubicacion) return null
  const { nombre, valor, opciones = [], onCambiar } = ubicacion
  const fs = grande ? 14 : 12.5
  if (opciones.length > 1 && onCambiar) return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: fs, color: SLATE }}>
      Ubicación
      <select value={valor || ''} onChange={e => onCambiar(e.target.value)} aria-label="Cambiar ubicación de trabajo"
        style={{ fontSize: fs, fontWeight: 700, color: NAVY, border: `1px solid ${BORDE}`, borderRadius: 6, padding: '3px 6px', background: '#fff', cursor: 'pointer', minHeight: 0 }}>
        {opciones.map(o => <option key={o.codigo} value={o.codigo}>{o.nombre}</option>)}
      </select>
    </label>
  )
  return <span style={{ fontSize: fs, color: SLATE }}>Ubicación <b style={{ color: NAVY }}>{nombre || '—'}</b></span>
}

/* ─────────────────────────── ESCRITORIO ─────────────────────────── */
export function MenuSuperior({ menu, hoja, sub, onIr, onInicio, usuario, rolNombre, rolColor, utilidades = [], onApps, onSalir, alertas, ubicacion }) {
  const [abierto, setAbierto] = useState(null)
  const [buscar, setBuscar] = useState(false)
  const [userMenu, setUserMenu] = useState(false)
  const tAbrir = useRef(null), tCerrar = useRef(null)
  const barra = useRef(null)
  const activo = ubicar(menu, hoja, sub)

  const programarAbrir = k => { clearTimeout(tCerrar.current); clearTimeout(tAbrir.current); tAbrir.current = setTimeout(() => setAbierto(k), abierto ? 0 : 90) }
  const programarCerrar = () => { clearTimeout(tAbrir.current); tCerrar.current = setTimeout(() => setAbierto(null), 180) }
  const ir = it => { setAbierto(null); setUserMenu(false); onIr(it.hoja, it.sub) }

  useEffect(() => {
    const h = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setBuscar(true); setAbierto(null) }
      if (e.key === 'Escape') { setAbierto(null); setUserMenu(false) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  useEffect(() => {
    const h = e => { if (barra.current && !barra.current.contains(e.target)) { setAbierto(null); setUserMenu(false) } }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  useEffect(() => () => { clearTimeout(tAbrir.current); clearTimeout(tCerrar.current) }, [])

  const onKeyPanel = e => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return
    const items = [...e.currentTarget.querySelectorAll('[data-menuitem]')]
    const i = items.indexOf(document.activeElement)
    const j = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)
    items[j]?.focus(); e.preventDefault()
  }

  return (
    <div ref={barra} style={{ position: 'sticky', top: 0, zIndex: 300 }}>
      <style>{`
        .lm-mod:focus-visible,.lm-it:focus-visible,.lm-btn:focus-visible{outline:2px solid #9DB4FF;outline-offset:2px}
        .lm-it:hover,.lm-it:focus{background:${TINTE}}
        .lm-panel{animation:lmIn 120ms ease-out}
        @keyframes lmIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
        @media (prefers-reduced-motion: reduce){.lm-panel{animation:none}}
        @media (max-width:1240px){.lm-kbd{display:none}.lm-ira{min-width:0!important}.lm-mod{padding:0 9px!important}}
        @media (max-width:1100px){.lm-brand-sub,.lm-ira-txt{display:none}}
      `}</style>
      <nav aria-label="Módulos de Logística" style={{ background: NAVY, height: 48, display: 'flex', alignItems: 'stretch', padding: '0 14px', gap: 2 }}>
        <button onClick={onInicio} className="lm-btn" title="Ir a Inicio"
          style={{ display: 'flex', alignItems: 'center', paddingRight: 14, marginRight: 6, border: 'none', background: 'transparent', cursor: 'pointer', borderRight: '1px solid rgba(255,255,255,0.12)' }}>
          <span style={{ color: '#fff', fontWeight: 800, fontSize: 14, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>Outlet de Puertas</span>
          <span className="lm-brand-sub" style={{ color: 'rgba(255,255,255,0.55)', fontWeight: 500, fontSize: 13, marginLeft: 6 }}>Logística</span>
        </button>
        {menu.map(m => {
          const esMod = activo?.m?.k === m.k
          const open = abierto === m.k
          return (
            <div key={m.k} style={{ position: 'relative', display: 'flex' }}
              onMouseEnter={() => programarAbrir(m.k)} onMouseLeave={programarCerrar}>
              <button className="lm-mod" aria-haspopup="true" aria-expanded={open}
                onClick={() => setAbierto(open ? null : m.k)}
                onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setAbierto(m.k); setTimeout(() => document.querySelector(`[data-lpanel="${m.k}"] [data-menuitem]`)?.focus(), 0) } }}
                style={{
                  background: open ? NAVY_2 : 'transparent', border: 'none', cursor: 'pointer', color: '#fff',
                  fontSize: 13, fontWeight: esMod ? 700 : 500, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6,
                  boxShadow: esMod ? 'inset 0 -3px 0 #fff' : 'none', opacity: esMod || open ? 1 : 0.86, whiteSpace: 'nowrap', minHeight: 0,
                }}>
                {m.l}
                <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true" style={{ opacity: 0.6, transform: open ? 'rotate(180deg)' : 'none', transition: reduce() ? 'none' : 'transform 120ms' }}><path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg>
              </button>
              {open && (
                <PanelModulo className="lm-panel" data-lpanel={m.k} role="menu" aria-label={m.l} onKeyDown={onKeyPanel}
                  style={{
                    position: 'absolute', top: 48, left: 0, background: '#fff', border: `1px solid ${BORDE}`, borderTop: 'none',
                    borderRadius: '0 0 10px 10px', boxShadow: '0 16px 36px rgba(22,33,62,0.16)', padding: '14px 8px 10px',
                    display: 'grid', gridTemplateColumns: `repeat(${Math.min(m.grupos.length, 4)}, minmax(200px, auto))`, gap: '4px 10px', zIndex: 310,
                  }}>
                  {m.grupos.map(g => (
                    <div key={g.l} role="group" aria-label={g.l} style={{ minWidth: 200 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, padding: '2px 10px 6px' }}>{g.l}</div>
                      {g.items.map(it => {
                        const act = esActivo(it, hoja, sub)
                        return (
                          <button key={it.l} data-menuitem role="menuitem" className="lm-it" onClick={() => ir(it)}
                            style={{
                              display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', borderRadius: 6,
                              background: act ? TINTE : 'transparent', padding: '6px 10px', fontSize: 12.5, color: act ? NAVY : INK,
                              fontWeight: act ? 700 : 400, boxShadow: act ? `inset 3px 0 0 ${VERDE}` : 'none', whiteSpace: 'nowrap', minHeight: 0,
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
        <button className="lm-btn lm-ira" onClick={() => setBuscar(true)} title="Ir a una pantalla (Ctrl+K)" aria-label="Ir a una pantalla"
          style={{ alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, color: 'rgba(255,255,255,0.85)', fontSize: 12, padding: '6px 10px', cursor: 'pointer', minWidth: 170, minHeight: 0, marginRight: 8 }}>
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" fill="none" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" /></svg>
          <span className="lm-ira-txt" style={{ flex: 1, textAlign: 'left' }}>Ir a…</span>
          <kbd className="lm-kbd" style={{ fontSize: 10, opacity: 0.7, fontFamily: 'inherit' }}>Ctrl K</kbd>
        </button>
        <Campana alertas={alertas} />
        <div style={{ position: 'relative', display: 'flex', marginLeft: 6 }}>
          <button className="lm-btn" onClick={() => setUserMenu(v => !v)} aria-haspopup="true" aria-expanded={userMenu} aria-label="Menú de usuario"
            style={{ alignSelf: 'center', background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', minHeight: 0 }}>
            <span style={{ width: 28, height: 28, borderRadius: 28, background: 'rgba(255,255,255,0.14)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
              {iniciales(usuario?.nombre)}
            </span>
          </button>
          {userMenu && (
            <div className="lm-panel" role="menu" style={{ position: 'absolute', right: 0, top: 48, background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 10, boxShadow: '0 16px 36px rgba(22,33,62,0.16)', padding: 8, minWidth: 240, zIndex: 310 }}>
              <div style={{ padding: '6px 10px 10px', borderBottom: `1px solid ${BORDE}`, marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>{usuario?.nombre}</div>
                <div style={{ fontSize: 11.5, color: rolColor ?? SLATE, fontWeight: 600 }}>{rolNombre}</div>
              </div>
              {utilidades.map(u => (
                <button key={u.l} role="menuitem" className="lm-it" onClick={() => { setUserMenu(false); u.onClick() }}
                  style={{ ...itemPlano, color: u.color || INK, fontWeight: u.activo ? 700 : 400 }}>{u.l}</button>
              ))}
              <div style={{ height: 1, background: BORDE, margin: '6px 0' }} />
              <button role="menuitem" className="lm-it" onClick={() => { setUserMenu(false); onApps() }} style={itemPlano}>Cambiar de aplicación</button>
              {onSalir && <button role="menuitem" className="lm-it" onClick={onSalir} style={{ ...itemPlano, color: ROJO }}>Cerrar sesión</button>}
            </div>
          )}
        </div>
      </nav>
      {/* Ruta de navegación + ubicación activa */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${BORDE}`, padding: '8px 22px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: SLATE, minHeight: 36 }}>
        {activo ? (<>
          <span>{activo.m.l}</span><Chevron /><span>{activo.g.l}</span><Chevron />
          <span style={{ color: INK, fontWeight: 700, fontSize: 13.5 }}>{activo.it.l}</span>
        </>) : <span>Logística</span>}
        <div style={{ flex: 1 }} />
        <Ubicacion ubicacion={ubicacion} />
      </div>
      {buscar && <IrA menu={menu} onIr={it => { setBuscar(false); onIr(it.hoja, it.sub) }} onCerrar={() => setBuscar(false)} />}
    </div>
  )
}

/* ─────────────── "Ir a…": busca cualquier pantalla por nombre, grupo o módulo ─────────────── */
function IrA({ menu, onIr, onCerrar }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef(null)
  const todos = useMemo(() => menu.flatMap(m => m.grupos.flatMap(g => g.items.map(it => ({ it, ruta: `${m.l} › ${g.l}` })))), [menu])
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
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,24,48,0.35)', zIndex: 900, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '12vh' }}>
      <div onMouseDown={e => e.stopPropagation()} style={{ width: 'min(560px, 92vw)', background: '#fff', borderRadius: 12, boxShadow: '0 24px 60px rgba(15,24,48,0.3)', overflow: 'hidden' }}>
        <input ref={input} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
          placeholder="Escribe una pantalla: picking, recepción, mermas, viajes…"
          aria-label="Buscar pantalla"
          style={{ width: '100%', border: 'none', borderBottom: `1px solid ${BORDE}`, padding: '14px 16px', fontSize: 15, outline: 'none', color: INK, boxShadow: 'none' }} />
        <div role="listbox" style={{ maxHeight: 380, overflowY: 'auto', padding: 6 }}>
          {res.length === 0 && <div style={{ padding: '14px 12px', fontSize: 13, color: SLATE }}>No hay pantallas con ese nombre. Prueba con otra palabra, por ejemplo "inventario" o "despacho".</div>}
          {res.map((x, i) => (
            <button key={`${x.it.hoja}-${x.it.sub}-${x.it.l}`} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => onIr(x.it)}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', borderRadius: 8, padding: '9px 12px', background: i === sel ? TINTE : 'transparent', minHeight: 0 }}>
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
export function MenuMovil({ menu, hoja, sub, onIr, onInicio, usuario, rolNombre, utilidades = [], onApps, onSalir, alertas, ubicacion }) {
  const [abierto, setAbierto] = useState(false)
  const [mod, setMod] = useState(null)
  const [buscar, setBuscar] = useState(false)
  const activo = ubicar(menu, hoja, sub)
  useEffect(() => { if (abierto) setMod(activo?.m?.k ?? null) }, [abierto]) // eslint-disable-line react-hooks/exhaustive-deps
  const ir = useCallback(it => { setAbierto(false); onIr(it.hoja, it.sub) }, [onIr])
  const btnIco = { width: 38, height: 38, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.12)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 300 }}>
      <div style={{ background: NAVY, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', minHeight: 52 }}>
        <button onClick={() => setAbierto(true)} aria-label="Abrir menú" className="lm-btn" style={btnIco}>
          <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true"><path d="M1 1h16M1 7h16M1 13h16" stroke="#fff" strokeWidth="1.8" /></svg>
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>{activo ? `${activo.m.l} › ${activo.g.l}` : 'Logística'}</div>
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activo?.it?.l ?? 'Logística'}</div>
        </div>
        <Campana alertas={alertas} />
        <button onClick={() => setBuscar(true)} aria-label="Ir a una pantalla" className="lm-btn" style={btnIco}>
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" stroke="#fff" strokeWidth="1.8" fill="none" /><path d="M11 11l3.5 3.5" stroke="#fff" strokeWidth="1.8" /></svg>
        </button>
      </div>
      {abierto && (
        <div role="dialog" aria-modal="true" aria-label="Menú de Logística" onClick={() => setAbierto(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,24,48,0.4)', zIndex: 900 }}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 'min(330px, 88vw)', background: '#fff', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ background: NAVY, color: '#fff', padding: '16px 16px 14px' }}>
              <button onClick={() => { setAbierto(false); onInicio?.() }} style={{ border: 'none', background: 'transparent', color: '#fff', padding: 0, cursor: 'pointer', fontWeight: 800, fontSize: 15, minHeight: 0 }}>
                Outlet de Puertas <span style={{ fontWeight: 500, opacity: 0.6 }}>Logística</span>
              </button>
              <div style={{ fontSize: 12.5, marginTop: 6 }}>{usuario?.nombre}</div>
              <div style={{ fontSize: 11.5, opacity: 0.65 }}>{rolNombre}</div>
            </div>
            {ubicacion && <div style={{ padding: '10px 16px', borderBottom: `1px solid ${BORDE}` }}><Ubicacion ubicacion={ubicacion} grande /></div>}
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
              {utilidades.map(u => <button key={u.l} onClick={() => { setAbierto(false); u.onClick() }} style={{ ...itemPlano, fontSize: 14, color: u.color || INK }}>{u.l}</button>)}
              <button onClick={() => { setAbierto(false); onApps() }} style={{ ...itemPlano, fontSize: 14 }}>Cambiar de aplicación</button>
              {onSalir && <button onClick={onSalir} style={{ ...itemPlano, fontSize: 14, color: ROJO }}>Cerrar sesión</button>}
            </div>
          </div>
        </div>
      )}
      {buscar && <IrA menu={menu} onIr={it => { setBuscar(false); onIr(it.hoja, it.sub) }} onCerrar={() => setBuscar(false)} />}
    </div>
  )
}
