// src/rrhh/asistencia/tabs/AsisAcuse.jsx
// Acuse de recibo de una alerta de asistencia, con el historial de reincidencia
// del trabajador a la vista.
//
// Por qué existe: validar una ausencia cierra el trámite del día, pero no deja
// registro de qué hizo la jefatura al respecto. Sin eso nadie puede responder
// la pregunta que importa cuando una conducta se repite: "¿cuántas veces ya
// conversamos esto?". Acá la jefatura declara qué acción tomó, y el panel le
// muestra de inmediato si es la primera vez o la quinta.
//
// El acuse no reemplaza la justificación de la ausencia: son cosas distintas.
// Justificar dice por qué faltó; el acuse dice qué se hizo al respecto.

import { useState, useEffect } from 'react'
import { supabase } from '../../../supabase'

const NUM = { fontVariantNumeric:'tabular-nums' }
const fFecha = iso => { const [y,m,d] = String(iso).slice(0,10).split('-'); return `${d}-${m}-${y}` }

const TIPOS = {
  sin_marcas:  'No marcó en todo el día',
  sin_entrada: 'No marcó la entrada',
  sin_salida:  'No marcó la salida',
  atraso:      'Atraso',
  hhee_exceso: 'Horas extra sobre el tope legal',
}

// Escala de gestión. Va de menor a mayor y el panel sugiere el siguiente paso
// cuando la conducta se repite; la decisión sigue siendo de la jefatura.
const ACCIONES = [
  { k:'registrado',           l:'Solo dejar constancia',  d:'Queda el registro, sin acción con el trabajador.' },
  { k:'justificado',          l:'Tenía justificación',    d:'Hubo una razón válida; no corresponde medida.' },
  { k:'conversado',           l:'Conversado',             d:'Se habló con el trabajador para corregir.' },
  { k:'amonestacion_verbal',  l:'Amonestación verbal',    d:'Llamado de atención formal, sin documento.' },
  { k:'amonestacion_escrita', l:'Amonestación escrita',   d:'Queda en la carpeta del trabajador.' },
]

export function AsisAcuse({ cu, cod, nombre, fecha, tipoAlerta, onCerrar, onListo }) {
  const [hist, setHist]   = useState(null)
  const [accion, setAccion] = useState('registrado')
  const [obs, setObs]     = useState('')
  const [guardando, setG] = useState(false)
  const [err, setErr]     = useState(null)

  useEffect(() => { cargar() }, [cod, tipoAlerta])
  useEffect(() => {
    const h = e => { if (e.key === 'Escape' && !guardando) onCerrar?.() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onCerrar, guardando])

  async function cargar() {
    try {
      const [acu, nom] = await Promise.all([
        supabase.from('asis_acuses_alerta')
          .select('fecha,tipo_alerta,accion,observacion,acusado_por,acusado_at')
          .eq('cod_contaline', cod).eq('activo', true)
          .order('fecha', { ascending:false }).limit(50),
        supabase.from('usuarios').select('id,nombre').limit(500),
      ])
      const nombres = {}; for (const u of (nom.data || [])) nombres[u.id] = u.nombre
      setHist({ filas: acu.data || [], nombres })
    } catch (e) { setErr(e.message) }
  }

  // Reincidencia del MISMO tipo de alerta: es lo que indica si la conducta
  // se corrigió o no. Otros tipos se muestran aparte como contexto.
  const mismos = (hist?.filas || []).filter(f => f.tipo_alerta === tipoAlerta)
  const d60 = (() => { const d = new Date(); d.setDate(d.getDate()-60); return d.toISOString().slice(0,10) })()
  const en60 = mismos.filter(f => f.fecha >= d60)
  const conEscrita = mismos.some(f => f.accion === 'amonestacion_escrita')
  const yaAcusado = mismos.find(f => String(f.fecha).slice(0,10) === String(fecha).slice(0,10))

  // Sugerencia de siguiente paso, solo cuando hay patrón. No decide por la
  // jefatura: le muestra lo que ya ocurrió para que decida informada.
  useEffect(() => {
    if (!hist) return
    if (en60.length >= 3 && !conEscrita) setAccion('amonestacion_escrita')
    else if (en60.length >= 1) setAccion('conversado')
  }, [hist])

  async function guardar() {
    setG(true); setErr(null)
    try {
      const { error } = await supabase.from('asis_acuses_alerta').insert({
        cod_contaline: cod, fecha, tipo_alerta: tipoAlerta,
        acusado_por: cu.id, accion, observacion: obs.trim() || null,
      })
      if (error) throw error
      onListo?.(); onCerrar?.()
    } catch (e) {
      setErr(e.message?.includes('duplicate') || e.code === '23505'
        ? 'Ya existe un acuse activo para este trabajador, día y tipo de alerta.'
        : e.message)
      setG(false)
    }
  }

  const nivel = en60.length >= 3 ? 'critico' : en60.length >= 1 ? 'alerta' : 'ok'
  const COL = { critico:'#B42318', alerta:'#B25E09', ok:'#1E7A44' }[nivel]

  return (
    <>
      <div onClick={() => !guardando && onCerrar?.()}
        style={{position:'fixed',inset:0,background:'rgba(0,0,0,.32)',zIndex:210}}/>
      <aside role="dialog" aria-label="Acuse de recibo" style={{
        position:'fixed',top:0,right:0,bottom:0,width:'min(560px,100vw)',zIndex:211,
        background:'var(--bg-app)',borderLeft:'1px solid var(--border)',
        boxShadow:'-10px 0 34px rgba(0,0,0,.14)',display:'flex',flexDirection:'column'}}>

        <header style={{padding:'15px 20px',borderBottom:'1px solid var(--border)',
          background:'var(--bg-surface)',display:'flex',justifyContent:'space-between',gap:14}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:16.5,fontWeight:650}}>Acuse de recibo</div>
            <div style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>
              {nombre} · {TIPOS[tipoAlerta] || tipoAlerta} · {fFecha(fecha)}
            </div>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" disabled={guardando}
            style={{background:'none',border:'none',fontSize:22,cursor:'pointer',
              color:'var(--text-muted)',lineHeight:1}}>×</button>
        </header>

        <div style={{flex:1,overflowY:'auto',padding:'16px 20px 24px'}}>
          {!hist ? (
            <div style={{padding:40,textAlign:'center',color:'var(--text-muted)',fontSize:13}}>Cargando historial…</div>
          ) : (
            <>
              {/* Lo primero: cuántas veces ya pasó esto */}
              <div style={{background:`${COL}10`,borderLeft:`3px solid ${COL}`,
                borderRadius:'0 6px 6px 0',padding:'12px 15px',marginBottom:16}}>
                <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',
                  textTransform:'uppercase',color:COL,marginBottom:3}}>
                  {en60.length === 0 ? 'Primera vez en 60 días'
                    : en60.length === 1 ? 'Segunda vez en 60 días'
                    : `${en60.length + 1}ª vez en 60 días`}
                </div>
                <div style={{fontSize:12.5,lineHeight:1.5,color:'var(--text)'}}>
                  {en60.length === 0
                    ? 'No hay registros previos de esta conducta en los últimos 60 días.'
                    : <>Ya se registró <b>{en60.length} {en60.length===1?'vez':'veces'}</b> en los últimos 60 días
                        {mismos.length > en60.length && <> ({mismos.length} en total)</>}.
                        {en60.length >= 3 && !conEscrita &&
                          <> Con esta frecuencia y sin amonestación escrita previa, <b>corresponde evaluar escalar</b>.</>}
                        {conEscrita && <> Ya existe una amonestación escrita en el historial.</>}
                      </>}
                </div>
              </div>

              {yaAcusado ? (
                <div style={{padding:'12px 15px',borderRadius:7,fontSize:12.5,
                  background:'var(--bg-surface)',border:'1px solid var(--border)',marginBottom:16}}>
                  Este día ya tiene acuse registrado por <b>{hist.nombres[yaAcusado.acusado_por] || yaAcusado.acusado_por}</b>.
                  No se registra dos veces lo mismo.
                </div>
              ) : (
                <>
                  <h4 style={{fontSize:13,fontWeight:700,margin:'0 0 8px'}}>¿Qué acción tomaste?</h4>
                  <div style={{display:'grid',gap:6,marginBottom:14}}>
                    {ACCIONES.map(a => (
                      <label key={a.k} style={{display:'flex',gap:10,alignItems:'flex-start',
                        padding:'9px 12px',border:`1px solid ${accion===a.k?'var(--text)':'var(--border)'}`,
                        borderRadius:7,cursor:'pointer',
                        background: accion===a.k ? 'var(--bg-surface)' : 'transparent'}}>
                        <input type="radio" name="accion" checked={accion===a.k}
                          onChange={()=>setAccion(a.k)} style={{marginTop:2,cursor:'pointer'}}/>
                        <span style={{minWidth:0}}>
                          <span style={{fontSize:13,fontWeight:600,display:'block'}}>{a.l}</span>
                          <span style={{fontSize:11.5,color:'var(--text-muted)'}}>{a.d}</span>
                        </span>
                      </label>
                    ))}
                  </div>

                  <h4 style={{fontSize:13,fontWeight:700,margin:'0 0 6px'}}>Observación</h4>
                  <textarea value={obs} onChange={e=>setObs(e.target.value)} rows={3}
                    placeholder="Qué se conversó, qué se acordó, o el motivo que dio el trabajador."
                    style={{width:'100%',padding:'9px 11px',border:'1px solid var(--border)',
                      borderRadius:7,fontSize:12.5,fontFamily:'inherit',resize:'vertical',
                      background:'var(--bg-surface)',color:'var(--text)',boxSizing:'border-box'}}/>
                  <div style={{fontSize:11,color:'var(--text-muted)',marginTop:4,marginBottom:14}}>
                    Queda en el historial del trabajador y es el respaldo si más adelante hay que escalar.
                  </div>

                  {err && <div style={{padding:'9px 12px',borderRadius:6,fontSize:12.5,marginBottom:12,
                    background:'#B4231810',color:'#B42318'}}>{err}</div>}

                  <div style={{display:'flex',gap:8}}>
                    <button onClick={guardar} disabled={guardando} style={{padding:'9px 18px',
                      background:'var(--accent)',color:'#fff',border:'none',borderRadius:7,
                      cursor:guardando?'default':'pointer',fontSize:13,fontWeight:600,opacity:guardando?.6:1}}>
                      {guardando ? 'Registrando…' : 'Registrar acuse'}
                    </button>
                    <button onClick={onCerrar} disabled={guardando} style={{padding:'9px 16px',
                      background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',
                      borderRadius:7,cursor:'pointer',fontSize:13}}>Cancelar</button>
                  </div>
                </>
              )}

              {/* Historial completo: el respaldo documental */}
              {hist.filas.length > 0 && (
                <section style={{marginTop:22,borderTop:'1px solid var(--border)',paddingTop:14}}>
                  <h4 style={{fontSize:13,fontWeight:700,margin:'0 0 10px'}}>
                    Historial de {nombre.split(' ').slice(0,2).join(' ')}
                  </h4>
                  {hist.filas.map((f,i) => {
                    const a = ACCIONES.find(x => x.k === f.accion)
                    const propio = f.tipo_alerta === tipoAlerta
                    return (
                      <div key={i} style={{display:'flex',gap:10,padding:'8px 0',fontSize:12.5,
                        borderTop: i ? '1px solid var(--border)' : 'none', opacity: propio ? 1 : .6}}>
                        <span style={{width:3,borderRadius:2,flexShrink:0,
                          background: f.accion==='amonestacion_escrita' ? '#B42318'
                                    : f.accion==='amonestacion_verbal' ? '#B25E09'
                                    : f.accion==='justificado' ? '#1E7A44' : '#8E8E93'}}/>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:600}}>{a?.l || f.accion}
                            <span style={{fontWeight:400,color:'var(--text-muted)'}}> · {TIPOS[f.tipo_alerta] || f.tipo_alerta}</span>
                          </div>
                          {f.observacion && <div style={{fontSize:11.5,color:'var(--text-muted)',
                            fontStyle:'italic',marginTop:1}}>“{f.observacion}”</div>}
                          <div style={{fontSize:10.5,color:'var(--text-muted)',marginTop:1}}>
                            {hist.nombres[f.acusado_por] || f.acusado_por}
                          </div>
                        </div>
                        <span style={{fontSize:11,color:'var(--text-muted)',whiteSpace:'nowrap',...NUM}}>
                          {fFecha(f.fecha)}
                        </span>
                      </div>
                    )
                  })}
                </section>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  )
}
