// CierreDelDiaTab.jsx — Módulo unificado de cierre de caja con BSALE
// Reemplaza DeclararCierreTab + CorroborarCierresTab
import { useEffect, useMemo, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Loader2, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, X, CheckCircle2, AlertTriangle, AlertCircle, RefreshCw } from 'lucide-react'
import { supabase } from '../../supabase'
import { preloadCaps, canSync, userScopeSync } from '../../core/permisos'
import { MEDIOS, UMBRALES_DEFAULT, formatCLP, parseCLP, todayISO, inputSt, selectSt, labelSt, cardSt, btnSt, btnOutlineSt, estadoBadge, clasificarPorDiferencia } from './types'
import { fetchSucursales, fetchUmbrales, fetchCierreDelDia, declararCierre, actualizarDeclaracion, corroborarCierre } from './api'

// RBAC-4: PUEDE_VER_TODAS reemplazado por canSync(cu, 'finanzas', 'fin.teso.cierre.ver_todas')

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt(n) { return n == null ? '—' : formatCLP(n) }

function BrechaChip({ valor, umbrales }) {
  if (valor == null) return <span style={{ color: '#9CA3AF', fontSize: 12 }}>—</span>
  const abs = Math.abs(valor)
  const ok = abs <= umbrales.cuadra
  const tol = abs <= umbrales.tolerable
  const color = ok ? '#16A34A' : tol ? '#D97706' : '#DC2626'
  const bg = ok ? '#DCFCE7' : tol ? '#FEF9C3' : '#FEE2E2'
  const Icon = ok ? CheckCircle2 : tol ? AlertCircle : AlertTriangle
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, background: bg, color, fontSize: 12, fontWeight: 600 }}>
      <Icon size={11} />
      {fmt(valor)}
    </span>
  )
}

function MoneyInput({ value, onChange, disabled }) {
  const [text, setText] = useState(value ? formatCLP(value) : '')
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setText(value ? formatCLP(value) : '') }, [value, focused])
  return (
    <input type="text" inputMode="numeric" disabled={disabled} placeholder="$0" value={text}
      style={{ ...inputSt, textAlign: 'right', fontSize: 12, background: disabled ? '#F9FAFB' : '#fff' }}
      onFocus={e => { setFocused(true); setText(value ? String(value) : ''); setTimeout(() => e.target.select(), 0) }}
      onChange={e => { setText(e.target.value); onChange(parseCLP(e.target.value)) }}
      onBlur={() => { setFocused(false); setText(value ? formatCLP(value) : '') }}
    />
  )
}

// ── Fetch BSALE: cache-first, edge function como fallback ──────────────────
async function fetchBsaleDia(fecha, sucursal_id, forzar = false) {
  try {
    // 1) Si no se fuerza, intentar leer de la cache (instantáneo)
    if (!forzar) {
      const { data: cached } = await supabase
        .from('ventas_bsale_dia')
        .select('total_venta, total_nc, docs_venta, docs_nc, medios, por_recaudador, por_vendedor, sincronizado_at')
        .eq('fecha', fecha)
        .eq('sucursal_id', sucursal_id)
        .maybeSingle()
      if (cached && cached.por_recaudador) {
        return {
          total_venta: cached.total_venta,
          medios_global: cached.medios ?? {},
          por_recaudador: cached.por_recaudador ?? [],
          por_vendedor: cached.por_vendedor ?? [],
          docs_sucursal: cached.docs_venta ?? 0,
          fecha, sucursal_id,
          desde_cache: true,
          sincronizado_at: cached.sincronizado_at,
        }
      }
    }
    // 2) Sin cache o forzando: llamar edge function (la guarda en cache)
    const { data: { session } } = await supabase.auth.getSession()
    const headers = { 'Content-Type': 'application/json' }
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bsale-ventas-dia`,
      { method: 'POST', headers, body: JSON.stringify({ fecha, sucursal_id }) }
    )
    if (!res.ok) return null
    return await res.json()
  } catch (e) {
    console.warn('[fetchBsaleDia]', e.message)
    return null
  }
}

// ── Panel declaración de un vendedor ───────────────────────────────────────
function PanelDeclaracion({ vendedorBsale, cierre, sucursalId, fecha, usuario, umbrales, onGuardado }) {
  const [valores, setValores] = useState(() => {
    if (cierre) return MEDIOS.reduce((a, m) => ({ ...a, [m.key]: Number(cierre[m.key] ?? 0) }), {})
    return MEDIOS.reduce((a, m) => ({ ...a, [m.key]: 0 }), {})
  })
  const [obs, setObs] = useState(cierre?.observaciones_vendedor ?? '')
  const [saving, setSaving] = useState(false)
  const [otrosOpen, setOtrosOpen] = useState(false)

  const totalDeclarado = useMemo(() => MEDIOS.reduce((s, m) => s + (valores[m.key] || 0), 0), [valores])
  const recaudBsale = vendedorBsale?.venta ?? null
  const brecha = recaudBsale != null ? totalDeclarado - recaudBsale : null

  const esReadOnly = cierre && cierre.estado !== 'declarado'

  const MEDIOS_PPAL = MEDIOS.filter(m => ['efectivo', 't_credito', 't_debito', 'webpay', 'transferencia'].includes(m.key))
  const MEDIOS_OTROS = MEDIOS.filter(m => !['efectivo', 't_credito', 't_debito', 'webpay', 'transferencia'].includes(m.key))

  async function guardar() {
    if (!sucursalId) { toast.error('Selecciona una sucursal'); return }
    setSaving(true)
    try {
      const payload = {
        fecha, sucursal_id: sucursalId, vendedor_id: usuario.id,
        observaciones_vendedor: obs.trim() || null,
        venta_bsale_api: recaudBsale,
        ...valores
      }
      const result = cierre?.id
        ? await actualizarDeclaracion(cierre.id, payload)
        : await declararCierre(payload)
      toast.success('Cierre guardado')
      onGuardado(result)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar')
    } finally { setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Resumen BSALE del vendedor */}
      {vendedorBsale && (
        <div style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #1a2f4a 100%)', borderRadius: 10, padding: '14px 16px', color: '#fff' }}>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Venta atribuida BSALE
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{fmt(vendedorBsale.venta)}</div>
              <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
                {vendedorBsale.docs_venta} doc{vendedorBsale.docs_venta !== 1 ? 's' : ''}
                {vendedorBsale.nc > 0 && ` · NC: -${fmt(vendedorBsale.nc)}`}
              </div>
            </div>
            {/* Medios de pago BSALE */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
              {Object.entries(vendedorBsale.modalidades ?? {})
                .sort(([, a], [, b]) => Number(b) - Number(a))
                .slice(0, 4)
                .map(([medio, amt]) => (
                  <div key={medio} style={{ fontSize: 10, opacity: 0.8 }}>
                    {medio.split(' ').slice(0, 2).join(' ')}: {fmt(Number(amt))}
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Medios principales */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Medios principales</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {MEDIOS_PPAL.map(med => (
            <div key={med.key}>
              <label style={{ ...labelSt, marginBottom: 3 }}>{med.label}</label>
              <MoneyInput disabled={esReadOnly} value={valores[med.key]} onChange={n => setValores(p => ({ ...p, [med.key]: n }))} />
            </div>
          ))}
        </div>
      </div>

      {/* Otros medios */}
      <div>
        <button onClick={() => setOtrosOpen(v => !v)}
          style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', fontSize: 12, fontWeight: 600, color: '#374151' }}>
          Otros medios
          {otrosOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {otrosOpen && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            {MEDIOS_OTROS.map(med => (
              <div key={med.key}>
                <label style={{ ...labelSt, marginBottom: 3 }}>{med.label}</label>
                <MoneyInput disabled={esReadOnly} value={valores[med.key]} onChange={n => setValores(p => ({ ...p, [med.key]: n }))} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Total y brecha */}
      <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 12px', fontSize: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ color: '#6B7280' }}>Tu declaración</span>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{fmt(totalDeclarado)}</span>
        </div>
        {recaudBsale != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#6B7280' }}>Brecha vs BSALE</span>
            <BrechaChip valor={brecha} umbrales={umbrales} />
          </div>
        )}
      </div>

      {/* Documentos BSALE — auditoría */}
      {vendedorBsale?.documentos?.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            Documentos BSALE ({vendedorBsale.documentos.length})
          </div>
          <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '8px 10px', maxHeight: 200, overflowY: 'auto' }}>
            {vendedorBsale.documentos.map((doc) => (
              <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '0.5px solid #E5E7EB', fontSize: 11 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                  <span style={{
                    background: doc.es_nc ? '#FEE2E2' : doc.tipo?.includes('BOLETA') ? '#DBEAFE' : doc.tipo?.includes('TICKET') ? '#D1FAE5' : '#FEF3C7',
                    color: doc.es_nc ? '#DC2626' : doc.tipo?.includes('BOLETA') ? '#1D4ED8' : doc.tipo?.includes('TICKET') ? '#065F46' : '#92400E',
                    padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 600, flexShrink: 0
                  }}>
                    {doc.es_nc ? 'NC' : doc.tipo?.includes('BOLETA') ? 'BOL' : doc.tipo?.includes('TICKET') ? 'TKT' : 'FAC'}
                  </span>
                  <span style={{ color: '#374151' }}>N° {doc.numero}</span>
                  {doc.es_cruzado && (
                    <span title={`Recaudó: ${doc.recaudador?.nombre} · Vendió: ${doc.vendedor?.nombre}`}
                      style={{
                        background: '#EDE9FE', color: '#5B21B6',
                        padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                        display: 'inline-flex', alignItems: 'center', gap: 3
                      }}>
                      ↔ {doc.recaudador?.id === vendedorBsale.bsale_user_id
                        ? `vendió ${doc.vendedor?.nombre?.split(' ')[0] ?? ''}`
                        : `recaudó ${doc.recaudador?.nombre?.split(' ')[0] ?? ''}`}
                    </span>
                  )}
                </div>
                <span style={{ fontWeight: 600, color: doc.es_nc ? '#DC2626' : '#111827', flexShrink: 0 }}>
                  {doc.total < 0 ? '-' : ''}{new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(Math.abs(doc.total))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Observaciones */}
      <div>
        <label style={labelSt}>Observaciones</label>
        <textarea disabled={esReadOnly} value={obs} onChange={e => setObs(e.target.value)}
          placeholder="Notas opcionales" rows={2}
          style={{ ...inputSt, resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }} />
      </div>

      {!esReadOnly && (
        <button onClick={guardar} disabled={saving} style={{ ...btnSt(), opacity: saving ? 0.6 : 1 }}>
          {saving && <Loader2 size={13} />}
          {cierre ? 'Actualizar cierre' : 'Firmar cierre'}
        </button>
      )}
      {esReadOnly && (
        <div style={{ textAlign: 'center', padding: '8px 0', fontSize: 12, color: '#6B7280' }}>
          {estadoBadge(cierre.estado)} — cierre ya procesado
        </div>
      )}
    </div>
  )
}

// ── Componente principal ───────────────────────────────────────────────────
export function CierreDelDiaTab({ usuario }) {
  const [capsLoaded, setCapsLoaded] = useState(false)

  // Precargar capabilities al montar
  useEffect(() => {
    if (usuario?.id) preloadCaps(usuario, 'finanzas').then(() => setCapsLoaded(true))
  }, [usuario?.id])

  // RBAC-4: determinar modo via capabilities dinámicas
  // ver_todas_sucursales: puede elegir cualquier sucursal y ve todos los cajeros
  // corroborar: puede corroborar cierres de otros
  // declarar: modo cajero — solo ve sus propios datos
  const esAdmin = capsLoaded
    ? canSync(usuario, 'finanzas', 'fin.teso.cierre.ver_todas') !== false
    : usuario?.rol === 'admin'

  const puedeCorroborar = capsLoaded
    ? canSync(usuario, 'finanzas', 'fin.teso.cierre.corroborar') !== false
    : usuario?.rol === 'admin'

  // sucursalFiltro: null = ve todas, 'suc-lg' = solo esa sucursal
  const sucursalFiltro = capsLoaded
    ? userScopeSync(usuario, 'finanzas', 'fin.teso.cierre.corroborar')
    : null

  const [sucursales, setSucursales] = useState([])
  // Si hay filtro de sucursal por rol, forzar ese valor (no puede elegir otra)
  const sucursalForzada = sucursalFiltro  // null = puede elegir cualquiera
  const [sucursalSel, setSucursalSel] = useState(
    sucursalForzada || (esAdmin ? 'suc-lg' : (usuario.sucursal_id ?? ''))
  )

  // Sincronizar sucursalSel con sucursalForzada cuando caps cargan
  useEffect(() => {
    if (sucursalForzada) setSucursalSel(sucursalForzada)
  }, [sucursalForzada])
  const [fecha, setFecha] = useState(todayISO())
  const [umbrales, setUmbrales] = useState(UMBRALES_DEFAULT)

  // Datos BSALE
  const [bsaleData, setBsaleData] = useState(null)
  const [loadingBsale, setLoadingBsale] = useState(false)

  // Cierres declarados del día
  const [cierres, setCierres] = useState([])
  const [loadingCierres, setLoadingCierres] = useState(false)

  // Panel lateral
  const [panelVendedor, setPanelVendedor] = useState(null) // { bsaleUser, cierre }
  const [savingCorrob, setSavingCorrob] = useState(false)
  const [valoresCorrob, setValoresCorrob] = useState(null)
  const [obsAdmin, setObsAdmin] = useState('')

  // Cargar catálogos
  useEffect(() => {
    fetchSucursales().then(setSucursales).catch(() => {})
    fetchUmbrales().then(setUmbrales).catch(() => {})
  }, [])

  // Cargar datos BSALE (cache-first; opción forzar=true salta cache)
  const cargarBsale = useCallback(async (forzar = false) => {
    if (!sucursalSel) return
    setLoadingBsale(true)
    setBsaleData(null)
    try {
      const data = await fetchBsaleDia(fecha, sucursalSel, forzar)
      setBsaleData(data)
    } catch (e) {
      toast.error('Error al cargar BSALE')
    } finally { setLoadingBsale(false) }
  }, [fecha, sucursalSel])

  // Cargar cierres declarados
  const cargarCierres = useCallback(async () => {
    if (!sucursalSel) return
    setLoadingCierres(true)
    try {
      let q = supabase.from('cierres_caja').select('*')
        .eq('fecha', fecha)
        .eq('sucursal_id', sucursalSel)
        .neq('estado', 'anulado')
      // RBAC-4: filtrar por sucursal si el rol tiene scope_filter='sucursal'
      if (sucursalFiltro) q = q.eq('sucursal_id', sucursalFiltro)
      if (!esAdmin && !puedeCorroborar) q = q.eq('vendedor_id', usuario.id)
      const { data, error } = await q
      if (error) throw error

      // Resolver nombres vendedores
      const vIds = [...new Set((data ?? []).map(r => r.vendedor_id).filter(Boolean))]
      let vendMap = {}
      if (vIds.length > 0) {
        const { data: vends } = await supabase.from('usuarios').select('id, nombre').in('id', vIds)
        for (const v of vends ?? []) vendMap[v.id] = v.nombre
      }
      setCierres((data ?? []).map(r => ({
        ...r,
        vendedor_nombre: r.vendedor_id ? (vendMap[r.vendedor_id] ?? null) : null
      })))
    } catch (e) {
      toast.error('Error al cargar cierres')
    } finally { setLoadingCierres(false) }
  }, [fecha, sucursalSel, esAdmin, usuario.id])

  useEffect(() => {
    cargarBsale()
    cargarCierres()
  }, [fecha, sucursalSel])

  // Cruzar RECAUDADORES BSALE con cierres declarados
  // Usamos por_recaudador (no por_vendedor) porque el cierre de caja se cuadra
  // con quien EMITIÓ la venta (tiene la plata), no con el seller asignado.
  const filas = useMemo(() => {
    const recaudadoresBsale = bsaleData?.por_recaudador ?? []
    const result = []

    // Recaudadores con actividad BSALE hoy
    for (const bv of recaudadoresBsale) {
      const cierre = cierres.find(c => {
        return String(c.bsale_vendedor_id) === String(bv.bsale_user_id) ||
          (c.vendedor_nombre ?? '').toUpperCase() === bv.nombre
      })
      result.push({ bsaleUser: bv, cierre: cierre ?? null })
    }

    // Cierres sin actividad BSALE (declaró pero no hay docs en BSALE ese día)
    for (const c of cierres) {
      const yaEsta = result.some(r => r.cierre?.id === c.id)
      if (!yaEsta) result.push({ bsaleUser: null, cierre: c })
    }

    return result
  }, [bsaleData, cierres])

  // KPIs resumen
  const totalBsale = bsaleData?.total_venta ?? null
  const totalDeclarado = cierres.reduce((s, c) => s + Number(c.total_declarado ?? 0), 0)
  const brechaGlobal = totalBsale != null ? totalDeclarado - totalBsale : null
  const pendientes = cierres.filter(c => c.estado === 'declarado').length
  const corroborados = cierres.filter(c => ['cuadra', 'tolerable', 'descuadre'].includes(c.estado)).length

  // Panel lateral: corroborar
  function abrirPanel(fila) {
    setPanelVendedor(fila)
    if (fila.cierre) {
      const v = {}
      for (const med of MEDIOS) v[`${med.key}_corrob`] = Number(fila.cierre[`${med.key}_corrob`] ?? fila.cierre[med.key] ?? 0)
      setValoresCorrob(v)
      setObsAdmin(fila.cierre.observaciones_admin ?? '')
    } else {
      setValoresCorrob(null)
      setObsAdmin('')
    }
  }

  async function handleCorrob() {
    if (!panelVendedor?.cierre || !valoresCorrob) return
    setSavingCorrob(true)
    try {
      const updated = await corroborarCierre({ id: panelVendedor.cierre.id, ...valoresCorrob, observaciones_admin: obsAdmin.trim() || null })
      toast.success(`Corroborado — estado: ${updated.estado}`)
      setCierres(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated, vendedor_nombre: c.vendedor_nombre } : c))
      setPanelVendedor(null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error') }
    finally { setSavingCorrob(false) }
  }

  const totalCorrobPanel = useMemo(() => {
    if (!valoresCorrob) return 0
    return MEDIOS.reduce((s, m) => s + Number(valoresCorrob[`${m.key}_corrob`] ?? 0), 0)
  }, [valoresCorrob])

  const diferenciaPanel = panelVendedor?.cierre ? totalCorrobPanel - Number(panelVendedor.cierre.total_declarado ?? 0) : 0
  const obsRequerida = diferenciaPanel !== 0 && obsAdmin.trim() === ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Filtros ── */}
      <div style={cardSt}>
        <div style={{ display: 'grid', gridTemplateColumns: (esAdmin || puedeCorroborar) ? '1fr 1fr auto auto' : '1fr auto auto', gap: 12, alignItems: 'flex-end' }}>
          {(esAdmin || puedeCorroborar) && (
            <div>
              <label style={labelSt}>Sucursal</label>
              <select style={{...selectSt, opacity: sucursalForzada ? 0.6 : 1}} value={sucursalSel} onChange={e => !sucursalForzada && setSucursalSel(e.target.value)} disabled={!!sucursalForzada}>
                {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
              {sucursalForzada && <div style={{fontSize:11,color:'#8E8E93',marginTop:3}}>Restringido a tu sucursal</div>}
            </div>
          )}
          <div>
            <label style={labelSt}>Fecha</label>
            <input type="date" style={inputSt} value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            <button onClick={() => { cargarBsale(true); cargarCierres() }}
              style={{ ...btnSt('#6B7280'), padding: '8px 14px' }}
              disabled={loadingBsale || loadingCierres}
              title="Refrescar desde BSALE (fuerza re-sincronización)">
              {(loadingBsale || loadingCierres)
                ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                : <RefreshCw size={14} />}
            </button>
          </div>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        {[
          { label: 'Venta BSALE', value: totalBsale, loading: loadingBsale, color: '#1e3a5f' },
          { label: 'Total declarado', value: totalDeclarado || null, color: '#374151' },
          { label: 'Brecha global', value: brechaGlobal, isBrecha: true, color: '#374151' },
          { label: 'Pendientes', value: pendientes, isCuenta: true, color: pendientes > 0 ? '#D97706' : '#16A34A' },
          { label: 'Corroborados', value: corroborados, isCuenta: true, color: '#16A34A' },
        ].map(kpi => (
          <div key={kpi.label} style={{ ...cardSt, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              {kpi.label}
            </div>
            {kpi.loading
              ? <Loader2 size={16} style={{ color: '#9CA3AF' }} />
              : kpi.isCuenta
                ? <div style={{ fontSize: 22, fontWeight: 700, color: kpi.color }}>{kpi.value ?? 0}</div>
                : kpi.isBrecha && brechaGlobal != null
                  ? <BrechaChip valor={brechaGlobal} umbrales={umbrales} />
                  : <div style={{ fontSize: 18, fontWeight: 700, color: kpi.color }}>{kpi.value != null ? fmt(kpi.value) : '—'}</div>
            }
          </div>
        ))}
      </div>

      {/* ── Medios de pago globales BSALE ── */}
      {bsaleData?.medios_global && Object.keys(bsaleData.medios_global).length > 0 && (
        <div style={{ ...cardSt, padding: '12px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Desglose BSALE por medio de pago
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(bsaleData.medios_global)
              .sort(([, a], [, b]) => Number(b) - Number(a))
              .map(([medio, amt]) => (
                <div key={medio} style={{ background: '#F3F4F6', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>
                  <span style={{ color: '#6B7280' }}>{medio}: </span>
                  <span style={{ fontWeight: 600, color: '#111827' }}>{fmt(Number(amt))}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── Tabla de vendedores ── */}
      <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F9FAFB' }}>
                {['Vendedor', 'Venta BSALE', 'Venta BSALE', 'Declarado', 'Brecha', 'Estado', ''].map(h => (
                  <th key={h} style={{
                    padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6B7280',
                    textAlign: ['Venta BSALE', 'Venta BSALE', 'Declarado', 'Brecha'].includes(h) ? 'right' : 'left',
                    borderBottom: '1px solid #E5E7EB', whiteSpace: 'nowrap'
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(loadingBsale || loadingCierres) && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '32px 0' }}>
                  <Loader2 size={20} style={{ display: 'inline-block', color: '#9CA3AF' }} />
                </td></tr>
              )}
              {!loadingBsale && !loadingCierres && filas.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '32px 0', color: '#9CA3AF', fontSize: 13 }}>
                  Sin actividad para esta fecha y sucursal
                </td></tr>
              )}
              {!loadingBsale && !loadingCierres && filas.map((fila, i) => {
                const { bsaleUser, cierre } = fila
                const recaud = bsaleUser?.venta ?? null
                const declarado = cierre ? Number(cierre.total_declarado ?? 0) : null
                const brecha = recaud != null && declarado != null ? declarado - recaud : null
                const estado = cierre?.estado ?? null
                const nombre = bsaleUser?.nombre ?? cierre?.vendedor_nombre ?? '—'

                return (
                  <tr key={i}
                    style={{ borderTop: '1px solid #F3F4F6', cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#F9FAFB'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    onClick={() => abrirPanel(fila)}>
                    <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 500 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: '50%', background: '#E0E7FF',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700, color: '#4F46E5', flexShrink: 0
                        }}>
                          {nombre.split(' ').map(w => w[0]).join('').slice(0, 2)}
                        </div>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{nombre}</div>
                          {bsaleUser && (
                            <div style={{ fontSize: 10, color: '#9CA3AF' }}>
                              {bsaleUser.docs_venta} doc{bsaleUser.docs_venta !== 1 ? 's' : ''}
                              {bsaleUser.nc > 0 && ` · ${bsaleUser.docs_nc} NC`}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, fontSize: 13 }}>
                      {recaud != null ? fmt(recaud) : <span style={{ color: '#D1D5DB' }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, color: '#6B7280' }}>
                      {bsaleUser?.venta != null ? fmt(bsaleUser.venta) : <span style={{ color: '#D1D5DB' }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13 }}>
                      {declarado != null ? fmt(declarado) : (
                        <span style={{ fontSize: 11, color: '#9CA3AF', background: '#FEF9C3', padding: '2px 6px', borderRadius: 4 }}>Pendiente</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                      <BrechaChip valor={brecha} umbrales={umbrales} />
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {estado ? estadoBadge(estado) : <span style={{ fontSize: 11, color: '#9CA3AF' }}>Sin cierre</span>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ fontSize: 12, color: '#4F46E5', fontWeight: 500 }}>
                        {cierre?.estado === 'declarado' ? 'Corroborar →' : cierre ? 'Ver →' : (esAdmin || puedeCorroborar) ? 'Ver →' : 'Declarar →'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Panel lateral ── */}
      {panelVendedor && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex' }}>
          <div style={{ flex: 1, background: 'rgba(0,0,0,0.4)' }} onClick={() => setPanelVendedor(null)} />
          <aside style={{
            width: 520, maxWidth: '100%', height: '100%', background: '#fff',
            display: 'flex', flexDirection: 'column',
            boxShadow: '-4px 0 32px rgba(0,0,0,0.15)', overflowY: 'auto'
          }}>

            {/* Header panel */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #F3F4F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>
                  {panelVendedor.bsaleUser?.nombre ?? panelVendedor.cierre?.vendedor_nombre ?? 'Vendedor'}
                </div>
                <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{fecha}</div>
              </div>
              <button onClick={() => setPanelVendedor(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ flex: 1, padding: '16px 20px', overflowY: 'auto' }}>

              {/* Si es el propio vendedor o no hay cierre → panel declaración */}
              {(!esAdmin && !puedeCorroborar) && !panelVendedor.cierre && (
                <PanelDeclaracion
                  vendedorBsale={panelVendedor.bsaleUser}
                  cierre={panelVendedor.cierre}
                  sucursalId={sucursalSel}
                  fecha={fecha}
                  usuario={usuario}
                  umbrales={umbrales}
                  onGuardado={result => {
                    setCierres(prev => {
                      const existe = prev.find(c => c.id === result.id)
                      if (existe) return prev.map(c => c.id === result.id ? { ...c, ...result } : c)
                      return [...prev, result]
                    })
                    setPanelVendedor(null)
                  }}
                />
              )}

              {/* Panel corroboración admin */}
              {(esAdmin || puedeCorroborar) && panelVendedor.cierre && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                  {/* BSALE del vendedor */}
                  {panelVendedor.bsaleUser && (
                    <div style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #1a2f4a 100%)', borderRadius: 10, padding: '12px 14px', color: '#fff' }}>
                      <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Venta BSALE</div>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(panelVendedor.bsaleUser.venta)}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                        {Object.entries(panelVendedor.bsaleUser.modalidades ?? {}).map(([medio, amt]) => (
                          <span key={medio} style={{ fontSize: 10, background: 'rgba(255,255,255,0.15)', padding: '2px 6px', borderRadius: 4 }}>
                            {medio.split(' ').slice(0, 2).join(' ')}: {fmt(Number(amt))}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Declaración del vendedor */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Lo que declaró</div>
                    <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 12px' }}>
                      {MEDIOS.map(med => (
                        <div key={med.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
                          <span style={{ color: '#6B7280' }}>{med.label}</span>
                          <span>{fmt(Number(panelVendedor.cierre[med.key] ?? 0))}</span>
                        </div>
                      ))}
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #E5E7EB', marginTop: 6, paddingTop: 6, fontWeight: 700, fontSize: 13 }}>
                        <span>Total declarado</span>
                        <span>{fmt(Number(panelVendedor.cierre.total_declarado ?? 0))}</span>
                      </div>
                    </div>
                  </div>

                  {/* Corroboración admin */}
                  {panelVendedor.cierre.estado === 'declarado' && valoresCorrob && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Corroborar</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {MEDIOS.map(med => (
                          <div key={med.key} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', gap: 8 }}>
                            <label style={{ ...labelSt, marginBottom: 0, fontSize: 11 }}>{med.label}</label>
                            <MoneyInput value={valoresCorrob[`${med.key}_corrob`]}
                              onChange={n => setValoresCorrob(p => ({ ...p, [`${med.key}_corrob`]: n }))} />
                          </div>
                        ))}
                      </div>
                      <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 12px', marginTop: 10, fontSize: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ color: '#6B7280' }}>Total corroborado</span>
                          <span style={{ fontWeight: 600 }}>{fmt(totalCorrobPanel)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#6B7280' }}>Diferencia</span>
                          <BrechaChip valor={diferenciaPanel} umbrales={umbrales} />
                        </div>
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <label style={labelSt}>Observaciones admin {diferenciaPanel !== 0 && <span style={{ color: '#DC2626' }}>*</span>}</label>
                        <textarea value={obsAdmin} onChange={e => setObsAdmin(e.target.value)} rows={2}
                          placeholder={diferenciaPanel !== 0 ? 'Obligatorio: explica la diferencia' : 'Opcional'}
                          style={{ ...inputSt, resize: 'vertical', fontFamily: 'inherit', borderColor: obsRequerida ? '#DC2626' : '#D1D5DB' }} />
                      </div>
                    </div>
                  )}

                  {panelVendedor.cierre.estado !== 'declarado' && (
                    <div style={{ textAlign: 'center', padding: 8 }}>
                      {estadoBadge(panelVendedor.cierre.estado)}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer panel */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid #F3F4F6', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setPanelVendedor(null)} style={btnOutlineSt}>Cerrar</button>
              {(esAdmin || puedeCorroborar) && panelVendedor.cierre?.estado === 'declarado' && valoresCorrob && (
                <button onClick={handleCorrob} disabled={savingCorrob || obsRequerida}
                  style={{ ...btnSt(), opacity: savingCorrob || obsRequerida ? 0.6 : 1 }}>
                  {savingCorrob && <Loader2 size={13} />}
                  Confirmar corroboración
                </button>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
