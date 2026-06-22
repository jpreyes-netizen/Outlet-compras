import { useEffect, useState, useMemo } from 'react'
import { toast } from 'sonner'
import { Loader2, Target, CheckCircle, FileText, MinusCircle, AlertTriangle } from 'lucide-react'
import { supabase } from '../../supabase'

const fmtNum = n => new Intl.NumberFormat('es-CL').format(n ?? 0)
const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n ?? 0)

// ════════════════════════════════════════════════════════════════════════
// DASHBOARD OC ↔ FACTURA
// Separa el universo del libro en 4 categorías por estado de vínculo a OC:
//  - Vinculadas: factura.oc_id NOT NULL
//  - Vinculables: requiere_oc=true, sin oc_id, proveedor con OC cargada en sistema
//  - Sin OC en sistema: requiere_oc=true, sin oc_id, proveedor sin OC cargada
//  - No requieren OC: requiere_oc=false (servicios, telecom, seguros, TAG, etc.)
// ════════════════════════════════════════════════════════════════════════
export function DashboardOCTab({ onIrAVincular }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)

  useEffect(() => {
    setLoading(true)
    cargarDatos()
      .then(setData)
      .catch(e => toast.error('Error: ' + e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div style={{ padding: 60, textAlign: 'center', color: '#94A3B8' }}><Loader2 size={22} style={{ animation: 'spin 1s linear infinite' }} /></div>
  }
  if (!data) return null

  const { totales, topVinculables, topSinOC } = data
  const pct = (n) => totales.total > 0 ? Math.round((n / totales.total) * 1000) / 10 : 0

  return (
    <div style={{ paddingBottom: 20 }}>
      {/* Banner accionable: lo que el usuario puede hacer ahora */}
      <div style={{
        background: '#FEF3C7', borderRadius: 12, padding: '14px 18px',
        marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, border: '1px solid #FDE68A',
      }}>
        <Target size={28} color="#B45309" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Trabajo pendiente</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#78350F', marginTop: 2 }}>
            {fmtNum(totales.vinculables)} facturas listas para vincular a OC
          </div>
          <div style={{ fontSize: 12, color: '#92400E', marginTop: 4 }}>
            Su proveedor tiene OC cargada en el sistema · acción inmediata
          </div>
        </div>
        {onIrAVincular && (
          <button onClick={onIrAVincular} style={{
            padding: '10px 18px', borderRadius: 8, border: 'none',
            background: '#B45309', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>Ir a vincular →</button>
        )}
      </div>

      {/* 4 KPIs principales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon={FileText} color="#1F4E79" label="Total facturas 2026" valor={fmtNum(totales.total)} sub="en libro de compras" />
        <KpiCard icon={CheckCircle} color="#16A34A" label="Vinculadas" valor={fmtNum(totales.vinculadas)} sub="tienen OC asociada" />
        <KpiCard icon={Target} color="#B45309" label="Vinculables" valor={fmtNum(totales.vinculables)} sub="acción inmediata" highlight />
        <KpiCard icon={MinusCircle} color="#64748B" label="No requieren OC" valor={fmtNum(totales.sin_oc_aplicable)} sub="servicios excluidos" />
      </div>

      {/* Distribución visual */}
      <div style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', border: '1px solid #E5E7EB', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 12 }}>Distribución del libro de compras</div>
        <div style={{ display: 'flex', height: 12, borderRadius: 99, overflow: 'hidden', marginBottom: 12, background: '#F3F4F6' }}>
          <div style={{ width: `${pct(totales.vinculadas)}%`, background: '#16A34A' }} title={`Vinculadas: ${totales.vinculadas}`} />
          <div style={{ width: `${pct(totales.vinculables)}%`, background: '#D97706' }} title={`Vinculables: ${totales.vinculables}`} />
          <div style={{ width: `${pct(totales.sin_oc_en_sistema)}%`, background: '#94A3B8' }} title={`Sin OC en sistema: ${totales.sin_oc_en_sistema}`} />
          <div style={{ width: `${pct(totales.sin_oc_aplicable)}%`, background: '#D1D5DB' }} title={`No requieren OC: ${totales.sin_oc_aplicable}`} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6, fontSize: 11 }}>
          <LegendItem color="#16A34A" label={`Vinculadas · ${fmtNum(totales.vinculadas)} (${pct(totales.vinculadas)}%)`} />
          <LegendItem color="#D97706" label={`Vinculables · ${fmtNum(totales.vinculables)} (${pct(totales.vinculables)}%)`} />
          <LegendItem color="#94A3B8" label={`Sin OC en sistema · ${fmtNum(totales.sin_oc_en_sistema)} (${pct(totales.sin_oc_en_sistema)}%)`} />
          <LegendItem color="#D1D5DB" label={`No requieren OC · ${fmtNum(totales.sin_oc_aplicable)} (${pct(totales.sin_oc_aplicable)}%)`} />
        </div>
      </div>

      {/* Dos tarjetas: prioridades reales vs alertas */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', border: '1px solid #E5E7EB' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Target size={16} color="#B45309" />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>Top proveedores vinculables</span>
          </div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 10 }}>Facturas pendientes cuyo proveedor tiene OC en sistema</div>
          {topVinculables.length === 0 && <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', padding: 20 }}>Sin pendientes 🎉</div>}
          {topVinculables.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: i > 0 ? '1px solid #F3F4F6' : 'none', fontSize: 12 }}>
              <span style={{ width: 18, height: 18, borderRadius: 99, background: '#FEF3C7', color: '#92400E', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#374151' }}>{p.proveedor}</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#D97706' }}>{fmtNum(p.facturas)}</span>
            </div>
          ))}
        </div>

        <div style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', border: '1px solid #E5E7EB' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <AlertTriangle size={16} color="#64748B" />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>Top proveedores sin OC en sistema</span>
          </div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 10 }}>Proveedores con muchas facturas pero ninguna OC cargada. Útil para detectar OC faltantes.</div>
          {topSinOC.length === 0 && <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', padding: 20 }}>—</div>}
          {topSinOC.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: i > 0 ? '1px solid #F3F4F6' : 'none', fontSize: 12 }}>
              <span style={{ width: 18, height: 18, borderRadius: 99, background: '#F1F5F9', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#475569' }}>{p.proveedor}</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#64748B' }}>{fmtNum(p.facturas)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, color, label, valor, sub, highlight }) {
  return (
    <div style={{
      background: highlight ? '#FFFBEB' : '#fff',
      borderRadius: 12, padding: '14px 16px',
      border: highlight ? '1px solid #FDE68A' : '1px solid #E5E7EB',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
        <Icon size={15} color={color} />
        <span style={{ fontSize: 11, fontWeight: 600, color: highlight ? '#92400E' : '#6B7280', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: highlight ? '#78350F' : '#1E293B' }}>{valor}</div>
      <div style={{ fontSize: 12, color: highlight ? '#92400E' : '#94A3B8', marginTop: 2 }}>{sub}</div>
    </div>
  )
}

function LegendItem({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#475569' }}>
      <span style={{ width: 9, height: 9, borderRadius: 99, background: color, flexShrink: 0 }} />
      <span>{label}</span>
    </div>
  )
}

// ─── Carga de datos ──────────────────────────────────────────────────────
// Trae libro de compras 2026 + OC cargadas. Calcula categorías y rankings.
async function cargarDatos() {
  // Facturas 2026 con su estado: requiere_oc, oc_id
  const { data: facturas, error: e1 } = await supabase
    .from('libro_compras')
    .select('id, rut_proveedor, razon_social, monto_total, requiere_oc, oc_id, anulado')
    .gte('fecha_emision', '2026-01-01')
    .eq('anulado', false)
    .limit(20000)
  if (e1) throw e1

  // Proveedores con OC cargada (sus RUT normalizados)
  // Lo hago en 2 pasos para no depender del embed FK de Supabase.
  const { data: ocRows, error: e2 } = await supabase
    .from('ordenes_compra')
    .select('proveedor_id')
    .not('proveedor_id', 'is', null)
    .limit(10000)
  if (e2) throw e2

  const provIds = [...new Set((ocRows ?? []).map(o => o.proveedor_id).filter(Boolean))]
  let provsRows = []
  if (provIds.length > 0) {
    const { data: pr, error: e3 } = await supabase
      .from('proveedores')
      .select('id, rut')
      .in('id', provIds)
      .not('rut', 'is', null)
    if (e3) throw e3
    provsRows = pr ?? []
  }

  const rutsConOC = new Set()
  provsRows.forEach(p => {
    const r = (p.rut || '').replace(/\./g, '').replace(/-/g, '')
    if (r) rutsConOC.add(r)
  })

  const norm = r => (r || '').replace(/\./g, '').replace(/-/g, '')

  // Clasificar cada factura
  const totales = { total: 0, vinculadas: 0, vinculables: 0, sin_oc_en_sistema: 0, sin_oc_aplicable: 0 }
  const acumVinculables = new Map()
  const acumSinOC = new Map()

  for (const f of (facturas ?? [])) {
    totales.total++
    if (f.requiere_oc === false) {
      totales.sin_oc_aplicable++
      continue
    }
    if (f.oc_id) {
      totales.vinculadas++
      continue
    }
    // requiere_oc = true, sin oc_id: ¿proveedor tiene OC?
    if (rutsConOC.has(norm(f.rut_proveedor))) {
      totales.vinculables++
      const key = f.razon_social || '(sin nombre)'
      const prev = acumVinculables.get(key) ?? { proveedor: key, facturas: 0 }
      prev.facturas++
      acumVinculables.set(key, prev)
    } else {
      totales.sin_oc_en_sistema++
      const key = f.razon_social || '(sin nombre)'
      const prev = acumSinOC.get(key) ?? { proveedor: key, facturas: 0 }
      prev.facturas++
      acumSinOC.set(key, prev)
    }
  }

  return {
    totales,
    topVinculables: [...acumVinculables.values()].sort((a, b) => b.facturas - a.facturas).slice(0, 10),
    topSinOC: [...acumSinOC.values()].sort((a, b) => b.facturas - a.facturas).slice(0, 10),
  }
}
