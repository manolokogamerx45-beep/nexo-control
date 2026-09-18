# JIDE NOVA CORE

## Nexo · Centro de Control

Interfaz web demostrativa de **JIDE NOVA CORE** para gestionar inventario, lotes, compras, movimientos y mermas en distribuidoras y talleres manufactureros.

## Ejecutar localmente

Requiere Node.js. No necesita instalar dependencias.

```sh
node preview.cjs
```

Abrir <http://127.0.0.1:4173>.

## Funcionalidades

- Resumen operativo e indicadores ilustrativos.
- Inventario multi-almacén con búsqueda, filtros y exportación CSV.
- Consulta de lotes y recorrido ilustrativo.
- Borradores de órdenes de compra.
- Registro de entradas, salidas y mermas de almacenamiento.
- Consulta de proveedores y almacenes.

## Alcance actual

Esta versión es un prototipo de interfaz con datos ficticios. Los cambios viven en la memoria de la página y se pierden al recargarla. No dispone de API, base de datos, autenticación empresarial ni sincronización multiusuario. El historial inicial y la gráfica son ejemplos, no un registro contable reconciliado.

La fecha de referencia del escenario es el 18 de septiembre de 2026. No introducir información real o sensible en esta demostración.

## Estructura

```text
dist/
  index.html       Estructura y metadatos
  styles.css       Diseño adaptable
  app.js           Vistas, datos de muestra e interacciones
preview.cjs        Servidor HTTP local
.openai/hosting.json  Configuración del sitio existente en Sites
```

`dist/` contiene el código fuente estático y debe mantenerse en Git. Los paquetes temporales de publicación están excluidos mediante `.gitignore`. Las tipografías se cargan desde Google Fonts con fuentes de respaldo del sistema.

## Siguiente etapa

Conectar la interfaz a una API versionada con contratos OpenAPI, autenticación, aislamiento por empresa y persistencia en PostgreSQL. Las validaciones de stock, permisos, idempotencia y trazabilidad deberán ejecutarse también en el servidor.
