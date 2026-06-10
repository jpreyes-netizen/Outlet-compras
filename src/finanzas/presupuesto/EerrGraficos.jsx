import { useState, useEffect, useMemo } from 'react'
import { BarChart, Bar, LineChart, Line, ComposedChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend, Cell, ReferenceLine } from 'recharts'
import { fetchEerrCompleto } from '../analisis/eerr_fetch'

/* ═══ EERR GRÁFICOS ═══
   Vista 100% visual del Estado de Resultados:
   1. Waterfall del período (VN → MC → Res Op)
   2. Resultado operacional mensual (+/-)
   3. Heatmap línea × mes de gastos
   4. Estructura del gasto mes a mes (% sobre VN)
*/

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const ANIOS = [2024, 2025, 2026]
const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)
const fmtM = n => {
  const abs = Math.abs(n || 0)
  if (abs >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'MM'
  if (abs >= 1e6) return '$' + (n / 1e6).toFixed(0) + 'M'
  return fmtCLP(n)
}

const GASTOS_OP = ['REM_OPERACION','REM_VENTA','REM_ADMIN','REM_SOCIOS','MARKETING','COMISION_GETNET','GASTOS_BANCARIOS','MOBILIARIO','SERVICIOS_EXTERNOS','ARRIENDO','CUENTAS_BASICAS','COMBUSTIBLE','FINIQUITOS','GASTOS_TI','OTROS_GASTOS_ADMIN','TRANSPORTE_VIATICOS']

export function EerrGraficos() {
  const [anio, setAnio] = useState(2026)
  const [mesHasta, setMesHasta] = useState(new Date().getMonth() + 1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true); setError(null)
    fetchEerrCompleto(anio).then(setData).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [anio])

  const selectSt = { padding: '6px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 12, background: '#fff' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }}>Año</label>
          <select style={selectSt} value={String(anio)} onChange={e => setAnio(Number(e.target.value))}>
            {ANIOS.map(a => <option key={a} value={String(a)}>{a}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }}>Acumulado hasta</label>
          <select style={selectSt} value={String(mesHasta)} onChange={e => setMesHasta(Number(e.target.value))}>
            {MESES.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
          </select>
        </div>
      </div>

      {error && <div style={{ borderRadius: 8, border: '1px solid #FECACA', background: '#FEF2F2', padding: '10px 14px', fontSize: 13, color: '#DC2626' }}>Error: {error}</div>}
      {loading && <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{Array.from({ length: 4 }).map((_, i) => <div key={i} style={{ height: 220, background: '#F3F4F6', borderRadius: 8 }} />)}</div>}

      {!loading && data && (
        <>
          <WaterfallEerr valores={data.valores} mesHasta={mesHasta} />
          <ResultadoMensual valores={data.valores} mesHasta={mesHasta} />
          <HeatmapGastos valores={data.valores} mesHasta={mesHasta} lineasPorCodigo={data.lineasPorCodigo} />
          <EstructuraMensual valores={data.valores} mesHasta={mesHasta} />
        </>
      )}
    </div>
  )
}

/* ─── 1. Waterfall: VN → -Costo → MC → -GV → -GOp → ResOp ─── */
function WaterfallEerr({ valores, mesHasta }) {
  const data = useMemo(() => {
    const get = c => valores.get(c) ?? new Array(12).fill(0)
    const sum = c => { let s = 0; for (let i = 0; i < mesHasta; i++) s += get(c)[i] || 0; return s }
    const vn = sum('VENTA_NETA')
    const costo = sum('COSTO_NETO')
    const mc = vn - costo
    const gv = sum('TOTAL_GASTO_VENTA') + sum('TOTAL_GASTO_OPER')
    const gop = sum('TOTAL_GASTO_OPERATIVO')
    const resOp = mc - gv - gop
    // Waterfall con base invisible
    return [
      { name: 'Venta Neta', base: 0, valor: vn, color: '#1F4E79', total: vn },
      { name: 'Costo Ventas', base: vn - costo, valor: costo, color: '#FB923C', total: -costo },
      { name: 'Margen Contrib.', base: 0, valor: mc, color: '#0891B2', total: mc },
      { name: 'G. Venta+Oper.', base: mc - gv, valor: gv, color: '#DC2626', total: -gv },
      { name: 'G. Operativos', base: mc - gv - gop, valor: gop, color: '#B91C1C', total: -gop },
      { name: 'Resultado Op.', base: resOp < 0 ? resOp : 0, valor: Math.abs(resOp), color: resOp >= 0 ? '#15803D' : '#DC2626', total: resOp },
    ]
  }, [valores, mesHasta])

  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>CASCADA DEL EERR (acumulado a {MESES[mesHasta - 1]})</div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 10 }}>Cómo la venta neta se convierte en resultado operacional, paso a paso.</div>
      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 20, right: 20, bottom: 5, left: 10 }}>
            <CartesianGrid stroke="#F3F4F6" strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmtM(v)} />
            <Tooltip formatter={(v, name, props) => [fmtCLP(props.payload.total), props.payload.name]} />
            <ReferenceLine y={0} stroke="#9CA3AF" />
            <Bar dataKey="base" stackId="wf" fill="transparent" />
            <Bar dataKey="valor" stackId="wf">
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8, justifyContent: 'center' }}>
        {data.map(d => (
          <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: d.color }} />
            <span style={{ color: '#6B7280' }}>{d.name}:</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 600, color: d.total < 0 ? '#DC2626' : '#111827' }}>{fmtM(d.total)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── 2. Resultado operacional mensual ─── */
function ResultadoMensual({ valores, mesHasta }) {
  const data = useMemo(() => {
    const get = c => valores.get(c) ?? new Array(12).fill(0)
    return Array.from({ length: 12 }, (_, i) => ({
      mes: MESES[i],
      resOp: i < mesHasta ? (get('RESULTADO_OPERACIONAL')[i] || 0) : null,
      margenPct: i < mesHasta && get('VENTA_NETA')[i] > 0 ? (get('RESULTADO_OPERACIONAL')[i] / get('VENTA_NETA')[i]) * 100 : null,
    }))
  }, [valores, mesHasta])

  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>RESULTADO OPERACIONAL MES A MES</div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 10 }}>Barras = $ resultado. Línea = % margen operacional del mes.</div>
      <div style={{ height: 250 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 40, bottom: 5, left: 10 }}>
            <CartesianGrid stroke="#F3F4F6" strokeDasharray="3 3" />
            <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="izq" tick={{ fontSize: 10 }} tickFormatter={v => fmtM(v)} />
            <YAxis yAxisId="der" orientation="right" tick={{ fontSize: 10 }} tickFormatter={v => v + '%'} />
            <Tooltip formatter={(v, name) => name === '% Margen Op' ? (v !== null ? v.toFixed(1) + '%' : '—') : (v !== null ? fmtCLP(v) : '—')} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine yAxisId="izq" y={0} stroke="#9CA3AF" />
            <Bar yAxisId="izq" dataKey="resOp" name="Resultado Op.">
              {data.map((d, i) => <Cell key={i} fill={d.resOp === null ? '#E5E7EB' : d.resOp >= 0 ? '#15803D' : '#DC2626'} />)}
            </Bar>
            <Line yAxisId="der" type="monotone" dataKey="margenPct" name="% Margen Op" stroke="#7C3AED" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* ─── 3. Heatmap línea × mes ─── */
function HeatmapGastos({ valores, mesHasta, lineasPorCodigo }) {
  const filas = useMemo(() => {
    const get = c => valores.get(c) ?? new Array(12).fill(0)
    return GASTOS_OP
      .map(c => {
        const arr = get(c)
        let total = 0; for (let i = 0; i < mesHasta; i++) total += arr[i] || 0
        return { codigo: c, nombre: lineasPorCodigo?.get(c)?.nombre ?? c, arr, total }
      })
      .filter(f => f.total > 0)
      .sort((a, b) => b.total - a.total)
  }, [valores, mesHasta, lineasPorCodigo])

  const maxVal = useMemo(() => {
    let mx = 0
    filas.forEach(f => { for (let i = 0; i < mesHasta; i++) mx = Math.max(mx, f.arr[i] || 0) })
    return mx || 1
  }, [filas, mesHasta])

  const celda = (v) => {
    if (!v) return { bg: '#FAFAFA', txt: '#D1D5DB' }
    const t = Math.min(1, v / maxVal)
    // De azul claro a rojo intenso
    const r = Math.round(254 - t * 30)
    const g = Math.round(243 - t * 180)
    const b = Math.round(242 - t * 200)
    return { bg: `rgb(${r},${g},${b})`, txt: t > 0.55 ? '#7F1D1D' : '#374151' }
  }

  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflowX: 'auto' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>MAPA DE CALOR — GASTOS POR LÍNEA Y MES</div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 10 }}>Más rojo = más gasto. Detecta visualmente picos inusuales por línea.</div>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 700 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', fontSize: 10, fontWeight: 600, color: '#6B7280', padding: '4px 8px' }}>Línea</th>
            {MESES.slice(0, mesHasta).map(m => <th key={m} style={{ fontSize: 10, fontWeight: 600, color: '#6B7280', padding: '4px 4px', textAlign: 'center' }}>{m}</th>)}
            <th style={{ fontSize: 10, fontWeight: 700, color: '#374151', padding: '4px 8px', textAlign: 'right' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(f => (
            <tr key={f.codigo}>
              <td style={{ fontSize: 11, color: '#111827', padding: '3px 8px', whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.nombre}</td>
              {MESES.slice(0, mesHasta).map((m, i) => {
                const v = f.arr[i] || 0
                const c = celda(v)
                return (
                  <td key={m} title={fmtCLP(v)} style={{ background: c.bg, color: c.txt, fontSize: 9, fontFamily: 'monospace', textAlign: 'center', padding: '4px 2px', borderRadius: 2, minWidth: 48 }}>
                    {v > 0 ? fmtM(v).replace('$', '') : '·'}
                  </td>
                )
              })}
              <td style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, color: '#111827', textAlign: 'right', padding: '3px 8px', whiteSpace: 'nowrap' }}>{fmtM(f.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ─── 4. Estructura del gasto como % de VN mes a mes (stacked) ─── */
function EstructuraMensual({ valores, mesHasta }) {
  const GRUPOS = [
    { k: 'costo', l: 'Costo Ventas', codes: ['COSTO_NETO'], color: '#FB923C' },
    { k: 'rem', l: 'Remuneraciones', codes: ['REM_OPERACION','REM_VENTA','REM_ADMIN','REM_SOCIOS'], color: '#7C3AED' },
    { k: 'arriendo', l: 'Arriendo', codes: ['ARRIENDO'], color: '#0891B2' },
    { k: 'mkt', l: 'Marketing+Comis.', codes: ['MARKETING','COMISION_GETNET'], color: '#D97706' },
    { k: 'otros', l: 'Otros gastos', codes: ['GASTOS_BANCARIOS','MOBILIARIO','SERVICIOS_EXTERNOS','CUENTAS_BASICAS','COMBUSTIBLE','FINIQUITOS','GASTOS_TI','OTROS_GASTOS_ADMIN','TRANSPORTE_VIATICOS'], color: '#9CA3AF' },
    { k: 'resOp', l: 'Resultado Op.', codes: null, color: '#15803D' },
  ]
  const data = useMemo(() => {
    const get = c => valores.get(c) ?? new Array(12).fill(0)
    return Array.from({ length: mesHasta }, (_, i) => {
      const vn = get('VENTA_NETA')[i] || 0
      const row = { mes: MESES[i] }
      if (vn <= 0) { GRUPOS.forEach(g => row[g.k] = 0); return row }
      let acumPct = 0
      GRUPOS.forEach(g => {
        if (g.codes) {
          const monto = g.codes.reduce((s, c) => s + (get(c)[i] || 0), 0)
          const pct = (monto / vn) * 100
          row[g.k] = Math.max(0, pct)
          acumPct += pct
        }
      })
      row.resOp = Math.max(0, 100 - acumPct)
      return row
    })
  }, [valores, mesHasta])

  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>ESTRUCTURA DEL GASTO (% de la Venta Neta)</div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 10 }}>Cada barra suma 100% de la VN del mes. El verde (resultado) debería mantenerse o crecer.</div>
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid stroke="#F3F4F6" strokeDasharray="3 3" />
            <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => v + '%'} domain={[0, 100]} />
            <Tooltip formatter={(v, name) => [v.toFixed(1) + '%', name]} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {GRUPOS.map(g => (
              <Bar key={g.k} dataKey={g.k} stackId="est" fill={g.color} name={g.l} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
