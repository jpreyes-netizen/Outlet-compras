import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Pencil, Check, Search, X, Loader2, Download, Upload, Trash2, ArrowUp, ArrowDown, ArrowUpDown, Sparkles, Wand2, Filter } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabase'
import { RESPALDO_TIPOS, extraerRut, getCatalogPromise, invalidateCatalog, MESES_CORTOS, nombreMes, calcularScoreSugerencia } from './types'
import { ClasificarPanel } from './ClasificarPanel'
import { LoteModal } from './LoteModal'

const PRIMARY = '#1F4E79'

function formatCLP(n) {
  return '$' + Math.round(n).toLocaleString('es-CL')
}

const TH = {
  padding: '5px 7px', textAlign: 'left', fontSize: 10, fontWeight: 600,
  color: '#6B7280', letterSpacing: '0.03em', textTransform: 'uppercase',
  background: '#F9FAFB', whiteSpace: 'nowrap',
}
const TD = {
  padding: '2px 7px', fontSize: 11, color: '#374151',
  whiteSpace: 'nowrap', verticalAlign: 'middle',
  lineHeight: 1.1,
}

// ── Stop words para extracción de patrones (compartido entre carga y refresh) ──
// Incluye palabras vacías + terminaciones empresariales que no aportan especificidad
const STOP_PAT = new Set(['DE','DEL','LA','EL','LOS','LAS','Y','A','AL','EN','POR','PARA','CON','SIN','TRANSF','TRANSFERENCIA','PAGO','ABONO','CARGO','COMPRA','SPA','LTDA','SOCIEDAD','LIMITADA','LIMITADAS','EIRL','RUT','CHEQUE','RECIBIDO','OTRO','BANCO','CIA'])

function extraerPatronDesc(desc) {
  if (!desc) return null
  const limpia = desc.toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\d+/g, ' ')
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_PAT.has(w))
    .slice(0, 2)
  return limpia.length > 0 ? limpia.join(' ') : null
}

export function ClasificarTab() {
  const [cartolas, setCartolas] = useState([])
  const [cuentas, setCuentas] = useState([])
  const [subcuentas, setSubcuentas] = useState([])
  const [cecos, setCecos] = useState([])
  const [reglas, setReglas] = useState([])
  const [movs, setMovs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const [filtroCartola, setFiltroCartola] = useState('todas')
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [filtroDesde, setFiltroDesde] = useState('')
  const [filtroHasta, setFiltroHasta] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [soloPendientes, setSoloPendientes] = useState(false)
  const [filtroMesNominal, setFiltroMesNominal] = useState('todos')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)

  const [selected, setSelected] = useState(new Set())
  const [bulkMes, setBulkMes] = useState('')
  const [aplicandoMes, setAplicandoMes] = useState(false)

  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState(null)
  const [filtrosDesc, setFiltrosDesc] = useState(new Set())  // filtro tipo Excel descripción
  const [showFiltroDesc, setShowFiltroDesc] = useState(false)
  const [filtroSoloConSugerencia, setFiltroSoloConSugerencia] = useState(false)
  const [filtroSinPatron, setFiltroSinPatron] = useState(false)

  function toggleSort(key) {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc') }
    else if (sortDir === 'asc') setSortDir('desc')
    else if (sortDir === 'desc') { setSortKey(null); setSortDir(null) }
    else setSortDir('asc')
  }

  const [sugerencias, setSugerencias] = useState(new Map())
  const [patronesHistoricos, setPatronesHistoricos] = useState(new Map())  // patron -> {subcuenta_id, veces, total_consistencia}
  const [editing, setEditing] = useState(null)
  const [showLote, setShowLote] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [eliminando, setEliminando] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [mesStats, setMesStats] = useState({ clasif: 0, total: 0 })

  useEffect(() => {
    let cancel = false
    ;(async () => {
      const { data: sess } = await supabase.auth.getSession()
      const uid = sess.session?.user?.id
      if (!uid) return
      const { data } = await supabase.from('usuarios').select('rol').eq('id', uid).maybeSingle()
      if (!cancel) setIsAdmin(data?.rol === 'admin_sistema')
    })()
    return () => { cancel = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const cat = await getCatalogPromise(async () => {
          const [cm, sc, cc, rg] = await Promise.all([
            supabase.from('cuentas_madre').select('id, nombre, tipo, codigo').eq('activa', true).order('codigo', { ascending: true }),
            supabase.from('subcuentas').select('id, nombre, cuenta_madre_id'),
            supabase.from('centros_costo').select('id, nombre').order('nombre'),
            supabase.from('reglas_clasificacion').select('id, tipo_regla, patron, subcuenta_id, ceco_id, tipo_respaldo, aciertos'),
          ])
          return { cuentas: cm.data ?? [], subcuentas: sc.data ?? [], cecos: cc.data ?? [], reglas: rg.data ?? [] }
        })
        if (cancelled) return
        setCuentas(cat.cuentas); setSubcuentas(cat.subcuentas); setCecos(cat.cecos); setReglas(cat.reglas)
        const { data: ctData } = await supabase.from('cartolas').select('id, banco, cuenta').order('created_at', { ascending: false })
        if (!cancelled) setCartolas(ctData ?? [])

        // ── Patrones históricos: aprende de movimientos ya clasificados ──
        // Para cada par (2 primeras palabras significativas, subcuenta_id) cuenta cuántas veces aparece
        // y calcula consistencia: % de veces que ese patrón fue clasificado a esa subcuenta específica
        const { data: histRows } = await supabase
          .from('movimientos_bancarios')
          .select('descripcion, subcuenta_id, ceco_id, tipo_respaldo')
          .eq('estado', 'clasificado')
          .not('subcuenta_id', 'is', null)
          .limit(10000)

        // patronPorSub[patron][sub_id] = { ceco_id, tipo_respaldo, veces }
        const conteo = new Map()  // patron -> Map(sub_id -> { ceco_id, tipo_respaldo, veces })
        for (const row of histRows ?? []) {
          const pat = extraerPatronDesc(row.descripcion); if (!pat) continue
          if (!conteo.has(pat)) conteo.set(pat, new Map())
          const subs = conteo.get(pat)
          if (!subs.has(row.subcuenta_id)) subs.set(row.subcuenta_id, { ceco_id: row.ceco_id, tipo_respaldo: row.tipo_respaldo, veces: 0 })
          subs.get(row.subcuenta_id).veces += 1
        }

        // Para cada patrón, elegir la subcuenta más frecuente y calcular consistencia
        // CRITERIOS ESTRICTOS (evitar sugerencias mal aprendidas):
        //   1. El patrón debe tener al menos 2 palabras (descarta "ODIS", "GAS" sueltos)
        //   2. El patrón ganador debe tener consistencia ≥60% (no es ambiguo)
        //   3. El patrón debe tener ≥2 ocurrencias totales
        const patronesMap = new Map()
        for (const [pat, subs] of conteo) {
          // Filtro 1: patrón ambiguo si tiene <2 palabras
          if (pat.split(' ').filter(Boolean).length < 2) continue

          let mejor = null, totalVeces = 0
          for (const [subId, info] of subs) {
            totalVeces += info.veces
            if (!mejor || info.veces > mejor.veces) mejor = { subcuenta_id: subId, ...info }
          }
          if (!mejor || totalVeces < 2) continue

          const consistencia = mejor.veces / totalVeces

          // Filtro 2: si la subcuenta ganadora tiene <60% del total, el patrón es ambiguo → descartar
          if (consistencia < 0.6) continue

          patronesMap.set(pat, {
            subcuenta_id: mejor.subcuenta_id,
            ceco_id: mejor.ceco_id,
            tipo_respaldo: mejor.tipo_respaldo,
            veces: mejor.veces,
            total: totalVeces,
            consistencia,
          })
        }
        if (!cancelled) setPatronesHistoricos(patronesMap)
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Error cargando catálogos') }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        let q = supabase.from('movimientos_bancarios')
          .select('id, cartola_id, fecha, monto, saldo, tipo, descripcion, referencia, estado, subcuenta_id, ceco_id, tipo_respaldo, observaciones, mes_cartola, mes_nominal, clasif_ia', { count: 'exact' })
          .order('fecha', { ascending: false }).order('monto', { ascending: false })

        if (filtroCartola !== 'todas') q = q.eq('cartola_id', filtroCartola)
        const estado = soloPendientes ? 'pendiente' : filtroEstado
        if (estado !== 'todos') q = q.eq('estado', estado)
        if (filtroDesde) q = q.gte('fecha', filtroDesde)
        if (filtroHasta) q = q.lte('fecha', filtroHasta)
        if (filtroMesNominal !== 'todos') q = q.eq('mes_nominal', Number(filtroMesNominal))
        if (busqueda.trim()) {
          const raw = busqueda.trim()
          const safe = raw.replace(/[%,()]/g, ' ').replace(/\s+/g, ' ').trim()
          const numeric = raw.replace(/[.\s$]/g, '').replace(/,/g, '')
          if (/^\d+$/.test(numeric)) q = q.eq('monto', Number(numeric))
          else if (safe.length > 0) q = q.ilike('descripcion', `%${safe}%`)
        }

        const from = page * pageSize
        const { data, error, count } = await q.range(from, from + pageSize - 1)
        if (cancelled) return
        if (error) { toast.error('Error: ' + error.message); setMovs([]); setTotal(0); return }
        setMovs(data ?? []); setTotal(count ?? 0); setSelected(new Set())
      } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [filtroCartola, filtroEstado, filtroDesde, filtroHasta, busqueda, soloPendientes, filtroMesNominal, page, pageSize, reloadKey])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const ahora = new Date()
      const desde = `${ahora.getFullYear()}-${String(ahora.getMonth()+1).padStart(2,'0')}-01`
      const fin = new Date(ahora.getFullYear(), ahora.getMonth()+1, 0)
      const hasta = `${fin.getFullYear()}-${String(fin.getMonth()+1).padStart(2,'0')}-${String(fin.getDate()).padStart(2,'0')}`
      const [{ count: tot }, { count: cl }] = await Promise.all([
        supabase.from('movimientos_bancarios').select('*', { count: 'exact', head: true }).gte('fecha', desde).lte('fecha', hasta),
        supabase.from('movimientos_bancarios').select('*', { count: 'exact', head: true }).gte('fecha', desde).lte('fecha', hasta).neq('estado', 'pendiente'),
      ])
      if (!cancelled) setMesStats({ clasif: cl ?? 0, total: tot ?? 0 })
    })()
    return () => { cancelled = true }
  }, [reloadKey])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const pendientes = movs.filter(m => m.estado === 'pendiente')
      if (pendientes.length === 0) { setSugerencias(new Map()); return }
      const rutPorMov = new Map()
      for (const m of pendientes) { const r = extraerRut(m.descripcion); rutPorMov.set(m.id, r) }

      const subById = new Map(subcuentas.map(s => [s.id, s]))

      const sug = new Map()
      for (const m of pendientes) {
        const rut = rutPorMov.get(m.id) ?? null; let found = null

        // FUENTE 1: reglas_clasificacion explícitas (por RUT, descripción, etc.)
        {
          const desc = m.descripcion.toUpperCase(); const palabras = desc.split(/\s+/).filter(Boolean)
          for (const r of reglas) {
            if (!r.subcuenta_id || !subById.has(r.subcuenta_id)) continue
            const patron = (r.patron ?? '').toUpperCase().trim(); if (!patron) continue
            let match = false
            if (r.tipo_regla === 'descripcion_exacta') match = desc === patron
            else if (r.tipo_regla === 'descripcion_contiene') match = desc.includes(patron)
            else if (r.tipo_regla === 'palabra_clave') { const escaped = patron.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); match = new RegExp(`(^|\\W)${escaped}(\\W|$)`,'i').test(desc) || palabras.includes(patron) }
            else if (r.tipo_regla === 'rut') match = !!rut && rut.toUpperCase() === patron
            if (match) { found = { subcuenta_id: r.subcuenta_id, subcuenta_nombre: subById.get(r.subcuenta_id).nombre, ceco_id: r.ceco_id, tipo_respaldo: r.tipo_respaldo, fuente: 'regla', regla_id: r.id, rut_extraido: rut, tipo_regla: r.tipo_regla, aciertos: r.aciertos ?? 0 }; break }
          }
        }

        // FUENTE 2: patrón histórico aprendido de movimientos clasificados
        if (!found) {
          const pat = extraerPatronDesc(m.descripcion)
          if (pat && patronesHistoricos.has(pat)) {
            const ph = patronesHistoricos.get(pat)
            if (subById.has(ph.subcuenta_id)) {
              found = {
                subcuenta_id: ph.subcuenta_id,
                subcuenta_nombre: subById.get(ph.subcuenta_id).nombre,
                ceco_id: ph.ceco_id,
                tipo_respaldo: ph.tipo_respaldo,
                fuente: 'patron_historico',
                regla_id: null,
                rut_extraido: rut,
                tipo_regla: null,
                aciertos: ph.veces,
                patron_match: pat,
                consistencia: ph.consistencia,
              }
            }
          }
        }

        if (found) {
          const { score, nivel, razon } = calcularScoreSugerencia(found)
          found.score = score; found.nivel = nivel; found.razon = razon
          sug.set(m.id, found)
        }
      }
      if (!cancelled) setSugerencias(sug)
    })()
    return () => { cancelled = true }
  }, [movs, reglas, subcuentas, patronesHistoricos])

  const refresh = useCallback(() => setReloadKey(k => k + 1), [])

  // ── Aprende un patrón en caliente después de clasificar (sin re-fetch a BD) ──
  // Actualiza el Map de patronesHistoricos para reflejar la nueva clasificación inmediatamente
  function aprenderPatron(descripcion, subcuenta_id, ceco_id, tipo_respaldo) {
    const pat = extraerPatronDesc(descripcion)
    if (!pat) return
    setPatronesHistoricos(prev => {
      const next = new Map(prev)
      const existente = next.get(pat)
      if (!existente) {
        // Patrón nuevo: 1 vez, consistencia 100%
        next.set(pat, { subcuenta_id, ceco_id, tipo_respaldo, veces: 1, total: 1, consistencia: 1 })
      } else if (existente.subcuenta_id === subcuenta_id) {
        // Refuerza el patrón existente (misma subcuenta): +1 acierto
        const veces = existente.veces + 1
        const total = existente.total + 1
        next.set(pat, { ...existente, veces, total, consistencia: veces / total })
      } else {
        // Patrón existe pero usuario eligió otra subcuenta: bajar consistencia, no cambiar subcuenta ganadora
        // Si esta nueva subcuenta empieza a aparecer más, eventualmente la reemplazará
        const total = existente.total + 1
        next.set(pat, { ...existente, total, consistencia: existente.veces / total })
      }
      return next
    })
  }

  async function aceptarSugerencia(m) {
    const s = sugerencias.get(m.id); if (!s) return
    const { data: sess } = await supabase.auth.getSession()
    const userId = sess.session?.user?.id ?? null
    const { error } = await supabase.from('movimientos_bancarios').update({ subcuenta_id: s.subcuenta_id, ceco_id: s.ceco_id, tipo_respaldo: s.tipo_respaldo, estado: 'clasificado', clasif_ia: true, clasificado_por: userId, clasificado_at: new Date().toISOString() }).eq('id', m.id)
    if (error) { toast.error('Error: ' + error.message); return }
    if (s.regla_id) { const r = reglas.find(x => x.id === s.regla_id); await supabase.from('reglas_clasificacion').update({ aciertos: (r?.aciertos ?? 0) + 1 }).eq('id', s.regla_id) }
    aprenderPatron(m.descripcion, s.subcuenta_id, s.ceco_id, s.tipo_respaldo)
    toast.success('Sugerencia aplicada'); refresh()
  }

  // Auto-clasificar masivamente: aplica todas las sugerencias con score >= umbral
  const [autoClasifLoading, setAutoClasifLoading] = useState(false)
  async function autoClasificarMasivo(umbral = 85) {
    const candidatos = []
    for (const m of movs) {
      if (m.estado !== 'pendiente') continue
      const s = sugerencias.get(m.id)
      if (s && s.score >= umbral) candidatos.push({ mov: m, sug: s })
    }
    if (candidatos.length === 0) {
      toast.info('No hay sugerencias con score ≥' + umbral + '% para aplicar')
      return
    }
    if (!window.confirm(`¿Aplicar ${candidatos.length} sugerencias automáticamente?\n(Solo movimientos con confianza ≥${umbral}%)`)) return

    setAutoClasifLoading(true)
    const toastId = toast.loading(`Aplicando ${candidatos.length} sugerencias…`)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const userId = sess.session?.user?.id ?? null
      const ahora = new Date().toISOString()
      let ok = 0, err = 0

      // Lotes de 10 con Promise.all
      for (let i = 0; i < candidatos.length; i += 10) {
        const lote = candidatos.slice(i, i + 10)
        const results = await Promise.all(lote.map(({ mov, sug }) =>
          supabase.from('movimientos_bancarios').update({
            subcuenta_id: sug.subcuenta_id,
            ceco_id: sug.ceco_id,
            tipo_respaldo: sug.tipo_respaldo,
            estado: 'clasificado',
            clasif_ia: true,
            clasificado_por: userId,
            clasificado_at: ahora,
          }).eq('id', mov.id)
        ))
        for (let j = 0; j < results.length; j++) {
          if (results[j].error) err++
          else {
            ok++
            // Aprender patrón en caliente
            aprenderPatron(lote[j].mov.descripcion, lote[j].sug.subcuenta_id, lote[j].sug.ceco_id, lote[j].sug.tipo_respaldo)
          }
        }
      }

      // Incrementar aciertos de las reglas usadas
      const reglasUsadas = new Map()
      for (const { sug } of candidatos) {
        if (sug.regla_id) reglasUsadas.set(sug.regla_id, (reglasUsadas.get(sug.regla_id) ?? 0) + 1)
      }
      for (const [regla_id, inc] of reglasUsadas) {
        const r = reglas.find(x => x.id === regla_id)
        if (r) await supabase.from('reglas_clasificacion').update({ aciertos: (r.aciertos ?? 0) + inc }).eq('id', regla_id)
      }

      toast.success(`✓ ${ok} clasificados automáticamente${err > 0 ? ` · ${err} con error` : ''}`, { id: toastId })
      invalidateCatalog()
      refresh()
    } catch (e) {
      toast.error('Error: ' + (e instanceof Error ? e.message : '?'), { id: toastId })
    } finally { setAutoClasifLoading(false) }
  }

  // Estadísticas de sugerencias para el botón
  const statsSugerencias = useMemo(() => {
    let alto = 0, medio = 0, bajo = 0, total = 0
    for (const m of movs) {
      if (m.estado !== 'pendiente') continue
      const s = sugerencias.get(m.id)
      if (!s) continue
      total++
      if (s.score >= 85) alto++
      else if (s.score >= 65) medio++
      else bajo++
    }
    return { alto, medio, bajo, total }
  }, [movs, sugerencias])

  // Agrupar sugerencias por patrón (para clasificación por patrón individual)
  const sugerenciasPorPatron = useMemo(() => {
    const grupos = new Map()  // patron+subId -> { patron, subcuenta_nombre, subcuenta_id, score, movs: [] }
    for (const m of movs) {
      if (m.estado !== 'pendiente') continue
      const s = sugerencias.get(m.id)
      if (!s || !s.patron_match) continue  // solo agrupa los de patron_historico
      const key = s.patron_match + '||' + s.subcuenta_id
      if (!grupos.has(key)) {
        grupos.set(key, {
          key,
          patron: s.patron_match,
          subcuenta_id: s.subcuenta_id,
          subcuenta_nombre: s.subcuenta_nombre,
          ceco_id: s.ceco_id,
          tipo_respaldo: s.tipo_respaldo,
          score: s.score,
          nivel: s.nivel,
          consistencia: s.consistencia,
          movs: [],
        })
      }
      grupos.get(key).movs.push(m)
    }
    return Array.from(grupos.values()).sort((a, b) => b.movs.length - a.movs.length)
  }, [movs, sugerencias])

  // Auto-clasificar un patrón específico (todos sus movimientos)
  const [showPanelPatrones, setShowPanelPatrones] = useState(false)
  async function clasificarPorPatron(grupo) {
    if (!grupo.movs.length) return
    if (!window.confirm(`¿Clasificar ${grupo.movs.length} movimientos del patrón "${grupo.patron}" como "${grupo.subcuenta_nombre}"?`)) return
    setAutoClasifLoading(true)
    const toastId = toast.loading(`Clasificando ${grupo.movs.length}…`)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const userId = sess.session?.user?.id ?? null
      const ahora = new Date().toISOString()
      let ok = 0, err = 0
      for (let i = 0; i < grupo.movs.length; i += 10) {
        const lote = grupo.movs.slice(i, i + 10)
        const results = await Promise.all(lote.map(mov =>
          supabase.from('movimientos_bancarios').update({
            subcuenta_id: grupo.subcuenta_id,
            ceco_id: grupo.ceco_id,
            tipo_respaldo: grupo.tipo_respaldo,
            estado: 'clasificado',
            clasif_ia: true,
            clasificado_por: userId,
            clasificado_at: ahora,
          }).eq('id', mov.id)
        ))
        for (let j = 0; j < results.length; j++) {
          if (results[j].error) err++
          else {
            ok++
            aprenderPatron(lote[j].descripcion, grupo.subcuenta_id, grupo.ceco_id, grupo.tipo_respaldo)
          }
        }
      }
      toast.success(`✓ ${ok} clasificados${err > 0 ? ` · ${err} con error` : ''}`, { id: toastId })
      invalidateCatalog()
      refresh()
    } catch (e) {
      toast.error('Error: ' + (e instanceof Error ? e.message : '?'), { id: toastId })
    } finally { setAutoClasifLoading(false) }
  }

  async function actualizarMesNominal(movId, mes) {
    setMovs(prev => prev.map(x => x.id === movId ? { ...x, mes_nominal: mes } : x))
    const { error } = await supabase.from('movimientos_bancarios').update({ mes_nominal: mes }).eq('id', movId)
    if (error) { toast.error('No se pudo actualizar: ' + error.message); refresh() }
    else toast.success(`Mes nominal: ${nombreMes(mes)}`)
  }

  async function aplicarMesMasivo() {
    if (!bulkMes) { toast.warning('Selecciona un mes nominal'); return }
    const mes = Number(bulkMes); const ids = Array.from(selected); if (ids.length === 0) return
    setAplicandoMes(true)
    const { error } = await supabase.from('movimientos_bancarios').update({ mes_nominal: mes }).in('id', ids)
    setAplicandoMes(false)
    if (error) { toast.error('Error: ' + error.message); return }
    setMovs(prev => prev.map(x => ids.includes(x.id) ? { ...x, mes_nominal: mes } : x))
    setBulkMes(''); toast.success(`Mes nominal actualizado en ${ids.length} registros`)
  }

  const subById = useMemo(() => new Map(subcuentas.map(s => [s.id, s])), [subcuentas])

  const displayMovs = useMemo(() => {
    let arr = [...movs]
    // Filtro Excel descripción — normaliza igual que FiltroDescripcion al generar patrones
    if (filtrosDesc.size > 0) {
      const normDesc = s => (s ?? '').toUpperCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\d+/g, ' ')
        .replace(/[^A-Z\s]/g, ' ')
        .replace(/\s+/g, ' ').trim()
      arr = arr.filter(m => {
        const desc = normDesc(m.descripcion)
        for (const pat of filtrosDesc) {
          if (desc.includes(pat)) return true
        }
        return false
      })
    }
    // Filtro solo con sugerencia IA
    if (filtroSoloConSugerencia) {
      arr = arr.filter(m => sugerencias.has(m.id))
    }
    // Filtro "sin patrón detectado" (pendientes sin sugerencia IA — requieren clasificación manual)
    if (filtroSinPatron) {
      arr = arr.filter(m => m.estado === 'pendiente' && !sugerencias.has(m.id))
    }
    if (!sortKey || !sortDir) return arr
    const dir = sortDir === 'asc' ? 1 : -1
    const cmpStr = (a, b) => (a ?? '').localeCompare(b ?? '', 'es', { sensitivity: 'base' })
    arr.sort((a, b) => {
      if (sortKey === 'fecha') return (new Date(a.fecha).getTime() - new Date(b.fecha).getTime()) * dir
      if (sortKey === 'tipo') return cmpStr(a.tipo, b.tipo) * dir
      if (sortKey === 'monto') return (Math.abs(Number(a.monto)) - Math.abs(Number(b.monto))) * dir
      if (sortKey === 'descripcion') return cmpStr(a.descripcion, b.descripcion) * dir
      if (sortKey === 'mes_cartola') return ((a.mes_cartola ?? 0) - (b.mes_cartola ?? 0)) * dir
      if (sortKey === 'mes_nominal') return ((a.mes_nominal ?? 0) - (b.mes_nominal ?? 0)) * dir
      if (sortKey === 'clasificacion') {
        const an = a.subcuenta_id ? subById.get(a.subcuenta_id)?.nombre ?? null : null
        const bn = b.subcuenta_id ? subById.get(b.subcuenta_id)?.nombre ?? null : null
        if (!an && !bn) return 0; if (!an) return 1; if (!bn) return -1
        return cmpStr(an, bn) * dir
      }
      return 0
    })
    return arr
  }, [movs, sortKey, sortDir, subById, filtrosDesc, filtroSoloConSugerencia, filtroSinPatron, sugerencias])

  const allChecked = displayMovs.length > 0 && displayMovs.every(m => selected.has(m.id))
  function toggleAll() { if (allChecked) { const next = new Set(selected); displayMovs.forEach(m => next.delete(m.id)); setSelected(next) } else { const next = new Set(selected); displayMovs.forEach(m => next.add(m.id)); setSelected(next) } }
  function toggleOne(id) { setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next }) }

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const pct = mesStats.total === 0 ? 0 : Math.round((mesStats.clasif / mesStats.total) * 100)

  const fileInputRef = useRef(null)
  const [importing, setImporting] = useState(false)

  async function descargarPlantilla() {
    try {
      const { data, error } = await supabase.from('movimientos_bancarios').select('id, descripcion, fecha, monto, tipo, subcuenta_id').is('subcuenta_id', null).order('fecha', { ascending: false }).limit(5000)
      if (error) throw error
      const rows = (data ?? []).map(m => ({ id: m.id, descripcion: m.descripcion, fecha: m.fecha, monto: m.monto, tipo: m.tipo, subcuenta_actual: m.subcuenta_id ? subById.get(m.subcuenta_id)?.nombre ?? '' : '', subcuenta_id_nuevo: '', ceco_id_nuevo: '' }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header: ['id','descripcion','fecha','monto','tipo','subcuenta_actual','subcuenta_id_nuevo','ceco_id_nuevo'] }), 'Movimientos')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(subcuentas.map(s => ({ subcuenta_id: s.id, nombre: s.nombre }))), 'ref_subcuentas')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cecos.map(c => ({ ceco_id: c.id, nombre: c.nombre }))), 'ref_centros_costo')
      XLSX.writeFile(wb, `plantilla_clasificacion_${Date.now()}.xlsx`)
      toast.success(`Plantilla descargada con ${rows.length} movimientos`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error') }
  }

  async function cargarClasificacion(file) {
    setImporting(true)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      const validas = rows.filter(r => String(r.id ?? '').trim().length > 0 && String(r.subcuenta_id_nuevo ?? '').trim().length > 0)
      if (validas.length === 0) { toast.warning('No hay filas válidas'); return }
      const { data: sess } = await supabase.auth.getSession(); const userId = sess.session?.user?.id ?? null
      const ahora = new Date().toISOString(); let ok = 0, fail = 0
      for (let i = 0; i < validas.length; i += 10) {
        const results = await Promise.all(validas.slice(i, i+10).map(r => supabase.from('movimientos_bancarios').update({ subcuenta_id: String(r.subcuenta_id_nuevo).trim(), ceco_id: String(r.ceco_id_nuevo ?? '').trim() || null, estado: 'clasificado', clasificado_por: userId, clasificado_at: ahora }).eq('id', String(r.id).trim())))
        for (const r of results) { if (r.error) fail++; else ok++ }
      }
      if (fail > 0) toast.warning(`${ok} actualizados, ${fail} con error`)
      else toast.success(`${ok} movimientos actualizados`)
      invalidateCatalog(); refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error') }
    finally { setImporting(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }

  const inputSt = { padding: '6px 10px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 12, background: '#fff', outline: 'none' }
  const selectSt = { padding: '6px 10px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 12, background: '#fff' }

  // Acepta sugerencias IA de todos los movimientos seleccionados que tienen sugerencia
  async function aceptarSugerenciasSeleccionadas() {
    const candidatos = []
    for (const id of selected) {
      const m = movs.find(x => x.id === id)
      const s = sugerencias.get(id)
      if (m && s && m.estado === 'pendiente') candidatos.push({ m, s })
    }
    if (candidatos.length === 0) { toast.info('Ningún movimiento seleccionado tiene sugerencia IA'); return }
    if (!window.confirm(`¿Aceptar sugerencias IA para ${candidatos.length} movimiento${candidatos.length > 1 ? 's' : ''}?\n\nSe clasificarán automáticamente según la sugerencia de cada uno.`)) return
    setAutoClasifLoading(true)
    const toastId = toast.loading(`Clasificando ${candidatos.length}…`)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const userId = sess.session?.user?.id ?? null
      const ahora = new Date().toISOString()
      let ok = 0, err = 0
      for (let i = 0; i < candidatos.length; i += 10) {
        const lote = candidatos.slice(i, i + 10)
        const results = await Promise.all(lote.map(({ m, s }) =>
          supabase.from('movimientos_bancarios').update({
            subcuenta_id: s.subcuenta_id,
            ceco_id: s.ceco_id,
            tipo_respaldo: s.tipo_respaldo,
            estado: 'clasificado',
            clasif_ia: true,
            clasificado_por: userId,
            clasificado_at: ahora,
          }).eq('id', m.id)
        ))
        for (let j = 0; j < results.length; j++) {
          if (results[j].error) err++
          else {
            ok++
            aprenderPatron(lote[j].m.descripcion, lote[j].s.subcuenta_id, lote[j].s.ceco_id, lote[j].s.tipo_respaldo)
          }
        }
      }
      // Incrementar aciertos de reglas usadas
      const reglasUsadas = new Map()
      for (const { s } of candidatos) {
        if (s.regla_id) reglasUsadas.set(s.regla_id, (reglasUsadas.get(s.regla_id) ?? 0) + 1)
      }
      for (const [regla_id, inc] of reglasUsadas) {
        const r = reglas.find(x => x.id === regla_id)
        if (r) await supabase.from('reglas_clasificacion').update({ aciertos: (r.aciertos ?? 0) + inc }).eq('id', regla_id)
      }
      toast.success(`✓ ${ok} sugerencias aceptadas${err > 0 ? ` · ${err} con error` : ''}`, { id: toastId })
      setSelected(new Set())
      invalidateCatalog()
      refresh()
    } catch (e) {
      toast.error('Error: ' + (e instanceof Error ? e.message : '?'), { id: toastId })
    } finally { setAutoClasifLoading(false) }
  }

  const selectedConSugerencia = useMemo(() =>
    Array.from(selected).filter(id => sugerencias.has(id) && movs.find(m => m.id === id)?.estado === 'pendiente').length
  , [selected, sugerencias, movs])


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* HEADER */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>Clasificar movimientos</div>
            <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{mesStats.clasif} de {mesStats.total} clasificados este mes</div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: PRIMARY }}>{pct}%</div>
        </div>
        <div style={{ marginTop: 10, height: 6, background: '#F3F4F6', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: PRIMARY, borderRadius: 99, transition: 'width 0.4s ease' }} />
        </div>
      </div>

      {/* BANNER ASISTENTE IA */}
      {statsSugerencias.total > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, #EEF2FF, #E0E7FF)',
          border: '1px solid #C7D2FE',
          borderRadius: 12,
          padding: '14px 18px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ background: 'linear-gradient(135deg, #6366F1, #4F46E5)', borderRadius: 10, padding: 10, display: 'flex' }}>
              <Sparkles size={20} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#312E81', marginBottom: 2 }}>
                Asistente IA detectó {statsSugerencias.total} sugerencias
              </div>
              <div style={{ fontSize: 11, color: '#4338CA', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <span><strong style={{ color: '#065F46' }}>{statsSugerencias.alto}</strong> confianza alta (≥85%)</span>
                <span>·</span>
                <span><strong style={{ color: '#92400E' }}>{statsSugerencias.medio}</strong> confianza media (65–84%)</span>
                <span>·</span>
                <span><strong style={{ color: '#991B1B' }}>{statsSugerencias.bajo}</strong> confianza baja</span>
                <button
                  onClick={() => { setSoloPendientes(true); setFiltroSoloConSugerencia(true); setPage(0) }}
                  style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: '1px solid #818CF8', background: filtroSoloConSugerencia ? '#818CF8' : 'transparent', color: filtroSoloConSugerencia ? '#fff' : '#4338CA', cursor: 'pointer', fontWeight: 600 }}>
                  {filtroSoloConSugerencia ? '✓ Viendo sugerencias' : 'Ver sugerencias →'}
                </button>
                {sugerenciasPorPatron.length > 0 && (
                  <button
                    onClick={() => setShowPanelPatrones(v => !v)}
                    style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: '1px solid #818CF8', background: showPanelPatrones ? '#818CF8' : 'transparent', color: showPanelPatrones ? '#fff' : '#4338CA', cursor: 'pointer', fontWeight: 600 }}>
                    {showPanelPatrones ? '✓ Patrones abiertos' : `🔍 ${sugerenciasPorPatron.length} patrones detectados`}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {statsSugerencias.alto === 0 && statsSugerencias.medio > 0 && (
              <button
                onClick={() => autoClasificarMasivo(65)}
                disabled={autoClasifLoading}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 8, border: 'none',
                  background: 'linear-gradient(135deg, #D97706, #B45309)',
                  color: '#fff', fontSize: 12, fontWeight: 600,
                  cursor: autoClasifLoading ? 'not-allowed' : 'pointer',
                  opacity: autoClasifLoading ? 0.6 : 1,
                }}>
                {autoClasifLoading ? <Loader2 size={14} /> : <Wand2 size={14} />}
                Auto-clasificar {statsSugerencias.medio} con score ≥65%
              </button>
            )}
            <button
              onClick={() => autoClasificarMasivo(85)}
              disabled={autoClasifLoading || statsSugerencias.alto === 0}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', borderRadius: 8, border: 'none',
                background: statsSugerencias.alto > 0 ? 'linear-gradient(135deg, #10B981, #059669)' : '#9CA3AF',
                color: '#fff', fontSize: 12, fontWeight: 600,
                cursor: autoClasifLoading || statsSugerencias.alto === 0 ? 'not-allowed' : 'pointer',
                opacity: autoClasifLoading ? 0.6 : 1,
              }}>
              {autoClasifLoading ? <Loader2 size={14} /> : <Wand2 size={14} />}
              {statsSugerencias.alto > 0 ? `Auto-clasificar ${statsSugerencias.alto} con score ≥85%` : `0 de alta confianza`}
            </button>
          </div>
        </div>
      )}

      {/* PANEL PATRONES DETECTADOS */}
      {showPanelPatrones && sugerenciasPorPatron.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #C7D2FE' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#312E81' }}>
                🔍 Patrones detectados ({sugerenciasPorPatron.length})
              </div>
              <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                Cada patrón agrupa movimientos similares ya clasificados antes. Click en "Aplicar" para clasificar todos en bulk.
              </div>
            </div>
            <button onClick={() => setShowPanelPatrones(false)}
              style={{ width: 24, height: 24, borderRadius: 4, border: 'none', background: '#F3F4F6', color: '#6B7280', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={13} />
            </button>
          </div>
          <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sugerenciasPorPatron.map(g => {
              const colorNivel = g.nivel === 'alto' ? '#16A34A' : g.nivel === 'medio' ? '#D97706' : '#9CA3AF'
              return (
                <div key={g.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 6, background: '#F9FAFB', border: '1px solid #F1F5F9' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 10, fontFamily: 'monospace', padding: '1px 5px', borderRadius: 3, background: '#EEF2FF', color: '#4338CA', fontWeight: 700 }}>
                        {g.patron}
                      </span>
                      <span style={{ fontSize: 11, color: '#374151' }}>→</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#1F4E79' }}>{g.subcuenta_nombre}</span>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 99, background: '#F1F5F9', color: colorNivel, fontFamily: 'monospace' }}>
                        {g.score}%
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: '#6B7280' }}>
                      {g.movs.length} movimiento{g.movs.length > 1 ? 's' : ''} pendiente{g.movs.length > 1 ? 's' : ''}
                      {g.consistencia != null && ` · ${Math.round(g.consistencia * 100)}% consistencia histórica`}
                    </div>
                  </div>
                  <button
                    onClick={() => clasificarPorPatron(g)}
                    disabled={autoClasifLoading}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '5px 10px', borderRadius: 5, border: 'none',
                      background: g.nivel === 'alto' ? '#10B981' : g.nivel === 'medio' ? '#D97706' : '#6B7280',
                      color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      opacity: autoClasifLoading ? 0.5 : 1, flexShrink: 0,
                    }}>
                    <Wand2 size={11} /> Aplicar {g.movs.length}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* FILTROS */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: 11, color: '#6B7280' }}>Cartola</label>
            <select style={selectSt} value={filtroCartola} onChange={e => { setPage(0); setFiltroCartola(e.target.value) }}>
              <option value="todas">Todas</option>
              {cartolas.map(c => <option key={c.id} value={c.id}>{c.banco} — {c.cuenta}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: 11, color: '#6B7280' }}>Estado</label>
            <select style={selectSt} value={filtroEstado} disabled={soloPendientes} onChange={e => { setPage(0); setFiltroEstado(e.target.value) }}>
              <option value="todos">Todos</option>
              <option value="pendiente">Pendientes</option>
              <option value="clasificado">Clasificados</option>
              <option value="conciliado">Conciliados</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: 11, color: '#6B7280' }}>Desde</label>
            <input type="date" style={inputSt} value={filtroDesde} onChange={e => { setPage(0); setFiltroDesde(e.target.value) }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: 11, color: '#6B7280' }}>Hasta</label>
            <input type="date" style={inputSt} value={filtroHasta} onChange={e => { setPage(0); setFiltroHasta(e.target.value) }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 180 }}>
            <label style={{ fontSize: 11, color: '#6B7280' }}>Buscar</label>
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
              <input type="text" placeholder="Descripción o monto…" style={{ ...inputSt, paddingLeft: 26, width: '100%', boxSizing: 'border-box' }} value={busqueda} onChange={e => { setPage(0); setBusqueda(e.target.value) }} />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: 11, color: '#6B7280' }}>Mes nominal</label>
            <select style={selectSt} value={filtroMesNominal} onChange={e => { setPage(0); setFiltroMesNominal(e.target.value) }}>
              <option value="todos">Todos</option>
              {MESES_CORTOS.map((m, i) => <option key={i+1} value={String(i+1)}>{i+1} — {m}</option>)}
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151', cursor: 'pointer' }}>
            <input type="checkbox" checked={soloPendientes} onChange={e => { setPage(0); setSoloPendientes(e.target.checked); if (!e.target.checked) setFiltroSoloConSugerencia(false) }} />
            Solo sin clasificar
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: filtroSoloConSugerencia ? '#4338CA' : '#374151' }}>
            <input type="checkbox" checked={filtroSoloConSugerencia} onChange={e => { setPage(0); setFiltroSoloConSugerencia(e.target.checked); if (e.target.checked) { setSoloPendientes(true); setFiltroSinPatron(false) } }} />
            <Sparkles size={11} color={filtroSoloConSugerencia ? '#6366F1' : '#9CA3AF'} />
            Con sugerencia IA
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: filtroSinPatron ? '#B45309' : '#374151' }}>
            <input type="checkbox" checked={filtroSinPatron} onChange={e => { setPage(0); setFiltroSinPatron(e.target.checked); if (e.target.checked) { setSoloPendientes(true); setFiltroSoloConSugerencia(false) } }} />
            <span style={{ color: filtroSinPatron ? '#D97706' : '#9CA3AF', fontSize: 11 }}>⚠</span>
            Sin patrón detectado
          </label>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" onClick={descargarPlantilla} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', fontSize: 12, fontWeight: 500, color: '#374151', cursor: 'pointer' }}>
              <Download size={13} /> Descargar plantilla
            </button>
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={importing} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, border: 'none', background: PRIMARY, fontSize: 12, fontWeight: 500, color: '#fff', cursor: 'pointer', opacity: importing ? 0.6 : 1 }}>
              {importing ? <Loader2 size={13} /> : <Upload size={13} />} Cargar clasificación
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) cargarClasificacion(f) }} />
          </div>
        </div>
      </div>

      {/* TABLA */}
      <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ ...TH, width: 40 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} /></th>
                <SortableTh label="Fecha" sortKey="fecha" active={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Tipo" sortKey="tipo" active={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Monto" sortKey="monto" active={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                <FiltroDescripcion movs={movs} filtrosDesc={filtrosDesc} onChange={next => { setFiltrosDesc(next); setPage(0) }} />
                <SortableTh label="Mes cartola" sortKey="mes_cartola" active={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Mes nominal" sortKey="mes_nominal" active={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Clasificación" sortKey="clasificacion" active={sortKey} dir={sortDir} onClick={toggleSort} />
                <th style={{ ...TH, textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} style={{ ...TD, textAlign: 'center', padding: '40px 0' }}><Loader2 size={20} style={{ display: 'inline-block', color: '#9CA3AF' }} /></td></tr>}
              {!loading && movs.length === 0 && <tr><td colSpan={9} style={{ ...TD, textAlign: 'center', padding: '40px 0', color: '#9CA3AF' }}>No hay movimientos con estos filtros</td></tr>}
              {!loading && displayMovs.map(m => {
                const sug = sugerencias.get(m.id)
                const sub = m.subcuenta_id ? subById.get(m.subcuenta_id) : null
                return (
                  <tr key={m.id} onClick={() => setEditing(m)}
                    tabIndex={0}
                    onKeyDown={e => {
                      if (e.key === ' ') { e.preventDefault(); toggleOne(m.id) }
                      else if (e.key === 'Enter' && sug && m.estado === 'pendiente') { e.preventDefault(); aceptarSugerencia(m) }
                    }}
                    style={{
                      borderTop: '1px solid #F3F4F6', cursor: 'pointer', height: 22,
                      lineHeight: 1.1,
                      borderLeft: '3px solid transparent',
                      outline: 'none',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#F9FAFB'; e.currentTarget.style.borderLeftColor = '#3B82F6' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderLeftColor = 'transparent' }}
                    onFocus={e => { e.currentTarget.style.background = '#EFF6FF'; e.currentTarget.style.borderLeftColor = '#1E40AF' }}
                    onBlur={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderLeftColor = 'transparent' }}>
                    <td style={TD} onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(m.id)} onChange={() => toggleOne(m.id)} /></td>
                    <td style={TD}>{m.fecha}</td>
                    <td style={TD}><span style={{ display: 'inline-block', padding: '0px 5px', borderRadius: 3, fontSize: 9, fontWeight: 700, background: m.tipo === 'ABONO' ? '#DCFCE7' : '#FEE2E2', color: m.tipo === 'ABONO' ? '#166534' : '#991B1B' }}>{m.tipo}</span></td>
                    <td style={{ ...TD, textAlign: 'right', fontWeight: 600 }}>{formatCLP(m.monto)}</td>
                    <td style={{ ...TD, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }} title={m.descripcion}>{m.descripcion}</td>
                    <td style={TD}><span style={{ display: 'inline-block', padding: '0px 5px', borderRadius: 3, fontSize: 9, fontWeight: 500, background: '#F3F4F6', color: '#374151' }}>{nombreMes(m.mes_cartola)}</span></td>
                    <td style={TD} onClick={e => e.stopPropagation()}>
                      <select value={m.mes_nominal ?? ''} onChange={e => { const v = e.target.value; if (v) actualizarMesNominal(m.id, Number(v)) }}
                        style={{ padding: '1px 4px', borderRadius: 4, border: '1px solid #D1D5DB', fontSize: 10, background: '#fff', color: '#374151' }}>
                        <option value="">—</option>
                        {MESES_CORTOS.map((nm, i) => <option key={i+1} value={i+1}>{i+1} — {nm}</option>)}
                      </select>
                    </td>
                    <td style={TD}>
                      {m.estado === 'clasificado' || m.estado === 'conciliado'
                        ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <span style={{ display: 'inline-block', padding: '0px 5px', borderRadius: 3, fontSize: 9, fontWeight: 500, background: '#DCFCE7', color: '#166534' }}>{sub?.nombre ?? 'Clasificado'}</span>
                            {m.clasif_ia && (
                              <span title="Clasificado por IA" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '0px 4px', borderRadius: 3, fontSize: 8, fontWeight: 700, background: 'linear-gradient(135deg, #6366F1, #4F46E5)', color: '#fff' }}>
                                <Sparkles size={7} /> IA
                              </span>
                            )}
                          </span>
                        : sug
                          ? (() => {
                              const colorPorNivel = sug.nivel === 'alto'  ? { bg: '#DCFCE7', color: '#166534', border: '#86EFAC' }
                                                  : sug.nivel === 'medio' ? { bg: '#FEF3C7', color: '#92400E', border: '#FCD34D' }
                                                  :                          { bg: '#FEE2E2', color: '#991B1B', border: '#FCA5A5' }
                              return (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} title={sug.razon}>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '0px 5px', borderRadius: 3, fontSize: 9, fontWeight: 500, background: '#DBEAFE', color: '#1E40AF' }}>
                                    <Sparkles size={8} /> {sug.subcuenta_nombre}
                                  </span>
                                  <span style={{ fontSize: 8, fontWeight: 700, padding: '0px 4px', borderRadius: 99, background: colorPorNivel.bg, color: colorPorNivel.color, border: `1px solid ${colorPorNivel.border}`, fontFamily: 'monospace' }}>
                                    {sug.score}%
                                  </span>
                                </span>
                              )
                            })()
                          : <span style={{ display: 'inline-block', padding: '0px 5px', borderRadius: 3, fontSize: 9, fontWeight: 500, background: '#FEF9C3', color: '#854D0E' }}>Pendiente</span>
                      }
                    </td>
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                        {sug && m.estado === 'pendiente' && (
                          <button onClick={e => { e.stopPropagation(); aceptarSugerencia(m) }}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '1px 5px', borderRadius: 3, border: '1px solid #A7F3D0', background: '#ECFDF5', fontSize: 9, fontWeight: 600, color: '#065F46', cursor: 'pointer' }}>
                            <Check size={9} /> OK
                          </button>
                        )}
                        <button onClick={e => { e.stopPropagation(); setEditing(m) }}
                          style={{ width: 18, height: 18, borderRadius: 4, border: 'none', background: 'transparent', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280' }}>
                          <Pencil size={10} />
                        </button>
                        {isAdmin && (
                          <button onClick={e => { e.stopPropagation(); if (m.estado === 'clasificado' || m.estado === 'conciliado') return; setEliminando(m) }}
                            disabled={m.estado === 'clasificado' || m.estado === 'conciliado'}
                            style={{ width: 18, height: 18, borderRadius: 4, border: 'none', background: 'transparent', cursor: m.estado === 'clasificado' || m.estado === 'conciliado' ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: m.estado === 'clasificado' || m.estado === 'conciliado' ? '#D1D5DB' : '#F87171' }}>
                            <Trash2 size={10} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {/* Paginación */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #F3F4F6', padding: '8px 14px', fontSize: 11, color: '#6B7280', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>{total} movimientos · Página {page + 1} de {pageCount}</span>
            <span style={{ fontSize: 10, color: '#9CA3AF', display: 'flex', gap: 6 }}>
              <kbd style={{ padding: '0px 4px', borderRadius: 3, background: '#F3F4F6', fontSize: 9, fontFamily: 'monospace' }}>Tab</kbd> enfocar fila ·
              <kbd style={{ padding: '0px 4px', borderRadius: 3, background: '#F3F4F6', fontSize: 9, fontFamily: 'monospace' }}>Espacio</kbd> marcar ·
              <kbd style={{ padding: '0px 4px', borderRadius: 3, background: '#F3F4F6', fontSize: 9, fontFamily: 'monospace' }}>Enter</kbd> aceptar IA
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11 }}>Mostrar:</span>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }} style={selectSt}>
              <option value={50}>50</option><option value={100}>100</option><option value={200}>200</option><option value={500}>500</option>
            </select>
            <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p-1))} style={{ padding: '3px 10px', borderRadius: 5, border: '1px solid #D1D5DB', background: '#fff', fontSize: 11, cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.5 : 1 }}>Anterior</button>
            <button disabled={page+1 >= pageCount} onClick={() => setPage(p => p+1)} style={{ padding: '3px 10px', borderRadius: 5, border: '1px solid #D1D5DB', background: '#fff', fontSize: 11, cursor: page+1 >= pageCount ? 'not-allowed' : 'pointer', opacity: page+1 >= pageCount ? 0.5 : 1 }}>Siguiente</button>
          </div>
        </div>
      </div>

      {/* Barra flotante selección */}
      {selected.size >= 1 && (
        <div style={{ position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 40, display: 'flex', alignItems: 'center', gap: 10, background: '#111827', color: '#fff', borderRadius: 99, padding: '10px 20px', fontSize: 13, boxShadow: '0 4px 20px rgba(0,0,0,0.3)', flexWrap: 'nowrap' }}>
          <span style={{ whiteSpace: 'nowrap' }}>{selected.size} seleccionado{selected.size === 1 ? '' : 's'}</span>
          {selectedConSugerencia > 0 && (
            <button onClick={aceptarSugerenciasSeleccionadas} disabled={autoClasifLoading}
              title="Acepta la sugerencia IA de cada movimiento seleccionado"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 99, border: 'none', background: 'linear-gradient(135deg, #6366F1, #4F46E5)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <Sparkles size={11} /> Aceptar IA ({selectedConSugerencia})
            </button>
          )}
          <button onClick={() => setShowLote(true)} style={{ padding: '5px 12px', borderRadius: 99, border: 'none', background: PRIMARY, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Clasificar manualmente</button>
          {selected.size >= 2 && (<>
            <span style={{ width: 1, height: 20, background: '#374151', display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: '#9CA3AF', whiteSpace: 'nowrap' }}>Mes nominal:</span>
            <select value={bulkMes} onChange={e => setBulkMes(e.target.value)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #374151', background: '#1F2937', fontSize: 11, color: '#fff' }}>
              <option value="">— (sin cambio)</option>
              {MESES_CORTOS.map((nm, i) => <option key={i+1} value={i+1}>{i+1} — {nm}</option>)}
            </select>
            <button onClick={aplicarMesMasivo} disabled={aplicandoMes} style={{ padding: '4px 12px', borderRadius: 99, border: 'none', background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {aplicandoMes ? 'Aplicando…' : 'Aplicar mes'}
            </button>
          </>)}
          <button onClick={() => { setSelected(new Set()); setBulkMes('') }} style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 }}><X size={15} /></button>
        </div>
      )}

      {editing && <ClasificarPanel movimiento={editing} cuentas={cuentas} subcuentas={subcuentas} cecos={cecos} respaldoTipos={RESPALDO_TIPOS} sugerencia={sugerencias.get(editing.id) ?? null} onClose={() => setEditing(null)} onSaved={(info) => { if (info?.subcuenta_id) aprenderPatron(info.descripcion, info.subcuenta_id, info.ceco_id, info.tipo_respaldo); setEditing(null); invalidateCatalog(); refresh() }} />}
      {showLote && <LoteModal ids={Array.from(selected)} cuentas={cuentas} subcuentas={subcuentas} cecos={cecos} respaldoTipos={RESPALDO_TIPOS} onClose={() => setShowLote(false)} onSaved={(info) => {
        if (info?.subcuenta_id && info.ids) {
          for (const id of info.ids) {
            const mov = movs.find(m => m.id === id)
            if (mov) aprenderPatron(mov.descripcion, info.subcuenta_id, info.ceco_id, info.tipo_respaldo)
          }
        }
        setShowLote(false); setSelected(new Set()); refresh()
      }} />}
    </div>
  )
}

function SortableTh({ label, sortKey, active, dir, onClick, align }) {
  const isActive = active === sortKey && dir !== null
  return (
    <th onClick={() => onClick(sortKey)} style={{ ...TH, cursor: 'pointer', textAlign: align === 'right' ? 'right' : 'left', color: isActive ? PRIMARY : '#6B7280', background: isActive ? '#EFF6FF' : '#F9FAFB' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        {!isActive && <ArrowUpDown size={11} style={{ color: '#D1D5DB' }} />}
        {isActive && dir === 'asc' && <ArrowUp size={11} />}
        {isActive && dir === 'desc' && <ArrowDown size={11} />}
      </span>
    </th>
  )
}

// ── Filtro tipo Excel para columna Descripción ────────────────────────────
export function FiltroDescripcion({ movs, filtrosDesc, onChange }) {
  const [open, setOpen]       = useState(false)
  const [busq, setBusq]       = useState('')
  const dropRef               = useRef(null)

  // Cerrar al hacer click fuera
  useEffect(() => {
    if (!open) return
    function handler(e) { if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Extraer valores únicos — normaliza: primeras 4 palabras significativas
  const valoresUnicos = useMemo(() => {
    const STOP = new Set(['DE','DEL','LA','EL','LOS','LAS','Y','A','AL','EN','POR','PARA','CON','SIN'])
    const counts = new Map()
    for (const m of movs) {
      const desc = (m.descripcion ?? '').toUpperCase()
      // Extraer patrón: 3 primeras palabras ≥4 chars que no sean stop words ni números
      const palabras = desc.replace(/\d+/g, ' ').replace(/[^A-ZÁÉÍÓÚÑ\s]/g, ' ')
        .split(/\s+/).filter(w => w.length >= 4 && !STOP.has(w)).slice(0, 3)
      if (palabras.length === 0) continue
      const patron = palabras.join(' ')
      counts.set(patron, (counts.get(patron) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])  // más frecuentes primero
      .map(([pat, n]) => ({ pat, n }))
  }, [movs])

  const filtrados = useMemo(() =>
    busq.trim()
      ? valoresUnicos.filter(v => v.pat.includes(busq.toUpperCase()))
      : valoresUnicos
  , [valoresUnicos, busq])

  const hayFiltro = filtrosDesc.size > 0
  const todosSelec = filtrados.length > 0 && filtrados.every(v => filtrosDesc.has(v.pat))

  function toggleItem(pat) {
    const next = new Set(filtrosDesc)
    next.has(pat) ? next.delete(pat) : next.add(pat)
    onChange(next)
  }
  function toggleTodos() {
    if (todosSelec) {
      // Deseleccionar solo los visibles
      const next = new Set(filtrosDesc)
      filtrados.forEach(v => next.delete(v.pat))
      onChange(next)
    } else {
      const next = new Set(filtrosDesc)
      filtrados.forEach(v => next.add(v.pat))
      onChange(next)
    }
  }
  function limpiar() { onChange(new Set()); setBusq(''); setOpen(false) }

  return (
    <th style={{ ...TH, position: 'relative', minWidth: 220 }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span>Descripción</span>
        <button
          onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
          title="Filtrar por descripción"
          style={{
            width: 20, height: 20, borderRadius: 4, border: 'none', cursor: 'pointer',
            background: hayFiltro ? PRIMARY : '#E5E7EB',
            color: hayFiltro ? '#fff' : '#6B7280',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
          <Filter size={11} />
        </button>
        {hayFiltro && (
          <button onClick={e => { e.stopPropagation(); limpiar() }}
            title="Limpiar filtro"
            style={{ width: 16, height: 16, borderRadius: 99, border: 'none', background: '#EF4444', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
            ×
          </button>
        )}
      </div>

      {open && (
        <div ref={dropRef} onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 200,
            background: '#fff', border: '1px solid #E2E8F0',
            borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
            width: 320, maxHeight: 420, display: 'flex', flexDirection: 'column',
          }}>
          {/* Header */}
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>
              Filtrar por descripción
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {hayFiltro && (
                <button onClick={limpiar}
                  style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontWeight: 600 }}>
                  Limpiar
                </button>
              )}
              <button onClick={() => setOpen(false)}
                style={{ width: 20, height: 20, borderRadius: 4, border: 'none', background: '#F3F4F6', color: '#6B7280', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={12} />
              </button>
            </div>
          </div>

          {/* Buscar */}
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #F1F5F9' }}>
            <div style={{ position: 'relative' }}>
              <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
              <input
                autoFocus
                value={busq}
                onChange={e => setBusq(e.target.value)}
                placeholder="Buscar descripción…"
                style={{ width: '100%', padding: '5px 8px 5px 26px', borderRadius: 6, border: '1px solid #E2E8F0', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          {/* Seleccionar todos */}
          <div style={{ padding: '6px 12px', borderBottom: '1px solid #F1F5F9' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
              <input type="checkbox" checked={todosSelec} onChange={toggleTodos} style={{ accentColor: PRIMARY }} />
              Seleccionar todos ({filtrados.length})
            </label>
          </div>

          {/* Lista */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filtrados.length === 0 && (
              <div style={{ padding: '16px 12px', textAlign: 'center', fontSize: 12, color: '#9CA3AF' }}>Sin resultados</div>
            )}
            {filtrados.map(({ pat, n }) => (
              <label key={pat}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', cursor: 'pointer', borderBottom: '1px solid #F9FAFB' }}
                onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <input type="checkbox" checked={filtrosDesc.has(pat)} onChange={() => toggleItem(pat)} style={{ accentColor: PRIMARY, flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 12, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pat}>
                  {pat}
                </span>
                <span style={{ fontSize: 10, color: '#9CA3AF', flexShrink: 0 }}>{n}</span>
              </label>
            ))}
          </div>

          {/* Footer */}
          <div style={{ padding: '8px 12px', borderTop: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#6B7280' }}>
              {filtrosDesc.size > 0 ? `${filtrosDesc.size} filtro${filtrosDesc.size > 1 ? 's' : ''} activo${filtrosDesc.size > 1 ? 's' : ''}` : 'Sin filtros'}
            </span>
            <button onClick={() => setOpen(false)}
              style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: PRIMARY, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Aplicar
            </button>
          </div>
        </div>
      )}
    </th>
  )
}
