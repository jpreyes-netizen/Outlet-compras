import { useEffect, useState, useMemo } from 'react'
import { toast } from 'sonner'
import { Loader2, FileText, CheckCircle, Clock, AlertCircle, TrendingUp } from 'lucide-react'
import { supabase } from '../../supabase'

const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n ?? 0)
const fmtNum = n => new Intl.NumberFormat('es-CL').format(n ?? 0)
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

// ════════════════════════════════════════════════════════════════════════
// DASHBOARD LIBRO DE COMPRAS 2026
// Resumen de facturas: conciliadas / parciales / sin conciliar, por monto y mes.
// ════════════════════════════════════════════════════════════════════════
export function DashboardComprasTab() {
  const [loading, setLoading] = useState(true)
  const [facturas, setFacturas] = useState([])

  useEffect(() => {
    setLoading(true)
    ;(async () => {
      try {
        // Traer facturas 2026 con su estado de conciliación (límite alto explícito)
        const { data: lc, error } = await supabase
          .from('libro_compras')
          .select('id, fecha_emision, razon_social, rut_proveedor, monto_total, anulado')
          .gte('fecha_emision', '2026-01-01')
          .eq('anulado', false)
          .limit(20000)
        if (error) throw error

        const ids = (lc ?? []).map(f => f.id)
        // Estado de cada factura desde la vista
        const estadoMap = new Map()
        // En lotes para no exceder URL (la vista puede traer todo de una si filtramos por fecha)
        const { data: est } = await supabase
          .from('v_estado_factura')
          .select('factura_id, total_pagado, saldo, estado_factura')
          .limit(20000)
        ;(est ?? []).forEach(e => estadoMap.set(e.factura_id, e))

        const enriquecidas = (lc ?? []).map(f => {
          const e = estadoMap.get(f.id)
          return {
            ...f,
            monto_total: Number(f.monto_total) || 0,
            saldo: Number(e?.saldo ?? f.monto_total) || 0,
            total_pagado: Number(e?.total_pagado) || 0,
            estado_factura: e?.estado_factura ?? 'sin_pagar',
            mes: Number((f.fecha_emision || '').split('-')[1]) - 1,
          }
        })
        setFacturas(enriquecidas)
      } catch (e) {
        toast.error('Error cargando dashboard: ' + e.message)
      } finally { setLoading(false) }
    })()
  }, [])

  const resumen = useMemo(() => {
    const r = {
      total: facturas.length, montoTotal: 0,
      conciliadas: 0, montoConciliado: 0,
      parciales: 0, montoParcialPagado: 0, saldoParcial: 0,
      sinConciliar: 0, montoSinConciliar: 0,
    }
    for (const f of facturas) {
      r.montoTotal += f.monto_total
      if (f.estado_factura === 'pagada') { r.conciliadas++; r.montoConciliado += f.monto_total }
      else if (f.estado_factura === 'parcial') { r.parciales++; r.montoParcialPagado += f.total_pagado; r.saldoParcial += f.saldo }
      else { r.sinConciliar++; r.montoSinConciliar += f.monto_total }
    }
    r.pctConciliado = r.montoTotal > 0 ? Math.round((r.montoConciliado / r.montoTotal) * 100) : 0
    r.pendienteTotal = r.montoSinConciliar + r.saldoParcial
    return r
  }, [facturas])

  // Top proveedores con más saldo pendiente
  const topPendientes = useMemo(() => {
    const m = new Map()
    for (const f of facturas) {
      if (f.estado_factura === 'pagada') continue
      const key = f.razon_social || '(sin nombre)'
      const prev = m.get(key) ?? { nombre: key, saldo: 0, facturas: 0 }
      prev.saldo += f.saldo
      prev.facturas++
      m.set(key, prev)
    }
    return [...m.values()].sort((a, b) => b.saldo - a.saldo).slice(0, 10)
  }, [facturas])

  // Distribución por mes
  const porMes = useMemo(() => {
    const arr = Array.from({ length: 12 }, (_, i) => ({ mes: i, total: 0, conciliado: 0, pendiente: 0 }))
    for (const f of facturas) {
      if (f.mes < 0 || f.mes > 11) continue
      arr[f.mes].total += f.monto_total
      if (f.estado_factura === 'pagada') arr[f.mes].conciliado += f.monto_total
      else arr[f.mes].pendiente += (f.saldo || f.monto_total)
    }
    return arr.filter(m => m.total > 0)
  }, [facturas])

  const maxMes = Math.max(1, ...porMes.map(m => m.total))

  if (loading) {
    return <div style={{ padding: 60, textAlign: 'center', color: '#94A3B8' }}><Loader2 size={22} style={{ animation: 'spin 1s linear infinite' }} /></div>
  }

  return (
    <div style={{ paddingBottom: 20 }}>
      {/* KPIs principales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon={FileText} color="#1F4E79" label="Facturas 2026" valor={fmtNum(resumen.total)} sub={fmtCLP(resumen.montoTotal)} />
        <KpiCard icon={CheckCircle} color="#16A34A" label="Conciliadas" valor={fmtNum(resumen.conciliadas)} sub={fmtCLP(resumen.montoConciliado)} />
        <KpiCard icon={Clock} color="#0284C7" label="Parciales" valor={fmtNum(resumen.parciales)} sub={`saldo ${fmtCLP(resumen.saldoParcial)}`} />
        <KpiCard icon={AlertCircle} color="#D97706" label="Sin conciliar" valor={fmtNum(resumen.sinConciliar)} sub={fmtCLP(resumen.montoSinConciliar)} />
      </div>

      {/* Barra de avance global */}
      <div style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', border: '1px solid #E5E7EB', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>Avance de conciliación (por monto)</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#16A34A' }}>{resumen.pctConciliado}%</span>
        </div>
        <div style={{ height: 12, background: '#F3F4F6', borderRadius: 99, overflow: 'hidden', display: 'flex' }}>
          <div style={{ height: '100%', width: `${resumen.pctConciliado}%`, background: '#16A34A' }} title="Conciliado" />
          <div style={{ height: '100%', width: `${resumen.montoTotal > 0 ? (resumen.montoParcialPagado / resumen.montoTotal) * 100 : 0}%`, background: '#0284C7' }} title="Parcial pagado" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12, color: '#6B7280' }}>
          <span>Conciliado: <b style={{ color: '#16A34A' }}>{fmtCLP(resumen.montoConciliado)}</b></span>
          <span>Pendiente total: <b style={{ color: '#D97706' }}>{fmtCLP(resumen.pendienteTotal)}</b></span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Top proveedores con saldo pendiente */}
        <div style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', border: '1px solid #E5E7EB' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <AlertCircle size={16} color="#D97706" />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>Top 10 proveedores por saldo pendiente</span>
          </div>
          {topPendientes.length === 0 && <div style={{ fontSize: 12, color: '#94A3B8', padding: 20, textAlign: 'center' }}>Todo conciliado 🎉</div>}
          {topPendientes.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: i < topPendientes.length - 1 ? '1px solid #F3F4F6' : 'none', fontSize: 12 }}>
              <span style={{ width: 18, height: 18, borderRadius: 99, background: '#FEF3C7', color: '#92400E', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#374151' }}>{p.nombre}</span>
              <span style={{ fontSize: 10, color: '#94A3B8' }}>{p.facturas} fact.</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#D97706' }}>{fmtCLP(p.saldo)}</span>
            </div>
          ))}
        </div>

        {/* Distribución por mes */}
        <div style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', border: '1px solid #E5E7EB' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <TrendingUp size={16} color="#1F4E79" />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>Compras por mes (2026)</span>
          </div>
          {porMes.map(m => (
            <div key={m.mes} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                <span style={{ fontWeight: 600, color: '#374151' }}>{MESES[m.mes]}</span>
                <span style={{ color: '#6B7280', fontFamily: 'monospace' }}>{fmtCLP(m.total)}</span>
              </div>
              <div style={{ height: 8, background: '#F3F4F6', borderRadius: 99, overflow: 'hidden', display: 'flex' }}>
                <div style={{ height: '100%', width: `${(m.conciliado / maxMes) * 100}%`, background: '#16A34A' }} title="Conciliado" />
                <div style={{ height: '100%', width: `${(m.pendiente / maxMes) * 100}%`, background: '#FCD34D' }} title="Pendiente" />
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 14, marginTop: 12, fontSize: 10, color: '#6B7280' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#16A34A' }} /> Conciliado</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#FCD34D' }} /> Pendiente</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function KpiCard({ icon: Icon, color, label, valor, sub }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', border: '1px solid #E5E7EB' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
        <Icon size={15} color={color} />
        <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#1E293B' }}>{valor}</div>
      <div style={{ fontSize: 12, color: '#94A3B8', fontFamily: 'monospace', marginTop: 2 }}>{sub}</div>
    </div>
  )
}
