// ═══════════════════════════════════════════════════════════════════════════
// InvAnalisisHistorico — Análisis histórico de inventario cíclico
//
// Grilla: tipología de producto (filas) × mes (columnas), con 4 métricas
// intercambiables:
//   · PÉRDIDA (bruto)  Σ |diferencia| × costo, sólo faltantes
//   · NETO             sobrantes − faltantes (si ≈ 0 con bruto alto, hay
//                      errores que se compensan, no pérdida real)
//   · ERI %            SKUs que cuadran / SKUs contados
//   · UNIDADES         diferencia en unidades
//
// Pestañas adicionales:
//   · Reincidentes     SKUs con diferencia en varios meses = problema sistémico
//   · Cruce mermas     lo que el inventario perdió vs lo que BSALE explica
//
// Excluye inventarios marcados es_prueba. Las líneas sin costo se cuentan
// aparte: no se asumen como cero para no subestimar la pérdida.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { css, Bt } from './ui_compartida.jsx'

const MES_L = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const fmtCLP = (n) => n == null || isNaN(Number(n)) ? '—'
  : (Number(n) < 0 ? '-$' : '$') + Math.abs(Math.round(Number(n))).toLocaleString('es-CL')
const fmtM = (n) => {                                   // millones, para celdas densas
  const v = Number(n || 0)
  if (v === 0) return '0'
  const a = Math.abs(v)
  if (a >= 1e6) return (v < 0 ? '-' : '') + (a / 1e6).toFixed(1) + 'M'
  if (a >= 1e3) return (v < 0 ? '-' : '') + Math.round(a / 1e3) + 'k'
  return String(Math.round(v))
}
const fmtN = (n) => Number(n || 0).toLocaleString('es-CL')

const th = { padding: '6px 8px', fontSize: 9.5, fontWeight: 800, color: '#6D6D72', textAlign: 'left',
  background: '#FAFAFC', borderBottom: '1px solid #E5E5EA', whiteSpace: 'nowrap', letterSpacing: '.03em' }
const td = { padding: '6px 8px', fontSize: 11.5, borderBottom: '1px solid #F2F2F7', whiteSpace: 'nowrap' }

const METRICAS = {
  balance:  { l: 'BALANCE $ · uds',  hint: 'Qué faltó y qué sobró, en plata y en unidades. ▼ rojo = falta · ▲ verde = sobra' },
  eri:      { l: 'ERI %',            hint: 'Líneas que cuadran exacto sobre líneas contadas. Estándar de clase mundial: ≥95%' },
  merma:    { l: 'MERMA %',          hint: 'Pérdida neta por cada $100 de inventario contado. Comparable entre meses de distinta cobertura' },
  descuadre:{ l: 'DESCUADRE %',      hint: 'Faltantes MÁS sobrantes sobre el inventario contado. Mide el desorden total del registro: el neto puede dar 0 con la mitad del stock mal anotado' },
}

export function InvAnalisisHistorico({ cu, sucs, onBack }) {
  const [cabs, setCabs]       = useState(null)
  const [dets, setDets]       = useState([])
  const [mermas, setMermas]   = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr]         = useState('')
  // Alcance por rol: quien no es gerencia/CD queda fijo en su sucursal
  const rol = cu?.rol_logistica || cu?.rol || ''
  const verTodo = ['admin', 'admin_sistema', 'jefe_bodega', 'coordinador',
    'logistica_admin', 'logistica_jefe_bodega', 'dir_general'].some(r => String(rol).includes(r))
  const [sucSel, setSucSel]   = useState(verTodo ? 'todas' : (cu?.sucursal_codigo || 'todas'))
  const [metrica, setMetrica] = useState('balance')
  const [tab, setTab]         = useState('grilla')       // grilla | reincidentes | mermas
  const [soloCerrados, setSoloCerrados] = useState(true)

  const cargar = async () => {
    setLoading(true); setErr('')
    try {
      // Cabeceras: sin inventarios de prueba
      const { data: c, error: e1 } = await supabase.from('log_inv_cabeceras')
        .select('id,sucursal_codigo,sucursal_nombre,tipo_inventario,estado,fecha_planificada,' +
                'fecha_corte_stock,fecha_ejecucion_real,created_at,categoria_asignada,es_prueba,es_historico,foto_bsale_skus')
        .or('es_prueba.is.null,es_prueba.eq.false')
        .limit(5000)
      if (e1) throw e1
      // Detalles: sólo las columnas necesarias (nunca los jsonb de ubicaciones)
      const { data: d, error: e2 } = await supabase.from('log_inv_detalles')
        .select('inventario_id,sku,producto,tipo_producto,cat_abcd,stock_sistema,stock_fisico,diferencia,costo_unitario,total_neto_inventario')
        .limit(30000)
      if (e2) throw e2
      // Mermas registradas en BSALE, para el cruce
      const { data: m } = await supabase.from('log_mermas')
        .select('fecha,sucursal_codigo,tipo,costo_total,total_unidades')
        .limit(20000)
      setCabs(c || []); setDets(d || []); setMermas(m || [])
    } catch (e) { setErr(e.message) }
    setLoading(false)
  }
  useEffect(() => { cargar() }, [])   // una sola carga: el filtrado es en memoria

  if (loading || cabs === null) return <div style={css.empty}>⏳ Cargando historial de inventarios…</div>
  if (err) return (
    <div style={{ padding: 20 }}>
      <div style={{ padding: 12, borderRadius: 10, background: '#FF3B3012', color: '#C93400', fontWeight: 700 }}>
        ⚠️ {err}
      </div>
      <div style={{ marginTop: 10 }}><Bt v="gry" sm onClick={cargar}>Reintentar</Bt></div>
    </div>
  )

  // ── Preparación ──────────────────────────────────────────────────────────
  const mesDe = (cab) => {
    const f = cab.fecha_planificada || cab.fecha_ejecucion_real
      || (cab.fecha_corte_stock || cab.created_at || '').slice(0, 10)
    if (!f) return null
    const [y, m] = String(f).slice(0, 10).split('-')
    return y && m ? `${y}-${m}` : null
  }
  const cabsFil = cabs.filter(c => {
    if (sucSel !== 'todas' && c.sucursal_codigo !== sucSel) return false
    if (soloCerrados && String(c.estado || '').toUpperCase() !== 'CERRADO') return false
    return true
  })
  const cabById = {}; cabsFil.forEach(c => { cabById[c.id] = c })
  const detsFil = dets.filter(d => cabById[d.inventario_id])

  const meses = [...new Set(cabsFil.map(mesDe).filter(Boolean))].sort()
  const mesLabel = (k) => { const [y, m] = k.split('-'); return `${MES_L[Number(m) - 1]} ${y.slice(2)}` }

  // Matriz tipología × mes
  const vacio = () => ({ lineas: 0, contadas: 0, cuadran: 0, perdida: 0, sobrante: 0, uds: 0, udsF: 0, udsS: 0, sinCosto: 0, valorInv: 0 })
  const mat = {}, totMes = {}, tot = vacio()
  meses.forEach(m => { totMes[m] = vacio() })

  detsFil.forEach(d => {
    const cab = cabById[d.inventario_id]; const m = mesDe(cab); if (!m) return
    const tip = (d.tipo_producto || '(sin tipología)').trim()
    mat[tip] = mat[tip] || {}
    mat[tip][m] = mat[tip][m] || vacio()
    const cel = mat[tip][m], tm = totMes[m]
    const contada = d.stock_fisico !== null && d.stock_fisico !== undefined
    const dif = Number(d.diferencia || 0)
    const cu = Number(d.costo_unitario || 0)
    const val = Math.abs(dif) * cu
    ;[cel, tm, tot].forEach(o => {
      o.lineas++
      o.valorInv += Number(d.total_neto_inventario || 0)
      if (!contada) return
      o.contadas++
      if (dif === 0) { o.cuadran++; return }
      o.uds += dif
      if (dif < 0) o.udsF += Math.abs(dif); else o.udsS += dif
      if (!cu) { o.sinCosto++; return }
      if (dif < 0) o.perdida += val; else o.sobrante += val
    })
  })

  const valorCelda = (c) => {
    if (!c || c.contadas === 0) return null   // sin conteo: no hay dato, no "cero"
    if (metrica === 'balance')   return c.sobrante - c.perdida
    if (metrica === 'merma')     return c.valorInv > 0 ? ((c.perdida - c.sobrante) / c.valorInv * 100) : null
    if (metrica === 'descuadre') return c.valorInv > 0 ? ((c.perdida + c.sobrante) / c.valorInv * 100) : null
    return c.contadas > 0 ? Math.round(c.cuadran / c.contadas * 100) : null
  }

  const fmtCelda = (v) => {
    if (v === null || v === undefined) return '—'
    if (metrica === 'eri')       return v + '%'
    if (metrica === 'merma')     return v === 0 ? '0%' : v.toFixed(1) + '%'
    if (metrica === 'descuadre') return v === 0 ? '0%' : v.toFixed(1) + '%'
    return v === 0 ? '0' : fmtM(v)
  }
  const colorCelda = (v, c) => {
    if (v === null || v === undefined) return '#C7C7CC'
    if (metrica === 'eri')       return v >= 95 ? '#248A3D' : v >= 85 ? '#FF9500' : '#C93400'
    if (metrica === 'merma')     return v <= 0 ? '#248A3D' : v <= 1 ? '#248A3D' : v <= 3 ? '#FF9500' : '#C93400'
    if (metrica === 'descuadre') return v <= 2 ? '#248A3D' : v <= 6 ? '#FF9500' : '#C93400'
    return v > 0 ? '#248A3D' : v < 0 ? '#C93400' : '#8E8E93'   // balance: neto
    void c
  }
  // Celda de la vista BALANCE: faltante y sobrante, cada uno con $ y unidades
  const celdaBalance = (c) => {
    if (!c || c.contadas === 0) return <span style={{ color: '#C7C7CC' }}>—</span>
    const filasB = []
    if (c.perdida > 0 || c.udsF > 0) filasB.push(
      <div key="f" style={{ color: '#C93400', fontWeight: 800, lineHeight: 1.25 }}>
        ▼{c.perdida > 0 ? fmtM(-c.perdida).replace('-', '') : '$0'}
        <span style={{ fontWeight: 600, fontSize: '0.85em', opacity: 0.75 }}> ·{fmtN(c.udsF)}u</span>
      </div>)
    if (c.sobrante > 0 || c.udsS > 0) filasB.push(
      <div key="s" style={{ color: '#248A3D', fontWeight: 800, lineHeight: 1.25 }}>
        ▲{c.sobrante > 0 ? fmtM(c.sobrante) : '$0'}
        <span style={{ fontWeight: 600, fontSize: '0.85em', opacity: 0.75 }}> ·{fmtN(c.udsS)}u</span>
      </div>)
    if (!filasB.length) return <span style={{ color: '#248A3D', fontWeight: 700 }}>0</span>
    return <div>{filasB}</div>
  }


  // Tipologías ordenadas por pérdida acumulada
  const tips = Object.keys(mat).sort((a, b) => {
    const pa = Object.values(mat[a]).reduce((s, c) => s + c.perdida, 0)
    const pb = Object.values(mat[b]).reduce((s, c) => s + c.perdida, 0)
    return pb - pa
  })

  // Comparativo: último mes con dato vs el anterior
  const ultimo = meses[meses.length - 1], previo = meses[meses.length - 2]
  const tendencia = (tip) => {
    if (!ultimo || !previo) return null
    const u = valorCelda(mat[tip]?.[ultimo]), p = valorCelda(mat[tip]?.[previo])
    if (u === null || p === null) return null
    const mejorSiBaja = metrica === 'merma' || metrica === 'descuadre'   // balance/eri mejoran al subir
    const delta = u - p
    if (delta === 0) return { ic: '=', c: '#8E8E93', txt: 'igual' }
    const mejora = mejorSiBaja ? delta < 0 : delta > 0
    return {
      ic: delta > 0 ? '▲' : '▼',
      c: mejora ? '#248A3D' : '#C93400',
      txt: metrica === 'eri' ? `${delta > 0 ? '+' : ''}${delta} pts` : fmtM(delta),
    }
  }

  // ── DIAGNÓSTICO automático por tipología ─────────────────────────────────
  // Lee el patrón bruto/neto/ERI y lo traduce a una causa probable y una acción.
  // Es la lectura que antes había que deducir mirando tres columnas a la vez.
  const diagnosticar = (tip) => {
    const g = Object.values(mat[tip] || {}).reduce((a, c) => ({
      contadas: a.contadas + c.contadas, cuadran: a.cuadran + c.cuadran,
      perdida: a.perdida + c.perdida, sobrante: a.sobrante + c.sobrante,
    }), { contadas: 0, cuadran: 0, perdida: 0, sobrante: 0 })
    if (g.contadas === 0) return { l: 'sin conteo', c: '#C7C7CC', bg: 'transparent', det: 'No se ha contado esta tipología' }
    const eri = g.cuadran / g.contadas * 100
    const compensa = g.perdida > 0 ? g.sobrante / g.perdida : 0
    const netoT = g.sobrante - g.perdida
    if (eri >= 95 && Math.abs(netoT) < 200000)
      return { l: 'SANO', c: '#248A3D', bg: '#34C75912', det: 'Registro confiable, sin desvío relevante' }
    if (compensa >= 0.6)
      return { l: 'ERROR DE SKU', c: '#5856D6', bg: '#5856D615',
               det: `Los sobrantes compensan ${Math.round(compensa * 100)}% de los faltantes: lo que falta en un código aparece en otro. Revisar códigos de barras y variantes parecidas, no la bodega.` }
    if (g.perdida > 0 && compensa < 0.25 && g.perdida >= 500000)
      return { l: 'PÉRDIDA REAL', c: '#C93400', bg: '#FF3B3012',
               det: 'Faltantes sin sobrantes que los expliquen: la mercadería no está. Revisar despachos sin registrar, mermas no declaradas y accesos.' }
    if (eri < 85)
      return { l: 'REGISTRO DÉBIL', c: '#FF9500', bg: '#FF950012',
               det: `Solo ${Math.round(eri)}% de las líneas cuadra, con impacto bajo. Suele ser unidad de medida (metros vs tiras) o conteo apurado.` }
    return { l: 'REVISAR', c: '#8E8E93', bg: '#F7F8FA', det: 'Patrón mixto, conviene mirar el detalle' }
  }

  // ── Sparkline: barras mensuales de la métrica activa, dentro de la fila ──
  const sparkline = (tip) => {
    const vals = meses.map(m => { const v = valorCelda(mat[tip]?.[m]); return v === null ? null : v })
    const conDato = vals.filter(v => v !== null)
    if (conDato.length < 2) return <span style={{ color: '#C7C7CC', fontSize: 10 }}>—</span>
    const max = Math.max(...conDato.map(Math.abs), 1)
    const w = Math.max(40, meses.length * 9), h = 20, bw = w / meses.length
    return (
      <svg width={w} height={h} style={{ display: 'block' }}>
        <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke="#E5E5EA" strokeWidth="1" />
        {vals.map((v, i) => {
          if (v === null) return null
          const alto = Math.max(1.5, Math.abs(v) / max * (h / 2 - 1))
          const arriba = metrica === 'eri' ? true : v > 0
          return (
            <rect key={i} x={i * bw + 1.5} width={Math.max(2, bw - 3)}
              y={arriba ? h / 2 - alto : h / 2} height={alto}
              fill={colorCelda(v, null)} opacity={i === meses.length - 1 ? 1 : 0.55}
              rx="1">
              <title>{`${mesLabel(meses[i])}: ${fmtCelda(v)}`}</title>
            </rect>
          )
        })}
      </svg>
    )
  }

  // Intensidad de fondo tipo mapa de calor, según qué tan grave es la celda
  const fondoCelda = (v, c) => {
    if (v === null || v === undefined || !c || c.contadas === 0) return 'transparent'
    let sev = 0
    if (metrica === 'eri') sev = v >= 95 ? 0 : v >= 85 ? 0.35 : v >= 70 ? 0.6 : 1
    else if (metrica === 'merma' || metrica === 'descuadre') sev = Math.min(1, Math.abs(v) / (metrica === 'descuadre' ? 10 : 5))
    else {
      const maxAbs = Math.max(...Object.values(mat).flatMap(o =>
        Object.values(o).map(x => Math.abs(valorCelda(x) || 0))), 1)
      sev = Math.min(1, Math.abs(v) / maxAbs)
    }
    if (sev < 0.08) return 'transparent'
    const col = colorCelda(v, c)
    const alpha = Math.round(sev * 22)
    return col + (alpha < 16 ? '0' + alpha.toString(16) : alpha.toString(16))
  }

  // KPIs del período
  const eriGlobal = tot.contadas > 0 ? Math.round(tot.cuadran / tot.contadas * 100) : 0
  const cobertura = tot.lineas > 0 ? Math.round(tot.contadas / tot.lineas * 100) : 0
  const neto = tot.sobrante - tot.perdida

  // ── SKUs reincidentes ────────────────────────────────────────────────────
  const porSku = {}
  detsFil.forEach(d => {
    const dif = Number(d.diferencia || 0); if (dif === 0) return
    if (d.stock_fisico === null || d.stock_fisico === undefined) return
    const m = mesDe(cabById[d.inventario_id]); if (!m) return
    const k = d.sku || '(sin sku)'
    porSku[k] = porSku[k] || { sku: k, producto: d.producto, tipo: d.tipo_producto, meses: new Set(), veces: 0, perdida: 0, uds: 0 }
    porSku[k].meses.add(m); porSku[k].veces++
    porSku[k].uds += dif
    if (dif < 0) porSku[k].perdida += Math.abs(dif) * Number(d.costo_unitario || 0)
  })
  const reinc = Object.values(porSku).filter(s => s.meses.size >= 2)
    .sort((a, b) => b.meses.size - a.meses.size || b.perdida - a.perdida)

  // ── Cruce con mermas de BSALE ────────────────────────────────────────────
  const mermaMes = {}
  mermas.forEach(m => {
    if (!m.fecha) return
    if (sucSel !== 'todas' && m.sucursal_codigo !== sucSel) return
    const k = String(m.fecha).slice(0, 7)
    mermaMes[k] = mermaMes[k] || { costo: 0, n: 0 }
    mermaMes[k].costo += Number(m.costo_total || 0); mermaMes[k].n++
  })

  const exportar = async () => {
    const XLSX = await import('xlsx')
    const filas = tips.map(t => {
      const o = { Tipologia: t }
      meses.forEach(m => {
        const c = mat[t][m]
        o[`${mesLabel(m)} faltante$`]  = c ? Math.round(c.perdida) : ''
        o[`${mesLabel(m)} sobrante$`]  = c ? Math.round(c.sobrante) : ''
        o[`${mesLabel(m)} faltanteUds`] = c ? c.udsF : ''
        o[`${mesLabel(m)} sobranteUds`] = c ? c.udsS : ''
        o[`${mesLabel(m)} ERI%`]        = c && c.contadas ? Math.round(c.cuadran / c.contadas * 100) : ''
        o[`${mesLabel(m)} descuadre%`]  = c && c.valorInv > 0 ? Number(((c.perdida + c.sobrante) / c.valorInv * 100).toFixed(1)) : ''
      })
      return o
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Por tipologia')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reinc.map(s => ({
      SKU: s.sku, Producto: s.producto, Tipologia: s.tipo,
      MesesConDiferencia: s.meses.size, Ocurrencias: s.veces,
      PerdidaAcum: Math.round(s.perdida), UnidadesNetas: s.uds,
    }))), 'SKUs reincidentes')
    XLSX.writeFile(wb, `inventario_historico_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const kpi = (l, v, c, sub) => (
    <div style={{ flex: '1 1 150px', padding: '10px 13px', borderRadius: 10, background: c + '0D', border: `1px solid ${c}28` }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, color: c, letterSpacing: '.03em' }}>{l}</div>
      <div style={{ fontSize: 19, fontWeight: 900, color: c, lineHeight: 1.2 }}>{v}</div>
      {sub && <div style={{ fontSize: 10.5, color: '#8E8E93', fontWeight: 600 }}>{sub}</div>}
    </div>
  )

  return (
    <div style={{ padding: 16 }}>
      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 900 }}>📊 Análisis histórico de inventario</div>
          <div style={{ fontSize: 11.5, color: '#8E8E93', fontWeight: 600 }}>
            {cabsFil.length} inventarios · {fmtN(detsFil.length)} líneas · {meses.length} meses con conteo
          </div>
        </div>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
          {verTodo ? (
            <select value={sucSel} onChange={e => setSucSel(e.target.value)} style={{ ...css.select, padding: '6px 9px', fontSize: 12 }}>
              <option value="todas">Todas las sucursales</option>
              {(sucs || []).map(s => <option key={s.codigo} value={s.codigo}>{s.nombre}</option>)}
            </select>
          ) : (
            <span style={{ fontSize: 11.5, fontWeight: 700, color: '#6D6D72',
              background: '#F2F2F7', padding: '5px 11px', borderRadius: 8 }}>
              {(sucs || []).find(s => s.codigo === sucSel)?.nombre || sucSel}
            </span>
          )}
          <label style={{ fontSize: 11.5, display: 'inline-flex', gap: 5, alignItems: 'center', fontWeight: 600, cursor: 'pointer' }}>
            <input type="checkbox" checked={soloCerrados} onChange={e => setSoloCerrados(e.target.checked)} />
            Sólo cerrados
          </label>
          <Bt v="gry" sm onClick={exportar}>⬇ Excel</Bt>
          {onBack && <Bt v="gry" sm onClick={onBack}>← Volver</Bt>}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {kpi('FALTANTE', fmtCLP(tot.perdida), '#C93400', `${fmtN(tot.udsF)} unidades que no están`)}
        {kpi('SOBRANTE', fmtCLP(tot.sobrante), '#248A3D', `${fmtN(tot.udsS)} unidades encontradas de más`)}
        {kpi('RESULTADO NETO', fmtCLP(neto), neto < 0 ? '#C93400' : '#248A3D',
          tot.perdida > 0 && Math.abs(neto) < tot.perdida * 0.5
            ? '⚠ errores que se compensan' : 'variación real')}
        {kpi('DESCUADRE', tot.valorInv > 0 ? ((tot.perdida + tot.sobrante) / tot.valorInv * 100).toFixed(1) + '%' : '—',
          '#5856D6', 'desorden total: faltantes + sobrantes s/ inventario')}
        {kpi('ERI', eriGlobal + '%', eriGlobal >= 95 ? '#248A3D' : eriGlobal >= 85 ? '#FF9500' : '#C93400',
          `${fmtN(tot.cuadran)} de ${fmtN(tot.contadas)} cuadran`)}
        {kpi('COBERTURA', cobertura + '%', cobertura >= 90 ? '#248A3D' : '#FF9500',
          `${fmtN(tot.lineas - tot.contadas)} líneas sin contar`)}
      </div>

      {tot.sinCosto > 0 && (
        <div style={{ padding: '8px 11px', borderRadius: 9, background: '#FF950012', border: '1px solid #FF950030',
          fontSize: 11, color: '#8A5A00', fontWeight: 700, marginBottom: 12 }}>
          ⚠ {fmtN(tot.sinCosto)} líneas con diferencia pero <b>sin costo unitario</b>: no están valorizadas, así que
          la pérdida real es mayor a la mostrada. Conviene completar el costo de esos SKU.
        </div>
      )}

      {/* Pestañas */}
      <div style={{ display: 'inline-flex', background: '#F2F2F7', borderRadius: 9, padding: 2, marginBottom: 10 }}>
        {[['grilla', 'Grilla mensual'], ['reincidentes', `⚠ Reincidentes · ${reinc.length}`], ['mermas', '🔗 Cruce con mermas']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ padding: '5px 13px', borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              background: tab === k ? '#fff' : 'transparent', color: tab === k ? '#1C1C1E' : '#8E8E93' }}>{l}</button>
        ))}
      </div>

      {/* ══ GRILLA MENSUAL ══ */}
      {tab === 'grilla' && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <div style={{ display: 'inline-flex', background: '#F2F2F7', borderRadius: 8, padding: 2 }}>
              {Object.entries(METRICAS).map(([k, v]) => (
                <button key={k} onClick={() => setMetrica(k)} title={v.hint}
                  style={{ padding: '4px 11px', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 800, cursor: 'pointer',
                    background: metrica === k ? '#1a1a2e' : 'transparent', color: metrica === k ? '#fff' : '#6D6D72' }}>{v.l}</button>
              ))}
            </div>
            <span style={{ fontSize: 10.5, color: '#8E8E93', fontWeight: 600 }}>{METRICAS[metrica].hint}</span>
          </div>

          {/* Leyenda simple: qué significa cada cosa que se ve */}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center',
            padding: '7px 11px', borderRadius: 9, background: '#FAFAFC', border: '1px solid #EFEFF4',
            marginBottom: 8, fontSize: 10.5, fontWeight: 600, color: '#6D6D72' }}>
            <span><b style={{ color: '#C93400' }}>rojo</b> = falta mercadería</span>
            <span><b style={{ color: '#248A3D' }}>verde</b> = sobra mercadería</span>
            <span><b style={{ color: '#1C1C1E' }}>0</b> = se contó y cuadra</span>
            <span><b style={{ color: '#C7C7CC' }}>—</b> = no se contó ese mes (no es cero pérdida)</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <span title="Lo que falta en un código aparece en otro. Arreglar códigos de barras y variantes parecidas — la mercadería está.">
                <b style={{ color: '#5856D6' }}>ERROR DE SKU</b> = está, pero mal registrada</span>
              <span title="Faltó y no apareció en ningún otro código. Investigar despachos sin registrar, mermas no declaradas y accesos.">
                <b style={{ color: '#C93400' }}>PÉRDIDA REAL</b> = no está</span>
              <span title="Muchas diferencias pequeñas. Suele ser unidad de medida (metros vs tiras) o conteo apurado.">
                <b style={{ color: '#FF9500' }}>REGISTRO DÉBIL</b> = diferencias chicas frecuentes</span>
            </span>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid #E5E5EA', borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, position: 'sticky', left: 0, background: '#FAFAFC', zIndex: 2, minWidth: 190 }}>TIPOLOGÍA</th>
                  {meses.map(m => {
                    return (
                      <th key={m} style={{ ...th, textAlign: 'right',
                        borderLeft: m === ultimo ? '2px solid #007AFF' : 'none' }}>
                        <span style={{ color: m === ultimo ? '#007AFF' : '#6D6D72' }}>{mesLabel(m)}</span>
                      </th>
                    )
                  })}
                  <th style={{ ...th, textAlign: 'center', minWidth: 60 }}>TENDENCIA</th>
                  <th style={{ ...th, textAlign: 'right', borderLeft: '2px solid #E5E5EA' }}>
                    {ultimo ? `${mesLabel(ultimo)} vs ${previo ? mesLabel(previo) : '—'}` : 'VARIACIÓN'}
                  </th>
                  <th style={{ ...th, minWidth: 130 }}>DIAGNÓSTICO</th>
                </tr>
              </thead>
              <tbody>
                {tips.map(t => {
                  const tn = tendencia(t)
                  return (
                    <tr key={t}>
                      <td style={{ ...td, position: 'sticky', left: 0, background: '#fff', fontWeight: 700,
                        maxWidth: 210, overflow: 'hidden', textOverflow: 'ellipsis' }} title={t}>{t}</td>
                      {meses.map(m => {
                        const c = mat[t][m], v = valorCelda(c)
                        return (
                          <td key={m} style={{ ...td, textAlign: 'right', fontWeight: v ? 700 : 400,
                            color: colorCelda(v, c),
                            fontSize: metrica === 'balance' ? 10 : undefined,
                            background: c ? fondoCelda(v, c) : '#FAFAFC',
                            borderLeft: m === ultimo ? '2px solid #007AFF25' : 'none' }}
                            title={c && c.contadas > 0
                              ? `${fmtN(c.contadas)} líneas contadas · ${fmtN(c.cuadran)} cuadran exacto\nFaltan: ${fmtCLP(c.perdida)} · Sobran: ${fmtCLP(c.sobrante)}\n(la celda muestra el NETO: faltantes y sobrantes se restan)`
                              : 'Esta tipología no se contó este mes'}>
                            {metrica === 'balance' ? celdaBalance(c) : fmtCelda(v)}
                          </td>
                        )
                      })}
                      <td style={{ ...td, textAlign: 'center', padding: '3px 6px' }}>{sparkline(t)}</td>
                      <td style={{ ...td, textAlign: 'right', borderLeft: '2px solid #E5E5EA', fontWeight: 800,
                        color: tn ? tn.c : '#C7C7CC' }}>
                        {tn ? `${tn.ic} ${tn.txt}` : '—'}
                      </td>
                      <td style={{ ...td, padding: '4px 6px' }}>
                        {(() => { const dg = diagnosticar(t); return (
                          <span title={dg.det} style={{ fontSize: 9.5, fontWeight: 900, color: dg.c,
                            background: dg.bg, padding: '3px 8px', borderRadius: 9, cursor: 'help',
                            whiteSpace: 'nowrap', border: `1px solid ${dg.c}30` }}>{dg.l}</span>
                        )})()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: '#FAFAFC', borderTop: '2px solid #E5E5EA' }}>
                  <td style={{ ...td, position: 'sticky', left: 0, background: '#FAFAFC', fontWeight: 900 }}>TOTAL</td>
                  {meses.map(m => {
                    const v = valorCelda(totMes[m])
                    return <td key={m} style={{ ...td, textAlign: 'right', fontWeight: 900, color: colorCelda(v), fontSize: metrica === 'balance' ? 10 : undefined }}>
                      {metrica === 'balance' ? celdaBalance(totMes[m]) : fmtCelda(v)}
                    </td>
                  })}
                  <td style={td}></td>
                  <td style={{ ...td, borderLeft: '2px solid #E5E5EA' }}></td>
                  <td style={td}></td>
                </tr>
                <tr style={{ background: '#FAFAFC' }}>
                  <td style={{ ...td, position: 'sticky', left: 0, background: '#FAFAFC', fontSize: 10, color: '#8E8E93', fontWeight: 700 }}>
                    <span title="Porcentaje del plan de conteo de ESE mes que efectivamente se contó. No es cobertura del catálogo: un mes puede tener 100% habiendo contado sólo las tipologías planificadas — las demás quedan en guión.">
                      % del plan contado ⓘ
                    </span>
                  </td>
                  {meses.map(m => {
                    const c = totMes[m]
                    const cv = c.lineas > 0 ? Math.round(c.contadas / c.lineas * 100) : 0
                    return <td key={m} style={{ ...td, textAlign: 'right', fontSize: 10, fontWeight: 700,
                      color: cv >= 90 ? '#248A3D' : cv >= 60 ? '#FF9500' : '#C93400' }}>{cv}%</td>
                  })}
                  <td style={{ ...td, borderLeft: '2px solid #E5E5EA' }}></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div style={{ fontSize: 10.5, color: '#8E8E93', marginTop: 7, lineHeight: 1.45 }}>
            <b>Cómo leerla:</b> el fondo de cada celda se oscurece según la gravedad, así el problema salta a la
            vista sin leer números. La <b>minigráfica</b> muestra la evolución mes a mes de esa tipología (la última
            barra es el mes más reciente). El <b>DIAGNÓSTICO</b> traduce el patrón a una causa probable —pasa el cursor
            para ver la explicación y qué hacer. Celda gris = no se contó esa tipología ese mes, que no es lo mismo
            que cero pérdida. La fila de cobertura al pie advierte cuándo un mes no es comparable con otro.
          </div>
        </>
      )}

      {/* ══ REINCIDENTES ══ */}
      {tab === 'reincidentes' && (
        <>
          <div style={{ fontSize: 11.5, color: '#6D6D72', marginBottom: 8, lineHeight: 1.45 }}>
            SKUs con diferencia en <b>dos o más meses distintos</b>. Cuando un producto falla mes tras mes ya no
            es azar: suele ser código de barras compartido, productos muy parecidos entre sí, unidad de medida mal
            definida o ubicación confusa en bodega. Atacar estos SKU rinde más que contar más seguido.
          </div>
          <div style={{ overflowX: 'auto', border: '1px solid #E5E5EA', borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>SKU</th><th style={th}>PRODUCTO</th><th style={th}>TIPOLOGÍA</th>
                <th style={{ ...th, textAlign: 'right' }}>MESES CON DIF.</th>
                <th style={{ ...th, textAlign: 'right' }}>VECES</th>
                <th style={{ ...th, textAlign: 'right' }}>UDS NETAS</th>
                <th style={{ ...th, textAlign: 'right' }}>PÉRDIDA ACUM.</th>
              </tr></thead>
              <tbody>
                {reinc.slice(0, 150).map(s => (
                  <tr key={s.sku} style={{ background: s.meses.size >= 4 ? '#FFF9F8' : 'transparent' }}>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 10.5 }}>{s.sku}</td>
                    <td style={{ ...td, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.producto}</td>
                    <td style={{ ...td, fontSize: 10.5, color: '#8E8E93' }}>{s.tipo}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 900,
                      color: s.meses.size >= 4 ? '#C93400' : s.meses.size >= 3 ? '#FF9500' : '#6D6D72' }}>{s.meses.size}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{s.veces}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: s.uds < 0 ? '#C93400' : '#248A3D' }}>{fmtN(s.uds)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{fmtCLP(s.perdida)}</td>
                  </tr>
                ))}
                {reinc.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', padding: 20, color: '#8E8E93' }}>
                  Sin SKUs reincidentes — hace falta más de un mes de conteo para detectarlos.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ══ CRUCE CON MERMAS ══ */}
      {tab === 'mermas' && (
        <>
          <div style={{ fontSize: 11.5, color: '#6D6D72', marginBottom: 8, lineHeight: 1.45 }}>
            La pérdida que detecta el inventario debería estar explicada por las mermas registradas en BSALE.
            Lo que no calza es <b>pérdida sin explicación</b>: mercadería que se fue sin que nadie la diera de baja.
            Es el indicador más directo de fuga o de sub-registro de mermas.
          </div>
          <div style={{ overflowX: 'auto', border: '1px solid #E5E5EA', borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>MES</th>
                <th style={{ ...th, textAlign: 'right' }}>PÉRDIDA INVENTARIO</th>
                <th style={{ ...th, textAlign: 'right' }}>MERMAS BSALE</th>
                <th style={{ ...th, textAlign: 'right' }}>N° MERMAS</th>
                <th style={{ ...th, textAlign: 'right' }}>SIN EXPLICACIÓN</th>
                <th style={{ ...th, textAlign: 'right' }}>% EXPLICADO</th>
              </tr></thead>
              <tbody>
                {meses.map(m => {
                  const inv = totMes[m].perdida
                  const mm = mermaMes[m]?.costo || 0
                  const gap = inv - mm
                  const pct = inv > 0 ? Math.round(Math.min(mm / inv, 9.99) * 100) : null
                  return (
                    <tr key={m}>
                      <td style={{ ...td, fontWeight: 700 }}>{mesLabel(m)}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmtCLP(inv)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{mm ? fmtCLP(mm) : <span style={{ color: '#C7C7CC' }}>sin datos</span>}</td>
                      <td style={{ ...td, textAlign: 'right', color: '#8E8E93' }}>{mermaMes[m]?.n || '—'}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 800,
                        color: gap > 0 ? '#C93400' : '#248A3D' }}>{gap > 0 ? fmtCLP(gap) : '✓'}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 800,
                        color: pct === null ? '#C7C7CC' : pct >= 80 ? '#248A3D' : pct >= 40 ? '#FF9500' : '#C93400' }}>
                        {pct === null ? '—' : pct + '%'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 10.5, color: '#8E8E93', marginTop: 7, lineHeight: 1.45 }}>
            Nota metodológica: el inventario cíclico cubre sólo las tipologías contadas ese mes, mientras las
            mermas de BSALE abarcan todo el catálogo. Por eso el % explicado puede pasar de 100% cuando se
            registraron mermas de productos que ese mes no se contaron. Sirve como señal de orden de magnitud,
            no como cuadratura exacta.
          </div>
        </>
      )}
    </div>
  )
}

export default InvAnalisisHistorico
