import { useEffect, useRef, useState, useMemo } from 'react'
import { toast } from 'sonner'
import { Upload, Loader2, ChevronDown, ChevronUp, Check, X } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabase'
import {
  formatCLP, rangoMes,
  inputSt, selectSt, labelSt, cardSt, btnSt, btnOutlineSt, TH, TD,
} from './types'

const fmt = n => formatCLP(n ?? 0)

// ── Clasificación automática ───────────────────────────────────────────────
function clasificarDesc(desc) {
  const d = (desc || '').toUpperCase()
  if (d.includes('GETNET'))                           return 'GETNET'
  if (d.includes('ABN CRD DB TRAN TRANSBA') || d.includes('WEBPAY') || d.includes('TRANSBANK')) return 'WEBPAY'
  if (d.includes('DEPÓS') || d.includes('DEPOSITO') || d.includes('DEPOSITOS EN EFECTIVO')) return 'DEPOSITO'
  if (d.includes('TRANSF'))                           return 'TRANSFERENCIA'
  if (d.includes('CHEQUE'))                           return 'CHEQUE'
  return 'OTRO'
}

const TIPO_LABEL = {
  GETNET:        { label: 'Getnet',       color: '#1E40AF', bg: '#EFF6FF' },
  WEBPAY:        { label: 'Webpay/TB',    color: '#4F46E5', bg: '#EEF2FF' },
  DEPOSITO:      { label: 'Depósito',     color: '#16A34A', bg: '#F0FDF4' },
  TRANSFERENCIA: { label: 'Transferencia',color: '#D97706', bg: '#FFFBEB' },
  CHEQUE:        { label: 'Cheque',       color: '#7C3AED', bg: '#F5F3FF' },
  OTRO:          { label: 'Otro',         color: '#6B7280', bg: '#F9FAFB' },
}

const TIPO_CONFIRMADO_OPTS = [
  { v: 'getnet',               l: 'Getnet' },
  { v: 'webpay',               l: 'Webpay / Transbank' },
  { v: 'deposito_efectivo',    l: 'Depósito efectivo' },
  { v: 'transferencia_cliente',l: 'Transferencia cliente' },
  { v: 'prestamo_socio',       l: 'Préstamo socio' },
  { v: 'reembolso',            l: 'Reembolso' },
  { v: 'otro',                 l: 'Otro' },
]

// ── Parser Excel Santander ─────────────────────────────────────────────────
function parsearCartola(buffer) {
  const wb   = XLSX.read(buffer, { type: 'array', raw: false, cellDates: false })
  const ws   = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })

  // Extraer metadata
  let nCartola = null, cuentaBancaria = null
  for (const row of rows.slice(0, 10)) {
    const txt = String(row[0] || '')
    const mC = txt.match(/Número cartola:\s*(\d+)/i)
    if (mC) nCartola = mC[1]
    const mCC = txt.match(/Cuenta Corriente N°:\s*([\d-]+)/i)
    if (mCC) cuentaBancaria = mCC[1].replace(/-/g, '')
  }

  // Buscar fila de encabezados (contiene "MONTO")
  let dataStart = -1
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] && String(rows[i][0]).toUpperCase().includes('MONTO')) {
      dataStart = i + 1; break
    }
  }
  if (dataStart < 0) throw new Error('No se encontró la tabla de movimientos')

  const toN = v => { if (!v) return 0; if (typeof v === 'number') return Math.round(v); const n = parseFloat(String(v).replace(/[^0-9.-]/g,'')); return isNaN(n)?0:Math.round(n) }
  const toF = v => {
    if (!v) return null
    const s = String(v).trim()
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
    if (m) return `${m[3]}-${m[2]}-${m[1]}`
    return null
  }

  const result = []
  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i]
    if (!row[0] || !row[3]) continue
    const monto = toN(row[0])
    if (!monto) continue
    const fecha = toF(row[3])
    if (!fecha) continue
    const desc        = String(row[1] || '').trim()
    const n_doc       = String(row[4] || '').trim() || ''  // empty string, nunca null
    const suc_banco   = String(row[5] || '').trim() || null
    const cargo_abono = String(row[7] || 'A').trim()

    result.push({
      fecha,
      monto,
      descripcion:    desc,
      n_documento:    n_doc,
      sucursal_banco: suc_banco,
      cargo_abono,
      tipo_auto:      clasificarDesc(desc),
      estado:         'pendiente',
      numero_cartola: nCartola,
      cuenta_bancaria: cuentaBancaria,
      archivo_origen: 'Cartola Santander',
    })
  }
  return result
}

// ── Importador ─────────────────────────────────────────────────────────────
function ImportadorCartola({ onImportado }) {
  const fileRef = useRef()
  const [dragOver, setDragOver]   = useState(false)
  const [loading, setLoading]     = useState(false)
  const [preview, setPreview]     = useState(null)
  const [resultado, setResultado] = useState(null)

  async function parsear(file) {
    if (!file) return
    setPreview(null); setResultado(null)
    try {
      const buf  = new Uint8Array(await file.arrayBuffer())
      const rows = parsearCartola(buf)
      const abonos = rows.filter(r => r.cargo_abono === 'A')
      console.log('[CartolaBancaria] Total filas parseadas:', rows.length, '| Abonos:', abonos.length)
      if (!abonos.length) { setResultado({ ok: false, msg: 'No se encontraron abonos.' }); return }
      setPreview({ rows: abonos, todos: rows, file: file.name })
    } catch (e) {
      console.error('[CartolaBancaria] Error parsear:', e)
      setResultado({ ok: false, msg: e instanceof Error ? e.message : String(e) })
    }
  }

  async function confirmar() {
    if (!preview) return
    setLoading(true); setResultado(null)
    try {
      let ins = 0, dup = 0
      for (let i = 0; i < preview.rows.length; i += 500) {
        const lote = preview.rows.slice(i, i+500)
        console.log('[CartolaBancaria] Insertando lote', i, '-', i+500, 'primer row:', lote[0])
        const { data, error } = await supabase.from('cartola_bancaria')
          .upsert(lote.map(r => ({ ...r, n_documento: r.n_documento ?? '' })),
            { onConflict: 'fecha,monto,n_documento,descripcion', ignoreDuplicates: true })
          .select('id')
        if (error) { console.error('[CartolaBancaria] Error upsert:', error); throw error }
        ins += (data||[]).length; dup += lote.length - (data||[]).length
      }
      setResultado({ ok: true, msg: `✓ ${ins} abonos importados · ${dup} duplicados ignorados` })
      setPreview(null)
      onImportado?.()
    } catch (e) {
      console.error('[CartolaBancaria] Error confirmar:', e)
      setResultado({ ok: false, msg: e instanceof Error ? e.message : String(e) })
    }
    finally { setLoading(false) }
  }

  // Resumen por tipo
  const resumen = useMemo(() => {
    if (!preview) return {}
    const m = {}
    for (const r of preview.rows) {
      if (!m[r.tipo_auto]) m[r.tipo_auto] = { n: 0, total: 0 }
      m[r.tipo_auto].n++; m[r.tipo_auto].total += r.monto
    }
    return m
  }, [preview])

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={cardSt}>
        <div style={{ fontSize:14, fontWeight:600, marginBottom:4 }}>Importar Cartola Bancaria Santander</div>
        <div style={{ fontSize:12, color:'#6B7280', marginBottom:12 }}>
          Descarga desde <strong>Banco Santander Empresas</strong> → Cuentas → Cartola histórica → Exportar Excel.
          Solo se importan los <strong>abonos</strong> (cargos se ignoran).
        </div>
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); parsear(e.dataTransfer.files[0]) }}
          onClick={() => fileRef.current?.click()}
          style={{ border:`2px dashed ${dragOver?'#0F766E':'#D1D5DB'}`, borderRadius:10,
            padding:'28px 20px', textAlign:'center', cursor:'pointer',
            background: dragOver?'#F0FDFA':'#FAFAFA', transition:'all 0.2s' }}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display:'none' }}
            onChange={e => { parsear(e.target.files?.[0]); e.target.value='' }} />
          {loading ? <Loader2 size={22} style={{ display:'inline-block', color:'#0F766E' }} />
            : <><Upload size={22} color="#9CA3AF" />
                <div style={{ marginTop:8, fontSize:13, color:'#6B7280' }}>Arrastra la cartola Santander o haz clic</div>
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
              <span style={{ fontWeight:600, fontSize:14 }}>{preview.rows.length} abonos encontrados</span>
              <span style={{ fontSize:11, color:'#6B7280', marginLeft:10 }}>{preview.file}</span>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => setPreview(null)} style={btnOutlineSt}>Cancelar</button>
              <button onClick={confirmar} disabled={loading} style={{ ...btnSt('#0F766E'), opacity:loading?0.6:1 }}>
                {loading && <Loader2 size={13} />} Importar {preview.rows.length} abonos
              </button>
            </div>
          </div>
          {/* Resumen por tipo */}
          <div style={{ padding:'12px 16px', borderBottom:'1px solid #F3F4F6', display:'flex', gap:10, flexWrap:'wrap' }}>
            {Object.entries(resumen).map(([tipo, v]) => {
              const t = TIPO_LABEL[tipo] ?? TIPO_LABEL.OTRO
              return (
                <div key={tipo} style={{ background:t.bg, borderRadius:8, padding:'6px 12px', fontSize:12 }}>
                  <span style={{ fontWeight:600, color:t.color }}>{t.label}</span>
                  <span style={{ color:'#6B7280', marginLeft:6 }}>{v.n} mov · {fmt(v.total)}</span>
                </div>
              )
            })}
          </div>
          {/* Preview tabla */}
          <div style={{ overflowX:'auto', maxHeight:300, overflowY:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead style={{ position:'sticky', top:0, background:'#F9FAFB' }}>
                <tr>
                  <th style={TH}>Fecha</th>
                  <th style={TH}>Tipo</th>
                  <th style={{ ...TH, textAlign:'right' }}>Monto</th>
                  <th style={TH}>Descripción</th>
                  <th style={TH}>N° Doc</th>
                  <th style={TH}>Suc. banco</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0,100).map((r,i) => {
                  const t = TIPO_LABEL[r.tipo_auto] ?? TIPO_LABEL.OTRO
                  return (
                    <tr key={i} style={{ borderTop:'1px solid #F3F4F6' }}>
                      <td style={TD}>{r.fecha}</td>
                      <td style={TD}>
                        <span style={{ fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:10, background:t.bg, color:t.color }}>{t.label}</span>
                      </td>
                      <td style={{ ...TD, textAlign:'right', fontWeight:600 }}>{fmt(r.monto)}</td>
                      <td style={{ ...TD, maxWidth:250 }}>
                        <span style={{ display:'block', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={r.descripcion}>
                          {r.descripcion}
                        </span>
                      </td>
                      <td style={{ ...TD, fontSize:11, color:'#9CA3AF' }}>{r.n_documento ?? '—'}</td>
                      <td style={{ ...TD, fontSize:11 }}>{r.sucursal_banco ?? '—'}</td>
                    </tr>
                  )
                })}
                {preview.rows.length > 100 && (
                  <tr><td colSpan={6} style={{ ...TD, textAlign:'center', color:'#9CA3AF' }}>
                    ... y {preview.rows.length-100} abonos más
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

// ── Modal editar clasificación ─────────────────────────────────────────────
// ── Motor de matching ─────────────────────────────────────────────────────

// Extrae fecha_abono desde descripción cartola
// "Abono Ventas GETNET 29/01/26 CIERR" → fecha_venta=29/01 → fecha_abono=30/01 (D+1)
function extraerFechaDesdeDesc(desc) {
  const m = desc.match(/(\d{2})\/(\d{2})\/(\d{2})\b/)
  if (!m) return null
  const d = new Date(`20${m[3]}-${m[2]}-${m[1]}`)
  d.setDate(d.getDate() + 1)  // Getnet abona al día siguiente de la venta
  return d.toISOString().slice(0, 10)
}

function extraerRutDesdeDesc(desc) {
  const m = desc.match(/^(\d{7,9}[0-9Kk])\s/)
  if (!m) return null
  const raw = m[1]
  const dv  = raw.slice(-1).toUpperCase()
  const num = raw.slice(0, -1).replace(/^0+/, '')
  return `${num}-${dv}`
}

function scoreMatch(cartola, candidato) {
  let score = 0
  const diff = Math.abs(Number(cartola.monto) - Number(candidato.monto))
  if (diff <= 5)                                     score += 50
  else if (diff <= Number(cartola.monto) * 0.05)     score += 25
  const rutCartola = extraerRutDesdeDesc(cartola.descripcion)
  if (rutCartola && candidato.rut && candidato.rut.replace(/[.\s]/g,'').toUpperCase().includes(rutCartola.toUpperCase())) score += 40
  const nc = (cartola.descripcion || '').toUpperCase()
  const nn = (candidato.nombre || '').toUpperCase().split(' ')[0]
  if (nn.length > 3 && nc.includes(nn)) score += 25
  const dc = new Date(cartola.fecha)
  const dd = new Date(candidato.fecha)
  const diasDiff = Math.round((dd - dc) / 86400000)
  if (diasDiff >= 0 && diasDiff < 7)        score += 25
  else if (diasDiff >= 0 && diasDiff < 30)  score += 20
  else if (diasDiff >= -3)                  score += 5
  const med = (candidato.medio || '').toUpperCase()
  if (med.includes('TRANSF')) score += 20
  return Math.min(score, 100)
}

async function buscarCandidatos(cartola, busquedaManual = null) {
  const tipo  = cartola.tipo_confirmado ?? cartola.tipo_auto
  const fecha = cartola.fecha

  // Para Getnet: extraer fecha exacta desde descripción ("GETNET 29/01/26")
  const fechaGetnet = extraerFechaDesdeDesc(cartola.descripcion)

  // Rango por defecto según tipo
  const rangosDias = {
    getnet:                { ant: 2, post: 2 },   // Getnet deposita al día siguiente
    GETNET:                { ant: 2, post: 2 },
    webpay:                { ant: 2, post: 2 },
    WEBPAY:                { ant: 2, post: 2 },
    deposito_efectivo:     { ant: 3, post: 3 },
    DEPOSITO:              { ant: 3, post: 3 },
    transferencia_cliente: { ant: 5, post: 45 },  // Transferencias: desfase amplio
    TRANSFERENCIA:         { ant: 5, post: 45 },
  }
  const rango = rangosDias[tipo] ?? { ant: 5, post: 30 }

  // Si hay búsqueda manual (texto), usar fecha que ingresó el usuario
  let desdeStr, hastaStr
  if (busquedaManual?.fecha) {
    desdeStr = hastaStr = busquedaManual.fecha
  } else if (fechaGetnet && (tipo === 'GETNET' || tipo === 'getnet')) {
    // Usar fecha exacta extraída de la descripción ±1 día
    const d = new Date(fechaGetnet)
    const desde = new Date(d); desde.setDate(d.getDate() - 1)
    const hasta = new Date(d); hasta.setDate(d.getDate() + 1)
    desdeStr = desde.toISOString().slice(0,10)
    hastaStr = hasta.toISOString().slice(0,10)
  } else {
    const desde = new Date(fecha); desde.setDate(desde.getDate() - rango.ant)
    const hasta = new Date(fecha); hasta.setDate(hasta.getDate() + rango.post)
    desdeStr = desde.toISOString().slice(0,10)
    hastaStr = hasta.toISOString().slice(0,10)
  }

  const candidatos = []

  if (tipo === 'GETNET' || tipo === 'getnet') {
    let q = supabase.from('v_getnet_abonos_consolidado')
      .select('num_abono_ref, fecha_abono, valor_total, num_abonos, locales, total_ventas')
      .gte('fecha_abono', desdeStr).lte('fecha_abono', hastaStr)
    if (busquedaManual?.monto) q = q.eq('valor_total', busquedaManual.monto)
    const { data } = await q
    for (const r of data ?? []) {
      const s = scoreMatch(cartola, { monto: r.valor_total, fecha: r.fecha_abono, nombre: '', rut: '', medio: 'getnet' })
      candidatos.push({ id: r.num_abono_ref, _tabla: 'getnet_abonos', _score: s,
        _label: `Abono Getnet ${r.fecha_abono} · ${r.locales}`,
        _monto: r.valor_total, _fecha: r.fecha_abono,
        _cols: [
          { l: 'Fecha abono', v: r.fecha_abono },
          { l: 'Num. abonos', v: r.num_abonos },
          { l: 'Locales',     v: r.locales },
          { l: 'N° ventas',   v: r.total_ventas },
          { l: 'Monto total', v: fmt(r.valor_total), bold: true },
        ]
      })
    }
  }

  if (tipo === 'WEBPAY' || tipo === 'webpay') {
    const { data } = await supabase.from('v_webpay_abonos_consolidado')
      .select('fecha_abono, valor_total, n_transacciones, tipos_tarjeta, n_debito, n_credito')
      .gte('fecha_abono', desdeStr).lte('fecha_abono', hastaStr)
    for (const r of data ?? []) {
      const s = scoreMatch(cartola, { monto: r.valor_total, fecha: r.fecha_abono, nombre: '', rut: '', medio: 'webpay' })
      candidatos.push({ id: r.fecha_abono, _tabla: 'webpay_transacciones', _score: s,
        _label: `Abono Webpay ${r.fecha_abono}`,
        _monto: r.valor_total, _fecha: r.fecha_abono,
        _cols: [
          { l: 'Fecha abono',  v: r.fecha_abono },
          { l: 'N° transacc.', v: r.n_transacciones },
          { l: 'Tarjetas',     v: r.tipos_tarjeta },
          { l: 'Monto total',  v: fmt(r.valor_total), bold: true },
        ]
      })
    }
  }

  if (tipo === 'DEPOSITO' || tipo === 'deposito_efectivo') {
    const { data } = await supabase.from('depositos_efectivo')
      .select('id, fecha_deposito, monto_depositado, sucursal_id')
      .gte('fecha_deposito', desdeStr).lte('fecha_deposito', hastaStr)
    for (const r of data ?? []) {
      const s = scoreMatch(cartola, { monto: r.monto_depositado, fecha: r.fecha_deposito, nombre: '', rut: '', medio: 'efectivo' })
      candidatos.push({ ...r, _tabla: 'depositos_efectivo', _score: s,
        _label: `Depósito ${r.fecha_deposito} · ${r.sucursal_id}`,
        _monto: r.monto_depositado, _fecha: r.fecha_deposito })
    }
  }

  if (tipo === 'TRANSFERENCIA' || tipo === 'transferencia_cliente') {
    const { data } = await supabase.from('abonos_transferencia')
      .select('id, fecha, sucursal_id, monto, bsale_doc_numero, tipo_documento, vendedor_nombre, estado')
      .gte('fecha', desdeStr).lte('fecha', hastaStr)
      .neq('estado', 'conciliado')
    for (const r of data ?? []) {
      const s = scoreMatch(cartola, { monto: r.monto, fecha: r.fecha, nombre: r.vendedor_nombre ?? '', rut: '', medio: 'transferencia' })
      candidatos.push({ ...r, _tabla: 'abonos_transferencia', _score: s,
        _label: `${r.tipo_documento} N°${r.bsale_doc_numero} · ${r.vendedor_nombre ?? ''} · ${r.fecha}`,
        _monto: r.monto, _fecha: r.fecha,
        _cols: [
          { l: 'Fecha',      v: r.fecha },
          { l: 'Documento',  v: `${r.tipo_documento} N°${r.bsale_doc_numero}` },
          { l: 'Vendedor',   v: r.vendedor_nombre ?? '—' },
          { l: 'Sucursal',   v: r.sucursal_id },
          { l: 'Monto',      v: fmt(r.monto), bold: true },
        ]
      })
    }
  }

  return candidatos
    .filter(c => busquedaManual ? true : c._score >= 30)
    .sort((a,b) => b._score - a._score)
    .slice(0, 10)
}

// ── Fetch registros del mes por tipo ──────────────────────────────────────
function Estrellas({ score }) {
  const stars = score >= 80 ? 3 : score >= 50 ? 2 : 1
  return <span style={{ color:'#F59E0B', fontSize:13 }}>{'★'.repeat(stars)}{'☆'.repeat(3-stars)}</span>
}
async function fetchRegistrosMes(tipo, desde, hasta, filtroTexto) {
  const ft = (filtroTexto || '').trim().toLowerCase()

  if (tipo === 'getnet') {
    const { data } = await supabase.from('v_getnet_abonos_consolidado')
      .select('num_abono_ref, num_abonos, fecha_abono, locales, valor_total, total_ventas, n_registros')
      .gte('fecha_abono', desde).lte('fecha_abono', hasta)
      .order('fecha_abono', { ascending: false }).limit(200)
    return (data ?? [])
      .filter(r => !ft ||
        String(r.num_abonos||'').includes(ft) ||
        String(r.valor_total||'').includes(ft) ||
        (r.locales||'').toLowerCase().includes(ft))
      .map(r => ({
        id: r.num_abono_ref, _tabla: 'getnet_abonos', _monto: r.valor_total, _fecha: r.fecha_abono,
        _label: `Abono Getnet ${r.fecha_abono}`,
        _cols: [
          { l: 'Fecha abono',  v: r.fecha_abono },
          { l: 'Num. abonos',  v: r.num_abonos },
          { l: 'Locales',      v: r.locales },
          { l: 'N° ventas',    v: r.total_ventas },
          { l: 'Registros',    v: `${r.n_registros} abonos` },
          { l: 'Monto total',  v: fmt(r.valor_total), bold: true },
        ]
      }))
  }

  if (tipo === 'webpay') {
    const { data } = await supabase.from('v_webpay_abonos_consolidado')
      .select('fecha_abono, n_transacciones, valor_total, valor_debito, n_debito, n_credito, tipos_tarjeta')
      .gte('fecha_abono', desde).lte('fecha_abono', hasta)
      .order('fecha_abono', { ascending: false }).limit(200)
    return (data ?? [])
      .filter(r => !ft ||
        String(r.valor_total||'').includes(ft) ||
        (r.tipos_tarjeta||'').toLowerCase().includes(ft))
      .map(r => ({
        id: r.fecha_abono, _tabla: 'webpay_transacciones', _monto: r.valor_total, _fecha: r.fecha_abono,
        _label: `Abono Webpay ${r.fecha_abono}`,
        _cols: [
          { l: 'Fecha abono',    v: r.fecha_abono },
          { l: 'N° transacc.',   v: r.n_transacciones },
          { l: 'Tarjetas',       v: r.tipos_tarjeta },
          { l: 'N° débito',      v: r.n_debito },
          { l: 'N° crédito',     v: r.n_credito },
          { l: 'Monto total',    v: fmt(r.valor_total), bold: true },
        ]
      }))
  }

  if (tipo === 'deposito_efectivo') {
    const { data } = await supabase.from('depositos_efectivo')
      .select('id, fecha, fecha_deposito, sucursal_id, monto_depositado, total_no_depositado, estado, observaciones, comprobante_nombre')
      .gte('fecha', desde).lte('fecha', hasta)
      .order('fecha', { ascending: false }).limit(200)
    return (data ?? [])
      .filter(r => !ft || String(r.monto_depositado||'').includes(ft) || (r.sucursal_id||'').toLowerCase().includes(ft) || (r.observaciones||'').toLowerCase().includes(ft) || (r.estado||'').toLowerCase().includes(ft))
      .map(r => ({ id: r.id, _tabla: 'depositos_efectivo', _monto: r.monto_depositado, _fecha: r.fecha,
        _label: `Depósito ${r.fecha}`,
        _cols: [
          { l: 'Fecha cierre',    v: r.fecha },
          { l: 'Fecha depósito',  v: r.fecha_deposito ?? '—' },
          { l: 'Sucursal',        v: r.sucursal_id },
          { l: 'Estado',          v: r.estado },
          { l: 'Sin depositar',   v: r.total_no_depositado > 0 ? fmt(r.total_no_depositado) : '$0' },
          { l: 'Comprobante',     v: r.comprobante_nombre ?? '—' },
          { l: 'Observación',     v: r.observaciones ? r.observaciones.slice(0, 40) : '—' },
          { l: 'Monto',           v: fmt(r.monto_depositado), bold: true },
        ]
      }))
  }

  if (tipo === 'transferencia_cliente') {
    const { data } = await supabase.from('abonos_transferencia')
      .select('id, fecha, sucursal_id, monto, bsale_doc_numero, tipo_documento, vendedor_nombre, estado')
      .gte('fecha', desde).lte('fecha', hasta)
      .neq('estado', 'conciliado')
      .order('fecha', { ascending: false }).limit(200)
    return (data ?? [])
      .filter(r => !ft ||
        String(r.monto||'').includes(ft) ||
        (r.vendedor_nombre||'').toLowerCase().includes(ft) ||
        (r.bsale_doc_numero||'').includes(ft))
      .map(r => ({ id: r.id, _tabla: 'abonos_transferencia', _monto: r.monto, _fecha: r.fecha,
        _label: `${r.tipo_documento} N°${r.bsale_doc_numero} · ${r.vendedor_nombre ?? ''}`,
        _cols: [
          { l: 'Fecha',      v: r.fecha },
          { l: 'Documento',  v: `${r.tipo_documento} N°${r.bsale_doc_numero}` },
          { l: 'Vendedor',   v: r.vendedor_nombre ?? '—' },
          { l: 'Sucursal',   v: r.sucursal_id },
          { l: 'Monto',      v: fmt(r.monto), bold: true },
        ]
      }))
  }

  return []
}


// Mapeo tipo_confirmado → tipo para fetch
const TIPO_A_FETCH = {
  getnet: 'getnet', GETNET: 'getnet',
  webpay: 'webpay', WEBPAY: 'webpay',
  deposito_efectivo: 'deposito_efectivo', DEPOSITO: 'deposito_efectivo',
  transferencia_cliente: 'transferencia_cliente', TRANSFERENCIA: 'transferencia_cliente',
}

const TIPO_TABS = [
  { k:'getnet',               l:'Getnet',       color:'#1E40AF' },
  { k:'webpay',               l:'Webpay/TB',    color:'#4F46E5' },
  { k:'deposito_efectivo',    l:'Efectivo',     color:'#16A34A' },
  { k:'transferencia_cliente',l:'Transferencia',color:'#D97706' },
  { k:'prestamo_socio',       l:'Préstamo/Reimb',color:'#7C3AED' },
]

// ── Modal Conciliar ────────────────────────────────────────────────────────
function ModalConciliar({ movimiento, conciliacionExistente, desde, hasta, onClose, onSaved }) {
  const tipoInicial = movimiento.tipo_confirmado
    ?? TIPO_A_FETCH[movimiento.tipo_auto]
    ?? movimiento.tipo_auto.toLowerCase()

  const [tipo, setTipo]           = useState(tipoInicial)
  const [obs, setObs]             = useState(movimiento.observaciones ?? '')
  const [estado, setEstado]       = useState(movimiento.estado ?? 'pendiente')
  const [registros, setRegistros] = useState([])
  const [seleccion, setSeleccion] = useState(null)
  const [cargando, setCargando]   = useState(false)
  const [filtroTexto, setFiltroTexto] = useState('')
  const [saving, setSaving]       = useState(false)

  const esLibre      = ['prestamo_socio','reembolso','otro'].includes(tipo)
  const fechaGetnet  = extraerFechaDesdeDesc(movimiento.descripcion)
  const scores       = useMemo(() => {
    const m = {}
    for (const r of registros) {
      m[r.id] = scoreMatch(movimiento, { monto: r._monto, fecha: r._fecha, nombre:'', rut:'', medio: tipo })
    }
    return m
  }, [registros, movimiento, tipo])

  useEffect(() => {
    if (esLibre || estado !== 'conciliado') { setRegistros([]); return }
    setCargando(true); setRegistros([]); setSeleccion(null)

    // Para Getnet: si hay fecha en descripción, ajustar rango al mes de esa fecha
    let desdeEfectivo = desde
    let hastaEfectivo = hasta
    if (tipo === 'getnet' && fechaGetnet) {
      // Mes de la fecha Getnet
      const d = new Date(fechaGetnet)
      desdeEfectivo = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`
      const fin = new Date(d.getFullYear(), d.getMonth()+1, 0)
      hastaEfectivo = fin.toISOString().slice(0,10)
    }

    fetchRegistrosMes(tipo, desdeEfectivo, hastaEfectivo, filtroTexto)
      .then(setRegistros)
      .catch(e => console.error(e))
      .finally(() => setCargando(false))
  }, [tipo, estado, filtroTexto])

  async function desvincular() {
    if (!window.confirm('¿Desvincular esta conciliación?')) return
    setSaving(true)
    try {
      await supabase.from('cartola_conciliacion').delete().eq('cartola_id', movimiento.id)
      await supabase.from('cartola_bancaria')
        .update({ estado: 'pendiente', tipo_confirmado: null, observaciones: null }).eq('id', movimiento.id)
      toast.success('Desvinculado')
      onSaved()
    } catch(e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  async function guardar() {
    setSaving(true)
    try {
      await supabase.from('cartola_bancaria')
        .update({ tipo_confirmado: tipo, observaciones: obs||null, estado }).eq('id', movimiento.id)

      if (estado === 'conciliado') {
        await supabase.from('cartola_conciliacion').delete().eq('cartola_id', movimiento.id)
        if (seleccion) {
          await supabase.from('cartola_conciliacion').insert({
            cartola_id: movimiento.id, tabla_origen: seleccion._tabla,
            registro_id: String(seleccion.id), monto_aplicado: movimiento.monto,
            score: scores[seleccion.id] ?? 0, metodo_match: 'manual', observaciones: obs||null,
          })
        } else if (esLibre) {
          await supabase.from('cartola_conciliacion').insert({
            cartola_id: movimiento.id, tabla_origen: 'libre', registro_id: 'libre',
            monto_aplicado: movimiento.monto, metodo_match: 'libre', descripcion_libre: obs||tipo,
          })
        }
      }
      toast.success('Guardado')
      onSaved()
    } catch(e) { toast.error(e.message ?? 'Error') }
    finally { setSaving(false) }
  }

  // Ordenar registros: primero los de score alto, luego el resto
  const registrosOrdenados = useMemo(() => {
    return [...registros].sort((a,b) => (scores[b.id]??0) - (scores[a.id]??0))
  }, [registros, scores])

  return (
    <div style={{ position:'fixed', inset:0, zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,0.55)' }}
      onClick={e => { if (e.target===e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:14, padding:0, maxWidth:660, width:'100%', maxHeight:'92vh', display:'flex', flexDirection:'column', boxShadow:'0 16px 48px rgba(0,0,0,0.25)' }}>

        {/* Header */}
        <div style={{ padding:'18px 24px 12px', borderBottom:'1px solid #F3F4F6' }}>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:6 }}>Conciliar movimiento</div>
          <div style={{ fontSize:12, color:'#6B7280', padding:'8px 12px', background:'#F9FAFB', borderRadius:8, display:'flex', gap:12, flexWrap:'wrap' }}>
            <span style={{ fontWeight:600 }}>{movimiento.fecha}</span>
            <span style={{ fontWeight:700, color:'#0F766E' }}>{fmt(movimiento.monto)}</span>
            <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:320 }}>{movimiento.descripcion}</span>
            {fechaGetnet && <span style={{ color:'#4F46E5', fontWeight:600 }}>→ abono {fechaGetnet}</span>}
          </div>

          {/* Conciliación existente */}
          {conciliacionExistente && (
            <div style={{ marginTop:8, padding:'8px 12px', background:'#DCFCE7', borderRadius:8, fontSize:12, color:'#166534',
              display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span>✓ Vinculado con <strong>{conciliacionExistente.tabla_origen}</strong> · {conciliacionExistente.registro_id.slice(0,8)}...</span>
              <button onClick={desvincular} disabled={saving}
                style={{ fontSize:11, color:'#DC2626', background:'none', border:'1px solid #FCA5A5', borderRadius:5, padding:'2px 8px', cursor:'pointer', fontWeight:600 }}>
                Desvincular
              </button>
            </div>
          )}
        </div>

        {/* Controles tipo + estado */}
        <div style={{ padding:'12px 24px', borderBottom:'1px solid #F3F4F6', display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div>
            <label style={labelSt}>Tipo</label>
            <select style={selectSt} value={tipo} onChange={e => { setTipo(e.target.value); setSeleccion(null); setFiltroTexto('') }}>
              {TIPO_CONFIRMADO_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
          <div>
            <label style={labelSt}>Estado</label>
            <select style={selectSt} value={estado} onChange={e => { setEstado(e.target.value); setSeleccion(null) }}>
              <option value="pendiente">Pendiente</option>
              <option value="conciliado">Conciliado</option>
              <option value="ignorado">Ignorado</option>
            </select>
          </div>
        </div>

        {/* Cuerpo — listado registros */}
        {estado === 'conciliado' && !esLibre ? (
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            {/* Buscador */}
            <div style={{ padding:'10px 24px', borderBottom:'1px solid #F3F4F6', display:'flex', gap:8, alignItems:'center' }}>
              <input style={{ ...inputSt, flex:1 }} placeholder="Filtrar por monto, fecha, sucursal..."
                value={filtroTexto} onChange={e => setFiltroTexto(e.target.value)} />
              {cargando && <Loader2 size={16} style={{ display:'inline-block', color:'#9CA3AF' }} />}
              <span style={{ fontSize:11, color:'#9CA3AF', whiteSpace:'nowrap' }}>{registrosOrdenados.length} registros</span>
            </div>

            {/* Lista */}
            <div style={{ flex:1, overflowY:'auto', padding:'8px 24px', display:'flex', flexDirection:'column', gap:5 }}>
              {cargando ? (
                <div style={{ textAlign:'center', padding:24, color:'#9CA3AF', fontSize:12 }}>Cargando...</div>
              ) : registrosOrdenados.length === 0 ? (
                <div style={{ padding:'16px', background:'#FEF3C7', borderRadius:8, fontSize:12, color:'#92400E', textAlign:'center' }}>
                  Sin registros para este período. Verifica que importaste los datos del mes correspondiente.
                </div>
              ) : (
                registrosOrdenados.map((r, i) => {
                  const sc      = scores[r.id] ?? 0
                  const sel     = seleccion?.id === r.id
                  const diffM   = Math.abs(r._monto - movimiento.monto)
                  const esMatch = sc >= 50
                  return (
                    <div key={r.id} onClick={() => setSeleccion(sel ? null : r)}
                      style={{ padding:'12px 14px', borderRadius:8, cursor:'pointer',
                        border:`2px solid ${sel ? '#0F766E' : esMatch ? '#BBF7D0' : '#F3F4F6'}`,
                        background: sel ? '#F0FDFA' : esMatch ? '#F0FDF4' : '#FAFAFA',
                        transition:'all 0.1s' }}>
                      {/* Header tarjeta */}
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                        <div style={{ fontSize:12, fontWeight:700, color:'#111827' }}>{r._label}</div>
                        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
                          {diffM > 5 && <span style={{ fontSize:10, color:'#DC2626', fontWeight:600 }}>Δ {fmt(diffM)}</span>}
                          {sc > 0 && <><Estrellas score={sc} /><span style={{ fontSize:10, color:'#6B7280' }}>{sc}pts</span></>}
                          {sel && <Check size={15} color="#0F766E" />}
                        </div>
                      </div>
                      {/* Grid de columnas */}
                      {r._cols && (
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(120px,1fr))', gap:'4px 12px' }}>
                          {r._cols.map((col, ci) => (
                            <div key={ci}>
                              <div style={{ fontSize:9, color:'#9CA3AF', textTransform:'uppercase', letterSpacing:'0.5px' }}>{col.l}</div>
                              <div style={{ fontSize:11, fontWeight: col.bold ? 700 : 500, color: col.bold ? '#0F766E' : '#374151', marginTop:1 }}>
                                {col.v ?? '—'}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        ) : estado === 'conciliado' && esLibre ? (
          <div style={{ padding:'12px 24px' }}>
            <div style={{ padding:'10px 12px', background:'#EFF6FF', borderRadius:8, fontSize:12, color:'#1E40AF' }}>
              Este tipo se concilia sin vinculación. Agrega una observación descriptiva.
            </div>
          </div>
        ) : null}

        {/* Observación + footer */}
        <div style={{ padding:'12px 24px 18px', borderTop:'1px solid #F3F4F6' }}>
          <div style={{ marginBottom:12 }}>
            <label style={labelSt}>Observación</label>
            <input style={inputSt} value={obs} onChange={e => setObs(e.target.value)}
              placeholder={esLibre ? 'Ej: Préstamo JP Reyes Feb 2026...' : 'Notas adicionales...'} />
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ fontSize:11, color:'#9CA3AF' }}>
              {estado==='conciliado' && !esLibre && !seleccion && registrosOrdenados.length > 0 && '⚠ Sin selección — se concilia sin vinculación'}
              {seleccion && <span style={{ color:'#0F766E', fontWeight:600 }}>✓ Seleccionado: {seleccion._label} · {fmt(seleccion._monto)}</span>}
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={onClose} style={btnOutlineSt}>Cancelar</button>
              <button onClick={guardar} disabled={saving} style={{ ...btnSt('#0F766E'), opacity:saving?0.6:1 }}>
                {saving && <Loader2 size={13} />} Guardar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Componente principal ───────────────────────────────────────────────────
export function CartolaBancariaTab({ usuario }) {
  const now = new Date()
  const [anio, setAnio]   = useState(now.getFullYear())
  const [mes, setMes]     = useState(now.getMonth() + 1)
  const [filtroTipo, setFiltroTipo] = useState('TODOS')
  const [filtroEstado, setFiltroEstado] = useState('TODOS')
  const [vista, setVista]  = useState('movimientos') // movimientos | importar
  const [datos, setDatos]  = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal]  = useState(null)

  const { desde, hasta } = rangoMes(anio, mes)
  const anios = [now.getFullYear()-1, now.getFullYear(), now.getFullYear()+1]

  const [conciliaciones, setConciliaciones] = useState({}) // cartola_id → conciliacion

  const cargar = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('cartola_bancaria')
        .select('*')
        .gte('fecha', desde).lte('fecha', hasta)
        .eq('cargo_abono', 'A')
        .order('fecha', { ascending: false })
        .limit(1000)
      if (error) { console.error('[CartolaBancaria] Error cargar:', error); throw error }
      console.log('[CartolaBancaria] Datos cargados:', data?.length)
      setDatos(data ?? [])

      // Cargar conciliaciones para los registros cargados
      if (data?.length) {
        const ids = data.map(r => r.id)
        const { data: conc } = await supabase.from('cartola_conciliacion')
          .select('*').in('cartola_id', ids)
        const map = {}
        for (const c of conc ?? []) map[c.cartola_id] = c
        setConciliaciones(map)
      }
    } catch (e) { toast.error('Error al cargar: ' + (e.message ?? e)) }
    finally { setLoading(false) }
  }

  useEffect(() => { cargar() }, [desde, hasta])

  // Filtros
  const datosFiltrados = useMemo(() => {
    return datos.filter(r => {
      if (filtroTipo !== 'TODOS' && r.tipo_auto !== filtroTipo) return false
      if (filtroEstado !== 'TODOS' && r.estado !== filtroEstado) return false
      return true
    })
  }, [datos, filtroTipo, filtroEstado])

  // KPIs
  const kpis = useMemo(() => {
    const total      = datos.reduce((s,r) => s + Number(r.monto ?? 0), 0)
    const conciliado = datos.filter(r => r.estado === 'conciliado').reduce((s,r) => s + Number(r.monto ?? 0), 0)
    const pendiente  = datos.filter(r => r.estado === 'pendiente').reduce((s,r) => s + Number(r.monto ?? 0), 0)
    const n_pend     = datos.filter(r => r.estado === 'pendiente').length
    const resumen    = {}
    for (const r of datos) {
      if (!resumen[r.tipo_auto]) resumen[r.tipo_auto] = 0
      resumen[r.tipo_auto] += Number(r.monto ?? 0)
    }
    return { total, conciliado, pendiente, n_pend, resumen }
  }, [datos])

  const esAdmin = ['admin','contabilidad','jefe_admin_finanzas','gerente_admin_finanzas','admin_sistema'].includes(usuario.rol)

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      {/* Tabs principales */}
      <div style={{ display:'flex', gap:0, borderBottom:'2px solid #E5E7EB' }}>
        {[['movimientos','📋 Movimientos'],['importar','📤 Importar']].map(([k,l]) => (
          <button key={k} onClick={() => setVista(k)} style={{
            padding:'10px 18px', fontSize:13, fontWeight:700, background:'none', border:'none',
            cursor:'pointer', color: vista===k?'#0F766E':'#6B7280',
            borderBottom:`3px solid ${vista===k?'#0F766E':'transparent'}`, marginBottom:-2,
          }}>{l}</button>
        ))}
      </div>

      {vista === 'importar' && (
        <ImportadorCartola onImportado={() => { setVista('movimientos'); cargar() }} />
      )}

      {vista === 'movimientos' && (
        <>
          {/* Filtros */}
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
                <label style={labelSt}>Tipo</label>
                <select style={selectSt} value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
                  <option value="TODOS">Todos</option>
                  {Object.entries(TIPO_LABEL).map(([k,v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelSt}>Estado</label>
                <select style={selectSt} value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
                  <option value="TODOS">Todos</option>
                  <option value="pendiente">Pendiente</option>
                  <option value="conciliado">Conciliado</option>
                  <option value="ignorado">Ignorado</option>
                </select>
              </div>
            </div>
          </div>

          {/* KPIs */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:10 }}>
            <div style={{ ...cardSt, padding:'10px 14px' }}>
              <div style={{ fontSize:10, color:'#9CA3AF', textTransform:'uppercase' }}>Total abonos</div>
              <div style={{ fontSize:17, fontWeight:700, color:'#0F766E' }}>{fmt(kpis.total)}</div>
              <div style={{ fontSize:11, color:'#6B7280' }}>{datos.length} movimientos</div>
            </div>
            <div style={{ ...cardSt, padding:'10px 14px' }}>
              <div style={{ fontSize:10, color:'#9CA3AF', textTransform:'uppercase' }}>Conciliado</div>
              <div style={{ fontSize:17, fontWeight:700, color:'#16A34A' }}>{fmt(kpis.conciliado)}</div>
            </div>
            <div style={{ ...cardSt, padding:'10px 14px', border: kpis.n_pend > 0 ? '1px solid #FDE68A' : '1px solid #F3F4F6' }}>
              <div style={{ fontSize:10, color:'#9CA3AF', textTransform:'uppercase' }}>Pendiente clasificar</div>
              <div style={{ fontSize:17, fontWeight:700, color: kpis.n_pend > 0 ? '#D97706' : '#16A34A' }}>{fmt(kpis.pendiente)}</div>
              <div style={{ fontSize:11, color:'#6B7280' }}>{kpis.n_pend} mov.</div>
            </div>
            {/* Por tipo */}
            {Object.entries(kpis.resumen).map(([tipo, total]) => {
              const t = TIPO_LABEL[tipo] ?? TIPO_LABEL.OTRO
              return (
                <div key={tipo} style={{ ...cardSt, padding:'10px 14px' }}>
                  <div style={{ fontSize:10, textTransform:'uppercase', color: t.color }}>{t.label}</div>
                  <div style={{ fontSize:15, fontWeight:700, color:'#111827' }}>{fmt(total)}</div>
                </div>
              )
            })}
          </div>

          {/* Tabla movimientos */}
          {loading ? (
            <div style={{ textAlign:'center', padding:32 }}><Loader2 size={20} style={{ display:'inline-block', color:'#9CA3AF' }} /></div>
          ) : (
            <div style={{ ...cardSt, padding:0, overflow:'hidden' }}>
              <div style={{ padding:'12px 16px', borderBottom:'1px solid #F3F4F6', display:'flex', justifyContent:'space-between' }}>
                <span style={{ fontSize:13, fontWeight:600 }}>
                  {datosFiltrados.length} movimientos · {fmt(datosFiltrados.reduce((s,r)=>s+Number(r.monto??0),0))}
                </span>
              </div>
              {!datosFiltrados.length ? (
                <div style={{ padding:'32px', textAlign:'center', color:'#9CA3AF', fontSize:13 }}>
                  {datos.length === 0 ? 'No hay datos para este período. Importa una cartola.' : 'No hay movimientos con los filtros seleccionados.'}
                </div>
              ) : (
                <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                    <thead style={{ background:'#F9FAFB' }}>
                      <tr>
                        <th style={TH}>Fecha</th>
                        <th style={TH}>Tipo</th>
                        <th style={{ ...TH, textAlign:'right' }}>Monto</th>
                        <th style={TH}>Descripción</th>
                        <th style={TH}>N° Doc</th>
                        <th style={TH}>Suc. banco</th>
                        <th style={TH}>Estado</th>
                        {esAdmin && <th style={{ ...TH, textAlign:'center' }}>Acción</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {datosFiltrados.map((r, i) => {
                        const t       = TIPO_LABEL[r.tipo_auto] ?? TIPO_LABEL.OTRO
                        const esPend  = r.estado === 'pendiente'
                        const esConc  = r.estado === 'conciliado'
                        const tipoConf = TIPO_CONFIRMADO_OPTS.find(o => o.v === r.tipo_confirmado)
                        return (
                          <tr key={r.id} style={{ borderTop:'1px solid #F3F4F6',
                            background: esPend && r.tipo_auto === 'OTRO' ? '#FFFBEB' : 'transparent' }}
                            onMouseEnter={e => e.currentTarget.style.background='#F9FAFB'}
                            onMouseLeave={e => e.currentTarget.style.background = esPend && r.tipo_auto==='OTRO' ? '#FFFBEB' : 'transparent'}>
                            <td style={TD}>{r.fecha}</td>
                            <td style={TD}>
                              <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                                <span style={{ fontSize:10, fontWeight:600, padding:'1px 7px', borderRadius:10, background:t.bg, color:t.color, width:'fit-content' }}>{t.label}</span>
                                {tipoConf && <span style={{ fontSize:10, color:'#6B7280' }}>{tipoConf.l}</span>}
                              </div>
                            </td>
                            <td style={{ ...TD, textAlign:'right', fontWeight:700 }}>{fmt(r.monto)}</td>
                            <td style={{ ...TD, maxWidth:240 }}>
                              <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={r.descripcion}>
                                {r.descripcion}
                              </div>
                              {r.observaciones && (
                                <div style={{ fontSize:11, color:'#6B7280', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                  {r.observaciones}
                                </div>
                              )}
                            </td>
                            <td style={{ ...TD, fontSize:11, color:'#9CA3AF' }}>{r.n_documento ?? '—'}</td>
                            <td style={{ ...TD, fontSize:11 }}>{r.sucursal_banco ?? '—'}</td>
                            <td style={TD}>
                              <span style={{ fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:10,
                                background: esConc?'#DCFCE7': esPend?'#FEF3C7':'#F3F4F6',
                                color:      esConc?'#166534': esPend?'#92400E':'#6B7280' }}>
                                {r.estado === 'conciliado' ? 'Conciliado' : r.estado === 'ignorado' ? 'Ignorado' : 'Pendiente'}
                              </span>
                            </td>
                            {esAdmin && (
                              <td style={{ ...TD, textAlign:'center' }}>
                                <button onClick={() => setModal(r)}
                                  style={{ fontSize:11, color:'#0F766E', background:'none', border:'none', cursor:'pointer', fontWeight:600 }}>
                                  {r.estado === 'conciliado' ? 'Ver conciliación' : 'Conciliar'}
                                </button>
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {modal && (
        <ModalConciliar
          movimiento={modal}
          conciliacionExistente={conciliaciones[modal.id] ?? null}
          desde={desde}
          hasta={hasta}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); cargar() }}
        />
      )}
    </div>
  )
}
