# Laboratorio: contratos y validación

El laboratorio carga contenido privado y versionado desde la biblioteca del propietario en Google Drive o desde un archivo local. El repositorio contiene código y ejemplos sintéticos. No contiene temarios, bancos reales, paquetes editoriales ni historial personal. El estudio no llama a modelos de lenguaje.

## Contenido y estados

`src/lab/model.ts` define objetivos, lecciones, actividades, fuentes, evidencias e historial. Un objetivo conserva sus destinos de explicación, práctica, comprobación inmediata, reserva y comprobación diferida. Un destino planificado no demuestra que exista una actividad terminada.

Los estados `planned`, `authored`, `review`, `correction`, `validated` y `withdrawn` describen el trabajo editorial. El modo `authoring` admite trabajo incompleto declarado. El modo `study` exige contenido validado, fuentes verificadas y evidencia correspondiente a cada versión en las seis puertas editoriales. La comprobación estructural no sustituye la lectura de fuentes ni demuestra por sí sola que una evidencia sea auténtica.

Las familias y escenarios se comprueban tanto dentro de un paquete como contra las versiones ya guardadas en esa cuenta. Una reserva de transferencia no puede compartirlos con entrenamiento. Una actividad diferida puede declarar `evaluationIntent: "retention"` para revisar una familia entrenada; ese resultado no demuestra transferencia nueva. Si no declara intención, conserva la separación exigida a las variantes diferidas originales.

```sh
npm run lab:validate -- /ruta/privada/paquete.json authoring
npm run lab:validate -- /ruta/privada/paquete.json study
npm run lab:review -- /ruta/privada/paquete.json
```

La revisión editorial sirve el archivo únicamente en `127.0.0.1:5195`, mediante una URL temporal con token. Rechaza entradas dentro del repositorio y no cambia estados, no escribe en Drive y no mezcla sus intentos con el estudio. `TAI_REVIEW_PORT` permite otro puerto local. Las reservas no aparecen en el recorrido de lecciones. No se debe distribuir el servidor de revisión como aplicación publicada.

Los enunciados y explicaciones admiten ejemplos delimitados por tres acentos graves, con una etiqueta de lenguaje opcional. Se muestran como texto en bloques de código ajustados al ancho disponible; no se interpreta HTML ni se ejecuta el contenido. El resto conserva la presentación de texto. El orden de las opciones pertenece a la versión del paquete y permanece estable durante el estudio.

## Historial y sincronización

Cada intento, borrador, exposición y consulta de ayuda tiene identidad inmutable. IndexedDB guarda primero el evento; Drive recibe lotes nuevos, sin modificar un archivo compartido. La unión se realiza por ID, no por hora del dispositivo. Una colisión de ID con otro contenido produce un error visible. El reenvío tras perder una confirmación no duplica el evento lógico.

Los borradores forman un grafo de versiones. Dos ramas concurrentes requieren elección explícita y conservan sus antecesores. El historial debe terminar de cargar antes de montar una actividad: crear un borrador vacío antes de esa carga produciría un conflicto falso. Los intentos conservan versiones de contenido y corrección; una actualización no recalcula retrospectivamente sus respuestas.

La entrada permite reanudar la última actividad disponible a partir del historial de la cuenta, incluido el que llega de otro dispositivo. El destino exige coincidencia de paquete, versión y actividad. Solo admite actividades de práctica y cierre de lección validadas; excluye reservas, contenido retirado y versiones ausentes. La fecha del evento ordena esta sugerencia de navegación, con desempate estable por ID: no resuelve conflictos ni calcula dominio. Un reloj de dispositivo desajustado puede afectar la sugerencia, pero no modifica ni elimina respuestas. La navegación posterior y el panel de lectura/práctica se conservan localmente; la sincronización transmite respuestas y ayudas, no una posición de lectura inventada.

El catálogo agrupa las lecciones por tema oficial y permite filtrar III/IV, tema y palabras del título o de sus objetivos. La búsqueda ignora tildes y mayúsculas. Una lección multitema aparece una vez en el resultado. Las ediciones coexistentes siguen siendo destinos distintos; se muestra la edición cuando se repite el título. Los recuentos de actividades respondidas exigen la cuenta y versiones exactas, excluyen omisiones y no representan dominio. Al restablecer filtros, el foco vuelve al buscador. El selector de tema usa un área táctil de al menos44px también en WebKit, cuyo control nativo ignoraba la altura mínima.

Una copia exportada identifica cuenta y esquema. Restaurarla combina eventos y rechaza otra cuenta o un esquema desconocido. No se realiza compactación destructiva. Las cuentas tienen claves separadas en IndexedDB. Desconectar revoca la selección local de cuenta y no conserva credenciales para el modo offline.

## Ejecución SQL

PGlite se carga bajo demanda. El ejecutor vive en un worker descartable dentro de un iframe de origen opaco (`sandbox="allow-scripts"`). El iframe solo recibe código fijo del motor, archivos WASM y datos del ejercicio. Su CSP impide red, almacenamiento del origen y acceso al padre. El receptor exige la ventana emisora y un token de ejecución; mensajes ajenos no producen resultados.

Cada consulta empieza con una base temporal nueva. Se permite una sentencia, con límites de entrada, tres segundos de `statement_timeout`, doce segundos de supervisión externa y una salida máxima de 200 filas o 100 KB. La cancelación termina el worker. La descarga tiene un plazo separado y puede cancelarse desde la interfaz. Los límites de salida se verifican después de que PostgreSQL calcule el resultado: no equivalen a un límite duro de memoria.

La corrección ejecuta varios conjuntos de datos y compara valores por posición. `bag` conserva multiplicidad, `set` permite eliminar duplicados y `ordered` exige orden. Los nombres de columna no se puntúan salvo que el requisito se amplíe expresamente. Los ejemplos sintéticos prueban NULL, duplicados, conjuntos vacíos, cancelación, salida excesiva, reinicio y accesos prohibidos. PostgreSQL no representa automáticamente otros dialectos.

## Disponibilidad sin conexión

El usuario prepara explícitamente aplicación y motores. El manifiesto se genera desde archivos públicos emitidos por Vite; cada descarga verifica SHA-256. Cache Storage solo contiene esos archivos públicos. Paquetes y respuestas permanecen en IndexedDB por cuenta. El estado vuelve a comprobar la presencia de archivos y deja de mostrar disponibilidad si se elimina una dependencia.

La identidad local recordada permite abrir paquetes previamente descargados sin un token persistido. Autenticación inicial, descarga, Drive y vídeos requieren red. El navegador puede desalojar almacenamiento; la preparación no promete permanencia. El lector de materiales completos mantiene sus requisitos de conexión actuales.

## Evidencia y límites pendientes

Los tests usan contenido sintético. La revisión de paquetes reales y sus evidencias se conserva fuera del repositorio. Una prueba de Chromium o WebKit en el ordenador no acredita Safari iOS ni Chrome Android físicos.

Playwright WebKit tiene una limitación documentada al simular navegación offline con service workers ([incidencia 42775](https://github.com/microsoft/playwright/issues/42775)). Esa comprobación se declara omitida para WebKit y no se contabiliza como aprobada. La restauración de archivos se verifica online en WebKit porque la emulación offline también rechazó lecturas locales de archivos. Estas limitaciones requieren comprobación física antes de cerrar aceptación.

Safari nativo en macOS también se comprobó con una copia de prueba sintética: tras preparar la caché y detener el servidor local, reabrió la aplicación, recuperó borrador y pista y ejecutó SQL desde los archivos descargados. La caída del servidor de origen es un caso comprobado; no equivale a desconectar todas las redes, cerrar completamente el navegador o validar un iPhone físico.

La plataforma sigue en desarrollo: el cierre editorial, el dominio del estudiante y la autorización de publicación son estados distintos. Ningún test sintético habilita por sí solo la publicación de una lección real.

## Python y JavaScript

La modalidad `code` usa entradas JSON en la variable `input` y compara la salida con varios casos preparados durante la autoría. El estado de cada ejecución se descarta. JavaScript se ejecuta como módulo en un worker; Python utiliza Pyodide314.0.7/CPython3.14.2. No hay instalación de paquetes, entrada interactiva, acceso a la red ni ficheros persistentes. Un resultado correcto acredita los casos probados, no una demostración universal del programa.

El worker vive dentro de un iframe opaco. Su CSP conserva `connect-src 'none'`; solo recibe fuente, entrada y archivos públicos del intérprete. El cargador fijo tiene hash en la CSP de producción. El worker de módulo usa una URL data para la compatibilidad observada en Chromium y WebKit. La carga de Python es diferida: cuatro archivos, aproximadamente12.7MiB sin compresión. La preparación offline incluye Python solo si los paquetes descargados lo necesitan.

Los límites actuales son50KB de código,16KB de entrada,100 líneas/16KB de salida,20 segundos de arranque y2 segundos de ejecución. Cancelar o superar tiempo termina el worker. No existe un límite duro de memoria independiente del navegador. Estos límites deben calibrarse en dispositivos físicos. La inyección del módulo Emscripten en `loadPyodide` usa una opción experimental de la API; la versión está fijada y cualquier actualización exige repetir las pruebas.

Las comprobaciones de código guardan resultados correctos, incorrectos y errores de ejecución. Un fallo de descarga o arranque y una cancelación no se convierten en un error del alumno. En SQL se distingue igualmente el error de la consulta del fallo al preparar el entorno. Cada intento conserva su diagnóstico y la versión del corrector.

## HTML y CSS

La modalidad `html-css` conserva ambos editores como un único borrador. La vista usa DOM y CSS reales dentro de un iframe de origen opaco. Solo se admite marcado estático acotado:200 elementos y50KB. Scripts, controladores de eventos, navegación, documentos anidados y recursos externos se eliminan o bloquean. Las modalidades que necesitan esos comportamientos deberán usar actividades específicas y no se considerarán cubiertas por esta vista.

La corrección mide selectores, texto, atributos o estilos calculados en varios anchos preparados. Las respuestas esperadas permanecen en el corrector; no se ejecutan expresiones del paquete. Un selector sin elemento no puede satisfacer una expectativa vacía. La comprobación se limita a los casos declarados y conserva resultados e intentos. El ancho del ejercicio puede desplazarse dentro de la vista en pantallas pequeñas, sin ensanchar la interfaz.

Los avisos de los motores se incluyen en `public/licenses/runtime-notices.txt`. La auditoría permite únicamente el ZIP público exacto de la biblioteca estándar de Pyodide, identificado por SHA-256; sigue rechazando otros archivos ZIP y cualquier paquete de estudio privado.
