// src/procesos/PrcMatriz.jsx — vista tabla de los 22 procesos con filtros y edición en línea
import { useState, useMemo } from 'react'
import { supabase } from '../supabase'
import { Cd, Bd, Bt, Barra, css, pct, SEMAFORO, ESTADO_CORTO, Criterios, Vacio, puedeEditar, descargar, Ayuda } from './prcUI'

const COLS = [
  { k: 'id', l: 'ID', w: 54 },
  { k: 'nombre', l: 'Proceso', w: 340 },
  { k: 'categoria', l: 'Cat.', w: 78 },
  { k: 'onda', l: 'Onda', w: 74 },
  { k: 'dueno', l: 'Dueño', w: 170 },
  { k: 'comite_codigo', l: 'Comité', w: 92 },
  { k: 'score', l: 'Score', w: 58, num: true },
  { k: 'estado_sop', l: 'SOP', w: 132 },
  { k: 'estado_flujograma', l: 'Flujo', w: 132 },
  { k: 'estado_implementacion', l: 'Implementación', w: 138 },
  { k: 'criterios', l: 'S·F·C·M', w: 112 },
  { k: 'pct_global', l: 'Avance', w: 108, num: true },
  { k: 'dias_atraso', l: 'Atraso', w: 72, num: true }
]

export function PrcMatriz({ matriz, cat, cu, onAbrir, onRecargar, toast }) {
  const [f, setF] = useState({ cat: '', onda: '', dir: '', comite: '', impl: '', q: '', soloRiesgo: false, soloSinDueno: false })
  const [orden, setOrden] = useState({ k: 'score', asc: false })
  const [guardando, setGuardando] = useState(null)
  const editable = puedeEditar(cu)

  const estadoDoc = c => cat.estadosDoc.find(x => x.codigo === c) || { etiqueta: c, color: 'var(--text-muted)' }
  const estadoImpl = c => cat.estadosImpl.find(x => x.codigo === c) || { etiqueta: c, color: 'var(--text-muted)' }
  const categoria = c => cat.categorias.find(x => x.codigo === c) || { nombre: c, color: 'var(--text-muted)' }

  const fil = useMemo(() => {
    let l = matriz.filter(p => {
      if (f.cat && p.categoria !== f.cat) return false
      if (f.onda && p.onda !== f.onda) return false
      if (f.dir && p.direccion_responsable !== f.dir) return false
      if (f.comite && p.comite_codigo !== f.comite) return false
      if (f.impl && p.estado_implementacion !== f.impl) return false
      if (f.soloRiesgo && p.semaforo !== 'rojo') return false
      if (f.soloSinDueno && !p.dueno_provisional) return false
      if (f.q) {
        const q = f.q.toLowerCase()
        const blob = [p.id, p.nombre, p.dueno_cargo, p.dueno_persona, p.objetivo].filter(Boolean).join(' ').toLowerCase()
        if (!blob.includes(q)) return false
      }
      return true
    })
    const dir = orden.asc ? 1 : -1
    l = [...l].sort((a, b) => {
      const va = orden.k === 'dueno' ? (a.dueno_persona || a.dueno_cargo || '') : a[orden.k]
      const vb = orden.k === 'dueno' ? (b.dueno_persona || b.dueno_cargo || '') : b[orden.k]
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va ?? '').localeCompare(String(vb ?? ''), 'es') * dir
    })
    return l
  }, [matriz, f, orden])

  const cambiarEstado = async (p, campo, valor) => {
    setGuardando(p.id + campo)
    const { error } = await supabase.from('prc_procesos').update({ [campo]: valor }).eq('id', p.id)
    setGuardando(null)
    if (error) {
      toast(error.message.includes('IMPLEMENTADO')
        ? 'No se puede marcar como implementado: faltan criterios (SOP aprobado, flujograma vigente, capacitación y una medición de KPI).'
        : 'Error al guardar: ' + error.message, 'err')
      return
    }
    toast(`${p.id} actualizado`)
    onRecargar()
  }

  const exportar = () => {
    const cols = ['id', 'nombre', 'categoria', 'direccion_responsable', 'comite_codigo', 'dueno_cargo', 'dueno_persona',
      'onda', 'impacto', 'urgencia', 'score', 'estado_sop', 'estado_flujograma', 'estado_implementacion',
      'pct_flujograma', 'pct_sop', 'pct_capacitacion', 'pct_implementacion', 'pct_global',
      'fecha_objetivo_vigente', 'dias_atraso', 'semaforo', 'sop_aprobado', 'flujograma_ok', 'capacitacion_ok', 'medicion_ok']
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [cols.join(';'), ...fil.map(p => cols.map(c => esc(p[c])).join(';'))].join('\n')
    descargar(`Matriz_Procesos_ODP_${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + csv, 'text/csv;charset=utf-8')
  }

  const th = (c) => (
    <th key={c.k} style={{ ...css.th, width: c.w, textAlign: c.num ? 'right' : 'left', cursor: 'pointer' }}
      onClick={() => setOrden(o => ({ k: c.k, asc: o.k === c.k ? !o.asc : false }))}>
      {c.l}{orden.k === c.k ? (orden.asc ? ' ↑' : ' ↓') : ''}
    </th>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      <Ayuda k="matriz" titulo="Cómo usar la matriz">
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          <li><b>Clic en el ID o el nombre</b> del proceso para abrir su ficha: ahí se edita, se firma y se registra todo.</li>
          <li><b>Score</b> = impacto × urgencia. 9 es máxima prioridad. La tabla viene ordenada por score; clic en
            cualquier encabezado para reordenar.</li>
          <li><b>Las tres columnas de estado son editables acá mismo</b>: cambia el selector y se guarda al instante.</li>
          <li><b>S · F · C · M</b> son los cuatro requisitos para dar un proceso por implementado: SOP aprobado,
            Flujograma vigente, Capacitación registrada y Medición de KPI. Verde es cumplido. Pasa el mouse por
            encima para ver cuál es cuál.</li>
          <li><b>Atraso</b> son los días transcurridos desde la fecha objetivo. La barra de color a la izquierda de
            cada fila es el semáforo de riesgo.</li>
        </ul>
      </Ayuda>
      <Cd style={{ padding: 13 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="Buscar proceso, dueño u objetivo…" value={f.q}
            onChange={e => setF({ ...f, q: e.target.value })}
            style={{ ...css.input, width: 260, padding: '7px 11px' }} />
          <select style={css.select} value={f.cat} onChange={e => setF({ ...f, cat: e.target.value })}>
            <option value="">Todas las categorías</option>
            {cat.categorias.map(c => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
          </select>
          <select style={css.select} value={f.onda} onChange={e => setF({ ...f, onda: e.target.value })}>
            <option value="">Todas las ondas</option>
            {cat.ondas.map(o => <option key={o.codigo} value={o.codigo}>{o.nombre}</option>)}
          </select>
          <select style={css.select} value={f.dir} onChange={e => setF({ ...f, dir: e.target.value })}>
            <option value="">Todas las direcciones</option>
            {cat.direcciones.map(d => <option key={d.codigo} value={d.codigo}>{d.etiqueta}</option>)}
          </select>
          <select style={css.select} value={f.comite} onChange={e => setF({ ...f, comite: e.target.value })}>
            <option value="">Todos los comités</option>
            {cat.comites.map(c => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
          </select>
          <select style={css.select} value={f.impl} onChange={e => setF({ ...f, impl: e.target.value })}>
            <option value="">Cualquier estado</option>
            {cat.estadosImpl.map(e => <option key={e.codigo} value={e.codigo}>{e.etiqueta}</option>)}
          </select>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
            <input type="checkbox" checked={f.soloRiesgo} onChange={e => setF({ ...f, soloRiesgo: e.target.checked })} /> Solo en riesgo
          </label>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
            <input type="checkbox" checked={f.soloSinDueno} onChange={e => setF({ ...f, soloSinDueno: e.target.checked })} /> Sin dueño real
          </label>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fil.length} de {matriz.length}</span>
            <Bt v="sec" sm onClick={exportar} title="Baja la matriz filtrada como planilla, para el comité o para Excel">Exportar CSV</Bt>
          </div>
        </div>
      </Cd>

      <Cd style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{COLS.map(th)}</tr></thead>
            <tbody>
              {fil.map(p => {
                const s = SEMAFORO[p.semaforo] || SEMAFORO.gris
                const c = categoria(p.categoria)
                return (
                  <tr key={p.id} style={{ background: 'var(--bg-surface)' }}>
                    <td style={{ ...css.td, fontWeight: 800, fontFamily: 'ui-monospace, monospace', borderLeft: `3px solid ${s.c}` }}>
                      <span onClick={() => onAbrir(p.id)} style={{ cursor: 'pointer', color: 'var(--accent)' }}>{p.id}</span>
                    </td>
                    <td style={css.td}>
                      <div onClick={() => onAbrir(p.id)} style={{ cursor: 'pointer', fontWeight: 600, maxWidth: 330 }}>{p.nombre}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 330, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.objetivo}
                      </div>
                    </td>
                    <td style={css.td}><Bd c={c.color}>{p.categoria}</Bd></td>
                    <td style={css.td}><span style={{ fontSize: 11.5 }}>{String(p.onda || '').replace('ONDA_', 'Onda ')}</span></td>
                    <td style={css.td}>
                      <div style={{ fontSize: 12 }}>{p.dueno_persona || p.dueno_cargo || '—'}</div>
                      {p.dueno_provisional && <Bd c="var(--warning)">provisional</Bd>}
                    </td>
                    <td style={css.td}><span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{p.comite_codigo || '—'}</span></td>
                    <td style={{ ...css.td, textAlign: 'right' }}>
                      <span style={{
                        display: 'inline-block', minWidth: 24, padding: '2px 6px', borderRadius: 7, fontWeight: 800, fontSize: 12,
                        background: p.score === 9 ? 'var(--danger-bg)' : p.score >= 6 ? 'var(--warning-bg)' : 'var(--bg-page)',
                        color: p.score === 9 ? 'var(--danger-text)' : p.score >= 6 ? 'var(--warning-text)' : 'var(--text-muted)'
                      }}>{p.score}</span>
                    </td>
                    <td style={css.td}>
                      {editable ? (
                        <select value={p.estado_sop} disabled={guardando === p.id + 'estado_sop'}
                          onChange={e => cambiarEstado(p, 'estado_sop', e.target.value)}
                          style={{ ...css.select, padding: '3px 5px', fontSize: 11, width: '100%' }}>
                          {cat.estadosDoc.map(e => <option key={e.codigo} value={e.codigo}>{ESTADO_CORTO[e.codigo] || e.etiqueta}</option>)}
                        </select>
                      ) : <Bd c={estadoDoc(p.estado_sop).color}>{estadoDoc(p.estado_sop).etiqueta}</Bd>}
                    </td>
                    <td style={css.td}>
                      {editable ? (
                        <select value={p.estado_flujograma} disabled={guardando === p.id + 'estado_flujograma'}
                          onChange={e => cambiarEstado(p, 'estado_flujograma', e.target.value)}
                          style={{ ...css.select, padding: '3px 5px', fontSize: 11, width: '100%' }}>
                          {cat.estadosDoc.map(e => <option key={e.codigo} value={e.codigo}>{ESTADO_CORTO[e.codigo] || e.etiqueta}</option>)}
                        </select>
                      ) : <Bd c={estadoDoc(p.estado_flujograma).color}>{estadoDoc(p.estado_flujograma).etiqueta}</Bd>}
                    </td>
                    <td style={css.td}>
                      {editable ? (
                        <select value={p.estado_implementacion} disabled={guardando === p.id + 'estado_implementacion'}
                          onChange={e => cambiarEstado(p, 'estado_implementacion', e.target.value)}
                          style={{
                            ...css.select, padding: '3px 5px', fontSize: 11, width: '100%',
                            color: estadoImpl(p.estado_implementacion).color, fontWeight: 700
                          }}>
                          {cat.estadosImpl.map(e => <option key={e.codigo} value={e.codigo}>{e.etiqueta}</option>)}
                        </select>
                      ) : <Bd c={estadoImpl(p.estado_implementacion).color}>{estadoImpl(p.estado_implementacion).etiqueta}</Bd>}
                    </td>
                    <td style={css.td}><Criterios p={p} compacto /></td>
                    <td style={{ ...css.td, textAlign: 'right' }}>
                      <div style={{ width: 92, marginLeft: 'auto' }}><Barra v={p.pct_global} c={s.c} h={6} /></div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>{pct(p.pct_global)}</div>
                    </td>
                    <td style={{ ...css.td, textAlign: 'right' }}>
                      {p.dias_atraso > 0
                        ? <Bd c={p.dias_atraso > 60 ? 'var(--danger)' : 'var(--warning)'}>{p.dias_atraso} d</Bd>
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {fil.length === 0 && <Vacio txt="Ningún proceso coincide con los filtros" />}
      </Cd>
    </div>
  )
}
