import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Upload, Loader2, TrendingUp, TrendingDown, CheckCircle2, AlertTriangle, Info } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabase'

const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n ?? 0)
const fmtFecha = s => { if (!s) return '—'; const [y,m,d] = s.split('-'); return `${d}/${m}/${y}` }

// ── Parser cartola Santander ────────────────────────────────────────────────
// Formato:
//   Filas 1–11 → metadata (cuenta, período, ejecutivo, etc.)
//   Fila 12    → encabezados: MONTO | DESC | FECHA | SALDO | N°DOC | SUCURSAL | CARGO/ABONO
//   Fila 13+   → datos (monto puede ser negativo directamente, o siempre positivo con A/C)
function parsearCartolaSantander(buffer) {
  const wb = XLSX.read(buffer, { type: 'array', raw: true, cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })

  // ── Metadata ──
  let cuenta = null, periodoDesde = null, periodoHasta = null, rut = null, empresa = null
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const row = rows[i] ?? []
    for (const cell of row) {
      const s = String(cell ?? '')
      if (s.includes('Cuenta Corriente N')) { const m = s.match(/N°:\s*([\d\-]+)/i); if (m) cuenta = m[1].trim() }
      if (s.includes('Fecha desde:')) { const m = s.match(/(\d{2}\/\d{2}\/\d{4})/); if (m) periodoDesde = m[1] }
      if (s.includes('Fecha hasta:')) { const m = s.match(/(\d{2}\/\d{2}\/\d{4})/); if (m) periodoHasta = m[1] }
      if (s.startsWith('RUT empresa:')) { const m = s.match(/([\d.]+\-[\dkK])/); if (m) rut = m[1] }
      if (s.startsWith('Empresa:')) empresa = s.replace('Empresa:', '').trim()
    }
    // También revisar celdas individuales de columnas adyacentes
    const c0 = String(rows[i]?.[0] ?? '')
    if (c0.startsWith('Empresa:')) empresa = String(rows[i]?.[1] ?? '').trim()
    if (c0.startsWith('RUT empresa:')) { const m = c0.match(/([\d.]+\-[\dkK])/); if (m) rut = m[1] }
  }

  // ── Localizar fila de encabezados ──
  let dataStart = -1
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]?.[0] && String(rows[i][0]).toUpperCase().trim() === 'MONTO') { dataStart = i + 1; break }
  }
  if (dataStart < 0) throw new Error('No se encontró la tabla (buscando fila con encabezado "MONTO")')

  const toN = v => { if (v == null) return 0; if (typeof v === 'number') return Math.round(v); const n = parseFloat(String(v).replace(/[^0-9.-]/g,'')); return isNaN(n) ? 0 : Math.round(n) }
  const toISO = v => { if (!v) return null; const s = String(v).trim(); const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }
  const toISOmeta = v => { if (!v) return null; const m = String(v).match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }

  const movs = []
  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i] ?? []
    if (!row[0] && !row[2]) continue
    const montoRaw = toN(row[0]); if (!montoRaw) continue
    const fecha = toISO(row[2]); if (!fecha) continue
    const cargoAbono = String(row[6] ?? '').trim().toUpperCase()
    if (cargoAbono !== 'A' && cargoAbono !== 'C') continue

    movs.push({
      fecha,
      monto_bruto: Math.abs(montoRaw),           // siempre positivo para mostrar
      monto: cargoAbono === 'C' ? -Math.abs(montoRaw) : Math.abs(montoRaw),  // con signo para BD
      saldo_tras: toN(row[3]),                   // saldo después de este movimiento
      tipo: cargoAbono === 'C' ? 'CARGO' : 'ABONO',
      descripcion: String(row[1] ?? '').trim(),
      referencia: String(row[4] ?? '').trim() || null,
      sucursal_banco: String(row[5] ?? '').trim() || null,
    })
  }

  if (movs.length === 0) throw new Error('No se encontraron movimientos en la tabla')

  // ── Saldo inicial / final ──
  // Los datos vienen en orden DESCENDENTE (más reciente primero)
  // Saldo final = saldo del PRIMER movimiento (más reciente)
  // Saldo inicial = saldo del ÚLTIMO movimiento (más antiguo) MENOS su monto (antes de aplicarlo)
  const masReciente = movs[0]
  const masAntiguo  = movs[movs.length - 1]
  const saldoFinal   = masReciente.saldo_tras
  const saldoInicial = masAntiguo.saldo_tras - masAntiguo.monto  // saldo ANTES del mov más antiguo

  return {
    movimientos: movs,
    metadata: {
      banco: 'Santander',
      cuenta: cuenta ?? 'sin cuenta',
      empresa: empresa ?? 'Outlet de Puertas SpA',
      rut: rut ?? null,
      periodo_desde: toISOmeta(periodoDesde),
      periodo_hasta: toISOmeta(periodoHasta),
      saldo_inicial: saldoInicial,
      saldo_final: saldoFinal,
    },
  }
}

// ── Clasificación automática de movimientos ────────────────────────────────
function clasificarMov(descripcion, tipo) {
  const d = (descripcion ?? '').toUpperCase()
  if (tipo === 'ABONO') {
    if (d.includes('GETNET'))                                         return { cat: 'Getnet',           color: '#1E40AF', bg: '#EFF6FF' }
    if (d.includes('TRANSBANK') || d.includes('WEBPAY'))             return { cat: 'Webpay/Transbank', color: '#4F46E5', bg: '#EEF2FF' }
    if (d.includes('DEPOSITO') || d.includes('DEPÓS'))               return { cat: 'Depósito efectivo',color: '#16A34A', bg: '#F0FDF4' }
    if (d.includes('TRANSF'))                                         return { cat: 'Transferencia',    color: '#D97706', bg: '#FFFBEB' }
    return                                                              { cat: 'Otros ingresos',       color: '#6B7280', bg: '#F9FAFB' }
  } else {
    if (d.includes('TRANSF'))                                         return { cat: 'Transferencia',    color: '#DC2626', bg: '#FEF2F2' }
    if (d.includes('REMUNER') || d.includes('PREVIRED'))             return { cat: 'Remuneraciones',   color: '#7C3AED', bg: '#F5F3FF' }
    if (d.includes('ARREND') || d.includes('ARRIENDO'))              return { cat: 'Arriendo',         color: '#B45309', bg: '#FEF3C7' }
    if (d.includes('CABIFY') || d.includes('UBER') || d.includes('TAXI')) return { cat: 'Transporte', color: '#6B7280', bg: '#F9FAFB' }
    if (d.includes('PROVEED') || d.includes('FACT'))                 return { cat: 'Proveedor',        color: '#0369A1', bg: '#EFF6FF' }
    if (d.includes('IMPUESTO') || d.includes('SII') || d.includes('TGR')) return { cat: 'Impuestos', color: '#BE123C', bg: '#FFF1F2' }
    return                                                              { cat: 'Egreso',               color: '#374151', bg: '#F9FAFB' }
  }
}

// ── Componente principal ────────────────────────────────────────────────────
export function ImportadorMovimientos({ onImportado }) {
  const fileRef   = useRef()
  const [dragOver, setDragOver]   = useState(false)
  const [loading, setLoading]       = useState(false)
  const [analizando, setAnalizando] = useState(false)
  const [preview, setPreview]       = useState(null)   // { movimientos, metadata, file, analisis }
  const [resultado, setResultado]   = useState(null)   // { ok, msg, stats }
  const [tabVista, setTabVista]     = useState('resumen') // resumen | cargos | abonos | duplicados

  // ── Parse + análisis de duplicados contra BD ──
  async function parsear(file) {
    if (!file) return
    setPreview(null); setResultado(null); setTabVista('resumen')
    try {
      const buf = new Uint8Array(await file.arrayBuffer())
      const { movimientos, metadata } = parsearCartolaSantander(buf)

      // Analizar duplicados contra BD antes de mostrar preview
      // Dedup key = fecha + monto + descripcion + saldo (saldo distingue movs legítimos repetidos)
      setAnalizando(true)
      const fechas = [...new Set(movimientos.map(m => m.fecha))]
      const { data: existentes } = await supabase.from('movimientos_bancarios')
        .select('fecha, monto, descripcion, saldo')
        .in('fecha', fechas)
        .not('saldo', 'is', null)
        .limit(5000)
      const setExist = new Set((existentes ?? []).map(e => `${e.fecha}|${e.monto}|${e.descripcion}|${e.saldo}`))

      // Marcar cada movimiento: es_duplicado si ya está EXACTAMENTE igual en BD (mismo saldo incluido)
      const movsMarcados = movimientos.map(m => ({
        ...m,
        es_duplicado: setExist.has(`${m.fecha}|${m.monto}|${m.descripcion}|${m.saldo_tras}`),
      }))

      const nEnBD   = movsMarcados.filter(m => m.es_duplicado).length
      const nNuevos = movsMarcados.length - nEnBD

      setPreview({
        movimientos: movsMarcados,
        metadata,
        file: file.name,
        analisis: { nEnBD, nNuevos, tieneConflicto: nEnBD > 0 },
      })
      if (nEnBD > 0) setTabVista('duplicados')
    } catch (e) {
      setResultado({ ok: false, msg: e instanceof Error ? e.message : String(e) })
    } finally { setAnalizando(false) }
  }

  // ── Confirmar importación ──
  async function confirmar() {
    if (!preview) return
    setLoading(true); setResultado(null)
    try {
      const { movimientos, metadata } = preview

      // 1) Upsert cartola (por cuenta + periodo)
      const cartolaId = crypto.randomUUID()
      const { data: cartolaExist } = await supabase.from('cartolas')
        .select('id').eq('banco', metadata.banco).eq('cuenta', metadata.cuenta)
        .eq('fecha_inicio', metadata.periodo_desde).eq('fecha_fin', metadata.periodo_hasta)
        .maybeSingle()

      let cId = cartolaExist?.id
      if (!cId) {
        cId = cartolaId
        const { error: errC } = await supabase.from('cartolas').insert({
          id: cId,
          banco: metadata.banco,
          cuenta: metadata.cuenta,
          fecha_inicio: metadata.periodo_desde,
          fecha_fin: metadata.periodo_hasta,
          saldo_inicial: metadata.saldo_inicial,
          saldo_final: metadata.saldo_final,
          archivo_origen: preview.file,
        })
        if (errC) throw new Error('Error creando cartola: ' + errC.message)
      } else {
        // Actualizar saldos si ya existe
        await supabase.from('cartolas').update({
          saldo_inicial: metadata.saldo_inicial,
          saldo_final: metadata.saldo_final,
          archivo_origen: preview.file,
        }).eq('id', cId)
      }

      // 2) Detectar duplicados — búsqueda GLOBAL (no solo dentro de esta cartola)
      // Dedup key incluye saldo para distinguir movs legítimos repetidos (ej: 5 transferencias del mismo monto/día)
      const fechas = [...new Set(movimientos.map(m => m.fecha))]
      const { data: existentes } = await supabase.from('movimientos_bancarios')
        .select('fecha, monto, descripcion, saldo')
        .in('fecha', fechas)
        .not('saldo', 'is', null)
        .limit(5000)
      const setExist = new Set((existentes ?? []).map(e => `${e.fecha}|${e.monto}|${e.descripcion}|${e.saldo}`))

      const candidatos = movimientos.filter(m => !setExist.has(`${m.fecha}|${m.monto}|${m.descripcion}|${m.saldo_tras}`))
      const duplicadosEnBD = movimientos.length - candidatos.length

      // 3) Insertar en lotes de 500 — upsert con ignoreDuplicates como red de seguridad
      let insertados = 0, conflictosIndice = 0
      for (let i = 0; i < candidatos.length; i += 500) {
        const lote = candidatos.slice(i, i + 500).map(m => {
          const mes = m.fecha ? Number(m.fecha.slice(5, 7)) : null
          return {
            id: crypto.randomUUID(),
            cartola_id: cId,
            fecha: m.fecha,
            monto: m.monto,
            tipo: m.tipo,
            descripcion: m.descripcion,
            referencia: m.referencia,
            saldo: m.saldo_tras,
            estado: 'pendiente',
            mes_cartola: mes,
            mes_nominal: mes,
          }
        })
        // upsert con ignoreDuplicates: si el índice (fecha+monto+desc+saldo) rechaza alguno, lo ignora
        const { data, error } = await supabase.from('movimientos_bancarios')
          .upsert(lote, { onConflict: 'fecha,monto,descripcion,saldo', ignoreDuplicates: true })
          .select('id')
        if (error) throw new Error('Error insertando movimientos: ' + error.message)
        const insertadosLote = (data ?? []).length
        insertados += insertadosLote
        conflictosIndice += lote.length - insertadosLote
      }
      const duplicados = duplicadosEnBD + conflictosIndice

      setResultado({
        ok: true,
        msg: `✓ ${insertados} movimientos importados · ${duplicados} duplicados ignorados`,
        stats: { insertados, duplicados, cartola_id: cId },
      })
      setPreview(null)
      onImportado?.()
    } catch (e) {
      setResultado({ ok: false, msg: e instanceof Error ? e.message : String(e) })
    } finally { setLoading(false) }
  }

  // ── Métricas del preview ──
  const metricas = useMemo(() => {
    if (!preview) return null
    const m   = preview.movimientos
    const meta = preview.metadata
    const cargos = m.filter(x => x.tipo === 'CARGO')
    const abonos = m.filter(x => x.tipo === 'ABONO')
    const totCargos = cargos.reduce((a, x) => a + x.monto_bruto, 0)
    const totAbonos = abonos.reduce((a, x) => a + x.monto_bruto, 0)
    const variacion = (meta.saldo_final ?? 0) - (meta.saldo_inicial ?? 0)
    // Check matemático: saldo_inicial + abonos - cargos debe = saldo_final
    const checkVal  = (meta.saldo_inicial ?? 0) + totAbonos - totCargos
    const checkOk   = Math.abs(checkVal - (meta.saldo_final ?? 0)) < 2  // tolerancia $2 redondeo

    // Distribución por categoría
    const porCat = {}
    for (const mov of m) {
      const cls = clasificarMov(mov.descripcion, mov.tipo)
      const key = `${mov.tipo}|${cls.cat}`
      if (!porCat[key]) porCat[key] = { tipo: mov.tipo, cat: cls.cat, color: cls.color, bg: cls.bg, n: 0, total: 0 }
      porCat[key].n++; porCat[key].total += mov.monto_bruto
    }
    const cats = Object.values(porCat).sort((a, b) => b.total - a.total)

    return { cargos: cargos.length, abonos: abonos.length, totCargos, totAbonos, variacion, checkOk, checkVal, cats }
  }, [preview])

  const movsFiltrados = useMemo(() => {
    if (!preview) return []
    if (tabVista === 'cargos')      return preview.movimientos.filter(m => m.tipo === 'CARGO')
    if (tabVista === 'abonos')      return preview.movimientos.filter(m => m.tipo === 'ABONO')
    if (tabVista === 'duplicados')  return preview.movimientos.filter(m => m.es_duplicado)
    return preview.movimientos
  }, [preview, tabVista])

  // ── Estilos ──
  const cardSt  = { background: '#fff', borderRadius: 12, padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }
  const btnSt   = bg => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', background: bg, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' })
  const btnOutS = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
  const TH = { padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', background: '#F8FAFC', whiteSpace: 'nowrap', position: 'sticky', top: 0 }
  const TD = { padding: '7px 10px', fontSize: 12, color: '#334155', verticalAlign: 'middle' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Zona de carga ── */}
      <div style={cardSt}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 4 }}>
          Importar Cartola Bancaria — Vista Auditoría
        </div>
        <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 14 }}>
          Descarga desde <strong>Banco Santander Empresas</strong> → Cuentas → Cartola histórica → Exportar Excel.
          Se importan <strong>todos los movimientos</strong> (cargos y abonos) con saldo inicial/final para auditoría completa.
        </div>
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); parsear(e.dataTransfer.files[0]) }}
          onClick={() => !loading && fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? '#2563EB' : '#D1D5DB'}`,
            borderRadius: 10, padding: '28px 20px', textAlign: 'center',
            cursor: loading ? 'wait' : 'pointer',
            background: dragOver ? '#EFF6FF' : '#FAFAFA', transition: 'all 0.2s',
          }}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
            onChange={e => { parsear(e.target.files?.[0]); e.target.value = '' }} />
          {loading || analizando
            ? <><Loader2 size={22} style={{ display: 'inline-block', color: '#2563EB' }} />
                <div style={{ marginTop: 8, fontSize: 12, color: '#6B7280' }}>
                  {analizando ? 'Analizando duplicados…' : 'Importando…'}
                </div>
              </>
            : <>
                <Upload size={22} color="#9CA3AF" />
                <div style={{ marginTop: 8, fontSize: 13, color: '#6B7280', fontWeight: 500 }}>
                  Arrastra la cartola Santander o haz clic
                </div>
                <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>.xlsx · .xls</div>
              </>
          }
        </div>

        {resultado && (
          <div style={{
            marginTop: 12, padding: '10px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
            background: resultado.ok ? '#DCFCE7' : '#FEE2E2',
            color: resultado.ok ? '#166534' : '#991B1B',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            {resultado.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            {resultado.msg}
          </div>
        )}
      </div>

      {/* ── Preview: Encabezado de auditoría ── */}
      {preview && metricas && (
        <>
          {/* Header cartola */}
          <div style={{ ...cardSt, background: 'linear-gradient(135deg, #1E3A5F, #1E40AF)', color: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                  Cartola Bancaria — Auditoría
                </div>
                <div style={{ fontSize: 17, fontWeight: 700 }}>{preview.metadata.empresa ?? 'Outlet de Puertas SpA'}</div>
                <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                  Banco {preview.metadata.banco} · Cuenta {preview.metadata.cuenta}
                </div>
                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
                  Período: {fmtFecha(preview.metadata.periodo_desde)} → {fmtFecha(preview.metadata.periodo_hasta)}
                  · {preview.movimientos.length} movimientos · {preview.file}
                </div>
              </div>

              {/* Check matemático */}
              <div style={{
                background: metricas.checkOk ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
                border: `1px solid ${metricas.checkOk ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)'}`,
                borderRadius: 10, padding: '10px 14px', textAlign: 'center', minWidth: 160,
              }}>
                <div style={{ fontSize: 10, opacity: 0.8, marginBottom: 4, textTransform: 'uppercase' }}>
                  {metricas.checkOk ? '✓ Cuadre matemático' : '⚠ Revisa saldos'}
                </div>
                <div style={{ fontSize: 11, opacity: 0.9 }}>
                  Saldo ini + abonos − cargos
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>
                  {metricas.checkOk ? '= Saldo final ✓' : `Diff: ${fmtCLP(metricas.checkVal - (preview.metadata.saldo_final ?? 0))}`}
                </div>
              </div>
            </div>

            {/* Saldos */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 16 }}>
              {[
                { label: 'Saldo inicial', value: preview.metadata.saldo_inicial, color: '#93C5FD' },
                { label: 'Variación neta', value: metricas.variacion, color: metricas.variacion >= 0 ? '#86EFAC' : '#FCA5A5' },
                { label: 'Saldo final', value: preview.metadata.saldo_final, color: '#93C5FD' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color, marginTop: 4 }}>{fmtCLP(value)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Banner alerta duplicados */}
          {preview.analisis?.tieneConflicto && (
            <div style={{
              background: 'linear-gradient(135deg, #FFFBEB, #FEF3C7)',
              border: '1px solid #F59E0B', borderRadius: 10,
              padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 12,
            }}>
              <AlertTriangle size={18} color="#B45309" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#78350F', marginBottom: 4 }}>
                  {preview.analisis.nEnBD} movimiento{preview.analisis.nEnBD > 1 ? 's' : ''} ya {preview.analisis.nEnBD > 1 ? 'existen' : 'existe'} en la base de datos
                </div>
                <div style={{ fontSize: 12, color: '#92400E', lineHeight: 1.5 }}>
                  Mismos datos exactos (fecha, monto, descripción y saldo) ya importados. Se importarán solo los <strong>{preview.analisis.nNuevos} nuevos</strong> — los duplicados serán ignorados automáticamente.
                  Revisa la pestaña <strong>"Ya en BD ({preview.analisis.nEnBD})"</strong> para ver el detalle.
                </div>
              </div>
            </div>
          )}

          {/* Sin duplicados — confirmación verde */}
          {preview.analisis && !preview.analisis.tieneConflicto && (
            <div style={{
              background: '#F0FDF4', border: '1px solid #86EFAC',
              borderRadius: 10, padding: '10px 16px',
              display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#166534',
            }}>
              <CheckCircle2 size={16} color="#16A34A" />
              <strong>Sin duplicados detectados.</strong>
              <span style={{ color: '#15803D' }}>Los {preview.movimientos.length} movimientos son nuevos y pueden importarse.</span>
            </div>
          )}

          {/* Métricas cargos / abonos */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ ...cardSt, display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ background: '#FEF2F2', borderRadius: 10, padding: 10, flexShrink: 0 }}>
                <TrendingDown size={22} color="#DC2626" />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#991B1B', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cargos (egresos)</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#DC2626' }}>{fmtCLP(metricas.totCargos)}</div>
                <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>{metricas.cargos} movimientos</div>
              </div>
            </div>
            <div style={{ ...cardSt, display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ background: '#F0FDF4', borderRadius: 10, padding: 10, flexShrink: 0 }}>
                <TrendingUp size={22} color="#16A34A" />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#166534', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Abonos (ingresos)</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#16A34A' }}>{fmtCLP(metricas.totAbonos)}</div>
                <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>{metricas.abonos} movimientos</div>
              </div>
            </div>
          </div>

          {/* Distribución por categoría */}
          <div style={cardSt}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 12 }}>
              Distribución por categoría
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {metricas.cats.map(c => (
                <div key={`${c.tipo}|${c.cat}`} style={{
                  background: c.bg, borderRadius: 8, padding: '8px 12px',
                  border: `1px solid ${c.color}22`,
                  display: 'flex', flexDirection: 'column', gap: 2, minWidth: 130,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                      background: c.tipo === 'CARGO' ? '#FEE2E2' : '#DCFCE7',
                      color: c.tipo === 'CARGO' ? '#991B1B' : '#166534' }}>{c.tipo}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: c.color }}>{c.cat}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{fmtCLP(c.total)}</div>
                  <div style={{ fontSize: 10, color: '#6B7280' }}>{c.n} mov.</div>
                </div>
              ))}
            </div>
          </div>

          {/* Tabla detalle */}
          <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
            {/* Barra superior */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              {/* Tabs vista */}
              <div style={{ display: 'flex', gap: 2, background: '#F1F5F9', borderRadius: 8, padding: 3 }}>
                {[
                  { k: 'resumen',    l: `Todos (${preview.movimientos.length})` },
                  { k: 'cargos',     l: `Cargos (${metricas.cargos})` },
                  { k: 'abonos',     l: `Abonos (${metricas.abonos})` },
                  ...(preview.analisis?.nEnBD > 0
                    ? [{ k: 'duplicados', l: `⚠ Ya en BD (${preview.analisis.nEnBD})`, warn: true }]
                    : []),
                ].map(({ k, l, warn }) => (
                  <button key={k} onClick={() => setTabVista(k)} style={{
                    padding: '4px 12px', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    background: tabVista === k ? (warn ? '#FEF3C7' : '#fff') : 'transparent',
                    color: tabVista === k ? (warn ? '#92400E' : '#1E293B') : '#64748B',
                    boxShadow: tabVista === k ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  }}>{l}</button>
                ))}
              </div>
              {/* Acciones */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setPreview(null)} style={btnOutS}>Cancelar</button>
                <button onClick={confirmar} disabled={loading} style={{ ...btnSt('#1E40AF'), opacity: loading ? 0.6 : 1 }}>
                  {loading && <Loader2 size={13} />}
                  {preview.analisis?.nEnBD > 0
                    ? `Importar ${preview.analisis.nNuevos} nuevos (${preview.analisis.nEnBD} ya en BD)`
                    : `Importar ${preview.movimientos.length} movimientos`
                  }
                </button>
              </div>
            </div>

            {/* Nota informativa */}
            <div style={{ padding: '8px 16px', background: '#F0F9FF', borderBottom: '1px solid #E0F2FE', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#0369A1' }}>
              <Info size={13} />
              Los movimientos se importarán con estado <strong>pendiente</strong>. Ve a <strong>Clasificar</strong> para asignar subcuenta y CECO, luego a <strong>Conciliar</strong> para vincular con respaldos.
            </div>

            {/* Tabla */}
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={TH}>Fecha</th>
                    <th style={TH}>Tipo</th>
                    <th style={TH}>Categoría</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Monto</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Saldo tras mov.</th>
                    <th style={TH}>Descripción</th>
                    <th style={TH}>N° Doc</th>
                  </tr>
                </thead>
                <tbody>
                  {movsFiltrados.slice(0, 150).map((m, i) => {
                    const cls = clasificarMov(m.descripcion, m.tipo)
                    const bgRow = m.es_duplicado ? '#FFFBEB' : 'transparent'
                    const bgHover = m.es_duplicado ? '#FEF3C7' : '#F8FAFC'
                    return (
                      <tr key={i}
                        style={{ borderTop: '1px solid #F1F5F9', background: bgRow }}
                        onMouseEnter={e => e.currentTarget.style.background = bgHover}
                        onMouseLeave={e => e.currentTarget.style.background = bgRow}>
                        <td style={TD}>{fmtFecha(m.fecha)}</td>
                        <td style={TD}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <span style={{
                              padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                              background: m.tipo === 'CARGO' ? '#FEE2E2' : '#DCFCE7',
                              color: m.tipo === 'CARGO' ? '#991B1B' : '#166534',
                            }}>{m.tipo}</span>
                            {m.es_duplicado && (
                              <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#FDE68A', color: '#92400E' }}>
                                YA EN BD
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={TD}>
                          <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: cls.bg, color: cls.color }}>
                            {cls.cat}
                          </span>
                        </td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: m.tipo === 'CARGO' ? '#DC2626' : '#16A34A' }}>
                          {m.tipo === 'CARGO' ? '−' : '+'}{fmtCLP(m.monto_bruto)}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#64748B', fontSize: 11 }}>
                          {fmtCLP(m.saldo_tras)}
                        </td>
                        <td style={{ ...TD, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.descripcion}>
                          {m.descripcion}
                        </td>
                        <td style={{ ...TD, color: '#94A3B8', fontFamily: 'monospace', fontSize: 10 }}>
                          {m.referencia ?? '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {movsFiltrados.length > 150 && (
                <div style={{ padding: '10px 16px', textAlign: 'center', fontSize: 11, color: '#94A3B8', borderTop: '1px solid #F1F5F9' }}>
                  Mostrando 150 de {movsFiltrados.length} movimientos — todos se importarán
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
