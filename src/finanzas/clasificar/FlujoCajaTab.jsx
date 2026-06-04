import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, TrendingUp, TrendingDown, Calendar, BarChart3, Download, ChevronLeft, ChevronRight } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabase'
import { ProyeccionFlujoTab } from './ProyeccionFlujoTab'
import { ComparativoRealVsProyectadoTab } from './ComparativoRealProyectadoTab'

const PRIMARY = '#1F4E79'
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function fmtCLP(n) {
  if (n == null || n === 0) return '—'
  const abs = Math.abs(Math.round(n))
  const s = abs.toLocaleString('es-CL')
  return n < 0 ? '−$' + s : '$' + s
}
function fmtCLPplano(n) {
  if (n == null) return '—'
  return '$' + Math.round(n).toLocaleString('es-CL')
}
function fmtFecha(d) {
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

// ── Helpers de semana ISO ──────────────────────────────────────────────────
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
  return { year: d.getUTCFullYear(), week: weekNum }
}
function fechaInicioSemana(year, week) {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7))
  const dow = simple.getUTCDay()
  const isoWeekStart = simple
  if (dow <= 4) isoWeekStart.setUTCDate(simple.getUTCDate() - simple.getUTCDay() + 1)
  else isoWeekStart.setUTCDate(simple.getUTCDate() + 8 - simple.getUTCDay())
  return isoWeekStart
}

const TH = { padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#374151', background: '#F1F5F9', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2 }
const TD = { padding: '7px 10px', fontSize: 12, color: '#374151', borderBottom: '1px solid #F1F5F9' }

export function FlujoCajaTab() {
  const [vista, setVista] = useState('mensual')  // 'mensual' | 'semanal' | 'proyeccion' | 'comparativo'
  const [anio, setAnio]   = useState(new Date().getFullYear())

  const TABS = [
    { k: 'mensual',     l: 'Flujo mensual',      icon: <Calendar size={13} /> },
    { k: 'semanal',     l: 'Flujo semanal',      icon: <BarChart3 size={13} /> },
    { k: 'proyeccion',  l: 'Proyección 12m',     icon: <TrendingUp size={13} /> },
    { k: 'comparativo', l: 'Real vs proyectado', icon: <TrendingDown size={13} /> },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 4, background: '#fff', padding: 4, borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        {TABS.map(({ k, l, icon }) => (
          <button key={k}
            onClick={() => setVista(k)}
            style={{
              flex: 1,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 7, border: 'none',
              background: vista === k ? PRIMARY : 'transparent',
              color: vista === k ? '#fff' : '#475569',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>
            {icon} {l}
          </button>
        ))}
      </div>

      {vista === 'mensual'    && <VistaMensual anio={anio} setAnio={setAnio} />}
      {vista === 'semanal'    && <VistaSemanal />}
      {vista === 'proyeccion' && <ProyeccionFlujoTab anio={anio} />}
      {vista === 'comparativo'&& <ComparativoRealVsProyectadoTab anio={anio} />}
    </div>
  )
}

function Placeholder({ titulo }) {
  return (
    <div style={{ padding: 60, textAlign: 'center', background: '#fff', borderRadius: 10, color: '#94A3B8' }}>
      <BarChart3 size={36} style={{ opacity: 0.4, marginBottom: 12 }} />
      <div style={{ fontSize: 14, fontWeight: 600 }}>{titulo}</div>
      <div style={{ fontSize: 12, marginTop: 4 }}>Próxima sesión</div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// VISTA MENSUAL: Saldo inicial + Entradas − Salidas = Saldo final por mes
// ════════════════════════════════════════════════════════════════════════
function VistaMensual({ anio, setAnio }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(new Set())  // cuenta_madre ids expandidos

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      setLoading(true)
      try {
        const desde = `${anio}-01-01`
        const hasta = `${anio}-12-31`

        // 1) Movimientos del año
        const { data: movs, error: errMov } = await supabase
          .from('movimientos_bancarios')
          .select('id, monto, tipo, fecha, mes_nominal, subcuenta_id, cartola_id, saldo')
          .gte('fecha', desde).lte('fecha', hasta)
          .order('fecha', { ascending: true })
          .limit(50000)
        if (errMov) throw errMov

        // 2) Catálogos
        const [cmR, scR] = await Promise.all([
          supabase.from('cuentas_madre').select('id, nombre, codigo, tipo').eq('activa', true),
          supabase.from('subcuentas').select('id, nombre, cuenta_madre_id').eq('activa', true),
        ])
        const cuentas    = cmR.data ?? []
        const subcuentas = scR.data ?? []
        const cmById = new Map(cuentas.map(c => [c.id, c]))
        const scById = new Map(subcuentas.map(s => [s.id, s]))

        // 3) Saldo inicial del año (saldo último del año anterior, o saldo más antiguo del año)
        let saldoInicial = 0
        const { data: cartolaPrev } = await supabase
          .from('cartolas')
          .select('saldo_final, fecha_fin')
          .lt('fecha_fin', desde)
          .order('fecha_fin', { ascending: false })
          .limit(1)
        if (cartolaPrev && cartolaPrev.length > 0) {
          saldoInicial = Number(cartolaPrev[0].saldo_final) || 0
        } else {
          // No hay cartola previa, usar saldo del primer movimiento del año - su monto
          const primero = (movs ?? [])[0]
          if (primero) saldoInicial = (Number(primero.saldo) || 0) - (Number(primero.monto) || 0)
        }

        // 4) Agrupar por mes
        // estructura: porMes[mes] = { entradas: {sin_clasif, porSubcuenta:Map}, salidas: {sin_clasif, porSubcuenta:Map}, totEnt, totSal }
        const porMes = {}
        for (let m = 1; m <= 12; m++) {
          porMes[m] = {
            entradas: { sinClasif: 0, porCuentaMadre: new Map() },  // Map<cmId, {nombre, total, subs:Map}>
            salidas:  { sinClasif: 0, porCuentaMadre: new Map() },
            totEntradas: 0,
            totSalidas: 0,
          }
        }

        for (const mov of movs ?? []) {
          const mes  = mov.mes_nominal ?? (new Date(mov.fecha).getMonth() + 1)
          const lado = mov.tipo === 'ABONO' ? 'entradas' : 'salidas'
          const monto = Math.abs(Number(mov.monto) || 0)
          const grupo = porMes[mes][lado]

          if (mov.tipo === 'ABONO') porMes[mes].totEntradas += monto
          else porMes[mes].totSalidas += monto

          if (!mov.subcuenta_id) {
            grupo.sinClasif += monto
            continue
          }
          const sc = scById.get(mov.subcuenta_id)
          if (!sc) { grupo.sinClasif += monto; continue }
          const cm = cmById.get(sc.cuenta_madre_id)
          if (!cm) { grupo.sinClasif += monto; continue }

          if (!grupo.porCuentaMadre.has(cm.id)) {
            grupo.porCuentaMadre.set(cm.id, { id: cm.id, nombre: cm.nombre, codigo: cm.codigo, total: 0, subs: new Map() })
          }
          const cmEntry = grupo.porCuentaMadre.get(cm.id)
          cmEntry.total += monto
          if (!cmEntry.subs.has(sc.id)) cmEntry.subs.set(sc.id, { id: sc.id, nombre: sc.nombre, total: 0 })
          cmEntry.subs.get(sc.id).total += monto
        }

        // 5) Calcular saldos corrientes
        let saldoCorriente = saldoInicial
        const saldoInicialMes = {}
        const saldoFinalMes = {}
        for (let m = 1; m <= 12; m++) {
          saldoInicialMes[m] = saldoCorriente
          saldoCorriente += porMes[m].totEntradas - porMes[m].totSalidas
          saldoFinalMes[m] = saldoCorriente
        }

        // 6) Totales generales
        const totEntradasAnio = Object.values(porMes).reduce((s, m) => s + m.totEntradas, 0)
        const totSalidasAnio  = Object.values(porMes).reduce((s, m) => s + m.totSalidas, 0)

        // Convertir Maps a arrays para render
        const arr = []
        for (let m = 1; m <= 12; m++) {
          const pm = porMes[m]
          arr.push({
            mes: m,
            saldoInicial: saldoInicialMes[m],
            saldoFinal:   saldoFinalMes[m],
            totEntradas: pm.totEntradas,
            totSalidas: pm.totSalidas,
            variacion: pm.totEntradas - pm.totSalidas,
            entradas: {
              sinClasif: pm.entradas.sinClasif,
              cuentasMadre: Array.from(pm.entradas.porCuentaMadre.values())
                .map(cm => ({ ...cm, subs: Array.from(cm.subs.values()).sort((a, b) => b.total - a.total) }))
                .sort((a, b) => b.total - a.total),
            },
            salidas: {
              sinClasif: pm.salidas.sinClasif,
              cuentasMadre: Array.from(pm.salidas.porCuentaMadre.values())
                .map(cm => ({ ...cm, subs: Array.from(cm.subs.values()).sort((a, b) => b.total - a.total) }))
                .sort((a, b) => b.total - a.total),
            },
          })
        }

        if (!cancelado) setData({
          meses: arr,
          saldoInicialAnio: saldoInicial,
          saldoFinalAnio: saldoCorriente,
          totEntradas: totEntradasAnio,
          totSalidas: totSalidasAnio,
          variacionAnio: totEntradasAnio - totSalidasAnio,
        })
      } catch (e) {
        toast.error('Error: ' + (e instanceof Error ? e.message : '?'))
        setData(null)
      } finally { if (!cancelado) setLoading(false) }
    })()
    return () => { cancelado = true }
  }, [anio])

  const aniosOpts = [new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1]

  function toggleExpand(key) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function exportarExcel() {
    if (!data) return
    const rows = [
      ['FLUJO DE CAJA ' + anio, '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['', ...MESES, 'TOTAL'],
      ['Saldo inicial', ...data.meses.map(m => m.saldoInicial), ''],
      ['(+) Entradas',  ...data.meses.map(m => m.totEntradas), data.totEntradas],
      ['(−) Salidas',   ...data.meses.map(m => m.totSalidas),  data.totSalidas],
      ['Variación',     ...data.meses.map(m => m.variacion),   data.variacionAnio],
      ['Saldo final',   ...data.meses.map(m => m.saldoFinal),  data.saldoFinalAnio],
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Flujo ' + anio)
    XLSX.writeFile(wb, `flujo_caja_${anio}.xlsx`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Controles */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '12px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div>
          <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>Año</div>
          <select value={anio} onChange={e => setAnio(Number(e.target.value))}
            style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 13, background: '#fff', cursor: 'pointer' }}>
            {aniosOpts.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={exportarExcel} disabled={!data || loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 7, border: 'none', background: PRIMARY, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: !data || loading ? 0.5 : 1 }}>
            <Download size={12} /> Excel
          </button>
        </div>
      </div>

      {/* KPIs principales */}
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <Kpi label="Saldo inicial año" value={data.saldoInicialAnio} color="#1E40AF" />
          <Kpi label="Total entradas"   value={data.totEntradas}      color="#16A34A" icon={<TrendingUp size={18} color="#16A34A" />} />
          <Kpi label="Total salidas"    value={-data.totSalidas}      color="#DC2626" icon={<TrendingDown size={18} color="#DC2626" />} />
          <Kpi label="Saldo final año"  value={data.saldoFinalAnio}   color="#1E40AF" highlight />
        </div>
      )}

      {/* Tabla flujo */}
      <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '60px 0', textAlign: 'center' }}><Loader2 size={22} color="#9CA3AF" /></div>
        ) : !data ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#94A3B8' }}>Sin datos</div>
        ) : (
          <div style={{ overflow: 'auto', maxHeight: '70vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 1100 }}>
              <thead>
                <tr>
                  <th style={{ ...TH, minWidth: 240, left: 0, zIndex: 3 }}>Concepto</th>
                  {MESES.map((m, i) => (
                    <th key={i} style={{ ...TH, textAlign: 'right', minWidth: 90 }}>{m}</th>
                  ))}
                  <th style={{ ...TH, textAlign: 'right', background: '#E0F2FE', color: '#0369A1', minWidth: 110 }}>Total {anio}</th>
                </tr>
              </thead>
              <tbody>
                {/* Saldo inicial */}
                <tr style={{ background: '#EFF6FF', fontWeight: 600 }}>
                  <td style={{ ...TD, fontStyle: 'italic', color: '#1E40AF' }}>Saldo inicial</td>
                  {data.meses.map(m => (
                    <td key={m.mes} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#1E40AF' }}>{fmtCLPplano(m.saldoInicial)}</td>
                  ))}
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#1E40AF', background: '#DBEAFE' }}>{fmtCLPplano(data.saldoInicialAnio)}</td>
                </tr>

                {/* Sección ENTRADAS */}
                <tr style={{ background: '#16A34A' }}>
                  <td colSpan={14} style={{ ...TD, color: '#fff', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    ↑ ENTRADAS
                  </td>
                </tr>
                {/* Filas cuenta madre entradas */}
                {(() => {
                  // Lista única de cuentas madre presentes en cualquier mes (entradas)
                  const cmMap = new Map()
                  for (const mes of data.meses) {
                    for (const cm of mes.entradas.cuentasMadre) {
                      if (!cmMap.has(cm.id)) cmMap.set(cm.id, { id: cm.id, nombre: cm.nombre, codigo: cm.codigo })
                    }
                  }
                  const cms = Array.from(cmMap.values())
                  return cms.map(cm => {
                    const expandKey = 'ent_' + cm.id
                    const isOpen = expanded.has(expandKey)
                    // Recopilar subs únicas
                    const subMap = new Map()
                    for (const mes of data.meses) {
                      const cmMes = mes.entradas.cuentasMadre.find(x => x.id === cm.id)
                      if (cmMes) for (const sub of cmMes.subs) {
                        if (!subMap.has(sub.id)) subMap.set(sub.id, { id: sub.id, nombre: sub.nombre })
                      }
                    }
                    const subs = Array.from(subMap.values())
                    // Total año cm
                    const totAnio = data.meses.reduce((s, mes) => {
                      const c = mes.entradas.cuentasMadre.find(x => x.id === cm.id)
                      return s + (c?.total ?? 0)
                    }, 0)
                    return (
                      <>
                        <tr key={cm.id} onClick={() => toggleExpand(expandKey)}
                          style={{ cursor: 'pointer', background: '#F0FDF4' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#DCFCE7'}
                          onMouseLeave={e => e.currentTarget.style.background = '#F0FDF4'}>
                          <td style={{ ...TD, fontWeight: 600 }}>
                            {isOpen ? <ChevronLeft size={11} style={{ transform: 'rotate(-90deg)', display: 'inline' }} /> : <ChevronRight size={11} style={{ display: 'inline' }} />}
                            {' '}{cm.nombre}
                          </td>
                          {data.meses.map(mes => {
                            const c = mes.entradas.cuentasMadre.find(x => x.id === cm.id)
                            return <td key={mes.mes} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: c?.total ? '#15803D' : '#D1D5DB' }}>{fmtCLP(c?.total ?? 0)}</td>
                          })}
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#15803D', background: '#DCFCE7' }}>{fmtCLP(totAnio)}</td>
                        </tr>
                        {isOpen && subs.map(sub => {
                          const totSubAnio = data.meses.reduce((s, mes) => {
                            const c = mes.entradas.cuentasMadre.find(x => x.id === cm.id)
                            const su = c?.subs.find(x => x.id === sub.id)
                            return s + (su?.total ?? 0)
                          }, 0)
                          return (
                            <tr key={cm.id + '|' + sub.id} style={{ background: '#fff' }}>
                              <td style={{ ...TD, paddingLeft: 30, color: '#6B7280', fontSize: 11 }}>↳ {sub.nombre}</td>
                              {data.meses.map(mes => {
                                const c = mes.entradas.cuentasMadre.find(x => x.id === cm.id)
                                const su = c?.subs.find(x => x.id === sub.id)
                                return <td key={mes.mes} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: su?.total ? '#475569' : '#E2E8F0' }}>{fmtCLP(su?.total ?? 0)}</td>
                              })}
                              <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: '#475569', background: '#F8FAFC' }}>{fmtCLP(totSubAnio)}</td>
                            </tr>
                          )
                        })}
                      </>
                    )
                  })
                })()}
                {/* Sin clasificar entradas */}
                {data.meses.some(m => m.entradas.sinClasif > 0) && (
                  <tr style={{ background: '#FEF9C3' }}>
                    <td style={{ ...TD, fontStyle: 'italic', color: '#92400E' }}>⚠ Sin clasificar</td>
                    {data.meses.map(mes => (
                      <td key={mes.mes} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: mes.entradas.sinClasif ? '#92400E' : '#D1D5DB' }}>{fmtCLP(mes.entradas.sinClasif)}</td>
                    ))}
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#92400E', background: '#FEF3C7' }}>
                      {fmtCLP(data.meses.reduce((s, m) => s + m.entradas.sinClasif, 0))}
                    </td>
                  </tr>
                )}
                {/* Total entradas */}
                <tr style={{ background: '#DCFCE7', fontWeight: 700 }}>
                  <td style={{ ...TD, color: '#166534' }}>Total entradas</td>
                  {data.meses.map(m => (
                    <td key={m.mes} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#166534' }}>{fmtCLP(m.totEntradas)}</td>
                  ))}
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#166534', background: '#BBF7D0' }}>{fmtCLP(data.totEntradas)}</td>
                </tr>

                {/* Sección SALIDAS */}
                <tr style={{ background: '#DC2626' }}>
                  <td colSpan={14} style={{ ...TD, color: '#fff', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    ↓ SALIDAS
                  </td>
                </tr>
                {(() => {
                  const cmMap = new Map()
                  for (const mes of data.meses) {
                    for (const cm of mes.salidas.cuentasMadre) {
                      if (!cmMap.has(cm.id)) cmMap.set(cm.id, { id: cm.id, nombre: cm.nombre, codigo: cm.codigo })
                    }
                  }
                  const cms = Array.from(cmMap.values())
                  return cms.map(cm => {
                    const expandKey = 'sal_' + cm.id
                    const isOpen = expanded.has(expandKey)
                    const subMap = new Map()
                    for (const mes of data.meses) {
                      const cmMes = mes.salidas.cuentasMadre.find(x => x.id === cm.id)
                      if (cmMes) for (const sub of cmMes.subs) {
                        if (!subMap.has(sub.id)) subMap.set(sub.id, { id: sub.id, nombre: sub.nombre })
                      }
                    }
                    const subs = Array.from(subMap.values())
                    const totAnio = data.meses.reduce((s, mes) => {
                      const c = mes.salidas.cuentasMadre.find(x => x.id === cm.id)
                      return s + (c?.total ?? 0)
                    }, 0)
                    return (
                      <>
                        <tr key={cm.id} onClick={() => toggleExpand(expandKey)}
                          style={{ cursor: 'pointer', background: '#FEF2F2' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#FEE2E2'}
                          onMouseLeave={e => e.currentTarget.style.background = '#FEF2F2'}>
                          <td style={{ ...TD, fontWeight: 600 }}>
                            {isOpen ? <ChevronLeft size={11} style={{ transform: 'rotate(-90deg)', display: 'inline' }} /> : <ChevronRight size={11} style={{ display: 'inline' }} />}
                            {' '}{cm.nombre}
                          </td>
                          {data.meses.map(mes => {
                            const c = mes.salidas.cuentasMadre.find(x => x.id === cm.id)
                            return <td key={mes.mes} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: c?.total ? '#991B1B' : '#D1D5DB' }}>{fmtCLP(c?.total ?? 0)}</td>
                          })}
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#991B1B', background: '#FEE2E2' }}>{fmtCLP(totAnio)}</td>
                        </tr>
                        {isOpen && subs.map(sub => {
                          const totSubAnio = data.meses.reduce((s, mes) => {
                            const c = mes.salidas.cuentasMadre.find(x => x.id === cm.id)
                            const su = c?.subs.find(x => x.id === sub.id)
                            return s + (su?.total ?? 0)
                          }, 0)
                          return (
                            <tr key={cm.id + '|' + sub.id} style={{ background: '#fff' }}>
                              <td style={{ ...TD, paddingLeft: 30, color: '#6B7280', fontSize: 11 }}>↳ {sub.nombre}</td>
                              {data.meses.map(mes => {
                                const c = mes.salidas.cuentasMadre.find(x => x.id === cm.id)
                                const su = c?.subs.find(x => x.id === sub.id)
                                return <td key={mes.mes} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: su?.total ? '#475569' : '#E2E8F0' }}>{fmtCLP(su?.total ?? 0)}</td>
                              })}
                              <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: '#475569', background: '#F8FAFC' }}>{fmtCLP(totSubAnio)}</td>
                            </tr>
                          )
                        })}
                      </>
                    )
                  })
                })()}
                {data.meses.some(m => m.salidas.sinClasif > 0) && (
                  <tr style={{ background: '#FEF9C3' }}>
                    <td style={{ ...TD, fontStyle: 'italic', color: '#92400E' }}>⚠ Sin clasificar</td>
                    {data.meses.map(mes => (
                      <td key={mes.mes} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: mes.salidas.sinClasif ? '#92400E' : '#D1D5DB' }}>{fmtCLP(mes.salidas.sinClasif)}</td>
                    ))}
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#92400E', background: '#FEF3C7' }}>
                      {fmtCLP(data.meses.reduce((s, m) => s + m.salidas.sinClasif, 0))}
                    </td>
                  </tr>
                )}
                <tr style={{ background: '#FEE2E2', fontWeight: 700 }}>
                  <td style={{ ...TD, color: '#991B1B' }}>Total salidas</td>
                  {data.meses.map(m => (
                    <td key={m.mes} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#991B1B' }}>{fmtCLP(m.totSalidas)}</td>
                  ))}
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#991B1B', background: '#FECACA' }}>{fmtCLP(data.totSalidas)}</td>
                </tr>

                {/* Variación neta */}
                <tr style={{ background: '#F1F5F9', fontWeight: 700 }}>
                  <td style={{ ...TD }}>Variación neta</td>
                  {data.meses.map(m => (
                    <td key={m.mes} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: m.variacion >= 0 ? '#15803D' : '#DC2626' }}>{fmtCLP(m.variacion)}</td>
                  ))}
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: data.variacionAnio >= 0 ? '#15803D' : '#DC2626', background: '#E2E8F0' }}>{fmtCLP(data.variacionAnio)}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr style={{ background: 'linear-gradient(to right, #1E3A5F, #1E40AF)', color: '#fff', fontWeight: 700 }}>
                  <td style={{ ...TD, color: '#fff', borderBottom: 'none', fontSize: 13 }}>SALDO FINAL</td>
                  {data.meses.map(m => (
                    <td key={m.mes} style={{ ...TD, color: '#fff', textAlign: 'right', fontFamily: 'monospace', borderBottom: 'none' }}>{fmtCLPplano(m.saldoFinal)}</td>
                  ))}
                  <td style={{ ...TD, color: '#fff', textAlign: 'right', fontFamily: 'monospace', fontSize: 14, fontWeight: 800, borderBottom: 'none' }}>{fmtCLPplano(data.saldoFinalAnio)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// VISTA SEMANAL: últimas N semanas
// ════════════════════════════════════════════════════════════════════════
function VistaSemanal() {
  const [semanas, setSemanas]  = useState(8)
  const [data, setData]        = useState(null)
  const [loading, setLoading]  = useState(true)
  const [foco, setFoco]        = useState('neto')  // 'entradas' | 'salidas' | 'neto'

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      setLoading(true)
      try {
        // Calcular fecha desde: N semanas hacia atrás desde hoy
        const hoy = new Date()
        const desde = new Date(hoy)
        desde.setDate(desde.getDate() - (semanas * 7))
        const desdeStr = desde.toISOString().slice(0, 10)

        const { data: movs, error } = await supabase
          .from('movimientos_bancarios')
          .select('id, monto, tipo, fecha, subcuenta_id')
          .gte('fecha', desdeStr)
          .order('fecha', { ascending: true })
          .limit(20000)
        if (error) throw error

        const [cmR, scR] = await Promise.all([
          supabase.from('cuentas_madre').select('id, nombre').eq('activa', true),
          supabase.from('subcuentas').select('id, cuenta_madre_id').eq('activa', true),
        ])
        const cmById = new Map((cmR.data ?? []).map(c => [c.id, c]))
        const scById = new Map((scR.data ?? []).map(s => [s.id, s]))

        // Generar etiquetas de las N semanas (la última = semana actual)
        const semsLabels = []
        for (let i = semanas - 1; i >= 0; i--) {
          const ref = new Date(hoy)
          ref.setDate(ref.getDate() - (i * 7))
          const { year, week } = getISOWeek(ref)
          const inicio = fechaInicioSemana(year, week)
          const fin = new Date(inicio); fin.setDate(fin.getDate() + 6)
          semsLabels.push({
            key: `${year}-W${String(week).padStart(2, '0')}`,
            year, week,
            inicio: inicio.toISOString().slice(0, 10),
            fin:    fin.toISOString().slice(0, 10),
            label: `S${week}`,
            rango: `${inicio.getUTCDate()}/${inicio.getUTCMonth()+1} – ${fin.getUTCDate()}/${fin.getUTCMonth()+1}`,
          })
        }

        // Inicializar
        const porSemana = {}
        for (const s of semsLabels) porSemana[s.key] = {
          entradas: 0, salidas: 0,
          porCM: new Map(),  // Map<cmId, {nombre, entradas, salidas}>
        }

        for (const m of movs ?? []) {
          const d = new Date(m.fecha)
          const { year, week } = getISOWeek(d)
          const key = `${year}-W${String(week).padStart(2, '0')}`
          const ps = porSemana[key]
          if (!ps) continue  // fuera del rango
          const monto = Math.abs(Number(m.monto) || 0)
          if (m.tipo === 'ABONO') ps.entradas += monto
          else ps.salidas += monto

          const sc = m.subcuenta_id ? scById.get(m.subcuenta_id) : null
          const cm = sc ? cmById.get(sc.cuenta_madre_id) : null
          const cmKey = cm?.id ?? 'sin_clasif'
          const cmNombre = cm?.nombre ?? 'Sin clasificar'
          if (!ps.porCM.has(cmKey)) ps.porCM.set(cmKey, { id: cmKey, nombre: cmNombre, entradas: 0, salidas: 0 })
          const e = ps.porCM.get(cmKey)
          if (m.tipo === 'ABONO') e.entradas += monto
          else e.salidas += monto
        }

        // Lista única de CMs presentes
        const cmsSet = new Map()
        for (const s of semsLabels) {
          for (const [k, v] of porSemana[s.key].porCM) {
            if (!cmsSet.has(k)) cmsSet.set(k, { id: k, nombre: v.nombre })
          }
        }
        const cms = Array.from(cmsSet.values())

        // Totales
        const totEntradas = Object.values(porSemana).reduce((s, p) => s + p.entradas, 0)
        const totSalidas  = Object.values(porSemana).reduce((s, p) => s + p.salidas, 0)

        if (!cancelado) setData({
          sems: semsLabels.map(s => ({ ...s, ...porSemana[s.key] })),
          cms,
          totEntradas, totSalidas,
          variacion: totEntradas - totSalidas,
        })
      } catch (e) {
        toast.error('Error: ' + (e instanceof Error ? e.message : '?'))
        setData(null)
      } finally { if (!cancelado) setLoading(false) }
    })()
    return () => { cancelado = true }
  }, [semanas])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Controles */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '12px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>Período</div>
          <div style={{ display: 'flex', gap: 4, background: '#F1F5F9', borderRadius: 8, padding: 3 }}>
            {[4, 8, 12, 26].map(n => (
              <button key={n} onClick={() => setSemanas(n)} style={{
                padding: '5px 12px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: semanas === n ? '#fff' : 'transparent',
                color: semanas === n ? PRIMARY : '#64748B',
                boxShadow: semanas === n ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}>Últimas {n}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>Foco</div>
          <div style={{ display: 'flex', gap: 4, background: '#F1F5F9', borderRadius: 8, padding: 3 }}>
            {[
              { k: 'entradas', l: 'Entradas',  c: '#16A34A' },
              { k: 'salidas',  l: 'Salidas',   c: '#DC2626' },
              { k: 'neto',     l: 'Neto',      c: PRIMARY },
            ].map(({ k, l, c }) => (
              <button key={k} onClick={() => setFoco(k)} style={{
                padding: '5px 12px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: foco === k ? '#fff' : 'transparent',
                color: foco === k ? c : '#64748B',
                boxShadow: foco === k ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {/* KPIs */}
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <Kpi label={`Entradas (${semanas} sem)`} value={data.totEntradas} color="#16A34A" icon={<TrendingUp size={18} color="#16A34A" />} />
          <Kpi label={`Salidas (${semanas} sem)`}  value={-data.totSalidas} color="#DC2626" icon={<TrendingDown size={18} color="#DC2626" />} />
          <Kpi label="Variación neta" value={data.variacion} color={data.variacion >= 0 ? '#16A34A' : '#DC2626'} highlight />
        </div>
      )}

      {/* Tabla semanal */}
      <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '60px 0', textAlign: 'center' }}><Loader2 size={22} color="#9CA3AF" /></div>
        ) : !data ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#94A3B8' }}>Sin datos</div>
        ) : (
          <div style={{ overflow: 'auto', maxHeight: '70vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 800 }}>
              <thead>
                <tr>
                  <th style={{ ...TH, minWidth: 200, left: 0, zIndex: 3 }}>Cuenta madre</th>
                  {data.sems.map(s => (
                    <th key={s.key} style={{ ...TH, textAlign: 'right', minWidth: 90 }}>
                      <div>{s.label}</div>
                      <div style={{ fontSize: 9, color: '#94A3B8', fontWeight: 500 }}>{s.rango}</div>
                    </th>
                  ))}
                  <th style={{ ...TH, textAlign: 'right', background: '#E0F2FE', color: '#0369A1' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {data.cms.map(cm => {
                  const valores = data.sems.map(s => {
                    const e = s.porCM.get(cm.id)
                    if (!e) return 0
                    return foco === 'entradas' ? e.entradas : foco === 'salidas' ? -e.salidas : (e.entradas - e.salidas)
                  })
                  const totFila = valores.reduce((a, b) => a + b, 0)
                  if (totFila === 0) return null
                  return (
                    <tr key={cm.id}
                      onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ ...TD, fontWeight: 500 }}>
                        {cm.id === 'sin_clasif' ? <span style={{ color: '#92400E' }}>⚠ Sin clasificar</span> : cm.nombre}
                      </td>
                      {valores.map((v, i) => (
                        <td key={i} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: v > 0 ? '#15803D' : v < 0 ? '#DC2626' : '#D1D5DB' }}>{fmtCLP(v)}</td>
                      ))}
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: totFila > 0 ? '#15803D' : totFila < 0 ? '#DC2626' : '#9CA3AF', background: '#F0F9FF' }}>{fmtCLP(totFila)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'linear-gradient(to right, #1E3A5F, #1E40AF)', color: '#fff', fontWeight: 700 }}>
                  <td style={{ ...TD, color: '#fff', borderBottom: 'none' }}>TOTAL</td>
                  {data.sems.map(s => {
                    const v = foco === 'entradas' ? s.entradas : foco === 'salidas' ? -s.salidas : (s.entradas - s.salidas)
                    return (
                      <td key={s.key} style={{ ...TD, color: '#fff', textAlign: 'right', fontFamily: 'monospace', borderBottom: 'none' }}>{fmtCLP(v)}</td>
                    )
                  })}
                  <td style={{ ...TD, color: '#fff', textAlign: 'right', fontFamily: 'monospace', fontSize: 14, fontWeight: 800, borderBottom: 'none' }}>
                    {fmtCLP(foco === 'entradas' ? data.totEntradas : foco === 'salidas' ? -data.totSalidas : data.variacion)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── KPI card ───────────────────────────────────────────────────────────
function Kpi({ label, value, color, icon, highlight }) {
  return (
    <div style={{
      background: highlight ? `linear-gradient(135deg, ${color}15, ${color}25)` : '#fff',
      borderRadius: 10, padding: '12px 16px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      border: highlight ? `1px solid ${color}33` : '1px solid transparent',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      {icon && <div style={{ background: '#fff', borderRadius: 8, padding: 8 }}>{icon}</div>}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
        <div style={{ fontSize: 18, fontWeight: 800, color, marginTop: 2 }}>{fmtCLPplano(Math.abs(value))}</div>
      </div>
    </div>
  )
}
