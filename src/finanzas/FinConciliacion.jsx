import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
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

const cardSt = { background: '#fff', borderRadius: 10, padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: 16 }
const TH = { padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#6B7280', letterSpacing: '0.05em', textTransform: 'uppercase', background: '#F9FAFB', whiteSpace: 'nowrap' }
const TD = { padding: '10px 12px', fontSize: 13, color: '#374151', whiteSpace: 'nowrap', verticalAlign: 'middle' }

export function FinConciliacion({ cu, isMobile }) {
  const [subTab, setSubTab] = useState('clasificar')
  const [cartolaCuenta, setCartolaCuenta] = useState('santander')  // santander | global66
  const [toast_, setToast] = useState(null)

  function showToast(msg, tipo = 'ok') {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3000)
  }

  // Pestañas agrupadas en 2 procesos
  const GRUPOS = [
    {
      g: 'clasificar', label: 'Clasificar', color: '#1F4E79',
      tabs: [
        { k: 'clasificar', l: 'Clasificar' },
        { k: 'analisis',   l: 'Análisis dinámico' },
        { k: 'kpis',       l: 'KPIs & Auditoría' },
      ],
    },
    {
      g: 'conciliar', label: 'Conciliar', color: '#7C3AED',
      tabs: [
        { k: 'control',       l: '⚠ Centro de Control' },
        { k: 'combos',        l: '✨ Sugerencias IA' },
        { k: 'dashboard',     l: 'Dashboard Compras' },
        { k: 'dashboard_oc',  l: 'Dashboard OC' },
        { k: 'cartolas',      l: 'Cartolas' },
        { k: 'conciliar',     l: 'Conciliar con respaldos' },
        { k: 'pagos_oc',      l: 'Conciliar Pagos OC' },
        { k: 'proveedoresmp', l: 'Pagos Proveedores MP' },
      ],
    },
  ]

  // Grupo activo según la pestaña seleccionada
  const grupoActivo = GRUPOS.find(g => g.tabs.some(t => t.k === subTab)) ?? GRUPOS[0]

  return (
    <div>
      {/* Nivel 1: grupos de proceso */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {GRUPOS.map(grupo => {
          const activo = grupoActivo.g === grupo.g
          return (
            <button key={grupo.g} onClick={() => setSubTab(grupo.tabs[0].k)} style={{
              padding: '9px 20px', fontSize: 14, fontWeight: 700,
              border: 'none', cursor: 'pointer', borderRadius: 9,
              background: activo ? grupo.color : '#F3F4F6',
              color: activo ? '#fff' : '#6B7280',
              transition: 'all 0.15s',
            }}>{grupo.label}</button>
          )
        })}
      </div>

      {/* Nivel 2: pestañas del grupo activo */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid rgba(0,0,0,0.06)', flexWrap: 'wrap' }}>
        {grupoActivo.tabs.map(({ k, l }) => (
          <button key={k} onClick={() => setSubTab(k)} style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 600,
            background: 'none', border: 'none', cursor: 'pointer',
            color: subTab === k ? grupoActivo.color : '#8E8E93',
            borderBottom: subTab === k ? `2px solid ${grupoActivo.color}` : '2px solid transparent',
          }}>{l}</button>
        ))}
      </div>

      {subTab === 'clasificar'    && <ClasificarTab />}
      {subTab === 'analisis'      && <PivotMovimientosTab />}
      {subTab === 'kpis'          && <FinKpisAuditoria />}
      {subTab === 'control'       && <CentroControlTab onIrAVincular={() => setSubTab('pagos_oc')} />}
      {subTab === 'combos'        && <ConciliarCombosTab />}
      {subTab === 'dashboard'     && <DashboardComprasTab />}
      {subTab === 'dashboard_oc'  && <DashboardOCTab onIrAVincular={() => setSubTab('pagos_oc')} />}
      {subTab === 'proveedoresmp' && <ProveedoresMPTab />}
      {subTab === 'pagos_oc'      && <ConciliarPagosOCTab />}
      {subTab === 'cartolas'      && (
        <div>
          <div style={{ display: 'flex', gap: 6, padding: 4, background: '#F3F4F6', borderRadius: 10, alignSelf: 'flex-start', marginBottom: 16, width: 'fit-content' }}>
            {[
              { k: 'santander', l: '🏦 Santander', c: '#15803D' },
              { k: 'global66',  l: '🌐 Global66 (USD)', c: '#7C3AED' },
            ].map(t => (
              <button key={t.k} onClick={() => setCartolaCuenta(t.k)} style={{
                padding: '7px 16px', fontSize: 13, fontWeight: 600,
                border: 'none', cursor: 'pointer', borderRadius: 7,
                background: cartolaCuenta === t.k ? '#fff' : 'transparent',
                color: cartolaCuenta === t.k ? t.c : '#6B7280',
                boxShadow: cartolaCuenta === t.k ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}>{t.l}</button>
            ))}
          </div>
          {cartolaCuenta === 'santander' && <ImportadorMovimientos onImportado={() => showToast('Cartola importada — ve a Clasificar para procesar los movimientos')} />}
          {cartolaCuenta === 'global66'  && <Global66Tab />}
        </div>
      )}
      {subTab === 'conciliar'     && <ConciliarRespaldosTab />}

      {toast_ && (
        <div style={{
          position: 'fixed', bottom: 100, right: 20, zIndex: 200,
          background: toast_.tipo === 'err' ? '#DC2626' : '#16A34A',
          color: '#fff', borderRadius: 10, padding: '10px 16px',
          fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.15)'
        }}>{toast_.msg}</div>
      )}
    </div>
  )
}
