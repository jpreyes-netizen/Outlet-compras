// src/procesos/PrcFlujograma.jsx — visor swimlane con zoom + exportación
import { useState, useMemo } from 'react'
import { flujoSVG, flujoDrawio } from './prcFlujo'
import { Cd, Bt, Bd, Vacio, descargar } from './prcUI'

export function PrcFlujograma({ proceso, fases, pasos, version }) {
  const [zoom, setZoom] = useState(0.55)
  const opts = useMemo(() => ({ version: version || 'Borrador', fecha: new Date().toISOString().slice(0, 10) }), [version])
  const svg = useMemo(() => flujoSVG(proceso, fases, pasos, opts), [proceso, fases, pasos, opts])
  const lanes = useMemo(() => [...new Set(pasos.map(p => (p.responsable || 'Sin asignar').trim()))], [pasos])
  const criticos = pasos.filter(p => p.es_control_critico).length
  const decisiones = pasos.filter(p => p.es_decision).length

  if (!pasos.length) {
    return <Cd><Vacio ic="🗺️" txt="Este proceso todavía no tiene fases ni pasos cargados. El flujograma se genera automáticamente desde el SOP." /></Cd>
  }

  return (
    <Cd style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{
        padding: '11px 14px', borderBottom: '1px solid var(--border-1)', display: 'flex',
        alignItems: 'center', gap: 10, flexWrap: 'wrap'
      }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Bd c="var(--accent)">{fases.length} fases</Bd>
          <Bd c="var(--text-muted)">{pasos.length} pasos</Bd>
          <Bd c="var(--info)">{lanes.length} swimlanes</Bd>
          {criticos > 0 && <Bd c="var(--danger)">{criticos} controles críticos</Bd>}
          {decisiones > 0 && <Bd c="var(--warning)">{decisiones} decisiones</Bd>}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 7, alignItems: 'center' }}>
          <Bt v="sec" sm onClick={() => setZoom(z => Math.max(0.25, +(z - 0.1).toFixed(2)))}>−</Bt>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 42, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <Bt v="sec" sm onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(2)))}>+</Bt>
          <Bt v="ghost" sm onClick={() => setZoom(0.55)}>Ajustar</Bt>
          <Bt v="sec" sm onClick={() => descargar(`FLU_${proceso.id}.svg`, svg, 'image/svg+xml;charset=utf-8')}>Descargar SVG</Bt>
          <Bt v="sec" sm onClick={() => descargar(`FLU_${proceso.id}.drawio`, flujoDrawio(proceso, fases, pasos, opts), 'application/xml;charset=utf-8')}>
            Descargar draw.io
          </Bt>
        </div>
      </div>
      <div style={{ overflow: 'auto', background: 'var(--bg-page)', padding: 14, maxHeight: '72vh' }}>
        <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: 'max-content' }}
          dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
      <div style={{ padding: '9px 14px', borderTop: '1px solid var(--border-1)', fontSize: 11.5, color: 'var(--text-muted)' }}>
        El flujograma se genera desde las fases y pasos del SOP: al editar el proceso, el diagrama se actualiza solo.
        El archivo .drawio se abre y edita en diagrams.net manteniendo la convención de la empresa.
      </div>
    </Cd>
  )
}
