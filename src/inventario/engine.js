/* ════════════════════════════════════════════════════════════════════
   ENGINE — Análisis de Stock, Rotación, Estacionalidad y Decisión
   Outlet de Puertas SpA · App Inventario v1
   JS puro, sin dependencias de React. Recibe matrices [][] (filas) ya
   leídas desde XLSX y devuelve estructuras de análisis listas para UI.
   ════════════════════════════════════════════════════════════════════ */

/* ── Parámetros oficiales (alineados al Sistema de Reposición v5.1) ── */
export const PARAMS_TIPO = {
  "ACCESORIOS":                { fab: 7,  cubrir: 30 },
  "CERRADURAS":                { fab: 7,  cubrir: 30 },
  "KIT PUERTA INTERIOR":       { fab: 21, cubrir: 30 },
  "MAMPARAS":                  { fab: 30, cubrir: 60 },
  "MARCO DE PUERTA":           { fab: 30, cubrir: 90 },
  "MOLDURAS":                  { fab: 7,  cubrir: 90 },
  "MOLDURAS Y TERMINACIONES":  { fab: 14, cubrir: 90 },
  "PERFIL PANEL UV":           { fab: 90, cubrir: 90 },
  "PERFIL SIDING":             { fab: 14, cubrir: 90 },
  "PERFIL WALL PANEL":         { fab: 14, cubrir: 90 },
  "PISOS":                     { fab: 7,  cubrir: 90 },
  "PORCELANATO":               { fab: 7,  cubrir: 90 },
  "PUERTA INTERIOR 1RA":       { fab: 21, cubrir: 30 },
  "PUERTA INTERIOR 2DA":       { fab: 21, cubrir: 30 },
  "PUERTA EXTERIOR 1ERA":      { fab: 21, cubrir: 30 },
  "PUERTA EXTERIOR 2DA":       { fab: 21, cubrir: 30 },
  "PUERTAS METALICAS":         { fab: 30, cubrir: 60 },
  "PINTURAS":                  { fab: 7,  cubrir: 90 },
  "REVESTIMIENTOS":            { fab: 7,  cubrir: 90 },
  "SIDING":                    { fab: 14, cubrir: 90 },
  "TECHUMBRE":                 { fab: 7,  cubrir: 90 },
}
const PARAM_DEFAULT = { fab: 14, cubrir: 60 }
export const paramTipo = (t) => PARAMS_TIPO[(t || "").trim().toUpperCase()] || PARAM_DEFAULT

/* Días de emergencia por clase ABCD (oficial) */
const DIAS_EMERGENCIA = { A: 30, B: 20, C: 10, D: 5 }

/* Tipos que NO son inventario (servicios) */
const NO_INVENTARIO = new Set(["DESPACHO", "SIN TIPO", "GENERAL", ""])

/* ── Helpers ── */
export const normSuc = (s) => {
  if (!s) return "?"
  const u = String(s).toUpperCase()
  if (u.includes("GRANJA")) return "La Granja"
  if (u.includes("NGELES") || u.includes("ANGELES")) return "Los Angeles"
  if (u.includes("MAIPU")) return "Maipu"
  return s
}
export const SUCURSALES = ["La Granja", "Los Angeles", "Maipu"]

const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0)

/* Fecha BSALE: "dd/mm/aaaa hh:mm:ss" o Date → "aaaa-mm" */
function parseMes(fh) {
  if (fh instanceof Date) return fh.getFullYear() + "-" + String(fh.getMonth() + 1).padStart(2, "0")
  if (typeof fh === "string" && fh.length >= 10) return fh.slice(6, 10) + "-" + fh.slice(3, 5)
  return null
}

/* ════════════════════════════════════════════════════════════════════
   1) PARSER VENTAS  (Detalle de ventas BSALE)
   Devuelve: { meses[], porSku: Map(sku -> {meta, totalQty, totalNeto,
              totalMargen, porSucMes: Map("suc|mes" -> {q,neto,margen})}) }
   Netea devoluciones (Tipo Movimiento === "devolucion") restando.
   ════════════════════════════════════════════════════════════════════ */
export function parseVentas(rows) {
  if (!rows || rows.length < 2) throw new Error("Excel de ventas vacío o sin filas")
  const head = rows[0].map((h) => String(h || "").trim())
  const H = {}; head.forEach((h, i) => (H[h] = i))
  const req = ["SKU", "Sucursal", "Cantidad", "Venta Total Neta", "Tipo de Producto / Servicio", "Fecha y Hora Venta"]
  const falta = req.filter((c) => !(c in H))
  if (falta.length) throw new Error("Faltan columnas en ventas: " + falta.join(", "))

  const C = {
    sku: H["SKU"], suc: H["Sucursal"], q: H["Cantidad"],
    neto: H["Venta Total Neta"], tp: H["Tipo de Producto / Servicio"],
    fecha: H["Fecha y Hora Venta"], prod: H["Producto / Servicio"],
    marca: H["Marca"], mov: H["Tipo Movimiento"], margen: H["Margen"],
  }

  const porSku = new Map()
  const mesesSet = new Set()

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue
    const sku = r[C.sku]; if (!sku) continue
    const tp = String(r[C.tp] || "").trim().toUpperCase()
    if (NO_INVENTARIO.has(tp)) continue
    const mes = parseMes(r[C.fecha]); if (!mes) continue
    mesesSet.add(mes)
    const suc = normSuc(r[C.suc])
    const sign = r[C.mov] === "devolucion" ? -1 : 1
    const q = sign * Math.abs(num(r[C.q]))
    const neto = sign * Math.abs(num(r[C.neto]))
    const margen = sign * Math.abs(num(r[C.margen]))

    let e = porSku.get(sku)
    if (!e) {
      e = {
        sku, meta: { producto: r[C.prod] || sku, tipo: r[C.tp] || "Sin Tipo", marca: r[C.marca] || "" },
        totalQty: 0, totalNeto: 0, totalMargen: 0, porSucMes: new Map(),
      }
      porSku.set(sku, e)
    }
    e.totalQty += q; e.totalNeto += neto; e.totalMargen += margen
    const key = suc + "|" + mes
    const cell = e.porSucMes.get(key) || { q: 0, neto: 0, margen: 0 }
    cell.q += q; cell.neto += neto; cell.margen += margen
    e.porSucMes.set(key, cell)
  }
  const mesesAll = [...mesesSet].sort()
  return { meses: mesesAll, mesesAll, porSku }
}

/* Selecciona meses "confiables": descarta meses cuya venta neta sea < 5% del
   mes máximo (meses con sólo devoluciones residuales o el mes en curso parcial).
   Devuelve nueva vista de ventas filtrada sin re-parsear el Excel. */
export function filtrarMesesConfiables(ventas, hoy = new Date()) {
  const volMes = {}
  for (const e of ventas.porSku.values())
    for (const [k, c] of e.porSucMes) {
      const m = k.split("|")[1]
      volMes[m] = (volMes[m] || 0) + c.neto
    }
  const maxVol = Math.max(0, ...Object.values(volMes))
  const umbral = maxVol * 0.05
  // mes en curso (incompleto) — se descarta salvo que ya haya terminado
  const mesActual = hoy.getFullYear() + "-" + String(hoy.getMonth() + 1).padStart(2, "0")
  const finDeMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate()
  const mesActualCompleto = hoy.getDate() >= finDeMes
  const buenos = new Set(
    ventas.mesesAll.filter((m) => {
      if ((volMes[m] || 0) < umbral) return false
      if (m === mesActual && !mesActualCompleto) return false
      return true
    })
  )

  // reconstruir porSku sólo con meses buenos
  const porSku = new Map()
  for (const e of ventas.porSku.values()) {
    let tQ = 0, tN = 0, tM = 0
    const pm = new Map()
    for (const [k, c] of e.porSucMes) {
      const m = k.split("|")[1]
      if (!buenos.has(m)) continue
      tQ += c.q; tN += c.neto; tM += c.margen
      pm.set(k, c)
    }
    if (pm.size) porSku.set(e.sku, { ...e, totalQty: tQ, totalNeto: tN, totalMargen: tM, porSucMes: pm })
  }
  return { meses: [...buenos].sort(), mesesAll: ventas.mesesAll, porSku, volMes }
}

/* ════════════════════════════════════════════════════════════════════
   2) PARSER STOCK  (Stock actual todas las sucursales BSALE)
   Header real en fila índice 5 (fila 6 humana). Devuelve:
   Map(sku -> { meta, total{unid,valor}, porSuc: Map(suc -> {unid,costoU,valor,porRecibir}) })
   ════════════════════════════════════════════════════════════════════ */
export function parseStock(rows) {
  if (!rows || rows.length < 7) throw new Error("Excel de stock vacío")
  // localizar fila header buscando "SKU"
  let hr = -1
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    if (rows[i] && rows[i].some((c) => String(c).trim() === "SKU")) { hr = i; break }
  }
  if (hr < 0) throw new Error("No se encontró fila de encabezados en stock (columna SKU)")
  const head = rows[hr].map((h) => String(h || "").trim())
  const H = {}; head.forEach((h, i) => (H[h] = i))
  const C = {
    sku: H["SKU"], suc: H["Sucursal"], unid: H["Stock"],
    costoU: H["Costo Neto Prom. Unitario"], valor: H["Costo Neto Prom. Total"],
    porRec: H["Por recibir"], tp: H["Tipo de Producto"], prod: H["Producto"],
    marca: H["Marca"], precio: H["Precio Venta Bruto"],
  }
  if (C.sku == null || C.unid == null) throw new Error("Stock sin columnas SKU/Stock")

  const map = new Map()
  for (let i = hr + 1; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue
    const sku = r[C.sku]; if (!sku) continue
    const suc = normSuc(r[C.suc])
    const unid = num(r[C.unid]), valor = num(r[C.valor]), costoU = num(r[C.costoU])
    const porRec = num(r[C.porRec])
    let e = map.get(sku)
    if (!e) {
      e = {
        sku, meta: { tipo: r[C.tp] || "", producto: r[C.prod] || sku, marca: r[C.marca] || "", precio: num(r[C.precio]) },
        total: { unid: 0, valor: 0, porRecibir: 0 }, porSuc: new Map(),
      }
      map.set(sku, e)
    }
    e.total.unid += unid; e.total.valor += valor; e.total.porRecibir += porRec
    e.porSuc.set(suc, { unid, costoU, valor, porRecibir: porRec })
  }
  return map
}

/* ════════════════════════════════════════════════════════════════════
   3) CLASIFICACIÓN ABCD dinámica (Pareto por participación de venta neta)
   A: hasta 80% acumulado · B: 80-95% · C: 95-99% · D: resto + sin venta
   ════════════════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════════
   3) CLASIFICACIÓN ABCD — Ley de Pareto por MONTO de venta (no cantidad)
   El criterio comercial estándar: los SKU se ordenan por su contribución
   en $ a la venta total, y se cortan por participación acumulada:
     A: hasta 80% acumulado  → "los vitales" (típicamente ~20% de SKU)
     B: 80-95%               → "importantes"
     C: 95-99%               → "marginales"
     D: 99-100% + sin venta  → "cola larga / candidatos a depurar"
   Clasificar por monto y no por unidades evita sobrevalorar productos
   baratos de alta rotación que aportan poco margen absoluto.
   ════════════════════════════════════════════════════════════════════ */
function clasificarABCD(items) {
  const conVenta = items.filter((x) => x.ventaNeta > 0).sort((a, b) => b.ventaNeta - a.ventaNeta)
  const totalV = conVenta.reduce((s, x) => s + x.ventaNeta, 0) || 1
  let acc = 0
  const cls = {}
  for (const x of conVenta) {
    acc += x.ventaNeta
    const p = acc / totalV
    cls[x.sku] = p <= 0.8 ? "A" : p <= 0.95 ? "B" : p <= 0.99 ? "C" : "D"
  }
  items.forEach((x) => { if (!cls[x.sku]) cls[x.sku] = "D" }) // sin venta → D
  return cls
}

/* ════════════════════════════════════════════════════════════════════
   4) ÍNDICES DE ESTACIONALIDAD  (por tipo de producto, base = promedio)
   indice[tipo][mes] = unidades_mes / promedio_mensual_tipo  (1.0 = normal)
   ════════════════════════════════════════════════════════════════════ */
export function estacionalidad(ventas) {
  const meses = ventas.meses
  const porTipoMes = {} // tipo -> mes -> qty
  for (const e of ventas.porSku.values()) {
    const tp = (e.meta.tipo || "Sin Tipo").trim()
    for (const [key, c] of e.porSucMes) {
      const mes = key.split("|")[1]
      porTipoMes[tp] = porTipoMes[tp] || {}
      porTipoMes[tp][mes] = (porTipoMes[tp][mes] || 0) + c.q
    }
  }
  const idx = {}
  for (const tp in porTipoMes) {
    const row = porTipoMes[tp]
    const tot = meses.reduce((s, m) => s + (row[m] || 0), 0)
    const avg = tot / meses.length || 1
    idx[tp] = {}
    meses.forEach((m) => (idx[tp][m] = avg ? (row[m] || 0) / avg : 0))
    idx[tp]._totalQty = tot
  }
  return { meses, indice: idx }
}

/* ════════════════════════════════════════════════════════════════════
   5) ANÁLISIS MAESTRO  — cruza ventas + stock por SKU y por sucursal
   ════════════════════════════════════════════════════════════════════ */
export function analizar(ventas, stockMap, opts = {}) {
  const meses = ventas.meses
  const nMeses = meses.length || 1
  // días reales del período (1° del primer mes → fin del último mes)
  const dias = opts.diasPeriodo || diasDePeriodo(meses)

  const skus = new Set([...ventas.porSku.keys(), ...stockMap.keys()])

  // pre-pass para venta neta total (clasificación)
  const prelim = []
  for (const sku of skus) {
    const v = ventas.porSku.get(sku)
    prelim.push({ sku, ventaNeta: v ? v.totalNeto : 0 })
  }
  const cls = clasificarABCD(prelim)

  const items = []
  for (const sku of skus) {
    const v = ventas.porSku.get(sku)
    const s = stockMap.get(sku)
    const tipo = (v?.meta.tipo || s?.meta.tipo || "Sin Tipo").trim()
    const producto = v?.meta.producto || s?.meta.producto || sku
    const marca = v?.meta.marca || s?.meta.marca || ""
    const clase = cls[sku]

    const qtyVend = v ? v.totalQty : 0
    const netoVend = v ? v.totalNeto : 0
    const margenVend = v ? v.totalMargen : 0
    const margenPct = netoVend > 0 ? margenVend / netoVend : 0

    const stockUnid = s ? s.total.unid : 0
    const stockValor = s ? s.total.valor : 0
    const porRecibir = s ? s.total.porRecibir : 0

    // venta diaria y compensada
    const vtaPromMes = qtyVend / nMeses
    const vtaDia = qtyVend > 0 ? qtyVend / dias : 0
    // venta compensada: factor pico mensual cap 1.5 (oficial)
    let maxMes = 0
    if (v) {
      const perMes = {}
      for (const [key, c] of v.porSucMes) {
        const m = key.split("|")[1]; perMes[m] = (perMes[m] || 0) + c.q
      }
      maxMes = Math.max(0, ...Object.values(perMes))
    }
    const factorComp = vtaPromMes > 0 ? Math.min(1.5, maxMes / vtaPromMes || 1) : 1
    const vtaCompMes = vtaPromMes * factorComp
    const vtaCompDia = vtaCompMes / 30

    const P = paramTipo(tipo)
    const diasEmerg = DIAS_EMERGENCIA[clase] || 5
    const puntoReorden = vtaCompDia * (P.fab + diasEmerg)
    const repo = vtaCompDia * P.cubrir + puntoReorden - stockUnid
    const reposicion = repo > 0 ? Math.ceil(repo) : 0

    // ── cobertura, rotación, DSI ──
    const cobertura = vtaDia > 0 ? stockUnid / vtaDia : (stockUnid > 0 ? 999 : 0)
    const rotAnual = stockUnid > 0 && qtyVend > 0 ? (qtyVend * (365 / dias)) / stockUnid : 0
    // DSI (Days Sales of Inventory): días que tarda en venderse el stock actual al ritmo del período
    const dsi = rotAnual > 0 ? 365 / rotAnual : (stockUnid > 0 ? 999 : 0)

    // ── costo unitario y valores ──
    const costoU = s ? (s.porSuc.size ? [...s.porSuc.values()][0].costoU : 0) : 0
    const costoVendido = netoVend - margenVend         // COGS del período
    const costoRepo = reposicion * costoU

    // ── GMROI: margen bruto generado por cada $ invertido en inventario ──
    // GMROI = margen bruto del período / costo promedio del inventario
    // Objetivo retail durables: ≥ 2.0 (genera $2 de margen por cada $1 en stock)
    const gmroi = stockValor > 0 ? margenVend / stockValor : (margenVend > 0 ? 99 : 0)

    // ── Sell-through: % de la disponibilidad total que se vendió ──
    // disponibilidad = lo que se vendió + lo que quedó en stock
    const disponibilidad = qtyVend + stockUnid
    const sellThrough = disponibilidad > 0 ? qtyVend / disponibilidad : 0

    // ── Velocidad de movimiento (clasificación de rotación) ──
    let velocidad
    if (qtyVend <= 0) velocidad = "Sin movimiento"
    else if (dsi <= 30) velocidad = "Fast mover"      // se vende en < 1 mes
    else if (dsi <= 90) velocidad = "Medium mover"    // 1-3 meses
    else if (dsi <= 180) velocidad = "Slow mover"     // 3-6 meses
    else velocidad = "Very slow"                       // > 6 meses

    // ── estado operativo ──
    let estado
    if (qtyVend > 0 && stockUnid === 0) estado = "Quiebre"
    else if (qtyVend > 0 && stockUnid <= puntoReorden) estado = "Reposicion"
    else if (qtyVend <= 0 && stockUnid > 0) estado = "Dead stock"
    else if (qtyVend <= 0 && stockUnid === 0) estado = "Sin movimiento"
    else estado = "Saludable"

    // ── Health score 0-100: salud integral del SKU ──
    // Combina: rotación (40%), margen (25%), disponibilidad/quiebre (20%), GMROI (15%)
    let health = 0
    if (qtyVend > 0) {
      const sRot   = Math.min(1, rotAnual / 4)                       // 4x/año = óptimo durables
      const sMrg   = Math.min(1, Math.max(0, margenPct / 0.40))      // 40% margen = óptimo
      const sDisp  = estado === "Quiebre" ? 0.2 : estado === "Reposicion" ? 0.6 : 1
      const sGm    = Math.min(1, gmroi / 2.5)                        // GMROI 2.5 = óptimo
      health = Math.round((sRot * 40 + sMrg * 25 + sDisp * 20 + sGm * 15))
    }

    // detalle por sucursal
    const porSuc = {}
    SUCURSALES.forEach((sc) => {
      const sv = s?.porSuc.get(sc)
      let qsuc = 0, nsuc = 0
      if (v) for (const [key, c] of v.porSucMes) { if (key.startsWith(sc + "|")) { qsuc += c.q; nsuc += c.neto } }
      const stkU = sv ? sv.unid : 0
      const vdSuc = qsuc > 0 ? qsuc / dias : 0
      porSuc[sc] = {
        stockUnid: stkU, stockValor: sv ? sv.valor : 0,
        qtyVend: qsuc, netoVend: nsuc,
        cobertura: vdSuc > 0 ? stkU / vdSuc : (stkU > 0 ? 999 : 0),
        estado: qsuc > 0 && stkU === 0 ? "Quiebre" : qsuc <= 0 && stkU > 0 ? "Dead stock" : stkU > 0 ? "OK" : "—",
      }
    })

    items.push({
      sku, producto, tipo, marca, clase, estado, velocidad,
      qtyVend, netoVend, margenVend, margenPct, costoVendido,
      stockUnid, stockValor, porRecibir, costoU,
      vtaDia, vtaCompDia, vtaPromMes, factorComp,
      puntoReorden: Math.round(puntoReorden), reposicion, costoRepo,
      cobertura: Math.round(cobertura), rotAnual: +rotAnual.toFixed(2),
      dsi: Math.round(dsi), gmroi: +gmroi.toFixed(2),
      sellThrough: +sellThrough.toFixed(3), health,
      porSuc,
    })
  }

  return { meses, dias, items }
}

function diasDePeriodo(meses) {
  if (!meses.length) return 30
  const first = meses[0].split("-").map(Number)
  const last = meses[meses.length - 1].split("-").map(Number)
  const d1 = new Date(first[0], first[1] - 1, 1)
  const d2 = new Date(last[0], last[1], 0) // último día del último mes
  return Math.round((d2 - d1) / 86400000) + 1
}

/* ════════════════════════════════════════════════════════════════════
   6) KPIs GLOBALES y por sucursal
   ════════════════════════════════════════════════════════════════════ */
export function kpis(analisis) {
  const it = analisis.items
  const conStock = it.filter((x) => x.stockUnid > 0)
  const valorInv = it.reduce((s, x) => s + x.stockValor, 0)
  const ventaTotal = it.reduce((s, x) => s + x.netoVend, 0)
  const margenTotal = it.reduce((s, x) => s + x.margenVend, 0)

  const quiebre = it.filter((x) => x.estado === "Quiebre")
  const repo = it.filter((x) => x.estado === "Reposicion")
  const dead = it.filter((x) => x.estado === "Dead stock")
  const saludable = it.filter((x) => x.estado === "Saludable")

  const skusVend = it.filter((x) => x.qtyVend > 0).length
  const tasaQuiebre = skusVend ? quiebre.length / skusVend : 0

  // rotación: mediana sobre SKU con stock+venta (evita outliers de cobertura 0)
  const rots = conStock.filter((x) => x.qtyVend > 0).map((x) => x.rotAnual).sort((a, b) => a - b)
  const rotMediana = rots.length ? rots[Math.floor(rots.length / 2)] : 0
  // COGS anualizado aprox para rotación valorizada
  const cogsAnual = it.reduce((s, x) => s + (x.netoVend - x.margenVend), 0) * (365 / analisis.dias)
  const rotValor = valorInv > 0 ? cogsAnual / valorInv : 0
  const diasInvProm = rotValor > 0 ? 365 / rotValor : 0

  const cobs = conStock.filter((x) => x.cobertura < 999).map((x) => x.cobertura).sort((a, b) => a - b)
  const cobMediana = cobs.length ? cobs[Math.floor(cobs.length / 2)] : 0

  // ── GMROI global: margen total / inventario promedio valorizado ──
  const gmroiGlobal = valorInv > 0 ? margenTotal / valorInv : 0
  // ── Sell-through global ponderado por unidades ──
  const totQtyVend = it.reduce((s, x) => s + Math.max(0, x.qtyVend), 0)
  const totDisp = it.reduce((s, x) => s + Math.max(0, x.qtyVend) + x.stockUnid, 0)
  const sellThroughGlobal = totDisp > 0 ? totQtyVend / totDisp : 0

  // ── Concentración Pareto real: cuántos SKU A generan qué % de venta ──
  const claseA = it.filter((x) => x.clase === "A")
  const ventaClaseA = claseA.reduce((s, x) => s + x.netoVend, 0)
  const concentracionA = ventaTotal ? ventaClaseA / ventaTotal : 0
  const pctSkuA = it.length ? claseA.length / it.length : 0

  // ── Distribución por velocidad ──
  const velocidad = {}
  it.forEach((x) => { velocidad[x.velocidad] = (velocidad[x.velocidad] || 0) + 1 })

  // ── Health score promedio (solo SKU con venta) ──
  const conVentaItems = it.filter((x) => x.qtyVend > 0)
  const healthProm = conVentaItems.length ? Math.round(conVentaItems.reduce((s, x) => s + x.health, 0) / conVentaItems.length) : 0

  // ── Capital en riesgo: dead stock + sobre-stock (cobertura > 180d) ──
  const sobreStock = it.filter((x) => x.qtyVend > 0 && x.cobertura < 999 && x.cobertura > 180)
  const capitalRiesgo = dead.reduce((s, x) => s + x.stockValor, 0) + sobreStock.reduce((s, x) => s + x.stockValor, 0)

  return {
    skusTotal: it.length, skusConStock: conStock.length, skusVend,
    valorInventario: valorInv, ventaTotal, margenTotal,
    margenPctGlobal: ventaTotal ? margenTotal / ventaTotal : 0,
    quiebre: quiebre.length, reposicion: repo.length, deadStock: dead.length,
    saludable: saludable.length,
    valorDeadStock: dead.reduce((s, x) => s + x.stockValor, 0),
    costoReposicion: repo.concat(quiebre).reduce((s, x) => s + x.costoRepo, 0),
    tasaQuiebre, rotValorizada: +rotValor.toFixed(2), diasInvProm: Math.round(diasInvProm),
    rotMediana: +rotMediana.toFixed(2), coberturaMediana: Math.round(cobMediana),
    quiebreClaseA: quiebre.filter((x) => x.clase === "A").length,
    skusClaseA: it.filter((x) => x.clase === "A").length,
    // ── nuevas métricas profesionales ──
    gmroiGlobal: +gmroiGlobal.toFixed(2),
    sellThroughGlobal: +sellThroughGlobal.toFixed(3),
    concentracionA: +concentracionA.toFixed(3), pctSkuA: +pctSkuA.toFixed(3),
    ventaClaseA,
    velocidad, healthProm,
    sobreStock: sobreStock.length, valorSobreStock: sobreStock.reduce((s, x) => s + x.stockValor, 0),
    capitalRiesgo,
  }
}

export function kpisPorSucursal(analisis) {
  const out = {}
  SUCURSALES.forEach((sc) => {
    const items = analisis.items.map((x) => ({ ...x.porSuc[sc], clase: x.clase, sku: x.sku, margenPct: x.margenPct }))
    const valorInv = items.reduce((s, x) => s + x.stockValor, 0)
    const venta = items.reduce((s, x) => s + x.netoVend, 0)
    const quiebre = items.filter((x) => x.estado === "Quiebre").length
    const dead = items.filter((x) => x.estado === "Dead stock")
    const conStock = items.filter((x) => x.stockUnid > 0).length
    const vendidos = items.filter((x) => x.qtyVend > 0).length
    // margen estimado por sucursal (usa margenPct del SKU aplicado a la venta de la sucursal)
    const margen = items.reduce((s, x) => s + x.netoVend * (x.margenPct || 0), 0)
    const cogsAnual = (venta - margen) * (365 / analisis.dias)
    const rotValor = valorInv > 0 ? cogsAnual / valorInv : 0
    out[sc] = {
      valorInventario: valorInv, venta, margen,
      margenPct: venta ? margen / venta : 0,
      quiebre, deadStock: dead.length,
      valorDeadStock: dead.reduce((s, x) => s + x.stockValor, 0),
      skusConStock: conStock, skusVendidos: vendidos,
      tasaQuiebre: vendidos ? quiebre / vendidos : 0,
      gmroi: valorInv > 0 ? +(margen / valorInv).toFixed(2) : 0,
      rotValorizada: +rotValor.toFixed(2),
    }
  })
  return out
}

/* ════════════════════════════════════════════════════════════════════
   7) MOTOR DE SUGERENCIAS / DECISIÓN COMERCIAL
   Genera acciones priorizadas con impacto $ estimado.
   ════════════════════════════════════════════════════════════════════ */
export function sugerencias(analisis, estac) {
  const it = analisis.items
  const acc = []

  // A) Quiebres de clase A/B → comprar YA (priorizado por MARGEN en riesgo)
  const quiebreUrgente = it
    .filter((x) => x.estado === "Quiebre" && (x.clase === "A" || x.clase === "B"))
    .sort((a, b) => b.margenVend - a.margenVend)
  quiebreUrgente.slice(0, 30).forEach((x) => {
    const margenMensualPerdido = x.margenVend / analisis.dias * 30
    const ventaMensualPerdida = x.netoVend / analisis.dias * 30
    acc.push({
      tipo: "COMPRAR_URGENTE", prioridad: 1, sku: x.sku, producto: x.producto,
      clase: x.clase, tipo_prod: x.tipo,
      detalle: `Quiebre clase ${x.clase}. Vendía ${Math.round(x.vtaDia)}/día (margen ${(x.margenPct * 100).toFixed(0)}%). Reponer ${x.reposicion} u.`,
      impacto: margenMensualPerdido, impactoLabel: "margen/mes perdido",
      impactoSec: ventaMensualPerdida, impactoSecLabel: "venta/mes",
      reposicion: x.reposicion, costoRepo: x.costoRepo,
    })
  })

  // B) Riesgo inminente: cobertura < días de fabricación (no alcanza a reponer)
  it.filter((x) => x.estado !== "Quiebre" && x.qtyVend > 0 && x.cobertura > 0 && x.cobertura < paramTipo(x.tipo).fab + 7)
    .sort((a, b) => a.cobertura - b.cobertura)
    .slice(0, 30).forEach((x) => {
      acc.push({
        tipo: "RIESGO_QUIEBRE", prioridad: 2, sku: x.sku, producto: x.producto,
        clase: x.clase, tipo_prod: x.tipo,
        detalle: `Cobertura ${x.cobertura}d < lead time ${paramTipo(x.tipo).fab}d. Reponer antes de quiebre.`,
        impacto: x.netoVend / analisis.dias * 30, impactoLabel: "venta/mes protegida",
        reposicion: x.reposicion, costoRepo: x.costoRepo,
      })
    })

  // C) Dead stock con valor → liquidar / promocionar
  it.filter((x) => x.estado === "Dead stock" && x.stockValor > 0)
    .sort((a, b) => b.stockValor - a.stockValor)
    .slice(0, 30).forEach((x) => {
      acc.push({
        tipo: "LIQUIDAR", prioridad: 3, sku: x.sku, producto: x.producto,
        clase: x.clase, tipo_prod: x.tipo,
        detalle: `${x.stockUnid} u. sin venta en el período. Capital inmovilizado.`,
        impacto: x.stockValor, impactoLabel: "capital a liberar",
      })
    })

  // D) Sobre-stock: cobertura > 2x período objetivo → frenar compras
  it.filter((x) => x.qtyVend > 0 && x.cobertura < 999 && x.cobertura > paramTipo(x.tipo).cubrir * 2)
    .sort((a, b) => b.stockValor - a.stockValor)
    .slice(0, 20).forEach((x) => {
      acc.push({
        tipo: "SOBRESTOCK", prioridad: 4, sku: x.sku, producto: x.producto,
        clase: x.clase, tipo_prod: x.tipo,
        detalle: `Cobertura ${x.cobertura}d (objetivo ${paramTipo(x.tipo).cubrir}d). No recomprar aún.`,
        impacto: x.stockValor, impactoLabel: "capital sobre-invertido",
      })
    })

  // E) Rebalanceo entre sucursales: quiebre en una, sobrante en otra
  it.forEach((x) => {
    const conQuiebre = SUCURSALES.filter((s) => x.porSuc[s].estado === "Quiebre" && x.porSuc[s].qtyVend > 0)
    const conSobra = SUCURSALES.filter((s) => x.porSuc[s].cobertura > 120 && x.porSuc[s].stockUnid > 0)
    if (conQuiebre.length && conSobra.length) {
      acc.push({
        tipo: "REBALANCEAR", prioridad: 2, sku: x.sku, producto: x.producto,
        clase: x.clase, tipo_prod: x.tipo,
        detalle: `Quiebre en ${conQuiebre.join(", ")} pero sobra en ${conSobra.join(", ")}. Transferir entre sucursales.`,
        impacto: x.netoVend / analisis.dias * 30, impactoLabel: "venta recuperable sin comprar",
      })
    }
  })

  // F) GMROI bajo: stock con venta pero que rinde poco margen por $ invertido
  // (capital mal asignado — el inventario no está "trabajando")
  it.filter((x) => x.qtyVend > 0 && x.stockValor > 100000 && x.gmroi > 0 && x.gmroi < 0.8)
    .sort((a, b) => b.stockValor - a.stockValor)
    .slice(0, 20).forEach((x) => {
      acc.push({
        tipo: "GMROI_BAJO", prioridad: 4, sku: x.sku, producto: x.producto,
        clase: x.clase, tipo_prod: x.tipo,
        detalle: `GMROI ${x.gmroi.toFixed(2)} (objetivo ≥2.0). Cada $1 en stock genera solo $${x.gmroi.toFixed(2)} de margen. Revisar precio o rotación.`,
        impacto: x.stockValor, impactoLabel: "capital mal rentabilizado",
      })
    })

  acc.sort((a, b) => a.prioridad - b.prioridad || b.impacto - a.impacto)

  // ── Resumen ejecutivo con totales de impacto ──
  const grupo = (tipo) => acc.filter((a) => a.tipo === tipo)
  const resumen = {
    comprarUrgente: grupo("COMPRAR_URGENTE"),
    riesgo: grupo("RIESGO_QUIEBRE"),
    liquidar: grupo("LIQUIDAR"),
    sobrestock: grupo("SOBRESTOCK"),
    rebalancear: grupo("REBALANCEAR"),
    gmroiBajo: grupo("GMROI_BAJO"),
  }
  // Totales accionables: margen recuperable y capital liberable
  const margenRecuperable = grupo("COMPRAR_URGENTE").reduce((s, a) => s + a.impacto, 0)
    + grupo("RIESGO_QUIEBRE").reduce((s, a) => s + a.impacto, 0)
    + grupo("REBALANCEAR").reduce((s, a) => s + a.impacto, 0)
  const capitalLiberable = grupo("LIQUIDAR").reduce((s, a) => s + a.impacto, 0)
    + grupo("SOBRESTOCK").reduce((s, a) => s + a.impacto, 0)
  const inversionRequerida = grupo("COMPRAR_URGENTE").reduce((s, a) => s + (a.costoRepo || 0), 0)

  return { acciones: acc, resumen, totales: { margenRecuperable, capitalLiberable, inversionRequerida } }
}
