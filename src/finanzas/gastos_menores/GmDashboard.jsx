import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabase'
import { fmt } from '../../lib/constants'
import { userScopeSync } from '../../core/permisos'
import { Cd, Mt, Bd } from '../../components/UI'

const SUCURSALES = {
  'suc-la': { l: 'Los Ángeles', c: '#007AFF', tipo: 'sucursal' },
  'suc-mp': { l: 'Maipú',       c: '#34C759', tipo: 'sucursal' },
  'suc-lg': { l: 'La Granja',   c: '#FF9500', tipo: 'sucursal' },
  'dir-adm': { l: 'Dir. Adm. y Finanzas', c: '#AF52DE', tipo: 'direccion' },
  'dir-com': { l: 'Dir. Comercial',        c: '#5856D6', tipo: 'direccion' },
  'dir-neg': { l: 'Dir. Negocios',         c: '#FF3B30', tipo: 'direccion' },
  'dir-ops': { l: 'Dir. Operaciones',      c: '#5AC8FA', tipo: 'direccion' },
  'ops-lg':  { l: 'OPS · La Granja',       c: '#5AC8FA', tipo: 'area_sucursal' },
  'com-lg':  { l: 'COM · La Granja',       c: '#5856D6', tipo: 'area_sucursal' }
}

const UMBRAL_GASTO_ALTO = 50000

const fechaIso = (d) => d.toISOString().slice(0, 10)
const inicioMesIso = (offset = 0) => {
  const d = new Date(); d.setMonth(d.getMonth() - offset); d.setDate(1)
  return fechaIso(d)
}
const finMesIso = (offset = 0) => {
  const d = new Date(); d.setMonth(d.getMonth() - offset + 1); d.setDate(0)
  return fechaIso(d)
}
const nombreMes = (offset = 0) => {
  const d = new Date(); d.setMonth(d.getMonth() - offset)
  return d.toLocaleDateString('es-CL', { month: 'short', year: '2-digit' })
}

const RANGOS = {
  mes:      { l: 'Mes actual',      desde: () => inicioMesIso(0), hasta: () => fechaIso(new Date()), meses: 1 },
  trimestre:{ l: 'Últimos 3 meses', desde: () => inicioMesIso(2), hasta: () => fechaIso(new Date()), meses: 3 },
  anio:     { l: 'Año actual',      desde: () => `${new Date().getFullYear()}-01-01`, hasta: () => fechaIso(new Date()), meses: new Date().getMonth() + 1 }
}

export function GmDashboard({ cu, isMobile }) {
  const [loading, setLoading] = useState(true)
  const [rango, setRango]     = useState('trimestre')
  const [filtroTipo, setFt]   = useState('todos')
  const [fondos, setFondos]   = useState([])
  const [movs, setMovs]       = useState([])
  const [movsMesAnt, setMmA]  = useState([])

  const cargar = async () => {
    setLoading(true)
    try {
      const R = RANGOS[rango]
      const desde = R.desde()
      const hasta = R.hasta()
      const desdeMesAnt = inicioMesIso(1)
      const hastaMesAnt = finMesIso(1)

      const [{ data: fs }, { data: ms }, { data: msAnt }] = await Promise.all([
        supabase.from('gm_fondos')
          .select('id, sucursal_id, custodio_id, monto_asignado, saldo_actual, estado, fecha_apertura')
          .eq('estado', 'activo'),
        supabase.from('gm_movimientos')
          .select('id, fondo_id, fecha, tipo, monto, categoria_id, descripcion, proveedor, responsable_nombre, url_respaldo, archivo_storage, estado, gm_categorias(nombre)')
          .gte('fecha', desde).lte('fecha', hasta)
          .order('fecha', { ascending: false })
          .limit(2000),
        supabase.from('gm_movimientos')
          .select('id, fondo_id, tipo, monto, fecha')
          .gte('fecha', desdeMesAnt).lte('fecha', hastaMesAnt)
          .limit(2000)
      ])

      // Filtrar por scope del usuario (sucursal en usuario_acceso)
      const miScope = userScopeSync(cu, 'finanzas', 'gm.dashboard', { raw: true })
      const fondosVisibles = (fs || []).filter(f => !miScope || f.sucursal_id === miScope)
      const fondosIdsVisibles = new Set(fondosVisibles.map(f => f.id))

      setFondos(fondosVisibles)
      setMovs((ms || []).filter(m => fondosIdsVisibles.has(m.fondo_id)))
      setMmA((msAnt || []).filter(m => fondosIdsVisibles.has(m.fondo_id)))
    } catch (e) {
      console.error('Error cargando dashboard GM:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [rango])

  const fondosFiltrados = useMemo(() => {
    if (filtroTipo === 'todos') return fondos
    return fondos.filter(f => SUCURSALES[f.sucursal_id]?.tipo === filtroTipo)
  }, [fondos, filtroTipo])

  const fondoIdsSet = useMemo(() => new Set(fondosFiltrados.map(f => f.id)), [fondosFiltrados])
  const movsFiltrados = useMemo(() => movs.filter(m => fondoIdsSet.has(m.fondo_id)), [movs, fondoIdsSet])
  const movsAntFiltrados = useMemo(() => movsMesAnt.filter(m => fondoIdsSet.has(m.fondo_id)), [movsMesAnt, fondoIdsSet])

  /* ─── KPIs ─── */
  const kpis = useMemo(() => {
    const R = RANGOS[rango]
    const gastos = movsFiltrados.filter(m => m.tipo === 'gasto' && m.estado !== 'rechazado')
    const totalAsignado = fondosFiltrados.reduce((s, f) => s + (f.monto_asignado || 0), 0)
    const totalSaldo    = fondosFiltrados.reduce((s, f) => s + (f.saldo_actual || 0), 0)
    const gastoPeriodo  = gastos.reduce((s, m) => s + (m.monto || 0), 0)
    const gastoPromedio = R.meses > 0 ? gastoPeriodo / R.meses : 0

    const gastoMesAnt    = movsAntFiltrados.filter(m => m.tipo === 'gasto').reduce((s, m) => s + (m.monto || 0), 0)
    const inicioMesAct   = inicioMesIso(0)
    const gastoMesActual = movs.filter(m => fondoIdsSet.has(m.fondo_id) && m.tipo === 'gasto' && m.fecha >= inicioMesAct)
                              .reduce((s, m) => s + (m.monto || 0), 0)
    const variacion = gastoMesAnt > 0 ? ((gastoMesActual - gastoMesAnt) / gastoMesAnt) * 100 : null

    const fondosAlerta = fondosFiltrados.filter(f => {
      if (f.saldo_actual < 0) return true
      if (f.monto_asignado > 0 && (f.saldo_actual / f.monto_asignado) < 0.1) return true
      return false
    }).length

    const sinResp = gastos.filter(m => !m.url_respaldo && !m.archivo_storage).length
    const pctSinResp = gastos.length > 0 ? (sinResp / gastos.length) * 100 : 0

    return {
      totalAsignado, totalSaldo, gastoPeriodo, gastoPromedio,
      gastoMesActual, gastoMesAnt, variacion,
      fondosAlerta, totalFondos: fondosFiltrados.length,
      sinResp, pctSinResp, totalGastos: gastos.length
    }
  }, [movsFiltrados, movsAntFiltrados, fondosFiltrados, rango, movs, fondoIdsSet])

  /* ─── Tendencia ─── */
  const tendencia = useMemo(() => {
    const meses = []
    for (let i = 2; i >= 0; i--) {
      const desde = inicioMesIso(i)
      const hasta = finMesIso(i)
      const movsMes = movs.filter(m => fondoIdsSet.has(m.fondo_id) && m.fecha >= desde && m.fecha <= hasta)
      const ingresos = movsMes.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (m.monto || 0), 0)
      const gastos = movsMes.filter(m => m.tipo === 'gasto').reduce((s, m) => s + (m.monto || 0), 0)
      meses.push({ nombre: nombreMes(i), ingresos, gastos, neto: ingresos - gastos })
    }
    return meses
  }, [movs, fondoIdsSet])

  const maxTend = useMemo(() => Math.max(1, ...tendencia.flatMap(t => [t.ingresos, t.gastos])), [tendencia])

  /* ─── Concentración ─── */
  const topCategorias = useMemo(() => {
    const agg = {}
    movsFiltrados.filter(m => m.tipo === 'gasto').forEach(m => {
      const k = m.gm_categorias?.nombre || '(Sin categoría)'
      agg[k] = (agg[k] || 0) + (m.monto || 0)
    })
    return Object.entries(agg).map(([n, t]) => ({ n, t })).sort((a, b) => b.t - a.t).slice(0, 10)
  }, [movsFiltrados])

  const topProveedores = useMemo(() => {
    const agg = {}
    movsFiltrados.filter(m => m.tipo === 'gasto' && m.proveedor).forEach(m => {
      const k = m.proveedor.trim()
      if (!agg[k]) agg[k] = { n: k, t: 0, c: 0 }
      agg[k].t += (m.monto || 0); agg[k].c += 1
    })
    return Object.values(agg).sort((a, b) => b.t - a.t).slice(0, 10)
  }, [movsFiltrados])

  const topResponsables = useMemo(() => {
    const agg = {}
    movsFiltrados.filter(m => m.tipo === 'gasto' && m.responsable_nombre).forEach(m => {
      const k = m.responsable_nombre.trim()
      if (!agg[k]) agg[k] = { n: k, t: 0, c: 0 }
      agg[k].t += (m.monto || 0); agg[k].c += 1
    })
    return Object.values(agg).sort((a, b) => b.t - a.t).slice(0, 5)
  }, [movsFiltrados])

  /* ─── Tabla consolidada ─── */
  const tablaFondos = useMemo(() => {
    return fondosFiltrados.map(f => {
      const gastosFondo = movs.filter(m => m.fondo_id === f.id && m.tipo === 'gasto')
                              .reduce((s, m) => s + (m.monto || 0), 0)
      const pctSaldo = f.monto_asignado > 0 ? (f.saldo_actual / f.monto_asignado) * 100 : 0
      let alerta = 'ok'
      if (f.saldo_actual < 0) alerta = 'critico'
      else if (pctSaldo < 10) alerta = 'bajo'
      const suc = SUCURSALES[f.sucursal_id] || { l: f.sucursal_id, c: '#8E8E93', tipo: 'otro' }
      return { ...f, suc, gastosFondo, pctSaldo, alerta }
    }).sort((a, b) => a.suc.l.localeCompare(b.suc.l))
  }, [fondosFiltrados, movs])

  /* ─── Control ─── */
  const sinRespaldo = useMemo(() =>
    movsFiltrados.filter(m => m.tipo === 'gasto' && !m.url_respaldo && !m.archivo_storage)
                 .sort((a, b) => (b.monto || 0) - (a.monto || 0)).slice(0, 10)
  , [movsFiltrados])

  const gastosAltos = useMemo(() =>
    movsFiltrados.filter(m => m.tipo === 'gasto' && (m.monto || 0) >= UMBRAL_GASTO_ALTO)
                 .sort((a, b) => (b.monto || 0) - (a.monto || 0)).slice(0, 10)
  , [movsFiltrados])

  const fondosNegativos = useMemo(() => tablaFondos.filter(t => t.alerta === 'critico'), [tablaFondos])

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#8E8E93" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
        <div>Cargando dashboard...</div>
      </div>
    )
  }

  return (
    <div>
      {/* TOOLBAR */}
      <div style={{
        display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center",
        padding: 10, background: "#fff", borderRadius: 12,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)", marginBottom: 12
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#3A3A3C" }}>📅 Período:</div>
        <div style={{ display: "flex", gap: 4, background: "#F2F2F7", borderRadius: 8, padding: 3 }}>
          {Object.entries(RANGOS).map(([k, v]) => (
            <button key={k} onClick={() => setRango(k)} style={{
              padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer",
              background: rango === k ? "#fff" : "transparent",
              color: rango === k ? "#1C1C1E" : "#8E8E93",
              fontSize: 12, fontWeight: 600,
              boxShadow: rango === k ? "0 1px 3px rgba(0,0,0,0.1)" : "none"
            }}>{v.l}</button>
          ))}
        </div>
        <div style={{ width: 1, height: 20, background: "#E5E5EA", margin: "0 4px" }} />
        <div style={{ fontSize: 12, fontWeight: 600, color: "#3A3A3C" }}>🏢 Tipo:</div>
        <div style={{ display: "flex", gap: 4, background: "#F2F2F7", borderRadius: 8, padding: 3 }}>
          {[{k:'todos',l:'Todos'},{k:'sucursal',l:'Sucursales'},{k:'direccion',l:'Direcciones'},{k:'area_sucursal',l:'Áreas/Sucursal'}].map(t => (
            <button key={t.k} onClick={() => setFt(t.k)} style={{
              padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer",
              background: filtroTipo === t.k ? "#fff" : "transparent",
              color: filtroTipo === t.k ? "#1C1C1E" : "#8E8E93",
              fontSize: 12, fontWeight: 600,
              boxShadow: filtroTipo === t.k ? "0 1px 3px rgba(0,0,0,0.1)" : "none"
            }}>{t.l}</button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(6,1fr)", gap: 8, marginBottom: 16 }}>
        <Mt l="Saldo disponible" v={fmt(kpis.totalSaldo)} ac={kpis.totalSaldo < 0 ? "#FF3B30" : "#34C759"} ic="💰"
            sub={`${kpis.totalFondos} fondos`} />
        <Mt l={`Gasto ${RANGOS[rango].l.toLowerCase()}`} v={fmt(kpis.gastoPeriodo)} ic="📉" ac="#FF3B30"
            sub={`${kpis.totalGastos} mov.`} />
        <Mt l="Promedio mensual" v={fmt(kpis.gastoPromedio)} ic="📊"
            sub={`base ${RANGOS[rango].meses} ${RANGOS[rango].meses === 1 ? 'mes' : 'meses'}`} />
        <Mt l="Var. vs mes ant."
            v={kpis.variacion == null ? '—' : `${kpis.variacion > 0 ? '+' : ''}${kpis.variacion.toFixed(0)}%`}
            ic={kpis.variacion == null ? "🔄" : kpis.variacion > 0 ? "📈" : "📉"}
            ac={kpis.variacion == null ? "#8E8E93" : kpis.variacion > 10 ? "#FF3B30" : kpis.variacion < -10 ? "#34C759" : "#1C1C1E"}
            sub={kpis.variacion == null ? 'Sin datos' : `Ant: ${fmt(kpis.gastoMesAnt)}`} />
        <Mt l="Fondos en alerta" v={kpis.fondosAlerta} ic="⚠️"
            ac={kpis.fondosAlerta > 0 ? "#FF9500" : "#34C759"}
            sub={kpis.fondosAlerta > 0 ? 'Saldo bajo/neg.' : 'Todos OK'} />
        <Mt l="Sin respaldo" v={`${kpis.pctSinResp.toFixed(0)}%`} ic="📎"
            ac={kpis.pctSinResp > 30 ? "#FF3B30" : kpis.pctSinResp > 15 ? "#FF9500" : "#34C759"}
            sub={`${kpis.sinResp}/${kpis.totalGastos}`} />
      </div>

      {/* TENDENCIA */}
      <Cd>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E" }}>📊 Tendencia mensual — últimos 3 meses</div>
          <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#34C759", borderRadius: 2, marginRight: 4 }} />Ingresos</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#FF3B30", borderRadius: 2, marginRight: 4 }} />Gastos</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 180, padding: "0 4px" }}>
          {tendencia.map((m, i) => {
            const altoIng = (m.ingresos / maxTend) * 140
            const altoGas = (m.gastos / maxTend) * 140
            return (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 140 }}>
                  <div style={{ width: 28, height: Math.max(2, altoIng), background: "#34C759", borderRadius: "4px 4px 0 0", position: "relative" }}>
                    {m.ingresos > 0 && <div style={{ position: "absolute", top: -16, left: -10, right: -10, textAlign: "center", fontSize: 9, color: "#34C759", fontWeight: 700 }}>{Math.round(m.ingresos/1000)}k</div>}
                  </div>
                  <div style={{ width: 28, height: Math.max(2, altoGas), background: "#FF3B30", borderRadius: "4px 4px 0 0", position: "relative" }}>
                    {m.gastos > 0 && <div style={{ position: "absolute", top: -16, left: -10, right: -10, textAlign: "center", fontSize: 9, color: "#FF3B30", fontWeight: 700 }}>{Math.round(m.gastos/1000)}k</div>}
                  </div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#3A3A3C", textTransform: "capitalize" }}>{m.nombre}</div>
                <div style={{ fontSize: 10, color: m.neto < 0 ? "#FF3B30" : "#8E8E93" }}>Neto: {fmt(m.neto)}</div>
              </div>
            )
          })}
        </div>
      </Cd>

      {/* TABLA FONDOS */}
      <Cd>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "#1C1C1E" }}>
          🏦 Fondos consolidados ({tablaFondos.length})
        </div>
        {tablaFondos.length === 0 ? (
          <div style={{ textAlign: "center", padding: 30, color: "#8E8E93" }}>
            No hay fondos para el filtro seleccionado
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F2F2F7", borderBottom: "2px solid #E5E5EA" }}>
                  <th style={th}>Sucursal / Dirección</th>
                  <th style={th}>Tipo</th>
                  <th style={{...th, textAlign: "right"}}>Asignado</th>
                  <th style={{...th, textAlign: "right"}}>Gastado ({RANGOS[rango].l.toLowerCase()})</th>
                  <th style={{...th, textAlign: "right"}}>Saldo</th>
                  <th style={{...th, textAlign: "center"}}>% Saldo</th>
                  <th style={th}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {tablaFondos.map(f => (
                  <tr key={f.id} style={{ borderBottom: "1px solid #F2F2F7" }}>
                    <td style={td}>
                      <Bd c={f.suc.c} bg={f.suc.c + "15"}>{f.suc.l}</Bd>
                    </td>
                    <td style={{...td, fontSize: 11, color: "#8E8E93", textTransform: "capitalize"}}>{f.suc.tipo}</td>
                    <td style={{...td, textAlign: "right"}}>{fmt(f.monto_asignado)}</td>
                    <td style={{...td, textAlign: "right", color: "#FF3B30"}}>{fmt(f.gastosFondo)}</td>
                    <td style={{...td, textAlign: "right", fontWeight: 700, color: f.saldo_actual < 0 ? "#FF3B30" : "#1C1C1E"}}>
                      {fmt(f.saldo_actual)}
                    </td>
                    <td style={{...td, textAlign: "center"}}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 60, height: 6, background: "#E5E5EA", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{
                            width: `${Math.max(0, Math.min(100, f.pctSaldo))}%`,
                            height: "100%",
                            background: f.pctSaldo < 10 ? "#FF3B30" : f.pctSaldo < 30 ? "#FF9500" : "#34C759"
                          }} />
                        </div>
                        <span style={{ fontSize: 11, color: "#8E8E93", minWidth: 32 }}>{f.pctSaldo.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td style={td}>
                      {f.alerta === 'critico'
                        ? <Bd c="#FF3B30" bg="#FF3B3015">⚠ Negativo</Bd>
                        : f.alerta === 'bajo'
                        ? <Bd c="#FF9500" bg="#FF950015">Bajo</Bd>
                        : <Bd c="#34C759" bg="#34C75915">OK</Bd>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cd>

      {/* CONCENTRACIÓN — 2 paneles */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
        <Cd>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "#1C1C1E" }}>
            📂 Top 10 categorías
          </div>
          <BarsList items={topCategorias} total={kpis.gastoPeriodo} color="#007AFF" />
        </Cd>
        <Cd>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "#1C1C1E" }}>
            🏪 Top 10 proveedores
          </div>
          <BarsList items={topProveedores.map(p => ({ n: p.n, t: p.t, sub: `${p.c} mov.` }))} total={kpis.gastoPeriodo} color="#AF52DE" />
        </Cd>
      </div>

      {/* TOP RESPONSABLES */}
      <Cd>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "#1C1C1E" }}>
          👤 Top 5 responsables — quién compró más
        </div>
        {topResponsables.length === 0 ? (
          <div style={{ textAlign: "center", padding: 20, color: "#8E8E93", fontSize: 13 }}>
            Sin datos de responsables
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
            {topResponsables.map(r => (
              <div key={r.n} style={{ padding: 12, background: "#F2F2F7", borderRadius: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1C1C1E", marginBottom: 4 }}>{r.n}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#FF3B30" }}>{fmt(r.t)}</div>
                <div style={{ fontSize: 11, color: "#8E8E93", marginTop: 2 }}>{r.c} movimientos · prom. {fmt(r.t / r.c)}</div>
              </div>
            ))}
          </div>
        )}
      </Cd>

      {/* CONTROL Y ALERTAS */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
        <Cd>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "#FF9500" }}>
            📎 Gastos sin respaldo ({sinRespaldo.length})
          </div>
          <ListaMovs items={sinRespaldo} fondos={fondos} />
        </Cd>
        <Cd>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "#FF3B30" }}>
            💸 Gastos altos (≥ {fmt(UMBRAL_GASTO_ALTO)})
          </div>
          <ListaMovs items={gastosAltos} fondos={fondos} />
        </Cd>
      </div>

      {/* FONDOS NEGATIVOS */}
      {fondosNegativos.length > 0 && (
        <Cd>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "#FF3B30" }}>
            ⚠️ Fondos con saldo negativo — requieren reposición
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {fondosNegativos.map(f => (
              <div key={f.id} style={{
                padding: "10px 14px", borderRadius: 10,
                background: "#FF3B3015", border: "1px solid #FF3B3030"
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: f.suc.c }}>{f.suc.l}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#FF3B30" }}>{fmt(f.saldo_actual)}</div>
                <div style={{ fontSize: 10, color: "#8E8E93" }}>Reponer al menos {fmt(Math.abs(f.saldo_actual))}</div>
              </div>
            ))}
          </div>
        </Cd>
      )}
    </div>
  )
}

/* ─── Auxiliares ─── */
function BarsList({ items, total, color }) {
  if (items.length === 0) {
    return <div style={{ textAlign: "center", padding: 20, color: "#8E8E93", fontSize: 13 }}>Sin datos</div>
  }
  return (
    <div>
      {items.map((it, i) => {
        const pct = total > 0 ? (it.t / total) * 100 : 0
        return (
          <div key={i} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
              <span style={{ fontWeight: 600, color: "#1C1C1E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>
                {it.n}
              </span>
              <span style={{ color: "#8E8E93" }}>
                {fmt(it.t)} <span style={{ color: "#C7C7CC" }}>({pct.toFixed(0)}%)</span>
                {it.sub && <span style={{ marginLeft: 6, fontSize: 10 }}>· {it.sub}</span>}
              </span>
            </div>
            <div style={{ height: 5, background: "#F2F2F7", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: color }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ListaMovs({ items, fondos }) {
  if (items.length === 0) {
    return <div style={{ textAlign: "center", padding: 20, color: "#34C759", fontSize: 13 }}>✓ Nada que reportar</div>
  }
  return (
    <div style={{ maxHeight: 240, overflowY: "auto" }}>
      {items.map(m => {
        const f = fondos.find(x => x.id === m.fondo_id)
        const suc = f ? SUCURSALES[f.sucursal_id] : null
        return (
          <div key={m.id} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "8px 0", borderBottom: "1px solid #F2F2F7", fontSize: 12
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: "#1C1C1E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {m.proveedor || m.descripcion || '(sin descripción)'}
              </div>
              <div style={{ fontSize: 10, color: "#8E8E93", marginTop: 2 }}>
                {m.fecha} · {suc?.l || '—'} · {m.gm_categorias?.nombre || 'Sin cat.'}
              </div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#FF3B30", marginLeft: 8 }}>
              {fmt(m.monto)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const th = { padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#3A3A3C", textTransform: "uppercase", letterSpacing: "0.03em" }
const td = { padding: "10px 12px", fontSize: 13, color: "#1C1C1E" }
