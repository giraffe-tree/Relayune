// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Chinese (`zh`).
class AppLocalizationsZh extends AppLocalizations {
  AppLocalizationsZh([String locale = 'zh']) : super(locale);

  @override
  String get workbenchContinueUnconfirmed => '继续状态尚未确认，请稍后重试。';

  @override
  String get workbenchContinueExpired => '继续请求已过期，请核对会话后重试。';

  @override
  String get workbenchContinueSession => '继续';

  @override
  String get workbenchContinuingSession => '正在继续…';

  @override
  String get workbenchStateAnswered => 'Answered';

  @override
  String get workbenchTurnIncomplete => '本次处理未完成';

  @override
  String get controllerQueueUnconfirmed => '尚未确认消息的处理状态，请刷新会话查看。';

  @override
  String get homeGreetingMorning => '早上好';

  @override
  String get homeGreetingNoon => '中午好';

  @override
  String get homeGreetingAfternoon => '下午好';

  @override
  String get homeGreetingEvening => '晚上好';

  @override
  String get homeGreetingNight => '夜深了';

  @override
  String get homeCareLongBreak => '忙了好一阵，不妨多休息一会儿。';

  @override
  String get homeCarePause => '专注了一阵，喝口水、看看远处吧。';

  @override
  String get homeCareNightWorking => '如果还在忙，记得给今晚留一点休息。';

  @override
  String get homeCareNightQuiet => '没忙完的，也可以留一点给明天。';

  @override
  String get homeCareBusyDay => '今天忙了不少，也留一点时间给自己。';

  @override
  String get homeCareDecision => '按自己的节奏，想好了再继续。';

  @override
  String get homeCareLongWait => '等得有点久了，也照顾一下自己。';

  @override
  String get homeCareWelcomeBack => '欢迎回来，按自己的节奏继续。';

  @override
  String get homeCareFirstIdea => '准备好了，就从一个想法开始。';

  @override
  String get homeCareMeal => '如果还没吃饭，记得照顾一下自己。';

  @override
  String get homeCareEasterEgg => '隐藏成就：照顾自己，无需进度条。';

  @override
  String get homeCareWeekend => '周末，做点喜欢的，也留一点空白。';

  @override
  String get homeCareDailyProgress => '愿今天有一点进展，也有一点从容。';

  @override
  String get homeCareDailySpace => '灵感需要空间，你也一样。';

  @override
  String get homeCareDailyPace => '事情一件件来，给自己留一点余地。';

  @override
  String get workbenchReturnHome => '返回主页';

  @override
  String get workbenchVisualization => '可视化';

  @override
  String get workbenchVisualizationUnavailable => '这张图暂时无法预览。';

  @override
  String get workbenchDesktopVersionUnknown => '版本未知';

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
      '电脑上的 Relayune 无法读取部分会话文件。请检查文件访问权限；Mac 可在“系统设置 → 隐私与安全性 → 文件与文件夹”中允许访问，然后重试。';

  @override
  String get workbenchImageWaiting => '等待加载';

  @override
  String get workbenchImageLoading => '加载中';

  @override
  String get feedbackTitle => '用户反馈';

  @override
  String get feedbackIntro => '哪里还可以更好？';

  @override
  String get feedbackSubtitle => '体验建议或遇到的问题，都欢迎告诉我们。';

  @override
  String get feedbackSuggestion => '体验建议';

  @override
  String get feedbackBug => 'Bug 问题';

  @override
  String get feedbackDescription => '反馈描述';

  @override
  String get feedbackSuggestionHint => '希望改善什么？它会如何帮助你？';

  @override
  String get feedbackBugHint => '你做了什么、预期发生什么、实际遇到了什么？';

  @override
  String get feedbackInfo => '随反馈附带的信息';

  @override
  String get feedbackPrivacy => '设备信息会随反馈提交，不会自动上传聊天内容或日志。';

  @override
  String get feedbackVersion => 'App 版本';

  @override
  String get feedbackModel => '设备型号';

  @override
  String get feedbackSystem => '操作系统';

  @override
  String get feedbackUnknown => '未获取';

  @override
  String get feedbackLoading => '正在读取设备信息…';

  @override
  String get feedbackSend => '提交反馈';

  @override
  String get feedbackFailed => '提交失败，内容已保留。请检查网络后重试。';

  @override
  String get feedbackEmpty => '请先填写反馈描述。';

  @override
  String get feedbackSending => '正在提交…';

  @override
  String get feedbackSubmitNote => '提交后会保存你的描述和上方信息，供我们排查与改进。';

  @override
  String get feedbackSuccess => '反馈已收到，感谢你的帮助。';

  @override
  String get feedbackReference => '反馈编号';

  @override
  String get feedbackDone => '完成';

  @override
  String get workbenchStoppingTask => '正在停止…';

  @override
  String get workbenchStopUnconfirmed => '还未确认停止，请重试。';

  @override
  String get workbenchPreparingImages => '正在准备图片…';

  @override
  String get workbenchImagePickFailed => '无法打开相册，请重试。';

  @override
  String get feedbackImages => '图片';

  @override
  String get feedbackOptional => '选填';

  @override
  String get feedbackImageLimit => '最多可添加 3 张图片。';

  @override
  String get feedbackImageFailed => '图片添加失败，请换一张图片或重试。';

  @override
  String get feedbackImagePreview => '图片预览';

  @override
  String get feedbackRemoveImage => '移除图片';

  @override
  String get feedbackPreparingImages => '正在处理图片…';

  @override
  String get feedbackAddImage => '添加图片';

  @override
  String get feedbackImagesHint => '添加截图，帮助我们更快理解问题。';

  @override
  String get feedbackContact => '联系方式';

  @override
  String get feedbackEmail => '邮箱';

  @override
  String get feedbackEmailHint => '自动填入登录邮箱，可修改或清空';

  @override
  String get feedbackWechat => '微信号';

  @override
  String get feedbackWechatHint => '填写你的微信号';

  @override
  String get feedbackContactHint => '仅用于回复这条反馈，不填写也能提交。';

  @override
  String get feedbackEmailInvalid => '请填写有效邮箱，或留空。';

  @override
  String get deviceAgents => 'Agent';

  @override
  String get deviceAgentReady => '已接入';

  @override
  String get deviceAgentRunning => '运行中';

  @override
  String get deviceAgentNotInstalled => '未安装';

  @override
  String get deviceAgentUnavailable => '不可用';

  @override
  String get deviceAgentNotEnabled => '未启用';

  @override
  String get deviceAgentUnknown => '尚未上报';

  @override
  String get deviceAgentOffline => '电脑离线 · 显示上次检测结果';

  @override
  String get openingTitle => '远处，仍在继续。';

  @override
  String get openingSubtitle => '随时接上电脑里的 AI 工作。';

  @override
  String get openingSkip => '跳过动画';

  @override
  String get deviceQuota => '订阅额度';

  @override
  String get quotaFiveHour => '5 小时';

  @override
  String get quotaSevenDay => '7 天';

  @override
  String quotaUsed(String percent) {
    return '已用 $percent%';
  }

  @override
  String quotaResets(String time) {
    return '$time 重置';
  }

  @override
  String quotaUpdated(String time) {
    return '更新于 $time';
  }

  @override
  String get quotaPending => '尚未上报';

  @override
  String get quotaExpired => '等待新额度';

  @override
  String get quotaLimitReached => '已达上限';

  @override
  String get quotaSnapshot => '上次检测';

  @override
  String get quotaClaudeHint => 'Claude 在会话运行时上报额度；未上报的窗口不显示估算值。';

  @override
  String get settingsHapticsTitle => '触觉反馈';

  @override
  String get settingsHapticsSubtitle => '连接或决定确认后，给予轻微触感。';

  @override
  String get workbenchBackToLatest => '回到最新';

  @override
  String get settingsFontSize => '字体大小';

  @override
  String get settingsFontSizeSmall => '小';

  @override
  String get settingsFontSizeMedium => '中';

  @override
  String get settingsFontSizeLarge => '大';

  @override
  String get settingsFontSizeSaveFailed => '字号已切换，但未能保存，请重试。';

  @override
  String get workbenchAgentOrderHint => 'Touch and hold, then drag to reorder';

  @override
  String get workbenchAgentOrderSaveFailed =>
      'Order changed, but could not be saved. Please try again.';

  @override
  String get settingsBuildInfo => '版本信息';

  @override
  String get buildTime => '构建时间';

  @override
  String get buildSourceCommit => '代码版本';

  @override
  String get buildUnrecorded => '未记录';

  @override
  String get buildUncommitted => '含未提交改动';

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
  String get agentTaskOpenConversation => '查看历史会话';

  @override
  String get agentTaskEmpty => 'No subtasks yet';

  @override
  String get agentTaskFinishedResult => '最新回复';

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
      '启用后，极光推送及支持设备上的 vivo 推送会处理推送标识、Android ID、设备与系统及网络信息，用于后台提醒。不会向它们发送任务内容或加密密钥。可随时在系统设置关闭通知。';

  @override
  String get controllerSessionUnavailable =>
      'This conversation is unavailable on the connected computer. Check that its Agent is running and the conversation still exists, then retry or start a new conversation.';

  @override
  String get settingsSidebarAgents => '侧边栏 Agent';

  @override
  String get settingsSidebarAgentsSubtitle => '选择在侧边栏显示的 Agent';

  @override
  String get turnStatusRunning => '处理中';

  @override
  String get turnStatusCompleted => '本轮完成';

  @override
  String get turnStatusInterrupted => '本次处理未完成';

  @override
  String get turnStatusUnknown => '处理记录';

  @override
  String get localWebTitle => '电脑网页';

  @override
  String get localWebOpen => '打开网页';

  @override
  String get localWebNotice => '此页面可以加载资源，并向电脑上的这个地址提交表单或 API 请求。';

  @override
  String get localWebUnavailable =>
      '网页暂时无法访问，请检查电脑和本地服务是否运行。提交超时不代表失败，请核对结果后再提交。';

  @override
  String get localWebUpdate => '请更新桌面端后再预览电脑网页。';

  @override
  String get localWebPaused => '应用离开前台后已关闭预览，重新打开即可继续。';

  @override
  String get localWebRefresh => '刷新网页';

  @override
  String get localWebBack => '上一页';

  @override
  String get localWebBlocked => '此预览只能访问当前选定的电脑地址。';

  @override
  String get localWebForward => '下一页';

  @override
  String get localWebAddress => '网页地址';

  @override
  String get localWebLoading => '正在连接电脑…';

  @override
  String get accountDeletionTitle => '删除账户';

  @override
  String get accountDeletionBody =>
      '这会永久删除你的 Relayune 账户、设备授权、偏好及已提交的反馈。已登录设备将失去访问权限，并销毁本手机的历史缓存密钥。电脑上的 Agent 项目和文件不会被删除。';

  @override
  String get accountDeletionPassword => '输入密码确认身份';

  @override
  String get accountDeletionConfirm => '永久删除我的账户';

  @override
  String get accountDeletionBusy => '正在删除…';

  @override
  String get accountDeletionWrongPassword => '密码不正确，请重试。';

  @override
  String get accountDeletionFailed =>
      '未能完成删除，请检查网络并重试。如果删除已经开始，其他账户访问会保持禁用，直到清理完成。';

  @override
  String get accountDeletionDone => '账户已删除。';

  @override
  String get controllerPendingInputSaveFailed =>
      'Your message could not be saved on this phone. Free up storage and try again.';

  @override
  String get workbenchHistoryRequestSending => '正在发送读取请求';

  @override
  String get workbenchHistoryWaitingComputer => '等待电脑回应';

  @override
  String get workbenchHistoryReadingComputer => '电脑正在读取历史消息';

  @override
  String get workbenchHistoryPreparing => '正在整理消息';

  @override
  String workbenchHistoryElapsed(int seconds) {
    return '已用时 $seconds 秒';
  }

  @override
  String get workbenchHistoryTransferring => '正在传输历史消息';

  @override
  String workbenchHistorySourceRead(String read, String total) {
    return '电脑已读取 $read / $total';
  }

  @override
  String workbenchHistoryPendingTransfer(String size) {
    return '本页待传输 $size';
  }

  @override
  String workbenchHistoryReceived(String size) {
    return '已接收 $size';
  }

  @override
  String workbenchHistoryPendingReceive(String size) {
    return '待接收 $size';
  }

  @override
  String get workbenchHistoryReadingCache => '正在读取本机缓存';

  @override
  String get localWebResources => '网页资源';

  @override
  String get localWebGettingPage => '正在获取网页…';

  @override
  String get localWebLoadingPage => '正在加载页面…';

  @override
  String localWebResourceSummary(int completed, int active) {
    return '$completed 项已取回 · $active 项进行中';
  }

  @override
  String localWebResourceFailures(int count) {
    return '$count 项失败';
  }

  @override
  String get localWebResourceWaiting => '等待响应';

  @override
  String get localWebResourceReceiving => '正在接收';

  @override
  String get localWebResourcePreparing => '正在处理';

  @override
  String get localWebResourceComplete => '已取回';

  @override
  String get localWebResourceFailed => '获取失败';

  @override
  String get localWebResourceCancelled => '已停止';

  @override
  String get localWebResourceTransferNote => '进度表示响应接收情况，网页可能继续请求资源。';

  @override
  String get localWebResourceEmpty => '网页请求的资源会显示在这里。';

  @override
  String localWebResourceRecent(int count) {
    return '显示最近 $count 项资源';
  }

  @override
  String localWebElapsed(String seconds) {
    return '$seconds 秒';
  }

  @override
  String get localWebOpeningTitle => '电脑上的网页';

  @override
  String get localWebOpeningHint => '保持电脑和网页服务运行，页面会自动出现。';

  @override
  String get replyBranchLabel => '分支到新聊天';

  @override
  String get replyBranchSameDirectory => '使用原项目目录';

  @override
  String get replyBranchSameDirectoryDescription => '继续共用项目文件';

  @override
  String get replyBranchWorktree => '创建新 worktree';

  @override
  String get replyBranchWorktreeDescription => '独立目录，基于当前提交';

  @override
  String get controllerReplyBranchOffline => '连接电脑后可分支';

  @override
  String get controllerReplyBranchCreating => '正在创建新聊天…';

  @override
  String get controllerReplyBranchCreated => '已分支到新聊天，继续使用原项目目录。';

  @override
  String get controllerReplyBranchFailed => '未能创建新聊天，请重试。';

  @override
  String get controllerReplyBranchUnconfirmed => '暂未确认分支结果，请保持连接后重试查询。';

  @override
  String get controllerReplyBranchUnavailable => '此回复暂不能分支，请刷新会话。';

  @override
  String get controllerReplyBranchBusy => '正在处理聊天操作，请稍后重试。';

  @override
  String get controllerReplyBranchWorktreeFailed =>
      '未能创建 worktree，请在电脑上检查项目后重试。';

  @override
  String get controllerReplyBranchWorktreeCreated => '已分支到新聊天，使用独立 worktree。';

  @override
  String agentTasksCompletedCount(int count) {
    return '$count 个已完成';
  }

  @override
  String agentTasksStoppedCount(int count) {
    return '$count 个已停止';
  }

  @override
  String agentTasksFailedCount(int count) {
    return '$count 个失败';
  }

  @override
  String agentTasksPreparingCount(int count) {
    return '$count 个准备中';
  }

  @override
  String agentTasksUnknownCount(int count) {
    return '$count 个待同步';
  }

  @override
  String get agentTasksSearch => '搜索任务、昵称或模型';

  @override
  String get agentTasksNoMatches => '没有匹配的子任务';

  @override
  String get agentTaskModelConfiguration => '模型配置';
}

/// The translations for Chinese, as used in China (`zh_CN`).
class AppLocalizationsZhCn extends AppLocalizationsZh {
  AppLocalizationsZhCn() : super('zh_CN');

  @override
  String get workbenchContinueUnconfirmed => '继续状态尚未确认，请稍后重试。';

  @override
  String get workbenchContinueExpired => '继续请求已过期，请核对会话后重试。';

  @override
  String get workbenchContinueSession => '继续';

  @override
  String get workbenchContinuingSession => '正在继续…';

  @override
  String get workbenchStateAnswered => '已回答';

  @override
  String get workbenchTurnIncomplete => '本次处理未完成';

  @override
  String get controllerQueueUnconfirmed => '尚未确认消息的处理状态，请刷新会话查看。';

  @override
  String get homeGreetingMorning => '早上好';

  @override
  String get homeGreetingNoon => '中午好';

  @override
  String get homeGreetingAfternoon => '下午好';

  @override
  String get homeGreetingEvening => '晚上好';

  @override
  String get homeGreetingNight => '夜深了';

  @override
  String get homeCareLongBreak => '忙了好一阵，不妨多休息一会儿。';

  @override
  String get homeCarePause => '专注了一阵，喝口水、看看远处吧。';

  @override
  String get homeCareNightWorking => '如果还在忙，记得给今晚留一点休息。';

  @override
  String get homeCareNightQuiet => '没忙完的，也可以留一点给明天。';

  @override
  String get homeCareBusyDay => '今天忙了不少，也留一点时间给自己。';

  @override
  String get homeCareDecision => '按自己的节奏，想好了再继续。';

  @override
  String get homeCareLongWait => '等得有点久了，也照顾一下自己。';

  @override
  String get homeCareWelcomeBack => '欢迎回来，按自己的节奏继续。';

  @override
  String get homeCareFirstIdea => '准备好了，就从一个想法开始。';

  @override
  String get homeCareMeal => '如果还没吃饭，记得照顾一下自己。';

  @override
  String get homeCareEasterEgg => '隐藏成就：照顾自己，无需进度条。';

  @override
  String get homeCareWeekend => '周末，做点喜欢的，也留一点空白。';

  @override
  String get homeCareDailyProgress => '愿今天有一点进展，也有一点从容。';

  @override
  String get homeCareDailySpace => '灵感需要空间，你也一样。';

  @override
  String get homeCareDailyPace => '事情一件件来，给自己留一点余地。';

  @override
  String get workbenchReturnHome => '返回主页';

  @override
  String get workbenchVisualization => '可视化';

  @override
  String get workbenchVisualizationUnavailable => '这张图暂时无法预览。';

  @override
  String get workbenchDesktopVersionUnknown => '版本未知';

  @override
  String get appTitle => 'Relayune';

  @override
  String get commonBack => '返回';

  @override
  String get commonCancel => '取消';

  @override
  String get commonClose => '关闭';

  @override
  String get commonContinue => '继续';

  @override
  String get commonRetry => '重试';

  @override
  String get commonSave => '保存';

  @override
  String get commonSubmit => '提交';

  @override
  String get commonSettings => '设置';

  @override
  String get commonLogOut => '退出登录';

  @override
  String get commonReject => '拒绝';

  @override
  String get commonAllow => '允许';

  @override
  String get unavailableTitle => '暂时无法打开 Relayune';

  @override
  String get clearLoginSession => '清除登录会话';

  @override
  String get updateInstallerUnavailable => '无法打开系统安装器，请稍后重试。';

  @override
  String get updateReadyTitle => '更新已准备好';

  @override
  String updateDownloaded(String version) {
    return 'Relayune $version 已在后台安全下载并验证。';
  }

  @override
  String get updateLater => '稍后';

  @override
  String get updateInstall => '安装更新';

  @override
  String get authSecurityBadge => '端到端加密工作台';

  @override
  String get authEmailTitle => '从手机继续本机任务';

  @override
  String get authPasswordTitle => '登录或创建账户';

  @override
  String get authVerificationTitle => '检查你的邮箱';

  @override
  String get authEmailSubtitle => '登录后，用桌面端显示的 8 位连接码建立端到端加密连接。';

  @override
  String get authPasswordSubtitle => '已有密码可直接登录；首次使用请先验证邮箱。';

  @override
  String get authVerificationSubtitle => '验证链接一次性使用，并会在短时间后失效。';

  @override
  String get authEmailLabel => '邮箱';

  @override
  String get authInvalidEmail => '请输入有效的邮箱地址';

  @override
  String get authContinue => '继续';

  @override
  String get authChangeEmail => '更换邮箱';

  @override
  String get authPasswordLabel => '密码';

  @override
  String get authShowPassword => '显示密码';

  @override
  String get authHidePassword => '隐藏密码';

  @override
  String get authPasswordRequired => '请输入密码';

  @override
  String get authSignIn => '登录';

  @override
  String get authVerifyEmailAction => '首次使用或忘记密码？验证邮箱';

  @override
  String get authVerificationInstructions => '请打开验证邮件，在安全网页中设置密码；完成后回到这里继续。';

  @override
  String get authPasswordSet => '我已设置密码';

  @override
  String get authResendEmail => '重新发送邮件';

  @override
  String get authSecurityNote => '服务器只路由密文；连接码和内容密钥不会上传。';

  @override
  String get pairingExit => '退出';

  @override
  String get pairingTitle => '扫一扫，连接你的电脑';

  @override
  String get pairingSubtitle => '让电脑上的工作，随你同行。';

  @override
  String get pairingEnterCodeTitle => '也可以输入 8 位码';

  @override
  String get pairingEnterCodeHelp => '输入电脑端显示的 8 位连接码。';

  @override
  String get pairingSearching => '正在查找你账户中的待连接电脑…';

  @override
  String get pairingComputerLabel => '要连接的电脑';

  @override
  String pairingWillConnect(String device) {
    return '将连接：$device';
  }

  @override
  String get pairingStartOnDesktop => '先在电脑端点击“连接新客户端”，再输入新显示的连接码。';

  @override
  String get pairingSearchAgain => '重新查找电脑';

  @override
  String get pairingCodeLabel => '8 位连接码';

  @override
  String get pairingSecureConnect => '安全连接';

  @override
  String get pairingScanTitle => '二维码在哪里？';

  @override
  String get pairingScanHelp => '打开电脑端 Relayune，点击「连接新客户端」，\n扫描窗口中显示的二维码。';

  @override
  String get pairingOpenCamera => '扫码连接';

  @override
  String get pairingPrivacyNote => '端到端加密，只有你的设备能读取会话。';

  @override
  String pairingMinimumDesktop(String version) {
    return '电脑端最低兼容版本：$version';
  }

  @override
  String get pairingDeriving => '正在验证连接…';

  @override
  String get pairingWaitingDesktop => '等待电脑确认…';

  @override
  String get pairingActivating => '正在建立加密通道…';

  @override
  String get pairingDerivingDetail => '正在本机生成 SPAKE2 responder share 和独立内容密钥。';

  @override
  String get pairingWaitingDesktopDetail => '请保持桌面端 Relayune 打开。';

  @override
  String get pairingActivatingDetail => '正在验证首个加密会话目录。';

  @override
  String get scannerTitle => '扫描电脑上的连接二维码';

  @override
  String get scannerResume => '继续扫码';

  @override
  String get scannerInvalid => '这不是 Relayune 连接二维码，请扫描电脑端当前显示的二维码。';

  @override
  String get scannerHelp => '将电脑端 Relayune 显示的二维码放入框内，识别后会直接建立端到端加密连接。';

  @override
  String get scannerUnavailable => '无法使用相机。请在系统设置中允许 Relayune 访问相机，或返回使用手动连接。';

  @override
  String get settingsTitle => '设置';

  @override
  String get settingsSignedInAccount => '登录账户';

  @override
  String get settingsAccountSection => '账户';

  @override
  String get settingsPreferencesSection => '偏好设置';

  @override
  String get settingsHelpLegalSection => '客服与法律';

  @override
  String get settingsLanguage => '语言';

  @override
  String get settingsLanguageSystemDefault => '默认（跟随系统）';

  @override
  String settingsLanguageSystemDefaultValue(String language) {
    return '默认 · $language';
  }

  @override
  String get settingsLanguageSaveFailed => '语言已切换，但偏好设置未能保存。';

  @override
  String get settingsReleaseNotes => '版本记录';

  @override
  String get settingsSupport => '客服支持';

  @override
  String get settingsTerms => '服务条款';

  @override
  String get settingsPrivacy => '隐私政策';

  @override
  String get settingsLegalLanguage => '简体中文';

  @override
  String get settingsOpenLinkFailed => '暂时无法打开链接，请稍后重试。';

  @override
  String get releaseTitle => '版本记录';

  @override
  String get releaseLoading => '正在加载版本记录';

  @override
  String get releaseErrorTitle => '暂时无法载入版本记录';

  @override
  String get releaseErrorMessage => '请检查网络后重试。';

  @override
  String get releaseEmptyTitle => '暂无版本记录';

  @override
  String get releaseEmptyMessage => '后续更新会显示在这里。';

  @override
  String get releaseVersion => '版本';

  @override
  String get releaseWeb => '网页';

  @override
  String get releaseServer => '服务端';

  @override
  String get notificationEnabledTitle => '任务通知已开启';

  @override
  String get notificationPrimerTitle => '任务在电脑跑，你不必一直盯着';

  @override
  String get notificationEnabledBody => 'Relayune 会在需要你处理或主任务完成时提醒你。';

  @override
  String get notificationPrimerBody => '审批和提问可以及时处理；完成后直接看到任务名称和回复摘要。';

  @override
  String get notificationBenefitAction => '等待处理：从通知快速允许、拒绝或打开回答';

  @override
  String get notificationBenefitCompletion => '任务完成：先看回复摘要，再决定是否打开';

  @override
  String get notificationBenefitPrivacy => '通知不展示命令、文件路径、连接码或密钥';

  @override
  String get notificationPermissionRejected =>
      '系统通知仍未开启。你可以前往系统设置允许 Relayune 通知。';

  @override
  String get notificationGotIt => '知道了';

  @override
  String get notificationOpenSettings => '前往系统设置';

  @override
  String get notificationEnable => '开启任务通知';

  @override
  String get notificationNotNow => '暂不开启';

  @override
  String get notificationSemanticsExample =>
      '通知示例：审批等待处理、问题等待回答、Claude 任务完成并显示回复摘要';

  @override
  String get notificationNow => '现在';

  @override
  String get notificationSampleTask => '优化移动端通知栏';

  @override
  String get notificationSampleBody => '已完成通知权限引导，并补充了任务完成摘要……';

  @override
  String get notificationApprovalTitle => '操作等待确认';

  @override
  String get notificationQuestionTitle => '需要你的回答';

  @override
  String notificationTaskPaused(String provider) {
    return '$provider · 任务已暂停';
  }

  @override
  String notificationApprovalBody(int minutes) {
    return '请在 $minutes 分钟内允许或拒绝这项操作。';
  }

  @override
  String notificationQuestionBody(int minutes) {
    return '请在 $minutes 分钟内回答，任务会在提交后继续。';
  }

  @override
  String notificationTaskCompleted(String provider) {
    return '$provider 任务已完成';
  }

  @override
  String get notificationMainTask => '主任务';

  @override
  String get notificationMainResultReady => '主任务结果已准备好，轻点查看。';

  @override
  String notificationNamedResultReady(String name) {
    return '“$name”的结果已准备好，轻点查看。';
  }

  @override
  String get notificationAllowOnce => '允许一次';

  @override
  String get notificationAnswer => '回答';

  @override
  String get notificationChannelAttention => '需要处理';

  @override
  String get notificationChannelCompleted => '任务已完成';

  @override
  String get notificationChannelAttentionDescription => 'Relayune 审批和提问提醒';

  @override
  String get notificationChannelCompletedDescription => 'Relayune 主任务完成提醒';

  @override
  String get notificationRedactedLink => '[链接]';

  @override
  String get notificationRedactedPath => '[路径]';

  @override
  String get notificationRedactedSecret => '[已隐藏]';

  @override
  String get workbenchTitle => '工作台';

  @override
  String get workbenchDevice => '设备';

  @override
  String get workbenchOpenNavigation => '打开导航';

  @override
  String workbenchPendingApprovals(int count) {
    return '$count 项待审批';
  }

  @override
  String get workbenchSessions => '会话';

  @override
  String get workbenchOnline => '在线';

  @override
  String get workbenchOffline => '离线';

  @override
  String get workbenchDeviceOnlineRealtime => '电脑在线 · 实时同步';

  @override
  String get workbenchDeviceOfflineQueued => '电脑离线 · 仅显示手机缓存记录';

  @override
  String get workbenchDeviceOnlineReconnecting => '电脑在线 · 实时连接恢复中';

  @override
  String get workbenchDeviceOfflineReconnecting => '电脑离线 · 实时连接恢复中';

  @override
  String get workbenchDeviceOnlineWaiting => '电脑在线 · 等待实时连接';

  @override
  String get workbenchDeviceOfflineWaiting => '电脑离线 · 等待实时连接';

  @override
  String get workbenchProjectsSessions => '项目与会话';

  @override
  String get workbenchNoSessionsSynced => '电脑尚未同步会话';

  @override
  String get workbenchSignedInAccount => '登录账户';

  @override
  String get workbenchNotSignedIn => '未登录';

  @override
  String get workbenchNewSession => '新会话';

  @override
  String get workbenchDefaultSessionName => '新建远程会话';

  @override
  String get workbenchHistoryFailed => '历史读取失败，当前内容可能不完整';

  @override
  String get workbenchLoadEarlier => '加载更早记录';

  @override
  String get workbenchSendFirst => '发送第一条指令开始工作';

  @override
  String get workbenchAtBeginning => '已经是第一条了';

  @override
  String get workbenchAddAttachment => '添加附件';

  @override
  String workbenchRemoveAttachment(String name) {
    return '移除 $name';
  }

  @override
  String get workbenchReadOnly => '当前会话只读';

  @override
  String get workbenchOfflineQueued => '电脑离线 · 暂时无法发送消息';

  @override
  String get workbenchSteerPlaceholder => '发送新指令…';

  @override
  String get workbenchSendPlaceholder => '发送指令到电脑…';

  @override
  String get workbenchStopTask => '停止任务';

  @override
  String get workbenchSending => '正在发送';

  @override
  String get workbenchSend => '发送';

  @override
  String get workbenchYou => '你';

  @override
  String get workbenchLocalActivity => '本机活动';

  @override
  String get workbenchToday => '今天';

  @override
  String get workbenchYesterday => '昨天';

  @override
  String get workbenchDayBeforeYesterday => '前天';

  @override
  String get workbenchSystemNotice => '系统提醒';

  @override
  String workbenchApprovalSource(String name) {
    return '来源：$name';
  }

  @override
  String workbenchApprovalDirectory(String path) {
    return '目录：$path';
  }

  @override
  String get workbenchApprovalPermission => '请求本机操作权限';

  @override
  String get workbenchSelect => '选择';

  @override
  String get workbenchOtherAnswer => '其他回答…';

  @override
  String get workbenchSkipAnswer => '暂不回答';

  @override
  String get workbenchHighRiskTitle => '允许高风险操作？';

  @override
  String get workbenchOperationOnComputer => '该操作将在你的电脑上执行。';

  @override
  String get workbenchConfirmAllow => '确认允许';

  @override
  String get workbenchAnswerLabel => '回答';

  @override
  String get workbenchAllowOnce => '允许一次';

  @override
  String get workbenchAlwaysAllowSession => '本会话始终允许';

  @override
  String get workbenchAllowAndRemember => '允许并记住这条规则';

  @override
  String get workbenchAlwaysRejectSession => '本会话始终拒绝';

  @override
  String get workbenchRejectAndRemember => '拒绝并记住这条规则';

  @override
  String get workbenchSaveDecisionTitle => '保存这个决定？';

  @override
  String get workbenchSaveDecisionMessage => 'Codex 以后可能对匹配的操作复用这个决定，不再逐次询问。';

  @override
  String get workbenchConfirm => '确认';

  @override
  String get workbenchRejectAndStop => '拒绝并停止当前任务';

  @override
  String get workbenchNotificationSettings => '任务通知';

  @override
  String get workbenchConnectAnother => '连接另一台电脑';

  @override
  String get workbenchConnectAnotherSubtitle => '删除这台手机上的当前内容密钥和设备授权';

  @override
  String get workbenchConnectAnotherTitle => '连接另一台电脑？';

  @override
  String get workbenchConnectAnotherMessage =>
      '当前内容密钥和手机授权令牌会从本机安全凭据库删除。服务器与电脑上的数据不会被删除。';

  @override
  String get workbenchNoSessions => '还没有可用会话';

  @override
  String get workbenchNoSessionsHelp => '保持桌面端在线，或在电脑项目目录中创建新会话。';

  @override
  String get workbenchHistoryLoading => '正在读取历史消息';

  @override
  String get workbenchHistoryLoadingOlder => '正在读取更早记录…';

  @override
  String get workbenchHistoryLimit => '历史只在打开会话后加载，每次最多 500 条';

  @override
  String get workbenchFilePreviewRetry => '文件预览失败，请重试。';

  @override
  String get workbenchSecureFileReading => '正在从电脑安全读取…';

  @override
  String get workbenchFileUnavailable => '文件已失效或已从电脑移除。';

  @override
  String get workbenchApprovalCommand => '执行命令';

  @override
  String get workbenchApprovalFileChange => '修改文件';

  @override
  String get workbenchApprovalChoice => '需要你的选择';

  @override
  String get workbenchApprovalTool => '运行本机工具';

  @override
  String get workbenchStatePending => '待决定';

  @override
  String get workbenchStateDeciding => '发送中';

  @override
  String get workbenchStateApproved => '已批准';

  @override
  String get workbenchStateRejected => '已拒绝';

  @override
  String get workbenchStateExpired => '已失效';

  @override
  String get workbenchLocalRelay => '本机 Relay';

  @override
  String get workbenchEncryptionProtocol => '加密协议';

  @override
  String get workbenchPairingProtocol => '配对协议';

  @override
  String get workbenchRealtimeChannel => '实时通道';

  @override
  String get workbenchTechnicalDetails => '技术详情';

  @override
  String get workbenchRealtimeConnection => '实时连接';

  @override
  String get workbenchHeartbeatPath => 'iPhone ↔ Server · WebSocket';

  @override
  String get workbenchHeartbeatHealthy => '心跳正常';

  @override
  String get workbenchHeartbeatWaiting => '等待首次心跳';

  @override
  String get workbenchLastHeartbeat => '上次心跳';

  @override
  String get workbenchRoundTrip => '往返延迟';

  @override
  String get workbenchWebSocketHeartbeat => 'WebSocket 心跳';

  @override
  String get workbenchDesktopHeartbeat => '电脑心跳';

  @override
  String get workbenchJustNow => '刚刚';

  @override
  String workbenchSecondsAgo(int seconds) {
    return '$seconds 秒前';
  }

  @override
  String workbenchMinutesAgo(int minutes) {
    return '$minutes 分钟前';
  }

  @override
  String get workbenchStateVersion => '状态版本';

  @override
  String get workbenchAwaitingConfirmation => '等待确认';

  @override
  String get workbenchLastConfirmed => '最近确认';

  @override
  String get workbenchEventAck => '事件确认序号';

  @override
  String get workbenchOfflineQueue => '离线队列';

  @override
  String get workbenchSecurityBoundary => '端到端加密边界';

  @override
  String get workbenchPhonePlaintextEndpoint => '手机是业务明文端点';

  @override
  String get workbenchServerCiphertextOnly => 'Server 只保存经过认证的密文 envelope';

  @override
  String get workbenchKeyInSecureStorage => '内容密钥保存在系统安全凭据库';

  @override
  String get workbenchCodeNeverUploaded => '8 位连接码从不上传';

  @override
  String get workbenchNotConfirmed => '尚未确认';

  @override
  String get workbenchRealtimeConnected => 'WebSocket 已连接';

  @override
  String get workbenchRealtimeConnecting => '正在连接';

  @override
  String get workbenchRealtimeReconnecting => '正在恢复';

  @override
  String get workbenchRealtimeIdle => '等待连接';

  @override
  String workbenchNotificationStatus(String status) {
    return '$status · App 后台连接存活时通知；被系统终止后不保证送达';
  }

  @override
  String get workbenchNotificationAllowed => '已允许';

  @override
  String get workbenchNotificationDisabled => '未开启';

  @override
  String get workbenchNotificationUnknown => '状态未知';

  @override
  String get workbenchClose => '关闭';

  @override
  String get workbenchProjectConfiguration => '项目配置';

  @override
  String get workbenchProjectConfigurationTitle => '项目配置信息';

  @override
  String get workbenchProjectName => '项目名称';

  @override
  String get workbenchProjectNameHelp => '仅修改本 App 中显示的名称，不会重命名电脑上的目录。';

  @override
  String get workbenchFullPath => '完整路径';

  @override
  String get workbenchProjectPathUnavailable => '电脑未提供项目路径';

  @override
  String workbenchSessionCount(int count) {
    return '$count 个会话';
  }

  @override
  String workbenchMoreSessions(int count) {
    return '展开更多会话（$count）';
  }

  @override
  String get workbenchAgentRunning => 'Agent 正在运行';

  @override
  String get workbenchAgentNotRunning => 'Agent 未运行';

  @override
  String get workbenchRunning => '运行中';

  @override
  String get workbenchKimiSettings => 'Kimi 设置';

  @override
  String get workbenchEnableYoloTitle => '启用 YOLO 模式？';

  @override
  String get workbenchEnableAutoTitle => '启用 Auto 模式？';

  @override
  String get workbenchYoloWarning => 'Kimi 将自动批准更多本机工具调用。请只在你信任当前任务和项目时启用。';

  @override
  String get workbenchAutoWarning => 'Kimi 会自动批准常规工具调用，但仍可能向你提问。';

  @override
  String get workbenchConfirmEnable => '确认启用';

  @override
  String get workbenchUploadTooManyImages => '每条消息最多添加 4 张图片。';

  @override
  String workbenchUploadUnsupportedImages(String names) {
    return '不支持 $names；请选择 PNG、JPEG、WebP、GIF 或 AVIF。';
  }

  @override
  String get workbenchUploadTooLarge => '附件总大小不能超过 20 MiB。';

  @override
  String workbenchPreviewGenerateFailed(String name) {
    return '读取或生成 $name 的预览失败，请重试。';
  }

  @override
  String get workbenchKimiViewAgents => '查看子 Agents';

  @override
  String get workbenchKimiViewAgentsDescription =>
      '展开输入框上方的 Agent 工作窗口，不启动新的模型任务。';

  @override
  String get workbenchKimiOpenNow => '立即打开';

  @override
  String get workbenchKimiSessionStatus => '会话状态';

  @override
  String get workbenchKimiSessionStatusDescription => '查看任务、审批、上下文和本机同步状态。';

  @override
  String get workbenchKimiLocalStatus => '本机状态';

  @override
  String get workbenchKimiModel => '模型';

  @override
  String get workbenchKimiModelDescription => '切换当前 Kimi 会话使用的模型。';

  @override
  String get workbenchKimiSessionSettings => '会话设置';

  @override
  String get workbenchKimiPermissionMode => '权限模式';

  @override
  String get workbenchKimiPermissionModeDescription => '查看或更改本机工具审批策略。';

  @override
  String get workbenchKimiSecuritySettings => '安全设置';

  @override
  String get workbenchKimiPlanMode => 'Plan 模式';

  @override
  String get workbenchKimiPlanModeDescription => '让 Kimi 先规划，再执行任务。';

  @override
  String get workbenchKimiYoloMode => 'YOLO 模式';

  @override
  String get workbenchKimiYoloModeDescription => '自动批准更多工具调用；启用前必须确认。';

  @override
  String get workbenchKimiConfirmationRequired => '需要确认';

  @override
  String get workbenchKimiSettingsDescription => '打开模型、Thinking 和权限配置。';

  @override
  String workbenchKimiInputRequired(String hint) {
    return '需要输入：$hint';
  }

  @override
  String get workbenchKimiNativeCommandDescription =>
      'Kimi ACP 原生命令，将作为真实命令任务运行。';

  @override
  String get workbenchKimiNativeCommand => '原生命令';

  @override
  String get workbenchKimiContextSyncing => '上下文等待同步';

  @override
  String get workbenchKimiWaitingForSync => '等待同步';

  @override
  String workbenchKimiContextUsage(int percent, String used, String size) {
    return '上下文 $percent% · $used/$size';
  }

  @override
  String workbenchKimiContextUsed(String used) {
    return '上下文 $used';
  }

  @override
  String get workbenchKimiContext => '上下文';

  @override
  String get workbenchKimiModelSyncing => '模型待同步';

  @override
  String get workbenchKimiQuickCommands => '快捷命令';

  @override
  String get workbenchKimiNoMatchingCommands => '没有匹配的命令';

  @override
  String get workbenchKimiTask => '任务';

  @override
  String get workbenchKimiIdle => '空闲';

  @override
  String get workbenchKimiSubagents => '子 Agents';

  @override
  String workbenchKimiActiveCount(int count) {
    return '$count 活动';
  }

  @override
  String get workbenchKimiApprovals => '审批';

  @override
  String workbenchKimiPendingCount(int count) {
    return '$count 待处理';
  }

  @override
  String get workbenchKimiSettingsOffline => 'Relay 离线时不能更改 Kimi 设置。';

  @override
  String get workbenchKimiSettingsRunning => 'Kimi 主任务运行中，请停止后再更改设置。';

  @override
  String get workbenchKimiNoOptions => '电脑尚未同步可配置项。';

  @override
  String get workbenchKimiEncryptedSettings =>
      '设置端到端加密发送给本机 Kimi Code，Server 不读取配置内容。';

  @override
  String get workbenchKimiManualApproval => '手动审批';

  @override
  String get workbenchSessionSettings => '会话设置';

  @override
  String get workbenchSessionSettingsOffline => 'Relay 离线时不能更改会话设置。';

  @override
  String get workbenchSessionSettingsRunning => '当前任务运行中，请停止后再更改设置。';

  @override
  String get workbenchNoConfigOptions => '电脑尚未同步可配置项。';

  @override
  String workbenchEncryptedSessionSettings(String provider) {
    return '设置端到端加密发送给本机 $provider，Server 不读取配置内容。';
  }

  @override
  String get workbenchUnrestrictedPermissionsTitle => '更改权限模式？';

  @override
  String get workbenchUnrestrictedPermissionsWarning =>
      '此设置会改变本机工具是被允许、拒绝还是需要审批。继续前请确认所选模式。';

  @override
  String get workbenchCoworkCreateOnDesktop =>
      '请先在 Claude Desktop 创建 Cowork 任务；已有任务可在这里控制。';

  @override
  String get workbenchProcessing => '处理中';

  @override
  String get workbenchProcess => '处理过程';

  @override
  String workbenchDurationMinutesSeconds(int minutes, int seconds) {
    return '$minutes 分 $seconds 秒';
  }

  @override
  String workbenchDurationSeconds(int seconds) {
    return '$seconds 秒';
  }

  @override
  String workbenchMonthDay(int month, int day) {
    return '$month月$day日';
  }

  @override
  String workbenchYearMonthDay(int year, int month, int day) {
    return '$year年$month月$day日';
  }

  @override
  String get workbenchImageUrlUnavailable => '图片地址不可用。';

  @override
  String workbenchFilePreviewAvailable(String kind) {
    return '可预览 · $kind · 不超过 1 MB';
  }

  @override
  String get workbenchFilePreviewUnsupported => '暂不支持预览此文件格式';

  @override
  String workbenchImageReadFailed(String name) {
    return '$name\n图片读取失败';
  }

  @override
  String workbenchImageThumbnailLabel(String name) {
    return '$name 缩略图，点按打开预览';
  }

  @override
  String get workbenchViewOriginal => '查看原图';

  @override
  String get workbenchLoadingOriginal => '正在安全读取原图…';

  @override
  String get workbenchOriginalReadFailed => '原图读取失败，请重试。';

  @override
  String workbenchActivityFailed(String label) {
    return '$label失败';
  }

  @override
  String workbenchActivityCompleted(String label) {
    return '已$label';
  }

  @override
  String workbenchActivityRunning(String label) {
    return '正在$label';
  }

  @override
  String get workbenchViewOutput => '点击查看输出';

  @override
  String get workbenchViewThumbnail => '点击查看缩略图';

  @override
  String get workbenchSemanticSeparator => '，';

  @override
  String workbenchCommandsRunning(int count) {
    return '正在执行 $count 个命令';
  }

  @override
  String workbenchCommandsFailed(int count) {
    return '执行 $count 个命令时有失败';
  }

  @override
  String workbenchCommandsCompleted(int count) {
    return '已执行 $count 个命令';
  }

  @override
  String workbenchFilesReading(int count) {
    return '正在读取 $count 个文件';
  }

  @override
  String workbenchFilesReadFailed(int count) {
    return '读取 $count 个文件时有失败';
  }

  @override
  String workbenchFilesRead(int count) {
    return '已读取 $count 个文件';
  }

  @override
  String workbenchFilesChanging(int count) {
    return '正在修改 $count 个文件';
  }

  @override
  String workbenchFilesChangeFailed(int count) {
    return '修改 $count 个文件时有失败';
  }

  @override
  String workbenchFilesChanged(int count) {
    return '已修改 $count 个文件';
  }

  @override
  String workbenchOperationsRunning(int count) {
    return '正在处理 $count 项文件与命令操作';
  }

  @override
  String workbenchOperationsFailed(int count) {
    return '$count 项文件与命令操作有失败';
  }

  @override
  String workbenchOperationsCompleted(int count) {
    return '已完成 $count 项文件与命令操作';
  }

  @override
  String get workbenchToolCommand => '执行命令';

  @override
  String workbenchToolReadFilesSubject(int count, String subject) {
    return '读取 $count 个文件：$subject';
  }

  @override
  String workbenchToolReadFiles(int count) {
    return '读取 $count 个文件';
  }

  @override
  String workbenchToolReadFileSubject(String subject) {
    return '读取文件：$subject';
  }

  @override
  String get workbenchToolReadFile => '读取文件';

  @override
  String workbenchToolChangeFilesSubject(int count, String subject) {
    return '修改 $count 个文件：$subject';
  }

  @override
  String workbenchToolChangeFiles(int count) {
    return '修改 $count 个文件';
  }

  @override
  String workbenchToolChangeFileSubject(String subject) {
    return '修改文件：$subject';
  }

  @override
  String get workbenchToolChangeFile => '修改文件';

  @override
  String workbenchToolCallNamed(String name) {
    return '调用工具：$name';
  }

  @override
  String get workbenchToolCall => '调用工具';

  @override
  String workbenchToolWebSearchSubject(String subject) {
    return '搜索网页：$subject';
  }

  @override
  String get workbenchToolWebSearch => '搜索网页';

  @override
  String workbenchToolImageViewSubject(String subject) {
    return '查看图像：$subject';
  }

  @override
  String get workbenchToolImageView => '查看图像';

  @override
  String get workbenchToolImageGeneration => '生成图片';

  @override
  String get workbenchToolContextCompaction => '自动压缩上下文';

  @override
  String get workbenchToolWait => '等待任务';

  @override
  String get workbenchLocalOperation => '本机操作';

  @override
  String get workbenchDeliverySent => '发送成功';

  @override
  String get workbenchDeliverySending => '发送中';

  @override
  String get workbenchDeliveryFailed => '发送失败';

  @override
  String workbenchAssistantRunningElapsed(String agent, String duration) {
    return '$agent 正在运行，已运行 $duration';
  }

  @override
  String workbenchAssistantRunning(String agent) {
    return '$agent 正在运行';
  }

  @override
  String workbenchAssistantElapsed(String duration) {
    return '· 已运行 $duration';
  }

  @override
  String get workbenchCloseFilePreview => '关闭文件预览';

  @override
  String workbenchFileReadCompleted(String name) {
    return '文件读取完成：$name';
  }

  @override
  String workbenchFileReading(String name) {
    return '正在读取文件：$name';
  }

  @override
  String workbenchFileReadFailed(String message) {
    return '文件读取失败：$message';
  }

  @override
  String get workbenchFilePreviewFailed => '文件预览失败，请重试。';

  @override
  String get workbenchFileKindTableText => '表格文本';

  @override
  String get workbenchFileKindLog => '日志';

  @override
  String get workbenchFileKindPlainText => '纯文本';

  @override
  String get workbenchFileKindCodeOrConfig => '代码或配置';

  @override
  String workbenchAgentsWorking(int count) {
    return '$count 个子 Agent 并行处理中';
  }

  @override
  String get workbenchAgentWindow => 'Agent 工作窗口';

  @override
  String get workbenchAgentWindowDescription => '同步任务状态与工具活动，不展示私有推理';

  @override
  String workbenchMoreAgents(int count) {
    return '另 $count 个 Agent · 向下滑动查看';
  }

  @override
  String workbenchCurrentActivity(String activity) {
    return '当前 · $activity';
  }

  @override
  String get workbenchAllAgents => '全部 Agent';

  @override
  String get workbenchActivityTimeline => '活动时间线';

  @override
  String workbenchActivityCount(int count) {
    return '$count 条';
  }

  @override
  String get workbenchAgentSyncing => '正在从这台电脑同步…';

  @override
  String get workbenchNoPublicActivity => '暂无公开活动。这里只同步任务状态与工具活动，不同步模型私有推理。';

  @override
  String get workbenchLatestResult => '最新结果';

  @override
  String get workbenchWaitingForTask => '等待分配任务';

  @override
  String get controllerRestoreFailed => '无法恢复安全连接，请重新登录或配对。';

  @override
  String get controllerAuthorizationRevoked => '这台手机的授权已被取消，请重新连接。';

  @override
  String get controllerDeviceNotConnected => '当前账户未连接这台电脑，请在电脑端重新开始连接。';

  @override
  String get controllerProjectNameRequired => '项目名称不能为空。';

  @override
  String controllerProjectNameTooLong(int maximum) {
    return '项目名称不能超过 $maximum 个字符。';
  }

  @override
  String get controllerProjectNameSaveFailed => '项目名称未能保存到本机，请重试。';

  @override
  String get controllerProjectNameUpdated => '项目名称已更新。';

  @override
  String get controllerNewPairingLinkReceived => '已收到新的连接链接；退出当前设备后可重新连接。';

  @override
  String get controllerPairingLinkRequired => '请输入桌面端提供的 Relayune 连接链接。';

  @override
  String get controllerPairingDiscoveryFailed => '无法查找待连接的电脑，请稍后重试。';

  @override
  String get controllerVerificationResent => '验证邮件已重新发送。';

  @override
  String get controllerSetPasswordFirst => '请先在邮件链接中设置密码，然后返回此处。';

  @override
  String get controllerNoPendingComputer => '未发现待连接的电脑，请先在电脑端点击“连接新客户端”。';

  @override
  String get controllerSelectComputer => '请选择要连接的电脑。';

  @override
  String get controllerPairingFailed => '安全连接失败，请检查连接码并重试。';

  @override
  String get controllerHistoryReadFailed => '无法读取历史记录。';

  @override
  String get controllerAgentRefreshFailed => '暂时无法刷新这个子 Agent 的运行内容。';

  @override
  String get controllerAttachmentTooLarge => '超过 1 MB 的文件暂不支持预览。';

  @override
  String get controllerAttachmentUnsupported => '暂不支持预览此文件格式。';

  @override
  String get controllerAttachmentGone => '文件已失效或已从电脑移除。';

  @override
  String get controllerAttachmentReadFailed => '无法读取附件。';

  @override
  String controllerUploadTooMany(int maximum) {
    return '每条消息最多上传 $maximum 张图片。';
  }

  @override
  String get controllerUploadTotalTooLarge => '每条消息的附件总大小不能超过 20 MiB。';

  @override
  String get controllerUploadUnsupported => '请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片。';

  @override
  String get controllerSteeringUnsupported => '当前任务不支持追加指令，请先停止任务。';

  @override
  String get controllerPreparingAgent => '本机已收到，正在准备 Agent';

  @override
  String get controllerWaitingForAgent => '正在等待本机 Agent 接收';

  @override
  String get controllerWaitingForComputer => '等待电脑上线后处理';

  @override
  String get controllerStopSent => '停止请求已发送。';

  @override
  String get controllerApprovalExpired => '这项审批已经过期。';

  @override
  String get controllerApprovalOffline => '电脑离线时不能处理审批。';

  @override
  String get controllerApprovalAllowedSent => '允许决定已发送，等待电脑确认。';

  @override
  String get controllerApprovalRejectedSent => '拒绝决定已发送，等待电脑确认。';

  @override
  String controllerDelegatedTasks(int count) {
    return '已委派 $count 个并行任务。';
  }

  @override
  String get controllerSelectProject => '请先从侧边栏选择一个已同步的项目。';

  @override
  String get controllerCreateSessionOffline => '电脑离线，暂时无法创建会话。';

  @override
  String controllerSessionNameLength(int maximum) {
    return '会话名称需为 1–$maximum 个字符。';
  }

  @override
  String get controllerSessionCreationBusy => '上一个会话仍在创建，请稍候。';

  @override
  String controllerSessionCreating(String name) {
    return '正在创建「$name」…';
  }

  @override
  String get controllerSessionCreateFailed => '创建会话失败，请稍后重试。';

  @override
  String get controllerDesktopSessionCreateFailed => '电脑端创建会话失败。';

  @override
  String get controllerSessionCreateTimeout => '等待电脑端创建会话超时，请稍后查看，无需重复创建。';

  @override
  String controllerSessionCreated(String name) {
    return '已创建「$name」。';
  }

  @override
  String get controllerCoworkCreateOnDesktop =>
      '请先在 Claude Desktop 创建 Cowork 任务，再从这里控制。';

  @override
  String get controllerDesktopConfigFailed => '电脑端未能应用会话设置。';

  @override
  String get controllerConfigApplied => '会话设置已应用。';

  @override
  String get controllerConfigUpdateFailed => '会话设置更新失败，请稍后重试。';

  @override
  String get controllerConfigTimeout => '等待电脑端应用会话设置超时，请刷新后确认。';

  @override
  String get controllerInvalidEncryptedEvent => '收到无法验证的加密事件，已停止推进同步游标。';

  @override
  String get controllerApprovalNeeded => '等待你的审批';

  @override
  String get controllerContinuing => '正在继续处理';

  @override
  String get controllerApprovalProcessFailed => '电脑未能处理这项审批，请重试。';

  @override
  String controllerAgentProcessing(String name) {
    return '$name 正在处理';
  }

  @override
  String get controllerSummarizing => '正在汇总结果';

  @override
  String get controllerThinking => '思考中';

  @override
  String get controllerLocalTaskFailed => '本机任务失败。';

  @override
  String get controllerInterruptFailed => '无法停止当前任务。';

  @override
  String get controllerReplying => '正在回复';

  @override
  String get controllerFinishing => '正在收尾';

  @override
  String get controllerOrganizingFileChanges => '正在整理文件修改';

  @override
  String controllerFilesModified(int count) {
    return '已修改 $count 个文件。';
  }

  @override
  String get controllerUpdatingPlan => '正在更新计划';

  @override
  String get controllerMessageQueued => '消息已排队，稍后会自动发送。';

  @override
  String controllerSessionPersisted(String agent) {
    return '会话已写入 $agent。';
  }

  @override
  String controllerLocalTool(String label) {
    return '本机工具：$label';
  }

  @override
  String get controllerProcessingLocalResult => '正在处理本机结果';

  @override
  String get controllerEncryptedResponseTimeout => '等待电脑端加密响应超时。';

  @override
  String get controllerPairingUsedOrExpired => '这次连接已被使用或已经过期。';

  @override
  String get controllerPairingConfirmationTimeout => '电脑端确认超时，请重新开始连接。';

  @override
  String get controllerPairingConfirmationFailed => '电脑未通过加密确认，请重新连接。';

  @override
  String get controllerDesktopOffline => '电脑端尚未上线，请保持 Relayune 打开后重试。';

  @override
  String get workbenchDefault => '默认';

  @override
  String workbenchAgentToolCount(int count) {
    return '$count 个工具';
  }

  @override
  String workbenchAgentTokenCount(String count) {
    return '$count tok';
  }

  @override
  String get apiErrorNetworkUnavailable => '无法连接 Relayune，请检查网络后重试。';

  @override
  String get apiErrorTimeout => '请求超时，请重试。';

  @override
  String get apiErrorInvalidResponse => 'Relayune 收到无法识别的服务器响应，请重试。';

  @override
  String get apiErrorInvalidCredentials => '邮箱或密码不正确。';

  @override
  String get apiErrorAuthentication => '登录已失效，请重新登录。';

  @override
  String get apiErrorService => 'Relayune 服务暂时不可用，请稍后重试。';

  @override
  String get apiErrorGeneric => '操作失败，请重试。';

  @override
  String get controllerFileAccessDenied =>
      '电脑上的 Relayune 无法读取部分会话文件。请检查文件访问权限；Mac 可在“系统设置 → 隐私与安全性 → 文件与文件夹”中允许访问，然后重试。';

  @override
  String get workbenchImageWaiting => '等待加载';

  @override
  String get workbenchImageLoading => '加载中';

  @override
  String get feedbackTitle => '用户反馈';

  @override
  String get feedbackIntro => '哪里还可以更好？';

  @override
  String get feedbackSubtitle => '体验建议或遇到的问题，都欢迎告诉我们。';

  @override
  String get feedbackSuggestion => '体验建议';

  @override
  String get feedbackBug => 'Bug 问题';

  @override
  String get feedbackDescription => '反馈描述';

  @override
  String get feedbackSuggestionHint => '希望改善什么？它会如何帮助你？';

  @override
  String get feedbackBugHint => '你做了什么、预期发生什么、实际遇到了什么？';

  @override
  String get feedbackInfo => '随反馈附带的信息';

  @override
  String get feedbackPrivacy => '设备信息会随反馈提交，不会自动上传聊天内容或日志。';

  @override
  String get feedbackVersion => 'App 版本';

  @override
  String get feedbackModel => '设备型号';

  @override
  String get feedbackSystem => '操作系统';

  @override
  String get feedbackUnknown => '未获取';

  @override
  String get feedbackLoading => '正在读取设备信息…';

  @override
  String get feedbackSend => '提交反馈';

  @override
  String get feedbackFailed => '提交失败，内容已保留。请检查网络后重试。';

  @override
  String get feedbackEmpty => '请先填写反馈描述。';

  @override
  String get feedbackSending => '正在提交…';

  @override
  String get feedbackSubmitNote => '提交后会保存你的描述和上方信息，供我们排查与改进。';

  @override
  String get feedbackSuccess => '反馈已收到，感谢你的帮助。';

  @override
  String get feedbackReference => '反馈编号';

  @override
  String get feedbackDone => '完成';

  @override
  String get workbenchStoppingTask => '正在停止…';

  @override
  String get workbenchStopUnconfirmed => '还未确认停止，请重试。';

  @override
  String get workbenchPreparingImages => '正在准备图片…';

  @override
  String get workbenchImagePickFailed => '无法打开相册，请重试。';

  @override
  String get feedbackImages => '图片';

  @override
  String get feedbackOptional => '选填';

  @override
  String get feedbackImageLimit => '最多可添加 3 张图片。';

  @override
  String get feedbackImageFailed => '图片添加失败，请换一张图片或重试。';

  @override
  String get feedbackImagePreview => '图片预览';

  @override
  String get feedbackRemoveImage => '移除图片';

  @override
  String get feedbackPreparingImages => '正在处理图片…';

  @override
  String get feedbackAddImage => '添加图片';

  @override
  String get feedbackImagesHint => '添加截图，帮助我们更快理解问题。';

  @override
  String get feedbackContact => '联系方式';

  @override
  String get feedbackEmail => '邮箱';

  @override
  String get feedbackEmailHint => '自动填入登录邮箱，可修改或清空';

  @override
  String get feedbackWechat => '微信号';

  @override
  String get feedbackWechatHint => '填写你的微信号';

  @override
  String get feedbackContactHint => '仅用于回复这条反馈，不填写也能提交。';

  @override
  String get feedbackEmailInvalid => '请填写有效邮箱，或留空。';

  @override
  String get deviceAgents => 'Agent';

  @override
  String get deviceAgentReady => '已接入';

  @override
  String get deviceAgentRunning => '运行中';

  @override
  String get deviceAgentNotInstalled => '未安装';

  @override
  String get deviceAgentUnavailable => '不可用';

  @override
  String get deviceAgentNotEnabled => '未启用';

  @override
  String get deviceAgentUnknown => '尚未上报';

  @override
  String get deviceAgentOffline => '电脑离线 · 显示上次检测结果';

  @override
  String get openingTitle => '远处，仍在继续。';

  @override
  String get openingSubtitle => '随时接上电脑里的 AI 工作。';

  @override
  String get openingSkip => '跳过动画';

  @override
  String get deviceQuota => '订阅额度';

  @override
  String get quotaFiveHour => '5 小时';

  @override
  String get quotaSevenDay => '7 天';

  @override
  String quotaUsed(String percent) {
    return '已用 $percent%';
  }

  @override
  String quotaResets(String time) {
    return '$time 重置';
  }

  @override
  String quotaUpdated(String time) {
    return '更新于 $time';
  }

  @override
  String get quotaPending => '尚未上报';

  @override
  String get quotaExpired => '等待新额度';

  @override
  String get quotaLimitReached => '已达上限';

  @override
  String get quotaSnapshot => '上次检测';

  @override
  String get quotaClaudeHint => 'Claude 在会话运行时上报额度；未上报的窗口不显示估算值。';

  @override
  String get settingsHapticsTitle => '触觉反馈';

  @override
  String get settingsHapticsSubtitle => '连接或决定确认后，给予轻微触感。';

  @override
  String get workbenchBackToLatest => '回到最新';

  @override
  String get settingsFontSize => '字体大小';

  @override
  String get settingsFontSizeSmall => '小';

  @override
  String get settingsFontSizeMedium => '中';

  @override
  String get settingsFontSizeLarge => '大';

  @override
  String get settingsFontSizeSaveFailed => '字号已切换，但未能保存，请重试。';

  @override
  String get workbenchAgentOrderHint => '长按并拖动可调整顺序';

  @override
  String get workbenchAgentOrderSaveFailed => '顺序已调整，但未能保存，请重试。';

  @override
  String get settingsBuildInfo => '版本信息';

  @override
  String get buildTime => '构建时间';

  @override
  String get buildSourceCommit => '代码版本';

  @override
  String get buildUnrecorded => '未记录';

  @override
  String get buildUncommitted => '含未提交改动';

  @override
  String get agentTasksTitle => '子任务';

  @override
  String agentTasksCount(int count) {
    return '$count 个子任务';
  }

  @override
  String agentTasksViewAll(int count) {
    return '查看全部 $count 个子任务';
  }

  @override
  String agentTasksRunning(int count) {
    return '$count 个运行中';
  }

  @override
  String agentTasksFinished(int count) {
    return '$count 个已结束';
  }

  @override
  String get agentTasksAttention => '需要你处理';

  @override
  String get agentTasksInProgress => '进行中';

  @override
  String get agentTasksEnded => '已结束';

  @override
  String get agentTaskPreparing => '准备中';

  @override
  String get agentTaskUnknown => '状态待同步';

  @override
  String get agentTaskCompleted => '已完成';

  @override
  String get agentTaskFailed => '失败';

  @override
  String get agentTaskStopped => '已停止';

  @override
  String get agentTaskAnswer => '等你回答';

  @override
  String get agentTaskApprove => '等你批准';

  @override
  String get agentTaskNoResult => '尚未收到结果';

  @override
  String get agentTaskInstructions => '任务原文';

  @override
  String get agentTaskRuntime => '运行信息';

  @override
  String agentTaskParent(String name) {
    return '来自：$name';
  }

  @override
  String agentTaskUpdated(String time) {
    return '更新于 $time';
  }

  @override
  String get agentTaskOffline => '电脑离线 · 显示最后已知状态';

  @override
  String get agentTaskOpenConversation => '查看历史会话';

  @override
  String get agentTaskEmpty => '暂无子任务';

  @override
  String get agentTaskFinishedResult => '最新回复';

  @override
  String get liveTaskRunning => '正在工作';

  @override
  String get liveTaskApproval => '等待确认';

  @override
  String get liveTaskQuestion => '等待回答';

  @override
  String get liveTaskCompleted => '已完成';

  @override
  String get liveTaskFailed => '任务失败';

  @override
  String get liveTaskStopped => '已停止';

  @override
  String get liveTaskStale => '状态待同步';

  @override
  String get liveTaskOpen => '查看任务';

  @override
  String get liveTaskReview => '前往处理';

  @override
  String get liveTaskElapsed => '已用时';

  @override
  String get liveTaskUpdated => '最近同步';

  @override
  String get androidPushDisclosure =>
      '启用后，极光推送及支持设备上的 vivo 推送会处理推送标识、Android ID、设备与系统及网络信息，用于后台提醒。不会向它们发送任务内容或加密密钥。可随时在系统设置关闭通知。';

  @override
  String get controllerSessionUnavailable =>
      '当前电脑暂时无法打开这个会话。请确认对应 Agent 已启动且会话仍在，再重试或新建会话。';

  @override
  String get settingsSidebarAgents => '侧边栏 Agent';

  @override
  String get settingsSidebarAgentsSubtitle => '选择在侧边栏显示的 Agent';

  @override
  String get turnStatusRunning => '处理中';

  @override
  String get turnStatusCompleted => '本轮完成';

  @override
  String get turnStatusInterrupted => '本次处理未完成';

  @override
  String get turnStatusUnknown => '处理记录';

  @override
  String get localWebTitle => '电脑网页';

  @override
  String get localWebOpen => '打开网页';

  @override
  String get localWebNotice => '此页面可以加载资源，并向电脑上的这个地址提交表单或 API 请求。';

  @override
  String get localWebUnavailable =>
      '网页暂时无法访问，请检查电脑和本地服务是否运行。提交超时不代表失败，请核对结果后再提交。';

  @override
  String get localWebUpdate => '请更新桌面端后再预览电脑网页。';

  @override
  String get localWebPaused => '应用离开前台后已关闭预览，重新打开即可继续。';

  @override
  String get localWebRefresh => '刷新网页';

  @override
  String get localWebBack => '上一页';

  @override
  String get localWebBlocked => '此预览只能访问当前选定的电脑地址。';

  @override
  String get localWebForward => '下一页';

  @override
  String get localWebAddress => '网页地址';

  @override
  String get localWebLoading => '正在连接你的电脑…';

  @override
  String get accountDeletionTitle => '删除账户';

  @override
  String get accountDeletionBody =>
      '此操作会永久删除你的 Relayune 账户、设备授权、偏好设置和已提交的反馈。已登录的设备将失去访问权限。本手机上的历史缓存密钥也会被移除。电脑上的 Agent 项目和文件不会被删除。';

  @override
  String get accountDeletionPassword => '确认密码';

  @override
  String get accountDeletionConfirm => '永久删除我的账户';

  @override
  String get accountDeletionBusy => '正在删除…';

  @override
  String get accountDeletionWrongPassword => '密码错误，请重试。';

  @override
  String get accountDeletionFailed =>
      '未能完成删除，请检查网络后重试。如果删除已开始，账户的其他访问权限将保持停用，直到清理完成。';

  @override
  String get accountDeletionDone => '你的账户已删除。';

  @override
  String get controllerPendingInputSaveFailed => '消息未能保存到这台手机。请检查存储空间后重试。';

  @override
  String get workbenchHistoryRequestSending => '正在发送读取请求';

  @override
  String get workbenchHistoryWaitingComputer => '等待电脑回应';

  @override
  String get workbenchHistoryReadingComputer => '电脑正在读取历史消息';

  @override
  String get workbenchHistoryPreparing => '正在整理消息';

  @override
  String workbenchHistoryElapsed(int seconds) {
    return '已用时 $seconds 秒';
  }

  @override
  String get workbenchHistoryTransferring => '正在传输历史消息';

  @override
  String workbenchHistorySourceRead(String read, String total) {
    return '电脑已读取 $read / $total';
  }

  @override
  String workbenchHistoryPendingTransfer(String size) {
    return '本页待传输 $size';
  }

  @override
  String workbenchHistoryReceived(String size) {
    return '已接收 $size';
  }

  @override
  String workbenchHistoryPendingReceive(String size) {
    return '待接收 $size';
  }

  @override
  String get workbenchHistoryReadingCache => '正在读取本机缓存';

  @override
  String get localWebResources => '网页资源';

  @override
  String get localWebGettingPage => '正在获取网页…';

  @override
  String get localWebLoadingPage => '正在加载页面…';

  @override
  String localWebResourceSummary(int completed, int active) {
    return '$completed 项已取回 · $active 项进行中';
  }

  @override
  String localWebResourceFailures(int count) {
    return '$count 项失败';
  }

  @override
  String get localWebResourceWaiting => '等待响应';

  @override
  String get localWebResourceReceiving => '正在接收';

  @override
  String get localWebResourcePreparing => '正在处理';

  @override
  String get localWebResourceComplete => '已取回';

  @override
  String get localWebResourceFailed => '获取失败';

  @override
  String get localWebResourceCancelled => '已停止';

  @override
  String get localWebResourceTransferNote => '进度表示响应接收情况，网页可能继续请求资源。';

  @override
  String get localWebResourceEmpty => '网页请求的资源会显示在这里。';

  @override
  String localWebResourceRecent(int count) {
    return '显示最近 $count 项资源';
  }

  @override
  String localWebElapsed(String seconds) {
    return '$seconds 秒';
  }

  @override
  String get localWebOpeningTitle => '电脑上的网页';

  @override
  String get localWebOpeningHint => '保持电脑和网页服务运行，页面会自动出现。';

  @override
  String get replyBranchLabel => '分支到新聊天';

  @override
  String get replyBranchSameDirectory => '使用原项目目录';

  @override
  String get replyBranchSameDirectoryDescription => '继续共用项目文件';

  @override
  String get replyBranchWorktree => '创建新 worktree';

  @override
  String get replyBranchWorktreeDescription => '独立目录，基于当前提交';

  @override
  String get controllerReplyBranchOffline => '连接电脑后可分支';

  @override
  String get controllerReplyBranchCreating => '正在创建新聊天…';

  @override
  String get controllerReplyBranchCreated => '已分支到新聊天，继续使用原项目目录。';

  @override
  String get controllerReplyBranchFailed => '未能创建新聊天，请重试。';

  @override
  String get controllerReplyBranchUnconfirmed => '暂未确认分支结果，请保持连接后重试查询。';

  @override
  String get controllerReplyBranchUnavailable => '此回复暂不能分支，请刷新会话。';

  @override
  String get controllerReplyBranchBusy => '正在处理聊天操作，请稍后重试。';

  @override
  String get controllerReplyBranchWorktreeFailed =>
      '未能创建 worktree，请在电脑上检查项目后重试。';

  @override
  String get controllerReplyBranchWorktreeCreated => '已分支到新聊天，使用独立 worktree。';

  @override
  String agentTasksCompletedCount(int count) {
    return '$count 个已完成';
  }

  @override
  String agentTasksStoppedCount(int count) {
    return '$count 个已停止';
  }

  @override
  String agentTasksFailedCount(int count) {
    return '$count 个失败';
  }

  @override
  String agentTasksPreparingCount(int count) {
    return '$count 个准备中';
  }

  @override
  String agentTasksUnknownCount(int count) {
    return '$count 个待同步';
  }

  @override
  String get agentTasksSearch => '搜索任务、昵称或模型';

  @override
  String get agentTasksNoMatches => '没有匹配的子任务';

  @override
  String get agentTaskModelConfiguration => '模型配置';
}
