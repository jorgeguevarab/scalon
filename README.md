# Escalón

**Escalón** es una PWA para construir hábitos subiendo la meta un escalón cada semana (por ejemplo, empezar con 5 minutos de ejercicio y subir 2 minutos cada semana). Pensada para instalarse en la pantalla de inicio del iPhone y usarse ahí como una app nativa.

## Funciones

- **Hábitos incrementales**: defines un valor inicial, una unidad (minutos, páginas...) y un incremento semanal, automático o confirmado a mano.
- **Hoy**: registra el valor del día, márcalo como cumplido y usa el temporizador integrado para hábitos por tiempo.
- **Calificación automática** del día según qué tan cerca quedaste de la meta (excelente / bien / incompleto / muy corto).
- **Rachas y medallas** por constancia (3, 7, 14, 30, 60, 100, 200, 365 días).
- **Detalle por hábito**: estadísticas, escalera de progresión semanal y calendario mensual de cumplimiento.
- **Notificaciones push reales**, incluso con la app cerrada (ver abajo).
- **Respaldo manual**: exportar/importar todo el estado como `.json`.
- Look & feel con convenciones de iOS: barra de pestañas inferior, hojas modales con *grabber*, safe areas, soporte de modo oscuro (`prefers-color-scheme`), estados de presión táctil.

## Arquitectura

Es, deliberadamente, casi todo un archivo estático:

- [`index.html`](index.html) — toda la UI, estilos y lógica de la app (vanilla JS, sin build step). El estado de hábitos vive en `localStorage` del navegador; nunca se sube a ningún servidor.
- [`manifest.json`](manifest.json) — hace la app instalable como PWA.
- [`sw.js`](sw.js) — service worker: cachea el *app shell* para uso sin conexión y muestra las notificaciones push.
- [`middleware.js`](middleware.js) — Vercel Edge Middleware que añade cabeceras de seguridad (`X-Frame-Options`, HSTS, etc.) a cada respuesta.
- [`api/`](api) — funciones serverless de Vercel que dan soporte a las notificaciones push (ver abajo). Es la única parte que toca un servidor; todo lo demás (registros, rachas, calendario) sigue siendo 100% local.

## Cómo funcionan las notificaciones

iOS solo entrega notificaciones push a apps **instaladas en la pantalla de inicio** (Compartir → Añadir a pantalla de inicio), nunca a una pestaña normal de Safari, y solo a través de un Service Worker — el `Notification` directo desde la página no es fiable ahí. Además, iOS no soporta notificaciones "programadas" del lado del cliente sin servidor.

Por eso el envío es real Web Push con un componente de servidor mínimo:

1. Al activar notificaciones en **Ajustes**, el navegador se suscribe a push (`PushManager`) y esa suscripción, junto con el nombre/hora de cada hábito con recordatorio, se guarda en Vercel KV vía `POST /api/subscribe`.
2. Un workflow de GitHub Actions ([`.github/workflows/reminders.yml`](.github/workflows/reminders.yml)) llama a `GET /api/send-reminders` cada 5 minutos.
3. Esa función revisa qué recordatorios caen en la ventana de los últimos ~5 minutos (en la zona horaria del dispositivo) y aún no se enviaron hoy, y despacha el push con [`web-push`](https://github.com/web-push-libs/web-push) usando llaves VAPID.
4. El `sw.js` instalado en el teléfono recibe el evento `push` y muestra la notificación con `registration.showNotification`, incluso con la app cerrada.
5. Si marcas el hábito como cumplido desde la app, se avisa al servidor (`POST /api/mark-done`) para no mandarte un recordatorio de algo que ya hiciste.

**Importante**: por el intervalo del cron (5 min) y la naturaleza de GitHub Actions, el aviso llega en una ventana de ~5–10 minutos alrededor de la hora configurada, no al minuto exacto. Solo el nombre del hábito y su horario viajan al servidor — el resto del estado (valores registrados, rachas, calendario) permanece únicamente en el teléfono.

### Puesta en marcha del backend de notificaciones

1. **Vercel KV**: en el dashboard del proyecto, agrega un almacén KV (Storage → Create → KV) y conéctalo al proyecto. Esto crea automáticamente las variables `KV_REST_API_URL` y `KV_REST_API_TOKEN`.
2. **Llaves VAPID**: genera un par con `npx web-push generate-vapid-keys` y añade en Vercel:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT` (por ejemplo `mailto:tu@correo.com`)
3. **`CRON_SECRET`**: genera un valor aleatorio (`openssl rand -hex 32`) y agrégalo como variable de entorno en Vercel.
4. **GitHub Actions**: en el repo, ve a Settings → Secrets and variables → Actions y crea:
   - `APP_URL` — la URL desplegada (ej. `https://escalon.vercel.app`, sin `/` final)
   - `CRON_SECRET` — el mismo valor del paso 3
5. Redepliega. Desde **Ajustes → Activar notificaciones** en el iPhone (con la app ya instalada en pantalla de inicio) se completa la suscripción.

Si no configuras esto, la app sigue funcionando con normalidad — solo el botón de notificaciones no logrará suscribirse.

## Desarrollo local

No hay build step. Para probar la UI basta con abrir `index.html` en un navegador o servirlo con cualquier servidor estático. Las rutas `/api/*` requieren `vercel dev` (con las variables de entorno de arriba) para probarse localmente.

## Despliegue

Desplegado en [Vercel](https://vercel.com). Cada push a `main` dispara un nuevo deploy si el repositorio está conectado al proyecto de Vercel.
