// src/rrhh/cumplimiento/RrhhCumplimiento.jsx
// ═══════════════════════════════════════════════════════════════════════════
// CUMPLIMIENTO LABORAL · Vacaciones (feriado legal) y Contratos (plazo fijo)
// Fuentes únicas en la BD:
//   · v_rrhh_vacaciones       saldo = saldo inicial + devengado − tomado (Workera)
//   · v_rrhh_contratos_estado estado y alertas del contrato vigente
// Las reglas legales viven en SQL (Art. 67, 68, 69, 70 y 159 N°4 CT); esta
// pantalla solo muestra y registra los datos de partida que el sistema no tiene.
// Acceso: fn_rrhh_es_gestor() en la BD. Patrón embebido/sub/onSub del shell.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../../supabase'
import { DataGrid } from '../../finanzas/conciliacion/DataGrid'

const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', BORDE = '#E5E7EB', TINTE = '#EEF1F7'
const ROJO = '#B42318', AMBAR = '#B25E09', VERDE = '#1E7A44', GRIS = '#475467'
const fF = d => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}-${m}-${y}` }
const fD = n => n == null ? '' : Number(n).toLocaleString('es-CL', { maximumFractionDigits: 2 })
const hoy = () => new Date().toISOString().slice(0, 10)

const EST_VAC = {
  ok:                { l: 'Calculado', c: VERDE, bg: '#E7F5EC' },
  sin_saldo_inicial: { l: 'Falta saldo inicial', c: AMBAR, bg: '#FEF0C7' },
  sin_fecha_ingreso: { l: 'Falta fecha de ingreso', c: GRIS, bg: '#F2F4F7' },
}
const EST_CON = {
  vigente:                    { l: 'Vigente', c: VERDE, bg: '#E7F5EC' },
  vence_pronto:               { l: 'Vence en ≤ 30 días', c: AMBAR, bg: '#FEF0C7' },
  vencido:                    { l: 'Vencido', c: ROJO, bg: '#FEE4E2' },
  indefinido_por_renovacion:  { l: 'Ya es indefinido (2ª renovación)', c: ROJO, bg: '#FEE4E2' },
  indefinido_por_continuidad: { l: 'Ya es indefinido (siguió trabajando)', c: ROJO, bg: '#FEE4E2' },
  sin_registro:               { l: 'Sin contrato registrado', c: GRIS, bg: '#F2F4F7' },
}
const TIPO_CON = { indefinido: 'Indefinido', plazo_fijo: 'Plazo fijo', obra_faena: 'Obra o faena' }
const Pill = ({ e, map }) => { const v = map[e]; if (!v) return null; return <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: v.bg, color: v.c, whiteSpace: 'nowrap' }}>{v.l}</span> }

const btn = { padding: '6px 12px', fontSize: 12.5, fontWeight: 600, borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', color: NAVY, cursor: 'pointer', minHeight: 30 }
const btnPri = { ...btn, background: NAVY, color: '#fff', border: `1px solid ${NAVY}` }
const btnMini = { ...btn, padding: '3px 9px', fontSize: 12, minHeight: 26 }
const inp = { border: `1px solid ${BORDE}`, borderRadius: 6, padding: '6px 8px', fontSize: 13, fontFamily: 'inherit', minHeight: 30, width: '100%', boxSizing: 'border-box' }
const lbl = { display: 'block', fontSize: 11.5, color: SLATE, marginBottom: 3 }
const card = { background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '12px 14px' }

function Kpi({ l, v, c, onClick, activo }) {
  return (
    <button onClick={onClick} style={{ textAlign: 'left', background: activo ? TINTE : '#fff', border: `1px solid ${activo ? NAVY : BORDE}`, borderRadius: 8, padding: '10px 14px', cursor: onClick ? 'pointer' : 'default', minWidth: 130, minHeight: 0 }}>
      <div style={{ fontSize: 12, color: SLATE }}>{l}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: c || INK, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{v}</div>
    </button>
  )
}
function Modal({ titulo, sub, children, onCerrar }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={titulo} onMouseDown={onCerrar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,24,48,0.35)', zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onMouseDown={e => e.stopPropagation()} style={{ width: 'min(520px, 100%)', maxHeight: '88vh', overflow: 'auto', background: '#fff', borderRadius: 12, boxShadow: '0 24px 60px rgba(15,24,48,0.3)', padding: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: NAVY }}>{titulo}</div>
        {sub && <div style={{ fontSize: 12.5, color: SLATE, marginTop: 3 }}>{sub}</div>}
        <div style={{ marginTop: 12 }}>{children}</div>
      </div>
    </div>
  )
}

export function RrhhCumplimiento({ cu, sub, onSub }) {
  const [vista, setVista] = useState(sub === 'contratos' ? 'contratos' : 'vacaciones')
  const primera = useRef(true)
  useEffect(() => { if (primera.current) { primera.current = false; return } if ((sub === 'vacaciones' || sub === 'contratos') && sub !== vista) setVista(sub) }, [sub]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onSub?.(vista) }, [vista]) // eslint-disable-line react-hooks/exhaustive-deps

  const [vac, setVac] = useState([]); const [con, setCon] = useState([])
  const [cargando, setCarg] = useState(true); const [error, setError] = useState(null); const [msg, setMsg] = useState(null)
  const [filtro, setFiltro] = useState(null)
  const [mSaldo, setMSaldo] = useState(null)   // fila vacaciones
  const [mCon, setMCon] = useState(null)       // fila contrato
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    setCarg(true); setError(null)
    try {
      const [v, c] = await Promise.all([
        supabase.from('v_rrhh_vacaciones').select('*').order('nombre').limit(5000),
        supabase.from('v_rrhh_contratos_estado').select('*').order('nombre').limit(5000),
      ])
      if (v.error) throw v.error
      if (c.error) throw c.error
      setVac(v.data || []); setCon(c.data || [])
    } catch (e) { setError(e.message || String(e)) }
    finally { setCarg(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { setFiltro(null) }, [vista])
  const aviso = (t, ok = true) => { setMsg({ t, ok }); setTimeout(() => setMsg(null), 4000) }

  // ── Vacaciones ──────────────────────────────────────────────────────────
  const kVac = useMemo(() => ({
    ok: vac.filter(r => r.estado_calculo === 'ok').length,
    sinSaldo: vac.filter(r => r.estado_calculo === 'sin_saldo_inicial').length,
    sinIng: vac.filter(r => r.estado_calculo === 'sin_fecha_ingreso').length,
    sobre: vac.filter(r => r.sobre_dos_periodos).length,
  }), [vac])
  const vacVis = useMemo(() => !filtro ? vac
    : filtro === 'sobre' ? vac.filter(r => r.sobre_dos_periodos)
    : vac.filter(r => r.estado_calculo === filtro), [vac, filtro])
  const colsVac = useMemo(() => [
    { key: 'nombre', label: 'Trabajador', width: 240 },
    { key: 'cod_contaline', label: 'Código', width: 70, align: 'right' },
    { key: 'sucursal_id', label: 'Sucursal', width: 100 },
    { key: 'fecha_ingreso', label: 'Ingreso', width: 92, render: r => fF(r.fecha_ingreso) },
    { key: 'anios_empresa', label: 'Años', width: 60, align: 'right' },
    { key: 'dias_por_anio', label: 'Días/año', width: 76, align: 'right', render: r => <span title={r.dias_progresivos ? `Incluye ${r.dias_progresivos} día(s) de feriado progresivo (Art. 68)` : ''}>{r.dias_por_anio}{r.dias_progresivos ? ' *' : ''}</span> },
    { key: 'saldo_inicial', label: 'Saldo inicial', width: 96, align: 'right', render: r => r.fecha_corte ? <span title={`al ${fF(r.fecha_corte)}`}>{fD(r.saldo_inicial)}</span> : '' },
    { key: 'devengados', label: 'Devengados', width: 92, align: 'right', render: r => fD(r.devengados) },
    { key: 'tomados', label: 'Tomados', width: 80, align: 'right', render: r => fD(r.tomados) },
    { key: 'programados', label: 'Programados', width: 96, align: 'right', render: r => r.programados ? fD(r.programados) : '' },
    { key: 'saldo', label: 'Saldo', width: 80, align: 'right', render: r => r.saldo == null ? '' : <b style={{ color: r.sobre_dos_periodos ? ROJO : INK }}>{fD(r.saldo)}</b> },
    { key: 'exigible', label: 'Exigible', width: 78, value: r => r.exigible ? 'Sí' : 'No', render: r => r.exigible ? 'Sí' : <span style={{ color: SLATE }} title="Art. 67: el derecho se adquiere tras un año de servicio">Aún no</span> },
    { key: 'estado_calculo', label: 'Estado', width: 170, value: r => EST_VAC[r.estado_calculo]?.l || '', render: r => <span style={{ display: 'inline-flex', gap: 6 }}><Pill e={r.estado_calculo} map={EST_VAC} />{r.sobre_dos_periodos && <Pill e="vencido" map={{ vencido: { l: 'Sobre 2 períodos', c: ROJO, bg: '#FEE4E2' } }} />}</span> },
    { key: 'acc', label: '', width: 110, sortable: false, filterable: false, value: () => '', exportValue: () => '',
      render: r => r.fecha_ingreso ? <button style={btnMini} onClick={e => { e.stopPropagation(); setMSaldo({ ...r, f_corte: r.fecha_corte || hoy(), f_dias: r.saldo_inicial ?? '', f_prev: r.anios_previos ?? 0, f_doc: '' }) }}>Saldo inicial</button> : null },
  ], [])

  async function guardarSaldo() {
    const r = mSaldo; const dias = Number(String(r.f_dias).replace(',', '.'))
    if (!r.f_corte || isNaN(dias)) return aviso('Completa la fecha de corte y los días hábiles', false)
    if (r.fecha_ingreso && r.f_corte < r.fecha_ingreso) return aviso('La fecha de corte no puede ser anterior al ingreso', false)
    setGuardando(true)
    const { error } = await supabase.from('rrhh_vacaciones_saldo_inicial').upsert({
      cod_contaline: r.cod_contaline, fecha_corte: r.f_corte, dias_habiles: dias,
      anios_previos: Number(r.f_prev) || 0, documento: r.f_doc || null, creado_por: cu?.nombre || null, updated_at: new Date().toISOString(),
    }, { onConflict: 'cod_contaline' })
    setGuardando(false)
    if (error) return aviso(error.message, false)
    setMSaldo(null); aviso(`Saldo inicial de ${r.nombre} registrado`); cargar()
  }

  // ── Contratos ───────────────────────────────────────────────────────────
  const kCon = useMemo(() => {
    const n = e => con.filter(r => r.estado === e).length
    return { alerta: n('indefinido_por_renovacion') + n('indefinido_por_continuidad') + n('vencido'), pronto: n('vence_pronto'), sinReg: n('sin_registro'), vig: n('vigente'), excede: con.filter(r => r.excede_un_anio).length }
  }, [con])
  const conVis = useMemo(() => !filtro ? con
    : filtro === 'alerta' ? con.filter(r => ['indefinido_por_renovacion', 'indefinido_por_continuidad', 'vencido'].includes(r.estado))
    : filtro === 'excede' ? con.filter(r => r.excede_un_anio)
    : con.filter(r => r.estado === filtro), [con, filtro])
  const colsCon = useMemo(() => [
    { key: 'nombre', label: 'Trabajador', width: 240 },
    { key: 'cod_contaline', label: 'Código', width: 70, align: 'right' },
    { key: 'sucursal_id', label: 'Sucursal', width: 100 },
    { key: 'cargo_contractual', label: 'Cargo contractual', width: 170 },
    { key: 'tipo', label: 'Tipo', width: 100, value: r => TIPO_CON[r.tipo] || '' },
    { key: 'inicio', label: 'Inicio', width: 92, render: r => fF(r.inicio) },
    { key: 'termino', label: 'Término', width: 92, render: r => fF(r.termino) },
    { key: 'dias_para_termino', label: 'Días', width: 64, align: 'right', render: r => r.dias_para_termino == null ? '' : <span style={{ color: r.dias_para_termino < 0 ? ROJO : r.dias_para_termino <= 30 ? AMBAR : INK, fontWeight: 600 }}>{r.dias_para_termino}</span> },
    { key: 'renovacion_n', label: 'Renov.', width: 64, align: 'right', render: r => r.contrato_id ? r.renovacion_n : '' },
    { key: 'estado', label: 'Estado', width: 230, value: r => EST_CON[r.estado]?.l || '', render: r => <span style={{ display: 'inline-flex', gap: 6 }}><Pill e={r.estado} map={EST_CON} />{r.excede_un_anio && <Pill e="x" map={{ x: { l: 'Más de 1 año', c: AMBAR, bg: '#FEF0C7' } }} />}</span> },
    { key: 'ultima_marca', label: 'Última marca', width: 100, render: r => fF(r.ultima_marca) },
    { key: 'acc', label: '', width: 130, sortable: false, filterable: false, value: () => '', exportValue: () => '',
      render: r => <button style={btnMini} onClick={e => { e.stopPropagation(); setMCon({ ...r, f_tipo: r.tipo === 'plazo_fijo' ? 'plazo_fijo' : (r.tipo || 'indefinido'), f_inicio: r.termino ? sumarDia(r.termino) : (r.fecha_ingreso || hoy()), f_termino: '', f_ren: r.tipo === 'plazo_fijo' ? (r.renovacion_n || 0) + 1 : 0, f_doc: '' }) }}>{r.contrato_id ? 'Nuevo contrato' : 'Registrar'}</button> },
  ], [])
  const sumarDia = d => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }

  async function guardarContrato() {
    const r = mCon
    if (!r.f_inicio) return aviso('Falta la fecha de inicio', false)
    if (r.f_tipo === 'plazo_fijo' && !r.f_termino) return aviso('Un plazo fijo necesita fecha de término', false)
    if (r.f_termino && r.f_termino < r.f_inicio) return aviso('El término no puede ser anterior al inicio', false)
    setGuardando(true)
    const { error } = await supabase.from('rrhh_contratos').insert({
      cod_contaline: r.cod_contaline, tipo: r.f_tipo, inicio: r.f_inicio, termino: r.f_tipo === 'indefinido' ? null : (r.f_termino || null),
      renovacion_n: r.f_tipo === 'plazo_fijo' ? Number(r.f_ren) || 0 : 0, documento: r.f_doc || null, creado_por: cu?.nombre || null,
    })
    setGuardando(false)
    if (error) return aviso(error.message, false)
    setMCon(null); aviso(`Contrato de ${r.nombre} registrado`); cargar()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: 0 }}>{vista === 'vacaciones' ? 'Vacaciones · feriado legal' : 'Contratos y plazos'}</h1>
          <div style={{ fontSize: 12.5, color: SLATE, marginTop: 3 }}>
            {vista === 'vacaciones'
              ? 'Saldo en días hábiles: saldo inicial + devengado (15 días al año más feriado progresivo) − vacaciones tomadas registradas en Workera.'
              : 'Contrato vigente de cada trabajador y alertas de plazo fijo (Art. 159 N°4 CT).'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ display: 'flex', gap: 2, background: '#F2F4F7', borderRadius: 8, padding: 3 }}>
            {[['vacaciones', 'Vacaciones'], ['contratos', 'Contratos']].map(([k, l]) => (
              <button key={k} onClick={() => setVista(k)} style={{ border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', minHeight: 28, background: vista === k ? '#fff' : 'transparent', color: vista === k ? NAVY : SLATE, boxShadow: vista === k ? '0 1px 2px rgba(0,0,0,0.08)' : 'none' }}>{l}</button>))}
          </div>
          <button style={btn} onClick={cargar} disabled={cargando}>{cargando ? 'Calculando…' : 'Actualizar'}</button>
        </div>
      </div>
      {error && <div role="alert" style={{ padding: '9px 14px', borderRadius: 8, fontSize: 13, background: '#FEF3F2', border: '1px solid #FECDCA', color: ROJO }}>No se pudo leer: {error}</div>}
      {msg && <div role="status" style={{ padding: '8px 14px', borderRadius: 8, fontSize: 13, background: msg.ok ? '#E7F5EC' : '#FEF3F2', color: msg.ok ? VERDE : ROJO }}>{msg.t}</div>}

      {vista === 'vacaciones' && (<>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Kpi l="Saldo calculado" v={kVac.ok} c={VERDE} onClick={() => setFiltro(filtro === 'ok' ? null : 'ok')} activo={filtro === 'ok'} />
          <Kpi l="Falta saldo inicial" v={kVac.sinSaldo} c={AMBAR} onClick={() => setFiltro(filtro === 'sin_saldo_inicial' ? null : 'sin_saldo_inicial')} activo={filtro === 'sin_saldo_inicial'} />
          <Kpi l="Falta fecha de ingreso" v={kVac.sinIng} c={GRIS} onClick={() => setFiltro(filtro === 'sin_fecha_ingreso' ? null : 'sin_fecha_ingreso')} activo={filtro === 'sin_fecha_ingreso'} />
          <Kpi l="Sobre 2 períodos (Art. 70)" v={kVac.sobre} c={ROJO} onClick={() => setFiltro(filtro === 'sobre' ? null : 'sobre')} activo={filtro === 'sobre'} />
        </div>
        {(kVac.sinSaldo > 0 || kVac.sinIng > 0) && <div style={{ ...card, background: '#FFFAEB', borderColor: '#FEDF89', fontSize: 12.5, color: '#93370D', lineHeight: 1.5 }}>
          Workera registra vacaciones desde febrero de 2026. Para quien ingresó antes, el sistema necesita el <b>saldo inicial</b> a una fecha de corte (el que figura en Contaline o en el último comprobante de feriado). La <b>fecha de ingreso</b> llega sola con la próxima carga de liquidaciones.
        </div>}
        <DataGrid title="Saldo de vacaciones por trabajador" exportName="vacaciones_saldo" columns={colsVac} rows={vacVis}
          getRowId={r => r.cod_contaline} loading={cargando} emptyText="Sin trabajadores para este filtro"
          toolbar={filtro && <button style={btnMini} onClick={() => setFiltro(null)}>Quitar filtro</button>} />
        <div style={{ fontSize: 11.5, color: SLATE, lineHeight: 1.6 }}>
          Días hábiles: lunes a viernes sin feriados legales (Art. 69). * Incluye feriado progresivo: un día extra por cada 3 años nuevos sobre 10 trabajados, con máximo 10 años de empleadores anteriores (Art. 68). El derecho se ejerce tras un año de servicio (Art. 67) y se pueden acumular hasta dos períodos (Art. 70).
        </div>
      </>)}

      {vista === 'contratos' && (<>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Kpi l="Requieren acción" v={kCon.alerta} c={ROJO} onClick={() => setFiltro(filtro === 'alerta' ? null : 'alerta')} activo={filtro === 'alerta'} />
          <Kpi l="Vencen en 30 días" v={kCon.pronto} c={AMBAR} onClick={() => setFiltro(filtro === 'vence_pronto' ? null : 'vence_pronto')} activo={filtro === 'vence_pronto'} />
          <Kpi l="Plazo fijo de más de 1 año" v={kCon.excede} c={AMBAR} onClick={() => setFiltro(filtro === 'excede' ? null : 'excede')} activo={filtro === 'excede'} />
          <Kpi l="Vigentes" v={kCon.vig} c={VERDE} onClick={() => setFiltro(filtro === 'vigente' ? null : 'vigente')} activo={filtro === 'vigente'} />
          <Kpi l="Sin contrato registrado" v={kCon.sinReg} c={GRIS} onClick={() => setFiltro(filtro === 'sin_registro' ? null : 'sin_registro')} activo={filtro === 'sin_registro'} />
        </div>
        <DataGrid title="Contrato vigente por trabajador" exportName="contratos_estado" columns={colsCon} rows={conVis}
          getRowId={r => r.cod_contaline} loading={cargando} emptyText="Sin trabajadores para este filtro"
          toolbar={filtro && <button style={btnMini} onClick={() => setFiltro(null)}>Quitar filtro</button>} />
        <div style={{ fontSize: 11.5, color: SLATE, lineHeight: 1.6 }}>
          Un plazo fijo pasa a indefinido si se renueva por segunda vez o si el trabajador sigue prestando servicios después del vencimiento con conocimiento del empleador (Art. 159 N°4). Duración máxima: un año, o dos para gerentes y profesionales. Cada contrato nuevo queda como historial; el vigente es el de inicio más reciente.
        </div>
      </>)}

      {mSaldo && <Modal titulo="Saldo inicial de vacaciones" sub={`${mSaldo.nombre} · ingreso ${fF(mSaldo.fecha_ingreso)}`} onCerrar={() => !guardando && setMSaldo(null)}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><label style={lbl}>Fecha de corte</label><input type="date" value={mSaldo.f_corte} min={mSaldo.fecha_ingreso || undefined} max={hoy()} onChange={e => setMSaldo(m => ({ ...m, f_corte: e.target.value }))} style={inp} /></div>
          <div><label style={lbl}>Saldo a esa fecha (días hábiles)</label><input value={mSaldo.f_dias} onChange={e => setMSaldo(m => ({ ...m, f_dias: e.target.value }))} inputMode="decimal" style={inp} /></div>
          <div><label style={lbl}>Años con empleadores anteriores (certificado)</label><input value={mSaldo.f_prev} onChange={e => setMSaldo(m => ({ ...m, f_prev: e.target.value }))} inputMode="numeric" style={inp} /></div>
          <div><label style={lbl}>Respaldo</label><input value={mSaldo.f_doc} onChange={e => setMSaldo(m => ({ ...m, f_doc: e.target.value }))} placeholder="Ej.: saldo Contaline al 30-09-2026" style={inp} /></div>
        </div>
        <div style={{ fontSize: 11.5, color: SLATE, marginTop: 10, lineHeight: 1.5 }}>Desde la fecha de corte el sistema suma lo devengado y resta las vacaciones que registre Workera. Para el feriado progresivo valen como máximo 10 años de empleadores anteriores.</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button style={btn} onClick={() => setMSaldo(null)} disabled={guardando}>Cancelar</button>
          <button style={btnPri} onClick={guardarSaldo} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </Modal>}

      {mCon && <Modal titulo={mCon.contrato_id ? 'Nuevo contrato o renovación' : 'Registrar contrato'} sub={`${mCon.nombre} · ${mCon.cargo_contractual || 'sin cargo contractual'}`} onCerrar={() => !guardando && setMCon(null)}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><label style={lbl}>Tipo</label>
            <select value={mCon.f_tipo} onChange={e => setMCon(m => ({ ...m, f_tipo: e.target.value }))} style={inp}>
              {Object.entries(TIPO_CON).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></div>
          <div><label style={lbl}>Inicio</label><input type="date" value={mCon.f_inicio} onChange={e => setMCon(m => ({ ...m, f_inicio: e.target.value }))} style={inp} /></div>
          {mCon.f_tipo !== 'indefinido' && <div><label style={lbl}>Término{mCon.f_tipo === 'plazo_fijo' ? ' (obligatorio)' : ''}</label><input type="date" value={mCon.f_termino} min={mCon.f_inicio} onChange={e => setMCon(m => ({ ...m, f_termino: e.target.value }))} style={inp} /></div>}
          {mCon.f_tipo === 'plazo_fijo' && <div><label style={lbl}>Renovación N° (0 = original)</label><input value={mCon.f_ren} onChange={e => setMCon(m => ({ ...m, f_ren: e.target.value }))} inputMode="numeric" style={inp} /></div>}
          <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Respaldo</label><input value={mCon.f_doc} onChange={e => setMCon(m => ({ ...m, f_doc: e.target.value }))} placeholder="Ej.: contrato firmado / anexo de renovación" style={inp} /></div>
        </div>
        {mCon.f_tipo === 'plazo_fijo' && Number(mCon.f_ren) >= 2 && <div style={{ fontSize: 12, color: ROJO, marginTop: 10 }}>Una segunda renovación convierte el contrato en indefinido (Art. 159 N°4). Si corresponde, regístralo como indefinido.</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button style={btn} onClick={() => setMCon(null)} disabled={guardando}>Cancelar</button>
          <button style={btnPri} onClick={guardarContrato} disabled={guardando}>{guardando ? 'Guardando…' : 'Registrar'}</button>
        </div>
      </Modal>}
    </div>
  )
}
