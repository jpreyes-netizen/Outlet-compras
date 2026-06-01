import { useState, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabase'
import { fmt } from '../../lib/constants'
import { Cd, Bd, Bt, Fl, Sheet, css } from '../../components/UI'
import { toast } from 'sonner'

const SUCURSALES = {
  'suc-la': { l: 'Los Ángeles', c: '#007AFF' },
  'suc-mp': { l: 'Maipú',       c: '#34C759' },
  'suc-lg': { l: 'La Granja',   c: '#FF9500' },
  'dir-adm': { l: 'Dir. Administración y Finanzas', c: '#AF52DE' },
  'dir-com': { l: 'Dir. Comercial',                  c: '#5856D6' },
  'dir-neg': { l: 'Dir. Negocios',                   c: '#FF3B30' },
  'dir-ops': { l: 'Dir. Operaciones',                c: '#5AC8FA' }
}

/* ═══ Normalización ═══ */
const norm = (s) => String(s || '').toLowerCase().trim()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // sin tildes
  .replace(/\s+/g, ' ')

// Mapeo manual de categorías sucias del Excel → nombre canónico
const CAT_ALIASES = {
  'articulos de aseo': 'Artículos de Aseo',
  'articulos de cafeteria': 'Artículos de cafetería',
  'articulos de oficina': 'Artículos de oficina',
  'articulos de ferreteria': 'Artículos de ferretería',
  'articulos de ferreteria ': 'Artículos de ferretería',
  'reparaciones y mantenimientos': 'Reparaciones y mantenimientos',
  'transporte': 'Transporte',
  'gas': 'Gas',
  'alimentacion': 'Alimentación',
  'mensajeria': 'Mensajería',
  'basura': 'Basura',
  'propinas': 'Propinas',
  'estacionamiento': 'Estacionamiento',
  'material de embalaje': 'Material de embalaje',
  'control de plagas': 'Control de plagas',
  'control plagas': 'Control de plagas',
  'notaria': 'Notaría',
  'devoluciones': 'Devoluciones',
  'salud': 'Salud'
}

const TIPOS_DOC_VALIDOS = ['Boleta', 'Factura', 'Ticket', 'Guía', 'Otro', 'Ingreso de dinero']

const normalizarTipoDoc = (s) => {
  const n = norm(s)
  if (!n) return 'Otro'
  if (n.startsWith('ingreso')) return 'Ingreso de dinero'
  if (n.startsWith('bole'))    return 'Boleta'
  if (n.startsWith('fact'))    return 'Factura'
  if (n.startsWith('tick'))    return 'Ticket'
  if (n.startsWith('gui'))     return 'Guía'
  return 'Otro'
}

const normalizarMetodoPago = (s) => {
  const n = norm(s)
  if (!n) return null
  if (n.includes('efec'))     return 'Efectivo'
  if (n.includes('trans'))    return 'Transferencia'
  if (n.includes('debito'))   return 'T. Débito'
  if (n.includes('credito'))  return 'T. Crédito'
  if (n.includes('cheque'))   return 'Cheque'
  return s.trim()
}

/* ═══ Parser de fecha (Excel serial o ISO o "DD-MM-YYYY") ═══ */
const parseFecha = (v) => {
  if (!v) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') {
    // Excel serial
    const d = XLSX.SSF.parse_date_code(v)
    if (!d) return null
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  if (typeof v === 'string') {
    const s = v.trim()
    // ISO YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
    // DD-MM-YYYY o DD/MM/YYYY
    const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return null
}

const parseMonto = (v) => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''))
  return isNaN(n) ? null : Math.round(n)
}

export function GmImportador({ show, onClose, cu, fondos, categorias, onImportado }) {
  const [paso, setPaso]         = useState(1)
  const [fondoId, setFondoId]   = useState('')
  const [archivo, setArchivo]   = useState(null)
  const [filasRaw, setFilasRaw] = useState([])
  const [errores, setErrores]   = useState([])
  const [catMap, setCatMap]     = useState({})           // {nombreExcel: {accion:'existe'|'crear'|'ignorar', categoria_id:uuid}}
  const [duplicados, setDups]   = useState(new Set())    // índices de filas duplicadas
  const [excluir, setExcluir]   = useState(new Set())    // índices marcados para no importar
  const [procesando, setProc]   = useState(false)
  const [progreso, setProg]     = useState(0)

  const reset = () => {
    setPaso(1); setArchivo(null); setFilasRaw([]); setErrores([])
    setCatMap({}); setDups(new Set()); setExcluir(new Set()); setProg(0)
  }
  const cerrar = () => { reset(); onClose() }

  /* ─── PASO 1: parseo del Excel ─── */
  const onArchivo = async (file) => {
    if (!file) return
    setArchivo(file)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: false })

      // Buscar hoja DETALLE (o primera)
      let sn = wb.SheetNames.find(s => norm(s) === 'detalle') || wb.SheetNames[0]
      const ws = wb.Sheets[sn]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

      if (rows.length < 2) {
        toast.error('El Excel está vacío')
        return
      }

      // Mapear columnas por nombre del header
      const header = rows[0].map(h => norm(h))
      const colIdx = {
        fecha:        header.findIndex(h => h.includes('fecha')),
        proveedor:    header.findIndex(h => h.includes('proveedor')),
        tipo_doc:     header.findIndex(h => h.includes('tipo doc')),
        descripcion:  header.findIndex(h => h.includes('descripcion') || h.includes('descripción')),
        tipo_gasto:   header.findIndex(h => h.includes('tipo de gasto')),
        n_documento:  header.findIndex(h => h.includes('documento de respaldo') || h.includes('respaldo')),
        responsable:  header.findIndex(h => h.includes('responsable') || h.includes('comprador')),
        metodo_pago:  header.findIndex(h => h.includes('metodo') || h.includes('método')),
        monto:        header.findIndex(h => h.includes('monto')),
        enlace:       header.findIndex(h => h.includes('enlace') || h.includes('url') || h.includes('link'))
      }

      if (colIdx.fecha < 0 || colIdx.monto < 0) {
        toast.error('No se encontraron columnas requeridas (Fecha, Monto)')
        return
      }

      // Parsear filas
      const errs = []
      const filas = []
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i]
        if (!r || r.every(c => c == null || c === '')) continue // fila vacía

        const fecha    = parseFecha(r[colIdx.fecha])
        const monto    = parseMonto(r[colIdx.monto])
        const tipoDocRaw = r[colIdx.tipo_doc]
        const tipoDoc  = normalizarTipoDoc(tipoDocRaw)
        const tipo     = tipoDoc === 'Ingreso de dinero' ? 'ingreso' : 'gasto'

        if (!fecha) { errs.push({ fila: i + 1, msg: 'Fecha inválida' }); continue }
        if (!monto || monto <= 0) { errs.push({ fila: i + 1, msg: `Monto inválido (${r[colIdx.monto]})` }); continue }

        filas.push({
          excelRow: i + 1,
          fecha,
          tipo,
          proveedor: r[colIdx.proveedor] ? String(r[colIdx.proveedor]).trim() : null,
          tipo_doc: tipoDoc,
          descripcion: r[colIdx.descripcion] ? String(r[colIdx.descripcion]).trim() : null,
          tipo_gasto_raw: r[colIdx.tipo_gasto] ? String(r[colIdx.tipo_gasto]).trim() : '',
          n_documento: r[colIdx.n_documento] != null ? String(r[colIdx.n_documento]).trim() : null,
          responsable: r[colIdx.responsable] ? String(r[colIdx.responsable]).trim() : null,
          metodo_pago: normalizarMetodoPago(r[colIdx.metodo_pago]),
          monto,
          url_respaldo: r[colIdx.enlace] && String(r[colIdx.enlace]).startsWith('http')
            ? String(r[colIdx.enlace]).trim() : null,
          observaciones: r[colIdx.enlace] && !String(r[colIdx.enlace] || '').startsWith('http')
            ? String(r[colIdx.enlace]).trim() : null
        })
      }

      setFilasRaw(filas)
      setErrores(errs)

      // Pre-procesar mapping de categorías
      const cats = {}
      filas.filter(f => f.tipo === 'gasto').forEach(f => {
        const raw = f.tipo_gasto_raw
        if (!raw) return
        if (cats[raw]) return
        const n = norm(raw)
        // Match exacto contra catálogo existente
        const matchExacto = categorias.find(c => norm(c.nombre) === n)
        if (matchExacto) {
          cats[raw] = { accion: 'existe', categoria_id: matchExacto.id, nombre: matchExacto.nombre }
          return
        }
        // Match contra alias
        if (CAT_ALIASES[n]) {
          const nombreCanon = CAT_ALIASES[n]
          const cat = categorias.find(c => c.nombre === nombreCanon)
          if (cat) {
            cats[raw] = { accion: 'existe', categoria_id: cat.id, nombre: cat.nombre, viaAlias: true }
          } else {
            cats[raw] = { accion: 'crear', nombre: nombreCanon }
          }
          return
        }
        // "consumo" como tipo de gasto → ignorar (es el valor de "tipo doc" mal usado)
        if (n === 'consumo' || n === '') {
          cats[raw] = { accion: 'ignorar' }
          return
        }
        // Categoría nueva
        cats[raw] = { accion: 'crear', nombre: raw }
      })
      setCatMap(cats)

      // Detectar duplicados contra DB
      await detectarDuplicados(filas)

      setPaso(2)
    } catch (e) {
      console.error(e)
      toast.error('Error al leer Excel: ' + e.message)
    }
  }

  const detectarDuplicados = async (filas) => {
    if (!fondoId || filas.length === 0) return
    try {
      // Traer movimientos existentes del fondo
      const { data: existentes } = await supabase
        .from('gm_movimientos')
        .select('fecha, monto, proveedor')
        .eq('fondo_id', fondoId)

      const dups = new Set()
      const exc = new Set()
      const key = (f, m, p) => `${f}|${m}|${(p || '').toLowerCase().trim()}`
      const setExist = new Set((existentes || []).map(e => key(e.fecha, e.monto, e.proveedor)))

      filas.forEach((f, idx) => {
        if (setExist.has(key(f.fecha, f.monto, f.proveedor))) {
          dups.add(idx)
          exc.add(idx) // default: excluidos
        }
      })
      setDups(dups)
      setExcluir(exc)
    } catch (e) {
      console.error('Error detectando duplicados:', e)
    }
  }

  const toggleCategoria = (raw, accion) => {
    setCatMap(prev => ({ ...prev, [raw]: { ...prev[raw], accion } }))
  }
  const setCategoriaExiste = (raw, categoria_id) => {
    const cat = categorias.find(c => c.id === categoria_id)
    setCatMap(prev => ({ ...prev, [raw]: { accion: 'existe', categoria_id, nombre: cat?.nombre } }))
  }
  const toggleExcluir = (idx) => {
    setExcluir(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })
  }

  /* ─── Resumen pre-importación ─── */
  const resumen = useMemo(() => {
    const aImportar = filasRaw.filter((_, i) => !excluir.has(i))
    const catsACrear = Object.values(catMap).filter(c => c.accion === 'crear')
    const ingresos = aImportar.filter(f => f.tipo === 'ingreso').length
    const gastos = aImportar.filter(f => f.tipo === 'gasto').length
    const totalIngreso = aImportar.filter(f => f.tipo === 'ingreso').reduce((s, f) => s + f.monto, 0)
    const totalGasto = aImportar.filter(f => f.tipo === 'gasto').reduce((s, f) => s + f.monto, 0)
    return {
      total: aImportar.length,
      omitidos: excluir.size,
      duplicados: duplicados.size,
      catsACrear: catsACrear.length,
      ingresos, gastos, totalIngreso, totalGasto,
      saldoNeto: totalIngreso - totalGasto
    }
  }, [filasRaw, excluir, duplicados, catMap])

  /* ─── PASO 5: ejecución ─── */
  const ejecutarImportacion = async () => {
    if (!fondoId) { toast.error('Selecciona un fondo'); return }
    setProc(true); setProg(0)

    try {
      // 1) Crear categorías nuevas
      const catsACrear = Object.entries(catMap).filter(([_, v]) => v.accion === 'crear')
      const catIdxByName = {} // nombreOriginal del Excel → categoria_id
      Object.entries(catMap).forEach(([raw, v]) => {
        if (v.accion === 'existe') catIdxByName[raw] = v.categoria_id
      })

      if (catsACrear.length > 0) {
        const nuevas = catsACrear.map(([_, v], i) => ({
          nombre: v.nombre,
          orden: 200 + i,
          activo: true
        }))
        const { data: created, error } = await supabase
          .from('gm_categorias')
          .insert(nuevas)
          .select('id, nombre')
        if (error) throw error
        catsACrear.forEach(([raw, v]) => {
          const cat = (created || []).find(c => c.nombre === v.nombre)
          if (cat) catIdxByName[raw] = cat.id
        })
      }

      // 2) Preparar filas a insertar (ordenar por fecha + excelRow para mantener secuencia)
      const aImportar = filasRaw
        .map((f, i) => ({ ...f, _idx: i }))
        .filter(f => !excluir.has(f._idx))
        .sort((a, b) => {
          if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1
          return a.excelRow - b.excelRow
        })

      // Calcular saldo_post acumulativo (parte del saldo actual del fondo)
      const fondo = fondos.find(f => f.id === fondoId)
      let saldoAcum = fondo?.saldo_actual || 0

      const registros = aImportar.map(f => {
        const delta = f.tipo === 'ingreso' ? f.monto : -f.monto
        saldoAcum += delta
        return {
          fondo_id: fondoId,
          fecha: f.fecha,
          tipo: f.tipo,
          proveedor: f.proveedor,
          tipo_doc: f.tipo_doc,
          descripcion: f.descripcion,
          categoria_id: f.tipo === 'gasto' ? (catIdxByName[f.tipo_gasto_raw] || null) : null,
          n_documento: f.n_documento,
          responsable_nombre: f.responsable,
          metodo_pago: f.metodo_pago,
          monto: f.monto,
          saldo_post: saldoAcum,
          url_respaldo: f.url_respaldo,
          observaciones: f.observaciones,
          origen: 'migracion',
          created_by: cu?.id || null
        }
      })

      // 3) Insertar en batches de 50
      const BATCH = 50
      for (let i = 0; i < registros.length; i += BATCH) {
        const slice = registros.slice(i, i + BATCH)
        const { error } = await supabase.from('gm_movimientos').insert(slice)
        if (error) throw error
        setProg(Math.round(((i + slice.length) / registros.length) * 100))
      }

      // 4) Actualizar saldo del fondo (saldoAcum es el saldo final esperado)
      const { error: e2 } = await supabase
        .from('gm_fondos')
        .update({ saldo_actual: saldoAcum, updated_at: new Date().toISOString() })
        .eq('id', fondoId)
      if (e2) throw e2

      toast.success(`Importación completa: ${registros.length} movimientos. Saldo final: ${fmt(saldoAcum)}`)
      onImportado && onImportado()
      cerrar()
    } catch (e) {
      console.error(e)
      toast.error('Error en importación: ' + (e.message || 'desconocido'))
    } finally {
      setProc(false)
    }
  }

  /* ─── RENDER ─── */
  return (
    <Sheet show={show} onClose={cerrar} title="Importar movimientos desde Excel">
      {/* PASO 1: seleccionar fondo y archivo */}
      {paso === 1 && (
        <div>
          <Fl l="Fondo destino" req>
            <select value={fondoId} onChange={e => setFondoId(e.target.value)} style={css.select}>
              <option value="">— Selecciona —</option>
              {fondos.map(f => {
                const suc = SUCURSALES[f.sucursal_id]
                return <option key={f.id} value={f.id}>{suc?.l || f.sucursal_id} ({fmt(f.saldo_actual)})</option>
              })}
            </select>
          </Fl>

          <div style={{
            border: "2px dashed #C7C7CC", borderRadius: 12,
            padding: 30, textAlign: "center", marginTop: 10,
            background: "#F2F2F7"
          }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>📂</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
              Selecciona el archivo Excel
            </div>
            <div style={{ fontSize: 12, color: "#8E8E93", marginBottom: 12 }}>
              Formato esperado: hoja "DETALLE" con columnas Fecha, Proveedor, Tipo doc, Monto...
            </div>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={e => onArchivo(e.target.files?.[0])}
              disabled={!fondoId}
              style={{ marginTop: 8 }}
            />
            {!fondoId && (
              <div style={{ fontSize: 11, color: "#FF3B30", marginTop: 8 }}>
                Selecciona un fondo primero
              </div>
            )}
          </div>
        </div>
      )}

      {/* PASO 2: revisión */}
      {paso === 2 && (
        <div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            <Bd c="#1C1C1E" bg="#F2F2F7">📄 {archivo?.name}</Bd>
            <Bd c="#34C759" bg="#34C75915">{filasRaw.length} filas válidas</Bd>
            {errores.length > 0 && <Bd c="#FF3B30" bg="#FF3B3015">{errores.length} con errores</Bd>}
            {duplicados.size > 0 && <Bd c="#FF9500" bg="#FF950015">{duplicados.size} duplicados</Bd>}
          </div>

          {/* Errores */}
          {errores.length > 0 && (
            <Cd>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#FF3B30" }}>
                Filas con errores (se omitirán)
              </div>
              <div style={{ maxHeight: 100, overflow: "auto", fontSize: 11, color: "#8E8E93" }}>
                {errores.slice(0, 10).map((e, i) => (
                  <div key={i}>Fila {e.fila}: {e.msg}</div>
                ))}
                {errores.length > 10 && <div>... y {errores.length - 10} más</div>}
              </div>
            </Cd>
          )}

          {/* Mapping de categorías */}
          <Cd>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
              Categorías detectadas
            </div>
            <div style={{ maxHeight: 200, overflow: "auto" }}>
              {Object.entries(catMap).map(([raw, v]) => (
                <div key={raw} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 0", borderBottom: "1px solid #F2F2F7", fontSize: 12
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{raw || '(vacío)'}</div>
                    {v.viaAlias && <div style={{ fontSize: 10, color: "#8E8E93" }}>→ {v.nombre}</div>}
                  </div>
                  <select
                    value={v.accion}
                    onChange={e => toggleCategoria(raw, e.target.value)}
                    style={{ ...css.select, width: 110, padding: "4px 8px", fontSize: 11 }}
                  >
                    <option value="existe">Mapear</option>
                    <option value="crear">Crear nueva</option>
                    <option value="ignorar">Ignorar</option>
                  </select>
                  {v.accion === 'existe' && (
                    <select
                      value={v.categoria_id || ''}
                      onChange={e => setCategoriaExiste(raw, e.target.value)}
                      style={{ ...css.select, width: 160, padding: "4px 8px", fontSize: 11 }}
                    >
                      <option value="">—</option>
                      {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                  )}
                  {v.accion === 'crear' && (
                    <Bd c="#34C759" bg="#34C75915">+ {v.nombre}</Bd>
                  )}
                </div>
              ))}
            </div>
          </Cd>

          {/* Preview filas */}
          <Cd>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Vista previa de filas</div>
              <div style={{ fontSize: 11, color: "#8E8E93" }}>
                {filasRaw.length - excluir.size} de {filasRaw.length} a importar
              </div>
            </div>
            <div style={{ maxHeight: 260, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead style={{ position: "sticky", top: 0, background: "#fff" }}>
                  <tr style={{ borderBottom: "2px solid #E5E5EA" }}>
                    <th style={{ padding: 6, textAlign: "left" }}>✓</th>
                    <th style={{ padding: 6, textAlign: "left" }}>Fecha</th>
                    <th style={{ padding: 6, textAlign: "left" }}>Tipo</th>
                    <th style={{ padding: 6, textAlign: "left" }}>Proveedor / Desc.</th>
                    <th style={{ padding: 6, textAlign: "right" }}>Monto</th>
                    <th style={{ padding: 6 }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filasRaw.map((f, idx) => {
                    const esDup = duplicados.has(idx)
                    const excluido = excluir.has(idx)
                    return (
                      <tr key={idx} style={{ borderBottom: "1px solid #F2F2F7", opacity: excluido ? 0.4 : 1 }}>
                        <td style={{ padding: 6 }}>
                          <input
                            type="checkbox"
                            checked={!excluido}
                            onChange={() => toggleExcluir(idx)}
                          />
                        </td>
                        <td style={{ padding: 6 }}>{f.fecha}</td>
                        <td style={{ padding: 6 }}>
                          {f.tipo === 'ingreso'
                            ? <Bd c="#34C759" bg="#34C75915">↑</Bd>
                            : <Bd c="#FF3B30" bg="#FF3B3015">↓</Bd>}
                        </td>
                        <td style={{ padding: 6, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {f.proveedor || f.descripcion || '—'}
                        </td>
                        <td style={{ padding: 6, textAlign: "right", fontWeight: 600 }}>{fmt(f.monto)}</td>
                        <td style={{ padding: 6 }}>
                          {esDup && <Bd c="#FF9500" bg="#FF950015">Dup</Bd>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Cd>

          {/* Resumen */}
          <Cd>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Resumen</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12 }}>
              <div>📥 A importar: <b>{resumen.total}</b></div>
              <div>🚫 Omitidos: <b>{resumen.omitidos}</b></div>
              <div>↑ Ingresos: <b>{resumen.ingresos}</b> ({fmt(resumen.totalIngreso)})</div>
              <div>↓ Gastos: <b>{resumen.gastos}</b> ({fmt(resumen.totalGasto)})</div>
              <div>🆕 Categorías nuevas: <b>{resumen.catsACrear}</b></div>
              <div>Δ Saldo neto: <b style={{ color: resumen.saldoNeto < 0 ? "#FF3B30" : "#34C759" }}>{fmt(resumen.saldoNeto)}</b></div>
            </div>
          </Cd>

          {procesando && (
            <Cd>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Importando... {progreso}%</div>
              <div style={{ height: 8, background: "#E5E5EA", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${progreso}%`, background: "#34C759", transition: "width 0.3s" }} />
              </div>
            </Cd>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <Bt v="secondary" onClick={cerrar} dis={procesando}>Cancelar</Bt>
            <Bt v="secondary" onClick={() => { setPaso(1); setFilasRaw([]); setErrores([]) }} dis={procesando}>← Atrás</Bt>
            <Bt v="primary" onClick={ejecutarImportacion} dis={procesando || resumen.total === 0}>
              {procesando ? `Importando ${progreso}%...` : `Importar ${resumen.total} movimientos`}
            </Bt>
          </div>
        </div>
      )}
    </Sheet>
  )
}
