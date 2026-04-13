/* ═══ iOS UI COMPONENTS — Outlet de Puertas ═══ */

/* ═══ STYLE TOKENS ═══ */
export const css = {
  card: {
    background: "#fff", borderRadius: 16, padding: "16px 18px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)", marginBottom: 10,
    border: "1px solid rgba(0,0,0,0.04)"
  },
  cardSm: {
    background: "#fff", borderRadius: 12, padding: "12px 14px",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.04)"
  },
  input: {
    width: "100%", padding: "10px 14px", borderRadius: 12,
    border: "1px solid #e5e5ea", fontSize: 14, background: "#fff",
    outline: "none", transition: "border-color 0.2s"
  },
  select: {
    width: "100%", padding: "10px 14px", borderRadius: 12,
    border: "1px solid #e5e5ea", fontSize: 14, background: "#fff"
  },
  btn: {
    padding: "12px 20px", borderRadius: 12, fontSize: 14, fontWeight: 600,
    border: "none", cursor: "pointer", transition: "all 0.2s",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6
  },
  modal: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.4)", backdropFilter: "blur(8px)",
    display: "flex", alignItems: "flex-end", justifyContent: "center",
    zIndex: 999, padding: 0
  }
}

/* ═══ Badge ═══ */
export const Bd = ({ children, c, bg, lg }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: 3,
    padding: lg ? "5px 14px" : "3px 10px", borderRadius: 20,
    fontSize: lg ? 13 : 11, fontWeight: 600,
    color: c || "#8E8E93", background: bg || "#F2F2F7",
    whiteSpace: "nowrap", letterSpacing: "-0.01em"
  }}>{children}</span>
)

/* ═══ Metric Card ═══ */
export const Mt = ({ l, v, sub, ac, ic }) => (
  <div style={{ ...css.cardSm, textAlign: "center", flex: "1 1 100px" }}>
    {ic && <div style={{ fontSize: 20, marginBottom: 2 }}>{ic}</div>}
    <div style={{ fontSize: 11, color: "#8E8E93", marginBottom: 2, fontWeight: 500 }}>{l}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: ac || "#1C1C1E", letterSpacing: "-0.02em" }}>{v}</div>
    {sub && <div style={{ fontSize: 10, color: "#AEAEB2", marginTop: 1 }}>{sub}</div>}
  </div>
)

/* ═══ Card ═══ */
export const Cd = ({ children, ac, s, onClick }) => (
  <div onClick={onClick} style={{
    ...css.card,
    borderLeft: ac ? "3px solid " + ac : undefined,
    cursor: onClick ? "pointer" : undefined,
    ...(s || {})
  }}>{children}</div>
)

/* ═══ Form Label ═══ */
export const Fl = ({ l, children, req }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#3A3A3C", marginBottom: 5 }}>
      {l}{req && <span style={{ color: "#FF3B30" }}> *</span>}
    </label>
    {children}
  </div>
)

/* ═══ Button ═══ */
const BTN_MAP = {
  pri: { bg: "#007AFF", c: "#fff" },
  suc: { bg: "#34C759", c: "#fff" },
  dan: { bg: "#FF3B30", c: "#fff" },
  pur: { bg: "#AF52DE", c: "#fff" },
  amb: { bg: "#FF9500", c: "#fff" },
  gry: { bg: "#F2F2F7", c: "#3A3A3C" }
}

export const Bt = ({ children, v, dis, onClick, full, sm, ic }) => {
  const st = BTN_MAP[v] || { bg: "#F2F2F7", c: "#3A3A3C" }
  return (
    <button onClick={onClick} disabled={dis} style={{
      ...css.btn,
      padding: sm ? "8px 14px" : "12px 20px",
      fontSize: sm ? 12 : 14,
      background: dis ? "#F2F2F7" : st.bg,
      color: dis ? "#AEAEB2" : st.c,
      width: full ? "100%" : "auto",
      opacity: dis ? 0.5 : 1
    }}>{ic && <span>{ic}</span>}{children}</button>
  )
}

/* ═══ Avatar ═══ */
export const Av = ({ n, c, sz }) => {
  const s = sz || 36
  return (
    <div style={{
      width: s, height: s, borderRadius: s / 2,
      background: c ? (c + "20") : "#F2F2F7",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: s * 0.36, fontWeight: 700, color: c || "#8E8E93",
      flexShrink: 0, letterSpacing: "-0.02em"
    }}>{n}</div>
  )
}

/* ═══ Step Indicator ═══ */
export const Stp = ({ steps, cur }) => (
  <div style={{
    display: "flex", alignItems: "flex-start", margin: "0 0 14px",
    overflowX: "auto", paddingBottom: 4, gap: 0
  }}>
    {steps.map((s, i) => {
      const d = i < cur, a = i === cur
      return (
        <div key={i} style={{ display: "flex", alignItems: "center", flex: "0 0 auto" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: steps.length > 10 ? 44 : 54 }}>
            <div style={{
              width: 22, height: 22, borderRadius: 11,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 9, fontWeight: 700,
              background: d ? "#34C759" : a ? "#007AFF" : "#F2F2F7",
              color: (d || a) ? "#fff" : "#C7C7CC",
              transition: "all 0.3s"
            }}>{d ? "✓" : i + 1}</div>
            <div style={{
              fontSize: 7, marginTop: 2,
              color: a ? "#007AFF" : d ? "#34C759" : "#C7C7CC",
              fontWeight: a ? 700 : 500, textAlign: "center",
              maxWidth: 48, lineHeight: 1.2
            }}>{s.n}</div>
          </div>
          {i < steps.length - 1 && (
            <div style={{
              width: 12, height: 2, borderRadius: 1,
              background: d ? "#34C759" : "#E5E5EA",
              margin: "0 0 16px", flexShrink: 0
            }} />
          )}
        </div>
      )
    })}
  </div>
)

/* ═══ Bottom Sheet Modal ═══ */
export const Sheet = ({ show, onClose, title, children }) => {
  if (!show) return null
  return (
    <div style={css.modal} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: "20px 20px 0 0",
        padding: "8px 20px 32px", width: "100%", maxWidth: 680,
        maxHeight: "92vh", overflow: "auto",
        animation: "slideUp 0.3s ease"
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "#E5E5EA", margin: "0 auto 12px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>{title}</div>
          <button onClick={onClose} style={{
            width: 30, height: 30, borderRadius: 15, background: "#F2F2F7",
            border: "none", fontSize: 14, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", color: "#8E8E93"
          }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
