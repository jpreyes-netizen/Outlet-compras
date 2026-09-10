import { useState } from 'react'
import { ClasificarTab } from './clasificar/ClasificarTab'
import { ConciliarRespaldosTab } from './conciliacion/ConciliarRespaldosTab'
import { ImportadorMovimientos } from './conciliacion/ImportadorMovimientos'
import { PivotMovimientosTab } from './clasificar/PivotMovimientosTab'
import { ProveedoresMPTab } from './conciliacion/ProveedoresMPTab'
import { FinKpisAuditoria } from './clasificar/FinKpisAuditoria'
import { Global66Tab } from './conciliacion/Global66Tab'
import { ConciliarPagosOCTab } from './clasificar/ConciliarPagosOCTab'
import { DashboardComprasTab } from './conciliacion/DashboardComprasTab'
import { DashboardOCTab } from './conciliacion/DashboardOCTab'
import { CentroControlTab } from './conciliacion/CentroControlTab'
import { ConciliarCombosTab } from './conciliacion/ConciliarCombosTab'
import { LibroComprasClasificar } from './LibroComprasClasificar'
import { BandejaConciliacion } from './BandejaConciliacion'

/* ══════════════════════════════════════════════════════════════════════
   CONCILIACIÓN — organizada según el CICLO CONTABLE DE COMPRAS Y PAGOS
   (procure-to-pay). El orden refleja la lógica contable, no la del banco:
   1 · DOCUMENTOS  La factura llega y se IMPUTA (qué cuenta). Nace el devengo.
   2 · PAGOS       El pago bancario se vincula a la factura: cancela la deuda.
   3 · BANCO       Lo que el banco tiene SIN factura se clasifica directo. Cartolas.
   4 · CONTROL     Qué falta: facturas sin pagar, pagos sin factura, banco sin explicar.
   ══════════════════════════════════════════════════════════════════════ */

const NAVY = '#16213E', SLATE = '#6E6E73', BORDE = '#E5E7EB'

const ETAPAS = [
  {
    g: 'documentos', num: '1', label: 'Documentos',
    leyenda: 'La factura define el gasto o el activo. Acá se imputa la cuenta contable de cada documento del libro de compras — antes de pagarlo. Las reglas por proveedor hacen que las próximas facturas se clasifiquen solas.',
    tabs: [
      { k: 'imputar',      l: 'Libro de compras · Imputar' },
      { k: 'dashboard',    l: 'Dashboard compras' },
      { k: 'dashboard_oc', l: 'Órdenes de compra' },
    ],
  },
  {
    g: 'pagos', num: '2', label: 'Pagos',
    leyenda: 'El pago no es un gasto: cancela la deuda que la factura creó. Vincular cada cargo bancario con su factura es lo que deja la cuenta por pagar en la verdad y explica el banco.',
    tabs: [
      { k: 'bandeja',       l: 'Bandeja de sugerencias' },
      { k: 'conciliar',     l: 'Conciliar con respaldos' },
      { k: 'pagos_oc',      l: 'Pagos de OC' },
      { k: 'proveedoresmp', l: 'Proveedores MP' },
      { k: 'combos',        l: 'Combos (detalle)' },
    ],
  },
  {
    g: 'banco', num: '3', label: 'Banco',
    leyenda: 'Lo que el banco tiene sin factura (sueldos, Previred, impuestos, traspasos, comisiones, retiros) se clasifica directo por subcuenta. Regla: un movimiento ya conciliado contra factura no se clasifica como gasto — la factura ya lo hizo.',
    tabs: [
      { k: 'clasificar', l: 'Clasificar movimientos' },
      { k: 'analisis',   l: 'Análisis dinámico' },
      { k: 'cartolas',   l: 'Cartolas' },
    ],
  },
  {
    g: 'control', num: '4', label: 'Control',
    leyenda: 'Qué falta para que todo cuadre: pagos sin respaldo, facturas antiguas sin pago, descuadres, órdenes sin factura. El detalle por proveedor con antigüedad de saldos está en Contabilidad → Cuentas por pagar.',
    tabs: [
      { k: 'control', l: 'Centro de control' },
      { k: 'kpis',    l: 'KPIs y auditoría' },
    ],
  },
]

export function FinConciliacion({ cu, isMobile }) {
  const [subTab, setSubTab] = useState('imputar')
  const [cartolaCuenta, setCartolaCuenta] = useState('santander')
  const [toast_, setToast] = useState(null)

  function showToast(msg, tipo = 'ok') {
    setToast({ msg, tipo }); setTimeout(() => setToast(null), 3000)
  }

  const etapaActiva = ETAPAS.find(e => e.tabs.some(t => t.k === subTab)) ?? ETAPAS[0]

  return (
    <div>
      <div style={{ display: 'flex', gap: 0, marginBottom: 10, borderRadius: 8, overflow: 'hidden', border: `1px solid ${BORDE}`, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
        {ETAPAS.map((e, i) => {
          const activo = etapaActiva.g === e.g
          return (
            <button key={e.g} onClick={() => setSubTab(e.tabs[0].k)} style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              background: activo ? NAVY : '#fff', border: 'none', cursor: 'pointer', textAlign: 'left',
              borderRight: i < ETAPAS.length - 1 ? `1px solid ${BORDE}` : 'none', minWidth: isMobile ? '50%' : 0,
            }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800, background: activo ? '#fff' : '#EEF2FF', color: NAVY, flexShrink: 0,
              }}>{e.num}</span>
              <span style={{ fontSize: 13, fontWeight: activo ? 700 : 600, color: activo ? '#fff' : NAVY }}>{e.label}</span>
            </button>
          )
        })}
      </div>

      <div style={{ fontSize: 11.5, color: '#374151', lineHeight: 1.5, padding: '8px 12px', background: '#F5F7FB',
        border: `1px solid ${BORDE}`, borderRadius: 8, marginBottom: 10 }}>
        <span style={{ fontWeight: 700, color: NAVY }}>Etapa {etapaActiva.num} · {etapaActiva.label}.</span> {etapaActiva.leyenda}
      </div>

      <div style={{ display: 'flex', gap: 2, marginBottom: 14, borderBottom: `1px solid ${BORDE}`, overflowX: 'auto' }}>
        {etapaActiva.tabs.map(({ k, l }) => (
          <button key={k} onClick={() => setSubTab(k)} style={{
            padding: '7px 14px', fontSize: 12, fontWeight: subTab === k ? 700 : 500, whiteSpace: 'nowrap',
            background: 'none', border: 'none', cursor: 'pointer',
            color: subTab === k ? NAVY : SLATE,
            borderBottom: subTab === k ? `2px solid ${NAVY}` : '2px solid transparent', marginBottom: -1,
          }}>{l}</button>
        ))}
      </div>

      {subTab === 'imputar'       && <LibroComprasClasificar cu={cu} />}
      {subTab === 'dashboard'     && <DashboardComprasTab />}
      {subTab === 'dashboard_oc'  && <DashboardOCTab onIrAVincular={() => setSubTab('pagos_oc')} />}
      {subTab === 'bandeja'       && <BandejaConciliacion cu={cu} />}
      {subTab === 'combos'        && <ConciliarCombosTab />}
      {subTab === 'conciliar'     && <ConciliarRespaldosTab />}
      {subTab === 'pagos_oc'      && <ConciliarPagosOCTab />}
      {subTab === 'proveedoresmp' && <ProveedoresMPTab />}
      {subTab === 'clasificar'    && <ClasificarTab />}
      {subTab === 'analisis'      && <PivotMovimientosTab />}
      {subTab === 'cartolas'      && (
        <div>
          <div style={{ display: 'flex', gap: 6, padding: 4, background: '#F3F4F6', borderRadius: 8, marginBottom: 14, width: 'fit-content' }}>
            {[{ k: 'santander', l: 'Santander (CLP)' }, { k: 'global66', l: 'Global66 (USD)' }].map(t => (
              <button key={t.k} onClick={() => setCartolaCuenta(t.k)} style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', borderRadius: 6,
                background: cartolaCuenta === t.k ? '#fff' : 'transparent', color: cartolaCuenta === t.k ? NAVY : SLATE,
                boxShadow: cartolaCuenta === t.k ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}>{t.l}</button>
            ))}
          </div>
          {cartolaCuenta === 'santander' && <ImportadorMovimientos onImportado={() => showToast('Cartola importada — los movimientos sin factura se clasifican en "Clasificar movimientos"')} />}
          {cartolaCuenta === 'global66'  && <Global66Tab />}
        </div>
      )}
      {subTab === 'control'       && <CentroControlTab onIrAVincular={() => setSubTab('pagos_oc')} />}
      {subTab === 'kpis'          && <FinKpisAuditoria />}

      {toast_ && (
        <div style={{ position: 'fixed', bottom: 100, right: 20, zIndex: 200,
          background: toast_.tipo === 'err' ? '#B42318' : '#1E7A44', color: '#fff', borderRadius: 8,
          padding: '10px 16px', fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>{toast_.msg}</div>
      )}
    </div>
  )
}
