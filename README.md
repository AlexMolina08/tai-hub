# TAI Hub

Biblioteca privada para el ingreso libre en Técnicos Auxiliares de Informática de la AGE. El programa sigue los cuatro bloques y 33 temas del [anexo V del BOE](https://www.boe.es/diario_boe/txt.php?id=BOE-A-2025-26262).

La aplicación estática se aloja en [GitHub Pages](https://alexmolina08.github.io/tai-hub/). Google Drive guarda los originales, los metadatos, las revisiones de PDF, los índices y el progreso. Google concede únicamente `drive.file`, limitado a los archivos que gestiona TAI Hub. El token caduca y vive en memoria. Tras la primera conexión, la app recuerda la cuenta en el navegador e intenta recuperar acceso al volver a entrar. Si Google necesita una acción, aparece **Conectar Drive**. **Desconectar** olvida la cuenta y cierra el acceso en las pestañas abiertas de TAI Hub.

## Desarrollo

1. Usa Node.js 22.13 o posterior.
2. Copia `.env.example` como `.env.local` y rellena `VITE_GOOGLE_CLIENT_ID` con el identificador público del cliente web.
3. En Google Cloud, activa Drive API y autoriza `http://localhost:5173` y `https://alexmolina08.github.io` como orígenes JavaScript. Autoriza también `http://localhost:5173/tai-hub/` y `https://alexmolina08.github.io/tai-hub/` como URI de retorno. iOS conecta en la misma pestaña. Si la audiencia es externa y está en pruebas, la cuenta necesita estar en la lista de usuarios de prueba.
4. Ejecuta `npm ci` y `npm run dev`. Abre `http://localhost:5173/tai-hub/`.
5. Ejecuta `npm test`, `npm run build` y `npm run audit:public` antes de publicar. Para las pruebas de navegador instala Chromium y WebKit con `npx playwright install chromium webkit` y ejecuta `npm run test:e2e`.

GitHub Actions verifica los cambios de `main`. GitHub Pages publica la rama `gh-pages`. Para actualizarla, confirma el código y ejecuta `sh scripts/publish-pages.sh` con el Client ID público en `.env.local`. El script compila, audita y publica solo `dist`. Guarda materiales e inventarios fuera del repositorio.

## Uso

- **Añadir recurso** admite archivos, enlaces y notas. Desde el recurso puedes editar su tema, fuente y etiquetas, sustituir un PDF o enviar el archivo a la papelera de Drive.
- **Buscar** consulta metadatos y texto por página. Los PDF sin texto extraíble se identifican como tales. La extracción se realiza al conectar Drive y cuando cambia el contenido del PDF. El índice local se guarda en IndexedDB y se sincroniza con Drive.
- El lector permite desplazarte de una página a la siguiente y ampliar la vista a pantalla completa. Recuerda la página y sincroniza marcadores, notas y subrayados por versión. **Ajustes** muestra el estado de Drive y permite actualizar la biblioteca o reintentar el índice.
- Toca un subrayado para quitarlo. Pulsa **Deshacer** o usa **⌘Z** en Mac y **Ctrl+Z** en otros teclados. También puedes deshacer o rehacer desde el panel de notas mientras el PDF siga abierto.
- **Reproducir en Drive** abre la sesión autenticada de Google en otra pestaña. El reproductor de Drive gestiona la transmisión y los controles disponibles para el formato. Los originales también se pueden descargar.
- **Ajustes → Importar carpeta** recibe un manifiesto v1 y la carpeta de archivos. La operación comprueba cuota, deduplica por huella y verifica tamaño y MD5 cuando el manifiesto lo contiene. Para reanudar tras cerrar la sesión, selecciona el mismo manifiesto y carpeta. Las cargas completas ya verificadas se omiten.

## Fuentes oficiales

La pestaña INAP enlaza a las fichas, documentos y exámenes del INAP. El índice incluye títulos y enlaces a los documentos oficiales. El BOE se comprueba con su API pública.

El flujo **Comprobar convocatorias INAP y BOE** revisa las fuentes cada seis horas y escribe los avisos en la rama pública `official-data`. Para iniciar la primera comprobación al incorporar esta función, ejecuta `gh workflow run official-inap.yml --ref main`. El propio flujo crea la rama con el permiso `contents: write`. Puedes seguir la ejecución desde GitHub Actions. La copia incluida en la aplicación permite abrir los recursos durante una interrupción del feed. El historial de lectura de avisos se guarda en cada navegador.

Para comprobar el analizador sin cambiar el índice distribuido, ejecuta `python3 -m unittest discover -s scripts -p 'test_check_inap.py'`. Una comprobación real en un archivo aparte se puede ejecutar con `python3 scripts/check_inap.py /tmp/tai-official-inap.json --baseline public/official-inap.json`.
