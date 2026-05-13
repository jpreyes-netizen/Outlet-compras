import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../supabase'

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt  = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)
const fN   = n => new Intl.NumberFormat('es-CL').format(Math.round(n || 0))
const pct  = (a, b) => b ? Math.round((a / b) * 100) : 0

// ── Constantes visuales ───────────────────────────────────────────────────────
const AZUL   = '#1F4E79'
const AZUL2  = '#2E6DA4'
const VERDE  = '#16A34A'
const ROJO   = '#DC2626'
const NARANJA= '#D97706'
const GRIS   = '#6B7280'

const ESTADO_COLOR = {
  cuadra:     { c: VERDE,   bg: '#DCFCE7', l: 'Cuadra'     },
  tolerable:  { c: NARANJA, bg: '#FEF3C7', l: 'Tolerable'  },
  descuadre:  { c: ROJO,    bg: '#FEE2E2', l: 'Descuadre'  },
  declarado:  { c: AZUL2,   bg: '#DBEAFE', l: 'Declarado'  },
  anulado:    { c: GRIS,    bg: '#F3F4F6', l: 'Anulado'    },
}

const MEDIOS = [
  { k: 'efectivo',      l: 'Efectivo',         c: '#16A34A' },
  { k: 't_credito',     l: 'Crédito (Getnet)',  c: '#1F4E79' },
  { k: 't_debito',      l: 'Débito (Webpay)',   c: '#2E6DA4' },
  { k: 'webpay',        l: 'Webpay',            c: '#7C3AED' },
  { k: 'transferencia', l: 'Transferencia',     c: '#0891B2' },
  { k: 'm_pago',        l: 'MercadoPago',       c: '#059669' },
  { k: 'abono_cliente', l: 'Abono cliente',     c: '#D97706' },
  { k: 'canje',         l: 'Canje',             c: '#DC2626' },
  { k: 'p_clay',        l: 'P. Clay',           c: '#9333EA' },
  { k: 'cheque',        l: 'Cheque',            c: '#6B7280' },
]

// ── Componentes internos ──────────────────────────────────────────────────────
function Kpi({ label, valor, sub, color = AZUL, ic }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 12, padding: '16px 20px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.07)', display: 'flex', flexDirection: 'column', gap: 4
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: GRIS, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 5 }}>
        {ic && <span>{ic}</span>}{label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color, letterSpacing: '-0.03em', lineHeight: 1.1 }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: GRIS }}>{sub}</div>}
    </div>
  )
}

function Bd({ children, color = AZUL, bg = '#DBEAFE' }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 100, color, background: bg, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

// Barra horizontal simple
function BarraH({ label, valor, total, color }) {
  const w = total > 0 ? Math.max(2, pct(valor, total)) : 0
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: '#374151', fontWeight: 500 }}>{label}</span>
        <span style={{ color, fontWeight: 700 }}>{fmt(valor)}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: '#F3F4F6', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${w}%`, background: color, borderRadius: 3, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  )
}

// Gráfico de línea simple con SVG
function LineChart({ datos, color = AZUL, alto = 80 }) {
  if (!datos || datos.length < 2) return (
    <div style={{ height: alto, display: 'flex', alignItems: 'center', justifyContent: 'center', color: GRIS, fontSize: 12 }}>Sin datos suficientes</div>
  )
  const ancho = 400
  const max = Math.max(...datos.map(d => d.v), 1)
  const min = Math.min(...datos.map(d => d.v), 0)
  const rango = max - min || 1
  const pts = datos.map((d, i) => {
    const x = (i / (datos.length - 1)) * (ancho - 20) + 10
    const y = alto - 10 - ((d.v - min) / rango) * (alto - 20)
    return `${x},${y}`
  }).join(' ')

  return (
    <div style={{ position: 'relative', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${ancho} ${alto}`} style={{ width: '100%', height: alto }}>
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {datos.map((d, i) => {
          const x = (i / (datos.length - 1)) * (ancho - 20) + 10
          const y = alto - 10 - ((d.v - min) / rango) * (alto - 20)
          return (
            <g key={i}>
              <circle cx={x} cy={y} r="4" fill={color} />
              <title>{d.l}: {fmt(d.v)}</title>
            </g>
          )
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: GRIS, marginTop: 2 }}>
        {datos.map((d, i) => (
          <span key={i} style={{ flex: 1, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.l}</span>
        ))}
      </div>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────
export function AnalisisTab({ usuario }) {
  const [cierres,    setCierres]    = useState([])
  const [sucursales, setSucursales] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)

  // Filtros
  const hoy   = new Date()
  const mesD  = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  const [filMes, setFilMes]  = useState(mesD)
  const [filSuc, setFilSuc]  = useState('todas')

  // Cargar datos
  useEffect(() => {
    async function cargar() {
      setLoading(true)
      setError(null)
      try {
        const [{ data: cs, error: e1 }, { data: ss, error: e2 }] = await Promise.all([
          supabase.from('cierres_caja').select('*').order('fecha', { ascending: false }),
          supabase.from('sucursales').select('id, nombre, codigo').eq('activo', true).order('orden')
        ])
        if (e1) throw e1
        if (e2) throw e2
        setCierres(cs || [])
        setSucursales(ss || [])
      } catch (e) {
        setError(e.message || 'Error al cargar datos')
      } finally {
        setLoading(false)
      }
    }
    cargar()
  }, [])

  // Aplicar filtros
  const filtrados = useMemo(() => {
    return cierres.filter(c => {
      const enMes = filMes ? c.fecha?.startsWith(filMes) : true
      const enSuc = filSuc !== 'todas' ? c.sucursal_id === filSuc : true
      return enMes && enSuc
    })
  }, [cierres, filMes, filSuc])

  // KPIs del período filtrado
  const kpis = useMemo(() => {
    const total       = filtrados.length
    const totalDecl   = filtrados.reduce((s, c) => s + (c.total_declarado || 0), 0)
    const totalCorr   = filtrados.reduce((s, c) => s + (c.total_corroborado || 0), 0)
    const totalBrecha = filtrados.reduce((s, c) => s + Math.abs(c.diferencia || 0), 0)
    const brechaBsale = filtrados.reduce((s, c) => s + Math.abs(c.brecha_bsale || 0), 0)
    const porEstado   = {}
    filtrados.forEach(c => { porEstado[c.estado] = (porEstado[c.estado] || 0) + 1 })
    const descuadres  = (porEstado.descuadre || 0) + (porEstado.tolerable || 0)
    const cuadran     = porEstado.cuadra || 0
    return { total, totalDecl, totalCorr, totalBrecha, brechaBsale, porEstado, descuadres, cuadran }
  }, [filtrados])

  // Serie temporal: total declarado por día (últimos 30 días del filtro)
  const serieTemp = useMemo(() => {
    const map = {}
    filtrados.forEach(c => {
      const d = c.fecha
      if (!d) return
      map[d] = (map[d] || 0) + (c.total_declarado || 0)
    })
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-20)
      .map(([d, v]) => ({ l: d.slice(5), v }))
  }, [filtrados])

  // Distribución por sucursal
  const porSuc = useMemo(() => {
    const map = {}
    filtrados.forEach(c => {
      const suc = sucursales.find(s => s.id === c.sucursal_id)
      const nombre = suc?.nombre || c.sucursal_id || 'Sin sucursal'
      if (!map[nombre]) map[nombre] = { decl: 0, brecha: 0, n: 0 }
      map[nombre].decl   += c.total_declarado || 0
      map[nombre].brecha += Math.abs(c.diferencia || 0)
      map[nombre].n      += 1
    })
    return Object.entries(map).map(([nombre, v]) => ({ nombre, ...v }))
      .sort((a, b) => b.decl - a.decl)
  }, [filtrados, sucursales])

  const totalDecl = porSuc.reduce((s, r) => s + r.decl, 0)

  // Distribución medios de pago
  const mediosPago = useMemo(() => {
    const map = {}
    MEDIOS.forEach(m => { map[m.k] = 0 })
    filtrados.forEach(c => {
      MEDIOS.forEach(m => { map[m.k] += c[m.k] || 0 })
    })
    const total = Object.values(map).reduce((s, v) => s + v, 0)
    return MEDIOS
      .map(m => ({ ...m, valor: map[m.k], pct: total > 0 ? (map[m.k] / total * 100).toFixed(1) : 0 }))
      .filter(m => m.valor > 0)
      .sort((a, b) => b.valor - a.valor)
  }, [filtrados])

  // Top descuadres (peores 10)
  const topDescuadres = useMemo(() => {
    return [...filtrados]
      .filter(c => c.diferencia && Math.abs(c.diferencia) > 0)
      .sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia))
      .slice(0, 10)
  }, [filtrados])

  // ── Meses disponibles para el selector
  const mesesDisp = useMemo(() => {
    const set = new Set()
    cierres.forEach(c => { if (c.fecha) set.add(c.fecha.slice(0, 7)) })
    return [...set].sort().reverse()
  }, [cierres])

  // ── UI ──────────────────────────────────────────────────────────────────────
  const cardSt = { background: '#fff', borderRadius: 12, padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: 16 }
  const TH = { padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: GRIS, letterSpacing: '0.05em', textTransform: 'uppercase', background: '#F9FAFB', whiteSpace: 'nowrap' }
  const TD = { padding: '9px 12px', fontSize: 12, color: '#374151', whiteSpace: 'nowrap', verticalAlign: 'middle' }

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: GRIS, fontSize: 13 }}>Cargando análisis...</div>
  if (error)   return <div style={{ textAlign: 'center', padding: 60, color: ROJO, fontSize: 13 }}>Error: {error}</div>

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif" }}>

      {/* ── Filtros ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: AZUL, marginRight: 4 }}>📊 Análisis Tesorería</div>

        <select
          value={filMes}
          onChange={e => setFilMes(e.target.value)}
          style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 13, color: '#374151', background: '#fff', cursor: 'pointer' }}
        >
          <option value="">Todos los meses</option>
          {mesesDisp.map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        <select
          value={filSuc}
          onChange={e => setFilSuc(e.target.value)}
          style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 13, color: '#374151', background: '#fff', cursor: 'pointer' }}
        >
          <option value="todas">Todas las sucursales</option>
          {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>

        <div style={{ marginLeft: 'auto', fontSize: 12, color: GRIS }}>
          {kpis.total} cierre{kpis.total !== 1 ? 's' : ''} en el período
        </div>
      </div>

      {/* ── KPIs ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
        <Kpi ic="💵" label="Total declarado"   valor={fmt(kpis.totalDecl)}   color={AZUL}    sub={`${kpis.total} cierres`} />
        <Kpi ic="✅" label="Total corroborado" valor={fmt(kpis.totalCorr)}   color={VERDE}   sub="por admin" />
        <Kpi ic="⚖️" label="Brecha acumulada"  valor={fmt(kpis.totalBrecha)} color={kpis.totalBrecha > 50000 ? ROJO : NARANJA} sub="declarado vs corroborado" />
        <Kpi ic="🏦" label="Brecha vs BSALE"   valor={fmt(kpis.brechaBsale)} color={kpis.brechaBsale > 100000 ? ROJO : NARANJA} sub="declarado vs venta API" />
        <Kpi ic="✔️" label="Cuadran"            valor={kpis.cuadran}          color={VERDE}   sub={`de ${kpis.total} cierres`} />
        <Kpi ic="⚠️" label="Descuadres"        valor={kpis.descuadres}       color={kpis.descuadres > 0 ? ROJO : GRIS} sub="tolerable + descuadre" />
      </div>

      {/* ── Estados badge resumen ── */}
      <div style={{ ...cardSt, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: GRIS, marginRight: 4 }}>Estados:</span>
        {Object.entries(kpis.porEstado).map(([est, n]) => {
          const e = ESTADO_COLOR[est] || { c: GRIS, bg: '#F3F4F6', l: est }
          return <Bd key={est} color={e.c} bg={e.bg}>{e.l}: {n}</Bd>
        })}
        {Object.keys(kpis.porEstado).length === 0 && <span style={{ fontSize: 12, color: GRIS }}>Sin cierres en el período</span>}
      </div>

      {/* ── Evolución temporal ── */}
      <div style={cardSt}>
        <div style={{ fontSize: 13, fontWeight: 700, color: AZUL, marginBottom: 12 }}>📈 Evolución diaria — Total declarado</div>
        <LineChart datos={serieTemp} color={AZUL} alto={90} />
      </div>

      {/* ── Sucursales + Medios de pago ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 16 }}>

        {/* Por sucursal */}
        <div style={cardSt}>
          <div style={{ fontSize: 13, fontWeight: 700, color: AZUL, marginBottom: 12 }}>🏢 Por sucursal</div>
          {porSuc.length === 0
            ? <div style={{ fontSize: 12, color: GRIS, textAlign: 'center', padding: '20px 0' }}>Sin datos</div>
            : porSuc.map(s => (
              <div key={s.nombre} style={{ marginBottom: 12 }}>
                <BarraH label={s.nombre} valor={s.decl} total={totalDecl} color={AZUL2} />
                <div style={{ display: 'flex', gap: 10, fontSize: 11, color: GRIS, paddingLeft: 2 }}>
                  <span>{s.n} cierre{s.n !== 1 ? 's' : ''}</span>
                  {s.brecha > 0 && <span style={{ color: s.brecha > 20000 ? ROJO : NARANJA }}>⚠ Brecha {fmt(s.brecha)}</span>}
                </div>
              </div>
            ))
          }
        </div>

        {/* Medios de pago */}
        <div style={cardSt}>
          <div style={{ fontSize: 13, fontWeight: 700, color: AZUL, marginBottom: 12 }}>💳 Medios de pago</div>
          {mediosPago.length === 0
            ? <div style={{ fontSize: 12, color: GRIS, textAlign: 'center', padding: '20px 0' }}>Sin datos</div>
            : mediosPago.map(m => (
              <div key={m.k} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: '#374151', fontWeight: 500 }}>{m.l}</span>
                  <span style={{ color: m.c, fontWeight: 700 }}>{m.pct}% · {fmt(m.valor)}</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: '#F3F4F6', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${m.pct}%`, background: m.c, borderRadius: 3, transition: 'width 0.5s ease' }} />
                </div>
              </div>
            ))
          }
        </div>
      </div>

      {/* ── Top descuadres ── */}
      <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #F3F4F6', fontSize: 13, fontWeight: 700, color: AZUL }}>
          ⚠️ Mayores descuadres del período
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>Fecha</th>
                <th style={TH}>Sucursal</th>
                <th style={{ ...TH, textAlign: 'right' }}>Declarado</th>
                <th style={{ ...TH, textAlign: 'right' }}>Corroborado</th>
                <th style={{ ...TH, textAlign: 'right' }}>Diferencia</th>
                <th style={{ ...TH, textAlign: 'right' }}>Brecha BSALE</th>
                <th style={TH}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {topDescuadres.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...TD, textAlign: 'center', padding: '28px 0', color: GRIS }}>
                    Sin descuadres en el período 🎉
                  </td>
                </tr>
              ) : topDescuadres.map(c => {
                const suc  = sucursales.find(s => s.id === c.sucursal_id)
                const est  = ESTADO_COLOR[c.estado] || { c: GRIS, bg: '#F3F4F6', l: c.estado }
                const dif  = c.diferencia || 0
                return (
                  <tr key={c.id} style={{ borderTop: '1px solid #F9FAFB' }}>
                    <td style={TD}>{c.fecha}</td>
                    <td style={TD}>{suc?.nombre || c.sucursal_id || '—'}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>{fmt(c.total_declarado)}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>{c.total_corroborado ? fmt(c.total_corroborado) : <span style={{ color: GRIS }}>—</span>}</td>
                    <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: Math.abs(dif) > 20000 ? ROJO : NARANJA }}>
                      {dif > 0 ? '+' : ''}{fmt(dif)}
                    </td>
                    <td style={{ ...TD, textAlign: 'right', color: Math.abs(c.brecha_bsale || 0) > 50000 ? ROJO : GRIS }}>
                      {c.brecha_bsale ? fmt(c.brecha_bsale) : '—'}
                    </td>
                    <td style={TD}>
                      <Bd color={est.c} bg={est.bg}>{est.l}</Bd>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
