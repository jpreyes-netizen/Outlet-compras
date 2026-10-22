import { useEffect, useId, useMemo, useRef, useState } from 'react'

/* ═══════════════════════════════════════════════════════════════════════
   BUSCADOR DE CUENTAS Y CENTROS DE COSTO (21-oct-2026)
   Reemplaza los <select> largos del plan (148 subcuentas, 15 centros de costo).
     · Se escribe el código o parte del nombre y filtra al tiro: "710" muestra
       todo 710.xx, "710.03" va directo, "herra", "sueldo base", "ops granja".
       Sin tildes ni mayúsculas, todas las palabras en cualquier orden, en el
       código, el nombre de la subcuenta y el de su cuenta madre.
     · Con el índice del historial también encuentra la subcuenta por lo que se
       ha clasificado ahí: "copec" → donde van las compras COPEC.
     · Sin texto muestra: sugeridas, recientes de este equipo y las más usadas.
     · Teclado: ↑/↓ para moverse, Enter elige, Esc cierra. Enter con la lista
       cerrada acepta el valor actual y pasa al campo siguiente.
     · Marca las cuentas contrarias al signo del movimiento (gasto en un abono).
   También vive aquí armarPlan(): el plan único que usan Clasificar y conciliar
   y Estado y vínculos.
   ═══════════════════════════════════════════════════════════════════════ */

const INK = '#1C1C1E', SLATE = '#6E6E73', AMBAR = '#B25E09', AZUL = '#1D4ED8', BORDE = '#E5E7EB'
const INPUT = { fontSize: 12, padding: '5px 8px', border: `1px solid ${BORDE}`, borderRadius: 6, background: '#fff', width: '100%', boxSizing: 'border-box' }

export const normalizar = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const escaparRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const alInicioDePalabra = (texto, t) => new RegExp(`(^|[^a-z0-9])${escaparRe(t)}`).test(texto)

/* ─────────────── plan único: cuenta madre › subcuenta + centro de costo ─────────────── */
export function armarPlan(subsRaw, madresRaw, cecosRaw, sedesRaw) {
  const madres = [...(madresRaw ?? [])].sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)))
  const madreMap = new Map(madres.map(m => [m.id, m]))
  const subs = [...(subsRaw ?? [])].sort((a, b) => String(a.codigo ?? '~').localeCompare(String(b.codigo ?? '~')))
  const subMap = new Map(subs.map(s => [s.id, s]))
  const porMadre = new Map()
  for (const s of subs) {
    if (s.activa === false) continue
    if (!porMadre.has(s.cuenta_madre_id)) porMadre.set(s.cuenta_madre_id, [])
    porMadre.get(s.cuenta_madre_id).push(s)
  }
  const grupos = madres.filter(m => porMadre.has(m.id)).map(m => ({ m, subs: porMadre.get(m.id) }))
  const sedeMap = new Map((sedesRaw ?? []).map(s => [s.id, s]))
  const cecoMap = new Map((cecosRaw ?? []).map(c => [c.id, c]))
  const cecos = [...(cecosRaw ?? [])].filter(c => c.activo !== false).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)))
  const porSede = new Map()
  for (const c of cecos) { const k = c.ceco_id ?? '—'; if (!porSede.has(k)) porSede.set(k, []); porSede.get(k).push(c) }
  const gruposCeco = [...porSede.entries()].map(([k, lista]) => ({ sede: sedeMap.get(k)?.nombre ?? 'Sin sede', lista }))
    .sort((a, b) => a.sede.localeCompare(b.sede))
  const sedeDeCeco = id => sedeMap.get(cecoMap.get(id)?.ceco_id)?.nombre ?? ''
  const requiereCeco = subId => { const s = subMap.get(subId); return !!s && madreMap.get(s.cuenta_madre_id)?.requiere_ceco !== false }
  const nombreSub = id => { const s = subMap.get(id); return s ? `${s.codigo ?? 's/c'} · ${s.nombre}` : '' }
  const nombreCeco = id => { const c = cecoMap.get(id); return c ? `${c.codigo} · ${c.nombre}` : '' }
  const subPorCodigo = new Map(subs.filter(s => s.codigo).map(s => [String(s.codigo), s]))
  const cecoPorCodigo = new Map((cecosRaw ?? []).filter(c => c.codigo).map(c => [String(c.codigo), c]))
  return { subs, subMap, madres, madreMap, grupos, cecos, cecoMap, gruposCeco, sedeDeCeco, requiereCeco, nombreSub, nombreCeco, subPorCodigo, cecoPorCodigo }
}

/* ─────────────── recientes de este equipo ─────────────── */
const CLAVE_RECIENTES = 'outlet_buscador_recientes_'
function leerRecientes(tipo) { try { return JSON.parse(localStorage.getItem(CLAVE_RECIENTES + tipo) || '[]') } catch { return [] } }
function guardarReciente(tipo, id) {
  try { localStorage.setItem(CLAVE_RECIENTES + tipo, JSON.stringify([id, ...leerRecientes(tipo).filter(x => x !== id)].slice(0, 8))) } catch { /* sin almacenamiento */ }
}

/* ─────────────── combobox genérico (ARIA 1.2: combobox + listbox) ─────────────── */
function Combobox({ tipo, value, onChange, onElegido, filtrar, secciones, etiquetaDe, renderOpcion, placeholder, disabled, autoFocus, inputRef, vaciable, invalido, ariaLabel }) {
  const [abierto, setAbierto] = useState(false)
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState('')
  const [activo, setActivo] = useState(0)
  const [pos, setPos] = useState(null)
  const propio = useRef(null)
  const ref = inputRef ?? propio
  const listaId = `bc-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const etiqueta = value ? etiquetaDe(value) : ''
  const q = editando ? texto.trim() : ''
  const items = q ? filtrar(q) : secciones()
  const lista = vaciable && !q ? [{ opcion: { id: '' }, vacio: true }, ...items] : items

  useEffect(() => {
    if (!autoFocus) return undefined
    const t = setTimeout(() => ref.current?.focus(), 0)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setActivo(0) }, [texto])
  useEffect(() => {
    if (!abierto) return undefined
    // La lista va "fija" bajo el campo para que no la recorte un panel con scroll.
    function calcular() {
      const r = ref.current?.getBoundingClientRect(); if (!r) return
      const ancho = Math.max(r.width, 380)
      const abajo = window.innerHeight - r.bottom
      const arriba = abajo < 220 && r.top > abajo
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8)), width: ancho,
        top: arriba ? undefined : r.bottom + 2, bottom: arriba ? window.innerHeight - r.top + 2 : undefined,
        maxHeight: Math.max(160, Math.min(340, (arriba ? r.top : abajo) - 12)),
      })
    }
    calcular()
    window.addEventListener('scroll', calcular, true)
    window.addEventListener('resize', calcular)
    return () => { window.removeEventListener('scroll', calcular, true); window.removeEventListener('resize', calcular) }
  }, [abierto]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (abierto) document.getElementById(`${listaId}-${activo}`)?.scrollIntoView?.({ block: 'nearest' }) }, [activo, abierto, listaId])

  function elegir(id) {
    onChange(id)
    if (id) guardarReciente(tipo, id)
    setAbierto(false); setEditando(false); setTexto('')
    onElegido?.(id)
  }
  function alTeclear(e) {
    if (e.ctrlKey || e.metaKey) return            // Ctrl+Enter lo atiende quien contiene el buscador
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!abierto) { setAbierto(true); setEditando(true) } else setActivo(i => Math.min(i + 1, lista.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setActivo(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (abierto && lista[activo]) { e.preventDefault(); elegir(lista[activo].opcion.id) }
      else if (value) { e.preventDefault(); onElegido?.(value) }
    } else if (e.key === 'Escape' && abierto) {
      e.preventDefault(); e.stopPropagation(); setAbierto(false); setEditando(false); setTexto('')
    }
  }

  let ultima = null
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input ref={ref} type="text" role="combobox" aria-label={ariaLabel} aria-expanded={abierto} aria-controls={listaId} aria-autocomplete="list"
        aria-activedescendant={abierto && lista[activo] ? `${listaId}-${activo}` : undefined} autoComplete="off" spellCheck={false}
        value={editando ? texto : etiqueta} placeholder={editando && etiqueta ? etiqueta : placeholder} disabled={disabled}
        onFocus={() => { setEditando(true); setTexto(''); setAbierto(true); setActivo(0) }}
        onBlur={() => { setAbierto(false); setEditando(false); setTexto('') }}
        onChange={e => { setTexto(e.target.value); setAbierto(true) }}
        onKeyDown={alTeclear}
        style={{ ...INPUT, ...(invalido ? { border: `1px solid ${AMBAR}` } : {}), ...(value && !editando ? { fontWeight: 600, color: INK } : {}) }} />
      {abierto && (
        <ul id={listaId} role="listbox" aria-label={ariaLabel} style={{
          position: 'fixed', zIndex: 1000, margin: 0, padding: 4, listStyle: 'none', background: '#fff', border: `1px solid ${BORDE}`,
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', overflowY: 'auto', ...(pos ?? { top: 0, left: 0, width: 380, maxHeight: 300 }),
        }}>
          {lista.length === 0 && <li role="presentation" style={{ padding: '8px 10px', fontSize: 12, color: SLATE }}>Sin coincidencias. Prueba con el código o con otra palabra.</li>}
          {lista.map((it, i) => {
            const cabecera = it.seccion && it.seccion !== ultima ? it.seccion : null
            if (it.seccion) ultima = it.seccion
            return (
              <li key={`${it.seccion ?? ''}|${it.opcion.id}|${i}`} role="presentation">
                {cabecera && <div style={{ fontSize: 10, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.5, padding: '6px 8px 2px' }}>{cabecera}</div>}
                <div id={`${listaId}-${i}`} role="option" aria-selected={i === activo}
                  onMouseDown={e => { e.preventDefault(); elegir(it.opcion.id) }} onMouseEnter={() => setActivo(i)}
                  style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: INK, background: i === activo ? '#EEF2FF' : 'transparent' }}>
                  {it.vacio ? <span style={{ color: SLATE }}>{vaciable}</span> : renderOpcion(it)}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/* ─────────────── subcuentas ─────────────── */
// sugeridas: [{ id, nota }] · uso: Map subId → { total, CARGO, ABONO } · indice: Map subId → [{ palabra, veces }]
export function BuscadorSubcuenta({ plan, value, onChange, onElegido, tipoMov, sugeridas = [], uso, indice, disabled, autoFocus, inputRef, vaciable, invalido,
  ariaLabel = 'Subcuenta', placeholder = 'Subcuenta: escribe código o nombre (ej. 710, herram…)' }) {
  const opciones = useMemo(() => plan.grupos.flatMap(({ m, subs }) => subs.map(s => ({
    id: s.id, codigo: String(s.codigo ?? ''), nombre: s.nombre, madreCodigo: String(m.codigo ?? ''), madreNombre: m.nombre, madreTipo: m.tipo,
    exigeCeco: m.requiere_ceco !== false, nNombre: normalizar(s.nombre), nMadre: normalizar(m.nombre),
  }))), [plan])
  const porId = useMemo(() => new Map(opciones.map(o => [o.id, o])), [opciones])
  const contrario = o => (tipoMov === 'CARGO' && o.madreTipo === 'ingreso') || (tipoMov === 'ABONO' && o.madreTipo === 'gasto')
  const usoDe = id => { const u = uso?.get(id); return u ? (tipoMov ? (u[tipoMov] ?? 0) : u.total) : 0 }

  function filtrar(texto) {
    const nq = normalizar(texto).trim()
    const toks = nq.split(/\s+/).filter(Boolean)
    const qc = nq.replace(',', '.')
    const out = []
    for (const o of opciones) {
      let base = 0, pista = null
      if (/^\d/.test(qc)) {                                     // por código
        if (o.codigo === qc) base = 1000
        else if (o.codigo.startsWith(qc)) base = 900 - (o.codigo.length - qc.length)
        else if (o.madreCodigo.startsWith(qc)) base = 700
      }
      if (!base) {                                              // por palabras: todas deben aparecer
        let suma = 0
        for (const t of toks) {
          let s = 0
          if (alInicioDePalabra(o.nNombre, t)) s = 30
          else if (o.nNombre.includes(t)) s = 15
          else if (o.codigo.includes(t)) s = 20
          else if (o.nMadre.includes(t)) s = 8
          if (!s && indice && t.length >= 3) {                  // por lo que se ha clasificado ahí
            const kw = (indice.get(o.id) ?? []).find(k => k.palabra.startsWith(t))
            if (kw) { s = 10 + Math.min(10, kw.veces); pista = pista ?? kw }
          }
          if (!s) { suma = 0; break }
          suma += s
        }
        base = suma
      }
      if (base > 0) {
        const score = base - (contrario(o) ? 40 : 0) + Math.min(5, Math.log2(1 + usoDe(o.id)))
        out.push({ opcion: o, score, nota: pista ? `usada para ${pista.palabra.toUpperCase()} (${pista.veces})` : null })
      }
    }
    return out.sort((a, b) => b.score - a.score || a.opcion.codigo.localeCompare(b.opcion.codigo)).slice(0, 40)
  }
  function secciones() {
    const vistos = new Set(), out = []
    const agregar = (id, seccion, nota) => { const o = porId.get(id); if (!o || vistos.has(id)) return; vistos.add(id); out.push({ opcion: o, seccion, nota }) }
    for (const s of sugeridas) agregar(s.id, 'Sugeridas', s.nota)
    for (const id of leerRecientes('sub')) agregar(id, 'Recientes', null)
    if (uso) opciones.map(o => [o, usoDe(o.id)]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .forEach(([o, n]) => agregar(o.id, 'Más usadas', `${n} ${n === 1 ? 'vez' : 'veces'}`))
    if (!out.length) opciones.forEach(o => agregar(o.id, `${o.madreCodigo} · ${o.madreNombre}`, null))
    return out
  }
  const etiquetaDe = id => { const o = porId.get(id); return o ? `${o.codigo} · ${o.nombre}` : (plan.nombreSub?.(id) || 'Subcuenta inactiva') }
  const renderOpcion = ({ opcion: o, nota }) => (<>
    <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 48 }}>{o.codigo || 's/c'}</span>
    <span style={{ flex: 1, minWidth: 0 }}>
      {o.nombre}<span style={{ color: SLATE }}> · {o.madreCodigo} {o.madreNombre}</span>
      {nota && <span style={{ color: AZUL }}> · {nota}</span>}
      {contrario(o) && <span style={{ color: AMBAR }}> · contrario al signo</span>}
      {!o.exigeCeco && <span style={{ color: SLATE }}> · sin centro de costo</span>}
    </span>
  </>)
  return <Combobox tipo="sub" value={value} onChange={onChange} onElegido={onElegido} filtrar={filtrar} secciones={secciones} etiquetaDe={etiquetaDe}
    renderOpcion={renderOpcion} placeholder={placeholder} disabled={disabled} autoFocus={autoFocus} inputRef={inputRef} vaciable={vaciable} invalido={invalido} ariaLabel={ariaLabel} />
}

/* ─────────────── centros de costo ─────────────── */
const AREA_TXT = { ADM: 'administracion', COM: 'comercial ventas', OPS: 'operaciones bodega logistica', NEG: 'negocios direccion gerencia' }
const ALIAS_SEDE = { 'suc-lg': 'lg granja', 'suc-la': 'la angeles', 'suc-maipu': 'tienda maipu', 'suc-mp': 'cd mp centro distribucion', ADM: 'casa matriz central' }

export function BuscadorCeco({ plan, value, onChange, onElegido, sugeridas = [], disabled, autoFocus, inputRef, vaciable, invalido,
  ariaLabel = 'Centro de costo', placeholder = 'Centro de costo: área o sede (ej. ops granja, 10204)' }) {
  const opciones = useMemo(() => plan.gruposCeco.flatMap(({ sede, lista }) => lista.map(c => ({
    id: c.id, codigo: String(c.codigo ?? ''), nombre: c.nombre, sede,
    hay: normalizar(`${c.codigo} ${c.nombre} ${sede} ${AREA_TXT[c.area] ?? ''} ${ALIAS_SEDE[c.ceco_id] ?? ''}`),
  }))), [plan])
  const porId = useMemo(() => new Map(opciones.map(o => [o.id, o])), [opciones])
  function filtrar(texto) {
    const nq = normalizar(texto).trim(), toks = nq.split(/\s+/).filter(Boolean), out = []
    for (const o of opciones) {
      let score = 0
      if (/^\d/.test(nq) && o.codigo.startsWith(nq)) score = 100 - (o.codigo.length - nq.length)
      else {
        for (const t of toks) {
          const s = alInicioDePalabra(o.hay, t) ? 10 : o.hay.includes(t) ? 5 : 0
          if (!s) { score = 0; break }
          score += s
        }
      }
      if (score > 0) out.push({ opcion: o, score })
    }
    return out.sort((a, b) => b.score - a.score || a.opcion.codigo.localeCompare(b.opcion.codigo))
  }
  function secciones() {
    const vistos = new Set(), out = []
    const agregar = (id, seccion, nota) => { const o = porId.get(id); if (!o || vistos.has(id)) return; vistos.add(id); out.push({ opcion: o, seccion, nota }) }
    for (const s of sugeridas) agregar(s.id, 'Sugeridos', s.nota)
    for (const id of leerRecientes('ceco')) agregar(id, 'Recientes', null)
    opciones.forEach(o => agregar(o.id, o.sede, null))
    return out
  }
  const etiquetaDe = id => { const o = porId.get(id); return o ? `${o.codigo} · ${o.nombre}` : (plan.nombreCeco?.(id) || 'Centro de costo inactivo') }
  const renderOpcion = ({ opcion: o, nota }) => (<>
    <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 48 }}>{o.codigo}</span>
    <span style={{ flex: 1, minWidth: 0 }}>{o.nombre}<span style={{ color: SLATE }}> · {o.sede}</span>{nota && <span style={{ color: AZUL }}> · {nota}</span>}</span>
  </>)
  return <Combobox tipo="ceco" value={value} onChange={onChange} onElegido={onElegido} filtrar={filtrar} secciones={secciones} etiquetaDe={etiquetaDe}
    renderOpcion={renderOpcion} placeholder={placeholder} disabled={disabled} autoFocus={autoFocus} inputRef={inputRef} vaciable={vaciable} invalido={invalido} ariaLabel={ariaLabel} />
}
