// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get workbenchContinueUnconfirmed =>
      'Continue has not been confirmed yet. Please retry shortly.';

  @override
  String get workbenchContinueExpired =>
      'The continue request has expired. Check the session before retrying.';

  @override
  String get workbenchContinueSession => 'Continue';

  @override
  String get workbenchContinuingSession => 'Continuing…';

  @override
  String get workbenchStateAnswered => 'Answered';

  @override
  String get workbenchTurnIncomplete => 'This run did not complete';

  @override
  String get controllerQueueUnconfirmed =>
      'Message processing status is unconfirmed. Refresh the conversation to check.';

  @override
  String get homeGreetingMorning => 'Good morning';

  @override
  String get homeGreetingNoon => 'Good afternoon';

  @override
  String get homeGreetingAfternoon => 'Good afternoon';

  @override
  String get homeGreetingEvening => 'Good evening';

  @override
  String get homeGreetingNight => 'A quiet night';

  @override
  String get homeCareLongBreak =>
      'You’ve focused a while. Take a longer break if you’d like.';

  @override
  String get homeCarePause =>
      'A sip of water, a look outside. A moment for you.';

  @override
  String get homeCareNightWorking =>
      'Still working? Leave a little room for rest tonight.';

  @override
  String get homeCareNightQuiet => 'It’s okay to leave a little for tomorrow.';

  @override
  String get homeCareBusyDay =>
      'You’ve been here a while. Save some time for yourself, too.';

  @override
  String get homeCareDecision => 'Take your time with this decision.';

  @override
  String get homeCareLongWait =>
      'A long wait. A little time to look after yourself.';

  @override
  String get homeCareWelcomeBack => 'Welcome back. Find your own pace.';

  @override
  String get homeCareFirstIdea => 'Start with an idea, whenever you’re ready.';

  @override
  String get homeCareMeal =>
      'Haven’t eaten yet? Make a little time for a meal.';

  @override
  String get homeCareEasterEgg =>
      'Secret achievement: self-care. No progress bar needed.';

  @override
  String get homeCareWeekend =>
      'A weekend at your pace, with a little room to spare.';

  @override
  String get homeCareDailyProgress =>
      'Here’s to a little progress and a little breathing room.';

  @override
  String get homeCareDailySpace => 'Ideas need space. So do you.';

  @override
  String get homeCareDailyPace =>
      'One thing at a time, with a little room for yourself.';

  @override
  String get workbenchReturnHome => 'Return home';

  @override
  String get workbenchVisualization => 'Visualization';

  @override
  String get workbenchVisualizationUnavailable =>
      'This visualization is not available yet.';

  @override
  String get workbenchDesktopVersionUnknown => 'Version unknown';

  @override
  String get appTitle => 'Relayune';

  @override
  String get commonBack => 'Back';

  @override
  String get commonCancel => 'Cancel';

  @override
  String get commonClose => 'Close';

  @override
  String get commonContinue => 'Continue';

  @override
  String get commonRetry => 'Try again';

  @override
  String get commonSave => 'Save';

  @override
  String get commonSubmit => 'Submit';

  @override
  String get commonSettings => 'Settings';

  @override
  String get commonLogOut => 'Log out';

  @override
  String get commonReject => 'Reject';

  @override
  String get commonAllow => 'Allow';

  @override
  String get unavailableTitle => 'Relayune is temporarily unavailable';

  @override
  String get clearLoginSession => 'Clear login session';

  @override
  String get updateInstallerUnavailable =>
      'Unable to open the system installer. Please try again later.';

  @override
  String get updateReadyTitle => 'Update ready';

  @override
  String updateDownloaded(String version) {
    return 'Relayune $version was securely downloaded and verified in the background.';
  }

  @override
  String get updateLater => 'Later';

  @override
  String get updateInstall => 'Install update';

  @override
  String get authSecurityBadge => 'End-to-end encrypted workspace';

  @override
  String get authEmailTitle => 'Continue your computer tasks from your phone';

  @override
  String get authPasswordTitle => 'Sign in or create an account';

  @override
  String get authVerificationTitle => 'Check your email';

  @override
  String get authEmailSubtitle =>
      'After signing in, use the 8-character code shown on desktop to create an end-to-end encrypted connection.';

  @override
  String get authPasswordSubtitle =>
      'Sign in with your password, or verify your email first if this is your first time.';

  @override
  String get authVerificationSubtitle =>
      'The verification link can be used once and expires shortly.';

  @override
  String get authEmailLabel => 'Email';

  @override
  String get authInvalidEmail => 'Enter a valid email address.';

  @override
  String get authContinue => 'Continue';

  @override
  String get authChangeEmail => 'Change email';

  @override
  String get authPasswordLabel => 'Password';

  @override
  String get authShowPassword => 'Show password';

  @override
  String get authHidePassword => 'Hide password';

  @override
  String get authPasswordRequired => 'Enter your password.';

  @override
  String get authSignIn => 'Sign in';

  @override
  String get authVerifyEmailAction =>
      'First time or forgot your password? Verify email';

  @override
  String get authVerificationInstructions =>
      'Open the verification email and set a password on the secure web page. Then return here to continue.';

  @override
  String get authPasswordSet => 'I set my password';

  @override
  String get authResendEmail => 'Resend email';

  @override
  String get authSecurityNote =>
      'The server only routes ciphertext. Your connection code and content keys are never uploaded.';

  @override
  String get pairingExit => 'Exit';

  @override
  String get pairingTitle => 'Scan to connect your computer';

  @override
  String get pairingSubtitle => 'Take your work with you.';

  @override
  String get pairingEnterCodeTitle => 'Or enter the 8-character code';

  @override
  String get pairingEnterCodeHelp =>
      'Enter the connection code shown on your computer.';

  @override
  String get pairingSearching =>
      'Looking for computers waiting to connect to your account…';

  @override
  String get pairingComputerLabel => 'Computer to connect';

  @override
  String pairingWillConnect(String device) {
    return 'Connecting to: $device';
  }

  @override
  String get pairingStartOnDesktop =>
      'First choose “Connect new client” on desktop, then enter the new code.';

  @override
  String get pairingSearchAgain => 'Search again';

  @override
  String get pairingCodeLabel => '8-character connection code';

  @override
  String get pairingSecureConnect => 'Connect securely';

  @override
  String get pairingScanTitle => 'Where is the QR code?';

  @override
  String get pairingScanHelp =>
      'Open Relayune on your computer and select “Connect new client”.\nScan the QR code in that window.';

  @override
  String get pairingOpenCamera => 'Scan to connect';

  @override
  String get pairingPrivacyNote =>
      'End-to-end encrypted. Only your devices can read your sessions.';

  @override
  String pairingMinimumDesktop(String version) {
    return 'Minimum compatible desktop version: $version';
  }

  @override
  String get pairingDeriving => 'Verifying connection…';

  @override
  String get pairingWaitingDesktop => 'Waiting for computer confirmation…';

  @override
  String get pairingActivating => 'Creating encrypted channel…';

  @override
  String get pairingDerivingDetail =>
      'Creating the SPAKE2 responder share and an independent content key on this device.';

  @override
  String get pairingWaitingDesktopDetail =>
      'Keep Relayune open on your computer.';

  @override
  String get pairingActivatingDetail =>
      'Verifying the first encrypted session catalog.';

  @override
  String get scannerTitle => 'Scan the connection QR code on your computer';

  @override
  String get scannerResume => 'Resume scanning';

  @override
  String get scannerInvalid =>
      'This is not a Relayune connection QR code. Scan the current code shown on desktop.';

  @override
  String get scannerHelp =>
      'Place the QR code shown by Relayune on your computer inside the frame. An end-to-end encrypted connection starts after recognition.';

  @override
  String get scannerUnavailable =>
      'The camera is unavailable. Allow Relayune to use the camera in system settings, or return and connect manually.';

  @override
  String get settingsTitle => 'Settings';

  @override
  String get settingsSignedInAccount => 'Signed-in account';

  @override
  String get settingsAccountSection => 'Account';

  @override
  String get settingsPreferencesSection => 'Preferences';

  @override
  String get settingsHelpLegalSection => 'Support & legal';

  @override
  String get settingsLanguage => 'Language';

  @override
  String get settingsLanguageSystemDefault => 'Default (system language)';

  @override
  String settingsLanguageSystemDefaultValue(String language) {
    return 'Default · $language';
  }

  @override
  String get settingsLanguageSaveFailed =>
      'The language changed, but the preference could not be saved.';

  @override
  String get settingsReleaseNotes => 'Release notes';

  @override
  String get settingsSupport => 'Support';

  @override
  String get settingsTerms => 'Terms of Service';

  @override
  String get settingsPrivacy => 'Privacy Policy';

  @override
  String get settingsLegalLanguage => 'English';

  @override
  String get settingsOpenLinkFailed =>
      'Unable to open this link. Please try again.';

  @override
  String get releaseTitle => 'Release notes';

  @override
  String get releaseLoading => 'Loading release notes';

  @override
  String get releaseErrorTitle => 'Release notes unavailable';

  @override
  String get releaseErrorMessage => 'Check your connection and try again.';

  @override
  String get releaseEmptyTitle => 'No release notes yet';

  @override
  String get releaseEmptyMessage => 'Future updates will appear here.';

  @override
  String get releaseVersion => 'Version';

  @override
  String get releaseWeb => 'Web';

  @override
  String get releaseServer => 'Server';

  @override
  String get notificationEnabledTitle => 'Task notifications are on';

  @override
  String get notificationPrimerTitle =>
      'Your task runs on the computer, so you do not have to keep watching';

  @override
  String get notificationEnabledBody =>
      'Relayune alerts you when a task needs attention or the main task finishes.';

  @override
  String get notificationPrimerBody =>
      'Handle approvals and questions promptly, then see the task name and reply summary when it finishes.';

  @override
  String get notificationBenefitAction =>
      'Needs attention: quickly allow, reject, or open an answer from a notification';

  @override
  String get notificationBenefitCompletion =>
      'Task complete: preview the reply summary before opening it';

  @override
  String get notificationBenefitPrivacy =>
      'Notifications never show commands, file paths, connection codes, or keys';

  @override
  String get notificationPermissionRejected =>
      'System notifications are still off. You can allow Relayune notifications in system settings.';

  @override
  String get notificationGotIt => 'Got it';

  @override
  String get notificationOpenSettings => 'Open system settings';

  @override
  String get notificationEnable => 'Enable task notifications';

  @override
  String get notificationNotNow => 'Not now';

  @override
  String get notificationSemanticsExample =>
      'Notification examples: approval needs attention, a question needs an answer, and a Claude task completed with a reply summary';

  @override
  String get notificationNow => 'Now';

  @override
  String get notificationSampleTask => 'Improve mobile notifications';

  @override
  String get notificationSampleBody =>
      'Notification permission guidance and a task-completion summary are ready…';

  @override
  String get notificationApprovalTitle => 'Operation awaiting confirmation';

  @override
  String get notificationQuestionTitle => 'Your answer is needed';

  @override
  String notificationTaskPaused(String provider) {
    return '$provider · task paused';
  }

  @override
  String notificationApprovalBody(int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      minutes,
      locale: localeName,
      other: '$minutes minutes',
      one: '1 minute',
    );
    return 'Allow or reject this operation within $_temp0.';
  }

  @override
  String notificationQuestionBody(int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      minutes,
      locale: localeName,
      other: '$minutes minutes',
      one: '1 minute',
    );
    return 'Answer within $_temp0. The task continues after you submit.';
  }

  @override
  String notificationTaskCompleted(String provider) {
    return '$provider task completed';
  }

  @override
  String get notificationMainTask => 'Main task';

  @override
  String get notificationMainResultReady =>
      'The main task result is ready. Tap to view.';

  @override
  String notificationNamedResultReady(String name) {
    return 'The result for “$name” is ready. Tap to view.';
  }

  @override
  String get notificationAllowOnce => 'Allow once';

  @override
  String get notificationAnswer => 'Answer';

  @override
  String get notificationChannelAttention => 'Needs attention';

  @override
  String get notificationChannelCompleted => 'Task completed';

  @override
  String get notificationChannelAttentionDescription =>
      'Relayune approval and question alerts';

  @override
  String get notificationChannelCompletedDescription =>
      'Relayune main-task completion alerts';

  @override
  String get notificationRedactedLink => '[link]';

  @override
  String get notificationRedactedPath => '[path]';

  @override
  String get notificationRedactedSecret => '[hidden]';

  @override
  String get workbenchTitle => 'Workspace';

  @override
  String get workbenchDevice => 'Device';

  @override
  String get workbenchOpenNavigation => 'Open navigation';

  @override
  String workbenchPendingApprovals(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count approvals pending',
      one: '1 approval pending',
    );
    return '$_temp0';
  }

  @override
  String get workbenchSessions => 'Sessions';

  @override
  String get workbenchOnline => 'Online';

  @override
  String get workbenchOffline => 'Offline';

  @override
  String get workbenchDeviceOnlineRealtime => 'Computer online · realtime sync';

  @override
  String get workbenchDeviceOfflineQueued =>
      'Computer offline · cached records only';

  @override
  String get workbenchDeviceOnlineReconnecting =>
      'Computer online · restoring realtime connection';

  @override
  String get workbenchDeviceOfflineReconnecting =>
      'Computer offline · restoring realtime connection';

  @override
  String get workbenchDeviceOnlineWaiting =>
      'Computer online · waiting for realtime connection';

  @override
  String get workbenchDeviceOfflineWaiting =>
      'Computer offline · waiting for realtime connection';

  @override
  String get workbenchProjectsSessions => 'Projects & sessions';

  @override
  String get workbenchNoSessionsSynced =>
      'No sessions have synced from the computer';

  @override
  String get workbenchSignedInAccount => 'Signed-in account';

  @override
  String get workbenchNotSignedIn => 'Not signed in';

  @override
  String get workbenchNewSession => 'New session';

  @override
  String get workbenchDefaultSessionName => 'New remote session';

  @override
  String get workbenchHistoryFailed =>
      'History could not be loaded; current content may be incomplete';

  @override
  String get workbenchLoadEarlier => 'Load earlier messages';

  @override
  String get workbenchSendFirst => 'Send your first instruction to begin';

  @override
  String get workbenchAtBeginning => 'This is the first message';

  @override
  String get workbenchAddAttachment => 'Add attachment';

  @override
  String workbenchRemoveAttachment(String name) {
    return 'Remove $name';
  }

  @override
  String get workbenchReadOnly => 'This session is read-only';

  @override
  String get workbenchOfflineQueued => 'Computer offline · sending unavailable';

  @override
  String get workbenchSteerPlaceholder =>
      'Send a new instruction to stop and continue…';

  @override
  String get workbenchSendPlaceholder => 'Send instructions to your computer…';

  @override
  String get workbenchStopTask => 'Stop task';

  @override
  String get workbenchSending => 'Sending';

  @override
  String get workbenchSend => 'Send';

  @override
  String get workbenchYou => 'You';

  @override
  String get workbenchLocalActivity => 'Local activity';

  @override
  String get workbenchToday => 'Today';

  @override
  String get workbenchYesterday => 'Yesterday';

  @override
  String get workbenchDayBeforeYesterday => 'The day before yesterday';

  @override
  String get workbenchSystemNotice => 'System notice';

  @override
  String workbenchApprovalSource(String name) {
    return 'Source: $name';
  }

  @override
  String workbenchApprovalDirectory(String path) {
    return 'Directory: $path';
  }

  @override
  String get workbenchApprovalPermission =>
      'Request permission for a local operation';

  @override
  String get workbenchSelect => 'Select';

  @override
  String get workbenchOtherAnswer => 'Other answer…';

  @override
  String get workbenchSkipAnswer => 'Not now';

  @override
  String get workbenchHighRiskTitle => 'Allow a high-risk operation?';

  @override
  String get workbenchOperationOnComputer =>
      'This operation will run on your computer.';

  @override
  String get workbenchConfirmAllow => 'Confirm and allow';

  @override
  String get workbenchAnswerLabel => 'Answer';

  @override
  String get workbenchAllowOnce => 'Allow once';

  @override
  String get workbenchAlwaysAllowSession => 'Always allow in this session';

  @override
  String get workbenchAllowAndRemember => 'Allow and remember this rule';

  @override
  String get workbenchAlwaysRejectSession => 'Always reject in this session';

  @override
  String get workbenchRejectAndRemember => 'Reject and remember this rule';

  @override
  String get workbenchSaveDecisionTitle => 'Save this decision?';

  @override
  String get workbenchSaveDecisionMessage =>
      'Codex may reuse this decision for matching operations instead of asking every time.';

  @override
  String get workbenchConfirm => 'Confirm';

  @override
  String get workbenchRejectAndStop => 'Reject and stop the current task';

  @override
  String get workbenchNotificationSettings => 'Task notifications';

  @override
  String get workbenchConnectAnother => 'Connect another computer';

  @override
  String get workbenchConnectAnotherSubtitle =>
      'Delete the current content key and device authorization from this phone';

  @override
  String get workbenchConnectAnotherTitle => 'Connect another computer?';

  @override
  String get workbenchConnectAnotherMessage =>
      'The current content key and phone authorization token will be deleted from this device\'s secure credential store. Data on the server and computer will not be deleted.';

  @override
  String get workbenchNoSessions => 'No sessions available';

  @override
  String get workbenchNoSessionsHelp =>
      'Keep desktop online, or create a new session in a project directory on your computer.';

  @override
  String get workbenchHistoryLoading => 'Loading message history';

  @override
  String get workbenchHistoryLoadingOlder => 'Loading earlier messages…';

  @override
  String get workbenchHistoryLimit =>
      'History loads after you open a session, up to 500 messages at a time';

  @override
  String get workbenchFilePreviewRetry =>
      'File preview failed. Please try again.';

  @override
  String get workbenchSecureFileReading =>
      'Securely reading from your computer…';

  @override
  String get workbenchFileUnavailable =>
      'The file has expired or was removed from the computer.';

  @override
  String get workbenchApprovalCommand => 'Run command';

  @override
  String get workbenchApprovalFileChange => 'Change file';

  @override
  String get workbenchApprovalChoice => 'Your choice is needed';

  @override
  String get workbenchApprovalTool => 'Run local tool';

  @override
  String get workbenchStatePending => 'Pending';

  @override
  String get workbenchStateDeciding => 'Sending';

  @override
  String get workbenchStateApproved => 'Approved';

  @override
  String get workbenchStateRejected => 'Rejected';

  @override
  String get workbenchStateExpired => 'Expired';

  @override
  String get workbenchLocalRelay => 'Local Relay';

  @override
  String get workbenchEncryptionProtocol => 'Encryption protocol';

  @override
  String get workbenchPairingProtocol => 'Pairing protocol';

  @override
  String get workbenchRealtimeChannel => 'Realtime channel';

  @override
  String get workbenchTechnicalDetails => 'Technical details';

  @override
  String get workbenchRealtimeConnection => 'Realtime connection';

  @override
  String get workbenchHeartbeatPath => 'iPhone ↔ Server · WebSocket';

  @override
  String get workbenchHeartbeatHealthy => 'Heartbeat healthy';

  @override
  String get workbenchHeartbeatWaiting => 'Waiting for heartbeat';

  @override
  String get workbenchLastHeartbeat => 'Last heartbeat';

  @override
  String get workbenchRoundTrip => 'Round trip';

  @override
  String get workbenchWebSocketHeartbeat => 'WebSocket heartbeat';

  @override
  String get workbenchDesktopHeartbeat => 'Computer heartbeat';

  @override
  String get workbenchJustNow => 'Just now';

  @override
  String workbenchSecondsAgo(int seconds) {
    return '${seconds}s ago';
  }

  @override
  String workbenchMinutesAgo(int minutes) {
    return '${minutes}m ago';
  }

  @override
  String get workbenchStateVersion => 'State version';

  @override
  String get workbenchAwaitingConfirmation => 'Awaiting confirmation';

  @override
  String get workbenchLastConfirmed => 'Last confirmed';

  @override
  String get workbenchEventAck => 'Event acknowledgement';

  @override
  String get workbenchOfflineQueue => 'Offline queue';

  @override
  String get workbenchSecurityBoundary => 'End-to-end encryption boundary';

  @override
  String get workbenchPhonePlaintextEndpoint =>
      'The phone is an application-plaintext endpoint';

  @override
  String get workbenchServerCiphertextOnly =>
      'The server stores only authenticated ciphertext envelopes';

  @override
  String get workbenchKeyInSecureStorage =>
      'Content keys are stored in the system secure credential store';

  @override
  String get workbenchCodeNeverUploaded =>
      'The 8-character connection code is never uploaded';

  @override
  String get workbenchNotConfirmed => 'Not confirmed yet';

  @override
  String get workbenchRealtimeConnected => 'WebSocket connected';

  @override
  String get workbenchRealtimeConnecting => 'Connecting';

  @override
  String get workbenchRealtimeReconnecting => 'Reconnecting';

  @override
  String get workbenchRealtimeIdle => 'Waiting to connect';

  @override
  String workbenchNotificationStatus(String status) {
    return '$status · notifications work while the app\'s background connection remains alive; delivery is not guaranteed after the system terminates it';
  }

  @override
  String get workbenchNotificationAllowed => 'Allowed';

  @override
  String get workbenchNotificationDisabled => 'Off';

  @override
  String get workbenchNotificationUnknown => 'Unknown';

  @override
  String get workbenchClose => 'Close';

  @override
  String get workbenchProjectConfiguration => 'Project settings';

  @override
  String get workbenchProjectConfigurationTitle => 'Project settings';

  @override
  String get workbenchProjectName => 'Project name';

  @override
  String get workbenchProjectNameHelp =>
      'This changes only the name shown in this app. It does not rename the folder on your computer.';

  @override
  String get workbenchFullPath => 'Full path';

  @override
  String get workbenchProjectPathUnavailable =>
      'The computer did not provide a project path';

  @override
  String workbenchSessionCount(int count) {
    return '$count sessions';
  }

  @override
  String workbenchMoreSessions(int count) {
    return 'Show more sessions ($count)';
  }

  @override
  String get workbenchAgentRunning => 'Agent running';

  @override
  String get workbenchAgentNotRunning => 'Agent not running';

  @override
  String get workbenchRunning => 'Running';

  @override
  String get workbenchKimiSettings => 'Kimi settings';

  @override
  String get workbenchEnableYoloTitle => 'Enable YOLO mode?';

  @override
  String get workbenchEnableAutoTitle => 'Enable Auto mode?';

  @override
  String get workbenchYoloWarning =>
      'Kimi will automatically approve more local tool calls. Enable this only when you trust the current task and project.';

  @override
  String get workbenchAutoWarning =>
      'Kimi will automatically approve routine tool calls, but may still ask you questions.';

  @override
  String get workbenchConfirmEnable => 'Confirm and enable';

  @override
  String get workbenchUploadTooManyImages =>
      'You can add up to 4 images to each message.';

  @override
  String workbenchUploadUnsupportedImages(String names) {
    return '$names are not supported. Choose PNG, JPEG, WebP, GIF, or AVIF.';
  }

  @override
  String get workbenchUploadTooLarge =>
      'Attachments in one message cannot exceed 20 MiB in total.';

  @override
  String workbenchPreviewGenerateFailed(String name) {
    return 'Could not read or generate a preview for $name. Try again.';
  }

  @override
  String get workbenchKimiViewAgents => 'View subagents';

  @override
  String get workbenchKimiViewAgentsDescription =>
      'Open the Agent work window above the composer without starting another model task.';

  @override
  String get workbenchKimiOpenNow => 'Open now';

  @override
  String get workbenchKimiSessionStatus => 'Session status';

  @override
  String get workbenchKimiSessionStatusDescription =>
      'View task, approval, context, and local sync status.';

  @override
  String get workbenchKimiLocalStatus => 'Local status';

  @override
  String get workbenchKimiModel => 'Model';

  @override
  String get workbenchKimiModelDescription =>
      'Change the model used by this Kimi session.';

  @override
  String get workbenchKimiSessionSettings => 'Session settings';

  @override
  String get workbenchKimiPermissionMode => 'Permission mode';

  @override
  String get workbenchKimiPermissionModeDescription =>
      'View or change the local tool approval policy.';

  @override
  String get workbenchKimiSecuritySettings => 'Security settings';

  @override
  String get workbenchKimiPlanMode => 'Plan mode';

  @override
  String get workbenchKimiPlanModeDescription =>
      'Ask Kimi to plan before carrying out the task.';

  @override
  String get workbenchKimiYoloMode => 'YOLO mode';

  @override
  String get workbenchKimiYoloModeDescription =>
      'Automatically approve more tool calls; confirmation is required before enabling.';

  @override
  String get workbenchKimiConfirmationRequired => 'Confirmation required';

  @override
  String get workbenchKimiSettingsDescription =>
      'Open model, Thinking, and permission settings.';

  @override
  String workbenchKimiInputRequired(String hint) {
    return 'Input required: $hint';
  }

  @override
  String get workbenchKimiNativeCommandDescription =>
      'Native Kimi ACP command that runs as a real command task.';

  @override
  String get workbenchKimiNativeCommand => 'Native command';

  @override
  String get workbenchKimiContextSyncing => 'Context waiting to sync';

  @override
  String get workbenchKimiWaitingForSync => 'Waiting to sync';

  @override
  String workbenchKimiContextUsage(int percent, String used, String size) {
    return 'Context $percent% · $used/$size';
  }

  @override
  String workbenchKimiContextUsed(String used) {
    return 'Context $used';
  }

  @override
  String get workbenchKimiContext => 'Context';

  @override
  String get workbenchKimiModelSyncing => 'Model waiting to sync';

  @override
  String get workbenchKimiQuickCommands => 'Quick commands';

  @override
  String get workbenchKimiNoMatchingCommands => 'No matching commands';

  @override
  String get workbenchKimiTask => 'Task';

  @override
  String get workbenchKimiIdle => 'Idle';

  @override
  String get workbenchKimiSubagents => 'Subagents';

  @override
  String workbenchKimiActiveCount(int count) {
    return '$count active';
  }

  @override
  String get workbenchKimiApprovals => 'Approvals';

  @override
  String workbenchKimiPendingCount(int count) {
    return '$count pending';
  }

  @override
  String get workbenchKimiSettingsOffline =>
      'Kimi settings cannot be changed while Relay is offline.';

  @override
  String get workbenchKimiSettingsRunning =>
      'Stop the main Kimi task before changing settings.';

  @override
  String get workbenchKimiNoOptions =>
      'The computer has not synced any configurable options yet.';

  @override
  String get workbenchKimiEncryptedSettings =>
      'Settings are sent end-to-end encrypted to Kimi Code on your computer. The server cannot read them.';

  @override
  String get workbenchKimiManualApproval => 'Manual approval';

  @override
  String get workbenchSessionSettings => 'Session settings';

  @override
  String get workbenchSessionSettingsOffline =>
      'Session settings cannot be changed while Relay is offline.';

  @override
  String get workbenchSessionSettingsRunning =>
      'Stop the current task before changing its settings.';

  @override
  String get workbenchNoConfigOptions =>
      'The computer has not synced any configurable options yet.';

  @override
  String workbenchEncryptedSessionSettings(String provider) {
    return 'Settings are sent end-to-end encrypted to $provider on your computer. The server cannot read them.';
  }

  @override
  String get workbenchUnrestrictedPermissionsTitle => 'Change permission mode?';

  @override
  String get workbenchUnrestrictedPermissionsWarning =>
      'This changes whether local tools are allowed, denied, or require approval. Review the selected mode before continuing.';

  @override
  String get workbenchCoworkCreateOnDesktop =>
      'Create Cowork tasks in Claude Desktop first; existing tasks can be controlled here.';

  @override
  String get workbenchProcessing => 'Processing';

  @override
  String get workbenchProcess => 'Process';

  @override
  String workbenchDurationMinutesSeconds(int minutes, int seconds) {
    return '$minutes min $seconds sec';
  }

  @override
  String workbenchDurationSeconds(int seconds) {
    return '$seconds sec';
  }

  @override
  String workbenchMonthDay(int month, int day) {
    return '$month/$day';
  }

  @override
  String workbenchYearMonthDay(int year, int month, int day) {
    return '$year/$month/$day';
  }

  @override
  String get workbenchImageUrlUnavailable =>
      'The image address is unavailable.';

  @override
  String workbenchFilePreviewAvailable(String kind) {
    return 'Previewable · $kind · up to 1 MB';
  }

  @override
  String get workbenchFilePreviewUnsupported =>
      'This file format cannot be previewed';

  @override
  String workbenchImageReadFailed(String name) {
    return '$name\nCould not read image';
  }

  @override
  String workbenchImageThumbnailLabel(String name) {
    return '$name thumbnail; tap to open the preview';
  }

  @override
  String get workbenchViewOriginal => 'View original';

  @override
  String get workbenchLoadingOriginal => 'Securely loading the original…';

  @override
  String get workbenchOriginalReadFailed =>
      'Could not read the original image. Try again.';

  @override
  String workbenchActivityFailed(String label) {
    return '$label failed';
  }

  @override
  String workbenchActivityCompleted(String label) {
    return '$label completed';
  }

  @override
  String workbenchActivityRunning(String label) {
    return 'Running $label';
  }

  @override
  String get workbenchViewOutput => 'Tap to view output';

  @override
  String get workbenchViewThumbnail => 'Tap to view thumbnail';

  @override
  String get workbenchSemanticSeparator => ', ';

  @override
  String workbenchCommandsRunning(int count) {
    return 'Running $count commands';
  }

  @override
  String workbenchCommandsFailed(int count) {
    return 'Some of $count commands failed';
  }

  @override
  String workbenchCommandsCompleted(int count) {
    return 'Ran $count commands';
  }

  @override
  String workbenchFilesReading(int count) {
    return 'Reading $count files';
  }

  @override
  String workbenchFilesReadFailed(int count) {
    return 'Some of $count files could not be read';
  }

  @override
  String workbenchFilesRead(int count) {
    return 'Read $count files';
  }

  @override
  String workbenchFilesChanging(int count) {
    return 'Changing $count files';
  }

  @override
  String workbenchFilesChangeFailed(int count) {
    return 'Some changes to $count files failed';
  }

  @override
  String workbenchFilesChanged(int count) {
    return 'Changed $count files';
  }

  @override
  String workbenchOperationsRunning(int count) {
    return 'Processing $count file and command operations';
  }

  @override
  String workbenchOperationsFailed(int count) {
    return 'Some of $count file and command operations failed';
  }

  @override
  String workbenchOperationsCompleted(int count) {
    return 'Completed $count file and command operations';
  }

  @override
  String get workbenchToolCommand => 'Run command';

  @override
  String workbenchToolReadFilesSubject(int count, String subject) {
    return 'Read $count files: $subject';
  }

  @override
  String workbenchToolReadFiles(int count) {
    return 'Read $count files';
  }

  @override
  String workbenchToolReadFileSubject(String subject) {
    return 'Read file: $subject';
  }

  @override
  String get workbenchToolReadFile => 'Read file';

  @override
  String workbenchToolChangeFilesSubject(int count, String subject) {
    return 'Change $count files: $subject';
  }

  @override
  String workbenchToolChangeFiles(int count) {
    return 'Change $count files';
  }

  @override
  String workbenchToolChangeFileSubject(String subject) {
    return 'Change file: $subject';
  }

  @override
  String get workbenchToolChangeFile => 'Change file';

  @override
  String workbenchToolCallNamed(String name) {
    return 'Call tool: $name';
  }

  @override
  String get workbenchToolCall => 'Call tool';

  @override
  String workbenchToolWebSearchSubject(String subject) {
    return 'Search the web: $subject';
  }

  @override
  String get workbenchToolWebSearch => 'Search the web';

  @override
  String workbenchToolImageViewSubject(String subject) {
    return 'View image: $subject';
  }

  @override
  String get workbenchToolImageView => 'View image';

  @override
  String get workbenchToolImageGeneration => 'Generate image';

  @override
  String get workbenchToolContextCompaction => 'Compact context automatically';

  @override
  String get workbenchToolWait => 'Wait for task';

  @override
  String get workbenchLocalOperation => 'Local operation';

  @override
  String get workbenchDeliverySent => 'Sent';

  @override
  String get workbenchDeliverySending => 'Sending';

  @override
  String get workbenchDeliveryFailed => 'Send failed';

  @override
  String workbenchAssistantRunningElapsed(String agent, String duration) {
    return '$agent is running; elapsed $duration';
  }

  @override
  String workbenchAssistantRunning(String agent) {
    return '$agent is running';
  }

  @override
  String workbenchAssistantElapsed(String duration) {
    return '· elapsed $duration';
  }

  @override
  String get workbenchCloseFilePreview => 'Close file preview';

  @override
  String workbenchFileReadCompleted(String name) {
    return 'File read complete: $name';
  }

  @override
  String workbenchFileReading(String name) {
    return 'Reading file: $name';
  }

  @override
  String workbenchFileReadFailed(String message) {
    return 'File read failed: $message';
  }

  @override
  String get workbenchFilePreviewFailed => 'File preview failed. Try again.';

  @override
  String get workbenchFileKindTableText => 'Tabular text';

  @override
  String get workbenchFileKindLog => 'Log';

  @override
  String get workbenchFileKindPlainText => 'Plain text';

  @override
  String get workbenchFileKindCodeOrConfig => 'Code or configuration';

  @override
  String workbenchAgentsWorking(int count) {
    return '$count subagents working in parallel';
  }

  @override
  String get workbenchAgentWindow => 'Agent work window';

  @override
  String get workbenchAgentWindowDescription =>
      'Syncs task status and tool activity without showing private reasoning';

  @override
  String workbenchMoreAgents(int count) {
    return '$count more Agents · scroll down to view';
  }

  @override
  String workbenchCurrentActivity(String activity) {
    return 'Current · $activity';
  }

  @override
  String get workbenchAllAgents => 'All Agents';

  @override
  String get workbenchActivityTimeline => 'Activity timeline';

  @override
  String workbenchActivityCount(int count) {
    return '$count entries';
  }

  @override
  String get workbenchAgentSyncing => 'Syncing from this computer…';

  @override
  String get workbenchNoPublicActivity =>
      'No public activity yet. Only task status and tool activity are synced; private model reasoning is not.';

  @override
  String get workbenchLatestResult => 'Latest result';

  @override
  String get workbenchWaitingForTask => 'Waiting for a task';

  @override
  String get controllerRestoreFailed =>
      'Unable to restore the secure connection. Sign in or pair again.';

  @override
  String get controllerAuthorizationRevoked =>
      'Authorization for this phone was revoked. Connect it again.';

  @override
  String get controllerDeviceNotConnected =>
      'This account is not connected to this computer. Start the connection again on the computer.';

  @override
  String get controllerProjectNameRequired => 'Project name is required.';

  @override
  String controllerProjectNameTooLong(int maximum) {
    return 'Project name cannot exceed $maximum characters.';
  }

  @override
  String get controllerProjectNameSaveFailed =>
      'Could not save the project name locally. Try again.';

  @override
  String get controllerProjectNameUpdated => 'Project name updated.';

  @override
  String get controllerNewPairingLinkReceived =>
      'A new connection link was received. Sign out of the current device to connect again.';

  @override
  String get controllerPairingLinkRequired =>
      'Enter the Relayune connection link shown by the desktop app.';

  @override
  String get controllerPairingDiscoveryFailed =>
      'Unable to find computers waiting to connect. Try again later.';

  @override
  String get controllerVerificationResent => 'Verification email sent again.';

  @override
  String get controllerSetPasswordFirst =>
      'Set a password from the email link first, then return here.';

  @override
  String get controllerNoPendingComputer =>
      'No computer is waiting to connect. Select “Connect new client” on the computer first.';

  @override
  String get controllerSelectComputer => 'Select the computer to connect.';

  @override
  String get controllerPairingFailed =>
      'Secure connection failed. Check the connection code and try again.';

  @override
  String get controllerHistoryReadFailed => 'Unable to read history.';

  @override
  String get controllerAgentRefreshFailed =>
      'Unable to refresh this subagent\'s activity right now.';

  @override
  String get controllerAttachmentTooLarge =>
      'Files over 1 MB cannot be previewed yet.';

  @override
  String get controllerAttachmentUnsupported =>
      'This file format cannot be previewed yet.';

  @override
  String get controllerAttachmentGone =>
      'The file expired or was removed from the computer.';

  @override
  String get controllerAttachmentReadFailed => 'Unable to read the attachment.';

  @override
  String controllerUploadTooMany(int maximum) {
    return 'You can upload up to $maximum images per message.';
  }

  @override
  String get controllerUploadTotalTooLarge =>
      'Attachments in one message cannot exceed 20 MiB in total.';

  @override
  String get controllerUploadUnsupported =>
      'Choose PNG, JPEG, WebP, GIF, or AVIF images.';

  @override
  String get controllerSteeringUnsupported =>
      'This task cannot accept more instructions. Stop it first.';

  @override
  String get controllerPreparingAgent =>
      'Received on computer · Preparing Agent';

  @override
  String get controllerWaitingForAgent =>
      'Waiting for the local Agent to receive it';

  @override
  String get controllerWaitingForComputer =>
      'Waiting for the computer to come online';

  @override
  String get controllerStopSent => 'Stop request sent.';

  @override
  String get controllerApprovalExpired => 'This approval has expired.';

  @override
  String get controllerApprovalOffline =>
      'Approvals cannot be handled while the computer is offline.';

  @override
  String get controllerApprovalAllowedSent =>
      'Allow decision sent; waiting for computer confirmation.';

  @override
  String get controllerApprovalRejectedSent =>
      'Reject decision sent; waiting for computer confirmation.';

  @override
  String controllerDelegatedTasks(int count) {
    return 'Delegated $count parallel tasks.';
  }

  @override
  String get controllerSelectProject =>
      'Select a synced project from the sidebar first.';

  @override
  String get controllerCreateSessionOffline =>
      'The computer is offline. A session cannot be created right now.';

  @override
  String controllerSessionNameLength(int maximum) {
    return 'Session name must contain 1–$maximum characters.';
  }

  @override
  String get controllerSessionCreationBusy =>
      'The previous session is still being created. Please wait.';

  @override
  String controllerSessionCreating(String name) {
    return 'Creating “$name”…';
  }

  @override
  String get controllerSessionCreateFailed =>
      'Unable to create the session. Try again later.';

  @override
  String get controllerDesktopSessionCreateFailed =>
      'The desktop app could not create the session.';

  @override
  String get controllerSessionCreateTimeout =>
      'Timed out waiting for the desktop app to create the session. Check again later; do not create a duplicate.';

  @override
  String controllerSessionCreated(String name) {
    return 'Created “$name”.';
  }

  @override
  String get controllerCoworkCreateOnDesktop =>
      'Create this Cowork task in Claude Desktop first, then control it here.';

  @override
  String get controllerDesktopConfigFailed =>
      'The desktop app could not apply the session settings.';

  @override
  String get controllerConfigApplied => 'Session settings applied.';

  @override
  String get controllerConfigUpdateFailed =>
      'Unable to update session settings. Try again later.';

  @override
  String get controllerConfigTimeout =>
      'Timed out waiting for the desktop app to apply session settings. Refresh to confirm.';

  @override
  String get controllerInvalidEncryptedEvent =>
      'An encrypted event could not be verified. Sync cursor advancement has stopped.';

  @override
  String get controllerApprovalNeeded => 'Waiting for your approval';

  @override
  String get controllerContinuing => 'Continuing';

  @override
  String get controllerApprovalProcessFailed =>
      'The computer could not handle this approval. Try again.';

  @override
  String controllerAgentProcessing(String name) {
    return '$name is processing';
  }

  @override
  String get controllerSummarizing => 'Summarizing results';

  @override
  String get controllerThinking => 'Thinking';

  @override
  String get controllerLocalTaskFailed => 'Local task failed.';

  @override
  String get controllerInterruptFailed => 'Unable to stop the current task.';

  @override
  String get controllerReplying => 'Replying';

  @override
  String get controllerFinishing => 'Finishing';

  @override
  String get controllerOrganizingFileChanges => 'Organizing file changes';

  @override
  String controllerFilesModified(int count) {
    return 'Modified $count files.';
  }

  @override
  String get controllerUpdatingPlan => 'Updating the plan';

  @override
  String get controllerMessageQueued =>
      'Message queued. It will be sent automatically later.';

  @override
  String controllerSessionPersisted(String agent) {
    return 'Session saved to $agent.';
  }

  @override
  String controllerLocalTool(String label) {
    return 'Local tool: $label';
  }

  @override
  String get controllerProcessingLocalResult => 'Processing local result';

  @override
  String get controllerEncryptedResponseTimeout =>
      'Timed out waiting for the encrypted response from the computer.';

  @override
  String get controllerPairingUsedOrExpired =>
      'This connection has already been used or has expired.';

  @override
  String get controllerPairingConfirmationTimeout =>
      'Timed out waiting for desktop confirmation. Start the connection again.';

  @override
  String get controllerPairingConfirmationFailed =>
      'The computer did not confirm the encrypted connection. Connect again.';

  @override
  String get controllerDesktopOffline =>
      'The desktop app is not online yet. Keep Relayune open and try again.';

  @override
  String get workbenchDefault => 'Default';

  @override
  String workbenchAgentToolCount(int count) {
    return '$count tools';
  }

  @override
  String workbenchAgentTokenCount(String count) {
    return '$count tok';
  }

  @override
  String get apiErrorNetworkUnavailable =>
      'Unable to connect to Relayune. Check your network and try again.';

  @override
  String get apiErrorTimeout => 'The request timed out. Please try again.';

  @override
  String get apiErrorInvalidResponse =>
      'Relayune received an invalid server response. Please try again.';

  @override
  String get apiErrorInvalidCredentials =>
      'The email or password is incorrect.';

  @override
  String get apiErrorAuthentication =>
      'Your sign-in has expired. Please sign in again.';

  @override
  String get apiErrorService =>
      'Relayune is temporarily unavailable. Please try again later.';

  @override
  String get apiErrorGeneric => 'Something went wrong. Please try again.';

  @override
  String get controllerFileAccessDenied =>
      'Relayune on your computer cannot read some session files. Check file access permissions. On Mac, allow access in System Settings → Privacy & Security → Files and Folders, then retry.';

  @override
  String get workbenchImageWaiting => 'Waiting to load';

  @override
  String get workbenchImageLoading => 'Loading';

  @override
  String get feedbackTitle => 'Feedback';

  @override
  String get feedbackIntro => 'What could be better?';

  @override
  String get feedbackSubtitle => 'Share an idea or tell us about a problem.';

  @override
  String get feedbackSuggestion => 'Suggestion';

  @override
  String get feedbackBug => 'Bug report';

  @override
  String get feedbackDescription => 'Description';

  @override
  String get feedbackSuggestionHint =>
      'What would you improve, and how would it help?';

  @override
  String get feedbackBugHint =>
      'What did you do, what did you expect, and what happened?';

  @override
  String get feedbackInfo => 'Included with your feedback';

  @override
  String get feedbackPrivacy =>
      'Device details are included. Chats and logs are never uploaded automatically.';

  @override
  String get feedbackVersion => 'App version';

  @override
  String get feedbackModel => 'Device model';

  @override
  String get feedbackSystem => 'Operating system';

  @override
  String get feedbackUnknown => 'Unavailable';

  @override
  String get feedbackLoading => 'Reading device information…';

  @override
  String get feedbackSend => 'Submit feedback';

  @override
  String get feedbackFailed =>
      'Could not submit. Your feedback is still here. Check your connection and try again.';

  @override
  String get feedbackEmpty => 'Please describe your feedback first.';

  @override
  String get feedbackSending => 'Submitting…';

  @override
  String get feedbackSubmitNote =>
      'Your description and the information above will be saved for investigation and improvements.';

  @override
  String get feedbackSuccess => 'Feedback received. Thank you for your help.';

  @override
  String get feedbackReference => 'Feedback ID';

  @override
  String get feedbackDone => 'Done';

  @override
  String get workbenchStoppingTask => 'Stopping…';

  @override
  String get workbenchStopUnconfirmed =>
      'Stop has not been confirmed yet. Please try again.';

  @override
  String get workbenchPreparingImages => 'Preparing images…';

  @override
  String get workbenchImagePickFailed =>
      'Could not open photos. Please try again.';

  @override
  String get feedbackImages => 'Images';

  @override
  String get feedbackOptional => 'Optional';

  @override
  String get feedbackImageLimit => 'You can add up to 3 images.';

  @override
  String get feedbackImageFailed =>
      'Could not add the image. Try another image or retry.';

  @override
  String get feedbackImagePreview => 'Image preview';

  @override
  String get feedbackRemoveImage => 'Remove image';

  @override
  String get feedbackPreparingImages => 'Preparing images…';

  @override
  String get feedbackAddImage => 'Add images';

  @override
  String get feedbackImagesHint => 'Add screenshots to help us understand.';

  @override
  String get feedbackContact => 'Contact details';

  @override
  String get feedbackEmail => 'Email';

  @override
  String get feedbackEmailHint => 'Your account email; edit or leave blank';

  @override
  String get feedbackWechat => 'WeChat ID';

  @override
  String get feedbackWechatHint => 'Enter your WeChat ID';

  @override
  String get feedbackContactHint =>
      'Only used to reply to this feedback. Both fields are optional.';

  @override
  String get feedbackEmailInvalid => 'Enter a valid email or leave it blank.';

  @override
  String get deviceAgents => 'Agents';

  @override
  String get deviceAgentReady => 'Connected';

  @override
  String get deviceAgentRunning => 'Running';

  @override
  String get deviceAgentNotInstalled => 'Not installed';

  @override
  String get deviceAgentUnavailable => 'Unavailable';

  @override
  String get deviceAgentNotEnabled => 'Not enabled';

  @override
  String get deviceAgentUnknown => 'Not reported';

  @override
  String get deviceAgentOffline => 'Computer offline · Last reported status';

  @override
  String get openingTitle => 'Still connected. Wherever you are.';

  @override
  String get openingSubtitle =>
      'Pick up your computer’s AI work, from anywhere.';

  @override
  String get openingSkip => 'Skip animation';

  @override
  String get deviceQuota => 'Subscription limits';

  @override
  String get quotaFiveHour => '5 hours';

  @override
  String get quotaSevenDay => '7 days';

  @override
  String quotaUsed(String percent) {
    return '$percent% used';
  }

  @override
  String quotaResets(String time) {
    return 'Resets $time';
  }

  @override
  String quotaUpdated(String time) {
    return 'Updated $time';
  }

  @override
  String get quotaPending => 'Not reported';

  @override
  String get quotaExpired => 'Awaiting new limits';

  @override
  String get quotaLimitReached => 'Limit reached';

  @override
  String get quotaSnapshot => 'Last reported';

  @override
  String get quotaClaudeHint =>
      'Claude reports limits during sessions. Unreported windows are not estimated.';

  @override
  String get settingsHapticsTitle => 'Touch feedback';

  @override
  String get settingsHapticsSubtitle =>
      'A gentle tap when a connection or decision is confirmed.';

  @override
  String get workbenchBackToLatest => 'Back to latest';

  @override
  String get settingsFontSize => 'Font size';

  @override
  String get settingsFontSizeSmall => 'Small';

  @override
  String get settingsFontSizeMedium => 'Medium';

  @override
  String get settingsFontSizeLarge => 'Large';

  @override
  String get settingsFontSizeSaveFailed =>
      'Font size changed, but could not be saved. Please try again.';

  @override
  String get workbenchAgentOrderHint => 'Touch and hold, then drag to reorder';

  @override
  String get workbenchAgentOrderSaveFailed =>
      'Order changed, but could not be saved. Please try again.';

  @override
  String get settingsBuildInfo => 'Version information';

  @override
  String get buildTime => 'Built at';

  @override
  String get buildSourceCommit => 'Source commit';

  @override
  String get buildUnrecorded => 'Not recorded';

  @override
  String get buildUncommitted => 'Includes uncommitted changes';

  @override
  String get agentTasksTitle => 'Subtasks';

  @override
  String agentTasksCount(int count) {
    return '$count subtasks';
  }

  @override
  String agentTasksViewAll(int count) {
    return 'View all $count subtasks';
  }

  @override
  String agentTasksRunning(int count) {
    return '$count running';
  }

  @override
  String agentTasksFinished(int count) {
    return '$count ended';
  }

  @override
  String get agentTasksAttention => 'Needs your attention';

  @override
  String get agentTasksInProgress => 'In progress';

  @override
  String get agentTasksEnded => 'Ended';

  @override
  String get agentTaskPreparing => 'Preparing';

  @override
  String get agentTaskUnknown => 'Status awaiting sync';

  @override
  String get agentTaskCompleted => 'Completed';

  @override
  String get agentTaskFailed => 'Failed';

  @override
  String get agentTaskStopped => 'Stopped';

  @override
  String get agentTaskAnswer => 'Waiting for your answer';

  @override
  String get agentTaskApprove => 'Waiting for your approval';

  @override
  String get agentTaskNoResult => 'No result received yet';

  @override
  String get agentTaskInstructions => 'Task instructions';

  @override
  String get agentTaskRuntime => 'Run information';

  @override
  String agentTaskParent(String name) {
    return 'From: $name';
  }

  @override
  String agentTaskUpdated(String time) {
    return 'Updated $time';
  }

  @override
  String get agentTaskOffline => 'Computer offline · showing last known status';

  @override
  String get agentTaskOpenConversation => 'View conversation history';

  @override
  String get agentTaskEmpty => 'No subtasks yet';

  @override
  String get agentTaskFinishedResult => 'Latest reply';

  @override
  String get liveTaskRunning => 'Working';

  @override
  String get liveTaskApproval => 'Needs approval';

  @override
  String get liveTaskQuestion => 'Needs an answer';

  @override
  String get liveTaskCompleted => 'Completed';

  @override
  String get liveTaskFailed => 'Task failed';

  @override
  String get liveTaskStopped => 'Stopped';

  @override
  String get liveTaskStale => 'Check latest status';

  @override
  String get liveTaskOpen => 'View task';

  @override
  String get liveTaskReview => 'Review';

  @override
  String get liveTaskElapsed => 'Elapsed';

  @override
  String get liveTaskUpdated => 'Last synced';

  @override
  String get androidPushDisclosure =>
      'Enable background alerts with JPush and, on supported devices, vivo Push. They process a push identifier, Android ID, device/system and network information for delivery. Task content and encryption keys are not sent to these providers. You can turn alerts off in system settings.';

  @override
  String get controllerSessionUnavailable =>
      'This conversation is unavailable on the connected computer. Check that its Agent is running and the conversation still exists, then retry or start a new conversation.';

  @override
  String get settingsSidebarAgents => 'Sidebar agents';

  @override
  String get settingsSidebarAgentsSubtitle =>
      'Choose which agents appear in the sidebar';

  @override
  String get turnStatusRunning => 'Processing';

  @override
  String get turnStatusCompleted => 'Turn completed';

  @override
  String get turnStatusInterrupted => 'This turn did not complete';

  @override
  String get turnStatusUnknown => 'Activity log';

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
  String get localWebForward => 'Next page';

  @override
  String get localWebAddress => 'Page address';

  @override
  String get localWebLoading => 'Connecting to your computer…';

  @override
  String get accountDeletionTitle => 'Delete account';

  @override
  String get accountDeletionBody =>
      'This permanently deletes your Relayune account, device authorizations, preferences and submitted feedback. Your signed-in devices will lose access. History cache keys on this phone will be removed. Agent projects and files on your computers are not deleted.';

  @override
  String get accountDeletionPassword => 'Confirm your password';

  @override
  String get accountDeletionConfirm => 'Permanently delete my account';

  @override
  String get accountDeletionBusy => 'Deleting…';

  @override
  String get accountDeletionWrongPassword =>
      'Incorrect password. Please try again.';

  @override
  String get accountDeletionFailed =>
      'Could not complete deletion. Check your connection and retry. If deletion has started, other account access remains disabled until cleanup finishes.';

  @override
  String get accountDeletionDone => 'Your account has been deleted.';

  @override
  String get controllerPendingInputSaveFailed =>
      'Your message could not be saved on this phone. Free up storage and try again.';

  @override
  String get workbenchHistoryRequestSending => 'Sending request';

  @override
  String get workbenchHistoryWaitingComputer => 'Waiting for your computer';

  @override
  String get workbenchHistoryReadingComputer =>
      'Reading history on your computer';

  @override
  String get workbenchHistoryPreparing => 'Preparing messages';

  @override
  String workbenchHistoryElapsed(int seconds) {
    return '${seconds}s elapsed';
  }

  @override
  String get workbenchHistoryTransferring => 'Transferring history';

  @override
  String workbenchHistorySourceRead(String read, String total) {
    return 'Computer read $read / $total';
  }

  @override
  String workbenchHistoryPendingTransfer(String size) {
    return 'Page awaiting transfer: $size';
  }

  @override
  String workbenchHistoryReceived(String size) {
    return 'Received $size';
  }

  @override
  String workbenchHistoryPendingReceive(String size) {
    return 'Awaiting reception: $size';
  }

  @override
  String get workbenchHistoryReadingCache =>
      'Reading saved history on this phone';

  @override
  String get localWebResources => 'Page resources';

  @override
  String get localWebGettingPage => 'Getting the webpage…';

  @override
  String get localWebLoadingPage => 'Loading the page…';

  @override
  String localWebResourceSummary(int completed, int active) {
    return '$completed received · $active in progress';
  }

  @override
  String localWebResourceFailures(int count) {
    return '$count failed';
  }

  @override
  String get localWebResourceWaiting => 'Waiting for response';

  @override
  String get localWebResourceReceiving => 'Receiving';

  @override
  String get localWebResourcePreparing => 'Preparing';

  @override
  String get localWebResourceComplete => 'Received';

  @override
  String get localWebResourceFailed => 'Failed';

  @override
  String get localWebResourceCancelled => 'Stopped';

  @override
  String get localWebResourceTransferNote =>
      'Progress measures response reception. The page may request more resources.';

  @override
  String get localWebResourceEmpty =>
      'Resources requested by this page will appear here.';

  @override
  String localWebResourceRecent(int count) {
    return 'Showing the latest $count resources';
  }

  @override
  String localWebElapsed(String seconds) {
    return '$seconds s';
  }

  @override
  String get localWebOpeningTitle => 'A page from your computer';

  @override
  String get localWebOpeningHint =>
      'Keep your computer and webpage service running. The page will appear automatically.';

  @override
  String get replyBranchLabel => 'Branch to new chat';

  @override
  String get replyBranchSameDirectory => 'Use original project directory';

  @override
  String get replyBranchSameDirectoryDescription =>
      'Continue sharing project files';

  @override
  String get replyBranchWorktree => 'Create new worktree';

  @override
  String get replyBranchWorktreeDescription =>
      'Separate directory, based on the current commit';

  @override
  String get controllerReplyBranchOffline =>
      'Connect to your computer to branch';

  @override
  String get controllerReplyBranchCreating => 'Creating new chat…';

  @override
  String get controllerReplyBranchCreated =>
      'Branched to a new chat using the original project directory.';

  @override
  String get controllerReplyBranchFailed =>
      'Could not create the new chat. Try again.';

  @override
  String get controllerReplyBranchUnconfirmed =>
      'Branch result is unconfirmed. Stay connected and retry to check.';

  @override
  String get controllerReplyBranchUnavailable =>
      'This reply cannot be branched. Refresh the conversation.';

  @override
  String get controllerReplyBranchBusy =>
      'Another chat operation is in progress. Try again shortly.';

  @override
  String get controllerReplyBranchWorktreeFailed =>
      'Could not create the worktree. Check the project on your computer and try again.';

  @override
  String get controllerReplyBranchWorktreeCreated =>
      'Branched to a new chat using a separate worktree.';

  @override
  String agentTasksCompletedCount(int count) {
    return '$count completed';
  }

  @override
  String agentTasksStoppedCount(int count) {
    return '$count stopped';
  }

  @override
  String agentTasksFailedCount(int count) {
    return '$count failed';
  }

  @override
  String agentTasksPreparingCount(int count) {
    return '$count preparing';
  }

  @override
  String agentTasksUnknownCount(int count) {
    return '$count awaiting sync';
  }

  @override
  String get agentTasksSearch => 'Search tasks, nicknames or models';

  @override
  String get agentTasksNoMatches => 'No matching subtasks';

  @override
  String get agentTaskModelConfiguration => 'Model configuration';
}
