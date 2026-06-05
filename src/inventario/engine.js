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

    // cobertura y rotación
    const cobertura = vtaDia > 0 ? stockUnid / vtaDia : (stockUnid > 0 ? 999 : 0)
    const rotAnual = stockUnid > 0 && qtyVend > 0 ? (qtyVend * (365 / dias)) / stockUnid : 0

    // estado
    let estado
    if (qtyVend > 0 && stockUnid === 0) estado = "Quiebre"
    else if (qtyVend > 0 && stockUnid <= puntoReorden) estado = "Reposicion"
    else if (qtyVend <= 0 && stockUnid > 0) estado = "Dead stock"
    else if (qtyVend <= 0 && stockUnid === 0) estado = "Sin movimiento"
    else estado = "Saludable"

    // costo de reposición estimado
    const costoU = s ? (s.porSuc.size ? [...s.porSuc.values()][0].costoU : 0) : 0
    const costoRepo = reposicion * costoU

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
      sku, producto, tipo, marca, clase, estado,
      qtyVend, netoVend, margenVend, margenPct,
      stockUnid, stockValor, porRecibir,
      vtaDia, vtaCompDia, vtaPromMes, factorComp,
      puntoReorden: Math.round(puntoReorden), reposicion, costoRepo,
      cobertura: Math.round(cobertura), rotAnual: +rotAnual.toFixed(2),
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
  }
}

export function kpisPorSucursal(analisis) {
  const out = {}
  SUCURSALES.forEach((sc) => {
    const items = analisis.items.map((x) => ({ ...x.porSuc[sc], clase: x.clase, sku: x.sku }))
    const valorInv = items.reduce((s, x) => s + x.stockValor, 0)
    const venta = items.reduce((s, x) => s + x.netoVend, 0)
    const quiebre = items.filter((x) => x.estado === "Quiebre").length
    const dead = items.filter((x) => x.estado === "Dead stock")
    const conStock = items.filter((x) => x.stockUnid > 0).length
    const vendidos = items.filter((x) => x.qtyVend > 0).length
    out[sc] = {
      valorInventario: valorInv, venta, quiebre, deadStock: dead.length,
      valorDeadStock: dead.reduce((s, x) => s + x.stockValor, 0),
      skusConStock: conStock, skusVendidos: vendidos,
      tasaQuiebre: vendidos ? quiebre / vendidos : 0,
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

  // A) Quiebres de clase A/B con venta alta → comprar YA
  const quiebreUrgente = it
    .filter((x) => x.estado === "Quiebre" && (x.clase === "A" || x.clase === "B"))
    .sort((a, b) => b.netoVend - a.netoVend)
  quiebreUrgente.slice(0, 30).forEach((x) => {
    const ventaMensualPerdida = x.netoVend / analisis.dias * 30
    acc.push({
      tipo: "COMPRAR_URGENTE", prioridad: 1, sku: x.sku, producto: x.producto,
      clase: x.clase, tipo_prod: x.tipo,
      detalle: `Quiebre clase ${x.clase}. Vendía ${Math.round(x.vtaDia)}/día. Reponer ${x.reposicion} u.`,
      impacto: ventaMensualPerdida, impactoLabel: "venta/mes en riesgo",
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

  acc.sort((a, b) => a.prioridad - b.prioridad || b.impacto - a.impacto)

  // Resumen ejecutivo
  const resumen = {
    comprarUrgente: acc.filter((a) => a.tipo === "COMPRAR_URGENTE"),
    riesgo: acc.filter((a) => a.tipo === "RIESGO_QUIEBRE"),
    liquidar: acc.filter((a) => a.tipo === "LIQUIDAR"),
    sobrestock: acc.filter((a) => a.tipo === "SOBRESTOCK"),
    rebalancear: acc.filter((a) => a.tipo === "REBALANCEAR"),
  }
  return { acciones: acc, resumen }
}
