// src/procesos/PrcDashboard.jsx — visión de gobierno de la matriz
import { useMemo, useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { Cd, Mt, Bd, Bt, Barra, css, pct, SEMAFORO, Criterios, Vacio, fFecha, Ayuda, hoy } from './prcUI'
import { coberturaContramedidas, efectividadIntervencion } from './prcComite'

const SEV = { alta: 'var(--danger)', media: 'var(--warning)', baja: 'var(--text-muted)' }

/** Tarjeta del comité de gestión: lo que el gobierno por información necesita mirar hoy. */
function GobiernoCard({ onIr, onInforme }) {
  const [d, setD] = useState(null)
  useEffect(() => {
    const q = (t, sel = '*') => supabase.from(t).select(sel).then(r => (r.error ? null : r.data || []))
    Promise.all([q('v_prc_sesiones'), q('v_prc_acuerdos'), q('v_prc_scorecard'), q('v_prc_encargos'), q('prc_mediciones')]).then(([ses, acu, sc, enc, med]) => {
      if (!ses || !acu || !sc) return setD(false)
      const h = hoy()
      const prox = ses.filter(s => s.fecha >= h && s.estado === 'PLANIFICADA').sort((a, b) => a.fecha.localeCompare(b.fecha))[0]
      const cob = coberturaContramedidas(sc)
      const ef = efectividadIntervencion(acu, sc, med || [])
      const act = (enc || []).filter(e => ['ACTIVO', 'EN_PILOTO', 'EN_APROBACION'].includes(e.estado))
      setD({
        prox, porCerrar: ses.filter(s => s.estado === 'PLANIFICADA' && s.fecha < h).length,
        sinActa: ses.filter(s => s.estado === 'REALIZADA' && s.acta_estado === 'SIN_ACTA').length,
        vencidos: acu.filter(a => a.vencido).length, abiertos: acu.filter(a => ['ABIERTO', 'EN_CURSO'].includes(a.estado)).length,
        rojos: cob.total, sinCM: cob.sin.length, ef, encargos: act.length, encVenc: act.filter(e => e.vencido).length
      })
    })
  }, [])
  if (d === false || d === null) return null
  const item = (l, v, c, vista) => (
    <div onClick={() => onIr(vista)} style={{ padding: '9px 11px', borderRadius: 10, background: 'var(--bg-page)', cursor: 'pointer', borderLeft: `3px solid ${c}` }}>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .3 }}>{l}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: c, marginTop: 2 }}>{v}</div>
    </div>
  )
  return (
    <Cd accent="var(--accent)">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>Comité de gestión · lo que hay que mirar hoy</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <Bt v="sec" sm onClick={() => onIr('sesion')}>🏛️ Sala de sesión</Bt>
          <Bt v="sec" sm onClick={onInforme} title="Informe de avance para el Directorio (imprimir → PDF)">📄 Informe de avance</Bt>
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
        {item('Próxima sesión', d.prox ? `${fFecha(d.prox.fecha)} · ${d.prox.comite_codigo}` : 'ninguna agendada', d.prox ? 'var(--accent)' : 'var(--danger)', 'calendario')}
        {item('Sesiones por cerrar', d.porCerrar, d.porCerrar ? 'var(--warning)' : 'var(--success)', 'calendario')}
        {item('Actas pendientes', d.sinActa, d.sinActa ? 'var(--warning)' : 'var(--success)', 'sesion')}
        {item('Acuerdos vencidos', `${d.vencidos} de ${d.abiertos} abiertos`, d.vencidos ? 'var(--danger)' : 'var(--success)', 'agenda')}
        {item('Rojos sin contramedida', `${d.sinCM} de ${d.rojos} rojos`, d.sinCM ? 'var(--danger)' : 'var(--success)', 'scorecard')}
        {item('Efectividad intervención', d.ef.pct == null ? 'sin casos aún' : d.ef.pct + '%', d.ef.pct == null ? 'var(--text-muted)' : d.ef.pct >= 60 ? 'var(--success)' : 'var(--warning)', 'efectividad')}
        {item('Comités de trabajo', `${d.encargos} activos · ${d.encVenc} vencidos`, d.encVenc ? 'var(--danger)' : 'var(--accent)', 'encargos')}
      </div>
    </Cd>
  )
}

export function PrcDashboard({ matriz, cat, alertas, onAbrir, onIrComites, onInforme }) {
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

      <Ayuda k="dash" titulo="Cómo leer este dashboard">
        Es la vista de gobierno de los procesos clave de la empresa. El <b>avance ponderado</b> pesa cada proceso por su score,
        así que refleja el avance donde importa y no el promedio simple. <b>Prioridad de ataque</b> y <b>Alertas</b> son
        listas clickeables: cada fila te lleva a la ficha del proceso. El avance de cada proceso <b>se calcula solo</b> desde
        su estado real (SOP 40 · flujograma 20 · capacitación 20 · implementación 20); en la pestaña Avance de la ficha
        se ve qué suma y qué falta.
      </Ayuda>

      {onIrComites && <GobiernoCard onIr={onIrComites} onInforme={onInforme} />}

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
