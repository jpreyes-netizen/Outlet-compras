// src/procesos/PrcEncargos.jsx
// Comités de trabajo por proceso (P37): el comité de gobierno encarga un proceso
// a un equipo con líder, integrantes y plazo de 2 meses; el equipo lo lleva por
// las 7 fases (Activación → Bajada). Reglas: impar, mínimo 3, líder ≤ 2, participante ≤ 4,
// piloto ≥ 14 días, reasignación por incumplimiento (principios 5, 7, 10, 11, 13).
//
// Tablas: prc_encargos · prc_encargo_fases · v_prc_encargos · prc_decisiones

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../supabase'
import { Cd, Bt, Bd, Mt, Sheet, Vacio, Ayuda, Hint, Campo, Chips, Barra, css, hoy, uid, fFecha, puedeEditar, puedeAprobar } from './prcUI'
import { FASES_P37, validarConformacion, cargaPersonas, sumarDias, diasEntre } from './prcComite'

const EST = {
  ACTIVO: { l: 'Activo', c: 'var(--accent)' }, EN_PILOTO: { l: 'En piloto', c: 'var(--info)' },
  EN_APROBACION: { l: 'En aprobación', c: 'var(--warning)' }, CERRADO: { l: 'Cerrado', c: 'var(--success)' },
  REASIGNADO: { l: 'Reasignado', c: 'var(--danger)' }, CANCELADO: { l: 'Cancelado', c: 'var(--text-muted)' }
}
const EST_FASE = { PENDIENTE: 'var(--text-muted)', EN_CURSO: 'var(--accent)', COMPLETADA: 'var(--success)', OMITIDA: 'var(--warning)' }
const ACTIVOS = ['ACTIVO', 'EN_PILOTO', 'EN_APROBACION']
const sumarMeses = (f, n) => { const [y, m, d] = f.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, d)); return t.toISOString().slice(0, 10) }

/* ═══════════════════════════════════════════════════════════════════════════
   Sheet de asignación / reasignación (lo usan Encargos y la sala de sesión)
   ═══════════════════════════════════════════════════════════════════════════ */
export function EncargoSheet({ open, onClose, matriz, cat, cu, toast, usuarios = [], sesion, comiteCodigo, encargos, reasignarDe, onGuardado }) {
  const [form, setForm] = useState({})
  const [lista, setLista] = useState(encargos || [])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const base = reasignarDe
      ? { proceso_id: reasignarDe.proceso_id, comite_codigo: reasignarDe.comite_codigo || comiteCodigo || '', lider: '', integrantes: [], secretario: '', objetivo: reasignarDe.objetivo || '', fuera_de_alcance: reasignarDe.fuera_de_alcance || '', motivo: '' }
      : { proceso_id: '', comite_codigo: comiteCodigo || '', lider: '', integrantes: [], secretario: '', objetivo: '', fuera_de_alcance: '' }
    setForm({ ...base, fecha_inicio: hoy(), fecha_limite: sumarMeses(hoy(), 2) })
    if (!encargos) supabase.from('v_prc_encargos').select('*').then(r => setLista(r.data || []))
    else setLista(encargos)
  }, [open, reasignarDe, comiteCodigo, encargos])

  const conEncargo = useMemo(() => new Set(lista.filter(e => ACTIVOS.includes(e.estado)).map(e => e.proceso_id)), [lista])
  const candidatos = useMemo(() => matriz.filter(p => p.estado_implementacion !== 'IMPLEMENTADO' && (!conEncargo.has(p.id) || p.id === reasignarDe?.proceso_id))
    .sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id)), [matriz, conEncargo, reasignarDe])
  const integrantes = useMemo(() => {
    const l = [...(form.integrantes || [])]
    if (form.lider?.trim() && !l.some(x => x.toLowerCase() === form.lider.trim().toLowerCase())) l.unshift(form.lider.trim())
    return l
  }, [form.integrantes, form.lider])
  const val = useMemo(() => validarConformacion({ lider: form.lider, integrantes, encargos: lista, excluirId: reasignarDe?.id }), [form.lider, integrantes, lista, reasignarDe])
  const sugeridos = useMemo(() => [...new Set([...usuarios.map(u => u.nombre), ...matriz.map(p => p.dueno_persona || p.dueno_cargo).filter(Boolean), ...(cat.comites || []).flatMap(c => c.integrantes || [])])].sort(), [usuarios, matriz, cat])

  const guardar = async () => {
    if (!form.proceso_id) return toast('Elige el proceso que se encarga.', 'err')
    if (!val.ok) return toast(val.errores[0], 'err')
    if (reasignarDe && !form.motivo?.trim()) return toast('Indica el motivo de la reasignación (principio 13).', 'err')
    setBusy(true)
    const id = `ENC-${form.proceso_id}-${form.fecha_inicio.replace(/-/g, '')}-${uid().slice(-3)}`
    const { error } = await supabase.from('prc_encargos').insert({
      id, proceso_id: form.proceso_id, comite_codigo: form.comite_codigo || null, lider: form.lider.trim(), secretario: form.secretario || null,
      integrantes, objetivo: form.objetivo || null, fuera_de_alcance: form.fuera_de_alcance || null,
      fecha_inicio: form.fecha_inicio, fecha_limite: form.fecha_limite || null, fase_actual: 1, estado: 'ACTIVO',
      reasignado_de: reasignarDe?.id || null, creado_por: cu?.nombre || '—'
    })
    if (error) { setBusy(false); return toast('No se pudo crear el comité de trabajo: ' + error.message, 'err') }
    if (reasignarDe) {
      await supabase.from('prc_encargos').update({ estado: 'REASIGNADO', motivo_reasignacion: form.motivo.trim(), fecha_cierre: hoy() }).eq('id', reasignarDe.id)
    }
    // decisión formal si venimos de una sesión con quórum
    if (sesion && !['SIN_QUORUM', 'ANULADA'].includes(sesion.estado)) {
      const did = uid()
      const p = matriz.find(x => x.id === form.proceso_id)
      const { error: e2 } = await supabase.from('prc_decisiones').insert({
        id: did, sesion_id: sesion.id, comite_codigo: sesion.comite_codigo, proceso_id: form.proceso_id, encargo_id: id, fecha: sesion.fecha,
        tipo: reasignarDe ? 'REASIGNACION' : 'ASIGNACION_PROCESO', unanime: true, resultado: 'APROBADA',
        decision: `${reasignarDe ? 'Se reasigna' : 'Se encarga'} ${form.proceso_id} ${p?.nombre || ''} al comité de trabajo liderado por ${form.lider.trim()} (${integrantes.length} integrantes), con plazo al ${fFecha(form.fecha_limite)}.`,
        fundamento: reasignarDe ? `Reasignación por incumplimiento: ${form.motivo.trim()}` : (form.objetivo || null), registrada_por: cu?.nombre || '—'
      })
      if (!e2) await supabase.from('prc_encargos').update({ decision_id: did }).eq('id', id)
    }
    setBusy(false)
    toast(reasignarDe ? 'Comité de trabajo reasignado' : 'Proceso encargado al comité de trabajo')
    onGuardado?.(id)
  }

  return (
    <Sheet open={open} onClose={onClose} title={reasignarDe ? `Reasignar comité de trabajo · ${reasignarDe.proceso_id}` : 'Encargar proceso a un comité de trabajo'} ancho={680}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        <Campo l="Proceso" obligatorio hint="Solo procesos sin comité de trabajo activo y no implementados, ordenados por score.">
          <select style={{ ...css.input, cursor: 'pointer' }} value={form.proceso_id || ''} disabled={!!reasignarDe}
            onChange={e => { const p = matriz.find(x => x.id === e.target.value); setForm({ ...form, proceso_id: e.target.value, comite_codigo: form.comite_codigo || p?.comite_codigo || '' }) }}>
            <option value="">Elige el proceso</option>
            {candidatos.map(p => <option key={p.id} value={p.id}>{p.id} · {p.nombre} · score {p.score}</option>)}
          </select>
        </Campo>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
          <Campo l="Comité de gobierno que asigna"><select style={{ ...css.input, cursor: 'pointer' }} value={form.comite_codigo || ''} onChange={e => setForm({ ...form, comite_codigo: e.target.value })}>
            <option value="">—</option>{(cat.comites || []).map(c => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}</select></Campo>
          <Campo l="Líder del comité de trabajo" obligatorio hint="Máximo 2 comités simultáneos por líder."><input style={css.input} list="prc-enc-personas" value={form.lider || ''} onChange={e => setForm({ ...form, lider: e.target.value })} /></Campo>
        </div>
        <Campo l="Integrantes (incluye al líder)" obligatorio hint="Impar, mínimo 3 y al menos uno de otra dirección o área (principios 5 y 7). Máximo 4 comités simultáneos por participante.">
          <Chips valores={form.integrantes || []} onChange={v => setForm({ ...form, integrantes: v })} sugerencias={sugeridos} ph="Nombre o cargo — escribe y Enter" />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            <Bd c={integrantes.length >= 3 && integrantes.length % 2 === 1 ? 'var(--success)' : 'var(--danger)'}>{integrantes.length} integrante(s) {integrantes.length >= 3 && integrantes.length % 2 === 1 ? '· impar ✓' : '· debe ser impar ≥ 3'}</Bd>
            {val.errores.map((x, i) => <Bd key={i} c="var(--danger)">{x}</Bd>)}
          </div>
        </Campo>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 9 }}>
          <Campo l="Secretario/a de actas"><input style={css.input} list="prc-enc-personas" value={form.secretario || ''} onChange={e => setForm({ ...form, secretario: e.target.value })} /></Campo>
          <Campo l="Inicio"><input type="date" style={css.input} value={form.fecha_inicio || ''} onChange={e => setForm({ ...form, fecha_inicio: e.target.value, fecha_limite: e.target.value ? sumarMeses(e.target.value, 2) : form.fecha_limite })} /></Campo>
          <Campo l="Plazo (2 meses)" hint="Principio 11. Extenderlo es decisión del comité de gobierno."><input type="date" style={css.input} value={form.fecha_limite || ''} onChange={e => setForm({ ...form, fecha_limite: e.target.value })} /></Campo>
        </div>
        <Campo l="Objetivo del encargo" hint="Qué problema debe resolver el proceso (se afina en el encuadre, fase 2)."><textarea rows={2} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }} value={form.objetivo || ''} onChange={e => setForm({ ...form, objetivo: e.target.value })} /></Campo>
        <Campo l="Qué queda explícitamente fuera"><input style={css.input} value={form.fuera_de_alcance || ''} onChange={e => setForm({ ...form, fuera_de_alcance: e.target.value })} /></Campo>
        {reasignarDe && <Campo l="Motivo de la reasignación" obligatorio hint="Queda en la decisión y en la bitácora del proceso (principio 13)."><textarea rows={2} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }} value={form.motivo || ''} onChange={e => setForm({ ...form, motivo: e.target.value })} /></Campo>}
        <Hint>{sesion ? `Queda registrado como decisión de la sesión N° ${sesion.numero ?? ''} del ${fFecha(sesion.fecha)}.` : 'Si lo asignas desde la sala de sesión, queda como decisión formal del comité.'} {val.avisos[0]}</Hint>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Bt v="sec" onClick={onClose}>Cancelar</Bt>
          <Bt dis={busy || !val.ok || !form.proceso_id} onClick={guardar}>{busy ? 'Guardando…' : reasignarDe ? 'Reasignar' : 'Encargar proceso'}</Bt>
        </div>
        <datalist id="prc-enc-personas">{sugeridos.map(n => <option key={n} value={n} />)}</datalist>
      </div>
    </Sheet>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Vista principal
   ═══════════════════════════════════════════════════════════════════════════ */
export function PrcEncargos({ matriz, cat, cu, onAbrir, toast }) {
  const editable = puedeEditar(cu)
  const aprueba = puedeAprobar(cu)
  const [encargos, setEncargos] = useState([])
  const [fases, setFases] = useState([])
  const [sesiones, setSesiones] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('activos')
  const [comite, setComite] = useState('')
  const [selId, setSelId] = useState(null)
  const [sheet, setSheet] = useState(null)          // 'nuevo' | 'reasignar'
  const [edit, setEdit] = useState({})              // edición local de fases {faseId: {campo: valor}}

  const cargar = useCallback(async (silencioso) => {
    if (!silencioso) setLoading(true)
    const [e, f, s, u] = await Promise.all([
      supabase.from('v_prc_encargos').select('*').order('fecha_limite'),
      supabase.from('prc_encargo_fases').select('*').order('fase'),
      supabase.from('v_prc_sesiones').select('id, comite_codigo, numero, fecha, estado').order('fecha', { ascending: false }),
      supabase.from('usuarios').select('id, nombre, cargo, rol').limit(200)
    ])
    setEncargos(e.data || []); setFases(f.data || []); setSesiones(s.data || []); setUsuarios(u.error ? [] : (u.data || []))
    if (!silencioso) setLoading(false)
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const lista = useMemo(() => encargos
    .filter(e => filtro === 'todos' || (filtro === 'activos' ? ACTIVOS.includes(e.estado) : e.estado === filtro))
    .filter(e => !comite || e.comite_codigo === comite)
    .sort((a, b) => (b.vencido ? 1 : 0) - (a.vencido ? 1 : 0) || String(a.fecha_limite).localeCompare(String(b.fecha_limite))), [encargos, filtro, comite])
  const sel = useMemo(() => encargos.find(e => e.id === selId) || null, [encargos, selId])
  const fasesSel = useMemo(() => fases.filter(f => f.encargo_id === selId).sort((a, b) => a.fase - b.fase), [fases, selId])
  const proc = useMemo(() => matriz.find(p => p.id === sel?.proceso_id), [matriz, sel])
  const carga = useMemo(() => cargaPersonas(encargos), [encargos])

  const kpi = useMemo(() => {
    const act = encargos.filter(e => ACTIVOS.includes(e.estado))
    const cerr = encargos.filter(e => e.estado === 'CERRADO')
    const enPlazo = cerr.filter(e => e.fecha_cierre && e.fecha_limite && e.fecha_cierre <= e.fecha_limite)
    return { activos: act.length, vencidos: act.filter(e => e.vencido).length, cerrados: cerr.length,
      pctPlazo: cerr.length ? Math.round(100 * enPlazo.length / cerr.length) : null, reasignados: encargos.filter(e => e.estado === 'REASIGNADO').length }
  }, [encargos])

  const err = (e) => toast('No se pudo guardar: ' + e.message, 'err')
  const updEnc = async (patch) => {
    const { error } = await supabase.from('prc_encargos').update(patch).eq('id', sel.id)
    if (error) return err(String(error.message).includes('piloto_check') ? { message: 'el piloto debe durar al menos 14 días (principio 10)' } : error)
    cargar(true)
  }
  const updFase = async (f, patch) => { const { error } = await supabase.from('prc_encargo_fases').update(patch).eq('id', f.id); if (error) return err(error); cargar(true) }

  const avanzar = async () => {
    const actual = fasesSel.find(f => f.fase === sel.fase_actual)
    if (!actual) return
    if (sel.fase_actual === 5 && !sel.piloto_ok) return toast('Para pasar de Piloto a Aprobación registra las fechas del piloto: mínimo 14 días (principio 10).', 'err')
    if (sel.fase_actual >= 7) return toast('Ya está en la última fase. Cierra el comité de trabajo cuando el proceso esté implementado.')
    await supabase.from('prc_encargo_fases').update({ estado: 'COMPLETADA', fecha_fin: actual.fecha_fin || hoy(), fecha_inicio: actual.fecha_inicio || hoy() }).eq('id', actual.id)
    const sig = fasesSel.find(f => f.fase === sel.fase_actual + 1)
    if (sig) await supabase.from('prc_encargo_fases').update({ estado: 'EN_CURSO', fecha_inicio: hoy() }).eq('id', sig.id)
    const nf = sel.fase_actual + 1
    const estado = nf === 5 ? 'EN_PILOTO' : nf === 6 ? 'EN_APROBACION' : 'ACTIVO'
    await updEnc({ fase_actual: nf, estado })
    toast(`Fase ${nf} · ${FASES_P37[nf - 1]} en curso`)
  }
  const cerrar = async () => {
    const f7 = fasesSel.find(f => f.fase === 7)
    if (f7 && f7.estado !== 'COMPLETADA') await supabase.from('prc_encargo_fases').update({ estado: 'COMPLETADA', fecha_fin: hoy() }).eq('id', f7.id)
    await updEnc({ estado: 'CERRADO', fecha_cierre: hoy(), fase_actual: 7 })
    toast('Comité de trabajo cerrado. El proceso queda en manos de su dueño.')
  }
  const guardarPiloto = async (campo, valor) => {
    const patch = { [campo]: valor || null }
    const ini = campo === 'piloto_inicio' ? valor : sel.piloto_inicio, fin = campo === 'piloto_fin' ? valor : sel.piloto_fin
    if (ini && fin && diasEntre(ini, fin) < 14) return toast(`El piloto dura ${diasEntre(ini, fin)} días: el mínimo es 14 (principio 10).`, 'err')
    await updEnc(patch)
  }

  const evidencia = (fase) => {
    if (!proc) return null
    if (fase === 4) return proc.estado_sop !== 'NO_EXISTE' || proc.pct_sop > 0 ? 'SOP en redacción en el ERP' : null
    if (fase === 6) return proc.sop_aprobado && proc.flujograma_ok ? 'SOP y flujograma vigentes ✓' : proc.sop_aprobado ? 'SOP vigente · falta flujograma' : null
    if (fase === 7) return proc.capacitacion_ok && proc.medicion_ok ? 'Capacitación y medición registradas ✓' : proc.capacitacion_ok ? 'Capacitación registrada · falta medición' : proc.medicion_ok ? 'Medición registrada · falta capacitación' : null
    return null
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      <Ayuda k="encargos" titulo="Cómo funcionan los comités de trabajo (P37)">
        El comité de gobierno <b>encarga</b> un proceso a un comité de trabajo: líder, integrantes (impar, mínimo 3, alguien de otra
        área) y <b>plazo de 2 meses</b>. El equipo lo lleva por las 7 fases —Activación, Encuadre, Diagnóstico, Diseño, Piloto (mínimo
        2 semanas), Aprobación y Bajada— registrando entregable y sesión de cada una. Si el plazo vence sin entrega, el comité de
        gobierno decide: extender con fecha, cerrar o <b>reasignar</b> a otro equipo (principio 13). Un líder no lleva más de 2 comités;
        un participante, no más de 4.
      </Ayuda>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(158px, 1fr))', gap: 10 }}>
        <Mt l="Activos" v={kpi.activos} sub="En alguna de las 7 fases" c="var(--accent)" />
        <Mt l="Fuera de plazo" v={kpi.vencidos} sub="Superan los 2 meses" c={kpi.vencidos ? 'var(--danger)' : 'var(--success)'} />
        <Mt l="Cerrados en plazo" v={kpi.pctPlazo == null ? '—' : kpi.pctPlazo + '%'} sub={`${kpi.cerrados} cerrados · meta ≥ 80%`} c={kpi.pctPlazo == null ? 'var(--text-muted)' : kpi.pctPlazo >= 80 ? 'var(--success)' : 'var(--warning)'} />
        <Mt l="Reasignados" v={kpi.reasignados} sub="Por incumplimiento (meta 0)" c={kpi.reasignados ? 'var(--warning)' : 'var(--success)'} />
        <Mt l="Sobrecarga" v={carga.lideresExcedidos.length + carga.participantesExcedidos.length} sub="Líderes > 2 · participantes > 4" c={carga.lideresExcedidos.length + carga.participantesExcedidos.length ? 'var(--danger)' : 'var(--success)'} />
      </div>

      <Cd>
        <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={filtro} onChange={e => setFiltro(e.target.value)} style={{ ...css.select, fontSize: 12.5 }}>
            <option value="activos">Activos</option><option value="todos">Todos</option>
            {Object.keys(EST).map(k => <option key={k} value={k}>{EST[k].l}</option>)}
          </select>
          <select value={comite} onChange={e => setComite(e.target.value)} style={{ ...css.select, fontSize: 12.5, minWidth: 200 }}>
            <option value="">Todos los comités</option>{cat.comites.map(c => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
          </select>
          {editable && <Bt sm style={{ marginLeft: 'auto' }} onClick={() => setSheet('nuevo')} title="Encarga un proceso a un comité de trabajo con líder, integrantes y plazo">＋ Encargar proceso</Bt>}
        </div>
        {(carga.lideresExcedidos.length > 0 || carga.participantesExcedidos.length > 0) && (
          <div style={{ marginTop: 10, padding: '9px 12px', borderRadius: 9, background: 'var(--danger-bg)', color: 'var(--danger-text)', fontSize: 12.5, borderLeft: '3px solid var(--danger)' }}>
            <b>Sobrecarga:</b> {carga.lideresExcedidos.map(x => `${x.nombre} lidera ${x.n}`).join(' · ')}{carga.lideresExcedidos.length && carga.participantesExcedidos.length ? ' · ' : ''}{carga.participantesExcedidos.map(x => `${x.nombre} participa en ${x.n}`).join(' · ')}. Redistribuir antes de asignar más.
          </div>
        )}
      </Cd>

      {loading && <Cd><Vacio txt="Cargando comités de trabajo…" /></Cd>}
      {!loading && lista.length === 0 && <Cd><Vacio ic="🧩" txt="No hay comités de trabajo con ese filtro. Encarga el primer proceso: los de score 9 sin SOP aprobado son los candidatos naturales." /></Cd>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
        {lista.map(e => {
          const es = EST[e.estado] || EST.ACTIVO
          return (
            <div key={e.id} onClick={() => setSelId(e.id === selId ? null : e.id)} style={{
              ...css.card, cursor: 'pointer', borderLeft: `3px solid ${e.vencido ? 'var(--danger)' : es.c}`, outline: selId === e.id ? '2px solid var(--accent)' : 'none'
            }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: 12, color: 'var(--accent)' }}>{e.proceso_id}</span>
                <span style={{ fontSize: 13, fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.proceso_nombre}</span>
                <Bd c={es.c}>{es.l}</Bd>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '4px 0 8px' }}>
                Líder <b style={{ color: 'var(--text-secondary)' }}>{e.lider}</b> · {(e.integrantes || []).length} integrantes · {e.comite_codigo || '—'}
              </div>
              <div style={{ display: 'flex', gap: 3, marginBottom: 6 }}>
                {FASES_P37.map((n, i) => {
                  const f = fases.find(x => x.encargo_id === e.id && x.fase === i + 1)
                  const c = f?.estado === 'COMPLETADA' ? 'var(--success)' : f?.estado === 'EN_CURSO' ? 'var(--accent)' : f?.estado === 'OMITIDA' ? 'var(--warning)' : 'var(--border-2)'
                  return <div key={i} title={`${i + 1}. ${n}${f ? ' · ' + f.estado.toLowerCase() : ''}`} style={{ flex: 1, height: 8, borderRadius: 4, background: c }} />
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, alignItems: 'center' }}>
                <span>Fase {e.fase_actual} · {e.fase_actual_nombre}</span>
                <Bd c={e.estado === 'CERRADO' ? 'var(--success)' : e.vencido ? 'var(--danger)' : e.dias_restantes <= 10 ? 'var(--warning)' : 'var(--text-muted)'}>
                  {e.estado === 'CERRADO' ? `cerrado ${fFecha(e.fecha_cierre)}` : e.estado === 'REASIGNADO' ? 'reasignado' : e.vencido ? `vencido hace ${Math.abs(e.dias_restantes)} d` : `${e.dias_restantes} d para el ${fFecha(e.fecha_limite)}`}
                </Bd>
              </div>
            </div>
          )
        })}
      </div>

      {sel && (
        <Cd accent={sel.vencido ? 'var(--danger)' : (EST[sel.estado] || EST.ACTIVO).c}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ flex: 1, minWidth: 280 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 16, fontWeight: 800 }}>{sel.proceso_id} · {sel.proceso_nombre}</span>
                <Bd c={(EST[sel.estado] || EST.ACTIVO).c}>{(EST[sel.estado] || EST.ACTIVO).l}</Bd>
                {sel.vencido && <Bd c="var(--danger)">fuera de plazo · principio 13</Bd>}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
                Líder <b>{sel.lider}</b>{sel.secretario ? ` · secretaría ${sel.secretario}` : ''} · inicio {fFecha(sel.fecha_inicio)} · plazo {fFecha(sel.fecha_limite)}
                {sel.comite_nombre ? ` · asignado por ${sel.comite_nombre}` : ''}{sel.reasignado_de ? ' · viene de una reasignación' : ''}
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>{(sel.integrantes || []).map(x => <Bd key={x} c="var(--accent)">{x}</Bd>)}</div>
              {sel.objetivo && <div style={{ fontSize: 12.5, marginTop: 6 }}><b>Objetivo:</b> {sel.objetivo}</div>}
              {sel.fuera_de_alcance && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}><b>Fuera de alcance:</b> {sel.fuera_de_alcance}</div>}
              {sel.motivo_reasignacion && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 2 }}><b>Reasignado:</b> {sel.motivo_reasignacion}</div>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Bt v="sec" sm onClick={() => onAbrir(sel.proceso_id)}>Abrir ficha</Bt>
              {editable && ACTIVOS.includes(sel.estado) && sel.fase_actual < 7 && <Bt sm onClick={avanzar} title="Completa la fase actual y abre la siguiente">Avanzar a fase {sel.fase_actual + 1} →</Bt>}
              {editable && ACTIVOS.includes(sel.estado) && sel.fase_actual === 7 && <Bt v="ok" sm onClick={cerrar} title="Cierra el comité de trabajo: el proceso queda con su dueño">✓ Cerrar comité de trabajo</Bt>}
              {aprueba && ACTIVOS.includes(sel.estado) && <Bt v="warn" sm onClick={() => setSheet('reasignar')} title="Reasigna el proceso a otro equipo (principio 13)">Reasignar</Bt>}
              {aprueba && ACTIVOS.includes(sel.estado) && <Bt v="ghost" sm onClick={() => updEnc({ estado: 'CANCELADO', fecha_cierre: hoy() })}>Cancelar</Bt>}
              <Bt v="ghost" sm onClick={() => setSelId(null)}>Cerrar</Bt>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, alignItems: 'start' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={css.th}>Fase</th><th style={css.th}>Estado</th><th style={css.th}>Meta</th><th style={css.th}>Inicio</th><th style={css.th}>Fin</th><th style={css.th}>Entregable</th><th style={css.th}>Sesión</th></tr></thead>
                <tbody>{fasesSel.map(f => {
                  const ev = evidencia(f.fase)
                  const ed = edit[f.id] || {}
                  const v = (k) => ed[k] !== undefined ? ed[k] : (f[k] || '')
                  const set = (k, val) => setEdit(o => ({ ...o, [f.id]: { ...(o[f.id] || {}), [k]: val } }))
                  const blur = (k) => { if (ed[k] !== undefined && ed[k] !== (f[k] || '')) updFase(f, { [k]: ed[k] || null }) }
                  const atrasada = f.estado !== 'COMPLETADA' && f.fecha_meta && f.fecha_meta < hoy() && ACTIVOS.includes(sel.estado)
                  return (
                    <tr key={f.id} style={{ background: f.fase === sel.fase_actual && ACTIVOS.includes(sel.estado) ? 'var(--accent-bg)' : 'transparent' }}>
                      <td style={css.td}><b>{f.fase}. {f.nombre}</b>{ev && <div style={{ fontSize: 10.5, color: 'var(--success)', fontWeight: 600 }}>ERP: {ev}</div>}</td>
                      <td style={css.td}>{editable ? (
                        <select value={f.estado} onChange={e => updFase(f, { estado: e.target.value, fecha_fin: e.target.value === 'COMPLETADA' ? (f.fecha_fin || hoy()) : f.fecha_fin })} style={{ ...css.select, fontSize: 11, padding: '3px 5px', color: EST_FASE[f.estado], fontWeight: 700 }}>
                          {Object.keys(EST_FASE).map(k => <option key={k} value={k}>{k}</option>)}</select>) : <Bd c={EST_FASE[f.estado]}>{f.estado}</Bd>}</td>
                      <td style={{ ...css.td, whiteSpace: 'nowrap', color: atrasada ? 'var(--danger)' : 'inherit', fontWeight: atrasada ? 700 : 400 }}>{fFecha(f.fecha_meta)}</td>
                      <td style={css.td}>{editable ? <input type="date" value={f.fecha_inicio || ''} onChange={e => updFase(f, { fecha_inicio: e.target.value || null })} style={{ ...css.input, padding: '4px 6px', fontSize: 11.5, width: 128 }} /> : fFecha(f.fecha_inicio)}</td>
                      <td style={css.td}>{editable ? <input type="date" value={f.fecha_fin || ''} onChange={e => updFase(f, { fecha_fin: e.target.value || null })} style={{ ...css.input, padding: '4px 6px', fontSize: 11.5, width: 128 }} /> : fFecha(f.fecha_fin)}</td>
                      <td style={{ ...css.td, minWidth: 220 }}>
                        {editable ? (<>
                          <input value={v('entregable')} onChange={e => set('entregable', e.target.value)} onBlur={() => blur('entregable')} style={{ ...css.input, padding: '4px 6px', fontSize: 11.5 }} />
                          <input value={v('entregable_url')} onChange={e => set('entregable_url', e.target.value)} onBlur={() => blur('entregable_url')} placeholder="Enlace a la evidencia" style={{ ...css.input, padding: '4px 6px', fontSize: 11, marginTop: 3 }} />
                        </>) : (<>{f.entregable}{f.entregable_url && <a href={f.entregable_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', marginLeft: 6 }}>↗</a>}</>)}
                      </td>
                      <td style={css.td}>{editable ? (
                        <select value={f.sesion_id || ''} onChange={e => updFase(f, { sesion_id: e.target.value || null })} style={{ ...css.select, fontSize: 11, padding: '3px 5px', maxWidth: 150 }}>
                          <option value="">—</option>{sesiones.map(s => <option key={s.id} value={s.id}>{s.comite_codigo} N° {s.numero ?? ''} · {fFecha(s.fecha)}</option>)}</select>
                      ) : (sesiones.find(s => s.id === f.sesion_id) ? `${sesiones.find(s => s.id === f.sesion_id).comite_codigo} N° ${sesiones.find(s => s.id === f.sesion_id).numero}` : '—')}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Piloto (fase 5)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Campo l="Inicio"><input type="date" disabled={!editable} value={sel.piloto_inicio || ''} onChange={e => guardarPiloto('piloto_inicio', e.target.value)} style={css.input} /></Campo>
                <Campo l="Fin"><input type="date" disabled={!editable} value={sel.piloto_fin || ''} onChange={e => guardarPiloto('piloto_fin', e.target.value)} style={css.input} /></Campo>
              </div>
              <Hint>{sel.piloto_inicio && sel.piloto_fin ? `${diasEntre(sel.piloto_inicio, sel.piloto_fin)} días ${sel.piloto_ok ? '✓ cumple el mínimo de 14' : '✗ bajo el mínimo de 14'}` : 'Mínimo 14 días antes de pasar a aprobación (principio 10). La base rechaza pilotos más cortos.'}</Hint>
              <div style={{ fontSize: 13, fontWeight: 700, margin: '14px 0 6px' }}>Avance del encargo</div>
              <Barra v={100 * (sel.fases_completadas || 0) / 7} label={`${sel.fases_completadas || 0} de 7 fases completadas`} c={sel.vencido ? 'var(--danger)' : 'var(--accent)'} />
              <Hint style={{ marginTop: 8 }}>
                {ACTIVOS.includes(sel.estado) ? (sel.vencido ? `Venció el ${fFecha(sel.fecha_limite)}. El comité de gobierno debe decidir en su próxima sesión: extender con fecha, cerrar o reasignar.` : `Quedan ${sel.dias_restantes} días del plazo de 2 meses.`) : `Encargo ${(EST[sel.estado] || {}).l?.toLowerCase()}${sel.fecha_cierre ? ' el ' + fFecha(sel.fecha_cierre) : ''}.`}
              </Hint>
              {proc && (
                <div style={{ marginTop: 12, padding: '9px 11px', borderRadius: 9, background: 'var(--bg-page)', fontSize: 12 }}>
                  <b>Estado del proceso en la matriz:</b> {proc.estado_impl_etiqueta} · avance {proc.pct_global}% · SOP {proc.estado_sop?.toLowerCase().replace('_', ' ')} · flujograma {proc.estado_flujograma?.toLowerCase().replace('_', ' ')}
                </div>
              )}
            </div>
          </div>
        </Cd>
      )}

      <EncargoSheet open={sheet === 'nuevo'} onClose={() => setSheet(null)} matriz={matriz} cat={cat} cu={cu} toast={toast} usuarios={usuarios}
        encargos={encargos} comiteCodigo={comite} onGuardado={id => { setSheet(null); setSelId(id); cargar(true) }} />
      <EncargoSheet open={sheet === 'reasignar'} onClose={() => setSheet(null)} matriz={matriz} cat={cat} cu={cu} toast={toast} usuarios={usuarios}
        encargos={encargos} reasignarDe={sel} onGuardado={id => { setSheet(null); setSelId(id); cargar(true) }} />
    </div>
  )
}
