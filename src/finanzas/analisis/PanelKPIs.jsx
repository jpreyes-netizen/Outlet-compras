import { formato } from './motor'

/* ═══ PANEL KPIs ═══
   Cards visuales con semáforo (verde/amarillo/rojo).
   Compacto, pensado para ir arriba de Presupuesto y EERR sin robar espacio.
*/

const COLOR_SEMAFORO = {
  verde:    { bg: '#ECFDF5', border: '#10B981', text: '#047857', label: 'SANO' },
  amarillo: { bg: '#FFFBEB', border: '#F59E0B', text: '#B45309', label: 'ATENCIÓN' },
  rojo:     { bg: '#FEF2F2', border: '#EF4444', text: '#B91C1C', label: 'ALERTA' },
}

function KpiCard({ kpi, compacto }) {
  const c = COLOR_SEMAFORO[kpi.semaforo] || COLOR_SEMAFORO.amarillo
  const v = kpi.formato === 'pct' ? formato.pct(kpi.valor)
          : kpi.formato === 'clp' ? formato.clp(kpi.valor)
          : kpi.formato === 'ratio' ? formato.ratio(kpi.valor) + 'x'
          : kpi.valor

  return (
    <div style={{
      background: '#fff',
      border: `1px solid ${c.border}`,
      borderLeft: `4px solid ${c.border}`,
      borderRadius: 10,
      padding: compacto ? '10px 12px' : '12px 14px',
      minWidth: compacto ? 150 : 170,
      flex: '1 1 170px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {kpi.titulo}
        </span>
        <span style={{ fontSize: 8, fontWeight: 700, color: c.text, background: c.bg, padding: '2px 5px', borderRadius: 3, letterSpacing: '0.04em' }}>
          {c.label}
        </span>
      </div>
      <div style={{ fontSize: compacto ? 18 : 20, fontWeight: 700, color: '#111827', fontFamily: 'monospace', marginBottom: 2 }}>
        {v}
      </div>
      <div style={{ fontSize: 10, color: '#9CA3AF' }}>{kpi.sub}</div>
      <div style={{ fontSize: 9, color: c.text, marginTop: 3 }}>{kpi.benchmark}</div>
    </div>
  )
}

export function PanelKPIs({ kpis, titulo, compacto = false }) {
  if (!kpis || kpis.length === 0) return null
  return (
    <div style={{ marginBottom: 14 }}>
      {titulo && (
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 8, letterSpacing: '0.02em' }}>
          {titulo}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {kpis.map(k => <KpiCard key={k.id} kpi={k} compacto={compacto} />)}
      </div>
    </div>
  )
}
