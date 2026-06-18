import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Save, AlertTriangle, AlertCircle, CheckCircle2, TrendingDown, Activity, CalendarClock } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid, Legend } from 'recharts'
import { supabase } from '../../supabase'
import { cargarDatosProyeccion, construirProyeccion, analizarRiesgos, proyectarMensual, rangoSemana, fmtCLP, fmtCLPplano, fmtMM } from './proyeccionEngine'

const PRIMARY = '#1F4E79'
const ANIOS = [2024, 2025, 2026, 2027]
const MESES_L = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const CAT = [
  { k: 'compras',  l: 'Compras',         c: '#DC2626' },
  { k: 'rem',      l: 'Remuneraciones',  c: '#D97706' },
  { k: 'overhead', l: 'Overhead',        c: '#2563EB' },
  { k: 'cred',     l: 'Créditos',        c: '#7C3AED' },
  { k: 'imp',      l: 'Impuestos',       c: '#B45309' },
]
const ESC = [
  { k: 'base',   l: 'Base',      c: PRIMARY },
  { k: 'opt',    l: 'Optimista', c: '#16A34A' },
  { k: 'pes',    l: 'Pesimista', c: '#DC2626' },
  { k: 'stress', l: 'Stress',    c: '#9333EA' },
]

const TH = { padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#374151', background: '#F1F5F9', whiteSpace: 'nowrap' }
const TD = { padding: '7px 10px', fontSize: 12, color: '#374151', borderBottom: '1px solid #F1F5F9' }

export function AnalisisRiesgoTab({ anio, setAnio }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [raw, setRaw]         = useState(null)
  const [feriados, setFeriados] = useState(new Set())
  const [venta, setVenta]     = useState({})
  const [umbral, setUmbral]   = useState(60000000)
  const [optPct, setOptPct]   = useState(15)
  const [pesPct, setPesPct]   = useState(15)
  const [stressPct, setStressPct] = useState(-20)

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      setLoading(true)
      try {
        const desde = `${anio}-01-01`, hasta = `${anio}-12-31`
        const [cfgR, ferR, data] = await Promise.all([
          supabase.from('flujo_proyeccion_config').select('*').eq('anio', anio).maybeSingle(),
          supabase.from('feriados').select('fecha').eq('irrenunciable', true).gte('fecha', desde).lte('fecha', hasta),
          cargarDatosProyeccion(anio),
        ])
        if (cancelado) return
        setFeriados(new Set((ferR.data ?? []).map(f => f.fecha)))
        const cfg = cfgR.data
        const vd = {}; const rawv = cfg?.venta_diaria ?? {}
        for (let m = 1; m <= 12; m++) vd[m] = Number(rawv[m] ?? rawv[String(m)] ?? 0) || 0
        setVenta(vd)
        setUmbral(Number(cfg?.umbral_minimo ?? 60000000) || 60000000)
        setOptPct(Number(cfg?.optimista_pct ?? 15) || 15)
        setPesPct(Number(cfg?.pesimista_pct ?? 15) || 15)
        setRaw(data)
      } catch (e) {
        toast.error('Error: ' + (e?.message ?? '?'))
        setRaw(null)
      } finally { if (!cancelado) setLoading(false) }
    })()
    return () => { cancelado = true }
  }, [anio])

  const base   = useMemo(() => raw ? construirProyeccion(raw, venta, feriados, umbral, anio, { ventaMult: 1 }) : null, [raw, venta, feriados, umbral, anio])
  const opt    = useMemo(() => raw ? construirProyeccion(raw, venta, feriados, umbral, anio, { ventaMult: 1 + optPct / 100 }) : null, [raw, venta, feriados, umbral, anio, optPct])
  const pes    = useMemo(() => raw ? construirProyeccion(raw, venta, feriados, umbral, anio, { ventaMult: 1 - pesPct / 100 }) : null, [raw, venta, feriados, umbral, anio, pesPct])
  const stress = useMemo(() => raw ? construirProyeccion(raw, venta, feriados, umbral, anio, { ventaMult: 1 + stressPct / 100 }) : null, [raw, venta, feriados, umbral, anio, stressPct])

  const escData = { base, opt, pes, stress }
  const alertas = useMemo(() => base ? analizarRiesgos(base, umbral) : [], [base, umbral])

  // Real (banco) vs Proyectado (motor) mensual — para meses transcurridos
  const proyMes = useMemo(() => raw ? proyectarMensual(raw, venta, feriados, anio) : {}, [raw, venta, feriados, anio])

  const chartData = useMemo(() => {
    if (!base) return []
    return base.weeks.map((w, i) => ({
      name: rangoSemana(w.ini, w.fin),
      base: Math.round(w.saldo),
      opt: opt?.weeks[i] ? Math.round(opt.weeks[i].saldo) : null,
      pes: pes?.weeks[i] ? Math.round(pes.weeks[i].saldo) : null,
      stress: stress?.weeks[i] ? Math.round(stress.weeks[i].saldo) : null,
    }))
  }, [base, opt, pes, stress])

  // Próximos vencimientos (de la base): ordenados por fecha, con semáforo
  const vencimientos = useMemo(() => {
    if (!base) return []
    const hoy = new Date()
    const hoyTs = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
    const arr = base.eventos.map(e => {
      let dias = 0
      if (e.fecha) { const [y, m, d] = String(e.fecha).split('-').map(Number); dias = Math.round((Date.UTC(y, m - 1, d) - hoyTs) / 86400000) }
      const nivel = (e.vencido || dias <= 7) ? 'rojo' : dias <= 21 ? 'ambar' : 'verde'
      return { ...e, dias, nivel }
    }).sort((a, b) => (a.dias - b.dias))
    return arr
  }, [base])

  async function guardarEscenarios() {
    setSaving(true)
    try {
      const vd = {}; for (let m = 1; m <= 12; m++) vd[m] = Number(venta[m] || 0)
      const { error } = await supabase.from('flujo_proyeccion_config')
        .upsert({ anio, umbral_minimo: Number(umbral || 0), venta_diaria: vd, optimista_pct: Number(optPct || 0), pesimista_pct: Number(pesPct || 0), updated_at: new Date().toISOString() }, { onConflict: 'anio' })
      if (error) throw error
      toast.success('Escenarios guardados')
    } catch (e) { toast.error('Error: ' + (e?.message ?? '?')) } finally { setSaving(false) }
  }

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#94A3B8' }}><Loader2 size={28} className="spin" /><div style={{ marginTop: 10, fontSize: 13 }}>Cargando análisis…</div></div>

  if (!base || base.weeks.length === 0) {
    return <div style={{ background: '#fff', borderRadius: 10, padding: 40, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
      {base?.vacio === 'pasado' ? 'El análisis proyecta hacia adelante desde hoy — elige el año en curso.' : 'Sin datos para el análisis.'}
    </div>
  }

  const ventaVacia = Object.values(venta).every(v => !v)
  const runwayTxt = p => p?.quiebre ? `${p.semQuiebre} sem` : '∞'
  const kpiRow = (p) => p ? { fin: p.saldoFin, min: p.minSaldo, sem: p.minWeek ? rangoSemana(p.minWeek.ini, p.minWeek.fin) : '—', cob: p.cobertura, runway: runwayTxt(p), quiebre: p.quiebre, bajo: p.cruzaUmbral } : null

  const ICON = { alto: <AlertTriangle size={16} />, medio: <AlertCircle size={16} />, ok: <CheckCircle2 size={16} /> }
  const COL  = { alto: { bg: '#FEF2F2', bd: '#FCA5A5', tx: '#991B1B' }, medio: { bg: '#FFFBEB', bd: '#FCD34D', tx: '#92400E' }, ok: { bg: '#F0FDF4', bd: '#86EFAC', tx: '#166534' } }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: '#fff', padding: 12, borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: PRIMARY, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Activity size={15} /> Análisis de riesgo</span>
        <select value={anio} onChange={e => setAnio(Number(e.target.value))} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 13, fontWeight: 600, color: '#374151' }}>
          {ANIOS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <label style={{ fontSize: 12, color: '#16A34A', fontWeight: 600 }}>Optimista +%</label>
        <input value={optPct} onChange={e => setOptPct(parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)} style={{ width: 52, textAlign: 'right', padding: '6px 8px', border: '1px solid #E5E7EB', borderRadius: 7, fontSize: 12 }} />
        <label style={{ fontSize: 12, color: '#DC2626', fontWeight: 600 }}>Pesimista −%</label>
        <input value={pesPct} onChange={e => setPesPct(parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)} style={{ width: 52, textAlign: 'right', padding: '6px 8px', border: '1px solid #E5E7EB', borderRadius: 7, fontSize: 12 }} />
        <button onClick={guardarEscenarios} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: PRIMARY, color: '#fff' }}>{saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Guardar</button>
      </div>

      {ventaVacia && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: '#92400E' }}>
          <AlertCircle size={15} style={{ color: '#D97706', flexShrink: 0 }} />
          <span>Sin <b>venta diaria</b> configurada los ingresos van en $0 y todo escenario cae. Configúrala en <b>Proyección compromisos → Parámetros</b>.</span>
        </div>
      )}

      {/* Alertas de riesgo */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {alertas.map((al, i) => {
          const c = COL[al.nivel] || COL.medio
          return (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 10, padding: '10px 14px' }}>
              <span style={{ color: c.tx, flexShrink: 0, marginTop: 1 }}>{ICON[al.nivel] || ICON.medio}</span>
              <div style={{ fontSize: 12.5, color: c.tx, lineHeight: 1.45 }}><b>{al.titulo}.</b> {al.texto}</div>
            </div>
          )
        })}
      </div>

      {/* Comparativa de escenarios */}
      <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', padding: '16px 14px 6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingLeft: 6, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>Saldo proyectado por escenario</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TrendingDown size={13} style={{ color: '#9333EA' }} />
            <span style={{ fontSize: 11, color: '#6B7280' }}>Stress: venta {stressPct >= 0 ? '+' : ''}{stressPct}%</span>
            <input type="range" min={-50} max={20} value={stressPct} onChange={e => setStressPct(Number(e.target.value))} style={{ width: 160 }} />
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
            <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94A3B8' }} interval="preserveStartEnd" />
            <YAxis tickFormatter={fmtMM} tick={{ fontSize: 9, fill: '#94A3B8' }} width={48} />
            <Tooltip formatter={(v, n) => [fmtCLPplano(v), ESC.find(e => e.k === n)?.l || n]} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
            <Legend formatter={(v) => ESC.find(e => e.k === v)?.l || v} wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={umbral} stroke="#DC2626" strokeDasharray="4 4" />
            <ReferenceLine y={0} stroke="#94A3B8" />
            <Line type="monotone" dataKey="opt" stroke="#16A34A" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="base" stroke={PRIMARY} strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="pes" stroke="#DC2626" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="stress" stroke="#9333EA" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Tabla comparativa de escenarios */}
      <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr><th style={{ ...TH }}>Escenario</th><th style={{ ...TH, textAlign: 'right' }}>Saldo fin de año</th><th style={{ ...TH, textAlign: 'right' }}>Saldo mínimo</th><th style={{ ...TH }}>Semana crítica</th><th style={{ ...TH, textAlign: 'right' }}>Cobertura</th><th style={{ ...TH, textAlign: 'center' }}>Runway</th></tr>
          </thead>
          <tbody>
            {ESC.map(e => {
              const r = kpiRow(escData[e.k]); if (!r) return null
              return (
                <tr key={e.k}>
                  <td style={{ ...TD, fontWeight: 700, color: e.c }}>● {e.l}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: r.fin < umbral ? '#DC2626' : '#15803D' }}>{fmtCLPplano(r.fin)}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: r.min < 0 ? '#991B1B' : r.min < umbral ? '#92400E' : '#374151' }}>{fmtCLPplano(r.min)}</td>
                  <td style={{ ...TD, fontFamily: 'monospace', color: '#6B7280' }}>{r.sem}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: (r.cob != null && r.cob < 1) ? '#DC2626' : '#15803D' }}>{r.cob != null ? Math.round(r.cob * 100) + '%' : '—'}</td>
                  <td style={{ ...TD, textAlign: 'center', fontWeight: 700, color: r.quiebre ? '#DC2626' : '#15803D' }}>{r.runway}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Real (banco) vs Proyectado (motor) — mensual */}
      <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px 6px', fontSize: 12, fontWeight: 700, color: '#374151' }}>
          Real vs Proyectado <span style={{ fontWeight: 400, color: '#6B7280' }}>— banco vs motor, por mes (los meses futuros solo proyectados)</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ ...TH }}>Mes</th>
                <th style={{ ...TH, textAlign: 'right', color: '#15803D' }}>Ingreso real</th>
                <th style={{ ...TH, textAlign: 'right' }}>Ing. proy.</th>
                <th style={{ ...TH, textAlign: 'right' }}>Δ ventas</th>
                <th style={{ ...TH, textAlign: 'right', color: '#991B1B' }}>Egreso real</th>
                <th style={{ ...TH, textAlign: 'right' }}>Egr. proy.</th>
                <th style={{ ...TH, textAlign: 'right' }}>Neto real</th>
                <th style={{ ...TH, textAlign: 'right' }}>Neto proy.</th>
              </tr>
            </thead>
            <tbody>
              {MESES_L.map((nom, i) => {
                const m = i + 1
                const r = raw.realMensual?.[m] || { ingreso: 0, egreso: 0 }
                const p = proyMes[m] || { ingreso: 0, egreso: 0 }
                const transcurrido = m < (raw.mesCorte ?? 13)
                const dVentas = (transcurrido && p.ingreso > 0) ? ((r.ingreso - p.ingreso) / p.ingreso) * 100 : null
                const netoR = r.ingreso - r.egreso, netoP = p.ingreso - p.egreso
                return (
                  <tr key={m} style={{ background: transcurrido ? 'transparent' : '#FAFAFA' }}>
                    <td style={{ ...TD, fontWeight: 600 }}>{nom}{!transcurrido && <span style={{ fontSize: 9, color: '#9CA3AF', marginLeft: 4 }}>futuro</span>}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: transcurrido ? '#15803D' : '#D1D5DB' }}>{transcurrido ? fmtCLP(r.ingreso) : '—'}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#6B7280' }}>{fmtCLP(p.ingreso)}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: dVentas == null ? '#D1D5DB' : dVentas < 0 ? '#DC2626' : '#15803D' }}>{dVentas == null ? '—' : (dVentas >= 0 ? '+' : '') + dVentas.toFixed(0) + '%'}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: transcurrido ? '#991B1B' : '#D1D5DB' }}>{transcurrido ? fmtCLP(r.egreso) : '—'}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#6B7280' }}>{fmtCLP(p.egreso)}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: transcurrido ? (netoR < 0 ? '#DC2626' : '#15803D') : '#D1D5DB' }}>{transcurrido ? fmtCLP(netoR) : '—'}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: netoP < 0 ? '#DC2626' : '#6B7280' }}>{fmtCLP(netoP)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 14px', borderTop: '1px solid #F3F4F6', fontSize: 10.5, color: '#6B7280' }}>
          "Δ ventas" = cuánto se desvió la venta real de la proyectada en meses transcurridos. Real desde la cuenta Santander (NIC 7); proyectado desde el motor de compromisos.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 14 }}>
        {/* Egresos por categoría (horizonte) */}
        <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 12 }}>Egresos proyectados por categoría</div>
          {CAT.map(cat => {
            const val = base.totCat[cat.k] || 0
            const pct = base.totEgr > 0 ? (val / base.totEgr) * 100 : 0
            return (
              <div key={cat.k} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
                  <span style={{ color: '#475569', fontWeight: 600 }}>{cat.l}</span>
                  <span style={{ fontFamily: 'monospace', color: '#374151' }}>{fmtCLPplano(val)} · {pct.toFixed(0)}%</span>
                </div>
                <div style={{ height: 8, background: '#F1F5F9', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: cat.c, borderRadius: 4 }} />
                </div>
              </div>
            )
          })}
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ fontWeight: 700, color: '#991B1B' }}>Total egresos horizonte</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#991B1B' }}>{fmtCLPplano(base.totEgr)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 4 }}>
            <span style={{ fontWeight: 700, color: '#15803D' }}>Total ingresos horizonte</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#15803D' }}>{fmtCLPplano(base.totIng)}</span>
          </div>
        </div>

        {/* Próximos vencimientos */}
        <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}><CalendarClock size={14} /> Próximos vencimientos</div>
          {vencimientos.length === 0 ? (
            <div style={{ fontSize: 12, color: '#9CA3AF' }}>Sin compromisos dateados en el horizonte.</div>
          ) : (
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={{ ...TH }}>Fecha</th><th style={{ ...TH }}>Concepto</th><th style={{ ...TH, textAlign: 'right' }}>Monto</th></tr></thead>
                <tbody>
                  {vencimientos.slice(0, 25).map((v, i) => {
                    const dot = v.nivel === 'rojo' ? '#DC2626' : v.nivel === 'ambar' ? '#D97706' : '#16A34A'
                    return (
                      <tr key={i}>
                        <td style={{ ...TD, fontFamily: 'monospace', whiteSpace: 'nowrap' }}><span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 4, background: dot, marginRight: 6 }} />{v.vencido ? 'vencido' : (v.fecha || '—')}</td>
                        <td style={{ ...TD }}><span style={{ fontSize: 10, color: '#6B7280' }}>{v.label}</span> {v.concepto}</td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#991B1B' }}>{fmtCLPplano(v.monto)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
