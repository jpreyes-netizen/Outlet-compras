import { useEffect, useMemo, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Search, X, Loader2, Link2, Unlink, RefreshCw, Check } from 'lucide-react'
import { supabase } from '../../supabase'
import { extraerRut } from './types'

const PRIMARY = '#1F4E79'

function fmtCLP(n) {
  return '$' + Math.round(Number(n) || 0).toLocaleString('es-CL')
}

function fmtUSD(n) {
  return 'US$' + (Number(n) || 0).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function esUSD(cuota) {
  return cuota && cuota.moneda && cuota.moneda.toUpperCase() === 'USD'
}

// Normaliza un RUT a formato comparable: sin puntos, mayúscula, sin ceros izq.
// Devuelve null si no parece un RUT real (vacío, "Importador", etc.)
function rutComparable(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  if (!/\d/.test(s)) return null              // "Importador" u otro texto
  const limpio = s.replace(/\./g, '').replace(/^0+/, '').toUpperCase()
  if (!/^\d{6,9}-?[\dK]?$/.test(limpio)) return null
  return limpio.replace(/-/g, '')             // comparar solo dígitos+DV juntos
}

// Score de coincidencia entre una cuota y un egreso candidato.
// Funciona para ambos circuitos:
//  - Cuota CLP ↔ mov Santander: compara monto CLP, RUT desde descripción.
//  - Cuota USD ↔ mov Global66: compara monto_usd, y usa oc_id/proveedor_id
//    del propio registro Global66 (match casi directo si ya trae la OC).
function scoreMatch(cuota, mov, rutProveedor) {
  const montoPend = cuota._montoPendiente
  const montoMov = mov._montoComparable   // ya viene en la moneda correcta y positivo
  if (montoPend <= 0 || montoMov <= 0) return { score: 0, nivel: 'bajo', razon: '' }

  let score = 0
  const razones = []

  // Señal MONTO (hasta 55)
  const difPct = Math.abs(1 - montoMov / montoPend)
  if (difPct <= 0.005) { score += 55; razones.push('monto exacto') }
  else if (difPct <= 0.02) { score += 45; razones.push('monto ~igual') }
  else if (difPct <= 0.05) { score += 30; razones.push('monto cercano') }
  else if (difPct <= 0.15) { score += 12; razones.push('monto aproximado') }

  if (mov._fuente === 'global66') {
    // Señal OC directa (hasta 40): el pago Global66 ya dice a qué OC va
    if (mov.oc_id && cuota.oc_id && String(mov.oc_id).includes(cuota.oc_id)) {
      score += 40; razones.push('OC coincide')
    } else if (mov.proveedor_id && cuota._provId && mov.proveedor_id === cuota._provId) {
      score += 30; razones.push('proveedor coincide')
    }
  } else {
    // Santander: señal RUT (hasta 35) si el proveedor tiene RUT comparable
    const rutProv = rutComparable(rutProveedor)
    if (rutProv) {
      const rutMov = extraerRut(mov.descripcion || '')
      const rutMovNorm = rutMov ? rutMov.replace(/-/g, '').toUpperCase() : null
      if (rutMovNorm && rutMovNorm === rutProv) { score += 35; razones.push('RUT coincide') }
      else if (rutMovNorm && rutMovNorm !== rutProv) { score -= 15 }
    }
  }

  // Señal FECHA (hasta 12)
  const fProg = cuota.fecha_programada || cuota.fecha_proyectada
  if (fProg && mov._fecha) {
    const dias = Math.abs((new Date(mov._fecha) - new Date(fProg)) / 86400000)
    if (dias <= 2) { score += 12; razones.push('fecha exacta') }
    else if (dias <= 7) { score += 8; razones.push('misma semana') }
    else if (dias <= 20) { score += 3 }
  }

  score = Math.max(0, Math.min(100, score))
  const nivel = score >= 70 ? 'alto' : score >= 40 ? 'medio' : 'bajo'
  return { score, nivel, razon: razones.join(' · ') || 'sin coincidencias claras' }
}

const NIVEL_STYLE = {
  alto:  { bg: '#DCFCE7', fg: '#15803D', label: 'alta' },
  medio: { bg: '#FEF3C7', fg: '#B45309', label: 'media' },
  bajo:  { bg: '#F3F4F6', fg: '#6B7280', label: 'baja' },
}

export function ConciliarPagosOCTab() {
  const [cuotas, setCuotas] = useState([])      // pagos pendientes/parciales + datos OC/proveedor
  const [movs, setMovs] = useState([])          // movimientos CARGO sin conciliar (o parcial)
  const [vinculos, setVinculos] = useState([])  // conciliacion_pago_mov existentes
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState(null)          // cuota seleccionada (id)
  const [busqCuota, setBusqCuota] = useState('')
  const [busqMov, setBusqMov] = useState('')
  const [userId, setUserId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const recargar = useCallback(() => setReloadKey(k => k + 1), [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const { data: sess } = await supabase.auth.getSession()
        if (!cancelled) setUserId(sess?.session?.user?.id ?? null)

        // 1) Cuotas con saldo de conciliación pendiente
        const { data: pagosData, error: pErr } = await supabase
          .from('pagos')
          .select('id, oc_id, concepto, monto, moneda, monto_clp, estado, estado_conciliacion, monto_pagado_acum, fecha_programada, fecha_proyectada')
          .neq('estado_conciliacion', 'conciliado')
          .order('fecha_programada', { ascending: true, nullsFirst: false })
        if (pErr) throw pErr

        // 2) OCs y proveedores para enriquecer las cuotas
        const ocIds = [...new Set((pagosData ?? []).map(p => p.oc_id).filter(Boolean))]
        let ocById = new Map(), provById = new Map()
        if (ocIds.length) {
          const { data: ocData } = await supabase
            .from('ordenes_compra').select('id, proveedor_id').in('id', ocIds)
          for (const o of ocData ?? []) ocById.set(o.id, o)
          const provIds = [...new Set((ocData ?? []).map(o => o.proveedor_id).filter(Boolean))]
          if (provIds.length) {
            const { data: provData } = await supabase
              .from('proveedores').select('id, nombre, rut').in('id', provIds)
            for (const pv of provData ?? []) provById.set(pv.id, pv)
          }
        }

        // 3a) Movimientos Santander reales (excluir sintéticos global66/credito)
        const { data: movSant, error: mErr } = await supabase
          .from('movimientos_bancarios')
          .select('id, fecha, monto, descripcion, tipo, conciliado_at, origen')
          .eq('tipo', 'CARGO')
          .eq('origen', 'banco')
          .order('fecha', { ascending: false })
          .limit(3000)
        if (mErr) throw mErr

        // 3b) Pagos USD reales de Global66 (solo pagos a proveedor)
        const { data: g66Data, error: gErr } = await supabase
          .from('global66_movimientos')
          .select('id, fecha_transaccion, monto_usd, tercero_nombre, comentario, oc_id, proveedor_id, conciliado_at, tipo')
          .eq('tipo', 'pago_usd')
          .order('fecha_transaccion', { ascending: false })
          .limit(2000)
        if (gErr) throw gErr

        // 4) Vínculos existentes (ambas fuentes)
        const { data: vincData } = await supabase
          .from('conciliacion_pago_mov')
          .select('id, pago_id, movimiento_id, global66_mov_id, monto_aplicado')

        if (cancelled) return

        const enriquecidas = (pagosData ?? []).map(p => {
          const oc = ocById.get(p.oc_id)
          const prov = oc ? provById.get(oc.proveedor_id) : null
          const usd = p.moneda && p.moneda.toUpperCase() === 'USD'
          // Para USD el monto base es en USD (monto), para CLP en CLP (monto).
          const base = Number(p.monto)
          const acum = Number(p.monto_pagado_acum) || 0
          return {
            ...p,
            _provNombre: prov?.nombre || p.oc_id || '—',
            _provRut: prov?.rut || null,
            _provId: oc?.proveedor_id || null,
            _esUSD: usd,
            _montoBase: base,
            _montoPendiente: Math.max(0, base - acum),
          }
        })

        // Normalizar ambas fuentes a forma común
        const movsSant = (movSant ?? []).map(m => ({
          ...m,
          _fuente: 'santander',
          _fecha: m.fecha,
          _montoComparable: Math.abs(Number(m.monto) || 0),  // CLP
          _label: m.descripcion,
        }))
        const movsG66 = (g66Data ?? []).map(m => ({
          ...m,
          id: m.id,
          _fuente: 'global66',
          _fecha: m.fecha_transaccion ? String(m.fecha_transaccion).slice(0, 10) : null,
          _montoComparable: Math.abs(Number(m.monto_usd) || 0),  // USD
          _label: m.tercero_nombre ? `${m.tercero_nombre}${m.comentario ? ' · ' + m.comentario : ''}` : (m.comentario || m.oc_id || '—'),
        }))

        setCuotas(enriquecidas)
        setMovs([...movsSant, ...movsG66])
        setVinculos(vincData ?? [])
      } catch (e) {
        toast.error('Error cargando datos: ' + (e.message || e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [reloadKey])

  // Monto ya aplicado de cada movimiento (para mostrar saldo del egreso)
  const aplicadoPorMov = useMemo(() => {
    const m = new Map()
    for (const v of vinculos) {
      const key = v.movimiento_id || v.global66_mov_id
      if (key) m.set(key, (m.get(key) || 0) + Number(v.monto_aplicado))
    }
    return m
  }, [vinculos])

  const cuotaSel = useMemo(() => cuotas.find(c => c.id === sel) || null, [cuotas, sel])

  const cuotasFiltradas = useMemo(() => {
    const q = busqCuota.trim().toLowerCase()
    if (!q) return cuotas
    return cuotas.filter(c =>
      (c.oc_id || '').toLowerCase().includes(q) ||
      (c._provNombre || '').toLowerCase().includes(q) ||
      (c.concepto || '').toLowerCase().includes(q))
  }, [cuotas, busqCuota])

  // Egresos ordenados por score respecto a la cuota seleccionada.
  // CLAVE: filtra por circuito — cuota USD solo ve Global66, cuota CLP solo Santander.
  const movsConScore = useMemo(() => {
    const q = busqMov.trim().toLowerCase()
    // Si hay cuota seleccionada, restringir la fuente según su moneda
    let fuente = movs
    if (cuotaSel) {
      const objetivo = cuotaSel._esUSD ? 'global66' : 'santander'
      fuente = movs.filter(mv => mv._fuente === objetivo)
    }
    let lista = fuente.map(mv => {
      const aplicado = aplicadoPorMov.get(mv.id) || 0
      const saldoMov = mv._montoComparable - aplicado
      const sc = cuotaSel ? scoreMatch(cuotaSel, mv, cuotaSel._provRut) : { score: 0, nivel: 'bajo', razon: '' }
      return { ...mv, _aplicado: aplicado, _saldoMov: saldoMov, ...sc }
    }).filter(mv => mv._saldoMov > 0.01) // ocultar egresos ya 100% aplicados
    if (q) lista = lista.filter(mv => (mv._label || '').toLowerCase().includes(q))
    if (cuotaSel) lista.sort((a, b) => b.score - a.score)
    else lista.sort((a, b) => new Date(b._fecha) - new Date(a._fecha))
    return lista.slice(0, 200)
  }, [movs, cuotaSel, aplicadoPorMov, busqMov])

  // Vínculos existentes de la cuota seleccionada
  const vinculosSel = useMemo(() => {
    if (!cuotaSel) return []
    return vinculos.filter(v => v.pago_id === cuotaSel.id)
      .map(v => ({ ...v, mov: movs.find(m => m.id === (v.movimiento_id || v.global66_mov_id)) }))
  }, [vinculos, cuotaSel, movs])

  async function vincular(mov) {
    if (!cuotaSel) return
    const usd = cuotaSel._esUSD
    const fmtMon = usd ? fmtUSD : fmtCLP
    const sugerido = Math.min(cuotaSel._montoPendiente, mov._saldoMov)
    const entrada = window.prompt(
      `Monto a aplicar de este egreso a la cuota ${cuotaSel.oc_id} (${cuotaSel.concepto}).\n` +
      `Moneda: ${usd ? 'USD' : 'CLP'}\n\n` +
      `Pendiente de la cuota: ${fmtMon(cuotaSel._montoPendiente)}\n` +
      `Saldo del egreso: ${fmtMon(mov._saldoMov)}`,
      usd ? String(sugerido) : String(Math.round(sugerido))
    )
    if (entrada === null) return
    const monto = usd ? Number(entrada) : Math.round(Number(entrada))
    if (!monto || monto <= 0) { toast.error('Monto inválido'); return }
    if (monto > mov._saldoMov + (usd ? 0.01 : 1)) { toast.error('El monto supera el saldo del egreso'); return }
    if (monto > cuotaSel._montoPendiente + (usd ? 0.01 : 1)) {
      if (!window.confirm('El monto supera lo pendiente de la cuota. ¿Continuar igual?')) return
    }
    setSaving(true)
    try {
      const fila = {
        pago_id: cuotaSel.id,
        monto_aplicado: monto,
        asignado_por: userId,
      }
      if (mov._fuente === 'global66') fila.global66_mov_id = mov.id
      else fila.movimiento_id = mov.id
      const { error } = await supabase.from('conciliacion_pago_mov').insert(fila)
      if (error) throw error
      toast.success('Vínculo creado')
      recargar()
    } catch (e) {
      toast.error('Error: ' + (e.message || e))
    } finally {
      setSaving(false)
    }
  }

  async function desvincular(vinculoId) {
    if (!window.confirm('¿Quitar este vínculo? La cuota volverá a recalcular su estado.')) return
    setSaving(true)
    try {
      const { error } = await supabase.from('conciliacion_pago_mov').delete().eq('id', vinculoId)
      if (error) throw error
      toast.success('Vínculo eliminado')
      recargar()
    } catch (e) {
      toast.error('Error: ' + (e.message || e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#6B7280' }}>
      <Loader2 size={20} className="spin" style={{ animation: 'spin 1s linear infinite' }} /> Cargando…
    </div>
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: '#6B7280' }}>
          Conciliá cuotas de OC con egresos de la cartola. El sistema sugiere por RUT, monto y fecha; la asignación es manual.
        </div>
        <button onClick={recargar} disabled={saving} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600,
          background: '#fff', border: '1px solid #E5E7EB', borderRadius: 7, cursor: 'pointer', color: PRIMARY,
        }}><RefreshCw size={13} /> Recargar</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

        {/* ── Columna izquierda: cuotas pendientes ── */}
        <div style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
              Cuotas pendientes <span style={{ color: '#9CA3AF', fontWeight: 400 }}>· {cuotasFiltradas.length}</span>
            </span>
          </div>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <Search size={13} style={{ position: 'absolute', left: 8, top: 9, color: '#9CA3AF' }} />
            <input value={busqCuota} onChange={e => setBusqCuota(e.target.value)} placeholder="Buscar OC, proveedor…"
              style={{ width: '100%', padding: '6px 8px 6px 26px', fontSize: 12, border: '1px solid #E5E7EB', borderRadius: 7, boxSizing: 'border-box' }} />
          </div>
          <div style={{ maxHeight: 460, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {cuotasFiltradas.map(c => {
              const activa = c.id === sel
              const esParcial = c.estado_conciliacion === 'parcial'
              const pctConc = c._montoBase > 0 ? Math.round((Number(c.monto_pagado_acum) || 0) / c._montoBase * 100) : 0
              return (
                <div key={c.id} onClick={() => setSel(c.id)} style={{
                  border: activa ? '2px solid #1F4E79' : '0.5px solid #E5E7EB',
                  borderRadius: 8, padding: 10, cursor: 'pointer',
                  background: activa ? '#F8FAFC' : '#fff',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{c.oc_id}</span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{c._esUSD ? fmtUSD(c._montoBase) : fmtCLP(c._montoBase)}{c._esUSD ? ' (USD)' : ''}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{c._provNombre} · {c.concepto}</div>
                  {esParcial && (
                    <div style={{ marginTop: 6 }}>
                      <span style={{ fontSize: 11, background: '#FEF3C7', color: '#B45309', padding: '2px 8px', borderRadius: 6 }}>
                        parcial · {pctConc}% · falta {c._esUSD ? fmtUSD(c._montoPendiente) : fmtCLP(c._montoPendiente)}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
            {cuotasFiltradas.length === 0 && <div style={{ fontSize: 12, color: '#9CA3AF', padding: 12 }}>Sin cuotas pendientes.</div>}
          </div>
        </div>

        {/* ── Columna derecha: egresos ── */}
        <div style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 8 }}>
            Egresos {cuotaSel
              ? <span style={{ color: cuotaSel._esUSD ? '#7C3AED' : '#15803D', fontWeight: 600 }}>{cuotaSel._esUSD ? 'Global66 (USD)' : 'Santander (CLP)'}</span>
              : <span style={{ color: '#9CA3AF', fontWeight: 400 }}>· elegí una cuota a la izquierda</span>}
            {cuotaSel && <span style={{ color: '#9CA3AF', fontWeight: 400 }}> · ordenados por coincidencia</span>}
          </div>

          {/* Vínculos existentes de la cuota seleccionada */}
          {cuotaSel && vinculosSel.length > 0 && (
            <div style={{ marginBottom: 10, padding: 8, background: '#F0FDF4', borderRadius: 8, border: '0.5px solid #BBF7D0' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#15803D', marginBottom: 6 }}>Ya vinculado a esta cuota:</div>
              {vinculosSel.map(v => (
                <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: '#374151' }}>
                    {v.mov ? `${v.mov._fecha} · ${(v.mov._label || '').slice(0, 30)}` : (v.movimiento_id || v.global66_mov_id)} → {cuotaSel._esUSD ? fmtUSD(v.monto_aplicado) : fmtCLP(v.monto_aplicado)}
                  </span>
                  <button onClick={() => desvincular(v.id)} disabled={saving} title="Quitar vínculo"
                    style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '2px 8px', fontSize: 11, background: '#FEE2E2', color: '#B91C1C', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
                    <Unlink size={11} /> quitar
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ position: 'relative', marginBottom: 10 }}>
            <Search size={13} style={{ position: 'absolute', left: 8, top: 9, color: '#9CA3AF' }} />
            <input value={busqMov} onChange={e => setBusqMov(e.target.value)} placeholder="Buscar en descripción…"
              style={{ width: '100%', padding: '6px 8px 6px 26px', fontSize: 12, border: '1px solid #E5E7EB', borderRadius: 7, boxSizing: 'border-box' }} />
          </div>

          <div style={{ maxHeight: 460, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {movsConScore.map(mv => {
              const st = NIVEL_STYLE[mv.nivel]
              return (
                <div key={mv.id} style={{ border: '0.5px solid #E5E7EB', borderRadius: 8, padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{mv._fecha}</span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{mv._fuente === 'global66' ? fmtUSD(mv._montoComparable) : fmtCLP(mv._montoComparable)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {mv._label}
                  </div>
                  {mv._aplicado > 0 && (
                    <div style={{ fontSize: 11, color: '#B45309', marginTop: 2 }}>ya aplicado {mv._fuente === 'global66' ? fmtUSD(mv._aplicado) : fmtCLP(mv._aplicado)} · saldo {mv._fuente === 'global66' ? fmtUSD(mv._saldoMov) : fmtCLP(mv._saldoMov)}</div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                    {cuotaSel
                      ? <span style={{ fontSize: 11, background: st.bg, color: st.fg, padding: '2px 8px', borderRadius: 6 }}>
                          {st.label}{mv.razon ? ` · ${mv.razon}` : ''}
                        </span>
                      : <span />}
                    <button onClick={() => vincular(mv)} disabled={!cuotaSel || saving}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: 12, fontWeight: 600,
                        background: cuotaSel ? PRIMARY : '#E5E7EB', color: cuotaSel ? '#fff' : '#9CA3AF',
                        border: 'none', borderRadius: 6, cursor: cuotaSel ? 'pointer' : 'not-allowed',
                      }}>
                      <Link2 size={12} /> vincular
                    </button>
                  </div>
                </div>
              )
            })}
            {movsConScore.length === 0 && <div style={{ fontSize: 12, color: '#9CA3AF', padding: 12 }}>Sin egresos disponibles.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
