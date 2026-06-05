import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { fmt, fN, card, SectionTitle } from './ui'

const ACCENT = "#5856D6"

const MESES = ["","Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"]
const fmtPeriodo = p => { if (!p) return "—"; const [y,m]=p.split("-"); return `${MESES[+m]} ${y}` }
const fmtSeg = s => s == null ? "—" : s < 60 ? `${Math.round(s)}s` : `${Math.floor(s/60)}m ${Math.round(s%60)}s`
const fmtFecha = ts => ts ? new Date(ts).toLocaleString("es-CL",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : "—"

export function InvSync({ accent = ACCENT, isMobile }) {
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

  const ejecutarSync = async () => {
    setRunning(true); setResult(null); setProgLog([])
    addProg("Iniciando sincronización con BSALE...")
    try {
      const payload = { tipo, desde, hasta }
      addProg(`Tipo: ${tipo} · Período: ${fmtPeriodo(desde)} → ${fmtPeriodo(hasta)}`)

      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bsale-inv-sync`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session?.access_token}`,
            "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify(payload),
        }
      )
      const data = await r.json()
      if (data.ok) {
        addProg(`✅ Sync completada en ${fmtSeg(data.duracion_seg)}`)
        addProg(`📄 ${fN(data.docs)} documentos · ${fN(data.skus_ventas)} SKU ventas · ${fN(data.snaps)} snaps stock`)
        setResult({ ok: true, ...data })
      } else {
        addProg(`❌ Error: ${data.error}`)
        setResult({ ok: false, error: data.error })
      }
    } catch (e) {
      addProg(`❌ Error de red: ${e.message}`)
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
