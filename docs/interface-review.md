# Revisión de interfaz web

Fecha: 24 de septiembre de 2026.

## Alcance

Actualización de la interfaz existente de Nexo, conservando HTML, CSS y JavaScript. Se revisaron las ocho secciones operativas, las pantallas de acceso y registro y los diálogos de operaciones y perfil. No se modificó el backend ni se publicaron cambios de permisos o datos de usuarios durante las pruebas de interfaz.

Se utiliza [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/) como referencia para contraste, teclado, foco, etiquetas y redistribución del contenido. Esta revisión no constituye una certificación de conformidad completa.

## Cambios

- Tablas con texto ajustable en escritorio y presentación por fichas con etiquetas en pantallas de hasta 640 px.
- Rejillas de indicadores y almacenes que se adaptan al ancho disponible.
- Botón de perfil visible en móvil y controles principales de al menos 44 px de alto.
- Menú móvil con botón de cierre, fondo, cierre mediante Escape, confinamiento del foco y contenido de fondo inerte. El menú cerrado queda fuera de la navegación por teclado.
- Barra lateral desplazable para que todas las opciones sigan disponibles en ventanas bajas.
- Enlace para saltar al contenido, encabezados de tabla identificados y diálogos con nombre accesible.
- Foco visible en controles y búsquedas; cambios de sección llevan el foco al título.
- Texto secundario, estados y unidades con colores más legibles; leyenda del gráfico visible en todos los tamaños y borde en la serie clara.
- Formularios y panel de usuarios adaptados a pantallas estrechas; cierre de diálogos disponible al desplazarse.
- Búsquedas con contador anunciado y estado vacío. Corrección de singular/plural.
- Fechas identificadas como datos de demostración y aviso preciso de que los cambios de inventario se restablecen al recargar.
- Reintento del módulo operativo si falla su descarga y corrección de temporizadores superpuestos en notificaciones.
- Respeto de la preferencia de movimiento reducido.

## Verificación

- Navegación por Resumen, Inventario, Lotes, Compras, Movimientos, Mermas, Proveedores y Almacenes a 320, 768 y 1440 px: sin desbordamiento horizontal de la página en las mediciones realizadas. Las tablas intermedias pueden desplazarse dentro de su contenedor.
- Revisión visual adicional a 390 px, incluidos proveedores y resumen.
- Búsqueda sin coincidencias y búsqueda de un artículo, apertura del detalle de lote y cierre con Escape.
- Formulario de movimiento: rechazo de una salida superior al stock; cancelación sin registrar el movimiento.
- Diálogo de usuarios a 320 px: controles de perfil y estado sin recortes horizontales. No se enviaron cambios de permisos.
- Pantallas de acceso y registro en escritorio y móvil; prueba de presentación de un error OAuth sin cerrar la sesión existente.
- Revisión de contraste de texto mediante estilos calculados y corrección de las unidades y botones de detalle detectados.
- `node --check` sobre los scripts modificados y `git diff --check`.
- `npm test`: 15 pruebas aprobadas y 2 omitidas por requerir el emulador de Firestore; ningún fallo. Estas pruebas cubren el backend, no sustituyen la revisión visual.

Pendiente para una validación integral: lectores de pantalla en dispositivos reales, Safari/iOS, Firefox, zoom y ajustes del sistema, y pruebas automáticas de accesibilidad y regresión visual en CI.

## Recomendaciones priorizadas

| Prioridad | Cambio | Resultado esperado |
| --- | --- | --- |
| 1 | Persistir inventario, compras, movimientos y mermas en Firestore con validaciones y transacciones en la API | Evitar pérdida de cambios y mantener existencias consistentes entre usuarios |
| 2 | Implementar altas y edición de artículos, proveedores y almacenes, con permisos y auditoría del servidor | Sustituir los catálogos de demostración por operaciones reales |
| 3 | Incorporar búsqueda, filtros por fecha/estado y paginación desde la API | Mantener la interfaz ágil con catálogos grandes y controlar lecturas |
| 4 | Añadir alertas de stock y caducidad calculadas a partir de datos reales | Priorizar reposición y reducir pérdidas |
| 5 | Incorporar recuperación de acceso para cuentas con contraseña y estados claros de conectividad | Reducir bloqueos de acceso y explicar los fallos de red |
| 6 | Automatizar pruebas de navegación, accesibilidad y capturas en CI | Detectar regresiones antes de publicar |
| 7 | Preparar despliegue HTTPS, observabilidad y respaldo/restauración conforme al presupuesto | Operar fuera de localhost con capacidad de diagnóstico y recuperación |

Después de esta revisión se incorporó la primera aplicación Flutter, organizada con Mobile-D y MVVM. Su alcance y validación se documentan en [la guía móvil](../mobile/README.md). La persistencia del inventario en la API compartida sigue pendiente.
