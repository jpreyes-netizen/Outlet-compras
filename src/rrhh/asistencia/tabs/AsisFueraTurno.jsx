// src/rrhh/asistencia/tabs/AsisFueraTurno.jsx
// ═══════════════════════════════════════════════════════════════════════════
// TRABAJO FUERA DE TURNO · huellas en días sin turno asignado en Workera
// Fuente: v_asis_fuera_turno (la BD ya filtra por el equipo de cada jefatura).
//   · Día adicional      : tenía turno otros días de esa semana → decidir si se paga
//   · Turno no cargado   : no tiene horario esa semana → cargarlo en Workera
//   · Marca incompleta   : una sola huella → no se puede medir
// Decisión → asis_fuera_turno_decisiones. Lo autorizado como horas extra entra
// solo a Costo, remuneración mensual y cuadratura (v_asis_costo_hhee).
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabase'
import { DataGrid } from '../../../finanzas/conciliacion/DataGrid'

const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', BORDE = '#E5E7EB', TINTE = '#EEF1F7'
const ROJO = '#B42318', AMBAR = '#B25E09', VERDE = '#1E7A44', GRIS = '#475467'
const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const fF = d => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}-${m}-${y}` }
const fHora = ts => ts ? new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts)) : '—'
const fMin = m => m == null ? '—' : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
const isoDow = d => { const x = new Date(String(d).slice(0, 10) + 'T12:00:00Z').getUTCDay(); return x === 0 ? 7 : x }
const desdeDef = () => { const d = new Date(); d.setDate(d.getDate() - 60); return d.toISOString().slice(0, 10) }

const CLASIF = {
  dia_adicional:    { l: 'Día adicional', c: AMBAR, bg: '#FEF0C7', ayuda: 'Tenía turno otros días de esa semana y además marcó este día. Decide si se paga como horas extra.' },
  turno_no_cargado: { l: 'Turno no cargado', c: ROJO, bg: '#FEE4E2', ayuda: 'No tiene horario cargado en Workera esa semana: no se controlan atrasos, ausencias ni horas extra. Carga su turno en Workera; si era su día normal, marca "Era su turno".' },
  marca_incompleta: { l: 'Marca incompleta', c: GRIS, bg: '#F2F4F7', ayuda: 'Hay una sola huella: no se puede medir cuánto trabajó. Revisa con el trabajador.' },
}
const DECISION = {
  pendiente:      { l: 'Pendiente', c: AMBAR },
  horas_extra:    { l: 'Se paga como horas extra', c: VERDE },
  era_su_turno:   { l: 'Era su turno (día normal)', c: GRIS },
  no_corresponde: { l: 'No corresponde pagar', c: GRIS },
}
const btn = { padding: '6px 12px', fontSize: 12.5, fontWeight: 600, borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', color: NAVY, cursor: 'pointer', minHeight: 30 }
const btnPri = { ...btn, background: NAVY, color: '#fff', border: `1px solid ${NAVY}` }
const btnMini = { ...btn, padding: '3px 9px', fontSize: 12, minHeight: 26 }
const inp = { border: `1px solid ${BORDE}`, borderRadius: 6, padding: '6px 8px', fontSize: 13, fontFamily: 'inherit', minHeight: 30 }
const Pill = ({ v }) => v ? <span title={v.ayuda || ''} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: v.bg || 'transparent', color: v.c, whiteSpace: 'nowrap' }}>{v.l}</span> : null

export function AsisFueraTurno({ cu, onCambio }) {
  const [filas, setFilas] = useState([])
  const [cargando, setCarg] = useState(true)
  const [error, setError] = useState(null)
  const [desde, setDesde] = useState(desdeDef())
  const [estado, setEstado] = useState('pendiente')     // pendiente | decididos | todos
  const [clasif, setClasif] = useState(null)
  const [modal, setModal] = useState(null)              // { fila, decision, horas, minutos, motivo }
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    setCarg(true); setError(null)
    const { data, error } = await supabase.from('v_asis_fuera_turno')
      .select('cod_contaline,empleado,sucursal_nombre,fecha,entrada_real,salida_real,n_marcas_dia,min_trabajados,es_feriado,feriado_nombre,clasificacion,estado,minutos_autorizados,motivo,decidido_por,decidido_at,decision_id')
      .gte('fecha', desde).order('fecha', { ascending: false }).limit(5000)
    if (error) setError(error.message); else setFilas(data || [])
    setCarg(false)
  }, [desde])
  useEffect(() => { cargar() }, [cargar])

  const base = useMemo(() => filas.filter(r => estado === 'todos' ? true : estado === 'pendiente' ? r.estado === 'pendiente' : r.estado !== 'pendiente'), [filas, estado])
  const visibles = useMemo(() => clasif ? base.filter(r => r.clasificacion === clasif) : base, [base, clasif])
  const cuenta = c => base.filter(r => r.clasificacion === c).length
  const pendientes = filas.filter(r => r.estado === 'pendiente' && r.clasificacion !== 'marca_incompleta').length

  function abrir(fila, decision) {
    const m = fila.min_trabajados || 0
    setModal({ fila, decision, horas: Math.floor(m / 60), minutos: m % 60, motivo: '' })
  }
  async function guardar() {
    const { fila, decision, horas, minutos, motivo } = modal
    const min = decision === 'horas_extra' ? (Number(horas) || 0) * 60 + (Number(minutos) || 0) : 0
    if (decision === 'horas_extra' && min <= 0) return setError('Indica cuánto tiempo se paga.')
    if (decision === 'no_corresponde' && motivo.trim().length < 5) return setError('Indica el motivo (mínimo 5 caracteres).')
    setGuardando(true); setError(null)
    const { error } = await supabase.from('asis_fuera_turno_decisiones').insert({
      cod_contaline: fila.cod_contaline, fecha: fila.fecha, decision, minutos_autorizados: min,
      min_trabajados_snapshot: fila.min_trabajados ?? null, motivo: motivo.trim() || null,
      decidido_por: cu?.nombre || null, decidido_por_id: cu?.id ? String(cu.id) : null,
    })
    setGuardando(false)
    if (error) return setError(error.message.includes('row-level security') ? 'No tienes permiso para decidir sobre este trabajador (las horas de una jefatura las decide su superior).' : error.message)
    setModal(null); await cargar(); onCambio?.()
  }
  async function deshacer(fila) {
    if (!window.confirm('¿Deshacer esta decisión? El día vuelve a quedar pendiente.')) return
    const { error } = await supabase.from('asis_fuera_turno_decisiones')
      .update({ activo: false, anulado_por: cu?.nombre || null, anulado_at: new Date().toISOString() }).eq('id', fila.decision_id)
    if (error) return setError(error.message)
    await cargar(); onCambio?.()
  }

  const columnas = useMemo(() => [
    { key: 'fecha', label: 'Fecha', width: 92, render: r => fF(r.fecha) },
    { key: 'dia', label: 'Día', width: 92, value: r => DIAS[isoDow(r.fecha)], render: r => <span>{DIAS[isoDow(r.fecha)]}{r.es_feriado ? <span title={r.feriado_nombre || 'Feriado'} style={{ marginLeft: 4, color: ROJO, fontWeight: 700 }}>· feriado</span> : ''}</span> },
    { key: 'empleado', label: 'Trabajador', width: 240 },
    { key: 'sucursal_nombre', label: 'Sucursal', width: 110 },
    { key: 'entrada_real', label: 'Entrada', width: 70, render: r => fHora(r.entrada_real) },
    { key: 'salida_real', label: 'Salida', width: 70, render: r => fHora(r.salida_real) },
    { key: 'min_trabajados', label: 'Tiempo trabajado', width: 120, align: 'right', render: r => <span>{fMin(r.min_trabajados)}{r.min_trabajados > 120 && r.clasificacion === 'dia_adicional' ? <span title="Más de 2 horas extra en un día excede el máximo legal (Art. 31 CT). Revísalo con Gestión de Personas." style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: ROJO }}>ART. 31</span> : ''}</span> },
    { key: 'clasificacion', label: 'Qué pasó', width: 140, value: r => CLASIF[r.clasificacion]?.l || '', render: r => <Pill v={CLASIF[r.clasificacion]} /> },
    { key: 'estado', label: 'Decisión', width: 200, value: r => DECISION[r.estado]?.l || r.estado, render: r => <span style={{ color: DECISION[r.estado]?.c, fontWeight: 600 }}>{DECISION[r.estado]?.l}{r.estado === 'horas_extra' ? ` · ${fMin(r.minutos_autorizados)}` : ''}</span> },
    { key: 'decidido_por', label: 'Decidido por', width: 150, render: r => r.decidido_por ? <span title={r.motivo || ''}>{r.decidido_por}</span> : '' },
    { key: 'acc', label: 'Acciones', width: 330, sortable: false, filterable: false, value: () => '', exportValue: () => '',
      render: r => r.estado === 'pendiente'
        ? (r.clasificacion === 'marca_incompleta'
            ? <span style={{ display: 'inline-flex', gap: 6 }}><button style={btnMini} onClick={() => abrir(r, 'no_corresponde')}>No corresponde</button><button style={btnMini} onClick={() => abrir(r, 'horas_extra')}>Pagar indicando el tiempo</button></span>
            : <span style={{ display: 'inline-flex', gap: 6 }}>
                <button style={{ ...btnMini, background: NAVY, color: '#fff', borderColor: NAVY }} onClick={() => abrir(r, 'horas_extra')}>Pagar como horas extra</button>
                <button style={btnMini} onClick={() => abrir(r, 'era_su_turno')}>Era su turno</button>
                <button style={btnMini} onClick={() => abrir(r, 'no_corresponde')}>No corresponde</button>
              </span>)
        : <button style={btnMini} onClick={() => deshacer(r)}>Deshacer</button> },
  ], []) // eslint-disable-line react-hooks/exhaustive-deps

  const Chip = ({ k, n }) => {
    const v = CLASIF[k]; const act = clasif === k
    return <button onClick={() => setClasif(act ? null : k)} title={v.ayuda}
      style={{ textAlign: 'left', background: act ? TINTE : '#fff', border: `1px solid ${act ? NAVY : BORDE}`, borderRadius: 8, padding: '10px 14px', cursor: 'pointer', minWidth: 160, minHeight: 0 }}>
      <div style={{ fontSize: 12, color: SLATE }}>{v.l}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: v.c, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{n}</div>
    </button>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: 0 }}>Trabajo fuera de turno</h1>
          <div style={{ fontSize: 12.5, color: SLATE, marginTop: 3, maxWidth: 820, lineHeight: 1.5 }}>
            Días en que el reloj registró la huella pero el trabajador no tenía turno asignado en Workera (por ejemplo, un sábado en el CD). Sin decisión, esas horas no se pagan ni aparecen en el control. {pendientes > 0 && <b style={{ color: AMBAR }}>{pendientes} día(s) esperan tu decisión.</b>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: SLATE }}>Desde <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={inp} /></label>
          <div style={{ display: 'flex', gap: 2, background: '#F2F4F7', borderRadius: 8, padding: 3 }}>
            {[['pendiente', 'Por decidir'], ['decididos', 'Decididos'], ['todos', 'Todos']].map(([k, l]) => (
              <button key={k} onClick={() => setEstado(k)} style={{ border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', minHeight: 28, background: estado === k ? '#fff' : 'transparent', color: estado === k ? NAVY : SLATE, boxShadow: estado === k ? '0 1px 2px rgba(0,0,0,0.08)' : 'none' }}>{l}</button>))}
          </div>
          <button style={btn} onClick={cargar} disabled={cargando}>{cargando ? 'Cargando…' : 'Actualizar'}</button>
        </div>
      </div>
      {error && <div role="alert" style={{ padding: '9px 14px', borderRadius: 8, fontSize: 13, background: '#FEF3F2', border: '1px solid #FECDCA', color: ROJO }}>{error}</div>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Chip k="dia_adicional" n={cuenta('dia_adicional')} />
        <Chip k="turno_no_cargado" n={cuenta('turno_no_cargado')} />
        <Chip k="marca_incompleta" n={cuenta('marca_incompleta')} />
      </div>
      <DataGrid title={clasif ? CLASIF[clasif].l : 'Días con huella y sin turno'} exportName="fuera_de_turno"
        columns={columnas} rows={visibles} getRowId={r => `${r.cod_contaline}-${r.fecha}`} loading={cargando}
        emptyText={estado === 'pendiente' ? 'No hay días fuera de turno por decidir.' : 'Sin registros para este filtro.'}
        toolbar={clasif && <button style={btnMini} onClick={() => setClasif(null)}>Quitar filtro</button>} />
      <div style={{ fontSize: 11.5, color: SLATE, lineHeight: 1.6 }}>
        <b>Pagar como horas extra</b>: el tiempo autorizado entra al costo y a la cuadratura con la liquidación. <b>Era su turno</b>: fue un día normal de trabajo (carga su turno en Workera para que no vuelva a pasar). <b>No corresponde</b>: no se paga, con motivo. Las horas de una jefatura las decide su superior.
      </div>

      {modal && (
        <div role="dialog" aria-modal="true" aria-label="Decidir día fuera de turno" onMouseDown={() => !guardando && setModal(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,24,48,0.35)', zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onMouseDown={e => e.stopPropagation()} style={{ width: 'min(500px, 100%)', background: '#fff', borderRadius: 12, boxShadow: '0 24px 60px rgba(15,24,48,0.3)', padding: 18 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: NAVY }}>{DECISION[modal.decision].l}</div>
            <div style={{ fontSize: 12.5, color: SLATE, marginTop: 3 }}>{modal.fila.empleado} · {DIAS[isoDow(modal.fila.fecha)]} {fF(modal.fila.fecha)} · entrada {fHora(modal.fila.entrada_real)}, salida {fHora(modal.fila.salida_real)} · trabajó {fMin(modal.fila.min_trabajados)}</div>
            {modal.decision === 'horas_extra' && <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11.5, color: SLATE, marginBottom: 4 }}>Tiempo que se paga como horas extra (propuesto: todo lo trabajado)</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input value={modal.horas} onChange={e => setModal(m => ({ ...m, horas: e.target.value.replace(/\D/g, '') }))} inputMode="numeric" style={{ ...inp, width: 70 }} aria-label="Horas" /> h
                <input value={modal.minutos} onChange={e => setModal(m => ({ ...m, minutos: e.target.value.replace(/\D/g, '').slice(0, 2) }))} inputMode="numeric" style={{ ...inp, width: 70 }} aria-label="Minutos" /> min
              </div>
              {((Number(modal.horas) || 0) * 60 + (Number(modal.minutos) || 0)) > 120 && <div style={{ fontSize: 12, color: ROJO, marginTop: 8, lineHeight: 1.45 }}>Más de 2 horas extra en un día supera el máximo legal (Art. 31 CT). Se registra igual para que se pague lo trabajado, y queda marcado para que Gestión de Personas lo revise.</div>}
            </div>}
            {modal.decision === 'era_su_turno' && <div style={{ fontSize: 12.5, color: INK, marginTop: 12, lineHeight: 1.5 }}>Se considera un día normal de trabajo: no se paga como horas extra. Recuerda cargar su turno en Workera para que el día quede bajo control de atrasos y horas extra.</div>}
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11.5, color: SLATE, marginBottom: 4 }}>Motivo {modal.decision === 'no_corresponde' ? '(obligatorio)' : '(opcional)'}</div>
              <textarea value={modal.motivo} onChange={e => setModal(m => ({ ...m, motivo: e.target.value }))} rows={2} style={{ ...inp, width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
                placeholder={modal.decision === 'horas_extra' ? 'Ej.: inventario del sábado, autorizado por jefatura' : modal.decision === 'no_corresponde' ? 'Ej.: vino a retirar sus cosas, no trabajó' : 'Ej.: turno rotativo no cargado en Workera'} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button style={btn} onClick={() => setModal(null)} disabled={guardando}>Cancelar</button>
              <button style={btnPri} onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Confirmar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
