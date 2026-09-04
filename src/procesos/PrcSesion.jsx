// src/procesos/PrcSesion.jsx
// Sala de sesión del comité: orden del día, asistencia y quórum, acuerdos
// anteriores, scorecard con contramedidas, procesos en revisión, decisiones,
// acuerdos, cierre y acta. Implementa las fases 2, 3 y 4 de P21.
//
// Tablas: v_prc_sesiones · prc_asistencia_comite · prc_orden_dia · prc_decisiones
//         v_prc_acuerdos (prc_agenda_comite) · v_prc_scorecard · prc_mediciones
//         prc_documentos · v_prc_encargos

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../supabase'
import {
  Cd, Bt, Bd, Sheet, Vacio, Ayuda, Hint, Campo, BtIc, BtEliminar, Chips,
  css, hoy, uid, fFecha, puedeEditar, puedeAprobar
} from './prcUI'
import {
  SEM, semDe, TIPOS_DECISION, TIPOS_ACUERDO, TIPOS_OD, quorum, ordenDiaEstandar, checklistCierre,
  textoConvocatoria, horasAnticipacion, horasActa, sumarDias, periodoMes
} from './prcComite'
import { actaHTML, abrirDocumento } from './prcDoc'
import { EncargoSheet } from './PrcEncargos'

const EST_SESION = {
  PLANIFICADA: { l: 'Planificada', c: 'var(--info)' },
  REALIZADA: { l: 'Realizada', c: 'var(--success)' },
  SIN_QUORUM: { l: 'Sin quórum (informativa)', c: 'var(--warning)' },
  ANULADA: { l: 'Anulada', c: 'var(--text-muted)' }
}
const EST_ASIST = {
  CONVOCADO: { l: 'Convocado', c: 'var(--text-muted)' }, PRESENTE: { l: 'Presente', c: 'var(--success)' },
  AUSENTE: { l: 'Ausente', c: 'var(--danger)' }, JUSTIFICADO: { l: 'Justificado', c: 'var(--warning)' }
}
const ROLES_SESION = [
  { k: 'PRESIDE', l: 'Preside' }, { k: 'SECRETARIO', l: 'Secretario/a de acta' },
  { k: 'PARTICIPANTE', l: 'Participante' }, { k: 'INVITADO', l: 'Invitado/a (sin voto)' }
]
const COLOR_ACU = { ABIERTO: 'var(--warning)', EN_CURSO: 'var(--info)', CERRADO: 'var(--success)', ANULADO: 'var(--text-muted)' }
const COLOR_DEC = { APROBADA: 'var(--success)', RECHAZADA: 'var(--danger)', POSTERGADA: 'var(--warning)' }
const ahora = () => new Date().toISOString()
const horaAhora = () => new Date().toTimeString().slice(0, 5)

export function PrcSesion({ sesionId, onSeleccionar, matriz, cat, cu, onAbrir, toast, onVolverCalendario }) {
  const editable = puedeEditar(cu)
  const aprueba = puedeAprobar(cu)
  const [s, setS] = useState(null)
  const [asis, setAsis] = useState([])
  const [od, setOd] = useState([])
  const [decs, setDecs] = useState([])
  const [acuerdos, setAcuerdos] = useState([])          // todos los del comité
  const [scorecard, setScorecard] = useState([])
  const [docs, setDocs] = useState([])
  const [encargos, setEncargos] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [todas, setTodas] = useState([])
  const [loading, setLoading] = useState(true)
  const [sheet, setSheet] = useState(null)
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [resultados, setResultados] = useState({})      // edición local del resultado por punto
  const [resumen, setResumen] = useState('')

  const nombres = useMemo(() => Object.fromEntries(matriz.map(p => [p.id, p.nombre])), [matriz])
  const comite = useMemo(() => cat.comites.find(c => c.codigo === s?.comite_codigo), [cat, s])
  const procesosComite = useMemo(() => matriz.filter(p => p.comite_codigo === s?.comite_codigo), [matriz, s])

  const cargar = useCallback(async (silencioso) => {
    if (!silencioso) setLoading(true)
    const [t, u] = await Promise.all([
      supabase.from('v_prc_sesiones').select('id, comite_codigo, comite_nombre, numero, fecha, hora_inicio, lugar, tema, estado').order('fecha', { ascending: false }),
      supabase.from('usuarios').select('id, nombre, cargo, rol').limit(200)
    ])
    setTodas(t.data || []); setUsuarios(u.error ? [] : (u.data || []))
    if (!sesionId) { setS(null); setLoading(false); return }
    const r = await supabase.from('v_prc_sesiones').select('*').eq('id', sesionId)
    const ses = (r.data || [])[0] || null
    setS(ses)
    if (!ses) { setLoading(false); return }
    const [a, o, d, g, sc, dc, en] = await Promise.all([
      supabase.from('prc_asistencia_comite').select('*').eq('sesion_id', sesionId).order('created_at'),
      supabase.from('prc_orden_dia').select('*').eq('sesion_id', sesionId).order('orden'),
      supabase.from('prc_decisiones').select('*').eq('sesion_id', sesionId).order('created_at'),
      supabase.from('v_prc_acuerdos').select('*').eq('comite_codigo', ses.comite_codigo).order('fecha_sesion', { ascending: false }),
      supabase.from('v_prc_scorecard').select('*').eq('comite_codigo', ses.comite_codigo).order('proceso_id').order('orden'),
      supabase.from('prc_documentos').select('id, proceso_id, codigo, tipo, version, estado, es_vigente'),
      supabase.from('v_prc_encargos').select('*').eq('comite_codigo', ses.comite_codigo).order('fecha_limite')
    ])
    setAsis(a.data || []); setOd(o.data || []); setDecs(d.data || []); setAcuerdos(g.data || [])
    setScorecard(sc.data || []); setDocs(dc.data || []); setEncargos(en.data || [])
    setResumen(ses.acta_resumen || '')
    if (!silencioso) setLoading(false)
  }, [sesionId])
  useEffect(() => { cargar() }, [cargar])

  const q = useMemo(() => quorum(asis, comite), [asis, comite])
  const acuSesion = useMemo(() => acuerdos.filter(a => a.sesion_id === sesionId), [acuerdos, sesionId])
  const acuAnteriores = useMemo(() => acuerdos.filter(a => a.sesion_id !== sesionId && ['ABIERTO', 'EN_CURSO'].includes(a.estado)), [acuerdos, sesionId])
  const rojos = useMemo(() => scorecard.filter(k => k.semaforo === 'ROJO' || k.semaforo === 'AMARILLO'), [scorecard])
  const porAprobar = useMemo(() => {
    const ids = new Set(procesosComite.map(p => p.id))
    return docs.filter(d => ids.has(d.proceso_id) && ['BORRADOR', 'POR_OFICIALIZAR'].includes(d.estado))
  }, [docs, procesosComite])
  const encActivos = useMemo(() => encargos.filter(e => ['ACTIVO', 'EN_PILOTO', 'EN_APROBACION'].includes(e.estado)), [encargos])
  const cerrada = s && s.estado !== 'PLANIFICADA'
  const puedeDecidir = s && s.estado !== 'SIN_QUORUM' && s.estado !== 'ANULADA'
  const check = useMemo(() => s ? checklistCierre({ sesion: s, q, ordenDia: od, acuerdos: acuSesion, decisiones: decs }) : [], [s, q, od, acuSesion, decs])
  const proxima = useMemo(() => todas.filter(x => x.comite_codigo === s?.comite_codigo && x.fecha > (s?.fecha || '') && x.estado === 'PLANIFICADA')
    .sort((a, b) => a.fecha.localeCompare(b.fecha))[0], [todas, s])
  const hAnt = horasAnticipacion(s), hActa = horasActa(s)

  const err = (e, msg) => toast((msg || 'No se pudo guardar') + ': ' + e.message, 'err')
  const upd = async (tabla, patch, id) => {
    const { error } = await supabase.from(tabla).update(patch).eq('id', id)
    if (error) { err(error); return false }
    cargar(true); return true
  }

  /* ── orden del día ── */
  const generarOD = async () => {
    const items = ordenDiaEstandar({ sesion: s, comite, acuerdosAbiertos: acuAnteriores, rojos, porAprobar, encargos: encActivos, procesosNombre: nombres })
    const filas = items.map(x => ({ id: uid(), sesion_id: s.id, orden: x.orden, tipo: x.tipo, titulo: x.titulo, detalle: x.detalle || null, minutos: x.minutos || null, estado: 'PENDIENTE' }))
    const { error } = await supabase.from('prc_orden_dia').insert(filas)
    if (error) return err(error)
    toast('Orden del día estándar generado. Ajusta títulos, tiempos y expositores.'); cargar(true)
  }
  const guardarOD = async () => {
    if (!form.titulo?.trim()) return toast('Escribe el título del punto.', 'err')
    setBusy(true)
    const fila = { tipo: form.tipo || 'TEMA', titulo: form.titulo.trim(), detalle: form.detalle || null, expositor: form.expositor || null,
      minutos: form.minutos ? +form.minutos : null, proceso_id: form.proceso_id || null, kpi_id: form.kpi_id || null }
    let error
    if (form.id) ({ error } = await supabase.from('prc_orden_dia').update(fila).eq('id', form.id))
    else ({ error } = await supabase.from('prc_orden_dia').insert({ ...fila, id: uid(), sesion_id: s.id, orden: od.length + 1, estado: 'PENDIENTE' }))
    setBusy(false)
    if (error) return err(error)
    setSheet(null); toast(form.id ? 'Punto actualizado' : 'Punto agregado'); cargar(true)
  }
  const moverOD = async (o, dir) => {
    const i = od.findIndex(x => x.id === o.id), j = i + dir
    if (j < 0 || j >= od.length) return
    const otro = od[j]
    await supabase.from('prc_orden_dia').update({ orden: otro.orden }).eq('id', o.id)
    await supabase.from('prc_orden_dia').update({ orden: o.orden }).eq('id', otro.id)
    cargar(true)
  }
  const guardarResultado = async (o) => {
    const v = resultados[o.id]
    if (v === undefined || v === (o.resultado || '')) return
    const { error } = await supabase.from('prc_orden_dia').update({ resultado: v || null, estado: v && o.estado === 'PENDIENTE' ? 'TRATADO' : o.estado }).eq('id', o.id)
    if (error) return err(error)
    cargar(true)
  }

  /* ── asistencia ── */
  const convocar = async () => {
    const nombresN = (form.nombres || []).map(x => x.trim()).filter(Boolean)
    if (!nombresN.length) return toast('Escribe al menos un nombre o cargo.', 'err')
    const ya = new Set(asis.map(a => a.nombre.toLowerCase()))
    const filas = nombresN.filter(n => !ya.has(n.toLowerCase())).map(n => {
      const u = usuarios.find(x => x.nombre === n)
      return { id: uid(), sesion_id: s.id, nombre: n, cargo: u?.cargo || null, usuario_id: u?.id || null, rol_sesion: form.rol_sesion || 'PARTICIPANTE', estado: cerrada ? 'PRESENTE' : 'CONVOCADO' }
    })
    if (!filas.length) { setSheet(null); return toast('Ya estaban convocados.') }
    setBusy(true)
    const { error } = await supabase.from('prc_asistencia_comite').insert(filas)
    setBusy(false)
    if (error) return err(error, 'No se pudo convocar')
    setSheet(null); toast(`${filas.length} convocado(s)`); cargar(true)
  }
  const copiarAnterior = async () => {
    const previa = todas.filter(x => x.comite_codigo === s.comite_codigo && x.id !== s.id && x.fecha <= s.fecha).sort((a, b) => b.fecha.localeCompare(a.fecha))[0]
    if (!previa) return toast('No hay una sesión anterior de este comité.', 'err')
    const r = await supabase.from('prc_asistencia_comite').select('*').eq('sesion_id', previa.id)
    const lista = r.data || []
    const ya = new Set(asis.map(a => a.nombre.toLowerCase()))
    const filas = lista.filter(a => !ya.has(a.nombre.toLowerCase())).map(a => ({ id: uid(), sesion_id: s.id, nombre: a.nombre, cargo: a.cargo, usuario_id: a.usuario_id, rol_sesion: a.rol_sesion, estado: 'CONVOCADO' }))
    if (!filas.length) return toast('Ya están todos los de la sesión anterior.')
    const { error } = await supabase.from('prc_asistencia_comite').insert(filas)
    if (error) return err(error)
    toast(`${filas.length} convocado(s) desde la sesión N° ${previa.numero ?? ''}`); cargar(true)
  }
  const marcarTodos = async (estado) => {
    for (const a of asis.filter(x => x.estado === 'CONVOCADO')) await supabase.from('prc_asistencia_comite').update({ estado }).eq('id', a.id)
    cargar(true)
  }
  const marcarConvocatoria = async () => {
    const txt = textoConvocatoria({ sesion: s, comite, asistentes: asis, ordenDia: od })
    try { await navigator.clipboard.writeText(txt) } catch { /* sin portapapeles */ }
    if (await upd('prc_sesiones_comite', { convocatoria_enviada_at: ahora() }, s.id)) toast('Convocatoria marcada como enviada y copiada al portapapeles: pégala en el correo o WhatsApp.')
  }

  /* ── acuerdos anteriores ── */
  const escalar = async (a) => {
    const destino = comite?.reporta_a
    if (!destino) return toast('Este comité no tiene definido a quién reporta (Config → Comités).', 'err')
    const { error } = await supabase.from('prc_agenda_comite').update({ escalado_a: destino }).eq('id', a.id)
    if (error) return err(error)
    if (puedeDecidir) {
      await supabase.from('prc_decisiones').insert({ id: uid(), sesion_id: s.id, comite_codigo: s.comite_codigo, proceso_id: a.proceso_id || null, fecha: s.fecha,
        tipo: 'ESCALAMIENTO', decision: `Se escala a ${destino} el acuerdo vencido: "${a.acuerdo}" (responsable ${a.responsable || '—'}, plazo ${fFecha(a.fecha_compromiso)}).`,
        fundamento: 'Acuerdo vencido sin cierre (P21 fase 5).', registrada_por: cu?.nombre || '—' })
    }
    toast(`Escalado a ${destino}`); cargar(true)
  }

  /* ── medición y contramedida ── */
  const guardarMedicion = async () => {
    if (!form.periodo?.trim()) return toast('Indica el período (ej. 2026-09).', 'err')
    if ((form.valor === '' || form.valor == null) && !form.cumple && !form.valor_texto) return toast('Registra el valor, o al menos si cumple o no.', 'err')
    setBusy(true)
    const { error } = await supabase.from('prc_mediciones').insert({
      id: uid(), kpi_id: form.kpi_id, proceso_id: form.proceso_id, periodo: form.periodo.trim(),
      valor: form.valor === '' || form.valor == null ? null : +form.valor, valor_texto: form.valor_texto || null,
      meta_periodo: form.meta || null, cumple: form.cumple === 'si' ? true : form.cumple === 'no' ? false : null,
      comentario: form.comentario || null, registrado_por: cu?.nombre || '—'
    })
    setBusy(false)
    if (error) return err(error)
    setSheet(null); toast('Medición registrada'); cargar(true)
  }

  /* ── decisiones ── */
  const guardarDecision = async () => {
    if (!form.decision?.trim()) return toast('Escribe la decisión.', 'err')
    setBusy(true)
    const { error } = await supabase.from('prc_decisiones').insert({
      id: uid(), sesion_id: s.id, comite_codigo: s.comite_codigo, proceso_id: form.proceso_id || null,
      documento_id: form.documento_id || null, kpi_id: form.kpi_id || null, encargo_id: form.encargo_id || null,
      fecha: s.fecha, tipo: form.tipo || 'OTRA', decision: form.decision.trim(), fundamento: form.fundamento || null,
      unanime: form.unanime !== false, votos_favor: form.unanime === false ? +form.favor || 0 : null,
      votos_contra: form.unanime === false ? +form.contra || 0 : null, abstenciones: form.unanime === false ? +form.abst || 0 : null,
      resultado: form.resultado || 'APROBADA', registrada_por: cu?.nombre || '—'
    })
    setBusy(false)
    if (error) return err(error, 'No se pudo registrar la decisión')
    if (form.proceso_id) {
      await supabase.from('prc_hitos').insert({ id: uid(), proceso_id: form.proceso_id, fecha: s.fecha, tipo: 'COMITE',
        descripcion: `[${s.comite_codigo} N° ${s.numero ?? ''}] Decisión: ${form.decision.trim()}`, responsable: cu?.nombre || '—' })
    }
    setSheet(null); toast('Decisión registrada'); cargar(true)
  }

  /* ── acuerdos ── */
  const guardarAcuerdo = async () => {
    if (!form.acuerdo?.trim()) return toast('Escribe el acuerdo: un comité sin acuerdos registrados no se realizó.', 'err')
    if (!form.responsable?.trim()) return toast('Todo acuerdo lleva responsable.', 'err')
    if (!form.compromiso) return toast('Todo acuerdo lleva fecha de compromiso.', 'err')
    setBusy(true)
    const { error } = await supabase.from('prc_agenda_comite').insert({
      id: uid(), comite_codigo: s.comite_codigo, proceso_id: form.proceso_id || null, sesion_id: s.id, kpi_id: form.kpi_id || null,
      decision_id: form.decision_id || null, fecha_sesion: s.fecha, tipo: form.tipo || 'SEGUIMIENTO', acuerdo: form.acuerdo.trim(),
      responsable: form.responsable.trim(), fecha_compromiso: form.compromiso, criterio_cierre: form.criterio_cierre || null, estado: 'ABIERTO'
    })
    setBusy(false)
    if (error) return err(error, 'No se pudo registrar el acuerdo')
    if (form.proceso_id) {
      await supabase.from('prc_hitos').insert({ id: uid(), proceso_id: form.proceso_id, fecha: s.fecha, tipo: 'COMITE',
        descripcion: `[${s.comite_codigo} N° ${s.numero ?? ''}] ${form.acuerdo.trim()}`, responsable: form.responsable.trim() })
    }
    setSheet(null); toast(form.tipo === 'CONTRAMEDIDA' ? 'Contramedida registrada' : 'Acuerdo registrado'); cargar(true)
  }
  const abrirContramedida = (k) => {
    setForm({ tipo: 'CONTRAMEDIDA', kpi_id: k.id, proceso_id: k.proceso_id, responsable: k.responsable || '', compromiso: sumarDias(hoy(), 30),
      acuerdo: '', criterio_cierre: `${k.indicador} vuelve a ${k.meta_valor != null ? (k.sentido === 'MENOR_MEJOR' ? '≤ ' : '≥ ') + k.meta_valor : 'la meta'} en la medición de ${periodoMes(sumarDias(hoy(), 30))}` })
    setSheet('acuerdo')
  }

  /* ── cierre y acta ── */
  const cerrarSesion = async () => {
    if (q.ok && acuSesion.length === 0) return toast('Regla crítica de P21: un comité sin acuerdos registrados no se realizó. Registra al menos un acuerdo o anula la sesión.', 'err')
    const estado = q.ok ? 'REALIZADA' : 'SIN_QUORUM'
    const patch = { estado, cerrada_por: cu?.nombre || '—', cerrada_at: ahora() }
    if (!s.hora_fin) patch.hora_fin = horaAhora()
    // los convocados que no se marcaron quedan como ausentes: el acta necesita asistencia cerrada
    for (const a of asis.filter(x => x.estado === 'CONVOCADO')) await supabase.from('prc_asistencia_comite').update({ estado: 'AUSENTE' }).eq('id', a.id)
    if (await upd('prc_sesiones_comite', patch, s.id)) toast(estado === 'REALIZADA' ? 'Sesión cerrada como realizada. Ahora emite el acta.' : 'Sesión cerrada SIN QUÓRUM: queda como informativa, sin decisiones válidas. Reprograma y vuelve a convocar.')
  }
  const reabrir = () => upd('prc_sesiones_comite', { estado: 'PLANIFICADA', cerrada_por: null, cerrada_at: null }, s.id)
  const emitirActa = async () => {
    const emite = editable && s.acta_estado === 'SIN_ACTA'
    const ses = emite ? { ...s, acta_estado: 'EMITIDA', acta_emitida_at: ahora() } : s
    const html = actaHTML({ sesion: ses, comite, asistentes: asis, ordenDia: od, decisiones: decs, acuerdos: acuSesion, acuerdosAnteriores: acuAnteriores, proximaSesion: proxima, nombresProceso: nombres })
    if (!abrirDocumento(html)) toast('El navegador bloqueó la pestaña del acta. Permite ventanas emergentes para este sitio.', 'err')
    if (emite) {
      await upd('prc_sesiones_comite', { acta_estado: 'EMITIDA', acta_emitida_at: ses.acta_emitida_at }, s.id)
      toast('Acta emitida. En la pestaña nueva: Imprimir → Guardar como PDF.')
    }
  }
  const aprobarActa = () => upd('prc_sesiones_comite', { acta_estado: 'APROBADA', acta_aprobada_por: cu?.nombre || '—', acta_aprobada_at: ahora() }, s.id)
  const guardarResumen = async () => { if ((s.acta_resumen || '') !== resumen) await upd('prc_sesiones_comite', { acta_resumen: resumen || null }, s.id) }

  /* ══════════════════════════ render ══════════════════════════ */
  const selector = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={sesionId || ''} onChange={e => onSeleccionar(e.target.value || null)} style={{ ...css.select, minWidth: 320, fontSize: 12.5 }} title="Elige la sesión que vas a conducir o revisar">
        <option value="">Elige una sesión…</option>
        {todas.map(x => <option key={x.id} value={x.id}>{x.comite_codigo} · N° {x.numero ?? '—'} · {fFecha(x.fecha)} · {EST_SESION[x.estado]?.l || x.estado}{x.tema ? ' · ' + x.tema : ''}</option>)}
      </select>
      <Bt v="sec" sm onClick={onVolverCalendario} title="Agendar o buscar sesiones en el calendario">📅 Calendario</Bt>
    </div>
  )

  if (loading) return <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>{selector}<Vacio txt="Cargando la sala de sesión…" /></div>
  if (!s) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        <Ayuda k="sala" titulo="Qué es la sala de sesión">
          Es donde se <b>conduce</b> la reunión del comité, paso a paso y con la regla de P21 a la vista: quórum de ¾, orden del día
          estándar, revisión de acuerdos anteriores, scorecard con contramedidas, decisiones con votación, acuerdos con responsable,
          plazo y criterio de cierre, y el acta que sale del sistema. Agenda las sesiones en el <b>Calendario</b> y ábrelas desde acá.
        </Ayuda>
        {selector}
        <Cd><Vacio ic="🏛️" txt="Elige una sesión del selector o agéndala en el calendario. Las próximas sesiones planificadas aparecen primero." /></Cd>
      </div>
    )
  }

  const e = EST_SESION[s.estado] || EST_SESION.PLANIFICADA
  const durOk = s.duracion_min != null && s.duracion_min >= (s.duracion_min_regla || 60) && s.duracion_min <= (s.duracion_max_regla || 180)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      {selector}

      {/* ── encabezado ── */}
      <Cd accent={e.c}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 300 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 17, fontWeight: 800 }}>{s.comite_nombre}</span>
              <Bd c="var(--accent)">Sesión N° {s.numero ?? '—'}</Bd>
              <Bd c="var(--text-muted)">{String(s.tipo || 'ORDINARIA').toLowerCase().replace('_', ' ')}</Bd>
              <Bd c={e.c}>{e.l}</Bd>
              <Bd c={q.ok ? 'var(--success)' : 'var(--danger)'} style={{ cursor: 'help' }}
                title={`Votan quienes no son invitados. Regla: ${q.min}% presentes y mínimo ${q.minInt}. ${q.ok ? 'Se cumple.' : `Faltan ${q.faltan} presente(s).`}`}>
                Quórum {q.presentes}/{q.votantes} · {q.pct}% {q.ok ? '✓' : '✗'}
              </Bd>
              <Bd c={s.acta_estado === 'APROBADA' ? 'var(--success)' : s.acta_estado === 'EMITIDA' ? 'var(--info)' : 'var(--text-muted)'}>
                {s.acta_estado === 'APROBADA' ? 'acta aprobada' : s.acta_estado === 'EMITIDA' ? 'acta emitida' : 'sin acta'}
              </Bd>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 5 }}>
              {fFecha(s.fecha)}{s.hora_inicio && ` · ${s.hora_inicio}${s.hora_fin ? '–' + s.hora_fin : ''}`}
              {s.duracion_min != null && <span style={{ color: durOk ? 'inherit' : 'var(--warning)', fontWeight: durOk ? 400 : 700 }}> ({s.duracion_min} min{durOk ? '' : ' · regla 60–180'})</span>}
              {s.lugar && ` · ${s.lugar}`}
              {comite?.reporta_a && ` · reporta a ${comite.reporta_a}`}
            </div>
            {s.tema && <div style={{ fontSize: 13, marginTop: 5 }}><b>Tema:</b> {s.tema}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', fontSize: 11.5 }}>
              <Bd c={hAnt == null ? 'var(--warning)' : hAnt >= 48 ? 'var(--success)' : 'var(--warning)'}>
                {hAnt == null ? 'convocatoria sin registro de envío' : `convocatoria enviada ${hAnt} h antes ${hAnt >= 48 ? '✓' : '(regla 48 h)'}`}
              </Bd>
              {s.acta_emitida_at && <Bd c={hActa != null && hActa <= 24 ? 'var(--success)' : 'var(--warning)'}>acta emitida {hActa != null ? (hActa <= 24 ? 'dentro de 24 h ✓' : `${hActa} h después`) : ''}</Bd>}
              {!q.impar && q.votantes > 0 && <Bd c="var(--warning)" title="Principio 7: conformación impar">{q.votantes} votantes: número par</Bd>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'flex-end' }}>
            {editable && !cerrada && hAnt == null && <Bt v="sec" sm onClick={marcarConvocatoria} title="Copia el texto de la convocatoria y registra la hora de envío (regla: 48 h antes)">✉ Convocatoria enviada</Bt>}
            {editable && !cerrada && <Bt v={q.ok ? 'ok' : 'warn'} sm onClick={cerrarSesion} title={q.ok ? 'Cierra la sesión como realizada' : 'Sin quórum: se cierra como informativa, sin decisiones válidas'}>{q.ok ? '✓ Cerrar sesión' : 'Cerrar sin quórum'}</Bt>}
            {aprueba && cerrada && s.acta_estado !== 'APROBADA' && <Bt v="ghost" sm onClick={reabrir} title="Vuelve la sesión a planificada para corregir">Reabrir</Bt>}
            <Bt sm onClick={emitirActa} title="Genera el acta con asistencia, quórum, orden del día, decisiones y acuerdos. Se abre en una pestaña para imprimir o guardar en PDF.">
              📄 {s.acta_estado === 'SIN_ACTA' ? 'Emitir acta' : 'Ver acta'}
            </Bt>
            {aprueba && s.acta_estado === 'EMITIDA' && <Bt v="ok" sm onClick={aprobarActa} title="Quien presidió aprueba el acta emitida">Aprobar acta</Bt>}
          </div>
        </div>
      </Cd>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 13 }}>
        {/* ── orden del día ── */}
        <Cd>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>Orden del día</span>
            <Bd c="var(--text-muted)">{od.filter(o => o.estado !== 'PENDIENTE').length}/{od.length} tratados · {od.reduce((a, o) => a + (o.minutos || 0), 0)} min</Bd>
            {editable && (
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 5 }}>
                {od.length === 0 && <Bt sm onClick={generarOD} title="Crea los 7 puntos estándar (apertura y quórum, acuerdos anteriores, scorecard, procesos, decisiones, temas, cierre) con el contenido de este comité">Generar estándar</Bt>}
                <Bt v="sec" sm onClick={() => { setForm({ tipo: 'TEMA', minutos: 10 }); setSheet('od') }}>＋ Punto</Bt>
              </span>
            )}
          </div>
          {od.length === 0 && <Vacio ic="📋" txt="Sin orden del día. Genera el estándar: trae los acuerdos abiertos, los indicadores en rojo, los SOP por aprobar y los comités de trabajo de este comité." />}
          {od.map((o, i) => {
            const t = TIPOS_OD[o.tipo] || TIPOS_OD.TEMA
            const cOK = o.estado === 'TRATADO' ? 'var(--success)' : o.estado === 'POSTERGADO' ? 'var(--warning)' : 'var(--border-2)'
            return (
              <div key={o.id} style={{ padding: '8px 10px', borderRadius: 9, background: 'var(--bg-page)', marginBottom: 6, borderLeft: `3px solid ${cOK}` }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontWeight: 800, fontSize: 12, color: 'var(--accent)', minWidth: 18 }}>{o.orden}.</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{t.ic} {o.titulo}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {t.l}{o.minutos ? ` · ${o.minutos} min` : ''}{o.expositor ? ` · expone ${o.expositor}` : ''}
                      {o.proceso_id && <> · <span onClick={() => onAbrir(o.proceso_id)} style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 700 }}>{o.proceso_id}</span></>}
                    </div>
                    {o.detalle && <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', marginTop: 4, lineHeight: 1.45 }}>{o.detalle}</div>}
                    {(editable && !cerrada) || o.resultado ? (
                      <textarea rows={2} disabled={!editable || (cerrada && s.acta_estado === 'APROBADA')} placeholder="Qué se trató y qué se resolvió (va al acta)"
                        value={resultados[o.id] ?? o.resultado ?? ''} onChange={ev => setResultados({ ...resultados, [o.id]: ev.target.value })} onBlur={() => guardarResultado(o)}
                        style={{ ...css.input, marginTop: 6, fontSize: 12, padding: '6px 9px', resize: 'vertical', fontFamily: 'inherit' }} />
                    ) : null}
                  </div>
                  {editable && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                      <select value={o.estado} onChange={ev => upd('prc_orden_dia', { estado: ev.target.value }, o.id)} style={{ ...css.select, fontSize: 11, padding: '3px 6px', color: cOK === 'var(--border-2)' ? 'var(--text-muted)' : cOK, fontWeight: 700 }}>
                        <option value="PENDIENTE">Pendiente</option><option value="TRATADO">Tratado</option><option value="POSTERGADO">Postergado</option>
                      </select>
                      <span style={{ display: 'flex', gap: 3 }}>
                        <BtIc ic="↑" title="Subir" onClick={() => moverOD(o, -1)} dis={i === 0} />
                        <BtIc ic="↓" title="Bajar" onClick={() => moverOD(o, 1)} dis={i === od.length - 1} />
                        <BtIc ic="✎" title="Editar el punto" onClick={() => { setForm({ ...o }); setSheet('od') }} />
                        <BtEliminar title="Quitar el punto" onConfirm={async () => { await supabase.from('prc_orden_dia').delete().eq('id', o.id); cargar(true) }} />
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </Cd>

        {/* ── asistencia ── */}
        <Cd>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>Asistencia y quórum</span>
            <Bd c={q.ok ? 'var(--success)' : 'var(--danger)'}>{q.presentes} de {q.votantes} votantes · regla {q.min}% y mín. {q.minInt}</Bd>
            {editable && (
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                <Bt v="sec" sm onClick={() => { setForm({ nombres: [], rol_sesion: 'PARTICIPANTE' }); setSheet('convocar') }}>＋ Convocar</Bt>
                <Bt v="ghost" sm onClick={copiarAnterior} title="Trae a los convocados de la sesión anterior de este comité">Copiar anterior</Bt>
                {asis.some(a => a.estado === 'CONVOCADO') && <Bt v="ghost" sm onClick={() => marcarTodos('PRESENTE')} title="Marca presentes a todos los convocados sin marcar">Todos presentes</Bt>}
              </span>
            )}
          </div>
          {!q.ok && q.votantes > 0 && (
            <div style={{ padding: '8px 11px', borderRadius: 9, background: 'var(--warning-bg)', color: 'var(--warning-text)', fontSize: 12, marginBottom: 8, borderLeft: '3px solid var(--warning)' }}>
              Faltan <b>{q.faltan}</b> presente(s) para el quórum. Sin quórum la sesión se cierra como informativa y no admite decisiones (principio 4).
            </div>
          )}
          {asis.length === 0 && <Vacio ic="👥" txt="Nadie convocado. Convoca a los integrantes (sugiere usuarios del ERP y dueños de proceso) o copia la sesión anterior." />}
          {asis.map(a => (
            <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', borderRadius: 9, background: 'var(--bg-page)', marginBottom: 5, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 130 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{a.nombre}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.cargo || ''}{a.cargo && a.rol_sesion !== 'PARTICIPANTE' ? ' · ' : ''}{a.rol_sesion !== 'PARTICIPANTE' || !a.cargo ? (ROLES_SESION.find(r => r.k === a.rol_sesion) || {}).l : ''}</div>
              </div>
              {editable ? (<>
                <select value={a.rol_sesion} onChange={ev => upd('prc_asistencia_comite', { rol_sesion: ev.target.value }, a.id)} style={{ ...css.select, fontSize: 11, padding: '3px 6px' }}>
                  {ROLES_SESION.map(r => <option key={r.k} value={r.k}>{r.l}</option>)}
                </select>
                <select value={a.estado} onChange={ev => upd('prc_asistencia_comite', { estado: ev.target.value }, a.id)} style={{ ...css.select, fontSize: 11, padding: '3px 6px', fontWeight: 700, color: EST_ASIST[a.estado]?.c }}>
                  {Object.keys(EST_ASIST).map(k => <option key={k} value={k}>{EST_ASIST[k].l}</option>)}
                </select>
                <BtEliminar title={`Quitar a ${a.nombre}`} onConfirm={async () => { await supabase.from('prc_asistencia_comite').delete().eq('id', a.id); cargar(true) }} />
              </>) : <Bd c={EST_ASIST[a.estado]?.c}>{EST_ASIST[a.estado]?.l}</Bd>}
            </div>
          ))}
        </Cd>
      </div>

      {/* ── acuerdos anteriores ── */}
      <Cd>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>Acuerdos anteriores abiertos</span>
          <Bd c={acuAnteriores.some(a => a.vencido) ? 'var(--danger)' : 'var(--text-muted)'}>{acuAnteriores.length} · {acuAnteriores.filter(a => a.vencido).length} vencidos</Bd>
          <Hint style={{ marginTop: 0 }}>Primer punto después del quórum: se cierran con evidencia, se reprograman con justificación o se escalan.</Hint>
        </div>
        {acuAnteriores.length === 0 && <Vacio ic="✓" txt="Sin acuerdos pendientes de sesiones anteriores." />}
        {acuAnteriores.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={css.th}>Sesión</th><th style={css.th}>Acuerdo</th><th style={css.th}>Responsable</th><th style={css.th}>Plazo</th><th style={css.th}>Estado</th><th style={css.th}></th></tr></thead>
            <tbody>{acuAnteriores.map(a => (
              <tr key={a.id}>
                <td style={{ ...css.td, whiteSpace: 'nowrap' }}>{a.sesion_numero ? `N° ${a.sesion_numero}` : fFecha(a.fecha_sesion)}</td>
                <td style={css.td}>{a.acuerdo}{a.kpi_indicador && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>contramedida · {a.kpi_indicador}</div>}{a.criterio_cierre && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>cierre: {a.criterio_cierre}</div>}</td>
                <td style={css.td}>{a.responsable || '—'}</td>
                <td style={{ ...css.td, color: a.vencido ? 'var(--danger)' : 'inherit', fontWeight: a.vencido ? 700 : 400, whiteSpace: 'nowrap' }}>{fFecha(a.fecha_compromiso)}{a.vencido ? ` (+${a.dias_atraso} d)` : ''}</td>
                <td style={css.td}>
                  {editable ? (
                    <select value={a.estado} onChange={ev => upd('prc_agenda_comite', { estado: ev.target.value, cerrado_por: ev.target.value === 'CERRADO' ? cu?.nombre : null }, a.id)}
                      style={{ ...css.select, padding: '3px 5px', fontSize: 11, color: COLOR_ACU[a.estado], fontWeight: 700 }}>
                      {['ABIERTO', 'EN_CURSO', 'CERRADO', 'ANULADO'].map(x => <option key={x} value={x}>{x}</option>)}
                    </select>
                  ) : <Bd c={COLOR_ACU[a.estado]}>{a.estado}</Bd>}
                  {a.escalado_a && <div style={{ fontSize: 10.5, color: 'var(--warning)', fontWeight: 700 }}>escalado a {a.escalado_a}</div>}
                </td>
                <td style={css.td}>{editable && a.vencido && !a.escalado_a && comite?.reporta_a && <Bt v="warn" sm onClick={() => escalar(a)} title={`Escala este acuerdo vencido a ${comite.reporta_a} (P21 fase 5)`}>Escalar</Bt>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Cd>

      {/* ── scorecard ── */}
      <Cd>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>Scorecard del comité</span>
          {['ROJO', 'AMARILLO', 'VERDE', 'SIN_DATO'].map(k => { const n = scorecard.filter(x => x.semaforo === k || (k === 'SIN_DATO' && x.semaforo === 'SIN_META')).length; return n ? <Bd key={k} c={SEM[k].c}>{n} {SEM[k].l.toLowerCase()}</Bd> : null })}
          <Hint style={{ marginTop: 0 }}>Cada rojo o amarillo sale de la sesión con causa y contramedida (responsable + plazo). Sin dato se trata como rojo.</Hint>
        </div>
        {scorecard.length === 0 && <Vacio ic="📈" txt="Este comité no tiene indicadores asignados. Se asignan en la vista Scorecard (Meta → comité que revisa)." />}
        {scorecard.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={css.th}>Indicador</th><th style={css.th}>Proceso</th><th style={css.th}>Último</th><th style={css.th}>Meta</th><th style={css.th}>Semáforo</th><th style={css.th}>Tend.</th><th style={css.th}>Contramedida</th><th style={css.th}></th></tr></thead>
              <tbody>{[...scorecard].sort((a, b) => ({ ROJO: 0, AMARILLO: 1, SIN_DATO: 2, SIN_META: 3, VERDE: 4 }[a.semaforo] - { ROJO: 0, AMARILLO: 1, SIN_DATO: 2, SIN_META: 3, VERDE: 4 }[b.semaforo])).map(k => {
                const sm = semDe(k.semaforo)
                return (
                  <tr key={k.id}>
                    <td style={css.td}>{k.es_kpi_ancla ? '⚓ ' : ''}<b>{k.indicador}</b>{k.responsable && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{k.responsable}</div>}</td>
                    <td style={css.td}><span onClick={() => onAbrir(k.proceso_id)} style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 700 }}>{k.proceso_id}</span></td>
                    <td style={{ ...css.td, whiteSpace: 'nowrap' }}>{k.ult_valor ?? k.ult_valor_texto ?? '—'}{k.ult_periodo && <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{k.ult_periodo}</div>}</td>
                    <td style={{ ...css.td, whiteSpace: 'nowrap' }}>{k.meta_valor != null ? `${k.sentido === 'MENOR_MEJOR' ? '≤' : '≥'} ${k.meta_valor}${k.unidad ? ' ' + k.unidad : ''}` : (k.meta || '—')}</td>
                    <td style={css.td}><Bd c={sm.c} bg={sm.bg}>{sm.l}</Bd></td>
                    <td style={{ ...css.td, color: k.tendencia === 'MEJORA' ? 'var(--success)' : k.tendencia === 'EMPEORA' ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 700 }}>{k.tendencia === 'MEJORA' ? '▲' : k.tendencia === 'EMPEORA' ? '▼' : k.tendencia === 'IGUAL' ? '=' : '—'}</td>
                    <td style={css.td}>{k.contramedida_abierta ? <Bd c="var(--success)">abierta</Bd> : (k.semaforo === 'ROJO' || k.semaforo === 'AMARILLO') ? <Bd c="var(--danger)">falta</Bd> : '—'}</td>
                    <td style={{ ...css.td, whiteSpace: 'nowrap' }}>{editable && (<>
                      <Bt v="sec" sm onClick={() => { setForm({ kpi_id: k.id, proceso_id: k.proceso_id, periodo: periodoMes(), cumple: '', indicador: k.indicador }); setSheet('medicion') }} title="Registrar la medición del período">Medir</Bt>{' '}
                      {(k.semaforo === 'ROJO' || k.semaforo === 'AMARILLO' || k.semaforo === 'SIN_DATO') && !k.contramedida_abierta && puedeDecidir && <Bt v={k.semaforo === 'SIN_DATO' ? 'ghost' : 'warn'} sm onClick={() => abrirContramedida(k)} title={k.semaforo === 'SIN_DATO' ? 'Sin dato se trata como rojo: acuerda quién carga la medición' : 'Acuerdo tipo contramedida ligado a este indicador'}>Contramedida</Bt>}
                    </>)}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        )}
      </Cd>

      {/* ── procesos en revisión ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 13 }}>
        <Cd>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>SOP por aprobar</span><Bd c={porAprobar.length ? 'var(--warning)' : 'var(--success)'}>{porAprobar.length}</Bd>
          </div>
          {porAprobar.length === 0 && <Vacio ic="✓" txt="Nada pendiente de aprobación en los procesos de este comité." />}
          {porAprobar.map(d => (
            <div key={d.id} style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '8px 10px', borderRadius: 9, background: 'var(--bg-page)', marginBottom: 6, flexWrap: 'wrap' }}>
              <Bd c={d.estado === 'POR_OFICIALIZAR' ? 'var(--info)' : 'var(--warning)'}>{d.estado === 'POR_OFICIALIZAR' ? 'revisado · listo' : 'borrador'}</Bd>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{d.codigo} v{d.version}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{nombres[d.proceso_id]}</div>
              </div>
              <Bt v="sec" sm onClick={() => onAbrir(d.proceso_id)} title="La firma de aprobación se hace en la pestaña SOP de la ficha">Abrir ficha</Bt>
              {editable && puedeDecidir && <Bt sm onClick={() => { setForm({ tipo: 'APROBACION_SOP', proceso_id: d.proceso_id, documento_id: d.id, unanime: true, resultado: 'APROBADA', decision: `Se aprueba ${d.codigo} v${d.version} — ${nombres[d.proceso_id] || ''}. Queda vigente y deroga la versión anterior.` }); setSheet('decision') }}>Decisión</Bt>}
            </div>
          ))}
        </Cd>
        <Cd>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>Comités de trabajo activos</span><Bd c={encActivos.some(x => x.vencido) ? 'var(--danger)' : 'var(--text-muted)'}>{encActivos.length}</Bd>
            {editable && puedeDecidir && <Bt sm style={{ marginLeft: 'auto' }} onClick={() => setSheet('encargo')} title="Encarga un proceso a un comité de trabajo (P21): líder, integrantes y plazo de 2 meses. Queda registrado como decisión de esta sesión.">＋ Asignar proceso</Bt>}
          </div>
          {encActivos.length === 0 && <Vacio ic="🧩" txt="Sin comités de trabajo activos asignados por este comité." />}
          {encActivos.map(en => (
            <div key={en.id} style={{ padding: '8px 10px', borderRadius: 9, background: 'var(--bg-page)', marginBottom: 6, borderLeft: `3px solid ${en.vencido ? 'var(--danger)' : 'var(--accent)'}` }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span onClick={() => onAbrir(en.proceso_id)} style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 800, fontSize: 12 }}>{en.proceso_id}</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{en.proceso_nombre}</span>
                <Bd c={en.vencido ? 'var(--danger)' : 'var(--text-muted)'}>{en.vencido ? `vencido +${Math.abs(en.dias_restantes)} d` : `${en.dias_restantes} días`}</Bd>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>Fase {en.fase_actual} · {en.fase_actual_nombre} · líder {en.lider} · {en.fases_completadas}/7 fases · {en.estado.toLowerCase().replace('_', ' ')}</div>
              {en.vencido && editable && puedeDecidir && <Bt v="warn" sm style={{ marginTop: 6 }} onClick={() => { setForm({ tipo: 'REASIGNACION', proceso_id: en.proceso_id, encargo_id: en.id, unanime: true, resultado: 'APROBADA', decision: `Comité de trabajo de ${en.proceso_id} vencido hace ${Math.abs(en.dias_restantes)} días: ` }); setSheet('decision') }}>Decidir: extender / reasignar</Bt>}
            </div>
          ))}
        </Cd>
      </div>

      {/* ── decisiones y acuerdos ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 13 }}>
        <Cd>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>Decisiones de la sesión</span><Bd c="var(--text-muted)">{decs.length}</Bd>
            {editable && <Bt sm dis={!puedeDecidir} style={{ marginLeft: 'auto' }} title={puedeDecidir ? 'Registra una decisión formal con fundamento y votación' : 'Sin quórum no se registran decisiones (principio 4)'}
              onClick={() => { setForm({ tipo: 'OTRA', unanime: true, resultado: 'APROBADA' }); setSheet('decision') }}>＋ Decisión</Bt>}
          </div>
          {!puedeDecidir && <div style={{ padding: '8px 11px', borderRadius: 9, background: 'var(--warning-bg)', color: 'var(--warning-text)', fontSize: 12, marginBottom: 8 }}>Sesión sin quórum o anulada: no admite decisiones. Las que se necesiten van a la próxima sesión con quórum.</div>}
          {decs.length === 0 && <Vacio ic="⚖️" txt="Sin decisiones registradas. Aprobaciones de SOP, asignaciones, cambios de meta y escalamientos se registran acá." />}
          {decs.map((d, i) => (
            <div key={d.id} style={{ padding: '8px 10px', borderRadius: 9, background: 'var(--bg-page)', marginBottom: 6, borderLeft: `3px solid ${COLOR_DEC[d.resultado] || 'var(--accent)'}` }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 800, fontSize: 11.5, color: 'var(--text-muted)' }}>D{i + 1}</span>
                <Bd c="var(--accent)">{(TIPOS_DECISION.find(t => t.k === d.tipo) || {}).l || d.tipo}</Bd>
                <Bd c={COLOR_DEC[d.resultado]}>{d.resultado}</Bd>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.unanime ? 'unánime' : `${d.votos_favor ?? 0}–${d.votos_contra ?? 0}–${d.abstenciones ?? 0}`}</span>
                {d.proceso_id && <span onClick={() => onAbrir(d.proceso_id)} style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 700, fontSize: 11.5 }}>{d.proceso_id}</span>}
                {editable && !cerrada && <span style={{ marginLeft: 'auto' }}><BtEliminar title="Eliminar la decisión" onConfirm={async () => { await supabase.from('prc_decisiones').delete().eq('id', d.id); cargar(true) }} /></span>}
              </div>
              <div style={{ fontSize: 12.5, marginTop: 4 }}>{d.decision}</div>
              {d.fundamento && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>Fundamento: {d.fundamento}</div>}
            </div>
          ))}
        </Cd>
        <Cd>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>Acuerdos de la sesión</span><Bd c={acuSesion.length ? 'var(--accent)' : 'var(--danger)'}>{acuSesion.length}</Bd>
            {editable && <Bt sm style={{ marginLeft: 'auto' }} onClick={() => { setForm({ tipo: 'SEGUIMIENTO', responsable: '', compromiso: sumarDias(hoy(), 14) }); setSheet('acuerdo') }} title="Acuerdo = tarea con responsable, plazo y criterio de cierre verificable">＋ Acuerdo</Bt>}
          </div>
          {acuSesion.length === 0 && <Vacio ic="🤝" txt="Sin acuerdos. Regla crítica: un comité sin acuerdos registrados no se realizó." />}
          {acuSesion.map((a, i) => (
            <div key={a.id} style={{ padding: '8px 10px', borderRadius: 9, background: 'var(--bg-page)', marginBottom: 6, borderLeft: `3px solid ${COLOR_ACU[a.estado]}` }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 800, fontSize: 11.5, color: 'var(--text-muted)' }}>A{i + 1}</span>
                <Bd c="var(--accent)">{(TIPOS_ACUERDO.find(t => t.k === a.tipo) || {}).l || a.tipo}</Bd>
                {a.proceso_id && <span onClick={() => onAbrir(a.proceso_id)} style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 700, fontSize: 11.5 }}>{a.proceso_id}</span>}
                {editable ? (
                  <select value={a.estado} onChange={ev => upd('prc_agenda_comite', { estado: ev.target.value, cerrado_por: ev.target.value === 'CERRADO' ? cu?.nombre : null }, a.id)} style={{ ...css.select, padding: '2px 5px', fontSize: 10.5, color: COLOR_ACU[a.estado], fontWeight: 700, marginLeft: 'auto' }}>
                    {['ABIERTO', 'EN_CURSO', 'CERRADO', 'ANULADO'].map(x => <option key={x} value={x}>{x}</option>)}
                  </select>
                ) : <Bd c={COLOR_ACU[a.estado]} style={{ marginLeft: 'auto' }}>{a.estado}</Bd>}
              </div>
              <div style={{ fontSize: 12.5, marginTop: 4 }}>{a.acuerdo}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                <b>{a.responsable || 'sin responsable'}</b> · plazo {fFecha(a.fecha_compromiso)}{a.kpi_indicador ? ` · contramedida sobre ${a.kpi_indicador}` : ''}
                {a.criterio_cierre && <div>Cierre: {a.criterio_cierre}</div>}
              </div>
            </div>
          ))}
        </Cd>
      </div>

      {/* ── cierre ── */}
      <Cd accent={cerrada ? e.c : 'var(--accent)'}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 300 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>Cierre de la sesión</div>
            {check.map(c => (
              <div key={c.k} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, marginBottom: 5 }}>
                <span style={{ width: 18, height: 18, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#fff', background: c.ok ? 'var(--success)' : c.critico ? 'var(--danger)' : 'var(--warning)' }}>{c.ok ? '✓' : '!'}</span>
                <span>{c.l}</span>{c.info && <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{c.info}</span>}
              </div>
            ))}
            {cerrada && <Hint style={{ marginTop: 8 }}>Cerrada por {s.cerrada_por || '—'}{s.cerrada_at ? ` · ${fFecha(s.cerrada_at.slice(0, 10))}` : ''}. Estado del acta: <b>{s.acta_estado}</b>{s.acta_aprobada_por ? ` (aprobada por ${s.acta_aprobada_por})` : ''}.</Hint>}
          </div>
          <div style={{ flex: 1, minWidth: 300 }}>
            <Campo l="Observaciones para el acta" hint="Contexto, incidencias o constancias. No reemplaza a las decisiones ni a los acuerdos.">
              <textarea rows={4} disabled={!editable || s.acta_estado === 'APROBADA'} value={resumen} onChange={ev => setResumen(ev.target.value)} onBlur={guardarResumen}
                style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }} />
            </Campo>
            {proxima && <Hint>Próxima sesión agendada: <b>{fFecha(proxima.fecha)}</b>{proxima.tema ? ` · ${proxima.tema}` : ''}. Si no hay una, agéndala desde el calendario (Agendar la siguiente).</Hint>}
            {!proxima && <Hint>No hay próxima sesión agendada para este comité. Agéndala desde el calendario antes de cerrar (fase 3, cierre).</Hint>}
          </div>
        </div>
      </Cd>

      {/* ══ sheets ══ */}
      <Sheet open={sheet === 'od'} onClose={() => setSheet(null)} title={form.id ? 'Editar punto del orden del día' : 'Agregar punto al orden del día'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            <Campo l="Tipo"><select style={{ ...css.input, cursor: 'pointer' }} value={form.tipo || 'TEMA'} onChange={ev => setForm({ ...form, tipo: ev.target.value })}>
              {Object.keys(TIPOS_OD).map(k => <option key={k} value={k}>{TIPOS_OD[k].ic} {TIPOS_OD[k].l}</option>)}</select></Campo>
            <Campo l="Minutos"><input type="number" min="1" style={css.input} value={form.minutos ?? ''} onChange={ev => setForm({ ...form, minutos: ev.target.value })} /></Campo>
          </div>
          <Campo l="Título" obligatorio><input style={css.input} value={form.titulo || ''} onChange={ev => setForm({ ...form, titulo: ev.target.value })} placeholder="Ej: Aprobación del SOP de compras (P07)" /></Campo>
          <Campo l="Detalle / material de pre-lectura" hint="Va en la convocatoria y en el acta."><textarea rows={3} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }} value={form.detalle || ''} onChange={ev => setForm({ ...form, detalle: ev.target.value })} /></Campo>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            <Campo l="Expone"><input style={css.input} list="prc-usuarios" value={form.expositor || ''} onChange={ev => setForm({ ...form, expositor: ev.target.value })} /></Campo>
            <Campo l="Proceso (opcional)"><select style={{ ...css.input, cursor: 'pointer' }} value={form.proceso_id || ''} onChange={ev => setForm({ ...form, proceso_id: ev.target.value })}>
              <option value="">—</option>{procesosComite.map(p => <option key={p.id} value={p.id}>{p.id} · {p.nombre}</option>)}</select></Campo>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><Bt v="sec" onClick={() => setSheet(null)}>Cancelar</Bt><Bt dis={busy} onClick={guardarOD}>Guardar</Bt></div>
        </div>
      </Sheet>

      <Sheet open={sheet === 'convocar'} onClose={() => setSheet(null)} title="Convocar asistentes">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <Campo l="Nombres o cargos" obligatorio hint="Enter por cada uno. Se sugieren los usuarios del ERP, los integrantes del comité y los dueños de proceso.">
            <Chips valores={form.nombres || []} onChange={v => setForm({ ...form, nombres: v })} ph="Ej: Juan Pablo Reyes — escribe y Enter"
              sugerencias={[...new Set([...(comite?.integrantes || []), ...usuarios.map(u => u.nombre), ...matriz.map(p => p.dueno_persona || p.dueno_cargo).filter(Boolean)])].sort()} />
          </Campo>
          <Campo l="Rol en la sesión" hint="Los invitados no cuentan para el quórum ni votan (principios 6 y roles de P21)."><select style={{ ...css.input, cursor: 'pointer' }} value={form.rol_sesion || 'PARTICIPANTE'} onChange={ev => setForm({ ...form, rol_sesion: ev.target.value })}>
            {ROLES_SESION.map(r => <option key={r.k} value={r.k}>{r.l}</option>)}</select></Campo>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><Bt v="sec" onClick={() => setSheet(null)}>Cancelar</Bt><Bt dis={busy} onClick={convocar}>Convocar</Bt></div>
        </div>
      </Sheet>

      <Sheet open={sheet === 'medicion'} onClose={() => setSheet(null)} title={`Registrar medición · ${form.indicador || ''}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 9 }}>
            <Campo l="Período" obligatorio hint="2026-09 · 2026-S36 · 2026-Q3"><input style={css.input} value={form.periodo || ''} onChange={ev => setForm({ ...form, periodo: ev.target.value })} /></Campo>
            <Campo l="Valor"><input type="number" step="any" style={css.input} value={form.valor ?? ''} onChange={ev => setForm({ ...form, valor: ev.target.value })} /></Campo>
            <Campo l="¿Cumple?" hint="Solo si el indicador no tiene meta numérica."><select style={{ ...css.input, cursor: 'pointer' }} value={form.cumple || ''} onChange={ev => setForm({ ...form, cumple: ev.target.value })}><option value="">—</option><option value="si">Sí</option><option value="no">No</option></select></Campo>
          </div>
          <Campo l="Valor en texto (opcional)"><input style={css.input} value={form.valor_texto || ''} onChange={ev => setForm({ ...form, valor_texto: ev.target.value })} /></Campo>
          <Campo l="Comentario"><textarea rows={2} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }} value={form.comentario || ''} onChange={ev => setForm({ ...form, comentario: ev.target.value })} /></Campo>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><Bt v="sec" onClick={() => setSheet(null)}>Cancelar</Bt><Bt dis={busy} onClick={guardarMedicion}>Registrar</Bt></div>
        </div>
      </Sheet>

      <Sheet open={sheet === 'decision'} onClose={() => setSheet(null)} title={`Registrar decisión · sesión N° ${s.numero ?? ''}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            <Campo l="Tipo"><select style={{ ...css.input, cursor: 'pointer' }} value={form.tipo || 'OTRA'} onChange={ev => setForm({ ...form, tipo: ev.target.value })}>{TIPOS_DECISION.map(t => <option key={t.k} value={t.k}>{t.l}</option>)}</select></Campo>
            <Campo l="Proceso (opcional)"><select style={{ ...css.input, cursor: 'pointer' }} value={form.proceso_id || ''} onChange={ev => setForm({ ...form, proceso_id: ev.target.value, documento_id: '' })}>
              <option value="">—</option>{matriz.map(p => <option key={p.id} value={p.id}>{p.id} · {p.nombre}</option>)}</select></Campo>
          </div>
          {form.proceso_id && docs.some(d => d.proceso_id === form.proceso_id) && (
            <Campo l="Documento (opcional)"><select style={{ ...css.input, cursor: 'pointer' }} value={form.documento_id || ''} onChange={ev => setForm({ ...form, documento_id: ev.target.value })}>
              <option value="">—</option>{docs.filter(d => d.proceso_id === form.proceso_id).map(d => <option key={d.id} value={d.id}>{d.codigo} v{d.version} · {d.estado}</option>)}</select></Campo>
          )}
          <Campo l="Decisión" obligatorio hint="Qué se resuelve, en una frase que se entienda sin haber estado en la sala."><textarea rows={3} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }} value={form.decision || ''} onChange={ev => setForm({ ...form, decision: ev.target.value })} /></Campo>
          <Campo l="Fundamento" hint="Datos o criterio en que se apoya (indicador, diagnóstico, riesgo)."><textarea rows={2} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }} value={form.fundamento || ''} onChange={ev => setForm({ ...form, fundamento: ev.target.value })} /></Campo>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            <Campo l="Votación"><select style={{ ...css.input, cursor: 'pointer' }} value={form.unanime === false ? 'votos' : 'unanime'} onChange={ev => setForm({ ...form, unanime: ev.target.value === 'unanime' })}><option value="unanime">Unánime</option><option value="votos">Con votos</option></select></Campo>
            <Campo l="Resultado"><select style={{ ...css.input, cursor: 'pointer' }} value={form.resultado || 'APROBADA'} onChange={ev => setForm({ ...form, resultado: ev.target.value })}><option value="APROBADA">Aprobada</option><option value="RECHAZADA">Rechazada</option><option value="POSTERGADA">Postergada</option></select></Campo>
          </div>
          {form.unanime === false && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 9 }}>
              <Campo l="A favor"><input type="number" min="0" style={css.input} value={form.favor ?? ''} onChange={ev => setForm({ ...form, favor: ev.target.value })} /></Campo>
              <Campo l="En contra"><input type="number" min="0" style={css.input} value={form.contra ?? ''} onChange={ev => setForm({ ...form, contra: ev.target.value })} /></Campo>
              <Campo l="Abstenciones"><input type="number" min="0" style={css.input} value={form.abst ?? ''} onChange={ev => setForm({ ...form, abst: ev.target.value })} /></Campo>
            </div>
          )}
          <Hint>Si hay empate, arbitra quien preside (rol Líder de comité). Presupuesto e inversión no se deciden acá: se escalan al Directorio (principio 14).</Hint>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><Bt v="sec" onClick={() => setSheet(null)}>Cancelar</Bt><Bt dis={busy} onClick={guardarDecision}>Registrar decisión</Bt></div>
        </div>
      </Sheet>

      <Sheet open={sheet === 'acuerdo'} onClose={() => setSheet(null)} title={form.tipo === 'CONTRAMEDIDA' ? 'Registrar contramedida' : `Registrar acuerdo · sesión N° ${s.numero ?? ''}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            <Campo l="Tipo"><select style={{ ...css.input, cursor: 'pointer' }} value={form.tipo || 'SEGUIMIENTO'} onChange={ev => setForm({ ...form, tipo: ev.target.value })}>{TIPOS_ACUERDO.map(t => <option key={t.k} value={t.k}>{t.l}</option>)}</select></Campo>
            <Campo l="Proceso (opcional)"><select style={{ ...css.input, cursor: 'pointer' }} value={form.proceso_id || ''} onChange={ev => setForm({ ...form, proceso_id: ev.target.value })}>
              <option value="">—</option>{matriz.map(p => <option key={p.id} value={p.id}>{p.id} · {p.nombre}</option>)}</select></Campo>
          </div>
          {form.tipo === 'CONTRAMEDIDA' && (
            <Campo l="Indicador"><select style={{ ...css.input, cursor: 'pointer' }} value={form.kpi_id || ''} onChange={ev => setForm({ ...form, kpi_id: ev.target.value })}>
              <option value="">—</option>{scorecard.map(k => <option key={k.id} value={k.id}>{k.proceso_id} · {k.indicador} ({semDe(k.semaforo).l})</option>)}</select></Campo>
          )}
          <Campo l={form.tipo === 'CONTRAMEDIDA' ? 'Contramedida' : 'Acuerdo'} obligatorio hint="Qué se hará, en una frase accionable."><textarea rows={3} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }} value={form.acuerdo || ''} onChange={ev => setForm({ ...form, acuerdo: ev.target.value })} /></Campo>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            <Campo l="Responsable" obligatorio><input style={css.input} list="prc-usuarios" value={form.responsable || ''} onChange={ev => setForm({ ...form, responsable: ev.target.value })} /></Campo>
            <Campo l="Fecha de compromiso" obligatorio><input type="date" style={css.input} value={form.compromiso || ''} onChange={ev => setForm({ ...form, compromiso: ev.target.value })} /></Campo>
          </div>
          <Campo l="Criterio de cierre verificable" hint="Cómo se comprobará que se cumplió (documento, cifra, evidencia)."><input style={css.input} value={form.criterio_cierre || ''} onChange={ev => setForm({ ...form, criterio_cierre: ev.target.value })} placeholder="Ej: SOP v0.2 guardado y revisado por el dueño en el ERP" /></Campo>
          {decs.length > 0 && (
            <Campo l="Deriva de la decisión (opcional)"><select style={{ ...css.input, cursor: 'pointer' }} value={form.decision_id || ''} onChange={ev => setForm({ ...form, decision_id: ev.target.value })}>
              <option value="">—</option>{decs.map((d, i) => <option key={d.id} value={d.id}>D{i + 1} · {d.decision.slice(0, 70)}</option>)}</select></Campo>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><Bt v="sec" onClick={() => setSheet(null)}>Cancelar</Bt><Bt dis={busy} onClick={guardarAcuerdo}>Registrar</Bt></div>
        </div>
      </Sheet>

      <EncargoSheet open={sheet === 'encargo'} onClose={() => setSheet(null)} matriz={matriz} cat={cat} cu={cu} toast={toast} usuarios={usuarios}
        sesion={s} comiteCodigo={s.comite_codigo} onGuardado={() => { setSheet(null); cargar(true) }} />

      <datalist id="prc-usuarios">{[...new Set([...(comite?.integrantes || []), ...usuarios.map(u => u.nombre), ...asis.map(a => a.nombre)])].map(n => <option key={n} value={n} />)}</datalist>
    </div>
  )
}
