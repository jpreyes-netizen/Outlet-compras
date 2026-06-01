import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { fmt } from '../../lib/constants'
import { Cd, Mt, Bd, css } from '../../components/UI'

const SUCURSALES = {
  'suc-la': { l: 'Los Ángeles', c: '#007AFF' },
  'suc-mp': { l: 'Maipú',       c: '#34C759' },
  'suc-lg': { l: 'La Granja',   c: '#FF9500' }
}

export function GmDashboard({ cu, isMobile }) {
  const [loading, setLoading] = useState(true)
  const [fondos, setFondos] = useState([])
  const [movsMes, setMovsMes] = useState([])
  const [topCategorias, setTopCategorias] = useState([])

  const cargar = async () => {
    setLoading(true)
    try {
      // Fondos activos
      const { data: fs } = await supabase
        .from('gm_fondos')
        .select('id, sucursal_id, custodio_id, monto_asignado, saldo_actual, estado, fecha_apertura')
        .eq('estado', 'activo')

      // Movimientos del mes actual
      const inicioMes = new Date()
      inicioMes.setDate(1)
      const inicioMesStr = inicioMes.toISOString().slice(0, 10)
      const { data: ms } = await supabase
        .from('gm_movimientos')
        .select('id, fondo_id, fecha, tipo, monto, categoria_id, descripcion, proveedor, gm_categorias(nombre)')
        .gte('fecha', inicioMesStr)
        .order('fecha', { ascending: false })

      setFondos(fs || [])
      setMovsMes(ms || [])

      // Top categorías del mes
      const agg = {}
      ;(ms || []).filter(m => m.tipo === 'gasto').forEach(m => {
        const cat = m.gm_categorias?.nombre || '(Sin categoría)'
        agg[cat] = (agg[cat] || 0) + (m.monto || 0)
      })
      const top = Object.entries(agg)
        .map(([nombre, total]) => ({ nombre, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 8)
      setTopCategorias(top)
    } catch (e) {
      console.error('Error cargando dashboard GM:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#8E8E93" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
        <div>Cargando dashboard...</div>
      </div>
    )
  }

  // KPIs globales
  const totalAsignado = fondos.reduce((s, f) => s + (f.monto_asignado || 0), 0)
  const totalSaldo    = fondos.reduce((s, f) => s + (f.saldo_actual || 0), 0)
  const gastoMes      = movsMes.filter(m => m.tipo === 'gasto').reduce((s, m) => s + (m.monto || 0), 0)
  const ingresoMes    = movsMes.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (m.monto || 0), 0)

  // Alertas por fondo
  const alertas = fondos.map(f => {
    const pct = f.monto_asignado > 0 ? (f.saldo_actual / f.monto_asignado) : 1
    let nivel = 'ok'
    if (f.saldo_actual < 0) nivel = 'critico'
    else if (pct < 0.1) nivel = 'bajo'
    return { ...f, pct, nivel }
  })

  return (
    <div>
      {/* KPIs globales */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <Mt l="Saldo total disponible" v={fmt(totalSaldo)} ac={totalSaldo < 0 ? "#FF3B30" : "#34C759"} ic="💰" />
        <Mt l="Fondos activos" v={fondos.length} sub={`Asignado: ${fmt(totalAsignado)}`} ic="🏦" />
        <Mt l="Gastos del mes" v={fmt(gastoMes)} sub={`${movsMes.filter(m => m.tipo === 'gasto').length} movimientos`} ic="📉" ac="#FF3B30" />
        <Mt l="Ingresos del mes" v={fmt(ingresoMes)} sub={`${movsMes.filter(m => m.tipo === 'ingreso').length} reposiciones`} ic="📈" ac="#34C759" />
      </div>

      {/* Alertas de saldo */}
      {alertas.some(a => a.nivel !== 'ok') && (
        <Cd>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "#1C1C1E" }}>
            ⚠️ Alertas de saldo
          </div>
          {alertas.filter(a => a.nivel !== 'ok').map(a => {
            const suc = SUCURSALES[a.sucursal_id] || { l: a.sucursal_id, c: "#8E8E93" }
            const esCritico = a.nivel === 'critico'
            return (
              <div key={a.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 12px", borderRadius: 10,
                background: esCritico ? "#FF3B3015" : "#FF950015",
                border: `1px solid ${esCritico ? "#FF3B3030" : "#FF950030"}`,
                marginBottom: 6
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: suc.c }}>{suc.l}</div>
                  <div style={{ fontSize: 11, color: "#8E8E93", marginTop: 2 }}>
                    {esCritico ? "Saldo negativo — requiere reposición" : `Saldo bajo (${(a.pct * 100).toFixed(0)}% del fondo)`}
                  </div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: esCritico ? "#FF3B30" : "#FF9500" }}>
                  {fmt(a.saldo_actual)}
                </div>
              </div>
            )
          })}
        </Cd>
      )}

      {/* Fondos por sucursal */}
      <Cd>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "#1C1C1E" }}>
          Fondos por sucursal
        </div>
        {fondos.length === 0 ? (
          <div style={{ textAlign: "center", padding: 30, color: "#8E8E93" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>🏦</div>
            <div style={{ fontSize: 13 }}>No hay fondos activos. Crea uno desde el tab Config.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {fondos.map(f => {
              const suc = SUCURSALES[f.sucursal_id] || { l: f.sucursal_id, c: "#8E8E93" }
              const pct = f.monto_asignado > 0 ? (f.saldo_actual / f.monto_asignado) * 100 : 0
              const pctClamp = Math.max(0, Math.min(100, pct))
              return (
                <div key={f.id} style={{
                  padding: 14, borderRadius: 12,
                  background: suc.c + "08",
                  border: `1px solid ${suc.c}20`
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: suc.c, marginBottom: 6 }}>{suc.l}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: f.saldo_actual < 0 ? "#FF3B30" : "#1C1C1E", marginBottom: 2 }}>
                    {fmt(f.saldo_actual)}
                  </div>
                  <div style={{ fontSize: 11, color: "#8E8E93", marginBottom: 8 }}>
                    de {fmt(f.monto_asignado)} asignados
                  </div>
                  <div style={{ height: 6, background: "#E5E5EA", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", width: `${pctClamp}%`,
                      background: pct < 10 ? "#FF3B30" : pct < 30 ? "#FF9500" : "#34C759",
                      transition: "width 0.3s"
                    }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Cd>

      {/* Top categorías del mes */}
      <Cd>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "#1C1C1E" }}>
          Top categorías — gastos del mes
        </div>
        {topCategorias.length === 0 ? (
          <div style={{ textAlign: "center", padding: 20, color: "#8E8E93", fontSize: 13 }}>
            Aún no hay gastos este mes
          </div>
        ) : (
          <div>
            {topCategorias.map((c, i) => {
              const pct = gastoMes > 0 ? (c.total / gastoMes) * 100 : 0
              return (
                <div key={c.nombre} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                    <span style={{ fontWeight: 600, color: "#1C1C1E" }}>{c.nombre}</span>
                    <span style={{ color: "#8E8E93" }}>{fmt(c.total)} <span style={{ color: "#C7C7CC" }}>({pct.toFixed(0)}%)</span></span>
                  </div>
                  <div style={{ height: 5, background: "#F2F2F7", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: "#007AFF" }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Cd>
    </div>
  )
}
