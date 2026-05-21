// AnalisisTab.jsx — Dashboard ejecutivo unificado (reemplaza AnalisisTab + CuadraturaTab)
import { useEffect, useState, useMemo } from 'react'
import { Loader2, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, DollarSign, CreditCard, RefreshCw } from 'lucide-react'
import { supabase } from '../../supabase'
import { fetchSucursales, fetchUmbrales, fetchKpisMes, fetchCierres, fetchCuadraturasMes } from './api'
import { formatCLP, MEDIOS, UMBRALES_DEFAULT, cardSt, selectSt, labelSt, TH, TD } from './types'

// ── Constantes visuales ───────────────────────────────────────────────────
const AZUL = '#1F4E79', AZUL2 = '#2E6DA4', VERDE = '#16A34A', ROJO = '#DC2626'
const NARANJA = '#D97706', GRIS = '#6B7280', MORADO = '#7C3AED'

const fmt = n => formatCLP(n ?? 0)
const fN = n => new Intl.NumberFormat('es-CL').format(Math.round(n || 0))
const pct = (a, b) => b ? Math.round((a / b) * 100) : 0

const MEDIOS_COLOR = {
  efectivo: VERDE,
  t_credito: AZUL,
  t_debito: AZUL2,
  webpay: MORADO,
  transferencia: '#0891B2',
  m_pago: '#059669',
  abono_cliente: NARANJA,
  canje: ROJO,
  p_clay: '#9333EA',
  cheque: GRIS,
}

const ESTADO_COLOR = {
  cuadra: { c: VERDE, bg: '#DCFCE7', l: 'Cuadra' },
  tolerable: { c: NARANJA, bg: '#FEF3C7', l: 'Tolerable' },
  descuadre: { c: ROJO, bg: '#FEE2E2', l: 'Descuadre' },
  declarado: { c: AZUL2, bg: '#DBEAFE', l: 'Declarado' },
  anulado: { c: GRIS, bg: '#F3F4F6', l: 'Anulado' },
}

// ── Subcomponentes UI ─────────────────────────────────────────────────────
function Kpi({ label, valor, sub, color = AZUL, ic, hint }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: '14px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: GRIS, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 5 }}>
        {ic}{label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color, letterSpacing: '-0.02em', marginTop: 4 }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: GRIS, marginTop: 2 }}>{sub}</div>}
      {hint && <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

function BarraH({ label, valor, total, color }) {
  const w = total > 0 ? Math.max(2, pct(valor, total)) : 0
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: '#374151', fontWeight: 500 }}>{label}</span>
        <span style={{ color, fontWeight: 700 }}>{fmt(valor)} <span style={{ color: GRIS, fontSize: 10, fontWeight: 500 }}>({w}%)</span></span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: '#F3F4F6', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${w}%`, background: color, borderRadius: 4, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  )
}

function LineChart({ datos, color = AZUL, alto = 80 }) {
  if (!datos || datos.length < 2) {
    return <div style={{ height: alto, display: 'flex', alignItems: 'center', justifyContent: 'center', color: GRIS, fontSize: 11 }}>Sin datos suficientes</div>
  }
  const max = Math.max(...datos.map(d => d.v))
  const min = Math.min(...datos.map(d => d.v))
  const range = max - min || 1
  const w = 100, h = alto
  const step = w / (datos.length - 1)
  const points = datos.map((d, i) => `${i * step},${h - ((d.v - min) / range) * (h - 10) - 5}`).join(' ')
  return (
    <svg width="100%" height={alto} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="0.6" />
      {datos.map((d, i) => (
        <circle key={i} cx={i * step} cy={h - ((d.v - min) / range) * (h - 10) - 5} r="0.8" fill={color} />
      ))}
    </svg>
  )
}

// Heatmap de calendario: días del mes coloreados por estado del cierre
function CalendarHeatmap({ cierres, anio, mes, umbrales }) {
  const diasMes = new Date(anio, mes, 0).getDate()
  const primerDia = new Date(anio, mes - 1, 1).getDay() // 0 = domingo
  const cells = []

  // Espacios vacíos antes del primer día
  for (let i = 0; i < primerDia; i++) cells.push({ vacio: true })

  // Agrupar cierres por día
  const porDia = {}
  for (const c of cierres) {
    const d = c.fecha?.slice(8, 10)
    if (!d) continue
    if (!porDia[d]) porDia[d] = []
    porDia[d].push(c)
  }

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
    const cfg = estado ? ESTADO_COLOR[estado] : { c: '#9CA3AF', bg: '#F9FAFB', l: 'Sin' }
    cells.push({ dia: d, estado, monto, cfg, n: lista.length })
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, fontSize: 10, color: GRIS, fontWeight: 600, marginBottom: 4 }}>
        {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(d => <div key={d} style={{ textAlign: 'center' }}>{d}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {cells.map((c, i) => {
          if (c.vacio) return <div key={i} />
          return (
            <div key={i} title={c.estado ? `Día ${c.dia} — ${c.cfg.l} · ${fmt(c.monto)}` : `Día ${c.dia} — Sin cierre`}
              style={{
                background: c.cfg.bg, color: c.cfg.c,
                borderRadius: 6, padding: '6px 4px', textAlign: 'center', fontSize: 11, fontWeight: 600,
                border: `1px solid ${c.estado ? c.cfg.c + '40' : '#E5E7EB'}`,
                aspectRatio: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'help'
              }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{c.dia}</div>
              {c.n > 0 && <div style={{ fontSize: 8, opacity: 0.7 }}>{c.n}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────
export function AnalisisTab({ usuario }) {
  const hoy = new Date()
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [mes, setMes] = useState(hoy.getMonth() + 1)
  const [sucursalSel, setSucursalSel] = useState('all')
  const [vista, setVista] = useState('resumen') // resumen | cuadratura | medios | operacion

  const [sucursales, setSucursales] = useState([])
  const [umbrales, setUmbrales] = useState(UMBRALES_DEFAULT)
  const [cierres, setCierres] = useState([])
  const [kpis, setKpis] = useState(null)
  const [analisisMedios, setAnalisisMedios] = useState([])
  const [cuadraturas, setCuadraturas] = useState([])
  const [loading, setLoading] = useState(true)

  const sucursalEf = sucursalSel === 'all' ? null : sucursalSel

  // ── Carga inicial catálogos ────────────────────────────────────────────
  useEffect(() => {
    fetchSucursales().then(setSucursales).catch(() => {})
    fetchUmbrales().then(setUmbrales).catch(() => {})
  }, [])

  // ── Carga datos del período ────────────────────────────────────────────
  const cargar = async () => {
    setLoading(true)
    try {
      const desde = `${anio}-${String(mes).padStart(2, '0')}-01`
      const fin = new Date(anio, mes, 0)
      const hasta = `${anio}-${String(mes).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`

      const [k, c, m, cu] = await Promise.all([
        fetchKpisMes({ anio, mes, sucursal_id: sucursalEf }),
        fetchCierres({ sucursal_id: sucursalEf, fecha_desde: desde, fecha_hasta: hasta }),
        supabase.from('v_analisis_medios_pago').select('*').then(r => r.data ?? []).catch(() => []),
        fetchCuadraturasMes({ anio, mes, sucursal_id: sucursalEf }).catch(() => []),
      ])
      setKpis(k)
      setCierres(c)
      setAnalisisMedios(m)
      setCuadraturas(cu)
    } catch (e) {
      console.error('[AnalisisTab] cargar', e)
    } finally { setLoading(false) }
  }

  useEffect(() => { cargar() }, [anio, mes, sucursalEf])

  // ── Cálculos derivados ─────────────────────────────────────────────────

  const resumen = useMemo(() => {
    const totalDecl = cierres.reduce((s, c) => s + Number(c.total_declarado ?? 0), 0)
    const totalCorr = cierres.reduce((s, c) => s + Number(c.total_corroborado ?? 0), 0)
    const brechaCorrob = cierres.reduce((s, c) => s + Math.abs(Number(c.diferencia ?? 0)), 0)
    const brechaBsale = cierres.reduce((s, c) => s + Math.abs(Number(c.brecha_bsale ?? 0)), 0)
    const porEstado = { cuadra: 0, tolerable: 0, descuadre: 0, declarado: 0, anulado: 0 }
    cierres.forEach(c => { porEstado[c.estado] = (porEstado[c.estado] ?? 0) + 1 })
    return { totalDecl, totalCorr, brechaCorrob, brechaBsale, porEstado, n: cierres.length }
  }, [cierres])

  const serieDia = useMemo(() => {
    const map = {}
    cierres.forEach(c => {
      const d = c.fecha
      if (!d) return
      map[d] = (map[d] ?? 0) + Number(c.total_declarado ?? 0)
    })
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ l: d.slice(5), v }))
  }, [cierres])

  const porSucursal = useMemo(() => {
    const map = {}
    cierres.forEach(c => {
      const suc = sucursales.find(s => s.id === c.sucursal_id)
      const nombre = suc?.nombre ?? c.sucursal_id ?? '—'
      if (!map[nombre]) map[nombre] = { decl: 0, corr: 0, brecha: 0, n: 0, descuadres: 0 }
      map[nombre].decl += Number(c.total_declarado ?? 0)
      map[nombre].corr += Number(c.total_corroborado ?? 0)
      map[nombre].brecha += Math.abs(Number(c.diferencia ?? 0))
      map[nombre].n += 1
      if (c.estado === 'descuadre') map[nombre].descuadres += 1
    })
    return Object.entries(map).map(([nombre, v]) => ({ nombre, ...v })).sort((a, b) => b.decl - a.decl)
  }, [cierres, sucursales])

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
    const total = Object.values(map).reduce((s, v) => s + v, 0)
    return MEDIOS.map(m => ({
      key: m.key, label: m.label, valor: map[m.key],
      color: MEDIOS_COLOR[m.key] ?? GRIS,
      pct: total > 0 ? (map[m.key] / total * 100) : 0
    })).filter(m => m.valor > 0).sort((a, b) => b.valor - a.valor)
  }, [cierres])

  const topDescuadres = useMemo(() => {
    return [...cierres]
      .filter(c => c.diferencia && Math.abs(c.diferencia) > umbrales.cuadra)
      .sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia))
      .slice(0, 10)
  }, [cierres, umbrales])

  // Tiempos de corroboración
  const tiempos = useMemo(() => {
    const corroborados = cierres.filter(c => c.declarado_at && c.corroborado_at)
    if (corroborados.length === 0) return { promedio: 0, max: 0, mediana: 0, n: 0 }
    const diffs = corroborados.map(c => {
      const dec = new Date(c.declarado_at).getTime()
      const cor = new Date(c.corroborado_at).getTime()
      return (cor - dec) / (1000 * 60 * 60 * 24)
    }).sort((a, b) => a - b)
    const promedio = diffs.reduce((s, d) => s + d, 0) / diffs.length
    const mediana = diffs[Math.floor(diffs.length / 2)]
    const max = diffs[diffs.length - 1]
    return { promedio, mediana, max, n: corroborados.length }
  }, [cierres])

  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  const anios = [hoy.getFullYear() - 1, hoy.getFullYear(), hoy.getFullYear() + 1]

  // ── Vistas ─────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Filtros globales */}
      <div style={{ ...cardSt, padding: '14px 18px', marginBottom: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr auto', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={labelSt}>Año</label>
            <select style={selectSt} value={anio} onChange={e => setAnio(Number(e.target.value))}>
              {anios.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label style={labelSt}>Mes</label>
            <select style={selectSt} value={mes} onChange={e => setMes(Number(e.target.value))}>
              {meses.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label style={labelSt}>Sucursal</label>
            <select style={selectSt} value={sucursalSel} onChange={e => setSucursalSel(e.target.value)}>
              <option value="all">Todas las sucursales</option>
              {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <button onClick={cargar} disabled={loading}
            style={{ padding: '8px 14px', borderRadius: 7, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            {loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />}
          </button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #E5E7EB', background: '#fff', borderRadius: '10px 10px 0 0', padding: '0 12px' }}>
        {[
          { k: 'resumen', l: '📊 Resumen ejecutivo' },
          { k: 'cuadratura', l: '⚖️ Cuadratura' },
          { k: 'medios', l: '💳 Medios de pago' },
          { k: 'operacion', l: '⚙️ Operación' },
        ].map(t => (
          <button key={t.k} onClick={() => setVista(t.k)} style={{
            padding: '12px 18px', fontSize: 13, fontWeight: 700, background: 'none', border: 'none',
            cursor: 'pointer', color: vista === t.k ? AZUL : GRIS,
            borderBottom: `3px solid ${vista === t.k ? AZUL : 'transparent'}`, marginBottom: -2,
          }}>{t.l}</button>
        ))}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Loader2 size={28} style={{ color: AZUL, animation: 'spin 1s linear infinite' }} />
        </div>
      )}

      {/* ═══════════════════ VISTA 1: RESUMEN ═══════════════════ */}
      {!loading && vista === 'resumen' && (
        <>
          {/* KPIs principales */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <Kpi label="Venta BSALE" valor={fmt(kpis?.ventasBsale)} color={AZUL} ic={<DollarSign size={12} />} hint="Vendido en el mes" />
            <Kpi label="Total declarado" valor={fmt(resumen.totalDecl)} sub={`${resumen.n} cierres`} color="#374151" />
            <Kpi label="Total corroborado" valor={fmt(resumen.totalCorr)} color={VERDE} ic={<CheckCircle2 size={12} />} />
            <Kpi label="Brecha vs BSALE" valor={fmt(kpis?.brechaTotal ?? 0)} color={kpis?.brechaTotal > 0 ? ROJO : VERDE} ic={<AlertTriangle size={12} />} />
            <Kpi label="Cuadran" valor={resumen.porEstado.cuadra} color={VERDE} sub={`${pct(resumen.porEstado.cuadra, resumen.n)}% del total`} />
            <Kpi label="Descuadres" valor={resumen.porEstado.descuadre + resumen.porEstado.tolerable} color={resumen.porEstado.descuadre > 0 ? ROJO : NARANJA} sub={`${resumen.porEstado.descuadre} desc · ${resumen.porEstado.tolerable} tol`} />
          </div>

          {/* Tendencia diaria */}
          <div style={cardSt}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#111827' }}>Venta declarada por día — {meses[mes - 1]} {anio}</div>
            <LineChart datos={serieDia} color={AZUL} alto={120} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: GRIS, marginTop: 4 }}>
              <span>{serieDia[0]?.l ?? ''}</span>
              <span>{serieDia[serieDia.length - 1]?.l ?? ''}</span>
            </div>
          </div>

          {/* Por sucursal y por vendedor */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={cardSt}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Por sucursal</div>
              {porSucursal.length === 0 && <div style={{ color: GRIS, fontSize: 12 }}>Sin datos</div>}
              {porSucursal.map((s, i) => (
                <BarraH key={i} label={s.nombre} valor={s.decl} total={porSucursal[0]?.decl ?? 0} color={[AZUL, AZUL2, MORADO][i % 3]} />
              ))}
            </div>
            <div style={cardSt}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Top 5 vendedores con mayor brecha</div>
              {porVendedor.slice(0, 5).length === 0 && <div style={{ color: GRIS, fontSize: 12 }}>Sin descuadres</div>}
              {porVendedor.slice(0, 5).map((v, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < 4 ? '1px solid #F3F4F6' : 'none', fontSize: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{v.nombre}</div>
                    <div style={{ fontSize: 10, color: GRIS }}>{v.n} cierres · {v.descuadres} descuadres</div>
                  </div>
                  <span style={{ color: v.brecha > umbrales.tolerable ? ROJO : NARANJA, fontWeight: 700 }}>{fmt(v.brecha)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════ VISTA 2: CUADRATURA ═══════════════════ */}
      {!loading && vista === 'cuadratura' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            <Kpi label="Cuadran" valor={resumen.porEstado.cuadra} color={VERDE} sub={`${pct(resumen.porEstado.cuadra, resumen.n)}%`} />
            <Kpi label="Tolerables" valor={resumen.porEstado.tolerable} color={NARANJA} />
            <Kpi label="Descuadres" valor={resumen.porEstado.descuadre} color={ROJO} />
            <Kpi label="Pendientes" valor={resumen.porEstado.declarado} color={AZUL2} />
          </div>

          {/* Heatmap calendario */}
          <div style={cardSt}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Calendario — {meses[mes - 1]} {anio}</div>
            <CalendarHeatmap cierres={cierres} anio={anio} mes={mes} umbrales={umbrales} />
            <div style={{ display: 'flex', gap: 12, marginTop: 12, fontSize: 10, color: GRIS, flexWrap: 'wrap' }}>
              {Object.entries(ESTADO_COLOR).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 10, height: 10, background: v.bg, border: `1px solid ${v.c}`, borderRadius: 3 }} />
                  <span>{v.l}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tabla de descuadres */}
          <div style={cardSt}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Top descuadres del mes</div>
            {topDescuadres.length === 0 && <div style={{ color: VERDE, fontSize: 12 }}>✓ No hay descuadres relevantes este mes</div>}
            {topDescuadres.length > 0 && (
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
                    {topDescuadres.map(c => {
                      const cfg = ESTADO_COLOR[c.estado] ?? ESTADO_COLOR.declarado
                      return (
                        <tr key={c.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                          <td style={TD}>{c.fecha}</td>
                          <td style={TD}>{c.sucursal_nombre ?? '—'}</td>
                          <td style={TD}>{c.vendedor_nombre ?? '—'}</td>
                          <td style={{ ...TD, textAlign: 'right' }}>{fmt(c.total_declarado)}</td>
                          <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: ROJO }}>{fmt(c.diferencia)}</td>
                          <td style={TD}>
                            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: cfg.bg, color: cfg.c }}>{cfg.l}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Sucursales — desempeño */}
          <div style={cardSt}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Desempeño por sucursal</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr>
                  <th style={TH}>Sucursal</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Cierres</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Declarado</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Corroborado</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Brecha total</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Descuadres</th>
                </tr></thead>
                <tbody>
                  {porSucursal.map((s, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #F3F4F6' }}>
                      <td style={{ ...TD, fontWeight: 600 }}>{s.nombre}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>{s.n}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>{fmt(s.decl)}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>{fmt(s.corr)}</td>
                      <td style={{ ...TD, textAlign: 'right', color: s.brecha > 0 ? ROJO : VERDE, fontWeight: 700 }}>{fmt(s.brecha)}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>
                        {s.descuadres > 0
                          ? <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#FEE2E2', color: ROJO }}>{s.descuadres}</span>
                          : <span style={{ color: VERDE }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════ VISTA 3: MEDIOS DE PAGO ═══════════════════ */}
      {!loading && vista === 'medios' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* Distribución medios */}
            <div style={cardSt}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Distribución por medio de pago</div>
              {mediosPago.length === 0 && <div style={{ color: GRIS, fontSize: 12 }}>Sin datos</div>}
              {mediosPago.map(m => (
                <BarraH key={m.key} label={m.label} valor={m.valor} total={mediosPago[0]?.valor ?? 0} color={m.color} />
              ))}
            </div>

            {/* Pie chart visual SVG */}
            <div style={cardSt}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Mix de medios — Total {fmt(mediosPago.reduce((s, m) => s + m.valor, 0))}</div>
              <PieChart datos={mediosPago} />
            </div>
          </div>

          {/* Análisis multi-mes desde view */}
          <div style={cardSt}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Evolución medios — vista histórica</div>
            {analisisMedios.length === 0
              ? <div style={{ color: GRIS, fontSize: 12 }}>La view v_analisis_medios_pago no devuelve datos</div>
              : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead><tr>
                      {Object.keys(analisisMedios[0]).slice(0, 8).map(k => (
                        <th key={k} style={TH}>{k}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {analisisMedios.slice(0, 12).map((r, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #F3F4F6' }}>
                          {Object.entries(r).slice(0, 8).map(([k, v], j) => (
                            <td key={j} style={TD}>{typeof v === 'number' ? fmt(v) : String(v ?? '—')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        </>
      )}

      {/* ═══════════════════ VISTA 4: OPERACIÓN ═══════════════════ */}
      {!loading && vista === 'operacion' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            <Kpi label="Tiempo prom. corroboración" valor={`${tiempos.promedio.toFixed(1)} días`} color={tiempos.promedio > 3 ? NARANJA : VERDE} sub={`Mediana: ${tiempos.mediana.toFixed(1)}d`} />
            <Kpi label="Máximo en corroborar" valor={`${tiempos.max.toFixed(0)} días`} color={tiempos.max > 7 ? ROJO : NARANJA} sub={`${tiempos.n} cierres corroborados`} />
            <Kpi label="Pendientes >2 días" valor={cierres.filter(c => c.estado === 'declarado' && c.declarado_at && (Date.now() - new Date(c.declarado_at)) / 86400000 > 2).length} color={NARANJA} />
            <Kpi label="Tasa cuadran" valor={`${pct(resumen.porEstado.cuadra, resumen.n)}%`} color={VERDE} sub={`${resumen.porEstado.cuadra}/${resumen.n}`} />
          </div>

          {/* Vendedores recurrentes */}
          <div style={cardSt}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Vendedores — desempeño del mes</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr>
                  <th style={TH}>Vendedor</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Cierres</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Declarado</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Brecha</th>
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
                        <td style={{ ...TD, textAlign: 'right', color: v.brecha > umbrales.tolerable ? ROJO : v.brecha > 0 ? NARANJA : VERDE, fontWeight: 700 }}>{fmt(v.brecha)}</td>
                        <td style={{ ...TD, textAlign: 'right' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                            background: pctDesc > 30 ? '#FEE2E2' : pctDesc > 10 ? '#FEF3C7' : '#DCFCE7',
                            color: pctDesc > 30 ? ROJO : pctDesc > 10 ? NARANJA : VERDE }}>{pctDesc}%</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Distribución estados */}
          <div style={cardSt}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Distribución de estados</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
              {Object.entries(resumen.porEstado).map(([estado, n]) => {
                const cfg = ESTADO_COLOR[estado] ?? ESTADO_COLOR.declarado
                return (
                  <div key={estado} style={{ background: cfg.bg, borderRadius: 10, padding: '12px 14px', border: `1px solid ${cfg.c}30` }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: cfg.c, textTransform: 'uppercase' }}>{cfg.l}</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: cfg.c, marginTop: 4 }}>{n}</div>
                    <div style={{ fontSize: 10, color: cfg.c, opacity: 0.7 }}>{pct(n, resumen.n)}% del total</div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Pie chart simple SVG ──────────────────────────────────────────────────
function PieChart({ datos }) {
  const total = datos.reduce((s, d) => s + d.valor, 0)
  if (total === 0) return <div style={{ color: GRIS, fontSize: 12, textAlign: 'center', padding: 20 }}>Sin datos</div>
  const r = 60, cx = 80, cy = 80
  let acumulado = 0
  const slices = datos.map(d => {
    const inicio = acumulado / total * 2 * Math.PI
    acumulado += d.valor
    const fin = acumulado / total * 2 * Math.PI
    const largeArc = (fin - inicio) > Math.PI ? 1 : 0
    const x1 = cx + r * Math.sin(inicio), y1 = cy - r * Math.cos(inicio)
    const x2 = cx + r * Math.sin(fin), y2 = cy - r * Math.cos(fin)
    return { ...d, path: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z` }
  })
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg width="160" height="160" viewBox="0 0 160 160">
        {slices.map((s, i) => <path key={i} d={s.path} fill={s.color} stroke="#fff" strokeWidth="1" />)}
      </svg>
      <div style={{ flex: 1, fontSize: 11 }}>
        {datos.map(d => (
          <div key={d.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <div style={{ width: 10, height: 10, background: d.color, borderRadius: 2, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
            </div>
            <span style={{ fontWeight: 600, color: GRIS, flexShrink: 0 }}>{d.pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
