import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, Line, LineChart } from 'recharts'
import { supabase } from '../../supabase'

/* ═══ EERR Dashboard — reconstruido sobre v_eerr_dashboard Z extendido ═══
   La vista nueva devuelve:
   - 1 fila CONSOLIDADO por (año, mes) con EERR completo
   - N filas por sucursal con solo venta + remuneraciones (sin costo/gastos/resultado)
   El componente:
   - Por defecto muestra CONSOLIDADO (datos completos)
   - Al filtrar a una sucursal específica, oculta las métricas no medibles
*/

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const ANIOS = [2025, 2026]
const VISTA_CONSOLIDADO = 'CONSOLIDADO'

const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)
const fmtPct = (a, b) => (b && b !== 0) ? ((a / b) * 100).toFixed(1) + '%' : '—'

async function fetchEerr(anio) {
  const { data, error } = await supabase
    .from('v_eerr_dashboard')
    .select('anio, mes, sucursal_id, sucursal_nombre, venta_bruta, venta_neta, costo_ventas, margen_contribucion, rem_operacion, rem_venta, rem_admin, rem_socios, rem_total, gastos_operativos, total_gastos, resultado_operacional, tiene_data_completa')
    .eq('anio', anio)
  if (error) throw error
  return data ?? []
}

function SummaryCard({ label, value, color, sub, pctVN }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #F3F4F6' }}>
      <div style={{ height: 4, background: color ?? '#6B7280' }} />
      <div style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9CA3AF', marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', color: value === null ? '#D1D5DB' : (color ?? '#111827') }}>
          {value === null ? '—' : fmtCLP(value)}
        </div>
        {sub && <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>{sub}</div>}
        {pctVN && value !== null && <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2, fontFamily: 'monospace' }}>{pctVN} de VN</div>}
      </div>
    </div>
  )
}

export function EerrDashboard() {
  const [anio, setAnio] = useState(2026)
  const [mes, setMes] = useState('all')
  const [vista, setVista] = useState(VISTA_CONSOLIDADO)
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true); setError(null)
    fetchEerr(anio).then(setData).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [anio])

  // Vistas posibles: CONSOLIDADO + cada sucursal con data
  const sucursales = useMemo(() => {
    const set = new Set()
    data.forEach(r => { if (r.sucursal_nombre && r.sucursal_nombre !== VISTA_CONSOLIDADO) set.add(r.sucursal_nombre) })
    return Array.from(set).sort()
  }, [data])

  // Filas filtradas por vista + mes
  const filas = useMemo(() => data.filter(r => {
    if (r.sucursal_nombre !== vista) return false
    if (mes !== 'all' && r.mes !== Number(mes)) return false
    return true
  }), [data, vista, mes])

  const esConsolidado = vista === VISTA_CONSOLIDADO

  // Totales del período filtrado
  const totales = useMemo(() => {
    const acc = {
      venta_bruta: 0, venta_neta: 0, costo_ventas: 0, margen_contribucion: 0,
      rem_operacion: 0, rem_venta: 0, rem_admin: 0, rem_socios: 0, rem_total: 0,
      gastos_operativos: 0, total_gastos: 0, resultado_operacional: 0,
    }
    let alguna_completa = false
    filas.forEach(r => {
      acc.venta_bruta += Number(r.venta_bruta ?? 0)
      acc.venta_neta += Number(r.venta_neta ?? 0)
      acc.rem_operacion += Number(r.rem_operacion ?? 0)
      acc.rem_venta += Number(r.rem_venta ?? 0)
      acc.rem_admin += Number(r.rem_admin ?? 0)
      acc.rem_socios += Number(r.rem_socios ?? 0)
      acc.rem_total += Number(r.rem_total ?? 0)
      if (r.tiene_data_completa) {
        acc.costo_ventas += Number(r.costo_ventas ?? 0)
        acc.margen_contribucion += Number(r.margen_contribucion ?? 0)
        acc.gastos_operativos += Number(r.gastos_operativos ?? 0)
        acc.total_gastos += Number(r.total_gastos ?? 0)
        acc.resultado_operacional += Number(r.resultado_operacional ?? 0)
        alguna_completa = true
      }
    })
    return { ...acc, alguna_completa }
  }, [filas])

  // Data para chart (12 meses si mes='all', 1 mes si está filtrado)
  const dataChart = useMemo(() => {
    const fuente = data.filter(r => r.sucursal_nombre === vista)
    const porMes = new Map()
    for (let m = 1; m <= 12; m++) porMes.set(m, { mes: MESES[m - 1], venta_neta: 0, rem_total: 0, costo_ventas: null, resultado_operacional: null })
    fuente.forEach(r => {
      const row = porMes.get(r.mes)
      if (!row) return
      row.venta_neta = Number(r.venta_neta ?? 0)
      row.rem_total = Number(r.rem_total ?? 0)
      if (r.tiene_data_completa) {
        row.costo_ventas = Number(r.costo_ventas ?? 0)
        row.resultado_operacional = Number(r.resultado_operacional ?? 0)
      }
    })
    return Array.from(porMes.values())
  }, [data, vista])

  const selectSt = { padding: '6px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 12, background: '#fff' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Controles */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }}>Año</label>
          <select style={selectSt} value={String(anio)} onChange={e => setAnio(Number(e.target.value))}>
            {ANIOS.map(a => <option key={a} value={String(a)}>{a}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }}>Mes</label>
          <select style={selectSt} value={String(mes)} onChange={e => setMes(e.target.value)}>
            <option value="all">Todos</option>
            {MESES.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }}>Vista</label>
          <select style={selectSt} value={vista} onChange={e => setVista(e.target.value)}>
            <option value={VISTA_CONSOLIDADO}>CONSOLIDADO</option>
            {sucursales.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Aviso si está en vista sucursal */}
      {!esConsolidado && (
        <div style={{ borderRadius: 8, border: '1px solid #FCD34D', background: '#FEF3C7', padding: '10px 14px', fontSize: 12, color: '#92400E' }}>
          <b>Vista por sucursal:</b> solo se muestran venta y remuneraciones, que son las únicas fuentes con <code>sucursal_id</code> hoy en la base. Costos, gastos y resultado operacional NO están disponibles por sucursal porque <code>libro_compras</code> y <code>movimientos_bancarios</code> no incluyen <code>sucursal_id</code>. Para EERR completo, usa CONSOLIDADO.
        </div>
      )}

      {error && <div style={{ borderRadius: 8, border: '1px solid #FECACA', background: '#FEF2F2', padding: '10px 14px', fontSize: 13, color: '#DC2626' }}>Error: {error}</div>}

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Array.from({ length: 6 }).map((_, i) => <div key={i} style={{ height: 80, background: '#F3F4F6', borderRadius: 8 }} />)}
        </div>
      )}

      {!loading && !error && filas.length === 0 && (
        <div style={{ background: '#fff', borderRadius: 10, padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
          Sin datos para {vista} en {mes === 'all' ? `${anio}` : `${MESES[Number(mes) - 1]} ${anio}`}.
        </div>
      )}

      {!loading && filas.length > 0 && (
        <>
          {/* Cards principales */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <SummaryCard label="Venta Neta" value={totales.venta_neta} color="#1F4E79" />
            <SummaryCard label="Costo Ventas"
              value={esConsolidado && totales.alguna_completa ? totales.costo_ventas : null}
              color="#C2410C"
              pctVN={esConsolidado ? fmtPct(totales.costo_ventas, totales.venta_neta) : null} />
            <SummaryCard label="Margen Contribución"
              value={esConsolidado && totales.alguna_completa ? totales.margen_contribucion : null}
              color="#15803D"
              pctVN={esConsolidado ? fmtPct(totales.margen_contribucion, totales.venta_neta) : null} />
            <SummaryCard label="Remuneraciones (RRHH)"
              value={totales.rem_total}
              color="#7C3AED"
              pctVN={fmtPct(totales.rem_total, totales.venta_neta)}
              sub={esConsolidado ? 'haberes + aportes patronales' : 'solo haberes'} />
            <SummaryCard label="Gastos Operativos"
              value={esConsolidado && totales.alguna_completa ? totales.gastos_operativos : null}
              color="#B45309"
              pctVN={esConsolidado ? fmtPct(totales.gastos_operativos, totales.venta_neta) : null} />
            <SummaryCard label="Resultado Operacional"
              value={esConsolidado && totales.alguna_completa ? totales.resultado_operacional : null}
              color={totales.resultado_operacional >= 0 ? '#047857' : '#DC2626'}
              pctVN={esConsolidado ? fmtPct(totales.resultado_operacional, totales.venta_neta) : null} />
          </div>

          {/* Desglose remuneraciones */}
          <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 8, letterSpacing: '0.02em' }}>
              DESGLOSE REMUNERACIONES — {esConsolidado ? 'con aportes patronales prorrateados' : 'haberes por sucursal (sin aportes)'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
              <RemBox label="Operación" value={totales.rem_operacion} color="#1F4E79" />
              <RemBox label="Venta" value={totales.rem_venta} color="#7C3AED" />
              <RemBox label="Administrativos" value={totales.rem_admin} color="#B45309" />
              <RemBox label="Socios" value={totales.rem_socios} color="#DC2626" />
            </div>
          </div>

          {/* Chart: tendencia mensual */}
          {mes === 'all' && (
            <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 12, letterSpacing: '0.02em' }}>
                TENDENCIA MENSUAL — {vista}
              </div>
              <div style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dataChart}>
                    <CartesianGrid stroke="#F3F4F6" />
                    <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v} />
                    <Tooltip formatter={(v) => v !== null ? fmtCLP(v) : '—'} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="venta_neta" fill="#1F4E79" name="Venta Neta" />
                    <Bar dataKey="rem_total" fill="#7C3AED" name="Remuneraciones" />
                    {esConsolidado && <Bar dataKey="resultado_operacional" fill="#047857" name="Resultado Op." />}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function RemBox({ label, value, color }) {
  return (
    <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 12px', border: '1px solid #F3F4F6' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: color }}>{fmtCLP(value)}</div>
    </div>
  )
}
