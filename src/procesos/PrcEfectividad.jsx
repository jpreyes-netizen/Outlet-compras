// src/procesos/PrcEfectividad.jsx
// El comité se mide a sí mismo (P21 fase 6): indicadores objetivos por comité
// contra las metas de P21, alertas de funcionamiento (ausencias seguidas,
// sobrecarga, sesiones sin acta, comités sin calendario) y autoevaluación
// trimestral de los integrantes.
//
// Tablas: v_prc_sesiones · prc_asistencia_comite · v_prc_acuerdos · prc_decisiones
//         v_prc_scorecard · prc_mediciones · v_prc_encargos · prc_eval_comite

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../supabase'
import { Cd, Bt, Bd, Mt, Sheet, Vacio, Ayuda, Hint, Campo, Barra, css, hoy, fFecha, puedeEditar } from './prcUI'
import { indicadoresComite, ausenciasSeguidas, cargaPersonas, semComite, semDe, METAS_COMITE, sumarDias, trimestreDe } from './prcComite'

const PERIODOS = [
  { k: 90, l: 'Últimos 90 días' }, { k: 30, l: 'Últimos 30 días' }, { k: 180, l: 'Últimos 6 meses' }, { k: 365, l: 'Último año' }
]
const DIMS = [
  { k: 'p_agenda', l: 'Agenda clara y cumplida', d: 'Orden del día enviado a tiempo y respetado' },
  { k: 'p_puntualidad', l: 'Puntualidad y duración', d: 'Empieza a la hora y dura entre 1 y 3 horas' },
  { k: 'p_datos', l: 'Decisiones con datos', d: 'Se decide mirando indicadores, no impresiones' },
  { k: 'p_decisiones', l: 'Calidad de las decisiones', d: 'Claras, con responsable y fundamento' },
  { k: 'p_seguimiento', l: 'Seguimiento de acuerdos', d: 'Lo acordado se revisa y se cumple' },
  { k: 'p_participacion', l: 'Participación', d: 'Todos aportan; nadie se resta de votar' }
]
const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export function PrcEfectividad({ matriz, cat, cu, toast }) {
  const editable = puedeEditar(cu)
  const [ses, setSes] = useState([]); const [asis, setAsis] = useState([]); const [acu, setAcu] = useState([])
  const [dec, setDec] = useState([]); const [sc, setSc] = useState([]); const [med, setMed] = useState([])
  const [enc, setEnc] = useState([]); const [evals, setEvals] = useState([])
  const [loading, setLoading] = useState(true)
  const [dias, setDias] = useState(90)
  const [comite, setComite] = useState('')
  const [sheet, setSheet] = useState(false)
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)

  const cargar = useCallback(async (silencioso) => {
    if (!silencioso) setLoading(true)
    const q = (t, sel = '*') => supabase.from(t).select(sel).then(r => (r.error ? [] : r.data || []))
    const [a, b, c, d, e, f, g, h] = await Promise.all([
      q('v_prc_sesiones'), q('prc_asistencia_comite'), q('v_prc_acuerdos'), q('prc_decisiones'),
      q('v_prc_scorecard'), q('prc_mediciones'), q('v_prc_encargos'), q('prc_eval_comite')
    ])
    setSes(a); setAsis(b); setAcu(c); setDec(d); setSc(e); setMed(f); setEnc(g); setEvals(h)
    if (!silencioso) setLoading(false)
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const desde = useMemo(() => sumarDias(hoy(), -dias), [dias])
  const ctx = useMemo(() => ({ sesiones: ses, acuerdos: acu, decisiones: dec, scorecard: sc, mediciones: med }), [ses, acu, dec, sc, med])
  const total = useMemo(() => indicadoresComite(comite || null, ctx, desde), [ctx, desde, comite])
  const porComite = useMemo(() => cat.comites.filter(c => !comite || c.codigo === comite).map(c => ({ ...c, ind: indicadoresComite(c.codigo, ctx, desde) })), [cat, ctx, desde, comite])
  const ausencias = useMemo(() => ausenciasSeguidas(ses, asis, comite || null), [ses, asis, comite])
  const carga = useMemo(() => cargaPersonas(enc), [enc])
  const sinActa = useMemo(() => ses.filter(s => s.estado === 'REALIZADA' && s.acta_estado === 'SIN_ACTA' && (!comite || s.comite_codigo === comite)), [ses, comite])
  const sinCalendario = useMemo(() => cat.comites.filter(c => c.codigo !== 'DIRECTORIO' && (!comite || c.codigo === comite) && !ses.some(s => s.comite_codigo === c.codigo && s.fecha >= hoy() && s.estado === 'PLANIFICADA')), [cat, ses, comite])
  const porCerrar = useMemo(() => ses.filter(s => s.estado === 'PLANIFICADA' && s.fecha < hoy() && (!comite || s.comite_codigo === comite)), [ses, comite])
  const tri = trimestreDe()
  const evalsTri = useMemo(() => evals.filter(e => e.periodo === tri && (!comite || e.comite_codigo === comite)), [evals, tri, comite])
  const promedios = useMemo(() => DIMS.map(d => {
    const vals = evalsTri.map(e => e[d.k]).filter(v => v != null)
    return { ...d, prom: vals.length ? Math.round(10 * vals.reduce((a, v) => a + v, 0) / vals.length) / 10 : null, n: vals.length }
  }), [evalsTri])

  const tile = (l, v, meta, sub) => <Mt l={l} v={v == null ? '—' : v + '%'} sub={`${sub || ''}${sub ? ' · ' : ''}meta ≥ ${meta}%`} c={v == null ? 'var(--text-muted)' : semDe(semComite(v, meta)).c} />

  const guardarEval = async () => {
    if (!form.comite_codigo) return toast('Elige el comité que evalúas.', 'err')
    if (DIMS.some(d => !form[d.k])) return toast('Puntúa las 6 dimensiones (1 a 5).', 'err')
    setBusy(true)
    const evaluador = cu?.nombre || 'anónimo'
    const fila = { id: `${form.comite_codigo}-${tri}-${slug(evaluador)}`, comite_codigo: form.comite_codigo, periodo: tri, evaluador, comentario: form.comentario || null }
    DIMS.forEach(d => { fila[d.k] = +form[d.k] })
    const { error } = await supabase.from('prc_eval_comite').upsert(fila)
    setBusy(false)
    if (error) return toast('No se pudo guardar: ' + error.message, 'err')
    setSheet(false); toast(`Autoevaluación ${tri} registrada`); cargar(true)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      <Ayuda k="efectividad" titulo="Cómo se evalúa el propio comité">
        Dos lentes. <b>Objetivo</b>: sesiones con quórum, asistencia, acuerdos cerrados a plazo, actas dentro de 24 horas, reportería
        al día, cobertura de contramedidas y <b>efectividad de la intervención</b> (¿los rojos que trató salieron del rojo?), contra las
        metas de P21. <b>Subjetivo</b>: cada integrante puntúa una vez por trimestre seis dimensiones del funcionamiento. Las alertas de
        abajo aplican los principios 12 (dos ausencias seguidas → reemplazo), 11 (plazo de 2 meses) y los límites de carga.
      </Ayuda>

      <Cd>
        <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={comite} onChange={e => setComite(e.target.value)} style={{ ...css.select, fontSize: 12.5, minWidth: 200 }}>
            <option value="">Todos los comités</option>{cat.comites.map(c => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
          </select>
          <select value={dias} onChange={e => setDias(+e.target.value)} style={{ ...css.select, fontSize: 12.5 }}>
            {PERIODOS.map(p => <option key={p.k} value={p.k}>{p.l}</option>)}
          </select>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>desde el {fFecha(desde)}</span>
          {editable && <Bt sm style={{ marginLeft: 'auto' }} onClick={() => { setForm({ comite_codigo: comite || cat.comites[0]?.codigo || '' }); setSheet(true) }} title={`Autoevaluación del trimestre ${tri}: una por integrante y comité`}>✎ Autoevaluación {tri}</Bt>}
        </div>
      </Cd>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(158px, 1fr))', gap: 10 }}>
        <Mt l="Sesiones" v={`${total.realizadas}/${total.sesionesPlan}`} sub={`${total.sinQuorum} sin quórum · ${total.pendientesCierre} por cerrar`} c="var(--accent)" />
        {tile('Con quórum', total.pctQuorum, METAS_COMITE.quorum)}
        {tile('Asistencia', total.asistencia, METAS_COMITE.asistencia)}
        {tile('Acuerdos a plazo', total.pctAcuerdosPlazo, METAS_COMITE.acuerdosPlazo, `${total.acuerdosCerrados} cerrados · ${total.vencidos} vencidos`)}
        {tile('Actas ≤ 24 h', total.pctActas, METAS_COMITE.actas, `${total.actasSin} sin acta`)}
        {tile('Reportería al día', total.reporteria.pct, METAS_COMITE.reporteria)}
        {tile('Cobertura contramedidas', total.cobertura.pct, METAS_COMITE.cobertura, `${total.rojos} rojos`)}
        {tile('Efectividad intervención', total.efectividad.pct, METAS_COMITE.efectividad, `${total.efectividad.efectivas}/${total.efectividad.evaluables} evaluables`)}
      </div>

      {(ausencias.length > 0 || carga.lideresExcedidos.length > 0 || carga.participantesExcedidos.length > 0 || sinActa.length > 0 || sinCalendario.length > 0 || porCerrar.length > 0) && (
        <Cd accent="var(--warning)">
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>Alertas de funcionamiento</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }}>
            {ausencias.map(a => <div key={a.comite + a.nombre}>🔴 <b>{a.nombre}</b> lleva <b>{a.n}</b> ausencias seguidas en {a.comite}: debe ser reemplazado por el director del comité (principio 12).</div>)}
            {carga.lideresExcedidos.map(x => <div key={'l' + x.nombre}>🟠 <b>{x.nombre}</b> lidera {x.n} comités de trabajo (máximo 2).</div>)}
            {carga.participantesExcedidos.map(x => <div key={'p' + x.nombre}>🟠 <b>{x.nombre}</b> participa en {x.n} comités de trabajo (máximo 4).</div>)}
            {sinActa.map(s => <div key={s.id}>🟠 {s.comite_codigo} sesión N° {s.numero ?? ''} del {fFecha(s.fecha)} realizada <b>sin acta emitida</b>.</div>)}
            {porCerrar.map(s => <div key={s.id}>🟡 {s.comite_codigo} sesión N° {s.numero ?? ''} del {fFecha(s.fecha)} ya pasó y sigue planificada: ciérrala o anúlala.</div>)}
            {sinCalendario.map(c => <div key={c.codigo}>🟡 <b>{c.nombre}</b> no tiene sesiones agendadas hacia adelante (fase 1: calendario del trimestre).</div>)}
          </div>
        </Cd>
      )}

      <Cd style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-1)', fontSize: 13.5, fontWeight: 700 }}>Indicadores por comité</div>
        {loading && <Vacio txt="Calculando…" />}
        {!loading && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={css.th}>Comité</th><th style={css.th}>Sesiones</th><th style={css.th}>Quórum</th><th style={css.th}>Asistencia</th>
                <th style={css.th}>Acuerdos a plazo</th><th style={css.th}>Vencidos</th><th style={css.th}>Actas ≤24h</th><th style={css.th}>Decisiones</th>
                <th style={css.th}>Scorecard</th><th style={css.th}>Cobertura</th><th style={css.th}>Efectividad</th><th style={css.th}>Próximas</th>
              </tr></thead>
              <tbody>{porComite.map(c => {
                const i = c.ind
                const celda = (v, meta) => <td style={{ ...css.td, fontWeight: 700, color: v == null ? 'var(--text-muted)' : semDe(semComite(v, meta)).c }}>{v == null ? '—' : v + '%'}</td>
                return (
                  <tr key={c.codigo}>
                    <td style={css.td}><b>{c.nombre}</b><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.periodicidad?.toLowerCase()} · {c.responsable}{c.reporta_a ? ` · reporta a ${c.reporta_a}` : ''}</div></td>
                    <td style={css.td}>{i.realizadas}/{i.sesionesPlan}{i.sinQuorum ? <div style={{ fontSize: 10.5, color: 'var(--warning)' }}>{i.sinQuorum} sin quórum</div> : null}</td>
                    {celda(i.pctQuorum, METAS_COMITE.quorum)}{celda(i.asistencia, METAS_COMITE.asistencia)}{celda(i.pctAcuerdosPlazo, METAS_COMITE.acuerdosPlazo)}
                    <td style={{ ...css.td, color: i.vencidos ? 'var(--danger)' : 'inherit', fontWeight: i.vencidos ? 700 : 400 }}>{i.vencidos}</td>
                    {celda(i.pctActas, METAS_COMITE.actas)}
                    <td style={css.td}>{i.decisiones}</td>
                    <td style={css.td}><span style={{ color: semDe('VERDE').c, fontWeight: 700 }}>{i.verdes}</span> · <span style={{ color: semDe('AMARILLO').c, fontWeight: 700 }}>{i.amarillos}</span> · <span style={{ color: semDe('ROJO').c, fontWeight: 700 }}>{i.rojos}</span> · <span style={{ color: 'var(--text-muted)' }}>{i.sinDato}</span></td>
                    {celda(i.cobertura.pct, METAS_COMITE.cobertura)}{celda(i.efectividad.pct, METAS_COMITE.efectividad)}
                    <td style={{ ...css.td, color: i.proximas ? 'inherit' : 'var(--danger)', fontWeight: i.proximas ? 400 : 700 }}>{i.proximas || 'ninguna'}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        )}
      </Cd>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 13 }}>
        <Cd>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>Autoevaluación {tri}</span><Bd c="var(--text-muted)">{evalsTri.length} respuesta(s)</Bd>
          </div>
          {evalsTri.length === 0 && <Vacio ic="✎" txt="Nadie ha respondido la autoevaluación de este trimestre. Cada integrante puntúa las 6 dimensiones una vez." />}
          {evalsTri.length > 0 && promedios.map(d => (
            <div key={d.k} style={{ marginBottom: 9 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}><span><b>{d.l}</b> <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>· {d.d}</span></span><b style={{ color: d.prom == null ? 'var(--text-muted)' : d.prom >= 4 ? 'var(--success)' : d.prom >= 3 ? 'var(--warning)' : 'var(--danger)' }}>{d.prom ?? '—'} / 5</b></div>
              <Barra v={(d.prom || 0) * 20} c={d.prom == null ? 'var(--border-2)' : d.prom >= 4 ? 'var(--success)' : d.prom >= 3 ? 'var(--warning)' : 'var(--danger)'} />
            </div>
          ))}
          {evalsTri.some(e => e.comentario) && (<>
            <div style={{ fontSize: 12.5, fontWeight: 700, margin: '10px 0 5px' }}>Comentarios</div>
            {evalsTri.filter(e => e.comentario).map(e => <div key={e.id} style={{ fontSize: 12, padding: '6px 9px', borderRadius: 8, background: 'var(--bg-page)', marginBottom: 5 }}>“{e.comentario}” <span style={{ color: 'var(--text-muted)' }}>— {e.evaluador}, {e.comite_codigo}</span></div>)}
          </>)}
        </Cd>
        <Cd>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>Carga en comités de trabajo</div>
          {carga.lideres.length === 0 && carga.participantes.length === 0 && <Vacio ic="🧩" txt="Sin comités de trabajo activos." />}
          {carga.lideres.length > 0 && (<>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>LÍDERES (máx. 2)</div>
            {carga.lideres.map(x => <div key={x.nombre} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid var(--border-1)' }}><span>{x.nombre}</span><Bd c={x.n > 2 ? 'var(--danger)' : 'var(--text-muted)'}>{x.n}</Bd></div>)}
          </>)}
          {carga.participantes.length > 0 && (<>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', margin: '10px 0 4px' }}>PARTICIPANTES (máx. 4)</div>
            {carga.participantes.slice(0, 12).map(x => <div key={x.nombre} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid var(--border-1)' }}><span>{x.nombre}</span><Bd c={x.n > 4 ? 'var(--danger)' : 'var(--text-muted)'}>{x.n}</Bd></div>)}
          </>)}
        </Cd>
      </div>

      <Sheet open={sheet} onClose={() => setSheet(false)} title={`Autoevaluación del comité · ${tri}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <Campo l="Comité que evalúas" obligatorio><select style={{ ...css.input, cursor: 'pointer' }} value={form.comite_codigo || ''} onChange={e => setForm({ ...form, comite_codigo: e.target.value })}>
            <option value="">Elige el comité</option>{cat.comites.map(c => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}</select></Campo>
          {DIMS.map(d => (
            <div key={d.k} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}><div style={{ fontSize: 12.5, fontWeight: 600 }}>{d.l}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.d}</div></div>
              <div style={{ display: 'flex', gap: 4 }}>{[1, 2, 3, 4, 5].map(v => (
                <button key={v} onClick={() => setForm({ ...form, [d.k]: v })} style={{ width: 34, height: 34, minHeight: 34, borderRadius: 8, cursor: 'pointer', fontWeight: 800, fontSize: 13, border: `1px solid ${form[d.k] === v ? 'var(--accent)' : 'var(--border-2)'}`, background: form[d.k] === v ? 'var(--accent)' : 'var(--bg-surface)', color: form[d.k] === v ? '#fff' : 'var(--text-secondary)' }}>{v}</button>
              ))}</div>
            </div>
          ))}
          <Campo l="Comentario (opcional)" hint="Qué habría que cambiar en el funcionamiento del comité."><textarea rows={2} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }} value={form.comentario || ''} onChange={e => setForm({ ...form, comentario: e.target.value })} /></Campo>
          <Hint>Responde como <b>{cu?.nombre || 'usuario'}</b>. Una respuesta por persona, comité y trimestre; si vuelves a enviar, reemplaza la anterior.</Hint>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><Bt v="sec" onClick={() => setSheet(false)}>Cancelar</Bt><Bt dis={busy} onClick={guardarEval}>Guardar</Bt></div>
        </div>
      </Sheet>
    </div>
  )
}
