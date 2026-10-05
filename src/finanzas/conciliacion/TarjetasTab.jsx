import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabase'
import { exportarExcel } from '../exportUtils'

/* ══════════════════════════════════════════════════════════════════════
   TARJETAS DE CRÉDITO — el gasto que antes no se veía
   Cada línea del estado de cuenta llega al EERR con su cuenta:
     · si pagó una factura ya registrada → salda al proveedor (no es gasto nuevo)
     · si no, la regla por comercio la lleva a su gasto
     · lo dudoso (posible gasto personal) queda "por decidir" en Pendientes
   El pago del banco salda la deuda de tarjeta (cuenta 2310102).
   Fuentes: v_tc_estados · v_tc_clasificado · RPC fn_tc_clasificar
   ══════════════════════════════════════════════════════════════════════ */
const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB'
const fmt = n => '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))
const TH = { textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: SLATE, padding: '7px 9px', borderBottom: `1px solid ${NAVY}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fff' }
const TD = { fontSize: 12.5, padding: '6px 9px', borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }
const NUM = { ...TD, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }
const INPUT = { fontSize: 12, padding: '5px 8px', border: `1px solid ${BORDE}`, borderRadius: 6, background: '#fff' }
const CUENTAS = [
  ['Gasto de la empresa', [
    ['5212703', 'Software, TI y plataformas'], ['5212702', 'Marketing y publicidad'], ['5213701', 'Combustible'],
    ['5212707', 'Viáticos y movilización'], ['5212901', 'Mantención general'], ['5212708', 'Herramientas y equipos menores'],
    ['5213001', 'Servicios externos'], ['5212701', 'Gastos generales'], ['5213901', 'Gastos bancarios'],
  ]],
  ['Gasto del socio (no es de la empresa)', [
    ['2640101', 'Retiro de socio'], ['1620101', 'Cuenta corriente del socio (lo devuelve)'],
  ]],
]
const NOMBRE = Object.fromEntries([...CUENTAS.flatMap(([, l]) => l), ['2170201', 'Pago de factura ya registrada'], ['1810101', 'Por decidir']])
const ORIGEN = { factura: ['PAGA FACTURA', VERDE], regla: ['REGLA', SLATE], manual: ['DECIDIDO', NAVY], sin_regla: ['SIN REGLA', AMBAR] }

export function TarjetasTab() {
  const [estados, setEstados] = useState([])
  const [lineas, setLineas] = useState([])
  const [soloDecidir, setSoloDecidir] = useState(true)
  const [filtroEstado, setFiltroEstado] = useState('')
  const [sel, setSel] = useState(new Set())
  const [cuenta, setCuenta] = useState('5212701')
  const [nota, setNota] = useState('')
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true); setError(null); setSel(new Set())
    const [e, l] = await Promise.all([
      supabase.from('v_tc_estados').select('*').order('fecha_estado', { ascending: false }),
      supabase.from('v_tc_clasificado').select('*').order('fecha_op', { ascending: false }).limit(1000),
    ])
    setCargando(false)
    if (l.error) { setError(l.error.message); return }
    setEstados(e.data ?? []); setLineas(l.data ?? [])
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const vista = lineas.filter(x => (!soloDecidir || x.cuenta === '1810101') && (!filtroEstado || `${x.tarjeta}|${x.fecha_estado}` === filtroEstado))
  const totSel = vista.filter(x => sel.has(x.id)).reduce((s, x) => s + Number(x.monto), 0)
  const porDecidir = lineas.filter(x => x.cuenta === '1810101')
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const aplicar = async () => {
    if (!sel.size) return
    setCargando(true); setError(null)
    const { data, error: er } = await supabase.rpc('fn_tc_clasificar', { p_ids: [...sel], p_cuenta: cuenta, p_nota: nota || null })
    setCargando(false)
    if (er || data?.ok === false) { setError(er?.message ?? data?.error); return }
    setMsg(`${data.actualizadas} línea(s) a ${NOMBRE[cuenta]}.${data.nota ? ' ' + data.nota : ''}`)
    setNota(''); setTimeout(() => setMsg(null), 7000); cargar()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: '#F0F4FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, lineHeight: 1.55, color: INK }}>
        Cada compra con tarjeta llega al resultado con su cuenta. Si la compra pagó una factura que ya está en el libro de compras, <b>no se cuenta dos veces</b>: salda al proveedor.
        Lo que puede ser gasto personal queda <b>por decidir</b> y bloquea el cierre del mes hasta que alguien lo asigne a la empresa o al socio.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        {[
          ['Estados de cuenta cargados', estados.length, SLATE],
          ['Movimientos', lineas.length, SLATE],
          ['Por decidir', `${porDecidir.length} · ${fmt(porDecidir.reduce((s, x) => s + Number(x.monto), 0))}`, porDecidir.length ? AMBAR : VERDE],
          ['Pagaron facturas ya registradas', lineas.filter(x => x.origen === 'factura').length, VERDE],
        ].map(([l, v, c]) => (
          <div key={l} style={{ background: '#fff', border: `1px solid ${BORDE}`, borderLeft: `4px solid ${c}`, borderRadius: 8, padding: '9px 13px' }}>
            <div style={{ fontSize: 10, letterSpacing: 0.5, color: SLATE, fontWeight: 700, textTransform: 'uppercase' }}>{l}</div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'ui-monospace, monospace', color: c }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} style={INPUT}>
          <option value="">Todos los estados de cuenta</option>
          {estados.map(e => <option key={e.tarjeta + e.fecha_estado} value={`${e.tarjeta}|${e.fecha_estado}`}>
            Tarjeta {e.tarjeta} · {e.fecha_estado} · {fmt(e.total)}{e.por_decidir ? ` · ${e.por_decidir} por decidir` : ''}</option>)}
        </select>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={soloDecidir} onChange={e => setSoloDecidir(e.target.checked)} /> Solo por decidir
        </label>
        <button onClick={() => exportarExcel(vista, 'tarjetas_credito', 'Tarjetas')} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY, marginLeft: 'auto' }}>Excel</button>
      </div>

      {sel.size > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: '#FAFAFB', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '9px 12px' }}>
          <b style={{ fontSize: 12.5, color: NAVY }}>{sel.size} seleccionadas · {fmt(totSel)}</b>
          <select value={cuenta} onChange={e => setCuenta(e.target.value)} style={INPUT}>
            {CUENTAS.map(([g, l]) => <optgroup key={g} label={g}>{l.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</optgroup>)}
          </select>
          <input value={nota} onChange={e => setNota(e.target.value)} placeholder="Nota (opcional): por qué" style={{ ...INPUT, flex: 1, minWidth: 180 }} />
          <button onClick={aplicar} disabled={cargando} style={{ ...INPUT, cursor: 'pointer', fontWeight: 700, background: NAVY, color: '#fff', border: `1px solid ${NAVY}` }}>
            {cargando ? 'Aplicando…' : 'Asignar'}
          </button>
        </div>
      )}
      {msg && <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '9px 12px', color: VERDE, fontSize: 12.5 }}>{msg}</div>}
      {error && <div style={{ background: '#FEF3F2', border: '1px solid #FECDCA', borderRadius: 8, padding: '9px 12px', color: ROJO, fontSize: 12.5 }}>{error}</div>}

      <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, maxHeight: '58vh', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={{ ...TH, width: 28 }}><input type="checkbox" checked={vista.length > 0 && vista.every(x => sel.has(x.id))}
              onChange={() => setSel(vista.every(x => sel.has(x.id)) ? new Set() : new Set(vista.map(x => x.id)))} /></th>
            <th style={TH}>Fecha</th><th style={TH}>Tarjeta</th><th style={TH}>Comercio</th>
            <th style={{ ...TH, textAlign: 'right' }}>Monto</th><th style={TH}>Va a</th><th style={TH}>Por qué</th>
          </tr></thead>
          <tbody>
            {vista.map(x => {
              const [et, c] = ORIGEN[x.origen] ?? ['', SLATE]
              return (
                <tr key={x.id} style={{ background: sel.has(x.id) ? '#F0F4FF' : x.cuenta === '1810101' ? '#FFFBEB' : undefined }}>
                  <td style={TD}><input type="checkbox" checked={sel.has(x.id)} onChange={() => toggle(x.id)} /></td>
                  <td style={TD}>{x.fecha_op}</td>
                  <td style={{ ...TD, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{x.tarjeta}</td>
                  <td style={{ ...TD, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.descripcion}{x.moneda === 'USD' ? <span style={{ color: SLATE, fontSize: 10 }}> · USD</span> : null}{x.cuota ? <span style={{ color: SLATE, fontSize: 10 }}> · cuota {x.cuota}</span> : null}</td>
                  <td style={{ ...NUM, fontWeight: 700 }}>{fmt(x.monto)}</td>
                  <td style={{ ...TD, fontWeight: 600, color: x.cuenta === '1810101' ? AMBAR : INK }}>{NOMBRE[x.cuenta] ?? x.cuenta}</td>
                  <td style={{ ...TD, fontSize: 11, color: SLATE, whiteSpace: 'normal', maxWidth: 300 }}>
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: c, marginRight: 6 }}>{et}</span>{x.factura ?? x.explicacion ?? 'Sin regla para este comercio'}
                  </td>
                </tr>
              )
            })}
            {!vista.length && !cargando && <tr><td colSpan={7} style={{ ...TD, textAlign: 'center', color: VERDE, padding: 20 }}>Nada pendiente con este filtro.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: SLATE }}>
        Las decisiones sobre meses cerrados quedan guardadas y se contabilizan al reabrir el mes. Los pagos de tarjeta del banco se clasifican solos como pago de la deuda.
      </div>
    </div>
  )
}

export default TarjetasTab
