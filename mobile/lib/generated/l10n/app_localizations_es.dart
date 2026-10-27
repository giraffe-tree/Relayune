// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Spanish Castilian (`es`).
class AppLocalizationsEs extends AppLocalizations {
  AppLocalizationsEs([String locale = 'es']) : super(locale);

  @override
  String get workbenchContinueUnconfirmed =>
      'La continuación aún no se ha confirmado. Vuelve a intentarlo en breve.';

  @override
  String get workbenchContinueExpired =>
      'La solicitud para continuar ha caducado. Comprueba la sesión antes de volver a intentarlo.';

  @override
  String get workbenchContinueSession => 'Continuar';

  @override
  String get workbenchContinuingSession => 'Continuando…';

  @override
  String get workbenchStateAnswered => 'Respondida';

  @override
  String get workbenchTurnIncomplete => 'Esta ejecución no se completó';

  @override
  String get controllerQueueUnconfirmed =>
      'El estado del mensaje no está confirmado. Actualiza la conversación.';

  @override
  String get homeGreetingMorning => 'Buenos días';

  @override
  String get homeGreetingNoon => 'Buenas tardes';

  @override
  String get homeGreetingAfternoon => 'Buenas tardes';

  @override
  String get homeGreetingEvening => 'Buenas noches';

  @override
  String get homeGreetingNight => 'Ya es tarde';

  @override
  String get homeCareLongBreak => 'Si te apetece, toma un descanso más largo.';

  @override
  String get homeCarePause =>
      'Un sorbo de agua, una mirada afuera. Un momento para ti.';

  @override
  String get homeCareNightWorking =>
      'Si sigues trabajando, deja un rato para descansar esta noche.';

  @override
  String get homeCareNightQuiet => 'Está bien dejar algo para mañana.';

  @override
  String get homeCareBusyDay =>
      'Hoy has pasado bastante tiempo aquí. Guarda un rato para ti.';

  @override
  String get homeCareDecision => 'Tómate tu tiempo para decidir.';

  @override
  String get homeCareLongWait =>
      'La espera se alarga. Aprovecha para cuidarte un poco.';

  @override
  String get homeCareWelcomeBack =>
      'Qué bueno verte de nuevo. Sigue a tu ritmo.';

  @override
  String get homeCareFirstIdea => 'Empieza con una idea, cuando quieras.';

  @override
  String get homeCareMeal => '¿Aún no has comido? Haz un hueco para comer.';

  @override
  String get homeCareEasterEgg =>
      'Logro secreto: cuidarte. Sin barra de progreso.';

  @override
  String get homeCareWeekend =>
      'Un fin de semana a tu ritmo, con espacio para respirar.';

  @override
  String get homeCareDailyProgress =>
      'Que hoy haya avances y también un poco de calma.';

  @override
  String get homeCareDailySpace => 'Las ideas necesitan espacio. Tú también.';

  @override
  String get homeCareDailyPace =>
      'Una cosa a la vez, con un poco de margen para ti.';

  @override
  String get workbenchReturnHome => 'Volver al inicio';

  @override
  String get workbenchVisualization => 'Visualización';

  @override
  String get workbenchVisualizationUnavailable =>
      'Esta visualización aún no está disponible.';

  @override
  String get workbenchDesktopVersionUnknown => 'Versión desconocida';

  @override
  String get appTitle => 'Relayune';

  @override
  String get commonBack => 'Volver';

  @override
  String get commonCancel => 'Cancelar';

  @override
  String get commonClose => 'Cerrar';

  @override
  String get commonContinue => 'Continuar';

  @override
  String get commonRetry => 'Reintentar';

  @override
  String get commonSave => 'Guardar';

  @override
  String get commonSubmit => 'Enviar';

  @override
  String get commonSettings => 'Ajustes';

  @override
  String get commonLogOut => 'Cerrar sesión';

  @override
  String get commonReject => 'Rechazar';

  @override
  String get commonAllow => 'Permitir';

  @override
  String get unavailableTitle => 'Relayune no está disponible temporalmente';

  @override
  String get clearLoginSession => 'Borrar sesión de inicio';

  @override
  String get updateInstallerUnavailable =>
      'No se pudo abrir el instalador del sistema. Inténtalo más tarde.';

  @override
  String get updateReadyTitle => 'Actualización lista';

  @override
  String updateDownloaded(String version) {
    return 'Relayune $version se descargó y verificó de forma segura en segundo plano.';
  }

  @override
  String get updateLater => 'Más tarde';

  @override
  String get updateInstall => 'Instalar actualización';

  @override
  String get authSecurityBadge =>
      'Espacio de trabajo cifrado de extremo a extremo';

  @override
  String get authEmailTitle =>
      'Continúa las tareas de tu ordenador desde el móvil';

  @override
  String get authPasswordTitle => 'Inicia sesión o crea una cuenta';

  @override
  String get authVerificationTitle => 'Revisa tu correo';

  @override
  String get authEmailSubtitle =>
      'Tras iniciar sesión, usa el código de 8 caracteres del escritorio para crear una conexión cifrada de extremo a extremo.';

  @override
  String get authPasswordSubtitle =>
      'Inicia sesión con tu contraseña o verifica primero el correo si es tu primera vez.';

  @override
  String get authVerificationSubtitle =>
      'El enlace de verificación solo se puede usar una vez y caduca pronto.';

  @override
  String get authEmailLabel => 'Correo electrónico';

  @override
  String get authInvalidEmail => 'Introduce una dirección de correo válida.';

  @override
  String get authContinue => 'Continuar';

  @override
  String get authChangeEmail => 'Cambiar correo';

  @override
  String get authPasswordLabel => 'Contraseña';

  @override
  String get authShowPassword => 'Mostrar contraseña';

  @override
  String get authHidePassword => 'Ocultar contraseña';

  @override
  String get authPasswordRequired => 'Introduce tu contraseña.';

  @override
  String get authSignIn => 'Iniciar sesión';

  @override
  String get authVerifyEmailAction =>
      '¿Primera vez u olvidaste la contraseña? Verifica el correo';

  @override
  String get authVerificationInstructions =>
      'Abre el correo de verificación y configura una contraseña en la página segura. Después vuelve aquí.';

  @override
  String get authPasswordSet => 'Ya configuré mi contraseña';

  @override
  String get authResendEmail => 'Reenviar correo';

  @override
  String get authSecurityNote =>
      'El servidor solo enruta texto cifrado. El código de conexión y las claves de contenido nunca se suben.';

  @override
  String get pairingExit => 'Salir';

  @override
  String get pairingTitle => 'Escanea para conectar tu ordenador';

  @override
  String get pairingSubtitle => 'Lleva tu trabajo contigo.';

  @override
  String get pairingEnterCodeTitle => 'O introduce el código de 8 caracteres';

  @override
  String get pairingEnterCodeHelp =>
      'Introduce el código que aparece en tu ordenador.';

  @override
  String get pairingSearching => 'Buscando ordenadores pendientes de conexión…';

  @override
  String get pairingComputerLabel => 'Ordenador que conectar';

  @override
  String pairingWillConnect(String device) {
    return 'Conectando con: $device';
  }

  @override
  String get pairingStartOnDesktop =>
      'Elige primero «Conectar nuevo cliente» en el escritorio e introduce el nuevo código.';

  @override
  String get pairingSearchAgain => 'Buscar de nuevo';

  @override
  String get pairingCodeLabel => 'Código de conexión de 8 caracteres';

  @override
  String get pairingSecureConnect => 'Conectar de forma segura';

  @override
  String get pairingScanTitle => '¿Dónde está el código QR?';

  @override
  String get pairingScanHelp =>
      'Abre Relayune en tu ordenador y selecciona «Conectar nuevo cliente».\nEscanea el QR de esa ventana.';

  @override
  String get pairingOpenCamera => 'Escanear para conectar';

  @override
  String get pairingPrivacyNote =>
      'Cifrado de extremo a extremo. Solo tus dispositivos pueden leer las sesiones.';

  @override
  String pairingMinimumDesktop(String version) {
    return 'Versión mínima de escritorio compatible: $version';
  }

  @override
  String get pairingDeriving => 'Verificando conexión…';

  @override
  String get pairingWaitingDesktop => 'Esperando confirmación del ordenador…';

  @override
  String get pairingActivating => 'Creando canal cifrado…';

  @override
  String get pairingDerivingDetail =>
      'Creando en este dispositivo el recurso SPAKE2 y una clave de contenido independiente.';

  @override
  String get pairingWaitingDesktopDetail =>
      'Mantén Relayune abierto en el ordenador.';

  @override
  String get pairingActivatingDetail =>
      'Verificando el primer catálogo de sesiones cifrado.';

  @override
  String get scannerTitle => 'Escanea el QR de conexión del ordenador';

  @override
  String get scannerResume => 'Reanudar escaneo';

  @override
  String get scannerInvalid =>
      'Este no es un QR de conexión de Relayune. Escanea el código actual del escritorio.';

  @override
  String get scannerHelp =>
      'Coloca dentro del marco el QR que muestra Relayune en el ordenador.';

  @override
  String get scannerUnavailable =>
      'La cámara no está disponible. Permite que Relayune use la cámara en los ajustes del sistema o conecta manualmente.';

  @override
  String get settingsTitle => 'Ajustes';

  @override
  String get settingsSignedInAccount => 'Cuenta activa';

  @override
  String get settingsAccountSection => 'Cuenta';

  @override
  String get settingsPreferencesSection => 'Preferencias';

  @override
  String get settingsHelpLegalSection => 'Ayuda y aspectos legales';

  @override
  String get settingsLanguage => 'Idioma';

  @override
  String get settingsLanguageSystemDefault =>
      'Predeterminado (idioma del sistema)';

  @override
  String settingsLanguageSystemDefaultValue(String language) {
    return 'Predeterminado · $language';
  }

  @override
  String get settingsLanguageSaveFailed =>
      'El idioma cambió, pero no se pudo guardar la preferencia.';

  @override
  String get settingsReleaseNotes => 'Notas de la versión';

  @override
  String get settingsSupport => 'Soporte';

  @override
  String get settingsTerms => 'Términos del servicio';

  @override
  String get settingsPrivacy => 'Política de privacidad';

  @override
  String get settingsLegalLanguage => 'Español';

  @override
  String get settingsOpenLinkFailed => 'No se pudo abrir el enlace.';

  @override
  String get releaseTitle => 'Notas de la versión';

  @override
  String get releaseLoading => 'Cargando notas de la versión';

  @override
  String get releaseErrorTitle => 'Notas no disponibles';

  @override
  String get releaseErrorMessage =>
      'Comprueba la conexión e inténtalo de nuevo.';

  @override
  String get releaseEmptyTitle => 'Aún no hay notas';

  @override
  String get releaseEmptyMessage =>
      'Las próximas actualizaciones aparecerán aquí.';

  @override
  String get releaseVersion => 'Versión';

  @override
  String get releaseWeb => 'Web';

  @override
  String get releaseServer => 'Servidor';

  @override
  String get notificationEnabledTitle =>
      'Las notificaciones de tareas están activadas';

  @override
  String get notificationPrimerTitle =>
      'La tarea se ejecuta en el ordenador: no tienes que vigilarla';

  @override
  String get notificationEnabledBody =>
      'Relayune te avisa cuando una tarea requiere atención o termina.';

  @override
  String get notificationPrimerBody =>
      'Responde a preguntas y aprobaciones a tiempo y consulta el resumen al finalizar.';

  @override
  String get notificationBenefitAction =>
      'Atención: permite, rechaza o abre una respuesta desde la notificación';

  @override
  String get notificationBenefitCompletion =>
      'Tarea finalizada: revisa el resumen antes de abrirla';

  @override
  String get notificationBenefitPrivacy =>
      'Las notificaciones nunca muestran comandos, rutas, códigos ni claves';

  @override
  String get notificationPermissionRejected =>
      'Las notificaciones del sistema siguen desactivadas. Puedes permitirlas en los ajustes.';

  @override
  String get notificationGotIt => 'Entendido';

  @override
  String get notificationOpenSettings => 'Abrir ajustes del sistema';

  @override
  String get notificationEnable => 'Activar notificaciones';

  @override
  String get notificationNotNow => 'Ahora no';

  @override
  String get notificationSemanticsExample =>
      'Ejemplos: una aprobación requiere atención, una pregunta necesita respuesta y una tarea de Claude terminó con un resumen';

  @override
  String get notificationNow => 'Ahora';

  @override
  String get notificationSampleTask => 'Mejorar las notificaciones móviles';

  @override
  String get notificationSampleBody =>
      'La guía de permisos y el resumen de tarea finalizada están listos…';

  @override
  String get notificationApprovalTitle => 'Operación pendiente de confirmación';

  @override
  String get notificationQuestionTitle => 'Se necesita tu respuesta';

  @override
  String notificationTaskPaused(String provider) {
    return '$provider · tarea pausada';
  }

  @override
  String notificationApprovalBody(int minutes) {
    return 'Permite o rechaza esta operación en $minutes min.';
  }

  @override
  String notificationQuestionBody(int minutes) {
    return 'Responde en $minutes min. La tarea continuará después.';
  }

  @override
  String notificationTaskCompleted(String provider) {
    return 'Tarea de $provider finalizada';
  }

  @override
  String get notificationMainTask => 'Tarea principal';

  @override
  String get notificationMainResultReady =>
      'El resultado de la tarea principal está listo. Toca para verlo.';

  @override
  String notificationNamedResultReady(String name) {
    return 'El resultado de «$name» está listo. Toca para verlo.';
  }

  @override
  String get notificationAllowOnce => 'Permitir una vez';

  @override
  String get notificationAnswer => 'Responder';

  @override
  String get notificationChannelAttention => 'Requiere atención';

  @override
  String get notificationChannelCompleted => 'Tarea finalizada';

  @override
  String get notificationChannelAttentionDescription =>
      'Alertas de aprobaciones y preguntas de Relayune';

  @override
  String get notificationChannelCompletedDescription =>
      'Alertas de finalización de la tarea principal de Relayune';

  @override
  String get notificationRedactedLink => '[enlace]';

  @override
  String get notificationRedactedPath => '[ruta]';

  @override
  String get notificationRedactedSecret => '[oculto]';

  @override
  String get workbenchTitle => 'Espacio de trabajo';

  @override
  String get workbenchDevice => 'Dispositivo';

  @override
  String get workbenchOpenNavigation => 'Abrir navegación';

  @override
  String workbenchPendingApprovals(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count aprobaciones pendientes',
      one: '1 aprobación pendiente',
    );
    return '$_temp0';
  }

  @override
  String get workbenchSessions => 'Sesiones';

  @override
  String get workbenchOnline => 'En línea';

  @override
  String get workbenchOffline => 'Sin conexión';

  @override
  String get workbenchDeviceOnlineRealtime =>
      'Ordenador en línea · sincronización en tiempo real';

  @override
  String get workbenchDeviceOfflineQueued =>
      'Ordenador sin conexión · solo registros en caché';

  @override
  String get workbenchDeviceOnlineReconnecting =>
      'Ordenador en línea · restaurando conexión en tiempo real';

  @override
  String get workbenchDeviceOfflineReconnecting =>
      'Ordenador sin conexión · restaurando conexión en tiempo real';

  @override
  String get workbenchDeviceOnlineWaiting =>
      'Ordenador en línea · esperando conexión en tiempo real';

  @override
  String get workbenchDeviceOfflineWaiting =>
      'Ordenador sin conexión · esperando conexión en tiempo real';

  @override
  String get workbenchProjectsSessions => 'Proyectos y sesiones';

  @override
  String get workbenchNoSessionsSynced =>
      'Aún no se han sincronizado sesiones desde el ordenador';

  @override
  String get workbenchSignedInAccount => 'Cuenta conectada';

  @override
  String get workbenchNotSignedIn => 'Sesión no iniciada';

  @override
  String get workbenchNewSession => 'Nueva sesión';

  @override
  String get workbenchDefaultSessionName => 'Nueva sesión remota';

  @override
  String get workbenchHistoryFailed =>
      'No se pudo cargar el historial; el contenido actual puede estar incompleto';

  @override
  String get workbenchLoadEarlier => 'Cargar mensajes anteriores';

  @override
  String get workbenchSendFirst => 'Envía tu primera instrucción para empezar';

  @override
  String get workbenchAtBeginning => 'Este es el primer mensaje';

  @override
  String get workbenchAddAttachment => 'Añadir adjunto';

  @override
  String workbenchRemoveAttachment(String name) {
    return 'Eliminar $name';
  }

  @override
  String get workbenchReadOnly => 'Esta sesión es de solo lectura';

  @override
  String get workbenchOfflineQueued =>
      'Ordenador sin conexión · no se puede enviar';

  @override
  String get workbenchSteerPlaceholder =>
      'Envía una instrucción para detener y continuar…';

  @override
  String get workbenchSendPlaceholder => 'Envía instrucciones al ordenador…';

  @override
  String get workbenchStopTask => 'Detener tarea';

  @override
  String get workbenchSending => 'Enviando';

  @override
  String get workbenchSend => 'Enviar';

  @override
  String get workbenchYou => 'Tú';

  @override
  String get workbenchLocalActivity => 'Actividad local';

  @override
  String get workbenchToday => 'Hoy';

  @override
  String get workbenchYesterday => 'Ayer';

  @override
  String get workbenchDayBeforeYesterday => 'Anteayer';

  @override
  String get workbenchSystemNotice => 'Aviso del sistema';

  @override
  String workbenchApprovalSource(String name) {
    return 'Origen: $name';
  }

  @override
  String workbenchApprovalDirectory(String path) {
    return 'Directorio: $path';
  }

  @override
  String get workbenchApprovalPermission => 'Permiso solicitado';

  @override
  String get workbenchSelect => 'Seleccionar';

  @override
  String get workbenchOtherAnswer => 'Otra respuesta…';

  @override
  String get workbenchSkipAnswer => 'Ahora no';

  @override
  String get workbenchHighRiskTitle =>
      '¿Permitir una operación de alto riesgo?';

  @override
  String get workbenchOperationOnComputer =>
      'Esta operación se ejecutará en tu ordenador.';

  @override
  String get workbenchConfirmAllow => 'Confirmar y permitir';

  @override
  String get workbenchAnswerLabel => 'Respuesta';

  @override
  String get workbenchAllowOnce => 'Permitir una vez';

  @override
  String get workbenchAlwaysAllowSession => 'Permitir siempre en esta sesión';

  @override
  String get workbenchAllowAndRemember => 'Permitir y recordar';

  @override
  String get workbenchAlwaysRejectSession => 'Rechazar siempre en esta sesión';

  @override
  String get workbenchRejectAndRemember => 'Rechazar y recordar';

  @override
  String get workbenchSaveDecisionTitle => '¿Recordar esta decisión?';

  @override
  String get workbenchSaveDecisionMessage =>
      'Relayune aplicará automáticamente esta elección solo a operaciones similares de la sesión actual.';

  @override
  String get workbenchConfirm => 'Confirmar';

  @override
  String get workbenchRejectAndStop => 'Rechazar y detener la tarea';

  @override
  String get workbenchNotificationSettings => 'Notificaciones de tareas';

  @override
  String get workbenchConnectAnother => 'Conectar otro ordenador';

  @override
  String get workbenchConnectAnotherSubtitle =>
      'Eliminar de este móvil la clave de contenido y la autorización actuales';

  @override
  String get workbenchConnectAnotherTitle => '¿Conectar otro ordenador?';

  @override
  String get workbenchConnectAnotherMessage =>
      'La clave de contenido y el token de autorización del móvil se eliminarán del almacén seguro de este dispositivo. No se borrarán datos del servidor ni del ordenador.';

  @override
  String get workbenchNoSessions => 'No hay sesiones disponibles';

  @override
  String get workbenchNoSessionsHelp =>
      'Mantén el escritorio en línea o crea una sesión en un directorio de proyecto del ordenador.';

  @override
  String get workbenchHistoryLoading => 'Cargando historial';

  @override
  String get workbenchHistoryLoadingOlder => 'Cargando mensajes anteriores…';

  @override
  String get workbenchHistoryLimit =>
      'El historial se carga al abrir una sesión, hasta 500 mensajes cada vez';

  @override
  String get workbenchFilePreviewRetry =>
      'La vista previa del archivo falló. Inténtalo de nuevo.';

  @override
  String get workbenchSecureFileReading =>
      'Leyendo de forma segura desde el ordenador…';

  @override
  String get workbenchFileUnavailable =>
      'El archivo ha caducado o se eliminó del ordenador.';

  @override
  String get workbenchApprovalCommand => 'Ejecutar comando';

  @override
  String get workbenchApprovalFileChange => 'Modificar archivo';

  @override
  String get workbenchApprovalChoice => 'Se necesita tu elección';

  @override
  String get workbenchApprovalTool => 'Ejecutar herramienta local';

  @override
  String get workbenchStatePending => 'Pendiente';

  @override
  String get workbenchStateDeciding => 'Enviando';

  @override
  String get workbenchStateApproved => 'Aprobada';

  @override
  String get workbenchStateRejected => 'Rechazada';

  @override
  String get workbenchStateExpired => 'Caducada';

  @override
  String get workbenchLocalRelay => 'Relay local';

  @override
  String get workbenchEncryptionProtocol => 'Protocolo de cifrado';

  @override
  String get workbenchPairingProtocol => 'Protocolo de vinculación';

  @override
  String get workbenchRealtimeChannel => 'Canal en tiempo real';

  @override
  String get workbenchTechnicalDetails => 'Detalles técnicos';

  @override
  String get workbenchRealtimeConnection => 'Conexión en tiempo real';

  @override
  String get workbenchHeartbeatPath => 'iPhone ↔ Server · WebSocket';

  @override
  String get workbenchHeartbeatHealthy => 'Latido estable';

  @override
  String get workbenchHeartbeatWaiting => 'Esperando el primer latido';

  @override
  String get workbenchLastHeartbeat => 'Último latido';

  @override
  String get workbenchRoundTrip => 'Ida y vuelta';

  @override
  String get workbenchWebSocketHeartbeat => 'Latido WebSocket';

  @override
  String get workbenchDesktopHeartbeat => 'Latido del ordenador';

  @override
  String get workbenchJustNow => 'Ahora';

  @override
  String workbenchSecondsAgo(int seconds) {
    return 'Hace $seconds s';
  }

  @override
  String workbenchMinutesAgo(int minutes) {
    return 'Hace $minutes min';
  }

  @override
  String get workbenchStateVersion => 'Versión del estado';

  @override
  String get workbenchAwaitingConfirmation => 'Esperando confirmación';

  @override
  String get workbenchLastConfirmed => 'Última confirmación';

  @override
  String get workbenchEventAck => 'Confirmación de eventos';

  @override
  String get workbenchOfflineQueue => 'Cola sin conexión';

  @override
  String get workbenchSecurityBoundary =>
      'Límite del cifrado de extremo a extremo';

  @override
  String get workbenchPhonePlaintextEndpoint =>
      'El móvil es un extremo con texto legible para la aplicación';

  @override
  String get workbenchServerCiphertextOnly =>
      'El servidor solo guarda sobres de texto cifrado autenticado';

  @override
  String get workbenchKeyInSecureStorage =>
      'Las claves de contenido se guardan en el almacén seguro del sistema';

  @override
  String get workbenchCodeNeverUploaded =>
      'El código de conexión de 8 caracteres nunca se sube';

  @override
  String get workbenchNotConfirmed => 'Aún sin confirmar';

  @override
  String get workbenchRealtimeConnected => 'WebSocket conectado';

  @override
  String get workbenchRealtimeConnecting => 'Conectando';

  @override
  String get workbenchRealtimeReconnecting => 'Reconectando';

  @override
  String get workbenchRealtimeIdle => 'Esperando conexión';

  @override
  String workbenchNotificationStatus(String status) {
    return '$status · las notificaciones funcionan mientras siga activa la conexión en segundo plano; no se garantiza la entrega si el sistema cierra la app';
  }

  @override
  String get workbenchNotificationAllowed => 'Permitidas';

  @override
  String get workbenchNotificationDisabled => 'Desactivadas';

  @override
  String get workbenchNotificationUnknown => 'Desconocido';

  @override
  String get workbenchClose => 'Cerrar';

  @override
  String get workbenchProjectConfiguration => 'Ajustes del proyecto';

  @override
  String get workbenchProjectConfigurationTitle => 'Ajustes del proyecto';

  @override
  String get workbenchProjectName => 'Nombre del proyecto';

  @override
  String get workbenchProjectNameHelp =>
      'Solo cambia el nombre mostrado en esta app; no renombra la carpeta del ordenador.';

  @override
  String get workbenchFullPath => 'Ruta completa';

  @override
  String get workbenchProjectPathUnavailable =>
      'El ordenador no proporcionó la ruta del proyecto';

  @override
  String workbenchSessionCount(int count) {
    return '$count sesiones';
  }

  @override
  String workbenchMoreSessions(int count) {
    return 'Mostrar más sesiones ($count)';
  }

  @override
  String get workbenchAgentRunning => 'Agent en ejecución';

  @override
  String get workbenchAgentNotRunning => 'Agent detenido';

  @override
  String get workbenchRunning => 'En ejecución';

  @override
  String get workbenchKimiSettings => 'Ajustes de Kimi';

  @override
  String get workbenchEnableYoloTitle => '¿Activar el modo YOLO?';

  @override
  String get workbenchEnableAutoTitle => '¿Activar el modo Auto?';

  @override
  String get workbenchYoloWarning =>
      'Kimi aprobará automáticamente más llamadas a herramientas locales. Actívalo solo si confías en la tarea y el proyecto.';

  @override
  String get workbenchAutoWarning =>
      'Kimi aprobará llamadas rutinarias, aunque aún puede hacerte preguntas.';

  @override
  String get workbenchConfirmEnable => 'Confirmar y activar';

  @override
  String get workbenchUploadTooManyImages =>
      'Puedes añadir hasta 4 imágenes por mensaje.';

  @override
  String workbenchUploadUnsupportedImages(String names) {
    return '$names no son compatibles. Elige PNG, JPEG, WebP, GIF o AVIF.';
  }

  @override
  String get workbenchUploadTooLarge =>
      'Los adjuntos de un mensaje no pueden superar 20 MiB en total.';

  @override
  String workbenchPreviewGenerateFailed(String name) {
    return 'No se pudo leer ni generar la vista previa de $name. Inténtalo de nuevo.';
  }

  @override
  String get workbenchKimiViewAgents => 'Ver subagentes';

  @override
  String get workbenchKimiViewAgentsDescription =>
      'Abre la ventana de trabajo de Agents sobre el compositor sin iniciar otra tarea del modelo.';

  @override
  String get workbenchKimiOpenNow => 'Abrir ahora';

  @override
  String get workbenchKimiSessionStatus => 'Estado de la sesión';

  @override
  String get workbenchKimiSessionStatusDescription =>
      'Consulta la tarea, las aprobaciones, el contexto y la sincronización local.';

  @override
  String get workbenchKimiLocalStatus => 'Estado local';

  @override
  String get workbenchKimiModel => 'Modelo';

  @override
  String get workbenchKimiModelDescription =>
      'Cambia el modelo usado en esta sesión de Kimi.';

  @override
  String get workbenchKimiSessionSettings => 'Ajustes de sesión';

  @override
  String get workbenchKimiPermissionMode => 'Modo de permisos';

  @override
  String get workbenchKimiPermissionModeDescription =>
      'Consulta o cambia la política de aprobación de herramientas locales.';

  @override
  String get workbenchKimiSecuritySettings => 'Ajustes de seguridad';

  @override
  String get workbenchKimiPlanMode => 'Modo Plan';

  @override
  String get workbenchKimiPlanModeDescription =>
      'Pide a Kimi que planifique antes de ejecutar la tarea.';

  @override
  String get workbenchKimiYoloMode => 'Modo YOLO';

  @override
  String get workbenchKimiYoloModeDescription =>
      'Aprueba más llamadas automáticamente; se requiere confirmación antes de activarlo.';

  @override
  String get workbenchKimiConfirmationRequired => 'Confirmación necesaria';

  @override
  String get workbenchKimiSettingsDescription =>
      'Abre los ajustes de modelo, Thinking y permisos.';

  @override
  String workbenchKimiInputRequired(String hint) {
    return 'Entrada necesaria: $hint';
  }

  @override
  String get workbenchKimiNativeCommandDescription =>
      'Comando nativo de Kimi ACP que se ejecuta como una tarea de comando real.';

  @override
  String get workbenchKimiNativeCommand => 'Comando nativo';

  @override
  String get workbenchKimiContextSyncing =>
      'Contexto pendiente de sincronización';

  @override
  String get workbenchKimiWaitingForSync => 'Esperando sincronización';

  @override
  String workbenchKimiContextUsage(int percent, String used, String size) {
    return 'Contexto $percent% · $used/$size';
  }

  @override
  String workbenchKimiContextUsed(String used) {
    return 'Contexto $used';
  }

  @override
  String get workbenchKimiContext => 'Contexto';

  @override
  String get workbenchKimiModelSyncing => 'Modelo pendiente de sincronización';

  @override
  String get workbenchKimiQuickCommands => 'Comandos rápidos';

  @override
  String get workbenchKimiNoMatchingCommands => 'No hay comandos coincidentes';

  @override
  String get workbenchKimiTask => 'Tarea';

  @override
  String get workbenchKimiIdle => 'Inactivo';

  @override
  String get workbenchKimiSubagents => 'Subagentes';

  @override
  String workbenchKimiActiveCount(int count) {
    return '$count activos';
  }

  @override
  String get workbenchKimiApprovals => 'Aprobaciones';

  @override
  String workbenchKimiPendingCount(int count) {
    return '$count pendientes';
  }

  @override
  String get workbenchKimiSettingsOffline =>
      'No se pueden cambiar los ajustes de Kimi mientras Relay está sin conexión.';

  @override
  String get workbenchKimiSettingsRunning =>
      'Detén la tarea principal de Kimi antes de cambiar los ajustes.';

  @override
  String get workbenchKimiNoOptions =>
      'El ordenador aún no ha sincronizado opciones configurables.';

  @override
  String get workbenchKimiEncryptedSettings =>
      'Los ajustes se envían con cifrado de extremo a extremo a Kimi Code en tu ordenador. El servidor no puede leerlos.';

  @override
  String get workbenchKimiManualApproval => 'Aprobación manual';

  @override
  String get workbenchSessionSettings => 'Ajustes de sesión';

  @override
  String get workbenchSessionSettingsOffline =>
      'No se pueden cambiar los ajustes de sesión mientras Relay está sin conexión.';

  @override
  String get workbenchSessionSettingsRunning =>
      'Detén la tarea actual antes de cambiar sus ajustes.';

  @override
  String get workbenchNoConfigOptions =>
      'El ordenador aún no ha sincronizado opciones configurables.';

  @override
  String workbenchEncryptedSessionSettings(String provider) {
    return 'Los ajustes se envían con cifrado de extremo a extremo a $provider en tu ordenador. El servidor no puede leerlos.';
  }

  @override
  String get workbenchUnrestrictedPermissionsTitle =>
      '¿Cambiar el modo de permisos?';

  @override
  String get workbenchUnrestrictedPermissionsWarning =>
      'Esto cambia si las herramientas locales se permiten, se rechazan o requieren aprobación. Revisa el modo seleccionado antes de continuar.';

  @override
  String get workbenchCoworkCreateOnDesktop =>
      'Crea primero las tareas de Cowork en Claude Desktop; aquí puedes controlar las existentes.';

  @override
  String get workbenchProcessing => 'Procesando';

  @override
  String get workbenchProcess => 'Proceso';

  @override
  String workbenchDurationMinutesSeconds(int minutes, int seconds) {
    return '$minutes min $seconds s';
  }

  @override
  String workbenchDurationSeconds(int seconds) {
    return '$seconds s';
  }

  @override
  String workbenchMonthDay(int month, int day) {
    return '$day/$month';
  }

  @override
  String workbenchYearMonthDay(int year, int month, int day) {
    return '$day/$month/$year';
  }

  @override
  String get workbenchImageUrlUnavailable =>
      'La dirección de la imagen no está disponible.';

  @override
  String workbenchFilePreviewAvailable(String kind) {
    return 'Vista previa · $kind · hasta 1 MB';
  }

  @override
  String get workbenchFilePreviewUnsupported =>
      'No se puede previsualizar este formato';

  @override
  String workbenchImageReadFailed(String name) {
    return '$name\nNo se pudo leer la imagen';
  }

  @override
  String workbenchImageThumbnailLabel(String name) {
    return 'Miniatura de $name; toca para abrir la vista previa';
  }

  @override
  String get workbenchViewOriginal => 'Ver original';

  @override
  String get workbenchLoadingOriginal =>
      'Cargando el original de forma segura…';

  @override
  String get workbenchOriginalReadFailed =>
      'No se pudo leer la imagen original. Inténtalo de nuevo.';

  @override
  String workbenchActivityFailed(String label) {
    return 'Error al $label';
  }

  @override
  String workbenchActivityCompleted(String label) {
    return '$label completado';
  }

  @override
  String workbenchActivityRunning(String label) {
    return 'En curso: $label';
  }

  @override
  String get workbenchViewOutput => 'Toca para ver la salida';

  @override
  String get workbenchViewThumbnail => 'Toca para ver la miniatura';

  @override
  String get workbenchSemanticSeparator => ', ';

  @override
  String workbenchCommandsRunning(int count) {
    return 'Ejecutando $count comandos';
  }

  @override
  String workbenchCommandsFailed(int count) {
    return 'Fallaron algunos de $count comandos';
  }

  @override
  String workbenchCommandsCompleted(int count) {
    return 'Se ejecutaron $count comandos';
  }

  @override
  String workbenchFilesReading(int count) {
    return 'Leyendo $count archivos';
  }

  @override
  String workbenchFilesReadFailed(int count) {
    return 'No se pudieron leer algunos de $count archivos';
  }

  @override
  String workbenchFilesRead(int count) {
    return 'Se leyeron $count archivos';
  }

  @override
  String workbenchFilesChanging(int count) {
    return 'Modificando $count archivos';
  }

  @override
  String workbenchFilesChangeFailed(int count) {
    return 'Fallaron algunos cambios en $count archivos';
  }

  @override
  String workbenchFilesChanged(int count) {
    return 'Se modificaron $count archivos';
  }

  @override
  String workbenchOperationsRunning(int count) {
    return 'Procesando $count operaciones de archivos y comandos';
  }

  @override
  String workbenchOperationsFailed(int count) {
    return 'Fallaron algunas de $count operaciones de archivos y comandos';
  }

  @override
  String workbenchOperationsCompleted(int count) {
    return 'Se completaron $count operaciones de archivos y comandos';
  }

  @override
  String get workbenchToolCommand => 'Ejecutar comando';

  @override
  String workbenchToolReadFilesSubject(int count, String subject) {
    return 'Leer $count archivos: $subject';
  }

  @override
  String workbenchToolReadFiles(int count) {
    return 'Leer $count archivos';
  }

  @override
  String workbenchToolReadFileSubject(String subject) {
    return 'Leer archivo: $subject';
  }

  @override
  String get workbenchToolReadFile => 'Leer archivo';

  @override
  String workbenchToolChangeFilesSubject(int count, String subject) {
    return 'Modificar $count archivos: $subject';
  }

  @override
  String workbenchToolChangeFiles(int count) {
    return 'Modificar $count archivos';
  }

  @override
  String workbenchToolChangeFileSubject(String subject) {
    return 'Modificar archivo: $subject';
  }

  @override
  String get workbenchToolChangeFile => 'Modificar archivo';

  @override
  String workbenchToolCallNamed(String name) {
    return 'Llamar a herramienta: $name';
  }

  @override
  String get workbenchToolCall => 'Llamar a herramienta';

  @override
  String workbenchToolWebSearchSubject(String subject) {
    return 'Buscar en la web: $subject';
  }

  @override
  String get workbenchToolWebSearch => 'Buscar en la web';

  @override
  String workbenchToolImageViewSubject(String subject) {
    return 'Ver imagen: $subject';
  }

  @override
  String get workbenchToolImageView => 'Ver imagen';

  @override
  String get workbenchToolImageGeneration => 'Generar imagen';

  @override
  String get workbenchToolContextCompaction =>
      'Compactar el contexto automáticamente';

  @override
  String get workbenchToolWait => 'Esperar la tarea';

  @override
  String get workbenchLocalOperation => 'Operación local';

  @override
  String get workbenchDeliverySent => 'Enviado';

  @override
  String get workbenchDeliverySending => 'Enviando';

  @override
  String get workbenchDeliveryFailed => 'Error al enviar';

  @override
  String workbenchAssistantRunningElapsed(String agent, String duration) {
    return '$agent está en ejecución; tiempo $duration';
  }

  @override
  String workbenchAssistantRunning(String agent) {
    return '$agent está en ejecución';
  }

  @override
  String workbenchAssistantElapsed(String duration) {
    return '· tiempo $duration';
  }

  @override
  String get workbenchCloseFilePreview => 'Cerrar vista previa';

  @override
  String workbenchFileReadCompleted(String name) {
    return 'Lectura completada: $name';
  }

  @override
  String workbenchFileReading(String name) {
    return 'Leyendo archivo: $name';
  }

  @override
  String workbenchFileReadFailed(String message) {
    return 'Error al leer el archivo: $message';
  }

  @override
  String get workbenchFilePreviewFailed =>
      'Error en la vista previa. Inténtalo de nuevo.';

  @override
  String get workbenchFileKindTableText => 'Texto tabular';

  @override
  String get workbenchFileKindLog => 'Registro';

  @override
  String get workbenchFileKindPlainText => 'Texto sin formato';

  @override
  String get workbenchFileKindCodeOrConfig => 'Código o configuración';

  @override
  String workbenchAgentsWorking(int count) {
    return '$count subagentes trabajando en paralelo';
  }

  @override
  String get workbenchAgentWindow => 'Ventana de trabajo de Agents';

  @override
  String get workbenchAgentWindowDescription =>
      'Sincroniza el estado y la actividad de herramientas sin mostrar razonamiento privado';

  @override
  String workbenchMoreAgents(int count) {
    return '$count Agents más · desplázate para verlos';
  }

  @override
  String workbenchCurrentActivity(String activity) {
    return 'Actual · $activity';
  }

  @override
  String get workbenchAllAgents => 'Todos los Agents';

  @override
  String get workbenchActivityTimeline => 'Cronología de actividad';

  @override
  String workbenchActivityCount(int count) {
    return '$count entradas';
  }

  @override
  String get workbenchAgentSyncing => 'Sincronizando desde este ordenador…';

  @override
  String get workbenchNoPublicActivity =>
      'Aún no hay actividad pública. Solo se sincronizan el estado y la actividad de herramientas, no el razonamiento privado.';

  @override
  String get workbenchLatestResult => 'Último resultado';

  @override
  String get workbenchWaitingForTask => 'Esperando una tarea';

  @override
  String get controllerRestoreFailed =>
      'No se pudo restaurar la conexión segura. Inicia sesión o vuelve a vincular.';

  @override
  String get controllerAuthorizationRevoked =>
      'Se revocó la autorización de este teléfono. Vuelve a conectarlo.';

  @override
  String get controllerDeviceNotConnected =>
      'Esta cuenta no está conectada a este ordenador. Reinicia la conexión en el ordenador.';

  @override
  String get controllerProjectNameRequired =>
      'El nombre del proyecto es obligatorio.';

  @override
  String controllerProjectNameTooLong(int maximum) {
    return 'El nombre no puede superar $maximum caracteres.';
  }

  @override
  String get controllerProjectNameSaveFailed =>
      'No se pudo guardar el nombre localmente. Inténtalo de nuevo.';

  @override
  String get controllerProjectNameUpdated => 'Nombre del proyecto actualizado.';

  @override
  String get controllerNewPairingLinkReceived =>
      'Se recibió un nuevo enlace. Cierra la sesión del dispositivo actual para volver a conectar.';

  @override
  String get controllerPairingLinkRequired =>
      'Introduce el enlace de conexión de Relayune mostrado por la app de escritorio.';

  @override
  String get controllerPairingDiscoveryFailed =>
      'No se encontraron ordenadores esperando conexión. Inténtalo más tarde.';

  @override
  String get controllerVerificationResent =>
      'Correo de verificación reenviado.';

  @override
  String get controllerSetPasswordFirst =>
      'Primero define una contraseña desde el enlace del correo y vuelve aquí.';

  @override
  String get controllerNoPendingComputer =>
      'Ningún ordenador espera conexión. Selecciona primero “Conectar nuevo cliente” en el ordenador.';

  @override
  String get controllerSelectComputer =>
      'Selecciona el ordenador que quieres conectar.';

  @override
  String get controllerPairingFailed =>
      'Falló la conexión segura. Comprueba el código e inténtalo de nuevo.';

  @override
  String get controllerHistoryReadFailed => 'No se pudo leer el historial.';

  @override
  String get controllerAgentRefreshFailed =>
      'No se pudo actualizar ahora la actividad de este subagente.';

  @override
  String get controllerAttachmentTooLarge =>
      'Los archivos de más de 1 MB aún no se pueden previsualizar.';

  @override
  String get controllerAttachmentUnsupported =>
      'Este formato aún no se puede previsualizar.';

  @override
  String get controllerAttachmentGone =>
      'El archivo caducó o se eliminó del ordenador.';

  @override
  String get controllerAttachmentReadFailed => 'No se pudo leer el adjunto.';

  @override
  String controllerUploadTooMany(int maximum) {
    return 'Puedes subir hasta $maximum imágenes por mensaje.';
  }

  @override
  String get controllerUploadTotalTooLarge =>
      'Los adjuntos de un mensaje no pueden superar 20 MiB en total.';

  @override
  String get controllerUploadUnsupported =>
      'Elige imágenes PNG, JPEG, WebP, GIF o AVIF.';

  @override
  String get controllerSteeringUnsupported =>
      'Esta tarea no admite más instrucciones. Detenla primero.';

  @override
  String get controllerPreparingAgent =>
      'Recibido en el ordenador · Preparando el agente';

  @override
  String get controllerWaitingForAgent =>
      'Esperando que el Agent local lo reciba';

  @override
  String get controllerWaitingForComputer =>
      'Esperando que el ordenador se conecte';

  @override
  String get controllerStopSent => 'Solicitud de parada enviada.';

  @override
  String get controllerApprovalExpired => 'Esta aprobación ha caducado.';

  @override
  String get controllerApprovalOffline =>
      'No se pueden gestionar aprobaciones con el ordenador sin conexión.';

  @override
  String get controllerApprovalAllowedSent =>
      'Permiso enviado; esperando confirmación del ordenador.';

  @override
  String get controllerApprovalRejectedSent =>
      'Rechazo enviado; esperando confirmación del ordenador.';

  @override
  String controllerDelegatedTasks(int count) {
    return 'Se delegaron $count tareas en paralelo.';
  }

  @override
  String get controllerSelectProject =>
      'Selecciona primero un proyecto sincronizado en la barra lateral.';

  @override
  String get controllerCreateSessionOffline =>
      'El ordenador está sin conexión. No se puede crear una sesión ahora.';

  @override
  String controllerSessionNameLength(int maximum) {
    return 'El nombre de la sesión debe tener entre 1 y $maximum caracteres.';
  }

  @override
  String get controllerSessionCreationBusy =>
      'La sesión anterior aún se está creando. Espera.';

  @override
  String controllerSessionCreating(String name) {
    return 'Creando «$name»…';
  }

  @override
  String get controllerSessionCreateFailed =>
      'No se pudo crear la sesión. Inténtalo más tarde.';

  @override
  String get controllerDesktopSessionCreateFailed =>
      'La app de escritorio no pudo crear la sesión.';

  @override
  String get controllerSessionCreateTimeout =>
      'Se agotó la espera para crear la sesión. Compruébalo más tarde; no crees un duplicado.';

  @override
  String controllerSessionCreated(String name) {
    return 'Se creó «$name».';
  }

  @override
  String get controllerCoworkCreateOnDesktop =>
      'Crea primero esta tarea de Cowork en Claude Desktop y contrólala aquí después.';

  @override
  String get controllerDesktopConfigFailed =>
      'La app de escritorio no pudo aplicar los ajustes de sesión.';

  @override
  String get controllerConfigApplied => 'Ajustes de sesión aplicados.';

  @override
  String get controllerConfigUpdateFailed =>
      'No se pudieron actualizar los ajustes. Inténtalo más tarde.';

  @override
  String get controllerConfigTimeout =>
      'Se agotó la espera para aplicar los ajustes. Actualiza para confirmar.';

  @override
  String get controllerInvalidEncryptedEvent =>
      'No se pudo verificar un evento cifrado. Se detuvo el avance del cursor de sincronización.';

  @override
  String get controllerApprovalNeeded => 'Esperando tu aprobación';

  @override
  String get controllerContinuing => 'Continuando';

  @override
  String get controllerApprovalProcessFailed =>
      'El ordenador no pudo gestionar esta aprobación. Inténtalo de nuevo.';

  @override
  String controllerAgentProcessing(String name) {
    return '$name está procesando';
  }

  @override
  String get controllerSummarizing => 'Resumiendo resultados';

  @override
  String get controllerThinking => 'Pensando';

  @override
  String get controllerLocalTaskFailed => 'Falló la tarea local.';

  @override
  String get controllerInterruptFailed => 'No se pudo detener la tarea actual.';

  @override
  String get controllerReplying => 'Respondiendo';

  @override
  String get controllerFinishing => 'Finalizando';

  @override
  String get controllerOrganizingFileChanges =>
      'Organizando cambios de archivos';

  @override
  String controllerFilesModified(int count) {
    return 'Se modificaron $count archivos.';
  }

  @override
  String get controllerUpdatingPlan => 'Actualizando el plan';

  @override
  String get controllerMessageQueued =>
      'Mensaje en cola. Se enviará automáticamente más tarde.';

  @override
  String controllerSessionPersisted(String agent) {
    return 'Sesión guardada en $agent.';
  }

  @override
  String controllerLocalTool(String label) {
    return 'Herramienta local: $label';
  }

  @override
  String get controllerProcessingLocalResult => 'Procesando resultado local';

  @override
  String get controllerEncryptedResponseTimeout =>
      'Se agotó la espera de la respuesta cifrada del ordenador.';

  @override
  String get controllerPairingUsedOrExpired =>
      'Esta conexión ya se usó o ha caducado.';

  @override
  String get controllerPairingConfirmationTimeout =>
      'Se agotó la espera de confirmación del escritorio. Reinicia la conexión.';

  @override
  String get controllerPairingConfirmationFailed =>
      'El ordenador no confirmó la conexión cifrada. Vuelve a conectar.';

  @override
  String get controllerDesktopOffline =>
      'La app de escritorio aún no está en línea. Mantén Relayune abierto e inténtalo de nuevo.';

  @override
  String get workbenchDefault => 'Predeterminado';

  @override
  String workbenchAgentToolCount(int count) {
    return '$count herramientas';
  }

  @override
  String workbenchAgentTokenCount(String count) {
    return '$count tok';
  }

  @override
  String get apiErrorNetworkUnavailable =>
      'No se pudo conectar con Relayune. Comprueba la red e inténtalo de nuevo.';

  @override
  String get apiErrorTimeout =>
      'La solicitud agotó el tiempo de espera. Inténtalo de nuevo.';

  @override
  String get apiErrorInvalidResponse =>
      'Relayune recibió una respuesta no válida del servidor. Inténtalo de nuevo.';

  @override
  String get apiErrorInvalidCredentials =>
      'El correo o la contraseña son incorrectos.';

  @override
  String get apiErrorAuthentication =>
      'Tu sesión ha caducado. Inicia sesión de nuevo.';

  @override
  String get apiErrorService =>
      'Relayune no está disponible temporalmente. Inténtalo más tarde.';

  @override
  String get apiErrorGeneric => 'Algo salió mal. Inténtalo de nuevo.';

  @override
  String get controllerFileAccessDenied =>
      'Relayune no puede leer algunos archivos de sesión en tu ordenador. En Mac, permite el acceso en Ajustes del Sistema → Privacidad y seguridad → Archivos y carpetas y reintenta. En otros ordenadores, revisa los permisos de archivos.';

  @override
  String get workbenchImageWaiting => 'En espera';

  @override
  String get workbenchImageLoading => 'Cargando';

  @override
  String get feedbackTitle => 'Comentarios';

  @override
  String get feedbackIntro => '¿Qué podemos mejorar?';

  @override
  String get feedbackSubtitle => 'Comparte una idea o cuéntanos un problema.';

  @override
  String get feedbackSuggestion => 'Sugerencia';

  @override
  String get feedbackBug => 'Informar de un error';

  @override
  String get feedbackDescription => 'Descripción';

  @override
  String get feedbackSuggestionHint => '¿Qué mejorarías y cómo te ayudaría?';

  @override
  String get feedbackBugHint => '¿Qué hiciste, qué esperabas y qué ocurrió?';

  @override
  String get feedbackInfo => 'Información adjunta';

  @override
  String get feedbackPrivacy =>
      'Se incluyen los datos del dispositivo. Los chats y registros no se suben automáticamente.';

  @override
  String get feedbackVersion => 'Versión de la app';

  @override
  String get feedbackModel => 'Modelo del dispositivo';

  @override
  String get feedbackSystem => 'Sistema operativo';

  @override
  String get feedbackUnknown => 'No disponible';

  @override
  String get feedbackLoading => 'Leyendo información del dispositivo…';

  @override
  String get feedbackSend => 'Enviar comentarios';

  @override
  String get feedbackFailed =>
      'No se pudo enviar. Conservamos el contenido. Comprueba la conexión e inténtalo de nuevo.';

  @override
  String get feedbackEmpty => 'Describe primero tus comentarios.';

  @override
  String get feedbackSending => 'Enviando…';

  @override
  String get feedbackSubmitNote =>
      'Guardaremos tu descripción y esta información para investigar y mejorar.';

  @override
  String get feedbackSuccess => 'Comentarios recibidos. Gracias por tu ayuda.';

  @override
  String get feedbackReference => 'Número de referencia';

  @override
  String get feedbackDone => 'Listo';

  @override
  String get workbenchStoppingTask => 'Deteniendo…';

  @override
  String get workbenchStopUnconfirmed =>
      'Aún no se ha confirmado la detención. Inténtalo de nuevo.';

  @override
  String get workbenchPreparingImages => 'Preparando imágenes…';

  @override
  String get workbenchImagePickFailed =>
      'No se pudieron abrir las fotos. Inténtalo de nuevo.';

  @override
  String get feedbackImages => 'Imágenes';

  @override
  String get feedbackOptional => 'Opcional';

  @override
  String get feedbackImageLimit => 'Puedes añadir hasta 3 imágenes.';

  @override
  String get feedbackImageFailed =>
      'No se pudo añadir la imagen. Prueba con otra.';

  @override
  String get feedbackImagePreview => 'Vista previa';

  @override
  String get feedbackRemoveImage => 'Eliminar imagen';

  @override
  String get feedbackPreparingImages => 'Preparando imágenes…';

  @override
  String get feedbackAddImage => 'Añadir imágenes';

  @override
  String get feedbackImagesHint => 'Añade capturas para ayudarnos a entender.';

  @override
  String get feedbackContact => 'Contacto';

  @override
  String get feedbackEmail => 'Correo electrónico';

  @override
  String get feedbackEmailHint =>
      'Correo de tu cuenta; puedes editarlo o borrarlo';

  @override
  String get feedbackWechat => 'ID de WeChat';

  @override
  String get feedbackWechatHint => 'Introduce tu ID de WeChat';

  @override
  String get feedbackContactHint =>
      'Solo para responder a este comentario. Ambos campos son opcionales.';

  @override
  String get feedbackEmailInvalid =>
      'Introduce un correo válido o déjalo vacío.';

  @override
  String get deviceAgents => 'Agentes';

  @override
  String get deviceAgentReady => 'Conectado';

  @override
  String get deviceAgentRunning => 'En ejecución';

  @override
  String get deviceAgentNotInstalled => 'No instalado';

  @override
  String get deviceAgentUnavailable => 'No disponible';

  @override
  String get deviceAgentNotEnabled => 'No habilitado';

  @override
  String get deviceAgentUnknown => 'Sin información';

  @override
  String get deviceAgentOffline =>
      'Equipo sin conexión · Último estado informado';

  @override
  String get openingTitle => 'Lejos, pero siempre conectado.';

  @override
  String get openingSubtitle =>
      'Retoma el trabajo con IA de tu ordenador desde donde estés.';

  @override
  String get openingSkip => 'Saltar animación';

  @override
  String get deviceQuota => 'Límites de suscripción';

  @override
  String get quotaFiveHour => '5 horas';

  @override
  String get quotaSevenDay => '7 días';

  @override
  String quotaUsed(String percent) {
    return '$percent% usado';
  }

  @override
  String quotaResets(String time) {
    return 'Se restablece $time';
  }

  @override
  String quotaUpdated(String time) {
    return 'Actualizado $time';
  }

  @override
  String get quotaPending => 'Sin datos';

  @override
  String get quotaExpired => 'Esperando nuevos límites';

  @override
  String get quotaLimitReached => 'Límite alcanzado';

  @override
  String get quotaSnapshot => 'Último registro';

  @override
  String get quotaClaudeHint =>
      'Claude informa de los límites durante las sesiones. No se estiman los datos que faltan.';

  @override
  String get settingsHapticsTitle => 'Respuesta háptica';

  @override
  String get settingsHapticsSubtitle =>
      'Una vibración suave confirma una conexión o decisión.';

  @override
  String get workbenchBackToLatest => 'Ir a lo más reciente';

  @override
  String get settingsFontSize => 'Tamaño de letra';

  @override
  String get settingsFontSizeSmall => 'Pequeño';

  @override
  String get settingsFontSizeMedium => 'Mediano';

  @override
  String get settingsFontSizeLarge => 'Grande';

  @override
  String get settingsFontSizeSaveFailed =>
      'El tamaño de letra cambió, pero no se pudo guardar. Inténtalo de nuevo.';

  @override
  String get workbenchAgentOrderHint =>
      'Mantén pulsado y arrastra para cambiar el orden';

  @override
  String get workbenchAgentOrderSaveFailed =>
      'El orden ha cambiado, pero no se pudo guardar. Inténtalo de nuevo.';

  @override
  String get settingsBuildInfo => 'Información de versión';

  @override
  String get buildTime => 'Fecha de compilación';

  @override
  String get buildSourceCommit => 'Commit del código';

  @override
  String get buildUnrecorded => 'No registrado';

  @override
  String get buildUncommitted => 'Incluye cambios sin confirmar';

  @override
  String get agentTasksTitle => 'Subtareas';

  @override
  String agentTasksCount(int count) {
    return '$count subtareas';
  }

  @override
  String agentTasksViewAll(int count) {
    return 'Ver las $count subtareas';
  }

  @override
  String agentTasksRunning(int count) {
    return '$count en ejecución';
  }

  @override
  String agentTasksFinished(int count) {
    return '$count finalizadas';
  }

  @override
  String get agentTasksAttention => 'Necesita tu atención';

  @override
  String get agentTasksInProgress => 'En curso';

  @override
  String get agentTasksEnded => 'Finalizadas';

  @override
  String get agentTaskPreparing => 'Preparando';

  @override
  String get agentTaskUnknown => 'Estado pendiente de sincronización';

  @override
  String get agentTaskCompleted => 'Completada';

  @override
  String get agentTaskFailed => 'Fallida';

  @override
  String get agentTaskStopped => 'Detenida';

  @override
  String get agentTaskAnswer => 'Esperando tu respuesta';

  @override
  String get agentTaskApprove => 'Esperando tu aprobación';

  @override
  String get agentTaskNoResult => 'Aún no se ha recibido ningún resultado';

  @override
  String get agentTaskInstructions => 'Instrucciones de la tarea';

  @override
  String get agentTaskRuntime => 'Información de ejecución';

  @override
  String agentTaskParent(String name) {
    return 'De: $name';
  }

  @override
  String agentTaskUpdated(String time) {
    return 'Actualizado $time';
  }

  @override
  String get agentTaskOffline =>
      'Ordenador sin conexión · último estado conocido';

  @override
  String get agentTaskOpenConversation => 'Abrir conversación de la subtarea';

  @override
  String get agentTaskEmpty => 'Aún no hay subtareas';

  @override
  String get agentTaskFinishedResult => 'Resultado';

  @override
  String get liveTaskRunning => 'En curso';

  @override
  String get liveTaskApproval => 'Requiere aprobación';

  @override
  String get liveTaskQuestion => 'Requiere respuesta';

  @override
  String get liveTaskCompleted => 'Completada';

  @override
  String get liveTaskFailed => 'Tarea fallida';

  @override
  String get liveTaskStopped => 'Detenida';

  @override
  String get liveTaskStale => 'Consultar estado';

  @override
  String get liveTaskOpen => 'Ver tarea';

  @override
  String get liveTaskReview => 'Revisar';

  @override
  String get liveTaskElapsed => 'Tiempo transcurrido';

  @override
  String get liveTaskUpdated => 'Última sincronización';

  @override
  String get androidPushDisclosure =>
      'Enable background alerts with JPush and, on supported devices, vivo Push. They process a push identifier, Android ID, device/system and network information for delivery. Task content and encryption keys are not sent to these providers. You can turn alerts off in system settings.';

  @override
  String get controllerSessionUnavailable =>
      'Esta conversación no está disponible en el ordenador conectado. Comprueba que su Agent esté en ejecución y que la conversación siga existiendo; después, vuelve a intentarlo o inicia una nueva conversación.';

  @override
  String get settingsSidebarAgents => 'Agentes de la barra lateral';

  @override
  String get settingsSidebarAgentsSubtitle =>
      'Elige qué agentes aparecen en la barra lateral';

  @override
  String get turnStatusRunning => 'Procesando';

  @override
  String get turnStatusCompleted => 'Turno completado';

  @override
  String get turnStatusInterrupted => 'Este turno no se completó';

  @override
  String get turnStatusUnknown => 'Registro de actividad';

  @override
  String get localWebTitle => 'Computer webpage';

  @override
  String get localWebOpen => 'Open webpage';

  @override
  String get localWebNotice =>
      'This page can load resources and submit forms or API requests to this address on your computer.';

  @override
  String get localWebUnavailable =>
      'The webpage is unavailable. Check that the computer and local service are running. A timed-out submission may already have succeeded; check before submitting again.';

  @override
  String get localWebUpdate =>
      'Update the desktop app to preview computer webpages.';

  @override
  String get localWebPaused =>
      'The preview closed when the app left the foreground. Reopen to continue.';

  @override
  String get localWebRefresh => 'Reload webpage';

  @override
  String get localWebBack => 'Previous page';

  @override
  String get localWebBlocked =>
      'This preview only permits the selected computer address.';

  @override
  String get localWebForward => 'Página siguiente';

  @override
  String get localWebAddress => 'Dirección de la página';

  @override
  String get localWebLoading => 'Conectando con tu ordenador…';

  @override
  String get accountDeletionTitle => 'Eliminar cuenta';

  @override
  String get accountDeletionBody =>
      'Se eliminarán permanentemente tu cuenta de Relayune, autorizaciones, preferencias y comentarios. Tus dispositivos perderán el acceso y se borrarán las claves de caché de este teléfono. Los proyectos y archivos de los agentes en tus ordenadores se conservan.';

  @override
  String get accountDeletionPassword => 'Confirma tu contraseña';

  @override
  String get accountDeletionConfirm => 'Eliminar mi cuenta permanentemente';

  @override
  String get accountDeletionBusy => 'Eliminando…';

  @override
  String get accountDeletionWrongPassword =>
      'Contraseña incorrecta. Inténtalo de nuevo.';

  @override
  String get accountDeletionFailed =>
      'No se pudo completar. Comprueba la conexión y reintenta. Si ya comenzó, los demás accesos siguen deshabilitados hasta terminar la limpieza.';

  @override
  String get accountDeletionDone => 'Tu cuenta ha sido eliminada.';

  @override
  String get controllerPendingInputSaveFailed =>
      'No se pudo guardar el mensaje en este teléfono. Libera espacio y vuelve a intentarlo.';

  @override
  String get workbenchHistoryRequestSending => 'Enviando solicitud';

  @override
  String get workbenchHistoryWaitingComputer =>
      'Esperando la respuesta de tu ordenador';

  @override
  String get workbenchHistoryReadingComputer =>
      'Leyendo el historial en tu ordenador';

  @override
  String get workbenchHistoryPreparing => 'Preparando mensajes';

  @override
  String workbenchHistoryElapsed(int seconds) {
    return 'Tiempo transcurrido: ${seconds}s';
  }

  @override
  String get workbenchHistoryTransferring => 'Transfiriendo el historial';

  @override
  String workbenchHistorySourceRead(String read, String total) {
    return 'El ordenador ha leído $read / $total';
  }

  @override
  String workbenchHistoryPendingTransfer(String size) {
    return 'Página pendiente de transferir: $size';
  }

  @override
  String workbenchHistoryReceived(String size) {
    return 'Recibidos $size';
  }

  @override
  String workbenchHistoryPendingReceive(String size) {
    return 'Pendiente de recibir: $size';
  }

  @override
  String get workbenchHistoryReadingCache =>
      'Leyendo el historial guardado en este teléfono';

  @override
  String get localWebResources => 'Recursos de la página';

  @override
  String get localWebGettingPage => 'Obteniendo la página…';

  @override
  String get localWebLoadingPage => 'Cargando la página…';

  @override
  String localWebResourceSummary(int completed, int active) {
    return '$completed recibidos · $active en curso';
  }

  @override
  String localWebResourceFailures(int count) {
    return '$count fallidos';
  }

  @override
  String get localWebResourceWaiting => 'Esperando respuesta';

  @override
  String get localWebResourceReceiving => 'Recibiendo';

  @override
  String get localWebResourcePreparing => 'Preparando';

  @override
  String get localWebResourceComplete => 'Recibido';

  @override
  String get localWebResourceFailed => 'Error';

  @override
  String get localWebResourceCancelled => 'Detenido';

  @override
  String get localWebResourceTransferNote =>
      'El progreso mide la recepción de la respuesta. La página puede solicitar más recursos.';

  @override
  String get localWebResourceEmpty =>
      'Los recursos solicitados por esta página aparecerán aquí.';

  @override
  String localWebResourceRecent(int count) {
    return 'Se muestran los últimos $count recursos';
  }

  @override
  String localWebElapsed(String seconds) {
    return '$seconds s';
  }

  @override
  String get localWebOpeningTitle => 'Una página de tu ordenador';

  @override
  String get localWebOpeningHint =>
      'Mantén el ordenador y el servicio web en ejecución. La página aparecerá automáticamente.';

  @override
  String get replyBranchLabel => 'Ramificar a un chat nuevo';

  @override
  String get replyBranchSameDirectory =>
      'Usar el directorio original del proyecto';

  @override
  String get replyBranchSameDirectoryDescription =>
      'Seguir compartiendo los archivos del proyecto';

  @override
  String get replyBranchWorktree => 'Crear un worktree nuevo';

  @override
  String get replyBranchWorktreeDescription =>
      'Directorio separado, basado en el commit actual';

  @override
  String get controllerReplyBranchOffline =>
      'Conecta tu ordenador para ramificar';

  @override
  String get controllerReplyBranchCreating => 'Creando un chat nuevo…';

  @override
  String get controllerReplyBranchCreated =>
      'Chat ramificado usando el directorio original del proyecto.';

  @override
  String get controllerReplyBranchFailed =>
      'No se pudo crear el chat nuevo. Inténtalo de nuevo.';

  @override
  String get controllerReplyBranchUnconfirmed =>
      'El resultado aún no está confirmado. Mantén la conexión y vuelve a consultar.';

  @override
  String get controllerReplyBranchUnavailable =>
      'Esta respuesta no se puede ramificar. Actualiza la conversación.';

  @override
  String get controllerReplyBranchBusy =>
      'Hay otra operación de chat en curso. Inténtalo en unos instantes.';

  @override
  String get controllerReplyBranchWorktreeFailed =>
      'No se pudo crear el worktree. Revisa el proyecto en tu ordenador e inténtalo de nuevo.';

  @override
  String get controllerReplyBranchWorktreeCreated =>
      'Chat ramificado usando un worktree separado.';

  @override
  String agentTasksCompletedCount(int count) {
    return '$count completadas';
  }

  @override
  String agentTasksStoppedCount(int count) {
    return '$count detenidas';
  }

  @override
  String agentTasksFailedCount(int count) {
    return '$count fallidas';
  }

  @override
  String agentTasksPreparingCount(int count) {
    return '$count en preparación';
  }

  @override
  String agentTasksUnknownCount(int count) {
    return '$count pendientes de sincronización';
  }

  @override
  String get agentTasksSearch => 'Buscar tareas, nombres o modelos';

  @override
  String get agentTasksNoMatches => 'No hay subtareas coincidentes';

  @override
  String get agentTaskModelConfiguration => 'Configuración del modelo';
}
