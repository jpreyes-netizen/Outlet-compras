import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { DataGrid } from './conciliacion/DataGrid'

/* ═══════════════════════════════════════════════════════════════════════
   LIBROS CONTABLES — Banco · Compras · Ventas · Conciliación
   Grillas estilo Excel (DataGrid): ordenar, filtrar por columna,
   redimensionar, exportar xlsx, pantalla completa. Ancho completo.
   Fuentes: v_libro_banco, movimientos_bancarios, v_libro_compras_sii,
   v_libro_ventas_sii. Cada vista declara su fuente al pie.
   ═══════════════════════════════════════════════════════════════════════ */

const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB'
const fmt = n => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))
const fF = f => f ? String(f).slice(0, 10) : ''
const MES_ACTUAL = new Date().toISOString().slice(0, 7)
const MESES = (() => { const out = []; let m = '2026-01'; while (m <= MES_ACTUAL) { out.push(m); const [a, mm] = m.split('-').map(Number); m = mm === 12 ? `${a + 1}-01` : `${a}-${String(mm + 1).padStart(2, '0')}` } return out })()

function SelMes({ mes, setMes, conAnio = false }) {
  return (
    <select value={mes} onChange={e => setMes(e.target.value)}
      style={{ fontSize: 12, padding: '5px 8px', border: `1px solid ${BORDE}`, borderRadius: 6, background: '#fff', fontWeight: 600, color: NAVY }}>
      {conAnio && <option value="2026">Año 2026 completo</option>}
      {[...MESES].reverse().map(m => <option key={m} value={m}>{m}</option>)}
    </select>
  )
}

function Kpi({ l, v, color = INK, sub }) {
  return (
    <div style={{ padding: '6px 14px', borderRight: `1px solid ${BORDE}`, minWidth: 110 }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.5 }}>{l}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
      {sub ? <div style={{ fontSize: 10, color: SLATE }}>{sub}</div> : null}
    </div>
  )
}

function Fuente({ children }) {
  return <div style={{ fontSize: 10.5, color: SLATE, marginTop: 6 }}>Fuente: {children}</div>
}

const NUMCOL = { align: 'right' }
const numRender = (v, color) => <span style={{ fontVariantNumeric: 'tabular-nums', color: color ?? INK }}>{fmt(v)}</span>

/* ──────────────────────── 1 · LIBRO BANCO (detalle) ─────────────────── */
export function LibroBancoDetalle() {
  const [mes, setMes] = useState(MESES[MESES.length - 1])
  const [filas, setFilas] = useState([])
  const [resumen, setResumen] = useState(null)
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    setCargando(true)
    Promise.all([
      supabase.from('movimientos_bancarios')
        .select('id, fecha, tipo, descripcion, referencia, n_documento, monto, saldo, estado, origen, subcuenta:subcuentas(codigo, nombre)')
        .gte('fecha', mes + '-01').lte('fecha', mes + '-31').order('fecha').order('id'),
      supabase.from('v_libro_banco').select('*').eq('periodo', mes).maybeSingle(),
    ]).then(([m, r]) => {
      setFilas(m.data ?? []); setResumen(r.data ?? null); setCargando(false)
    })
  }, [mes])

  const cols = useMemo(() => [
    { key: 'fecha', label: 'Fecha', width: 88, value: r => fF(r.fecha) },
    { key: 'tipo', label: 'Tipo', width: 70, render: r => <span style={{ fontSize: 10.5, fontWeight: 700, color: r.tipo === 'ABONO' ? VERDE : ROJO }}>{r.tipo}</span> },
    { key: 'descripcion', label: 'Descripción', width: 330 },
    { key: 'referencia', label: 'Referencia', width: 110 },
    { key: 'n_documento', label: 'N° doc', width: 90 },
    { key: 'abono', label: 'Abono', ...NUMCOL, width: 110, value: r => r.monto > 0 ? Number(r.monto) : null, render: r => r.monto > 0 ? numRender(r.monto, VERDE) : '' },
    { key: 'cargo', label: 'Cargo', ...NUMCOL, width: 110, value: r => r.monto < 0 ? -Number(r.monto) : null, render: r => r.monto < 0 ? numRender(-r.monto, ROJO) : '' },
    { key: 'saldo', label: 'Saldo', ...NUMCOL, width: 120, value: r => r.saldo == null ? null : Number(r.saldo), render: r => r.saldo == null ? '' : numRender(r.saldo) },
    { key: 'clasificacion', label: 'Clasificación', width: 220, value: r => r.subcuenta ? `${r.subcuenta.codigo ?? ''} ${r.subcuenta.nombre ?? ''}`.trim() : '', render: r => r.subcuenta ? <span>{r.subcuenta.nombre}</span> : <span style={{ color: AMBAR, fontWeight: 700 }}>Sin clasificar</span> },
    { key: 'origen', label: 'Origen', width: 100, value: r => r.origen ?? 'cartola' },
  ], [])

  const d = resumen
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'auto' }}>
        <div style={{ padding: '6px 14px', borderRight: `1px solid ${BORDE}` }}><SelMes mes={mes} setMes={setMes} /></div>
        <Kpi l="Saldo inicial" v={d ? fmt(d.saldo_inicial_contable) : '—'} />
        <Kpi l="Abonos" v={d ? fmt(d.abonos) : '—'} color={VERDE} />
        <Kpi l="Cargos" v={d ? fmt(d.cargos) : '—'} color={ROJO} />
        <Kpi l="Saldo final libro" v={d ? fmt(d.saldo_final_contable) : '—'} />
        <Kpi l="Saldo cartola" v={d?.saldo_final_cartola != null ? fmt(d.saldo_final_cartola) : '—'} sub={d?.fecha_saldo_cartola ? `al ${fF(d.fecha_saldo_cartola)}` : null} />
        <Kpi l="Diferencia" v={d?.diferencia_cartola != null ? fmt(d.diferencia_cartola) : '—'}
          color={d?.diferencia_cartola == null ? SLATE : Math.abs(d.diferencia_cartola) < 1000 ? VERDE : ROJO} />
        <Kpi l="Sin clasificar" v={d ? `${d.sin_explicar} · ${fmt(d.monto_sin_explicar)}` : '—'} color={d?.sin_explicar ? AMBAR : SLATE} />
        <Kpi l="Estado" v={d?.estado_conciliacion ?? '—'}
          color={d?.estado_conciliacion === 'Conciliado' ? VERDE : ROJO} />
      </div>
      <DataGrid title={`Libro banco · Santander cuenta corriente · ${mes}`} exportName={`libro_banco_${mes}`}
        columns={cols} rows={filas} getRowId={r => r.id} loading={cargando}
        rowStyle={r => !r.subcuenta ? { background: '#FFFBEB' } : null}
        emptyText={`Sin movimientos bancarios en ${mes}`} />
      <Fuente><code>movimientos_bancarios</code> (cartola importada + sincronizaciones) y resumen mensual de <code>v_libro_banco</code>. Filas ámbar: movimiento sin subcuenta asignada — se clasifican en Conciliación.</Fuente>
    </div>
  )
}

/* ──────────────────────── 2 · LIBRO COMPRAS ─────────────────────────── */
export function LibroCompras() {
  const [mes, setMes] = useState(MESES[MESES.length - 1])
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    setCargando(true)
    let q = supabase.from('v_libro_compras_sii').select('*')
    if (mes !== '2026') q = q.eq('periodo', mes)
    q.order('fecha_emision').order('folio').limit(6000).then(({ data }) => { setFilas(data ?? []); setCargando(false) })
  }, [mes])

  const tot = useMemo(() => filas.reduce((a, f) => ({
    docs: a.docs + 1, nc: a.nc + (f.signo < 0 ? 1 : 0),
    exento: a.exento + Number(f.exento || 0) * f.signo, neto: a.neto + Number(f.neto || 0) * f.signo,
    iva: a.iva + Number(f.iva || 0) * f.signo, total: a.total + Number(f.total || 0) * f.signo,
  }), { docs: 0, nc: 0, exento: 0, neto: 0, iva: 0, total: 0 }), [filas])

  const cols = useMemo(() => [
    { key: 'fecha_emision', label: 'Emisión', width: 88, value: r => fF(r.fecha_emision) },
    { key: 'tipo_doc_nombre', label: 'Documento', width: 150 },
    { key: 'folio', label: 'Folio', width: 90, ...NUMCOL },
    { key: 'rut_proveedor', label: 'RUT', width: 105 },
    { key: 'razon_social', label: 'Proveedor', width: 300 },
    { key: 'exento', label: 'Exento', ...NUMCOL, width: 100, value: r => Number(r.exento || 0) * r.signo, render: r => r.exento ? numRender(Number(r.exento) * r.signo, r.signo < 0 ? ROJO : INK) : '' },
    { key: 'neto', label: 'Neto', ...NUMCOL, width: 110, value: r => Number(r.neto || 0) * r.signo, render: r => numRender(Number(r.neto) * r.signo, r.signo < 0 ? ROJO : INK) },
    { key: 'iva', label: 'IVA', ...NUMCOL, width: 100, value: r => Number(r.iva || 0) * r.signo, render: r => numRender(Number(r.iva) * r.signo, r.signo < 0 ? ROJO : INK) },
    { key: 'total', label: 'Total', ...NUMCOL, width: 120, value: r => Number(r.total || 0) * r.signo, render: r => <b style={{ fontVariantNumeric: 'tabular-nums', color: r.signo < 0 ? ROJO : INK }}>{fmt(Number(r.total) * r.signo)}</b> },
  ], [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'auto' }}>
        <div style={{ padding: '6px 14px', borderRight: `1px solid ${BORDE}` }}><SelMes mes={mes} setMes={setMes} conAnio /></div>
        <Kpi l="Documentos" v={tot.docs} sub={tot.nc ? `${tot.nc} notas de crédito` : null} />
        <Kpi l="Exento" v={fmt(tot.exento)} />
        <Kpi l="Neto" v={fmt(tot.neto)} />
        <Kpi l="IVA crédito" v={fmt(tot.iva)} color={NAVY} />
        <Kpi l="Total" v={fmt(tot.total)} color={NAVY} />
      </div>
      <DataGrid title={`Libro de compras (RCV) · ${mes === '2026' ? 'año 2026' : mes}`} exportName={`libro_compras_${mes}`}
        columns={cols} rows={filas} getRowId={r => `${r.tipo_doc}-${r.folio}-${r.rut_proveedor}`} loading={cargando}
        rowStyle={r => r.signo < 0 ? { background: '#FEF2F2' } : null}
        emptyText="Sin documentos de compra en el período" />
      <Fuente><code>v_libro_compras_sii</code> sobre <code>libro_compras</code> (facturas recibidas, sincronizadas del SII). Notas de crédito restan y se muestran en rojo. Totales con signo aplicado, cuadran con el F29.</Fuente>
    </div>
  )
}

/* ──────────────────────── 3 · LIBRO VENTAS ──────────────────────────── */
const SUCS = [['todas', 'Todas las sucursales'], ['suc-lg', 'La Granja'], ['suc-la', 'Los Ángeles'], ['suc-maipu', 'Tienda Maipú'], ['suc-mp', 'CD Maipú'], ['suc-web', 'Canal Web']]

export function LibroVentas() {
  const [mes, setMes] = useState(MESES[MESES.length - 1])
  const [suc, setSuc] = useState('todas')
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    setCargando(true)
    let q = supabase.from('v_libro_ventas_sii').select('*').eq('periodo', mes)
    if (suc !== 'todas') q = q.eq('sucursal_id', suc)
    q.order('fecha_emision').order('folio').limit(9000).then(({ data }) => { setFilas(data ?? []); setCargando(false) })
  }, [mes, suc])

  const tot = useMemo(() => filas.reduce((a, f) => ({
    docs: a.docs + 1, nc: a.nc + (f.signo < 0 ? 1 : 0),
    neto: a.neto + Number(f.neto || 0) * f.signo, iva: a.iva + Number(f.iva || 0) * f.signo,
    total: a.total + Number(f.total || 0) * f.signo,
  }), { docs: 0, nc: 0, neto: 0, iva: 0, total: 0 }), [filas])

  const SUCN = Object.fromEntries(SUCS)
  const cols = useMemo(() => [
    { key: 'fecha_emision', label: 'Emisión', width: 88, value: r => fF(r.fecha_emision) },
    { key: 'tipo_doc_nombre', label: 'Documento', width: 140 },
    { key: 'folio', label: 'Folio', width: 90, ...NUMCOL },
    { key: 'sucursal_id', label: 'Sucursal', width: 110, value: r => SUCN[r.sucursal_id] ?? r.sucursal_id ?? '—' },
    { key: 'rut_cliente', label: 'RUT cliente', width: 105, value: r => r.rut_cliente ?? '' },
    { key: 'razon_social', label: 'Cliente', width: 240, value: r => r.razon_social ?? '' },
    { key: 'neto', label: 'Neto', ...NUMCOL, width: 110, value: r => Number(r.neto || 0) * r.signo, render: r => numRender(Number(r.neto) * r.signo, r.signo < 0 ? ROJO : INK) },
    { key: 'iva', label: 'IVA', ...NUMCOL, width: 100, value: r => Number(r.iva || 0) * r.signo, render: r => numRender(Number(r.iva) * r.signo, r.signo < 0 ? ROJO : INK) },
    { key: 'total', label: 'Total', ...NUMCOL, width: 120, value: r => Number(r.total || 0) * r.signo, render: r => <b style={{ fontVariantNumeric: 'tabular-nums', color: r.signo < 0 ? ROJO : INK }}>{fmt(Number(r.total) * r.signo)}</b> },
  ], [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'auto' }}>
        <div style={{ padding: '6px 14px', borderRight: `1px solid ${BORDE}`, display: 'flex', gap: 8 }}>
          <SelMes mes={mes} setMes={setMes} />
          <select value={suc} onChange={e => setSuc(e.target.value)}
            style={{ fontSize: 12, padding: '5px 8px', border: `1px solid ${BORDE}`, borderRadius: 6, background: '#fff', color: NAVY }}>
            {SUCS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <Kpi l="Documentos" v={tot.docs} sub={tot.nc ? `${tot.nc} notas de crédito` : null} />
        <Kpi l="Neto" v={fmt(tot.neto)} />
        <Kpi l="IVA débito" v={fmt(tot.iva)} color={NAVY} />
        <Kpi l="Total" v={fmt(tot.total)} color={NAVY} />
      </div>
      <DataGrid title={`Libro de ventas (RCV) · ${mes}${suc !== 'todas' ? ' · ' + SUCN[suc] : ''}`} exportName={`libro_ventas_${mes}${suc !== 'todas' ? '_' + suc : ''}`}
        columns={cols} rows={filas} getRowId={r => `${r.tipo_bsale}-${r.folio}-${r.sucursal_id}`} loading={cargando}
        rowStyle={r => r.signo < 0 ? { background: '#FEF2F2' } : null}
        emptyText="Sin documentos de venta en el período" />
      <Fuente><code>v_libro_ventas_sii</code> sobre los documentos de BSALE (boletas, facturas y NC). Totales con signo aplicado. La venta neta del mes debe cuadrar con Control vs BSALE.</Fuente>
    </div>
  )
}

/* ──────────────────── 4 · CONCILIACIÓN BANCARIA ─────────────────────── */
export function ConciliacionBanco() {
  const [filas, setFilas] = useState([])
  const [mesSel, setMesSel] = useState(null)
  const [pend, setPend] = useState([])
  const [cargando, setCargando] = useState(false)

  useEffect(() => { supabase.from('v_libro_banco').select('*').order('periodo').then(({ data }) => setFilas(data ?? [])) }, [])
  useEffect(() => {
    if (!mesSel) { setPend([]); return }
    setCargando(true)
    supabase.from('movimientos_bancarios')
      .select('id, fecha, tipo, descripcion, referencia, monto, origen')
      .is('subcuenta_id', null).gte('fecha', mesSel + '-01').lte('fecha', mesSel + '-31')
      .order('fecha').then(({ data }) => { setPend(data ?? []); setCargando(false) })
  }, [mesSel])

  const colsMes = useMemo(() => [
    { key: 'periodo', label: 'Período', width: 90, render: r => <b>{r.periodo}</b> },
    { key: 'saldo_inicial_contable', label: 'Saldo inicial', ...NUMCOL, width: 125, value: r => Number(r.saldo_inicial_contable), render: r => numRender(r.saldo_inicial_contable) },
    { key: 'abonos', label: 'Abonos', ...NUMCOL, width: 120, value: r => Number(r.abonos), render: r => numRender(r.abonos, VERDE) },
    { key: 'cargos', label: 'Cargos', ...NUMCOL, width: 120, value: r => Number(r.cargos), render: r => numRender(r.cargos, ROJO) },
    { key: 'saldo_final_contable', label: 'Saldo final libro', ...NUMCOL, width: 130, value: r => Number(r.saldo_final_contable), render: r => <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(r.saldo_final_contable)}</b> },
    { key: 'saldo_final_cartola', label: 'Saldo cartola', ...NUMCOL, width: 125, value: r => r.saldo_final_cartola == null ? null : Number(r.saldo_final_cartola), render: r => r.saldo_final_cartola == null ? '—' : numRender(r.saldo_final_cartola) },
    { key: 'diferencia_cartola', label: 'Diferencia', ...NUMCOL, width: 110, value: r => r.diferencia_cartola == null ? null : Number(r.diferencia_cartola), render: r => r.diferencia_cartola == null ? '—' : <b style={{ fontVariantNumeric: 'tabular-nums', color: Math.abs(r.diferencia_cartola) < 1000 ? VERDE : ROJO }}>{fmt(r.diferencia_cartola)}</b> },
    { key: 'sin_explicar', label: 'Sin clasificar', ...NUMCOL, width: 130, value: r => Number(r.sin_explicar), render: r => <span style={{ color: r.sin_explicar ? AMBAR : SLATE, fontVariantNumeric: 'tabular-nums' }}>{r.sin_explicar} · {fmt(r.monto_sin_explicar)}</span> },
    { key: 'estado_conciliacion', label: 'Estado', width: 150, render: r => <b style={{ fontSize: 11, color: r.estado_conciliacion === 'Conciliado' ? VERDE : String(r.estado_conciliacion).startsWith('Sin') ? SLATE : ROJO }}>{r.estado_conciliacion}</b> },
  ], [])

  const colsPend = useMemo(() => [
    { key: 'fecha', label: 'Fecha', width: 88, value: r => fF(r.fecha) },
    { key: 'tipo', label: 'Tipo', width: 70, render: r => <span style={{ fontSize: 10.5, fontWeight: 700, color: r.tipo === 'ABONO' ? VERDE : ROJO }}>{r.tipo}</span> },
    { key: 'descripcion', label: 'Descripción', width: 380 },
    { key: 'referencia', label: 'Referencia', width: 120 },
    { key: 'monto', label: 'Monto', ...NUMCOL, width: 120, value: r => Number(r.monto), render: r => numRender(r.monto, r.monto < 0 ? ROJO : VERDE) },
    { key: 'origen', label: 'Origen', width: 110, value: r => r.origen ?? 'cartola' },
  ], [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <DataGrid title="Conciliación bancaria · libro vs cartola, mes a mes" exportName="conciliacion_bancaria"
        columns={colsMes} rows={filas} getRowId={r => r.periodo}
        selectedId={mesSel} onRowClick={r => setMesSel(r.periodo === mesSel ? null : r.periodo)}
        rowStyle={r => r.periodo === mesSel ? { background: '#EEF2FF' } : Math.abs(r.diferencia_cartola ?? 0) >= 1000 ? { background: '#FEF2F2' } : null}
        emptyText="Sin períodos" />
      {mesSel && (
        <DataGrid title={`Movimientos sin clasificar · ${mesSel}`} exportName={`sin_clasificar_${mesSel}`}
          columns={colsPend} rows={pend} getRowId={r => r.id} loading={cargando}
          emptyText={`Todo ${mesSel} está clasificado`} />
      )}
      <Fuente><code>v_libro_banco</code> compara el saldo del libro contra el saldo que declara la cartola Santander. Clic en un mes abre sus movimientos sin subcuenta. La clasificación y el matching contra facturas se trabajan en el módulo <b>Conciliación</b> del menú principal.</Fuente>
    </div>
  )
}
