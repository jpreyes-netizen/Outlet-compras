import { useState, useEffect, useRef } from 'react'
import { LibroComprasClasificar } from './LibroComprasClasificar'
import { VincularOC } from './VincularOC'
import { ConciliarPagosOCTab } from './clasificar/ConciliarPagosOCTab'
import { ProveedoresMPTab } from './conciliacion/ProveedoresMPTab'
import { DashboardComprasTab } from './conciliacion/DashboardComprasTab'
import { DashboardOCTab } from './conciliacion/DashboardOCTab'

/* ═══════════════════════════════════════════════════════════════════════
   COMPRAS Y PAGOS — hoja del dominio Contabilidad
   El objeto es la factura de compra: qué cuenta la imputa, a qué OC
   pertenece, y cómo se pagó. La factura define el gasto; el pago
   cancela la deuda. El banco se trabaja en Conciliación bancaria.
   ═══════════════════════════════════════════════════════════════════════ */

const NAVY = '#16213E', SLATE = '#6E6E73', BORDE = '#E5E7EB'

const TABS = [
  { k: 'imputar', l: 'Imputar facturas' },
  { k: 'vincular_oc', l: 'Vincular a OC' },
  { k: 'pagos_oc', l: 'Pagos de OC' },
  { k: 'proveedoresmp', l: 'Proveedores MP' },
  { k: 'dashboard', l: 'Dashboard compras' },
  { k: 'dashboard_oc', l: 'Órdenes de compra' },
]

export function FinComprasPagos({ cu, sub, onSub, embebido }) {
  const [tab, setTab] = useState(() => {
    try { const g = localStorage.getItem('fin_compras_goto'); if (g) { localStorage.removeItem('fin_compras_goto'); return g } } catch (e) { }
    if (sub && TABS.some(t => t.k === sub)) return sub
    return 'imputar'
  })
  // Menú superior: el shell indica la pestaña (sub) y recibe los cambios internos para la ruta de navegación
  const primeraSub = useRef(true)
  useEffect(() => { if (primeraSub.current) { primeraSub.current = false; return } if (sub && sub !== tab && TABS.some(t => t.k === sub)) setTab(sub) }, [sub]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onSub?.(tab) }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!embebido && <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${BORDE}`, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            padding: '7px 14px', fontSize: 12, fontWeight: tab === t.k ? 700 : 500, whiteSpace: 'nowrap',
            background: 'none', border: 'none', cursor: 'pointer', color: tab === t.k ? NAVY : SLATE,
            borderBottom: `2px solid ${tab === t.k ? NAVY : 'transparent'}`, marginBottom: -1,
          }}>{t.l}</button>
        ))}
      </div>}
      {tab === 'imputar' && <LibroComprasClasificar cu={cu} />}
      {tab === 'vincular_oc' && <VincularOC cu={cu} />}
      {tab === 'pagos_oc' && <ConciliarPagosOCTab />}
      {tab === 'proveedoresmp' && <ProveedoresMPTab />}
      {tab === 'dashboard' && <DashboardComprasTab />}
      {tab === 'dashboard_oc' && <DashboardOCTab onIrAVincular={() => setTab('pagos_oc')} />}
    </div>
  )
}
