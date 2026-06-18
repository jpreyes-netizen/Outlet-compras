import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Save, Sparkles, Info, CalendarDays } from 'lucide-react'
import { supabase } from '../../supabase'

const PRIMARY = '#1F4E79'
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const VENTA_CODIGOS = ['950','960','970','980']  // GETNET, EFECTIVO, TRANSFERENCIA, TRANSBANK
const ANIOS = [2024, 2025, 2026, 2027]

function fmtCLP(n) {
  if (n == null || n === 0) return '—'
  const abs = Math.abs(Math.round(n))
  return (n < 0 ? '−$' : '$') + abs.toLocaleString('es-CL')
}
function fmtCLPplano(n) { return '$' + Math.round(n || 0).toLocaleString('es-CL') }

// ── Calendario TZ-safe (Chile UTC-4): NUNCA parsear ISO con new Date(str) ──
function diaSemana(y, m, d) { return new Date(Date.UTC(y, m - 1, d)).getUTCDay() }   // 0=Dom .. 6=Sáb
function diasDelMes(y, m)   { return new Date(Date.UTC(y, m, 0)).getUTCDate() }
function isoDe(y, m, d)     { return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` }

// Días hábiles de un mes: Lun-Sáb, excluye domingos + feriados irrenunciables
function diasHabilesMes(y, m, irrenunciables) {
  let n = 0
  const total = diasDelMes(y, m)
  for (let d = 1; d <= total; d++) {
    if (diaSemana(y, m, d) === 0) continue
    if (irrenunciables.has(isoDe(y, m, d))) continue
    n++
  }
  return n
}

const TH = { padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#374151', background: '#F1F5F9', whiteSpace: 'nowrap' }
const TD = { padding: '7px 8px', fontSize: 12, color: '#374151', borderBottom: '1px solid #F1F5F9' }

export function ProyeccionCompromisosTab({ anio, setAnio }) {
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [sugiriendo, setSugiriendo] = useState(false)
  const [feriados, setFeriados] = useState(new Set())   // ISO strings irrenunciables del año
  const [venta, setVenta]       = useState({})          // { 1: monto, ... 12 }
  const [umbral, setUmbral]     = useState(60000000)

  // ── Cargar config + feriados ──
  useEffect(() => {
    let cancelado = false
    ;(async () => {
      setLoading(true)
      try {
        const desde = `${anio}-01-01`, hasta = `${anio}-12-31`
        const [cfgR, ferR] = await Promise.all([
          supabase.from('flujo_proyeccion_config').select('*').eq('anio', anio).maybeSingle(),
          supabase.from('feriados').select('fecha').eq('irrenunciable', true).gte('fecha', desde).lte('fecha', hasta),
        ])
        if (cancelado) return

        const set = new Set((ferR.data ?? []).map(f => f.fecha))
        setFeriados(set)

        const cfg = cfgR.data
        const vd = {}
        const raw = cfg?.venta_diaria ?? {}
        for (let m = 1; m <= 12; m++) vd[m] = Number(raw[m] ?? raw[String(m)] ?? 0) || 0
        setVenta(vd)
        setUmbral(Number(cfg?.umbral_minimo ?? 60000000) || 60000000)
      } catch (e) {
        toast.error('Error cargando config: ' + (e?.message ?? '?'))
      } finally {
        if (!cancelado) setLoading(false)
      }
    })()
    return () => { cancelado = true }
  }, [anio])

  // ── Días hábiles por mes ──
  const habiles = useMemo(() => {
    const h = {}
    for (let m = 1; m <= 12; m++) h[m] = diasHabilesMes(anio, m, feriados)
    return h
  }, [anio, feriados])

  const totalHabiles = useMemo(() => Object.values(habiles).reduce((s, n) => s + n, 0), [habiles])
  const ingresoMes   = useMemo(() => {
    const i = {}
    for (let m = 1; m <= 12; m++) i[m] = (habiles[m] || 0) * (venta[m] || 0)
    return i
  }, [habiles, venta])
  const ingresoAnio  = useMemo(() => Object.values(ingresoMes).reduce((s, n) => s + n, 0), [ingresoMes])

  // ── Guardar config ──
  async function guardar() {
    setSaving(true)
    try {
      const vd = {}
      for (let m = 1; m <= 12; m++) vd[m] = Number(venta[m] || 0)
      const { error } = await supabase
        .from('flujo_proyeccion_config')
        .upsert({ anio, umbral_minimo: Number(umbral || 0), venta_diaria: vd, updated_at: new Date().toISOString() }, { onConflict: 'anio' })
      if (error) throw error
      toast.success('Parámetros guardados')
    } catch (e) {
      toast.error('Error guardando: ' + (e?.message ?? '?'))
    } finally {
      setSaving(false)
    }
  }

  // ── Sugerir venta diaria desde ventas reales del banco (este año) ──
  async function sugerirDesdeHistorico() {
    setSugiriendo(true)
    try {
      const desde = `${anio}-01-01`, hasta = `${anio}-12-31`
      const [cmR, scR] = await Promise.all([
        supabase.from('cuentas_madre').select('id, codigo').eq('activa', true).in('codigo', VENTA_CODIGOS),
        supabase.from('subcuentas').select('id, cuenta_madre_id').eq('activa', true),
      ])
      const cmIds = new Set((cmR.data ?? []).map(c => c.id))
      const subVenta = new Set((scR.data ?? []).filter(s => cmIds.has(s.cuenta_madre_id)).map(s => s.id))
      if (subVenta.size === 0) { toast.error('No encontré subcuentas de venta clasificadas'); return }

      const { data: movs, error } = await supabase
        .from('movimientos_bancarios')
        .select('monto, tipo, fecha, mes_nominal, subcuenta_id')
        .eq('tipo', 'ABONO')
        .gte('fecha', desde).lte('fecha', hasta)
        .not('subcuenta_id', 'is', null)
        .limit(50000)
      if (error) throw error

      const ventaRealMes = new Array(13).fill(0)
      for (const mv of movs ?? []) {
        if (!subVenta.has(mv.subcuenta_id)) continue
        const m = mv.mes_nominal ?? parseInt(String(mv.fecha).split('-')[1], 10)
        if (m >= 1 && m <= 12) ventaRealMes[m] += Math.abs(Number(mv.monto) || 0)
      }

      // Por-día de meses con data; promedio para rellenar meses sin data (futuros)
      const porDia = {}
      const tasas = []
      for (let m = 1; m <= 12; m++) {
        if (ventaRealMes[m] > 0 && habiles[m] > 0) {
          const t = ventaRealMes[m] / habiles[m]
          porDia[m] = Math.round(t)
          tasas.push(t)
        }
      }
      if (tasas.length === 0) { toast.error('Aún no hay ventas clasificadas este año para sugerir'); return }
      const promDia = Math.round(tasas.reduce((s, n) => s + n, 0) / tasas.length)

      const nueva = {}
      for (let m = 1; m <= 12; m++) nueva[m] = porDia[m] ?? promDia
      setVenta(nueva)
      toast.success(`Sugerido desde ${tasas.length} mes(es) con venta real — ajusta y guarda`)
    } catch (e) {
      toast.error('Error sugiriendo: ' + (e?.message ?? '?'))
    } finally {
      setSugiriendo(false)
    }
  }

  if (loading) {
    return <div style={{ padding: 60, textAlign: 'center', color: '#94A3B8' }}><Loader2 size={28} className="spin" /><div style={{ marginTop: 10, fontSize: 13 }}>Cargando configuración…</div></div>
  }

  const btn = (extra) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
    borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, ...extra,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#fff', padding: 12, borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: PRIMARY }}>Año</span>
        <select value={anio} onChange={e => setAnio(Number(e.target.value))}
          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 13, fontWeight: 600, color: '#374151' }}>
          {ANIOS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button onClick={sugerirDesdeHistorico} disabled={sugiriendo}
          style={btn({ background: '#EEF2FF', color: '#4338CA' })}>
          {sugiriendo ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Sugerir desde ventas reales
        </button>
        <button onClick={guardar} disabled={saving}
          style={btn({ background: PRIMARY, color: '#fff' })}>
          {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Guardar
        </button>
      </div>

      {/* Info modelo */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '12px 14px' }}>
        <Info size={16} style={{ color: '#1D4ED8', flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: '#1E3A5F', lineHeight: 1.5 }}>
          <b>Ingresos proyectados</b> = días hábiles × venta diaria. Hábil = Lun–Sáb, excluyendo domingos y los{' '}
          <b>{feriados.size}</b> feriados irrenunciables de {anio}. Esta es la <b>cara de ingresos</b> del modelo.
          En la siguiente etapa se suman los compromisos (compras, remuneraciones, overhead, créditos, impuestos) y el <b>saldo proyectado semana a semana</b>.
        </div>
      </div>

      {/* Tabla editable: venta diaria → días hábiles → ingreso proyectado */}
      <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
            <thead>
              <tr>
                <th style={{ ...TH, position: 'sticky', left: 0, zIndex: 2, minWidth: 180 }}>Concepto</th>
                {MESES.map(m => <th key={m} style={{ ...TH, textAlign: 'right', minWidth: 88 }}>{m}</th>)}
                <th style={{ ...TH, textAlign: 'right', background: '#E0F2FE', color: '#0369A1', minWidth: 110 }}>Año</th>
              </tr>
            </thead>
            <tbody>
              {/* Venta diaria — editable */}
              <tr>
                <td style={{ ...TD, position: 'sticky', left: 0, background: '#fff', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CalendarDays size={13} style={{ color: PRIMARY }} /> Venta diaria
                </td>
                {MESES.map((_, i) => {
                  const m = i + 1
                  return (
                    <td key={m} style={{ ...TD, padding: '4px 4px', textAlign: 'right' }}>
                      <input
                        value={venta[m] ? String(venta[m]) : ''}
                        onChange={e => {
                          const v = parseInt(e.target.value.replace(/\D/g, ''), 10)
                          setVenta(prev => ({ ...prev, [m]: isNaN(v) ? 0 : v }))
                        }}
                        placeholder="0"
                        style={{
                          width: '100%', textAlign: 'right', fontFamily: 'monospace', fontSize: 11,
                          padding: '5px 6px', border: '1px solid #E5E7EB', borderRadius: 6, color: '#1E40AF', fontWeight: 600,
                        }}
                      />
                    </td>
                  )
                })}
                <td style={{ ...TD, textAlign: 'right', color: '#9CA3AF', background: '#F8FAFC' }}>—</td>
              </tr>

              {/* Días hábiles */}
              <tr style={{ background: '#FAFAFA' }}>
                <td style={{ ...TD, position: 'sticky', left: 0, background: '#FAFAFA', fontWeight: 600, color: '#6B7280' }}>Días hábiles</td>
                {MESES.map((_, i) => (
                  <td key={i} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#6B7280' }}>{habiles[i + 1]}</td>
                ))}
                <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#374151', background: '#EFF6FF' }}>{totalHabiles}</td>
              </tr>

              {/* Ingreso proyectado */}
              <tr style={{ background: '#F0FDF4', fontWeight: 700 }}>
                <td style={{ ...TD, position: 'sticky', left: 0, background: '#F0FDF4', color: '#166534' }}>Ingreso proyectado</td>
                {MESES.map((_, i) => (
                  <td key={i} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: ingresoMes[i + 1] ? '#15803D' : '#D1D5DB' }}>{fmtCLP(ingresoMes[i + 1])}</td>
                ))}
                <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: '#15803D', background: '#DCFCE7' }}>{fmtCLP(ingresoAnio)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Umbral mínimo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', padding: 14, borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#991B1B' }}>Umbral mínimo de caja</div>
        <input
          value={umbral ? String(umbral) : ''}
          onChange={e => { const v = parseInt(e.target.value.replace(/\D/g, ''), 10); setUmbral(isNaN(v) ? 0 : v) }}
          style={{ width: 180, textAlign: 'right', fontFamily: 'monospace', fontSize: 13, padding: '7px 10px', border: '1px solid #FCA5A5', borderRadius: 8, color: '#991B1B', fontWeight: 600 }}
        />
        <div style={{ fontSize: 12, color: '#6B7280' }}>
          {fmtCLPplano(umbral)} — saldo que nunca quieres cruzar. Dispara alertas rojas en el saldo proyectado (etapa de riesgo).
        </div>
      </div>

      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
