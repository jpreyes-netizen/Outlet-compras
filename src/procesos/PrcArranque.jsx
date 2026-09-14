// src/procesos/PrcArranque.jsx — Asistente de arranque del gobierno.
//
// Constituye los comités de gobierno en un solo flujo: para cada comité propone
// el equipo (a partir de los usuarios del ERP y de los dueños de los procesos que
// ese comité gobierna), el secretario de actas, el quórum y el ritmo (día, hora,
// lugar); valida las reglas de P21 (mínimo 3, impar, alguien de otra área,
// secretario por nombre) y al final agenda de una vez las sesiones del período
// para todos los comités constituidos.
//
// Sin esto hay que llenar 7 reglamentos a mano en Config y agendar sesión por
// sesión — la razón por la que el módulo no arrancaba.
//
// Tablas: prc_comites (update) · prc_sesiones_comite (insert) · usuarios (lectura)

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { Cd, Bt, Bd, Hint, Campo, Vacio, css, hoy, uid, fFecha, Barra } from './prcUI'
import { usePersonas, ChipsPersonas, SelPersona } from './prcPersonas'
import { sumarDias, TIPOS_OD, disponibilidad, etiquetaCarga } from './prcComite'

/* ── mapeo dirección del comité → roles del ERP que naturalmente lo integran ── */
const ROLES_POR_DIRECCION = {
  DIR_GENERAL:      ['admin', 'dir_general', 'dir_negocios', 'jefe_admin_finanzas'],
  DIR_COMERCIAL:    ['jefe_tienda', 'postventa', 'dir_general'],
  DIR_OPERACIONES:  ['jefe_bodega', 'operaciones', 'dir_general'],
  DIR_NEGOCIOS:     ['dir_negocios', 'analista', 'jefe_bodega'],
  DIR_ADM_FIN:      ['jefe_admin_finanzas', 'analista', 'caja'],
  GESTION_PERSONAS: ['admin', 'jefe_tienda', 'dir_general']
}

/* ── plantillas de orden del día por tipo de comité (estructura de P37) ────── */
const OD_BASE = [
  { tipo: 'APERTURA',            titulo: 'Apertura, quórum y acta anterior',        minutos: 5 },
  { tipo: 'ACUERDOS_ANTERIORES', titulo: 'Acuerdos anteriores y su cumplimiento',   minutos: 10 },
  { tipo: 'SCORECARD',           titulo: 'Scorecard: indicadores en rojo',          minutos: 20 }
]
const OD_CIERRE = { tipo: 'CIERRE', titulo: 'Acuerdos, responsables y próxima sesión', minutos: 10 }
const OD_EXTRA = {
  CD:         [{ tipo: 'PROCESOS', titulo: 'Avance de la matriz y comités de trabajo', minutos: 20 }, { tipo: 'DECISION', titulo: 'SOP para aprobación y desbloqueos', minutos: 15 }],
  DIRECTORIO: [{ tipo: 'PROCESOS', titulo: 'Estado de la matriz de procesos', minutos: 15 }, { tipo: 'DECISION', titulo: 'Políticas, inversión y aprobación de SOP corporativos', minutos: 25 }],
  CCOM:       [{ tipo: 'TEMA', titulo: 'Conversión, SLA de postventa y casos críticos', minutos: 20 }, { tipo: 'PROCESOS', titulo: 'Procesos comerciales en construcción', minutos: 15 }],
  COPS:       [{ tipo: 'TEMA', titulo: 'OTIF, exactitud de inventario e incidencias', minutos: 20 }, { tipo: 'PROCESOS', titulo: 'Procesos de operaciones en construcción', minutos: 15 }],
  CABAST:     [{ tipo: 'TEMA', titulo: 'Quiebre de stock clase A e importaciones en tránsito', minutos: 20 }, { tipo: 'PROCESOS', titulo: 'Procesos de abastecimiento en construcción', minutos: 15 }],
  CFIN:       [{ tipo: 'TEMA', titulo: 'Cierre del mes, presupuesto vs. real y tesorería', minutos: 25 }, { tipo: 'PROCESOS', titulo: 'Procesos administrativos en construcción', minutos: 15 }],
  CPER:       [{ tipo: 'TEMA', titulo: 'Dotación, capacitación y desempeño', minutos: 20 }, { tipo: 'PROCESOS', titulo: 'Procesos de personas en construcción', minutos: 15 }]
}
const ordenDiaPlantilla = cod => [...OD_BASE, ...(OD_EXTRA[cod] || [{ tipo: 'TEMA', titulo: 'Temas del período', minutos: 20 }]), OD_CIERRE]

const JEFATURAS = ['admin', 'dir_general', 'dir_negocios', 'jefe_admin_finanzas', 'jefe_tienda', 'jefe_bodega', 'analista']

const DIAS = [{ v: 1, l: 'Lunes' }, { v: 2, l: 'Martes' }, { v: 3, l: 'Miércoles' }, { v: 4, l: 'Jueves' }, { v: 5, l: 'Viernes' }, { v: 6, l: 'Sábado' }]
const DIA_SUGERIDO = { CD: 1, CCOM: 2, COPS: 3, CABAST: 4, CFIN: 4, CPER: 5, DIRECTORIO: 5 }
const HORA_SUGERIDA = { CD: '09:00', CCOM: '10:00', COPS: '09:00', CABAST: '11:00', CFIN: '15:00', CPER: '10:00', DIRECTORIO: '16:00' }

const norm = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const mismo = (a, b) => norm(a) === norm(b)
const sumarMes = (fecha, n) => { const d = new Date(fecha + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10) }
const diaDe = f => { const d = new Date(f + 'T00:00:00Z').getUTCDay(); return d === 0 ? 7 : d }

/** Primera fecha >= desde que cae en el día de la semana pedido. */
function primerDia(desde, dia) {
  let f = desde
  for (let i = 0; i < 7; i++) { if (diaDe(f) === dia) return f; f = sumarDias(f, 1) }
  return desde
}

/** Fechas de sesión de un comité entre dos fechas, según su periodicidad. */
function fechasDe(comite, desde, hasta, yaAgendadas = []) {
  const dia = comite.dia_semana || DIA_SUGERIDO[comite.codigo] || 1
  const per = comite.periodicidad || 'SEMANAL'
  const salto = { SEMANAL: 7, QUINCENAL: 14 }[per]
  const out = []
  let f = primerDia(desde, dia)
  for (let i = 0; i < 60 && f <= hasta; i++) {
    if (!yaAgendadas.includes(f)) out.push(f)
    f = salto ? sumarDias(f, salto) : primerDia(sumarMes(f, per === 'TRIMESTRAL' ? 3 : 1), dia)
    if (out.length >= 30) break
  }
  return out
}

/* ── validación de la conformación de un comité de gobierno (P21) ──────────── */
function validar(d, comite) {
  const errs = [], avisos = []
  const lista = (d.integrantes || []).map(x => String(x).trim()).filter(Boolean)
  if (lista.length < 3) errs.push(`Mínimo 3 integrantes (hay ${lista.length}).`)
  else if (lista.length % 2 === 0) errs.push(`La conformación debe ser impar (hay ${lista.length}) — principio 7.`)
  if (!d.secretario?.trim()) errs.push('Falta el secretario de actas: sin nombre no hay acta (principio 6).')
  else if (lista.length && !lista.some(x => mismo(x, d.secretario))) errs.push('El secretario debe estar entre los integrantes.')
  if (comite?.responsable && lista.length && !lista.some(x => mismo(x, comite.responsable)))
    avisos.push(`${comite.responsable} preside el comité y no está en la lista.`)
  if (!d.dia_semana) errs.push('Falta el día en que sesiona.')
  if (!d.hora_inicio) errs.push('Falta la hora de inicio.')
  return { ok: errs.length === 0, errs, avisos }
}

export function PrcArranque({ cat, matriz = [], cu, toast, onCerrar, onListo }) {
  const { personas } = usePersonas()
  const [usuarios, setUsuarios] = useState([])
  const [encargos, setEncargos] = useState([])
  const [sesiones, setSesiones] = useState([])
  const [uCargados, setUCargados] = useState(false)
  const [draft, setDraft] = useState({})
  const [sel, setSel] = useState(null)
  const [paso, setPaso] = useState('equipos')       // equipos → calendario → listo
  const [busy, setBusy] = useState(false)
  const [desde, setDesde] = useState(hoy())
  const [hasta, setHasta] = useState(sumarMes(hoy(), 3))
  const [resultado, setResultado] = useState(null)

  const comites = useMemo(() => (cat.comites || []).filter(c => c.activo !== false), [cat])

  useEffect(() => {
    Promise.all([
      supabase.from('usuarios').select('id, nombre, cargo, rol').limit(300),
      supabase.from('v_prc_encargos').select('*'),
      supabase.from('v_prc_sesiones').select('id, comite_codigo, fecha, hora_inicio, estado')
    ]).then(([u, e, s2]) => {
      setUsuarios(u.error ? [] : (u.data || []).filter(x => x.nombre))
      setEncargos(e.error ? [] : (e.data || []))
      setSesiones(s2.error ? [] : (s2.data || []))
      setUCargados(true)
    })
  }, [])

  /* propuesta inicial: se calcula una vez que los usuarios del ERP ya llegaron,
     para que el equipo propuesto no quede pobre por una carrera de carga */
  useEffect(() => {
    if (!comites.length || !uCargados) return
    setDraft(prev => {
      const d = { ...prev }
      comites.forEach(c => {
        if (d[c.codigo]) return
        d[c.codigo] = {
          integrantes: proponer(c),
          secretario: '',
          quorum: Math.round((c.quorum_min ?? 0.75) * 100),
          integrantes_min: c.integrantes_min ?? 3,
          dia_semana: c.dia_semana || DIA_SUGERIDO[c.codigo] || 1,
          hora_inicio: c.hora_inicio?.slice(0, 5) || HORA_SUGERIDA[c.codigo] || '09:00',
          hora_fin: c.hora_fin?.slice(0, 5) || '',
          lugar: c.lugar || '',
          orden_dia: ordenDiaPlantilla(c.codigo),
          guardado: false
        }
      })
      return d
    })
    if (!sel) setSel(comites[0]?.codigo || null)
  }, [comites, uCargados])   // eslint-disable-line react-hooks/exhaustive-deps

  /** Equipo propuesto: quien preside + dueños de los procesos del comité + perfiles de su
      dirección; si aún no llega a 3, se completa con quienes presiden otros comités (así
      siempre hay alguien de otra área, principio 5) y con las jefaturas del ERP. */
  function proponer(c) {
    if ((c.integrantes || []).length >= 3) return [...c.integrantes]
    const out = []
    const push = n => { const v = String(n || '').trim(); if (v && !out.some(x => mismo(x, v))) out.push(v) }
    push(c.responsable)
    matriz.filter(p => p.comite_codigo === c.codigo && p.dueno_persona).forEach(p => push(p.dueno_persona))
    const roles = ROLES_POR_DIRECCION[c.direccion] || []
    usuarios.filter(u => roles.includes(u.rol)).forEach(u => push(u.nombre))
    if (out.length < 3) comites.filter(x => x.codigo !== c.codigo).forEach(x => { if (out.length < 3) push(x.responsable) })
    if (out.length < 3) usuarios.filter(u => JEFATURAS.includes(u.rol)).forEach(u => { if (out.length < 3) push(u.nombre) })
    let lista = out.slice(0, 5)
    if (lista.length >= 4 && lista.length % 2 === 0) lista = lista.slice(0, lista.length - 1)
    return lista
  }

  /* Candidatos sin repetir: los nombres vienen escritos de formas distintas
     ("Rocío Jara" / "Rocio Jara"), así que se deduplican ignorando tildes. */
  const sugerencias = useMemo(() => {
    const vistos = new Map()
    ;[...usuarios.map(u => u.nombre), ...matriz.map(p => p.dueno_persona)]
      .filter(Boolean)
      .forEach(n => { const k = norm(n); if (!vistos.has(k)) vistos.set(k, String(n).trim()) })
    return [...vistos.values()].sort()
  }, [usuarios, matriz])

  const cd = sel ? draft[sel] : null
  const comiteSel = comites.find(c => c.codigo === sel)
  const val = cd ? validar(cd, comiteSel) : { ok: false, errs: [], avisos: [] }
  const set = (k, v) => setDraft(d => ({ ...d, [sel]: { ...d[sel], [k]: v } }))

  const estados = useMemo(() => comites.map(c => {
    const d = draft[c.codigo]
    return { c, ok: d ? validar(d, c).ok : false, guardado: !!d?.guardado }
  }), [comites, draft])
  const listos = estados.filter(e => e.ok).length

  /* ── disponibilidad del equipo propuesto ─────────────────────────────────
     Los comités "del mundo" son los que ya están en la base MÁS lo que se está
     armando en este asistente: así el choque se ve aunque los dos comités se
     estén creando en esta misma pasada. */
  const mundo = useMemo(() => comites.map(c => {
    const d = draft[c.codigo]
    return d ? { ...c, integrantes: d.integrantes, secretario: d.secretario, dia_semana: d.dia_semana, hora_inicio: d.hora_inicio, hora_fin: d.hora_fin } : c
  }), [comites, draft])

  const dispo = useMemo(() => {
    if (!cd || !comiteSel) return []
    const propuesta = { codigo: comiteSel.codigo, dia_semana: cd.dia_semana, hora_inicio: cd.hora_inicio, hora_fin: cd.hora_fin, duracion_min: comiteSel.duracion_min }
    return (cd.integrantes || []).map(p => disponibilidad(p, propuesta, { comites: mundo, encargos, sesiones }))
  }, [cd, comiteSel, mundo, encargos, sesiones])
  const conChoque = dispo.filter(d => d.choques.length)
  const sobrecargados = dispo.filter(d => d.sobrecargada)


  /* ── guardar los reglamentos ─────────────────────────────────────────────── */
  const constituir = async () => {
    const validos = estados.filter(e => e.ok)
    if (!validos.length) return toast('Ningún comité está completo todavía.', 'err')
    setBusy(true)
    let ok = 0, fallos = []
    for (const { c } of validos) {
      const d = draft[c.codigo]
      const { error } = await supabase.from('prc_comites').update({
        integrantes: d.integrantes,
        secretario: d.secretario,
        quorum_min: Math.min(1, Math.max(0.5, Number(d.quorum) / 100)),
        integrantes_min: +d.integrantes_min || 3,
        dia_semana: +d.dia_semana,
        hora_inicio: d.hora_inicio,
        hora_fin: d.hora_fin || null,
        lugar: d.lugar || null,
        orden_dia_estandar: d.orden_dia
      }).eq('codigo', c.codigo)
      if (error) fallos.push(`${c.codigo}: ${error.message}`); else { ok++; setDraft(x => ({ ...x, [c.codigo]: { ...x[c.codigo], guardado: true } })) }
    }
    setBusy(false)
    if (fallos.length) return toast('No se pudo guardar: ' + fallos[0], 'err')
    toast(`${ok} comité(s) constituido(s)`)
    setPaso('calendario')
  }

  /* ── agendar el período para todos los comités constituidos ──────────────── */
  const plan = useMemo(() => {
    if (paso !== 'calendario') return []
    return estados.filter(e => e.ok).map(({ c }) => {
      const d = draft[c.codigo]
      const fechas = fechasDe({ ...c, dia_semana: d.dia_semana }, desde, hasta)
      return { c, d, fechas }
    })
  }, [paso, estados, draft, desde, hasta])   // eslint-disable-line react-hooks/exhaustive-deps

  const totalSesiones = plan.reduce((a, p) => a + p.fechas.length, 0)

  const agendar = async () => {
    if (!totalSesiones) return toast('No hay fechas en el período elegido.', 'err')
    setBusy(true)
    const filas = []
    plan.forEach(({ c, d, fechas }) => fechas.forEach((f, i) => filas.push({
      id: `SES-${c.codigo}-${f.replace(/-/g, '')}-${uid()}`,
      comite_codigo: c.codigo, fecha: f, hora_inicio: d.hora_inicio, hora_fin: d.hora_fin || null,
      lugar: d.lugar || null, estado: 'AGENDADA', tipo: 'ORDINARIA', numero: i + 1,
      tema: `Sesión ordinaria de ${c.nombre}`, creada_por: cu?.nombre || null
    })))
    const { error } = await supabase.from('prc_sesiones_comite').insert(filas)
    setBusy(false)
    if (error) return toast('Error al agendar: ' + error.message, 'err')
    setResultado({ comites: plan.length, sesiones: filas.length, desde, hasta })
    setPaso('listo')
    onListo?.()
  }

  /* ── render ──────────────────────────────────────────────────────────────── */
  if (paso === 'listo' && resultado) return (
    <Cd accent="var(--success)">
      <div style={{ padding: 4 }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>✅ Gobierno constituido</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 12px' }}>
          Quedaron <b>{resultado.comites} comité(s)</b> con reglamento completo —integrantes, secretario de actas, quórum y ritmo— y
          <b> {resultado.sesiones} sesiones</b> agendadas entre el {fFecha(resultado.desde)} y el {fFecha(resultado.hasta)}.
          Desde ahora cada sesión se abre en la Sala, se marca asistencia, se registran acuerdos y el scorecard tiene dónde mostrarse.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <Bt onClick={() => onListo?.('calendario')}>Ver el calendario →</Bt>
          <Bt v="sec" onClick={onCerrar}>Cerrar</Bt>
        </div>
      </div>
    </Cd>
  )

  if (paso === 'calendario') return (
    <Cd accent="var(--accent)">
      <div style={{ padding: 4 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>📆 Paso 2 · Agendar el período</div>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6, margin: '6px 0 14px' }}>
          Con el ritmo ya guardado en cada reglamento, se agendan de una vez todas las sesiones ordinarias del período.
          Después puedes mover o cancelar cualquiera desde el calendario.
        </p>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
          <Campo l="Desde"><input type="date" style={css.input} value={desde} onChange={e => setDesde(e.target.value)} /></Campo>
          <Campo l="Hasta"><input type="date" style={css.input} value={hasta} onChange={e => setHasta(e.target.value)} /></Campo>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {plan.map(({ c, d, fechas }) => (
            <div key={c.codigo} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'var(--bg-app)', borderRadius: 8, fontSize: 12.5 }}>
              <Bd c="var(--accent)">{c.codigo}</Bd>
              <span style={{ fontWeight: 600 }}>{c.nombre}</span>
              <span style={{ color: 'var(--text-muted)' }}>
                {(c.periodicidad || 'SEMANAL').toLowerCase()} · {DIAS.find(x => x.v === +d.dia_semana)?.l} {d.hora_inicio}
              </span>
              <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{fechas.length} sesiones</span>
            </div>
          ))}
          {!plan.length && <Vacio ic="📅" txt="No hay comités constituidos para agendar." />}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Bt onClick={agendar} dis={busy || !totalSesiones}>{busy ? 'Agendando…' : `Agendar ${totalSesiones} sesiones →`}</Bt>
          <Bt v="sec" onClick={() => setPaso('equipos')}>← Volver a los equipos</Bt>
          <Bt v="sec" onClick={onCerrar}>Agendar después</Bt>
        </div>
      </div>
    </Cd>
  )

  return (
    <Cd accent="var(--accent)">
      <div style={{ padding: 4 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>🏛️ Paso 1 · Constituir los comités</div>
          <Bd c={listos === comites.length ? 'var(--success)' : 'var(--warning)'}>{listos} de {comites.length} listos</Bd>
          <Bt v="sec" sm style={{ marginLeft: 'auto' }} onClick={onCerrar}>Salir del asistente</Bt>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6, margin: '6px 0 14px' }}>
          Un comité sin integrantes ni secretario no puede sesionar: no hay quórum que verificar ni quién levante el acta (P21, principios 4, 6 y 7).
          Acá está propuesto el equipo de cada uno a partir de los usuarios del ERP y de los dueños de los procesos que gobierna — revísalo, ajústalo y sigue.
        </p>
        <Barra v={comites.length ? (listos / comites.length) * 100 : 0} c={listos === comites.length ? 'var(--success)' : 'var(--accent)'} />

        <div style={{ display: 'flex', gap: 14, marginTop: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* lista de comités */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 210, flex: '0 0 230px' }}>
            {estados.map(({ c, ok, guardado }) => (
              <div key={c.codigo} onClick={() => setSel(c.codigo)}
                style={{
                  padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5,
                  border: `1.5px solid ${sel === c.codigo ? 'var(--accent)' : 'transparent'}`,
                  background: sel === c.codigo ? 'var(--accent-bg)' : 'var(--bg-app)'
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13 }}>{guardado ? '✅' : ok ? '🟢' : '⚪'}</span>
                  <b>{c.codigo}</b>
                  <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11 }}>
                    {(draft[c.codigo]?.integrantes || []).length} pers.
                  </span>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11.5, marginTop: 2 }}>{c.nombre}</div>
              </div>
            ))}
          </div>

          {/* detalle del comité seleccionado */}
          {cd && comiteSel && (
            <div style={{ flex: '1 1 460px', minWidth: 320, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 700 }}>{comiteSel.nombre}</div>
                <Hint>{comiteSel.proposito || '—'}</Hint>
                <Hint>Preside: <b>{comiteSel.responsable || '—'}</b> · {(comiteSel.periodicidad || 'SEMANAL').toLowerCase()}</Hint>
              </div>

              <Campo l="Integrantes con derecho a voto" obligatorio
                hint="Mínimo 3 y en número impar. Incluye a alguien de otra área (principio 5). Se proponen los usuarios del ERP del área y los dueños de los procesos que este comité gobierna.">
                <ChipsPersonas valores={cd.integrantes} onChange={v => set('integrantes', v)}
                  personas={personas} ctx={{ comites: mundo, encargos, sesiones }}
                  propuesta={{ codigo: comiteSel.codigo, dia_semana: cd.dia_semana, hora_inicio: cd.hora_inicio, hora_fin: cd.hora_fin, duracion_min: comiteSel.duracion_min }} />
              </Campo>

              {/* disponibilidad: quién está libre, quién ya está cargado y quién choca a esa hora */}
              {dispo.length > 0 && (
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>
                    Disponibilidad del equipo
                    {conChoque.length > 0 && <span style={{ color: 'var(--danger)', fontWeight: 700 }}> · {conChoque.length} con choque de horario</span>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {dispo.map(d => (
                      <div key={d.persona} style={{
                        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12,
                        padding: '5px 9px', borderRadius: 7,
                        background: d.choques.length ? 'var(--danger-bg)' : d.sobrecargada ? 'var(--warning-bg)' : 'var(--bg-app)'
                      }}>
                        <span style={{ fontSize: 12.5 }}>{d.choques.length ? '⛔' : d.sobrecargada ? '⚠' : d.libre ? '🟢' : '🔵'}</span>
                        <b style={{ minWidth: 130 }}>{d.persona}</b>
                        <span style={{ color: 'var(--text-muted)' }}>{etiquetaCarga(d)}</span>
                        {d.lidera > 0 && <Bd c="var(--accent)">lidera {d.lidera}</Bd>}
                        {d.choques.map((ch, i) => (
                          <span key={i} style={{ color: 'var(--danger)', fontWeight: 600 }}>
                            ⛔ ya tiene {ch.codigo} {ch.tipo === 'COMITE' ? `los ${(DIAS.find(x => x.v === ch.dia) || {}).l?.toLowerCase()} ${ch.hora}` : `el ${fFecha(ch.fecha)} ${ch.hora}`}
                          </span>
                        ))}
                        {d.sobrecargada && !d.choques.length && <span style={{ color: 'var(--warning-text)' }}>ya está en {d.nComites} comités de gobierno</span>}
                      </div>
                    ))}
                  </div>
                  {conChoque.length > 0 && (
                    <Hint>Una persona no puede estar en dos salas a la vez: si va igual, una de las dos sesiones se queda sin su voto para el quórum. Cambia el día o la hora, o sácala del equipo.</Hint>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Campo l="Secretario/a de actas" obligatorio hint="Por nombre, no por área.">
                  <SelPersona valor={cd.secretario} onChange={v => set('secretario', v)} personas={personas}
                    soloDeLista={cd.integrantes} permitirLibre={false} ph="— elegir —" />
                </Campo>
                <Campo l="Quórum (%)" hint="Principio 4: ¾ = 75%.">
                  <input type="number" min="50" max="100" style={{ ...css.input, width: 90 }} value={cd.quorum} onChange={e => set('quorum', e.target.value)} />
                </Campo>
                <Campo l="Mínimo presentes">
                  <input type="number" min="1" style={{ ...css.input, width: 90 }} value={cd.integrantes_min} onChange={e => set('integrantes_min', e.target.value)} />
                </Campo>
              </div>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Campo l="Sesiona los" obligatorio>
                  <select style={css.select} value={cd.dia_semana} onChange={e => set('dia_semana', +e.target.value)}>
                    {DIAS.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
                  </select>
                </Campo>
                <Campo l="Hora inicio" obligatorio>
                  <input type="time" style={css.input} value={cd.hora_inicio} onChange={e => set('hora_inicio', e.target.value)} />
                </Campo>
                <Campo l="Hora término" hint="La sesión termina a la hora.">
                  <input type="time" style={css.input} value={cd.hora_fin} onChange={e => set('hora_fin', e.target.value)} />
                </Campo>
                <Campo l="Lugar o enlace">
                  <input style={css.input} value={cd.lugar} placeholder="Sala / Meet" onChange={e => set('lugar', e.target.value)} />
                </Campo>
              </div>

              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Orden del día estándar</div>
                <Hint>Se aplica a cada sesión de este comité; en la sala puedes agregar o sacar puntos.</Hint>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
                  {cd.orden_dia.map((o, i) => (
                    <span key={i} style={{ fontSize: 11.5, padding: '3px 8px', borderRadius: 999, background: 'var(--bg-app)', color: 'var(--text-muted)' }}>
                      {TIPOS_OD[o.tipo]?.ic || '•'} {o.titulo} · {o.minutos}′
                    </span>
                  ))}
                </div>
              </div>

              {(val.errs.length > 0 || val.avisos.length > 0) && (
                <div style={{ fontSize: 12, padding: '8px 11px', borderRadius: 8, lineHeight: 1.6, background: val.errs.length ? 'var(--danger-bg)' : 'var(--warning-bg)', color: val.errs.length ? 'var(--danger-text)' : 'var(--warning-text)' }}>
                  {val.errs.map((e, i) => <div key={'e' + i}>⚠ {e}</div>)}
                  {val.avisos.map((a, i) => <div key={'a' + i}>· {a}</div>)}
                </div>
              )}
              {val.ok && <div style={{ fontSize: 12, color: 'var(--success)' }}>✓ {comiteSel.nombre} cumple las reglas de conformación.</div>}

              <div style={{ display: 'flex', gap: 8 }}>
                {(() => {
                  const i = comites.findIndex(c => c.codigo === sel)
                  const sig = comites[i + 1]
                  return sig
                    ? <Bt v="sec" onClick={() => setSel(sig.codigo)}>Siguiente comité: {sig.codigo} →</Bt>
                    : null
                })()}
                <Bt onClick={constituir} dis={busy || !listos} style={{ marginLeft: 'auto' }}>
                  {busy ? 'Guardando…' : `Constituir ${listos} comité(s) y agendar →`}
                </Bt>
              </div>
            </div>
          )}
        </div>
      </div>
    </Cd>
  )
}

export default PrcArranque
