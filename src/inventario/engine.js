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
  // quitar tildes/diacríticos antes de comparar (Maipú → MAIPU, Ángeles → ANGELES)
  const u = String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
  // Bodega Los Ángeles: bodega de acopio satélite, debe distinguirse de la tienda
  if (u.includes("BODEGA") && u.includes("ANGELES")) return "Bodega Los Angeles"
  if (u.includes("GRANJA")) return "La Granja"
  if (u.includes("ANGELES")) return "Los Angeles"
  if (u.includes("MAIPU")) return "Maipu"
  return s
}
export const SUCURSALES = ["La Granja", "Los Angeles", "Bodega Los Angeles", "Maipu"]

// Solo sucursales que VENDEN (excluye bodegas de acopio y el CD).
export const SUCURSALES_VENTA = ["La Granja", "Los Angeles"]

// Bodegas satélite: pertenecen operacionalmente a una sucursal de venta.
export const BODEGA_PADRE = { "Bodega Los Angeles": "Los Angeles" }

// ¿Esta sucursal es bodega de acopio?
export const esBodega = (s) => Boolean(BODEGA_PADRE[s])

// Scope efectivo: [sucursal] o [sucursal, su_bodega] cuando aplica
export const scopeEfectivo = (suc) => {
  const bodegas = Object.entries(BODEGA_PADRE).filter(([, p]) => p === suc).map(([b]) => b)
  return [suc, ...bodegas]
}

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
      // punto de reorden local de la sucursal (mismos params de tipo y clase global)
      const prSuc = vdSuc * (P.fab + diasEmerg)
      // objetivo de cobertura local (para saber cuánto pedir hasta reorden)
      const objetivoSuc = vdSuc * P.cubrir + prSuc
      porSuc[sc] = {
        stockUnid: stkU, stockValor: sv ? sv.valor : 0,
        qtyVend: qsuc, netoVend: nsuc, vtaDia: vdSuc,
        puntoReorden: Math.round(prSuc), objetivo: Math.round(objetivoSuc),
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

  // E) Rebalanceo entre sucursales: solo aplica en vista global, no en filtrada
  if (!analisis.sucursalFiltro) {
    it.forEach((x) => {
      const conQuiebre = SUCURSALES.filter((s) => x.porSuc?.[s]?.estado === "Quiebre" && x.porSuc[s].qtyVend > 0)
      const conSobra = SUCURSALES.filter((s) => x.porSuc?.[s] && x.porSuc[s].cobertura > 120 && x.porSuc[s].stockUnid > 0)
      if (conQuiebre.length && conSobra.length) {
      acc.push({
        tipo: "REBALANCEAR", prioridad: 2, sku: x.sku, producto: x.producto,
        clase: x.clase, tipo_prod: x.tipo,
        detalle: `Quiebre en ${conQuiebre.join(", ")} pero sobra en ${conSobra.join(", ")}. Transferir entre sucursales.`,
        impacto: x.netoVend / analisis.dias * 30, impactoLabel: "venta recuperable sin comprar",
      })
    }
  })
  }

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

  // G) Transferencias desde CD (Maipú) — solo en vista global
  if (!analisis.sucursalFiltro) {
    const cd = transferenciasCD(analisis)
    cd.transferencias.slice(0, 40).forEach((t) => {
      acc.push({
        tipo: "TRANSFERIR_CD", prioridad: 1, sku: t.sku, producto: t.producto,
        clase: t.clase, tipo_prod: t.tipo,
        detalle: `${t.destino} ${t.estadoDestino === "Quiebre" ? "en quiebre" : "bajo reorden"} (stock ${t.stockDestino}). Maipú tiene ${t.stockCD}. Transferir ${t.transferir} u en vez de comprar.`,
        impacto: t.margenProtegido, impactoLabel: "margen/mes protegido",
        transferir: t.transferir, destino: t.destino,
      })
    })
  }

  acc.sort((a, b) => a.prioridad - b.prioridad || b.impacto - a.impacto)

  // ── Resumen ejecutivo con totales de impacto ──
  const grupo = (tipo) => acc.filter((a) => a.tipo === tipo)
  const resumen = {
    comprarUrgente: grupo("COMPRAR_URGENTE"),
    riesgo: grupo("RIESGO_QUIEBRE"),
    transferirCD: grupo("TRANSFERIR_CD"),
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

/* ════════════════════════════════════════════════════════════════════
   8) FILTRAR ANÁLISIS POR SUCURSAL
   Toma un `analisis` global y devuelve uno donde cada SKU refleja sólo
   los números de la sucursal indicada. Reclasifica ABCD localmente
   (un producto puede ser A global pero D en una sucursal específica).
   Las métricas (rotación, GMROI, sell-through, health) se recalculan
   con el subset de datos local.
   ════════════════════════════════════════════════════════════════════ */
export function filtrarPorSucursal(an, sucursal) {
  if (!sucursal || sucursal === "TODAS") return an
  const dias = an.dias

  // Construir items locales con datos de la sucursal
  const items0 = an.items.map((x) => {
    const ps = x.porSuc[sucursal] || { stockUnid: 0, stockValor: 0, qtyVend: 0, netoVend: 0, cobertura: 0, estado: "—" }
    // Estimación: el margen % es del SKU global (proporcional al monto vendido en la sucursal)
    const margenLocal = ps.netoVend * (x.margenPct || 0)
    const costoVendidoLocal = ps.netoVend - margenLocal
    return {
      sku: x.sku, producto: x.producto, tipo: x.tipo, marca: x.marca,
      qtyVend: Math.max(0, ps.qtyVend),
      netoVend: ps.netoVend,
      margenVend: margenLocal,
      margenPct: x.margenPct,
      costoVendido: costoVendidoLocal,
      stockUnid: ps.stockUnid,
      stockValor: ps.stockValor,
      costoU: x.costoU,
      porRecibir: 0,
    }
  })

  // Reclasificar ABCD por monto de venta LOCAL
  const cls = clasificarABCD(items0.map((x) => ({ sku: x.sku, ventaNeta: x.netoVend })))

  // Recalcular métricas por SKU
  const items = items0.map((x) => {
    const clase = cls[x.sku]
    const vtaDia = x.qtyVend > 0 ? x.qtyVend / dias : 0
    const cobertura = vtaDia > 0 ? x.stockUnid / vtaDia : (x.stockUnid > 0 ? 999 : 0)
    const rotAnual = x.stockUnid > 0 && x.qtyVend > 0 ? (x.qtyVend * (365 / dias)) / x.stockUnid : 0
    const dsi = rotAnual > 0 ? 365 / rotAnual : (x.stockUnid > 0 ? 999 : 0)
    const gmroi = x.stockValor > 0 ? x.margenVend / x.stockValor : (x.margenVend > 0 ? 99 : 0)
    const disp = x.qtyVend + x.stockUnid
    const sellThrough = disp > 0 ? x.qtyVend / disp : 0

    let velocidad
    if (x.qtyVend <= 0) velocidad = "Sin movimiento"
    else if (dsi <= 30) velocidad = "Fast mover"
    else if (dsi <= 90) velocidad = "Medium mover"
    else if (dsi <= 180) velocidad = "Slow mover"
    else velocidad = "Very slow"

    // Punto de reorden con params del tipo
    const P = paramTipo(x.tipo)
    const diasEmerg = { A: 30, B: 20, C: 10, D: 5 }[clase] || 5
    const vtaCompDia = vtaDia * 1.0 // sin factor pico local (data limitada)
    const puntoReorden = vtaCompDia * (P.fab + diasEmerg)
    const repo = vtaCompDia * P.cubrir + puntoReorden - x.stockUnid
    const reposicion = repo > 0 ? Math.ceil(repo) : 0
    const costoRepo = reposicion * x.costoU

    let estado
    if (x.qtyVend > 0 && x.stockUnid === 0) estado = "Quiebre"
    else if (x.qtyVend > 0 && x.stockUnid <= puntoReorden) estado = "Reposicion"
    else if (x.qtyVend <= 0 && x.stockUnid > 0) estado = "Dead stock"
    else if (x.qtyVend <= 0 && x.stockUnid === 0) estado = "Sin movimiento"
    else estado = "Saludable"

    let health = 0
    if (x.qtyVend > 0) {
      const sRot  = Math.min(1, rotAnual / 4)
      const sMrg  = Math.min(1, Math.max(0, x.margenPct / 0.40))
      const sDisp = estado === "Quiebre" ? 0.2 : estado === "Reposicion" ? 0.6 : 1
      const sGm   = Math.min(1, gmroi / 2.5)
      health = Math.round(sRot * 40 + sMrg * 25 + sDisp * 20 + sGm * 15)
    }

    return {
      ...x, clase, estado, velocidad,
      vtaDia, vtaCompDia, vtaPromMes: x.qtyVend / (an.meses.length || 1), factorComp: 1,
      puntoReorden: Math.round(puntoReorden), reposicion, costoRepo,
      cobertura: Math.round(cobertura), rotAnual: +rotAnual.toFixed(2),
      dsi: Math.round(dsi), gmroi: +gmroi.toFixed(2),
      sellThrough: +sellThrough.toFixed(3), health,
      porSuc: { [sucursal]: an.items.find((it) => it.sku === x.sku).porSuc[sucursal] },
    }
  })

  return { ...an, items, sucursalFiltro: sucursal }
}

/* ════════════════════════════════════════════════════════════════════
   9) ESTACIONALIDAD POR SUCURSAL
   Calcula índices estacionales usando sólo ventas de la sucursal dada.
   ════════════════════════════════════════════════════════════════════ */
export function estacionalidadPorSucursal(ventas, sucursal) {
  if (!sucursal || sucursal === "TODAS") return estacionalidad(ventas)
  const meses = ventas.meses
  const porTipoMes = {}
  for (const e of ventas.porSku.values()) {
    const tp = (e.meta.tipo || "Sin Tipo").trim()
    for (const [key, c] of e.porSucMes) {
      const [suc, mes] = key.split("|")
      if (suc !== sucursal) continue
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
   10) FILTRAR ANÁLISIS POR TIPO DE PRODUCTO
   Devuelve un análisis con sólo los items del tipo indicado. Recalcula
   la clase ABCD localmente (Pareto dentro del tipo) para que el ranking
   tenga sentido dentro de la categoría.
   ════════════════════════════════════════════════════════════════════ */
export function filtrarPorTipo(an, tipo) {
  if (!tipo || tipo === "TODOS") return an
  const items0 = an.items.filter((x) => (x.tipo || "Sin clasificar") === tipo)
  // reclasificar ABCD dentro del tipo
  const cls = clasificarABCD(items0.map((x) => ({ sku: x.sku, ventaNeta: x.netoVend })))
  const items = items0.map((x) => ({ ...x, clase: cls[x.sku] }))
  return { ...an, items, tipoFiltro: tipo }
}

/* Lista de tipos de producto presentes en el análisis (para poblar el filtro) */
export function tiposDeProducto(an) {
  const set = new Set()
  an.items.forEach((x) => set.add(x.tipo || "Sin clasificar"))
  return [...set].sort()
}

/* ════════════════════════════════════════════════════════════════════
   11) TRANSFERENCIAS DESDE CD (Maipú)
   Maipú funciona como centro de distribución. Esta función detecta
   productos que La Granja o Los Ángeles necesitan (quiebre o bajo punto
   de reorden) y que Maipú tiene en stock, sugiriendo transferir en vez
   de comprar.

   Cantidad sugerida = lo necesario para llevar a la sucursal destino
   hasta su punto de reorden, limitado por lo que Maipú puede ceder sin
   quedar bajo su propio punto de reorden.

   Devuelve { transferencias[], resumen, porDestino }
   ════════════════════════════════════════════════════════════════════ */
const CD_SUCURSAL = "Maipu"
const DESTINOS_CD = ["La Granja", "Los Angeles"]

export function transferenciasCD(an) {
  const transferencias = []

  for (const x of an.items) {
    const cd = x.porSuc?.[CD_SUCURSAL]
    if (!cd || cd.stockUnid <= 0) continue // Maipú no tiene stock de este SKU
    // Cuánto puede ceder Maipú sin quedar bajo su propio punto de reorden
    // (si Maipú no vende directamente, su reorden es ~0, puede ceder casi todo)
    const reservaCD = Math.max(0, Math.round(cd.puntoReorden || 0))
    let disponibleCD = Math.max(0, cd.stockUnid - reservaCD)
    if (disponibleCD <= 0) continue

    // Necesidad de cada destino
    for (const dest of DESTINOS_CD) {
      if (disponibleCD <= 0) break
      const d = x.porSuc?.[dest]
      if (!d) continue
      // Solo si el destino vende este producto (tiene demanda)
      if (d.qtyVend <= 0) continue
      // Necesita si está en quiebre o por debajo del punto de reorden
      const bajoReorden = d.stockUnid <= (d.puntoReorden || 0)
      if (!bajoReorden) continue

      // Cantidad para llevar al destino hasta su punto de reorden
      const necesita = Math.max(0, Math.round((d.puntoReorden || 0) - d.stockUnid))
      if (necesita <= 0) continue

      const transferir = Math.min(necesita, disponibleCD)
      if (transferir <= 0) continue
      disponibleCD -= transferir

      const valorTransfer = transferir * (x.costoU || 0)
      const margenProtegido = (d.vtaDia || 0) * 30 * (x.margenPct || 0) // margen mensual del destino

      transferencias.push({
        sku: x.sku, producto: x.producto, tipo: x.tipo, clase: x.clase,
        destino: dest,
        estadoDestino: d.estado === "Quiebre" ? "Quiebre" : "Bajo reorden",
        stockDestino: d.stockUnid,
        ventaDiaDestino: +(d.vtaDia || 0).toFixed(1),
        puntoReordenDestino: d.puntoReorden || 0,
        stockCD: cd.stockUnid,
        transferir,
        valorTransfer,
        margenProtegido,
        coberturaDestino: Math.round(d.cobertura || 0),
      })
    }
  }

  // Ordenar: clase A primero, luego por margen protegido
  const ordenClase = { A: 0, B: 1, C: 2, D: 3 }
  transferencias.sort((a, b) =>
    (ordenClase[a.clase] - ordenClase[b.clase]) ||
    (b.margenProtegido - a.margenProtegido))

  // Resumen por destino
  const porDestino = {}
  DESTINOS_CD.forEach((dest) => {
    const items = transferencias.filter((t) => t.destino === dest)
    porDestino[dest] = {
      items: items.length,
      unidades: items.reduce((s, t) => s + t.transferir, 0),
      valor: items.reduce((s, t) => s + t.valorTransfer, 0),
      margenProtegido: items.reduce((s, t) => s + t.margenProtegido, 0),
      quiebres: items.filter((t) => t.estadoDestino === "Quiebre").length,
    }
  })

  const resumen = {
    total: transferencias.length,
    unidadesTotal: transferencias.reduce((s, t) => s + t.transferir, 0),
    valorTotal: transferencias.reduce((s, t) => s + t.valorTransfer, 0),
    margenProtegidoTotal: transferencias.reduce((s, t) => s + t.margenProtegido, 0),
    claseA: transferencias.filter((t) => t.clase === "A").length,
    quiebresResueltos: transferencias.filter((t) => t.estadoDestino === "Quiebre").length,
  }

  return { transferencias, resumen, porDestino }
}

/* ════════════════════════════════════════════════════════════════════
   12) FILTRAR ANÁLISIS POR CLASE ABCD
   Devuelve un análisis con sólo los items de la(s) clase(s) indicada(s).
   No reclasifica — respeta la clase ya calculada (global, por sucursal o
   por tipo, según el orden en que se hayan aplicado los filtros previos).
   `clases` puede ser "TODAS" o un string de clase ("A","B","C","D").
   ════════════════════════════════════════════════════════════════════ */
export function filtrarPorClase(an, clase) {
  if (!clase || clase === "TODAS") return an
  const items = an.items.filter((x) => x.clase === clase)
  return { ...an, items, claseFiltro: clase }
}

/* ════════════════════════════════════════════════════════════════════
   13) PLAN DE TIENDA — Centro de mando del jefe de sucursal
   Responde las 3 preguntas operativas del jefe de tienda para SU local:
     1. ¿Qué pido a Maipú? (necesito + el CD tiene stock para ceder)
     2. ¿Qué solicito comprar? (necesito + Maipú NO puede surtir)
     3. ¿Qué liquido? (tengo stock parado o sobre-stock)
   Más un desglose por tipo de producto: dónde está el capital, qué
   categoría falla, cuál sobra.

   Trabaja sobre el análisis GLOBAL (necesita ver el stock de Maipú).
   `sucursal` debe ser una sucursal de venta (no el CD).
   ════════════════════════════════════════════════════════════════════ */
const CD_NOMBRE = "Maipu"

export function planTienda(an, sucursal) {
  if (!sucursal || sucursal === "TODAS" || sucursal === CD_NOMBRE) return null

  // Bodega satélite de esta sucursal (si existe)
  const bodega = Object.entries(BODEGA_PADRE).find(([, padre]) => padre === sucursal)?.[0] || null

  const traerDeBodega = []   // 1° prioridad: la bodega de la propia sucursal tiene
  const pedirAMaipu = []     // 2° prioridad: el CD tiene
  const solicitarCompra = [] // 3° prioridad: nadie tiene → comprar
  const liquidar = []

  for (const x of an.items) {
    const d = x.porSuc?.[sucursal]
    if (!d) continue
    const cd = x.porSuc?.[CD_NOMBRE]
    const bd = bodega ? x.porSuc?.[bodega] : null

    // ── NECESIDAD: la sucursal vende el producto y está en quiebre o bajo reorden ──
    const necesita = d.qtyVend > 0 && d.stockUnid <= (d.puntoReorden || 0)
    if (necesita) {
      const objetivo = d.objetivo || d.puntoReorden || 0
      const cantidad = Math.max(1, Math.round(objetivo - d.stockUnid))
      const margenMes = (d.vtaDia || 0) * 30 * (x.margenPct || 0)
      const ventaMes = (d.vtaDia || 0) * 30 * (d.qtyVend > 0 ? d.netoVend / d.qtyVend : 0)

      const base = {
        sku: x.sku, producto: x.producto, tipo: x.tipo, clase: x.clase,
        estado: d.estado === "Quiebre" ? "Quiebre" : "Bajo reorden",
        stockActual: d.stockUnid, puntoReorden: d.puntoReorden || 0,
        vtaDia: +(d.vtaDia || 0).toFixed(1), margenMes, ventaMes,
        costoU: x.costoU || 0, necesita: cantidad,
      }

      let restante = cantidad

      // ── PASO 1: ¿La bodega satélite tiene? Es lo más rápido y barato ──
      if (bd && bd.stockUnid > 0 && restante > 0) {
        const traer = Math.min(restante, bd.stockUnid)
        traerDeBodega.push({ ...base, traer, stockBodega: bd.stockUnid, bodegaNombre: bodega })
        restante -= traer
      }

      // ── PASO 2: ¿Maipú puede cubrir el resto? ──
      const reservaCD = Math.round(cd?.puntoReorden || 0)
      const dispCD = cd ? Math.max(0, cd.stockUnid - reservaCD) : 0

      if (restante > 0 && dispCD > 0) {
        const transferir = Math.min(restante, dispCD)
        pedirAMaipu.push({ ...base, transferir, stockCD: cd.stockUnid, necesita: restante })
        restante -= transferir
      }

      // ── PASO 3: lo que no se pudo resolver → comprar ──
      if (restante > 0) {
        const motivo = bd && bd.stockUnid > 0 && cd && cd.stockUnid > 0
          ? "Tu bodega y Maipú no cubren todo"
          : cd && cd.stockUnid > 0
            ? "Maipú debe reservar su stock"
            : (cd && cd.stockUnid === 0) ? "Maipú sin stock" : "Sin stock en la red"
        solicitarCompra.push({
          ...base, comprar: restante, stockCD: cd?.stockUnid || 0,
          stockBodega: bd?.stockUnid || 0, motivo,
        })
      }
    }

    // ── EXCESO: tiene stock pero no rota (dead stock o sobre-cobertura) ──
    const esExceso = d.stockUnid > 0 && (
      d.estado === "Dead stock" ||
      (d.qtyVend > 0 && d.cobertura > 180 && d.cobertura < 9999)
    )
    if (esExceso) {
      liquidar.push({
        sku: x.sku, producto: x.producto, tipo: x.tipo, clase: x.clase,
        stockActual: d.stockUnid, valorStock: d.stockValor,
        cobertura: Math.round(d.cobertura || 0),
        vtaDia: +(d.vtaDia || 0).toFixed(1),
        motivo: d.estado === "Dead stock"
          ? "Sin ventas en el período — capital congelado"
          : "Sobre-stock: más de 6 meses de cobertura",
      })
    }
  }

  // Ordenar por prioridad comercial
  const oc = { A: 0, B: 1, C: 2, D: 3 }
  traerDeBodega.sort((a, b) => oc[a.clase] - oc[b.clase] || b.margenMes - a.margenMes)
  pedirAMaipu.sort((a, b) => oc[a.clase] - oc[b.clase] || b.margenMes - a.margenMes)
  solicitarCompra.sort((a, b) => oc[a.clase] - oc[b.clase] || b.margenMes - a.margenMes)
  liquidar.sort((a, b) => b.valorStock - a.valorStock)

  // ── DESGLOSE POR TIPO DE PRODUCTO ──
  const tipos = {}
  for (const x of an.items) {
    const d = x.porSuc?.[sucursal]
    if (!d) continue
    const t = x.tipo || "Sin clasificar"
    if (!tipos[t]) tipos[t] = {
      tipo: t, valorStock: 0, nSku: 0, nConStock: 0, nVende: 0,
      nQuiebre: 0, nUrgente: 0, nExceso: 0, margenRiesgo: 0, valorExceso: 0, ventaTipo: 0,
    }
    const T = tipos[t]
    T.valorStock += d.stockValor
    T.ventaTipo += d.netoVend
    T.nSku++
    if (d.stockUnid > 0) T.nConStock++
    if (d.qtyVend > 0) T.nVende++
    if (d.estado === "Quiebre") T.nQuiebre++
    const nec = d.qtyVend > 0 && d.stockUnid <= (d.puntoReorden || 0)
    if (nec) { T.nUrgente++; T.margenRiesgo += (d.vtaDia || 0) * 30 * (x.margenPct || 0) }
    const exc = d.stockUnid > 0 && (d.estado === "Dead stock" || (d.qtyVend > 0 && d.cobertura > 180 && d.cobertura < 9999))
    if (exc) { T.nExceso++; T.valorExceso += d.stockValor }
  }
  const porTipo = Object.values(tipos).map((T) => {
    const quiebrePct = T.nVende ? T.nQuiebre / T.nVende : 0
    // veredicto por tipo
    let veredicto, vColor
    if (quiebrePct > 0.3 || T.nUrgente > T.nConStock * 0.4) { veredicto = "Falta stock"; vColor = "#FF3B30" }
    else if (T.valorExceso > T.valorStock * 0.4 && T.valorStock > 0) { veredicto = "Exceso / liquidar"; vColor = "#AF52DE" }
    else if (T.nUrgente > 0) { veredicto = "Reponer pronto"; vColor = "#FF9500" }
    else { veredicto = "Saludable"; vColor = "#34C759" }
    return { ...T, quiebrePct, veredicto, vColor }
  }).sort((a, b) => b.margenRiesgo - a.margenRiesgo || b.valorStock - a.valorStock)

  const resumen = {
    nTraer: traerDeBodega.length,
    unidadesTraer: traerDeBodega.reduce((s, t) => s + t.traer, 0),
    nPedir: pedirAMaipu.length,
    unidadesPedir: pedirAMaipu.reduce((s, t) => s + t.transferir, 0),
    valorPedir: pedirAMaipu.reduce((s, t) => s + t.transferir * t.costoU, 0),
    nComprar: solicitarCompra.length,
    unidadesComprar: solicitarCompra.reduce((s, t) => s + (t.comprar || 0), 0),
    inversionCompra: solicitarCompra.reduce((s, t) => s + (t.comprar || 0) * (t.costoU || 0), 0),
    nLiquidar: liquidar.length,
    capitalLiquidar: liquidar.reduce((s, t) => s + t.valorStock, 0),
    margenProtegido: traerDeBodega.reduce((s, t) => s + t.margenMes, 0) + pedirAMaipu.reduce((s, t) => s + t.margenMes, 0) + solicitarCompra.reduce((s, t) => s + t.margenMes, 0),
    tieneBodega: !!bodega,
    bodegaNombre: bodega,
  }

  return { sucursal, traerDeBodega, pedirAMaipu, solicitarCompra, liquidar, porTipo, resumen }
}

/* ════════════════════════════════════════════════════════════════════
   14) SIMULADOR DE STOCK IDEAL — proyección parametrizable por tienda
   El jefe de tienda define SUS parámetros comerciales y el motor
   proyecta el stock ideal por SKU, el gap contra el stock actual, la
   inversión necesaria y las oportunidades comerciales.

   params = {
     crecimiento: % de crecimiento de venta objetivo (ej: 15 = +15%)
     leadTime:    días que tarda en llegar la mercadería (null = usar por tipo)
     cobertura:   días de venta que quiere tener en góndola (null = por tipo)
     seguridad:   factor de colchón sobre la demanda (1.0 = sin colchón,
                  1.2 = +20% para picos / temporada)
   }
   ════════════════════════════════════════════════════════════════════ */
export function simuladorTienda(an, sucursal, params = {}) {
  if (!sucursal || sucursal === "TODAS" || sucursal === "Maipu") return null
  const crecimiento = (params.crecimiento ?? 0) / 100
  const factorSeg = params.seguridad ?? 1.0
  const dias = an.dias

  const items = []
  let ventaActualMes = 0, ventaProyectadaMes = 0, margenProyectadoMes = 0

  for (const x of an.items) {
    const d = x.porSuc?.[sucursal]
    if (!d || d.qtyVend <= 0) continue // solo SKU que la sucursal vende

    const P = paramTipo(x.tipo)
    const leadTime = params.leadTime ?? P.fab
    const cobertura = params.cobertura ?? P.cubrir

    // Demanda proyectada con la meta de crecimiento
    const vtaDiaProy = (d.vtaDia || 0) * (1 + crecimiento)
    const precioU = d.qtyVend > 0 ? d.netoVend / d.qtyVend : 0

    // Stock ideal = demanda proyectada × (lead time + cobertura) × factor seguridad
    const stockIdeal = Math.ceil(vtaDiaProy * (leadTime + cobertura) * factorSeg)
    const gap = stockIdeal - d.stockUnid
    const inversionGap = gap > 0 ? gap * (x.costoU || 0) : 0

    // Venta y margen mensual proyectados (si tiene el stock para sostenerla)
    const ventaMesProy = vtaDiaProy * 30 * precioU
    const margenMesProy = ventaMesProy * (x.margenPct || 0)
    const ventaMesActual = (d.vtaDia || 0) * 30 * precioU

    // Días de quiebre estimados si no repone (cuándo se le acaba)
    const diasHastaQuiebre = vtaDiaProy > 0 ? Math.floor(d.stockUnid / vtaDiaProy) : 999
    const quiebraAntesDeReponer = diasHastaQuiebre < leadTime

    ventaActualMes += ventaMesActual
    ventaProyectadaMes += ventaMesProy
    margenProyectadoMes += margenMesProy

    items.push({
      sku: x.sku, producto: x.producto, tipo: x.tipo, clase: x.clase,
      stockActual: d.stockUnid, stockIdeal, gap,
      inversionGap, vtaDia: +(d.vtaDia || 0).toFixed(1), vtaDiaProy: +vtaDiaProy.toFixed(1),
      diasHastaQuiebre, quiebraAntesDeReponer,
      ventaMesProy, margenMesProy, costoU: x.costoU || 0,
      leadTime, coberturaObjetivo: cobertura,
    })
  }

  // ── Necesidades: gap > 0, priorizadas por margen proyectado ──
  const oc = { A: 0, B: 1, C: 2, D: 3 }
  const necesidades = items.filter((i) => i.gap > 0)
    .sort((a, b) => oc[a.clase] - oc[b.clase] || b.margenMesProy - a.margenMesProy)

  // ── Riesgo inmediato: se quiebran antes de que llegue una reposición ──
  const riesgoInmediato = items.filter((i) => i.quiebraAntesDeReponer && i.stockActual > 0)
    .sort((a, b) => a.diasHastaQuiebre - b.diasHastaQuiebre)

  // ── OPORTUNIDADES COMERCIALES ──
  // 1. Top velocidad: lo que más se vende por día — protege y potencia
  const topVelocidad = [...items].sort((a, b) => b.vtaDia - a.vtaDia).slice(0, 10)
  // 2. Margen oculto: margen% alto (>p75) con stock disponible y venta moderada → empujar con exhibición
  const margenes = items.map((i) => i.margenMesProy / (i.ventaMesProy || 1)).sort((a, b) => a - b)
  const p75 = margenes[Math.floor(margenes.length * 0.75)] || 0
  const margenOculto = items.filter((i) => {
    const mPct = i.margenMesProy / (i.ventaMesProy || 1)
    return mPct >= p75 && i.stockActual > i.vtaDia * 14 && i.vtaDia > 0
  }).sort((a, b) => b.margenMesProy - a.margenMesProy).slice(0, 10)

  const resumen = {
    skusAnalizados: items.length,
    nNecesidades: necesidades.length,
    unidadesNecesarias: necesidades.reduce((s, i) => s + i.gap, 0),
    inversionTotal: necesidades.reduce((s, i) => s + i.inversionGap, 0),
    nRiesgoInmediato: riesgoInmediato.length,
    ventaActualMes, ventaProyectadaMes,
    ventaIncremental: ventaProyectadaMes - ventaActualMes,
    margenProyectadoMes,
  }

  return { sucursal, params: { crecimiento: crecimiento * 100, leadTime: params.leadTime, cobertura: params.cobertura, seguridad: factorSeg }, items, necesidades, riesgoInmediato, topVelocidad, margenOculto, resumen }
}

/* ════════════════════════════════════════════════════════════════════
   15) MÉTRICAS DE CENTRO DE DISTRIBUCIÓN (Maipú)
   Un CD no se mide como tienda: su trabajo es abastecer la red.
   · Cobertura de red: días que el stock del CD sostiene la demanda
     conjunta de las sucursales (stock CD activo / venta diaria de red)
   · Fill rate: % de la necesidad actual de las tiendas que el CD
     puede cubrir hoy con su stock
   · Inmovilizado: stock en el CD de productos que NADIE vende en la
     red — capital "acumulando polvo"
   ════════════════════════════════════════════════════════════════════ */
export function metricasCD(an) {
  const CD = "Maipu", DEST = ["La Granja", "Los Angeles"]
  let valorCD = 0, unidCD = 0, skusCD = 0
  let valorActivo = 0, stockActivoUnid = 0, demandaDiaRed = 0
  const inmovilizado = []

  for (const x of an.items) {
    const cd = x.porSuc?.[CD]
    if (!cd || cd.stockUnid <= 0) continue
    skusCD++; unidCD += cd.stockUnid; valorCD += cd.stockValor
    // demanda de red del SKU = venta diaria de las tiendas + la propia del CD
    const ventaRed = DEST.reduce((s, d) => s + (x.porSuc[d]?.vtaDia || 0), 0) + (cd.vtaDia || 0)
    if (ventaRed <= 0) {
      inmovilizado.push({
        sku: x.sku, producto: x.producto, tipo: x.tipo, clase: x.clase,
        stock: cd.stockUnid, valor: cd.stockValor,
      })
    } else {
      valorActivo += cd.stockValor
      stockActivoUnid += cd.stockUnid
      demandaDiaRed += ventaRed
    }
  }
  inmovilizado.sort((a, b) => b.valor - a.valor)

  // Fill rate: de lo que las tiendas necesitan HOY, cuánto puede surtir el CD
  let unidNecesarias = 0, unidCubribles = 0
  for (const suc of DEST) {
    const plan = planTienda(an, suc)
    if (!plan) continue
    unidCubribles += plan.resumen.unidadesPedir
    unidNecesarias += plan.resumen.unidadesPedir + plan.resumen.unidadesComprar
  }
  const fillRate = unidNecesarias > 0 ? unidCubribles / unidNecesarias : 1
  const coberturaRed = demandaDiaRed > 0 ? Math.round(stockActivoUnid / demandaDiaRed) : 999
  const valorInmovilizado = inmovilizado.reduce((s, i) => s + i.valor, 0)

  return {
    skusCD, unidCD, valorCD,
    coberturaRed, fillRate: +fillRate.toFixed(3),
    unidNecesarias, unidCubribles,
    inmovilizado, valorInmovilizado,
    nInmovilizado: inmovilizado.length,
    pctInmovilizado: valorCD > 0 ? valorInmovilizado / valorCD : 0,
    valorActivo,
  }
}
