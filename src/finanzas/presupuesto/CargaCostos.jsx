import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { toast } from 'sonner'
import { Save, RefreshCw } from 'lucide-react'

/* ═══ CARGA COSTOS ═══
   Panel para cargar el COSTO_NETO mensual de forma masiva.
   Guarda en eerr_ajustes_manuales (mismo mecanismo que Comisión Getnet).
   Solo accesible para roles con permiso de edición.
*/

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const ANIOS = [2024, 2025, 2026]
const ROLES_EDIT = ['admin', 'admin_sistema', 'contabilidad', 'jefe_admin_finanzas', 'gerente_admin_finanzas']

const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)

export function CargaCostos({ cu }) {
  const [anio, setAnio] = useState(new Date().getFullYear())
  const [valores, setValores] = useState(Array(12).fill(''))  // strings para input
  const [originales, setOriginales] = useState(Array(12).fill(null))  // null si no cargado, número si cargado
  const [ventas, setVentas] = useState(Array(12).fill(0))
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const [costoNetoId, setCostoNetoId] = useState(null)
  const [userId, setUserId] = useState(null)
  const [rol, setRol] = useState(null)

  useEffect(() => {
    cargar()
  }, [anio])

  async function cargar() {
    setLoading(true); setError(null)
    try {
      const [linR, ajR, venR, userR] = await Promise.all([
        supabase.from('eerr_lineas').select('id, codigo').eq('codigo', 'COSTO_NETO').maybeSingle(),
        supabase.from('eerr_ajustes_manuales').select('mes, monto').eq('anio', anio).is('sucursal_id', null),
        supabase.from('ventas_bsale_dia').select('fecha, total_venta').gte('fecha', `${anio}-01-01`).lte('fecha', `${anio}-12-31`),
        supabase.auth.getUser(),
      ])
      if (linR.error) throw linR.error
      const cnId = linR.data?.id
      setCostoNetoId(cnId)

      const uid = userR.data.user?.id ?? null
      setUserId(uid)
      if (uid) {
        const { data: u } = await supabase.from('usuarios').select('rol').eq('id', uid).maybeSingle()
        setRol(u?.rol ?? null)
      }

      // Cargar ajustes COSTO_NETO
      const valsArr = Array(12).fill('')
      const origArr = Array(12).fill(null)
      ;(ajR.data ?? []).forEach(a => {
        // Necesito filtrar por eerr_linea_id = cnId (la query no filtra para conservar otras posibles funcionalidades)
        // OJO: como traje todos los ajustes del año, hay que filtrar acá por línea
      })
      // Refetch puntual solo COSTO_NETO para asegurar
      if (cnId) {
        const { data: ajCN } = await supabase
          .from('eerr_ajustes_manuales')
          .select('mes, monto')
          .eq('anio', anio)
          .eq('eerr_linea_id', cnId)
          .is('sucursal_id', null)
        ;(ajCN ?? []).forEach(a => {
          if (a.mes >= 1 && a.mes <= 12) {
            valsArr[a.mes - 1] = String(Math.round(Number(a.monto ?? 0)))
            origArr[a.mes - 1] = Number(a.monto ?? 0)
          }
        })
      }
      setValores(valsArr)
      setOriginales(origArr)

      // Ventas brutas por mes (para mostrar referencia)
      const ventArr = Array(12).fill(0)
      ;(venR.data ?? []).forEach(v => {
        const m = new Date(v.fecha).getUTCMonth()
        ventArr[m] += Number(v.total_venta ?? 0)
      })
      setVentas(ventArr)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const puedeEditar = rol && ROLES_EDIT.includes(rol)

  async function guardarTodos() {
    if (!costoNetoId || !userId) { toast.error('Falta id de COSTO_NETO o usuario'); return }
    setGuardando(true)
    try {
      const toUpsert = []
      valores.forEach((v, i) => {
        const valNum = Number(v)
        const orig = originales[i]
        // Solo upsert si cambió respecto al original
        if (v !== '' && !isNaN(valNum) && valNum !== orig) {
          toUpsert.push({
            eerr_linea_id: costoNetoId,
            sucursal_id: null,
            anio,
            mes: i + 1,
            monto: valNum,
            usuario_id: userId,
          })
        }
      })
      if (toUpsert.length === 0) {
        toast.info('Sin cambios para guardar')
        return
      }
      const { error } = await supabase
        .from('eerr_ajustes_manuales')
        .upsert(toUpsert, { onConflict: 'eerr_linea_id,sucursal_id,anio,mes' })
      if (error) throw error
      toast.success(`Guardados ${toUpsert.length} mes(es) de costo`)
      await cargar()
    } catch (e) {
      toast.error('Error: ' + e.message)
    } finally {
      setGuardando(false)
    }
  }

  const handleChange = (i, val) => {
    const limpio = val.replace(/[^0-9-]/g, '')
    setValores(prev => { const next = [...prev]; next[i] = limpio; return next })
  }

  const selectSt = { padding: '6px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 12, background: '#fff' }
  const btnSt = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, border: '1px solid #D1D5DB', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#374151' }
  const TH = { padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#6B7280', background: '#F9FAFB', whiteSpace: 'nowrap' }
  const TD = { padding: '8px 10px', fontSize: 12 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Controles */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }}>Año</label>
          <select style={selectSt} value={String(anio)} onChange={e => setAnio(Number(e.target.value))}>
            {ANIOS.map(a => <option key={a} value={String(a)}>{a}</option>)}
          </select>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => cargar()} disabled={loading} style={btnSt}>
            <RefreshCw size={13} /> Recargar
          </button>
          {puedeEditar && (
            <button
              onClick={guardarTodos}
              disabled={guardando || loading}
              style={{ ...btnSt, background: '#15803D', color: '#fff', border: 'none', opacity: guardando ? 0.6 : 1 }}
            >
              <Save size={13} /> {guardando ? 'Guardando...' : 'Guardar cambios'}
            </button>
          )}
        </div>
      </div>

      {!puedeEditar && (
        <div style={{ borderRadius: 8, border: '1px solid #FECACA', background: '#FEF2F2', padding: '10px 14px', fontSize: 12, color: '#B91C1C' }}>
          <b>Modo lectura.</b> Tu rol no tiene permiso de edición. Solo los roles {ROLES_EDIT.join(', ')} pueden modificar costos.
        </div>
      )}

      <div style={{ borderRadius: 8, border: '1px solid #BFDBFE', background: '#EFF6FF', padding: '10px 14px', fontSize: 12, color: '#1E40AF', lineHeight: 1.5 }}>
        <b>Carga manual de COSTO_NETO.</b> Ingresa el costo de ventas neto (sin IVA) mes a mes. Se guarda en <code>eerr_ajustes_manuales</code> y alimenta directamente el EERR, el Dashboard EERR y el módulo Presupuesto. Si dejas un mes vacío, esa cifra no se cargará (el EERR mostrará "—" o $0 según corresponda).
      </div>

      {error && <div style={{ borderRadius: 8, border: '1px solid #FECACA', background: '#FEF2F2', padding: '10px 14px', fontSize: 13, color: '#DC2626' }}>Error: {error}</div>}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Array.from({ length: 12 }).map((_, i) => <div key={i} style={{ height: 40, background: '#F3F4F6', borderRadius: 6 }} />)}
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
                <th style={{ ...TH }}>Mes</th>
                <th style={{ ...TH, textAlign: 'right' }}>Venta Bruta (ref.)</th>
                <th style={{ ...TH, textAlign: 'right' }}>Costo Neto cargado</th>
                <th style={{ ...TH, textAlign: 'right' }}>% sobre Venta Neta</th>
                <th style={{ ...TH, textAlign: 'left', width: 200 }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {MESES.map((mes, i) => {
                const valNum = Number(valores[i])
                const ventaNeta = ventas[i] / 1.19
                const pct = (!isNaN(valNum) && ventaNeta > 0 && valores[i] !== '') ? (valNum / ventaNeta) * 100 : null
                const cargado = originales[i] !== null
                const modificado = valores[i] !== '' && Number(valores[i]) !== originales[i]
                return (
                  <tr key={mes} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ ...TD, fontWeight: 500, color: '#111827' }}>{mes}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#6B7280' }}>{fmtCLP(ventas[i])}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={valores[i]}
                        onChange={e => handleChange(i, e.target.value)}
                        disabled={!puedeEditar}
                        placeholder="Sin cargar"
                        style={{
                          width: 130, padding: '5px 8px',
                          borderRadius: 6,
                          border: `1px solid ${modificado ? '#3B82F6' : '#D1D5DB'}`,
                          background: puedeEditar ? '#fff' : '#F9FAFB',
                          textAlign: 'right',
                          fontFamily: 'monospace',
                          fontSize: 12,
                        }}
                      />
                    </td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: pct === null ? '#D1D5DB' : (pct > 65 ? '#B91C1C' : pct > 55 ? '#B45309' : '#047857'), fontWeight: 500 }}>
                      {pct !== null ? `${pct.toFixed(1)}%` : '—'}
                    </td>
                    <td style={{ ...TD }}>
                      {modificado ? (
                        <span style={{ fontSize: 10, fontWeight: 700, background: '#DBEAFE', color: '#1E40AF', padding: '2px 7px', borderRadius: 4, letterSpacing: '0.04em' }}>MODIFICADO</span>
                      ) : cargado ? (
                        <span style={{ fontSize: 10, fontWeight: 700, background: '#DCFCE7', color: '#15803D', padding: '2px 7px', borderRadius: 4, letterSpacing: '0.04em' }}>CARGADO</span>
                      ) : (
                        <span style={{ fontSize: 10, fontWeight: 700, background: '#F3F4F6', color: '#6B7280', padding: '2px 7px', borderRadius: 4, letterSpacing: '0.04em' }}>PENDIENTE</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {/* Total */}
              {(() => {
                const totalCosto = valores.reduce((s, v) => s + (v !== '' && !isNaN(Number(v)) ? Number(v) : 0), 0)
                const totalVentaNeta = ventas.reduce((s, v) => s + v / 1.19, 0)
                const pctTotal = totalVentaNeta > 0 ? (totalCosto / totalVentaNeta) * 100 : null
                return (
                  <tr style={{ background: '#F9FAFB', borderTop: '2px solid #E5E7EB' }}>
                    <td style={{ ...TD, fontWeight: 700 }}>TOTAL AÑO</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#6B7280' }}>{fmtCLP(ventas.reduce((s, v) => s + v, 0))}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{fmtCLP(totalCosto)}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: pctTotal === null ? '#D1D5DB' : (pctTotal > 65 ? '#B91C1C' : pctTotal > 55 ? '#B45309' : '#047857') }}>
                      {pctTotal !== null ? `${pctTotal.toFixed(1)}%` : '—'}
                    </td>
                    <td style={{ ...TD }}></td>
                  </tr>
                )
              })()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
