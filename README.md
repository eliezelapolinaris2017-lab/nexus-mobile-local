# Nexus Mobile Local — 2.0 (preliminar)
PWA separada de Nexus Suite. Interfaz extraída de business-modern- commit 36a44ed94784bea8e5a7f97284f04054af274201. No se copiaron credenciales, clientes, facturas, logo comercial ni archivos de configuración Firebase.

## Arranque
Desde este repositorio: python3 -m http.server 8080 y abrir http://localhost:8080. Para instalar en iPhone/Android, alojar en HTTPS y añadir a inicio. Al primer inicio, configurar empresa e IVU. Después de que el service worker termine de instalarse, probar en modo avión.

## Almacenamiento
IndexedDB, exclusivo del origen/dispositivo. No requiere cuenta de la Suite. Exportar y restaurar respaldo JSON desde Configurar. No es cifrado por la app; usar bloqueo del dispositivo y guardar respaldos de forma segura. Borrar datos del navegador puede eliminar los registros. Compartir por WhatsApp o consultar mapas exige conexión. Motor PDF jsPDF 4.2.1 incluido.

## Estado
Código preliminar, pendiente de pruebas en navegador/iPhone, incluida creación de clientes, facturas, cobros, PDF, trabajos, restauración y modo avión. No usar datos reales antes de esas pruebas. No hay integración Supabase activa, ni portal de clientes, ni procesamiento de pagos en línea. Migración a nueva nube pendiente. La numeración se reserva de forma transaccional en IndexedDB; no es un sistema multi-dispositivo.

## Publicación de prueba
https://eliezelapolinaris2017-lab.github.io/nexus-mobile-local/ — GitHub Pages solamente. Sin Vercel. Para pruebas con datos ficticios, no operación comercial hasta validar condiciones de alojamiento y seguridad. La base local usa un nombre propio y la PWA tiene alcance limitado a su directorio; otros sitios alojados en el mismo origen podrían acceder al almacenamiento, por lo que se recomienda un origen exclusivo antes de uso real.

## Diseño NOVA 2.0
Nueva capa visual móvil: panel de cobros, tarjetas de acceso, navegación renovada, formularios legibles y diseño adaptativo. Se conserva la base IndexedDB y la implementación de documentos y operaciones. Los datos existentes no se migran ni se borran.

## Agenda 2.1
Calendario mensual, citas por fecha, creación y edición local de horarios, advertencia de solapamientos, clientes, estados, facturación y rutas. Las citas son trabajos de la misma colección local; no hay sincronización con calendarios externos.

## Confirmaciones 2.2 (pendiente de nube nueva)
WhatsApp abre un mensaje relleno; el operador pulsa Enviar. La página confirmar.html registra el clic mediante una Edge Function. El dueño consulta estados al abrir la agenda y cada 30 s mientras la app esté abierta. No se guardan datos identificativos del cliente en la nube; solo tokens cifrados por hash y estado. Requiere un proyecto Supabase independiente, aplicar setup-confirmations.sql, desplegar nova-confirmations con verify_jwt=false (autenticación por clave de propietario y token individual), provisionar una clave privada y configurarla en la app. No usar service_role como clave de propietario. No hay conexión activa todavía. Los enlaces se invalidan antes de cambios o cancelaciones desde la agenda; requiere internet si hay un enlace vigente. GitHub Pages comparte origen con otros sitios del mismo usuario, usar origen exclusivo antes de datos reales. La clave local no se incluye en respaldos.

## NOVA 2.3 — almacenamiento privado de empresa
Supabase Auth + RLS por usuario. La tabla nova_workspaces almacena una copia JSONB completa de perfil, clientes, servicios, cotizaciones, seguimientos, facturas, cobros, activos, contratos y secuencias. Balances se calculan a partir de facturas y pagos. La app conserva IndexedDB y sube cambios automáticamente después de la activación explícita inicial. Comparación de revisión evita sobrescribir cambios concurrentes; recuperar requiere acción del usuario. No es edición simultánea multiusuario. La sesión de nube se guarda en sessionStorage y puede requerir reconexión tras cerrar la PWA. La clave privada de confirmaciones se configura aparte por dispositivo y no va a la nube ni al repositorio. No se borra la base local al actualizar. Copias de respaldo en JSON siguen recomendadas. El origen público compartido de GitHub Pages no es ideal para datos reales sensibles; aislar en dominio exclusivo antes de producción. Pruebas de navegador y nube pendientes.

## NOVA 2.4 — cuenta primero
Supabase Auth, onboarding de empresa y activación automática de confirmaciones por usuario. Vincular una empresa local conserva registros y reclama la credencial anterior sin copiarla. No se sobrescribe una copia remota distinta. Almacenamiento local no cifrado: usar origen exclusivo y bloqueo del dispositivo antes de producción. Pruebas reales pendientes.

## NOVA 2.4.1
Mensajes de autenticación en español y control de solicitudes simultáneas; redirección de correo solicitada hacia la app (la URL debe estar autorizada en Supabase Auth). Indicador de sincronización basado en la respuesta de Supabase, no solamente en IndexedDB. Se conserva la verificación del correo y la protección de datos por usuario.

## Nova Cloud 2.5
Centro de avisos calculados desde registros locales: citas hoy/mañana, facturas vencidas, seguimientos próximos (7 días), clientes con historial sin servicio por 180 días. Posponer conserva la fecha junto al registro; clientes se posponen 30 días, otros avisos 1 día. WhatsApp prepara mensajes, el operador decide si envía; no hay envío autónomo, cron ni push fuera de la app. Recuperación de contraseña por correo requiere URL https://eliezelapolinaris2017-lab.github.io/nexus-mobile-local/ autorizada en Supabase Auth y proveedor de correo SMTP operativo. Respaldos privados al primer cambio de cada día de actividad, hasta tres fechas; se descargan desde Ajustes. No son garantía ante pérdida completa del proyecto. Usar copias externas y un dominio de origen exclusivo antes de producción.

## Nova Cloud 3.0 Finanzas
Colecciones nuevas compatibles con respaldos anteriores: expenses, suppliers, purchases, purchasePayments, inventory, stockUsage. Flujo de caja por fecha real de cobro/pago; IVU estimado proporcional al cobro acumulado; margen por factura basado en costos asignados. Las compras de inventario incrementan existencias y el consumo vinculado a factura las descuenta. No es contabilidad fiscal, no calcula utilidad neta contable, no cobra impuestos automáticamente. Fotos JPEG comprimidas en registros; el límite de tamaño de snapshot de Supabase aplica. Exportar PDF semanal, mensual o anual a la fecha. No se automatizan compras ni ajustes de inventario sin acción del usuario. No usar versiones antiguas para recuperar datos después de migrar.

3.0.1: protección de tamaño de recibos y pruebas del flujo financiero con servidor simulado; las pruebas nunca deben llamar al proyecto productivo.
