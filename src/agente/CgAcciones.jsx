import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { DataGrid } from '../finanzas/conciliacion/DataGrid'
import {
  SEM, SITUACION, ESTADO_TAREA, btnP, btnS, panelCaja,
  fmtValor, fmtMeta, fechaLarga, hoyCL, Chip, ChipSit, Etiqueta
} from './cgComun'

/* ═══ Pestaña Acciones ═══
   Las acciones viven en Proyectos (pmo_tareas, origen 'control_gestion'): el responsable las ve
   en Mi semana y en el correo diario. Aquí se ve si cada una movió su indicador. */

const FILTROS = [
  ['abiertas', 'Abiertas'], ['vencidas', 'Vencidas'], ['listas', 'Listas para cerrar'],
  ['cumplidas', 'Cumplidas'], ['todas', 'Todas']
]
const pasaFiltro = (a, f) => {
  if (f === 'abiertas') return a.estado !== 'completada'
  if (f === 'vencidas') return a.situacion === 'vencida'
  if (f === 'listas') return a.situacion === 'lista_para_cerrar'
  if (f === 'cumplidas') return a.estado === 'completada'
  return true
}
const lbl = { fontSize: 11, color: '#6B7280', fontWeight: 600, marginBottom: 3, display: 'block' }
const inp = { width: '100%', padding: '6px 8px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', background: '#fff' }

function PanelAccion({ a, usuarios, isMobile, onCerrar, onCambio, verFicha, abrirApp }) {
  const [fecha, setFecha] = useState(a.fecha_vencimiento || '')
  const [resp, setResp] = useState(a.responsable_id || '')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)
  useEffect(() => { setFecha(a.fecha_vencimiento || ''); setResp(a.responsable_id || ''); setMsg(null) }, [a.tarea_id, a.fecha_vencimiento, a.responsable_id])

  const actualizar = async (cambios, texto, clave) => {
    setBusy(clave); setMsg(null)
    try {
      const { error } = await supabase.from('pmo_tareas').update({ ...cambios, updated_at: new Date().toISOString() }).eq('id', a.tarea_id)
      if (error) throw error
      setMsg({ tipo: 'ok', txt: texto })
      await onCambio?.()
    } catch (e) {
      setMsg({ tipo: 'error', txt: 'No se pudo actualizar: ' + String(e?.message || e) })
    } finally { setBusy('') }
  }

  const abierta = a.estado !== 'completada'
  const contenedor = isMobile
    ? { position: 'fixed', inset: 0, zIndex: 200, background: '#fff', overflowY: 'auto', padding: '12px 14px calc(16px + env(safe-area-inset-bottom))' }
    : { ...panelCaja, padding: 14, position: 'sticky', top: 92, maxHeight: 'calc(100vh - 110px)', overflowY: 'auto' }

  return (
    <aside style={contenedor} aria-label="Acción">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            <ChipSit s={a.situacion} />
            <Etiqueta>{ESTADO_TAREA[a.estado] || a.estado}</Etiqueta>
            <Etiqueta>{a.dimension_nombre}</Etiqueta>
          </div>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: '#1C1C1E', marginTop: 6, lineHeight: 1.3 }}>{a.titulo}</div>
          <div style={{ fontSize: 12, color: '#4B5563', marginTop: 3 }}>
            {a.responsable || 'Sin responsable'}, vence {fechaLarga(a.fecha_vencimiento)}
            {abierta && a.dias_atraso > 0 && <b style={{ color: SEM.rojo.c }}> (atrasada {a.dias_atraso} {a.dias_atraso === 1 ? 'día' : 'días'})</b>}
          </div>
        </div>
        <button onClick={onCerrar} aria-label="Cerrar panel" style={{ ...btnS, padding: '2px 9px', fontSize: 16, lineHeight: '20px' }}>×</button>
      </div>

      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ border: '1px solid #EEF0F3', borderRadius: 6, padding: '8px 10px' }}>
          <span style={lbl}>Indicador al crearla</span>
          <div style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtValor(a.valor_inicial, a.unidad)}</div>
          <div style={{ marginTop: 3 }}><Chip s={a.semaforo_inicial} /></div>
          <div style={{ fontSize: 11, color: '#6B7280', marginTop: 3 }}>{fechaLarga(a.fecha_medicion_inicial)}</div>
        </div>
        <div style={{ border: '1px solid #EEF0F3', borderRadius: 6, padding: '8px 10px' }}>
          <span style={lbl}>Indicador hoy</span>
          <div style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtValor(a.valor_actual, a.unidad)}</div>
          <div style={{ marginTop: 3 }}><Chip s={a.semaforo_actual} /></div>
          <div style={{ fontSize: 11, color: '#6B7280', marginTop: 3 }}>meta {fmtMeta(a.meta_actual, a.sentido, a.unidad) || 'por definir'}</div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#374151', marginTop: 6, lineHeight: 1.45 }}>
        {a.situacion === 'lista_para_cerrar' && 'El indicador ya está en verde: confirma con el responsable y márcala cumplida.'}
        {a.situacion === 'cumplida_sin_efecto' && 'Se marcó cumplida, pero el indicador no mejoró: el problema sigue abierto. Conviene una nueva acción.'}
        {a.situacion === 'cumplida_mejoro' && 'Se marcó cumplida y el indicador mejoró, aunque todavía no está en verde.'}
        {a.situacion === 'cumplida_con_efecto' && 'Cumplida y con efecto: el indicador está en verde.'}
        {a.situacion === 'vencida' && 'Venció sin cumplirse. Pide avance o reprograma con una fecha realista.'}
      </div>

      <div style={{ fontSize: 12.5, color: '#1F2937', marginTop: 10, lineHeight: 1.5 }}>
        <b>Indicador:</b> {a.indicador} {a.indicador_nombre}
      </div>
      {a.descripcion && <div style={{ fontSize: 12, color: '#374151', marginTop: 6, whiteSpace: 'pre-wrap', lineHeight: 1.5, background: '#F8FAFC', border: '1px solid #EEF0F3', borderRadius: 6, padding: '6px 8px' }}>{a.descripcion}</div>}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
        {abierta && a.estado !== 'en_curso' && <button disabled={!!busy} onClick={() => actualizar({ estado: 'en_curso' }, 'Marcada en curso.', 'curso')} style={btnS}>Marcar en curso</button>}
        {abierta && <button disabled={!!busy} onClick={() => actualizar({ estado: 'completada', fecha_completada: hoyCL(), avance_pct: 100 }, 'Marcada cumplida. Su efecto se verifica con la próxima medición.', 'cumplir')} style={btnP}>{busy === 'cumplir' ? 'Guardando…' : 'Marcar cumplida'}</button>}
        {!abierta && <button disabled={!!busy} onClick={() => actualizar({ estado: 'en_curso', fecha_completada: null }, 'Reabierta.', 'reabrir')} style={btnS}>Reabrir</button>}
        <button onClick={() => verFicha(a.indicador)} style={btnS}>Ver indicador</button>
        <button onClick={() => abrirApp('proyectos')} style={btnS}>Abrir en Proyectos</button>
      </div>

      {abierta && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #E5E7EB', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label><span style={lbl}>Reprogramar</span>
            <input type="date" style={inp} value={fecha} min={hoyCL()} onChange={e => setFecha(e.target.value)} /></label>
          <label><span style={lbl}>Reasignar</span>
            <select style={inp} value={resp} onChange={e => setResp(e.target.value)}>
              {usuarios.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select></label>
          <div style={{ gridColumn: '1 / -1' }}>
            <button disabled={!!busy || (fecha === a.fecha_vencimiento && resp === a.responsable_id) || !fecha || !resp}
              onClick={() => actualizar({ fecha_vencimiento: fecha, responsable_id: resp }, 'Cambios guardados.', 'guardar')} style={btnS}>Guardar cambios</button>
          </div>
        </div>
      )}
      {msg && <div role="status" style={{ marginTop: 10, fontSize: 12, padding: '6px 8px', borderRadius: 6, color: msg.tipo === 'ok' ? SEM.verde.c : SEM.rojo.c, background: msg.tipo === 'ok' ? SEM.verde.bg : SEM.rojo.bg }}>{msg.txt}</div>}
    </aside>
  )
}

export function CgAcciones({ datos, isMobile, nav, abrirApp, verFicha }) {
  const { acciones, usuarios, cargando, error, recargar } = datos
  const [filtro, setFiltro] = useState('abiertas')
  const [sel, setSel] = useState(null)

  useEffect(() => {
    if (!nav?.t) return
    if (nav.filtro) setFiltro(nav.filtro)
    setSel(nav.sel || null)
  }, [nav?.t])  // eslint-disable-line react-hooks/exhaustive-deps

  const cuenta = useMemo(() => Object.fromEntries(FILTROS.map(([k]) => [k, acciones.filter(a => pasaFiltro(a, k)).length])), [acciones])
  const filas = useMemo(() => acciones.filter(a => pasaFiltro(a, filtro)), [acciones, filtro])
  const efectivas = acciones.filter(a => a.situacion === 'cumplida_con_efecto' || a.situacion === 'cumplida_mejoro').length
  const cumplidas = acciones.filter(a => a.estado === 'completada').length

  const columnas = useMemo(() => [
    { key: 'titulo', label: 'Acción', width: 300 },
    { key: 'indicador', label: 'Indicador', width: 260, value: r => `${r.indicador} ${r.indicador_nombre}` },
    { key: 'responsable', label: 'Responsable', width: 150, value: r => r.responsable || '' },
    { key: 'fecha_vencimiento', label: 'Vence', width: 92, fecha: true },
    { key: 'situacion', label: 'Situación', width: 140, value: r => (SITUACION[r.situacion] || {}).l || r.situacion, render: r => <ChipSit s={r.situacion} /> },
    { key: 'estado', label: 'Estado en Proyectos', width: 120, value: r => ESTADO_TAREA[r.estado] || r.estado },
    {
      key: 'inicial', label: 'Al crearla', width: 120, align: 'right', value: r => r.valor_inicial == null ? null : Number(r.valor_inicial),
      render: r => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtValor(r.valor_inicial, r.unidad)} <Chip s={r.semaforo_inicial} /></span>
    },
    {
      key: 'actual', label: 'Hoy', width: 120, align: 'right', value: r => r.valor_actual == null ? null : Number(r.valor_actual),
      render: r => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtValor(r.valor_actual, r.unidad)} <Chip s={r.semaforo_actual} /></span>
    },
    { key: 'dimension_nombre', label: 'Dimensión', width: 150 },
    { key: 'created_at', label: 'Creada', width: 92, fecha: true, value: r => String(r.created_at || '').slice(0, 10) },
  ], [])

  if (error) {
    return <div style={{ ...panelCaja, padding: 16, fontSize: 13, color: SEM.rojo.c }}>No se pudieron cargar las acciones: {error}
      <div style={{ marginTop: 10 }}><button onClick={recargar} style={btnS}>Reintentar</button></div></div>
  }
  const selA = sel ? acciones.find(a => a.tarea_id === sel) : null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <div role="tablist" aria-label="Filtro de acciones" style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {FILTROS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={filtro === k} onClick={() => { setFiltro(k); setSel(null) }} style={{
              ...btnS, padding: '4px 10px', fontSize: 12,
              background: filtro === k ? '#1C1C1E' : '#fff', color: filtro === k ? '#fff' : '#1C1C1E', borderColor: filtro === k ? '#1C1C1E' : '#D1D5DB'
            }}>{l} <span style={{ opacity: 0.7, fontWeight: 500 }}>{cuenta[k]}</span></button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#4B5563' }}>
          {cumplidas ? <>Efectividad: <b style={{ color: '#1C1C1E' }}>{efectivas} de {cumplidas}</b> acciones cumplidas movieron su indicador.</> : 'Cuando se cumplan acciones, aquí verás cuántas movieron su indicador.'}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: '#6B7280', marginBottom: 8 }}>
        Cada acción es una tarea de Proyectos: el responsable la ve en Mi semana y recibe el recordatorio diario. Para crear una, usa "Asignar acción" en Hoy o en un indicador.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: (!isMobile && selA) ? 'minmax(0,1fr) 400px' : 'minmax(0,1fr)', gap: 10, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <DataGrid
            columns={columnas}
            rows={filas}
            getRowId={r => r.tarea_id}
            selectedId={sel}
            onRowClick={r => setSel(v => v === r.tarea_id ? null : r.tarea_id)}
            rowStyle={r => r.situacion === 'vencida' ? { background: '#FFF8F7' } : {}}
            title="Acciones de gestión"
            exportName="control_gestion_acciones"
            loading={cargando && !acciones.length}
            emptyText={acciones.length ? 'Ninguna acción en este filtro.' : 'Todavía no hay acciones. Asigna la primera desde una prioridad en Hoy.'}
          />
        </div>
        {selA && <PanelAccion a={selA} usuarios={usuarios} isMobile={isMobile} onCerrar={() => setSel(null)} onCambio={recargar} verFicha={verFicha} abrirApp={abrirApp} />}
      </div>
    </div>
  )
}
