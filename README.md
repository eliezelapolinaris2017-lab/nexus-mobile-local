# Nexus Mobile Local — 1.0 (preliminar)
PWA separada de Nexus Suite. Interfaz extraída de business-modern- commit 36a44ed94784bea8e5a7f97284f04054af274201. No se copiaron credenciales, clientes, facturas, logo comercial ni archivos de configuración Firebase.

## Arranque
Desde este repositorio: python3 -m http.server 8080 y abrir http://localhost:8080. Para instalar en iPhone/Android, alojar en HTTPS y añadir a inicio. Al primer inicio, configurar empresa e IVU. Después de que el service worker termine de instalarse, probar en modo avión.

## Almacenamiento
IndexedDB, exclusivo del origen/dispositivo. No requiere cuenta de la Suite. Exportar y restaurar respaldo JSON desde Configurar. No es cifrado por la app; usar bloqueo del dispositivo y guardar respaldos de forma segura. Borrar datos del navegador puede eliminar los registros. Compartir por WhatsApp o consultar mapas exige conexión. Motor PDF jsPDF 4.2.1 incluido.

## Estado
Código preliminar, pendiente de pruebas en navegador/iPhone, incluida creación de clientes, facturas, cobros, PDF, trabajos, restauración y modo avión. No usar datos reales antes de esas pruebas. No hay integración Supabase activa, ni portal de clientes, ni procesamiento de pagos en línea. Migración a nueva nube pendiente. La numeración se reserva de forma transaccional en IndexedDB; no es un sistema multi-dispositivo.
