/* ════════════════════════════════════════════════════════════════════
   InvCapital.jsx — ¿dónde está detenido el dinero y el espacio?
   sub = alertas   alertas con ciclo de vida y qué hacer
         dinero    capital por antigüedad y cobertura, por bodega
         capacidad uso de cada posición física (medido donde hay plano)
   Toda barra, celda o indicador con "›" abre su detalle en la base.
   ════════════════════════════════════════════════════════════════════ */

import { useState, useMemo } from 'react'
import { Panel, KpiStrip, KpiCelda, Boton, Ex, Leyenda, BarraApilada, Aviso, Enlace, Tag,
         fmt, fN, fD, fCLP, fPct, INK, SLATE, BORDE, NAVY, ROJO, AMBAR, MORADO } from './invUI'
import { nivelesDesde, usosDesde, TRAMOS_COB, ACCIONES, ESTADOS_ALERTA, nombreSuc, CL_NIVEL, NOMBRE_NIVEL } from './invData'
import { tablaExcel, tablaPdf } from './invReportes'

const ORDEN = ['suc-mp', 'suc-maipu', 'suc-lg', 'suc-la']
const suma = (fs, k) => fs.reduce((a, f) => a + (+f[k] || 0), 0)

/* Variación del capital contra la foto de hace 7 días o más */
function tendencia(historia, ids, fn) {
  const fechas = [...new Set((historia || []).map(h => h.fecha))].sort().reverse()
  if (fechas.length < 2) return null
  const lim = new Date(new Date(fechas[0] + 'T00:00:00').getTime() - 7 * 86400000).toISOString().slice(0, 10)
  const antes = fechas.find(f => f <= lim)
  if (!antes) return null
  const tot = f => historia.filter(h => h.fecha === f && ids.includes(h.sucursal_id)).reduce((a, h) => a + fn(h), 0)
  return { delta: tot(fechas[0]) - tot(antes), desde: antes }
}
const delta = t => !t || Math.abs(t.delta) < 1 ? null : `${t.delta > 0 ? '▲' : '▼'} ${fCLP(Math.abs(t.delta))} vs ${t.desde.slice(5)}`

/* ════════════ ALERTAS ════════════ */
function Alertas({ base, capital, historia, politicas, cfg, scope, irABase, onProducto, ir }) {
  const ids = scope ? [scope] : ORDEN
  const b = useMemo(() => base.filter(r => ids.includes(r.sucursal_id)), [base, scope]) // eslint-disable-line
  const cap = capital.filter(c => ids.includes(c.sucursal_id))
  const abiertas = b.filter(r => r.alerta_estado === 'abierta'), gestion = b.filter(r => r.alerta_estado === 'en_gestion')
  const det = b.filter(r => ['INMOVILIZADO', 'MUERTO'].includes(r.nivel))
  const tDet = tendencia(historia, ids, h => (+h.v_inmovilizado || 0) + (+h.v_muerto || 0))
  const tLen = tendencia(historia, ids, h => +h.v_lento || 0)
  const sinValidar = politicas.filter(p => !p.validado).length
  const top = [...abiertas, ...gestion].sort((x, y) => (+y.valor_costo || 0) - (+x.valor_costo || 0)).slice(0, 12)
  const acciones = useMemo(() => {
    const m = {}
    for (const r of b) if (r.accion) { m[r.accion] = m[r.accion] || { n: 0, v: 0 }; m[r.accion].n++; m[r.accion].v += +r.valor_costo || 0 }
    return Object.entries(m).sort((x, y) => y[1].v - x[1].v)
  }, [b])
  const colsTop = [
    { k: 'sku', l: 'SKU' }, { k: 'producto', l: 'Producto' }, { k: 'sucursal_id', l: 'Bodega', crudo: r => nombreSuc(r.sucursal_id) },
    { k: 'nivel', l: 'Situación', crudo: r => NOMBRE_NIVEL[r.nivel] }, { k: 'dias_inmovil', l: 'Días sin moverse', num: true },
    { k: 'valor_costo', l: 'Capital', num: true }, { k: 'accion', l: 'Qué hacer' }, { k: 'alerta_estado', l: 'Alerta', crudo: r => ESTADOS_ALERTA[r.alerta_estado]?.l },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {sinValidar > 0 && (
        <Aviso><b>{sinValidar} de {politicas.length} políticas de inventario no están validadas por Compras.</b> El stock "sobre el objetivo"
          depende del plazo de entrega de cada tipo de producto: mientras no se validen, esa cifra es referencial.{' '}
          <Enlace onClick={() => ir('sistema', 'reglas')}>Revisar políticas ›</Enlace></Aviso>
      )}
      <KpiStrip>
        <KpiCelda l="Alertas sin gestionar" v={fN(abiertas.length)} sub={fmt(suma(abiertas, 'valor_costo'))} color={ROJO} destacar={abiertas.length > 0}
                  onClick={() => irABase('productos', { alerta_estado: ['abierta'] }, 'Alertas sin gestionar')} />
        <KpiCelda l="En gestión" v={fN(gestion.length)} sub={fmt(suma(gestion, 'valor_costo'))} color={AMBAR}
                  onClick={() => irABase('productos', { alerta_estado: ['en_gestion'] }, 'Alertas en gestión')} />
        <KpiCelda l="Capital detenido" v={fmt(suma(det, 'valor_costo'))} sub={delta(tDet) || `${fN(det.length)} productos, +${cfg.dias_lento} días`} color="#D1442F"
                  onClick={() => irABase('productos', { detenido: true }, `Más de ${cfg.dias_lento} días sin moverse`)} />
        <KpiCelda l="Poniéndose lento" v={fmt(suma(cap, 'v_lento'))} sub={delta(tLen) || `${cfg.dias_activo + 1}–${cfg.dias_lento} días`} color={AMBAR}
                  onClick={() => irABase('productos', { nivel: ['LENTO'] }, 'Productos poniéndose lentos')} />
        <KpiCelda l="Sobre el objetivo" v={fmt(suma(cap, 'v_exceso'))} sub={`${fCLP(suma(cap, 'v_transferible'))} transferible a salas`} color={MORADO}
                  onClick={() => irABase('productos', { exceso: true }, 'Productos con stock sobre el objetivo')} />
        <KpiCelda l="Recién llegado" v={fmt(suma(cap, 'v_nuevo'))} sub={`sin moverse, ≤ ${cfg.dias_activo} días`} color="#1D4E89"
                  onClick={() => irABase('productos', { nivel: ['NUEVO'] }, 'Recién llegado, aún sin moverse')} />
      </KpiStrip>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12, alignItems: 'start' }}>
        <Panel titulo="Alertas de mayor capital" sub="clic para abrir la ficha y gestionarla"
          acciones={<span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <Enlace onClick={() => irABase('productos', { alertaVigente: true }, 'Todas las alertas vigentes')}>Ver todas ›</Enlace>
            <Ex onExcel={() => tablaExcel([...abiertas, ...gestion], colsTop, 'alertas_inventario')}
                onPdf={() => tablaPdf({ titulo: 'Inventario · alertas vigentes', filas: [...abiertas, ...gestion].sort((x, y) => y.valor_costo - x.valor_costo), cols: colsTop, nombre: 'alertas_inventario', orientacion: 'landscape' })} />
          </span>} sinPadding>
          {top.length ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>{top.map(r => (
                <tr key={r.sku + r.sucursal_id} className="inv-fila" onClick={() => onProducto(r.sku)} style={{ cursor: 'pointer', borderBottom: `1px solid ${BORDE}` }}>
                  <td style={{ padding: '7px 12px', maxWidth: 280, whiteSpace: 'normal' }}>
                    <div style={{ fontSize: 12.5, color: INK, fontWeight: 600 }}>{r.producto}</div>
                    <div style={{ fontSize: 10.5, color: SLATE }}>{r.sku} · {nombreSuc(r.sucursal_id)} · {r.dias_es_minimo ? '≥ ' : ''}{fN(r.dias_inmovil)} días</div>
                  </td>
                  <td style={{ padding: '7px 8px' }}><Tag texto={NOMBRE_NIVEL[r.nivel]} color={CL_NIVEL[r.nivel]} /></td>
                  <td style={{ padding: '7px 8px' }}><Tag texto={ESTADOS_ALERTA[r.alerta_estado].l} color={ESTADOS_ALERTA[r.alerta_estado].c} /></td>
                  <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(r.valor_costo)}</td>
                </tr>))}</tbody>
            </table>
          ) : <div style={{ padding: 20, color: SLATE, fontSize: 12.5, textAlign: 'center' }}>Sin alertas vigentes.</div>}
        </Panel>

        <Panel titulo="Qué hacer con el capital que no trabaja" sub="clic para ver los productos de cada acción">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {acciones.map(([acc, x]) => (
              <button key={acc} className="inv-clic" onClick={() => irABase('productos', { accion: [acc] }, acc)}
                style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer', padding: '8px 10px', borderRadius: 8, color: INK, border: `1px solid ${BORDE}`, background: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <b style={{ fontSize: 12.5 }}>{acc}</b><b style={{ fontSize: 12.5, color: NAVY, whiteSpace: 'nowrap' }}>{fCLP(x.v)} ›</b>
                </div>
                <div style={{ fontSize: 11, color: SLATE, lineHeight: 1.4, marginTop: 2 }}>{fN(x.n)} productos · {ACCIONES[acc]}</div>
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <Leyenda titulo="Cómo funcionan las alertas" items={[
        ...nivelesDesde(cfg).filter(n => n.k !== 'SIN STOCK').map(n => ({ c: n.c, t: n.l, d: n.d })),
        ...Object.values(ESTADOS_ALERTA).map(e => ({ c: e.c, t: 'Alerta ' + e.l.toLowerCase() })),
      ]} nota={<>Una alerta se abre <b>una sola vez</b> por producto y bodega al cruzar los {cfg.dias_lento} días sin moverse, y se
        <b> cierra sola</b> cuando el producto vuelve a moverse o se queda sin stock. "Días sin moverse" cuenta desde la última venta
        (en el CD, el último despacho) o la última llegada, lo más reciente. "≥" indica un mínimo: no hay movimiento desde que existe historia.</>} />
    </div>
  )
}

/* ════════════ DINERO Y COBERTURA ════════════ */
function Dinero({ capital, historia, cfg, scope, irABase }) {
  const bodegas = ORDEN.filter(id => !scope || id === scope).map(id => capital.find(c => c.sucursal_id === id)).filter(Boolean)
  const NIV = nivelesDesde(cfg).filter(n => n.k !== 'SIN STOCK')
  const cols = [{ k: 'nombre', l: 'Bodega' }, { k: 'valor_total', l: 'Inventario', num: true }, ...NIV.map(n => ({ k: 'v_' + n.k.toLowerCase(), l: n.l, num: true })),
                { k: 'v_exceso', l: 'Sobre objetivo', num: true }, { k: 'cobertura_dias', l: 'Cobertura (días)', num: true },
                ...TRAMOS_COB.map(t => ({ k: t.k, l: 'Cob. ' + t.l, num: true }))]
  const fechas = [...new Set(historia.map(h => h.fecha))].sort()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Panel titulo="Dinero por bodega según cuánto lleva sin moverse" sub="clic en un tramo para ver esos productos"
        acciones={<Ex onExcel={() => tablaExcel(bodegas, cols, 'capital_por_bodega')}
                      onPdf={() => tablaPdf({ titulo: 'Inventario · capital por bodega', filas: bodegas, cols: cols.slice(0, 10), nombre: 'capital_por_bodega', orientacion: 'landscape' })} />}>
        {bodegas.map(b => (
          <BarraApilada key={b.sucursal_id} etiqueta={b.nombre} sub={`${fN(b.skus)} productos · ${fN(b.unidades)} unid.`} fmtV={fCLP}
            tramos={NIV.map(n => ({ k: n.k, l: n.l, c: n.c, v: b['v_' + n.k.toLowerCase()] }))}
            onTramo={t => irABase('productos', { sucursal_id: [b.sucursal_id], nivel: [t.k] }, `${b.nombre}: ${t.l.toLowerCase()}`)} />
        ))}
        <Leyenda items={NIV.map(n => ({ c: n.c, t: n.l, d: n.d }))}
          nota={<>En salas el movimiento es la venta; en el CD, el despacho a salas. El detalle por bodega en cifras está en el Panel general.</>} />
      </Panel>

      <Panel titulo="Cobertura de stock por bodega" sub="días de venta guardados y cómo se reparte ese capital · clic en un tramo para ver esos productos">
        {bodegas.map(b => (
          <BarraApilada key={b.sucursal_id} etiqueta={b.nombre} ancho={150} fmtV={fCLP}
            sub={b.cobertura_dias ? `${fN(b.cobertura_dias)} días · ${fD(b.cobertura_dias / 7, 1)} semanas` : 'sin venta'}
            tramos={TRAMOS_COB.map(t => ({ k: t.k, l: t.l, c: t.c, v: b[t.k] }))}
            onTramo={t => irABase('productos', { sucursal_id: [b.sucursal_id], cob: t.k, conStock: true }, `${b.nombre}: cobertura ${t.l}`)} />
        ))}
        <Leyenda items={TRAMOS_COB.map(t => ({ c: t.c, t: t.l, d: t.d }))}
          nota={<>El número bajo cada bodega son los <b>días de venta que cubre su stock</b>: valor del inventario dividido por el costo
            de lo que se vende cada día. En el CD se mide contra la venta de toda la red.</>} />
      </Panel>

      {fechas.length >= 2 && (
        <Panel titulo="Evolución del capital que no trabaja" sub="foto diaria tomada en el recálculo de la madrugada">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr><th style={{ padding: '5px 10px', textAlign: 'left', color: SLATE, fontSize: 10 }}>FECHA</th>
                {['Detenido', 'Lento', 'Sobre objetivo', 'Alertas abiertas'].map(h => <th key={h} style={{ padding: '5px 10px', textAlign: 'right', color: SLATE, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
              <tbody>{fechas.slice(-10).reverse().map(f => {
                const hs = historia.filter(h => h.fecha === f && (!scope || h.sucursal_id === scope))
                return <tr key={f} style={{ borderTop: `1px solid ${BORDE}` }}>
                  <td style={{ padding: '5px 10px' }}>{f}</td>
                  <td style={{ padding: '5px 10px', textAlign: 'right' }}>{fmt(hs.reduce((a, h) => a + (+h.v_inmovilizado || 0) + (+h.v_muerto || 0), 0))}</td>
                  <td style={{ padding: '5px 10px', textAlign: 'right' }}>{fmt(suma(hs, 'v_lento'))}</td>
                  <td style={{ padding: '5px 10px', textAlign: 'right' }}>{fmt(suma(hs, 'v_exceso'))}</td>
                  <td style={{ padding: '5px 10px', textAlign: 'right' }}>{fN(suma(hs, 'alertas_abiertas'))}</td>
                </tr>
              })}</tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  )
}

/* ════════════ CAPACIDAD ════════════ */
function Capacidad({ capRes, capital, cfg, scope, irABase }) {
  const [bod, setBod] = useState(scope || 'suc-lg')
  const r = capRes.find(x => x.sucursal_id === bod), cb = capital.find(x => x.sucursal_id === bod)
  const USOS = usosDesde(cfg)
  const n = nombreSuc(bod)
  const ver = (uso, titulo) => irABase('posiciones', { sucursal_id: [bod], ...(uso && { uso }) }, `${n}: ${titulo}`)
  const sinProducto = (+r?.posiciones_libres || 0) + (+r?.pos_vacia || 0)
  const porUso = { 'BIEN USADA': r?.pos_bien_usada, 'SOBREDIMENSIONADA': r?.pos_sobredimensionada, 'SUBDIMENSIONADA': r?.pos_subdimensionada,
                   'DESBORDADA': r?.pos_desbordada, 'LENTO': r?.pos_lento, 'INMOVILIZADO': r?.pos_inmovilizado, 'EN QUIEBRE': r?.pos_en_quiebre,
                   'VACÍA': r?.pos_vacia, 'SIN CAPACIDAD': r?.pos_sin_capacidad }
  const plano = r ? [{ bodega: n, ...Object.fromEntries(USOS.map(u => [u.k, +porUso[u.k] || 0])), libres: +r.posiciones_libres || 0,
                       ociosa_pct: r.pct_ociosa, desbordadas: r.unid_desbordadas, sin_posicion: r.skus_sin_posicion }] : []
  const colsEx = [{ k: 'bodega', l: 'Bodega' }, ...USOS.map(u => ({ k: u.k, l: u.k, num: true })), { k: 'libres', l: 'Nunca asignadas', num: true },
                  { k: 'ociosa_pct', l: '% ocioso' }, { k: 'desbordadas', l: 'Unid. sin lugar', num: true }, { k: 'sin_posicion', l: 'Productos sin posición', num: true }]

  return (
    <Panel titulo="Capacidad de bodega" sub="cada posición física comparada con lo que su producto debería guardar"
      acciones={<span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {ORDEN.filter(id => !scope || id === scope).map(id => <Boton key={id} onClick={() => setBod(id)} activo={bod === id} tono="primario">{nombreSuc(id)}</Boton>)}
        {r?.plano_cargado && <Ex onExcel={() => tablaExcel(plano, colsEx, `capacidad_${bod}`)} onPdf={() => tablaPdf({ titulo: `Inventario · capacidad de ${n}`, filas: plano, cols: colsEx, nombre: `capacidad_${bod}`, orientacion: 'landscape' })} />}
      </span>}>
      {r?.plano_cargado ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <KpiStrip>
            <KpiCelda l="Capacidad ociosa" v={fPct(r.pct_ociosa)} sub={`de ${fN(r.capacidad_plano)} unid. del plano`} color={MORADO}
                      onClick={() => ver(['VACÍA', 'INMOVILIZADO', 'SOBREDIMENSIONADA'], 'posiciones con capacidad ociosa')} />
            <KpiCelda l="En quiebre" v={fN(r.pos_en_quiebre)} sub={`${fCLP(r.venta_perdida_quiebre)} de venta perdida`} color={ROJO}
                      onClick={() => ver(['EN QUIEBRE'], 'posiciones vacías por quiebre')} />
            <KpiCelda l="Sobredimensionadas" v={fN(r.pos_sobredimensionada)} sub="sobra espacio" color="#1D4E89"
                      onClick={() => ver(['SOBREDIMENSIONADA'], 'posiciones sobredimensionadas')} />
            <KpiCelda l="Chicas" v={fN(r.pos_subdimensionada)} sub={`faltan ${fN(r.capacidad_faltante)} unid.`} color="#7C3AED"
                      onClick={() => ver(['SUBDIMENSIONADA'], 'posiciones subdimensionadas')} />
            <KpiCelda l="Desbordadas" v={fN(r.pos_desbordada)} sub={`${fN(r.unid_desbordadas)} unid. sin lugar`} color="#8E1B10"
                      onClick={() => ver(['DESBORDADA'], 'posiciones desbordadas')} />
            <KpiCelda l="Productos sin posición" v={fN(r.skus_sin_posicion)} sub={`${fN(r.skus_sin_posicion_que_venden)} se venden · ${fCLP(r.valor_sin_posicion)}`} color={AMBAR} />
          </KpiStrip>
          <BarraApilada etiqueta="Posiciones" sub="según su uso" ancho={100} fmtV={fN}
            tramos={[...USOS.map(u => ({ k: u.k, l: u.k, c: u.c, v: porUso[u.k] })), { k: 'LIBRE', l: 'Nunca asignada', c: '#D4D4D8', v: r.posiciones_libres, filtro: false }]}
            onTramo={t => ver([t.k], `posiciones ${t.l.toLowerCase()}`)} />
          {sinProducto > 0 && +r.skus_sin_posicion_que_venden > 0 && (
            <Aviso tono="info">Hay <b>{fN(sinProducto)} posiciones sin producto</b> ({fN(r.posiciones_libres)} nunca asignadas y {fN(r.pos_vacia)} de
              productos sin stock ni demanda) y, a la vez, <b>{fN(r.skus_sin_posicion_que_venden)} productos que se venden sin posición</b>.
              Antes de pensar en más espacio conviene reasignar el que existe.{+r.pos_en_quiebre > 0 && <> Las <b>{fN(r.pos_en_quiebre)} posiciones en quiebre no se tocan</b>: se reponen.</>}</Aviso>
          )}
          <Leyenda items={[...USOS.map(u => ({ c: u.c, t: u.k, d: u.d })), { c: '#D4D4D8', t: 'Nunca asignada', d: 'posición del plano sin producto asignado.' }]}
            nota={<>Cada producto tiene un <b>mínimo</b> que su posición debería poder guardar ({cfg.dias_reposicion_sala} días de venta + seguridad:
              un ciclo de reposición desde el CD) y un <b>máximo</b> (su cobertura objetivo + seguridad). <b>Capacidad ociosa</b> = posiciones sin producto
              ni demanda + espacio ocupado por productos detenidos + lo que sobra en las sobredimensionadas. El plano se mantiene en Logística → Layout.</>} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Aviso><b>{n} no tiene su plano de bodega cargado</b>{r ? ` (${fN(r.posiciones_plano)} posiciones registradas)` : ''}: la capacidad física
            no se puede medir. Lo que sí se sabe es cuánto stock ocupa espacio sin necesitarlo.</Aviso>
          {cb && (
            <KpiStrip>
              <KpiCelda l="Unidades sobre el objetivo" v={fN(cb.u_exceso)} sub={fCLP(cb.v_exceso)} color={MORADO}
                        onClick={() => irABase('productos', { sucursal_id: [bod], exceso: true }, `${n}: stock sobre el objetivo`)} />
              <KpiCelda l="Unidades detenidas" v={fN(cb.u_detenidas)} sub={`+${cfg.dias_lento} días sin moverse`} color={ROJO}
                        onClick={() => irABase('productos', { sucursal_id: [bod], detenido: true }, `${n}: productos detenidos`)} />
              <KpiCelda l="Unidades guardadas" v={fN(cb.unidades)} sub={`${fN(cb.skus)} productos`} color={NAVY}
                        onClick={() => irABase('productos', { sucursal_id: [bod], conStock: true }, `${n}: todo el inventario`)} />
            </KpiStrip>
          )}
          <Leyenda nota={<>No se muestra un porcentaje de espacio ocioso porque sería engañoso: sin el plano no se sabe cuánto ocupa cada
            unidad (una puerta no ocupa lo que una cerradura). Al cargar el plano en Logística → Layout, esta sección muestra el
            análisis posición por posición, como en La Granja.</>} />
        </div>
      )}
    </Panel>
  )
}

export function InvCapital(p) {
  if (p.sub === 'dinero') return <Dinero {...p} />
  if (p.sub === 'capacidad') return <Capacidad {...p} />
  return <Alertas {...p} />
}
