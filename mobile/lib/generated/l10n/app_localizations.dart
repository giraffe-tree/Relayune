import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_ar.dart';
import 'app_localizations_bn.dart';
import 'app_localizations_en.dart';
import 'app_localizations_es.dart';
import 'app_localizations_fr.dart';
import 'app_localizations_hi.dart';
import 'app_localizations_id.dart';
import 'app_localizations_pt.dart';
import 'app_localizations_ur.dart';
import 'app_localizations_zh.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('ar'),
    Locale('bn'),
    Locale('en'),
    Locale('es'),
    Locale('fr'),
    Locale('hi'),
    Locale('id'),
    Locale('pt'),
    Locale('ur'),
    Locale('zh'),
    Locale('zh', 'CN'),
  ];

  /// No description provided for @workbenchStateAnswered.
  ///
  /// In en, this message translates to:
  /// **'Answered'**
  String get workbenchStateAnswered;

  /// No description provided for @workbenchTurnIncomplete.
  ///
  /// In en, this message translates to:
  /// **'This run did not complete'**
  String get workbenchTurnIncomplete;

  /// No description provided for @controllerQueueUnconfirmed.
  ///
  /// In en, this message translates to:
  /// **'Message processing status is unconfirmed. Refresh the conversation to check.'**
  String get controllerQueueUnconfirmed;

  /// Mobile home time-of-day greeting. Translate naturally for this local time; noon is 12:00–14:00.
  ///
  /// In en, this message translates to:
  /// **'Good morning'**
  String get homeGreetingMorning;

  /// Mobile home time-of-day greeting. Translate naturally for this local time; noon is 12:00–14:00.
  ///
  /// In en, this message translates to:
  /// **'Good afternoon'**
  String get homeGreetingNoon;

  /// Mobile home time-of-day greeting. Translate naturally for this local time; noon is 12:00–14:00.
  ///
  /// In en, this message translates to:
  /// **'Good afternoon'**
  String get homeGreetingAfternoon;

  /// Mobile home time-of-day greeting. Translate naturally for this local time; noon is 12:00–14:00.
  ///
  /// In en, this message translates to:
  /// **'Good evening'**
  String get homeGreetingEvening;

  /// Mobile home time-of-day greeting. Translate naturally for this local time; noon is 12:00–14:00.
  ///
  /// In en, this message translates to:
  /// **'A quiet night'**
  String get homeGreetingNight;

  /// Mobile home quiet care message. Keep concise, warm and optional; avoid guilt, productivity pressure or promises about task success. Naturally localize the metaphor.
  ///
  /// In en, this message translates to:
  /// **'You’ve focused a while. Take a longer break if you’d like.'**
  String get homeCareLongBreak;

  /// Mobile home quiet care message. Keep concise, warm and optional; avoid guilt, productivity pressure or promises about task success. Naturally localize the metaphor.
  ///
  /// In en, this message translates to:
  /// **'A sip of water, a look outside. A moment for you.'**
  String get homeCarePause;

  /// Mobile home quiet care message. Keep concise, warm and optional; avoid guilt, productivity pressure or promises about task success. Naturally localize the metaphor.
  ///
  /// In en, this message translates to:
  /// **'Still working? Leave a little room for rest tonight.'**
  String get homeCareNightWorking;

  /// Mobile home quiet care message. Keep concise, warm and optional; avoid guilt, productivity pressure or promises about task success. Naturally localize the metaphor.
  ///
  /// In en, this message translates to:
  /// **'It’s okay to leave a little for tomorrow.'**
  String get homeCareNightQuiet;

  /// Mobile home quiet care message. Keep concise, warm and optional; avoid guilt, productivity pressure or promises about task success. Naturally localize the metaphor.
  ///
  /// In en, this message translates to:
  /// **'You’ve been here a while. Save some time for yourself, too.'**
  String get homeCareBusyDay;

  /// Mobile home quiet care message. Keep concise, warm and optional; avoid guilt, productivity pressure or promises about task success. Naturally localize the metaphor.
  ///
  /// In en, this message translates to:
  /// **'Take your time with this decision.'**
  String get homeCareDecision;

  /// Mobile home quiet care message. Keep concise, warm and optional; avoid guilt, productivity pressure or promises about task success. Naturally localize the metaphor.
  ///
  /// In en, this message translates to:
  /// **'A long wait. A little time to look after yourself.'**
  String get homeCareLongWait;

  /// Mobile home quiet care message. Keep concise, warm and optional; avoid guilt, productivity pressure or promises about task success. Naturally localize the metaphor.
  ///
  /// In en, this message translates to:
  /// **'Welcome back. Find your own pace.'**
  String get homeCareWelcomeBack;

  /// Mobile home quiet care message. Keep concise, warm and optional; avoid guilt, productivity pressure or promises about task success. Naturally localize the metaphor.
  ///
  /// In en, this message translates to:
  /// **'Start with an idea, whenever you’re ready.'**
  String get homeCareFirstIdea;

  /// Mobile home quiet care message. Keep concise, warm and optional; avoid guilt, productivity pressure or promises about task success. Naturally localize the metaphor.
  ///
  /// In en, this message translates to:
  /// **'Haven’t eaten yet? Make a little time for a meal.'**
  String get homeCareMeal;

  /// Mobile home quiet care message. Keep concise, warm and optional; avoid guilt, productivity pressure or promises about task success. Naturally localize the metaphor.
  ///
  /// In en, this message translates to:
  /// **'Secret achievement: self-care. No progress bar needed.'**
  String get homeCareEasterEgg;

  /// Mobile home quiet care message. Keep concise, warm and optional; avoid guilt, productivity pressure or promises about task success. Naturally localize the metaphor.
  ///
  /// In en, this message translates to:
  /// **'A weekend at your pace, with a little room to spare.'**
  String get homeCareWeekend;

  /// Mobile home quiet care message. Keep concise, warm and optional; avoid guilt, productivity pressure or promises about task success. Naturally localize the metaphor.
  ///
  /// In en, this message translates to:
  /// **'Here’s to a little progress and a little breathing room.'**
  String get homeCareDailyProgress;

  /// Mobile home quiet care message. Keep concise, warm and optional; avoid guilt, productivity pressure or promises about task success. Naturally localize the metaphor.
  ///
  /// In en, this message translates to:
  /// **'Ideas need space. So do you.'**
  String get homeCareDailySpace;

  /// Mobile home quiet care message. Keep concise, warm and optional; avoid guilt, productivity pressure or promises about task success. Naturally localize the metaphor.
  ///
  /// In en, this message translates to:
  /// **'One thing at a time, with a little room for yourself.'**
  String get homeCareDailyPace;

  /// No description provided for @workbenchReturnHome.
  ///
  /// In en, this message translates to:
  /// **'Return home'**
  String get workbenchReturnHome;

  /// No description provided for @workbenchVisualization.
  ///
  /// In en, this message translates to:
  /// **'Visualization'**
  String get workbenchVisualization;

  /// No description provided for @workbenchVisualizationUnavailable.
  ///
  /// In en, this message translates to:
  /// **'This visualization is not available yet.'**
  String get workbenchVisualizationUnavailable;

  /// No description provided for @workbenchDesktopVersionUnknown.
  ///
  /// In en, this message translates to:
  /// **'Version unknown'**
  String get workbenchDesktopVersionUnknown;

  /// No description provided for @appTitle.
  ///
  /// In en, this message translates to:
  /// **'Relayune'**
  String get appTitle;

  /// No description provided for @commonBack.
  ///
  /// In en, this message translates to:
  /// **'Back'**
  String get commonBack;

  /// No description provided for @commonCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get commonCancel;

  /// No description provided for @commonClose.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get commonClose;

  /// No description provided for @commonContinue.
  ///
  /// In en, this message translates to:
  /// **'Continue'**
  String get commonContinue;

  /// No description provided for @commonRetry.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get commonRetry;

  /// No description provided for @commonSave.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get commonSave;

  /// No description provided for @commonSubmit.
  ///
  /// In en, this message translates to:
  /// **'Submit'**
  String get commonSubmit;

  /// No description provided for @commonSettings.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get commonSettings;

  /// No description provided for @commonLogOut.
  ///
  /// In en, this message translates to:
  /// **'Log out'**
  String get commonLogOut;

  /// No description provided for @commonReject.
  ///
  /// In en, this message translates to:
  /// **'Reject'**
  String get commonReject;

  /// No description provided for @commonAllow.
  ///
  /// In en, this message translates to:
  /// **'Allow'**
  String get commonAllow;

  /// No description provided for @unavailableTitle.
  ///
  /// In en, this message translates to:
  /// **'Relayune is temporarily unavailable'**
  String get unavailableTitle;

  /// No description provided for @clearLoginSession.
  ///
  /// In en, this message translates to:
  /// **'Clear login session'**
  String get clearLoginSession;

  /// No description provided for @updateInstallerUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Unable to open the system installer. Please try again later.'**
  String get updateInstallerUnavailable;

  /// No description provided for @updateReadyTitle.
  ///
  /// In en, this message translates to:
  /// **'Update ready'**
  String get updateReadyTitle;

  /// No description provided for @updateDownloaded.
  ///
  /// In en, this message translates to:
  /// **'Relayune {version} was securely downloaded and verified in the background.'**
  String updateDownloaded(String version);

  /// No description provided for @updateLater.
  ///
  /// In en, this message translates to:
  /// **'Later'**
  String get updateLater;

  /// No description provided for @updateInstall.
  ///
  /// In en, this message translates to:
  /// **'Install update'**
  String get updateInstall;

  /// No description provided for @authSecurityBadge.
  ///
  /// In en, this message translates to:
  /// **'End-to-end encrypted workspace'**
  String get authSecurityBadge;

  /// No description provided for @authEmailTitle.
  ///
  /// In en, this message translates to:
  /// **'Continue your computer tasks from your phone'**
  String get authEmailTitle;

  /// No description provided for @authPasswordTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in or create an account'**
  String get authPasswordTitle;

  /// No description provided for @authVerificationTitle.
  ///
  /// In en, this message translates to:
  /// **'Check your email'**
  String get authVerificationTitle;

  /// No description provided for @authEmailSubtitle.
  ///
  /// In en, this message translates to:
  /// **'After signing in, use the 8-character code shown on desktop to create an end-to-end encrypted connection.'**
  String get authEmailSubtitle;

  /// No description provided for @authPasswordSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in with your password, or verify your email first if this is your first time.'**
  String get authPasswordSubtitle;

  /// No description provided for @authVerificationSubtitle.
  ///
  /// In en, this message translates to:
  /// **'The verification link can be used once and expires shortly.'**
  String get authVerificationSubtitle;

  /// No description provided for @authEmailLabel.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get authEmailLabel;

  /// No description provided for @authInvalidEmail.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid email address.'**
  String get authInvalidEmail;

  /// No description provided for @authContinue.
  ///
  /// In en, this message translates to:
  /// **'Continue'**
  String get authContinue;

  /// No description provided for @authChangeEmail.
  ///
  /// In en, this message translates to:
  /// **'Change email'**
  String get authChangeEmail;

  /// No description provided for @authPasswordLabel.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get authPasswordLabel;

  /// No description provided for @authShowPassword.
  ///
  /// In en, this message translates to:
  /// **'Show password'**
  String get authShowPassword;

  /// No description provided for @authHidePassword.
  ///
  /// In en, this message translates to:
  /// **'Hide password'**
  String get authHidePassword;

  /// No description provided for @authPasswordRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter your password.'**
  String get authPasswordRequired;

  /// No description provided for @authSignIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get authSignIn;

  /// No description provided for @authVerifyEmailAction.
  ///
  /// In en, this message translates to:
  /// **'First time or forgot your password? Verify email'**
  String get authVerifyEmailAction;

  /// No description provided for @authVerificationInstructions.
  ///
  /// In en, this message translates to:
  /// **'Open the verification email and set a password on the secure web page. Then return here to continue.'**
  String get authVerificationInstructions;

  /// No description provided for @authPasswordSet.
  ///
  /// In en, this message translates to:
  /// **'I set my password'**
  String get authPasswordSet;

  /// No description provided for @authResendEmail.
  ///
  /// In en, this message translates to:
  /// **'Resend email'**
  String get authResendEmail;

  /// No description provided for @authSecurityNote.
  ///
  /// In en, this message translates to:
  /// **'The server only routes ciphertext. Your connection code and content keys are never uploaded.'**
  String get authSecurityNote;

  /// No description provided for @pairingExit.
  ///
  /// In en, this message translates to:
  /// **'Exit'**
  String get pairingExit;

  /// No description provided for @pairingTitle.
  ///
  /// In en, this message translates to:
  /// **'Scan to connect your computer'**
  String get pairingTitle;

  /// No description provided for @pairingSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Take your work with you.'**
  String get pairingSubtitle;

  /// No description provided for @pairingEnterCodeTitle.
  ///
  /// In en, this message translates to:
  /// **'Or enter the 8-character code'**
  String get pairingEnterCodeTitle;

  /// No description provided for @pairingEnterCodeHelp.
  ///
  /// In en, this message translates to:
  /// **'Enter the connection code shown on your computer.'**
  String get pairingEnterCodeHelp;

  /// No description provided for @pairingSearching.
  ///
  /// In en, this message translates to:
  /// **'Looking for computers waiting to connect to your account…'**
  String get pairingSearching;

  /// No description provided for @pairingComputerLabel.
  ///
  /// In en, this message translates to:
  /// **'Computer to connect'**
  String get pairingComputerLabel;

  /// No description provided for @pairingWillConnect.
  ///
  /// In en, this message translates to:
  /// **'Connecting to: {device}'**
  String pairingWillConnect(String device);

  /// No description provided for @pairingStartOnDesktop.
  ///
  /// In en, this message translates to:
  /// **'First choose “Connect new client” on desktop, then enter the new code.'**
  String get pairingStartOnDesktop;

  /// No description provided for @pairingSearchAgain.
  ///
  /// In en, this message translates to:
  /// **'Search again'**
  String get pairingSearchAgain;

  /// No description provided for @pairingCodeLabel.
  ///
  /// In en, this message translates to:
  /// **'8-character connection code'**
  String get pairingCodeLabel;

  /// No description provided for @pairingSecureConnect.
  ///
  /// In en, this message translates to:
  /// **'Connect securely'**
  String get pairingSecureConnect;

  /// No description provided for @pairingScanTitle.
  ///
  /// In en, this message translates to:
  /// **'Where is the QR code?'**
  String get pairingScanTitle;

  /// No description provided for @pairingScanHelp.
  ///
  /// In en, this message translates to:
  /// **'Open Relayune on your computer and select “Connect new client”.\nScan the QR code in that window.'**
  String get pairingScanHelp;

  /// No description provided for @pairingOpenCamera.
  ///
  /// In en, this message translates to:
  /// **'Scan to connect'**
  String get pairingOpenCamera;

  /// No description provided for @pairingPrivacyNote.
  ///
  /// In en, this message translates to:
  /// **'End-to-end encrypted. Only your devices can read your sessions.'**
  String get pairingPrivacyNote;

  /// No description provided for @pairingMinimumDesktop.
  ///
  /// In en, this message translates to:
  /// **'Minimum compatible desktop version: {version}'**
  String pairingMinimumDesktop(String version);

  /// No description provided for @pairingDeriving.
  ///
  /// In en, this message translates to:
  /// **'Verifying connection…'**
  String get pairingDeriving;

  /// No description provided for @pairingWaitingDesktop.
  ///
  /// In en, this message translates to:
  /// **'Waiting for computer confirmation…'**
  String get pairingWaitingDesktop;

  /// No description provided for @pairingActivating.
  ///
  /// In en, this message translates to:
  /// **'Creating encrypted channel…'**
  String get pairingActivating;

  /// No description provided for @pairingDerivingDetail.
  ///
  /// In en, this message translates to:
  /// **'Creating the SPAKE2 responder share and an independent content key on this device.'**
  String get pairingDerivingDetail;

  /// No description provided for @pairingWaitingDesktopDetail.
  ///
  /// In en, this message translates to:
  /// **'Keep Relayune open on your computer.'**
  String get pairingWaitingDesktopDetail;

  /// No description provided for @pairingActivatingDetail.
  ///
  /// In en, this message translates to:
  /// **'Verifying the first encrypted session catalog.'**
  String get pairingActivatingDetail;

  /// No description provided for @scannerTitle.
  ///
  /// In en, this message translates to:
  /// **'Scan the connection QR code on your computer'**
  String get scannerTitle;

  /// No description provided for @scannerResume.
  ///
  /// In en, this message translates to:
  /// **'Resume scanning'**
  String get scannerResume;

  /// No description provided for @scannerInvalid.
  ///
  /// In en, this message translates to:
  /// **'This is not a Relayune connection QR code. Scan the current code shown on desktop.'**
  String get scannerInvalid;

  /// No description provided for @scannerHelp.
  ///
  /// In en, this message translates to:
  /// **'Place the QR code shown by Relayune on your computer inside the frame. An end-to-end encrypted connection starts after recognition.'**
  String get scannerHelp;

  /// No description provided for @scannerUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The camera is unavailable. Allow Relayune to use the camera in system settings, or return and connect manually.'**
  String get scannerUnavailable;

  /// No description provided for @settingsTitle.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settingsTitle;

  /// No description provided for @settingsSignedInAccount.
  ///
  /// In en, this message translates to:
  /// **'Signed-in account'**
  String get settingsSignedInAccount;

  /// No description provided for @settingsAccountSection.
  ///
  /// In en, this message translates to:
  /// **'Account'**
  String get settingsAccountSection;

  /// No description provided for @settingsPreferencesSection.
  ///
  /// In en, this message translates to:
  /// **'Preferences'**
  String get settingsPreferencesSection;

  /// No description provided for @settingsHelpLegalSection.
  ///
  /// In en, this message translates to:
  /// **'Support & legal'**
  String get settingsHelpLegalSection;

  /// No description provided for @settingsLanguage.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get settingsLanguage;

  /// No description provided for @settingsLanguageSystemDefault.
  ///
  /// In en, this message translates to:
  /// **'Default (system language)'**
  String get settingsLanguageSystemDefault;

  /// No description provided for @settingsLanguageSystemDefaultValue.
  ///
  /// In en, this message translates to:
  /// **'Default · {language}'**
  String settingsLanguageSystemDefaultValue(String language);

  /// No description provided for @settingsLanguageSaveFailed.
  ///
  /// In en, this message translates to:
  /// **'The language changed, but the preference could not be saved.'**
  String get settingsLanguageSaveFailed;

  /// No description provided for @settingsReleaseNotes.
  ///
  /// In en, this message translates to:
  /// **'Release notes'**
  String get settingsReleaseNotes;

  /// No description provided for @settingsSupport.
  ///
  /// In en, this message translates to:
  /// **'Support'**
  String get settingsSupport;

  /// No description provided for @settingsTerms.
  ///
  /// In en, this message translates to:
  /// **'Terms of Service'**
  String get settingsTerms;

  /// No description provided for @settingsPrivacy.
  ///
  /// In en, this message translates to:
  /// **'Privacy Policy'**
  String get settingsPrivacy;

  /// No description provided for @settingsLegalLanguage.
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get settingsLegalLanguage;

  /// No description provided for @settingsOpenLinkFailed.
  ///
  /// In en, this message translates to:
  /// **'Unable to open this link. Please try again.'**
  String get settingsOpenLinkFailed;

  /// No description provided for @releaseTitle.
  ///
  /// In en, this message translates to:
  /// **'Release notes'**
  String get releaseTitle;

  /// No description provided for @releaseLoading.
  ///
  /// In en, this message translates to:
  /// **'Loading release notes'**
  String get releaseLoading;

  /// No description provided for @releaseErrorTitle.
  ///
  /// In en, this message translates to:
  /// **'Release notes unavailable'**
  String get releaseErrorTitle;

  /// No description provided for @releaseErrorMessage.
  ///
  /// In en, this message translates to:
  /// **'Check your connection and try again.'**
  String get releaseErrorMessage;

  /// No description provided for @releaseEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No release notes yet'**
  String get releaseEmptyTitle;

  /// No description provided for @releaseEmptyMessage.
  ///
  /// In en, this message translates to:
  /// **'Future updates will appear here.'**
  String get releaseEmptyMessage;

  /// No description provided for @releaseVersion.
  ///
  /// In en, this message translates to:
  /// **'Version'**
  String get releaseVersion;

  /// No description provided for @releaseWeb.
  ///
  /// In en, this message translates to:
  /// **'Web'**
  String get releaseWeb;

  /// No description provided for @releaseServer.
  ///
  /// In en, this message translates to:
  /// **'Server'**
  String get releaseServer;

  /// No description provided for @notificationEnabledTitle.
  ///
  /// In en, this message translates to:
  /// **'Task notifications are on'**
  String get notificationEnabledTitle;

  /// No description provided for @notificationPrimerTitle.
  ///
  /// In en, this message translates to:
  /// **'Your task runs on the computer, so you do not have to keep watching'**
  String get notificationPrimerTitle;

  /// No description provided for @notificationEnabledBody.
  ///
  /// In en, this message translates to:
  /// **'Relayune alerts you when a task needs attention or the main task finishes.'**
  String get notificationEnabledBody;

  /// No description provided for @notificationPrimerBody.
  ///
  /// In en, this message translates to:
  /// **'Handle approvals and questions promptly, then see the task name and reply summary when it finishes.'**
  String get notificationPrimerBody;

  /// No description provided for @notificationBenefitAction.
  ///
  /// In en, this message translates to:
  /// **'Needs attention: quickly allow, reject, or open an answer from a notification'**
  String get notificationBenefitAction;

  /// No description provided for @notificationBenefitCompletion.
  ///
  /// In en, this message translates to:
  /// **'Task complete: preview the reply summary before opening it'**
  String get notificationBenefitCompletion;

  /// No description provided for @notificationBenefitPrivacy.
  ///
  /// In en, this message translates to:
  /// **'Notifications never show commands, file paths, connection codes, or keys'**
  String get notificationBenefitPrivacy;

  /// No description provided for @notificationPermissionRejected.
  ///
  /// In en, this message translates to:
  /// **'System notifications are still off. You can allow Relayune notifications in system settings.'**
  String get notificationPermissionRejected;

  /// No description provided for @notificationGotIt.
  ///
  /// In en, this message translates to:
  /// **'Got it'**
  String get notificationGotIt;

  /// No description provided for @notificationOpenSettings.
  ///
  /// In en, this message translates to:
  /// **'Open system settings'**
  String get notificationOpenSettings;

  /// No description provided for @notificationEnable.
  ///
  /// In en, this message translates to:
  /// **'Enable task notifications'**
  String get notificationEnable;

  /// No description provided for @notificationNotNow.
  ///
  /// In en, this message translates to:
  /// **'Not now'**
  String get notificationNotNow;

  /// No description provided for @notificationSemanticsExample.
  ///
  /// In en, this message translates to:
  /// **'Notification examples: approval needs attention, a question needs an answer, and a Claude task completed with a reply summary'**
  String get notificationSemanticsExample;

  /// No description provided for @notificationNow.
  ///
  /// In en, this message translates to:
  /// **'Now'**
  String get notificationNow;

  /// No description provided for @notificationSampleTask.
  ///
  /// In en, this message translates to:
  /// **'Improve mobile notifications'**
  String get notificationSampleTask;

  /// No description provided for @notificationSampleBody.
  ///
  /// In en, this message translates to:
  /// **'Notification permission guidance and a task-completion summary are ready…'**
  String get notificationSampleBody;

  /// No description provided for @notificationApprovalTitle.
  ///
  /// In en, this message translates to:
  /// **'Operation awaiting confirmation'**
  String get notificationApprovalTitle;

  /// No description provided for @notificationQuestionTitle.
  ///
  /// In en, this message translates to:
  /// **'Your answer is needed'**
  String get notificationQuestionTitle;

  /// No description provided for @notificationTaskPaused.
  ///
  /// In en, this message translates to:
  /// **'{provider} · task paused'**
  String notificationTaskPaused(String provider);

  /// No description provided for @notificationApprovalBody.
  ///
  /// In en, this message translates to:
  /// **'Allow or reject this operation within {minutes, plural, =1{1 minute} other{{minutes} minutes}}.'**
  String notificationApprovalBody(int minutes);

  /// No description provided for @notificationQuestionBody.
  ///
  /// In en, this message translates to:
  /// **'Answer within {minutes, plural, =1{1 minute} other{{minutes} minutes}}. The task continues after you submit.'**
  String notificationQuestionBody(int minutes);

  /// No description provided for @notificationTaskCompleted.
  ///
  /// In en, this message translates to:
  /// **'{provider} task completed'**
  String notificationTaskCompleted(String provider);

  /// No description provided for @notificationMainTask.
  ///
  /// In en, this message translates to:
  /// **'Main task'**
  String get notificationMainTask;

  /// No description provided for @notificationMainResultReady.
  ///
  /// In en, this message translates to:
  /// **'The main task result is ready. Tap to view.'**
  String get notificationMainResultReady;

  /// No description provided for @notificationNamedResultReady.
  ///
  /// In en, this message translates to:
  /// **'The result for “{name}” is ready. Tap to view.'**
  String notificationNamedResultReady(String name);

  /// No description provided for @notificationAllowOnce.
  ///
  /// In en, this message translates to:
  /// **'Allow once'**
  String get notificationAllowOnce;

  /// No description provided for @notificationAnswer.
  ///
  /// In en, this message translates to:
  /// **'Answer'**
  String get notificationAnswer;

  /// No description provided for @notificationChannelAttention.
  ///
  /// In en, this message translates to:
  /// **'Needs attention'**
  String get notificationChannelAttention;

  /// No description provided for @notificationChannelCompleted.
  ///
  /// In en, this message translates to:
  /// **'Task completed'**
  String get notificationChannelCompleted;

  /// No description provided for @notificationChannelAttentionDescription.
  ///
  /// In en, this message translates to:
  /// **'Relayune approval and question alerts'**
  String get notificationChannelAttentionDescription;

  /// No description provided for @notificationChannelCompletedDescription.
  ///
  /// In en, this message translates to:
  /// **'Relayune main-task completion alerts'**
  String get notificationChannelCompletedDescription;

  /// No description provided for @notificationRedactedLink.
  ///
  /// In en, this message translates to:
  /// **'[link]'**
  String get notificationRedactedLink;

  /// No description provided for @notificationRedactedPath.
  ///
  /// In en, this message translates to:
  /// **'[path]'**
  String get notificationRedactedPath;

  /// No description provided for @notificationRedactedSecret.
  ///
  /// In en, this message translates to:
  /// **'[hidden]'**
  String get notificationRedactedSecret;

  /// No description provided for @workbenchTitle.
  ///
  /// In en, this message translates to:
  /// **'Workspace'**
  String get workbenchTitle;

  /// No description provided for @workbenchDevice.
  ///
  /// In en, this message translates to:
  /// **'Device'**
  String get workbenchDevice;

  /// No description provided for @workbenchOpenNavigation.
  ///
  /// In en, this message translates to:
  /// **'Open navigation'**
  String get workbenchOpenNavigation;

  /// No description provided for @workbenchPendingApprovals.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 approval pending} other{{count} approvals pending}}'**
  String workbenchPendingApprovals(int count);

  /// No description provided for @workbenchSessions.
  ///
  /// In en, this message translates to:
  /// **'Sessions'**
  String get workbenchSessions;

  /// No description provided for @workbenchOnline.
  ///
  /// In en, this message translates to:
  /// **'Online'**
  String get workbenchOnline;

  /// No description provided for @workbenchOffline.
  ///
  /// In en, this message translates to:
  /// **'Offline'**
  String get workbenchOffline;

  /// No description provided for @workbenchDeviceOnlineRealtime.
  ///
  /// In en, this message translates to:
  /// **'Computer online · realtime sync'**
  String get workbenchDeviceOnlineRealtime;

  /// No description provided for @workbenchDeviceOfflineQueued.
  ///
  /// In en, this message translates to:
  /// **'Computer offline · cached records only'**
  String get workbenchDeviceOfflineQueued;

  /// No description provided for @workbenchDeviceOnlineReconnecting.
  ///
  /// In en, this message translates to:
  /// **'Computer online · restoring realtime connection'**
  String get workbenchDeviceOnlineReconnecting;

  /// No description provided for @workbenchDeviceOfflineReconnecting.
  ///
  /// In en, this message translates to:
  /// **'Computer offline · restoring realtime connection'**
  String get workbenchDeviceOfflineReconnecting;

  /// No description provided for @workbenchDeviceOnlineWaiting.
  ///
  /// In en, this message translates to:
  /// **'Computer online · waiting for realtime connection'**
  String get workbenchDeviceOnlineWaiting;

  /// No description provided for @workbenchDeviceOfflineWaiting.
  ///
  /// In en, this message translates to:
  /// **'Computer offline · waiting for realtime connection'**
  String get workbenchDeviceOfflineWaiting;

  /// No description provided for @workbenchProjectsSessions.
  ///
  /// In en, this message translates to:
  /// **'Projects & sessions'**
  String get workbenchProjectsSessions;

  /// No description provided for @workbenchNoSessionsSynced.
  ///
  /// In en, this message translates to:
  /// **'No sessions have synced from the computer'**
  String get workbenchNoSessionsSynced;

  /// No description provided for @workbenchSignedInAccount.
  ///
  /// In en, this message translates to:
  /// **'Signed-in account'**
  String get workbenchSignedInAccount;

  /// No description provided for @workbenchNotSignedIn.
  ///
  /// In en, this message translates to:
  /// **'Not signed in'**
  String get workbenchNotSignedIn;

  /// No description provided for @workbenchNewSession.
  ///
  /// In en, this message translates to:
  /// **'New session'**
  String get workbenchNewSession;

  /// No description provided for @workbenchDefaultSessionName.
  ///
  /// In en, this message translates to:
  /// **'New remote session'**
  String get workbenchDefaultSessionName;

  /// No description provided for @workbenchHistoryFailed.
  ///
  /// In en, this message translates to:
  /// **'History could not be loaded; current content may be incomplete'**
  String get workbenchHistoryFailed;

  /// No description provided for @workbenchLoadEarlier.
  ///
  /// In en, this message translates to:
  /// **'Load earlier messages'**
  String get workbenchLoadEarlier;

  /// No description provided for @workbenchSendFirst.
  ///
  /// In en, this message translates to:
  /// **'Send your first instruction to begin'**
  String get workbenchSendFirst;

  /// No description provided for @workbenchAtBeginning.
  ///
  /// In en, this message translates to:
  /// **'This is the first message'**
  String get workbenchAtBeginning;

  /// No description provided for @workbenchAddAttachment.
  ///
  /// In en, this message translates to:
  /// **'Add attachment'**
  String get workbenchAddAttachment;

  /// No description provided for @workbenchRemoveAttachment.
  ///
  /// In en, this message translates to:
  /// **'Remove {name}'**
  String workbenchRemoveAttachment(String name);

  /// No description provided for @workbenchReadOnly.
  ///
  /// In en, this message translates to:
  /// **'This session is read-only'**
  String get workbenchReadOnly;

  /// No description provided for @workbenchOfflineQueued.
  ///
  /// In en, this message translates to:
  /// **'Computer offline · sending unavailable'**
  String get workbenchOfflineQueued;

  /// No description provided for @workbenchSteerPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Send a new instruction to stop and continue…'**
  String get workbenchSteerPlaceholder;

  /// No description provided for @workbenchSendPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Send instructions to your computer…'**
  String get workbenchSendPlaceholder;

  /// No description provided for @workbenchStopTask.
  ///
  /// In en, this message translates to:
  /// **'Stop task'**
  String get workbenchStopTask;

  /// No description provided for @workbenchSending.
  ///
  /// In en, this message translates to:
  /// **'Sending'**
  String get workbenchSending;

  /// No description provided for @workbenchSend.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get workbenchSend;

  /// No description provided for @workbenchYou.
  ///
  /// In en, this message translates to:
  /// **'You'**
  String get workbenchYou;

  /// No description provided for @workbenchLocalActivity.
  ///
  /// In en, this message translates to:
  /// **'Local activity'**
  String get workbenchLocalActivity;

  /// No description provided for @workbenchToday.
  ///
  /// In en, this message translates to:
  /// **'Today'**
  String get workbenchToday;

  /// No description provided for @workbenchYesterday.
  ///
  /// In en, this message translates to:
  /// **'Yesterday'**
  String get workbenchYesterday;

  /// No description provided for @workbenchDayBeforeYesterday.
  ///
  /// In en, this message translates to:
  /// **'The day before yesterday'**
  String get workbenchDayBeforeYesterday;

  /// No description provided for @workbenchSystemNotice.
  ///
  /// In en, this message translates to:
  /// **'System notice'**
  String get workbenchSystemNotice;

  /// No description provided for @workbenchApprovalSource.
  ///
  /// In en, this message translates to:
  /// **'Source: {name}'**
  String workbenchApprovalSource(String name);

  /// No description provided for @workbenchApprovalDirectory.
  ///
  /// In en, this message translates to:
  /// **'Directory: {path}'**
  String workbenchApprovalDirectory(String path);

  /// No description provided for @workbenchApprovalPermission.
  ///
  /// In en, this message translates to:
  /// **'Request permission for a local operation'**
  String get workbenchApprovalPermission;

  /// No description provided for @workbenchSelect.
  ///
  /// In en, this message translates to:
  /// **'Select'**
  String get workbenchSelect;

  /// No description provided for @workbenchOtherAnswer.
  ///
  /// In en, this message translates to:
  /// **'Other answer…'**
  String get workbenchOtherAnswer;

  /// No description provided for @workbenchSkipAnswer.
  ///
  /// In en, this message translates to:
  /// **'Not now'**
  String get workbenchSkipAnswer;

  /// No description provided for @workbenchHighRiskTitle.
  ///
  /// In en, this message translates to:
  /// **'Allow a high-risk operation?'**
  String get workbenchHighRiskTitle;

  /// No description provided for @workbenchOperationOnComputer.
  ///
  /// In en, this message translates to:
  /// **'This operation will run on your computer.'**
  String get workbenchOperationOnComputer;

  /// No description provided for @workbenchConfirmAllow.
  ///
  /// In en, this message translates to:
  /// **'Confirm and allow'**
  String get workbenchConfirmAllow;

  /// No description provided for @workbenchAnswerLabel.
  ///
  /// In en, this message translates to:
  /// **'Answer'**
  String get workbenchAnswerLabel;

  /// No description provided for @workbenchAllowOnce.
  ///
  /// In en, this message translates to:
  /// **'Allow once'**
  String get workbenchAllowOnce;

  /// No description provided for @workbenchAlwaysAllowSession.
  ///
  /// In en, this message translates to:
  /// **'Always allow in this session'**
  String get workbenchAlwaysAllowSession;

  /// No description provided for @workbenchAllowAndRemember.
  ///
  /// In en, this message translates to:
  /// **'Allow and remember this rule'**
  String get workbenchAllowAndRemember;

  /// No description provided for @workbenchAlwaysRejectSession.
  ///
  /// In en, this message translates to:
  /// **'Always reject in this session'**
  String get workbenchAlwaysRejectSession;

  /// No description provided for @workbenchRejectAndRemember.
  ///
  /// In en, this message translates to:
  /// **'Reject and remember this rule'**
  String get workbenchRejectAndRemember;

  /// No description provided for @workbenchSaveDecisionTitle.
  ///
  /// In en, this message translates to:
  /// **'Save this decision?'**
  String get workbenchSaveDecisionTitle;

  /// No description provided for @workbenchSaveDecisionMessage.
  ///
  /// In en, this message translates to:
  /// **'Codex may reuse this decision for matching operations instead of asking every time.'**
  String get workbenchSaveDecisionMessage;

  /// No description provided for @workbenchConfirm.
  ///
  /// In en, this message translates to:
  /// **'Confirm'**
  String get workbenchConfirm;

  /// No description provided for @workbenchRejectAndStop.
  ///
  /// In en, this message translates to:
  /// **'Reject and stop the current task'**
  String get workbenchRejectAndStop;

  /// No description provided for @workbenchNotificationSettings.
  ///
  /// In en, this message translates to:
  /// **'Task notifications'**
  String get workbenchNotificationSettings;

  /// No description provided for @workbenchConnectAnother.
  ///
  /// In en, this message translates to:
  /// **'Connect another computer'**
  String get workbenchConnectAnother;

  /// No description provided for @workbenchConnectAnotherSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Delete the current content key and device authorization from this phone'**
  String get workbenchConnectAnotherSubtitle;

  /// No description provided for @workbenchConnectAnotherTitle.
  ///
  /// In en, this message translates to:
  /// **'Connect another computer?'**
  String get workbenchConnectAnotherTitle;

  /// No description provided for @workbenchConnectAnotherMessage.
  ///
  /// In en, this message translates to:
  /// **'The current content key and phone authorization token will be deleted from this device\'s secure credential store. Data on the server and computer will not be deleted.'**
  String get workbenchConnectAnotherMessage;

  /// No description provided for @workbenchNoSessions.
  ///
  /// In en, this message translates to:
  /// **'No sessions available'**
  String get workbenchNoSessions;

  /// No description provided for @workbenchNoSessionsHelp.
  ///
  /// In en, this message translates to:
  /// **'Keep desktop online, or create a new session in a project directory on your computer.'**
  String get workbenchNoSessionsHelp;

  /// No description provided for @workbenchHistoryLoading.
  ///
  /// In en, this message translates to:
  /// **'Loading message history'**
  String get workbenchHistoryLoading;

  /// No description provided for @workbenchHistoryLoadingOlder.
  ///
  /// In en, this message translates to:
  /// **'Loading earlier messages…'**
  String get workbenchHistoryLoadingOlder;

  /// No description provided for @workbenchHistoryLimit.
  ///
  /// In en, this message translates to:
  /// **'History loads after you open a session, up to 500 messages at a time'**
  String get workbenchHistoryLimit;

  /// No description provided for @workbenchFilePreviewRetry.
  ///
  /// In en, this message translates to:
  /// **'File preview failed. Please try again.'**
  String get workbenchFilePreviewRetry;

  /// No description provided for @workbenchSecureFileReading.
  ///
  /// In en, this message translates to:
  /// **'Securely reading from your computer…'**
  String get workbenchSecureFileReading;

  /// No description provided for @workbenchFileUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The file has expired or was removed from the computer.'**
  String get workbenchFileUnavailable;

  /// No description provided for @workbenchApprovalCommand.
  ///
  /// In en, this message translates to:
  /// **'Run command'**
  String get workbenchApprovalCommand;

  /// No description provided for @workbenchApprovalFileChange.
  ///
  /// In en, this message translates to:
  /// **'Change file'**
  String get workbenchApprovalFileChange;

  /// No description provided for @workbenchApprovalChoice.
  ///
  /// In en, this message translates to:
  /// **'Your choice is needed'**
  String get workbenchApprovalChoice;

  /// No description provided for @workbenchApprovalTool.
  ///
  /// In en, this message translates to:
  /// **'Run local tool'**
  String get workbenchApprovalTool;

  /// No description provided for @workbenchStatePending.
  ///
  /// In en, this message translates to:
  /// **'Pending'**
  String get workbenchStatePending;

  /// No description provided for @workbenchStateDeciding.
  ///
  /// In en, this message translates to:
  /// **'Sending'**
  String get workbenchStateDeciding;

  /// No description provided for @workbenchStateApproved.
  ///
  /// In en, this message translates to:
  /// **'Approved'**
  String get workbenchStateApproved;

  /// No description provided for @workbenchStateRejected.
  ///
  /// In en, this message translates to:
  /// **'Rejected'**
  String get workbenchStateRejected;

  /// No description provided for @workbenchStateExpired.
  ///
  /// In en, this message translates to:
  /// **'Expired'**
  String get workbenchStateExpired;

  /// No description provided for @workbenchLocalRelay.
  ///
  /// In en, this message translates to:
  /// **'Local Relay'**
  String get workbenchLocalRelay;

  /// No description provided for @workbenchEncryptionProtocol.
  ///
  /// In en, this message translates to:
  /// **'Encryption protocol'**
  String get workbenchEncryptionProtocol;

  /// No description provided for @workbenchPairingProtocol.
  ///
  /// In en, this message translates to:
  /// **'Pairing protocol'**
  String get workbenchPairingProtocol;

  /// No description provided for @workbenchRealtimeChannel.
  ///
  /// In en, this message translates to:
  /// **'Realtime channel'**
  String get workbenchRealtimeChannel;

  /// No description provided for @workbenchTechnicalDetails.
  ///
  /// In en, this message translates to:
  /// **'Technical details'**
  String get workbenchTechnicalDetails;

  /// No description provided for @workbenchRealtimeConnection.
  ///
  /// In en, this message translates to:
  /// **'Realtime connection'**
  String get workbenchRealtimeConnection;

  /// No description provided for @workbenchHeartbeatPath.
  ///
  /// In en, this message translates to:
  /// **'iPhone ↔ Server · WebSocket'**
  String get workbenchHeartbeatPath;

  /// No description provided for @workbenchHeartbeatHealthy.
  ///
  /// In en, this message translates to:
  /// **'Heartbeat healthy'**
  String get workbenchHeartbeatHealthy;

  /// No description provided for @workbenchHeartbeatWaiting.
  ///
  /// In en, this message translates to:
  /// **'Waiting for heartbeat'**
  String get workbenchHeartbeatWaiting;

  /// No description provided for @workbenchLastHeartbeat.
  ///
  /// In en, this message translates to:
  /// **'Last heartbeat'**
  String get workbenchLastHeartbeat;

  /// No description provided for @workbenchRoundTrip.
  ///
  /// In en, this message translates to:
  /// **'Round trip'**
  String get workbenchRoundTrip;

  /// No description provided for @workbenchWebSocketHeartbeat.
  ///
  /// In en, this message translates to:
  /// **'WebSocket heartbeat'**
  String get workbenchWebSocketHeartbeat;

  /// No description provided for @workbenchDesktopHeartbeat.
  ///
  /// In en, this message translates to:
  /// **'Computer heartbeat'**
  String get workbenchDesktopHeartbeat;

  /// No description provided for @workbenchJustNow.
  ///
  /// In en, this message translates to:
  /// **'Just now'**
  String get workbenchJustNow;

  /// No description provided for @workbenchSecondsAgo.
  ///
  /// In en, this message translates to:
  /// **'{seconds}s ago'**
  String workbenchSecondsAgo(int seconds);

  /// No description provided for @workbenchMinutesAgo.
  ///
  /// In en, this message translates to:
  /// **'{minutes}m ago'**
  String workbenchMinutesAgo(int minutes);

  /// No description provided for @workbenchStateVersion.
  ///
  /// In en, this message translates to:
  /// **'State version'**
  String get workbenchStateVersion;

  /// No description provided for @workbenchAwaitingConfirmation.
  ///
  /// In en, this message translates to:
  /// **'Awaiting confirmation'**
  String get workbenchAwaitingConfirmation;

  /// No description provided for @workbenchLastConfirmed.
  ///
  /// In en, this message translates to:
  /// **'Last confirmed'**
  String get workbenchLastConfirmed;

  /// No description provided for @workbenchEventAck.
  ///
  /// In en, this message translates to:
  /// **'Event acknowledgement'**
  String get workbenchEventAck;

  /// No description provided for @workbenchOfflineQueue.
  ///
  /// In en, this message translates to:
  /// **'Offline queue'**
  String get workbenchOfflineQueue;

  /// No description provided for @workbenchSecurityBoundary.
  ///
  /// In en, this message translates to:
  /// **'End-to-end encryption boundary'**
  String get workbenchSecurityBoundary;

  /// No description provided for @workbenchPhonePlaintextEndpoint.
  ///
  /// In en, this message translates to:
  /// **'The phone is an application-plaintext endpoint'**
  String get workbenchPhonePlaintextEndpoint;

  /// No description provided for @workbenchServerCiphertextOnly.
  ///
  /// In en, this message translates to:
  /// **'The server stores only authenticated ciphertext envelopes'**
  String get workbenchServerCiphertextOnly;

  /// No description provided for @workbenchKeyInSecureStorage.
  ///
  /// In en, this message translates to:
  /// **'Content keys are stored in the system secure credential store'**
  String get workbenchKeyInSecureStorage;

  /// No description provided for @workbenchCodeNeverUploaded.
  ///
  /// In en, this message translates to:
  /// **'The 8-character connection code is never uploaded'**
  String get workbenchCodeNeverUploaded;

  /// No description provided for @workbenchNotConfirmed.
  ///
  /// In en, this message translates to:
  /// **'Not confirmed yet'**
  String get workbenchNotConfirmed;

  /// No description provided for @workbenchRealtimeConnected.
  ///
  /// In en, this message translates to:
  /// **'WebSocket connected'**
  String get workbenchRealtimeConnected;

  /// No description provided for @workbenchRealtimeConnecting.
  ///
  /// In en, this message translates to:
  /// **'Connecting'**
  String get workbenchRealtimeConnecting;

  /// No description provided for @workbenchRealtimeReconnecting.
  ///
  /// In en, this message translates to:
  /// **'Reconnecting'**
  String get workbenchRealtimeReconnecting;

  /// No description provided for @workbenchRealtimeIdle.
  ///
  /// In en, this message translates to:
  /// **'Waiting to connect'**
  String get workbenchRealtimeIdle;

  /// No description provided for @workbenchNotificationStatus.
  ///
  /// In en, this message translates to:
  /// **'{status} · notifications work while the app\'s background connection remains alive; delivery is not guaranteed after the system terminates it'**
  String workbenchNotificationStatus(String status);

  /// No description provided for @workbenchNotificationAllowed.
  ///
  /// In en, this message translates to:
  /// **'Allowed'**
  String get workbenchNotificationAllowed;

  /// No description provided for @workbenchNotificationDisabled.
  ///
  /// In en, this message translates to:
  /// **'Off'**
  String get workbenchNotificationDisabled;

  /// No description provided for @workbenchNotificationUnknown.
  ///
  /// In en, this message translates to:
  /// **'Unknown'**
  String get workbenchNotificationUnknown;

  /// No description provided for @workbenchClose.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get workbenchClose;

  /// No description provided for @workbenchProjectConfiguration.
  ///
  /// In en, this message translates to:
  /// **'Project settings'**
  String get workbenchProjectConfiguration;

  /// No description provided for @workbenchProjectConfigurationTitle.
  ///
  /// In en, this message translates to:
  /// **'Project settings'**
  String get workbenchProjectConfigurationTitle;

  /// No description provided for @workbenchProjectName.
  ///
  /// In en, this message translates to:
  /// **'Project name'**
  String get workbenchProjectName;

  /// No description provided for @workbenchProjectNameHelp.
  ///
  /// In en, this message translates to:
  /// **'This changes only the name shown in this app. It does not rename the folder on your computer.'**
  String get workbenchProjectNameHelp;

  /// No description provided for @workbenchFullPath.
  ///
  /// In en, this message translates to:
  /// **'Full path'**
  String get workbenchFullPath;

  /// No description provided for @workbenchProjectPathUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The computer did not provide a project path'**
  String get workbenchProjectPathUnavailable;

  /// No description provided for @workbenchSessionCount.
  ///
  /// In en, this message translates to:
  /// **'{count} sessions'**
  String workbenchSessionCount(int count);

  /// No description provided for @workbenchMoreSessions.
  ///
  /// In en, this message translates to:
  /// **'Show more sessions ({count})'**
  String workbenchMoreSessions(int count);

  /// No description provided for @workbenchAgentRunning.
  ///
  /// In en, this message translates to:
  /// **'Agent running'**
  String get workbenchAgentRunning;

  /// No description provided for @workbenchAgentNotRunning.
  ///
  /// In en, this message translates to:
  /// **'Agent not running'**
  String get workbenchAgentNotRunning;

  /// No description provided for @workbenchRunning.
  ///
  /// In en, this message translates to:
  /// **'Running'**
  String get workbenchRunning;

  /// No description provided for @workbenchKimiSettings.
  ///
  /// In en, this message translates to:
  /// **'Kimi settings'**
  String get workbenchKimiSettings;

  /// No description provided for @workbenchEnableYoloTitle.
  ///
  /// In en, this message translates to:
  /// **'Enable YOLO mode?'**
  String get workbenchEnableYoloTitle;

  /// No description provided for @workbenchEnableAutoTitle.
  ///
  /// In en, this message translates to:
  /// **'Enable Auto mode?'**
  String get workbenchEnableAutoTitle;

  /// No description provided for @workbenchYoloWarning.
  ///
  /// In en, this message translates to:
  /// **'Kimi will automatically approve more local tool calls. Enable this only when you trust the current task and project.'**
  String get workbenchYoloWarning;

  /// No description provided for @workbenchAutoWarning.
  ///
  /// In en, this message translates to:
  /// **'Kimi will automatically approve routine tool calls, but may still ask you questions.'**
  String get workbenchAutoWarning;

  /// No description provided for @workbenchConfirmEnable.
  ///
  /// In en, this message translates to:
  /// **'Confirm and enable'**
  String get workbenchConfirmEnable;

  /// No description provided for @workbenchUploadTooManyImages.
  ///
  /// In en, this message translates to:
  /// **'You can add up to 4 images to each message.'**
  String get workbenchUploadTooManyImages;

  /// No description provided for @workbenchUploadUnsupportedImages.
  ///
  /// In en, this message translates to:
  /// **'{names} are not supported. Choose PNG, JPEG, WebP, GIF, or AVIF.'**
  String workbenchUploadUnsupportedImages(String names);

  /// No description provided for @workbenchUploadTooLarge.
  ///
  /// In en, this message translates to:
  /// **'Attachments in one message cannot exceed 20 MiB in total.'**
  String get workbenchUploadTooLarge;

  /// No description provided for @workbenchPreviewGenerateFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not read or generate a preview for {name}. Try again.'**
  String workbenchPreviewGenerateFailed(String name);

  /// No description provided for @workbenchKimiViewAgents.
  ///
  /// In en, this message translates to:
  /// **'View subagents'**
  String get workbenchKimiViewAgents;

  /// No description provided for @workbenchKimiViewAgentsDescription.
  ///
  /// In en, this message translates to:
  /// **'Open the Agent work window above the composer without starting another model task.'**
  String get workbenchKimiViewAgentsDescription;

  /// No description provided for @workbenchKimiOpenNow.
  ///
  /// In en, this message translates to:
  /// **'Open now'**
  String get workbenchKimiOpenNow;

  /// No description provided for @workbenchKimiSessionStatus.
  ///
  /// In en, this message translates to:
  /// **'Session status'**
  String get workbenchKimiSessionStatus;

  /// No description provided for @workbenchKimiSessionStatusDescription.
  ///
  /// In en, this message translates to:
  /// **'View task, approval, context, and local sync status.'**
  String get workbenchKimiSessionStatusDescription;

  /// No description provided for @workbenchKimiLocalStatus.
  ///
  /// In en, this message translates to:
  /// **'Local status'**
  String get workbenchKimiLocalStatus;

  /// No description provided for @workbenchKimiModel.
  ///
  /// In en, this message translates to:
  /// **'Model'**
  String get workbenchKimiModel;

  /// No description provided for @workbenchKimiModelDescription.
  ///
  /// In en, this message translates to:
  /// **'Change the model used by this Kimi session.'**
  String get workbenchKimiModelDescription;

  /// No description provided for @workbenchKimiSessionSettings.
  ///
  /// In en, this message translates to:
  /// **'Session settings'**
  String get workbenchKimiSessionSettings;

  /// No description provided for @workbenchKimiPermissionMode.
  ///
  /// In en, this message translates to:
  /// **'Permission mode'**
  String get workbenchKimiPermissionMode;

  /// No description provided for @workbenchKimiPermissionModeDescription.
  ///
  /// In en, this message translates to:
  /// **'View or change the local tool approval policy.'**
  String get workbenchKimiPermissionModeDescription;

  /// No description provided for @workbenchKimiSecuritySettings.
  ///
  /// In en, this message translates to:
  /// **'Security settings'**
  String get workbenchKimiSecuritySettings;

  /// No description provided for @workbenchKimiPlanMode.
  ///
  /// In en, this message translates to:
  /// **'Plan mode'**
  String get workbenchKimiPlanMode;

  /// No description provided for @workbenchKimiPlanModeDescription.
  ///
  /// In en, this message translates to:
  /// **'Ask Kimi to plan before carrying out the task.'**
  String get workbenchKimiPlanModeDescription;

  /// No description provided for @workbenchKimiYoloMode.
  ///
  /// In en, this message translates to:
  /// **'YOLO mode'**
  String get workbenchKimiYoloMode;

  /// No description provided for @workbenchKimiYoloModeDescription.
  ///
  /// In en, this message translates to:
  /// **'Automatically approve more tool calls; confirmation is required before enabling.'**
  String get workbenchKimiYoloModeDescription;

  /// No description provided for @workbenchKimiConfirmationRequired.
  ///
  /// In en, this message translates to:
  /// **'Confirmation required'**
  String get workbenchKimiConfirmationRequired;

  /// No description provided for @workbenchKimiSettingsDescription.
  ///
  /// In en, this message translates to:
  /// **'Open model, Thinking, and permission settings.'**
  String get workbenchKimiSettingsDescription;

  /// No description provided for @workbenchKimiInputRequired.
  ///
  /// In en, this message translates to:
  /// **'Input required: {hint}'**
  String workbenchKimiInputRequired(String hint);

  /// No description provided for @workbenchKimiNativeCommandDescription.
  ///
  /// In en, this message translates to:
  /// **'Native Kimi ACP command that runs as a real command task.'**
  String get workbenchKimiNativeCommandDescription;

  /// No description provided for @workbenchKimiNativeCommand.
  ///
  /// In en, this message translates to:
  /// **'Native command'**
  String get workbenchKimiNativeCommand;

  /// No description provided for @workbenchKimiContextSyncing.
  ///
  /// In en, this message translates to:
  /// **'Context waiting to sync'**
  String get workbenchKimiContextSyncing;

  /// No description provided for @workbenchKimiWaitingForSync.
  ///
  /// In en, this message translates to:
  /// **'Waiting to sync'**
  String get workbenchKimiWaitingForSync;

  /// No description provided for @workbenchKimiContextUsage.
  ///
  /// In en, this message translates to:
  /// **'Context {percent}% · {used}/{size}'**
  String workbenchKimiContextUsage(int percent, String used, String size);

  /// No description provided for @workbenchKimiContextUsed.
  ///
  /// In en, this message translates to:
  /// **'Context {used}'**
  String workbenchKimiContextUsed(String used);

  /// No description provided for @workbenchKimiContext.
  ///
  /// In en, this message translates to:
  /// **'Context'**
  String get workbenchKimiContext;

  /// No description provided for @workbenchKimiModelSyncing.
  ///
  /// In en, this message translates to:
  /// **'Model waiting to sync'**
  String get workbenchKimiModelSyncing;

  /// No description provided for @workbenchKimiQuickCommands.
  ///
  /// In en, this message translates to:
  /// **'Quick commands'**
  String get workbenchKimiQuickCommands;

  /// No description provided for @workbenchKimiNoMatchingCommands.
  ///
  /// In en, this message translates to:
  /// **'No matching commands'**
  String get workbenchKimiNoMatchingCommands;

  /// No description provided for @workbenchKimiTask.
  ///
  /// In en, this message translates to:
  /// **'Task'**
  String get workbenchKimiTask;

  /// No description provided for @workbenchKimiIdle.
  ///
  /// In en, this message translates to:
  /// **'Idle'**
  String get workbenchKimiIdle;

  /// No description provided for @workbenchKimiSubagents.
  ///
  /// In en, this message translates to:
  /// **'Subagents'**
  String get workbenchKimiSubagents;

  /// No description provided for @workbenchKimiActiveCount.
  ///
  /// In en, this message translates to:
  /// **'{count} active'**
  String workbenchKimiActiveCount(int count);

  /// No description provided for @workbenchKimiApprovals.
  ///
  /// In en, this message translates to:
  /// **'Approvals'**
  String get workbenchKimiApprovals;

  /// No description provided for @workbenchKimiPendingCount.
  ///
  /// In en, this message translates to:
  /// **'{count} pending'**
  String workbenchKimiPendingCount(int count);

  /// No description provided for @workbenchKimiSettingsOffline.
  ///
  /// In en, this message translates to:
  /// **'Kimi settings cannot be changed while Relay is offline.'**
  String get workbenchKimiSettingsOffline;

  /// No description provided for @workbenchKimiSettingsRunning.
  ///
  /// In en, this message translates to:
  /// **'Stop the main Kimi task before changing settings.'**
  String get workbenchKimiSettingsRunning;

  /// No description provided for @workbenchKimiNoOptions.
  ///
  /// In en, this message translates to:
  /// **'The computer has not synced any configurable options yet.'**
  String get workbenchKimiNoOptions;

  /// No description provided for @workbenchKimiEncryptedSettings.
  ///
  /// In en, this message translates to:
  /// **'Settings are sent end-to-end encrypted to Kimi Code on your computer. The server cannot read them.'**
  String get workbenchKimiEncryptedSettings;

  /// No description provided for @workbenchKimiManualApproval.
  ///
  /// In en, this message translates to:
  /// **'Manual approval'**
  String get workbenchKimiManualApproval;

  /// No description provided for @workbenchSessionSettings.
  ///
  /// In en, this message translates to:
  /// **'Session settings'**
  String get workbenchSessionSettings;

  /// No description provided for @workbenchSessionSettingsOffline.
  ///
  /// In en, this message translates to:
  /// **'Session settings cannot be changed while Relay is offline.'**
  String get workbenchSessionSettingsOffline;

  /// No description provided for @workbenchSessionSettingsRunning.
  ///
  /// In en, this message translates to:
  /// **'Stop the current task before changing its settings.'**
  String get workbenchSessionSettingsRunning;

  /// No description provided for @workbenchNoConfigOptions.
  ///
  /// In en, this message translates to:
  /// **'The computer has not synced any configurable options yet.'**
  String get workbenchNoConfigOptions;

  /// No description provided for @workbenchEncryptedSessionSettings.
  ///
  /// In en, this message translates to:
  /// **'Settings are sent end-to-end encrypted to {provider} on your computer. The server cannot read them.'**
  String workbenchEncryptedSessionSettings(String provider);

  /// No description provided for @workbenchUnrestrictedPermissionsTitle.
  ///
  /// In en, this message translates to:
  /// **'Change permission mode?'**
  String get workbenchUnrestrictedPermissionsTitle;

  /// No description provided for @workbenchUnrestrictedPermissionsWarning.
  ///
  /// In en, this message translates to:
  /// **'This changes whether local tools are allowed, denied, or require approval. Review the selected mode before continuing.'**
  String get workbenchUnrestrictedPermissionsWarning;

  /// No description provided for @workbenchCoworkCreateOnDesktop.
  ///
  /// In en, this message translates to:
  /// **'Create Cowork tasks in Claude Desktop first; existing tasks can be controlled here.'**
  String get workbenchCoworkCreateOnDesktop;

  /// No description provided for @workbenchProcessing.
  ///
  /// In en, this message translates to:
  /// **'Processing'**
  String get workbenchProcessing;

  /// No description provided for @workbenchProcess.
  ///
  /// In en, this message translates to:
  /// **'Process'**
  String get workbenchProcess;

  /// No description provided for @workbenchDurationMinutesSeconds.
  ///
  /// In en, this message translates to:
  /// **'{minutes} min {seconds} sec'**
  String workbenchDurationMinutesSeconds(int minutes, int seconds);

  /// No description provided for @workbenchDurationSeconds.
  ///
  /// In en, this message translates to:
  /// **'{seconds} sec'**
  String workbenchDurationSeconds(int seconds);

  /// No description provided for @workbenchMonthDay.
  ///
  /// In en, this message translates to:
  /// **'{month}/{day}'**
  String workbenchMonthDay(int month, int day);

  /// No description provided for @workbenchYearMonthDay.
  ///
  /// In en, this message translates to:
  /// **'{year}/{month}/{day}'**
  String workbenchYearMonthDay(int year, int month, int day);

  /// No description provided for @workbenchImageUrlUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The image address is unavailable.'**
  String get workbenchImageUrlUnavailable;

  /// No description provided for @workbenchFilePreviewAvailable.
  ///
  /// In en, this message translates to:
  /// **'Previewable · {kind} · up to 1 MB'**
  String workbenchFilePreviewAvailable(String kind);

  /// No description provided for @workbenchFilePreviewUnsupported.
  ///
  /// In en, this message translates to:
  /// **'This file format cannot be previewed'**
  String get workbenchFilePreviewUnsupported;

  /// No description provided for @workbenchImageReadFailed.
  ///
  /// In en, this message translates to:
  /// **'{name}\nCould not read image'**
  String workbenchImageReadFailed(String name);

  /// No description provided for @workbenchImageThumbnailLabel.
  ///
  /// In en, this message translates to:
  /// **'{name} thumbnail; tap to open the preview'**
  String workbenchImageThumbnailLabel(String name);

  /// No description provided for @workbenchViewOriginal.
  ///
  /// In en, this message translates to:
  /// **'View original'**
  String get workbenchViewOriginal;

  /// No description provided for @workbenchLoadingOriginal.
  ///
  /// In en, this message translates to:
  /// **'Securely loading the original…'**
  String get workbenchLoadingOriginal;

  /// No description provided for @workbenchOriginalReadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not read the original image. Try again.'**
  String get workbenchOriginalReadFailed;

  /// No description provided for @workbenchActivityFailed.
  ///
  /// In en, this message translates to:
  /// **'{label} failed'**
  String workbenchActivityFailed(String label);

  /// No description provided for @workbenchActivityCompleted.
  ///
  /// In en, this message translates to:
  /// **'{label} completed'**
  String workbenchActivityCompleted(String label);

  /// No description provided for @workbenchActivityRunning.
  ///
  /// In en, this message translates to:
  /// **'Running {label}'**
  String workbenchActivityRunning(String label);

  /// No description provided for @workbenchViewOutput.
  ///
  /// In en, this message translates to:
  /// **'Tap to view output'**
  String get workbenchViewOutput;

  /// No description provided for @workbenchViewThumbnail.
  ///
  /// In en, this message translates to:
  /// **'Tap to view thumbnail'**
  String get workbenchViewThumbnail;

  /// No description provided for @workbenchSemanticSeparator.
  ///
  /// In en, this message translates to:
  /// **', '**
  String get workbenchSemanticSeparator;

  /// No description provided for @workbenchCommandsRunning.
  ///
  /// In en, this message translates to:
  /// **'Running {count} commands'**
  String workbenchCommandsRunning(int count);

  /// No description provided for @workbenchCommandsFailed.
  ///
  /// In en, this message translates to:
  /// **'Some of {count} commands failed'**
  String workbenchCommandsFailed(int count);

  /// No description provided for @workbenchCommandsCompleted.
  ///
  /// In en, this message translates to:
  /// **'Ran {count} commands'**
  String workbenchCommandsCompleted(int count);

  /// No description provided for @workbenchFilesReading.
  ///
  /// In en, this message translates to:
  /// **'Reading {count} files'**
  String workbenchFilesReading(int count);

  /// No description provided for @workbenchFilesReadFailed.
  ///
  /// In en, this message translates to:
  /// **'Some of {count} files could not be read'**
  String workbenchFilesReadFailed(int count);

  /// No description provided for @workbenchFilesRead.
  ///
  /// In en, this message translates to:
  /// **'Read {count} files'**
  String workbenchFilesRead(int count);

  /// No description provided for @workbenchFilesChanging.
  ///
  /// In en, this message translates to:
  /// **'Changing {count} files'**
  String workbenchFilesChanging(int count);

  /// No description provided for @workbenchFilesChangeFailed.
  ///
  /// In en, this message translates to:
  /// **'Some changes to {count} files failed'**
  String workbenchFilesChangeFailed(int count);

  /// No description provided for @workbenchFilesChanged.
  ///
  /// In en, this message translates to:
  /// **'Changed {count} files'**
  String workbenchFilesChanged(int count);

  /// No description provided for @workbenchOperationsRunning.
  ///
  /// In en, this message translates to:
  /// **'Processing {count} file and command operations'**
  String workbenchOperationsRunning(int count);

  /// No description provided for @workbenchOperationsFailed.
  ///
  /// In en, this message translates to:
  /// **'Some of {count} file and command operations failed'**
  String workbenchOperationsFailed(int count);

  /// No description provided for @workbenchOperationsCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed {count} file and command operations'**
  String workbenchOperationsCompleted(int count);

  /// No description provided for @workbenchToolCommand.
  ///
  /// In en, this message translates to:
  /// **'Run command'**
  String get workbenchToolCommand;

  /// No description provided for @workbenchToolReadFilesSubject.
  ///
  /// In en, this message translates to:
  /// **'Read {count} files: {subject}'**
  String workbenchToolReadFilesSubject(int count, String subject);

  /// No description provided for @workbenchToolReadFiles.
  ///
  /// In en, this message translates to:
  /// **'Read {count} files'**
  String workbenchToolReadFiles(int count);

  /// No description provided for @workbenchToolReadFileSubject.
  ///
  /// In en, this message translates to:
  /// **'Read file: {subject}'**
  String workbenchToolReadFileSubject(String subject);

  /// No description provided for @workbenchToolReadFile.
  ///
  /// In en, this message translates to:
  /// **'Read file'**
  String get workbenchToolReadFile;

  /// No description provided for @workbenchToolChangeFilesSubject.
  ///
  /// In en, this message translates to:
  /// **'Change {count} files: {subject}'**
  String workbenchToolChangeFilesSubject(int count, String subject);

  /// No description provided for @workbenchToolChangeFiles.
  ///
  /// In en, this message translates to:
  /// **'Change {count} files'**
  String workbenchToolChangeFiles(int count);

  /// No description provided for @workbenchToolChangeFileSubject.
  ///
  /// In en, this message translates to:
  /// **'Change file: {subject}'**
  String workbenchToolChangeFileSubject(String subject);

  /// No description provided for @workbenchToolChangeFile.
  ///
  /// In en, this message translates to:
  /// **'Change file'**
  String get workbenchToolChangeFile;

  /// No description provided for @workbenchToolCallNamed.
  ///
  /// In en, this message translates to:
  /// **'Call tool: {name}'**
  String workbenchToolCallNamed(String name);

  /// No description provided for @workbenchToolCall.
  ///
  /// In en, this message translates to:
  /// **'Call tool'**
  String get workbenchToolCall;

  /// No description provided for @workbenchToolWebSearchSubject.
  ///
  /// In en, this message translates to:
  /// **'Search the web: {subject}'**
  String workbenchToolWebSearchSubject(String subject);

  /// No description provided for @workbenchToolWebSearch.
  ///
  /// In en, this message translates to:
  /// **'Search the web'**
  String get workbenchToolWebSearch;

  /// No description provided for @workbenchToolImageViewSubject.
  ///
  /// In en, this message translates to:
  /// **'View image: {subject}'**
  String workbenchToolImageViewSubject(String subject);

  /// No description provided for @workbenchToolImageView.
  ///
  /// In en, this message translates to:
  /// **'View image'**
  String get workbenchToolImageView;

  /// No description provided for @workbenchToolImageGeneration.
  ///
  /// In en, this message translates to:
  /// **'Generate image'**
  String get workbenchToolImageGeneration;

  /// No description provided for @workbenchToolContextCompaction.
  ///
  /// In en, this message translates to:
  /// **'Compact context automatically'**
  String get workbenchToolContextCompaction;

  /// No description provided for @workbenchToolWait.
  ///
  /// In en, this message translates to:
  /// **'Wait for task'**
  String get workbenchToolWait;

  /// No description provided for @workbenchLocalOperation.
  ///
  /// In en, this message translates to:
  /// **'Local operation'**
  String get workbenchLocalOperation;

  /// No description provided for @workbenchDeliverySent.
  ///
  /// In en, this message translates to:
  /// **'Sent'**
  String get workbenchDeliverySent;

  /// No description provided for @workbenchDeliverySending.
  ///
  /// In en, this message translates to:
  /// **'Sending'**
  String get workbenchDeliverySending;

  /// No description provided for @workbenchDeliveryFailed.
  ///
  /// In en, this message translates to:
  /// **'Send failed'**
  String get workbenchDeliveryFailed;

  /// No description provided for @workbenchAssistantRunningElapsed.
  ///
  /// In en, this message translates to:
  /// **'{agent} is running; elapsed {duration}'**
  String workbenchAssistantRunningElapsed(String agent, String duration);

  /// No description provided for @workbenchAssistantRunning.
  ///
  /// In en, this message translates to:
  /// **'{agent} is running'**
  String workbenchAssistantRunning(String agent);

  /// No description provided for @workbenchAssistantElapsed.
  ///
  /// In en, this message translates to:
  /// **'· elapsed {duration}'**
  String workbenchAssistantElapsed(String duration);

  /// No description provided for @workbenchCloseFilePreview.
  ///
  /// In en, this message translates to:
  /// **'Close file preview'**
  String get workbenchCloseFilePreview;

  /// No description provided for @workbenchFileReadCompleted.
  ///
  /// In en, this message translates to:
  /// **'File read complete: {name}'**
  String workbenchFileReadCompleted(String name);

  /// No description provided for @workbenchFileReading.
  ///
  /// In en, this message translates to:
  /// **'Reading file: {name}'**
  String workbenchFileReading(String name);

  /// No description provided for @workbenchFileReadFailed.
  ///
  /// In en, this message translates to:
  /// **'File read failed: {message}'**
  String workbenchFileReadFailed(String message);

  /// No description provided for @workbenchFilePreviewFailed.
  ///
  /// In en, this message translates to:
  /// **'File preview failed. Try again.'**
  String get workbenchFilePreviewFailed;

  /// No description provided for @workbenchFileKindTableText.
  ///
  /// In en, this message translates to:
  /// **'Tabular text'**
  String get workbenchFileKindTableText;

  /// No description provided for @workbenchFileKindLog.
  ///
  /// In en, this message translates to:
  /// **'Log'**
  String get workbenchFileKindLog;

  /// No description provided for @workbenchFileKindPlainText.
  ///
  /// In en, this message translates to:
  /// **'Plain text'**
  String get workbenchFileKindPlainText;

  /// No description provided for @workbenchFileKindCodeOrConfig.
  ///
  /// In en, this message translates to:
  /// **'Code or configuration'**
  String get workbenchFileKindCodeOrConfig;

  /// No description provided for @workbenchAgentsWorking.
  ///
  /// In en, this message translates to:
  /// **'{count} subagents working in parallel'**
  String workbenchAgentsWorking(int count);

  /// No description provided for @workbenchAgentWindow.
  ///
  /// In en, this message translates to:
  /// **'Agent work window'**
  String get workbenchAgentWindow;

  /// No description provided for @workbenchAgentWindowDescription.
  ///
  /// In en, this message translates to:
  /// **'Syncs task status and tool activity without showing private reasoning'**
  String get workbenchAgentWindowDescription;

  /// No description provided for @workbenchMoreAgents.
  ///
  /// In en, this message translates to:
  /// **'{count} more Agents · scroll down to view'**
  String workbenchMoreAgents(int count);

  /// No description provided for @workbenchCurrentActivity.
  ///
  /// In en, this message translates to:
  /// **'Current · {activity}'**
  String workbenchCurrentActivity(String activity);

  /// No description provided for @workbenchAllAgents.
  ///
  /// In en, this message translates to:
  /// **'All Agents'**
  String get workbenchAllAgents;

  /// No description provided for @workbenchActivityTimeline.
  ///
  /// In en, this message translates to:
  /// **'Activity timeline'**
  String get workbenchActivityTimeline;

  /// No description provided for @workbenchActivityCount.
  ///
  /// In en, this message translates to:
  /// **'{count} entries'**
  String workbenchActivityCount(int count);

  /// No description provided for @workbenchAgentSyncing.
  ///
  /// In en, this message translates to:
  /// **'Syncing from this computer…'**
  String get workbenchAgentSyncing;

  /// No description provided for @workbenchNoPublicActivity.
  ///
  /// In en, this message translates to:
  /// **'No public activity yet. Only task status and tool activity are synced; private model reasoning is not.'**
  String get workbenchNoPublicActivity;

  /// No description provided for @workbenchLatestResult.
  ///
  /// In en, this message translates to:
  /// **'Latest result'**
  String get workbenchLatestResult;

  /// No description provided for @workbenchWaitingForTask.
  ///
  /// In en, this message translates to:
  /// **'Waiting for a task'**
  String get workbenchWaitingForTask;

  /// No description provided for @controllerRestoreFailed.
  ///
  /// In en, this message translates to:
  /// **'Unable to restore the secure connection. Sign in or pair again.'**
  String get controllerRestoreFailed;

  /// No description provided for @controllerAuthorizationRevoked.
  ///
  /// In en, this message translates to:
  /// **'Authorization for this phone was revoked. Connect it again.'**
  String get controllerAuthorizationRevoked;

  /// No description provided for @controllerDeviceNotConnected.
  ///
  /// In en, this message translates to:
  /// **'This account is not connected to this computer. Start the connection again on the computer.'**
  String get controllerDeviceNotConnected;

  /// No description provided for @controllerProjectNameRequired.
  ///
  /// In en, this message translates to:
  /// **'Project name is required.'**
  String get controllerProjectNameRequired;

  /// No description provided for @controllerProjectNameTooLong.
  ///
  /// In en, this message translates to:
  /// **'Project name cannot exceed {maximum} characters.'**
  String controllerProjectNameTooLong(int maximum);

  /// No description provided for @controllerProjectNameSaveFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not save the project name locally. Try again.'**
  String get controllerProjectNameSaveFailed;

  /// No description provided for @controllerProjectNameUpdated.
  ///
  /// In en, this message translates to:
  /// **'Project name updated.'**
  String get controllerProjectNameUpdated;

  /// No description provided for @controllerNewPairingLinkReceived.
  ///
  /// In en, this message translates to:
  /// **'A new connection link was received. Sign out of the current device to connect again.'**
  String get controllerNewPairingLinkReceived;

  /// No description provided for @controllerPairingLinkRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter the Relayune connection link shown by the desktop app.'**
  String get controllerPairingLinkRequired;

  /// No description provided for @controllerPairingDiscoveryFailed.
  ///
  /// In en, this message translates to:
  /// **'Unable to find computers waiting to connect. Try again later.'**
  String get controllerPairingDiscoveryFailed;

  /// No description provided for @controllerVerificationResent.
  ///
  /// In en, this message translates to:
  /// **'Verification email sent again.'**
  String get controllerVerificationResent;

  /// No description provided for @controllerSetPasswordFirst.
  ///
  /// In en, this message translates to:
  /// **'Set a password from the email link first, then return here.'**
  String get controllerSetPasswordFirst;

  /// No description provided for @controllerNoPendingComputer.
  ///
  /// In en, this message translates to:
  /// **'No computer is waiting to connect. Select “Connect new client” on the computer first.'**
  String get controllerNoPendingComputer;

  /// No description provided for @controllerSelectComputer.
  ///
  /// In en, this message translates to:
  /// **'Select the computer to connect.'**
  String get controllerSelectComputer;

  /// No description provided for @controllerPairingFailed.
  ///
  /// In en, this message translates to:
  /// **'Secure connection failed. Check the connection code and try again.'**
  String get controllerPairingFailed;

  /// No description provided for @controllerHistoryReadFailed.
  ///
  /// In en, this message translates to:
  /// **'Unable to read history.'**
  String get controllerHistoryReadFailed;

  /// No description provided for @controllerAgentRefreshFailed.
  ///
  /// In en, this message translates to:
  /// **'Unable to refresh this subagent\'s activity right now.'**
  String get controllerAgentRefreshFailed;

  /// No description provided for @controllerAttachmentTooLarge.
  ///
  /// In en, this message translates to:
  /// **'Files over 1 MB cannot be previewed yet.'**
  String get controllerAttachmentTooLarge;

  /// No description provided for @controllerAttachmentUnsupported.
  ///
  /// In en, this message translates to:
  /// **'This file format cannot be previewed yet.'**
  String get controllerAttachmentUnsupported;

  /// No description provided for @controllerAttachmentGone.
  ///
  /// In en, this message translates to:
  /// **'The file expired or was removed from the computer.'**
  String get controllerAttachmentGone;

  /// No description provided for @controllerAttachmentReadFailed.
  ///
  /// In en, this message translates to:
  /// **'Unable to read the attachment.'**
  String get controllerAttachmentReadFailed;

  /// No description provided for @controllerUploadTooMany.
  ///
  /// In en, this message translates to:
  /// **'You can upload up to {maximum} images per message.'**
  String controllerUploadTooMany(int maximum);

  /// No description provided for @controllerUploadTotalTooLarge.
  ///
  /// In en, this message translates to:
  /// **'Attachments in one message cannot exceed 20 MiB in total.'**
  String get controllerUploadTotalTooLarge;

  /// No description provided for @controllerUploadUnsupported.
  ///
  /// In en, this message translates to:
  /// **'Choose PNG, JPEG, WebP, GIF, or AVIF images.'**
  String get controllerUploadUnsupported;

  /// No description provided for @controllerSteeringUnsupported.
  ///
  /// In en, this message translates to:
  /// **'This task cannot accept more instructions. Stop it first.'**
  String get controllerSteeringUnsupported;

  /// No description provided for @controllerPreparingAgent.
  ///
  /// In en, this message translates to:
  /// **'Received on computer · Preparing Agent'**
  String get controllerPreparingAgent;

  /// No description provided for @controllerWaitingForAgent.
  ///
  /// In en, this message translates to:
  /// **'Waiting for the local Agent to receive it'**
  String get controllerWaitingForAgent;

  /// No description provided for @controllerWaitingForComputer.
  ///
  /// In en, this message translates to:
  /// **'Waiting for the computer to come online'**
  String get controllerWaitingForComputer;

  /// No description provided for @controllerStopSent.
  ///
  /// In en, this message translates to:
  /// **'Stop request sent.'**
  String get controllerStopSent;

  /// No description provided for @controllerApprovalExpired.
  ///
  /// In en, this message translates to:
  /// **'This approval has expired.'**
  String get controllerApprovalExpired;

  /// No description provided for @controllerApprovalOffline.
  ///
  /// In en, this message translates to:
  /// **'Approvals cannot be handled while the computer is offline.'**
  String get controllerApprovalOffline;

  /// No description provided for @controllerApprovalAllowedSent.
  ///
  /// In en, this message translates to:
  /// **'Allow decision sent; waiting for computer confirmation.'**
  String get controllerApprovalAllowedSent;

  /// No description provided for @controllerApprovalRejectedSent.
  ///
  /// In en, this message translates to:
  /// **'Reject decision sent; waiting for computer confirmation.'**
  String get controllerApprovalRejectedSent;

  /// No description provided for @controllerDelegatedTasks.
  ///
  /// In en, this message translates to:
  /// **'Delegated {count} parallel tasks.'**
  String controllerDelegatedTasks(int count);

  /// No description provided for @controllerSelectProject.
  ///
  /// In en, this message translates to:
  /// **'Select a synced project from the sidebar first.'**
  String get controllerSelectProject;

  /// No description provided for @controllerCreateSessionOffline.
  ///
  /// In en, this message translates to:
  /// **'The computer is offline. A session cannot be created right now.'**
  String get controllerCreateSessionOffline;

  /// No description provided for @controllerSessionNameLength.
  ///
  /// In en, this message translates to:
  /// **'Session name must contain 1–{maximum} characters.'**
  String controllerSessionNameLength(int maximum);

  /// No description provided for @controllerSessionCreationBusy.
  ///
  /// In en, this message translates to:
  /// **'The previous session is still being created. Please wait.'**
  String get controllerSessionCreationBusy;

  /// No description provided for @controllerSessionCreating.
  ///
  /// In en, this message translates to:
  /// **'Creating “{name}”…'**
  String controllerSessionCreating(String name);

  /// No description provided for @controllerSessionCreateFailed.
  ///
  /// In en, this message translates to:
  /// **'Unable to create the session. Try again later.'**
  String get controllerSessionCreateFailed;

  /// No description provided for @controllerDesktopSessionCreateFailed.
  ///
  /// In en, this message translates to:
  /// **'The desktop app could not create the session.'**
  String get controllerDesktopSessionCreateFailed;

  /// No description provided for @controllerSessionCreateTimeout.
  ///
  /// In en, this message translates to:
  /// **'Timed out waiting for the desktop app to create the session. Check again later; do not create a duplicate.'**
  String get controllerSessionCreateTimeout;

  /// No description provided for @controllerSessionCreated.
  ///
  /// In en, this message translates to:
  /// **'Created “{name}”.'**
  String controllerSessionCreated(String name);

  /// No description provided for @controllerCoworkCreateOnDesktop.
  ///
  /// In en, this message translates to:
  /// **'Create this Cowork task in Claude Desktop first, then control it here.'**
  String get controllerCoworkCreateOnDesktop;

  /// No description provided for @controllerDesktopConfigFailed.
  ///
  /// In en, this message translates to:
  /// **'The desktop app could not apply the session settings.'**
  String get controllerDesktopConfigFailed;

  /// No description provided for @controllerConfigApplied.
  ///
  /// In en, this message translates to:
  /// **'Session settings applied.'**
  String get controllerConfigApplied;

  /// No description provided for @controllerConfigUpdateFailed.
  ///
  /// In en, this message translates to:
  /// **'Unable to update session settings. Try again later.'**
  String get controllerConfigUpdateFailed;

  /// No description provided for @controllerConfigTimeout.
  ///
  /// In en, this message translates to:
  /// **'Timed out waiting for the desktop app to apply session settings. Refresh to confirm.'**
  String get controllerConfigTimeout;

  /// No description provided for @controllerInvalidEncryptedEvent.
  ///
  /// In en, this message translates to:
  /// **'An encrypted event could not be verified. Sync cursor advancement has stopped.'**
  String get controllerInvalidEncryptedEvent;

  /// No description provided for @controllerApprovalNeeded.
  ///
  /// In en, this message translates to:
  /// **'Waiting for your approval'**
  String get controllerApprovalNeeded;

  /// No description provided for @controllerContinuing.
  ///
  /// In en, this message translates to:
  /// **'Continuing'**
  String get controllerContinuing;

  /// No description provided for @controllerApprovalProcessFailed.
  ///
  /// In en, this message translates to:
  /// **'The computer could not handle this approval. Try again.'**
  String get controllerApprovalProcessFailed;

  /// No description provided for @controllerAgentProcessing.
  ///
  /// In en, this message translates to:
  /// **'{name} is processing'**
  String controllerAgentProcessing(String name);

  /// No description provided for @controllerSummarizing.
  ///
  /// In en, this message translates to:
  /// **'Summarizing results'**
  String get controllerSummarizing;

  /// No description provided for @controllerThinking.
  ///
  /// In en, this message translates to:
  /// **'Thinking'**
  String get controllerThinking;

  /// No description provided for @controllerLocalTaskFailed.
  ///
  /// In en, this message translates to:
  /// **'Local task failed.'**
  String get controllerLocalTaskFailed;

  /// No description provided for @controllerInterruptFailed.
  ///
  /// In en, this message translates to:
  /// **'Unable to stop the current task.'**
  String get controllerInterruptFailed;

  /// No description provided for @controllerReplying.
  ///
  /// In en, this message translates to:
  /// **'Replying'**
  String get controllerReplying;

  /// No description provided for @controllerFinishing.
  ///
  /// In en, this message translates to:
  /// **'Finishing'**
  String get controllerFinishing;

  /// No description provided for @controllerOrganizingFileChanges.
  ///
  /// In en, this message translates to:
  /// **'Organizing file changes'**
  String get controllerOrganizingFileChanges;

  /// No description provided for @controllerFilesModified.
  ///
  /// In en, this message translates to:
  /// **'Modified {count} files.'**
  String controllerFilesModified(int count);

  /// No description provided for @controllerUpdatingPlan.
  ///
  /// In en, this message translates to:
  /// **'Updating the plan'**
  String get controllerUpdatingPlan;

  /// No description provided for @controllerMessageQueued.
  ///
  /// In en, this message translates to:
  /// **'Message queued. It will be sent automatically later.'**
  String get controllerMessageQueued;

  /// No description provided for @controllerSessionPersisted.
  ///
  /// In en, this message translates to:
  /// **'Session saved to {agent}.'**
  String controllerSessionPersisted(String agent);

  /// No description provided for @controllerLocalTool.
  ///
  /// In en, this message translates to:
  /// **'Local tool: {label}'**
  String controllerLocalTool(String label);

  /// No description provided for @controllerProcessingLocalResult.
  ///
  /// In en, this message translates to:
  /// **'Processing local result'**
  String get controllerProcessingLocalResult;

  /// No description provided for @controllerEncryptedResponseTimeout.
  ///
  /// In en, this message translates to:
  /// **'Timed out waiting for the encrypted response from the computer.'**
  String get controllerEncryptedResponseTimeout;

  /// No description provided for @controllerPairingUsedOrExpired.
  ///
  /// In en, this message translates to:
  /// **'This connection has already been used or has expired.'**
  String get controllerPairingUsedOrExpired;

  /// No description provided for @controllerPairingConfirmationTimeout.
  ///
  /// In en, this message translates to:
  /// **'Timed out waiting for desktop confirmation. Start the connection again.'**
  String get controllerPairingConfirmationTimeout;

  /// No description provided for @controllerPairingConfirmationFailed.
  ///
  /// In en, this message translates to:
  /// **'The computer did not confirm the encrypted connection. Connect again.'**
  String get controllerPairingConfirmationFailed;

  /// No description provided for @controllerDesktopOffline.
  ///
  /// In en, this message translates to:
  /// **'The desktop app is not online yet. Keep Relayune open and try again.'**
  String get controllerDesktopOffline;

  /// No description provided for @workbenchDefault.
  ///
  /// In en, this message translates to:
  /// **'Default'**
  String get workbenchDefault;

  /// No description provided for @workbenchAgentToolCount.
  ///
  /// In en, this message translates to:
  /// **'{count} tools'**
  String workbenchAgentToolCount(int count);

  /// No description provided for @workbenchAgentTokenCount.
  ///
  /// In en, this message translates to:
  /// **'{count} tok'**
  String workbenchAgentTokenCount(String count);

  /// No description provided for @apiErrorNetworkUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Unable to connect to Relayune. Check your network and try again.'**
  String get apiErrorNetworkUnavailable;

  /// No description provided for @apiErrorTimeout.
  ///
  /// In en, this message translates to:
  /// **'The request timed out. Please try again.'**
  String get apiErrorTimeout;

  /// No description provided for @apiErrorInvalidResponse.
  ///
  /// In en, this message translates to:
  /// **'Relayune received an invalid server response. Please try again.'**
  String get apiErrorInvalidResponse;

  /// No description provided for @apiErrorInvalidCredentials.
  ///
  /// In en, this message translates to:
  /// **'The email or password is incorrect.'**
  String get apiErrorInvalidCredentials;

  /// No description provided for @apiErrorAuthentication.
  ///
  /// In en, this message translates to:
  /// **'Your sign-in has expired. Please sign in again.'**
  String get apiErrorAuthentication;

  /// No description provided for @apiErrorService.
  ///
  /// In en, this message translates to:
  /// **'Relayune is temporarily unavailable. Please try again later.'**
  String get apiErrorService;

  /// No description provided for @apiErrorGeneric.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong. Please try again.'**
  String get apiErrorGeneric;

  /// No description provided for @controllerFileAccessDenied.
  ///
  /// In en, this message translates to:
  /// **'Relayune on your computer cannot read some session files. Check file access permissions. On Mac, allow access in System Settings → Privacy & Security → Files and Folders, then retry.'**
  String get controllerFileAccessDenied;

  /// No description provided for @workbenchImageWaiting.
  ///
  /// In en, this message translates to:
  /// **'Waiting to load'**
  String get workbenchImageWaiting;

  /// No description provided for @workbenchImageLoading.
  ///
  /// In en, this message translates to:
  /// **'Loading'**
  String get workbenchImageLoading;

  /// No description provided for @feedbackTitle.
  ///
  /// In en, this message translates to:
  /// **'Feedback'**
  String get feedbackTitle;

  /// No description provided for @feedbackIntro.
  ///
  /// In en, this message translates to:
  /// **'What could be better?'**
  String get feedbackIntro;

  /// No description provided for @feedbackSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Share an idea or tell us about a problem.'**
  String get feedbackSubtitle;

  /// No description provided for @feedbackSuggestion.
  ///
  /// In en, this message translates to:
  /// **'Suggestion'**
  String get feedbackSuggestion;

  /// No description provided for @feedbackBug.
  ///
  /// In en, this message translates to:
  /// **'Bug report'**
  String get feedbackBug;

  /// No description provided for @feedbackDescription.
  ///
  /// In en, this message translates to:
  /// **'Description'**
  String get feedbackDescription;

  /// No description provided for @feedbackSuggestionHint.
  ///
  /// In en, this message translates to:
  /// **'What would you improve, and how would it help?'**
  String get feedbackSuggestionHint;

  /// No description provided for @feedbackBugHint.
  ///
  /// In en, this message translates to:
  /// **'What did you do, what did you expect, and what happened?'**
  String get feedbackBugHint;

  /// No description provided for @feedbackInfo.
  ///
  /// In en, this message translates to:
  /// **'Included with your feedback'**
  String get feedbackInfo;

  /// No description provided for @feedbackPrivacy.
  ///
  /// In en, this message translates to:
  /// **'Device details are included. Chats and logs are never uploaded automatically.'**
  String get feedbackPrivacy;

  /// No description provided for @feedbackVersion.
  ///
  /// In en, this message translates to:
  /// **'App version'**
  String get feedbackVersion;

  /// No description provided for @feedbackModel.
  ///
  /// In en, this message translates to:
  /// **'Device model'**
  String get feedbackModel;

  /// No description provided for @feedbackSystem.
  ///
  /// In en, this message translates to:
  /// **'Operating system'**
  String get feedbackSystem;

  /// No description provided for @feedbackUnknown.
  ///
  /// In en, this message translates to:
  /// **'Unavailable'**
  String get feedbackUnknown;

  /// No description provided for @feedbackLoading.
  ///
  /// In en, this message translates to:
  /// **'Reading device information…'**
  String get feedbackLoading;

  /// No description provided for @feedbackSend.
  ///
  /// In en, this message translates to:
  /// **'Submit feedback'**
  String get feedbackSend;

  /// No description provided for @feedbackFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not submit. Your feedback is still here. Check your connection and try again.'**
  String get feedbackFailed;

  /// No description provided for @feedbackEmpty.
  ///
  /// In en, this message translates to:
  /// **'Please describe your feedback first.'**
  String get feedbackEmpty;

  /// No description provided for @feedbackSending.
  ///
  /// In en, this message translates to:
  /// **'Submitting…'**
  String get feedbackSending;

  /// No description provided for @feedbackSubmitNote.
  ///
  /// In en, this message translates to:
  /// **'Your description and the information above will be saved for investigation and improvements.'**
  String get feedbackSubmitNote;

  /// No description provided for @feedbackSuccess.
  ///
  /// In en, this message translates to:
  /// **'Feedback received. Thank you for your help.'**
  String get feedbackSuccess;

  /// No description provided for @feedbackReference.
  ///
  /// In en, this message translates to:
  /// **'Feedback ID'**
  String get feedbackReference;

  /// No description provided for @feedbackDone.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get feedbackDone;

  /// No description provided for @workbenchStoppingTask.
  ///
  /// In en, this message translates to:
  /// **'Stopping…'**
  String get workbenchStoppingTask;

  /// No description provided for @workbenchStopUnconfirmed.
  ///
  /// In en, this message translates to:
  /// **'Stop has not been confirmed yet. Please try again.'**
  String get workbenchStopUnconfirmed;

  /// No description provided for @workbenchPreparingImages.
  ///
  /// In en, this message translates to:
  /// **'Preparing images…'**
  String get workbenchPreparingImages;

  /// No description provided for @workbenchImagePickFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not open photos. Please try again.'**
  String get workbenchImagePickFailed;

  /// No description provided for @feedbackImages.
  ///
  /// In en, this message translates to:
  /// **'Images'**
  String get feedbackImages;

  /// No description provided for @feedbackOptional.
  ///
  /// In en, this message translates to:
  /// **'Optional'**
  String get feedbackOptional;

  /// No description provided for @feedbackImageLimit.
  ///
  /// In en, this message translates to:
  /// **'You can add up to 3 images.'**
  String get feedbackImageLimit;

  /// No description provided for @feedbackImageFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not add the image. Try another image or retry.'**
  String get feedbackImageFailed;

  /// No description provided for @feedbackImagePreview.
  ///
  /// In en, this message translates to:
  /// **'Image preview'**
  String get feedbackImagePreview;

  /// No description provided for @feedbackRemoveImage.
  ///
  /// In en, this message translates to:
  /// **'Remove image'**
  String get feedbackRemoveImage;

  /// No description provided for @feedbackPreparingImages.
  ///
  /// In en, this message translates to:
  /// **'Preparing images…'**
  String get feedbackPreparingImages;

  /// No description provided for @feedbackAddImage.
  ///
  /// In en, this message translates to:
  /// **'Add images'**
  String get feedbackAddImage;

  /// No description provided for @feedbackImagesHint.
  ///
  /// In en, this message translates to:
  /// **'Add screenshots to help us understand.'**
  String get feedbackImagesHint;

  /// No description provided for @feedbackContact.
  ///
  /// In en, this message translates to:
  /// **'Contact details'**
  String get feedbackContact;

  /// No description provided for @feedbackEmail.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get feedbackEmail;

  /// No description provided for @feedbackEmailHint.
  ///
  /// In en, this message translates to:
  /// **'Your account email; edit or leave blank'**
  String get feedbackEmailHint;

  /// No description provided for @feedbackWechat.
  ///
  /// In en, this message translates to:
  /// **'WeChat ID'**
  String get feedbackWechat;

  /// No description provided for @feedbackWechatHint.
  ///
  /// In en, this message translates to:
  /// **'Enter your WeChat ID'**
  String get feedbackWechatHint;

  /// No description provided for @feedbackContactHint.
  ///
  /// In en, this message translates to:
  /// **'Only used to reply to this feedback. Both fields are optional.'**
  String get feedbackContactHint;

  /// No description provided for @feedbackEmailInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid email or leave it blank.'**
  String get feedbackEmailInvalid;

  /// No description provided for @deviceAgents.
  ///
  /// In en, this message translates to:
  /// **'Agents'**
  String get deviceAgents;

  /// No description provided for @deviceAgentReady.
  ///
  /// In en, this message translates to:
  /// **'Connected'**
  String get deviceAgentReady;

  /// No description provided for @deviceAgentRunning.
  ///
  /// In en, this message translates to:
  /// **'Running'**
  String get deviceAgentRunning;

  /// No description provided for @deviceAgentNotInstalled.
  ///
  /// In en, this message translates to:
  /// **'Not installed'**
  String get deviceAgentNotInstalled;

  /// No description provided for @deviceAgentUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Unavailable'**
  String get deviceAgentUnavailable;

  /// No description provided for @deviceAgentNotEnabled.
  ///
  /// In en, this message translates to:
  /// **'Not enabled'**
  String get deviceAgentNotEnabled;

  /// No description provided for @deviceAgentUnknown.
  ///
  /// In en, this message translates to:
  /// **'Not reported'**
  String get deviceAgentUnknown;

  /// No description provided for @deviceAgentOffline.
  ///
  /// In en, this message translates to:
  /// **'Computer offline · Last reported status'**
  String get deviceAgentOffline;

  /// No description provided for @openingTitle.
  ///
  /// In en, this message translates to:
  /// **'Still connected. Wherever you are.'**
  String get openingTitle;

  /// No description provided for @openingSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Pick up your computer’s AI work, from anywhere.'**
  String get openingSubtitle;

  /// No description provided for @openingSkip.
  ///
  /// In en, this message translates to:
  /// **'Skip animation'**
  String get openingSkip;

  /// No description provided for @deviceQuota.
  ///
  /// In en, this message translates to:
  /// **'Subscription limits'**
  String get deviceQuota;

  /// No description provided for @quotaFiveHour.
  ///
  /// In en, this message translates to:
  /// **'5 hours'**
  String get quotaFiveHour;

  /// No description provided for @quotaSevenDay.
  ///
  /// In en, this message translates to:
  /// **'7 days'**
  String get quotaSevenDay;

  /// No description provided for @quotaUsed.
  ///
  /// In en, this message translates to:
  /// **'{percent}% used'**
  String quotaUsed(String percent);

  /// No description provided for @quotaResets.
  ///
  /// In en, this message translates to:
  /// **'Resets {time}'**
  String quotaResets(String time);

  /// No description provided for @quotaUpdated.
  ///
  /// In en, this message translates to:
  /// **'Updated {time}'**
  String quotaUpdated(String time);

  /// No description provided for @quotaPending.
  ///
  /// In en, this message translates to:
  /// **'Not reported'**
  String get quotaPending;

  /// No description provided for @quotaExpired.
  ///
  /// In en, this message translates to:
  /// **'Awaiting new limits'**
  String get quotaExpired;

  /// No description provided for @quotaLimitReached.
  ///
  /// In en, this message translates to:
  /// **'Limit reached'**
  String get quotaLimitReached;

  /// No description provided for @quotaSnapshot.
  ///
  /// In en, this message translates to:
  /// **'Last reported'**
  String get quotaSnapshot;

  /// No description provided for @quotaClaudeHint.
  ///
  /// In en, this message translates to:
  /// **'Claude reports limits during sessions. Unreported windows are not estimated.'**
  String get quotaClaudeHint;

  /// No description provided for @settingsHapticsTitle.
  ///
  /// In en, this message translates to:
  /// **'Touch feedback'**
  String get settingsHapticsTitle;

  /// No description provided for @settingsHapticsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'A gentle tap when a connection or decision is confirmed.'**
  String get settingsHapticsSubtitle;

  /// No description provided for @workbenchBackToLatest.
  ///
  /// In en, this message translates to:
  /// **'Back to latest'**
  String get workbenchBackToLatest;

  /// No description provided for @settingsFontSize.
  ///
  /// In en, this message translates to:
  /// **'Font size'**
  String get settingsFontSize;

  /// No description provided for @settingsFontSizeSmall.
  ///
  /// In en, this message translates to:
  /// **'Small'**
  String get settingsFontSizeSmall;

  /// No description provided for @settingsFontSizeMedium.
  ///
  /// In en, this message translates to:
  /// **'Medium'**
  String get settingsFontSizeMedium;

  /// No description provided for @settingsFontSizeLarge.
  ///
  /// In en, this message translates to:
  /// **'Large'**
  String get settingsFontSizeLarge;

  /// No description provided for @settingsFontSizeSaveFailed.
  ///
  /// In en, this message translates to:
  /// **'Font size changed, but could not be saved. Please try again.'**
  String get settingsFontSizeSaveFailed;

  /// No description provided for @workbenchAgentOrderHint.
  ///
  /// In en, this message translates to:
  /// **'Touch and hold, then drag to reorder'**
  String get workbenchAgentOrderHint;

  /// No description provided for @workbenchAgentOrderSaveFailed.
  ///
  /// In en, this message translates to:
  /// **'Order changed, but could not be saved. Please try again.'**
  String get workbenchAgentOrderSaveFailed;

  /// No description provided for @settingsBuildInfo.
  ///
  /// In en, this message translates to:
  /// **'Version information'**
  String get settingsBuildInfo;

  /// No description provided for @buildTime.
  ///
  /// In en, this message translates to:
  /// **'Built at'**
  String get buildTime;

  /// No description provided for @buildSourceCommit.
  ///
  /// In en, this message translates to:
  /// **'Source commit'**
  String get buildSourceCommit;

  /// No description provided for @buildUnrecorded.
  ///
  /// In en, this message translates to:
  /// **'Not recorded'**
  String get buildUnrecorded;

  /// No description provided for @buildUncommitted.
  ///
  /// In en, this message translates to:
  /// **'Includes uncommitted changes'**
  String get buildUncommitted;

  /// No description provided for @agentTasksTitle.
  ///
  /// In en, this message translates to:
  /// **'Subtasks'**
  String get agentTasksTitle;

  /// No description provided for @agentTasksCount.
  ///
  /// In en, this message translates to:
  /// **'{count} subtasks'**
  String agentTasksCount(int count);

  /// No description provided for @agentTasksViewAll.
  ///
  /// In en, this message translates to:
  /// **'View all {count} subtasks'**
  String agentTasksViewAll(int count);

  /// No description provided for @agentTasksRunning.
  ///
  /// In en, this message translates to:
  /// **'{count} running'**
  String agentTasksRunning(int count);

  /// No description provided for @agentTasksFinished.
  ///
  /// In en, this message translates to:
  /// **'{count} ended'**
  String agentTasksFinished(int count);

  /// No description provided for @agentTasksAttention.
  ///
  /// In en, this message translates to:
  /// **'Needs your attention'**
  String get agentTasksAttention;

  /// No description provided for @agentTasksInProgress.
  ///
  /// In en, this message translates to:
  /// **'In progress'**
  String get agentTasksInProgress;

  /// No description provided for @agentTasksEnded.
  ///
  /// In en, this message translates to:
  /// **'Ended'**
  String get agentTasksEnded;

  /// No description provided for @agentTaskPreparing.
  ///
  /// In en, this message translates to:
  /// **'Preparing'**
  String get agentTaskPreparing;

  /// No description provided for @agentTaskUnknown.
  ///
  /// In en, this message translates to:
  /// **'Status awaiting sync'**
  String get agentTaskUnknown;

  /// No description provided for @agentTaskCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get agentTaskCompleted;

  /// No description provided for @agentTaskFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed'**
  String get agentTaskFailed;

  /// No description provided for @agentTaskStopped.
  ///
  /// In en, this message translates to:
  /// **'Stopped'**
  String get agentTaskStopped;

  /// No description provided for @agentTaskAnswer.
  ///
  /// In en, this message translates to:
  /// **'Waiting for your answer'**
  String get agentTaskAnswer;

  /// No description provided for @agentTaskApprove.
  ///
  /// In en, this message translates to:
  /// **'Waiting for your approval'**
  String get agentTaskApprove;

  /// No description provided for @agentTaskNoResult.
  ///
  /// In en, this message translates to:
  /// **'No result received yet'**
  String get agentTaskNoResult;

  /// No description provided for @agentTaskInstructions.
  ///
  /// In en, this message translates to:
  /// **'Task instructions'**
  String get agentTaskInstructions;

  /// No description provided for @agentTaskRuntime.
  ///
  /// In en, this message translates to:
  /// **'Run information'**
  String get agentTaskRuntime;

  /// No description provided for @agentTaskParent.
  ///
  /// In en, this message translates to:
  /// **'From: {name}'**
  String agentTaskParent(String name);

  /// No description provided for @agentTaskUpdated.
  ///
  /// In en, this message translates to:
  /// **'Updated {time}'**
  String agentTaskUpdated(String time);

  /// No description provided for @agentTaskOffline.
  ///
  /// In en, this message translates to:
  /// **'Computer offline · showing last known status'**
  String get agentTaskOffline;

  /// No description provided for @agentTaskOpenConversation.
  ///
  /// In en, this message translates to:
  /// **'View conversation history'**
  String get agentTaskOpenConversation;

  /// No description provided for @agentTaskEmpty.
  ///
  /// In en, this message translates to:
  /// **'No subtasks yet'**
  String get agentTaskEmpty;

  /// No description provided for @agentTaskFinishedResult.
  ///
  /// In en, this message translates to:
  /// **'Latest reply'**
  String get agentTaskFinishedResult;

  /// No description provided for @liveTaskRunning.
  ///
  /// In en, this message translates to:
  /// **'Working'**
  String get liveTaskRunning;

  /// No description provided for @liveTaskApproval.
  ///
  /// In en, this message translates to:
  /// **'Needs approval'**
  String get liveTaskApproval;

  /// No description provided for @liveTaskQuestion.
  ///
  /// In en, this message translates to:
  /// **'Needs an answer'**
  String get liveTaskQuestion;

  /// No description provided for @liveTaskCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get liveTaskCompleted;

  /// No description provided for @liveTaskFailed.
  ///
  /// In en, this message translates to:
  /// **'Task failed'**
  String get liveTaskFailed;

  /// No description provided for @liveTaskStopped.
  ///
  /// In en, this message translates to:
  /// **'Stopped'**
  String get liveTaskStopped;

  /// No description provided for @liveTaskStale.
  ///
  /// In en, this message translates to:
  /// **'Check latest status'**
  String get liveTaskStale;

  /// No description provided for @liveTaskOpen.
  ///
  /// In en, this message translates to:
  /// **'View task'**
  String get liveTaskOpen;

  /// No description provided for @liveTaskReview.
  ///
  /// In en, this message translates to:
  /// **'Review'**
  String get liveTaskReview;

  /// No description provided for @liveTaskElapsed.
  ///
  /// In en, this message translates to:
  /// **'Elapsed'**
  String get liveTaskElapsed;

  /// No description provided for @liveTaskUpdated.
  ///
  /// In en, this message translates to:
  /// **'Last synced'**
  String get liveTaskUpdated;

  /// No description provided for @androidPushDisclosure.
  ///
  /// In en, this message translates to:
  /// **'Enable background alerts with JPush and, on supported devices, vivo Push. They process a push identifier, Android ID, device/system and network information for delivery. Task content and encryption keys are not sent to these providers. You can turn alerts off in system settings.'**
  String get androidPushDisclosure;

  /// No description provided for @controllerSessionUnavailable.
  ///
  /// In en, this message translates to:
  /// **'This conversation is unavailable on the connected computer. Check that its Agent is running and the conversation still exists, then retry or start a new conversation.'**
  String get controllerSessionUnavailable;

  /// No description provided for @settingsSidebarAgents.
  ///
  /// In en, this message translates to:
  /// **'Sidebar agents'**
  String get settingsSidebarAgents;

  /// No description provided for @settingsSidebarAgentsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Choose which agents appear in the sidebar'**
  String get settingsSidebarAgentsSubtitle;

  /// No description provided for @turnStatusRunning.
  ///
  /// In en, this message translates to:
  /// **'Processing'**
  String get turnStatusRunning;

  /// No description provided for @turnStatusCompleted.
  ///
  /// In en, this message translates to:
  /// **'Turn completed'**
  String get turnStatusCompleted;

  /// No description provided for @turnStatusInterrupted.
  ///
  /// In en, this message translates to:
  /// **'This turn did not complete'**
  String get turnStatusInterrupted;

  /// No description provided for @turnStatusUnknown.
  ///
  /// In en, this message translates to:
  /// **'Activity log'**
  String get turnStatusUnknown;

  /// No description provided for @localWebTitle.
  ///
  /// In en, this message translates to:
  /// **'Computer webpage'**
  String get localWebTitle;

  /// No description provided for @localWebOpen.
  ///
  /// In en, this message translates to:
  /// **'Open webpage'**
  String get localWebOpen;

  /// No description provided for @localWebNotice.
  ///
  /// In en, this message translates to:
  /// **'This page can load resources and submit forms or API requests to this address on your computer.'**
  String get localWebNotice;

  /// No description provided for @localWebUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The webpage is unavailable. Check that the computer and local service are running. A timed-out submission may already have succeeded; check before submitting again.'**
  String get localWebUnavailable;

  /// No description provided for @localWebUpdate.
  ///
  /// In en, this message translates to:
  /// **'Update the desktop app to preview computer webpages.'**
  String get localWebUpdate;

  /// No description provided for @localWebPaused.
  ///
  /// In en, this message translates to:
  /// **'The preview closed when the app left the foreground. Reopen to continue.'**
  String get localWebPaused;

  /// No description provided for @localWebRefresh.
  ///
  /// In en, this message translates to:
  /// **'Reload webpage'**
  String get localWebRefresh;

  /// No description provided for @localWebBack.
  ///
  /// In en, this message translates to:
  /// **'Previous page'**
  String get localWebBack;

  /// No description provided for @localWebBlocked.
  ///
  /// In en, this message translates to:
  /// **'This preview only permits the selected computer address.'**
  String get localWebBlocked;

  /// No description provided for @localWebForward.
  ///
  /// In en, this message translates to:
  /// **'Next page'**
  String get localWebForward;

  /// No description provided for @localWebAddress.
  ///
  /// In en, this message translates to:
  /// **'Page address'**
  String get localWebAddress;

  /// No description provided for @localWebLoading.
  ///
  /// In en, this message translates to:
  /// **'Connecting to your computer…'**
  String get localWebLoading;

  /// No description provided for @accountDeletionTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete account'**
  String get accountDeletionTitle;

  /// No description provided for @accountDeletionBody.
  ///
  /// In en, this message translates to:
  /// **'This permanently deletes your Relayune account, device authorizations, preferences and submitted feedback. Your signed-in devices will lose access. History cache keys on this phone will be removed. Agent projects and files on your computers are not deleted.'**
  String get accountDeletionBody;

  /// No description provided for @accountDeletionPassword.
  ///
  /// In en, this message translates to:
  /// **'Confirm your password'**
  String get accountDeletionPassword;

  /// No description provided for @accountDeletionConfirm.
  ///
  /// In en, this message translates to:
  /// **'Permanently delete my account'**
  String get accountDeletionConfirm;

  /// No description provided for @accountDeletionBusy.
  ///
  /// In en, this message translates to:
  /// **'Deleting…'**
  String get accountDeletionBusy;

  /// No description provided for @accountDeletionWrongPassword.
  ///
  /// In en, this message translates to:
  /// **'Incorrect password. Please try again.'**
  String get accountDeletionWrongPassword;

  /// No description provided for @accountDeletionFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not complete deletion. Check your connection and retry. If deletion has started, other account access remains disabled until cleanup finishes.'**
  String get accountDeletionFailed;

  /// No description provided for @accountDeletionDone.
  ///
  /// In en, this message translates to:
  /// **'Your account has been deleted.'**
  String get accountDeletionDone;

  /// No description provided for @controllerPendingInputSaveFailed.
  ///
  /// In en, this message translates to:
  /// **'Your message could not be saved on this phone. Free up storage and try again.'**
  String get controllerPendingInputSaveFailed;

  /// No description provided for @workbenchHistoryRequestSending.
  ///
  /// In en, this message translates to:
  /// **'Sending request'**
  String get workbenchHistoryRequestSending;

  /// No description provided for @workbenchHistoryWaitingComputer.
  ///
  /// In en, this message translates to:
  /// **'Waiting for your computer'**
  String get workbenchHistoryWaitingComputer;

  /// No description provided for @workbenchHistoryReadingComputer.
  ///
  /// In en, this message translates to:
  /// **'Reading history on your computer'**
  String get workbenchHistoryReadingComputer;

  /// No description provided for @workbenchHistoryPreparing.
  ///
  /// In en, this message translates to:
  /// **'Preparing messages'**
  String get workbenchHistoryPreparing;

  /// Elapsed time for the current history read, in whole seconds.
  ///
  /// In en, this message translates to:
  /// **'{seconds}s elapsed'**
  String workbenchHistoryElapsed(int seconds);

  /// No description provided for @workbenchHistoryTransferring.
  ///
  /// In en, this message translates to:
  /// **'Transferring history'**
  String get workbenchHistoryTransferring;

  /// Observed byte counts for the current history read; unknown counts are not displayed. Sizes use decimal B/KB/MB units.
  ///
  /// In en, this message translates to:
  /// **'Computer read {read} / {total}'**
  String workbenchHistorySourceRead(String read, String total);

  /// Observed byte counts for the current history read; unknown counts are not displayed. Sizes use decimal B/KB/MB units.
  ///
  /// In en, this message translates to:
  /// **'Page awaiting transfer: {size}'**
  String workbenchHistoryPendingTransfer(String size);

  /// Observed byte counts for the current history read; unknown counts are not displayed. Sizes use decimal B/KB/MB units.
  ///
  /// In en, this message translates to:
  /// **'Received {size}'**
  String workbenchHistoryReceived(String size);

  /// Observed byte counts for the current history read; unknown counts are not displayed. Sizes use decimal B/KB/MB units.
  ///
  /// In en, this message translates to:
  /// **'Awaiting reception: {size}'**
  String workbenchHistoryPendingReceive(String size);

  /// No description provided for @workbenchHistoryReadingCache.
  ///
  /// In en, this message translates to:
  /// **'Reading saved history on this phone'**
  String get workbenchHistoryReadingCache;

  /// No description provided for @localWebResources.
  ///
  /// In en, this message translates to:
  /// **'Page resources'**
  String get localWebResources;

  /// No description provided for @localWebGettingPage.
  ///
  /// In en, this message translates to:
  /// **'Getting the webpage…'**
  String get localWebGettingPage;

  /// No description provided for @localWebLoadingPage.
  ///
  /// In en, this message translates to:
  /// **'Loading the page…'**
  String get localWebLoadingPage;

  /// No description provided for @localWebResourceSummary.
  ///
  /// In en, this message translates to:
  /// **'{completed} received · {active} in progress'**
  String localWebResourceSummary(int completed, int active);

  /// No description provided for @localWebResourceFailures.
  ///
  /// In en, this message translates to:
  /// **'{count} failed'**
  String localWebResourceFailures(int count);

  /// No description provided for @localWebResourceWaiting.
  ///
  /// In en, this message translates to:
  /// **'Waiting for response'**
  String get localWebResourceWaiting;

  /// No description provided for @localWebResourceReceiving.
  ///
  /// In en, this message translates to:
  /// **'Receiving'**
  String get localWebResourceReceiving;

  /// No description provided for @localWebResourcePreparing.
  ///
  /// In en, this message translates to:
  /// **'Preparing'**
  String get localWebResourcePreparing;

  /// No description provided for @localWebResourceComplete.
  ///
  /// In en, this message translates to:
  /// **'Received'**
  String get localWebResourceComplete;

  /// No description provided for @localWebResourceFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed'**
  String get localWebResourceFailed;

  /// No description provided for @localWebResourceCancelled.
  ///
  /// In en, this message translates to:
  /// **'Stopped'**
  String get localWebResourceCancelled;

  /// No description provided for @localWebResourceTransferNote.
  ///
  /// In en, this message translates to:
  /// **'Progress measures response reception. The page may request more resources.'**
  String get localWebResourceTransferNote;

  /// No description provided for @localWebResourceEmpty.
  ///
  /// In en, this message translates to:
  /// **'Resources requested by this page will appear here.'**
  String get localWebResourceEmpty;

  /// No description provided for @localWebResourceRecent.
  ///
  /// In en, this message translates to:
  /// **'Showing the latest {count} resources'**
  String localWebResourceRecent(int count);

  /// No description provided for @localWebElapsed.
  ///
  /// In en, this message translates to:
  /// **'{seconds} s'**
  String localWebElapsed(String seconds);

  /// No description provided for @localWebOpeningTitle.
  ///
  /// In en, this message translates to:
  /// **'A page from your computer'**
  String get localWebOpeningTitle;

  /// No description provided for @localWebOpeningHint.
  ///
  /// In en, this message translates to:
  /// **'Keep your computer and webpage service running. The page will appear automatically.'**
  String get localWebOpeningHint;

  /// No description provided for @replyBranchLabel.
  ///
  /// In en, this message translates to:
  /// **'Branch to new chat'**
  String get replyBranchLabel;

  /// No description provided for @replyBranchSameDirectory.
  ///
  /// In en, this message translates to:
  /// **'Use original project directory'**
  String get replyBranchSameDirectory;

  /// No description provided for @replyBranchSameDirectoryDescription.
  ///
  /// In en, this message translates to:
  /// **'Continue sharing project files'**
  String get replyBranchSameDirectoryDescription;

  /// No description provided for @replyBranchWorktree.
  ///
  /// In en, this message translates to:
  /// **'Create new worktree'**
  String get replyBranchWorktree;

  /// No description provided for @replyBranchWorktreeDescription.
  ///
  /// In en, this message translates to:
  /// **'Separate directory, based on the current commit'**
  String get replyBranchWorktreeDescription;

  /// No description provided for @controllerReplyBranchOffline.
  ///
  /// In en, this message translates to:
  /// **'Connect to your computer to branch'**
  String get controllerReplyBranchOffline;

  /// No description provided for @controllerReplyBranchCreating.
  ///
  /// In en, this message translates to:
  /// **'Creating new chat…'**
  String get controllerReplyBranchCreating;

  /// No description provided for @controllerReplyBranchCreated.
  ///
  /// In en, this message translates to:
  /// **'Branched to a new chat using the original project directory.'**
  String get controllerReplyBranchCreated;

  /// No description provided for @controllerReplyBranchFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not create the new chat. Try again.'**
  String get controllerReplyBranchFailed;

  /// No description provided for @controllerReplyBranchUnconfirmed.
  ///
  /// In en, this message translates to:
  /// **'Branch result is unconfirmed. Stay connected and retry to check.'**
  String get controllerReplyBranchUnconfirmed;

  /// No description provided for @controllerReplyBranchUnavailable.
  ///
  /// In en, this message translates to:
  /// **'This reply cannot be branched. Refresh the conversation.'**
  String get controllerReplyBranchUnavailable;

  /// No description provided for @controllerReplyBranchBusy.
  ///
  /// In en, this message translates to:
  /// **'Another chat operation is in progress. Try again shortly.'**
  String get controllerReplyBranchBusy;

  /// No description provided for @controllerReplyBranchWorktreeFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not create the worktree. Check the project on your computer and try again.'**
  String get controllerReplyBranchWorktreeFailed;

  /// No description provided for @controllerReplyBranchWorktreeCreated.
  ///
  /// In en, this message translates to:
  /// **'Branched to a new chat using a separate worktree.'**
  String get controllerReplyBranchWorktreeCreated;

  /// No description provided for @agentTasksCompletedCount.
  ///
  /// In en, this message translates to:
  /// **'{count} completed'**
  String agentTasksCompletedCount(int count);

  /// No description provided for @agentTasksStoppedCount.
  ///
  /// In en, this message translates to:
  /// **'{count} stopped'**
  String agentTasksStoppedCount(int count);

  /// No description provided for @agentTasksFailedCount.
  ///
  /// In en, this message translates to:
  /// **'{count} failed'**
  String agentTasksFailedCount(int count);

  /// No description provided for @agentTasksPreparingCount.
  ///
  /// In en, this message translates to:
  /// **'{count} preparing'**
  String agentTasksPreparingCount(int count);

  /// No description provided for @agentTasksUnknownCount.
  ///
  /// In en, this message translates to:
  /// **'{count} awaiting sync'**
  String agentTasksUnknownCount(int count);

  /// No description provided for @agentTasksSearch.
  ///
  /// In en, this message translates to:
  /// **'Search tasks, nicknames or models'**
  String get agentTasksSearch;

  /// No description provided for @agentTasksNoMatches.
  ///
  /// In en, this message translates to:
  /// **'No matching subtasks'**
  String get agentTasksNoMatches;

  /// No description provided for @agentTaskModelConfiguration.
  ///
  /// In en, this message translates to:
  /// **'Model configuration'**
  String get agentTaskModelConfiguration;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) => <String>[
    'ar',
    'bn',
    'en',
    'es',
    'fr',
    'hi',
    'id',
    'pt',
    'ur',
    'zh',
  ].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when language+country codes are specified.
  switch (locale.languageCode) {
    case 'zh':
      {
        switch (locale.countryCode) {
          case 'CN':
            return AppLocalizationsZhCn();
        }
        break;
      }
  }

  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'ar':
      return AppLocalizationsAr();
    case 'bn':
      return AppLocalizationsBn();
    case 'en':
      return AppLocalizationsEn();
    case 'es':
      return AppLocalizationsEs();
    case 'fr':
      return AppLocalizationsFr();
    case 'hi':
      return AppLocalizationsHi();
    case 'id':
      return AppLocalizationsId();
    case 'pt':
      return AppLocalizationsPt();
    case 'ur':
      return AppLocalizationsUr();
    case 'zh':
      return AppLocalizationsZh();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
