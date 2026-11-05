# TAI Hub

Biblioteca privada para el ingreso libre en Técnicos Auxiliares de Informática de la AGE. El programa sigue los cuatro bloques y 33 temas del [anexo V del BOE](https://www.boe.es/diario_boe/txt.php?id=BOE-A-2025-26262).

La aplicación estática se aloja en [GitHub Pages](https://alexmolina08.github.io/tai-hub/). Google Drive guarda los originales, los metadatos, las revisiones de PDF, los índices y el progreso. Google Identity Services concede únicamente `drive.file`, limitado a los archivos que gestiona TAI Hub. El token caduca y vive en memoria. Al recargar o cuando caduque, vuelve a pulsar **Conectar Drive**.

## Desarrollo

1. Usa Node.js 22.13 o posterior.
2. Copia `.env.example` como `.env.local` y rellena `VITE_GOOGLE_CLIENT_ID` con el identificador público del cliente web.
3. En Google Cloud, activa Drive API y autoriza `http://localhost:5173` y `https://alexmolina08.github.io` como orígenes JavaScript. Si la audiencia es externa y está en pruebas, la cuenta necesita estar en la lista de usuarios de prueba.
4. Ejecuta `npm ci` y `npm run dev`. Abre `http://localhost:5173/tai-hub/`.
5. Ejecuta `npm test`, `npm run build` y `npm run audit:public` antes de publicar. Para las pruebas de navegador instala Chromium y WebKit con `npx playwright install chromium webkit` y ejecuta `npm run test:e2e`.

GitHub Actions verifica los cambios de `main`. GitHub Pages publica la rama `gh-pages`. Para actualizarla, confirma el código y ejecuta `sh scripts/publish-pages.sh` con el Client ID público en `.env.local`. El script compila, audita y publica solo `dist`. Guarda materiales e inventarios fuera del repositorio.

## Uso

- **Añadir recurso** admite archivos, enlaces y notas. Desde el recurso puedes editar su tema, fuente y etiquetas, sustituir un PDF o enviar el archivo a la papelera de Drive.
- **Buscar** consulta metadatos y texto por página. Los PDF sin texto extraíble se identifican como tales. La extracción se realiza al conectar Drive y cuando cambia el contenido del PDF. El índice local se guarda en IndexedDB y se sincroniza con Drive.
- El lector recuerda la página y sincroniza marcadores, notas y subrayados por versión. **Ajustes** muestra el estado de Drive y permite actualizar la biblioteca o reintentar el índice.
- **Reproducir en Drive** abre la sesión autenticada de Google en otra pestaña. El reproductor de Drive gestiona la transmisión y los controles disponibles para el formato. Los originales también se pueden descargar.
- **Ajustes → Importar carpeta** recibe un manifiesto v1 y la carpeta de archivos. La operación comprueba cuota, deduplica por huella y verifica tamaño y MD5 cuando el manifiesto lo contiene. Para reanudar tras cerrar la sesión, selecciona el mismo manifiesto y carpeta. Las cargas completas ya verificadas se omiten.
