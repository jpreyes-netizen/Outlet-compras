// src/rrhh/asistencia/tabs/AsisHHEE.jsx  (v2 — sistema de validación)
// Horas Extraordinarias — validación explícita de jefatura + reporte
// · Cada jornada con minutos extra requiere decisión de jefatura
//   (autorizar / rechazar) con justificación obligatoria.
// · Reporte clasifica: Autorizada ≤ tope 2h · Autorizada con exceso ·
//   Rechazada · Pendiente (no autorizada).
// · RBAC: capability rrhh.asistencia.validar_hhee
//   (jefes de sucursal validan solo su sucursal vía scopeSuc).

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabase'
import { can } from '../../../core/permisos'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import 'jspdf-autotable'

const TOPE_MIN = 120   // tope 2 horas extraordinarias por día

const hoyISO = () => new Date().toISOString().slice(0,10)
const iniMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01` }
const fFecha = d => { if(!d) return '—'; const [y,m,dd]=String(d).slice(0,10).split('-'); return `${dd}-${m}-${y}` }
const fMin = m => { if(!m) return '0m'; const h=Math.floor(m/60), r=m%60; return h>0 ? (r>0?`${h}h ${r}m`:`${h}h`) : `${r}m` }

const CATS = {
  aut_tope:   { l:'Autorizada ≤ tope 2h',    c:'#34C759', ic:'✅' },
  aut_exceso: { l:'Autorizada con exceso',   c:'#FF9500', ic:'⚠️' },
  rechazada:  { l:'Rechazada',               c:'#FF3B30', ic:'⛔' },
  pendiente:  { l:'Pendiente (no autorizada)', c:'#8E8E93', ic:'○' },
}
const clasificar = (j, val) =>
  val?.decision === 'autorizada' ? (j.min_extra_dia <= TOPE_MIN ? 'aut_tope' : 'aut_exceso')
  : val?.decision === 'rechazada' ? 'rechazada'
  : 'pendiente'

// ── Ausencias ──
const AUS_CATS = {
  falta_injustificada: { l:'Falta injustificada', c:'#FF3B30', ic:'⛔', justificada:false },
  licencia_medica:     { l:'Licencia médica',     c:'#0A84FF', ic:'🏥', justificada:true  },
  permiso_con_goce:    { l:'Permiso con goce',     c:'#34C759', ic:'✅', justificada:true  },
  permiso_sin_goce:    { l:'Permiso sin goce',     c:'#FF9500', ic:'📄', justificada:true  },
}
// Estado en la cola: 'pendiente' (sin gestionar → cuenta como falta por defecto) o la clasificación
const clasificarAus = (a, ges) => ges?.clasificacion || 'pendiente'
const AUS_PEND = { l:'Pendiente (falta por defecto)', c:'#8E8E93', ic:'○' }

export function AsisHHEE({ cu, scopeSuc, initDominio, initCat }) {
  const [dominio, setDominio] = useState(initDominio || 'hhee')  // 'hhee' | 'ausencias'
  const [vista, setVista] = useState(initCat ? 'reporte' : 'validacion')
  const [fil, setFil] = useState({ desde: iniMes(), hasta: hoyISO(), sucursal: 'todas' })
  const [jornadas, setJornadas] = useState([])
  const [vals, setVals] = useState([])
  const [ausencias, setAusencias] = useState([])
  const [gestiones, setGestiones] = useState([])
  const [nomValidadores, setNomValidadores] = useState({})
  const [sucursales, setSucursales] = useState([])
  const [cargando, setCargando] = useState(true)
  const [puedeValidar, setPuedeValidar] = useState(false)
  const [puedeAusencia, setPuedeAusencia] = useState(false)
  const [msg, setMsg] = useState(null)
  const [sel, setSel] = useState(new Set())          // jornadas seleccionadas (key cod|fecha)
  const [modal, setModal] = useState(null)           // { tipo, decision, items }
  const [filtroCat, setFiltroCat] = useState(null)  // categoría activa al clickear un KPI

  useEffect(() => {
    supabase.from('sucursales').select('id,nombre').order('nombre').then(({data})=>setSucursales(data||[]))
    can(cu, 'rrhh', 'rrhh.asistencia.validar_hhee')
      .then(s => setPuedeValidar(s !== false && s != null))
      .catch(() => setPuedeValidar(['admin','dir_general','dir_finanzas'].includes(cu?.rol)))
    can(cu, 'rrhh', 'rrhh.asistencia.gestionar_ausencia')
      .then(s => setPuedeAusencia(s !== false && s != null))
      .catch(() => setPuedeAusencia(['admin','dir_general','dir_finanzas'].includes(cu?.rol)))
  }, [cu?.id])

  useEffect(() => {
    if (initDominio) setDominio(initDominio)
    if (initCat) { setVista('reporte'); setFiltroCat(initCat) }
  }, [initDominio, initCat])

  useEffect(() => { cargar() }, [fil, scopeSuc])
  async function cargar() {
    setCargando(true)
    try {
      let qJ = supabase.from('v_asis_jornadas')
        .select('cod_contaline,empleado,fecha,sucursal_nombre,estado_dia,min_extra_dia,workshift_name,entrada_real,salida_real')
        .gt('min_extra_dia', 0)
        .gte('fecha', fil.desde).lte('fecha', fil.hasta)
        .order('fecha', { ascending:false })
        .limit(20000)
      if (scopeSuc) qJ = qJ.eq('sucursal_nombre', scopeSuc)
      else if (fil.sucursal !== 'todas') qJ = qJ.eq('sucursal_nombre', fil.sucursal)

      const qV = supabase.from('asis_hhee_validaciones')
        .select('*').eq('activo', true)
        .gte('fecha', fil.desde).lte('fecha', fil.hasta)

      // Ausencias: sin_marcas con fecha < hoy (solo días cerrados)
      const ayer = new Date(); ayer.setDate(ayer.getDate()-1)
      const topeAus = ayer.toISOString().slice(0,10)
      let qA = supabase.from('v_asis_jornadas')
        .select('cod_contaline,empleado,fecha,sucursal_nombre,workshift_name')
        .eq('estado_dia','sin_marcas')
        .gte('fecha', fil.desde).lte('fecha', fil.hasta < topeAus ? fil.hasta : topeAus)
        .order('fecha',{ascending:false}).limit(20000)
      if (scopeSuc) qA = qA.eq('sucursal_nombre', scopeSuc)
      else if (fil.sucursal !== 'todas') qA = qA.eq('sucursal_nombre', fil.sucursal)

      const qG = supabase.from('asis_ausencias')
        .select('*').eq('activo', true)
        .gte('fecha', fil.desde).lte('fecha', fil.hasta)

      const [{ data: j, error: e1 }, { data: v, error: e2 },
             { data: a, error: e3 }, { data: g, error: e4 }] =
        await Promise.all([qJ, qV, qA, qG])
      if (e1) throw e1
      if (e2) throw e2
      if (e3) throw e3
      if (e4) throw e4
      setJornadas(j||[]); setVals(v||[]); setAusencias(a||[]); setGestiones(g||[]); setSel(new Set())

      const ids = [...new Set([...(v||[]).map(x=>x.validado_por), ...(g||[]).map(x=>x.gestionado_por)])]
      if (ids.length) {
        const { data: us } = await supabase.from('usuarios').select('id,nombre').in('id', ids)
        setNomValidadores(Object.fromEntries((us||[]).map(u=>[u.id,u.nombre])))
      }
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
    finally { setCargando(false) }
  }

  const valPor = useMemo(() => {
    const m = {}
    for (const v of vals) m[`${v.cod_contaline}|${v.fecha}`] = v
    return m
  }, [vals])

  const filas = useMemo(() => jornadas.map(j => {
    const val = valPor[`${j.cod_contaline}|${j.fecha}`] || null
    return { ...j, nombre: j.empleado, sucursal_id: j.sucursal_nombre,
      val, cat: clasificar(j, val), key: `${j.cod_contaline}|${j.fecha}` }
  }), [jornadas, valPor])

  const pendientes = useMemo(() => filas.filter(f=>f.cat==='pendiente'), [filas])

  const gesPor = useMemo(() => {
    const m = {}; for (const g of gestiones) m[`${g.cod_contaline}|${g.fecha}`] = g; return m
  }, [gestiones])
  const filasAus = useMemo(() => ausencias.map(a => {
    const ges = gesPor[`${a.cod_contaline}|${a.fecha}`] || null
    return { ...a, nombre: a.empleado, sucursal_id: a.sucursal_nombre,
      ges, cat: clasificarAus(a, ges), key:`${a.cod_contaline}|${a.fecha}` }
  }), [ausencias, gesPor])
  const ausPendientes = useMemo(() => filasAus.filter(f=>f.cat==='pendiente'), [filasAus])
  const kpisAus = useMemo(() => {
    const k = { pendiente:{n:filasAus.filter(f=>f.cat==='pendiente').length} }
    for (const c of Object.keys(AUS_CATS)) k[c] = { n: filasAus.filter(f=>f.cat===c).length }
    return k
  }, [filasAus])
  const kpis = useMemo(() => {
    const k = {}
    for (const c of Object.keys(CATS)) {
      const fs = filas.filter(f=>f.cat===c)
      k[c] = { n: fs.length, min: fs.reduce((s,f)=>s+f.min_extra_dia,0) }
    }
    return k
  }, [filas])

  async function decidir(items, decision, justificacion) {
    try {
      const payload = items.map(j => ({
        cod_contaline: j.cod_contaline, fecha: j.fecha,
        min_extra_snapshot: j.min_extra_dia,
        decision, justificacion, validado_por: cu.id,
      }))
      const { error } = await supabase.from('asis_hhee_validaciones').insert(payload)
      if (error) throw error
      setModal(null)
      setMsg({tipo:'ok', txt:`${items.length} jornada(s) ${decision === 'autorizada' ? 'autorizada(s)' : 'rechazada(s)'}`})
      await cargar()
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
  }

  async function anular(f) {
    if (!window.confirm(`¿Anular la validación de ${f.nombre} del ${fFecha(f.fecha)}? Volverá a estado pendiente.`)) return
    try {
      const { error } = await supabase.from('asis_hhee_validaciones')
        .update({ activo:false, anulado_por: cu.id, anulado_at: new Date().toISOString() })
        .eq('id', f.val.id)
      if (error) throw error
      await cargar()
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
  }

  const toggleSel = key => setSel(prev => { const n = new Set(prev); n.has(key)?n.delete(key):n.add(key); return n })
  const selItems = useMemo(() => pendientes.filter(p=>sel.has(p.key)), [pendientes, sel])
  const selAus   = useMemo(() => ausPendientes.filter(p=>sel.has(p.key)), [ausPendientes, sel])

  async function gestionarAus(items, clasificacion, justificacion) {
    try {
      const payload = items.map(a => ({
        cod_contaline: a.cod_contaline, fecha: a.fecha, workshift_name: a.workshift_name || null,
        clasificacion, justificacion, gestionado_por: cu.id,
      }))
      const { error } = await supabase.from('asis_ausencias').insert(payload)
      if (error) throw error
      setModal(null)
      setMsg({tipo:'ok', txt:`${items.length} ausencia(s) clasificada(s) como ${AUS_CATS[clasificacion].l}`})
      await cargar()
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
  }
  async function anularAus(f) {
    if (!window.confirm(`¿Anular la gestión de ${f.nombre} del ${fFecha(f.fecha)}? Volverá a falta pendiente.`)) return
    try {
      const { error } = await supabase.from('asis_ausencias')
        .update({ activo:false, anulado_por:cu.id, anulado_at:new Date().toISOString() }).eq('id', f.ges.id)
      if (error) throw error
      await cargar()
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
  }

  // ─── Exports del reporte ───
  function exportXLSX() {
    const resumen = resumenTrabajador(filas)
    const ws1 = XLSX.utils.json_to_sheet(resumen.map(r => ({
      Trabajador: r.nombre, Sucursal: r.sucursal_id,
      'Jornadas c/extra': r.n,
      'Aut. ≤2h (n)': r.aut_tope.n, 'Aut. ≤2h (min)': r.aut_tope.min,
      'Aut. exceso (n)': r.aut_exceso.n, 'Aut. exceso (min)': r.aut_exceso.min,
      'Rechazadas (n)': r.rechazada.n, 'Rechazadas (min)': r.rechazada.min,
      'Pendientes (n)': r.pendiente.n, 'Pendientes (min)': r.pendiente.min,
      'Total min autorizados': r.aut_tope.min + r.aut_exceso.min,
    })))
    const ws2 = XLSX.utils.json_to_sheet(filas.map(f => ({
      Fecha: f.fecha, Trabajador: f.nombre, Sucursal: f.sucursal_id, Turno: f.workshift_name || '',
      'Min extra': f.min_extra_dia, 'Categoría': CATS[f.cat].l,
      'Justificación': f.val?.justificacion || '', 'Validado por': f.val ? (nomValidadores[f.val.validado_por] || f.val.validado_por) : '',
      'Fecha validación': f.val?.validado_at?.slice(0,10) || '',
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws1, 'Resumen por trabajador')
    XLSX.utils.book_append_sheet(wb, ws2, 'Detalle jornadas')
    XLSX.writeFile(wb, `HHEE_validacion_${fil.desde}_${fil.hasta}.xlsx`)
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' })
    const azul = [26,26,46]
    doc.setFillColor(...azul); doc.rect(0,0,297,22,'F')
    doc.setTextColor(255,255,255); doc.setFontSize(12); doc.setFont(undefined,'bold')
    doc.text('REPORTE DE HORAS EXTRAORDINARIAS — VALIDACIÓN DE JEFATURA', 14, 10)
    doc.setFontSize(8); doc.setFont(undefined,'normal')
    doc.text(`Outlet de Puertas SpA · Período ${fFecha(fil.desde)} a ${fFecha(fil.hasta)}${scopeSuc?` · Sucursal ${scopeSuc}`:''} · Tope diario: 2h`, 14, 16)
    doc.setTextColor(0,0,0)

    doc.autoTable({ startY: 27, theme:'grid', headStyles:{fillColor:azul,fontSize:8.5}, styles:{fontSize:8.5},
      head: [['Categoría','Jornadas','Horas']],
      body: Object.entries(CATS).map(([k,c]) => [c.l, kpis[k].n, fMin(kpis[k].min)]) })

    doc.autoTable({ startY: doc.lastAutoTable.finalY + 4, theme:'grid',
      headStyles:{fillColor:azul,fontSize:8}, styles:{fontSize:7.5},
      head: [['Trabajador','Suc.','Jornadas','Aut ≤2h','Aut exceso','Rechazadas','Pendientes','Hrs autorizadas']],
      body: resumenTrabajador(filas).map(r => [
        r.nombre, r.sucursal_id, r.n,
        `${r.aut_tope.n} (${fMin(r.aut_tope.min)})`,
        `${r.aut_exceso.n} (${fMin(r.aut_exceso.min)})`,
        `${r.rechazada.n} (${fMin(r.rechazada.min)})`,
        `${r.pendiente.n} (${fMin(r.pendiente.min)})`,
        fMin(r.aut_tope.min + r.aut_exceso.min),
      ])})

    doc.autoTable({ startY: doc.lastAutoTable.finalY + 4, theme:'grid',
      headStyles:{fillColor:azul,fontSize:8}, styles:{fontSize:7},
      head: [['Fecha','Trabajador','Turno','Min extra','Categoría','Justificación','Validó']],
      body: filas.map(f => [
        fFecha(f.fecha), f.nombre, f.workshift_name||'', fMin(f.min_extra_dia),
        CATS[f.cat].l, f.val?.justificacion||'—',
        f.val ? (nomValidadores[f.val.validado_por]||f.val.validado_por) : '—',
      ])})

    doc.setFontSize(6.5); doc.setTextColor(120)
    doc.text('Generado por el ERP Outlet de Puertas · Las validaciones registran jefatura responsable, justificación y fecha. Tope de referencia: 2 horas extraordinarias por día.', 14, 205)
    doc.save(`HHEE_reporte_${fil.desde}_${fil.hasta}.pdf`)
  }

  function exportAusXLSX() {
    const ws = XLSX.utils.json_to_sheet(filasAus.map(f => ({
      Fecha:f.fecha, Trabajador:f.nombre, Sucursal:f.sucursal_id, Turno:f.workshift_name||'',
      Clasificación: f.cat==='pendiente' ? 'Pendiente (falta por defecto)' : AUS_CATS[f.cat].l,
      Justificada: f.cat==='pendiente' ? 'No' : (AUS_CATS[f.cat].justificada ? 'Sí' : 'No'),
      Justificación: f.ges?.justificacion||'', 'Gestionado por': f.ges?(nomValidadores[f.ges.gestionado_por]||f.ges.gestionado_por):'',
    })))
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Ausencias')
    XLSX.writeFile(wb, `ausencias_${fil.desde}_${fil.hasta}.xlsx`)
  }
  function exportAusPDF() {
    const doc = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' })
    const azul=[26,26,46]
    doc.setFillColor(...azul); doc.rect(0,0,297,22,'F')
    doc.setTextColor(255,255,255); doc.setFontSize(12); doc.setFont(undefined,'bold')
    doc.text('REPORTE DE AUSENCIAS', 14, 10)
    doc.setFontSize(8); doc.setFont(undefined,'normal')
    doc.text(`Outlet de Puertas SpA · Período ${fFecha(fil.desde)} a ${fFecha(fil.hasta)}${scopeSuc?` · Sucursal ${scopeSuc}`:''} · Ausencia = día con turno sin marcas`, 14, 16)
    doc.setTextColor(0,0,0)
    const cats = ['pendiente',...Object.keys(AUS_CATS)]
    const lbl = k => k==='pendiente'?AUS_PEND.l:AUS_CATS[k].l
    doc.autoTable({ startY:27, theme:'grid', headStyles:{fillColor:azul,fontSize:8.5}, styles:{fontSize:8.5},
      head:[['Clasificación','Días']], body: cats.map(k=>[lbl(k), (kpisAus[k]?.n||0)]) })
    doc.autoTable({ startY:doc.lastAutoTable.finalY+4, theme:'grid', headStyles:{fillColor:azul,fontSize:8}, styles:{fontSize:7.5},
      head:[['Trabajador','Suc.','Faltas injust.','Licencias','Perm. c/goce','Perm. s/goce','Pendientes','Total']],
      body: resumenAus(filasAus).map(r=>[r.nombre, r.sucursal_id, r.falta_injustificada, r.licencia_medica, r.permiso_con_goce, r.permiso_sin_goce, r.pendiente, r.n]) })
    doc.autoTable({ startY:doc.lastAutoTable.finalY+4, theme:'grid', headStyles:{fillColor:azul,fontSize:8}, styles:{fontSize:7},
      head:[['Fecha','Trabajador','Turno','Clasificación','Justificación','Gestionó']],
      body: filasAus.map(f=>[fFecha(f.fecha), f.nombre, f.workshift_name||'', f.cat==='pendiente'?AUS_PEND.l:AUS_CATS[f.cat].l, f.ges?.justificacion||'—', f.ges?(nomValidadores[f.ges.gestionado_por]||f.ges.gestionado_por):'—']) })
    doc.setFontSize(6.5); doc.setTextColor(120)
    doc.text('Generado por el ERP Outlet de Puertas · Las ausencias no gestionadas se contabilizan como falta injustificada por defecto.', 14, 205)
    doc.save(`ausencias_${fil.desde}_${fil.hasta}.pdf`)
  }

  return (
    <div>
      {/* Selector de dominio */}
      <div style={{display:'flex',gap:2,background:'var(--bg-app)',border:'1px solid var(--border)',borderRadius:10,padding:3,width:'fit-content',marginBottom:14}}>
        <button onClick={()=>{setDominio('hhee');setVista('validacion');setSel(new Set())}} style={{...tabB,padding:'8px 16px', ...(dominio==='hhee'?tabBOn:{})}}>
          ⏱ Horas extra {pendientes.length>0 && <B n={pendientes.length}/>}
        </button>
        <button onClick={()=>{setDominio('ausencias');setVista('validacion');setSel(new Set())}} style={{...tabB,padding:'8px 16px', ...(dominio==='ausencias'?tabBOn:{})}}>
          ⭕ Ausencias {ausPendientes.length>0 && <B n={ausPendientes.length} c='#FF3B30'/>}
        </button>
      </div>

      {/* Sub-tabs + filtros */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10,marginBottom:14}}>
        <div style={{display:'flex',gap:2,background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:10,padding:3}}>
          <button onClick={()=>{setVista('validacion');setFiltroCat(null)}} style={{...tabB, ...(vista==='validacion'?tabBOn:{})}}>
            ✅ Validación {(dominio==='hhee'?pendientes:ausPendientes).length>0 && <span style={{marginLeft:6,fontSize:10,fontWeight:800,padding:'1px 7px',borderRadius:100,background:'#FF950020',color:'#FF9500'}}>{(dominio==='hhee'?pendientes:ausPendientes).length}</span>}
          </button>
          <button onClick={()=>{setVista('reporte');setFiltroCat(null)}} style={{...tabB, ...(vista==='reporte'?tabBOn:{})}}>📊 Reporte</button>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <input type='date' value={fil.desde} onChange={e=>setFil(f=>({...f,desde:e.target.value}))} style={inp}/>
          <span style={{color:'var(--text-muted)',fontSize:12}}>→</span>
          <input type='date' value={fil.hasta} onChange={e=>setFil(f=>({...f,hasta:e.target.value}))} style={inp}/>
          {!scopeSuc && (
            <select value={fil.sucursal} onChange={e=>setFil(f=>({...f,sucursal:e.target.value}))} style={inp}>
              <option value='todas'>Todas las sucursales</option>
              {sucursales.map(s=><option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          )}
        </div>
      </div>

      {msg && (
        <div style={{marginBottom:12,padding:'9px 14px',borderRadius:8,fontSize:13,
          background: msg.tipo==='error'?'#FF3B3012':'#34C75912',
          border:`1px solid ${msg.tipo==='error'?'#FF3B3040':'#34C75940'}`,
          display:'flex',justifyContent:'space-between'}}>
          <span>{msg.tipo==='error'?'⚠️':'✅'} {msg.txt}</span>
          <button onClick={()=>setMsg(null)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)'}}>✕</button>
        </div>
      )}

      {/* KPIs — dependen del dominio */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:10,marginBottom:16}}>
        {dominio==='hhee' ? Object.entries(CATS).map(([k,c])=>(
          <button key={k} onClick={()=>{ setVista('reporte'); setFiltroCat(k) }}
            title="Ver estas jornadas en el reporte"
            style={{textAlign:'left',cursor:'pointer',background:'var(--bg-surface)',
              border:`1px solid ${filtroCat===k?c.c:`${c.c}35`}`,borderLeft:`4px solid ${c.c}`,borderRadius:10,padding:'10px 14px',
              boxShadow: filtroCat===k?`0 0 0 2px ${c.c}30`:'none',transition:'box-shadow .15s'}}>
            <div style={{fontSize:10.5,fontWeight:800,color:c.c,textTransform:'uppercase',letterSpacing:'0.04em'}}>{c.ic} {c.l}</div>
            <div style={{fontSize:22,fontWeight:800,marginTop:3}}>{kpis[k]?.n ?? 0}
              <span style={{fontSize:12,fontWeight:600,color:'var(--text-muted)',marginLeft:8}}>{fMin(kpis[k]?.min||0)}</span>
            </div>
            <div style={{fontSize:10,color:'var(--accent)',marginTop:3,fontWeight:600}}>Ver en reporte →</div>
          </button>
        )) : (
          [['pendiente',AUS_PEND],...Object.entries(AUS_CATS)].map(([k,c])=>(
            <button key={k} onClick={()=>{ setVista('reporte'); setFiltroCat(k) }}
              title="Ver estos días en el reporte"
              style={{textAlign:'left',cursor:'pointer',background:'var(--bg-surface)',
                border:`1px solid ${filtroCat===k?c.c:`${c.c}35`}`,borderLeft:`4px solid ${c.c}`,borderRadius:10,padding:'10px 14px',
                boxShadow: filtroCat===k?`0 0 0 2px ${c.c}30`:'none',transition:'box-shadow .15s'}}>
              <div style={{fontSize:10.5,fontWeight:800,color:c.c,textTransform:'uppercase',letterSpacing:'0.04em'}}>{c.ic} {c.l}</div>
              <div style={{fontSize:22,fontWeight:800,marginTop:3}}>{kpisAus[k]?.n ?? 0}<span style={{fontSize:12,fontWeight:600,color:'var(--text-muted)',marginLeft:6}}>días</span></div>
              <div style={{fontSize:10,color:'var(--accent)',marginTop:3,fontWeight:600}}>Ver en reporte →</div>
            </button>
          ))
        )}
      </div>

      {cargando ? <div style={{padding:50,textAlign:'center',color:'var(--text-muted)'}}>Cargando…</div> :
       dominio === 'hhee' ? (
         vista === 'validacion'
          ? <VistaValidacion filas={filas} pendientes={pendientes} puedeValidar={puedeValidar}
              sel={sel} toggleSel={toggleSel} selItems={selItems} setSel={setSel}
              onDecidir={(items,dec)=>setModal({ tipo:'hhee', decision:dec, items })}
              onAnular={anular} nomValidadores={nomValidadores}/>
          : <VistaReporte filas={filas} nomValidadores={nomValidadores} onXLSX={exportXLSX} onPDF={exportPDF} catInicial={filtroCat}/>
       ) : (
         vista === 'validacion'
          ? <VistaAusencias filas={filasAus} pendientes={ausPendientes} puede={puedeAusencia}
              sel={sel} toggleSel={toggleSel} selItems={selAus} setSel={setSel}
              onGestionar={(items)=>setModal({ tipo:'aus', items })}
              onAnular={anularAus} noms={nomValidadores}/>
          : <VistaReporteAus filas={filasAus} noms={nomValidadores} onXLSX={exportAusXLSX} onPDF={exportAusPDF} catInicial={filtroCat}/>
       )}

      {modal?.tipo==='hhee' && (
        <ModalJustificacion decision={modal.decision} items={modal.items}
          onCerrar={()=>setModal(null)}
          onConfirmar={just=>decidir(modal.items, modal.decision, just)}/>
      )}
      {modal?.tipo==='aus' && (
        <ModalAusencia items={modal.items}
          onCerrar={()=>setModal(null)}
          onConfirmar={(clasif,just)=>gestionarAus(modal.items, clasif, just)}/>
      )}
    </div>
  )
}

// ─── Vista: cola de validación ────────────────────────────────────────────────
function VistaValidacion({ filas, pendientes, puedeValidar, sel, toggleSel, selItems, setSel, onDecidir, onAnular, nomValidadores }) {
  const [verTodas, setVerTodas] = useState(false)
  const lista = verTodas ? filas : pendientes

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10,marginBottom:10}}>
        <label style={{fontSize:12.5,color:'var(--text-muted)',display:'flex',alignItems:'center',gap:6,cursor:'pointer'}}>
          <input type='checkbox' checked={verTodas} onChange={e=>setVerTodas(e.target.checked)}/>
          Ver también las ya validadas
        </label>
        {puedeValidar && selItems.length > 0 && (
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <span style={{fontSize:12.5,fontWeight:600}}>{selItems.length} seleccionada(s) · {fMin(selItems.reduce((s,i)=>s+i.min_extra_dia,0))}</span>
            <button onClick={()=>onDecidir(selItems,'autorizada')} style={{...btnPri,background:'#34C759'}}>✅ Autorizar</button>
            <button onClick={()=>onDecidir(selItems,'rechazada')} style={{...btnPri,background:'#FF3B30'}}>⛔ Rechazar</button>
          </div>
        )}
      </div>

      {!puedeValidar && (
        <div style={{marginBottom:10,padding:'8px 12px',borderRadius:8,fontSize:12,background:'var(--bg-surface)',border:'1px solid var(--border)',color:'var(--text-muted)'}}>
          👁 Modo consulta: no tienes la capability de validación de HHEE. Puedes revisar el estado y el reporte.
        </div>
      )}

      {lista.length === 0 ? (
        <div style={{padding:'40px 0',textAlign:'center'}}>
          <div style={{fontSize:40,marginBottom:8}}>🎉</div>
          <div style={{fontWeight:700}}>Sin horas extra pendientes de validación en el período</div>
        </div>
      ) : (
        <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5,minWidth:860}}>
            <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
              {puedeValidar && <th style={{...th,width:34}}>
                <input type='checkbox'
                  checked={pendientes.length>0 && selItems.length===pendientes.length}
                  onChange={e=>setSel(e.target.checked ? new Set(pendientes.map(p=>p.key)) : new Set())}/>
              </th>}
              {['Fecha','Trabajador','Sucursal','Turno','Salida real','Min extra','Estado',''].map(h=><th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {lista.map(f => {
                const cat = CATS[f.cat]
                const excede = f.min_extra_dia > TOPE_MIN
                return (
                  <tr key={f.key} style={{borderBottom:'1px solid var(--border)',background: sel.has(f.key)?'var(--bg-app)':'transparent'}}>
                    {puedeValidar && <td style={td}>
                      {f.cat==='pendiente' && <input type='checkbox' checked={sel.has(f.key)} onChange={()=>toggleSel(f.key)}/>}
                    </td>}
                    <td style={{...td,whiteSpace:'nowrap'}}>{fFecha(f.fecha)}</td>
                    <td style={{...td,fontWeight:600}}>{f.nombre}</td>
                    <td style={td}>{f.sucursal_id}</td>
                    <td style={{...td,fontSize:11.5,color:'var(--text-muted)'}}>{f.workshift_name||'—'}</td>
                    <td style={{...td,fontSize:11.5}}>{f.salida_real ? String(f.salida_real).slice(11,16) : '—'}</td>
                    <td style={td}>
                      <span style={{fontWeight:800,color:excede?'#FF3B30':'var(--text)'}}>{fMin(f.min_extra_dia)}</span>
                      {excede && <span style={{marginLeft:6,fontSize:9.5,fontWeight:800,padding:'2px 7px',borderRadius:100,background:'#FF3B3015',color:'#FF3B30'}}>SUPERA TOPE 2H</span>}
                    </td>
                    <td style={td}>
                      <span style={{fontSize:10.5,fontWeight:800,color:cat.c}}>{cat.ic} {cat.l}</span>
                      {f.val && (
                        <div style={{fontSize:10,color:'var(--text-muted)',marginTop:2}}>
                          {nomValidadores[f.val.validado_por]||f.val.validado_por} · {fFecha(f.val.validado_at)}
                          <div style={{fontStyle:'italic'}}>"{f.val.justificacion}"</div>
                        </div>
                      )}
                    </td>
                    <td style={{...td,textAlign:'right',whiteSpace:'nowrap'}}>
                      {puedeValidar && f.cat==='pendiente' && (
                        <>
                          <button onClick={()=>onDecidir([f],'autorizada')} title='Autorizar' style={{...btnMini,color:'#34C759',borderColor:'#34C75940'}}>✅</button>
                          <button onClick={()=>onDecidir([f],'rechazada')} title='Rechazar' style={{...btnMini,color:'#FF3B30',borderColor:'#FF3B3040'}}>⛔</button>
                        </>
                      )}
                      {puedeValidar && f.val && (
                        <button onClick={()=>onAnular(f)} title='Anular validación (vuelve a pendiente)' style={btnMini}>↩️</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Vista: reporte clasificado ───────────────────────────────────────────────
function resumenTrabajador(filas) {
  const m = {}
  for (const f of filas) {
    const r = (m[f.cod_contaline] ??= { nombre:f.nombre, sucursal_id:f.sucursal_id, n:0,
      aut_tope:{n:0,min:0}, aut_exceso:{n:0,min:0}, rechazada:{n:0,min:0}, pendiente:{n:0,min:0} })
    r.n++
    r[f.cat].n++; r[f.cat].min += f.min_extra_dia
  }
  return Object.values(m).sort((a,b)=> (b.aut_tope.min+b.aut_exceso.min) - (a.aut_tope.min+a.aut_exceso.min))
}

function VistaReporte({ filas, nomValidadores, onXLSX, onPDF, catInicial }) {
  const [fCat, setFCat] = useState(catInicial || 'todas')
  useEffect(()=>{ if(catInicial) setFCat(catInicial) }, [catInicial])
  const resumen = useMemo(()=>resumenTrabajador(filas),[filas])
  const detalle = useMemo(()=> fCat==='todas' ? filas : filas.filter(f=>f.cat===fCat), [filas,fCat])
  const totalMin = filas.reduce((s,f)=>s+f.min_extra_dia,0)

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10,marginBottom:12}}>
        {/* Distribución */}
        <div style={{flex:1,minWidth:260,maxWidth:520}}>
          <div style={{display:'flex',height:12,borderRadius:100,overflow:'hidden'}}>
            {Object.entries(CATS).map(([k,c])=>{
              const min = filas.filter(f=>f.cat===k).reduce((s,f)=>s+f.min_extra_dia,0)
              return min>0 ? <span key={k} title={`${c.l}: ${fMin(min)}`} style={{width:`${min/Math.max(totalMin,1)*100}%`,background:c.c}}/> : null
            })}
          </div>
          <div style={{fontSize:10.5,color:'var(--text-muted)',marginTop:4}}>Distribución de {fMin(totalMin)} extra del período por categoría</div>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={onXLSX} style={btnSec}>⬇️ XLSX</button>
          <button onClick={onPDF} style={btnSec}>⬇️ PDF</button>
        </div>
      </div>

      {/* Resumen por trabajador */}
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'auto',marginBottom:16}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5,minWidth:860}}>
          <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
            {['Trabajador','Sucursal','Jornadas c/extra','✅ Aut ≤2h','⚠️ Aut exceso','⛔ Rechazadas','○ Pendientes','Hrs autorizadas'].map(h=><th key={h} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {resumen.map(r=>(
              <tr key={r.nombre} style={{borderBottom:'1px solid var(--border)'}}>
                <td style={{...td,fontWeight:600}}>{r.nombre}</td>
                <td style={td}>{r.sucursal_id}</td>
                <td style={{...td,textAlign:'center'}}>{r.n}</td>
                <td style={{...td,color:'#34C759',fontWeight:600}}>{r.aut_tope.n>0?`${r.aut_tope.n} · ${fMin(r.aut_tope.min)}`:'—'}</td>
                <td style={{...td,color:'#FF9500',fontWeight:600}}>{r.aut_exceso.n>0?`${r.aut_exceso.n} · ${fMin(r.aut_exceso.min)}`:'—'}</td>
                <td style={{...td,color:'#FF3B30'}}>{r.rechazada.n>0?`${r.rechazada.n} · ${fMin(r.rechazada.min)}`:'—'}</td>
                <td style={{...td,color:'var(--text-muted)'}}>{r.pendiente.n>0?`${r.pendiente.n} · ${fMin(r.pendiente.min)}`:'—'}</td>
                <td style={{...td,fontWeight:800}}>{fMin(r.aut_tope.min + r.aut_exceso.min)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detalle */}
      <div style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap'}}>
        <button onClick={()=>setFCat('todas')} style={{...chip, ...(fCat==='todas'?chipOn:{})}}>Todas ({filas.length})</button>
        {Object.entries(CATS).map(([k,c])=>(
          <button key={k} onClick={()=>setFCat(k)}
            style={{...chip, ...(fCat===k?{background:`${c.c}18`,color:c.c,borderColor:c.c}:{})}}>
            {c.ic} {c.l} ({filas.filter(f=>f.cat===k).length})
          </button>
        ))}
      </div>
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,minWidth:860}}>
          <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
            {['Fecha','Trabajador','Sucursal','Min extra','Categoría','Justificación','Validó'].map(h=><th key={h} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {detalle.map(f=>(
              <tr key={f.key} style={{borderBottom:'1px solid var(--border)'}}>
                <td style={{...td,whiteSpace:'nowrap'}}>{fFecha(f.fecha)}</td>
                <td style={{...td,fontWeight:600}}>{f.nombre}</td>
                <td style={td}>{f.sucursal_id}</td>
                <td style={{...td,fontWeight:700,color:f.min_extra_dia>TOPE_MIN?'#FF3B30':'var(--text)'}}>{fMin(f.min_extra_dia)}</td>
                <td style={td}><span style={{fontSize:10.5,fontWeight:800,color:CATS[f.cat].c}}>{CATS[f.cat].ic} {CATS[f.cat].l}</span></td>
                <td style={{...td,fontSize:11,fontStyle:f.val?'italic':'normal',color:f.val?'var(--text)':'var(--text-muted)'}}>{f.val?.justificacion||'—'}</td>
                <td style={{...td,fontSize:11,color:'var(--text-muted)'}}>{f.val?(nomValidadores[f.val.validado_por]||f.val.validado_por):'—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Modal de justificación ───────────────────────────────────────────────────
function ModalJustificacion({ decision, items, onCerrar, onConfirmar }) {
  const [just, setJust] = useState('')
  const [enviando, setEnviando] = useState(false)
  const aut = decision === 'autorizada'
  const totalMin = items.reduce((s,i)=>s+i.min_extra_dia,0)
  const conExceso = items.filter(i=>i.min_extra_dia>TOPE_MIN).length
  const ok = just.trim().length >= 15

  return (
    <div onClick={onCerrar} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'var(--bg-surface)',borderRadius:14,padding:22,width:'100%',maxWidth:480,border:'1px solid var(--border)'}}>
        <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>
          {aut ? '✅ Autorizar horas extra' : '⛔ Rechazar horas extra'}
        </div>
        <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:12}}>
          {items.length === 1
            ? <>{items[0].nombre} · {fFecha(items[0].fecha)} · <strong>{fMin(items[0].min_extra_dia)}</strong></>
            : <>{items.length} jornadas · {fMin(totalMin)} en total</>}
          {conExceso > 0 && <span style={{color:'#FF3B30',fontWeight:700}}> · {conExceso} supera(n) el tope de 2h diarias</span>}
        </div>
        {items.length > 1 && (
          <div style={{maxHeight:120,overflowY:'auto',fontSize:11.5,background:'var(--bg-app)',borderRadius:8,padding:'8px 11px',marginBottom:10}}>
            {items.map(i=>(
              <div key={i.key} style={{display:'flex',justifyContent:'space-between',padding:'2px 0'}}>
                <span>{i.nombre} · {fFecha(i.fecha)}</span>
                <strong style={{color:i.min_extra_dia>TOPE_MIN?'#FF3B30':'var(--text)'}}>{fMin(i.min_extra_dia)}</strong>
              </div>
            ))}
          </div>
        )}
        <label style={{display:'block',fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:4}}>
          Justificación obligatoria {aut ? '(motivo operacional de las horas extra)' : '(motivo del rechazo)'}
        </label>
        <textarea autoFocus value={just} onChange={e=>setJust(e.target.value)} rows={3}
          placeholder={aut ? 'Ej: Recepción de contenedor programada; se requirió apoyo en descarga hasta las 20:30...' : 'Ej: No hubo requerimiento operacional; permanencia no solicitada por jefatura...'}
          style={{width:'100%',boxSizing:'border-box',padding:'8px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:13,background:'var(--bg-app)',color:'var(--text)',fontFamily:'inherit',resize:'vertical'}}/>
        <div style={{fontSize:10.5,marginTop:3,color: ok ? '#34C759' : 'var(--text-muted)'}}>{just.trim().length}/15 caracteres mínimos</div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:14}}>
          <button onClick={onCerrar} disabled={enviando} style={btnSec}>Cancelar</button>
          <button disabled={!ok || enviando}
            onClick={async()=>{ setEnviando(true); await onConfirmar(just.trim()) }}
            style={{...btnPri,background:aut?'#34C759':'#FF3B30',opacity:(!ok||enviando)?0.5:1}}>
            {enviando ? 'Guardando...' : aut ? `Autorizar ${items.length>1?`(${items.length})`:''}` : `Rechazar ${items.length>1?`(${items.length})`:''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Badge de conteo ──────────────────────────────────────────────────────────
function B({ n, c='#FF9500' }) {
  return <span style={{marginLeft:6,fontSize:10,fontWeight:800,padding:'1px 7px',borderRadius:100,background:`${c}20`,color:c}}>{n}</span>
}

// ─── Vista: cola de ausencias ─────────────────────────────────────────────────
function VistaAusencias({ filas, pendientes, puede, sel, toggleSel, selItems, setSel, onGestionar, onAnular, noms }) {
  const [verTodas, setVerTodas] = useState(false)
  const lista = verTodas ? filas : pendientes
  return (
    <div>
      <div style={{marginBottom:10,padding:'8px 12px',borderRadius:8,fontSize:12,background:'#FF3B3008',border:'1px solid #FF3B3030',color:'var(--text)'}}>
        ⛔ Una ausencia es un día con turno asignado y <strong>cero marcas</strong> (solo días ya cerrados). Mientras no se gestione, <strong>se contabiliza como falta injustificada</strong>.
      </div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10,marginBottom:10}}>
        <label style={{fontSize:12.5,color:'var(--text-muted)',display:'flex',alignItems:'center',gap:6,cursor:'pointer'}}>
          <input type='checkbox' checked={verTodas} onChange={e=>setVerTodas(e.target.checked)}/>
          Ver también las ya gestionadas
        </label>
        {puede && selItems.length>0 && (
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <span style={{fontSize:12.5,fontWeight:600}}>{selItems.length} seleccionada(s)</span>
            <button onClick={()=>onGestionar(selItems)} style={btnPri}>Clasificar seleccionadas</button>
          </div>
        )}
      </div>
      {!puede && (
        <div style={{marginBottom:10,padding:'8px 12px',borderRadius:8,fontSize:12,background:'var(--bg-surface)',border:'1px solid var(--border)',color:'var(--text-muted)'}}>
          👁 Modo consulta: no tienes la capability de gestión de ausencias.
        </div>
      )}
      {lista.length===0 ? (
        <div style={{padding:'40px 0',textAlign:'center'}}>
          <div style={{fontSize:40,marginBottom:8}}>🎉</div>
          <div style={{fontWeight:700}}>Sin ausencias pendientes de gestionar en el período</div>
        </div>
      ) : (
        <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5,minWidth:820}}>
            <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
              {puede && <th style={{...th,width:34}}>
                <input type='checkbox' checked={pendientes.length>0 && selItems.length===pendientes.length}
                  onChange={e=>setSel(e.target.checked ? new Set(pendientes.map(p=>p.key)) : new Set())}/>
              </th>}
              {['Fecha','Trabajador','Sucursal','Turno esperado','Estado',''].map(h=><th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {lista.map(f=>{
                const cat = f.cat==='pendiente' ? AUS_PEND : AUS_CATS[f.cat]
                return (
                  <tr key={f.key} style={{borderBottom:'1px solid var(--border)',background:sel.has(f.key)?'var(--bg-app)':'transparent'}}>
                    {puede && <td style={td}>{f.cat==='pendiente' && <input type='checkbox' checked={sel.has(f.key)} onChange={()=>toggleSel(f.key)}/>}</td>}
                    <td style={{...td,whiteSpace:'nowrap'}}>{fFecha(f.fecha)}</td>
                    <td style={{...td,fontWeight:600}}>{f.nombre}</td>
                    <td style={td}>{f.sucursal_id}</td>
                    <td style={{...td,fontSize:11.5,color:'var(--text-muted)'}}>{f.workshift_name||'—'}</td>
                    <td style={td}>
                      <span style={{fontSize:10.5,fontWeight:800,color:cat.c}}>{cat.ic} {cat.l}</span>
                      {f.ges && (
                        <div style={{fontSize:10,color:'var(--text-muted)',marginTop:2}}>
                          {noms[f.ges.gestionado_por]||f.ges.gestionado_por} · {fFecha(f.ges.gestionado_at)}
                          <div style={{fontStyle:'italic'}}>"{f.ges.justificacion}"</div>
                        </div>
                      )}
                    </td>
                    <td style={{...td,textAlign:'right',whiteSpace:'nowrap'}}>
                      {puede && f.cat==='pendiente' && <button onClick={()=>onGestionar([f])} style={btnMini}>Clasificar</button>}
                      {puede && f.ges && <button onClick={()=>onAnular(f)} title='Anular (vuelve a falta pendiente)' style={btnMini}>↩️</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Reporte de ausencias ─────────────────────────────────────────────────────
function resumenAus(filas) {
  const m = {}
  for (const f of filas) {
    const r = (m[f.cod_contaline] ??= { nombre:f.nombre, sucursal_id:f.sucursal_id, n:0,
      pendiente:0, falta_injustificada:0, licencia_medica:0, permiso_con_goce:0, permiso_sin_goce:0 })
    r.n++; r[f.cat]++
  }
  // faltas efectivas = pendientes (falta por defecto) + faltas injustificadas
  return Object.values(m).sort((a,b)=> (b.pendiente+b.falta_injustificada)-(a.pendiente+a.falta_injustificada))
}
function VistaReporteAus({ filas, noms, onXLSX, onPDF, catInicial }) {
  const [fCat, setFCat] = useState(catInicial || 'todas')
  useEffect(()=>{ if(catInicial) setFCat(catInicial) }, [catInicial])
  const resumen = useMemo(()=>resumenAus(filas),[filas])
  const detalle = useMemo(()=> fCat==='todas'?filas:filas.filter(f=>f.cat===fCat),[filas,fCat])
  const totalDias = filas.length
  const chip = {padding:'5px 12px',borderRadius:100,border:'1px solid var(--border)',background:'transparent',color:'var(--text-muted)',fontSize:11.5,fontWeight:600,cursor:'pointer'}
  const chipOn = {background:'var(--bg-app)',color:'var(--text)',borderColor:'var(--text-muted)'}
  const catLabel = k => k==='pendiente'?AUS_PEND:AUS_CATS[k]
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10,marginBottom:12}}>
        <div style={{flex:1,minWidth:260,maxWidth:520}}>
          <div style={{display:'flex',height:12,borderRadius:100,overflow:'hidden'}}>
            {[['pendiente',AUS_PEND],...Object.entries(AUS_CATS)].map(([k,c])=>{
              const n = filas.filter(f=>f.cat===k).length
              return n>0 ? <span key={k} title={`${c.l}: ${n}`} style={{width:`${n/Math.max(totalDias,1)*100}%`,background:c.c}}/> : null
            })}
          </div>
          <div style={{fontSize:10.5,color:'var(--text-muted)',marginTop:4}}>Distribución de {totalDias} día(s) de ausencia del período</div>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={onXLSX} style={btnSec}>⬇️ XLSX</button>
          <button onClick={onPDF} style={btnSec}>⬇️ PDF</button>
        </div>
      </div>
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'auto',marginBottom:16}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5,minWidth:820}}>
          <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
            {['Trabajador','Sucursal','○ Pendientes','⛔ Faltas injust.','🏥 Licencias','✅ Perm. c/goce','📄 Perm. s/goce','Total días'].map(h=><th key={h} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {resumen.map(r=>(
              <tr key={r.nombre} style={{borderBottom:'1px solid var(--border)'}}>
                <td style={{...td,fontWeight:600}}>{r.nombre}</td>
                <td style={td}>{r.sucursal_id}</td>
                <td style={{...td,color:'#8E8E93',fontWeight:600}}>{r.pendiente||'—'}</td>
                <td style={{...td,color:'#FF3B30',fontWeight:700}}>{r.falta_injustificada||'—'}</td>
                <td style={{...td,color:'#0A84FF'}}>{r.licencia_medica||'—'}</td>
                <td style={{...td,color:'#34C759'}}>{r.permiso_con_goce||'—'}</td>
                <td style={{...td,color:'#FF9500'}}>{r.permiso_sin_goce||'—'}</td>
                <td style={{...td,fontWeight:800}}>{r.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap'}}>
        <button onClick={()=>setFCat('todas')} style={{...chip, ...(fCat==='todas'?chipOn:{})}}>Todas ({filas.length})</button>
        {[['pendiente',AUS_PEND],...Object.entries(AUS_CATS)].map(([k,c])=>(
          <button key={k} onClick={()=>setFCat(k)} style={{...chip, ...(fCat===k?{background:`${c.c}18`,color:c.c,borderColor:c.c}:{})}}>{c.ic} {c.l} ({filas.filter(f=>f.cat===k).length})</button>
        ))}
      </div>
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,minWidth:820}}>
          <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
            {['Fecha','Trabajador','Sucursal','Turno','Clasificación','Justificación','Gestionó'].map(h=><th key={h} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {detalle.map(f=>{
              const c = catLabel(f.cat)
              return (
                <tr key={f.key} style={{borderBottom:'1px solid var(--border)'}}>
                  <td style={{...td,whiteSpace:'nowrap'}}>{fFecha(f.fecha)}</td>
                  <td style={{...td,fontWeight:600}}>{f.nombre}</td>
                  <td style={td}>{f.sucursal_id}</td>
                  <td style={{...td,fontSize:11.5,color:'var(--text-muted)'}}>{f.workshift_name||'—'}</td>
                  <td style={td}><span style={{fontSize:10.5,fontWeight:800,color:c.c}}>{c.ic} {c.l}</span></td>
                  <td style={{...td,fontSize:11,fontStyle:f.ges?'italic':'normal',color:f.ges?'var(--text)':'var(--text-muted)'}}>{f.ges?.justificacion||'—'}</td>
                  <td style={{...td,fontSize:11,color:'var(--text-muted)'}}>{f.ges?(noms[f.ges.gestionado_por]||f.ges.gestionado_por):'—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Modal de clasificación de ausencia ───────────────────────────────────────
function ModalAusencia({ items, onCerrar, onConfirmar }) {
  const [clasif, setClasif] = useState(null)
  const [just, setJust] = useState('')
  const [enviando, setEnviando] = useState(false)
  const ok = clasif && just.trim().length >= 10
  return (
    <div onClick={onCerrar} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'var(--bg-surface)',borderRadius:14,padding:22,width:'100%',maxWidth:480,border:'1px solid var(--border)',maxHeight:'88vh',overflowY:'auto'}}>
        <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>Clasificar ausencia</div>
        <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:12}}>
          {items.length===1 ? <>{items[0].nombre} · {fFecha(items[0].fecha)}</> : <>{items.length} ausencias seleccionadas</>}
        </div>
        {items.length>1 && (
          <div style={{maxHeight:110,overflowY:'auto',fontSize:11.5,background:'var(--bg-app)',borderRadius:8,padding:'8px 11px',marginBottom:10}}>
            {items.map(i=><div key={i.key} style={{padding:'2px 0'}}>{i.nombre} · {fFecha(i.fecha)}</div>)}
          </div>
        )}
        <div style={{display:'grid',gap:7,marginBottom:12}}>
          {Object.entries(AUS_CATS).map(([k,c])=>(
            <button key={k} onClick={()=>setClasif(k)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',borderRadius:10,cursor:'pointer',textAlign:'left',
              background: clasif===k?`${c.c}14`:'var(--bg-app)', border:`1.5px solid ${clasif===k?c.c:'var(--border)'}`}}>
              <span style={{fontSize:16}}>{c.ic}</span>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:clasif===k?c.c:'var(--text)'}}>{c.l}</div>
                <div style={{fontSize:10.5,color:'var(--text-muted)'}}>{c.justificada?'Ausencia justificada':'Cuenta como falta'}</div>
              </div>
            </button>
          ))}
        </div>
        <label style={{display:'block',fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:4}}>Justificación / respaldo obligatorio</label>
        <textarea autoFocus value={just} onChange={e=>setJust(e.target.value)} rows={3}
          placeholder='Ej: Presentó licencia médica folio 12345 por 3 días / Permiso avisado con 48h / No avisó ni justificó...'
          style={{width:'100%',boxSizing:'border-box',padding:'8px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:13,background:'var(--bg-app)',color:'var(--text)',fontFamily:'inherit',resize:'vertical'}}/>
        <div style={{fontSize:10.5,marginTop:3,color:ok?'#34C759':'var(--text-muted)'}}>{just.trim().length}/10 caracteres mínimos</div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:14}}>
          <button onClick={onCerrar} disabled={enviando} style={btnSec}>Cancelar</button>
          <button disabled={!ok||enviando} onClick={async()=>{setEnviando(true); await onConfirmar(clasif, just.trim())}}
            style={{...btnPri,opacity:(!ok||enviando)?0.5:1}}>{enviando?'Guardando...':`Clasificar ${items.length>1?`(${items.length})`:''}`}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const th = {padding:'9px 12px',textAlign:'left',fontSize:10.5,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'}
const td = {padding:'8px 12px',verticalAlign:'top'}
const inp = {padding:'7px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:12.5,background:'var(--bg-surface)',color:'var(--text)',fontFamily:'inherit'}
const btnPri = {padding:'7px 14px',background:'var(--accent)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:12.5,fontWeight:700}
const btnSec = {padding:'7px 12px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:12.5,fontWeight:500}
const btnMini = {padding:'4px 8px',background:'transparent',border:'1px solid var(--border)',borderRadius:7,cursor:'pointer',fontSize:12,marginLeft:4}
const tabB = {padding:'7px 14px',borderRadius:8,border:'none',background:'transparent',color:'var(--text-muted)',fontSize:12.5,fontWeight:600,cursor:'pointer'}
const tabBOn = {background:'var(--bg-app)',color:'var(--text)',boxShadow:'inset 0 0 0 1px var(--border)'}
const chip = {padding:'5px 12px',borderRadius:100,border:'1px solid var(--border)',background:'transparent',color:'var(--text-muted)',fontSize:11.5,fontWeight:600,cursor:'pointer'}
const chipOn = {background:'var(--bg-app)',color:'var(--text)',borderColor:'var(--text-muted)'}
