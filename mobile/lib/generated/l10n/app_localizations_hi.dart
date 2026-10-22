// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Hindi (`hi`).
class AppLocalizationsHi extends AppLocalizations {
  AppLocalizationsHi([String locale = 'hi']) : super(locale);

  @override
  String get workbenchStateAnswered => 'उत्तर दिया गया';

  @override
  String get workbenchTurnIncomplete => 'यह प्रयास पूरा नहीं हुआ';

  @override
  String get controllerQueueUnconfirmed =>
      'संदेश की प्रक्रिया की स्थिति की पुष्टि नहीं हुई है। बातचीत रीफ़्रेश करें।';

  @override
  String get homeGreetingMorning => 'सुप्रभात';

  @override
  String get homeGreetingNoon => 'शुभ दोपहर';

  @override
  String get homeGreetingAfternoon => 'शुभ दोपहर';

  @override
  String get homeGreetingEvening => 'शुभ संध्या';

  @override
  String get homeGreetingNight => 'रात गहरा गई है';

  @override
  String get homeCareLongBreak =>
      'काफ़ी देर से ध्यान लगा रहे हैं। चाहें तो थोड़ा लंबा विराम लें।';

  @override
  String get homeCarePause => 'थोड़ा पानी पिएँ, दूर देखें। कुछ पल अपने लिए।';

  @override
  String get homeCareNightWorking =>
      'अभी भी काम कर रहे हैं? आज रात आराम के लिए भी समय रखें।';

  @override
  String get homeCareNightQuiet => 'थोड़ा काम कल के लिए छोड़ना भी ठीक है।';

  @override
  String get homeCareBusyDay =>
      'आज यहाँ काफ़ी समय बिताया। थोड़ा समय अपने लिए भी रखें।';

  @override
  String get homeCareDecision => 'आराम से सोचें, अपनी गति से फ़ैसला लें।';

  @override
  String get homeCareLongWait =>
      'इंतज़ार लंबा हो रहा है। इस बीच अपना भी ख़याल रखें।';

  @override
  String get homeCareWelcomeBack => 'फिर स्वागत है। अपनी गति से आगे बढ़ें।';

  @override
  String get homeCareFirstIdea => 'जब तैयार हों, एक विचार से शुरुआत करें।';

  @override
  String get homeCareMeal =>
      'अभी तक खाना नहीं खाया? खाने के लिए भी थोड़ा समय रखें।';

  @override
  String get homeCareEasterEgg =>
      'छोटी-सी उपलब्धि: अपना ख़याल रखना। बिना किसी प्रगति पट्टी के।';

  @override
  String get homeCareWeekend =>
      'यह सप्ताहांत अपनी गति से बिताएँ, कुछ पल ख़ाली भी रखें।';

  @override
  String get homeCareDailyProgress => 'आज थोड़ी प्रगति हो, और थोड़ा सुकून भी।';

  @override
  String get homeCareDailySpace => 'विचारों को खुली जगह चाहिए। आपको भी।';

  @override
  String get homeCareDailyPace =>
      'एक बार में एक काम, और थोड़ी गुंजाइश अपने लिए।';

  @override
  String get workbenchReturnHome => 'होम पर लौटें';

  @override
  String get workbenchVisualization => 'विज़ुअलाइज़ेशन';

  @override
  String get workbenchVisualizationUnavailable =>
      'यह विज़ुअलाइज़ेशन अभी उपलब्ध नहीं है।';

  @override
  String get workbenchDesktopVersionUnknown => 'संस्करण अज्ञात';

  @override
  String get appTitle => 'Relayune';

  @override
  String get commonBack => 'वापस';

  @override
  String get commonCancel => 'रद्द करें';

  @override
  String get commonClose => 'बंद करें';

  @override
  String get commonContinue => 'जारी रखें';

  @override
  String get commonRetry => 'फिर कोशिश करें';

  @override
  String get commonSave => 'सहेजें';

  @override
  String get commonSubmit => 'भेजें';

  @override
  String get commonSettings => 'सेटिंग';

  @override
  String get commonLogOut => 'साइन आउट';

  @override
  String get commonReject => 'अस्वीकार करें';

  @override
  String get commonAllow => 'अनुमति दें';

  @override
  String get unavailableTitle => 'Relayune फ़िलहाल उपलब्ध नहीं है';

  @override
  String get clearLoginSession => 'लॉगिन सत्र हटाएँ';

  @override
  String get updateInstallerUnavailable =>
      'सिस्टम इंस्टॉलर नहीं खुल सका। बाद में फिर कोशिश करें।';

  @override
  String get updateReadyTitle => 'अपडेट तैयार है';

  @override
  String updateDownloaded(String version) {
    return 'Relayune $version को बैकग्राउंड में सुरक्षित रूप से डाउनलोड और सत्यापित किया गया।';
  }

  @override
  String get updateLater => 'बाद में';

  @override
  String get updateInstall => 'अपडेट इंस्टॉल करें';

  @override
  String get authSecurityBadge => 'एंड-टू-एंड एन्क्रिप्टेड कार्यस्थान';

  @override
  String get authEmailTitle => 'फ़ोन से अपने कंप्यूटर के काम जारी रखें';

  @override
  String get authPasswordTitle => 'साइन इन करें या खाता बनाएँ';

  @override
  String get authVerificationTitle => 'अपना ईमेल देखें';

  @override
  String get authEmailSubtitle =>
      'साइन इन करने के बाद एंड-टू-एंड एन्क्रिप्टेड कनेक्शन बनाने के लिए डेस्कटॉप पर दिखा 8-अक्षर का कोड डालें।';

  @override
  String get authPasswordSubtitle =>
      'पासवर्ड से साइन इन करें या पहली बार ईमेल सत्यापित करें।';

  @override
  String get authVerificationSubtitle =>
      'सत्यापन लिंक केवल एक बार उपयोग होता है और जल्द समाप्त हो जाता है।';

  @override
  String get authEmailLabel => 'ईमेल';

  @override
  String get authInvalidEmail => 'मान्य ईमेल पता डालें।';

  @override
  String get authContinue => 'जारी रखें';

  @override
  String get authChangeEmail => 'ईमेल बदलें';

  @override
  String get authPasswordLabel => 'पासवर्ड';

  @override
  String get authShowPassword => 'पासवर्ड दिखाएँ';

  @override
  String get authHidePassword => 'पासवर्ड छिपाएँ';

  @override
  String get authPasswordRequired => 'पासवर्ड डालें।';

  @override
  String get authSignIn => 'साइन इन';

  @override
  String get authVerifyEmailAction =>
      'पहली बार या पासवर्ड भूल गए? ईमेल सत्यापित करें';

  @override
  String get authVerificationInstructions =>
      'सत्यापन ईमेल खोलें और सुरक्षित वेब पेज पर पासवर्ड बनाएँ, फिर यहाँ लौटें।';

  @override
  String get authPasswordSet => 'मैंने पासवर्ड बना लिया';

  @override
  String get authResendEmail => 'ईमेल फिर भेजें';

  @override
  String get authSecurityNote =>
      'सर्वर केवल सिफ़रटेक्स्ट भेजता है। कनेक्शन कोड और कंटेंट कुंजियाँ कभी अपलोड नहीं होतीं।';

  @override
  String get pairingExit => 'बाहर निकलें';

  @override
  String get pairingTitle => 'स्कैन करके कंप्यूटर कनेक्ट करें';

  @override
  String get pairingSubtitle => 'अपना काम साथ ले चलें।';

  @override
  String get pairingEnterCodeTitle => 'या 8 अक्षरों का कोड डालें';

  @override
  String get pairingEnterCodeHelp => 'कंप्यूटर पर दिखा कनेक्शन कोड डालें।';

  @override
  String get pairingSearching =>
      'कनेक्शन की प्रतीक्षा कर रहे कंप्यूटर खोजे जा रहे हैं…';

  @override
  String get pairingComputerLabel => 'कनेक्ट करने वाला कंप्यूटर';

  @override
  String pairingWillConnect(String device) {
    return 'कनेक्ट हो रहा है: $device';
  }

  @override
  String get pairingStartOnDesktop =>
      'पहले डेस्कटॉप पर “नया क्लाइंट कनेक्ट करें” चुनें, फिर नया कोड डालें।';

  @override
  String get pairingSearchAgain => 'फिर खोजें';

  @override
  String get pairingCodeLabel => '8-अक्षर का कनेक्शन कोड';

  @override
  String get pairingSecureConnect => 'सुरक्षित रूप से कनेक्ट करें';

  @override
  String get pairingScanTitle => 'QR कोड कहाँ है?';

  @override
  String get pairingScanHelp =>
      'कंप्यूटर पर Relayune खोलें और “नया क्लाइंट कनेक्ट करें” चुनें।\nउस विंडो का QR कोड स्कैन करें।';

  @override
  String get pairingOpenCamera => 'स्कैन करके कनेक्ट करें';

  @override
  String get pairingPrivacyNote =>
      'एंड-टू-एंड एन्क्रिप्टेड। केवल आपके डिवाइस सत्र पढ़ सकते हैं।';

  @override
  String pairingMinimumDesktop(String version) {
    return 'न्यूनतम संगत डेस्कटॉप संस्करण: $version';
  }

  @override
  String get pairingDeriving => 'कनेक्शन सत्यापित हो रहा है…';

  @override
  String get pairingWaitingDesktop => 'कंप्यूटर की पुष्टि की प्रतीक्षा…';

  @override
  String get pairingActivating => 'एन्क्रिप्टेड चैनल बन रहा है…';

  @override
  String get pairingDerivingDetail =>
      'इस डिवाइस पर SPAKE2 प्रत्युत्तर शेयर और एक स्वतंत्र सामग्री कुंजी बनाई जा रही है।';

  @override
  String get pairingWaitingDesktopDetail => 'कंप्यूटर पर Relayune खुला रखें।';

  @override
  String get pairingActivatingDetail =>
      'पहली एन्क्रिप्टेड सत्र सूची की पुष्टि की जा रही है।';

  @override
  String get scannerTitle => 'कंप्यूटर पर कनेक्शन QR कोड स्कैन करें';

  @override
  String get scannerResume => 'स्कैन फिर शुरू करें';

  @override
  String get scannerInvalid =>
      'यह Relayune कनेक्शन QR कोड नहीं है। डेस्कटॉप पर दिख रहा वर्तमान कोड स्कैन करें।';

  @override
  String get scannerHelp => 'कंप्यूटर पर Relayune का QR कोड फ़्रेम में रखें।';

  @override
  String get scannerUnavailable =>
      'कैमरा उपलब्ध नहीं है। सिस्टम सेटिंग में Relayune को कैमरा अनुमति दें या मैन्युअल रूप से कनेक्ट करें।';

  @override
  String get settingsTitle => 'सेटिंग';

  @override
  String get settingsSignedInAccount => 'साइन-इन खाता';

  @override
  String get settingsAccountSection => 'खाता';

  @override
  String get settingsPreferencesSection => 'प्राथमिकताएँ';

  @override
  String get settingsHelpLegalSection => 'सहायता और कानूनी';

  @override
  String get settingsLanguage => 'भाषा';

  @override
  String get settingsLanguageSystemDefault => 'डिफ़ॉल्ट (सिस्टम भाषा)';

  @override
  String settingsLanguageSystemDefaultValue(String language) {
    return 'डिफ़ॉल्ट · $language';
  }

  @override
  String get settingsLanguageSaveFailed =>
      'भाषा बदल गई, लेकिन प्राथमिकता सहेजी नहीं जा सकी।';

  @override
  String get settingsReleaseNotes => 'रिलीज़ नोट्स';

  @override
  String get settingsSupport => 'सहायता';

  @override
  String get settingsTerms => 'सेवा की शर्तें';

  @override
  String get settingsPrivacy => 'गोपनीयता नीति';

  @override
  String get settingsLegalLanguage => 'हिन्दी';

  @override
  String get settingsOpenLinkFailed => 'यह लिंक नहीं खुल सका।';

  @override
  String get releaseTitle => 'रिलीज़ नोट्स';

  @override
  String get releaseLoading => 'रिलीज़ नोट्स लोड हो रहे हैं';

  @override
  String get releaseErrorTitle => 'रिलीज़ नोट्स उपलब्ध नहीं';

  @override
  String get releaseErrorMessage => 'कनेक्शन जाँचें और फिर कोशिश करें।';

  @override
  String get releaseEmptyTitle => 'अभी कोई रिलीज़ नोट्स नहीं';

  @override
  String get releaseEmptyMessage => 'आगे के अपडेट यहाँ दिखेंगे।';

  @override
  String get releaseVersion => 'संस्करण';

  @override
  String get releaseWeb => 'वेब';

  @override
  String get releaseServer => 'सर्वर';

  @override
  String get notificationEnabledTitle => 'टास्क सूचनाएँ चालू हैं';

  @override
  String get notificationPrimerTitle =>
      'टास्क कंप्यूटर पर चलता है—लगातार देखने की ज़रूरत नहीं';

  @override
  String get notificationEnabledBody =>
      'ध्यान चाहिए या मुख्य टास्क पूरा हो तो Relayune आपको बताता है।';

  @override
  String get notificationPrimerBody =>
      'मंज़ूरी और सवाल समय पर संभालें, फिर पूरा होने पर जवाब का सार देखें।';

  @override
  String get notificationBenefitAction =>
      'ध्यान आवश्यक: सूचना से अनुमति दें, अस्वीकार करें या जवाब खोलें';

  @override
  String get notificationBenefitCompletion =>
      'टास्क पूरा: खोलने से पहले सार देखें';

  @override
  String get notificationBenefitPrivacy =>
      'सूचनाएँ कमांड, फ़ाइल पथ, कनेक्शन कोड या कुंजियाँ कभी नहीं दिखातीं';

  @override
  String get notificationPermissionRejected =>
      'सिस्टम सूचनाएँ अभी बंद हैं। सेटिंग में Relayune को अनुमति दें।';

  @override
  String get notificationGotIt => 'समझ गया';

  @override
  String get notificationOpenSettings => 'सिस्टम सेटिंग खोलें';

  @override
  String get notificationEnable => 'टास्क सूचनाएँ चालू करें';

  @override
  String get notificationNotNow => 'अभी नहीं';

  @override
  String get notificationSemanticsExample =>
      'सूचना उदाहरण: मंज़ूरी पर ध्यान चाहिए, सवाल का जवाब चाहिए और Claude टास्क उत्तर-सार के साथ पूरा हुआ';

  @override
  String get notificationNow => 'अभी';

  @override
  String get notificationSampleTask => 'मोबाइल सूचनाएँ बेहतर करें';

  @override
  String get notificationSampleBody =>
      'सूचना अनुमति मार्गदर्शन और टास्क-पूर्णता सार तैयार हैं…';

  @override
  String get notificationApprovalTitle => 'कार्रवाई पुष्टि की प्रतीक्षा में';

  @override
  String get notificationQuestionTitle => 'आपका जवाब चाहिए';

  @override
  String notificationTaskPaused(String provider) {
    return '$provider · टास्क रुका हुआ';
  }

  @override
  String notificationApprovalBody(int minutes) {
    return 'इस कार्रवाई को $minutes मिनट में अनुमति दें या अस्वीकार करें।';
  }

  @override
  String notificationQuestionBody(int minutes) {
    return '$minutes मिनट में जवाब दें। भेजने के बाद टास्क जारी होगा।';
  }

  @override
  String notificationTaskCompleted(String provider) {
    return '$provider टास्क पूरा हुआ';
  }

  @override
  String get notificationMainTask => 'मुख्य टास्क';

  @override
  String get notificationMainResultReady =>
      'मुख्य टास्क का परिणाम तैयार है। देखने के लिए टैप करें।';

  @override
  String notificationNamedResultReady(String name) {
    return '“$name” का परिणाम तैयार है। देखने के लिए टैप करें।';
  }

  @override
  String get notificationAllowOnce => 'एक बार अनुमति';

  @override
  String get notificationAnswer => 'जवाब दें';

  @override
  String get notificationChannelAttention => 'ध्यान आवश्यक';

  @override
  String get notificationChannelCompleted => 'टास्क पूरा';

  @override
  String get notificationChannelAttentionDescription =>
      'Relayune मंज़ूरी और सवाल अलर्ट';

  @override
  String get notificationChannelCompletedDescription =>
      'Relayune मुख्य-टास्क पूर्णता अलर्ट';

  @override
  String get notificationRedactedLink => '[लिंक]';

  @override
  String get notificationRedactedPath => '[पथ]';

  @override
  String get notificationRedactedSecret => '[छिपाया गया]';

  @override
  String get workbenchTitle => 'कार्यस्थान';

  @override
  String get workbenchDevice => 'डिवाइस';

  @override
  String get workbenchOpenNavigation => 'नेविगेशन खोलें';

  @override
  String workbenchPendingApprovals(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count मंज़ूरियाँ लंबित',
      one: '1 मंज़ूरी लंबित',
    );
    return '$_temp0';
  }

  @override
  String get workbenchSessions => 'सत्र';

  @override
  String get workbenchOnline => 'ऑनलाइन';

  @override
  String get workbenchOffline => 'ऑफ़लाइन';

  @override
  String get workbenchDeviceOnlineRealtime => 'कंप्यूटर ऑनलाइन · रीयलटाइम सिंक';

  @override
  String get workbenchDeviceOfflineQueued =>
      'कंप्यूटर ऑफ़लाइन · केवल कैश किए गए रिकॉर्ड';

  @override
  String get workbenchDeviceOnlineReconnecting =>
      'कंप्यूटर ऑनलाइन · रीयलटाइम कनेक्शन बहाल हो रहा है';

  @override
  String get workbenchDeviceOfflineReconnecting =>
      'कंप्यूटर ऑफ़लाइन · रीयलटाइम कनेक्शन बहाल हो रहा है';

  @override
  String get workbenchDeviceOnlineWaiting =>
      'कंप्यूटर ऑनलाइन · रीयलटाइम कनेक्शन की प्रतीक्षा';

  @override
  String get workbenchDeviceOfflineWaiting =>
      'कंप्यूटर ऑफ़लाइन · रीयलटाइम कनेक्शन की प्रतीक्षा';

  @override
  String get workbenchProjectsSessions => 'प्रोजेक्ट और सत्र';

  @override
  String get workbenchNoSessionsSynced =>
      'कंप्यूटर से अभी कोई सत्र सिंक नहीं हुआ';

  @override
  String get workbenchSignedInAccount => 'साइन-इन खाता';

  @override
  String get workbenchNotSignedIn => 'साइन इन नहीं';

  @override
  String get workbenchNewSession => 'नया सत्र';

  @override
  String get workbenchDefaultSessionName => 'नया रिमोट सत्र';

  @override
  String get workbenchHistoryFailed =>
      'इतिहास लोड नहीं हुआ; मौजूदा सामग्री अधूरी हो सकती है';

  @override
  String get workbenchLoadEarlier => 'पहले के संदेश लोड करें';

  @override
  String get workbenchSendFirst => 'शुरू करने के लिए पहला निर्देश भेजें';

  @override
  String get workbenchAtBeginning => 'यह पहला संदेश है';

  @override
  String get workbenchAddAttachment => 'अटैचमेंट जोड़ें';

  @override
  String workbenchRemoveAttachment(String name) {
    return '$name हटाएँ';
  }

  @override
  String get workbenchReadOnly => 'यह सत्र केवल पढ़ने के लिए है';

  @override
  String get workbenchOfflineQueued =>
      'कंप्यूटर ऑफ़लाइन · संदेश भेजना उपलब्ध नहीं';

  @override
  String get workbenchSteerPlaceholder =>
      'रोककर आगे बढ़ने के लिए नया निर्देश भेजें…';

  @override
  String get workbenchSendPlaceholder => 'कंप्यूटर को निर्देश भेजें…';

  @override
  String get workbenchStopTask => 'टास्क रोकें';

  @override
  String get workbenchSending => 'भेजा जा रहा है';

  @override
  String get workbenchSend => 'भेजें';

  @override
  String get workbenchYou => 'आप';

  @override
  String get workbenchLocalActivity => 'स्थानीय गतिविधि';

  @override
  String get workbenchToday => 'आज';

  @override
  String get workbenchYesterday => 'कल';

  @override
  String get workbenchDayBeforeYesterday => 'परसों';

  @override
  String get workbenchSystemNotice => 'सिस्टम सूचना';

  @override
  String workbenchApprovalSource(String name) {
    return 'स्रोत: $name';
  }

  @override
  String workbenchApprovalDirectory(String path) {
    return 'निर्देशिका: $path';
  }

  @override
  String get workbenchApprovalPermission => 'माँगी गई अनुमति';

  @override
  String get workbenchSelect => 'चुनें';

  @override
  String get workbenchOtherAnswer => 'अन्य जवाब…';

  @override
  String get workbenchSkipAnswer => 'अभी नहीं';

  @override
  String get workbenchHighRiskTitle => 'उच्च-जोखिम कार्रवाई को अनुमति दें?';

  @override
  String get workbenchOperationOnComputer =>
      'यह कार्रवाई आपके कंप्यूटर पर चलेगी।';

  @override
  String get workbenchConfirmAllow => 'पुष्टि करके अनुमति दें';

  @override
  String get workbenchAnswerLabel => 'जवाब';

  @override
  String get workbenchAllowOnce => 'एक बार अनुमति';

  @override
  String get workbenchAlwaysAllowSession => 'इस सत्र में हमेशा अनुमति दें';

  @override
  String get workbenchAllowAndRemember => 'अनुमति दें और याद रखें';

  @override
  String get workbenchAlwaysRejectSession => 'इस सत्र में हमेशा अस्वीकार करें';

  @override
  String get workbenchRejectAndRemember => 'अस्वीकार करें और याद रखें';

  @override
  String get workbenchSaveDecisionTitle => 'यह निर्णय याद रखें?';

  @override
  String get workbenchSaveDecisionMessage =>
      'Relayune इस विकल्प को केवल मौजूदा सत्र की समान कार्रवाइयों पर अपने-आप लागू करेगा।';

  @override
  String get workbenchConfirm => 'पुष्टि करें';

  @override
  String get workbenchRejectAndStop => 'अस्वीकार कर टास्क रोकें';

  @override
  String get workbenchNotificationSettings => 'टास्क सूचनाएँ';

  @override
  String get workbenchConnectAnother => 'दूसरा कंप्यूटर कनेक्ट करें';

  @override
  String get workbenchConnectAnotherSubtitle =>
      'इस फ़ोन से मौजूदा सामग्री कुंजी और डिवाइस अनुमति हटाएँ';

  @override
  String get workbenchConnectAnotherTitle => 'दूसरा कंप्यूटर कनेक्ट करें?';

  @override
  String get workbenchConnectAnotherMessage =>
      'मौजूदा सामग्री कुंजी और फ़ोन अनुमति टोकन इस डिवाइस के सुरक्षित क्रेडेंशियल स्टोर से हटेंगे। सर्वर और कंप्यूटर का डेटा नहीं हटेगा।';

  @override
  String get workbenchNoSessions => 'कोई सत्र उपलब्ध नहीं';

  @override
  String get workbenchNoSessionsHelp =>
      'डेस्कटॉप ऑनलाइन रखें, या कंप्यूटर की प्रोजेक्ट डायरेक्टरी में नया सत्र बनाएँ।';

  @override
  String get workbenchHistoryLoading => 'संदेश इतिहास लोड हो रहा है';

  @override
  String get workbenchHistoryLoadingOlder => 'पुराने संदेश लोड हो रहे हैं…';

  @override
  String get workbenchHistoryLimit =>
      'सत्र खोलने के बाद इतिहास एक बार में अधिकतम 500 संदेश लोड करता है';

  @override
  String get workbenchFilePreviewRetry =>
      'फ़ाइल पूर्वावलोकन विफल हुआ। फिर कोशिश करें।';

  @override
  String get workbenchSecureFileReading =>
      'कंप्यूटर से सुरक्षित रूप से पढ़ा जा रहा है…';

  @override
  String get workbenchFileUnavailable =>
      'फ़ाइल समाप्त हो गई या कंप्यूटर से हटाई गई।';

  @override
  String get workbenchApprovalCommand => 'कमांड चलाएँ';

  @override
  String get workbenchApprovalFileChange => 'फ़ाइल बदलें';

  @override
  String get workbenchApprovalChoice => 'आपकी पसंद चाहिए';

  @override
  String get workbenchApprovalTool => 'स्थानीय टूल चलाएँ';

  @override
  String get workbenchStatePending => 'लंबित';

  @override
  String get workbenchStateDeciding => 'भेजा जा रहा है';

  @override
  String get workbenchStateApproved => 'अनुमोदित';

  @override
  String get workbenchStateRejected => 'अस्वीकृत';

  @override
  String get workbenchStateExpired => 'समाप्त';

  @override
  String get workbenchLocalRelay => 'स्थानीय Relay';

  @override
  String get workbenchEncryptionProtocol => 'एन्क्रिप्शन प्रोटोकॉल';

  @override
  String get workbenchPairingProtocol => 'पेयरिंग प्रोटोकॉल';

  @override
  String get workbenchRealtimeChannel => 'रीयलटाइम चैनल';

  @override
  String get workbenchTechnicalDetails => 'तकनीकी विवरण';

  @override
  String get workbenchRealtimeConnection => 'रीयलटाइम कनेक्शन';

  @override
  String get workbenchHeartbeatPath => 'iPhone ↔ Server · WebSocket';

  @override
  String get workbenchHeartbeatHealthy => 'हार्टबीट सामान्य';

  @override
  String get workbenchHeartbeatWaiting => 'पहली हार्टबीट की प्रतीक्षा';

  @override
  String get workbenchLastHeartbeat => 'पिछली हार्टबीट';

  @override
  String get workbenchRoundTrip => 'राउंड ट्रिप';

  @override
  String get workbenchWebSocketHeartbeat => 'WebSocket हार्टबीट';

  @override
  String get workbenchDesktopHeartbeat => 'कंप्यूटर हार्टबीट';

  @override
  String get workbenchJustNow => 'अभी';

  @override
  String workbenchSecondsAgo(int seconds) {
    return '$seconds सेकंड पहले';
  }

  @override
  String workbenchMinutesAgo(int minutes) {
    return '$minutes मिनट पहले';
  }

  @override
  String get workbenchStateVersion => 'स्थिति संस्करण';

  @override
  String get workbenchAwaitingConfirmation => 'पुष्टि की प्रतीक्षा';

  @override
  String get workbenchLastConfirmed => 'अंतिम पुष्टि';

  @override
  String get workbenchEventAck => 'इवेंट पुष्टि';

  @override
  String get workbenchOfflineQueue => 'ऑफ़लाइन कतार';

  @override
  String get workbenchSecurityBoundary => 'एंड-टू-एंड एन्क्रिप्शन सीमा';

  @override
  String get workbenchPhonePlaintextEndpoint =>
      'फ़ोन एप्लिकेशन-प्लेनटेक्स्ट एंडपॉइंट है';

  @override
  String get workbenchServerCiphertextOnly =>
      'सर्वर केवल प्रमाणित साइफ़रटेक्स्ट एन्वेलप रखता है';

  @override
  String get workbenchKeyInSecureStorage =>
      'सामग्री कुंजियाँ सिस्टम के सुरक्षित क्रेडेंशियल स्टोर में रहती हैं';

  @override
  String get workbenchCodeNeverUploaded =>
      '8-अक्षर कनेक्शन कोड कभी अपलोड नहीं होता';

  @override
  String get workbenchNotConfirmed => 'अभी पुष्टि नहीं';

  @override
  String get workbenchRealtimeConnected => 'WebSocket जुड़ा है';

  @override
  String get workbenchRealtimeConnecting => 'कनेक्ट हो रहा है';

  @override
  String get workbenchRealtimeReconnecting => 'फिर जुड़ रहा है';

  @override
  String get workbenchRealtimeIdle => 'कनेक्शन की प्रतीक्षा';

  @override
  String workbenchNotificationStatus(String status) {
    return '$status · ऐप का बैकग्राउंड कनेक्शन जीवित रहने तक सूचनाएँ काम करती हैं; सिस्टम द्वारा ऐप बंद करने के बाद डिलीवरी की गारंटी नहीं है';
  }

  @override
  String get workbenchNotificationAllowed => 'अनुमति है';

  @override
  String get workbenchNotificationDisabled => 'बंद';

  @override
  String get workbenchNotificationUnknown => 'अज्ञात';

  @override
  String get workbenchClose => 'बंद करें';

  @override
  String get workbenchProjectConfiguration => 'प्रोजेक्ट सेटिंग';

  @override
  String get workbenchProjectConfigurationTitle => 'प्रोजेक्ट सेटिंग';

  @override
  String get workbenchProjectName => 'प्रोजेक्ट नाम';

  @override
  String get workbenchProjectNameHelp =>
      'यह केवल इस ऐप में दिखने वाला नाम बदलता है; कंप्यूटर का फ़ोल्डर नाम नहीं।';

  @override
  String get workbenchFullPath => 'पूरा पथ';

  @override
  String get workbenchProjectPathUnavailable =>
      'कंप्यूटर ने प्रोजेक्ट पथ नहीं दिया';

  @override
  String workbenchSessionCount(int count) {
    return '$count सत्र';
  }

  @override
  String workbenchMoreSessions(int count) {
    return 'और सत्र दिखाएँ ($count)';
  }

  @override
  String get workbenchAgentRunning => 'Agent चल रहा है';

  @override
  String get workbenchAgentNotRunning => 'Agent नहीं चल रहा';

  @override
  String get workbenchRunning => 'चल रहा है';

  @override
  String get workbenchKimiSettings => 'Kimi सेटिंग';

  @override
  String get workbenchEnableYoloTitle => 'YOLO मोड चालू करें?';

  @override
  String get workbenchEnableAutoTitle => 'Auto मोड चालू करें?';

  @override
  String get workbenchYoloWarning =>
      'Kimi अधिक स्थानीय टूल कॉल अपने-आप मंज़ूर करेगा। केवल भरोसेमंद टास्क और प्रोजेक्ट में चालू करें।';

  @override
  String get workbenchAutoWarning =>
      'Kimi सामान्य टूल कॉल अपने-आप मंज़ूर करेगा, पर फिर भी सवाल पूछ सकता है।';

  @override
  String get workbenchConfirmEnable => 'पुष्टि करके चालू करें';

  @override
  String get workbenchUploadTooManyImages =>
      'हर संदेश में अधिकतम 4 चित्र जोड़ सकते हैं।';

  @override
  String workbenchUploadUnsupportedImages(String names) {
    return '$names समर्थित नहीं हैं। PNG, JPEG, WebP, GIF या AVIF चुनें।';
  }

  @override
  String get workbenchUploadTooLarge =>
      'एक संदेश के अटैचमेंट कुल 20 MiB से अधिक नहीं हो सकते।';

  @override
  String workbenchPreviewGenerateFailed(String name) {
    return '$name का पूर्वावलोकन पढ़ा या बनाया नहीं जा सका। फिर कोशिश करें।';
  }

  @override
  String get workbenchKimiViewAgents => 'सब-Agents देखें';

  @override
  String get workbenchKimiViewAgentsDescription =>
      'कोई नया मॉडल टास्क शुरू किए बिना कंपोज़र के ऊपर Agent कार्य विंडो खोलें।';

  @override
  String get workbenchKimiOpenNow => 'अभी खोलें';

  @override
  String get workbenchKimiSessionStatus => 'सत्र स्थिति';

  @override
  String get workbenchKimiSessionStatusDescription =>
      'टास्क, मंज़ूरी, संदर्भ और स्थानीय सिंक स्थिति देखें।';

  @override
  String get workbenchKimiLocalStatus => 'स्थानीय स्थिति';

  @override
  String get workbenchKimiModel => 'मॉडल';

  @override
  String get workbenchKimiModelDescription => 'इस Kimi सत्र का मॉडल बदलें।';

  @override
  String get workbenchKimiSessionSettings => 'सत्र सेटिंग';

  @override
  String get workbenchKimiPermissionMode => 'अनुमति मोड';

  @override
  String get workbenchKimiPermissionModeDescription =>
      'स्थानीय टूल मंज़ूरी नीति देखें या बदलें।';

  @override
  String get workbenchKimiSecuritySettings => 'सुरक्षा सेटिंग';

  @override
  String get workbenchKimiPlanMode => 'Plan मोड';

  @override
  String get workbenchKimiPlanModeDescription =>
      'Kimi से टास्क करने से पहले योजना बनवाएँ।';

  @override
  String get workbenchKimiYoloMode => 'YOLO मोड';

  @override
  String get workbenchKimiYoloModeDescription =>
      'अधिक टूल कॉल अपने-आप मंज़ूर करें; चालू करने से पहले पुष्टि आवश्यक है।';

  @override
  String get workbenchKimiConfirmationRequired => 'पुष्टि आवश्यक';

  @override
  String get workbenchKimiSettingsDescription =>
      'मॉडल, Thinking और अनुमति सेटिंग खोलें।';

  @override
  String workbenchKimiInputRequired(String hint) {
    return 'इनपुट आवश्यक: $hint';
  }

  @override
  String get workbenchKimiNativeCommandDescription =>
      'मूल Kimi ACP कमांड जो वास्तविक कमांड टास्क के रूप में चलता है।';

  @override
  String get workbenchKimiNativeCommand => 'मूल कमांड';

  @override
  String get workbenchKimiContextSyncing => 'संदर्भ सिंक की प्रतीक्षा में';

  @override
  String get workbenchKimiWaitingForSync => 'सिंक की प्रतीक्षा';

  @override
  String workbenchKimiContextUsage(int percent, String used, String size) {
    return 'संदर्भ $percent% · $used/$size';
  }

  @override
  String workbenchKimiContextUsed(String used) {
    return 'संदर्भ $used';
  }

  @override
  String get workbenchKimiContext => 'संदर्भ';

  @override
  String get workbenchKimiModelSyncing => 'मॉडल सिंक की प्रतीक्षा में';

  @override
  String get workbenchKimiQuickCommands => 'त्वरित कमांड';

  @override
  String get workbenchKimiNoMatchingCommands => 'कोई मिलता कमांड नहीं';

  @override
  String get workbenchKimiTask => 'टास्क';

  @override
  String get workbenchKimiIdle => 'निष्क्रिय';

  @override
  String get workbenchKimiSubagents => 'सब-Agents';

  @override
  String workbenchKimiActiveCount(int count) {
    return '$count सक्रिय';
  }

  @override
  String get workbenchKimiApprovals => 'मंज़ूरियाँ';

  @override
  String workbenchKimiPendingCount(int count) {
    return '$count लंबित';
  }

  @override
  String get workbenchKimiSettingsOffline =>
      'Relay ऑफ़लाइन होने पर Kimi सेटिंग नहीं बदली जा सकती।';

  @override
  String get workbenchKimiSettingsRunning =>
      'सेटिंग बदलने से पहले मुख्य Kimi टास्क रोकें।';

  @override
  String get workbenchKimiNoOptions =>
      'कंप्यूटर ने अभी कोई कॉन्फ़िगर योग्य विकल्प सिंक नहीं किया।';

  @override
  String get workbenchKimiEncryptedSettings =>
      'सेटिंग आपके कंप्यूटर के Kimi Code को एंड-टू-एंड एन्क्रिप्ट होकर भेजी जाती हैं। Server इन्हें नहीं पढ़ सकता।';

  @override
  String get workbenchKimiManualApproval => 'मैन्युअल मंज़ूरी';

  @override
  String get workbenchSessionSettings => 'सत्र सेटिंग';

  @override
  String get workbenchSessionSettingsOffline =>
      'Relay ऑफ़लाइन होने पर सत्र सेटिंग नहीं बदली जा सकती।';

  @override
  String get workbenchSessionSettingsRunning =>
      'सेटिंग बदलने से पहले मौजूदा टास्क रोकें।';

  @override
  String get workbenchNoConfigOptions =>
      'कंप्यूटर ने अभी कोई कॉन्फ़िगर योग्य विकल्प सिंक नहीं किया।';

  @override
  String workbenchEncryptedSessionSettings(String provider) {
    return 'सेटिंग आपके कंप्यूटर के $provider को एंड-टू-एंड एन्क्रिप्ट होकर भेजी जाती हैं। Server इन्हें नहीं पढ़ सकता।';
  }

  @override
  String get workbenchUnrestrictedPermissionsTitle => 'अनुमति मोड बदलें?';

  @override
  String get workbenchUnrestrictedPermissionsWarning =>
      'यह बदलता है कि स्थानीय टूल अनुमत, अस्वीकृत या मंज़ूरी-आधारित हैं। आगे बढ़ने से पहले चुना हुआ मोड जाँचें।';

  @override
  String get workbenchCoworkCreateOnDesktop =>
      'पहले Claude Desktop में Cowork टास्क बनाएँ; मौजूदा टास्क यहाँ नियंत्रित किए जा सकते हैं।';

  @override
  String get workbenchProcessing => 'प्रक्रिया जारी';

  @override
  String get workbenchProcess => 'प्रक्रिया';

  @override
  String workbenchDurationMinutesSeconds(int minutes, int seconds) {
    return '$minutes मि $seconds से';
  }

  @override
  String workbenchDurationSeconds(int seconds) {
    return '$seconds से';
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
  String get workbenchImageUrlUnavailable => 'चित्र का पता उपलब्ध नहीं है।';

  @override
  String workbenchFilePreviewAvailable(String kind) {
    return 'पूर्वावलोकन योग्य · $kind · अधिकतम 1 MB';
  }

  @override
  String get workbenchFilePreviewUnsupported =>
      'इस फ़ाइल प्रारूप का पूर्वावलोकन समर्थित नहीं है';

  @override
  String workbenchImageReadFailed(String name) {
    return '$name\nचित्र पढ़ा नहीं जा सका';
  }

  @override
  String workbenchImageThumbnailLabel(String name) {
    return '$name थंबनेल; पूर्वावलोकन खोलने के लिए टैप करें';
  }

  @override
  String get workbenchViewOriginal => 'मूल चित्र देखें';

  @override
  String get workbenchLoadingOriginal =>
      'मूल चित्र सुरक्षित रूप से लोड हो रहा है…';

  @override
  String get workbenchOriginalReadFailed =>
      'मूल चित्र पढ़ा नहीं जा सका। फिर कोशिश करें।';

  @override
  String workbenchActivityFailed(String label) {
    return '$label विफल';
  }

  @override
  String workbenchActivityCompleted(String label) {
    return '$label पूरा';
  }

  @override
  String workbenchActivityRunning(String label) {
    return '$label जारी';
  }

  @override
  String get workbenchViewOutput => 'आउटपुट देखने के लिए टैप करें';

  @override
  String get workbenchViewThumbnail => 'थंबनेल देखने के लिए टैप करें';

  @override
  String get workbenchSemanticSeparator => ', ';

  @override
  String workbenchCommandsRunning(int count) {
    return '$count कमांड चल रहे हैं';
  }

  @override
  String workbenchCommandsFailed(int count) {
    return '$count कमांड में कुछ विफल हुए';
  }

  @override
  String workbenchCommandsCompleted(int count) {
    return '$count कमांड चलाए';
  }

  @override
  String workbenchFilesReading(int count) {
    return '$count फ़ाइलें पढ़ी जा रही हैं';
  }

  @override
  String workbenchFilesReadFailed(int count) {
    return '$count फ़ाइलों में कुछ पढ़ी नहीं जा सकीं';
  }

  @override
  String workbenchFilesRead(int count) {
    return '$count फ़ाइलें पढ़ीं';
  }

  @override
  String workbenchFilesChanging(int count) {
    return '$count फ़ाइलें बदली जा रही हैं';
  }

  @override
  String workbenchFilesChangeFailed(int count) {
    return '$count फ़ाइलों के कुछ बदलाव विफल हुए';
  }

  @override
  String workbenchFilesChanged(int count) {
    return '$count फ़ाइलें बदलीं';
  }

  @override
  String workbenchOperationsRunning(int count) {
    return '$count फ़ाइल और कमांड क्रियाएँ जारी हैं';
  }

  @override
  String workbenchOperationsFailed(int count) {
    return '$count फ़ाइल और कमांड क्रियाओं में कुछ विफल हुईं';
  }

  @override
  String workbenchOperationsCompleted(int count) {
    return '$count फ़ाइल और कमांड क्रियाएँ पूरी हुईं';
  }

  @override
  String get workbenchToolCommand => 'कमांड चलाएँ';

  @override
  String workbenchToolReadFilesSubject(int count, String subject) {
    return '$count फ़ाइलें पढ़ें: $subject';
  }

  @override
  String workbenchToolReadFiles(int count) {
    return '$count फ़ाइलें पढ़ें';
  }

  @override
  String workbenchToolReadFileSubject(String subject) {
    return 'फ़ाइल पढ़ें: $subject';
  }

  @override
  String get workbenchToolReadFile => 'फ़ाइल पढ़ें';

  @override
  String workbenchToolChangeFilesSubject(int count, String subject) {
    return '$count फ़ाइलें बदलें: $subject';
  }

  @override
  String workbenchToolChangeFiles(int count) {
    return '$count फ़ाइलें बदलें';
  }

  @override
  String workbenchToolChangeFileSubject(String subject) {
    return 'फ़ाइल बदलें: $subject';
  }

  @override
  String get workbenchToolChangeFile => 'फ़ाइल बदलें';

  @override
  String workbenchToolCallNamed(String name) {
    return 'टूल कॉल करें: $name';
  }

  @override
  String get workbenchToolCall => 'टूल कॉल करें';

  @override
  String workbenchToolWebSearchSubject(String subject) {
    return 'वेब खोजें: $subject';
  }

  @override
  String get workbenchToolWebSearch => 'वेब खोजें';

  @override
  String workbenchToolImageViewSubject(String subject) {
    return 'चित्र देखें: $subject';
  }

  @override
  String get workbenchToolImageView => 'चित्र देखें';

  @override
  String get workbenchToolImageGeneration => 'चित्र बनाएँ';

  @override
  String get workbenchToolContextCompaction => 'संदर्भ अपने-आप संक्षिप्त करें';

  @override
  String get workbenchToolWait => 'टास्क की प्रतीक्षा';

  @override
  String get workbenchLocalOperation => 'स्थानीय क्रिया';

  @override
  String get workbenchDeliverySent => 'भेजा गया';

  @override
  String get workbenchDeliverySending => 'भेजा जा रहा है';

  @override
  String get workbenchDeliveryFailed => 'भेजना विफल';

  @override
  String workbenchAssistantRunningElapsed(String agent, String duration) {
    return '$agent चल रहा है; बीता समय $duration';
  }

  @override
  String workbenchAssistantRunning(String agent) {
    return '$agent चल रहा है';
  }

  @override
  String workbenchAssistantElapsed(String duration) {
    return '· बीता समय $duration';
  }

  @override
  String get workbenchCloseFilePreview => 'फ़ाइल पूर्वावलोकन बंद करें';

  @override
  String workbenchFileReadCompleted(String name) {
    return 'फ़ाइल पढ़ना पूरा: $name';
  }

  @override
  String workbenchFileReading(String name) {
    return 'फ़ाइल पढ़ी जा रही है: $name';
  }

  @override
  String workbenchFileReadFailed(String message) {
    return 'फ़ाइल पढ़ना विफल: $message';
  }

  @override
  String get workbenchFilePreviewFailed =>
      'फ़ाइल पूर्वावलोकन विफल। फिर कोशिश करें।';

  @override
  String get workbenchFileKindTableText => 'सारणी पाठ';

  @override
  String get workbenchFileKindLog => 'लॉग';

  @override
  String get workbenchFileKindPlainText => 'सादा पाठ';

  @override
  String get workbenchFileKindCodeOrConfig => 'कोड या कॉन्फ़िगरेशन';

  @override
  String workbenchAgentsWorking(int count) {
    return '$count सब-Agent समानांतर काम कर रहे हैं';
  }

  @override
  String get workbenchAgentWindow => 'Agent कार्य विंडो';

  @override
  String get workbenchAgentWindowDescription =>
      'निजी तर्क दिखाए बिना टास्क स्थिति और टूल गतिविधि सिंक करता है';

  @override
  String workbenchMoreAgents(int count) {
    return '$count और Agents · देखने के लिए नीचे स्क्रॉल करें';
  }

  @override
  String workbenchCurrentActivity(String activity) {
    return 'वर्तमान · $activity';
  }

  @override
  String get workbenchAllAgents => 'सभी Agents';

  @override
  String get workbenchActivityTimeline => 'गतिविधि समयरेखा';

  @override
  String workbenchActivityCount(int count) {
    return '$count प्रविष्टियाँ';
  }

  @override
  String get workbenchAgentSyncing => 'इस कंप्यूटर से सिंक हो रहा है…';

  @override
  String get workbenchNoPublicActivity =>
      'अभी कोई सार्वजनिक गतिविधि नहीं। केवल टास्क स्थिति और टूल गतिविधि सिंक होती है; मॉडल का निजी तर्क नहीं।';

  @override
  String get workbenchLatestResult => 'नवीनतम परिणाम';

  @override
  String get workbenchWaitingForTask => 'टास्क की प्रतीक्षा';

  @override
  String get controllerRestoreFailed =>
      'सुरक्षित कनेक्शन बहाल नहीं हुआ। फिर साइन इन या पेयर करें।';

  @override
  String get controllerAuthorizationRevoked =>
      'इस फ़ोन की अनुमति रद्द हो गई। फिर कनेक्ट करें।';

  @override
  String get controllerDeviceNotConnected =>
      'यह खाता इस कंप्यूटर से जुड़ा नहीं है। कंप्यूटर पर कनेक्शन फिर शुरू करें।';

  @override
  String get controllerProjectNameRequired => 'प्रोजेक्ट नाम आवश्यक है।';

  @override
  String controllerProjectNameTooLong(int maximum) {
    return 'प्रोजेक्ट नाम $maximum अक्षरों से अधिक नहीं हो सकता।';
  }

  @override
  String get controllerProjectNameSaveFailed =>
      'प्रोजेक्ट नाम स्थानीय रूप से सेव नहीं हुआ। फिर कोशिश करें।';

  @override
  String get controllerProjectNameUpdated => 'प्रोजेक्ट नाम अपडेट हुआ।';

  @override
  String get controllerNewPairingLinkReceived =>
      'नया कनेक्शन लिंक मिला। फिर कनेक्ट करने के लिए मौजूदा डिवाइस से साइन आउट करें।';

  @override
  String get controllerPairingLinkRequired =>
      'डेस्कटॉप ऐप में दिखाया Relayune कनेक्शन लिंक डालें।';

  @override
  String get controllerPairingDiscoveryFailed =>
      'कनेक्शन की प्रतीक्षा कर रहे कंप्यूटर नहीं मिले। बाद में कोशिश करें।';

  @override
  String get controllerVerificationResent => 'सत्यापन ईमेल फिर भेजा गया।';

  @override
  String get controllerSetPasswordFirst =>
      'पहले ईमेल लिंक से पासवर्ड बनाएँ, फिर यहाँ लौटें।';

  @override
  String get controllerNoPendingComputer =>
      'कोई कंप्यूटर कनेक्शन की प्रतीक्षा में नहीं है। पहले कंप्यूटर पर “नया क्लाइंट कनेक्ट करें” चुनें।';

  @override
  String get controllerSelectComputer => 'कनेक्ट करने वाला कंप्यूटर चुनें।';

  @override
  String get controllerPairingFailed =>
      'सुरक्षित कनेक्शन विफल। कनेक्शन कोड जाँचकर फिर कोशिश करें।';

  @override
  String get controllerHistoryReadFailed => 'इतिहास पढ़ा नहीं जा सका।';

  @override
  String get controllerAgentRefreshFailed =>
      'इस सब-Agent की गतिविधि अभी रीफ़्रेश नहीं हो सकी।';

  @override
  String get controllerAttachmentTooLarge =>
      '1 MB से बड़ी फ़ाइलों का अभी पूर्वावलोकन नहीं हो सकता।';

  @override
  String get controllerAttachmentUnsupported =>
      'इस फ़ाइल प्रारूप का अभी पूर्वावलोकन नहीं हो सकता।';

  @override
  String get controllerAttachmentGone =>
      'फ़ाइल की अवधि समाप्त हो गई या कंप्यूटर से हटा दी गई।';

  @override
  String get controllerAttachmentReadFailed => 'अटैचमेंट पढ़ा नहीं जा सका।';

  @override
  String controllerUploadTooMany(int maximum) {
    return 'हर संदेश में अधिकतम $maximum चित्र अपलोड कर सकते हैं।';
  }

  @override
  String get controllerUploadTotalTooLarge =>
      'एक संदेश के अटैचमेंट कुल 20 MiB से अधिक नहीं हो सकते।';

  @override
  String get controllerUploadUnsupported =>
      'PNG, JPEG, WebP, GIF या AVIF चित्र चुनें।';

  @override
  String get controllerSteeringUnsupported =>
      'यह टास्क और निर्देश स्वीकार नहीं कर सकता। पहले इसे रोकें।';

  @override
  String get controllerPreparingAgent =>
      'कंप्यूटर पर प्राप्त · एजेंट तैयार हो रहा है';

  @override
  String get controllerWaitingForAgent =>
      'स्थानीय Agent के प्राप्त करने की प्रतीक्षा';

  @override
  String get controllerWaitingForComputer =>
      'कंप्यूटर के ऑनलाइन होने की प्रतीक्षा';

  @override
  String get controllerStopSent => 'रोकने का अनुरोध भेजा गया।';

  @override
  String get controllerApprovalExpired => 'यह मंज़ूरी समाप्त हो चुकी है।';

  @override
  String get controllerApprovalOffline =>
      'कंप्यूटर ऑफ़लाइन होने पर मंज़ूरी नहीं दी जा सकती।';

  @override
  String get controllerApprovalAllowedSent =>
      'अनुमति भेजी गई; कंप्यूटर की पुष्टि की प्रतीक्षा।';

  @override
  String get controllerApprovalRejectedSent =>
      'अस्वीकृति भेजी गई; कंप्यूटर की पुष्टि की प्रतीक्षा।';

  @override
  String controllerDelegatedTasks(int count) {
    return '$count समानांतर टास्क सौंपे गए।';
  }

  @override
  String get controllerSelectProject =>
      'पहले साइडबार से सिंक किया प्रोजेक्ट चुनें।';

  @override
  String get controllerCreateSessionOffline =>
      'कंप्यूटर ऑफ़लाइन है। अभी सत्र नहीं बन सकता।';

  @override
  String controllerSessionNameLength(int maximum) {
    return 'सत्र नाम 1–$maximum अक्षरों का होना चाहिए।';
  }

  @override
  String get controllerSessionCreationBusy =>
      'पिछला सत्र अभी बन रहा है। प्रतीक्षा करें।';

  @override
  String controllerSessionCreating(String name) {
    return '“$name” बनाया जा रहा है…';
  }

  @override
  String get controllerSessionCreateFailed =>
      'सत्र नहीं बन सका। बाद में कोशिश करें।';

  @override
  String get controllerDesktopSessionCreateFailed =>
      'डेस्कटॉप ऐप सत्र नहीं बना सका।';

  @override
  String get controllerSessionCreateTimeout =>
      'डेस्कटॉप ऐप से सत्र बनाने की प्रतीक्षा समाप्त हुई। बाद में जाँचें; दूसरा सत्र न बनाएँ।';

  @override
  String controllerSessionCreated(String name) {
    return '“$name” बनाया गया।';
  }

  @override
  String get controllerCoworkCreateOnDesktop =>
      'पहले Claude Desktop में Cowork टास्क बनाएँ, फिर उसे यहाँ नियंत्रित करें।';

  @override
  String get controllerDesktopConfigFailed =>
      'डेस्कटॉप ऐप सत्र सेटिंग लागू नहीं कर सका।';

  @override
  String get controllerConfigApplied => 'सत्र सेटिंग लागू हुई।';

  @override
  String get controllerConfigUpdateFailed =>
      'सत्र सेटिंग अपडेट नहीं हुई। बाद में कोशिश करें।';

  @override
  String get controllerConfigTimeout =>
      'डेस्कटॉप ऐप से सेटिंग लागू होने की प्रतीक्षा समाप्त हुई। पुष्टि के लिए रीफ़्रेश करें।';

  @override
  String get controllerInvalidEncryptedEvent =>
      'एन्क्रिप्टेड इवेंट सत्यापित नहीं हुआ। सिंक कर्सर आगे बढ़ना रोक दिया गया।';

  @override
  String get controllerApprovalNeeded => 'आपकी मंज़ूरी की प्रतीक्षा';

  @override
  String get controllerContinuing => 'प्रक्रिया जारी';

  @override
  String get controllerApprovalProcessFailed =>
      'कंप्यूटर यह मंज़ूरी संभाल नहीं सका। फिर कोशिश करें।';

  @override
  String controllerAgentProcessing(String name) {
    return '$name प्रक्रिया कर रहा है';
  }

  @override
  String get controllerSummarizing => 'परिणाम संक्षिप्त किए जा रहे हैं';

  @override
  String get controllerThinking => 'सोच रहा है';

  @override
  String get controllerLocalTaskFailed => 'स्थानीय टास्क विफल।';

  @override
  String get controllerInterruptFailed => 'मौजूदा टास्क रोका नहीं जा सका।';

  @override
  String get controllerReplying => 'उत्तर दिया जा रहा है';

  @override
  String get controllerFinishing => 'पूरा किया जा रहा है';

  @override
  String get controllerOrganizingFileChanges =>
      'फ़ाइल बदलाव व्यवस्थित किए जा रहे हैं';

  @override
  String controllerFilesModified(int count) {
    return '$count फ़ाइलें बदली गईं।';
  }

  @override
  String get controllerUpdatingPlan => 'योजना अपडेट हो रही है';

  @override
  String get controllerMessageQueued =>
      'संदेश कतार में है। बाद में अपने-आप भेजा जाएगा।';

  @override
  String controllerSessionPersisted(String agent) {
    return 'सत्र $agent में सेव हुआ।';
  }

  @override
  String controllerLocalTool(String label) {
    return 'स्थानीय टूल: $label';
  }

  @override
  String get controllerProcessingLocalResult =>
      'स्थानीय परिणाम प्रोसेस हो रहा है';

  @override
  String get controllerEncryptedResponseTimeout =>
      'कंप्यूटर से एन्क्रिप्टेड उत्तर की प्रतीक्षा समाप्त हुई।';

  @override
  String get controllerPairingUsedOrExpired =>
      'यह कनेक्शन उपयोग हो चुका है या समाप्त हो गया।';

  @override
  String get controllerPairingConfirmationTimeout =>
      'डेस्कटॉप पुष्टि की प्रतीक्षा समाप्त हुई। कनेक्शन फिर शुरू करें।';

  @override
  String get controllerPairingConfirmationFailed =>
      'कंप्यूटर ने एन्क्रिप्टेड कनेक्शन की पुष्टि नहीं की। फिर कनेक्ट करें।';

  @override
  String get controllerDesktopOffline =>
      'डेस्कटॉप ऐप अभी ऑनलाइन नहीं है। Relayune खुला रखकर फिर कोशिश करें।';

  @override
  String get workbenchDefault => 'डिफ़ॉल्ट';

  @override
  String workbenchAgentToolCount(int count) {
    return '$count टूल';
  }

  @override
  String workbenchAgentTokenCount(String count) {
    return '$count tok';
  }

  @override
  String get apiErrorNetworkUnavailable =>
      'Relayune से कनेक्ट नहीं हो सका। नेटवर्क जाँचकर फिर कोशिश करें।';

  @override
  String get apiErrorTimeout => 'अनुरोध का समय समाप्त हुआ। फिर कोशिश करें।';

  @override
  String get apiErrorInvalidResponse =>
      'Relayune को सर्वर से अमान्य उत्तर मिला। फिर कोशिश करें।';

  @override
  String get apiErrorInvalidCredentials => 'ईमेल या पासवर्ड गलत है।';

  @override
  String get apiErrorAuthentication =>
      'आपका साइन-इन समाप्त हो गया है। फिर साइन इन करें।';

  @override
  String get apiErrorService =>
      'Relayune अभी उपलब्ध नहीं है। बाद में कोशिश करें।';

  @override
  String get apiErrorGeneric => 'कुछ गलत हुआ। फिर कोशिश करें।';

  @override
  String get controllerFileAccessDenied =>
      'कंप्यूटर पर Relayune कुछ सत्र फ़ाइलें नहीं पढ़ सकता। Mac पर System Settings → Privacy & Security → Files and Folders में अनुमति देकर फिर कोशिश करें। अन्य कंप्यूटरों पर फ़ाइल अनुमतियाँ जाँचें।';

  @override
  String get workbenchImageWaiting => 'लोड होने की प्रतीक्षा';

  @override
  String get workbenchImageLoading => 'लोड हो रहा है';

  @override
  String get feedbackTitle => 'प्रतिक्रिया';

  @override
  String get feedbackIntro => 'हम क्या बेहतर कर सकते हैं?';

  @override
  String get feedbackSubtitle =>
      'अपना सुझाव दें या किसी समस्या के बारे में बताएँ।';

  @override
  String get feedbackSuggestion => 'सुझाव';

  @override
  String get feedbackBug => 'बग रिपोर्ट';

  @override
  String get feedbackDescription => 'विवरण';

  @override
  String get feedbackSuggestionHint =>
      'आप क्या सुधारना चाहेंगे और उससे आपको कैसे मदद मिलेगी?';

  @override
  String get feedbackBugHint =>
      'आपने क्या किया, क्या उम्मीद थी और वास्तव में क्या हुआ?';

  @override
  String get feedbackInfo => 'प्रतिक्रिया के साथ जुड़ी जानकारी';

  @override
  String get feedbackPrivacy =>
      'डिवाइस विवरण शामिल हैं। चैट और लॉग अपने आप अपलोड नहीं होते।';

  @override
  String get feedbackVersion => 'ऐप संस्करण';

  @override
  String get feedbackModel => 'डिवाइस मॉडल';

  @override
  String get feedbackSystem => 'ऑपरेटिंग सिस्टम';

  @override
  String get feedbackUnknown => 'उपलब्ध नहीं';

  @override
  String get feedbackLoading => 'डिवाइस की जानकारी पढ़ी जा रही है…';

  @override
  String get feedbackSend => 'प्रतिक्रिया भेजें';

  @override
  String get feedbackFailed =>
      'भेजा नहीं जा सका। आपका विवरण यहीं है। कनेक्शन जाँचें और फिर कोशिश करें।';

  @override
  String get feedbackEmpty => 'पहले अपनी प्रतिक्रिया लिखें।';

  @override
  String get feedbackSending => 'भेजा जा रहा है…';

  @override
  String get feedbackSubmitNote =>
      'जाँच और सुधार के लिए आपका विवरण और यह जानकारी सहेजी जाएगी।';

  @override
  String get feedbackSuccess => 'प्रतिक्रिया मिल गई। आपकी मदद के लिए धन्यवाद।';

  @override
  String get feedbackReference => 'प्रतिक्रिया संख्या';

  @override
  String get feedbackDone => 'हो गया';

  @override
  String get workbenchStoppingTask => 'रोका जा रहा है…';

  @override
  String get workbenchStopUnconfirmed =>
      'रुकने की पुष्टि अभी नहीं हुई है। फिर से कोशिश करें।';

  @override
  String get workbenchPreparingImages => 'चित्र तैयार किए जा रहे हैं…';

  @override
  String get workbenchImagePickFailed =>
      'फ़ोटो नहीं खोली जा सकीं। फिर से कोशिश करें।';

  @override
  String get feedbackImages => 'तस्वीरें';

  @override
  String get feedbackOptional => 'वैकल्पिक';

  @override
  String get feedbackImageLimit => 'अधिकतम 3 तस्वीरें जोड़ सकते हैं।';

  @override
  String get feedbackImageFailed =>
      'तस्वीर नहीं जुड़ी। दूसरी तस्वीर चुनें या फिर प्रयास करें।';

  @override
  String get feedbackImagePreview => 'तस्वीर का पूर्वावलोकन';

  @override
  String get feedbackRemoveImage => 'तस्वीर हटाएँ';

  @override
  String get feedbackPreparingImages => 'तस्वीरें तैयार हो रही हैं…';

  @override
  String get feedbackAddImage => 'तस्वीरें जोड़ें';

  @override
  String get feedbackImagesHint =>
      'समस्या समझने में मदद के लिए स्क्रीनशॉट जोड़ें।';

  @override
  String get feedbackContact => 'संपर्क विवरण';

  @override
  String get feedbackEmail => 'ईमेल';

  @override
  String get feedbackEmailHint =>
      'खाते का ईमेल; बदल सकते हैं या खाली छोड़ सकते हैं';

  @override
  String get feedbackWechat => 'WeChat ID';

  @override
  String get feedbackWechatHint => 'अपनी WeChat ID दर्ज करें';

  @override
  String get feedbackContactHint =>
      'केवल इस प्रतिक्रिया का जवाब देने के लिए। दोनों वैकल्पिक हैं।';

  @override
  String get feedbackEmailInvalid => 'सही ईमेल दर्ज करें या खाली छोड़ दें।';

  @override
  String get deviceAgents => 'एजेंट';

  @override
  String get deviceAgentReady => 'कनेक्टेड';

  @override
  String get deviceAgentRunning => 'चल रहा है';

  @override
  String get deviceAgentNotInstalled => 'इंस्टॉल नहीं है';

  @override
  String get deviceAgentUnavailable => 'उपलब्ध नहीं';

  @override
  String get deviceAgentNotEnabled => 'सक्षम नहीं';

  @override
  String get deviceAgentUnknown => 'जानकारी नहीं मिली';

  @override
  String get deviceAgentOffline =>
      'कंप्यूटर ऑफ़लाइन · पिछली रिपोर्ट की गई स्थिति';

  @override
  String get openingTitle => 'दूर रहकर भी, जुड़े रहें।';

  @override
  String get openingSubtitle =>
      'कहीं से भी अपने कंप्यूटर का AI काम आगे बढ़ाएँ।';

  @override
  String get openingSkip => 'ऐनिमेशन छोड़ें';

  @override
  String get deviceQuota => 'सदस्यता सीमा';

  @override
  String get quotaFiveHour => '5 घंटे';

  @override
  String get quotaSevenDay => '7 दिन';

  @override
  String quotaUsed(String percent) {
    return '$percent% उपयोग हुआ';
  }

  @override
  String quotaResets(String time) {
    return '$time पर रीसेट';
  }

  @override
  String quotaUpdated(String time) {
    return '$time पर अपडेट';
  }

  @override
  String get quotaPending => 'अभी जानकारी नहीं';

  @override
  String get quotaExpired => 'नई सीमा की प्रतीक्षा';

  @override
  String get quotaLimitReached => 'सीमा पूरी हुई';

  @override
  String get quotaSnapshot => 'पिछली जानकारी';

  @override
  String get quotaClaudeHint =>
      'Claude सत्र के दौरान सीमा बताता है। अनुपलब्ध डेटा का अनुमान नहीं लगाया जाता।';

  @override
  String get settingsHapticsTitle => 'स्पर्श प्रतिक्रिया';

  @override
  String get settingsHapticsSubtitle =>
      'कनेक्शन या निर्णय की पुष्टि पर हल्का कंपन।';

  @override
  String get workbenchBackToLatest => 'नवीनतम पर जाएँ';

  @override
  String get settingsFontSize => 'फ़ॉन्ट का आकार';

  @override
  String get settingsFontSizeSmall => 'छोटा';

  @override
  String get settingsFontSizeMedium => 'मध्यम';

  @override
  String get settingsFontSizeLarge => 'बड़ा';

  @override
  String get settingsFontSizeSaveFailed =>
      'फ़ॉन्ट का आकार बदल गया, लेकिन सहेजा नहीं जा सका। फिर से कोशिश करें।';

  @override
  String get workbenchAgentOrderHint =>
      'क्रम बदलने के लिए दबाकर रखें, फिर खींचें';

  @override
  String get workbenchAgentOrderSaveFailed =>
      'क्रम बदल गया है, लेकिन सहेजा नहीं जा सका। कृपया फिर से कोशिश करें।';

  @override
  String get settingsBuildInfo => 'संस्करण जानकारी';

  @override
  String get buildTime => 'बिल्ड समय';

  @override
  String get buildSourceCommit => 'स्रोत कमिट';

  @override
  String get buildUnrecorded => 'दर्ज नहीं';

  @override
  String get buildUncommitted => 'कमिट न किए गए बदलाव शामिल हैं';

  @override
  String get agentTasksTitle => 'उपकार्य';

  @override
  String agentTasksCount(int count) {
    return '$count उपकार्य';
  }

  @override
  String agentTasksViewAll(int count) {
    return 'सभी $count उपकार्य देखें';
  }

  @override
  String agentTasksRunning(int count) {
    return '$count चल रहे हैं';
  }

  @override
  String agentTasksFinished(int count) {
    return '$count समाप्त';
  }

  @override
  String get agentTasksAttention => 'आपके ध्यान की आवश्यकता है';

  @override
  String get agentTasksInProgress => 'प्रगति में';

  @override
  String get agentTasksEnded => 'समाप्त';

  @override
  String get agentTaskPreparing => 'तैयारी जारी';

  @override
  String get agentTaskUnknown => 'स्थिति सिंक होने की प्रतीक्षा में';

  @override
  String get agentTaskCompleted => 'पूर्ण';

  @override
  String get agentTaskFailed => 'विफल';

  @override
  String get agentTaskStopped => 'रोका गया';

  @override
  String get agentTaskAnswer => 'आपके उत्तर की प्रतीक्षा में';

  @override
  String get agentTaskApprove => 'आपकी स्वीकृति की प्रतीक्षा में';

  @override
  String get agentTaskNoResult => 'अभी कोई परिणाम नहीं मिला';

  @override
  String get agentTaskInstructions => 'कार्य निर्देश';

  @override
  String get agentTaskRuntime => 'निष्पादन जानकारी';

  @override
  String agentTaskParent(String name) {
    return 'से: $name';
  }

  @override
  String agentTaskUpdated(String time) {
    return 'अपडेट किया गया $time';
  }

  @override
  String get agentTaskOffline => 'कंप्यूटर ऑफ़लाइन · अंतिम ज्ञात स्थिति';

  @override
  String get agentTaskOpenConversation => 'उपकार्य की बातचीत खोलें';

  @override
  String get agentTaskEmpty => 'अभी कोई उपकार्य नहीं';

  @override
  String get agentTaskFinishedResult => 'परिणाम';

  @override
  String get liveTaskRunning => 'काम जारी है';

  @override
  String get liveTaskApproval => 'मंज़ूरी चाहिए';

  @override
  String get liveTaskQuestion => 'जवाब चाहिए';

  @override
  String get liveTaskCompleted => 'पूरा हुआ';

  @override
  String get liveTaskFailed => 'कार्य विफल';

  @override
  String get liveTaskStopped => 'रोक दिया गया';

  @override
  String get liveTaskStale => 'स्थिति देखें';

  @override
  String get liveTaskOpen => 'कार्य देखें';

  @override
  String get liveTaskReview => 'समीक्षा करें';

  @override
  String get liveTaskElapsed => 'बीता समय';

  @override
  String get liveTaskUpdated => 'पिछला सिंक';

  @override
  String get androidPushDisclosure =>
      'Enable background alerts with JPush and, on supported devices, vivo Push. They process a push identifier, Android ID, device/system and network information for delivery. Task content and encryption keys are not sent to these providers. You can turn alerts off in system settings.';

  @override
  String get controllerSessionUnavailable =>
      'यह बातचीत जुड़े हुए कंप्यूटर पर उपलब्ध नहीं है। जाँचें कि इसका Agent चल रहा है और बातचीत अभी मौजूद है, फिर दोबारा प्रयास करें या नई बातचीत शुरू करें।';

  @override
  String get settingsSidebarAgents => 'साइडबार एजेंट';

  @override
  String get settingsSidebarAgentsSubtitle =>
      'साइडबार में दिखने वाले एजेंट चुनें';

  @override
  String get turnStatusRunning => 'प्रक्रिया जारी';

  @override
  String get turnStatusCompleted => 'चरण पूरा हुआ';

  @override
  String get turnStatusInterrupted => 'यह चरण पूरा नहीं हुआ';

  @override
  String get turnStatusUnknown => 'गतिविधि रिकॉर्ड';

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
  String get localWebForward => 'अगला पृष्ठ';

  @override
  String get localWebAddress => 'पृष्ठ का पता';

  @override
  String get localWebLoading => 'आपके कंप्यूटर से कनेक्ट हो रहा है…';

  @override
  String get accountDeletionTitle => 'खाता हटाएँ';

  @override
  String get accountDeletionBody =>
      'आपका Relayune खाता, डिवाइस अनुमतियाँ, प्राथमिकताएँ और प्रतिक्रिया स्थायी रूप से हट जाएँगी। डिवाइस की पहुँच और इस फ़ोन की कैश कुंजियाँ हटेंगी। कंप्यूटर पर Agent के प्रोजेक्ट और फ़ाइलें नहीं हटेंगी।';

  @override
  String get accountDeletionPassword => 'पासवर्ड की पुष्टि करें';

  @override
  String get accountDeletionConfirm => 'मेरा खाता स्थायी रूप से हटाएँ';

  @override
  String get accountDeletionBusy => 'हटाया जा रहा है…';

  @override
  String get accountDeletionWrongPassword => 'पासवर्ड गलत है। फिर कोशिश करें।';

  @override
  String get accountDeletionFailed =>
      'हटाना पूरा नहीं हुआ। कनेक्शन जाँचें और फिर कोशिश करें। प्रक्रिया शुरू होने पर सफ़ाई पूरी होने तक खाते की अन्य पहुँच बंद रहती है।';

  @override
  String get accountDeletionDone => 'आपका खाता हटा दिया गया है।';

  @override
  String get controllerPendingInputSaveFailed =>
      'आपका संदेश इस फ़ोन पर सहेजा नहीं जा सका। स्टोरेज खाली करके फिर कोशिश करें।';

  @override
  String get workbenchHistoryRequestSending => 'अनुरोध भेजा जा रहा है';

  @override
  String get workbenchHistoryWaitingComputer =>
      'आपके कंप्यूटर के जवाब का इंतज़ार है';

  @override
  String get workbenchHistoryReadingComputer =>
      'कंप्यूटर पर पुराने संदेश पढ़े जा रहे हैं';

  @override
  String get workbenchHistoryPreparing => 'संदेश तैयार किए जा रहे हैं';

  @override
  String workbenchHistoryElapsed(int seconds) {
    return 'बीता समय: $seconds सेकंड';
  }

  @override
  String get workbenchHistoryTransferring => 'इतिहास स्थानांतरित हो रहा है';

  @override
  String workbenchHistorySourceRead(String read, String total) {
    return 'कंप्यूटर ने पढ़ा: $read / $total';
  }

  @override
  String workbenchHistoryPendingTransfer(String size) {
    return 'स्थानांतरण के लिए शेष पृष्ठ: $size';
  }

  @override
  String workbenchHistoryReceived(String size) {
    return 'प्राप्त: $size';
  }

  @override
  String workbenchHistoryPendingReceive(String size) {
    return 'प्राप्त होना बाकी: $size';
  }

  @override
  String get workbenchHistoryReadingCache =>
      'इस फ़ोन पर सहेजा गया इतिहास पढ़ा जा रहा है';

  @override
  String get localWebResources => 'पृष्ठ संसाधन';

  @override
  String get localWebGettingPage => 'वेबपृष्ठ प्राप्त हो रहा है…';

  @override
  String get localWebLoadingPage => 'पृष्ठ लोड हो रहा है…';

  @override
  String localWebResourceSummary(int completed, int active) {
    return '$completed प्राप्त · $active जारी';
  }

  @override
  String localWebResourceFailures(int count) {
    return '$count विफल';
  }

  @override
  String get localWebResourceWaiting => 'उत्तर की प्रतीक्षा';

  @override
  String get localWebResourceReceiving => 'प्राप्त हो रहा है';

  @override
  String get localWebResourcePreparing => 'तैयारी हो रही है';

  @override
  String get localWebResourceComplete => 'प्राप्त';

  @override
  String get localWebResourceFailed => 'विफल';

  @override
  String get localWebResourceCancelled => 'रोक दिया गया';

  @override
  String get localWebResourceTransferNote =>
      'प्रगति उत्तर प्राप्त होने को दर्शाती है। पृष्ठ और संसाधन माँग सकता है।';

  @override
  String get localWebResourceEmpty =>
      'इस पृष्ठ द्वारा माँगे गए संसाधन यहाँ दिखाई देंगे।';

  @override
  String localWebResourceRecent(int count) {
    return 'नवीनतम $count संसाधन दिखाए जा रहे हैं';
  }

  @override
  String localWebElapsed(String seconds) {
    return '$seconds से॰';
  }

  @override
  String get localWebOpeningTitle => 'आपके कंप्यूटर का पृष्ठ';

  @override
  String get localWebOpeningHint =>
      'कंप्यूटर और वेब सेवा चालू रखें। पृष्ठ अपने आप दिखाई देगा।';

  @override
  String get replyBranchLabel => 'नई चैट में शाखा बनाएँ';

  @override
  String get replyBranchSameDirectory =>
      'प्रोजेक्ट की मूल डायरेक्टरी इस्तेमाल करें';

  @override
  String get replyBranchSameDirectoryDescription =>
      'प्रोजेक्ट फ़ाइलें साझा करना जारी रखें';

  @override
  String get replyBranchWorktree => 'नया worktree बनाएँ';

  @override
  String get replyBranchWorktreeDescription =>
      'अलग डायरेक्टरी, मौजूदा कमिट पर आधारित';

  @override
  String get controllerReplyBranchOffline =>
      'शाखा बनाने के लिए कंप्यूटर से जुड़ें';

  @override
  String get controllerReplyBranchCreating => 'नई चैट बनाई जा रही है…';

  @override
  String get controllerReplyBranchCreated =>
      'मूल प्रोजेक्ट डायरेक्टरी में नई चैट की शाखा बनाई गई।';

  @override
  String get controllerReplyBranchFailed =>
      'नई चैट नहीं बनाई जा सकी। फिर कोशिश करें।';

  @override
  String get controllerReplyBranchUnconfirmed =>
      'शाखा का परिणाम अभी पुष्ट नहीं है। जुड़े रहें और जाँचने के लिए फिर कोशिश करें।';

  @override
  String get controllerReplyBranchUnavailable =>
      'इस उत्तर से शाखा नहीं बन सकती। बातचीत रीफ़्रेश करें।';

  @override
  String get controllerReplyBranchBusy =>
      'चैट का दूसरा काम चल रहा है। थोड़ी देर बाद कोशिश करें।';

  @override
  String get controllerReplyBranchWorktreeFailed =>
      'worktree नहीं बनाया जा सका। कंप्यूटर पर प्रोजेक्ट जाँचकर फिर कोशिश करें।';

  @override
  String get controllerReplyBranchWorktreeCreated =>
      'अलग worktree में नई चैट की शाखा बनाई गई।';

  @override
  String agentTasksCompletedCount(int count) {
    return '$count पूर्ण';
  }

  @override
  String agentTasksStoppedCount(int count) {
    return '$count रोके गए';
  }

  @override
  String agentTasksFailedCount(int count) {
    return '$count विफल';
  }

  @override
  String agentTasksPreparingCount(int count) {
    return '$count तैयारी में';
  }

  @override
  String agentTasksUnknownCount(int count) {
    return '$count सिंक की प्रतीक्षा में';
  }

  @override
  String get agentTasksSearch => 'कार्य, उपनाम या मॉडल खोजें';

  @override
  String get agentTasksNoMatches => 'कोई मेल खाता उपकार्य नहीं';

  @override
  String get agentTaskModelConfiguration => 'मॉडल कॉन्फ़िगरेशन';
}
