import { useEffect, useState, useMemo, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabase'

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)
const fN  = n => new Intl.NumberFormat('es-CL').format(Math.round(n || 0))
const AZUL   = '#1F4E79'
const VERDE  = '#16A34A'
const ROJO   = '#DC2626'
const NARANJA= '#D97706'
const GRIS   = '#6B7280'

// Mapeo local Getnet → sucursal_id
const LOCAL_MAP = {
  'OUTLET DE PUERTAS SPA': 'suc-lg',
  'OUTLET DE PUERTAS':     'suc-lg',
  'LA GRANJA':             'suc-lg',
  'LOS ANGELES':           'suc-la',
  'LOS ÁNGELES':           'suc-la',
  'CD MAIPÚ':              'suc-mp',
  'MAIPU':                 'suc-mp',
}

function getSucId(local) {
  if (!local) return null
  const k = local.trim().toUpperCase()
  return LOCAL_MAP[k] || null
}

// Parsear fecha "31/03/2026 18:10:57" → ISO
function parseFechaGetnet(v) {
  if (!v) return null
  if (v instanceof Date) return v.toISOString()
  const s = String(v).trim()
  // dd/mm/yyyy hh:mm:ss
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}.000Z`
  // dd/mm/yyyy
  const m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`
  return null
}

function parseFechaAbono(v) {
  if (!v) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return null
}

// Procesar Excel Getnet
function procesarExcelGetnet(buffer, nombreArchivo) {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })

  const header = rows[0]
  const COL = {}
  header.forEach((h, i) => { COL[String(h).trim().toUpperCase()] = i })

  const transacciones = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r[COL['ID TRANSACCIÓN']] && !r[COL['COD.AUT']]) continue

    const localRaw = String(r[COL['LOCAL']] || '').trim()
    const tipo = String(r[COL['TIPO']] || '').trim()
    const estado = String(r[COL['ESTADO']] || '').trim()

    // Solo Abonados
    if (estado.toLowerCase() !== 'abonado') continue

    const toNum = v => { const n = parseFloat(String(v).replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n }

    transacciones.push({
      id_transaccion:   String(r[COL['ID TRANSACCIÓN']] || '').trim(),
      cod_aut:          String(r[COL['COD.AUT']] || '').trim(),
      local_getnet:     localRaw,
      sucursal_id:      getSucId(localRaw),
      num_local:        String(r[COL['NUM LOCAL']] || '').trim(),
      terminal:         String(r[COL['TERMINAL']] || '').trim(),
      vendedor_getnet:  String(r[COL['VENDEDOR']] || '').trim(),
      marca:            String(r[COL['MARCA']] || '').trim(),
      tipo,
      tipo_movimiento:  String(r[COL['TIPO MOV.']] || '').trim(),
      cuotas:           parseInt(r[COL['CUOTAS']] || '1') || 1,
      bin:              String(r[COL['BIN']] || '').trim(),
      valor_venta:      toNum(r[COL['VALOR VENTA']]),
      valor_transaccion:toNum(r[COL['VALOR TRANSACCIÓN']]),
      comision:         toNum(r[COL['COMISIÓN']]),
      monto_abono:      toNum(r[COL['MONTO ABONO']]),
      fecha_venta:      parseFechaGetnet(r[COL['FECHA VENTA']]),
      fecha_abono:      parseFechaAbono(r[COL['FECHA ABONO']]),
      tipo_pago:        String(r[COL['TIPO PAGO']] || '').trim(),
      estado:           estado,
      estado_transaccion: String(r[COL['ESTADO TRANSACCIÓN']] || '').trim(),
      referencia:       String(r[COL['REFERENCIA']] || '').trim(),
      archivo_origen:   nombreArchivo,
    })
  }
  return transacciones
}

// ── Componentes UI ────────────────────────────────────────────────────────────
const cardSt = { background: '#fff', borderRadius: 12, padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: 16 }
const TH = { padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: GRIS, letterSpacing: '0.05em', textTransform: 'uppercase', background: '#F9FAFB', whiteSpace: 'nowrap' }
const TD = { padding: '9px 12px', fontSize: 12, color: '#374151', whiteSpace: 'nowrap', verticalAlign: 'middle' }

function Kpi({ label, valor, sub, color = AZUL, ic }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: '14px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: GRIS, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{ic} {label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color, letterSpacing: '-0.03em' }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: GRIS }}>{sub}</div>}
    </div>
  )
}

const MEDIOS_LABEL = {
  efectivo:       { l: '💵 Efectivo',        color: VERDE   },
  credito_getnet: { l: '💳 Crédito Getnet',  color: AZUL    },
  debito_getnet:  { l: '💳 Débito/Prepago',  color: '#2E6DA4' },
  transferencia:  { l: '🏦 Transferencia',   color: '#0891B2' },
  otros:          { l: '📋 Otros medios',    color: GRIS    },
}

// ── Componente principal ──────────────────────────────────────────────────────
export function AbonősGetnetTab({ usuario }) {
  const [tab, setTab] = useState('uploader') // uploader | analisis | historial
  const [sucursales, setSucursales] = useState([])

  // Uploader
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef()

  // Análisis
  const [analisis, setAnalisis] = useState([])
  const [loadingAnalisis, setLoadingAnalisis] = useState(false)
  const [filMes, setFilMes] = useState('')
  const [filSuc, setFilSuc] = useState('todas')

  // Historial
  const [historial, setHistorial] = useState([])
  const [loadingHist, setLoadingHist] = useState(false)

  useEffect(() => {
    supabase.from('sucursales').select('id, nombre').eq('activo', true).order('orden')
      .then(({ data }) => setSucursales(data || []))
  }, [])

  useEffect(() => {
    if (tab === 'analisis') cargarAnalisis()
    if (tab === 'historial') cargarHistorial()
  }, [tab])

  async function cargarAnalisis() {
    setLoadingAnalisis(true)
    try {
      const { data, error } = await supabase.from('v_analisis_medios_pago').select('*')
      if (error) throw error
      setAnalisis(data || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingAnalisis(false)
    }
  }

  async function cargarHistorial() {
    setLoadingHist(true)
    try {
      const { data } = await supabase.from('getnet_transacciones')
        .select('archivo_origen, sucursal_id, tipo, count:id.count(), total:monto_abono.sum()')
        .order('created_at', { ascending: false })
        .limit(200)
      // Agrupar por archivo
      const map = {}
      ;(data || []).forEach(r => {
        const k = r.archivo_origen
        if (!map[k]) map[k] = { archivo: k, filas: 0, total: 0 }
        map[k].filas += parseInt(r.count || 0)
        map[k].total += parseFloat(r.total || 0)
      })
      setHistorial(Object.values(map).slice(0, 20))
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingHist(false)
    }
  }

  async function procesarArchivo(file) {
    if (!file) return
    setUploading(true)
    setUploadResult(null)
    try {
      const buffer = await file.arrayBuffer()
      const txns = procesarExcelGetnet(new Uint8Array(buffer), file.name)

      if (txns.length === 0) {
        setUploadResult({ ok: false, msg: 'No se encontraron transacciones "Abonado" en el archivo.' })
        return
      }

      // Upsert en bloques de 500
      let insertadas = 0, duplicadas = 0
      const chunk = 500
      for (let i = 0; i < txns.length; i += chunk) {
        const bloque = txns.slice(i, i + chunk)
        const { data, error } = await supabase.from('getnet_transacciones')
          .upsert(bloque, { onConflict: 'id_transaccion', ignoreDuplicates: true })
          .select('id')
        if (error) throw error
        insertadas += (data || []).length
        duplicadas += bloque.length - (data || []).length
      }

      setUploadResult({
        ok: true,
        msg: `✅ Procesadas ${fN(txns.length)} transacciones — ${fN(insertadas)} nuevas, ${fN(duplicadas)} ya existían`,
        txns: txns.length, insertadas, duplicadas,
      })
    } catch (e) {
      setUploadResult({ ok: false, msg: `Error: ${e.message}` })
    } finally {
      setUploading(false)
    }
  }

  // Meses disponibles del análisis
  const mesesDisp = useMemo(() => {
    const set = new Set(analisis.map(r => r.mes?.slice(0, 7)).filter(Boolean))
    return [...set].sort().reverse()
  }, [analisis])

  // Filtrar y agrupar análisis
  const analisisFilt = useMemo(() => {
    return analisis.filter(r => {
      const enMes = filMes ? r.mes?.startsWith(filMes) : true
      const enSuc = filSuc !== 'todas' ? r.sucursal_id === filSuc : true
      return enMes && enSuc
    })
  }, [analisis, filMes, filSuc])

  // Totales por medio (suma de meses/sucursales filtrados)
  const totalesPorMedio = useMemo(() => {
    const map = {}
    analisisFilt.forEach(r => {
      if (!map[r.medio]) map[r.medio] = { declarado: 0, corroborado: 0, depositado: 0 }
      map[r.medio].declarado   += parseFloat(r.declarado || 0)
      map[r.medio].corroborado += parseFloat(r.corroborado || 0)
      map[r.medio].depositado  += parseFloat(r.depositado || 0)
    })
    return map
  }, [analisisFilt])

  // Detalle mensual (para la tabla)
  const detallesMensuales = useMemo(() => {
    const map = {}
    analisisFilt.forEach(r => {
      const mes = r.mes?.slice(0, 7) || ''
      const suc = r.sucursal_nombre || r.sucursal_id || '—'
      const k = `${mes}__${r.sucursal_id}`
      if (!map[k]) map[k] = { mes, suc, sucursal_id: r.sucursal_id, medios: {} }
      map[k].medios[r.medio] = {
        declarado:   parseFloat(r.declarado || 0),
        corroborado: parseFloat(r.corroborado || 0),
        depositado:  parseFloat(r.depositado || 0),
        dif_corrob:  parseFloat(r.dif_corrob_decl || 0),
        dif_dep:     parseFloat(r.dif_dep_corrob || 0),
      }
    })
    return Object.values(map).sort((a, b) => b.mes.localeCompare(a.mes))
  }, [analisisFilt])

  const selSt = { padding: '7px 12px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 13, color: '#374151', background: '#fff', cursor: 'pointer' }
  const tabBtn = (k) => ({
    padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer',
    color: tab === k ? AZUL : GRIS,
    borderBottom: tab === k ? `2px solid ${AZUL}` : '2px solid transparent',
  })

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif" }}>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        <button style={tabBtn('uploader')}  onClick={() => setTab('uploader')}>📤 Subir Excel Getnet</button>
        <button style={tabBtn('analisis')}  onClick={() => setTab('analisis')}>📊 Análisis mensual</button>
        <button style={tabBtn('historial')} onClick={() => setTab('historial')}>📋 Historial</button>
      </div>

      {/* ── TAB: UPLOADER ── */}
      {tab === 'uploader' && (
        <div>
          <div style={cardSt}>
            <div style={{ fontSize: 13, fontWeight: 700, color: AZUL, marginBottom: 4 }}>Importar transacciones Getnet</div>
            <div style={{ fontSize: 12, color: GRIS, marginBottom: 16 }}>
              Descarga el reporte "Ventas" desde el portal Getnet y súbelo aquí. Se importan solo las transacciones con estado "Abonado". Las duplicadas se ignoran automáticamente.
            </div>

            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); procesarArchivo(e.dataTransfer.files[0]) }}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? AZUL : '#D1D5DB'}`,
                borderRadius: 12, padding: '40px 20px',
                textAlign: 'center', cursor: 'pointer',
                background: dragOver ? '#EFF6FF' : '#F9FAFB',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>
                {uploading ? 'Procesando...' : 'Arrastra el Excel de Getnet aquí'}
              </div>
              <div style={{ fontSize: 12, color: GRIS, marginTop: 4 }}>o haz clic para seleccionar</div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                onChange={e => { procesarArchivo(e.target.files[0]); e.target.value = '' }} />
            </div>

            {/* Resultado */}
            {uploadResult && (
              <div style={{
                marginTop: 16, padding: '12px 16px', borderRadius: 8,
                background: uploadResult.ok ? '#DCFCE7' : '#FEE2E2',
                color: uploadResult.ok ? '#166534' : '#991B1B',
                fontSize: 13, fontWeight: 600,
              }}>
                {uploadResult.msg}
              </div>
            )}
          </div>

          {/* Info columnas */}
          <div style={{ ...cardSt, padding: '12px 20px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: AZUL, marginBottom: 8 }}>Columnas que se leen del Excel</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 4, fontSize: 11, color: GRIS }}>
              {['COD.AUT', 'LOCAL', 'NUM LOCAL', 'TERMINAL', 'VENDEDOR', 'MARCA', 'TIPO', 'TIPO MOV.', 'CUOTAS', 'BIN', 'VALOR VENTA', 'COMISIÓN', 'MONTO ABONO', 'FECHA VENTA', 'FECHA ABONO', 'TIPO PAGO', 'ESTADO', 'ESTADO TRANSACCIÓN', 'ID TRANSACCIÓN'].map(c => (
                <span key={c} style={{ padding: '2px 6px', background: '#F3F4F6', borderRadius: 4 }}>{c}</span>
              ))}
            </div>
            <div style={{ fontSize: 11, color: NARANJA, marginTop: 8 }}>
              ⚠ El archivo debe tener exactamente estos encabezados (tal como descarga Getnet). Solo se importan filas con ESTADO = "Abonado".
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: ANÁLISIS ── */}
      {tab === 'analisis' && (
        <div>
          {/* Filtros */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={filMes} onChange={e => setFilMes(e.target.value)} style={selSt}>
              <option value="">Todos los meses</option>
              {mesesDisp.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={filSuc} onChange={e => setFilSuc(e.target.value)} style={selSt}>
              <option value="todas">Todas las sucursales</option>
              {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>

          {loadingAnalisis
            ? <div style={{ textAlign: 'center', padding: 60, color: GRIS }}>Cargando análisis...</div>
            : (
            <>
              {/* KPIs totales */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
                <Kpi ic="💵" label="Total declarado"   color={AZUL}  valor={fmt(Object.values(totalesPorMedio).reduce((s, v) => s + v.declarado, 0))} />
                <Kpi ic="✅" label="Total corroborado" color={VERDE} valor={fmt(Object.values(totalesPorMedio).reduce((s, v) => s + v.corroborado, 0))} />
                <Kpi ic="🏦" label="Total depositado"  color={AZUL}  valor={fmt(Object.values(totalesPorMedio).reduce((s, v) => s + v.depositado, 0))} />
              </div>

              {/* Resumen por medio */}
              <div style={{ ...cardSt, padding: 0, overflow: 'hidden', marginBottom: 16 }}>
                <div style={{ padding: '12px 20px', borderBottom: '1px solid #F3F4F6', fontSize: 13, fontWeight: 700, color: AZUL }}>
                  Resumen por medio de pago
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={TH}>Medio</th>
                        <th style={{ ...TH, textAlign: 'right' }}>Declarado</th>
                        <th style={{ ...TH, textAlign: 'right' }}>Corroborado</th>
                        <th style={{ ...TH, textAlign: 'right' }}>Dif. Corrob.</th>
                        <th style={{ ...TH, textAlign: 'right' }}>Depositado</th>
                        <th style={{ ...TH, textAlign: 'right' }}>Dif. Depósito</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(totalesPorMedio).map(([medio, v]) => {
                        const info = MEDIOS_LABEL[medio] || { l: medio, color: GRIS }
                        const difC = v.corroborado - v.declarado
                        const difD = v.depositado - v.corroborado
                        const colorC = Math.abs(difC) < 5000 ? VERDE : Math.abs(difC) < 50000 ? NARANJA : ROJO
                        const colorD = v.depositado === 0 ? GRIS : Math.abs(difD) < 5000 ? VERDE : Math.abs(difD) < 50000 ? NARANJA : ROJO
                        return (
                          <tr key={medio} style={{ borderTop: '1px solid #F9FAFB' }}>
                            <td style={{ ...TD, fontWeight: 600, color: info.color }}>{info.l}</td>
                            <td style={{ ...TD, textAlign: 'right' }}>{fmt(v.declarado)}</td>
                            <td style={{ ...TD, textAlign: 'right' }}>{fmt(v.corroborado)}</td>
                            <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: colorC }}>{difC >= 0 ? '+' : ''}{fmt(difC)}</td>
                            <td style={{ ...TD, textAlign: 'right' }}>{v.depositado > 0 ? fmt(v.depositado) : <span style={{ color: GRIS }}>—</span>}</td>
                            <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: colorD }}>{v.depositado > 0 ? (difD >= 0 ? '+' : '') + fmt(difD) : <span style={{ color: GRIS }}>—</span>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Detalle mensual */}
              <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '12px 20px', borderBottom: '1px solid #F3F4F6', fontSize: 13, fontWeight: 700, color: AZUL }}>
                  Detalle mensual por sucursal
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={TH}>Mes</th>
                        <th style={TH}>Sucursal</th>
                        <th style={TH}>Medio</th>
                        <th style={{ ...TH, textAlign: 'right' }}>Declarado</th>
                        <th style={{ ...TH, textAlign: 'right' }}>Corroborado</th>
                        <th style={{ ...TH, textAlign: 'right' }}>Depositado</th>
                        <th style={{ ...TH, textAlign: 'right' }}>Δ Corrob.</th>
                        <th style={{ ...TH, textAlign: 'right' }}>Δ Depósito</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detallesMensuales.length === 0
                        ? <tr><td colSpan={8} style={{ ...TD, textAlign: 'center', padding: '32px 0', color: GRIS }}>Sin datos para los filtros seleccionados</td></tr>
                        : detallesMensuales.flatMap(fila =>
                          Object.entries(fila.medios).map(([medio, v]) => {
                            const info = MEDIOS_LABEL[medio] || { l: medio, color: GRIS }
                            const difC = v.dif_corrob
                            const difD = v.dif_dep
                            const colorC = Math.abs(difC) < 5000 ? VERDE : Math.abs(difC) < 50000 ? NARANJA : ROJO
                            const colorD = v.depositado === 0 ? GRIS : Math.abs(difD) < 5000 ? VERDE : Math.abs(difD) < 50000 ? NARANJA : ROJO
                            return (
                              <tr key={`${fila.mes}-${fila.sucursal_id}-${medio}`} style={{ borderTop: '1px solid #F9FAFB' }}>
                                <td style={TD}>{fila.mes}</td>
                                <td style={TD}>{fila.suc}</td>
                                <td style={{ ...TD, fontWeight: 600, color: info.color }}>{info.l}</td>
                                <td style={{ ...TD, textAlign: 'right' }}>{fmt(v.declarado)}</td>
                                <td style={{ ...TD, textAlign: 'right' }}>{fmt(v.corroborado)}</td>
                                <td style={{ ...TD, textAlign: 'right' }}>{v.depositado > 0 ? fmt(v.depositado) : <span style={{ color: GRIS }}>—</span>}</td>
                                <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: colorC }}>{difC >= 0 ? '+' : ''}{fmt(difC)}</td>
                                <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: colorD }}>{v.depositado > 0 ? (difD >= 0 ? '+' : '') + fmt(difD) : <span style={{ color: GRIS }}>—</span>}</td>
                              </tr>
                            )
                          })
                        )
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── TAB: HISTORIAL ── */}
      {tab === 'historial' && (
        <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #F3F4F6', fontSize: 13, fontWeight: 700, color: AZUL }}>
            Archivos importados
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={TH}>Archivo</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Transacciones</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Total abonado</th>
                </tr>
              </thead>
              <tbody>
                {loadingHist
                  ? <tr><td colSpan={3} style={{ ...TD, textAlign: 'center', padding: '32px 0', color: GRIS }}>Cargando...</td></tr>
                  : historial.length === 0
                    ? <tr><td colSpan={3} style={{ ...TD, textAlign: 'center', padding: '32px 0', color: GRIS }}>Sin archivos importados</td></tr>
                    : historial.map(h => (
                      <tr key={h.archivo} style={{ borderTop: '1px solid #F9FAFB' }}>
                        <td style={{ ...TD, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.archivo}</td>
                        <td style={{ ...TD, textAlign: 'right' }}>{fN(h.filas)}</td>
                        <td style={{ ...TD, textAlign: 'right', fontWeight: 600, color: AZUL }}>{fmt(h.total)}</td>
                      </tr>
                    ))
                }
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
