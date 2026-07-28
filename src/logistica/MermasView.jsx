// ═══════════════════════════════════════════════════════════════════════════
// MermasView — Conciliación de bajas de stock de BSALE
//
// Regla del negocio: TODA baja de stock debe quedar clasificada y respaldada.
// Nada puede quedar sin respaldo documental.
//
// Fuente: tabla log_mermas, alimentada por la edge function mermas-sync desde
// /v1/stocks/consumptions.json de BSALE.
//
// Vistas:
//   · Pendientes  — cola por sucursal, exige clasificar y subir respaldo
//   · Todas       — grilla completa con filtros y export
//   · Tipos       — administración de patrones del clasificador
//
// Móvil (≤768px): cards con botón de cámara, igual que el tab Respaldos.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { css, Bt } from './ui_compartida.jsx'

const TIPOS = {
  segunda_seleccion: { l: 'Segunda selección', c: '#AF52DE', ic: '♻️' },
  destruccion:       { l: 'Destrucción',       c: '#FF3B30', ic: '🗑️' },
  perdida:           { l: 'Pérdida',           c: '#C93400', ic: '❌' },
  conversion:        { l: 'Conversión',        c: '#5856D6', ic: '🔄' },
  correccion_sku:    { l: 'Corrección SKU',    c: '#FF9500', ic: '✏️' },
  ajuste_inventario: { l: 'Ajuste inventario', c: '#007AFF', ic: '📋' },
  uso_interno:       { l: 'Uso interno',       c: '#34C759', ic: '🏠' },
  traslado:          { l: 'Traslado',          c: '#8E8E93', ic: '🚚' },
  ajuste:            { l: 'Ajuste',            c: '#8E8E93', ic: '⚙️' },
  sin_clasificar:    { l: 'SIN CLASIFICAR',    c: '#FF2D55', ic: '⚠️' },
}
const tipoInfo = (t) => TIPOS[t] || { l: t || '—', c: '#8E8E93', ic: '•' }
const fmtCLP = (n) => n == null || isNaN(Number(n)) ? '—'
  : '$' + Math.round(Number(n)).toLocaleString('es-CL')
const fmtNum = (n) => Number(n || 0).toLocaleString('es-CL')

const th = { padding: '7px 9px', fontSize: 9.5, fontWeight: 800, color: '#6D6D72', textAlign: 'left',
  background: '#FAFAFC', borderBottom: '1px solid #E5E5EA', whiteSpace: 'nowrap', letterSpacing: '0.03em' }
const td = { padding: '7px 9px', fontSize: 12, borderBottom: '1px solid #F2F2F7', verticalAlign: 'middle' }

export function MermasView({ cu, sucs }) {
  const [tab, setTab]         = useState('pendientes')   // pendientes | todas | tipos
  const [rows, setRows]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg]         = useState('')
  const [sucSel, setSucSel]   = useState('todas')
  const [tipoSel, setTipoSel] = useState('todos')
  const [txt, setTxt]         = useState('')
  const [sort, setSort]       = useState({ col: 'fecha', dir: 'desc' })
  const [sel, setSel]         = useState(null)           // merma abierta
  const [items, setItems]     = useState([])
  const [subiendo, setSubiendo] = useState(null)
  const [nuevoTipo, setNuevoTipo] = useState('')
  const [nota, setNota]       = useState('')
  const [patrones, setPatrones] = useState([])
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 768)
  const msgT = useRef(null)

  const flash = (m) => { setMsg(m); clearTimeout(msgT.current); msgT.current = setTimeout(() => setMsg(''), 4000) }

  useEffect(() => {
    const f = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])

  // ── Alcance por rol: quien no es gerencia/CD ve sólo su sucursal ──────────
  const rol = cu?.rol_logistica || cu?.rol || ''
  const verTodo = ['admin', 'admin_sistema', 'jefe_bodega', 'coordinador',
    'logistica_admin', 'logistica_jefe_bodega', 'dir_general'].some(r => String(rol).includes(r))
  const sucPropia = cu?.sucursal_codigo || null

  const cargar = async () => {
    setLoading(true)
    try {
      let q = supabase.from('log_mermas')
        .select('id,bsale_consumption_id,bsale_office_id,sucursal_codigo,fecha,nota,tipo,' +
          'requiere_respaldo,total_items,total_unidades,costo_total,estado,' +
          'respaldo_url,respaldo_nombre,respaldo_at,respaldo_por,respaldo_nota')
        .order('fecha', { ascending: false }).limit(5000)
      if (!verTodo && sucPropia) q = q.eq('sucursal_codigo', sucPropia)
      const { data, error } = await q
      if (error) throw error
      setRows(data || [])
    } catch (e) { flash('⚠️ ' + e.message) }
    setLoading(false)
  }
  const cargarPatrones = async () => {
    const { data } = await supabase.from('log_mermas_patron')
      .select('*').order('prioridad')
    setPatrones(data || [])
  }
  useEffect(() => { cargar() }, [])   // solo al montar: el filtro por rol no cambia en sesion
  useEffect(() => { if (tab === 'tipos') cargarPatrones() }, [tab])

  const abrir = async (m) => {
    setSel(m); setNuevoTipo(m.tipo || ''); setNota(m.respaldo_nota || ''); setItems([])
    const { data } = await supabase.from('log_mermas_items')
      .select('sku,producto,cantidad,costo_unitario,costo_total,stock_despues')
      .eq('merma_id', m.id).order('costo_total', { ascending: false })
    setItems(data || [])
  }

  // ── Subir el respaldo documental ─────────────────────────────────────────
  const subirRespaldo = async (m, file) => {
    if (!file) return
    setSubiendo(m.id)
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `mermas/${m.sucursal_codigo || 'sin-suc'}/${m.bsale_consumption_id}.${ext}`
      const { error: eUp } = await supabase.storage.from('log-documentos-wms')
        .upload(path, file, { upsert: true, contentType: file.type || undefined })
      if (eUp) throw eUp
      const url = supabase.storage.from('log-documentos-wms').getPublicUrl(path).data.publicUrl
      const ahora = new Date().toISOString()
      const patch = {
        respaldo_url: url, respaldo_nombre: file.name, respaldo_at: ahora,
        respaldo_por: cu?.nombre || '', estado: 'respaldado',
      }
      if (nota.trim()) patch.respaldo_nota = nota.trim()
      const { error } = await supabase.from('log_mermas').update(patch).eq('id', m.id)
      if (error) throw error
      setRows(prev => prev.map(r => r.id === m.id ? { ...r, ...patch } : r))
      if (sel?.id === m.id) setSel(s => ({ ...s, ...patch }))
      flash(`✅ Respaldo cargado — baja ${m.bsale_consumption_id} conciliada`)
    } catch (e) { flash('⚠️ ' + e.message) }
    setSubiendo(null)
  }

  // ── Clasificar a mano (obligatorio antes de conciliar) ───────────────────
  const clasificar = async (m, tipo) => {
    if (!tipo) { flash('⚠️ Elige un tipo'); return }
    const { error } = await supabase.from('log_mermas').update({ tipo }).eq('id', m.id)
    if (error) { flash('⚠️ ' + error.message); return }
    setRows(prev => prev.map(r => r.id === m.id ? { ...r, tipo } : r))
    setSel(s => s ? { ...s, tipo } : s)
    flash(`Clasificada como ${tipoInfo(tipo).l}`)
  }

  // Crear un patrón desde una nota concreta, para que el clasificador aprenda
  const crearPatron = async (m, tipo) => {
    const base = (m.nota || '').trim().toLowerCase().slice(0, 40)
    if (!base) { flash('⚠️ Esa baja no tiene nota'); return }
    const { error } = await supabase.from('log_mermas_patron').insert({
      patron: `%${base}%`, tipo, requiere_respaldo: true, prioridad: 15,
      descripcion: `Creado desde la baja ${m.bsale_consumption_id} por ${cu?.nombre || ''}`,
    })
    if (error) { flash('⚠️ ' + error.message); return }
    flash(`Patrón creado: %${base}% → ${tipoInfo(tipo).l}. Corre "reclasificar" para aplicarlo al resto.`)
    cargarPatrones()
  }

  const exportar = async (filas) => {
    const XLSX = await import('xlsx')
    const out = filas.map(m => ({
      Consumo: m.bsale_consumption_id, Fecha: m.fecha,
      Sucursal: m.sucursal_codigo || '', Tipo: tipoInfo(m.tipo).l, Nota: m.nota || '',
      Items: m.total_items, Unidades: m.total_unidades, Costo: m.costo_total,
      Estado: m.estado === 'respaldado' ? 'RESPALDADO' : 'PENDIENTE',
      RespaldoPor: m.respaldo_por || '',
      RespaldoFecha: m.respaldo_at ? new Date(m.respaldo_at).toLocaleString('es-CL') : '',
      Observacion: m.respaldo_nota || '',
    }))
    const ws = XLSX.utils.json_to_sheet(out)
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Mermas')
    XLSX.writeFile(wb, `mermas_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  if (loading || rows === null) return <div style={css.empty}>⏳ Cargando bajas de stock…</div>

  // ── Filtros ──
  const q = txt.trim().toLowerCase()
  let filas = rows.filter(m => {
    if (sucSel !== 'todas' && m.sucursal_codigo !== sucSel) return false
    if (tipoSel !== 'todos' && m.tipo !== tipoSel) return false
    if (tab === 'pendientes' && m.estado === 'respaldado') return false
    if (q) {
      const blob = `${m.bsale_consumption_id} ${m.nota || ''} ${m.sucursal_codigo || ''} ${tipoInfo(m.tipo).l}`.toLowerCase()
      if (!blob.includes(q)) return false
    }
    return true
  })
  const val = (m) => sort.col === 'costo' ? Number(m.costo_total || 0)
    : sort.col === 'tipo' ? tipoInfo(m.tipo).l : (m[sort.col] ?? '')
  filas = [...filas].sort((a, b) => {
    const x = val(a), y = val(b), c = x < y ? -1 : x > y ? 1 : 0
    return sort.dir === 'asc' ? c : -c
  })

  const pend = rows.filter(m => m.estado !== 'respaldado')
  const sinClas = rows.filter(m => m.tipo === 'sin_clasificar')
  const costoPend = pend.reduce((s, m) => s + Number(m.costo_total || 0), 0)
  const nomSuc = (c) => (sucs || []).find(s => s.codigo === c)?.nombre || c || '—'

  const thS = (label, col, extra = {}) => (
    <th style={{ ...th, cursor: 'pointer', userSelect: 'none', ...extra }}
      onClick={() => setSort(s => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }))}>
      {label}{sort.col === col ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  )
  const chipTipo = (t) => {
    const i = tipoInfo(t)
    return <span style={{ fontSize: 10, fontWeight: 800, color: i.c, background: i.c + '15',
      padding: '3px 8px', borderRadius: 10, whiteSpace: 'nowrap' }}>{i.ic} {i.l}</span>
  }
  const chipEstado = (m) => m.estado === 'respaldado'
    ? <a href={m.respaldo_url} target="_blank" rel="noreferrer"
        style={{ fontSize: 10, fontWeight: 800, color: '#248A3D', background: '#34C75915',
          padding: '3px 9px', borderRadius: 10, textDecoration: 'none' }}>✓ RESPALDADO</a>
    : <span style={{ fontSize: 10, fontWeight: 800, color: '#C93400', background: '#FF3B3012',
        padding: '3px 9px', borderRadius: 10 }}>⏳ PENDIENTE</span>

  const botonSubir = (m, grande = false) => (
    <label style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      cursor: 'pointer', borderRadius: 8, fontWeight: 800,
      background: m.estado === 'respaldado' ? '#F2F2F7' : '#1a1a2e',
      color: m.estado === 'respaldado' ? '#6D6D72' : '#fff',
      padding: grande ? '11px 0' : '5px 12px', width: grande ? '100%' : 'auto',
      fontSize: grande ? 13 : 11 }}>
      {subiendo === m.id ? '⏳ Subiendo…' : (m.estado === 'respaldado' ? '↺ Reemplazar' : '📷 Subir respaldo')}
      <input type="file" accept="image/*,application/pdf" capture="environment" style={{ display: 'none' }}
        disabled={subiendo === m.id}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) subirRespaldo(m, f) }} />
    </label>
  )

  return (
    <div style={{ padding: isMobile ? 12 : 18 }}>
      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: isMobile ? 17 : 20, fontWeight: 900 }}>📉 Bajas de stock · Mermas</div>
          <div style={{ fontSize: 11.5, color: '#8E8E93', fontWeight: 600 }}>
            Toda baja debe quedar clasificada y con respaldo documental
          </div>
        </div>
        <div style={{ display: 'inline-flex', background: '#F2F2F7', borderRadius: 9, padding: 2 }}>
          {[['pendientes', `⏳ Pendientes · ${pend.length}`], ['todas', `Todas · ${rows.length}`], ['tipos', '⚙ Tipos']]
            .map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ padding: '5px 12px', borderRadius: 7, border: 'none', fontSize: 11.5, fontWeight: 700,
                cursor: 'pointer', background: tab === k ? '#fff' : 'transparent',
                color: tab === k ? (k === 'pendientes' ? '#C93400' : '#1C1C1E') : '#8E8E93' }}>{l}</button>
          ))}
        </div>
      </div>

      {msg && <div style={{ padding: '8px 12px', borderRadius: 9, marginBottom: 10, fontSize: 12, fontWeight: 700,
        background: msg.startsWith('⚠') ? '#FF3B3012' : '#34C75912',
        color: msg.startsWith('⚠') ? '#C93400' : '#248A3D' }}>{msg}</div>}

      {/* Alertas de control */}
      {tab !== 'tipos' && (pend.length > 0 || sinClas.length > 0) && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: '1 1 220px', padding: '10px 13px', borderRadius: 10,
            background: '#FF3B3010', border: '1px solid #FF3B3030' }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#C93400', letterSpacing: '0.03em' }}>SIN RESPALDO</div>
            <div style={{ fontSize: 19, fontWeight: 900, color: '#C93400' }}>{pend.length}</div>
            <div style={{ fontSize: 11, color: '#8E4A42', fontWeight: 700 }}>{fmtCLP(costoPend)} sin justificar</div>
          </div>
          {sinClas.length > 0 && (
            <div style={{ flex: '1 1 220px', padding: '10px 13px', borderRadius: 10,
              background: '#FF2D5510', border: '1px solid #FF2D5530' }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#FF2D55', letterSpacing: '0.03em' }}>SIN CLASIFICAR</div>
              <div style={{ fontSize: 19, fontWeight: 900, color: '#FF2D55' }}>{sinClas.length}</div>
              <div style={{ fontSize: 11, color: '#8E8E93', fontWeight: 700 }}>hay que asignarles tipo</div>
            </div>
          )}
        </div>
      )}

      {/* ══ TAB TIPOS: patrones del clasificador ══ */}
      {tab === 'tipos' ? (
        <>
          <div style={{ fontSize: 11.5, color: '#6D6D72', marginBottom: 8, lineHeight: 1.4 }}>
            El clasificador compara la nota de BSALE con estos patrones, en orden de prioridad;
            gana el primero que calza. Tras cambiarlos, corre la acción <b>reclasificar</b> de
            la función <code>mermas-sync</code> para aplicarlos a lo ya sincronizado.
          </div>
          <div style={{ overflowX: 'auto', border: '1px solid #E5E5EA', borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>PRIORIDAD</th><th style={th}>PATRÓN</th>
                <th style={th}>CLASIFICA COMO</th><th style={th}>DESCRIPCIÓN</th>
              </tr></thead>
              <tbody>
                {patrones.map(p => (
                  <tr key={p.id}>
                    <td style={{ ...td, fontWeight: 800, width: 80 }}>{p.prioridad}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11.5 }}>{p.patron}</td>
                    <td style={td}>{chipTipo(p.tipo)}</td>
                    <td style={{ ...td, fontSize: 11, color: '#8E8E93' }}>{p.descripcion || ''}</td>
                  </tr>
                ))}
                {patrones.length === 0 && <tr><td colSpan={4} style={{ ...td, textAlign: 'center', padding: 20, color: '#8E8E93' }}>
                  Sin patrones cargados.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          {/* Filtros */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            {verTodo && (
              <select value={sucSel} onChange={e => setSucSel(e.target.value)}
                style={{ ...css.select, padding: '6px 9px', fontSize: 12 }}>
                <option value="todas">Todas las sucursales</option>
                {(sucs || []).map(s => <option key={s.codigo} value={s.codigo}>{s.nombre}</option>)}
              </select>
            )}
            <select value={tipoSel} onChange={e => setTipoSel(e.target.value)}
              style={{ ...css.select, padding: '6px 9px', fontSize: 12 }}>
              <option value="todos">Todos los tipos</option>
              {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
            </select>
            <input value={txt} onChange={e => setTxt(e.target.value)} placeholder="🔍 Nota, N° consumo…"
              style={{ ...css.input, padding: '6px 10px', fontSize: 12, flex: 1, minWidth: 140, maxWidth: 240 }} />
            {!isMobile && <Bt v="gry" sm onClick={() => exportar(filas)} dis={!filas.length}>⬇ Excel</Bt>}
            <Bt v="gry" sm onClick={cargar}>↻</Bt>
          </div>

          {filas.length === 0 ? (
            <div style={css.empty}>
              {tab === 'pendientes' ? '✅ Todas las bajas están respaldadas' : 'Sin bajas de stock en este filtro'}
            </div>
          ) : isMobile ? (
            /* ── MÓVIL: cards ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filas.map(m => (
                <div key={m.id} style={{ border: `1px solid ${m.estado === 'respaldado' ? '#E5E5EA' : '#FF3B3040'}`,
                  borderRadius: 12, padding: '10px 12px', background: m.estado === 'respaldado' ? '#fff' : '#FFF9F8' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 5 }}>
                    {chipTipo(m.tipo)}
                    <span style={{ marginLeft: 'auto' }}>{chipEstado(m)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 3, lineHeight: 1.3 }}>{m.nota || '(sin nota)'}</div>
                  <div style={{ fontSize: 10.5, color: '#8E8E93', marginBottom: 8 }}>
                    {m.fecha} · {nomSuc(m.sucursal_codigo)} · {m.total_items} ítems · {fmtNum(m.total_unidades)} uds ·
                    <b style={{ color: '#1C1C1E' }}> {fmtCLP(m.costo_total)}</b>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Bt v="gry" sm onClick={() => abrir(m)}>Ver detalle</Bt>
                    <div style={{ flex: 1 }}>{botonSubir(m, true)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* ── DESKTOP: grilla ── */
            <div style={{ overflowX: 'auto', border: '1px solid #E5E5EA', borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  {thS('FECHA', 'fecha')}
                  {thS('N° BSALE', 'bsale_consumption_id')}
                  {thS('SUCURSAL', 'sucursal_codigo')}
                  {thS('TIPO', 'tipo')}
                  <th style={th}>NOTA REGISTRADA EN BSALE</th>
                  <th style={{ ...th, textAlign: 'right' }}>ÍTEMS</th>
                  <th style={{ ...th, textAlign: 'right' }}>UDS</th>
                  {thS('COSTO', 'costo', { textAlign: 'right' })}
                  <th style={th}>RESPALDO</th>
                  <th style={th}></th>
                </tr></thead>
                <tbody>
                  {filas.map(m => (
                    <tr key={m.id} style={{ background: m.estado === 'respaldado' ? 'transparent' : '#FFF9F8' }}>
                      <td style={{ ...td, fontSize: 11 }}>{m.fecha}</td>
                      <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, fontSize: 11 }}>{m.bsale_consumption_id}</td>
                      <td style={{ ...td, fontSize: 11 }}>{nomSuc(m.sucursal_codigo).replace('Sucursal ', '')}</td>
                      <td style={td}>{chipTipo(m.tipo)}</td>
                      <td style={{ ...td, fontSize: 11.5, maxWidth: 260, whiteSpace: 'normal', lineHeight: 1.3 }}>
                        <span style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationColor: '#E5E5EA' }}
                          onClick={() => abrir(m)}>{m.nota || '(sin nota)'}</span>
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>{m.total_items}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtNum(m.total_unidades)}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{fmtCLP(m.costo_total)}</td>
                      <td style={td}>{chipEstado(m)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{botonSubir(m)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr style={{ background: '#FAFAFC', borderTop: '2px solid #E5E5EA' }}>
                  <td style={{ ...td, fontWeight: 900 }} colSpan={5}>{filas.length} bajas</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 900 }}>
                    {filas.reduce((s, m) => s + Number(m.total_items || 0), 0)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 900 }}>
                    {fmtNum(filas.reduce((s, m) => s + Number(m.total_unidades || 0), 0))}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 900 }}>
                    {fmtCLP(filas.reduce((s, m) => s + Number(m.costo_total || 0), 0))}</td>
                  <td style={td} colSpan={2}></td>
                </tr></tfoot>
              </table>
            </div>
          )}
        </>
      )}

      {/* ══ Panel de detalle ══ */}
      {sel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}
          onClick={() => setSel(null)}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 18, width: '100%', maxWidth: 640,
            maxHeight: '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 900 }}>Baja de stock N° {sel.bsale_consumption_id}</div>
                <div style={{ fontSize: 11.5, color: '#8E8E93', fontWeight: 600 }}>
                  {sel.fecha} · {nomSuc(sel.sucursal_codigo)} · office {sel.bsale_office_id}
                </div>
              </div>
              {chipEstado(sel)}
            </div>

            <div style={{ padding: '9px 11px', borderRadius: 9, background: '#FAFAFC',
              border: '1px solid #E5E5EA', marginBottom: 10 }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: '#8E8E93', marginBottom: 2 }}>NOTA EN BSALE</div>
              <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.35 }}>{sel.nota || '(sin nota)'}</div>
            </div>

            {/* Clasificación obligatoria */}
            <div style={{ padding: '9px 11px', borderRadius: 9, marginBottom: 10,
              background: sel.tipo === 'sin_clasificar' ? '#FF2D5510' : '#F7F8FA',
              border: `1px solid ${sel.tipo === 'sin_clasificar' ? '#FF2D5535' : '#E5E5EA'}` }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: sel.tipo === 'sin_clasificar' ? '#FF2D55' : '#8E8E93',
                marginBottom: 5 }}>
                CLASIFICACIÓN {sel.tipo === 'sin_clasificar' ? '— OBLIGATORIA ANTES DE CONCILIAR' : ''}
              </div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={nuevoTipo} onChange={e => setNuevoTipo(e.target.value)}
                  style={{ ...css.select, padding: '7px 9px', flex: 1, minWidth: 170 }}>
                  <option value="">— elegir tipo —</option>
                  {Object.entries(TIPOS).filter(([k]) => k !== 'sin_clasificar')
                    .map(([k, v]) => <option key={k} value={k}>{v.ic} {v.l}</option>)}
                </select>
                <Bt v="pri" sm dis={!nuevoTipo || nuevoTipo === sel.tipo}
                  onClick={() => clasificar(sel, nuevoTipo)}>Guardar tipo</Bt>
                {verTodo && nuevoTipo && (
                  <Bt v="gry" sm onClick={() => crearPatron(sel, nuevoTipo)}
                    title="Crea un patrón con esta nota para que el clasificador la reconozca sola">
                    + Patrón</Bt>
                )}
              </div>
            </div>

            {/* Ítems */}
            <div style={{ fontSize: 10, fontWeight: 800, color: '#6D6D72', margin: '0 2px 5px' }}>
              PRODUCTOS DADOS DE BAJA · {items.length}
            </div>
            <div style={{ border: '1px solid #E5E5EA', borderRadius: 9, overflow: 'hidden', marginBottom: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th}>SKU</th><th style={th}>PRODUCTO</th>
                  <th style={{ ...th, textAlign: 'right' }}>CANT</th>
                  <th style={{ ...th, textAlign: 'right' }}>COSTO</th>
                </tr></thead>
                <tbody>
                  {items.map((i, k) => (
                    <tr key={k}>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 10.5 }}>{i.sku}</td>
                      <td style={{ ...td, fontSize: 11.5 }}>{i.producto}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmtNum(i.cantidad)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtCLP(i.costo_total)}</td>
                    </tr>
                  ))}
                  {items.length === 0 && <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: '#8E8E93', padding: 14 }}>
                    Sin detalle sincronizado.</td></tr>}
                </tbody>
                <tfoot><tr style={{ background: '#FAFAFC' }}>
                  <td style={{ ...td, fontWeight: 900 }} colSpan={2}>TOTAL</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 900 }}>{fmtNum(sel.total_unidades)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 900 }}>{fmtCLP(sel.costo_total)}</td>
                </tr></tfoot>
              </table>
            </div>

            {/* Respaldo */}
            <div style={{ padding: '10px 12px', borderRadius: 10,
              background: sel.estado === 'respaldado' ? '#34C75908' : '#FF3B3008',
              border: `1px solid ${sel.estado === 'respaldado' ? '#34C75930' : '#FF3B3030'}` }}>
              <div style={{ fontSize: 10, fontWeight: 800, marginBottom: 6,
                color: sel.estado === 'respaldado' ? '#248A3D' : '#C93400' }}>
                {sel.estado === 'respaldado' ? '✓ RESPALDO CARGADO' : '📎 RESPALDO OBLIGATORIO'}
              </div>
              {sel.estado === 'respaldado' && (
                <div style={{ fontSize: 11.5, marginBottom: 7 }}>
                  <a href={sel.respaldo_url} target="_blank" rel="noreferrer"
                    style={{ color: '#007AFF', fontWeight: 700 }}>{sel.respaldo_nombre || 'ver documento'}</a>
                  <span style={{ color: '#8E8E93' }}>
                    {' '}· {sel.respaldo_por} · {sel.respaldo_at ? new Date(sel.respaldo_at).toLocaleString('es-CL') : ''}
                  </span>
                </div>
              )}
              <input value={nota} onChange={e => setNota(e.target.value)}
                placeholder="Observación / autorización (opcional)"
                style={{ ...css.input, width: '100%', padding: '8px 10px', marginBottom: 8 }} />
              {botonSubir(sel, true)}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <Bt v="gry" sm onClick={() => setSel(null)}>Cerrar</Bt>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default MermasView
