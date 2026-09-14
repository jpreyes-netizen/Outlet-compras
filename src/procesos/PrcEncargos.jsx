// src/procesos/PrcEncargos.jsx
// Comités de trabajo por proceso (P21): el comité de gestión encarga un proceso
// a un equipo con líder, integrantes y plazo de 2 meses; el equipo lo lleva por
// las 7 fases (Activación → Bajada). Reglas: impar, mínimo 3, líder ≤ 2, participante ≤ 4,
// piloto ≥ 14 días, reasignación por incumplimiento (principios 5, 7, 10, 11, 13).
//
// Tablas: prc_encargos · prc_encargo_fases · v_prc_encargos · prc_decisiones

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../supabase'
import { Cd, Bt, Bd, Mt, Sheet, Vacio, Ayuda, Hint, Campo, Chips, Barra, css, hoy, uid, fFecha, puedeEditar, puedeAprobar } from './prcUI'
import { FASES_P37, validarConformacion, cargaPersonas, sumarDias, diasEntre, disponibilidad, etiquetaCarga, mismaPersona } from './prcComite'
import { usePersonas, ChipsPersonas, SelPersona } from './prcPersonas'
import { PLANTILLAS, descargarPlantilla, abrirInformeCumplimiento } from './prcPlantillas'

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
  const { personas } = usePersonas()
  const [form, setForm] = useState({})
  const [lista, setLista] = useState(encargos || [])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const base = reasignarDe
      ? { proceso_id: reasignarDe.proceso_id, comite_codigo: reasignarDe.comite_codigo || comiteCodigo || '', lider: '', objetivo: reasignarDe.objetivo || '', fuera_de_alcance: reasignarDe.fuera_de_alcance || '', motivo: '' }
      : { proceso_id: '', comite_codigo: comiteCodigo || '', lider: '', objetivo: '', fuera_de_alcance: '' }
    setForm({ ...base, fecha_inicio: hoy(), fecha_limite: sumarMeses(hoy(), 2) })
    if (!encargos) supabase.from('v_prc_encargos').select('*').then(r => setLista(r.data || []))
    else setLista(encargos)
  }, [open, reasignarDe, comiteCodigo, encargos])

  const conEncargo = useMemo(() => new Set(lista.filter(e => ACTIVOS.includes(e.estado)).map(e => e.proceso_id)), [lista])
  const candidatos = useMemo(() => matriz.filter(p => p.estado_implementacion !== 'IMPLEMENTADO' && (!conEncargo.has(p.id) || p.id === reasignarDe?.proceso_id))
    .sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id)), [matriz, conEncargo, reasignarDe])
  // El encargo nace SOLO con el líder: el equipo lo conforma él después (paso 1.3 de P21).
  const integrantes = useMemo(() => form.lider?.trim() ? [form.lider.trim()] : [], [form.lider])
  const val = useMemo(() => {
    const errores = []
    const l = (form.lider || '').trim()
    if (!l) errores.push('Falta el líder del comité de trabajo.')
    const carga = cargaPersonas((lista || []).filter(e => e.id !== reasignarDe?.id))
    const cl = carga.lideres.find(x => mismaPersona(x.nombre, l))
    if (cl && cl.n >= 2) errores.push(`${l} ya lidera ${cl.n} comités de trabajo activos (máximo 2, principio 11).`)
    return { ok: errores.length === 0, errores, avisos: ['El líder conformará el equipo y validará la disponibilidad de cada integrante (paso 1.3).'] }
  }, [form.lider, lista, reasignarDe])
  const dispoLider = useMemo(() => form.lider?.trim()
    ? disponibilidad(form.lider.trim(), null, { comites: cat.comites || [], encargos: lista, sesiones: [] })
    : null, [form.lider, cat, lista])
  const sugeridos = useMemo(() => [...new Set([...usuarios.map(u => u.nombre), ...matriz.map(p => p.dueno_persona || p.dueno_cargo).filter(Boolean), ...(cat.comites || []).flatMap(c => c.integrantes || [])])].sort(), [usuarios, matriz, cat])

  const guardar = async () => {
    if (!form.proceso_id) return toast('Elige el proceso que se encarga.', 'err')
    if (!val.ok) return toast(val.errores[0], 'err')
    if (reasignarDe && !form.motivo?.trim()) return toast('Indica el motivo de la reasignación (principio 13).', 'err')
    setBusy(true)
    const id = `ENC-${form.proceso_id}-${form.fecha_inicio.replace(/-/g, '')}-${uid().slice(-3)}`
    const { error } = await supabase.from('prc_encargos').insert({
      id, proceso_id: form.proceso_id, comite_codigo: form.comite_codigo || null, lider: form.lider.trim(), secretario: null,
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
        decision: `${reasignarDe ? 'Se reasigna' : 'Se encarga'} ${form.proceso_id} ${p?.nombre || ''} a ${form.lider.trim()}, que lidera el comité de trabajo y conformará su equipo, con plazo al ${fFecha(form.fecha_limite)}.`,
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
          <Campo l="Líder del comité de trabajo" obligatorio hint="Máximo 2 comités simultáneos por líder (principio 11).">
            <SelPersona valor={form.lider} onChange={v => setForm({ ...form, lider: v })} personas={personas}
              ctx={{ comites: cat.comites || [], encargos: lista, sesiones: [] }} ph="— elegir líder —" />
          </Campo>
        </div>
        <div style={{ padding: '9px 12px', borderRadius: 9, background: 'var(--accent-bg)', fontSize: 12.5, lineHeight: 1.6 }}>
          <b>Acá se designa solo al líder.</b> El equipo lo conforma él: convoca a cada persona, verifica que su jefatura
          dé el visto bueno y que no choque con otros comités, y registra la nómina en el encargo (paso 1.3 del método).
          Sin nómina registrada la fase 1 no cierra.
          {dispoLider && form.lider?.trim() && (
            <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Bd c={dispoLider.lidera >= 2 ? 'var(--danger)' : dispoLider.lidera ? 'var(--warning)' : 'var(--success)'}>
                {form.lider.trim()}: {etiquetaCarga(dispoLider)}{dispoLider.lidera ? ` · lidera ${dispoLider.lidera}` : ''}
              </Bd>
              {val.errores.map((x, i) => <Bd key={i} c="var(--danger)">{x}</Bd>)}
            </div>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
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
  const { personas } = usePersonas()
  const editable = puedeEditar(cu)
  const aprueba = puedeAprobar(cu)
  const [encargos, setEncargos] = useState([])
  const [fases, setFases] = useState([])
  const [sesiones, setSesiones] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('activos')
  const [comite, setComite] = useState('')
  const [selId, setSelId] = useState(() => { try { const v = localStorage.getItem('prc_enc_sel'); localStorage.removeItem('prc_enc_sel'); return v || null } catch { return null } })
  const [sheet, setSheet] = useState(null)          // 'nuevo' | 'reasignar'
  const [edit, setEdit] = useState({})              // edición local de fases {faseId: {campo: valor}}
  const [metodo, setMetodo] = useState({ fases: [], pasos: [] })   // el método: fases y pasos del SOP P21
  const [checks, setChecks] = useState([])          // prc_encargo_pasos: qué paso del método está hecho
  const [adjuntos, setAdjuntos] = useState([])      // prc_encargo_docs: evidencias por fase
  const [confirmarAvance, setConfirmarAvance] = useState(false)

  const cargar = useCallback(async (silencioso) => {
    if (!silencioso) setLoading(true)
    const [e, f, s, u, mf, mp, ck, dj] = await Promise.all([
      supabase.from('v_prc_encargos').select('*').order('fecha_limite'),
      supabase.from('prc_encargo_fases').select('*').order('fase'),
      supabase.from('v_prc_sesiones').select('id, comite_codigo, numero, fecha, estado').order('fecha', { ascending: false }),
      supabase.from('usuarios').select('id, nombre, cargo, rol').limit(200),
      supabase.from('prc_fases').select('id, orden, nombre, descripcion').eq('proceso_id', 'P21').order('orden'),
      supabase.from('prc_pasos').select('id, fase_id, orden, accion, responsable, documento, control_tiempo, es_decision, es_control_critico').eq('proceso_id', 'P21'),
      supabase.from('prc_encargo_pasos').select('*'),
      supabase.from('prc_encargo_docs').select('*').order('created_at')
    ])
    setEncargos(e.data || []); setFases(f.data || []); setSesiones(s.data || []); setUsuarios(u.error ? [] : (u.data || []))
    setMetodo({ fases: mf.error ? [] : (mf.data || []), pasos: mp.error ? [] : (mp.data || []) })
    setChecks(ck.error ? [] : (ck.data || [])); setAdjuntos(dj.error ? [] : (dj.data || []))
    if (!silencioso) setLoading(false)
  }, [])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { setConfirmarAvance(false) }, [selId])

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

  // pasos del método P21 para la fase N (por orden de fase), con su numeración N.M
  const pasosMetodo = useCallback((faseN) => {
    const f = metodo.fases.find(x => x.orden === faseN)
    if (!f) return { fase: null, pasos: [], gate: '' }
    const ps = metodo.pasos.filter(x => x.fase_id === f.id).sort((a, b) => (a.orden || 0) - (b.orden || 0))
    const gate = (String(f.descripcion || '').match(/Gate de salida:\s*([^]*?)(?:$)/) || [])[1] || ''
    return { fase: f, pasos: ps, gate: gate.trim() }
  }, [metodo])
  const checksDe = useCallback((encId) => {
    const m = new Map()
    checks.filter(c => c.encargo_id === encId && c.hecho).forEach(c => m.set(c.paso_id, c))
    return m
  }, [checks])
  /* todos los registros de la hoja de trabajo de un encargo (cualquier estado) */
  const registrosDe = useCallback((encId) => {
    const m = new Map()
    checks.filter(c => c.encargo_id === encId).forEach(c => m.set(c.paso_id, c))
    return m
  }, [checks])
  const progresoMetodo = useCallback((enc) => {
    const { pasos } = pasosMetodo(enc.fase_actual)
    if (!pasos.length) return null
    const ok = checksDe(enc.id)
    return { hechos: pasos.filter(p => ok.has(p.id)).length, total: pasos.length }
  }, [pasosMetodo, checksDe])

  const err = (e) => toast('No se pudo guardar: ' + e.message, 'err')
  const marcarPaso = async (paso, hecho) => {
    const fila = { id: `${sel.id}::${paso.id}`, encargo_id: sel.id, paso_id: paso.id, hecho, fecha: hoy(), por: cu?.nombre || '—' }
    const { error } = await supabase.from('prc_encargo_pasos').upsert(fila, { onConflict: 'id' })
    if (error) return err(error)
    cargar(true)
  }
  const updEnc = async (patch) => {
    const { error } = await supabase.from('prc_encargos').update(patch).eq('id', sel.id)
    if (error) return err(String(error.message).includes('piloto_check') ? { message: 'el piloto debe durar al menos 14 días (principio 10)' } : error)
    cargar(true)
  }
  const updFase = async (f, patch) => { const { error } = await supabase.from('prc_encargo_fases').update(patch).eq('id', f.id); if (error) return err(error); cargar(true) }

  const avanzar = async () => {
    const actual = fasesSel.find(f => f.fase === sel.fase_actual)
    if (!actual) return
    if (sel.fase_actual === 1 && !sel.equipo_confirmado_at)
      return toast('La fase 1 no cierra sin nómina: el líder debe conformar el equipo (paso 1.3 y gate de salida de la fase).', 'err')
    if (sel.fase_actual === 5 && !sel.piloto_ok) return toast('Para pasar de Piloto a Validación registra las fechas del piloto: mínimo 14 días (principio 10).', 'err')
    const prog = progresoMetodo(sel)
    if (prog && prog.hechos < prog.total && !confirmarAvance) {
      setConfirmarAvance(true)
      return toast(`Quedan ${prog.total - prog.hechos} paso(s) del método sin marcar en esta fase. Revisa el gate de salida; si igual corresponde avanzar, pulsa "Avanzar" otra vez.`, 'err')
    }
    setConfirmarAvance(false)
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
      <Ayuda k="encargos" titulo="Cómo funcionan los comités de trabajo (P21)">
        El comité de gobierno <b>encarga</b> un proceso a un comité de trabajo: líder, integrantes (impar, mínimo 3, alguien de otra
        área) y <b>plazo de 2 meses</b>. El equipo lo lleva por las 7 fases —Activación, Encuadre, Diagnóstico, Diseño, Piloto (mínimo
        2 semanas), Validación y Bajada— registrando entregable y sesión de cada una. Cada fase trae el checklist de pasos del método P21 con su gate de salida. Si el plazo vence sin entrega, el comité de
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
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, alignItems: 'center', gap: 6 }}>
                <span>Fase {e.fase_actual} · {e.fase_actual_nombre}{(() => { const pr = ACTIVOS.includes(e.estado) ? progresoMetodo(e) : null; return pr ? <span style={{ color: pr.hechos === pr.total ? 'var(--success)' : 'var(--text-muted)', fontWeight: 700 }}> · {pr.hechos}/{pr.total} pasos</span> : null })()}</span>
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
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
                {(sel.integrantes || []).map(x => <Bd key={x} c="var(--accent)">{x}{mismaPersona(x, sel.lider) ? ' · líder' : mismaPersona(x, sel.secretario) ? ' · secretaría' : ''}</Bd>)}
                {!sel.equipo_confirmado_at && <Bd c="var(--warning)">equipo por conformar</Bd>}
                {sel.equipo_confirmado_at && <Bd c="var(--success)">equipo conformado por {sel.equipo_confirmado_por || '—'}</Bd>}
              </div>
              {sel.objetivo && <div style={{ fontSize: 12.5, marginTop: 6 }}><b>Objetivo:</b> {sel.objetivo}</div>}
              {sel.fuera_de_alcance && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}><b>Fuera de alcance:</b> {sel.fuera_de_alcance}</div>}
              {sel.motivo_reasignacion && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 2 }}><b>Reasignado:</b> {sel.motivo_reasignacion}</div>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Bt v="sec" sm onClick={() => onAbrir(sel.proceso_id)}>Abrir ficha</Bt>
              {editable && ACTIVOS.includes(sel.estado) && sel.fase_actual < 7 && <Bt sm v={confirmarAvance ? 'warn' : undefined} onClick={avanzar} title="Completa la fase actual y abre la siguiente. Revisa antes el checklist del método y su gate de salida.">{confirmarAvance ? '¿Avanzar igual? →' : `Avanzar a fase ${sel.fase_actual + 1} →`}</Bt>}
              {editable && ACTIVOS.includes(sel.estado) && sel.fase_actual === 7 && <Bt v="ok" sm onClick={cerrar} title="Cierra el comité de trabajo: el proceso queda con su dueño">✓ Cerrar comité de trabajo</Bt>}
              {aprueba && ACTIVOS.includes(sel.estado) && <Bt v="warn" sm onClick={() => setSheet('reasignar')} title="Reasigna el proceso a otro equipo (principio 13)">Reasignar</Bt>}
              {aprueba && ACTIVOS.includes(sel.estado) && <Bt v="ghost" sm onClick={() => updEnc({ estado: 'CANCELADO', fecha_cierre: hoy() })}>Cancelar</Bt>}
              <Bt v="ghost" sm onClick={() => setSelId(null)}>Cerrar</Bt>
            </div>
          </div>

          {ACTIVOS.includes(sel.estado) && !sel.equipo_confirmado_at && (
            <EquipoDelLider encargo={sel} cat={cat} cu={cu} usuarios={usuarios} matriz={matriz} encargos={encargos} sesiones={sesiones}
              toast={toast} onGuardado={cargar} />
          )}

          {ACTIVOS.includes(sel.estado) && (() => {
            const { fase: mF, pasos: mP, gate } = pasosMetodo(sel.fase_actual)
            if (!mP.length) return null
            return (
              <HojaDeTrabajo encargo={sel} fase={sel.fase_actual} faseMetodo={mF} pasos={mP} gate={gate}
                registros={registrosDe(sel.id)} docs={adjuntos} cu={cu} editable={editable} toast={toast}
                personas={personas} onCambio={() => cargar(true)} />
            )
          })()}

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
                      <td style={{ ...css.td, minWidth: 250 }}>
                        {editable ? (
                          <input value={v('entregable')} onChange={e => set('entregable', e.target.value)} onBlur={() => blur('entregable')} style={{ ...css.input, padding: '4px 6px', fontSize: 11.5 }} />
                        ) : f.entregable}
                        <EvidenciasFase encargo={sel} fase={f.fase} docs={adjuntos} cu={cu} toast={toast} editable={editable}
                          onCambio={() => cargar(true)}
                          enlace={{ valor: v('entregable_url'), set: x => set('entregable_url', x), blur: () => blur('entregable_url') }} />
                      </td>
                      <td style={css.td}>{editable ? (() => {
                        const propias = sesiones.filter(x => x.comite_codigo === sel.comite_codigo)
                        const otras = sesiones.filter(x => x.comite_codigo !== sel.comite_codigo)
                        if (!sesiones.length) return (
                          <span style={{ fontSize: 10.5, color: 'var(--warning-text)' }}
                            title="La sesión en que se revisó esta fase. Aún no hay sesiones agendadas: créalas en Comités → Calendario (botón Generar calendario).">
                            sin sesiones aún
                          </span>
                        )
                        return (
                          <select value={f.sesion_id || ''} onChange={e => updFase(f, { sesion_id: e.target.value || null })}
                            title="Sesión del comité en que se presentó o revisó esta fase"
                            style={{ ...css.select, fontSize: 11, padding: '3px 5px', maxWidth: 150 }}>
                            <option value="">—</option>
                            {propias.map(x => <option key={x.id} value={x.id}>{x.comite_codigo} N° {x.numero ?? ''} · {fFecha(x.fecha)}</option>)}
                            {otras.length > 0 && <option disabled>── otros comités ──</option>}
                            {otras.map(x => <option key={x.id} value={x.id}>{x.comite_codigo} N° {x.numero ?? ''} · {fFecha(x.fecha)}</option>)}
                          </select>
                        )
                      })() : (sesiones.find(x => x.id === f.sesion_id) ? `${sesiones.find(x => x.id === f.sesion_id).comite_codigo} N° ${sesiones.find(x => x.id === f.sesion_id).numero}` : '—')}</td>
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

/* ═══════════════════════════════════════════════════════════════════════════
   Conformación del equipo — la hace el líder (paso 1.3 del método P21)
   ───────────────────────────────────────────────────────────────────────────
   El comité de gobierno designa al líder y nada más. Acá el líder arma su
   equipo viendo, para cada candidato, en cuántos comités ya está, cuántas
   horas al mes le significa y si choca con las sesiones de otro comité suyo.
   Mientras no haya nómina, la fase 1 no cierra (su gate exige "nómina
   registrada") y el encargo se muestra como "equipo por conformar".
   ═══════════════════════════════════════════════════════════════════════════ */
function EquipoDelLider({ encargo, cat, cu, usuarios = [], matriz = [], encargos = [], sesiones = [], toast, onGuardado }) {
  const { personas } = usePersonas()
  const [abierto, setAbierto] = useState(false)
  const [nomina, setNomina] = useState([])
  const [secretario, setSecretario] = useState('')
  const [busy, setBusy] = useState(false)

  const esLider = mismaPersona(cu?.nombre, encargo.lider)
  const esAdmin = cu?.rol === 'admin'
  const puede = esLider || esAdmin

  useEffect(() => {
    if (!abierto) return
    const base = (encargo.integrantes || []).filter(Boolean)
    setNomina(base.length ? base : (encargo.lider ? [encargo.lider] : []))
    setSecretario(encargo.secretario || '')
  }, [abierto, encargo])

  const candidatos = useMemo(() => {
    const vistos = new Map()
    ;[...usuarios.map(u => u.nombre), ...matriz.map(p => p.dueno_persona).filter(Boolean),
      ...(cat.comites || []).flatMap(c => c.integrantes || [])]
      .filter(Boolean)
      .forEach(n => { const k = String(n).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); if (!vistos.has(k)) vistos.set(k, String(n).trim()) })
    return [...vistos.values()].sort()
  }, [usuarios, matriz, cat])

  const ctx = { comites: cat.comites || [], encargos, sesiones }
  const dispo = useMemo(() => nomina.map(n => disponibilidad(n, null, ctx)), [nomina, cat, encargos, sesiones])   // eslint-disable-line react-hooks/exhaustive-deps

  /* Las sesiones de los comités de gobierno a las que ya va cada persona sirven
     para que el líder sepa cuándo NO puede citar a su equipo. */
  const ocupacion = useMemo(() => {
    const dias = new Map()
    dispo.forEach(d => d.comites.forEach(c => {
      if (!c.dia_semana || !c.hora_inicio) return
      const k = `${c.dia_semana}|${String(c.hora_inicio).slice(0, 5)}`
      if (!dias.has(k)) dias.set(k, { dia: +c.dia_semana, hora: String(c.hora_inicio).slice(0, 5), quienes: new Set(), comites: new Set() })
      dias.get(k).quienes.add(d.persona); dias.get(k).comites.add(c.codigo)
    }))
    return [...dias.values()].sort((a, b) => a.dia - b.dia || a.hora.localeCompare(b.hora))
  }, [dispo])

  const val = useMemo(() => validarConformacion({ lider: encargo.lider, integrantes: nomina, encargos, excluirId: encargo.id }), [encargo, nomina, encargos])
  const sobrecargados = dispo.filter(d => d.nEncargos >= 4)

  const guardar = async () => {
    if (!val.ok) return toast(val.errores[0], 'err')
    if (secretario && !nomina.some(x => mismaPersona(x, secretario))) return toast('El secretario debe estar entre los integrantes.', 'err')
    setBusy(true)
    const { error } = await supabase.from('prc_encargos').update({
      integrantes: nomina, secretario: secretario || null,
      equipo_confirmado_at: new Date().toISOString(), equipo_confirmado_por: cu?.nombre || '—'
    }).eq('id', encargo.id)
    setBusy(false)
    if (error) return toast('No se pudo guardar la nómina: ' + error.message, 'err')
    toast(`Equipo conformado: ${nomina.length} integrantes`)
    setAbierto(false); onGuardado?.()
  }

  if (!abierto) return (
    <div style={{ marginBottom: 13, padding: '10px 13px', borderRadius: 11, background: 'var(--warning-bg)', color: 'var(--warning-text)', fontSize: 12.5, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', lineHeight: 1.6 }}>
      <span style={{ flex: 1, minWidth: 260 }}>
        <b>El equipo está por conformar.</b> {encargo.lider} fue designado líder y le toca convocar: elegir a quién suma,
        confirmar con su jefatura y dejar la nómina registrada (paso 1.3). Sin nómina la fase 1 no cierra.
      </span>
      {puede
        ? <Bt sm onClick={() => setAbierto(true)}>👥 Conformar el equipo →</Bt>
        : <Bd c="var(--warning)">lo hace {encargo.lider}</Bd>}
    </div>
  )

  return (
    <div style={{ marginBottom: 13, padding: '12px 14px', borderRadius: 11, background: 'var(--bg-app)', border: '1px solid var(--accent)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap', marginBottom: 9 }}>
        <span style={{ fontSize: 13.5, fontWeight: 800 }}>👥 Conformar el equipo · {encargo.proceso_id}</span>
        <Bd c={val.ok ? 'var(--success)' : 'var(--danger)'}>{nomina.length} integrante(s){nomina.length >= 3 && nomina.length % 2 === 1 ? ' · impar ✓' : ' · debe ser impar ≥ 3'}</Bd>
        <Bt v="ghost" sm style={{ marginLeft: 'auto' }} onClick={() => setAbierto(false)}>Cancelar</Bt>
      </div>

      <Campo l="Nómina del comité de trabajo" obligatorio
        hint="Impar, mínimo 3, con al menos una persona de otra dirección (principios 5 y 7). El líder va siempre.">
        <ChipsPersonas valores={nomina} onChange={setNomina} personas={personas} ctx={ctx} fijos={[encargo.lider]} />
      </Campo>

      {dispo.length > 0 && (
        <div style={{ marginTop: 9 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>Carga de cada uno antes de confirmar</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {dispo.map(d => (
              <div key={d.persona} style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12,
                padding: '5px 9px', borderRadius: 7,
                background: d.nEncargos >= 4 ? 'var(--danger-bg)' : d.sobrecargada ? 'var(--warning-bg)' : 'var(--bg-surface)'
              }}>
                <span>{d.nEncargos >= 4 ? '⛔' : d.sobrecargada ? '⚠' : d.libre ? '🟢' : '🔵'}</span>
                <b style={{ minWidth: 140 }}>{d.persona}{mismaPersona(d.persona, encargo.lider) ? ' · líder' : ''}</b>
                <span style={{ color: 'var(--text-muted)' }}>{etiquetaCarga(d)}</span>
                {d.comites.length > 0 && <span style={{ color: 'var(--text-muted)' }}>({d.comites.map(c => c.codigo).join(' · ')})</span>}
                {d.nEncargos >= 4 && <span style={{ color: 'var(--danger)', fontWeight: 600 }}>ya está en 4 comités de trabajo (tope, principio 11)</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {ocupacion.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12, padding: '8px 11px', borderRadius: 8, background: 'var(--warning-bg)', color: 'var(--warning-text)', lineHeight: 1.6 }}>
          <b>Cuándo NO citar a este equipo</b> — ya tienen comité de gobierno en estos bloques:
          <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ocupacion.map((o, i) => (
              <span key={i} style={{ padding: '2px 8px', borderRadius: 999, background: 'var(--bg-surface)' }}>
                {DIA_NOMBRE[o.dia]} {o.hora} · {[...o.comites].join('/')} ({o.quienes.size})
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
        <Campo l="Secretario/a de actas" hint="Se designa en el encuadre (paso 2.2); puedes dejarlo para después.">
          <SelPersona valor={secretario} onChange={setSecretario} personas={personas}
            soloDeLista={nomina} permitirLibre={false} ph="— después —" />
        </Campo>
        <div style={{ flex: 1, minWidth: 200, fontSize: 12, color: 'var(--danger)' }}>
          {val.errores.map((x, i) => <div key={i}>⚠ {x}</div>)}
          {val.ok && <div style={{ color: 'var(--text-muted)' }}>{val.avisos[0]}</div>}
        </div>
        <Bt dis={busy || !val.ok} onClick={guardar}>{busy ? 'Guardando…' : 'Confirmar nómina'}</Bt>
      </div>
    </div>
  )
}

const DIA_NOMBRE = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo' }

/* ═══════════════════════════════════════════════════════════════════════════
   Evidencias de una fase del encargo (paso a paso del método → archivo real)
   ───────────────────────────────────────────────────────────────────────────
   Cada fase entrega documentos concretos (acta, informe, bitácora…). Acá se
   ADJUNTAN los archivos reales —PDF, imágenes, Word, Excel— que quedan en
   Storage con registro de quién y cuándo; el enlace externo sigue disponible
   para lo que vive en Drive. Y cada fase trae su FORMATO de ejemplo (F1–F7):
   se descarga en Word pre-llenado con los datos del encargo, se completa y se
   vuelve a cargar acá.
   ═══════════════════════════════════════════════════════════════════════════ */
const MIME_IC = m => /pdf/.test(m || '') ? '📕' : /image/.test(m || '') ? '🖼️' : /sheet|excel|csv/.test(m || '') ? '📊' : /word|document/.test(m || '') ? '📝' : '📄'
const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((n || 0) / 1024)) + ' KB'

function EvidenciasFase({ encargo, fase, pasoId = null, docs = [], cu, toast, editable, onCambio, enlace, compacto = false }) {
  const [subiendo, setSubiendo] = useState(false)
  const [verEnlace, setVerEnlace] = useState(false)
  const inputRef = useRef(null)
  const mios = docs.filter(d => d.encargo_id === encargo.id && +d.fase === +fase && (pasoId ? d.paso_id === pasoId : !d.paso_id))
  const plantilla = compacto ? null : PLANTILLAS[fase]

  const subir = async (file) => {
    if (!file) return
    if (file.size > 20 * 1048576) return toast('Máximo 20 MB por archivo.', 'err')
    setSubiendo(true)
    const limpio = file.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_')
    const path = `${encargo.id}/fase${fase}/${pasoId ? pasoId.replace(/[^A-Za-z0-9_-]+/g, '_') + '/' : ''}${Date.now()}_${limpio}`
    const up = await supabase.storage.from('prc-evidencias').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (up.error) { setSubiendo(false); return toast('No se pudo subir: ' + up.error.message, 'err') }
    const { data: pub } = supabase.storage.from('prc-evidencias').getPublicUrl(path)
    const { error } = await supabase.from('prc_encargo_docs').insert({
      id: `DOC-${uid()}`, encargo_id: encargo.id, fase, paso_id: pasoId, nombre: file.name,
      tipo: 'EVIDENCIA', url: pub?.publicUrl || null, storage_path: path,
      mime: file.type || null, tamano: file.size, subido_por: cu?.nombre || null
    })
    setSubiendo(false)
    if (error) return toast('Subido pero no se pudo registrar: ' + error.message, 'err')
    toast(`${file.name} adjuntado a la fase ${fase}`)
    onCambio?.()
  }

  const borrar = async (d) => {
    if (d.storage_path) await supabase.storage.from('prc-evidencias').remove([d.storage_path])
    const { error } = await supabase.from('prc_encargo_docs').delete().eq('id', d.id)
    if (error) return toast('No se pudo eliminar: ' + error.message, 'err')
    toast('Evidencia eliminada'); onCambio?.()
  }

  return (
    <div style={{ marginTop: 4 }}>
      {mios.map(d => (
        <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '2px 0' }}>
          <span>{MIME_IC(d.mime)}</span>
          <a href={d.url} target="_blank" rel="noreferrer" title={`${d.nombre} · ${kb(d.tamano)} · subido por ${d.subido_por || '—'} el ${fFecha(String(d.created_at).slice(0, 10))}`}
            style={{ color: 'var(--accent)', fontWeight: 600, maxWidth: 165, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}>
            {d.nombre}
          </a>
          {editable && <span onClick={() => borrar(d)} title="Eliminar" style={{ cursor: 'pointer', opacity: .5, fontWeight: 700 }}>×</span>}
        </div>
      ))}
      {editable && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 3 }}>
          <input ref={inputRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt"
            onChange={e => { subir(e.target.files?.[0]); e.target.value = '' }} />
          <span onClick={() => !subiendo && inputRef.current?.click()}
            title="Adjuntar el entregable de esta fase: PDF, imagen, Word o Excel (máx. 20 MB)"
            style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--accent)', cursor: 'pointer' }}>
            {subiendo ? '⏳ subiendo…' : '📎 Adjuntar'}
          </span>
          {plantilla && (
            <span onClick={() => descargarPlantilla(fase, encargo)}
              title={`Descarga el formato ${plantilla.codigo} (${plantilla.titulo}) pre-llenado con los datos de este encargo: se completa en Word, se exporta a PDF y se carga acá.`}
              style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--accent)', cursor: 'pointer' }}>
              📄 Formato {plantilla.codigo}
            </span>
          )}
          {!compacto && <span onClick={() => setVerEnlace(x => !x)} title="Pegar un enlace externo (Drive, etc.)"
            style={{ fontSize: 10.5, color: 'var(--text-muted)', cursor: 'pointer' }}>🔗</span>}
        </div>
      )}
      {editable && (verEnlace || enlace?.valor) && (
        <input value={enlace?.valor || ''} onChange={e => enlace?.set(e.target.value)} onBlur={() => enlace?.blur()}
          placeholder="Enlace externo (Drive…)" style={{ ...css.input, padding: '3px 6px', fontSize: 10.5, marginTop: 3 }} />
      )}
      {!editable && enlace?.valor && <a href={enlace.valor} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: 11 }}>enlace externo ↗</a>}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Hoja de trabajo de la fase — el formato de cumplimiento del método, en la app
   ───────────────────────────────────────────────────────────────────────────
   Cada paso del método P21 de la fase actual despliega su registro: estado,
   responsable, fecha, qué se hizo concretamente, el resultado según el tipo de
   paso (una decisión se resuelve SÍ/NO; un control crítico se verifica OK/NO
   OK; un paso con documento pide ese documento adjunto), observaciones, la
   evidencia colgada del paso y la verificación del líder. El resumen de arriba
   dice cómo va la fase y el botón genera el informe de cumplimiento con todo
   lo registrado — ese informe es la evidencia formal de la fase.
   ═══════════════════════════════════════════════════════════════════════════ */
const EST_PASO = {
  PENDIENTE: { l: 'Pendiente', c: 'var(--text-muted)', bg: 'var(--bg-app)' },
  EN_CURSO:  { l: 'En curso',  c: 'var(--accent)',     bg: 'var(--accent-bg)' },
  HECHO:     { l: 'Hecho',     c: 'var(--success)',    bg: 'var(--success-bg)' },
  NO_APLICA: { l: 'No aplica', c: 'var(--warning-text)', bg: 'var(--warning-bg)' }
}
const guiaRegistro = p => p.es_decision
  ? 'Qué se evaluó y con qué información se tomó la decisión.'
  : p.es_control_critico
    ? 'Qué se verificó, contra qué criterio y qué se encontró.'
    : p.documento
      ? `Cómo se elaboró "${p.documento}": quiénes participaron, fuentes, fecha. Adjúntalo abajo como evidencia.`
      : 'Qué se hizo concretamente, con quién y cuándo. Hechos, no intenciones.'

function HojaDeTrabajo({ encargo, fase, faseMetodo, pasos, gate, registros, docs, cu, editable, toast, personas, onCambio }) {
  const [abierto, setAbierto] = useState(null)      // paso_id expandido
  const [draft, setDraft] = useState({})            // edición local por paso_id
  const [busy, setBusy] = useState(false)

  const esLider = mismaPersona(cu?.nombre, encargo.lider)
  const puedeVerificar = esLider || cu?.rol === 'admin'
  const equipo = useMemo(() => [...new Set([encargo.lider, ...(encargo.integrantes || [])].filter(Boolean))], [encargo])

  const reg = p => registros.get(p.id) || {}
  const est = p => reg(p).estado || 'PENDIENTE'
  const n = useMemo(() => {
    const c = { PENDIENTE: 0, EN_CURSO: 0, HECHO: 0, NO_APLICA: 0 }
    pasos.forEach(p => { c[est(p)] = (c[est(p)] || 0) + 1 })
    return c
  }, [pasos, registros])   // eslint-disable-line react-hooks/exhaustive-deps
  const cumplidos = n.HECHO + n.NO_APLICA
  const pct = pasos.length ? Math.round(100 * cumplidos / pasos.length) : 0
  const verificados = pasos.filter(p => reg(p).verificado_at).length

  const d = p => ({ ...reg(p), ...(draft[p.id] || {}) })
  const set = (p, k, v) => setDraft(x => ({ ...x, [p.id]: { ...(x[p.id] || {}), [k]: v } }))
  const sucio = p => Object.keys(draft[p.id] || {}).length > 0

  const guardar = async (p, extra = {}) => {
    const v = { ...d(p), ...extra }
    const fila = {
      id: `${encargo.id}::${p.id}`, encargo_id: encargo.id, paso_id: p.id,
      estado: v.estado || 'PENDIENTE', responsable: v.responsable || null,
      fecha_realizado: v.fecha_realizado || (['HECHO', 'NO_APLICA'].includes(v.estado) ? hoy() : null),
      registro: v.registro || null, resultado: v.resultado || null, observaciones: v.observaciones || null,
      hecho: ['HECHO', 'NO_APLICA'].includes(v.estado || ''), fecha: hoy(), por: cu?.nombre || '—',
      verificado_por: v.verificado_por || null, verificado_at: v.verificado_at || null
    }
    if (fila.estado === 'NO_APLICA' && !String(fila.observaciones || '').trim())
      return toast('Un paso "No aplica" exige justificarlo en observaciones.', 'err')
    if (fila.estado === 'HECHO' && p.es_decision && !fila.resultado)
      return toast('Este paso es una decisión: registra si el resultado fue SÍ o NO.', 'err')
    if (fila.estado === 'HECHO' && p.es_control_critico && !fila.resultado)
      return toast('Este paso es un control crítico: registra si la verificación fue OK o NO OK.', 'err')
    setBusy(true)
    const { error } = await supabase.from('prc_encargo_pasos').upsert(fila, { onConflict: 'id' })
    setBusy(false)
    if (error) return toast('No se pudo guardar: ' + error.message, 'err')
    setDraft(x => { const y = { ...x }; delete y[p.id]; return y })
    toast(`Paso ${fase}.${p.orden} guardado`)
    onCambio?.()
  }
  const cambiarEstado = (p, estado) => {
    set(p, 'estado', estado)
    if (estado === 'HECHO' && !d(p).fecha_realizado) set(p, 'fecha_realizado', hoy())
    if (estado === 'HECHO' && !d(p).responsable) set(p, 'responsable', cu?.nombre || '')
    if (!abierto || abierto !== p.id) setAbierto(p.id)
  }
  const verificar = async (p, quitar = false) => {
    await guardar(p, quitar ? { verificado_por: null, verificado_at: null } : { verificado_por: cu?.nombre || '—', verificado_at: new Date().toISOString() })
  }
  const informe = () => {
    if (!abrirInformeCumplimiento({ encargo, fase, faseMetodo, pasos, registros, docs: docs.filter(x => x.encargo_id === encargo.id && +x.fase === +fase), gate }))
      toast('El navegador bloqueó la pestaña del informe. Permite ventanas emergentes para este sitio.', 'err')
  }

  return (
    <div style={{ marginBottom: 13, borderRadius: 12, border: '1px solid var(--accent)', overflow: 'hidden' }}>
      {/* cabecera: cómo va la fase */}
      <div style={{ padding: '11px 14px', background: 'var(--accent-bg)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800 }}>📋 Hoja de trabajo · Fase {fase} · {faseMetodo?.nombre}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
            Cada paso del método registra qué se hizo, quién, cuándo, con qué resultado y evidencia. El líder verifica; el informe de la fase sale de acá.
          </div>
        </div>
        <div style={{ minWidth: 220, flex: '0 1 320px' }}>
          <Barra v={pct} c={pct === 100 ? 'var(--success)' : 'var(--accent)'} label={`${pct}% · ${cumplidos} de ${pasos.length} pasos cumplidos`} />
          <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap', fontSize: 11 }}>
            {Object.entries(EST_PASO).map(([k, v]) => n[k] ? <Bd key={k} c={v.c}>{n[k]} {v.l.toLowerCase()}</Bd> : null)}
            <Bd c={verificados === pasos.length ? 'var(--success)' : 'var(--text-muted)'}>{verificados}/{pasos.length} verificados</Bd>
          </div>
        </div>
        <Bt sm v="sec" onClick={informe} title="Genera el informe de cumplimiento de la fase con todo lo registrado, para imprimir o guardar en PDF y cargar como evidencia.">
          📑 Informe de cumplimiento
        </Bt>
      </div>

      {/* los pasos */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {pasos.map((p, idx) => {
          const v = d(p), e = EST_PASO[est(p)] || EST_PASO.PENDIENTE
          const ve = EST_PASO[v.estado || 'PENDIENTE'] || EST_PASO.PENDIENTE
          const exp = abierto === p.id
          const evid = docs.filter(x => x.encargo_id === encargo.id && x.paso_id === p.id)
          const r = reg(p)
          return (
            <div key={p.id} style={{ borderTop: idx ? '1px solid var(--border)' : 'none', background: exp ? 'var(--bg-surface)' : 'transparent' }}>
              {/* fila resumen */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 14px', cursor: 'pointer' }} onClick={() => setAbierto(exp ? null : p.id)}>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: 12, color: p.es_control_critico ? 'var(--danger)' : 'var(--accent)', minWidth: 30, marginTop: 2 }}>{fase}.{p.orden}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, lineHeight: 1.45, textDecoration: est(p) === 'HECHO' ? 'line-through' : 'none', opacity: est(p) === 'HECHO' ? .75 : 1 }}>
                    {p.accion}
                    {p.es_decision && <Bd c="var(--info)" style={{ marginLeft: 6 }}>◆ decisión</Bd>}
                    {p.es_control_critico && <Bd c="var(--danger)" style={{ marginLeft: 6 }}>control crítico</Bd>}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {p.documento && <span>📄 {p.documento}</span>}
                    {p.control_tiempo && <span>⏱ {p.control_tiempo}</span>}
                    {r.responsable && <span>👤 {r.responsable}</span>}
                    {r.fecha_realizado && <span>{fFecha(r.fecha_realizado)}</span>}
                    {evid.length > 0 && <span>📎 {evid.length}</span>}
                    {r.verificado_at && <span style={{ color: 'var(--success)', fontWeight: 700 }}>✓ verificado por {r.verificado_por}</span>}
                    {r.resultado && <span style={{ fontWeight: 700 }}>→ {r.resultado}</span>}
                  </div>
                </div>
                <select value={v.estado || 'PENDIENTE'} disabled={!editable} onClick={ev => ev.stopPropagation()}
                  onChange={ev => cambiarEstado(p, ev.target.value)}
                  style={{ ...css.select, fontSize: 11, padding: '3px 6px', fontWeight: 700, color: ve.c, background: ve.bg, minWidth: 108 }}>
                  {Object.entries(EST_PASO).map(([k, x]) => <option key={k} value={k}>{x.l}</option>)}
                </select>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, minWidth: 14 }}>{exp ? '▴' : '▾'}</span>
              </div>

              {/* formato de cumplimiento del paso */}
              {exp && (
                <div style={{ padding: '4px 14px 12px 54px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1.2fr) minmax(140px, .7fr)', gap: 10 }}>
                    <Campo l="Responsable del paso" hint="Alguien del equipo; queda con nombre.">
                      <SelPersona valor={v.responsable || ''} onChange={x => set(p, 'responsable', x)} personas={personas}
                        soloDeLista={equipo} permitirLibre={false} ph="— elegir —" dis={!editable} />
                    </Campo>
                    <Campo l="Fecha de realización">
                      <input type="date" style={css.input} value={v.fecha_realizado || ''} disabled={!editable} onChange={ev => set(p, 'fecha_realizado', ev.target.value)} />
                    </Campo>
                  </div>
                  <Campo l="Qué se hizo" obligatorio hint={guiaRegistro(p)}>
                    <textarea rows={3} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit', fontSize: 12.5 }} disabled={!editable}
                      value={v.registro || ''} onChange={ev => set(p, 'registro', ev.target.value)} />
                  </Campo>
                  {(p.es_decision || p.es_control_critico) && (
                    <Campo l={p.es_decision ? 'Resultado de la decisión' : 'Resultado del control'} obligatorio
                      hint={p.es_decision ? 'La decisión abre una u otra rama del flujo: regístrala tal como quedó.' : 'Si el control falla, el paso no se da por hecho hasta corregir.'}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {(p.es_decision ? ['SÍ', 'NO'] : ['OK', 'NO OK']).map(op => (
                          <Bt key={op} sm v={v.resultado === op ? (op === 'NO' || op === 'NO OK' ? 'warn' : 'pri') : 'sec'} dis={!editable} onClick={() => set(p, 'resultado', op)}>{op}</Bt>
                        ))}
                      </div>
                    </Campo>
                  )}
                  {!p.es_decision && !p.es_control_critico && (
                    <Campo l="Resultado o producto del paso" hint={p.documento ? `Se espera: ${p.documento}. Indica versión, fecha o dónde quedó.` : 'Qué quedó como producto (dato, acuerdo, documento).'}>
                      <input style={css.input} value={v.resultado || ''} disabled={!editable} onChange={ev => set(p, 'resultado', ev.target.value)} />
                    </Campo>
                  )}
                  <Campo l="Observaciones" hint={v.estado === 'NO_APLICA' ? 'Obligatorio: por qué este paso no aplica a este encargo.' : 'Desvíos, dificultades, acuerdos colaterales.'}>
                    <input style={css.input} value={v.observaciones || ''} disabled={!editable} onChange={ev => set(p, 'observaciones', ev.target.value)} />
                  </Campo>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>Evidencia del paso{p.documento ? <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> — se espera «{p.documento}»</span> : ''}</div>
                    <EvidenciasFase encargo={encargo} fase={fase} pasoId={p.id} docs={docs} cu={cu} toast={toast} editable={editable} onCambio={onCambio} compacto />
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingTop: 4, borderTop: '1px dashed var(--border)' }}>
                    {editable && <Bt sm dis={busy || !sucio(p)} onClick={() => guardar(p)}>{busy ? 'Guardando…' : sucio(p) ? 'Guardar registro' : 'Guardado'}</Bt>}
                    {puedeVerificar && est(p) !== 'PENDIENTE' && !r.verificado_at && (
                      <Bt sm v="ok" dis={busy || sucio(p)} onClick={() => verificar(p)} title={sucio(p) ? 'Guarda primero los cambios' : 'El líder da por verificado el cumplimiento de este paso'}>✓ Verificar como líder</Bt>
                    )}
                    {puedeVerificar && r.verificado_at && (
                      <Bt sm v="ghost" dis={busy} onClick={() => verificar(p, true)} title="Quitar la verificación">Quitar verificación</Bt>
                    )}
                    {r.verificado_at && <span style={{ fontSize: 11.5, color: 'var(--success)', fontWeight: 700 }}>✓ Verificado por {r.verificado_por} el {fFecha(String(r.verificado_at).slice(0, 10))}</span>}
                    {r.por && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>último registro: {r.por} · {fFecha(r.fecha)}</span>}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {gate && (
        <div style={{ padding: '8px 14px', fontSize: 11.5, color: 'var(--warning-text)', background: 'var(--warning-bg)', borderTop: '1px solid var(--border)' }}>
          <b>Gate de salida de la fase:</b> {gate}
          <span style={{ marginLeft: 8, fontWeight: 700, color: pct === 100 ? 'var(--success)' : 'var(--warning-text)' }}>
            {pct === 100 ? '· ✓ todos los pasos cumplidos' : `· faltan ${pasos.length - cumplidos} paso(s)`}
          </span>
        </div>
      )}
    </div>
  )
}
