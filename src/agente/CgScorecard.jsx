import { useState, useMemo } from 'react'
import { DataGrid } from '../finanzas/conciliacion/DataGrid'
import {
  SEM, ESTADO_DIM, EJE, TRAMA, fmtValor, fmtMeta, horaCL,
  Chip, Sparkline, PanelIndicador, medirIndicador
} from './cgComun'

/* ═══ Pestaña Scorecard ═══
   Arriba, las 7 dimensiones (clic = filtra la grilla). Abajo, todos los
   indicadores con su última medición. Clic en una fila abre el panel. */

function TarjetaDimension({ d, activa, onClick }) {
  const est = ESTADO_DIM[d.estado] || ESTADO_DIM.sin_dato
  const noEval = d.estado === 'no_evaluable'
  const total = (d.verdes || 0) + (d.amarillos || 0) + (d.rojos || 0)
  const pct = n => total ? `${(100 * (n || 0)) / total}%` : '0%'
  const borde = activa ? '2px solid #1C1C1E' : '1px solid #E5E7EB'
  return (
    <button onClick={onClick} aria-pressed={activa} title={noEval ? 'Hay indicadores de dato en rojo: la nota es referencial' : ''}
      style={{
        textAlign: 'left', cursor: 'pointer', minWidth: 0, fontFamily: 'inherit',
        background: noEval ? TRAMA : '#fff',
        borderTop: borde, borderRight: borde, borderBottom: borde,
        borderLeft: `4px solid ${est.c}`, borderRadius: 6,
        padding: activa ? '7px 9px 7px 8px' : '8px 10px 8px 9px'
      }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1C1C1E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {d.dimension_nombre}
        </span>
        <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: noEval ? '#94A3B8' : '#1C1C1E' }}>
          {d.nota ?? '—'}
        </span>
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: est.c, marginTop: 2 }}>
        {est.l}{noEval && <span style={{ fontWeight: 400, color: '#475569' }}>: dato en rojo</span>}
      </div>
      <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', background: '#E5E7EB', marginTop: 6 }} aria-hidden="true">
        <span style={{ width: pct(d.verdes), background: SEM.verde.c }} />
        <span style={{ width: pct(d.amarillos), background: '#F5A524' }} />
        <span style={{ width: pct(d.rojos), background: SEM.rojo.c }} />
      </div>
      <div style={{ fontSize: 10.5, color: '#4B5563', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
        {d.verdes} verdes, {d.amarillos} amarillos, {d.rojos} rojos{d.sin_evaluar ? `, ${d.sin_evaluar} sin meta` : ''}
      </div>
    </button>
  )
}

export function CgScorecard({ datos, isMobile }) {
  const { dims, ult, hist, cat, dimNom, cargando, error, recargar } = datos
  const [dimSel, setDimSel] = useState(null)
  const [sel, setSel] = useState(null)
  const [midiendo, setMidiendo] = useState(null)   // { i, n, fallas }
  const [aviso, setAviso] = useState(null)

  const filas = useMemo(() => dimSel ? ult.filter(r => r.dimension === dimSel) : ult, [ult, dimSel])
  const ultimaMedicion = useMemo(() => ult.reduce((mx, r) => (r.medido_at && (!mx || r.medido_at > mx)) ? r.medido_at : mx, null), [ult])

  const medirTodo = async () => {
    const lista = Object.values(cat).filter(i => i.activo && i.franja === 'diaria').sort((a, b) => a.orden - b.orden)
    if (!lista.length) return
    setAviso(null)
    let fallas = 0
    for (let k = 0; k < lista.length; k++) {
      setMidiendo({ i: k + 1, n: lista.length, fallas })
      try {
        const r = await medirIndicador(lista[k].codigo)
        if (r?.err) fallas++
      } catch { fallas++ }
    }
    setMidiendo(null)
    await recargar()
    setAviso(fallas
      ? { tipo: 'error', txt: `Medición terminada: ${lista.length - fallas} de ${lista.length} indicadores medidos; ${fallas} con error (revisa los marcados como Error).` }
      : { tipo: 'ok', txt: `Medición terminada: ${lista.length} indicadores diarios medidos. Los nocturnos se miden a las 03:30.` })
  }

  const columnas = useMemo(() => [
    { key: 'dimension', label: 'Dim.', width: 56, value: r => r.dimension },
    { key: 'codigo', label: 'Código', width: 84 },
    { key: 'eje', label: 'Eje', width: 82, value: r => EJE[r.eje] || r.eje },
    { key: 'nombre', label: 'Indicador', width: 330 },
    {
      key: 'valor', label: 'Valor', width: 104, align: 'right',
      value: r => (r.valor === null || r.valor === undefined) ? null : Number(r.valor),
      render: r => <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtValor(r.valor, r.unidad)}</span>,
      exportValue: r => (r.valor === null || r.valor === undefined) ? '' : Number(r.valor)
    },
    {
      key: 'meta', label: 'Meta', width: 96, align: 'right',
      value: r => (r.meta === null || r.meta === undefined) ? null : Number(r.meta),
      render: r => fmtMeta(r.meta, r.sentido, r.unidad) || <span style={{ color: SEM.amarillo.c }}>por definir</span>,
      exportValue: r => (r.meta === null || r.meta === undefined) ? '' : Number(r.meta)
    },
    { key: 'semaforo', label: 'Estado', width: 96, value: r => (SEM[r.semaforo] || SEM.sin_dato).l, render: r => <Chip s={r.semaforo} /> },
    {
      key: 'tendencia', label: 'Tendencia', width: 100, sortable: false, filterable: false,
      value: () => '', exportValue: () => '',
      render: r => <Sparkline pts={hist[r.codigo] || []} meta={r.meta} />
    },
    {
      key: 'detalle', label: 'Detalle', width: 420,
      value: r => r.error ? `Error: ${r.error}` : (r.detalle || ''),
      render: r => (
        <span title={r.error || r.detalle || ''} style={{ color: r.error ? SEM.error.c : '#374151', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {r.error ? `Error: ${r.error}` : (r.detalle || '—')}
        </span>
      )
    },
    { key: 'fecha_medicion', label: 'Medido', width: 92, fecha: true },
  ], [hist])

  if (error) {
    return (
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 16, fontSize: 13, color: SEM.rojo.c }}>
        No se pudieron cargar los indicadores: {error}
        <div style={{ marginTop: 10 }}><button onClick={recargar} style={btnSec}>Reintentar</button></div>
      </div>
    )
  }

  const selFila = sel ? ult.find(r => r.codigo === sel) : null

  return (
    <div>
      {/* Barra de estado de la medición */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8, fontSize: 12, color: '#4B5563' }}>
        <span>Última medición <b style={{ color: '#1C1C1E' }}>{horaCL(ultimaMedicion)}</b>. Se mide sola todos los días a las 12:30; las consultas pesadas, a las 03:30.</span>
        <span style={{ flex: 1 }} />
        {midiendo
          ? <span style={{ fontWeight: 600, color: '#1C1C1E' }}>Midiendo {midiendo.i} de {midiendo.n}…</span>
          : <button onClick={medirTodo} disabled={cargando || !ult.length} style={btnSec}>Medir ahora</button>}
        <button onClick={recargar} disabled={cargando || !!midiendo} style={btnSec}>{cargando ? 'Cargando…' : 'Actualizar'}</button>
      </div>

      {aviso && (
        <div role="status" style={{
          marginBottom: 8, fontSize: 12, padding: '6px 10px', borderRadius: 6,
          color: aviso.tipo === 'ok' ? SEM.verde.c : SEM.rojo.c, background: aviso.tipo === 'ok' ? SEM.verde.bg : SEM.rojo.bg
        }}>{aviso.txt}</div>
      )}

      {/* Dimensiones */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0,1fr))' : 'repeat(7, minmax(0,1fr))', gap: 8, marginBottom: 10 }}>
        {dims.map(d => (
          <TarjetaDimension key={d.dimension} d={d} activa={dimSel === d.dimension}
            onClick={() => { setDimSel(v => v === d.dimension ? null : d.dimension); setSel(null) }} />
        ))}
      </div>

      {/* Grilla + panel */}
      <div style={{ display: 'grid', gridTemplateColumns: (!isMobile && selFila) ? 'minmax(0,1fr) 400px' : 'minmax(0,1fr)', gap: 10, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <DataGrid
            columns={columnas}
            rows={filas}
            getRowId={r => r.codigo}
            selectedId={sel}
            onRowClick={r => setSel(v => v === r.codigo ? null : r.codigo)}
            title={dimSel ? `Indicadores de ${dimNom[dimSel] || dimSel}` : 'Indicadores'}
            exportName="control_gestion_scorecard"
            loading={cargando && !ult.length}
            emptyText="Todavía no hay mediciones. La primera corre a las 12:30, o usa Medir ahora."
            toolbar={dimSel ? <button onClick={() => setDimSel(null)} style={btnSec}>Ver todas las dimensiones</button> : null}
          />
        </div>
        {selFila && (
          <PanelIndicador
            ind={cat[selFila.codigo]}
            u={selFila}
            hist={hist[selFila.codigo] || []}
            dimNom={dimNom}
            isMobile={isMobile}
            onCerrar={() => setSel(null)}
            onCambio={recargar}
          />
        )}
      </div>
    </div>
  )
}

const btnSec = { padding: '5px 10px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', color: '#1C1C1E', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
