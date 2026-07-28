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
  if (v === 0) return '—'
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
  perdida: { l: 'PÉRDIDA (bruto)', hint: 'Σ faltantes valorizados — la plata que no está' },
  neto:    { l: 'NETO',            hint: 'Sobrantes − faltantes. Cercano a 0 con pérdida alta = errores que se compensan' },
  eri:     { l: 'ERI %',           hint: 'SKUs que cuadran / SKUs contados — confiabilidad del registro' },
  unidades:{ l: 'UNIDADES',        hint: 'Diferencia en unidades, sin valorizar' },
  pctInv:  { l: '% s/ INVENTARIO',  hint: 'Neto sobre el valor del inventario contado — comparable entre meses de distinta cobertura' },
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
  const [metrica, setMetrica] = useState('perdida')
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
  const vacio = () => ({ lineas: 0, contadas: 0, cuadran: 0, perdida: 0, sobrante: 0, uds: 0, sinCosto: 0, valorInv: 0 })
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
      if (!cu) { o.sinCosto++; return }
      if (dif < 0) o.perdida += val; else o.sobrante += val
    })
  })

  const valorCelda = (c) => {
    if (!c) return null
    if (metrica === 'perdida')  return c.perdida
    if (metrica === 'neto')     return c.sobrante - c.perdida
    if (metrica === 'unidades') return c.uds
    if (metrica === 'pctInv')   return c.valorInv > 0 ? ((c.sobrante - c.perdida) / c.valorInv * 100) : null
    return c.contadas > 0 ? Math.round(c.cuadran / c.contadas * 100) : null
  }
  const fmtCelda = (v) => {
    if (v === null || v === undefined) return '—'
    if (metrica === 'eri')      return v + '%'
    if (metrica === 'unidades') return v === 0 ? '—' : fmtN(v)
    if (metrica === 'pctInv')   return v === 0 ? '—' : v.toFixed(2) + '%'
    return fmtM(v)
  }
  const colorCelda = (v, c) => {
    if (v === null || v === undefined) return '#C7C7CC'
    if (metrica === 'eri')  return v >= 95 ? '#248A3D' : v >= 85 ? '#FF9500' : '#C93400'
    if (metrica === 'neto') return v > 0 ? '#248A3D' : v < 0 ? '#C93400' : '#8E8E93'
    if (metrica === 'unidades') return v < 0 ? '#C93400' : v > 0 ? '#248A3D' : '#8E8E93'
    if (metrica === 'pctInv')   return Math.abs(v) <= 1 ? '#248A3D' : Math.abs(v) <= 3 ? '#FF9500' : '#C93400'
    return v > 0 ? '#C93400' : '#8E8E93'
    void c
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
    const mejorSiBaja = metrica === 'perdida' || metrica === 'unidades'
    const delta = u - p
    if (delta === 0) return { ic: '=', c: '#8E8E93', txt: 'igual' }
    const mejora = mejorSiBaja ? delta < 0 : delta > 0
    return {
      ic: delta > 0 ? '▲' : '▼',
      c: mejora ? '#248A3D' : '#C93400',
      txt: metrica === 'eri' ? `${delta > 0 ? '+' : ''}${delta} pts` : fmtM(delta),
    }
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
        o[`${mesLabel(m)} perdida`] = c ? Math.round(c.perdida) : ''
        o[`${mesLabel(m)} neto`]    = c ? Math.round(c.sobrante - c.perdida) : ''
        o[`${mesLabel(m)} ERI%`]    = c && c.contadas ? Math.round(c.cuadran / c.contadas * 100) : ''
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
        {kpi('PÉRDIDA BRUTA', fmtCLP(tot.perdida), '#C93400', `${fmtN(tot.contadas - tot.cuadran)} líneas con diferencia`)}
        {kpi('SOBRANTE', fmtCLP(tot.sobrante), '#248A3D', 'stock encontrado de más')}
        {kpi('RESULTADO NETO', fmtCLP(neto), neto < 0 ? '#C93400' : '#248A3D',
          tot.perdida > 0 && Math.abs(neto) < tot.perdida * 0.5
            ? '⚠ errores que se compensan' : 'variación real')}
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

          <div style={{ overflowX: 'auto', border: '1px solid #E5E5EA', borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, position: 'sticky', left: 0, background: '#FAFAFC', zIndex: 2, minWidth: 190 }}>TIPOLOGÍA</th>
                  {meses.map(m => <th key={m} style={{ ...th, textAlign: 'right' }}>{mesLabel(m)}</th>)}
                  <th style={{ ...th, textAlign: 'right', borderLeft: '2px solid #E5E5EA' }}>
                    {ultimo ? `${mesLabel(ultimo)} vs ${previo ? mesLabel(previo) : '—'}` : 'TENDENCIA'}
                  </th>
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
                            color: colorCelda(v, c), background: c ? 'transparent' : '#FAFAFC' }}
                            title={c ? `${fmtN(c.contadas)} contadas · ${fmtN(c.cuadran)} cuadran · pérdida ${fmtCLP(c.perdida)} · sobrante ${fmtCLP(c.sobrante)}` : 'sin conteo este mes'}>
                            {fmtCelda(v)}
                          </td>
                        )
                      })}
                      <td style={{ ...td, textAlign: 'right', borderLeft: '2px solid #E5E5EA', fontWeight: 800,
                        color: tn ? tn.c : '#C7C7CC' }}>
                        {tn ? `${tn.ic} ${tn.txt}` : '—'}
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
                    return <td key={m} style={{ ...td, textAlign: 'right', fontWeight: 900, color: colorCelda(v) }}>{fmtCelda(v)}</td>
                  })}
                  <td style={{ ...td, borderLeft: '2px solid #E5E5EA' }}></td>
                </tr>
                <tr style={{ background: '#FAFAFC' }}>
                  <td style={{ ...td, position: 'sticky', left: 0, background: '#FAFAFC', fontSize: 10, color: '#8E8E93', fontWeight: 700 }}>
                    cobertura del mes
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
            Celda gris = no se contó esa tipología ese mes (no es "cero pérdida"). Pasa el cursor por una celda
            para ver líneas contadas, cuántas cuadran, pérdida y sobrante. La fila de cobertura advierte cuándo
            un mes no es comparable con otro.
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
