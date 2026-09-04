// src/procesos/PrcGuia.jsx
// La guía del proceso: en qué etapa está, qué falta y cuál es el botón que
// corresponde apretar ahora. Es la pieza que hace el módulo autoexplicativo.

import { Cd, Bt, Bd, Hint } from './prcUI'

/**
 * Las 6 etapas del ciclo de vida de un proceso, desde borrador hasta implementado.
 * Cada una declara cómo se comprueba, qué hay que hacer y a qué pestaña lleva.
 */
export function etapas({ proceso, d }) {
  const docsSop = (d?.docs || []).filter(x => x.tipo === 'SOP')
  const docsFlu = (d?.docs || []).filter(x => x.tipo === 'FLUJOGRAMA')
  const sopVigente = docsSop.find(x => x.es_vigente && x.aprobado_por)
  const fluVigente = docsFlu.find(x => x.es_vigente)
  const revisado = docsSop.some(x => x.revisado_por) || docsSop.some(x => x.estado === 'POR_OFICIALIZAR')
  const hayContenido = (d?.fases || []).length > 0 && (d?.pasos || []).length > 0
  const hayVersion = docsSop.length > 0

  return [
    {
      k: 'contenido', n: 1, l: 'Contenido del SOP',
      ok: hayContenido,
      desc: 'Las fases, pasos, roles y KPI describen cómo debe operar el proceso.',
      accion: 'Editar contenido',
      comoSeHace: 'Pestaña Editar: ajusta el objetivo, los principios, los roles con sus límites, las fases con sus pasos y los indicadores.',
      tab: 'editar'
    },
    {
      k: 'version', n: 2, l: 'Versión guardada',
      ok: hayVersion,
      desc: 'El contenido queda congelado en un documento con número de versión, que ya se puede firmar.',
      accion: 'Guardar como versión',
      comoSeHace: 'Pestaña SOP → botón "Guardar como nueva versión". Toma una foto del contenido actual y la deja firmable.',
      tab: 'sop'
    },
    {
      k: 'revision', n: 3, l: 'Revisado por el dueño',
      ok: revisado || !!sopVigente,
      desc: 'El dueño del proceso confirma que el borrador refleja la operación real.',
      accion: 'Firmar revisión',
      comoSeHace: 'Pestaña SOP → botón "Revisar". Pide un comentario obligatorio y deja el documento listo para el comité.',
      tab: 'sop'
    },
    {
      k: 'aprobacion', n: 4, l: 'Aprobado en comité',
      ok: !!sopVigente && !!fluVigente,
      desc: 'Queda vigente para toda la empresa y el procedimiento anterior pierde efecto.',
      accion: 'Firmar aprobación',
      comoSeHace: 'Pestaña SOP → botón "Aprobar" (necesitas rol de dirección). Hay que aprobar el SOP y también el flujograma.',
      tab: 'sop',
      detalle: !sopVigente && !fluVigente ? 'Faltan el SOP y el flujograma'
        : !sopVigente ? 'Falta aprobar el SOP'
        : !fluVigente ? 'Falta aprobar el flujograma' : null
    },
    {
      k: 'capacitacion', n: 5, l: 'Equipo capacitado',
      ok: (d?.capac || []).length > 0,
      desc: 'Sin capacitación registrada, un SOP aprobado sigue siendo papel.',
      accion: 'Registrar capacitación',
      comoSeHace: 'Pestaña Capacitación → "Registrar capacitación". Anota la fecha, el facilitador y los asistentes uno por línea.',
      tab: 'capac'
    },
    {
      k: 'medicion', n: 6, l: 'Primer KPI medido',
      ok: (d?.mediciones || []).length > 0,
      desc: 'Cerrar un ciclo de medición es el último requisito para dar el proceso por implementado.',
      accion: 'Registrar medición',
      comoSeHace: 'Pestaña KPI → "Registrar medición". Elige el indicador, el período y el valor obtenido.',
      tab: 'kpi'
    }
  ]
}

/**
 * Desglose del avance automático. Espejo exacto de fn_prc_avance_auto (SQL 10):
 *   SOP 40%  = contenido de 7 secciones (50) + versión (20) + revisado (15) + vigente (15)
 *   Flujo 20% = fases con pasos (50) + versión guardada (20) + vigente (30)
 *   Capacitación 20% = registrada (100)
 *   Implementación 20% = medición (50) + estado IMPLEMENTADO (50)
 * Devuelve los cuatro componentes, el global y qué falta para sumar puntos.
 */
export const PESOS_AVANCE = { sop: 40, flujograma: 20, capacitacion: 20, implementacion: 20 }

export function desgloseAvance({ proceso: p, d }) {
  const docsSop = (d?.docs || []).filter(x => x.tipo === 'SOP')
  const docsFlu = (d?.docs || []).filter(x => x.tipo === 'FLUJOGRAMA')
  const hay = s => !!(s && String(s).trim())
  const secciones = [
    { k: 'objetivo', l: 'Objetivo', ok: hay(p?.objetivo) },
    { k: 'alcance', l: 'Alcance', ok: hay(p?.alcance) },
    { k: 'regla', l: 'Regla crítica', ok: hay(p?.regla_critica) },
    { k: 'principios', l: 'Principios', ok: (d?.principios || []).length > 0 },
    { k: 'roles', l: 'Roles y límites', ok: (d?.roles || []).length > 0 },
    { k: 'fases', l: 'Fases con pasos', ok: (d?.fases || []).length > 0 && (d?.pasos || []).length > 0 },
    { k: 'kpis', l: 'Indicadores', ok: (d?.kpis || []).length > 0 }
  ]
  const contenidoN = secciones.filter(s => s.ok).length
  const fases = secciones[5].ok
  const sopVersion = docsSop.length > 0
  const sopRevisado = docsSop.some(x => x.revisado_por || ['POR_OFICIALIZAR', 'VIGENTE'].includes(x.estado))
  const sopVigente = docsSop.some(x => x.es_vigente && x.aprobado_por)
  const fluVersion = docsFlu.length > 0
  const fluVigente = docsFlu.some(x => x.es_vigente)
  const capac = (d?.capac || []).length > 0
  const medicion = (d?.mediciones || []).length > 0
  const impl = p?.estado_implementacion === 'IMPLEMENTADO'

  const sop = Math.round(50 * contenidoN / 7) + (sopVersion ? 20 : 0) + (sopRevisado ? 15 : 0) + (sopVigente ? 15 : 0)
  const flujograma = (fases ? 50 : 0) + (fluVersion ? 20 : 0) + (fluVigente ? 30 : 0)
  const capacitacion = capac ? 100 : 0
  const implementacion = (medicion ? 50 : 0) + (impl ? 50 : 0)
  const global = Math.round(0.4 * sop + 0.2 * flujograma + 0.2 * capacitacion + 0.2 * implementacion)

  const items = [
    { comp: 'sop', l: `Contenido del SOP (${contenidoN}/7 secciones)`, pts: Math.round(50 * contenidoN / 7), max: 50, ok: contenidoN === 7,
      falta: secciones.filter(s => !s.ok).map(s => s.l).join(', ') },
    { comp: 'sop', l: 'Versión del SOP guardada', pts: sopVersion ? 20 : 0, max: 20, ok: sopVersion, falta: 'Pestaña SOP → Guardar como nueva versión' },
    { comp: 'sop', l: 'Revisado por el dueño', pts: sopRevisado ? 15 : 0, max: 15, ok: sopRevisado, falta: 'Pestaña SOP → Revisar (firma del dueño)' },
    { comp: 'sop', l: 'SOP aprobado y vigente', pts: sopVigente ? 15 : 0, max: 15, ok: sopVigente, falta: 'Aprobación firmada en comité' },
    { comp: 'flujograma', l: 'Flujograma generado (fases con pasos)', pts: fases ? 50 : 0, max: 50, ok: fases, falta: 'Editar → sección 5: fases y pasos' },
    { comp: 'flujograma', l: 'Versión del flujograma guardada', pts: fluVersion ? 20 : 0, max: 20, ok: fluVersion, falta: 'Pestaña Flujograma → Guardar versión' },
    { comp: 'flujograma', l: 'Flujograma aprobado y vigente', pts: fluVigente ? 30 : 0, max: 30, ok: fluVigente, falta: 'Aprobación firmada en comité' },
    { comp: 'capacitacion', l: 'Capacitación registrada', pts: capacitacion, max: 100, ok: capac, falta: 'Pestaña Capacitación → Registrar' },
    { comp: 'implementacion', l: 'Primera medición de KPI', pts: medicion ? 50 : 0, max: 50, ok: medicion, falta: 'Pestaña KPI → Registrar medición' },
    { comp: 'implementacion', l: 'Estado IMPLEMENTADO en la matriz', pts: impl ? 50 : 0, max: 50, ok: impl, falta: 'Se marca en la Matriz cuando se cumplen los 4 criterios' }
  ]
  return { sop, flujograma, capacitacion, implementacion, global, contenidoN, secciones, items }
}

/** Barra de las 6 etapas con la actual destacada. */
export function CicloVida({ pasos, onIr }) {
  const idx = pasos.findIndex(p => !p.ok)
  return (
    <div style={{ display: 'flex', gap: 0, alignItems: 'stretch', overflowX: 'auto' }}>
      {pasos.map((p, i) => {
        const actual = i === idx
        const c = p.ok ? 'var(--success)' : actual ? 'var(--accent)' : 'var(--text-muted)'
        const bg = p.ok ? 'var(--success-bg)' : actual ? 'var(--accent-bg)' : 'var(--bg-page)'
        return (
          <button key={p.k} onClick={() => onIr(p.tab)} title={p.comoSeHace} style={{
            flex: 1, minWidth: 132, textAlign: 'left', cursor: 'pointer', minHeight: 0,
            padding: '9px 11px', border: 'none', borderTop: `3px solid ${c}`,
            background: bg, marginRight: 2, borderRadius: '0 0 8px 8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
              <span style={{
                width: 17, height: 17, borderRadius: 9, background: c, color: '#fff',
                fontSize: 9.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
              }}>{p.ok ? '✓' : p.n}</span>
              <span style={{ fontSize: 11.5, fontWeight: actual ? 800 : 600, color: p.ok || actual ? c : 'var(--text-secondary)' }}>
                {p.l}
              </span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.35 }}>
              {p.ok ? 'listo' : actual ? 'estás acá' : 'pendiente'}
            </div>
          </button>
        )
      })}
    </div>
  )
}

/** Tarjeta grande: qué sigue ahora y con qué botón. */
export function SiguientePaso({ pasos, onIr, implementado }) {
  const sig = pasos.find(p => !p.ok)

  if (implementado || !sig) {
    return (
      <Cd style={{ borderLeft: '4px solid var(--success)', background: 'var(--success-bg)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 26 }}>✓</div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--success-text)' }}>
              Las 6 etapas están completas
            </div>
            <Hint style={{ color: 'var(--success-text)', opacity: .85 }}>
              El proceso ya se puede marcar como IMPLEMENTADO desde la Matriz. La próxima obligación es la revisión
              semestral del SOP.
            </Hint>
          </div>
        </div>
      </Cd>
    )
  }

  return (
    <Cd style={{ borderLeft: '4px solid var(--accent)' }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{
          width: 40, height: 40, borderRadius: 11, background: 'var(--accent)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800, flexShrink: 0
        }}>{sig.n}</div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: 'var(--text-muted)' }}>
              Lo que sigue · etapa {sig.n} de 6
            </span>
            {sig.detalle && <Bd c="var(--warning)">{sig.detalle}</Bd>}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, margin: '2px 0 4px' }}>{sig.l}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{sig.desc}</div>
          <Hint style={{ marginTop: 6 }}><b>Cómo se hace:</b> {sig.comoSeHace}</Hint>
        </div>
        <Bt onClick={() => onIr(sig.tab)} style={{ flexShrink: 0 }}>{sig.accion} →</Bt>
      </div>
    </Cd>
  )
}
