import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'
import { fmt, fN } from '../lib/constants'

/* ═══════════════════════════════════════════════════════════════════════
   Control de Gestión · piezas compartidas
   Datos (todo con RLS: solo el titular ve filas):
     v_cg_dimension · v_cg_ultima · v_cg_prioridades · v_cg_acciones
     cg_mediciones (60 días) · cg_indicadores · cg_dimensiones · usuarios
   Escritura:
     rpc fn_cg_medir(p_codigo)          → re-mide un indicador
     rpc fn_cg_crear_accion(...)        → tarea PMO (origen 'control_gestion') + foto del indicador
     update cg_indicadores (meta, umbrales, dueño, textos) · update pmo_tareas (estado, fecha)
   ═══════════════════════════════════════════════════════════════════════ */

export const SEM = {
  verde:    { l: 'Verde',    c: '#1E9E4A', bg: '#E7F6EC' },
  amarillo: { l: 'Amarillo', c: '#B26B00', bg: '#FFF3DC' },
  rojo:     { l: 'Rojo',     c: '#D92D20', bg: '#FDECEA' },
  sin_meta: { l: 'Sin meta', c: '#6B7280', bg: '#F3F4F6' },
  sin_dato: { l: 'Sin dato', c: '#6B7280', bg: '#F3F4F6' },
  error:    { l: 'Error',    c: '#7C3AED', bg: '#F1EBFE' },
}

export const ESTADO_DIM = {
  verde:        { l: 'Verde',        c: '#1E9E4A' },
  amarillo:     { l: 'Amarillo',     c: '#B26B00' },
  rojo:         { l: 'Rojo',         c: '#D92D20' },
  no_evaluable: { l: 'No evaluable', c: '#475569' },
  sin_dato:     { l: 'Sin dato',     c: '#6B7280' },
}

export const SITUACION = {
  vencida:             { l: 'Vencida',             c: '#D92D20', bg: '#FDECEA' },
  en_curso:            { l: 'En curso',            c: '#1D4ED8', bg: '#E8EEFD' },
  lista_para_cerrar:   { l: 'Lista para cerrar',   c: '#1E9E4A', bg: '#E7F6EC' },
  cumplida_con_efecto: { l: 'Cumplida con efecto', c: '#1E9E4A', bg: '#E7F6EC' },
  cumplida_mejoro:     { l: 'Cumplida, mejoró',    c: '#B26B00', bg: '#FFF3DC' },
  cumplida_sin_efecto: { l: 'Cumplida sin efecto', c: '#7C3AED', bg: '#F1EBFE' },
}

export const ESTADO_TAREA = { pendiente: 'Pendiente', en_curso: 'En curso', en_revision: 'En revisión', bloqueada: 'Bloqueada', completada: 'Completada' }
export const EJE = { resultado: 'Resultado', control: 'Control', dato: 'Dato' }
export const FRANJA = { diaria: 'Diaria, 12:30', nocturna: 'Nocturna, 03:30' }
export const PESO = { 1: 'Baja', 2: 'Media', 3: 'Alta' }
export const APP_NOMBRE = {
  comercial: 'Comercial', inventario: 'Análisis de Stock', compras: 'Abastecimiento', finanzas: 'Finanzas',
  logistica: 'Logística', rrhh: 'Personas', postventa: 'Postventa', procesos: 'Procesos', proyectos: 'Proyectos'
}

// Trama para "no evaluable": el resultado existe, pero descansa sobre datos en rojo
export const TRAMA = 'repeating-linear-gradient(135deg, #F8FAFC 0 7px, #E2E8F0 7px 8px)'

export const btnP = { padding: '6px 12px', borderRadius: 6, border: 'none', background: '#1C1C1E', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
export const btnS = { padding: '6px 11px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', color: '#1C1C1E', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
export const panelCaja = { background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8 }

const nf = d => new Intl.NumberFormat('es-CL', { maximumFractionDigits: d })

export function fmtValor(v, u, largo = false) {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  switch (u) {
    case '$': return (largo || Math.abs(n) < 1e6) ? fmt(n) : (n < 0 ? '-$' : '$') + nf(1).format(Math.abs(n) / 1e6) + 'M'
    case '%': return nf(1).format(n) + '%'
    case 'min': return nf(1).format(n) + ' min'
    case 'días': return fN(n) + (Math.round(n) === 1 ? ' día' : ' días')
    case 'ratio': return nf(2).format(n)
    default: return fN(n)
  }
}

export const fmtMeta = (meta, sentido, u) =>
  (meta === null || meta === undefined) ? null : (sentido === 'mayor' ? '≥ ' : '≤ ') + fmtValor(meta, u)

export const fechaCorta = d => d ? `${String(d).slice(8, 10)}-${String(d).slice(5, 7)}` : '—'
export const fechaLarga = d => d ? `${String(d).slice(8, 10)}-${String(d).slice(5, 7)}-${String(d).slice(0, 4)}` : '—'
export const horaCL = ts => ts
  ? new Date(ts).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—'
export const hoyCL = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })
export const sumarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5)
const esNulo = v => v === null || v === undefined
const rangoSem = s => ({ verde: 3, amarillo: 2, rojo: 1 }[s] || 0)

/* Nivel de urgencia legible a partir del puntaje 0-100 de v_cg_prioridades */
export const nivel = p => p >= 40 ? { l: 'Urgente', c: '#D92D20' } : p >= 20 ? { l: 'Alta', c: '#B26B00' } : { l: 'Media', c: '#6B7280' }

/* ═══ Carga única de datos (la usan todas las pestañas) ═══ */
export function useCgDatos(activo) {
  const vacio = { dims: [], ult: [], hist: {}, cat: {}, dimNom: {}, prioridades: [], acciones: [], usuarios: [], usuNom: {} }
  const [d, setD] = useState(vacio)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  const recargar = useCallback(async () => {
    if (!activo) return
    setCargando(true)
    setError('')
    try {
      const desde = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)
      const [rd, ru, rh, rc, rn, rp, ra, rus] = await Promise.all([
        supabase.from('v_cg_dimension').select('*').order('dimension_orden'),
        supabase.from('v_cg_ultima').select('*'),
        supabase.from('cg_mediciones').select('indicador,fecha_medicion,valor,meta,semaforo')
          .eq('ambito', 'total').gte('fecha_medicion', desde).order('fecha_medicion').limit(6000),
        supabase.from('cg_indicadores').select('*'),
        supabase.from('cg_dimensiones').select('*').order('orden'),
        supabase.from('v_cg_prioridades').select('*'),
        supabase.from('v_cg_acciones').select('*').order('fecha_vencimiento'),
        supabase.from('usuarios').select('id,nombre,rol,activo').eq('activo', true).order('nombre'),
      ])
      const err = [rd, ru, rh, rc, rn, rp, ra, rus].find(x => x.error)?.error
      if (err) throw err
      const hist = {}
      for (const m of rh.data || []) {
        if (!hist[m.indicador]) hist[m.indicador] = []
        hist[m.indicador].push(m)
      }
      const cat = Object.fromEntries((rc.data || []).map(i => [i.codigo, i]))
      const dimNom = Object.fromEntries((rn.data || []).map(x => [x.codigo, x.nombre]))
      const ult = (ru.data || []).slice().sort((a, b) =>
        (a.dimension_orden - b.dimension_orden) || (a.orden - b.orden) || String(a.codigo).localeCompare(String(b.codigo)))
      // Desempate: a igual puntaje, primero lo que está más lejos de su meta
      const rel = p => (esNulo(p.valor) || esNulo(p.meta)) ? 0
        : Math.abs(p.valor - p.meta) / Math.max(Math.abs((esNulo(p.umbral_rojo) ? p.meta : p.umbral_rojo) - p.meta), 1)
      const prioridades = (rp.data || []).slice().sort((a, b) => (b.prioridad - a.prioridad) || (rel(b) - rel(a)))
      const usuarios = rus.data || []
      const usuNom = Object.fromEntries(usuarios.map(x => [x.id, x.nombre]))
      setD({ dims: rd.data || [], ult, hist, cat, dimNom, prioridades, acciones: ra.data || [], usuarios, usuNom })
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setCargando(false)
    }
  }, [activo])

  useEffect(() => { recargar() }, [recargar])
  return { ...d, cargando, error, recargar }
}

// conAnalisis=true también recalcula el desglose y diagnóstico (más lento; los pesados pueden pasar el límite de 8 s)
export async function medirIndicador(codigo, conAnalisis = false) {
  const { data, error } = await supabase.rpc('fn_cg_medir', { p_codigo: codigo, p_desglose: conAnalisis })
  if (error) throw error
  return Array.isArray(data) ? data[0] : data
}

/* ═══ Piezas visuales ═══ */
function Pastilla({ x, txt }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '1px 7px', borderRadius: 4,
      background: x.bg, color: x.c, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', lineHeight: '18px'
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: x.c, flexShrink: 0 }} />{txt ?? x.l}
    </span>
  )
}
export const Chip = ({ s }) => <Pastilla x={SEM[s] || SEM.sin_dato} />
export const ChipSit = ({ s }) => <Pastilla x={SITUACION[s] || { l: s || '—', c: '#6B7280', bg: '#F3F4F6' }} />

export function Etiqueta({ children, c = '#374151', bg = '#F3F4F6' }) {
  return <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 4, background: bg, color: c, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{children}</span>
}

export function Sparkline({ pts = [], meta, w = 84, h = 22 }) {
  const vals = pts.map(p => Number(p.valor)).filter(Number.isFinite)
  if (vals.length < 2) return <span style={{ fontSize: 10.5, color: '#9CA3AF' }}>{vals.length ? '1 medición' : '—'}</span>
  const m = (!esNulo(meta) && Number.isFinite(Number(meta))) ? Number(meta) : null
  const all = m === null ? vals : [...vals, m]
  const min = Math.min(...all), max = Math.max(...all), rng = (max - min) || 1
  const x = i => (i / (vals.length - 1)) * (w - 4) + 2
  const y = v => h - 2 - ((v - min) / rng) * (h - 4)
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const ultSem = SEM[pts[pts.length - 1]?.semaforo] || SEM.sin_dato
  return (
    <svg width={w} height={h} style={{ display: 'block' }} aria-hidden="true">
      {m !== null && <line x1={2} x2={w - 2} y1={y(m)} y2={y(m)} stroke="#9CA3AF" strokeDasharray="2 2" strokeWidth={1} />}
      <path d={d} fill="none" stroke="#475569" strokeWidth={1.4} />
      <circle cx={x(vals.length - 1)} cy={y(vals[vals.length - 1])} r={2.4} fill={ultSem.c} />
    </svg>
  )
}

export function Historia({ pts = [], unidad }) {
  const datos = pts.filter(p => !esNulo(p.valor) && Number.isFinite(Number(p.valor)))
  if (!datos.length) return <div style={{ fontSize: 12, color: '#9CA3AF', padding: '8px 0' }}>Sin mediciones todavía.</div>
  const W = 360, H = 120, P = { l: 6, r: 6, t: 10, b: 18 }
  const vals = datos.map(p => Number(p.valor))
  const metas = datos.map(p => esNulo(p.meta) ? null : Number(p.meta)).filter(v => v !== null && Number.isFinite(v))
  const all = [...vals, ...metas]
  const min = Math.min(...all), max = Math.max(...all), rng = (max - min) || 1
  const x = i => datos.length === 1 ? W / 2 : P.l + (i / (datos.length - 1)) * (W - P.l - P.r)
  const y = v => P.t + (1 - (v - min) / rng) * (H - P.t - P.b)
  const linea = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const lineaMeta = datos
    .map((p, i) => (esNulo(p.meta) || !Number.isFinite(Number(p.meta))) ? null : `${x(i).toFixed(1)},${y(Number(p.meta)).toFixed(1)}`)
    .filter(Boolean)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Historia del indicador">
      <line x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} stroke="#E5E7EB" />
      {lineaMeta.length > 1 && <polyline points={lineaMeta.join(' ')} fill="none" stroke="#9CA3AF" strokeDasharray="4 3" />}
      {datos.length > 1 && <path d={linea} fill="none" stroke="#334155" strokeWidth={1.6} />}
      {datos.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(Number(p.valor))} r={2.8} fill={(SEM[p.semaforo] || SEM.sin_dato).c}>
          <title>{`${fechaLarga(p.fecha_medicion)}: ${fmtValor(p.valor, unidad, true)}`}</title>
        </circle>
      ))}
      <text x={P.l} y={H - 4} fontSize="9" fill="#6B7280">{fechaCorta(datos[0].fecha_medicion)}</text>
      <text x={W - P.r} y={H - 4} fontSize="9" fill="#6B7280" textAnchor="end">{fechaCorta(datos[datos.length - 1].fecha_medicion)}</text>
    </svg>
  )
}

/* Cambios de semáforo en 7 días (mejoraron / empeoraron), desde la historia cargada */
export function cambiosSemana(hist) {
  const mejoraron = [], empeoraron = []
  let conSemana = 0
  for (const [cod, pts] of Object.entries(hist)) {
    if (!pts.length) continue
    const ultimo = pts[pts.length - 1]
    const corte = sumarDias(String(ultimo.fecha_medicion).slice(0, 10), -7)
    const previo = [...pts].reverse().find(p => String(p.fecha_medicion).slice(0, 10) <= corte)
    if (!previo) continue
    conSemana++
    const a = rangoSem(previo.semaforo), b = rangoSem(ultimo.semaforo)
    if (!a || !b || a === b) continue
    ;(b > a ? mejoraron : empeoraron).push({ codigo: cod, de: previo.semaforo, a: ultimo.semaforo })
  }
  return { mejoraron, empeoraron, conSemana }
}

/* ═══ Modal: asignar una acción (crea la tarea en Proyectos) ═══ */
const lbl = { fontSize: 11, color: '#6B7280', fontWeight: 600, marginBottom: 3, display: 'block' }
const inp = { width: '100%', padding: '6px 8px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', background: '#fff' }

export function armarDescripcion(ind, u) {
  return [
    `Indicador ${ind.codigo}: ${ind.nombre}.`,
    `Hoy: ${fmtValor(u?.valor, ind.unidad, true)} (meta ${fmtMeta(u?.meta ?? ind.meta, ind.sentido, ind.unidad) || 'por definir'}).`,
    u?.detalle ? `Detalle: ${u.detalle}` : '',
    ind.por_que ? `Por qué importa: ${ind.por_que}` : '',
    'Se da por cumplida cuando el indicador vuelve a verde.'
  ].filter(Boolean).join('\n')
}

export function AsignarAccion({ ind, u, prioridad, usuarios = [], onCerrar, onCreada }) {
  const urgente = (prioridad ?? 0) >= 40
  const [f, setF] = useState(() => ({
    titulo: (ind.accion_sugerida || `Corregir: ${ind.nombre}`).slice(0, 200),
    resp: ind.responsable_id || '',
    vence: sumarDias(hoyCL(), urgente ? 3 : 7),
    prioridad: urgente ? 'alta' : 'media',
    desc: armarDescripcion(ind, u),
  }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onCerrar?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCerrar])

  const crear = async () => {
    if (!f.titulo.trim() || !f.resp || !f.vence) { setErr('Título, responsable y fecha son obligatorios: sin dueño y plazo no hay seguimiento.'); return }
    if (f.vence < hoyCL()) { setErr('La fecha no puede ser anterior a hoy.'); return }
    setBusy(true); setErr('')
    try {
      const { data, error } = await supabase.rpc('fn_cg_crear_accion', {
        p_codigo: ind.codigo, p_titulo: f.titulo.trim(), p_responsable_id: f.resp, p_vence: f.vence,
        p_descripcion: f.desc.trim() || null, p_prioridad: f.prioridad
      })
      if (error) throw error
      await onCreada?.(data)
    } catch (e) {
      setErr('No se pudo crear la acción: ' + String(e?.message || e))
      setBusy(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Asignar acción" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onCerrar?.() }}
      style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(15,23,42,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ ...panelCaja, width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto', padding: 16, boxShadow: '0 12px 40px rgba(15,23,42,0.25)' }}>
        <div style={{ fontSize: 11.5, color: '#6B7280' }}>Asignar acción sobre {ind.codigo}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1C1C1E', marginTop: 2 }}>{ind.nombre}</div>
        <div style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>
          Hoy {fmtValor(u?.valor, ind.unidad, true)}, meta {fmtMeta(u?.meta ?? ind.meta, ind.sentido, ind.unidad) || 'por definir'}.
        </div>

        <label style={{ display: 'block', marginTop: 12 }}><span style={lbl}>Qué hay que hacer</span>
          <input style={inp} value={f.titulo} maxLength={200} onChange={e => setF(p => ({ ...p, titulo: e.target.value }))} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8, marginTop: 10 }}>
          <label><span style={lbl}>Responsable</span>
            <select style={inp} value={f.resp} onChange={e => setF(p => ({ ...p, resp: e.target.value }))}>
              <option value="">Elegir…</option>
              {usuarios.map(x => <option key={x.id} value={x.id}>{x.nombre}{x.id === ind.responsable_id ? ' (sugerido)' : ''}</option>)}
            </select></label>
          <label><span style={lbl}>Vence</span>
            <input type="date" style={inp} value={f.vence} min={hoyCL()} onChange={e => setF(p => ({ ...p, vence: e.target.value }))} /></label>
          <label><span style={lbl}>Prioridad</span>
            <select style={inp} value={f.prioridad} onChange={e => setF(p => ({ ...p, prioridad: e.target.value }))}>
              <option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option>
            </select></label>
        </div>
        <label style={{ display: 'block', marginTop: 10 }}><span style={lbl}>Contexto para el responsable</span>
          <textarea style={{ ...inp, minHeight: 110, resize: 'vertical' }} value={f.desc} onChange={e => setF(p => ({ ...p, desc: e.target.value }))} /></label>
        <div style={{ fontSize: 11.5, color: '#6B7280', marginTop: 6, lineHeight: 1.45 }}>
          Se crea como tarea en Proyectos: el responsable la recibe por correo, la ve en Mi semana y entra a los recordatorios diarios.
          Aquí vas a ver si movió el indicador.
        </div>
        {err && <div role="alert" style={{ marginTop: 10, fontSize: 12, color: SEM.rojo.c, background: SEM.rojo.bg, padding: '6px 8px', borderRadius: 6 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onCerrar} disabled={busy} style={btnS}>Cancelar</button>
          <button onClick={crear} disabled={busy} style={{ ...btnP, opacity: busy ? 0.6 : 1 }}>{busy ? 'Creando…' : 'Crear acción'}</button>
        </div>
      </div>
    </div>
  )
}

/* ═══ Configuración de un indicador (meta, umbrales, dueño, textos) ═══ */
const aTexto = v => esNulo(v) ? '' : String(v).replace('.', ',')
// Acepta formato chileno (1.234.567,5) y punto decimal (1.5). Un solo punto
// seguido de exactamente 3 dígitos se lee como miles (1.234 → 1234).
const aNumero = s => {
  const t = String(s ?? '').trim().replace(/\s/g, '')
  if (t === '') return null
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'))
  if ((t.match(/\./g) || []).length > 1 || /^-?\d{1,3}\.\d{3}$/.test(t)) return Number(t.replace(/\./g, ''))
  return Number(t)
}

export function ConfigIndicador({ ind, usuarios = [], onGuardado }) {
  const [f, setF] = useState({})
  const [ocupado, setOcupado] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    if (!ind) return
    setF({
      meta: aTexto(ind.meta), umbral_rojo: aTexto(ind.umbral_rojo), tolerancia_pct: aTexto(ind.tolerancia_pct),
      pantalla: ind.pantalla || '', nota: ind.nota || '', activo: ind.activo !== false,
      responsable_id: ind.responsable_id || '', peso: String(ind.peso ?? 2),
      por_que: ind.por_que || '', accion_sugerida: ind.accion_sugerida || ''
    })
    setMsg(null)
  }, [ind?.codigo, ind?.actualizado_at])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!ind) return null
  const diaria = ind.franja === 'diaria'

  const guardar = async () => {
    const meta = aNumero(f.meta), umbral = aNumero(f.umbral_rojo), tol = aNumero(f.tolerancia_pct)
    for (const [k, v] of [['Meta', meta], ['Umbral rojo', umbral], ['Tolerancia', tol]]) {
      if (v !== null && !Number.isFinite(v)) { setMsg({ tipo: 'error', txt: `${k}: escribe un número (usa coma para decimales).` }); return }
    }
    if (meta !== null && umbral !== null) {
      if (ind.sentido === 'mayor' && umbral > meta) { setMsg({ tipo: 'error', txt: 'Como mayor es mejor, el umbral rojo debe ser menor o igual a la meta.' }); return }
      if (ind.sentido === 'menor' && umbral < meta) { setMsg({ tipo: 'error', txt: 'Como menor es mejor, el umbral rojo debe ser mayor o igual a la meta.' }); return }
    }
    setOcupado(true); setMsg(null)
    try {
      const { error } = await supabase.from('cg_indicadores').update({
        meta, umbral_rojo: umbral, tolerancia_pct: tol,
        pantalla: f.pantalla.trim() || null, nota: f.nota.trim() || null, activo: !!f.activo,
        responsable_id: f.responsable_id || null, peso: Number(f.peso) || 2,
        por_que: f.por_que.trim() || null, accion_sugerida: f.accion_sugerida.trim() || null,
        actualizado_at: new Date().toISOString()
      }).eq('codigo', ind.codigo)
      if (error) throw error
      if (diaria && f.activo) {
        const r = await medirIndicador(ind.codigo)
        setMsg(r?.err ? { tipo: 'error', txt: 'Guardado, pero la medición falló: ' + r.err }
          : { tipo: 'ok', txt: 'Guardado y medido de nuevo: ' + (SEM[r?.sem]?.l || r?.sem || '—') })
      } else {
        setMsg({ tipo: 'ok', txt: diaria ? 'Guardado.' : 'Guardado. El semáforo se actualiza en la medición de las 03:30.' })
      }
      await onGuardado?.()
    } catch (e) {
      setMsg({ tipo: 'error', txt: 'No se pudo guardar: ' + String(e?.message || e) })
    } finally { setOcupado(false) }
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: '#4B5563', marginBottom: 8 }}>{ind.sentido === 'mayor' ? 'Mayor es mejor.' : 'Menor es mejor.'} Entre la meta y el umbral rojo el semáforo queda amarillo; meta vacía mide sin semáforo.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        <label><span style={lbl}>Meta</span>
          <input style={inp} inputMode="decimal" value={f.meta ?? ''} placeholder="por definir" onChange={e => setF(p => ({ ...p, meta: e.target.value }))} /></label>
        <label><span style={lbl}>Umbral rojo</span>
          <input style={inp} inputMode="decimal" value={f.umbral_rojo ?? ''} placeholder="= meta" onChange={e => setF(p => ({ ...p, umbral_rojo: e.target.value }))} /></label>
        <label><span style={lbl}>Tolerancia %</span>
          <input style={inp} inputMode="decimal" value={f.tolerancia_pct ?? ''} placeholder="—" onChange={e => setF(p => ({ ...p, tolerancia_pct: e.target.value }))} /></label>
        <label><span style={lbl}>Dueño sugerido</span>
          <select style={inp} value={f.responsable_id ?? ''} onChange={e => setF(p => ({ ...p, responsable_id: e.target.value }))}>
            <option value="">Por asignar</option>
            {usuarios.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
          </select></label>
        <label><span style={lbl}>Importancia</span>
          <select style={inp} value={f.peso ?? '2'} onChange={e => setF(p => ({ ...p, peso: e.target.value }))}>
            <option value="3">Alta</option><option value="2">Media</option><option value="1">Baja</option>
          </select></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8, marginTop: 8 }}>
        <label><span style={lbl}>Por qué importa</span>
          <textarea style={{ ...inp, resize: 'vertical', minHeight: 54 }} value={f.por_que ?? ''} onChange={e => setF(p => ({ ...p, por_que: e.target.value }))} /></label>
        <label><span style={lbl}>Primer paso sugerido</span>
          <textarea style={{ ...inp, resize: 'vertical', minHeight: 54 }} value={f.accion_sugerida ?? ''} onChange={e => setF(p => ({ ...p, accion_sugerida: e.target.value }))} /></label>
        <label><span style={lbl}>Pantalla donde se cuadra</span>
          <input style={inp} value={f.pantalla ?? ''} placeholder="App › pestaña" onChange={e => setF(p => ({ ...p, pantalla: e.target.value }))} /></label>
        <label><span style={lbl}>Nota</span>
          <textarea style={{ ...inp, resize: 'vertical', minHeight: 54 }} value={f.nota ?? ''} onChange={e => setF(p => ({ ...p, nota: e.target.value }))} /></label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
          <input type="checkbox" checked={!!f.activo} onChange={e => setF(p => ({ ...p, activo: e.target.checked }))} /> Indicador activo
        </label>
        <button onClick={guardar} disabled={ocupado} style={{ ...btnP, opacity: ocupado ? 0.6 : 1 }}>
          {ocupado ? 'Guardando…' : (diaria ? 'Guardar y medir' : 'Guardar')}
        </button>
      </div>
      {msg && (
        <div role="status" style={{ marginTop: 10, fontSize: 12, padding: '6px 8px', borderRadius: 6, color: msg.tipo === 'ok' ? SEM.verde.c : SEM.rojo.c, background: msg.tipo === 'ok' ? SEM.verde.bg : SEM.rojo.bg }}>{msg.txt}</div>
      )}
    </div>
  )
}
