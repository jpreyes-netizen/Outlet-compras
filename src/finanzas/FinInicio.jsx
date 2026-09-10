import { useState, useEffect } from 'react'
import { supabase } from '../supabase'

/* ══════════════════════════════════════════════════════════════════════
   INICIO — Finanzas
   Responde tres preguntas al entrar: ¿qué tengo pendiente hoy?, ¿qué hago
   cuando pasa X?, ¿qué es cada dominio? Cada recorrido lleva a la pestaña
   exacta (no al dominio) y dice qué hace y cuándo se usa.
   ══════════════════════════════════════════════════════════════════════ */
const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73'
const ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB', FONDO = '#F9FAFB'
const fmt = n => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))

/* Navegación profunda: el destino fija la pestaña interna antes de cambiar de dominio */
export function irA(setTab, destino) {
  try {
    if (destino.cont) localStorage.setItem('fin_cont_goto', destino.cont)
    if (destino.conc) localStorage.setItem('fin_conc_goto', destino.conc)
  } catch (e) { }
  setTab(destino.tab)
}

const RECORRIDOS = [
  { titulo: 'Llegaron facturas de proveedores', cuando: 'Cada día, cuando el SII/BSALE trae facturas nuevas',
    pasos: ['Imputar: cada factura a su cuenta contable y centro de costo (la regla del proveedor lo hace solo la próxima vez)',
            'Vincular OC: si la compra tenía orden, asociarla para el 3-way match'],
    destino: { tab: 'conciliacion', conc: 'imputar' }, boton: 'Ir a Imputar', kpi: 'facturas_pendientes', kpiLabel: 'sin cuenta' },
  { titulo: 'Llegó la cartola del banco', cuando: 'Cada vez que se descarga el extracto Santander',
    pasos: ['Cartolas: importar el archivo', 'Bandeja de sugerencias: aceptar los vínculos pago↔factura que el sistema propone',
            'Clasificar: lo que quedó sin explicar, a su subcuenta'],
    destino: { tab: 'conciliacion', conc: 'bandeja' }, boton: 'Ir a la Bandeja', kpi: 'bandeja', kpiLabel: 'sugerencias' },
  { titulo: 'Cerrar el día en tienda', cuando: 'Al terminar la jornada, por sucursal',
    pasos: ['Cierres de caja: declarar efectivo y tarjetas, el sistema corrobora contra BSALE'],
    destino: { tab: 'tesoreria' }, boton: 'Ir a Cierres de caja' },
  { titulo: 'Cerrar el mes', cuando: 'Los primeros días de cada mes',
    pasos: ['Control y cierre: el checklist dice qué falta (facturas sin cuenta, cargos sin explicar, cartola)',
            'Tributario: F29 borrador y libros RCV', 'Cerrar período: bloquea el mes y deja el export al contador'],
    destino: { tab: 'contabilidad', cont: 'control' }, boton: 'Ir a Control y cierre', kpi: 'periodos_abiertos', kpiLabel: 'meses sin cerrar' },
  { titulo: '¿Cómo va la empresa?', cuando: 'Cuando necesitás el número, no el detalle',
    pasos: ['EERR y EBITDA: devengo (lo que se ganó), caja (lo que se pagó) y presupuesto, con detalle a un clic',
            'Indicadores: liquidez, deuda/EBITDA, días de inventario', 'Por sucursal: contribución de cada tienda'],
    destino: { tab: 'contabilidad', cont: 'eerrdev' }, boton: 'Ir al EERR' },
  { titulo: 'Buscar un registro', cuando: 'Un pago, una factura, un asiento',
    pasos: ['Libro mayor: por cuenta y período', 'Libro banco: mes a mes contra la cartola', 'Diario: todos los asientos, con comprobante imprimible'],
    destino: { tab: 'contabilidad', cont: 'mayor' }, boton: 'Ir al Mayor' },
]

const DOMINIOS = [
  { n: 'Contabilidad', q: 'Los libros formales y los estados financieros. Todo lo que aquí aparece salió de un documento: factura, venta, pago, liquidación.' },
  { n: 'Conciliación', q: 'El trabajo diario: imputar facturas, aceptar sugerencias de pago, clasificar movimientos del banco. Lo que se hace aquí alimenta la Contabilidad.' },
  { n: 'Tesorería', q: 'La caja de hoy y de mañana: cierres de tienda, proyección de flujo, caja chica.' },
  { n: 'Gestión', q: 'La lectura de negocio: EERR en base caja (espejo del contable) y presupuesto.' },
]

export function FinInicio({ cu, setTab }) {
  const [k, setK] = useState(null)
  useEffect(() => {
    (async () => {
      const [pc, bd, per, mov, al] = await Promise.all([
        supabase.from('v_por_clasificar').select('monto').eq('origen', 'compra').limit(5000),
        supabase.from('v_bandeja_conciliacion').select('id').limit(2000),
        supabase.from('cont_periodos').select('periodo, estado').limit(50),
        supabase.from('movimientos_bancarios').select('id', { count: 'exact', head: true }).is('subcuenta_id', null).eq('tipo', 'CARGO').gte('fecha', '2026-01-01'),
        supabase.from('notificaciones').select('asunto, created_at').ilike('asunto', '%:%').order('created_at', { ascending: false }).limit(3),
      ])
      const cerrados = new Set((per.data ?? []).filter(p => p.estado === 'cerrado').map(p => p.periodo))
      const hoy = new Date(); const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
      let abiertos = 0
      for (let m = 1; m <= 12; m++) { const p = `${hoy.getFullYear()}-${String(m).padStart(2, '0')}`; if (p < mesActual && !cerrados.has(p)) abiertos++ }
      setK({
        facturas_pendientes: pc.data?.length ?? 0, facturas_monto: (pc.data ?? []).reduce((s, r) => s + Number(r.monto || 0), 0),
        bandeja: bd.data?.length ?? 0, periodos_abiertos: abiertos, cargos_sin_explicar: mov.count ?? 0,
        alertas: al.data ?? [],
      })
    })()
  }, [])

  const nombre = cu?.nombre?.split(' ')[0] || ''
  const pend = k ? [
    { l: 'Facturas sin cuenta', v: k.facturas_pendientes, d: fmt(k.facturas_monto), c: k.facturas_pendientes ? AMBAR : VERDE, go: { tab: 'conciliacion', conc: 'imputar' } },
    { l: 'Sugerencias de conciliación', v: k.bandeja, d: 'por aprobar', c: k.bandeja ? AMBAR : VERDE, go: { tab: 'conciliacion', conc: 'bandeja' } },
    { l: 'Cargos del banco sin explicar', v: k.cargos_sin_explicar, d: 'sin subcuenta', c: k.cargos_sin_explicar > 50 ? ROJO : k.cargos_sin_explicar ? AMBAR : VERDE, go: { tab: 'conciliacion', conc: 'clasificar' } },
    { l: 'Meses sin cerrar', v: k.periodos_abiertos, d: 'del año en curso', c: k.periodos_abiertos > 2 ? ROJO : k.periodos_abiertos ? AMBAR : VERDE, go: { tab: 'contabilidad', cont: 'control' } },
  ] : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1180 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: NAVY }}>{nombre ? `Hola, ${nombre}.` : 'Finanzas'} ¿Qué necesitás hacer?</div>
        <div style={{ fontSize: 12.5, color: SLATE, marginTop: 4 }}>
          Este módulo funciona en un ciclo: <b>los documentos entran por Conciliación</b>, <b>la Contabilidad los registra sola</b>, y <b>Gestión los lee</b>. Abajo, lo pendiente hoy y los recorridos habituales.
        </div>
      </div>

      {/* Pendiente hoy */}
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>Pendiente hoy</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
          {(pend.length ? pend : [1, 2, 3, 4].map(i => ({ l: '…', v: '', d: '', c: SLATE }))).map((p, i) => (
            <button key={i} onClick={() => p.go && irA(setTab, p.go)} style={{ textAlign: 'left', background: '#fff', border: `1px solid ${BORDE}`, borderLeft: `4px solid ${p.c}`, borderRadius: 8, padding: '12px 14px', cursor: p.go ? 'pointer' : 'default' }}>
              <div style={{ fontSize: 11, color: SLATE, fontWeight: 600 }}>{p.l}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: p.c, fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>{p.v}</div>
              <div style={{ fontSize: 10.5, color: SLATE }}>{p.d}</div>
            </button>
          ))}
        </div>
        {k?.alertas?.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 11, color: SLATE }}>
            Última alerta enviada a tu correo: <b style={{ color: INK }}>{k.alertas[0].asunto}</b> · {String(k.alertas[0].created_at).slice(0, 10)}
          </div>
        )}
      </div>

      {/* Recorridos */}
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>Recorridos habituales</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
          {RECORRIDOS.map(r => (
            <div key={r.titulo} style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{r.titulo}</div>
                  <div style={{ fontSize: 11, color: SLATE, marginTop: 2 }}>{r.cuando}</div>
                </div>
                {r.kpi && k && k[r.kpi] > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: AMBAR, background: '#FEF3C7', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>{k[r.kpi]} {r.kpiLabel}</span>
                )}
              </div>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: INK, lineHeight: 1.55 }}>
                {r.pasos.map((p, i) => <li key={i}>{p}</li>)}
              </ol>
              <div><button onClick={() => irA(setTab, r.destino)} style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: NAVY, border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer' }}>{r.boton}</button></div>
            </div>
          ))}
        </div>
      </div>

      {/* Qué es cada dominio */}
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>Qué hay en cada sección</div>
        <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8 }}>
          {DOMINIOS.map((d, i) => (
            <div key={d.n} style={{ display: 'flex', gap: 14, padding: '10px 14px', borderBottom: i < DOMINIOS.length - 1 ? `1px solid ${BORDE}` : 'none' }}>
              <div style={{ width: 120, fontSize: 12.5, fontWeight: 700, color: NAVY, flexShrink: 0 }}>{d.n}</div>
              <div style={{ fontSize: 12, color: INK, lineHeight: 1.5 }}>{d.q}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: SLATE, marginTop: 8 }}>
          Los términos contables están explicados en Contabilidad → Glosario. Cada número del EERR abre su fuente de datos con un clic.
        </div>
      </div>
    </div>
  )
}

export default FinInicio
