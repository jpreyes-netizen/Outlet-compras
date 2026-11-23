import { useState, useEffect, useMemo } from 'react'
import { DataGrid } from '../finanzas/conciliacion/DataGrid'
import {
  SEM, EJE, FRANJA, PESO, btnS, panelCaja, fmtValor, fmtMeta, nivel,
  Chip, Sparkline, medirIndicador
} from './cgComun'

/* ═══ Pestaña Indicadores ═══
   El detalle: los 54 indicadores con su estado (vista "Estado") o su configuración
   (vista "Configuración"). Filtra por dimensión. Clic en una fila abre la ficha
   del indicador: diagnóstico, desglose, qué hacer, historia y configuración. */

export function CgIndicadores({ datos, isMobile, nav, verFicha }) {
  const { dims, ult, hist, cat, dimNom, prioridades, cargando, error, recargar } = datos
  const [dimSel, setDimSel] = useState(null)
  const [vista, setVista] = useState('estado')
  const [soloSinMeta, setSoloSinMeta] = useState(false)
  const [midiendo, setMidiendo] = useState(null)
  const [aviso, setAviso] = useState(null)

  useEffect(() => {
    if (!nav?.t) return
    setDimSel(nav.dim ?? null)
    setSoloSinMeta(!!nav.sinMeta)
    if (nav.sinMeta) setVista('config')
  }, [nav?.t])  // eslint-disable-line react-hooks/exhaustive-deps

  const ultPorCod = useMemo(() => Object.fromEntries(ult.map(r => [r.codigo, r])), [ult])
  const prioPorCod = useMemo(() => Object.fromEntries(prioridades.map(p => [p.codigo, p])), [prioridades])
  const ordDim = useMemo(() => Object.keys(dimNom), [dimNom])

  const filas = useMemo(() => {
    let todas = Object.values(cat).map(i => {
      const u = ultPorCod[i.codigo] || {}
      const metaDinamica = i.meta == null && i.tolerancia_pct != null
      return {
        ...i, metaDinamica, porDefinir: i.meta == null && !metaDinamica,
        valor: u.valor, metaVigente: u.meta, semaforo: u.semaforo, detalle: u.detalle, error: u.error,
        fecha_medicion: u.fecha_medicion, prioridad: prioPorCod[i.codigo]?.prioridad ?? null
      }
    })
    if (vista === 'estado') todas = todas.filter(r => r.activo)
    if (dimSel) todas = todas.filter(r => r.dimension === dimSel)
    if (soloSinMeta) todas = todas.filter(r => r.porDefinir)
    return todas.sort((a, b) => (ordDim.indexOf(a.dimension) - ordDim.indexOf(b.dimension)) || (a.orden - b.orden))
  }, [cat, ultPorCod, prioPorCod, vista, dimSel, soloSinMeta, ordDim])

  const rojosPorDim = useMemo(() => {
    const m = {}
    for (const r of ult) if (r.semaforo === 'rojo') m[r.dimension] = (m[r.dimension] || 0) + 1
    return m
  }, [ult])
  const nSinMeta = Object.values(cat).filter(i => i.meta == null && i.tolerancia_pct == null).length

  const colMeta = {
    key: 'meta', label: 'Meta', width: 110, align: 'right',
    value: r => r.meta == null ? (r.metaVigente == null ? null : Number(r.metaVigente)) : Number(r.meta),
    render: r => r.porDefinir
      ? <span style={{ color: SEM.amarillo.c, fontWeight: 600 }}>por definir</span>
      : r.metaDinamica
        ? <span title="Se calcula en cada medición">{fmtMeta(r.metaVigente, r.sentido, r.unidad) || '—'} <span style={{ color: '#6B7280' }}>(dinámica)</span></span>
        : fmtMeta(r.meta, r.sentido, r.unidad),
    exportValue: r => r.meta == null ? '' : Number(r.meta)
  }

  const columnas = useMemo(() => vista === 'estado' ? [
    { key: 'dimension', label: 'Dim.', width: 56 },
    { key: 'codigo', label: 'Código', width: 84 },
    { key: 'eje', label: 'Eje', width: 82, value: r => EJE[r.eje] || r.eje },
    { key: 'nombre', label: 'Indicador', width: 320 },
    {
      key: 'valor', label: 'Valor', width: 104, align: 'right', value: r => r.valor == null ? null : Number(r.valor),
      render: r => <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtValor(r.valor, r.unidad)}</span>,
      exportValue: r => r.valor == null ? '' : Number(r.valor)
    },
    colMeta,
    { key: 'semaforo', label: 'Estado', width: 96, value: r => (SEM[r.semaforo] || SEM.sin_dato).l, render: r => <Chip s={r.semaforo} /> },
    {
      key: 'prioridad', label: 'Urgencia', width: 92, align: 'right', value: r => r.prioridad,
      render: r => r.prioridad == null ? <span style={{ color: '#9CA3AF' }}>—</span>
        : <span style={{ color: nivel(r.prioridad).c, fontWeight: 700 }}>{nivel(r.prioridad).l} {r.prioridad}</span>
    },
    { key: 'tendencia', label: 'Tendencia', width: 100, sortable: false, filterable: false, value: () => '', exportValue: () => '', render: r => <Sparkline pts={hist[r.codigo] || []} meta={r.metaVigente} /> },
    {
      key: 'detalle', label: 'Detalle', width: 400, value: r => r.error ? `Error: ${r.error}` : (r.detalle || ''),
      render: r => <span title={r.error || r.detalle || ''} style={{ color: r.error ? SEM.error.c : '#374151', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.error ? `Error: ${r.error}` : (r.detalle || '—')}</span>
    },
    { key: 'fecha_medicion', label: 'Medido', width: 92, fecha: true },
  ] : [
    { key: 'codigo', label: 'Código', width: 84 },
    { key: 'dimension', label: 'Dimensión', width: 150, value: r => dimNom[r.dimension] || r.dimension },
    { key: 'eje', label: 'Eje', width: 82, value: r => EJE[r.eje] || r.eje },
    { key: 'nombre', label: 'Indicador', width: 300 },
    colMeta,
    {
      key: 'umbral_rojo', label: 'Rojo desde', width: 96, align: 'right', value: r => r.umbral_rojo == null ? null : Number(r.umbral_rojo),
      render: r => r.umbral_rojo == null ? (r.tolerancia_pct != null ? `meta ${r.sentido === 'mayor' ? '−' : '+'}${r.tolerancia_pct}%` : '—') : fmtValor(r.umbral_rojo, r.unidad)
    },
    { key: 'sentido', label: 'Mejor', width: 70, value: r => r.sentido === 'mayor' ? 'Mayor' : 'Menor' },
    { key: 'peso', label: 'Importancia', width: 96, value: r => PESO[r.peso] || r.peso },
    { key: 'responsable_id', label: 'Dueño sugerido', width: 160, value: r => datos.usuNom?.[r.responsable_id] || (r.responsable_id ? r.responsable_id : 'por asignar') },
    { key: 'franja', label: 'Medición', width: 112, value: r => FRANJA[r.franja] || r.franja },
    { key: 'fuente', label: 'Fuente', width: 220 },
    { key: 'pantalla', label: 'Pantalla', width: 230, value: r => r.pantalla || '' },
    { key: 'activo', label: 'Activo', width: 64, value: r => r.activo ? 'Sí' : 'No' },
  ], [vista, hist, dimNom, datos.usuNom])  // eslint-disable-line react-hooks/exhaustive-deps

  const medirTodo = async () => {
    const lista = Object.values(cat).filter(i => i.activo && i.franja === 'diaria').sort((a, b) => a.orden - b.orden)
    setAviso(null)
    let fallas = 0
    for (let k = 0; k < lista.length; k++) {
      setMidiendo({ i: k + 1, n: lista.length })
      try { const r = await medirIndicador(lista[k].codigo); if (r?.err) fallas++ } catch { fallas++ }
    }
    setMidiendo(null)
    await recargar()
    setAviso(fallas
      ? { tipo: 'error', txt: `${lista.length - fallas} de ${lista.length} indicadores medidos; ${fallas} con error.` }
      : { tipo: 'ok', txt: `${lista.length} indicadores diarios medidos. Los nocturnos se miden a las 03:30.` })
  }

  if (error) {
    return <div style={{ ...panelCaja, padding: 16, fontSize: 13, color: SEM.rojo.c }}>No se pudieron cargar los indicadores: {error}
      <div style={{ marginTop: 10 }}><button onClick={recargar} style={btnS}>Reintentar</button></div></div>
  }

  const chip = (activo, onClick, contenido, key) => (
    <button key={key} onClick={onClick} aria-pressed={activo} style={{
      ...btnS, padding: '4px 10px', fontSize: 12,
      background: activo ? '#1C1C1E' : '#fff', color: activo ? '#fff' : '#1C1C1E', borderColor: activo ? '#1C1C1E' : '#D1D5DB'
    }}>{contenido}</button>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {chip(!dimSel, () => { setDimSel(null) }, 'Todas', 'todas')}
        {dims.map(d => chip(dimSel === d.dimension, () => { setDimSel(v => v === d.dimension ? null : d.dimension) },
          <>{d.dimension_nombre}{rojosPorDim[d.dimension] ? <span style={{ marginLeft: 5, color: dimSel === d.dimension ? '#FCA5A5' : SEM.rojo.c, fontWeight: 700 }}>{rojosPorDim[d.dimension]}</span> : null}</>, d.dimension))}
        <span style={{ flex: 1 }} />
        <div role="tablist" aria-label="Vista" style={{ display: 'inline-flex', background: '#E5E5EA', borderRadius: 7, padding: 2 }}>
          {[['estado', 'Estado'], ['config', 'Configuración']].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={vista === k} onClick={() => setVista(k)} style={{
              padding: '4px 10px', borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
              background: vista === k ? '#fff' : 'transparent', color: '#1C1C1E'
            }}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8, fontSize: 12, color: '#4B5563' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={soloSinMeta} onChange={e => setSoloSinMeta(e.target.checked)} /> Solo sin meta ({nSinMeta})
        </label>
        <span style={{ flex: 1 }} />
        {midiendo
          ? <span style={{ fontWeight: 600, color: '#1C1C1E' }}>Midiendo {midiendo.i} de {midiendo.n}…</span>
          : <button onClick={medirTodo} disabled={cargando} style={btnS}>Medir todo ahora</button>}
      </div>
      {aviso && <div role="status" style={{ marginBottom: 8, fontSize: 12, padding: '6px 10px', borderRadius: 6, color: aviso.tipo === 'ok' ? SEM.verde.c : SEM.rojo.c, background: aviso.tipo === 'ok' ? SEM.verde.bg : SEM.rojo.bg }}>{aviso.txt}</div>}

      <div style={{ minWidth: 0 }}>
          <DataGrid
            columns={columnas}
            rows={filas}
            getRowId={r => r.codigo}
            onRowClick={r => verFicha(r.codigo)}
            rowStyle={r => r.activo ? {} : { opacity: 0.55 }}
            title={dimSel ? `Indicadores de ${dimNom[dimSel] || dimSel}` : 'Indicadores'}
            exportName={vista === 'estado' ? 'control_gestion_indicadores' : 'control_gestion_catalogo'}
            loading={cargando && !filas.length}
            emptyText={soloSinMeta ? 'Todos los indicadores tienen meta.' : 'Sin indicadores.'}
          />
      </div>
    </div>
  )
}
