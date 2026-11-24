# Almacenes y abastecimiento · actualización 29/09/2026

Enfoque: distribuidoras y empresas con almacenes que abastecen a puntos de venta o clientes. Hospitales quedan fuera del alcance. El inventario de la web reemplaza los datos ilustrativos por operaciones persistentes; el catálogo inicial está vacío para no confundir ejemplos con existencias reales.

## Preparación y recorrido de demostración

1. Administrador: en **Mi empresa**, guardar nombre y logo del cliente (PNG/JPEG/WebP, hasta 5 MB; ajuste automático y vista previa antes de guardar). El nombre y logo aparecen en el panel y en el acceso. El consentimiento de Google conserva la marca configurada en Google Cloud.
2. Crear un **Almacén** y registrar proveedor y destinatario en **Empresas y puntos de venta**.
3. En **Artículos**, crear SKU, nombre, tipo y unidad. Se puede editar nombre o desactivar; SKU y unidad permanecen estables para proteger el historial.
   Para altas masivas, usar **Importar CSV** con las columnas `SKU`, `Nombre`, `Tipo` y `Unidad` (hasta 200 filas).
4. En **Inventario → Configurar mínimo**, definir el mínimo por artículo y almacén. El umbral es editable repitiendo esta acción.
5. En **Recibir mercancía**, registrar dos recepciones, por ejemplo 5 y 8 piezas, con lotes y referencias distintas.
   Para migrar saldos existentes, **Importar existencias** acepta un CSV de hasta 100 filas con SKU, almacén, proveedor, lote, cantidad, caducidad y referencia.
6. Opcionalmente, usar **Transferir** para mover existencias por PEPS entre dos almacenes conservando lote y caducidad.
7. Crear una **Solicitud de abastecimiento** por 7 piezas, identificando empresa o punto de venta de destino. Puede hacerlo el nuevo perfil Solicitante.
8. Almacén o Administrador: **Aprobar y reservar**. Se reservan 5 piezas de la primera recepción y 2 de la segunda, sin reducir todavía el físico.
9. **Despachar** descuenta las reservas y el físico. Solicitante o Administrador confirma la recepción.
10. En **Lotes y trazabilidad**, consultar proveedor, transferencias, entrada, despacho, destinatario, confirmación, responsable y documento. Recargar conserva los registros.

## Reglas operativas

- PEPS ordena por fecha/hora de recepción, con ID como desempate. Cada recepción crea una capa independiente, aunque tenga el mismo número de lote. No es una implementación de valoración contable PEPS.
- Piezas: enteros. Kilogramos y litros: hasta 3 decimales. La API guarda cantidades como enteros en milésimas, evitando acumular errores de coma flotante. Ejemplo: 1.250 kg se almacena como `1250`.
- Físico: suma de existencias. Reservado: suma comprometida por solicitudes aprobadas. Disponible: suma no reservada de lotes no caducados. La fecha de caducidad se interpreta con el día de `America/Mexico_City`; es utilizable durante ese día.
- Stock bajo: disponible **menor** al mínimo del artículo en ese almacén. Sin mínimo se muestra **Sin configurar**. El valor cero desactiva efectivamente esa alerta.
- No se permiten salidas, reservas o mermas superiores al saldo disponible correspondiente. Los lotes caducados no se despachan. Si una reserva caduca antes del despacho, se cancela y se crea una nueva solicitud.
- Cada solicitud admite hasta 20 artículos. La aprobación reserva la cantidad completa de todos ellos; si uno no tiene disponibilidad, no se aprueba parcialmente.
- Una solicitud aprobada puede despacharse en varias entregas. Permanece **Parcialmente despachada** hasta entregar todas las cantidades; entonces el solicitante puede confirmar la recepción completa.
- Cancelar una solicitud Pendiente/Aprobada/Parcialmente despachada libera únicamente sus reservas pendientes. Los despachos realizados y las confirmaciones no se borran ni se repiten.
- Las escrituras se ejecutan en transacciones Firestore. Los formularios envían `_operationId` para que un reintento idéntico no duplique la operación; reutilizarlo con otros datos devuelve 409.
- Una salida se limita a 100 capas de recepción para mantenerse dentro de los límites de transacción. Si requiere más, se divide en solicitudes más pequeñas.
- Preparar una transferencia reserva por PEPS las existencias en el origen. **Enviar** descuenta el origen y deja la mercancía en tránsito; **Recibir** crea las capas en el destino conservando lote y caducidad; **Rechazar** la devuelve al origen. Una transferencia preparada también puede cancelarse para liberar sus reservas.
- El conteo físico se registra por lote. La diferencia aumenta o reduce ese lote y queda en movimientos con cantidad anterior, contada, motivo, referencia y responsable. Nunca puede reducir el lote por debajo de su cantidad reservada.
- Una devolución de cliente crea una nueva capa en el almacén receptor con el lote y caducidad originales. No puede superar la cantidad previamente despachada de ese lote que aún no haya regresado.
- Una devolución a proveedor descuenta únicamente la cantidad no reservada del lote seleccionado. Ambas devoluciones registran contraparte, motivo, referencia y responsable.
- Las solicitudes no son órdenes de compra. Comprar abastece desde proveedores; solicitar abastece a destinos. Confirmar una entrega no crea automáticamente inventario dentro de una empresa externa.
- Cada orden de compra admite hasta 20 artículos. Las recepciones se registran por artículo y pueden dividirse en varias entregas sin superar la cantidad pendiente de cada renglón.

## API para web y futura integración móvil

Todos requieren sesión activa, y las escrituras validan rol y origen. Prefijo: `/api/v1/operations`.

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/snapshot` | Datos del panel; filtra las solicitudes por propietario para Solicitante |
| PATCH | `/company` | Nombre/logo público del cliente; solo Administrador |
| POST | `/articles` | Alta de artículo; Administrador/Compras |
| POST | `/articles/import` | Alta atómica de hasta 200 artículos; Administrador/Compras |
| POST | `/inventory/import` | Carga inicial atómica de hasta 100 existencias; Administrador/Almacén |
| PATCH | `/articles/{id}` | Nombre y activación del artículo |
| POST | `/warehouses` | Crear almacén; Administrador |
| POST | `/partners` | Crear proveedor, cliente o punto de venta |
| POST | `/policies` | Mínimo por artículo/almacén |
| POST | `/receipts` | Entrada de lote; `purchaseId` opcional para recepción contra compra |
| POST | `/issues` | Salida PEPS con destinatario y referencia |
| POST | `/transfers` | Preparar transferencia PEPS; Administrador/Almacén |
| PATCH | `/transfers/{id}` | Acción `send`, `receive`, `reject` o `cancel` |
| POST | `/waste` | Merma del lote, causa y cantidad |
| POST | `/counts` | Conteo físico y ajuste por lote; Administrador/Almacén |
| POST | `/returns/customer` | Entrada por devolución de cliente |
| POST | `/returns/supplier` | Salida por devolución a proveedor |
| POST | `/purchases` | Compra a proveedor con hasta 20 artículos |
| POST | `/requests` | Solicitud de abastecimiento con hasta 20 artículos |
| PATCH | `/requests/{id}` | Acción `approve`, `dispatch` parcial, `receive` o `cancel` |

`quantity` y `minimum` de entrada están expresados en unidad base; cantidades en respuestas (`quantity`, `qty`, `reserved`, `minimum`, `received`) están expresadas en milésimas. La interfaz divide entre 1000 para mostrarlas. Los IDs son referencias estables, no nombres.

Colecciones Firestore bajo el namespace configurado: `ops_articles`, `ops_warehouses`, `ops_partners`, `ops_batches`, `ops_policies`, `ops_requests`, `ops_transfers`, `ops_events`, `ops_purchases`, `ops_settings` y `ops_commands`. Solo el servidor accede a ellas. La auditoría administrativa existente también registra las escrituras operativas.

## Límites de esta entrega

Una empresa por instalación/namespace; no es todavía un SaaS multicliente con organizaciones independientes. El perfil Solicitante representa a una persona autorizada que solicita mercancía e identifica su destino, no una integración con el sistema de otra empresa. La trazabilidad termina en la entrega registrada.

La tabla de inventario tiene búsqueda, filtro, exportación CSV y páginas de 30 filas. El snapshot aún carga colecciones completas: no se afirma capacidad para millones de movimientos ni alta concurrencia. Para esos volúmenes se necesitan consultas paginadas en servidor, proyecciones de saldos, pruebas de carga y revisión del bloqueo transaccional compartido.

No incluye autorizaciones previas de devolución, sesiones de conteo con aprobación, valoración contable ni sincronización offline. El CSV de catálogo crea artículos y el CSV de existencias crea lotes y saldos iniciales con trazabilidad. Las transferencias manejan preparación, tránsito, recepción, rechazo y cancelación; los conteos actuales ajustan un lote a la vez. La app Flutter aún necesita consumir estos endpoints. La modificación del repositorio no publica automáticamente el backend.

## Funciones agregadas · 23/11/2026

Todas se calculan en la web con los datos ya descargados, por lo que también funcionan sin conexión. El perfil Solicitante no las ve, salvo el escaneo dentro de su formulario de solicitud.

- **Alertas** (menú *Alertas*): lotes caducados y por caducar en 7, 15, 30, 60 o 90 días, con nivel de urgencia (Caducado, Crítico ≤ 7 días, Próximo ≤ 15 días), valor a costo, acción sugerida y botones para registrar la merma o devolver al proveedor con el lote ya seleccionado. Incluye el stock bajo. El *Resumen* muestra los lotes que caducan en 30 días. Con **Avisarme en este navegador**, Nexo muestra una notificación al día cuando hay lotes caducados o que caducan en 7 días o menos.
- **Kardex** (menú *Kardex*): por artículo, de todos los almacenes o de uno, con rango de fechas. Muestra saldo inicial, entradas, salidas, saldo y, si hay costos, importe y valor del saldo por capa PEPS. Usa la misma clasificación de movimientos que *Indicadores*. Se exporta a CSV o se imprime. Si el saldo no coincide con la existencia física, lo indica.
- **Sugerencias de compra** (menú *Sugerencias de compra*): consumo diario de los últimos 90 días (salidas PEPS y despachos), punto de reorden = consumo diario × (tiempo de entrega + stock de seguridad) y nunca menor que la suma de mínimos. Si el disponible más lo que viene en camino (órdenes no recibidas) es menor, sugiere comprar hasta cubrir los días indicados. Las cantidades y el proveedor se pueden ajustar; **Crear órdenes de compra** genera una orden por proveedor (referencia `SUG-AAAAMMDD-n`, hasta 20 artículos cada una).
- **Datos de abastecimiento del artículo**: código de barras opcional (4 a 40 letras, números, punto o guion; único frente a otros códigos y SKU), proveedor preferido y tiempo de entrega en días (7 si no se indica). Editar un artículo desde una versión anterior de la app conserva estos datos.
- **Documentos imprimibles** (o PDF desde el diálogo de impresión): orden de compra con importe estimado, remisión / vale de salida de una solicitud, comprobante de cualquier movimiento (recepción, merma, ajuste, transferencia…), hoja de conteo físico por almacén (opcionalmente a ciegas), kardex y reporte de caducidades. Llevan nombre y logo de la empresa, folio y líneas de firma; siempre se imprimen en blanco y negro.
- **Etiquetas con código de barras Code 128**: por artículo (código de barras o SKU) o por lote (código `L` + 10 caracteres que identifica la capa exacta). Se imprimen 3 por fila en hoja carta.
- **Escaneo**: botón *Escanear* en la barra de cada pantalla y campo de escaneo en los formularios que eligen artículo o lote. Acepta lectores USB o Bluetooth (funcionan como teclado), la cámara del celular en navegadores con `BarcodeDetector` (Chrome para Android) o el código escrito a mano. Reconoce etiqueta de lote, código de barras, SKU y número de lote. En compras y solicitudes, cada escaneo llena la siguiente línea o agrega una nueva.

## Funciones agregadas · prioridad media

- **Conteos cíclicos con aprobación** (menú *Conteos cíclicos*): Almacén abre un conteo por almacén (opcionalmente por tipo de artículo, máximo 200 lotes) y se congelan las cantidades esperadas, ordenadas por ubicación. Se captura a ciegas o con la cantidad del sistema, se puede escanear el lote para ir a su renglón y guardar avances. Al enviarlo a revisión, el Administrador ve diferencias y su valor y puede **reabrir** o **aprobar**. Al aprobar, cada diferencia se suma a la existencia actual del lote (respetando las salidas o entradas hechas mientras el conteo estaba abierto) y se registra como Ajuste positivo/negativo con la referencia del conteo. Solo puede haber un conteo abierto por almacén. `POST /count-sessions`, `PATCH /count-sessions/{id}` con `record`, `submit`, `reopen`, `approve` o `cancel`. A ciegas es una práctica de trabajo: el administrador siempre ve la cantidad esperada.
- **Ubicaciones**: cada lote puede tener una ubicación (ej. `A-03-2`, hasta 30 caracteres) al recibirlo o con **Ubicar** en *Lotes y trazabilidad* (`PATCH /batches/{id}`). Las solicitudes aprobadas imprimen una **Lista de surtido** ordenada por ubicación, y las hojas de conteo también siguen ese orden.
- **Unidades de empaque**: el artículo puede tener un empaque de compra (nombre y unidades base, ej. Caja de 12 pzas). En los formularios con cantidad aparece un selector para capturar en piezas o en empaques; se convierte a la unidad base antes de enviarse, por lo que el inventario sigue en unidades base. Las sugerencias de compra se redondean a empaques completos y la orden de compra muestra la equivalencia.
- **Avisos** (campana en la barra superior): nuevas solicitudes y transferencias en tránsito para Almacén, cambios de estado de las solicitudes propias para Solicitante, conteos listos para revisión para Administrador, artículos bajo el punto de reorden para Compras y lotes críticos. Se calculan con los datos descargados; abrir la campana los marca como leídos en ese navegador. La pantalla se actualiza sola cada minuto si la persona no está escribiendo y avisa con un mensaje (y con notificación del navegador si la pestaña está en segundo plano y se permitieron).
- **Bitácora** (menú *Bitácora*, solo Administrador, `GET /audit`): últimos 500 registros de accesos, cambios de usuarios y operaciones de inventario con usuario, fecha, acción y referencia. Se filtra por usuario, tipo y texto, y se exporta a CSV. Las operaciones nuevas guardan la referencia, nombre o acción; las anteriores solo el tipo.

## Verificación

`npm test` ejecuta validación, autorización, PEPS entre lotes, concurrencia, reservas, solicitudes de varios artículos, despachos parciales, cancelación, caducidad, compras parciales e idempotencia. `npm run test:firestore` ejecuta la misma suite contra el emulador local; requiere Java 21.

La prueba visual usa una instancia separada con datos de prueba: artículo → recepción de 20 piezas → solicitud de 7 → reserva → despacho → confirmación → recarga → trazabilidad. No inserta existencias de ejemplo en el namespace del cliente.
