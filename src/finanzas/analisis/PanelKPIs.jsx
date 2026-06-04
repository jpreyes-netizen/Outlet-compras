import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { formato } from './motor'

const COLOR_SEMAFORO = {
  verde:    { bg: '#ECFDF5', border: '#10B981', text: '#047857', label: 'SANO' },
  amarillo: { bg: '#FFFBEB', border: '#F59E0B', text: '#B45309', label: 'ATENCIÓN' },
  rojo:     { bg: '#FEF2F2', border: '#EF4444', text: '#B91C1C', label: 'ALERTA' },
}

function CambioBadge({ cambio }) {
  if (!cambio) return null
  const Icon = Math.abs(cambio.pct) < 0.5 ? Minus : cambio.pct >= 0 ? TrendingUp : TrendingDown
  const color = Math.abs(cambio.pct) < 0.5 ? '#6B7280' : cambio.pct >= 0 ? '#15803D' : '#DC2626'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2,
      fontSize: 9, fontWeight: 700, color,
      background: color + '15', padding: '2px 5px', borderRadius: 3,
    }}>
      <Icon size={9} />
      {(cambio.pct >= 0 ? '+' : '') + cambio.pct.toFixed(1) + '%'}
    </span>
  )
}

function KpiCard({ kpi, compacto, onClick }) {
  const c = COLOR_SEMAFORO[kpi.semaforo] || COLOR_SEMAFORO.amarillo
  const v = kpi.formato === 'pct' ? formato.pct(kpi.valor)
          : kpi.formato === 'clp' ? formato.clp(kpi.valor)
          : kpi.formato === 'ratio' ? formato.ratio(kpi.valor) + 'x'
          : kpi.valor

  const clickable = !!onClick
  return (
    <div
      onClick={onClick}
      style={{
        background: '#fff',
        border: '1px solid ' + c.border,
        borderLeft: '4px solid ' + c.border,
        borderRadius: 10,
        padding: compacto ? '10px 12px' : '12px 14px',
        minWidth: compacto ? 150 : 170,
        flex: '1 1 170px',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'transform 0.12s, box-shadow 0.12s',
      }}
      onMouseEnter={clickable ? (e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)' } : undefined}
      onMouseLeave={clickable ? (e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' } : undefined}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {kpi.titulo}
        </span>
        <span style={{ fontSize: 8, fontWeight: 700, color: c.text, background: c.bg, padding: '2px 5px', borderRadius: 3, letterSpacing: '0.04em' }}>
          {c.label}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
        <span style={{ fontSize: compacto ? 18 : 20, fontWeight: 700, color: '#111827', fontFamily: 'monospace' }}>
          {v}
        </span>
        {kpi.cambio && <CambioBadge cambio={kpi.cambio} />}
      </div>
      <div style={{ fontSize: 10, color: '#9CA3AF' }}>{kpi.sub}</div>
      <div style={{ fontSize: 9, color: c.text, marginTop: 3 }}>{kpi.benchmark}</div>
      {clickable && (
        <div style={{ fontSize: 9, color: '#9CA3AF', marginTop: 4, fontStyle: 'italic' }}>
          Click para detalle →
        </div>
      )}
    </div>
  )
}

export function PanelKPIs({ kpis, titulo, compacto = false, onClickKpi }) {
  if (!kpis || kpis.length === 0) return null
  return (
    <div style={{ marginBottom: 14 }}>
      {titulo && (
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 8, letterSpacing: '0.02em' }}>
          {titulo}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {kpis.map(k => (
          <KpiCard key={k.id} kpi={k} compacto={compacto} onClick={onClickKpi ? () => onClickKpi(k) : null} />
        ))}
      </div>
    </div>
  )
}
