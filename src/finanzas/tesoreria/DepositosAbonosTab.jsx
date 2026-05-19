import { useEffect, useRef, useState, useMemo } from 'react'
import { toast } from 'sonner'
import { Plus, Paperclip, FileCheck, Loader2, Upload, ChevronDown, ChevronUp } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabase'
import {
  formatCLP, parseCLP, rangoMes,
  inputSt, selectSt, labelSt, cardSt, btnSt, btnOutlineSt, TH, TD,
} from './types'
import { fetchDepositosEfectivo, fetchAbonos, fetchSucursales, insertGenerico } from './api'

const PUEDE_ESCRIBIR = ['admin','contabilidad','jefe_admin_finanzas','gerente_admin_finanzas','admin_sistema']
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
function parseFechaGetnet(v) {
  if (!v) return null
  if (v instanceof Date) return v.toISOString()
  const s = String(v).trim()
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}.000Z`
  const m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`
  return null
}
function parseFechaAbono(v) {
  if (!v) return null
  if (v instanceof Date) return v.toISOString().slice(0,10)
  const s = String(v).trim()
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return null
}
function procesarExcelGetnet(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
  const COL = {}
  rows[0].forEach((h, i) => { COL[String(h).trim().toUpperCase()] = i })
  const toNum = v => { const n = parseFloat(String(v).replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n }
  return rows.slice(1).filter(r => {
    const estado = String(r[COL['ESTADO']]||'').trim().toLowerCase()
    return estado === 'abonado' && String(r[COL['ID TRANSACCIÓN']]||'').trim()
  }).map(r => ({
    id_transaccion:    String(r[COL['ID TRANSACCIÓN']]||'').trim(),
    cod_aut:           String(r[COL['COD.AUT']]||'').trim(),
    local_getnet:      String(r[COL['LOCAL']]||'').trim(),
    sucursal_id:       getSucId(String(r[COL['LOCAL']]||'')),
    num_local:         String(r[COL['NUM LOCAL']]||'').trim(),
    terminal:          String(r[COL['TERMINAL']]||'').trim(),
    vendedor_getnet:   String(r[COL['VENDEDOR']]||'').trim(),
    marca:             String(r[COL['MARCA']]||'').trim(),
    tipo:              String(r[COL['TIPO']]||'').trim(),
    tipo_movimiento:   String(r[COL['TIPO MOV.']]||'').trim(),
    cuotas:            parseInt(r[COL['CUOTAS']]||'1')||1,
    bin:               String(r[COL['BIN']]||'').trim(),
    valor_venta:       toNum(r[COL['VALOR VENTA']]),
    valor_transaccion: toNum(r[COL['VALOR TRANSACCIÓN']]),
    comision:          toNum(r[COL['COMISIÓN']]),
    monto_abono:       toNum(r[COL['MONTO ABONO']]),
    fecha_venta:       parseFechaGetnet(r[COL['FECHA VENTA']]),
    fecha_abono:       parseFechaAbono(r[COL['FECHA ABONO']]),
    tipo_pago:         /DEB/i.test(String(r[COL['TIPO']]||'')) ? 'DEBITO' : 'CREDITO',
    estado:            'abonado',
    estado_transaccion: String(r[COL['ESTADO']]||'').trim(),
  }))
}

// ── UI helpers ────────────────────────────────────────────────────────────────
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

// ── Importador Getnet ─────────────────────────────────────────────────────────
function ImportadorGetnet() {
  const fileRef = useRef()
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [resultado, setResultado] = useState(null)
  async function procesarArchivo(file) {
    if (!file) return
    setUploading(true); setResultado(null)
    try {
      const txns = procesarExcelGetnet(new Uint8Array(await file.arrayBuffer()))
      if (!txns.length) { setResultado({ ok: false, msg: 'No se encontraron transacciones "Abonado".' }); return }
      let insertadas = 0, duplicadas = 0
      for (let i = 0; i < txns.length; i += 500) {
        const { data, error } = await supabase.from('getnet_transacciones')
          .upsert(txns.slice(i, i+500), { onConflict: 'id_transaccion', ignoreDuplicates: true }).select('id')
        if (error) throw error
        insertadas += (data||[]).length; duplicadas += txns.slice(i,i+500).length - (data||[]).length
      }
      setResultado({ ok: true, msg: `${insertadas} nuevas · ${duplicadas} duplicadas (ignoradas)` })
    } catch (e) { setResultado({ ok: false, msg: e instanceof Error ? e.message : 'Error' }) }
    finally { setUploading(false) }
  }
  return (
    <div style={cardSt}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Importar Excel Getnet</div>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); procesarArchivo(e.dataTransfer.files[0]) }}
        onClick={() => fileRef.current?.click()}
        style={{ border: `2px dashed ${dragOver ? '#1F4E79' : '#D1D5DB'}`, borderRadius: 10,
          padding: '32px 20px', textAlign: 'center', cursor: 'pointer',
          background: dragOver ? '#EFF6FF' : '#FAFAFA', transition: 'all 0.2s' }}>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
          onChange={e => procesarArchivo(e.target.files?.[0])} />
        {uploading ? <Loader2 size={24} style={{ display: 'inline-block', color: '#1F4E79' }} />
          : <><Upload size={24} color="#9CA3AF" /><div style={{ marginTop: 8, fontSize: 13, color: '#6B7280' }}>Arrastra el Excel Getnet o haz clic para seleccionar</div></>}
      </div>
      {resultado && (
        <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, fontSize: 12,
          background: resultado.ok ? '#DCFCE7' : '#FEE2E2', color: resultado.ok ? '#166534' : '#991B1B' }}>
          {resultado.ok ? '✓' : '✕'} {resultado.msg}
        </div>
      )}
    </div>
  )
}

// ── Fetch recaudación diaria desde la vista ───────────────────────────────────
async function fetchRecaudacionDiaria({ desde, hasta, sucursal_id, campo }) {
  let q = supabase.from('v_recaudacion_diaria')
    .select(`fecha, sucursal_id, ${campo}`)
    .gte('fecha', desde).lte('fecha', hasta)
    .gt(campo, 0)
    .order('fecha', { ascending: false })
  if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

// ── Fetch abonos bancarios por tabla ──────────────────────────────────────────
async function fetchAbonosBancarios(tabla, { desde, hasta, sucursal_id }) {
  let q = supabase.from(tabla).select('*').gte('fecha', desde).lte('fecha', hasta).order('fecha', { ascending: false })
  if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

// Fetch getnet agrupado por fecha/sucursal/tipo
async function fetchGetnetAgrupado({ desde, hasta, sucursal_id, tipo_pago }) {
  let q = supabase.from('getnet_transacciones')
    .select('fecha_abono, sucursal_id, monto_abono')
    .gte('fecha_abono', desde).lte('fecha_abono', hasta)
    .eq('estado', 'abonado')
  if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)
  if (tipo_pago)   q = q.ilike('tipo_pago', `%${tipo_pago}%`)
  const { data, error } = await q
  if (error) throw error
  // Agrupar por fecha
  const map = {}
  for (const r of data ?? []) {
    const key = `${r.fecha_abono}|${r.sucursal_id}`
    if (!map[key]) map[key] = { fecha: r.fecha_abono, sucursal_id: r.sucursal_id, total_abono: 0 }
    map[key].total_abono += Number(r.monto_abono ?? 0)
  }
  return Object.values(map).sort((a, b) => b.fecha.localeCompare(a.fecha))
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
      let payload = { sucursal_id: form.sucursal_id, fecha: form.fecha, n_comprobante: form.n_comprobante || null, observacion: form.observacion || null }
      if (config.tabla === 'depositos_efectivo') payload = { ...payload, monto_depositado: form.monto, banco: form.banco || null }
      else if (config.tabla === 'abonos_getnet')  payload = { ...payload, total_abono: form.monto }
      else if (config.tabla === 'abonos_webpay')  payload = { ...payload, deposito_transbank: form.monto }
      else if (config.tabla === 'abonos_transferencia') payload = { ...payload, monto: form.monto, banco: form.banco || null, cuenta_origen: form.cuenta_origen || null, rut_emisor: form.rut_emisor || null, nombre_emisor: form.nombre_emisor || null }
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
          {(config.tabla === 'depositos_efectivo' || config.tabla === 'abonos_transferencia') && (
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
function SeccionMedio({ config, sucursalEf, desde, hasta, puedeEscribir, sucursales }) {
  const [recaudacion, setRecaudacion] = useState([])
  const [abonos, setAbonos] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [sucMap, setSucMap] = useState({})

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* KPIs resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10 }}>
        <KpiMini title="Recaudado mes (BSALE)" value={fmt(totalRecaudado)} color="#1F4E79" />
        <KpiMini title={config.labelAbono} value={fmt(totalAbonado)} color="#16A34A" />
        <KpiMini title="Brecha" value={fmt(brecha)}
          color={Math.abs(brecha) < 5000 ? '#16A34A' : Math.abs(brecha) < 50000 ? '#D97706' : '#DC2626'} />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 24 }}><Loader2 size={20} style={{ display: 'inline-block', color: '#9CA3AF' }} /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

          {/* Columna izquierda: Recaudación BSALE */}
          <div style={{ ...cardSt, padding: 0, overflow: 'hidden', marginBottom: 0 }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #F3F4F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1F4E79' }}>Recaudación BSALE</span>
              <span style={{ fontSize: 11, color: '#9CA3AF' }}>desde cierres declarados</span>
            </div>
            {recaudacion.length === 0 ? (
              <div style={{ padding: '20px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Sin datos</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={TH}>Fecha</th>
                  <th style={TH}>Sucursal</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Monto</th>
                </tr></thead>
                <tbody>
                  {recaudacion.map((r, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #F3F4F6' }}>
                      <td style={TD}>{r.fecha}</td>
                      <td style={TD}>{sucMap[r.sucursal_id] ?? r.sucursal_id ?? '—'}</td>
                      <td style={{ ...TD, textAlign: 'right', fontWeight: 600 }}>{fmt(r[config.campoRec])}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid #E5E7EB', background: '#F9FAFB' }}>
                    <td colSpan={2} style={{ ...TD, fontWeight: 700 }}>TOTAL</td>
                    <td style={{ ...TD, textAlign: 'right', fontWeight: 700 }}>{fmt(totalRecaudado)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>

          {/* Columna derecha: Depósitos/Abonos */}
          <div style={{ ...cardSt, padding: 0, overflow: 'hidden', marginBottom: 0 }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #F3F4F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#16A34A' }}>{config.labelAbono}</span>
              {puedeEscribir && !config.readOnly && (
                <button onClick={() => setModal(true)} style={{ ...btnSt('#16A34A'), padding: '3px 10px', fontSize: 11 }}>
                  <Plus size={12} /> Registrar
                </button>
              )}
            </div>
            {abonos.length === 0 ? (
              <div style={{ padding: '20px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Sin registros</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={TH}>Fecha</th>
                  <th style={TH}>Sucursal</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Monto</th>
                  {config.extraCols?.map(c => <th key={c.key} style={TH}>{c.label}</th>)}
                  <th style={{ ...TH, textAlign: 'center' }}>Comprobante</th>
                </tr></thead>
                <tbody>
                  {abonos.map((r, i) => (
                    <tr key={r.id ?? i} style={{ borderTop: '1px solid #F3F4F6' }}>
                      <td style={TD}>{r.fecha ?? r.fecha_abono}</td>
                      <td style={TD}>{sucMap[r.sucursal_id] ?? r.sucursal_id ?? '—'}</td>
                      <td style={{ ...TD, textAlign: 'right', fontWeight: 600 }}>{fmt(r[config.campoAbono])}</td>
                      {config.extraCols?.map(c => <td key={c.key} style={TD}>{String(r[c.key] ?? '—')}</td>)}
                      <td style={{ ...TD, textAlign: 'center' }}>
                        {config.readOnly ? (
                          <span style={{ fontSize: 11, color: '#9CA3AF' }}>—</span>
                        ) : (
                          <ComprobanteCell
                            tabla={config.tabla} rowId={String(r.id ?? '')}
                            sucursalId={String(r.sucursal_id ?? '')}
                            url={r.comprobante_url ?? null} nombre={r.comprobante_nombre ?? null}
                            onUpdated={cargar}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid #E5E7EB', background: '#F9FAFB' }}>
                    <td colSpan={2 + (config.extraCols?.length ?? 0)} style={{ ...TD, fontWeight: 700 }}>TOTAL</td>
                    <td style={{ ...TD, textAlign: 'right', fontWeight: 700 }}>{fmt(totalAbonado)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Brecha detalle */}
      {!loading && (
        <div style={{ background: Math.abs(brecha) < 5000 ? '#F0FDF4' : Math.abs(brecha) < 50000 ? '#FFFBEB' : '#FEF2F2',
          border: `1px solid ${Math.abs(brecha) < 5000 ? '#BBF7D0' : Math.abs(brecha) < 50000 ? '#FDE68A' : '#FECACA'}`,
          borderRadius: 8, padding: '10px 16px', fontSize: 12,
          color: Math.abs(brecha) < 5000 ? '#166534' : Math.abs(brecha) < 50000 ? '#92400E' : '#991B1B',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>
            {Math.abs(brecha) < 5000
              ? '✓ Recaudación y depósitos cuadran'
              : brecha < 0
                ? `⚠ Recaudado más de lo depositado — faltan ${fmt(Math.abs(brecha))} por depositar`
                : `⚠ Depositado más de lo recaudado — excedente de ${fmt(brecha)}`}
          </span>
          <span style={{ fontWeight: 700 }}>{fmt(brecha)}</span>
        </div>
      )}

      {modal && (
        <ModalRegistro config={config} sucursales={sucursales} sucursalEf={sucursalEf} hasta={hasta}
          onClose={() => setModal(false)} onSaved={() => { setModal(false); cargar() }} />
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
      extraCols: [{ key: 'banco', label: 'Banco' }],
      fetchRecaudacion: p => fetchRecaudacionDiaria({ ...p, campo: 'rec_efectivo' }),
      fetchAbonos:      p => fetchAbonosBancarios('depositos_efectivo', p),
    },
    debito: {
      titulo: 'Débito Getnet', tabla: 'getnet_transacciones',
      labelAbono: 'Abonos Getnet (débito)',
      campoRec: 'rec_debito', campoAbono: 'total_abono',
      readOnly: true,
      fetchRecaudacion: p => fetchRecaudacionDiaria({ ...p, campo: 'rec_debito' }),
      fetchAbonos:      p => fetchGetnetAgrupado({ ...p, tipo_pago: 'DEB' }),
    },
    credito: {
      titulo: 'Crédito Getnet', tabla: 'getnet_transacciones',
      labelAbono: 'Abonos Getnet (crédito)',
      campoRec: 'rec_credito', campoAbono: 'total_abono',
      readOnly: true,
      fetchRecaudacion: p => fetchRecaudacionDiaria({ ...p, campo: 'rec_credito' }),
      fetchAbonos:      p => fetchGetnetAgrupado({ ...p, tipo_pago: 'CRED' }),
    },
    webpay: {
      titulo: 'Webpay / Link de pago', tabla: 'abonos_webpay',
      labelAbono: 'Abonos Transbank',
      campoRec: 'rec_webpay', campoAbono: 'deposito_transbank',
      fetchRecaudacion: p => fetchRecaudacionDiaria({ ...p, campo: 'rec_webpay' }),
      fetchAbonos:      p => fetchAbonosBancarios('abonos_webpay', p),
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

// ── Componente principal ──────────────────────────────────────────────────────
export function DepositosAbonosTab({ usuario }) {
  const now = new Date()
  const [anio, setAnio]   = useState(now.getFullYear())
  const [mes, setMes]     = useState(now.getMonth() + 1)
  const [sucursales, setSucursales] = useState([])
  const puedeElegirSuc    = PUEDE_ESCRIBIR.includes(usuario.rol) || usuario.rol === 'gerencia'
  const [sucursal, setSucursal] = useState(puedeElegirSuc ? 'all' : (usuario.sucursal_id ?? ''))
  const [tabActivo, setTabActivo] = useState('efectivo')
  const puedeEscribir     = PUEDE_ESCRIBIR.includes(usuario.rol)
  const { desde, hasta }  = rangoMes(anio, mes)
  const sucursalEf        = sucursal === 'all' ? null : sucursal || null
  const anios             = [now.getFullYear()-1, now.getFullYear(), now.getFullYear()+1]

  useEffect(() => { fetchSucursales().then(setSucursales).catch(() => {}) }, [])

  const TABS = [
    { k: 'efectivo',      l: 'Efectivo'        },
    { k: 'debito',        l: 'Débito Getnet'    },
    { k: 'credito',       l: 'Crédito Getnet'   },
    { k: 'importar',      l: '📤 Importar Getnet' },
    { k: 'webpay',        l: 'Webpay'           },
    { k: 'transferencia', l: 'Transferencia'    },
    { k: 'mercado_pago',  l: 'Mercado Pago'     },
  ]

  const configs = buildConfigs(desde, hasta, sucursalEf)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filtros */}
      {tabActivo !== 'importar' && (
        <div style={cardSt}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))', gap: 12 }}>
            <div>
              <label style={labelSt}>Año</label>
              <select style={selectSt} value={String(anio)} onChange={e => setAnio(Number(e.target.value))}>
                {anios.map(a => <option key={a} value={String(a)}>{a}</option>)}
              </select>
            </div>
            <div>
              <label style={labelSt}>Mes</label>
              <select style={selectSt} value={String(mes)} onChange={e => setMes(Number(e.target.value))}>
                {Array.from({ length: 12 },(_,i)=>i+1).map(m => (
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

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #E5E7EB', overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t.k} onClick={() => setTabActivo(t.k)} style={{
            padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer',
            color: tabActivo === t.k ? '#1F4E79' : '#6B7280',
            borderBottom: `2px solid ${tabActivo === t.k ? '#1F4E79' : 'transparent'}`,
            whiteSpace: 'nowrap',
          }}>{t.l}</button>
        ))}
      </div>

      {/* Contenido */}
      {tabActivo === 'importar' && <ImportadorGetnet />}
      {tabActivo !== 'importar' && configs[tabActivo] && (
        <SeccionMedio
          key={tabActivo}
          config={configs[tabActivo]}
          sucursalEf={sucursalEf}
          desde={desde} hasta={hasta}
          puedeEscribir={puedeEscribir}
          sucursales={sucursales}
        />
      )}
    </div>
  )
}
