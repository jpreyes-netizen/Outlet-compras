// ============================================================
// OUTLET LOGÍSTICA — PickingView.jsx
// Módulo Picking & Entrega (retail). Extraído del monolito
// LogisticaApp.jsx (líneas ~23000-24151) en Fase 0 del refactor.
// ============================================================
import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { css, Bt, BRAND_ORANGE } from './ui_compartida.jsx'
import { LOGO_B64 } from './logo_b64.js'

// ═══════════════════════════════════════════════════════════════════════════
// PICKING & ENTREGA v4 — Estándar WMS profesional
//  · Bandejas: ⚡ Entrega inmediata / 📅 Programada (fecha + retiro/despacho)
//  · Scan-to-pick: validación por escaneo o tipeo de SKU (pistola USB o manual)
//  · Steppers ± por línea para conteos parciales
//  · Comprobante de entrega en DOS COPIAS (interna + cliente) con declaración
//    de conformidad — se firma FISICAMENTE sobre el impreso (sin firma digital)
//  · Tab Respaldos: carga de documentos firmados para conciliación documental
// ═══════════════════════════════════════════════════════════════════════════
const PUEDE_PICKING = ['admin','jefe_bodega','coordinador','jefe_sucursal','coordinador_suc']
const ES_FLETE = (it)=>/despacho|flete|env[ií]o/i.test(it.producto||'')||/despacho|flete/i.test(it.sku||'')
const EST_PICK = {
  pendiente:  {l:'EN COLA',   c:'#FF9500'},
  asignada:   {l:'ASIGNADA',  c:'#007AFF'},
  en_picking: {l:'PICKING',   c:'#5856D6'},
  lista:      {l:'LISTA',     c:'#34C759'},
  despachada: {l:'EN RUTA',   c:'#AF52DE'},
  entregada:  {l:'ENTREGADA', c:'#8E8E93'},
  anulada:    {l:'ANULADA',   c:'#FF3B30'},
}


// Nombre del tipo de documento BSALE (boleta | factura | cotizacion)
const DOC_L = (t)=> t==='factura'?'Factura':t==='cotizacion'?'Cotización':'Boleta'
const DOC_S = (t)=> t==='factura'?'FAC':t==='cotizacion'?'COT':'BOL'

// Formato de pesos chilenos (para valores de despacho y recaudación)
const fmtCLP = (n)=> n==null||n===''||isNaN(Number(n)) ? '—'
  : '$'+Number(n).toLocaleString('es-CL',{maximumFractionDigits:0})

// ── PDF: resolver autoTable de forma tolerante ────────────────────────────
// jspdf-autotable 3.8.x expone la funcion en .default.default segun el bundler
// (no en .default). Se resuelve en runtime y se cae al metodo del prototipo.
async function cargarPdf() {
  const {jsPDF} = await import('jspdf')
  const mod = await import('jspdf-autotable')
  const fn = typeof mod.default === 'function' ? mod.default
           : typeof mod.default?.default === 'function' ? mod.default.default
           : typeof mod.autoTable === 'function' ? mod.autoTable : null
  const autoTable = (doc, opts)=>{
    if(fn) return fn(doc, opts)
    if(typeof doc.autoTable === 'function') return doc.autoTable(opts)
    throw new Error('jspdf-autotable no disponible')
  }
  return {jsPDF, autoTable}
}

function PickingView({cu, sucs}) {
  const esCD = ['admin','jefe_bodega','coordinador'].includes(cu?.rol)
  const sucPropia = (!esCD && cu?.sucursal_codigo) ? cu.sucursal_codigo : null
  const [tabVista, setTabVista] = useState('cola')      // cola | respaldos | reporte | pantalla
  const [pantallaFull,setPantallaFull]=useState(false)   // pantalla cliente en modo TV
  const [pantallaSon,setPantallaSon]=useState(true)      // aviso sonoro al quedar listo
  const [bandeja,  setBandeja]  = useState('inmediata') // inmediata | programada
  const [sucSel,   setSucSel]   = useState(sucPropia || 'todas')
  const [ordenes,  setOrdenes]  = useState([])
  const [selId,    setSelId]    = useState(null)
  const [items,    setItems]    = useState([])
  const [itemsLoad,setItemsLoad]= useState(false)
  const [loading,  setLoading]  = useState(true)
  const [msg,      setMsg]      = useState('')
  const [reloj,    setReloj]    = useState(Date.now())
  const [choferes, setChoferes] = useState([])           // log_choferes activos
  const [choferSel,setChoferSel]= useState('')           // chofer que entrega el despacho
  const [guiaNum,  setGuiaNum]  = useState('')           // N° guia de despacho BSALE
  const [guiaFile, setGuiaFile] = useState(null)         // archivo guia firmada (cierre)
  const [rendPend, setRendPend] = useState([])           // despachos por_pagar entregados sin rendir
  const [rendHist, setRendHist] = useState([])           // rendiciones registradas
  const [rendLoad, setRendLoad] = useState(false)
  const [rendModal,setRendModal]= useState(null)         // {choferNombre, ordenes, sel:Set, montoRecibido, obs}
  const [trabs,    setTrabs]    = useState([])
  const [pickerSel, setPickerSel]= useState(null)      // {orden, reasignar} → modal seleccion pickeador
  const [rechazoEdit,setRechazoEdit]=useState(null)     // null=cerrado | ''=escribiendo motivo de rechazo
  const [receptor, setReceptor] = useState('')
  const [receptorRut,setReceptorRut]=useState('')
  const [motivoEdit,setMotivoEdit]=useState(null)
  const [progEdit, setProgEdit] = useState(null)        // {ordenId, fecha, modalidad}
  const [scan,     setScan]     = useState('')
  const [scanFlash,setScanFlash]= useState(null)        // {itemId, ok}
  const scanRef = useRef(null)
  const [genPdf,   setGenPdf]   = useState(false)
  const [busy,     setBusy]     = useState(false)
  const [subiendoResp,setSubiendoResp]=useState(null)
  const [respRango, setRespRango]=useState('7d')         // hoy | 7d | 30d | rango
  const [respD1,setRespD1]=useState(''); const [respD2,setRespD2]=useState('')
  const [respData, setRespData]=useState(null)            // filas del reporte de respaldos
  const [respLoading,setRespLoading]=useState(false)
  const [respTxt,  setRespTxt]  =useState('')             // filtro texto libre
  const [respEstado,setRespEstado]=useState('todos')      // todos | pendientes | con
  const [respSort, setRespSort]=useState({col:'entregada_at',dir:'desc'})
  const [isMobile, setIsMobile]=useState(()=>typeof window!=='undefined'&&window.innerWidth<=768)
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
        .eq('archivada', false)   // limpieza 03-08-2026: lo histórico no aparece en pantalla
        .or(`estado.in.(pendiente,asignada,en_picking,lista,despachada),and(estado.in.(entregada,anulada),recibida_at.gte.${desde})`)
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
    supabase.from('log_choferes')
      .select('id,nombre,apellido,patente,empresa_transporte,activo')
      .eq('activo',true).order('nombre').then(({data})=>setChoferes(data||[]))
  },[])
  useEffect(()=>{
    const f = ()=>setIsMobile(window.innerWidth<=768)
    window.addEventListener('resize', f)
    return ()=>window.removeEventListener('resize', f)
  },[])
  useEffect(()=>{ if(selId){ cargarItems(selId) } },[selId])
  useEffect(()=>{
    const o = ordenes.find(x=>x.id===selId)
    // Precarga lo que pertenece a ESTA orden
    setChoferSel(o?.chofer_id||'')
    setGuiaNum(o?.guia_numero||'')
    setGuiaFile(null)
    // Limpia todo lo escrito a mano: no debe arrastrarse entre órdenes
    setReceptor(o?.receptor_nombre||'')
    setReceptorRut(o?.receptor_rut||'')
    setMotivoEdit(null)
    setRechazoEdit(null)
  },[selId])   // ordenes intencionalmente fuera de deps: solo precarga al cambiar de orden

  // Campanilla al quedar un pedido LISTO (solo en la pantalla de cliente)
  const listasRef = useRef(null)
  useEffect(()=>{
    const idsListas = ordenes.filter(o=>o.estado==='lista'&&o.modalidad_entrega!=='despacho').map(o=>o.id)
    const prev = listasRef.current
    listasRef.current = idsListas
    if(prev===null) return                       // primera carga: no suena
    if(tabVista!=='pantalla'||!pantallaSon) return
    if(!idsListas.some(id=>!prev.includes(id))) return
    try{
      const AC = window.AudioContext||window.webkitAudioContext
      if(!AC) return
      const ac = new AC()
      ;[[880,0],[1174,0.16]].forEach(([f,t])=>{
        const o=ac.createOscillator(), g=ac.createGain()
        o.type='sine'; o.frequency.value=f
        g.gain.setValueAtTime(0.0001, ac.currentTime+t)
        g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime+t+0.03)
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime+t+0.42)
        o.connect(g); g.connect(ac.destination)
        o.start(ac.currentTime+t); o.stop(ac.currentTime+t+0.45)
      })
      setTimeout(()=>{try{ac.close()}catch(e){}}, 1200)
    }catch(e){}
  },[ordenes,tabVista,pantallaSon])

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
    // Optimista: reflejar asignacion en la UI al instante (sin esperar realtime)
    setOrdenes(prev=>prev.map(o=>o.id===orden.id?{...o,
      ...(esReasig?{}:{estado:'asignada'}), pickeador_id:t.id, pickeador_nombre:nom}:o))
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
    const cant = Math.max(0, Math.min(Number(cantidad), Number(it.cantidad)))
    // Optimista: la UI cambia al instante; la persistencia corre en background
    setItems(prev=>prev.map(x=>x.id===it.id?{...x,
      cantidad_confirmada:cant, motivo_no_entrega:motivo,
      confirmado_at:cant>0?new Date().toISOString():null,
      confirmado_por:cant>0?(cu?.nombre||''):null}:x))
    if(sel && !sel.inicio_picking_at){
      supabase.from('log_picking_ordenes').update({
        estado:'en_picking', inicio_picking_at:new Date().toISOString(),
      }).eq('id',sel.id).is('inicio_picking_at',null).then(()=>{},()=>{})
    }
    const {error} = await supabase.from('log_picking_items').update({
      cantidad_confirmada:cant,
      confirmado_at:cant>0?new Date().toISOString():null,
      confirmado_por:cant>0?(cu?.nombre||''):null,
      motivo_no_entrega:motivo,
    }).eq('id',it.id)
    if(error){ flash('⚠️ '+error.message); cargarItems(sel.id); return }
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
  // ── Rechazo de picking: la preparacion tiene un error → vuelve a picking ──
  const rechazarPicking = async ()=>{
    const motivo = (rechazoEdit||'').trim()
    if(!motivo || !sel) return
    setBusy(true)
    const rechazo = {motivo, por:cu?.nombre||'', at:new Date().toISOString(), pickeador:sel.pickeador_nombre||''}
    const rechazos = [ ...(Array.isArray(sel.picking_rechazos)?sel.picking_rechazos:[]), rechazo ]
    const {error} = await supabase.from('log_picking_ordenes').update({
      estado:'en_picking', picking_rechazos:rechazos,
    }).eq('id',sel.id)
    setBusy(false)
    if(error){ flash('⚠️ '+error.message); return }
    setOrdenes(prev=>prev.map(o=>o.id===sel.id?{...o,estado:'en_picking',picking_rechazos:rechazos}:o))
    setRechazoEdit(null)
    flash(`✗ Picking de #${sel.folio} rechazado — vuelve a preparación (${sel.pickeador_nombre||'pickeador'})`)
  }

  // ── RENDICIONES: recaudación de despachos por pagar ───────────────────────
  const cargarRendiciones = async ()=>{
    setRendLoad(true)
    try{
      let q1 = supabase.from('log_picking_ordenes')
        .select('id,folio,sucursal_codigo,chofer_id,chofer_nombre,despacho_valor,entregada_at,cliente_nombre,guia_numero')
        .eq('estado','entregada').eq('modalidad_entrega','despacho')
        .eq('despacho_pago','por_pagar').is('rendicion_id',null)
        .order('entregada_at',{ascending:true})
      if(sucSel!=='todas') q1 = q1.eq('sucursal_codigo', sucSel)
      let q2 = supabase.from('log_picking_rendiciones').select('*')
        .order('creada_at',{ascending:false}).limit(30)
      if(sucSel!=='todas') q2 = q2.eq('sucursal_codigo', sucSel)
      const [r1,r2] = await Promise.all([q1,q2])
      if(r1.error) throw r1.error
      if(r2.error) throw r2.error
      setRendPend(r1.data||[]); setRendHist(r2.data||[])
    }catch(e){ flash('⚠️ '+e.message) }
    setRendLoad(false)
  }
  useEffect(()=>{ if(tabVista==='rendiciones') cargarRendiciones() },[tabVista,sucSel])

  const registrarRendicion = async ()=>{
    const m = rendModal
    const elegidas = m.ordenes.filter(o=>m.sel.has(o.id))
    if(!elegidas.length){ flash('⚠️ Selecciona al menos un despacho'); return }
    const esperado = elegidas.reduce((s,o)=>s+Number(o.despacho_valor||0),0)
    const recibido = Number(m.montoRecibido)
    if(m.montoRecibido===''||isNaN(recibido)||recibido<0){ flash('⚠️ Indica el monto recibido'); return }
    setBusy(true)
    try{
      const {data:rend,error:e1} = await supabase.from('log_picking_rendiciones').insert({
        sucursal_codigo: elegidas[0].sucursal_codigo,
        chofer_id: elegidas[0].chofer_id||null, chofer_nombre: m.choferNombre,
        num_despachos: elegidas.length, monto_esperado: esperado, monto_recibido: recibido,
        recibido_por: cu?.nombre||'', obs: (m.obs||'').trim()||null,
      }).select('id').single()
      if(e1) throw e1
      const {error:e2} = await supabase.from('log_picking_ordenes')
        .update({rendicion_id: rend.id}).in('id', elegidas.map(o=>o.id))
      if(e2) throw e2
      setRendModal(null)
      flash(`💰 Rendición registrada: ${m.choferNombre} · ${fmtCLP(recibido)}${recibido!==esperado?` (esperado ${fmtCLP(esperado)})`:''}`)
      cargarRendiciones()
    }catch(e){ flash('⚠️ '+e.message) }
    setBusy(false)
  }

  // ── DESPACHO · salida a ruta: chofer + N° guia BSALE obligatorios ─────────
  const registrarSalida = async ()=>{
    const chofer = choferes.find(c=>c.id===choferSel)
    // Regla de negocio: no se registran despachos parciales
    const falt = items.filter(i=>Number(i.cantidad_confirmada)<Number(i.cantidad))
    if(falt.length){ flash(`🚫 No se despacha parcial — faltan ${falt.length} ítem(es) por completar`); return }
    if(!chofer){ flash('⚠️ Selecciona el chofer que despacha'); return }
    if(!guiaNum.trim()){ flash('⚠️ Registra el N° de la guía de despacho emitida en BSALE'); return }
    setBusy(true)
    const ahora = new Date().toISOString()
    const nom = `${chofer.nombre} ${chofer.apellido||''}`.trim()
    const {error,data} = await supabase.from('log_picking_ordenes').update({
      estado:'despachada', despachada_at:ahora,
      guia_numero:guiaNum.trim(), guia_registrada_at:ahora,
      chofer_id:chofer.id, chofer_nombre:nom, chofer_patente:chofer.patente||null,
    }).eq('id',sel.id).eq('estado','lista').select('id')
    setBusy(false)
    if(error){ flash('⚠️ '+error.message); return }
    if(!data?.length){ flash('⚠️ La orden ya no está en estado LISTA'); return }
    setOrdenes(prev=>prev.map(o=>o.id===sel.id?{...o,estado:'despachada',despachada_at:ahora,
      guia_numero:guiaNum.trim(),chofer_id:chofer.id,chofer_nombre:nom,chofer_patente:chofer.patente||null}:o))
    flash(`🚚 #${sel.folio} EN RUTA — guía ${guiaNum.trim()} · ${nom}`)
  }

  // ── DESPACHO · cierre: guía firmada (recepción conforme) obligatoria ──────
  const cerrarDespacho = async ()=>{
    if(!guiaFile){ flash('⚠️ Adjunta la guía de despacho firmada por el cliente'); return }
    if(!receptor.trim()){ flash('⚠️ Indica quién recibió, según la guía'); return }
    setGenPdf(true)
    try{
      const ahora = new Date().toISOString()
      // 1 · Subir la guía firmada (es el respaldo documental del despacho)
      const ext = (guiaFile.name.split('.').pop()||'jpg').toLowerCase()
      const path = `picking-firmados/${sel.sucursal_codigo}/${sel.folio}_guia_${sel.id.slice(0,8)}.${ext}`
      const {error:eUp} = await supabase.storage.from('log-documentos-wms')
        .upload(path, guiaFile, {upsert:true, contentType:guiaFile.type||undefined})
      if(eUp) throw eUp
      const url = supabase.storage.from('log-documentos-wms').getPublicUrl(path).data.publicUrl
      // 2 · Registrar entrega de items (lo entregado = lo validado)
      const entregas = items.map(i=>({...i, cantidad_entregada: Math.min(Number(i.cantidad_confirmada),Number(i.cantidad))}))
      await Promise.all(entregas.map(i=>supabase.from('log_picking_items').update({
        cantidad_entregada:i.cantidad_entregada, entregado_at:ahora, entregado_por:cu?.nombre||'',
      }).eq('id',i.id)))
      const completa = entregas.every(i=>Number(i.cantidad_entregada)>=Number(i.cantidad))
      // 3 · Cerrar la orden acreditada con la guía firmada
      const {error} = await supabase.from('log_picking_ordenes').update({
        estado:'entregada', entregada_at:ahora, entregado_por:cu?.nombre||'',
        receptor_nombre:receptor.trim(), receptor_rut:receptorRut.trim()||null,
        entrega_completa:completa,
        respaldo_firmado_url:url, respaldo_firmado_at:ahora, respaldo_firmado_por:cu?.nombre||'',
      }).eq('id',sel.id).eq('estado','despachada')
      if(error) throw error
      await etapaCerrar(sel)
      flash(`✅ #${sel.folio} entregada${completa?'':' (parcial)'} — acreditada con guía ${sel.guia_numero||''} firmada`)
      setReceptor(''); setReceptorRut(''); setGuiaFile(null); setSelId(null)
    }catch(e){ console.error('[picking cierre despacho]',e); flash('⚠️ '+e.message) }
    setGenPdf(false)
  }

  // ── Comprobante de entrega: DOS COPIAS con declaración y firmas ───────────
  const confirmarEntrega = async ()=>{
    if(!receptor.trim()){ flash('⚠️ Nombre del receptor es obligatorio'); return }
    setGenPdf(true)
    try{
      const ahora = new Date().toISOString()
      // Check unico: lo entregado ES lo validado (con sus motivos de parcialidad)
      const entregas = items.map(i=>({...i, cantidad_entregada: Math.min(Number(i.cantidad_confirmada),Number(i.cantidad))}))
      await Promise.all(entregas.map(i=>supabase.from('log_picking_items').update({
        cantidad_entregada:i.cantidad_entregada, entregado_at:ahora, entregado_por:cu?.nombre||'',
      }).eq('id',i.id)))
      const completa = entregas.every(i=>Number(i.cantidad_entregada)>=Number(i.cantidad))
      const {jsPDF, autoTable} = await cargarPdf()
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
        linea('Documento:', `${DOC_L(sel.bsale_doc_type)} N° ${sel.folio}`)
        linea('Sucursal:', nomSuc(sel.sucursal_codigo))
        linea('Cliente:', sel.cliente_nombre||'Sin cliente (boleta)')
        if(sel.vendedor_nombre) linea('Vendedor:', sel.vendedor_nombre)
        linea('Pickeador:', sel.pickeador_nombre||'—')
        linea('Fecha entrega:', fmtT(ahora))
        y+=1
        autoTable(doc,{ startY:y, styles:{fontSize:8,cellPadding:1.6}, headStyles:{fillColor:[26,26,46]},
          head:[['SKU','Producto','Vendido','Entregado','Observación']],
          body: entregas.map(i=>[ i.sku||'—', i.producto, String(i.cantidad),
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
        // Firmas: lineas para firma FISICA sobre el comprobante impreso
        const fy = Math.min(y, 238)
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

      // El documento SIEMPRE sale primero — la persistencia viene despues
      doc.save(`entrega_${sel.folio}.pdf`)

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
      flash(`✅ #${sel.folio} entregada${completa?'':' (parcial)'} — comprobante en 2 copias generado`)
      setReceptor(''); setReceptorRut(''); setSelId(null)
    }catch(e){ console.error('[picking entrega]',e); flash('⚠️ '+e.message) }
    setGenPdf(false)
  }

  const listaPickingPDF = async ()=>{
    const {jsPDF, autoTable} = await cargarPdf()
    const doc = new jsPDF()
    const W = 210
    // ── Encabezado corporativo ──────────────────────────────────────────────
    doc.setFillColor(26,26,46); doc.rect(0,0,W,34,'F')
    doc.setFillColor(232,102,10); doc.rect(0,34,W,1.6,'F')   // franja naranja de marca
    try{ doc.addImage(LOGO_B64,'PNG',14,8,38,19) }catch(e){}
    doc.setTextColor(255,255,255)
    doc.setFontSize(19); doc.setFont(undefined,'bold')
    doc.text('LISTA DE PICKING', 60, 17)
    doc.setFontSize(9.5); doc.setFont(undefined,'normal')
    doc.text('Outlet de Puertas SpA · Preparación de pedidos', 60, 24)
    doc.setFontSize(8); doc.setTextColor(210,210,225)
    doc.text('SOP P07 · Módulo Abastecimiento', 60, 29.5)
    // Folio destacado a la derecha
    doc.setFontSize(9); doc.setFont(undefined,'normal'); doc.setTextColor(200,200,215)
    doc.text(DOC_L(sel.bsale_doc_type).toUpperCase(), W-14, 13, {align:'right'})
    doc.setFontSize(24); doc.setFont(undefined,'bold'); doc.setTextColor(255,255,255)
    doc.text(`#${sel.folio}`, W-14, 24, {align:'right'})

    // ── Datos descriptivos (dos columnas, etiquetas grandes) ────────────────
    let y = 46
    doc.setTextColor(25,25,35)
    const campo = (label, valor, x, ancho)=>{
      doc.setFontSize(7.5); doc.setFont(undefined,'bold'); doc.setTextColor(130,130,145)
      doc.text(label.toUpperCase(), x, y)
      doc.setFontSize(12); doc.setFont(undefined,'bold'); doc.setTextColor(25,25,35)
      doc.text(doc.splitTextToSize(String(valor??'—'), ancho)[0], x, y+6.2)
    }
    const modTxt = sel.modalidad_entrega==='despacho'?'DESPACHO A DOMICILIO':'RETIRO EN TIENDA'
    campo('Cliente', sel.cliente_nombre||'Sin cliente (boleta)', 14, 96)
    campo('Modalidad de entrega', modTxt, 116, 80)
    y += 13
    campo('Sucursal', nomSuc(sel.sucursal_codigo), 14, 96)
    campo('Vendedor', sel.vendedor_nombre||'—', 116, 80)
    y += 13
    campo('Pickeador asignado', sel.pickeador_nombre||'— sin asignar —', 14, 96)
    campo('Impresa', new Date().toLocaleString('es-CL',{dateStyle:'short',timeStyle:'short'}), 116, 80)
    y += 11
    if(sel.modalidad_entrega==='despacho'&&(sel.despacho_direccion||sel.despacho_comuna)){
      doc.setFillColor(88,86,214); doc.rect(14,y,182,0.6,'F'); y+=5
      campo('Dirección de despacho', `${sel.despacho_direccion||'—'}${sel.despacho_comuna?', '+sel.despacho_comuna:''}`, 14, 96)
      campo('Fecha programada', sel.fecha_programada||'—', 116, 80)
      y += 12
    }
    doc.setDrawColor(225,225,235); doc.line(14,y,196,y); y += 7

    // ── Tabla de productos ──────────────────────────────────────────────────
    // La casilla de check se DIBUJA (el caracter ☐ no existe en las fuentes
    // base de jsPDF y se imprimia como "&").
    autoTable(doc,{ startY:y, styles:{fontSize:10,cellPadding:2.6}, headStyles:{fillColor:[26,26,46],fontSize:8.5},
      head:[['SKU','PRODUCTO','CANT','CHECK','FALTA']],
      body: items.map(i=>[ i.sku||'—', i.producto, String(i.cantidad), '', '' ]),
      columnStyles:{0:{cellWidth:33,fontSize:8.5},2:{cellWidth:16,halign:'right',fontStyle:'bold',fontSize:11},
        3:{cellWidth:20,halign:'center'},4:{cellWidth:21,halign:'center',fillColor:[255,250,242]}},
      alternateRowStyles:{fillColor:[248,249,252]},
      didDrawCell: (d)=>{
        if(d.section!=='body') return
        if(d.column.index===3){                       // casilla de check
          const s = 6.4
          doc.setDrawColor(90,90,110); doc.setLineWidth(0.45); doc.setFillColor(255,255,255)
          doc.roundedRect(d.cell.x + d.cell.width/2 - s/2, d.cell.y + d.cell.height/2 - s/2, s, s, 0.8, 0.8, 'FD')
          doc.setLineWidth(0.2)
        }
        if(d.column.index===4){                       // línea para anotar el faltante
          doc.setDrawColor(200,150,90); doc.setLineWidth(0.35)
          const yl = d.cell.y + d.cell.height - 2.6
          doc.line(d.cell.x + 3, yl, d.cell.x + d.cell.width - 3, yl)
          doc.setLineWidth(0.2)
        }
      },
    })
    y = doc.lastAutoTable.finalY + 6
    const totU = items.reduce((s,i)=>s+Number(i.cantidad||0),0)
    doc.setFontSize(10); doc.setFont(undefined,'bold'); doc.setTextColor(60,60,75)
    doc.text(`${items.length} líneas · ${totU} unidades a preparar`, 196, y, {align:'right'})
    y += 9

    // ── Observaciones / faltantes (para escribir a mano) ────────────────────
    if(y > 205){ doc.addPage(); y = 24 }
    doc.setFillColor(255,250,242); doc.setDrawColor(230,200,160)
    doc.roundedRect(14, y-4, 182, 24, 2, 2, 'FD')
    doc.setFontSize(8.5); doc.setFont(undefined,'bold'); doc.setTextColor(150,95,20)
    doc.text('OBSERVACIONES · PRODUCTOS FALTANTES O CON PROBLEMA', 18, y+1.5)
    doc.setFontSize(7); doc.setFont(undefined,'normal'); doc.setTextColor(170,130,80)
    doc.text('Anota aquí el SKU y el motivo. Un despacho no sale si el pedido está incompleto.', 18, y+5.5)
    doc.setDrawColor(215,195,170); doc.setLineWidth(0.3)
    for(let k=0;k<2;k++) doc.line(18, y+11+(k*6), 192, y+11+(k*6))
    doc.setLineWidth(0.2)
    y += 28

    // ── Firma del pickeador que entrega ─────────────────────────────────────
    if(y > 246){ doc.addPage(); y = 24 }
    doc.setFillColor(247,249,252); doc.roundedRect(14,y-4,182,36,2,2,'F')
    doc.setFontSize(8.5); doc.setFont(undefined,'bold'); doc.setTextColor(70,70,90)
    doc.text('CONFORMIDAD DE PREPARACIÓN Y ENTREGA', 105, y+2, {align:'center'})
    doc.setFontSize(7.5); doc.setFont(undefined,'normal'); doc.setTextColor(110,110,130)
    doc.text('El pickeador declara haber preparado y entregado los productos detallados según esta lista.', 105, y+7, {align:'center'})
    const fy = y + 23
    doc.setDrawColor(120,120,140)
    doc.line(60, fy, 150, fy)
    doc.setFontSize(8); doc.setFont(undefined,'bold'); doc.setTextColor(40,40,55)
    doc.text('FIRMA PICKEADOR QUE ENTREGA', 105, fy+4.5, {align:'center'})
    doc.setFontSize(8); doc.setFont(undefined,'normal'); doc.setTextColor(90,90,110)
    doc.text(sel.pickeador_nombre||'Nombre: ______________________', 105, fy+9, {align:'center'})

    doc.setFontSize(7); doc.setTextColor(150,150,165)
    doc.text(`Documento interno de preparación · #${sel.folio} · ${nomSuc(sel.sucursal_codigo)}`, 105, 288, {align:'center'})
    doc.save(`picking_${sel.folio}.pdf`)
  }

  const toggleUrgente = async (o)=>{
    await supabase.from('log_picking_ordenes').update({urgente:!o.urgente}).eq('id',o.id)
  }

  // ── Reporte de respaldos: query propia por rango (no limitada a 72h) ──────
  const cargarRespaldos = async ()=>{
    setRespLoading(true)
    try{
      const hoy0 = new Date(); hoy0.setHours(0,0,0,0)
      let d1, d2 = new Date()
      if(respRango==='hoy') d1 = hoy0
      else if(respRango==='7d') d1 = new Date(hoy0.getTime()-6*86400000)
      else if(respRango==='30d') d1 = new Date(hoy0.getTime()-29*86400000)
      else { d1 = respD1?new Date(respD1+'T00:00:00'):hoy0; d2 = respD2?new Date(respD2+'T23:59:59'):new Date() }
      let q = supabase.from('log_picking_ordenes')
        .select('id,folio,bsale_doc_type,modalidad_entrega,sucursal_codigo,cliente_nombre,receptor_nombre,'+
          'entregada_at,entregado_por,guia_numero,chofer_nombre,pdf_url,respaldo_firmado_url,respaldo_firmado_at,respaldo_firmado_por')
        .eq('estado','entregada')
        .gte('entregada_at', d1.toISOString()).lte('entregada_at', d2.toISOString())
        .limit(5000)
      if(sucSel!=='todas') q = q.eq('sucursal_codigo', sucSel)
      const {data,error} = await q
      if(error) throw error
      setRespData(data||[])
    }catch(e){ flash('⚠️ '+e.message) }
    setRespLoading(false)
  }
  useEffect(()=>{ if(tabVista==='respaldos') cargarRespaldos() },[tabVista,respRango,sucSel])

  const exportarRespaldos = async (filas)=>{
    const XLSX = await import('xlsx')
    const out = filas.map(o=>({
      Folio:o.folio, Tipo:DOC_L(o.bsale_doc_type), Modalidad:o.modalidad_entrega,
      Tienda:nomSuc(o.sucursal_codigo), Cliente:o.cliente_nombre||'', Receptor:o.receptor_nombre||'',
      Entregada:o.entregada_at?new Date(o.entregada_at).toLocaleString('es-CL'):'',
      Entrego:o.entregado_por||'', Guia:o.guia_numero||'', Chofer:o.chofer_nombre||'',
      Respaldo:o.respaldo_firmado_url?'CARGADO':'PENDIENTE',
      RespaldoFecha:o.respaldo_firmado_at?new Date(o.respaldo_firmado_at).toLocaleString('es-CL'):'',
      RespaldoPor:o.respaldo_firmado_por||'',
    }))
    const ws = XLSX.utils.json_to_sheet(out)
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Respaldos')
    XLSX.writeFile(wb, `respaldos_picking_${new Date().toISOString().slice(0,10)}.xlsx`)
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
    if(tabVista==='respaldos') cargarRespaldos()
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
      const {data,error} = await supabase.from('log_picking_ordenes').select('*').eq('archivada', false)
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
      Chofer:o.chofer_nombre||'', ChoferPatente:o.chofer_patente||'', GuiaDespacho:o.guia_numero||'',
      DocFinal:o.doc_final_tipo?`${o.doc_final_tipo} ${o.doc_final_folio||''}`.trim():'',
      FleteEstado:o.despacho_pago==='por_pagar'?'POR PAGAR':(o.despacho_pago==='pagado'?'PAGADO':''),
      FleteValor:o.despacho_valor??'',
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
    const esDesp = sel.modalidad_entrega==='despacho'
    const enPicking = sel.estado==='asignada'||sel.estado==='en_picking'
    const enEntrega = sel.estado==='lista' && !esDesp        // retiro: entrega directa al cliente
    const enSalida  = sel.estado==='lista' && esDesp         // despacho: registrar salida a ruta
    const enRuta    = sel.estado==='despachada'              // despacho: esperando guia firmada
    const activa = !['entregada','anulada'].includes(sel.estado)
    const terminada = !activa
    const validados = items.filter(i=>Number(i.cantidad_confirmada)>0||i.motivo_no_entrega).length
    const todoValidado = items.length>0 && validados===items.length
    const faltantes = items.filter(i=>Number(i.cantidad_confirmada)<Number(i.cantidad))
    // Regla de negocio: NO se despacha parcial. Si falta cantidad, no sale.
    const salidaOK = !!choferSel && !!guiaNum.trim() && faltantes.length===0
    const cierreOK = !!guiaFile && !!receptor.trim()
    const chipM = modChip(sel, activa)

    return (
      <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
        <div style={{padding:'11px 14px',borderBottom:'1px solid #E5E5EA',background:'#FAFAFC'}}>
          <div style={{display:'flex',alignItems:'center',gap:9,flexWrap:'wrap'}}>
            {sel.bsale_url_pdf
              ? <a href={sel.bsale_url_pdf} target="_blank" rel="noreferrer" title="Abrir documento en BSALE"
                  style={{fontSize:16,fontWeight:900,fontFamily:'monospace',color:'#007AFF',textDecoration:'underline',textUnderlineOffset:2}}>#{sel.folio} ↗</a>
              : <span style={{fontSize:16,fontWeight:900,fontFamily:'monospace'}}>#{sel.folio}</span>}
            <span style={{fontSize:10,fontWeight:800,color:e.c,background:e.c+'15',padding:'3px 10px',borderRadius:12}}>{e.l}</span>
            <span style={{fontSize:10,fontWeight:800,color:sel.bsale_doc_type==='cotizacion'?'#AF52DE':'#8E8E93'}}>{DOC_L(sel.bsale_doc_type).toUpperCase()}</span>
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
            {(enPicking||enEntrega||enSalida)&&<span onClick={listaPickingPDF} style={{color:'#007AFF',fontWeight:700,cursor:'pointer'}}>🖨 Lista picking</span>}
            {activa&&sel.tipo_entrega==='inmediata'&&sel.estado==='pendiente'&&
              <span onClick={()=>setProgEdit({ordenId:sel.id,fecha:sel.fecha_programada||hoyISO(),modalidad:sel.modalidad_entrega})}
                style={{color:'#5856D6',fontWeight:700,cursor:'pointer'}}>📅 Programar</span>}
            {activa&&sel.tipo_entrega==='programada'&&
              <span onClick={()=>volverInmediata(sel)} style={{color:'#FF9500',fontWeight:700,cursor:'pointer'}}>⚡ Pasar a inmediata</span>}
          </div>
          {Array.isArray(sel.picking_rechazos)&&sel.picking_rechazos.length>0&&(
            <div style={{marginTop:8,padding:'7px 10px',borderRadius:9,background:'#FFF5F5',border:'1px solid #FFD5D0',fontSize:11}}>
              <b style={{color:'#C93400'}}>✗ Picking rechazado {sel.picking_rechazos.length>1?`${sel.picking_rechazos.length} veces`:''}</b>
              <span style={{color:'#8E4A42'}}> — último: "{sel.picking_rechazos[sel.picking_rechazos.length-1].motivo}" ({sel.picking_rechazos[sel.picking_rechazos.length-1].por})</span>
            </div>
          )}
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
              {l:'VALIDADO', n:validados, c:'#5856D6'},
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
              <th style={{...th,width:48,textAlign:'center'}} title="Validado en picking">✔</th>
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
                      <button style={checkBtn(val>0,valOK?'#5856D6':'#FF9500')} disabled={terminada||(!enPicking&&!enEntrega&&!enSalida)}
                        title={val>0?`Validado ${val}/${cant}`:'Validar completo'}
                        onClick={()=>validarItem(it, valOK?0:cant, valOK?null:it.motivo_no_entrega)}>
                        {val>0?(valOK?'✓':val):''}
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
                      {(enPicking||enEntrega||enSalida)&&!flete&&!conMotivo&&
                        <button style={btMini('#FF950018','#C93400')} title="Falta / dañado / rechazo"
                          onClick={()=>setMotivoEdit({itemId:it.id,cantidad:val||0,motivo:''})}>⚠</button>}
                      {conMotivo&&(enPicking||enEntrega||enSalida)&&
                        <button style={btMini('#F2F2F7','#6D6D72')} onClick={()=>validarItem(it,0,null)}>↩</button>}
                    </td>
                  </tr>
                  {motivoEdit?.itemId===it.id&&(
                    <tr><td colSpan={5} style={{...td,background:'#FFF8EE',whiteSpace:'normal'}}>
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
              <button style={{...btMini('#007AFF15','#007AFF'),padding:'9px 14px'}} onClick={listaPickingPDF} title="Imprime la lista de productos para pickear">
                🖨 Imprimir lista
              </button>
              <button style={{...btMini(todoValidado?'#34C759':'#E5E5EA', todoValidado?'#fff':'#8E8E93'),flex:1,padding:'9px 0'}}
                disabled={!todoValidado} onClick={marcarLista}>
                {todoValidado?'📦 Marcar LISTA para entrega':'Valida o justifica todo primero'}
              </button>
            </div>
          )}
          {/* RETIRO EN TIENDA: entrega directa al cliente (flujo original) */}
          {enEntrega&&(
            <div>
              {faltantes.length>0&&(
                <div style={{fontSize:10.5,color:'#C93400',fontWeight:700,marginBottom:6}}>
                  ◐ Entrega PARCIAL — sin entregar: {faltantes.map(f=>`${f.producto} (${Number(f.cantidad)-Number(f.cantidad_confirmada)})`).join(' · ')}
                </div>
              )}
              <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginBottom:8}}>
                <input value={receptor} onChange={e=>setReceptor(e.target.value)}
                  placeholder="Nombre de quien recibe *" style={{...css.input,flex:1,minWidth:170,padding:'8px 10px'}}/>
                <input value={receptorRut} onChange={e=>setReceptorRut(e.target.value)}
                  placeholder="RUT (opc.)" style={{...css.input,width:120,padding:'8px 10px'}}/>
              </div>
              <button style={{...btMini(receptor.trim()?'#1a1a2e':'#E5E5EA', receptor.trim()?'#fff':'#8E8E93'),
                width:'100%',padding:'11px 0',fontSize:13}}
                disabled={!receptor.trim()||genPdf} onClick={confirmarEntrega}>
                {genPdf?'Generando comprobante…':!receptor.trim()?'Indica quién recibe':`✅ CONFIRMACIÓN FINAL — comprobante 2 copias #${sel.folio}`}
              </button>
              {rechazoEdit===null
                ? <button style={{...btMini('#FF3B3012','#C93400'),width:'100%',padding:'8px 0',marginTop:8}}
                    onClick={()=>setRechazoEdit('')}>✗ Rechazar picking — hay un error en lo preparado</button>
                : <div style={{marginTop:8,padding:10,borderRadius:10,background:'#FFF5F5',border:'1px solid #FFD5D0'}}>
                    <div style={{fontSize:11,fontWeight:800,color:'#C93400',marginBottom:6}}>✗ Rechazar picking — ¿cuál fue el error?</div>
                    <input value={rechazoEdit} onChange={e=>setRechazoEdit(e.target.value)} autoFocus
                      placeholder="Ej: faltó 1 bisagra / producto equivocado / cantidad mal contada"
                      style={{...css.input,width:'100%',padding:'8px 10px',marginBottom:8}}/>
                    <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                      <Bt v="gry" sm onClick={()=>setRechazoEdit(null)}>Cancelar</Bt>
                      <Bt v="dan" sm dis={!rechazoEdit.trim()||busy} onClick={rechazarPicking}>Confirmar rechazo</Bt>
                    </div>
                  </div>}
            </div>
          )}

          {/* DESPACHO · PASO SALIDA: chofer + N° guía BSALE obligatorios */}
          {enSalida&&(
            <div>
              {faltantes.length>0&&(
                <div style={{padding:'9px 11px',borderRadius:9,background:'#FF3B3010',border:'1px solid #FF3B3035',marginBottom:8}}>
                  <div style={{fontSize:11,fontWeight:900,color:'#C93400',marginBottom:3}}>
                    🚫 NO SE PUEDE DESPACHAR — pedido incompleto
                  </div>
                  <div style={{fontSize:10.5,color:'#8E4A42',fontWeight:600,lineHeight:1.35}}>
                    No se registran despachos parciales. Completa el picking o resuelve el faltante antes de la salida:
                    {' '}{faltantes.map(f=>`${f.producto} (${Number(f.cantidad_confirmada)}/${Number(f.cantidad)})`).join(' · ')}
                  </div>
                </div>
              )}
              <div style={{marginBottom:8,padding:'8px 10px',borderRadius:9,background:'#AF52DE08',border:'1px solid #AF52DE30'}}>
                <div style={{fontSize:10,fontWeight:800,color:'#AF52DE',marginBottom:5,letterSpacing:'0.03em'}}>
                  🚚 SALIDA A DESPACHO — emite la guía en BSALE y registra su folio
                  {sel.despacho_pago==='por_pagar'&&
                    <span style={{marginLeft:8,color:'#C93400'}}>· ⏳ POR COBRAR {sel.despacho_valor?fmtCLP(sel.despacho_valor):''} — recauda el chofer</span>}
                </div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  <select value={choferSel} onChange={e=>setChoferSel(e.target.value)}
                    style={{...css.select,flex:1,minWidth:200,padding:'8px 10px'}}>
                    <option value="">— chofer que despacha * —</option>
                    {choferes.map(c=>(
                      <option key={c.id} value={c.id}>
                        {c.nombre} {c.apellido||''}{c.patente?` · ${c.patente}`:''}{c.empresa_transporte?` (${c.empresa_transporte})`:''}
                      </option>
                    ))}
                  </select>
                  <input value={guiaNum} onChange={e=>setGuiaNum(e.target.value)}
                    placeholder="N° guía de despacho *" style={{...css.input,width:180,padding:'8px 10px',fontFamily:'monospace',fontWeight:700}}/>
                </div>
                {!choferes.length&&<div style={{fontSize:10.5,color:'#C93400',fontWeight:700,marginTop:4}}>
                  Sin choferes activos — cárgalos en el módulo de Choferes</div>}
              </div>
              <button style={{...btMini(salidaOK?'#AF52DE':'#E5E5EA', salidaOK?'#fff':'#8E8E93'),
                width:'100%',padding:'11px 0',fontSize:13}}
                disabled={!salidaOK||busy} onClick={registrarSalida}>
                {faltantes.length>0?'🚫 Pedido incompleto — no se despacha parcial'
                  :!choferSel?'Selecciona el chofer'
                  :!guiaNum.trim()?'Registra el N° de guía de despacho'
                  :`🚚 REGISTRAR SALIDA A RUTA — guía ${guiaNum.trim()}`}
              </button>
              {rechazoEdit===null
                ? <button style={{...btMini('#FF3B3012','#C93400'),width:'100%',padding:'8px 0',marginTop:8}}
                    onClick={()=>setRechazoEdit('')}>✗ Rechazar picking — hay un error en lo preparado</button>
                : <div style={{marginTop:8,padding:10,borderRadius:10,background:'#FFF5F5',border:'1px solid #FFD5D0'}}>
                    <div style={{fontSize:11,fontWeight:800,color:'#C93400',marginBottom:6}}>✗ Rechazar picking — ¿cuál fue el error?</div>
                    <input value={rechazoEdit} onChange={e=>setRechazoEdit(e.target.value)} autoFocus
                      placeholder="Ej: faltó 1 bisagra / producto equivocado / cantidad mal contada"
                      style={{...css.input,width:'100%',padding:'8px 10px',marginBottom:8}}/>
                    <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                      <Bt v="gry" sm onClick={()=>setRechazoEdit(null)}>Cancelar</Bt>
                      <Bt v="dan" sm dis={!rechazoEdit.trim()||busy} onClick={rechazarPicking}>Confirmar rechazo</Bt>
                    </div>
                  </div>}
            </div>
          )}

          {/* DESPACHO · EN RUTA: cerrar con la guía firmada (recepción conforme) */}
          {enRuta&&(
            <div>
              <div style={{marginBottom:8,padding:'8px 10px',borderRadius:9,background:'#AF52DE08',border:'1px solid #AF52DE30',fontSize:11.5}}>
                <b style={{color:'#AF52DE'}}>🚚 EN RUTA</b> — guía <b style={{fontFamily:'monospace'}}>{sel.guia_numero||'—'}</b>
                {sel.chofer_nombre&&<> · {sel.chofer_nombre}{sel.chofer_patente?` (${sel.chofer_patente})`:''}</>}
                {sel.despachada_at&&<> · salió {new Date(sel.despachada_at).toLocaleString('es-CL',{dateStyle:'short',timeStyle:'short'})}</>}
                {sel.despacho_pago==='por_pagar'&&
                  <div style={{color:'#C93400',fontWeight:800,marginTop:3}}>⏳ Recauda {fmtCLP(sel.despacho_valor)} — debe rendirlos al jefe de tienda</div>}
                {sel.bsale_doc_type==='cotizacion'&&(sel.doc_final_folio
                  ?<div style={{color:'#248A3D',fontWeight:800,marginTop:3}}>🧾 Cobrada: {DOC_L(sel.doc_final_tipo)} N° {sel.doc_final_folio} emitida</div>
                  :<div style={{color:'#AF52DE',fontWeight:700,marginTop:3}}>🧾 Cotización — al cobrar, caja emite {sel.despacho_doc_emitir?DOC_L(sel.despacho_doc_emitir).toLowerCase():'boleta o factura'}</div>)}
              </div>
              <div style={{marginBottom:8,padding:'8px 10px',borderRadius:9,background:'#34C75908',border:'1px solid #34C75930'}}>
                <div style={{fontSize:10,fontWeight:800,color:'#248A3D',marginBottom:5,letterSpacing:'0.03em'}}>
                  ✅ CIERRE DE DESPACHO — sube la guía firmada con recepción conforme del cliente *
                </div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                  <input type="file" accept="image/*,application/pdf"
                    onChange={e=>setGuiaFile(e.target.files?.[0]||null)}
                    style={{fontSize:11.5,flex:1,minWidth:180}}/>
                  <input value={receptor} onChange={e=>setReceptor(e.target.value)}
                    placeholder="Recibió (según guía) *" style={{...css.input,width:180,padding:'8px 10px'}}/>
                </div>
                {guiaFile&&<div style={{fontSize:10.5,color:'#248A3D',fontWeight:700,marginTop:4}}>📎 {guiaFile.name}</div>}
              </div>
              <button style={{...btMini(cierreOK?'#1a1a2e':'#E5E5EA', cierreOK?'#fff':'#8E8E93'),
                width:'100%',padding:'11px 0',fontSize:13}}
                disabled={!cierreOK||genPdf} onClick={cerrarDespacho}>
                {genPdf?'Cerrando…'
                  :!guiaFile?'Adjunta la guía firmada para acreditar la entrega'
                  :!receptor.trim()?'Indica quién recibió (según la guía)'
                  :`✅ ENTREGA ACREDITADA — cerrar despacho #${sel.folio}`}
              </button>
            </div>
          )}

          {terminada&&(
            <div style={{fontSize:12,color:'#8E8E93',display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
              {sel.estado==='entregada'&&<>
                <span>✅ Entregada a <b>{sel.receptor_nombre}</b> por {sel.entregado_por}</span>
                {sel.chofer_nombre&&<span>🚛 {sel.chofer_nombre}{sel.chofer_patente?` · ${sel.chofer_patente}`:''}</span>}
                {sel.guia_numero&&<span style={{fontFamily:'monospace',fontWeight:700}}>📋 Guía {sel.guia_numero}</span>}
                {sel.modalidad_entrega==='despacho'&&sel.despacho_pago==='por_pagar'&&
                  <span style={{color:'#C93400',fontWeight:800}}>💰 Recaudó {fmtCLP(sel.despacho_valor)}</span>}
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
          {o.estado==='despachada'
            ?<span style={{fontSize:9.5,color:'#AF52DE',fontWeight:800,display:'block'}}>🚚 guía {o.guia_numero||'—'}{o.chofer_nombre?` · ${o.chofer_nombre}`:''}</span>
            :esProg&&o.modalidad_entrega==='despacho'&&(o.despacho_registrado_at
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
          {[['cola','Cola'],['respaldos','Respaldos'],['reporte','Reporte'],['rendiciones','💰 Rendiciones'],['pantalla','📺 Pantalla']].map(([k,l])=>(
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

      {tabVista==='rendiciones'&&(()=>{
        if(rendLoad) return <div style={css.empty}>⏳ Cargando rendiciones…</div>
        // agrupar pendientes por chofer
        const porChofer = {}
        rendPend.forEach(o=>{
          const k = o.chofer_nombre||'(sin chofer)'
          ;(porChofer[k] = porChofer[k]||[]).push(o)
        })
        const grupos = Object.entries(porChofer).sort((a,b)=>b[1].length-a[1].length)
        const totalPend = rendPend.reduce((s,o)=>s+Number(o.despacho_valor||0),0)
        return (<>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10,flexWrap:'wrap'}}>
            <span style={{fontSize:13,fontWeight:800}}>💰 Recaudación pendiente de rendir</span>
            <span style={{fontSize:11,fontWeight:800,color:totalPend?'#C93400':'#248A3D',
              background:totalPend?'#FF3B3010':'#34C75912',padding:'3px 10px',borderRadius:12}}>
              {totalPend?`${rendPend.length} despachos · ${fmtCLP(totalPend)}`:'Todo rendido ✓'}
            </span>
          </div>

          {grupos.length>0&&(
            <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:18}}>
              {grupos.map(([nom,ords])=>{
                const monto = ords.reduce((s,o)=>s+Number(o.despacho_valor||0),0)
                return (
                <div key={nom} style={{border:'1px solid #E5E5EA',borderRadius:10,overflow:'hidden'}}>
                  <div style={{padding:'8px 12px',background:'#FAFAFC',display:'flex',alignItems:'center',
                    justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
                    <span style={{fontSize:12.5,fontWeight:800}}>🚛 {nom}
                      <span style={{marginLeft:8,fontSize:11,color:'#8E8E93',fontWeight:700}}>{ords.length} despacho{ords.length>1?'s':''}</span>
                    </span>
                    <span style={{display:'inline-flex',alignItems:'center',gap:10}}>
                      <span style={{fontSize:13,fontWeight:900,color:'#C93400'}}>{fmtCLP(monto)}</span>
                      <button style={{...btMini('#1a1a2e','#fff'),padding:'6px 14px'}}
                        onClick={()=>setRendModal({choferNombre:nom,ordenes:ords,sel:new Set(ords.map(o=>o.id)),montoRecibido:String(monto),obs:''})}>
                        Registrar rendición
                      </button>
                    </span>
                  </div>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <tbody>{ords.map(o=>(
                      <tr key={o.id}>
                        <td style={{...td,fontFamily:'monospace',fontWeight:800,width:90}}>#{o.folio}</td>
                        <td style={{...td,fontSize:11.5}}>{o.cliente_nombre||'—'}</td>
                        <td style={{...td,fontSize:11,color:'#8E8E93'}}>guía {o.guia_numero||'—'}</td>
                        <td style={{...td,fontSize:11,color:'#8E8E93'}}>{o.entregada_at?new Date(o.entregada_at).toLocaleString('es-CL',{dateStyle:'short',timeStyle:'short'}):''}</td>
                        <td style={{...td,textAlign:'right',fontWeight:800}}>{fmtCLP(o.despacho_valor)}</td>
                      </tr>))}</tbody>
                  </table>
                </div>)
              })}
            </div>
          )}

          <div style={{fontSize:11,fontWeight:800,color:'#6D6D72',letterSpacing:'0.03em',margin:'0 2px 6px'}}>HISTORIAL DE RENDICIONES</div>
          <div style={{overflowX:'auto',border:'1px solid #E5E5EA',borderRadius:10}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr>
                <th style={th}>FECHA</th><th style={th}>CHOFER</th>
                <th style={{...th,textAlign:'right'}}>DESPACHOS</th>
                <th style={{...th,textAlign:'right'}}>ESPERADO</th>
                <th style={{...th,textAlign:'right'}}>RECIBIDO</th>
                <th style={{...th,textAlign:'right'}}>DIFERENCIA</th>
                <th style={th}>RECIBIÓ</th><th style={th}>OBS</th>
              </tr></thead>
              <tbody>
                {rendHist.length===0
                  ? <tr><td colSpan={8} style={{...td,textAlign:'center',padding:20,color:'#8E8E93'}}>Sin rendiciones registradas.</td></tr>
                  : rendHist.map(r=>{
                    const dif = Number(r.monto_recibido||0)-Number(r.monto_esperado||0)
                    return (
                    <tr key={r.id}>
                      <td style={{...td,fontSize:11}}>{new Date(r.creada_at).toLocaleString('es-CL',{dateStyle:'short',timeStyle:'short'})}</td>
                      <td style={{...td,fontWeight:700}}>{r.chofer_nombre}</td>
                      <td style={{...td,textAlign:'right'}}>{r.num_despachos}</td>
                      <td style={{...td,textAlign:'right'}}>{fmtCLP(r.monto_esperado)}</td>
                      <td style={{...td,textAlign:'right',fontWeight:800}}>{fmtCLP(r.monto_recibido)}</td>
                      <td style={{...td,textAlign:'right',fontWeight:800,color:dif===0?'#248A3D':'#C93400'}}>
                        {dif===0?'✓':(dif>0?'+':'')+fmtCLP(dif).replace('$','$')}</td>
                      <td style={{...td,fontSize:11.5}}>{r.recibido_por||'—'}</td>
                      <td style={{...td,fontSize:11,color:'#8E8E93',whiteSpace:'normal',maxWidth:180}}>{r.obs||''}</td>
                    </tr>)})}
              </tbody>
            </table>
          </div>

          {rendModal&&(
            <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:9000,display:'flex',
              alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setRendModal(null)}>
              <div style={{background:'#fff',borderRadius:16,padding:20,width:'100%',maxWidth:480,maxHeight:'86vh',overflowY:'auto'}}
                onClick={e=>e.stopPropagation()}>
                <div style={{fontSize:14,fontWeight:800,marginBottom:2}}>💰 Rendición — {rendModal.choferNombre}</div>
                <div style={{fontSize:11.5,color:'#8E8E93',marginBottom:12}}>Marca los despachos cuya recaudación estás recibiendo.</div>
                {rendModal.ordenes.map(o=>{
                  const on = rendModal.sel.has(o.id)
                  return (
                  <label key={o.id} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 10px',borderRadius:9,
                    background:on?'#34C75910':'#FAFAFC',border:`1px solid ${on?'#34C75940':'#E5E5EA'}`,marginBottom:6,cursor:'pointer'}}>
                    <input type="checkbox" checked={on} onChange={()=>{
                      setRendModal(m=>{
                        const sel = new Set(m.sel); on?sel.delete(o.id):sel.add(o.id)
                        const monto = m.ordenes.filter(x=>sel.has(x.id)).reduce((s,x)=>s+Number(x.despacho_valor||0),0)
                        return {...m, sel, montoRecibido:String(monto)}
                      })
                    }}/>
                    <span style={{fontFamily:'monospace',fontWeight:800,fontSize:12}}>#{o.folio}</span>
                    <span style={{flex:1,fontSize:11.5,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o.cliente_nombre||'—'}</span>
                    <span style={{fontWeight:800,fontSize:12}}>{fmtCLP(o.despacho_valor)}</span>
                  </label>)
                })}
                <div style={{display:'flex',gap:10,margin:'12px 0 10px',alignItems:'flex-end',flexWrap:'wrap'}}>
                  <div style={{flex:1,minWidth:150}}>
                    <div style={{fontSize:10.5,fontWeight:800,color:'#6D6D72',marginBottom:4}}>MONTO RECIBIDO ($) *</div>
                    <input type="number" min="0" value={rendModal.montoRecibido}
                      onChange={e=>setRendModal(m=>({...m,montoRecibido:e.target.value}))}
                      style={{...css.input,width:'100%',padding:'9px 10px',fontWeight:800,fontSize:14}}/>
                  </div>
                  <div style={{flex:1.4,minWidth:170}}>
                    <div style={{fontSize:10.5,fontWeight:800,color:'#6D6D72',marginBottom:4}}>OBSERVACIONES</div>
                    <input value={rendModal.obs} onChange={e=>setRendModal(m=>({...m,obs:e.target.value}))}
                      placeholder="Ej: faltan $5.000, cliente pagó con transferencia…"
                      style={{...css.input,width:'100%',padding:'9px 10px'}}/>
                  </div>
                </div>
                {(()=>{
                  const esperado = rendModal.ordenes.filter(o=>rendModal.sel.has(o.id)).reduce((s,o)=>s+Number(o.despacho_valor||0),0)
                  const dif = Number(rendModal.montoRecibido||0)-esperado
                  return dif!==0&&rendModal.montoRecibido!==''
                    ? <div style={{fontSize:11,fontWeight:800,color:'#C93400',marginBottom:10}}>
                        ⚠ Diferencia de {fmtCLP(Math.abs(dif))} {dif<0?'MENOS':'MÁS'} que lo esperado ({fmtCLP(esperado)}) — deja la razón en observaciones.
                      </div> : null
                })()}
                <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                  <Bt v="gry" sm onClick={()=>setRendModal(null)}>Cancelar</Bt>
                  <Bt v="pri" sm dis={busy} onClick={registrarRendicion}>
                    {busy?'Registrando…':`Confirmar recepción del dinero (${cu?.nombre||'yo'})`}</Bt>
                </div>
              </div>
            </div>
          )}
        </>)
      })()}

      {tabVista==='pantalla'&&(()=>{
        // Pantalla publica corporativa para el cliente en sala. Solo RETIRO
        // (un despacho a domicilio no tiene cliente esperando en tienda).
        // Privacidad: folio + primer nombre. Nunca RUT ni nombre completo.
        const deRetiro = ordenes.filter(o=>o.modalidad_entrega!=='despacho')
        const primerNombre = (n)=>{
          const t=(n||'').trim(); if(!t) return ''
          const p=t.split(/\s+/)[0]
          return p.charAt(0).toUpperCase()+p.slice(1).toLowerCase()
        }
        const preparando = deRetiro.filter(o=>['pendiente','asignada','en_picking'].includes(o.estado))
        const listas = deRetiro.filter(o=>o.estado==='lista')
        const F = pantallaFull
        const esc = F?1:0.62                       // factor de escala fuera de pantalla completa
        const px = (n)=>Math.round(n*esc)

        const columna = (titulo, ic, lista, color, destacada)=>(
          <div style={{flex:destacada?1.15:1,minWidth:px(360),display:'flex',flexDirection:'column',
            background:'rgba(255,255,255,0.04)',borderRadius:px(22),overflow:'hidden',
            border:`1px solid ${destacada?color+'55':'rgba(255,255,255,0.08)'}`,
            boxShadow:destacada?`0 0 ${px(60)}px ${color}22`:'none'}}>
            <div style={{padding:`${px(16)}px ${px(24)}px`,background:`linear-gradient(90deg, ${color}28, transparent)`,
              borderBottom:`2px solid ${color}`,display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
              <span style={{fontSize:px(26),fontWeight:900,color:'#fff',letterSpacing:'0.06em',display:'flex',alignItems:'center',gap:px(12)}}>
                <span style={{fontSize:px(30)}}>{ic}</span>{titulo}
              </span>
              <span style={{fontSize:px(24),fontWeight:900,color,background:'rgba(255,255,255,0.1)',
                minWidth:px(52),textAlign:'center',padding:`${px(3)}px ${px(16)}px`,borderRadius:px(30)}}>{lista.length}</span>
            </div>
            <div style={{flex:1,padding:px(20),display:'flex',flexWrap:'wrap',gap:px(14),alignContent:'flex-start',
              minHeight:F?'58vh':190,overflowY:'auto'}}>
              {lista.length===0
                ? <div style={{width:'100%',textAlign:'center',color:'rgba(255,255,255,0.18)',
                    fontSize:px(30),fontWeight:800,padding:`${px(44)}px 0`,letterSpacing:'0.1em'}}>
                    {destacada?'SIN PEDIDOS LISTOS':'SIN PEDIDOS EN COLA'}
                  </div>
                : lista.map(o=>(
                  <div key={o.id} className={destacada?'pk-listo':''}
                    style={{background:destacada?`linear-gradient(145deg, ${color}, #1F9B49)`:'rgba(255,255,255,0.07)',
                      border:destacada?'none':'1px solid rgba(255,255,255,0.12)',
                      borderRadius:px(16),padding:`${px(16)}px ${px(24)}px`,minWidth:px(168),textAlign:'center',
                      boxShadow:destacada?`0 ${px(8)}px ${px(28)}px ${color}44`:'none'}}>
                    <div style={{fontFamily:'ui-monospace,SFMono-Regular,monospace',fontWeight:900,
                      fontSize:px(destacada?60:44),lineHeight:1,
                      color:destacada?'#fff':'rgba(255,255,255,0.82)',
                      textShadow:destacada?'0 2px 12px rgba(0,0,0,0.28)':'none'}}>{o.folio}</div>
                    {primerNombre(o.cliente_nombre)&&
                      <div style={{fontSize:px(17),fontWeight:700,marginTop:px(5),letterSpacing:'0.04em',
                        color:destacada?'rgba(255,255,255,0.92)':'rgba(255,255,255,0.5)'}}>
                        {primerNombre(o.cliente_nombre)}</div>}
                  </div>
                ))}
            </div>
          </div>
        )

        return (
          <div style={F
            ? {position:'fixed',inset:0,zIndex:9500,overflow:'hidden',
               background:'radial-gradient(circle at 20% 0%, #24243e 0%, #0f0c29 55%, #08061a 100%)',
               padding:'26px 32px',display:'flex',flexDirection:'column',gap:20}
            : {borderRadius:20,overflow:'hidden',
               background:'radial-gradient(circle at 20% 0%, #24243e 0%, #0f0c29 55%, #08061a 100%)',
               padding:'18px 20px',display:'flex',flexDirection:'column',gap:14}}>
            <style>{`
              @keyframes pkPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.035)}}
              .pk-listo{animation:pkPulse 2.1s ease-in-out infinite}
              @keyframes pkGlow{0%,100%{opacity:0.45}50%{opacity:1}}
              .pk-dot{animation:pkGlow 1.6s ease-in-out infinite}
            `}</style>

            {/* Cabecera corporativa */}
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap',
              paddingBottom:px(16),borderBottom:'1px solid rgba(255,255,255,0.09)'}}>
              <div style={{display:'flex',alignItems:'center',gap:px(20)}}>
                {LOGO_B64&&<img src={LOGO_B64} alt="Outlet de Puertas"
                  style={{height:px(52),width:'auto',objectFit:'contain'}}/>}
                <div style={{width:2,height:px(46),background:BRAND_ORANGE,borderRadius:2}}/>
                <div>
                  <div style={{fontSize:px(30),fontWeight:900,color:'#fff',letterSpacing:'-0.01em',lineHeight:1.1}}>
                    Estado de tu pedido
                  </div>
                  <div style={{fontSize:px(15),color:'rgba(255,255,255,0.5)',fontWeight:600,marginTop:px(3),
                    display:'flex',alignItems:'center',gap:px(8)}}>
                    <span className="pk-dot" style={{width:px(8),height:px(8),borderRadius:px(4),background:'#34C759',display:'inline-block'}}/>
                    {sucSel==='todas'?'Todas las tiendas':nomSuc(sucSel)} · en vivo
                  </div>
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:px(18)}}>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:px(34),fontWeight:900,color:'#fff',fontFamily:'ui-monospace,monospace',lineHeight:1}}>
                    {new Date(reloj).toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'})}
                  </div>
                  <div style={{fontSize:px(13),color:'rgba(255,255,255,0.45)',fontWeight:600,textTransform:'capitalize'}}>
                    {new Date(reloj).toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long'})}
                  </div>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  <button onClick={()=>setPantallaSon(s=>!s)} title="Aviso sonoro al quedar un pedido listo"
                    style={{padding:'6px 12px',borderRadius:8,border:'1px solid rgba(255,255,255,0.16)',cursor:'pointer',
                      background:'rgba(255,255,255,0.06)',color:pantallaSon?'#34C759':'rgba(255,255,255,0.45)',
                      fontSize:11.5,fontWeight:800}}>{pantallaSon?'🔔 ON':'🔕 OFF'}</button>
                  <button onClick={()=>setPantallaFull(f=>!f)}
                    style={{padding:'6px 12px',borderRadius:8,border:'none',cursor:'pointer',
                      background:BRAND_ORANGE,color:'#fff',fontSize:11.5,fontWeight:800,whiteSpace:'nowrap'}}>
                    {F?'✕ Salir':'⛶ Pantalla completa'}</button>
                </div>
              </div>
            </div>

            {/* Columnas */}
            <div style={{display:'flex',gap:px(20),flexWrap:'wrap',flex:1,alignItems:'stretch'}}>
              {columna('EN PREPARACIÓN','⏳',preparando,'#FF9500',false)}
              {columna('LISTO PARA RETIRAR','✅',listas,'#34C759',true)}
            </div>

            {/* Pie corporativo */}
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',
              paddingTop:px(12),borderTop:'1px solid rgba(255,255,255,0.09)'}}>
              <span style={{fontSize:px(16),fontWeight:700,color:'rgba(255,255,255,0.62)'}}>
                Cuando tu número aparezca en <b style={{color:'#34C759'}}>verde</b>, acércate al mostrador
              </span>
              <span style={{fontSize:px(14),fontWeight:800,color:BRAND_ORANGE,letterSpacing:'0.08em'}}>
                OUTLET DE PUERTAS
              </span>
            </div>
          </div>
        )
      })()}

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
            {PanelOrden()}
          </div>
        </div>
      ))}

      {/* TAB RESPALDOS — conciliación documental de comprobantes firmados */}
      {tabVista==='respaldos'&&(()=>{
        if(respLoading||respData===null) return <div style={css.empty}>⏳ Cargando respaldos…</div>
        // filtros
        const txt = respTxt.trim().toLowerCase()
        let filas = respData.filter(o=>{
          if(respEstado==='pendientes'&&o.respaldo_firmado_url) return false
          if(respEstado==='con'&&!o.respaldo_firmado_url) return false
          if(txt){
            const blob = `${o.folio} ${o.cliente_nombre||''} ${o.receptor_nombre||''} ${o.guia_numero||''} ${o.chofer_nombre||''}`.toLowerCase()
            if(!blob.includes(txt)) return false
          }
          return true
        })
        // orden
        const {col,dir} = respSort
        const val = (o)=>{
          if(col==='respaldo') return o.respaldo_firmado_url?1:0
          if(col==='folio') return Number(o.folio)||o.folio
          return o[col]??''
        }
        filas = [...filas].sort((a,b)=>{
          const va=val(a), vb=val(b)
          const c = va<vb?-1:va>vb?1:0
          return dir==='asc'?c:-c
        })
        const pend = respData.filter(o=>!o.respaldo_firmado_url).length
        const thSort = (label, c, extra={})=>(
          <th style={{...th,cursor:'pointer',userSelect:'none',...extra}}
            onClick={()=>setRespSort(s=>({col:c,dir:s.col===c&&s.dir==='asc'?'desc':'asc'}))}>
            {label}{col===c?(dir==='asc'?' ▲':' ▼'):''}
          </th>
        )
        const chipResp = (o)=> o.respaldo_firmado_url
          ? <a href={o.respaldo_firmado_url} target="_blank" rel="noreferrer"
              style={{fontSize:10,fontWeight:800,color:'#248A3D',background:'#34C75915',padding:'3px 9px',borderRadius:10,textDecoration:'none'}}>
              ✓ {o.respaldo_firmado_at?new Date(o.respaldo_firmado_at).toLocaleDateString('es-CL'):'ver'}</a>
          : <span style={{fontSize:10,fontWeight:800,color:'#C93400',background:'#FF3B3012',padding:'3px 9px',borderRadius:10}}>⏳ PENDIENTE</span>
        const botonSubir = (o, grande=false)=>(
          <label style={{...btMini(o.respaldo_firmado_url?'#F2F2F7':'#1a1a2e', o.respaldo_firmado_url?'#6D6D72':'#fff'),
            display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6,cursor:'pointer',
            padding:grande?'11px 0':'5px 12px',width:grande?'100%':'auto',fontSize:grande?13:11}}>
            {subiendoResp===o.id?'⏳ Subiendo…':(o.respaldo_firmado_url?'↺ Reemplazar':'📷 Subir respaldo')}
            <input type="file" accept="image/*,application/pdf" capture="environment" style={{display:'none'}}
              disabled={subiendoResp===o.id}
              onChange={e=>{const f=e.target.files?.[0]; e.target.value=''; if(f) subirRespaldo(o,f)}}/>
          </label>
        )

        return (<>
          {/* Barra de control (responsive) */}
          <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:10}}>
            <div style={{display:'inline-flex',background:'#F2F2F7',borderRadius:9,padding:2}}>
              {[['hoy','Hoy'],['7d','7 días'],['30d','30 días'],['rango','Rango']].map(([k,l])=>(
                <button key={k} onClick={()=>setRespRango(k)}
                  style={{padding:'5px 11px',borderRadius:7,border:'none',fontSize:11.5,fontWeight:700,cursor:'pointer',
                    background:respRango===k?'#fff':'transparent',color:respRango===k?'#1C1C1E':'#8E8E93'}}>{l}</button>
              ))}
            </div>
            {respRango==='rango'&&(<span style={{display:'inline-flex',gap:6,alignItems:'center'}}>
              <input type="date" value={respD1} onChange={e=>setRespD1(e.target.value)} style={{...css.input,padding:'5px 8px',fontSize:11.5}}/>
              <input type="date" value={respD2} onChange={e=>setRespD2(e.target.value)} style={{...css.input,padding:'5px 8px',fontSize:11.5}}/>
              <Bt v="gry" sm onClick={cargarRespaldos}>Aplicar</Bt>
            </span>)}
            <div style={{display:'inline-flex',background:'#F2F2F7',borderRadius:9,padding:2}}>
              {[['todos',`Todos · ${respData.length}`],['pendientes',`⏳ Pendientes · ${pend}`],['con',`✓ Con respaldo · ${respData.length-pend}`]].map(([k,l])=>(
                <button key={k} onClick={()=>setRespEstado(k)}
                  style={{padding:'5px 11px',borderRadius:7,border:'none',fontSize:11.5,fontWeight:700,cursor:'pointer',
                    background:respEstado===k?'#fff':'transparent',
                    color:respEstado===k?(k==='pendientes'?'#C93400':k==='con'?'#248A3D':'#1C1C1E'):'#8E8E93'}}>{l}</button>
              ))}
            </div>
            <input value={respTxt} onChange={e=>setRespTxt(e.target.value)} placeholder="🔍 Folio, cliente, guía…"
              style={{...css.input,padding:'6px 10px',fontSize:12,flex:1,minWidth:150,maxWidth:260}}/>
            {!isMobile&&<Bt v="gry" sm onClick={()=>exportarRespaldos(filas)} dis={!filas.length}>⬇ Excel</Bt>}
          </div>

          {filas.length===0
            ? <div style={css.empty}>{respEstado==='pendientes'?'✅ Todo respaldado — conciliación documental al día':'Sin entregas en el período'}</div>
            : isMobile
            ? (/* ── MÓVIL: cards con botón de cámara ── */
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {filas.map(o=>(
                  <div key={o.id} style={{border:`1px solid ${o.respaldo_firmado_url?'#E5E5EA':'#FF3B3040'}`,borderRadius:12,padding:'10px 12px',
                    background:o.respaldo_firmado_url?'#fff':'#FFF9F8'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:4}}>
                      <span style={{fontFamily:'monospace',fontWeight:900,fontSize:16}}>#{o.folio}</span>
                      <span style={{fontSize:9.5,fontWeight:800,color:o.bsale_doc_type==='cotizacion'?'#AF52DE':'#8E8E93'}}>{DOC_S(o.bsale_doc_type)}</span>
                      <span style={{fontSize:10.5}}>{o.modalidad_entrega==='despacho'?'🚚':'🏪'}</span>
                      <span style={{marginLeft:'auto'}}>{chipResp(o)}</span>
                    </div>
                    <div style={{fontSize:12,fontWeight:600,marginBottom:2}}>{o.cliente_nombre||'Sin cliente'}</div>
                    <div style={{fontSize:10.5,color:'#8E8E93',marginBottom:8}}>
                      {nomSuc(o.sucursal_codigo)} · {o.entregada_at?new Date(o.entregada_at).toLocaleString('es-CL',{dateStyle:'short',timeStyle:'short'}):''}
                      {o.receptor_nombre?` · recibió ${o.receptor_nombre}`:''}{o.guia_numero?` · guía ${o.guia_numero}`:''}
                    </div>
                    {botonSubir(o, true)}
                  </div>
                ))}
              </div>)
            : (/* ── DESKTOP: grilla tipo Excel ── */
              <div style={{overflowX:'auto',border:'1px solid #E5E5EA',borderRadius:10}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>
                    {thSort('FOLIO','folio')}
                    {thSort('TIPO','bsale_doc_type',{width:44})}
                    {thSort('MOD','modalidad_entrega',{width:40})}
                    {thSort('TIENDA','sucursal_codigo')}
                    {thSort('CLIENTE','cliente_nombre')}
                    {thSort('RECEPTOR','receptor_nombre')}
                    {thSort('ENTREGADA','entregada_at')}
                    <th style={th}>GUÍA</th>
                    <th style={th}>COMPROBANTE</th>
                    {thSort('RESPALDO','respaldo')}
                    <th style={{...th,textAlign:'right'}}></th>
                  </tr></thead>
                  <tbody>
                    {filas.map(o=>(
                      <tr key={o.id} style={{background:o.respaldo_firmado_url?'transparent':'#FFF9F8'}}>
                        <td style={{...td,fontFamily:'monospace',fontWeight:800}}>#{o.folio}</td>
                        <td style={{...td,fontSize:10,fontWeight:800,color:o.bsale_doc_type==='cotizacion'?'#AF52DE':'#8E8E93'}}>{DOC_S(o.bsale_doc_type)}</td>
                        <td style={td}>{o.modalidad_entrega==='despacho'?'🚚':'🏪'}</td>
                        <td style={{...td,fontSize:11}}>{nomSuc(o.sucursal_codigo).replace('Sucursal ','')}</td>
                        <td style={{...td,fontSize:11.5,maxWidth:150,overflow:'hidden',textOverflow:'ellipsis'}}>{o.cliente_nombre||'—'}</td>
                        <td style={{...td,fontSize:11.5}}>{o.receptor_nombre||'—'}</td>
                        <td style={{...td,fontSize:11}}>{o.entregada_at?new Date(o.entregada_at).toLocaleString('es-CL',{dateStyle:'short',timeStyle:'short'}):'—'}</td>
                        <td style={{...td,fontFamily:'monospace',fontSize:11}}>{o.guia_numero||'—'}</td>
                        <td style={td}>{o.pdf_url?<a href={o.pdf_url} target="_blank" rel="noreferrer" style={{color:'#007AFF',fontWeight:700,fontSize:11}}>📄 PDF</a>:<span style={{color:'#C7C7CC',fontSize:11}}>—</span>}</td>
                        <td style={td}>{chipResp(o)}</td>
                        <td style={{...td,textAlign:'right'}}>{botonSubir(o)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>)
          }
        </>)
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
          // ── Despachos entregados por chofer (con estado de cobro del flete) ──
          const despEntregados = rows.filter(o=>o.estado==='entregada'&&o.modalidad_entrega==='despacho')
          const porChofer = {}
          despEntregados.forEach(o=>{
            const k = o.chofer_nombre||'(sin chofer registrado)'
            const c = porChofer[k] = porChofer[k]||{n:0,uds:0,pagados:0,porCobrar:0,montoCobrar:0,montoTotal:0,patente:o.chofer_patente||'',parciales:0}
            c.n++; c.uds+=Number(o.total_unidades||0)
            if(o.chofer_patente) c.patente = o.chofer_patente
            if(o.entrega_completa===false) c.parciales++
            const val = Number(o.despacho_valor||0)
            c.montoTotal += val
            if(o.despacho_pago==='por_pagar'){ c.porCobrar++; c.montoCobrar += val }
            else if(o.despacho_pago==='pagado') c.pagados++
          })
          const chofs = Object.entries(porChofer).sort((a,b)=>b[1].n-a[1].n)
          const totChof = chofs.reduce((a,[,c])=>({n:a.n+c.n,porCobrar:a.porCobrar+c.porCobrar,
            montoCobrar:a.montoCobrar+c.montoCobrar,montoTotal:a.montoTotal+c.montoTotal}),
            {n:0,porCobrar:0,montoCobrar:0,montoTotal:0})
          const sinChofer = despEntregados.filter(o=>!o.chofer_nombre).length
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

            {/* ── Sub-reporte: entregas por chofer ── */}
            {despEntregados.length>0&&(
              <div style={{border:'1px solid #5856D630',borderRadius:10,marginBottom:14,overflow:'hidden'}}>
                <div style={{padding:'8px 12px',background:'#5856D60A',borderBottom:'1px solid #5856D625',
                  display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
                  <span style={{fontSize:11,fontWeight:800,color:'#5856D6',letterSpacing:'0.03em'}}>
                    🚛 DESPACHOS ENTREGADOS POR CHOFER · {despEntregados.length}
                  </span>
                  <span style={{display:'inline-flex',gap:10,flexWrap:'wrap',fontSize:10.5,fontWeight:800}}>
                    <span style={{color:'#248A3D'}}>Flete cobrado en tienda: {totChof.n-totChof.porCobrar}</span>
                    <span style={{color:'#C93400'}}>Por cobrar en ruta: {totChof.porCobrar} · {fmtCLP(totChof.montoCobrar)}</span>
                  </span>
                </div>
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead><tr>
                      <th style={th}>CHOFER</th>
                      <th style={th}>PATENTE</th>
                      <th style={{...th,textAlign:'right'}}>DESPACHOS</th>
                      <th style={{...th,textAlign:'right'}}>UNIDADES</th>
                      <th style={{...th,textAlign:'right'}}>FLETE PAGADO</th>
                      <th style={{...th,textAlign:'right'}}>POR COBRAR</th>
                      <th style={{...th,textAlign:'right'}}>$ A RECAUDAR</th>
                      <th style={{...th,textAlign:'right'}}>PARCIALES</th>
                    </tr></thead>
                    <tbody>
                      {chofs.map(([nom,c])=>(
                        <tr key={nom}>
                          <td style={{...td,fontWeight:700}}>{nom==='(sin chofer registrado)'
                            ? <span style={{color:'#C93400'}}>⚠ {nom}</span> : nom}</td>
                          <td style={{...td,fontFamily:'monospace',fontSize:11,color:'#8E8E93'}}>{c.patente||'—'}</td>
                          <td style={{...td,textAlign:'right',fontWeight:800}}>{c.n}</td>
                          <td style={{...td,textAlign:'right'}}>{c.uds}</td>
                          <td style={{...td,textAlign:'right',color:'#248A3D',fontWeight:700}}>{c.pagados||'—'}</td>
                          <td style={{...td,textAlign:'right',color:c.porCobrar?'#C93400':'#C7C7CC',fontWeight:800}}>{c.porCobrar||'—'}</td>
                          <td style={{...td,textAlign:'right',fontWeight:800,color:c.montoCobrar?'#C93400':'#C7C7CC'}}>
                            {c.montoCobrar?fmtCLP(c.montoCobrar):'—'}</td>
                          <td style={{...td,textAlign:'right',color:c.parciales?'#FF9500':'#C7C7CC',fontWeight:700}}>{c.parciales||'—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr style={{background:'#FAFAFC',borderTop:'2px solid #5856D630'}}>
                      <td style={{...td,fontWeight:900}} colSpan={2}>TOTAL</td>
                      <td style={{...td,textAlign:'right',fontWeight:900}}>{totChof.n}</td>
                      <td style={td}></td>
                      <td style={{...td,textAlign:'right',fontWeight:900,color:'#248A3D'}}>{totChof.n-totChof.porCobrar}</td>
                      <td style={{...td,textAlign:'right',fontWeight:900,color:'#C93400'}}>{totChof.porCobrar}</td>
                      <td style={{...td,textAlign:'right',fontWeight:900,color:'#C93400'}}>{fmtCLP(totChof.montoCobrar)}</td>
                      <td style={td}></td>
                    </tr></tfoot>
                  </table>
                </div>
                {sinChofer>0&&(
                  <div style={{padding:'7px 12px',fontSize:10.5,color:'#C93400',fontWeight:700,background:'#FFF5F5'}}>
                    ⚠ {sinChofer} despacho{sinChofer>1?'s':''} entregado{sinChofer>1?'s':''} antes de habilitar el registro de chofer — sin trazabilidad de quién entregó.
                  </div>
                )}
                {totChof.montoCobrar>0&&(
                  <div style={{padding:'7px 12px',fontSize:10.5,color:'#8E8E93',fontWeight:600,background:'#FAFAFC',borderTop:'1px solid #E5E5EA'}}>
                    💰 {fmtCLP(totChof.montoCobrar)} recaudados en ruta en el período — cada chofer debe rendirlos al jefe de tienda.
                  </div>
                )}
              </div>
            )}

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
                      <td style={{...td,fontFamily:'monospace',fontWeight:800}}>#{o.folio} <span style={{fontSize:9,color:'#8E8E93'}}>{DOC_S(o.bsale_doc_type)}</span></td>
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
