# JIDE NOVA CORE

## Nexo · Centro de Control

Aplicación web de **JIDE NOVA CORE** con autenticación, perfiles y administración de usuarios. El inventario continúa utilizando datos de demostración.

## Funcionalidades

- Inicio y cierre de sesión con correo y contraseña.
- Solicitud de cuenta con aprobación del administrador.
- Perfil persistente: nombre, departamento y teléfono.
- Cambio de contraseña y revocación de otras sesiones.
- Perfiles: **Administrador, Compras, Almacén y Consulta**.
- Activación, suspensión y cambio de roles desde Usuarios.
- Integración Google OpenID Connect, pendiente de configurar un cliente OAuth real.
- Inventario multi-almacén, lotes, compras, movimientos, mermas y exportación CSV de demostración.

## Ejecutar localmente

Requiere **Node.js 24 o superior**.

```sh
npm ci
```

Copia `.env.example` a `.env`. Conserva inicialmente:

```dotenv
HOST=127.0.0.1
PORT=4173
APP_ORIGIN=http://127.0.0.1:4173
DATABASE_PATH=./data/nexo.sqlite
```

Después ejecuta:

```sh
npm start
```

Abre <http://127.0.0.1:4173>. Abrir directamente `dist/index.html` o desplegar solo `dist/` no proporciona autenticación.

### Crear el primer administrador

En tu archivo local `.env`, configura `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME` y `BOOTSTRAP_ADMIN_PASSWORD`. Usa una contraseña única de entre 12 y 128 caracteres. No existen credenciales predeterminadas.

```sh
npm run admin:create
```

Retira la contraseña de inicialización de `.env` después de crear la cuenta. El comando no reemplaza cuentas existentes. Si registraste antes ese correo en la interfaz, usa otro correo para el administrador inicial y aprueba la cuenta pendiente desde Usuarios.

Las cuentas nuevas reciben el rol **Consulta** y estado **Pendiente**. Para aprobarlas: inicia sesión como administrador → abre tu perfil → **Usuarios** → asigna perfil y estado **Activo**. El usuario debe iniciar sesión de nuevo.

Los registros por contraseña **no verifican la propiedad del correo electrónico**: el administrador debe verificar la identidad por otro medio antes de aprobar. La recuperación automática por correo y las invitaciones quedan pendientes.

## Configurar inicio de sesión con Google

1. En Google Cloud, selecciona tu proyecto y configura Google Auth Platform: Branding, Audience y los scopes `openid`, `email` y `profile`.
2. Crea un cliente OAuth de tipo **Aplicación web**.
3. Registra exactamente esta URI de redirección para desarrollo:

   ```text
   http://127.0.0.1:4173/api/v1/auth/google/callback
   ```

4. Configura `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en `.env` y reinicia el servidor. No los escribas en el frontend ni los subas a GitHub.
5. Si la aplicación está en modo de pruebas, añade los usuarios de prueba autorizados en Google.
6. Para producción, usa un dominio HTTPS, ajusta `APP_ORIGIN` sin barra final y registra `https://TU-DOMINIO/api/v1/auth/google/callback`.

El botón Google solo se habilita con configuración del servidor. La integración no se ha probado contra una cuenta de Google real sin esas credenciales. Google identifica a la persona; **no le asigna acceso automático a JIDE NOVA CORE**. Una cuenta nueva con Google también necesita aprobación.

No se vincula automáticamente una cuenta con contraseña a una identidad de Google que tenga el mismo correo. En ese caso se conserva el acceso con contraseña; la vinculación explícita queda pendiente.

Referencias: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect) y [biblioteca oficial para Node.js](https://github.com/googleapis/google-auth-library-nodejs).

## Seguridad y perfiles

| Perfil | Acceso actual |
| --- | --- |
| Administrador | Perfil, administración de usuarios y todos los formularios de demostración |
| Compras | Perfil, consultas y borradores de compra de demostración |
| Almacén | Perfil, consultas, entradas, salidas y mermas de demostración |
| Consulta | Perfil y lectura/exportación del inventario de demostración |

- Sesiones opacas de 8 horas almacenadas como hashes; cookies `HttpOnly`, `SameSite=Lax` y `Secure` con HTTPS.
- Contraseñas con scrypt y sal aleatoria; sin contraseñas ni tokens en localStorage.
- Comprobación de origen en escrituras y límites de intentos persistentes en SQLite.
- Permisos y estado verificados en endpoints de perfiles y usuarios. Cambiar acceso revoca sesiones.
- Protección del último administrador activo.
- Auditoría de accesos y cambios de perfil, contraseña y permisos.
- Google: código de autorización, PKCE, estado ligado al navegador, nonce y verificación del ID token con la biblioteca oficial.

**Límite actual:** el inventario sigue siendo una demostración en memoria del navegador; los controles de rol sobre esos formularios son solo de interfaz. No representan autorización para datos reales. El futuro backend debe validar cada permiso y transacción. La autenticación y los perfiles sí tienen persistencia y autorización en servidor.

## API

```http
GET   /api/v1/auth/config
POST  /api/v1/auth/register
POST  /api/v1/auth/login
POST  /api/v1/auth/logout
GET   /api/v1/auth/google
GET   /api/v1/auth/google/callback
GET   /api/v1/me
PATCH /api/v1/me
POST  /api/v1/me/password
GET   /api/v1/users
PATCH /api/v1/users/{id}
```

Las escrituras reciben JSON y `Origin` igual a `APP_ORIGIN`. Esta implementación usa sesiones web del mismo origen; una futura PWA en otro origen requiere diseñar explícitamente ese flujo.

## Pruebas

```sh
npm test
```

Pruebas con bases aisladas: acceso anónimo/pendiente, escalamiento de privilegios, aprobación, suspensión, CSRF, contraseñas, revocación, límites de intentos y validaciones del inicio del flujo Google. No llaman al proveedor real.

## Estructura

```text
dist/                    Frontend (código fuente, mantener en Git)
  auth.js, auth.css      Login y perfiles
  app.js, styles.css     Inventario de demostración
  index.html             Entrada de la aplicación
lib/auth.cjs             Persistencia, contraseñas, sesiones y validaciones
server.cjs               API y servidor HTTP
scripts/create-admin.cjs Creación local del primer administrador
tests/auth.test.cjs      Pruebas de autenticación
.env.example             Configuración sin secretos
data/                    SQLite privado (excluido de Git)
```

## Despliegue

### Aprobación de correos desde el administrador

En **Mi perfil y usuarios → Usuarios → Aprobar un correo**, escribe el correo y elige su perfil. La aprobación queda guardada hasta que Google verifique esa identidad en su primer acceso. Puedes revocarla antes del registro. No se envían correos ni se crean contraseñas. Las cuentas ya registradas se administran en la lista de usuarios: selecciona **Activo** y **Guardar acceso**. Los registros con contraseña requieren revisión manual; una aprobación anticipada no verifica la propiedad de un correo.

API exclusiva para administradores: `GET /api/v1/email-approvals`, `POST /api/v1/email-approvals` con `{ "email": "persona@example.com", "role": "consulta" }` y `DELETE /api/v1/email-approvals` con `{ "email": "persona@example.com" }`. Los cambios quedan auditados. Esta autorización interna no modifica la lista de usuarios de prueba de Google Cloud.

Requiere **servidor Node.js con almacenamiento persistente**, HTTPS y variables de entorno. `NODE_ENV=production` exige un origen HTTPS. Con proxy inverso, usa `HOST=0.0.0.0` solo con acceso de red apropiado. Los límites de intentos usan la dirección del socket; detrás de un proxy el límite por IP será compartido. No se confía en cabeceras de IP arbitrarias.

SQLite permite una sola instancia en esta etapa. Respalda su volumen privado; para múltiples réplicas y el inventario transaccional previsto, migra a PostgreSQL y almacenamiento compartido de sesiones y límites.

`.openai/hosting.json` se conserva como referencia del sitio estático anterior. **Subir a GitHub no actualiza el sitio publicado anteriormente ni ejecuta este servidor.** GitHub Pages tampoco ejecuta Node.js. No publiques solo `dist/` esperando un login funcional.

Las tipografías provienen de Google Fonts. El inventario inicial, fechas, métricas y recorridos son ilustrativos; los cambios de inventario se pierden al recargar.
