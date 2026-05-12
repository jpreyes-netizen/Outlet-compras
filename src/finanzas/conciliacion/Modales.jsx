import { useEffect, useMemo, useState } from 'react'
import { X, Loader2 } from 'lucide-react'

const TIPO_RESPALDO_OTROS = ['gasto_bancario', 'comision', 'interes', 'impuesto', 'otro']

const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n)

const inputSt = { width: '100%', padding: '6px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 13, background: '#fff', outline: 'none', boxSizing: 'border-box' }
const btnPrimarySt = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 7, border: 'none', background: '#1F4E79', fontSize: 13, fontWeight: 600, color: '#fff', cursor: 'pointer' }
const btnOutSt = { padding: '7px 16px', borderRadius: 7, border: '1px solid #D1D5DB', background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }

function Shell({ title, onClose, children, wide }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: wide ? 640 : 440, background: '#fff', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #F3F4F6', padding: '12px 16px' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1E293B' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4, borderRadius: 6, display: 'flex' }}><X size={16} /></button>
        </div>
        <div style={{ maxHeight: '75vh', overflowY: 'auto', padding: 16 }}>{children}</div>
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 12, padding: '3px 0' }}>
      <span style={{ color: '#64748B' }}>{label}</span>
      <span style={{ fontWeight: 500, color: '#1E293B', textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div style={{ background: '#F8FAFC', borderRadius: 8, padding: '8px', textAlign: 'center' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94A3B8' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: color ?? '#1E293B', marginTop: 2 }}>{value}</div>
    </div>
  )
}

function FieldMonto({ monto, setMonto, max }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 500, color: '#475569', display: 'block', marginBottom: 4 }}>Monto a aplicar</label>
      <input type="number" min={0} max={max} value={monto} onChange={e => setMonto(Number(e.target.value) || 0)}
        style={{ ...inputSt, textAlign: 'right' }} />
      <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>Máximo sugerido: {fmtCLP(max)}</div>
    </div>
  )
}

function FieldObs({ obs, setObs, required }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 500, color: '#475569', display: 'block', marginBottom: 4 }}>
        Observaciones {required && <span style={{ color: '#EF4444' }}>*</span>}
      </label>
      <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2}
        style={{ ...inputSt, resize: 'none', fontFamily: 'inherit' }} />
    </div>
  )
}

function Footer({ saving, onClose, onSave, label = 'Vincular' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid #F1F5F9', paddingTop: 12, marginTop: 16 }}>
      <button onClick={onClose} style={btnOutSt}>Cancelar</button>
      <button onClick={onSave} disabled={saving} style={{ ...btnPrimarySt, opacity: saving ? 0.6 : 1 }}>
        {saving && <Loader2 size={12} />} {label}
      </button>
    </div>
  )
}

export function VincularFacturaModal({ factura, saldoPendienteMov, onClose, onConfirm }) {
  const defaultMonto = Math.min(saldoPendienteMov, factura.saldo)
  const [monto, setMonto] = useState(Math.max(0, Math.round(defaultMonto)))
  const [pagoCompleto, setPagoCompleto] = useState(false)
  const [obs, setObs] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (pagoCompleto) setMonto(Math.round(factura.saldo)) }, [pagoCompleto, factura.saldo])

  return (
    <Shell title={`Vincular factura ${factura.folio ?? ''}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Row label="Proveedor" value={factura.razon_social ?? '—'} />
        <Row label="RUT" value={factura.rut_proveedor ?? '—'} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <Stat label="Total" value={fmtCLP(factura.monto_total)} />
          <Stat label="Pagado" value={fmtCLP(factura.total_pagado)} color="#0284C7" />
          <Stat label="Saldo" value={fmtCLP(factura.saldo)} color="#16A34A" />
        </div>
        <div style={{ borderRadius: 8, background: '#FFFBEB', border: '1px solid #FDE68A', padding: '8px 12px', fontSize: 12, color: '#92400E' }}>
          Saldo pendiente del movimiento: <strong>{fmtCLP(saldoPendienteMov)}</strong>
        </div>
        <FieldMonto monto={monto} setMonto={setMonto} max={Math.min(saldoPendienteMov, factura.saldo)} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={pagoCompleto} onChange={e => setPagoCompleto(e.target.checked)} />
          Pago completo de la factura ({fmtCLP(factura.saldo)})
        </label>
        <FieldObs obs={obs} setObs={setObs} />
        <Footer saving={saving} onClose={onClose} onSave={async () => {
          if (monto <= 0) return; setSaving(true)
          try { await onConfirm(monto, obs || null) } finally { setSaving(false) }
        }} />
      </div>
    </Shell>
  )
}

export function VincularImportacionModal({ carpeta, saldoPendienteMov, onClose, onConfirm }) {
  const [monto, setMonto] = useState(Math.round(saldoPendienteMov))
  const [obs, setObs] = useState('')
  const [saving, setSaving] = useState(false)
  return (
    <Shell title={`Vincular a importación ${carpeta.numero_din ?? ''}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Row label="Descripción" value={carpeta.descripcion ?? '—'} />
        <Row label="Proveedor" value={carpeta.proveedor_exterior ?? '—'} />
        <Row label="Valor CLP" value={carpeta.valor_clp ? fmtCLP(carpeta.valor_clp) : '—'} />
        <FieldMonto monto={monto} setMonto={setMonto} max={saldoPendienteMov} />
        <FieldObs obs={obs} setObs={setObs} />
        <Footer saving={saving} onClose={onClose} onSave={async () => {
          if (monto <= 0) return; setSaving(true)
          try { await onConfirm(monto, obs || null) } finally { setSaving(false) }
        }} />
      </div>
    </Shell>
  )
}

export function VincularOtroModal({ saldoPendienteMov, onClose, onConfirm }) {
  const [subtipo, setSubtipo] = useState(TIPO_RESPALDO_OTROS[0])
  const [monto, setMonto] = useState(Math.round(saldoPendienteMov))
  const [obs, setObs] = useState('')
  const [saving, setSaving] = useState(false)
  return (
    <Shell title="Vincular sin respaldo tributario" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 500, color: '#475569', display: 'block', marginBottom: 4 }}>Tipo de respaldo</label>
          <select value={subtipo} onChange={e => setSubtipo(e.target.value)} style={{ ...inputSt }}>
            {TIPO_RESPALDO_OTROS.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </div>
        <FieldMonto monto={monto} setMonto={setMonto} max={saldoPendienteMov} />
        <FieldObs obs={obs} setObs={setObs} required />
        <Footer saving={saving} onClose={onClose} onSave={async () => {
          if (monto <= 0 || !obs.trim()) return; setSaving(true)
          try { await onConfirm(monto, obs, { subtipoOtro: subtipo }) } finally { setSaving(false) }
        }} />
      </div>
    </Shell>
  )
}

export function NuevaImportacionModal({ onClose, onCreate }) {
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const valorClpAuto = useMemo(() => {
    if (form.valor_cif_usd && form.tipo_cambio) return Math.round(Number(form.valor_cif_usd) * Number(form.tipo_cambio))
    return form.valor_clp ?? null
  }, [form.valor_cif_usd, form.tipo_cambio, form.valor_clp])

  const campos = [
    { k: 'numero_din', l: 'N° DIN' }, { k: 'proveedor_exterior', l: 'Proveedor exterior' },
    { k: 'pais_origen', l: 'País origen' }, { k: 'descripcion', l: 'Descripción' },
  ]
  const numCampos = [
    { k: 'valor_fob_usd', l: 'Valor FOB USD' }, { k: 'valor_cif_usd', l: 'Valor CIF USD' },
    { k: 'tipo_cambio', l: 'Tipo cambio' }, { k: 'derechos_aduana', l: 'Derechos aduana' },
    { k: 'iva_importacion', l: 'IVA importación' }, { k: 'agente_aduana', l: 'Agente aduana' },
    { k: 'flete', l: 'Flete' }, { k: 'seguro', l: 'Seguro' },
    { k: 'almacenaje', l: 'Almacenaje' }, { k: 'otros_gastos', l: 'Otros gastos' },
  ]

  return (
    <Shell title="Nueva carpeta de importación" onClose={onClose} wide>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {campos.map(c => (
          <div key={c.k}>
            <label style={{ fontSize: 12, fontWeight: 500, color: '#475569', display: 'block', marginBottom: 4 }}>{c.l}</label>
            <input value={form[c.k] ?? ''} onChange={e => set(c.k, e.target.value)} style={inputSt} />
          </div>
        ))}
        {numCampos.map(c => (
          <div key={c.k}>
            <label style={{ fontSize: 12, fontWeight: 500, color: '#475569', display: 'block', marginBottom: 4 }}>{c.l}</label>
            <input type="number" value={form[c.k] ?? ''} onChange={e => set(c.k, e.target.value === '' ? null : Number(e.target.value))} style={{ ...inputSt, textAlign: 'right' }} />
          </div>
        ))}
        <div>
          <label style={{ fontSize: 12, fontWeight: 500, color: '#475569', display: 'block', marginBottom: 4 }}>Valor CLP (auto)</label>
          <input type="number" value={valorClpAuto ?? ''} onChange={e => set('valor_clp', e.target.value === '' ? null : Number(e.target.value))} style={{ ...inputSt, textAlign: 'right' }} />
        </div>
      </div>
      <Footer saving={saving} onClose={onClose} label="Crear carpeta" onSave={async () => {
        if (!form.numero_din?.trim()) return; setSaving(true)
        try { await onCreate({ ...form, valor_clp: valorClpAuto ?? null }) } finally { setSaving(false) }
      }} />
    </Shell>
  )
}
