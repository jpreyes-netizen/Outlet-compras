import { useMemo } from 'react'
import { LineChart, Line, BarChart, Bar, ComposedChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend, Cell, ReferenceLine, PieChart, Pie } from 'recharts'
import { formato } from './motor'

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

const COLORES_LINEAS = ['#1F4E79','#7C3AED','#15803D','#B45309','#DC2626','#0891B2','#D97706','#7C3AED']

/* ─── Gráfico de los 3 márgenes (Bruto, Operacional, Neto) ─── */
export function GraficoMargenes({ valores, mesHasta }) {
  const data = useMemo(() => {
    if (!valores) return []
    const get = c => valores.get(c) ?? new Array(12).fill(0)
    return Array.from({ length: 12 }, (_, i) => {
      const futuro = i >= mesHasta
      const vn = get('VENTA_NETA')[i]
      const mc = get('MARGEN_CONTRIB')[i]
      const ro = get('RESULTADO_OPERACIONAL')[i]
      const rf = get('RESULTADO_FINAL')[i]
      return {
        mes: MESES[i],
        bruto:  !futuro && vn > 0 ? (mc / vn) * 100 : null,
        operacional: !futuro && vn > 0 ? (ro / vn) * 100 : null,
        neto: !futuro && vn > 0 ? (rf / vn) * 100 : null,
      }
    })
  }, [valores, mesHasta])

  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 4, letterSpacing: '0.02em' }}>
        EVOLUCIÓN DE MÁRGENES
      </div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 10 }}>
        % sobre venta neta. Bruto sano ≥40%, Operacional ≥15%, Neto ≥8%.
      </div>
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid stroke="#F3F4F6" strokeDasharray="3 3" />
            <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => v + '%'} domain={['auto', 'auto']} />
            <Tooltip formatter={(v, name) => v !== null ? [v.toFixed(1) + '%', name] : ['—', name]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="#E5E7EB" />
            <Line type="monotone" dataKey="bruto" stroke="#1F4E79" strokeWidth={2} name="Margen Bruto" connectNulls={false} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="operacional" stroke="#7C3AED" strokeWidth={2} name="Margen Operacional" connectNulls={false} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="neto" stroke="#15803D" strokeWidth={2} name="Margen Neto" connectNulls={false} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* ─── Gasto vs Venta mensual (barras dobles) ─── */
export function GraficoGastoVsVenta({ valores, mesHasta }) {
  const data = useMemo(() => {
    if (!valores) return []
    const get = c => valores.get(c) ?? new Array(12).fill(0)
    const codigos = [
      'COSTO_NETO','REM_OPERACION','REM_VENTA','REM_ADMIN','REM_SOCIOS',
      'MARKETING','COMISION_GETNET','GASTOS_BANCARIOS','MOBILIARIO',
      'SERVICIOS_EXTERNOS','ARRIENDO','CUENTAS_BASICAS','COMBUSTIBLE',
      'FINIQUITOS','GASTOS_TI','OTROS_GASTOS_ADMIN','TRANSPORTE_VIATICOS',
    ]
    return Array.from({ length: 12 }, (_, i) => {
      const futuro = i >= mesHasta
      const venta = !futuro ? (get('VENTA_NETA')[i] || 0) : null
      const gasto = !futuro ? codigos.reduce((s, c) => s + (get(c)[i] || 0), 0) : null
      return { mes: MESES[i], venta, gasto, resultado: (venta && gasto) ? (venta - gasto) : null }
    })
  }, [valores, mesHasta])

  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 4, letterSpacing: '0.02em' }}>
        GASTO TOTAL vs VENTA NETA
      </div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 10 }}>
        Si la línea verde (resultado) cae, los gastos están creciendo más rápido que las ventas.
      </div>
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid stroke="#F3F4F6" strokeDasharray="3 3" />
            <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => v >= 1e6 ? (v / 1e6).toFixed(0) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : v} />
            <Tooltip formatter={v => v !== null ? formato.clp(v) : '—'} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="venta" fill="#1F4E79" name="Venta Neta" />
            <Bar dataKey="gasto" fill="#DC2626" name="Gasto Total" />
            <Line type="monotone" dataKey="resultado" stroke="#15803D" strokeWidth={2} name="Resultado" dot={{ r: 3 }} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* ─── Composición de gastos (donut + leyenda) ─── */
export function GraficoComposicionGastos({ valores, mesHasta, lineasPorCodigo }) {
  const data = useMemo(() => {
    if (!valores) return []
    const get = c => valores.get(c) ?? new Array(12).fill(0)
    const sumHasta = arr => { let s = 0; for (let i = 0; i < mesHasta; i++) s += arr[i] || 0; return s }
    const codigos = [
      'COSTO_NETO','REM_OPERACION','REM_VENTA','REM_ADMIN','REM_SOCIOS',
      'MARKETING','COMISION_GETNET','ARRIENDO','SERVICIOS_EXTERNOS','MOBILIARIO',
      'GASTOS_BANCARIOS','CUENTAS_BASICAS','GASTOS_TI','TRANSPORTE_VIATICOS','COMBUSTIBLE',
      'OTROS_GASTOS_ADMIN','FINIQUITOS',
    ]
    const items = codigos
      .map(c => ({ codigo: c, nombre: lineasPorCodigo?.get(c)?.nombre ?? c, valor: sumHasta(get(c)) }))
      .filter(x => x.valor > 0)
      .sort((a, b) => b.valor - a.valor)
    // Agrupar cola pequeña en "Otros"
    const top = items.slice(0, 8)
    const cola = items.slice(8)
    if (cola.length > 0) {
      top.push({ codigo: 'OTROS_AGRUPADOS', nombre: 'Otros (' + cola.length + ')', valor: cola.reduce((s, x) => s + x.valor, 0) })
    }
    return top
  }, [valores, mesHasta, lineasPorCodigo])

  const total = data.reduce((s, d) => s + d.valor, 0)
  const COLORS = ['#1F4E79','#7C3AED','#DC2626','#B45309','#15803D','#0891B2','#D97706','#6366F1','#9CA3AF']

  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 4, letterSpacing: '0.02em' }}>
        COMPOSICIÓN DE GASTOS (acumulado)
      </div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 10 }}>
        Top 8 líneas + resto agrupado. Total: {formato.clp(total)}
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ width: 180, height: 180, flexShrink: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="valor" nameKey="nombre" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={1}>
                {data.map((entry, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v, name) => [formato.clp(v) + ' (' + ((v / total) * 100).toFixed(1) + '%)', name]} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {data.map((d, i) => (
            <div key={d.codigo} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: COLORS[i % COLORS.length], flexShrink: 0 }} />
              <span style={{ flex: 1, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.nombre}</span>
              <span style={{ fontFamily: 'monospace', color: '#111827', fontWeight: 500 }}>
                {formato.clpCompacto(d.valor)}
              </span>
              <span style={{ fontSize: 10, color: '#6B7280', fontFamily: 'monospace', width: 38, textAlign: 'right' }}>
                {((d.valor / total) * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ─── Punto de equilibrio: VN promedio vs PE mensual ─── */
export function GraficoPuntoEquilibrio({ valores, mesHasta, peMensual }) {
  const data = useMemo(() => {
    if (!valores) return []
    const get = c => valores.get(c) ?? new Array(12).fill(0)
    return Array.from({ length: 12 }, (_, i) => ({
      mes: MESES[i],
      venta: i < mesHasta ? (get('VENTA_NETA')[i] || 0) : null,
    }))
  }, [valores, mesHasta])

  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 4, letterSpacing: '0.02em' }}>
        VENTA NETA vs PUNTO DE EQUILIBRIO
      </div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 10 }}>
        Línea roja = PE mensual ({formato.clp(peMensual || 0)}). Cada barra es venta neta del mes — barras debajo de la línea = mes en pérdida operacional.
      </div>
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid stroke="#F3F4F6" strokeDasharray="3 3" />
            <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => v >= 1e6 ? (v / 1e6).toFixed(0) + 'M' : v} />
            <Tooltip formatter={v => v !== null ? formato.clp(v) : '—'} />
            {peMensual && <ReferenceLine y={peMensual} stroke="#DC2626" strokeWidth={2} strokeDasharray="4 4" label={{ value: 'PE', position: 'right', fontSize: 10, fill: '#DC2626' }} />}
            <Bar dataKey="venta" name="Venta Neta">
              {data.map((d, i) => (
                <Cell key={i} fill={d.venta === null ? '#E5E7EB' : (peMensual && d.venta < peMensual ? '#DC2626' : '#15803D')} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* ─── Top líneas de gasto: tendencia stacked area ─── */
export function GraficoTopGastos({ valores, mesHasta, lineasPorCodigo }) {
  const { data, codigos } = useMemo(() => {
    if (!valores) return { data: [], codigos: [] }
    const get = c => valores.get(c) ?? new Array(12).fill(0)
    const sumHasta = arr => { let s = 0; for (let i = 0; i < mesHasta; i++) s += arr[i] || 0; return s }
    const todos = [
      'COSTO_NETO','REM_OPERACION','REM_VENTA','REM_ADMIN','REM_SOCIOS',
      'MARKETING','ARRIENDO','SERVICIOS_EXTERNOS','MOBILIARIO','GASTOS_BANCARIOS',
      'CUENTAS_BASICAS','GASTOS_TI','TRANSPORTE_VIATICOS','COMBUSTIBLE',
    ]
    const top5 = todos.map(c => ({ codigo: c, total: sumHasta(get(c)) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map(x => x.codigo)
    const data = Array.from({ length: 12 }, (_, i) => {
      const row = { mes: MESES[i] }
      top5.forEach(c => { row[c] = i < mesHasta ? (get(c)[i] || 0) : null })
      return row
    })
    return { data, codigos: top5 }
  }, [valores, mesHasta])

  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 4, letterSpacing: '0.02em' }}>
        TENDENCIA TOP 5 LÍNEAS DE GASTO
      </div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 10 }}>
        Mes a mes. Si una línea sube fuerte, conviene drillear esa partida.
      </div>
      <div style={{ height: 250 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid stroke="#F3F4F6" strokeDasharray="3 3" />
            <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => v >= 1e6 ? (v / 1e6).toFixed(0) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : v} />
            <Tooltip formatter={v => v !== null ? formato.clp(v) : '—'} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {codigos.map((c, i) => (
              <Line key={c} type="monotone" dataKey={c} name={lineasPorCodigo?.get(c)?.nombre ?? c} stroke={COLORES_LINEAS[i]} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
