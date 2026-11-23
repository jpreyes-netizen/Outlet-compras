import { useState, useMemo } from 'react'
import { DataGrid } from '../finanzas/conciliacion/DataGrid'
import { SEM, EJE, FRANJA, fmtValor, fmtMeta, Chip, PanelIndicador } from './cgComun'

/* ═══ Pestaña Indicadores ═══
   Catálogo propio del Control de Gestión. Desde el panel se editan meta,
   umbrales, tolerancia, pantalla, nota y si el indicador está activo.
   El SQL de medición no se edita desde la app (solo por migración). */

export function CgIndicadores({ datos, isMobile }) {
  const { ult, hist, cat, dimNom, cargando, error, recargar } = datos
  const [sel, setSel] = useState(null)
  const [soloPendientes, setSoloPendientes] = useState(false)

  const ultPorCod = useMemo(() => Object.fromEntries(ult.map(r => [r.codigo, r])), [ult])

  const filas = useMemo(() => {
    const todas = Object.values(cat).map(i => {
      const u = ultPorCod[i.codigo]
      const metaDinamica = (i.meta === null || i.meta === undefined) && i.tolerancia_pct !== null && i.tolerancia_pct !== undefined
      return { ...i, porDefinir: (i.meta === null || i.meta === undefined) && !metaDinamica, metaDinamica, semaforo: u?.semaforo, metaVigente: u?.meta }
    })
    const ordDim = Object.keys(dimNom)
    todas.sort((a, b) => (ordDim.indexOf(a.dimension) - ordDim.indexOf(b.dimension)) || (a.orden - b.orden))
    return soloPendientes ? todas.filter(r => r.porDefinir) : todas
  }, [cat, ultPorCod, dimNom, soloPendientes])

  const nPendientes = useMemo(() => Object.values(cat).filter(i =>
    (i.meta === null || i.meta === undefined) && (i.tolerancia_pct === null || i.tolerancia_pct === undefined)).length, [cat])

  const columnas = useMemo(() => [
    { key: 'codigo', label: 'Código', width: 84 },
    { key: 'dimension', label: 'Dimensión', width: 150, value: r => dimNom[r.dimension] || r.dimension },
    { key: 'eje', label: 'Eje', width: 82, value: r => EJE[r.eje] || r.eje },
    { key: 'nombre', label: 'Indicador', width: 320 },
    {
      key: 'meta', label: 'Meta', width: 110, align: 'right',
      value: r => (r.meta === null || r.meta === undefined) ? null : Number(r.meta),
      render: r => r.porDefinir
        ? <span style={{ color: SEM.amarillo.c, fontWeight: 600 }}>por definir</span>
        : r.metaDinamica
          ? <span title="Se calcula en cada medición">{fmtMeta(r.metaVigente, r.sentido, r.unidad) || '—'} <span style={{ color: '#6B7280' }}>(dinámica)</span></span>
          : fmtMeta(r.meta, r.sentido, r.unidad),
      exportValue: r => (r.meta === null || r.meta === undefined) ? '' : Number(r.meta)
    },
    {
      key: 'umbral_rojo', label: 'Rojo desde', width: 96, align: 'right',
      value: r => (r.umbral_rojo === null || r.umbral_rojo === undefined) ? null : Number(r.umbral_rojo),
      render: r => (r.umbral_rojo === null || r.umbral_rojo === undefined)
        ? (r.tolerancia_pct !== null && r.tolerancia_pct !== undefined ? `meta ${r.sentido === 'mayor' ? '−' : '+'}${r.tolerancia_pct}%` : '—')
        : fmtValor(r.umbral_rojo, r.unidad)
    },
    { key: 'sentido', label: 'Mejor', width: 70, value: r => r.sentido === 'mayor' ? 'Mayor' : 'Menor' },
    { key: 'semaforo', label: 'Estado hoy', width: 96, value: r => (SEM[r.semaforo] || SEM.sin_dato).l, render: r => <Chip s={r.semaforo} /> },
    { key: 'franja', label: 'Medición', width: 112, value: r => FRANJA[r.franja] || r.franja },
    { key: 'fuente', label: 'Fuente', width: 230 },
    { key: 'pantalla', label: 'Pantalla', width: 230, value: r => r.pantalla || '' },
    { key: 'activo', label: 'Activo', width: 64, value: r => r.activo ? 'Sí' : 'No' },
    { key: 'nota', label: 'Nota', width: 320, value: r => r.nota || '' },
  ], [dimNom])

  if (error) {
    return (
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 16, fontSize: 13, color: SEM.rojo.c }}>
        No se pudo cargar el catálogo: {error}
        <div style={{ marginTop: 10 }}><button onClick={recargar} style={btnSec}>Reintentar</button></div>
      </div>
    )
  }

  const ind = sel ? cat[sel] : null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8, fontSize: 12, color: '#4B5563' }}>
        <span>
          {Object.keys(cat).length} indicadores.{' '}
          {nPendientes > 0
            ? <b style={{ color: SEM.amarillo.c }}>{nPendientes} sin meta: se miden, pero sin semáforo.</b>
            : 'Todos tienen meta.'}
        </span>
        <span style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={soloPendientes} onChange={e => setSoloPendientes(e.target.checked)} /> Solo sin meta
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: (!isMobile && ind) ? 'minmax(0,1fr) 400px' : 'minmax(0,1fr)', gap: 10, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <DataGrid
            columns={columnas}
            rows={filas}
            getRowId={r => r.codigo}
            selectedId={sel}
            onRowClick={r => setSel(v => v === r.codigo ? null : r.codigo)}
            rowStyle={r => r.activo ? {} : { opacity: 0.55 }}
            title="Catálogo de indicadores"
            exportName="control_gestion_catalogo"
            loading={cargando && !filas.length}
            emptyText={soloPendientes ? 'Todos los indicadores tienen meta.' : 'Sin indicadores.'}
          />
        </div>
        {ind && (
          <PanelIndicador
            ind={ind}
            u={ultPorCod[ind.codigo]}
            hist={hist[ind.codigo] || []}
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
