/* ════════════════════════════════════════════════════════════════════
   InvBase.jsx — Base de datos de Inventario
   Destino de todos los "ver detalle" de la app: llega con filtros ya
   aplicados, los muestra como pastillas que se quitan con un clic, y
   permite seguir filtrando, ordenar, exportar a Excel o PDF y abrir la
   ficha de cualquier producto.
   ════════════════════════════════════════════════════════════════════ */

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { DataGrid } from '../finanzas/conciliacion/DataGrid'
import {
  KpiStrip, KpiCelda, Tag, Enlace, inputEstilo, fmt, fN, fD,
  NAVY, INK, SLATE, BORDE, ROJO, AMBAR, VERDE, MORADO, TINTE,
} from './invUI'
import {
  aplicarFiltros, describirFiltros, nombreSuc, SUCURSALES, CL_ESTADO, CL_NIVEL, NOMBRE_NIVEL, CL_USO,
  ESTADOS_ALERTA, ACCIONES, ESTADOS, nivelesDesde, usosDesde, fetchSerieMensual,
} from './invData'
import { tablaPdf } from './invReportes'
import { METODOS, DIAS_MES, composicion, nombreMes } from './invProyeccion'
import { pdfProductos } from './invPdfProducto'

const TOPE_PROYECCION = 40

/* ── Definición de cada planilla ──────────────────────────────────── */
const COLS = {
  productos: [
    { key: 'sku', label: 'SKU', width: 120 },
    { key: 'producto', label: 'Producto', width: 250 },
    { key: 'tipo_producto', label: 'Categoría', width: 170 },
    { key: 'familia', label: 'Familia', width: 150 },
    { key: 'sucursal_id', label: 'Bodega', width: 110, value: r => nombreSuc(r.sucursal_id) },
    { key: 'nivel', label: 'Situación', width: 120, value: r => NOMBRE_NIVEL[r.nivel] || r.nivel,
      render: r => <Tag texto={NOMBRE_NIVEL[r.nivel] || r.nivel} color={CL_NIVEL[r.nivel]} /> },
    { key: 'dias_inmovil', label: 'Días sin moverse', width: 92, align: 'right',
      render: r => r.dias_inmovil == null ? '—' : <b style={{ color: CL_NIVEL[r.nivel] }}>{r.dias_es_minimo ? '≥ ' : ''}{fN(r.dias_inmovil)}</b> },
    { key: 'estado', label: 'Reposición', width: 108, value: r => r.vende ? r.estado : '',
      render: r => r.vende ? <Tag texto={r.estado} color={CL_ESTADO[r.estado]} /> : <span style={{ color: SLATE }}>—</span> },
    { key: 'stock', label: 'Stock', width: 80, align: 'right', render: r => fN(r.stock) },
    { key: 'valor_costo', label: 'Capital a costo', width: 120, align: 'right', render: r => fmt(r.valor_costo) },
    { key: 'demanda_dia', label: 'Venta prom./día', width: 100, align: 'right', render: r => fD(r.demanda_dia) },
    { key: 'demanda_mes', label: 'Venta prom./mes', width: 102, align: 'right', value: r => +(r.demanda_dia * DIAS_MES).toFixed(1),
      render: r => fD(r.demanda_dia * DIAS_MES, 1) },
    { key: 'metodo', label: 'Cálculo de la venta prom.', width: 150, value: r => METODOS[r.metodo]?.corto || '',
      render: r => r.metodo ? <span title={METODOS[r.metodo].d}>{METODOS[r.metodo].corto}</span> : '—' },
    { key: 'meses_calc', label: 'Meses que cuentan', width: 118, align: 'right',
      value: r => { const c = composicion(r); return c && c.total ? `${c.usados}/${c.total}` : '' },
      render: r => { const c = composicion(r); return !c || !c.total ? '—' : `${c.usados} de ${c.total}` } },
    { key: 'ventana_calc', label: 'Ventana usada', width: 130,
      value: r => r.ventana_desde ? `${nombreMes(r.ventana_desde)} a ${nombreMes(r.ventana_hasta)}` : '' },
    { key: 'dias_cobertura', label: 'Cobertura (días)', width: 98, align: 'right',
      render: r => r.dias_cobertura == null ? 'sin venta' : fN(r.dias_cobertura) },
    { key: 'pct_quiebre', label: '% días sin stock', width: 96, align: 'right', value: r => r.vende ? +r.pct_quiebre : null,
      render: r => r.vende ? <span style={{ color: +r.pct_quiebre > 30 ? ROJO : INK }}>{fN(r.pct_quiebre)}%</span> : '—' },
    { key: 'venta_perdida_84d', label: 'Venta perdida 84d', width: 120, align: 'right',
      render: r => +r.venta_perdida_84d > 0 ? <span style={{ color: ROJO }}>{fmt(r.venta_perdida_84d)}</span> : '—' },
    { key: 'sugerido', label: 'Reponer (unid.)', width: 98, align: 'right', value: r => r.vende ? +r.sugerido : null,
      render: r => r.vende && +r.sugerido > 0 ? <b>{fN(r.sugerido)}</b> : '—' },
    { key: 'unid_exceso', label: 'Sobre objetivo (unid.)', width: 120, align: 'right',
      render: r => +r.unid_exceso > 0 ? <span style={{ color: MORADO }}>{fN(r.unid_exceso)}</span> : '—' },
    { key: 'stock_en_cd', label: 'Stock en CD', width: 90, align: 'right', render: r => fN(r.stock_en_cd) },
    { key: 'clase', label: 'Clase', width: 64 },
    { key: 'accion', label: 'Qué hacer', width: 230, value: r => r.accion || '',
      render: r => r.accion ? <span title={ACCIONES[r.accion]}>{r.accion}{r.sala_destino ? ` → ${nombreSuc(r.sala_destino)}` : ''}</span> : '—' },
    { key: 'alerta_estado', label: 'Alerta', width: 112, value: r => ESTADOS_ALERTA[r.alerta_estado]?.l || '',
      render: r => r.alerta_estado ? <Tag texto={ESTADOS_ALERTA[r.alerta_estado].l} color={ESTADOS_ALERTA[r.alerta_estado].c} /> : '—' },
    { key: 'ultima_venta', label: 'Última venta', width: 100 },
  ],
  movimientos: [
    { key: 'tipo', label: 'Movimiento', width: 105, render: r => <Tag texto={r.tipo} color={r.tipo === 'Desde CD' ? NAVY : VERDE} /> },
    { key: 'sku', label: 'SKU', width: 120 },
    { key: 'producto', label: 'Producto', width: 250 },
    { key: 'tipo_producto', label: 'Categoría', width: 160 },
    { key: 'origen', label: 'Desde', width: 110, value: r => nombreSuc(r.origen) },
    { key: 'destino', label: 'Hacia', width: 110, value: r => nombreSuc(r.destino) },
    { key: 'estado_destino', label: 'Estado en destino', width: 120, render: r => <Tag texto={r.estado_destino} color={CL_ESTADO[r.estado_destino]} /> },
    { key: 'disp_destino', label: 'Tiene destino', width: 92, align: 'right', render: r => fN(r.disp_destino) },
    { key: 'unidades', label: 'Mover (unid.)', width: 95, align: 'right', render: r => <b style={{ color: NAVY }}>{fN(r.unidades)}</b> },
    { key: 'valor_costo', label: 'Valor a costo', width: 115, align: 'right', render: r => fmt(r.valor_costo) },
    { key: 'venta_recuperable', label: 'Venta recuperable', width: 120, align: 'right', render: r => <span style={{ color: VERDE }}>{fmt(r.venta_recuperable)}</span> },
    { key: 'ruta', label: 'Ruta', width: 110, render: r => <Tag texto={r.ruta} color={r.ruta === 'Santiago' ? VERDE : AMBAR} /> },
    { key: 'criterio', label: 'Criterio', width: 280 },
  ],
  posiciones: [
    { key: 'codigos', label: 'Posición', width: 130 },
    { key: 'sucursal_id', label: 'Bodega', width: 100, value: r => nombreSuc(r.sucursal_id) },
    { key: 'sku', label: 'SKU', width: 120 },
    { key: 'producto', label: 'Producto', width: 240 },
    { key: 'tipo_producto', label: 'Categoría', width: 150 },
    { key: 'uso', label: 'Uso', width: 140, render: r => <Tag texto={r.uso} color={CL_USO[r.uso]} /> },
    { key: 'capacidad', label: 'Capacidad', width: 85, align: 'right', render: r => fN(r.capacidad) },
    { key: 'nivel_minimo', label: 'Debe guardar mín.', width: 110, align: 'right', render: r => r.nivel_minimo == null ? '—' : fN(r.nivel_minimo) },
    { key: 'nivel_objetivo', label: 'Debe guardar máx.', width: 110, align: 'right', render: r => r.nivel_objetivo == null ? '—' : fN(r.nivel_objetivo) },
    { key: 'stock', label: 'Stock hoy', width: 82, align: 'right', render: r => fN(r.stock) },
    { key: 'pct_ocupacion', label: 'Ocupación', width: 82, align: 'right', render: r => r.pct_ocupacion == null ? '—' : fN(r.pct_ocupacion) + '%' },
    { key: 'capacidad_ociosa', label: 'Capacidad ociosa', width: 105, align: 'right', render: r => +r.capacidad_ociosa > 0 ? fN(r.capacidad_ociosa) : '—' },
    { key: 'capacidad_faltante', label: 'Le falta', width: 80, align: 'right', render: r => +r.capacidad_faltante > 0 ? fN(r.capacidad_faltante) : '—' },
    { key: 'unid_desbordadas', label: 'Unid. sin lugar', width: 95, align: 'right', render: r => +r.unid_desbordadas > 0 ? fN(r.unid_desbordadas) : '—' },
    { key: 'venta_perdida_84d', label: 'Venta perdida 84d', width: 118, align: 'right', render: r => +r.venta_perdida_84d > 0 ? fmt(r.venta_perdida_84d) : '—' },
    { key: 'ultimo_mov_fisico', label: 'Últ. mov. físico', width: 105 },
  ],
}

/* Columnas que van al PDF (el papel no admite 20 columnas) */
const PDF = {
  productos: ['sku', 'producto', 'tipo_producto', 'sucursal_id', 'nivel', 'estado', 'stock', 'valor_costo', 'demanda_dia', 'metodo', 'dias_cobertura', 'venta_perdida_84d', 'accion'],
  movimientos: ['tipo', 'sku', 'producto', 'origen', 'destino', 'unidades', 'valor_costo', 'venta_recuperable', 'ruta'],
  posiciones: ['codigos', 'sku', 'producto', 'uso', 'capacidad', 'stock', 'capacidad_ociosa', 'unid_desbordadas'],
}
const NUMERICAS = new Set(['dias_inmovil', 'stock', 'valor_costo', 'dias_cobertura', 'venta_perdida_84d', 'unidades',
  'venta_recuperable', 'capacidad', 'capacidad_ociosa', 'unid_desbordadas'])

export const TITULOS_BASE = {
  productos: 'Productos por bodega', movimientos: 'Movimientos sugeridos', posiciones: 'Posiciones de bodega',
}

const uniq = (rows, k) => [...new Set(rows.map(r => r[k]).filter(v => v != null && v !== ''))].sort()

function Selector({ etiqueta, valor, opciones, onCambio, nombre = x => x, disabled }) {
  return (
    <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, fontSize: 9.5, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.4 }}>
      {etiqueta}
      <select value={valor ?? ''} onChange={e => onCambio(e.target.value || undefined)} disabled={disabled}
              style={{ ...inputEstilo, fontSize: 12, textTransform: 'none', letterSpacing: 0, fontWeight: 500, minWidth: 130 }}>
        <option value="">Todas</option>
        {opciones.map(o => <option key={o} value={o}>{nombre(o)}</option>)}
      </select>
    </label>
  )
}

export function InvBase({ dataset = 'productos', filas = [], consulta, setFiltros, onVolver, origenNombre, onProducto, cfg, scope, cargando }) {
  const filtros = useMemo(() => consulta?.filtros || {}, [consulta])
  const base = useMemo(() => scope ? filas.filter(r => [r.sucursal_id, r.origen, r.destino].includes(scope)) : filas, [filas, scope])
  const visibles = useMemo(() => aplicarFiltros(base, filtros), [base, filtros])
  const pastillas = describirFiltros(filtros)
  const uno = k => Array.isArray(filtros[k]) ? (filtros[k].length === 1 ? filtros[k][0] : undefined) : filtros[k]
  const poner = (k, v) => setFiltros({ ...filtros, [k]: v === undefined ? undefined : [v] })
  const quitar = k => { const f = { ...filtros }; delete f[k]; setFiltros(f) }

  const suma = c => visibles.reduce((a, r) => a + (+r[c] || 0), 0)
  const cols = COLS[dataset]

  const pdf = () => tablaPdf({
    titulo: `Inventario · ${TITULOS_BASE[dataset]}`,
    sub: consulta?.titulo || pastillas.map(p => p.texto).join(' · ') || 'Sin filtros',
    nombre: `inventario_${dataset}`, orientacion: 'landscape',
    filas: visibles,
    cols: PDF[dataset].map(k => {
      const c = cols.find(x => x.key === k)
      // La venta promedio lleva decimales: va como texto (el exportador redondea los números a enteros)
      if (k === 'demanda_dia') return { k, l: 'Venta prom./día', crudo: r => fD(r.demanda_dia, 2) }
      return { k, l: c.label, num: NUMERICAS.has(k), crudo: c.value || (r => r[k]) }
    }),
  })

  const [generando, setGenerando] = useState(false)
  const pdfProyeccion = async () => {
    // Un ítem por producto, ordenados por venta. Con una sola sala filtrada, la proyección es de esa sala; si no, de la red.
    const bod = uno('sucursal_id')
    const venta = new Map()
    for (const r of visibles) venta.set(r.sku, (venta.get(r.sku) || 0) + (+r.venta_84d || 0))
    const skus = [...venta.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
    if (!skus.length) return
    const elegidos = skus.slice(0, TOPE_PROYECCION)
    const id = toast.loading(`Armando ${elegidos.length} fichas con proyección…`)
    setGenerando(true)
    try {
      const serie = await fetchSerieMensual(elegidos)
      pdfProductos({
        items: elegidos.map(sku => {
          const filasSku = filas.filter(r => r.sku === sku)
          const sala = bod && filasSku.some(r => r.sucursal_id === bod && r.vende) ? bod : 'red'
          return { sku, filas: filasSku, serie: serie.filter(x => x.sku === sku), ambito: sala }
        }),
        sub: (consulta?.titulo || pastillas.map(p => p.texto).join(' · ') || 'Sin filtros') + (skus.length > TOPE_PROYECCION ? ` · ${TOPE_PROYECCION} de ${skus.length} productos, los de mayor venta` : ''),
        archivo: 'proyeccion_productos', cfg,
      })
      toast.success(skus.length > TOPE_PROYECCION ? `PDF con los ${TOPE_PROYECCION} productos de mayor venta (de ${skus.length})` : 'PDF descargado', { id })
    } catch (e) { toast.error('No se pudo generar: ' + e.message, { id }) }
    setGenerando(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Contexto: de dónde viene y qué se está viendo */}
      {(consulta?.titulo || onVolver) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {onVolver && <Enlace onClick={onVolver}>← Volver a {origenNombre}</Enlace>}
          {consulta?.titulo && <div style={{ fontSize: 13, color: INK, fontWeight: 600 }}>{consulta.titulo}</div>}
        </div>
      )}

      {/* Filtros rápidos + pastillas */}
      <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {dataset === 'productos' && <>
            <Selector etiqueta="Bodega" valor={uno('sucursal_id')} opciones={SUCURSALES.map(s => s.id)} nombre={nombreSuc}
                      onCambio={v => poner('sucursal_id', v)} disabled={!!scope} />
            <Selector etiqueta="Situación" valor={uno('nivel')} opciones={nivelesDesde(cfg).map(n => n.k)} nombre={k => NOMBRE_NIVEL[k]}
                      onCambio={v => poner('nivel', v)} />
            <Selector etiqueta="Reposición" valor={uno('estado')} opciones={ESTADOS} onCambio={v => poner('estado', v)} />
            <Selector etiqueta="Categoría" valor={uno('tipo_producto')} opciones={uniq(base, 'tipo_producto')} onCambio={v => poner('tipo_producto', v)} />
            <Selector etiqueta="Familia" valor={uno('familia')} opciones={uniq(base, 'familia')} onCambio={v => poner('familia', v)} />
            <Selector etiqueta="Qué hacer" valor={uno('accion')} opciones={Object.keys(ACCIONES)} onCambio={v => poner('accion', v)} />
          </>}
          {dataset === 'movimientos' && <>
            <Selector etiqueta="Movimiento" valor={uno('tipo')} opciones={['Desde CD', 'Entre salas']} onCambio={v => poner('tipo', v)} />
            <Selector etiqueta="Desde" valor={uno('origen')} opciones={uniq(base, 'origen')} nombre={nombreSuc} onCambio={v => poner('origen', v)} />
            <Selector etiqueta="Hacia" valor={uno('destino')} opciones={uniq(base, 'destino')} nombre={nombreSuc} onCambio={v => poner('destino', v)} />
            <Selector etiqueta="Ruta" valor={uno('ruta')} opciones={['Santiago', 'larga distancia']} onCambio={v => poner('ruta', v)} />
            <Selector etiqueta="Categoría" valor={uno('tipo_producto')} opciones={uniq(base, 'tipo_producto')} onCambio={v => poner('tipo_producto', v)} />
            <Selector etiqueta="Familia" valor={uno('familia')} opciones={uniq(base, 'familia')} onCambio={v => poner('familia', v)} />
          </>}
          {dataset === 'posiciones' && <>
            <Selector etiqueta="Bodega" valor={uno('sucursal_id')} opciones={uniq(base, 'sucursal_id')} nombre={nombreSuc}
                      onCambio={v => poner('sucursal_id', v)} disabled={!!scope} />
            <Selector etiqueta="Uso" valor={uno('uso')} opciones={usosDesde(cfg).map(u => u.k)} onCambio={v => poner('uso', v)} />
            <Selector etiqueta="Categoría" valor={uno('tipo_producto')} opciones={uniq(base, 'tipo_producto')} onCambio={v => poner('tipo_producto', v)} />
          </>}
          <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, fontSize: 9.5, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.4, flex: '1 1 200px' }}>
            Buscar
            <input value={filtros.q || ''} onChange={e => setFiltros({ ...filtros, q: e.target.value || undefined })}
                   placeholder="SKU o nombre del producto" style={{ ...inputEstilo, fontSize: 12, textTransform: 'none', letterSpacing: 0, fontWeight: 500 }} />
          </label>
        </div>
        {pastillas.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: SLATE }}>Filtrando por:</span>
            {pastillas.map(p => (
              <button key={p.k} onClick={() => quitar(p.k)} title="Quitar este filtro"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 12, cursor: 'pointer',
                               border: `1px solid ${NAVY}33`, background: TINTE, color: NAVY, fontSize: 11.5, fontWeight: 600, font: 'inherit' }}>
                {p.texto} <span aria-hidden="true" style={{ opacity: 0.6 }}>✕</span>
              </button>
            ))}
            <Enlace onClick={() => setFiltros({})} color={ROJO}>Limpiar todo</Enlace>
          </div>
        )}
      </div>

      {/* Resumen del conjunto filtrado */}
      <KpiStrip>
        {dataset === 'productos' && <>
          <KpiCelda l="Filas" v={fN(visibles.length)} sub={`${fN(new Set(visibles.map(r => r.sku)).size)} productos distintos`} color={NAVY} />
          <KpiCelda l="Unidades" v={fN(suma('stock'))} />
          <KpiCelda l="Capital a costo" v={fmt(suma('valor_costo'))} color={NAVY} />
          <KpiCelda l="Venta promedio" v={fD(visibles.reduce((a, r) => a + (r.vende ? +r.demanda_dia || 0 : 0), 0), 1) + ' /día'}
                    sub={`${fD(visibles.reduce((a, r) => a + (r.vende ? +r.demanda_dia || 0 : 0), 0) * DIAS_MES, 0)} unid. al mes · salas`} color={VERDE} />
          <KpiCelda l="Venta perdida 84d" v={fmt(suma('venta_perdida_84d'))} color={suma('venta_perdida_84d') > 0 ? ROJO : SLATE} />
          <KpiCelda l="Por reponer" v={fN(visibles.reduce((a, r) => a + (r.vende ? +r.sugerido || 0 : 0), 0)) + ' unid.'} color={AMBAR} />
          <KpiCelda l="Sobre el objetivo" v={fN(suma('unid_exceso')) + ' unid.'} color={MORADO} />
        </>}
        {dataset === 'movimientos' && <>
          <KpiCelda l="Movimientos" v={fN(visibles.length)} color={NAVY} />
          <KpiCelda l="Unidades" v={fN(suma('unidades'))} />
          <KpiCelda l="Valor a costo" v={fmt(suma('valor_costo'))} color={NAVY} />
          <KpiCelda l="Venta recuperable" v={fmt(suma('venta_recuperable'))} color={VERDE} />
        </>}
        {dataset === 'posiciones' && <>
          <KpiCelda l="Posiciones" v={fN(visibles.reduce((a, r) => a + (+r.posiciones || 1), 0))} color={NAVY} />
          <KpiCelda l="Capacidad" v={fN(suma('capacidad')) + ' unid.'} />
          <KpiCelda l="Stock hoy" v={fN(suma('stock')) + ' unid.'} />
          <KpiCelda l="Capacidad ociosa" v={fN(suma('capacidad_ociosa')) + ' unid.'} color={MORADO} />
          <KpiCelda l="Le falta" v={fN(suma('capacidad_faltante')) + ' unid.'} color={AMBAR} />
          <KpiCelda l="Sin lugar" v={fN(suma('unid_desbordadas')) + ' unid.'} color={ROJO} />
        </>}
      </KpiStrip>

      <div style={{ height: 'calc(100vh - 330px)', minHeight: 420 }}>
        <DataGrid key={dataset} title={`${TITULOS_BASE[dataset]} · ${fN(visibles.length)} filas`} exportName={`inventario_${dataset}`}
          columns={cols} rows={visibles} loading={cargando}
          getRowId={r => dataset === 'movimientos' ? `${r.tipo}|${r.sku}|${r.origen}|${r.destino}` : `${r.sku}|${r.sucursal_id}|${r.codigos || ''}`}
          onRowClick={r => r.sku && onProducto(r.sku)}
          emptyText={pastillas.length ? 'Ninguna fila cumple estos filtros. Quita alguno para ampliar la búsqueda.' : 'Sin datos'}
          toolbar={<span style={{ display: 'inline-flex', gap: 6 }}>
            <button onClick={pdf} disabled={!visibles.length} title="Informe PDF de lo filtrado (tabla)" style={btnBarra}>PDF</button>
            {dataset === 'productos' && (
              <button onClick={pdfProyeccion} disabled={!visibles.length || generando} style={btnBarra}
                      title={`Una página por producto: cómo se calcula su venta promedio, meses usados y proyección (hasta ${TOPE_PROYECCION})`}>
                {generando ? 'Generando…' : 'PDF con proyección'}</button>)}
          </span>} />
      </div>
      <div style={{ fontSize: 11, color: SLATE }}>
        Clic en una fila abre la ficha del producto. La grilla permite ordenar, filtrar por columna, cambiar el ancho y el orden de las columnas, y exportar a Excel lo que se está viendo.
      </div>
    </div>
  )
}

const btnBarra = { fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer', color: NAVY, fontWeight: 600 }
