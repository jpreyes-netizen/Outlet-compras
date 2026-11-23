// ═══════════════════════════════════════════════════════════════════════════
// InvCorregirFecha.jsx — Corrección de la fecha de un inventario cerrado
// Outlet de Puertas · Módulo Logística
//
// Un inventario puede quedar con una fecha que no es la del conteo; por
// ejemplo, un histórico importado con la fecha del día de carga. El rol admin
// de Logística puede corregirla con motivo obligatorio, y el cambio queda en
// historial_estados como entrada tipo CAMBIO_FECHA: quién, cuándo, de qué
// fecha a cuál y por qué.
//
// Corrige la fecha efectiva, la misma que leen las vistas e informes
// (COALESCE(fecha_ejecucion_real, fecha_planificada)):
//   · con fecha_ejecucion_real → corrige esa; la planificada se mantiene
//   · sin ella                 → corrige fecha_planificada
//   · en históricos, además    → fecha_corte_stock (se deriva de la fecha del conteo)
// El id del inventario no cambia: es la llave de las líneas y del comprobante.
//
// También exporta los helpers de fecha que usa el importador de históricos
// (leerMetaBD / leerFechaExcel), para que nunca vuelva a rellenar con hoy.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState } from 'react'
import { supabase } from '../supabase'

const CF = {
  navy:'#16213E', ink:'#1C1C1E', slate:'#6E6E73', line:'#DADADF',
  rojo:'#B42318', ambar:'#B25E09',
}

/** Fecha de hoy en Chile (YYYY-MM-DD), sin depender de UTC ni de la zona del PC. */
export const hoyCL = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })

/** 'YYYY-MM-DD…' → 'DD-MM-YYYY'. Usa solo la parte de fecha: no convierte zona horaria. */
export const fmtFechaCL = f => {
  const s = String(f || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('-') : '—'
}

/** Por qué no se pudo usar la fecha del Excel (se muestra en el importador). */
export const AVISO_FECHA_EXCEL = {
  no_encontrada: 'El Excel no trae "Fecha Termino" en la hoja BD.',
  vacia:         'En el Excel, "Fecha Termino" está vacía.',
  formula:       'En el Excel la fecha es una fórmula =HOY(), que cambia cada vez que se abre el archivo.',
  ilegible:      'No se pudo leer la fecha que trae el Excel.',
  fuera_rango:   'La fecha que trae el Excel es anterior a 2020.',
  futura:        'La fecha que trae el Excel es futura.',
}

/**
 * Lee una fecha desde una celda de SheetJS.
 * Acepta número de serie de Excel (lo normal: SheetJS no convierte las fechas si
 * no se lee con cellDates), objeto Date o texto dd-mm-aaaa, dd/mm/aaaa o aaaa-mm-dd.
 * Rechaza fórmulas volátiles (=HOY(), =AHORA()): su valor es el día en que se
 * abrió el archivo, no el del conteo.
 * @returns {{fecha: string|null, motivo: null|'vacia'|'formula'|'ilegible'|'fuera_rango'|'futura'}}
 */
export function leerFechaExcel(cell, { date1904 = false } = {}) {
  if (!cell || cell.v === null || cell.v === undefined || String(cell.v).trim() === '')
    return { fecha: null, motivo: 'vacia' }
  if (cell.f && /\b(TODAY|NOW|HOY|AHORA)\s*\(/i.test(String(cell.f)))
    return { fecha: null, motivo: 'formula' }

  const v = cell.v
  let y = 0, m = 0, d = 0
  if (v instanceof Date && !isNaN(v)) {
    y = v.getFullYear(); m = v.getMonth() + 1; d = v.getDate()
  } else if (typeof v === 'number' && isFinite(v)) {
    // Serie de Excel → días desde 1970 (25569 = 01-01-1970 en el sistema 1900)
    const dt = new Date(Math.round((v - 25569 + (date1904 ? 1462 : 0)) * 86400000))
    y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate()
  } else {
    const s = String(v).trim()
    let k
    if ((k = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/)))           { y = +k[1]; m = +k[2]; d = +k[3] }
    else if ((k = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/))) { d = +k[1]; m = +k[2]; y = +k[3]; if (y < 100) y += 2000 }
  }
  if (!y || !m || !d) return { fecha: null, motivo: 'ilegible' }
  const chk = new Date(Date.UTC(y, m - 1, d))
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== m - 1 || chk.getUTCDate() !== d)
    return { fecha: null, motivo: 'ilegible' }
  const fecha = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  if (fecha < '2020-01-01') return { fecha: null, motivo: 'fuera_rango' }
  if (fecha > hoyCL())      return { fecha: null, motivo: 'futura' }
  return { fecha, motivo: null }
}

/**
 * Lee sucursal y fecha del conteo desde la hoja BD de la planilla de inventario.
 * Recorre las celdas (no sheet_to_json) para poder ver si la fecha es una fórmula.
 * Etiqueta en la primera columna del rango y valor en la siguiente, igual que antes.
 * @returns {{sucExcel: string, fechaExcel: string, avisoFecha: string}}
 *          avisoFecha = '' si la fecha es confiable; si no, una clave de AVISO_FECHA_EXCEL
 */
export function leerMetaBD(XLSX, wb) {
  const out = { sucExcel: '', fechaExcel: '', avisoFecha: 'no_encontrada' }
  const sh = wb?.Sheets?.['BD']
  if (!sh || !sh['!ref']) return out
  const rg = XLSX.utils.decode_range(sh['!ref'])
  const date1904 = !!wb.Workbook?.WBProps?.date1904
  for (let r = rg.s.r; r <= rg.e.r; r++) {
    const etq = sh[XLSX.utils.encode_cell({ r, c: rg.s.c })]
    const val = sh[XLSX.utils.encode_cell({ r, c: rg.s.c + 1 })]
    const k = String(etq?.v ?? '').trim()
    if (k === 'Sucursal') out.sucExcel = String(val?.v ?? '').trim()
    if (/^fecha\s+t[eé]rmino$/i.test(k)) {
      const lf = leerFechaExcel(val, { date1904 })
      out.fechaExcel = lf.fecha || ''
      out.avisoFecha = lf.motivo || ''
    }
  }
  return out
}

/**
 * Corrige la fecha efectiva de un inventario cerrado y deja la huella en el historial.
 * Separada del componente para poder probarla con un cliente simulado (sb).
 * @returns {Promise<object>} la cabecera actualizada
 */
export async function corregirFechaInventario({ inv, cu, nueva, motivo, sb = supabase }) {
  if (!inv?.id) throw new Error('No se encontró el inventario.')
  if (cu?.rol !== 'admin' || cu?._simulado)
    throw new Error('Solo un administrador de Logística puede corregir la fecha.')
  if (inv.estado !== 'CERRADO') throw new Error('Solo se corrige la fecha de inventarios cerrados.')

  const campo  = inv.fecha_ejecucion_real ? 'fecha_ejecucion_real' : 'fecha_planificada'
  const actual = String(inv[campo] || '').slice(0, 10)
  const f   = String(nueva || '').trim()
  const mot = String(motivo || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new Error('Indica la fecha en que se hizo el conteo.')
  if (f === actual)     throw new Error('La fecha nueva es igual a la actual.')
  if (f > hoyCL())      throw new Error('La fecha no puede ser futura.')
  if (f < '2020-01-01') throw new Error('La fecha no puede ser anterior a 2020.')
  if (mot.length < 10)  throw new Error('Escribe el motivo del cambio (al menos 10 caracteres).')

  const ahora = new Date()
  const entrada = {
    estado: 'CAMBIO_FECHA', tipo: 'CAMBIO_FECHA', campo,
    fecha_anterior: actual, fecha_nueva: f, motivo: mot,
    usuario: cu?.nombre || '—', usuario_id: cu?.id || null,
    fecha: hoyCL(),
    hora: ahora.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' }),
    timestamp: ahora.toISOString(),
  }
  const cambios = { [campo]: f, historial_estados: [...(inv.historial_estados || []), entrada] }
  if (inv.es_historico) cambios.fecha_corte_stock = f + 'T00:00:00.000Z'

  // Solo escribe si la fecha sigue siendo la que se estaba viendo: no pisa un cambio paralelo
  const { data, error } = await sb.from('log_inv_cabeceras')
    .update(cambios).eq('id', inv.id).eq(campo, actual).select('*')
  if (error) {
    if (error.code === '23505')
      throw new Error('Ya hay otro inventario histórico de esta sucursal con el mismo folio en esa fecha. Revisa si es un duplicado antes de cambiarla.')
    throw new Error(error.message || 'No se pudo guardar la fecha.')
  }
  if (!data || data.length === 0)
    throw new Error('La fecha de este inventario cambió mientras la editabas. Vuelve a abrirlo y repite el cambio.')
  return data[0]
}

const btn = v => ({
  fontFamily:'inherit', fontSize:11.5, fontWeight:600, cursor:'pointer', borderRadius:3,
  padding: v === 'link' ? '2px 0' : '7px 14px', whiteSpace:'nowrap',
  ...(v === 'solid' ? { background:CF.navy, color:'#fff', border:`1px solid ${CF.navy}` }
    : v === 'link'  ? { background:'transparent', color:CF.ambar, border:'none',
                        textDecoration:'underline', textUnderlineOffset:2 }
    :                 { background:'transparent', color:CF.slate, border:'1px solid transparent' }),
})
const inp = w => ({
  fontFamily:'inherit', fontSize:12, color:CF.ink, background:'#fff', boxSizing:'border-box',
  border:`1px solid ${CF.line}`, borderRadius:3, padding:'6px 9px', width:w, outline:'none',
})

/**
 * "Corregir fecha" + formulario en línea, en la cabecera del inventario.
 * No muestra nada si el usuario no es admin real (no simulado) o el inventario no está cerrado.
 * @param inv          cabecera (log_inv_cabeceras)
 * @param cu           usuario efectivo de Logística
 * @param onCorregida  recibe la cabecera actualizada
 */
export default function InvCorregirFecha({ inv, cu, onCorregida }) {
  const [abierto, setAbierto]     = useState(false)
  const [nueva, setNueva]         = useState('')
  const [motivo, setMotivo]       = useState('')
  const [error, setError]         = useState('')
  const [guardando, setGuardando] = useState(false)

  if (cu?.rol !== 'admin' || cu?._simulado || inv?.estado !== 'CERRADO') return null

  const campo   = inv.fecha_ejecucion_real ? 'fecha_ejecucion_real' : 'fecha_planificada'
  const actual  = String(inv[campo] || '').slice(0, 10)
  const alcance = campo === 'fecha_ejecucion_real'
    ? 'Cambia la fecha de ejecución. La planificada se mantiene.'
    : inv.es_historico ? 'Cambia la fecha del conteo y la del corte de stock.' : 'Cambia la fecha del inventario.'

  async function guardar() {
    setGuardando(true); setError('')
    try {
      const fresca = await corregirFechaInventario({ inv, cu, nueva, motivo })
      setAbierto(false); setMotivo('')
      onCorregida && onCorregida(fresca)
    } catch (e) { setError(e.message || String(e)) }
    setGuardando(false)
  }

  if (!abierto) return (
    <div style={{ marginTop:6 }}>
      <button type="button" style={btn('link')}
        onClick={() => { setNueva(actual); setMotivo(''); setError(''); setAbierto(true) }}
        title="Solo administradores de Logística. El cambio queda en el historial del inventario.">
        Corregir fecha
      </button>
    </div>
  )

  return (
    <div style={{ marginTop:10, border:`1px solid ${CF.line}`, borderLeft:`3px solid ${CF.ambar}`,
      borderRadius:3, background:'#fff', padding:'10px 12px' }}>
      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', fontSize:12,
        color:CF.ink, marginBottom:8 }}>
        <span>Fecha actual <strong>{fmtFechaCL(actual)}</strong></span>
        <label style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
          Fecha real del conteo
          <input type="date" value={nueva} min="2020-01-01" max={hoyCL()} style={inp(150)}
            onChange={e => { setNueva(e.target.value); setError('') }} />
        </label>
        <span style={{ fontSize:11, color:CF.slate }}>{alcance}</span>
      </div>
      <textarea value={motivo} onChange={e => { setMotivo(e.target.value); setError('') }}
        placeholder="Motivo del cambio (obligatorio): quién lo pidió y por qué la fecha registrada no corresponde"
        style={{ ...inp('100%'), minHeight:44, resize:'vertical', display:'block' }} />
      {error && (
        <div role="alert" style={{ marginTop:8, padding:'7px 11px', borderRadius:3, fontSize:11.5,
          fontWeight:600, background:'#FCF3F1', color:CF.rojo }}>{error}</div>
      )}
      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginTop:8 }}>
        <button type="button" onClick={guardar} disabled={guardando} style={btn('solid')}>
          {guardando ? 'Guardando…' : 'Guardar fecha'}
        </button>
        <button type="button" onClick={() => { setAbierto(false); setError('') }} disabled={guardando}
          style={btn('ghost')}>
          Cancelar
        </button>
        <span style={{ fontSize:10.5, color:CF.slate, marginLeft:'auto' }}>
          El código del inventario no cambia. El cambio queda en el historial.
        </span>
      </div>
    </div>
  )
}
