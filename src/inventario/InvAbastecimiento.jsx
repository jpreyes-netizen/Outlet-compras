/* ════════════════════════════════════════════════════════════════════
   InvAbastecimiento.jsx
   vista = comprar  qué entra al próximo contenedor, por retorno del capital
           reponer  qué falta en cada sala y en qué orden resolverlo:
                    1) despachar desde el CD  2) mover entre salas  3) comprar
   ════════════════════════════════════════════════════════════════════ */

import { useState, useMemo } from 'react'
import { DataGrid } from '../finanzas/conciliacion/DataGrid'
import { Panel, KpiStrip, KpiCelda, Boton, Ex, Leyenda, Tag, Enlace, fmt, fN, fD, fCLP,
         INK, SLATE, BORDE, NAVY, ROJO, VERDE, AMBAR } from './invUI'
import { CL_ABC, CL_PATRON, CL_ESTADO, AYUDA_ESTADO, SALAS } from './invData'
import { tablaExcel, tablaPdf } from './invReportes'

const PRESUPUESTOS = [50, 100, 200, 400]

/* ════════════ QUÉ COMPRAR ════════════ */
function Comprar({ prioridad, onProducto }) {
  const [tope, setTope] = useState(null)
  const [ocultarDudoso, setOcultarDudoso] = useState(true)
  const filas = useMemo(() => prioridad
    .filter(x => !ocultarDudoso || !x.alerta_costo)
    .filter(x => !tope || +x.capital_acumulado <= tope * 1e6), [prioridad, tope, ocultarDudoso])
  const s = k => filas.reduce((a, f) => a + (+f[k] || 0), 0)
  const dudosos = prioridad.filter(f => f.alerta_costo).length
  const cols = [
    { key: 'prioridad', label: '#', width: 50, align: 'right' },
    { key: 'sku', label: 'SKU', width: 120 },
    { key: 'producto', label: 'Producto', width: 240 },
    { key: 'clase', label: 'Clase', width: 62, value: r => (r.abc || 'D') + (r.xyz || 'Z'), render: r => <Tag texto={(r.abc || 'D') + (r.xyz || 'Z')} color={CL_ABC[r.abc]} /> },
    { key: 'patron', label: 'Patrón', width: 105, render: r => <Tag texto={(r.patron || '').toLowerCase()} color={CL_PATRON[r.patron]} /> },
    { key: 'disponible_tiendas', label: 'En salas', width: 80, align: 'right', render: r => fN(r.disponible_tiendas) },
    { key: 'disponible_cd', label: 'En CD', width: 75, align: 'right', render: r => fN(r.disponible_cd) },
    { key: 'transito', label: 'Tránsito', width: 75, align: 'right', render: r => fN(r.transito) },
    { key: 'dias_cobertura_red', label: 'Cobertura red', width: 95, align: 'right', render: r => r.dias_cobertura_red == null ? '—' : fN(r.dias_cobertura_red) + ' d' },
    { key: 'comprar_sugerido', label: 'Comprar', width: 85, align: 'right', render: r => <b style={{ color: NAVY }}>{fN(r.comprar_sugerido)}</b> },
    { key: 'inversion', label: 'Inversión', width: 115, align: 'right', render: r => fmt(r.inversion) },
    { key: 'margen_esperado', label: 'Margen esperado', width: 120, align: 'right', render: r => fmt(r.margen_esperado) },
    { key: 'retorno_capital', label: 'Retorno', width: 75, align: 'right', render: r => <b style={{ color: +r.retorno_capital >= 1 ? VERDE : AMBAR }}>{fD(r.retorno_capital)}x</b> },
    { key: 'capital_acumulado', label: 'Capital acumulado', width: 125, align: 'right', render: r => fmt(r.capital_acumulado) },
    { key: 'alerta_costo', label: 'Costo', width: 105, render: r => r.alerta_costo ? <Tag texto={r.alerta_costo} color={ROJO} /> : '' },
  ]
  const pdf = () => tablaPdf({
    titulo: 'Inventario · compra sugerida por retorno del capital', nombre: 'compra_sugerida', orientacion: 'landscape',
    sub: tope ? `Presupuesto ${tope} MM` : 'Sin tope de capital', filas,
    cols: [{ k: 'prioridad', l: '#', num: true }, { k: 'sku', l: 'SKU' }, { k: 'producto', l: 'Producto' }, { k: 'clase', l: 'Clase', crudo: r => (r.abc || 'D') + (r.xyz || 'Z') },
           { k: 'comprar_sugerido', l: 'Comprar', num: true }, { k: 'inversion', l: 'Inversión', num: true }, { k: 'margen_esperado', l: 'Margen esperado', num: true },
           { k: 'retorno_capital', l: 'Retorno (x)' }, { k: 'capital_acumulado', l: 'Capital acumulado', num: true }],
  })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <KpiStrip>
        <KpiCelda l="Productos en la orden" v={fN(filas.length)} sub={tope ? `tope ${tope} MM` : 'sin tope de capital'} color={NAVY} />
        <KpiCelda l="Inversión" v={fmt(s('inversion'))} color={AMBAR} />
        <KpiCelda l="Margen esperado" v={fmt(s('margen_esperado'))} sub="ajustado por riesgo de demanda" color={VERDE} />
        <KpiCelda l="Retorno" v={s('inversion') > 0 ? fD(s('margen_esperado') / s('inversion')) + 'x' : '—'} sub="margen por peso invertido" color={VERDE} />
        <KpiCelda l="Venta perdida en juego" v={fmt(s('venta_perdida_84d'))} sub="si no se compra" color={ROJO} />
      </KpiStrip>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '8px 12px' }}>
        <span style={{ fontSize: 11.5, color: SLATE, fontWeight: 700 }}>Presupuesto:</span>
        <Boton onClick={() => setTope(null)} activo={!tope} tono="primario">Sin tope</Boton>
        {PRESUPUESTOS.map(p => <Boton key={p} onClick={() => setTope(p)} activo={tope === p} tono="primario">{p} MM</Boton>)}
        <span style={{ width: 1, alignSelf: 'stretch', background: BORDE, margin: '0 4px' }} />
        <label style={{ fontSize: 12, color: SLATE, display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={ocultarDudoso} onChange={e => setOcultarDudoso(e.target.checked)} /> Ocultar {dudosos} con costo dudoso
        </label>
      </div>
      <div style={{ height: 'calc(100vh - 330px)', minHeight: 420 }}>
        <DataGrid title={`Compra sugerida · ${fN(filas.length)} productos`} exportName="compra_sugerida" columns={cols} rows={filas}
          getRowId={r => r.sku} onRowClick={r => onProducto(r.sku)} emptyText="Nada que comprar con estos criterios"
          toolbar={<button onClick={pdf} disabled={!filas.length} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer', color: NAVY, fontWeight: 600 }}>PDF</button>} />
      </div>
      <Leyenda items={[
        { t: 'Orden', d: 'por retorno del capital, no por urgencia: primero lo que más margen devuelve por cada peso.' },
        { t: 'Margen esperado', d: 'sólo sobre las unidades que alcanzan a venderse dentro de la cobertura objetivo, castigado por variabilidad (X 1,0 · Y 0,85 · Z 0,70).' },
        { t: 'Capital acumulado', d: 'permite cortar el pedido donde alcanza el presupuesto.' },
        { c: ROJO, t: 'Costo dudoso', d: 'margen sobre 85% o sin costo: casi siempre es un costo mal cargado en el maestro.' },
      ]} />
    </div>
  )
}

/* ════════════ QUÉ REPONER Y MOVER ════════════ */
function Reponer({ base, movimientos, scope, irABase }) {
  const salas = SALAS.filter(s => !scope || s.id === scope)
  const b = base.filter(r => r.vende && (!scope || r.sucursal_id === scope))
  const m = movimientos.filter(x => !scope || [x.origen, x.destino].includes(scope))
  const cuenta = (fs, e) => fs.filter(r => e.includes(r.estado)).length
  const desdeCd = m.filter(x => x.tipo === 'Desde CD'), entre = m.filter(x => x.tipo === 'Entre salas')
  const sinCd = b.filter(r => ['QUIEBRE', 'CRITICO'].includes(r.estado) && !(+r.stock_en_cd > 0))
  const s = (fs, k) => fs.reduce((a, f) => a + (+f[k] || 0), 0)

  const porSala = salas.map(sa => {
    const fb = b.filter(r => r.sucursal_id === sa.id)
    return {
      id: sa.id, nombre: sa.nombre,
      quiebre: cuenta(fb, ['QUIEBRE', 'CRITICO']), reponer: fb.filter(r => ['QUIEBRE', 'CRITICO', 'REPONER'].includes(r.estado)).reduce((a, r) => a + (+r.sugerido || 0), 0),
      desdeCd: s(desdeCd.filter(x => x.destino === sa.id), 'unidades'), llega: s(entre.filter(x => x.destino === sa.id), 'unidades'),
      sale: s(entre.filter(x => x.origen === sa.id), 'unidades'), comprar: sinCd.filter(r => r.sucursal_id === sa.id).length,
    }
  })
  const cols = [{ k: 'nombre', l: 'Sala' }, { k: 'quiebre', l: 'En quiebre o crítico', num: true }, { k: 'reponer', l: 'Unidades a reponer', num: true },
                { k: 'desdeCd', l: 'Llega desde el CD', num: true }, { k: 'llega', l: 'Llega desde otras salas', num: true },
                { k: 'sale', l: 'Sale hacia otras salas', num: true }, { k: 'comprar', l: 'Sin stock en el CD', num: true }]
  const celda = (v, onClick, color = NAVY) => (
    <td style={{ padding: '7px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
      {v > 0 && onClick ? <Enlace color={color} onClick={onClick}>{fN(v)} ›</Enlace> : <span style={{ color: SLATE }}>{fN(v)}</span>}
    </td>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <KpiStrip>
        <KpiCelda l="En quiebre" v={fN(cuenta(b, ['QUIEBRE']))} sub="sin stock y con venta" color={ROJO}
                  onClick={() => irABase('productos', { estado: ['QUIEBRE'] }, 'En quiebre: sin stock y con venta')} />
        <KpiCelda l="Críticos" v={fN(cuenta(b, ['CRITICO']))} sub="bajo el stock de seguridad" color="#D1442F"
                  onClick={() => irABase('productos', { estado: ['CRITICO'] }, 'Bajo el stock de seguridad')} />
        <KpiCelda l="Por reponer" v={fN(cuenta(b, ['REPONER']))} sub="bajo el punto de reorden" color={AMBAR}
                  onClick={() => irABase('productos', { estado: ['REPONER'] }, 'Bajo el punto de reorden')} />
        <KpiCelda l="1 · Despachar desde el CD" v={fN(s(desdeCd, 'unidades')) + ' unid.'} sub={`${fN(desdeCd.length)} movimientos · ${fCLP(s(desdeCd, 'valor_costo'))}`} color={NAVY}
                  onClick={() => irABase('movimientos', { tipo: ['Desde CD'] }, 'Despachos sugeridos desde el CD')} />
        <KpiCelda l="2 · Mover entre salas" v={fN(s(entre, 'unidades')) + ' unid.'} sub={`${fCLP(s(entre, 'venta_recuperable'))} de venta recuperable`} color={VERDE}
                  onClick={() => irABase('movimientos', { tipo: ['Entre salas'] }, 'Transferencias entre salas')} />
        <KpiCelda l="3 · Hay que comprar" v={fN(sinCd.length)} sub="en quiebre y sin stock en el CD" color={ROJO}
                  onClick={() => irABase('productos', { sinStockCd: true }, 'En quiebre sin stock en el CD: hay que comprar')} />
      </KpiStrip>

      <Panel titulo="Reposición por sala" sub="clic en una cifra para ver el detalle"
        acciones={<Ex onExcel={() => tablaExcel(porSala, cols, 'reposicion_por_sala')} onPdf={() => tablaPdf({ titulo: 'Inventario · reposición por sala', filas: porSala, cols, nombre: 'reposicion_por_sala', orientacion: 'landscape' })} />}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead><tr>{cols.map((c, i) => <th key={c.k} style={{ padding: '6px 10px', textAlign: i ? 'right' : 'left', fontSize: 10, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: `1px solid ${BORDE}` }}>{c.l}</th>)}</tr></thead>
            <tbody>{porSala.map(f => (
              <tr key={f.id} className="inv-fila" style={{ borderBottom: `1px solid ${BORDE}` }}>
                <td style={{ padding: '7px 10px', fontWeight: 700, color: INK }}>{f.nombre}</td>
                {celda(f.quiebre, () => irABase('productos', { sucursal_id: [f.id], estado: ['QUIEBRE', 'CRITICO'] }, `${f.nombre}: en quiebre o crítico`), ROJO)}
                {celda(f.reponer, () => irABase('productos', { sucursal_id: [f.id], estado: ['QUIEBRE', 'CRITICO', 'REPONER'] }, `${f.nombre}: por reponer`))}
                {celda(f.desdeCd, () => irABase('movimientos', { tipo: ['Desde CD'], destino: [f.id] }, `Desde el CD hacia ${f.nombre}`))}
                {celda(f.llega, () => irABase('movimientos', { tipo: ['Entre salas'], destino: [f.id] }, `Desde otras salas hacia ${f.nombre}`), VERDE)}
                {celda(f.sale, () => irABase('movimientos', { tipo: ['Entre salas'], origen: [f.id] }, `Desde ${f.nombre} hacia otras salas`), VERDE)}
                {celda(f.comprar, () => irABase('productos', { sucursal_id: [f.id], sinStockCd: true }, `${f.nombre}: en quiebre sin stock en el CD`), ROJO)}
              </tr>))}</tbody>
          </table>
        </div>
        <Leyenda items={[
          ...['QUIEBRE', 'CRITICO', 'REPONER'].map(e => ({ c: CL_ESTADO[e], t: e.charAt(0) + e.slice(1).toLowerCase(), d: AYUDA_ESTADO[e] })),
          { c: NAVY, t: '1 · Desde el CD', d: 'primera fuente: si el CD no alcanza para todas las salas, se reparte por déficit de cobertura.' },
          { c: VERDE, t: '2 · Entre salas', d: 'sólo lo que el CD no cubre, desde la sala con más excedente. Las rutas con Los Ángeles conviene consolidarlas.' },
          { c: ROJO, t: '3 · Comprar', d: 'productos en quiebre que no tienen stock en el CD: van a "Qué comprar".' },
        ]} nota="La demanda se mide sobre los días con stock disponible, no sobre el calendario: un producto que estuvo quebrado no aparece como si no se vendiera." />
      </Panel>
    </div>
  )
}

export function InvAbastecimiento({ vista, ...p }) {
  return vista === 'comprar' ? <Comprar {...p} /> : <Reponer {...p} />
}
