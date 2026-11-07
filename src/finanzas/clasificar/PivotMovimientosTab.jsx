import { Fragment, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, ChevronRight, ChevronDown, Download, TrendingDown, TrendingUp, BarChart3 } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabase'
import { MESES_CORTOS, nombreMes } from './types'
import { naturalezaSubcuenta, seccionPorCuenta, SECCIONES } from './seccionFlujo'

const PRIMARY = '#1F4E79'

function fmtCLP(n) {
  if (n == null || n === 0) return '—'
  return '$' + Math.round(n).toLocaleString('es-CL')
}

function fmtSigned(n) {
  if (n == null || Math.round(n) === 0) return '—'
  return (n > 0 ? '+' : '−') + '$' + Math.abs(Math.round(n)).toLocaleString('es-CL')
}

// PostgREST entrega máximo 1.000 filas por consulta: se pide por páginas.
// (Antes el reporte usaba un solo .limit(50000) y quedaba truncado en 1.000 movimientos.)
async function traerTodo(armar, orden = 'id', tope = 200000) {
  const out = []
  for (let desde = 0; desde < tope; desde += 1000) {
    const { data, error } = await armar().order(orden).range(desde, desde + 999)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

// Filas del comparativo (las usa la tabla y la exportación)
function filasComparativo(d) {
  const cu = d.modoCuadratura
  const f = [
    { k: 'ing', label: cu ? 'Ingresos' : 'Ingresos operacionales', serie: d.ingresos, signo: 1, estilo: 'ing' },
    { k: 'gas', label: cu ? 'Gastos' : 'Gastos operacionales', serie: d.gastos, signo: -1, estilo: 'gas' },
    { k: 'res', label: cu ? 'Neto banco del mes' : 'Flujo operacional', serie: d.resultado, signo: 1, estilo: 'res' },
  ]
  if (!cu) f.push(
    { k: 'inv', label: 'Inversión (activo fijo y préstamos)', serie: d.inversion, signo: -1, estilo: 'sec' },
    { k: 'fin', label: 'Financiamiento neto (créditos e intereses)', serie: d.financiamiento, signo: 1, estilo: 'sec' },
    { k: 'neto', label: 'Flujo neto del período', serie: d.flujoNeto, signo: 1, estilo: 'res' },
  )
  return f
}

const TH = { padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#374151', letterSpacing: '0.03em', background: '#F1F5F9', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2 }
const TD = { padding: '7px 10px', fontSize: 12, color: '#374151', verticalAlign: 'middle', borderBottom: '1px solid #F1F5F9' }

export function PivotMovimientosTab() {
  const [tipo, setTipo]           = useState('CARGO')      // CARGO | ABONO
  const [agrupacion, setAgrupacion] = useState('subcuenta') // subcuenta | ceco
  const [vista, setVista]         = useState('analitico')  // analitico | cuadratura (solo aplica en COMPARATIVO)
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
        // En modo comparativo cargamos CARGO y ABONO juntos
        const tipoFilter = tipo === 'COMPARATIVO' ? ['CARGO', 'ABONO'] : [tipo]
        // Modo cuadratura: solo aplica en comparativo. Carga todos los estados, sin filtro de subcuenta.
        const modoCuadratura = (tipo === 'COMPARATIVO' && vista === 'cuadratura')
        const armarMov = () => {
          let q = supabase.from('movimientos_bancarios')
            .select('id, monto, tipo, fecha, mes_nominal, subcuenta_id, ceco_id, estado')
            .in('tipo', tipoFilter)
            .gte('fecha', desde).lte('fecha', hasta)
          // Vista analítico: solo clasificados con subcuenta
          if (!modoCuadratura) q = q.in('estado', ['clasificado']).not('subcuenta_id', 'is', null)
          return q
        }
        // La tarjeta se muestra por su detalle (estados de cuenta) en lugar del pago en bloque desde el banco
        const conTarjeta = !modoCuadratura && (tipo === 'CARGO' || tipo === 'COMPARATIVO')
        const [movs, cuentas, subcuentas, cecos, tarjeta] = await Promise.all([
          traerTodo(armarMov),
          traerTodo(() => supabase.from('cuentas_madre').select('id, nombre, codigo, tipo, plan_cuenta_codigo').eq('activa', true)),
          traerTodo(() => supabase.from('subcuentas').select('id, nombre, codigo, cuenta_madre_id, plan_cuenta_codigo, plan_cuenta_factura').eq('activa', true)),
          traerTodo(() => supabase.from('centros_costo').select('id, nombre')),
          conTarjeta
            ? traerTodo(() => supabase.from('v_tc_clasificado').select('id, periodo, cuenta, monto').gte('periodo', `${anio}-01`).lte('periodo', `${anio}-12`))
            : Promise.resolve([]),
        ])
        if (cancelado) return
        const cuentasTc = [...new Set(tarjeta.map(t => t.cuenta).filter(Boolean))]
        const planes = cuentasTc.length
          ? await traerTodo(() => supabase.from('plan_cuentas').select('codigo, nombre').in('codigo', cuentasTc), 'codigo')
          : []
        if (cancelado) return

        const cmById  = new Map(cuentas.map(c => [c.id, c]))
        const scById  = new Map(subcuentas.map(s => [s.id, s]))
        const ccById  = new Map(cecos.map(c => [c.id, c]))
        const planNombre = new Map(planes.map(p => [p.codigo, p.nombre]))

        // Helper: parsea 'YYYY-MM-DD' sin conversión de timezone (evita bug de día 01 retrocediendo al mes anterior)
        const mesDeFecha = (s) => {
          if (!s) return null
          const partes = String(s).split('-')
          return parseInt(partes[1], 10)
        }
        // Sección de cada movimiento (operación / inversión / financiamiento / tarjeta / traspaso), ver seccionFlujo.js
        const seccionMov = (m) => {
          const sc = scById.get(m.subcuenta_id); const cm = sc ? cmById.get(sc.cuenta_madre_id) : null
          if (!sc || !cm) return null
          return { sc, cm, sec: seccionPorCuenta(naturalezaSubcuenta(sc, cm), cm.tipo) }
        }
        // Cuenta madre del gasto con tarjeta: la que tiene más subcuentas con esa cuenta contable
        const madrePorPlan = new Map()
        {
          const conteo = new Map()
          for (const sc of subcuentas) {
            const cm = cmById.get(sc.cuenta_madre_id)
            if (!cm || cm.tipo === 'traspaso' || cm.tipo === 'financiamiento') continue
            const plan = naturalezaSubcuenta(sc, cm); if (!plan) continue
            const k = plan + '|' + cm.id
            conteo.set(k, (conteo.get(k) ?? 0) + 1)
          }
          for (const [k, n] of conteo) {
            const [plan, cmId] = k.split('|')
            const cm = cmById.get(cmId); const prev = madrePorPlan.get(plan)
            if (!prev || n > prev.n || (n === prev.n && String(cm.codigo) < String(prev.cm.codigo))) madrePorPlan.set(plan, { cm, n })
          }
        }
        const MADRE_TC = { id: 'tarjeta', nombre: 'TARJETA DE CRÉDITO', codigo: '💳', tipo: 'gasto' }
        const lineasTc = tarjeta.map(t => {
          const plan = String(t.cuenta ?? '')
          const sec = seccionPorCuenta(plan, null)
          // 2170201 = pago con tarjeta de una factura ya registrada · 1810101 = gasto aún por decidir
          const directo = plan === '2170201' || plan === '1810101' || !madrePorPlan.has(plan)
          const nombrePlan = plan === '2170201' ? 'Pago de facturas con tarjeta' : plan === '1810101' ? 'Gasto por decidir' : (planNombre.get(plan) ?? plan)
          return {
            mes: parseInt(String(t.periodo).slice(5, 7), 10), monto: Number(t.monto) || 0, plan,
            sec: sec === 'tarjeta' ? 'operacion' : sec, cm: directo ? MADRE_TC : madrePorPlan.get(plan).cm,
            nombre: '💳 Tarjeta · ' + nombrePlan,
          }
        })

        // ── MODO COMPARATIVO ──
        if (tipo === 'COMPARATIVO') {
          const ing = {}, gas = {}, inv = {}, fin = {}
          const sumar = (o, mes, v) => { o[mes] = (o[mes] ?? 0) + v }
          let pagosTarjeta = 0
          for (const m of movs) {
            const monto = Math.abs(Number(m.monto) || 0)
            if (modoCuadratura) {
              // Cuadratura banco: todo lo que entra y sale de la cuenta, por mes calendario (incluye traspasos y créditos)
              const mes = mesDeFecha(m.fecha)
              if (m.tipo === 'ABONO') sumar(ing, mes, monto); else if (m.tipo === 'CARGO') sumar(gas, mes, monto)
              continue
            }
            const x = seccionMov(m); if (!x || x.sec === 'traspaso') continue
            const mes = m.mes_nominal ?? mesDeFecha(m.fecha)
            if (x.sec === 'tarjeta') { if (m.tipo === 'CARGO') pagosTarjeta += monto; continue }
            if (x.sec === 'operacion') { if (m.tipo === 'ABONO') sumar(ing, mes, monto); else sumar(gas, mes, monto) }
            else if (x.sec === 'inversion') sumar(inv, mes, m.tipo === 'CARGO' ? monto : -monto)
            else if (x.sec === 'financiamiento') sumar(fin, mes, m.tipo === 'ABONO' ? monto : -monto)
          }
          for (const t of lineasTc) {
            if (t.sec === 'inversion') sumar(inv, t.mes, t.monto)
            else if (t.sec === 'financiamiento') sumar(fin, t.mes, -t.monto)
            else sumar(gas, t.mes, t.monto)
          }
          const tot = o => Object.values(o).reduce((a, v) => a + v, 0)
          const meses = Array.from({ length: 12 }, (_, i) => i + 1)
          const res = Object.fromEntries(meses.map(mm => [mm, (ing[mm] ?? 0) - (gas[mm] ?? 0)]))
          const neto = Object.fromEntries(meses.map(mm => [mm, res[mm] - (inv[mm] ?? 0) + (fin[mm] ?? 0)]))
          const totIng = tot(ing), totGas = tot(gas), totRes = totIng - totGas
          setData({
            modoComparativo: true, modoCuadratura, meses,
            ingresos: { meses: ing, total: totIng },
            gastos:   { meses: gas, total: totGas },
            resultado: { meses: res, total: totRes },
            inversion: { meses: inv, total: tot(inv) },
            financiamiento: { meses: fin, total: tot(fin) },
            flujoNeto: { meses: neto, total: totRes - tot(inv) + tot(fin) },
            tarjeta: modoCuadratura ? null : { pagos: pagosTarjeta, detalle: lineasTc.reduce((a, t) => a + t.monto, 0) },
            margenPct: totIng > 0 ? (totRes / totIng) * 100 : 0,
          })
          return
        }

        // ── MODO NORMAL: sección → cuenta madre → subcuenta/ceco → mes → monto ──
        const porSeccion = new Map()
        const excluidos = { traspasos: 0, pagosTarjeta: 0, detalleTarjeta: 0 }
        const agregar = (sec, cm, hijoId, hijoNombre, mes, monto) => {
          if (!porSeccion.has(sec)) porSeccion.set(sec, new Map())
          const grupos = porSeccion.get(sec)
          const gid = sec + ':' + cm.id
          if (!grupos.has(gid)) grupos.set(gid, { cm, id: gid, hijos: new Map(), mesesTotal: {}, total: 0 })
          const g = grupos.get(gid)
          if (!g.hijos.has(hijoId)) g.hijos.set(hijoId, { id: hijoId, nombre: hijoNombre, meses: {}, total: 0 })
          const h = g.hijos.get(hijoId)
          h.meses[mes] = (h.meses[mes] ?? 0) + monto; h.total += monto
          g.mesesTotal[mes] = (g.mesesTotal[mes] ?? 0) + monto; g.total += monto
        }
        for (const m of movs) {
          const x = seccionMov(m); if (!x) continue
          const monto = Math.abs(Number(m.monto) || 0)
          if (x.sec === 'traspaso') { excluidos.traspasos += monto; continue }   // traspasos entre cuentas propias: fuera del análisis
          if (x.sec === 'tarjeta' && tipo === 'CARGO') { excluidos.pagosTarjeta += monto; continue }   // se reemplaza por el detalle
          const mes = m.mes_nominal ?? mesDeFecha(m.fecha)
          const hijoId = agrupacion === 'subcuenta' ? x.sc.id : (m.ceco_id ?? 'sin_ceco')
          const hijoNombre = agrupacion === 'subcuenta' ? x.sc.nombre : (m.ceco_id ? (ccById.get(m.ceco_id)?.nombre ?? '—') : 'Sin CECO')
          agregar(x.sec === 'tarjeta' ? 'operacion' : x.sec, x.cm, hijoId, hijoNombre, mes, monto)
        }
        if (tipo === 'CARGO') for (const t of lineasTc) {
          excluidos.detalleTarjeta += t.monto
          agregar(t.sec, t.cm, agrupacion === 'subcuenta' ? 'tc:' + t.plan : 'tc',
            agrupacion === 'subcuenta' ? t.nombre : '💳 Tarjeta de crédito (sin centro de costo)', t.mes, t.monto)
        }
        const secciones = []
        const totalesPorMes = {}
        let totalGeneral = 0
        for (const s of SECCIONES) {
          const grupos = porSeccion.get(s.k); if (!grupos) continue
          const rows = Array.from(grupos.values()).map(g => ({
            tipo: 'madre', id: g.id, nombre: g.cm.nombre, codigo: g.cm.codigo, meses: g.mesesTotal, total: g.total,
            hijos: Array.from(g.hijos.values()).sort((a, b) => b.total - a.total),
          })).sort((a, b) => b.total - a.total)
          const mesesSec = {}
          let totalSec = 0
          for (const r of rows) { for (const mm in r.meses) mesesSec[mm] = (mesesSec[mm] ?? 0) + r.meses[mm]; totalSec += r.total }
          for (const mm in mesesSec) totalesPorMes[mm] = (totalesPorMes[mm] ?? 0) + mesesSec[mm]
          totalGeneral += totalSec
          secciones.push({ ...s, rows, meses: mesesSec, total: totalSec })
        }

        setData({ secciones, totalesPorMes, totalGeneral, excluidos, meses: Array.from({ length: 12 }, (_, i) => i + 1) })
      } catch (e) {
        console.error('[Pivot] Error:', e)
        toast.error('Error cargando datos: ' + (e instanceof Error ? e.message : '?'))
        setData(null)
      } finally { if (!cancelado) setLoading(false) }
    })()
    return () => { cancelado = true }
  }, [tipo, agrupacion, anio, vista])

  function toggleExpand(id) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function expandirTodos() {
    if (!data || data.modoComparativo) return
    setExpanded(new Set(data.secciones.flatMap(s => s.rows.map(r => r.id))))
  }
  function colapsarTodos() { setExpanded(new Set()) }

  function exportarExcel() {
    if (!data) return
    const wb = XLSX.utils.book_new()
    if (data.modoComparativo) {
      const headers = ['Concepto', ...MESES_CORTOS, 'Total']
      const rows = filasComparativo(data).map(f => [f.label, ...data.meses.map(m => f.signo * (f.serie.meses[m] ?? 0)), f.signo * f.serie.total])
      if (data.tarjeta) rows.push([], [`Tarjeta: pagos desde el banco ${Math.round(data.tarjeta.pagos)} reemplazados por su detalle ${Math.round(data.tarjeta.detalle)}`])
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Comparativo')
      XLSX.writeFile(wb, `comparativo_${data.modoCuadratura ? 'cuadratura' : 'analitico'}_${anio}.xlsx`)
      return
    }
    // Modo normal: por sección (operación / inversión / financiamiento)
    const headers = ['Cuenta madre', ...MESES_CORTOS, 'Total']
    const rows = []
    for (const sec of data.secciones) {
      rows.push([sec.nombre.toUpperCase()])
      for (const r of sec.rows) {
        rows.push([r.nombre, ...data.meses.map(m => r.meses[m] ?? 0), r.total])
        for (const h of r.hijos) rows.push(['  ↳ ' + h.nombre, ...data.meses.map(m => h.meses[m] ?? 0), h.total])
      }
      rows.push(['Subtotal ' + sec.nombre, ...data.meses.map(m => sec.meses[m] ?? 0), sec.total], [])
    }
    rows.push(['TOTAL', ...data.meses.map(m => data.totalesPorMes[m] ?? 0), data.totalGeneral])
    const ex = data.excluidos
    if (ex.traspasos) rows.push([`Fuera del análisis: traspasos entre cuentas propias ${Math.round(ex.traspasos)}`])
    if (ex.pagosTarjeta || ex.detalleTarjeta) rows.push([`Tarjeta: pagos desde el banco ${Math.round(ex.pagosTarjeta)} reemplazados por su detalle ${Math.round(ex.detalleTarjeta)}`])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Pivot')
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
              { k: 'CARGO',        l: 'Gastos',      icon: <TrendingDown size={12} />, color: '#DC2626' },
              { k: 'ABONO',        l: 'Ingresos',    icon: <TrendingUp size={12} />,   color: '#16A34A' },
              { k: 'COMPARATIVO',  l: 'Comparativo', icon: <BarChart3 size={12} />,    color: '#1F4E79' },
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

        {/* Desglose solo en modos no comparativos */}
        {tipo !== 'COMPARATIVO' && (
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
        )}

        {/* Vista (solo en Comparativo): Analítico vs Cuadratura banco */}
        {tipo === 'COMPARATIVO' && (
        <div>
          <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>Vista</div>
          <div style={{ display: 'flex', gap: 4, background: '#F1F5F9', borderRadius: 8, padding: 3 }}>
            {[
              { k: 'analitico',  l: '📊 Analítico',       title: 'Solo movs clasificados con subcuenta. Agrupa por mes nominal.' },
              { k: 'cuadratura', l: '🏦 Cuadratura banco', title: 'Todos los movs (incluye pendientes). Agrupa por fecha. Cuadra con cartola Santander.' },
            ].map(({ k, l, title }) => (
              <button key={k} onClick={() => setVista(k)} title={title} style={{
                padding: '5px 12px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: vista === k ? '#fff' : 'transparent',
                color: vista === k ? PRIMARY : '#64748B',
                boxShadow: vista === k ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}>{l}</button>
            ))}
          </div>
        </div>
        )}

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
      {data && !data.modoComparativo && (
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
              Total {tipo === 'CARGO' ? 'gastos' : 'ingresos'} operacionales {anio}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: tipo === 'CARGO' ? '#DC2626' : '#16A34A' }}>
              {fmtCLP(data.secciones.find(s => s.k === 'operacion')?.total ?? 0)}
            </div>
            <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
              {data.secciones.filter(s => s.k !== 'operacion').map(s => `${s.k === 'inversion' ? 'Inversión' : 'Financiamiento'} ${fmtCLP(s.total)}`).join(' · ')}
              {data.secciones.length > 1 ? ' · ' : ''}
              {data.secciones.reduce((a, s) => a + s.rows.length, 0)} cuentas madre · {data.secciones.reduce((a, s) => a + s.rows.reduce((b, r) => b + r.hijos.length, 0), 0)} {agrupacion === 'subcuenta' ? 'subcuentas' : 'centros de costo'}
            </div>
          </div>
        </div>
      )}

      {/* KPI comparativo: 3 cards (ingresos, gastos, resultado) */}
      {data && data.modoComparativo && (
        <>
        {/* Banner indicador de vista activa */}
        <div style={{
          background: data.modoCuadratura ? '#FEF3C7' : '#EFF6FF',
          border: '1px solid ' + (data.modoCuadratura ? '#FCD34D' : '#BFDBFE'),
          borderRadius: 8, padding: '8px 14px', fontSize: 12, color: data.modoCuadratura ? '#92400E' : '#1E40AF',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {data.modoCuadratura
            ? <><span style={{ fontSize: 14 }}>🏦</span> <span><b>Cuadratura banco</b> · Incluye TODOS los movimientos (pendientes + clasificados) agrupados por fecha. Debería cuadrar al peso con cartola Santander.</span></>
            : <><span style={{ fontSize: 14 }}>📊</span> <span><b>Vista analítico</b> · Movimientos clasificados por mes nominal. Separa operación, inversión y créditos; la tarjeta va por el detalle de sus estados de cuenta y los traspasos entre cuentas propias no se cuentan.</span></>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <div style={{ background: 'linear-gradient(135deg, #F0FDF4, #DCFCE7)', border: '1px solid #86EFAC', borderRadius: 12, padding: '14px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <TrendingUp size={16} color="#16A34A" />
              <div style={{ fontSize: 10, fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ingresos{data.modoCuadratura ? '' : ' operacionales'} {anio}</div>
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#16A34A' }}>{fmtCLP(data.ingresos.total)}</div>
          </div>
          <div style={{ background: 'linear-gradient(135deg, #FEF2F2, #FEE2E2)', border: '1px solid #FCA5A5', borderRadius: 12, padding: '14px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <TrendingDown size={16} color="#DC2626" />
              <div style={{ fontSize: 10, fontWeight: 700, color: '#991B1B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Gastos{data.modoCuadratura ? '' : ' operacionales'} {anio}</div>
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#DC2626' }}>{fmtCLP(data.gastos.total)}</div>
          </div>
          <div style={{
            background: data.resultado.total >= 0 ? 'linear-gradient(135deg, #EFF6FF, #DBEAFE)' : 'linear-gradient(135deg, #FEF2F2, #FECACA)',
            border: `1px solid ${data.resultado.total >= 0 ? '#93C5FD' : '#F87171'}`,
            borderRadius: 12, padding: '14px 18px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <BarChart3 size={16} color={data.resultado.total >= 0 ? '#1F4E79' : '#DC2626'} />
              <div style={{ fontSize: 10, fontWeight: 700, color: data.resultado.total >= 0 ? '#1E40AF' : '#991B1B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {data.modoCuadratura ? 'Neto banco' : 'Flujo operacional'} · Margen {data.margenPct.toFixed(1)}%
              </div>
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: data.resultado.total >= 0 ? '#1F4E79' : '#DC2626' }}>
              {data.resultado.total >= 0 ? '+' : ''}{fmtCLP(data.resultado.total)}
            </div>
          </div>
          {!data.modoCuadratura && (
          <div style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 12, padding: '14px 18px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Flujo neto · con inversión y créditos
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: data.flujoNeto.total >= 0 ? '#1F4E79' : '#DC2626' }}>{fmtSigned(data.flujoNeto.total)}</div>
            <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>Inversión {fmtSigned(-data.inversion.total)} · Créditos {fmtSigned(data.financiamiento.total)}</div>
          </div>
          )}
        </div>
        </>
      )}

      {/* Tabla pivot */}
      <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '60px 0', textAlign: 'center' }}>
            <Loader2 size={22} style={{ display: 'inline-block', color: '#9CA3AF' }} />
          </div>
        ) : !data || (!data.modoComparativo && !(data.secciones?.some(s => s.rows.length))) ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: '#9CA3AF' }}>
            <BarChart3 size={40} style={{ display: 'inline-block', marginBottom: 12, opacity: 0.4 }} />
            <div style={{ fontSize: 14, fontWeight: 600 }}>Sin datos para mostrar</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              No hay movimientos clasificados en {anio}.
              <br />Clasifica movimientos en el tab "Clasificar" para verlos aquí.
            </div>
          </div>
        ) : data.modoComparativo ? (
          /* ─── Tabla comparativa: 3 filas (Ingresos / Gastos / Resultado) por mes ─── */
          <div style={{ overflow: 'auto', maxHeight: '70vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 1100 }}>
              <thead>
                <tr>
                  <th style={{ ...TH, minWidth: 200, fontSize: 12 }}>Concepto</th>
                  {data.meses.map(m => (
                    <th key={m} style={{ ...TH, textAlign: 'right', minWidth: 95, fontSize: 11 }}>{MESES_CORTOS[m - 1]}</th>
                  ))}
                  <th style={{ ...TH, textAlign: 'right', background: '#E0F2FE', color: '#0369A1', minWidth: 120, fontSize: 12 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {filasComparativo(data).map(f => {
                  const val = m => f.signo * (f.serie.meses[m] ?? 0)
                  const tot = f.signo * f.serie.total
                  if (f.estilo === 'res') return (
                    <tr key={f.k} style={{ background: 'linear-gradient(to right, #1E3A5F, #1E40AF)', color: '#fff' }}>
                      <td style={{ ...TD, fontWeight: 800, color: '#fff', fontSize: 14, borderBottom: 'none' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><BarChart3 size={14} color="#fff" /> {f.label}</span>
                      </td>
                      {data.meses.map(m => (
                        <td key={m} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, borderBottom: 'none',
                          color: !Math.round(val(m)) ? '#9CA3AF' : (val(m) > 0 ? '#86EFAC' : '#FCA5A5') }}>{fmtSigned(val(m))}</td>
                      ))}
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 900, fontSize: 14, color: tot >= 0 ? '#86EFAC' : '#FCA5A5', borderBottom: 'none' }}>{fmtSigned(tot)}</td>
                    </tr>
                  )
                  const c = f.estilo === 'ing' ? { bg: '#F0FDF4', fg: '#16A34A', lab: '#166534', tot: '#DCFCE7', icon: <TrendingUp size={14} color="#16A34A" /> }
                    : f.estilo === 'gas' ? { bg: '#FEF2F2', fg: '#DC2626', lab: '#991B1B', tot: '#FEE2E2', icon: <TrendingDown size={14} color="#DC2626" /> }
                    : { bg: '#F8FAFC', fg: '#334155', lab: '#334155', tot: '#F1F5F9', icon: null }
                  return (
                    <tr key={f.k} style={{ background: c.bg }}>
                      <td style={{ ...TD, fontWeight: 700, color: c.lab, fontSize: 13 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{c.icon} {f.label}</span>
                      </td>
                      {data.meses.map(m => (
                        <td key={m} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: Math.round(val(m)) ? c.fg : '#D1D5DB' }}>
                          {f.estilo === 'ing' ? fmtCLP(val(m)) : fmtSigned(val(m))}
                        </td>
                      ))}
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: c.fg, background: c.tot }}>
                        {f.estilo === 'ing' ? fmtCLP(tot) : fmtSigned(tot)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div style={{ padding: '12px 18px', background: '#F8FAFC', borderTop: '1px solid #E2E8F0', fontSize: 11, color: '#475569', display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <span><strong>Margen:</strong> {data.margenPct.toFixed(1)}% ({data.modoCuadratura ? 'neto banco' : 'flujo operacional'} / ingresos)</span>
              {data.tarjeta && <span><strong>Tarjeta:</strong> pagos desde el banco {fmtCLP(data.tarjeta.pagos)} reemplazados por su detalle {fmtCLP(data.tarjeta.detalle)}</span>}
              <span><strong>Meses positivos:</strong> {data.meses.filter(m => (data.resultado.meses[m] ?? 0) > 0).length} de 12</span>
              <span><strong>Meses negativos:</strong> {data.meses.filter(m => (data.resultado.meses[m] ?? 0) < 0).length} de 12</span>
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
                {data.secciones.map(sec => (
                  <Fragment key={sec.k}>
                    {/* Encabezado de sección */}
                    <tr style={{ background: '#E2E8F0' }}>
                      <td colSpan={14} style={{ ...TD, fontWeight: 800, color: '#1E293B', fontSize: 12, letterSpacing: '0.03em' }}>
                        {sec.nombre.toUpperCase()} · {fmtCLP(sec.total)}
                      </td>
                    </tr>
                    {sec.rows.map(r => {
                      const isOpen = expanded.has(r.id)
                      return (
                        <Fragment key={r.id}>
                          {/* Cuenta madre */}
                          <tr onClick={() => toggleExpand(r.id)}
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
                              <td style={{ ...TD, paddingLeft: 30, color: '#6B7280', fontSize: 11 }}>↳ {h.nombre}</td>
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
                        </Fragment>
                      )
                    })}
                    {/* Subtotal de la sección */}
                    <tr style={{ background: '#F1F5F9', fontWeight: 700 }}>
                      <td style={{ ...TD, color: '#334155' }}>Subtotal {sec.nombre.toLowerCase()}</td>
                      {data.meses.map(m => (
                        <td key={m} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#334155' }}>{fmtCLP(sec.meses[m])}</td>
                      ))}
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#334155', background: '#E2E8F0' }}>{fmtCLP(sec.total)}</td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'linear-gradient(to right, #1E3A5F, #1E40AF)', color: '#fff', fontWeight: 700 }}>
                  <td style={{ ...TD, color: '#fff', fontSize: 13, borderBottom: 'none' }}>
                    TOTAL{data.secciones.length > 1 ? ' (operación + inversión + financiamiento)' : ''}
                  </td>
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
            {(data.excluidos.traspasos > 0 || data.excluidos.pagosTarjeta > 0 || data.excluidos.detalleTarjeta !== 0) && (
              <div style={{ padding: '10px 18px', background: '#F8FAFC', borderTop: '1px solid #E2E8F0', fontSize: 11, color: '#475569', display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                {data.excluidos.traspasos > 0 && <span><strong>Fuera del análisis:</strong> traspasos entre cuentas propias {fmtCLP(data.excluidos.traspasos)}</span>}
                {(data.excluidos.pagosTarjeta > 0 || data.excluidos.detalleTarjeta !== 0) && (
                  <span><strong>Tarjeta:</strong> pagos desde el banco {fmtCLP(data.excluidos.pagosTarjeta)} reemplazados por su detalle {fmtCLP(data.excluidos.detalleTarjeta)} (💳)</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
