// src/procesos/PrcComites.jsx — el comité de gestión (P21) como corazón del módulo:
// calendario → sala de sesión → scorecard → acuerdos y decisiones → comités de trabajo → efectividad,
// más el informe de avance para el Directorio.
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../supabase'
import { Cd, Bt, Bd, Sheet, Vacio, Tabs, Ayuda, Campo, css, hoy, fFecha, uid, puedeEditar, SEMAFORO } from './prcUI'
import { PrcCalendario } from './PrcCalendario'
import { PrcSesion } from './PrcSesion'
import { PrcScorecard } from './PrcScorecard'
import { PrcEncargos } from './PrcEncargos'
import { PrcEfectividad } from './PrcEfectividad'
import { generarInforme } from './prcInforme'
import { TIPOS_ACUERDO, TIPOS_DECISION, sumarDias } from './prcComite'

const ESTADOS = ['ABIERTO', 'EN_CURSO', 'CERRADO', 'ANULADO']
const COLOR_ESTADO = { ABIERTO: 'var(--warning)', EN_CURSO: 'var(--info)', CERRADO: 'var(--success)', ANULADO: 'var(--text-muted)' }
const COLOR_DEC = { APROBADA: 'var(--success)', RECHAZADA: 'var(--danger)', POSTERGADA: 'var(--warning)' }

const VISTAS = [
  { k: 'calendario', l: 'Calendario', ic: '📅' },
  { k: 'sesion', l: 'Sala de sesión', ic: '🏛️' },
  { k: 'scorecard', l: 'Scorecard', ic: '📈' },
  { k: 'agenda', l: 'Acuerdos y decisiones', ic: '🤝' },
  { k: 'encargos', l: 'Comités de trabajo', ic: '🧩' },
  { k: 'efectividad', l: 'Efectividad', ic: '🎯' }
]

export function PrcComites({ matriz, cat, cu, onAbrir, toast }) {
  const [vista, setVista] = useState(() => { try { const v = localStorage.getItem('prc_vista_comite'); return VISTAS.some(x => x.k === v) ? v : 'calendario' } catch { return 'calendario' } })
  const cambiarVista = v => { setVista(v); try { localStorage.setItem('prc_vista_comite', v) } catch {} }
  const [sesionSel, setSesionSel] = useState(() => { try { return localStorage.getItem('prc_sesion_sel') || null } catch { return null } })
  const elegirSesion = id => { setSesionSel(id); try { id ? localStorage.setItem('prc_sesion_sel', id) : localStorage.removeItem('prc_sesion_sel') } catch {} }
  const abrirSala = id => { elegirSesion(id); cambiarVista('sesion') }
  const [generando, setGenerando] = useState(false)

  const informe = async () => {
    setGenerando(true)
    try { await generarInforme({ matriz, cat, cu, toast }) } catch (e) { toast('No se pudo generar el informe: ' + (e?.message || e), 'err') }
    setGenerando(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border-1)' }}>
        <div style={{ flex: 1, minWidth: 0 }}><Tabs sm tabs={VISTAS} val={vista} onChange={cambiarVista} /></div>
        <Bt v="sec" sm dis={generando} onClick={informe} style={{ marginBottom: 6 }}
          title="Genera el informe de avance del programa de procesos y comités (P21 fase 7). Se abre en una pestaña para imprimir o guardar en PDF.">
          📄 {generando ? 'Generando…' : 'Informe de avance'}
        </Bt>
      </div>

      {vista === 'calendario' && <PrcCalendario matriz={matriz} cat={cat} cu={cu} onAbrir={onAbrir} toast={toast} onAbrirSesion={abrirSala} />}
      {vista === 'sesion' && <PrcSesion sesionId={sesionSel} onSeleccionar={elegirSesion} matriz={matriz} cat={cat} cu={cu} onAbrir={onAbrir} toast={toast} onVolverCalendario={() => cambiarVista('calendario')} />}
      {vista === 'scorecard' && <PrcScorecard matriz={matriz} cat={cat} cu={cu} onAbrir={onAbrir} toast={toast} />}
      {vista === 'agenda' && <Agenda matriz={matriz} cat={cat} cu={cu} onAbrir={onAbrir} toast={toast} onAbrirSesion={abrirSala} />}
      {vista === 'encargos' && <PrcEncargos matriz={matriz} cat={cat} cu={cu} onAbrir={onAbrir} toast={toast} />}
      {vista === 'efectividad' && <PrcEfectividad matriz={matriz} cat={cat} cu={cu} toast={toast} />}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Acuerdos y decisiones por comité (seguimiento entre sesiones · P21 fase 5)
   ═══════════════════════════════════════════════════════════════════════════ */
function Agenda({ matriz, cat, cu, onAbrir, toast, onAbrirSesion }) {
  const [comite, setComite] = useState(cat.comites[0]?.codigo || '')
  const [sesiones, setSesiones] = useState([])
  const [agenda, setAgenda] = useState([])
  const [decisiones, setDecisiones] = useState([])
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [sheet, setSheet] = useState(false)
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [fEstado, setFEstado] = useState('abiertos')
  const editable = puedeEditar(cu)

  const cargar = useCallback(async () => {
    setLoading(true)
    const [a, d, s2, dc] = await Promise.all([
      supabase.from('v_prc_acuerdos').select('*').order('fecha_sesion', { ascending: false }),
      supabase.from('prc_documentos').select('id, proceso_id, codigo, tipo, version, estado, es_vigente, proxima_revision'),
      supabase.from('v_prc_sesiones').select('id, comite_codigo, numero, fecha, tema, estado').order('fecha', { ascending: false }),
      supabase.from('prc_decisiones').select('*').order('fecha', { ascending: false })
    ])
    setAgenda(a.data || []); setDocs(d.data || []); setSesiones(s2.data || []); setDecisiones(dc.data || []); setLoading(false)
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const c = cat.comites.find(x => x.codigo === comite)
  const procesos = useMemo(() => matriz.filter(p => p.comite_codigo === comite), [matriz, comite])
  const items = useMemo(() => agenda.filter(a => a.comite_codigo === comite).filter(a => fEstado === 'todos' || (fEstado === 'abiertos' ? ['ABIERTO', 'EN_CURSO'].includes(a.estado) : fEstado === 'vencidos' ? a.vencido : a.estado === fEstado)), [agenda, comite, fEstado])
  const abiertos = agenda.filter(a => a.comite_codigo === comite && ['ABIERTO', 'EN_CURSO'].includes(a.estado))
  const vencidos = abiertos.filter(a => a.vencido)
  const decs = useMemo(() => decisiones.filter(d => d.comite_codigo === comite), [decisiones, comite])
  const pendientes = useMemo(() => {
    const ids = new Set(procesos.map(p => p.id))
    return { porAprobar: docs.filter(d => ids.has(d.proceso_id) && ['BORRADOR', 'POR_OFICIALIZAR'].includes(d.estado)),
      revVencida: docs.filter(d => ids.has(d.proceso_id) && d.es_vigente && d.proxima_revision && d.proxima_revision < hoy()) }
  }, [docs, procesos])
  const sesionesComite = sesiones.filter(s => s.comite_codigo === comite && s.estado !== 'ANULADA')
  const numSesion = id => { const s = sesiones.find(x => x.id === id); return s ? `N° ${s.numero ?? '—'}` : null }

  const guardar = async () => {
    if (!form.acuerdo?.trim()) return toast('Escribe el acuerdo: un comité sin acuerdos registrados no se realizó.', 'err')
    if (!form.responsable?.trim() || !form.compromiso) return toast('Todo acuerdo lleva responsable y fecha de compromiso.', 'err')
    setBusy(true)
    const { error } = await supabase.from('prc_agenda_comite').insert({
      id: uid(), comite_codigo: comite, proceso_id: form.proceso_id || null, sesion_id: form.sesion_id || null,
      fecha_sesion: form.fecha || hoy(), tipo: form.tipo || 'SEGUIMIENTO', acuerdo: form.acuerdo.trim(), responsable: form.responsable.trim(),
      fecha_compromiso: form.compromiso, criterio_cierre: form.criterio_cierre || null, estado: 'ABIERTO'
    })
    if (!error && form.proceso_id) {
      await supabase.from('prc_hitos').insert({ id: uid(), proceso_id: form.proceso_id, fecha: form.fecha || hoy(), tipo: 'COMITE', descripcion: `[${comite}] ${form.acuerdo.trim()}`, responsable: form.responsable.trim() })
    }
    setBusy(false)
    if (error) return toast('No se pudo guardar el acuerdo: ' + error.message, 'err')
    setSheet(false); toast('Acuerdo registrado'); cargar()
  }
  const cambiarEstado = async (a, estado) => {
    const { error } = await supabase.from('prc_agenda_comite').update({ estado, cerrado_por: estado === 'CERRADO' ? cu?.nombre : null }).eq('id', a.id)
    if (error) return toast('Error: ' + error.message, 'err')
    cargar()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      <Ayuda k="comites" titulo="Para qué sirve esta vista">
        Es el <b>seguimiento entre sesiones</b> (P21 fase 5): cada comité tiene procesos asignados, acuerdos con responsable, plazo y
        criterio de cierre, y decisiones registradas. Los responsables actualizan acá el estado de sus acuerdos; los vencidos se marcan en
        rojo y se escalan desde la sala de sesión. <b>Pendiente de decisión</b> muestra los SOP que esperan aprobación y las revisiones
        vencidas. Los acuerdos de una reunión se registran mejor desde la <b>Sala de sesión</b>, para que queden en el acta.
      </Ayuda>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {cat.comites.map(x => {
          const n = matriz.filter(p => p.comite_codigo === x.codigo).length
          const v = agenda.filter(a => a.comite_codigo === x.codigo && a.vencido).length
          const act = x.codigo === comite
          return (
            <button key={x.codigo} onClick={() => setComite(x.codigo)} style={{
              padding: '8px 13px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${act ? 'var(--accent)' : 'var(--border-2)'}`, background: act ? 'var(--accent-bg)' : 'var(--bg-surface)', color: act ? 'var(--accent-text)' : 'var(--text-secondary)'
            }}>{x.nombre} <span style={{ fontWeight: 500, opacity: .7 }}>· {n}</span>{v > 0 && <span style={{ marginLeft: 6, color: 'var(--danger)' }}>● {v}</span>}</button>
          )
        })}
      </div>

      {c && (
        <Cd>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 280 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{c.nombre}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3 }}>{c.proposito || c.descripcion}</div>
              <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                <span>Periodicidad: <b style={{ color: 'var(--text-secondary)' }}>{c.periodicidad}</b></span>
                <span>Preside: <b style={{ color: 'var(--text-secondary)' }}>{c.responsable}</b></span>
                {c.secretario && <span>Secretaría: <b style={{ color: 'var(--text-secondary)' }}>{c.secretario}</b></span>}
                <span>Quórum: <b style={{ color: 'var(--text-secondary)' }}>{Math.round((c.quorum_min ?? 0.75) * 100)}% · mín. {c.integrantes_min ?? 3}</b></span>
                {c.reporta_a && <span>Reporta a: <b style={{ color: 'var(--text-secondary)' }}>{c.reporta_a}</b></span>}
                <span>Procesos: <b style={{ color: 'var(--text-secondary)' }}>{procesos.length}</b></span>
                <span>Acuerdos abiertos: <b style={{ color: abiertos.length ? 'var(--warning)' : 'var(--success)' }}>{abiertos.length}</b>{vencidos.length > 0 && <b style={{ color: 'var(--danger)' }}> · {vencidos.length} vencidos</b>}</span>
              </div>
              {c.limites && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 5 }}><b>Límites:</b> {c.limites}</div>}
            </div>
            <Bt dis={!editable} title="Registra un acuerdo fuera de sesión (entre sesiones). Los de la reunión van por la sala de sesión."
              onClick={() => { setForm({ fecha: hoy(), tipo: 'SEGUIMIENTO', responsable: '', compromiso: sumarDias(hoy(), 14) }); setSheet(true) }}>Registrar acuerdo</Bt>
          </div>
        </Cd>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 13 }}>
        <Cd>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 9 }}>Pendiente de decisión de este comité</div>
          {pendientes.porAprobar.length === 0 && pendientes.revVencida.length === 0 && <Vacio txt="Nada pendiente de aprobar" ic="✓" />}
          {pendientes.porAprobar.map(d => (
            <div key={d.id} onClick={() => onAbrir(d.proceso_id)} style={fila}>
              <Bd c={d.estado === 'POR_OFICIALIZAR' ? 'var(--info)' : 'var(--warning)'}>{d.estado === 'POR_OFICIALIZAR' ? 'por oficializar' : 'borrador'}</Bd>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600 }}>{d.codigo} v{d.version}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{(matriz.find(p => p.id === d.proceso_id) || {}).nombre}</div></div>
              <span style={{ fontSize: 11.5, color: 'var(--accent)' }}>Abrir →</span>
            </div>
          ))}
          {pendientes.revVencida.map(d => (
            <div key={'r' + d.id} onClick={() => onAbrir(d.proceso_id)} style={{ ...fila, borderLeft: '3px solid var(--danger)' }}>
              <Bd c="var(--danger)">revisión vencida</Bd>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600 }}>{d.codigo} v{d.version}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Vencida el {fFecha(d.proxima_revision)}</div></div>
            </div>
          ))}
        </Cd>
        <Cd>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 9 }}>Procesos bajo este comité</div>
          {procesos.length === 0 && <Vacio txt="Sin procesos asignados" />}
          {procesos.map(p => {
            const s = SEMAFORO[p.semaforo] || SEMAFORO.gris
            return (
              <div key={p.id} onClick={() => onAbrir(p.id)} style={{ ...fila, borderLeft: `3px solid ${s.c}` }}>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: 12, color: 'var(--accent)' }}>{p.id}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nombre}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.estado_impl_etiqueta} · {p.pct_global}% {p.dias_atraso > 0 ? `· ${p.dias_atraso} d de atraso` : ''}</div>
                </div>
                <Bd c={p.score === 9 ? 'var(--danger)' : 'var(--text-muted)'}>score {p.score}</Bd>
              </div>
            )
          })}
        </Cd>
      </div>

      <Cd style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-1)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>Acuerdos y seguimiento</span>
          <select value={fEstado} onChange={e => setFEstado(e.target.value)} style={{ ...css.select, fontSize: 12, padding: '4px 8px' }}>
            <option value="abiertos">Abiertos y en curso</option><option value="vencidos">Vencidos</option><option value="CERRADO">Cerrados</option><option value="todos">Todos</option>
          </select>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{items.length} acuerdo(s)</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={css.th}>Sesión</th><th style={css.th}>Tipo</th><th style={css.th}>Proceso</th><th style={css.th}>Acuerdo</th>
              <th style={css.th}>Responsable</th><th style={css.th}>Compromiso</th><th style={css.th}>Cierre</th><th style={css.th}>Estado</th>
            </tr></thead>
            <tbody>{items.map(a => (
              <tr key={a.id}>
                <td style={{ ...css.td, whiteSpace: 'nowrap' }}>{a.sesion_id ? <span onClick={() => onAbrirSesion(a.sesion_id)} style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 700 }}>{numSesion(a.sesion_id) || fFecha(a.fecha_sesion)}</span> : fFecha(a.fecha_sesion)}<div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{fFecha(a.fecha_sesion)}</div></td>
                <td style={css.td}><Bd c={a.tipo === 'CONTRAMEDIDA' ? 'var(--warning)' : 'var(--accent)'}>{(TIPOS_ACUERDO.find(t => t.k === a.tipo) || {}).l || a.tipo}</Bd>{a.kpi_indicador && <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{a.kpi_indicador}</div>}</td>
                <td style={css.td}>{a.proceso_id ? <span onClick={() => onAbrir(a.proceso_id)} style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 600 }}>{a.proceso_id}</span> : '—'}</td>
                <td style={css.td}>{a.acuerdo}{a.criterio_cierre && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Cierre: {a.criterio_cierre}</div>}{a.escalado_a && <Bd c="var(--warning)">escalado a {a.escalado_a}</Bd>}</td>
                <td style={css.td}>{a.responsable || '—'}</td>
                <td style={{ ...css.td, color: a.vencido ? 'var(--danger)' : 'inherit', fontWeight: a.vencido ? 700 : 400, whiteSpace: 'nowrap' }}>{fFecha(a.fecha_compromiso)}{a.vencido ? ` (+${a.dias_atraso} d)` : ''}</td>
                <td style={{ ...css.td, whiteSpace: 'nowrap' }}>{a.fecha_cierre ? <>{fFecha(a.fecha_cierre)} {a.cerrado_a_tiempo === true ? <Bd c="var(--success)">a tiempo</Bd> : a.cerrado_a_tiempo === false ? <Bd c="var(--warning)">tarde</Bd> : null}</> : '—'}</td>
                <td style={css.td}>{editable ? (
                  <select value={a.estado} onChange={e => cambiarEstado(a, e.target.value)} style={{ ...css.select, padding: '3px 5px', fontSize: 11, color: COLOR_ESTADO[a.estado], fontWeight: 700 }}>{ESTADOS.map(x => <option key={x} value={x}>{x}</option>)}</select>
                ) : <Bd c={COLOR_ESTADO[a.estado]}>{a.estado}</Bd>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {items.length === 0 && !loading && <Vacio txt="Sin acuerdos con ese filtro" ic="🤝" />}
      </Cd>

      <Cd style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-1)', fontSize: 13.5, fontWeight: 700 }}>Registro de decisiones <Bd c="var(--text-muted)">{decs.length}</Bd></div>
        {decs.length === 0 && <Vacio ic="⚖️" txt="Sin decisiones registradas. Se registran en la sala de sesión (aprobaciones, asignaciones, cambios de meta, escalamientos)." />}
        {decs.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={css.th}>Fecha</th><th style={css.th}>Sesión</th><th style={css.th}>Tipo</th><th style={css.th}>Decisión</th><th style={css.th}>Proceso</th><th style={css.th}>Votación</th><th style={css.th}>Resultado</th></tr></thead>
            <tbody>{decs.slice(0, 60).map(d => (
              <tr key={d.id}>
                <td style={{ ...css.td, whiteSpace: 'nowrap' }}>{fFecha(d.fecha)}</td>
                <td style={css.td}>{d.sesion_id ? <span onClick={() => onAbrirSesion(d.sesion_id)} style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 700 }}>{numSesion(d.sesion_id) || 'ver'}</span> : '—'}</td>
                <td style={css.td}><Bd c="var(--accent)">{(TIPOS_DECISION.find(t => t.k === d.tipo) || {}).l || d.tipo}</Bd></td>
                <td style={css.td}>{d.decision}{d.fundamento && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.fundamento}</div>}</td>
                <td style={css.td}>{d.proceso_id ? <span onClick={() => onAbrir(d.proceso_id)} style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 600 }}>{d.proceso_id}</span> : '—'}</td>
                <td style={{ ...css.td, whiteSpace: 'nowrap' }}>{d.unanime ? 'unánime' : `${d.votos_favor ?? 0}–${d.votos_contra ?? 0}–${d.abstenciones ?? 0}`}</td>
                <td style={css.td}><Bd c={COLOR_DEC[d.resultado]}>{d.resultado}</Bd></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Cd>

      <Sheet open={sheet} onClose={() => setSheet(false)} title={`Registrar acuerdo · ${c?.nombre || ''}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            <Campo l="Fecha"><input type="date" style={css.input} value={form.fecha || ''} onChange={e => setForm({ ...form, fecha: e.target.value })} /></Campo>
            <Campo l="Tipo"><select style={{ ...css.input, cursor: 'pointer' }} value={form.tipo || 'SEGUIMIENTO'} onChange={e => setForm({ ...form, tipo: e.target.value })}>{TIPOS_ACUERDO.map(t => <option key={t.k} value={t.k}>{t.l}</option>)}</select></Campo>
          </div>
          <Campo l="Sesión del calendario (opcional)" hint="Si eliges una sesión, el acuerdo aparece en su acta y toma su fecha.">
            <select style={{ ...css.input, cursor: 'pointer' }} value={form.sesion_id || ''} onChange={e => { const sx = sesionesComite.find(x => x.id === e.target.value); setForm({ ...form, sesion_id: e.target.value, fecha: sx ? sx.fecha : form.fecha }) }}>
              <option value="">Sin sesión asociada</option>
              {sesionesComite.map(sx => <option key={sx.id} value={sx.id}>N° {sx.numero ?? '—'} · {fFecha(sx.fecha)}{sx.tema ? ' · ' + sx.tema : ''}</option>)}
            </select>
          </Campo>
          <Campo l="Proceso (opcional)"><select style={{ ...css.input, cursor: 'pointer' }} value={form.proceso_id || ''} onChange={e => setForm({ ...form, proceso_id: e.target.value })}>
            <option value="">Sin proceso específico</option>{procesos.map(p => <option key={p.id} value={p.id}>{p.id} · {p.nombre}</option>)}</select></Campo>
          <Campo l="Acuerdo" obligatorio><textarea rows={3} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }} placeholder="Qué se hará, en una frase accionable." value={form.acuerdo || ''} onChange={e => setForm({ ...form, acuerdo: e.target.value })} /></Campo>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            <Campo l="Responsable" obligatorio><input style={css.input} value={form.responsable || ''} onChange={e => setForm({ ...form, responsable: e.target.value })} /></Campo>
            <Campo l="Fecha de compromiso" obligatorio><input type="date" style={css.input} value={form.compromiso || ''} onChange={e => setForm({ ...form, compromiso: e.target.value })} /></Campo>
          </div>
          <Campo l="Criterio de cierre verificable" hint="Cómo se comprueba que se cumplió."><input style={css.input} value={form.criterio_cierre || ''} onChange={e => setForm({ ...form, criterio_cierre: e.target.value })} /></Campo>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><Bt v="sec" onClick={() => setSheet(false)}>Cancelar</Bt><Bt dis={busy} onClick={guardar}>Registrar</Bt></div>
        </div>
      </Sheet>
    </div>
  )
}

const fila = { display: 'flex', gap: 9, alignItems: 'center', padding: '8px 10px', borderRadius: 9, background: 'var(--bg-page)', marginBottom: 6, cursor: 'pointer' }
