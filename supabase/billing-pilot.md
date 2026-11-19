# Nova Cloud 3.3 — piloto comercial

- Prueba de 14 días desde la confirmación de correo para nuevas cuentas, calculada con hora de servidor en Supabase.
- Las cuentas existentes al inicio del piloto conservan acceso como fundadoras.
- Consulta de plan privada, autenticada y aislada por usuario. No se exponen credenciales ni se cambia el guardado o la autenticación.
- En este piloto el vencimiento es informativo: no se restringe ni elimina información, y no se cobran suscripciones.
- Antes de activar pagos: confirmar comercio de Stripe para Nova Cloud y precio mensual, configurar credenciales en secretos de Edge Functions, implementar Checkout autenticado con precios validados en servidor, webhooks firmados, idempotencia y reconciliación, portal de cliente, términos y política de cancelación. Probar en sandbox antes de habilitar cobros reales. Después activar restricciones del servidor de manera coordinada con el flujo offline y acceso de solo lectura/exportación. No usar enlaces de cobro existentes de Oasis.
