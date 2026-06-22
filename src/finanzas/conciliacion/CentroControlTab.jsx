import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, AlertTriangle, AlertOctagon, Clock, FileQuestion, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { supabase } from '../../supabase'

const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n ?? 0)
const fmtNum = n => new Intl.NumberFormat('es-CL').format(n ?? 0)
const fFecha = s => { if (!s) return ''; const p = String(s).slice(0, 10).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0].slice(2)}` : s }

// ════════════════════════════════════════════════════════════════════════
// CENTRO DE CONTROL DE EXCEPCIONES
// 4 anomalías del control de 3 vías (OC ↔ Factura ↔ Pago):
//   🔴 Pagos sin respaldo (cargos sin factura)
//   🔴 Descuadres de monto (OC vs facturas vinculadas)
//   🟡 Facturas antiguas sin pagar (proxy de vencidas)
//   🟡 OC en estado avanzado sin factura
// El backend (5 vistas v_ctrl_*) ya hace los cálculos. Acá las mostramos
// con foco en acción: cada anomalía es expandible y accionable.
// ════════════════════════════════════════════════════════════════════════
export function CentroControlTab({ onIrAConciliar, onIrAVincular }) {
  const [loading, setLoading] = useState(true)
  const [resumen, setResumen] = useState(null)
  const [expandida, setExpandida] = useState(null)  // qué tarjeta está abierta

  useEffect(() => {
    setLoading(true)
    supabase.from('v_ctrl_resumen').select('*').single()
      .then(({ data, error }) => { if (error) throw error; setResumen(data) })
      .catch(e => toast.error('Error: ' + e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#94A3B8' }}><Loader2 size={22} style={{ animation: 'spin 1s linear infinite' }} /></div>
  if (!resumen) return null

  const tarjetas = [
    {
      k: 'pagos', critica: true, icon: AlertOctagon,
      titulo: 'Pagos sin respaldo',
      n: resumen.n_pagos_sin_respaldo, monto: resumen.monto_pagos_sin_respaldo,
      sub: `${fmtNum(resumen.grupos_pagos_sin_respaldo)} proveedores · cargos sin factura asociada`,
      riesgo: 'Plata salió del banco sin documento tributario detrás',
      detalle: <DetallePagos />,
    },
    {
      k: 'descuadres', critica: true, icon: AlertTriangle,
      titulo: 'Descuadres de monto',
      n: resumen.n_descuadres, monto: resumen.monto_descuadres,
      sub: 'OC con facturas vinculadas que no cuadran',
      riesgo: 'Pagaste más (o menos) que lo autorizado en la OC',
      detalle: <DetalleDescuadres />,
    },
    {
      k: 'antiguas', critica: false, icon: Clock,
      titulo: 'Facturas antiguas sin pagar',
      n: resumen.n_facturas_antiguas, monto: resumen.monto_facturas_antiguas,
      sub: '+30 días desde emisión, sin pago (proxy de vencidas)',
      riesgo: 'Riesgo de mora o corte de servicio',
      detalle: <DetalleFacturasAntiguas />,
    },
    {
      k: 'ocsinfact', critica: false, icon: FileQuestion,
      titulo: 'OC sin factura',
      n: resumen.n_oc_sin_factura, monto: resumen.monto_oc_sin_factura,
      sub: 'OC en estado avanzado, falta documento del proveedor',
      riesgo: 'Mercadería recibida sin respaldo tributario',
      detalle: <DetalleOCSinFactura onIrAVincular={onIrAVincular} />,
    },
  ]

  return (
    <div style={{ paddingBottom: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#64748B', marginBottom: 4 }}>Control de 3 vías · OC ↔ Factura ↔ Pago</div>
        <div style={{ fontSize: 11, color: '#94A3B8' }}>Detecta automáticamente dónde el expediente está incompleto o no cuadra.</div>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {tarjetas.map(t => (
          <TarjetaAnomalia key={t.k} tarjeta={t}
            abierta={expandida === t.k}
            onToggle={() => setExpandida(expandida === t.k ? null : t.k)} />
        ))}
      </div>
    </div>
  )
}

// ─── Tarjeta de anomalía (colapsable) ────────────────────────────────────
function TarjetaAnomalia({ tarjeta, abierta, onToggle }) {
  const { icon: Icon, titulo, n, monto, sub, riesgo, detalle, critica } = tarjeta
  const sinAnomalias = n === 0
  const bg = sinAnomalias ? '#F0FDF4' : (critica ? '#FEF2F2' : '#FFFBEB')
  const border = sinAnomalias ? '#BBF7D0' : (critica ? '#FECACA' : '#FDE68A')
  const iconColor = sinAnomalias ? '#16A34A' : (critica ? '#DC2626' : '#D97706')
  const txtColor = sinAnomalias ? '#15803D' : (critica ? '#991B1B' : '#92400E')

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div onClick={!sinAnomalias ? onToggle : undefined} style={{
        padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14,
        cursor: sinAnomalias ? 'default' : 'pointer',
      }}>
        <Icon size={24} color={iconColor} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: txtColor }}>{titulo}</span>
            {sinAnomalias
              ? <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#DCFCE7', color: '#15803D' }}>sin anomalías ✓</span>
              : <span style={{ fontSize: 11, color: txtColor, opacity: 0.85 }}>{sub}</span>}
          </div>
          {!sinAnomalias && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 4 }}>
              <span style={{ fontSize: 22, fontWeight: 800, color: txtColor }}>{fmtNum(n)}</span>
              <span style={{ fontSize: 14, color: txtColor, fontFamily: 'monospace' }}>{fmtCLP(monto)}</span>
              <span style={{ fontSize: 11, color: txtColor, opacity: 0.7, fontStyle: 'italic' }}>{riesgo}</span>
            </div>
          )}
        </div>
        {!sinAnomalias && (abierta ? <ChevronUp size={18} color={txtColor} /> : <ChevronDown size={18} color={txtColor} />)}
      </div>
      {abierta && !sinAnomalias && (
        <div style={{ borderTop: `1px solid ${border}`, background: '#fff', padding: '14px 18px' }}>
          {detalle}
        </div>
      )}
    </div>
  )
}

// ─── Detalle 1: pagos sin respaldo (agrupados por proveedor) ─────────────
function DetallePagos() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    supabase.from('v_ctrl_pagos_sin_respaldo').select('*').limit(20)
      .then(({ data }) => setRows(data ?? []))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ fontSize: 12, color: '#94A3B8', padding: 10 }}>Cargando…</div>
  return (
    <div>
      <div style={{ fontSize: 11, color: '#64748B', marginBottom: 10 }}>
        Top 20 proveedores con más pagos sin factura. Empezá por arriba — concentran el mayor riesgo.
      </div>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px' }}>RUT</th>
            <th style={{ textAlign: 'left', padding: '6px 8px' }}>Ejemplo glosa</th>
            <th style={{ textAlign: 'right', padding: '6px 8px' }}>Pagos</th>
            <th style={{ textAlign: 'right', padding: '6px 8px' }}>Monto sin respaldo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.rut_clave} style={{ borderTop: '1px solid #F1F5F9' }}>
              <td style={{ padding: '7px 8px', fontFamily: 'monospace', color: '#475569' }}>{r.rut_clave}</td>
              <td style={{ padding: '7px 8px', color: '#475569', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.ejemplo_glosa}>{r.ejemplo_glosa}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 600 }}>{r.n_pagos}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#DC2626' }}>{fmtCLP(r.monto_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Detalle 2: descuadres ───────────────────────────────────────────────
function DetalleDescuadres() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    supabase.from('v_ctrl_descuadres').select('*').limit(50)
      .then(({ data }) => setRows(data ?? []))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ fontSize: 12, color: '#94A3B8', padding: 10 }}>Cargando…</div>
  return (
    <div>
      <div style={{ fontSize: 11, color: '#64748B', marginBottom: 10 }}>
        OC cuyo monto facturado (suma de facturas vinculadas) difiere más del 2% del total autorizado.
      </div>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px' }}>OC</th>
            <th style={{ textAlign: 'left', padding: '6px 8px' }}>Proveedor</th>
            <th style={{ textAlign: 'right', padding: '6px 8px' }}>OC autorizada</th>
            <th style={{ textAlign: 'right', padding: '6px 8px' }}>Facturado</th>
            <th style={{ textAlign: 'right', padding: '6px 8px' }}>Diferencia</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.oc_id} style={{ borderTop: '1px solid #F1F5F9' }}>
              <td style={{ padding: '7px 8px', fontWeight: 600 }}>{r.oc_id}</td>
              <td style={{ padding: '7px 8px', color: '#475569', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.proveedor}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{fmtCLP(r.oc_total)}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{fmtCLP(r.monto_facturado)}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: r.diferencia > 0 ? '#DC2626' : '#0284C7' }}>
                {r.diferencia > 0 ? '+' : ''}{fmtCLP(r.diferencia)} ({r.pct_desvio}%)
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Detalle 3: facturas antiguas sin pagar ──────────────────────────────
function DetalleFacturasAntiguas() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    supabase.from('v_ctrl_facturas_antiguas').select('*').limit(30)
      .then(({ data }) => setRows(data ?? []))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ fontSize: 12, color: '#94A3B8', padding: 10 }}>Cargando…</div>
  return (
    <div>
      <div style={{ fontSize: 11, color: '#64748B', marginBottom: 10 }}>
        Top 30 facturas con más antigüedad. Como BSALE no trae fecha de vencimiento, usamos +30 días desde emisión como proxy.
      </div>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px' }}>Folio</th>
            <th style={{ textAlign: 'left', padding: '6px 8px' }}>Proveedor</th>
            <th style={{ textAlign: 'left', padding: '6px 8px' }}>Emisión</th>
            <th style={{ textAlign: 'right', padding: '6px 8px' }}>Días</th>
            <th style={{ textAlign: 'right', padding: '6px 8px' }}>Saldo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.factura_id} style={{ borderTop: '1px solid #F1F5F9' }}>
              <td style={{ padding: '7px 8px', fontWeight: 600 }}>{r.folio}</td>
              <td style={{ padding: '7px 8px', color: '#475569', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.razon_social}</td>
              <td style={{ padding: '7px 8px', color: '#475569' }}>{fFecha(r.fecha_emision)}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 600, color: r.dias_antiguedad > 90 ? '#DC2626' : '#D97706' }}>{r.dias_antiguedad}d</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#D97706' }}>{fmtCLP(r.saldo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Detalle 4: OC sin factura ───────────────────────────────────────────
function DetalleOCSinFactura({ onIrAVincular }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    supabase.from('v_ctrl_oc_sin_factura').select('*')
      .then(({ data }) => setRows(data ?? []))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ fontSize: 12, color: '#94A3B8', padding: 10 }}>Cargando…</div>
  return (
    <div>
      <div style={{ fontSize: 11, color: '#64748B', marginBottom: 10 }}>
        OC en estado "Recibida OK", "Despacho nac." o "Confirmada prov." sin ninguna factura del libro asociada.
      </div>
      {rows.map(r => (
        <div key={r.oc_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderTop: '1px solid #F1F5F9', fontSize: 12 }}>
          <span style={{ fontWeight: 700, color: '#1F4E79', minWidth: 120 }}>{r.oc_id}</span>
          <span style={{ flex: 1, color: '#475569' }}>{r.proveedor}</span>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: '#FEF3C7', color: '#92400E', fontWeight: 600 }}>{r.oc_estado}</span>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#D97706', minWidth: 110, textAlign: 'right' }}>{fmtCLP(r.oc_total)}</span>
          {onIrAVincular && (
            <button onClick={() => onIrAVincular(r.oc_id)} style={{ padding: '4px 10px', borderRadius: 7, border: 'none', background: '#7C3AED', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <ExternalLink size={11} /> Vincular
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
