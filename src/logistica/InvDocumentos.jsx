// ══════════════════════════════════════════════════════════════════════
// InvDocumentos.jsx — Documentos del inventario
// Outlet de Puertas · Módulo Logística
//
// Planillas firmadas, fotos, actas y cualquier respaldo del conteo que antes
// iba a una carpeta de Drive. Se suben varios a la vez; quedan con quién y
// cuándo los subió. El Excel que se importa como histórico se guarda solo
// (tipo excel_importado). Borra quien lo subió o un admin.
//
// Tabla:  log_inv_documentos (FK a log_inv_cabeceras, ON DELETE CASCADE)
// Bucket: log-documentos-wms, carpeta inventarios/<id del inventario>/
// ══════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'

const D = {
  navy:'#16213E', ink:'#1C1C1E', slate:'#6E6E73', line:'#DADADF', lineSoft:'#ECECEF',
  rojo:'#B42318', verde:'#1E7A44', azul:'#175CD3', bgHead:'#F4F4F6',
}
export const TIPOS_DOC = {
  planilla:'Planilla', excel_importado:'Excel importado', foto:'Foto', acta:'Acta', otro:'Otro',
}
const MAX_MB_DOC = 20
const EXT_OK = ['pdf','jpg','jpeg','png','webp','heic','xlsx','xls','csv','doc','docx']

/** Nombre apto para la ruta en Storage: sin tildes, espacios ni símbolos. */
export const nombreSeguro = n => (String(n || 'archivo').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(-80)) || 'archivo'

/** Tipo según la extensión, cuando no se elige uno. */
export function tipoSugerido(nombre) {
  const ext = String(nombre || '').split('.').pop().toLowerCase()
  if (['jpg','jpeg','png','webp','heic'].includes(ext)) return 'foto'
  if (['xlsx','xls','csv'].includes(ext)) return 'planilla'
  return 'otro'
}

const fmtPeso = b => !b ? '—' : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`
const fmtFH = ts => { try { return new Date(ts).toLocaleString('es-CL', { dateStyle:'short', timeStyle:'short', timeZone:'America/Santiago' }) } catch { return '—' } }

/** Sube un archivo y lo registra en log_inv_documentos. Devuelve la fila creada. */
export async function subirDocumento({ inv, cu, file, tipo = null, nota = '', sb = supabase }) {
  if (!inv?.id) throw new Error('No se encontró el inventario.')
  if (!file) throw new Error('Elige un archivo.')
  const ext = String(file.name || '').split('.').pop().toLowerCase()
  if (!EXT_OK.includes(ext)) throw new Error(`${file.name}: formato no permitido.`)
  if (file.size > MAX_MB_DOC * 1024 * 1024) throw new Error(`${file.name}: supera los ${MAX_MB_DOC} MB.`)
  const t = TIPOS_DOC[tipo] ? tipo : tipoSugerido(file.name)
  const path = `inventarios/${inv.id}/${Date.now()}_${nombreSeguro(file.name)}`
  const { error: eU } = await sb.storage.from('log-documentos-wms').upload(path, file, { upsert:false })
  if (eU) throw eU
  const { data: u } = sb.storage.from('log-documentos-wms').getPublicUrl(path)
  const { data, error } = await sb.from('log_inv_documentos').insert({
    inventario_id: inv.id, tipo: t, nombre: file.name, path, url: u.publicUrl,
    mime: file.type || null, peso_bytes: file.size || null, nota: String(nota || '').trim() || null,
    subido_por: cu?.id || null, subido_nombre: cu?.nombre || null,
  }).select('*')
  if (error) { await sb.storage.from('log-documentos-wms').remove([path]); throw error }
  return data?.[0] || null
}

/** Borra el registro y luego el archivo (si el archivo no se puede borrar, queda huérfano, no el registro). */
export async function eliminarDocumento({ doc, sb = supabase }) {
  const { error } = await sb.from('log_inv_documentos').delete().eq('id', doc.id)
  if (error) throw error
  await sb.storage.from('log-documentos-wms').remove([doc.path])
}

const btn = v => ({
  fontFamily:'inherit', fontSize:11.5, fontWeight:600, cursor:'pointer', padding:'7px 13px',
  borderRadius:3, whiteSpace:'nowrap',
  ...(v === 'solid' ? { background:D.navy, color:'#fff', border:`1px solid ${D.navy}` }
    : v === 'ghost' ? { background:'transparent', color:D.slate, border:'1px solid transparent' }
    :                 { background:'#fff', color:D.navy, border:`1px solid ${D.line}` }),
})
const inp = w => ({
  fontFamily:'inherit', fontSize:12, color:D.ink, background:'#fff', boxSizing:'border-box',
  border:`1px solid ${D.line}`, borderRadius:3, padding:'6px 9px', width:w, outline:'none',
})
const th = { textAlign:'left', fontSize:10.5, fontWeight:700, color:D.slate, padding:'6px 9px',
  background:D.bgHead, borderBottom:`1px solid ${D.line}`, whiteSpace:'nowrap' }
const td = { fontSize:12, color:D.ink, padding:'6px 9px', borderBottom:`1px solid ${D.lineSoft}`, verticalAlign:'top' }

export default function InvDocumentos({ inv, cu }) {
  const [docs, setDocs]       = useState(null)      // null = cargando
  const [tipo, setTipo]       = useState('auto')
  const [nota, setNota]       = useState('')
  const [aviso, setAviso]     = useState(null)      // {t:'ok'|'error'|'info', m}
  const [subiendo, setSubiendo] = useState(false)
  const inputRef = useRef(null)
  const esAdmin = cu?.rol === 'admin' && !cu?._simulado

  async function cargar() {
    const { data, error } = await supabase.from('log_inv_documentos')
      .select('id,tipo,nombre,path,url,peso_bytes,nota,subido_por,subido_nombre,subido_at')
      .eq('inventario_id', inv.id).order('subido_at', { ascending:true })
    if (error) { setAviso({ t:'error', m:error.message }); setDocs([]); return }
    setDocs(data || [])
  }
  useEffect(() => { if (inv?.id) cargar() }, [inv?.id])

  async function subir(files) {
    const lista = Array.from(files || [])
    if (!lista.length) return
    setSubiendo(true); setAviso(null)
    const errores = []; let ok = 0
    for (let i = 0; i < lista.length; i++) {
      setAviso({ t:'info', m:`Subiendo ${i + 1} de ${lista.length}…` })
      try { await subirDocumento({ inv, cu, file:lista[i], tipo:tipo === 'auto' ? null : tipo, nota }); ok++ }
      catch (e) { errores.push(e.message || String(e)) }
    }
    if (inputRef.current) inputRef.current.value = ''
    setNota(''); setSubiendo(false)
    setAviso(errores.length
      ? { t:'error', m:`${ok} archivo${ok === 1 ? '' : 's'} subido${ok === 1 ? '' : 's'}. No se pudo subir: ${errores.join(' · ')}` }
      : { t:'ok', m:`${ok} archivo${ok === 1 ? '' : 's'} subido${ok === 1 ? '' : 's'}.` })
    cargar()
  }

  async function borrar(doc) {
    if (!window.confirm(`¿Eliminar "${doc.nombre}" de los documentos del inventario?`)) return
    try { await eliminarDocumento({ doc }); setAviso({ t:'ok', m:'Documento eliminado.' }); cargar() }
    catch (e) { setAviso({ t:'error', m:e.message || String(e) }) }
  }

  return (
    <div style={{ border:`1px solid ${D.line}`, borderRadius:3, background:'#fff', padding:'12px 14px', marginBottom:12 }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:10, flexWrap:'wrap', marginBottom:8 }}>
        <span style={{ fontSize:13, fontWeight:700, color:D.ink }}>Documentos del inventario</span>
        {docs && <span style={{ fontSize:11.5, color:D.slate }}>{docs.length} archivo{docs.length === 1 ? '' : 's'}</span>}
        <span style={{ fontSize:11.5, color:D.slate, marginLeft:'auto' }}>
          Planillas firmadas, fotos, actas y respaldos que antes iban a Drive.
        </span>
      </div>

      {cu?.id && (
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:8 }}>
          <select value={tipo} onChange={e => setTipo(e.target.value)} style={inp(170)} disabled={subiendo}>
            <option value="auto">Tipo según el archivo</option>
            {Object.entries(TIPOS_DOC).filter(([k]) => k !== 'excel_importado').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input style={inp(240)} placeholder="Nota (opcional), por ejemplo: planilla pareja 2" value={nota}
            onChange={e => setNota(e.target.value)} disabled={subiendo}/>
          <label style={{ ...btn('solid'), display:'inline-flex', alignItems:'center', opacity:subiendo ? 0.6 : 1 }}>
            {subiendo ? 'Subiendo…' : 'Subir archivos'}
            <input ref={inputRef} type="file" multiple disabled={subiendo} style={{ display:'none' }}
              accept={EXT_OK.map(e => '.' + e).join(',')} onChange={e => subir(e.target.files)}/>
          </label>
          <span style={{ fontSize:10.5, color:D.slate }}>PDF, imágenes, Excel o Word · máx {MAX_MB_DOC} MB c/u</span>
        </div>
      )}

      {aviso && (
        <div role={aviso.t === 'error' ? 'alert' : 'status'} style={{ padding:'7px 11px', marginBottom:8, borderRadius:3,
          fontSize:11.5, fontWeight:600, lineHeight:1.5,
          background:aviso.t === 'ok' ? '#F0F7F3' : aviso.t === 'error' ? '#FCF3F1' : D.bgHead,
          color:aviso.t === 'ok' ? D.verde : aviso.t === 'error' ? D.rojo : D.slate }}>{aviso.m}</div>
      )}

      {docs === null ? (
        <div style={{ fontSize:11.5, color:D.slate }}>Cargando documentos…</div>
      ) : docs.length === 0 ? (
        <div style={{ fontSize:11.5, color:D.slate }}>Todavía no hay documentos. Sube aquí lo que hoy está en la carpeta de Drive de este inventario.</div>
      ) : (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>
              <th style={th}>Tipo</th><th style={th}>Archivo</th><th style={th}>Nota</th>
              <th style={th}>Subido por</th><th style={th}>Fecha</th><th style={th}/>
            </tr></thead>
            <tbody>
              {docs.map(d => (
                <tr key={d.id}>
                  <td style={{ ...td, color:D.slate, whiteSpace:'nowrap' }}>{TIPOS_DOC[d.tipo] || d.tipo}</td>
                  <td style={td}>
                    <a href={d.url} target="_blank" rel="noreferrer" style={{ color:D.azul, fontWeight:600, textDecoration:'none' }}>{d.nombre}</a>
                    <span style={{ color:D.slate, fontSize:11, marginLeft:6 }}>{fmtPeso(d.peso_bytes)}</span>
                  </td>
                  <td style={{ ...td, color:D.slate }}>{d.nota || ''}</td>
                  <td style={{ ...td, whiteSpace:'nowrap' }}>{d.subido_nombre || '—'}</td>
                  <td style={{ ...td, color:D.slate, whiteSpace:'nowrap', fontVariantNumeric:'tabular-nums' }}>{fmtFH(d.subido_at)}</td>
                  <td style={{ ...td, textAlign:'right' }}>
                    {(esAdmin || (cu?.id && cu.id === d.subido_por)) && (
                      <button type="button" onClick={() => borrar(d)} style={{ ...btn('ghost'), padding:'2px 6px', color:D.rojo }}>Eliminar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
