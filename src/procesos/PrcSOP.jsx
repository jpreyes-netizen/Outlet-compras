// src/procesos/PrcSOP.jsx — visor del SOP, generación de versiones y firmas
import { useState, useMemo } from 'react'
import { supabase } from '../supabase'
import { sopMarkdown, hashContenido, siguienteVersion } from './prcSop'
import {
  Cd, Bt, Bd, Sheet, Markdown, Vacio, css, hoy, hora, fFecha,
  puedeAprobar, puedeEditar, descargar
} from './prcUI'

const ACCIONES = {
  ELABORA:  { l: 'Elaborar',  c: 'var(--text-muted)', desc: 'Registra la autoría del borrador.' },
  REVISA:   { l: 'Revisar',   c: 'var(--info)',       desc: 'Deja el documento como POR OFICIALIZAR, listo para el comité.' },
  APRUEBA:  { l: 'Aprobar',   c: 'var(--success)',    desc: 'Lo deja VIGENTE, deroga la versión anterior y fija la próxima revisión.' },
  RECHAZA:  { l: 'Rechazar',  c: 'var(--danger)',     desc: 'Devuelve el documento a BORRADOR con la observación registrada.' },
  DEROGA:   { l: 'Derogar',   c: 'var(--warning)',    desc: 'Quita la vigencia sin reemplazo.' }
}

export function PrcSOP({ proceso, bundle, matriz, comites, cu, docs, firmas, onRecargar, toast }) {
  const [verDoc, setVerDoc] = useState(null)
  const [firmando, setFirmando] = useState(null)     // {doc, accion}
  const [comentario, setComentario] = useState('')
  const [busy, setBusy] = useState(false)

  const sops = useMemo(() => docs.filter(d => d.tipo === 'SOP')
    .sort((a, b) => String(b.version).localeCompare(String(a.version), undefined, { numeric: true })), [docs])
  const vigente = sops.find(d => d.es_vigente)
  const actual = verDoc ? sops.find(d => d.id === verDoc) : (vigente || sops[0])
  const comiteNombre = (comites.find(c => c.codigo === proceso.comite_codigo) || {}).nombre || '—'

  // Vista previa en vivo. Si hay una versión seleccionada sin markdown guardado
  // (por ejemplo un documento cargado desde la semilla), se rinde con SU versión
  // y estado, no con el número de la siguiente.
  const previa = useMemo(() => sopMarkdown({
    proceso, ...bundle, procesosRef: matriz, comiteNombre,
    meta: {
      version: actual?.version || siguienteVersion(sops[0]?.version || '0.0'),
      estado: actual?.estado || 'BORRADOR', fecha: actual?.fecha_emision || hoy(),
      elaborado_por: actual?.elaborado_por || cu?.nombre || '—',
      revisado_por: actual?.revisado_por, aprobado_por: actual?.aprobado_por,
      meses_revision: proceso.meses_revision || 6
    }
  }), [proceso, bundle, matriz, comiteNombre, sops, cu, actual])

  const md = actual?.contenido_md || previa
  const firmasDoc = d => firmas.filter(f => f.documento_id === d?.id)
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))

  /* ── generar nueva versión con snapshot inmutable ───────────────────────── */
  const generarVersion = async () => {
    if (!puedeEditar(cu)) return toast('Tu rol no permite generar versiones del SOP.', 'err')
    setBusy(true)
    const version = siguienteVersion(sops[0]?.version || '0.0')
    const id = `DOC-SOP-${proceso.id}-v${version}`
    const contenido = {
      proceso: {
        id: proceso.id, nombre: proceso.nombre, objetivo: proceso.objetivo,
        alcance: proceso.alcance, regla_critica: proceso.regla_critica
      },
      principios: bundle.principios, roles: bundle.roles, transicion: bundle.transicion,
      fases: bundle.fases, pasos: bundle.pasos, errores: bundle.errores, kpis: bundle.kpis,
      dependencias: bundle.dependencias
    }
    const contenido_md = sopMarkdown({
      proceso, ...bundle, procesosRef: matriz, comiteNombre,
      meta: { version, estado: 'BORRADOR', fecha: hoy(), elaborado_por: cu?.nombre || '—', meses_revision: proceso.meses_revision || 6 }
    })
    const { error } = await supabase.from('prc_documentos').insert({
      id, proceso_id: proceso.id, tipo: 'SOP', codigo: `SOP-${proceso.id}`,
      nombre_archivo: `SOP_${proceso.id}_v${version}.md`, version, estado: 'BORRADOR',
      contenido, contenido_md, hash_contenido: hashContenido(contenido_md),
      fecha_emision: hoy(), elaborado_por: cu?.nombre || '—', es_vigente: false,
      notas: 'Versión generada desde el módulo Procesos a partir del contenido vigente del proceso.'
    })
    if (error) { setBusy(false); return toast('No se pudo crear la versión: ' + error.message, 'err') }
    await supabase.from('prc_firmas').insert({
      id: `F-${id}-ELAB`, documento_id: id, proceso_id: proceso.id, usuario_id: cu?.id,
      nombre_usuario: cu?.nombre || '—', rol_usuario: cu?.rol, accion: 'ELABORA',
      comentario: 'Versión generada desde el módulo Procesos.', hash_documento: hashContenido(contenido_md),
      fecha: hoy(), hora: hora()
    })
    setBusy(false); setVerDoc(id); toast(`SOP-${proceso.id} versión ${version} creada como borrador.`)
    onRecargar()
  }

  /* ── firmar ─────────────────────────────────────────────────────────────── */
  const firmar = async () => {
    const { doc, accion } = firmando
    if (!comentario.trim()) return toast('El comentario es obligatorio para dejar registro de la firma.', 'err')
    if (accion === 'APRUEBA' && !puedeAprobar(cu)) return toast('Tu rol no puede aprobar documentos.', 'err')
    setBusy(true)
    const { error } = await supabase.from('prc_firmas').insert({
      id: `F-${doc.id}-${accion}-${Date.now().toString(36)}`,
      documento_id: doc.id, proceso_id: proceso.id, usuario_id: cu?.id,
      nombre_usuario: cu?.nombre || '—', rol_usuario: cu?.rol, accion,
      comentario: comentario.trim(), firma_digital: cu?.firma_digital || null,
      hash_documento: doc.hash_contenido, comite_codigo: proceso.comite_codigo,
      fecha: hoy(), hora: hora()
    })
    setBusy(false)
    if (error) return toast('No se pudo registrar la firma: ' + error.message, 'err')
    setFirmando(null); setComentario('')
    toast(`${ACCIONES[accion].l}: ${doc.codigo} v${doc.version} firmado por ${cu?.nombre}.`)
    onRecargar()
  }

  const acciones = d => {
    if (!d) return []
    const l = []
    if (d.estado === 'BORRADOR') l.push('REVISA', 'APRUEBA')
    else if (d.estado === 'POR_OFICIALIZAR') l.push('APRUEBA', 'RECHAZA')
    else if (d.estado === 'VIGENTE') l.push('DEROGA')
    return l
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>

      <Cd style={{ padding: 13 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {sops.length === 0 && <Bd c="var(--warning)">Sin versiones guardadas · vista previa desde el contenido del proceso</Bd>}
            {sops.map(d => (
              <button key={d.id} onClick={() => setVerDoc(d.id)} style={{
                padding: '5px 10px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${actual?.id === d.id ? 'var(--accent)' : 'var(--border-2)'}`,
                background: actual?.id === d.id ? 'var(--accent-bg)' : 'var(--bg-surface)',
                color: actual?.id === d.id ? 'var(--accent-text)' : 'var(--text-secondary)'
              }}>v{d.version} {d.es_vigente ? '· vigente' : `· ${d.estado.toLowerCase().replace('_', ' ')}`}</button>
            ))}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <Bt v="sec" sm onClick={() => descargar(actual?.nombre_archivo || `SOP_${proceso.id}_preview.md`, md, 'text/markdown;charset=utf-8')}>
              Descargar .md
            </Bt>
            <Bt v="pri" sm dis={busy || !puedeEditar(cu)} onClick={generarVersion}>
              Guardar como nueva versión
            </Bt>
            {acciones(actual).map(a => (
              <Bt key={a} sm dis={busy} v={a === 'APRUEBA' ? 'ok' : a === 'RECHAZA' ? 'dan' : a === 'DEROGA' ? 'warn' : 'sec'}
                onClick={() => { setFirmando({ doc: actual, accion: a }); setComentario('') }}>
                {ACCIONES[a].l}
              </Bt>
            ))}
          </div>
        </div>
        {actual && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-1)', display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--text-muted)' }}>
            <span>Documento <b style={{ color: 'var(--text-primary)' }}>{actual.codigo} v{actual.version}</b></span>
            <span>Emitido {fFecha(actual.fecha_emision)}</span>
            <span>Elaborado por {actual.elaborado_por || '—'}</span>
            <span>Revisado por {actual.revisado_por || '—'}</span>
            <span>Aprobado por {actual.aprobado_por || '—'}</span>
            {actual.proxima_revision && <span>Próxima revisión {fFecha(actual.proxima_revision)}</span>}
            {actual.hash_contenido && <span title="Huella del contenido firmado">Hash {actual.hash_contenido.slice(0, 12)}</span>}
          </div>
        )}
      </Cd>

      {firmasDoc(actual).length > 0 && (
        <Cd style={{ padding: 13 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 9 }}>Timeline de firmas</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {firmasDoc(actual).map(f => (
              <div key={f.id} style={{
                display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 11px',
                borderRadius: 9, background: 'var(--bg-page)', borderLeft: `3px solid ${ACCIONES[f.accion]?.c || 'var(--text-muted)'}`
              }}>
                <Bd c={ACCIONES[f.accion]?.c}>{ACCIONES[f.accion]?.l || f.accion}</Bd>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{f.nombre_usuario} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>· {f.rol_usuario || '—'}</span></div>
                  {f.comentario && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{f.comentario}</div>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fFecha(f.fecha)} {f.hora || ''}</div>
              </div>
            ))}
          </div>
        </Cd>
      )}

      <Cd>
        {!actual && (
          <div style={{
            padding: '9px 13px', borderRadius: 9, background: 'var(--warning-bg)',
            color: 'var(--warning-text)', fontSize: 12, marginBottom: 12
          }}>
            Vista previa generada en vivo desde el contenido del proceso. Todavía no hay una versión guardada:
            usa <b>Guardar como nueva versión</b> para dejarla registrada y poder firmarla.
          </div>
        )}
        <Markdown md={md} />
      </Cd>

      <Sheet open={!!firmando} onClose={() => setFirmando(null)}
        title={firmando ? `${ACCIONES[firmando.accion].l} · ${firmando.doc.codigo} v${firmando.doc.version}` : ''}>
        {firmando && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{
              padding: '10px 13px', borderRadius: 9, fontSize: 12.5,
              background: 'var(--bg-page)', color: 'var(--text-secondary)'
            }}>{ACCIONES[firmando.accion].desc}</div>
            {firmando.accion === 'APRUEBA' && (
              <div style={{ padding: '10px 13px', borderRadius: 9, background: 'var(--warning-bg)', color: 'var(--warning-text)', fontSize: 12.5 }}>
                Al aprobar, este documento queda <b>vigente</b> para toda la empresa, la versión anterior se deroga
                automáticamente y se agenda la revisión a {proceso.meses_revision || 6} meses. El procedimiento
                anterior sobre la misma materia queda sin efecto.
              </div>
            )}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Comentario (obligatorio)</label>
              <textarea rows={4} value={comentario} onChange={e => setComentario(e.target.value)}
                placeholder="Qué revisaste, qué cambia respecto de la versión anterior, condiciones de la aprobación…"
                style={{ ...css.input, marginTop: 5, resize: 'vertical', fontFamily: 'inherit' }} />
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              Firma: <b>{cu?.nombre}</b> · {cu?.rol} · {fFecha(hoy())} {hora()}
              {proceso.comite_codigo ? ` · comité ${proceso.comite_codigo}` : ''}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Bt v="sec" onClick={() => setFirmando(null)}>Cancelar</Bt>
              <Bt v={firmando.accion === 'RECHAZA' ? 'dan' : 'ok'} dis={busy || !comentario.trim()} onClick={firmar}>
                Firmar {ACCIONES[firmando.accion].l.toLowerCase()}
              </Bt>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}
