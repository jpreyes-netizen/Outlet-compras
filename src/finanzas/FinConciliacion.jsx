import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'
import * as XLSX from 'xlsx'

const hp = (u, p) => { if(!u) return false; if(u.rol==="admin") return true; return ["dir_finanzas","dir_general"].includes(u.rol) }

/* ═══ FIN CONCILIACIÓN ═══ */

const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

export function FinConciliacion({ cu, isMobile }) {
  const [subTab, setSubTab] = useState("movimientos")
  const [movimientos, setMovimientos] = useState([])
  const [subcuentas, setSubcuentas] = useState([])
  const [cecos, setCecos] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtros, setFiltros] = useState({
    estado: "", tipo: "", mes: "", buscar: "", soloSinClasificar: false
  })
  const [seleccionados, setSeleccionados] = useState([])
  const [sortCol, setSortCol] = useState("fecha")
  const [sortDir, setSortDir] = useState("desc")
  const [editando, setEditando] = useState(null)
  const [modalMes, setModalMes] = useState(false)
  const [mesNominal, setMesNominal] = useState("")
  const [toast, setToast] = useState(null)
  const [uploadLoading, setUploadLoading] = useState(false)

  const esAdmin = cu.rol === "admin" || hp(cu, "ver_finanzas_app")

  useEffect(() => { cargarDatos() }, [])

  async function cargarDatos() {
    setLoading(true)
    const [movs, subs, cc] = await Promise.all([
      supabase.from("movimientos_bancarios")
        .select("id,fecha,monto,tipo,descripcion,mes_cartola,mes_nominal,subcuenta_id,ceco_id,estado,observaciones,hash_dedup")
        .gte("fecha", "2026-01-01")
        .order("fecha", { ascending: false })
        .limit(2000),
      supabase.from("subcuentas").select("id,nombre,cuenta_madre_id"),
      supabase.from("centros_costo").select("id,nombre")
    ])
    setMovimientos(movs.data || [])
    setSubcuentas(subs.data || [])
    setCecos(cc.data || [])
    setLoading(false)
  }

  const showToast = (msg, tipo = "ok") => {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3000)
  }

  // Filtrado + sort
  const movFiltrados = movimientos.filter(m => {
    if (filtros.estado && m.estado !== filtros.estado) return false
    if (filtros.tipo && m.tipo !== filtros.tipo) return false
    if (filtros.mes && String(m.mes_cartola) !== filtros.mes) return false
    if (filtros.soloSinClasificar && m.subcuenta_id) return false
    if (filtros.buscar) {
      const q = filtros.buscar.toLowerCase()
      if (!m.descripcion?.toLowerCase().includes(q) && !String(Math.abs(m.monto)).includes(q)) return false
    }
    return true
  }).sort((a, b) => {
    let va = a[sortCol], vb = b[sortCol]
    if (sortCol === "monto") { va = Math.abs(Number(va)); vb = Math.abs(Number(vb)) }
    if (typeof va === "string") return sortDir === "asc" ? va.localeCompare(vb, "es") : vb.localeCompare(va, "es")
    return sortDir === "asc" ? va - vb : vb - va
  })

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortCol(col); setSortDir("asc") }
  }

  function sortIcon(col) {
    if (sortCol !== col) return " ↕"
    return sortDir === "asc" ? " ↑" : " ↓"
  }

  // Clasificar movimiento individual
  async function clasificar(id, subcuenta_id, ceco_id, mes_nominal) {
    const { error } = await supabase.from("movimientos_bancarios")
      .update({
        subcuenta_id: subcuenta_id || null,
        ceco_id: ceco_id || null,
        mes_nominal: mes_nominal || null,
        estado: "clasificado",
        clasificado_por: cu.id,
        clasificado_at: new Date().toISOString()
      })
      .eq("id", id)
    if (error) { showToast("Error al clasificar: " + error.message, "err"); return }
    setMovimientos(prev => prev.map(m =>
      m.id === id ? { ...m, subcuenta_id, ceco_id, mes_nominal, estado: "clasificado" } : m
    ))
    setEditando(null)
    showToast("Clasificado correctamente")
  }

  // Mes nominal masivo
  async function aplicarMesMasivo() {
    if (!mesNominal || seleccionados.length === 0) return
    const { error } = await supabase.from("movimientos_bancarios")
      .update({ mes_nominal: Number(mesNominal) })
      .in("id", seleccionados)
    if (error) { showToast("Error: " + error.message, "err"); return }
    setMovimientos(prev => prev.map(m =>
      seleccionados.includes(m.id) ? { ...m, mes_nominal: Number(mesNominal) } : m
    ))
    showToast(`Mes nominal actualizado en ${seleccionados.length} registros`)
    setModalMes(false)
    setMesNominal("")
  }

  // Eliminar movimiento
  async function eliminarMovimiento(id) {
    const mov = movimientos.find(m => m.id === id)
    if (!window.confirm(`¿Eliminar este movimiento?\n${mov?.descripcion}\n${fmt(Math.abs(mov?.monto || 0))}\n\nEsta acción no se puede deshacer.`)) return
    const { error } = await supabase.from("movimientos_bancarios").delete().eq("id", id)
    if (error) { showToast("Error al eliminar: " + error.message, "err"); return }
    setMovimientos(prev => prev.filter(m => m.id !== id))
    showToast("Movimiento eliminado")
  }

  // Limpiar duplicados
  async function limpiarDuplicados() {
    if (!window.confirm("¿Limpiar movimientos duplicados? Se conserva el registro más antiguo.")) return
    const { data, error } = await supabase.rpc("fn_limpiar_duplicados_movimientos")
    if (error) { showToast("Error: " + error.message, "err"); return }
    showToast(`${data || 0} duplicados eliminados`)
    cargarDatos()
  }

  // Resumen stats
  const stats = {
    total: movimientos.length,
    clasificados: movimientos.filter(m => m.estado === "clasificado").length,
    sinClasificar: movimientos.filter(m => !m.subcuenta_id).length,
    totalAbonos: movimientos.filter(m => m.tipo === "ABONO").reduce((s, m) => s + Math.abs(Number(m.monto)), 0),
    totalCargos: movimientos.filter(m => m.tipo === "CARGO").reduce((s, m) => s + Math.abs(Number(m.monto)), 0)
  }

  if (loading) return <LoadingState label="Cargando movimientos..." />

  return (
    <div>
      {/* TABS INTERNOS */}
      <div style={{ display: "flex", gap: 2, marginBottom: 16, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
        {[["movimientos", "Clasificar"], ["cartolas", "Cartolas"]].map(([k, l]) => (
          <button key={k} onClick={() => setSubTab(k)} style={{
            padding: "8px 16px", fontSize: 13, fontWeight: 600,
            background: "none", border: "none", cursor: "pointer",
            color: subTab === k ? "#34C759" : "#8E8E93",
            borderBottom: subTab === k ? "2px solid #34C759" : "2px solid transparent"
          }}>{l}</button>
        ))}
      </div>

      {subTab === "movimientos" && (
        <>
          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8, marginBottom: 16 }}>
            <KpiSm l="Total" v={fN(stats.total)} />
            <KpiSm l="Clasificados" v={fN(stats.clasificados)} c="#34C759" />
            <KpiSm l="Sin subcuenta" v={fN(stats.sinClasificar)} c={stats.sinClasificar > 0 ? "#FF3B30" : "#34C759"} />
            <KpiSm l="Abonos" v={fmtM(stats.totalAbonos)} c="#34C759" />
            <KpiSm l="Cargos" v={fmtM(stats.totalCargos)} c="#FF3B30" />
          </div>

          {/* Filtros */}
          <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 12, border: "1px solid rgba(0,0,0,0.04)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <input
                placeholder="Buscar descripción o monto..."
                value={filtros.buscar}
                onChange={e => setFiltros(f => ({ ...f, buscar: e.target.value }))}
                style={inputSt}
              />
              <select value={filtros.tipo} onChange={e => setFiltros(f => ({ ...f, tipo: e.target.value }))} style={{ ...selectSt, width: 110 }}>
                <option value="">Tipo</option>
                <option value="ABONO">ABONO</option>
                <option value="CARGO">CARGO</option>
              </select>
              <select value={filtros.mes} onChange={e => setFiltros(f => ({ ...f, mes: e.target.value }))} style={{ ...selectSt, width: 110 }}>
                <option value="">Mes</option>
                {[1, 2, 3, 4, 5].map(m => <option key={m} value={m}>{MESES[m]}</option>)}
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#8E8E93", cursor: "pointer" }}>
                <input type="checkbox" checked={filtros.soloSinClasificar}
                  onChange={e => setFiltros(f => ({ ...f, soloSinClasificar: e.target.checked }))} />
                Solo sin clasificar
              </label>
              {esAdmin && (
                <button onClick={limpiarDuplicados} style={{ ...btnSm, background: "#FF3B3015", color: "#FF3B30" }}>
                  🧹 Limpiar duplicados
                </button>
              )}
            </div>
          </div>

          {/* Barra selección masiva */}
          {seleccionados.length >= 2 && (
            <div style={{
              background: "#1C1C1E", color: "#fff", borderRadius: 12, padding: "10px 14px",
              marginBottom: 12, display: "flex", alignItems: "center", gap: 12, fontSize: 13
            }}>
              <span>{seleccionados.length} seleccionados</span>
              <button onClick={() => setModalMes(true)} style={{ ...btnSm, background: "#007AFF", color: "#fff" }}>
                Cambiar mes nominal
              </button>
              <button onClick={() => setSeleccionados([])} style={{ ...btnSm, background: "#ffffff20", color: "#fff" }}>✕</button>
            </div>
          )}

          {/* Tabla */}
          <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid rgba(0,0,0,0.04)", background: "#fff" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#F2F2F7" }}>
                  <th style={thSt}><input type="checkbox"
                    checked={seleccionados.length === movFiltrados.length && movFiltrados.length > 0}
                    onChange={e => setSeleccionados(e.target.checked ? movFiltrados.map(m => m.id) : [])} />
                  </th>
                  <th style={{ ...thSt, cursor: "pointer" }} onClick={() => toggleSort("fecha")}>Fecha{sortIcon("fecha")}</th>
                  <th style={{ ...thSt, cursor: "pointer" }} onClick={() => toggleSort("tipo")}>Tipo{sortIcon("tipo")}</th>
                  <th style={{ ...thSt, cursor: "pointer", textAlign: "right" }} onClick={() => toggleSort("monto")}>Monto{sortIcon("monto")}</th>
                  <th style={{ ...thSt, cursor: "pointer", minWidth: 200 }} onClick={() => toggleSort("descripcion")}>Descripción{sortIcon("descripcion")}</th>
                  <th style={{ ...thSt, cursor: "pointer" }} onClick={() => toggleSort("mes_cartola")}>Mes cart.{sortIcon("mes_cartola")}</th>
                  <th style={{ ...thSt, cursor: "pointer" }} onClick={() => toggleSort("mes_nominal")}>Mes nom.{sortIcon("mes_nominal")}</th>
                  <th style={{ ...thSt, cursor: "pointer" }} onClick={() => toggleSort("subcuenta_id")}>Clasificación{sortIcon("subcuenta_id")}</th>
                  <th style={thSt}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {movFiltrados.slice(0, 300).map(m => {
                  const sub = subcuentas.find(s => s.id === m.subcuenta_id)
                  const esCargo = m.tipo === "CARGO"
                  const esEditando = editando === m.id
                  return (
                    <tr key={m.id} style={{ borderBottom: "1px solid #F2F2F7" }}>
                      <td style={tdSt}>
                        <input type="checkbox"
                          checked={seleccionados.includes(m.id)}
                          onChange={e => setSeleccionados(prev =>
                            e.target.checked ? [...prev, m.id] : prev.filter(x => x !== m.id)
                          )} />
                      </td>
                      <td style={tdSt}>{m.fecha}</td>
                      <td style={tdSt}>
                        <span style={{
                          padding: "2px 8px", borderRadius: 100, fontSize: 10, fontWeight: 600,
                          background: esCargo ? "#FF3B3015" : "#34C75915",
                          color: esCargo ? "#FF3B30" : "#34C759"
                        }}>{m.tipo}</span>
                      </td>
                      <td style={{ ...tdSt, textAlign: "right", fontWeight: 600, color: esCargo ? "#FF3B30" : "#34C759" }}>
                        {fmt(Math.abs(Number(m.monto)))}
                      </td>
                      <td style={{ ...tdSt, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }} title={m.descripcion}>
                        {m.descripcion}
                      </td>
                      <td style={{ ...tdSt, color: "#8E8E93" }}>{MESES[m.mes_cartola] || m.mes_cartola}</td>
                      <td style={tdSt}>
                        {esEditando ? (
                          <EditMesNominal
                            value={m.mes_nominal}
                            onSave={v => clasificar(m.id, m.subcuenta_id, m.ceco_id, v)}
                            onCancel={() => setEditando(null)}
                          />
                        ) : (
                          <span onClick={() => setEditando(m.id)} style={{ cursor: "pointer", color: "#8E8E93" }}>
                            {MESES[m.mes_nominal] || "—"}
                          </span>
                        )}
                      </td>
                      <td style={tdSt}>
                        {esEditando ? (
                          <EditClasificacion
                            subcuentas={subcuentas}
                            cecos={cecos}
                            subcuenta_id={m.subcuenta_id}
                            ceco_id={m.ceco_id}
                            mes_nominal={m.mes_nominal}
                            onSave={(sub_id, ceco_id, mes) => clasificar(m.id, sub_id, ceco_id, mes)}
                            onCancel={() => setEditando(null)}
                          />
                        ) : (
                          <span style={{ fontSize: 11, color: sub ? "#1C1C1E" : "#AEAEB2" }}>
                            {sub ? sub.nombre : "Sin clasificar"}
                          </span>
                        )}
                      </td>
                      <td style={tdSt}>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button onClick={() => setEditando(esEditando ? null : m.id)} style={{ ...btnIcon, color: "#007AFF" }}>✏️</button>
                          {esAdmin && m.estado !== "clasificado" && (
                            <button onClick={() => eliminarMovimiento(m.id)} style={{ ...btnIcon, color: "#FF3B30" }}>🗑</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {movFiltrados.length > 300 && (
              <div style={{ padding: "10px 14px", fontSize: 11, color: "#8E8E93", textAlign: "center" }}>
                Mostrando 300 de {movFiltrados.length} registros. Usa los filtros para acotar.
              </div>
            )}
          </div>
        </>
      )}

      {subTab === "cartolas" && (
        <CartolasView onReload={cargarDatos} showToast={showToast} uploadLoading={uploadLoading} setUploadLoading={setUploadLoading} />
      )}

      {/* Modal mes nominal masivo */}
      {modalMes && (
        <Modal title="Cambiar mes nominal" onClose={() => setModalMes(false)}>
          <div style={{ marginBottom: 16, fontSize: 13, color: "#8E8E93" }}>
            Aplicar a {seleccionados.length} registros seleccionados
          </div>
          <select value={mesNominal} onChange={e => setMesNominal(e.target.value)} style={{ ...selectSt, marginBottom: 16 }}>
            <option value="">— Sin cambio —</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
              <option key={m} value={m}>{m} — {MESES[m]}</option>
            ))}
          </select>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setModalMes(false)} style={btnSm}>Cancelar</button>
            <button onClick={aplicarMesMasivo} disabled={!mesNominal}
              style={{ ...btnSm, background: "#007AFF", color: "#fff" }}>
              Aplicar mes
            </button>
          </div>
        </Modal>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 100, right: 20, zIndex: 200,
          background: toast.tipo === "err" ? "#FF3B30" : "#34C759",
          color: "#fff", borderRadius: 10, padding: "10px 16px",
          fontSize: 13, fontWeight: 600, boxShadow: "0 4px 16px rgba(0,0,0,0.15)"
        }}>{toast.msg}</div>
      )}
    </div>
  )
}

/* Sub-componente: editar clasificación inline */
function EditClasificacion({ subcuentas, cecos, subcuenta_id, ceco_id, mes_nominal, onSave, onCancel }) {
  const [sub, setSub] = useState(subcuenta_id || "")
  const [ceco, setCeco] = useState(ceco_id || "")
  const [mes, setMes] = useState(mes_nominal || "")

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <select value={sub} onChange={e => setSub(e.target.value)} style={{ ...selectSt, fontSize: 11 }}>
        <option value="">Sin subcuenta</option>
        {subcuentas.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
      </select>
      <select value={ceco} onChange={e => setCeco(e.target.value)} style={{ ...selectSt, fontSize: 11 }}>
        <option value="">Sin CeCo</option>
        {cecos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </select>
      <div style={{ display: "flex", gap: 4 }}>
        <button onClick={() => onSave(sub || null, ceco || null, mes || null)}
          style={{ ...btnSm, background: "#34C759", color: "#fff", flex: 1 }}>✓</button>
        <button onClick={onCancel} style={{ ...btnSm, flex: 1 }}>✕</button>
      </div>
    </div>
  )
}

function EditMesNominal({ value, onSave, onCancel }) {
  const [mes, setMes] = useState(value || "")
  return (
    <div style={{ display: "flex", gap: 4 }}>
      <select value={mes} onChange={e => setMes(e.target.value)} style={{ ...selectSt, fontSize: 11, width: 80 }}>
        <option value="">—</option>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m =>
          <option key={m} value={m}>{MESES[m].slice(0, 3)}</option>
        )}
      </select>
      <button onClick={() => onSave(mes || null)} style={{ ...btnSm, background: "#34C759", color: "#fff" }}>✓</button>
    </div>
  )
}

/* Sub-componente: subida de cartolas */
function CartolasView({ onReload, showToast, uploadLoading, setUploadLoading }) {
  const [cartolas, setCartolas] = useState([])

  useEffect(() => {
    supabase.from("cartolas").select("*").order("periodo_desde", { ascending: false })
      .then(({ data }) => setCartolas(data || []))
  }, [])

  async function handleUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploadLoading(true)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: "array" })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false })
      // El parsing real del Santander requiere conocer su layout exacto
      // Por ahora mostramos conteo de filas detectadas
      showToast(`Archivo leído: ${rows.length} filas detectadas. Implementar parser según layout Santander.`)
    } catch (err) {
      showToast("Error al leer el archivo: " + err.message, "err")
    } finally {
      setUploadLoading(false)
      e.target.value = ""
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <label style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "10px 16px", background: "#34C75915",
          color: "#34C759", borderRadius: 10, cursor: "pointer",
          fontSize: 13, fontWeight: 600, border: "1px solid #34C75930"
        }}>
          {uploadLoading ? "Procesando..." : "📤 Cargar cartola Excel"}
          <input type="file" accept=".xlsx,.xls" onChange={handleUpload} style={{ display: "none" }} />
        </label>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(0,0,0,0.04)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#F2F2F7" }}>
              <th style={thSt}>Banco</th>
              <th style={thSt}>Período desde</th>
              <th style={thSt}>Período hasta</th>
              <th style={thSt}>Cargada</th>
            </tr>
          </thead>
          <tbody>
            {cartolas.map(c => (
              <tr key={c.id} style={{ borderBottom: "1px solid #F2F2F7" }}>
                <td style={tdSt}>{c.banco}</td>
                <td style={tdSt}>{c.periodo_desde}</td>
                <td style={tdSt}>{c.periodo_hasta}</td>
                <td style={{ ...tdSt, color: "#8E8E93" }}>{new Date(c.created_at).toLocaleDateString("es-CL")}</td>
              </tr>
            ))}
            {cartolas.length === 0 && (
              <tr><td colSpan={4} style={{ ...tdSt, textAlign: "center", color: "#AEAEB2", padding: 24 }}>Sin cartolas cargadas</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* Helpers de UI */
function KpiSm({ l, v, c }) {
  return (
    <div style={{ background: "#fff", borderRadius: 10, padding: "10px 12px", border: "1px solid rgba(0,0,0,0.04)" }}>
      <div style={{ fontSize: 10, color: "#8E8E93", fontWeight: 500, marginBottom: 2 }}>{l}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: c || "#1C1C1E" }}>{v}</div>
    </div>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
      backdropFilter: "blur(8px)", display: "flex",
      alignItems: "flex-end", justifyContent: "center", zIndex: 100
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: "20px 20px 0 0",
        padding: "20px 20px 32px", width: "100%", maxWidth: 500
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} style={{ background: "#F2F2F7", border: "none", borderRadius: 15, width: 30, height: 30, cursor: "pointer" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function LoadingState({ label }) {
  return (
    <div style={{ minHeight: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🔄</div>
        <div style={{ fontSize: 13, color: "#8E8E93" }}>{label}</div>
      </div>
    </div>
  )
}

const fmt = n => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n || 0)
const fN = n => new Intl.NumberFormat("es-CL").format(Math.round(n || 0))
const fmtM = v => {
  if (!v) return "—"
  const m = Math.abs(v) / 1e6
  return (v < 0 ? "-" : "") + "$" + (m >= 1 ? m.toFixed(1) + "M" : fN(v))
}

const inputSt = {
  flex: "1 1 200px", padding: "8px 12px", borderRadius: 8,
  border: "1px solid #E5E5EA", fontSize: 12, background: "#F2F2F7", outline: "none"
}
const selectSt = {
  width: "100%", padding: "8px 12px", borderRadius: 8,
  border: "1px solid #E5E5EA", fontSize: 12, background: "#fff"
}
const btnSm = {
  padding: "6px 12px", borderRadius: 8, border: "1px solid #E5E5EA",
  background: "#F2F2F7", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#1C1C1E"
}
const btnIcon = {
  width: 26, height: 26, borderRadius: 6, border: "none",
  background: "transparent", cursor: "pointer", fontSize: 12
}
const thSt = {
  padding: "8px 12px", textAlign: "left", fontSize: 11,
  fontWeight: 600, color: "#8E8E93", letterSpacing: "0.02em"
}
const tdSt = { padding: "8px 12px", color: "#1C1C1E", verticalAlign: "middle" }
