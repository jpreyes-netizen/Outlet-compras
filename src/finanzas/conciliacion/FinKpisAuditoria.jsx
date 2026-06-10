import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabase'
import { extraerRut } from './types'

/* ═══════════════════════════════════════════════════════════════════
   PANEL KPIs CFO + AUDITORÍA FORENSE
   Indicadores de liquidez, control de proceso, riesgo de concentración
   y detección de anomalías (Benford, duplicados, aging).
   Solo lectura — no modifica ningún dato.
   ═══════════════════════════════════════════════════════════════════ */

const PRIMARY = '#1F4E79'
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function fmtCLP(n) {
  if (n == null || isNaN(n)) return '—'
  return '$' + Math.round(n).toLocaleString('es-CL')
}
function fmtPct(n, dec = 1) {
  if (n == null || isNaN(n)) return '—'
  return n.toFixed(dec) + '%'
}
function fmtNum(n) {
  if (n == null || isNaN(n)) return '—'
  return Math.round(n).toLocaleString('es-CL')
}

// Benford: distribución esperada del primer dígito (1-9)
const BENFORD_ESPERADO = [30.103, 17.609, 12.494, 9.691, 7.918, 6.695, 5.799, 5.115, 4.576]

export function FinKpisAuditoria() {
  const [movs, setMovs] = useState(null)
  const [ventas, setVentas] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const hoy = new Date()
        const hace365 = new Date(hoy.getTime() - 365 * 86400000).toISOString().slice(0, 10)
        const inicioAnio = hoy.getFullYear() + '-01-01'
        const [movR, venR] = await Promise.all([
          supabase.from('movimientos_bancarios')
            .select('fecha, monto, tipo, estado, descripcion, subcuenta_id, tipo_respaldo, saldo')
            .gte('fecha', hace365)
            .order('fecha', { ascending: true })
            .limit(50000),
          supabase.from('ventas_bsale_dia')
            .select('fecha, total_venta')
            .gte('fecha', inicioAnio)
            .limit(20000),
        ])
        if (cancelled) return
        if (movR.error) throw movR.error
        setMovs(movR.data ?? [])
        setVentas(venR.data ?? [])
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const calc = useMemo(() => {
    if (!movs) return null
    const hoy = new Date()
    const hoyISO = hoy.toISOString().slice(0, 10)
    const anioActual = hoy.getFullYear()
    const hace90 = new Date(hoy.getTime() - 90 * 86400000).toISOString().slice(0, 10)

    // Helper: mes de fecha 'YYYY-MM-DD' sin timezone bug
    const mesDe = (s) => parseInt(String(s).split('-')[1], 10)
    const anioDe = (s) => parseInt(String(s).split('-')[0], 10)
    const diasEntre = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000)

    /* ── 1. SALDO ÚLTIMA CARTOLA ───────────────────────────── */
    let saldoActual = null, saldoFecha = null
    for (let i = movs.length - 1; i >= 0; i--) {
      if (movs[i].saldo != null) { saldoActual = Number(movs[i].saldo); saldoFecha = movs[i].fecha; break }
    }

    /* ── 2. GASTO PROMEDIO DIARIO 90d + DÍAS DE CAJA ───────── */
    const cargos90 = movs.filter(m => m.tipo === 'CARGO' && m.fecha >= hace90)
    const gasto90Total = cargos90.reduce((s, m) => s + Math.abs(Number(m.monto) || 0), 0)
    const gastoDiario = gasto90Total / 90
    const diasCaja = saldoActual != null && gastoDiario > 0 ? saldoActual / gastoDiario : null

    /* ── 3. FLUJO NETO 90d ─────────────────────────────────── */
    const abonos90 = movs.filter(m => m.tipo === 'ABONO' && m.fecha >= hace90)
    const ingreso90Total = abonos90.reduce((s, m) => s + Math.abs(Number(m.monto) || 0), 0)
    const flujoNeto90 = ingreso90Total - gasto90Total

    /* ── 4. COBERTURA DE CLASIFICACIÓN ─────────────────────── */
    const totalMovs = movs.length
    const clasificados = movs.filter(m => m.estado === 'clasificado').length
    const pendientes = movs.filter(m => m.estado === 'pendiente')
    const pctClasificado = totalMovs > 0 ? (clasificados / totalMovs) * 100 : 0
    const montoPendiente = pendientes.reduce((s, m) => s + Math.abs(Number(m.monto) || 0), 0)

    /* ── 5. AGING DE PENDIENTES ────────────────────────────── */
    const aging = { '0-7': { n: 0, monto: 0 }, '8-30': { n: 0, monto: 0 }, '31-90': { n: 0, monto: 0 }, '90+': { n: 0, monto: 0 } }
    for (const m of pendientes) {
      const d = diasEntre(m.fecha, hoyISO)
      const monto = Math.abs(Number(m.monto) || 0)
      const bucket = d <= 7 ? '0-7' : d <= 30 ? '8-30' : d <= 90 ? '31-90' : '90+'
      aging[bucket].n += 1
      aging[bucket].monto += monto
    }

    /* ── 6. SERVICIO DE DEUDA (Pago Cuota Crédito) ─────────── */
    const cargosDeuda = movs.filter(m =>
      m.tipo === 'CARGO' && /pago\s+cuota\s+cr[eé]dito/i.test(m.descripcion || '')
    )
    const deuda12m = cargosDeuda.reduce((s, m) => s + Math.abs(Number(m.monto) || 0), 0)
    const cargos12mTotal = movs.filter(m => m.tipo === 'CARGO').reduce((s, m) => s + Math.abs(Number(m.monto) || 0), 0)
    const pctDeuda = cargos12mTotal > 0 ? (deuda12m / cargos12mTotal) * 100 : 0

    /* ── 7. CONCENTRACIÓN DE PROVEEDORES (top 10) ──────────── */
    const porProveedor = new Map()
    for (const m of movs) {
      if (m.tipo !== 'CARGO') continue
      const desc = m.descripcion || ''
      const rut = extraerRut(desc)
      // Label legible: lo que viene tras "Transf a " (o descripción truncada)
      let label = desc
      const idx = desc.toUpperCase().indexOf('TRANSF A ')
      if (idx >= 0) label = desc.slice(idx + 9).trim()
      const key = rut || label.toUpperCase().slice(0, 30)
      if (!key) continue
      if (!porProveedor.has(key)) porProveedor.set(key, { label, rut, total: 0, n: 0 })
      const p = porProveedor.get(key)
      p.total += Math.abs(Number(m.monto) || 0)
      p.n += 1
    }
    const proveedores = Array.from(porProveedor.values()).sort((a, b) => b.total - a.total)
    const top10 = proveedores.slice(0, 10)
    const top5Total = proveedores.slice(0, 5).reduce((s, p) => s + p.total, 0)
    const pctTop5 = cargos12mTotal > 0 ? (top5Total / cargos12mTotal) * 100 : 0

    /* ── 8. LEY DE BENFORD sobre cargos ────────────────────── */
    const digitos = new Array(9).fill(0)
    let nBenford = 0
    for (const m of movs) {
      if (m.tipo !== 'CARGO') continue
      const monto = Math.abs(Number(m.monto) || 0)
      if (monto < 1000) continue  // ruido de micro-montos
      const d = parseInt(String(Math.floor(monto))[0], 10)
      if (d >= 1 && d <= 9) { digitos[d - 1] += 1; nBenford += 1 }
    }
    const benfordObs = digitos.map(c => nBenford > 0 ? (c / nBenford) * 100 : 0)
    // MAD (Mean Absolute Deviation) en proporciones — criterios Nigrini
    const mad = benfordObs.reduce((s, obs, i) => s + Math.abs(obs - BENFORD_ESPERADO[i]), 0) / 9 / 100
    const benfordVeredicto =
      mad <= 0.006 ? { nivel: 'verde', label: 'Conformidad estrecha', detalle: 'Distribución natural, sin señales de manipulación' } :
      mad <= 0.012 ? { nivel: 'verde', label: 'Conformidad aceptable', detalle: 'Dentro del rango esperado para datos reales' } :
      mad <= 0.015 ? { nivel: 'amarillo', label: 'Conformidad marginal', detalle: 'Revisar categorías con montos repetitivos' } :
                     { nivel: 'rojo', label: 'No conforme', detalle: 'Desviación significativa — revisar montos redondos o repetidos' }

    /* ── 9. POSIBLES DOBLES PAGOS ──────────────────────────── */
    // Mismo RUT + mismo |monto| en días DISTINTOS dentro de 7 días.
    // (Mismo día se excluye: multi-transferencias intencionales son práctica habitual en Outlet)
    const porClave = new Map()
    for (const m of movs) {
      if (m.tipo !== 'CARGO') continue
      const rut = extraerRut(m.descripcion || '')
      if (!rut) continue
      const monto = Math.abs(Number(m.monto) || 0)
      if (monto < 50000) continue  // umbral de materialidad
      const key = rut + '|' + monto
      if (!porClave.has(key)) porClave.set(key, [])
      porClave.get(key).push(m)
    }
    const dobles = []
    for (const [key, lista] of porClave) {
      if (lista.length < 2) continue
      const fechas = [...new Set(lista.map(m => m.fecha))].sort()
      for (let i = 0; i < fechas.length - 1; i++) {
        const diff = diasEntre(fechas[i], fechas[i + 1])
        if (diff >= 1 && diff <= 7) {
          const ejemplo = lista.find(m => m.fecha === fechas[i])
          dobles.push({
            descripcion: ejemplo.descripcion,
            monto: Math.abs(Number(ejemplo.monto)),
            fecha1: fechas[i],
            fecha2: fechas[i + 1],
            diffDias: diff,
          })
        }
      }
    }
    dobles.sort((a, b) => b.monto - a.monto)

    /* ── 10. FLOAT GETNET (venta → abono real) ─────────────── */
    const floats = []
    const getnetPorMes = {}
    for (const m of movs) {
      if (m.tipo !== 'ABONO') continue
      const match = (m.descripcion || '').match(/GETNET\s+(\d{2})\/(\d{2})\/(\d{2})/)
      if (!match) continue
      const fechaVenta = `20${match[3]}-${match[2]}-${match[1]}`
      const dias = diasEntre(fechaVenta, m.fecha)
      if (dias >= 0 && dias <= 15) floats.push(dias)
      const mesAbono = mesDe(m.fecha)
      if (anioDe(m.fecha) === anioActual) {
        getnetPorMes[mesAbono] = (getnetPorMes[mesAbono] ?? 0) + Math.abs(Number(m.monto) || 0)
      }
    }
    const floatPromedio = floats.length > 0 ? floats.reduce((s, d) => s + d, 0) / floats.length : null
    const floatMax = floats.length > 0 ? Math.max(...floats) : null

    /* ── 11. RECONCILIACIÓN BSALE vs BANCO (año actual) ────── */
    const ventasPorMes = {}
    for (const v of (ventas ?? [])) {
      if (anioDe(v.fecha) !== anioActual) continue
      const mes = mesDe(v.fecha)
      ventasPorMes[mes] = (ventasPorMes[mes] ?? 0) + Number(v.total_venta || 0)
    }
    const abonosPorMes = {}
    for (const m of movs) {
      if (m.tipo !== 'ABONO') continue
      if (anioDe(m.fecha) !== anioActual) continue
      const mes = mesDe(m.fecha)
      abonosPorMes[mes] = (abonosPorMes[mes] ?? 0) + Math.abs(Number(m.monto) || 0)
    }
    const mesActual = hoy.getMonth() + 1
    const reconciliacion = []
    for (let mes = 1; mes <= mesActual; mes++) {
      const v = ventasPorMes[mes] ?? 0
      const a = abonosPorMes[mes] ?? 0
      if (v === 0 && a === 0) continue
      reconciliacion.push({ mes, ventas: v, abonos: a, ratio: v > 0 ? (a / v) * 100 : null })
    }

    return {
      saldoActual, saldoFecha, gastoDiario, diasCaja, flujoNeto90,
      ingreso90Total, gasto90Total,
      pctClasificado, totalMovs, clasificados, nPendientes: pendientes.length, montoPendiente,
      aging, deuda12m, pctDeuda, cargos12mTotal,
      top10, pctTop5,
      benfordObs, mad, benfordVeredicto, nBenford,
      dobles: dobles.slice(0, 15),
      floatPromedio, floatMax, nFloats: floats.length,
      reconciliacion,
    }
  }, [movs, ventas])

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#6B7280', fontSize: 13 }}>Calculando indicadores…</div>
  if (error) return <div style={{ padding: 40, color: '#DC2626', fontSize: 13 }}>Error: {error}</div>
  if (!calc) return null

  const semColor = (nivel) =>
    nivel === 'verde' ? { bg: '#ECFDF5', border: '#10B981', text: '#047857' } :
    nivel === 'amarillo' ? { bg: '#FFFBEB', border: '#F59E0B', text: '#B45309' } :
    { bg: '#FEF2F2', border: '#EF4444', text: '#B91C1C' }

  const diasCajaNivel = calc.diasCaja == null ? 'amarillo' : calc.diasCaja >= 30 ? 'verde' : calc.diasCaja >= 15 ? 'amarillo' : 'rojo'
  const clasifNivel = calc.pctClasificado >= 95 ? 'verde' : calc.pctClasificado >= 85 ? 'amarillo' : 'rojo'
  const concNivel = calc.pctTop5 <= 40 ? 'verde' : calc.pctTop5 <= 60 ? 'amarillo' : 'rojo'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ─── FILA 1: KPIs DE LIQUIDEZ Y PROCESO ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        <KpiCard
          titulo="Saldo última cartola"
          valor={fmtCLP(calc.saldoActual)}
          sub={calc.saldoFecha ? `al ${calc.saldoFecha}` : 'sin dato de saldo'}
          nivel={calc.saldoActual == null ? 'amarillo' : calc.saldoActual > 0 ? 'verde' : 'rojo'}
        />
        <KpiCard
          titulo="Días de caja"
          valor={calc.diasCaja != null ? fmtNum(calc.diasCaja) + ' días' : '—'}
          sub={`Gasto diario prom. 90d: ${fmtCLP(calc.gastoDiario)}`}
          nivel={diasCajaNivel}
          tip="Saldo actual ÷ gasto promedio diario. Benchmark sano: ≥30 días."
        />
        <KpiCard
          titulo="Flujo neto 90 días"
          valor={(calc.flujoNeto90 >= 0 ? '+' : '') + fmtCLP(calc.flujoNeto90)}
          sub={`Ing ${fmtCLP(calc.ingreso90Total)} − Egr ${fmtCLP(calc.gasto90Total)}`}
          nivel={calc.flujoNeto90 >= 0 ? 'verde' : 'rojo'}
        />
        <KpiCard
          titulo="Cobertura clasificación"
          valor={fmtPct(calc.pctClasificado)}
          sub={`${calc.nPendientes} pendientes · ${fmtCLP(calc.montoPendiente)}`}
          nivel={clasifNivel}
          tip="Movs clasificados / total últimos 12 meses. Meta: ≥95%."
        />
        <KpiCard
          titulo="Servicio de deuda 12m"
          valor={fmtPct(calc.pctDeuda)}
          sub={`${fmtCLP(calc.deuda12m)} en cuotas de crédito`}
          nivel={calc.pctDeuda <= 10 ? 'verde' : calc.pctDeuda <= 20 ? 'amarillo' : 'rojo'}
          tip="% de los egresos totales destinado a pago de créditos."
        />
      </div>

      {/* ─── FILA 2: AGING DE PENDIENTES ─── */}
      <Seccion titulo="⏳ Aging de movimientos sin clasificar" sub="Cuánto tiempo llevan los pendientes sin categoría. Pendientes >30 días degradan la confiabilidad del EERR.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {Object.entries(calc.aging).map(([bucket, v]) => {
            const critico = (bucket === '31-90' || bucket === '90+') && v.n > 0
            return (
              <div key={bucket} style={{
                background: critico ? '#FEF2F2' : '#F9FAFB',
                border: '1px solid ' + (critico ? '#FCA5A5' : '#E5E7EB'),
                borderRadius: 8, padding: '10px 14px',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: critico ? '#991B1B' : '#6B7280' }}>{bucket} días</div>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', color: '#111827' }}>{v.n}</div>
                <div style={{ fontSize: 11, color: '#6B7280' }}>{fmtCLP(v.monto)}</div>
              </div>
            )
          })}
        </div>
      </Seccion>

      {/* ─── FILA 3: POSIBLES DOBLES PAGOS ─── */}
      <Seccion
        titulo="🚨 Posibles dobles pagos"
        sub="Mismo RUT + mismo monto en días distintos dentro de 7 días (≥$50.000). Las multi-transferencias del mismo día se excluyen porque son práctica habitual. Revisar caso a caso — pueden ser legítimos (cuotas, pagos parciales iguales).">
        {calc.dobles.length === 0
          ? <div style={{ fontSize: 12, color: '#15803D', fontWeight: 600 }}>✓ Sin coincidencias sospechosas en los últimos 12 meses</div>
          : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #E5E7EB', textAlign: 'left' }}>
                  <th style={TH}>Descripción</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Monto</th>
                  <th style={TH}>Fecha 1</th>
                  <th style={TH}>Fecha 2</th>
                  <th style={{ ...TH, textAlign: 'center' }}>Δ días</th>
                </tr>
              </thead>
              <tbody>
                {calc.dobles.map((d, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ ...TD, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.descripcion}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#DC2626' }}>{fmtCLP(d.monto)}</td>
                    <td style={TD}>{d.fecha1}</td>
                    <td style={TD}>{d.fecha2}</td>
                    <td style={{ ...TD, textAlign: 'center' }}>{d.diffDias}</td>
                  </tr>
                ))}
              </tbody>
            </table>
        }
      </Seccion>

      {/* ─── FILA 4: LEY DE BENFORD ─── */}
      <Seccion
        titulo="🔬 Ley de Benford — análisis forense de montos"
        sub={`Distribución del primer dígito de los egresos (n=${fmtNum(calc.nBenford)}). En datos financieros naturales, el 1 aparece ~30% de las veces. Desviaciones fuertes pueden indicar montos inventados, redondeados o fraccionados. Es la técnica que usan auditores forenses y el SII.`}>
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 420px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 140, padding: '0 4px' }}>
              {calc.benfordObs.map((obs, i) => {
                const esp = BENFORD_ESPERADO[i]
                const maxV = 32
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                    <div style={{ fontSize: 9, color: '#6B7280', fontFamily: 'monospace' }}>{obs.toFixed(1)}</div>
                    <div style={{ width: '100%', display: 'flex', gap: 2, alignItems: 'flex-end', height: 100 }}>
                      <div title={`Observado: ${obs.toFixed(1)}%`} style={{ flex: 1, height: `${(obs / maxV) * 100}%`, background: PRIMARY, borderRadius: '3px 3px 0 0' }} />
                      <div title={`Benford esperado: ${esp.toFixed(1)}%`} style={{ flex: 1, height: `${(esp / maxV) * 100}%`, background: '#CBD5E1', borderRadius: '3px 3px 0 0' }} />
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#374151' }}>{i + 1}</div>
                  </div>
                )
              })}
            </div>
            <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 6, display: 'flex', gap: 14 }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: PRIMARY, borderRadius: 2, marginRight: 4 }} />Observado</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#CBD5E1', borderRadius: 2, marginRight: 4 }} />Benford teórico</span>
            </div>
          </div>
          <div style={{
            flex: '0 1 260px',
            ...(() => { const c = semColor(calc.benfordVeredicto.nivel); return { background: c.bg, border: '1.5px solid ' + c.border, borderRadius: 10, padding: '14px 16px' } })(),
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: semColor(calc.benfordVeredicto.nivel).text }}>
              {calc.benfordVeredicto.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: '#111827', margin: '4px 0' }}>
              MAD {(calc.mad * 100).toFixed(2)}%
            </div>
            <div style={{ fontSize: 11, color: '#374151', lineHeight: 1.5 }}>{calc.benfordVeredicto.detalle}</div>
            <div style={{ fontSize: 10, color: '#6B7280', marginTop: 6 }}>
              Criterios Nigrini: ≤0.6% estrecha · ≤1.2% aceptable · ≤1.5% marginal · &gt;1.5% no conforme
            </div>
          </div>
        </div>
      </Seccion>

      {/* ─── FILA 5: CONCENTRACIÓN DE PROVEEDORES ─── */}
      <Seccion
        titulo="🏭 Concentración de proveedores (12 meses)"
        sub={`Top 5 concentra ${fmtPct(calc.pctTop5)} de los egresos. Sobre 60% es riesgo alto de dependencia: una falla de un proveedor crítico afecta la operación completa.`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {calc.top10.map((p, i) => {
            const pct = calc.cargos12mTotal > 0 ? (p.total / calc.cargos12mTotal) * 100 : 0
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 18, fontSize: 11, fontWeight: 700, color: '#9CA3AF', textAlign: 'right' }}>{i + 1}</div>
                <div style={{ flex: '0 0 240px', fontSize: 12, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflowEllipsis: 'ellipsis', textOverflow: 'ellipsis' }} title={p.label}>
                  {p.label}{p.rut ? <span style={{ color: '#9CA3AF', fontSize: 10 }}> · {p.rut}</span> : null}
                </div>
                <div style={{ flex: 1, height: 16, background: '#F3F4F6', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(pct * 3.3, 100)}%`, background: i < 5 ? PRIMARY : '#94A3B8', borderRadius: 4 }} />
                </div>
                <div style={{ flex: '0 0 110px', fontSize: 12, fontFamily: 'monospace', fontWeight: 600, textAlign: 'right' }}>{fmtCLP(p.total)}</div>
                <div style={{ flex: '0 0 48px', fontSize: 11, color: '#6B7280', textAlign: 'right' }}>{fmtPct(pct)}</div>
                <div style={{ flex: '0 0 50px', fontSize: 10, color: '#9CA3AF', textAlign: 'right' }}>{p.n} movs</div>
              </div>
            )
          })}
        </div>
      </Seccion>

      {/* ─── FILA 6: FLOAT GETNET + RECONCILIACIÓN BSALE ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(340px, 2fr)', gap: 16 }}>
        <Seccion
          titulo="💳 Float GETNET"
          sub="Días entre la venta (fecha en la glosa del banco) y el abono real en cuenta. Cada día de float es capital de trabajo inmovilizado.">
          <div style={{ display: 'flex', gap: 14 }}>
            <div style={{ flex: 1, background: '#F9FAFB', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 600 }}>Promedio</div>
              <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'monospace', color: PRIMARY }}>
                {calc.floatPromedio != null ? calc.floatPromedio.toFixed(1) : '—'}
              </div>
              <div style={{ fontSize: 10, color: '#9CA3AF' }}>días</div>
            </div>
            <div style={{ flex: 1, background: '#F9FAFB', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 600 }}>Máximo</div>
              <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'monospace', color: calc.floatMax > 4 ? '#DC2626' : '#111827' }}>
                {calc.floatMax ?? '—'}
              </div>
              <div style={{ fontSize: 10, color: '#9CA3AF' }}>días · n={calc.nFloats}</div>
            </div>
          </div>
        </Seccion>

        <Seccion
          titulo="🔄 Ventas BSALE vs abonos banco (año actual)"
          sub="Ratio banco/ventas por mes. La utilidad está en la TENDENCIA: una caída brusca del ratio indica ventas que no están llegando al banco (efectivo sin depositar, fuga). El ratio no es 100% porque el banco incluye otros abonos y hay desfase de float.">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #E5E7EB', textAlign: 'left' }}>
                <th style={TH}>Mes</th>
                <th style={{ ...TH, textAlign: 'right' }}>Ventas BSALE</th>
                <th style={{ ...TH, textAlign: 'right' }}>Abonos banco</th>
                <th style={{ ...TH, textAlign: 'right' }}>Ratio</th>
              </tr>
            </thead>
            <tbody>
              {calc.reconciliacion.map(r => {
                const ratioColor = r.ratio == null ? '#6B7280' : r.ratio >= 90 ? '#15803D' : r.ratio >= 75 ? '#B45309' : '#DC2626'
                return (
                  <tr key={r.mes} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ ...TD, fontWeight: 600 }}>{MESES[r.mes - 1]}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{fmtCLP(r.ventas)}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{fmtCLP(r.abonos)}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: ratioColor }}>
                      {r.ratio != null ? fmtPct(r.ratio, 0) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Seccion>
      </div>

      <div style={{ fontSize: 10, color: '#9CA3AF', textAlign: 'center', padding: '4px 0 10px' }}>
        Panel de solo lectura · Ventana de análisis: últimos 12 meses · Los indicadores se recalculan al abrir el tab
      </div>
    </div>
  )
}

/* ─── Componentes auxiliares ─── */

const TH = { padding: '6px 8px', fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em' }
const TD = { padding: '6px 8px', color: '#374151' }

function KpiCard({ titulo, valor, sub, nivel, tip }) {
  const c = nivel === 'verde' ? { border: '#10B981', label: '#047857' }
        : nivel === 'amarillo' ? { border: '#F59E0B', label: '#B45309' }
        : { border: '#EF4444', label: '#B91C1C' }
  return (
    <div title={tip || ''} style={{
      background: '#fff', border: '1px solid #E5E7EB', borderLeft: '4px solid ' + c.border,
      borderRadius: 10, padding: '12px 14px',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
        {titulo}
      </div>
      <div style={{ fontSize: 19, fontWeight: 700, fontFamily: 'monospace', color: '#111827' }}>{valor}</div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 3 }}>{sub}</div>
    </div>
  )
}

function Seccion({ titulo, sub, children }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #F3F4F6', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', padding: '16px 18px' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 2 }}>{titulo}</div>
      {sub && <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 12, lineHeight: 1.5, maxWidth: 900 }}>{sub}</div>}
      {children}
    </div>
  )
}
