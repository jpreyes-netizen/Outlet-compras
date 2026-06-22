import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../supabase'
import { fetchMovimientos, vincularRespaldo, extraerRut, calcularMatchScore } from './api_conciliar'
import { MovimientosPanel } from './MovimientosPanel'
import { ConciliarPanelUnificado } from './ConciliarPanelUnificado'

export function ConciliarRespaldosTab() {
  const [filtros, setFiltros] = useState({ estado: 'todos', desde: null, hasta: null, texto: '', soloCargo: true })
  const [movimientos, setMovimientos] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [multiSel, setMultiSel] = useState([])
  const [autoRunning, setAutoRunning] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [ultimaSync, setUltimaSync] = useState(null)

  // Cargar estado de la última sincronización BSALE
  useEffect(() => {
    supabase.from('bsale_sync_log')
      .select('created_at, tipo, docs_traidos, docs_nuevos, estado')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => { if (data?.[0]) setUltimaSync(data[0]) })
  }, [reloadKey])

  // Invoca la Edge Function bsale-sync para compras del mes actual
  async function sincronizarBsale() {
    setSyncing(true)
    const toastId = toast.loading('Sincronizando facturas desde BSALE…')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sesión no disponible')
      const hoy = new Date()
      const res = await fetch('https://hutrxzxygjkemgcirqid.supabase.co/functions/v1/bsale-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
        body: JSON.stringify({ tipo: 'compras', anio: hoy.getFullYear(), meses: [hoy.getMonth() + 1], origen: 'manual' }),
      })
      const r = await res.json()
      if (!r.ok) throw new Error(r.error || 'Error en sincronización')
      toast.success(`${r.docs_traidos} facturas (${r.docs_nuevos} nuevas) sincronizadas`, { id: toastId })
      setReloadKey(k => k + 1)
    } catch (e) {
      toast.error('Error sincronizando: ' + (e instanceof Error ? e.message : '?'), { id: toastId })
    } finally { setSyncing(false) }
  }

  useEffect(() => {
    setLoading(true)
    fetchMovimientos(filtros).then(setMovimientos).catch(e => toast.error(e.message)).finally(() => setLoading(false))
  }, [filtros, reloadKey])

  useEffect(() => {
    if (selectedId && !movimientos.some(m => m.movimiento_id === selectedId)) setSelectedId(null)
  }, [movimientos, selectedId])

  const selected = movimientos.find(m => m.movimiento_id === selectedId) ?? null

  function refrescar() { setReloadKey(k => k + 1) }

  async function handleAutoMatch() {
    setAutoRunning(true)
    const toastId = toast.loading('Auto-conciliando con score IA…')
    try {
      const candidatos = movimientos.filter(m => m.tipo === 'CARGO' && m.estado_conciliacion === 'sin_conciliar')
      let conciliados = 0, sinMatch = 0, ambiguos = 0

      for (const m of candidatos) {
        const rut = extraerRut(m.descripcion)
        // Sin RUT: skip (capa 1 aún no maneja sin RUT — eso es capa 2 con memoria)
        if (!rut) { sinMatch++; continue }

        // Buscar facturas del mismo RUT, no pagadas
        const { data: facs } = await supabase.from('libro_compras')
          .select('id, fecha_emision, folio, rut_proveedor, razon_social, monto_total')
          .eq('rut_proveedor', rut).limit(50)
        if (!facs || facs.length === 0) { sinMatch++; continue }

        // Enriquecer con saldo
        const ids = facs.map(f => f.id)
        const { data: estados } = await supabase.from('v_estado_factura')
          .select('factura_id, total_pagado, saldo, estado_factura').in('factura_id', ids)
        const estMap = new Map((estados ?? []).map(e => [e.factura_id, e]))

        const conScore = facs.map(f => {
          const e = estMap.get(f.id)
          const fEnriched = { ...f, saldo: e?.saldo ?? f.monto_total, total_pagado: e?.total_pagado ?? 0, estado_factura: e?.estado_factura ?? 'sin_pagar' }
          const { score, level } = calcularMatchScore({ movimiento: m, factura: fEnriched })
          return { ...fEnriched, score, level }
        }).sort((a, b) => b.score - a.score)

        // Conciliar SOLO si hay un match perfecto (>=95) Y es claramente mejor que el segundo
        const top = conScore[0]
        const segundo = conScore[1]
        if (!top || top.score < 95) { sinMatch++; continue }
        if (segundo && segundo.score >= 90) { ambiguos++; continue }  // hay 2 candidatos muy cercanos

        const montoAplicar = Math.min(m.saldo_pendiente, top.saldo)
        try {
          await vincularRespaldo({
            movimientoId: m.movimiento_id,
            tipoRespaldo: 'factura_compra',
            facturaId: top.id,
            monto: montoAplicar,
            observaciones: `Auto-match score ${top.score}% · ${top.folio ?? ''} ${top.razon_social ?? ''}`,
          })
          conciliados++
        } catch { sinMatch++ }
      }

      const detalle = [
        `${conciliados} conciliados`,
        sinMatch > 0 ? `${sinMatch} sin match` : null,
        ambiguos > 0 ? `${ambiguos} con candidatos ambiguos` : null,
      ].filter(Boolean).join(' · ')
      toast.success(detalle || 'Nada que conciliar', { id: toastId })
      refrescar()
    } catch (e) {
      toast.error('Error: ' + (e instanceof Error ? e.message : '?'), { id: toastId })
    } finally { setAutoRunning(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Barra de sincronización BSALE */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        background: '#fff', borderRadius: 10, padding: '10px 14px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        <button onClick={sincronizarBsale} disabled={syncing}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', borderRadius: 8, border: 'none',
            background: syncing ? '#9CA3AF' : '#1F4E79', color: '#fff',
            fontSize: 13, fontWeight: 600, cursor: syncing ? 'default' : 'pointer',
          }}>
          {syncing ? '⏳ Sincronizando…' : '🔄 Sincronizar facturas BSALE'}
        </button>
        <span style={{ fontSize: 12, color: '#6B7280' }}>
          Trae las facturas de compra del mes actual desde BSALE
        </span>
        {ultimaSync && (
          <span style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 'auto' }}>
            Última sync: {new Date(ultimaSync.created_at).toLocaleString('es-CL')} ·
            {' '}{ultimaSync.tipo} · {ultimaSync.docs_traidos ?? 0} docs ·
            {' '}<span style={{ color: ultimaSync.estado === 'ok' ? '#15803D' : '#DC2626', fontWeight: 600 }}>{ultimaSync.estado}</span>
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 16, height: 'calc(100vh - 220px)', minHeight: 520 }}>
        <MovimientosPanel
          movimientos={movimientos} loading={loading} selectedId={selectedId}
          onSelect={m => setSelectedId(m.movimiento_id)}
          filtros={filtros} onFiltrosChange={setFiltros}
          onReload={refrescar} onAutoMatch={handleAutoMatch} autoRunning={autoRunning}
          multiSel={multiSel} onMultiSelChange={setMultiSel}
        />
        <ConciliarPanelUnificado
          movimiento={selected} onAfterChange={refrescar}
          multiCargos={multiSel.length > 0 ? movimientos.filter(m => multiSel.includes(m.movimiento_id)) : null}
          onMultiDone={() => { setMultiSel([]); refrescar() }}
        />
      </div>
    </div>
  )
}
