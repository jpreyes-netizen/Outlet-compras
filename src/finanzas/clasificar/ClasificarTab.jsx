import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Pencil, Check, Search, X, Loader2, Download, Upload, Trash2, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabase'
import { RESPALDO_TIPOS, extraerRut, getCatalogPromise, invalidateCatalog, MESES_CORTOS, nombreMes } from './types'
import { ClasificarPanel } from './ClasificarPanel'
import { LoteModal } from './LoteModal'

const PRIMARY = '#1F4E79'

function formatCLP(n) {
  return '$' + Math.round(n).toLocaleString('es-CL')
}

const TH = {
  padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600,
  color: '#6B7280', letterSpacing: '0.05em', textTransform: 'uppercase',
  background: '#F9FAFB', whiteSpace: 'nowrap',
}
const TD = {
  padding: '10px 12px', fontSize: 13, color: '#374151',
  whiteSpace: 'nowrap', verticalAlign: 'middle',
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

  function toggleSort(key) {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc') }
    else if (sortDir === 'asc') setSortDir('desc')
    else if (sortDir === 'desc') { setSortKey(null); setSortDir(null) }
    else setSortDir('asc')
  }

  const [sugerencias, setSugerencias] = useState(new Map())
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
            supabase.from('cuentas_madre').select('id, nombre, orden_eerr').order('orden_eerr', { ascending: true }),
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
          .select('id, cartola_id, fecha, monto, saldo, tipo, descripcion, referencia, estado, subcuenta_id, ceco_id, tipo_respaldo, observaciones, mes_cartola, mes_nominal', { count: 'exact' })
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
      const rutPorMov = new Map(); const rutsUnicos = new Set()
      for (const m of pendientes) { const r = extraerRut(m.descripcion); rutPorMov.set(m.id, r); if (r) rutsUnicos.add(r) }
      const lcPorRut = new Map()
      if (rutsUnicos.size > 0) {
        const { data: lc } = await supabase.from('libro_compras').select('rut_proveedor, subcuenta_id, ceco_id').in('rut_proveedor', Array.from(rutsUnicos)).not('subcuenta_id', 'is', null)
        for (const row of lc ?? []) { if (row.rut_proveedor && !lcPorRut.has(row.rut_proveedor)) lcPorRut.set(row.rut_proveedor, row) }
      }
      const subById = new Map(subcuentas.map(s => [s.id, s]))
      const sug = new Map()
      for (const m of pendientes) {
        const rut = rutPorMov.get(m.id) ?? null; let found = null
        if (rut && lcPorRut.has(rut)) {
          const lc = lcPorRut.get(rut)
          if (lc.subcuenta_id && subById.has(lc.subcuenta_id)) found = { subcuenta_id: lc.subcuenta_id, subcuenta_nombre: subById.get(lc.subcuenta_id).nombre, ceco_id: lc.ceco_id, tipo_respaldo: 'factura_compra', fuente: 'libro_compras', regla_id: null, rut_extraido: rut }
        }
        if (!found) {
          const desc = m.descripcion.toUpperCase(); const palabras = desc.split(/\s+/).filter(Boolean)
          for (const r of reglas) {
            if (!r.subcuenta_id || !subById.has(r.subcuenta_id)) continue
            const patron = (r.patron ?? '').toUpperCase().trim(); if (!patron) continue
            let match = false
            if (r.tipo_regla === 'descripcion_exacta') match = desc === patron
            else if (r.tipo_regla === 'descripcion_contiene') match = desc.includes(patron)
            else if (r.tipo_regla === 'palabra_clave') { const escaped = patron.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); match = new RegExp(`(^|\\W)${escaped}(\\W|$)`,'i').test(desc) || palabras.includes(patron) }
            else if (r.tipo_regla === 'rut') match = !!rut && rut.toUpperCase() === patron
            if (match) { found = { subcuenta_id: r.subcuenta_id, subcuenta_nombre: subById.get(r.subcuenta_id).nombre, ceco_id: r.ceco_id, tipo_respaldo: r.tipo_respaldo, fuente: 'regla', regla_id: r.id, rut_extraido: rut }; break }
          }
        }
        if (found) sug.set(m.id, found)
      }
      if (!cancelled) setSugerencias(sug)
    })()
    return () => { cancelled = true }
  }, [movs, reglas, subcuentas])

  const refresh = useCallback(() => setReloadKey(k => k + 1), [])

  async function aceptarSugerencia(m) {
    const s = sugerencias.get(m.id); if (!s) return
    const { data: sess } = await supabase.auth.getSession()
    const userId = sess.session?.user?.id ?? null
    const { error } = await supabase.from('movimientos_bancarios').update({ subcuenta_id: s.subcuenta_id, ceco_id: s.ceco_id, tipo_respaldo: s.tipo_respaldo, estado: 'clasificado', clasificado_por: userId, clasificado_at: new Date().toISOString() }).eq('id', m.id)
    if (error) { toast.error('Error: ' + error.message); return }
    if (s.regla_id) { const r = reglas.find(x => x.id === s.regla_id); await supabase.from('reglas_clasificacion').update({ aciertos: (r?.aciertos ?? 0) + 1 }).eq('id', s.regla_id) }
    toast.success('Sugerencia aplicada'); refresh()
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

  const allChecked = movs.length > 0 && movs.every(m => selected.has(m.id))
  function toggleAll() { if (allChecked) setSelected(new Set()); else setSelected(new Set(movs.map(m => m.id))) }
  function toggleOne(id) { setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next }) }

  const subById = useMemo(() => new Map(subcuentas.map(s => [s.id, s])), [subcuentas])

  const displayMovs = useMemo(() => {
    if (!sortKey || !sortDir) return movs
    const arr = [...movs]; const dir = sortDir === 'asc' ? 1 : -1
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
  }, [movs, sortKey, sortDir, subById])

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
            <input type="checkbox" checked={soloPendientes} onChange={e => { setPage(0); setSoloPendientes(e.target.checked) }} />
            Solo sin clasificar
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ ...TH, width: 40 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} /></th>
                <SortableTh label="Fecha" sortKey="fecha" active={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Tipo" sortKey="tipo" active={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Monto" sortKey="monto" active={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                <SortableTh label="Descripción" sortKey="descripcion" active={sortKey} dir={sortDir} onClick={toggleSort} />
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
                    style={{ borderTop: '1px solid #F3F4F6', cursor: 'pointer', height: 52 }}
                    onMouseEnter={e => e.currentTarget.style.background = '#F9FAFB'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={TD} onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(m.id)} onChange={() => toggleOne(m.id)} /></td>
                    <td style={TD}>{m.fecha}</td>
                    <td style={TD}><span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: m.tipo === 'ABONO' ? '#DCFCE7' : '#FEE2E2', color: m.tipo === 'ABONO' ? '#166534' : '#991B1B' }}>{m.tipo}</span></td>
                    <td style={{ ...TD, textAlign: 'right', fontWeight: 600 }}>{formatCLP(m.monto)}</td>
                    <td style={{ ...TD, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }} title={m.descripcion}>{m.descripcion}</td>
                    <td style={TD}><span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, background: '#F3F4F6', color: '#374151' }}>{nombreMes(m.mes_cartola)}</span></td>
                    <td style={TD} onClick={e => e.stopPropagation()}>
                      <select value={m.mes_nominal ?? ''} onChange={e => { const v = e.target.value; if (v) actualizarMesNominal(m.id, Number(v)) }}
                        style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid #D1D5DB', fontSize: 11, background: '#fff', color: '#374151' }}>
                        <option value="">—</option>
                        {MESES_CORTOS.map((nm, i) => <option key={i+1} value={i+1}>{i+1} — {nm}</option>)}
                      </select>
                    </td>
                    <td style={TD}>
                      {m.estado === 'clasificado' || m.estado === 'conciliado'
                        ? <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, background: '#DCFCE7', color: '#166534' }}>{sub?.nombre ?? 'Clasificado'}</span>
                        : sug
                          ? <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, background: '#DBEAFE', color: '#1E40AF' }} title={`Fuente: ${sug.fuente}`}>Sugerido: {sug.subcuenta_nombre}</span>
                          : <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, background: '#FEF9C3', color: '#854D0E' }}>Pendiente</span>
                      }
                    </td>
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                        {sug && m.estado === 'pendiente' && (
                          <button onClick={e => { e.stopPropagation(); aceptarSugerencia(m) }}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 4, border: '1px solid #A7F3D0', background: '#ECFDF5', fontSize: 11, fontWeight: 500, color: '#065F46', cursor: 'pointer' }}>
                            <Check size={11} /> Aceptar
                          </button>
                        )}
                        <button onClick={e => { e.stopPropagation(); setEditing(m) }}
                          style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280' }}>
                          <Pencil size={13} />
                        </button>
                        {isAdmin && (
                          <button onClick={e => { e.stopPropagation(); if (m.estado === 'clasificado' || m.estado === 'conciliado') return; setEliminando(m) }}
                            disabled={m.estado === 'clasificado' || m.estado === 'conciliado'}
                            style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', cursor: m.estado === 'clasificado' || m.estado === 'conciliado' ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: m.estado === 'clasificado' || m.estado === 'conciliado' ? '#D1D5DB' : '#F87171' }}>
                            <Trash2 size={13} />
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #F3F4F6', padding: '10px 16px', fontSize: 12, color: '#6B7280' }}>
          <div>{total} movimientos · Página {page + 1} de {pageCount}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11 }}>Mostrar:</span>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }} style={selectSt}>
              <option value={50}>50</option><option value={100}>100</option><option value={200}>200</option><option value={500}>500</option>
            </select>
            <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p-1))} style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', fontSize: 12, cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.5 : 1 }}>Anterior</button>
            <button disabled={page+1 >= pageCount} onClick={() => setPage(p => p+1)} style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', fontSize: 12, cursor: page+1 >= pageCount ? 'not-allowed' : 'pointer', opacity: page+1 >= pageCount ? 0.5 : 1 }}>Siguiente</button>
          </div>
        </div>
      </div>

      {/* Barra flotante */}
      {selected.size >= 1 && (
        <div style={{ position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 40, display: 'flex', alignItems: 'center', gap: 12, background: '#111827', color: '#fff', borderRadius: 99, padding: '10px 20px', fontSize: 13, boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
          <span>{selected.size} movimiento{selected.size === 1 ? '' : 's'} seleccionado{selected.size === 1 ? '' : 's'}</span>
          <button onClick={() => setShowLote(true)} style={{ padding: '4px 14px', borderRadius: 99, border: 'none', background: PRIMARY, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Clasificar seleccionados</button>
          {selected.size >= 2 && (<>
            <span style={{ width: 1, height: 20, background: '#374151', display: 'inline-block' }} />
            <span style={{ fontSize: 11, color: '#9CA3AF' }}>Mes nominal:</span>
            <select value={bulkMes} onChange={e => setBulkMes(e.target.value)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #374151', background: '#1F2937', fontSize: 11, color: '#fff' }}>
              <option value="">— (sin cambio)</option>
              {MESES_CORTOS.map((nm, i) => <option key={i+1} value={i+1}>{i+1} — {nm}</option>)}
            </select>
            <button onClick={aplicarMesMasivo} disabled={aplicandoMes} style={{ padding: '4px 12px', borderRadius: 99, border: 'none', background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 12, cursor: 'pointer' }}>
              {aplicandoMes ? 'Aplicando…' : 'Aplicar mes'}
            </button>
          </>)}
          <button onClick={() => { setSelected(new Set()); setBulkMes('') }} style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><X size={15} /></button>
        </div>
      )}

      {editing && <ClasificarPanel movimiento={editing} cuentas={cuentas} subcuentas={subcuentas} cecos={cecos} respaldoTipos={RESPALDO_TIPOS} sugerencia={sugerencias.get(editing.id) ?? null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); invalidateCatalog(); refresh() }} />}
      {showLote && <LoteModal ids={Array.from(selected)} cuentas={cuentas} subcuentas={subcuentas} cecos={cecos} respaldoTipos={RESPALDO_TIPOS} onClose={() => setShowLote(false)} onSaved={() => { setShowLote(false); setSelected(new Set()); refresh() }} />}

      {eliminando && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', padding: 16 }}>
          <div style={{ width: '100%', maxWidth: 440, background: '#fff', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #F3F4F6' }}><div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>¿Eliminar este movimiento?</div></div>
            <div style={{ padding: '14px 20px' }}>
              <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#374151', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div><span style={{ color: '#9CA3AF' }}>Fecha: </span>{eliminando.fecha}</div>
                <div><span style={{ color: '#9CA3AF' }}>Tipo: </span>{eliminando.tipo}</div>
                <div><span style={{ color: '#9CA3AF' }}>Monto: </span>{formatCLP(eliminando.monto)}</div>
                <div><span style={{ color: '#9CA3AF' }}>Descripción: </span>{eliminando.descripcion}</div>
              </div>
              <p style={{ marginTop: 10, fontSize: 13, fontWeight: 500, color: '#DC2626' }}>Esta acción es permanente y no se puede deshacer.</p>
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid #F3F4F6', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setEliminando(null)} disabled={deleting} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #D1D5DB', background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Cancelar</button>
              <button disabled={deleting} onClick={async () => {
                if (!eliminando) return; setDeleting(true)
                const id = eliminando.id
                const { error } = await supabase.from('movimientos_bancarios').delete().eq('id', id)
                setDeleting(false)
                if (error) { toast.error('No se pudo eliminar: ' + error.message); return }
                toast.success('Movimiento eliminado')
                setMovs(prev => prev.filter(x => x.id !== id)); setTotal(t => Math.max(0, t-1)); setEliminando(null)
              }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 7, border: 'none', background: '#DC2626', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: deleting ? 0.6 : 1 }}>
                {deleting && <Loader2 size={13} />} Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
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
