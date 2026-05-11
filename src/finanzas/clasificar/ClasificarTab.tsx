import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { toast } from 'sonner'
import {
  Pencil, Check, Search, X, Loader2,
  Download, Upload, Trash2, ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabase'
import {
  type Movimiento,
  type CuentaMadre,
  type Subcuenta,
  type CentroCosto,
  type ReglaClasificacion,
  type CartolaLite,
  type Sugerencia,
  type LibroCompraRow,
  RESPALDO_TIPOS,
  type RespaldoTipo,
  extraerRut,
  palabrasSignificativas,
  getCatalogPromise,
  invalidateCatalog,
  MESES_CORTOS,
  nombreMes,
} from './types'
import { ClasificarPanel } from './ClasificarPanel'
import { LoteModal } from './LoteModal'

const PRIMARY = '#1F4E79'

type EstadoFiltro = 'todos' | 'pendiente' | 'clasificado' | 'conciliado'

function formatCLP(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-CL')
}

export function ClasificarTab() {
  const [cartolas, setCartolas] = useState<CartolaLite[]>([])
  const [cuentas, setCuentas] = useState<CuentaMadre[]>([])
  const [subcuentas, setSubcuentas] = useState<Subcuenta[]>([])
  const [cecos, setCecos] = useState<CentroCosto[]>([])
  const [reglas, setReglas] = useState<ReglaClasificacion[]>([])

  const [movs, setMovs] = useState<Movimiento[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  // filtros
  const [filtroCartola, setFiltroCartola] = useState<string>('todas')
  const [filtroEstado, setFiltroEstado] = useState<EstadoFiltro>('todos')
  const [filtroDesde, setFiltroDesde] = useState<string>('')
  const [filtroHasta, setFiltroHasta] = useState<string>('')
  const [busqueda, setBusqueda] = useState<string>('')
  const [soloPendientes, setSoloPendientes] = useState<boolean>(false)
  const [filtroMesNominal, setFiltroMesNominal] = useState<string>('todos')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<number>(50)

  // selección
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkMes, setBulkMes] = useState<string>('')
  const [aplicandoMes, setAplicandoMes] = useState(false)

  // ordenamiento
  type SortKey = 'fecha' | 'tipo' | 'monto' | 'descripcion' | 'mes_cartola' | 'mes_nominal' | 'clasificacion'
  type SortDir = 'asc' | 'desc' | null
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir('asc')
    } else if (sortDir === 'asc') {
      setSortDir('desc')
    } else if (sortDir === 'desc') {
      setSortKey(null)
      setSortDir(null)
    } else {
      setSortDir('asc')
    }
  }

  const [sugerencias, setSugerencias] = useState<Map<string, Sugerencia>>(new Map())
  const [editing, setEditing] = useState<Movimiento | null>(null)
  const [showLote, setShowLote] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [eliminando, setEliminando] = useState<Movimiento | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let cancel = false
    ;(async () => {
      const { data: sess } = await supabase.auth.getSession()
      const uid = sess.session?.user?.id
      if (!uid) return
      const { data } = await supabase
        .from('usuarios')
        .select('rol')
        .eq('id', uid)
        .maybeSingle()
      if (!cancel) setIsAdmin(data?.rol === 'admin_sistema')
    })()
    return () => { cancel = true }
  }, [])

  const [mesStats, setMesStats] = useState<{ clasif: number; total: number }>({ clasif: 0, total: 0 })

  // carga inicial de catálogos
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const cat = await getCatalogPromise(async () => {
          const [cm, sc, cc, rg] = await Promise.all([
            supabase.from('cuentas_madre').select('id, nombre, orden_eerr').order('orden_eerr', { ascending: true }),
            supabase.from('subcuentas').select('id, nombre, cuenta_madre_id'),
            supabase.from('centros_costo').select('id, nombre').order('nombre'),
            supabase.from('reglas_clasificacion').select('id, tipo_regla, patron, subcuenta_id, ceco_id, tipo_respaldo, aciertos'),
          ])
          return {
            cuentas: (cm.data ?? []) as CuentaMadre[],
            subcuentas: (sc.data ?? []) as Subcuenta[],
            cecos: (cc.data ?? []) as CentroCosto[],
            reglas: (rg.data ?? []) as ReglaClasificacion[],
          }
        })
        if (cancelled) return
        setCuentas(cat.cuentas)
        setSubcuentas(cat.subcuentas)
        setCecos(cat.cecos)
        setReglas(cat.reglas)

        const { data: ctData } = await supabase
          .from('cartolas')
          .select('id, banco, cuenta')
          .order('created_at', { ascending: false })
        if (!cancelled) setCartolas((ctData ?? []) as CartolaLite[])
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error cargando catálogos'
        toast.error(msg)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // carga de movimientos según filtros
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        let q = supabase
          .from('movimientos_bancarios')
          .select(
            'id, cartola_id, fecha, monto, saldo, tipo, descripcion, referencia, estado, subcuenta_id, ceco_id, tipo_respaldo, observaciones, mes_cartola, mes_nominal',
            { count: 'exact' },
          )
          .order('fecha', { ascending: false })
          .order('monto', { ascending: false })

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
          if (/^\d+$/.test(numeric)) {
            q = q.eq('monto', Number(numeric))
          } else if (safe.length > 0) {
            q = q.ilike('descripcion', `%${safe}%`)
          }
        }

        const from = page * pageSize
        const to = from + pageSize - 1
        const { data, error, count } = await q.range(from, to)
        if (cancelled) return
        if (error) {
          toast.error('Error cargando movimientos: ' + error.message)
          setMovs([])
          setTotal(0)
          return
        }
        setMovs((data ?? []) as Movimiento[])
        setTotal(count ?? 0)
        setSelected(new Set())
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [filtroCartola, filtroEstado, filtroDesde, filtroHasta, busqueda, soloPendientes, filtroMesNominal, page, pageSize, reloadKey])

  // contador del mes
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const ahora = new Date()
      const desde = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-01`
      const fin = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0)
      const hasta = `${fin.getFullYear()}-${String(fin.getMonth() + 1).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`
      const [{ count: total }, { count: clasif }] = await Promise.all([
        supabase.from('movimientos_bancarios').select('*', { count: 'exact', head: true }).gte('fecha', desde).lte('fecha', hasta),
        supabase.from('movimientos_bancarios').select('*', { count: 'exact', head: true }).gte('fecha', desde).lte('fecha', hasta).neq('estado', 'pendiente'),
      ])
      if (!cancelled) setMesStats({ clasif: clasif ?? 0, total: total ?? 0 })
    })()
    return () => { cancelled = true }
  }, [reloadKey])

  // sugerencias automáticas
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const pendientes = movs.filter((m) => m.estado === 'pendiente')
      if (pendientes.length === 0) { setSugerencias(new Map()); return }

      const rutPorMov = new Map<string, string | null>()
      const rutsUnicos = new Set<string>()
      for (const m of pendientes) {
        const r = extraerRut(m.descripcion)
        rutPorMov.set(m.id, r)
        if (r) rutsUnicos.add(r)
      }

      const lcPorRut = new Map<string, LibroCompraRow>()
      if (rutsUnicos.size > 0) {
        const { data: lc } = await supabase
          .from('libro_compras')
          .select('rut_proveedor, subcuenta_id, ceco_id')
          .in('rut_proveedor', Array.from(rutsUnicos))
          .not('subcuenta_id', 'is', null)
        for (const row of (lc ?? []) as LibroCompraRow[]) {
          if (row.rut_proveedor && !lcPorRut.has(row.rut_proveedor))
            lcPorRut.set(row.rut_proveedor, row)
        }
      }

      const subById = new Map(subcuentas.map((s) => [s.id, s]))
      const sug = new Map<string, Sugerencia>()

      for (const m of pendientes) {
        const rut = rutPorMov.get(m.id) ?? null
        let found: Sugerencia | null = null

        if (rut && lcPorRut.has(rut)) {
          const lc = lcPorRut.get(rut)!
          if (lc.subcuenta_id && subById.has(lc.subcuenta_id)) {
            found = {
              subcuenta_id: lc.subcuenta_id,
              subcuenta_nombre: subById.get(lc.subcuenta_id)!.nombre,
              ceco_id: lc.ceco_id,
              tipo_respaldo: 'factura_compra',
              fuente: 'libro_compras',
              regla_id: null,
              rut_extraido: rut,
            }
          }
        }

        if (!found) {
          const desc = m.descripcion.toUpperCase()
          const palabras = desc.split(/\s+/).filter(Boolean)
          for (const r of reglas) {
            if (!r.subcuenta_id || !subById.has(r.subcuenta_id)) continue
            const patron = (r.patron ?? '').toUpperCase().trim()
            if (!patron) continue
            let match = false
            if (r.tipo_regla === 'descripcion_exacta') match = desc === patron
            else if (r.tipo_regla === 'descripcion_contiene') match = desc.includes(patron)
            else if (r.tipo_regla === 'palabra_clave') {
              const escaped = patron.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
              const re = new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'i')
              match = re.test(desc) || palabras.includes(patron)
            } else if (r.tipo_regla === 'rut') match = !!rut && rut.toUpperCase() === patron
            if (match) {
              found = {
                subcuenta_id: r.subcuenta_id,
                subcuenta_nombre: subById.get(r.subcuenta_id)!.nombre,
                ceco_id: r.ceco_id,
                tipo_respaldo: r.tipo_respaldo,
                fuente: 'regla',
                regla_id: r.id,
                rut_extraido: rut,
              }
              break
            }
          }
        }
        if (found) sug.set(m.id, found)
      }
      if (!cancelled) setSugerencias(sug)
    })()
    return () => { cancelled = true }
  }, [movs, reglas, subcuentas])

  const refresh = useCallback(() => setReloadKey((k) => k + 1), [])

  async function aceptarSugerencia(m: Movimiento) {
    const s = sugerencias.get(m.id)
    if (!s) return
    const { data: sess } = await supabase.auth.getSession()
    const userId = sess.session?.user?.id ?? null
    const { error } = await supabase
      .from('movimientos_bancarios')
      .update({
        subcuenta_id: s.subcuenta_id,
        ceco_id: s.ceco_id,
        tipo_respaldo: s.tipo_respaldo,
        estado: 'clasificado',
        clasificado_por: userId,
        clasificado_at: new Date().toISOString(),
      })
      .eq('id', m.id)
    if (error) { toast.error('Error: ' + error.message); return }
    if (s.regla_id) {
      const r = reglas.find((x) => x.id === s.regla_id)
      await supabase.from('reglas_clasificacion').update({ aciertos: (r?.aciertos ?? 0) + 1 }).eq('id', s.regla_id)
    }
    toast.success('Sugerencia aplicada')
    refresh()
  }

  async function actualizarMesNominal(movId: string, mes: number) {
    setMovs((prev) => prev.map((x) => (x.id === movId ? { ...x, mes_nominal: mes } : x)))
    const { error } = await supabase.from('movimientos_bancarios').update({ mes_nominal: mes }).eq('id', movId)
    if (error) { toast.error('No se pudo actualizar el mes nominal: ' + error.message); refresh() }
    else toast.success(`Mes nominal: ${nombreMes(mes)}`)
  }

  async function aplicarMesMasivo() {
    if (!bulkMes) { toast.warning('Selecciona un mes nominal para aplicar'); return }
    const mes = Number(bulkMes)
    const ids = Array.from(selected)
    if (ids.length === 0) return
    setAplicandoMes(true)
    const { error } = await supabase.from('movimientos_bancarios').update({ mes_nominal: mes }).in('id', ids)
    setAplicandoMes(false)
    if (error) { toast.error('Error al actualizar mes nominal: ' + error.message); return }
    setMovs((prev) => prev.map((x) => (ids.includes(x.id) ? { ...x, mes_nominal: mes } : x)))
    setBulkMes('')
    toast.success(`Mes nominal actualizado en ${ids.length} registros`)
  }

  const allChecked = movs.length > 0 && movs.every((m) => selected.has(m.id))
  function toggleAll() {
    if (allChecked) setSelected(new Set())
    else setSelected(new Set(movs.map((m) => m.id)))
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const subById = useMemo(() => new Map(subcuentas.map((s) => [s.id, s])), [subcuentas])

  const displayMovs = useMemo(() => {
    if (!sortKey || !sortDir) return movs
    const arr = [...movs]
    const dir = sortDir === 'asc' ? 1 : -1
    const cmpStr = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' })
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'fecha': return (new Date(a.fecha).getTime() - new Date(b.fecha).getTime()) * dir
        case 'tipo': return cmpStr(a.tipo ?? '', b.tipo ?? '') * dir
        case 'monto': return (Math.abs(Number(a.monto)) - Math.abs(Number(b.monto))) * dir
        case 'descripcion': return cmpStr(a.descripcion ?? '', b.descripcion ?? '') * dir
        case 'mes_cartola': return ((a.mes_cartola ?? 0) - (b.mes_cartola ?? 0)) * dir
        case 'mes_nominal': return ((a.mes_nominal ?? 0) - (b.mes_nominal ?? 0)) * dir
        case 'clasificacion': {
          const an = a.subcuenta_id ? subById.get(a.subcuenta_id)?.nombre ?? null : null
          const bn = b.subcuenta_id ? subById.get(b.subcuenta_id)?.nombre ?? null : null
          if (!an && !bn) return 0
          if (!an) return 1
          if (!bn) return -1
          return cmpStr(an, bn) * dir
        }
        default: return 0
      }
    })
    return arr
  }, [movs, sortKey, sortDir, subById])

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const pct = mesStats.total === 0 ? 0 : Math.round((mesStats.clasif / mesStats.total) * 100)

  // Excel
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [importing, setImporting] = useState(false)

  async function descargarPlantilla() {
    try {
      const { data, error } = await supabase
        .from('movimientos_bancarios')
        .select('id, descripcion, fecha, monto, tipo, subcuenta_id')
        .is('subcuenta_id', null)
        .order('fecha', { ascending: false })
        .limit(5000)
      if (error) throw error
      const rows = (data ?? []).map((m) => ({
        id: m.id,
        descripcion: m.descripcion,
        fecha: m.fecha,
        monto: m.monto,
        tipo: m.tipo,
        subcuenta_actual: m.subcuenta_id ? subById.get(m.subcuenta_id)?.nombre ?? '' : '',
        subcuenta_id_nuevo: '',
        ceco_id_nuevo: '',
      }))
      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.json_to_sheet(rows, {
        header: ['id', 'descripcion', 'fecha', 'monto', 'tipo', 'subcuenta_actual', 'subcuenta_id_nuevo', 'ceco_id_nuevo'],
      })
      const refSubs = XLSX.utils.json_to_sheet(subcuentas.map((s) => ({ subcuenta_id: s.id, nombre: s.nombre })))
      const refCecos = XLSX.utils.json_to_sheet(cecos.map((c) => ({ ceco_id: c.id, nombre: c.nombre })))
      XLSX.utils.book_append_sheet(wb, ws, 'Movimientos')
      XLSX.utils.book_append_sheet(wb, refSubs, 'ref_subcuentas')
      XLSX.utils.book_append_sheet(wb, refCecos, 'ref_centros_costo')
      XLSX.writeFile(wb, `plantilla_clasificacion_${Date.now()}.xlsx`)
      toast.success(`Plantilla descargada con ${rows.length} movimientos`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al generar plantilla')
    }
  }

  async function cargarClasificacion(file: File) {
    setImporting(true)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
      const validas = rows.filter((r) => String(r.id ?? '').trim().length > 0 && String(r.subcuenta_id_nuevo ?? '').trim().length > 0)
      const ignoradas = rows.length - validas.length
      if (validas.length === 0) { toast.warning(`No hay filas válidas. ${ignoradas} ignoradas.`); return }
      const { data: sess } = await supabase.auth.getSession()
      const userId = sess.session?.user?.id ?? null
      const ahora = new Date().toISOString()
      let ok = 0, fail = 0
      const CHUNK = 10
      for (let i = 0; i < validas.length; i += CHUNK) {
        const slice = validas.slice(i, i + CHUNK)
        const results = await Promise.all(
          slice.map((r) => {
            const id = String(r.id).trim()
            const sub = String(r.subcuenta_id_nuevo).trim()
            const ceco = String(r.ceco_id_nuevo ?? '').trim()
            return supabase.from('movimientos_bancarios').update({
              subcuenta_id: sub,
              ceco_id: ceco.length > 0 ? ceco : null,
              estado: 'clasificado',
              clasificado_por: userId,
              clasificado_at: ahora,
            }).eq('id', id)
          }),
        )
        for (const r of results) { if (r.error) fail++; else ok++ }
      }
      if (fail > 0) toast.warning(`${ok} actualizados, ${fail} con error, ${ignoradas} ignoradas`)
      else toast.success(`${ok} movimientos actualizados${ignoradas > 0 ? `, ${ignoradas} ignoradas` : ''}`)
      invalidateCatalog()
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al cargar archivo')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-4">
      {/* HEADER con barra de progreso */}
      <div className="rounded-lg bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Clasificar movimientos</h2>
            <p className="mt-1 text-sm text-gray-500">
              {mesStats.clasif} de {mesStats.total} clasificados este mes
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold" style={{ color: PRIMARY }}>{pct}%</div>
          </div>
        </div>
        <div className="mt-3 h-2 w-full rounded-full bg-gray-100">
          <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: PRIMARY }} />
        </div>
      </div>

      {/* FILTROS */}
      <div className="rounded-lg bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col">
            <label className="text-xs text-gray-500">Cartola</label>
            <select className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" value={filtroCartola}
              onChange={(e) => { setPage(0); setFiltroCartola(e.target.value) }}>
              <option value="todas">Todas</option>
              {cartolas.map((c) => <option key={c.id} value={c.id}>{c.banco} — {c.cuenta}</option>)}
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-gray-500">Estado</label>
            <select className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" value={filtroEstado}
              disabled={soloPendientes} onChange={(e) => { setPage(0); setFiltroEstado(e.target.value as EstadoFiltro) }}>
              <option value="todos">Todos</option>
              <option value="pendiente">Pendientes</option>
              <option value="clasificado">Clasificados</option>
              <option value="conciliado">Conciliados</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-gray-500">Desde</label>
            <input type="date" className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" value={filtroDesde}
              onChange={(e) => { setPage(0); setFiltroDesde(e.target.value) }} />
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-gray-500">Hasta</label>
            <input type="date" className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" value={filtroHasta}
              onChange={(e) => { setPage(0); setFiltroHasta(e.target.value) }} />
          </div>
          <div className="flex flex-1 flex-col">
            <label className="text-xs text-gray-500">Buscar</label>
            <div className="relative mt-1">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Descripción o monto…"
                className="w-full rounded-md border border-gray-300 py-1.5 pl-7 pr-2 text-sm" value={busqueda}
                onChange={(e) => { setPage(0); setBusqueda(e.target.value) }} />
            </div>
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-gray-500">Mes nominal</label>
            <select className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" value={filtroMesNominal}
              onChange={(e) => { setPage(0); setFiltroMesNominal(e.target.value) }}>
              <option value="todos">Todos</option>
              {MESES_CORTOS.map((m, i) => <option key={i + 1} value={String(i + 1)}>{i + 1} — {m}</option>)}
            </select>
          </div>
          <label className="flex cursor-pointer items-center gap-2 pb-1.5 text-sm text-gray-700">
            <input type="checkbox" checked={soloPendientes}
              onChange={(e) => { setPage(0); setSoloPendientes(e.target.checked) }} />
            Solo sin clasificar
          </label>
          <div className="ml-auto flex items-center gap-2 pb-0.5">
            <button type="button" onClick={descargarPlantilla}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
              <Download size={14} /> Descargar plantilla
            </button>
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={importing}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: PRIMARY }}>
              {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Cargar clasificación
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) cargarClasificacion(f) }} />
          </div>
        </div>
      </div>

      {/* TABLA */}
      <div className="overflow-hidden rounded-lg bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="w-10 px-3 py-3">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                </th>
                <SortableTh label="Fecha" sortKey="fecha" active={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Tipo" sortKey="tipo" active={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Monto" sortKey="monto" active={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                <SortableTh label="Descripción" sortKey="descripcion" active={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Mes cartola" sortKey="mes_cartola" active={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Mes nominal" sortKey="mes_nominal" active={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Clasificación" sortKey="clasificacion" active={sortKey} dir={sortDir} onClick={toggleSort} />
                <th className="px-3 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center">
                    <Loader2 className="inline animate-spin text-gray-400" size={20} />
                  </td>
                </tr>
              )}
              {!loading && movs.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-gray-500">
                    No hay movimientos con estos filtros
                  </td>
                </tr>
              )}
              {!loading && displayMovs.map((m) => {
                const sug = sugerencias.get(m.id)
                const sub = m.subcuenta_id ? subById.get(m.subcuenta_id) : null
                return (
                  <tr key={m.id} onClick={() => setEditing(m)}
                    className="cursor-pointer border-t border-gray-100 hover:bg-gray-50"
                    style={{ height: 56 }}>
                    <td className="px-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggleOne(m.id)} />
                    </td>
                    <td className="px-3 text-gray-700">{m.fecha}</td>
                    <td className="px-3">
                      <span className="inline-block rounded px-2 py-0.5 text-xs font-medium"
                        style={{ backgroundColor: m.tipo === 'ABONO' ? '#DCFCE7' : '#FEE2E2', color: m.tipo === 'ABONO' ? '#166534' : '#991B1B' }}>
                        {m.tipo}
                      </span>
                    </td>
                    <td className="px-3 text-right font-medium text-gray-800">{formatCLP(m.monto)}</td>
                    <td className="px-3 text-gray-700">
                      <div className="max-w-[340px] truncate" title={m.descripcion}>{m.descripcion}</div>
                    </td>
                    <td className="px-3 text-gray-700">
                      <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        {nombreMes(m.mes_cartola)}
                      </span>
                    </td>
                    <td className="px-3" onClick={(e) => e.stopPropagation()}>
                      <select value={m.mes_nominal ?? ''}
                        onChange={(e) => { const v = e.target.value; if (v) actualizarMesNominal(m.id, Number(v)) }}
                        className="rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-700 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-200">
                        <option value="">—</option>
                        {MESES_CORTOS.map((nm, i) => <option key={i + 1} value={i + 1}>{i + 1} — {nm}</option>)}
                      </select>
                    </td>
                    <td className="px-3">
                      {m.estado === 'clasificado' || m.estado === 'conciliado' ? (
                        <span className="inline-block rounded px-2 py-0.5 text-xs font-medium"
                          style={{ backgroundColor: '#DCFCE7', color: '#166534' }}>
                          {sub?.nombre ?? 'Clasificado'}
                        </span>
                      ) : sug ? (
                        <span className="inline-block rounded px-2 py-0.5 text-xs font-medium"
                          style={{ backgroundColor: '#DBEAFE', color: '#1E40AF' }} title={`Fuente: ${sug.fuente}`}>
                          Sugerido: {sug.subcuenta_nombre}
                        </span>
                      ) : (
                        <span className="inline-block rounded px-2 py-0.5 text-xs font-medium"
                          style={{ backgroundColor: '#FEF9C3', color: '#854D0E' }}>
                          Pendiente
                        </span>
                      )}
                    </td>
                    <td className="px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {sug && m.estado === 'pendiente' && (
                          <button onClick={(e) => { e.stopPropagation(); aceptarSugerencia(m) }}
                            className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
                            <Check size={12} /> Aceptar
                          </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); setEditing(m) }}
                          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700" title="Clasificar">
                          <Pencil size={14} />
                        </button>
                        {isAdmin && (
                          <button
                            onClick={(e) => { e.stopPropagation(); if (m.estado === 'clasificado' || m.estado === 'conciliado') return; setEliminando(m) }}
                            disabled={m.estado === 'clasificado' || m.estado === 'conciliado'}
                            className="rounded p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent">
                            <Trash2 size={14} />
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
        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm text-gray-600">
          <div>{total} movimientos · Página {page + 1} de {pageCount}</div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Mostrar:</label>
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-200">
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={500}>500</option>
            </select>
            <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-50">Anterior</button>
            <button disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}
              className="rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-50">Siguiente</button>
          </div>
        </div>
      </div>

      {/* Barra flotante de selección */}
      {selected.size >= 1 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full bg-gray-900 px-5 py-3 text-sm text-white shadow-lg">
          <span>{selected.size} movimiento{selected.size === 1 ? '' : 's'} seleccionado{selected.size === 1 ? '' : 's'}</span>
          <button onClick={() => setShowLote(true)} className="rounded-full px-3 py-1 text-xs font-medium" style={{ backgroundColor: PRIMARY }}>
            Clasificar seleccionados
          </button>
          {selected.size >= 2 && (
            <>
              <span className="h-5 w-px bg-gray-700" />
              <label className="text-xs text-gray-300">Mes nominal:</label>
              <select value={bulkMes} onChange={(e) => setBulkMes(e.target.value)}
                className="rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-white focus:border-sky-400 focus:outline-none">
                <option value="">— (sin cambio)</option>
                {MESES_CORTOS.map((nm, i) => <option key={i + 1} value={i + 1}>{i + 1} — {nm}</option>)}
              </select>
              <button onClick={aplicarMesMasivo} disabled={aplicandoMes}
                className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/20 disabled:opacity-50">
                {aplicandoMes ? 'Aplicando…' : 'Aplicar mes'}
              </button>
            </>
          )}
          <button onClick={() => { setSelected(new Set()); setBulkMes('') }} className="text-gray-300 hover:text-white">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Panel lateral */}
      {editing && (
        <ClasificarPanel
          movimiento={editing}
          cuentas={cuentas}
          subcuentas={subcuentas}
          cecos={cecos}
          respaldoTipos={RESPALDO_TIPOS as readonly RespaldoTipo[]}
          sugerencia={sugerencias.get(editing.id) ?? null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidateCatalog(); refresh() }}
        />
      )}

      {/* Modal lote */}
      {showLote && (
        <LoteModal
          ids={Array.from(selected)}
          cuentas={cuentas}
          subcuentas={subcuentas}
          cecos={cecos}
          respaldoTipos={RESPALDO_TIPOS as readonly RespaldoTipo[]}
          onClose={() => setShowLote(false)}
          onSaved={() => { setShowLote(false); setSelected(new Set()); refresh() }}
        />
      )}

      {/* Modal eliminar */}
      {eliminando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="border-b border-gray-200 px-5 py-4">
              <h3 className="text-base font-semibold text-gray-800">¿Eliminar este movimiento?</h3>
            </div>
            <div className="space-y-2 px-5 py-4 text-sm text-gray-700">
              <div className="rounded-md bg-gray-50 p-3 space-y-1">
                <div><span className="text-gray-500">Fecha:</span> {eliminando.fecha}</div>
                <div><span className="text-gray-500">Tipo:</span> {eliminando.tipo}</div>
                <div><span className="text-gray-500">Monto:</span> {formatCLP(eliminando.monto)}</div>
                <div><span className="text-gray-500">Descripción:</span> {eliminando.descripcion}</div>
              </div>
              <p className="text-sm font-medium text-red-600">Esta acción es permanente y no se puede deshacer.</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
              <button onClick={() => setEliminando(null)} disabled={deleting}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                Cancelar
              </button>
              <button disabled={deleting} onClick={async () => {
                if (!eliminando) return
                setDeleting(true)
                const id = eliminando.id
                const { error } = await supabase.from('movimientos_bancarios').delete().eq('id', id)
                setDeleting(false)
                if (error) { toast.error('No se pudo eliminar: ' + error.message); return }
                toast.success('Movimiento eliminado correctamente')
                setMovs((prev) => prev.filter((x) => x.id !== id))
                setTotal((t) => Math.max(0, t - 1))
                setEliminando(null)
              }}
                className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                {deleting && <Loader2 size={14} className="animate-spin" />}
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

type SortKeyTh = 'fecha' | 'tipo' | 'monto' | 'descripcion' | 'mes_cartola' | 'mes_nominal' | 'clasificacion'

function SortableTh({ label, sortKey, active, dir, onClick, align }: {
  label: string
  sortKey: SortKeyTh
  active: SortKeyTh | null
  dir: 'asc' | 'desc' | null
  onClick: (k: SortKeyTh) => void
  align?: 'left' | 'right'
}) {
  const isActive = active === sortKey && dir !== null
  const isRight = align === 'right'
  return (
    <th onClick={() => onClick(sortKey)}
      className={`cursor-pointer select-none px-3 py-3 hover:bg-gray-100 ${isActive ? 'bg-gray-100' : ''} ${isRight ? 'text-right' : ''}`}>
      <span className={`inline-flex items-center gap-1 ${isRight ? 'justify-end' : ''}`}
        style={isActive ? { color: PRIMARY } : undefined}>
        {label}
        {!isActive && <ArrowUpDown size={12} className="text-gray-300" />}
        {isActive && dir === 'asc' && <ArrowUp size={12} />}
        {isActive && dir === 'desc' && <ArrowDown size={12} />}
      </span>
    </th>
  )
}
