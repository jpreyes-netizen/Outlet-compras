# Setup Google Calendar real — ERP Proyectos (Outlet de Puertas)

Objetivo: que las tareas, compromisos y reuniones creen eventos **automáticamente** en el Google Calendar de cada usuario @outletdepuertas.cl, sin que tengan que hacer clic en nada.

Mecánica: una **cuenta de servicio** de Google Cloud, autorizada por el admin de Workspace (delegación de dominio), permite a la edge function `google-calendar` crear eventos "en nombre de" cualquier usuario del dominio. Todo el setup es por navegador. Tiempo estimado: 20-30 min. **Hasta completar esto y encender el flag, la app sigue funcionando igual (con los enlaces 📆 de siempre) — nada se rompe.**

---

## Parte A — Google Cloud (console.cloud.google.com)

1. Entra a https://console.cloud.google.com con tu cuenta @outletdepuertas.cl.
2. Crea un proyecto nuevo: arriba a la izquierda → selector de proyecto → **New Project** → nombre `outlet-erp` → Create.
3. Habilita la API de Calendar: menú ☰ → **APIs & Services → Library** → busca **Google Calendar API** → **Enable**.
4. Crea la cuenta de servicio: ☰ → **IAM & Admin → Service Accounts** → **Create Service Account** → nombre `erp-calendar` → Create and continue → (sin roles, Continue) → Done.
5. Genera la clave: clic en la cuenta recién creada → pestaña **Keys** → **Add Key → Create new key → JSON** → se descarga un archivo `.json`. **Guárdalo bien: contiene la llave privada.**
6. Anota dos datos de la cuenta: el **email** (`erp-calendar@outlet-erp.iam.gserviceaccount.com`) y el **Unique ID / Client ID** (número largo, visible en Details).

## Parte B — Google Workspace Admin (admin.google.com) — lo hace el admin del dominio

7. Entra a https://admin.google.com → ☰ → **Security → Access and data control → API controls** → **Domain-wide delegation → Manage domain wide delegation**.
8. **Add new**: en *Client ID* pega el Unique ID del paso 6; en *OAuth scopes* pega exactamente:
   ```
   https://www.googleapis.com/auth/calendar.events
   ```
   → Authorize.

## Parte C — Supabase (dashboard del proyecto)

9. **Edge Functions → Deploy new function** (o Create function) → nombre exacto: `google-calendar` → pega el contenido completo de `google-calendar_index.ts` → Deploy.
10. **Edge Functions → Secrets** (o Settings → Secrets) → agrega:
    - `GOOGLE_SA_EMAIL` = el email de la cuenta de servicio (paso 6)
    - `GOOGLE_SA_PRIVATE_KEY` = abre el `.json` descargado, copia el valor del campo `"private_key"` **completo**, incluyendo `-----BEGIN PRIVATE KEY-----` y `-----END PRIVATE KEY-----`. Puedes pegarlo tal cual con los `\n` literales — la función los convierte sola.

## Parte D — Encender el flag

11. En el SQL Editor:
    ```sql
    UPDATE config_sistema SET valor = 'true' WHERE clave = 'gcal_activo';
    ```
    (Para apagar la integración en cualquier momento: `valor = 'false'`. La app vuelve al modo enlaces sin tocar código.)

## Parte E — Prueba

12. En la app: crea una tarea con fecha de vencimiento y derívala a otra persona. En menos de un minuto el evento debe aparecer en el Calendar de esa persona (evento de día completo en la fecha de vencimiento).
13. Crea una reunión con fecha + hora + asistentes: el evento aparece en tu Calendar con los asistentes invitados (y a ellos les llega la invitación de Google).

## Si algo falla (errores típicos en los logs de la edge function)

- **`invalid_grant` / `unauthorized_client`** → la delegación de dominio no está autorizada o el Client ID/scope no coinciden. Revisa el paso 8: el scope debe ser exactamente `https://www.googleapis.com/auth/calendar.events` y el Client ID el numérico de la cuenta.
- **`403 Calendar API has not been used`** → falta el paso 3 (Enable API) o corresponde a otro proyecto de GCP.
- **`Faltan secrets`** → los secrets del paso 10 no quedaron guardados o tienen otro nombre.
- **Nada pasa y no hay logs** → el flag sigue en 'false' (paso 11) o el nombre de la función no es exactamente `google-calendar`.

Los logs de la función están en Supabase Dashboard → Edge Functions → google-calendar → Logs.
