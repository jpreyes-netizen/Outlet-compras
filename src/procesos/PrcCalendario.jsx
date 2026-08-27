// src/procesos/PrcCalendario.jsx
// Calendario de sesiones de comité: qué comité se reúne, cuándo, con quién y
// con qué acuerdos. Vive dentro de la pestaña Comités.
//
// Tablas: prc_sesiones_comite · prc_asistencia_comite · v_prc_sesiones
// Los acuerdos de prc_agenda_comite se enlazan por sesion_id.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../supabase'
import {
  Cd, Bt, Bd, Mt, Sheet, Vacio, Ayuda, Hint, Campo, BtIc, BtEliminar, Chips,
  css, hoy, uid, fFecha, puedeEditar
} from './prcUI'

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const EST_SESION = {
  PLANIFICADA: { l: 'Planificada', c: 'var(--info)', bg: 'var(--info-bg)' },
  REALIZADA: { l: 'Realizada', c: 'var(--success)', bg: 'var(--success-bg)' },
  ANULADA: { l: 'Anulada', c: 'var(--text-muted)', bg: 'var(--bg-page)' }
}
const EST_ASIST = {
  CONVOCADO: { l: 'Convocado', c: 'var(--text-muted)' },
  PRESENTE: { l: 'Presente', c: 'var(--success)' },
  AUSENTE: { l: 'Ausente', c: 'var(--danger)' },
  JUSTIFICADO: { l: 'Justificado', c: 'var(--warning)' }
}
const ROLES_SESION = [
  { k: 'PRESIDE', l: 'Preside' },
  { k: 'SECRETARIO', l: 'Secretario/a de acta' },
  { k: 'PARTICIPANTE', l: 'Participante' },
  { k: 'INVITADO', l: 'Invitado/a' }
]
const PERIODICIDAD_DIAS = { SEMANAL: 7, QUINCENAL: 14, MENSUAL: 30, TRIMESTRAL: 90 }

/* fecha ISO ↔ pieza de calendario, sin librerías y sin sorpresas de zona horaria */
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const sumarDias = (fecha, n) => {
  const [y, m, d] = fecha.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

export function PrcCalendario({ matriz, cat, cu, onAbrir, toast }) {
  const editable = puedeEditar(cu)
  const [ses, setSes] = useState([])
  const [asis, setAsis] = useState([])
  const [acuerdos, setAcuerdos] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('')            // código de comité o '' = todos
  const [ver, setVer] = useState(() => {
    const t = new Date()
    return { y: t.getFullYear(), m: t.getMonth() }
  })
  const [selId, setSelId] = useState(null)
  const [sheet, setSheet] = useState(null)            // 'sesion' | 'asistente'
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)

  const cargar = useCallback(async (silencioso) => {
    if (!silencioso) setLoading(true)
    const [s, a, g, u] = await Promise.all([
      supabase.from('v_prc_sesiones').select('*').order('fecha', { ascending: false }),
      supabase.from('prc_asistencia_comite').select('*'),
      supabase.from('prc_agenda_comite').select('id, sesion_id, comite_codigo, proceso_id, acuerdo, responsable, fecha_compromiso, estado, tipo'),
      supabase.from('usuarios').select('id, nombre, cargo, rol').limit(200)
    ])
    setSes(s.data || []); setAsis(a.data || []); setAcuerdos(g.data || [])
    setUsuarios(u.error ? [] : (u.data || []))       // si el ERP no expone usuarios, se escriben a mano
    if (!silencioso) setLoading(false)
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const sesiones = useMemo(() => filtro ? ses.filter(s => s.comite_codigo === filtro) : ses, [ses, filtro])
  const sel = useMemo(() => ses.find(s => s.id === selId) || null, [ses, selId])
  const asisSel = useMemo(() => asis.filter(a => a.sesion_id === selId), [asis, selId])
  const acuSel = useMemo(() => acuerdos.filter(a => a.sesion_id === selId), [acuerdos, selId])

  /* ── grilla del mes: lunes a domingo ── */
  const grilla = useMemo(() => {
    const { y, m } = ver
    const primero = new Date(Date.UTC(y, m, 1))
    const offset = (primero.getUTCDay() + 6) % 7                 // lunes = 0
    const nDias = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    const celdas = []
    for (let i = 0; i < offset; i++) celdas.push(null)
    for (let d = 1; d <= nDias; d++) {
      const f = iso(y, m, d)
      celdas.push({ dia: d, fecha: f, sesiones: sesiones.filter(s => s.fecha === f) })
    }
    while (celdas.length % 7 !== 0) celdas.push(null)
    return celdas
  }, [ver, sesiones])

  const proximas = useMemo(() => sesiones
    .filter(s => s.fecha >= hoy() && s.estado !== 'ANULADA')
    .sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(0, 6), [sesiones])

  const porCerrar = useMemo(() => sesiones
    .filter(s => s.estado === 'PLANIFICADA' && s.fecha < hoy())
    .sort((a, b) => b.fecha.localeCompare(a.fecha)), [sesiones])

  const sinActa = useMemo(() => sesiones.filter(s => s.sin_acuerdos), [sesiones])

  const kpi = useMemo(() => {
    const real = sesiones.filter(s => s.estado === 'REALIZADA')
    const conAsist = real.filter(s => s.pct_asistencia != null)
    return {
      mes: sesiones.filter(s => s.fecha.slice(0, 7) === iso(ver.y, ver.m, 1).slice(0, 7)).length,
      realizadas: real.length,
      asistencia: conAsist.length ? Math.round(conAsist.reduce((a, s) => a + Number(s.pct_asistencia), 0) / conAsist.length) : null,
      abiertos: acuerdos.filter(a => ['ABIERTO', 'EN_CURSO'].includes(a.estado)
        && (!filtro || a.comite_codigo === filtro)).length
    }
  }, [sesiones, acuerdos, filtro, ver])

  const mover = n => setVer(v => {
    const t = new Date(Date.UTC(v.y, v.m + n, 1))
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() }
  })

  /* ── sesión: crear / editar ── */
  const abrirSesion = (s, fecha) => {
    const c = cat.comites.find(x => x.codigo === (s?.comite_codigo || filtro)) || cat.comites[0]
    setForm(s
      ? { ...s, comite_codigo: s.comite_codigo }
      : {
        comite_codigo: c?.codigo || '', fecha: fecha || hoy(), hora_inicio: '09:00', hora_fin: '10:30',
        lugar: '', tema: '', estado: 'PLANIFICADA', acta_url: '', observaciones: ''
      })
    setSheet('sesion')
  }

  const guardarSesion = async () => {
    if (!form.comite_codigo) return toast('Elige el comité que se reúne.', 'err')
    if (!form.fecha) return toast('Indica la fecha de la sesión.', 'err')
    setBusy(true)
    const fila = {
      comite_codigo: form.comite_codigo, fecha: form.fecha,
      hora_inicio: form.hora_inicio || null, hora_fin: form.hora_fin || null,
      lugar: form.lugar || null, tema: form.tema || null, estado: form.estado || 'PLANIFICADA',
      acta_url: form.acta_url || null, observaciones: form.observaciones || null
    }
    let error, nuevoId = form.id
    if (form.id) {
      ;({ error } = await supabase.from('prc_sesiones_comite').update(fila).eq('id', form.id))
    } else {
      nuevoId = `SES-${form.comite_codigo}-${form.fecha.replace(/-/g, '')}-${uid().slice(-4)}`
      ;({ error } = await supabase.from('prc_sesiones_comite').insert({ ...fila, id: nuevoId, creada_por: cu?.nombre || '—' }))
    }
    setBusy(false)
    if (error) return toast('No se pudo guardar la sesión: ' + error.message, 'err')
    setSheet(null); setSelId(nuevoId)
    toast(form.id ? 'Sesión actualizada' : 'Sesión agendada')
    cargar(true)
  }

  const borrarSesion = async (s) => {
    const { error } = await supabase.from('prc_sesiones_comite').delete().eq('id', s.id)
    if (error) return toast('No se pudo eliminar: ' + error.message, 'err')
    setSheet(null); setSelId(null); toast('Sesión eliminada'); cargar(true)
  }

  const cambiarEstadoSesion = async (s, estado) => {
    const { error } = await supabase.from('prc_sesiones_comite').update({ estado }).eq('id', s.id)
    if (error) return toast('Error: ' + error.message, 'err')
    cargar(true)
  }

  /* ── asistentes ── */
  const guardarAsistentes = async () => {
    const nombres = (form.nombres || []).map(x => x.trim()).filter(Boolean)
    if (!nombres.length) return toast('Escribe al menos un nombre o cargo.', 'err')
    setBusy(true)
    const yaEstan = new Set(asisSel.map(a => a.nombre.toLowerCase()))
    const filas = nombres.filter(n => !yaEstan.has(n.toLowerCase())).map(n => {
      const u = usuarios.find(x => x.nombre === n)
      return {
        id: uid(), sesion_id: selId, nombre: n, cargo: u?.cargo || null, usuario_id: u?.id || null,
        rol_sesion: form.rol_sesion || 'PARTICIPANTE',
        estado: sel?.estado === 'REALIZADA' ? 'PRESENTE' : 'CONVOCADO'
      }
    })
    if (!filas.length) { setBusy(false); setSheet(null); return toast('Esos asistentes ya estaban convocados.') }
    const { error } = await supabase.from('prc_asistencia_comite').insert(filas)
    setBusy(false)
    if (error) return toast('No se pudo convocar: ' + error.message, 'err')
    setSheet(null); toast(`${filas.length} convocado(s)`); cargar(true)
  }

  const marcar = async (a, estado) => {
    const { error } = await supabase.from('prc_asistencia_comite').update({ estado }).eq('id', a.id)
    if (error) return toast('Error: ' + error.message, 'err')
    cargar(true)
  }
  const cambiarRol = async (a, rol_sesion) => {
    const { error } = await supabase.from('prc_asistencia_comite').update({ rol_sesion }).eq('id', a.id)
    if (error) return toast('Error: ' + error.message, 'err')
    cargar(true)
  }
  const quitarAsistente = async (a) => {
    const { error } = await supabase.from('prc_asistencia_comite').delete().eq('id', a.id)
    if (error) return toast('Error: ' + error.message, 'err')
    cargar(true)
  }

  /* ── copiar convocatoria de la sesión anterior del mismo comité ── */
  const copiarConvocatoria = async () => {
    const previa = ses
      .filter(s => s.comite_codigo === sel.comite_codigo && s.id !== sel.id && s.fecha <= sel.fecha)
      .sort((a, b) => b.fecha.localeCompare(a.fecha))[0]
    if (!previa) return toast('No hay una sesión anterior de este comité de donde copiar.', 'err')
    const lista = asis.filter(a => a.sesion_id === previa.id)
    if (!lista.length) return toast('La sesión anterior no tiene convocados.', 'err')
    const yaEstan = new Set(asisSel.map(a => a.nombre.toLowerCase()))
    const filas = lista.filter(a => !yaEstan.has(a.nombre.toLowerCase())).map(a => ({
      id: uid(), sesion_id: sel.id, nombre: a.nombre, cargo: a.cargo, usuario_id: a.usuario_id,
      rol_sesion: a.rol_sesion, estado: 'CONVOCADO'
    }))
    if (!filas.length) return toast('Ya están todos los de la sesión anterior.')
    const { error } = await supabase.from('prc_asistencia_comite').insert(filas)
    if (error) return toast('Error: ' + error.message, 'err')
    toast(`${filas.length} convocado(s) desde la sesión del ${fFecha(previa.fecha)}`); cargar(true)
  }

  /* ── agendar la siguiente según periodicidad ── */
  const agendarSiguiente = () => {
    const c = cat.comites.find(x => x.codigo === sel.comite_codigo)
    const salto = PERIODICIDAD_DIAS[c?.periodicidad] || 7
    abrirSesion(null, sumarDias(sel.fecha, salto))
  }

  const comiteNombre = k => (cat.comites.find(c => c.codigo === k) || {}).nombre || k

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      <Ayuda k="calendario" titulo="Cómo funciona el calendario de comités">
        Acá se agenda cada <b>sesión</b> de comité y se registra <b>quién fue convocado y quién asistió</b>.
        Haz clic en un día del calendario para agendar, o en una sesión para abrirla. Con la sesión abierta puedes
        convocar asistentes (se sugieren los usuarios del ERP, pero puedes escribir cualquier nombre o cargo),
        marcar presente / ausente / justificado, y ver los acuerdos que se tomaron en ella. Una sesión marcada como
        <b> realizada sin ningún acuerdo</b> queda señalada en rojo: la regla de P21 dice que un comité sin acuerdos
        registrados no se realizó.
      </Ayuda>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(158px, 1fr))', gap: 10 }}>
        <Mt l="Sesiones del mes" v={kpi.mes} sub={`${MESES[ver.m]} ${ver.y}`} />
        <Mt l="Sesiones realizadas" v={kpi.realizadas} sub="Con acta o acuerdos" c="var(--success)" />
        <Mt l="Asistencia promedio" v={kpi.asistencia == null ? '—' : kpi.asistencia + '%'} sub="Sobre los convocados"
          c={kpi.asistencia != null && kpi.asistencia < 70 ? 'var(--warning)' : 'var(--accent)'} />
        <Mt l="Acuerdos abiertos" v={kpi.abiertos} sub="Pendientes de cierre"
          c={kpi.abiertos ? 'var(--warning)' : 'var(--success)'} />
      </div>

      {/* filtros y navegación */}
      <Cd>
        <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={filtro} onChange={e => setFiltro(e.target.value)} title="Filtra el calendario por comité"
            style={{ ...css.select, fontSize: 12.5, minWidth: 210 }}>
            <option value="">Todos los comités</option>
            {cat.comites.map(c => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <BtIc ic="‹" title="Mes anterior" onClick={() => mover(-1)} />
            <span style={{ fontSize: 13.5, fontWeight: 700, minWidth: 148, textAlign: 'center', textTransform: 'capitalize' }}>
              {MESES[ver.m]} {ver.y}
            </span>
            <BtIc ic="›" title="Mes siguiente" onClick={() => mover(1)} />
            <Bt v="ghost" sm title="Volver al mes actual"
              onClick={() => { const t = new Date(); setVer({ y: t.getFullYear(), m: t.getMonth() }) }}>Hoy</Bt>
          </div>
          {editable && (
            <Bt sm style={{ marginLeft: 'auto' }} onClick={() => abrirSesion(null, hoy())}
              title="Agenda una sesión de comité: fecha, hora, lugar y tema">＋ Agendar sesión</Bt>
          )}
        </div>
        {porCerrar.length > 0 && (
          <div style={{
            marginTop: 11, padding: '9px 12px', borderRadius: 9, background: 'var(--warning-bg)',
            color: 'var(--warning-text)', fontSize: 12.5, borderLeft: '3px solid var(--warning)'
          }}>
            <b>{porCerrar.length} sesión(es) ya pasaron y siguen como planificadas.</b> Ábrelas y márcalas como
            realizadas con sus acuerdos, o anúlalas si no se hicieron.
          </div>
        )}
        {sinActa.length > 0 && (
          <div style={{
            marginTop: 8, padding: '9px 12px', borderRadius: 9, background: 'var(--danger-bg)',
            color: 'var(--danger-text)', fontSize: 12.5, borderLeft: '3px solid var(--danger)'
          }}>
            <b>{sinActa.length} sesión(es) realizadas sin ningún acuerdo registrado.</b> Un comité sin acuerdos no se realizó.
          </div>
        )}
      </Cd>

      {/* calendario */}
      <Cd style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border-1)' }}>
          {DIAS.map(d => (
            <div key={d} style={{
              padding: '8px 6px', fontSize: 10.5, fontWeight: 800, letterSpacing: .4, textTransform: 'uppercase',
              color: 'var(--text-muted)', textAlign: 'center', background: 'var(--bg-page)'
            }}>{d}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {grilla.map((c, i) => {
            if (!c) return <div key={i} style={{ minHeight: 92, background: 'var(--bg-page)', opacity: .45, borderRight: '1px solid var(--border-1)', borderBottom: '1px solid var(--border-1)' }} />
            const esHoy = c.fecha === hoy()
            return (
              <div key={i} onClick={() => editable && abrirSesion(null, c.fecha)}
                title={editable ? 'Clic para agendar una sesión este día' : ''}
                style={{
                  minHeight: 92, padding: 6, borderRight: '1px solid var(--border-1)', borderBottom: '1px solid var(--border-1)',
                  background: esHoy ? 'var(--accent-bg)' : 'var(--bg-surface)', cursor: editable ? 'pointer' : 'default'
                }}>
                <div style={{
                  fontSize: 11.5, fontWeight: esHoy ? 800 : 600, marginBottom: 4,
                  color: esHoy ? 'var(--accent)' : 'var(--text-muted)'
                }}>{c.dia}</div>
                {c.sesiones.map(s => {
                  const e = EST_SESION[s.estado] || EST_SESION.PLANIFICADA
                  return (
                    <div key={s.id} onClick={ev => { ev.stopPropagation(); setSelId(s.id) }}
                      title={`${comiteNombre(s.comite_codigo)}${s.tema ? ' · ' + s.tema : ''}`}
                      style={{
                        padding: '3px 6px', borderRadius: 6, marginBottom: 3, cursor: 'pointer',
                        background: e.bg, borderLeft: `3px solid ${s.sin_acuerdos ? 'var(--danger)' : e.c}`,
                        fontSize: 10.5, fontWeight: 700, color: e.c, overflow: 'hidden',
                        whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                        outline: selId === s.id ? '2px solid var(--accent)' : 'none'
                      }}>
                      {s.hora_inicio ? s.hora_inicio + ' ' : ''}{s.comite_codigo}
                      {s.n_convocados > 0 && <span style={{ fontWeight: 500, opacity: .8 }}> · {s.n_presentes}/{s.n_convocados}</span>}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </Cd>

      {/* sesión seleccionada */}
      {sel && (
        <Cd accent={EST_SESION[sel.estado]?.c}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 13 }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{sel.comite_nombre}</span>
                <Bd c={EST_SESION[sel.estado]?.c}>{EST_SESION[sel.estado]?.l}</Bd>
                {sel.sin_acuerdos && <Bd c="var(--danger)">sin acuerdos registrados</Bd>}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
                {fFecha(sel.fecha)}
                {sel.hora_inicio && ` · ${sel.hora_inicio}${sel.hora_fin ? '–' + sel.hora_fin : ''}`}
                {sel.lugar && ` · ${sel.lugar}`}
              </div>
              {sel.tema && <div style={{ fontSize: 13, marginTop: 6 }}><b>Tema:</b> {sel.tema}</div>}
              {sel.observaciones && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 4 }}>{sel.observaciones}</div>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {editable && (
                <select value={sel.estado} onChange={e => cambiarEstadoSesion(sel, e.target.value)}
                  title="Estado de la sesión" style={{ ...css.select, fontSize: 12 }}>
                  {Object.keys(EST_SESION).map(k => <option key={k} value={k}>{EST_SESION[k].l}</option>)}
                </select>
              )}
              {editable && <Bt v="sec" sm onClick={() => abrirSesion(sel)} title="Editar fecha, hora, lugar o tema">Editar</Bt>}
              {editable && <Bt v="ghost" sm onClick={agendarSiguiente} title="Agenda la próxima según la periodicidad del comité">Agendar la siguiente</Bt>}
              <Bt v="ghost" sm onClick={() => setSelId(null)} title="Cerrar el detalle">Cerrar</Bt>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 14 }}>
            {/* asistentes */}
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>Asistentes</span>
                <Bd c="var(--text-muted)">{asisSel.length} convocados</Bd>
                {sel.pct_asistencia != null && (
                  <Bd c={Number(sel.pct_asistencia) >= 70 ? 'var(--success)' : 'var(--warning)'}>{sel.pct_asistencia}% asistencia</Bd>
                )}
                {editable && (
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 5 }}>
                    <Bt v="sec" sm onClick={() => { setForm({ nombres: [], rol_sesion: 'PARTICIPANTE' }); setSheet('asistente') }}
                      title="Agrega convocados a esta sesión">＋ Convocar</Bt>
                    <Bt v="ghost" sm onClick={copiarConvocatoria} title="Copia los convocados de la sesión anterior de este comité">
                      Copiar anterior
                    </Bt>
                  </span>
                )}
              </div>
              {asisSel.length === 0 && <Vacio ic="👥" txt="Nadie convocado todavía. Usa ＋ Convocar o copia la convocatoria de la sesión anterior." />}
              {asisSel.map(a => (
                <div key={a.id} style={{
                  display: 'flex', gap: 8, alignItems: 'center', padding: '7px 10px', borderRadius: 9,
                  background: 'var(--bg-page)', marginBottom: 6, flexWrap: 'wrap'
                }}>
                  <div style={{ flex: 1, minWidth: 130 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{a.nombre}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {a.cargo || (ROLES_SESION.find(r => r.k === a.rol_sesion) || {}).l}
                      {a.cargo && a.rol_sesion !== 'PARTICIPANTE' && ` · ${(ROLES_SESION.find(r => r.k === a.rol_sesion) || {}).l}`}
                    </div>
                  </div>
                  {editable ? (
                    <>
                      <select value={a.rol_sesion} onChange={e => cambiarRol(a, e.target.value)} title="Rol en la sesión"
                        style={{ ...css.select, fontSize: 11, padding: '3px 6px' }}>
                        {ROLES_SESION.map(r => <option key={r.k} value={r.k}>{r.l}</option>)}
                      </select>
                      <select value={a.estado} onChange={e => marcar(a, e.target.value)} title="Asistencia"
                        style={{ ...css.select, fontSize: 11, padding: '3px 6px', fontWeight: 700, color: EST_ASIST[a.estado]?.c }}>
                        {Object.keys(EST_ASIST).map(k => <option key={k} value={k}>{EST_ASIST[k].l}</option>)}
                      </select>
                      <BtEliminar title={`Quitar a ${a.nombre} de la convocatoria`} onConfirm={() => quitarAsistente(a)} />
                    </>
                  ) : <Bd c={EST_ASIST[a.estado]?.c}>{EST_ASIST[a.estado]?.l}</Bd>}
                </div>
              ))}
            </div>

            {/* acuerdos de la sesión */}
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>Acuerdos de esta sesión</span>
                <Bd c={acuSel.length ? 'var(--accent)' : 'var(--danger)'}>{acuSel.length}</Bd>
              </div>
              {acuSel.length === 0 && (
                <Vacio ic="🤝" txt="Sin acuerdos. Regístralos en la vista Agenda y acuerdos eligiendo esta sesión." />
              )}
              {acuSel.map(a => (
                <div key={a.id} style={{
                  padding: '8px 10px', borderRadius: 9, background: 'var(--bg-page)', marginBottom: 6,
                  borderLeft: `3px solid ${a.estado === 'CERRADO' ? 'var(--success)' : 'var(--warning)'}`
                }}>
                  <div style={{ fontSize: 12.5 }}>{a.acuerdo}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                    {a.proceso_id && (
                      <span onClick={() => onAbrir(a.proceso_id)} style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 700 }}>
                        {a.proceso_id}
                      </span>
                    )}
                    {a.proceso_id && ' · '}
                    {a.responsable || 'sin responsable'}
                    {a.fecha_compromiso && ` · compromiso ${fFecha(a.fecha_compromiso)}`}
                    {' · '}{a.estado.toLowerCase()}
                  </div>
                </div>
              ))}
              {sel.acta_url && (
                <a href={sel.acta_url} target="_blank" rel="noreferrer"
                  style={{ fontSize: 12.5, color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
                  📄 Ver acta de la sesión →
                </a>
              )}
            </div>
          </div>
        </Cd>
      )}

      {/* próximas sesiones */}
      <Cd>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 9 }}>Próximas sesiones</div>
        {loading && <Vacio txt="Cargando calendario…" />}
        {!loading && proximas.length === 0 && (
          <Vacio ic="📅" txt="No hay sesiones agendadas hacia adelante. Agenda la próxima de cada comité para que el calendario sirva de convocatoria." />
        )}
        {proximas.map(s => (
          <div key={s.id} onClick={() => { setSelId(s.id); const [y, m] = s.fecha.split('-'); setVer({ y: +y, m: +m - 1 }) }}
            style={{
              display: 'flex', gap: 10, alignItems: 'center', padding: '9px 11px', borderRadius: 10,
              background: 'var(--bg-page)', marginBottom: 6, cursor: 'pointer',
              borderLeft: `3px solid ${EST_SESION[s.estado]?.c}`
            }}>
            <div style={{ minWidth: 74, fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>{fFecha(s.fecha)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.comite_nombre}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {s.hora_inicio || '—'}{s.lugar ? ' · ' + s.lugar : ''}{s.tema ? ' · ' + s.tema : ''}
              </div>
            </div>
            <Bd c={s.n_convocados ? 'var(--text-muted)' : 'var(--warning)'}>
              {s.n_convocados ? `${s.n_convocados} convocados` : 'sin convocar'}
            </Bd>
          </div>
        ))}
      </Cd>

      {/* ── sheet: sesión ── */}
      <Sheet open={sheet === 'sesion'} onClose={() => setSheet(null)}
        title={form.id ? 'Editar sesión' : 'Agendar sesión de comité'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <Campo l="Comité" obligatorio hint="Qué instancia se reúne.">
            <select style={{ ...css.input, cursor: 'pointer' }} value={form.comite_codigo || ''}
              onChange={e => setForm({ ...form, comite_codigo: e.target.value })}>
              <option value="">Elige el comité</option>
              {cat.comites.map(c => <option key={c.codigo} value={c.codigo}>{c.nombre}{c.periodicidad ? ` · ${c.periodicidad.toLowerCase()}` : ''}</option>)}
            </select>
          </Campo>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 9 }}>
            <Campo l="Fecha" obligatorio>
              <input type="date" style={css.input} value={form.fecha || ''} onChange={e => setForm({ ...form, fecha: e.target.value })} />
            </Campo>
            <Campo l="Hora inicio">
              <input type="time" style={css.input} value={form.hora_inicio || ''} onChange={e => setForm({ ...form, hora_inicio: e.target.value })} />
            </Campo>
            <Campo l="Hora término">
              <input type="time" style={css.input} value={form.hora_fin || ''} onChange={e => setForm({ ...form, hora_fin: e.target.value })} />
            </Campo>
          </div>
          <Campo l="Lugar" hint="Sala, sucursal o enlace de videollamada.">
            <input style={css.input} placeholder="Ej: Sala Los Ángeles / Meet" value={form.lugar || ''}
              onChange={e => setForm({ ...form, lugar: e.target.value })} />
          </Campo>
          <Campo l="Tema de la sesión" hint="El foco: qué se va a decidir o revisar.">
            <input style={css.input} placeholder="Ej: aprobación del SOP de compras (P07)" value={form.tema || ''}
              onChange={e => setForm({ ...form, tema: e.target.value })} />
          </Campo>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 9 }}>
            <Campo l="Estado" hint="Marca realizada cuando ya ocurrió.">
              <select style={{ ...css.input, cursor: 'pointer' }} value={form.estado || 'PLANIFICADA'}
                onChange={e => setForm({ ...form, estado: e.target.value })}>
                {Object.keys(EST_SESION).map(k => <option key={k} value={k}>{EST_SESION[k].l}</option>)}
              </select>
            </Campo>
            <Campo l="Enlace al acta (opcional)">
              <input style={css.input} placeholder="https://…" value={form.acta_url || ''}
                onChange={e => setForm({ ...form, acta_url: e.target.value })} />
            </Campo>
          </div>
          <Campo l="Observaciones" hint="Notas de convocatoria o contexto. No reemplaza los acuerdos.">
            <textarea rows={2} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }}
              value={form.observaciones || ''} onChange={e => setForm({ ...form, observaciones: e.target.value })} />
          </Campo>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
            {form.id
              ? <BtEliminar title="Eliminar la sesión con sus asistentes" onConfirm={() => borrarSesion(form)} />
              : <span />}
            <span style={{ display: 'flex', gap: 8 }}>
              <Bt v="sec" onClick={() => setSheet(null)}>Cancelar</Bt>
              <Bt dis={busy} onClick={guardarSesion}>{busy ? 'Guardando…' : form.id ? 'Guardar cambios' : 'Agendar'}</Bt>
            </span>
          </div>
        </div>
      </Sheet>

      {/* ── sheet: convocar asistentes ── */}
      <Sheet open={sheet === 'asistente'} onClose={() => setSheet(null)} title="Convocar asistentes">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <Campo l="Nombres o cargos" obligatorio
            hint="Escribe y presiona Enter por cada uno. Se sugieren los usuarios del ERP, pero puedes escribir a cualquier persona o cargo, aunque no tenga usuario.">
            <Chips valores={form.nombres || []} onChange={v => setForm({ ...form, nombres: v })}
              sugerencias={[...new Set([...usuarios.map(u => u.nombre), ...matriz.map(p => p.dueno_cargo).filter(Boolean)])].sort()}
              ph="Ej: Juan Pablo Reyes — escribe y Enter"
              vacio="Puedes pegar varios separados por coma." />
          </Campo>
          <Campo l="Rol en la sesión" hint="Se aplica a todos los que agregues ahora; después puedes cambiarlo uno por uno.">
            <select style={{ ...css.input, cursor: 'pointer' }} value={form.rol_sesion || 'PARTICIPANTE'}
              onChange={e => setForm({ ...form, rol_sesion: e.target.value })}>
              {ROLES_SESION.map(r => <option key={r.k} value={r.k}>{r.l}</option>)}
            </select>
          </Campo>
          <Hint>
            {sel?.estado === 'REALIZADA'
              ? 'La sesión ya está marcada como realizada, así que entran como presentes.'
              : 'Entran como convocados; el día de la sesión los marcas presente, ausente o justificado.'}
          </Hint>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Bt v="sec" onClick={() => setSheet(null)}>Cancelar</Bt>
            <Bt dis={busy} onClick={guardarAsistentes}>{busy ? 'Guardando…' : 'Convocar'}</Bt>
          </div>
        </div>
      </Sheet>
    </div>
  )
}
