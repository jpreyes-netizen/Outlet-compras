import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { fN, fmtMM, card, SectionTitle, Lectura } from './ui'
import { normSuc, SUCURSALES } from './engine'

const SUC_COLOR = { "La Granja": "#34C759", "Los Angeles": "#007AFF", "Maipu": "#FF9500", "TODAS": "#5856D6" }

/* Gráfico de línea SVG simple, sin librerías */
function LineChart({ series, labels, fmt: fmtFn, color = "#5856D6", h = 130 }) {
  if (!series || series.length < 2) return <div style={{ fontSize: 12, color: "#AEAEB2", padding: "20px 0", textAlign: "center" }}>Se necesitan al menos 2 días de historia para graficar.</div>
  const W = 600, H = h, PAD = 6
  const min = Math.min(...series), max = Math.max(...series)
  const rng = max - min || 1
  const x = i => PAD + (i / (series.length - 1)) * (W - PAD * 2)
  const y = v => H - PAD - ((v - min) / rng) * (H - PAD * 2)
  const pts = series.map((v, i) => `${x(i)},${y(v)}`).join(" ")
  const area = `${PAD},${H - PAD} ${pts} ${W - PAD},${H - PAD}`
  const last = series[series.length - 1], first = series[0]
  const delta = last - first
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span style={{ fontSize: 20, fontWeight: 800, color: "#1C1C1E" }}>{fmtFn(last)}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: delta > 0 ? "#FF3B30" : delta < 0 ? "#34C759" : "#8E8E93" }}>
          {delta === 0 ? "sin cambio" : (delta > 0 ? "▲ +" : "▼ ") + fmtFn(Math.abs(delta)) + " en el período"}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
        <polygon points={area} fill={color + "18"} />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
        {series.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3" fill={color}><title>{labels[i]}: {fmtFn(v)}</title></circle>)}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#AEAEB2" }}>
        <span>{labels[0]}</span><span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  )
}

export function InvTendencias({ sucursalFiltro, accent, isMobile }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState("")

  useEffect(() => {
    const cargar = async () => {
      try {
        const { data, error } = await supabase
          .from("v_inv_historia")
          .select("*")
          .order("snap_date", { ascending: true })
          .limit(5000)
        if (error) { setErr(error.message); return }
        setRows(data || [])
      } catch (e) { setErr(e.message) }
    }
    cargar()
  }, [])

  // Agregar por fecha, normalizando sucursal y respetando el filtro global
  const serie = useMemo(() => {
    if (!rows) return null
    const porFecha = new Map()
    for (const r of rows) {
      const suc = normSuc(r.sucursal)
      if (sucursalFiltro && sucursalFiltro !== "TODAS" && suc !== sucursalFiltro) continue
      const f = r.snap_date
      const e = porFecha.get(f) || { valor: 0, unidades: 0, quiebres: 0, skus_dead: 0, valor_dead: 0, skus_con_stock: 0 }
      e.valor += Number(r.valor) || 0
      e.unidades += Number(r.unidades) || 0
      e.quiebres += Number(r.quiebres) || 0
      e.skus_dead += Number(r.skus_dead) || 0
      e.valor_dead += Number(r.valor_dead) || 0
      e.skus_con_stock += Number(r.skus_con_stock) || 0
      porFecha.set(f, e)
    }
    const fechas = [...porFecha.keys()].sort()
    const lbl = fechas.map(f => { const [y, m, d] = f.split("-"); return d + "/" + m })
    return {
      fechas, lbl,
      valor: fechas.map(f => porFecha.get(f).valor),
      quiebres: fechas.map(f => porFecha.get(f).quiebres),
      valorDead: fechas.map(f => porFecha.get(f).valor_dead),
      unidades: fechas.map(f => porFecha.get(f).unidades),
    }
  }, [rows, sucursalFiltro])

  if (err) return <div style={{ ...card, color: "#FF3B30", fontSize: 13 }}>
    ⚠️ No se pudo cargar la historia: {err}.<br />
    <span style={{ color: "#636366" }}>Si la vista no existe, ejecuta el SQL <b>sql_historia.sql</b> en Supabase primero.</span>
  </div>
  if (!serie) return <div style={{ textAlign: "center", padding: 40, color: "#8E8E93" }}>⏳ Cargando historia...</div>
  if (serie.fechas.length === 0) return <div style={{ ...card, textAlign: "center", padding: 30, color: "#8E8E93", fontSize: 13 }}>Sin snapshots históricos aún. El cron nocturno los irá acumulando día a día.</div>

  const sucLabel = sucursalFiltro && sucursalFiltro !== "TODAS" ? sucursalFiltro : "todas las sucursales"
  const color = SUC_COLOR[sucursalFiltro] || accent

  // Lecturas automáticas de tendencia
  const q0 = serie.quiebres[0], q1 = serie.quiebres[serie.quiebres.length - 1]
  const d0 = serie.valorDead[0], d1 = serie.valorDead[serie.valorDead.length - 1]

  return (
    <div>
      <div style={{ ...card, background: "linear-gradient(135deg,#1a1a2e,#16213e)", color: "#fff" }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>📈 Tendencias — {sucLabel}</div>
        <div style={{ fontSize: 12.5, color: "#c7c7d9", marginTop: 3, lineHeight: 1.5 }}>
          Evolución diaria desde los snapshots nocturnos ({serie.fechas.length} días registrados). Aquí se mide si la gestión funciona: los quiebres deben bajar, el capital muerto debe bajar, y el valor del inventario debe estabilizarse en su nivel óptimo.
        </div>
      </div>

      <div style={{ display: isMobile ? "block" : "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={card}>
          <SectionTitle sub="Cuánta plata tienes en mercadería, día a día">💰 Valor del inventario</SectionTitle>
          <LineChart series={serie.valor} labels={serie.lbl} fmt={fmtMM} color={color} />
        </div>
        <div style={card}>
          <SectionTitle sub="Productos que venden y están en 0 — la métrica que debe BAJAR">⚠️ Quiebres</SectionTitle>
          <LineChart series={serie.quiebres} labels={serie.lbl} fmt={v => fN(v) + " SKU"} color="#FF3B30" />
        </div>
        <div style={card}>
          <SectionTitle sub="Capital en productos que no se venden">🧊 Capital muerto (dead stock)</SectionTitle>
          <LineChart series={serie.valorDead} labels={serie.lbl} fmt={fmtMM} color="#AF52DE" />
        </div>
        <div style={card}>
          <SectionTitle sub="Unidades físicas totales en bodega y góndola">📦 Unidades en stock</SectionTitle>
          <LineChart series={serie.unidades} labels={serie.lbl} fmt={v => fN(v) + " u"} color="#FF9500" />
        </div>
      </div>

      {serie.fechas.length >= 7 && (
        <div style={card}>
          <SectionTitle>🔎 Lectura de la tendencia</SectionTitle>
          <Lectura icon={q1 < q0 ? "✅" : "🚨"} titulo="Quiebres:" color={q1 < q0 ? "#34C759" : "#FF3B30"}>
            {q1 < q0
              ? `bajaron de ${fN(q0)} a ${fN(q1)} SKU. La gestión de reposición está funcionando — mantén el ritmo de pedidos a Maipú y compras.`
              : q1 > q0
                ? `subieron de ${fN(q0)} a ${fN(q1)} SKU. Se está quebrando más rápido de lo que se repone. Revisa el Plan de hoy en Mi Tienda.`
                : `se mantienen en ${fN(q1)} SKU. Sin avance — el plan de reposición necesita ejecutarse.`}
          </Lectura>
          <Lectura icon={d1 < d0 ? "✅" : "📦"} titulo="Capital muerto:" color={d1 < d0 ? "#34C759" : "#FF9500"}>
            {d1 < d0
              ? `bajó de ${fmtMM(d0)} a ${fmtMM(d1)}. Las liquidaciones están liberando capital.`
              : `está en ${fmtMM(d1)}${d1 > d0 ? " y subiendo" : ""}. Ese dinero no genera venta — activa liquidaciones desde Mi Tienda.`}
          </Lectura>
        </div>
      )}
    </div>
  )
}
