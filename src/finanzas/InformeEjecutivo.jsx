import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { FuenteDrawer, abrirFuente } from './FuenteDrawer'
import { exportarExcel, exportarPDF } from './exportUtils'

/* ══════════════════════════════════════════════════════════════════════
   INFORME EJECUTIVO DE RESULTADOS
   Responde: ¿cuánto ganamos?, ¿por qué cambia?, ¿qué tienda sostiene y cuál
   drena?, ¿cómo está la salud financiera?, ¿qué tan confiable es el número?
   Cada cifra abre su fuente. Dos visiones por sucursal: contribución directa
   y resultado final con prorrateo de CD, Casa Matriz y gastos no asignados.
   Fuentes: v_informe_resultado_mensual · v_eerr_sucursal_prorrateado ·
            v_salud_financiera · v_ctrl_estado_libros
   ══════════════════════════════════════════════════════════════════════ */
const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB', FONDO = '#F7F7F8'
const fmt = n => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))
const fM = n => (Math.abs(n) >= 1e6 ? (n / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' M' : fmt(n))
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const TH = { textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: SLATE, padding: '7px 10px', borderBottom: `1px solid ${NAVY}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fff' }
const TD = { fontSize: 12.5, padding: '6px 10px', borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }
const NUM = { ...TD, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }
const CLICK = { cursor: 'pointer', textDecoration: 'underline dotted #C7D2FE' }
const INPUT = { fontSize: 12, padding: '5px 8px', border: `1px solid ${BORDE}`, borderRadius: 6, background: '#fff' }
const btn = (activo) => ({ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${activo ? NAVY : BORDE}`, background: activo ? NAVY : '#fff', color: activo ? '#fff' : INK })

function Panel({ titulo, sub, acciones, children }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${BORDE}` }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: NAVY }}>{titulo}</div>
          {sub && <div style={{ fontSize: 11, color: SLATE }}>{sub}</div>}
        </div>
        {acciones}
      </div>
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  )
}
function Kpi({ l, v, sub, color }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '10px 14px', minWidth: 170 }}>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: SLATE }}>{l}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || NAVY, fontFamily: 'ui-monospace, monospace' }}>{v}</div>
      {sub && <div style={{ fontSize: 11, color: SLATE }}>{sub}</div>}
    </div>
  )
}
const Ex = ({ filas, nombre, titulo, sub }) => (
  <span style={{ display: 'inline-flex', gap: 6 }}>
    <button onClick={() => exportarExcel(filas, nombre, 'Informe')} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>Excel</button>
    <button onClick={() => exportarPDF({ titulo, sub, filas, archivo: nombre, orientacion: 'landscape' })} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>PDF</button>
  </span>
)

export function InformeEjecutivo() {
  const [mensual, setMensual] = useState([])
  const [suc, setSuc] = useState([])
  const [salud, setSalud] = useState([])
  const [libros, setLibros] = useState([])
  const [det, setDet] = useState(null)
  const [anio] = useState(new Date().getFullYear())
  const [mes, setMes] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7) })
  const [alcance, setAlcance] = useState('mes')      // mes | ytd
  const [vision, setVision] = useState('directa')     // directa | prorrateada
  const [verMetodo, setVerMetodo] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('v_informe_resultado_mensual').select('*').like('periodo', `${anio}%`),
      supabase.from('v_eerr_sucursal_prorrateado').select('*').like('periodo', `${anio}%`),
      supabase.from('v_salud_financiera').select('*'),
      supabase.from('v_ctrl_estado_libros').select('*'),
    ]).then(([a, b, c, d]) => { setMensual(a.data ?? []); setSuc(b.data ?? []); setSalud(c.data ?? []); setLibros(d.data ?? []) })
  }, [anio])

  const cerrados = useMemo(() => mensual.filter(m => !m.mes_en_curso), [mensual])
  const mesRow = mensual.find(m => m.periodo === mes)
  const primero = cerrados[0]
  const ult2 = cerrados.slice(-2).reduce((s, m) => s + Number(m.resultado), 0)
  const ytdRes = cerrados.reduce((s, m) => s + Number(m.resultado), 0)
  const ytdVenta = cerrados.reduce((s, m) => s + Number(m.venta), 0)

  // Sucursales: mes seleccionado o YTD (suma de meses cerrados)
  const sucVista = useMemo(() => {
    const filas = alcance === 'mes' ? suc.filter(s => s.periodo === mes) : suc.filter(s => cerrados.some(c => c.periodo === s.periodo))
    const map = new Map()
    for (const f of filas) {
      const k = f.ceco
      const acc = map.get(k) ?? { ceco: f.ceco, ceco_nombre: f.ceco_nombre, clase: f.clase, ingresos: 0, costo_ventas: 0, remuneraciones: 0, mermas: 0, gastos_directos: 0, contribucion: 0, prorrateo_cd: 0, prorrateo_casa_matriz: 0, prorrateo_no_asignado: 0, resultado_final: 0 }
      for (const c of ['ingresos', 'costo_ventas', 'remuneraciones', 'mermas', 'gastos_directos', 'contribucion', 'prorrateo_cd', 'prorrateo_casa_matriz', 'prorrateo_no_asignado', 'resultado_final']) acc[c] += Number(f[c] || 0)
      // clase: si en algún mes fue tienda, se muestra como tienda
      if (f.clase === 'tienda') acc.clase = 'tienda'
      map.set(k, acc)
    }
    const arr = [...map.values()]
    const orden = { tienda: 0, cd: 1, casa_matriz: 2 }
    return arr.sort((a, b) => (orden[a.clase] - orden[b.clase]) || (b.ingresos - a.ingresos))
  }, [suc, mes, alcance, cerrados])
  const totalSuc = useMemo(() => sucVista.reduce((t, s) => { for (const k of Object.keys(s)) if (typeof s[k] === 'number') t[k] = (t[k] || 0) + s[k]; return t }, {}), [sucVista])
  const noAsignado = useMemo(() => {
    const filas = alcance === 'mes' ? suc.filter(s => s.periodo === mes) : suc.filter(s => cerrados.some(c => c.periodo === s.periodo))
    const porMes = new Map(); filas.forEach(f => porMes.set(f.periodo, Number(f.gastos_no_asignados_total || 0)))
    return [...porMes.values()].reduce((a, b) => a + b, 0)
  }, [suc, mes, alcance, cerrados])

  // ── fuentes ──
  const ini = p => p + '-01', fin = p => p + '-31'
  function fuenteMensual(m, col) {
    const map = { venta: ['VENTA_NETA'], costo: ['COSTO_NETO'], remuneraciones: ['REM_OPERACION', 'REM_VENTA', 'REM_ADMIN', 'REM_SOCIOS'], arriendo: ['ARRIENDO'], mermas: ['MERMAS'], ajuste_inventario: ['AJUSTE_INVENTARIO'], depreciacion: ['DEPRECIACION'], interes: ['INTERES_CREDITOS'], impuesto: ['IMPUESTO_RENTA'] }
    const cods = map[col]; if (!cods) return
    abrirFuente(setDet, { titulo: `${col.toUpperCase()} · ${m.periodo}`, sub: 'Detalle contable (asientos que componen la cifra)',
      query: supabase.from('v_eerr_detalle_devengo').select('fecha, asiento, cuenta, cuenta_nombre, glosa_linea, tercero, monto').eq('periodo', m.periodo).in('codigo', cods).order('monto', { ascending: false }) })
  }
  function fuenteSucursal(s, fila) {
    const periodos = alcance === 'mes' ? [mes] : cerrados.map(c => c.periodo)
    const pIni = ini(periodos[0]), pFin = fin(periodos[periodos.length - 1])
    const t = `${s.ceco_nombre} · ${alcance === 'mes' ? mes : 'acumulado ' + anio}`
    if (fila === 'ingresos') return abrirFuente(setDet, { titulo: `Ingresos · ${t}`, sub: 'Ventas BSALE por día (bruto con IVA, neto de NC)', query: supabase.from('ventas_bsale_dia').select('fecha, sucursal_id, docs_venta, total_venta, total_nc').eq('sucursal_id', s.ceco).gte('fecha', pIni).lte('fecha', pFin).order('fecha') })
    if (fila === 'costo_ventas') return abrirFuente(setDet, { titulo: `Costo de ventas · ${t}`, sub: 'Unidades vendidas por SKU × costo estándar del maestro', query: supabase.from('ventas_mensuales_sucursal').select('mes, sku, unidades').eq('sucursal', s.ceco).in('mes', periodos).order('unidades', { ascending: false }) })
    if (fila === 'remuneraciones') return abrirFuente(setDet, { titulo: `Remuneraciones · ${t}`, sub: 'Liquidaciones y honorarios del período (detalle de dirección reservado por rol)', query: supabase.from('v_rrhh_master').select('periodo, trabajador, cargo, centro_costo_nombre, glosa_nombre, monto').in('periodo', periodos).in('naturaleza', ['haber_imponible', 'haber_no_imponible', 'honorario']).order('monto', { ascending: false }) })
    if (fila === 'gastos_directos' || fila === 'contribucion') return abrirFuente(setDet, { titulo: `Gastos directos · ${t}`, sub: 'Facturas con centro de costo + pagos banco sin factura', query: supabase.from('v_eerr_sucursal_gastos').select('periodo, linea_nombre, fuente, monto').eq('ceco', s.ceco).in('periodo', periodos).order('monto', { ascending: false }) })
    if (fila === 'mermas') return abrirFuente(setDet, { titulo: `Mermas · ${t}`, sub: 'Ajustes de inventario contabilizados', query: supabase.from('v_eerr_detalle_devengo').select('periodo, fecha, glosa_linea, monto').eq('codigo', 'MERMAS').in('periodo', periodos).order('monto', { ascending: false }) })
    if (fila.startsWith('prorrateo') || fila === 'resultado_final') return abrirFuente(setDet, { titulo: `Prorrateo · ${alcance === 'mes' ? mes : 'acumulado'}`, sub: 'Base de prorrateo: participación de cada tienda en los ingresos del mes', query: supabase.from('v_eerr_sucursal_prorrateado').select('periodo, ceco_nombre, clase, ingresos, participacion_pct, contribucion, prorrateo_cd, prorrateo_casa_matriz, prorrateo_no_asignado, resultado_final').in('periodo', periodos).order('periodo') })
  }
  function fuenteSalud() {
    abrirFuente(setDet, { titulo: 'Balance de 8 columnas', sub: 'Base de los indicadores de salud financiera', query: supabase.from('v_balance_8_columnas').select('codigo, nombre, activo, pasivo, perdida, ganancia').order('codigo') })
  }

  const FILAS_SUC = [
    ['ingresos', 'Ingresos'], ['costo_ventas', 'Costo de ventas'], ['margen_bruto', 'Margen bruto'],
    ['remuneraciones', 'Remuneraciones'], ['mermas', 'Mermas'], ['gastos_directos', 'Gastos directos'], ['contribucion', 'CONTRIBUCIÓN DIRECTA'],
    ...(vision === 'prorrateada' ? [['prorrateo_cd', 'Prorrateo CD Maipú'], ['prorrateo_casa_matriz', 'Prorrateo Casa Matriz'], ['prorrateo_no_asignado', 'Prorrateo gastos no asignados'], ['resultado_final', 'RESULTADO FINAL']] : []),
  ]
  const valor = (s, k) => k === 'margen_bruto' ? s.ingresos - s.costo_ventas : s[k]
  const colorRes = v => v < 0 ? ROJO : VERDE

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── controles ── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={mes} onChange={e => setMes(e.target.value)} style={INPUT}>
          {mensual.map(m => <option key={m.periodo} value={m.periodo}>{MESES[Number(m.periodo.slice(5)) - 1]} {m.periodo.slice(0, 4)}{m.mes_en_curso ? ' (en curso)' : ''}</option>)}
        </select>
        <button onClick={() => setVerMetodo(v => !v)} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY, marginLeft: 'auto' }}>{verMetodo ? 'Ocultar método' : 'Cómo se calcula ahora'}</button>
      </div>

      {verMetodo && (
        <div style={{ background: '#F0F4FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '12px 16px', fontSize: 12.5, color: INK, lineHeight: 1.6 }}>
          <b>Antes</b>: el resultado se armaba desde el libro banco — se clasificaban los movimientos, se sumaba el libro de remuneraciones y la diferencia era "el resultado". Eso mide <b>plata que entró y salió</b> (caja), mezcla meses (una factura de julio pagada en agosto caía en agosto) y omite lo que no pasa por el banco (costo de la mercadería vendida, depreciación, provisiones, intereses devengados).
          <br /><b>Ahora</b>: el resultado sale de la <b>contabilidad por devengo</b>. Ingresos desde el libro de ventas del SII (idénticos al mayor, al peso). Costo de ventas = unidades vendidas × costo del maestro. Remuneraciones desde las liquidaciones, en el mes que se trabajó. Gastos desde las facturas, en el mes de emisión. Depreciación, intereses y provisión de renta calculados mes a mes. Cada cifra es un asiento con partida doble y se abre con un clic.
          <br /><b>La lectura de caja no desapareció</b>: sigue en el EERR como columna "Gestión (mixta)" y el flujo real está en el estado NIC 7. Pero el resultado oficial de la empresa es el devengo — es el que compara bien un mes contra otro y el que un banco o un contador reconoce.
          <br /><b>Por sucursal</b>: "Contribución directa" es lo que cada tienda genera con sus propios costos. "Resultado final" le suma su parte del CD, de Casa Matriz y de los gastos que no se asignan a ningún centro (intereses, depreciación, comisiones, impuesto), prorrateados según su participación en las ventas. La suma de los resultados finales de las tiendas es exactamente el resultado del EERR.
        </div>
      )}

      {/* ── síntesis ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Kpi l={`Venta ${mes}`} v={fM(mesRow?.venta ?? 0)} sub={mesRow ? `margen bruto ${mesRow.margen_bruto_pct}%` : ''} />
        <Kpi l={`Resultado ${mes}`} v={fM(mesRow?.resultado ?? 0)} color={colorRes(mesRow?.resultado ?? 0)} sub={mesRow?.mes_en_curso ? 'mes en curso: incompleto' : `margen neto ${mesRow?.margen_neto_pct ?? '—'}%`} />
        <Kpi l={`Resultado acumulado ${anio}`} v={fM(ytdRes)} color={colorRes(ytdRes)} sub={`${cerrados.length} meses cerrados · venta ${fM(ytdVenta)}`} />
        <Kpi l="Últimos 2 meses cerrados" v={fM(ult2)} color={colorRes(ult2)} sub={ult2 < 0 ? 'ALERTA: operación en pérdida' : 'operación positiva'} />
        <Kpi l="EBITDA últimos 2 meses" v={fM(cerrados.slice(-2).reduce((s, m) => s + Number(m.ebitda), 0))} color={colorRes(cerrados.slice(-2).reduce((s, m) => s + Number(m.ebitda), 0))} sub="antes de intereses, impuesto y depreciación" />
        {primero && mesRow && !mesRow.mes_en_curso && (
          <Kpi l="Margen bruto: primer mes → este mes" v={`${primero.margen_bruto_pct}% → ${mesRow.margen_bruto_pct}%`}
            color={Number(mesRow.margen_bruto_pct) < Number(primero.margen_bruto_pct) - 3 ? ROJO : VERDE}
            sub={`${(Number(mesRow.margen_bruto_pct) - Number(primero.margen_bruto_pct)).toFixed(1)} puntos`} />
        )}
      </div>

      {/* ── resultado mes a mes ── */}
      <Panel titulo={`Resultado mes a mes ${anio}`} sub="Clic en cualquier cifra abre los asientos que la componen"
        acciones={<Ex filas={mensual.map(m => ({ Mes: m.periodo, Venta: m.venta, Costo: m.costo, 'MB %': m.margen_bruto_pct, Remuneraciones: m.remuneraciones, Arriendo: m.arriendo, 'Merma real': m.mermas, 'Sin clasificar': m.ajuste_inventario, 'Otros gastos': m.otros_gastos, EBITDA: m.ebitda, Depreciación: m.depreciacion, Interés: m.interes, 'Result. antes imp.': m.resultado_antes_impuesto, Impuesto: m.impuesto, 'Resultado neto': m.resultado }))} nombre={`resultado_mensual_${anio}`} titulo={`Resultado mes a mes ${anio}`} sub="Devengo contable" />}>
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>Mes</th>{['Venta', 'Costo', 'MB %', 'Remuneraciones', 'Arriendo', 'Merma real', 'Sin clasificar', 'Otros gastos', 'EBITDA', 'Deprec.', 'Interés', 'RESULTADO ANTES DE IMPUESTO', 'Impuesto', 'Resultado neto'].map(h => <th key={h} style={{ ...TH, textAlign: 'right' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {mensual.map(m => (
                <tr key={m.periodo} style={{ background: m.periodo === mes ? '#F0F4FF' : m.mes_en_curso ? '#FFFBEB' : undefined }}>
                  <td style={{ ...TD, fontWeight: 700 }}>{MESES[Number(m.periodo.slice(5)) - 1]}{m.mes_en_curso ? ' ⌛' : ''}</td>
                  <td onClick={() => fuenteMensual(m, 'venta')} style={{ ...NUM, ...CLICK }}>{fmt(m.venta)}</td>
                  <td onClick={() => fuenteMensual(m, 'costo')} style={{ ...NUM, ...CLICK }}>{fmt(m.costo)}</td>
                  <td style={NUM}>{m.margen_bruto_pct}%</td>
                  <td onClick={() => fuenteMensual(m, 'remuneraciones')} style={{ ...NUM, ...CLICK }}>{fmt(m.remuneraciones)}</td>
                  <td onClick={() => fuenteMensual(m, 'arriendo')} style={{ ...NUM, ...CLICK }}>{fmt(m.arriendo)}</td>
                  <td onClick={() => fuenteMensual(m, 'mermas')} style={{ ...NUM, ...CLICK }}>{fmt(m.mermas)}</td>
                  <td onClick={() => fuenteMensual(m, 'ajuste_inventario')} style={{ ...NUM, ...CLICK, color: Number(m.ajuste_inventario) > 10000000 ? ROJO : AMBAR }}>{fmt(m.ajuste_inventario)}</td>
                  <td style={NUM}>{fmt(m.otros_gastos)}</td>
                  <td style={{ ...NUM, fontWeight: 600, color: colorRes(m.ebitda) }}>{fmt(m.ebitda)}</td>
                  <td onClick={() => fuenteMensual(m, 'depreciacion')} style={{ ...NUM, ...CLICK }}>{fmt(m.depreciacion)}</td>
                  <td onClick={() => fuenteMensual(m, 'interes')} style={{ ...NUM, ...CLICK }}>{fmt(m.interes)}</td>
                  <td style={{ ...NUM, fontWeight: 700, color: colorRes(m.resultado_antes_impuesto), background: '#FAFAFB' }}>{fmt(m.resultado_antes_impuesto)}</td>
                  <td onClick={() => fuenteMensual(m, 'impuesto')} style={{ ...NUM, ...CLICK, color: Number(m.impuesto) < 0 ? VERDE : INK }}>{fmt(m.impuesto)}</td>
                  <td style={{ ...NUM, fontWeight: 700, color: colorRes(m.resultado) }}>{fmt(m.resultado)}</td>
                </tr>
              ))}
              <tr style={{ background: '#EEF2FF' }}>
                <td style={{ ...TD, fontWeight: 700, color: NAVY }}>Acumulado cerrado</td>
                {['venta', 'costo'].map(k => <td key={k} style={{ ...NUM, fontWeight: 700, color: NAVY }}>{fmt(cerrados.reduce((s, m) => s + Number(m[k]), 0))}</td>)}
                <td style={{ ...NUM, fontWeight: 700, color: NAVY }}>{ytdVenta ? (100 * (ytdVenta - cerrados.reduce((s, m) => s + Number(m.costo), 0)) / ytdVenta).toFixed(1) : '—'}%</td>
                {['remuneraciones', 'arriendo', 'mermas', 'ajuste_inventario', 'otros_gastos', 'ebitda', 'depreciacion', 'interes', 'resultado_antes_impuesto', 'impuesto', 'resultado'].map(k => <td key={k} style={{ ...NUM, fontWeight: 700, color: ['resultado','resultado_antes_impuesto','ebitda'].includes(k) ? colorRes(cerrados.reduce((s, m) => s + Number(m[k]), 0)) : NAVY }}>{fmt(cerrados.reduce((s, m) => s + Number(m[k]), 0))}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: SLATE, marginTop: 6, lineHeight: 1.55 }}>
          <b>Merma real</b>: pérdida, destrucción y ajuste de conteo — es gasto legítimo. <b>Sin clasificar</b>: mercadería que salió de BSALE sin causa registrada; está en cuenta propia para que se vea y se clasifique, no escondida en mermas.
          El cambio de SKU (2ª selección y conversiones) <b>ya no castiga el resultado</b>: la mercadería no se pierde, cambia de código y se vende.
          El <b>impuesto</b> se provisiona sobre la utilidad acumulada del año, por eso en meses de pérdida aparece en verde (revierte provisión de meses anteriores). El <b>resultado antes de impuesto</b> es la medida de gestión.
          "Otros gastos" es el residuo que cuadra la fila con el resultado oficial. El mes en curso ⌛ no tiene costo, mermas ni depreciación: no es comparable.
        </div>
      </Panel>

      {/* ── por sucursal ── */}
      <Panel titulo="Estado de resultados por sucursal" sub="CD Maipú y Casa Matriz no generan ingreso: en la visión prorrateada su gasto se reparte a las tiendas según participación en ventas"
        acciones={<>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setAlcance('mes')} style={btn(alcance === 'mes')}>Mes</button>
            <button onClick={() => setAlcance('ytd')} style={btn(alcance === 'ytd')}>Acumulado</button>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setVision('directa')} style={btn(vision === 'directa')}>Contribución directa</button>
            <button onClick={() => setVision('prorrateada')} style={btn(vision === 'prorrateada')}>Con prorrateo</button>
          </div>
          <Ex filas={sucVista.map(s => Object.fromEntries([['Centro', s.ceco_nombre], ...FILAS_SUC.slice(1).map(([k, l]) => [l, valor(s, k)])]))} nombre={`eerr_sucursal_${alcance === 'mes' ? mes : anio}`} titulo={`EERR por sucursal · ${alcance === 'mes' ? mes : 'acumulado ' + anio}`} sub={vision === 'prorrateada' ? 'Con prorrateo de CD, Casa Matriz y no asignados' : 'Contribución directa'} />
        </>}>
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>Línea</th>
              {sucVista.map(s => <th key={s.ceco} style={{ ...TH, textAlign: 'right', color: s.clase === 'tienda' ? NAVY : SLATE }}>{s.ceco_nombre}{s.clase !== 'tienda' ? ' *' : ''}</th>)}
              <th style={{ ...TH, textAlign: 'right', background: '#EEF2FF' }}>Total</th>
            </tr></thead>
            <tbody>
              {FILAS_SUC.map(([k, l]) => {
                const esTotal = k === 'contribucion' || k === 'resultado_final'
                return (
                  <tr key={k} style={{ background: esTotal ? '#F7F7F8' : undefined }}>
                    <td style={{ ...TD, fontWeight: esTotal || k === 'margen_bruto' ? 700 : 500, color: esTotal ? NAVY : INK }}>{l}</td>
                    {sucVista.map(s => {
                      const v = valor(s, k)
                      const oculto = vision === 'prorrateada' && s.clase !== 'tienda' && (k.startsWith('prorrateo') || k === 'resultado_final')
                      return (
                        <td key={s.ceco} onClick={() => !oculto && k !== 'margen_bruto' && fuenteSucursal(s, k)}
                          style={{ ...NUM, ...(oculto || k === 'margen_bruto' ? {} : CLICK), fontWeight: esTotal ? 700 : 400,
                            color: esTotal ? colorRes(v) : (k === 'margen_bruto' && v < 0 ? ROJO : INK), opacity: oculto ? 0.35 : 1 }}>
                          {oculto ? '—' : fmt(v)}{k === 'margen_bruto' && s.ingresos > 0 ? <span style={{ fontSize: 10, color: SLATE }}> {(100 * v / s.ingresos).toFixed(1)}%</span> : null}
                        </td>
                      )
                    })}
                    <td style={{ ...NUM, fontWeight: 700, background: '#EEF2FF', color: esTotal ? colorRes(totalSuc[k] ?? (totalSuc.ingresos - totalSuc.costo_ventas)) : NAVY }}>
                      {fmt(k === 'margen_bruto' ? totalSuc.ingresos - totalSuc.costo_ventas : totalSuc[k])}
                    </td>
                  </tr>
                )
              })}
              {vision === 'directa' && (
                <>
                  <tr><td style={{ ...TD, color: SLATE }}>Gastos no asignados a centro (intereses, depreciación, comisiones, impuesto)</td>
                    <td colSpan={sucVista.length} onClick={() => fuenteSucursal(sucVista[0] || {}, 'prorrateo')} style={{ ...TD, ...CLICK, textAlign: 'right', color: SLATE, fontFamily: 'ui-monospace, monospace' }}>—</td>
                    <td style={{ ...NUM, background: '#EEF2FF', color: ROJO }}>{fmt(noAsignado)}</td></tr>
                  <tr style={{ background: '#EEF2FF' }}><td style={{ ...TD, fontWeight: 700, color: NAVY }}>RESULTADO EERR</td>
                    <td colSpan={sucVista.length} style={TD}></td>
                    <td style={{ ...NUM, fontWeight: 700, color: colorRes(totalSuc.contribucion + noAsignado) }}>{fmt((totalSuc.contribucion || 0) + noAsignado)}</td></tr>
                </>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: SLATE, marginTop: 6, lineHeight: 1.5 }}>
          * Centros sin ingreso propio. Canal Web muestra margen 100% porque su costo de venta se registra en la tienda que despacha. Un centro que vendió en un mes (p. ej. CD Maipú antes de la apertura de Tienda Maipú) se trata como tienda ese mes.
        </div>
      </Panel>

      {/* ── salud financiera + calidad ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 14 }}>
        <Panel titulo="Salud financiera" sub="Sobre el balance a la fecha · clic para ver el balance base"
          acciones={<Ex filas={salud.map(s => ({ Indicador: s.indicador, Valor: s.valor, Referencia: s.referencia, Lectura: s.lectura }))} nombre="salud_financiera" titulo="Salud financiera" />}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {salud.map(s => (
                <tr key={s.orden} onClick={fuenteSalud} style={{ cursor: 'pointer' }}>
                  <td style={TD}>{s.indicador}</td>
                  <td style={{ ...NUM, fontWeight: 600 }}>{s.valor}</td>
                  <td style={{ ...TD, color: SLATE, fontSize: 11 }}>{s.referencia}</td>
                  <td style={{ ...TD, fontWeight: 700, color: s.lectura === 'Sano' || s.lectura === 'Manejable' ? VERDE : s.lectura === 'Ajustado' ? AMBAR : ROJO }}>{s.lectura}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel titulo="Confiabilidad del número" sub="Qué tan completa está la base que sostiene este resultado">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {libros.filter(l => /cuenta contable|centro de costo|Cargos explicados|Puntos de saldo|Períodos cerrados|liquidaciones/.test(l.medida)).map((l, i) => {
                const pct = Number(l.pct), c = pct >= 95 ? VERDE : pct >= 70 ? AMBAR : ROJO
                return (
                  <tr key={i}>
                    <td style={{ ...TD, whiteSpace: 'normal', fontSize: 12 }}>{l.medida}</td>
                    <td style={{ ...NUM, fontWeight: 700, color: c }}>{l.pct}%</td>
                    <td style={{ ...TD, color: SLATE, fontSize: 11 }}>{l.ok}/{l.total}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: SLATE, marginTop: 8 }}>El detalle de cada medida está en Control → Estado de los libros, con clic a los registros pendientes.</div>
        </Panel>
      </div>

      <FuenteDrawer det={det} onClose={() => setDet(null)} />
    </div>
  )
}

export default InformeEjecutivo
