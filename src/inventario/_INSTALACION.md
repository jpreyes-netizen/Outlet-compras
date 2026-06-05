# App Inventario — Análisis de Stock · instalación

App nueva del ecosistema. No toca nada existente, solo agrega.

## 1. Copiar archivos
Crear carpeta `src/inventario/` y copiar dentro estos 8 archivos:

- `InventarioApp.jsx` ← shell principal
- `InvDashboard.jsx`
- `InvAnalisis.jsx`
- `InvEstacionalidad.jsx`
- `InvSucursales.jsx`
- `InvDecision.jsx`
- `ui.jsx`
- `engine.js`

## 2. Registrar el router en `src/App.jsx`

En la zona de imports (junto a las otras apps, ~línea 11):
```js
import{InventarioApp}from'./inventario/InventarioApp'
```

En la zona de routing (junto a los otros `if(appActual===...)`, ~línea 523):
```js
  if(appActual==="inventario")return<InventarioApp cu={cu} setAppActual={v=>{setAppActual(v);try{if(v)localStorage.setItem("outlet_app_actual",v);else localStorage.removeItem("outlet_app_actual")}catch(e){}}}/>
```

## 3. Que aparezca en el AppHub

Dos opciones:

**A) Vía base de datos (recomendado):** ejecutar `_REGISTRO_APP.sql` en Supabase. El AppHub la lee de `usuario_acceso` automáticamente.

**B) Fallback hardcodeado:** si usas `appsLegado()` en `AppHub.jsx`, agrega `'inventario'` al array de códigos del rol que corresponda.

## 4. Dependencias
Usa solo `react` y `xlsx`, ambas ya en `package.json`. Nada nuevo que instalar.

## 5. Uso
Entrar a la app → subir los 2 Excel de BSALE (Detalle de ventas + Stock actual, juntos o por separado). Detecta cuál es cuál automáticamente. Analiza los meses completos disponibles (descarta el mes en curso y meses con solo devoluciones).

## Notas técnicas
- Procesamiento 100% local en el navegador, no escribe a Supabase.
- El engine usa los parámetros oficiales de lead time / cobertura por tipo y los días de emergencia por clase ABCD del Sistema de Reposición v5.1.
- Sucursales normalizadas: La Granja / Los Angeles / Maipu.
- Maipú se interpreta como CD (mucho stock, poca venta directa) — la app lo señala.
