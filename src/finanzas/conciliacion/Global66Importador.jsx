import { useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabase'
import { toast } from 'sonner'
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X } from 'lucide-react'

/* ═══ Global66 Importador ═══
   Parser del Excel "Movimientos de cuenta USD" exportado del portal Global66.
   Layout:
     Fila 0: título
     Fila 1: periodo
     Fila 3: headers (14 columnas)
     Fila 4+: datos
   Headers exactos:
     A: Tipo de transacción, B: Fecha, C: Monto debitado, D: Monto acreditado,
     E: Costo de tipo de cambio (CLP), F: ID Fees, G: 4 dig tarjeta,
     H: Nombre tercero, I: DNI, J: Cuenta tercero, K: País, L: Tipo de cambio,
     M: ID de la transacción (único), N: Comentario
*/

const TIPO_MAP = {
  'Conversión de divisas': null,  // se decide por contexto (con o sin CLP)
  'Envío a cuenta bancaria': 'pago_usd',
  'Comisión envío': 'comision',
  'Intereses abonados': 'interes',
}

const ESTILO = {
  card: { background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  btn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid #D1D5DB', background: '#fff', fontSize: 13, cursor: 'pointer', color: '#374151' },
  btnPrim: { background: '#1F4E79', color: '#fff', border: 'none' },
  badge: { fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, letterSpacing: '0.04em' },
}

const fmtUSD = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)

/* Normalizar nombre para fuzzy match contra proveedores */
function normNombre(s) {
  return (s || '').toString().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

export function Global66Importador({ onImported }) {
  const [archivo, setArchivo] = useState(null)
  const [parseando, setParseando] = useState(false)
  const [preview, setPreview] = useState(null)  // { filas:[], errores:[], existentes:[] }
  const [guardando, setGuardando] = useState(false)

  async function onFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setArchivo(f)
    setParseando(true)
    setPreview(null)
    try {
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: false })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: null })

      // Validar layout
      const headers = data[3] || []
      if (!headers[0]?.toString().toLowerCase().includes('tipo')) {
        throw new Error('Layout inesperado. La fila 4 debe ser el encabezado (Tipo de transacción, Fecha, ...).')
      }

      // Cargar proveedores existentes para fuzzy match
      const { data: provs, error: provErr } = await supabase.from('proveedores').select('id, nombre')
      if (provErr) throw provErr
      const provIndex = new Map((provs ?? []).map(p => [normNombre(p.nombre), p.id]))

      // Cargar IDs de transacciones ya importadas
      const { data: existentes } = await supabase.from('global66_movimientos').select('global66_tx_id')
      const setExistentes = new Set((existentes ?? []).map(e => e.global66_tx_id))

      const filas = []
      const errores = []
      const yaImportadas = []

      for (let i = 4; i < data.length; i++) {
        const row = data[i]
        if (!row || !row[0]) continue
        const tipoExcel = (row[0] || '').toString().trim()
        const fechaStr = (row[1] || '').toString().trim()
        const debitado = parsearMonto(row[2])
        const acreditado = parsearMonto(row[3])
        const costoTipoCambio = parsearMonto(row[4])  // CLP en compras
        const terceroNombre = (row[7] || '').toString().trim() || null
        const terceroCuenta = (row[9] || '').toString().trim() || null
        const terceroPais = (row[10] || '').toString().trim() || null
        const tasaCambio = parsearMonto(row[11])
        const txId = (row[12] || '').toString().trim()
        const comentario = (row[13] || '').toString().trim() || null

        if (!txId) { errores.push({ fila: i + 1, msg: 'Sin ID de transacción' }); continue }
        if (!fechaStr) { errores.push({ fila: i + 1, msg: 'Sin fecha' }); continue }
        if (setExistentes.has(txId)) { yaImportadas.push(txId); continue }

        // Mapeo de tipo
        let tipo = TIPO_MAP[tipoExcel]
        if (tipoExcel === 'Conversión de divisas') {
          // Con CLP costo = compra_usd (CLP→USD)
          // Sin CLP costo = ingreso_clp desde Santander (la cartola G66 no muestra el monto CLP origen)
          tipo = costoTipoCambio > 0 ? 'compra_usd' : 'ingreso_clp'
        }
        if (!tipo) { errores.push({ fila: i + 1, msg: `Tipo desconocido: ${tipoExcel}` }); continue }

        // monto_usd: positivo siempre; el signo va por tipo
        const montoUsd = tipo === 'ingreso_clp'
          ? acreditado || 0
          : (debitado || acreditado || 0)

        // monto_clp: solo para conversiones con costo
        let montoClp = null
        if (tipo === 'compra_usd' || tipo === 'ingreso_clp') {
          montoClp = costoTipoCambio > 0 ? Math.round(costoTipoCambio) : null
          // ingreso_clp sin CLP costo: queda NULL — JP debe asignar manualmente el monto desde Santander
        }

        // Match fuzzy de proveedor
        let proveedorId = null
        if (tipo === 'pago_usd' && terceroNombre) {
          const norm = normNombre(terceroNombre)
          proveedorId = provIndex.get(norm) || null
          // Si no match exacto, intentar match parcial (contiene)
          if (!proveedorId) {
            for (const [k, id] of provIndex.entries()) {
              if (k && norm && (k.includes(norm) || norm.includes(k))) { proveedorId = id; break }
            }
          }
        }

        filas.push({
          fila_excel: i + 1,
          global66_tx_id: txId,
          tipo,
          tipo_excel: tipoExcel,
          fecha_transaccion: fechaStr.replace(' ', 'T') + (fechaStr.length === 19 ? '' : ''),
          monto_usd: montoUsd,
          monto_clp: montoClp,
          tasa_cambio: tasaCambio || null,
          comision_clp: 0,
          tercero_nombre: terceroNombre,
          tercero_cuenta: terceroCuenta,
          tercero_pais: terceroPais,
          proveedor_id: proveedorId,
          comentario,
          santander_mov_id: null,
          oc_id: null,
          estado: 'pendiente',
        })
      }

      setPreview({ filas, errores, yaImportadas })
    } catch (e) {
      toast.error('Error parseando: ' + e.message)
    } finally {
      setParseando(false)
    }
  }

  function parsearMonto(v) {
    if (v == null || v === '') return null
    const n = Number(String(v).replace(',', '.'))
    return isNaN(n) ? null : n
  }

  async function importar() {
    if (!preview?.filas?.length) return
    setGuardando(true)
    try {
      const payload = preview.filas.map(f => ({
        global66_tx_id: f.global66_tx_id,
        tipo: f.tipo,
        fecha_transaccion: f.fecha_transaccion,
        monto_usd: f.monto_usd,
        monto_clp: f.monto_clp,
        tasa_cambio: f.tasa_cambio,
        comision_clp: f.comision_clp,
        tercero_nombre: f.tercero_nombre,
        tercero_cuenta: f.tercero_cuenta,
        tercero_pais: f.tercero_pais,
        proveedor_id: f.proveedor_id,
        comentario: f.comentario,
        estado: 'pendiente',
      }))
      // Insertar en lotes de 100 para evitar payload grande
      let ok = 0
      for (let i = 0; i < payload.length; i += 100) {
        const lote = payload.slice(i, i + 100)
        const { error } = await supabase.from('global66_movimientos').insert(lote)
        if (error) throw error
        ok += lote.length
      }
      toast.success(`${ok} movimientos importados`)
      setArchivo(null); setPreview(null)
      onImported?.()
    } catch (e) {
      toast.error('Error importando: ' + e.message)
    } finally {
      setGuardando(false)
    }
  }

  // Resúmenes para el preview
  const resumen = preview ? {
    pago_usd: preview.filas.filter(f => f.tipo === 'pago_usd'),
    compra_usd: preview.filas.filter(f => f.tipo === 'compra_usd'),
    ingreso_clp: preview.filas.filter(f => f.tipo === 'ingreso_clp'),
    comision: preview.filas.filter(f => f.tipo === 'comision'),
    interes: preview.filas.filter(f => f.tipo === 'interes'),
  } : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={ESTILO.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <FileSpreadsheet size={18} color="#1F4E79" />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Importar cartola Global66</div>
            <div style={{ fontSize: 11, color: '#9CA3AF' }}>Excel "Movimientos de cuenta USD" exportado del portal Global66</div>
          </div>
        </div>
        <label style={{ ...ESTILO.btn, ...ESTILO.btnPrim, cursor: parseando ? 'wait' : 'pointer' }}>
          <Upload size={14} /> {parseando ? 'Parseando…' : 'Seleccionar archivo'}
          <input type="file" accept=".xls,.xlsx" onChange={onFile} style={{ display: 'none' }} disabled={parseando} />
        </label>
        {archivo && <span style={{ marginLeft: 12, fontSize: 12, color: '#6B7280' }}>{archivo.name}</span>}
      </div>

      {preview && (
        <>
          {/* Resumen */}
          <div style={ESTILO.card}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6B7280', marginBottom: 10, letterSpacing: '0.03em' }}>RESUMEN DE IMPORTACIÓN</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
              <ResumenBox titulo="Pagos USD" valor={resumen.pago_usd.length} sub={fmtUSD(resumen.pago_usd.reduce((s, f) => s + f.monto_usd, 0))} color="#DC2626" />
              <ResumenBox titulo="Compras USD" valor={resumen.compra_usd.length} sub={fmtUSD(resumen.compra_usd.reduce((s, f) => s + f.monto_usd, 0))} color="#15803D" />
              <ResumenBox titulo="Ingresos CLP" valor={resumen.ingreso_clp.length} sub="(USD recibido)" color="#1F4E79" />
              <ResumenBox titulo="Comisiones" valor={resumen.comision.length} sub={fmtUSD(resumen.comision.reduce((s, f) => s + f.monto_usd, 0))} color="#B45309" />
              <ResumenBox titulo="Intereses" valor={resumen.interes.length} sub={fmtUSD(resumen.interes.reduce((s, f) => s + f.monto_usd, 0))} color="#0891B2" />
            </div>

            <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#6B7280', flexWrap: 'wrap', marginBottom: 12 }}>
              <span>Total a importar: <b style={{ color: '#111827' }}>{preview.filas.length}</b></span>
              {preview.yaImportadas.length > 0 && <span>Ya importados (omitidos): <b style={{ color: '#B45309' }}>{preview.yaImportadas.length}</b></span>}
              {preview.errores.length > 0 && <span>Errores: <b style={{ color: '#DC2626' }}>{preview.errores.length}</b></span>}
              <span>Pagos con proveedor identificado: <b style={{ color: '#047857' }}>{resumen.pago_usd.filter(f => f.proveedor_id).length}/{resumen.pago_usd.length}</b></span>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={importar} disabled={guardando || preview.filas.length === 0} style={{ ...ESTILO.btn, ...ESTILO.btnPrim, opacity: guardando ? 0.6 : 1 }}>
                <CheckCircle2 size={14} /> {guardando ? 'Importando…' : `Importar ${preview.filas.length} movimientos`}
              </button>
              <button onClick={() => { setPreview(null); setArchivo(null) }} disabled={guardando} style={ESTILO.btn}>
                <X size={14} /> Cancelar
              </button>
            </div>
          </div>

          {/* Preview filas */}
          <div style={{ ...ESTILO.card, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #F3F4F6', fontSize: 12, fontWeight: 700, color: '#6B7280' }}>
              PREVIEW — primeras {Math.min(50, preview.filas.length)} filas
            </div>
            <div style={{ overflowX: 'auto', maxHeight: 400 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                <thead style={{ position: 'sticky', top: 0, background: '#F9FAFB' }}>
                  <tr>
                    {['Fecha','Tipo','Monto USD','CLP','Tercero / proveedor match','Comentario'].map(h => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.filas.slice(0, 50).map(f => (
                    <tr key={f.global66_tx_id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <td style={{ padding: '7px 10px', fontSize: 11, whiteSpace: 'nowrap' }}>{f.fecha_transaccion.slice(0, 10)}</td>
                      <td style={{ padding: '7px 10px', fontSize: 11 }}>
                        <span style={{ ...ESTILO.badge, background: colorTipo(f.tipo).bg, color: colorTipo(f.tipo).fg }}>{labelTipo(f.tipo)}</span>
                      </td>
                      <td style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'monospace', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtUSD(f.monto_usd)}</td>
                      <td style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'monospace', textAlign: 'right', color: '#6B7280', whiteSpace: 'nowrap' }}>{f.monto_clp ? fmtCLP(f.monto_clp) : '—'}</td>
                      <td style={{ padding: '7px 10px', fontSize: 11, color: '#374151', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.tercero_nombre || '—'}
                        {f.tipo === 'pago_usd' && (
                          <span style={{ ...ESTILO.badge, marginLeft: 6, background: f.proveedor_id ? '#DCFCE7' : '#FEF3C7', color: f.proveedor_id ? '#15803D' : '#92400E' }}>
                            {f.proveedor_id ? '✓ match' : 'sin match'}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '7px 10px', fontSize: 10, color: '#6B7280', fontFamily: 'monospace', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.comentario || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Errores */}
          {preview.errores.length > 0 && (
            <div style={{ ...ESTILO.card, borderLeft: '4px solid #DC2626' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <AlertCircle size={14} color="#DC2626" />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#DC2626' }}>{preview.errores.length} filas con error (omitidas)</span>
              </div>
              <div style={{ fontSize: 11, color: '#6B7280', maxHeight: 150, overflowY: 'auto' }}>
                {preview.errores.slice(0, 20).map((e, i) => (
                  <div key={i}>Fila {e.fila}: {e.msg}</div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ResumenBox({ titulo, valor, sub, color }) {
  return (
    <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 12px', border: '1px solid #F3F4F6' }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{titulo}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: 'monospace', marginTop: 2 }}>{valor}</div>
      <div style={{ fontSize: 10, color: '#6B7280', fontFamily: 'monospace' }}>{sub}</div>
    </div>
  )
}

function labelTipo(t) {
  return { pago_usd: 'Pago USD', compra_usd: 'Compra USD', ingreso_clp: 'Ingreso', comision: 'Comisión', interes: 'Interés' }[t] || t
}
function colorTipo(t) {
  return {
    pago_usd: { bg: '#FEE2E2', fg: '#991B1B' },
    compra_usd: { bg: '#DCFCE7', fg: '#15803D' },
    ingreso_clp: { bg: '#DBEAFE', fg: '#1E40AF' },
    comision: { bg: '#FEF3C7', fg: '#92400E' },
    interes: { bg: '#CFFAFE', fg: '#155E75' },
  }[t] || { bg: '#F3F4F6', fg: '#6B7280' }
}
