/* ════════════════════════════════════════════════════════════════════
   InvCapital.jsx — ¿dónde está detenido el dinero y el espacio?
   1. Alertas      lo que requiere decisión, con tendencia y estado de gestión
   2. Acciones     qué hacer con ese capital
   3. Dinero       capital por bodega según cuánto lleva sin moverse
   4. Cobertura    días de venta guardados en cada bodega
   5. Capacidad    uso de cada posición física contra lo que debería guardar
   6. Detalle      cada producto, con su acción y su alerta gestionable
   Umbrales y factores vienen de inv_config (editables en Sistema).
   ════════════════════════════════════════════════════════════════════ */

import { useState, useMemo } from 'react'
import {
  Kpi, Tag, Panel, Tabla, Boton, Leyenda, BarraApilada, inputEstilo, fmt, fN, fD, fCLP,
  INK, SLATE, LINE, NAVY, ROJO, VERDE, AMBAR, AZUL, MORADO,
} from './invUI'
import {
  nivelesDesde, usosDesde, ACCIONES, ESTADOS_ALERTA, CONFIG_DEFECTO, gestionarAlerta, nombreSuc,
} from './invData'

const ORDEN_BODEGA = ['suc-mp', 'suc-maipu', 'suc-lg', 'suc-la']

const TRAMOS_COB = [
  { k: 'cob_0_15',      l: '0–15 días',   c: ROJO,      d: 'Riesgo de quiebre: alcanza para dos semanas o menos.' },
  { k: 'cob_16_30',     l: '16–30 días',  c: AMBAR,     d: 'Justo: hay que reponer pronto.' },
  { k: 'cob_31_60',     l: '31–60 días',  c: VERDE,     d: 'Sano para un producto de reposición nacional.' },
  { k: 'cob_61_90',     l: '61–90 días',  c: AZUL,      d: 'Holgado. Normal en importados por el plazo de llegada.' },
  { k: 'cob_91_180',    l: '91–180 días', c: '#C2410C', d: 'Sobrestock: capital y espacio comprometidos por 3 a 6 meses.' },
  { k: 'cob_mas_180',   l: '+180 días',   c: MORADO,    d: 'Más de medio año de venta guardado. Candidato a no recomprar.' },
  { k: 'cob_sin_venta', l: 'Sin venta',   c: '#9A9AA0', d: 'Sin ventas recientes: la cobertura no se puede calcular.' },
]

const suma = (fs, k) => fs.reduce((a, f) => a + (+f[k] || 0), 0)
const detenido = b => (+b.v_inmovilizado || 0) + (+b.v_muerto || 0)

/* Variación contra la foto más cercana de hace 7 días o más */
function tendencia(historia, ids, campoFn) {
  if (!historia?.length) return null
  const fechas = [...new Set(historia.map(h => h.fecha))].sort().reverse()
  const hoy = fechas[0]
  const lim = new Date(new Date(hoy + 'T00:00:00').getTime() - 7 * 86400000).toISOString().slice(0, 10)
  const antes = fechas.find(f => f <= lim)
  if (!antes) return null
  const tot = f => historia.filter(h => h.fecha === f && ids.includes(h.sucursal_id)).reduce((a, h) => a + campoFn(h), 0)
  return { delta: tot(hoy) - tot(antes), desde: antes }
}

function Delta({ t, malo = 'sube' }) {
  if (!t || Math.abs(t.delta) < 1) return null
  const sube = t.delta > 0
  const c = (sube && malo === 'sube') || (!sube && malo === 'baja') ? ROJO : VERDE
  return <span style={{ color: c, fontWeight: 700 }}> {sube ? '▲' : '▼'} {fCLP(Math.abs(t.delta))} vs {t.desde.slice(5)}</span>
}

function Alerta({ c, titulo, valor, detalle, onClick, activo }) {
  return (
    <button onClick={onClick} disabled={!onClick} style={{
      textAlign: 'left', font: 'inherit', cursor: onClick ? 'pointer' : 'default', color: INK,
      background: activo ? c + '12' : '#fff', border: `1px solid ${activo ? c : LINE}`,
      borderLeft: `4px solid ${c}`, borderRadius: 4, padding: '9px 12px', flex: '1 1 190px', minWidth: 0,
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, color: c, textTransform: 'uppercase', letterSpacing: '.04em' }}>{titulo}</div>
      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.25 }}>{valor}</div>
      <div style={{ fontSize: 11, color: SLATE, lineHeight: 1.4 }}>{detalle}</div>
    </button>
  )
}

export function InvCapital({
  capital = [], capRes = [], capacidad = [], inmov = [], historia = [], politicas = [],
  cfg = CONFIG_DEFECTO, scope, usuario, onProducto, onRecargar, onIrSistema,
}) {
  const NIVELES = useMemo(() => nivelesDesde(cfg), [cfg])
  const CL_NIVEL = useMemo(() => Object.fromEntries(NIVELES.map(n => [n.k, n.c])), [NIVELES])
  const USOS = useMemo(() => usosDesde(cfg), [cfg])
  const CL_USO = useMemo(() => Object.fromEntries(USOS.map(u => [u.k, u.c])), [USOS])

  const [fBodega, setFBodega] = useState(scope || 'TODAS')
  const [fVista, setFVista] = useState('ALERTAS')   // ALERTAS | DETENIDOS | <nivel> | TODOS
  const [fAccion, setFAccion] = useState('TODAS')
  const [texto, setTexto] = useState('')
  const [bodegaCap, setBodegaCap] = useState(scope || 'suc-lg')
  const [gestion, setGestion] = useState(null)      // { id, sku, producto, nota }
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState('')

  const idsVisibles = scope ? [scope] : ORDEN_BODEGA
  const bodegas = useMemo(() => ORDEN_BODEGA.filter(id => idsVisibles.includes(id))
    .map(id => capital.find(c => c.sucursal_id === id)).filter(Boolean), [capital, scope])   // eslint-disable-line
  const inmovVisible = useMemo(() => scope ? inmov.filter(i => i.sucursal_id === scope) : inmov, [inmov, scope])
  const sinValidar = politicas.filter(p => !p.validado).length

  const tot = useMemo(() => {
    const det = inmovVisible.filter(i => i.nivel === 'INMOVILIZADO' || i.nivel === 'MUERTO')
    const abiertas = inmovVisible.filter(i => i.alerta_estado === 'abierta')
    return {
      detenido: suma(det, 'valor_costo'), nDet: det.length, uDet: suma(det, 'stock'),
      muerto: suma(det.filter(i => i.nivel === 'MUERTO'), 'valor_costo'),
      lento: suma(bodegas, 'v_lento'), nLento: suma(bodegas, 'n_lento'),
      exceso: suma(bodegas, 'v_exceso'), transferible: suma(bodegas, 'v_transferible'),
      nuevo: suma(bodegas, 'v_nuevo'), total: suma(bodegas, 'valor_total'),
      nAbiertas: abiertas.length, vAbiertas: suma(abiertas, 'valor_costo'),
      nGestion: inmovVisible.filter(i => i.alerta_estado === 'en_gestion').length,
    }
  }, [inmovVisible, bodegas])

  const tDet = useMemo(() => tendencia(historia, idsVisibles, h => (+h.v_inmovilizado || 0) + (+h.v_muerto || 0)), [historia, scope]) // eslint-disable-line
  const tLento = useMemo(() => tendencia(historia, idsVisibles, h => +h.v_lento || 0), [historia, scope])                           // eslint-disable-line

  const porAccion = useMemo(() => {
    const m = {}
    for (const i of inmovVisible) {
      if (!i.accion) continue
      m[i.accion] = m[i.accion] || { n: 0, v: 0 }
      m[i.accion].n++; m[i.accion].v += +i.valor_costo || 0
    }
    return Object.entries(m).sort((a, b) => b[1].v - a[1].v)
  }, [inmovVisible])

  const filas = useMemo(() => {
    let f = inmovVisible
    if (fBodega !== 'TODAS') f = f.filter(i => i.sucursal_id === fBodega)
    if (fVista === 'ALERTAS') f = f.filter(i => i.alerta_estado && i.alerta_estado !== 'resuelta')
    else if (fVista === 'DETENIDOS') f = f.filter(i => i.nivel === 'INMOVILIZADO' || i.nivel === 'MUERTO')
    else if (fVista !== 'TODOS') f = f.filter(i => i.nivel === fVista)
    if (fAccion !== 'TODAS') f = f.filter(i => i.accion === fAccion)
    if (texto.trim()) {
      const t = texto.trim().toLowerCase()
      f = f.filter(i => String(i.sku).toLowerCase().includes(t) || String(i.producto || '').toLowerCase().includes(t))
    }
    return f
  }, [inmovVisible, fBodega, fVista, fAccion, texto])

  const guardarGestion = async estado => {
    if (!gestion) return
    setGuardando(true); setMsg('')
    try {
      await gestionarAlerta(gestion.id, estado, gestion.nota, usuario)
      setMsg(estado === 'resuelta' ? `Alerta de ${gestion.sku} cerrada.` : `${gestion.sku} quedó en gestión.`)
      setGestion(null)
      await onRecargar?.()
    } catch (e) { setMsg('No se pudo guardar: ' + e.message) }
    setGuardando(false)
  }

  const cols = [
    { k: 'sku', l: 'SKU' },
    { k: 'producto', l: 'Producto', wrap: true },
    { k: 'sucursal_id', l: 'Bodega', render: f => nombreSuc(f.sucursal_id), crudo: f => nombreSuc(f.sucursal_id) },
    { k: 'nivel', l: 'Situación', render: f => <Tag texto={f.nivel} color={CL_NIVEL[f.nivel]} /> },
    { k: 'dias_inmovil', l: 'Días sin moverse', num: true, crudo: f => f.dias_inmovil,
      render: f => <b style={{ color: CL_NIVEL[f.nivel] }}>{f.dias_es_minimo ? '≥ ' : ''}{fN(f.dias_inmovil)}</b> },
    { k: 'ultimo_mov', l: 'Último movimiento', crudo: f => f.vende ? f.ultima_venta : f.ultimo_despacho,
      render: f => f.vende ? (f.ultima_venta ? 'venta ' + f.ultima_venta : 'sin ventas')
                           : (f.ultimo_despacho ? 'despacho ' + f.ultimo_despacho : 'sin despachos') },
    { k: 'ultima_venta_red', l: 'Última venta en la red', render: f => f.ultima_venta_red || 'nunca' },
    { k: 'stock', l: 'Unidades', num: true },
    { k: 'valor_costo', l: 'Capital a costo', num: true, render: f => <b>{fmt(f.valor_costo)}</b> },
    { k: 'accion', l: 'Qué hacer', wrap: true, crudo: f => f.accion,
      render: f => f.accion
        ? <span title={ACCIONES[f.accion]}>{f.accion}{f.sala_destino && /Transferir|Distribuir/.test(f.accion) ? ` → ${nombreSuc(f.sala_destino)}` : ''}</span>
        : '—' },
    { k: 'alerta_estado', l: 'Alerta', crudo: f => ESTADOS_ALERTA[f.alerta_estado]?.l || '',
      render: f => f.alerta_estado
        ? <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Tag texto={ESTADOS_ALERTA[f.alerta_estado]?.l} color={ESTADOS_ALERTA[f.alerta_estado]?.c} />
            <span style={{ fontSize: 10, color: SLATE }}>{f.alerta_carga_inicial ? 'desde inicio del sistema' : 'desde ' + f.alerta_desde}</span>
          </span>
        : '—' },
    { k: 'gestionar', l: '', crudo: () => '',
      render: f => f.alerta_id
        ? <button onClick={e => { e.stopPropagation(); setGestion({ id: f.alerta_id, sku: f.sku, producto: f.producto, nota: f.alerta_nota || '' }) }}
            style={{ ...inputEstilo, cursor: 'pointer', fontWeight: 600, color: NAVY, padding: '3px 8px' }}>Gestionar</button>
        : null },
  ]

  const resCap = capRes.find(r => r.sucursal_id === bodegaCap)
  const capBod = capital.find(c => c.sucursal_id === bodegaCap)
  const posAccion = useMemo(() => capacidad
    .filter(p => p.sucursal_id === bodegaCap && p.uso !== 'SIN CAPACIDAD')
    .sort((a, b) => (+b.capacidad_ociosa || 0) + (+b.capacidad_faltante || 0) + (+b.unid_desbordadas || 0) + (+b.venta_perdida_84d || 0) / 1e4
                  - (+a.capacidad_ociosa || 0) - (+a.capacidad_faltante || 0) - (+a.unid_desbordadas || 0) - (+a.venta_perdida_84d || 0) / 1e4),
  [capacidad, bodegaCap])

  const colsPos = [
    { k: 'codigos', l: 'Posición', wrap: true },
    { k: 'sku', l: 'SKU' },
    { k: 'producto', l: 'Producto', wrap: true },
    { k: 'uso', l: 'Uso', render: f => <Tag texto={f.uso} color={CL_USO[f.uso]} /> },
    { k: 'capacidad', l: 'Capacidad', num: true },
    { k: 'nivel_minimo', l: 'Debe guardar mín.', num: true, render: f => f.nivel_minimo == null ? '—' : fN(f.nivel_minimo) },
    { k: 'nivel_objetivo', l: 'Debe guardar máx.', num: true, render: f => f.nivel_objetivo == null ? '—' : fN(f.nivel_objetivo) },
    { k: 'stock', l: 'Stock hoy', num: true },
    { k: 'capacidad_ociosa', l: 'Capacidad ociosa', num: true },
    { k: 'capacidad_faltante', l: 'Le falta', num: true },
    { k: 'unid_desbordadas', l: 'Unid. sin lugar', num: true },
    { k: 'venta_perdida_84d', l: 'Venta perdida 84d', num: true, render: f => +f.venta_perdida_84d > 0 ? fmt(f.venta_perdida_84d) : '—' },
    { k: 'ultimo_mov_fisico', l: 'Últ. mov. físico', render: f => f.ultimo_mov_fisico || '—' },
  ]

  const posSinProducto = (+resCap?.posiciones_libres || 0) + (+resCap?.pos_vacia || 0)
  const posMalDim = (+resCap?.pos_sobredimensionada || 0) + (+resCap?.pos_subdimensionada || 0)

  return (
    <div>
      {sinValidar > 0 && (
        <div style={{ background: AMBAR + '10', border: `1px solid ${AMBAR}40`, borderRadius: 4, padding: '7px 11px',
                      marginBottom: 10, fontSize: 11.8, color: INK, lineHeight: 1.5 }}>
          <b>{sinValidar} de {politicas.length} políticas de inventario no están validadas por Compras.</b> El stock
          "sobre el objetivo" depende del plazo de entrega de cada tipo: si el plazo real es mayor, el exceso es menor.
          Mientras no se validen, esa cifra es referencial.
          {onIrSistema && <> <button onClick={onIrSistema} style={{ border: 0, background: 'none', color: NAVY, fontWeight: 700,
            cursor: 'pointer', font: 'inherit', textDecoration: 'underline', padding: 0 }}>Revisar políticas</button></>}
        </div>
      )}

      {/* ═══ 1. ALERTAS ═══ */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
        <Alerta c={ROJO} titulo="Alertas sin gestionar" valor={fN(tot.nAbiertas)}
          detalle={<>{fmt(tot.vAbiertas)} en productos que cruzaron los {cfg.dias_lento} días sin moverse y nadie ha tomado.
                     {tot.nGestion > 0 ? ` ${fN(tot.nGestion)} ya están en gestión.` : ''}</>}
          activo={fVista === 'ALERTAS'} onClick={() => { setFVista('ALERTAS'); setFAccion('TODAS') }} />
        <Alerta c="#D1442F" titulo="Capital detenido" valor={fmt(tot.detenido)}
          detalle={<>{fN(tot.nDet)} productos · {fN(tot.uDet)} unid. con más de {cfg.dias_lento} días quietos
                     {tot.muerto > 0 ? ` · ${fmt(tot.muerto)} pasa los ${cfg.dias_inmovilizado}` : ''}<Delta t={tDet} /></>}
          activo={fVista === 'DETENIDOS'} onClick={() => { setFVista('DETENIDOS'); setFAccion('TODAS') }} />
        <Alerta c={AMBAR} titulo="Poniéndose lento" valor={fmt(tot.lento)}
          detalle={<>{fN(tot.nLento)} productos entre {cfg.dias_activo + 1} y {cfg.dias_lento} días quietos<Delta t={tLento} /></>}
          activo={fVista === 'LENTO'} onClick={() => { setFVista('LENTO'); setFAccion('TODAS') }} />
        <Alerta c={MORADO} titulo="Sobre el objetivo" valor={fmt(tot.exceso)}
          detalle={<>Productos que sí se mueven, con más stock del que su bodega debería guardar.
                     {tot.transferible > 0 ? ` ${fmt(tot.transferible)} se puede mover a salas que lo necesitan.` : ''}</>} />
        <Alerta c={AZUL} titulo="Recién llegado" valor={fmt(tot.nuevo)}
          detalle={`Llegó hace ${cfg.dias_activo} días o menos y aún no se mueve. Se vigila, no se alarma.`}
          activo={fVista === 'NUEVO'} onClick={() => { setFVista('NUEVO'); setFAccion('TODAS') }} />
      </div>
      <div style={{ fontSize: 11.5, color: SLATE, marginBottom: 12 }}>
        De {fmt(tot.total)} en inventario, <b style={{ color: INK }}>{fD(100 * (tot.detenido + tot.lento) / Math.max(tot.total, 1), 1)}%</b> está
        lento o detenido y <b style={{ color: INK }}>{fD(100 * tot.exceso / Math.max(tot.total, 1), 1)}%</b> está sobre el objetivo.
        Las alertas se abren una sola vez por producto y bodega, y se cierran solas cuando el producto vuelve a moverse o se queda sin stock.
      </div>

      {/* ═══ 2. ACCIONES ═══ */}
      {porAccion.length > 0 && (
        <Panel titulo="Qué hacer con ese capital" sub="clic para ver los productos de cada acción">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 7 }}>
            {porAccion.map(([acc, x]) => (
              <button key={acc} onClick={() => { setFAccion(fAccion === acc ? 'TODAS' : acc); setFVista('TODOS') }}
                style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer', padding: '8px 10px', borderRadius: 4, color: INK,
                         border: `1px solid ${fAccion === acc ? NAVY : LINE}`, background: fAccion === acc ? NAVY + '0D' : '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <b style={{ fontSize: 12 }}>{acc}</b>
                  <b style={{ fontSize: 12, color: NAVY, whiteSpace: 'nowrap' }}>{fCLP(x.v)}</b>
                </div>
                <div style={{ fontSize: 10.8, color: SLATE, lineHeight: 1.4, marginTop: 2 }}>{fN(x.n)} productos · {ACCIONES[acc]}</div>
              </button>
            ))}
          </div>
        </Panel>
      )}

      {/* ═══ 3. DINERO POR BODEGA ═══ */}
      <Panel titulo="Dinero detenido por bodega" sub="capital a costo según cuánto tiempo lleva sin moverse">
        {bodegas.map(b => (
          <BarraApilada key={b.sucursal_id} etiqueta={b.nombre} sub={`${fN(b.skus)} productos · ${fN(b.unidades)} unid.`}
            tramos={NIVELES.map(n => ({ k: n.k, l: n.l, c: n.c, v: b['v_' + n.k.toLowerCase()] }))} fmtV={fCLP} />
        ))}
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table style={{ width: '100%', fontSize: 11.8, borderCollapse: 'collapse', minWidth: 700 }}>
            <thead>
              <tr>{['Bodega', 'Inventario', 'Detenido', 'Lento', 'Sobre objetivo', 'Transferible', '% que no trabaja'].map((h, i) => (
                <th key={h} style={{ padding: '5px 8px', textAlign: i ? 'right' : 'left', fontSize: 10.2, color: SLATE,
                  fontWeight: 700, textTransform: 'uppercase', borderBottom: `1px solid ${LINE}` }}>{h}</th>))}</tr>
            </thead>
            <tbody>
              {bodegas.map(b => {
                const det = detenido(b)
                const pct = 100 * (det + (+b.v_lento || 0) + (+b.v_exceso || 0)) / Math.max(+b.valor_total, 1)
                return (
                  <tr key={b.sucursal_id} style={{ borderBottom: `1px solid ${LINE}` }}>
                    <td style={{ padding: '5px 8px', fontWeight: 700 }}>{b.nombre}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right' }}>{fmt(b.valor_total)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: det > 0 ? ROJO : SLATE, fontWeight: 700 }}>{fmt(det)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: AMBAR }}>{fmt(b.v_lento)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: MORADO }}>{fmt(b.v_exceso)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: VERDE }}>{b.vende ? fmt(b.v_transferible) : '—'}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 700, color: pct > 35 ? ROJO : pct > 20 ? AMBAR : VERDE }}>{fD(pct, 1)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Leyenda items={NIVELES.map(n => ({ c: n.c, t: n.l, d: n.d }))}
          nota={<><b>Días sin moverse</b>: desde el último movimiento o la última llegada, lo más reciente. En salas el movimiento es la
            venta; en el CD, el despacho a salas (que el producto se venda en la red no basta si el CD no lo está despachando).
            <b> Sobre el objetivo</b>: unidades de productos que sí se mueven, por encima de lo que la bodega debería guardar —
            en salas, su cobertura objetivo más el stock de seguridad; en el CD, lo necesario para abastecer la red hasta la
            próxima llegada más un ciclo de cobertura. <b>Transferible</b>: parte de ese exceso que otra sala necesita hoy.
            <b> % que no trabaja</b> = detenido + lento + sobre objetivo: bajo 20% es sano, sobre 35% es una bodega sobrepoblada.</>} />
      </Panel>

      {/* ═══ 4. COBERTURA ═══ */}
      <Panel titulo="Cobertura de stock por bodega" sub="cuántos días de venta hay guardados, y cómo se reparte ese capital">
        {bodegas.map(b => (
          <BarraApilada key={b.sucursal_id} etiqueta={b.nombre} ancho={140} fmtV={fCLP}
            sub={b.cobertura_dias ? `${fN(b.cobertura_dias)} días · ${fD(b.cobertura_dias / 7, 1)} semanas` : 'sin venta'}
            tramos={TRAMOS_COB.map(t => ({ k: t.k, l: t.l, c: t.c, v: b[t.k] }))} />
        ))}
        <Leyenda items={TRAMOS_COB.map(t => ({ c: t.c, t: t.l, d: t.d }))}
          nota={<>El número bajo cada bodega son los <b>días de venta que cubre su stock</b>: valor del inventario dividido por el costo
            de lo que se vende cada día (no un promedio simple, que distorsionan los productos que casi no se venden). En salas se
            mide contra su propia venta; en el <b>CD, contra la venta de toda la red</b>. Las barras reparten el capital según la
            cobertura de cada producto.</>} />
      </Panel>

      {/* ═══ 5. CAPACIDAD ═══ */}
      <Panel titulo="Capacidad de bodega" sub="cada posición física comparada con lo que su producto debería guardar"
        accion={<span style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {ORDEN_BODEGA.filter(id => idsVisibles.includes(id)).map(id => (
            <Boton key={id} onClick={() => setBodegaCap(id)} activo={bodegaCap === id} tono="primario">{nombreSuc(id)}</Boton>
          ))}
        </span>}>
        {resCap?.plano_cargado ? (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 10 }}>
              <Kpi label="Capacidad ociosa" valor={fN(resCap.pct_ociosa) + '%'} color={MORADO} alerta={+resCap.pct_ociosa > 25}
                   sub={`de ${fN(resCap.capacidad_plano)} unid. del plano, incluye ${fN(resCap.posiciones_libres)} posiciones nunca asignadas`} />
              <Kpi label="Posiciones en quiebre" valor={fN(resCap.pos_en_quiebre)} color={ROJO} alerta={+resCap.pos_en_quiebre > 0}
                   sub={`vacías porque se acabó: ${fmt(resCap.venta_perdida_quiebre)} de venta perdida en 84 días`} />
              <Kpi label="Mal dimensionadas" valor={fN(posMalDim)} color={AZUL}
                   sub={`${fN(resCap.pos_sobredimensionada)} sobran · ${fN(resCap.pos_subdimensionada)} chicas (faltan ${fN(resCap.capacidad_faltante)} unid.)`} />
              <Kpi label="Desbordadas" valor={fN(resCap.pos_desbordada)} color="#8E1B10"
                   sub={`${fN(resCap.unid_desbordadas)} unidades fuera de su posición`} />
              <Kpi label="Productos sin posición" valor={fN(resCap.skus_sin_posicion)} color={AMBAR} alerta={+resCap.skus_sin_posicion_que_venden > 0}
                   sub={`${fN(resCap.skus_sin_posicion_que_venden)} se venden · ${fCLP(resCap.valor_sin_posicion)} fuera del plano`} />
            </div>
            <BarraApilada etiqueta="Posiciones" sub="según su uso" ancho={90} fmtV={fN}
              tramos={[...USOS.map(u => ({ k: u.k, l: u.k, c: u.c, v: {
                  'BIEN USADA': resCap.pos_bien_usada, 'SOBREDIMENSIONADA': resCap.pos_sobredimensionada,
                  'SUBDIMENSIONADA': resCap.pos_subdimensionada, 'DESBORDADA': resCap.pos_desbordada, 'LENTO': resCap.pos_lento,
                  'INMOVILIZADO': resCap.pos_inmovilizado, 'EN QUIEBRE': resCap.pos_en_quiebre, 'VACÍA': resCap.pos_vacia,
                  'SIN CAPACIDAD': resCap.pos_sin_capacidad }[u.k] })),
                { k: 'LIBRE', l: 'Nunca asignada', c: '#D4D4D8', v: resCap.posiciones_libres }]} />
            <div style={{ fontSize: 11.8, color: INK, margin: '8px 0 10px', lineHeight: 1.55 }}>
              {posSinProducto > 0 && +resCap.skus_sin_posicion_que_venden > 0 && <>
                Hay <b>{fN(posSinProducto)} posiciones sin producto</b> ({fN(resCap.posiciones_libres)} nunca asignadas y {fN(resCap.pos_vacia)} de
                productos sin stock ni demanda) y, a la vez, <b>{fN(resCap.skus_sin_posicion_que_venden)} productos que se venden sin posición</b>.
                Antes de pensar en más espacio, conviene reasignar el que existe. </>}
              {+resCap.pos_en_quiebre > 0 && <>Las <b>{fN(resCap.pos_en_quiebre)} posiciones en quiebre no se tocan</b>: se reponen.</>}
            </div>
            <Tabla cols={colsPos} filas={posAccion} ordenInicial={{ col: 'capacidad_ociosa', dir: 'desc' }}
                   nombreExport={`posiciones_${bodegaCap}`} tope={60} onFila={f => onProducto(f.sku)} />
            <Leyenda items={[...USOS.map(u => ({ c: u.c, t: u.k, d: u.d })), { c: '#D4D4D8', t: 'Nunca asignada', d: 'Posición del plano sin producto asignado.' }]}
              nota={<>Medido posición por posición contra el stock real de BSALE. Cada producto tiene un <b>mínimo</b> que su posición debería
                poder guardar ({cfg.dias_reposicion_sala} días de venta + stock de seguridad, un ciclo de reposición desde el CD) y un <b>máximo</b>
                (su cobertura objetivo + seguridad). <b>Capacidad ociosa</b> = posiciones sin producto ni demanda + espacio ocupado por
                productos detenidos + lo que sobra en las sobredimensionadas. El plano se mantiene en Logística → Layout.</>} />
          </>
        ) : (
          <div>
            <div style={{ padding: '10px 12px', background: AMBAR + '10', border: `1px solid ${AMBAR}40`, borderRadius: 4,
                          fontSize: 12, color: INK, lineHeight: 1.5, marginBottom: 10 }}>
              <b>{nombreSuc(bodegaCap)} no tiene su plano de bodega cargado</b>
              {resCap ? ` (${fN(resCap.posiciones_plano)} posiciones registradas)` : ''}: la capacidad física no se puede medir.
              Lo que sí se sabe es cuánto stock ocupa espacio sin necesitarlo.
            </div>
            {capBod && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                <Kpi label="Unidades sobre el objetivo" valor={fN(capBod.u_exceso)} color={MORADO}
                     sub={`${fCLP(capBod.v_exceso)} de productos que sí se mueven`} />
                <Kpi label="Unidades detenidas" valor={fN(capBod.u_detenidas)} color={ROJO}
                     sub={`más de ${cfg.dias_lento} días sin moverse`} />
                <Kpi label="Unidades guardadas" valor={fN(capBod.unidades)} color={NAVY} sub={`${fN(capBod.skus)} productos`} />
              </div>
            )}
            <Leyenda nota={<>No se muestra un porcentaje de espacio ocioso porque sería engañoso: sin el plano no se sabe cuánto ocupa
              cada unidad (una puerta no ocupa lo que una cerradura). Al cargar el plano en Logística → Layout, esta sección
              muestra el mismo análisis posición por posición que La Granja.</>} />
          </div>
        )}
      </Panel>

      {/* ═══ 6. DETALLE ═══ */}
      <Panel titulo="Productos que requieren decisión" sub={`${fN(filas.length)} productos · ${fmt(suma(filas, 'valor_costo'))}`}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 8 }}>
          <select value={fBodega} onChange={e => setFBodega(e.target.value)} style={inputEstilo} disabled={!!scope}>
            <option value="TODAS">Todas las bodegas</option>
            {ORDEN_BODEGA.map(id => <option key={id} value={id}>{nombreSuc(id)}</option>)}
          </select>
          <select value={fVista} onChange={e => setFVista(e.target.value)} style={inputEstilo}>
            <option value="ALERTAS">Alertas vigentes</option>
            <option value="DETENIDOS">Detenidos (+{cfg.dias_lento} días)</option>
            <option value="TODOS">Todos los que no están activos</option>
            {NIVELES.filter(n => n.k !== 'ACTIVO').map(n => <option key={n.k} value={n.k}>{n.l}</option>)}
          </select>
          <select value={fAccion} onChange={e => setFAccion(e.target.value)} style={inputEstilo}>
            <option value="TODAS">Todas las acciones</option>
            {Object.keys(ACCIONES).map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Buscar SKU o producto"
                 style={{ ...inputEstilo, minWidth: 180, flex: '1 1 180px' }} />
        </div>

        {msg && <div style={{ fontSize: 11.8, color: msg.startsWith('No se') ? ROJO : VERDE, marginBottom: 8 }}>{msg}</div>}
        {gestion && (
          <div style={{ border: `1px solid ${NAVY}40`, background: NAVY + '08', borderRadius: 4, padding: '9px 11px', marginBottom: 9 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: INK, marginBottom: 5 }}>
              Gestionar alerta · {gestion.sku} <span style={{ fontWeight: 400, color: SLATE }}>{gestion.producto}</span>
            </div>
            <textarea value={gestion.nota} onChange={e => setGestion({ ...gestion, nota: e.target.value })} rows={2}
              placeholder="Qué se decidió: transferir a…, liquidar en…, rebajar a $…, responsable y fecha"
              style={{ ...inputEstilo, width: '100%', resize: 'vertical', marginBottom: 6 }} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Boton onClick={() => guardarGestion('en_gestion')} tono="primario" activo>{guardando ? 'Guardando…' : 'Marcar en gestión'}</Boton>
              <Boton onClick={() => guardarGestion('resuelta')}>Cerrar alerta</Boton>
              <Boton onClick={() => setGestion(null)}>Cancelar</Boton>
            </div>
          </div>
        )}

        <Tabla cols={cols} filas={filas} onFila={f => onProducto(f.sku)}
               ordenInicial={{ col: 'valor_costo', dir: 'desc' }} nombreExport="capital_detenido" />
        <Leyenda items={[
            ...Object.entries(ACCIONES).map(([t, d]) => ({ t, d })),
            ...Object.values(ESTADOS_ALERTA).map(e => ({ c: e.c, t: 'Alerta ' + e.l.toLowerCase() })),
          ]}
          nota={<>"≥" indica un mínimo: no hay ningún movimiento registrado desde que existe historia (ventas desde enero 2025,
            inventario desde junio 2026), así que lleva al menos esos días quieto. Las alertas se cierran solas cuando el producto
            vuelve a moverse o se queda sin stock; "Cerrar alerta" es para cuando se decidió no actuar. Clic en una fila abre la ficha.</>} />
      </Panel>
    </div>
  )
}
