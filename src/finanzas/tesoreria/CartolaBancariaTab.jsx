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
function ModalClasificar({ movimiento, onClose, onSaved }) {
  const [tipo, setTipo]   = useState(movimiento.tipo_confirmado ?? movimiento.tipo_auto.toLowerCase())
  const [obs, setObs]     = useState(movimiento.observaciones ?? '')
  const [estado, setEstado] = useState(movimiento.estado ?? 'pendiente')
  const [saving, setSaving] = useState(false)

  async function guardar() {
    setSaving(true)
    try {
      const { error } = await supabase.from('cartola_bancaria')
        .update({ tipo_confirmado: tipo, observaciones: obs || null, estado })
        .eq('id', movimiento.id)
      if (error) throw error
      toast.success('Clasificación guardada')
      onSaved()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:12, padding:24, maxWidth:440, width:'100%', boxShadow:'0 8px 32px rgba(0,0,0,0.15)' }}>
        <div style={{ fontSize:15, fontWeight:600, marginBottom:4 }}>Clasificar movimiento</div>
        <div style={{ fontSize:12, color:'#6B7280', marginBottom:16 }}>
          {movimiento.fecha} · {fmt(movimiento.monto)} · {movimiento.descripcion}
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div>
            <label style={labelSt}>Tipo de movimiento</label>
            <select style={selectSt} value={tipo} onChange={e => setTipo(e.target.value)}>
              {TIPO_CONFIRMADO_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
          <div>
            <label style={labelSt}>Estado</label>
            <select style={selectSt} value={estado} onChange={e => setEstado(e.target.value)}>
              <option value="pendiente">Pendiente</option>
              <option value="conciliado">Conciliado</option>
              <option value="ignorado">Ignorado (no conciliar)</option>
            </select>
          </div>
          <div>
            <label style={labelSt}>Observación</label>
            <input style={inputSt} value={obs} onChange={e => setObs(e.target.value)}
              placeholder="Ej: Préstamo JP Reyes, reembolso proveedor..." />
          </div>
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:20 }}>
          <button onClick={onClose} style={btnOutlineSt}>Cancelar</button>
          <button onClick={guardar} disabled={saving} style={{ ...btnSt('#0F766E'), opacity:saving?0.6:1 }}>
            {saving && <Loader2 size={13} />} Guardar
          </button>
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

  const cargar = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('cartola_bancaria')
        .select('*')
        .gte('fecha', desde).lte('fecha', hasta)
        .eq('cargo_abono', 'A')
        .order('fecha', { ascending: false })
        .limit(1000)
      if (error) throw error
      setDatos(data ?? [])
    } catch (e) { toast.error(e.message) }
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
                                  Clasificar
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
        <ModalClasificar
          movimiento={modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); cargar() }}
        />
      )}
    </div>
  )
}
