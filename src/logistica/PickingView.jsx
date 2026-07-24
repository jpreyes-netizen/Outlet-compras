// ============================================================
// OUTLET LOGÍSTICA — PickingView.jsx
// Módulo Picking & Entrega (retail). Extraído del monolito
// LogisticaApp.jsx (líneas ~23000-24151) en Fase 0 del refactor.
// ============================================================
import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { css, Bt } from './ui_compartida.jsx'

// ═══════════════════════════════════════════════════════════════════════════
// PICKING & ENTREGA v4 — Estándar WMS profesional
//  · Bandejas: ⚡ Entrega inmediata / 📅 Programada (fecha + retiro/despacho)
//  · Scan-to-pick: validación por escaneo o tipeo de SKU (pistola USB o manual)
//  · Steppers ± por línea para conteos parciales
//  · Comprobante de entrega en DOS COPIAS (interna + cliente) con declaración
//    de conformidad y FIRMAS en pantalla (cliente + picking)
//  · Tab Respaldos: carga de documentos firmados para conciliación documental
// ═══════════════════════════════════════════════════════════════════════════
const PUEDE_PICKING = ['admin','jefe_bodega','coordinador','jefe_sucursal','coordinador_suc']
const ES_FLETE = (it)=>/despacho|flete|env[ií]o/i.test(it.producto||'')||/despacho|flete/i.test(it.sku||'')
const EST_PICK = {
  pendiente:  {l:'EN COLA',   c:'#FF9500'},
  asignada:   {l:'ASIGNADA',  c:'#007AFF'},
  en_picking: {l:'PICKING',   c:'#5856D6'},
  lista:      {l:'LISTA',     c:'#34C759'},
  entregada:  {l:'ENTREGADA', c:'#8E8E93'},
  anulada:    {l:'ANULADA',   c:'#FF3B30'},
}

// ── Pad de firma (canvas táctil/mouse) — para el comprobante de entrega ─────
function FirmaPad({label, onChange}) {
  const ref = useRef(null)
  const [tiene, setTiene] = useState(false)
  const dib = useRef({on:false, last:null})
  useEffect(()=>{
    const cv = ref.current; if(!cv) return
    const ctx = cv.getContext('2d')
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1C1C1E'
    const pos = (e)=>{
      const r = cv.getBoundingClientRect()
      const p = e.touches?e.touches[0]:e
      return {x:(p.clientX-r.left)*(cv.width/r.width), y:(p.clientY-r.top)*(cv.height/r.height)}
    }
    const down=(e)=>{ e.preventDefault(); dib.current={on:true,last:pos(e)} }
    const move=(e)=>{
      if(!dib.current.on) return
      e.preventDefault()
      const p=pos(e), l=dib.current.last
      ctx.beginPath(); ctx.moveTo(l.x,l.y); ctx.lineTo(p.x,p.y); ctx.stroke()
      dib.current.last=p
      if(!tiene){ setTiene(true) }
    }
    const up=()=>{
      if(dib.current.on){ dib.current.on=false; try{onChange(cv.toDataURL('image/png'))}catch(e){} }
    }
    cv.addEventListener('mousedown',down); cv.addEventListener('mousemove',move)
    window.addEventListener('mouseup',up)
    cv.addEventListener('touchstart',down,{passive:false}); cv.addEventListener('touchmove',move,{passive:false})
    cv.addEventListener('touchend',up)
    return ()=>{
      cv.removeEventListener('mousedown',down); cv.removeEventListener('mousemove',move)
      window.removeEventListener('mouseup',up)
      cv.removeEventListener('touchstart',down); cv.removeEventListener('touchmove',move)
      cv.removeEventListener('touchend',up)
    }
  },[tiene])
  const limpiar=()=>{
    const cv=ref.current; cv.getContext('2d').clearRect(0,0,cv.width,cv.height)
    setTiene(false); onChange(null)
  }
  return (
    <div style={{flex:'1 1 200px',minWidth:180}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:3}}>
        <span style={{fontSize:10,fontWeight:800,color:'#6D6D72',letterSpacing:'0.03em'}}>{label}</span>
        {tiene&&<span onClick={limpiar} style={{fontSize:10,color:'#FF3B30',cursor:'pointer',fontWeight:700}}>✕ limpiar</span>}
      </div>
      <canvas ref={ref} width={400} height={120}
        style={{width:'100%',height:70,border:`1.5px dashed ${tiene?'#34C759':'#C7C7CC'}`,borderRadius:8,
          background:'#FDFDFE',touchAction:'none',cursor:'crosshair'}}/>
    </div>
  )
}

function PickingView({cu, sucs}) {
  const esCD = ['admin','jefe_bodega','coordinador'].includes(cu?.rol)
  const sucPropia = (!esCD && cu?.sucursal_codigo) ? cu.sucursal_codigo : null
  const [tabVista, setTabVista] = useState('cola')      // cola | respaldos | reporte
  const [bandeja,  setBandeja]  = useState('inmediata') // inmediata | programada
  const [sucSel,   setSucSel]   = useState(sucPropia || 'todas')
  const [ordenes,  setOrdenes]  = useState([])
  const [selId,    setSelId]    = useState(null)
  const [items,    setItems]    = useState([])
  const [itemsLoad,setItemsLoad]= useState(false)
  const [loading,  setLoading]  = useState(true)
  const [msg,      setMsg]      = useState('')
  const [reloj,    setReloj]    = useState(Date.now())
  const [trabs,    setTrabs]    = useState([])
  const [pickerSel, setPickerSel]= useState(null)      // {orden, reasignar} → modal seleccion pickeador
  const [receptor, setReceptor] = useState('')
  const [receptorRut,setReceptorRut]=useState('')
  const [firmaCliente,setFirmaCliente]=useState(null)
  const [firmaPicking,setFirmaPicking]=useState(null)
  const [motivoEdit,setMotivoEdit]=useState(null)
  const [progEdit, setProgEdit] = useState(null)        // {ordenId, fecha, modalidad}
  const [scan,     setScan]     = useState('')
  const [scanFlash,setScanFlash]= useState(null)        // {itemId, ok}
  const scanRef = useRef(null)
  const [genPdf,   setGenPdf]   = useState(false)
  const [busy,     setBusy]     = useState(false)
  const [subiendoResp,setSubiendoResp]=useState(null)
  const [soloSinRespaldo,setSoloSinRespaldo]=useState(false)
  const [repRango, setRepRango] = useState('hoy')
  const [repD1,setRepD1]=useState(''); const [repD2,setRepD2]=useState('')
  const [repData,  setRepData]  = useState(null)
  const [repLoading,setRepLoading]=useState(false)

  const sucsTienda = (sucs||[]).filter(s=>!s.es_centro_distribucion && s.bsale_office_id)
  const sel = ordenes.find(o=>o.id===selId) || null

  // ── Carga + realtime ──────────────────────────────────────────────────────
  const cargar = async () => {
    try{
      const desde = new Date(Date.now()-72*3600*1000).toISOString()
      let q = supabase.from('log_picking_ordenes').select('*')
        .or(`estado.in.(pendiente,asignada,en_picking,lista),and(estado.in.(entregada,anulada),recibida_at.gte.${desde})`)
        .order('urgente',{ascending:false}).order('recibida_at',{ascending:true})
      if(sucSel!=='todas') q = q.eq('sucursal_codigo', sucSel)
      const {data,error} = await q
      if(error) throw error
      setOrdenes(data||[])
    }catch(e){ console.error('[picking]',e); setMsg('⚠️ '+e.message) }
    setLoading(false)
  }
  const cargarItems = async (ordenId)=>{
    setItemsLoad(true)
    const {data} = await supabase.from('log_picking_items').select('*').eq('orden_id',ordenId).order('producto')
    setItems(data||[]); setItemsLoad(false)
  }
  useEffect(()=>{ setLoading(true); setSelId(null); cargar() },[sucSel])
  useEffect(()=>{
    const ch = supabase.channel('picking_cola')
      .on('postgres_changes',{event:'*',schema:'public',table:'log_picking_ordenes'},()=>{ cargar() })
      .subscribe()
    const t = setInterval(()=>setReloj(Date.now()), 15000)
    return ()=>{ supabase.removeChannel(ch); clearInterval(t) }
  },[sucSel])
  useEffect(()=>{
    supabase.from('log_trabajadores')
      .select('id,nombre,apellido,sucursal_codigo,sucursales_adicionales,rol_operativo,activo')
      .eq('activo',true).order('nombre').then(({data})=>setTrabs(data||[]))
  },[])
  useEffect(()=>{ if(selId){ cargarItems(selId); setFirmaCliente(null); setFirmaPicking(null) } },[selId])

  // ── Helpers ───────────────────────────────────────────────────────────────
  const minsDesde = (ts)=> ts ? Math.floor((reloj - new Date(ts).getTime())/60000) : null
  const fmtMin = (m)=> m==null?'—': m<1?'<1m': m<60?`${m}m`: `${Math.floor(m/60)}h${m%60}m`
  const semaforo = (m)=> m==null?'#8E8E93': m<5?'#34C759': m<10?'#FF9500':'#FF3B30'
  const nomSuc = (c)=> (sucs||[]).find(s=>s.codigo===c)?.nombre || c
  const hoyISO = ()=> new Date().toISOString().slice(0,10)
  const trabsDeSuc = (suc)=> trabs.filter(t=>{
    if(t.sucursal_codigo===suc) return true
    const ad=t.sucursales_adicionales
    if(Array.isArray(ad)) return ad.includes(suc)
    if(typeof ad==='string') return ad.split(',').map(x=>x.trim()).includes(suc)
    return false
  })
  const etapaCerrar = async (orden)=>{
    try{
      const {data} = await supabase.from('log_modulo_etapa_trabajadores')
        .select('id').eq('modulo','picking').eq('referencia_id',orden.id).is('hora_fin',null).limit(5)
      for(const e of (data||[])) await supabase.from('log_modulo_etapa_trabajadores')
        .update({hora_fin:new Date().toISOString()}).eq('id',e.id)
    }catch(e){}
  }
  const flash = (t)=>{ setMsg(t); setTimeout(()=>setMsg(m=>m===t?'':m), 4500) }

  // ── Triage de bandeja: programar / volver a inmediata / modalidad ─────────
  const guardarProgramacion = async ()=>{
    if(!progEdit?.fecha){ flash('⚠️ Indica la fecha tentativa de entrega'); return }
    const {error} = await supabase.from('log_picking_ordenes').update({
      tipo_entrega:'programada', fecha_programada:progEdit.fecha,
      modalidad_entrega:progEdit.modalidad||'retiro',
    }).eq('id',progEdit.ordenId)
    if(error){ flash('⚠️ '+error.message); return }
    flash('📅 Orden movida a Programadas'); setProgEdit(null)
  }
  const volverInmediata = async (o)=>{
    await supabase.from('log_picking_ordenes').update({
      tipo_entrega:'inmediata', fecha_programada:null,
    }).eq('id',o.id)
    flash('⚡ Orden movida a Entrega inmediata')
  }
  const setModalidad = async (o, m)=>{
    await supabase.from('log_picking_ordenes').update({modalidad_entrega:m}).eq('id',o.id)
  }

  // ── Acciones de flujo ─────────────────────────────────────────────────────
  // La asignacion es POR BOLETA: tomar/reasignar abre el selector de pickeador.
  const tomar = (orden)=> setPickerSel({orden, reasignar:false})
  const reasignar = (orden)=> setPickerSel({orden, reasignar:true})

  const asignarPicker = async (t)=>{
    const {orden, reasignar:esReasig} = pickerSel
    setBusy(true)
    const nom = `${t.nombre} ${t.apellido||''}`.trim()
    let q = supabase.from('log_picking_ordenes').update({
      ...(esReasig?{}:{estado:'asignada'}),
      pickeador_id:t.id, pickeador_nombre:nom,
      asignada_por:cu?.nombre||'', asignada_at:new Date().toISOString(),
    }).eq('id',orden.id)
    if(!esReasig) q = q.eq('estado','pendiente')
    const {error,data} = await q.select('id')
    setBusy(false)
    if(error){ flash('⚠️ '+error.message); return }
    if(!data?.length){ flash('⚠️ Otro usuario tomó esta orden primero'); return }
    if(esReasig) await etapaCerrar(orden)   // cierra la etapa del pickeador anterior
    supabase.from('log_modulo_etapa_trabajadores').insert({
      modulo:'picking', referencia_id:orden.id, referencia_folio:orden.folio,
      sucursal_codigo:orden.sucursal_codigo, etapa:'picking',
      trabajador_id:t.id, nombre_trabajador:nom, rol_etapa:t.rol_operativo||'',
      hora_inicio:new Date().toISOString(),
      asignado_por_nombre:cu?.nombre||'Sistema', asignado_por_rol:cu?.rol||'',
    }).then(()=>{},()=>{})
    setPickerSel(null)
    flash(esReasig?`🔄 Reasignada a ${nom}`:`🏃 Asignada a ${nom}`)
    setSelId(orden.id)
    setTimeout(()=>scanRef.current?.focus(), 300)
  }

  const validarItem = async (it, cantidad, motivo=null)=>{
    if(sel && !sel.inicio_picking_at){
      await supabase.from('log_picking_ordenes').update({
        estado:'en_picking', inicio_picking_at:new Date().toISOString(),
      }).eq('id',sel.id)
    }
    const cant = Math.max(0, Math.min(Number(cantidad), Number(it.cantidad)))
    const {error} = await supabase.from('log_picking_items').update({
      cantidad_confirmada:cant,
      confirmado_at:cant>0?new Date().toISOString():null,
      confirmado_por:cant>0?(cu?.nombre||''):null,
      motivo_no_entrega:motivo,
    }).eq('id',it.id)
    if(error){ flash('⚠️ '+error.message); return }
    cargarItems(sel.id)
  }
  const validarTodo = async ()=>{
    if(!sel) return
    setBusy(true)
    const ahora = new Date().toISOString()
    await Promise.all(items.filter(i=>Number(i.cantidad_confirmada)<Number(i.cantidad)&&!i.motivo_no_entrega)
      .map(i=>supabase.from('log_picking_items').update({
        cantidad_confirmada:i.cantidad, confirmado_at:ahora, confirmado_por:cu?.nombre||'',
      }).eq('id',i.id)))
    if(!sel.inicio_picking_at) await supabase.from('log_picking_ordenes').update({
      estado:'en_picking', inicio_picking_at:ahora}).eq('id',sel.id)
    setBusy(false); cargarItems(sel.id)
  }
  // Scan-to-pick: pistola USB o tipeo del SKU + Enter → suma 1 a esa línea
  const procesarScan = async ()=>{
    const code = scan.trim()
    if(!code) return
    setScan('')
    const cand = items.filter(i=>!i.motivo_no_entrega && Number(i.cantidad_confirmada)<Number(i.cantidad)
      && (String(i.sku||'').toLowerCase()===code.toLowerCase()))
    const it = cand[0] || items.find(i=>String(i.sku||'').toLowerCase()===code.toLowerCase())
    if(!it){ setScanFlash({itemId:null,ok:false}); flash(`⚠️ SKU "${code}" no está en esta orden`); return }
    const nuevo = Math.min(Number(it.cantidad_confirmada)+1, Number(it.cantidad))
    setScanFlash({itemId:it.id, ok:true})
    setTimeout(()=>setScanFlash(null), 900)
    await validarItem(it, nuevo, null)
    scanRef.current?.focus()
  }
  const marcarLista = async ()=>{
    const sinTocar = items.filter(i=>Number(i.cantidad_confirmada)===0 && !i.motivo_no_entrega)
    if(sinTocar.length){ flash(`⚠️ ${sinTocar.length} producto(s) sin validar ni motivo`); return }
    const {error} = await supabase.from('log_picking_ordenes').update({
      estado:'lista', lista_at:new Date().toISOString(),
    }).eq('id',sel.id)
    if(error){ flash('⚠️ '+error.message); return }
    await etapaCerrar(sel)
    flash(`✅ #${sel.folio} lista para entrega`)
  }
  const entregarItem = async (it, cantidad)=>{
    const {error} = await supabase.from('log_picking_items').update({
      cantidad_entregada:cantidad,
      entregado_at:cantidad>0?new Date().toISOString():null,
      entregado_por:cantidad>0?(cu?.nombre||''):null,
    }).eq('id',it.id)
    if(error){ flash('⚠️ '+error.message); return }
    cargarItems(sel.id)
  }
  const entregarTodo = async ()=>{
    if(!sel) return
    setBusy(true)
    const ahora = new Date().toISOString()
    await Promise.all(items.map(i=>supabase.from('log_picking_items').update({
      cantidad_entregada:Math.min(Number(i.cantidad_confirmada),Number(i.cantidad)),
      entregado_at:ahora, entregado_por:cu?.nombre||'',
    }).eq('id',i.id)))
    setBusy(false); cargarItems(sel.id)
  }

  // ── Comprobante de entrega: DOS COPIAS con declaración y firmas ───────────
  const confirmarEntrega = async ()=>{
    if(!receptor.trim()){ flash('⚠️ Nombre del receptor es obligatorio'); return }
    if(sel.modalidad_entrega!=='despacho' && !firmaCliente){
      flash('⚠️ En retiro en tienda, la firma del cliente es obligatoria'); return
    }
    setGenPdf(true)
    try{
      const ahora = new Date().toISOString()
      const completa = items.every(i=>Number(i.cantidad_entregada)>=Number(i.cantidad))
      const {jsPDF} = await import('jspdf')
      const autoTable = (await import('jspdf-autotable')).default
      const doc = new jsPDF()
      const fmtT=(ts)=>ts?new Date(ts).toLocaleString('es-CL',{dateStyle:'short',timeStyle:'medium'}):'—'

      const dibujarCopia = (badge)=>{
        doc.setFillColor(26,26,46); doc.rect(0,0,210,26,'F')
        doc.setTextColor(255,255,255); doc.setFontSize(14); doc.setFont(undefined,'bold')
        doc.text('COMPROBANTE DE ENTREGA', 14, 11)
        doc.setFontSize(9); doc.setFont(undefined,'normal')
        doc.text('Outlet de Puertas SpA · Módulo Picking & Entrega', 14, 18)
        doc.setFontSize(8); doc.setFont(undefined,'bold')
        doc.text(badge, 196, 11, {align:'right'})
        doc.setFont(undefined,'normal')
        doc.text(`${sel.modalidad_entrega==='despacho'?'DESPACHO A DOMICILIO':'RETIRO EN TIENDA'}`, 196, 18, {align:'right'})
        doc.setTextColor(30,30,30); doc.setFontSize(10)
        let y = 35
        const linea=(l,v)=>{ doc.setFont(undefined,'bold'); doc.text(l,14,y); doc.setFont(undefined,'normal'); doc.text(String(v??'—'),64,y); y+=5.5 }
        linea('Documento:', `${sel.bsale_doc_type==='factura'?'Factura':'Boleta'} N° ${sel.folio}`)
        linea('Sucursal:', nomSuc(sel.sucursal_codigo))
        linea('Cliente:', sel.cliente_nombre||'Sin cliente (boleta)')
        if(sel.vendedor_nombre) linea('Vendedor:', sel.vendedor_nombre)
        linea('Pickeador:', sel.pickeador_nombre||'—')
        linea('Fecha entrega:', fmtT(ahora))
        y+=1
        autoTable(doc,{ startY:y, styles:{fontSize:8,cellPadding:1.6}, headStyles:{fillColor:[26,26,46]},
          head:[['SKU','Producto','Vendido','Entregado','Observación']],
          body: items.map(i=>[ i.sku||'—', i.producto, String(i.cantidad),
            String(i.cantidad_entregada),
            i.motivo_no_entrega||(ES_FLETE(i)?'Servicio/flete':'') ]),
        })
        y = doc.lastAutoTable.finalY + 7
        // Declaración de conformidad
        doc.setFillColor(247,249,252); doc.roundedRect(14,y-4,182,14,2,2,'F')
        doc.setFontSize(9.5); doc.setFont(undefined,'bolditalic'); doc.setTextColor(40,40,50)
        doc.text('Declaro recibir conforme los productos detallados en este comprobante.', 105, y+3.5, {align:'center'})
        doc.setFont(undefined,'normal')
        y += 16
        // Firmas
        const fy = Math.min(y, 238)
        if(firmaCliente){ try{ doc.addImage(firmaCliente,'PNG',22,fy,70,22) }catch(e){} }
        if(firmaPicking){ try{ doc.addImage(firmaPicking,'PNG',118,fy,70,22) }catch(e){} }
        doc.setDrawColor(120,120,130)
        doc.line(20, fy+24, 96, fy+24); doc.line(116, fy+24, 192, fy+24)
        doc.setFontSize(8); doc.setTextColor(90,90,100)
        doc.text(`FIRMA CLIENTE — ${receptor.trim()}${receptorRut.trim()?' · '+receptorRut.trim():''}`, 58, fy+29, {align:'center'})
        doc.text(`ENTREGÓ (PICKING) — ${cu?.nombre||'—'}`, 154, fy+29, {align:'center'})
        // Pie
        doc.setFontSize(7.5)
        doc.text(`Emitida ${fmtT(sel.emitida_at)} · En cola ${fmtT(sel.recibida_at)} · Lista ${fmtT(sel.lista_at)} · ${completa?'ENTREGA COMPLETA':'ENTREGA PARCIAL'}`, 14, 286)
        doc.text(`Orden ${sel.id} · BSALE ${sel.bsale_doc_id}`, 14, 290)
      }
      dibujarCopia('COPIA INTERNA · OUTLET')
      doc.addPage()
      dibujarCopia('COPIA CLIENTE')

      let pdfUrl = null
      try{
        const path = `picking/${sel.sucursal_codigo}/${sel.folio}_${sel.id.slice(0,8)}.pdf`
        const blob = doc.output('blob')
        const {error:eUp} = await supabase.storage.from('log-documentos-wms')
          .upload(path, blob, {contentType:'application/pdf', upsert:true})
        if(!eUp){ pdfUrl = supabase.storage.from('log-documentos-wms').getPublicUrl(path).data.publicUrl }
      }catch(e){ console.error('[picking pdf]',e) }
      const {error} = await supabase.from('log_picking_ordenes').update({
        estado:'entregada', entregada_at:ahora,
        entregado_por:cu?.nombre||'', receptor_nombre:receptor.trim(),
        receptor_rut:receptorRut.trim()||null, entrega_completa:completa, pdf_url:pdfUrl,
      }).eq('id',sel.id)
      if(error) throw error
      await etapaCerrar(sel)
      doc.save(`entrega_${sel.folio}.pdf`)
      flash(`✅ #${sel.folio} entregada${completa?'':' (parcial)'} — comprobante en 2 copias generado`)
      setReceptor(''); setReceptorRut(''); setFirmaCliente(null); setFirmaPicking(null); setSelId(null)
    }catch(e){ console.error('[picking entrega]',e); flash('⚠️ '+e.message) }
    setGenPdf(false)
  }

  const listaPickingPDF = async ()=>{
    const {jsPDF} = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    const doc = new jsPDF()
    doc.setFontSize(13); doc.setFont(undefined,'bold')
    doc.text(`LISTA DE PICKING — ${sel.bsale_doc_type==='factura'?'Factura':'Boleta'} #${sel.folio}`, 14, 14)
    doc.setFontSize(9); doc.setFont(undefined,'normal'); doc.setTextColor(90,90,100)
    doc.text(`${nomSuc(sel.sucursal_codigo)} · ${sel.cliente_nombre||'Sin cliente'} · ${sel.modalidad_entrega==='despacho'?'DESPACHO':'RETIRO'} · Pickeador: ${sel.pickeador_nombre||'—'} · ${new Date().toLocaleString('es-CL')}`, 14, 20)
    autoTable(doc,{ startY:26, styles:{fontSize:10,cellPadding:3}, headStyles:{fillColor:[26,26,46]},
      head:[['☐','SKU','Producto','Cantidad']],
      body: items.map(i=>[ '☐', i.sku||'—', i.producto, String(i.cantidad) ]),
      columnStyles:{0:{cellWidth:10,halign:'center'},3:{halign:'right',fontStyle:'bold'}},
    })
    doc.save(`picking_${sel.folio}.pdf`)
  }

  const toggleUrgente = async (o)=>{
    await supabase.from('log_picking_ordenes').update({urgente:!o.urgente}).eq('id',o.id)
  }

  // ── Respaldos firmados: subir foto/scan del comprobante firmado ───────────
  const subirRespaldo = async (o, file)=>{
    if(!file) return
    setSubiendoResp(o.id)
    try{
      const ext = (file.name.split('.').pop()||'jpg').toLowerCase()
      const path = `picking-firmados/${o.sucursal_codigo}/${o.folio}_${o.id.slice(0,8)}.${ext}`
      const {error:eUp} = await supabase.storage.from('log-documentos-wms')
        .upload(path, file, {upsert:true, contentType:file.type||undefined})
      if(eUp) throw eUp
      const url = supabase.storage.from('log-documentos-wms').getPublicUrl(path).data.publicUrl
      const {error} = await supabase.from('log_picking_ordenes').update({
        respaldo_firmado_url:url, respaldo_firmado_at:new Date().toISOString(),
        respaldo_firmado_por:cu?.nombre||'',
      }).eq('id',o.id)
      if(error) throw error
      flash(`✅ Respaldo firmado de #${o.folio} cargado`)
    }catch(e){ flash('⚠️ '+e.message) }
    setSubiendoResp(null)
  }

  // ── Reporte (idéntico a v3 + métricas por hora/picker) ────────────────────
  const cargarReporte = async ()=>{
    setRepLoading(true)
    try{
      const hoy = new Date(); hoy.setHours(0,0,0,0)
      let d1, d2 = new Date()
      if(repRango==='hoy') d1 = hoy
      else if(repRango==='ayer'){ d1=new Date(hoy.getTime()-86400000); d2=new Date(hoy.getTime()-1) }
      else if(repRango==='7d') d1 = new Date(hoy.getTime()-6*86400000)
      else if(repRango==='30d') d1 = new Date(hoy.getTime()-29*86400000)
      else { d1 = repD1?new Date(repD1+'T00:00:00'):hoy; d2 = repD2?new Date(repD2+'T23:59:59'):new Date() }
      const {data,error} = await supabase.from('log_picking_ordenes').select('*')
        .gte('recibida_at', d1.toISOString()).lte('recibida_at', d2.toISOString())
        .order('recibida_at',{ascending:false}).limit(5000)
      if(error) throw error
      setRepData({d1,d2,rows:data||[]})
    }catch(e){ flash('⚠️ '+e.message) }
    setRepLoading(false)
  }
  useEffect(()=>{ if(tabVista==='reporte') cargarReporte() },[tabVista,repRango])
  const exportarReporte = async ()=>{
    if(!repData) return
    const XLSX = await import('xlsx')
    const filas = repData.rows.map(o=>({
      Folio:o.folio, Tipo:o.bsale_doc_type, Sucursal:nomSuc(o.sucursal_codigo),
      Bandeja:o.tipo_entrega, Modalidad:o.modalidad_entrega, FechaProgramada:o.fecha_programada||'',
      Cliente:o.cliente_nombre||'', Vendedor:o.vendedor_nombre||'',
      Items:o.total_items, Unidades:Number(o.total_unidades),
      Estado:EST_PICK[o.estado]?.l||o.estado, Completa:o.entrega_completa===false?'PARCIAL':(o.entrega_completa?'SI':''),
      Emitida:o.emitida_at?new Date(o.emitida_at).toLocaleString('es-CL'):'',
      Entregada:o.entregada_at?new Date(o.entregada_at).toLocaleString('es-CL'):'',
      MinTotales:o.entregada_at?Math.round((new Date(o.entregada_at)-new Date(o.recibida_at))/60000):'',
      Pickeador:o.pickeador_nombre||'', Receptor:o.receptor_nombre||'',
      RespaldoFirmado:o.respaldo_firmado_url?'SI':'',
    }))
    const ws = XLSX.utils.json_to_sheet(filas)
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Conciliación')
    XLSX.writeFile(wb, `conciliacion_picking_${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  // ── Estilos ───────────────────────────────────────────────────────────────
  const th = {padding:'6px 8px',fontSize:10,fontWeight:800,color:'#6D6D72',textAlign:'left',letterSpacing:'0.03em',borderBottom:'2px solid #E5E5EA',whiteSpace:'nowrap',background:'#FAFAFC',position:'sticky',top:0,zIndex:1}
  const td = {padding:'5px 8px',fontSize:12,borderBottom:'1px solid #F2F2F7',whiteSpace:'nowrap',verticalAlign:'middle'}
  const btMini = (bg,color)=>({padding:'4px 10px',borderRadius:7,border:'none',background:bg,color,fontSize:11,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'})
  const checkBtn = (on,color)=>({width:30,height:30,borderRadius:8,border:on?'none':'2px solid #D1D1D6',
    background:on?color:'#fff',color:'#fff',fontSize:15,fontWeight:900,cursor:'pointer',lineHeight:'26px',padding:0})
  const stepBtn = {width:26,height:26,borderRadius:6,border:'1px solid #D1D1D6',background:'#fff',color:'#3A3A3C',
    fontSize:14,fontWeight:900,cursor:'pointer',lineHeight:'22px',padding:0}
  const tdCk = {...td,padding:'5px 8px'}   // celdas del checklist: compactas pero legibles
  const modChip = (o,activo)=>(m,ic,l)=>(
    <button key={m} onClick={()=>activo&&setModalidad(o,m)} disabled={!activo}
      style={{padding:'3px 10px',borderRadius:12,fontSize:10,fontWeight:800,cursor:activo?'pointer':'default',
        border:'none', background:o.modalidad_entrega===m?'#1a1a2e':'#F2F2F7',
        color:o.modalidad_entrega===m?'#fff':'#8E8E93'}}>{ic} {l}</button>
  )

  // ═══ PANEL DERECHO: detalle de la orden ═══════════════════════════════════
  const PanelOrden = ()=>{
    if(!sel) return (
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'#C7C7CC',fontSize:13,flexDirection:'column',gap:8}}>
        <div style={{fontSize:36}}>👈</div>
        <div>Selecciona una orden de la cola para ver su contenido</div>
      </div>
    )
    const m = minsDesde(sel.recibida_at)
    const e = EST_PICK[sel.estado]||{l:sel.estado,c:'#8E8E93'}
    const enPicking = sel.estado==='asignada'||sel.estado==='en_picking'
    const enEntrega = sel.estado==='lista'
    const activa = !['entregada','anulada'].includes(sel.estado)
    const terminada = !activa
    const validados = items.filter(i=>Number(i.cantidad_confirmada)>0||i.motivo_no_entrega).length
    const entregados = items.filter(i=>Number(i.cantidad_entregada)>0||i.motivo_no_entrega).length
    const todoValidado = items.length>0 && validados===items.length
    const todoEntregado = items.length>0 && entregados===items.length
    const faltantes = items.filter(i=>Number(i.cantidad_entregada)<Number(i.cantidad))
    const chipM = modChip(sel, activa)

    return (
      <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
        <div style={{padding:'11px 14px',borderBottom:'1px solid #E5E5EA',background:'#FAFAFC'}}>
          <div style={{display:'flex',alignItems:'center',gap:9,flexWrap:'wrap'}}>
            <span style={{fontSize:16,fontWeight:900,fontFamily:'monospace'}}>#{sel.folio}</span>
            <span style={{fontSize:10,fontWeight:800,color:e.c,background:e.c+'15',padding:'3px 10px',borderRadius:12}}>{e.l}</span>
            <span style={{fontSize:10,fontWeight:800,color:'#8E8E93'}}>{sel.bsale_doc_type==='factura'?'FACTURA':'BOLETA'}</span>
            {sel.urgente&&<span style={{fontSize:10,fontWeight:800,color:'#FF3B30'}}>⚡</span>}
            {sel.tipo_entrega==='programada'&&<span style={{fontSize:10,fontWeight:800,color:'#5856D6',background:'#5856D615',padding:'3px 10px',borderRadius:12}}>📅 {sel.fecha_programada||'sin fecha'}</span>}
            <span style={{marginLeft:'auto',fontSize:12,fontWeight:800,color:semaforo(m)}}>{fmtMin(m)}</span>
          </div>
          <div style={{fontSize:12,color:'#3A3A3C',marginTop:5,fontWeight:600}}>
            {sel.cliente_nombre||'Cliente sin registrar'}{sel.cliente_rut?` · ${sel.cliente_rut}`:''}
          </div>
          <div style={{fontSize:11,color:'#8E8E93',marginTop:3,display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
            <span style={{display:'inline-flex',gap:4}}>{chipM('retiro','🏪','Retiro')}{chipM('despacho','🚚','Despacho')}</span>
            {sel.vendedor_nombre&&<span>Vendió: {sel.vendedor_nombre}</span>}
            {sel.pickeador_nombre&&(activa
              ? <span onClick={()=>reasignar(sel)} title="Clic para reasignar pickeador"
                  style={{color:'#5856D6',fontWeight:700,cursor:'pointer',textDecoration:'underline',textUnderlineOffset:2}}>🏃 {sel.pickeador_nombre} 🔄</span>
              : <span>🏃 {sel.pickeador_nombre}</span>)}
            {sel.bsale_url_pdf&&<a href={sel.bsale_url_pdf} target="_blank" rel="noreferrer" style={{color:'#007AFF',fontWeight:700}}>📄 Boleta</a>}
            {(enPicking||enEntrega)&&<span onClick={listaPickingPDF} style={{color:'#007AFF',fontWeight:700,cursor:'pointer'}}>🖨 Lista picking</span>}
            {activa&&sel.tipo_entrega==='inmediata'&&sel.estado==='pendiente'&&
              <span onClick={()=>setProgEdit({ordenId:sel.id,fecha:sel.fecha_programada||hoyISO(),modalidad:sel.modalidad_entrega})}
                style={{color:'#5856D6',fontWeight:700,cursor:'pointer'}}>📅 Programar</span>}
            {activa&&sel.tipo_entrega==='programada'&&
              <span onClick={()=>volverInmediata(sel)} style={{color:'#FF9500',fontWeight:700,cursor:'pointer'}}>⚡ Pasar a inmediata</span>}
          </div>
          {sel.modalidad_entrega==='despacho'&&(
            <div style={{marginTop:8,padding:'8px 10px',borderRadius:9,background:'#5856D608',border:'1px solid #5856D620'}}>
              <div style={{fontSize:9,fontWeight:800,color:'#5856D6',letterSpacing:'0.04em',marginBottom:3}}>
                🚚 DATOS DE DESPACHO {sel.despacho_registrado_at
                  ?<span style={{color:'#8E8E93',fontWeight:600}}>· registró {sel.despacho_registrado_por||'Comercial'}</span>
                  :<span style={{color:'#C93400'}}>· ⏳ pendientes — los asigna el vendedor desde la app Comercial</span>}
              </div>
              {sel.despacho_registrado_at&&(
                <div style={{fontSize:11.5,color:'#3A3A3C',lineHeight:1.55}}>
                  <b>{sel.despacho_direccion||'Sin dirección'}</b>{sel.despacho_comuna?`, ${sel.despacho_comuna}`:''}
                  {(sel.despacho_contacto||sel.despacho_telefono)&&<><br/>Recibe: {sel.despacho_contacto||'—'}{sel.despacho_telefono?` · 📞 ${sel.despacho_telefono}`:''}</>}
                  {sel.despacho_obs&&<><br/><span style={{color:'#8E8E93'}}>Obs: {sel.despacho_obs}</span></>}
                </div>
              )}
            </div>
          )}
          <div style={{display:'flex',gap:8,marginTop:9}}>
            {[
              {l:'1 · VALIDADO', n:validados, c:'#5856D6'},
              {l:'2 · ENTREGADO', n:entregados, c:'#34C759'},
            ].map(f=>(
              <div key={f.l} style={{flex:1}}>
                <div style={{fontSize:9,fontWeight:800,color:f.c,letterSpacing:'0.04em'}}>{f.l} · {f.n}/{items.length}</div>
                <div style={{height:5,borderRadius:3,background:'#E5E5EA',marginTop:3,overflow:'hidden'}}>
                  <div style={{height:'100%',width:`${items.length?Math.round(f.n/items.length*100):0}%`,background:f.c,borderRadius:3,transition:'width 0.25s'}}/>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Scan-to-pick */}
        {enPicking&&(
          <div style={{padding:'8px 14px',borderBottom:'1px solid #E5E5EA',background:'#5856D608'}}>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <span style={{fontSize:14}}>📷</span>
              <input ref={scanRef} value={scan} onChange={e=>setScan(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter')procesarScan()}}
                placeholder="Escanea o escribe el SKU y Enter — suma 1 unidad a la línea"
                style={{...css.input,flex:1,padding:'7px 10px',fontFamily:'monospace',fontSize:13,
                  border:`1.5px solid ${scanFlash?(scanFlash.ok?'#34C759':'#FF3B30'):'#D1D1D6'}`}}/>
            </div>
          </div>
        )}

        {/* Checklist */}
        <div style={{flex:1,overflowY:'auto'}}>
          {itemsLoad&&<div style={{padding:24,color:'#8E8E93',fontSize:12}}>⏳ Cargando productos…</div>}
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr>
              <th style={{...th,width:48,textAlign:'center'}} title="Fase 1: validado en picking">✔₁</th>
              <th style={{...th,width:48,textAlign:'center'}} title="Fase 2: entregado al cliente">✔₂</th>
              <th style={th}>PRODUCTO</th>
              <th style={{...th,textAlign:'center',width:118}}>VALIDADO</th>
              <th style={{...th,textAlign:'right',width:52}}>CANT</th>
              <th style={{...th,textAlign:'right',width:48}}></th>
            </tr></thead>
            <tbody>
              {items.map(it=>{
                const cant = Number(it.cantidad)
                const val = Number(it.cantidad_confirmada)
                const ent = Number(it.cantidad_entregada)
                const valOK = val>=cant, entOK = ent>=cant
                const flete = ES_FLETE(it)
                const conMotivo = !!it.motivo_no_entrega
                const flashRow = scanFlash?.itemId===it.id
                return (<React.Fragment key={it.id}>
                  <tr style={{background: flashRow?'#34C75925': conMotivo?'#FF3B3006': entOK?'#34C75908': valOK?'#5856D608':'transparent',
                    opacity:flete?0.8:1, transition:'background 0.3s'}}>
                    <td style={{...tdCk,textAlign:'center'}}>
                      <button style={checkBtn(val>0,valOK?'#5856D6':'#FF9500')} disabled={terminada||(!enPicking&&!enEntrega)}
                        title={val>0?`Validado ${val}/${cant}`:'Validar completo'}
                        onClick={()=>validarItem(it, valOK?0:cant, valOK?null:it.motivo_no_entrega)}>
                        {val>0?(valOK?'✓':val):''}
                      </button>
                    </td>
                    <td style={{...tdCk,textAlign:'center'}}>
                      <button style={checkBtn(ent>0,entOK?'#34C759':'#FF9500')}
                        disabled={!enEntrega||(val===0&&!conMotivo)}
                        title={ent>0?`Entregado ${ent}/${cant}`:enEntrega?'Marcar entregado':'Se habilita en fase de entrega'}
                        onClick={()=>entregarItem(it, entOK?0:Math.min(val||cant,cant))}>
                        {ent>0?(entOK?'✓':ent):''}
                      </button>
                    </td>
                    <td style={{...tdCk,whiteSpace:'normal'}}>
                      <div style={{fontWeight:700,fontSize:12.5,lineHeight:1.25}}>{flete?'🚚 ':''}{it.producto}</div>
                      <div style={{fontSize:10,color:'#8E8E93',fontFamily:'monospace',marginTop:1}}>{it.sku||'—'}</div>
                      {conMotivo&&<div style={{fontSize:10,color:'#FF3B30',fontWeight:700,marginTop:1}}>✗ {it.motivo_no_entrega} · disp. {val}/{cant}</div>}
                    </td>
                    <td style={{...tdCk,textAlign:'center'}}>
                      {enPicking&&!conMotivo&&cant>1?(
                        <span style={{display:'inline-flex',alignItems:'center',gap:5}}>
                          <button style={stepBtn} onClick={()=>validarItem(it, val-1)}>−</button>
                          <span style={{fontSize:13,fontWeight:900,minWidth:22,color:valOK?'#5856D6':val>0?'#FF9500':'#C7C7CC'}}>{val}</span>
                          <button style={stepBtn} onClick={()=>validarItem(it, val+1)}>+</button>
                        </span>
                      ):(
                        <span style={{fontSize:13,fontWeight:900,color:valOK?'#5856D6':val>0?'#FF9500':'#C7C7CC'}}>{val}</span>
                      )}
                    </td>
                    <td style={{...tdCk,textAlign:'right',fontWeight:900,fontSize:15}}>{cant}</td>
                    <td style={{...tdCk,textAlign:'right'}}>
                      {(enPicking||enEntrega)&&!flete&&!conMotivo&&
                        <button style={btMini('#FF950018','#C93400')} title="Falta / dañado / rechazo"
                          onClick={()=>setMotivoEdit({itemId:it.id,cantidad:val||0,motivo:''})}>⚠</button>}
                      {conMotivo&&(enPicking||enEntrega)&&
                        <button style={btMini('#F2F2F7','#6D6D72')} onClick={()=>validarItem(it,0,null)}>↩</button>}
                    </td>
                  </tr>
                  {motivoEdit?.itemId===it.id&&(
                    <tr><td colSpan={6} style={{...td,background:'#FFF8EE',whiteSpace:'normal'}}>
                      <span style={{display:'inline-flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{fontSize:11,fontWeight:700}}>Cant. disponible:</span>
                        <input type="number" min="0" max={cant} value={motivoEdit.cantidad}
                          onChange={e=>setMotivoEdit({...motivoEdit,cantidad:e.target.value})}
                          style={{...css.input,width:75,padding:'5px 8px'}}/>
                        <select value={motivoEdit.motivo} onChange={e=>setMotivoEdit({...motivoEdit,motivo:e.target.value})}
                          style={{...css.select,width:170,padding:'5px 8px'}}>
                          <option value="">Motivo…</option>
                          <option>Sin stock físico</option><option>Producto dañado</option>
                          <option>Cliente rechaza</option><option>Retiro posterior</option><option>Otro</option>
                        </select>
                        <button style={btMini('#007AFF','#fff')} onClick={()=>{
                          if(!motivoEdit.motivo){flash('⚠️ Indica el motivo');return}
                          validarItem(it, Number(motivoEdit.cantidad)||0, motivoEdit.motivo); setMotivoEdit(null)
                        }}>Guardar</button>
                        <button style={btMini('#F2F2F7','#6D6D72')} onClick={()=>setMotivoEdit(null)}>✕</button>
                      </span>
                    </td></tr>
                  )}
                </React.Fragment>)
              })}
            </tbody>
          </table>
        </div>

        {/* Pie por fase */}
        <div style={{padding:'10px 14px',borderTop:'1px solid #E5E5EA',background:'#FAFAFC'}}>
          {sel.estado==='pendiente'&&(
            <button style={{...btMini('#007AFF','#fff'),width:'100%',padding:'10px 0',fontSize:13}}
              disabled={busy} onClick={()=>tomar(sel)}>🏃 Tomar esta orden — elegir pickeador</button>
          )}
          {enPicking&&(
            <div style={{display:'flex',gap:8}}>
              <button style={{...btMini('#5856D618','#5856D6'),flex:1,padding:'9px 0'}} disabled={busy} onClick={validarTodo}>
                ✓ Validar todo lo restante
              </button>
              <button style={{...btMini(todoValidado?'#34C759':'#E5E5EA', todoValidado?'#fff':'#8E8E93'),flex:1,padding:'9px 0'}}
                disabled={!todoValidado} onClick={marcarLista}>
                {todoValidado?'📦 Marcar LISTA para entrega':'Valida o justifica todo primero'}
              </button>
            </div>
          )}
          {enEntrega&&(
            <div>
              <div style={{display:'flex',gap:8,marginBottom:8}}>
                <button style={{...btMini('#34C75918','#248A3D'),flex:1,padding:'8px 0'}} disabled={busy} onClick={entregarTodo}>
                  ✓ Marcar todo entregado
                </button>
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginBottom:8}}>
                <input value={receptor} onChange={e=>setReceptor(e.target.value)}
                  placeholder="Nombre de quien recibe *" style={{...css.input,flex:1,minWidth:170,padding:'8px 10px'}}/>
                <input value={receptorRut} onChange={e=>setReceptorRut(e.target.value)}
                  placeholder="RUT (opc.)" style={{...css.input,width:120,padding:'8px 10px'}}/>
              </div>
              <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:8}}>
                <FirmaPad label={`FIRMA CLIENTE ${sel.modalidad_entrega==='despacho'?'(opcional en despacho)':'*'}`} onChange={setFirmaCliente}/>
                <FirmaPad label="FIRMA PICKING (opcional)" onChange={setFirmaPicking}/>
              </div>
              {faltantes.length>0&&todoEntregado&&(
                <div style={{fontSize:10.5,color:'#C93400',fontWeight:700,marginBottom:6}}>
                  ◐ Entrega PARCIAL — sin entregar: {faltantes.map(f=>`${f.producto} (${Number(f.cantidad)-Number(f.cantidad_entregada)})`).join(' · ')}
                </div>
              )}
              <button style={{...btMini(todoEntregado&&receptor.trim()?'#1a1a2e':'#E5E5EA', todoEntregado&&receptor.trim()?'#fff':'#8E8E93'),
                width:'100%',padding:'11px 0',fontSize:13}}
                disabled={!todoEntregado||!receptor.trim()||genPdf} onClick={confirmarEntrega}>
                {genPdf?'Generando comprobante…':`✅ CONFIRMACIÓN FINAL — comprobante 2 copias #${sel.folio}`}
              </button>
            </div>
          )}
          {terminada&&(
            <div style={{fontSize:12,color:'#8E8E93',display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
              {sel.estado==='entregada'&&<>
                <span>✅ Entregada a <b>{sel.receptor_nombre}</b> por {sel.entregado_por}</span>
                {sel.pdf_url&&<a href={sel.pdf_url} target="_blank" rel="noreferrer" style={{color:'#007AFF',fontWeight:700}}>📄 Comprobante</a>}
                {sel.respaldo_firmado_url
                  ?<a href={sel.respaldo_firmado_url} target="_blank" rel="noreferrer" style={{color:'#34C759',fontWeight:700}}>🖋 Respaldo firmado</a>
                  :<span style={{color:'#FF9500',fontWeight:700}}>🖋 Sin respaldo firmado</span>}
              </>}
              {sel.estado==='anulada'&&<span style={{color:'#FF3B30'}}>✗ {sel.motivo_anulacion||'Anulada'}</span>}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ═══ COLA (master con bandejas) + PANEL ═══════════════════════════════════
  const activasAll = ordenes.filter(o=>['pendiente','asignada','en_picking','lista'].includes(o.estado))
  const inmediatas = activasAll.filter(o=>o.tipo_entrega!=='programada')
  const programadas = activasAll.filter(o=>o.tipo_entrega==='programada')
    .sort((a,b)=>(a.fecha_programada||'9999').localeCompare(b.fecha_programada||'9999'))
  const activas = bandeja==='programada'?programadas:inmediatas
  const hoy0 = new Date(); hoy0.setHours(0,0,0,0)
  const entregadasHoy = ordenes.filter(o=>o.estado==='entregada'&&new Date(o.entregada_at)>=hoy0)
  const anuladas = ordenes.filter(o=>o.estado==='anulada')
  const promEntrega = entregadasHoy.length
    ? Math.round(entregadasHoy.reduce((s,o)=>s+(new Date(o.entregada_at)-new Date(o.recibida_at)),0)/entregadasHoy.length/60000) : null
  const progVencidas = programadas.filter(o=>o.fecha_programada&&o.fecha_programada<=hoyISO()).length

  const FilaCola = ({o, terminada=false})=>{
    const m = minsDesde(o.recibida_at)
    const e = EST_PICK[o.estado]||{l:o.estado,c:'#8E8E93'}
    const activaSel = selId===o.id
    const esProg = bandeja==='programada'&&!terminada
    const vencida = esProg&&o.fecha_programada&&o.fecha_programada<=hoyISO()
    return (
      <tr onClick={()=>setSelId(o.id)}
        style={{cursor:'pointer', opacity:terminada?0.6:1,
          background: activaSel?'#007AFF10': o.urgente&&!terminada?'#FF3B3006':'transparent'}}>
        <td style={{...td,borderLeft:`3px solid ${activaSel?'#007AFF':terminada?'#E5E5EA':esProg?(vencida?'#FF3B30':'#5856D6'):semaforo(m)}`}}>
          {esProg
            ?<span style={{fontWeight:800,fontSize:11,color:vencida?'#FF3B30':'#5856D6'}}>{o.fecha_programada?o.fecha_programada.slice(5):'s/f'}{vencida?' ⚠':''}</span>
            :<span style={{fontWeight:800,color:terminada?'#8E8E93':semaforo(m),fontSize:11.5}}>{terminada?'—':fmtMin(m)}</span>}
        </td>
        <td style={{...td,fontFamily:'monospace',fontWeight:800,fontSize:12}}>
          <span onClick={(ev)=>{ev.stopPropagation();!terminada&&toggleUrgente(o)}} title="Click: alternar urgente">
            {o.urgente?'⚡':''}#{o.folio}
          </span>
        </td>
        <td style={{...td,fontSize:12}} title={o.modalidad_entrega==='despacho'?'Despacho a domicilio':'Retiro cliente'}>
          {o.modalidad_entrega==='despacho'?'🚚':'🏪'}
        </td>
        {sucSel==='todas'&&<td style={{...td,fontSize:10.5,color:'#8E8E93'}}>{nomSuc(o.sucursal_codigo).replace('Sucursal ','')}</td>}
        <td style={{...td,maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',fontSize:11.5}}>
          {o.cliente_nombre||<span style={{color:'#C7C7CC'}}>—</span>}
          {esProg&&o.modalidad_entrega==='despacho'&&(o.despacho_registrado_at
            ?<span style={{fontSize:9.5,color:'#8E8E93',display:'block'}}>{o.despacho_comuna||o.despacho_direccion||''}</span>
            :<span style={{fontSize:9,color:'#FF9500',fontWeight:800,display:'block'}}>⏳ sin datos de despacho</span>)}
        </td>
        <td style={{...td,textAlign:'right',fontWeight:700,fontSize:11.5}}>{o.total_items}<span style={{color:'#C7C7CC'}}>/</span>{Number(o.total_unidades)}</td>
        <td style={td}><span style={{fontSize:9,fontWeight:800,color:e.c,background:e.c+'15',padding:'2px 7px',borderRadius:10}}>{e.l}</span></td>
        <td style={{...td,textAlign:'right'}}>
          {!terminada&&o.estado==='pendiente'&&<span style={{display:'inline-flex',gap:4}}>
            {o.tipo_entrega!=='programada'&&
              <button style={btMini('#5856D615','#5856D6')} title="Programar entrega"
                onClick={(ev)=>{ev.stopPropagation();setProgEdit({ordenId:o.id,fecha:hoyISO(),modalidad:o.modalidad_entrega})}}>📅</button>}
            <button style={btMini('#007AFF','#fff')} disabled={busy}
              onClick={(ev)=>{ev.stopPropagation();tomar(o)}}>🏃</button>
          </span>}
          {terminada&&o.pdf_url&&<a href={o.pdf_url} target="_blank" rel="noreferrer" onClick={ev=>ev.stopPropagation()} style={{fontSize:11,color:'#007AFF',fontWeight:700}}>📄</a>}
        </td>
      </tr>
    )
  }

  return (
    <div>
      {/* Barra superior */}
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10,flexWrap:'wrap'}}>
        <div style={css.t1}>🛒 Picking</div>
        <span style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:9,fontWeight:800,color:'#34C759',
          background:'#34C75912',padding:'3px 9px',borderRadius:20}}>
          <span style={{width:6,height:6,borderRadius:3,background:'#34C759'}}/> EN VIVO
        </span>
        <div style={{display:'inline-flex',background:'#F2F2F7',borderRadius:9,padding:2}}>
          {[['cola','Cola'],['respaldos','Respaldos'],['reporte','Reporte']].map(([k,l])=>(
            <button key={k} onClick={()=>setTabVista(k)}
              style={{padding:'5px 14px',borderRadius:7,border:'none',fontSize:12,fontWeight:700,cursor:'pointer',
                background:tabVista===k?'#fff':'transparent',color:tabVista===k?'#1C1C1E':'#8E8E93',
                boxShadow:tabVista===k?'0 1px 3px rgba(0,0,0,0.1)':'none'}}>{l}</button>
          ))}
        </div>
        {esCD&&(
          <select value={sucSel} onChange={e=>setSucSel(e.target.value)} style={{...css.select,width:150,padding:'6px 10px'}}>
            <option value="todas">Todas las tiendas</option>
            {sucsTienda.map(s=><option key={s.codigo} value={s.codigo}>{s.nombre}</option>)}
          </select>
        )}
        <div style={{marginLeft:'auto',display:'flex',gap:12,fontSize:11,color:'#6D6D72',fontWeight:700}}>
          <span>⏳ {inmediatas.filter(o=>o.estado==='pendiente').length}</span>
          <span>🏃 {activasAll.filter(o=>o.estado==='asignada'||o.estado==='en_picking').length}</span>
          <span>📦 {activasAll.filter(o=>o.estado==='lista').length}</span>
          <span>✅ {entregadasHoy.length}{promEntrega!=null?` · ${fmtMin(promEntrega)}`:''}</span>
        </div>
      </div>
      {msg&&<div style={{padding:'7px 12px',borderRadius:8,background:msg.startsWith('✅')||msg.startsWith('📅')||msg.startsWith('⚡')?'#34C75915':'#FF950015',
        color:msg.startsWith('✅')||msg.startsWith('📅')||msg.startsWith('⚡')?'#248A3D':'#C93400',fontSize:12,fontWeight:600,marginBottom:8}}>{msg}</div>}

      {/* Modal seleccion de pickeador (asignacion por boleta) */}
      {pickerSel&&(()=>{
        const cand = trabsDeSuc(pickerSel.orden.sucursal_codigo)
        const lista = cand.length?cand:trabs
        return (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:9000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}
          onClick={()=>setPickerSel(null)}>
          <div style={{background:'#fff',borderRadius:16,padding:20,width:'100%',maxWidth:420,maxHeight:'80vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:14,fontWeight:800,marginBottom:2}}>
              {pickerSel.reasignar?'🔄 Reasignar pickeador':'🏃 ¿Quién hace el picking?'}
            </div>
            <div style={{fontSize:11.5,color:'#8E8E93',marginBottom:14}}>
              #{pickerSel.orden.folio} · {pickerSel.orden.cliente_nombre||'Sin cliente'}
              {pickerSel.reasignar&&pickerSel.orden.pickeador_nombre?` · actual: ${pickerSel.orden.pickeador_nombre}`:''}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {lista.map(t=>{
                const actual = pickerSel.reasignar&&t.id===pickerSel.orden.pickeador_id
                return (
                <button key={t.id} disabled={busy||actual} onClick={()=>asignarPicker(t)}
                  style={{padding:'14px 10px',borderRadius:12,border:actual?'2px solid #5856D6':'1px solid #E5E5EA',
                    background:actual?'#5856D610':'#FAFAFC',cursor:actual?'default':'pointer',textAlign:'center',
                    fontSize:13,fontWeight:700,color:'#1C1C1E',opacity:busy?0.6:1}}>
                  🏃 {t.nombre} {t.apellido||''}
                  {actual&&<div style={{fontSize:9.5,color:'#5856D6',fontWeight:800,marginTop:2}}>ACTUAL</div>}
                </button>)
              })}
              {!lista.length&&<div style={{gridColumn:'1/-1',textAlign:'center',padding:20,color:'#8E8E93',fontSize:12}}>Sin trabajadores registrados para esta sucursal</div>}
            </div>
            <div style={{display:'flex',justifyContent:'flex-end',marginTop:14}}>
              <Bt v="gry" sm onClick={()=>setPickerSel(null)}>Cancelar</Bt>
            </div>
          </div>
        </div>)
      })()}

      {/* Modal programar entrega */}
      {progEdit&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:9000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}
          onClick={()=>setProgEdit(null)}>
          <div style={{background:'#fff',borderRadius:16,padding:20,width:'100%',maxWidth:360}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:14,fontWeight:800,marginBottom:10}}>📅 Programar entrega</div>
            <div style={{fontSize:11,fontWeight:700,color:'#6D6D72',marginBottom:4}}>Fecha tentativa de entrega</div>
            <input type="date" value={progEdit.fecha} min={hoyISO()}
              onChange={e=>setProgEdit({...progEdit,fecha:e.target.value})}
              style={{...css.input,width:'100%',marginBottom:12}}/>
            <div style={{fontSize:11,fontWeight:700,color:'#6D6D72',marginBottom:4}}>Modalidad</div>
            <div style={{display:'flex',gap:8,marginBottom:16}}>
              {[['retiro','🏪 Retiro cliente'],['despacho','🚚 Despacho a domicilio']].map(([m,l])=>(
                <button key={m} onClick={()=>setProgEdit({...progEdit,modalidad:m})}
                  style={{flex:1,padding:'9px 0',borderRadius:10,border:'none',fontSize:12,fontWeight:700,cursor:'pointer',
                    background:progEdit.modalidad===m?'#1a1a2e':'#F2F2F7',color:progEdit.modalidad===m?'#fff':'#6D6D72'}}>{l}</button>
              ))}
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <Bt v="gry" sm onClick={()=>setProgEdit(null)}>Cancelar</Bt>
              <Bt v="pri" sm onClick={guardarProgramacion}>Guardar</Bt>
            </div>
          </div>
        </div>
      )}

      {tabVista==='cola'&&(
        loading?<div style={css.empty}>⏳ Cargando cola…</div>:(
        <div style={{display:'flex',gap:12,alignItems:'stretch',flexWrap:'wrap'}}>
          <div style={{flex:'1 1 470px',minWidth:390,border:'1px solid #E5E5EA',borderRadius:10,
            maxHeight:'74vh',overflowY:'auto',overflowX:'auto'}}>
            {/* Bandejas — identidad visual fuerte por tipo de entrega */}
            <div style={{display:'flex',gap:6,padding:'8px 8px 8px',background:'#FAFAFC',position:'sticky',top:0,zIndex:2,
              borderBottom:`3px solid ${bandeja==='programada'?'#5856D6':'#007AFF'}`}}>
              {[['inmediata','⚡','ENTREGA INMEDIATA',inmediatas.length,'#007AFF',''],
                ['programada','🚚','POR DESPACHAR',programadas.length,'#5856D6',progVencidas?`${progVencidas} para hoy ⚠`:'']].map(([k,ic,l,n,c,extra])=>(
                <button key={k} onClick={()=>setBandeja(k)}
                  style={{flex:1,padding:'10px 6px',border:'none',borderRadius:10,cursor:'pointer',
                    display:'flex',alignItems:'center',justifyContent:'center',gap:8,
                    background:bandeja===k?c:'#EFEFF4',transition:'background 0.15s'}}>
                  <span style={{fontSize:16}}>{ic}</span>
                  <span style={{fontSize:11.5,fontWeight:900,letterSpacing:'0.03em',color:bandeja===k?'#fff':'#6D6D72'}}>{l}</span>
                  <span style={{fontSize:11.5,fontWeight:900,minWidth:22,padding:'1px 7px',borderRadius:10,
                    background:bandeja===k?'rgba(255,255,255,0.25)':'#fff',color:bandeja===k?'#fff':c}}>{n}</span>
                  {extra&&<span style={{fontSize:9.5,fontWeight:800,color:bandeja===k?'#FFD60A':'#FF9500'}}>{extra}</span>}
                </button>
              ))}
            </div>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr>
                <th style={th}>{bandeja==='programada'?'FECHA':'ESPERA'}</th><th style={th}>FOLIO</th><th style={{...th,width:30}}>MOD</th>
                {sucSel==='todas'&&<th style={th}>TIENDA</th>}
                <th style={th}>CLIENTE</th><th style={{...th,textAlign:'right'}}>ÍT/UDS</th>
                <th style={th}>ESTADO</th><th style={{...th,textAlign:'right'}}></th>
              </tr></thead>
              <tbody>
                {activas.map(o=><FilaCola key={o.id} o={o}/>)}
                {!activas.length&&(
                  <tr><td colSpan={sucSel==='todas'?8:7} style={{...td,textAlign:'center',padding:'28px 0',color:'#8E8E93'}}>
                    {bandeja==='programada'?'📅 Sin entregas programadas':'🛒 Bandeja vacía — cada venta aparece aquí en menos de un minuto'}
                  </td></tr>
                )}
                {bandeja==='inmediata'&&(entregadasHoy.length>0||anuladas.length>0)&&(
                  <tr><td colSpan={sucSel==='todas'?8:7} style={{...th,fontSize:9,paddingTop:10}}>
                    TERMINADAS HOY · {entregadasHoy.length} entregadas{anuladas.length?` · ${anuladas.length} anuladas`:''}</td></tr>
                )}
                {bandeja==='inmediata'&&entregadasHoy.slice(0,15).map(o=><FilaCola key={o.id} o={o} terminada/>)}
                {bandeja==='inmediata'&&anuladas.slice(0,8).map(o=><FilaCola key={o.id} o={o} terminada/>)}
              </tbody>
            </table>
          </div>
          <div style={{flex:'1 1 490px',minWidth:410,border:'1px solid #E5E5EA',borderRadius:10,
            maxHeight:'74vh',overflow:'hidden',background:'#fff'}}>
            <PanelOrden/>
          </div>
        </div>
      ))}

      {/* TAB RESPALDOS — conciliación documental de comprobantes firmados */}
      {tabVista==='respaldos'&&(()=>{
        const entregadas = ordenes.filter(o=>o.estado==='entregada')
          .sort((a,b)=>(b.entregada_at||'').localeCompare(a.entregada_at||''))
        const filtradas = soloSinRespaldo?entregadas.filter(o=>!o.respaldo_firmado_url):entregadas
        const conResp = entregadas.filter(o=>o.respaldo_firmado_url).length
        return (
          <div>
            <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap',marginBottom:10}}>
              <span style={{fontSize:12,fontWeight:700,color:'#6D6D72'}}>
                Entregas últimas 72h: <b style={{color:'#1C1C1E'}}>{entregadas.length}</b> ·
                con respaldo firmado: <b style={{color:'#34C759'}}>{conResp}</b> ·
                pendientes: <b style={{color:entregadas.length-conResp?'#C93400':'#34C759'}}>{entregadas.length-conResp}</b>
              </span>
              <label style={{fontSize:11,fontWeight:700,color:'#6D6D72',display:'inline-flex',gap:5,alignItems:'center',cursor:'pointer'}}>
                <input type="checkbox" checked={soloSinRespaldo} onChange={e=>setSoloSinRespaldo(e.target.checked)}/>
                Solo pendientes de respaldo
              </label>
              <span style={{marginLeft:'auto',fontSize:10.5,color:'#8E8E93'}}>
                Sube la foto o scan del comprobante firmado por el cliente (copia interna)
              </span>
            </div>
            <div style={{overflowX:'auto',border:'1px solid #E5E5EA',borderRadius:10}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead><tr>
                  <th style={th}>FOLIO</th><th style={{...th,width:30}}>MOD</th><th style={th}>TIENDA</th>
                  <th style={th}>RECEPTOR</th><th style={th}>ENTREGADA</th><th style={th}>ENTREGÓ</th>
                  <th style={th}>COMPROBANTE</th><th style={th}>RESPALDO FIRMADO</th>
                </tr></thead>
                <tbody>
                  {filtradas.map(o=>(
                    <tr key={o.id}>
                      <td style={{...td,fontFamily:'monospace',fontWeight:800}}>#{o.folio} <span style={{fontSize:9,color:'#8E8E93'}}>{o.bsale_doc_type==='factura'?'FAC':'BOL'}</span>
                        {o.entrega_completa===false&&<span style={{fontSize:9,color:'#FF9500',fontWeight:800,marginLeft:4}}>◐</span>}
                      </td>
                      <td style={td}>{o.modalidad_entrega==='despacho'?'🚚':'🏪'}</td>
                      <td style={{...td,fontSize:11}}>{nomSuc(o.sucursal_codigo)}</td>
                      <td style={td}>{o.receptor_nombre||'—'}{o.receptor_rut?<span style={{color:'#8E8E93',fontSize:10}}> · {o.receptor_rut}</span>:''}</td>
                      <td style={{...td,fontSize:11}}>{o.entregada_at?new Date(o.entregada_at).toLocaleString('es-CL',{dateStyle:'short',timeStyle:'short'}):'—'}</td>
                      <td style={{...td,fontSize:11,color:'#8E8E93'}}>{o.entregado_por||'—'}</td>
                      <td style={td}>{o.pdf_url?<a href={o.pdf_url} target="_blank" rel="noreferrer" style={{fontSize:11,color:'#007AFF',fontWeight:700}}>📄 Ver PDF</a>:'—'}</td>
                      <td style={td}>
                        {o.respaldo_firmado_url?(
                          <span style={{display:'inline-flex',gap:8,alignItems:'center'}}>
                            <a href={o.respaldo_firmado_url} target="_blank" rel="noreferrer" style={{fontSize:11,color:'#34C759',fontWeight:800}}>🖋 Ver respaldo</a>
                            <span style={{fontSize:9.5,color:'#8E8E93'}}>{o.respaldo_firmado_por} · {o.respaldo_firmado_at?new Date(o.respaldo_firmado_at).toLocaleDateString('es-CL'):''}</span>
                          </span>
                        ):(
                          <label style={{...btMini('#FF950015','#C93400'),display:'inline-block',cursor:'pointer'}}>
                            {subiendoResp===o.id?'Subiendo…':'⬆ Subir firmado'}
                            <input type="file" accept="image/*,application/pdf" style={{display:'none'}}
                              disabled={subiendoResp===o.id}
                              onChange={e=>{subirRespaldo(o, e.target.files?.[0]); e.target.value=''}}/>
                          </label>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!filtradas.length&&(
                    <tr><td colSpan={8} style={{...td,textAlign:'center',padding:'28px 0',color:'#8E8E93'}}>
                      {soloSinRespaldo?'✅ Todo respaldado — conciliación documental al día':'Sin entregas en las últimas 72 horas'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{fontSize:10.5,color:'#8E8E93',marginTop:8}}>
              Para períodos anteriores usa la pestaña Reporte (columna "RespaldoFirmado" en el Excel).
            </div>
          </div>
        )
      })()}
      {tabVista==='reporte'&&(<>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:10}}>
          <div style={{display:'inline-flex',background:'#F2F2F7',borderRadius:9,padding:2}}>
            {[['hoy','Hoy'],['ayer','Ayer'],['7d','7 días'],['30d','30 días'],['custom','Rango']].map(([k,l])=>(
              <button key={k} onClick={()=>setRepRango(k)}
                style={{padding:'5px 12px',borderRadius:7,border:'none',fontSize:11,fontWeight:700,cursor:'pointer',
                  background:repRango===k?'#fff':'transparent',color:repRango===k?'#1C1C1E':'#8E8E93'}}>{l}</button>
            ))}
          </div>
          {repRango==='custom'&&<>
            <input type="date" value={repD1} onChange={e=>setRepD1(e.target.value)} style={{...css.input,padding:'5px 8px'}}/>
            <input type="date" value={repD2} onChange={e=>setRepD2(e.target.value)} style={{...css.input,padding:'5px 8px'}}/>
            <Bt v="gry" sm onClick={cargarReporte}>Aplicar</Bt>
          </>}
          <div style={{marginLeft:'auto'}}>
            <Bt v="gry" sm onClick={exportarReporte} dis={!repData||repLoading}>⬇ Excel</Bt>
          </div>
        </div>
        {repLoading&&<div style={css.empty}>⏳ Generando reporte…</div>}
        {!repLoading&&repData&&(()=>{
          const rows = sucSel==='todas'?repData.rows:repData.rows.filter(o=>o.sucursal_codigo===sucSel)
          const porSuc = {}
          rows.forEach(o=>{
            const s = porSuc[o.sucursal_codigo] = porSuc[o.sucursal_codigo]||{emit:0,boletas:0,facturas:0,uds:0,entreg:0,completas:0,parciales:0,proceso:0,anul:0,mins:[]}
            s.emit++; s.uds+=Number(o.total_unidades||0)
            o.bsale_doc_type==='factura'?s.facturas++:s.boletas++
            if(o.estado==='entregada'){ s.entreg++; o.entrega_completa?s.completas++:s.parciales++
              if(o.entregada_at) s.mins.push((new Date(o.entregada_at)-new Date(o.recibida_at))/60000) }
            else if(o.estado==='anulada') s.anul++
            else s.proceso++
          })
          const sucKeys = Object.keys(porSuc).sort()
          const tot = {emit:0,entreg:0,completas:0,parciales:0,proceso:0,anul:0,uds:0,mins:[]}
          sucKeys.forEach(k=>{const s=porSuc[k];tot.emit+=s.emit;tot.entreg+=s.entreg;tot.completas+=s.completas;tot.parciales+=s.parciales;tot.proceso+=s.proceso;tot.anul+=s.anul;tot.uds+=s.uds;tot.mins.push(...s.mins)})
          const prom=(a)=>a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length):null
          const pct=(a,b)=>b?Math.round(a/b*100):0
          const pendientes = rows.filter(o=>!['entregada','anulada'].includes(o.estado))
          const parcialesLista = rows.filter(o=>o.estado==='entregada'&&o.entrega_completa===false)
          // Entregas por hora del día (hora local de entregada_at)
          const porHora = {}
          rows.filter(o=>o.estado==='entregada'&&o.entregada_at).forEach(o=>{
            const h = new Date(o.entregada_at).getHours()
            porHora[h] = (porHora[h]||0)+1
          })
          const horasConDatos = Object.keys(porHora).map(Number)
          const hMin = horasConDatos.length?Math.min(9,...horasConDatos):9
          const hMax = horasConDatos.length?Math.max(19,...horasConDatos):19
          const horas = []; for(let h=hMin;h<=hMax;h++) horas.push(h)
          const maxHora = Math.max(1,...horas.map(h=>porHora[h]||0))
          // Entregas por pickeador
          const porPicker = {}
          rows.filter(o=>o.estado==='entregada').forEach(o=>{
            const k = o.pickeador_nombre||'(sin pickeador)'
            const p = porPicker[k] = porPicker[k]||{n:0,uds:0,parciales:0,mins:[]}
            p.n++; p.uds+=Number(o.total_unidades||0)
            if(o.entrega_completa===false) p.parciales++
            if(o.entregada_at&&o.asignada_at) p.mins.push((new Date(o.entregada_at)-new Date(o.asignada_at))/60000)
          })
          const pickers = Object.entries(porPicker).sort((a,b)=>b[1].n-a[1].n)
          const maxPicker = Math.max(1,...pickers.map(([,p])=>p.n))
          return (<>
            <div style={{overflowX:'auto',border:'1px solid #E5E5EA',borderRadius:10,marginBottom:14}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead><tr>
                  <th style={th}>SUCURSAL</th>
                  <th style={{...th,textAlign:'right'}}>EMITIDAS</th>
                  <th style={{...th,textAlign:'right'}}>BOL/FAC</th>
                  <th style={{...th,textAlign:'right'}}>UNIDADES</th>
                  <th style={{...th,textAlign:'right'}}>ENTREGADAS</th>
                  <th style={{...th,textAlign:'right'}}>% ENTREGA</th>
                  <th style={{...th,textAlign:'right'}}>COMPLETAS</th>
                  <th style={{...th,textAlign:'right'}}>PARCIALES</th>
                  <th style={{...th,textAlign:'right'}}>EN PROCESO</th>
                  <th style={{...th,textAlign:'right'}}>ANULADAS</th>
                  <th style={{...th,textAlign:'right'}}>PROM MIN</th>
                </tr></thead>
                <tbody>
                  {sucKeys.map(k=>{const s=porSuc[k];const p=pct(s.entreg,s.emit-s.anul);return(
                    <tr key={k}>
                      <td style={{...td,fontWeight:700}}>{nomSuc(k)}</td>
                      <td style={{...td,textAlign:'right',fontWeight:800}}>{s.emit}</td>
                      <td style={{...td,textAlign:'right',color:'#8E8E93'}}>{s.boletas}/{s.facturas}</td>
                      <td style={{...td,textAlign:'right'}}>{s.uds.toLocaleString('es-CL')}</td>
                      <td style={{...td,textAlign:'right',fontWeight:800,color:'#34C759'}}>{s.entreg}</td>
                      <td style={{...td,textAlign:'right',fontWeight:800,color:p>=95?'#34C759':p>=80?'#FF9500':'#FF3B30'}}>{p}%</td>
                      <td style={{...td,textAlign:'right'}}>{s.completas}</td>
                      <td style={{...td,textAlign:'right',color:s.parciales?'#FF9500':'#C7C7CC',fontWeight:s.parciales?800:400}}>{s.parciales}</td>
                      <td style={{...td,textAlign:'right',color:s.proceso?'#007AFF':'#C7C7CC',fontWeight:s.proceso?800:400}}>{s.proceso}</td>
                      <td style={{...td,textAlign:'right',color:s.anul?'#FF3B30':'#C7C7CC'}}>{s.anul}</td>
                      <td style={{...td,textAlign:'right'}}>{prom(s.mins)??'—'}</td>
                    </tr>)})}
                  <tr style={{background:'#FAFAFC'}}>
                    <td style={{...td,fontWeight:800}}>TOTAL</td>
                    <td style={{...td,textAlign:'right',fontWeight:800}}>{tot.emit}</td>
                    <td style={td}></td>
                    <td style={{...td,textAlign:'right',fontWeight:700}}>{tot.uds.toLocaleString('es-CL')}</td>
                    <td style={{...td,textAlign:'right',fontWeight:800,color:'#34C759'}}>{tot.entreg}</td>
                    <td style={{...td,textAlign:'right',fontWeight:800}}>{pct(tot.entreg,tot.emit-tot.anul)}%</td>
                    <td style={{...td,textAlign:'right'}}>{tot.completas}</td>
                    <td style={{...td,textAlign:'right',fontWeight:800,color:tot.parciales?'#FF9500':'#C7C7CC'}}>{tot.parciales}</td>
                    <td style={{...td,textAlign:'right',fontWeight:800,color:tot.proceso?'#007AFF':'#C7C7CC'}}>{tot.proceso}</td>
                    <td style={{...td,textAlign:'right',color:'#FF3B30'}}>{tot.anul}</td>
                    <td style={{...td,textAlign:'right',fontWeight:700}}>{prom(tot.mins)??'—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{display:'flex',gap:14,flexWrap:'wrap',marginBottom:14}}>
              {/* Entregas por hora */}
              <div style={{flex:'1 1 380px',minWidth:320,border:'1px solid #E5E5EA',borderRadius:10,padding:'10px 14px'}}>
                <div style={{fontSize:10,fontWeight:800,color:'#6D6D72',letterSpacing:'0.03em',marginBottom:8}}>
                  ⏰ ENTREGAS POR HORA DEL DÍA
                </div>
                {tot.entreg===0&&<div style={{fontSize:11,color:'#C7C7CC',padding:'8px 0'}}>Sin entregas en el período</div>}
                {tot.entreg>0&&horas.map(h=>{
                  const n = porHora[h]||0
                  return (
                    <div key={h} style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                      <span style={{fontSize:10,fontFamily:'monospace',color:'#8E8E93',width:42,textAlign:'right'}}>
                        {String(h).padStart(2,'0')}-{String(h+1).padStart(2,'0')}
                      </span>
                      <div style={{flex:1,height:14,background:'#F2F2F7',borderRadius:4,overflow:'hidden'}}>
                        <div style={{height:'100%',width:`${Math.round(n/maxHora*100)}%`,
                          background:n?'#34C759':'transparent',borderRadius:4,transition:'width 0.25s'}}/>
                      </div>
                      <span style={{fontSize:11,fontWeight:800,width:26,color:n?'#1C1C1E':'#C7C7CC'}}>{n||'·'}</span>
                    </div>
                  )
                })}
              </div>
              {/* Entregas por pickeador */}
              <div style={{flex:'1 1 380px',minWidth:320,border:'1px solid #E5E5EA',borderRadius:10,padding:'10px 14px'}}>
                <div style={{fontSize:10,fontWeight:800,color:'#6D6D72',letterSpacing:'0.03em',marginBottom:8}}>
                  🏃 ENTREGAS POR PICKEADOR
                </div>
                {!pickers.length&&<div style={{fontSize:11,color:'#C7C7CC',padding:'8px 0'}}>Sin entregas en el período</div>}
                {pickers.map(([nom,p])=>{
                  const prom = p.mins.length?Math.round(p.mins.reduce((x,y)=>x+y,0)/p.mins.length):null
                  return (
                    <div key={nom} style={{marginBottom:7}}>
                      <div style={{display:'flex',alignItems:'baseline',gap:8}}>
                        <span style={{fontSize:12,fontWeight:700,flex:1}}>{nom}</span>
                        <span style={{fontSize:13,fontWeight:900}}>{p.n}</span>
                        <span style={{fontSize:10,color:'#8E8E93'}}>
                          {p.uds.toLocaleString('es-CL')} uds{prom!=null?` · ${prom}m prom`:''}{p.parciales?` · ◐${p.parciales}`:''}
                        </span>
                      </div>
                      <div style={{height:6,background:'#F2F2F7',borderRadius:3,marginTop:2,overflow:'hidden'}}>
                        <div style={{height:'100%',width:`${Math.round(p.n/maxPicker*100)}%`,background:'#007AFF',borderRadius:3}}/>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {pendientes.length>0&&(<>
              <div style={{fontSize:11,fontWeight:800,color:'#C93400',margin:'0 2px 6px'}}>
                ⚠ SIN REGISTRO DE ENTREGA · {pendientes.length} — la lista a conciliar
              </div>
              <div style={{overflowX:'auto',border:'1px solid #FF950040',borderRadius:10,marginBottom:14}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr><th style={th}>FOLIO</th><th style={th}>TIENDA</th><th style={th}>CLIENTE</th>
                    <th style={{...th,textAlign:'right'}}>UDS</th><th style={th}>ESTADO</th><th style={th}>VENDIÓ</th>
                    <th style={{...th,textAlign:'right'}}>ANTIGÜEDAD</th></tr></thead>
                  <tbody>{pendientes.map(o=>{const m=minsDesde(o.recibida_at);const e=EST_PICK[o.estado];return(
                    <tr key={o.id} style={{cursor:'pointer'}} onClick={()=>{setTabVista('cola');setSelId(o.id)}}>
                      <td style={{...td,fontFamily:'monospace',fontWeight:800}}>#{o.folio} <span style={{fontSize:9,color:'#8E8E93'}}>{o.bsale_doc_type==='factura'?'FAC':'BOL'}</span></td>
                      <td style={td}>{nomSuc(o.sucursal_codigo)}</td>
                      <td style={td}>{o.cliente_nombre||'—'}</td>
                      <td style={{...td,textAlign:'right'}}>{Number(o.total_unidades)}</td>
                      <td style={td}><span style={{fontSize:9,fontWeight:800,color:e.c,background:e.c+'15',padding:'2px 8px',borderRadius:10}}>{e.l}</span></td>
                      <td style={{...td,fontSize:11,color:'#8E8E93'}}>{o.vendedor_nombre||'—'}</td>
                      <td style={{...td,textAlign:'right',fontWeight:800,color:semaforo(Math.min(m,11))}}>{fmtMin(m)}</td>
                    </tr>)})}</tbody>
                </table>
              </div>
            </>)}
            {parcialesLista.length>0&&(
              <div style={{fontSize:11,color:'#8E8E93',margin:'0 2px'}}>
                ◐ Entregas parciales del período: {parcialesLista.map(o=>`#${o.folio}`).join(', ')} — revisar con Postventa si corresponde NC o retiro posterior.
              </div>
            )}
          </>)
        })()}
      </>)}
    </div>
  )
}


export default PickingView
