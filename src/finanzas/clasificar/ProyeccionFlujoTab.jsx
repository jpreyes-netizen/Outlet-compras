import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Wand2, Trash2, Save, AlertCircle, TrendingUp, TrendingDown, ChevronRight, ChevronDown } from 'lucide-react'
import { supabase } from '../../supabase'

const PRIMARY = '#1F4E79'
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const ESCENARIOS = [
  { k: 'base',      l: 'Base',      color: '#1F4E79', icon: '◎' },
  { k: 'optimista', l: 'Optimista', color: '#16A34A', icon: '↑' },
  { k: 'pesimista', l: 'Pesimista', color: '#DC2626', icon: '↓' },
]

function fmtCLP(n) {
  if (n == null || n === 0) return '—'
  const abs = Math.abs(Math.round(n))
  return (n < 0 ? '−$' : '$') + abs.toLocaleString('es-CL')
}
function fmtCLPplano(n) {
  if (n == null) return '$0'
  return '$' + Math.round(n).toLocaleString('es-CL')
}

const TH = { padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#374151', background: '#F1F5F9', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2 }
const TD = { padding: '4px 6px', fontSize: 11, color: '#374151', borderBottom: '1px solid #F1F5F9' }

export function ProyeccionFlujoTab({ anio = new Date().getFullYear() }) {
  const [escenario, setEscenario] = useState('base')
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [data, setData]           = useState(null)  // { entradas: [{cm, subs, meses}], salidas: [...] }
  const [editing, setEditing]     = useState(null)  // { subId, mes, valor }
  const [expanded, setExpanded]   = useState(new Set())
  const [saldoInicial, setSaldoInicial] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)

  // ── Cargar todo ──
  useEffect(() => {
    let cancelado = false
    ;(async () => {
      setLoading(true)
      try {
        // 1) Catálogos
        const [cmR, scR] = await Promise.all([
          supabase.from('cuentas_madre').select('id, nombre, codigo, tipo').eq('activa', true),
          supabase.from('subcuentas').select('id, nombre, cuenta_madre_id').eq('activa', true),
        ])
        const cuentas = cmR.data ?? []
        const subcuentas = scR.data ?? []

        // 2) Saldo inicial: última cartola del año anterior
        const { data: cartolaPrev } = await supabase
          .from('cartolas')
          .select('saldo_final, fecha_fin')
          .lt('fecha_fin', `${anio}-01-01`)
          .order('fecha_fin', { ascending: false })
          .limit(1)
        const saldoIni = cartolaPrev?.[0]?.saldo_final ? Number(cartolaPrev[0].saldo_final) : 0

        // 3) Proyecciones del escenario actual para el año
        const { data: proyecciones } = await supabase
          .from('proyecciones_flujo')
          .select('id, anio, mes, subcuenta_id, tipo, monto, origen')
          .eq('anio', anio)
          .eq('escenario', escenario)
          .limit(5000)

        // Estructurar: subId → mes → monto
        const proyMap = new Map()  // subId -> { tipo, meses: {1: monto, ...} }
        for (const p of proyecciones ?? []) {
          if (!p.subcuenta_id) continue
          if (!proyMap.has(p.subcuenta_id)) proyMap.set(p.subcuenta_id, { tipo: p.tipo, meses: {} })
          proyMap.get(p.subcuenta_id).meses[p.mes] = Number(p.monto) || 0
        }

        // 4) Promedio últimos 3 meses cerrados (para mostrar como referencia)
        const hoy = new Date()
        const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0)  // último día del mes anterior
        const inicio = new Date(fin); inicio.setMonth(inicio.getMonth() - 2)
        inicio.setDate(1)
        const desdeStr = inicio.toISOString().slice(0, 10)
        const hastaStr = fin.toISOString().slice(0, 10)

        const { data: movsHist } = await supabase
          .from('movimientos_bancarios')
          .select('monto, tipo, fecha, subcuenta_id, mes_nominal')
          .gte('fecha', desdeStr).lte('fecha', hastaStr)
          .eq('estado', 'clasificado')
          .not('subcuenta_id', 'is', null)
          .limit(20000)

        // Calcular promedio mensual por subcuenta
        const promedioMap = new Map()  // subId -> { tipo, totalPorMes, mesesContados, promedio }
        const mesesUnicos = new Set()
        for (const m of movsHist ?? []) {
          const mes = m.mes_nominal ?? (new Date(m.fecha).getMonth() + 1)
          mesesUnicos.add(mes)
          if (!promedioMap.has(m.subcuenta_id)) promedioMap.set(m.subcuenta_id, { tipo: m.tipo, totales: new Map() })
          const e = promedioMap.get(m.subcuenta_id)
          e.totales.set(mes, (e.totales.get(mes) ?? 0) + Math.abs(Number(m.monto) || 0))
        }
        const nMeses = Math.max(1, mesesUnicos.size)
        for (const [, e] of promedioMap) {
          const suma = Array.from(e.totales.values()).reduce((s, n) => s + n, 0)
          e.promedio = Math.round(suma / nMeses)
        }

        // 5) Armar estructura para render
        const cmById = new Map(cuentas.map(c => [c.id, c]))
        const subsConDatos = new Set()
        for (const s of subcuentas) {
          if (proyMap.has(s.id) || promedioMap.has(s.id)) subsConDatos.add(s.id)
        }

        const gruposEntradas = new Map()  // cmId → { cm, subs: [{sub, meses, promedio}] }
        const gruposSalidas  = new Map()
        for (const sub of subcuentas) {
          if (!subsConDatos.has(sub.id)) continue
          const cm = cmById.get(sub.cuenta_madre_id)
          if (!cm) continue

          const prom = promedioMap.get(sub.id)
          const proy = proyMap.get(sub.id)
          // tipo lo determina la proyección si existe, si no el promedio
          const tipo = proy?.tipo ?? prom?.tipo
          if (!tipo) continue

          const meses = {}
          for (let m = 1; m <= 12; m++) {
            // Si hay proyección explícita, usar esa. Si no, usar promedio (sugerencia)
            const valProy = proy?.meses?.[m]
            meses[m] = valProy != null ? valProy : (prom?.promedio ?? 0)
          }
          const tieneProyExplicita = !!proy && Object.keys(proy.meses).length > 0

          const grupo = tipo === 'ABONO' ? gruposEntradas : gruposSalidas
          if (!grupo.has(cm.id)) grupo.set(cm.id, { cm, subs: [] })
          grupo.get(cm.id).subs.push({
            sub,
            meses,
            promedio: prom?.promedio ?? 0,
            tieneProyExplicita,
            valoresProyectados: proy?.meses ?? {},  // qué meses tienen valor en BD
          })
        }

        // Ordenar subs por total año desc dentro de cada cm
        const finalizar = grupo => {
          return Array.from(grupo.values()).map(g => ({
            ...g,
            subs: g.subs.sort((a, b) => {
              const sa = Object.values(a.meses).reduce((s, n) => s + n, 0)
              const sb = Object.values(b.meses).reduce((s, n) => s + n, 0)
              return sb - sa
            }),
          })).sort((a, b) => {
            const sa = a.subs.reduce((s, x) => s + Object.values(x.meses).reduce((p, n) => p + n, 0), 0)
            const sb = b.subs.reduce((s, x) => s + Object.values(x.meses).reduce((p, n) => p + n, 0), 0)
            return sb - sa
          })
        }

        if (!cancelado) {
          setSaldoInicial(saldoIni)
          setData({
            entradas: finalizar(gruposEntradas),
            salidas:  finalizar(gruposSalidas),
          })
        }
      } catch (e) {
        toast.error('Error: ' + (e instanceof Error ? e.message : '?'))
        setData(null)
      } finally { if (!cancelado) setLoading(false) }
    })()
    return () => { cancelado = true }
  }, [anio, escenario, reloadKey])

  // ── Totales calculados ──
  const totales = useMemo(() => {
    if (!data) return null
    const entradasPorMes = Array(13).fill(0)  // index 1-12
    const salidasPorMes  = Array(13).fill(0)
    for (const g of data.entradas) {
      for (const sub of g.subs) {
        for (let m = 1; m <= 12; m++) entradasPorMes[m] += sub.meses[m] ?? 0
      }
    }
    for (const g of data.salidas) {
      for (const sub of g.subs) {
        for (let m = 1; m <= 12; m++) salidasPorMes[m] += sub.meses[m] ?? 0
      }
    }
    const saldoFinalMes = Array(13).fill(0)
    let saldoActual = saldoInicial
    for (let m = 1; m <= 12; m++) {
      saldoActual = saldoActual + entradasPorMes[m] - salidasPorMes[m]
      saldoFinalMes[m] = saldoActual
    }
    return {
      entradasPorMes, salidasPorMes, saldoFinalMes,
      totEntradas: entradasPorMes.reduce((s, n) => s + n, 0),
      totSalidas:  salidasPorMes.reduce((s, n) => s + n, 0),
      saldoFinalAnio: saldoFinalMes[12],
    }
  }, [data, saldoInicial])

  // ── Editar celda ──
  async function guardarCelda(sub, tipo, mes, montoNuevo) {
    setSaving(true)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const userId = sess.session?.user?.id ?? null

      // Buscar si existe registro
      const { data: existing } = await supabase
        .from('proyecciones_flujo')
        .select('id')
        .eq('anio', anio).eq('mes', mes).eq('escenario', escenario).eq('subcuenta_id', sub.id)
        .maybeSingle()

      if (existing) {
        await supabase.from('proyecciones_flujo').update({
          monto: montoNuevo,
          origen: 'manual',
          updated_at: new Date().toISOString(),
        }).eq('id', existing.id)
      } else {
        await supabase.from('proyecciones_flujo').insert({
          escenario, anio, mes,
          subcuenta_id: sub.id,
          cuenta_madre_id: sub.cuenta_madre_id ?? null,
          tipo, monto: montoNuevo,
          origen: 'manual',
          created_by: userId,
        })
      }
      // Actualizar local sin refetch completo
      setData(prev => {
        if (!prev) return prev
        const grupos = tipo === 'ABONO' ? prev.entradas : prev.salidas
        const otrosGrupos = tipo === 'ABONO' ? prev.salidas : prev.entradas
        const nuevosGrupos = grupos.map(g => ({
          ...g,
          subs: g.subs.map(s => s.sub.id === sub.id
            ? { ...s, meses: { ...s.meses, [mes]: montoNuevo }, tieneProyExplicita: true, valoresProyectados: { ...s.valoresProyectados, [mes]: montoNuevo } }
            : s),
        }))
        return tipo === 'ABONO'
          ? { entradas: nuevosGrupos, salidas: otrosGrupos }
          : { entradas: otrosGrupos, salidas: nuevosGrupos }
      })
      setEditing(null)
    } catch (e) {
      toast.error('Error al guardar: ' + (e instanceof Error ? e.message : '?'))
    } finally { setSaving(false) }
  }

  // ── Repoblar desde promedio ──
  async function repoblarDesdePromedio() {
    if (!data) return
    if (!window.confirm(`¿Repoblar TODA la proyección del escenario "${escenario}" con el promedio de los últimos 3 meses?\n\nSe sobrescribirán los valores actuales del año ${anio}.`)) return
    setSaving(true)
    const toastId = toast.loading('Repoblando proyección…')
    try {
      const { data: sess } = await supabase.auth.getSession()
      const userId = sess.session?.user?.id ?? null

      // Borrar proyecciones actuales del escenario/año
      await supabase.from('proyecciones_flujo')
        .delete().eq('anio', anio).eq('escenario', escenario)

      // Insertar promedios x12 para cada sub con promedio > 0
      const rows = []
      for (const lado of ['entradas', 'salidas']) {
        const grupos = data[lado]
        const tipoVal = lado === 'entradas' ? 'ABONO' : 'CARGO'
        for (const g of grupos) {
          for (const subData of g.subs) {
            if (subData.promedio <= 0) continue
            // Ajustar según escenario: optimista +10% entradas/-10% salidas, pesimista al revés
            let monto = subData.promedio
            if (escenario === 'optimista') {
              monto = Math.round(monto * (tipoVal === 'ABONO' ? 1.1 : 0.9))
            } else if (escenario === 'pesimista') {
              monto = Math.round(monto * (tipoVal === 'ABONO' ? 0.85 : 1.15))
            }
            for (let m = 1; m <= 12; m++) {
              rows.push({
                escenario, anio, mes: m,
                subcuenta_id: subData.sub.id,
                cuenta_madre_id: subData.sub.cuenta_madre_id,
                tipo: tipoVal,
                monto,
                origen: 'auto_promedio',
                created_by: userId,
              })
            }
          }
        }
      }

      // Insertar en lotes
      for (let i = 0; i < rows.length; i += 500) {
        const lote = rows.slice(i, i + 500)
        const { error } = await supabase.from('proyecciones_flujo').insert(lote)
        if (error) throw error
      }

      toast.success(`✓ ${rows.length} celdas repobladas con promedio`, { id: toastId })
      setReloadKey(k => k + 1)
    } catch (e) {
      toast.error('Error: ' + (e instanceof Error ? e.message : '?'), { id: toastId })
    } finally { setSaving(false) }
  }

  async function limpiarEscenario() {
    if (!window.confirm(`¿Eliminar TODOS los datos del escenario "${escenario}" para ${anio}?\n\nEsta acción no se puede deshacer.`)) return
    setSaving(true)
    try {
      const { error } = await supabase.from('proyecciones_flujo')
        .delete().eq('anio', anio).eq('escenario', escenario)
      if (error) throw error
      toast.success('Escenario limpiado')
      setReloadKey(k => k + 1)
    } catch (e) {
      toast.error('Error: ' + (e instanceof Error ? e.message : '?'))
    } finally { setSaving(false) }
  }

  function toggleExpand(key) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // ── Render celda editable ──
  function CeldaEditable({ sub, tipo, mes }) {
    const val = sub.meses[mes] ?? 0
    const esEditando = editing && editing.subId === sub.sub.id && editing.mes === mes && editing.tipo === tipo
    const esProyExplicita = sub.valoresProyectados[mes] != null
    const colorTexto = tipo === 'ABONO' ? '#15803D' : '#DC2626'

    if (esEditando) {
      return (
        <td style={{ ...TD, padding: 2, background: '#FEF3C7' }}>
          <input type="number" autoFocus
            defaultValue={val}
            onBlur={e => {
              const v = Number(e.target.value) || 0
              if (v !== val) guardarCelda(sub.sub, tipo, mes, v)
              else setEditing(null)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') e.target.blur()
              if (e.key === 'Escape') setEditing(null)
            }}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '4px 6px', borderRadius: 4, border: '2px solid #F59E0B',
              fontSize: 11, textAlign: 'right', fontFamily: 'monospace',
              outline: 'none',
            }} />
        </td>
      )
    }

    return (
      <td onClick={() => setEditing({ subId: sub.sub.id, mes, tipo })}
        style={{
          ...TD, cursor: 'pointer', textAlign: 'right', fontFamily: 'monospace',
          color: val ? colorTexto : '#D1D5DB',
          background: esProyExplicita ? '#EFF6FF' : 'transparent',
          fontWeight: esProyExplicita ? 600 : 400,
          fontStyle: esProyExplicita ? 'normal' : 'italic',
        }}
        title={esProyExplicita ? 'Valor manual guardado' : 'Sugerencia (promedio histórico) — click para editar'}>
        {fmtCLP(val)}
      </td>
    )
  }

  const escenSelec = ESCENARIOS.find(e => e.k === escenario)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Controles */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '14px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>Escenario</div>
          <div style={{ display: 'flex', gap: 4, background: '#F1F5F9', borderRadius: 8, padding: 3 }}>
            {ESCENARIOS.map(e => (
              <button key={e.k} onClick={() => setEscenario(e.k)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '5px 14px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: escenario === e.k ? '#fff' : 'transparent',
                color: escenario === e.k ? e.color : '#64748B',
                boxShadow: escenario === e.k ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}>
                <span>{e.icon}</span> {e.l}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={repoblarDesdePromedio} disabled={saving || loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 7, border: 'none', background: '#7C3AED', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: saving || loading ? 0.5 : 1 }}>
            <Wand2 size={12} /> Repoblar desde promedio
          </button>
          <button onClick={limpiarEscenario} disabled={saving || loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 7, border: '1px solid #FCA5A5', background: '#fff', color: '#DC2626', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: saving || loading ? 0.5 : 1 }}>
            <Trash2 size={12} /> Limpiar escenario
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div style={{
        background: `${escenSelec.color}10`, border: `1px solid ${escenSelec.color}33`,
        borderRadius: 8, padding: '8px 12px',
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: escenSelec.color,
      }}>
        <AlertCircle size={13} />
        <span>
          <strong>Escenario {escenSelec.l}</strong> — Celdas azules = valor manual guardado · Celdas grises = sugerencia desde promedio histórico (click para editar)
        </span>
      </div>

      {/* KPIs */}
      {totales && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <Kpi label="Saldo inicial año" value={saldoInicial} color="#1E40AF" />
          <Kpi label="Entradas proyectadas" value={totales.totEntradas} color="#16A34A" icon={<TrendingUp size={18} color="#16A34A" />} />
          <Kpi label="Salidas proyectadas" value={-totales.totSalidas} color="#DC2626" icon={<TrendingDown size={18} color="#DC2626" />} />
          <Kpi label="Saldo final proyectado" value={totales.saldoFinalAnio} color={totales.saldoFinalAnio >= 0 ? '#16A34A' : '#DC2626'} highlight />
        </div>
      )}

      {/* Tabla */}
      <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center' }}><Loader2 size={22} color="#9CA3AF" /></div>
        ) : !data || (data.entradas.length === 0 && data.salidas.length === 0) ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#94A3B8' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Sin datos para proyectar</div>
            <div style={{ fontSize: 12, marginTop: 6 }}>Clasifica movimientos en el tab "Clasificar" o usa "Repoblar desde promedio" si ya tienes datos.</div>
          </div>
        ) : (
          <div style={{ overflow: 'auto', maxHeight: '70vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 1100 }}>
              <thead>
                <tr>
                  <th style={{ ...TH, minWidth: 220, left: 0, zIndex: 3 }}>Concepto</th>
                  {MESES.map((m, i) => (
                    <th key={i} style={{ ...TH, textAlign: 'right', minWidth: 85 }}>{m}</th>
                  ))}
                  <th style={{ ...TH, textAlign: 'right', background: '#E0F2FE', color: '#0369A1' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {/* Saldo inicial */}
                <tr style={{ background: '#EFF6FF', fontWeight: 600 }}>
                  <td style={{ ...TD, fontStyle: 'italic', color: '#1E40AF' }}>Saldo inicial</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#1E40AF' }}>{fmtCLPplano(saldoInicial)}</td>
                  {MESES.slice(1).map((_, i) => <td key={i} style={{ ...TD, textAlign: 'right', color: '#D1D5DB' }}>↗</td>)}
                  <td style={{ ...TD, background: '#DBEAFE' }} />
                </tr>

                {/* ENTRADAS */}
                <tr style={{ background: '#16A34A' }}>
                  <td colSpan={14} style={{ ...TD, color: '#fff', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>↑ ENTRADAS</td>
                </tr>
                {data.entradas.map(g => {
                  const expandKey = 'ent_' + g.cm.id
                  const isOpen = expanded.has(expandKey)
                  const totalCm = Array(13).fill(0)
                  for (const sub of g.subs) for (let m = 1; m <= 12; m++) totalCm[m] += sub.meses[m] ?? 0
                  const totAnio = totalCm.reduce((s, n) => s + n, 0)
                  return (
                    <>
                      <tr key={g.cm.id} onClick={() => toggleExpand(expandKey)}
                        style={{ cursor: 'pointer', background: '#F0FDF4', fontWeight: 600 }}>
                        <td style={{ ...TD, display: 'flex', alignItems: 'center', gap: 4 }}>
                          {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                          <span>{g.cm.nombre}</span>
                        </td>
                        {MESES.map((_, i) => (
                          <td key={i} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: totalCm[i + 1] ? '#15803D' : '#D1D5DB' }}>
                            {fmtCLP(totalCm[i + 1])}
                          </td>
                        ))}
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#15803D', background: '#DCFCE7' }}>{fmtCLP(totAnio)}</td>
                      </tr>
                      {isOpen && g.subs.map(sub => {
                        const totSub = Object.values(sub.meses).reduce((s, n) => s + n, 0)
                        return (
                          <tr key={sub.sub.id}>
                            <td style={{ ...TD, paddingLeft: 26, color: '#6B7280' }}>↳ {sub.sub.nombre}</td>
                            {MESES.map((_, i) => <CeldaEditable key={i} sub={sub} tipo="ABONO" mes={i + 1} />)}
                            <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#475569', background: '#F8FAFC' }}>{fmtCLP(totSub)}</td>
                          </tr>
                        )
                      })}
                    </>
                  )
                })}
                <tr style={{ background: '#DCFCE7', fontWeight: 700 }}>
                  <td style={{ ...TD, color: '#166534' }}>Total entradas</td>
                  {MESES.map((_, i) => (
                    <td key={i} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#166534' }}>{fmtCLP(totales?.entradasPorMes[i + 1])}</td>
                  ))}
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#166534', background: '#BBF7D0' }}>{fmtCLP(totales?.totEntradas)}</td>
                </tr>

                {/* SALIDAS */}
                <tr style={{ background: '#DC2626' }}>
                  <td colSpan={14} style={{ ...TD, color: '#fff', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>↓ SALIDAS</td>
                </tr>
                {data.salidas.map(g => {
                  const expandKey = 'sal_' + g.cm.id
                  const isOpen = expanded.has(expandKey)
                  const totalCm = Array(13).fill(0)
                  for (const sub of g.subs) for (let m = 1; m <= 12; m++) totalCm[m] += sub.meses[m] ?? 0
                  const totAnio = totalCm.reduce((s, n) => s + n, 0)
                  return (
                    <>
                      <tr key={g.cm.id} onClick={() => toggleExpand(expandKey)}
                        style={{ cursor: 'pointer', background: '#FEF2F2', fontWeight: 600 }}>
                        <td style={{ ...TD, display: 'flex', alignItems: 'center', gap: 4 }}>
                          {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                          <span>{g.cm.nombre}</span>
                        </td>
                        {MESES.map((_, i) => (
                          <td key={i} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: totalCm[i + 1] ? '#991B1B' : '#D1D5DB' }}>
                            {fmtCLP(totalCm[i + 1])}
                          </td>
                        ))}
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#991B1B', background: '#FEE2E2' }}>{fmtCLP(totAnio)}</td>
                      </tr>
                      {isOpen && g.subs.map(sub => {
                        const totSub = Object.values(sub.meses).reduce((s, n) => s + n, 0)
                        return (
                          <tr key={sub.sub.id}>
                            <td style={{ ...TD, paddingLeft: 26, color: '#6B7280' }}>↳ {sub.sub.nombre}</td>
                            {MESES.map((_, i) => <CeldaEditable key={i} sub={sub} tipo="CARGO" mes={i + 1} />)}
                            <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#475569', background: '#F8FAFC' }}>{fmtCLP(totSub)}</td>
                          </tr>
                        )
                      })}
                    </>
                  )
                })}
                <tr style={{ background: '#FEE2E2', fontWeight: 700 }}>
                  <td style={{ ...TD, color: '#991B1B' }}>Total salidas</td>
                  {MESES.map((_, i) => (
                    <td key={i} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#991B1B' }}>{fmtCLP(totales?.salidasPorMes[i + 1])}</td>
                  ))}
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#991B1B', background: '#FECACA' }}>{fmtCLP(totales?.totSalidas)}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr style={{ background: 'linear-gradient(to right, #1E3A5F, #1E40AF)', color: '#fff', fontWeight: 700 }}>
                  <td style={{ ...TD, color: '#fff', borderBottom: 'none', fontSize: 12 }}>SALDO PROYECTADO FIN MES</td>
                  {MESES.map((_, i) => (
                    <td key={i} style={{ ...TD, color: '#fff', textAlign: 'right', fontFamily: 'monospace', borderBottom: 'none' }}>{fmtCLPplano(totales?.saldoFinalMes[i + 1])}</td>
                  ))}
                  <td style={{ ...TD, color: '#fff', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, fontWeight: 800, borderBottom: 'none' }}>{fmtCLPplano(totales?.saldoFinalAnio)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

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
