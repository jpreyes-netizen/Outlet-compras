# Outlet de Puertas — Sistema de Compras

## Deploy en Netlify (desde Git)

1. Sube esta carpeta a un repositorio en GitHub
2. En Netlify: Add new site → Import from Git → selecciona el repo
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Agrega las variables de entorno:
   - `VITE_SUPABASE_URL` = tu Project URL de Supabase
   - `VITE_SUPABASE_ANON_KEY` = tu anon public key de Supabase
6. Deploy

## Desarrollo local

```bash
npm install
cp .env.example .env  # editar con tus credenciales
npm run dev
```
