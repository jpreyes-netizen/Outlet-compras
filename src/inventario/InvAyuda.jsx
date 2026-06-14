import { useState, useMemo } from 'react'
import { card, SectionTitle } from './ui'

const ACCENT = "#5856D6"

/* ════════════════════════════════════════════════════════════════
   GLOSARIO — qué significa cada término / métrica
   Cada entrada: { t: término, c: categoría, d: definición, e: ejemplo,
                   v: dónde se ve (tab destino opcional) }
═══════════════════════════════════════════════════════════════════ */
const GLOSARIO = [
  { t: "ABCD (clasificación Pareto)", c: "Análisis",
    d: "Clasifica los productos según su contribución al monto de venta del período. NO es por cantidad vendida — es por dinero generado. Sigue la regla 80/20.",
    e: "Clase A = el 80% de la venta acumulada (típicamente ~20% de los SKU). B = 80-95%. C = 95-99%. D = el resto + los que no vendieron nada.",
    v: "vision" },
  { t: "GMROI (Gross Margin Return on Investment)", c: "Métrica financiera",
    d: "Cuántos pesos de margen bruto genera cada peso invertido en inventario. Es la métrica reina del retail. Objetivo para bienes durables: ≥ 2.0.",
    e: "GMROI 2.5 significa que cada $1 en stock genera $2.50 de margen al año. Si está bajo, hay capital sub-utilizado.",
    v: "vision" },
  { t: "DSI (Days Sales of Inventory)", c: "Métrica de rotación",
    d: "Días que tardas en vender todo el stock actual al ritmo de venta del período. Mientras más bajo, más rápido rota.",
    e: "DSI 30d = el stock se renueva cada mes. DSI 180d = tienes 6 meses parado.",
    v: "datos" },
  { t: "Sell-through rate", c: "Métrica de venta",
    d: "% del total disponible (vendido + stock restante) que efectivamente se vendió. Mide qué tan bien estás convirtiendo inventario en venta.",
    e: "Sell-through 70% = de 100 unidades disponibles, vendiste 70 y te quedan 30.",
    v: "datos" },
  { t: "Health score", c: "Métrica integral",
    d: "Índice 0-100 que combina rotación (40%), margen (25%), disponibilidad (20%) y GMROI (15%). Da una salud única por SKU.",
    e: "Health 85 = SKU saludable. Health <50 = problemas en una o más dimensiones.",
    v: "datos" },
  { t: "Rotación anual", c: "Métrica de rotación",
    d: "Cuántas veces se renueva el stock en un año. Calculado como venta del período × (365/días del período) / stock actual.",
    e: "Rotación 4x = el inventario se vende y reabastece 4 veces al año. Objetivo durables: 2-4x.",
    v: "vision" },
  { t: "Velocidad de movimiento", c: "Clasificación",
    d: "Categoriza cada SKU según su DSI: Fast mover (<30d), Medium (30-90d), Slow (90-180d), Very slow (>180d), Sin movimiento (no vendió).",
    e: "Un Fast mover de clase A es tu producto estrella. Un Very slow de clase D es candidato a liquidación.",
    v: "datos" },
  { t: "Quiebre de stock", c: "Estado operativo",
    d: "Un SKU está en quiebre cuando vende pero su stock actual es 0. Es venta que se está perdiendo activamente.",
    e: "Si un quiebre es de clase A, cada día sin reponer pierdes margen significativo.",
    v: "mitienda" },
  { t: "Punto de reorden", c: "Parámetro operativo",
    d: "Nivel mínimo de stock al que se debe pedir reposición, calculado por venta diaria × lead time + colchón de emergencia (días por clase ABCD).",
    e: "Si vendes 5/día y tu lead time es 14 días, tu punto de reorden mínimo es 70 unidades.",
    v: "mitienda" },
  { t: "Cobertura (días)", c: "Métrica de stock",
    d: "Días de venta que cubre el stock actual al ritmo del período. Stock unidades ÷ venta diaria.",
    e: "Cobertura 60d = al ritmo de venta actual, tienes para vender 60 días.",
    v: "datos" },
  { t: "Dead stock", c: "Estado operativo",
    d: "Stock que existe en bodega pero no registró ventas en el período. Capital congelado.",
    e: "Tienes 50 unidades de un producto y no vendiste ninguna en 6 meses. Es dead stock.",
    v: "vision" },
  { t: "Sobre-stock", c: "Estado operativo",
    d: "SKU que sí vende, pero con cobertura excesiva (>180 días). Hay stock para mucho más tiempo del razonable.",
    e: "Tienes 500 unidades de algo que vende 1/día. Te alcanza para 500 días. Es sobre-stock.",
    v: "mitienda" },
  { t: "Fill rate (CD)", c: "Métrica de centro de distribución",
    d: "De lo que las tiendas necesitan hoy, qué porcentaje puede surtir el CD desde su stock actual.",
    e: "Fill rate 70% = de 100 unidades pedidas por las tiendas, Maipú puede despachar 70 y 30 hay que comprarlas.",
    v: "cd" },
  { t: "Cobertura de red (CD)", c: "Métrica de centro de distribución",
    d: "Días que el stock activo del CD sostiene la demanda conjunta de todas las sucursales.",
    e: "Cobertura de red 45d = Maipú tiene stock para abastecer a La Granja y Los Ángeles por 45 días.",
    v: "cd" },
  { t: "Inmovilizado (CD)", c: "Métrica de centro de distribución",
    d: "Stock en el CD de productos que ninguna sucursal vende — capital muerto a nivel red.",
    e: "Si Maipú tiene $5M en productos que ni La Granja ni Los Ángeles venden, esos $5M están \"acumulando polvo\".",
    v: "cd" },
  { t: "Lead time", c: "Parámetro operativo",
    d: "Días que tarda en llegar la mercadería desde que se pide. Es la variable que define cuánto colchón necesitas.",
    e: "Si tu proveedor demora 21 días, tu punto de reorden debe cubrir esos 21 días + un colchón.",
    v: "mitienda" },
  { t: "Margen bruto %", c: "Métrica financiera",
    d: "(Venta − Costo de lo vendido) ÷ Venta. Mide qué porcentaje de cada peso vendido queda como ganancia bruta.",
    e: "Vendes a $1000, te cuesta $600. Margen 40%. Esto NO incluye gastos operativos.",
    v: "datos" },
  { t: "Pedir a Maipú vs Solicitar compra", c: "Plan de acción",
    d: "Pedir a Maipú: el CD tiene el stock, transfiere. Solicitar compra: Maipú no puede surtir, hay que comprar al proveedor.",
    e: "Si necesitas 50 unidades y Maipú tiene 30, pides 30 a Maipú y solicitas comprar las 20 restantes.",
    v: "mitienda" },
  { t: "Estacionalidad (índice mensual)", c: "Análisis temporal",
    d: "Compara la venta de un mes con el promedio mensual. 1.0 = mes normal. >1.0 = sobre-venta. <1.0 = bajo-venta.",
    e: "Si tu categoría 'Puertas' tiene índice 1.5 en abril, ese mes vendes 50% más que el promedio. Reforzar stock antes.",
    v: "vision" },
  { t: "Snapshot de stock", c: "Datos",
    d: "Foto del stock en un momento puntual. La app guarda uno por día automáticamente via cron (a las 01:30 Santiago).",
    e: "El snapshot del 14-jun-2026 capturó cuántas unidades había de cada SKU en cada sucursal a esa fecha.",
    v: "vision" },
]

/* ════════════════════════════════════════════════════════════════
   CÓMO LO HAGO — flujos operativos paso a paso
═══════════════════════════════════════════════════════════════════ */
const FLUJOS = [
  { titulo: "¿Cómo veo qué reponer hoy en mi tienda?", t: "rutina", destino: "mitienda",
    pasos: [
      "Selecciona tu sucursal arriba (o ya viene autodetectada según tu rol).",
      "Entra al tab 🏬 Mi Tienda.",
      "En la vista 📋 Plan de hoy verás 3 listas: Pedir a Maipú, Solicitar compra, Liquidar.",
      "Comienza por Pedir a Maipú — es lo más rápido de resolver (transferencias internas).",
      "Sigue con Solicitar compra — son los productos donde Maipú no puede surtir.",
      "Descarga el plan con el botón ⬇ Descargar plan si necesitas pasárselo a bodega o compras.",
    ]
  },
  { titulo: "¿Cómo planifico el stock ideal para crecer 20%?", t: "estratégica", destino: "mitienda",
    pasos: [
      "Entra a Mi Tienda → vista 🎛️ Simulador.",
      "Mueve el slider 📈 Meta de crecimiento a +20%.",
      "Ajusta el 🚛 Lead time si tu proveedor demora algo distinto al estándar.",
      "Define la 📅 Cobertura que quieres tener (días de venta en góndola).",
      "El simulador muestra la inversión necesaria y los SKU con mayor gap.",
      "Cada jefe de tienda guarda su propia configuración del simulador.",
    ]
  },
  { titulo: "¿Cómo identifico productos para liquidar?", t: "estratégica", destino: "mitienda",
    pasos: [
      "En Mi Tienda → vista 📋 Plan de hoy → sección 🏷️ Liquidar.",
      "Verás dead stock (sin ventas) y sobre-stock (>180 días de cobertura).",
      "Están ordenados por capital congelado (lo que más libera primero).",
      "Para una vista por categoría: vista 📊 Mi inventario → tabla por tipo de producto.",
      "Los marcados 'Exceso / liquidar' son los candidatos prioritarios.",
    ]
  },
  { titulo: "¿Cómo veo las tendencias del inventario?", t: "rutina", destino: "vision",
    pasos: [
      "Entra al tab 📊 Visión General.",
      "Selecciona la sub-vista 📈 Tendencias.",
      "Verás 4 gráficos: valor de inventario, quiebres, capital muerto y unidades.",
      "Cambia entre Día / Semana / Mes según el horizonte que quieras analizar.",
      "En vista Mes, activa 'Comparar con año anterior' para ver year-over-year.",
      "La lectura automática abajo te interpreta si las métricas mejoran o empeoran.",
    ]
  },
  { titulo: "¿Cómo descargo la data completa de un SKU para Excel?", t: "rutina", destino: "datos",
    pasos: [
      "Entra al tab 🗂️ Datos.",
      "Aplica los filtros que necesites: clase ABCD, estado, tipo, búsqueda por nombre.",
      "El selector de sucursal global de arriba también aplica.",
      "Presiona ⬇ Descargar sábana — exporta CSV con las 21 métricas por SKU.",
      "El archivo respeta los filtros activos.",
    ]
  },
  { titulo: "¿Cómo sé qué transferir desde Maipú a las tiendas?", t: "operativa", destino: "cd",
    pasos: [
      "Entra al tab 📦 CD Maipú.",
      "Arriba ves el fill rate (cuánto de la necesidad de las tiendas puedes surtir).",
      "En la sección 🚚 Despachos sugeridos están todas las transferencias propuestas.",
      "Filtra por destino con el selector de sucursal global (La Granja o Los Ángeles).",
      "Descarga el CSV para pasárselo al equipo de despacho.",
    ]
  },
  { titulo: "¿Cómo identifico productos que están acumulando polvo en Maipú?", t: "estratégica", destino: "cd",
    pasos: [
      "Entra al tab 📦 CD Maipú.",
      "Mira la sección 🧊 Acumulando polvo.",
      "Son SKU con stock en el CD pero sin ventas en ninguna sucursal.",
      "Están ordenados por capital parado (mayor a menor).",
      "Descarga la lista para evaluar liquidación central, devolución al proveedor o canal web.",
    ]
  },
  { titulo: "¿Cómo se actualizan los datos? ¿Necesito hacer algo manual?", t: "técnica", destino: "sync",
    pasos: [
      "El stock se actualiza automáticamente todas las noches a las 01:30 (Santiago).",
      "Las ventas se sincronizan entre 02:00 y 02:30 (boletas, facturas, NC).",
      "No necesitas hacer nada — al entrar en la mañana ya está todo cargado.",
      "Si quieres forzar una actualización: tab 🔄 Sync BSALE → ▶ Ejecutar sync.",
      "Si ves productos con código en vez de nombre, presiona 🏷️ Sincronizar nombres una vez.",
    ]
  },
  { titulo: "¿Qué hago si un jefe de tienda solo debe ver SU sucursal?", t: "configuración", destino: null,
    pasos: [
      "Si el usuario tiene scope de sucursal asignado en el sistema, la app autodetecta.",
      "Al entrar, Mi Tienda se enfoca automáticamente en su local.",
      "El selector de sucursal global queda en su sucursal por defecto.",
      "Si cambia manualmente, aparece un botón 'Volver a mi sucursal'.",
      "El admin no tiene autodetect — empieza en 'Todas las sucursales'.",
    ]
  },
  { titulo: "¿Cómo interpretar el Pareto ABCD en el filtro superior?", t: "rutina", destino: null,
    pasos: [
      "Bajo los filtros de sucursal y tipo verás 4 pastillas: Clase A, B, C, D.",
      "Cada una muestra cuántos SKU contiene esa clase en el subconjunto actual.",
      "La barra horizontal de colores muestra qué % de venta concentra cada clase.",
      "Clase A grande (verde) = pocos productos concentran mucha venta — alta concentración.",
      "Click en una clase para filtrar; click de nuevo para quitar el filtro.",
    ]
  },
]

const CATEGORIAS = ["Todos", "Análisis", "Métrica financiera", "Métrica de rotación", "Métrica de venta", "Métrica integral", "Estado operativo", "Parámetro operativo", "Clasificación", "Métrica de stock", "Métrica de centro de distribución", "Plan de acción", "Análisis temporal", "Datos"]

const inputStyle = { padding: "9px 13px", borderRadius: 10, border: "1px solid #e5e5ea", fontSize: 13, background: "#fff", outline: "none" }

export function InvAyuda({ accent = ACCENT, isMobile, irA }) {
  const [seccion, setSeccion] = useState("glosario")
  const [q, setQ] = useState("")
  const [cat, setCat] = useState("Todos")

  const glosarioFiltrado = useMemo(() => {
    let r = GLOSARIO
    if (cat !== "Todos") r = r.filter(g => g.c === cat)
    if (q) { const Q = q.toLowerCase(); r = r.filter(g => g.t.toLowerCase().includes(Q) || g.d.toLowerCase().includes(Q) || g.e.toLowerCase().includes(Q)) }
    return r
  }, [q, cat])

  const flujosFiltrados = useMemo(() => {
    if (!q) return FLUJOS
    const Q = q.toLowerCase()
    return FLUJOS.filter(f => f.titulo.toLowerCase().includes(Q) || f.pasos.some(p => p.toLowerCase().includes(Q)))
  }, [q])

  return (
    <div>
      {/* Header */}
      <div style={{ ...card, background: "linear-gradient(135deg,#1a1a2e,#16213e)", color: "#fff" }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 3 }}>❓ Centro de ayuda</div>
        <div style={{ fontSize: 13, color: "#c7c7d9", lineHeight: 1.5, maxWidth: 620 }}>
          Glosario de términos del análisis y guías paso a paso para los flujos comunes. Los términos del glosario son clickeables — te llevan al tab donde se aplican.
        </div>
      </div>

      {/* Sub-nav */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {[["glosario", "📖 Glosario", GLOSARIO.length],
          ["flujos", "🧭 Cómo lo hago", FLUJOS.length]].map(([k, l, n]) => (
          <button key={k} onClick={() => setSeccion(k)} style={{
            flex: 1, padding: "11px 14px", borderRadius: 12, border: "none", cursor: "pointer",
            fontSize: 13, fontWeight: 700, transition: "all .2s",
            background: seccion === k ? accent : "#fff",
            color: seccion === k ? "#fff" : "#3A3A3C",
            boxShadow: seccion === k ? "0 3px 10px " + accent + "55" : "0 1px 2px rgba(0,0,0,0.04)",
          }}>
            {l}<span style={{ marginLeft: 6, fontSize: 11, background: seccion === k ? "rgba(255,255,255,0.25)" : accent + "15", color: seccion === k ? "#fff" : accent, borderRadius: 10, padding: "1px 7px" }}>{n}</span>
          </button>
        ))}
      </div>

      {/* Búsqueda + filtro categoría */}
      <div style={{ ...card, display: "flex", flexWrap: "wrap", gap: 8 }}>
        <input placeholder="🔍 Buscar término o pregunta…" value={q} onChange={e => setQ(e.target.value)} style={{ ...inputStyle, flex: "1 1 240px" }} />
        {seccion === "glosario" && (
          <select value={cat} onChange={e => setCat(e.target.value)} style={inputStyle}>
            {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* GLOSARIO */}
      {seccion === "glosario" && (
        <div>
          {glosarioFiltrado.length === 0 ? (
            <div style={{ ...card, textAlign: "center", color: "#8E8E93", padding: 30 }}>Sin resultados para "{q}".</div>
          ) : glosarioFiltrado.map((g, i) => (
            <div key={i} style={{ ...card, borderLeft: "3px solid " + accent, padding: "14px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                <div style={{ fontSize: 14.5, fontWeight: 800, color: "#1C1C1E" }}>{g.t}</div>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: accent, background: accent + "15", borderRadius: 8, padding: "2px 8px", whiteSpace: "nowrap" }}>{g.c}</span>
              </div>
              <div style={{ fontSize: 13, color: "#3A3A3C", lineHeight: 1.55, marginBottom: 6 }}>{g.d}</div>
              <div style={{ fontSize: 12, color: "#636366", lineHeight: 1.5, background: "#FAFAFC", borderRadius: 8, padding: "8px 11px", marginBottom: g.v ? 8 : 0 }}>
                <b style={{ color: "#1C1C1E" }}>Ejemplo:</b> {g.e}
              </div>
              {g.v && irA && (
                <button onClick={() => irA(g.v)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid " + accent + "55", background: "transparent", color: accent, fontWeight: 700, fontSize: 11.5, cursor: "pointer" }}>
                  Ver en la app →
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* FLUJOS */}
      {seccion === "flujos" && (
        <div>
          {flujosFiltrados.length === 0 ? (
            <div style={{ ...card, textAlign: "center", color: "#8E8E93", padding: 30 }}>Sin guías para "{q}".</div>
          ) : flujosFiltrados.map((f, i) => (
            <div key={i} style={{ ...card, padding: "16px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ fontSize: 14.5, fontWeight: 800, color: "#1C1C1E" }}>{f.titulo}</div>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "#8E8E93", background: "#F2F2F7", borderRadius: 8, padding: "2px 8px" }}>{f.t}</span>
              </div>
              <ol style={{ margin: 0, paddingLeft: 22, fontSize: 13, color: "#3A3A3C", lineHeight: 1.7 }}>
                {f.pasos.map((p, j) => <li key={j} style={{ marginBottom: 3 }}>{p}</li>)}
              </ol>
              {f.destino && irA && (
                <button onClick={() => irA(f.destino)} style={{ marginTop: 12, padding: "8px 16px", borderRadius: 10, border: "none", background: accent, color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                  Ir ahora →
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
