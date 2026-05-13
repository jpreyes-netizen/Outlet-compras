import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabase'

const MESES = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC']
const ANIOS = [2025, 2026]
const CANALES_VENTA = ['VENTA GETNET','VENTA TRANSBANK','VENTA EFECTIVO','VENTA TRANSFERENCIA','OTROS ABONOS']

const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)
const compact = n => { if (!Number.isFinite(n)) return '—'; const abs = Math.abs(n); const sign = n < 0 ? '-' : ''; if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`; if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`; return `${sign}$${Math.round(abs)}` }

async function fetchMovs(anio) {
  const desde = `${anio}-01-01`, hasta = `${anio}-12-31`
  const all = []; const PAGE = 1000; let from = 0
  while (true) {
    const { data, error } = await supabase.from('movimientos_bancarios').select('id, fecha, monto, tipo, estado, subcuenta_id').gte('fecha', desde).lte('fecha', hasta).range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...(data ?? []))
    if ((data ?? []).length < PAGE) break
    from += PAGE
  }
  return all
}

function KpiBox({ label, value, accent }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #F3F4F6' }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9CA3AF', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', color: accent ?? '#111827' }}>{value}</div>
    </div>
  )
}

function PivotCard({ title, subtitle, rows, totalsRow, loading, emphasisColor }) {
  const TH = { padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: '#6B7280', background: '#F9FAFB', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.05em' }
  const TD = { padding: '7px 10px', fontSize: 12, color: '#374151', whiteSpace: 'nowrap', verticalAlign: 'middle' }
  return (
    <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #F3F4F6', overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #F3F4F6' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{subtitle}</div>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...TH, minWidth: 180 }}>Concepto</th>
              {MESES.map(m => <th key={m} style={{ ...TH, textAlign: 'right' }}>{m}</th>)}
              <th style={{ ...TH, textAlign: 'right', fontWeight: 700 }}>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={14} style={{ ...TD, textAlign: 'center', padding: '20px 0', color: '#9CA3AF' }}>Cargando…</td></tr>}
            {!loading && rows.map(r => (
              <tr key={r.nombre} style={{ borderTop: '1px solid #F3F4F6' }}>
                <td style={{ ...TD, fontWeight: 500 }}>{r.nombre}</td>
                {r.meses.map((v, i) => <td key={i} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{v === 0 ? '—' : compact(v)}</td>)}
                <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: emphasisColor ?? '#111827' }}>{r.total === 0 ? '—' : fmtCLP(r.total)}</td>
              </tr>
            ))}
            {!loading && (
              <tr style={{ borderTop: '2px solid #E5E7EB', background: '#F9FAFB' }}>
                <td style={{ ...TD, fontWeight: 700 }}>{totalsRow.nombre}</td>
                {totalsRow.meses.map((v, i) => <td key={i} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{v === 0 ? '—' : compact(v)}</td>)}
                <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: emphasisColor ?? '#111827' }}>{fmtCLP(totalsRow.total)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function EstadoClasificacionDashboard() {
  const [anio, setAnio] = useState(2026)
  const [movs, setMovs] = useState([])
  const [subcuentas, setSubcuentas] = useState([])
  const [cuentasMadre, setCuentasMadre] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true); setError(null)
    Promise.all([
      fetchMovs(anio),
      supabase.from('subcuentas').select('id, cuenta_madre_id').then(r => r.data ?? []),
      supabase.from('cuentas_madre').select('id, nombre, orden_eerr').order('orden_eerr', { ascending: true }).then(r => r.data ?? []),
    ]).then(([m, s, c]) => { setMovs(m); setSubcuentas(s); setCuentasMadre(c) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [anio])

  const subToMadre = useMemo(() => { const m = new Map(); subcuentas.forEach(s => m.set(s.id, s.cuenta_madre_id)); return m }, [subcuentas])
  const cmById = useMemo(() => { const m = new Map(); cuentasMadre.forEach(c => m.set(c.id, c)); return m }, [cuentasMadre])

  const kpis = useMemo(() => {
    let totalMov = 0, egresos = 0, ingresos = 0, montoEg = 0, montoIn = 0, clasificados = 0, pendientes = 0
    movs.forEach(m => {
      totalMov += 1
      const monto = Math.abs(Number(m.monto ?? 0))
      if (m.tipo === 'CARGO') { egresos += 1; montoEg += monto }
      else if (m.tipo === 'ABONO') { ingresos += 1; montoIn += monto }
      if (m.subcuenta_id) clasificados += 1; else pendientes += 1
    })
    return { totalMov, egresos, ingresos, montoEg, montoIn, clasificados, pendientes, pct: totalMov > 0 ? clasificados / totalMov : 0 }
  }, [movs])

  const ingresosPorCanal = useMemo(() => {
    const map = new Map(); CANALES_VENTA.forEach(c => map.set(c, Array(12).fill(0)))
    movs.forEach(m => {
      if (!m.subcuenta_id) return
      const cmId = subToMadre.get(m.subcuenta_id); if (!cmId) return
      const cm = cmById.get(cmId); if (!cm || !CANALES_VENTA.includes(cm.nombre)) return
      const mes = Number(m.fecha.slice(5, 7)) - 1; if (mes < 0 || mes > 11) return
      map.get(cm.nombre)[mes] += Math.abs(Number(m.monto ?? 0))
    })
    return CANALES_VENTA.map(c => { const meses = map.get(c); return { nombre: c, meses, total: meses.reduce((a, b) => a + b, 0) } })
  }, [movs, subToMadre, cmById])

  const egresosPorCuentaMadre = useMemo(() => {
    const cuentas = cuentasMadre.filter(c => !CANALES_VENTA.includes(c.nombre))
    const map = new Map(); cuentas.forEach(c => map.set(c.id, Array(12).fill(0)))
    movs.forEach(m => {
      if (m.tipo !== 'CARGO' || !m.subcuenta_id) return
      const cmId = subToMadre.get(m.subcuenta_id); if (!cmId || !map.has(cmId)) return
      const mes = Number(m.fecha.slice(5, 7)) - 1; if (mes < 0 || mes > 11) return
      map.get(cmId)[mes] += Math.abs(Number(m.monto ?? 0))
    })
    return cuentas.map(c => { const meses = map.get(c.id); return { nombre: c.nombre, meses, total: meses.reduce((a, b) => a + b, 0) } })
  }, [movs, subToMadre, cuentasMadre])

  const totalIngresosMes = useMemo(() => { const arr = Array(12).fill(0); ingresosPorCanal.forEach(r => r.meses.forEach((v, i) => arr[i] += v)); return arr }, [ingresosPorCanal])
  const totalEgresosMes = useMemo(() => { const arr = Array(12).fill(0); egresosPorCuentaMadre.forEach(r => r.meses.forEach((v, i) => arr[i] += v)); return arr }, [egresosPorCuentaMadre])

  const selectSt = { padding: '6px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 12, background: '#fff' }
  const cardSt = { background: '#fff', borderRadius: 10, padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #F3F4F6' }
  const TH = { padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: '#6B7280', background: '#F9FAFB', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.05em' }
  const TD = { padding: '7px 10px', fontSize: 12, color: '#374151', whiteSpace: 'nowrap', verticalAlign: 'middle' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={cardSt}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>📊 Estado de Clasificación</div>
            <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>Métricas desde los movimientos bancarios clasificados</div>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }}>Año</label>
            <select style={selectSt} value={String(anio)} onChange={e => setAnio(Number(e.target.value))}>
              {ANIOS.map(a => <option key={a} value={String(a)}>{a}</option>)}
            </select>
          </div>
        </div>
      </div>

      {error && <div style={{ borderRadius: 8, border: '1px solid #FECACA', background: '#FEF2F2', padding: '10px 14px', fontSize: 13, color: '#DC2626' }}>Error: {error}</div>}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <KpiBox label="Movimientos" value={kpis.totalMov.toLocaleString('es-CL')} />
        <KpiBox label="Egresos" value={kpis.egresos.toLocaleString('es-CL')} />
        <KpiBox label="Ingresos" value={kpis.ingresos.toLocaleString('es-CL')} />
        <KpiBox label="$ Egresos" value={fmtCLP(kpis.montoEg)} accent="#C2410C" />
        <KpiBox label="$ Ingresos" value={fmtCLP(kpis.montoIn)} accent="#15803D" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <KpiBox label="Clasificados" value={kpis.clasificados.toLocaleString('es-CL')} accent="#15803D" />
        <KpiBox label="Pendientes" value={kpis.pendientes.toLocaleString('es-CL')} accent={kpis.pendientes > 0 ? '#DC2626' : '#15803D'} />
        <KpiBox label="% Clasificación" value={`${(kpis.pct * 100).toFixed(1)}%`} accent="#1D4ED8" />
      </div>

      {/* Ingresos por canal */}
      <PivotCard title="📈 Ingresos por canal de venta — Mes nominal" subtitle="Ingresos clasificados según cuenta madre de venta."
        rows={ingresosPorCanal} totalsRow={{ nombre: 'TOTAL INGRESOS', meses: totalIngresosMes, total: totalIngresosMes.reduce((a, b) => a + b, 0) }}
        loading={loading} emphasisColor="#15803D" />

      {/* Egresos por cuenta madre */}
      <PivotCard title="💸 Egresos por cuenta madre — Mes nominal" subtitle="Desglose del gasto clasificado por cuenta madre."
        rows={egresosPorCuentaMadre} totalsRow={{ nombre: 'TOTAL EGRESOS', meses: totalEgresosMes, total: totalEgresosMes.reduce((a, b) => a + b, 0) }}
        loading={loading} emphasisColor="#C2410C" />

      {/* Resultado neto */}
      <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #F3F4F6', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #F3F4F6', fontSize: 14, fontWeight: 600, color: '#111827' }}>📊 Resultado neto mensual — Ingresos vs Egresos</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...TH, minWidth: 150 }}>Concepto</th>
                {MESES.map(m => <th key={m} style={{ ...TH, textAlign: 'right' }}>{m}</th>)}
                <th style={{ ...TH, textAlign: 'right', fontWeight: 700 }}>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderTop: '1px solid #F3F4F6' }}>
                <td style={{ ...TD, fontWeight: 500 }}>Total Ingresos</td>
                {totalIngresosMes.map((v, i) => <td key={i} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{compact(v)}</td>)}
                <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#15803D' }}>{fmtCLP(totalIngresosMes.reduce((a, b) => a + b, 0))}</td>
              </tr>
              <tr style={{ borderTop: '1px solid #F3F4F6' }}>
                <td style={{ ...TD, fontWeight: 500 }}>Total Egresos</td>
                {totalEgresosMes.map((v, i) => <td key={i} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{compact(v)}</td>)}
                <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#C2410C' }}>{fmtCLP(totalEgresosMes.reduce((a, b) => a + b, 0))}</td>
              </tr>
              <tr style={{ borderTop: '2px solid #E5E7EB', background: '#F9FAFB' }}>
                <td style={{ ...TD, fontWeight: 700 }}>RESULTADO NETO</td>
                {MESES.map((_, i) => {
                  const neto = totalIngresosMes[i] - totalEgresosMes[i]
                  return <td key={i} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: neto < 0 ? '#DC2626' : '#15803D' }}>{compact(neto)}</td>
                })}
                <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                  {fmtCLP(totalIngresosMes.reduce((a, b) => a + b, 0) - totalEgresosMes.reduce((a, b) => a + b, 0))}
                </td>
              </tr>
              <tr style={{ borderTop: '1px solid #F3F4F6' }}>
                <td style={{ ...TD, color: '#6B7280' }}>% Resultado / Ingreso</td>
                {MESES.map((_, i) => {
                  const ing = totalIngresosMes[i], neto = ing - totalEgresosMes[i]
                  const pct = ing > 0 ? (neto / ing) * 100 : 0
                  return <td key={i} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#6B7280' }}>{ing > 0 ? `${pct.toFixed(1)}%` : '—'}</td>
                })}
                <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#6B7280' }}>
                  {(() => { const ing = totalIngresosMes.reduce((a, b) => a + b, 0); const eg = totalEgresosMes.reduce((a, b) => a + b, 0); return ing > 0 ? `${(((ing - eg) / ing) * 100).toFixed(1)}%` : '—' })()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
