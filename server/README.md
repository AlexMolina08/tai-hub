# Sesión de Drive con Cloudflare Workers Free

El Worker sirve la aplicación bajo `/tai-hub/` y solo interviene en OAuth. El navegador consulta Google Drive directamente. D1 conserva el identificador de cuenta y el token de renovación cifrado. La cookie de sesión se envía al mismo origen y es HttpOnly. El navegador usa el token de acceso de corta duración en memoria.

## Preparación

1. En Workers & Pages, crea un Worker y una base D1 en el plan Free. Copia `wrangler.example.jsonc` a un archivo de configuración local y pon el origen y el identificador D1 reales. Aplica `schema.sql` a esa base.
2. En el proyecto OAuth actual de TAI Hub, añade el origen HTTPS del Worker y la URI exacta `https://<worker>/tai-hub/session/callback` al cliente web existente. Conserva las URI de GitHub Pages. Con el mismo cliente y el permiso `drive.file` se puede verificar el acceso a los archivos existentes antes de cambiar de enlace. En el modo externo de pruebas, Google limita a siete días el token de renovación que incluye Drive.
3. Configura `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_GOOGLE_ACCOUNT` y `SESSION_KEY` como secretos del Worker. Genera `SESSION_KEY` con 32 bytes aleatorios codificados en base64url. Mantén ese valor para que las sesiones sobrevivan a un nuevo despliegue.
4. Ejecuta `VITE_DRIVE_SESSION=managed npm run build` con el ID público del mismo cliente. Ejecuta `npm run audit:public` y copia el contenido de `dist/` bajo `server/assets/tai-hub/`. Despliega con la configuración local.
5. Abre el Worker y autoriza la cuenta una vez. Comprueba el catálogo, una lección, el PDF vinculado, la sincronización y la renovación. Confirma en el origen anterior que el progreso pendiente se ha enviado a Drive antes de pasar al nuevo. Safari guarda la copia local por origen. Desde el nuevo origen, carga el catálogo desde Drive y prepara el acceso sin conexión.

Para verificar en local, ejecuta `node --test server/worker.test.mjs`. El servicio se mantiene desactivado en GitHub Pages, salvo si se compila expresamente con `VITE_DRIVE_SESSION=managed`.
