// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for French (`fr`).
class AppLocalizationsFr extends AppLocalizations {
  AppLocalizationsFr([String locale = 'fr']) : super(locale);

  @override
  String get workbenchStateAnswered => 'Répondu';

  @override
  String get workbenchTurnIncomplete => 'Cette exécution n’a pas abouti';

  @override
  String get controllerQueueUnconfirmed =>
      'Le traitement du message reste à confirmer. Actualisez la conversation.';

  @override
  String get homeGreetingMorning => 'Bonjour';

  @override
  String get homeGreetingNoon => 'Bonjour';

  @override
  String get homeGreetingAfternoon => 'Bonjour';

  @override
  String get homeGreetingEvening => 'Bonsoir';

  @override
  String get homeGreetingNight => 'Il se fait tard';

  @override
  String get homeCareLongBreak => 'Envie d’une pause un peu plus longue ?';

  @override
  String get homeCarePause =>
      'Un peu d’eau, un regard au loin. Un moment pour toi.';

  @override
  String get homeCareNightWorking =>
      'Si tu travailles encore, garde un peu de repos pour cette nuit.';

  @override
  String get homeCareNightQuiet => 'Tu peux en laisser un peu pour demain.';

  @override
  String get homeCareBusyDay =>
      'Tu as passé du temps ici aujourd’hui. Gardes-en aussi pour toi.';

  @override
  String get homeCareDecision => 'Prends ton temps pour décider.';

  @override
  String get homeCareLongWait =>
      'L’attente se prolonge. Un peu de temps pour prendre soin de toi.';

  @override
  String get homeCareWelcomeBack =>
      'Content de te revoir. Reprends à ton rythme.';

  @override
  String get homeCareFirstIdea => 'Une idée pour commencer, quand tu veux.';

  @override
  String get homeCareMeal =>
      'Pas encore mangé ? Prends un moment pour un repas.';

  @override
  String get homeCareEasterEgg =>
      'Succès secret : prendre soin de soi. Sans barre de progression.';

  @override
  String get homeCareWeekend =>
      'Un week-end à ton rythme, avec un peu d’espace pour souffler.';

  @override
  String get homeCareDailyProgress =>
      'Un peu de progrès, et un peu de sérénité aussi.';

  @override
  String get homeCareDailySpace => 'Les idées ont besoin d’espace. Toi aussi.';

  @override
  String get homeCareDailyPace =>
      'Une chose à la fois, en gardant un peu de place pour toi.';

  @override
  String get workbenchReturnHome => 'Retour à l’accueil';

  @override
  String get workbenchVisualization => 'Visualisation';

  @override
  String get workbenchVisualizationUnavailable =>
      'Cette visualisation n’est pas encore disponible.';

  @override
  String get workbenchDesktopVersionUnknown => 'Version inconnue';

  @override
  String get appTitle => 'Relayune';

  @override
  String get commonBack => 'Retour';

  @override
  String get commonCancel => 'Annuler';

  @override
  String get commonClose => 'Fermer';

  @override
  String get commonContinue => 'Continuer';

  @override
  String get commonRetry => 'Réessayer';

  @override
  String get commonSave => 'Enregistrer';

  @override
  String get commonSubmit => 'Envoyer';

  @override
  String get commonSettings => 'Réglages';

  @override
  String get commonLogOut => 'Se déconnecter';

  @override
  String get commonReject => 'Refuser';

  @override
  String get commonAllow => 'Autoriser';

  @override
  String get unavailableTitle => 'Relayune est temporairement indisponible';

  @override
  String get clearLoginSession => 'Effacer la session de connexion';

  @override
  String get updateInstallerUnavailable =>
      'Impossible d’ouvrir l’installateur système. Réessayez plus tard.';

  @override
  String get updateReadyTitle => 'Mise à jour prête';

  @override
  String updateDownloaded(String version) {
    return 'Relayune $version a été téléchargé et vérifié en toute sécurité en arrière-plan.';
  }

  @override
  String get updateLater => 'Plus tard';

  @override
  String get updateInstall => 'Installer la mise à jour';

  @override
  String get authSecurityBadge => 'Espace de travail chiffré de bout en bout';

  @override
  String get authEmailTitle =>
      'Poursuivez les tâches de votre ordinateur sur mobile';

  @override
  String get authPasswordTitle => 'Connectez-vous ou créez un compte';

  @override
  String get authVerificationTitle => 'Consultez votre e-mail';

  @override
  String get authEmailSubtitle =>
      'Après connexion, utilisez le code à 8 caractères affiché sur l’ordinateur pour établir une connexion chiffrée.';

  @override
  String get authPasswordSubtitle =>
      'Connectez-vous avec votre mot de passe ou vérifiez d’abord votre e-mail.';

  @override
  String get authVerificationSubtitle =>
      'Le lien de vérification est à usage unique et expire rapidement.';

  @override
  String get authEmailLabel => 'E-mail';

  @override
  String get authInvalidEmail => 'Saisissez une adresse e-mail valide.';

  @override
  String get authContinue => 'Continuer';

  @override
  String get authChangeEmail => 'Changer d’e-mail';

  @override
  String get authPasswordLabel => 'Mot de passe';

  @override
  String get authShowPassword => 'Afficher le mot de passe';

  @override
  String get authHidePassword => 'Masquer le mot de passe';

  @override
  String get authPasswordRequired => 'Saisissez votre mot de passe.';

  @override
  String get authSignIn => 'Se connecter';

  @override
  String get authVerifyEmailAction =>
      'Première utilisation ou mot de passe oublié ? Vérifier l’e-mail';

  @override
  String get authVerificationInstructions =>
      'Ouvrez l’e-mail de vérification et définissez un mot de passe sur la page sécurisée, puis revenez ici.';

  @override
  String get authPasswordSet => 'J’ai défini mon mot de passe';

  @override
  String get authResendEmail => 'Renvoyer l’e-mail';

  @override
  String get authSecurityNote =>
      'Le serveur ne relaie que du contenu chiffré. Le code de connexion et les clés de contenu ne sont jamais envoyés.';

  @override
  String get pairingExit => 'Quitter';

  @override
  String get pairingTitle => 'Scannez pour connecter votre ordinateur';

  @override
  String get pairingSubtitle => 'Emportez votre travail avec vous.';

  @override
  String get pairingEnterCodeTitle => 'Ou saisir le code à 8 caractères';

  @override
  String get pairingEnterCodeHelp =>
      'Saisissez le code affiché sur votre ordinateur.';

  @override
  String get pairingSearching =>
      'Recherche des ordinateurs en attente de connexion…';

  @override
  String get pairingComputerLabel => 'Ordinateur à connecter';

  @override
  String pairingWillConnect(String device) {
    return 'Connexion à : $device';
  }

  @override
  String get pairingStartOnDesktop =>
      'Choisissez d’abord « Connecter un nouveau client » sur l’ordinateur, puis saisissez le nouveau code.';

  @override
  String get pairingSearchAgain => 'Rechercher à nouveau';

  @override
  String get pairingCodeLabel => 'Code de connexion à 8 caractères';

  @override
  String get pairingSecureConnect => 'Connexion sécurisée';

  @override
  String get pairingScanTitle => 'Où est le QR code ?';

  @override
  String get pairingScanHelp =>
      'Ouvrez Relayune sur votre ordinateur et choisissez « Connecter un nouveau client ».\nScannez le QR code de cette fenêtre.';

  @override
  String get pairingOpenCamera => 'Scanner pour connecter';

  @override
  String get pairingPrivacyNote =>
      'Chiffrement de bout en bout. Seuls vos appareils peuvent lire vos sessions.';

  @override
  String pairingMinimumDesktop(String version) {
    return 'Version minimale compatible : $version';
  }

  @override
  String get pairingDeriving => 'Vérification de la connexion…';

  @override
  String get pairingWaitingDesktop =>
      'Attente de la confirmation de l’ordinateur…';

  @override
  String get pairingActivating => 'Création du canal chiffré…';

  @override
  String get pairingDerivingDetail =>
      'Création locale du partage SPAKE2 et d’une clé de contenu indépendante.';

  @override
  String get pairingWaitingDesktopDetail =>
      'Gardez Relayune ouvert sur votre ordinateur.';

  @override
  String get pairingActivatingDetail =>
      'Vérification du premier catalogue de sessions chiffré.';

  @override
  String get scannerTitle =>
      'Scannez le QR code de connexion sur votre ordinateur';

  @override
  String get scannerResume => 'Reprendre le scan';

  @override
  String get scannerInvalid =>
      'Ce QR code n’est pas un code de connexion Relayune. Scannez le code actuel de l’ordinateur.';

  @override
  String get scannerHelp =>
      'Placez dans le cadre le QR code affiché par Relayune sur l’ordinateur.';

  @override
  String get scannerUnavailable =>
      'L’appareil photo est indisponible. Autorisez Relayune dans les réglages système ou revenez à la connexion manuelle.';

  @override
  String get settingsTitle => 'Réglages';

  @override
  String get settingsSignedInAccount => 'Compte connecté';

  @override
  String get settingsAccountSection => 'Compte';

  @override
  String get settingsPreferencesSection => 'Préférences';

  @override
  String get settingsHelpLegalSection => 'Assistance et mentions légales';

  @override
  String get settingsLanguage => 'Langue';

  @override
  String get settingsLanguageSystemDefault => 'Par défaut (langue du système)';

  @override
  String settingsLanguageSystemDefaultValue(String language) {
    return 'Par défaut · $language';
  }

  @override
  String get settingsLanguageSaveFailed =>
      'La langue a changé, mais la préférence n’a pas pu être enregistrée.';

  @override
  String get settingsReleaseNotes => 'Notes de version';

  @override
  String get settingsSupport => 'Assistance';

  @override
  String get settingsTerms => 'Conditions d’utilisation';

  @override
  String get settingsPrivacy => 'Politique de confidentialité';

  @override
  String get settingsLegalLanguage => 'Français';

  @override
  String get settingsOpenLinkFailed => 'Impossible d’ouvrir ce lien.';

  @override
  String get releaseTitle => 'Notes de version';

  @override
  String get releaseLoading => 'Chargement des notes de version';

  @override
  String get releaseErrorTitle => 'Notes indisponibles';

  @override
  String get releaseErrorMessage => 'Vérifiez votre connexion et réessayez.';

  @override
  String get releaseEmptyTitle => 'Aucune note pour le moment';

  @override
  String get releaseEmptyMessage =>
      'Les prochaines mises à jour apparaîtront ici.';

  @override
  String get releaseVersion => 'Version';

  @override
  String get releaseWeb => 'Web';

  @override
  String get releaseServer => 'Serveur';

  @override
  String get notificationEnabledTitle => 'Notifications de tâches activées';

  @override
  String get notificationPrimerTitle =>
      'La tâche s’exécute sur l’ordinateur : inutile de la surveiller';

  @override
  String get notificationEnabledBody =>
      'Relayune vous avertit lorsqu’une tâche demande votre attention ou se termine.';

  @override
  String get notificationPrimerBody =>
      'Traitez les approbations et questions, puis consultez le résumé à la fin.';

  @override
  String get notificationBenefitAction =>
      'Attention requise : autoriser, refuser ou ouvrir une réponse depuis la notification';

  @override
  String get notificationBenefitCompletion =>
      'Tâche terminée : voir le résumé avant de l’ouvrir';

  @override
  String get notificationBenefitPrivacy =>
      'Les notifications n’affichent jamais commandes, chemins, codes ou clés';

  @override
  String get notificationPermissionRejected =>
      'Les notifications système sont toujours désactivées. Autorisez-les dans les réglages.';

  @override
  String get notificationGotIt => 'Compris';

  @override
  String get notificationOpenSettings => 'Ouvrir les réglages système';

  @override
  String get notificationEnable => 'Activer les notifications';

  @override
  String get notificationNotNow => 'Pas maintenant';

  @override
  String get notificationSemanticsExample =>
      'Exemples : une approbation requiert votre attention, une question attend une réponse et une tâche Claude s’est achevée avec un résumé';

  @override
  String get notificationNow => 'Maintenant';

  @override
  String get notificationSampleTask => 'Améliorer les notifications mobiles';

  @override
  String get notificationSampleBody =>
      'Le guide d’autorisation et le résumé de fin de tâche sont prêts…';

  @override
  String get notificationApprovalTitle =>
      'Opération en attente de confirmation';

  @override
  String get notificationQuestionTitle => 'Votre réponse est requise';

  @override
  String notificationTaskPaused(String provider) {
    return '$provider · tâche en pause';
  }

  @override
  String notificationApprovalBody(int minutes) {
    return 'Autorisez ou refusez cette opération dans $minutes min.';
  }

  @override
  String notificationQuestionBody(int minutes) {
    return 'Répondez dans $minutes min. La tâche reprendra ensuite.';
  }

  @override
  String notificationTaskCompleted(String provider) {
    return 'Tâche $provider terminée';
  }

  @override
  String get notificationMainTask => 'Tâche principale';

  @override
  String get notificationMainResultReady =>
      'Le résultat de la tâche principale est prêt. Touchez pour afficher.';

  @override
  String notificationNamedResultReady(String name) {
    return 'Le résultat de « $name » est prêt. Touchez pour afficher.';
  }

  @override
  String get notificationAllowOnce => 'Autoriser une fois';

  @override
  String get notificationAnswer => 'Répondre';

  @override
  String get notificationChannelAttention => 'Attention requise';

  @override
  String get notificationChannelCompleted => 'Tâche terminée';

  @override
  String get notificationChannelAttentionDescription =>
      'Alertes d’approbation et de question Relayune';

  @override
  String get notificationChannelCompletedDescription =>
      'Alertes de fin de tâche principale Relayune';

  @override
  String get notificationRedactedLink => '[lien]';

  @override
  String get notificationRedactedPath => '[chemin]';

  @override
  String get notificationRedactedSecret => '[masqué]';

  @override
  String get workbenchTitle => 'Espace de travail';

  @override
  String get workbenchDevice => 'Appareil';

  @override
  String get workbenchOpenNavigation => 'Ouvrir la navigation';

  @override
  String workbenchPendingApprovals(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count approbations en attente',
      one: '1 approbation en attente',
    );
    return '$_temp0';
  }

  @override
  String get workbenchSessions => 'Sessions';

  @override
  String get workbenchOnline => 'En ligne';

  @override
  String get workbenchOffline => 'Hors ligne';

  @override
  String get workbenchDeviceOnlineRealtime =>
      'Ordinateur en ligne · synchronisation en temps réel';

  @override
  String get workbenchDeviceOfflineQueued =>
      'Ordinateur hors ligne · uniquement les éléments en cache';

  @override
  String get workbenchDeviceOnlineReconnecting =>
      'Ordinateur en ligne · restauration de la connexion en temps réel';

  @override
  String get workbenchDeviceOfflineReconnecting =>
      'Ordinateur hors ligne · restauration de la connexion en temps réel';

  @override
  String get workbenchDeviceOnlineWaiting =>
      'Ordinateur en ligne · attente de la connexion en temps réel';

  @override
  String get workbenchDeviceOfflineWaiting =>
      'Ordinateur hors ligne · attente de la connexion en temps réel';

  @override
  String get workbenchProjectsSessions => 'Projets et sessions';

  @override
  String get workbenchNoSessionsSynced =>
      'Aucune session n’a encore été synchronisée depuis l’ordinateur';

  @override
  String get workbenchSignedInAccount => 'Compte connecté';

  @override
  String get workbenchNotSignedIn => 'Non connecté';

  @override
  String get workbenchNewSession => 'Nouvelle session';

  @override
  String get workbenchDefaultSessionName => 'Nouvelle session distante';

  @override
  String get workbenchHistoryFailed =>
      'Impossible de charger l’historique ; le contenu actuel peut être incomplet';

  @override
  String get workbenchLoadEarlier => 'Charger les messages précédents';

  @override
  String get workbenchSendFirst =>
      'Envoyez votre première instruction pour commencer';

  @override
  String get workbenchAtBeginning => 'Ceci est le premier message';

  @override
  String get workbenchAddAttachment => 'Ajouter une pièce jointe';

  @override
  String workbenchRemoveAttachment(String name) {
    return 'Supprimer $name';
  }

  @override
  String get workbenchReadOnly => 'Cette session est en lecture seule';

  @override
  String get workbenchOfflineQueued =>
      'Ordinateur hors ligne · envoi indisponible';

  @override
  String get workbenchSteerPlaceholder =>
      'Envoyez une instruction pour arrêter et continuer…';

  @override
  String get workbenchSendPlaceholder =>
      'Envoyer des instructions à l’ordinateur…';

  @override
  String get workbenchStopTask => 'Arrêter la tâche';

  @override
  String get workbenchSending => 'Envoi…';

  @override
  String get workbenchSend => 'Envoyer';

  @override
  String get workbenchYou => 'Vous';

  @override
  String get workbenchLocalActivity => 'Activité locale';

  @override
  String get workbenchToday => 'Aujourd’hui';

  @override
  String get workbenchYesterday => 'Hier';

  @override
  String get workbenchDayBeforeYesterday => 'Avant-hier';

  @override
  String get workbenchSystemNotice => 'Alerte système';

  @override
  String workbenchApprovalSource(String name) {
    return 'Source : $name';
  }

  @override
  String workbenchApprovalDirectory(String path) {
    return 'Dossier : $path';
  }

  @override
  String get workbenchApprovalPermission => 'Autorisation demandée';

  @override
  String get workbenchSelect => 'Sélectionner';

  @override
  String get workbenchOtherAnswer => 'Autre réponse…';

  @override
  String get workbenchSkipAnswer => 'Pas maintenant';

  @override
  String get workbenchHighRiskTitle =>
      'Autoriser une opération à haut risque ?';

  @override
  String get workbenchOperationOnComputer =>
      'Cette opération sera exécutée sur votre ordinateur.';

  @override
  String get workbenchConfirmAllow => 'Confirmer et autoriser';

  @override
  String get workbenchAnswerLabel => 'Réponse';

  @override
  String get workbenchAllowOnce => 'Autoriser une fois';

  @override
  String get workbenchAlwaysAllowSession =>
      'Toujours autoriser dans cette session';

  @override
  String get workbenchAllowAndRemember => 'Autoriser et mémoriser';

  @override
  String get workbenchAlwaysRejectSession =>
      'Toujours refuser dans cette session';

  @override
  String get workbenchRejectAndRemember => 'Refuser et mémoriser';

  @override
  String get workbenchSaveDecisionTitle => 'Mémoriser cette décision ?';

  @override
  String get workbenchSaveDecisionMessage =>
      'Relayune appliquera automatiquement ce choix uniquement aux opérations similaires de la session actuelle.';

  @override
  String get workbenchConfirm => 'Confirmer';

  @override
  String get workbenchRejectAndStop => 'Refuser et arrêter la tâche';

  @override
  String get workbenchNotificationSettings => 'Notifications de tâches';

  @override
  String get workbenchConnectAnother => 'Connecter un autre ordinateur';

  @override
  String get workbenchConnectAnotherSubtitle =>
      'Supprimer de ce téléphone la clé de contenu et l’autorisation actuelles';

  @override
  String get workbenchConnectAnotherTitle => 'Connecter un autre ordinateur ?';

  @override
  String get workbenchConnectAnotherMessage =>
      'La clé de contenu et le jeton d’autorisation du téléphone seront supprimés du stockage sécurisé de cet appareil. Les données du serveur et de l’ordinateur ne seront pas supprimées.';

  @override
  String get workbenchNoSessions => 'Aucune session disponible';

  @override
  String get workbenchNoSessionsHelp =>
      'Gardez l’application de bureau en ligne ou créez une session dans un dossier de projet de l’ordinateur.';

  @override
  String get workbenchHistoryLoading => 'Chargement de l’historique';

  @override
  String get workbenchHistoryLoadingOlder =>
      'Chargement des messages précédents…';

  @override
  String get workbenchHistoryLimit =>
      'L’historique se charge à l’ouverture d’une session, jusqu’à 500 messages à la fois';

  @override
  String get workbenchFilePreviewRetry =>
      'Échec de l’aperçu du fichier. Réessayez.';

  @override
  String get workbenchSecureFileReading =>
      'Lecture sécurisée depuis votre ordinateur…';

  @override
  String get workbenchFileUnavailable =>
      'Le fichier a expiré ou a été supprimé de l’ordinateur.';

  @override
  String get workbenchApprovalCommand => 'Exécuter une commande';

  @override
  String get workbenchApprovalFileChange => 'Modifier un fichier';

  @override
  String get workbenchApprovalChoice => 'Votre choix est requis';

  @override
  String get workbenchApprovalTool => 'Exécuter l’outil local';

  @override
  String get workbenchStatePending => 'En attente';

  @override
  String get workbenchStateDeciding => 'Envoi';

  @override
  String get workbenchStateApproved => 'Approuvée';

  @override
  String get workbenchStateRejected => 'Refusée';

  @override
  String get workbenchStateExpired => 'Expirée';

  @override
  String get workbenchLocalRelay => 'Relay local';

  @override
  String get workbenchEncryptionProtocol => 'Protocole de chiffrement';

  @override
  String get workbenchPairingProtocol => 'Protocole d’association';

  @override
  String get workbenchRealtimeChannel => 'Canal temps réel';

  @override
  String get workbenchTechnicalDetails => 'Détails techniques';

  @override
  String get workbenchRealtimeConnection => 'Connexion en temps réel';

  @override
  String get workbenchHeartbeatPath => 'iPhone ↔ Server · WebSocket';

  @override
  String get workbenchHeartbeatHealthy => 'Signal stable';

  @override
  String get workbenchHeartbeatWaiting => 'En attente du premier signal';

  @override
  String get workbenchLastHeartbeat => 'Dernier signal';

  @override
  String get workbenchRoundTrip => 'Aller-retour';

  @override
  String get workbenchWebSocketHeartbeat => 'Signal WebSocket';

  @override
  String get workbenchDesktopHeartbeat => 'Signal de l’ordinateur';

  @override
  String get workbenchJustNow => 'À l’instant';

  @override
  String workbenchSecondsAgo(int seconds) {
    return 'Il y a $seconds s';
  }

  @override
  String workbenchMinutesAgo(int minutes) {
    return 'Il y a $minutes min';
  }

  @override
  String get workbenchStateVersion => 'Version de l’état';

  @override
  String get workbenchAwaitingConfirmation => 'En attente de confirmation';

  @override
  String get workbenchLastConfirmed => 'Dernière confirmation';

  @override
  String get workbenchEventAck => 'Accusé de réception des événements';

  @override
  String get workbenchOfflineQueue => 'File hors ligne';

  @override
  String get workbenchSecurityBoundary =>
      'Limite du chiffrement de bout en bout';

  @override
  String get workbenchPhonePlaintextEndpoint =>
      'Le téléphone est un point terminal où l’application voit le texte en clair';

  @override
  String get workbenchServerCiphertextOnly =>
      'Le serveur ne stocke que des enveloppes de texte chiffré authentifié';

  @override
  String get workbenchKeyInSecureStorage =>
      'Les clés de contenu sont conservées dans le stockage sécurisé du système';

  @override
  String get workbenchCodeNeverUploaded =>
      'Le code de connexion à 8 caractères n’est jamais envoyé';

  @override
  String get workbenchNotConfirmed => 'Pas encore confirmé';

  @override
  String get workbenchRealtimeConnected => 'WebSocket connecté';

  @override
  String get workbenchRealtimeConnecting => 'Connexion';

  @override
  String get workbenchRealtimeReconnecting => 'Reconnexion';

  @override
  String get workbenchRealtimeIdle => 'En attente de connexion';

  @override
  String workbenchNotificationStatus(String status) {
    return '$status · les notifications fonctionnent tant que la connexion en arrière-plan reste active ; leur livraison n’est pas garantie après l’arrêt de l’app par le système';
  }

  @override
  String get workbenchNotificationAllowed => 'Autorisées';

  @override
  String get workbenchNotificationDisabled => 'Désactivées';

  @override
  String get workbenchNotificationUnknown => 'Inconnu';

  @override
  String get workbenchClose => 'Fermer';

  @override
  String get workbenchProjectConfiguration => 'Réglages du projet';

  @override
  String get workbenchProjectConfigurationTitle => 'Réglages du projet';

  @override
  String get workbenchProjectName => 'Nom du projet';

  @override
  String get workbenchProjectNameHelp =>
      'Seul le nom affiché dans l’app change ; le dossier de l’ordinateur n’est pas renommé.';

  @override
  String get workbenchFullPath => 'Chemin complet';

  @override
  String get workbenchProjectPathUnavailable =>
      'L’ordinateur n’a pas fourni le chemin du projet';

  @override
  String workbenchSessionCount(int count) {
    return '$count sessions';
  }

  @override
  String workbenchMoreSessions(int count) {
    return 'Afficher plus de sessions ($count)';
  }

  @override
  String get workbenchAgentRunning => 'Agent en cours';

  @override
  String get workbenchAgentNotRunning => 'Agent à l’arrêt';

  @override
  String get workbenchRunning => 'En cours';

  @override
  String get workbenchKimiSettings => 'Réglages Kimi';

  @override
  String get workbenchEnableYoloTitle => 'Activer le mode YOLO ?';

  @override
  String get workbenchEnableAutoTitle => 'Activer le mode Auto ?';

  @override
  String get workbenchYoloWarning =>
      'Kimi approuvera automatiquement davantage d’appels d’outils locaux. Activez-le uniquement si vous faites confiance à la tâche et au projet.';

  @override
  String get workbenchAutoWarning =>
      'Kimi approuvera les appels d’outils courants, mais pourra toujours poser des questions.';

  @override
  String get workbenchConfirmEnable => 'Confirmer et activer';

  @override
  String get workbenchUploadTooManyImages =>
      'Vous pouvez ajouter jusqu’à 4 images par message.';

  @override
  String workbenchUploadUnsupportedImages(String names) {
    return '$names ne sont pas pris en charge. Choisissez PNG, JPEG, WebP, GIF ou AVIF.';
  }

  @override
  String get workbenchUploadTooLarge =>
      'Les pièces jointes d’un message ne peuvent pas dépasser 20 MiB au total.';

  @override
  String workbenchPreviewGenerateFailed(String name) {
    return 'Impossible de lire ou créer l’aperçu de $name. Réessayez.';
  }

  @override
  String get workbenchKimiViewAgents => 'Voir les sous-agents';

  @override
  String get workbenchKimiViewAgentsDescription =>
      'Ouvrez la fenêtre de travail Agent au-dessus de la zone de saisie sans lancer une nouvelle tâche de modèle.';

  @override
  String get workbenchKimiOpenNow => 'Ouvrir';

  @override
  String get workbenchKimiSessionStatus => 'État de la session';

  @override
  String get workbenchKimiSessionStatusDescription =>
      'Consultez la tâche, les approbations, le contexte et la synchronisation locale.';

  @override
  String get workbenchKimiLocalStatus => 'État local';

  @override
  String get workbenchKimiModel => 'Modèle';

  @override
  String get workbenchKimiModelDescription =>
      'Changez le modèle utilisé par cette session Kimi.';

  @override
  String get workbenchKimiSessionSettings => 'Réglages de session';

  @override
  String get workbenchKimiPermissionMode => 'Mode d’autorisation';

  @override
  String get workbenchKimiPermissionModeDescription =>
      'Consultez ou modifiez la politique d’approbation des outils locaux.';

  @override
  String get workbenchKimiSecuritySettings => 'Réglages de sécurité';

  @override
  String get workbenchKimiPlanMode => 'Mode Plan';

  @override
  String get workbenchKimiPlanModeDescription =>
      'Demandez à Kimi de planifier avant d’exécuter la tâche.';

  @override
  String get workbenchKimiYoloMode => 'Mode YOLO';

  @override
  String get workbenchKimiYoloModeDescription =>
      'Approuve automatiquement davantage d’appels d’outils ; une confirmation est requise avant l’activation.';

  @override
  String get workbenchKimiConfirmationRequired => 'Confirmation requise';

  @override
  String get workbenchKimiSettingsDescription =>
      'Ouvrez les réglages du modèle, de Thinking et des autorisations.';

  @override
  String workbenchKimiInputRequired(String hint) {
    return 'Saisie requise : $hint';
  }

  @override
  String get workbenchKimiNativeCommandDescription =>
      'Commande Kimi ACP native exécutée comme une véritable tâche de commande.';

  @override
  String get workbenchKimiNativeCommand => 'Commande native';

  @override
  String get workbenchKimiContextSyncing =>
      'Contexte en attente de synchronisation';

  @override
  String get workbenchKimiWaitingForSync => 'En attente de synchronisation';

  @override
  String workbenchKimiContextUsage(int percent, String used, String size) {
    return 'Contexte $percent% · $used/$size';
  }

  @override
  String workbenchKimiContextUsed(String used) {
    return 'Contexte $used';
  }

  @override
  String get workbenchKimiContext => 'Contexte';

  @override
  String get workbenchKimiModelSyncing =>
      'Modèle en attente de synchronisation';

  @override
  String get workbenchKimiQuickCommands => 'Commandes rapides';

  @override
  String get workbenchKimiNoMatchingCommands =>
      'Aucune commande correspondante';

  @override
  String get workbenchKimiTask => 'Tâche';

  @override
  String get workbenchKimiIdle => 'Inactif';

  @override
  String get workbenchKimiSubagents => 'Sous-agents';

  @override
  String workbenchKimiActiveCount(int count) {
    return '$count actifs';
  }

  @override
  String get workbenchKimiApprovals => 'Approbations';

  @override
  String workbenchKimiPendingCount(int count) {
    return '$count en attente';
  }

  @override
  String get workbenchKimiSettingsOffline =>
      'Les réglages Kimi ne peuvent pas être modifiés lorsque Relay est hors ligne.';

  @override
  String get workbenchKimiSettingsRunning =>
      'Arrêtez la tâche Kimi principale avant de modifier les réglages.';

  @override
  String get workbenchKimiNoOptions =>
      'L’ordinateur n’a pas encore synchronisé d’options configurables.';

  @override
  String get workbenchKimiEncryptedSettings =>
      'Les réglages sont chiffrés de bout en bout vers Kimi Code sur votre ordinateur. Le serveur ne peut pas les lire.';

  @override
  String get workbenchKimiManualApproval => 'Approbation manuelle';

  @override
  String get workbenchSessionSettings => 'Réglages de session';

  @override
  String get workbenchSessionSettingsOffline =>
      'Les réglages de session ne peuvent pas être modifiés lorsque Relay est hors ligne.';

  @override
  String get workbenchSessionSettingsRunning =>
      'Arrêtez la tâche en cours avant de modifier ses réglages.';

  @override
  String get workbenchNoConfigOptions =>
      'L’ordinateur n’a pas encore synchronisé d’options configurables.';

  @override
  String workbenchEncryptedSessionSettings(String provider) {
    return 'Les réglages sont chiffrés de bout en bout vers $provider sur votre ordinateur. Le serveur ne peut pas les lire.';
  }

  @override
  String get workbenchUnrestrictedPermissionsTitle =>
      'Modifier le mode d’autorisation ?';

  @override
  String get workbenchUnrestrictedPermissionsWarning =>
      'Cela change si les outils locaux sont autorisés, refusés ou soumis à approbation. Vérifiez le mode choisi avant de continuer.';

  @override
  String get workbenchCoworkCreateOnDesktop =>
      'Créez d’abord les tâches Cowork dans Claude Desktop ; les tâches existantes peuvent être contrôlées ici.';

  @override
  String get workbenchProcessing => 'Traitement';

  @override
  String get workbenchProcess => 'Processus';

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
      'L’adresse de l’image est indisponible.';

  @override
  String workbenchFilePreviewAvailable(String kind) {
    return 'Prévisualisable · $kind · jusqu’à 1 MB';
  }

  @override
  String get workbenchFilePreviewUnsupported =>
      'Ce format de fichier ne peut pas être prévisualisé';

  @override
  String workbenchImageReadFailed(String name) {
    return '$name\nImpossible de lire l’image';
  }

  @override
  String workbenchImageThumbnailLabel(String name) {
    return 'Miniature de $name ; touchez pour ouvrir l’aperçu';
  }

  @override
  String get workbenchViewOriginal => 'Voir l’original';

  @override
  String get workbenchLoadingOriginal =>
      'Chargement sécurisé de l’image originale…';

  @override
  String get workbenchOriginalReadFailed =>
      'Impossible de lire l’image originale. Réessayez.';

  @override
  String workbenchActivityFailed(String label) {
    return 'Échec de $label';
  }

  @override
  String workbenchActivityCompleted(String label) {
    return '$label terminé';
  }

  @override
  String workbenchActivityRunning(String label) {
    return 'En cours : $label';
  }

  @override
  String get workbenchViewOutput => 'Touchez pour voir la sortie';

  @override
  String get workbenchViewThumbnail => 'Touchez pour voir la miniature';

  @override
  String get workbenchSemanticSeparator => ', ';

  @override
  String workbenchCommandsRunning(int count) {
    return 'Exécution de $count commandes';
  }

  @override
  String workbenchCommandsFailed(int count) {
    return 'Certaines des $count commandes ont échoué';
  }

  @override
  String workbenchCommandsCompleted(int count) {
    return '$count commandes exécutées';
  }

  @override
  String workbenchFilesReading(int count) {
    return 'Lecture de $count fichiers';
  }

  @override
  String workbenchFilesReadFailed(int count) {
    return 'Certains des $count fichiers n’ont pas pu être lus';
  }

  @override
  String workbenchFilesRead(int count) {
    return '$count fichiers lus';
  }

  @override
  String workbenchFilesChanging(int count) {
    return 'Modification de $count fichiers';
  }

  @override
  String workbenchFilesChangeFailed(int count) {
    return 'Certaines modifications des $count fichiers ont échoué';
  }

  @override
  String workbenchFilesChanged(int count) {
    return '$count fichiers modifiés';
  }

  @override
  String workbenchOperationsRunning(int count) {
    return 'Traitement de $count opérations de fichiers et commandes';
  }

  @override
  String workbenchOperationsFailed(int count) {
    return 'Certaines des $count opérations de fichiers et commandes ont échoué';
  }

  @override
  String workbenchOperationsCompleted(int count) {
    return '$count opérations de fichiers et commandes terminées';
  }

  @override
  String get workbenchToolCommand => 'Exécuter une commande';

  @override
  String workbenchToolReadFilesSubject(int count, String subject) {
    return 'Lire $count fichiers : $subject';
  }

  @override
  String workbenchToolReadFiles(int count) {
    return 'Lire $count fichiers';
  }

  @override
  String workbenchToolReadFileSubject(String subject) {
    return 'Lire le fichier : $subject';
  }

  @override
  String get workbenchToolReadFile => 'Lire le fichier';

  @override
  String workbenchToolChangeFilesSubject(int count, String subject) {
    return 'Modifier $count fichiers : $subject';
  }

  @override
  String workbenchToolChangeFiles(int count) {
    return 'Modifier $count fichiers';
  }

  @override
  String workbenchToolChangeFileSubject(String subject) {
    return 'Modifier le fichier : $subject';
  }

  @override
  String get workbenchToolChangeFile => 'Modifier le fichier';

  @override
  String workbenchToolCallNamed(String name) {
    return 'Appeler l’outil : $name';
  }

  @override
  String get workbenchToolCall => 'Appeler un outil';

  @override
  String workbenchToolWebSearchSubject(String subject) {
    return 'Rechercher sur le Web : $subject';
  }

  @override
  String get workbenchToolWebSearch => 'Rechercher sur le Web';

  @override
  String workbenchToolImageViewSubject(String subject) {
    return 'Voir l’image : $subject';
  }

  @override
  String get workbenchToolImageView => 'Voir l’image';

  @override
  String get workbenchToolImageGeneration => 'Générer une image';

  @override
  String get workbenchToolContextCompaction =>
      'Compacter automatiquement le contexte';

  @override
  String get workbenchToolWait => 'Attendre la tâche';

  @override
  String get workbenchLocalOperation => 'Opération locale';

  @override
  String get workbenchDeliverySent => 'Envoyé';

  @override
  String get workbenchDeliverySending => 'Envoi';

  @override
  String get workbenchDeliveryFailed => 'Échec de l’envoi';

  @override
  String workbenchAssistantRunningElapsed(String agent, String duration) {
    return '$agent est en cours ; durée $duration';
  }

  @override
  String workbenchAssistantRunning(String agent) {
    return '$agent est en cours';
  }

  @override
  String workbenchAssistantElapsed(String duration) {
    return '· durée $duration';
  }

  @override
  String get workbenchCloseFilePreview => 'Fermer l’aperçu du fichier';

  @override
  String workbenchFileReadCompleted(String name) {
    return 'Lecture terminée : $name';
  }

  @override
  String workbenchFileReading(String name) {
    return 'Lecture du fichier : $name';
  }

  @override
  String workbenchFileReadFailed(String message) {
    return 'Échec de lecture : $message';
  }

  @override
  String get workbenchFilePreviewFailed => 'Échec de l’aperçu. Réessayez.';

  @override
  String get workbenchFileKindTableText => 'Texte tabulaire';

  @override
  String get workbenchFileKindLog => 'Journal';

  @override
  String get workbenchFileKindPlainText => 'Texte brut';

  @override
  String get workbenchFileKindCodeOrConfig => 'Code ou configuration';

  @override
  String workbenchAgentsWorking(int count) {
    return '$count sous-agents travaillent en parallèle';
  }

  @override
  String get workbenchAgentWindow => 'Fenêtre de travail Agent';

  @override
  String get workbenchAgentWindowDescription =>
      'Synchronise l’état de la tâche et l’activité des outils sans afficher le raisonnement privé';

  @override
  String workbenchMoreAgents(int count) {
    return '$count Agents de plus · faites défiler pour les voir';
  }

  @override
  String workbenchCurrentActivity(String activity) {
    return 'Actuel · $activity';
  }

  @override
  String get workbenchAllAgents => 'Tous les Agents';

  @override
  String get workbenchActivityTimeline => 'Chronologie d’activité';

  @override
  String workbenchActivityCount(int count) {
    return '$count entrées';
  }

  @override
  String get workbenchAgentSyncing => 'Synchronisation depuis cet ordinateur…';

  @override
  String get workbenchNoPublicActivity =>
      'Aucune activité publique. Seuls l’état de la tâche et l’activité des outils sont synchronisés, pas le raisonnement privé.';

  @override
  String get workbenchLatestResult => 'Dernier résultat';

  @override
  String get workbenchWaitingForTask => 'En attente d’une tâche';

  @override
  String get controllerRestoreFailed =>
      'Impossible de restaurer la connexion sécurisée. Reconnectez-vous ou refaites l’association.';

  @override
  String get controllerAuthorizationRevoked =>
      'L’autorisation de ce téléphone a été révoquée. Reconnectez-le.';

  @override
  String get controllerDeviceNotConnected =>
      'Ce compte n’est pas connecté à cet ordinateur. Relancez la connexion sur l’ordinateur.';

  @override
  String get controllerProjectNameRequired => 'Le nom du projet est requis.';

  @override
  String controllerProjectNameTooLong(int maximum) {
    return 'Le nom du projet ne peut pas dépasser $maximum caractères.';
  }

  @override
  String get controllerProjectNameSaveFailed =>
      'Impossible d’enregistrer le nom localement. Réessayez.';

  @override
  String get controllerProjectNameUpdated => 'Nom du projet mis à jour.';

  @override
  String get controllerNewPairingLinkReceived =>
      'Un nouveau lien a été reçu. Déconnectez l’appareil actuel pour vous reconnecter.';

  @override
  String get controllerPairingLinkRequired =>
      'Saisissez le lien Relayune affiché dans l’app de bureau.';

  @override
  String get controllerPairingDiscoveryFailed =>
      'Impossible de trouver les ordinateurs en attente. Réessayez plus tard.';

  @override
  String get controllerVerificationResent => 'E-mail de vérification renvoyé.';

  @override
  String get controllerSetPasswordFirst =>
      'Définissez d’abord un mot de passe depuis le lien reçu, puis revenez ici.';

  @override
  String get controllerNoPendingComputer =>
      'Aucun ordinateur n’attend la connexion. Sélectionnez d’abord « Connecter un nouveau client » sur l’ordinateur.';

  @override
  String get controllerSelectComputer =>
      'Sélectionnez l’ordinateur à connecter.';

  @override
  String get controllerPairingFailed =>
      'Échec de la connexion sécurisée. Vérifiez le code et réessayez.';

  @override
  String get controllerHistoryReadFailed => 'Impossible de lire l’historique.';

  @override
  String get controllerAgentRefreshFailed =>
      'Impossible d’actualiser l’activité de ce sous-agent pour le moment.';

  @override
  String get controllerAttachmentTooLarge =>
      'Les fichiers de plus de 1 MB ne peuvent pas encore être prévisualisés.';

  @override
  String get controllerAttachmentUnsupported =>
      'Ce format ne peut pas encore être prévisualisé.';

  @override
  String get controllerAttachmentGone =>
      'Le fichier a expiré ou a été supprimé de l’ordinateur.';

  @override
  String get controllerAttachmentReadFailed =>
      'Impossible de lire la pièce jointe.';

  @override
  String controllerUploadTooMany(int maximum) {
    return 'Vous pouvez envoyer jusqu’à $maximum images par message.';
  }

  @override
  String get controllerUploadTotalTooLarge =>
      'Les pièces jointes d’un message ne peuvent pas dépasser 20 MiB au total.';

  @override
  String get controllerUploadUnsupported =>
      'Choisissez des images PNG, JPEG, WebP, GIF ou AVIF.';

  @override
  String get controllerSteeringUnsupported =>
      'Cette tâche n’accepte pas d’instructions supplémentaires. Arrêtez-la d’abord.';

  @override
  String get controllerPreparingAgent =>
      'Reçu sur l’ordinateur · Préparation de l’agent';

  @override
  String get controllerWaitingForAgent =>
      'En attente de réception par l’Agent local';

  @override
  String get controllerWaitingForComputer =>
      'En attente de la connexion de l’ordinateur';

  @override
  String get controllerStopSent => 'Demande d’arrêt envoyée.';

  @override
  String get controllerApprovalExpired => 'Cette approbation a expiré.';

  @override
  String get controllerApprovalOffline =>
      'Les approbations ne sont pas disponibles quand l’ordinateur est hors ligne.';

  @override
  String get controllerApprovalAllowedSent =>
      'Autorisation envoyée ; en attente de la confirmation de l’ordinateur.';

  @override
  String get controllerApprovalRejectedSent =>
      'Refus envoyé ; en attente de la confirmation de l’ordinateur.';

  @override
  String controllerDelegatedTasks(int count) {
    return '$count tâches parallèles déléguées.';
  }

  @override
  String get controllerSelectProject =>
      'Sélectionnez d’abord un projet synchronisé dans la barre latérale.';

  @override
  String get controllerCreateSessionOffline =>
      'L’ordinateur est hors ligne. Impossible de créer une session maintenant.';

  @override
  String controllerSessionNameLength(int maximum) {
    return 'Le nom de la session doit contenir entre 1 et $maximum caractères.';
  }

  @override
  String get controllerSessionCreationBusy =>
      'La session précédente est encore en cours de création. Patientez.';

  @override
  String controllerSessionCreating(String name) {
    return 'Création de « $name »…';
  }

  @override
  String get controllerSessionCreateFailed =>
      'Impossible de créer la session. Réessayez plus tard.';

  @override
  String get controllerDesktopSessionCreateFailed =>
      'L’app de bureau n’a pas pu créer la session.';

  @override
  String get controllerSessionCreateTimeout =>
      'Délai dépassé pour créer la session. Vérifiez plus tard sans créer de doublon.';

  @override
  String controllerSessionCreated(String name) {
    return '« $name » créée.';
  }

  @override
  String get controllerCoworkCreateOnDesktop =>
      'Créez d’abord cette tâche Cowork dans Claude Desktop, puis contrôlez-la ici.';

  @override
  String get controllerDesktopConfigFailed =>
      'L’app de bureau n’a pas pu appliquer les réglages de session.';

  @override
  String get controllerConfigApplied => 'Réglages de session appliqués.';

  @override
  String get controllerConfigUpdateFailed =>
      'Impossible de mettre à jour les réglages. Réessayez plus tard.';

  @override
  String get controllerConfigTimeout =>
      'Délai dépassé pour appliquer les réglages. Actualisez pour confirmer.';

  @override
  String get controllerInvalidEncryptedEvent =>
      'Un événement chiffré n’a pas pu être vérifié. La progression du curseur de synchronisation a été arrêtée.';

  @override
  String get controllerApprovalNeeded => 'En attente de votre approbation';

  @override
  String get controllerContinuing => 'Reprise du traitement';

  @override
  String get controllerApprovalProcessFailed =>
      'L’ordinateur n’a pas pu traiter cette approbation. Réessayez.';

  @override
  String controllerAgentProcessing(String name) {
    return '$name traite la tâche';
  }

  @override
  String get controllerSummarizing => 'Résumé des résultats';

  @override
  String get controllerThinking => 'Réflexion';

  @override
  String get controllerLocalTaskFailed => 'Échec de la tâche locale.';

  @override
  String get controllerInterruptFailed =>
      'Impossible d’arrêter la tâche actuelle.';

  @override
  String get controllerReplying => 'Réponse en cours';

  @override
  String get controllerFinishing => 'Finalisation';

  @override
  String get controllerOrganizingFileChanges =>
      'Organisation des modifications de fichiers';

  @override
  String controllerFilesModified(int count) {
    return '$count fichiers modifiés.';
  }

  @override
  String get controllerUpdatingPlan => 'Mise à jour du plan';

  @override
  String get controllerMessageQueued =>
      'Message mis en file d’attente. Il sera envoyé automatiquement plus tard.';

  @override
  String controllerSessionPersisted(String agent) {
    return 'Session enregistrée dans $agent.';
  }

  @override
  String controllerLocalTool(String label) {
    return 'Outil local : $label';
  }

  @override
  String get controllerProcessingLocalResult => 'Traitement du résultat local';

  @override
  String get controllerEncryptedResponseTimeout =>
      'Délai d’attente dépassé pour la réponse chiffrée de l’ordinateur.';

  @override
  String get controllerPairingUsedOrExpired =>
      'Cette connexion a déjà été utilisée ou a expiré.';

  @override
  String get controllerPairingConfirmationTimeout =>
      'Délai de confirmation de l’app de bureau dépassé. Relancez la connexion.';

  @override
  String get controllerPairingConfirmationFailed =>
      'L’ordinateur n’a pas confirmé la connexion chiffrée. Reconnectez-vous.';

  @override
  String get controllerDesktopOffline =>
      'L’app de bureau n’est pas encore en ligne. Gardez Relayune ouvert et réessayez.';

  @override
  String get workbenchDefault => 'Par défaut';

  @override
  String workbenchAgentToolCount(int count) {
    return '$count outils';
  }

  @override
  String workbenchAgentTokenCount(String count) {
    return '$count jetons';
  }

  @override
  String get apiErrorNetworkUnavailable =>
      'Impossible de se connecter à Relayune. Vérifiez le réseau et réessayez.';

  @override
  String get apiErrorTimeout => 'La requête a expiré. Réessayez.';

  @override
  String get apiErrorInvalidResponse =>
      'Relayune a reçu une réponse de serveur non valide. Réessayez.';

  @override
  String get apiErrorInvalidCredentials =>
      'L’adresse e-mail ou le mot de passe est incorrect.';

  @override
  String get apiErrorAuthentication =>
      'Votre connexion a expiré. Reconnectez-vous.';

  @override
  String get apiErrorService =>
      'Relayune est temporairement indisponible. Réessayez plus tard.';

  @override
  String get apiErrorGeneric => 'Une erreur s’est produite. Réessayez.';

  @override
  String get controllerFileAccessDenied =>
      'Relayune ne peut pas lire certains fichiers de session sur votre ordinateur. Sur Mac, autorisez l’accès dans Réglages Système → Confidentialité et sécurité → Fichiers et dossiers, puis réessayez. Sur les autres ordinateurs, vérifiez les permissions des fichiers.';

  @override
  String get workbenchImageWaiting => 'En attente';

  @override
  String get workbenchImageLoading => 'Chargement';

  @override
  String get feedbackTitle => 'Commentaires';

  @override
  String get feedbackIntro => 'Que pouvons-nous améliorer ?';

  @override
  String get feedbackSubtitle => 'Partagez une idée ou signalez un problème.';

  @override
  String get feedbackSuggestion => 'Suggestion';

  @override
  String get feedbackBug => 'Signaler un bug';

  @override
  String get feedbackDescription => 'Description';

  @override
  String get feedbackSuggestionHint =>
      'Que souhaitez-vous améliorer et en quoi cela vous aiderait-il ?';

  @override
  String get feedbackBugHint =>
      'Qu’avez-vous fait, qu’attendiez-vous et que s’est-il passé ?';

  @override
  String get feedbackInfo => 'Informations jointes';

  @override
  String get feedbackPrivacy =>
      'Les détails de l’appareil sont inclus. Les discussions et journaux ne sont pas envoyés automatiquement.';

  @override
  String get feedbackVersion => 'Version de l’app';

  @override
  String get feedbackModel => 'Modèle de l’appareil';

  @override
  String get feedbackSystem => 'Système d’exploitation';

  @override
  String get feedbackUnknown => 'Indisponible';

  @override
  String get feedbackLoading => 'Lecture des informations de l’appareil…';

  @override
  String get feedbackSend => 'Envoyer';

  @override
  String get feedbackFailed =>
      'Échec de l’envoi. Votre texte est conservé. Vérifiez la connexion et réessayez.';

  @override
  String get feedbackEmpty => 'Veuillez d’abord décrire votre retour.';

  @override
  String get feedbackSending => 'Envoi…';

  @override
  String get feedbackSubmitNote =>
      'Votre description et ces informations seront enregistrées pour nous aider à améliorer l’app.';

  @override
  String get feedbackSuccess => 'Retour reçu. Merci pour votre aide.';

  @override
  String get feedbackReference => 'Numéro de référence';

  @override
  String get feedbackDone => 'Terminé';

  @override
  String get workbenchStoppingTask => 'Arrêt en cours…';

  @override
  String get workbenchStopUnconfirmed =>
      'L’arrêt n’a pas encore été confirmé. Réessayez.';

  @override
  String get workbenchPreparingImages => 'Préparation des images…';

  @override
  String get workbenchImagePickFailed =>
      'Impossible d’ouvrir les photos. Réessayez.';

  @override
  String get feedbackImages => 'Images';

  @override
  String get feedbackOptional => 'Facultatif';

  @override
  String get feedbackImageLimit => 'Vous pouvez ajouter 3 images maximum.';

  @override
  String get feedbackImageFailed =>
      'Impossible d’ajouter cette image. Réessayez avec une autre.';

  @override
  String get feedbackImagePreview => 'Aperçu';

  @override
  String get feedbackRemoveImage => 'Supprimer l’image';

  @override
  String get feedbackPreparingImages => 'Préparation des images…';

  @override
  String get feedbackAddImage => 'Ajouter des images';

  @override
  String get feedbackImagesHint =>
      'Ajoutez des captures pour nous aider à comprendre.';

  @override
  String get feedbackContact => 'Coordonnées';

  @override
  String get feedbackEmail => 'E-mail';

  @override
  String get feedbackEmailHint => 'E-mail du compte ; modifiable ou effaçable';

  @override
  String get feedbackWechat => 'Identifiant WeChat';

  @override
  String get feedbackWechatHint => 'Votre identifiant WeChat';

  @override
  String get feedbackContactHint =>
      'Uniquement pour répondre à ce retour. Les deux champs sont facultatifs.';

  @override
  String get feedbackEmailInvalid =>
      'Saisissez un e-mail valide ou laissez ce champ vide.';

  @override
  String get deviceAgents => 'Agents';

  @override
  String get deviceAgentReady => 'Connecté';

  @override
  String get deviceAgentRunning => 'En cours';

  @override
  String get deviceAgentNotInstalled => 'Non installé';

  @override
  String get deviceAgentUnavailable => 'Indisponible';

  @override
  String get deviceAgentNotEnabled => 'Non activé';

  @override
  String get deviceAgentUnknown => 'Non signalé';

  @override
  String get deviceAgentOffline =>
      'Ordinateur hors ligne · Dernier état signalé';

  @override
  String get openingTitle => 'À distance, toujours connecté.';

  @override
  String get openingSubtitle =>
      'Reprenez le travail de votre IA sur ordinateur, où que vous soyez.';

  @override
  String get openingSkip => 'Passer l’animation';

  @override
  String get deviceQuota => 'Limites de l’abonnement';

  @override
  String get quotaFiveHour => '5 heures';

  @override
  String get quotaSevenDay => '7 jours';

  @override
  String quotaUsed(String percent) {
    return '$percent% utilisé';
  }

  @override
  String quotaResets(String time) {
    return 'Réinitialisation : $time';
  }

  @override
  String quotaUpdated(String time) {
    return 'Mis à jour : $time';
  }

  @override
  String get quotaPending => 'Non communiqué';

  @override
  String get quotaExpired => 'En attente des nouveaux quotas';

  @override
  String get quotaLimitReached => 'Limite atteinte';

  @override
  String get quotaSnapshot => 'Dernier relevé';

  @override
  String get quotaClaudeHint =>
      'Claude transmet les quotas pendant les sessions. Les valeurs absentes ne sont pas estimées.';

  @override
  String get settingsHapticsTitle => 'Retour haptique';

  @override
  String get settingsHapticsSubtitle =>
      'Une légère vibration confirme une connexion ou une décision.';

  @override
  String get workbenchBackToLatest => 'Revenir aux derniers messages';

  @override
  String get settingsFontSize => 'Taille du texte';

  @override
  String get settingsFontSizeSmall => 'Petite';

  @override
  String get settingsFontSizeMedium => 'Moyenne';

  @override
  String get settingsFontSizeLarge => 'Grande';

  @override
  String get settingsFontSizeSaveFailed =>
      'La taille du texte a changé, mais n’a pas pu être enregistrée. Réessayez.';

  @override
  String get workbenchAgentOrderHint =>
      'Appuyez longuement, puis faites glisser pour modifier l’ordre';

  @override
  String get workbenchAgentOrderSaveFailed =>
      'L’ordre a été modifié, mais n’a pas pu être enregistré. Veuillez réessayer.';

  @override
  String get settingsBuildInfo => 'Informations de version';

  @override
  String get buildTime => 'Date de compilation';

  @override
  String get buildSourceCommit => 'Commit source';

  @override
  String get buildUnrecorded => 'Non renseigné';

  @override
  String get buildUncommitted => 'Contient des modifications non validées';

  @override
  String get agentTasksTitle => 'Sous-tâches';

  @override
  String agentTasksCount(int count) {
    return '$count sous-tâches';
  }

  @override
  String agentTasksViewAll(int count) {
    return 'Voir les $count sous-tâches';
  }

  @override
  String agentTasksRunning(int count) {
    return '$count en cours';
  }

  @override
  String agentTasksFinished(int count) {
    return '$count terminées';
  }

  @override
  String get agentTasksAttention => 'Votre attention est requise';

  @override
  String get agentTasksInProgress => 'En cours';

  @override
  String get agentTasksEnded => 'Terminées';

  @override
  String get agentTaskPreparing => 'Préparation';

  @override
  String get agentTaskUnknown => 'État en attente de synchronisation';

  @override
  String get agentTaskCompleted => 'Terminée';

  @override
  String get agentTaskFailed => 'Échec';

  @override
  String get agentTaskStopped => 'Arrêtée';

  @override
  String get agentTaskAnswer => 'En attente de votre réponse';

  @override
  String get agentTaskApprove => 'En attente de votre approbation';

  @override
  String get agentTaskNoResult => 'Aucun résultat reçu pour le moment';

  @override
  String get agentTaskInstructions => 'Instructions de la tâche';

  @override
  String get agentTaskRuntime => 'Informations d’exécution';

  @override
  String agentTaskParent(String name) {
    return 'Depuis : $name';
  }

  @override
  String agentTaskUpdated(String time) {
    return 'Mis à jour $time';
  }

  @override
  String get agentTaskOffline => 'Ordinateur hors ligne · dernier état connu';

  @override
  String get agentTaskOpenConversation =>
      'Ouvrir la conversation de la sous-tâche';

  @override
  String get agentTaskEmpty => 'Aucune sous-tâche pour le moment';

  @override
  String get agentTaskFinishedResult => 'Résultat';

  @override
  String get liveTaskRunning => 'En cours';

  @override
  String get liveTaskApproval => 'Approbation requise';

  @override
  String get liveTaskQuestion => 'Réponse requise';

  @override
  String get liveTaskCompleted => 'Terminée';

  @override
  String get liveTaskFailed => 'Échec de la tâche';

  @override
  String get liveTaskStopped => 'Arrêtée';

  @override
  String get liveTaskStale => 'Vérifier le statut';

  @override
  String get liveTaskOpen => 'Voir la tâche';

  @override
  String get liveTaskReview => 'Examiner';

  @override
  String get liveTaskElapsed => 'Temps écoulé';

  @override
  String get liveTaskUpdated => 'Dernière synchro';

  @override
  String get androidPushDisclosure =>
      'Enable background alerts with JPush and, on supported devices, vivo Push. They process a push identifier, Android ID, device/system and network information for delivery. Task content and encryption keys are not sent to these providers. You can turn alerts off in system settings.';

  @override
  String get controllerSessionUnavailable =>
      'Cette conversation est indisponible sur l’ordinateur connecté. Vérifiez que son Agent fonctionne et que la conversation existe toujours, puis réessayez ou démarrez une nouvelle conversation.';

  @override
  String get settingsSidebarAgents => 'Agents de la barre latérale';

  @override
  String get settingsSidebarAgentsSubtitle =>
      'Choisissez les agents à afficher dans la barre latérale';

  @override
  String get turnStatusRunning => 'Traitement';

  @override
  String get turnStatusCompleted => 'Tour terminé';

  @override
  String get turnStatusInterrupted => 'Ce tour ne s’est pas terminé';

  @override
  String get turnStatusUnknown => 'Journal d’activité';

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
  String get localWebForward => 'Page suivante';

  @override
  String get localWebAddress => 'Adresse de la page';

  @override
  String get localWebLoading => 'Connexion à votre ordinateur…';

  @override
  String get accountDeletionTitle => 'Supprimer le compte';

  @override
  String get accountDeletionBody =>
      'Votre compte Relayune, ses autorisations, préférences et commentaires seront définitivement supprimés. Vos appareils perdront leur accès et les clés du cache de ce téléphone seront effacées. Les projets et fichiers des agents sur vos ordinateurs sont conservés.';

  @override
  String get accountDeletionPassword => 'Confirmez votre mot de passe';

  @override
  String get accountDeletionConfirm => 'Supprimer définitivement mon compte';

  @override
  String get accountDeletionBusy => 'Suppression…';

  @override
  String get accountDeletionWrongPassword =>
      'Mot de passe incorrect. Réessayez.';

  @override
  String get accountDeletionFailed =>
      'La suppression a échoué. Vérifiez votre connexion et réessayez. Si elle a commencé, les autres accès restent désactivés jusqu’à la fin du nettoyage.';

  @override
  String get accountDeletionDone => 'Votre compte a été supprimé.';

  @override
  String get controllerPendingInputSaveFailed =>
      'Votre message n’a pas pu être enregistré sur ce téléphone. Libérez de l’espace et réessayez.';

  @override
  String get workbenchHistoryRequestSending => 'Envoi de la demande';

  @override
  String get workbenchHistoryWaitingComputer =>
      'En attente de votre ordinateur';

  @override
  String get workbenchHistoryReadingComputer =>
      'Lecture de l’historique sur votre ordinateur';

  @override
  String get workbenchHistoryPreparing => 'Préparation des messages';

  @override
  String workbenchHistoryElapsed(int seconds) {
    return 'Temps écoulé : $seconds s';
  }

  @override
  String get workbenchHistoryTransferring => 'Transfert de l’historique';

  @override
  String workbenchHistorySourceRead(String read, String total) {
    return 'L’ordinateur a lu $read / $total';
  }

  @override
  String workbenchHistoryPendingTransfer(String size) {
    return 'Page à transférer : $size';
  }

  @override
  String workbenchHistoryReceived(String size) {
    return 'Reçu : $size';
  }

  @override
  String workbenchHistoryPendingReceive(String size) {
    return 'À recevoir : $size';
  }

  @override
  String get workbenchHistoryReadingCache =>
      'Lecture de l’historique enregistré sur ce téléphone';

  @override
  String get localWebResources => 'Ressources de la page';

  @override
  String get localWebGettingPage => 'Récupération de la page…';

  @override
  String get localWebLoadingPage => 'Chargement de la page…';

  @override
  String localWebResourceSummary(int completed, int active) {
    return '$completed reçues · $active en cours';
  }

  @override
  String localWebResourceFailures(int count) {
    return '$count en échec';
  }

  @override
  String get localWebResourceWaiting => 'En attente de réponse';

  @override
  String get localWebResourceReceiving => 'Réception';

  @override
  String get localWebResourcePreparing => 'Préparation';

  @override
  String get localWebResourceComplete => 'Reçue';

  @override
  String get localWebResourceFailed => 'Échec';

  @override
  String get localWebResourceCancelled => 'Arrêtée';

  @override
  String get localWebResourceTransferNote =>
      'La progression mesure la réception de la réponse. La page peut demander davantage de ressources.';

  @override
  String get localWebResourceEmpty =>
      'Les ressources demandées par cette page apparaîtront ici.';

  @override
  String localWebResourceRecent(int count) {
    return 'Les $count dernières ressources sont affichées';
  }

  @override
  String localWebElapsed(String seconds) {
    return '$seconds s';
  }

  @override
  String get localWebOpeningTitle => 'Une page de votre ordinateur';

  @override
  String get localWebOpeningHint =>
      'Laissez votre ordinateur et le service web actifs. La page apparaîtra automatiquement.';

  @override
  String get replyBranchLabel => 'Créer une branche dans un nouveau chat';

  @override
  String get replyBranchSameDirectory => 'Utiliser le dossier du projet actuel';

  @override
  String get replyBranchSameDirectoryDescription =>
      'Continuer à partager les fichiers du projet';

  @override
  String get replyBranchWorktree => 'Créer un nouveau worktree';

  @override
  String get replyBranchWorktreeDescription =>
      'Dossier distinct, basé sur le commit actuel';

  @override
  String get controllerReplyBranchOffline =>
      'Connectez votre ordinateur pour créer une branche';

  @override
  String get controllerReplyBranchCreating => 'Création du nouveau chat…';

  @override
  String get controllerReplyBranchCreated =>
      'Nouvelle branche créée dans le dossier du projet actuel.';

  @override
  String get controllerReplyBranchFailed =>
      'Impossible de créer le nouveau chat. Réessayez.';

  @override
  String get controllerReplyBranchUnconfirmed =>
      'Le résultat est encore incertain. Restez connecté et réessayez pour vérifier.';

  @override
  String get controllerReplyBranchUnavailable =>
      'Cette réponse ne peut pas être dérivée. Actualisez la conversation.';

  @override
  String get controllerReplyBranchBusy =>
      'Une autre opération de chat est en cours. Réessayez dans un instant.';

  @override
  String get controllerReplyBranchWorktreeFailed =>
      'Impossible de créer le worktree. Vérifiez le projet sur votre ordinateur, puis réessayez.';

  @override
  String get controllerReplyBranchWorktreeCreated =>
      'Nouvelle branche créée dans un worktree distinct.';

  @override
  String agentTasksCompletedCount(int count) {
    return '$count terminées';
  }

  @override
  String agentTasksStoppedCount(int count) {
    return '$count arrêtées';
  }

  @override
  String agentTasksFailedCount(int count) {
    return '$count échouées';
  }

  @override
  String agentTasksPreparingCount(int count) {
    return '$count en préparation';
  }

  @override
  String agentTasksUnknownCount(int count) {
    return '$count en attente de synchronisation';
  }

  @override
  String get agentTasksSearch => 'Rechercher des tâches, noms ou modèles';

  @override
  String get agentTasksNoMatches => 'Aucune sous-tâche correspondante';

  @override
  String get agentTaskModelConfiguration => 'Configuration du modèle';
}
