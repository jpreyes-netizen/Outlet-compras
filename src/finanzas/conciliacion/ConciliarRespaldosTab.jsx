import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../supabase'
import { fetchMovimientos, vincularRespaldo, extraerRut } from './api_conciliar'
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
    const toastId = toast.loading('Auto-conciliando…')
    try {
      const candidatos = movimientos.filter(m => m.tipo === 'CARGO' && m.estado_conciliacion === 'sin_conciliar')
      let conciliados = 0, sinMatch = 0

      for (const m of candidatos) {
        const rut = extraerRut(m.descripcion)
        if (!rut) { sinMatch++; continue }
        const min = Math.round(m.saldo_pendiente * 0.99)
        const max = Math.round(m.saldo_pendiente * 1.01)
        const { data } = await supabase.from('libro_compras').select('id, monto_total').eq('rut_proveedor', rut).gte('monto_total', min).lte('monto_total', max).limit(2)
        if (!data || data.length !== 1) { sinMatch++; continue }
        try {
          await vincularRespaldo({ movimientoId: m.movimiento_id, tipoRespaldo: 'factura_compra', facturaId: data[0].id, monto: m.saldo_pendiente, observaciones: 'Auto-match RUT+monto' })
          conciliados++
        } catch { sinMatch++ }
      }

      toast.success(`${conciliados} conciliados automáticamente · ${sinMatch} sin match`, { id: toastId })
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
