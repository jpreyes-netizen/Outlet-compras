// ═══════════════════════════════════════════════════════════════════════════
// InvAjusteRespaldo.jsx — Respaldo del ajuste de inventario
// Outlet de Puertas · Módulo Logística
//
// Un inventario cerrado con diferencias no está terminado hasta que el ajuste
// hecho en BSALE quede respaldado acá: folio del documento, fecha, monto y
// comprobante. Mientras falte, el inventario aparece como pendiente en la
// worklist y en el reporte diario a Dirección de Operaciones.
//
// Tabla:  log_inv_cabeceras (columnas ajuste_*)
// Bucket: log-documentos-wms, carpeta ajustes-inventario/
// Vista:  v_inv_ajuste_pendiente
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useMemo } from 'react'
import { supabase } from '../supabase'

const AJ = {
  navy:'#16213E', ink:'#1C1C1E', slate:'#6E6E73', line:'#DADADF', lineSoft:'#ECECEF',
  rojo:'#B42318', verde:'#1E7A44', ambar:'#B25E09', azul:'#175CD3', bgHead:'#F4F4F6',
}
const MAX_MB = 10
const TIPOS  = ['pdf','jpg','jpeg','png','webp']

const fmtCLP = n => new Intl.NumberFormat('es-CL',
  {style:'currency', currency:'CLP', maximumFractionDigits:0}).format(Math.round(n || 0))

const btn = v => ({
  fontFamily:'inherit', fontSize:11, fontWeight:700, letterSpacing:0.6, cursor:'pointer',
  padding:'8px 14px', borderRadius:3, whiteSpace:'nowrap', transition:'all .12s',
  ...(v==='solid'  ? {background:AJ.navy, color:'#fff', border:`1px solid ${AJ.navy}`}
    : v==='ghost'  ? {background:'transparent', color:AJ.slate, border:'1px solid transparent'}
    :                {background:'#fff', color:AJ.navy, border:`1px solid ${AJ.line}`}),
})
const inp = w => ({
  fontFamily:'inherit', fontSize:12, color:AJ.ink, background:'#fff',
  border:`1px solid ${AJ.line}`, borderRadius:3, padding:'6px 9px', width:w, outline:'none',
})

/**
 * @param inv        cabecera del inventario (log_inv_cabeceras)
 * @param detalles   líneas del inventario, para calcular la diferencia valorizada
 * @param cu         usuario actual
 * @param onRefresh  callback para recargar tras guardar
 */
export default function InvAjusteRespaldo({ inv, detalles = [], cu, onRefresh }) {
  const [folio, setFolio]   = useState(inv?.ajuste_folio_bsale || '')
  const [fecha, setFecha]   = useState(inv?.ajuste_fecha || '')
  const [obs,   setObs]     = useState(inv?.ajuste_observacion || '')
  const [file,  setFile]    = useState(null)
  const [msg,   setMsg]     = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [editando,  setEditando]  = useState(false)

  const puedeRegistrar = ['admin','admin_sistema','dir_general','gerente','director',
                          'jefe_bodega','jefe_tienda','coordinador','jefe_sucursal'].includes(cu?.rol)

  // Diferencia valorizada, excluyendo costos corruptos como los que aparecieron
  // en la planilla de La Granja (una cerradura a 172 millones)
  const res = useMemo(() => {
    let lineas = 0, neta = 0, abs = 0
    detalles.forEach(d => {
      if (d.stock_fisico === null || d.stock_fisico === undefined) return
      const dif = Number(d.diferencia) || 0
      if (dif === 0) return
      lineas++
      const costo = Number(d.costo_unitario) || 0
      if (costo > 0 && costo < 1000000) { neta += dif * costo; abs += Math.abs(dif * costo) }
    })
    return {lineas, neta, abs}
  }, [detalles])

  const sinDiferencias = res.lineas === 0
  const respaldado = !!(inv?.ajuste_doc_url && inv?.ajuste_folio_bsale)
  const sinMovimiento = !!inv?.ajuste_sin_movimiento
  const diasDesde = inv?.fecha_ejecucion_real || inv?.fecha_planificada
    ? Math.floor((Date.now() - new Date((inv.fecha_ejecucion_real || inv.fecha_planificada) + 'T12:00:00')) / 86400000)
    : 0

  async function guardar() {
    if (!folio.trim()) { setMsg({t:'error', m:'Indica el folio o número del ajuste emitido en BSALE.'}); return }
    if (!file && !inv?.ajuste_doc_url) { setMsg({t:'error', m:'Adjunta el comprobante del ajuste.'}); return }
    if (!fecha) { setMsg({t:'error', m:'Indica la fecha en que se aplicó el ajuste.'}); return }

    setGuardando(true); setMsg(null)
    try {
      let url = inv?.ajuste_doc_url || null
      let nombre = inv?.ajuste_doc_nombre || null

      if (file) {
        if (file.size > MAX_MB * 1024 * 1024) throw new Error(`El archivo supera los ${MAX_MB} MB.`)
        const ext = file.name.split('.').pop().toLowerCase()
        if (!TIPOS.includes(ext)) throw new Error('Solo se permiten PDF, JPG, PNG o WEBP.')
        const path = `ajustes-inventario/${inv.id}.${ext}`
        const { error: eU } = await supabase.storage.from('log-documentos-wms')
          .upload(path, file, {upsert:true})
        if (eU) throw eU
        const { data: u } = supabase.storage.from('log-documentos-wms').getPublicUrl(path)
        url = u.publicUrl; nombre = file.name
      }

      const { error } = await supabase.from('log_inv_cabeceras').update({
        ajuste_folio_bsale: folio.trim(),
        ajuste_fecha: fecha,
        ajuste_doc_url: url,
        ajuste_doc_nombre: nombre,
        ajuste_monto_clp: Math.round(res.neta),
        ajuste_observacion: obs.trim() || null,
        ajuste_sin_movimiento: false,
        ajuste_registrado_por: cu?.id || null,
        ajuste_registrado_nombre: cu?.nombre || null,
        ajuste_registrado_at: new Date().toISOString(),
      }).eq('id', inv.id)
      if (error) throw error

      setMsg({t:'ok', m:'Comprobante registrado.'})
      setFile(null); setEditando(false)
      onRefresh && onRefresh()
    } catch (e) {
      setMsg({t:'error', m: e.message})
    }
    setGuardando(false)
  }

  async function marcarSinMovimiento() {
    if (!obs.trim()) { setMsg({t:'error', m:'Explica por qué no hubo ajuste que respaldar.'}); return }
    setGuardando(true); setMsg(null)
    try {
      const { error } = await supabase.from('log_inv_cabeceras').update({
        ajuste_sin_movimiento: true,
        ajuste_observacion: obs.trim(),
        ajuste_registrado_por: cu?.id || null,
        ajuste_registrado_nombre: cu?.nombre || null,
        ajuste_registrado_at: new Date().toISOString(),
      }).eq('id', inv.id)
      if (error) throw error
      setMsg({t:'ok', m:'Registrado como sin ajuste.'})
      setEditando(false)
      onRefresh && onRefresh()
    } catch (e) { setMsg({t:'error', m: e.message}) }
    setGuardando(false)
  }

  // ── Inventario sin diferencias: nada que respaldar ──
  if (sinDiferencias) return (
    <div style={{border:`1px solid ${AJ.line}`, borderLeft:`3px solid ${AJ.verde}`, borderRadius:3,
      background:'#fff', padding:'10px 14px', marginBottom:12, fontSize:12, color:AJ.slate}}>
      <strong style={{color:AJ.verde, fontWeight:700}}>Sin diferencias.</strong> El conteo cuadró con
      el sistema, así que no hay ajuste que respaldar.
    </div>
  )

  const cabecera = (
    <div style={{display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', marginBottom:10}}>
      <div style={{fontSize:10.5, fontWeight:700, letterSpacing:0.8, color:AJ.slate, textTransform:'uppercase'}}>
        Respaldo del ajuste
      </div>
      <div style={{display:'flex', gap:16, marginLeft:'auto', flexWrap:'wrap'}}>
        <span style={{fontSize:11.5, color:AJ.slate}}>
          {res.lineas} línea{res.lineas===1?'':'s'} con diferencia
        </span>
        <span style={{fontSize:11.5, color:AJ.slate}}>
          Neto <strong style={{color: res.neta < 0 ? AJ.rojo : res.neta > 0 ? AJ.ambar : AJ.ink,
            fontVariantNumeric:'tabular-nums'}}>{fmtCLP(res.neta)}</strong>
        </span>
        <span style={{fontSize:11.5, color:AJ.slate}}>
          Absoluto <strong style={{color:AJ.ink, fontVariantNumeric:'tabular-nums'}}>{fmtCLP(res.abs)}</strong>
        </span>
      </div>
    </div>
  )

  // ── Ya respaldado, o declarado sin movimiento ──
  if ((respaldado || sinMovimiento) && !editando) return (
    <div style={{border:`1px solid ${AJ.line}`, borderLeft:`3px solid ${AJ.verde}`, borderRadius:3,
      background:'#fff', padding:'12px 14px', marginBottom:12}}>
      {cabecera}
      <div style={{display:'flex', alignItems:'center', gap:14, flexWrap:'wrap', fontSize:12, color:AJ.ink}}>
        <span style={{display:'inline-flex', alignItems:'center', gap:6, fontWeight:700,
          fontSize:10.5, letterSpacing:0.4, color:AJ.verde}}>
          <span style={{width:7, height:7, borderRadius:'50%', background:AJ.verde}}/>
          {sinMovimiento ? 'SIN AJUSTE' : 'AJUSTE RESPALDADO'}
        </span>
        {!sinMovimiento && (<>
          <span>Folio <strong>{inv.ajuste_folio_bsale}</strong></span>
          <span style={{color:AJ.slate}}>Aplicado {inv.ajuste_fecha}</span>
          {inv.ajuste_doc_url && (
            <a href={inv.ajuste_doc_url} target="_blank" rel="noreferrer"
              style={{color:AJ.azul, fontWeight:700, fontSize:11, textDecoration:'none'}}>
              VER COMPROBANTE
            </a>
          )}
        </>)}
        <span style={{color:AJ.slate, fontSize:11}}>
          Registrado por {inv.ajuste_registrado_nombre || '—'}
        </span>
        <button onClick={()=>setEditando(true)} style={{...btn('ghost'), marginLeft:'auto', padding:'4px 8px'}}>
          MODIFICAR
        </button>
      </div>
      {inv.ajuste_observacion && (
        <div style={{marginTop:8, fontSize:11.5, color:AJ.slate, lineHeight:1.5}}>
          {inv.ajuste_observacion}
        </div>
      )}
    </div>
  )

  // ── Pendiente de respaldo ──
  const urgente = diasDesde > 7
  return (
    <div style={{border:`1px solid ${urgente ? AJ.rojo+'40' : AJ.line}`,
      borderLeft:`3px solid ${urgente ? AJ.rojo : AJ.ambar}`, borderRadius:3,
      background:'#fff', padding:'12px 14px', marginBottom:12}}>
      {cabecera}

      <div style={{padding:'8px 12px', marginBottom:12, borderRadius:3,
        background: urgente ? '#FCF3F1' : '#FBF6EF',
        fontSize:11.5, color: urgente ? AJ.rojo : AJ.ambar, lineHeight:1.55}}>
        <strong>Falta el comprobante del ajuste.</strong> El inventario detectó diferencias por{' '}
        {fmtCLP(res.abs)} en valor absoluto. Registra acá el documento de ajuste emitido en BSALE
        para dejar constancia de qué se hizo con esa diferencia.
        {urgente && <> Este inventario se cerró hace {diasDesde} días.</>}
      </div>

      {!puedeRegistrar ? (
        <div style={{fontSize:11.5, color:AJ.slate}}>
          No tienes permiso para registrar el ajuste. Avísale al jefe de bodega o a Operaciones.
        </div>
      ) : (<>
        <div style={{display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:8}}>
          <input style={inp(200)} placeholder="Folio o N° del ajuste en BSALE"
            value={folio} onChange={e=>setFolio(e.target.value)}/>
          <input type="date" style={inp(140)} value={fecha} onChange={e=>setFecha(e.target.value)}
            max={new Date().toLocaleDateString('en-CA')}/>
          <label style={{...btn('outline'), display:'inline-flex', alignItems:'center', gap:6}}>
            {file ? file.name.slice(0,28) : (inv?.ajuste_doc_nombre ? 'REEMPLAZAR COMPROBANTE' : 'ADJUNTAR COMPROBANTE')}
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{display:'none'}}
              onChange={e=>{ setFile(e.target.files?.[0] || null); setMsg(null) }}/>
          </label>
          {file && (
            <button onClick={()=>setFile(null)} style={{...btn('ghost'), padding:'4px 8px'}}>QUITAR</button>
          )}
        </div>

        <textarea style={{...inp('100%'), minHeight:44, resize:'vertical', fontFamily:'inherit', marginBottom:10}}
          placeholder="Observación (opcional): qué originó la diferencia, si se separó merma de ajuste de conteo, etc."
          value={obs} onChange={e=>setObs(e.target.value)}/>

        {msg && (
          <div style={{padding:'7px 11px', marginBottom:10, borderRadius:3, fontSize:11.5, fontWeight:600,
            background: msg.t==='ok' ? '#F0F7F3' : '#FCF3F1',
            color: msg.t==='ok' ? AJ.verde : AJ.rojo}}>
            {msg.m}
          </div>
        )}

        <div style={{display:'flex', gap:8, flexWrap:'wrap', alignItems:'center'}}>
          <button onClick={guardar} disabled={guardando} style={btn('solid')}>
            {guardando ? 'GUARDANDO…' : 'REGISTRAR COMPROBANTE'}
          </button>
          <button onClick={marcarSinMovimiento} disabled={guardando} style={btn('outline')}
            title="Usar solo si las diferencias no requirieron ajuste en BSALE">
            NO REQUIRIÓ AJUSTE
          </button>
          {editando && (
            <button onClick={()=>{setEditando(false); setMsg(null)}} style={btn('ghost')}>CANCELAR</button>
          )}
          <span style={{fontSize:10.5, color:AJ.slate, marginLeft:'auto'}}>
            PDF, JPG, PNG o WEBP · máx {MAX_MB} MB
          </span>
        </div>
      </>)}
    </div>
  )
}
