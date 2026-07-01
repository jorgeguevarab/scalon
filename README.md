# Escalón

**Escalón** es una PWA para construir hábitos subiendo la meta un escalón cada semana (por ejemplo, empezar con 5 minutos de ejercicio y subir 2 minutos cada semana). Pensada para instalarse en la pantalla de inicio del iPhone y usarse ahí como una app nativa.

## Funciones

- **Hábitos incrementales**: defines un valor inicial, una unidad y un incremento semanal, automático o confirmado a mano. La unidad se elige de un catálogo fijo — no se pueden inventar unidades no medibles.
- **Unidades de tiempo vs. cantidad**: `segundos` / `minutos` / `horas` solo se registran con el cronómetro integrado; el resto (`páginas`, `kilómetros`, `repeticiones`, `vasos`, etc.) se ingresan a mano. Cada hábito muestra solo el control que le corresponde.
- **Sesiones acumulables**: cada ciclo Iniciar/Detener del cronómetro se guarda como una sesión independiente y el total del día es la suma de todas — hacer ejercicio en la mañana y otra vez en la tarde suma, no reemplaza.
- **Modo foco**: al iniciar el cronómetro, la app pide un *wake lock* (la pantalla no se apaga) y muestra una vista de pantalla completa con el cronómetro, la meta y la racha, más un cuadro de notas opcional para esa sesión.
- **Diario**: las notas de sesión quedan guardadas y se listan en el detalle de cada hábito, ordenadas de más reciente a más antigua.
- **Calificación automática** del día según qué tan cerca quedaste de la meta (excelente / bien / incompleto / muy corto).
- **Rachas y medallas** por constancia (3, 7, 14, 30, 60, 100, 200, 365 días).
- **Detalle por hábito**: estadísticas, escalera de progresión semanal, calendario mensual de cumplimiento y diario de notas.
- **Notificaciones push reales**, incluso con la app cerrada (ver abajo).
- **Cuenta opcional y sincronización entre dispositivos** (ver abajo) — sin cuenta, todo sigue siendo 100% local.
- **Respaldo manual**: exportar/importar todo el estado como `.json`.
- Look & feel con convenciones de iOS: barra de pestañas inferior, hojas modales con *grabber*, safe areas, soporte de modo oscuro (`prefers-color-scheme`), estados de presión táctil.

## Arquitectura

- [`index.html`](index.html) — toda la UI, estilos y lógica de la app (vanilla JS, sin build step). El estado de hábitos vive en `localStorage` del navegador por defecto.
- [`manifest.json`](manifest.json) — hace la app instalable como PWA.
- [`sw.js`](sw.js) — service worker: cachea el *app shell* para uso sin conexión y muestra las notificaciones push.
- [`middleware.js`](middleware.js) — Vercel Edge Middleware que añade cabeceras de seguridad (`X-Frame-Options`, HSTS, etc.) a cada respuesta.
- [`lib/auth.js`](lib/auth.js) — hashing de contraseñas (`scrypt` nativo de Node) y manejo de sesiones por cookie, compartido por las rutas de `api/auth/`.
- [`api/`](api) — funciones serverless de Vercel: notificaciones push, autenticación y sincronización (ver abajo). Es la única parte que toca un servidor; sin cuenta y sin notificaciones activadas, todo el estado sigue siendo 100% local.

## Cómo funcionan las notificaciones

iOS solo entrega notificaciones push a apps **instaladas en la pantalla de inicio** (Compartir → Añadir a pantalla de inicio), nunca a una pestaña normal de Safari, y solo a través de un Service Worker — el `Notification` directo desde la página no es fiable ahí. Además, iOS no soporta notificaciones "programadas" del lado del cliente sin servidor.

Por eso el envío es real Web Push con un componente de servidor mínimo:

1. Al activar notificaciones en **Ajustes**, el navegador se suscribe a push (`PushManager`) y esa suscripción, junto con el nombre/hora de cada hábito con recordatorio, se guarda en Redis vía `POST /api/subscribe`.
2. Un cron externo (ver [cron-job.org](https://cron-job.org), configuración abajo) llama a `GET /api/send-reminders` cada 5 minutos. **No usamos GitHub Actions para esto**: sus `schedule` triggers son "best effort" y en la práctica se saltaban ventanas de más de 10 minutos en este repo — un problema real de puntualidad, no del código.
3. Esa función revisa qué recordatorios caen en la ventana de los últimos ~5 minutos (en la zona horaria del dispositivo) y aún no se enviaron hoy, y despacha el push con [`web-push`](https://github.com/web-push-libs/web-push) usando llaves VAPID.
4. El `sw.js` instalado en el teléfono recibe el evento `push` y muestra la notificación con `registration.showNotification`, incluso con la app cerrada.
5. Si marcas el hábito como cumplido desde la app, se avisa al servidor (`POST /api/mark-done`) para no mandarte un recordatorio de algo que ya hiciste.

**Importante**: por el intervalo del cron (5 min), el aviso llega en una ventana de ~1–6 minutos después de la hora configurada, no al minuto exacto. Solo el nombre del hábito y su horario viajan al servidor — el resto del estado (valores registrados, rachas, calendario) permanece únicamente en el teléfono.

### Configurar el cron en cron-job.org

1. Crea una cuenta gratuita en [cron-job.org](https://console.cron-job.org).
2. Nuevo cronjob:
   - **URL**: `https://scalon-nine.vercel.app/api/send-reminders`
   - **Método**: GET
   - **Horario**: cada 5 minutos
   - **Headers** (pestaña Advanced): `Authorization: Bearer <CRON_SECRET>` — el mismo valor que pusiste como `CRON_SECRET` en Vercel.
3. Guarda y actívalo. Puedes revisar en la pestaña "History" de cron-job.org si cada ejecución responde `200` con `{"ok":true,...}`.

## Cuenta y sincronización entre dispositivos

En **Ajustes → Cuenta y sincronización** se puede crear una cuenta (correo + contraseña) para llevar los hábitos a otro dispositivo. Es opcional y local-first:

- Sin cuenta, nada cambia respecto a antes: todo vive solo en `localStorage`.
- Al crear cuenta o iniciar sesión, si ya había datos en el servidor de un dispositivo anterior, la app pregunta si quieres usar esos datos o subir los de este teléfono (sin fusionar automáticamente — evita perder historial por accidente).
- Mientras haya sesión iniciada, cada cambio se sincroniza al servidor solo (con un pequeño *debounce*), además del botón manual **Sincronizar ahora**.
- Autenticación: contraseñas con `scrypt` + salt (nunca en texto plano), sesión por cookie `httpOnly`/`Secure` con token opaco guardado en Redis (no JWT, así cerrar sesión invalida el token de inmediato). No incluye verificación de correo ni "olvidé mi contraseña" — es un MVP; si se necesita, es un siguiente paso.
- Los datos sincronizados son el mismo JSON que ya vive en el teléfono (hábitos, registros, notas incluidas). Sin cuenta, nada de eso sale del dispositivo.

## Puesta en marcha del backend (notificaciones + cuentas)

Notificaciones push y cuentas de usuario comparten el mismo almacén Redis.

1. **Redis (Upstash vía Vercel Marketplace)**: en el dashboard del proyecto → Storage → Create Database → **Upstash** → tipo **Redis**, y conéctalo al proyecto. Vercel retiró el producto nativo "KV" en dic. 2024; la integración de Upstash es la que sigue inyectando `KV_REST_API_URL` y `KV_REST_API_TOKEN`, que es lo que usa `@vercel/kv` en este código — no hace falta cambiar nada más.
2. **Llaves VAPID** (para push): genera un par con `npx web-push generate-vapid-keys` y añade en Vercel:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT` (por ejemplo `mailto:tu@correo.com`)
3. **`CRON_SECRET`** (para push): genera un valor aleatorio (`openssl rand -hex 32`) y agrégalo como variable de entorno en Vercel.
4. **cron-job.org** (para push): configura el cronjob descrito arriba en "Configurar el cron en cron-job.org", usando el mismo `CRON_SECRET` del paso 3.
5. Redepliega. Las cuentas funcionan en cuanto Redis está conectado (paso 1); las notificaciones necesitan además los pasos 2–4.

Si no configuras nada de esto, la app sigue funcionando con normalidad en modo local — solo los botones de notificaciones y de cuenta no lograrán completar la llamada al servidor.

## Desarrollo local

No hay build step. Para probar la UI basta con abrir `index.html` en un navegador o servirlo con cualquier servidor estático. Las rutas `/api/*` (notificaciones, cuentas, sync) requieren `vercel dev` con las variables de entorno de arriba para probarse localmente.

## Despliegue

Desplegado en [Vercel](https://vercel.com). Cada push a `main` dispara un nuevo deploy si el repositorio está conectado al proyecto de Vercel.
