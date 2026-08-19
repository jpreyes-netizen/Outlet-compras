// src/procesos/PrcComites.jsx — agenda de comités: qué se aprueba, qué se acordó, quién responde
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../supabase'
import { Cd, Bt, Bd, Sheet, Vacio, css, hoy, fFecha, uid, puedeEditar, SEMAFORO } from './prcUI'

const TIPOS = [
  { k: 'PRESENTACION',       l: 'Presentación' },
  { k: 'APROBACION',         l: 'Aprobación de SOP' },
  { k: 'SEGUIMIENTO',        l: 'Seguimiento de avance' },
  { k: 'REVISION_SEMESTRAL', l: 'Revisión semestral' }
]
const ESTADOS = ['ABIERTO', 'EN_CURSO', 'CERRADO', 'ANULADO']
const COLOR_ESTADO = { ABIERTO: 'var(--warning)', EN_CURSO: 'var(--info)', CERRADO: 'var(--success)', ANULADO: 'var(--text-muted)' }

export function PrcComites({ matriz, cat, cu, onAbrir, toast }) {
  const [comite, setComite] = useState(cat.comites[0]?.codigo || '')
  const [agenda, setAgenda] = useState([])
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [sheet, setSheet] = useState(false)
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const editable = puedeEditar(cu)

  const cargar = useCallback(async () => {
    setLoading(true)
    const [a, d] = await Promise.all([
      supabase.from('prc_agenda_comite').select('*').order('fecha_sesion', { ascending: false }),
      supabase.from('prc_documentos').select('id, proceso_id, codigo, tipo, version, estado, es_vigente, proxima_revision')
    ])
    setAgenda(a.data || []); setDocs(d.data || []); setLoading(false)
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const c = cat.comites.find(x => x.codigo === comite)
  const procesos = useMemo(() => matriz.filter(p => p.comite_codigo === comite), [matriz, comite])
  const items = useMemo(() => agenda.filter(a => a.comite_codigo === comite), [agenda, comite])
  const abiertos = items.filter(a => a.estado === 'ABIERTO' || a.estado === 'EN_CURSO')

  // Lo que este comité tiene pendiente de decidir
  const pendientes = useMemo(() => {
    const ids = new Set(procesos.map(p => p.id))
    const porAprobar = docs.filter(d => ids.has(d.proceso_id) && ['BORRADOR', 'POR_OFICIALIZAR'].includes(d.estado))
    const revVencida = docs.filter(d => ids.has(d.proceso_id) && d.es_vigente && d.proxima_revision && d.proxima_revision < hoy())
    return { porAprobar, revVencida }
  }, [docs, procesos])

  const guardar = async () => {
    if (!form.acuerdo?.trim()) return toast('Escribe el acuerdo: un comité sin acuerdos registrados no se realizó.', 'err')
    setBusy(true)
    const { error } = await supabase.from('prc_agenda_comite').insert({
      id: uid(), comite_codigo: comite, proceso_id: form.proceso_id || null,
      fecha_sesion: form.fecha || hoy(), tipo: form.tipo || 'SEGUIMIENTO',
      acuerdo: form.acuerdo.trim(), responsable: form.responsable || cu?.nombre,
      fecha_compromiso: form.compromiso || null, estado: 'ABIERTO', acta_url: form.acta || null
    })
    if (!error && form.proceso_id) {
      await supabase.from('prc_hitos').insert({
        id: uid(), proceso_id: form.proceso_id, fecha: form.fecha || hoy(), tipo: 'COMITE',
        descripcion: `[${comite}] ${form.acuerdo.trim()}`, responsable: form.responsable || cu?.nombre
      })
    }
    setBusy(false)
    if (error) return toast('No se pudo guardar el acuerdo: ' + error.message, 'err')
    setSheet(false); toast('Acuerdo registrado'); cargar()
  }

  const cambiarEstado = async (a, estado) => {
    const { error } = await supabase.from('prc_agenda_comite').update({ estado }).eq('id', a.id)
    if (error) return toast('Error: ' + error.message, 'err')
    cargar()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {cat.comites.map(x => {
          const n = matriz.filter(p => p.comite_codigo === x.codigo).length
          const act = x.codigo === comite
          return (
            <button key={x.codigo} onClick={() => setComite(x.codigo)} style={{
              padding: '8px 13px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${act ? 'var(--accent)' : 'var(--border-2)'}`,
              background: act ? 'var(--accent-bg)' : 'var(--bg-surface)',
              color: act ? 'var(--accent-text)' : 'var(--text-secondary)'
            }}>{x.nombre} <span style={{ fontWeight: 500, opacity: .7 }}>· {n}</span></button>
          )
        })}
      </div>

      {c && (
        <Cd>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 280 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{c.nombre}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3 }}>{c.descripcion}</div>
              <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                <span>Periodicidad: <b style={{ color: 'var(--text-secondary)' }}>{c.periodicidad}</b></span>
                <span>Responsable: <b style={{ color: 'var(--text-secondary)' }}>{c.responsable}</b></span>
                <span>Procesos: <b style={{ color: 'var(--text-secondary)' }}>{procesos.length}</b></span>
                <span>Acuerdos abiertos: <b style={{ color: abiertos.length ? 'var(--warning)' : 'var(--success)' }}>{abiertos.length}</b></span>
              </div>
            </div>
            <Bt dis={!editable} onClick={() => { setForm({ fecha: hoy(), tipo: 'SEGUIMIENTO', responsable: cu?.nombre }); setSheet(true) }}>
              Registrar acuerdo
            </Bt>
          </div>
        </Cd>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 13 }}>
        <Cd>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 9 }}>
            Pendiente de decisión de este comité
          </div>
          {pendientes.porAprobar.length === 0 && pendientes.revVencida.length === 0 &&
            <Vacio txt="Nada pendiente de aprobar" ic="✓" />}
          {pendientes.porAprobar.map(d => (
            <div key={d.id} onClick={() => onAbrir(d.proceso_id)} style={fila}>
              <Bd c={d.estado === 'POR_OFICIALIZAR' ? 'var(--info)' : 'var(--warning)'}>{d.estado === 'POR_OFICIALIZAR' ? 'por oficializar' : 'borrador'}</Bd>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{d.codigo} v{d.version}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {(matriz.find(p => p.id === d.proceso_id) || {}).nombre}
                </div>
              </div>
              <span style={{ fontSize: 11.5, color: 'var(--accent)' }}>Abrir →</span>
            </div>
          ))}
          {pendientes.revVencida.map(d => (
            <div key={'r' + d.id} onClick={() => onAbrir(d.proceso_id)} style={{ ...fila, borderLeft: '3px solid var(--danger)' }}>
              <Bd c="var(--danger)">revisión vencida</Bd>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{d.codigo} v{d.version}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Vencida el {fFecha(d.proxima_revision)}</div>
              </div>
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
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {p.estado_impl_etiqueta} · {p.pct_global}% {p.dias_atraso > 0 ? `· ${p.dias_atraso} d de atraso` : ''}
                  </div>
                </div>
                <Bd c={p.score === 9 ? 'var(--danger)' : 'var(--text-muted)'}>score {p.score}</Bd>
              </div>
            )
          })}
        </Cd>
      </div>

      <Cd style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-1)', fontSize: 13.5, fontWeight: 700 }}>
          Acuerdos y seguimiento
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={css.th}>Sesión</th><th style={css.th}>Tipo</th><th style={css.th}>Proceso</th>
            <th style={css.th}>Acuerdo</th><th style={css.th}>Responsable</th><th style={css.th}>Compromiso</th>
            <th style={css.th}>Estado</th>
          </tr></thead>
          <tbody>{items.map(a => {
            const vencido = a.fecha_compromiso && a.fecha_compromiso < hoy() && a.estado !== 'CERRADO'
            return (
              <tr key={a.id}>
                <td style={{ ...css.td, whiteSpace: 'nowrap' }}>{fFecha(a.fecha_sesion)}</td>
                <td style={css.td}><Bd c="var(--accent)">{(TIPOS.find(t => t.k === a.tipo) || {}).l || a.tipo}</Bd></td>
                <td style={css.td}>
                  {a.proceso_id
                    ? <span onClick={() => onAbrir(a.proceso_id)} style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 600 }}>{a.proceso_id}</span>
                    : '—'}
                </td>
                <td style={css.td}>{a.acuerdo}</td>
                <td style={css.td}>{a.responsable || '—'}</td>
                <td style={{ ...css.td, color: vencido ? 'var(--danger)' : 'inherit', fontWeight: vencido ? 700 : 400 }}>
                  {fFecha(a.fecha_compromiso)}
                </td>
                <td style={css.td}>
                  {editable ? (
                    <select value={a.estado} onChange={e => cambiarEstado(a, e.target.value)}
                      style={{ ...css.select, padding: '3px 5px', fontSize: 11, color: COLOR_ESTADO[a.estado], fontWeight: 700 }}>
                      {ESTADOS.map(x => <option key={x} value={x}>{x}</option>)}
                    </select>
                  ) : <Bd c={COLOR_ESTADO[a.estado]}>{a.estado}</Bd>}
                </td>
              </tr>
            )
          })}</tbody>
        </table>
        {items.length === 0 && !loading && <Vacio txt="Sin acuerdos registrados en este comité" ic="🤝" />}
      </Cd>

      <Sheet open={sheet} onClose={() => setSheet(false)} title={`Registrar acuerdo · ${c?.nombre || ''}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            <Campo l="Fecha de sesión"><input type="date" style={css.input} value={form.fecha || ''} onChange={e => setForm({ ...form, fecha: e.target.value })} /></Campo>
            <Campo l="Tipo">
              <select style={{ ...css.input, cursor: 'pointer' }} value={form.tipo || 'SEGUIMIENTO'} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                {TIPOS.map(t => <option key={t.k} value={t.k}>{t.l}</option>)}
              </select>
            </Campo>
          </div>
          <Campo l="Proceso (opcional)">
            <select style={{ ...css.input, cursor: 'pointer' }} value={form.proceso_id || ''} onChange={e => setForm({ ...form, proceso_id: e.target.value })}>
              <option value="">Sin proceso específico</option>
              {procesos.map(p => <option key={p.id} value={p.id}>{p.id} · {p.nombre}</option>)}
            </select>
          </Campo>
          <Campo l="Acuerdo">
            <textarea rows={3} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }}
              placeholder="Qué se decidió, en una frase accionable." value={form.acuerdo || ''}
              onChange={e => setForm({ ...form, acuerdo: e.target.value })} />
          </Campo>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            <Campo l="Responsable"><input style={css.input} value={form.responsable || ''} onChange={e => setForm({ ...form, responsable: e.target.value })} /></Campo>
            <Campo l="Fecha de compromiso"><input type="date" style={css.input} value={form.compromiso || ''} onChange={e => setForm({ ...form, compromiso: e.target.value })} /></Campo>
          </div>
          <Campo l="Enlace al acta (opcional)"><input style={css.input} value={form.acta || ''} onChange={e => setForm({ ...form, acta: e.target.value })} /></Campo>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Bt v="sec" onClick={() => setSheet(false)}>Cancelar</Bt>
            <Bt dis={busy} onClick={guardar}>Registrar</Bt>
          </div>
        </div>
      </Sheet>
    </div>
  )
}

const fila = {
  display: 'flex', gap: 9, alignItems: 'center', padding: '8px 10px', borderRadius: 9,
  background: 'var(--bg-page)', marginBottom: 6, cursor: 'pointer'
}
const Campo = ({ l, children }) => (
  <div><label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>{l}</label>{children}</div>
)
