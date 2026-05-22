// AnalisisTab.jsx — v3 Dashboard Ejecutivo
// Foco: Cash Conversion (Vendido → Cobrado → Depositado) + brecha BSALE + rentabilidad
// SVG nativo mejorado: grid, axis, tooltips, animaciones, comparativas

import { useEffect, useState, useMemo, useRef } from 'react'
import {
  Loader2, RefreshCw, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2,
  DollarSign, Banknote, Building2, AlertCircle, Clock, ArrowDown
} from 'lucide-react'
import { supabase } from '../../supabase'
import {
  fetchSucursales, fetchUmbrales, fetchKpisMes, fetchCierres,
  fetchVentasBsaleMes, sincronizarCacheFaltante, auditarCoberturaDesdeCache,
  sincronizarRango, sincronizarDia
} from './api'
import { formatCLP, MEDIOS, UMBRALES_DEFAULT, cardSt, TH, TD } from './types'

// ═══════════════════ DESIGN TOKENS ═══════════════════
const C = {
  azul: '#1F4E79', azul2: '#2E6DA4', azulLight: '#DBEAFE',
  verde: '#16A34A', verdeLight: '#DCFCE7',
  rojo: '#DC2626', rojoLight: '#FEE2E2',
  naranja: '#D97706', naranjaLight: '#FEF3C7',
  morado: '#7C3AED', moradoLight: '#EDE9FE',
  gris: '#6B7280', grisLight: '#F3F4F6',
  cyan: '#0891B2', cyanLight: '#CFFAFE',
  text: '#111827', textSec: '#374151', textTer: '#6B7280',
}

const MEDIOS_COLOR = {
  efectivo: C.verde, t_credito: C.azul, t_debito: C.azul2,
  webpay: C.morado, transferencia: C.cyan, m_pago: '#059669',
  abono_cliente: C.naranja, canje: C.rojo, p_clay: '#9333EA', cheque: C.gris,
}

const ESTADO = {
  cuadra: { c: C.verde, bg: C.verdeLight, l: 'Cuadra' },
  tolerable: { c: C.naranja, bg: C.naranjaLight, l: 'Tolerable' },
  descuadre: { c: C.rojo, bg: C.rojoLight, l: 'Descuadre' },
  declarado: { c: C.azul2, bg: C.azulLight, l: 'Pendiente' },
  anulado: { c: C.gris, bg: C.grisLight, l: 'Anulado' },
}

const fmt = n => formatCLP(n ?? 0)
const fmtCompact = n => {
  const abs = Math.abs(n ?? 0)
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}MM`
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${Math.round(n)}`
}
const pct = (a, b) => b ? Math.round((a / b) * 100) : 0
const pct1 = (a, b) => b ? ((a / b) * 100).toFixed(1) : '0.0'
const delta = (now, prev) => prev ? ((now - prev) / Math.abs(prev) * 100) : null

// ═══════════════════ TOOLTIP ═══════════════════
function useTooltip() {
  const [tip, setTip] = useState(null)
  const ref = useRef(null)
  const show = (e, content) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, content })
  }
  const hide = () => setTip(null)
  return { tip, ref, show, hide }
}

function Tooltip({ tip }) {
  if (!tip) return null
  return (
    <div style={{
      position: 'absolute', left: tip.x + 14, top: tip.y - 8, pointerEvents: 'none',
      background: 'rgba(17, 24, 39, 0.95)', color: '#fff', padding: '8px 12px',
      borderRadius: 8, fontSize: 11, zIndex: 10, whiteSpace: 'nowrap',
      boxShadow: '0 8px 24px rgba(0,0,0,0.2)', minWidth: 140
    }}>{tip.content}</div>
  )
}

// ═══════════════════ KPI HERO ═══════════════════
function KpiHero({ label, valor, sub, delta: d, color = C.azul, ic, big = false }) {
  const deltaPos = d != null && d > 0
  const deltaNeg = d != null && d < 0
  return (
    <div style={{
      background: '#fff', borderRadius: 14, padding: big ? '20px 24px' : '16px 20px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.04)',
      display: 'flex', flexDirection: 'column', gap: 6
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.textTer, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
          {ic}{label}
        </div>
        {d != null && (
          <div style={{
            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
            background: deltaPos ? C.verdeLight : deltaNeg ? C.rojoLight : C.grisLight,
            color: deltaPos ? C.verde : deltaNeg ? C.rojo : C.gris,
            display: 'flex', alignItems: 'center', gap: 2
          }}>
            {deltaPos ? <TrendingUp size={9} /> : deltaNeg ? <TrendingDown size={9} /> : null}
            {Math.abs(d).toFixed(1)}%
          </div>
        )}
      </div>
      <div style={{ fontSize: big ? 28 : 22, fontWeight: 800, color, letterSpacing: '-0.03em', lineHeight: 1 }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: C.textTer, marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

// ═══════════════════ AREA CHART ═══════════════════
function AreaChart({ datos, datosPrev, color = C.azul, alto = 200 }) {
  const { tip, ref, show, hide } = useTooltip()
  if (!datos || datos.length < 2) return (
    <div style={{ height: alto, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.gris, fontSize: 11 }}>
      Sin datos suficientes
    </div>
  )
  const padL = 50, padR = 12, padT = 12, padB = 28
  const W = 800, H = alto
  const innerW = W - padL - padR, innerH = H - padT - padB
  const todos = [...datos.map(d => d.v), ...(datosPrev ?? []).map(d => d.v)]
  const max = Math.max(...todos, 0)
  const range = max || 1
  const yTicks = Array.from({ length: 5 }, (_, i) => Math.round((range / 4) * i))
  const x = i => padL + (i / (datos.length - 1)) * innerW
  const y = v => padT + innerH - (v / range) * innerH
  const pathArea = datos.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(d.v)}`).join(' ')
  const areaFill = `${pathArea} L ${x(datos.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`
  let pathPrev = null
  if (datosPrev && datosPrev.length >= 2) {
    pathPrev = datosPrev.map((d, i) => `${i === 0 ? 'M' : 'L'} ${padL + (i / (datosPrev.length - 1)) * innerW} ${y(d.v)}`).join(' ')
  }

  const handleMove = e => {
    const svgRect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - svgRect.left
    const ratio = (px - padL) / innerW
    const idx = Math.round(ratio * (datos.length - 1))
    if (idx >= 0 && idx < datos.length) {
      const d = datos[idx]
      const dPrev = datosPrev?.[idx]
      show(e, (
        <div>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>{d.l}</div>
          <div style={{ fontSize: 11 }}>Actual: <strong>{fmt(d.v)}</strong></div>
          {dPrev && <div style={{ fontSize: 11, color: '#94A3B8' }}>Anterior: {fmt(dPrev.v)}</div>}
        </div>
      ))
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }} onMouseLeave={hide}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }} onMouseMove={handleMove}>
        <defs>
          <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#E5E7EB" strokeWidth="0.5" strokeDasharray={i === 0 ? '0' : '2 3'} />
            <text x={padL - 6} y={y(t) + 3} fill={C.textTer} fontSize="9" textAnchor="end">{fmtCompact(t)}</text>
          </g>
        ))}
        {datos.filter((_, i) => i % Math.max(1, Math.floor(datos.length / 8)) === 0).map((d, i) => {
          const realIdx = datos.indexOf(d)
          return <text key={i} x={x(realIdx)} y={H - padB + 14} fill={C.textTer} fontSize="9" textAnchor="middle">{d.l}</text>
        })}
        {pathPrev && <path d={pathPrev} fill="none" stroke="#94A3B8" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />}
        <path d={areaFill} fill="url(#area-grad)" />
        <path d={pathArea} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

// ═══════════════════ DONUT CHART ═══════════════════
function DonutChart({ datos, totalLabel = 'Total' }) {
  const { tip, ref, show, hide } = useTooltip()
  const total = datos.reduce((s, d) => s + d.valor, 0)
  if (total === 0) return <div style={{ color: C.gris, fontSize: 12, textAlign: 'center', padding: 30 }}>Sin datos</div>
  const cx = 90, cy = 90, rExt = 78, rInt = 50
  let acumulado = 0
  const slices = datos.map(d => {
    const inicio = acumulado / total * 2 * Math.PI
    acumulado += d.valor
    const fin = acumulado / total * 2 * Math.PI
    const largeArc = (fin - inicio) > Math.PI ? 1 : 0
    const x1e = cx + rExt * Math.sin(inicio), y1e = cy - rExt * Math.cos(inicio)
    const x2e = cx + rExt * Math.sin(fin), y2e = cy - rExt * Math.cos(fin)
    const x1i = cx + rInt * Math.sin(fin), y1i = cy - rInt * Math.cos(fin)
    const x2i = cx + rInt * Math.sin(inicio), y2i = cy - rInt * Math.cos(inicio)
    const path = `M ${x1e} ${y1e} A ${rExt} ${rExt} 0 ${largeArc} 1 ${x2e} ${y2e} L ${x1i} ${y1i} A ${rInt} ${rInt} 0 ${largeArc} 0 ${x2i} ${y2i} Z`
    return { ...d, path, pct: d.valor / total * 100 }
  })
  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg width="180" height="180" viewBox="0 0 180 180" style={{ flexShrink: 0 }}>
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill={s.color} stroke="#fff" strokeWidth="2"
            style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
            onMouseMove={e => show(e, <><div style={{ fontWeight: 700 }}>{s.label}</div><div>{fmt(s.valor)} ({s.pct.toFixed(1)}%)</div></>)}
            onMouseEnter={e => e.target.style.opacity = 0.85}
            onMouseLeave={e => { e.target.style.opacity = 1; hide() }}
          />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="10" fill={C.textTer} fontWeight="600">{totalLabel}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="14" fill={C.text} fontWeight="800">{fmtCompact(total)}</text>
      </svg>
      <div style={{ flex: 1, fontSize: 11, display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
        {datos.map(d => (
          <div key={d.key ?? d.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
              <div style={{ width: 10, height: 10, background: d.color, borderRadius: 2, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <span style={{ color: C.textSec, fontWeight: 600 }}>{fmtCompact(d.valor)}</span>
              <span style={{ color: C.gris, fontSize: 10, minWidth: 36, textAlign: 'right' }}>{(d.valor / total * 100).toFixed(1)}%</span>
            </div>
          </div>
        ))}
      </div>
      <Tooltip tip={tip} />
    </div>
  )
}

// ═══════════════════ BARRAS HORIZONTALES ═══════════════════
function BarrasH({ datos, color = C.azul, comparativo = false }) {
  if (!datos || datos.length === 0) return <div style={{ color: C.gris, fontSize: 12 }}>Sin datos</div>
  const max = Math.max(...datos.map(d => d.valor), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {datos.map((d, i) => {
        const w = (d.valor / max * 100).toFixed(1)
        const c = d.color ?? color
        return (
          <div key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: C.textSec, fontWeight: 500 }}>{d.label}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {comparativo && d.delta != null && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: d.delta > 0 ? C.verde : d.delta < 0 ? C.rojo : C.gris }}>
                    {d.delta > 0 ? '↑' : d.delta < 0 ? '↓' : '–'} {Math.abs(d.delta).toFixed(1)}%
                  </span>
                )}
                <span style={{ color: c, fontWeight: 700 }}>{fmtCompact(d.valor)}</span>
              </div>
            </div>
            <div style={{ height: 10, borderRadius: 5, background: '#F3F4F6', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${w}%`, background: `linear-gradient(90deg, ${c}, ${c}cc)`,
                borderRadius: 5, transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)'
              }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════════ CASH FUNNEL ═══════════════════
function CashFunnel({ vendido, cobrado, depositado, conciliado }) {
  const max = Math.max(vendido, cobrado, depositado, conciliado, 1)
  const etapas = [
    { l: 'Vendido (BSALE)', v: vendido, color: C.azul, ic: <DollarSign size={14} /> },
    { l: 'Cobrado (Cierres)', v: cobrado, color: C.cyan, ic: <Banknote size={14} /> },
    { l: 'Depositado (Cartola)', v: depositado, color: C.morado, ic: <Building2 size={14} /> },
    { l: 'Conciliado', v: conciliado, color: C.verde, ic: <CheckCircle2 size={14} /> },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {etapas.map((e, i) => {
        const w = (e.v / max * 100).toFixed(1)
        const prev = i > 0 ? etapas[i - 1].v : null
        const ratio = prev ? (e.v / prev * 100) : null
        const fuga = prev ? prev - e.v : 0
        return (
          <div key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: e.color, fontWeight: 700, fontSize: 13 }}>
                {e.ic}{e.l}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {ratio != null && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                    background: ratio >= 95 ? C.verdeLight : ratio >= 80 ? C.naranjaLight : C.rojoLight,
                    color: ratio >= 95 ? C.verde : ratio >= 80 ? C.naranja : C.rojo
                  }}>{ratio.toFixed(1)}%</span>
                )}
                <span style={{ fontSize: 15, fontWeight: 800, color: e.color }}>{fmt(e.v)}</span>
              </div>
            </div>
            <div style={{ height: 22, borderRadius: 6, background: '#F9FAFB', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${w}%`,
                background: `linear-gradient(90deg, ${e.color}, ${e.color}aa)`,
                borderRadius: 6, transition: 'width 0.8s cubic-bezier(0.4, 0, 0.2, 1)'
              }} />
            </div>
            {fuga > 0 && i > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
                <span style={{ fontSize: 10, color: C.rojo, fontWeight: 600 }}>
                  <ArrowDown size={9} style={{ display: 'inline' }} /> Fuga: {fmtCompact(fuga)}
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════════ HEATMAP CALENDARIO ═══════════════════
function CalendarHeatmap({ cierres, anio, mes }) {
  const { tip, ref, show, hide } = useTooltip()
  const diasMes = new Date(anio, mes, 0).getDate()
  const primerDia = new Date(anio, mes - 1, 1).getDay()
  const porDia = {}
  for (const c of cierres) {
    const d = c.fecha?.slice(8, 10)
    if (!d) continue
    if (!porDia[d]) porDia[d] = []
    porDia[d].push(c)
  }
  const cells = []
  for (let i = 0; i < primerDia; i++) cells.push({ vacio: true })
  for (let d = 1; d <= diasMes; d++) {
    const dd = String(d).padStart(2, '0')
    const lista = porDia[dd] ?? []
    let estado = null, monto = 0
    if (lista.length > 0) {
      monto = lista.reduce((s, c) => s + Number(c.total_declarado ?? 0), 0)
      const hayDesc = lista.some(c => c.estado === 'descuadre')
      const hayTol = lista.some(c => c.estado === 'tolerable')
      const hayDecl = lista.some(c => c.estado === 'declarado')
      const todosCuadran = lista.every(c => c.estado === 'cuadra')
      if (hayDesc) estado = 'descuadre'
      else if (hayTol) estado = 'tolerable'
      else if (hayDecl) estado = 'declarado'
      else if (todosCuadran) estado = 'cuadra'
    }
    const cfg = estado ? ESTADO[estado] : { c: '#D1D5DB', bg: '#F9FAFB', l: 'Sin cierre' }
    cells.push({ dia: d, estado, monto, cfg, n: lista.length })
  }
  return (
    <div ref={ref} style={{ position: 'relative' }} onMouseLeave={hide}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 5, fontSize: 10, color: C.textTer, fontWeight: 700, marginBottom: 5 }}>
        {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(d => <div key={d} style={{ textAlign: 'center' }}>{d}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 5 }}>
        {cells.map((c, i) => {
          if (c.vacio) return <div key={i} />
          return (
            <div key={i}
              onMouseMove={e => show(e, c.estado
                ? <><div style={{ fontWeight: 700 }}>Día {c.dia} — {c.cfg.l}</div><div>{c.n} cierre(s) · {fmt(c.monto)}</div></>
                : `Día ${c.dia} — Sin cierre`)}
              style={{
                background: c.cfg.bg, color: c.cfg.c,
                borderRadius: 8, padding: '8px 4px', textAlign: 'center',
                border: `1.5px solid ${c.estado ? c.cfg.c + '40' : '#E5E7EB'}`,
                aspectRatio: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', transition: 'transform 0.15s'
              }}
              onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
              onMouseOut={e => e.currentTarget.style.transform = 'scale(1)'}
            >
              <div style={{ fontSize: 13, fontWeight: 800 }}>{c.dia}</div>
              {c.n > 0 && <div style={{ fontSize: 8, opacity: 0.7, fontWeight: 600 }}>{c.n}</div>}
            </div>
          )
        })}
      </div>
      <Tooltip tip={tip} />
    </div>
  )
}

// ═══════════════════ MATRIZ VENDEDOR × MEDIO ═══════════════════
function MatrizVendedorMedio({ cierres }) {
  const vendedores = useMemo(() => {
    const map = new Map()
    cierres.forEach(c => {
      if (!c.vendedor_nombre) return
      if (!map.has(c.vendedor_nombre)) {
        map.set(c.vendedor_nombre, MEDIOS.reduce((a, m) => ({ ...a, [m.key]: 0 }), { total: 0 }))
      }
      const v = map.get(c.vendedor_nombre)
      MEDIOS.forEach(m => { v[m.key] += Number(c[m.key] ?? 0) })
      v.total = MEDIOS.reduce((s, m) => s + v[m.key], 0)
    })
    return [...map.entries()].map(([nombre, vals]) => ({ nombre, ...vals }))
      .filter(v => v.total > 0).sort((a, b) => b.total - a.total).slice(0, 10)
  }, [cierres])

  if (vendedores.length === 0) return <div style={{ color: C.gris, fontSize: 12 }}>Sin datos</div>
  const maxTotal = Math.max(...vendedores.map(v => v.total))
  const mediosUsados = MEDIOS.filter(m => vendedores.some(v => v[m.key] > 0))

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead><tr>
          <th style={{ ...TH, textAlign: 'left', minWidth: 130 }}>Vendedor</th>
          {mediosUsados.map(m => <th key={m.key} style={{ ...TH, textAlign: 'right' }}>{m.label}</th>)}
          <th style={{ ...TH, textAlign: 'right', background: '#F0F9FF' }}>Total</th>
        </tr></thead>
        <tbody>
          {vendedores.map((v, i) => (
            <tr key={i} style={{ borderTop: '1px solid #F3F4F6' }}>
              <td style={{ ...TD, fontWeight: 600 }}>{v.nombre}</td>
              {mediosUsados.map(m => {
                const valor = v[m.key]
                const intensidad = valor / maxTotal
                const opacity = valor > 0 ? Math.max(0.1, Math.min(1, intensidad * 4)) : 0
                const color = MEDIOS_COLOR[m.key] ?? C.azul
                return (
                  <td key={m.key} style={{ ...TD, textAlign: 'right',
                    background: valor > 0 ? `${color}${Math.floor(opacity * 255).toString(16).padStart(2, '0').toUpperCase()}` : 'transparent',
                    color: opacity > 0.5 ? '#fff' : C.text, fontWeight: valor > 0 ? 600 : 400
                  }}>{valor > 0 ? fmtCompact(valor) : '—'}</td>
                )
              })}
              <td style={{ ...TD, textAlign: 'right', fontWeight: 700, background: '#F0F9FF' }}>{fmtCompact(v.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════ EXPORTAR RECONCILIACIÓN ═══════════════════
// Genera un CSV descargable con todos los gaps detectados
function exportarReconciliacion(coberturaResumen, sucursales, anio, mes) {
  const sucMap = Object.fromEntries(sucursales.map(s => [s.id, s.nombre]))
  const filas = coberturaResumen.gaps.map(g => ({
    Tipo: g.tipo,
    Fecha: g.fecha,
    Sucursal: sucMap[g.sucursal_id] ?? g.sucursal_id,
    Sucursal_ID: g.sucursal_id,
    Venta_BSALE: Math.round(g.venta_bsale),
    Declarado: Math.round(g.declarado),
    Diferencia: Math.round(g.diferencia),
    Pct_Diferencia: g.pct_diferencia ? (g.pct_diferencia * 100).toFixed(1) + '%' : '',
    N_Vendedores: g.n_vendedores ?? 0,
    Severidad: g.severidad,
    Efectivo_BSALE: Math.round(g.medios?.EFECTIVO ?? 0),
    Credito_BSALE: Math.round(g.medios?.['TARJETA CRÉDITO'] ?? 0),
    Debito_BSALE: Math.round(g.medios?.['TARJETA DÉBITO'] ?? 0),
    Transferencia_BSALE: Math.round(g.medios?.TRANSFERENCIA ?? 0),
    Webpay_BSALE: Math.round(g.medios?.WEBPAY ?? 0),
    Accion: g.tipo === 'SIN_CIERRE'
      ? 'Exigir cierre completo al vendedor'
      : g.tipo === 'SUB_DECLARADO'
        ? 'Revisar declaracion - falta monto'
        : 'Verificar declaracion vs BSALE',
  }))

  if (filas.length === 0) return

  // Convertir a CSV
  const headers = Object.keys(filas[0])
  const csvRows = [
    headers.join(';'),
    ...filas.map(row => headers.map(h => {
      const val = row[h]
      const s = String(val ?? '')
      return s.includes(';') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
    }).join(';'))
  ]
  // Agregar BOM UTF-8 para que Excel respete tildes
  const csv = '\uFEFF' + csvRows.join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `reconciliacion_bsale_${anio}-${String(mes).padStart(2, '0')}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ═══════════════════ ALERT CARD ═══════════════════
function Alert({ severidad, titulo, descripcion, valor, ic }) {
  const cfg = {
    critica: { c: C.rojo, bg: C.rojoLight, border: '#FCA5A5' },
    alta: { c: C.naranja, bg: C.naranjaLight, border: '#FCD34D' },
    media: { c: C.azul, bg: C.azulLight, border: '#93C5FD' },
    info: { c: C.verde, bg: C.verdeLight, border: '#86EFAC' },
  }[severidad] ?? { c: C.gris, bg: C.grisLight, border: '#D1D5DB' }
  return (
    <div style={{
      background: cfg.bg, border: `1px solid ${cfg.border}`, borderLeft: `4px solid ${cfg.c}`,
      borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12
    }}>
      <div style={{ color: cfg.c, flexShrink: 0 }}>{ic ?? <AlertCircle size={16} />}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: cfg.c }}>{titulo}</div>
        <div style={{ fontSize: 11, color: C.textSec, marginTop: 1 }}>{descripcion}</div>
      </div>
      {valor != null && (
        <div style={{ fontSize: 15, fontWeight: 800, color: cfg.c, flexShrink: 0 }}>{valor}</div>
      )}
    </div>
  )
}

// ═══════════════════ COMPONENTE PRINCIPAL ═══════════════════
export function AnalisisTab({ usuario }) {
  const hoy = new Date()
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [mes, setMes] = useState(hoy.getMonth() + 1)
  const [sucursalSel, setSucursalSel] = useState('all')
  const [vista, setVista] = useState('ejecutivo')

  const [sucursales, setSucursales] = useState([])
  const [umbrales, setUmbrales] = useState(UMBRALES_DEFAULT)
  const [cierres, setCierres] = useState([])
  const [cierresMesPrev, setCierresMesPrev] = useState([])
  const [kpis, setKpis] = useState(null)
  const [kpisPrev, setKpisPrev] = useState(null)
  const [depositosBancarios, setDepositosBancarios] = useState({ total: 0, conciliado: 0 })
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState(null)
  const [gapsCobertura, setGapsCobertura] = useState([])
  const [ventasBsaleCache, setVentasBsaleCache] = useState([])
  const [ultimaSync, setUltimaSync] = useState(null)
  const [combosFaltantes, setCombosFaltantes] = useState(0)
  // Modal de sync por rango/día
  const [modalSync, setModalSync] = useState(null) // null | 'dia' | 'rango'
  const [syncDiaInput, setSyncDiaInput] = useState(new Date().toISOString().split('T')[0])
  const [syncDesdeInput, setSyncDesdeInput] = useState(new Date().toISOString().split('T')[0])
  const [syncHastaInput, setSyncHastaInput] = useState(new Date().toISOString().split('T')[0])

  const sucursalEf = sucursalSel === 'all' ? null : sucursalSel
  const mesPrev = mes === 1 ? 12 : mes - 1
  const anioPrev = mes === 1 ? anio - 1 : anio

  useEffect(() => {
    fetchSucursales().then(setSucursales).catch(() => {})
    fetchUmbrales().then(setUmbrales).catch(() => {})
  }, [])

  const cargar = async () => {
    setLoading(true)
    try {
      const desde = `${anio}-${String(mes).padStart(2, '0')}-01`
      const fin = new Date(anio, mes, 0)
      const hasta = `${anio}-${String(mes).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`
      const desdePrev = `${anioPrev}-${String(mesPrev).padStart(2, '0')}-01`
      const finPrev = new Date(anioPrev, mesPrev, 0)
      const hastaPrev = `${anioPrev}-${String(mesPrev).padStart(2, '0')}-${String(finPrev.getDate()).padStart(2, '0')}`

      const cartolaPromise = supabase.from('cartola_bancaria')
        .select('id, fecha, monto, cargo_abono, tipo_auto, tipo_confirmado')
        .gte('fecha', desde).lte('fecha', hasta)
        .eq('cargo_abono', 'A')
        .gt('monto', 0)
        .neq('tipo_auto', 'OTRO')
        .then(r => r.data ?? [])

      const conciliacionPromise = supabase.from('cartola_conciliacion')
        .select('monto_aplicado, cartola_id')
        .then(r => r.data ?? [])

      const [k, c, kPrev, cPrev, cartola, conciliaciones, vbCache, auditoria] = await Promise.all([
        fetchKpisMes({ anio, mes, sucursal_id: sucursalEf }),
        fetchCierres({ sucursal_id: sucursalEf, fecha_desde: desde, fecha_hasta: hasta }),
        fetchKpisMes({ anio: anioPrev, mes: mesPrev, sucursal_id: sucursalEf }),
        fetchCierres({ sucursal_id: sucursalEf, fecha_desde: desdePrev, fecha_hasta: hastaPrev }),
        cartolaPromise,
        conciliacionPromise,
        // Lee cache BSALE — rápido, sin llamadas a la API
        fetchVentasBsaleMes({ anio, mes, sucursal_id: sucursalEf }).catch(() => []),
        // Auditoría desde cache — detecta los 3 tipos de gaps sin llamar BSALE
        auditarCoberturaDesdeCache({ anio, mes, sucursal_id: sucursalEf }).catch(() => ({ gaps: [], totalCache: 0, totalCierres: 0 })),
      ])

      const totalCartola = cartola.reduce((s, r) => s + Number(r.monto ?? 0), 0)
      const idsCartolaMes = new Set(cartola.map(c => c.id))
      const totalConciliadoMes = conciliaciones
        .filter(c => idsCartolaMes.has(c.cartola_id))
        .reduce((s, r) => s + Number(r.monto_aplicado ?? 0), 0)

      // Última sincronización
      const ultima = vbCache.reduce((max, v) => {
        const t = new Date(v.sincronizado_at).getTime()
        return t > max ? t : max
      }, 0)

      setKpis(k); setKpisPrev(kPrev); setCierres(c); setCierresMesPrev(cPrev)
      setDepositosBancarios({ total: totalCartola, conciliado: totalConciliadoMes })
      setVentasBsaleCache(vbCache)
      setGapsCobertura(auditoria.gaps ?? [])
      setUltimaSync(ultima > 0 ? new Date(ultima) : null)
    } catch (e) {
      console.error('[AnalisisTab] cargar', e)
    } finally { setLoading(false) }
  }

  useEffect(() => { cargar() }, [anio, mes, sucursalEf])

  async function handleSync(forzarTodo = false) {
    if (syncing) return
    setSyncing(true)
    setSyncProgress({ actual: 0, total: 0, ok: 0, errores: 0 })
    try {
      const result = await sincronizarCacheFaltante({
        anio, mes, sucursal_id: sucursalEf,
        forzarTodo,
        onProgress: (p) => setSyncProgress(p)
      })
      if (result.total === 0) {
        setSyncProgress({ actual: 0, total: 0, ok: 0, errores: 0, mensaje: '✓ Cache ya está completa' })
      } else {
        setSyncProgress({
          actual: result.total, total: result.total,
          ok: result.ok, errores: result.errores,
          mensaje: result.errores > 0
            ? `Sincronizado con ${result.errores} error(es)`
            : `✓ ${result.ok} día(s) actualizado(s)`
        })
      }
      // Recarga: lee cache nueva + re-audita
      await cargar()
    } catch (e) {
      console.error('[handleSync]', e)
      setSyncProgress({ actual: 0, total: 0, ok: 0, errores: 1, mensaje: 'Error: ' + (e.message ?? 'desconocido') })
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncProgress(null), 6000)
    }
  }

  // Sync por día o rango personalizado
  async function handleSyncCustom() {
    if (syncing) return
    const esDia = modalSync === 'dia'
    const desde = esDia ? syncDiaInput : syncDesdeInput
    const hasta = esDia ? syncDiaInput : syncHastaInput
    if (!desde || !hasta) return
    if (desde > hasta) {
      alert('La fecha desde no puede ser mayor que hasta')
      return
    }
    setModalSync(null)
    setSyncing(true)
    setSyncProgress({ actual: 0, total: 0, ok: 0, errores: 0 })
    try {
      const result = await sincronizarRango({
        fechaDesde: desde, fechaHasta: hasta,
        sucursal_id: sucursalEf,
        onProgress: (p) => setSyncProgress(p)
      })
      setSyncProgress({
        actual: result.total, total: result.total,
        ok: result.ok, errores: result.errores,
        mensaje: result.total === 0
          ? '⚠ Sin días para sincronizar en el rango'
          : result.errores > 0
            ? `Sincronizado con ${result.errores} error(es)`
            : `✓ ${result.ok} de ${result.total} sincronizado(s)`
      })
      await cargar()
    } catch (e) {
      console.error('[handleSyncCustom]', e)
      setSyncProgress({ actual: 0, total: 0, ok: 0, errores: 1, mensaje: 'Error: ' + (e.message ?? 'desconocido') })
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncProgress(null), 6000)
    }
  }

  const resumen = useMemo(() => {
    // Cada fila es un vendedor distinto; total_declarado es SU venta individual
    // → sumar TODAS las filas (sin deduplicar)
    let totalDecl = 0, totalCorr = 0
    const porEstado = { cuadra: 0, tolerable: 0, descuadre: 0, declarado: 0, anulado: 0 }
    cierres.forEach(c => {
      totalDecl += Number(c.total_declarado ?? 0)
      totalCorr += Number(c.total_corroborado ?? 0)
      porEstado[c.estado] = (porEstado[c.estado] ?? 0) + 1
    })
    return { totalDecl, totalCorr, porEstado, n: cierres.length }
  }, [cierres])

  const resumenPrev = useMemo(() => {
    let totalDecl = 0, totalCorr = 0
    cierresMesPrev.forEach(c => {
      totalDecl += Number(c.total_declarado ?? 0)
      totalCorr += Number(c.total_corroborado ?? 0)
    })
    return { totalDecl, totalCorr, n: cierresMesPrev.length }
  }, [cierresMesPrev])

  const funnel = useMemo(() => {
    // VENDIDO REAL = suma de cache BSALE del mes (fuente oficial)
    const vendidoBsale = ventasBsaleCache.reduce((s, v) => s + Number(v.total_venta ?? 0), 0)
    // Total declarado en cierres (lo que el equipo declaró tener)
    const declaradoCierres = cierres.reduce((s, c) => s + Number(c.total_declarado ?? 0), 0)
    // Si no hay cache aún (no sincronizado), fallback a cierres
    const vendido = vendidoBsale > 0 ? vendidoBsale : declaradoCierres

    return {
      vendido,
      vendidoBsale,
      declaradoCierres,
      cobrado: resumen.totalCorr || resumen.totalDecl,
      depositado: depositosBancarios.total,
      conciliado: depositosBancarios.conciliado,
    }
  }, [cierres, resumen, depositosBancarios, ventasBsaleCache])

  const serieDia = useMemo(() => {
    const map = {}
    cierres.forEach(c => {
      const d = c.fecha
      if (!d) return
      map[d] = (map[d] ?? 0) + Number(c.total_declarado ?? 0)
    })
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ l: d.slice(8, 10), v, fecha: d }))
  }, [cierres])

  const serieDiaPrev = useMemo(() => {
    const map = {}
    cierresMesPrev.forEach(c => {
      const d = c.fecha
      if (!d) return
      map[d] = (map[d] ?? 0) + Number(c.total_declarado ?? 0)
    })
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ l: d.slice(8, 10), v }))
  }, [cierresMesPrev])

  const porSucursal = useMemo(() => {
    const map = {}, mapPrev = {}
    cierres.forEach(c => {
      const suc = sucursales.find(s => s.id === c.sucursal_id)
      const nombre = suc?.nombre ?? '—'
      if (!map[nombre]) map[nombre] = { decl: 0, brecha: 0, n: 0, descuadres: 0 }
      map[nombre].decl += Number(c.total_declarado ?? 0)
      map[nombre].brecha += Math.abs(Number(c.diferencia ?? 0))
      map[nombre].n += 1
      if (c.estado === 'descuadre') map[nombre].descuadres += 1
    })
    cierresMesPrev.forEach(c => {
      const suc = sucursales.find(s => s.id === c.sucursal_id)
      const nombre = suc?.nombre ?? '—'
      mapPrev[nombre] = (mapPrev[nombre] ?? 0) + Number(c.total_declarado ?? 0)
    })
    return Object.entries(map).map(([nombre, v]) => ({
      nombre, ...v,
      delta: delta(v.decl, mapPrev[nombre] ?? 0)
    })).sort((a, b) => b.decl - a.decl)
  }, [cierres, cierresMesPrev, sucursales])

  const porVendedor = useMemo(() => {
    const map = {}
    cierres.forEach(c => {
      const nombre = c.vendedor_nombre ?? '—'
      if (!map[nombre]) map[nombre] = { decl: 0, brecha: 0, n: 0, descuadres: 0 }
      map[nombre].decl += Number(c.total_declarado ?? 0)
      map[nombre].brecha += Math.abs(Number(c.diferencia ?? 0))
      map[nombre].n += 1
      if (c.estado === 'descuadre') map[nombre].descuadres += 1
    })
    return Object.entries(map).map(([nombre, v]) => ({ nombre, ...v })).sort((a, b) => b.brecha - a.brecha)
  }, [cierres])

  const mediosPago = useMemo(() => {
    const map = {}
    MEDIOS.forEach(m => { map[m.key] = 0 })
    cierres.forEach(c => {
      MEDIOS.forEach(m => { map[m.key] += Number(c[m.key] ?? 0) })
    })
    return MEDIOS.map(m => ({
      key: m.key, label: m.label, valor: map[m.key],
      color: MEDIOS_COLOR[m.key] ?? C.gris,
    })).filter(m => m.valor > 0).sort((a, b) => b.valor - a.valor)
  }, [cierres])

  const tiempos = useMemo(() => {
    const corroborados = cierres.filter(c => c.declarado_at && c.corroborado_at)
    if (corroborados.length === 0) return { promedio: 0, max: 0, mediana: 0, n: 0 }
    const diffs = corroborados.map(c => {
      const dec = new Date(c.declarado_at).getTime()
      const cor = new Date(c.corroborado_at).getTime()
      return (cor - dec) / (1000 * 60 * 60 * 24)
    }).sort((a, b) => a - b)
    return {
      promedio: diffs.reduce((s, d) => s + d, 0) / diffs.length,
      mediana: diffs[Math.floor(diffs.length / 2)],
      max: diffs[diffs.length - 1],
      n: corroborados.length
    }
  }, [cierres])

  const alertas = useMemo(() => {
    const arr = []
    const pdtes = cierres.filter(c => c.estado === 'declarado').length
    const descs = cierres.filter(c => c.estado === 'descuadre').length
    const brechaVsBsale = kpis?.brechaTotal ?? 0
    const noDepositado = funnel.cobrado - funnel.depositado
    const noConciliado = funnel.depositado - funnel.conciliado

    if (descs > 0) arr.push({ sev: 'critica', titulo: `${descs} descuadre${descs > 1 ? 's' : ''} sin resolver`, desc: 'Diferencias críticas que requieren investigación', valor: fmtCompact(cierres.filter(c => c.estado === 'descuadre').reduce((s, c) => s + Math.abs(c.diferencia ?? 0), 0)), ic: <AlertTriangle size={16} /> })
    if (noDepositado > funnel.cobrado * 0.1) arr.push({ sev: 'alta', titulo: 'Cobranzas sin depositar', desc: `${pct1(noDepositado, funnel.cobrado)}% del cobrado no llegó al banco`, valor: fmtCompact(noDepositado), ic: <Building2 size={16} /> })
    if (noConciliado > funnel.depositado * 0.2) arr.push({ sev: 'alta', titulo: 'Depósitos sin conciliar', desc: `${pct1(noConciliado, funnel.depositado)}% del depositado sin asignar`, valor: fmtCompact(noConciliado), ic: <Clock size={16} /> })
    if (pdtes > 0) arr.push({ sev: 'media', titulo: `${pdtes} cierre${pdtes > 1 ? 's' : ''} pendiente${pdtes > 1 ? 's' : ''} de corroborar`, desc: 'Esperando revisión administrativa', ic: <Clock size={16} /> })
    if (brechaVsBsale > 0) arr.push({ sev: 'media', titulo: 'Brecha BSALE vs Cierres', desc: 'Diferencia entre facturado y declarado', valor: fmtCompact(brechaVsBsale), ic: <AlertCircle size={16} /> })
    if (arr.length === 0) arr.push({ sev: 'info', titulo: 'Todo está en orden ✓', desc: 'No hay alertas críticas en el período', ic: <CheckCircle2 size={16} /> })
    return arr
  }, [cierres, kpis, funnel])

  // ═══ COBERTURA Y BRECHA ESTIMADA — soporta 3 tipos de gap ═══
  const coberturaResumen = useMemo(() => {
    if (gapsCobertura.length === 0) return null

    const ventaNoDeclarada = gapsCobertura.reduce((s, g) => s + (g.diferencia ?? 0), 0)
    const porTipo = { SIN_CIERRE: [], SUB_DECLARADO: [], SOBRE_DECLARADO: [] }
    const porSucursal = {}

    gapsCobertura.forEach(g => {
      // Por tipo
      if (porTipo[g.tipo]) porTipo[g.tipo].push(g)
      // Por sucursal
      if (!porSucursal[g.sucursal_id]) {
        porSucursal[g.sucursal_id] = { dias: 0, diferencia: 0, sin_cierre: 0, sub: 0, sobre: 0 }
      }
      porSucursal[g.sucursal_id].dias += 1
      porSucursal[g.sucursal_id].diferencia += (g.diferencia ?? 0)
      if (g.tipo === 'SIN_CIERRE') porSucursal[g.sucursal_id].sin_cierre += 1
      if (g.tipo === 'SUB_DECLARADO') porSucursal[g.sucursal_id].sub += 1
      if (g.tipo === 'SOBRE_DECLARADO') porSucursal[g.sucursal_id].sobre += 1
    })

    const totalSinCierre = porTipo.SIN_CIERRE.reduce((s, g) => s + g.diferencia, 0)
    const totalSub = porTipo.SUB_DECLARADO.reduce((s, g) => s + g.diferencia, 0)
    const totalSobre = porTipo.SOBRE_DECLARADO.reduce((s, g) => s + g.diferencia, 0)

    return {
      ventaNoDeclarada, porSucursal, gaps: gapsCobertura,
      porTipo, totalSinCierre, totalSub, totalSobre,
    }
  }, [gapsCobertura])

  const ventaTotalEstimada = useMemo(() => {
    return resumen.totalDecl + (coberturaResumen?.ventaNoDeclarada ?? 0)
  }, [resumen.totalDecl, coberturaResumen])

  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  const anios = [hoy.getFullYear() - 1, hoy.getFullYear(), hoy.getFullYear() + 1]
  const nombreSucursal = sucursalSel === 'all' ? 'Todas las sucursales' : (sucursales.find(s => s.id === sucursalSel)?.nombre ?? '—')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      <div style={{
        background: 'linear-gradient(135deg, #1F4E79 0%, #2E6DA4 100%)', borderRadius: 12, padding: '18px 22px',
        color: '#fff', display: 'grid', gridTemplateColumns: '1fr auto auto auto auto auto auto auto', gap: 10, alignItems: 'center'
      }}>
        <div>
          <div style={{ fontSize: 11, opacity: 0.7, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Dashboard Tesorería</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>{meses[mes - 1]} {anio} · {nombreSucursal}</div>
        </div>
        <select value={anio} onChange={e => setAnio(Number(e.target.value))}
          style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', padding: '7px 10px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          {anios.map(a => <option key={a} value={a} style={{ color: C.text }}>{a}</option>)}
        </select>
        <select value={mes} onChange={e => setMes(Number(e.target.value))}
          style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', padding: '7px 10px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          {meses.map((m, i) => <option key={i} value={i + 1} style={{ color: C.text }}>{m}</option>)}
        </select>
        <select value={sucursalSel} onChange={e => setSucursalSel(e.target.value)}
          style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', padding: '7px 10px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', minWidth: 180 }}>
          <option value="all" style={{ color: C.text }}>Todas las sucursales</option>
          {sucursales.map(s => <option key={s.id} value={s.id} style={{ color: C.text }}>{s.nombre}</option>)}
        </select>
        <button onClick={() => handleSync(false)} disabled={syncing || loading} title="Sincroniza solo días faltantes de la cache (rápido)"
          style={{
            background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff',
            padding: '7px 14px', borderRadius: 7, cursor: syncing ? 'wait' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600
          }}>
          {syncing
            ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Sincronizando…</>
            : <>📊 Sincronizar BSALE</>}
        </button>
        <button onClick={() => handleSync(true)} disabled={syncing || loading} title="Forzar re-sincronización completa del mes"
          style={{
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff',
            padding: '7px 10px', borderRadius: 7, cursor: syncing ? 'wait' : 'pointer',
            fontSize: 11, fontWeight: 500, opacity: 0.85
          }}>
          🔄 Todo
        </button>
        <button onClick={() => setModalSync('dia')} disabled={syncing || loading} title="Sincronizar un día específico"
          style={{
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff',
            padding: '7px 10px', borderRadius: 7, cursor: syncing ? 'wait' : 'pointer',
            fontSize: 11, fontWeight: 500, opacity: 0.85
          }}>
          📆 1 día
        </button>
        <button onClick={() => setModalSync('rango')} disabled={syncing || loading} title="Sincronizar un rango personalizado"
          style={{
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff',
            padding: '7px 10px', borderRadius: 7, cursor: syncing ? 'wait' : 'pointer',
            fontSize: 11, fontWeight: 500, opacity: 0.85
          }}>
          📅 Rango
        </button>
        <button onClick={cargar} disabled={loading}
          style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', padding: '7px 10px', borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          {loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />}
        </button>
      </div>

      {/* Progreso de sincronización */}
      {syncProgress && (
        <div style={{
          background: syncProgress.errores > 0 ? C.naranjaLight : C.azulLight,
          border: `1px solid ${syncProgress.errores > 0 ? C.naranja : C.azul}40`,
          borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10
        }}>
          {syncing && <Loader2 size={14} style={{ color: C.azul, animation: 'spin 1s linear infinite' }} />}
          {!syncing && syncProgress.errores === 0 && <CheckCircle2 size={14} style={{ color: C.verde }} />}
          {!syncing && syncProgress.errores > 0 && <AlertCircle size={14} style={{ color: C.naranja }} />}
          <div style={{ flex: 1, fontSize: 12, color: C.textSec }}>
            {syncProgress.mensaje
              ? syncProgress.mensaje
              : syncProgress.total > 0
                ? <>Sincronizando día <strong>{syncProgress.actual}</strong> de <strong>{syncProgress.total}</strong>
                  {syncProgress.errores > 0 && <span style={{ color: C.rojo, marginLeft: 8 }}>({syncProgress.errores} errores)</span>}
                </>
                : 'Iniciando...'}
          </div>
          {syncProgress.total > 0 && (
            <div style={{ width: 120, height: 6, background: '#fff', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                width: `${(syncProgress.actual / syncProgress.total) * 100}%`,
                height: '100%', background: C.azul, transition: 'width 0.3s'
              }} />
            </div>
          )}
        </div>
      )}

      {/* Info de cache */}
      {!loading && ultimaSync && (
        <div style={{ fontSize: 11, color: C.textTer, display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px' }}>
          <Clock size={11} />
          <span>Cache BSALE actualizada: {ultimaSync.toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          <span style={{ color: C.gris }}>· {ventasBsaleCache.length} día(s) en cache</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 0, background: '#fff', borderRadius: 10, padding: '0 12px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        {[
          { k: 'ejecutivo', l: 'Resumen Ejecutivo' },
          { k: 'cashflow', l: 'Cash Flow' },
          { k: 'cuadratura', l: 'Cuadratura' },
          { k: 'medios', l: 'Medios de Pago' },
          { k: 'operacion', l: 'Operación' },
        ].map(t => (
          <button key={t.k} onClick={() => setVista(t.k)} style={{
            padding: '14px 18px', fontSize: 13, fontWeight: 700, background: 'none', border: 'none',
            cursor: 'pointer', color: vista === t.k ? C.azul : C.gris,
            borderBottom: `3px solid ${vista === t.k ? C.azul : 'transparent'}`,
            transition: 'color 0.15s'
          }}>{t.l}</button>
        ))}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <Loader2 size={32} style={{ color: C.azul, animation: 'spin 1s linear infinite' }} />
        </div>
      )}

      {/* ════════ VISTA 1: RESUMEN EJECUTIVO ════════ */}
      {!loading && vista === 'ejecutivo' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: 'fadeIn 0.3s ease' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <KpiHero
              label="Vendido (BSALE)"
              valor={fmt(funnel.vendido)}
              sub={funnel.vendidoBsale > 0
                ? `Fuente: cache BSALE · ${ventasBsaleCache.length} días`
                : `⚠ Sin cache — presiona "Sincronizar"`}
              delta={delta(funnel.vendido, kpisPrev?.ventasBsale)}
              color={C.azul}
              ic={<DollarSign size={12} />}
              big
            />
            <KpiHero label="Cobrado (Cierres)" valor={fmt(funnel.cobrado)} sub={`${pct1(funnel.cobrado, funnel.vendido)}% del facturado`} delta={delta(funnel.cobrado, resumenPrev.totalCorr || resumenPrev.totalDecl)} color={C.cyan} ic={<Banknote size={12} />} big />
            <KpiHero label="Depositado (Cartola)" valor={fmt(funnel.depositado)} sub={`${pct1(funnel.depositado, funnel.cobrado)}% del cobrado en banco`} color={C.morado} ic={<Building2 size={12} />} big />
            <KpiHero label="Conciliado" valor={fmt(funnel.conciliado)} sub={`${pct1(funnel.conciliado, funnel.depositado)}% del banco asignado`} color={C.verde} ic={<CheckCircle2 size={12} />} big />
          </div>

          {/* ALERTAS CRÍTICAS DE COBERTURA — 3 TIPOS */}
          {coberturaResumen && coberturaResumen.gaps.length > 0 && (
            <div style={{
              background: '#FFF7ED', border: '1px solid #FED7AA', borderLeft: '4px solid #EA580C',
              borderRadius: 10, padding: '16px 20px'
            }}>
              {/* Header con totales y botón exportar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                <AlertTriangle size={18} style={{ color: '#EA580C' }} />
                <span style={{ fontSize: 14, fontWeight: 800, color: '#EA580C' }}>
                  🚨 Auditoría de cobertura — {coberturaResumen.gaps.length} gap(s) detectados
                </span>
                <button
                  onClick={() => exportarReconciliacion(coberturaResumen, sucursales, anio, mes)}
                  style={{
                    marginLeft: 'auto', background: '#fff', border: '1px solid #FED7AA', color: '#EA580C',
                    padding: '6px 14px', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 6
                  }}>
                  📥 Exportar Excel reconciliación
                </button>
              </div>

              {/* KPIs por tipo de gap */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
                <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.rojo, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    🔴 Sin cierre declarado
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: C.rojo, marginTop: 4 }}>
                    {fmt(coberturaResumen.totalSinCierre)}
                  </div>
                  <div style={{ fontSize: 10, color: C.rojo }}>
                    {coberturaResumen.porTipo.SIN_CIERRE.length} día(s) sin nadie declarando
                  </div>
                </div>
                <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.naranja, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    🟡 Sub-declarado (BSALE {'>'}  declarado)
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: C.naranja, marginTop: 4 }}>
                    {fmt(coberturaResumen.totalSub)}
                  </div>
                  <div style={{ fontSize: 10, color: C.naranja }}>
                    {coberturaResumen.porTipo.SUB_DECLARADO.length} día(s) con monto faltante
                  </div>
                </div>
                <div style={{ background: '#DBEAFE', border: '1px solid #93C5FD', borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.azul, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    🔵 Sobre-declarado (declarado {'>'} BSALE)
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: C.azul, marginTop: 4 }}>
                    {fmt(coberturaResumen.totalSobre)}
                  </div>
                  <div style={{ fontSize: 10, color: C.azul }}>
                    {coberturaResumen.porTipo.SOBRE_DECLARADO.length} día(s) — revisar
                  </div>
                </div>
              </div>

              {/* Resumen por sucursal */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                {Object.entries(coberturaResumen.porSucursal).map(([suc, v]) => {
                  const nombre = sucursales.find(s => s.id === suc)?.nombre ?? suc
                  return (
                    <div key={suc} style={{ background: '#fff', border: '1px solid #FED7AA', borderRadius: 8, padding: '8px 14px', fontSize: 12 }}>
                      <div style={{ fontWeight: 700, color: '#EA580C' }}>{nombre}</div>
                      <div style={{ color: C.textTer, fontSize: 10, marginTop: 2 }}>
                        {v.sin_cierre > 0 && <span>🔴 {v.sin_cierre} · </span>}
                        {v.sub > 0 && <span>🟡 {v.sub} · </span>}
                        {v.sobre > 0 && <span>🔵 {v.sobre} · </span>}
                        <strong style={{ color: C.rojo }}>{fmtCompact(v.diferencia)}</strong>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Tabla detalle de gaps */}
              <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto', border: '1px solid #FED7AA', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#FFEDD5', zIndex: 1 }}>
                    <tr>
                      <th style={{ ...TH, color: '#EA580C' }}>Tipo</th>
                      <th style={{ ...TH, color: '#EA580C' }}>Fecha</th>
                      <th style={{ ...TH, color: '#EA580C' }}>Sucursal</th>
                      <th style={{ ...TH, textAlign: 'right', color: '#EA580C' }}>BSALE</th>
                      <th style={{ ...TH, textAlign: 'right', color: '#EA580C' }}>Declarado</th>
                      <th style={{ ...TH, textAlign: 'right', color: '#EA580C' }}>Diferencia</th>
                      <th style={{ ...TH, color: '#EA580C' }}>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coberturaResumen.gaps.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia)).map((g, i) => {
                      const nombre = sucursales.find(s => s.id === g.sucursal_id)?.nombre ?? g.sucursal_id
                      const tipoBg = g.tipo === 'SIN_CIERRE' ? '#FEE2E2' : g.tipo === 'SUB_DECLARADO' ? '#FEF3C7' : '#DBEAFE'
                      const tipoCol = g.tipo === 'SIN_CIERRE' ? C.rojo : g.tipo === 'SUB_DECLARADO' ? C.naranja : C.azul
                      const tipoLabel = g.tipo === 'SIN_CIERRE' ? '🔴 Sin cierre' : g.tipo === 'SUB_DECLARADO' ? '🟡 Sub-decl' : '🔵 Sobre-decl'
                      const accion = g.tipo === 'SIN_CIERRE'
                        ? 'Exigir cierre completo al vendedor'
                        : g.tipo === 'SUB_DECLARADO'
                          ? `Revisar — falta ${g.pct_diferencia ? (g.pct_diferencia * 100).toFixed(0) + '%' : ''}`
                          : 'Verificar declaración vs BSALE'
                      return (
                        <tr key={i} style={{ borderTop: '1px solid #FED7AA', background: i % 2 === 0 ? '#FFFBF7' : '#fff' }}>
                          <td style={{ ...TD }}>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: tipoBg, color: tipoCol }}>{tipoLabel}</span>
                          </td>
                          <td style={{ ...TD, fontWeight: 600 }}>{g.fecha}</td>
                          <td style={{ ...TD, fontWeight: 600 }}>{nombre}</td>
                          <td style={{ ...TD, textAlign: 'right' }}>{fmt(g.venta_bsale)}</td>
                          <td style={{ ...TD, textAlign: 'right' }}>{fmt(g.declarado)}</td>
                          <td style={{ ...TD, textAlign: 'right', fontWeight: 800, color: tipoCol }}>{fmt(g.diferencia)}</td>
                          <td style={{ ...TD, fontSize: 10, color: C.textTer }}>{accion}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#FFEDD5', borderTop: '2px solid #FED7AA' }}>
                      <td colSpan={5} style={{ ...TD, fontWeight: 700, color: '#EA580C', textAlign: 'right' }}>
                        Total diferencia detectada
                      </td>
                      <td style={{ ...TD, textAlign: 'right', fontWeight: 800, color: C.rojo }}>
                        {fmt(coberturaResumen.ventaNoDeclarada)}
                      </td>
                      <td style={{ ...TD, fontSize: 11, color: C.textTer }}>
                        Total estimado: <strong>{fmt(ventaTotalEstimada)}</strong>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div style={{ marginTop: 12, fontSize: 11, color: '#92400E', lineHeight: 1.5 }}>
                <strong>Tolerancia:</strong> diferencias menores al 10% se consideran normales (descuentos, redondeos).
                <strong>Sub-declarado</strong> significa que BSALE registra venta mayor a la declarada — investigar si falta cargar algún vendedor.
                <strong>Sobre-declarado</strong> requiere verificar: puede ser error de digitación o ventas duplicadas.
              </div>
            </div>
          )}

          {/* Indicador si ya se auditó y todo está OK */}
          {gapsCobertura.length === 0 && syncProgress?.mensaje?.includes('Sin gaps') && (
            <div style={{ background: C.verdeLight, border: `1px solid ${C.verde}40`, borderRadius: 8, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.verde, fontWeight: 600 }}>
              <CheckCircle2 size={14} /> Cobertura auditada — todos los días con venta tienen cierre declarado
            </div>
          )}


          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12 }}>
            <div style={cardSt}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>Cash Conversion Funnel</div>
              <CashFunnel {...funnel} />
              <div style={{ marginTop: 14, padding: '10px 14px', background: '#F9FAFB', borderRadius: 8, fontSize: 11, color: C.textTer, lineHeight: 1.5 }}>
                <strong style={{ color: C.text }}>Lectura:</strong> De cada $100 facturado en BSALE, $<strong>{pct(funnel.cobrado, funnel.vendido)}</strong> se cobraron, $<strong>{pct(funnel.depositado, funnel.vendido)}</strong> llegaron al banco, y $<strong>{pct(funnel.conciliado, funnel.vendido)}</strong> están conciliados con su origen.
              </div>
            </div>

            <div style={cardSt}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertCircle size={14} /> Alertas priorizadas
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {alertas.slice(0, 5).map((a, i) => <Alert key={i} severidad={a.sev} titulo={a.titulo} descripcion={a.desc} valor={a.valor} ic={a.ic} />)}
              </div>
            </div>
          </div>

          <div style={cardSt}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Tendencia diaria — venta declarada</div>
              <div style={{ display: 'flex', gap: 12, fontSize: 10, color: C.textTer }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 14, height: 2, background: C.azul }} /> {meses[mes - 1]}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 14, height: 0, borderTop: `2px dashed #94A3B8` }} /> {meses[mesPrev - 1]}</div>
              </div>
            </div>
            <AreaChart datos={serieDia} datosPrev={serieDiaPrev} color={C.azul} alto={220} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={cardSt}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>Performance por sucursal</div>
              <BarrasH datos={porSucursal.map((s, i) => ({ label: s.nombre, valor: s.decl, color: [C.azul, C.azul2, C.morado][i % 3], delta: s.delta }))} comparativo />
            </div>
            <div style={cardSt}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>Mix medios de pago</div>
              <DonutChart datos={mediosPago} />
            </div>
          </div>
        </div>
      )}

      {/* ════════ VISTA 2: CASH FLOW ════════ */}
      {!loading && vista === 'cashflow' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: 'fadeIn 0.3s ease' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <KpiHero label="Brecha venta → cobro" valor={fmt(funnel.vendido - funnel.cobrado)} sub={`${pct1(funnel.vendido - funnel.cobrado, funnel.vendido)}% perdido en cobro`} color={(funnel.vendido - funnel.cobrado) > 0 ? C.naranja : C.verde} />
            <KpiHero label="Brecha cobro → banco" valor={fmt(funnel.cobrado - funnel.depositado)} sub="Por depositar a fin de mes" color={(funnel.cobrado - funnel.depositado) > funnel.cobrado * 0.1 ? C.rojo : C.naranja} />
            <KpiHero label="Brecha banco → conciliado" valor={fmt(funnel.depositado - funnel.conciliado)} sub="Movimientos sin clasificar" color={(funnel.depositado - funnel.conciliado) > 0 ? C.naranja : C.verde} />
          </div>

          <div style={cardSt}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>Descomposición del Cash Funnel</div>
            <CashFunnel {...funnel} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={cardSt}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>Eficiencia de cobro por sucursal</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr>
                    <th style={TH}>Sucursal</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Declarado</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Brecha</th>
                    <th style={{ ...TH, textAlign: 'right' }}>vs Mes anterior</th>
                  </tr></thead>
                  <tbody>
                    {porSucursal.map((s, i) => (
                      <tr key={i} style={{ borderTop: '1px solid #F3F4F6' }}>
                        <td style={{ ...TD, fontWeight: 600 }}>{s.nombre}</td>
                        <td style={{ ...TD, textAlign: 'right' }}>{fmt(s.decl)}</td>
                        <td style={{ ...TD, textAlign: 'right', color: s.brecha > 0 ? C.rojo : C.verde, fontWeight: 700 }}>{fmt(s.brecha)}</td>
                        <td style={{ ...TD, textAlign: 'right' }}>
                          {s.delta != null && (
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: s.delta > 0 ? C.verdeLight : C.rojoLight, color: s.delta > 0 ? C.verde : C.rojo }}>
                              {s.delta > 0 ? '↑' : '↓'} {Math.abs(s.delta).toFixed(1)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={cardSt}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>Composición ingresos al banco</div>
              <DonutChart datos={mediosPago.slice(0, 6)} totalLabel="Mes" />
            </div>
          </div>
        </div>
      )}

      {/* ════════ VISTA 3: CUADRATURA ════════ */}
      {!loading && vista === 'cuadratura' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: 'fadeIn 0.3s ease' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <KpiHero label="Cuadran" valor={resumen.porEstado.cuadra} sub={`${pct(resumen.porEstado.cuadra, resumen.n)}% del total`} color={C.verde} />
            <KpiHero label="Tolerables" valor={resumen.porEstado.tolerable} color={C.naranja} />
            <KpiHero label="Descuadres" valor={resumen.porEstado.descuadre} color={C.rojo} />
            <KpiHero label="Pendientes" valor={resumen.porEstado.declarado} color={C.azul2} />
          </div>

          <div style={cardSt}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>Calendario — {meses[mes - 1]} {anio}</div>
            <CalendarHeatmap cierres={cierres} anio={anio} mes={mes} />
            <div style={{ display: 'flex', gap: 14, marginTop: 14, fontSize: 10, color: C.textTer, flexWrap: 'wrap' }}>
              {Object.entries(ESTADO).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 12, height: 12, background: v.bg, border: `1.5px solid ${v.c}`, borderRadius: 3 }} />
                  <span style={{ fontWeight: 600 }}>{v.l}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={cardSt}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>Matriz vendedor × medio de pago (top 10)</div>
            <MatrizVendedorMedio cierres={cierres} />
          </div>

          <div style={cardSt}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>Top descuadres del mes</div>
            {(() => {
              const top = [...cierres].filter(c => Math.abs(c.diferencia ?? 0) > umbrales.cuadra).sort((a, b) => Math.abs(b.diferencia ?? 0) - Math.abs(a.diferencia ?? 0)).slice(0, 10)
              if (top.length === 0) return <div style={{ color: C.verde, fontSize: 13, padding: 20, textAlign: 'center', fontWeight: 600 }}>✓ Sin descuadres relevantes este mes</div>
              return (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr>
                      <th style={TH}>Fecha</th>
                      <th style={TH}>Sucursal</th>
                      <th style={TH}>Vendedor</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Declarado</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Diferencia</th>
                      <th style={TH}>Estado</th>
                    </tr></thead>
                    <tbody>
                      {top.map(c => {
                        const cfg = ESTADO[c.estado] ?? ESTADO.declarado
                        return (
                          <tr key={c.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                            <td style={TD}>{c.fecha}</td>
                            <td style={TD}>{c.sucursal_nombre ?? '—'}</td>
                            <td style={TD}>{c.vendedor_nombre ?? '—'}</td>
                            <td style={{ ...TD, textAlign: 'right' }}>{fmt(c.total_declarado)}</td>
                            <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: c.diferencia > 0 ? C.verde : C.rojo }}>{fmt(c.diferencia)}</td>
                            <td style={TD}>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 10, background: cfg.bg, color: cfg.c }}>{cfg.l}</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* ════════ VISTA 4: MEDIOS DE PAGO ════════ */}
      {!loading && vista === 'medios' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: 'fadeIn 0.3s ease' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={cardSt}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>Distribución por medio</div>
              <BarrasH datos={mediosPago.map(m => ({ label: m.label, valor: m.valor, color: m.color }))} />
            </div>
            <div style={cardSt}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>Composición visual</div>
              <DonutChart datos={mediosPago} totalLabel="Mes" />
            </div>
          </div>

          <div style={cardSt}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>Matriz vendedor × medio de pago</div>
            <MatrizVendedorMedio cierres={cierres} />
          </div>
        </div>
      )}

      {/* ════════ VISTA 5: OPERACIÓN ════════ */}
      {!loading && vista === 'operacion' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: 'fadeIn 0.3s ease' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <KpiHero label="Tiempo promedio corroboración" valor={`${tiempos.promedio.toFixed(1)} días`} sub={`Mediana: ${tiempos.mediana.toFixed(1)}d`} color={tiempos.promedio > 3 ? C.naranja : C.verde} ic={<Clock size={12} />} />
            <KpiHero label="Máximo demorado" valor={`${tiempos.max.toFixed(0)} días`} color={tiempos.max > 7 ? C.rojo : C.naranja} />
            <KpiHero label="Pendientes >2 días" valor={cierres.filter(c => c.estado === 'declarado' && c.declarado_at && (Date.now() - new Date(c.declarado_at)) / 86400000 > 2).length} color={C.naranja} />
            <KpiHero label="Tasa de cuadre" valor={`${pct(resumen.porEstado.cuadra, resumen.n)}%`} sub={`${resumen.porEstado.cuadra}/${resumen.n}`} color={C.verde} />
          </div>

          <div style={cardSt}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>Desempeño de vendedores</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr>
                  <th style={TH}>Vendedor</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Cierres</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Declarado</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Brecha total</th>
                  <th style={{ ...TH, textAlign: 'right' }}>% descuadre</th>
                </tr></thead>
                <tbody>
                  {porVendedor.map((v, i) => {
                    const pctDesc = pct(v.descuadres, v.n)
                    return (
                      <tr key={i} style={{ borderTop: '1px solid #F3F4F6' }}>
                        <td style={{ ...TD, fontWeight: 600 }}>{v.nombre}</td>
                        <td style={{ ...TD, textAlign: 'right' }}>{v.n}</td>
                        <td style={{ ...TD, textAlign: 'right' }}>{fmt(v.decl)}</td>
                        <td style={{ ...TD, textAlign: 'right', color: v.brecha > umbrales.tolerable ? C.rojo : v.brecha > 0 ? C.naranja : C.verde, fontWeight: 700 }}>{fmt(v.brecha)}</td>
                        <td style={{ ...TD, textAlign: 'right' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 10, background: pctDesc > 30 ? C.rojoLight : pctDesc > 10 ? C.naranjaLight : C.verdeLight, color: pctDesc > 30 ? C.rojo : pctDesc > 10 ? C.naranja : C.verde }}>{pctDesc}%</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={cardSt}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>Distribución de estados de cierre</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
              {Object.entries(resumen.porEstado).map(([estado, n]) => {
                const cfg = ESTADO[estado] ?? ESTADO.declarado
                return (
                  <div key={estado} style={{ background: cfg.bg, borderRadius: 10, padding: '14px 16px', border: `1.5px solid ${cfg.c}30` }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: cfg.c, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{cfg.l}</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: cfg.c, marginTop: 6 }}>{n}</div>
                    <div style={{ fontSize: 10, color: cfg.c, opacity: 0.75, fontWeight: 600 }}>{pct(n, resumen.n)}% del total</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* MODAL SYNC PERSONALIZADO */}
      {modalSync && (
        <div onClick={() => setModalSync(null)} style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 12, padding: 24, minWidth: 380,
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
          }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 4 }}>
              {modalSync === 'dia' ? '📆 Sincronizar 1 día' : '📅 Sincronizar rango'}
            </div>
            <div style={{ fontSize: 11, color: C.textTer, marginBottom: 18 }}>
              {modalSync === 'dia'
                ? 'Sincroniza BSALE para una fecha específica (todas las sucursales).'
                : 'Sincroniza BSALE para un rango de fechas. Solo se procesan L-S.'}
            </div>

            {modalSync === 'dia' ? (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: C.textSec, display: 'block', marginBottom: 6 }}>Fecha</label>
                <input
                  type="date"
                  value={syncDiaInput}
                  onChange={e => setSyncDiaInput(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                  style={{
                    width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB',
                    borderRadius: 7, fontSize: 13, fontFamily: 'inherit'
                  }}
                />
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: C.textSec, display: 'block', marginBottom: 6 }}>Desde</label>
                  <input
                    type="date"
                    value={syncDesdeInput}
                    onChange={e => setSyncDesdeInput(e.target.value)}
                    max={new Date().toISOString().split('T')[0]}
                    style={{
                      width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB',
                      borderRadius: 7, fontSize: 13, fontFamily: 'inherit'
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: C.textSec, display: 'block', marginBottom: 6 }}>Hasta</label>
                  <input
                    type="date"
                    value={syncHastaInput}
                    onChange={e => setSyncHastaInput(e.target.value)}
                    max={new Date().toISOString().split('T')[0]}
                    style={{
                      width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB',
                      borderRadius: 7, fontSize: 13, fontFamily: 'inherit'
                    }}
                  />
                </div>
              </div>
            )}

            {/* Shortcuts */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
              {modalSync === 'dia' ? (
                <>
                  <button onClick={() => setSyncDiaInput(new Date().toISOString().split('T')[0])}
                    style={{ fontSize: 11, padding: '4px 10px', background: '#F3F4F6', border: '1px solid #E5E7EB', borderRadius: 5, cursor: 'pointer', fontWeight: 600, color: C.textSec }}>
                    Hoy
                  </button>
                  <button onClick={() => {
                    const ayer = new Date()
                    ayer.setDate(ayer.getDate() - 1)
                    setSyncDiaInput(ayer.toISOString().split('T')[0])
                  }}
                    style={{ fontSize: 11, padding: '4px 10px', background: '#F3F4F6', border: '1px solid #E5E7EB', borderRadius: 5, cursor: 'pointer', fontWeight: 600, color: C.textSec }}>
                    Ayer
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => {
                    const hoyStr = new Date().toISOString().split('T')[0]
                    setSyncDesdeInput(hoyStr)
                    setSyncHastaInput(hoyStr)
                  }}
                    style={{ fontSize: 11, padding: '4px 10px', background: '#F3F4F6', border: '1px solid #E5E7EB', borderRadius: 5, cursor: 'pointer', fontWeight: 600, color: C.textSec }}>
                    Hoy
                  </button>
                  <button onClick={() => {
                    const hoy7 = new Date()
                    const hace7 = new Date()
                    hace7.setDate(hace7.getDate() - 6)
                    setSyncDesdeInput(hace7.toISOString().split('T')[0])
                    setSyncHastaInput(hoy7.toISOString().split('T')[0])
                  }}
                    style={{ fontSize: 11, padding: '4px 10px', background: '#F3F4F6', border: '1px solid #E5E7EB', borderRadius: 5, cursor: 'pointer', fontWeight: 600, color: C.textSec }}>
                    Última semana
                  </button>
                  <button onClick={() => {
                    const hoyMes = new Date()
                    const inicioMes = new Date(hoyMes.getFullYear(), hoyMes.getMonth(), 1)
                    setSyncDesdeInput(inicioMes.toISOString().split('T')[0])
                    setSyncHastaInput(hoyMes.toISOString().split('T')[0])
                  }}
                    style={{ fontSize: 11, padding: '4px 10px', background: '#F3F4F6', border: '1px solid #E5E7EB', borderRadius: 5, cursor: 'pointer', fontWeight: 600, color: C.textSec }}>
                    Este mes
                  </button>
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setModalSync(null)}
                style={{
                  padding: '8px 16px', background: '#F3F4F6', border: '1px solid #E5E7EB',
                  borderRadius: 7, fontSize: 13, fontWeight: 600, color: C.textSec, cursor: 'pointer'
                }}>
                Cancelar
              </button>
              <button onClick={handleSyncCustom}
                style={{
                  padding: '8px 18px', background: C.azul, border: 'none', color: '#fff',
                  borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer'
                }}>
                Sincronizar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
