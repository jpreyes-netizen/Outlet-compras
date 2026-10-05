import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { exportarExcel } from './exportUtils'

/* ══════════════════════════════════════════════════════════════════════
   RESUMEN SIMPLE — para entender cómo nos va sin ser contador
   1. Seis preguntas con semáforo (v_semaforo_simple)
   2. Resultado del mes en partidas con nombre simple, mes a mes y acumulado
      (v_resultado_simple: cuadra exacto con el resultado oficial)
   3. La caja: cuánto entró, cuánto salió y por qué no es igual a la ganancia
      (v_caja_simple: cuentas de caja y bancos + flujo NIC 7)
   ══════════════════════════════════════════════════════════════════════ */
const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB'
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const SEM = { bien: [VERDE, 'VA BIEN'], atencion: [AMBAR, 'ATENCIÓN'], mal: [ROJO, 'VA MAL'] }
const fmt = n => n == null ? '' : (Number(n) < 0 ? '−' : '') + '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.abs(Math.round(Number(n))))
const TH = { textAlign: 'right', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: SLATE, padding: '7px 8px', borderBottom: `1px solid ${NAVY}`, whiteSpace: 'nowrap', background: '#fff', position: 'sticky', top: 0 }
const TD = { fontSize: 12, padding: '6px 8px', borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }
const NUM = { ...TD, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }

const CAJA = [
  ['saldo_inicial', 'Saldo al inicio del mes', 'Plata en caja y bancos (Santander y Global66) al empezar el mes.', 'saldo_ini'],
  ['entro', 'Entró a la caja', 'Todo lo que ingresó: ventas cobradas, créditos recibidos, aportes. No cuenta traspasos entre cuentas propias.', 'suma'],
  ['salio', 'Salió de la caja', 'Todo lo que se pagó: proveedores, sueldos, arriendos, impuestos, cuotas de créditos.', 'suma_neg'],
  ['saldo_final', 'Saldo al final del mes', 'Plata en caja y bancos al terminar el mes.', 'saldo_fin'],
]
const PUENTE = [
  ['resultado', 'Ganancia (o pérdida) del mes', 'El resultado económico: lo que ganó la empresa según la contabilidad.'],
  ['efecto_inventario', 'Mercadería comprada que aún no se vende', 'Comprar inventario saca plata de la caja, pero no es gasto hasta que se vende. Negativo = compramos más de lo que vendimos.'],
  ['efecto_cobros', 'Ventas aún no cobradas', 'Ventas con tarjeta o a crédito cuya plata todavía no llega. Negativo = quedó más por cobrar.'],
  ['efecto_proveedores', 'Compras aún no pagadas', 'Facturas de proveedores pendientes de pago. Positivo = postergamos pagos, lo que ayuda a la caja ese mes.'],
  ['otros_operacion', 'Otros efectos de la operación', 'Depreciación (gasto que no sale de la caja), impuestos por pagar y movimientos en cuentas transitorias.'],
  ['caja_operacion', 'Caja que generó la operación', 'Cuánta plata dejó el negocio en sí, después de comprar mercadería y cobrar ventas.', 'total'],
  ['caja_inversion', 'Inversiones', 'Compra de equipos, instalaciones o activos de largo plazo.'],
  ['efecto_creditos', 'Créditos bancarios', 'Positivo = recibimos un préstamo. Negativo = pagamos cuotas de capital.'],
  ['efecto_socios', 'Socios', 'Aportes de los socios (positivo) o retiros (negativo).'],
  ['otros_financ', 'Otros financiamientos', 'Otros movimientos de financiamiento.'],
  ['variacion', 'Cuánto cambió la caja en el mes', 'La suma de todo lo anterior: igual al saldo final menos el saldo inicial.', 'total'],
]

export function ResumenSimple() {
  const [sem, setSem] = useState([])
  const [res, setRes] = useState([])
  const [caja, setCaja] = useState([])
  const [enCurso, setEnCurso] = useState(false)
  const [explicar, setExplicar] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('v_semaforo_simple').select('*').order('orden'),
      supabase.from('v_resultado_simple').select('*').order('periodo').order('orden'),
      supabase.from('v_caja_simple').select('*').order('periodo'),
    ]).then(([s, r, c]) => {
      if (r.error) { setError(r.error.message); return }
      setSem(s.data ?? []); setRes(r.data ?? []); setCaja(c.data ?? [])
    })
  }, [])

  const periodos = useMemo(() => [...new Set(res.filter(x => enCurso || !x.mes_en_curso).map(x => x.periodo))], [res, enCurso])
  const cerrado = useMemo(() => Object.fromEntries(res.map(x => [x.periodo, x.cerrado])), [res])
  const partidas = useMemo(() => {
    const m = new Map()
    for (const x of res) {
      if (!m.has(x.orden)) m.set(x.orden, { orden: x.orden, partida: x.partida, ayuda: x.ayuda, tipo: x.tipo, v: {} })
      m.get(x.orden).v[x.periodo] = Number(x.monto)
    }
    return [...m.values()].sort((a, b) => a.orden - b.orden)
  }, [res])
  const cajaP = useMemo(() => Object.fromEntries(caja.map(c => [c.periodo, {
    ...c,
    otros_operacion: Number(c.caja_operacion) - Number(c.resultado) - Number(c.efecto_inventario) - Number(c.efecto_cobros) - Number(c.efecto_proveedores),
    otros_financ: Number(c.caja_financiamiento) - Number(c.efecto_creditos) - Number(c.efecto_socios),
  }])), [caja])
  const suma = (k) => periodos.reduce((s, p) => s + Number(cajaP[p]?.[k] || 0), 0)
  const mesSem = sem[0]?.periodo

  if (error) return <div style={{ background: '#FEF3F2', border: '1px solid #FECDCA', borderRadius: 8, padding: 12, color: ROJO, fontSize: 12.5 }}>{error}</div>

  const celdaPartida = (txt, ayuda, fuerte, gris) => (
    <td style={{ ...TD, position: 'sticky', left: 0, background: fuerte ? '#F7F7F8' : '#fff', zIndex: 1, whiteSpace: 'normal', minWidth: 230, maxWidth: 300 }}>
      <span style={{ fontWeight: fuerte ? 700 : 500, color: fuerte ? NAVY : gris ? SLATE : INK, fontStyle: gris ? 'italic' : 'normal' }}>{txt}</span>
      {ayuda && !explicar && <span title={ayuda} style={{ marginLeft: 5, color: NAVY, cursor: 'help' }}>ⓘ</span>}
      {ayuda && explicar && <div style={{ fontSize: 10, color: SLATE, lineHeight: 1.35, marginTop: 1, fontWeight: 400, fontStyle: 'normal' }}>{ayuda}</div>}
    </td>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 1. semáforo */}
      <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '12px 15px' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>¿Nos está yendo bien?</div>
        <div style={{ fontSize: 11.5, color: SLATE, marginBottom: 10 }}>
          Seis preguntas sobre {mesSem ? `${MESES[Number(mesSem.slice(5)) - 1].toLowerCase()} ${mesSem.slice(0, 4)}` : 'el último mes terminado'}, respondidas con los números de la contabilidad.
          {sem[0] && !sem[0].mes_cerrado && <b style={{ color: AMBAR }}> Ese mes aún no está cerrado: las cifras pueden cambiar.</b>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10 }}>
          {sem.map(s => {
            const [c, et] = SEM[s.estado] ?? [SLATE, '']
            return (
              <div key={s.orden} style={{ border: `1px solid ${BORDE}`, borderLeft: `5px solid ${c}`, borderRadius: 6, padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: NAVY }}>{s.pregunta}</div>
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: c, whiteSpace: 'nowrap' }}>{et}</span>
                </div>
                <div style={{ fontSize: 13, color: INK, marginTop: 4, lineHeight: 1.45 }}>{s.respuesta}</div>
                <div style={{ fontSize: 11, color: SLATE, marginTop: 4, lineHeight: 1.4 }}>{s.detalle}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 2 y 3. resultado y caja */}
      <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 15px', borderBottom: `1px solid ${BORDE}`, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>Resultado y caja, mes a mes</div>
            <div style={{ fontSize: 11.5, color: SLATE }}>Arriba lo que ganó la empresa (resultado económico); abajo lo que pasó con la plata (caja). No son lo mismo, y la última parte explica por qué.</div>
          </div>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
            <input type="checkbox" checked={explicar} onChange={e => setExplicar(e.target.checked)} /> Mostrar explicaciones
          </label>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
            <input type="checkbox" checked={enCurso} onChange={e => setEnCurso(e.target.checked)} /> Incluir mes en curso
          </label>
          <button onClick={() => exportarExcel([
            ...partidas.map(p => ({ Partida: p.partida, ...Object.fromEntries(periodos.map(m => [m, p.v[m] ?? 0])), Acumulado: periodos.reduce((s, m) => s + (p.v[m] ?? 0), 0) })),
            ...[...CAJA, ...PUENTE].map(([k, l]) => ({ Partida: l, ...Object.fromEntries(periodos.map(m => [m, Number(cajaP[m]?.[k] || 0)])) })),
          ], 'resultado_y_caja', 'Resultado y caja')} style={{ fontSize: 12, padding: '5px 10px', border: `1px solid ${BORDE}`, borderRadius: 6, background: '#fff', cursor: 'pointer', fontWeight: 600, color: NAVY }}>Excel</button>
        </div>
        <div style={{ overflow: 'auto', maxHeight: '70vh' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={{ ...TH, textAlign: 'left', left: 0, zIndex: 3 }}>Resultado económico</th>
              {periodos.map(p => <th key={p} style={TH}>{MESES[Number(p.slice(5)) - 1]}{cerrado[p] ? '' : ' ·'}</th>)}
              <th style={{ ...TH, background: '#EEF2FF' }}>Acumulado {periodos[0]?.slice(0, 4)}</th>
            </tr></thead>
            <tbody>
              {partidas.map(p => {
                const tot = p.tipo === 'total', info = p.tipo === 'info'
                const acum = periodos.reduce((s, m) => s + (p.v[m] ?? 0), 0)
                return (
                  <tr key={p.orden} style={{ background: tot ? '#F7F7F8' : undefined }}>
                    {celdaPartida(tot ? '= ' + p.partida : p.partida, p.ayuda, tot, info)}
                    {periodos.map(m => {
                      const v = p.v[m] ?? 0
                      return <td key={m} style={{ ...NUM, fontWeight: tot ? 700 : 400, color: info ? SLATE : tot ? (v < 0 ? ROJO : VERDE) : (v < 0 ? INK : INK) }}>{fmt(v)}</td>
                    })}
                    <td style={{ ...NUM, fontWeight: 700, background: '#EEF2FF', color: info ? SLATE : tot ? (acum < 0 ? ROJO : VERDE) : NAVY }}>{fmt(acum)}</td>
                  </tr>
                )
              })}
              <tr><td colSpan={periodos.length + 2} style={{ ...TD, background: NAVY, color: '#fff', fontWeight: 700, fontSize: 11, letterSpacing: 0.4, position: 'sticky', left: 0 }}>LA CAJA (PLATA EN CAJA Y BANCOS)</td></tr>
              {CAJA.map(([k, l, a, modo]) => {
                const fuerte = modo === 'saldo_fin'
                const acum = modo === 'saldo_ini' ? cajaP[periodos[0]]?.saldo_inicial : modo === 'saldo_fin' ? cajaP[periodos[periodos.length - 1]]?.saldo_final : suma(k)
                return (
                  <tr key={k} style={{ background: fuerte ? '#F7F7F8' : undefined }}>
                    {celdaPartida(l, a, fuerte)}
                    {periodos.map(m => <td key={m} style={{ ...NUM, fontWeight: fuerte ? 700 : 400, color: k === 'salio' ? ROJO : fuerte ? NAVY : INK }}>{fmt(k === 'salio' ? -Number(cajaP[m]?.[k] || 0) : cajaP[m]?.[k])}</td>)}
                    <td style={{ ...NUM, fontWeight: 700, background: '#EEF2FF', color: NAVY }}>{fmt(k === 'salio' ? -acum : acum)}</td>
                  </tr>
                )
              })}
              <tr><td colSpan={periodos.length + 2} style={{ ...TD, background: '#F0F4FF', color: NAVY, fontWeight: 700, fontSize: 11.5, position: 'sticky', left: 0 }}>¿Por qué la caja no cambia igual que la ganancia?</td></tr>
              {PUENTE.map(([k, l, a, modo]) => {
                const tot = modo === 'total', acum = suma(k)
                return (
                  <tr key={k} style={{ background: tot ? '#F7F7F8' : undefined }}>
                    {celdaPartida(tot ? '= ' + l : l, a, tot)}
                    {periodos.map(m => { const v = Number(cajaP[m]?.[k] || 0); return <td key={m} style={{ ...NUM, fontWeight: tot ? 700 : 400, color: tot ? (v < 0 ? ROJO : VERDE) : INK }}>{fmt(v)}</td> })}
                    <td style={{ ...NUM, fontWeight: 700, background: '#EEF2FF', color: tot ? (acum < 0 ? ROJO : VERDE) : NAVY }}>{fmt(acum)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 14px', borderTop: `1px solid ${BORDE}`, fontSize: 11, color: SLATE, lineHeight: 1.5 }}>
          Un punto (·) junto al mes indica que todavía no está cerrado y sus cifras pueden cambiar. El resultado cuadra exactamente con el estado de resultados oficial;
          la caja usa las cuentas de caja y bancos, sin contar traspasos entre cuentas propias.
        </div>
      </div>
    </div>
  )
}

export default ResumenSimple
