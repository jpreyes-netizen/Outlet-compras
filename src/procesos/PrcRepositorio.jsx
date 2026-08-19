// src/procesos/PrcRepositorio.jsx — repositorio documental versionado
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { Cd, Bt, Bd, Sheet, Markdown, Vacio, css, fFecha, descargar } from './prcUI'

const ESTADO_C = {
  VIGENTE: 'var(--success)', BORRADOR: 'var(--warning)', DEROGADO: 'var(--text-muted)',
  POR_OFICIALIZAR: 'var(--info)', EXISTE_COMPLETO: 'var(--info)', EXISTE_PARCIAL: 'var(--warning)'
}

export function PrcRepositorio({ matriz, cu, onAbrir, toast }) {
  const [docs, setDocs] = useState([])
  const [firmas, setFirmas] = useState([])
  const [loading, setLoading] = useState(true)
  const [f, setF] = useState({ tipo: '', estado: '', q: '', soloVigentes: false })
  const [ver, setVer] = useState(null)

  useEffect(() => {
    let cancel = false
    ;(async () => {
      const [d, s] = await Promise.all([
        supabase.from('prc_documentos').select('*').order('proceso_id').order('version', { ascending: false }),
        supabase.from('prc_firmas').select('documento_id, accion, nombre_usuario, fecha')
      ])
      if (cancel) return
      setDocs(d.data || []); setFirmas(s.data || []); setLoading(false)
    })()
    return () => { cancel = true }
  }, [])

  const nombreProc = id => (matriz.find(p => p.id === id) || {}).nombre || id

  const fil = useMemo(() => docs.filter(d => {
    if (f.tipo && d.tipo !== f.tipo) return false
    if (f.estado && d.estado !== f.estado) return false
    if (f.soloVigentes && !d.es_vigente) return false
    if (f.q) {
      const q = f.q.toLowerCase()
      if (![d.codigo, d.nombre_archivo, d.proceso_id, nombreProc(d.proceso_id)].join(' ').toLowerCase().includes(q)) return false
    }
    return true
  }), [docs, f, matriz])

  const k = useMemo(() => ({
    total: docs.length,
    vigentes: docs.filter(d => d.es_vigente).length,
    borradores: docs.filter(d => d.estado === 'BORRADOR').length,
    porAprobar: docs.filter(d => d.estado === 'POR_OFICIALIZAR').length,
    vigenteSinAprobador: docs.filter(d => d.es_vigente && !d.aprobado_por).length,
    revisionVencida: docs.filter(d => d.es_vigente && d.proxima_revision && d.proxima_revision < new Date().toISOString().slice(0, 10)).length
  }), [docs])

  const firmasDe = id => firmas.filter(x => x.documento_id === id)

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando repositorio…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 10 }}>
        {[
          { l: 'Documentos', v: k.total },
          { l: 'Vigentes', v: k.vigentes, c: 'var(--success)' },
          { l: 'En borrador', v: k.borradores, c: 'var(--warning)' },
          { l: 'Por oficializar', v: k.porAprobar, c: 'var(--info)' },
          { l: 'Vigentes sin aprobador', v: k.vigenteSinAprobador, c: k.vigenteSinAprobador ? 'var(--danger)' : 'var(--success)' },
          { l: 'Revisión vencida', v: k.revisionVencida, c: k.revisionVencida ? 'var(--danger)' : 'var(--success)' }
        ].map(x => (
          <Cd key={x.l} style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>{x.l}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: x.c || 'var(--text-primary)' }}>{x.v}</div>
          </Cd>
        ))}
      </div>

      <Cd style={{ padding: 13 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="Buscar documento o proceso…" value={f.q} onChange={e => setF({ ...f, q: e.target.value })}
            style={{ ...css.input, width: 260, padding: '7px 11px' }} />
          <select style={css.select} value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })}>
            <option value="">Todos los tipos</option>
            {['SOP', 'FLUJOGRAMA', 'FORMULARIO', 'ANEXO', 'REGISTRO', 'MANUAL'].map(t => <option key={t}>{t}</option>)}
          </select>
          <select style={css.select} value={f.estado} onChange={e => setF({ ...f, estado: e.target.value })}>
            <option value="">Cualquier estado</option>
            {['BORRADOR', 'EXISTE_PARCIAL', 'EXISTE_COMPLETO', 'POR_OFICIALIZAR', 'VIGENTE', 'DEROGADO'].map(t => <option key={t}>{t}</option>)}
          </select>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
            <input type="checkbox" checked={f.soloVigentes} onChange={e => setF({ ...f, soloVigentes: e.target.checked })} /> Solo vigentes
          </label>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{fil.length} de {docs.length}</span>
        </div>
      </Cd>

      <Cd style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={css.th}>Código</th><th style={css.th}>Proceso</th><th style={css.th}>Tipo</th>
              <th style={css.th}>Versión</th><th style={css.th}>Estado</th><th style={css.th}>Emisión</th>
              <th style={css.th}>Vigencia</th><th style={css.th}>Aprobó</th><th style={css.th}>Firmas</th>
              <th style={css.th}>Próx. revisión</th><th style={css.th}></th>
            </tr></thead>
            <tbody>{fil.map(d => {
              const venc = d.es_vigente && d.proxima_revision && d.proxima_revision < new Date().toISOString().slice(0, 10)
              return (
                <tr key={d.id} style={{ background: d.es_vigente ? 'var(--bg-surface)' : 'transparent' }}>
                  <td style={{ ...css.td, fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>
                    {d.codigo}{d.es_vigente && <Bd c="var(--success)" style={{ marginLeft: 6 }}>vigente</Bd>}
                  </td>
                  <td style={css.td}>
                    <span onClick={() => onAbrir(d.proceso_id)} style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 600 }}>
                      {d.proceso_id}
                    </span>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{nombreProc(d.proceso_id)}</div>
                  </td>
                  <td style={css.td}><Bd c={d.tipo === 'SOP' ? 'var(--accent)' : 'var(--info)'}>{d.tipo}</Bd></td>
                  <td style={css.td}>v{d.version}</td>
                  <td style={css.td}>
                    <Bd c={ESTADO_C[d.estado] || 'var(--info)'}>{d.estado}</Bd>
                  </td>
                  <td style={css.td}>{fFecha(d.fecha_emision)}</td>
                  <td style={css.td}>{fFecha(d.fecha_vigencia)}</td>
                  <td style={css.td}>{d.aprobado_por || <span style={{ color: 'var(--danger)' }}>pendiente</span>}</td>
                  <td style={css.td}>{firmasDe(d.id).length}</td>
                  <td style={css.td}>
                    {d.proxima_revision
                      ? <span style={{ color: venc ? 'var(--danger)' : 'inherit', fontWeight: venc ? 700 : 400 }}>{fFecha(d.proxima_revision)}</span>
                      : '—'}
                  </td>
                  <td style={{ ...css.td, whiteSpace: 'nowrap' }}>
                    {d.contenido_md && <Bt v="ghost" sm onClick={() => setVer(d)}>Ver</Bt>}
                    {d.contenido_md && <Bt v="ghost" sm onClick={() => descargar(d.nombre_archivo, d.contenido_md, 'text/markdown;charset=utf-8')}>↓</Bt>}
                    {d.url_drive && <a href={d.url_drive} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', marginLeft: 6 }}>Drive</a>}
                  </td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
        {fil.length === 0 && <Vacio txt="Sin documentos que coincidan" ic="📁" />}
      </Cd>

      <Sheet open={!!ver} onClose={() => setVer(null)} ancho={900}
        title={ver ? `${ver.codigo} v${ver.version} · ${ver.estado}` : ''}>
        {ver && <div style={{ maxHeight: '70vh', overflowY: 'auto' }}><Markdown md={ver.contenido_md} /></div>}
      </Sheet>
    </div>
  )
}
