/* ════════════════════════════════════════════════════════════════════
   InvProducto.jsx — ficha de un producto (panel lateral)
   · Cómo se compone su venta promedio: método, ventana, unidades, días con stock
   · Historia de 12 meses y proyección a 3 meses; proyección del stock
   · Situación en cada bodega y gestión de sus alertas
   · Informe PDF del producto con todo lo anterior
   ════════════════════════════════════════════════════════════════════ */

import { useState, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { Panel, KpiStrip, KpiCelda, Tag, Boton, Enlace, Cargando, ErrorBox, Aviso, inputEstilo,
         fmt, fN, fD, INK, SLATE, BORDE, PAPER, NAVY, ROJO, VERDE, AMBAR } from './invUI'
import { fetchProducto, fetchSerieMensual, gestionarAlerta, nombreSuc, CL_ESTADO, CL_NIVEL, NOMBRE_NIVEL, CL_PATRON, AYUDA_PATRON,
         ACCIONES, ESTADOS_ALERTA, SUCURSALES } from './invData'
import { METODOS, DIAS_MES, SALAS_IDS, composicion, explicar, contrasteHistorico, armarSerie, proyectarMeses, proyeccionStock, agregarRed, fechaCorta } from './invProyeccion'
import { GraficoVenta, GraficoStock, LeyendaGraficos } from './invGraficos'
import { pdfProductos } from './invPdfProducto'

const th = al => ({ padding: '6px 8px', textAlign: al, fontSize: 9.5, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.4, background: PAPER, borderBottom: `1px solid ${BORDE}`, whiteSpace: 'nowrap' })
const td = (al = 'left') => ({ padding: '6px 8px', textAlign: al, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' })

export function InvProducto({ sku, usuario, onCambio, irABase }) {
  const [datos, setDatos] = useState(null), [serie, setSerie] = useState([]), [err, setErr] = useState('')
  const [ambito, setAmbito] = useState('red')
  const [gestion, setGestion] = useState(null), [guardando, setGuardando] = useState(false)
  const cargar = () => Promise.all([fetchProducto(sku), fetchSerieMensual([sku])])
    .then(([d, s]) => { setDatos(d); setSerie(s) }).catch(e => setErr(e.message))
  useEffect(() => { setDatos(null); setErr(''); setGestion(null); setAmbito('red'); cargar() }, [sku]) // eslint-disable-line react-hooks/exhaustive-deps

  const r = useMemo(() => {
    if (!datos) return null
    const p = [...datos.posicion].sort((a, b) => SUCURSALES.findIndex(s => s.id === a.sucursal_id) - SUCURSALES.findIndex(s => s.id === b.sucursal_id))
    const salas = p.filter(x => x.vende)
    const s = (fs, k) => fs.reduce((a, x) => a + (+x[k] || 0), 0)
    return {
      p, salas, f0: p[0] || {}, diariaRed: s(salas, 'demanda_dia'),
      patron: [...salas].sort((a, b) => (+b.venta_84d || 0) - (+a.venta_84d || 0))[0]?.patron,
      stock: s(p, 'stock'), enSalas: s(salas, 'stock'), cd: s(p.filter(x => !x.vende), 'stock'),
      venta12: s(salas, 'venta_364d'), neto12: s(salas, 'neto_364d'), perdida: s(salas, 'venta_perdida_84d'),
      alertas: p.filter(x => x.alerta_id && x.alerta_estado !== 'resuelta'),
    }
  }, [datos])

  /* Ámbito elegido: la red (suma de salas) o una sala */
  const vista = useMemo(() => {
    if (!r) return null
    const esRed = ambito === 'red'
    const fila = esRed ? null : r.salas.find(x => x.sucursal_id === ambito)
    const diaria = esRed ? r.diariaRed : +fila?.demanda_dia || 0
    const base = esRed ? agregarRed(r.p) : fila
    const serieMes = armarSerie(serie, esRed ? SALAS_IDS : [ambito])
    return {
      esRed, fila, diaria, contraste: contrasteHistorico(serieMes, diaria),
      serie: serieMes,
      proy: proyectarMeses(diaria, 3),
      stock: proyeccionStock({ disponible: base?.disponible, diaria, puntoReorden: base?.punto_reorden, seguridad: base?.safety_stock }),
      transito: +base?.transito || 0,
    }
  }, [r, serie, ambito])

  const guardar = async estado => {
    setGuardando(true)
    try {
      await gestionarAlerta(gestion.id, estado, gestion.nota, usuario)
      toast.success(estado === 'resuelta' ? 'Alerta cerrada' : 'Alerta marcada en gestión')
      setGestion(null); await cargar(); onCambio?.()
    } catch (e) { toast.error('No se pudo guardar: ' + e.message) }
    setGuardando(false)
  }
  const pdf = () => {
    try { pdfProductos({ items: [{ sku, filas: r.p, serie, ambito }], sub: `${sku} · ${ambito === 'red' ? 'red completa' : nombreSuc(ambito)}`, archivo: `producto_${sku}` }) }
    catch (e) { toast.error('No se pudo generar el PDF: ' + e.message) }
  }

  if (err) return <ErrorBox>{err}</ErrorBox>
  if (!r || !vista) return <Cargando>Cargando ficha…</Cargando>
  const f0 = r.f0

  return (
    <>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>{f0.producto || sku}</div>
        <div style={{ fontSize: 11.5, color: SLATE }}>{sku} · Categoría {f0.tipo_producto} · Familia {f0.familia}{f0.clase ? ` · Clase ${f0.clase}` : ''}</div>
        <div style={{ fontSize: 11.5, marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Enlace onClick={() => irABase('productos', { q: sku }, `Producto ${sku} en todas las bodegas`)}>Ver en la base de datos ›</Enlace>
          <Enlace onClick={() => irABase('movimientos', { q: sku }, `Movimientos sugeridos de ${sku}`)}>Ver movimientos sugeridos ›</Enlace>
          {f0.tipo_producto && <Enlace onClick={() => irABase('productos', { tipo_producto: [f0.tipo_producto] }, `Categoría ${f0.tipo_producto}`)}>Ver su categoría ›</Enlace>}
        </div>
      </div>

      <KpiStrip>
        <KpiCelda l="Stock red" v={fN(r.stock)} sub={`${fN(r.enSalas)} salas · ${fN(r.cd)} CD`} color={NAVY} />
        <KpiCelda l="Venta promedio red" v={fD(r.diariaRed) + ' /día'} sub={`${fD(r.diariaRed * DIAS_MES, 1)} al mes`} color={VERDE} />
        <KpiCelda l="Venta 12 meses" v={fN(r.venta12) + ' u'} sub={fmt(r.neto12)} />
        <KpiCelda l="Venta perdida 84d" v={fmt(r.perdida)} color={r.perdida > 0 ? ROJO : SLATE} />
        {r.patron && <KpiCelda l="Patrón de demanda" v={r.patron.toLowerCase().replace('_', ' ')} color={CL_PATRON[r.patron]} title={AYUDA_PATRON[r.patron]} />}
      </KpiStrip>

      {r.alertas.length > 0 && (
        <Panel titulo="Alertas de este producto" sub="registra qué se decidió para que el equipo no lo vuelva a revisar">
          {r.alertas.map(a => (
            <div key={a.alerta_id} style={{ border: `1px solid ${BORDE}`, borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 12.5 }}>{nombreSuc(a.sucursal_id)}</b>
                <Tag texto={NOMBRE_NIVEL[a.nivel]} color={CL_NIVEL[a.nivel]} />
                <Tag texto={ESTADOS_ALERTA[a.alerta_estado].l} color={ESTADOS_ALERTA[a.alerta_estado].c} />
                <span style={{ fontSize: 11, color: SLATE }}>{a.dias_es_minimo ? '≥ ' : ''}{fN(a.dias_inmovil)} días · {fmt(a.valor_costo)}</span>
                <span style={{ flex: 1 }} />
                {gestion?.id !== a.alerta_id && <Boton onClick={() => setGestion({ id: a.alerta_id, nota: a.alerta_nota || '' })} tono="primario">Gestionar</Boton>}
              </div>
              {a.accion && <div style={{ fontSize: 11.5, color: INK, marginTop: 4 }}>Sugerido: <b>{a.accion}</b>{a.sala_destino ? ` → ${nombreSuc(a.sala_destino)}` : ''} <span style={{ color: SLATE }}>· {ACCIONES[a.accion]}</span></div>}
              {a.alerta_nota && gestion?.id !== a.alerta_id && <div style={{ fontSize: 11.5, color: SLATE, marginTop: 3 }}>Nota: {a.alerta_nota}</div>}
              {gestion?.id === a.alerta_id && (
                <div style={{ marginTop: 6 }}>
                  <textarea value={gestion.nota} onChange={e => setGestion({ ...gestion, nota: e.target.value })} rows={2}
                    placeholder="Qué se decidió: transferir a…, liquidar en…, rebajar a $…, responsable y fecha"
                    style={{ ...inputEstilo, width: '100%', resize: 'vertical', marginBottom: 6 }} />
                  <span style={{ display: 'inline-flex', gap: 6 }}>
                    <Boton onClick={() => guardar('en_gestion')} tono="primario" activo disabled={guardando}>Marcar en gestión</Boton>
                    <Boton onClick={() => guardar('resuelta')} disabled={guardando}>Cerrar alerta</Boton>
                    <Boton onClick={() => setGestion(null)}>Cancelar</Boton>
                  </span>
                </div>
              )}
            </div>
          ))}
        </Panel>
      )}

      <Panel titulo="Venta promedio: cómo se calcula" sub="con las cifras reales de este producto"
        acciones={<span style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap' }}>
          <Boton onClick={() => setAmbito('red')} activo={ambito === 'red'} tono="primario">Red</Boton>
          {r.salas.map(x => <Boton key={x.sucursal_id} onClick={() => setAmbito(x.sucursal_id)} activo={ambito === x.sucursal_id} tono="primario">{nombreSuc(x.sucursal_id)}</Boton>)}
          <Boton onClick={pdf} title="Informe PDF de este producto: composición, meses usados y proyección">PDF</Boton>
        </span>}>
        <div style={{ fontSize: 12.5, color: INK, lineHeight: 1.55, padding: '8px 11px', background: PAPER, borderLeft: `3px solid ${VERDE}`, borderRadius: 4, marginBottom: 10 }}>
          {vista.esRed
            ? <>La venta promedio de la red es la suma de la de cada sala: {r.salas.map((x, i) => <span key={x.sucursal_id}>{i ? ' + ' : ''}{nombreSuc(x.sucursal_id)} <b>{fD(x.demanda_dia)}</b></span>)} = <b>{fD(vista.diaria)} unidades por día</b> ({fD(vista.diaria * DIAS_MES, 1)} al mes). Cada sala se calcula por separado, con su propia disponibilidad:</>
            : explicar(composicion(vista.fila), v => fD(v))}
        </div>
        {vista.contraste && <div style={{ marginBottom: 10 }}><Aviso>{vista.contraste.texto}</Aviso></div>}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{['Sala', 'Método', 'Ventana (días completos)', 'Unidades', 'Días con stock', 'Prom. diaria', 'Prom. mensual', 'Sin corregir'].map((h, i) =>
              <th key={h} style={th(i >= 3 ? 'right' : 'left')}>{h}</th>)}</tr></thead>
            <tbody>{r.salas.map(x => {
              const c = composicion(x)
              return (
                <tr key={x.sucursal_id} style={{ borderBottom: `1px solid ${BORDE}`, background: ambito === x.sucursal_id ? '#F7F8FB' : '#fff' }}>
                  <td style={{ ...td(), fontWeight: 700 }}>{nombreSuc(x.sucursal_id)}</td>
                  <td style={td()} title={c ? METODOS[c.metodo].d : ''}>{c ? METODOS[c.metodo].corto : '—'}</td>
                  <td style={td()}>{c ? `${fechaCorta(c.desde)} al ${fechaCorta(c.hasta)}` : '—'}</td>
                  <td style={td('right')}>{c ? fN(c.unidades) : '—'}</td>
                  <td style={td('right')}>{!c ? '—' : c.metodo === 'calendario_84' ? 'calendario' : <>{c.dias} de {c.observados}{c.sinStock > 0 && <span style={{ color: AMBAR }}> · {c.sinStock} sin stock</span>}</>}</td>
                  <td style={{ ...td('right'), fontWeight: 700, color: VERDE }}>{c ? fD(c.diaria) : '—'}</td>
                  <td style={td('right')}>{c ? fD(c.mensual, 1) : '—'}</td>
                  <td style={{ ...td('right'), color: SLATE }}>{c ? fD(c.calendario) : '—'}</td>
                </tr>)
            })}</tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: SLATE, marginTop: 6, lineHeight: 1.5 }}>
          <b>Sin corregir</b>: la misma venta dividida por todos los días de la ventana, incluidos los sin stock; la diferencia es demanda que el quiebre esconde.
          El algoritmo completo está en Ayuda › Glosario y en la primera página del PDF.
        </div>
      </Panel>

      <Panel titulo={`Historia y proyección · ${vista.esRed ? 'red (suma de salas)' : nombreSuc(ambito)}`}
             sub="12 meses cerrados, el mes en curso hasta ayer y 3 meses proyectados a la venta promedio actual">
        <GraficoVenta serie={vista.serie} proyeccion={vista.proy} diaria={vista.diaria} />
        <LeyendaGraficos />
        <div style={{ fontSize: 11, color: SLATE, marginTop: 6 }}>
          La proyección multiplica la venta promedio actual por los días de cada mes; no incluye estacionalidad. El % de días con stock
          existe desde junio 2026 (antes sólo hay cierres de mes).
        </div>
      </Panel>

      <Panel titulo="Proyección del stock disponible" sub="a la venta promedio actual y sin compras nuevas">
        <div style={{ fontSize: 12.5, color: INK, marginBottom: 6, lineHeight: 1.5 }}>
          {!(vista.stock.disponible > 0)
            ? <><b style={{ color: ROJO }}>No hay stock disponible hoy{vista.esRed ? ' en las salas' : ''}: está en quiebre.</b>
                {vista.transito > 0 && <> Hay {fN(vista.transito)} unidades en tránsito.</>}
                {vista.diaria > 0 && <> A la venta promedio actual se dejan de vender cerca de <b>{fN(vista.diaria * 7)}</b> unidades por semana.</>}</>
            : vista.diaria > 0
            ? <>Hoy hay <b>{fN(vista.stock.disponible)}</b> unidades disponibles. A {fD(vista.diaria)} por día,{' '}
                {vista.stock.diasQuiebre > 365 ? <b>alcanza para más de un año</b> : <>se acaban aproximadamente el <b style={{ color: ROJO }}>{fechaCorta(vista.stock.fechaQuiebre)}</b> ({fN(vista.stock.diasQuiebre)} días)</>}
                {vista.stock.puntoReorden > 0 && <>; llega al punto de reorden {vista.stock.diasReorden === 0 ? <b style={{ color: AMBAR }}>ya</b> : <>el <b>{fechaCorta(vista.stock.fechaReorden)}</b></>}</>}.
                {vista.transito > 0 && <> Hay {fN(vista.transito)} unidades en tránsito, no incluidas por no tener fecha de llegada.</>}</>
            : 'Sin venta promedio: el stock no baja por venta.'}
        </div>
        {vista.diaria > 0 && vista.stock.disponible > 0 && <GraficoStock p={vista.stock} />}
      </Panel>

      <Panel titulo="Situación en cada bodega" sinPadding>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{['Bodega', 'Situación', 'Reposición', 'Stock', 'Cobertura', 'Venta/día', '% sin stock', 'Qué hacer'].map((h, i) =>
              <th key={h} style={th(i >= 3 && i <= 6 ? 'right' : 'left')}>{h}</th>)}</tr></thead>
            <tbody>{r.p.map(x => (
              <tr key={x.sucursal_id} style={{ borderBottom: `1px solid ${BORDE}` }}>
                <td style={{ ...td(), fontWeight: 700 }}>{nombreSuc(x.sucursal_id)}</td>
                <td style={td()}><Tag texto={NOMBRE_NIVEL[x.nivel]} color={CL_NIVEL[x.nivel]} /></td>
                <td style={td()}>{x.vende ? <Tag texto={x.estado} color={CL_ESTADO[x.estado]} /> : '—'}</td>
                <td style={td('right')}>{fN(x.stock)}</td>
                <td style={td('right')}>{x.dias_cobertura == null ? 'sin venta' : fN(x.dias_cobertura) + ' d'}</td>
                <td style={td('right')}>{x.vende ? fD(x.demanda_dia) : '—'}</td>
                <td style={{ ...td('right'), color: +x.pct_quiebre > 30 ? ROJO : INK }}>{x.vende ? fN(x.pct_quiebre) + '%' : '—'}</td>
                <td style={{ ...td(), whiteSpace: 'normal', maxWidth: 180 }}>{x.accion || (x.vende && +x.sugerido > 0 ? `Reponer ${fN(x.sugerido)} unid.` : '—')}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}
