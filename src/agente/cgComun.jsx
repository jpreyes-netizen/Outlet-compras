import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'
import { fmt, fN } from '../lib/constants'

/* ═══════════════════════════════════════════════════════════════════════
   Control de Gestión · piezas compartidas (Scorecard + Indicadores)
   Datos: v_cg_dimension, v_cg_ultima, cg_mediciones, cg_indicadores,
   cg_dimensiones. Todo protegido por RLS: solo el titular ve filas.
   Medición: rpc fn_cg_medir(p_codigo) — un indicador por llamada.
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

export const EJE = { resultado: 'Resultado', control: 'Control', dato: 'Dato' }
export const FRANJA = { diaria: 'Diaria, 12:30', nocturna: 'Nocturna, 03:30' }

// Trama para "no evaluable": el resultado existe, pero descansa sobre datos en rojo
export const TRAMA = 'repeating-linear-gradient(135deg, #F8FAFC 0 7px, #E2E8F0 7px 8px)'

const nf = d => new Intl.NumberFormat('es-CL', { maximumFractionDigits: d })

/* Valor con su unidad. largo=true muestra pesos completos. */
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

/* ═══ Carga única de datos (la usan ambas pestañas) ═══ */
export function useCgDatos(activo) {
  const [d, setD] = useState({ dims: [], ult: [], hist: {}, cat: {}, dimNom: {} })
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  const recargar = useCallback(async () => {
    if (!activo) return
    setCargando(true)
    setError('')
    try {
      const desde = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)
      const [rd, ru, rh, rc, rn] = await Promise.all([
        supabase.from('v_cg_dimension').select('*').order('dimension_orden'),
        supabase.from('v_cg_ultima').select('*'),
        supabase.from('cg_mediciones').select('indicador,fecha_medicion,valor,meta,semaforo')
          .eq('ambito', 'total').gte('fecha_medicion', desde).order('fecha_medicion').limit(5000),
        supabase.from('cg_indicadores').select('*'),
        supabase.from('cg_dimensiones').select('*').order('orden'),
      ])
      const err = [rd, ru, rh, rc, rn].find(x => x.error)?.error
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
      setD({ dims: rd.data || [], ult, hist, cat, dimNom })
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setCargando(false)
    }
  }, [activo])

  useEffect(() => { recargar() }, [recargar])
  return { ...d, cargando, error, recargar }
}

export async function medirIndicador(codigo) {
  const { data, error } = await supabase.rpc('fn_cg_medir', { p_codigo: codigo })
  if (error) throw error
  return Array.isArray(data) ? data[0] : data
}

/* ═══ Piezas visuales ═══ */
export function Chip({ s }) {
  const x = SEM[s] || SEM.sin_dato
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '1px 7px', borderRadius: 4,
      background: x.bg, color: x.c, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', lineHeight: '18px'
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: x.c, flexShrink: 0 }} />{x.l}
    </span>
  )
}

export function Sparkline({ pts = [], meta, w = 84, h = 22 }) {
  const vals = pts.map(p => Number(p.valor)).filter(Number.isFinite)
  if (vals.length < 2) return <span style={{ fontSize: 10.5, color: '#9CA3AF' }}>{vals.length ? '1 medición' : '—'}</span>
  const m = (meta !== null && meta !== undefined && Number.isFinite(Number(meta))) ? Number(meta) : null
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
  const datos = pts.filter(p => p.valor !== null && p.valor !== undefined && Number.isFinite(Number(p.valor)))
  if (!datos.length) return <div style={{ fontSize: 12, color: '#9CA3AF', padding: '8px 0' }}>Sin mediciones todavía.</div>
  const W = 360, H = 120, P = { l: 6, r: 6, t: 10, b: 18 }
  const vals = datos.map(p => Number(p.valor))
  const metas = datos.map(p => (p.meta === null || p.meta === undefined) ? null : Number(p.meta)).filter(v => v !== null && Number.isFinite(v))
  const all = [...vals, ...metas]
  const min = Math.min(...all), max = Math.max(...all), rng = (max - min) || 1
  const x = i => datos.length === 1 ? W / 2 : P.l + (i / (datos.length - 1)) * (W - P.l - P.r)
  const y = v => P.t + (1 - (v - min) / rng) * (H - P.t - P.b)
  const linea = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const lineaMeta = datos
    .map((p, i) => (p.meta === null || p.meta === undefined || !Number.isFinite(Number(p.meta))) ? null : `${x(i).toFixed(1)},${y(Number(p.meta)).toFixed(1)}`)
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

/* ═══ Panel lateral: lectura, historia, edición de meta y re-medición ═══ */
const lbl = { fontSize: 11, color: '#6B7280', fontWeight: 600, marginBottom: 3, display: 'block' }
const inp = { width: '100%', padding: '6px 8px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', background: '#fff' }
const btnP = { padding: '7px 12px', borderRadius: 6, border: 'none', background: '#1C1C1E', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }
const btnS = { padding: '7px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', color: '#1C1C1E', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }

const aTexto = v => (v === null || v === undefined) ? '' : String(v).replace('.', ',')
// Acepta formato chileno (1.234.567,5) y punto decimal (1.5). Un solo punto
// seguido de exactamente 3 dígitos se lee como miles (1.234 → 1234).
const aNumero = s => {
  const t = String(s ?? '').trim().replace(/\s/g, '')
  if (t === '') return null
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'))
  if ((t.match(/\./g) || []).length > 1 || /^-?\d{1,3}\.\d{3}$/.test(t)) return Number(t.replace(/\./g, ''))
  return Number(t)
}

export function PanelIndicador({ ind, u, hist = [], dimNom = {}, onCerrar, onCambio, isMobile }) {
  const [f, setF] = useState({})
  const [ocupado, setOcupado] = useState('')
  const [msg, setMsg] = useState(null)   // {tipo:'ok'|'error', txt}

  useEffect(() => {
    if (!ind) return
    setF({
      meta: aTexto(ind.meta), umbral_rojo: aTexto(ind.umbral_rojo), tolerancia_pct: aTexto(ind.tolerancia_pct),
      pantalla: ind.pantalla || '', nota: ind.nota || '', activo: ind.activo !== false
    })
    setMsg(null)
  }, [ind?.codigo, ind?.actualizado_at])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!ind) return null
  const diaria = ind.franja === 'diaria'
  const metaDinamica = (ind.meta === null || ind.meta === undefined) && ind.tolerancia_pct !== null && ind.tolerancia_pct !== undefined
  const ultimas = hist.slice(-10).reverse()

  const remedir = async () => {
    setOcupado('medir'); setMsg(null)
    try {
      const r = await medirIndicador(ind.codigo)
      if (r?.err) setMsg({ tipo: 'error', txt: 'La medición falló: ' + r.err })
      else setMsg({ tipo: 'ok', txt: 'Medido de nuevo: ' + fmtValor(r?.val, ind.unidad, true) + ' (' + (SEM[r?.sem]?.l || r?.sem || '—') + ')' })
      await onCambio?.()
    } catch (e) {
      setMsg({ tipo: 'error', txt: 'No se pudo medir: ' + String(e?.message || e) })
    } finally { setOcupado('') }
  }

  const guardar = async () => {
    const meta = aNumero(f.meta), umbral = aNumero(f.umbral_rojo), tol = aNumero(f.tolerancia_pct)
    for (const [k, v] of [['Meta', meta], ['Umbral rojo', umbral], ['Tolerancia', tol]]) {
      if (v !== null && !Number.isFinite(v)) { setMsg({ tipo: 'error', txt: `${k}: escribe un número (usa coma para decimales).` }); return }
    }
    if (meta !== null && umbral !== null) {
      if (ind.sentido === 'mayor' && umbral > meta) { setMsg({ tipo: 'error', txt: 'Como mayor es mejor, el umbral rojo debe ser menor o igual a la meta.' }); return }
      if (ind.sentido === 'menor' && umbral < meta) { setMsg({ tipo: 'error', txt: 'Como menor es mejor, el umbral rojo debe ser mayor o igual a la meta.' }); return }
    }
    setOcupado('guardar'); setMsg(null)
    try {
      const { error } = await supabase.from('cg_indicadores').update({
        meta, umbral_rojo: umbral, tolerancia_pct: tol,
        pantalla: f.pantalla.trim() || null, nota: f.nota.trim() || null,
        activo: !!f.activo, actualizado_at: new Date().toISOString()
      }).eq('codigo', ind.codigo)
      if (error) throw error
      if (diaria && f.activo) {
        const r = await medirIndicador(ind.codigo)
        setMsg(r?.err
          ? { tipo: 'error', txt: 'Guardado, pero la medición falló: ' + r.err }
          : { tipo: 'ok', txt: 'Guardado y medido de nuevo: ' + (SEM[r?.sem]?.l || r?.sem || '—') })
      } else {
        setMsg({ tipo: 'ok', txt: diaria ? 'Guardado.' : 'Guardado. El semáforo se actualiza en la medición de las 03:30.' })
      }
      await onCambio?.()
    } catch (e) {
      setMsg({ tipo: 'error', txt: 'No se pudo guardar: ' + String(e?.message || e) })
    } finally { setOcupado('') }
  }

  const contenedor = isMobile
    ? { position: 'fixed', inset: 0, zIndex: 200, background: '#fff', overflowY: 'auto', padding: '12px 14px calc(16px + env(safe-area-inset-bottom))' }
    : { background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 14, position: 'sticky', top: 92, maxHeight: 'calc(100vh - 110px)', overflowY: 'auto' }

  return (
    <aside style={contenedor} aria-label={`Indicador ${ind.codigo}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11.5, color: '#6B7280' }}>
            {ind.codigo}, {EJE[ind.eje] || ind.eje}, {dimNom[ind.dimension] || ind.dimension}
          </div>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: '#1C1C1E', lineHeight: 1.3, marginTop: 2 }}>{ind.nombre}</div>
        </div>
        <button onClick={onCerrar} aria-label="Cerrar panel" style={{ ...btnS, padding: '2px 9px', fontSize: 16, lineHeight: '20px' }}>×</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 24, fontWeight: 700, color: '#1C1C1E', fontVariantNumeric: 'tabular-nums' }}>
          {fmtValor(u?.valor, ind.unidad, true)}
        </span>
        <Chip s={u?.semaforo} />
      </div>
      <div style={{ fontSize: 12, color: '#374151', marginTop: 4, lineHeight: 1.5 }}>
        Meta {fmtMeta(u?.meta ?? ind.meta, ind.sentido, ind.unidad) || 'por definir'}
        {metaDinamica && ' (dinámica)'}
        {u?.umbral_rojo !== null && u?.umbral_rojo !== undefined && <>; rojo desde {fmtValor(u.umbral_rojo, ind.unidad)}</>}
        <br />
        <span style={{ color: '#6B7280' }}>Medido {horaCL(u?.medido_at)}{u?.duracion_ms ? ` en ${fN(u.duracion_ms)} ms` : ''}</span>
      </div>
      {u?.error && <div style={{ marginTop: 8, fontSize: 12, color: SEM.error.c, background: SEM.error.bg, padding: '6px 8px', borderRadius: 6 }}>Error de medición: {u.error}</div>}
      {u?.detalle && <div style={{ marginTop: 8, fontSize: 12.5, color: '#1F2937', lineHeight: 1.5 }}>{u.detalle}</div>}

      <div style={{ marginTop: 14 }}>
        <span style={lbl}>Historia, últimos 60 días</span>
        <Historia pts={hist} unidad={ind.unidad} />
        {ultimas.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 6 }}>
            <tbody>
              {ultimas.map(m => (
                <tr key={m.fecha_medicion} style={{ borderTop: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '4px 0', color: '#6B7280' }}>{fechaLarga(m.fecha_medicion)}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtValor(m.valor, ind.unidad)}</td>
                  <td style={{ padding: '4px 0', textAlign: 'right' }}><Chip s={m.semaforo} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ marginTop: 14, fontSize: 12, color: '#374151', lineHeight: 1.6 }}>
        <div><b>Fuente:</b> {ind.fuente}</div>
        <div><b>Pantalla:</b> {ind.pantalla || <span style={{ color: '#9CA3AF' }}>sin registrar</span>}</div>
        <div><b>Medición:</b> {FRANJA[ind.franja] || ind.franja}</div>
      </div>

      {diaria && (
        <div style={{ marginTop: 10 }}>
          <button onClick={remedir} disabled={!!ocupado} style={{ ...btnS, opacity: ocupado ? 0.6 : 1 }}>
            {ocupado === 'medir' ? 'Midiendo…' : 'Medir ahora'}
          </button>
        </div>
      )}

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #E5E7EB' }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#1C1C1E', marginBottom: 8 }}>
          Meta y umbrales <span style={{ fontWeight: 400, color: '#6B7280' }}>({ind.sentido === 'mayor' ? 'mayor es mejor' : 'menor es mejor'})</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <label><span style={lbl}>Meta</span>
            <input style={inp} inputMode="decimal" value={f.meta ?? ''} placeholder="por definir" onChange={e => setF(p => ({ ...p, meta: e.target.value }))} /></label>
          <label><span style={lbl}>Umbral rojo</span>
            <input style={inp} inputMode="decimal" value={f.umbral_rojo ?? ''} placeholder="= meta" onChange={e => setF(p => ({ ...p, umbral_rojo: e.target.value }))} /></label>
          <label><span style={lbl}>Tolerancia %</span>
            <input style={inp} inputMode="decimal" value={f.tolerancia_pct ?? ''} placeholder="—" onChange={e => setF(p => ({ ...p, tolerancia_pct: e.target.value }))} /></label>
        </div>
        <div style={{ fontSize: 11, color: '#6B7280', marginTop: 5, lineHeight: 1.45 }}>
          Entre la meta y el umbral rojo el semáforo queda amarillo. La tolerancia arma ese tramo como % de la meta cuando no hay umbral fijo.
          Meta vacía: se mide igual, sin semáforo.
        </div>
        <label style={{ display: 'block', marginTop: 10 }}><span style={lbl}>Pantalla donde se cuadra</span>
          <input style={inp} value={f.pantalla ?? ''} placeholder="App › pestaña" onChange={e => setF(p => ({ ...p, pantalla: e.target.value }))} /></label>
        <label style={{ display: 'block', marginTop: 10 }}><span style={lbl}>Nota</span>
          <textarea style={{ ...inp, resize: 'vertical', minHeight: 54 }} value={f.nota ?? ''} onChange={e => setF(p => ({ ...p, nota: e.target.value }))} /></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12.5 }}>
          <input type="checkbox" checked={!!f.activo} onChange={e => setF(p => ({ ...p, activo: e.target.checked }))} /> Indicador activo
        </label>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button onClick={guardar} disabled={!!ocupado} style={{ ...btnP, opacity: ocupado ? 0.6 : 1 }}>
            {ocupado === 'guardar' ? 'Guardando…' : (diaria ? 'Guardar y medir' : 'Guardar')}
          </button>
        </div>
        {msg && (
          <div role="status" style={{
            marginTop: 10, fontSize: 12, padding: '6px 8px', borderRadius: 6,
            color: msg.tipo === 'ok' ? SEM.verde.c : SEM.rojo.c, background: msg.tipo === 'ok' ? SEM.verde.bg : SEM.rojo.bg
          }}>{msg.txt}</div>
        )}
      </div>

      {ind.sql_medicion && (
        <details style={{ marginTop: 14 }}>
          <summary style={{ fontSize: 12, color: '#374151', cursor: 'pointer', fontWeight: 600 }}>Cómo se mide (SQL)</summary>
          <pre style={{ fontSize: 10.5, background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 6, padding: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 6, color: '#334155' }}>{ind.sql_medicion}</pre>
        </details>
      )}
    </aside>
  )
}
