# Configuración Auth de Nova Cloud (producción)

Proyecto: Nexus-NOVA (cgpfpxueqciefclonghz).

1. En https://supabase.com/dashboard/project/cgpfpxueqciefclonghz/auth/url-configuration, establecer Site URL a https://nova.nexustoolspr.com/ y guardar. En Redirect URLs añadir exactamente https://nova.nexustoolspr.com/. Mantener la URL anterior únicamente si aún es necesaria. No utilizar localhost como Site URL de producción.
2. En https://supabase.com/dashboard/project/cgpfpxueqciefclonghz/auth/templates, abrir Confirm signup: asunto «Nova Cloud | Confirma tu correo electrónico», pegar el HTML de confirm-signup.html en el editor de código y guardar. En Reset password: asunto «Nova Cloud | Recupera tu contraseña», pegar reset-password.html y guardar. Conservar la variable {{ .ConfirmationURL }} intacta.
3. Mantener Confirm email activado. Configurar SMTP propio y un remitente verificado antes de abrir el registro a usuarios externos; el servicio predeterminado limita destinatarios y envíos. No almacenar claves SMTP en GitHub ni en código de navegador.
4. Realizar una prueba real con un correo autorizado sin datos empresariales existentes. Verificar recepción, dominio final, estado email_confirmed_at, acceso y onboarding. Probar recuperación por separado. El correo recibido antes del cambio puede seguir redirigiendo a localhost; si ya confirmó, basta con abrir Nova e iniciar sesión.

Las plantillas del repositorio no se aplican automáticamente al proyecto alojado. Requieren guardarse en Auth. No se modifica ninguna cuenta existente.
