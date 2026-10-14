/* InvResumen.jsx — Panel general: qué está pasando y dónde mirar primero */

import { useMemo } from 'react'
import { Panel, KpiStrip, KpiCelda, Enlace, Ex, Leyenda, fmt, fN, fD, fCLP, fPct,
         NAVY, INK, SLATE, BORDE, ROJO, VERDE, AMBAR, AZUL, MORADO } from './invUI'
import { resumenBase, ACCIONES, nombreSuc, SUCURSALES } from './invData'
import { tablaExcel, tablaPdf } from './invReportes'

const REF_ROTACION = 4.5   // Home Depot, 2T 2026

function Hallazgo({ c, t, d, accion, onClick }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderLeft: `3px solid ${c}`, borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{t}</div>
      <div style={{ fontSize: 11.5, color: SLATE, lineHeight: 1.5, flex: 1 }}>{d}</div>
      {onClick && <div style={{ fontSize: 11.5 }}><Enlace onClick={onClick}>{accion} ›</Enlace></div>}
    </div>
  )
}

export function InvResumen({ base, capital, scorecard, movimientos, cfg, scope, irABase, ir }) {
  const r = useMemo(() => resumenBase(base, scope), [base, scope])
  const bf = useMemo(() => scope ? base.filter(x => x.sucursal_id === scope) : base, [base, scope])
  const red = useMemo(() => scorecard.find(s => s.sucursal_id === (scope || 'red')) || {}, [scorecard, scope])
  const det = capital.reduce((a, b) => a + (+b.v_inmovilizado || 0) + (+b.v_muerto || 0), 0)
  const lento = capital.reduce((a, b) => a + (+b.v_lento || 0), 0)
  const exceso = capital.reduce((a, b) => a + (+b.v_exceso || 0), 0)
  const abiertas = capital.reduce((a, b) => a + (+b.alertas_abiertas || 0), 0)
  const entreSalas = movimientos.filter(m => m.tipo === 'Entre salas' && (!scope || [m.origen, m.destino].includes(scope)))
  const recuperable = entreSalas.reduce((a, m) => a + (+m.venta_recuperable || 0), 0)

  /* Hallazgos: lo que un gerente debería leer antes que cualquier tabla */
  const hallazgos = useMemo(() => {
    const h = []
    if (r.perdidaConCd > 0) h.push({ c: ROJO, t: 'Se pierde venta teniendo el producto en el CD',
      d: `${fmt(r.perdidaConCd)} de venta perdida en 84 días en ${fN(r.nQuiebreConCd)} productos que la sala no tenía pero el CD sí. Se resuelve despachando, sin comprar.`,
      accion: 'Ver esos productos', onClick: () => irABase('productos', { quiebreConCd: true }, 'En quiebre en sala, con stock en el CD') })
    if (abiertas > 0) h.push({ c: '#D1442F', t: `${fN(abiertas)} alertas de inmovilizado sin gestionar`,
      d: `Productos que cruzaron los ${cfg.dias_lento} días sin moverse y nadie ha tomado. ${fmt(det)} de capital detenido en total.`,
      accion: 'Gestionar alertas', onClick: () => irABase('productos', { alerta_estado: ['abierta'] }, 'Alertas sin gestionar') })
    const salas = scorecard.filter(s => s.rol === 'sala' && (!scope || s.sucursal_id === scope))
    const peor = salas.filter(s => s.instock_clave_hoy != null).sort((a, b) => a.instock_clave_hoy - b.instock_clave_hoy)[0]
    if (peor && peor.instock_clave_hoy < 95) h.push({ c: AMBAR, t: `${peor.nombre}: faltan productos clave`,
      d: `De los ${fN(peor.skus_clave)} productos que hacen el 80% de su venta, ${fPct(100 - peor.instock_clave_hoy)} no tiene stock hoy. La referencia es sobre 95%.`,
      accion: 'Ver los quiebres', onClick: () => irABase('productos', { sucursal_id: [peor.sucursal_id], estado: ['QUIEBRE', 'CRITICO'] }, `${peor.nombre}: en quiebre o bajo seguridad`) })
    if (+red.rotacion > 0 && +red.rotacion < REF_ROTACION && !scope) h.push({ c: AZUL, t: `La red rota ${fD(red.rotacion)}x al año; Home Depot, ${fD(REF_ROTACION, 1)}x`,
      d: `Con la misma venta, rotar como Home Depot requeriría ${fCLP(+red.valor * red.rotacion / REF_ROTACION)} de inventario en vez de ${fCLP(red.valor)}.`,
      accion: 'Ver el comparativo', onClick: () => ir('comparativo') })
    const caida = salas.filter(s => s.crec_28d_pct != null).sort((a, b) => a.crec_28d_pct - b.crec_28d_pct)[0]
    if (caida && caida.crec_28d_pct < -10) h.push({ c: ROJO, t: `${caida.nombre}: venta ${fPct(caida.crec_28d_pct)} en 28 días`,
      d: 'Contra los 28 días anteriores. El comparativo muestra también la variación contra el mismo período del año pasado.',
      accion: 'Ver el comparativo', onClick: () => ir('comparativo') })
    if (recuperable > 0) h.push({ c: VERDE, t: 'Venta recuperable sin comprar nada',
      d: `Mover stock entre salas recupera ${fmt(recuperable)} de venta con inventario que ya existe.`,
      accion: 'Ver los movimientos', onClick: () => irABase('movimientos', { tipo: ['Entre salas'] }, 'Transferencias entre salas') })
    return h
  }, [r, abiertas, det, scorecard, red, recuperable, scope, cfg, irABase, ir])

  /* Cuadro por bodega: cada cifra lleva a su detalle */
  const filasBodega = useMemo(() => SUCURSALES.filter(s => !scope || s.id === scope).map(s => {
    const c = capital.find(x => x.sucursal_id === s.id) || {}
    const filas = base.filter(x => x.sucursal_id === s.id)
    return {
      id: s.id, nombre: s.nombre, vende: s.vende, valor: +c.valor_total || 0,
      detenido: (+c.v_inmovilizado || 0) + (+c.v_muerto || 0), lento: +c.v_lento || 0, exceso: +c.v_exceso || 0,
      perdida: filas.reduce((a, x) => a + (+x.venta_perdida_84d || 0), 0), cobertura: c.cobertura_dias,
      alertas: (+c.alertas_abiertas || 0) + (+c.alertas_en_gestion || 0),
    }
  }), [capital, base, scope])

  const colsBodega = [
    { k: 'nombre', l: 'Bodega' }, { k: 'valor', l: 'Inventario', num: true }, { k: 'detenido', l: 'Detenido', num: true },
    { k: 'lento', l: 'Lento', num: true }, { k: 'exceso', l: 'Sobre objetivo', num: true }, { k: 'perdida', l: 'Venta perdida 84d', num: true },
    { k: 'cobertura', l: 'Cobertura (días)', num: true }, { k: 'alertas', l: 'Alertas vigentes', num: true },
  ]
  const celda = (txt, onClick, color = INK) => (
    <td style={{ padding: '7px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
      {onClick ? <Enlace onClick={onClick} color={color}>{txt}</Enlace> : <span style={{ color }}>{txt}</span>}
    </td>
  )

  const acciones = useMemo(() => {
    const m = {}
    for (const x of bf) if (x.accion) { m[x.accion] = m[x.accion] || { n: 0, v: 0 }; m[x.accion].n++; m[x.accion].v += +x.valor_costo || 0 }
    return Object.entries(m).sort((a, b) => b[1].v - a[1].v)
  }, [bf])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <KpiStrip>
        <KpiCelda l="Inventario" v={fmt(r.valor)} sub={scope ? nombreSuc(scope) : 'red completa, a costo'} color={NAVY}
                  onClick={() => irABase('productos', { conStock: true }, 'Todo el inventario con stock')} />
        <KpiCelda l="Venta perdida 84d" v={fmt(r.ventaPerdida)} sub="por días sin stock" color={ROJO}
                  onClick={() => irABase('productos', { perdida: true }, 'Productos con venta perdida por quiebre')} />
        <KpiCelda l="En quiebre o crítico" v={fN(r.nQuiebre + r.nCritico)} sub={`${fPct(r.pctQuiebre)} de días sin stock`} color={ROJO}
                  onClick={() => irABase('productos', { estado: ['QUIEBRE', 'CRITICO'] }, 'Productos en quiebre o bajo el stock de seguridad')} />
        <KpiCelda l="Capital detenido" v={fmt(det)} sub={`+${cfg.dias_lento} días sin moverse`} color="#D1442F"
                  onClick={() => irABase('productos', { detenido: true }, `Productos con más de ${cfg.dias_lento} días sin moverse`)} />
        <KpiCelda l="Lento" v={fmt(lento)} sub={`${cfg.dias_activo + 1}–${cfg.dias_lento} días`} color={AMBAR}
                  onClick={() => irABase('productos', { nivel: ['LENTO'] }, 'Productos poniéndose lentos')} />
        <KpiCelda l="Sobre el objetivo" v={fmt(exceso)} sub="stock de más en lo que sí se mueve" color={MORADO}
                  onClick={() => irABase('productos', { exceso: true }, 'Productos con stock sobre el objetivo')} />
        <KpiCelda l="Rotación anual" v={red.rotacion != null ? fD(red.rotacion) + 'x' : '—'} sub={`Home Depot ${fD(REF_ROTACION, 1)}x`}
                  color={+red.rotacion >= REF_ROTACION ? VERDE : AMBAR} onClick={() => ir('comparativo')} title="Ver el comparativo por sala" />
        <KpiCelda l="GMROI" v={red.gmroi != null ? fD(red.gmroi) : '—'} sub="margen por peso invertido"
                  color={+red.gmroi >= 1 ? VERDE : ROJO} onClick={() => ir('comparativo')} title="Ver el comparativo por sala" />
      </KpiStrip>

      {hallazgos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10 }}>
          {hallazgos.map(h => <Hallazgo key={h.t} {...h} />)}
        </div>
      )}

      <Panel titulo="Situación por bodega" sub="clic en cualquier cifra para ver los productos que la componen"
        acciones={<Ex onExcel={() => tablaExcel(filasBodega, colsBodega, 'inventario_por_bodega')}
                      onPdf={() => tablaPdf({ titulo: 'Inventario · situación por bodega', filas: filasBodega, cols: colsBodega, nombre: 'inventario_por_bodega' })} />}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead><tr>{colsBodega.map((c, i) => (
              <th key={c.k} style={{ padding: '6px 10px', textAlign: i ? 'right' : 'left', fontSize: 10, fontWeight: 700, color: SLATE,
                                     textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: `1px solid ${BORDE}` }}>{c.l}</th>))}</tr></thead>
            <tbody>{filasBodega.map(f => (
              <tr key={f.id} className="inv-fila" style={{ borderBottom: `1px solid ${BORDE}` }}>
                <td style={{ padding: '7px 10px', fontWeight: 700, color: INK }}>{f.nombre}<span style={{ fontWeight: 400, color: SLATE, fontSize: 11 }}>{f.vende ? '' : ' · centro de distribución'}</span></td>
                {celda(fmt(f.valor), () => irABase('productos', { sucursal_id: [f.id], conStock: true }, `${f.nombre}: todo el inventario`), NAVY)}
                {celda(fmt(f.detenido), f.detenido > 0 && (() => irABase('productos', { sucursal_id: [f.id], detenido: true }, `${f.nombre}: capital detenido`)), f.detenido > 0 ? ROJO : SLATE)}
                {celda(fmt(f.lento), f.lento > 0 && (() => irABase('productos', { sucursal_id: [f.id], nivel: ['LENTO'] }, `${f.nombre}: productos lentos`)), AMBAR)}
                {celda(fmt(f.exceso), f.exceso > 0 && (() => irABase('productos', { sucursal_id: [f.id], exceso: true }, `${f.nombre}: sobre el objetivo`)), MORADO)}
                {celda(f.vende ? fmt(f.perdida) : '—', f.vende && f.perdida > 0 && (() => irABase('productos', { sucursal_id: [f.id], perdida: true }, `${f.nombre}: venta perdida`)), ROJO)}
                {celda(f.cobertura ? `${fN(f.cobertura)} d` : '—', null, INK)}
                {celda(fN(f.alertas), f.alertas > 0 && (() => irABase('productos', { sucursal_id: [f.id], alertaVigente: true }, `${f.nombre}: alertas vigentes`)), f.alertas ? ROJO : SLATE)}
              </tr>))}</tbody>
          </table>
        </div>
        <Leyenda items={[
          { c: '#D1442F', t: 'Detenido', d: `más de ${cfg.dias_lento} días sin moverse (venta en sala, despacho en el CD).` },
          { c: AMBAR, t: 'Lento', d: `entre ${cfg.dias_activo + 1} y ${cfg.dias_lento} días sin moverse.` },
          { c: MORADO, t: 'Sobre el objetivo', d: 'unidades de más en productos que sí se mueven.' },
          { c: NAVY, t: 'Cobertura', d: 'días de venta que cubre el stock (en el CD, de toda la red).' },
        ]} />
      </Panel>

      {acciones.length > 0 && (
        <Panel titulo="Qué hacer con el capital que no trabaja" sub="productos lentos o detenidos, agrupados por la acción sugerida">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8 }}>
            {acciones.map(([acc, x]) => (
              <button key={acc} className="inv-clic" onClick={() => irABase('productos', { accion: [acc] }, acc)}
                style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer', padding: '9px 11px', borderRadius: 8, color: INK,
                         border: `1px solid ${BORDE}`, background: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <b style={{ fontSize: 12.5 }}>{acc}</b><b style={{ fontSize: 12.5, color: NAVY, whiteSpace: 'nowrap' }}>{fCLP(x.v)} ›</b>
                </div>
                <div style={{ fontSize: 11, color: SLATE, lineHeight: 1.45, marginTop: 3 }}>{fN(x.n)} productos · {ACCIONES[acc]}</div>
              </button>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}
