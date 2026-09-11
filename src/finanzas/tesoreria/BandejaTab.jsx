import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabase'
import { exportarExcel } from '../exportUtils'

/* ══════════════════════════════════════════════════════════════════════
   BANDEJA — qué revisar hoy, y memoria de lo ya revisado
   Prioriza por score = monto × urgencia de la causa × antigüedad: un caso
   viejo pesa más que uno nuevo del mismo monto, porque la evidencia se
   pierde con el tiempo. Resolver un caso lo saca de la bandeja pero deja
   su motivo, autor y fecha (auditable y reversible).
   Incluye la tendencia: si la cobertura mejora o si solo se acumula.
   RPC: fn_tes_bandeja · fn_tes_resolver
   ══════════════════════════════════════════════════════════════════════ */
const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB'
const fmt = n => '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))
const fS = n => new Intl.NumberFormat('es-CL').format(Number(n || 0))
const TH = { textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: SLATE, padding: '7px 9px', borderBottom: `1px solid ${NAVY}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fff', zIndex: 2 }
const TD = { fontSize: 12.5, padding: '6px 9px', borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }
const NUM = { ...TD, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }
const INPUT = { fontSize: 12, padding: '5px 8px', border: `1px solid ${BORDE}`, borderRadius: 6, background: '#fff' }
const TIPO_C = { plata: ROJO, revision: AMBAR, dato: SLATE }
const TIPO_L = { plata: 'Plata', revision: 'Revisar', dato: 'Dato' }
const MOTIVOS = [
  ['llego_despues', 'El abono entró en otra fecha'],
  ['pago_agrupado', 'El cliente pagó varias boletas juntas'],
  ['deposito_posterior', 'El efectivo se depositó otro día'],
  ['error_registro', 'Error de registro en BSALE o en caja'],
  ['venta_anulada', 'El documento se anuló'],
  ['cobro_externo', 'Entró por otra cuenta o vía'],
  ['justificado_otro', 'Otro motivo (explicar en la nota)'],
]

export function BandejaTab() {
  const [tipo, setTipo] = useState('')
  const [suc, setSuc] = useState('')
  const [sucursales, setSucursales] = useState([])
  const [filas, setFilas] = useState([])
  const [tend, setTend] = useState([])
  const [sel, setSel] = useState(new Set())
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(false)
  const [motivo, setMotivo] = useState('llego_despues')
  const [nota, setNota] = useState('')
  const [msg, setMsg] = useState(null)

  const cargar = useCallback(async () => {
    setCargando(true); setError(null); setSel(new Set())
    const [b, t, f] = await Promise.all([
      supabase.rpc('fn_tes_bandeja', { p_sucursal: suc || null, p_tipo: tipo || null, p_limit: 80 }),
      supabase.from('v_tes_tendencia').select('*'),
      supabase.rpc('fn_tes_filtros', { p_desde: '2026-01-01', p_hasta: new Date().toISOString().slice(0, 10) }),
    ])
    setCargando(false)
    if (b.error) { setError(b.error.message); return }
    setFilas(b.data ?? [])
    if (!t.error) setTend(t.data ?? [])
    if (!f.error && f.data?.sucursales) setSucursales(f.data.sucursales)
  }, [suc, tipo])
  useEffect(() => { cargar() }, [cargar])

  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const todos = () => setSel(s => s.size === filas.length ? new Set() : new Set(filas.map(f => f.bsale_id)))

  const resolver = async () => {
    if (!sel.size) return
    setCargando(true)
    const { data, error: e } = await supabase.rpc('fn_tes_resolver', {
      p_pagos: [...sel], p_fecha: null, p_sucursal: null, p_motivo: motivo, p_nota: nota || null,
    })
    setCargando(false); setModal(false); setNota('')
    if (e) { setError(e.message); return }
    setMsg(`${data?.resueltos ?? sel.size} caso(s) marcados como revisados por ${data?.por ?? 'ti'}.`)
    setTimeout(() => setMsg(null), 5000)
    cargar()
  }

  const totSel = filas.filter(f => sel.has(f.bsale_id)).reduce((s, f) => s + Number(f.monto), 0)
  const porTipo = ['plata', 'revision', 'dato'].map(t => ({
    t, n: filas.filter(f => f.tipo === t).length,
    m: filas.filter(f => f.tipo === t).reduce((s, f) => s + Number(f.monto), 0),
  }))
  const ult = tend[tend.length - 1] ?? {}
  const prev = tend[tend.length - 2] ?? {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* tendencia: ¿mejoramos? */}
      <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '12px 15px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>Cómo viene el año</div>
          <div style={{ fontSize: 11.5, color: SLATE }}>Probado sobre lo recaudado, mes a mes. La franja oscura es lo verificado <b>uno a uno</b>; el resto se probó por el total del día.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 110 }}>
          {tend.map((x, i) => {
            const p = Number(x.pct_probado || 0), u = Number(x.pct_uno_a_uno || 0)
            return (
              <div key={i} title={`${x.periodo}\nProbado: ${p}%\nUno a uno: ${u}%\nPendiente de plata: ${fmt(x.pendiente_plata)}`}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                <div style={{ height: `${p - u}%`, background: '#A7C4A0', minHeight: 1 }} />
                <div style={{ height: `${u}%`, background: VERDE }} />
                <div style={{ fontSize: 9, color: SLATE, textAlign: 'center', marginTop: 3 }}>{x.periodo?.slice(5)}</div>
                <div style={{ fontSize: 9.5, fontWeight: 700, color: p >= 95 ? VERDE : p >= 85 ? AMBAR : ROJO, textAlign: 'center' }}>{p}%</div>
              </div>
            )
          })}
        </div>
        {ult.periodo && (
          <div style={{ fontSize: 11.5, color: SLATE, marginTop: 8, lineHeight: 1.5 }}>
            Último mes ({ult.periodo}): <b style={{ color: NAVY }}>{ult.pct_probado}% probado</b>, de los cuales <b>{ult.pct_uno_a_uno}% uno a uno</b>.
            {prev.pct_probado != null && <> Mes anterior: {prev.pct_probado}%.</>}
            {Number(ult.pct_uno_a_uno) < 20 && <> La prueba individual es baja porque falta el detalle de vouchers: hoy se valida que el total del día cuadre, no cada venta.</>}
          </div>
        )}
      </div>

      {/* filtros y acciones */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['', 'Todo'], ['plata', 'Solo plata'], ['revision', 'Por revisar'], ['dato', 'Falta dato']].map(([k, l]) => (
            <button key={k} onClick={() => setTipo(k)} style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
              border: `1px solid ${tipo === k ? NAVY : BORDE}`, background: tipo === k ? NAVY : '#fff', color: tipo === k ? '#fff' : INK }}>{l}</button>
          ))}
        </div>
        <select value={suc} onChange={e => setSuc(e.target.value)} style={INPUT}>
          <option value="">Todas las sucursales</option>
          {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        {sel.size > 0 && (
          <>
            <span style={{ fontSize: 12, fontWeight: 700, color: NAVY }}>{sel.size} seleccionados · {fmt(totSel)}</span>
            <button onClick={() => setModal(true)} style={{ ...INPUT, cursor: 'pointer', fontWeight: 700, background: NAVY, color: '#fff', border: `1px solid ${NAVY}` }}>Marcar como revisado</button>
          </>
        )}
        <button onClick={() => exportarExcel(filas, 'bandeja_tesoreria', 'Bandeja')} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY, marginLeft: 'auto' }}>Excel</button>
      </div>

      {msg && <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: VERDE }}>{msg}</div>}
      {error && <div style={{ background: '#FEF3F2', border: '1px solid #FECDCA', borderRadius: 8, padding: 12, color: ROJO, fontSize: 12.5 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {porTipo.map(x => (
          <div key={x.t} style={{ background: '#fff', border: `1px solid ${BORDE}`, borderLeft: `4px solid ${TIPO_C[x.t]}`, borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, letterSpacing: 0.5, color: SLATE, fontWeight: 700 }}>{TIPO_L[x.t].toUpperCase()}</div>
            <div style={{ fontSize: 19, fontWeight: 700, fontFamily: 'ui-monospace, monospace', color: TIPO_C[x.t] }}>{fmt(x.m)}</div>
            <div style={{ fontSize: 10.5, color: SLATE }}>{fS(x.n)} casos en la bandeja</div>
          </div>
        ))}
      </div>

      {/* bandeja */}
      <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ maxHeight: '55vh', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={{ ...TH, width: 30 }}><input type="checkbox" checked={sel.size > 0 && sel.size === filas.length} onChange={todos} /></th>
              <th style={TH}>Fecha</th><th style={{ ...TH, textAlign: 'right' }}>Días</th>
              <th style={TH}>Sucursal</th><th style={TH}>Cajero</th><th style={TH}>Documento</th>
              <th style={TH}>Cliente</th><th style={{ ...TH, textAlign: 'right' }}>Monto</th>
              <th style={TH}>Causa</th><th style={TH}>Qué hacer</th>
            </tr></thead>
            <tbody>
              {cargando && <tr><td colSpan={10} style={{ ...TD, textAlign: 'center', color: SLATE, padding: 20 }}>Cargando…</td></tr>}
              {!cargando && !filas.length && <tr><td colSpan={10} style={{ ...TD, textAlign: 'center', color: VERDE, padding: 22 }}>Bandeja vacía: no hay casos pendientes con este filtro.</td></tr>}
              {filas.map(f => (
                <tr key={f.bsale_id} style={{ background: sel.has(f.bsale_id) ? '#F0F4FF' : f.tipo === 'plata' ? '#FFFBFB' : undefined }}>
                  <td style={TD}><input type="checkbox" checked={sel.has(f.bsale_id)} onChange={() => toggle(f.bsale_id)} /></td>
                  <td style={{ ...TD, fontWeight: 600 }}>{f.fecha}</td>
                  <td style={{ ...NUM, color: f.dias_abierto > 90 ? ROJO : f.dias_abierto > 30 ? AMBAR : SLATE, fontWeight: f.dias_abierto > 90 ? 700 : 400 }}>{fS(f.dias_abierto)}</td>
                  <td style={TD}>{f.sucursal}</td>
                  <td style={{ ...TD, fontSize: 11.5 }}>{f.cajero}</td>
                  <td style={{ ...TD, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{f.documento}</td>
                  <td style={{ ...TD, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.cliente}</td>
                  <td style={{ ...NUM, fontWeight: 700 }}>{fmt(f.monto)}</td>
                  <td style={{ ...TD, fontSize: 11 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: TIPO_C[f.tipo], letterSpacing: 0.4 }}>{TIPO_L[f.tipo]?.toUpperCase()}</span>
                    <div style={{ color: INK }}>{f.causa_desc}</div>
                  </td>
                  <td style={{ ...TD, fontSize: 10.5, color: SLATE, whiteSpace: 'normal', maxWidth: 240 }}>{f.accion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 12px', borderTop: `1px solid ${BORDE}`, fontSize: 11, color: SLATE }}>
          Ordenado por prioridad: monto, urgencia de la causa y antigüedad. Un caso de más de 90 días aparece en rojo: la evidencia se pierde con el tiempo.
        </div>
      </div>

      {/* modal de resolución */}
      {modal && (
        <div onClick={() => setModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, width: 'min(520px, 94vw)', padding: 20, boxShadow: '0 12px 40px rgba(0,0,0,.22)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>Marcar {sel.size} caso(s) como revisados</div>
            <div style={{ fontSize: 12, color: SLATE, marginTop: 3, marginBottom: 14 }}>
              Total {fmt(totSel)}. Salen de la bandeja pero quedan registrados con tu nombre y este motivo. Se pueden reabrir.
            </div>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: SLATE }}>Motivo</label>
            <select value={motivo} onChange={e => setMotivo(e.target.value)} style={{ ...INPUT, width: '100%', marginTop: 4, marginBottom: 12 }}>
              {MOTIVOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: SLATE }}>Nota (qué encontraste)</label>
            <textarea value={nota} onChange={e => setNota(e.target.value)} rows={3}
              placeholder="Ej: el cliente transfirió las tres boletas juntas el día 14, se ve en la cartola."
              style={{ ...INPUT, width: '100%', marginTop: 4, resize: 'vertical', fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setModal(false)} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600 }}>Cancelar</button>
              <button onClick={resolver} disabled={cargando}
                style={{ ...INPUT, cursor: 'pointer', fontWeight: 700, background: NAVY, color: '#fff', border: `1px solid ${NAVY}` }}>
                {cargando ? 'Guardando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default BandejaTab
