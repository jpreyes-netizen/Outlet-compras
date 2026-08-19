// src/procesos/PrcDashboard.jsx — visión de gobierno de la matriz
import { useMemo } from 'react'
import { Cd, Mt, Bd, Barra, css, pct, SEMAFORO, Criterios, Vacio, fFecha } from './prcUI'

const SEV = { alta: 'var(--danger)', media: 'var(--warning)', baja: 'var(--text-muted)' }

export function PrcDashboard({ matriz, cat, alertas, onAbrir }) {
  const k = useMemo(() => {
    const t = matriz.length || 1
    const sumScore = matriz.reduce((a, p) => a + (p.score || 0), 0) || 1
    return {
      total: matriz.length,
      implementados: matriz.filter(p => p.estado_implementacion === 'IMPLEMENTADO').length,
      score9: matriz.filter(p => p.score === 9).length,
      riesgo: matriz.filter(p => p.semaforo === 'rojo').length,
      sinDueno: matriz.filter(p => p.dueno_provisional).length,
      conSop: matriz.filter(p => p.sop_aprobado).length,
      conFlu: matriz.filter(p => p.flujograma_ok).length,
      conCap: matriz.filter(p => p.capacitacion_ok).length,
      promedio: Math.round(matriz.reduce((a, p) => a + (p.pct_global || 0), 0) / t),
      ponderado: Math.round(matriz.reduce((a, p) => a + (p.pct_global || 0) * (p.score || 0), 0) / sumScore),
      atrasoMax: Math.max(0, ...matriz.map(p => p.dias_atraso || 0))
    }
  }, [matriz])

  const porCategoria = useMemo(() => cat.categorias.map(c => {
    const ps = matriz.filter(p => p.categoria === c.codigo)
    return {
      ...c, n: ps.length,
      avance: ps.length ? Math.round(ps.reduce((a, p) => a + (p.pct_global || 0), 0) / ps.length) : 0,
      impl: ps.filter(p => p.estado_implementacion === 'IMPLEMENTADO').length
    }
  }), [matriz, cat])

  const porOnda = useMemo(() => cat.ondas.map(o => {
    const ps = matriz.filter(p => p.onda === o.codigo)
    return {
      ...o, n: ps.length,
      avance: ps.length ? Math.round(ps.reduce((a, p) => a + (p.pct_global || 0), 0) / ps.length) : 0,
      rojo: ps.filter(p => p.semaforo === 'rojo').length,
      vencida: o.fecha_termino && o.fecha_termino < new Date().toISOString().slice(0, 10)
    }
  }), [matriz, cat])

  const urgentes = useMemo(() => [...matriz]
    .filter(p => p.estado_implementacion !== 'IMPLEMENTADO')
    .sort((a, b) => (b.score - a.score) || ((b.dias_atraso || 0) - (a.dias_atraso || 0)))
    .slice(0, 8), [matriz])

  const alertasOrd = useMemo(() => [...alertas]
    .sort((a, b) => (a.severidad === 'alta' ? -1 : 1) - (b.severidad === 'alta' ? -1 : 1)), [alertas])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(158px, 1fr))', gap: 10 }}>
        <Mt l="Procesos mapeados" v={k.total} sub={`${k.score9} con score 9`} />
        <Mt l="Avance ponderado" v={pct(k.ponderado)} sub={`Simple ${pct(k.promedio)}`} c="var(--accent)" />
        <Mt l="Implementados" v={`${k.implementados}/${k.total}`} sub="Cumplen los 4 criterios" c={k.implementados ? 'var(--success)' : 'var(--text-muted)'} />
        <Mt l="En riesgo" v={k.riesgo} sub="Score ≥6, pendiente y atrasado" c={k.riesgo ? 'var(--danger)' : 'var(--success)'} />
        <Mt l="Sin dueño real" v={k.sinDueno} sub="Cargo vacante o por contratar" c={k.sinDueno ? 'var(--warning)' : 'var(--success)'} />
        <Mt l="Atraso máximo" v={k.atrasoMax + ' d'} sub="Sobre la fecha objetivo vigente" c={k.atrasoMax > 60 ? 'var(--danger)' : 'var(--warning)'} />
      </div>

      <Cd>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>Criterio de implementación</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          Un proceso solo cuenta como implementado si cumple los cuatro. La regla está en la base de datos: marcar
          IMPLEMENTADO sin cumplirlos falla con error, no con advertencia.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          {[
            { l: 'SOP aprobado y vigente', v: k.conSop },
            { l: 'Flujograma vigente', v: k.conFlu },
            { l: 'Capacitación registrada', v: k.conCap },
            { l: 'Ciclo de KPI cerrado', v: matriz.filter(p => p.medicion_ok).length }
          ].map(x => (
            <div key={x.l}>
              <Barra v={(x.v / (k.total || 1)) * 100} label={`${x.l} · ${x.v}/${k.total}`}
                c={x.v === k.total ? 'var(--success)' : x.v === 0 ? 'var(--danger)' : 'var(--warning)'} />
            </div>
          ))}
        </div>
      </Cd>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <Cd>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12 }}>Avance por categoría</div>
          {porCategoria.map(c => (
            <div key={c.codigo} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: c.color, marginRight: 7 }} />
                  {c.nombre}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{c.impl}/{c.n} impl. · {pct(c.avance)}</span>
              </div>
              <Barra v={c.avance} c={c.color} />
            </div>
          ))}
        </Cd>

        <Cd>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12 }}>Semáforo por onda</div>
          {porOnda.map(o => (
            <div key={o.codigo} style={{ marginBottom: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{o.nombre} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>· {o.ventana}</span></span>
                <span style={{ display: 'flex', gap: 5 }}>
                  {o.vencida && <Bd c="var(--danger)">Ventana vencida</Bd>}
                  {o.rojo > 0 && <Bd c="var(--danger)">{o.rojo} en riesgo</Bd>}
                  <Bd c="var(--text-muted)">{o.n} procesos</Bd>
                </span>
              </div>
              <Barra v={o.avance} c={o.vencida ? 'var(--danger)' : 'var(--accent)'} />
            </div>
          ))}
        </Cd>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 14 }}>
        <Cd>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>Prioridad de ataque</div>
          {urgentes.length === 0 && <Vacio txt="Todo implementado" ic="✓" />}
          {urgentes.map(p => {
            const s = SEMAFORO[p.semaforo] || SEMAFORO.gris
            return (
              <div key={p.id} onClick={() => onAbrir(p.id)} style={{
                display: 'flex', gap: 11, alignItems: 'center', padding: '9px 10px', borderRadius: 10,
                cursor: 'pointer', borderLeft: `3px solid ${s.c}`, background: 'var(--bg-page)', marginBottom: 6
              }}>
                <div style={{
                  minWidth: 30, height: 30, borderRadius: 8, background: s.bg, color: s.c,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12
                }}>{p.score}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.id} · {p.nombre}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {p.dueno_persona || p.dueno_cargo || 'Sin dueño'}
                    {p.dueno_provisional && ' (provisional)'}
                    {p.dias_atraso > 0 && ` · ${p.dias_atraso} d de atraso`}
                  </div>
                </div>
                <div style={{ width: 92 }}><Barra v={p.pct_global} c={s.c} h={5} /></div>
              </div>
            )
          })}
        </Cd>

        <Cd>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>
            Alertas <Bd c={alertas.length ? 'var(--danger)' : 'var(--success)'}>{alertas.length}</Bd>
          </div>
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {alertas.length === 0 && <Vacio txt="Sin alertas activas" ic="✓" />}
            {alertasOrd.map((a, i) => (
              <div key={i} onClick={() => onAbrir(a.proceso_id)} style={{
                display: 'flex', gap: 9, padding: '8px 10px', borderRadius: 9, cursor: 'pointer',
                background: 'var(--bg-page)', marginBottom: 6, alignItems: 'flex-start'
              }}>
                <span style={{ color: SEV[a.severidad], fontSize: 13, lineHeight: 1.2 }}>●</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{a.proceso_id} · {a.nombre}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{a.mensaje}</div>
                </div>
                <Bd c={SEV[a.severidad]}>{a.tipo.replace(/_/g, ' ').toLowerCase()}</Bd>
              </div>
            ))}
          </div>
        </Cd>
      </div>
    </div>
  )
}
