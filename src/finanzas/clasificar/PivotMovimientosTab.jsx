import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, ChevronRight, ChevronDown, Download, TrendingDown, TrendingUp, BarChart3 } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabase'
import { MESES_CORTOS, nombreMes } from './types'

const PRIMARY = '#1F4E79'

function fmtCLP(n) {
  if (n == null || n === 0) return '—'
  return '$' + Math.round(n).toLocaleString('es-CL')
}

const TH = { padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#374151', letterSpacing: '0.03em', background: '#F1F5F9', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2 }
const TD = { padding: '7px 10px', fontSize: 12, color: '#374151', verticalAlign: 'middle', borderBottom: '1px solid #F1F5F9' }

export function PivotMovimientosTab() {
  const [tipo, setTipo]           = useState('CARGO')      // CARGO | ABONO
  const [agrupacion, setAgrupacion] = useState('subcuenta') // subcuenta | ceco
  const [anio, setAnio]           = useState(new Date().getFullYear())
  const [data, setData]           = useState(null)        // { rows, meses, total }
  const [loading, setLoading]     = useState(true)
  const [expanded, setExpanded]   = useState(new Set())   // cuenta_madre_ids expandidos

  // Carga data: movimientos clasificados del año + catálogos
  useEffect(() => {
    let cancelado = false
    ;(async () => {
      setLoading(true)
      try {
        const desde = `${anio}-01-01`
        const hasta = `${anio}-12-31`
        const [movR, cmR, scR, ccR] = await Promise.all([
          supabase.from('movimientos_bancarios')
            .select('id, monto, tipo, fecha, mes_nominal, subcuenta_id, ceco_id, estado')
            .eq('tipo', tipo)
            .gte('fecha', desde).lte('fecha', hasta)
            .in('estado', ['clasificado'])
            .not('subcuenta_id', 'is', null)
            .limit(50000),
          supabase.from('cuentas_madre').select('id, nombre, codigo, tipo').eq('activa', true),
          supabase.from('subcuentas').select('id, nombre, cuenta_madre_id').eq('activa', true),
          supabase.from('centros_costo').select('id, nombre'),
        ])
        if (cancelado) return
        if (movR.error) throw movR.error
        const movs   = movR.data ?? []
        const cuentas    = cmR.data ?? []
        const subcuentas = scR.data ?? []
        const cecos      = ccR.data ?? []

        const cmById  = new Map(cuentas.map(c => [c.id, c]))
        const scById  = new Map(subcuentas.map(s => [s.id, s]))
        const ccById  = new Map(cecos.map(c => [c.id, c]))

        // Estructura: cuenta_madre → subcuenta/ceco → mes → monto
        // grupos[cmId] = { cm, hijos: Map<hijoId, { hijo, meses: {1: n, 2: n,...}, total }>, mesesTotal, total }
        const grupos = new Map()
        for (const m of movs) {
          const sc = scById.get(m.subcuenta_id); if (!sc) continue
          const cm = cmById.get(sc.cuenta_madre_id); if (!cm) continue
          const mes = m.mes_nominal ?? new Date(m.fecha).getMonth() + 1
          const monto = Math.abs(Number(m.monto) || 0)

          const hijoId = agrupacion === 'subcuenta' ? sc.id : (m.ceco_id ?? 'sin_ceco')
          const hijoNombre = agrupacion === 'subcuenta' ? sc.nombre : (m.ceco_id ? (ccById.get(m.ceco_id)?.nombre ?? '—') : 'Sin CECO')

          if (!grupos.has(cm.id)) {
            grupos.set(cm.id, {
              cm,
              hijos: new Map(),
              mesesTotal: {},
              total: 0,
            })
          }
          const grupo = grupos.get(cm.id)
          if (!grupo.hijos.has(hijoId)) {
            grupo.hijos.set(hijoId, { id: hijoId, nombre: hijoNombre, meses: {}, total: 0 })
          }
          const hijo = grupo.hijos.get(hijoId)
          hijo.meses[mes] = (hijo.meses[mes] ?? 0) + monto
          hijo.total += monto
          grupo.mesesTotal[mes] = (grupo.mesesTotal[mes] ?? 0) + monto
          grupo.total += monto
        }

        // Convertir a array ordenado y calcular totales por mes
        const totalesPorMes = {}
        let totalGeneral = 0
        const rows = []
        for (const grupo of grupos.values()) {
          rows.push({
            tipo: 'madre',
            id: grupo.cm.id,
            nombre: grupo.cm.nombre,
            codigo: grupo.cm.codigo,
            meses: grupo.mesesTotal,
            total: grupo.total,
            hijos: Array.from(grupo.hijos.values()).sort((a, b) => b.total - a.total),
          })
          for (const mes in grupo.mesesTotal) {
            totalesPorMes[mes] = (totalesPorMes[mes] ?? 0) + grupo.mesesTotal[mes]
          }
          totalGeneral += grupo.total
        }
        rows.sort((a, b) => b.total - a.total)

        setData({ rows, totalesPorMes, totalGeneral, meses: Array.from({ length: 12 }, (_, i) => i + 1) })
      } catch (e) {
        console.error('[Pivot] Error:', e)
        toast.error('Error cargando datos: ' + (e instanceof Error ? e.message : '?'))
        setData(null)
      } finally { if (!cancelado) setLoading(false) }
    })()
    return () => { cancelado = true }
  }, [tipo, agrupacion, anio])

  function toggleExpand(id) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function expandirTodos() {
    if (!data) return
    setExpanded(new Set(data.rows.map(r => r.id)))
  }
  function colapsarTodos() { setExpanded(new Set()) }

  function exportarExcel() {
    if (!data) return
    const headers = ['Cuenta madre', ...MESES_CORTOS, 'Total']
    const rows = []
    for (const r of data.rows) {
      rows.push([r.nombre, ...data.meses.map(m => r.meses[m] ?? 0), r.total])
      for (const h of r.hijos) {
        rows.push(['  ↳ ' + h.nombre, ...data.meses.map(m => h.meses[m] ?? 0), h.total])
      }
    }
    rows.push(['TOTAL', ...data.meses.map(m => data.totalesPorMes[m] ?? 0), data.totalGeneral])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Pivot')
    XLSX.writeFile(wb, `pivot_${tipo.toLowerCase()}_${agrupacion}_${anio}.xlsx`)
  }

  const aniosOpts = [new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Controles */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '14px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>Tipo</div>
          <div style={{ display: 'flex', gap: 4, background: '#F1F5F9', borderRadius: 8, padding: 3 }}>
            {[
              { k: 'CARGO', l: 'Gastos', icon: <TrendingDown size={12} />, color: '#DC2626' },
              { k: 'ABONO', l: 'Ingresos', icon: <TrendingUp size={12} />, color: '#16A34A' },
            ].map(({ k, l, icon, color }) => (
              <button key={k} onClick={() => setTipo(k)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '5px 12px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: tipo === k ? '#fff' : 'transparent',
                color: tipo === k ? color : '#64748B',
                boxShadow: tipo === k ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}>{icon} {l}</button>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>Desglose</div>
          <div style={{ display: 'flex', gap: 4, background: '#F1F5F9', borderRadius: 8, padding: 3 }}>
            {[
              { k: 'subcuenta', l: 'Por subcuenta' },
              { k: 'ceco',      l: 'Por centro de costo' },
            ].map(({ k, l }) => (
              <button key={k} onClick={() => setAgrupacion(k)} style={{
                padding: '5px 12px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: agrupacion === k ? '#fff' : 'transparent',
                color: agrupacion === k ? PRIMARY : '#64748B',
                boxShadow: agrupacion === k ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}>{l}</button>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>Año</div>
          <select value={anio} onChange={e => setAnio(Number(e.target.value))}
            style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 13, background: '#fff', cursor: 'pointer' }}>
            {aniosOpts.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button onClick={expandirTodos}
            style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid #E2E8F0', background: '#fff', fontSize: 12, color: '#475569', cursor: 'pointer', fontWeight: 600 }}>
            Expandir todo
          </button>
          <button onClick={colapsarTodos}
            style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid #E2E8F0', background: '#fff', fontSize: 12, color: '#475569', cursor: 'pointer', fontWeight: 600 }}>
            Colapsar todo
          </button>
          <button onClick={exportarExcel} disabled={!data || loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, border: 'none', background: PRIMARY, color: '#fff', fontSize: 12, cursor: 'pointer', fontWeight: 600, opacity: !data || loading ? 0.5 : 1 }}>
            <Download size={12} /> Excel
          </button>
        </div>
      </div>

      {/* KPI grande */}
      {data && (
        <div style={{
          background: tipo === 'CARGO' ? 'linear-gradient(135deg, #FEF2F2, #FEE2E2)' : 'linear-gradient(135deg, #F0FDF4, #DCFCE7)',
          border: `1px solid ${tipo === 'CARGO' ? '#FCA5A5' : '#86EFAC'}`,
          borderRadius: 12, padding: '14px 20px',
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 10, display: 'flex' }}>
            {tipo === 'CARGO' ? <TrendingDown size={22} color="#DC2626" /> : <TrendingUp size={22} color="#16A34A" />}
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: tipo === 'CARGO' ? '#991B1B' : '#166534', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Total {tipo === 'CARGO' ? 'gastos' : 'ingresos'} {anio}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: tipo === 'CARGO' ? '#DC2626' : '#16A34A' }}>
              {fmtCLP(data.totalGeneral)}
            </div>
            <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
              {data.rows.length} cuentas madre · {data.rows.reduce((s, r) => s + r.hijos.length, 0)} {agrupacion === 'subcuenta' ? 'subcuentas' : 'centros de costo'}
            </div>
          </div>
        </div>
      )}

      {/* Tabla pivot */}
      <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '60px 0', textAlign: 'center' }}>
            <Loader2 size={22} style={{ display: 'inline-block', color: '#9CA3AF' }} />
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: '#9CA3AF' }}>
            <BarChart3 size={40} style={{ display: 'inline-block', marginBottom: 12, opacity: 0.4 }} />
            <div style={{ fontSize: 14, fontWeight: 600 }}>Sin datos para mostrar</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              No hay movimientos clasificados de tipo {tipo === 'CARGO' ? 'gasto' : 'ingreso'} en {anio}.
              <br />Clasifica movimientos en el tab "Clasificar" para verlos aquí.
            </div>
          </div>
        ) : (
          <div style={{ overflow: 'auto', maxHeight: '70vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 1100 }}>
              <thead>
                <tr>
                  <th style={{ ...TH, minWidth: 260, left: 0, zIndex: 3 }}>
                    {agrupacion === 'subcuenta' ? 'Cuenta / Subcuenta' : 'Cuenta / Centro de costo'}
                  </th>
                  {data.meses.map(m => (
                    <th key={m} style={{ ...TH, textAlign: 'right', minWidth: 90 }}>{MESES_CORTOS[m - 1]}</th>
                  ))}
                  <th style={{ ...TH, textAlign: 'right', background: '#E0F2FE', color: '#0369A1', minWidth: 110 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(r => {
                  const isOpen = expanded.has(r.id)
                  return (
                    <>
                      {/* Cuenta madre */}
                      <tr key={r.id}
                        onClick={() => toggleExpand(r.id)}
                        style={{ background: '#F8FAFC', cursor: 'pointer', fontWeight: 600 }}
                        onMouseEnter={e => e.currentTarget.style.background = '#EFF6FF'}
                        onMouseLeave={e => e.currentTarget.style.background = '#F8FAFC'}>
                        <td style={{ ...TD, display: 'flex', alignItems: 'center', gap: 4 }}>
                          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          <span>{r.nombre}</span>
                          {r.codigo && <span style={{ fontSize: 10, color: '#9CA3AF', fontFamily: 'monospace', marginLeft: 6 }}>{r.codigo}</span>}
                        </td>
                        {data.meses.map(m => (
                          <td key={m} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: r.meses[m] ? '#111827' : '#D1D5DB' }}>
                            {fmtCLP(r.meses[m])}
                          </td>
                        ))}
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: tipo === 'CARGO' ? '#DC2626' : '#16A34A', background: '#F0F9FF' }}>
                          {fmtCLP(r.total)}
                        </td>
                      </tr>

                      {/* Hijos (subcuentas o CECOs) */}
                      {isOpen && r.hijos.map(h => (
                        <tr key={r.id + '-' + h.id} style={{ background: '#fff' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#F9FAFB'}
                          onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                          <td style={{ ...TD, paddingLeft: 30, color: '#6B7280', fontSize: 11 }}>
                            ↳ {h.nombre}
                          </td>
                          {data.meses.map(m => (
                            <td key={m} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: h.meses[m] ? '#475569' : '#E2E8F0' }}>
                              {fmtCLP(h.meses[m])}
                            </td>
                          ))}
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, fontSize: 11, color: '#475569', background: '#F8FAFC' }}>
                            {fmtCLP(h.total)}
                          </td>
                        </tr>
                      ))}
                    </>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'linear-gradient(to right, #1E3A5F, #1E40AF)', color: '#fff', fontWeight: 700 }}>
                  <td style={{ ...TD, color: '#fff', fontSize: 13, borderBottom: 'none' }}>TOTAL</td>
                  {data.meses.map(m => (
                    <td key={m} style={{ ...TD, color: '#fff', textAlign: 'right', fontFamily: 'monospace', borderBottom: 'none' }}>
                      {fmtCLP(data.totalesPorMes[m])}
                    </td>
                  ))}
                  <td style={{ ...TD, color: '#fff', textAlign: 'right', fontFamily: 'monospace', fontSize: 14, fontWeight: 800, borderBottom: 'none' }}>
                    {fmtCLP(data.totalGeneral)}
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
