import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../supabase'
import { exportarExcel } from './exportUtils'

/* ══════════════════════════════════════════════════════════════════════
   CONTROL DE VENTAS CONTRA BSALE
   El costo de ventas del EERR usa el COSTO HISTÓRICO que BSALE registró
   el día de cada venta. Ese dato no está en la API (verificado: details
   trae solo precios; costs.json trae el promedio actual), así que llega
   por el reporte "Detalle de ventas" del panel de BSALE.
   Esta pantalla lo importa, lo compara contra el EERR y aplica el costo.
   RPC: fn_bsale_control_cargar · fn_bsale_control_aplicar
   ══════════════════════════════════════════════════════════════════════ */
const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB'
const fmt = n => '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))
const fS = n => new Intl.NumberFormat('es-CL').format(Number(n || 0))
const TH = { textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: SLATE, padding: '7px 10px', borderBottom: `1px solid ${NAVY}`, whiteSpace: 'nowrap' }
const TD = { fontSize: 12.5, padding: '6px 10px', borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }
const NUM = { ...TD, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }
const INPUT = { fontSize: 12, padding: '6px 10px', border: `1px solid ${BORDE}`, borderRadius: 6, background: '#fff' }

// El reporte trae el nombre largo de la sucursal; acá se traduce al id del ERP
const SUC = {
  'SUCURSAL LA GRANJA': 'suc-lg',
  'SUCURSAL LOS ÁNGELES': 'suc-la',
  'SUCURSAL LOS ANGELES': 'suc-la',
  'Sucursal Maipú': 'suc-maipu',
  'SUCURSAL MAIPÚ': 'suc-maipu',
  'CD Maipu': 'suc-mp',
  'CD MAIPU': 'suc-mp',
}
const DOCS_VALIDOS = ['BOLETA ELECTRÓNICA T', 'FACTURA ELECTRÓNICA T', 'NOTA DE CRÉDITO ELECTRÓNICA T']

export function ControlVentasTab() {
  const [control, setControl] = useState([])
  const [faltantes, setFaltantes] = useState([])
  const [previo, setPrevio] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState(null)

  const cargar = useCallback(async () => {
    const [c, f] = await Promise.all([
      supabase.from('v_control_venta_bsale').select('*'),
      supabase.from('v_control_costo_faltante').select('*'),
    ])
    if (c.error) { setError(c.error.message); return }
    setControl(c.data ?? [])
    if (!f.error) setFaltantes(f.data ?? [])
  }, [])
  useEffect(() => { cargar() }, [cargar])

  // ── leer el Excel y agregar por período × sucursal ──
  const leerArchivo = async (file) => {
    setCargando(true); setError(null); setMsg(null); setPrevio(null)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const hoja = wb.Sheets[wb.SheetNames[0]]
      const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' })
      if (!filas.length) throw new Error('El archivo no tiene filas')

      const col = Object.keys(filas[0])
      const cFecha = col.find(c => /Fecha de Emisi/i.test(c))
      const cTipo = col.find(c => /Tipo de Documento/i.test(c))
      const cSuc = col.find(c => /^Sucursal$/i.test(c))
      const cVenta = col.find(c => /Venta Total Neta/i.test(c))
      const cCosto = col.find(c => /Costo Total Neto/i.test(c))
      const cDoc = col.find(c => /Numero del documento/i.test(c))
      if (!cFecha || !cVenta || !cCosto || !cSuc) {
        throw new Error('No reconozco las columnas. Debe ser el reporte "Detalle de ventas" de BSALE sin modificar.')
      }

      const acc = new Map()
      const sinMapear = new Set()
      for (const f of filas) {
        if (cTipo && !DOCS_VALIDOS.includes(String(f[cTipo]).trim())) continue
        const fe = String(f[cFecha]).trim()
        const m = fe.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
        if (!m) continue
        const periodo = `${m[3]}-${String(m[2]).padStart(2, '0')}`
        const sucNombre = String(f[cSuc]).trim()
        const suc = SUC[sucNombre]
        if (!suc) { sinMapear.add(sucNombre); continue }
        const k = `${periodo}|${suc}`
        const a = acc.get(k) ?? { periodo, sucursal_id: suc, venta_neta: 0, costo_real: 0, docs: new Set(), lineas: 0 }
        a.venta_neta += Number(f[cVenta]) || 0
        a.costo_real += Number(f[cCosto]) || 0
        if (cDoc) a.docs.add(String(f[cDoc]))
        a.lineas++
        acc.set(k, a)
      }
      const out = [...acc.values()].map(a => ({
        periodo: a.periodo, sucursal_id: a.sucursal_id,
        venta_neta: Math.round(a.venta_neta), costo_real: Math.round(a.costo_real),
        docs: a.docs.size, lineas: a.lineas,
      })).sort((x, y) => x.periodo.localeCompare(y.periodo) || x.sucursal_id.localeCompare(y.sucursal_id))
      if (!out.length) throw new Error('No se pudo agrupar ninguna fila. Revisar el formato del archivo.')
      setPrevio({ filas: out, archivo: file.name, total: filas.length, sinMapear: [...sinMapear] })
    } catch (e) {
      setError(String(e.message ?? e))
    }
    setCargando(false)
  }

  const confirmar = async () => {
    if (!previo) return
    setCargando(true); setError(null)
    const r = await supabase.rpc('fn_bsale_control_cargar', { p_filas: previo.filas, p_archivo: previo.archivo })
    if (r.error) { setError(r.error.message); setCargando(false); return }
    if (r.data?.ok === false) { setError(r.data.error); setCargando(false); return }
    const a = await supabase.rpc('fn_bsale_control_aplicar')
    setCargando(false)
    if (a.error) { setError('Cargó, pero no se pudo recalcular: ' + a.error.message); return }
    setMsg(`${r.data?.filas ?? 0} filas cargadas y contabilidad recalculada. Períodos: ${(r.data?.periodos ?? []).join(', ')}.`)
    setPrevio(null)
    cargar()
  }

  const sinReal = faltantes.filter(f => !f.tiene_costo_real)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: '#F0F4FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '12px 16px', fontSize: 12.5, lineHeight: 1.6, color: INK }}>
        <b>Por qué existe esta pantalla.</b> El costo de ventas del resultado usa el costo que el producto tenía <b>el día de la venta</b>, no el costo de hoy. Si se usara el actual, el margen de los meses viejos aparecería inflado y el de los recientes hundido.
        Ese costo histórico no está disponible en la API de BSALE: solo lo entrega el reporte <b>Detalle de ventas</b> del panel. Al cerrar cada mes hay que descargarlo y subirlo aquí.
      </div>

      {sinReal.length > 0 && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '11px 15px', fontSize: 12.5, color: INK }}>
          <b style={{ color: AMBAR }}>{sinReal.length} período(s) sin costo real cargado:</b> {sinReal.map(f => f.periodo).join(', ')}.
          Su costo está estimado con el costo estándar del maestro y puede distorsionar el margen de esos meses.
        </div>
      )}

      {/* carga */}
      <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Cargar el Detalle de ventas</div>
        <div style={{ fontSize: 11.5, color: SLATE, marginBottom: 12 }}>
          En BSALE: Reportes → Detalle de ventas → rango de fechas → Exportar a Excel. Subir el archivo sin modificar.
        </div>
        <input type="file" accept=".xlsx,.xls" disabled={cargando}
          onChange={e => e.target.files?.[0] && leerArchivo(e.target.files[0])}
          style={{ ...INPUT, cursor: 'pointer' }} />
        {cargando && <span style={{ fontSize: 12, color: SLATE, marginLeft: 10 }}>Procesando…</span>}

        {error && <div style={{ background: '#FEF3F2', border: '1px solid #FECDCA', borderRadius: 6, padding: '9px 12px', color: ROJO, fontSize: 12.5, marginTop: 12 }}>{error}</div>}
        {msg && <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 6, padding: '9px 12px', color: VERDE, fontSize: 12.5, marginTop: 12 }}>{msg}</div>}

        {previo && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: NAVY, marginBottom: 6 }}>
              Revisar antes de confirmar · {previo.archivo} · {fS(previo.total)} líneas leídas
            </div>
            {previo.sinMapear.length > 0 && (
              <div style={{ fontSize: 11.5, color: AMBAR, marginBottom: 8 }}>
                Sucursales no reconocidas y omitidas: {previo.sinMapear.join(', ')}
              </div>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={TH}>Período</th><th style={TH}>Sucursal</th>
                <th style={{ ...TH, textAlign: 'right' }}>Venta neta</th><th style={{ ...TH, textAlign: 'right' }}>Costo real</th>
                <th style={{ ...TH, textAlign: 'right' }}>Margen</th><th style={{ ...TH, textAlign: 'right' }}>Docs</th></tr></thead>
              <tbody>
                {previo.filas.map((f, i) => (
                  <tr key={i}>
                    <td style={{ ...TD, fontWeight: 600 }}>{f.periodo}</td>
                    <td style={TD}>{f.sucursal_id}</td>
                    <td style={NUM}>{fmt(f.venta_neta)}</td>
                    <td style={NUM}>{fmt(f.costo_real)}</td>
                    <td style={{ ...NUM, fontWeight: 700, color: VERDE }}>
                      {f.venta_neta ? (100 * (f.venta_neta - f.costo_real) / f.venta_neta).toFixed(1) : '—'}%
                    </td>
                    <td style={NUM}>{fS(f.docs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={confirmar} disabled={cargando}
                style={{ ...INPUT, cursor: 'pointer', fontWeight: 700, background: NAVY, color: '#fff', border: `1px solid ${NAVY}` }}>
                {cargando ? 'Aplicando…' : 'Confirmar y recalcular el costo'}
              </button>
              <button onClick={() => setPrevio(null)} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600 }}>Cancelar</button>
            </div>
            <div style={{ fontSize: 11, color: SLATE, marginTop: 6 }}>
              Al confirmar se regenera el costo de ventas y la provisión de impuesto de los períodos cargados. Los meses cerrados no se tocan.
            </div>
          </div>
        )}
      </div>

      {/* control permanente */}
      <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '11px 15px', borderBottom: `1px solid ${BORDE}` }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>El resultado contra BSALE</div>
            <div style={{ fontSize: 11.5, color: SLATE }}>Si el EERR está bien construido, estas columnas deben coincidir mes a mes</div>
          </div>
          <button onClick={() => exportarExcel(control, 'control_venta_bsale', 'Control')} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>Excel</button>
        </div>
        <div style={{ padding: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>Período</th>
              <th style={{ ...TH, textAlign: 'right' }}>Venta BSALE</th>
              <th style={{ ...TH, textAlign: 'right' }}>Venta EERR</th>
              <th style={{ ...TH, textAlign: 'right' }}>Diferencia</th>
              <th style={{ ...TH, textAlign: 'right' }}>MB BSALE</th>
              <th style={{ ...TH, textAlign: 'right' }}>MB EERR</th>
              <th style={{ ...TH, textAlign: 'right' }}>Desvío</th>
              <th style={TH}>Estado</th>
            </tr></thead>
            <tbody>
              {control.map((c, i) => {
                const dp = Math.abs(Number(c.dif_venta_pct ?? 0))
                const dm = Math.abs(Number(c.dif_margen_pts ?? 0))
                const ok = dp <= 1 && dm <= 0.5
                return (
                  <tr key={i}>
                    <td style={{ ...TD, fontWeight: 600 }}>{c.periodo}</td>
                    <td style={NUM}>{fmt(c.venta_bsale)}</td>
                    <td style={NUM}>{fmt(c.venta_eerr)}</td>
                    <td style={{ ...NUM, color: dp > 1 ? ROJO : SLATE }}>{fmt(c.dif_venta)}<span style={{ fontSize: 10 }}> {c.dif_venta_pct}%</span></td>
                    <td style={NUM}>{c.mb_bsale}%</td>
                    <td style={NUM}>{c.mb_eerr}%</td>
                    <td style={{ ...NUM, fontWeight: 700, color: dm > 0.5 ? ROJO : VERDE }}>{c.dif_margen_pts} pts</td>
                    <td style={{ ...TD, fontSize: 11, fontWeight: 700, color: ok ? VERDE : ROJO }}>{ok ? 'Cuadra' : 'Revisar'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 14px', borderTop: `1px solid ${BORDE}`, fontSize: 11, color: SLATE }}>
          Se considera que cuadra con menos de 1% de diferencia en venta y menos de 0,5 puntos en margen. Enero a mayo conservan un desvío menor por documentos exentos y redondeo del prorrateo diario.
        </div>
      </div>
    </div>
  )
}

export default ControlVentasTab
