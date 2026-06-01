import { useEffect, useRef, useState, useMemo } from 'react'
import { toast } from 'sonner'
import { Plus, Paperclip, FileCheck, Loader2, Upload, ChevronDown, ChevronUp } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabase'
import { preloadCaps, canSync, userScopeSync } from '../../core/permisos'
import {
  formatCLP, parseCLP, rangoMes,
  inputSt, selectSt, labelSt, cardSt, btnSt, btnOutlineSt, TH, TD,
} from './types'
import { fetchDepositosEfectivo, fetchAbonos, fetchSucursales, insertGenerico } from './api'

// RBAC-6: PUEDE_ESCRIBIR reemplazado por canSync(usuario, 'finanzas', 'fin.teso.dep.escribir')
const TIPOS_PERMITIDOS = ['application/pdf','image/jpeg','image/jpg','image/png']
const MAX_BYTES = 5 * 1024 * 1024
const fmt = n => formatCLP(n ?? 0)

// ── Storage helpers ───────────────────────────────────────────────────────────
function validarComprobante(file) {
  if (!TIPOS_PERMITIDOS.includes(file.type)) throw new Error('Solo PDF, JPG o PNG')
  if (file.size > MAX_BYTES) throw new Error('Máximo 5 MB')
}
async function subirComprobante(file, sucursalId, id, bucket = 'comprobantes-depositos') {
  const ext = file.name.split('.').pop()
  const path = `${sucursalId}/${id}.${ext}`
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true, contentType: file.type })
  if (error) throw error
  return path
}
async function abrirComprobante(url, bucket = 'comprobantes-depositos') {
  if (!url) return
  // URL externa (Drive, Dropbox, etc.) — abrir directo
  if (url.startsWith('http://') || url.startsWith('https://')) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  // Path interno en Supabase Storage — generar URL firmada
  try {
    let path = url
    const marker = `/${bucket}/`
    const idx = url.indexOf(marker)
    if (idx >= 0) path = url.substring(idx + marker.length)
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60)
    if (error) throw error
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo abrir') }
}

// ── Getnet Excel helpers ──────────────────────────────────────────────────────
const LOCAL_MAP = {
  'OUTLET DE PUERTAS SPA': 'suc-lg', 'OUTLET DE PUERTAS': 'suc-lg', 'LA GRANJA': 'suc-lg',
  'LOS ANGELES': 'suc-la', 'LOS ÁNGELES': 'suc-la', 'CD MAIPÚ': 'suc-mp', 'MAIPU': 'suc-mp',
}
function getSucId(local) { return LOCAL_MAP[(local||'').trim().toUpperCase()] || null }

function parseFechaStr(v) {
  // dd/mm/yyyy o dd/mm/yyyy hh:mm:ss → yyyy-mm-dd
  if (!v) return null
  if (v instanceof Date) return v.toISOString().slice(0,10)
  const s = String(v).trim()
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10)
  return null
}

function normalizarTipo(v) {
  const s = String(v||'').trim()
  if (/déb|deb|prepago/i.test(s)) return 'Débito'
  if (/cré|cred/i.test(s)) return 'Crédito'
  return 'Otro'
}

// Parsea reporte "Ventas" Getnet → getnet_detalle_abonos
function procesarExcelVentasGetnet(buffer) {
  const wb   = XLSX.read(buffer, { type: 'array', raw: true })
  const ws   = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
  const HDR  = {}
  ;(rows[0]||[]).forEach((h,i) => { if (h) HDR[String(h).trim().toUpperCase()] = i })

  const toN  = v => { if (v==null) return 0; if (typeof v==='number') return Math.round(v); const n=parseFloat(String(v).replace(/[^0-9.-]/g,'')); return isNaN(n)?0:Math.round(n) }
  const toF  = v => { if (!v) return null; if (v instanceof Date) return v.toISOString().slice(0,10); return parseFechaStr(v) }
  const toFT = v => {
    if (!v) return null
    if (v instanceof Date) return v.toISOString().slice(0,10)
    const s = String(v).trim()
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
    if (m) return `${m[3]}-${m[2]}-${m[1]}`
    return null
  }

  return rows.slice(1).filter(r => r && r[HDR['COD.AUT']] != null).map(r => {
    const tipo = normalizarTipo(r[HDR['TIPO']])
    return {
      num_abono:        null,  // se llena al importar Abonos
      tipo_movimiento:  String(r[HDR['TIPO MOV.']]||'').trim() || 'Venta',
      cod_autorizacion: String(r[HDR['COD.AUT']]||'').trim(),
      fecha_venta:      toFT(r[HDR['FECHA VENTA']]),
      fecha_abono:      toF(r[HDR['FECHA ABONO']]),
      local_getnet:     String(r[HDR['LOCAL']]||'').trim(),
      num_local:        String(r[HDR['NUM LOCAL']]||'').trim(),
      sucursal_id:      getSucId(String(r[HDR['LOCAL']]||'')),
      tipo,
      valor_cuota:      toN(r[HDR['VALOR VENTA']]),
      comision_cuota:   -Math.abs(toN(r[HDR['COMISIÓN']])),
      iva_cuota:        0,
      monto_abono:      toN(r[HDR['MONTO ABONO']]),
      cuota:            String(r[HDR['CUOTAS']]||'1'),
      plan_venta:       String(r[HDR['TIPO MOV.']]||'').trim(),
      tarjeta:          String(r[HDR['BIN']]||'').trim(),
      canal_venta:      'Canal POS',
      archivo_origen:   'Ventas Getnet',
    }
  }).filter(r => r.fecha_venta && r.valor_cuota > 0)
}

// Parsea reporte "Detalle Abonos por Período" Getnet → getnet_detalle_abonos
function procesarExcelDetalleAbonos(buffer) {
  const wb   = XLSX.read(buffer, { type: 'array', raw: true })
  const ws   = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
  const HDR  = {}
  ;(rows[0]||[]).forEach((h,i) => { if (h) HDR[String(h).trim().toUpperCase()] = i })

  const toN = v => { if (v==null) return 0; if (typeof v==='number') return Math.round(v); const n=parseFloat(String(v).replace(/[^0-9.-]/g,'')); return isNaN(n)?0:Math.round(n) }
  const toF = v => { if (!v) return null; if (v instanceof Date) return v.toISOString().slice(0,10); return parseFechaStr(v) }

  return rows.slice(1).filter(r => r && r[HDR['CÓDIGO DE AUTORIZACIÓN']] != null).map(r => {
    const tipo = normalizarTipo(r[HDR['TIPO']])
    return {
      num_abono:        String(r[HDR['NUM. ABONO']]||'').trim() || null,
      tipo_movimiento:  String(r[HDR['TIPO DE MOVIMIENTO']]||'').trim() || 'Venta',
      cod_autorizacion: String(r[HDR['CÓDIGO DE AUTORIZACIÓN']]||'').trim(),
      fecha_venta:      toF(r[HDR['FECHA DE VENTA']]),
      fecha_abono:      null,
      local_getnet:     String(r[HDR['LOCAL']]||'').trim(),
      num_local:        String(r[HDR['NÚMERO DE LOCAL']]||'').trim(),
      sucursal_id:      getSucId(String(r[HDR['LOCAL']]||'')),
      tipo,
      valor_cuota:      toN(r[HDR['VALOR CUOTA']]),
      comision_cuota:   toN(r[HDR['COMISIÓN CUOTA']]),
      iva_cuota:        toN(r[HDR['IVA CUOTA']]),
      monto_abono:      toN(r[HDR['MONTO DE ABONO']]),
      cuota:            String(r[HDR['CUOTA']]||'1/1'),
      plan_venta:       String(r[HDR['PLAN DE VENTA']]||'').trim(),
      tarjeta:          String(r[HDR['TARJETA']]||'').trim(),
      canal_venta:      String(r[HDR['CANAL DE VENTA']]||'').trim(),
      archivo_origen:   'Detalle Abonos Getnet',
    }
  }).filter(r => r.fecha_venta && r.valor_cuota > 0)
}

// Parsea reporte "Abonos" Getnet → getnet_abonos
function procesarExcelAbonos(buffer) {
  const wb   = XLSX.read(buffer, { type: 'array', raw: true })
  const ws   = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
  const HDR  = {}
  ;(rows[0]||[]).forEach((h,i) => { if (h) HDR[String(h).trim().toUpperCase()] = i })
  const toN = v => { if (v==null) return 0; if (typeof v==='number') return Math.round(v); const n=parseFloat(String(v).replace(/[^0-9.-]/g,'')); return isNaN(n)?0:Math.round(n) }
  const toF = v => { if (!v) return null; if (v instanceof Date) return v.toISOString().slice(0,10); return parseFechaStr(v) }
  return rows.slice(1).filter(r => r && r[HDR['Nº']] != null).map(r => ({
    num_abono:    String(r[HDR['Nº']]||'').trim(),
    fecha_abono:  toF(r[HDR['FECHA ABONO']]),
    local_getnet: String(r[HDR['LOCAL']]||'').trim(),
    sucursal_id:  getSucId(String(r[HDR['LOCAL']]||'')),
    valor:        toN(r[HDR['VALOR']]),
    info_abono:   String(r[HDR['INFORMACIÓN ABONO']]||'').trim()||null,
    cant_ventas:  parseInt(String(r[HDR['CANT. VENTAS']]||'0'))||0,
    estado_abono: String(r[HDR['ESTADO ABONO']]||'Abonado').trim(),
    archivo_origen: 'Abonos Getnet',
  })).filter(r => r.num_abono && r.fecha_abono)
}

// ── Componente ImportadorGetnet (3 sub-tabs) ──────────────────────────────────
function ImportadorGetnet() {
  const [subTab, setSubTab]     = useState('ventas')
  const [dragOver, setDragOver] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [preview, setPreview]   = useState(null)
  const [resultado, setResultado] = useState(null)
  const fileRef = useRef()

  const SUBTABS = [
    { k: 'ventas',   l: 'Reporte Ventas',         desc: 'Archivo "Ventas..." de Getnet. Una fila por transacción.' },
    { k: 'detalle',  l: 'Detalle Abonos',          desc: 'Archivo "DetalleAbonosPorPeriodo..." de Getnet. Más detallado.' },
    { k: 'abonos',   l: 'Abonos (banco)',           desc: 'Archivo "Abonos..." de Getnet. Registro de abonos bancarios.' },
  ]

  function resetState() { setPreview(null); setResultado(null); setDragOver(false) }

  async function parsear(file) {
    if (!file) return
    resetState()
    try {
      const buf = new Uint8Array(await file.arrayBuffer())
      let rows = []
      if (subTab === 'ventas')  rows = procesarExcelVentasGetnet(buf)
      if (subTab === 'detalle') rows = procesarExcelDetalleAbonos(buf)
      if (subTab === 'abonos')  rows = procesarExcelAbonos(buf)
      if (!rows.length) { setResultado({ ok: false, msg: 'No se encontraron filas válidas.' }); return }
      setPreview({ rows, file: file.name })
    } catch (e) { setResultado({ ok: false, msg: e instanceof Error ? e.message : 'Error al leer' }) }
  }

  async function confirmar() {
    if (!preview) return
    setLoading(true); setResultado(null)
    try {
      const tabla = subTab === 'abonos' ? 'getnet_abonos' : 'getnet_detalle_abonos'
      const conflicto = subTab === 'abonos' ? 'num_abono' : 'cod_autorizacion, fecha_venta, valor_cuota, tipo'
      let ins = 0, dup = 0
      for (let i = 0; i < preview.rows.length; i += 500) {
        const lote = preview.rows.slice(i, i+500)
        const { data, error } = await supabase.from(tabla)
          .upsert(lote, { onConflict: conflicto, ignoreDuplicates: true }).select('id')
        if (error) throw error
        ins += (data||[]).length; dup += lote.length - (data||[]).length
      }
      setResultado({ ok: true, msg: `✓ ${ins} insertadas · ${dup} duplicadas ignoradas` })
      setPreview(null)
    } catch (e) { setResultado({ ok: false, msg: e instanceof Error ? e.message : 'Error' }) }
    finally { setLoading(false) }
  }

  const config = SUBTABS.find(t => t.k === subTab)

  // Columnas de preview según subTab
  const previewCols = subTab === 'abonos'
    ? [['num_abono','N° Abono'],['fecha_abono','Fecha abono'],['local_getnet','Local'],['valor','Valor'],['cant_ventas','Transacciones']]
    : [['fecha_venta','Fecha venta'],['tipo','Tipo'],['local_getnet','Local'],['cod_autorizacion','Cód. Aut.'],['valor_cuota','Bruto'],['monto_abono','Neto abono']]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #E5E7EB' }}>
        {SUBTABS.map(t => (
          <button key={t.k} onClick={() => { setSubTab(t.k); resetState() }}
            style={{ padding: '7px 14px', fontSize: 12, fontWeight: 600, background: 'none', border: 'none',
              cursor: 'pointer', color: subTab===t.k ? '#1F4E79' : '#6B7280',
              borderBottom: `2px solid ${subTab===t.k ? '#1F4E79' : 'transparent'}` }}>
            {t.l}
          </button>
        ))}
      </div>

      <div style={cardSt}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Importar: {config.l}</div>
        <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>{config.desc}</div>

        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); parsear(e.dataTransfer.files[0]) }}
          onClick={() => fileRef.current?.click()}
          style={{ border: `2px dashed ${dragOver ? '#1F4E79' : '#D1D5DB'}`, borderRadius: 10,
            padding: '28px 20px', textAlign: 'center', cursor: 'pointer',
            background: dragOver ? '#EFF6FF' : '#FAFAFA', transition: 'all 0.2s' }}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
            onChange={e => { parsear(e.target.files?.[0]); e.target.value='' }} />
          {loading
            ? <Loader2 size={22} style={{ display: 'inline-block', color: '#1F4E79' }} />
            : <><Upload size={22} color="#9CA3AF" />
                <div style={{ marginTop: 8, fontSize: 13, color: '#6B7280' }}>Arrastra el Excel o haz clic para seleccionar</div>
              </>}
        </div>

        {resultado && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, fontSize: 12,
            background: resultado.ok ? '#DCFCE7' : '#FEE2E2', color: resultado.ok ? '#166534' : '#991B1B' }}>
            {resultado.msg}
          </div>
        )}
      </div>

      {/* Preview */}
      {preview && (
        <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #F3F4F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Vista previa — {preview.rows.length} filas</span>
              <span style={{ fontSize: 11, color: '#6B7280', marginLeft: 10 }}>{preview.file}</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={resetState} style={btnOutlineSt}>Cancelar</button>
              <button onClick={confirmar} disabled={loading} style={{ ...btnSt('#1F4E79'), opacity: loading ? 0.6 : 1 }}>
                {loading ? <Loader2 size={13} /> : null} Importar {preview.rows.length} filas
              </button>
            </div>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, background: '#F9FAFB' }}>
                <tr>{previewCols.map(([k,l]) => <th key={k} style={TH}>{l}</th>)}</tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 100).map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #F3F4F6' }}>
                    {previewCols.map(([k]) => (
                      <td key={k} style={{ ...TD, fontWeight: ['valor_cuota','monto_abono','valor'].includes(k) ? 600 : 400,
                        color: k==='tipo' ? (r[k]==='Crédito'?'#7C3AED':'#1E40AF') : 'inherit' }}>
                        {['valor_cuota','monto_abono','valor'].includes(k) ? formatCLP(r[k]) : String(r[k]??'—')}
                      </td>
                    ))}
                  </tr>
                ))}
                {preview.rows.length > 100 && (
                  <tr><td colSpan={previewCols.length} style={{ ...TD, color: '#9CA3AF', textAlign: 'center' }}>
                    ... y {preview.rows.length - 100} filas más
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
function MoneyInput({ value, onChange, disabled }) {
  const [text, setText] = useState(value ? formatCLP(value) : '')
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setText(value ? formatCLP(value) : '') }, [value, focused])
  return (
    <input type="text" inputMode="numeric" disabled={disabled} placeholder="$0" value={text}
      style={{ ...inputSt, textAlign: 'right', background: disabled ? '#F9FAFB' : '#fff' }}
      onFocus={e => { setFocused(true); setText(value ? String(value) : ''); setTimeout(() => e.target.select(), 0) }}
      onChange={e => { setText(e.target.value); onChange(parseCLP(e.target.value)) }}
      onBlur={() => { setFocused(false); setText(value ? formatCLP(value) : '') }}
    />
  )
}
function KpiMini({ title, value, color }) {
  return (
    <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 14px', border: '1px solid #F3F4F6' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#9CA3AF', letterSpacing: '0.05em' }}>{title}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color ?? '#111827', marginTop: 3 }}>{value}</div>
    </div>
  )
}
function ComprobanteCell({ tabla, rowId, sucursalId, url, nombre, onUpdated }) {
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  async function onFileChange(e) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    try { validarComprobante(file) } catch (e) { toast.error(e.message); return }
    setUploading(true)
    try {
      const path = await subirComprobante(file, sucursalId, rowId)
      const { error } = await supabase.from(tabla).update({ comprobante_url: path, comprobante_nombre: file.name }).eq('id', rowId)
      if (error) throw error
      toast.success('Comprobante adjuntado')
      onUpdated()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error al subir') }
    finally { setUploading(false) }
  }
  return (
    <>
      <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={onFileChange} />
      {url ? (
        <button onClick={() => abrirComprobante(url)} title={nombre ?? 'Ver comprobante'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#16A34A', display: 'inline-flex', alignItems: 'center' }}>
          <FileCheck size={16} />
        </button>
      ) : (
        <button onClick={() => inputRef.current?.click()} disabled={uploading}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', display: 'inline-flex', alignItems: 'center' }}>
          {uploading ? <Loader2 size={14} /> : <Paperclip size={16} />}
        </button>
      )}
    </>
  )
}


// ── Importador Webpay / Transbank ────────────────────────────────────────────
function ImportadorWebpay() {
  const fileRef    = useRef()
  const [dragOver, setDragOver]     = useState(false)
  const [loading, setLoading]       = useState(false)
  const [preview, setPreview]       = useState(null)
  const [resultado, setResultado]   = useState(null)

  function parsearTransbank(buffer) {
    const wb   = XLSX.read(buffer, { type: 'array', raw: false, cellDates: true })
    const ws   = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null })

    // Buscar fila de encabezados (contiene "Fecha de venta")
    let headerRow = -1
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].some(c => c && String(c).includes('Fecha de venta'))) { headerRow = i; break }
    }
    if (headerRow < 0) throw new Error('No se encontró la fila de encabezados. Verifica que es una Cartola de Movimientos Transbank.')

    // Columnas fijas por posición (el header está en col B=1)
    // Col: 1=FechaVenta, 2=CodComercio, 4=NombreLocal, 5=TipoMov, 6=TipoTarjeta
    //      7=NTarjeta, 8=CodAut, 9=OrdenPedido, 10=NumeroUnico, 12=TipoCuota
    //      13=MontoAfecto, 14=MontoExento, 15=NCuotas, 16=MontoCuota, 17=FechaAbono
    //      18=NBoleta, 19=MontoVuelto

    const toN = v => { if (!v) return 0; const n = parseFloat(String(v).replace(/[^0-9.-]/g,'')); return isNaN(n)?0:Math.round(n) }
    const toFechaVenta = v => {
      if (!v) return null
      const s = String(v).trim()
      // dd/mm/yyyy HH:MM AM/PM → guardar como timestamp Chile (sin conversión UTC)
      const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i)
      if (m) {
        let h = parseInt(m[4])
        if (m[6]?.toUpperCase() === 'PM' && h !== 12) h += 12
        if (m[6]?.toUpperCase() === 'AM' && h === 12) h = 0
        // Usar -04:00 (Chile) para evitar que medianoche caiga en día anterior al convertir a UTC
        return `${m[3]}-${m[2]}-${m[1]}T${String(h).padStart(2,'0')}:${m[5]}:00-04:00`
      }
      // Solo fecha dd/mm/yyyy
      const m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
      if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}T12:00:00-04:00`
      return null
    }
    const toFechaAbono = v => {
      if (!v || String(v).trim() === '-') return null
      const s = String(v).trim()
      const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
      if (m) return `${m[3]}-${m[2]}-${m[1]}`
      return null
    }

    const result = []
    for (let i = headerRow + 2; i < rows.length; i++) {
      const r = rows[i]
      if (!r || !r[1]) continue  // fila vacía
      const tipoMov = String(r[5] || '').trim()
      if (!tipoMov || tipoMov === 'Tipo de movimiento') continue
      const numUnico = String(r[10] || '').trim()
      if (!numUnico || numUnico === '-') continue
      const fechaVenta = toFechaVenta(r[1])
      if (!fechaVenta) continue

      result.push({
        cod_autorizacion: String(r[8] || '').trim() || null,
        numero_unico:     numUnico,
        orden_pedido:     String(r[9] || '').trim() || null,
        cod_comercio:     String(r[2] || '').trim() || null,
        nombre_local:     String(r[4] || '').trim() || null,
        tipo_movimiento:  tipoMov,
        tipo_tarjeta:     String(r[6] || '').trim() || null,
        fecha_venta:      fechaVenta,
        fecha_abono:      toFechaAbono(r[17]),
        monto_afecto:     toN(r[13]),
        monto_exento:     toN(r[14]),
        monto_cuota:      toN(r[16]),
        monto_vuelto:     toN(r[19]),
        n_cuotas:         String(r[15] || '').trim() || null,
        tipo_cuota:       String(r[12] || '').trim() || null,
        n_tarjeta_mask:   String(r[7] || '').trim() || null,
        n_boleta:         String(r[18] || '').trim() || null,
        archivo_origen:   'Cartola Transbank',
      })
    }
    return result
  }

  async function parsear(file) {
    if (!file) return
    setPreview(null); setResultado(null)
    try {
      const buf  = new Uint8Array(await file.arrayBuffer())
      const rows = parsearTransbank(buf)
      if (!rows.length) { setResultado({ ok: false, msg: 'No se encontraron transacciones.' }); return }
      setPreview({ rows, file: file.name })
    } catch (e) { setResultado({ ok: false, msg: e instanceof Error ? e.message : 'Error al leer' }) }
  }

  async function confirmar() {
    if (!preview) return
    setLoading(true); setResultado(null)
    try {
      // 1) Insertar transacciones Webpay
      let ins = 0, dup = 0
      const soloVentas = preview.rows.filter(r => r.tipo_movimiento === 'Venta')
      for (let i = 0; i < preview.rows.length; i += 500) {
        const lote = preview.rows.slice(i, i+500)
        const { data, error } = await supabase.from('webpay_transacciones')
          .upsert(lote, { onConflict: 'numero_unico', ignoreDuplicates: true }).select('id')
        if (error) throw error
        ins += (data||[]).length; dup += lote.length - (data||[]).length
      }

      // 2) Agrupar ventas por fecha (usando fecha_venta_date = fecha local Chile)
      const porFecha = {}
      for (const r of soloVentas) {
        // Extraer fecha local desde el timestamp -04:00
        const fecha = r.fecha_venta?.slice(0, 10)
        if (!fecha) continue
        if (!porFecha[fecha]) porFecha[fecha] = 0
        porFecha[fecha] += r.monto_afecto
      }

      // 3) Para cada fecha, verificar si ya existe cierre de suc-web y crearlo si no
      let cierresCreados = 0, cierresExistentes = 0
      for (const [fecha, totalWebpay] of Object.entries(porFecha)) {
        // Verificar si ya existe
        const { data: existe } = await supabase.from('cierres_caja')
          .select('id')
          .eq('fecha', fecha)
          .eq('sucursal_id', 'suc-web')
          .eq('bsale_vendedor_id', '33')
          .maybeSingle()

        if (existe) { cierresExistentes++; continue }

        // Crear cierre automático
        const cierre = {
          fecha,
          sucursal_id:           'suc-web',
          vendedor_id:           'USR-FIN-013',
          bsale_vendedor_id:     33,              // integer, no string
          // Declarado
          webpay:                totalWebpay,
          efectivo: 0, t_credito: 0, t_debito: 0, transferencia: 0,
          m_pago: 0, abono_cliente: 0, canje: 0, p_clay: 0, cheque: 0,
          // Corroborado
          webpay_corrob:         totalWebpay,
          efectivo_corrob: 0, t_credito_corrob: 0, t_debito_corrob: 0,
          transferencia_corrob: 0, m_pago_corrob: 0, abono_cliente_corrob: 0,
          canje_corrob: 0, p_clay_corrob: 0, cheque_corrob: 0,
          // NOT NULL requeridos
          abonos_rec_efectivo: 0, abonos_rec_debito: 0, abonos_rec_otros: 0,
          estado:                'cuadra',
          declarado_at:          `${fecha}T12:00:00-04:00`,
          corroborado_at:        `${fecha}T12:00:00-04:00`,
          observaciones_admin:   '[AUTO] Generado desde importación cartola Transbank',
        }
        const { error: errCierre } = await supabase.from('cierres_caja').insert(cierre)
        if (errCierre) throw errCierre
        cierresCreados++
      }

      setResultado({
        ok: true,
        msg: `✓ ${ins} transacciones insertadas · ${dup} duplicadas · ${cierresCreados} cierres web creados${cierresExistentes > 0 ? ` · ${cierresExistentes} ya existían` : ''}`
      })
      setPreview(null)
    } catch (e) { setResultado({ ok: false, msg: e instanceof Error ? e.message : 'Error' }) }
    finally { setLoading(false) }
  }

  const totalBruto = preview?.rows.filter(r => r.tipo_movimiento === 'Venta').reduce((s,r) => s + r.monto_afecto, 0) ?? 0
  const nVentas    = preview?.rows.filter(r => r.tipo_movimiento === 'Venta').length ?? 0
  const nAnul      = preview?.rows.filter(r => r.tipo_movimiento !== 'Venta').length ?? 0

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={cardSt}>
        <div style={{ fontSize:14, fontWeight:600, marginBottom:4 }}>Importar Cartola de Movimientos Transbank</div>
        <div style={{ fontSize:12, color:'#6B7280', marginBottom:12 }}>
          Descarga desde <strong>portal.transbank.cl</strong> → Cartola de Movimientos → Exportar Excel.
          El archivo incluye Ventas y Anulaciones de todos los terminales Webpay.
        </div>
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); parsear(e.dataTransfer.files[0]) }}
          onClick={() => fileRef.current?.click()}
          style={{ border:`2px dashed ${dragOver?'#4F46E5':'#D1D5DB'}`, borderRadius:10,
            padding:'28px 20px', textAlign:'center', cursor:'pointer',
            background: dragOver?'#EEF2FF':'#FAFAFA', transition:'all 0.2s' }}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display:'none' }}
            onChange={e => { parsear(e.target.files?.[0]); e.target.value='' }} />
          {loading ? <Loader2 size={22} style={{ display:'inline-block', color:'#4F46E5' }} />
            : <><Upload size={22} color="#9CA3AF" />
                <div style={{ marginTop:8, fontSize:13, color:'#6B7280' }}>Arrastra la cartola Transbank o haz clic</div>
                <div style={{ fontSize:11, color:'#9CA3AF', marginTop:4 }}>.xlsx · .xls</div>
              </>}
        </div>
        {resultado && (
          <div style={{ marginTop:10, padding:'8px 12px', borderRadius:6, fontSize:12,
            background: resultado.ok?'#DCFCE7':'#FEE2E2', color: resultado.ok?'#166534':'#991B1B' }}>
            {resultado.msg}
          </div>
        )}
      </div>

      {preview && (
        <div style={{ ...cardSt, padding:0, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:'1px solid #F3F4F6', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div>
              <span style={{ fontWeight:600, fontSize:14 }}>Vista previa — {preview.rows.length} registros</span>
              <span style={{ fontSize:11, color:'#6B7280', marginLeft:10 }}>{preview.file}</span>
              <span style={{ marginLeft:12, fontSize:12 }}>
                {nVentas} ventas ({formatCLP(totalBruto)})
                {nAnul > 0 && <span style={{ color:'#DC2626', marginLeft:8 }}>{nAnul} anulaciones</span>}
              </span>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => setPreview(null)} style={btnOutlineSt}>Cancelar</button>
              <button onClick={confirmar} disabled={loading}
                style={{ ...btnSt('#4F46E5'), opacity: loading?0.6:1 }}>
                {loading && <Loader2 size={13} />} Importar {preview.rows.length} registros
              </button>
            </div>
          </div>
          <div style={{ overflowX:'auto', maxHeight:320, overflowY:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead style={{ position:'sticky', top:0, background:'#F9FAFB' }}>
                <tr>
                  <th style={TH}>Fecha venta</th>
                  <th style={TH}>Tipo mov.</th>
                  <th style={TH}>Tarjeta</th>
                  <th style={{ ...TH, textAlign:'right' }}>Monto</th>
                  <th style={TH}>Fecha abono</th>
                  <th style={TH}>Cód. aut.</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0,100).map((r,i) => (
                  <tr key={i} style={{ borderTop:'1px solid #F3F4F6',
                    background: r.tipo_movimiento !== 'Venta' ? '#FEF2F2' : 'transparent' }}>
                    <td style={TD}>{r.fecha_venta?.slice(0,16).replace('T',' ')}</td>
                    <td style={{ ...TD, color: r.tipo_movimiento==='Venta'?'#16A34A':'#DC2626', fontWeight:500 }}>{r.tipo_movimiento}</td>
                    <td style={TD}>{r.tipo_tarjeta}</td>
                    <td style={{ ...TD, textAlign:'right', fontWeight:600 }}>{formatCLP(r.monto_afecto)}</td>
                    <td style={{ ...TD, color: r.fecha_abono?'#16A34A':'#9CA3AF' }}>{r.fecha_abono ?? 'Pendiente'}</td>
                    <td style={{ ...TD, color:'#6B7280', fontSize:11 }}>{r.cod_autorizacion}</td>
                  </tr>
                ))}
                {preview.rows.length > 100 && (
                  <tr><td colSpan={6} style={{ ...TD, textAlign:'center', color:'#9CA3AF' }}>
                    ... y {preview.rows.length-100} registros más
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Importador Depósitos Efectivo ─────────────────────────────────────────────
function ImportadorEfectivo({ sucursales }) {
  const fileRef    = useRef()
  const [dragOver, setDragOver]   = useState(false)
  const [loading, setLoading]     = useState(false)
  const [preview, setPreview]     = useState(null)   // filas parseadas antes de confirmar
  const [sucursal, setSucursal]   = useState('')
  const [resultado, setResultado] = useState(null)

  // Parsea el Excel y genera preview — NO inserta aún
  async function parsearArchivo(file) {
    if (!file) return
    setResultado(null); setPreview(null)
    try {
      const XLSX = await import('xlsx')
      const buf  = await file.arrayBuffer()
      const wb   = XLSX.read(new Uint8Array(buf), { type: 'array' })
      const ws   = wb.Sheets[wb.SheetNames[0]]
      const raw  = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })

      // Detectar fila de encabezados buscando "fecha" en alguna celda
      let headerRow = 0
      for (let i = 0; i < Math.min(5, raw.length); i++) {
        if (raw[i].some(c => c != null && /fecha/i.test(String(c)))) { headerRow = i; break }
      }
      const headers = raw[headerRow].map(h => h != null ? String(h).trim().toLowerCase() : '')

      // Mapear columnas flexiblemente
      const iCol = k => headers.findIndex(h => h.includes(k))
      const iFecha  = iCol('fecha')
      const iMonto  = headers.findIndex(h => h.includes('monto') || h.includes('total') || h.includes('deposit'))
      const iObs    = headers.findIndex(h => h.includes('observ') || h.includes('obs'))
      const iMoneda = headers.findIndex(h => h.includes('moneda') || h.includes('faltante') || h.includes('pendiente'))

      if (iFecha < 0 || iMonto < 0) {
        setResultado({ ok: false, msg: 'No se encontraron columnas "Fecha" y "Monto". Verifica el formato.' })
        return
      }

      const toNum = v => {
        if (v == null) return 0
        if (typeof v === 'number') return Math.round(v)
        const n = parseFloat(String(v).replace(/[^0-9.-]/g,''))
        return isNaN(n) ? 0 : Math.round(n)
      }
      const toFecha = v => {
        if (!v) return null
        // Date object (xlsx con raw:true retorna Date para celdas de fecha)
        if (v instanceof Date) {
          if (isNaN(v.getTime())) return null
          const y = v.getFullYear(), m = v.getMonth()+1, d = v.getDate()
          return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
        }
        // Número serial Excel (número puro)
        if (typeof v === 'number') {
          const d = new Date(Math.round((v - 25569) * 86400 * 1000))
          if (isNaN(d.getTime())) return null
          const y = d.getUTCFullYear(), mo = d.getUTCMonth()+1, day = d.getUTCDate()
          return `${y}-${String(mo).padStart(2,'0')}-${String(day).padStart(2,'0')}`
        }
        const s = String(v).trim()
        if (!s) return null
        // dd-mm-yyyy o dd/mm/yyyy
        const m2 = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/)
        if (m2) return `${m2[3]}-${m2[2].padStart(2,'0')}-${m2[1].padStart(2,'0')}`
        // yyyy-mm-dd
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10)
        return null
      }

      const filas = []
      for (let i = headerRow+1; i < raw.length; i++) {
        const row   = raw[i]
        const fecha = toFecha(row[iFecha])
        const monto = toNum(row[iMonto])
        if (!fecha || monto <= 0) continue
        const obs    = iObs    >= 0 ? String(row[iObs]    ?? '').trim() : ''
        const moneda = iMoneda >= 0 ? toNum(row[iMoneda] ?? 0) : 0
        filas.push({ fecha, monto, obs: obs || null, moneda })
      }

      if (!filas.length) { setResultado({ ok: false, msg: 'No se encontraron filas con fecha y monto válidos.' }); return }
      setPreview(filas)
    } catch (e) { setResultado({ ok: false, msg: e instanceof Error ? e.message : 'Error al leer archivo' }) }
  }

  // Confirmar e insertar
  async function confirmarImport() {
    if (!preview?.length) return
    if (!sucursal) { setResultado({ ok: false, msg: 'Selecciona la sucursal antes de importar.' }); return }
    setLoading(true); setResultado(null)
    try {
      const rows = preview.map(r => ({
        fecha:              r.fecha,
        sucursal_id:        sucursal,
        monto_depositado:   r.monto,
        total_no_depositado: r.moneda,
        observaciones:      r.obs,
        auto_generado:      false,
        estado:             'pendiente',
      }))
      const { error } = await supabase.from('depositos_efectivo').insert(rows)
      if (error) throw error
      setResultado({ ok: true, msg: `${rows.length} depósitos importados. Ahora puedes adjuntar comprobantes desde la tabla.` })
      setPreview(null)
    } catch (e) { setResultado({ ok: false, msg: e instanceof Error ? e.message : 'Error al insertar' }) }
    finally { setLoading(false) }
  }

  const totalMonto  = preview?.reduce((s,r) => s+r.monto, 0) ?? 0
  const totalMoneda = preview?.reduce((s,r) => s+r.moneda, 0) ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={cardSt}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Importar depósitos efectivo</div>
        <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>
          El Excel debe tener columnas: <strong>Fecha</strong> y <strong>Monto</strong> (obligatorias) · Observación y Monedas faltantes (opcionales).
          Formatos de fecha aceptados: <code>dd-mm-yyyy</code>, <code>dd/mm/yyyy</code>, <code>yyyy-mm-dd</code>.
        </div>

        {/* Sucursal */}
        <div style={{ marginBottom: 12 }}>
          <label style={labelSt}>Sucursal destino</label>
          <select style={{ ...selectSt, maxWidth: 280 }} value={sucursal} onChange={e => setSucursal(e.target.value)}>
            <option value="">— Selecciona —</option>
            {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); parsearArchivo(e.dataTransfer.files[0]) }}
          onClick={() => fileRef.current?.click()}
          style={{ border: `2px dashed ${dragOver ? '#16A34A' : '#D1D5DB'}`, borderRadius: 10,
            padding: '28px 20px', textAlign: 'center', cursor: 'pointer',
            background: dragOver ? '#F0FDF4' : '#FAFAFA', transition: 'all 0.2s' }}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
            onChange={e => parsearArchivo(e.target.files?.[0])} />
          <Upload size={22} color="#9CA3AF" />
          <div style={{ marginTop: 8, fontSize: 13, color: '#6B7280' }}>
            Arrastra el Excel o haz clic para seleccionar
          </div>
          <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
            .xlsx · .xls · .csv
          </div>
        </div>

        {resultado && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, fontSize: 12,
            background: resultado.ok ? '#DCFCE7' : '#FEE2E2',
            color: resultado.ok ? '#166534' : '#991B1B' }}>
            {resultado.ok ? '✓' : '✕'} {resultado.msg}
          </div>
        )}
      </div>

      {/* Preview antes de confirmar */}
      {preview && preview.length > 0 && (
        <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #F3F4F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Vista previa — {preview.length} filas</span>
              <span style={{ fontSize: 12, color: '#6B7280', marginLeft: 12 }}>
                Total: <strong>{formatCLP(totalMonto)}</strong>
                {totalMoneda > 0 && <> · Monedas: <strong>{formatCLP(totalMoneda)}</strong></>}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPreview(null)} style={btnOutlineSt}>Cancelar</button>
              <button onClick={confirmarImport} disabled={loading || !sucursal}
                style={{ ...btnSt('#16A34A'), opacity: (loading || !sucursal) ? 0.6 : 1 }}>
                {loading ? <Loader2 size={13} /> : null}
                {!sucursal ? 'Selecciona sucursal' : `Importar ${preview.length} registros`}
              </button>
            </div>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, background: '#F9FAFB' }}>
                <tr>
                  <th style={TH}>#</th>
                  <th style={TH}>Fecha</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Monto</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Monedas pend.</th>
                  <th style={TH}>Observación</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #F3F4F6' }}>
                    <td style={{ ...TD, color: '#9CA3AF' }}>{i+1}</td>
                    <td style={TD}>{r.fecha}</td>
                    <td style={{ ...TD, textAlign: 'right', fontWeight: 600 }}>{formatCLP(r.monto)}</td>
                    <td style={{ ...TD, textAlign: 'right', color: r.moneda > 0 ? '#D97706' : '#9CA3AF' }}>
                      {r.moneda > 0 ? formatCLP(r.moneda) : '—'}
                    </td>
                    <td style={{ ...TD, color: '#6B7280', maxWidth: 200 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.obs ?? '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
async function fetchRecaudacionDiaria({ desde, hasta, sucursal_id, campo }) {
  // Traemos todas las filas del período, incluyendo las que tienen NULL en el campo
  // (NULL = corroborado no disponible → pendiente)
  // Filtramos solo las que tienen n_cierres > 0 para ese campo
  let q = supabase.from('v_recaudacion_diaria')
    .select(`fecha, sucursal_id, ${campo}, n_pendientes, n_corroborados, n_cierres`)
    .gte('fecha', desde).lte('fecha', hasta)
    .gt('n_cierres', 0)
    .order('fecha', { ascending: false })
  if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)
  const { data, error } = await q
  if (error) throw error
  // Solo filas con algún valor o con pendientes
  return (data ?? []).filter(r => r[campo] != null || r.n_pendientes > 0)
}

// ── Fetch abonos bancarios por tabla ──────────────────────────────────────────
async function fetchAbonosBancarios(tabla, { desde, hasta, sucursal_id }) {
  let q = supabase.from(tabla).select('*').gte('fecha', desde).lte('fecha', hasta).order('fecha', { ascending: false })
  if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

// Fetch getnet agrupado por fecha/sucursal/tipo — usa valor_cuota (bruto, sin descontar comisión)
async function fetchGetnetAgrupado({ desde, hasta, sucursal_id, tipo_pago }) {
  // Usa v_getnet_mensual (agrega en BD, max 4 filas) para evitar límite de 1000 rows
  // Retorna una fila por día simulada desde el total mensual
  const mes = desde.slice(0, 7) + '-01'
  let q = supabase.from('v_getnet_mensual')
    .select('sucursal_id, tipo_normalizado, total_bruto, n_transacciones')
    .eq('mes', mes)
    .eq('tipo_normalizado', tipo_pago)
  if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)
  const { data: mensual, error } = await q
  if (error) throw error

  // Para la tabla detalle, traer v_getnet_dia (52 filas max por mes — ok bajo el límite)
  let q2 = supabase.from('v_getnet_dia')
    .select('fecha, sucursal_id, total_bruto, n_transacciones')
    .gte('fecha', desde).lte('fecha', hasta)
    .eq('tipo', tipo_pago)
    .order('fecha', { ascending: false })
  if (sucursal_id) q2 = q2.eq('sucursal_id', sucursal_id)
  const { data: diario } = await q2

  // El total correcto viene de v_getnet_mensual
  const totalCorrecto = (mensual ?? []).reduce((s, r) => s + Number(r.total_bruto ?? 0), 0)

  // Retornar filas diarias con total_abono, ajustando el total si hay discrepancia
  const filas = (diario ?? []).map(r => ({ ...r, total_abono: Number(r.total_bruto ?? 0) }))

  // Si el total diario no cuadra con el mensual, agregar fila de ajuste
  const totalDiario = filas.reduce((s, r) => s + r.total_abono, 0)
  const diff = totalCorrecto - totalDiario
  if (Math.abs(diff) > 1000) {
    // Hay diferencia — agregar fila informativa al inicio
    filas.unshift({ fecha: desde, sucursal_id: sucursal_id ?? 'total', total_abono: diff, total_bruto: diff, n_transacciones: 0, _ajuste: true })
  }

  return filas
}

// ── Modal registro manual ─────────────────────────────────────────────────────
function ModalRegistro({ config, sucursales, sucursalEf, hasta, onClose, onSaved }) {
  const [form, setForm] = useState({
    sucursal_id: sucursalEf ?? sucursales[0]?.id ?? '',
    fecha: hasta, monto: 0, monto_bruto: 0, comision: 0,
    banco: '', cuenta_origen: '', rut_emisor: '', nombre_emisor: '',
    n_comprobante: '', n_operacion: '', observacion: '', comprobanteFile: null,
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const montoFinal = config.tabla === 'abonos_mercado_pago' ? form.monto_bruto - form.comision : form.monto

  async function guardar() {
    if (!form.sucursal_id) { toast.error('Selecciona sucursal'); return }
    const monto = config.tabla === 'abonos_mercado_pago' ? form.monto_bruto : form.monto
    if (monto <= 0) { toast.error('Monto debe ser mayor a 0'); return }
    setSaving(true)
    try {
      if (form.comprobanteFile) validarComprobante(form.comprobanteFile)
      let payload = { sucursal_id: form.sucursal_id, fecha: form.fecha, observaciones: form.observacion || null }
      if (config.tabla === 'depositos_efectivo') payload = { ...payload, monto_depositado: form.monto }
      else if (config.tabla === 'abonos_getnet')  payload = { ...payload, total_abono: form.monto }
      else if (config.tabla === 'abonos_webpay')  payload = { ...payload, deposito_transbank: form.monto }
      else if (config.tabla === 'abonos_transferencia') payload = { ...payload, monto: form.monto, banco: form.banco || null, cuenta_origen: form.cuenta_origen || null, rut_emisor: form.rut_emisor || null, nombre_emisor: form.nombre_emisor || null, n_comprobante: form.n_comprobante || null }
      else if (config.tabla === 'abonos_mercado_pago') payload = { ...payload, monto_bruto: form.monto_bruto, comision: form.comision, n_operacion: form.n_operacion || null }
      const uid = (await supabase.auth.getSession()).data.session?.user.id
      if (uid) payload.registrado_por = uid
      const { data, error } = await supabase.from(config.tabla).insert(payload).select('id').single()
      if (error) throw error
      if (form.comprobanteFile) {
        const path = await subirComprobante(form.comprobanteFile, form.sucursal_id, String(data.id))
        await supabase.from(config.tabla).update({ comprobante_url: path, comprobante_nombre: form.comprobanteFile.name }).eq('id', data.id)
      }
      toast.success('Registro guardado')
      onSaved()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 460, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.15)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Nuevo registro — {config.titulo}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={labelSt}>Sucursal</label>
            <select style={selectSt} value={form.sucursal_id} onChange={e => set('sucursal_id', e.target.value)}>
              <option value="">Selecciona…</option>
              {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>Fecha</label>
              <input type="date" style={inputSt} value={form.fecha} onChange={e => set('fecha', e.target.value)} />
            </div>
            {config.tabla === 'abonos_mercado_pago' ? (
              <div>
                <label style={labelSt}>Monto bruto</label>
                <MoneyInput value={form.monto_bruto} onChange={v => set('monto_bruto', v)} />
              </div>
            ) : (
              <div>
                <label style={labelSt}>Monto</label>
                <MoneyInput value={form.monto} onChange={v => set('monto', v)} />
              </div>
            )}
          </div>
          {config.tabla === 'abonos_mercado_pago' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={labelSt}>Comisión MP</label>
                <MoneyInput value={form.comision} onChange={v => set('comision', v)} />
              </div>
              <div>
                <label style={labelSt}>Monto neto</label>
                <input readOnly value={formatCLP(montoFinal)} style={{ ...inputSt, background: '#F9FAFB', textAlign: 'right', fontWeight: 600 }} />
              </div>
            </div>
          )}
          {config.tabla === 'abonos_transferencia' && (
            <div>
              <label style={labelSt}>Banco</label>
              <input style={inputSt} value={form.banco} onChange={e => set('banco', e.target.value)} placeholder="Ej: Banco Estado" />
            </div>
          )}
          {config.tabla === 'abonos_transferencia' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelSt}>RUT emisor</label>
                  <input style={inputSt} value={form.rut_emisor} onChange={e => set('rut_emisor', e.target.value)} placeholder="12.345.678-9" />
                </div>
                <div>
                  <label style={labelSt}>Nombre emisor</label>
                  <input style={inputSt} value={form.nombre_emisor} onChange={e => set('nombre_emisor', e.target.value)} />
                </div>
              </div>
              <div>
                <label style={labelSt}>Cuenta origen</label>
                <input style={inputSt} value={form.cuenta_origen} onChange={e => set('cuenta_origen', e.target.value)} placeholder="N° cuenta bancaria" />
              </div>
            </>
          )}
          {config.tabla === 'abonos_mercado_pago' && (
            <div>
              <label style={labelSt}>N° operación MP</label>
              <input style={inputSt} value={form.n_operacion} onChange={e => set('n_operacion', e.target.value)} />
            </div>
          )}
          <div>
            <label style={labelSt}>N° comprobante</label>
            <input style={inputSt} value={form.n_comprobante} onChange={e => set('n_comprobante', e.target.value)} />
          </div>
          <div>
            <label style={labelSt}>Observación</label>
            <input style={inputSt} value={form.observacion} onChange={e => set('observacion', e.target.value)} />
          </div>
          <div>
            <label style={labelSt}>Comprobante <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(PDF/JPG/PNG, máx 5MB)</span></label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" onClick={() => document.getElementById('modal-file-input')?.click()}
                style={{ ...btnOutlineSt, fontSize: 12, padding: '5px 10px' }}>
                <Paperclip size={13} /> {form.comprobanteFile ? form.comprobanteFile.name : 'Adjuntar'}
              </button>
              {form.comprobanteFile && <button type="button" onClick={() => set('comprobanteFile', null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 11 }}>✕</button>}
            </div>
            <input id="modal-file-input" type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
              onChange={e => set('comprobanteFile', e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={btnOutlineSt}>Cancelar</button>
          <button onClick={guardar} disabled={saving} style={{ ...btnSt(), opacity: saving ? 0.6 : 1 }}>
            {saving && <Loader2 size={13} />} Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Sección principal: Recaudación vs Depósito ────────────────────────────────
// ── Modal específico para depositar efectivo ─────────────────────────────────
// Flujo: el analista/admin abre una línea auto-generada (pendiente) y digita
// el monto real depositado + sube comprobante. Si difiere del teórico
// (efectivo_corrob sumado del día×sucursal) se registra como observación.
// modo='edit': UPDATE de una línea existente (línea auto sin comprobante o adicional sin comprobante).
// modo='new':  INSERT de un depósito adicional para el mismo día×sucursal.
function ModalDepositarEfectivo({ row, sucursales, sucursalEf, hasta, modo, onClose, onSaved }) {
  const fechaInicial = row?.fecha ?? hasta
  const sucInicial   = row?.sucursal_id ?? sucursalEf ?? sucursales[0]?.id ?? ''
  const [sucursalId, setSucursalId]   = useState(sucInicial)
  const [fecha, setFecha]             = useState(fechaInicial)
  const [montoTeorico, setMontoTeorico] = useState(null)  // suma efectivo_corrob del día×sucursal
  const [yaDepositado, setYaDepositado] = useState(0)     // suma de depósitos previos (otras filas)
  const [loadingTeorico, setLoadingTeorico] = useState(false)
  const [montoDepositado, setMontoDepositado] = useState(modo === 'edit' ? Number(row?.monto_depositado ?? 0) : 0)
  const [observacion, setObservacion] = useState(row?.observaciones ?? '')
  const [comprobanteFile, setComprobanteFile] = useState(null)
  const [saving, setSaving]           = useState(false)

  // Cargar monto teórico (suma efectivo_corrob de cierres corroborados del día×sucursal)
  // y suma de depósitos ya hechos en otras filas para mostrar saldo pendiente
  useEffect(() => {
    let cancel = false
    async function cargar() {
      if (!fecha || !sucursalId) return
      setLoadingTeorico(true)
      try {
        const ESTADOS = ['cuadra', 'tolerable', 'descuadre']
        const [{ data: cierres }, { data: deps }] = await Promise.all([
          supabase.from('cierres_caja')
            .select('efectivo_corrob, efectivo, estado')
            .eq('fecha', fecha).eq('sucursal_id', sucursalId)
            .in('estado', ESTADOS),
          supabase.from('depositos_efectivo')
            .select('id, monto_depositado, comprobante_url')
            .eq('fecha', fecha).eq('sucursal_id', sucursalId),
        ])
        if (cancel) return
        const teorico = (cierres ?? []).reduce((s, c) => s + Number(c.efectivo_corrob ?? c.efectivo ?? 0), 0)
        // Depósitos previos = todos los con comprobante (confirmados), excluyendo la fila actual si está en edit
        const previos = (deps ?? [])
          .filter(d => d.id !== row?.id && d.comprobante_url != null)
          .reduce((s, d) => s + Number(d.monto_depositado ?? 0), 0)
        setMontoTeorico(teorico)
        setYaDepositado(previos)
        // Si es modo 'new' o edit con monto 0, sugerir el saldo pendiente
        if (modo === 'new' || (modo === 'edit' && Number(row?.monto_depositado ?? 0) === 0)) {
          setMontoDepositado(Math.max(0, teorico - previos))
        }
      } catch (e) {
        if (!cancel) toast.error('Error al calcular monto teórico')
      } finally {
        if (!cancel) setLoadingTeorico(false)
      }
    }
    cargar()
    return () => { cancel = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha, sucursalId])

  const diferencia = montoTeorico != null ? montoDepositado - (montoTeorico - yaDepositado) : 0
  const obsRequerida = diferencia !== 0 && observacion.trim() === ''

  async function guardar() {
    if (!sucursalId) { toast.error('Selecciona sucursal'); return }
    if (montoDepositado <= 0) { toast.error('Monto depositado debe ser mayor a 0'); return }
    if (!comprobanteFile && !row?.comprobante_url) { toast.error('Adjunta el comprobante del depósito'); return }
    if (obsRequerida) { toast.error('Observación obligatoria cuando hay diferencia'); return }
    if (comprobanteFile) {
      try { validarComprobante(comprobanteFile) } catch (e) { toast.error(e.message); return }
    }
    setSaving(true)
    try {
      const uid = (await supabase.auth.getSession()).data.session?.user.id
      let id = row?.id
      if (modo === 'edit') {
        // UPDATE de la línea existente (auto-generada o adicional sin comprobante)
        const { error } = await supabase.from('depositos_efectivo').update({
          monto_depositado: montoDepositado,
          observaciones: observacion.trim() || null,
          ...(uid ? { registrado_por: uid } : {}),
        }).eq('id', id)
        if (error) throw error
      } else {
        // INSERT depósito adicional (auto_generado=false)
        const payload = {
          sucursal_id: sucursalId,
          fecha,
          monto_depositado: montoDepositado,
          observaciones: observacion.trim() || null,
          auto_generado: false,
          ...(uid ? { registrado_por: uid } : {}),
        }
        const { data, error } = await supabase.from('depositos_efectivo')
          .insert(payload).select('id').single()
        if (error) throw error
        id = data.id
      }
      // Subir comprobante si hay archivo nuevo
      if (comprobanteFile) {
        const path = await subirComprobante(comprobanteFile, sucursalId, String(id))
        const { error: errUpd } = await supabase.from('depositos_efectivo')
          .update({ comprobante_url: path, comprobante_nombre: comprobanteFile.name })
          .eq('id', id)
        if (errUpd) throw errUpd
      }
      toast.success(modo === 'edit' ? 'Depósito confirmado' : 'Depósito adicional registrado')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar')
    } finally { setSaving(false) }
  }

  const pendienteDelDia = montoTeorico != null ? Math.max(0, montoTeorico - yaDepositado) : null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 480, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.15)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
          {modo === 'edit' ? 'Confirmar depósito de efectivo' : 'Depósito adicional de efectivo'}
        </div>
        <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 16 }}>
          Vincula el comprobante bancario con el efectivo corroborado del día.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>Sucursal</label>
              <select style={{ ...selectSt, opacity: modo === 'edit' ? 0.6 : 1 }}
                value={sucursalId} onChange={e => setSucursalId(e.target.value)}
                disabled={modo === 'edit'}>
                <option value="">Selecciona…</option>
                {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelSt}>Fecha</label>
              <input type="date" style={{ ...inputSt, opacity: modo === 'edit' ? 0.6 : 1 }}
                value={fecha} onChange={e => setFecha(e.target.value)}
                disabled={modo === 'edit'} />
            </div>
          </div>

          {/* Caja informativa con efectivo corroborado del día */}
          <div style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 8, padding: '10px 12px', fontSize: 12 }}>
            {loadingTeorico ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#0369A1' }}>
                <Loader2 size={12} /> Calculando efectivo corroborado…
              </div>
            ) : montoTeorico == null ? (
              <div style={{ color: '#0369A1' }}>—</div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: '#0369A1' }}>Efectivo corroborado del día</span>
                  <span style={{ fontWeight: 700, color: '#0369A1' }}>{fmt(montoTeorico)}</span>
                </div>
                {yaDepositado > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: '#0369A1' }}>Ya depositado en otras líneas</span>
                    <span style={{ fontWeight: 600, color: '#0369A1' }}>{fmt(yaDepositado)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #BAE6FD', marginTop: 4, paddingTop: 4 }}>
                  <span style={{ color: '#0369A1', fontWeight: 600 }}>Saldo pendiente</span>
                  <span style={{ fontWeight: 700, color: pendienteDelDia > 0 ? '#D97706' : '#16A34A' }}>{fmt(pendienteDelDia)}</span>
                </div>
              </>
            )}
          </div>

          <div>
            <label style={labelSt}>Monto depositado</label>
            <MoneyInput value={montoDepositado} onChange={setMontoDepositado} />
          </div>

          {/* Diferencia */}
          {montoTeorico != null && (
            <div style={{
              background: diferencia === 0 ? '#F0FDF4' : Math.abs(diferencia) < 1000 ? '#FEF9C3' : '#FEE2E2',
              border: '1px solid ' + (diferencia === 0 ? '#BBF7D0' : Math.abs(diferencia) < 1000 ? '#FDE68A' : '#FECACA'),
              borderRadius: 8, padding: '8px 12px', fontSize: 12,
              display: 'flex', justifyContent: 'space-between'
            }}>
              <span style={{ color: '#374151' }}>Diferencia vs saldo pendiente</span>
              <span style={{ fontWeight: 700, color: diferencia === 0 ? '#16A34A' : diferencia < 0 ? '#DC2626' : '#D97706' }}>
                {diferencia >= 0 ? '+' : ''}{fmt(diferencia)}
                {diferencia < 0 && <span style={{ fontSize: 10, marginLeft: 6, color: '#7F1D1D' }}>(falta efectivo)</span>}
                {diferencia > 0 && <span style={{ fontSize: 10, marginLeft: 6, color: '#92400E' }}>(sobra efectivo)</span>}
              </span>
            </div>
          )}

          <div>
            <label style={labelSt}>
              Observación {diferencia !== 0 && <span style={{ color: '#DC2626' }}>*</span>}
            </label>
            <textarea value={observacion} onChange={e => setObservacion(e.target.value)} rows={2}
              placeholder={diferencia !== 0 ? 'Obligatorio: explica la diferencia (ej: faltan monedas)' : 'Opcional'}
              style={{ ...inputSt, resize: 'vertical', fontFamily: 'inherit', fontSize: 12,
                borderColor: obsRequerida ? '#DC2626' : '#D1D5DB' }} />
          </div>

          <div>
            <label style={labelSt}>Comprobante bancario {!row?.comprobante_url && <span style={{ color: '#DC2626' }}>*</span>}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ ...btnOutlineSt, padding: '6px 10px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <Paperclip size={13} />
                {comprobanteFile ? comprobanteFile.name : (row?.comprobante_nombre ?? 'Adjuntar')}
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
                  onChange={e => setComprobanteFile(e.target.files?.[0] ?? null)} />
              </label>
              {comprobanteFile && (
                <button type="button" onClick={() => setComprobanteFile(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', fontSize: 12 }}>
                  Quitar
                </button>
              )}
            </div>
            {row?.comprobante_url && !comprobanteFile && (
              <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 3 }}>
                Ya tiene comprobante. Adjuntar uno nuevo lo reemplazará.
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={btnOutlineSt}>Cancelar</button>
          <button onClick={guardar} disabled={saving || obsRequerida}
            style={{ ...btnSt('#16A34A'), opacity: saving || obsRequerida ? 0.6 : 1 }}>
            {saving && <Loader2 size={13} />}
            {modo === 'edit' ? 'Confirmar depósito' : 'Registrar depósito adicional'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SeccionMedio({ config, sucursalEf, desde, hasta, puedeEscribir, sucursales, usuario, esAdmin }) {
  const [recaudacion, setRecaudacion] = useState([])
  const [abonos, setAbonos]           = useState([])
  const [loading, setLoading]         = useState(true)
  const [modal, setModal]             = useState(false)
  const [modalDeposito, setModalDeposito] = useState(null)  // { modo: 'edit'|'new', row?: depósito }
  const [sucMap, setSucMap]           = useState({})
  const [verMatch, setVerMatch]       = useState(false)

  const cargar = async () => {
    setLoading(true)
    try {
      const [rec, abn] = await Promise.all([
        config.fetchRecaudacion({ desde, hasta, sucursal_id: sucursalEf }),
        config.fetchAbonos({ desde, hasta, sucursal_id: sucursalEf }),
      ])
      setRecaudacion(rec)
      setAbonos(abn)
    } catch (e) { toast.error(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { cargar() }, [sucursalEf, desde, hasta])
  useEffect(() => {
    fetchSucursales().then(ss => { const m = {}; ss.forEach(s => { m[s.id] = s.nombre }); setSucMap(m) }).catch(() => {})
  }, [])

  const totalRecaudado = recaudacion.reduce((s, r) => s + Number(r[config.campoRec] ?? 0), 0)
  const totalAbonado   = abonos.reduce((s, r) => s + Number(r[config.campoAbono] ?? 0), 0)
  const brecha         = totalAbonado - totalRecaudado
  const hayPendientes  = recaudacion.some(r => r[config.campoRec] == null)

  // Match día por día
  const matchDiario = useMemo(() => {
    const mapRec = {}
    for (const r of recaudacion) {
      const key = `${r.fecha}|${r.sucursal_id ?? ''}`
      mapRec[key] = { val: r[config.campoRec], pendiente: r[config.campoRec] == null }
    }
    const mapDep = {}
    for (const a of abonos) {
      const fecha = a.fecha ?? a.fecha_abono
      const key   = `${fecha}|${a.sucursal_id ?? ''}`
      mapDep[key] = (mapDep[key] ?? 0) + Number(a[config.campoAbono] ?? 0)
    }
    const allKeys = new Set([...Object.keys(mapRec), ...Object.keys(mapDep)])
    return Array.from(allKeys).map(key => {
      const [fecha, sucId] = key.split('|')
      const recObj  = mapRec[key]
      const rec     = recObj?.val ?? 0
      const pend    = recObj?.pendiente ?? false
      const dep     = mapDep[key] ?? 0
      return { fecha, sucursal_id: sucId, rec, dep, diff: dep - rec, pendiente: pend }
    }).sort((a, b) => b.fecha.localeCompare(a.fecha))
  }, [recaudacion, abonos])

  const pendienteDepositar     = matchDiario.filter(r => !r.pendiente && r.rec > 0 && r.dep === 0).reduce((s, r) => s + r.rec, 0)
  const nPendientesCorroborar  = matchDiario.filter(r => r.pendiente).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10 }}>
        <KpiMini title="Recaudado mes (corroborado)" value={fmt(totalRecaudado)} color="#1F4E79" />
        <KpiMini title={config.labelAbono}            value={fmt(totalAbonado)}  color="#16A34A" />
        <KpiMini title="Pend. corroborar"             value={String(nPendientesCorroborar)}
          color={nPendientesCorroborar > 0 ? '#7C3AED' : '#16A34A'} />
        <KpiMini title="Pendiente de depositar"       value={fmt(pendienteDepositar)}
          color={pendienteDepositar > 0 ? '#D97706' : '#16A34A'} />
        <KpiMini title="Brecha total mes"             value={fmt(brecha)}
          color={Math.abs(brecha) < 5000 ? '#16A34A' : Math.abs(brecha) < 50000 ? '#D97706' : '#DC2626'} />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 24 }}><Loader2 size={20} style={{ display: 'inline-block', color: '#9CA3AF' }} /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {/* Izquierda: Recaudación */}
          <div style={{ ...cardSt, padding: 0, overflow: 'hidden', marginBottom: 0 }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #F3F4F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1F4E79' }}>Recaudación BSALE</span>
              <span style={{ fontSize: 11, color: '#9CA3AF' }}>desde cierres declarados</span>
            </div>
            {!recaudacion.length ? (
              <div style={{ padding: '20px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Sin datos</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={TH}>Fecha</th><th style={TH}>Sucursal</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Monto</th>
                </tr></thead>
                <tbody>
                  {recaudacion.map((r, i) => {
                    const esPend = r[config.campoRec] == null
                    return (
                      <tr key={i} style={{ borderTop: '1px solid #F3F4F6', background: esPend ? '#FFFBEB' : 'transparent' }}>
                        <td style={TD}>{r.fecha}</td>
                        <td style={TD}>{sucMap[r.sucursal_id] ?? r.sucursal_id ?? '—'}</td>
                        <td style={{ ...TD, textAlign: 'right', fontWeight: 600 }}>
                          {esPend
                            ? <span style={{ fontSize: 11, background: '#FEF3C7', color: '#D97706', padding: '1px 8px', borderRadius: 10 }}>Pendiente</span>
                            : fmt(r[config.campoRec])}
                        </td>
                      </tr>
                    )
                  })}
                  <tr style={{ borderTop: '2px solid #E5E7EB', background: '#F9FAFB' }}>
                    <td colSpan={2} style={{ ...TD, fontWeight: 700 }}>TOTAL</td>
                    <td style={{ ...TD, textAlign: 'right', fontWeight: 700 }}>{fmt(totalRecaudado)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>

          {/* Derecha: Depósitos */}
          <div style={{ ...cardSt, padding: 0, overflow: 'hidden', marginBottom: 0 }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #F3F4F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#16A34A' }}>{config.labelAbono}</span>
              {puedeEscribir && !config.readOnly && (
                <button
                  onClick={() => {
                    if (config.tabla === 'depositos_efectivo') {
                      setModalDeposito({ modo: 'new', row: null })
                    } else {
                      setModal(true)
                    }
                  }}
                  style={{ ...btnSt('#16A34A'), padding: '3px 10px', fontSize: 11 }}>
                  <Plus size={12} /> Registrar
                </button>
              )}
            </div>
            {!abonos.length ? (
              <div style={{ padding: '20px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Sin registros</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={TH}>Fecha</th><th style={TH}>Sucursal</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Monto</th>
                  {config.extraCols?.map(c => <th key={c.key} style={TH}>{c.label}</th>)}
                  <th style={{ ...TH }}>Observación</th>
                  <th style={{ ...TH, textAlign: 'center' }}>Comprobante</th>
                  {puedeEscribir && !config.readOnly && <th style={{ ...TH, textAlign: 'center' }}>Eliminar</th>}
                </tr></thead>
                <tbody>
                  {abonos.map((r, i) => {
                    const esEfectivo  = config.tabla === 'depositos_efectivo'
                    const tieneCompr  = r.comprobante_url != null
                    // Editable: efectivo + permiso + (sin comprobante O admin para corregir confirmado)
                    const editable    = esEfectivo && puedeEscribir && !config.readOnly && (!tieneCompr || esAdmin)
                    const puedeBorrar = puedeEscribir && !config.readOnly && (!esEfectivo || !tieneCompr || esAdmin)
                    return (
                    <tr key={r.id ?? i}
                      style={{ borderTop: '1px solid #F3F4F6', cursor: editable ? 'pointer' : 'default' }}
                      onMouseEnter={e => e.currentTarget.style.background='#F9FAFB'}
                      onMouseLeave={e => e.currentTarget.style.background='transparent'}
                      onClick={editable ? () => setModalDeposito({ modo: 'edit', row: r }) : undefined}>
                      <td style={TD}>{r.fecha ?? r.fecha_abono}</td>
                      <td style={TD}>{sucMap[r.sucursal_id] ?? r.sucursal_id ?? '—'}</td>
                      <td style={{ ...TD, textAlign: 'right', fontWeight: 600 }}>
                        {esEfectivo && !tieneCompr
                          ? <span style={{ fontSize: 11, background: '#FEF3C7', color: '#D97706', padding: '1px 8px', borderRadius: 10 }}>Pendiente</span>
                          : fmt(r[config.campoAbono])}
                      </td>
                      {config.extraCols?.map(c => <td key={c.key} style={TD}>{String(r[c.key] ?? '—')}</td>)}
                      <td style={{ ...TD, maxWidth: 130 }}>
                        {r.observaciones
                          ? <span title={r.observaciones} style={{ fontSize: 11, color: '#6B7280', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.observaciones}
                            </span>
                          : <span style={{ color: '#D1D5DB', fontSize: 11 }}>—</span>}
                      </td>
                      <td style={{ ...TD, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        {config.readOnly ? <span style={{ fontSize: 11, color: '#9CA3AF' }}>—</span> : (
                          <ComprobanteCell tabla={config.tabla} rowId={String(r.id ?? '')}
                            sucursalId={String(r.sucursal_id ?? '')}
                            url={r.comprobante_url ?? null} nombre={r.comprobante_nombre ?? null}
                            onUpdated={cargar} />
                        )}
                      </td>
                      {puedeEscribir && !config.readOnly && (
                        <td style={{ ...TD, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          {puedeBorrar ? (
                            <button onClick={async () => {
                                if (!window.confirm(`¿Eliminar este registro de ${fmt(r[config.campoAbono])}?`)) return
                                const { error } = await supabase.from(config.tabla).delete().eq('id', r.id)
                                if (error) { toast.error(error.message); return }
                                toast.success('Registro eliminado'); cargar()
                              }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', padding: 2 }}>✕</button>
                          ) : (
                            <span title="Solo admin puede revertir un depósito con comprobante" style={{ color: '#D1D5DB', fontSize: 11 }}>—</span>
                          )}
                        </td>
                      )}
                    </tr>
                    )
                  })}
                  <tr style={{ borderTop: '2px solid #E5E7EB', background: '#F9FAFB' }}>
                    <td colSpan={2 + (config.extraCols?.length ?? 0)} style={{ ...TD, fontWeight: 700 }}>TOTAL</td>
                    <td style={{ ...TD, textAlign: 'right', fontWeight: 700 }}>{fmt(totalAbonado)}</td>
                    <td /><td />
                    {puedeEscribir && !config.readOnly && <td />}
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Brecha mes */}
      {!loading && (
        <div style={{ background: Math.abs(brecha)<5000?'#F0FDF4':Math.abs(brecha)<50000?'#FFFBEB':'#FEF2F2',
          border:`1px solid ${Math.abs(brecha)<5000?'#BBF7D0':Math.abs(brecha)<50000?'#FDE68A':'#FECACA'}`,
          borderRadius:8, padding:'10px 16px', fontSize:12,
          color:Math.abs(brecha)<5000?'#166534':Math.abs(brecha)<50000?'#92400E':'#991B1B',
          display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span>
            {Math.abs(brecha)<5000?'✓ Recaudación y depósitos cuadran'
              :brecha<0?`⚠ Faltan ${fmt(Math.abs(brecha))} por depositar`
              :`⚠ Depositado ${fmt(brecha)} más de lo recaudado`}
          </span>
          <span style={{ fontWeight:700 }}>{fmt(brecha)}</span>
        </div>
      )}

      {/* Match día por día */}
      {!loading && matchDiario.length > 0 && (
        <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
          <button onClick={() => setVerMatch(v => !v)}
            style={{ display:'flex', width:'100%', justifyContent:'space-between', alignItems:'center',
              padding:'12px 16px', background:'none', border:'none', cursor:'pointer',
              borderBottom: verMatch?'1px solid #F3F4F6':'none' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ fontSize:13, fontWeight:600, color:'#111827' }}>Match día por día</span>
              {pendienteDepositar > 0 && (
                <span style={{ fontSize:11, background:'#FEF3C7', color:'#D97706', padding:'1px 8px', borderRadius:10, fontWeight:600 }}>
                  {fmt(pendienteDepositar)} pendiente
                </span>
              )}
            </div>
            {verMatch ? <ChevronUp size={15} color="#6B7280" /> : <ChevronDown size={15} color="#6B7280" />}
          </button>
          {verMatch && (
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead><tr style={{ background:'#F9FAFB' }}>
                  <th style={TH}>Fecha</th><th style={TH}>Sucursal</th>
                  <th style={{ ...TH, textAlign:'right' }}>Recaudado</th>
                  <th style={{ ...TH, textAlign:'right' }}>Depositado</th>
                  <th style={{ ...TH, textAlign:'right' }}>Diferencia</th>
                  <th style={{ ...TH, textAlign:'center' }}>Estado</th>
                </tr></thead>
                <tbody>
                  {matchDiario.map((r, i) => {
                    const esCorrob = r.pendiente
                    const esPend   = !r.pendiente && r.rec > 0 && r.dep === 0
                    const esOk     = !esCorrob && !esPend && Math.abs(r.diff) < 5000
                    const estado   = esCorrob ? 'Corroborar' : esPend ? 'Sin depositar' : esOk ? 'Cuadra' : r.diff < 0 ? 'Falta' : 'Excedente'
                    const bg       = esCorrob ? '#EDE9FE' : esPend ? '#FEF3C7' : esOk ? '#DCFCE7' : r.diff < 0 ? '#FEE2E2' : '#EFF6FF'
                    const clr      = esCorrob ? '#5B21B6' : esPend ? '#D97706' : esOk ? '#16A34A' : r.diff < 0 ? '#DC2626' : '#1E40AF'
                    return (
                      <tr key={i} style={{ borderTop: '1px solid #F3F4F6',
                        background: esCorrob ? '#F5F3FF' : esPend ? '#FFFBEB' : 'transparent' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#F9FAFB'}
                        onMouseLeave={e => e.currentTarget.style.background = esCorrob ? '#F5F3FF' : esPend ? '#FFFBEB' : 'transparent'}>
                        <td style={TD}>{r.fecha}</td>
                        <td style={TD}>{sucMap[r.sucursal_id] ?? r.sucursal_id ?? '—'}</td>
                        <td style={{ ...TD, textAlign: 'right' }}>
                          {esCorrob
                            ? <span style={{ fontSize: 11, color: '#7C3AED', fontStyle: 'italic' }}>Pend. corroboración</span>
                            : r.rec > 0 ? fmt(r.rec) : <span style={{ color: '#D1D5DB' }}>—</span>}
                        </td>
                        <td style={{ ...TD, textAlign: 'right' }}>{r.dep > 0 ? fmt(r.dep) : <span style={{ color: '#D1D5DB' }}>—</span>}</td>
                        <td style={{ ...TD, textAlign: 'right', fontWeight: 600, color: esOk ? '#16A34A' : r.diff < 0 ? '#DC2626' : '#1E40AF' }}>
                          {esCorrob || (esPend && r.dep === 0) ? '—' : `${r.diff >= 0 ? '+' : ''}${fmt(r.diff)}`}
                        </td>
                        <td style={{ ...TD, textAlign: 'center' }}>
                          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: bg, color: clr }}>{estado}</span>
                        </td>
                      </tr>
                    )
                  })}
                  <tr style={{ borderTop:'2px solid #E5E7EB', background:'#F9FAFB' }}>
                    <td colSpan={2} style={{ ...TD, fontWeight:700 }}>TOTAL MES</td>
                    <td style={{ ...TD, textAlign:'right', fontWeight:700 }}>{fmt(totalRecaudado)}</td>
                    <td style={{ ...TD, textAlign:'right', fontWeight:700 }}>{fmt(totalAbonado)}</td>
                    <td style={{ ...TD, textAlign:'right', fontWeight:700, color:Math.abs(brecha)<5000?'#16A34A':'#DC2626' }}>
                      {brecha>=0?'+':''}{ fmt(brecha)}
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {modal && (
        <ModalRegistro config={config} sucursales={sucursales} sucursalEf={sucursalEf} hasta={hasta}
          onClose={() => setModal(false)} onSaved={() => { setModal(false); cargar() }} />
      )}

      {modalDeposito && config.tabla === 'depositos_efectivo' && (
        <ModalDepositarEfectivo
          row={modalDeposito.row}
          modo={modalDeposito.modo}
          sucursales={sucursales}
          sucursalEf={sucursalEf}
          hasta={hasta}
          onClose={() => setModalDeposito(null)}
          onSaved={() => { setModalDeposito(null); cargar() }}
        />
      )}
    </div>
  )
}


// ── Configuración de cada medio ───────────────────────────────────────────────
function buildConfigs(desde, hasta, sucursalEf) {
  return {
    efectivo: {
      titulo: 'Depósitos efectivo', tabla: 'depositos_efectivo',
      labelAbono: 'Depósitos en banco',
      campoRec: 'rec_efectivo', campoAbono: 'monto_depositado',
      extraCols: [],
      fetchRecaudacion: p => fetchRecaudacionDiaria({ ...p, campo: 'rec_efectivo' }),
      fetchAbonos:      p => fetchAbonosBancarios('depositos_efectivo', p),
    },
    debito: {
      titulo: 'Débito Getnet', tabla: 'getnet_detalle_abonos',
      labelAbono: 'Recaudado POS Getnet (débito)',
      campoRec: 'rec_debito', campoAbono: 'total_abono',
      readOnly: true,
      fetchRecaudacion: p => fetchRecaudacionDiaria({ ...p, campo: 'rec_debito' }),
      fetchAbonos:      p => fetchGetnetAgrupado({ ...p, tipo_pago: 'DEBITO' }),
    },
    credito: {
      titulo: 'Crédito Getnet', tabla: 'getnet_detalle_abonos',
      labelAbono: 'Recaudado POS Getnet (crédito)',
      campoRec: 'rec_credito', campoAbono: 'total_abono',
      readOnly: true,
      fetchRecaudacion: p => fetchRecaudacionDiaria({ ...p, campo: 'rec_credito' }),
      fetchAbonos:      p => fetchGetnetAgrupado({ ...p, tipo_pago: 'CREDITO' }),
    },
    webpay: {
      titulo: 'Webpay / Link de pago', tabla: 'webpay_transacciones',
      labelAbono: 'Recaudado Transbank (bruto)',
      campoRec: 'rec_webpay', campoAbono: 'total_abono',
      readOnly: true,
      fetchRecaudacion: p => fetchRecaudacionDiaria({ ...p, campo: 'rec_webpay' }),
      fetchAbonos:      p => fetchWebpayDiario(p),
    },
    transferencia: {
      titulo: 'Transferencias', tabla: 'abonos_transferencia',
      labelAbono: 'Transferencias recibidas',
      campoRec: 'rec_transferencia', campoAbono: 'monto',
      extraCols: [{ key: 'banco', label: 'Banco' }, { key: 'nombre_emisor', label: 'Emisor' }],
      fetchRecaudacion: p => fetchRecaudacionDiaria({ ...p, campo: 'rec_transferencia' }),
      fetchAbonos:      p => fetchAbonosBancarios('abonos_transferencia', p),
    },
    mercado_pago: {
      titulo: 'Mercado Pago', tabla: 'abonos_mercado_pago',
      labelAbono: 'Abonos Mercado Pago',
      campoRec: 'rec_mercado_pago', campoAbono: 'monto_neto',
      extraCols: [{ key: 'monto_bruto', label: 'Bruto' }, { key: 'comision', label: 'Comisión' }],
      fetchRecaudacion: p => fetchRecaudacionDiaria({ ...p, campo: 'rec_mercado_pago' }),
      fetchAbonos:      p => fetchAbonosBancarios('abonos_mercado_pago', p),
    },
  }
}

async function fetchWebpayAgrupado({ desde, hasta }) {
  const mes = desde.slice(0,7) + '-01'
  const { data, error } = await supabase.from('v_webpay_mensual')
    .select('tipo_normalizado, total_bruto, n_transacciones')
    .eq('mes', mes)
  if (error) throw error
  return (data ?? []).map(r => ({
    fecha: desde, sucursal_id: null,
    total_abono: Number(r.total_bruto ?? 0),
    tipo: r.tipo_normalizado, n: r.n_transacciones,
  }))
}

async function fetchWebpayDiario({ desde, hasta }) {
  const { data, error } = await supabase.from('v_webpay_dia')
    .select('fecha, tipo, total_bruto, n_transacciones')
    .gte('fecha', desde).lte('fecha', hasta)
    .order('fecha', { ascending: false })
  if (error) throw error
  // Agrupar por fecha sumando todos los tipos (débito + crédito juntos)
  const map = {}
  for (const r of data ?? []) {
    if (!map[r.fecha]) map[r.fecha] = { fecha: r.fecha, sucursal_id: null, total_abono: 0, n: 0 }
    map[r.fecha].total_abono += Number(r.total_bruto ?? 0)
    map[r.fecha].n           += Number(r.n_transacciones ?? 0)
  }
  return Object.values(map).sort((a, b) => b.fecha.localeCompare(a.fecha))
}

// ── Getnet Consolidado ────────────────────────────────────────────────────────
function GetnetConsolidado({ desde, hasta, sucursales, sucursalEf }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const fmt = n => formatCLP(n ?? 0)

  useEffect(() => {
    setLoading(true)
    // Extraer mes/año del rango para filtrar la vista agregada
    const mes  = desde.slice(0, 7) + '-01'

    Promise.all([
      // Corroborado: agregar cierres en JS (pocos registros)
      supabase.from('cierres_caja')
        .select('sucursal_id, t_debito_corrob, t_credito_corrob')
        .gte('fecha', desde).lte('fecha', hasta)
        .not('estado', 'eq', 'anulado')
        .limit(5000),
      // Getnet: usar vista agregada — devuelve solo 1 fila por sucursal/tipo
      (() => {
        let q = supabase.from('v_getnet_mensual')
          .select('sucursal_id, tipo_normalizado, total_bruto')
          .eq('mes', mes)
        if (sucursalEf) q = q.eq('sucursal_id', sucursalEf)
        return q
      })(),
    ]).then(([{ data: cierres, error: e1 }, { data: getnet, error: e2 }]) => {
      if (e1 || e2) { console.error(e1, e2); return }

      const corrMap = {}
      for (const c of cierres ?? []) {
        if (sucursalEf && c.sucursal_id !== sucursalEf) continue
        const k = c.sucursal_id ?? 'sin_suc'
        if (!corrMap[k]) corrMap[k] = { debito: 0, credito: 0 }
        corrMap[k].debito  += Number(c.t_debito_corrob  ?? 0)
        corrMap[k].credito += Number(c.t_credito_corrob ?? 0)
      }

      const getMap = {}
      for (const g of getnet ?? []) {
        const k = g.sucursal_id ?? 'sin_suc'
        if (!getMap[k]) getMap[k] = { debito_bruto: 0, credito_bruto: 0 }
        if (g.tipo_normalizado === 'DEBITO') getMap[k].debito_bruto  += Number(g.total_bruto ?? 0)
        else                                 getMap[k].credito_bruto += Number(g.total_bruto ?? 0)
      }

      const sucIds = new Set([...Object.keys(corrMap), ...Object.keys(getMap)])
      const result = Array.from(sucIds).map(sucId => {
        const c = corrMap[sucId] ?? { debito: 0, credito: 0 }
        const g = getMap[sucId]  ?? { debito_bruto: 0, credito_bruto: 0 }
        const corrTotal = c.debito + c.credito
        const getTotal  = g.debito_bruto + g.credito_bruto
        return { sucId, debito: c.debito, credito: c.credito,
          debito_neto: g.debito_bruto, credito_neto: g.credito_bruto,
          corrTotal, getTotal, brecha: getTotal - corrTotal }
      })
      setRows(result)
    }).catch(e => console.error(e)).finally(() => setLoading(false))
  }, [desde, hasta, sucursalEf])

  const sucMap = Object.fromEntries(sucursales.map(s => [s.id, s.nombre]))

  const TOT = rows.reduce((a, r) => ({
    debito:       a.debito       + r.debito,
    credito:      a.credito      + r.credito,
    debito_neto:  a.debito_neto  + r.debito_neto,
    credito_neto: a.credito_neto + r.credito_neto,
    corrTotal:    a.corrTotal    + r.corrTotal,
    getTotal:     a.getTotal     + r.getTotal,
    brecha:       a.brecha       + r.brecha,
  }), { debito:0, credito:0, debito_neto:0, credito_neto:0, corrTotal:0, getTotal:0, brecha:0 })

  if (loading) return <div style={{ textAlign:'center', padding:32 }}><Loader2 size={20} style={{ display:'inline-block', color:'#9CA3AF' }} /></div>

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {/* KPIs globales */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10 }}>
        <KpiMini title="Corroborado débito"        value={fmt(TOT.debito)}      color="#1E40AF" />
        <KpiMini title="Corroborado crédito"       value={fmt(TOT.credito)}     color="#7C3AED" />
        <KpiMini title="Total corroborado"         value={fmt(TOT.corrTotal)}   color="#1F4E79" />
        <KpiMini title="Getnet POS bruto (dep.)"   value={fmt(TOT.getTotal)}    color="#16A34A" />
        <KpiMini title="Brecha"                    value={fmt(TOT.brecha)}
          color={Math.abs(TOT.brecha)<50000?'#16A34A':'#DC2626'} />
      </div>

      {/* Tabla por sucursal */}
      <div style={{ ...cardSt, padding:0, overflow:'hidden' }}>
        <div style={{ padding:'12px 16px', borderBottom:'1px solid #F3F4F6', fontSize:14, fontWeight:600 }}>
          Desglose por sucursal
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead><tr style={{ background:'#F9FAFB' }}>
              <th style={TH}>Sucursal</th>
              <th style={{ ...TH, textAlign:'right' }}>Corrob. Débito</th>
              <th style={{ ...TH, textAlign:'right' }}>Corrob. Crédito</th>
              <th style={{ ...TH, textAlign:'right', background:'#EFF6FF' }}>Total corroborado</th>
              <th style={{ ...TH, textAlign:'right' }}>Getnet Débito</th>
              <th style={{ ...TH, textAlign:'right' }}>Getnet Crédito</th>
              <th style={{ ...TH, textAlign:'right', background:'#F0FDF4' }}>Total Getnet</th>
              <th style={{ ...TH, textAlign:'right' }}>Brecha</th>
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const esOk = Math.abs(r.brecha) < 50000
                return (
                  <tr key={r.sucId} style={{ borderTop:'1px solid #F3F4F6' }}>
                    <td style={{ ...TD, fontWeight:600 }}>{sucMap[r.sucId] ?? r.sucId}</td>
                    <td style={{ ...TD, textAlign:'right' }}>{fmt(r.debito)}</td>
                    <td style={{ ...TD, textAlign:'right' }}>{fmt(r.credito)}</td>
                    <td style={{ ...TD, textAlign:'right', fontWeight:700, background:'#F0F9FF' }}>{fmt(r.corrTotal)}</td>
                    <td style={{ ...TD, textAlign:'right' }}>{fmt(r.debito_neto)}</td>
                    <td style={{ ...TD, textAlign:'right' }}>{fmt(r.credito_neto)}</td>
                    <td style={{ ...TD, textAlign:'right', fontWeight:700, background:'#F0FDF4' }}>{fmt(r.getTotal)}</td>
                    <td style={{ ...TD, textAlign:'right', fontWeight:700, color:esOk?'#16A34A':'#DC2626' }}>
                      {r.brecha>=0?'+':''}{fmt(r.brecha)}
                    </td>
                  </tr>
                )
              })}
              {/* Total */}
              <tr style={{ borderTop:'2px solid #E5E7EB', background:'#F9FAFB' }}>
                <td style={{ ...TD, fontWeight:700 }}>TOTAL</td>
                <td style={{ ...TD, textAlign:'right', fontWeight:700 }}>{fmt(TOT.debito)}</td>
                <td style={{ ...TD, textAlign:'right', fontWeight:700 }}>{fmt(TOT.credito)}</td>
                <td style={{ ...TD, textAlign:'right', fontWeight:700, background:'#F0F9FF' }}>{fmt(TOT.corrTotal)}</td>
                <td style={{ ...TD, textAlign:'right', fontWeight:700 }}>{fmt(TOT.debito_neto)}</td>
                <td style={{ ...TD, textAlign:'right', fontWeight:700 }}>{fmt(TOT.credito_neto)}</td>
                <td style={{ ...TD, textAlign:'right', fontWeight:700, background:'#F0FDF4' }}>{fmt(TOT.getTotal)}</td>
                <td style={{ ...TD, textAlign:'right', fontWeight:700,
                  color:Math.abs(TOT.brecha)<50000?'#16A34A':'#DC2626' }}>
                  {TOT.brecha>=0?'+':''}{fmt(TOT.brecha)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ padding:'10px 16px', borderTop:'1px solid #F3F4F6', fontSize:11, color:'#9CA3AF' }}>
          Corroborado = suma de t_debito_corrob + t_credito_corrob de cierres de caja ·
          Getnet POS = valor_cuota bruto del reporte importado (sin descontar comisión — la comisión se resta en etapa Recaudado)
        </div>
      </div>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────
export function DepositosAbonosTab({ usuario }) {
  const now = new Date()
  const [anio, setAnio]   = useState(now.getFullYear())
  const [mes, setMes]     = useState(now.getMonth() + 1)
  const [sucursales, setSucursales] = useState([])
  const [capsLoaded, setCapsLoaded] = useState(false)

  // Precargar capabilities al montar
  useEffect(() => {
    if (usuario?.id) preloadCaps(usuario, 'finanzas').then(() => setCapsLoaded(true))
  }, [usuario?.id])

  // RBAC-6: permisos vía capabilities dinámicas
  // ver_todas: puede elegir cualquier sucursal y ver todas
  // dep.escribir: puede registrar/editar depósitos
  const puedeElegirSuc = capsLoaded
    ? canSync(usuario, 'finanzas', 'fin.teso.cierre.ver_todas') !== false
    : usuario?.rol === 'admin'

  const puedeEscribir = capsLoaded
    ? canSync(usuario, 'finanzas', 'fin.teso.dep.escribir') !== false
    : usuario?.rol === 'admin'

  // esAdmin: para permitir revertir/eliminar depósitos con comprobante ya confirmado
  const esAdmin = usuario?.rol === 'admin'

  // sucursalFiltro: null = ve todas, 'suc-lg' = solo su sucursal
  const sucursalFiltro = capsLoaded
    ? userScopeSync(usuario, 'finanzas', 'fin.teso.depositos')
    : null

  const [sucursal, setSucursal] = useState(
    sucursalFiltro || (puedeElegirSuc ? 'all' : (usuario.sucursal_id ?? ''))
  )

  // Sincronizar sucursal cuando caps cargan
  useEffect(() => {
    if (sucursalFiltro) setSucursal(sucursalFiltro)
    else if (puedeElegirSuc && sucursal === '') setSucursal('all')
  }, [sucursalFiltro, puedeElegirSuc])

  const [grupo, setGrupo]       = useState('efectivo')
  const [subTab, setSubTab]     = useState('efectivo')
  const { desde, hasta }  = rangoMes(anio, mes)
  const sucursalEf        = sucursal === 'all' ? null : sucursal || null
  const anios             = [now.getFullYear()-1, now.getFullYear(), now.getFullYear()+1]

  useEffect(() => { fetchSucursales().then(setSucursales).catch(() => {}) }, [])

  // Grupos y sus sub-tabs
  const GRUPOS = [
    {
      k: 'efectivo', l: 'Efectivo',
      tabs: [
        { k: 'efectivo',    l: 'Efectivo'           },
        { k: 'importar_ef', l: '📤 Importar'         },
      ]
    },
    {
      k: 'getnet', l: 'Getnet',
      tabs: [
        { k: 'debito',           l: 'Débito'          },
        { k: 'credito',          l: 'Crédito'         },
        { k: 'getnet_consol',    l: 'Consolidado'     },
        { k: 'importar_getnet',  l: '📤 Importar'     },
      ]
    },
    {
      k: 'webpay', l: 'Webpay',
      tabs: [
        { k: 'webpay',          l: 'Link de pago'    },
        { k: 'importar_webpay', l: '📤 Importar'     },
      ]
    },
    {
      k: 'transferencia', l: 'Transferencia',
      tabs: [{ k: 'transferencia', l: 'Transferencia' }]
    },
    {
      k: 'mercado_pago', l: 'Mercado Pago',
      tabs: [{ k: 'mercado_pago', l: 'Mercado Pago' }]
    },
  ]

  const grupoActual = GRUPOS.find(g => g.k === grupo)
  const configs     = buildConfigs(desde, hasta, sucursalEf)

  // Cuando cambia grupo → ir al primer sub-tab
  function cambiarGrupo(g) {
    setGrupo(g)
    setSubTab(GRUPOS.find(x => x.k === g)?.tabs[0]?.k ?? g)
  }

  const esImportador = ['importar_ef','importar_getnet','importar_webpay'].includes(subTab)
  const esConsolid   = subTab === 'getnet_consol'

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      {/* Grupos — nivel 1 */}
      <div style={{ display:'flex', gap:4, borderBottom:'2px solid #E5E7EB', overflowX:'auto' }}>
        {GRUPOS.map(g => (
          <button key={g.k} onClick={() => cambiarGrupo(g.k)} style={{
            padding:'10px 18px', fontSize:13, fontWeight:700, background:'none', border:'none',
            cursor:'pointer', whiteSpace:'nowrap',
            color:      grupo===g.k ? '#1F4E79' : '#6B7280',
            borderBottom: `3px solid ${grupo===g.k ? '#1F4E79' : 'transparent'}`,
            marginBottom: -2,
          }}>{g.l}</button>
        ))}
      </div>

      {/* Sub-tabs — nivel 2 */}
      {grupoActual && grupoActual.tabs.length > 1 && (
        <div style={{ display:'flex', gap:2, borderBottom:'1px solid #E5E7EB', overflowX:'auto' }}>
          {grupoActual.tabs.map(t => (
            <button key={t.k} onClick={() => setSubTab(t.k)} style={{
              padding:'6px 14px', fontSize:12, fontWeight:600, background:'none', border:'none',
              cursor:'pointer', whiteSpace:'nowrap',
              color:      subTab===t.k ? '#4F46E5' : '#6B7280',
              borderBottom: `2px solid ${subTab===t.k ? '#4F46E5' : 'transparent'}`,
            }}>{t.l}</button>
          ))}
        </div>
      )}

      {/* Filtros — ocultar en importadores */}
      {!esImportador && (
        <div style={cardSt}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:12 }}>
            <div>
              <label style={labelSt}>Año</label>
              <select style={selectSt} value={String(anio)} onChange={e => setAnio(Number(e.target.value))}>
                {anios.map(a => <option key={a} value={String(a)}>{a}</option>)}
              </select>
            </div>
            <div>
              <label style={labelSt}>Mes</label>
              <select style={selectSt} value={String(mes)} onChange={e => setMes(Number(e.target.value))}>
                {Array.from({length:12},(_,i)=>i+1).map(m => (
                  <option key={m} value={String(m)}>{String(m).padStart(2,'0')}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelSt}>Sucursal</label>
              <select style={selectSt} value={sucursal} disabled={!puedeElegirSuc} onChange={e => setSucursal(e.target.value)}>
                {puedeElegirSuc && <option value="all">Todas</option>}
                {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Contenido */}
      {subTab === 'importar_ef'     && <ImportadorEfectivo sucursales={sucursales} />}
      {subTab === 'importar_getnet' && <ImportadorGetnet />}
      {subTab === 'importar_webpay' && <ImportadorWebpay />}
      {esConsolid && (
        <GetnetConsolidado desde={desde} hasta={hasta} sucursales={sucursales} sucursalEf={sucursalEf} />
      )}
      {!esImportador && !esConsolid && configs[subTab] && (
        <SeccionMedio
          key={subTab}
          config={configs[subTab]}
          sucursalEf={sucursalEf}
          desde={desde} hasta={hasta}
          puedeEscribir={puedeEscribir}
          sucursales={sucursales}
          usuario={usuario}
          esAdmin={esAdmin}
        />
      )}
    </div>
  )
}
