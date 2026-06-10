import { useMemo } from 'react'
import { ComposedChart, Bar, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine, Area } from 'recharts'
import { TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react'

/* ═══ FORECAST DE PRESUPUESTO ═══
   Proyección a fin de año por run-rate (promedio últimos 3 meses con datos)
   vs presupuesto anual, con alertas dinámicas.
   Recibe filas + mesHasta desde FinPresupuesto, sin fetch propio.

   Metodología (declarada en UI):
   - Real YTD + (run-rate últimos 3 meses × meses restantes) = proyección año
   - vs presupuesto anual → desvío proyectado $ y %
   - Alertas: gasto proyectado >15% sobre presupuesto = crítica; 5-15% = atención
     venta proyectada <85% presupuesto = crítica; 85-95% = atención
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

function runRate(real, mesHasta) {
  // Promedio de los últimos 3 meses con datos (o los que haya)
  const n = Math.min(3, mesHasta)
  let s = 0, count = 0
  for (let i = mesHasta - n; i < mesHasta; i++) { s += real[i] || 0; count++ }
  return count > 0 ? s / count : 0
}

export function PresupuestoForecast({ filas, mesHasta, anio }) {
  const mesesRestantes = 12 - mesHasta

  const forecast = useMemo(() => {
    if (!filas || filas.length === 0) return []
    return filas
      .filter(f => !f.esSubtotal && f.codigo && !f.sinReal && !f.sinPresupuesto)
      .map(f => {
        const realYtd = sumHasta(f.real, mesHasta)
        const rr = runRate(f.real, mesHasta)
        const proyeccion = realYtd + rr * mesesRestantes
        const presAnual = sumHasta(f.pres, 12)
        const desvio = proyeccion - presAnual
        const desvioPct = presAnual > 0 ? (desvio / presAnual) * 100 : null
        const esIngreso = f.codigo.startsWith('VENTA')
        return { item: f.item, codigo: f.codigo, realYtd, rr, proyeccion, presAnual, desvio, desvioPct, esIngreso }
      })
      .filter(f => f.presAnual > 0 || f.realYtd > 0)
  }, [filas, mesHasta, mesesRestantes])

  /* ─── Alertas dinámicas ─── */
  const alertas = useMemo(() => {
    const out = []
    forecast.forEach(f => {
      if (f.desvioPct === null) return
      if (f.esIngreso) {
        const cumplProy = f.presAnual > 0 ? (f.proyeccion / f.presAnual) * 100 : null
        if (cumplProy !== null && cumplProy < 85) {
          out.push({ sev: 'critica', item: f.item, msg: 'Proyección al ' + cumplProy.toFixed(0) + '% del presupuesto anual (' + fmtM(f.proyeccion) + ' de ' + fmtM(f.presAnual) + '). A este ritmo no se alcanza la meta.' })
        } else if (cumplProy !== null && cumplProy < 95) {
          out.push({ sev: 'atencion', item: f.item, msg: 'Proyección al ' + cumplProy.toFixed(0) + '% del presupuesto anual. Falta ritmo para la meta.' })
        }
      } else {
        if (f.desvioPct > 15) {
          out.push({ sev: 'critica', item: f.item, msg: 'A este ritmo terminará ' + f.desvioPct.toFixed(0) + '% sobre presupuesto (' + fmtM(f.proyeccion) + ' vs ' + fmtM(f.presAnual) + '). Exceso proyectado: ' + fmtM(f.desvio) + '.' })
        } else if (f.desvioPct > 5) {
          out.push({ sev: 'atencion', item: f.item, msg: 'Proyectado ' + f.desvioPct.toFixed(0) + '% sobre presupuesto. Exceso estimado ' + fmtM(f.desvio) + '.' })
        }
      }
    })
    const orden = { critica: 0, atencion: 1 }
    out.sort((a, b) => orden[a.sev] - orden[b.sev])
    return out
  }, [forecast])

  /* ─── Chart venta: real + proyección vs presupuesto ─── */
  const ventaChart = useMemo(() => {
    const fila = filas.find(f => f.codigo === 'VENTA_NETA') || filas.find(f => f.codigo === 'VENTA_BRUTA')
    if (!fila) return []
    const rr = runRate(fila.real, mesHasta)
    return Array.from({ length: 12 }, (_, i) => ({
      mes: MESES[i],
      pres: fila.pres[i] || 0,
      real: i < mesHasta ? (fila.real[i] || 0) : null,
      proyectado: i >= mesHasta ? rr : (i === mesHasta - 1 ? (fila.real[i] || 0) : null),  // conectar línea
    }))
  }, [filas, mesHasta])

  const totales = useMemo(() => {
    const venta = forecast.find(f => f.codigo === 'VENTA_NETA') || forecast.find(f => f.codigo === 'VENTA_BRUTA')
    const gastos = forecast.filter(f => !f.esIngreso)
    const gastoProy = gastos.reduce((s, f) => s + f.proyeccion, 0)
    const gastoPres = gastos.reduce((s, f) => s + f.presAnual, 0)
    return { venta, gastoProy, gastoPres }
  }, [forecast])

  if (!filas || filas.length === 0) return <div style={{ fontSize: 13, color: '#9CA3AF', padding: 20 }}>Sin datos.</div>

  const ESTILO_SEV = {
    critica: { bg: '#FEF2F2', border: '#FECACA', icon: '🔴', color: '#B91C1C' },
    atencion: { bg: '#FFFBEB', border: '#FDE68A', icon: '🟡', color: '#B45309' },
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Metodología */}
      <div style={{ borderRadius: 8, border: '1px solid #BFDBFE', background: '#EFF6FF', padding: '10px 14px', fontSize: 11, color: '#1E40AF', lineHeight: 1.5 }}>
        <b>Metodología del forecast:</b> Real acumulado a {MESES[mesHasta - 1]} + run-rate (promedio últimos 3 meses) × {mesesRestantes} meses restantes = proyección a diciembre. Comparado contra presupuesto anual. Es proyección inercial — no considera estacionalidad ni decisiones futuras.
      </div>

      {/* KPIs de cierre proyectado */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
        {totales.venta && (
          <KpiForecast
            titulo={'Venta proyectada ' + anio}
            valor={fmtM(totales.venta.proyeccion)}
            comparacion={'vs presupuesto ' + fmtM(totales.venta.presAnual)}
            pct={totales.venta.presAnual > 0 ? (totales.venta.proyeccion / totales.venta.presAnual) * 100 : null}
            tipo="ingreso" />
        )}
        <KpiForecast
          titulo={'Gasto total proyectado ' + anio}
          valor={fmtM(totales.gastoProy)}
          comparacion={'vs presupuesto ' + fmtM(totales.gastoPres)}
          pct={totales.gastoPres > 0 ? (totales.gastoProy / totales.gastoPres) * 100 : null}
          tipo="gasto" />
        <div style={{ background: '#fff', borderRadius: 10, padding: '12px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #F3F4F6' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Alertas activas</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: '#B91C1C', fontFamily: 'monospace' }}>{alertas.filter(a => a.sev === 'critica').length}</span>
            <span style={{ fontSize: 11, color: '#6B7280' }}>críticas</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: '#B45309', fontFamily: 'monospace' }}>{alertas.filter(a => a.sev === 'atencion').length}</span>
            <span style={{ fontSize: 11, color: '#6B7280' }}>atención</span>
          </div>
        </div>
      </div>

      {/* Alertas dinámicas */}
      {alertas.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {alertas.map((a, i) => {
            const s = ESTILO_SEV[a.sev]
            return (
              <div key={i} style={{ background: s.bg, border: '1px solid ' + s.border, borderRadius: 8, padding: '9px 12px', display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 13 }}>{s.icon}</span>
                <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.4 }}>
                  <b style={{ color: s.color }}>{a.item}:</b> {a.msg}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ borderRadius: 8, border: '1px solid #A7F3D0', background: '#ECFDF5', padding: '10px 14px', fontSize: 12, color: '#047857', display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle2 size={15} /> Sin desvíos proyectados relevantes. El año viene alineado con presupuesto.
        </div>
      )}

      {/* Chart venta con proyección */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>VENTA: REAL + PROYECCIÓN vs PRESUPUESTO</div>
        <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 10 }}>Azul sólido = real. Morado punteado = proyección run-rate. Gris = presupuesto.</div>
        <div style={{ height: 270 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={ventaChart} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid stroke="#F3F4F6" strokeDasharray="3 3" />
              <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmtM(v)} />
              <Tooltip formatter={v => v !== null ? fmtCLP(v) : '—'} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="pres" fill="#E5E7EB" name="Presupuesto" />
              <Line type="monotone" dataKey="real" name="Real" stroke="#1F4E79" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
              <Line type="monotone" dataKey="proyectado" name="Proyección" stroke="#7C3AED" strokeWidth={2} strokeDasharray="6 4" dot={{ r: 2 }} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tabla de forecast por línea */}
      <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #F3F4F6', fontSize: 13, fontWeight: 700, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}>
          <TrendingUp size={15} color="#1F4E79" /> Proyección a diciembre por línea
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
                {['Línea','Real YTD','Run-rate /mes','Proyección año','Presupuesto año','Desvío proy.','%'].map((h, i) => (
                  <th key={h} style={{ padding: '8px 10px', fontSize: 10, fontWeight: 700, color: '#6B7280', background: '#F9FAFB', textAlign: i === 0 ? 'left' : 'right', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {forecast.sort((a, b) => Math.abs(b.desvio) - Math.abs(a.desvio)).map(f => {
                const malo = f.esIngreso ? f.desvio < 0 : f.desvio > 0
                const colorDesvio = Math.abs(f.desvioPct ?? 0) <= 5 ? '#6B7280' : malo ? '#DC2626' : '#15803D'
                return (
                  <tr key={f.codigo} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '7px 10px', fontSize: 12, fontWeight: 500, color: '#111827', whiteSpace: 'nowrap' }}>{f.item}</td>
                    <td style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'monospace', textAlign: 'right' }}>{fmtM(f.realYtd)}</td>
                    <td style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'monospace', textAlign: 'right', color: '#6B7280' }}>{fmtM(f.rr)}</td>
                    <td style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'monospace', textAlign: 'right', fontWeight: 700 }}>{fmtM(f.proyeccion)}</td>
                    <td style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'monospace', textAlign: 'right', color: '#6B7280' }}>{fmtM(f.presAnual)}</td>
                    <td style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'monospace', textAlign: 'right', fontWeight: 700, color: colorDesvio }}>{(f.desvio >= 0 ? '+' : '') + fmtM(f.desvio)}</td>
                    <td style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'monospace', textAlign: 'right', fontWeight: 700, color: colorDesvio }}>{f.desvioPct !== null ? (f.desvioPct >= 0 ? '+' : '') + f.desvioPct.toFixed(0) + '%' : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function KpiForecast({ titulo, valor, comparacion, pct, tipo }) {
  let color = '#6B7280'
  if (pct !== null) {
    if (tipo === 'ingreso') color = pct >= 95 ? '#047857' : pct >= 85 ? '#B45309' : '#DC2626'
    else color = pct <= 105 ? '#047857' : pct <= 115 ? '#B45309' : '#DC2626'
  }
  return (
    <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #F3F4F6' }}>
      <div style={{ height: 4, background: color }} />
      <div style={{ padding: '12px 14px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>{titulo}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 19, fontWeight: 700, fontFamily: 'monospace', color }}>{valor}</span>
          {pct !== null && <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: 'monospace' }}>{pct.toFixed(0)}%</span>}
        </div>
        <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>{comparacion}</div>
      </div>
    </div>
  )
}
