// src/rrhh/integridad/RrhhIntegridad.jsx
// ═══════════════════════════════════════════════════════════════════════════
// CENTRO DE INTEGRIDAD DE PERSONAS (Fase 1)
// Fuente única: v_rrhh_integridad (SQL). Una fila = una inconsistencia entre
// extensiones: maestro de empleados, Contaline, Workera, organigrama, accesos
// y desempeño. Esta pantalla no calcula nada: muestra la vista, lleva a la
// pantalla donde se corrige y registra excepciones aceptadas con motivo.
// Acceso: fn_rrhh_es_gestor() en la BD (Gestión de Personas / dirección).
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../supabase'
import { DataGrid } from '../../finanzas/conciliacion/DataGrid'

const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', BORDE = '#E5E7EB', TINTE = '#EEF1F7'
const SEV = {
  alta:  { l: 'Alta',  c: '#B42318', bg: '#FEE4E2' },
  media: { l: 'Media', c: '#B25E09', bg: '#FEF0C7' },
  baja:  { l: 'Baja',  c: '#475467', bg: '#F2F4F7' },
}
// Qué cruce revela cada chequeo (agrupa el resumen por origen del problema)
const ORIGEN = {
  maestro_sin_rut: 'Maestro', maestro_sin_ingreso: 'Maestro', maestro_inactivo_sin_egreso: 'Maestro',
  activo_sin_liquidacion: 'Maestro ↔ Contaline', liquidacion_sin_maestro: 'Maestro ↔ Contaline', liquidacion_tras_egreso: 'Maestro ↔ Contaline',
  activo_sin_workera: 'Maestro ↔ Workera', marca_sin_activo: 'Maestro ↔ Workera',
  activo_sin_cargo: 'Maestro ↔ Organigrama', sucursal_distinta: 'Maestro ↔ Organigrama', cargo_ocupante_inactivo: 'Maestro ↔ Organigrama',
  cargo_estado_incoherente: 'Organigrama',
  alcance_sin_sucursal: 'Accesos', jefatura_sin_ficha: 'Accesos',
  evaluacion_atrasada: 'Desempeño',
  periodo_sin_cargar: 'Procesos', workera_desactualizado: 'Procesos',
}
const ORDEN_ORIGEN = ['Procesos', 'Accesos', 'Maestro ↔ Contaline', 'Maestro ↔ Workera', 'Maestro ↔ Organigrama', 'Maestro', 'Organigrama', 'Desempeño']
const GLOBALES = new Set(['periodo_sin_cargar', 'workera_desactualizado'])   // no admiten excepción
const fFecha = d => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}-${m}-${y}` }
const fFH = ts => ts ? new Date(ts).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

function SevPill({ s }) {
  const v = SEV[s] || SEV.baja
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: v.bg, color: v.c, whiteSpace: 'nowrap' }}>{v.l}</span>
}
const btn = { padding: '6px 12px', fontSize: 12.5, fontWeight: 600, borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', color: NAVY, cursor: 'pointer', minHeight: 30 }
const btnPri = { ...btn, background: NAVY, color: '#fff', border: `1px solid ${NAVY}` }
const btnMini = { ...btn, padding: '3px 9px', fontSize: 12, minHeight: 26 }

export function RrhhIntegridad({ cu, onIr, onConteo }) {
  const [filas, setFilas] = useState([])
  const [excs, setExcs] = useState([])
  const [sucs, setSucs] = useState({})
  const [cargando, setCarg] = useState(true)
  const [error, setError] = useState(null)
  const [actualizado, setActualizado] = useState(null)
  const [filtro, setFiltro] = useState(null)          // { chequeo } | { origen } | { sev }
  const [vista, setVista] = useState('abiertas')      // 'abiertas' | 'excepciones'
  const [modalExc, setModalExc] = useState(null)      // fila a exceptuar
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    setCarg(true); setError(null)
    try {
      const [v, e, s] = await Promise.all([
        supabase.from('v_rrhh_integridad').select('*').order('sev_orden').order('chequeo').order('trabajador').limit(5000),
        supabase.from('rrhh_integridad_excepciones').select('*').eq('activo', true).order('creado_at', { ascending: false }).limit(2000),
        supabase.from('sucursales').select('id,nombre'),
      ])
      if (v.error) throw v.error
      setFilas(v.data || [])
      setExcs(e.data || [])
      setSucs(Object.fromEntries((s.data || []).map(x => [x.id, x.nombre])))
      setActualizado(new Date())
      onConteo?.((v.data || []).filter(r => r.severidad === 'alta').length)
    } catch (err) { setError(err.message || String(err)) }
    finally { setCarg(false) }
  }, [onConteo])
  useEffect(() => { cargar() }, [cargar])

  // ── Resumen ────────────────────────────────────────────────────────────
  const kpi = useMemo(() => ({
    total: filas.length,
    alta: filas.filter(r => r.severidad === 'alta').length,
    media: filas.filter(r => r.severidad === 'media').length,
    baja: filas.filter(r => r.severidad === 'baja').length,
    personas: new Set(filas.filter(r => r.cod_contaline != null).map(r => r.cod_contaline)).size,
  }), [filas])

  const porChequeo = useMemo(() => {
    const m = {}
    for (const r of filas) {
      const k = r.chequeo
      if (!m[k]) m[k] = { chequeo: k, titulo: r.titulo, severidad: r.severidad, sev_orden: r.sev_orden, responsable: r.responsable, origen: ORIGEN[k] || 'Otros', n: 0 }
      m[k].n++
    }
    const grupos = {}
    for (const c of Object.values(m)) (grupos[c.origen] ||= []).push(c)
    return Object.entries(grupos)
      .sort((a, b) => (ORDEN_ORIGEN.indexOf(a[0]) + 99) % 99 - (ORDEN_ORIGEN.indexOf(b[0]) + 99) % 99)
      .map(([origen, cs]) => ({ origen, cs: cs.sort((a, b) => a.sev_orden - b.sev_orden || b.n - a.n) }))
  }, [filas])

  const visibles = useMemo(() => {
    if (!filtro) return filas
    if (filtro.chequeo) return filas.filter(r => r.chequeo === filtro.chequeo)
    if (filtro.sev) return filas.filter(r => r.severidad === filtro.sev)
    return filas
  }, [filas, filtro])

  // ── Excepciones ────────────────────────────────────────────────────────
  async function aceptarExcepcion() {
    const f = modalExc
    if (!f || motivo.trim().length < 10) return
    setGuardando(true)
    try {
      const { error } = await supabase.from('rrhh_integridad_excepciones').insert({
        clave: f.id, chequeo: f.chequeo, cod_contaline: f.cod_contaline ?? null,
        motivo: motivo.trim(), creado_por: cu?.nombre || cu?.id || null,
      })
      if (error) throw error
      setModalExc(null); setMotivo('')
      await cargar()
    } catch (err) { setError(err.message || String(err)) }
    finally { setGuardando(false) }
  }
  async function anularExcepcion(x) {
    if (!window.confirm('¿Anular esta excepción? La inconsistencia vuelve a aparecer en la lista.')) return
    try {
      const { error } = await supabase.from('rrhh_integridad_excepciones')
        .update({ activo: false, anulado_por: cu?.nombre || cu?.id || null, anulado_at: new Date().toISOString() }).eq('id', x.id)
      if (error) throw error
      await cargar()
    } catch (err) { setError(err.message || String(err)) }
  }

  const nombreSuc = id => id ? (sucs[id] || id) : ''

  const columnas = useMemo(() => [
    { key: 'severidad', label: 'Severidad', width: 92, value: r => r.sev_orden, render: r => <SevPill s={r.severidad} />, exportValue: r => SEV[r.severidad]?.l },
    { key: 'titulo', label: 'Inconsistencia', width: 290 },
    { key: 'trabajador', label: 'Trabajador / objeto', width: 250, value: r => r.trabajador || '' },
    { key: 'cod_contaline', label: 'Código', width: 76, align: 'right', value: r => r.cod_contaline ?? '' },
    { key: 'sucursal_id', label: 'Sucursal', width: 120, value: r => nombreSuc(r.sucursal_id) },
    { key: 'detalle', label: 'Detalle', width: 420, render: r => <span style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>{r.detalle}</span> },
    { key: 'responsable', label: 'Responsable', width: 150 },
    { key: 'fecha_ref', label: 'Fecha', width: 92, value: r => r.fecha_ref || '', render: r => fFecha(r.fecha_ref) },
    { key: 'acciones', label: 'Acciones', width: 190, sortable: false, filterable: false, value: () => '', exportValue: () => '',
      render: r => (
        <span style={{ display: 'inline-flex', gap: 6 }}>
          {r.hoja && <button style={btnMini} onClick={e => { e.stopPropagation(); onIr?.(r.hoja, r.sub) }}>Corregir</button>}
          {!GLOBALES.has(r.chequeo) && <button style={{ ...btnMini, color: SLATE }} onClick={e => { e.stopPropagation(); setModalExc(r); setMotivo('') }}>Excepción</button>}
        </span>
      ) },
  ], [sucs, onIr]) // eslint-disable-line react-hooks/exhaustive-deps

  const colsExc = useMemo(() => [
    { key: 'chequeo', label: 'Chequeo', width: 200 },
    { key: 'clave', label: 'Registro', width: 230 },
    { key: 'motivo', label: 'Motivo', width: 420, render: x => <span style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>{x.motivo}</span> },
    { key: 'creado_por', label: 'Aceptada por', width: 170 },
    { key: 'creado_at', label: 'Fecha', width: 140, render: x => fFH(x.creado_at) },
    { key: 'acc', label: '', width: 90, sortable: false, filterable: false, value: () => '', exportValue: () => '',
      render: x => <button style={btnMini} onClick={() => anularExcepcion(x)}>Anular</button> },
  ], []) // eslint-disable-line react-hooks/exhaustive-deps

  const Kpi = ({ l, v, c, onClick, activo }) => (
    <button onClick={onClick} style={{ textAlign: 'left', background: activo ? TINTE : '#fff', border: `1px solid ${activo ? NAVY : BORDE}`, borderRadius: 8, padding: '10px 14px', cursor: onClick ? 'pointer' : 'default', minWidth: 120, minHeight: 0 }}>
      <div style={{ fontSize: 12, color: SLATE }}>{l}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: c || INK, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{v}</div>
    </button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Encabezado */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: 0 }}>Integridad de datos de Personas</h1>
          <div style={{ fontSize: 12.5, color: SLATE, marginTop: 3 }}>
            Cruce entre maestro de empleados, Contaline, Workera, organigrama, accesos y desempeño.
            {actualizado && <> Revisado a las {actualizado.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false })}.</>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ display: 'flex', gap: 2, background: '#F2F4F7', borderRadius: 8, padding: 3 }}>
            {[['abiertas', `Por resolver (${kpi.total})`], ['excepciones', `Excepciones aceptadas (${excs.length})`]].map(([k, l]) => (
              <button key={k} onClick={() => setVista(k)} style={{ border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', minHeight: 28, background: vista === k ? '#fff' : 'transparent', color: vista === k ? NAVY : SLATE, boxShadow: vista === k ? '0 1px 2px rgba(0,0,0,0.08)' : 'none' }}>{l}</button>
            ))}
          </div>
          <button style={btn} onClick={cargar} disabled={cargando}>{cargando ? 'Revisando…' : 'Volver a revisar'}</button>
        </div>
      </div>

      {error && <div role="alert" style={{ padding: '9px 14px', borderRadius: 8, fontSize: 13, background: '#FEF3F2', border: '1px solid #FECDCA', color: '#B42318' }}>No se pudo leer el centro de integridad: {error}</div>}

      {vista === 'abiertas' && (<>
        {/* KPIs */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Kpi l="Por resolver" v={kpi.total} onClick={() => setFiltro(null)} activo={!filtro} />
          <Kpi l="Severidad alta" v={kpi.alta} c={SEV.alta.c} onClick={() => setFiltro({ sev: 'alta' })} activo={filtro?.sev === 'alta'} />
          <Kpi l="Severidad media" v={kpi.media} c={SEV.media.c} onClick={() => setFiltro({ sev: 'media' })} activo={filtro?.sev === 'media'} />
          <Kpi l="Severidad baja" v={kpi.baja} c={SEV.baja.c} onClick={() => setFiltro({ sev: 'baja' })} activo={filtro?.sev === 'baja'} />
          <Kpi l="Trabajadores afectados" v={kpi.personas} />
        </div>

        {!cargando && kpi.total === 0 && !error && (
          <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '22px 18px', fontSize: 13.5, color: INK }}>
            Las extensiones de Personas están cuadradas: no hay inconsistencias abiertas.
          </div>
        )}

        {/* Resumen por origen */}
        {porChequeo.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
            {porChequeo.map(g => (
              <div key={g.origen} style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '10px 6px 6px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, padding: '0 8px 6px' }}>{g.origen}</div>
                {g.cs.map(c => {
                  const act = filtro?.chequeo === c.chequeo
                  return (
                    <button key={c.chequeo} onClick={() => setFiltro(act ? null : { chequeo: c.chequeo })}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', border: 'none', borderRadius: 6, padding: '6px 8px', cursor: 'pointer', minHeight: 0, background: act ? TINTE : 'transparent', boxShadow: act ? `inset 3px 0 0 ${NAVY}` : 'none' }}>
                      <SevPill s={c.severidad} />
                      <span style={{ flex: 1, fontSize: 12.5, color: INK }}>{c.titulo}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: INK, fontVariantNumeric: 'tabular-nums' }}>{c.n}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        <DataGrid
          title={filtro?.chequeo ? (filas.find(r => r.chequeo === filtro.chequeo)?.titulo || 'Inconsistencias') : filtro?.sev ? `Severidad ${SEV[filtro.sev].l.toLowerCase()}` : 'Todas las inconsistencias'}
          exportName="integridad_personas"
          columns={columnas} rows={visibles} getRowId={r => r.id}
          loading={cargando} emptyText="Sin inconsistencias para este filtro"
          toolbar={filtro && <button style={btnMini} onClick={() => setFiltro(null)}>Quitar filtro</button>}
        />
      </>)}

      {vista === 'excepciones' && (
        <DataGrid title="Excepciones aceptadas" exportName="integridad_excepciones"
          columns={colsExc} rows={excs} getRowId={x => x.id} loading={cargando}
          emptyText="No hay excepciones aceptadas. Úsalas solo para casos legítimos, por ejemplo socios que no marcan asistencia." />
      )}

      {/* Modal: aceptar excepción */}
      {modalExc && (
        <div role="dialog" aria-modal="true" aria-label="Aceptar excepción" onMouseDown={() => !guardando && setModalExc(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,24,48,0.35)', zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onMouseDown={e => e.stopPropagation()} style={{ width: 'min(520px, 100%)', background: '#fff', borderRadius: 12, boxShadow: '0 24px 60px rgba(15,24,48,0.3)', padding: 18 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: NAVY }}>Aceptar como excepción</div>
            <div style={{ fontSize: 12.5, color: SLATE, marginTop: 4, lineHeight: 1.45 }}>
              {modalExc.titulo}{modalExc.trabajador ? ` · ${modalExc.trabajador}` : ''}. Deja de aparecer en la lista hasta que alguien anule la excepción. Queda registrado quién la aceptó y por qué.
            </div>
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={4} autoFocus
              placeholder="Motivo (mínimo 10 caracteres). Ej.: socio, exento de marcar asistencia por Art. 22 inciso 2."
              style={{ width: '100%', marginTop: 12, border: `1px solid ${BORDE}`, borderRadius: 8, padding: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button style={btn} onClick={() => setModalExc(null)} disabled={guardando}>Cancelar</button>
              <button style={{ ...btnPri, opacity: motivo.trim().length < 10 ? 0.5 : 1 }} disabled={guardando || motivo.trim().length < 10} onClick={aceptarExcepcion}>
                {guardando ? 'Guardando…' : 'Aceptar excepción'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
