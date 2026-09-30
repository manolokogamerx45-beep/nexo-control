# Almacenes y abastecimiento · actualización 29/09/2026

Enfoque: distribuidoras y empresas con almacenes que abastecen a puntos de venta o clientes. Hospitales quedan fuera del alcance. El inventario de la web reemplaza los datos ilustrativos por operaciones persistentes; el catálogo inicial está vacío para no confundir ejemplos con existencias reales.

## Preparación y recorrido de demostración

1. Administrador: en **Mi empresa**, guardar nombre y logo del cliente (PNG/JPEG/WebP, hasta 5 MB; ajuste automático y vista previa antes de guardar). El nombre y logo aparecen en el panel y en el acceso. El consentimiento de Google conserva la marca configurada en Google Cloud.
2. Crear un **Almacén** y registrar proveedor y destinatario en **Empresas y puntos de venta**.
3. En **Artículos**, crear SKU, nombre, tipo y unidad. Se puede editar nombre o desactivar; SKU y unidad permanecen estables para proteger el historial.
4. En **Inventario → Configurar mínimo**, definir el mínimo por artículo y almacén. El umbral es editable repitiendo esta acción.
5. En **Recibir mercancía**, registrar dos recepciones, por ejemplo 5 y 8 piezas, con lotes y referencias distintas.
6. Crear una **Solicitud de abastecimiento** por 7 piezas, identificando empresa o punto de venta de destino. Puede hacerlo el nuevo perfil Solicitante.
7. Almacén o Administrador: **Aprobar y reservar**. Se reservan 5 piezas de la primera recepción y 2 de la segunda, sin reducir todavía el físico.
8. **Despachar** descuenta las reservas y el físico. Solicitante o Administrador confirma la recepción.
9. En **Lotes y trazabilidad**, consultar proveedor, entrada, despacho, destinatario, confirmación, responsable y documento. Recargar conserva los registros.

## Reglas operativas

- PEPS ordena por fecha/hora de recepción, con ID como desempate. Cada recepción crea una capa independiente, aunque tenga el mismo número de lote. No es una implementación de valoración contable PEPS.
- Piezas: enteros. Kilogramos y litros: hasta 3 decimales. La API guarda cantidades como enteros en milésimas, evitando acumular errores de coma flotante. Ejemplo: 1.250 kg se almacena como `1250`.
- Físico: suma de existencias. Reservado: suma comprometida por solicitudes aprobadas. Disponible: suma no reservada de lotes no caducados. La fecha de caducidad se interpreta con el día de `America/Mexico_City`; es utilizable durante ese día.
- Stock bajo: disponible **menor** al mínimo del artículo en ese almacén. Sin mínimo se muestra **Sin configurar**. El valor cero desactiva efectivamente esa alerta.
- No se permiten salidas, reservas o mermas superiores al saldo disponible correspondiente. Los lotes caducados no se despachan. Si una reserva caduca antes del despacho, se cancela y se crea una nueva solicitud.
- La aprobación reserva la cantidad completa; no existe atención parcial de solicitudes en esta entrega. Se admite un artículo por solicitud. Las compras a proveedores sí permiten varias recepciones parciales.
- Cancelar una solicitud Pendiente/Aprobada libera sus reservas. Despachos y confirmaciones no se borran ni se repiten.
- Las escrituras se ejecutan en transacciones Firestore. Los formularios envían `_operationId` para que un reintento idéntico no duplique la operación; reutilizarlo con otros datos devuelve 409.
- Una salida se limita a 100 capas de recepción para mantenerse dentro de los límites de transacción. Si requiere más, se divide en solicitudes más pequeñas.
- Las solicitudes no son órdenes de compra. Comprar abastece desde proveedores; solicitar abastece a destinos. Confirmar una entrega no crea automáticamente inventario dentro de una empresa externa.

## API para web y futura integración móvil

Todos requieren sesión activa, y las escrituras validan rol y origen. Prefijo: `/api/v1/operations`.

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/snapshot` | Datos del panel; filtra las solicitudes por propietario para Solicitante |
| PATCH | `/company` | Nombre/logo público del cliente; solo Administrador |
| POST | `/articles` | Alta de artículo; Administrador/Compras |
| PATCH | `/articles/{id}` | Nombre y activación del artículo |
| POST | `/warehouses` | Crear almacén; Administrador |
| POST | `/partners` | Crear proveedor, cliente o punto de venta |
| POST | `/policies` | Mínimo por artículo/almacén |
| POST | `/receipts` | Entrada de lote; `purchaseId` opcional para recepción contra compra |
| POST | `/issues` | Salida PEPS con destinatario y referencia |
| POST | `/waste` | Merma del lote, causa y cantidad |
| POST | `/purchases` | Compra a proveedor |
| POST | `/requests` | Solicitud de abastecimiento |
| PATCH | `/requests/{id}` | Acción `approve`, `dispatch`, `receive` o `cancel` |

`quantity` y `minimum` de entrada están expresados en unidad base; cantidades en respuestas (`quantity`, `qty`, `reserved`, `minimum`, `received`) están expresadas en milésimas. La interfaz divide entre 1000 para mostrarlas. Los IDs son referencias estables, no nombres.

Colecciones Firestore bajo el namespace configurado: `ops_articles`, `ops_warehouses`, `ops_partners`, `ops_batches`, `ops_policies`, `ops_requests`, `ops_events`, `ops_purchases`, `ops_settings` y `ops_commands`. Solo el servidor accede a ellas. La auditoría administrativa existente también registra las escrituras operativas.

## Límites de esta entrega

Una empresa por instalación/namespace; no es todavía un SaaS multicliente con organizaciones independientes. El perfil Solicitante representa a una persona autorizada que solicita mercancía e identifica su destino, no una integración con el sistema de otra empresa. La trazabilidad termina en la entrega registrada.

La tabla de inventario tiene búsqueda, filtro, exportación CSV y páginas de 30 filas. El snapshot aún carga colecciones completas: no se afirma capacidad para millones de movimientos ni alta concurrencia. Para esos volúmenes se necesitan consultas paginadas en servidor, proyecciones de saldos, pruebas de carga y revisión del bloqueo transaccional compartido.

No incluye transferencias internas con saldo en destino, devoluciones, conteos físicos, importación masiva, valoración contable ni sincronización offline. La app Flutter aún necesita consumir estos endpoints. La modificación del repositorio no publica automáticamente el backend.

## Verificación

`npm test` ejecuta validación, autorización, PEPS entre lotes, concurrencia, reservas, cancelación, caducidad, compras parciales e idempotencia. `npm run test:firestore` ejecuta la misma suite contra el emulador local; requiere Java 21.

La prueba visual usa una instancia separada con datos de prueba: artículo → recepción de 20 piezas → solicitud de 7 → reserva → despacho → confirmación → recarga → trazabilidad. No inserta existencias de ejemplo en el namespace del cliente.
