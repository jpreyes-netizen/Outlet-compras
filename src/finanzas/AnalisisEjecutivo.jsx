import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { FuenteDrawer, abrirFuente } from './FuenteDrawer'
import { exportarExcel, exportarPDF } from './exportUtils'

/* ══════════════════════════════════════════════════════════════════════
   ANÁLISIS EJECUTIVO — informe de resultados, estructura y diagnóstico
   · Diagnóstico: inferencias automáticas sobre los datos del mes
   · EERR desglosado: TODAS las líneas del maestro × 12 meses, con % s/venta
   · Estructura de costo: composición y su desplazamiento en el año
   · Por sucursal: contribución directa y resultado con prorrateo de CD/Casa Matriz
   · Salud financiera y punto de equilibrio
   Todo lee las mismas vistas que el resultado contable: un solo número.
   ══════════════════════════════════════════════════════════════════════ */
const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB'
const fmt = n => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))
const fM = n => { const v = Number(n || 0); return Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + 'M' : fmt(v) }
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const TH = { textAlign: 'left', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.4, color: SLATE, padding: '6px 8px', borderBottom: `1px solid ${NAVY}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fff', zIndex: 2 }
const TD = { fontSize: 12, padding: '5px 8px', borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }
const NUM = { ...TD, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }
const CLICK = { cursor: 'pointer', textDecoration: 'underline dotted #C7D2FE' }
const INPUT = { fontSize: 12, padding: '5px 8px', border: `1px solid ${BORDE}`, borderRadius: 6, background: '#fff' }
const btn = a => ({ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${a ? NAVY : BORDE}`, background: a ? NAVY : '#fff', color: a ? '#fff' : INK })
const SEV = { critico: ROJO, alerta: AMBAR, ok: VERDE }

function Panel({ titulo, sub, acciones, children }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${BORDE}`, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: NAVY }}>{titulo}</div>
          {sub && <div style={{ fontSize: 11, color: SLATE }}>{sub}</div>}
        </div>
        {acciones}
      </div>
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  )
}
const Ex = ({ filas, nombre, titulo, sub }) => (
  <span style={{ display: 'inline-flex', gap: 6 }}>
    <button onClick={() => exportarExcel(filas, nombre, 'Analisis')} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>Excel</button>
    <button onClick={() => exportarPDF({ titulo, sub, filas, archivo: nombre, orientacion: 'landscape' })} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>PDF</button>
  </span>
)
// barra proporcional simple (sin librerías)
const Barra = ({ v, max, color }) => (
  <div style={{ background: '#F3F4F6', borderRadius: 3, height: 8, width: '100%', overflow: 'hidden' }}>
    <div style={{ width: `${Math.min(100, Math.abs(v) / (max || 1) * 100)}%`, height: '100%', background: color, borderRadius: 3 }} />
  </div>
)

export function AnalisisEjecutivo({ cu }) {
  const [mensual, setMensual] = useState([])
  const [desglose, setDesglose] = useState([])
  const [estructura, setEstructura] = useState([])
  const [diag, setDiag] = useState([])
  const [salud, setSalud] = useState([])
  const [equilibrio, setEquilibrio] = useState(null)
  const [suc, setSuc] = useState([])
  const [det, setDet] = useState(null)
  const anio = new Date().getFullYear()
  const [vista, setVista] = useState('resumen')   // resumen | desglose | estructura | sucursal
  const [modoCol, setModoCol] = useState('pesos') // pesos | pct
  const [vision, setVision] = useState('directa')
  const [mes, setMes] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7) })

  useEffect(() => {
    Promise.all([
      supabase.from('v_informe_resultado_mensual').select('*').like('periodo', `${anio}%`),
      supabase.from('v_eerr_desglose_mes').select('*').like('periodo', `${anio}%`).limit(20000),
      supabase.from('v_estructura_costo').select('*').like('periodo', `${anio}%`),
      supabase.from('v_diagnostico_ejecutivo').select('*'),
      supabase.from('v_salud_financiera').select('*'),
      supabase.from('v_punto_equilibrio').select('*').maybeSingle(),
      supabase.from('v_eerr_sucursal_prorrateado').select('*').like('periodo', `${anio}%`),
    ]).then(([a, b, c, d, e, f, g]) => {
      setMensual(a.data ?? []); setDesglose(b.data ?? []); setEstructura(c.data ?? [])
      setDiag(d.data ?? []); setSalud(e.data ?? []); setEquilibrio(f.data ?? null); setSuc(g.data ?? [])
    })
  }, [anio])

  const cerrados = useMemo(() => mensual.filter(m => !m.mes_en_curso), [mensual])
  const periodos = useMemo(() => mensual.map(m => m.periodo), [mensual])
  const ytd = k => cerrados.reduce((s, m) => s + Number(m[k] || 0), 0)
  const mesRow = mensual.find(m => m.periodo === mes)

  // desglose: líneas × meses
  const lineas = useMemo(() => {
    const map = new Map()
    for (const d of desglose) {
      if (!map.has(d.codigo)) map.set(d.codigo, { codigo: d.codigo, nombre: d.nombre, seccion: d.seccion, orden: d.orden, es_subtotal: d.es_subtotal, tipo_costo: d.tipo_costo, meses: {} })
      map.get(d.codigo).meses[d.periodo] = d
    }
    return [...map.values()].sort((a, b) => a.orden - b.orden).filter(l => periodos.some(p => Math.abs(Number(l.meses[p]?.monto || 0)) > 0))
  }, [desglose, periodos])

  const sucMes = useMemo(() => suc.filter(s => s.periodo === mes), [suc, mes])

  function fuenteLinea(l, p) {
    abrirFuente(setDet, { titulo: `${l.nombre} · ${p}`, sub: 'Asientos contables que componen la línea',
      query: supabase.from('v_eerr_detalle_devengo').select('fecha, asiento, cuenta, cuenta_nombre, glosa_linea, tercero, monto').eq('periodo', p).eq('codigo', l.codigo).order('monto', { ascending: false }) })
  }
  function fuenteDiag(d) {
    const q = {
      inventario: () => ({ t: 'Salidas de inventario sin clasificar', s: 'Eventos BSALE sin causa registrada', q: supabase.from('log_mermas').select('fecha, sucursal_codigo, nota, tipo, total_unidades, costo_total').eq('tipo', 'sin_clasificar').order('costo_total', { ascending: false }) }),
      sucursal: () => ({ t: 'Resultado por centro con prorrateo', s: mes, q: supabase.from('v_eerr_sucursal_prorrateado').select('ceco_nombre, clase, ingresos, contribucion, prorrateo_cd, prorrateo_casa_matriz, prorrateo_no_asignado, resultado_final').eq('periodo', mes) }),
      margen: () => ({ t: 'Costo de ventas por mes', s: 'Comparación con el kardex PMP', q: supabase.from('v_inv_pmp_resumen').select('periodo, venta_neta, costo_ventas_estandar, costo_ventas_pmp, diferencia, margen_estandar_pct, margen_pmp_pct') }),
      estructura: () => ({ t: 'Remuneraciones por período', s: 'Detalle de liquidaciones y honorarios', q: supabase.from('v_rrhh_master').select('periodo, trabajador, cargo, centro_costo_nombre, glosa_nombre, monto').in('naturaleza', ['haber_imponible', 'haber_no_imponible', 'honorario']).order('periodo', { ascending: false }) }),
      liquidez: () => ({ t: 'Inventario valorizado por SKU', s: 'Kardex del último mes calculado', q: supabase.from('v_inv_pmp_detalle').select('periodo, sku, producto, stock_bsale, pmp, estandar, vendidas').gt('stock_bsale', 0).order('stock_bsale', { ascending: false }) }),
      rentabilidad: () => ({ t: 'Resultado mes a mes', s: 'Base del diagnóstico', q: supabase.from('v_informe_resultado_mensual').select('periodo, venta, margen_bruto_pct, ebitda, resultado_antes_impuesto, impuesto, resultado') }),
      equilibrio: () => ({ t: 'Estructura de costo por mes', s: 'Base del punto de equilibrio', q: supabase.from('v_estructura_costo').select('*') }),
    }[d.area]
    if (q) { const o = q(); abrirFuente(setDet, { titulo: o.t, sub: o.s, query: o.q }) }
  }

  const maxMag = Math.max(...diag.map(d => Math.abs(Number(d.magnitud || 0))), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* síntesis */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'stretch' }}>
        {[
          { l: `Venta ${mes}`, v: fM(mesRow?.venta), s: `MB ${mesRow?.margen_bruto_pct ?? '—'}%` },
          { l: 'Resultado antes de impuesto', v: fM(mesRow?.resultado_antes_impuesto), s: `${mesRow?.rai_pct ?? '—'}% s/venta`, c: Number(mesRow?.resultado_antes_impuesto) < 0 ? ROJO : VERDE },
          { l: 'EBITDA del mes', v: fM(mesRow?.ebitda), s: 'antes de interés, impuesto y depreciación', c: Number(mesRow?.ebitda) < 0 ? ROJO : VERDE },
          { l: `Acumulado ${anio}`, v: fM(ytd('resultado')), s: `${cerrados.length} meses cerrados`, c: ytd('resultado') < 0 ? ROJO : VERDE },
          { l: 'Punto de equilibrio', v: fM(equilibrio?.venta_equilibrio), s: equilibrio ? (Number(equilibrio.brecha_venta) > 0 ? `faltan ${fM(equilibrio.brecha_venta)} (${equilibrio.brecha_pct}%)` : 'superado') : '', c: Number(equilibrio?.brecha_venta) > 0 ? AMBAR : VERDE },
        ].map((k, i) => (
          <div key={i} style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '10px 14px', flex: '1 1 180px' }}>
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: SLATE }}>{k.l}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: k.c || NAVY, fontFamily: 'ui-monospace, monospace' }}>{k.v}</div>
            <div style={{ fontSize: 11, color: SLATE }}>{k.s}</div>
          </div>
        ))}
      </div>

      {/* diagnóstico */}
      <Panel titulo="Diagnóstico" sub="Inferencias calculadas sobre los datos del informe · clic en cada hallazgo para ver su fuente"
        acciones={<Ex filas={diag.map(d => ({ Área: d.area, Severidad: d.severidad, Hallazgo: d.titulo, Detalle: d.hallazgo, Magnitud: d.magnitud, Acción: d.accion }))} nombre="diagnostico_ejecutivo" titulo="Diagnóstico ejecutivo" />}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {diag.map(d => (
            <div key={d.orden} onClick={() => fuenteDiag(d)}
              style={{ display: 'grid', gridTemplateColumns: '6px 1fr 150px', gap: 12, alignItems: 'center', padding: '10px 12px', border: `1px solid ${BORDE}`, borderRadius: 6, cursor: 'pointer', background: d.severidad === 'critico' ? '#FEF3F2' : d.severidad === 'alerta' ? '#FFFBEB' : '#F0FDF4' }}>
              <div style={{ background: SEV[d.severidad], height: '100%', minHeight: 34, borderRadius: 3 }} />
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: NAVY }}>{d.titulo}</div>
                <div style={{ fontSize: 12, color: INK, lineHeight: 1.45 }}>{d.hallazgo}</div>
                <div style={{ fontSize: 11, color: SLATE, marginTop: 2 }}>→ {d.accion}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'ui-monospace, monospace', color: SEV[d.severidad] }}>{fM(d.magnitud)}</div>
                <Barra v={d.magnitud} max={maxMag} color={SEV[d.severidad]} />
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* selector de vista */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {[['resumen', 'Resultado mensual'], ['desglose', 'EERR desglosado'], ['estructura', 'Estructura de costo'], ['sucursal', 'Por sucursal']].map(([k, l]) => (
          <button key={k} onClick={() => setVista(k)} style={btn(vista === k)}>{l}</button>
        ))}
        <select value={mes} onChange={e => setMes(e.target.value)} style={{ ...INPUT, marginLeft: 'auto' }}>
          {mensual.map(m => <option key={m.periodo} value={m.periodo}>{MESES[Number(m.periodo.slice(5)) - 1]}{m.mes_en_curso ? ' (en curso)' : ''}</option>)}
        </select>
      </div>

      {vista === 'resumen' && (
        <Panel titulo={`Resultado mes a mes ${anio}`} sub="Clic en cualquier cifra abre los asientos que la componen"
          acciones={<Ex filas={mensual.map(m => ({ Mes: m.periodo, Venta: m.venta, Costo: m.costo, 'MB %': m.margen_bruto_pct, Remuneraciones: m.remuneraciones, Arriendo: m.arriendo, 'Merma real': m.mermas, 'Sin clasificar': m.ajuste_inventario, 'Otros gastos': m.otros_gastos, EBITDA: m.ebitda, Depreciación: m.depreciacion, Interés: m.interes, 'Antes de impuesto': m.resultado_antes_impuesto, Impuesto: m.impuesto, Resultado: m.resultado }))} nombre={`resultado_mensual_${anio}`} titulo={`Resultado mes a mes ${anio}`} />}>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={TH}>Mes</th>{['Venta', 'Costo', 'MB %', 'Remun.', 'Arriendo', 'Merma real', 'Sin clasif.', 'Otros', 'EBITDA', 'Deprec.', 'Interés', 'Antes de imp.', 'Impuesto', 'Resultado'].map(h => <th key={h} style={{ ...TH, textAlign: 'right' }}>{h}</th>)}</tr></thead>
              <tbody>
                {mensual.map(m => (
                  <tr key={m.periodo} style={{ background: m.periodo === mes ? '#F0F4FF' : m.mes_en_curso ? '#FFFBEB' : undefined }}>
                    <td style={{ ...TD, fontWeight: 700 }}>{MESES[Number(m.periodo.slice(5)) - 1]}{m.mes_en_curso ? ' ⌛' : ''}</td>
                    {['venta', 'costo'].map(k => <td key={k} style={NUM}>{fmt(m[k])}</td>)}
                    <td style={{ ...NUM, color: Number(m.margen_bruto_pct) < 38 ? ROJO : INK }}>{m.margen_bruto_pct}%</td>
                    {['remuneraciones', 'arriendo', 'mermas'].map(k => <td key={k} style={NUM}>{fmt(m[k])}</td>)}
                    <td style={{ ...NUM, color: Number(m.ajuste_inventario) > 10000000 ? ROJO : AMBAR }}>{fmt(m.ajuste_inventario)}</td>
                    <td style={NUM}>{fmt(m.otros_gastos)}</td>
                    <td style={{ ...NUM, fontWeight: 600, color: Number(m.ebitda) < 0 ? ROJO : VERDE }}>{fmt(m.ebitda)}</td>
                    <td style={NUM}>{fmt(m.depreciacion)}</td><td style={NUM}>{fmt(m.interes)}</td>
                    <td style={{ ...NUM, fontWeight: 700, background: '#FAFAFB', color: Number(m.resultado_antes_impuesto) < 0 ? ROJO : VERDE }}>{fmt(m.resultado_antes_impuesto)}</td>
                    <td style={{ ...NUM, color: Number(m.impuesto) < 0 ? VERDE : INK }}>{fmt(m.impuesto)}</td>
                    <td style={{ ...NUM, fontWeight: 700, color: Number(m.resultado) < 0 ? ROJO : VERDE }}>{fmt(m.resultado)}</td>
                  </tr>
                ))}
                <tr style={{ background: '#EEF2FF' }}>
                  <td style={{ ...TD, fontWeight: 700, color: NAVY }}>Acumulado</td>
                  {['venta', 'costo'].map(k => <td key={k} style={{ ...NUM, fontWeight: 700, color: NAVY }}>{fmt(ytd(k))}</td>)}
                  <td style={{ ...NUM, fontWeight: 700, color: NAVY }}>{ytd('venta') ? (100 * (ytd('venta') - ytd('costo')) / ytd('venta')).toFixed(1) : '—'}%</td>
                  {['remuneraciones', 'arriendo', 'mermas', 'ajuste_inventario', 'otros_gastos', 'ebitda', 'depreciacion', 'interes', 'resultado_antes_impuesto', 'impuesto', 'resultado'].map(k =>
                    <td key={k} style={{ ...NUM, fontWeight: 700, color: ['ebitda', 'resultado', 'resultado_antes_impuesto'].includes(k) ? (ytd(k) < 0 ? ROJO : VERDE) : NAVY }}>{fmt(ytd(k))}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {vista === 'desglose' && (
        <Panel titulo={`Estado de resultados desglosado · ${anio}`} sub={`${lineas.length} líneas del maestro × 12 meses · clic en cualquier celda abre su detalle contable`}
          acciones={<>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setModoCol('pesos')} style={btn(modoCol === 'pesos')}>Pesos</button>
              <button onClick={() => setModoCol('pct')} style={btn(modoCol === 'pct')}>% s/venta</button>
            </div>
            <Ex filas={lineas.map(l => Object.fromEntries([['Línea', l.nombre], ['Sección', l.seccion], ...periodos.map(p => [MESES[Number(p.slice(5)) - 1], Number(l.meses[p]?.monto || 0)]), ['Acumulado', periodos.reduce((s, p) => s + Number(l.meses[p]?.monto || 0), 0)]]))} nombre={`eerr_desglose_${anio}`} titulo={`EERR desglosado ${anio}`} />
          </>}>
          <div style={{ overflow: 'auto', maxHeight: '70vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...TH, left: 0, position: 'sticky', zIndex: 3, background: '#fff', minWidth: 230 }}>Línea</th>
                {periodos.map(p => <th key={p} style={{ ...TH, textAlign: 'right' }}>{MESES[Number(p.slice(5)) - 1]}</th>)}
                <th style={{ ...TH, textAlign: 'right', background: '#EEF2FF' }}>Acumulado</th>
              </tr></thead>
              <tbody>
                {lineas.map(l => {
                  const sub = l.es_subtotal
                  const acum = periodos.reduce((s, p) => s + Number(l.meses[p]?.monto || 0), 0)
                  return (
                    <tr key={l.codigo} style={{ background: sub ? '#F7F7F8' : undefined }}>
                      <td style={{ ...TD, position: 'sticky', left: 0, background: sub ? '#F7F7F8' : '#fff', fontWeight: sub ? 700 : 400, color: sub ? NAVY : INK, zIndex: 1 }}>
                        {sub ? l.nombre : <span style={{ paddingLeft: 10 }}>{l.nombre}</span>}
                        {l.tipo_costo && !sub && <span style={{ fontSize: 9.5, color: SLATE, marginLeft: 6 }}>{l.tipo_costo}</span>}
                      </td>
                      {periodos.map(p => {
                        const d = l.meses[p], v = Number(d?.monto || 0)
                        return (
                          <td key={p} onClick={() => v !== 0 && !sub && fuenteLinea(l, p)}
                            style={{ ...NUM, ...(v !== 0 && !sub ? CLICK : {}), fontWeight: sub ? 700 : 400, color: sub && v < 0 ? ROJO : sub ? NAVY : INK, background: p === mes ? '#F0F4FF' : undefined }}>
                            {v === 0 ? '' : modoCol === 'pct' ? (d?.pct_venta ?? '—') + '%' : fmt(v)}
                          </td>
                        )
                      })}
                      <td style={{ ...NUM, fontWeight: 700, background: '#EEF2FF', color: sub && acum < 0 ? ROJO : NAVY }}>{fmt(acum)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: SLATE, marginTop: 6 }}>Las filas en gris son subtotales del maestro. "% s/venta" permite comparar meses de distinto volumen: ahí se ve el desplazamiento de la estructura.</div>
        </Panel>
      )}

      {vista === 'estructura' && (
        <Panel titulo="Estructura de costo" sub="Cómo se reparte cada peso vendido, mes a mes · el desplazamiento explica la caída del resultado"
          acciones={<Ex filas={estructura} nombre={`estructura_costo_${anio}`} titulo={`Estructura de costo ${anio}`} />}>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={TH}>Concepto</th>
                {estructura.map(e => <th key={e.periodo} style={{ ...TH, textAlign: 'right' }}>{MESES[Number(e.periodo.slice(5)) - 1]}</th>)}
                <th style={{ ...TH, textAlign: 'right', background: '#EEF2FF' }}>Var. año</th>
              </tr></thead>
              <tbody>
                {[['pct_costo', 'Costo de mercadería', ROJO], ['pct_personal', 'Personal', ROJO], ['pct_ocupacion', 'Ocupación (arriendo y básicos)', AMBAR],
                  ['pct_inventario', 'Mermas y ajustes', AMBAR], ['pct_comercial', 'Comercial y logístico', SLATE], ['pct_administrativo', 'Administrativo', SLATE], ['pct_financiero', 'Financiero', SLATE]].map(([k, l, c]) => {
                  const prim = Number(estructura[0]?.[k] || 0), ultCerr = estructura.filter(e => e.periodo < new Date().toISOString().slice(0, 7))
                  const ult = Number(ultCerr[ultCerr.length - 1]?.[k] || 0), delta = ult - prim
                  return (
                    <tr key={k}>
                      <td style={{ ...TD, fontWeight: 500 }}>{l}</td>
                      {estructura.map(e => (
                        <td key={e.periodo} style={{ ...NUM, background: e.periodo === mes ? '#F0F4FF' : undefined, color: Number(e[k]) > Number(estructura[0]?.[k] || 0) + 3 ? ROJO : INK }}>{e[k] ?? '—'}%</td>
                      ))}
                      <td style={{ ...NUM, fontWeight: 700, background: '#EEF2FF', color: delta > 1 ? ROJO : delta < -1 ? VERDE : SLATE }}>{delta > 0 ? '+' : ''}{delta.toFixed(1)} pts</td>
                    </tr>
                  )
                })}
                <tr style={{ background: '#F7F7F8' }}>
                  <td style={{ ...TD, fontWeight: 700, color: NAVY }}>Venta del mes</td>
                  {estructura.map(e => <td key={e.periodo} style={{ ...NUM, fontWeight: 700, color: NAVY }}>{fM(e.venta)}</td>)}
                  <td style={{ ...NUM, fontWeight: 700, background: '#EEF2FF', color: NAVY }}>{fM(estructura.reduce((s, e) => s + Number(e.venta), 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {equilibrio && (
            <div style={{ marginTop: 12, background: '#F0F4FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '12px 16px', fontSize: 12.5, lineHeight: 1.6, color: INK }}>
              <b>Punto de equilibrio</b> (promedio de los últimos 3 meses cerrados): con un margen de contribución de <b>{equilibrio.margen_contribucion_pct}%</b> y costos fijos de <b>{fmt(equilibrio.costos_fijos_mes)}</b> mensuales,
              la empresa necesita vender <b>{fmt(equilibrio.venta_equilibrio)}</b> al mes para no perder. Hoy vende {fmt(equilibrio.venta_promedio_3m)}.
              {Number(equilibrio.brecha_venta) > 0
                ? <> Faltan <b style={{ color: ROJO }}>{fmt(equilibrio.brecha_venta)}</b> ({equilibrio.brecha_pct}%). Cada punto de margen bruto que se recupere baja la venta necesaria en cerca de {fmt(equilibrio.venta_equilibrio / equilibrio.margen_contribucion_pct)}.</>
                : <> Está <b style={{ color: VERDE }}>{fmt(-equilibrio.brecha_venta)}</b> por encima.</>}
            </div>
          )}
        </Panel>
      )}

      {vista === 'sucursal' && (
        <Panel titulo={`Resultado por sucursal · ${mes}`} sub="CD Maipú y Casa Matriz no venden pero gastan: con prorrateo su costo se reparte según participación en ventas"
          acciones={<>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setVision('directa')} style={btn(vision === 'directa')}>Contribución directa</button>
              <button onClick={() => setVision('prorrateada')} style={btn(vision === 'prorrateada')}>Con prorrateo</button>
            </div>
            <Ex filas={sucMes} nombre={`sucursal_${mes}`} titulo={`Resultado por sucursal ${mes}`} />
          </>}>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={TH}>Línea</th>
                {sucMes.map(s => <th key={s.ceco} style={{ ...TH, textAlign: 'right', color: s.clase === 'tienda' ? NAVY : SLATE }}>{s.ceco_nombre}{s.clase !== 'tienda' ? ' *' : ''}</th>)}
                <th style={{ ...TH, textAlign: 'right', background: '#EEF2FF' }}>Total</th>
              </tr></thead>
              <tbody>
                {[['ingresos', 'Ingresos'], ['costo_ventas', 'Costo de ventas'], ['margen_bruto', 'Margen bruto'], ['remuneraciones', 'Remuneraciones'], ['mermas', 'Mermas'], ['gastos_directos', 'Gastos directos'], ['contribucion', 'CONTRIBUCIÓN DIRECTA'],
                  ...(vision === 'prorrateada' ? [['prorrateo_cd', 'Prorrateo CD Maipú'], ['prorrateo_casa_matriz', 'Prorrateo Casa Matriz'], ['prorrateo_no_asignado', 'Prorrateo no asignados'], ['resultado_final', 'RESULTADO FINAL']] : [])
                ].map(([k, l]) => {
                  const esT = k === 'contribucion' || k === 'resultado_final'
                  const val = s => k === 'margen_bruto' ? Number(s.ingresos) - Number(s.costo_ventas) : Number(s[k] || 0)
                  const total = sucMes.reduce((t, s) => t + val(s), 0)
                  return (
                    <tr key={k} style={{ background: esT ? '#F7F7F8' : undefined }}>
                      <td style={{ ...TD, fontWeight: esT || k === 'margen_bruto' ? 700 : 500, color: esT ? NAVY : INK }}>{l}</td>
                      {sucMes.map(s => {
                        const v = val(s), oculto = s.clase !== 'tienda' && (k.startsWith('prorrateo') || k === 'resultado_final')
                        return <td key={s.ceco} style={{ ...NUM, fontWeight: esT ? 700 : 400, color: esT ? (v < 0 ? ROJO : VERDE) : INK, opacity: oculto ? 0.3 : 1 }}>
                          {oculto ? '—' : fmt(v)}{k === 'margen_bruto' && Number(s.ingresos) > 0 ? <span style={{ fontSize: 9.5, color: SLATE }}> {(100 * v / Number(s.ingresos)).toFixed(1)}%</span> : null}
                        </td>
                      })}
                      <td style={{ ...NUM, fontWeight: 700, background: '#EEF2FF', color: esT ? (total < 0 ? ROJO : VERDE) : NAVY }}>{fmt(total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: SLATE, marginTop: 6 }}>
            * Centros sin ingreso propio. En la visión prorrateada la suma del resultado final de las tiendas es exactamente el resultado del EERR del mes.
          </div>
        </Panel>
      )}

      {/* salud financiera */}
      <Panel titulo="Salud financiera" sub="Posición patrimonial a la fecha · conversa con el resultado: un balance sano no compensa una operación en pérdida"
        acciones={<Ex filas={salud.map(s => ({ Indicador: s.indicador, Valor: s.valor, Referencia: s.referencia, Lectura: s.lectura }))} nombre="salud_financiera" titulo="Salud financiera" />}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
          {salud.map(s => (
            <div key={s.orden} onClick={() => abrirFuente(setDet, { titulo: 'Balance de 8 columnas', sub: 'Base de los indicadores', query: supabase.from('v_balance_8_columnas').select('codigo, nombre, activo, pasivo, perdida, ganancia').order('codigo') })}
              style={{ border: `1px solid ${BORDE}`, borderLeft: `3px solid ${s.lectura === 'Sano' || s.lectura === 'Manejable' ? VERDE : s.lectura === 'Ajustado' ? AMBAR : ROJO}`, borderRadius: 6, padding: '8px 10px', cursor: 'pointer' }}>
              <div style={{ fontSize: 11, color: SLATE }}>{s.indicador}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'ui-monospace, monospace', color: NAVY }}>{s.valor}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: s.lectura === 'Sano' || s.lectura === 'Manejable' ? VERDE : s.lectura === 'Ajustado' ? AMBAR : ROJO }}>{s.lectura}</div>
              </div>
              <div style={{ fontSize: 10.5, color: SLATE }}>{s.referencia}</div>
            </div>
          ))}
        </div>
      </Panel>

      <FuenteDrawer det={det} onClose={() => setDet(null)} />
    </div>
  )
}

export default AnalisisEjecutivo
