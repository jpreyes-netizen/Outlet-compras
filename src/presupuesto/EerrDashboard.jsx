import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '../../supabase'

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const MESES_LARGOS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const ANIOS = [2025, 2026]

const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)

async function fetchEerr(anio) {
  const { data, error } = await supabase.from('v_eerr_dashboard').select('anio, mes, sucursal_nombre, venta_neta, costo_ventas, margen_contribucion, gastos_directos, resultado_operacional').eq('anio', anio)
  if (error) throw error
  return data ?? []
}

function SummaryCard({ label, value, color }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #F3F4F6' }}>
      <div style={{ height: 4, background: color ?? '#6B7280' }} />
      <div style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9CA3AF', marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: color ?? '#111827' }}>{fmtCLP(value)}</div>
      </div>
    </div>
  )
}

export function EerrDashboard() {
  const [anio, setAnio] = useState(2026)
  const [mes, setMes] = useState('all')
  const [sucursal, setSucursal] = useState('all')
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true); setError(null)
    fetchEerr(anio).then(setData).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [anio])

  const sucursales = useMemo(() => {
    const set = new Set()
    data.forEach(r => r.sucursal_nombre && set.add(r.sucursal_nombre))
    return Array.from(set).sort()
  }, [data])

  const filtered = useMemo(() => data.filter(r => {
    if (mes !== 'all' && r.mes !== Number(mes)) return false
    if (sucursal !== 'all' && r.sucursal_nombre !== sucursal) return false
    return true
  }), [data, mes, sucursal])

  const totals = useMemo(() => {
    const acc = { venta_neta: 0, costo_ventas: 0, margen_contribucion: 0, resultado_operacional: 0 }
    filtered.forEach(r => {
      acc.venta_neta += Number(r.venta_neta ?? 0)
      acc.costo_ventas += Number(r.costo_ventas ?? 0)
      acc.margen_contribucion += Number(r.margen_contribucion ?? 0)
      acc.resultado_operacional += Number(r.resultado_operacional ?? 0)
    })
    return acc
  }, [filtered])

  const tableRows = useMemo(() => [...filtered].sort((a, b) => a.mes !== b.mes ? a.mes - b.mes : (a.sucursal_nombre ?? '').localeCompare(b.sucursal_nombre ?? '')), [filtered])

  const chartData = useMemo(() => {
    const byMes = new Map()
    filtered.forEach(r => {
      if (!byMes.has(r.mes)) byMes.set(r.mes, { mes: MESES[r.mes - 1], venta_neta: 0, resultado: 0 })
      const row = byMes.get(r.mes)
      row.venta_neta += Number(r.venta_neta ?? 0)
      row.resultado += Number(r.resultado_operacional ?? 0)
    })
    return Array.from(byMes.entries()).sort((a, b) => a[0] - b[0]).map(([, v]) => v)
  }, [filtered])

  const selectSt = { padding: '6px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 12, background: '#fff' }
  const cardSt = { background: '#fff', borderRadius: 10, padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #F3F4F6' }
  const TH = { padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#6B7280', background: '#F9FAFB', whiteSpace: 'nowrap' }
  const TD = { padding: '8px 12px', fontSize: 12, color: '#374151', whiteSpace: 'nowrap', verticalAlign: 'middle' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Filtros */}
      <div style={cardSt}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }}>Año</label>
            <select style={selectSt} value={String(anio)} onChange={e => setAnio(Number(e.target.value))}>
              {ANIOS.map(a => <option key={a} value={String(a)}>{a}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }}>Mes</label>
            <select style={selectSt} value={mes} onChange={e => setMes(e.target.value)}>
              <option value="all">Todos</option>
              {MESES_LARGOS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }}>Sucursal</label>
            <select style={{ ...selectSt, minWidth: 200 }} value={sucursal} onChange={e => setSucursal(e.target.value)}>
              <option value="all">Todas</option>
              {sucursales.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </div>

      {error && <div style={{ borderRadius: 8, border: '1px solid #FECACA', background: '#FEF2F2', padding: '10px 14px', fontSize: 13, color: '#DC2626' }}>Error cargando datos: {error}</div>}

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <SummaryCard label="Venta Neta" value={totals.venta_neta} color="#3B82F6" />
        <SummaryCard label="Costo Ventas" value={totals.costo_ventas} color="#F97316" />
        <SummaryCard label="Margen Contribución" value={totals.margen_contribucion} color="#10B981" />
        <SummaryCard label="Resultado Operacional" value={totals.resultado_operacional} color={totals.resultado_operacional >= 0 ? '#10B981' : '#EF4444'} />
      </div>

      {/* Tabla EERR */}
      <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #F3F4F6', fontSize: 14, fontWeight: 600, color: '#111827' }}>Detalle EERR</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Mes', 'Sucursal', 'Venta Neta', 'Costo Ventas', 'Margen %', 'Gastos Directos', 'Resultado Operacional'].map((h, i) => (
                  <th key={h} style={{ ...TH, textAlign: i >= 2 ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} style={{ ...TD, textAlign: 'center', padding: '24px 0', color: '#9CA3AF' }}>Cargando…</td></tr>}
              {!loading && tableRows.length === 0 && <tr><td colSpan={7} style={{ ...TD, textAlign: 'center', padding: '24px 0', color: '#9CA3AF' }}>Sin datos para los filtros seleccionados</td></tr>}
              {tableRows.map((r, idx) => {
                const venta = Number(r.venta_neta ?? 0)
                const margen = Number(r.margen_contribucion ?? 0)
                const margenPct = venta > 0 ? (margen / venta) * 100 : 0
                const ro = Number(r.resultado_operacional ?? 0)
                return (
                  <tr key={`${r.anio}-${r.mes}-${r.sucursal_nombre}-${idx}`} style={{ borderTop: '1px solid #F3F4F6', background: ro < 0 ? '#FFF1F2' : 'transparent' }}>
                    <td style={TD}>{MESES_LARGOS[r.mes - 1]}</td>
                    <td style={TD}>{r.sucursal_nombre}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{fmtCLP(venta)}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{fmtCLP(Number(r.costo_ventas ?? 0))}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{margenPct.toFixed(1)}%</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{fmtCLP(Number(r.gastos_directos ?? 0))}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: ro < 0 ? '#DC2626' : '#16A34A' }}>{fmtCLP(ro)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Gráfico */}
      <div style={cardSt}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 14 }}>Venta Neta vs Resultado Operacional</div>
        <div style={{ height: 360 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="mes" style={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => `$${Math.round(Number(v) / 1_000_000)}M`} width={70} style={{ fontSize: 11 }} />
              <Tooltip formatter={v => fmtCLP(Number(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="venta_neta" name="Venta Neta" fill="#3B82F6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="resultado" name="Resultado Operacional" fill="#10B981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
