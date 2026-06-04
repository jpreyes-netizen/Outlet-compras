import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, TrendingUp, TrendingDown, ChevronRight, ChevronDown, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../supabase'

const PRIMARY = '#1F4E79'
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const ESCENARIOS = [
  { k: 'base',      l: 'Base',      color: '#1F4E79' },
  { k: 'optimista', l: 'Optimista', color: '#16A34A' },
  { k: 'pesimista', l: 'Pesimista', color: '#DC2626' },
]

function fmtCLP(n) {
  if (n == null || n === 0) return '—'
  const abs = Math.abs(Math.round(n))
  return (n < 0 ? '−$' : '$') + abs.toLocaleString('es-CL')
}
function fmtPct(n) {
  if (n == null || !isFinite(n)) return '—'
  const v = Math.round(n)
  return (v > 0 ? '+' : '') + v + '%'
}

const TH = { padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#374151', background: '#F1F5F9', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2 }
const TD = { padding: '7px 10px', fontSize: 11, color: '#374151', borderBottom: '1px solid #F1F5F9' }

export function ComparativoRealVsProyectadoTab({ anio = new Date().getFullYear() }) {
  const [escenario, setEscenario] = useState('base')
  const [loading, setLoading]     = useState(true)
  const [data, setData]           = useState(null)
  const [expanded, setExpanded]   = useState(new Set())

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      setLoading(true)
      try {
        // 1) Catálogos
        const [cmR, scR] = await Promise.all([
          supabase.from('cuentas_madre').select('id, nombre, codigo').eq('activa', true),
          supabase.from('subcuentas').select('id, nombre, cuenta_madre_id').eq('activa', true),
        ])
        const cuentas = cmR.data ?? []
        const subcuentas = scR.data ?? []
        const cmById = new Map(cuentas.map(c => [c.id, c]))
        const scById = new Map(subcuentas.map(s => [s.id, s]))

        // 2) Movimientos REALES del año (clasificados)
        const desde = `${anio}-01-01`
        const hasta = `${anio}-12-31`
        const { data: movs } = await supabase
          .from('movimientos_bancarios')
          .select('monto, tipo, fecha, mes_nominal, subcuenta_id')
          .gte('fecha', desde).lte('fecha', hasta)
          .eq('estado', 'clasificado')
          .not('subcuenta_id', 'is', null)
          .limit(50000)

        // 3) Proyecciones del escenario actual
        const { data: proys } = await supabase
          .from('proyecciones_flujo')
          .select('mes, subcuenta_id, tipo, monto')
          .eq('anio', anio).eq('escenario', escenario)
          .limit(5000)

        // 4) Estructurar: subId → mes → { real, proy, tipo }
        // datos[subId] = { sub, tipo, meses: {1: {real, proy}, ...}, totalReal, totalProy }
        const dataMap = new Map()

        for (const m of movs ?? []) {
          if (!m.subcuenta_id) continue
          const sub = scById.get(m.subcuenta_id); if (!sub) continue
          const mes = m.mes_nominal ?? (new Date(m.fecha).getMonth() + 1)
          if (!dataMap.has(sub.id)) dataMap.set(sub.id, { sub, tipo: m.tipo, meses: {}, totalReal: 0, totalProy: 0 })
          const entry = dataMap.get(sub.id)
          if (!entry.meses[mes]) entry.meses[mes] = { real: 0, proy: 0 }
          entry.meses[mes].real += Math.abs(Number(m.monto) || 0)
          entry.totalReal += Math.abs(Number(m.monto) || 0)
        }

        for (const p of proys ?? []) {
          if (!p.subcuenta_id) continue
          const sub = scById.get(p.subcuenta_id); if (!sub) continue
          if (!dataMap.has(sub.id)) dataMap.set(sub.id, { sub, tipo: p.tipo, meses: {}, totalReal: 0, totalProy: 0 })
          const entry = dataMap.get(sub.id)
          if (!entry.meses[p.mes]) entry.meses[p.mes] = { real: 0, proy: 0 }
          entry.meses[p.mes].proy = Number(p.monto) || 0
          entry.totalProy += Number(p.monto) || 0
          if (!entry.tipo) entry.tipo = p.tipo
        }

        // 5) Agrupar por cuenta madre
        const gruposEntradas = new Map()
        const gruposSalidas  = new Map()
        for (const [, entry] of dataMap) {
          const cm = cmById.get(entry.sub.cuenta_madre_id); if (!cm) continue
          const grupo = entry.tipo === 'ABONO' ? gruposEntradas : gruposSalidas
          if (!grupo.has(cm.id)) grupo.set(cm.id, { cm, subs: [] })
          grupo.get(cm.id).subs.push(entry)
        }

        // Sorteo por suma real
        const finalizar = grupo => Array.from(grupo.values()).map(g => ({
          ...g,
          subs: g.subs.sort((a, b) => (b.totalReal + b.totalProy) - (a.totalReal + a.totalProy)),
        })).sort((a, b) => {
          const sa = a.subs.reduce((s, x) => s + x.totalReal + x.totalProy, 0)
          const sb = b.subs.reduce((s, x) => s + x.totalReal + x.totalProy, 0)
          return sb - sa
        })

        // Totales por mes (agregados)
        const totMes = {}
        for (let m = 1; m <= 12; m++) totMes[m] = { entReal: 0, entProy: 0, salReal: 0, salProy: 0 }
        for (const [, entry] of dataMap) {
          for (const mes in entry.meses) {
            const v = entry.meses[mes]
            if (entry.tipo === 'ABONO') {
              totMes[mes].entReal += v.real
              totMes[mes].entProy += v.proy
            } else {
              totMes[mes].salReal += v.real
              totMes[mes].salProy += v.proy
            }
          }
        }

        if (!cancelado) setData({
          entradas: finalizar(gruposEntradas),
          salidas:  finalizar(gruposSalidas),
          totMes,
        })
      } catch (e) {
        toast.error('Error: ' + (e instanceof Error ? e.message : '?'))
        setData(null)
      } finally { if (!cancelado) setLoading(false) }
    })()
    return () => { cancelado = true }
  }, [anio, escenario])

  // Mes actual (para saber qué meses tienen real significativo)
  const mesActual = new Date().getMonth() + 1
  const anioActual = new Date().getFullYear()
  const mesesCerrados = anio < anioActual ? 12 : anio > anioActual ? 0 : mesActual - 1

  function toggleExpand(key) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // KPIs totales
  const kpis = useMemo(() => {
    if (!data) return null
    let entReal = 0, entProy = 0, salReal = 0, salProy = 0
    for (let m = 1; m <= 12; m++) {
      entReal += data.totMes[m].entReal
      entProy += data.totMes[m].entProy
      salReal += data.totMes[m].salReal
      salProy += data.totMes[m].salProy
    }
    return { entReal, entProy, salReal, salProy }
  }, [data])

  function renderGrupo(g, tipo) {
    const expandKey = tipo + '_' + g.cm.id
    const isOpen = expanded.has(expandKey)
    const totalCmReal = Array(13).fill(0)
    const totalCmProy = Array(13).fill(0)
    for (const sub of g.subs) {
      for (const mes in sub.meses) {
        totalCmReal[mes] += sub.meses[mes].real
        totalCmProy[mes] += sub.meses[mes].proy
      }
    }
    const totRealAnio = totalCmReal.reduce((s, n) => s + n, 0)
    const totProyAnio = totalCmProy.reduce((s, n) => s + n, 0)
    const dif = totRealAnio - totProyAnio
    const pct = totProyAnio > 0 ? (dif / totProyAnio) * 100 : null
    const malo = tipo === 'CARGO' ? dif > 0 : dif < 0  // gasto excedió o ingreso bajo del esperado

    const bgGrupo = tipo === 'ABONO' ? '#F0FDF4' : '#FEF2F2'

    return (
      <>
        <tr key={g.cm.id} onClick={() => toggleExpand(expandKey)}
          style={{ cursor: 'pointer', background: bgGrupo, fontWeight: 600 }}>
          <td style={{ ...TD, display: 'flex', alignItems: 'center', gap: 4 }}>
            {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <span>{g.cm.nombre}</span>
          </td>
          <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{fmtCLP(totRealAnio)}</td>
          <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#6B7280' }}>{fmtCLP(totProyAnio)}</td>
          <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: malo ? '#DC2626' : '#15803D', fontWeight: 700 }}>
            {fmtCLP(dif)}
          </td>
          <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: malo ? '#DC2626' : '#15803D', fontWeight: 700 }}>
            {fmtPct(pct)}
            {Math.abs(pct ?? 0) >= 15 && (malo ? <AlertTriangle size={11} style={{ display: 'inline', marginLeft: 4 }} /> : <CheckCircle2 size={11} style={{ display: 'inline', marginLeft: 4 }} />)}
          </td>
        </tr>
        {isOpen && g.subs.map(sub => {
          const dif = sub.totalReal - sub.totalProy
          const pct = sub.totalProy > 0 ? (dif / sub.totalProy) * 100 : null
          const subMalo = tipo === 'CARGO' ? dif > 0 : dif < 0
          return (
            <tr key={sub.sub.id}>
              <td style={{ ...TD, paddingLeft: 26, color: '#6B7280' }}>↳ {sub.sub.nombre}</td>
              <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{fmtCLP(sub.totalReal)}</td>
              <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#6B7280' }}>{fmtCLP(sub.totalProy)}</td>
              <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: subMalo ? '#DC2626' : '#15803D' }}>{fmtCLP(dif)}</td>
              <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: subMalo ? '#DC2626' : '#15803D' }}>{fmtPct(pct)}</td>
            </tr>
          )
        })}
      </>
    )
  }

  const escenSelec = ESCENARIOS.find(e => e.k === escenario)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Controles */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '12px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div>
          <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>Escenario a comparar</div>
          <div style={{ display: 'flex', gap: 4, background: '#F1F5F9', borderRadius: 8, padding: 3 }}>
            {ESCENARIOS.map(e => (
              <button key={e.k} onClick={() => setEscenario(e.k)} style={{
                padding: '5px 14px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: escenario === e.k ? '#fff' : 'transparent',
                color: escenario === e.k ? e.color : '#64748B',
                boxShadow: escenario === e.k ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}>{e.l}</button>
            ))}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: '#6B7280' }}>
          Período: {anio} · Meses cerrados: {mesesCerrados}
        </div>
      </div>

      {/* KPIs */}
      {kpis && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          <KpiComparativo label="Entradas" real={kpis.entReal} proy={kpis.entProy} tipo="ABONO" />
          <KpiComparativo label="Salidas"  real={kpis.salReal} proy={kpis.salProy} tipo="CARGO" />
        </div>
      )}

      {/* Tabla */}
      <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center' }}><Loader2 size={22} color="#9CA3AF" /></div>
        ) : !data || (data.entradas.length === 0 && data.salidas.length === 0) ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#94A3B8' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Sin datos para comparar</div>
            <div style={{ fontSize: 12, marginTop: 6 }}>Necesitas movimientos clasificados y proyección guardada en el escenario "{escenario}".</div>
          </div>
        ) : (
          <div style={{ overflow: 'auto', maxHeight: '70vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 800 }}>
              <thead>
                <tr>
                  <th style={{ ...TH, minWidth: 240, left: 0, zIndex: 3 }}>Concepto</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Real {anio}</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Proyectado ({escenSelec.l})</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Diferencia</th>
                  <th style={{ ...TH, textAlign: 'right' }}>%</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ background: '#16A34A' }}>
                  <td colSpan={5} style={{ ...TD, color: '#fff', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>↑ ENTRADAS</td>
                </tr>
                {data.entradas.map(g => renderGrupo(g, 'ABONO'))}

                <tr style={{ background: '#DC2626' }}>
                  <td colSpan={5} style={{ ...TD, color: '#fff', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>↓ SALIDAS</td>
                </tr>
                {data.salidas.map(g => renderGrupo(g, 'CARGO'))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'linear-gradient(to right, #1E3A5F, #1E40AF)', color: '#fff', fontWeight: 700 }}>
                  <td style={{ ...TD, color: '#fff', borderBottom: 'none', fontSize: 12 }}>VARIACIÓN NETA</td>
                  <td style={{ ...TD, color: '#fff', textAlign: 'right', fontFamily: 'monospace', borderBottom: 'none' }}>
                    {fmtCLP(kpis ? kpis.entReal - kpis.salReal : 0)}
                  </td>
                  <td style={{ ...TD, color: '#fff', textAlign: 'right', fontFamily: 'monospace', borderBottom: 'none', opacity: 0.85 }}>
                    {fmtCLP(kpis ? kpis.entProy - kpis.salProy : 0)}
                  </td>
                  <td style={{ ...TD, color: '#fff', textAlign: 'right', fontFamily: 'monospace', borderBottom: 'none' }}>
                    {fmtCLP(kpis ? (kpis.entReal - kpis.salReal) - (kpis.entProy - kpis.salProy) : 0)}
                  </td>
                  <td style={{ ...TD, color: '#fff', borderBottom: 'none' }} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function KpiComparativo({ label, real, proy, tipo }) {
  const dif = real - proy
  const pct = proy > 0 ? (dif / proy) * 100 : null
  const malo = tipo === 'CARGO' ? dif > 0 : dif < 0
  const color = tipo === 'ABONO' ? '#16A34A' : '#DC2626'
  return (
    <div style={{
      background: '#fff', borderRadius: 10, padding: '14px 18px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      display: 'flex', alignItems: 'center', gap: 16,
    }}>
      <div style={{ background: tipo === 'ABONO' ? '#F0FDF4' : '#FEF2F2', borderRadius: 8, padding: 10 }}>
        {tipo === 'ABONO' ? <TrendingUp size={20} color={color} /> : <TrendingDown size={20} color={color} />}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginTop: 2 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: '#111827' }}>{fmtCLP(real)}</span>
          <span style={{ fontSize: 11, color: '#9CA3AF' }}>vs proy. {fmtCLP(proy)}</span>
        </div>
      </div>
      <div style={{
        background: malo ? '#FEE2E2' : '#DCFCE7',
        color: malo ? '#991B1B' : '#166534',
        padding: '4px 10px', borderRadius: 6,
        fontSize: 12, fontWeight: 700, fontFamily: 'monospace',
      }}>
        {fmtPct(pct)}
      </div>
    </div>
  )
}
