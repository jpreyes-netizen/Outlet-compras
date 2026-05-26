import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../supabase'
import { fetchMovimientos, vincularRespaldo, extraerRut, calcularMatchScore } from './api_conciliar'
import { MovimientosPanel } from './MovimientosPanel'
import { RespaldosPanel } from './RespaldosPanel'

export function ConciliarRespaldosTab() {
  const [filtros, setFiltros] = useState({ estado: 'todos', desde: null, hasta: null, texto: '', soloCargo: true })
  const [movimientos, setMovimientos] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [autoRunning, setAutoRunning] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

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
    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, minHeight: '70vh' }}>
      <MovimientosPanel
        movimientos={movimientos} loading={loading} selectedId={selectedId}
        onSelect={m => setSelectedId(m.movimiento_id)}
        filtros={filtros} onFiltrosChange={setFiltros}
        onReload={refrescar} onAutoMatch={handleAutoMatch} autoRunning={autoRunning}
      />
      <RespaldosPanel movimiento={selected} onAfterChange={refrescar} />
    </div>
  )
}
