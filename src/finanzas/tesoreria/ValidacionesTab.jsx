import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import { canSync } from '../../core/permisos'
import { BotonPush } from '../../core/push'

/* ═══════════════════════════════════════════════════════════════════════════
   VALIDACIÓN DE PAGOS ELECTRÓNICOS — bandeja de Tesorería
   El vendedor/cajero levanta una solicitud desde Comercial con el comprobante
   de transferencia o del link Webpay. Finanzas confirma en el banco online /
   portal Transbank que los fondos llegaron y aprueba o rechaza EN VIVO
   (el cliente está en el mostrador esperando).

   Fase 1 (este tab): validación humana en tiempo real.
   Fase 2 (posterior): conciliación automática contra cartola / cadena Webpay
   usando val_pagos.conciliacion_mov_id.
   ═══════════════════════════════════════════════════════════════════════════ */

const fmt = n => '$' + Math.round(n || 0).toLocaleString('es-CL')

const MEDIOS = {
  transferencia: { l: 'Transferencia', ic: '🏦', c: '#0369A1', bg: '#F0F9FF' },
  webpay_link:   { l: 'Webpay (link)', ic: '💳', c: '#7C3AED', bg: '#F5F3FF' },
}
const DOCS = {
  borrador:   'Borrador de venta',
  nota_venta: 'Nota de venta',
  cotizacion: 'Cotización',
  abono:      'Abono de cliente',
  otro:       'Otro',
}
const EST = {
  pendiente:   { l: 'Pendiente',   c: '#B45309', bg: '#FFFBEB', bd: '#FDE68A' },
  en_revision: { l: 'En revisión', c: '#1D4ED8', bg: '#EFF6FF', bd: '#BFDBFE' },
  aprobada:    { l: 'Aprobada',    c: '#047857', bg: '#ECFDF5', bd: '#A7F3D0' },
  rechazada:   { l: 'Rechazada',   c: '#B91C1C', bg: '#FEF2F2', bd: '#FECACA' },
}

const MOTIVOS_RECHAZO = [
  'Fondos no llegaron a la cuenta',
  'Monto no coincide',
  'Comprobante ilegible o incompleto',
  'Comprobante alterado / no corresponde',
  'Transferencia a cuenta que no es de la empresa',
  'Pago duplicado (ya validado antes)',
  'Otro',
]

/* Antigüedad en minutos → texto + color de urgencia */
function edad(iso) {
  if (!iso) return { txt: '—', c: '#8E8E93' }
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  const c = min >= 10 ? '#DC2626' : min >= 5 ? '#D97706' : '#059669'
  if (min < 1) return { txt: 'reci\u00e9n', c }
  if (min < 60) return { txt: min + ' min', c }
  const h = Math.floor(min / 60)
  return { txt: h + ' h ' + (min % 60) + ' min', c }
}

const fechaHora = iso => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }) + ' ' +
         d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/* Beep corto por WebAudio — no requiere archivo de audio */
function beep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sine'; osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45)
    osc.start(); osc.stop(ctx.currentTime + 0.5)
    setTimeout(() => { try { ctx.close() } catch (e) {} }, 900)
  } catch (e) {}
}

export function ValidacionesTab({ usuario, cu }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState(null)
  const [saving, setSaving] = useState(false)
  const [verHist, setVerHist] = useState(false)
  const [sonido, setSonido] = useState(true)
  const [online, setOnline] = useState(false)
  const [tick, setTick] = useState(0)
  const [err, setErr] = useState('')
  const [rechazando, setRechazando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [motivoTxt, setMotivoTxt] = useState('')

  const sonidoRef = useRef(sonido)
  useEffect(() => { sonidoRef.current = sonido }, [sonido])
  const vistosRef = useRef(new Set())

  const puedeResolver = canSync(cu, 'finanzas', 'fin.teso.validaciones.resolver') !== false
  const yo = usuario?.id || cu?.id || ''
  const yoNombre = usuario?.nombre || cu?.nombre || cu?.correo || ''

  /* ── Carga ── */
  const cargar = async (silencioso) => {
    if (!silencioso) setLoading(true)
    try {
      const desde = new Date(Date.now() - 30 * 86400000).toISOString()
      const { data, error } = await supabase
        .from('val_pagos')
        .select('*')
        .gte('created_at', desde)
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) { setErr(error.message); return }
      setErr('')
      const arr = data || []
      // beep solo para pendientes nuevas que no habíamos visto
      if (sonidoRef.current && vistosRef.current.size > 0) {
        const nuevas = arr.filter(r => r.estado === 'pendiente' && !vistosRef.current.has(r.id))
        if (nuevas.length) beep()
      }
      arr.forEach(r => vistosRef.current.add(r.id))
      setRows(arr)
    } finally { setLoading(false) }
  }

  useEffect(() => { cargar() }, [])

  /* ── Realtime: una sola suscripción a la tabla ── */
  useEffect(() => {
    const ch = supabase
      .channel('val_pagos_teso')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'val_pagos' }, payload => {
        const nuevo = payload.new
        if (payload.eventType === 'INSERT' && nuevo) {
          if (sonidoRef.current && !vistosRef.current.has(nuevo.id)) beep()
          vistosRef.current.add(nuevo.id)
          setRows(p => (p.some(r => r.id === nuevo.id) ? p : [nuevo, ...p]))
        } else if (payload.eventType === 'UPDATE' && nuevo) {
          setRows(p => p.map(r => (r.id === nuevo.id ? nuevo : r)))
          setSel(s => (s && s.id === nuevo.id ? nuevo : s))
        } else if (payload.eventType === 'DELETE' && payload.old) {
          setRows(p => p.filter(r => r.id !== payload.old.id))
        }
      })
      .subscribe(st => setOnline(st === 'SUBSCRIBED'))
    return () => { try { supabase.removeChannel(ch) } catch (e) {} }
  }, [])

  /* ── Polling de respaldo cada 15 s (el websocket a veces cae en silencio) ── */
  useEffect(() => {
    const id = setInterval(() => cargar(true), 15000)
    return () => clearInterval(id)
  }, [])

  /* ── Reloj para refrescar los cronómetros ── */
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 20000)
    return () => clearInterval(id)
  }, [])

  const abiertas = useMemo(
    () => rows.filter(r => r.estado === 'pendiente' || r.estado === 'en_revision')
              .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    [rows, tick]
  )
  const historico = useMemo(
    () => rows.filter(r => r.estado === 'aprobada' || r.estado === 'rechazada'),
    [rows]
  )

  /* ── KPIs del día ── */
  const kpis = useMemo(() => {
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })
    const delDia = rows.filter(r => String(r.created_at).slice(0, 10) === hoy)
    const res = delDia.filter(r => r.resuelta_at)
    const prom = res.length
      ? res.reduce((s, r) => s + (new Date(r.resuelta_at) - new Date(r.created_at)) / 60000, 0) / res.length
      : 0
    return {
      pendientes: abiertas.length,
      hoy: delDia.length,
      aprobadas: delDia.filter(r => r.estado === 'aprobada').length,
      rechazadas: delDia.filter(r => r.estado === 'rechazada').length,
      monto: delDia.filter(r => r.estado === 'aprobada').reduce((s, r) => s + Number(r.monto || 0), 0),
      prom: Math.round(prom * 10) / 10,
    }
  }, [rows, abiertas])

  /* ── Acciones ── */
  const tomar = async r => {
    if (!puedeResolver) return
    setSaving(true)
    try {
      const { data, error } = await supabase.from('val_pagos')
        .update({ estado: 'en_revision', tomada_por: yo, tomada_por_nombre: yoNombre, tomada_at: new Date().toISOString() })
        .eq('id', r.id).eq('estado', 'pendiente')   // guard: no pisar si otro ya la tomó
        .select().maybeSingle()
      if (error) { setErr(error.message); return }
      if (!data) { setErr('Otro usuario tomó esta solicitud primero.'); await cargar(true); return }
      setErr(''); setSel(data)
    } finally { setSaving(false) }
  }

  const liberar = async r => {
    setSaving(true)
    try {
      await supabase.from('val_pagos')
        .update({ estado: 'pendiente', tomada_por: null, tomada_por_nombre: null, tomada_at: null })
        .eq('id', r.id).eq('estado', 'en_revision')
      setSel(null)
    } finally { setSaving(false) }
  }

  const resolver = async (r, estado, motivoFinal) => {
    if (!puedeResolver) return
    setSaving(true)
    try {
      const { data, error } = await supabase.from('val_pagos')
        .update({
          estado,
          resuelta_por: yo,
          resuelta_por_nombre: yoNombre,
          resuelta_at: new Date().toISOString(),
          motivo_rechazo: estado === 'rechazada' ? (motivoFinal || null) : null,
        })
        .eq('id', r.id).in('estado', ['pendiente', 'en_revision'])
        .select().maybeSingle()
      if (error) { setErr(error.message); return }
      setErr('')
      setSel(data || null)
      setRechazando(false); setMotivo(''); setMotivoTxt('')
      setTimeout(() => setSel(null), 1200)
    } finally { setSaving(false) }
  }

  const confirmarRechazo = r => {
    const m = motivo === 'Otro' ? motivoTxt.trim() : motivo
    if (!m) return
    resolver(r, 'rechazada', m)
  }

  /* ═══ UI ═══ */
  return (
    <div>
      {/* Barra de estado + KPIs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <Kpi l="Pendientes" v={kpis.pendientes} c={kpis.pendientes > 0 ? '#DC2626' : '#059669'} destacar={kpis.pendientes > 0} />
        <Kpi l="Hoy" v={kpis.hoy} />
        <Kpi l="Aprobadas" v={kpis.aprobadas} c="#047857" />
        <Kpi l="Rechazadas" v={kpis.rechazadas} c="#B91C1C" />
        <Kpi l="Monto aprobado hoy" v={fmt(kpis.monto)} />
        <Kpi l="Resp. promedio" v={kpis.prom ? kpis.prom + ' min' : '—'} />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: online ? '#059669' : '#D97706', fontWeight: 600 }}>
            <span style={{ width: 7, height: 7, borderRadius: 4, background: online ? '#059669' : '#D97706', display: 'inline-block' }} />
            {online ? 'En vivo' : 'Reconectando…'}
          </span>
          <label style={{ fontSize: 11, color: '#6B7280', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={sonido} onChange={e => setSonido(e.target.checked)} /> Sonido
          </label>
          <BotonPush cu={cu} />
          <button onClick={() => cargar()} style={btnGhost}>Refrescar</button>
        </div>
      </div>

      {err && (
        <div style={{ padding: '8px 12px', background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12, marginBottom: 10 }}>
          {err}
        </div>
      )}

      {!puedeResolver && (
        <div style={{ padding: '8px 12px', background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A', borderRadius: 8, fontSize: 12, marginBottom: 10 }}>
          Tu rol permite ver la bandeja pero no aprobar ni rechazar.
        </div>
      )}

      {/* Bandeja de abiertas */}
      <Seccion titulo={`Por validar (${abiertas.length})`}>
        {loading ? (
          <Vacio txt="Cargando…" />
        ) : abiertas.length === 0 ? (
          <Vacio txt="Sin solicitudes pendientes. Las nuevas aparecen aquí automáticamente." />
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {abiertas.map(r => <Tarjeta key={r.id} r={r} onClick={() => setSel(r)} />)}
          </div>
        )}
      </Seccion>

      {/* Histórico */}
      <div style={{ marginTop: 18 }}>
        <button onClick={() => setVerHist(v => !v)} style={{ ...btnGhost, fontWeight: 700 }}>
          {verHist ? '▾' : '▸'} Resueltas ({historico.length}) — últimos 30 días
        </button>
        {verHist && (
          <div style={{ marginTop: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  {['ID', 'Fecha', 'Sucursal', 'Solicitante', 'Medio', 'Monto', 'Cliente', 'Documento', 'Estado', 'Resolvió', 'Espera'].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {historico.map(r => {
                  const e = EST[r.estado] || EST.pendiente
                  const mins = r.resuelta_at ? Math.round((new Date(r.resuelta_at) - new Date(r.created_at)) / 60000) : null
                  return (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setSel(r)}>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{r.id}</td>
                      <td style={td}>{fechaHora(r.created_at)}</td>
                      <td style={td}>{(r.sucursal_id || '').replace('suc-', '')}</td>
                      <td style={td}>{r.solicitante_nombre || '—'}</td>
                      <td style={td}>{(MEDIOS[r.medio] || {}).l || r.medio}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmt(r.monto)}</td>
                      <td style={td}>{r.cliente_nombre || '—'}</td>
                      <td style={td}>{(DOCS[r.doc_tipo] || r.doc_tipo || '—') + (r.doc_referencia ? ' · ' + r.doc_referencia : '')}</td>
                      <td style={td}><span style={{ ...pill, color: e.c, background: e.bg, border: '1px solid ' + e.bd }}>{e.l}</span></td>
                      <td style={td}>{r.resuelta_por_nombre || '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{mins != null ? mins + ' min' : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Panel de detalle */}
      {sel && (
        <Detalle
          r={sel}
          onClose={() => { setSel(null); setRechazando(false); setMotivo(''); setMotivoTxt('') }}
          puedeResolver={puedeResolver}
          saving={saving}
          yo={yo}
          onTomar={() => tomar(sel)}
          onLiberar={() => liberar(sel)}
          onAprobar={() => resolver(sel, 'aprobada')}
          rechazando={rechazando}
          setRechazando={setRechazando}
          motivo={motivo} setMotivo={setMotivo}
          motivoTxt={motivoTxt} setMotivoTxt={setMotivoTxt}
          onConfirmarRechazo={() => confirmarRechazo(sel)}
        />
      )}
    </div>
  )
}

/* ─────────────── Subcomponentes ─────────────── */

function Kpi({ l, v, c, destacar }) {
  return (
    <div style={{
      padding: '7px 12px', borderRadius: 8, minWidth: 96,
      background: destacar ? '#FEF2F2' : '#F9FAFB',
      border: '1px solid ' + (destacar ? '#FECACA' : '#E5E7EB'),
    }}>
      <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.04em', color: '#9CA3AF', fontWeight: 700 }}>{l}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: c || '#111827', lineHeight: 1.25 }}>{v}</div>
    </div>
  )
}

function Seccion({ titulo, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: '#6B7280', fontWeight: 800, marginBottom: 8 }}>{titulo}</div>
      {children}
    </div>
  )
}

function Vacio({ txt }) {
  return <div style={{ padding: 28, textAlign: 'center', color: '#9CA3AF', fontSize: 12.5, background: '#FAFAFA', border: '1px dashed #E5E7EB', borderRadius: 10 }}>{txt}</div>
}

function Tarjeta({ r, onClick }) {
  const m = MEDIOS[r.medio] || MEDIOS.transferencia
  const e = EST[r.estado] || EST.pendiente
  const ed = edad(r.created_at)
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', flexWrap: 'wrap',
      background: '#fff', border: '1px solid ' + e.bd, borderLeft: '4px solid ' + e.c,
      borderRadius: 10, cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,.04)',
    }}>
      <div style={{ fontSize: 20 }}>{m.ic}</div>
      <div style={{ minWidth: 118 }}>
        <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#6B7280' }}>{r.id}</div>
        <div style={{ fontSize: 13.5, fontWeight: 800 }}>{fmt(r.monto)}</div>
      </div>
      <div style={{ flex: '1 1 160px', minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {r.cliente_nombre || 'Cliente sin nombre'}
          {r.cliente_rut ? <span style={{ color: '#9CA3AF', fontWeight: 400 }}> · {r.cliente_rut}</span> : null}
        </div>
        <div style={{ fontSize: 11, color: '#6B7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {m.l} · {(r.sucursal_id || '').replace('suc-', '')} · {r.solicitante_nombre || '—'}
          {r.doc_referencia ? ' · ' + r.doc_referencia : ''}
        </div>
      </div>
      {r.comprobante_url ? <span style={{ fontSize: 11, color: '#059669', fontWeight: 700 }}>📎</span>
                         : <span style={{ fontSize: 11, color: '#D97706', fontWeight: 700 }}>sin adjunto</span>}
      <div style={{ textAlign: 'right', minWidth: 92 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: ed.c }}>{ed.txt}</div>
        <span style={{ ...pill, color: e.c, background: e.bg, border: '1px solid ' + e.bd }}>
          {e.l}{r.estado === 'en_revision' && r.tomada_por_nombre ? ' · ' + r.tomada_por_nombre.split(' ')[0] : ''}
        </span>
      </div>
    </div>
  )
}

function Detalle({ r, onClose, puedeResolver, saving, yo, onTomar, onLiberar, onAprobar,
                   rechazando, setRechazando, motivo, setMotivo, motivoTxt, setMotivoTxt, onConfirmarRechazo }) {
  const m = MEDIOS[r.medio] || MEDIOS.transferencia
  const e = EST[r.estado] || EST.pendiente
  const abierta = r.estado === 'pendiente' || r.estado === 'en_revision'
  const mia = r.tomada_por === yo
  const esImg = /\.(png|jpe?g|webp|gif|heic)$/i.test(r.comprobante_url || '')

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 200,
      display: 'flex', justifyContent: 'flex-end',
    }}>
      <div onClick={ev => ev.stopPropagation()} style={{
        width: 'min(560px, 100%)', background: '#fff', height: '100%', overflowY: 'auto',
        boxShadow: '-8px 0 24px rgba(0,0,0,.15)', WebkitOverflowScrolling: 'touch',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}>
        {/* Header */}
        <div style={{ position: 'sticky', top: 0, background: 'linear-gradient(135deg,#1a1a2e,#16213e)', color: '#fff', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, zIndex: 2 }}>
          <div style={{ fontSize: 22 }}>{m.ic}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>{fmt(r.monto)}</div>
            <div style={{ fontSize: 11, color: '#9aa0c0', fontFamily: 'monospace' }}>{r.id} · {m.l}</div>
          </div>
          <span style={{ ...pill, color: e.c, background: e.bg, border: '1px solid ' + e.bd }}>{e.l}</span>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,.12)', border: 'none', color: '#fff', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>

        <div style={{ padding: 18 }}>
          {/* Datos para buscar en el banco */}
          <Bloque titulo="Datos del pago">
            <Dato l="Medio" v={m.l} />
            <Dato l="Monto" v={fmt(r.monto)} fuerte />
            <Dato l="Banco de origen" v={r.banco_origen} />
            <Dato l="Fecha / hora declarada" v={[r.fecha_pago, r.hora_pago].filter(Boolean).join(' ') || '—'} />
          </Bloque>

          <Bloque titulo="Cliente y documento">
            <Dato l="Cliente" v={r.cliente_nombre} />
            <Dato l="RUT" v={r.cliente_rut} />
            <Dato l="Tipo de documento" v={DOCS[r.doc_tipo] || r.doc_tipo} />
            <Dato l="Referencia" v={r.doc_referencia} />
            {r.observaciones ? <Dato l="Observaciones" v={r.observaciones} /> : null}
          </Bloque>

          <Bloque titulo="Origen">
            <Dato l="Sucursal" v={(r.sucursal_id || '').replace('suc-', '')} />
            <Dato l="Solicitante" v={r.solicitante_nombre} />
            <Dato l="Ingresada" v={fechaHora(r.created_at)} />
            {r.tomada_por_nombre ? <Dato l="Tomada por" v={r.tomada_por_nombre + ' · ' + fechaHora(r.tomada_at)} /> : null}
            {r.resuelta_por_nombre ? <Dato l="Resuelta por" v={r.resuelta_por_nombre + ' · ' + fechaHora(r.resuelta_at)} /> : null}
            {r.motivo_rechazo ? <Dato l="Motivo de rechazo" v={r.motivo_rechazo} /> : null}
          </Bloque>

          {/* Comprobante */}
          <Bloque titulo="Comprobante">
            {r.comprobante_url ? (
              <div>
                {esImg ? (
                  <a href={r.comprobante_url} target="_blank" rel="noreferrer">
                    <img src={r.comprobante_url} alt="Comprobante"
                      style={{ width: '100%', borderRadius: 10, border: '1px solid #E5E7EB', display: 'block' }} />
                  </a>
                ) : (
                  <a href={r.comprobante_url} target="_blank" rel="noreferrer" style={{ ...btnGhost, display: 'inline-block', textDecoration: 'none' }}>
                    Abrir comprobante (PDF)
                  </a>
                )}
                <div style={{ marginTop: 6 }}>
                  <a href={r.comprobante_url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: '#0369A1' }}>Abrir en pestaña nueva ↗</a>
                </div>
              </div>
            ) : (
              <div style={{ padding: 14, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 8, fontSize: 12 }}>
                La solicitud llegó sin comprobante adjunto. Pídele al vendedor que lo suba antes de aprobar.
              </div>
            )}
          </Bloque>

          {/* Recordatorio de verificación */}
          {abierta && (
            <div style={{ padding: '10px 12px', background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 8, fontSize: 11.5, color: '#075985', marginBottom: 14 }}>
              Antes de aprobar: confirma en {r.medio === 'webpay_link' ? 'el portal Transbank' : 'el banco online'} que el abono
              está efectivamente acreditado por {fmt(r.monto)}. El comprobante por sí solo no es prueba de que los fondos llegaron.
            </div>
          )}

          {/* Acciones */}
          {abierta && puedeResolver && (
            <div>
              {r.estado === 'pendiente' ? (
                <button onClick={onTomar} disabled={saving} style={{ ...btnPrim, width: '100%' }}>
                  {saving ? 'Tomando…' : 'Tomar solicitud'}
                </button>
              ) : !rechazando ? (
                <div>
                  {!mia && (
                    <div style={{ padding: '8px 10px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, fontSize: 11.5, color: '#92400E', marginBottom: 8 }}>
                      La tomó {r.tomada_por_nombre}. Puedes resolverla igual si ya no está disponible.
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={onAprobar} disabled={saving} style={{ ...btnOk, flex: 1 }}>
                      {saving ? '…' : '✓ Aprobar — fondos confirmados'}
                    </button>
                    <button onClick={() => setRechazando(true)} disabled={saving} style={{ ...btnBad, flex: 1 }}>
                      ✕ Rechazar
                    </button>
                  </div>
                  <button onClick={onLiberar} disabled={saving} style={{ ...btnGhost, width: '100%', marginTop: 8 }}>
                    Liberar (devolver a pendientes)
                  </button>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Motivo del rechazo</div>
                  <select value={motivo} onChange={ev => setMotivo(ev.target.value)} style={inp}>
                    <option value="">Selecciona un motivo…</option>
                    {MOTIVOS_RECHAZO.map(x => <option key={x} value={x}>{x}</option>)}
                  </select>
                  {motivo === 'Otro' && (
                    <input value={motivoTxt} onChange={ev => setMotivoTxt(ev.target.value)} placeholder="Describe el motivo"
                      style={{ ...inp, marginTop: 8 }} />
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button onClick={onConfirmarRechazo} disabled={saving || !motivo || (motivo === 'Otro' && !motivoTxt.trim())} style={{ ...btnBad, flex: 1 }}>
                      {saving ? '…' : 'Confirmar rechazo'}
                    </button>
                    <button onClick={() => { setRechazando(false); setMotivo(''); setMotivoTxt('') }} style={{ ...btnGhost, flex: 1 }}>Cancelar</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!abierta && (
            <div style={{ padding: 12, borderRadius: 8, background: e.bg, border: '1px solid ' + e.bd, color: e.c, fontSize: 12.5, fontWeight: 700, textAlign: 'center' }}>
              Solicitud {e.l.toLowerCase()} por {r.resuelta_por_nombre || '—'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Bloque({ titulo, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9CA3AF', fontWeight: 800, marginBottom: 6 }}>{titulo}</div>
      <div style={{ border: '1px solid #EEF0F3', borderRadius: 10, overflow: 'hidden' }}>{children}</div>
    </div>
  )
}

function Dato({ l, v, fuerte }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '7px 12px', borderBottom: '1px solid #F4F5F7', fontSize: 12.5 }}>
      <div style={{ width: 150, color: '#8E8E93', flexShrink: 0 }}>{l}</div>
      <div style={{ flex: 1, fontWeight: fuerte ? 800 : 600, color: '#111827', wordBreak: 'break-word' }}>{v || '—'}</div>
    </div>
  )
}

/* ─────────────── Estilos ─────────────── */
const th = { textAlign: 'left', padding: '7px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.04em', color: '#9CA3AF', fontWeight: 800, borderBottom: '1px solid #E5E7EB', whiteSpace: 'nowrap' }
const td = { padding: '7px 10px', borderBottom: '1px solid #F4F5F7', whiteSpace: 'nowrap' }
const pill = { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 800 }
// fontSize 16: bajo ese valor Safari iOS hace zoom al enfocar
const inp = { width: '100%', padding: '10px 11px', border: '1px solid #E0E2E8', borderRadius: 8, fontSize: 16, outline: 'none', background: '#fff', maxWidth: '100%' }
const btnBase = { padding: '12px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid transparent', minHeight: 44 }
const btnPrim = { ...btnBase, background: '#1F4E79', color: '#fff' }
const btnOk = { ...btnBase, background: '#047857', color: '#fff' }
const btnBad = { ...btnBase, background: '#fff', color: '#B91C1C', border: '1px solid #FECACA' }
const btnGhost = { ...btnBase, background: '#F3F4F6', color: '#374151', border: '1px solid #E5E7EB', padding: '6px 12px', fontSize: 11.5 }
