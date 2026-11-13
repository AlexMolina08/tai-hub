# TAI Hub

Biblioteca privada para el ingreso libre en Técnicos Auxiliares de Informática de la AGE. El programa sigue los cuatro bloques y 33 temas del [anexo V del BOE](https://www.boe.es/diario_boe/txt.php?id=BOE-A-2025-26262).

La versión de estudio se abre en [TAI Hub](https://tai-hub-study.tai-hub.workers.dev/tai-hub/) y renueva la sesión de Drive al volver a entrar. Google Drive guarda los originales, los metadatos, las revisiones de PDF, los índices y el progreso. El permiso `drive.file` se limita a los archivos que gestiona TAI Hub. El token de acceso vive en memoria; la sesión persistente se gestiona en [Cloudflare Workers](server/README.md). [GitHub Pages](https://alexmolina08.github.io/tai-hub/) se conserva como alternativa con conexión directa. Si Google necesita una acción, aparece **Conectar Drive**. **Desconectar** cierra el acceso en las pestañas de la aplicación.

## Desarrollo

1. Usa Node.js 22.13 o posterior.
2. Copia `.env.example` como `.env.local` y rellena `VITE_GOOGLE_CLIENT_ID` con el identificador público del cliente web.
3. En Google Cloud, activa Drive API y autoriza `http://localhost:5173` y `https://alexmolina08.github.io` como orígenes JavaScript. Autoriza también `http://localhost:5173/tai-hub/` y `https://alexmolina08.github.io/tai-hub/` como URI de retorno. iOS conecta en la misma pestaña. Si la audiencia es externa y está en pruebas, la cuenta necesita estar en la lista de usuarios de prueba.
4. Ejecuta `npm ci` y `npm run dev`. Abre `http://localhost:5173/tai-hub/`.
5. Ejecuta `npm test`, `npm run build` y `npm run audit:public` antes de publicar. Para las pruebas de navegador instala Chromium y WebKit con `npx playwright install chromium webkit` y ejecuta `npm run test:e2e`.

GitHub Actions verifica los cambios de `main`. GitHub Pages publica la rama `gh-pages`. Para actualizarla, confirma el código y ejecuta `sh scripts/publish-pages.sh` con el Client ID público en `.env.local`. El script compila, audita y publica solo `dist`. Guarda materiales e inventarios fuera del repositorio.

