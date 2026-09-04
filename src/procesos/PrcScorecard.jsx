// src/procesos/PrcScorecard.jsx
// Reportería oficial (P21 fase 1.3): todos los indicadores de la matriz con su
// meta, semáforo, tendencia, historial y contramedidas. Acá se define qué mide
// la empresa, quién lo carga y qué comité lo revisa; y se ve el KPI de fondo:
// la efectividad de la intervención.
//
// Tablas: v_prc_scorecard · prc_kpis · prc_mediciones · v_prc_acuerdos · v_prc_sesiones

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../supabase'
import { Cd, Bt, Bd, Mt, Sheet, Vacio, Ayuda, Hint, Campo, css, hoy, uid, fFecha, puedeEditar } from './prcUI'
import { SEM, semDe, semaforoDe, medicionesDe, periodosEnRojo, efectividadIntervencion, coberturaContramedidas, reporteriaAlDia, sumarDias, periodoMes, METAS_COMITE, semComite } from './prcComite'

const ORDEN_SEM = { ROJO: 0, AMARILLO: 1, SIN_DATO: 2, SIN_META: 3, VERDE: 4 }
const FRECUENCIAS = ['DIARIA', 'SEMANAL', 'MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL']

export function PrcScorecard({ matriz, cat, cu, onAbrir, toast }) {
  const editable = puedeEditar(cu)
  const [sc, setSc] = useState([])
  const [med, setMed] = useState([])
  const [acu, setAcu] = useState([])
  const [ses, setSes] = useState([])
  const [loading, setLoading] = useState(true)
  const [fComite, setFComite] = useState('')
  const [fSem, setFSem] = useState('')
  const [fProc, setFProc] = useState('')
  const [soloAncla, setSoloAncla] = useState(false)
  const [sheet, setSheet] = useState(null)      // 'medicion' | 'meta' | 'contramedida' | 'nuevo'
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)

  const cargar = useCallback(async (silencioso) => {
    if (!silencioso) setLoading(true)
    const [a, b, c, d] = await Promise.all([
      supabase.from('v_prc_scorecard').select('*').order('proceso_id').order('orden'),
      supabase.from('prc_mediciones').select('*').order('periodo', { ascending: false }),
      supabase.from('v_prc_acuerdos').select('*').order('fecha_sesion', { ascending: false }),
      supabase.from('v_prc_sesiones').select('id, comite_codigo, numero, fecha, estado').order('fecha', { ascending: false })
    ])
    setSc(a.data || []); setMed(b.data || []); setAcu(c.data || []); setSes(d.data || [])
    if (!silencioso) setLoading(false)
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const nombres = useMemo(() => Object.fromEntries(matriz.map(p => [p.id, p.nombre])), [matriz])
  const lista = useMemo(() => sc
    .filter(k => !fComite || k.comite_codigo === fComite)
    .filter(k => !fProc || k.proceso_id === fProc)
    .filter(k => !fSem || k.semaforo === fSem || (fSem === 'SIN_DATO' && k.semaforo === 'SIN_META'))
    .filter(k => !soloAncla || k.es_kpi_ancla)
    .sort((a, b) => (ORDEN_SEM[a.semaforo] - ORDEN_SEM[b.semaforo]) || (b.proceso_score - a.proceso_score) || a.proceso_id.localeCompare(b.proceso_id)), [sc, fComite, fProc, fSem, soloAncla])

  const ef = useMemo(() => efectividadIntervencion(acu, sc, med), [acu, sc, med])
  const cob = useMemo(() => coberturaContramedidas(sc), [sc])
  const rep = useMemo(() => reporteriaAlDia(sc), [sc])
  const n = k => sc.filter(x => x.semaforo === k).length

  const err = e => toast('No se pudo guardar: ' + e.message, 'err')

  const guardarMedicion = async () => {
    if (!form.periodo?.trim()) return toast('Indica el período (ej. 2026-09).', 'err')
    if ((form.valor === '' || form.valor == null) && !form.cumple && !form.valor_texto) return toast('Registra el valor, o al menos si cumple o no.', 'err')
    setBusy(true)
    const { error } = await supabase.from('prc_mediciones').insert({
      id: uid(), kpi_id: form.kpi_id, proceso_id: form.proceso_id, periodo: form.periodo.trim(),
      valor: form.valor === '' || form.valor == null ? null : +form.valor, valor_texto: form.valor_texto || null,
      cumple: form.cumple === 'si' ? true : form.cumple === 'no' ? false : null, comentario: form.comentario || null, registrado_por: cu?.nombre || '—'
    })
    setBusy(false)
    if (error) return err(error)
    setSheet(null); toast('Medición registrada'); cargar(true)
  }
  const guardarMeta = async () => {
    setBusy(true)
    const fila = {
      meta_valor: form.meta_valor === '' || form.meta_valor == null ? null : +form.meta_valor, sentido: form.sentido || 'MAYOR_MEJOR',
      tolerancia_pct: form.tolerancia_pct === '' || form.tolerancia_pct == null ? 10 : +form.tolerancia_pct, meta: form.meta || null, unidad: form.unidad || null,
      fuente: form.fuente || null, comite_codigo: form.comite_codigo || null, frecuencia: form.frecuencia || null, responsable: form.responsable || null,
      es_kpi_ancla: !!form.es_kpi_ancla, activo: form.activo !== false, indicador: form.indicador?.trim() || undefined, definicion_operacional: form.definicion_operacional || null
    }
    let error
    if (form.id) ({ error } = await supabase.from('prc_kpis').update(fila).eq('id', form.id))
    else {
      if (!form.proceso_id || !form.indicador?.trim()) { setBusy(false); return toast('Elige el proceso y escribe el nombre del indicador.', 'err') }
      ;({ error } = await supabase.from('prc_kpis').insert({ ...fila, id: `${form.proceso_id}-K-${uid()}`, proceso_id: form.proceso_id, orden: sc.filter(k => k.proceso_id === form.proceso_id).length + 1 }))
    }
    setBusy(false)
    if (error) return err(error)
    setSheet(null); toast(form.id ? 'Indicador actualizado' : 'Indicador creado'); cargar(true)
  }
  const guardarContramedida = async () => {
    if (!form.acuerdo?.trim() || !form.responsable?.trim() || !form.compromiso) return toast('Contramedida, responsable y plazo son obligatorios.', 'err')
    setBusy(true)
    const k = sc.find(x => x.id === form.kpi_id)
    const sesion = ses.find(x => x.id === form.sesion_id)
    const { error } = await supabase.from('prc_agenda_comite').insert({
      id: uid(), comite_codigo: form.comite_codigo || k?.comite_codigo, proceso_id: k?.proceso_id || null, sesion_id: form.sesion_id || null, kpi_id: form.kpi_id,
      fecha_sesion: sesion?.fecha || hoy(), tipo: 'CONTRAMEDIDA', acuerdo: form.acuerdo.trim(), responsable: form.responsable.trim(),
      fecha_compromiso: form.compromiso, criterio_cierre: form.criterio_cierre || null, estado: 'ABIERTO'
    })
    setBusy(false)
    if (error) return err(error)
    if (k?.proceso_id) await supabase.from('prc_hitos').insert({ id: uid(), proceso_id: k.proceso_id, fecha: hoy(), tipo: 'COMITE', descripcion: `Contramedida sobre ${k.indicador}: ${form.acuerdo.trim()}`, responsable: form.responsable.trim() })
    setSheet(null); toast('Contramedida registrada'); cargar(true)
  }
  const abrirMeta = (k) => { setForm({ ...k, meta_valor: k.meta_valor ?? '', tolerancia_pct: k.tolerancia_pct ?? 10 }); setSheet('meta') }
  const abrirContramedida = (k) => {
    setForm({ kpi_id: k.id, comite_codigo: k.comite_codigo, responsable: k.responsable || '', compromiso: sumarDias(hoy(), 30), acuerdo: '', indicador: k.indicador,
      criterio_cierre: `${k.indicador} vuelve a ${k.meta_valor != null ? (k.sentido === 'MENOR_MEJOR' ? '≤ ' : '≥ ') + k.meta_valor : 'la meta'} en la medición de ${periodoMes(sumarDias(hoy(), 30))}`,
      sesion_id: (ses.find(s => s.comite_codigo === k.comite_codigo && s.estado === 'PLANIFICADA' && s.fecha >= hoy()) || {}).id || '' })
    setSheet('contramedida')
  }

  const tile = (l, v, sub, meta) => <Mt l={l} v={v == null ? '—' : v + '%'} sub={sub} c={v == null ? 'var(--text-muted)' : semDe(semComite(v, meta)).c} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      <Ayuda k="scorecard" titulo="Cómo se lee el scorecard">
        Es la <b>reportería oficial</b>: cada indicador tiene meta numérica, sentido (↑ mayor es mejor / ↓ menor es mejor) y una banda
        amarilla de tolerancia; con eso el semáforo se calcula solo al registrar la medición. <b>Sin dato se trata como rojo</b>. Cada rojo
        debe salir de la sesión con una <b>contramedida</b> (acuerdo con responsable y plazo). El indicador de fondo es la <b>efectividad de
        la intervención</b>: de los rojos que recibieron contramedida, cuántos salieron del rojo en los 2 períodos siguientes. Mide si
        reunirse cambia los resultados.
      </Ayuda>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(158px, 1fr))', gap: 10 }}>
        <Mt l="Indicadores" v={sc.length} sub={`${sc.filter(k => k.es_kpi_ancla).length} ancla · ${new Set(sc.map(k => k.proceso_id)).size} procesos`} />
        <Mt l="Semáforo" v={<span><span style={{ color: SEM.VERDE.c }}>{n('VERDE')}</span> <span style={{ color: SEM.AMARILLO.c }}>{n('AMARILLO')}</span> <span style={{ color: SEM.ROJO.c }}>{n('ROJO')}</span></span>} sub={`${n('SIN_DATO') + n('SIN_META')} sin dato o sin meta`} />
        {tile('Efectividad de la intervención', ef.pct, `${ef.efectivas} efectivas · ${ef.noEfectivas} no · ${ef.pendientes} pendientes`, METAS_COMITE.efectividad)}
        {tile('Cobertura de contramedidas', cob.pct, `${cob.con}/${cob.total} rojos con contramedida`, METAS_COMITE.cobertura)}
        {tile('Reportería al día', rep.pct, `${rep.alDia}/${rep.total} con medición reciente`, METAS_COMITE.reporteria)}
      </div>

      <Cd>
        <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={fComite} onChange={e => setFComite(e.target.value)} style={{ ...css.select, fontSize: 12.5, minWidth: 190 }}>
            <option value="">Todos los comités</option>{cat.comites.map(c => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
          </select>
          <select value={fProc} onChange={e => setFProc(e.target.value)} style={{ ...css.select, fontSize: 12.5, maxWidth: 260 }}>
            <option value="">Todos los procesos</option>{matriz.map(p => <option key={p.id} value={p.id}>{p.id} · {p.nombre}</option>)}
          </select>
          <select value={fSem} onChange={e => setFSem(e.target.value)} style={{ ...css.select, fontSize: 12.5 }}>
            <option value="">Todos los colores</option><option value="ROJO">Rojos</option><option value="AMARILLO">Amarillos</option><option value="VERDE">Verdes</option><option value="SIN_DATO">Sin dato / sin meta</option>
          </select>
          <label style={{ fontSize: 12.5, display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={soloAncla} onChange={e => setSoloAncla(e.target.checked)} /> Solo ancla ⚓</label>
          {editable && <Bt sm style={{ marginLeft: 'auto' }} onClick={() => { setForm({ sentido: 'MAYOR_MEJOR', tolerancia_pct: 10, frecuencia: 'MENSUAL', activo: true }); setSheet('meta') }}>＋ Indicador</Bt>}
        </div>
        {cob.sin.length > 0 && (
          <div style={{ marginTop: 10, padding: '9px 12px', borderRadius: 9, background: 'var(--danger-bg)', color: 'var(--danger-text)', fontSize: 12.5, borderLeft: '3px solid var(--danger)' }}>
            <b>{cob.sin.length} indicador(es) en rojo sin contramedida:</b> {cob.sin.slice(0, 6).map(k => `${k.indicador} (${k.proceso_id})`).join(' · ')}{cob.sin.length > 6 ? '…' : ''}
          </div>
        )}
      </Cd>

      <Cd style={{ padding: 0, overflow: 'hidden' }}>
        {loading && <Vacio txt="Cargando indicadores…" />}
        {!loading && lista.length === 0 && <Vacio ic="📈" txt="Sin indicadores con ese filtro." />}
        {!loading && lista.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={css.th}>Indicador</th><th style={css.th}>Proceso</th><th style={css.th}>Comité</th><th style={css.th}>Meta</th>
                <th style={css.th}>Último</th><th style={css.th}>Semáforo</th><th style={css.th}>Tend.</th><th style={css.th} title="Últimas 6 mediciones, de la más antigua a la más reciente">Historial</th>
                <th style={css.th}>Rojo hace</th><th style={css.th}>Contramedida</th><th style={css.th}></th>
              </tr></thead>
              <tbody>{lista.map(k => {
                const sm = semDe(k.semaforo)
                const hist = medicionesDe(k.id, med).slice(0, 6).reverse()
                const enRojo = periodosEnRojo(k, med)
                const cm = acu.filter(a => a.kpi_id === k.id && a.tipo === 'CONTRAMEDIDA' && ['ABIERTO', 'EN_CURSO'].includes(a.estado))[0]
                return (
                  <tr key={k.id} style={{ opacity: k.activo === false ? .5 : 1 }}>
                    <td style={css.td}>{k.es_kpi_ancla ? '⚓ ' : ''}<b>{k.indicador}</b>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{k.frecuencia || '—'}{k.responsable ? ` · ${k.responsable}` : ''}{k.fuente ? ` · ${k.fuente}` : ''}</div></td>
                    <td style={css.td}><span onClick={() => onAbrir(k.proceso_id)} style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 700 }}>{k.proceso_id}</span><div style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombres[k.proceso_id]}</div></td>
                    <td style={css.td}>{k.comite_codigo || '—'}</td>
                    <td style={{ ...css.td, whiteSpace: 'nowrap' }}>{k.meta_valor != null ? <b>{k.sentido === 'MENOR_MEJOR' ? '≤' : '≥'} {k.meta_valor}{k.unidad ? ' ' + k.unidad : ''}</b> : <span style={{ color: 'var(--warning)' }}>{k.meta || 'sin meta'}</span>}{k.meta_valor != null && <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>±{k.tolerancia_pct}% amarillo</div>}</td>
                    <td style={{ ...css.td, whiteSpace: 'nowrap' }}>{k.ult_valor ?? k.ult_valor_texto ?? '—'}{k.ult_periodo && <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{k.ult_periodo}</div>}</td>
                    <td style={css.td}><Bd c={sm.c} bg={sm.bg}>{sm.l}</Bd></td>
                    <td style={{ ...css.td, fontWeight: 800, color: k.tendencia === 'MEJORA' ? 'var(--success)' : k.tendencia === 'EMPEORA' ? 'var(--danger)' : 'var(--text-muted)' }}>{k.tendencia === 'MEJORA' ? '▲' : k.tendencia === 'EMPEORA' ? '▼' : k.tendencia === 'IGUAL' ? '=' : '—'}</td>
                    <td style={css.td}><div style={{ display: 'flex', gap: 2 }}>{hist.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>}{hist.map(m => { const s2 = semDe(semaforoDe(k, m)); return <span key={m.id} title={`${m.periodo}: ${m.valor ?? m.valor_texto ?? (m.cumple == null ? 's/d' : m.cumple ? 'cumple' : 'no cumple')}`} style={{ width: 14, height: 14, borderRadius: 3, background: s2.c, display: 'inline-block' }} /> })}</div></td>
                    <td style={css.td}>{enRojo ? <Bd c="var(--danger)">{enRojo} período{enRojo > 1 ? 's' : ''}</Bd> : '—'}</td>
                    <td style={css.td}>{cm ? <span title={cm.acuerdo}><Bd c={cm.vencido ? 'var(--danger)' : 'var(--success)'}>{cm.vencido ? 'vencida' : 'abierta'}</Bd><div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{cm.responsable} · {fFecha(cm.fecha_compromiso)}</div></span> : (k.semaforo === 'ROJO' || k.semaforo === 'AMARILLO') ? <Bd c="var(--danger)">falta</Bd> : '—'}</td>
                    <td style={{ ...css.td, whiteSpace: 'nowrap' }}>{editable && (<>
                      <Bt v="sec" sm onClick={() => { setForm({ kpi_id: k.id, proceso_id: k.proceso_id, periodo: periodoMes(), cumple: '', indicador: k.indicador }); setSheet('medicion') }}>Medir</Bt>{' '}
                      <Bt v="ghost" sm onClick={() => abrirMeta(k)} title="Meta, sentido, tolerancia, fuente y comité que lo revisa">Meta</Bt>{' '}
                      {(k.semaforo === 'ROJO' || k.semaforo === 'AMARILLO' || k.semaforo === 'SIN_DATO') && !cm && <Bt v={k.semaforo === 'SIN_DATO' ? 'ghost' : 'warn'} sm onClick={() => abrirContramedida(k)} title={k.semaforo === 'SIN_DATO' ? 'Sin dato se trata como rojo: acuerda quién carga la medición' : 'Acuerdo tipo contramedida ligado a este indicador'}>Contramedida</Bt>}
                    </>)}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        )}
      </Cd>

      {ef.detalle.length > 0 && (
        <Cd>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>Efectividad de la intervención · detalle</div>
          <Hint style={{ marginBottom: 8 }}>Cada contramedida se evalúa con las 2 mediciones siguientes a la sesión en que se acordó.</Hint>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={css.th}>Indicador</th><th style={css.th}>Contramedida</th><th style={css.th}>Acordada</th><th style={css.th}>Mediciones posteriores</th><th style={css.th}>Resultado</th></tr></thead>
            <tbody>{ef.detalle.map((d, i) => (
              <tr key={i}>
                <td style={css.td}><b>{d.kpi.indicador}</b><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.kpi.proceso_id}</div></td>
                <td style={css.td}>{d.acuerdo.acuerdo}<div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.acuerdo.responsable} · {d.acuerdo.estado.toLowerCase()}</div></td>
                <td style={{ ...css.td, whiteSpace: 'nowrap' }}>{fFecha(d.acuerdo.fecha_sesion)}</td>
                <td style={css.td}><div style={{ display: 'flex', gap: 4 }}>{d.mediciones.length === 0 && <span style={{ color: 'var(--text-muted)' }}>todavía ninguna</span>}{d.mediciones.map((m, j) => { const s2 = semDe(d.semaforos[j]); return <Bd key={m.id} c={s2.c} bg={s2.bg}>{m.periodo}: {m.valor ?? m.valor_texto ?? '—'}</Bd> })}</div></td>
                <td style={css.td}><Bd c={d.estado === 'EFECTIVA' ? 'var(--success)' : d.estado === 'NO_EFECTIVA' ? 'var(--danger)' : 'var(--text-muted)'}>{d.estado.toLowerCase().replace('_', ' ')}</Bd></td>
              </tr>
            ))}</tbody>
          </table>
        </Cd>
      )}

      {/* sheets */}
      <Sheet open={sheet === 'medicion'} onClose={() => setSheet(null)} title={`Registrar medición · ${form.indicador || ''}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 9 }}>
            <Campo l="Período" obligatorio hint="2026-09 · 2026-S36 · 2026-Q3"><input style={css.input} value={form.periodo || ''} onChange={e => setForm({ ...form, periodo: e.target.value })} /></Campo>
            <Campo l="Valor"><input type="number" step="any" style={css.input} value={form.valor ?? ''} onChange={e => setForm({ ...form, valor: e.target.value })} /></Campo>
            <Campo l="¿Cumple?" hint="Solo si no hay meta numérica."><select style={{ ...css.input, cursor: 'pointer' }} value={form.cumple || ''} onChange={e => setForm({ ...form, cumple: e.target.value })}><option value="">—</option><option value="si">Sí</option><option value="no">No</option></select></Campo>
          </div>
          <Campo l="Valor en texto (opcional)"><input style={css.input} value={form.valor_texto || ''} onChange={e => setForm({ ...form, valor_texto: e.target.value })} /></Campo>
          <Campo l="Comentario"><textarea rows={2} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }} value={form.comentario || ''} onChange={e => setForm({ ...form, comentario: e.target.value })} /></Campo>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><Bt v="sec" onClick={() => setSheet(null)}>Cancelar</Bt><Bt dis={busy} onClick={guardarMedicion}>Registrar</Bt></div>
        </div>
      </Sheet>

      <Sheet open={sheet === 'meta'} onClose={() => setSheet(null)} title={form.id ? `Definir indicador · ${form.indicador}` : 'Nuevo indicador'} ancho={680}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {!form.id && (
            <Campo l="Proceso" obligatorio><select style={{ ...css.input, cursor: 'pointer' }} value={form.proceso_id || ''} onChange={e => { const p = matriz.find(x => x.id === e.target.value); setForm({ ...form, proceso_id: e.target.value, comite_codigo: p?.comite_codigo || form.comite_codigo }) }}>
              <option value="">Elige el proceso</option>{matriz.map(p => <option key={p.id} value={p.id}>{p.id} · {p.nombre}</option>)}</select></Campo>
          )}
          <Campo l="Indicador" obligatorio><input style={css.input} value={form.indicador || ''} onChange={e => setForm({ ...form, indicador: e.target.value })} /></Campo>
          <Campo l="Definición operacional" hint="Fórmula exacta: numerador / denominador, fuente y corte."><textarea rows={2} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }} value={form.definicion_operacional || ''} onChange={e => setForm({ ...form, definicion_operacional: e.target.value })} /></Campo>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 9 }}>
            <Campo l="Meta numérica" hint="El semáforo se calcula con esto."><input type="number" step="any" style={css.input} value={form.meta_valor ?? ''} onChange={e => setForm({ ...form, meta_valor: e.target.value })} /></Campo>
            <Campo l="Sentido"><select style={{ ...css.input, cursor: 'pointer' }} value={form.sentido || 'MAYOR_MEJOR'} onChange={e => setForm({ ...form, sentido: e.target.value })}><option value="MAYOR_MEJOR">↑ mayor es mejor</option><option value="MENOR_MEJOR">↓ menor es mejor</option></select></Campo>
            <Campo l="Tolerancia %" hint="Banda amarilla."><input type="number" step="any" style={css.input} value={form.tolerancia_pct ?? 10} onChange={e => setForm({ ...form, tolerancia_pct: e.target.value })} /></Campo>
            <Campo l="Unidad"><input style={css.input} value={form.unidad || ''} onChange={e => setForm({ ...form, unidad: e.target.value })} placeholder="% · días · n" /></Campo>
          </div>
          <Campo l="Meta escrita (como aparece en el SOP)"><input style={css.input} value={form.meta || ''} onChange={e => setForm({ ...form, meta: e.target.value })} placeholder="Ej: ≥ 95% mensual" /></Campo>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 9 }}>
            <Campo l="Frecuencia"><select style={{ ...css.input, cursor: 'pointer' }} value={form.frecuencia || 'MENSUAL'} onChange={e => setForm({ ...form, frecuencia: e.target.value })}>{FRECUENCIAS.map(f => <option key={f}>{f}</option>)}</select></Campo>
            <Campo l="Responsable de cargar"><input style={css.input} value={form.responsable || ''} onChange={e => setForm({ ...form, responsable: e.target.value })} /></Campo>
            <Campo l="Comité que lo revisa"><select style={{ ...css.input, cursor: 'pointer' }} value={form.comite_codigo || ''} onChange={e => setForm({ ...form, comite_codigo: e.target.value })}><option value="">— (el del proceso)</option>{cat.comites.map(c => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}</select></Campo>
          </div>
          <Campo l="Fuente del dato"><input style={css.input} value={form.fuente || ''} onChange={e => setForm({ ...form, fuente: e.target.value })} placeholder="BSALE · ERP Outlet · planilla · Workera" /></Campo>
          <div style={{ display: 'flex', gap: 16, fontSize: 12.5 }}>
            <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={!!form.es_kpi_ancla} onChange={e => setForm({ ...form, es_kpi_ancla: e.target.checked })} /> Indicador ancla del proceso ⚓</label>
            <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={form.activo !== false} onChange={e => setForm({ ...form, activo: e.target.checked })} /> Activo (se revisa en comité)</label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><Bt v="sec" onClick={() => setSheet(null)}>Cancelar</Bt><Bt dis={busy} onClick={guardarMeta}>Guardar</Bt></div>
        </div>
      </Sheet>

      <Sheet open={sheet === 'contramedida'} onClose={() => setSheet(null)} title={`Contramedida · ${form.indicador || ''}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <Campo l="Contramedida" obligatorio hint="Qué se hará para sacar el indicador del rojo. Una acción concreta, no una intención."><textarea rows={3} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }} value={form.acuerdo || ''} onChange={e => setForm({ ...form, acuerdo: e.target.value })} /></Campo>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            <Campo l="Responsable" obligatorio><input style={css.input} value={form.responsable || ''} onChange={e => setForm({ ...form, responsable: e.target.value })} /></Campo>
            <Campo l="Plazo" obligatorio><input type="date" style={css.input} value={form.compromiso || ''} onChange={e => setForm({ ...form, compromiso: e.target.value })} /></Campo>
          </div>
          <Campo l="Criterio de cierre verificable"><input style={css.input} value={form.criterio_cierre || ''} onChange={e => setForm({ ...form, criterio_cierre: e.target.value })} /></Campo>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            <Campo l="Comité"><select style={{ ...css.input, cursor: 'pointer' }} value={form.comite_codigo || ''} onChange={e => setForm({ ...form, comite_codigo: e.target.value })}>{cat.comites.map(c => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}</select></Campo>
            <Campo l="Sesión (opcional)" hint="Si la acuerdas en sesión, cuélgala de ella."><select style={{ ...css.input, cursor: 'pointer' }} value={form.sesion_id || ''} onChange={e => setForm({ ...form, sesion_id: e.target.value })}><option value="">Sin sesión</option>{ses.filter(s => !form.comite_codigo || s.comite_codigo === form.comite_codigo).slice(0, 30).map(s => <option key={s.id} value={s.id}>N° {s.numero ?? ''} · {fFecha(s.fecha)} · {s.estado.toLowerCase()}</option>)}</select></Campo>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><Bt v="sec" onClick={() => setSheet(null)}>Cancelar</Bt><Bt dis={busy} onClick={guardarContramedida}>Registrar</Bt></div>
        </div>
      </Sheet>
    </div>
  )
}
