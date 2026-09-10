import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { toast } from 'sonner'
import { FuenteDrawer, abrirFuente } from './FuenteDrawer'
import { exportarExcel, exportarPDF } from './exportUtils'

/* ══════════════════════════════════════════════════════════════════════
   KPIs DEL CARGO — Jefa de Administración y Finanzas
   Implementa el Anexo de Incentivo Variable: 7 indicadores con niveles
   0/50/100, Parte B ponderada (20/20/15/20/10/5/10), registro de
   escalamientos (neutralización) y calendario tributario.
   Fuentes: v_kpi_jefa_finanzas · v_kpi_parte_b_mensual · kpi_escalamientos ·
   trib_calendario. Todo dato es verificable con un clic desde su módulo.
   ══════════════════════════════════════════════════════════════════════ */
const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB'
const fmt = n => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))
const TH = { textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: SLATE, padding: '7px 10px', borderBottom: `1px solid ${NAVY}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fff' }
const TD = { fontSize: 12.5, padding: '7px 10px', borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }
const NUM = { ...TD, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }
const INPUT = { fontSize: 12, padding: '5px 8px', border: `1px solid ${BORDE}`, borderRadius: 6 }

const IND = [
  { n: 1, k: 'n1_conciliacion', v: 'conciliacion_pct', nombre: 'Conciliación bancaria', peso: 20, meta: '≥95% resuelta en <5 días hábiles', fmt: x => x != null ? `${x}%` : '—' },
  { n: 2, k: 'n2_presupuesto', v: 'desvio_presupuesto_pct', nombre: 'Desviación presupuestaria', peso: 20, meta: 'Peor línea material ≤10%', fmt: x => x != null ? `${Math.round(x)}%` : '—' },
  { n: 3, k: 'n3_eerr', v: 'eerr_dias_habiles', nombre: 'Oportunidad del EERR', peso: 15, meta: 'Cierre ≤10 días hábiles', fmt: x => x != null ? `${x} d.h.` : 'sin cerrar' },
  { n: 4, k: 'n4_tributario', v: null, nombre: 'Cumplimiento tributario', peso: 20, meta: 'F29/Previred en plazo, sin multas', fmt: () => '' },
  { n: 5, k: 'n5_descuadres', v: 'descuadres', nombre: 'Descuadres de caja', peso: 10, meta: 'Resueltos en <24 h (o escalados en 48 h)', fmt: x => x != null ? `${x} desc.` : '—' },
  { n: 6, k: 'n6_rendiciones', v: 'rendiciones_pct', nombre: 'Rendiciones caja chica', peso: 5, meta: '100% con respaldo', fmt: x => x != null ? `${x}%` : '—' },
  { n: 7, k: 'n7_pasarelas', v: 'pasarelas_pct', nombre: 'Conciliación de pasarelas', peso: 10, meta: '≥98% validado al día siguiente', fmt: x => x != null ? `${x}%` : 'sin datos' },
]

function Nivel({ v }) {
  if (v == null) return <span style={{ fontSize: 11, color: SLATE }}>N/A</span>
  const c = v >= 100 ? VERDE : v >= 50 ? AMBAR : ROJO
  return <span style={{ fontSize: 12, fontWeight: 700, color: c, fontFamily: 'ui-monospace, monospace' }}>{v}</span>
}

export function FinKpisCargo({ cu }) {
  const [kpi, setKpi] = useState([])
  const [parteB, setParteB] = useState([])
  const [trib, setTrib] = useState([])
  const [esc, setEsc] = useState([])
  const [mes, setMes] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7) })
  const [det, setDet] = useState(null)

  function verIndicador(d) {
    const ini = mes + '-01', fin = mes + '-31'
    const Q = {
      1: { t: 'Movimientos del banco sin explicar en el mes', q: () => supabase.from('movimientos_bancarios').select('fecha, tipo, descripcion, monto').is('subcuenta_id', null).gte('fecha', ini).lte('fecha', fin).order('fecha') },
      2: { t: 'Desvíos presupuestarios del mes por línea', q: () => supabase.from('v_eerr_paralelo').select('codigo, devengo, presupuesto, desvio_presupuesto, explicacion').eq('periodo', mes).neq('presupuesto', 0).order('desvio_presupuesto', { ascending: false }) },
      3: { t: 'Estado de cierre de períodos', q: () => supabase.from('cont_periodos').select('*').order('periodo') },
      4: { t: 'Obligaciones tributarias del período', q: () => supabase.from('trib_calendario').select('periodo, obligacion, vence, presentado_at, rectificatoria, multa_interes').eq('periodo', mes) },
      5: { t: 'Cierres de caja con descuadre o sin corroborar', q: () => supabase.from('cierres_caja').select('fecha, sucursal_id, estado, diferencia, declarado_at, corroborado_at').gte('fecha', ini).lte('fecha', fin).in('estado', ['descuadre', 'declarado']).order('fecha') },
      6: { t: 'Gastos de caja chica sin respaldo', q: () => supabase.from('gm_movimientos').select('fecha, proveedor, descripcion, monto, responsable_nombre').eq('tipo', 'gasto').is('url_respaldo', null).is('archivo_storage', null).gte('fecha', ini).lte('fecha', fin).order('fecha') },
      7: { t: 'Validaciones de pasarelas del mes', q: () => supabase.from('validaciones_medio_pago').select('fecha, sucursal_id, medio_pago, monto_corroborado, monto_externo, diferencia, estado, validado_at').gte('fecha', ini).lte('fecha', fin).order('fecha') },
    }[d.n]
    if (Q) abrirFuente(setDet, { titulo: `${Q.t} · ${mes}`, sub: `KPI ${d.n} — ${d.nombre}`, query: Q.q() })
  }

  async function cargar() {
    const [k, b, t, e] = await Promise.all([
      supabase.from('v_kpi_jefa_finanzas').select('*'),
      supabase.from('v_kpi_parte_b_mensual').select('*'),
      supabase.from('trib_calendario').select('*').order('vence'),
      supabase.from('kpi_escalamientos').select('*').order('created_at', { ascending: false }).limit(50),
    ])
    setKpi(k.data ?? []); setParteB(b.data ?? []); setTrib(t.data ?? []); setEsc(e.data ?? [])
  }
  useEffect(() => { cargar() }, [])

  const fila = kpi.find(r => r.periodo === mes)
  const b = parteB.find(r => r.periodo === mes)

  async function marcarTributo(t, campo) {
    const hoy = new Date().toISOString().slice(0, 10)
    const { error } = await supabase.from('trib_calendario').update({ [campo]: hoy }).eq('id', t.id)
    if (error) { toast.error(error.message); return }
    toast.success(`${t.obligacion} ${t.periodo}: ${campo === 'presentado_at' ? 'presentado' : 'pagado'} ${hoy}`)
    cargar()
  }

  async function registrarEscalamiento() {
    const suc = window.prompt('Sucursal del hallazgo (suc-lg / suc-la / suc-mp / suc-maipu):')
    if (!suc) return
    const hallazgo = window.prompt('Hallazgo (qué se detectó):')
    if (!hallazgo) return
    const accion = window.prompt('Acción solicitada al Jefe de Tienda / Dirección:')
    if (!accion) return
    const { error } = await supabase.from('kpi_escalamientos').insert({
      indicador: 'descuadres_caja', periodo: mes, sucursal_id: suc,
      fecha_deteccion: new Date().toISOString().slice(0, 10), fecha_escalamiento: new Date().toISOString().slice(0, 10),
      destinatarios: 'Dirección General + Jefe de Tienda ' + suc, hallazgo, accion_solicitada: accion, registrado_por: cu?.id ?? 'ui',
    })
    if (error) { toast.error(error.message); return }
    toast.success('Escalamiento registrado — el indicador queda neutralizado para el período si está dentro de plazo')
    cargar()
  }

  const meses = [...new Set(kpi.map(r => r.periodo))].sort().reverse()
  const tribPend = trib.filter(t => !t.presentado_at && t.vence <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: '#F0F4FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: INK, lineHeight: 1.55 }}>
        <b>Indicadores del cargo Jefe de Administración y Finanzas</b> según el Anexo de Incentivo Variable: 7 indicadores medidos sobre los datos
        del sistema, con niveles 0 / 50 / 100 y ponderación 20/20/15/20/10/5/10. La <b>Parte B</b> del bono mensual es el promedio ponderado.
        Un descuadre causado por otra área <b>no castiga</b> si se escala por escrito dentro de 48 horas (Registro de Escalamientos, abajo).
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => { const f = kpi.map(r => ({ Periodo: r.periodo, 'Conciliación %': r.conciliacion_pct, 'Peor desvío %': r.desvio_presupuesto_pct, 'EERR d.h.': r.eerr_dias_habiles, Descuadres: r.descuadres, 'Rendiciones %': r.rendiciones_pct, N1: r.n1_conciliacion, N2: r.n2_presupuesto, N3: r.n3_eerr, N4: r.n4_tributario, N5: r.n5_descuadres, N6: r.n6_rendiciones, N7: r.n7_pasarelas })); exportarExcel(f, 'kpis_jefa_finanzas', 'KPIs') }}
          style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>Excel</button>
        <button onClick={() => { const f = kpi.map(r => ({ Periodo: r.periodo, 'Conc %': r.conciliacion_pct, 'Desvío %': Math.round(r.desvio_presupuesto_pct ?? 0), 'EERR dh': r.eerr_dias_habiles, Desc: r.descuadres, 'Rend %': r.rendiciones_pct, N1: r.n1_conciliacion, N2: r.n2_presupuesto, N3: r.n3_eerr, N4: r.n4_tributario, N5: r.n5_descuadres, N6: r.n6_rendiciones, N7: r.n7_pasarelas })); exportarPDF({ titulo: 'KPIs del cargo — Jefe de Administración y Finanzas', sub: 'Anexo de Incentivo Variable · niveles 0/50/100', filas: f }) }}
          style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>PDF</button>
        <select value={mes} onChange={e => setMes(e.target.value)} style={INPUT}>
          {meses.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        {b && (
          <div style={{ fontSize: 13, fontWeight: 700, color: b.parte_b_pct >= 90 ? VERDE : b.parte_b_pct >= 60 ? AMBAR : ROJO }}>
            Parte B {mes}: {b.parte_b_pct ?? '—'}%
            {b.indicadores_excluidos && <span style={{ fontWeight: 400, color: SLATE, fontSize: 11 }}> · sin dato o neutralizado: {b.indicadores_excluidos} (peso reescalado)</span>}
          </div>
        )}
      </div>

      <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={TH}>#</th><th style={TH}>Indicador</th><th style={TH}>Meta del anexo</th><th style={{ ...TH, textAlign: 'right' }}>Peso</th>
            <th style={{ ...TH, textAlign: 'right' }}>Medido</th><th style={{ ...TH, textAlign: 'right' }}>Nivel</th><th style={TH}>Nota</th></tr></thead>
          <tbody>
            {IND.map(d => {
              const nivel = fila?.[d.k]
              const medido = d.v ? fila?.[d.v] : null
              const neutralizado = (d.n === 5 && fila?.neutralizado_descuadres) || (d.n === 6 && fila?.neutralizado_rendiciones)
              return (
                <tr key={d.n} onClick={() => verIndicador(d)} style={{ cursor: 'pointer' }} title="Clic: ver la fuente del indicador">
                  <td style={{ ...TD, color: SLATE }}>{d.n}</td>
                  <td style={{ ...TD, fontWeight: 600 }}>{d.nombre}</td>
                  <td style={{ ...TD, fontSize: 11.5, color: SLATE, whiteSpace: 'normal' }}>{d.meta}</td>
                  <td style={NUM}>{d.peso}%</td>
                  <td style={NUM}>{d.n === 4 && fila ? (fila.vencidas_sin_presentar > 0 ? `${fila.vencidas_sin_presentar} vencidas` : fila.rectificatorias > 0 ? `${fila.rectificatorias} rectif.` : 'al día') : d.fmt(medido)}</td>
                  <td style={{ ...NUM }}>{neutralizado ? <span style={{ fontSize: 11, color: AMBAR, fontWeight: 700 }}>NEUTRALIZADO</span> : <Nivel v={nivel} />}</td>
                  <td style={{ ...TD, fontSize: 11, color: SLATE, whiteSpace: 'normal' }}>
                    {d.n === 2 && fila?.desvio_peor_linea ? `Peor línea: ${fila.desvio_peor_linea}` : ''}
                    {d.n === 5 && fila ? `${fila.descuadres ?? 0} descuadres · ${fila.cierres_sin_corroborar_24h ?? 0} sin corroborar >24h` : ''}
                    {d.n === 7 && medido == null ? 'Requiere carga de abonos de pasarelas' : ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Calendario tributario */}
      <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: NAVY }}>Calendario tributario (KPI 4)</div>
            <div style={{ fontSize: 11, color: SLATE }}>Marcar cada obligación al presentarla — el indicador se mide contra el vencimiento</div>
          </div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={TH}>Período</th><th style={TH}>Obligación</th><th style={TH}>Vence</th><th style={TH}>Presentado</th><th style={TH}>Acción</th></tr></thead>
          <tbody>
            {tribPend.slice(0, 8).map(t => {
              const vencida = !t.presentado_at && t.vence < new Date().toISOString().slice(0, 10)
              return (
                <tr key={t.id}>
                  <td style={TD}>{t.periodo}</td>
                  <td style={{ ...TD, fontWeight: 600 }}>{t.obligacion}</td>
                  <td style={{ ...TD, color: vencida ? ROJO : INK, fontWeight: vencida ? 700 : 400 }}>{t.vence}{vencida ? ' · VENCIDA' : ''}</td>
                  <td style={{ ...TD, color: SLATE }}>{t.presentado_at ?? '—'}</td>
                  <td style={TD}>
                    <button onClick={() => marcarTributo(t, 'presentado_at')}
                      style={{ fontSize: 11, fontWeight: 600, color: NAVY, background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
                      Marcar presentada
                    </button>
                  </td>
                </tr>
              )
            })}
            {!tribPend.length && <tr><td colSpan={5} style={{ ...TD, textAlign: 'center', color: VERDE, padding: 16 }}>Sin obligaciones pendientes en los próximos 30 días</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Escalamientos */}
      <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: NAVY }}>Registro de escalamientos</div>
            <div style={{ fontSize: 11, color: SLATE }}>Condición de neutralización (sección 5 del anexo): escalar por escrito dentro de 48 h hábiles con evidencia</div>
          </div>
          <button onClick={registrarEscalamiento}
            style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: NAVY, border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer' }}>
            Registrar escalamiento
          </button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={TH}>Fecha</th><th style={TH}>Período</th><th style={TH}>Sucursal</th><th style={TH}>Hallazgo</th><th style={TH}>Acción solicitada</th><th style={TH}>En plazo</th></tr></thead>
          <tbody>
            {esc.map(e => {
              const enPlazo = e.fecha_escalamiento <= e.fecha_deteccion // mismo día siempre en plazo; la vista aplica +3 días
              return (
                <tr key={e.id}>
                  <td style={{ ...TD, color: SLATE }}>{e.fecha_escalamiento}</td>
                  <td style={TD}>{e.periodo}</td>
                  <td style={TD}>{e.sucursal_id}</td>
                  <td style={{ ...TD, whiteSpace: 'normal', maxWidth: 260 }}>{e.hallazgo}</td>
                  <td style={{ ...TD, whiteSpace: 'normal', maxWidth: 260, color: SLATE }}>{e.accion_solicitada}</td>
                  <td style={{ ...TD, fontWeight: 700, color: VERDE, fontSize: 11 }}>Registrado</td>
                </tr>
              )
            })}
            {!esc.length && <tr><td colSpan={6} style={{ ...TD, textAlign: 'center', color: SLATE, padding: 16 }}>Sin escalamientos registrados</td></tr>}
          </tbody>
        </table>
      </div>
      <FuenteDrawer det={det} onClose={() => setDet(null)} />
    </div>
  )
}

export default FinKpisCargo
