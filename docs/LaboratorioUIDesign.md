# Diseño de interfaz de Laboratorio TAI

El mapa del temario es la portada de Laboratorio TAI. La idea aprobada consiste en elegir un tema, ver su avance y estudiar sus lecciones en orden. Este documento desarrolla esa dirección y propone cómo encajar la lectura, las actividades, el repaso, las evaluaciones y los ajustes. El diseño completo se aprobó para implementación.

El móvil es un dispositivo habitual de estudio. El recorrido completo debe permitir leer, resolver, consultar el caso y revisar resultados tanto en móvil como en escritorio. Cada pantalla se adapta al espacio y a la forma de interacción de cada dispositivo.

## Qué resuelve el rediseño

La portada actual reúne reanudación, indicadores de aprendizaje, diagnóstico, sesiones, exámenes, catálogo y gestión de Drive en una sola página. Con el catálogo completo de la revisión anterior, el buscador de lecciones quedaba después de 66 exámenes. El buscador de la cabecera pertenece a la biblioteca general. Al abrir una lección y volver, se perdían la consulta y el filtro de bloque.

En la captura de la lección, el aviso de conexión, el estado de sincronización, las opciones y el enlace de vuelta preceden al título. Más abajo, explicación y actividad se leen en paralelo. La pregunta queda después de nueve botones de actividad y las respuestas empiezan casi al final de la ventana. La explicación disponible se anuncia como apoyo mientras el usuario intenta resolver la pregunta. La acción más importante de cada momento necesita ocupar la parte central de la pantalla.

## Navegación

| Destino | Contenido | Entrada |
| --- | --- | --- |
| **Temario** | Reanudar estudio, mapa por bloques y búsqueda propia | Portada del Laboratorio |
| **Tema** | Avance del recorrido, lecciones ordenadas, test del tema y enlaces a sus repasos | Fila del mapa o resultado de búsqueda |
| **Lección** | Lectura, práctica y comprobación | Tema, búsqueda o reanudación |
| **Repaso** | Errores pendientes, recuperaciones programadas, comprobaciones de transferencia y diagnóstico | Navegación del Laboratorio y accesos contextuales |
| **Exámenes** | Supuestos, simulacros e historial de entregas. Los tests de tema tienen también su entrada en el tema | Navegación del Laboratorio |
| **Ajustes del Laboratorio** | Cuenta, sincronización, paquetes, descargas y copias del progreso | Cabecera del Laboratorio y detalle del estado de guardado |

La navegación de la portada muestra **Temario · Repaso · Exámenes**. Ajustes queda en la cabecera con un nombre accesible. En móvil, **Laboratorio** tiene un acceso directo desde la navegación general de TAI Hub. Dentro de una lección, sesión o examen, la cabecera se reduce a la salida contextual y al estado necesario. En móvil, la navegación general deja sitio a la tarea abierta. La acción **Volver al tema** o **Volver a exámenes** sigue disponible.

### Portada y mapa

- **Una sola tarjeta de continuación.** Identifica el bloque, el tema, la lección y el punto guardado. El botón dice «Empezar tema», «Continuar lectura» o «Reanudar actividad» según el destino real. La última posición de estudio prevalece sobre las recomendaciones de repaso. Con historial disponible de otro dispositivo, se puede recuperar la actividad o la etapa registrada. La posición exacta dentro de la lectura se restaura en el dispositivo donde se guardó.
- **Mapa del temario.** Selector de bloques II, III y IV. Cada tema muestra código, título, porcentaje y recuento. Se abre el bloque del último tema estudiado. Sin historial, se destaca el inicio del itinerario principal en III.1 y se puede empezar por cualquier tema disponible. El bloque II conserva su propio recorrido.
- **Escritorio.** Temas a la izquierda y recorrido del tema seleccionado a la derecha. La búsqueda de lecciones vive junto al mapa y muestra cada resultado con su tema. Buscar, elegir un tema y reanudar son acciones visibles sin atravesar el catálogo de evaluaciones.
- **Móvil.** Una lista de temas para el bloque activo. Tocar una fila abre la página del tema. El botón visible y el gesto Atrás del navegador recuperan el bloque, la búsqueda, el desplazamiento y el foco en la fila elegida. Los temas permanecen accesibles por orden oficial.
- **Tema.** «Continuar tema» abre la primera lección pendiente del itinerario. Una lección en curso muestra su posición guardada. Las lecciones previas se pueden reabrir y las posteriores consultar libremente. Al cerrar la última, se ofrece el siguiente tema del mismo recorrido. Si quedan actividades sin responder, se ofrece volver a ellas.

### Qué mide el progreso

El mapa muestra **lecciones completadas / lecciones disponibles del tema**, con ambos números visibles. Ejemplo ilustrativo: «40 % · 2 de 5 lecciones». Una lección está completada cuando todas sus prácticas y comprobaciones obligatorias tienen una respuesta registrada. Una respuesta incorrecta o parcial cuenta como actividad respondida y conserva su resultado para revisión. Un borrador, una visita o una omisión deja la actividad pendiente. El indicador no mezcla tests, exámenes, repaso diferido ni reservas con el recorrido de lecciones.

El cálculo usa el historial de la cuenta y las versiones aplicables. Cada lección cuenta una vez dentro del tema. Si figura en varios temas, el mismo avance se refleja en cada uno, y un agregado de bloque cuenta cada lección una sola vez. Una edición anterior con trabajo guardado sigue accesible. Su avance se atribuye a esa edición salvo equivalencia de contenido comprobada. Si cambia el número de lecciones disponibles, se muestra el nuevo total junto al porcentaje. Una actualización no debe parecer una pérdida de respuestas.

«0 %» significa que hay lecciones disponibles y aún no se ha completado ninguna. «Sin contenido disponible» se usa cuando el catálogo cargado carece de lecciones para el tema. Un catálogo pendiente de cargar muestra ese estado. Una lección sin actividades obligatorias, si se incorpora al catálogo, necesita un criterio explícito de cierre antes de contribuir al indicador.

El tema ofrece un detalle de **Comprensión, retención y transferencia**. Muestra recuentos y objetivos concretos, con sus condiciones y repasos. Puede haber un recorrido al 100 % con comprobaciones diferidas pendientes. La etiqueta «Objetivo consolidado» conserva el significado de las reglas de aprendizaje existentes. [Contratos de aprendizaje](laboratory.md)

## La lección

La cabecera muestra **Volver al tema**, el código del tema, el título y un recuento discreto de actividades. Debajo aparece **Leer · Practicar · Comprobar**. Cada etapa existe cuando la lección tiene contenido de ese tipo. La apertura habitual de una lección nueva empieza en Leer. Una reanudación explícita abre el punto guardado. La navegación permite consultar una etapa anterior sin marcarla como realizada.

En móvil, el enlace **‹ Tema III.1** reúne el código y la vuelta al tema. Su nombre accesible identifica la acción y el destino. El título de la lección admite varias líneas. «Actividad 3 de 9» va junto al ejercicio y abre su índice mediante **Ver actividades**.

| Etapa | Escritorio | Móvil |
| --- | --- | --- |
| **Leer** | Texto con líneas de 65–72 caracteres. Índice lateral de secciones si la lectura es larga. Ejemplo resuelto en el recorrido | Una columna. Índice desplegable cuando haga falta. «Empezar práctica» al final |
| **Practicar** | Una actividad en la zona principal. Explicación o ejemplo en un panel lateral que se abre al pedirlo. Los ejercicios con editor o tablas aprovechan el ancho | Una actividad por vista. «Consultar explicación» abre una vista de referencia y devuelve a la pregunta y al borrador |
| **Comprobar** | Enunciado y respuesta en una columna. Referencia cerrada al entrar. Las comprobaciones que admiten consulta explican su efecto antes de abrirla | Mismo orden y controles. La ayuda permitida se pide de forma explícita y volver conserva la selección |

El selector de etapa sustituye a la competencia visual entre teoría y pregunta. Un indicador «Actividad 3 de 9» con un botón **Ver actividades** sustituye la fila permanente de botones. El índice muestra la actividad actual, las respondidas y las pendientes, con texto o símbolos además del color. **Anterior** y **Siguiente actividad** conservan el orden del tema.

### Resolver, comprobar y continuar

1. La actividad empieza por su propósito o por un enunciado neutro en comprobaciones. La pregunta y la respuesta quedan juntas. Las opciones mantienen su orden y la selección se conserva al abrir una ayuda o volver de un material.
2. **Comprobar respuesta** es la acción primaria antes del envío. **Dejar sin responder** se mantiene como acción secundaria cuando procede y deja la actividad pendiente. **Pedir pista** y **Consultar explicación** están cerca de la pregunta y explican su efecto antes de mostrar contenido. **Anotar una predicción** y **Ver solución** quedan en el grupo de ayudas de la práctica. Las reservas, comprobaciones y diagnósticos exponen las ayudas que autorice su modalidad.
3. Tras guardar, la corrección aparece junto a la respuesta. Muestra el resultado y una explicación breve. «Por qué cada opción», «Ver solución», «Fuentes y límites» e historial de intentos se abren cuando se necesitan. La interfaz distingue **Con apoyo de lectura**, **Con pista** y evidencia insuficiente cuando corresponde. Volver a una actividad ya respondida muestra su corrección guardada. Abrir una explicación después del intento conserva el registro de la primera respuesta.
4. Después de la corrección, la acción principal pasa a **Siguiente actividad**. En el cierre, **Siguiente lección** o **Volver al tema**. Si quedan actividades pendientes, el cierre muestra el recuento y ofrece **Ir a la primera pendiente**. La corrección permanece visible hasta que el usuario decide avanzar.

La disponibilidad de la explicación debe corresponder al registro de ayuda. Una referencia cerrada en la interfaz no basta para afirmar que la respuesta se resolvió sin apoyo. El registro existente de actividad, presentación, consulta y respuesta determina la evidencia. Consultar un PDF o apunte desde la lección conserva el origen, la sección, el desplazamiento y el foco al cerrar. La lectura sigue sujeta a la disponibilidad del recurso.

En móvil se probará un panel inferior para una pista o un ejemplo breve. Tendrá **Volver a la actividad** como botón visible. Al abrir cualquier diálogo, el foco entra en el diálogo y el contenido de fondo queda inactivo. Al cerrarlo con el botón o con Escape, vuelve al control que lo abrió y se recupera la posición de la pregunta. El gesto de arrastre, si se incorpora, será opcional. Para PDFs y apuntes largos se conserva el lector de pantalla amplia, con el mismo retorno a la pregunta. [Patrón de diálogo del W3C](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)

### Ejercicios con herramientas

Todos comparten enunciado, estado de guardado, acción de comprobación y corrección. Cada tipo mantiene sus controles propios.

| Tipo | Distribución |
| --- | --- |
| Elección y caso documental | Pregunta y opciones juntas. El caso documental identifica su naturaleza y da acceso a fuentes y límites. |
| SQL, Python y JavaScript | Enunciado breve. Editor amplio con pestañas o paneles para datos y salida. **Ejecutar** explora el resultado. **Comprobar** registra el intento cuando corresponde. Cancelar y reintentar quedan junto a la ejecución. |
| HTML y CSS | Editores y vista previa junto al resultado en escritorio cuando quepan. En móvil, vistas **HTML**, **CSS** y **Vista previa**, con el borrador compartido. Una vista que requiere un ancho fijo desplaza solo su contenido. |
| Modelos interactivos | Configuración, predicción y resultado en orden. La traza aparece tras guardar la predicción cuando la modalidad lo exige. Cambiar parámetros distingue la nueva configuración de los intentos anteriores. |

**Casos largos y documentos.** Si la pregunta depende de un enunciado largo o común, **Ver caso** queda junto a la pregunta. En escritorio se puede consultar en un panel lateral cuando haya ancho suficiente. En móvil abre una vista de lectura con **Volver a la pregunta**. Al volver se recuperan la actividad, la selección o el borrador, el desplazamiento y el foco. En un supuesto con varias preguntas, reabrir el mismo caso recupera el punto de lectura durante el intento. Los documentos que forman parte del enunciado se ofrecen desde el caso. Consultar material que el ejercicio entrega como parte del enunciado no cuenta como ayuda. Las pistas y explicaciones opcionales conservan su registro de apoyo. Las tablas anchas desplazan su propio contenido y la pregunta se ajusta al ancho de la pantalla.

**Editor en móvil.** SQL, Python, JavaScript y HTML/CSS ofrecen **Ampliar editor**. La vista ampliada dedica al editor el espacio que deja el teclado virtual y permite plegar el enunciado a una línea. Se puede consultar el caso o cambiar entre edición y salida sin perder texto, cursor ni selección. La línea activa queda a la vista mientras se escribe. **Ejecutar** y **Comprobar** quedan accesibles al cerrar el teclado. La salida aparece junto al editor en escritorio cuando el ancho lo permite. En móvil, la salida larga tiene una vista propia desde la que se vuelve al código. **Volver a la actividad** conserva el borrador y devuelve el foco a un control visible. Los atajos de símbolos se valorarán después de probar la escritura real en móvil. Completar huecos u ordenar bloques requeriría ejercicios preparados para evaluar esa tarea.

Un fallo al preparar el motor o guardar una respuesta se muestra junto a la acción que lo produjo. El mensaje distingue «puedes reintentar» de un resultado evaluado. Las acciones de recuperación permiten conservar una copia cuando existe trabajo pendiente. Las discrepancias entre borradores muestran las versiones y permiten elegir cuál continuar con el historial conservado. [Contratos de historial y ejecución](laboratory.md)

## Repaso y progreso de aprendizaje

**Repaso** abre una cola manejable de acciones. Cada fila indica tema, ejercicio y motivo: error pendiente, recuperación prevista o caso nuevo para aplicar lo estudiado. Un filtro por bloque o tema permite dedicar la sesión a un objetivo. «Ver detalle del tema» abre sus objetivos con la evidencia disponible. El orden de repaso puede cambiar al llegar nueva evidencia sin mover el punto de estudio lineal.

El diagnóstico inicial se ofrece como actividad opcional en Repaso, con un enlace contextual al empezar si hay contenido disponible. Sus resultados enlazan a los temas correspondientes. Cuando faltan datos, no hay variantes elegibles o aún no toca una recuperación, el estado explica qué ocurrió y permite volver al temario.

## Sesiones guiadas

Las sesiones son rutas opcionales desde el tema al que se vinculan. Cuando hay varias, **Sesiones guiadas** en Repaso permite explorarlas por bloque. La portada reanuda una sesión si era el último punto activo.

Antes de entrar se muestran tema, objetivos, duración orientativa y etapa guardada. Dentro, una sola etapa ocupa la zona de trabajo: recuperar, comprender, experimentar, transferir o cerrar. La cabecera «Etapa 2 de 5» abre el índice. El cierre resume actividades respondidas, pendientes y ayudas, con una reflexión opcional. Cerrar guarda el recorrido y permite volver a las pendientes. Las sesiones de práctica conservan sus límites de evaluación y no presentan reservas.

## Tests, supuestos y simulacros

El test de tema aparece tras el recorrido y conserva su entrada desde Exámenes cuando se consulta el historial. Los supuestos y simulacros se buscan por tipo y tema o bloque. Los intentos en curso aparecen primero con **Reanudar examen**. Abrir una ficha muestra duración, partes, número de preguntas ordinarias y de reserva, penalización y qué ocurre al salir. El reloj empieza al iniciar el intento y sigue al salir.

Durante el examen, la cabecera agrupa **Tiempo restante**, **Preguntas respondidas** y **Guardado**. En escritorio, la hoja de navegación puede acompañar a la pregunta. En móvil se abre con **Ir a una pregunta**, agrupada por parte y con las reservas identificadas. Volver conserva la respuesta y devuelve el foco. La corrección se habilita después de guardar la entrega.

En los supuestos, **Ver caso** permite alternar entre el enunciado común y la pregunta sin alterar el tiempo restante ni el estado de la hoja. Si una parte tiene su propio enunciado, la vista identifica la parte y recupera su posición de lectura dentro del intento.

**Revisar entrega** muestra los blancos por parte y ofrece volver a ellos. **Confirmar entrega** es la acción final. En resultados se distinguen puntuación directa de práctica, aciertos, errores, blancos, anulaciones y reservas aplicadas. La revisión empieza por errores y blancos y permite consultar todas las preguntas. Una repetición queda identificada como práctica cuando corresponda. [Patrón de hoja y revisión de Moodle](https://docs.moodle.org/503/en/Using_Quiz)

## Ajustes, conexión y recuperación

| Sección | Acciones y estados |
| --- | --- |
| **Cuenta y sincronización** | Conectar, reconectar, sincronizar, ver cambios pendientes y consultar el último estado confirmado. |
| **Catálogo** | En la primera apertura, **Cargar lecciones de Drive** si el catálogo ya existe o **Instalar paquetes** si es nuevo. Después, actualizar desde Drive e importar paquetes validados. Mostrar progreso y recuperación de una descarga incompleta aquí. |
| **Sin conexión** | Preparar en este dispositivo, comprobar archivos y ver qué contenidos están disponibles. Distinguir aplicación, lecciones y motores necesarios, y señalar qué recursos requieren conexión. |
| **Copia del progreso** | Exportar, restaurar para la misma cuenta y mostrar el resultado. Reiniciar historial tiene una confirmación propia con su alcance y la opción previa de exportar. |

En estudio, una línea basta para «Guardado en este dispositivo · 4 cambios por sincronizar» si el guardado local está confirmado. Su detalle abre la opción de reconectar. Si el problema impide estudiar o amenaza trabajo todavía en memoria, el aviso aparece junto a la actividad con la acción de recuperación. El diseño evita avisos duplicados entre TAI Hub y Laboratorio. En móvil, los ajustes se abren en una pantalla o en un diálogo que cabe en el ancho, con foco devuelto al salir.

## Dirección visual y criterios de aceptación

Mantener la tipografía del sistema y la paleta de TAI Hub. En claro, fondo `#f2f2f7`, superficie `#ffffff`, texto `#1c1c1e`, secundario `#555661`, divisores `#dcdce4` y acción `#005ab8`, con equivalentes en modo oscuro. Usar una fila por tema, divisores tranquilos y una barra fina de avance. Reservar superficies delimitadas para el elemento que requiere atención, como la tarjeta de reanudación o el editor activo. En móvil, una sola zona de trabajo visible y acciones principales en el flujo. Una barra fija solo se justifica si deja visibles el contenido y el foco con teclado, zoom y teclado virtual.

Al entrar en una actividad o cambiar de etapa, la vista se coloca en el título de la tarea. Una pregunta breve empieza en la primera pantalla del móvil, con la salida al tema y las etapas a mano. Los títulos largos pueden ocupar varias líneas. El estado de guardado usa una línea cuando cabe y los detalles se abren bajo demanda. Los controles táctiles principales ofrecen un área de al menos 44 × 44 px. Las transiciones respetan la preferencia de movimiento reducido y mantienen visible el foco. Seleccionar una respuesta, editar código o filtrar el mapa conserva el foco y la posición que el usuario está utilizando.

- **Estudio lineal.** Desde la portada, reanudar o llegar a cualquier tema sin pasar por un examen. Abrir una lección, volver al tema y restaurar foco y posición. Tras el cierre, encontrar la siguiente lección o tema.
- **Progreso.** Verificar tema nuevo, en curso, completo, sin catálogo y sin contenido. Comprobar una omisión, una respuesta incorrecta, ediciones simultáneas y una lección compartida.
- **Lección.** Alternar lectura, práctica y comprobación sin perder selección ni borrador. Probar preguntas extensas, nueve o más actividades, un editor, una tabla ancha y un PDF con retorno exacto. Verificar evidencia de ayuda antes y después del intento.
- **Evaluación y recuperación.** Reanudar un examen sin reiniciar su plazo. Entregar con blancos, revisar reservas y probar reconexión, guardado fallido y versiones en conflicto.
- **Adaptación.** Probar 320, 390, 768 y 1440 px, modos claro y oscuro, zoom, teclado y lector de pantalla. Verificar foco en Safari iOS y Chrome Android físicos cuando se implemente. [Reflujo](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) · [Foco visible ante paneles fijos](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum)

### Casos de uso para la primera entrega

| Caso | Resultado que hay que verificar |
| --- | --- |
| **Mapa, tema y lección con el catálogo real** | Abrir una lección desde un tema o una búsqueda. Volver con el bloque, la consulta, el desplazamiento y el foco recuperados. Probar títulos largos y un tema sin contenido. |
| **Cambio de etapa y actividad** | Elegir una opción en Practicar, pasar a Leer y volver. La selección sigue disponible. Después de comprobar, visitar otra actividad y volver a la primera muestra la respuesta y su corrección guardadas. |
| **Caso largo con tabla o documento** | Seleccionar una respuesta, abrir el caso, consultar un dato y volver a la misma pregunta. La selección sigue visible. Al reabrir el caso se recupera su posición. La consulta del enunciado conserva la misma clasificación de ayuda. |
| **SQL con teclado virtual** | Escribir una consulta de varias líneas, ampliar el editor, plegar y consultar el enunciado, y recuperar el cursor. Ejecutar, volver a editar y comprobar. Verificar que el teclado deja visible la línea activa. Al cerrarlo, la salida y los controles siguen accesibles. Probar un cambio de orientación con el borrador abierto. |
| **Consulta de ayuda o PDF** | Abrir la consulta y comprobar que recibe el foco. Probar el cierre con el botón y con Escape donde haya teclado. Volver al punto de trabajo y comprobar que la ayuda previa figura en el intento correspondiente. Probar un PDF disponible y otro que requiera reconectar. |
| **Interrupción y cambio de dispositivo** | Recargar en móvil y recuperar el último punto local. Tras sincronizar, abrir en escritorio la misma actividad con el borrador o la respuesta registrados. Los cambios pendientes solo se anuncian como guardados cuando se confirma su persistencia local. |

La primera entrega une **mapa, tema y lección**. Un caso largo y un ejercicio SQL forman parte de esa prueba desde el principio. Probar el teclado virtual, la vuelta desde una consulta y el foco en teléfonos reales, y repetir el recorrido con teclado y ratón en escritorio. Después se aplica la misma navegación a Repaso, sesiones, Exámenes y Ajustes.

## Referencia del prototipo navegable

El adjunto `laboratorio_tai_prototipo.html` ilustra el mapa, el índice de actividades bajo demanda, la consulta de un caso, el editor SQL y la hoja de examen. Los datos, el guardado y los resultados son de muestra. En la revisión con Chromium a 1440 px y WebKit a 390 y 320 px, cerrar el caso conservó la selección y devolvió el foco al botón. Cambiar de etapa borró la selección y abrir el diálogo dejó el foco fuera. La ampliación del editor conservó el cursor, aunque seguía dejando las acciones debajo del área inicial de la pantalla en móvil. Estos hallazgos motivan los casos de prueba anteriores. La validación del teclado virtual y del lector de pantalla requiere pruebas en dispositivos reales.

## Referencias de diseño

- **Duolingo.** Un camino visible ayuda a identificar el siguiente paso. Su sección de práctica es una referencia para consultar errores sin interrumpir el recorrido. [Camino de aprendizaje](https://blog.duolingo.com/new-duolingo-home-screen-design/) · [Sección de práctica](https://blog.duolingo.com/guide-to-duolingo-practice-hub/)
- **Microsoft Learn.** La jerarquía de itinerarios, módulos y unidades y la combinación de explicación, ejercicios y comprobaciones sirven de referencia para bloque, tema y lección. [Tipos de contenido](https://learn.microsoft.com/en-us/training/support/learn-content-types)
- **Khan Academy.** El detalle por unidad y habilidad inspira el desglose de evidencias por objetivo. Laboratorio TAI aplica sus propios criterios de aprendizaje. [Dominio por curso y unidad](https://support.khanacademy.org/hc/en-us/articles/115002552631-What-are-Course-and-Unit-Mastery)
- **Moodle.** Hoja navegable, resumen antes de entregar y corrección posterior. [Uso de cuestionarios](https://docs.moodle.org/503/en/Using_Quiz)
