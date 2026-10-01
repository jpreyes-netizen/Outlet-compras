// src/rrhh/cuadratura/CuadraturaHHEE.jsx
// ═══════════════════════════════════════════════════════════════════════════
// CUADRATURA DE HORAS EXTRA · autorizadas (Workera + jefatura) vs pagadas (Contaline)
// Fuente única: v_rrhh_cuadratura_hhee. Esta pantalla no recalcula: lee la vista
// y edita las reglas que la vista usa (clase de glosa, tolerancias, pactos).
// Tres componentes que se cuadran por separado, porque se controlan distinto:
//   · Variable  → contra minutos autorizados × valor hora (v_asis_remuneracion_mes)
//   · Pactadas  → contra el pacto escrito registrado (Art. 32 CT)
//   · Feriado   → contra días trabajados en feriado según Workera
// Acceso: fn_rrhh_es_gestor() en la BD.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../supabase'
import { DataGrid } from '../../finanzas/conciliacion/DataGrid'

const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', BORDE = '#E5E7EB', TINTE = '#EEF1F7'
const ROJO = '#B42318', AMBAR = '#B25E09', VERDE = '#1E7A44', GRIS = '#475467'
const fmt = n => (n == null || isNaN(n)) ? '' : (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('es-CL')
const fH = n => n == null ? '' : Number(n).toLocaleString('es-CL', { maximumFractionDigits: 1 })
const mesL = p => { const [y, m] = p.split('-'); return ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][+m - 1] + ' ' + y }

const EST = {
  cuadra:                  { l: 'Cuadra', c: VERDE, bg: '#E7F5EC' },
  pagado_sin_autorizacion: { l: 'Pagado sin autorización', c: ROJO, bg: '#FEE4E2' },
  pagado_sobre_autorizado: { l: 'Pagado sobre lo autorizado', c: ROJO, bg: '#FEE4E2' },
  autorizado_no_pagado:    { l: 'Autorizado no pagado', c: AMBAR, bg: '#FEF0C7' },
  pagado_bajo_autorizado:  { l: 'Pagado bajo lo autorizado', c: AMBAR, bg: '#FEF0C7' },
  sin_valorizar:           { l: 'Sin sueldo base', c: GRIS, bg: '#F2F4F7' },
  sin_liquidacion:         { l: 'Liquidación no cargada', c: GRIS, bg: '#F2F4F7' },
  pactada_sin_pacto:       { l: 'Pagada sin pacto registrado', c: ROJO, bg: '#FEE4E2' },
  pactada_con_pacto:       { l: 'Con pacto', c: VERDE, bg: '#E7F5EC' },
  pacto_sin_pago:          { l: 'Pacto sin pago', c: AMBAR, bg: '#FEF0C7' },
  sin_pacto:               { l: '', c: SLATE, bg: 'transparent' },
  feriado_sin_registro:    { l: 'Pagado sin feriado trabajado', c: ROJO, bg: '#FEE4E2' },
  feriado_no_pagado:       { l: 'Feriado trabajado no pagado', c: AMBAR, bg: '#FEF0C7' },
  feriado_con_registro:    { l: 'Con registro', c: VERDE, bg: '#E7F5EC' },
  sin_feriado:             { l: '', c: SLATE, bg: 'transparent' },
}
const Est = ({ e }) => { const v = EST[e]; if (!v || !v.l) return null; return <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: v.bg, color: v.c, whiteSpace: 'nowrap' }}>{v.l}</span> }
const CLASES = [['variable', 'Variable (contra autorizado)'], ['ajuste_anterior', 'Ajuste del mes anterior'], ['pactada', 'Pactada (contra pacto)'], ['feriado', 'Feriado (contra días)']]

const btn = { padding: '6px 12px', fontSize: 12.5, fontWeight: 600, borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', color: NAVY, cursor: 'pointer', minHeight: 30 }
const btnPri = { ...btn, background: NAVY, color: '#fff', border: `1px solid ${NAVY}` }
const inp = { border: `1px solid ${BORDE}`, borderRadius: 6, padding: '6px 8px', fontSize: 13, fontFamily: 'inherit', minHeight: 30 }
const card = { background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '12px 14px' }

export function CuadraturaHHEE({ cu }) {
  const [vista, setVista] = useState('cuadratura')   // 'cuadratura' | 'reglas'
  const [filas, setFilas] = useState([])
  const [periodo, setPeriodo] = useState(null)
  const [cargando, setCarg] = useState(true)
  const [error, setError] = useState(null)
  const [filtro, setFiltro] = useState(null)          // { comp, estado }
  const [glosas, setGlosas] = useState([])
  const [params, setParams] = useState([])
  const [pactos, setPactos] = useState([])
  const [nuevoPacto, setNuevoPacto] = useState({ cod_contaline: '', horas_mes: '', desde: '', hasta: '', documento: '' })
  const [msg, setMsg] = useState(null)

  const cargar = useCallback(async () => {
    setCarg(true); setError(null)
    try {
      const [v, g, p, pa] = await Promise.all([
        supabase.from('v_rrhh_cuadratura_hhee').select('*').order('periodo', { ascending: false }).order('trabajador').limit(10000),
        supabase.from('rrhh_hhee_glosa_clase').select('*').order('glosa_codigo'),
        supabase.from('rrhh_hhee_param').select('*').order('clave'),
        supabase.from('rrhh_pactos_hhee').select('*').eq('activo', true).order('desde', { ascending: false }),
      ])
      if (v.error) throw v.error
      setFilas(v.data || []); setGlosas(g.data || []); setParams(p.data || []); setPactos(pa.data || [])
      // Por defecto: el último período con liquidación cargada
      setPeriodo(prev => prev || (v.data || []).find(r => r.liquidacion_cargada)?.periodo || (v.data || [])[0]?.periodo || null)
    } catch (e) { setError(e.message || String(e)) }
    finally { setCarg(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const periodos = useMemo(() => [...new Set(filas.map(r => r.periodo))].sort().reverse(), [filas])
  const delPeriodo = useMemo(() => filas.filter(r => r.periodo === periodo), [filas, periodo])
  const info = delPeriodo[0] || {}

  const res = useMemo(() => {
    const s = (k, f = () => true) => delPeriodo.filter(f).reduce((t, r) => t + Number(r[k] || 0), 0)
    const cnt = (k, e) => delPeriodo.filter(r => r[k] === e).length
    return {
      hReloj: s('horas_reloj'), hAut: s('horas_autorizadas'), hPend: s('horas_pendientes'),
      cAut: s('costo_autorizado'), cPend: s('costo_pendiente'),
      pVar: s('pagado_variable'), pAj: s('pagado_ajuste_mes_sig'), pVarT: s('pagado_variable_total'),
      pPac: s('pagado_pactadas'), pFer: s('pagado_feriado'), pSin: s('pagado_glosa_sin_clase'), dFer: s('dias_feriado_trabajados'),
      sinAut: s('pagado_variable_total', r => r.estado_variable === 'pagado_sin_autorizacion'),
      sobre: s('diferencia_variable', r => r.estado_variable === 'pagado_sobre_autorizado'),
      noPag: s('costo_autorizado', r => r.estado_variable === 'autorizado_no_pagado'),
      pacSinPacto: s('pagado_pactadas', r => r.estado_pactada === 'pactada_sin_pacto'),
      ferSinReg: s('pagado_feriado', r => r.estado_feriado === 'feriado_sin_registro'),
      cnt,
    }
  }, [delPeriodo])

  const visibles = useMemo(() => {
    if (!filtro) return delPeriodo
    return delPeriodo.filter(r => r[filtro.comp] === filtro.estado)
  }, [delPeriodo, filtro])

  const columnas = useMemo(() => [
    { key: 'trabajador', label: 'Trabajador', width: 230 },
    { key: 'cod_contaline', label: 'Código', width: 70, align: 'right' },
    { key: 'sucursal_nombre', label: 'Sucursal', width: 120, value: r => r.sucursal_nombre || '' },
    { key: 'horas_reloj', label: 'Horas reloj', width: 90, align: 'right', render: r => fH(r.horas_reloj) },
    { key: 'horas_autorizadas', label: 'Horas autorizadas', width: 110, align: 'right', render: r => fH(r.horas_autorizadas) },
    { key: 'horas_pendientes', label: 'Horas pendientes', width: 110, align: 'right', render: r => fH(r.horas_pendientes) },
    { key: 'costo_autorizado', label: 'Autorizado $', width: 110, align: 'right', render: r => fmt(r.costo_autorizado) },
    { key: 'pagado_variable', label: 'Pagado normal + especial', width: 150, align: 'right', render: r => fmt(r.pagado_variable) },
    { key: 'pagado_ajuste_mes_sig', label: 'Ajuste mes siguiente', width: 130, align: 'right', render: r => fmt(r.pagado_ajuste_mes_sig) },
    { key: 'diferencia_variable', label: 'Diferencia', width: 105, align: 'right',
      render: r => <span style={{ fontWeight: 700, color: Math.abs(r.diferencia_variable) < 1 ? SLATE : r.diferencia_variable > 0 ? ROJO : AMBAR }}>{fmt(r.diferencia_variable)}</span> },
    { key: 'estado_variable', label: 'Estado variable', width: 190, value: r => EST[r.estado_variable]?.l || '', render: r => <Est e={r.estado_variable} /> },
    { key: 'pagado_pactadas', label: 'HH pactadas $', width: 110, align: 'right', render: r => fmt(r.pagado_pactadas) },
    { key: 'pacto_horas_mes', label: 'Pacto h/mes', width: 90, align: 'right', render: r => fH(r.pacto_horas_mes) },
    { key: 'estado_pactada', label: 'Estado pactadas', width: 190, value: r => EST[r.estado_pactada]?.l || '', render: r => <Est e={r.estado_pactada} /> },
    { key: 'dias_feriado_trabajados', label: 'Días feriado', width: 90, align: 'right' },
    { key: 'pagado_feriado', label: 'Feriado $', width: 105, align: 'right', render: r => fmt(r.pagado_feriado) },
    { key: 'estado_feriado', label: 'Estado feriado', width: 200, value: r => EST[r.estado_feriado]?.l || '', render: r => <Est e={r.estado_feriado} /> },
  ], [])

  // ── Reglas ───────────────────────────────────────────────────────────────
  const aviso = (t, ok = true) => { setMsg({ t, ok }); setTimeout(() => setMsg(null), 3500) }
  async function guardarGlosa(g, cambios) {
    const { error } = await supabase.from('rrhh_hhee_glosa_clase').update({ ...cambios, updated_at: new Date().toISOString() }).eq('glosa_codigo', g.glosa_codigo)
    if (error) return aviso(error.message, false)
    aviso(`Glosa ${g.glosa_codigo} actualizada`); cargar()
  }
  async function guardarParam(p, valor) {
    const v = Number(valor); if (isNaN(v)) return aviso('Valor no numérico', false)
    const { error } = await supabase.from('rrhh_hhee_param').update({ valor: v, updated_at: new Date().toISOString() }).eq('clave', p.clave)
    if (error) return aviso(error.message, false)
    aviso(`${p.clave} = ${v}`); cargar()
  }
  async function agregarPacto() {
    const n = nuevoPacto
    if (!n.cod_contaline || !n.horas_mes || !n.desde || !n.hasta) return aviso('Completa código, horas, desde y hasta', false)
    const { error } = await supabase.from('rrhh_pactos_hhee').insert({
      cod_contaline: Number(n.cod_contaline), horas_mes: Number(n.horas_mes), desde: n.desde, hasta: n.hasta,
      documento: n.documento || null, creado_por: cu?.nombre || null })
    if (error) return aviso(error.message, false)
    setNuevoPacto({ cod_contaline: '', horas_mes: '', desde: '', hasta: '', documento: '' })
    aviso('Pacto registrado'); cargar()
  }
  async function anularPacto(p) {
    if (!window.confirm('¿Dar de baja este pacto?')) return
    const { error } = await supabase.from('rrhh_pactos_hhee').update({ activo: false }).eq('id', p.id)
    if (error) return aviso(error.message, false)
    cargar()
  }
  const meses = (a, b) => { const d1 = new Date(a), d2 = new Date(b); return (d2 - d1) / 86400000 / 30.44 }

  const Comp = ({ titulo, lineas, alertas }) => (
    <div style={{ ...card, flex: '1 1 300px' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, marginBottom: 6 }}>{titulo}</div>
      {lineas.map(([l, v, fuerte]) => (
        <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '2px 0', color: INK, fontWeight: fuerte ? 800 : 400 }}>
          <span style={{ color: fuerte ? INK : SLATE }}>{l}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
        </div>))}
      {alertas.filter(a => a.n > 0).length > 0 && <div style={{ borderTop: `1px solid ${BORDE}`, marginTop: 8, paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {alertas.filter(a => a.n > 0).map(a => {
          const act = filtro?.comp === a.comp && filtro?.estado === a.estado
          return <button key={a.estado} onClick={() => setFiltro(act ? null : { comp: a.comp, estado: a.estado })}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, border: 'none', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', minHeight: 0, background: act ? TINTE : 'transparent', boxShadow: act ? `inset 3px 0 0 ${NAVY}` : 'none', textAlign: 'left' }}>
            <Est e={a.estado} /><span style={{ fontSize: 12.5, fontWeight: 700, color: INK, fontVariantNumeric: 'tabular-nums' }}>{a.n} · {fmt(a.monto)}</span>
          </button>
        })}
      </div>}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: 0 }}>Cuadratura de horas extra</h1>
          <div style={{ fontSize: 12.5, color: SLATE, marginTop: 3 }}>Autorizadas por jefatura en Workera contra pagadas en la liquidación de Contaline, por período de pago (26 al 25).</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {vista === 'cuadratura' && <select value={periodo || ''} onChange={e => { setPeriodo(e.target.value); setFiltro(null) }} style={inp} aria-label="Período de pago">
            {periodos.map(p => <option key={p} value={p}>{mesL(p)}</option>)}
          </select>}
          <div style={{ display: 'flex', gap: 2, background: '#F2F4F7', borderRadius: 8, padding: 3 }}>
            {[['cuadratura', 'Cuadratura'], ['reglas', 'Reglas y pactos']].map(([k, l]) => (
              <button key={k} onClick={() => setVista(k)} style={{ border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', minHeight: 28, background: vista === k ? '#fff' : 'transparent', color: vista === k ? NAVY : SLATE, boxShadow: vista === k ? '0 1px 2px rgba(0,0,0,0.08)' : 'none' }}>{l}</button>))}
          </div>
          <button style={btn} onClick={cargar} disabled={cargando}>{cargando ? 'Calculando…' : 'Actualizar'}</button>
        </div>
      </div>

      {error && <div role="alert" style={{ padding: '9px 14px', borderRadius: 8, fontSize: 13, background: '#FEF3F2', border: '1px solid #FECDCA', color: ROJO }}>No se pudo leer la cuadratura: {error}</div>}
      {msg && <div role="status" style={{ padding: '8px 14px', borderRadius: 8, fontSize: 13, background: msg.ok ? '#E7F5EC' : '#FEF3F2', color: msg.ok ? VERDE : ROJO }}>{msg.t}</div>}

      {vista === 'cuadratura' && periodo && (<>
        {/* Advertencias de completitud y supuestos */}
        {(!info.liquidacion_cargada || !info.ajuste_cargado || glosas.some(g => !g.confirmado)) && (
          <div style={{ ...card, background: '#FFFAEB', borderColor: '#FEDF89', fontSize: 12.5, color: '#93370D', lineHeight: 1.5 }}>
            {!info.liquidacion_cargada && <div><b>La liquidación de {mesL(periodo)} no está cargada:</b> solo se ve el lado autorizado.</div>}
            {info.liquidacion_cargada && !info.ajuste_cargado && <div><b>Falta la liquidación del mes siguiente:</b> el ajuste "mes anterior" todavía no entra, así que el pagado variable de {mesL(periodo)} puede subir.</div>}
            {glosas.some(g => !g.confirmado) && <div><b>Reglas sin confirmar con Contaline:</b> la clasificación de glosas es un supuesto hasta que se marque como confirmada en Reglas y pactos.</div>}
          </div>)}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Comp titulo="Variable · normal y especial"
            lineas={[['Horas en el reloj', fH(res.hReloj)], ['Horas autorizadas', fH(res.hAut)], ['Horas sin validar', fH(res.hPend)],
                     ['Costo autorizado', fmt(res.cAut), true], ['Pagado en el mes', fmt(res.pVar)], ['Ajuste pagado al mes siguiente', fmt(res.pAj)],
                     ['Total pagado', fmt(res.pVarT), true], ['Diferencia', fmt(res.pVarT - res.cAut), true]]}
            alertas={[
              { comp: 'estado_variable', estado: 'pagado_sin_autorizacion', n: res.cnt('estado_variable', 'pagado_sin_autorizacion'), monto: res.sinAut },
              { comp: 'estado_variable', estado: 'pagado_sobre_autorizado', n: res.cnt('estado_variable', 'pagado_sobre_autorizado'), monto: res.sobre },
              { comp: 'estado_variable', estado: 'autorizado_no_pagado', n: res.cnt('estado_variable', 'autorizado_no_pagado'), monto: res.noPag },
              { comp: 'estado_variable', estado: 'pagado_bajo_autorizado', n: res.cnt('estado_variable', 'pagado_bajo_autorizado'), monto: 0 },
              { comp: 'estado_variable', estado: 'sin_valorizar', n: res.cnt('estado_variable', 'sin_valorizar'), monto: 0 },
            ]} />
          <Comp titulo="Pactadas"
            lineas={[['Pagado HH pactadas', fmt(res.pPac), true], ['Pactos vigentes registrados', String(delPeriodo.filter(r => r.pacto_horas_mes != null).length)]]}
            alertas={[
              { comp: 'estado_pactada', estado: 'pactada_sin_pacto', n: res.cnt('estado_pactada', 'pactada_sin_pacto'), monto: res.pacSinPacto },
              { comp: 'estado_pactada', estado: 'pacto_sin_pago', n: res.cnt('estado_pactada', 'pacto_sin_pago'), monto: 0 },
            ]} />
          <Comp titulo="Feriado"
            lineas={[['Días trabajados en feriado (Workera)', String(res.dFer)], ['Pagado día extra feriado', fmt(res.pFer), true]]}
            alertas={[
              { comp: 'estado_feriado', estado: 'feriado_sin_registro', n: res.cnt('estado_feriado', 'feriado_sin_registro'), monto: res.ferSinReg },
              { comp: 'estado_feriado', estado: 'feriado_no_pagado', n: res.cnt('estado_feriado', 'feriado_no_pagado'), monto: 0 },
            ]} />
        </div>
        {res.pSin > 0 && <div style={{ ...card, fontSize: 12.5, color: ROJO }}>Hay {fmt(res.pSin)} pagados en glosas de horas extra sin clasificar. Clasifícalas en Reglas y pactos.</div>}

        <DataGrid title={filtro ? `${EST[filtro.estado]?.l} · ${mesL(periodo)}` : `Detalle por trabajador · ${mesL(periodo)}`}
          exportName={`cuadratura_hhee_${periodo}`} columns={columnas} rows={visibles}
          getRowId={r => `${r.periodo}-${r.cod_contaline}`} loading={cargando} emptyText="Sin datos para este filtro"
          toolbar={filtro && <button style={{ ...btn, padding: '3px 9px', minHeight: 26 }} onClick={() => setFiltro(null)}>Quitar filtro</button>} />
      </>)}

      {vista === 'reglas' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>Clasificación de glosas de Contaline</div>
            <div style={{ fontSize: 12, color: SLATE, margin: '3px 0 10px' }}>Define contra qué se cuadra cada glosa. Marca "Confirmada" cuando Administración y Finanzas valide la regla.</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 620 }}>
                <thead><tr>{['Glosa', 'Nombre', 'Se cuadra como', 'Confirmada'].map(h => <th key={h} style={{ textAlign: 'left', fontSize: 11.5, color: SLATE, padding: '6px 8px', borderBottom: `1px solid ${BORDE}` }}>{h}</th>)}</tr></thead>
                <tbody>{glosas.map(g => (
                  <tr key={g.glosa_codigo}>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDE}`, fontVariantNumeric: 'tabular-nums' }}>{g.glosa_codigo}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDE}` }}>{g.nota}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDE}` }}>
                      <select value={g.clase} onChange={e => guardarGlosa(g, { clase: e.target.value, confirmado: false })} style={inp}>
                        {CLASES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select></td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDE}` }}>
                      <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
                        <input type="checkbox" checked={!!g.confirmado} onChange={e => guardarGlosa(g, { confirmado: e.target.checked })} />{g.confirmado ? 'Sí' : 'Pendiente'}
                      </label></td>
                  </tr>))}</tbody>
              </table>
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>Tolerancias</div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
              {params.map(p => (
                <label key={p.clave} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: SLATE, maxWidth: 260 }}>
                  <span>{p.nota}</span>
                  <input defaultValue={p.valor} onBlur={e => String(e.target.value) !== String(p.valor) && guardarParam(p, e.target.value)} style={{ ...inp, width: 140 }} inputMode="decimal" />
                </label>))}
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>Pactos de horas extra (Art. 32)</div>
            <div style={{ fontSize: 12, color: SLATE, margin: '3px 0 10px' }}>Registra los pactos escritos vigentes. Las HH pactadas pagadas sin un pacto vigente aparecen como alerta en la cuadratura.</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
              {[['cod_contaline', 'Código trabajador', 120, 'numeric'], ['horas_mes', 'Horas al mes', 100, 'decimal']].map(([k, l, w, im]) => (
                <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, color: SLATE }}>{l}
                  <input value={nuevoPacto[k]} onChange={e => setNuevoPacto(n => ({ ...n, [k]: e.target.value }))} style={{ ...inp, width: w }} inputMode={im} /></label>))}
              {[['desde', 'Desde'], ['hasta', 'Hasta']].map(([k, l]) => (
                <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, color: SLATE }}>{l}
                  <input type="date" value={nuevoPacto[k]} onChange={e => setNuevoPacto(n => ({ ...n, [k]: e.target.value }))} style={inp} /></label>))}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, color: SLATE }}>Documento
                <input value={nuevoPacto.documento} onChange={e => setNuevoPacto(n => ({ ...n, documento: e.target.value }))} placeholder="Ej.: anexo firmado 01-08-2026" style={{ ...inp, width: 220 }} /></label>
              <button style={btnPri} onClick={agregarPacto}>Registrar pacto</button>
            </div>
            {nuevoPacto.desde && nuevoPacto.hasta && meses(nuevoPacto.desde, nuevoPacto.hasta) > 3.05 &&
              <div style={{ fontSize: 12, color: AMBAR, marginBottom: 8 }}>El pacto supera 3 meses. El Art. 32 los define como temporales; revísalo con Gestión de Personas.</div>}
            <DataGrid title="Pactos vigentes" exportName="pactos_hhee" rows={pactos} getRowId={p => p.id}
              columns={[
                { key: 'cod_contaline', label: 'Código', width: 80, align: 'right' },
                { key: 'horas_mes', label: 'Horas/mes', width: 90, align: 'right' },
                { key: 'desde', label: 'Desde', width: 100 }, { key: 'hasta', label: 'Hasta', width: 100 },
                { key: 'documento', label: 'Documento', width: 240 }, { key: 'creado_por', label: 'Registrado por', width: 160 },
                { key: 'acc', label: '', width: 90, sortable: false, filterable: false, value: () => '', exportValue: () => '',
                  render: p => <button style={{ ...btn, padding: '3px 9px', minHeight: 26 }} onClick={() => anularPacto(p)}>Dar de baja</button> },
              ]} emptyText="Sin pactos registrados" />
          </div>
        </div>
      )}
    </div>
  )
}
