import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Wallet, Receipt, Percent, Banknote, AlertTriangle, FileWarning, Loader2 } from 'lucide-react'
import { supabase } from '../supabase'

const MES_NOMBRES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']

const fmtCLP = n => {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(n))
}
const fmtMillones = n => `$${Math.round(n / 1_000_000)}M`
const orDash = v => v == null || (typeof v === 'number' && !Number.isFinite(v)) ? '—' : String(v)

function KpiCard({ title, value, icon: Icon, hint, valueColor, badge, loading }) {
  const badgeColors = {
    red: { bg: '#FEE2E2', color: '#DC2626', border: '#FECACA' },
    amber: { bg: '#FEF3C7', color: '#D97706', border: '#FDE68A' },
    green: { bg: '#DCFCE7', color: '#16A34A', border: '#BBF7D0' },
  }
  const bc = badge ? badgeColors[badge.tone] ?? badgeColors.green : null

  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #F3F4F6' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9CA3AF', marginBottom: 6 }}>{title}</div>
          {loading ? (
            <div style={{ height: 32, width: 120, background: '#F3F4F6', borderRadius: 6, marginTop: 8, animation: 'pulse 1.5s infinite' }} />
          ) : (
            <div style={{ fontSize: 24, fontWeight: 700, color: valueColor ?? '#111827', marginTop: 4 }}>{value}</div>
          )}
          {hint && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>{hint}</div>}
          {badge && !loading && bc && (
            <span style={{ display: 'inline-block', marginTop: 6, padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', background: bc.bg, color: bc.color, border: `1px solid ${bc.border}` }}>
              {badge.text}
            </span>
          )}
        </div>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 12 }}>
          <Icon size={18} style={{ color: '#1F4E79' }} />
        </div>
      </div>
    </div>
  )
}

function SectionError({ message }) {
  return (
    <div style={{ borderRadius: 8, border: '1px solid #FECACA', background: '#FEF2F2', padding: '10px 14px', fontSize: 13, color: '#DC2626' }}>
      {message}
    </div>
  )
}

export function FinDashboard({ cu, isMobile }) {
  const now = new Date()
  const mesActual = now.getMonth() + 1
  const anioActual = now.getFullYear()

  const [loading, setLoading] = useState({ f1: true, f2: true, f3: true, f4: true, f5: true, f6: true, f7: true })
  const [errors, setErrors] = useState({})
  const [f1, setF1] = useState(null)
  const [f2, setF2] = useState([])
  const [f3, setF3] = useState([])
  const [f4, setF4] = useState(null)
  const [f5, setF5] = useState([])
  const [f6, setF6] = useState(null)
  const [f7, setF7] = useState([])

  useEffect(() => {
    const setErr = (k, msg) => setErrors(e => ({ ...e, [k]: msg }))
    const setLoad = (k, v) => setLoading(s => ({ ...s, [k]: v }))

    const monthStart = (y, m) => `${y}-${String(m).padStart(2, '0')}-01`
    const nextMonthStart = (y, m) => m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
    const yearStart = y => `${y}-01-01`

    const runF1 = async () => {
      const { data, error } = await supabase.from('libro_compras').select('monto_neto,monto_iva,monto_total,anulado,fecha_emision').gte('fecha_emision', monthStart(anioActual, mesActual)).lt('fecha_emision', nextMonthStart(anioActual, mesActual))
      if (error) { setErr('f1', error.message); setLoad('f1', false); return }
      const rows = (data ?? []).filter(r => r.anulado !== true)
      setF1({ facturas: rows.length, gasto_neto: rows.reduce((a, r) => a + Number(r.monto_neto ?? 0), 0), gasto_iva: rows.reduce((a, r) => a + Number(r.monto_iva ?? 0), 0), gasto_total: rows.reduce((a, r) => a + Number(r.monto_total ?? 0), 0) })
      setLoad('f1', false)
    }

    const runF2 = async () => {
      const [vRes, gRes] = await Promise.all([
        supabase.from('ventas_bsale').select('fecha,mes,total_venta').gte('fecha', yearStart(2026)).lt('fecha', yearStart(2027)),
        supabase.from('libro_compras').select('fecha_emision,monto_total,anulado').gte('fecha_emision', yearStart(2026)).lt('fecha_emision', yearStart(2027)),
      ])
      if (vRes.error) { setErr('f2', vRes.error.message); setLoad('f2', false); return }
      if (gRes.error) { setErr('f2', gRes.error.message); setLoad('f2', false); return }
      const ventasMap = new Map()
      for (const r of vRes.data ?? []) {
        const m = new Date(r.fecha).getMonth() + 1
        const cur = ventasMap.get(m) ?? { mes: r.mes ?? MES_NOMBRES[m - 1], venta_total: 0 }
        cur.venta_total += Number(r.total_venta ?? 0)
        ventasMap.set(m, cur)
      }
      const gastosMap = new Map()
      for (const r of gRes.data ?? []) {
        if (r.anulado === true) continue
        const m = new Date(r.fecha_emision).getMonth() + 1
        gastosMap.set(m, (gastosMap.get(m) ?? 0) + Number(r.monto_total ?? 0))
      }
      const allMeses = new Set([...ventasMap.keys(), ...gastosMap.keys()])
      const rows = Array.from(allMeses).sort((a, b) => a - b).map(m => {
        const v = ventasMap.get(m)?.venta_total ?? 0
        const g = gastosMap.get(m) ?? 0
        const mb = v - g
        return { mes_num: m, mes: ventasMap.get(m)?.mes ?? MES_NOMBRES[m - 1], venta_total: v, gasto_total: g, margen_bruto: mb, margen_pct: v > 0 ? Math.round((mb / v) * 1000) / 10 : 0 }
      })
      setF2(rows); setLoad('f2', false)
    }

    const runF3 = async () => {
      const { data, error } = await supabase.from('movimientos_bancarios').select('mes_cartola,tipo,monto').not('mes_cartola', 'is', null)
      if (error) { setErr('f3', error.message); setLoad('f3', false); return }
      const map = new Map()
      for (const r of data ?? []) {
        const m = Number(r.mes_cartola)
        if (!Number.isFinite(m)) continue
        const cur = map.get(m) ?? { mes_num: m, total_abonos: 0, total_cargos: 0, flujo_neto: 0 }
        const monto = Number(r.monto ?? 0)
        if (r.tipo === 'ABONO') cur.total_abonos += monto
        if (r.tipo === 'CARGO') cur.total_cargos += Math.abs(monto)
        cur.flujo_neto += monto
        map.set(m, cur)
      }
      setF3(Array.from(map.values()).sort((a, b) => a.mes_num - b.mes_num)); setLoad('f3', false)
    }

    const runF4 = async () => {
      const { data, error } = await supabase.from('movimientos_bancarios').select('subcuenta_id,tipo,monto,estado').eq('estado', 'pendiente')
      if (error) { setErr('f4', error.message); setLoad('f4', false); return }
      const rows = data ?? []
      const total = rows.length
      const clasif = rows.filter(r => r.subcuenta_id != null).length
      const sinClas = total - clasif
      setF4({ total_movimientos: total, clasificados: clasif, sin_clasificar: sinClas, pct_sin_clasificar: total > 0 ? Math.round((sinClas / total) * 1000) / 10 : 0, monto_cargos_sin_clasificar: rows.filter(r => r.subcuenta_id == null && r.tipo === 'CARGO').reduce((a, r) => a + Math.abs(Number(r.monto ?? 0)), 0), monto_abonos_sin_clasificar: rows.filter(r => r.subcuenta_id == null && r.tipo === 'ABONO').reduce((a, r) => a + Number(r.monto ?? 0), 0) })
      setLoad('f4', false)
    }

    const runF5 = async () => {
      const { data, error } = await supabase.from('libro_compras').select('razon_social,monto_total,anulado,fecha_emision').gte('fecha_emision', monthStart(anioActual, mesActual)).lt('fecha_emision', nextMonthStart(anioActual, mesActual))
      if (error) { setErr('f5', error.message); setLoad('f5', false); return }
      const rows = (data ?? []).filter(r => r.anulado !== true)
      const total = rows.reduce((a, r) => a + Number(r.monto_total ?? 0), 0)
      const map = new Map()
      for (const r of rows) { const k = r.razon_social ?? '—'; const cur = map.get(k) ?? { razon_social: k, facturas: 0, gasto_total: 0 }; cur.facturas += 1; cur.gasto_total += Number(r.monto_total ?? 0); map.set(k, cur) }
      setF5(Array.from(map.values()).sort((a, b) => b.gasto_total - a.gasto_total).slice(0, 5).map(x => ({ ...x, pct_del_total: total > 0 ? Math.round((x.gasto_total / total) * 1000) / 10 : 0 })))
      setLoad('f5', false)
    }

    const runF6 = async () => {
      const { data, error } = await supabase.from('libro_compras').select('movimiento_id,monto_total,anulado,fecha_emision').gte('fecha_emision', yearStart(anioActual)).lt('fecha_emision', yearStart(anioActual + 1))
      if (error) { setErr('f6', error.message); setLoad('f6', false); return }
      const rows = (data ?? []).filter(r => r.anulado !== true)
      const total = rows.length; const conc = rows.filter(r => r.movimiento_id != null).length; const sin = total - conc
      setF6({ total_facturas: total, sin_conciliar: sin, conciliadas: conc, pct_conciliado: total > 0 ? Math.round((conc / total) * 1000) / 10 : 0, monto_pendiente: rows.filter(r => r.movimiento_id == null).reduce((a, r) => a + Number(r.monto_total ?? 0), 0) })
      setLoad('f6', false)
    }

    const runF7 = async () => {
      const { data, error } = await supabase.from('libro_compras').select('fecha_emision,monto_total,anulado').gte('fecha_emision', '2024-01-01').lt('fecha_emision', '2027-01-01')
      if (error) { setErr('f7', error.message); setLoad('f7', false); return }
      const rows = (data ?? []).filter(r => r.anulado !== true)
      const map = new Map()
      for (const r of rows) {
        const d = new Date(r.fecha_emision); const y = d.getFullYear(); const m = d.getMonth() + 1
        const cur = map.get(m) ?? { mes_num: m, gasto_2024: 0, gasto_2025: 0, gasto_2026: 0 }
        const v = Number(r.monto_total ?? 0)
        if (y === 2024) cur.gasto_2024 += v; else if (y === 2025) cur.gasto_2025 += v; else if (y === 2026) cur.gasto_2026 += v
        map.set(m, cur)
      }
      setF7(Array.from(map.values()).sort((a, b) => a.mes_num - b.mes_num)); setLoad('f7', false)
    }

    Promise.all([runF1(), runF2(), runF3(), runF4(), runF5(), runF6(), runF7()])
  }, [mesActual, anioActual])

  const margenMesActual = useMemo(() => f2.find(r => r.mes_num === mesActual) ?? null, [f2, mesActual])
  const flujoMesActual = useMemo(() => f3.find(r => r.mes_num === mesActual) ?? null, [f3, mesActual])
  const f7Filtrado = useMemo(() => f7.filter(r => r.mes_num >= 1 && r.mes_num <= 4), [f7])

  const margenColor = !margenMesActual ? '#111827' : margenMesActual.margen_pct >= 60 ? '#16A34A' : margenMesActual.margen_pct >= 45 ? '#D97706' : '#DC2626'
  const flujoColor = !flujoMesActual ? '#111827' : flujoMesActual.flujo_neto >= 0 ? '#16A34A' : '#DC2626'

  const sinClasBadge = !f4 ? undefined : f4.pct_sin_clasificar === 100 ? { text: '100% pendiente', tone: 'red' } : f4.pct_sin_clasificar > 50 ? { text: `${f4.pct_sin_clasificar}% pendiente`, tone: 'amber' } : { text: `${f4.pct_sin_clasificar}% pendiente`, tone: 'green' }
  const concBadge = !f6 ? undefined : f6.pct_conciliado === 0 ? { text: '0% conciliado', tone: 'red' } : f6.pct_conciliado < 50 ? { text: `${f6.pct_conciliado}% conciliado`, tone: 'amber' } : { text: `${f6.pct_conciliado}% conciliado`, tone: 'green' }

  const TH = { padding: '8px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #F3F4F6' }
  const TD = { padding: '8px', fontSize: 13, color: '#374151', borderBottom: '1px solid #F3F4F6' }
  const cardSt = { background: '#fff', borderRadius: 10, padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #F3F4F6' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 8 }}>
        <div style={{ flex: 1, height: 1, background: '#E5E7EB' }} />
        <span style={{ padding: '4px 12px', borderRadius: 99, border: '1px solid #BFDBFE', background: '#EFF6FF', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#1F4E79' }}>
          Indicadores financieros
        </span>
        <div style={{ flex: 1, height: 1, background: '#E5E7EB' }} />
      </div>

      {/* Errores KPIs */}
      {(errors.f1 || errors.f4 || errors.f6) && (
        <SectionError message={`Error cargando KPIs financieros: ${errors.f1 ?? errors.f4 ?? errors.f6}`} />
      )}

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <KpiCard title="Gasto del mes" value={fmtCLP(f1?.gasto_total)} icon={Wallet} hint={f1 ? `${orDash(f1.facturas)} facturas` : undefined} loading={loading.f1} />
        <KpiCard title="Gasto neto (sin IVA)" value={fmtCLP(f1?.gasto_neto)} icon={Receipt} hint={f1 ? `IVA: ${fmtCLP(f1.gasto_iva)}` : undefined} loading={loading.f1} />
        <KpiCard title="Margen bruto est." value={margenMesActual ? `${margenMesActual.margen_pct.toFixed(1)}%` : '—'} icon={Percent} valueColor={margenColor} loading={loading.f2} />
        <KpiCard title="Flujo bancario neto" value={fmtCLP(flujoMesActual?.flujo_neto)} icon={Banknote} valueColor={flujoColor} loading={loading.f3} />
        <KpiCard title="Sin clasificar" value={f4 ? new Intl.NumberFormat('es-CL').format(f4.sin_clasificar) : '—'} icon={AlertTriangle} badge={sinClasBadge} loading={loading.f4} />
        <KpiCard title="Fact. sin conciliar" value={f6 ? new Intl.NumberFormat('es-CL').format(f6.sin_conciliar) : '—'} icon={FileWarning} hint={f6 ? `Expuesto: ${fmtCLP(f6.monto_pendiente)}` : undefined} badge={concBadge} loading={loading.f6} />
      </div>

      {/* Gráfico margen bruto */}
      <div style={cardSt}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Venta vs gasto vs margen bruto · 2026</div>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9CA3AF' }}>en CLP</div>
        </div>
        {errors.f2 ? <SectionError message={`Error: ${errors.f2}`} /> :
          loading.f2 ? <div style={{ height: 320, background: '#F9FAFB', borderRadius: 8 }} /> :
          f2.length === 0 ? <div style={{ padding: '40px 0', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Sin datos</div> : (
          <div style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={f2}>
                <CartesianGrid stroke="#F3F4F6" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="mes" stroke="#9CA3AF" fontSize={11} />
                <YAxis stroke="#9CA3AF" fontSize={11} tickFormatter={v => fmtMillones(Number(v))} />
                <Tooltip
                  cursor={{ fill: 'rgba(59,130,246,0.08)' }}
                  contentStyle={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 12 }}
                  formatter={(value, name, item) => {
                    if (name === 'Margen bruto') { const pct = item?.payload?.margen_pct; return [`${fmtCLP(value)} (${pct != null ? pct.toFixed(1) : '—'}%)`, name] }
                    return [fmtCLP(value), name]
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="venta_total" name="Venta" fill="#378ADD" radius={[4, 4, 0, 0]} />
                <Bar dataKey="gasto_total" name="Gasto" fill="#D85A30" radius={[4, 4, 0, 0]} />
                <Bar dataKey="margen_bruto" name="Margen bruto" fill="#639922" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Top proveedores + Flujo bancario */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Top proveedores */}
        <div style={cardSt}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 14 }}>Top 5 proveedores — mes actual</div>
          {errors.f5 ? <SectionError message={`Error: ${errors.f5}`} /> :
            loading.f5 ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Array.from({ length: 5 }).map((_, i) => <div key={i} style={{ height: 48, background: '#F3F4F6', borderRadius: 8 }} />)}</div> :
            f5.length === 0 ? <div style={{ padding: '32px 0', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Sin datos</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {f5.map(p => (
                <div key={p.razon_social} style={{ border: '1px solid #F3F4F6', borderRadius: 8, padding: '10px 12px', background: '#FAFAFA' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.razon_social}>{p.razon_social}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', flexShrink: 0 }}>{fmtCLP(p.gasto_total)}</div>
                  </div>
                  <div style={{ marginTop: 8, height: 6, background: '#E5E7EB', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, p.pct_del_total))}%`, background: '#1F4E79', borderRadius: 99 }} />
                  </div>
                  <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9CA3AF' }}>
                    <span>{p.facturas} facturas</span>
                    <span>{p.pct_del_total.toFixed(1)}% del total</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Flujo bancario */}
        <div style={cardSt}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 14 }}>Flujo bancario mensual</div>
          {errors.f3 ? <SectionError message={`Error: ${errors.f3}`} /> :
            loading.f3 ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Array.from({ length: 6 }).map((_, i) => <div key={i} style={{ height: 36, background: '#F3F4F6', borderRadius: 8 }} />)}</div> :
            f3.length === 0 ? <div style={{ padding: '32px 0', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Sin datos</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={TH}>Mes</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Abonos</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Cargos</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Flujo neto</th>
                  </tr>
                </thead>
                <tbody>
                  {f3.map(r => {
                    const positivo = r.flujo_neto >= 0
                    const esActual = r.mes_num === mesActual
                    return (
                      <tr key={r.mes_num} style={{ background: esActual ? '#EFF6FF' : 'transparent' }}>
                        <td style={{ ...TD, fontWeight: 500 }}>{MES_NOMBRES[r.mes_num - 1] ?? `Mes ${r.mes_num}`}</td>
                        <td style={{ ...TD, textAlign: 'right', color: '#16A34A' }}>{fmtCLP(r.total_abonos)}</td>
                        <td style={{ ...TD, textAlign: 'right', color: '#DC2626' }}>{fmtCLP(r.total_cargos)}</td>
                        <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: positivo ? '#16A34A' : '#DC2626' }}>{fmtCLP(r.flujo_neto)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Comparativa YoY */}
      <div style={cardSt}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 14 }}>Comparativa gasto compras año a año</div>
        {errors.f7 ? <SectionError message={`Error: ${errors.f7}`} /> :
          loading.f7 ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Array.from({ length: 4 }).map((_, i) => <div key={i} style={{ height: 36, background: '#F3F4F6', borderRadius: 8 }} />)}</div> :
          f7Filtrado.length === 0 ? <div style={{ padding: '32px 0', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Sin datos</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={TH}>Mes</th>
                  <th style={{ ...TH, textAlign: 'right' }}>2024</th>
                  <th style={{ ...TH, textAlign: 'right' }}>2025</th>
                  <th style={{ ...TH, textAlign: 'right' }}>2026</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Var % 26 vs 25</th>
                </tr>
              </thead>
              <tbody>
                {f7Filtrado.map(r => {
                  const varPct = r.gasto_2025 > 0 ? ((r.gasto_2026 - r.gasto_2025) / r.gasto_2025) * 100 : null
                  const varColor = varPct == null ? '#9CA3AF' : varPct < 0 ? '#16A34A' : varPct <= 15 ? '#D97706' : '#DC2626'
                  return (
                    <tr key={r.mes_num}>
                      <td style={{ ...TD, fontWeight: 500 }}>{MES_NOMBRES[r.mes_num - 1] ?? `Mes ${r.mes_num}`}</td>
                      <td style={{ ...TD, textAlign: 'right', color: '#9CA3AF' }}>{fmtCLP(r.gasto_2024)}</td>
                      <td style={{ ...TD, textAlign: 'right', color: '#9CA3AF' }}>{fmtCLP(r.gasto_2025)}</td>
                      <td style={{ ...TD, textAlign: 'right', fontWeight: 600 }}>{fmtCLP(r.gasto_2026)}</td>
                      <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: varColor }}>
                        {varPct == null ? '—' : `${varPct >= 0 ? '+' : ''}${varPct.toFixed(1)}%`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
