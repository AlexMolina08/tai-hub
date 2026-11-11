# Laboratorio: contratos y validación

El laboratorio carga contenido privado y versionado desde la biblioteca del propietario en Google Drive o desde un archivo local. El repositorio contiene código y ejemplos sintéticos. No contiene temarios, bancos reales, paquetes editoriales ni historial personal. El estudio no llama a modelos de lenguaje.

## Contenido y estados

`src/lab/model.ts` define objetivos, lecciones, actividades, fuentes, evidencias e historial. Un objetivo conserva sus destinos de explicación, práctica, comprobación inmediata, reserva y comprobación diferida. Un destino planificado no demuestra que exista una actividad terminada.

La modalidad `documentary` identifica casos de elección respaldados por documentación, sin atribuirles una ejecución ni una traza observada. La interfaz muestra «Caso documental» y conserva la edición y los límites preparados. El contrato rechaza esta modalidad en actividades con ejecutor. Es una extensión aditiva previa a la publicación: el cliente actual sigue aceptando paquetes anteriores; un cliente anterior rechaza la modalidad desconocida y debe actualizarse antes de cargar esos paquetes.

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

La entrada permite reanudar trabajo a partir del historial de la cuenta, incluido el que llega de otro dispositivo. El destino exige coincidencia de paquete, versión y actividad. El acceso «Reanudar actividad» cubre prácticas y cierres de lección; la cola de aprendizaje también recupera evaluaciones independientes. Una reserva ya presentada conserva su grupo y presentación aunque aún no se haya elegido respuesta. No se inicia otro intento para recuperar ese borrador. Las ramas concurrentes siguen requiriendo elección explícita.

La fecha del evento ordena estas sugerencias de navegación, con desempate estable por ID: no resuelve conflictos ni calcula dominio. Un reloj de dispositivo desajustado puede afectar la sugerencia, pero no modifica ni elimina respuestas. La navegación posterior y el panel de lectura/práctica se conservan localmente; la sincronización transmite respuestas y ayudas, no una posición de lectura inventada. Una propuesta dirigida a una actividad abre la práctica también en móvil.

El catálogo agrupa las lecciones por tema oficial y permite filtrar III/IV, tema y palabras del título o de sus objetivos. La búsqueda ignora tildes y mayúsculas. Una lección multitema aparece una vez en el resultado. Las ediciones coexistentes siguen siendo destinos distintos; se muestra la edición cuando se repite el título. Los recuentos de actividades respondidas exigen la cuenta y versiones exactas, excluyen omisiones y no representan dominio. Al restablecer filtros, el foco vuelve al buscador. El selector de tema usa un área táctil de al menos44px también en WebKit, cuyo control nativo ignoraba la altura mínima.

Una copia exportada identifica cuenta y esquema. Restaurarla combina eventos y rechaza otra cuenta o un esquema desconocido. No se realiza compactación destructiva. Las cuentas tienen claves separadas en IndexedDB. Desconectar revoca la selección local de cuenta y no conserva credenciales para el modo offline.

## Sesiones guiadas

El campo opcional `sessions` compone cinco etapas: recuperar, comprender, experimentar, transferir y cerrar. Sus rangos suman entre 30 y 40 minutos orientativos; no son un temporizador ni tiempo medido con estudiantes. Las etapas seleccionan actividades existentes y fragmentos concretos de lecciones. Los paquetes anteriores sin sesiones mantienen su significado.

El contrato exige referencias existentes, cobertura de cada objetivo declarado y tiempos dentro del rango de cada etapa. Impide repetir actividades entre etapas, incluir reservas o comprobaciones diferidas y reutilizar la identidad de otra lección o actividad. Cada sesión validada necesita sus propias seis puertas y dependencias validadas. Reutilizar un fragmento no completa la lección de origen ni demuestra transferencia inédita.

`session-position` conserva etapa y actividad mediante eventos inmutables de cuenta, paquete, sesión y versiones exactas. La navegación se guarda localmente antes de actualizar la vista. Restaurar una posición no genera un evento nuevo: evita que una recarga vuelva a abrir una sesión cerrada desde otro dispositivo. Los callbacks pendientes no regresan a la sesión después de salir al catálogo. La fecha solo ordena la sugerencia; los borradores e intentos conservan sus reglas de conflicto y todo su historial.

El cierre puede guardar una interrupción con actividades pendientes. `completed` significa que se cerró ese recorrido, sin acreditar dominio ni responder automáticamente lo que falta. El resumen conserva primera y última respuesta y muestra ayudas solicitadas incluso sin responder o después de un acierto. Reabrir expresamente una etapa crea navegación nueva; restaurar un cierre mantiene el resumen sin abrir otra actividad. La posición fina dentro del texto sigue siendo local.

Este tipo de evento se introduce antes de publicar el laboratorio. No se modifica el esquema ni se reescriben eventos antiguos; los clientes nuevos admiten los tipos previos. Una compilación anterior que desconozca `session-position` rechaza el lote completo, sin descartar selectivamente datos. Antes de habilitar contenido con sesiones deben actualizarse los clientes participantes. Una futura migración o reversión deberá preservar estos eventos; no se promete compatibilidad de escritura con clientes anteriores.

## Notas personales

Las actividades ofrecen una predicción opcional y las sesiones permiten anotar errores y el siguiente paso al cerrar. Son texto personal, hasta 4000 caracteres, separado de respuestas, ayudas y navegación. No se califica ni acredita haber predicho antes de ejecutar. La modalidad específica de un modelo puede imponer su propio paso previo, sin convertir esta nota general en esa evidencia.

El evento `note` conserva cuenta, destino, edición exacta y revisiones inmutables. Predicciones de actividad y reflexiones de sesión tienen destinos distintos. Dos dispositivos que editan una misma revisión producen ramas conservadas; elegir una genera una revisión nueva con ambos padres. El reloj no selecciona el texto ganador. Exportación, restauración y sincronización usan el historial privado existente.

Antes de combinar o guardar, se rechazan ciclos y padres conocidos de otra cuenta, destino, edición o tipo de evento. Los padres aún no recibidos pueden llegar después. El recorrido iterativo admite cadenas largas sin depender de la pila de llamadas. La llegada posterior de un padre incompatible rechaza ese lote sin borrar el historial anterior.

Un buffer en memoria, separado del editor y ligado a cuenta/destino, conserva escrituras pendientes y fallidas al navegar. El reintento incluye todos los antecesores fallidos, aunque un descendiente se haya guardado. Solo observar el mismo ID **y contenido** en el historial permite retirar la copia del buffer. Una colisión conserva el texto local en modo de lectura, muestra el error y permite descargar una copia privada; no sobrescribe la copia guardada ni se resuelve reintentando a ciegas.

Mientras exista una escritura sin guardar se registra un aviso de salida. Un navegador puede omitir ese aviso, especialmente en móviles. El buffer no garantiza supervivencia ante cierre, caída del proceso o desalojo si el almacenamiento ha fallado: se indica el fallo y se ofrecen reintento y copia descargable. Un guardado local correcto tampoco equivale a sincronización remota; el estado general de progreso informa de esa cola.

Este evento se añade antes de publicar el laboratorio, sin reescribir datos anteriores. Los clientes antiguos rechazan lotes con tipos desconocidos; los dispositivos participantes deben actualizarse antes de activar el contenido. Ningún dato de notas entra en el bundle público ni se envía a un LLM.

## Recuperación de borradores

Cada edición inicia su escritura local inmediatamente. Un buffer por cuenta, actividad y versiones conserva las revisiones pendientes o fallidas al salir de la actividad. El reintento guarda también antecesores fallidos; comprobar una respuesta o ejecutar un programa espera a que todas las revisiones estén guardadas. Un fallo de almacenamiento no crea un intento ni se atribuye al alumno.

La vista muestra un único aviso de guardado con reintento y descarga privada. La protección en memoria y el aviso de salida tienen los mismos límites descritos para las notas: no garantizan recuperación tras cerrar o perder el proceso si el almacenamiento falló. El guardado local tampoco confirma la sincronización con Drive.

Una revisión remota única actualiza el editor abierto y determina el padre y el grupo de la siguiente edición. Las ramas concurrentes requieren una elección expresa, que conserva ambos padres y el grupo elegido. Se rechazan ciclos y padres conocidos de otra cuenta, contenido, versión o tipo antes de guardar o sincronizar. La validación iterativa admite cadenas largas. Una colisión de ID con otro contenido conserva la copia local seleccionable y descargable; no sobrescribe datos ni permite reintentar a ciegas.

## Modelo editable de IPv4

La actividad de práctica `ipv4-model` calcula límites, máscara, pertenencia y tamaño del bloque con el motor local versionado `tai-ipv4-block-0.1.0`. No enumera direcciones ni transmite tráfico. La interpretación operativa es un paso separado: se acota a bloques RFC1918 completos y al contexto declarado. Un /31 exige distinguir el enlace punto a punto compatible; un /32 representa una coincidencia exacta. El cálculo numérico no certifica asignabilidad ni una configuración de red real.

El recorrido separa editar, guardar predicción u omisión y revelar el cálculo. Antes de mostrar resultados, se guarda un único lote local con la revisión y todos sus eventos acompañantes. La vista necesita tanto la cadena causal completa como la confirmación del lote completo; recibir solo acompañantes desde otro dispositivo no confirma el borrador. El buffer conserva y permite descargar todo el lote si falla, con los mismos límites ante cierre descritos anteriormente.

Los eventos `ipv4-prediction`, `ipv4-reveal` e `ipv4-reset` conservan entradas, acciones y relaciones causales. El borrador `ipv4-model-v1` contiene solo la vista actual, con tamaño acotado. Editar o reiniciar oculta el resultado anterior sin borrar predicciones ni intentos. Los padres desconocidos pueden llegar después; enlaces conocidos incompatibles se rechazan antes de combinar o guardar.

La identidad del intento deriva de la predicción. Dos dispositivos que revelan la misma predicción generan un único intento lógico, aunque cada revelación y consulta de solución conserva su evento. El intento mantiene el dispositivo, fecha, tiempo activo y ayudas de la predicción original. Su propia revelación no la convierte retrospectivamente en una respuesta ayudada; sí expone la familia para predicciones posteriores.

Se comparan límites y, cuando se solicita, pertenencia. Un valor incorrecto produce `incorrect`; una parte correcta y otra omitida produce `partial`; omitir todas las respuestas numéricas produce `omitted` con respuesta nula, conservando entradas y texto. La explicación conceptual no se califica. Variar parámetros sigue siendo práctica de la misma familia, sin acreditar transferencia nueva ni dominio.

Esta modalidad y sus eventos se añaden antes de publicar el laboratorio. Los clientes nuevos aceptan paquetes e historial anteriores; los antiguos rechazan los tipos desconocidos. Se deben actualizar los dispositivos participantes antes de habilitar este contenido. No se reescribe el historial existente ni se promete compatibilidad de escritura con compilaciones anteriores.

## Aprendizaje y recomendaciones

El evento prospectivo `learning-context` registra presentación, respuesta, ayuda, contacto de lectura o reinicio. Identifica cuenta, dispositivo, sesión, edición exacta, padres causales, hechos asociados y presentación original. La captura conserva fecha, día local, zona IANA, desplazamiento UTC, sesión de reloj y tiempo monotónico. Los hechos enlazados conservan una referencia recíproca; faltas de referencias quedan pendientes y contradicciones conocidas rechazan la combinación. Los históricos sin contexto siguen disponibles sin inventarles esos datos.

El contrato prospectivo v2 exige `referenceVisible` en cada presentación y permite una acción `reference` posterior, vinculada a esa presentación y sin hechos accesorios. Registra apoyo textual disponible o consultado; no representa una pista, una solución exacta, lectura completa ni exposición de una familia. `LearningCapture.present` y `prepare` aceptan la opción final `{ referenceVisible }`, falsa por defecto para vistas aisladas. `reference()` conserva un lote estable cuando la referencia aparece después, por ejemplo al cambiar el ancho. La interfaz debe conservarlo en el buffer semántico y no acreditar una respuesta antes de su guardado. Una referencia pendiente sigue incluida al preparar la respuesta aunque el texto se haya ocultado después.

La derivación reconoce además una lectura de la misma edición y de objetivos relacionados que esté causalmente entre presentación y respuesta. Lectura previa a conocer la pregunta es preparación; lectura posterior no altera la respuesta original. Una lectura concurrente, incompleta o sin alcance comprobable impide afirmar ausencia de apoyo; las fechas no suplen el orden causal. En IPv4 se conserva la presentación y el contexto de la predicción original: una referencia consultada antes de revelar el resultado pero después de predecir no cambia retroactivamente esa predicción.

Los eventos v1 siguen decodificándose y exportándose sin reescribir hechos. Como no capturaban referencia visible, su ausencia de apoyo textual queda incierta bajo la política nueva; eso no inventa una consulta ni cambia el resultado guardado. Los clientes anteriores rechazan v2 por su contrato estricto, en lugar de omitir silenciosamente la señal. Los dispositivos participantes deben actualizarse antes de intercambiar estos eventos.

Las respuestas, ayudas y lecturas usan lotes estables. Un buffer fuera del componente conserva lotes pendientes o fallidos al navegar; un reintento mantiene IDs y fechas. Confirmar solo parte de un lote no retira la copia pendiente. La interfaz espera el guardado antes de mostrar la solución y permite reintentar o descargar una respuesta pendiente. La memoria tiene los límites ante cierre y fallo de almacenamiento descritos para los borradores. Leer un apartado registra contacto, sin afirmar que se haya comprendido o completado.

`deriveLearning` es una función pura de paquetes, eventos, política y fecha de evaluación. Solo usa la edición validada y elegible que coincide con cada intento. Separa comprensión, retención y transferencia; no persiste una marca definitiva de dominio. La primera respuesta depende del orden causal: una ayuda posterior no cambia sus hechos, y una ayuda concurrente o histórica sin orden impide atribuir ausencia de ayuda. Repetir el mismo ejercicio dentro del día o antes de 24 horas no añade un acierto independiente. Las equivalencias editoriales de familia, escenario y original impiden presentar una variante expuesta como inédita.

La regla visible `learning-v2-reference` exige tres aciertos sin ayuda, dos familias y dos días separados por al menos 24 horas, una recuperación diferida, una variante nueva y ausencia de errores pendientes. `referenceSupport` distingue ausencia capturada, apoyo registrado e incertidumbre; solo la primera puede contribuir como acierto sin ayuda. Un error abre repaso; su recuperación exige acierto de otra familia y comprobación diferida posterior. Los diagnósticos críticos proceden de reglas preparadas en el contenido, nunca de interpretar libremente el texto de la respuesta o del feedback. Una omisión conserva su identidad sin convertirse en error y adelanta la próxima propuesta de repaso.

Los intervalos orientativos son 1, 3, 7, 14 y 30 días. Se calculan con fechas declaradas por los dispositivos, no con un reloj externo fiable. Se detectan regresiones, fechas futuras y desacuerdos con el tiempo monotónico. Una incoherencia afecta también a descendientes causales del mismo dispositivo y sesión de reloj. Un contacto posterior coherente en otra sesión puede acotar contactos antiguos dudosos sin reescribirlos; una rama concurrente desconocida no se ordena por su fecha. La presentación de la propia pregunta no reinicia el intervalo, pero su incertidumbre de reloj sí afecta a la respuesta.

`recommendLearning` produce hasta ocho propuestas con razones visibles: reanudar, prerrequisito, error crítico, repaso, continuación y transferencia. Limita repasos repetidos y conserva alternancia entre III y IV. Si las fechas no permiten afirmar una semana sin IV, puede usar sesiones ordenadas causalmente, explicando la diferencia. El usuario puede elegir otra propuesta o explorar libremente. Reservas agotadas, contenido no disponible y evidencia incompleta permanecen visibles; no se sustituyen por nuevas preguntas generadas durante el estudio.

El panel adapta las tres dimensiones al ancho disponible y permite inspeccionar criterios por objetivo. No convierte actividades respondidas en contenido editorial validado ni estima un puesto en el examen. La unión posterior de eventos puede completar o revisar los indicadores. Estos contratos se añaden antes de publicar el laboratorio; los dispositivos participantes deben actualizarse antes de habilitarlos, porque clientes anteriores rechazan tipos desconocidos.

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

Reintentar conserva la respuesta inicial y aumenta el ordinal, sin abrir la solución ni inventar una consulta de ayuda. Pedir la solución o desplegar las explicaciones de todas las opciones registra esa consulta y la exposición de la familia. Un ordinal posterior al primero no constituye una nueva medición independiente, aunque no haya pistas. Los eventos antiguos permanecen inmutables; sus marcas de ayuda se conservan de forma prudente.

En preguntas de elección, «Dejar sin responder» registra un intento omitido con respuesta nula. Conserva la selección como borrador y permite volver después, sin mostrar la solución ni las explicaciones de opciones. El intento posterior aumenta su ordinal y no sustituye la omisión inicial. Omitir queda separado de responder incorrectamente; este control todavía no es un modo de examen ni una política de omisión para editores de código.

## Python y JavaScript

La modalidad `code` usa entradas JSON en la variable `input` y compara la salida con varios casos preparados durante la autoría. El estado de cada ejecución se descarta. JavaScript se ejecuta como módulo en un worker; Python utiliza Pyodide314.0.7/CPython3.14.2. No hay instalación de paquetes, entrada interactiva, acceso a la red ni ficheros persistentes. Un resultado correcto acredita los casos probados, no una demostración universal del programa.

El worker vive dentro de un iframe opaco. Su CSP conserva `connect-src 'none'`; solo recibe fuente, entrada y archivos públicos del intérprete. El cargador fijo tiene hash en la CSP de producción. El worker de módulo usa una URL data para la compatibilidad observada en Chromium y WebKit. La carga de Python es diferida: cuatro archivos, aproximadamente12.7MiB sin compresión. La preparación offline incluye Python solo si los paquetes descargados lo necesitan.

Los límites actuales son50KB de código,16KB de entrada,100 líneas/16KB de salida,20 segundos de arranque y2 segundos de ejecución. Cancelar o superar tiempo termina el worker. No existe un límite duro de memoria independiente del navegador. Estos límites deben calibrarse en dispositivos físicos. La inyección del módulo Emscripten en `loadPyodide` usa una opción experimental de la API; la versión está fijada y cualquier actualización exige repetir las pruebas.

Las comprobaciones de código guardan resultados correctos, incorrectos y errores de ejecución. Un fallo de descarga o arranque y una cancelación no se convierten en un error del alumno. En SQL se distingue igualmente el error de la consulta del fallo al preparar el entorno. Cada intento conserva su diagnóstico y la versión del corrector.

## HTML y CSS

La modalidad `html-css` conserva ambos editores como un único borrador. La vista usa DOM y CSS reales dentro de un iframe de origen opaco. Solo se admite marcado estático acotado:200 elementos y50KB. Scripts, controladores de eventos, navegación, documentos anidados y recursos externos se eliminan o bloquean. Las modalidades que necesitan esos comportamientos deberán usar actividades específicas y no se considerarán cubiertas por esta vista.

La corrección mide selectores, texto, atributos o estilos calculados en varios anchos preparados. Las respuestas esperadas permanecen en el corrector; no se ejecutan expresiones del paquete. Un selector sin elemento no puede satisfacer una expectativa vacía. La comprobación se limita a los casos declarados y conserva resultados e intentos. El ancho del ejercicio puede desplazarse dentro de la vista en pantallas pequeñas, sin ensanchar la interfaz.

Los avisos de los motores se incluyen en `public/licenses/runtime-notices.txt`. La auditoría permite únicamente el ZIP público exacto de la biblioteca estándar de Pyodide, identificado por SHA-256; sigue rechazando otros archivos ZIP y cualquier paquete de estudio privado.
