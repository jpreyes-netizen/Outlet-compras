/* ═══ ALERTAS INTELIGENTES ═══
   Lista de hallazgos ordenados por severidad: crítica > atención > positiva.
*/

const ESTILO_SEVERIDAD = {
  critica: {
    bg: '#FEF2F2', border: '#FECACA', icon: '🔴', label: 'CRÍTICA', color: '#B91C1C',
  },
  atencion: {
    bg: '#FFFBEB', border: '#FDE68A', icon: '🟡', label: 'ATENCIÓN', color: '#B45309',
  },
  positiva: {
    bg: '#ECFDF5', border: '#A7F3D0', icon: '🟢', label: 'POSITIVA', color: '#047857',
  },
}

function FilaAlerta({ alerta }) {
  const s = ESTILO_SEVERIDAD[alerta.severidad] || ESTILO_SEVERIDAD.atencion
  return (
    <div style={{
      background: s.bg, border: `1px solid ${s.border}`,
      borderRadius: 8, padding: '10px 12px',
      display: 'flex', gap: 10, alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: 14, lineHeight: 1, marginTop: 1 }}>{s.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{alerta.titulo}</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: s.color, letterSpacing: '0.04em' }}>
            {s.label}
          </span>
        </div>
        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.4 }}>{alerta.detalle}</div>
      </div>
    </div>
  )
}

export function AlertasInteligentes({ alertas, titulo = 'Alertas inteligentes', maxItems }) {
  if (!alertas || alertas.length === 0) {
    return (
      <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#6B7280' }}>
          {titulo}
        </div>
        <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 6 }}>
          Sin hallazgos relevantes para este período.
        </div>
      </div>
    )
  }

  const mostrar = maxItems ? alertas.slice(0, maxItems) : alertas
  const conteo = {
    critica: alertas.filter(a => a.severidad === 'critica').length,
    atencion: alertas.filter(a => a.severidad === 'atencion').length,
    positiva: alertas.filter(a => a.severidad === 'positiva').length,
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{titulo}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {conteo.critica > 0 && <span style={{ fontSize: 10, fontWeight: 700, background: '#FEF2F2', color: '#B91C1C', padding: '2px 7px', borderRadius: 4 }}>{conteo.critica} crítica{conteo.critica > 1 ? 's' : ''}</span>}
          {conteo.atencion > 0 && <span style={{ fontSize: 10, fontWeight: 700, background: '#FFFBEB', color: '#B45309', padding: '2px 7px', borderRadius: 4 }}>{conteo.atencion} atención</span>}
          {conteo.positiva > 0 && <span style={{ fontSize: 10, fontWeight: 700, background: '#ECFDF5', color: '#047857', padding: '2px 7px', borderRadius: 4 }}>{conteo.positiva} positiva{conteo.positiva > 1 ? 's' : ''}</span>}
        </div>
        {maxItems && alertas.length > maxItems && (
          <span style={{ fontSize: 11, color: '#6B7280', marginLeft: 'auto' }}>
            Mostrando {maxItems} de {alertas.length}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {mostrar.map((a, i) => <FilaAlerta key={i} alerta={a} />)}
      </div>
    </div>
  )
}
