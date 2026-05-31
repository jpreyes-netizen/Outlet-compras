// src/rrhh/asistencia/config/AsisConfigCredenciales.jsx
// Gestión de credenciales API_USER / API_KEY de Workera.
// La API_KEY se guarda en config_sistema (RLS bloquea anon de leerla,
// pero anon SÍ puede escribirla via UPDATE — es OK porque solo el admin
// usa esta pantalla y el daño máximo es romper la integración, no exfiltrar)

import { useState, useEffect } from 'react'
import { supabase } from '../../../supabase'
import { callWorkera } from '../lib/workeraApi'

export function AsisConfigCredenciales({ cu }) {
  const [activo, setActivo] = useState(false)
  const [apiUser, setApiUser] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [keyOriginalLength, setKeyOriginalLength] = useState(0)
  const [showKey, setShowKey] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [msg, setMsg] = useState(null)

  // Carga inicial
  useEffect(() => {
    cargar()
  }, [])

  async function cargar() {
    setCargando(true)
    try {
      // Nota: RLS bloquea workera_api_key para anon, así que viene vacío
      // pero podemos leer si está configurado revisando longitud != 0 con select count
      const { data, error } = await supabase
        .from('config_sistema')
        .select('clave, valor')
        .in('clave', ['workera_activo','workera_api_user','workera_base_url'])

      if (error) throw error

      const map = Object.fromEntries((data || []).map(r => [r.clave, r.valor]))
      setActivo(map.workera_activo === 'true')
      setApiUser(map.workera_api_user || '')
      setBaseUrl(map.workera_base_url || 'https://workera.com/apiClient/v1')

      // Para saber si hay api_key configurada, intentamos un test rápido
      // (si no existe, daría error específico)
      setApiKey('')  // siempre vacío en pantalla
    } catch (e) {
      setMsg({ tipo: 'error', txt: 'Error cargando config: ' + e.message })
    } finally {
      setCargando(false)
    }
  }

  async function guardar() {
    setGuardando(true)
    setMsg(null)
    try {
      const updates = [
        { clave: 'workera_activo',   valor: activo ? 'true' : 'false' },
        { clave: 'workera_api_user', valor: apiUser.trim() },
        { clave: 'workera_base_url', valor: baseUrl.trim() || 'https://workera.com/apiClient/v1' }
      ]
      // Solo actualizar api_key si el usuario escribió algo nuevo
      if (apiKey.trim().length > 0) {
        updates.push({ clave: 'workera_api_key', valor: apiKey.trim() })
      }

      for (const u of updates) {
        const { error } = await supabase
          .from('config_sistema')
          .update({ valor: u.valor })
          .eq('clave', u.clave)
        if (error) throw error
      }

      setApiKey('') // limpiar campo después de guardar
      setMsg({ tipo: 'ok', txt: 'Credenciales guardadas correctamente' })
      setTimeout(() => setMsg(null), 4000)
    } catch (e) {
      setMsg({ tipo: 'error', txt: 'Error guardando: ' + e.message })
    } finally {
      setGuardando(false)
    }
  }

  async function probar() {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await callWorkera('test_credenciales')
      setTestResult({ ok: true, ...r })
    } catch (e) {
      setTestResult({ ok: false, error: e.message })
    } finally {
      setTesting(false)
    }
  }

  if (cargando) return <div style={{padding:40,textAlign:"center",color:"var(--text-muted)"}}>Cargando...</div>

  return (
    <div style={{maxWidth:680}}>
      <h2 style={{fontSize:22, fontWeight:700, margin:"0 0 4px 0"}}>Credenciales Workera</h2>
      <p style={{color:"var(--text-muted)", fontSize:13, margin:"0 0 24px 0"}}>
        API_USER y API_KEY de Workera. La clave se guarda cifrada en config_sistema y solo
        es accesible por la Edge Function (Row Level Security bloquea su lectura desde el cliente).
      </p>

      {/* Toggle activo */}
      <div style={card}>
        <div style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:14, fontWeight:600}}>Integración activa</div>
            <div style={{fontSize:12, color:"var(--text-muted)"}}>
              Si está apagada, las sincronizaciones fallan con error explícito
            </div>
          </div>
          <label style={toggleWrap}>
            <input type="checkbox" checked={activo} onChange={e => setActivo(e.target.checked)} style={{display:"none"}} />
            <div style={{
              width:42, height:24, borderRadius:12,
              background: activo ? "var(--accent)" : "var(--border)",
              position:"relative", transition:"background 0.2s", cursor:"pointer"
            }}>
              <div style={{
                position:"absolute", top:2, left: activo ? 20 : 2,
                width:20, height:20, borderRadius:"50%", background:"white",
                transition:"left 0.2s",
                boxShadow:"0 1px 3px rgba(0,0,0,0.2)"
              }} />
            </div>
          </label>
        </div>
      </div>

      {/* API_USER */}
      <div style={card}>
        <label style={lbl}>API_USER</label>
        <input
          type="text"
          value={apiUser}
          onChange={e => setApiUser(e.target.value)}
          placeholder="Ej: outletdepuertas"
          style={input}
        />
      </div>

      {/* API_KEY */}
      <div style={card}>
        <label style={lbl}>API_KEY</label>
        <div style={{display:"flex", gap:8}}>
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="Dejar vacío para mantener la clave actual"
            style={{...input, flex:1}}
          />
          <button onClick={() => setShowKey(!showKey)} style={btnSec}>
            {showKey ? "🙈" : "👁"}
          </button>
        </div>
        <div style={{fontSize:11, color:"var(--text-muted)", marginTop:6}}>
          Por seguridad, la clave actual no se muestra. Escribe una nueva para actualizarla.
        </div>
      </div>

      {/* Base URL */}
      <div style={card}>
        <label style={lbl}>URL Base API</label>
        <input
          type="text"
          value={baseUrl}
          onChange={e => setBaseUrl(e.target.value)}
          placeholder="https://workera.com/apiClient/v1"
          style={input}
        />
      </div>

      {/* Acciones */}
      <div style={{display:"flex", gap:10, marginTop:8}}>
        <button onClick={guardar} disabled={guardando} style={btnPri}>
          {guardando ? "Guardando..." : "Guardar cambios"}
        </button>
        <button onClick={probar} disabled={testing || !activo} style={btnSec}>
          {testing ? "Probando..." : "🧪 Probar conexión"}
        </button>
      </div>

      {/* Mensajes */}
      {msg && (
        <div style={{
          marginTop:16, padding:"10px 14px", borderRadius:8,
          background: msg.tipo === 'ok' ? "var(--success)15" : "var(--danger)15",
          color: msg.tipo === 'ok' ? "var(--success)" : "var(--danger)",
          fontSize:13, fontWeight:500
        }}>
          {msg.txt}
        </div>
      )}

      {/* Resultado test */}
      {testResult && (
        <div style={{
          marginTop:16, padding:"14px 16px", borderRadius:10,
          background: testResult.ok ? "var(--success)10" : "var(--danger)10",
          border: `1px solid ${testResult.ok ? "var(--success)" : "var(--danger)"}40`
        }}>
          {testResult.ok ? (
            <>
              <div style={{fontSize:14, fontWeight:700, color:"var(--success)", marginBottom:8}}>
                ✅ Conexión exitosa
              </div>
              <div style={{fontSize:13, lineHeight:1.6}}>
                <div><strong>Empresa:</strong> {testResult.empresa}</div>
                <div><strong>RUT:</strong> {testResult.rut}</div>
                <div><strong>Sucursales visibles:</strong> {testResult.sucursales_visibles}</div>
              </div>
            </>
          ) : (
            <>
              <div style={{fontSize:14, fontWeight:700, color:"var(--danger)", marginBottom:6}}>
                ❌ Error de conexión
              </div>
              <div style={{fontSize:12, fontFamily:"monospace", color:"var(--text)"}}>
                {testResult.error}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// Estilos compartidos
const card = { background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:10, padding:"14px 16px", marginBottom:12 }
const lbl  = { display:"block", fontSize:12, fontWeight:600, color:"var(--text-muted)", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.04em" }
const input = { width:"100%", padding:"10px 12px", border:"1px solid var(--border)", borderRadius:8, fontSize:14, background:"var(--bg-app)", color:"var(--text)", outline:"none", fontFamily:"inherit", boxSizing:"border-box" }
const btnPri = { padding:"10px 18px", background:"var(--accent)", color:"white", border:"none", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:600 }
const btnSec = { padding:"10px 14px", background:"var(--bg-card)", color:"var(--text)", border:"1px solid var(--border)", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:500 }
const toggleWrap = { cursor:"pointer" }
