// src/rrhh/asistencia/tabs/AsisFicha.jsx
// Ficha de asistencia de un trabajador — panel lateral sobre la vista actual.
//
// v2 (27-11-2026): la ficha muestra la misma vista gráfica que el perfil
// unificado del Maestro de dotación (AsistenciaTrabajador): estado actual de las
// validaciones, indicadores y calendario día a día. Antes tenía su propio
// calendario con su propio cálculo (contaba como horas extra solo la salida y
// no usaba la tolerancia de atraso). Una sola vista, un solo criterio.
// Quien es de Gestión de Personas puede saltar desde acá al perfil completo.
import { useState, useEffect } from 'react'
import { supabase } from '../../../supabase'
import { AsistenciaTrabajador } from '../AsistenciaTrabajador'

export function AsisFicha({ cod, nombre, onCerrar }) {
  const [ficha, setFicha] = useState(null)
  useEffect(() => {
    let vivo = true
    supabase.from('rrhh_empleados').select('cargo,fecha_ingreso,activo').eq('cod_contaline', cod).maybeSingle()
      .then(r => { if (vivo) setFicha(r.data || null) }, () => {})
    return () => { vivo = false }
  }, [cod])
  // Cerrar con Escape: en un panel superpuesto es lo que la gente intenta.
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onCerrar?.() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onCerrar])

  const abrirPerfil = () => { window.dispatchEvent(new CustomEvent('rrhh:perfil', { detail: { cod } })); onCerrar?.() }
  const ir = sub => { window.dispatchEvent(new CustomEvent('rrhh:ir', { detail: { hoja: 'asistencia', sub } })); onCerrar?.() }

  return (
    <>
      <div onClick={onCerrar} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.32)',zIndex:200}}/>
      <aside role="dialog" aria-label={`Ficha de asistencia de ${nombre}`} style={{
        position:'fixed',top:0,right:0,bottom:0,width:'min(860px,100vw)',zIndex:201,
        background:'var(--bg-app)',borderLeft:'1px solid var(--border)',
        boxShadow:'-10px 0 34px rgba(0,0,0,.14)',display:'flex',flexDirection:'column'}}>
        <header style={{padding:'15px 20px',borderBottom:'1px solid var(--border)',
          background:'var(--bg-surface)',display:'flex',alignItems:'flex-start',
          justifyContent:'space-between',gap:14}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:17,fontWeight:650,letterSpacing:'-.01em'}}>{nombre}</div>
            <div style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>
              {ficha?.cargo || 'Sin cargo registrado'}{ficha && ficha.activo === false ? ' · egresado' : ''} · Asistencia día a día
            </div>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar ficha" style={{padding:'6px 12px',background:'var(--bg-card)',color:'var(--text)',
            border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:12.5,fontWeight:600}}>Cerrar</button>
        </header>
        <div style={{flex:1,overflowY:'auto',padding:'16px 20px'}}>
          <AsistenciaTrabajador cod={cod} onAbrirPerfil={abrirPerfil} onIr={ir}/>
        </div>
      </aside>
    </>
  )
}
