// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Portuguese (`pt`).
class AppLocalizationsPt extends AppLocalizations {
  AppLocalizationsPt([String locale = 'pt']) : super(locale);

  @override
  String get workbenchStateAnswered => 'Respondido';

  @override
  String get workbenchTurnIncomplete => 'Esta execução não foi concluída';

  @override
  String get controllerQueueUnconfirmed =>
      'O estado da mensagem não foi confirmado. Atualize a conversa.';

  @override
  String get homeGreetingMorning => 'Bom dia';

  @override
  String get homeGreetingNoon => 'Boa tarde';

  @override
  String get homeGreetingAfternoon => 'Boa tarde';

  @override
  String get homeGreetingEvening => 'Boa noite';

  @override
  String get homeGreetingNight => 'Já é tarde';

  @override
  String get homeCareLongBreak =>
      'Já faz um tempo de concentração. Que tal uma pausa mais longa?';

  @override
  String get homeCarePause =>
      'Um gole de água, um olhar ao longe. Um momento para você.';

  @override
  String get homeCareNightWorking =>
      'Se ainda estiver trabalhando, reserve um descanso para esta noite.';

  @override
  String get homeCareNightQuiet => 'Tudo bem deixar um pouco para amanhã.';

  @override
  String get homeCareBusyDay =>
      'Você passou um bom tempo aqui hoje. Guarde um tempo para você.';

  @override
  String get homeCareDecision => 'Decida com calma, no seu ritmo.';

  @override
  String get homeCareLongWait =>
      'A espera está longa. Aproveite para cuidar de você.';

  @override
  String get homeCareWelcomeBack =>
      'Que bom ter você de volta. Siga no seu ritmo.';

  @override
  String get homeCareFirstIdea => 'Comece com uma ideia, quando quiser.';

  @override
  String get homeCareMeal =>
      'Ainda não comeu? Reserve um momento para uma refeição.';

  @override
  String get homeCareEasterEgg =>
      'Conquista secreta: cuidar de si, sem barra de progresso.';

  @override
  String get homeCareWeekend =>
      'Um fim de semana no seu ritmo, com espaço para respirar.';

  @override
  String get homeCareDailyProgress =>
      'Que hoje tenha um pouco de progresso e um pouco de calma.';

  @override
  String get homeCareDailySpace => 'Ideias precisam de espaço. Você também.';

  @override
  String get homeCareDailyPace =>
      'Uma coisa de cada vez, com um pouco de espaço para você.';

  @override
  String get workbenchReturnHome => 'Voltar ao início';

  @override
  String get workbenchVisualization => 'Visualização';

  @override
  String get workbenchVisualizationUnavailable =>
      'Esta visualização ainda não está disponível.';

  @override
  String get workbenchDesktopVersionUnknown => 'Versão desconhecida';

  @override
  String get appTitle => 'Relayune';

  @override
  String get commonBack => 'Voltar';

  @override
  String get commonCancel => 'Cancelar';

  @override
  String get commonClose => 'Fechar';

  @override
  String get commonContinue => 'Continuar';

  @override
  String get commonRetry => 'Tentar novamente';

  @override
  String get commonSave => 'Guardar';

  @override
  String get commonSubmit => 'Enviar';

  @override
  String get commonSettings => 'Definições';

  @override
  String get commonLogOut => 'Terminar sessão';

  @override
  String get commonReject => 'Rejeitar';

  @override
  String get commonAllow => 'Permitir';

  @override
  String get unavailableTitle => 'O Relayune está temporariamente indisponível';

  @override
  String get clearLoginSession => 'Limpar sessão';

  @override
  String get updateInstallerUnavailable =>
      'Não foi possível abrir o instalador do sistema. Tente mais tarde.';

  @override
  String get updateReadyTitle => 'Atualização pronta';

  @override
  String updateDownloaded(String version) {
    return 'O Relayune $version foi transferido e verificado em segurança em segundo plano.';
  }

  @override
  String get updateLater => 'Mais tarde';

  @override
  String get updateInstall => 'Instalar atualização';

  @override
  String get authSecurityBadge =>
      'Espaço de trabalho com encriptação ponta a ponta';

  @override
  String get authEmailTitle => 'Continue no telemóvel as tarefas do computador';

  @override
  String get authPasswordTitle => 'Inicie sessão ou crie uma conta';

  @override
  String get authVerificationTitle => 'Consulte o seu e-mail';

  @override
  String get authEmailSubtitle =>
      'Após iniciar sessão, use o código de 8 caracteres do computador para criar uma ligação encriptada.';

  @override
  String get authPasswordSubtitle =>
      'Inicie sessão com a palavra-passe ou verifique primeiro o e-mail.';

  @override
  String get authVerificationSubtitle =>
      'A ligação de verificação só pode ser usada uma vez e expira em breve.';

  @override
  String get authEmailLabel => 'E-mail';

  @override
  String get authInvalidEmail => 'Introduza um e-mail válido.';

  @override
  String get authContinue => 'Continuar';

  @override
  String get authChangeEmail => 'Alterar e-mail';

  @override
  String get authPasswordLabel => 'Palavra-passe';

  @override
  String get authShowPassword => 'Mostrar palavra-passe';

  @override
  String get authHidePassword => 'Ocultar palavra-passe';

  @override
  String get authPasswordRequired => 'Introduza a palavra-passe.';

  @override
  String get authSignIn => 'Iniciar sessão';

  @override
  String get authVerifyEmailAction =>
      'Primeira vez ou esqueceu a palavra-passe? Verificar e-mail';

  @override
  String get authVerificationInstructions =>
      'Abra o e-mail de verificação e defina uma palavra-passe na página segura. Depois volte aqui.';

  @override
  String get authPasswordSet => 'Já defini a palavra-passe';

  @override
  String get authResendEmail => 'Reenviar e-mail';

  @override
  String get authSecurityNote =>
      'O servidor apenas encaminha texto cifrado. O código e as chaves nunca são enviados.';

  @override
  String get pairingExit => 'Sair';

  @override
  String get pairingTitle => 'Digitalize para ligar o computador';

  @override
  String get pairingSubtitle => 'Leve o seu trabalho consigo.';

  @override
  String get pairingEnterCodeTitle => 'Ou introduza o código de 8 caracteres';

  @override
  String get pairingEnterCodeHelp =>
      'Introduza o código mostrado no computador.';

  @override
  String get pairingSearching => 'A procurar computadores à espera de ligação…';

  @override
  String get pairingComputerLabel => 'Computador a ligar';

  @override
  String pairingWillConnect(String device) {
    return 'A ligar a: $device';
  }

  @override
  String get pairingStartOnDesktop =>
      'Primeiro escolha «Ligar novo cliente» no computador e introduza o novo código.';

  @override
  String get pairingSearchAgain => 'Procurar novamente';

  @override
  String get pairingCodeLabel => 'Código de ligação de 8 caracteres';

  @override
  String get pairingSecureConnect => 'Ligar em segurança';

  @override
  String get pairingScanTitle => 'Onde está o código QR?';

  @override
  String get pairingScanHelp =>
      'Abra o Relayune no computador e selecione «Ligar novo cliente».\nDigitalize o QR nessa janela.';

  @override
  String get pairingOpenCamera => 'Digitalizar para ligar';

  @override
  String get pairingPrivacyNote =>
      'Encriptação ponta a ponta. Só os seus dispositivos podem ler as sessões.';

  @override
  String pairingMinimumDesktop(String version) {
    return 'Versão mínima compatível: $version';
  }

  @override
  String get pairingDeriving => 'A verificar ligação…';

  @override
  String get pairingWaitingDesktop => 'A aguardar confirmação do computador…';

  @override
  String get pairingActivating => 'A criar canal encriptado…';

  @override
  String get pairingDerivingDetail =>
      'A criar localmente a partilha SPAKE2 e uma chave de conteúdo independente.';

  @override
  String get pairingWaitingDesktopDetail =>
      'Mantenha o Relayune aberto no computador.';

  @override
  String get pairingActivatingDetail =>
      'A verificar o primeiro catálogo de sessões encriptado.';

  @override
  String get scannerTitle => 'Digitalize o QR de ligação no computador';

  @override
  String get scannerResume => 'Retomar digitalização';

  @override
  String get scannerInvalid =>
      'Este não é um QR de ligação Relayune. Digitalize o código atual do computador.';

  @override
  String get scannerHelp =>
      'Coloque dentro da moldura o QR mostrado pelo Relayune no computador.';

  @override
  String get scannerUnavailable =>
      'A câmara não está disponível. Permita o acesso nas definições do sistema ou ligue manualmente.';

  @override
  String get settingsTitle => 'Definições';

  @override
  String get settingsSignedInAccount => 'Conta ativa';

  @override
  String get settingsAccountSection => 'Conta';

  @override
  String get settingsPreferencesSection => 'Preferências';

  @override
  String get settingsHelpLegalSection => 'Apoio e informações legais';

  @override
  String get settingsLanguage => 'Idioma';

  @override
  String get settingsLanguageSystemDefault =>
      'Predefinição (idioma do sistema)';

  @override
  String settingsLanguageSystemDefaultValue(String language) {
    return 'Predefinição · $language';
  }

  @override
  String get settingsLanguageSaveFailed =>
      'O idioma mudou, mas não foi possível guardar a preferência.';

  @override
  String get settingsReleaseNotes => 'Notas da versão';

  @override
  String get settingsSupport => 'Apoio';

  @override
  String get settingsTerms => 'Termos de Serviço';

  @override
  String get settingsPrivacy => 'Política de Privacidade';

  @override
  String get settingsLegalLanguage => 'Português';

  @override
  String get settingsOpenLinkFailed => 'Não foi possível abrir esta ligação.';

  @override
  String get releaseTitle => 'Notas da versão';

  @override
  String get releaseLoading => 'A carregar notas';

  @override
  String get releaseErrorTitle => 'Notas indisponíveis';

  @override
  String get releaseErrorMessage => 'Verifique a ligação e tente novamente.';

  @override
  String get releaseEmptyTitle => 'Ainda não há notas';

  @override
  String get releaseEmptyMessage => 'As próximas atualizações aparecerão aqui.';

  @override
  String get releaseVersion => 'Versão';

  @override
  String get releaseWeb => 'Web';

  @override
  String get releaseServer => 'Servidor';

  @override
  String get notificationEnabledTitle => 'Notificações de tarefas ativas';

  @override
  String get notificationPrimerTitle =>
      'A tarefa corre no computador; não precisa de ficar a olhar';

  @override
  String get notificationEnabledBody =>
      'O Relayune avisa quando uma tarefa requer atenção ou termina.';

  @override
  String get notificationPrimerBody =>
      'Responda a perguntas e aprovações e veja o resumo quando terminar.';

  @override
  String get notificationBenefitAction =>
      'Requer atenção: permita, rejeite ou abra uma resposta pela notificação';

  @override
  String get notificationBenefitCompletion =>
      'Tarefa concluída: veja o resumo antes de abrir';

  @override
  String get notificationBenefitPrivacy =>
      'As notificações nunca mostram comandos, caminhos, códigos ou chaves';

  @override
  String get notificationPermissionRejected =>
      'As notificações do sistema continuam desativadas. Autorize-as nas definições.';

  @override
  String get notificationGotIt => 'Entendido';

  @override
  String get notificationOpenSettings => 'Abrir definições do sistema';

  @override
  String get notificationEnable => 'Ativar notificações';

  @override
  String get notificationNotNow => 'Agora não';

  @override
  String get notificationSemanticsExample =>
      'Exemplos: uma aprovação requer atenção, uma pergunta precisa de resposta e uma tarefa Claude terminou com um resumo';

  @override
  String get notificationNow => 'Agora';

  @override
  String get notificationSampleTask => 'Melhorar notificações móveis';

  @override
  String get notificationSampleBody =>
      'A orientação de permissões e o resumo de tarefa concluída estão prontos…';

  @override
  String get notificationApprovalTitle => 'Operação a aguardar confirmação';

  @override
  String get notificationQuestionTitle => 'É necessária a sua resposta';

  @override
  String notificationTaskPaused(String provider) {
    return '$provider · tarefa em pausa';
  }

  @override
  String notificationApprovalBody(int minutes) {
    return 'Permita ou rejeite esta operação em $minutes min.';
  }

  @override
  String notificationQuestionBody(int minutes) {
    return 'Responda em $minutes min. A tarefa continuará depois.';
  }

  @override
  String notificationTaskCompleted(String provider) {
    return 'Tarefa $provider concluída';
  }

  @override
  String get notificationMainTask => 'Tarefa principal';

  @override
  String get notificationMainResultReady =>
      'O resultado da tarefa principal está pronto. Toque para ver.';

  @override
  String notificationNamedResultReady(String name) {
    return 'O resultado de «$name» está pronto. Toque para ver.';
  }

  @override
  String get notificationAllowOnce => 'Permitir uma vez';

  @override
  String get notificationAnswer => 'Responder';

  @override
  String get notificationChannelAttention => 'Requer atenção';

  @override
  String get notificationChannelCompleted => 'Tarefa concluída';

  @override
  String get notificationChannelAttentionDescription =>
      'Alertas de aprovações e perguntas do Relayune';

  @override
  String get notificationChannelCompletedDescription =>
      'Alertas de conclusão da tarefa principal do Relayune';

  @override
  String get notificationRedactedLink => '[ligação]';

  @override
  String get notificationRedactedPath => '[caminho]';

  @override
  String get notificationRedactedSecret => '[oculto]';

  @override
  String get workbenchTitle => 'Espaço de trabalho';

  @override
  String get workbenchDevice => 'Dispositivo';

  @override
  String get workbenchOpenNavigation => 'Abrir navegação';

  @override
  String workbenchPendingApprovals(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count aprovações pendentes',
      one: '1 aprovação pendente',
    );
    return '$_temp0';
  }

  @override
  String get workbenchSessions => 'Sessões';

  @override
  String get workbenchOnline => 'Online';

  @override
  String get workbenchOffline => 'Offline';

  @override
  String get workbenchDeviceOnlineRealtime =>
      'Computador online · sincronização em tempo real';

  @override
  String get workbenchDeviceOfflineQueued =>
      'Computador offline · apenas registos em cache';

  @override
  String get workbenchDeviceOnlineReconnecting =>
      'Computador online · a restaurar ligação em tempo real';

  @override
  String get workbenchDeviceOfflineReconnecting =>
      'Computador offline · a restaurar ligação em tempo real';

  @override
  String get workbenchDeviceOnlineWaiting =>
      'Computador online · à espera da ligação em tempo real';

  @override
  String get workbenchDeviceOfflineWaiting =>
      'Computador offline · à espera da ligação em tempo real';

  @override
  String get workbenchProjectsSessions => 'Projetos e sessões';

  @override
  String get workbenchNoSessionsSynced =>
      'Ainda não foram sincronizadas sessões do computador';

  @override
  String get workbenchSignedInAccount => 'Conta com sessão iniciada';

  @override
  String get workbenchNotSignedIn => 'Sessão não iniciada';

  @override
  String get workbenchNewSession => 'Nova sessão';

  @override
  String get workbenchDefaultSessionName => 'Nova sessão remota';

  @override
  String get workbenchHistoryFailed =>
      'Não foi possível carregar o histórico; o conteúdo atual pode estar incompleto';

  @override
  String get workbenchLoadEarlier => 'Carregar mensagens anteriores';

  @override
  String get workbenchSendFirst => 'Envie a primeira instrução para começar';

  @override
  String get workbenchAtBeginning => 'Esta é a primeira mensagem';

  @override
  String get workbenchAddAttachment => 'Adicionar anexo';

  @override
  String workbenchRemoveAttachment(String name) {
    return 'Remover $name';
  }

  @override
  String get workbenchReadOnly => 'Esta sessão é só de leitura';

  @override
  String get workbenchOfflineQueued =>
      'Computador offline · envio indisponível';

  @override
  String get workbenchSteerPlaceholder =>
      'Envie uma instrução para parar e continuar…';

  @override
  String get workbenchSendPlaceholder => 'Enviar instruções para o computador…';

  @override
  String get workbenchStopTask => 'Parar tarefa';

  @override
  String get workbenchSending => 'A enviar';

  @override
  String get workbenchSend => 'Enviar';

  @override
  String get workbenchYou => 'Você';

  @override
  String get workbenchLocalActivity => 'Atividade local';

  @override
  String get workbenchToday => 'Hoje';

  @override
  String get workbenchYesterday => 'Ontem';

  @override
  String get workbenchDayBeforeYesterday => 'Anteontem';

  @override
  String get workbenchSystemNotice => 'Aviso do sistema';

  @override
  String workbenchApprovalSource(String name) {
    return 'Origem: $name';
  }

  @override
  String workbenchApprovalDirectory(String path) {
    return 'Diretório: $path';
  }

  @override
  String get workbenchApprovalPermission => 'Permissão solicitada';

  @override
  String get workbenchSelect => 'Selecionar';

  @override
  String get workbenchOtherAnswer => 'Outra resposta…';

  @override
  String get workbenchSkipAnswer => 'Agora não';

  @override
  String get workbenchHighRiskTitle => 'Permitir uma operação de alto risco?';

  @override
  String get workbenchOperationOnComputer =>
      'Esta operação será executada no seu computador.';

  @override
  String get workbenchConfirmAllow => 'Confirmar e permitir';

  @override
  String get workbenchAnswerLabel => 'Resposta';

  @override
  String get workbenchAllowOnce => 'Permitir uma vez';

  @override
  String get workbenchAlwaysAllowSession => 'Permitir sempre nesta sessão';

  @override
  String get workbenchAllowAndRemember => 'Permitir e memorizar';

  @override
  String get workbenchAlwaysRejectSession => 'Rejeitar sempre nesta sessão';

  @override
  String get workbenchRejectAndRemember => 'Rejeitar e memorizar';

  @override
  String get workbenchSaveDecisionTitle => 'Memorizar esta decisão?';

  @override
  String get workbenchSaveDecisionMessage =>
      'O Relayune aplicará automaticamente esta escolha apenas a operações semelhantes da sessão atual.';

  @override
  String get workbenchConfirm => 'Confirmar';

  @override
  String get workbenchRejectAndStop => 'Rejeitar e parar a tarefa';

  @override
  String get workbenchNotificationSettings => 'Notificações de tarefas';

  @override
  String get workbenchConnectAnother => 'Ligar outro computador';

  @override
  String get workbenchConnectAnotherSubtitle =>
      'Eliminar deste telemóvel a chave de conteúdo e a autorização atuais';

  @override
  String get workbenchConnectAnotherTitle => 'Ligar outro computador?';

  @override
  String get workbenchConnectAnotherMessage =>
      'A chave de conteúdo e o token de autorização do telemóvel serão eliminados do armazenamento seguro deste dispositivo. Os dados do servidor e do computador não serão eliminados.';

  @override
  String get workbenchNoSessions => 'Não há sessões disponíveis';

  @override
  String get workbenchNoSessionsHelp =>
      'Mantenha o desktop online ou crie uma sessão num diretório de projeto do computador.';

  @override
  String get workbenchHistoryLoading => 'A carregar histórico';

  @override
  String get workbenchHistoryLoadingOlder => 'A carregar mensagens anteriores…';

  @override
  String get workbenchHistoryLimit =>
      'O histórico é carregado ao abrir uma sessão, até 500 mensagens de cada vez';

  @override
  String get workbenchFilePreviewRetry =>
      'Falha na pré-visualização do ficheiro. Tente novamente.';

  @override
  String get workbenchSecureFileReading => 'A ler em segurança do computador…';

  @override
  String get workbenchFileUnavailable =>
      'O ficheiro expirou ou foi removido do computador.';

  @override
  String get workbenchApprovalCommand => 'Executar comando';

  @override
  String get workbenchApprovalFileChange => 'Alterar ficheiro';

  @override
  String get workbenchApprovalChoice => 'É necessária a sua escolha';

  @override
  String get workbenchApprovalTool => 'Executar ferramenta local';

  @override
  String get workbenchStatePending => 'Pendente';

  @override
  String get workbenchStateDeciding => 'A enviar';

  @override
  String get workbenchStateApproved => 'Aprovada';

  @override
  String get workbenchStateRejected => 'Rejeitada';

  @override
  String get workbenchStateExpired => 'Expirada';

  @override
  String get workbenchLocalRelay => 'Relay local';

  @override
  String get workbenchEncryptionProtocol => 'Protocolo de encriptação';

  @override
  String get workbenchPairingProtocol => 'Protocolo de emparelhamento';

  @override
  String get workbenchRealtimeChannel => 'Canal em tempo real';

  @override
  String get workbenchTechnicalDetails => 'Detalhes técnicos';

  @override
  String get workbenchRealtimeConnection => 'Ligação em tempo real';

  @override
  String get workbenchHeartbeatPath => 'iPhone ↔ Server · WebSocket';

  @override
  String get workbenchHeartbeatHealthy => 'Heartbeat estável';

  @override
  String get workbenchHeartbeatWaiting => 'À espera do primeiro heartbeat';

  @override
  String get workbenchLastHeartbeat => 'Último heartbeat';

  @override
  String get workbenchRoundTrip => 'Ida e volta';

  @override
  String get workbenchWebSocketHeartbeat => 'Heartbeat WebSocket';

  @override
  String get workbenchDesktopHeartbeat => 'Heartbeat do computador';

  @override
  String get workbenchJustNow => 'Agora';

  @override
  String workbenchSecondsAgo(int seconds) {
    return 'Há $seconds s';
  }

  @override
  String workbenchMinutesAgo(int minutes) {
    return 'Há $minutes min';
  }

  @override
  String get workbenchStateVersion => 'Versão do estado';

  @override
  String get workbenchAwaitingConfirmation => 'A aguardar confirmação';

  @override
  String get workbenchLastConfirmed => 'Última confirmação';

  @override
  String get workbenchEventAck => 'Confirmação de eventos';

  @override
  String get workbenchOfflineQueue => 'Fila offline';

  @override
  String get workbenchSecurityBoundary => 'Limite da encriptação ponto a ponto';

  @override
  String get workbenchPhonePlaintextEndpoint =>
      'O telemóvel é um ponto terminal com texto simples para a aplicação';

  @override
  String get workbenchServerCiphertextOnly =>
      'O servidor guarda apenas envelopes de texto cifrado autenticado';

  @override
  String get workbenchKeyInSecureStorage =>
      'As chaves de conteúdo ficam no armazenamento seguro do sistema';

  @override
  String get workbenchCodeNeverUploaded =>
      'O código de ligação de 8 caracteres nunca é enviado';

  @override
  String get workbenchNotConfirmed => 'Ainda não confirmado';

  @override
  String get workbenchRealtimeConnected => 'WebSocket ligado';

  @override
  String get workbenchRealtimeConnecting => 'A ligar';

  @override
  String get workbenchRealtimeReconnecting => 'A restabelecer ligação';

  @override
  String get workbenchRealtimeIdle => 'À espera de ligação';

  @override
  String workbenchNotificationStatus(String status) {
    return '$status · as notificações funcionam enquanto a ligação em segundo plano estiver ativa; a entrega não é garantida depois de o sistema terminar a app';
  }

  @override
  String get workbenchNotificationAllowed => 'Permitidas';

  @override
  String get workbenchNotificationDisabled => 'Desativadas';

  @override
  String get workbenchNotificationUnknown => 'Desconhecido';

  @override
  String get workbenchClose => 'Fechar';

  @override
  String get workbenchProjectConfiguration => 'Definições do projeto';

  @override
  String get workbenchProjectConfigurationTitle => 'Definições do projeto';

  @override
  String get workbenchProjectName => 'Nome do projeto';

  @override
  String get workbenchProjectNameHelp =>
      'Só altera o nome mostrado na app; não muda o nome da pasta no computador.';

  @override
  String get workbenchFullPath => 'Caminho completo';

  @override
  String get workbenchProjectPathUnavailable =>
      'O computador não forneceu o caminho do projeto';

  @override
  String workbenchSessionCount(int count) {
    return '$count sessões';
  }

  @override
  String workbenchMoreSessions(int count) {
    return 'Mostrar mais sessões ($count)';
  }

  @override
  String get workbenchAgentRunning => 'Agent em execução';

  @override
  String get workbenchAgentNotRunning => 'Agent parado';

  @override
  String get workbenchRunning => 'Em execução';

  @override
  String get workbenchKimiSettings => 'Definições do Kimi';

  @override
  String get workbenchEnableYoloTitle => 'Ativar o modo YOLO?';

  @override
  String get workbenchEnableAutoTitle => 'Ativar o modo Auto?';

  @override
  String get workbenchYoloWarning =>
      'O Kimi aprovará automaticamente mais chamadas de ferramentas locais. Ative apenas se confiar na tarefa e no projeto.';

  @override
  String get workbenchAutoWarning =>
      'O Kimi aprovará chamadas habituais, mas ainda poderá fazer perguntas.';

  @override
  String get workbenchConfirmEnable => 'Confirmar e ativar';

  @override
  String get workbenchUploadTooManyImages =>
      'Pode adicionar até 4 imagens por mensagem.';

  @override
  String workbenchUploadUnsupportedImages(String names) {
    return '$names não são suportados. Escolha PNG, JPEG, WebP, GIF ou AVIF.';
  }

  @override
  String get workbenchUploadTooLarge =>
      'Os anexos de uma mensagem não podem exceder 20 MiB no total.';

  @override
  String workbenchPreviewGenerateFailed(String name) {
    return 'Não foi possível ler ou gerar a pré-visualização de $name. Tente novamente.';
  }

  @override
  String get workbenchKimiViewAgents => 'Ver subagentes';

  @override
  String get workbenchKimiViewAgentsDescription =>
      'Abra a janela de trabalho Agent acima do campo de texto sem iniciar outra tarefa do modelo.';

  @override
  String get workbenchKimiOpenNow => 'Abrir agora';

  @override
  String get workbenchKimiSessionStatus => 'Estado da sessão';

  @override
  String get workbenchKimiSessionStatusDescription =>
      'Veja a tarefa, aprovações, contexto e sincronização local.';

  @override
  String get workbenchKimiLocalStatus => 'Estado local';

  @override
  String get workbenchKimiModel => 'Modelo';

  @override
  String get workbenchKimiModelDescription =>
      'Altere o modelo usado nesta sessão Kimi.';

  @override
  String get workbenchKimiSessionSettings => 'Definições da sessão';

  @override
  String get workbenchKimiPermissionMode => 'Modo de permissões';

  @override
  String get workbenchKimiPermissionModeDescription =>
      'Veja ou altere a política de aprovação das ferramentas locais.';

  @override
  String get workbenchKimiSecuritySettings => 'Definições de segurança';

  @override
  String get workbenchKimiPlanMode => 'Modo Plan';

  @override
  String get workbenchKimiPlanModeDescription =>
      'Peça ao Kimi para planear antes de executar a tarefa.';

  @override
  String get workbenchKimiYoloMode => 'Modo YOLO';

  @override
  String get workbenchKimiYoloModeDescription =>
      'Aprova automaticamente mais chamadas de ferramentas; é necessária confirmação antes de ativar.';

  @override
  String get workbenchKimiConfirmationRequired => 'Confirmação necessária';

  @override
  String get workbenchKimiSettingsDescription =>
      'Abra as definições de modelo, Thinking e permissões.';

  @override
  String workbenchKimiInputRequired(String hint) {
    return 'Entrada necessária: $hint';
  }

  @override
  String get workbenchKimiNativeCommandDescription =>
      'Comando nativo do Kimi ACP executado como uma tarefa de comando real.';

  @override
  String get workbenchKimiNativeCommand => 'Comando nativo';

  @override
  String get workbenchKimiContextSyncing => 'Contexto a aguardar sincronização';

  @override
  String get workbenchKimiWaitingForSync => 'A aguardar sincronização';

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
  String get workbenchKimiModelSyncing => 'Modelo a aguardar sincronização';

  @override
  String get workbenchKimiQuickCommands => 'Comandos rápidos';

  @override
  String get workbenchKimiNoMatchingCommands => 'Nenhum comando correspondente';

  @override
  String get workbenchKimiTask => 'Tarefa';

  @override
  String get workbenchKimiIdle => 'Inativo';

  @override
  String get workbenchKimiSubagents => 'Subagentes';

  @override
  String workbenchKimiActiveCount(int count) {
    return '$count ativos';
  }

  @override
  String get workbenchKimiApprovals => 'Aprovações';

  @override
  String workbenchKimiPendingCount(int count) {
    return '$count pendentes';
  }

  @override
  String get workbenchKimiSettingsOffline =>
      'Não é possível alterar as definições do Kimi enquanto o Relay está offline.';

  @override
  String get workbenchKimiSettingsRunning =>
      'Pare a tarefa principal do Kimi antes de alterar as definições.';

  @override
  String get workbenchKimiNoOptions =>
      'O computador ainda não sincronizou opções configuráveis.';

  @override
  String get workbenchKimiEncryptedSettings =>
      'As definições são enviadas com encriptação ponto a ponto para o Kimi Code no computador. O servidor não pode lê-las.';

  @override
  String get workbenchKimiManualApproval => 'Aprovação manual';

  @override
  String get workbenchSessionSettings => 'Definições da sessão';

  @override
  String get workbenchSessionSettingsOffline =>
      'Não é possível alterar as definições da sessão enquanto o Relay está offline.';

  @override
  String get workbenchSessionSettingsRunning =>
      'Pare a tarefa atual antes de alterar as definições.';

  @override
  String get workbenchNoConfigOptions =>
      'O computador ainda não sincronizou opções configuráveis.';

  @override
  String workbenchEncryptedSessionSettings(String provider) {
    return 'As definições são enviadas com encriptação ponto a ponto para o $provider no computador. O servidor não pode lê-las.';
  }

  @override
  String get workbenchUnrestrictedPermissionsTitle =>
      'Alterar o modo de permissões?';

  @override
  String get workbenchUnrestrictedPermissionsWarning =>
      'Isto altera se as ferramentas locais são permitidas, recusadas ou exigem aprovação. Reveja o modo selecionado antes de continuar.';

  @override
  String get workbenchCoworkCreateOnDesktop =>
      'Crie primeiro as tarefas Cowork no Claude Desktop; as tarefas existentes podem ser controladas aqui.';

  @override
  String get workbenchProcessing => 'A processar';

  @override
  String get workbenchProcess => 'Processo';

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
      'O endereço da imagem está indisponível.';

  @override
  String workbenchFilePreviewAvailable(String kind) {
    return 'Pré-visualizável · $kind · até 1 MB';
  }

  @override
  String get workbenchFilePreviewUnsupported =>
      'Este formato de ficheiro não pode ser pré-visualizado';

  @override
  String workbenchImageReadFailed(String name) {
    return '$name\nNão foi possível ler a imagem';
  }

  @override
  String workbenchImageThumbnailLabel(String name) {
    return 'Miniatura de $name; toque para abrir a pré-visualização';
  }

  @override
  String get workbenchViewOriginal => 'Ver original';

  @override
  String get workbenchLoadingOriginal => 'A carregar o original em segurança…';

  @override
  String get workbenchOriginalReadFailed =>
      'Não foi possível ler a imagem original. Tente novamente.';

  @override
  String workbenchActivityFailed(String label) {
    return 'Falha em $label';
  }

  @override
  String workbenchActivityCompleted(String label) {
    return '$label concluído';
  }

  @override
  String workbenchActivityRunning(String label) {
    return 'Em curso: $label';
  }

  @override
  String get workbenchViewOutput => 'Toque para ver a saída';

  @override
  String get workbenchViewThumbnail => 'Toque para ver a miniatura';

  @override
  String get workbenchSemanticSeparator => ', ';

  @override
  String workbenchCommandsRunning(int count) {
    return 'A executar $count comandos';
  }

  @override
  String workbenchCommandsFailed(int count) {
    return 'Alguns dos $count comandos falharam';
  }

  @override
  String workbenchCommandsCompleted(int count) {
    return '$count comandos executados';
  }

  @override
  String workbenchFilesReading(int count) {
    return 'A ler $count ficheiros';
  }

  @override
  String workbenchFilesReadFailed(int count) {
    return 'Não foi possível ler alguns dos $count ficheiros';
  }

  @override
  String workbenchFilesRead(int count) {
    return '$count ficheiros lidos';
  }

  @override
  String workbenchFilesChanging(int count) {
    return 'A alterar $count ficheiros';
  }

  @override
  String workbenchFilesChangeFailed(int count) {
    return 'Algumas alterações aos $count ficheiros falharam';
  }

  @override
  String workbenchFilesChanged(int count) {
    return '$count ficheiros alterados';
  }

  @override
  String workbenchOperationsRunning(int count) {
    return 'A processar $count operações de ficheiros e comandos';
  }

  @override
  String workbenchOperationsFailed(int count) {
    return 'Algumas das $count operações de ficheiros e comandos falharam';
  }

  @override
  String workbenchOperationsCompleted(int count) {
    return '$count operações de ficheiros e comandos concluídas';
  }

  @override
  String get workbenchToolCommand => 'Executar comando';

  @override
  String workbenchToolReadFilesSubject(int count, String subject) {
    return 'Ler $count ficheiros: $subject';
  }

  @override
  String workbenchToolReadFiles(int count) {
    return 'Ler $count ficheiros';
  }

  @override
  String workbenchToolReadFileSubject(String subject) {
    return 'Ler ficheiro: $subject';
  }

  @override
  String get workbenchToolReadFile => 'Ler ficheiro';

  @override
  String workbenchToolChangeFilesSubject(int count, String subject) {
    return 'Alterar $count ficheiros: $subject';
  }

  @override
  String workbenchToolChangeFiles(int count) {
    return 'Alterar $count ficheiros';
  }

  @override
  String workbenchToolChangeFileSubject(String subject) {
    return 'Alterar ficheiro: $subject';
  }

  @override
  String get workbenchToolChangeFile => 'Alterar ficheiro';

  @override
  String workbenchToolCallNamed(String name) {
    return 'Chamar ferramenta: $name';
  }

  @override
  String get workbenchToolCall => 'Chamar ferramenta';

  @override
  String workbenchToolWebSearchSubject(String subject) {
    return 'Pesquisar na Web: $subject';
  }

  @override
  String get workbenchToolWebSearch => 'Pesquisar na Web';

  @override
  String workbenchToolImageViewSubject(String subject) {
    return 'Ver imagem: $subject';
  }

  @override
  String get workbenchToolImageView => 'Ver imagem';

  @override
  String get workbenchToolImageGeneration => 'Gerar imagem';

  @override
  String get workbenchToolContextCompaction =>
      'Compactar o contexto automaticamente';

  @override
  String get workbenchToolWait => 'Aguardar tarefa';

  @override
  String get workbenchLocalOperation => 'Operação local';

  @override
  String get workbenchDeliverySent => 'Enviado';

  @override
  String get workbenchDeliverySending => 'A enviar';

  @override
  String get workbenchDeliveryFailed => 'Falha no envio';

  @override
  String workbenchAssistantRunningElapsed(String agent, String duration) {
    return '$agent está em execução; duração $duration';
  }

  @override
  String workbenchAssistantRunning(String agent) {
    return '$agent está em execução';
  }

  @override
  String workbenchAssistantElapsed(String duration) {
    return '· duração $duration';
  }

  @override
  String get workbenchCloseFilePreview => 'Fechar pré-visualização';

  @override
  String workbenchFileReadCompleted(String name) {
    return 'Leitura concluída: $name';
  }

  @override
  String workbenchFileReading(String name) {
    return 'A ler ficheiro: $name';
  }

  @override
  String workbenchFileReadFailed(String message) {
    return 'Falha ao ler ficheiro: $message';
  }

  @override
  String get workbenchFilePreviewFailed =>
      'Falha na pré-visualização. Tente novamente.';

  @override
  String get workbenchFileKindTableText => 'Texto tabular';

  @override
  String get workbenchFileKindLog => 'Registo';

  @override
  String get workbenchFileKindPlainText => 'Texto simples';

  @override
  String get workbenchFileKindCodeOrConfig => 'Código ou configuração';

  @override
  String workbenchAgentsWorking(int count) {
    return '$count subagentes a trabalhar em paralelo';
  }

  @override
  String get workbenchAgentWindow => 'Janela de trabalho Agent';

  @override
  String get workbenchAgentWindowDescription =>
      'Sincroniza o estado da tarefa e a atividade das ferramentas sem mostrar raciocínio privado';

  @override
  String workbenchMoreAgents(int count) {
    return 'Mais $count Agents · desloque para ver';
  }

  @override
  String workbenchCurrentActivity(String activity) {
    return 'Atual · $activity';
  }

  @override
  String get workbenchAllAgents => 'Todos os Agents';

  @override
  String get workbenchActivityTimeline => 'Cronologia de atividade';

  @override
  String workbenchActivityCount(int count) {
    return '$count entradas';
  }

  @override
  String get workbenchAgentSyncing => 'A sincronizar deste computador…';

  @override
  String get workbenchNoPublicActivity =>
      'Ainda não há atividade pública. Apenas o estado da tarefa e a atividade das ferramentas são sincronizados, não o raciocínio privado.';

  @override
  String get workbenchLatestResult => 'Resultado mais recente';

  @override
  String get workbenchWaitingForTask => 'A aguardar uma tarefa';

  @override
  String get controllerRestoreFailed =>
      'Não foi possível restaurar a ligação segura. Inicie sessão ou volte a emparelhar.';

  @override
  String get controllerAuthorizationRevoked =>
      'A autorização deste telefone foi revogada. Volte a ligá-lo.';

  @override
  String get controllerDeviceNotConnected =>
      'Esta conta não está ligada a este computador. Reinicie a ligação no computador.';

  @override
  String get controllerProjectNameRequired =>
      'O nome do projeto é obrigatório.';

  @override
  String controllerProjectNameTooLong(int maximum) {
    return 'O nome do projeto não pode exceder $maximum caracteres.';
  }

  @override
  String get controllerProjectNameSaveFailed =>
      'Não foi possível guardar o nome localmente. Tente novamente.';

  @override
  String get controllerProjectNameUpdated => 'Nome do projeto atualizado.';

  @override
  String get controllerNewPairingLinkReceived =>
      'Foi recebido um novo link. Termine a sessão do dispositivo atual para voltar a ligar.';

  @override
  String get controllerPairingLinkRequired =>
      'Introduza o link de ligação Relayune mostrado na app de computador.';

  @override
  String get controllerPairingDiscoveryFailed =>
      'Não foi possível encontrar computadores à espera. Tente mais tarde.';

  @override
  String get controllerVerificationResent => 'E-mail de verificação reenviado.';

  @override
  String get controllerSetPasswordFirst =>
      'Defina primeiro uma palavra-passe no link do e-mail e volte aqui.';

  @override
  String get controllerNoPendingComputer =>
      'Nenhum computador está à espera. Selecione primeiro «Ligar novo cliente» no computador.';

  @override
  String get controllerSelectComputer => 'Selecione o computador a ligar.';

  @override
  String get controllerPairingFailed =>
      'A ligação segura falhou. Verifique o código e tente novamente.';

  @override
  String get controllerHistoryReadFailed => 'Não foi possível ler o histórico.';

  @override
  String get controllerAgentRefreshFailed =>
      'Não foi possível atualizar agora a atividade deste subagente.';

  @override
  String get controllerAttachmentTooLarge =>
      'Ficheiros com mais de 1 MB ainda não podem ser pré-visualizados.';

  @override
  String get controllerAttachmentUnsupported =>
      'Este formato ainda não pode ser pré-visualizado.';

  @override
  String get controllerAttachmentGone =>
      'O ficheiro expirou ou foi removido do computador.';

  @override
  String get controllerAttachmentReadFailed => 'Não foi possível ler o anexo.';

  @override
  String controllerUploadTooMany(int maximum) {
    return 'Pode carregar até $maximum imagens por mensagem.';
  }

  @override
  String get controllerUploadTotalTooLarge =>
      'Os anexos de uma mensagem não podem exceder 20 MiB no total.';

  @override
  String get controllerUploadUnsupported =>
      'Escolha imagens PNG, JPEG, WebP, GIF ou AVIF.';

  @override
  String get controllerSteeringUnsupported =>
      'Esta tarefa não aceita mais instruções. Pare-a primeiro.';

  @override
  String get controllerPreparingAgent =>
      'Recebido no computador · Preparando o agente';

  @override
  String get controllerWaitingForAgent => 'A aguardar receção pelo Agent local';

  @override
  String get controllerWaitingForComputer =>
      'A aguardar que o computador fique online';

  @override
  String get controllerStopSent => 'Pedido de paragem enviado.';

  @override
  String get controllerApprovalExpired => 'Esta aprovação expirou.';

  @override
  String get controllerApprovalOffline =>
      'Não é possível tratar aprovações com o computador offline.';

  @override
  String get controllerApprovalAllowedSent =>
      'Permissão enviada; a aguardar confirmação do computador.';

  @override
  String get controllerApprovalRejectedSent =>
      'Recusa enviada; a aguardar confirmação do computador.';

  @override
  String controllerDelegatedTasks(int count) {
    return 'Foram delegadas $count tarefas em paralelo.';
  }

  @override
  String get controllerSelectProject =>
      'Selecione primeiro um projeto sincronizado na barra lateral.';

  @override
  String get controllerCreateSessionOffline =>
      'O computador está offline. Não é possível criar uma sessão agora.';

  @override
  String controllerSessionNameLength(int maximum) {
    return 'O nome da sessão deve ter entre 1 e $maximum caracteres.';
  }

  @override
  String get controllerSessionCreationBusy =>
      'A sessão anterior ainda está a ser criada. Aguarde.';

  @override
  String controllerSessionCreating(String name) {
    return 'A criar «$name»…';
  }

  @override
  String get controllerSessionCreateFailed =>
      'Não foi possível criar a sessão. Tente mais tarde.';

  @override
  String get controllerDesktopSessionCreateFailed =>
      'A app de computador não conseguiu criar a sessão.';

  @override
  String get controllerSessionCreateTimeout =>
      'O tempo de espera para criar a sessão terminou. Verifique mais tarde; não crie outra.';

  @override
  String controllerSessionCreated(String name) {
    return '«$name» criada.';
  }

  @override
  String get controllerCoworkCreateOnDesktop =>
      'Crie primeiro esta tarefa Cowork no Claude Desktop e depois controle-a aqui.';

  @override
  String get controllerDesktopConfigFailed =>
      'A app de computador não conseguiu aplicar as definições da sessão.';

  @override
  String get controllerConfigApplied => 'Definições da sessão aplicadas.';

  @override
  String get controllerConfigUpdateFailed =>
      'Não foi possível atualizar as definições. Tente mais tarde.';

  @override
  String get controllerConfigTimeout =>
      'O tempo de espera para aplicar as definições terminou. Atualize para confirmar.';

  @override
  String get controllerInvalidEncryptedEvent =>
      'Não foi possível verificar um evento encriptado. O avanço do cursor de sincronização foi interrompido.';

  @override
  String get controllerApprovalNeeded => 'A aguardar a sua aprovação';

  @override
  String get controllerContinuing => 'A continuar';

  @override
  String get controllerApprovalProcessFailed =>
      'O computador não conseguiu tratar esta aprovação. Tente novamente.';

  @override
  String controllerAgentProcessing(String name) {
    return '$name está a processar';
  }

  @override
  String get controllerSummarizing => 'A resumir resultados';

  @override
  String get controllerThinking => 'A pensar';

  @override
  String get controllerLocalTaskFailed => 'A tarefa local falhou.';

  @override
  String get controllerInterruptFailed =>
      'Não foi possível parar a tarefa atual.';

  @override
  String get controllerReplying => 'A responder';

  @override
  String get controllerFinishing => 'A finalizar';

  @override
  String get controllerOrganizingFileChanges =>
      'A organizar alterações de ficheiros';

  @override
  String controllerFilesModified(int count) {
    return '$count ficheiros modificados.';
  }

  @override
  String get controllerUpdatingPlan => 'A atualizar o plano';

  @override
  String get controllerMessageQueued =>
      'Mensagem em fila. Será enviada automaticamente mais tarde.';

  @override
  String controllerSessionPersisted(String agent) {
    return 'Sessão guardada no $agent.';
  }

  @override
  String controllerLocalTool(String label) {
    return 'Ferramenta local: $label';
  }

  @override
  String get controllerProcessingLocalResult => 'A processar resultado local';

  @override
  String get controllerEncryptedResponseTimeout =>
      'Terminou o tempo de espera pela resposta encriptada do computador.';

  @override
  String get controllerPairingUsedOrExpired =>
      'Esta ligação já foi usada ou expirou.';

  @override
  String get controllerPairingConfirmationTimeout =>
      'Terminou o tempo de espera pela confirmação da app de computador. Reinicie a ligação.';

  @override
  String get controllerPairingConfirmationFailed =>
      'O computador não confirmou a ligação encriptada. Volte a ligar.';

  @override
  String get controllerDesktopOffline =>
      'A app de computador ainda não está online. Mantenha o Relayune aberto e tente novamente.';

  @override
  String get workbenchDefault => 'Predefinido';

  @override
  String workbenchAgentToolCount(int count) {
    return '$count ferramentas';
  }

  @override
  String workbenchAgentTokenCount(String count) {
    return '$count tokens';
  }

  @override
  String get apiErrorNetworkUnavailable =>
      'Não foi possível ligar ao Relayune. Verifique a rede e tente novamente.';

  @override
  String get apiErrorTimeout =>
      'O pedido excedeu o tempo limite. Tente novamente.';

  @override
  String get apiErrorInvalidResponse =>
      'O Relayune recebeu uma resposta inválida do servidor. Tente novamente.';

  @override
  String get apiErrorInvalidCredentials =>
      'O e-mail ou a palavra-passe estão incorretos.';

  @override
  String get apiErrorAuthentication =>
      'A sua sessão expirou. Inicie sessão novamente.';

  @override
  String get apiErrorService =>
      'O Relayune está temporariamente indisponível. Tente mais tarde.';

  @override
  String get apiErrorGeneric => 'Ocorreu um erro. Tente novamente.';

  @override
  String get controllerFileAccessDenied =>
      'O Relayune não consegue ler alguns ficheiros de sessão no computador. No Mac, permita o acesso em Definições do Sistema → Privacidade e Segurança → Ficheiros e Pastas e tente novamente. Noutros computadores, verifique as permissões dos ficheiros.';

  @override
  String get workbenchImageWaiting => 'Aguardando';

  @override
  String get workbenchImageLoading => 'Carregando';

  @override
  String get feedbackTitle => 'Feedback';

  @override
  String get feedbackIntro => 'O que podemos melhorar?';

  @override
  String get feedbackSubtitle => 'Compartilhe uma ideia ou relate um problema.';

  @override
  String get feedbackSuggestion => 'Sugestão';

  @override
  String get feedbackBug => 'Relatar erro';

  @override
  String get feedbackDescription => 'Descrição';

  @override
  String get feedbackSuggestionHint =>
      'O que você melhoraria e como isso ajudaria?';

  @override
  String get feedbackBugHint =>
      'O que você fez, o que esperava e o que aconteceu?';

  @override
  String get feedbackInfo => 'Informações anexadas';

  @override
  String get feedbackPrivacy =>
      'Os dados do dispositivo são incluídos. Conversas e registros não são enviados automaticamente.';

  @override
  String get feedbackVersion => 'Versão do app';

  @override
  String get feedbackModel => 'Modelo do dispositivo';

  @override
  String get feedbackSystem => 'Sistema operacional';

  @override
  String get feedbackUnknown => 'Indisponível';

  @override
  String get feedbackLoading => 'Lendo informações do dispositivo…';

  @override
  String get feedbackSend => 'Enviar feedback';

  @override
  String get feedbackFailed =>
      'Não foi possível enviar. O conteúdo foi mantido. Verifique a conexão e tente novamente.';

  @override
  String get feedbackEmpty => 'Descreva seu feedback primeiro.';

  @override
  String get feedbackSending => 'Enviando…';

  @override
  String get feedbackSubmitNote =>
      'Sua descrição e estas informações serão salvas para investigação e melhorias.';

  @override
  String get feedbackSuccess => 'Feedback recebido. Obrigado pela ajuda.';

  @override
  String get feedbackReference => 'Número de referência';

  @override
  String get feedbackDone => 'Concluído';

  @override
  String get workbenchStoppingTask => 'Parando…';

  @override
  String get workbenchStopUnconfirmed =>
      'A parada ainda não foi confirmada. Tente novamente.';

  @override
  String get workbenchPreparingImages => 'Preparando imagens…';

  @override
  String get workbenchImagePickFailed =>
      'Não foi possível abrir as fotos. Tente novamente.';

  @override
  String get feedbackImages => 'Imagens';

  @override
  String get feedbackOptional => 'Opcional';

  @override
  String get feedbackImageLimit => 'Você pode adicionar até 3 imagens.';

  @override
  String get feedbackImageFailed =>
      'Não foi possível adicionar a imagem. Tente outra.';

  @override
  String get feedbackImagePreview => 'Prévia da imagem';

  @override
  String get feedbackRemoveImage => 'Remover imagem';

  @override
  String get feedbackPreparingImages => 'Preparando imagens…';

  @override
  String get feedbackAddImage => 'Adicionar imagens';

  @override
  String get feedbackImagesHint =>
      'Adicione capturas para nos ajudar a entender.';

  @override
  String get feedbackContact => 'Contato';

  @override
  String get feedbackEmail => 'E-mail';

  @override
  String get feedbackEmailHint => 'E-mail da conta; edite ou deixe em branco';

  @override
  String get feedbackWechat => 'ID do WeChat';

  @override
  String get feedbackWechatHint => 'Digite seu ID do WeChat';

  @override
  String get feedbackContactHint =>
      'Usado apenas para responder a este feedback. Ambos são opcionais.';

  @override
  String get feedbackEmailInvalid =>
      'Digite um e-mail válido ou deixe em branco.';

  @override
  String get deviceAgents => 'Agentes';

  @override
  String get deviceAgentReady => 'Conectado';

  @override
  String get deviceAgentRunning => 'Em execução';

  @override
  String get deviceAgentNotInstalled => 'Não instalado';

  @override
  String get deviceAgentUnavailable => 'Indisponível';

  @override
  String get deviceAgentNotEnabled => 'Não ativado';

  @override
  String get deviceAgentUnknown => 'Não informado';

  @override
  String get deviceAgentOffline =>
      'Computador offline · Último estado informado';

  @override
  String get openingTitle => 'À distância, sempre ligado.';

  @override
  String get openingSubtitle =>
      'Retome o trabalho com IA do seu computador, onde estiver.';

  @override
  String get openingSkip => 'Saltar animação';

  @override
  String get deviceQuota => 'Limites da assinatura';

  @override
  String get quotaFiveHour => '5 horas';

  @override
  String get quotaSevenDay => '7 dias';

  @override
  String quotaUsed(String percent) {
    return '$percent% usado';
  }

  @override
  String quotaResets(String time) {
    return 'Redefine em $time';
  }

  @override
  String quotaUpdated(String time) {
    return 'Atualizado em $time';
  }

  @override
  String get quotaPending => 'Não informado';

  @override
  String get quotaExpired => 'Aguardando novos limites';

  @override
  String get quotaLimitReached => 'Limite atingido';

  @override
  String get quotaSnapshot => 'Último registro';

  @override
  String get quotaClaudeHint =>
      'Claude informa os limites durante as sessões. Dados ausentes não são estimados.';

  @override
  String get settingsHapticsTitle => 'Resposta tátil';

  @override
  String get settingsHapticsSubtitle =>
      'Uma vibração suave confirma uma conexão ou decisão.';

  @override
  String get workbenchBackToLatest => 'Voltar ao mais recente';

  @override
  String get settingsFontSize => 'Tamanho da fonte';

  @override
  String get settingsFontSizeSmall => 'Pequeno';

  @override
  String get settingsFontSizeMedium => 'Médio';

  @override
  String get settingsFontSizeLarge => 'Grande';

  @override
  String get settingsFontSizeSaveFailed =>
      'O tamanho da fonte mudou, mas não foi salvo. Tente novamente.';

  @override
  String get workbenchAgentOrderHint =>
      'Toque e mantenha pressionado, depois arraste para alterar a ordem';

  @override
  String get workbenchAgentOrderSaveFailed =>
      'A ordem foi alterada, mas não foi possível salvá-la. Tente novamente.';

  @override
  String get settingsBuildInfo => 'Informações da versão';

  @override
  String get buildTime => 'Data da compilação';

  @override
  String get buildSourceCommit => 'Commit do código';

  @override
  String get buildUnrecorded => 'Não registrado';

  @override
  String get buildUncommitted => 'Inclui alterações não confirmadas';

  @override
  String get agentTasksTitle => 'Subtarefas';

  @override
  String agentTasksCount(int count) {
    return '$count subtarefas';
  }

  @override
  String agentTasksViewAll(int count) {
    return 'Ver todas as $count subtarefas';
  }

  @override
  String agentTasksRunning(int count) {
    return '$count em execução';
  }

  @override
  String agentTasksFinished(int count) {
    return '$count encerradas';
  }

  @override
  String get agentTasksAttention => 'Precisa da sua atenção';

  @override
  String get agentTasksInProgress => 'Em andamento';

  @override
  String get agentTasksEnded => 'Encerradas';

  @override
  String get agentTaskPreparing => 'Preparando';

  @override
  String get agentTaskUnknown => 'Estado aguardando sincronização';

  @override
  String get agentTaskCompleted => 'Concluída';

  @override
  String get agentTaskFailed => 'Falhou';

  @override
  String get agentTaskStopped => 'Interrompida';

  @override
  String get agentTaskAnswer => 'Aguardando sua resposta';

  @override
  String get agentTaskApprove => 'Aguardando sua aprovação';

  @override
  String get agentTaskNoResult => 'Nenhum resultado recebido ainda';

  @override
  String get agentTaskInstructions => 'Instruções da tarefa';

  @override
  String get agentTaskRuntime => 'Informações de execução';

  @override
  String agentTaskParent(String name) {
    return 'De: $name';
  }

  @override
  String agentTaskUpdated(String time) {
    return 'Atualizado $time';
  }

  @override
  String get agentTaskOffline => 'Computador offline · último estado conhecido';

  @override
  String get agentTaskOpenConversation => 'Abrir conversa da subtarefa';

  @override
  String get agentTaskEmpty => 'Nenhuma subtarefa ainda';

  @override
  String get agentTaskFinishedResult => 'Resultado';

  @override
  String get liveTaskRunning => 'Em andamento';

  @override
  String get liveTaskApproval => 'Requer aprovação';

  @override
  String get liveTaskQuestion => 'Requer resposta';

  @override
  String get liveTaskCompleted => 'Concluída';

  @override
  String get liveTaskFailed => 'Falha na tarefa';

  @override
  String get liveTaskStopped => 'Interrompida';

  @override
  String get liveTaskStale => 'Verificar status';

  @override
  String get liveTaskOpen => 'Ver tarefa';

  @override
  String get liveTaskReview => 'Revisar';

  @override
  String get liveTaskElapsed => 'Tempo decorrido';

  @override
  String get liveTaskUpdated => 'Última sincronização';

  @override
  String get androidPushDisclosure =>
      'Enable background alerts with JPush and, on supported devices, vivo Push. They process a push identifier, Android ID, device/system and network information for delivery. Task content and encryption keys are not sent to these providers. You can turn alerts off in system settings.';

  @override
  String get controllerSessionUnavailable =>
      'Esta conversa não está disponível no computador conectado. Verifique se o Agent está em execução e se a conversa ainda existe; depois, tente novamente ou inicie uma nova conversa.';

  @override
  String get settingsSidebarAgents => 'Agentes da barra lateral';

  @override
  String get settingsSidebarAgentsSubtitle =>
      'Escolha quais agentes aparecem na barra lateral';

  @override
  String get turnStatusRunning => 'A processar';

  @override
  String get turnStatusCompleted => 'Turno concluído';

  @override
  String get turnStatusInterrupted => 'Este turno não foi concluído';

  @override
  String get turnStatusUnknown => 'Registro de atividades';

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
  String get localWebForward => 'Próxima página';

  @override
  String get localWebAddress => 'Endereço da página';

  @override
  String get localWebLoading => 'Conectando ao seu computador…';

  @override
  String get accountDeletionTitle => 'Eliminar conta';

  @override
  String get accountDeletionBody =>
      'A sua conta Relayune, autorizações, preferências e comentários serão eliminados permanentemente. Os dispositivos perderão o acesso e as chaves da cache deste telefone serão apagadas. Os projetos e ficheiros dos agentes nos computadores serão mantidos.';

  @override
  String get accountDeletionPassword => 'Confirme a palavra-passe';

  @override
  String get accountDeletionConfirm => 'Eliminar permanentemente a minha conta';

  @override
  String get accountDeletionBusy => 'A eliminar…';

  @override
  String get accountDeletionWrongPassword =>
      'Palavra-passe incorreta. Tente novamente.';

  @override
  String get accountDeletionFailed =>
      'Não foi possível concluir. Verifique a ligação e tente novamente. Se já começou, os outros acessos ficam desativados até terminar a limpeza.';

  @override
  String get accountDeletionDone => 'A sua conta foi eliminada.';

  @override
  String get controllerPendingInputSaveFailed =>
      'Não foi possível salvar sua mensagem neste telefone. Libere espaço e tente novamente.';

  @override
  String get workbenchHistoryRequestSending => 'Enviando solicitação';

  @override
  String get workbenchHistoryWaitingComputer => 'Aguardando seu computador';

  @override
  String get workbenchHistoryReadingComputer =>
      'Lendo o histórico no seu computador';

  @override
  String get workbenchHistoryPreparing => 'Preparando mensagens';

  @override
  String workbenchHistoryElapsed(int seconds) {
    return 'Tempo decorrido: ${seconds}s';
  }

  @override
  String get workbenchHistoryTransferring => 'Transferindo o histórico';

  @override
  String workbenchHistorySourceRead(String read, String total) {
    return 'O computador leu $read / $total';
  }

  @override
  String workbenchHistoryPendingTransfer(String size) {
    return 'Página aguardando transferência: $size';
  }

  @override
  String workbenchHistoryReceived(String size) {
    return 'Recebidos $size';
  }

  @override
  String workbenchHistoryPendingReceive(String size) {
    return 'Aguardando recebimento: $size';
  }

  @override
  String get workbenchHistoryReadingCache =>
      'Lendo o histórico salvo neste telefone';

  @override
  String get localWebResources => 'Recursos da página';

  @override
  String get localWebGettingPage => 'Obtendo a página…';

  @override
  String get localWebLoadingPage => 'Carregando a página…';

  @override
  String localWebResourceSummary(int completed, int active) {
    return '$completed recebidos · $active em andamento';
  }

  @override
  String localWebResourceFailures(int count) {
    return '$count com falha';
  }

  @override
  String get localWebResourceWaiting => 'Aguardando resposta';

  @override
  String get localWebResourceReceiving => 'Recebendo';

  @override
  String get localWebResourcePreparing => 'Preparando';

  @override
  String get localWebResourceComplete => 'Recebido';

  @override
  String get localWebResourceFailed => 'Falha';

  @override
  String get localWebResourceCancelled => 'Parado';

  @override
  String get localWebResourceTransferNote =>
      'O progresso mede o recebimento da resposta. A página pode solicitar mais recursos.';

  @override
  String get localWebResourceEmpty =>
      'Os recursos solicitados por esta página aparecerão aqui.';

  @override
  String localWebResourceRecent(int count) {
    return 'Mostrando os últimos $count recursos';
  }

  @override
  String localWebElapsed(String seconds) {
    return '$seconds s';
  }

  @override
  String get localWebOpeningTitle => 'Uma página do seu computador';

  @override
  String get localWebOpeningHint =>
      'Mantenha o computador e o serviço web funcionando. A página aparecerá automaticamente.';

  @override
  String get replyBranchLabel => 'Ramificar para um novo chat';

  @override
  String get replyBranchSameDirectory => 'Usar o diretório original do projeto';

  @override
  String get replyBranchSameDirectoryDescription =>
      'Continuar compartilhando os arquivos do projeto';

  @override
  String get replyBranchWorktree => 'Criar um novo worktree';

  @override
  String get replyBranchWorktreeDescription =>
      'Diretório separado, baseado no commit atual';

  @override
  String get controllerReplyBranchOffline =>
      'Conecte seu computador para ramificar';

  @override
  String get controllerReplyBranchCreating => 'Criando um novo chat…';

  @override
  String get controllerReplyBranchCreated =>
      'Chat ramificado usando o diretório original do projeto.';

  @override
  String get controllerReplyBranchFailed =>
      'Não foi possível criar o novo chat. Tente novamente.';

  @override
  String get controllerReplyBranchUnconfirmed =>
      'O resultado ainda não foi confirmado. Mantenha a conexão e tente consultar novamente.';

  @override
  String get controllerReplyBranchUnavailable =>
      'Esta resposta não pode ser ramificada. Atualize a conversa.';

  @override
  String get controllerReplyBranchBusy =>
      'Outra operação de chat está em andamento. Tente novamente em instantes.';

  @override
  String get controllerReplyBranchWorktreeFailed =>
      'Não foi possível criar o worktree. Verifique o projeto no computador e tente novamente.';

  @override
  String get controllerReplyBranchWorktreeCreated =>
      'Chat ramificado usando um worktree separado.';

  @override
  String agentTasksCompletedCount(int count) {
    return '$count concluídas';
  }

  @override
  String agentTasksStoppedCount(int count) {
    return '$count interrompidas';
  }

  @override
  String agentTasksFailedCount(int count) {
    return '$count com falha';
  }

  @override
  String agentTasksPreparingCount(int count) {
    return '$count em preparação';
  }

  @override
  String agentTasksUnknownCount(int count) {
    return '$count aguardando sincronização';
  }

  @override
  String get agentTasksSearch => 'Buscar tarefas, nomes ou modelos';

  @override
  String get agentTasksNoMatches => 'Nenhuma subtarefa correspondente';

  @override
  String get agentTaskModelConfiguration => 'Configuração do modelo';
}
