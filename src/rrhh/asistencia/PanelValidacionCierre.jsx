// src/rrhh/asistencia/PanelValidacionCierre.jsx
// ═══════════════════════════════════════════════════════════════════════════
// VALIDACIÓN DE JORNADA AL CIERRE · componente compartido (Logística y Comercial)
// La jefatura, al cerrar su bitácora diaria, autoriza o rechaza lo acumulado de
// su equipo hasta ese día: horas extra, ausencias y días fuera de turno.
// Fuente única: fn_asis_pendientes_equipo (misma definición que Asistencia ›
// Por validar). Las decisiones se escriben en las mismas tablas que la bandeja
// de Asistencia, así que todo el ERP las ve igual (costo, cuadratura, correos).
// Equipo = organigrama (fn_asis_mi_alcance). Las horas propias de la jefatura
// no aparecen: las decide su superior.
// Avisa al padre con onEstado({ puede, pendientes, decididas }) para que el
// cierre se bloquee mientras queden pendientes.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabase'

const C = { navy: '#16213E', ink: '#1C1C1E', slate: '#6E6E73', borde: '#E5E7EB', fondo: '#F7F8FA', rojo: '#B42318', ambar: '#B25E09', verde: '#1E7A44' }
const fF = d => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}-${m}` }
const DIA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const dia = d => DIA[new Date(String(d).slice(0, 10) + 'T12:00:00Z').getUTCDay()]
const fMin = m => m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
const btn = (tono = 'gris') => ({
  padding: '4px 9px', fontSize: 11.5, fontWeight: 700, borderRadius: 6, cursor: 'pointer', minHeight: 26, whiteSpace: 'nowrap',
  border: `1px solid ${tono === 'navy' ? C.navy : tono === 'rojo' ? '#FECDCA' : C.borde}`,
  background: tono === 'navy' ? C.navy : '#fff', color: tono === 'navy' ? '#fff' : tono === 'rojo' ? C.rojo : C.navy,
})
const AUS_OPC = [
  ['falta_injustificada', 'Falta injustificada'], ['permiso_con_goce', 'Permiso con goce'], ['permiso_sin_goce', 'Permiso sin goce'],
  ['licencia_medica', 'Licencia médica'], ['vacaciones', 'Vacaciones'], ['otro', 'Otro (justificada)'],
]

export function PanelValidacionCierre({ cu, fecha, onEstado, compacto = false }) {
  const [puede, setPuede] = useState(null)
  const [items, setItems] = useState([])
  const [cargando, setCarg] = useState(true)
  const [error, setError] = useState(null)
  const [ocupado, setOcupado] = useState(null)       // clave del ítem en proceso
  const [decididas, setDecididas] = useState(0)
  const [ausSel, setAusSel] = useState({})           // clave → clasificación elegida
  const hasta = fecha || new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)

  const cargar = useCallback(async () => {
    setCarg(true); setError(null)
    const [p, l] = await Promise.all([
      supabase.rpc('fn_asis_puede_validar_equipo'),
      supabase.rpc('fn_asis_pendientes_equipo', { p_hasta: hasta }),
    ])
    const ok = p.data === true
    setPuede(ok)
    if (l.error) setError(l.error.message)
    const lista = ok ? (l.data || []) : []
    setItems(lista)
    setCarg(false)
    return { ok, n: lista.length }
  }, [hasta])

  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { if (puede !== null) onEstado?.({ puede, pendientes: items.length, decididas }) }, [puede, items.length, decididas]) // eslint-disable-line react-hooks/exhaustive-deps

  const clave = it => `${it.tipo}|${it.cod_contaline}|${it.fecha}`
  async function ejecutar(it, fn) {
    setOcupado(clave(it)); setError(null)
    const { error } = await fn()
    if (error) setError(error.message.includes('row-level security') || error.message.includes('autoriza')
      ? 'No tienes permiso para decidir sobre este trabajador (las horas de una jefatura las decide su superior).' : error.message)
    else setDecididas(n => n + 1)
    setOcupado(null)
    await cargar()
  }
  const decHHEE = (it, decision) => ejecutar(it, () => supabase.from('asis_hhee_validaciones').insert({
    cod_contaline: it.cod_contaline, fecha: it.fecha, tipo: 'salida', min_extra_snapshot: it.minutos,
    decision, justificacion: `${decision === 'autorizada' ? 'Autorizada' : 'Rechazada'} al cierre de la bitácora diaria`, validado_por: cu?.id,
  }))
  const decAus = (it) => ejecutar(it, () => supabase.from('asis_ausencias').insert({
    cod_contaline: it.cod_contaline, fecha: it.fecha, workshift_name: it.workshift_name || null,
    clasificacion: ausSel[clave(it)] || 'falta_injustificada', justificacion: 'Gestionada al cierre de la bitácora diaria', gestionado_por: cu?.id,
  }))
  const decFT = (it, decision) => ejecutar(it, () => supabase.from('asis_fuera_turno_decisiones').insert({
    cod_contaline: it.cod_contaline, fecha: it.fecha, decision, minutos_autorizados: decision === 'horas_extra' ? (it.minutos || 0) : 0,
    min_trabajados_snapshot: it.minutos ?? null, motivo: 'Decidido al cierre de la bitácora diaria',
    decidido_por: cu?.nombre || null, decidido_por_id: cu?.id ? String(cu.id) : null,
  }))
  async function autorizarTodas() {
    const hh = items.filter(i => i.tipo === 'hhee')
    if (!hh.length || !window.confirm(`¿Autorizar las ${hh.length} jornadas con horas extra pendientes? Se pagan con la liquidación.`)) return
    setOcupado('todas'); setError(null)
    const { error } = await supabase.from('asis_hhee_validaciones').insert(hh.map(it => ({
      cod_contaline: it.cod_contaline, fecha: it.fecha, tipo: 'salida', min_extra_snapshot: it.minutos,
      decision: 'autorizada', justificacion: 'Autorizada al cierre de la bitácora diaria', validado_por: cu?.id,
    })))
    if (error) setError(error.message); else setDecididas(n => n + hh.length)
    setOcupado(null); await cargar()
  }

  if (puede === false) return null           // quien no valida equipos no ve el panel (ni se le bloquea el cierre)
  const hhee = items.filter(i => i.tipo === 'hhee'), aus = items.filter(i => i.tipo === 'ausencia'), ft = items.filter(i => i.tipo === 'fuera_turno')
  const fila = (it, acciones) => (
    <div key={clave(it)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: `1px solid ${C.borde}`, flexWrap: 'wrap', opacity: ocupado === clave(it) ? 0.5 : 1 }}>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.empleado}</div>
        <div style={{ fontSize: 11, color: C.slate }}>{dia(it.fecha)} {fF(it.fecha)} · {it.detalle}{it.minutos != null ? ` · ${fMin(it.minutos)}` : ''}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{acciones}</div>
    </div>
  )
  const titulo = (t, n, extra) => n > 0 && (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: C.navy, textTransform: 'uppercase', letterSpacing: '.04em' }}>{t} · {n}</div>{extra}
    </div>
  )

  return (
    <div style={{ border: `1px solid ${items.length ? '#FEDF89' : C.borde}`, background: items.length ? '#FFFCF5' : C.fondo, borderRadius: 10, padding: compacto ? '10px 12px' : '12px 14px', margin: '12px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.navy }}>Validación de jornada de tu equipo</div>
          <div style={{ fontSize: 11.5, color: C.slate, marginTop: 2, lineHeight: 1.45 }}>
            {cargando ? 'Revisando lo acumulado…'
              : items.length ? `Para cerrar, decide lo acumulado hasta el ${fF(hasta)}: ${items.length} pendiente(s). Solo lo autorizado se paga.`
              : `Al día: sin horas extra, ausencias ni días fuera de turno pendientes hasta el ${fF(hasta)}.`}
          </div>
        </div>
        <button onClick={cargar} disabled={cargando} style={btn()}>{cargando ? '…' : 'Actualizar'}</button>
      </div>
      {error && <div role="alert" style={{ fontSize: 12, color: C.rojo, marginTop: 8 }}>{error}</div>}

      {titulo('Horas extra', hhee.length, hhee.length > 1 && <button onClick={autorizarTodas} disabled={!!ocupado} style={btn('navy')}>Autorizar todas</button>)}
      {hhee.map(it => fila(it, <>
        <button disabled={!!ocupado} onClick={() => decHHEE(it, 'autorizada')} style={btn('navy')}>Autorizar</button>
        <button disabled={!!ocupado} onClick={() => decHHEE(it, 'rechazada')} style={btn('rojo')}>Rechazar</button>
      </>))}

      {titulo('Ausencias sin justificar', aus.length)}
      {aus.map(it => fila(it, <>
        <select value={ausSel[clave(it)] || 'falta_injustificada'} onChange={e => setAusSel(s => ({ ...s, [clave(it)]: e.target.value }))}
          style={{ fontSize: 11.5, border: `1px solid ${C.borde}`, borderRadius: 6, padding: '3px 6px', minHeight: 26 }} aria-label="Tipo de ausencia">
          {AUS_OPC.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button disabled={!!ocupado} onClick={() => decAus(it)} style={btn('navy')}>Guardar</button>
      </>))}

      {titulo('Días fuera de turno', ft.length)}
      {ft.map(it => fila(it, <>
        <button disabled={!!ocupado} onClick={() => decFT(it, 'horas_extra')} style={btn('navy')}>Pagar como horas extra</button>
        <button disabled={!!ocupado} onClick={() => decFT(it, 'era_su_turno')} style={btn()}>Jornada normal</button>
        <button disabled={!!ocupado} onClick={() => decFT(it, 'no_corresponde')} style={btn('rojo')}>No corresponde</button>
      </>))}
    </div>
  )
}
