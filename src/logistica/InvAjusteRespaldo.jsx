// ══════════════════════════════════════════════════════════════════════
// InvAjusteRespaldo.jsx — Respaldo del ajuste de inventario
// Outlet de Puertas · Módulo Logística
//
// Un inventario cerrado con diferencias no está terminado hasta que lo hecho
// en BSALE quede respaldado acá. Desde el 25-11-2026 (decisión de Christian
// Reyes, Dir. Operaciones) son dos documentos separados y el conteo decide
// cuáles se exigen:
//   · Ajuste  = recepción de stock en BSALE  → obligatorio si hay sobrantes
//   · Consumo = consumo de stock en BSALE    → obligatorio si hay faltantes
// Cada uno con fecha, monto del documento, referencia y comprobante.
// Los inventarios respaldados antes con un solo comprobante (respaldo_legado)
// conservan su estado; en ellos el consumo queda como opcional.
// Un admin puede registrar una excepción con motivo (ajuste_sin_movimiento).
//
// Tabla:  log_inv_cabeceras (columnas ajuste_* y consumo_*)
// Bucket: log-documentos-wms, carpeta ajustes-inventario/
// Vista:  v_inv_ajuste_pendiente (misma regla que evaluarRespaldo)
// Sugerencias de consumo: log_mermas (sincronizado desde BSALE cada 3 horas)
// ══════════════════════════════════════════════════════════════════════

import React, { useState, useMemo, useEffect } from 'react'
import { supabase } from '../supabase'

const AJ = {
  navy:'#16213E', ink:'#1C1C1E', slate:'#6E6E73', line:'#DADADF', lineSoft:'#ECECEF',
  rojo:'#B42318', verde:'#1E7A44', ambar:'#B25E09', azul:'#175CD3', bgHead:'#F4F4F6',
}
const MAX_MB = 10
const TIPOS  = ['pdf','jpg','jpeg','png','webp']
const ROLES_REGISTRO = ['admin','admin_sistema','dir_general','gerente','director',
                        'jefe_bodega','jefe_tienda','coordinador','jefe_sucursal']

const fmtCLP = n => new Intl.NumberFormat('es-CL',
  {style:'currency', currency:'CLP', maximumFractionDigits:0}).format(Math.round(n || 0))
const fmtN = n => new Intl.NumberFormat('es-CL').format(Math.round(n || 0))
const fmtF = f => { const s = String(f || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('-') : '—' }
const hoyCL = () => new Date().toLocaleDateString('en-CA', { timeZone:'America/Santiago' })
const sumarDias = (f, n) => { const d = new Date(String(f).slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/** Monto escrito a la chilena ("$ 143.260,88", "143260") → pesos enteros. NaN si no se entiende. */
export function leerMonto(v) {
  if (typeof v === 'number') return isFinite(v) ? Math.round(v) : NaN
  const s = String(v ?? '').trim().replace(/[^\d.,-]/g, '')
  if (!s) return NaN
  const n = /^-?\d+\.\d{1,2}$/.test(s) ? Number(s)                    // 143260.88: punto decimal
          : Number(s.replace(/\./g, '').replace(',', '.'))           // 143.260,88: punto de miles
  return isFinite(n) ? Math.round(n) : NaN
}

/** Líneas, unidades y valor de sobrantes y faltantes (costos sobre $1.000.000 se ignoran por corruptos). */
export function resumirDiferencias(detalles = []) {
  const r = { lineas:0, neta:0, abs:0, sobr:{ lineas:0, unid:0, valor:0 }, falt:{ lineas:0, unid:0, valor:0 } }
  detalles.forEach(d => {
    if (d.stock_fisico === null || d.stock_fisico === undefined) return
    const dif = Number(d.diferencia) || 0
    if (dif === 0) return
    r.lineas++
    const costo = Number(d.costo_unitario) || 0
    const v = costo > 0 && costo < 1000000 ? dif * costo : 0
    r.neta += v; r.abs += Math.abs(v)
    const g = dif > 0 ? r.sobr : r.falt
    g.lineas++; g.unid += Math.abs(dif); g.valor += Math.abs(v)
  })
  return r
}

/**
 * Estado del respaldo con la misma regla que v_inv_ajuste_pendiente:
 * SIN_DIFERENCIAS | EXCEPCION | RESPALDADO | PENDIENTE (y qué falta).
 */
export function evaluarRespaldo(inv = {}, lineasSobrante = 0, lineasFaltante = 0) {
  const requiereAjuste = lineasSobrante > 0, requiereConsumo = lineasFaltante > 0
  const ajusteOk  = !!(inv?.ajuste_doc_url && inv?.ajuste_fecha)
  const consumoOk = !!(inv?.consumo_doc_url && inv?.consumo_fecha)
  const legado = !!inv?.respaldo_legado, excepcion = !!inv?.ajuste_sin_movimiento
  const falta = []
  let estado
  if (!requiereAjuste && !requiereConsumo) estado = 'SIN_DIFERENCIAS'
  else if (excepcion) estado = 'EXCEPCION'
  else if (legado) estado = inv?.ajuste_doc_url && inv?.ajuste_folio_bsale ? 'RESPALDADO' : 'PENDIENTE'
  else {
    if (requiereAjuste && !ajusteOk) falta.push('ajuste')
    if (requiereConsumo && !consumoOk) falta.push('consumo')
    estado = falta.length ? 'PENDIENTE' : 'RESPALDADO'
  }
  return { estado, falta, requiereAjuste, requiereConsumo, ajusteOk, consumoOk, legado, excepcion }
}

/**
 * Registra el comprobante del ajuste o del consumo y devuelve la cabecera actualizada.
 * datos = { referencia, fecha, monto, bsaleId }. Registrar un documento quita una excepción previa.
 */
export async function guardarComprobante({ inv, cu, tipo, datos = {}, file = null, netaApp = null, sb = supabase }) {
  if (!inv?.id) throw new Error('No se encontró el inventario.')
  const pre = tipo === 'consumo' ? 'consumo' : 'ajuste'
  const nombreDoc = pre === 'ajuste' ? 'el ajuste (recepción de stock)' : 'el consumo'
  const fecha = String(datos.fecha || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error(`Indica la fecha en que se hizo ${nombreDoc} en BSALE.`)
  if (fecha > hoyCL()) throw new Error('La fecha no puede ser futura.')
  const monto = leerMonto(datos.monto)
  if (!(monto > 0)) throw new Error('Indica el monto total del documento BSALE.')
  const urlActual = inv[`${pre}_doc_url`] || null
  if (!file && !urlActual) throw new Error('Adjunta el comprobante.')

  let url = urlActual, nombre = inv[`${pre}_doc_nombre`] || null
  if (file) {
    if (file.size > MAX_MB * 1024 * 1024) throw new Error(`El archivo supera los ${MAX_MB} MB.`)
    const ext = String(file.name || '').split('.').pop().toLowerCase()
    if (!TIPOS.includes(ext)) throw new Error('Solo se permiten PDF, JPG, PNG o WEBP.')
    const path = pre === 'ajuste' ? `ajustes-inventario/${inv.id}.${ext}` : `ajustes-inventario/${inv.id}_consumo.${ext}`
    const { error: eU } = await sb.storage.from('log-documentos-wms').upload(path, file, { upsert:true })
    if (eU) throw eU
    const { data: u } = sb.storage.from('log-documentos-wms').getPublicUrl(path)
    url = u.publicUrl; nombre = file.name
  }

  const ref = String(datos.referencia || '').trim() || null
  const ahora = new Date().toISOString()
  const cambios = pre === 'ajuste'
    ? { ajuste_folio_bsale: ref || inv.ajuste_folio_bsale || null, ajuste_fecha: fecha, ajuste_doc_url: url,
        ajuste_doc_nombre: nombre, ajuste_doc_monto: monto,
        ajuste_registrado_por: cu?.id || null, ajuste_registrado_nombre: cu?.nombre || null, ajuste_registrado_at: ahora }
    : { consumo_folio_bsale: ref, consumo_fecha: fecha, consumo_doc_url: url, consumo_doc_nombre: nombre,
        consumo_doc_monto: monto, consumo_bsale_id: datos.bsaleId || null,
        consumo_registrado_por: cu?.id || null, consumo_registrado_nombre: cu?.nombre || null, consumo_registrado_at: ahora }
  cambios.ajuste_sin_movimiento = false
  if (netaApp !== null && isFinite(netaApp)) cambios.ajuste_monto_clp = Math.round(netaApp)

  const { data, error } = await sb.from('log_inv_cabeceras').update(cambios).eq('id', inv.id).select('*')
  if (error) throw error
  if (!data || !data.length) throw new Error('No se pudo actualizar el inventario. Recarga e intenta de nuevo.')
  return data[0]
}

/** Excepción: diferencias que no se respaldan con documentos BSALE. Solo admin, con motivo. */
export async function registrarExcepcion({ inv, cu, motivo, sb = supabase }) {
  if (cu?.rol !== 'admin' || cu?._simulado) throw new Error('Solo un administrador puede registrar una excepción.')
  const m = String(motivo || '').trim()
  if (m.length < 10) throw new Error('Explica por qué no se respalda con documentos BSALE (al menos 10 caracteres).')
  const { data, error } = await sb.from('log_inv_cabeceras').update({
    ajuste_sin_movimiento: true, ajuste_observacion: m,
    ajuste_registrado_por: cu?.id || null, ajuste_registrado_nombre: cu?.nombre || null,
    ajuste_registrado_at: new Date().toISOString(),
  }).eq('id', inv.id).select('*')
  if (error) throw error
  if (!data || !data.length) throw new Error('No se pudo actualizar el inventario. Recarga e intenta de nuevo.')
  return data[0]
}

const btn = v => ({
  fontFamily:'inherit', fontSize:11.5, fontWeight:600, cursor:'pointer', padding:'7px 13px',
  borderRadius:3, whiteSpace:'nowrap',
  ...(v === 'solid' ? { background:AJ.navy, color:'#fff', border:`1px solid ${AJ.navy}` }
    : v === 'ghost' ? { background:'transparent', color:AJ.slate, border:'1px solid transparent' }
    : v === 'link'  ? { background:'transparent', color:AJ.azul, border:'none', padding:'2px 0' }
    :                 { background:'#fff', color:AJ.navy, border:`1px solid ${AJ.line}` }),
})
const inp = w => ({
  fontFamily:'inherit', fontSize:12, color:AJ.ink, background:'#fff', boxSizing:'border-box',
  border:`1px solid ${AJ.line}`, borderRadius:3, padding:'6px 9px', width:w, outline:'none',
})
const Pastilla = ({ c, children }) => (
  <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:11, fontWeight:700, color:c }}>
    <span style={{ width:7, height:7, borderRadius:'50%', background:c, flexShrink:0 }}/>{children}
  </span>
)

// ── Un documento: ajuste o consumo ─────────────────────────────────────
function DocBsale({ tipo, inv, cu, requerido, opcional, resumen, puedeRegistrar, sugeridos, netaApp, onGuardado }) {
  const pre = tipo
  const titulo = tipo === 'ajuste' ? 'Ajuste en BSALE' : 'Consumo en BSALE'
  const subtitulo = tipo === 'ajuste' ? 'Recepción de stock por los sobrantes' : 'Consumo de stock por los faltantes'
  const registrado = !!(inv?.[`${pre}_doc_url`] && inv?.[`${pre}_fecha`])
  const montoDoc = inv?.[`${pre}_doc_monto`]
  const [editando, setEditando] = useState(false)
  const [ref, setRef]       = useState(inv?.[`${pre}_folio_bsale`] || '')
  const [fecha, setFecha]   = useState(inv?.[`${pre}_fecha`] || '')
  const [monto, setMonto]   = useState(montoDoc != null ? String(Math.round(montoDoc)) : '')
  const [bsaleId, setBsaleId] = useState(inv?.consumo_bsale_id || null)
  const [file, setFile]     = useState(null)
  const [error, setError]   = useState('')
  const [guardando, setGuardando] = useState(false)

  const aplica = requerido || opcional
  const color = registrado ? AJ.verde : requerido ? AJ.rojo : AJ.line
  const etiqueta = registrado ? <Pastilla c={AJ.verde}>Registrado</Pastilla>
    : requerido ? <Pastilla c={AJ.rojo}>Obligatorio</Pastilla>
    : opcional ? <Pastilla c={AJ.slate}>Opcional</Pastilla>
    : <Pastilla c={AJ.slate}>No aplica</Pastilla>

  async function guardar() {
    setGuardando(true); setError('')
    try {
      const fresca = await guardarComprobante({ inv, cu, tipo, datos:{ referencia:ref, fecha, monto, bsaleId }, file, netaApp })
      setFile(null); setEditando(false)
      onGuardado && onGuardado(fresca)
    } catch (e) { setError(e.message || String(e)) }
    setGuardando(false)
  }
  const usar = m => {
    setFecha(String(m.fecha).slice(0, 10)); setMonto(String(Math.round(Number(m.costo_total) || 0)))
    setRef(`Consumo BSALE ${m.bsale_consumption_id}`); setBsaleId(m.bsale_consumption_id); setError('')
  }

  return (
    <div style={{ border:`1px solid ${AJ.line}`, borderTop:`3px solid ${color}`, borderRadius:3,
      background:'#fff', padding:'10px 12px', minWidth:0 }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:8, flexWrap:'wrap' }}>
        <span style={{ fontSize:12.5, fontWeight:700, color:AJ.ink }}>{titulo}</span>
        <span style={{ fontSize:11, color:AJ.slate }}>{subtitulo}</span>
        <span style={{ marginLeft:'auto' }}>{etiqueta}</span>
      </div>
      <div style={{ fontSize:11.5, color:AJ.slate, margin:'4px 0 8px', lineHeight:1.5 }}>
        {requerido
          ? <>El conteo arrojó {fmtN(resumen.lineas)} producto{resumen.lineas === 1 ? '' : 's'} y {fmtN(resumen.unid)} unidad{resumen.unid === 1 ? '' : 'es'} por {fmtCLP(resumen.valor)}.</>
          : opcional ? <>Este inventario se respaldó antes de separar ajuste y consumo; puedes agregar el consumo igual.</>
          : registrado && inv?.respaldo_legado ? <>Comprobante único, registrado antes de separar ajuste y consumo.</>
          : <>No aplica: el conteo no tiene {tipo === 'ajuste' ? 'sobrantes' : 'faltantes'}.</>}
      </div>

      {registrado && !editando ? (
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', fontSize:12, color:AJ.ink }}>
          <span>Fecha <strong>{fmtF(inv[`${pre}_fecha`])}</strong></span>
          {montoDoc != null && <span>Monto <strong style={{ fontVariantNumeric:'tabular-nums' }}>{fmtCLP(montoDoc)}</strong></span>}
          {inv[`${pre}_folio_bsale`] && <span style={{ color:AJ.slate }}>Ref. {inv[`${pre}_folio_bsale`]}</span>}
          <a href={inv[`${pre}_doc_url`]} target="_blank" rel="noreferrer"
            style={{ color:AJ.azul, fontWeight:700, fontSize:11.5, textDecoration:'none' }}>Ver comprobante</a>
          <span style={{ color:AJ.slate, fontSize:11 }}>Registrado por {inv[`${pre}_registrado_nombre`] || '—'}</span>
          {puedeRegistrar && (
            <button type="button" onClick={() => setEditando(true)} style={{ ...btn('ghost'), marginLeft:'auto', padding:'3px 6px' }}>
              Modificar
            </button>
          )}
          {requerido && montoDoc != null && Math.abs(Number(montoDoc) - resumen.valor) >= 1 && (
            <div style={{ flexBasis:'100%', fontSize:11, color:AJ.ambar }}>
              El documento difiere en {fmtCLP(Number(montoDoc) - resumen.valor)} de la valorización del conteo
              (costos de BSALE distintos a los de la planilla).
            </div>
          )}
        </div>
      ) : aplica && !puedeRegistrar ? (
        <div style={{ fontSize:11.5, color:AJ.slate }}>
          No tienes permiso para registrar este documento. Avísale al jefe de bodega o a Operaciones.
        </div>
      ) : aplica ? (
        <>
          {tipo === 'consumo' && sugeridos.length > 0 && (
            <div style={{ border:`1px solid ${AJ.lineSoft}`, borderRadius:3, marginBottom:8 }}>
              <div style={{ fontSize:11, color:AJ.slate, padding:'6px 9px', background:AJ.bgHead }}>
                Consumos de esta sucursal en BSALE cerca de la fecha del conteo
              </div>
              {sugeridos.map(m => (
                <div key={m.id} style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap',
                  padding:'6px 9px', borderTop:`1px solid ${AJ.lineSoft}`, fontSize:11.5 }}>
                  <span style={{ color:AJ.slate, fontVariantNumeric:'tabular-nums' }}>{fmtF(m.fecha)}</span>
                  <span style={{ color:AJ.ink, flex:'1 1 160px', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                    title={m.nota || ''}>{m.nota || 'Sin nota'}</span>
                  <span style={{ fontVariantNumeric:'tabular-nums' }}>{fmtN(m.total_unidades)} u · {fmtCLP(m.costo_total)}</span>
                  {m.calza && <Pastilla c={AJ.verde}>Calza con los faltantes</Pastilla>}
                  <button type="button" onClick={() => usar(m)} style={{ ...btn('outline'), padding:'3px 9px' }}>Usar</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:8 }}>
            <label style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:11.5, color:AJ.slate }}>
              Fecha
              <input type="date" style={inp(140)} value={fecha} max={hoyCL()}
                onChange={e => { setFecha(e.target.value); setError('') }}/>
            </label>
            <label style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:11.5, color:AJ.slate }}>
              Monto
              <input style={inp(120)} inputMode="decimal" placeholder="Total del documento" value={monto}
                onChange={e => { setMonto(e.target.value); setError('') }}/>
            </label>
            <input style={inp(190)} placeholder="N° o referencia BSALE (opcional)" value={ref}
              onChange={e => { setRef(e.target.value); setBsaleId(null) }}/>
            <label style={{ ...btn('outline'), display:'inline-flex', alignItems:'center', gap:6 }}>
              {file ? file.name.slice(0, 28) : (inv?.[`${pre}_doc_nombre`] ? 'Reemplazar comprobante' : 'Adjuntar comprobante')}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display:'none' }}
                onChange={e => { setFile(e.target.files?.[0] || null); setError('') }}/>
            </label>
          </div>
          {error && (
            <div role="alert" style={{ padding:'7px 11px', marginBottom:8, borderRadius:3, fontSize:11.5,
              fontWeight:600, background:'#FCF3F1', color:AJ.rojo }}>{error}</div>
          )}
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <button type="button" onClick={guardar} disabled={guardando} style={btn('solid')}>
              {guardando ? 'Guardando…' : `Guardar ${tipo}`}
            </button>
            {editando && (
              <button type="button" onClick={() => { setEditando(false); setError('') }} style={btn('ghost')}>Cancelar</button>
            )}
            <span style={{ fontSize:10.5, color:AJ.slate, marginLeft:'auto' }}>PDF, JPG, PNG o WEBP · máx {MAX_MB} MB</span>
          </div>
        </>
      ) : null}
    </div>
  )
}

/**
 * @param inv            cabecera del inventario (log_inv_cabeceras)
 * @param detalles       líneas del inventario, para saber si hay sobrantes y faltantes
 * @param cu             usuario actual
 * @param onRefresh      recarga la lista de inventarios
 * @param onActualizado  recibe la cabecera actualizada tras guardar
 */
export default function InvAjusteRespaldo({ inv, detalles = [], cu, onRefresh, onActualizado }) {
  const res = useMemo(() => resumirDiferencias(detalles), [detalles])
  const ev  = evaluarRespaldo(inv, res.sobr.lineas, res.falt.lineas)
  const puedeRegistrar = ROLES_REGISTRO.includes(cu?.rol)
  const esAdmin = cu?.rol === 'admin' && !cu?._simulado
  const fechaInv = String(inv?.fecha_ejecucion_real || inv?.fecha_planificada || '').slice(0, 10)
  const diasDesde = fechaInv ? Math.floor((Date.now() - new Date(fechaInv + 'T12:00:00')) / 86400000) : 0
  const consumoAbierto = ev.requiereConsumo && !ev.consumoOk && puedeRegistrar

  const [sugeridos, setSugeridos] = useState([])
  const [verExcepcion, setVerExcepcion] = useState(false)
  const [motivoEx, setMotivoEx] = useState('')
  const [errorEx, setErrorEx] = useState('')

  useEffect(() => {
    if (!inv?.id || !fechaInv || !consumoAbierto) return
    let vivo = true
    ;(async () => {
      const { data } = await supabase.from('log_mermas')
        .select('id,bsale_consumption_id,fecha,nota,tipo,total_unidades,costo_total')
        .eq('sucursal_codigo', inv.sucursal_codigo)
        .gte('fecha', sumarDias(fechaInv, -2)).lte('fecha', sumarDias(fechaInv, 15))
        .order('fecha').limit(60)
      if (vivo) setSugeridos(data || [])
    })().catch(() => {})
    return () => { vivo = false }
  }, [inv?.id, inv?.sucursal_codigo, fechaInv, consumoAbierto])

  // Solo consumos que se parecen al conteo: calzan las unidades o la nota habla del inventario
  const candidatos = useMemo(() => sugeridos.map(m => {
    const calza = Math.round(Number(m.total_unidades) || 0) === Math.round(res.falt.unid)
    const habla = /INVENT|C[IÍ]CLIC|CONTEO/i.test(String(m.nota || ''))
    const dist = Math.abs((new Date(m.fecha) - new Date(fechaInv)) / 86400000)
    return { ...m, calza, puntaje:(calza ? 2 : 0) + (habla ? 1 : 0), dist }
  }).filter(m => m.puntaje > 0).sort((a, b) => b.puntaje - a.puntaje || a.dist - b.dist).slice(0, 4),
  [sugeridos, res.falt.unid, fechaInv])

  const guardado = fresca => { onActualizado && onActualizado(fresca); onRefresh && onRefresh() }

  async function excepcion() {
    setErrorEx('')
    try { const fresca = await registrarExcepcion({ inv, cu, motivo:motivoEx }); setVerExcepcion(false); guardado(fresca) }
    catch (e) { setErrorEx(e.message || String(e)) }
  }

  if (ev.estado === 'SIN_DIFERENCIAS') return (
    <div style={{ border:`1px solid ${AJ.line}`, borderLeft:`3px solid ${AJ.verde}`, borderRadius:3,
      background:'#fff', padding:'10px 14px', marginBottom:12, fontSize:12, color:AJ.slate }}>
      <strong style={{ color:AJ.verde }}>Sin diferencias.</strong> El conteo cuadró con el sistema,
      así que no hay ajuste ni consumo que respaldar.
    </div>
  )

  const montosListos = (!ev.requiereAjuste || inv?.ajuste_doc_monto != null) && (!ev.requiereConsumo || inv?.consumo_doc_monto != null)
    && (inv?.ajuste_doc_monto != null || inv?.consumo_doc_monto != null)
  const netoBsale = montosListos ? (Number(inv?.ajuste_doc_monto) || 0) - (Number(inv?.consumo_doc_monto) || 0) : null
  const urgente = ev.estado === 'PENDIENTE' && diasDesde > 7
  const colorEstado = ev.estado === 'RESPALDADO' ? AJ.verde : ev.estado === 'EXCEPCION' ? AJ.slate : urgente ? AJ.rojo : AJ.ambar
  const textoEstado = ev.estado === 'RESPALDADO' ? 'Respaldado' : ev.estado === 'EXCEPCION' ? 'Excepción'
    : ev.falta.length ? `Falta ${ev.falta.join(' y ')}` : 'Pendiente'

  return (
    <div style={{ border:`1px solid ${urgente ? AJ.rojo + '40' : AJ.line}`, borderLeft:`3px solid ${colorEstado}`,
      borderRadius:3, background:'#fff', padding:'12px 14px', marginBottom:12 }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', marginBottom:10 }}>
        <span style={{ fontSize:13, fontWeight:700, color:AJ.ink }}>Respaldo del ajuste</span>
        <Pastilla c={colorEstado}>{textoEstado}</Pastilla>
        <div style={{ display:'flex', gap:16, marginLeft:'auto', flexWrap:'wrap', fontSize:11.5, color:AJ.slate }}>
          <span>{res.lineas} línea{res.lineas === 1 ? '' : 's'} con diferencia</span>
          <span>Neto del conteo <strong style={{ color:res.neta < 0 ? AJ.rojo : res.neta > 0 ? AJ.ambar : AJ.ink,
            fontVariantNumeric:'tabular-nums' }}>{fmtCLP(res.neta)}</strong></span>
          {netoBsale !== null && (
            <span>Neto BSALE <strong style={{ color:AJ.ink, fontVariantNumeric:'tabular-nums' }}>{fmtCLP(netoBsale)}</strong></span>
          )}
        </div>
      </div>

      {ev.estado === 'PENDIENTE' && (
        <div style={{ padding:'8px 12px', marginBottom:10, borderRadius:3, background:urgente ? '#FCF3F1' : '#FBF6EF',
          fontSize:11.5, color:urgente ? AJ.rojo : AJ.ambar, lineHeight:1.55 }}>
          <strong>Falta el comprobante {ev.falta.length ? `del ${ev.falta.join(' y del ')}` : 'del ajuste'}.</strong>{' '}
          Registra el documento emitido en BSALE para validar el inventario contra el sistema.
          {urgente && <> Este inventario se cerró hace {diasDesde} días.</>}
        </div>
      )}
      {ev.legado && ev.estado === 'RESPALDADO' && (
        <div style={{ fontSize:11.5, color:AJ.slate, marginBottom:10, lineHeight:1.5 }}>
          Respaldado con un solo comprobante, antes de separar ajuste y consumo. Cuenta como completo.
        </div>
      )}
      {ev.estado === 'EXCEPCION' && (
        <div style={{ fontSize:11.5, color:AJ.slate, marginBottom:10, lineHeight:1.5 }}>
          Excepción registrada por {inv?.ajuste_registrado_nombre || '—'}: {inv?.ajuste_observacion || 'sin motivo'}.
          Si registras los documentos, la excepción se quita.
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(300px, 1fr))', gap:10 }}>
        <DocBsale tipo="ajuste" inv={inv} cu={cu} requerido={ev.requiereAjuste} opcional={false}
          resumen={res.sobr} puedeRegistrar={puedeRegistrar} sugeridos={[]} netaApp={res.neta} onGuardado={guardado}/>
        <DocBsale tipo="consumo" inv={inv} cu={cu} requerido={ev.requiereConsumo && !ev.legado}
          opcional={ev.legado && ev.requiereConsumo} resumen={res.falt} puedeRegistrar={puedeRegistrar}
          sugeridos={candidatos} netaApp={res.neta} onGuardado={guardado}/>
      </div>

      {esAdmin && ev.estado === 'PENDIENTE' && (
        !verExcepcion ? (
          <button type="button" onClick={() => setVerExcepcion(true)} style={{ ...btn('link'), marginTop:8, fontSize:11 }}>
            Registrar una excepción (solo administradores)
          </button>
        ) : (
          <div style={{ marginTop:10 }}>
            <textarea value={motivoEx} onChange={e => { setMotivoEx(e.target.value); setErrorEx('') }}
              placeholder="Por qué estas diferencias no se respaldan con documentos BSALE"
              style={{ ...inp('100%'), minHeight:44, resize:'vertical', display:'block', marginBottom:8 }}/>
            {errorEx && <div role="alert" style={{ fontSize:11.5, color:AJ.rojo, fontWeight:600, marginBottom:8 }}>{errorEx}</div>}
            <div style={{ display:'flex', gap:8 }}>
              <button type="button" onClick={excepcion} style={btn('outline')}>Registrar excepción</button>
              <button type="button" onClick={() => { setVerExcepcion(false); setErrorEx('') }} style={btn('ghost')}>Cancelar</button>
            </div>
          </div>
        )
      )}
    </div>
  )
}
