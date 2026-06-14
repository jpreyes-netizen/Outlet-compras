import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { fmt, fN, card, SectionTitle } from './ui'

const ACCENT = "#5856D6"

const MESES = ["","Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"]
const fmtPeriodo = p => { if (!p) return "—"; const [y,m]=p.split("-"); return `${MESES[+m]} ${y}` }
const fmtSeg = s => s == null ? "—" : s < 60 ? `${Math.round(s)}s` : `${Math.floor(s/60)}m ${Math.round(s%60)}s`
const fmtFecha = ts => ts ? new Date(ts).toLocaleString("es-CL",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : "—"

export function InvSync({ dataGlobal, accent = ACCENT, isMobile }) {
  const [logs, setLogs] = useState([])
  const [loadingLogs, setLoadingLogs] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [tipo, setTipo] = useState("incremental")
  const [desde, setDesde] = useState("2026-01")
  const [hasta, setHasta] = useState(() => { const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}` })
  const [progLog, setProgLog] = useState([])

  const cargarLogs = async () => {
    setLoadingLogs(true)
    const { data } = await supabase.from("inv_sync_log").select("*").order("started_at", { ascending: false }).limit(10)
    setLogs(data || [])
    setLoadingLogs(false)
  }

  useEffect(() => { cargarLogs() }, [])

  const addProg = msg => setProgLog(p => [...p, { ts: new Date().toLocaleTimeString("es-CL"), msg }])

  // Genera lista de periodos YYYY-MM entre desde y hasta
  const generarPeriodos = (d, h) => {
    const periodos = []
    let [y, m] = d.split("-").map(Number)
    const [yh, mh] = h.split("-").map(Number)
    while (y < yh || (y === yh && m <= mh)) {
      periodos.push(`${y}-${String(m).padStart(2, "0")}`)
      m++; if (m > 12) { m = 1; y++ }
    }
    return periodos
  }

  const llamarEdge = async (payload, intento = 1) => {
    try {
      // Obtener token fresco — refresca si expiró (evita "session is not defined")
      let token = null
      const { data: sd } = await supabase.auth.getSession()
      if (sd?.session?.access_token) {
        token = sd.session.access_token
      } else {
        const { data: rd } = await supabase.auth.refreshSession()
        token = rd?.session?.access_token
      }

      const r = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bsale-inv-sync`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(140000),
        }
      )
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    } catch (e) {
      if (intento < 3 && (e.message.includes("fetch") || e.message.includes("network") || e.name === "TimeoutError" || e.name === "AbortError")) {
        const espera = intento * 4000
        addProg(`  ↻ Reintento ${intento}/2 en ${espera/1000}s...`)
        await new Promise(res => setTimeout(res, espera))
        return llamarEdge(payload, intento + 1)
      }
      throw e
    }
  }

  // Sincroniza nombres y costos de TODAS las variantes BSALE → inv_sku_meta
  const sincronizarNombres = async () => {
    setRunning(true); setResult(null); setProgLog([])
    addProg("🏷️ Sincronizando nombres y costos desde BSALE...")
    let offset = 0, total = 0, vueltas = 0
    try {
      while (offset !== null && vueltas < 50) {
        vueltas++
        const r = await llamarEdge({ tipo: "meta_sync", offset })
        if (!r.ok) { addProg(`  ⚠️ Error: ${r.error || "sin respuesta"}`); break }
        total += r.procesados || 0
        addProg(`  ✅ ${total} variantes procesadas...`)
        offset = r.next_offset
      }
      addProg(`🏁 Listo: ${total} nombres/costos sincronizados. Recarga la app (Ctrl+Shift+R) para verlos.`)
      setResult({ ok: true })
    } catch (e) {
      addProg(`❌ ${e.message}`)
      setResult({ ok: false, error: e.message })
    }
    setRunning(false)
    cargarHistorial()
  }

  // Sincroniza costos desde /v1/stocks.json (que incluye averageCost) → actualiza inv_sku_meta
  const sincronizarCostos = async () => {
    setRunning(true); setResult(null); setProgLog([])
    addProg("💰 Sincronizando costos desde BSALE...")
    let offset = 0, total = 0, vueltas = 0
    try {
      while (offset !== null && vueltas < 50) {
        vueltas++
        const r = await llamarEdge({ tipo: "costos_sync", offset })
        if (!r.ok) { addProg(`  ⚠️ Error: ${r.error || "sin respuesta"}`); break }
        total += r.procesados || 0
        addProg(`  ✅ ${total} costos sincronizados...`)
        offset = r.next_offset
      }
      addProg(`🏁 Listo: ${total} costos actualizados. Recarga la app para verlos.`)
      setResult({ ok: true })
    } catch (e) {
      addProg(`❌ ${e.message}`)
      setResult({ ok: false, error: e.message })
    }
    setRunning(false)
    cargarHistorial()
  }

  const ejecutarSync = async () => {
    setRunning(true); setResult(null); setProgLog([])
    addProg("Iniciando sincronización con BSALE...")

    const totales = { docs: 0, skus_ventas: 0, snaps: 0, filas_ventas: 0, duracion_seg: 0 }
    let errores = 0

    try {
      // Stock: siempre una sola llamada rápida (~30s)
      if (tipo !== "ventas_only") {
        addProg("📦 Sincronizando stock actual...")
        const r = await llamarEdge({ tipo: "stock_only" })
        if (r.ok) {
          totales.snaps += r.snaps || 0
          totales.duracion_seg += r.duracion_seg || 0
          addProg(`✅ Stock: ${fN(r.snaps)} snaps guardados (${fmtSeg(r.duracion_seg)})`)
        } else {
          addProg(`⚠️ Error en stock: ${r.error}`)
          errores++
        }
      }

      // Ventas: una llamada por tipo × mes. NC (61) se divide en quincenas para evitar timeout.
      // Tipos venta: 39=boleta, 41=boleta no afecta, 33=factura, 34=factura no afecta
      const TIPOS_VENTA = [
        { codesii: 39, label: "boletas" },
        { codesii: 41, label: "boletas NA" },
        { codesii: 33, label: "facturas" },
        { codesii: 34, label: "facturas NA" },
      ]

      // NC en quincenas — separa el mes en 1-15 y 16-fin para que cada tramo quepa en 140s
      const ncChunks = (periodo) => {
        const [y, m] = periodo.split("-").map(Number)
        const finMes = new Date(y, m, 0).getDate() // último día del mes
        return [
          { desde: `${periodo}-01`, hasta: `${periodo}-15`,  label: "NC q1" },
          { desde: `${periodo}-16`, hasta: `${periodo}-${finMes}`, label: "NC q2" },
        ]
      }

      if (tipo !== "stock_only") {
        const periodos = generarPeriodos(desde, hasta)
        const totalLlamadas = periodos.length * (TIPOS_VENTA.length + 2)
        addProg(`📅 Procesando ${periodos.length} meses × ${TIPOS_VENTA.length + 2} llamadas = ${totalLlamadas} total...`)

        for (const periodo of periodos) {
          let docsMes = 0, filasMes = 0, errMes = 0

          // Tipos de venta (boletas y facturas)
          for (const td of TIPOS_VENTA) {
            try {
              const r = await llamarEdge({
                tipo: "ventas_only",
                desde: periodo, hasta: periodo,
                periodo, codesii: td.codesii
              })
              if (r.ok) {
                totales.docs        += r.docs || 0
                totales.filas_ventas += r.filas_ventas || 0
                totales.skus_ventas  = Math.max(totales.skus_ventas, r.skus_ventas || 0)
                totales.duracion_seg += r.duracion_seg || 0
                docsMes  += r.docs || 0
                filasMes += r.filas_ventas || 0
              } else {
                addProg(`  ⚠️ ${fmtPeriodo(periodo)} ${td.label}: ${r.error || "sin respuesta"}`)
                errMes++; errores++
              }
            } catch (e) {
              addProg(`  ⚠️ ${fmtPeriodo(periodo)} ${td.label}: ${e.message}`)
              errMes++; errores++
            }
          }

          // NC en dos quincenas para evitar timeout
          for (const chunk of ncChunks(periodo)) {
            try {
              const r = await llamarEdge({
                tipo: "ventas_only",
                desde: periodo, hasta: periodo,
                fecha_desde: chunk.desde, fecha_hasta: chunk.hasta,
                periodo, codesii: 61
              })
              if (r.ok) {
                totales.docs        += r.docs || 0
                totales.filas_ventas += r.filas_ventas || 0
                totales.duracion_seg += r.duracion_seg || 0
                docsMes  += r.docs || 0
                filasMes += r.filas_ventas || 0
              } else {
                addProg(`  ⚠️ ${fmtPeriodo(periodo)} ${chunk.label}: ${r.error || "sin respuesta"}`)
                errMes++; errores++
              }
            } catch (e) {
              addProg(`  ⚠️ ${fmtPeriodo(periodo)} ${chunk.label}: ${e.message}`)
              errMes++; errores++
            }
          }
          if (errMes === 0) {
            addProg(`  ✅ ${fmtPeriodo(periodo)}: ${fN(docsMes)} docs · ${fN(filasMes)} filas`)
          } else {
            addProg(`  ⚠️ ${fmtPeriodo(periodo)}: ${fN(docsMes)} docs · ${errMes} tipo(s) con error`)
          }
          await new Promise(r => setTimeout(r, 2000))
        }
      }

      const ok = errores === 0
      addProg(ok
        ? `✅ Sync completa — ${fN(totales.docs)} docs · ${fN(totales.snaps)} snaps · ${fmtSeg(totales.duracion_seg)} total`
        : `⚠️ Completada con ${errores} error(es) — revisa arriba`)
      setResult({ ok, ...totales, errores })

    } catch (e) {
      addProg(`❌ Error fatal: ${e.message}`)
      setResult({ ok: false, error: e.message })
    }
    setRunning(false)
    cargarLogs()
  }

  const inputStyle = { padding: "8px 12px", borderRadius: 10, border: "1px solid #e5e5ea", fontSize: 13, outline: "none", background: "#fff" }

  return (
    <div>
      {/* Panel de control */}
      <div style={card}>
        <SectionTitle sub="Extrae ventas y stock desde BSALE API y los guarda en Supabase">Sincronización BSALE → Base de datos</SectionTitle>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14, alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#8E8E93", marginBottom: 4 }}>Tipo</div>
            <select value={tipo} onChange={e => setTipo(e.target.value)} style={inputStyle}>
              <option value="incremental">Incremental (mes anterior + actual)</option>
              <option value="full">Completo (rango personalizado)</option>
              <option value="stock_only">Solo stock (sin ventas)</option>
            </select>
          </div>
          {tipo === "full" && <>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#8E8E93", marginBottom: 4 }}>Desde</div>
              <input type="month" value={desde} onChange={e => setDesde(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#8E8E93", marginBottom: 4 }}>Hasta</div>
              <input type="month" value={hasta} onChange={e => setHasta(e.target.value)} style={inputStyle} />
            </div>
          </>}
          <button onClick={ejecutarSync} disabled={running} style={{
            padding: "10px 24px", borderRadius: 12, border: "none", cursor: running ? "wait" : "pointer",
            background: running ? "#C7C7CC" : accent, color: "#fff", fontWeight: 700, fontSize: 14,
            boxShadow: running ? "none" : `0 4px 12px ${accent}55`
          }}>
            {running ? "⏳ Sincronizando…" : "▶ Ejecutar sync"}
          </button>
        </div>

        {/* Notas por tipo */}
        <div style={{ fontSize: 11.5, color: "#8E8E93", lineHeight: 1.7, padding: "8px 12px", background: "#F7F7FA", borderRadius: 8 }}>
          {tipo === "incremental" && "Actualiza el mes anterior y el mes en curso. Ideal para ejecutar diariamente. ~2-5 min."}
          {tipo === "full" && `Procesa todos los meses del rango. Para la carga inicial Jan→May 2026 puede tardar 10-15 min. No interrumpir.`}
          {tipo === "stock_only" && "Solo captura un snapshot de stock actual por sucursal. No toca ventas. ~30 segundos."}
        </div>
      </div>

      {/* Log en vivo */}
      {progLog.length > 0 && (
        <div style={{ ...card, fontFamily: "monospace", fontSize: 12, background: "#1C1C1E", color: "#fff" }}>
          {progLog.map((l, i) => (
            <div key={i} style={{ padding: "2px 0", color: l.msg.startsWith("❌") ? "#FF453A" : l.msg.startsWith("✅") ? "#32D74B" : "#EBEBF5" }}>
              <span style={{ color: "#636366", marginRight: 8 }}>{l.ts}</span>{l.msg}
            </div>
          ))}
          {running && <div style={{ color: "#5AC8FA", marginTop: 4 }}>● ejecutando…</div>}
        </div>
      )}

      {/* Resultado */}
      {result && (
        <div style={{ ...card, background: result.ok ? "#34C75910" : "#FF3B3010", border: `1px solid ${result.ok ? "#34C759" : "#FF3B30"}40` }}>
          {result.ok ? (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {[
                ["Documentos", fN(result.docs)],
                ["SKU ventas", fN(result.skus_ventas)],
                ["Snaps stock", fN(result.snaps)],
                ["Filas ventas", fN(result.filas_ventas)],
                ["Duración", fmtSeg(result.duracion_seg)],
              ].map(([l, v]) => (
                <div key={l}>
                  <div style={{ fontSize: 10, color: "#8E8E93" }}>{l}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#34C759" }}>{v}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: "#FF3B30", fontWeight: 600 }}>❌ {result.error}</div>
          )}
        </div>
      )}

      {/* Panel CALIDAD DE DATOS */}
      {dataGlobal && (() => {
        const items = dataGlobal.an.items
        const sinNombre = items.filter(x => x.producto === x.sku).length
        const sinCosto = items.filter(x => !x.costoU || x.costoU === 0).length
        const total = items.length
        const pctNombre = total > 0 ? (total - sinNombre) / total : 1
        const pctCosto = total > 0 ? (total - sinCosto) / total : 1
        return (
          <div style={card}>
            <SectionTitle sub="Cuán completos están los datos que alimentan los análisis">📋 Calidad de datos</SectionTitle>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <CalidadCard
                titulo="Nombres de producto"
                ok={total - sinNombre} total={total} pct={pctNombre}
                detalle={sinNombre === 0 ? "Todos los SKU tienen nombre." : `${fN(sinNombre)} SKU aparecen como código. Son productos descontinuados que vendieron en el período pero ya no existen como variante activa en BSALE — no se pueden recuperar con sync, no afecta los análisis.`}
                accionLabel="🏷️ Sincronizar nombres"
                accion={sincronizarNombres}
                running={running}
                accent={accent}
              />
              <CalidadCard
                titulo="Costos unitarios"
                ok={total - sinCosto} total={total} pct={pctCosto}
                detalle={sinCosto === 0 ? "Todos los SKU tienen costo." : `${fN(sinCosto)} SKU sin costo registrado. Esto afecta el cálculo de GMROI, margen y valor de inventario. El sync de costos los trae desde el stock de BSALE.`}
                accionLabel="💰 Sincronizar costos"
                accion={sincronizarCostos}
                running={running}
                accent={accent}
              />
            </div>
          </div>
        )
      })()}

      {/* Historial de syncs */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <SectionTitle>Historial de sincronizaciones</SectionTitle>
          <button onClick={cargarLogs} style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: "#F2F2F7", color: "#636366", fontSize: 12, cursor: "pointer" }}>↻ Actualizar</button>
        </div>
        {loadingLogs ? (
          <div style={{ color: "#8E8E93", fontSize: 13 }}>Cargando…</div>
        ) : logs.length === 0 ? (
          <div style={{ color: "#8E8E93", fontSize: 13 }}>Sin sincronizaciones aún. Ejecuta la primera arriba.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr style={{ color: "#8E8E93", fontSize: 11 }}>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>Fecha</th>
                <th style={{ padding: "6px 8px" }}>Tipo</th>
                <th style={{ padding: "6px 8px" }}>Período</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Docs</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>SKU</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Duración</th>
                <th style={{ padding: "6px 8px" }}>Estado</th>
              </tr></thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id} style={{ borderTop: "1px solid #F2F2F7" }}>
                    <td style={{ padding: "7px 8px", fontSize: 12 }}>{fmtFecha(l.started_at)}</td>
                    <td style={{ padding: "7px 8px", fontSize: 12 }}>{l.tipo}</td>
                    <td style={{ padding: "7px 8px", fontSize: 12 }}>{fmtPeriodo(l.periodo_desde)} → {fmtPeriodo(l.periodo_hasta)}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", fontSize: 12 }}>{fN(l.docs_procesados)}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", fontSize: 12 }}>{fN(l.skus_ventas)}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", fontSize: 12 }}>{fmtSeg(l.duracion_seg)}</td>
                    <td style={{ padding: "7px 8px" }}>
                      <span style={{
                        padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                        color: l.estado === "ok" ? "#34C759" : l.estado === "error" ? "#FF3B30" : "#FF9500",
                        background: l.estado === "ok" ? "#34C75915" : l.estado === "error" ? "#FF3B3015" : "#FF950015"
                      }}>{l.estado}</span>
                      {l.error_msg && <div style={{ fontSize: 10, color: "#FF3B30", marginTop: 2 }}>{l.error_msg.slice(0, 60)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/* Tarjeta de calidad de datos con barra de progreso y botón de acción */
function CalidadCard({ titulo, ok, total, pct, detalle, accionLabel, accion, running, accent }) {
  const color = pct >= 0.85 ? "#34C759" : pct >= 0.6 ? "#FF9500" : "#FF3B30"
  return (
    <div style={{ flex: "1 1 320px", border: "1px solid #F2F2F7", borderRadius: 12, padding: "14px 16px", background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#1C1C1E" }}>{titulo}</span>
        <span style={{ fontSize: 11, color: "#8E8E93" }}>{ok.toLocaleString("es-CL")} / {total.toLocaleString("es-CL")}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <div style={{ flex: 1, height: 8, background: "#F2F2F7", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: (pct * 100).toFixed(0) + "%", height: "100%", background: color, transition: "width .3s" }} />
        </div>
        <span style={{ fontSize: 13, fontWeight: 800, color, minWidth: 42, textAlign: "right" }}>{(pct * 100).toFixed(0)}%</span>
      </div>
      <div style={{ fontSize: 11.5, color: "#636366", lineHeight: 1.5, marginBottom: 10 }}>{detalle}</div>
      <button onClick={accion} disabled={running} style={{
        width: "100%", padding: "9px 14px", borderRadius: 10, border: "1.5px solid " + accent,
        background: "#fff", color: accent, fontWeight: 700, fontSize: 12.5,
        cursor: running ? "default" : "pointer", opacity: running ? 0.5 : 1,
      }}>{accionLabel}</button>
    </div>
  )
}
