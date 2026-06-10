import { useMemo } from 'react'
import { BarChart, Bar, LineChart, Line, ComposedChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend, Cell, ReferenceLine, LabelList } from 'recharts'

/* ═══ PRESUPUESTO GRÁFICOS ═══
   Recibe `filas` ({item, codigo, pres[12], real[12], esSubtotal, sinReal, sinPresupuesto})
   y `mesHasta` desde FinPresupuesto. No hace fetch propio.
   1. Venta: presupuesto vs real mensual
   2. Cumplimiento % por línea principal (horizontal)
   3. Desviación mensual acumulada
   4. Top 10 desvíos absolutos
*/

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)
const fmtM = n => {
  const abs = Math.abs(n || 0)
  if (abs >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'MM'
  if (abs >= 1e6) return '$' + (n / 1e6).toFixed(0) + 'M'
  return fmtCLP(n)
}

const sumHasta = (arr, m) => { let s = 0; for (let i = 0; i < m; i++) s += arr[i] || 0; return s }

export function PresupuestoGraficos({ filas, mesHasta }) {
  if (!filas || filas.length === 0) return <div style={{ fontSize: 13, color: '#9CA3AF', padding: 20 }}>Sin datos para graficar.</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <VentaPresVsReal filas={filas} mesHasta={mesHasta} />
      <CumplimientoLineas filas={filas} mesHasta={mesHasta} />
      <DesviacionMensual filas={filas} mesHasta={mesHasta} />
      <TopDesvios filas={filas} mesHasta={mesHasta} />
    </div>
  )
}

/* ─── 1. Venta neta: pres vs real ─── */
function VentaPresVsReal({ filas, mesHasta }) {
  const fila = filas.find(f => f.codigo === 'VENTA_NETA') || filas.find(f => f.codigo === 'VENTA_BRUTA')
  const data = useMemo(() => {
    if (!fila) return []
    return Array.from({ length: 12 }, (_, i) => ({
      mes: MESES[i],
      pres: fila.pres[i] || 0,
      real: i < mesHasta ? (fila.real[i] || 0) : null,
      cumplimiento: i < mesHasta && fila.pres[i] > 0 ? ((fila.real[i] || 0) / fila.pres[i]) * 100 : null,
    }))
  }, [fila, mesHasta])
  if (!fila) return null

  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>VENTA: PRESUPUESTO vs REAL</div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 10 }}>Línea morada = % cumplimiento del mes (eje derecho, 100% es meta exacta).</div>
      <div style={{ height: 270 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 40, bottom: 5, left: 10 }}>
            <CartesianGrid stroke="#F3F4F6" strokeDasharray="3 3" />
            <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="izq" tick={{ fontSize: 10 }} tickFormatter={v => fmtM(v)} />
            <YAxis yAxisId="der" orientation="right" tick={{ fontSize: 10 }} tickFormatter={v => v + '%'} domain={[0, 'auto']} />
            <Tooltip formatter={(v, name) => name === '% Cumplimiento' ? (v !== null ? v.toFixed(0) + '%' : '—') : (v !== null ? fmtCLP(v) : '—')} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="izq" dataKey="pres" fill="#CBD5E1" name="Presupuesto" />
            <Bar yAxisId="izq" dataKey="real" fill="#1F4E79" name="Real" />
            <ReferenceLine yAxisId="der" y={100} stroke="#9CA3AF" strokeDasharray="4 4" />
            <Line yAxisId="der" type="monotone" dataKey="cumplimiento" name="% Cumplimiento" stroke="#7C3AED" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* ─── 2. Cumplimiento % por línea (horizontal) ─── */
function CumplimientoLineas({ filas, mesHasta }) {
  const data = useMemo(() => {
    return filas
      .filter(f => !f.esSubtotal && !f.sinReal && !f.sinPresupuesto && f.codigo)
      .map(f => {
        const pres = sumHasta(f.pres, mesHasta)
        const real = sumHasta(f.real, mesHasta)
        if (pres <= 0) return null
        const pct = (real / pres) * 100
        const esIngreso = f.codigo.startsWith('VENTA')
        return { nombre: f.item.length > 26 ? f.item.slice(0, 24) + '…' : f.item, pct, pres, real, esIngreso }
      })
      .filter(Boolean)
      .sort((a, b) => b.pct - a.pct)
  }, [filas, mesHasta])

  // Color: ingresos sobre 100 es bueno; gastos sobre 100 es malo
  const colorBarra = d => {
    if (d.esIngreso) return d.pct >= 100 ? '#15803D' : d.pct >= 85 ? '#B45309' : '#DC2626'
    return d.pct <= 100 ? '#15803D' : d.pct <= 120 ? '#B45309' : '#DC2626'
  }

  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>CUMPLIMIENTO POR LÍNEA (acumulado a {MESES[mesHasta - 1]})</div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 10 }}>
        Verde = en rango. En gastos, sobre 100% es exceso (rojo). En ingresos, sobre 100% es bueno.
      </div>
      <div style={{ height: Math.max(220, data.length * 26) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 60, bottom: 5, left: 10 }}>
            <CartesianGrid stroke="#F3F4F6" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => v + '%'} domain={[0, dataMax => Math.max(140, Math.ceil(dataMax / 20) * 20)]} />
            <YAxis type="category" dataKey="nombre" tick={{ fontSize: 10 }} width={170} />
            <Tooltip formatter={(v, name, props) => [v.toFixed(0) + '% (' + fmtM(props.payload.real) + ' de ' + fmtM(props.payload.pres) + ')', 'Cumplimiento']} />
            <ReferenceLine x={100} stroke="#6B7280" strokeDasharray="4 4" />
            <Bar dataKey="pct" name="% Cumplimiento" radius={[0, 4, 4, 0]}>
              {data.map((d, i) => <Cell key={i} fill={colorBarra(d)} />)}
              <LabelList dataKey="pct" position="right" formatter={v => v.toFixed(0) + '%'} style={{ fontSize: 9, fill: '#374151' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* ─── 3. Desviación mensual del gasto total ─── */
function DesviacionMensual({ filas, mesHasta }) {
  const data = useMemo(() => {
    // Sumar todas las líneas de gasto (no subtotales, no ventas)
    const gastos = filas.filter(f => !f.esSubtotal && f.codigo && !f.codigo.startsWith('VENTA') && !f.sinReal && !f.sinPresupuesto)
    return Array.from({ length: mesHasta }, (_, i) => {
      let pres = 0, real = 0
      gastos.forEach(f => { pres += f.pres[i] || 0; real += f.real[i] || 0 })
      return { mes: MESES[i], desvio: real - pres, pres, real }
    })
  }, [filas, mesHasta])

  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>DESVIACIÓN DEL GASTO TOTAL POR MES</div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 10 }}>Barra roja sobre cero = gastaste más de lo presupuestado ese mes. Verde bajo cero = ahorro.</div>
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
            <CartesianGrid stroke="#F3F4F6" strokeDasharray="3 3" />
            <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmtM(v)} />
            <Tooltip formatter={(v, name, props) => [fmtCLP(v) + ' (real ' + fmtM(props.payload.real) + ' vs pres ' + fmtM(props.payload.pres) + ')', 'Desvío']} />
            <ReferenceLine y={0} stroke="#9CA3AF" />
            <Bar dataKey="desvio" name="Desvío">
              {data.map((d, i) => <Cell key={i} fill={d.desvio > 0 ? '#DC2626' : '#15803D'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* ─── 4. Top 10 desvíos absolutos ─── */
function TopDesvios({ filas, mesHasta }) {
  const data = useMemo(() => {
    return filas
      .filter(f => !f.esSubtotal && f.codigo && !f.sinReal && !f.sinPresupuesto)
      .map(f => {
        const pres = sumHasta(f.pres, mesHasta)
        const real = sumHasta(f.real, mesHasta)
        const desvio = real - pres
        const esIngreso = f.codigo.startsWith('VENTA')
        // Para ingresos, desvío negativo es malo; para gastos, positivo es malo
        const malo = esIngreso ? desvio < 0 : desvio > 0
        return { nombre: f.item.length > 26 ? f.item.slice(0, 24) + '…' : f.item, desvio, malo, abs: Math.abs(desvio) }
      })
      .filter(d => d.abs > 100000)
      .sort((a, b) => b.abs - a.abs)
      .slice(0, 10)
  }, [filas, mesHasta])

  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>TOP 10 DESVÍOS vs PRESUPUESTO</div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 10 }}>Las 10 líneas con mayor diferencia absoluta. Rojo = desvío desfavorable.</div>
      <div style={{ height: Math.max(200, data.length * 30) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 70, bottom: 5, left: 10 }}>
            <CartesianGrid stroke="#F3F4F6" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => fmtM(v)} />
            <YAxis type="category" dataKey="nombre" tick={{ fontSize: 10 }} width={170} />
            <Tooltip formatter={v => fmtCLP(v)} />
            <ReferenceLine x={0} stroke="#9CA3AF" />
            <Bar dataKey="desvio" name="Desvío" radius={[0, 4, 4, 0]}>
              {data.map((d, i) => <Cell key={i} fill={d.malo ? '#DC2626' : '#15803D'} />)}
              <LabelList dataKey="desvio" position="right" formatter={v => fmtM(v)} style={{ fontSize: 9, fill: '#374151' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
