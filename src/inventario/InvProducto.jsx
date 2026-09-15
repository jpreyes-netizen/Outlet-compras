/* Producto — ficha de un SKU: posición en cada sala y venta de 180 días. */

import { useState, useEffect, useMemo } from 'react'
import {
  Kpi, Tag, Panel, Tabla, Cargando, ErrorBox, Vacio, fmt, fN, fD,
  INK, SLATE, LINE, NAVY, ROJO, VERDE, AMBAR,
} from './invUI'
import { fetchProducto, CL_ESTADO, CL_PATRON, AYUDA_PATRON, nombreSuc } from './invData'

/* Barras semanales: con demanda intermitente el detalle diario es ruido,
   la agregación semanal es la que deja ver el patrón real. */
function Sparkline({ serie }) {
  const semanas = useMemo(() => {
    const m = new Map()
    for (const d of serie) {
      const f = new Date(d.fecha + 'T00:00:00Z')
      const lunes = new Date(f); lunes.setUTCDate(f.getUTCDate() - ((f.getUTCDay() + 6) % 7))
      const k = lunes.toISOString().slice(0, 10)
      m.set(k, (m.get(k) || 0) + (+d.qty_neta || 0))
    }
    return [...m.entries()].sort().slice(-26)
  }, [serie])

  if (!semanas.length) return <Vacio>Sin ventas en los últimos 180 días.</Vacio>
  const max = Math.max(...semanas.map(([, v]) => v), 1)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 70 }}>
        {semanas.map(([k, v]) => (
          <div key={k} title={`Semana del ${k}: ${fN(v)} unidades`}
            style={{
              flex: 1, height: `${Math.max((v / max) * 100, v > 0 ? 4 : 1)}%`,
              background: v > 0 ? NAVY : LINE, borderRadius: '2px 2px 0 0', minHeight: 1,
            }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: SLATE, marginTop: 4 }}>
        <span>{semanas[0][0]}</span>
        <span>unidades por semana</span>
        <span>{semanas[semanas.length - 1][0]}</span>
      </div>
    </div>
  )
}

export function InvProducto({ sku, onCerrar }) {
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    let vivo = true
    setCargando(true); setErr(''); setDatos(null)
    fetchProducto(sku)
      .then(d => { if (vivo) setDatos(d) })
      .catch(e => { if (vivo) setErr(e.message) })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [sku])

  const resumen = useMemo(() => {
    if (!datos) return null
    const p = datos.posicion
    const salas = p.filter(x => x.vende)
    return {
      producto: p[0]?.producto || sku,
      tipo: p[0]?.tipo_producto || '—',
      patron: salas.slice().sort((a, b) => (+b.venta_84d || 0) - (+a.venta_84d || 0))[0]?.patron,
      costo: p[0]?.costo_unit,
      stockRed: p.reduce((a, x) => a + (+x.stock || 0), 0),
      stockSalas: salas.reduce((a, x) => a + (+x.disponible || 0), 0),
      stockCd: p.filter(x => !x.vende).reduce((a, x) => a + (+x.disponible || 0), 0),
      venta364: salas.reduce((a, x) => a + (+x.venta_364d || 0), 0),
      neto364: salas.reduce((a, x) => a + (+x.neto_364d || 0), 0),
      perdida: salas.reduce((a, x) => a + (+x.venta_perdida_84d || 0), 0),
      quiebre: salas.length ? salas.reduce((a, x) => a + (+x.pct_quiebre || 0), 0) / salas.length : 0,
    }
  }, [datos, sku])

  const cols = [
    { k: 'sucursal_id', l: 'Ubicación', render: f => nombreSuc(f.sucursal_id), crudo: f => nombreSuc(f.sucursal_id) },
    { k: 'estado', l: 'Estado', render: f => <Tag texto={f.estado} color={CL_ESTADO[f.estado]} /> },
    { k: 'disponible', l: 'Disp.', num: true },
    { k: 'reservado', l: 'Reservado', num: true },
    { k: 'demanda_dia', l: 'Dem./día', num: true, render: f => fD(f.demanda_dia) },
    { k: 'sigma_dia', l: 'σ diaria', num: true, render: f => fD(f.sigma_dia) },
    { k: 'adi', l: 'ADI', num: true, render: f => f.adi == null ? '—' : fD(f.adi, 1) + ' d' },
    { k: 'safety_stock', l: 'Seguridad', num: true },
    { k: 'punto_reorden', l: 'Punto reorden', num: true },
    { k: 'dias_cobertura', l: 'Cobertura', num: true,
      render: f => f.dias_cobertura == null ? '—' : fN(f.dias_cobertura) + ' d' },
    { k: 'pct_quiebre', l: '% quiebre', num: true, render: f => fN(f.pct_quiebre) + '%' },
    { k: 'sugerido', l: 'Reponer', num: true, render: f => <b>{fN(f.sugerido)}</b> },
  ]

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 11 }}>
        <button onClick={onCerrar} style={{
          padding: '5px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          border: `1px solid ${LINE}`, borderRadius: 4, background: '#fff', color: SLATE, font: 'inherit',
        }}>← Volver</button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: INK, letterSpacing: '-.02em' }}>
            {resumen?.producto || sku}
          </div>
          <div style={{ fontSize: 11.5, color: SLATE }}>
            {sku}{resumen?.tipo ? ` · ${resumen.tipo}` : ''}
          </div>
        </div>
      </div>

      {cargando && <Cargando>Cargando ficha…</Cargando>}
      {err && <ErrorBox>{err}</ErrorBox>}

      {resumen && !cargando && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
            <Kpi label="Stock red" valor={fN(resumen.stockRed)} sub={`${fN(resumen.stockSalas)} en salas · ${fN(resumen.stockCd)} en CD`} color={NAVY} />
            <Kpi label="Costo unitario" valor={fmt(resumen.costo)} color={SLATE} />
            <Kpi label="Venta 12 meses" valor={fN(resumen.venta364) + ' u'} sub={fmt(resumen.neto364)} color={VERDE} />
            <Kpi label="Quiebre medio" valor={fN(resumen.quiebre) + '%'} sub="días sin stock, 84d" color={ROJO} alerta={resumen.quiebre > 30} />
            <Kpi label="Venta perdida 84d" valor={fmt(resumen.perdida)} color={ROJO} alerta={resumen.perdida > 0} />
            {resumen.patron && (
              <Kpi label="Patrón de demanda" valor={resumen.patron} sub={AYUDA_PATRON[resumen.patron]} color={CL_PATRON[resumen.patron]} />
            )}
          </div>

          <Panel titulo="Venta semanal" sub="últimas 26 semanas, todas las salas">
            <Sparkline serie={datos.serie} />
          </Panel>

          <Panel titulo="Posición por ubicación">
            <Tabla cols={cols} filas={datos.posicion}
                   ordenInicial={{ col: 'disponible', dir: 'desc' }} tope={20} />
          </Panel>
        </>
      )}
    </div>
  )
}
