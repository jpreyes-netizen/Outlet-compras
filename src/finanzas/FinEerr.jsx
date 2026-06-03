import { useState, useEffect } from 'react'
import { EerrEstadoResultados } from './presupuesto/EerrEstadoResultados'
import { EerrDashboard } from './presupuesto/EerrDashboard'
import { EstadoClasificacionDashboard } from './presupuesto/EstadoClasificacionDashboard'
import { CargaCostos } from './presupuesto/CargaCostos'

/* ═══ FIN EERR ═══
   Contenedor de Estado de Resultados, Dashboard EERR y Clasificación.
   Antes vivía dentro de FinPresupuesto.jsx; en Fase 1 se separó porque
   Presupuesto y EERR son módulos conceptualmente distintos.
   Los 3 sub-componentes hijos NO se modificaron — solo se movieron acá. */

const TABS = [
  { k: 'eerr',          l: 'Estado de Resultados' },
  { k: 'dashboard',     l: 'Dashboard EERR' },
  { k: 'clasificacion', l: 'Estado Clasificación' },
  { k: 'costos',        l: 'Carga Costos' },
]

export function FinEerr({ cu, isMobile }) {
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem('fin_eerr_sub') || 'eerr' } catch (e) { return 'eerr' }
  })

  useEffect(() => {
    try { localStorage.setItem('fin_eerr_sub', tab) } catch (e) { }
  }, [tab])

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid rgba(0,0,0,0.06)', overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
            background: 'none', border: 'none', cursor: 'pointer',
            color: tab === t.k ? '#1F4E79' : '#8E8E93',
            borderBottom: tab === t.k ? '2px solid #1F4E79' : '2px solid transparent',
          }}>{t.l}</button>
        ))}
      </div>

      {tab === 'eerr' && <EerrEstadoResultados />}
      {tab === 'dashboard' && <EerrDashboard />}
      {tab === 'clasificacion' && <EstadoClasificacionDashboard />}
      {tab === 'costos' && <CargaCostos cu={cu} />}
    </div>
  )
}
