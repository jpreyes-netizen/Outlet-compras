// ═══════════════════════════════════════════════════════════════════════════
// MermaRespaldos.jsx — Respaldos de una merma
// Outlet de Puertas · Módulo Logística
//
// Regla: el INFORME es obligatorio para conciliar la baja. Las FOTOS y los
// DOCUMENTOS adicionales son opcionales, porque hay bajas (ajustes de sistema,
// consumos administrativos) donde no hay nada que fotografiar.
//
// Permite varios archivos por clase, cámara directa en móvil, y galería con
// vista previa. El estado lo recalcula el trigger fn_mermas_estado.
//
// Tabla:  log_merma_adjuntos     Bucket: log-documentos-wms/mermas/
// Vista:  v_log_merma_respaldo
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'

const MR = {
  navy:'#16213E', ink:'#1C1C1E', slate:'#6E6E73', line:'#DADADF', lineSoft:'#ECECEF',
  rojo:'#B42318', verde:'#1E7A44', ambar:'#B25E09', azul:'#175CD3', bgHead:'#F4F4F6',
}
const MAX_MB = 12
const CLASES = {
  INFORME:   {l:'Informe',   obligatorio:true,
              accept:'application/pdf,image/*',
              d:'Documento que justifica y autoriza la baja. Obligatorio para conciliar.'},
  FOTO:      {l:'Fotografía', obligatorio:false,
              accept:'image/*',
              d:'Evidencia visual del producto dado de baja. Opcional pero recomendada.'},
  DOCUMENTO: {l:'Otro documento', obligatorio:false,
              accept:'application/pdf,image/*,.doc,.docx,.xls,.xlsx',
              d:'Guía, correo de autorización, acta o cualquier respaldo adicional.'},
}
// Tipos del WMS válidos para cada categoría contable. La contabilidad manda:
// el jefe declara en su vocabulario operativo y esto lo traduce.
const TIPOS_POR_CATEGORIA = {
  reclasificacion: [
    {k:'segunda_seleccion', l:'Pasó a segunda selección'},
    {k:'conversion',        l:'Se convirtió en otro producto'},
    {k:'correccion_sku',    l:'Cambio de código / SKU'},
  ],
  merma_real: [
    {k:'destruccion', l:'Destruido o dañado'},
    {k:'perdida',     l:'No habido / pérdida'},
  ],
  ajuste_conteo: [{k:'ajuste_inventario', l:'Diferencia de inventario'}],
  correccion:    [{k:'correccion_sku',    l:'Corrección administrativa'}],
  uso_interno:   [{k:'uso_interno',       l:'Uso interno de la empresa'}],
}
const CAT_LABEL = {
  reclasificacion:'Reclasificación', merma_real:'Merma real',
  ajuste_conteo:'Ajuste de conteo', correccion:'Corrección',
  uso_interno:'Uso interno', sin_clasificar:'Sin clasificar',
}

const esImagen = a => (a.mime || '').startsWith('image/') ||
  /\.(jpg|jpeg|png|webp|gif|heic)$/i.test(a.nombre || a.url || '')

const fmtCLP = n => new Intl.NumberFormat('es-CL',
  {style:'currency', currency:'CLP', maximumFractionDigits:0}).format(Math.round(n || 0))
const fmtPeso = b => !b ? '' : b > 1048576 ? `${(b/1048576).toFixed(1)} MB` : `${Math.round(b/1024)} KB`

const btn = v => ({
  fontFamily:'inherit', fontSize:11, fontWeight:700, letterSpacing:0.5, cursor:'pointer',
  padding:'7px 12px', borderRadius:3, whiteSpace:'nowrap', display:'inline-flex',
  alignItems:'center', gap:6, transition:'all .12s', border:`1px solid ${MR.line}`,
  ...(v==='solid' ? {background:MR.navy, color:'#fff', borderColor:MR.navy}
    : v==='danger'? {background:'#fff', color:MR.rojo, borderColor:MR.rojo+'70'}
    : v==='ghost' ? {background:'transparent', color:MR.slate, borderColor:'transparent'}
    :               {background:'#fff', color:MR.navy}),
})

/**
 * @param merma     fila de log_mermas
 * @param cu        usuario actual
 * @param onChange  callback(estadoNuevo) tras subir o eliminar
 * @param compacto  true para la fila de la tabla, false para el panel de detalle
 */
export default function MermaRespaldos({ merma, cu, onChange, compacto = false }) {
  const [adj, setAdj]         = useState([])
  const [cargando, setCarg]   = useState(true)
  const [subiendo, setSub]    = useState(null)
  const [msg, setMsg]         = useState(null)
  const [preview, setPreview] = useState(null)
  const [nota, setNota]       = useState('')
  const [val, setVal]         = useState(null)   // validación contra la norma contable
  const [aplicando, setApl]   = useState(false)
  const camRef = useRef(null)

  useEffect(() => { cargar() /* eslint-disable-next-line */ }, [merma?.id])

  async function cargar() {
    if (!merma?.id) return
    setCarg(true)
    const [adjR, valR] = await Promise.all([
      supabase.from('log_merma_adjuntos')
        .select('*').eq('merma_id', merma.id).order('subido_at', {ascending:false}),
      supabase.from('v_log_merma_validacion')
        .select('veredicto, riesgo, tipo_wms, categoria_declarada, categoria_sugerida, explicacion_regla, nota')
        .eq('id', merma.id).maybeSingle(),
    ])
    setAdj(adjR.data || [])
    setVal(valR.data || null)
    setCarg(false)
  }

  // Alinear la clasificación del WMS con lo que dice la norma contable
  async function aplicarSugerencia(tipoWms) {
    setApl(true); setMsg(null)
    try {
      const { error } = await supabase.from('log_mermas').update({
        tipo: tipoWms, tipo_manual: true,
        clasificado_por: cu?.nombre || null,
        clasificado_at: new Date().toISOString(),
        categoria_nota: `Alineado con la norma contable (${CAT_LABEL[val?.categoria_sugerida] || val?.categoria_sugerida}) al cargar respaldos`,
      }).eq('id', merma.id)
      if (error) throw error
      setMsg({t:'ok', m:'Clasificación corregida.'})
      onChange && onChange(null, tipoWms)
      cargar()
    } catch (e) { setMsg({t:'error', m:e.message}) }
    setApl(false)
  }

  const porClase = c => adj.filter(a => a.clase === c)
  const tieneInforme = porClase('INFORME').length > 0 || !!merma?.informe_url

  async function subir(files, clase, origen = 'ARCHIVO') {
    const lista = Array.from(files || [])
    if (!lista.length) return
    setSub(clase); setMsg(null)
    let ok = 0, errores = []
    try {
      for (const file of lista) {
        if (file.size > MAX_MB * 1024 * 1024) {
          errores.push(`${file.name}: supera los ${MAX_MB} MB`); continue
        }
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
        const stamp = Date.now().toString(36)
        const path = `mermas/${merma.sucursal_codigo || 'sin-suc'}/${merma.id}/${clase.toLowerCase()}_${stamp}.${ext}`
        const { error: eUp } = await supabase.storage.from('log-documentos-wms')
          .upload(path, file, {upsert:false, contentType:file.type || undefined})
        if (eUp) { errores.push(`${file.name}: ${eUp.message}`); continue }
        const url = supabase.storage.from('log-documentos-wms').getPublicUrl(path).data.publicUrl

        const { error: eIns } = await supabase.from('log_merma_adjuntos').insert({
          merma_id: merma.id, clase, url,
          nombre: origen === 'CAMARA' ? `Foto ${new Date().toLocaleString('es-CL')}` : file.name,
          mime: file.type || null, peso_bytes: file.size, origen,
          nota: nota.trim() || null,
          subido_por: cu?.nombre || null,
        })
        if (eIns) { errores.push(`${file.name}: ${eIns.message}`); continue }
        ok++
      }

      // Mantener los campos legacy en sincronía para no romper vistas antiguas
      if (ok > 0) {
        const patch = {}
        const primero = clase === 'INFORME' ? 'informe' : clase === 'FOTO' ? 'foto' : null
        if (primero && !merma[`${primero}_url`]) {
          const { data: ult } = await supabase.from('log_merma_adjuntos')
            .select('url, nombre').eq('merma_id', merma.id).eq('clase', clase)
            .order('subido_at', {ascending:false}).limit(1).maybeSingle()
          if (ult) {
            patch[`${primero}_url`] = ult.url
            patch[`${primero}_nombre`] = ult.nombre
            patch[`${primero}_at`] = new Date().toISOString()
            patch[`${primero}_por`] = cu?.nombre || null
          }
        }
        if (nota.trim()) patch.respaldo_nota = nota.trim()
        patch.respaldo_at = new Date().toISOString()
        patch.respaldo_por = cu?.nombre || null
        const { data: upd } = await supabase.from('log_mermas')
          .update(patch).eq('id', merma.id).select('estado').single()
        onChange && onChange(upd?.estado)
      }

      setNota('')
      setMsg(errores.length
        ? {t:'error', m:`${ok} subido(s). ${errores[0]}${errores.length>1?` (+${errores.length-1})`:''}`}
        : {t:'ok', m:`${ok} archivo${ok===1?'':'s'} agregado${ok===1?'':'s'}.`})
      cargar()
    } catch (e) {
      setMsg({t:'error', m:e.message})
    }
    setSub(null)
  }

  async function eliminar(a) {
    if (a.clase === 'INFORME' && porClase('INFORME').length === 1) {
      if (!window.confirm('Es el único informe de esta baja. Al eliminarlo vuelve a quedar pendiente. ¿Continuar?')) return
    }
    const { error } = await supabase.from('log_merma_adjuntos').delete().eq('id', a.id)
    if (error) { setMsg({t:'error', m:error.message}); return }

    // Si era el que estaba en el campo legacy, reapuntar o limpiar
    const campo = a.clase === 'INFORME' ? 'informe' : a.clase === 'FOTO' ? 'foto' : null
    if (campo && merma[`${campo}_url`] === a.url) {
      const { data: otro } = await supabase.from('log_merma_adjuntos')
        .select('url, nombre').eq('merma_id', merma.id).eq('clase', a.clase)
        .order('subido_at', {ascending:false}).limit(1).maybeSingle()
      const { data: upd } = await supabase.from('log_mermas').update({
        [`${campo}_url`]: otro?.url || null,
        [`${campo}_nombre`]: otro?.nombre || null,
      }).eq('id', merma.id).select('estado').single()
      onChange && onChange(upd?.estado)
    } else {
      const { data: upd } = await supabase.from('log_mermas')
        .update({respaldo_at:new Date().toISOString()}).eq('id', merma.id).select('estado').single()
      onChange && onChange(upd?.estado)
    }
    setMsg({t:'ok', m:'Archivo eliminado.'})
    cargar()
  }

  // ── Vista compacta: indicador para la fila de la tabla ──
  if (compacto) {
    const n = {i:porClase('INFORME').length, f:porClase('FOTO').length, d:porClase('DOCUMENTO').length}
    const alerta = val && ['DISCREPA','SIN_CLASIFICAR'].includes(val.veredicto)
    return (
      <span style={{display:'inline-flex', alignItems:'center', gap:8, fontSize:10.5, fontWeight:700}}>
        {alerta && (
          <span title={`Clasificación a revisar: la glosa sugiere ${CAT_LABEL[val.categoria_sugerida] || val.categoria_sugerida}`}
            style={{color:MR.rojo}}>⚠ CLASIF.</span>
        )}
        <span style={{color: tieneInforme ? MR.verde : MR.rojo}}>
          {tieneInforme ? `INFORME${n.i>1?` ×${n.i}`:''}` : 'SIN INFORME'}
        </span>
        {n.f > 0 && <span style={{color:MR.slate}}>{n.f} foto{n.f===1?'':'s'}</span>}
        {n.d > 0 && <span style={{color:MR.slate}}>{n.d} doc{n.d===1?'':'s'}</span>}
      </span>
    )
  }

  const bloque = (clase) => {
    const cfg = CLASES[clase]
    const items = porClase(clase)
    const falta = cfg.obligatorio && items.length === 0 && !merma?.informe_url
    return (
      <div key={clase} style={{marginBottom:14}}>
        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:6, flexWrap:'wrap'}}>
          <span style={{fontSize:10.5, fontWeight:700, letterSpacing:0.7, textTransform:'uppercase',
            color: falta ? MR.rojo : MR.slate}}>
            {cfg.l}{cfg.obligatorio && ' · obligatorio'}
          </span>
          {items.length > 0 && (
            <span style={{fontSize:10.5, fontWeight:700, color:MR.verde}}>{items.length} cargado{items.length===1?'':'s'}</span>
          )}
          <div style={{marginLeft:'auto', display:'flex', gap:6, flexWrap:'wrap'}}>
            {clase === 'FOTO' && (
              <>
                <label style={btn('solid')}>
                  {subiendo==='FOTO' ? 'SUBIENDO…' : 'TOMAR FOTO'}
                  <input ref={camRef} type="file" accept="image/*" capture="environment" multiple
                    style={{display:'none'}} disabled={!!subiendo}
                    onChange={e=>{const f=e.target.files; e.target.value=''; subir(f,'FOTO','CAMARA')}}/>
                </label>
                <label style={btn('outline')}>
                  SUBIR IMÁGENES
                  <input type="file" accept="image/*" multiple style={{display:'none'}} disabled={!!subiendo}
                    onChange={e=>{const f=e.target.files; e.target.value=''; subir(f,'FOTO')}}/>
                </label>
              </>
            )}
            {clase !== 'FOTO' && (
              <label style={btn(falta ? 'solid' : 'outline')}>
                {subiendo===clase ? 'SUBIENDO…' : (items.length ? 'AGREGAR OTRO' : `ADJUNTAR ${cfg.l.toUpperCase()}`)}
                <input type="file" accept={cfg.accept} multiple style={{display:'none'}} disabled={!!subiendo}
                  onChange={e=>{const f=e.target.files; e.target.value=''; subir(f,clase)}}/>
              </label>
            )}
          </div>
        </div>

        <div style={{fontSize:11, color:MR.slate, marginBottom:6, lineHeight:1.5}}>{cfg.d}</div>

        {falta && (
          <div style={{padding:'7px 11px', marginBottom:6, borderRadius:3, background:'#FCF3F1',
            borderLeft:`3px solid ${MR.rojo}`, fontSize:11.5, color:MR.rojo, fontWeight:600}}>
            Esta baja no se puede conciliar sin el informe.
          </div>
        )}

        {items.length > 0 && (
          <div style={{display:'flex', flexWrap:'wrap', gap:8}}>
            {items.map(a => (
              <div key={a.id} style={{border:`1px solid ${MR.line}`, borderRadius:3, background:'#fff',
                width: esImagen(a) ? 104 : 190, overflow:'hidden'}}>
                {esImagen(a) ? (
                  <div onClick={()=>setPreview(a)} style={{cursor:'zoom-in', height:78, background:MR.bgHead,
                    backgroundImage:`url(${a.url})`, backgroundSize:'cover', backgroundPosition:'center'}}/>
                ) : (
                  <a href={a.url} target="_blank" rel="noreferrer"
                    style={{display:'block', padding:'12px 10px', textDecoration:'none', color:MR.azul,
                      fontSize:11.5, fontWeight:700, borderBottom:`1px solid ${MR.lineSoft}`}}>
                    ABRIR DOCUMENTO
                  </a>
                )}
                <div style={{padding:'5px 7px', fontSize:9.5, color:MR.slate, lineHeight:1.45}}>
                  <div style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}
                    title={a.nombre}>{a.nombre || 'Sin nombre'}</div>
                  <div style={{display:'flex', alignItems:'center', gap:5, marginTop:2}}>
                    {a.origen === 'CAMARA' && <span style={{fontWeight:700, color:MR.azul}}>CÁMARA</span>}
                    <span>{fmtPeso(a.peso_bytes)}</span>
                    <span onClick={()=>eliminar(a)} title="Eliminar"
                      style={{marginLeft:'auto', cursor:'pointer', color:MR.rojo, fontWeight:700}}>
                      ✕
                    </span>
                  </div>
                  {a.subido_por && (
                    <div style={{marginTop:1, overflow:'hidden', textOverflow:'ellipsis',
                      whiteSpace:'nowrap'}}>{a.subido_por}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{border:`1px solid ${MR.line}`,
      borderLeft:`3px solid ${tieneInforme ? MR.verde : MR.rojo}`,
      borderRadius:3, background:'#fff', padding:'14px 16px'}}>

      <div style={{display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', marginBottom:12}}>
        <div style={{fontSize:10.5, fontWeight:700, letterSpacing:0.8, color:MR.slate, textTransform:'uppercase'}}>
          Respaldos de la baja
        </div>
        <span style={{display:'inline-flex', alignItems:'center', gap:6, fontSize:10.5,
          fontWeight:700, letterSpacing:0.4, color: tieneInforme ? MR.verde : MR.rojo}}>
          <span style={{width:7, height:7, borderRadius:'50%',
            background: tieneInforme ? MR.verde : MR.rojo}}/>
          {tieneInforme ? 'CONCILIADA' : 'PENDIENTE DE INFORME'}
        </span>
        <div style={{marginLeft:'auto', fontSize:11.5, color:MR.slate}}>
          {merma?.total_unidades ? `${merma.total_unidades} unidades · ` : ''}
          <strong style={{color:MR.ink}}>{fmtCLP(merma?.costo_total)}</strong>
        </div>
      </div>

      {cargando ? (
        <div style={{padding:'16px 0', color:MR.slate, fontSize:12}}>Cargando respaldos…</div>
      ) : (<>
        {/* ── Validación de la clasificación contra la norma contable ── */}
        {val && val.veredicto !== 'COINCIDE' && (() => {
          const cfg = {
            DISCREPA:        {c:MR.rojo,  t:'La clasificación no coincide con la norma contable'},
            REVISAR:         {c:MR.ambar, t:'Esta clasificación admite dos lecturas'},
            SIN_CLASIFICAR:  {c:MR.rojo,  t:'Falta clasificar esta baja'},
            GLOSA_SIN_REGLA: {c:MR.ambar, t:'La glosa de BSALE no permite clasificar automáticamente'},
          }[val.veredicto] || {c:MR.slate, t:'Revisar clasificación'}
          const opciones = TIPOS_POR_CATEGORIA[val.categoria_sugerida] || []
          return (
            <div style={{border:`1px solid ${cfg.c}40`, borderLeft:`3px solid ${cfg.c}`,
              borderRadius:3, background: cfg.c===MR.rojo ? '#FCF3F1' : '#FBF6EF',
              padding:'11px 13px', marginBottom:14}}>
              <div style={{fontSize:12, fontWeight:700, color:cfg.c, marginBottom:6}}>{cfg.t}</div>

              {val.nota && (
                <div style={{fontSize:11.5, color:MR.ink, marginBottom:6, lineHeight:1.5}}>
                  Glosa en BSALE: <em style={{color:MR.slate}}>"{val.nota}"</em>
                </div>
              )}

              {val.veredicto === 'GLOSA_SIN_REGLA' ? (
                <div style={{fontSize:11.5, color:MR.slate, lineHeight:1.55}}>
                  Ninguna regla reconoce esta glosa, así que la clasificación queda a tu criterio.
                  Al registrar el próximo consumo en BSALE conviene escribir qué pasó con el producto
                  (por ejemplo «MERMA A 2DA — rayas superficiales»), no solo quién lo hizo.
                </div>
              ) : (<>
                <div style={{fontSize:11.5, color:MR.ink, lineHeight:1.6, marginBottom:8}}>
                  {val.veredicto !== 'SIN_CLASIFICAR' && (
                    <>Está clasificada como <strong>{CAT_LABEL[val.categoria_declarada] || val.categoria_declarada}</strong>,
                    {' '}pero según la glosa corresponde a{' '}</>
                  )}
                  {val.veredicto === 'SIN_CLASIFICAR' && <>Según la glosa corresponde a{' '}</>}
                  <strong style={{color:cfg.c}}>{CAT_LABEL[val.categoria_sugerida] || val.categoria_sugerida}</strong>.
                  {val.explicacion_regla && (
                    <div style={{color:MR.slate, marginTop:3}}>{val.explicacion_regla}</div>
                  )}
                </div>

                {val.riesgo === 'SOBRESTIMA_PERDIDA' && (
                  <div style={{fontSize:11, color:MR.rojo, fontWeight:600, marginBottom:8, lineHeight:1.5}}>
                    Si queda así, esta baja se contabiliza como pérdida sin serlo y sube la merma del mes.
                  </div>
                )}
                {val.riesgo === 'SUBESTIMA_PERDIDA' && (
                  <div style={{fontSize:11, color:MR.rojo, fontWeight:600, marginBottom:8, lineHeight:1.5}}>
                    Si queda así, una pérdida real no se registra como tal.
                  </div>
                )}

                {opciones.length > 0 && (
                  <div style={{display:'flex', gap:6, flexWrap:'wrap', alignItems:'center'}}>
                    <span style={{fontSize:10.5, fontWeight:700, letterSpacing:0.5, color:MR.slate}}>
                      CORREGIR A:
                    </span>
                    {opciones.map(o => (
                      <button key={o.k} disabled={aplicando}
                        onClick={()=>aplicarSugerencia(o.k)} style={btn('outline')}>
                        {o.l}
                      </button>
                    ))}
                    <span style={{fontSize:10.5, color:MR.slate, marginLeft:'auto'}}>
                      o déjala como está si estás seguro
                    </span>
                  </div>
                )}
              </>)}
            </div>
          )
        })()}

        {val && val.veredicto === 'COINCIDE' && (
          <div style={{fontSize:11, color:MR.verde, fontWeight:600, marginBottom:12}}>
            Clasificación alineada con la norma contable.
          </div>
        )}

        {Object.keys(CLASES).map(bloque)}

        <input style={{fontFamily:'inherit', fontSize:12, color:MR.ink, background:'#fff',
          border:`1px solid ${MR.line}`, borderRadius:3, padding:'6px 9px', width:'100%',
          outline:'none', marginBottom:8}}
          placeholder="Nota del respaldo (se guarda con los archivos que subas ahora)"
          value={nota} onChange={e=>setNota(e.target.value)}/>

        {msg && (
          <div style={{padding:'7px 11px', borderRadius:3, fontSize:11.5, fontWeight:600,
            background: msg.t==='ok' ? '#F0F7F3' : '#FCF3F1',
            color: msg.t==='ok' ? MR.verde : MR.rojo}}>
            {msg.m}
          </div>
        )}

        <div style={{marginTop:8, fontSize:10.5, color:MR.slate, lineHeight:1.5}}>
          Máximo {MAX_MB} MB por archivo. Puedes seleccionar varios a la vez.
          El informe es lo único que bloquea la conciliación; las fotos quedan como evidencia.
        </div>
      </>)}

      {preview && (
        <div onClick={()=>setPreview(null)}
          style={{position:'fixed', inset:0, background:'rgba(22,33,62,0.82)', zIndex:500,
            display:'flex', alignItems:'center', justifyContent:'center', padding:20, cursor:'zoom-out'}}>
          <div onClick={e=>e.stopPropagation()} style={{maxWidth:'92vw', maxHeight:'92vh',
            display:'flex', flexDirection:'column', gap:8}}>
            <img src={preview.url} alt={preview.nombre || ''}
              style={{maxWidth:'92vw', maxHeight:'82vh', objectFit:'contain',
                background:'#fff', borderRadius:3}}/>
            <div style={{display:'flex', alignItems:'center', gap:10, color:'#fff', fontSize:11.5}}>
              <span>{preview.nombre}</span>
              {preview.subido_por && <span style={{opacity:0.75}}>· {preview.subido_por}</span>}
              <a href={preview.url} target="_blank" rel="noreferrer"
                style={{marginLeft:'auto', color:'#fff', fontWeight:700, fontSize:11}}>ABRIR ORIGINAL</a>
              <span onClick={()=>setPreview(null)} style={{cursor:'pointer', fontWeight:700}}>CERRAR</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
