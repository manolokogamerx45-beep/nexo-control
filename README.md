# JIDE NEXO · Control de inventario

Aplicación web y móvil para consultar inventario, almacenes, lotes, compras, proveedores, movimientos y mermas. La web utiliza HTML, CSS y JavaScript; la app móvil utiliza **Flutter y Dart**, con Android como primera plataforma. Ambas comparten una API Node.js y **Cloud Firestore de Firebase**. Docker Compose permite ejecutar la web y la API en contenedores independientes.

**Estado actual:** usuarios, perfiles, permisos, sesiones y auditoría tienen persistencia en Firestore. El inventario y las operaciones de almacén siguen usando datos de demostración en ambas interfaces; sus cambios no se sincronizan ni se guardan en la nube.

- [Guía de la app Android: ejecución, instalación y compilación](mobile/README.md)
- [Revisión de la interfaz web y recomendaciones](docs/interface-review.md)
- [Comprobaciones automáticas en GitHub Actions](https://github.com/manolokogamerx45-beep/nexo-control/actions)

## Funciones incluidas

| Área | Web | App Flutter |
| --- | --- | --- |
| Acceso | Google y contraseña, registro sujeto a aprobación | Google mediante navegador, contraseña y recuperación de sesión |
| Perfil y permisos | Edición del perfil, administración de usuarios y aprobaciones | Edición del perfil y pantalla de aprobación pendiente; respeta el rol recibido de la API |
| Inventario | Catálogo y operaciones de demostración | Búsqueda por artículo/SKU/lote, filtros, detalle y movimientos de prueba local |
| Consultas | Resumen, almacenes, lotes, compras, proveedores y mermas | Las mismas áreas con datos de ejemplo y navegación para teléfono/tableta |
| Interfaz | Tablas adaptables, menú móvil, navegación por teclado y mejoras de contraste | Material 3 en español, formularios desplazables y navegación adaptable |

## Tecnologías utilizadas

| Componente | Tecnología y función |
| --- | --- |
| Interfaz web | HTML, CSS y JavaScript en `dist/` |
| App móvil | Flutter y Dart en `mobile/`; Android primero |
| Servidor | Node.js 24 y API HTTP |
| Base de datos online | Firebase Cloud Firestore: usuarios, perfiles, permisos, sesiones y auditoría |
| Acceso con Google | OAuth 2.0 y OpenID Connect mediante `google-auth-library` |
| Contenedores | Docker Compose: servicios `web` y `auth-api` |
| Servidor web en Docker | Nginx: archivos públicos y proxy hacia la API |
| Versiones y comprobaciones | Git, GitHub y GitHub Actions |

El acceso con Google usa la API propia; no utiliza Firebase Authentication. Firestore proporciona el almacenamiento persistente.

## Metodologías y arquitecturas

La metodología define cómo se organiza el desarrollo; la arquitectura define cómo se distribuyen las responsabilidades del software.

| Plataforma | Metodología acordada | Arquitectura | Estado |
| --- | --- | --- | --- |
| Web | Iterativa e incremental | Cliente-servidor organizada en capas de presentación, lógica de negocio y acceso a datos | Implementada para autenticación y administración de usuarios; inventario de demostración |
| Móvil | Mobile-D | MVVM (Model–View–ViewModel), organizada por módulos | Primera app Flutter implementada: acceso y perfil por API; inventario de demostración |

### Web: desarrollo iterativo e incremental

El trabajo se realiza por entregas funcionales: definir el alcance de una mejora, implementarla, ejecutar las comprobaciones correspondientes, revisar el resultado y corregirlo con la retroalimentación del usuario. Cada incremento se registra en Git. No se ha establecido un proceso formal de Scrum con sprints, roles y ceremonias.

La arquitectura web separa estas responsabilidades:

- **Presentación:** HTML, CSS y JavaScript en `dist/`; muestra las pantallas y consume la API.
- **Lógica de negocio:** `server.cjs` y `lib/auth.cjs`; gestionan rutas HTTP, autenticación, sesiones, validaciones y permisos.
- **Acceso a datos:** `lib/database.cjs`; encapsula las operaciones y transacciones sobre Cloud Firestore.

Docker Compose define dos servicios, `web` (Nginx) y `auth-api` (Node.js). La lógica del backend está concentrada en una única API; separar la web y la API en contenedores no constituye todavía una arquitectura completa de microservicios de negocio.

### Móvil: Mobile-D y MVVM

Se adopta **Mobile-D** para organizar el desarrollo móvil en cinco fases. Se aplica por entregas; la primera versión está en [mobile/](mobile/README.md):

| Fase | Trabajo en Nexo |
| --- | --- |
| Exploración | Definir usuarios, necesidades, alcance y prioridades de la aplicación móvil |
| Inicialización | Preparar Flutter y Dart, la estructura MVVM, el entorno de pruebas y la conexión con la API |
| Producción | Implementar y probar incrementos: acceso, inventario, almacenes y movimientos |
| Estabilización | Integrar módulos, revisar contratos con la API y corregir problemas de funcionamiento |
| Pruebas del sistema | Validar los flujos completos, permisos y comportamiento en dispositivos Android e iOS |

La arquitectura móvil acordada es **MVVM por módulos**, con **Flutter y Dart**:

- **View:** pantallas y componentes visuales que muestran el estado y reciben acciones del usuario.
- **ViewModel:** estado de la pantalla, validaciones de presentación y coordinación de operaciones.
- **Model y repositorios:** modelos de datos y acceso a la API de Node.js.

La app Flutter consume el backend compartido para acceso y perfil. Google se abre en el navegador del sistema, reutiliza el cliente OAuth web y retorna un código de un solo uso ligado a PKCE. La sesión se guarda en el almacenamiento seguro del teléfono. Los permisos y las credenciales privadas de Firestore permanecen en el servidor. Android es la primera plataforma; la estructura iOS aún requiere compilación y verificación en macOS. Consulta [la guía móvil](mobile/README.md) para ejecutar y compilar.

Docker se utiliza para los servicios del backend y de la web, no dentro de la aplicación instalada en el teléfono. La persistencia del inventario y los endpoints de negocio necesarios para móvil siguen pendientes.

## Estado verificado del proyecto

Al 24 de septiembre de 2026:

- La ejecución local funciona con Node.js en `http://127.0.0.1:4173/`, conectada a Firestore online.
- El inicio de sesión real con Google y la conservación de la sesión al recargar fueron verificados en la web. El consentimiento y retorno de Google en el teléfono siguen pendientes de prueba con el usuario.
- La cuenta del propietario está activa como administrador. Esa asignación se guarda en Firestore, no en el código ni en Git.
- Docker está configurado; los contenedores no forman parte de la ejecución local verificada. Para utilizarlos, inicia Docker Desktop y sigue los pasos de esta guía.
- Las 18 pruebas del servidor pasaron con el emulador de Firestore. Las pruebas automatizadas de Google simulan la respuesta del proveedor.
- Flutter pasó el análisis estático y sus 7 pruebas de estado, API y pantallas. Se revisaron anchos de 320, 390 y 840 píxeles con texto ampliado al 150 %.
- Se generó un APK de desarrollo para Android 7.0 o posterior. La instalación y prueba en el celular del usuario están pendientes. iOS tiene estructura de proyecto, pero requiere compilar y probar en macOS.
- El inventario sigue usando datos de demostración. Su persistencia en Firestore está pendiente.

## Ejecutar la app Android

Requiere Flutter 3.44.0 / Dart 3.12, Android SDK y un teléfono con depuración USB autorizada o un emulador. Inicia primero la API con `npm start`, una vez configurado Firebase según esta guía. En otra terminal, desde la raíz del repositorio:

```sh
adb reverse tcp:4173 tcp:4173
cd mobile
flutter pub get
flutter run --dart-define=API_BASE_URL=http://127.0.0.1:4173
```

La conexión USB permite acceder desde el teléfono al servidor local y conserva el callback Google configurado. La API debe permanecer encendida. Para utilizar la app sin depender del equipo se necesita un despliegue HTTPS y configurar su dirección al compilar.

Para generar el instalador de desarrollo, ejecuta `flutter build apk --debug` dentro de `mobile/`. El archivo se crea en `mobile/build/app/outputs/flutter-apk/app-debug.apk`. Los binarios y las carpetas de compilación no se versionan; el flujo **Flutter Android** de GitHub Actions también genera el artefacto `nexo-android-debug` cuando termina correctamente. La firma de publicación y la distribución en Play Store siguen pendientes. Más detalles en [la guía móvil](mobile/README.md).

## Configurar Firebase

Proyecto asociado: `jide-nexo-25bf6` (**JIDE NEXO**), base `(default)` en `northamerica-south1` (México), plan Spark. `.firebaserc` contiene el proyecto predeterminado para la CLI.

1. Abre [Firebase Console](https://console.firebase.google.com/) y selecciona el proyecto asociado. Para una instalación independiente, crea o selecciona tu propio proyecto.
2. JIDE NEXO ya tiene la base `(default)` creada. Solo para una instalación nueva, crea una base **Standard / Native mode** con ID `(default)` y reglas de producción; selecciona su región antes de crearla.
3. Copia `.env.example` a `.env` solo si no existe. Completa `FIREBASE_PROJECT_ID` con el ID del proyecto, no con su nombre visible. Si ya tenías `.env`, agrega las variables de Firebase del ejemplo; `DATABASE_URL`, `DATABASE_PATH` y `CLOUD_SQL_INSTANCE` ya no se utilizan.
4. Configura las credenciales del servidor con Application Default Credentials (ADC). En desarrollo puedes ejecutar `gcloud auth application-default login`; asigna a la identidad acceso IAM a Firestore, por ejemplo **Cloud Datastore User**. También se admite un archivo JSON de cuenta de servicio, guardado fuera del repositorio. En `.env`, `GOOGLE_APPLICATION_CREDENTIALS` debe contener la ruta absoluta del archivo. En Windows usa barras `/`.
5. Publica las reglas e índices del proyecto desde una sesión autorizada de Firebase CLI:

```sh
npm ci
npx firebase login
npx firebase deploy --only firestore --project TU_PROYECTO
```

Las reglas de `firestore.rules` bloquean todo acceso directo desde clientes. La API accede mediante IAM y comprueba las sesiones y los permisos en cada endpoint. Las credenciales del servidor no se incluyen en las imágenes ni se envían al navegador. En infraestructura de Google, utiliza preferentemente una cuenta de servicio asociada al entorno, sin archivos de claves.

Los documentos se guardan en `nexo/{FIRESTORE_NAMESPACE}/{coleccion}`. Las colecciones son `users`, `identities`, `sessions`, `email_approvals`, `oauth_states`, `rate_limits`, `audit` y `metadata`. Las identidades únicas por correo y por cuenta Google se reservan mediante transacciones. Los cambios de acceso protegen al último administrador activo. La revocación de sesiones utiliza una versión por usuario, sin depender de eliminar grandes lotes de documentos.

La configuración de índices es compatible con Spark y no activa políticas TTL: el borrado TTL requiere facturación habilitada según los [límites de Firestore](https://firebase.google.com/docs/firestore/quotas). La API verifica siempre la expiración de sesiones, estados OAuth y límites de intentos. Sus documentos vencidos permanecen almacenados hasta implementar una limpieza o autorizar TTL con facturación; `delete_after` conserva la fecha prevista para esa limpieza.

## Ejecutar con Docker

Requiere Docker Desktop iniciado con contenedores Linux. Desde la carpeta del proyecto:

```sh
docker compose -f compose.yaml -f compose.firebase.yaml up --build -d
```

Abre <http://127.0.0.1:4173>. Detén primero el servidor Node.js local si ocupa ese puerto; ambas modalidades utilizan el mismo puerto web.

- `web`: Nginx sirve el frontend y reenvía las solicitudes a la API. Publica únicamente el puerto web en localhost.
- `auth-api`: Node.js 24, autenticación, usuarios y acceso a Firestore mediante el SDK oficial. No publica puertos al host.
- Firebase mantiene la base de datos online. No hay contenedor SQL ni proxy de base de datos.

`compose.firebase.yaml` monta las credenciales como secreto de solo lectura. En un entorno Google con identidad de servicio adjunta, usa `compose.yaml` sin ese archivo adicional. No se crea ningún recurso cloud automáticamente.

Para producción configura `NODE_ENV=production`, `APP_ORIGIN=https://tu-dominio` y un proxy HTTPS o balanceador delante del puerto web. En producción se rechazan el almacenamiento de pruebas en memoria y el emulador. `/health/live` comprueba que la API esté funcionando; `/health/ready` comprueba acceso a Firestore. Las comprobaciones frecuentes de readiness generan lecturas de Firestore.

Para ejecutar sin Docker, con las mismas variables Firebase configuradas:

```sh
npm ci
npm start
```

Abrir directamente `dist/index.html`, publicar solo `dist/` o usar GitHub Pages no ejecuta la API.

## Crear el primer administrador

Completa `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME` y `BOOTSTRAP_ADMIN_PASSWORD` en `.env`. Usa una contraseña única de 12 a 128 caracteres. Ejecuta en PowerShell o Bash:

```sh
docker compose -f compose.yaml -f compose.firebase.yaml run --rm --volume "${PWD}/.env:/app/.env:ro" auth-api npm run admin:create
```

Sin Docker: `npm run admin:create`. El comando no reemplaza cuentas existentes. Elimina la contraseña de inicialización de `.env` después de crear la cuenta.

Las cuentas nuevas reciben rol **Consulta** y estado **Pendiente**. Un administrador las aprueba desde **Mi perfil → Usuarios**. El registro por contraseña no verifica la propiedad del correo; el administrador debe verificar la identidad antes de aprobar. Se conserva el inicio de sesión existente por contraseña y Google OpenID Connect; los usuarios y sesiones se almacenan en Firestore.

## Inicio de sesión con Google

En Google Auth Platform, configura Branding, Audience y los scopes `openid`, `email` y `profile`. Crea un cliente OAuth de tipo aplicación web y registra la URI:

```text
http://127.0.0.1:4173/api/v1/auth/google/callback
```

Configura `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en `.env`. Para producción registra `https://TU-DOMINIO/api/v1/auth/google/callback` y ajusta `APP_ORIGIN`. El botón Google solo se habilita cuando existen ambas variables. La identidad OAuth de los usuarios y las credenciales IAM de Firestore son configuraciones distintas.

El flujo utiliza estado ligado al navegador, PKCE, nonce y verificación del ID token. Una identidad Google nueva también necesita aprobación; no se vincula automáticamente con una cuenta de contraseña que tenga el mismo correo. La integración requiere credenciales reales para probar el inicio de sesión completo.

El botón prepara el acceso mediante la API antes de salir de la página. Si falla la conexión, muestra un mensaje y permite volver a intentar. La API verifica las credenciales de Firestore antes de inicializar el transporte; la ausencia de credenciales devuelve un error controlado sin cerrar el servidor.

## Resolver problemas de acceso

- **La página no carga:** confirma que `npm start` siga ejecutándose o que los contenedores estén activos. `GET /health/live` debe responder `200`.
- **No se pudo conectar con Firebase:** revisa `FIREBASE_PROJECT_ID`, la ruta `GOOGLE_APPLICATION_CREDENTIALS` y los permisos IAM de la cuenta de servicio. Reinicia la API después de modificar `.env`. `GET /health/ready` responde `200` cuando puede consultar Firestore y `503` si no puede hacerlo.
- **Google rechaza la redirección:** verifica que la URI registrada coincida exactamente con `APP_ORIGIN` y `/api/v1/auth/google/callback`. `localhost` y `127.0.0.1` son orígenes diferentes.
- **Cuenta pendiente de aprobación:** Google ya verificó la identidad, pero un administrador debe activar la cuenta y asignar su rol. Después de un cambio de permisos que revoque sesiones, vuelve a iniciar sesión.

`.env` y los archivos JSON de credenciales son configuración privada de cada entorno. No deben subirse a Git ni copiarse a `dist/`. Clonar el repositorio no transfiere las credenciales ni las cuentas almacenadas en Firebase.

## Aprobar usuarios

En **Mi perfil y usuarios → Usuarios → Aprobar un correo**, un administrador puede autorizar anticipadamente un correo y su perfil. La aprobación se consume cuando Google verifica la identidad. Los registros por contraseña requieren revisión manual. No se envían correos ni se crean contraseñas por aprobar una dirección.

## Seguridad y API

Roles: **Administrador, Compras, Almacén y Consulta**. Estados: pendiente, activo y suspendido. Las sesiones usan cookies `HttpOnly`, `SameSite=Lax` y `Secure` con HTTPS, caducan a las 8 horas y se almacenan mediante hashes. Las contraseñas usan scrypt y sal aleatoria. Las escrituras requieren `Origin` igual a `APP_ORIGIN`. Los límites de intentos persisten en Firestore; detrás de Nginx el límite por IP es compartido porque la API no confía en cabeceras de IP arbitrarias.

```http
GET    /api/v1/auth/config
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
GET    /api/v1/auth/google
GET    /api/v1/auth/google/callback
POST   /api/v1/auth/mobile/exchange
GET    /api/v1/me
PATCH  /api/v1/me
POST   /api/v1/me/password
GET    /api/v1/users
PATCH  /api/v1/users/{id}
GET    /api/v1/email-approvals
POST   /api/v1/email-approvals
DELETE /api/v1/email-approvals
```

El inventario continúa siendo una demostración: sus controles de rol son de interfaz y los cambios se pierden al recargar. Usuarios, perfiles, aprobaciones y sesiones sí tienen persistencia y autorización en servidor. Cambiar la conexión no importa datos de SQLite o PostgreSQL: conserva tus respaldos si necesitas migrar cuentas anteriores.

## Pruebas

La revisión de la interfaz, los tamaños de pantalla comprobados y las recomendaciones de mejora están documentados en [Revisión de interfaz web](docs/interface-review.md). Se utiliza WCAG 2.2 AA como referencia; la revisión no equivale a una certificación completa de accesibilidad.

```sh
npm test
npm run test:firestore
```

El primer comando usa un repositorio en memoria aislado, exclusivo de pruebas. El segundo requiere Java 21 o superior e inicia el emulador oficial con el proyecto ficticio `demo-nexo`: no usa credenciales ni datos cloud. Ejecuta la misma suite y prueba sesiones compartidas entre conexiones. El emulador se cierra al terminar. CI ejecuta ambas variantes y construye las imágenes Docker.

Las pruebas cubren acceso anónimo y pendiente, aprobación, suspensión, CSRF, cambios de contraseña, revocación, concurrencia, protección del último administrador y validaciones OAuth. También verifican la creación de sesiones tras un callback válido, el rechazo de estados reutilizados y nonce incorrecto, y que la falta de credenciales de Firebase no cierre el servidor. No llaman al proveedor Google real.

El acceso móvil añade pruebas de canje de código de un solo uso, PKCE, caducidad, concurrencia, cancelación y cuentas suspendidas. Para comprobar Flutter:

```sh
cd mobile
flutter pub get
flutter analyze
flutter test
```

El flujo independiente `.github/workflows/mobile.yml` ejecuta estas comprobaciones y compila el APK Android. La revisión visual y las pruebas automatizadas no sustituyen la validación final en un teléfono real.

## Archivos principales

```text
mobile/                   App Flutter Android e iOS (ver guía móvil)
dist/                     Frontend
lib/auth.cjs              Contraseñas, sesiones y validaciones
lib/database.cjs          Repositorio de documentos Firestore
server.cjs                API HTTP
scripts/create-admin.cjs  Inicialización del administrador
Dockerfile                Imágenes de frontend y API
compose.yaml              Servicios Docker
compose.firebase.yaml     Credenciales locales para Firebase online
firebase.json             Configuración CLI y emulador
firestore.rules           Bloqueo del acceso directo de clientes
firestore.indexes.json     Índices compatibles con Spark
.env.example              Variables sin secretos
```

`.openai/hosting.json` corresponde al sitio estático anterior. Subir estos archivos a GitHub no actualiza ese sitio ni despliega los contenedores.

Referencias: [SDK de servidor para Firestore](https://firebase.google.com/docs/firestore/quickstart-server), [transacciones](https://firebase.google.com/docs/firestore/manage-data/transactions) y [emulador de Firestore](https://firebase.google.com/docs/emulator-suite/connect_firestore).
