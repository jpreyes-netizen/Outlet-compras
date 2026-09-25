import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabase'

/* ═══════════════════════════════════════════════════════════════════════════
   VALIDACIÓN DE PAGOS ELECTRÓNICOS — lado Comercial
   El vendedor/cajero levanta la solicitud con el comprobante y sigue el
   estado en vivo mientras el cliente espera en el mostrador.
   Tesorería resuelve desde Finanzas → Tesorería → Validación de pagos.
   ═══════════════════════════════════════════════════════════════════════════ */

const C1 = '#5856D6'
const fmt = n => '$' + Math.round(n || 0).toLocaleString('es-CL')

const MEDIOS = [
  { k: 'transferencia', l: 'Transferencia', ic: '🏦' },
  { k: 'webpay_link',   l: 'Webpay (link de pago)', ic: '💳' },
]
/* Solo se valida contra documento formal: nota de venta o cotizacion.
   Se sacaron borrador, abono y "otro" a proposito — un pago sin documento
   trazable no deberia pasar por aqui. */
const DOCS = [
  { k: 'nota_venta', l: 'Nota de venta' },
  { k: 'cotizacion', l: 'Cotización' },
]
const BANCOS = ['Banco de Chile', 'Santander', 'BCI', 'Estado', 'Scotiabank', 'Itaú', 'Security', 'Falabella', 'BICE', 'Consorcio', 'Ripley', 'Coopeuch', 'Mercado Pago', 'Tenpo', 'Otro']

const EST = {
  pendiente:   { l: 'Esperando a Finanzas', c: '#B45309', bg: '#FFFBEB', bd: '#FDE68A', ic: '⏳' },
  en_revision: { l: 'Finanzas revisando',   c: '#1D4ED8', bg: '#EFF6FF', bd: '#BFDBFE', ic: '🔎' },
  aprobada:    { l: 'Aprobada',             c: '#047857', bg: '#ECFDF5', bd: '#A7F3D0', ic: '✅' },
  rechazada:   { l: 'Rechazada',            c: '#B91C1C', bg: '#FEF2F2', bd: '#FECACA', ic: '⛔' },
}

const hoyCL = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })
const horaCL = () => new Date().toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false })
const fechaHora = iso => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }) + ' ' +
         d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false })
}
const transcurrido = (desde, hasta) => {
  if (!desde) return '—'
  const s = Math.max(0, Math.floor(((hasta ? new Date(hasta) : new Date()).getTime() - new Date(desde).getTime()) / 1000))
  const m = Math.floor(s / 60)
  return m < 1 ? s + ' s' : m < 60 ? m + ' min ' + (s % 60) + ' s' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'
}

function beep(ok) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    const osc = ctx.createOscillator(); const g = ctx.createGain()
    osc.connect(g); g.connect(ctx.destination)
    osc.type = 'sine'; osc.frequency.value = ok ? 1046 : 392
    g.gain.setValueAtTime(0.0001, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6)
    osc.start(); osc.stop(ctx.currentTime + 0.65)
    setTimeout(() => { try { ctx.close() } catch (e) {} }, 1000)
  } catch (e) {}
}

export function TabValidaciones({ sucursales, sucSel, setSucSel, cu, esGerente, isMobile }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(null)
  const [sel, setSel] = useState(null)
  const [tick, setTick] = useState(0)
  const [online, setOnline] = useState(false)
  const [err, setErr] = useState('')

  const estadosRef = useRef({})

  /* SUCURSAL DEL SOLICITANTE
     Antes caia a la sucursal seleccionada en Comercial, que se inicializa sola
     con la primera tienda (La Granja): toda solicitud de un usuario sin
     usuarios.sucursal_id quedaba registrada en La Granja. Ahora:
       1) usuarios.sucursal_id, si existe, manda
       2) si no, las sucursales asignadas en usuario_acceso (activas)
       3) nunca un valor por defecto: si es ambiguo, el usuario elige
     misSucs = null mientras carga (el boton queda deshabilitado). */
  const [misSucs, setMisSucs] = useState(null)
  const [catSucs, setCatSucs] = useState([])

  useEffect(() => {
    let cancel = false
    if (!cu?.id) { setMisSucs([]); return }
    Promise.all([
      supabase.from('usuarios').select('sucursal_id').eq('id', cu.id).maybeSingle(),
      supabase.from('usuario_acceso').select('sucursal_id, activo').eq('usuario_id', cu.id),
      supabase.from('sucursales').select('id, nombre, es_cd, activo, orden'),
    ]).then(([u, ua, sc]) => {
      if (cancel) return
      const directa = cu?.sucursal_id || u?.data?.sucursal_id || null
      const set = new Set()
      if (directa) set.add(directa)
      else (ua?.data || []).forEach(x => { if (x.sucursal_id && x.activo !== false) set.add(x.sucursal_id) })
      setMisSucs([...set])
      setCatSucs(sc?.data || [])
    }).catch(() => { if (!cancel) setMisSucs([]) })
    return () => { cancel = true }
  }, [cu?.id, cu?.sucursal_id])

  // Puntos de venta: fuera Matriz y CD. Pagina Web al final.
  const puntosVenta = useMemo(() => (catSucs || [])
    .filter(x => x.activo !== false && !x.es_cd && x.id !== 'suc-admin')
    .sort((a, b) => (a.id === 'suc-web') - (b.id === 'suc-web') || (a.orden || 0) - (b.orden || 0)),
  [catSucs])
  const nombreSuc = id => (catSucs.find(x => x.id === id) || {}).nombre || id
  const misSucsKey = (misSucs || []).join(',')

  const cargar = async (silencioso) => {
    if (!silencioso) setLoading(true)
    try {
      const desde = new Date(Date.now() - 14 * 86400000).toISOString()
      let q = supabase.from('val_pagos').select('*').gte('created_at', desde)
        .order('created_at', { ascending: false }).limit(300)
      if (!esGerente) {
        const mias = misSucs || []
        q = mias.length
          ? q.or(`sucursal_id.in.(${mias.join(',')}),solicitante_id.eq.${cu?.id}`)
          : q.eq('solicitante_id', cu?.id || '')
      }
      const { data, error } = await q
      if (error) { setErr(error.message); return }
      setErr('')
      setRows(data || [])
      ;(data || []).forEach(r => { estadosRef.current[r.id] = r.estado })
    } finally { setLoading(false) }
  }

  useEffect(() => { if (misSucs !== null) cargar() }, [misSucsKey, misSucs === null, esGerente])

  /* Realtime — una sola suscripción; el filtro por sucursal se hace acá */
  useEffect(() => {
    const mias = misSucs || []
    const visible = r => esGerente || mias.includes(r.sucursal_id) || (cu?.id && r.solicitante_id === cu.id)
    const ch = supabase
      .channel('val_pagos_comercial')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'val_pagos' }, payload => {
        const n = payload.new
        if (payload.eventType === 'DELETE' && payload.old) {
          setRows(p => p.filter(r => r.id !== payload.old.id)); return
        }
        if (!n || !visible(n)) return
        if (payload.eventType === 'INSERT') {
          setRows(p => (p.some(r => r.id === n.id) ? p : [n, ...p]))
        } else {
          const antes = estadosRef.current[n.id]
          if (antes && antes !== n.estado && (n.estado === 'aprobada' || n.estado === 'rechazada')) {
            beep(n.estado === 'aprobada')
          }
          setRows(p => p.map(r => (r.id === n.id ? n : r)))
          setSel(s => (s && s.id === n.id ? n : s))
        }
        estadosRef.current[n.id] = n.estado
      })
      .subscribe(st => setOnline(st === 'SUBSCRIBED'))
    return () => { try { supabase.removeChannel(ch) } catch (e) {} }
  }, [misSucsKey, esGerente])

  /* Polling de respaldo cada 15 s */
  useEffect(() => {
    if (misSucs === null) return
    const id = setInterval(() => cargar(true), 15000)
    return () => clearInterval(id)
  }, [misSucsKey, misSucs === null, esGerente])

  /* Cronómetro vivo */
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const abiertas = useMemo(
    () => rows.filter(r => r.estado === 'pendiente' || r.estado === 'en_revision'),
    [rows, tick]
  )
  const cerradas = useMemo(() => rows.filter(r => r.estado === 'aprobada' || r.estado === 'rechazada'), [rows])

  const nuevaSolicitud = () => setForm({
    sucursal_id: (misSucs || []).length === 1 ? misSucs[0] : '',
    medio: 'transferencia',
    monto: '',
    cliente_nombre: '',
    cliente_rut: '',
    banco_origen: '',
    fecha_pago: hoyCL(),
    hora_pago: horaCL(),
    doc_tipo: 'nota_venta',
    doc_referencia: '',
    observaciones: '',
    archivo: null,
  })

  return (
    <div>
      {/* Encabezado */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <button onClick={nuevaSolicitud} disabled={misSucs === null} style={{
          opacity: misSucs === null ? 0.6 : 1,
          background: `linear-gradient(135deg,${C1},#3d3ba3)`, color: '#fff', border: 'none',
          padding: isMobile ? '13px 18px' : '10px 18px', borderRadius: 10,
          fontSize: isMobile ? 15 : 13.5, fontWeight: 800, cursor: 'pointer',
          width: isMobile ? '100%' : undefined,
          boxShadow: '0 2px 8px rgba(88,86,214,.3)',
        }}>+ Solicitar validación de pago</button>

        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: online ? '#059669' : '#D97706', fontWeight: 700 }}>
          <span style={{ width: 7, height: 7, borderRadius: 4, background: online ? '#059669' : '#D97706', display: 'inline-block' }} />
          {online ? 'Conectado en vivo' : 'Reconectando…'}
        </span>

        {esGerente
          ? <span style={{ fontSize: 11, color: '#8b88a8' }}>Viendo todas las sucursales</span>
          : misSucs && misSucs.length > 0 && (
              <span style={{ fontSize: 11, color: '#3c3a5e', fontWeight: 700 }}>
                📍 {misSucs.map(nombreSuc).join(' · ')}
              </span>
            )}
        <button onClick={() => cargar()} style={btnGhost}>Refrescar</button>
      </div>

      {err && (
        <div style={{ padding: '8px 12px', background: '#FF3B3010', color: '#FF3B30', borderRadius: 8, fontSize: 12, marginBottom: 10 }}>{err}</div>
      )}

      {/* En curso */}
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: '#8b88a8', fontWeight: 800, marginBottom: 8 }}>
        En curso ({abiertas.length})
      </div>
      {loading ? (
        <Vacio txt="Cargando…" />
      ) : abiertas.length === 0 ? (
        <Vacio txt="No tienes validaciones en curso." />
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {abiertas.map(r => <Tarjeta key={r.id} r={r} onClick={() => setSel(r)} isMobile={isMobile} />)}
        </div>
      )}

      {/* Resueltas */}
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: '#8b88a8', fontWeight: 800, margin: '20px 0 8px' }}>
        Resueltas ({cerradas.length}) — últimos 14 días
      </div>
      {cerradas.length === 0 ? (
        <Vacio txt="Sin registros." />
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {cerradas.slice(0, 40).map(r => <Tarjeta key={r.id} r={r} onClick={() => setSel(r)} isMobile={isMobile} />)}
        </div>
      )}

      {form && (
        <FormularioSolicitud
          form={form} setForm={setForm} cu={cu} esGerente={esGerente}
          misSucs={misSucs || []} puntosVenta={puntosVenta} nombreSuc={nombreSuc}
          onClose={() => setForm(null)}
          onCreada={r => {
            setForm(null)
            estadosRef.current[r.id] = r.estado
            setRows(p => (p.some(x => x.id === r.id) ? p : [r, ...p]))
            setSel(r)
          }}
        />
      )}

      {sel && <DetalleSolicitud r={sel} onClose={() => setSel(null)} tick={tick} />}
    </div>
  )
}

/* ─────────────── Tarjeta de seguimiento ─────────────── */
function Tarjeta({ r, onClick, isMobile }) {
  const e = EST[r.estado] || EST.pendiente
  const abierta = r.estado === 'pendiente' || r.estado === 'en_revision'
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', background: '#fff',
      border: '1px solid ' + e.bd, borderLeft: '4px solid ' + e.c, borderRadius: 10, cursor: 'pointer',
    }}>
      <div style={{ fontSize: 20 }}>{e.ic}</div>
      <div style={{ minWidth: isMobile ? 90 : 120 }}>
        <div style={{ fontFamily: 'monospace', fontSize: 10.5, color: '#8b88a8' }}>{r.id}</div>
        <div style={{ fontSize: 14, fontWeight: 800 }}>{fmt(r.monto)}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: e.c }}>{e.l}</div>
        <div style={{ fontSize: 11, color: '#8b88a8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {r.cliente_nombre || 'Sin cliente'}{r.doc_referencia ? ' · ' + r.doc_referencia : ''}
          {r.estado === 'rechazada' && r.motivo_rechazo ? ' · ' + r.motivo_rechazo : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: abierta ? e.c : '#8b88a8' }}>
          {abierta ? transcurrido(r.created_at) : transcurrido(r.created_at, r.resuelta_at)}
        </div>
        <div style={{ fontSize: 10, color: '#8b88a8' }}>{abierta ? 'esperando' : 'de respuesta'}</div>
      </div>
    </div>
  )
}

/* ─────────────── Formulario de solicitud ─────────────── */
function FormularioSolicitud({ form, setForm, cu, esGerente, misSucs, puntosVenta, nombreSuc, onClose, onCreada }) {
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState('')
  const fileRef = useRef(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const tomarArchivo = ev => {
    const f = ev.target.files && ev.target.files[0]
    if (!f) return
    if (f.size > 10 * 1024 * 1024) { setError('El archivo supera 10 MB.'); return }
    setError('')
    set('archivo', f)
    if (/^image\//.test(f.type)) {
      const rd = new FileReader()
      rd.onload = () => setPreview(rd.result)
      rd.readAsDataURL(f)
    } else setPreview('')
  }

  const enviar = async () => {
    const monto = Number(String(form.monto).replace(/[^\d]/g, ''))
    if (!monto || monto <= 0) { setError('Ingresa el monto del pago.'); return }
    if (!form.sucursal_id) { setError('Elige la sucursal donde está el cliente.'); return }
    if (!form.doc_referencia.trim()) { setError('Ingresa el número de la nota de venta o cotización.'); return }
    setGuardando(true); setError('')
    try {
      // 1) Crear la solicitud primero (así Finanzas la ve de inmediato)
      const { data, error: e1 } = await supabase.from('val_pagos').insert({
        sucursal_id: form.sucursal_id,
        solicitante_id: cu?.id || null,
        solicitante_nombre: cu?.nombre || cu?.correo || '',
        medio: form.medio,
        monto,
        cliente_nombre: form.cliente_nombre || null,
        cliente_rut: form.cliente_rut || null,
        banco_origen: form.medio === 'transferencia' ? (form.banco_origen || null) : null,
        fecha_pago: form.fecha_pago || null,
        hora_pago: form.hora_pago || null,
        doc_tipo: form.doc_tipo,
        doc_referencia: form.doc_referencia || null,
        observaciones: form.observaciones || null,
      }).select().single()
      if (e1) { setError(e1.message); setGuardando(false); return }

      // 2) Subir comprobante y actualizar la URL
      if (form.archivo) {
        const ext = (form.archivo.name.split('.').pop() || 'jpg').toLowerCase()
        const path = `validaciones/${form.sucursal_id}/${data.id}_${Date.now()}.${ext}`
        const { error: e2 } = await supabase.storage.from('fin-validaciones')
          .upload(path, form.archivo, { upsert: true, contentType: form.archivo.type || undefined })
        if (!e2) {
          const { data: pub } = supabase.storage.from('fin-validaciones').getPublicUrl(path)
          const url = pub?.publicUrl || ''
          if (url) {
            const { data: upd } = await supabase.from('val_pagos')
              .update({ comprobante_url: url }).eq('id', data.id).select().maybeSingle()
            onCreada(upd || { ...data, comprobante_url: url })
            return
          }
        }
      }
      onCreada(data)
    } finally { setGuardando(false) }
  }

  // Opciones: gerente -> todos los puntos de venta; usuario con varias -> las suyas;
  // usuario sin sucursal asignada -> todos los puntos de venta (debe elegir).
  const fijo = !esGerente && misSucs.length === 1
  const opciones = esGerente || misSucs.length === 0
    ? puntosVenta
    : puntosVenta.filter(x => misSucs.includes(x.id)).concat(
        misSucs.filter(id => !puntosVenta.some(x => x.id === id)).map(id => ({ id, nombre: nombreSuc(id) })))

  return (
    <div onClick={onClose} style={ovl}>
      <div onClick={ev => ev.stopPropagation()} style={{ ...panel, maxWidth: 520 }}>
        <div style={hdr}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Solicitar validación de pago</div>
            <div style={{ fontSize: 11, color: '#9aa0c0' }}>Finanzas confirma que los fondos llegaron</div>
          </div>
          <button onClick={onClose} style={btnX}>✕</button>
        </div>

        <div style={{ padding: 18 }}>
          <Campo l="Medio de pago">
            <div style={{ display: 'flex', gap: 8 }}>
              {MEDIOS.map(m => (
                <button key={m.k} onClick={() => set('medio', m.k)} style={{
                  flex: 1, padding: '10px 8px', borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                  background: form.medio === m.k ? C1 : '#fff',
                  color: form.medio === m.k ? '#fff' : '#3c3a5e',
                  border: '1px solid ' + (form.medio === m.k ? C1 : '#e0def0'),
                }}>{m.ic} {m.l}</button>
              ))}
            </div>
          </Campo>

          <Campo l="Monto *">
            <input inputMode="numeric" value={form.monto}
              onChange={ev => set('monto', ev.target.value.replace(/[^\d]/g, ''))}
              placeholder="Ej: 350000" style={inp} />
            {form.monto ? <div style={{ fontSize: 12, color: C1, fontWeight: 800, marginTop: 4 }}>{fmt(form.monto)}</div> : null}
          </Campo>

          {form.medio === 'transferencia' && (
            <Campo l="Banco de origen">
              <select value={form.banco_origen} onChange={ev => set('banco_origen', ev.target.value)} style={inp}>
                <option value="">Selecciona…</option>
                {BANCOS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </Campo>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Campo l="Fecha del pago" flex>
              <input type="date" value={form.fecha_pago} onChange={ev => set('fecha_pago', ev.target.value)} style={inp} />
            </Campo>
            <Campo l="Hora" flex>
              <input type="time" value={form.hora_pago} onChange={ev => set('hora_pago', ev.target.value)} style={inp} />
            </Campo>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Campo l="Cliente" flex>
              <input value={form.cliente_nombre} onChange={ev => set('cliente_nombre', ev.target.value)} placeholder="Nombre" style={inp} />
            </Campo>
            <Campo l="RUT" flex>
              <input value={form.cliente_rut} onChange={ev => set('cliente_rut', ev.target.value)} placeholder="12.345.678-9" style={inp} />
            </Campo>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Campo l="Documento asociado" flex>
              <div style={{ display: 'flex', gap: 6 }}>
                {DOCS.map(d => (
                  <button key={d.k} onClick={() => set('doc_tipo', d.k)} style={{
                    flex: 1, padding: '10px 6px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                    background: form.doc_tipo === d.k ? C1 : '#fff',
                    color: form.doc_tipo === d.k ? '#fff' : '#3c3a5e',
                    border: '1px solid ' + (form.doc_tipo === d.k ? C1 : '#e0def0'),
                  }}>{d.l}</button>
                ))}
              </div>
            </Campo>
            <Campo l="N° / referencia *" flex>
              <input value={form.doc_referencia} onChange={ev => set('doc_referencia', ev.target.value)} placeholder="Folio o número" style={inp} />
            </Campo>
          </div>

          <Campo l="Sucursal donde está el cliente *">
            {fijo ? (
              <div style={{ ...inp, background: '#f4f4fa', fontWeight: 700, color: '#3c3a5e' }}>
                {nombreSuc(form.sucursal_id)}
              </div>
            ) : (
              <select value={form.sucursal_id} onChange={ev => set('sucursal_id', ev.target.value)}
                style={{ ...inp, borderColor: form.sucursal_id ? undefined : '#F59E0B' }}>
                <option value="">— Elige la sucursal —</option>
                {opciones.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
              </select>
            )}
          </Campo>

          <Campo l="Comprobante (foto o PDF)">
            <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment"
              onChange={tomarArchivo} style={{ display: 'none' }} />
            <button onClick={() => fileRef.current && fileRef.current.click()} style={{
              width: '100%', padding: '14px', borderRadius: 10, border: '2px dashed ' + (form.archivo ? '#34C759' : '#d5d3ea'),
              background: form.archivo ? '#34C75910' : '#faf9ff', color: form.archivo ? '#1d7a3a' : '#6b6890',
              fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
            }}>
              {form.archivo ? '📎 ' + form.archivo.name : '📷 Tomar foto o adjuntar archivo'}
            </button>
            {preview ? <img src={preview} alt="Vista previa" style={{ width: '100%', marginTop: 8, borderRadius: 8, border: '1px solid #e0def0' }} /> : null}
          </Campo>

          <Campo l="Observaciones">
            <textarea value={form.observaciones} onChange={ev => set('observaciones', ev.target.value)} rows={2}
              placeholder="Opcional" style={{ ...inp, resize: 'vertical' }} />
          </Campo>

          {error && <div style={{ padding: '8px 12px', background: '#FF3B3010', color: '#FF3B30', borderRadius: 8, fontSize: 12, marginBottom: 10 }}>{error}</div>}

          <button onClick={enviar} disabled={guardando} style={{
            width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: guardando ? 'default' : 'pointer',
            background: guardando ? '#b9b7e0' : `linear-gradient(135deg,${C1},#3d3ba3)`, color: '#fff', fontSize: 14, fontWeight: 800,
          }}>{guardando ? 'Enviando…' : 'Enviar a Finanzas'}</button>
        </div>
      </div>
    </div>
  )
}

/* ─────────────── Detalle / seguimiento en vivo ─────────────── */
function DetalleSolicitud({ r, onClose, tick }) {
  const e = EST[r.estado] || EST.pendiente
  const abierta = r.estado === 'pendiente' || r.estado === 'en_revision'
  const esImg = /\.(png|jpe?g|webp|gif|heic)$/i.test(r.comprobante_url || '')

  return (
    <div onClick={onClose} style={ovl}>
      <div onClick={ev => ev.stopPropagation()} style={{ ...panel, maxWidth: 480 }}>
        <div style={hdr}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>{fmt(r.monto)}</div>
            <div style={{ fontSize: 11, color: '#9aa0c0', fontFamily: 'monospace' }}>{r.id}</div>
          </div>
          <button onClick={onClose} style={btnX}>✕</button>
        </div>

        <div style={{ padding: 18 }}>
          {/* Semáforo grande — lo que mira el vendedor con el cliente al frente */}
          <div style={{
            padding: '20px 16px', borderRadius: 12, textAlign: 'center', marginBottom: 16,
            background: e.bg, border: '2px solid ' + e.bd,
          }}>
            <div style={{ fontSize: 40, lineHeight: 1 }}>{e.ic}</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: e.c, marginTop: 8 }}>{e.l}</div>
            <div style={{ fontSize: 12.5, color: e.c, opacity: .85, marginTop: 4 }}>
              {abierta
                ? 'Esperando hace ' + transcurrido(r.created_at)
                : 'Resuelta en ' + transcurrido(r.created_at, r.resuelta_at) + ' por ' + (r.resuelta_por_nombre || '—')}
            </div>
            {r.estado === 'en_revision' && r.tomada_por_nombre && (
              <div style={{ fontSize: 11.5, color: e.c, marginTop: 6 }}>{r.tomada_por_nombre} está revisando</div>
            )}
            {r.estado === 'rechazada' && r.motivo_rechazo && (
              <div style={{ marginTop: 10, padding: '8px 12px', background: '#fff', borderRadius: 8, fontSize: 12.5, fontWeight: 700, color: '#B91C1C' }}>
                {r.motivo_rechazo}
              </div>
            )}
            {r.estado === 'aprobada' && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#047857', fontWeight: 700 }}>
                Fondos confirmados — puedes emitir el documento.
              </div>
            )}
          </div>

          <div style={{ border: '1px solid #eeecf8', borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
            <Dato l="Medio" v={(MEDIOS.find(m => m.k === r.medio) || {}).l || r.medio} />
            {r.banco_origen ? <Dato l="Banco" v={r.banco_origen} /> : null}
            <Dato l="Cliente" v={[r.cliente_nombre, r.cliente_rut].filter(Boolean).join(' · ')} />
            <Dato l="Documento" v={[(DOCS.find(d => d.k === r.doc_tipo) || {}).l || r.doc_tipo, r.doc_referencia].filter(Boolean).join(' · ')} />
            <Dato l="Enviada" v={fechaHora(r.created_at)} />
            {r.observaciones ? <Dato l="Observaciones" v={r.observaciones} /> : null}
          </div>

          {r.comprobante_url ? (
            esImg
              ? <a href={r.comprobante_url} target="_blank" rel="noreferrer">
                  <img src={r.comprobante_url} alt="Comprobante" style={{ width: '100%', borderRadius: 10, border: '1px solid #e0def0', display: 'block' }} />
                </a>
              : <a href={r.comprobante_url} target="_blank" rel="noreferrer" style={{ ...btnGhost, display: 'inline-block', textDecoration: 'none' }}>Abrir comprobante ↗</a>
          ) : (
            <div style={{ padding: 12, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 8, fontSize: 12 }}>
              Esta solicitud no lleva comprobante adjunto. Finanzas puede rechazarla por eso.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─────────────── Auxiliares ─────────────── */
function Campo({ l, children, flex }) {
  return (
    <div style={{ marginBottom: 12, flex: flex ? '1 1 140px' : undefined, minWidth: 0 }}>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8', fontWeight: 800, marginBottom: 5 }}>{l}</div>
      {children}
    </div>
  )
}
function Dato({ l, v }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '7px 12px', borderBottom: '1px solid #f5f4fb', fontSize: 12.5 }}>
      <div style={{ width: 118, color: '#8b88a8', flexShrink: 0 }}>{l}</div>
      <div style={{ flex: 1, fontWeight: 600, wordBreak: 'break-word' }}>{v || '—'}</div>
    </div>
  )
}
function Vacio({ txt }) {
  return <div style={{ padding: 26, textAlign: 'center', color: '#8b88a8', fontSize: 12.5, background: '#faf9ff', border: '1px dashed #e0def0', borderRadius: 10 }}>{txt}</div>
}

const ovl = { position: 'fixed', inset: 0, background: 'rgba(20,18,40,.5)', zIndex: 300, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 'clamp(0px, 2vw, 16px)', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }
const panel = { width: '100%', background: '#fff', borderRadius: 14, overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,.28)', marginTop: 'clamp(0px, 3vw, 20px)', marginBottom: 'calc(40px + env(safe-area-inset-bottom, 0px))' }
const hdr = { background: 'linear-gradient(135deg,#1a1a2e,#16213e)', color: '#fff', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10 }
const btnX = { background: 'rgba(255,255,255,.12)', border: 'none', color: '#fff', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontSize: 13 }
// fontSize 16 es obligatorio: bajo ese valor Safari iOS hace zoom al enfocar el input
const inp = { width: '100%', padding: '10px 11px', border: '1px solid #e0def0', borderRadius: 8, fontSize: 16, outline: 'none', background: '#fff', maxWidth: '100%' }
const btnGhost = { padding: '7px 13px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', background: '#f0effa', color: '#4a4870', border: '1px solid #e0def0' }
