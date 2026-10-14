/* InvProducto.jsx — ficha de un producto (se abre en el panel lateral): dónde está, cómo se vende, qué hacer y sus alertas. */

import { useState, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { Panel, KpiStrip, KpiCelda, Tag, Boton, Enlace, Cargando, ErrorBox, Vacio, inputEstilo,
         fmt, fN, fD, INK, SLATE, BORDE, PAPER, NAVY, ROJO, VERDE } from './invUI'
import { fetchProducto, gestionarAlerta, nombreSuc, CL_ESTADO, CL_NIVEL, NOMBRE_NIVEL, CL_PATRON, AYUDA_PATRON,
         ACCIONES, ESTADOS_ALERTA, SUCURSALES } from './invData'

/* Venta semanal: con demanda intermitente el detalle diario es ruido; la semana deja ver el patrón */
function VentaSemanal({ serie }) {
  const semanas = useMemo(() => {
    const m = new Map()
    for (const d of serie) {
      const f = new Date(d.fecha + 'T00:00:00Z'); f.setUTCDate(f.getUTCDate() - ((f.getUTCDay() + 6) % 7))
      const k = f.toISOString().slice(0, 10); m.set(k, (m.get(k) || 0) + (+d.qty_neta || 0))
    }
    return [...m.entries()].sort().slice(-26)
  }, [serie])
  if (!semanas.length) return <Vacio>Sin ventas en los últimos 180 días.</Vacio>
  const max = Math.max(...semanas.map(([, v]) => v), 1)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 64 }}>
        {semanas.map(([k, v]) => <div key={k} title={`Semana del ${k}: ${fN(v)} unidades`}
          style={{ flex: 1, height: `${Math.max((v / max) * 100, v > 0 ? 5 : 1.5)}%`, background: v > 0 ? NAVY : BORDE, borderRadius: '2px 2px 0 0' }} />)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: SLATE, marginTop: 4 }}>
        <span>{semanas[0][0]}</span><span>unidades vendidas por semana, todas las salas</span><span>{semanas[semanas.length - 1][0]}</span>
      </div>
    </div>
  )
}

export function InvProducto({ sku, usuario, onCambio, irABase }) {
  const [datos, setDatos] = useState(null), [err, setErr] = useState('')
  const [gestion, setGestion] = useState(null), [guardando, setGuardando] = useState(false)
  const cargar = () => fetchProducto(sku).then(setDatos).catch(e => setErr(e.message))
  useEffect(() => { setDatos(null); setErr(''); setGestion(null); cargar() }, [sku]) // eslint-disable-line react-hooks/exhaustive-deps

  const r = useMemo(() => {
    if (!datos) return null
    const p = [...datos.posicion].sort((a, b) => SUCURSALES.findIndex(s => s.id === a.sucursal_id) - SUCURSALES.findIndex(s => s.id === b.sucursal_id))
    const salas = p.filter(x => x.vende)
    const s = (fs, k) => fs.reduce((a, x) => a + (+x[k] || 0), 0)
    return {
      p, producto: p[0]?.producto || sku, familia: p[0]?.familia, tipo: p[0]?.tipo_producto, clase: p[0]?.clase,
      patron: [...salas].sort((a, b) => (+b.venta_84d || 0) - (+a.venta_84d || 0))[0]?.patron, costo: p[0]?.costo_unit,
      stock: s(p, 'stock'), salas: s(salas, 'stock'), cd: s(p.filter(x => !x.vende), 'stock'),
      venta12: s(salas, 'venta_364d'), neto12: s(salas, 'neto_364d'), perdida: s(salas, 'venta_perdida_84d'),
      alertas: p.filter(x => x.alerta_id && x.alerta_estado !== 'resuelta'),
    }
  }, [datos, sku])

  const guardar = async estado => {
    setGuardando(true)
    try {
      await gestionarAlerta(gestion.id, estado, gestion.nota, usuario)
      toast.success(estado === 'resuelta' ? 'Alerta cerrada' : 'Alerta marcada en gestión')
      setGestion(null); await cargar(); onCambio?.()
    } catch (e) { toast.error('No se pudo guardar: ' + e.message) }
    setGuardando(false)
  }

  if (err) return <ErrorBox>{err}</ErrorBox>
  if (!r) return <Cargando>Cargando ficha…</Cargando>
  const th = al => ({ padding: '6px 8px', textAlign: al, fontSize: 9.5, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.4, background: PAPER, borderBottom: `1px solid ${BORDE}` })

  return (
    <>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>{r.producto}</div>
        <div style={{ fontSize: 11.5, color: SLATE }}>{sku} · {r.familia}{r.tipo && r.tipo !== r.familia ? ` · ${r.tipo}` : ''}{r.clase ? ` · clase ${r.clase}` : ''}</div>
        <div style={{ fontSize: 11.5, marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Enlace onClick={() => irABase('productos', { q: sku }, `Producto ${sku} en todas las bodegas`)}>Ver en la base de datos ›</Enlace>
          <Enlace onClick={() => irABase('movimientos', { q: sku }, `Movimientos sugeridos de ${sku}`)}>Ver movimientos sugeridos ›</Enlace>
        </div>
      </div>

      <KpiStrip>
        <KpiCelda l="Stock red" v={fN(r.stock)} sub={`${fN(r.salas)} salas · ${fN(r.cd)} CD`} color={NAVY} />
        <KpiCelda l="Costo unitario" v={fmt(r.costo)} />
        <KpiCelda l="Venta 12 meses" v={fN(r.venta12) + ' u'} sub={fmt(r.neto12)} color={VERDE} />
        <KpiCelda l="Venta perdida 84d" v={fmt(r.perdida)} color={r.perdida > 0 ? ROJO : SLATE} />
        {r.patron && <KpiCelda l="Patrón de demanda" v={r.patron.toLowerCase()} color={CL_PATRON[r.patron]} title={AYUDA_PATRON[r.patron]} />}
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

      <Panel titulo="Venta semanal" sub="últimas 26 semanas"><VentaSemanal serie={datos.serie} /></Panel>

      <Panel titulo="Situación en cada bodega" sinPadding>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{['Bodega', 'Situación', 'Reposición', 'Stock', 'Cobertura', 'Venta/día', '% sin stock', 'Qué hacer'].map((h, i) =>
              <th key={h} style={th(i >= 3 && i <= 6 ? 'right' : 'left')}>{h}</th>)}</tr></thead>
            <tbody>{r.p.map(x => (
              <tr key={x.sucursal_id} style={{ borderBottom: `1px solid ${BORDE}` }}>
                <td style={{ padding: '6px 8px', fontWeight: 700 }}>{nombreSuc(x.sucursal_id)}</td>
                <td style={{ padding: '6px 8px' }}><Tag texto={NOMBRE_NIVEL[x.nivel]} color={CL_NIVEL[x.nivel]} /></td>
                <td style={{ padding: '6px 8px' }}>{x.vende ? <Tag texto={x.estado} color={CL_ESTADO[x.estado]} /> : '—'}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fN(x.stock)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{x.dias_cobertura == null ? 'sin venta' : fN(x.dias_cobertura) + ' d'}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{x.vende ? fD(x.demanda_dia) : '—'}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: +x.pct_quiebre > 30 ? ROJO : INK }}>{x.vende ? fN(x.pct_quiebre) + '%' : '—'}</td>
                <td style={{ padding: '6px 8px', whiteSpace: 'normal', maxWidth: 180 }}>{x.accion || (x.vende && +x.sugerido > 0 ? `Reponer ${fN(x.sugerido)} unid.` : '—')}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}
