// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Arabic (`ar`).
class AppLocalizationsAr extends AppLocalizations {
  AppLocalizationsAr([String locale = 'ar']) : super(locale);

  @override
  String get workbenchStateAnswered => 'تمت الإجابة';

  @override
  String get workbenchTurnIncomplete => 'لم تكتمل هذه المحاولة';

  @override
  String get controllerQueueUnconfirmed =>
      'لم تتأكد حالة معالجة الرسالة. حدّث المحادثة للتحقق.';

  @override
  String get homeGreetingMorning => 'صباح الخير';

  @override
  String get homeGreetingNoon => 'طاب نهارك';

  @override
  String get homeGreetingAfternoon => 'طاب نهارك';

  @override
  String get homeGreetingEvening => 'مساء الخير';

  @override
  String get homeGreetingNight => 'تأخر الليل';

  @override
  String get homeCareLongBreak =>
      'مضى وقت من التركيز. لا بأس باستراحة أطول قليلًا.';

  @override
  String get homeCarePause => 'رشفة ماء ونظرة إلى البعيد. لحظة لنفسك.';

  @override
  String get homeCareNightWorking =>
      'إن كان العمل مستمرًا، فليكن للراحة نصيب هذه الليلة.';

  @override
  String get homeCareNightQuiet => 'لا بأس بترك بعض الأمور للغد.';

  @override
  String get homeCareBusyDay =>
      'مضى وقت طويل هنا اليوم. بعض الوقت لنفسك أيضًا.';

  @override
  String get homeCareDecision => 'خذ وقتك في التفكير والقرار.';

  @override
  String get homeCareLongWait => 'طال الانتظار قليلًا. فرصة للاهتمام بنفسك.';

  @override
  String get homeCareWelcomeBack => 'أهلًا بعودتك. تابع على مهل.';

  @override
  String get homeCareFirstIdea => 'البداية فكرة، حين تكون مستعدًا.';

  @override
  String get homeCareMeal => 'لم تأكل بعد؟ خصص قليلًا من الوقت لوجبة.';

  @override
  String get homeCareEasterEgg => 'إنجاز خفي: العناية بنفسك، بلا شريط تقدم.';

  @override
  String get homeCareWeekend => 'عطلة على إيقاعك، مع فسحة للراحة.';

  @override
  String get homeCareDailyProgress => 'ليكن اليوم بعض التقدم وبعض الهدوء.';

  @override
  String get homeCareDailySpace => 'الأفكار تحتاج إلى مساحة. وأنت أيضًا.';

  @override
  String get homeCareDailyPace => 'أمر واحد في كل مرة، مع فسحة لنفسك.';

  @override
  String get workbenchReturnHome => 'العودة إلى الرئيسية';

  @override
  String get workbenchVisualization => 'تصوّر مرئي';

  @override
  String get workbenchVisualizationUnavailable => 'هذا التصوّر غير متاح بعد.';

  @override
  String get workbenchDesktopVersionUnknown => 'الإصدار غير معروف';

  @override
  String get appTitle => 'Relayune';

  @override
  String get commonBack => 'رجوع';

  @override
  String get commonCancel => 'إلغاء';

  @override
  String get commonClose => 'إغلاق';

  @override
  String get commonContinue => 'متابعة';

  @override
  String get commonRetry => 'إعادة المحاولة';

  @override
  String get commonSave => 'حفظ';

  @override
  String get commonSubmit => 'إرسال';

  @override
  String get commonSettings => 'الإعدادات';

  @override
  String get commonLogOut => 'تسجيل الخروج';

  @override
  String get commonReject => 'رفض';

  @override
  String get commonAllow => 'سماح';

  @override
  String get unavailableTitle => 'Relayune غير متاح مؤقتًا';

  @override
  String get clearLoginSession => 'مسح جلسة تسجيل الدخول';

  @override
  String get updateInstallerUnavailable =>
      'تعذّر فتح مثبّت النظام. حاول لاحقًا.';

  @override
  String get updateReadyTitle => 'التحديث جاهز';

  @override
  String updateDownloaded(String version) {
    return 'تم تنزيل Relayune $version والتحقق منه بأمان في الخلفية.';
  }

  @override
  String get updateLater => 'لاحقًا';

  @override
  String get updateInstall => 'تثبيت التحديث';

  @override
  String get authSecurityBadge => 'مساحة عمل مشفّرة من طرف إلى طرف';

  @override
  String get authEmailTitle => 'تابع مهام الكمبيوتر من هاتفك';

  @override
  String get authPasswordTitle => 'سجّل الدخول أو أنشئ حسابًا';

  @override
  String get authVerificationTitle => 'تحقق من بريدك الإلكتروني';

  @override
  String get authEmailSubtitle =>
      'بعد تسجيل الدخول، استخدم الرمز المكوّن من 8 أحرف الظاهر على سطح المكتب لإنشاء اتصال مشفّر.';

  @override
  String get authPasswordSubtitle =>
      'سجّل الدخول بكلمة المرور، أو تحقق من بريدك أولًا إذا كانت هذه المرة الأولى.';

  @override
  String get authVerificationSubtitle =>
      'رابط التحقق صالح لاستخدام واحد وتنتهي صلاحيته قريبًا.';

  @override
  String get authEmailLabel => 'البريد الإلكتروني';

  @override
  String get authInvalidEmail => 'أدخل عنوان بريد إلكتروني صالحًا.';

  @override
  String get authContinue => 'متابعة';

  @override
  String get authChangeEmail => 'تغيير البريد';

  @override
  String get authPasswordLabel => 'كلمة المرور';

  @override
  String get authShowPassword => 'إظهار كلمة المرور';

  @override
  String get authHidePassword => 'إخفاء كلمة المرور';

  @override
  String get authPasswordRequired => 'أدخل كلمة المرور.';

  @override
  String get authSignIn => 'تسجيل الدخول';

  @override
  String get authVerifyEmailAction =>
      'أول استخدام أو نسيت كلمة المرور؟ تحقق من البريد';

  @override
  String get authVerificationInstructions =>
      'افتح رسالة التحقق واضبط كلمة مرور في صفحة الويب الآمنة، ثم ارجع إلى هنا.';

  @override
  String get authPasswordSet => 'ضبطت كلمة المرور';

  @override
  String get authResendEmail => 'إعادة إرسال الرسالة';

  @override
  String get authSecurityNote =>
      'لا يمرر الخادم إلا النص المشفّر. لا يتم رفع رمز الاتصال أو مفاتيح المحتوى مطلقًا.';

  @override
  String get pairingExit => 'خروج';

  @override
  String get pairingTitle => 'امسح الرمز لتوصيل الكمبيوتر';

  @override
  String get pairingSubtitle => 'خذ عملك معك.';

  @override
  String get pairingEnterCodeTitle => 'أو أدخل الرمز المكوّن من 8 أحرف';

  @override
  String get pairingEnterCodeHelp => 'أدخل رمز الاتصال الظاهر على الكمبيوتر.';

  @override
  String get pairingSearching => 'جارٍ البحث عن أجهزة كمبيوتر تنتظر الاتصال…';

  @override
  String get pairingComputerLabel => 'الكمبيوتر المراد توصيله';

  @override
  String pairingWillConnect(String device) {
    return 'جارٍ الاتصال بـ: $device';
  }

  @override
  String get pairingStartOnDesktop =>
      'اختر أولًا «توصيل عميل جديد» على سطح المكتب ثم أدخل الرمز الجديد.';

  @override
  String get pairingSearchAgain => 'البحث مجددًا';

  @override
  String get pairingCodeLabel => 'رمز اتصال من 8 أحرف';

  @override
  String get pairingSecureConnect => 'اتصال آمن';

  @override
  String get pairingScanTitle => 'أين رمز QR؟';

  @override
  String get pairingScanHelp =>
      'افتح Relayune على الكمبيوتر واختر «توصيل عميل جديد».\nامسح رمز QR في تلك النافذة.';

  @override
  String get pairingOpenCamera => 'امسح للاتصال';

  @override
  String get pairingPrivacyNote =>
      'تشفير من طرف إلى طرف. أجهزتك وحدها تستطيع قراءة الجلسات.';

  @override
  String pairingMinimumDesktop(String version) {
    return 'أدنى إصدار سطح مكتب متوافق: $version';
  }

  @override
  String get pairingDeriving => 'جارٍ التحقق من الاتصال…';

  @override
  String get pairingWaitingDesktop => 'في انتظار تأكيد الكمبيوتر…';

  @override
  String get pairingActivating => 'جارٍ إنشاء قناة مشفّرة…';

  @override
  String get pairingDerivingDetail =>
      'جارٍ إنشاء مشاركة SPAKE2 ومفتاح محتوى مستقل على هذا الجهاز.';

  @override
  String get pairingWaitingDesktopDetail =>
      'أبقِ Relayune مفتوحًا على الكمبيوتر.';

  @override
  String get pairingActivatingDetail =>
      'جارٍ التحقق من أول قائمة جلسات مشفّرة.';

  @override
  String get scannerTitle => 'امسح رمز QR للاتصال على الكمبيوتر';

  @override
  String get scannerResume => 'استئناف المسح';

  @override
  String get scannerInvalid =>
      'هذا ليس رمز اتصال Relayune. امسح الرمز الحالي الظاهر على سطح المكتب.';

  @override
  String get scannerHelp =>
      'ضع رمز QR الذي يعرضه Relayune على الكمبيوتر داخل الإطار.';

  @override
  String get scannerUnavailable =>
      'الكاميرا غير متاحة. اسمح لـ Relayune باستخدامها في إعدادات النظام أو اتصل يدويًا.';

  @override
  String get settingsTitle => 'الإعدادات';

  @override
  String get settingsSignedInAccount => 'الحساب المسجّل';

  @override
  String get settingsAccountSection => 'الحساب';

  @override
  String get settingsPreferencesSection => 'التفضيلات';

  @override
  String get settingsHelpLegalSection => 'الدعم والشؤون القانونية';

  @override
  String get settingsLanguage => 'اللغة';

  @override
  String get settingsLanguageSystemDefault => 'الافتراضي (لغة النظام)';

  @override
  String settingsLanguageSystemDefaultValue(String language) {
    return 'الافتراضي · $language';
  }

  @override
  String get settingsLanguageSaveFailed =>
      'تغيرت اللغة، لكن تعذّر حفظ التفضيل.';

  @override
  String get settingsReleaseNotes => 'ملاحظات الإصدار';

  @override
  String get settingsSupport => 'الدعم';

  @override
  String get settingsTerms => 'شروط الخدمة';

  @override
  String get settingsPrivacy => 'سياسة الخصوصية';

  @override
  String get settingsLegalLanguage => 'العربية';

  @override
  String get settingsOpenLinkFailed => 'تعذّر فتح هذا الرابط.';

  @override
  String get releaseTitle => 'ملاحظات الإصدار';

  @override
  String get releaseLoading => 'جارٍ تحميل ملاحظات الإصدار';

  @override
  String get releaseErrorTitle => 'ملاحظات الإصدار غير متاحة';

  @override
  String get releaseErrorMessage => 'تحقق من اتصالك وحاول مجددًا.';

  @override
  String get releaseEmptyTitle => 'لا توجد ملاحظات إصدار بعد';

  @override
  String get releaseEmptyMessage => 'ستظهر التحديثات القادمة هنا.';

  @override
  String get releaseVersion => 'الإصدار';

  @override
  String get releaseWeb => 'الويب';

  @override
  String get releaseServer => 'الخادم';

  @override
  String get notificationEnabledTitle => 'إشعارات المهام مفعّلة';

  @override
  String get notificationPrimerTitle =>
      'تعمل المهمة على الكمبيوتر، فلا حاجة للمراقبة المستمرة';

  @override
  String get notificationEnabledBody =>
      'ينبهك Relayune عندما تحتاج المهمة إلى انتباهك أو تكتمل.';

  @override
  String get notificationPrimerBody =>
      'تعامل مع الموافقات والأسئلة في الوقت المناسب، ثم شاهد ملخص الرد عند الاكتمال.';

  @override
  String get notificationBenefitAction =>
      'تحتاج انتباهًا: اسمح أو ارفض أو افتح الإجابة من الإشعار';

  @override
  String get notificationBenefitCompletion =>
      'اكتملت المهمة: عاين الملخص قبل فتحها';

  @override
  String get notificationBenefitPrivacy =>
      'لا تعرض الإشعارات أوامر أو مسارات ملفات أو رموز اتصال أو مفاتيح';

  @override
  String get notificationPermissionRejected =>
      'إشعارات النظام ما زالت متوقفة. يمكنك السماح بها في الإعدادات.';

  @override
  String get notificationGotIt => 'حسنًا';

  @override
  String get notificationOpenSettings => 'فتح إعدادات النظام';

  @override
  String get notificationEnable => 'تفعيل إشعارات المهام';

  @override
  String get notificationNotNow => 'ليس الآن';

  @override
  String get notificationSemanticsExample =>
      'أمثلة إشعارات: موافقة تحتاج إجراء وسؤال يحتاج إجابة ومهمة Claude مكتملة';

  @override
  String get notificationNow => 'الآن';

  @override
  String get notificationSampleTask => 'تحسين إشعارات الهاتف';

  @override
  String get notificationSampleBody =>
      'أصبح دليل أذونات الإشعارات وملخص اكتمال المهمة جاهزين…';

  @override
  String get notificationApprovalTitle => 'عملية بانتظار التأكيد';

  @override
  String get notificationQuestionTitle => 'إجابتك مطلوبة';

  @override
  String notificationTaskPaused(String provider) {
    return '$provider · المهمة متوقفة';
  }

  @override
  String notificationApprovalBody(int minutes) {
    return 'اسمح بهذه العملية أو ارفضها خلال $minutes دقيقة.';
  }

  @override
  String notificationQuestionBody(int minutes) {
    return 'أجب خلال $minutes دقيقة. ستتابع المهمة بعد الإرسال.';
  }

  @override
  String notificationTaskCompleted(String provider) {
    return 'اكتملت مهمة $provider';
  }

  @override
  String get notificationMainTask => 'المهمة الرئيسية';

  @override
  String get notificationMainResultReady =>
      'نتيجة المهمة الرئيسية جاهزة. اضغط للعرض.';

  @override
  String notificationNamedResultReady(String name) {
    return 'نتيجة «$name» جاهزة. اضغط للعرض.';
  }

  @override
  String get notificationAllowOnce => 'سماح مرة واحدة';

  @override
  String get notificationAnswer => 'إجابة';

  @override
  String get notificationChannelAttention => 'تحتاج انتباهًا';

  @override
  String get notificationChannelCompleted => 'اكتملت المهمة';

  @override
  String get notificationChannelAttentionDescription =>
      'تنبيهات الموافقات والأسئلة من Relayune';

  @override
  String get notificationChannelCompletedDescription =>
      'تنبيهات اكتمال المهمة الرئيسية من Relayune';

  @override
  String get notificationRedactedLink => '[رابط]';

  @override
  String get notificationRedactedPath => '[مسار]';

  @override
  String get notificationRedactedSecret => '[مخفي]';

  @override
  String get workbenchTitle => 'مساحة العمل';

  @override
  String get workbenchDevice => 'الجهاز';

  @override
  String get workbenchOpenNavigation => 'فتح التنقل';

  @override
  String workbenchPendingApprovals(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count موافقات معلّقة',
      one: 'موافقة واحدة معلّقة',
    );
    return '$_temp0';
  }

  @override
  String get workbenchSessions => 'الجلسات';

  @override
  String get workbenchOnline => 'متصل';

  @override
  String get workbenchOffline => 'غير متصل';

  @override
  String get workbenchDeviceOnlineRealtime => 'الكمبيوتر متصل · مزامنة فورية';

  @override
  String get workbenchDeviceOfflineQueued =>
      'الكمبيوتر غير متصل · السجلات المخزنة مؤقتًا فقط';

  @override
  String get workbenchDeviceOnlineReconnecting =>
      'الكمبيوتر متصل · جارٍ استعادة الاتصال الفوري';

  @override
  String get workbenchDeviceOfflineReconnecting =>
      'الكمبيوتر غير متصل · جارٍ استعادة الاتصال الفوري';

  @override
  String get workbenchDeviceOnlineWaiting =>
      'الكمبيوتر متصل · في انتظار الاتصال الفوري';

  @override
  String get workbenchDeviceOfflineWaiting =>
      'الكمبيوتر غير متصل · في انتظار الاتصال الفوري';

  @override
  String get workbenchProjectsSessions => 'المشاريع والجلسات';

  @override
  String get workbenchNoSessionsSynced =>
      'لم تتم مزامنة أي جلسة من الكمبيوتر بعد';

  @override
  String get workbenchSignedInAccount => 'الحساب المسجّل';

  @override
  String get workbenchNotSignedIn => 'لم يتم تسجيل الدخول';

  @override
  String get workbenchNewSession => 'جلسة جديدة';

  @override
  String get workbenchDefaultSessionName => 'جلسة بعيدة جديدة';

  @override
  String get workbenchHistoryFailed =>
      'تعذّر تحميل السجل؛ قد يكون المحتوى الحالي غير مكتمل';

  @override
  String get workbenchLoadEarlier => 'تحميل الرسائل السابقة';

  @override
  String get workbenchSendFirst => 'أرسل أول تعليماتك للبدء';

  @override
  String get workbenchAtBeginning => 'هذه أول رسالة';

  @override
  String get workbenchAddAttachment => 'إضافة مرفق';

  @override
  String workbenchRemoveAttachment(String name) {
    return 'إزالة $name';
  }

  @override
  String get workbenchReadOnly => 'هذه الجلسة للقراءة فقط';

  @override
  String get workbenchOfflineQueued => 'الكمبيوتر غير متصل · الإرسال غير متاح';

  @override
  String get workbenchSteerPlaceholder =>
      'أرسل تعليمات جديدة لإيقاف التنفيذ ثم المتابعة…';

  @override
  String get workbenchSendPlaceholder => 'أرسل تعليمات إلى الكمبيوتر…';

  @override
  String get workbenchStopTask => 'إيقاف المهمة';

  @override
  String get workbenchSending => 'جارٍ الإرسال';

  @override
  String get workbenchSend => 'إرسال';

  @override
  String get workbenchYou => 'أنت';

  @override
  String get workbenchLocalActivity => 'نشاط محلي';

  @override
  String get workbenchToday => 'اليوم';

  @override
  String get workbenchYesterday => 'أمس';

  @override
  String get workbenchDayBeforeYesterday => 'أول أمس';

  @override
  String get workbenchSystemNotice => 'إشعار النظام';

  @override
  String workbenchApprovalSource(String name) {
    return 'المصدر: $name';
  }

  @override
  String workbenchApprovalDirectory(String path) {
    return 'المجلد: $path';
  }

  @override
  String get workbenchApprovalPermission => 'الإذن المطلوب';

  @override
  String get workbenchSelect => 'اختيار';

  @override
  String get workbenchOtherAnswer => 'إجابة أخرى…';

  @override
  String get workbenchSkipAnswer => 'ليس الآن';

  @override
  String get workbenchHighRiskTitle => 'السماح بعملية عالية الخطورة؟';

  @override
  String get workbenchOperationOnComputer =>
      'ستعمل هذه العملية على جهاز الكمبيوتر.';

  @override
  String get workbenchConfirmAllow => 'تأكيد وسماح';

  @override
  String get workbenchAnswerLabel => 'الإجابة';

  @override
  String get workbenchAllowOnce => 'سماح مرة واحدة';

  @override
  String get workbenchAlwaysAllowSession => 'السماح دائمًا في هذه الجلسة';

  @override
  String get workbenchAllowAndRemember => 'سماح وتذكّر';

  @override
  String get workbenchAlwaysRejectSession => 'الرفض دائمًا في هذه الجلسة';

  @override
  String get workbenchRejectAndRemember => 'رفض وتذكّر';

  @override
  String get workbenchSaveDecisionTitle => 'تذكّر هذا القرار؟';

  @override
  String get workbenchSaveDecisionMessage =>
      'سيطبّق Relayune هذا الخيار تلقائيًا على العمليات المشابهة في الجلسة الحالية فقط.';

  @override
  String get workbenchConfirm => 'تأكيد';

  @override
  String get workbenchRejectAndStop => 'رفض وإيقاف المهمة';

  @override
  String get workbenchNotificationSettings => 'إشعارات المهام';

  @override
  String get workbenchConnectAnother => 'توصيل كمبيوتر آخر';

  @override
  String get workbenchConnectAnotherSubtitle =>
      'حذف مفتاح المحتوى وتفويض الجهاز الحاليين من هذا الهاتف';

  @override
  String get workbenchConnectAnotherTitle => 'توصيل كمبيوتر آخر؟';

  @override
  String get workbenchConnectAnotherMessage =>
      'سيتم حذف مفتاح المحتوى الحالي ورمز تفويض الهاتف من مخزن بيانات الاعتماد الآمن لهذا الجهاز. لن تُحذف بيانات الخادم أو الكمبيوتر.';

  @override
  String get workbenchNoSessions => 'لا توجد جلسات متاحة';

  @override
  String get workbenchNoSessionsHelp =>
      'أبقِ تطبيق سطح المكتب متصلًا، أو أنشئ جلسة جديدة في مجلد مشروع على الكمبيوتر.';

  @override
  String get workbenchHistoryLoading => 'جارٍ تحميل سجل الرسائل';

  @override
  String get workbenchHistoryLoadingOlder => 'جارٍ تحميل رسائل أقدم…';

  @override
  String get workbenchHistoryLimit =>
      'يُحمّل السجل بعد فتح جلسة، حتى 500 رسالة في كل مرة';

  @override
  String get workbenchFilePreviewRetry => 'فشلت معاينة الملف. حاول مجددًا.';

  @override
  String get workbenchSecureFileReading => 'جارٍ القراءة بأمان من الكمبيوتر…';

  @override
  String get workbenchFileUnavailable =>
      'انتهت صلاحية الملف أو أزيل من الكمبيوتر.';

  @override
  String get workbenchApprovalCommand => 'تشغيل أمر';

  @override
  String get workbenchApprovalFileChange => 'تعديل ملف';

  @override
  String get workbenchApprovalChoice => 'اختيارك مطلوب';

  @override
  String get workbenchApprovalTool => 'تشغيل أداة محلية';

  @override
  String get workbenchStatePending => 'معلّقة';

  @override
  String get workbenchStateDeciding => 'جارٍ الإرسال';

  @override
  String get workbenchStateApproved => 'مقبولة';

  @override
  String get workbenchStateRejected => 'مرفوضة';

  @override
  String get workbenchStateExpired => 'منتهية';

  @override
  String get workbenchLocalRelay => 'Relay محلي';

  @override
  String get workbenchEncryptionProtocol => 'بروتوكول التشفير';

  @override
  String get workbenchPairingProtocol => 'بروتوكول الاقتران';

  @override
  String get workbenchRealtimeChannel => 'القناة الفورية';

  @override
  String get workbenchTechnicalDetails => 'تفاصيل تقنية';

  @override
  String get workbenchRealtimeConnection => 'الاتصال الفوري';

  @override
  String get workbenchHeartbeatPath => 'iPhone ↔ Server · WebSocket';

  @override
  String get workbenchHeartbeatHealthy => 'نبض الاتصال سليم';

  @override
  String get workbenchHeartbeatWaiting => 'بانتظار أول نبضة';

  @override
  String get workbenchLastHeartbeat => 'آخر نبضة';

  @override
  String get workbenchRoundTrip => 'زمن الذهاب والإياب';

  @override
  String get workbenchWebSocketHeartbeat => 'نبض WebSocket';

  @override
  String get workbenchDesktopHeartbeat => 'نبض الكمبيوتر';

  @override
  String get workbenchJustNow => 'الآن';

  @override
  String workbenchSecondsAgo(int seconds) {
    return 'قبل $seconds ث';
  }

  @override
  String workbenchMinutesAgo(int minutes) {
    return 'قبل $minutes د';
  }

  @override
  String get workbenchStateVersion => 'إصدار الحالة';

  @override
  String get workbenchAwaitingConfirmation => 'في انتظار التأكيد';

  @override
  String get workbenchLastConfirmed => 'آخر تأكيد';

  @override
  String get workbenchEventAck => 'إقرار الأحداث';

  @override
  String get workbenchOfflineQueue => 'قائمة انتظار دون اتصال';

  @override
  String get workbenchSecurityBoundary => 'حد التشفير من طرف إلى طرف';

  @override
  String get workbenchPhonePlaintextEndpoint =>
      'الهاتف نقطة نهاية يرى فيها التطبيق النص الصريح';

  @override
  String get workbenchServerCiphertextOnly =>
      'لا يخزن الخادم إلا أغلفة نص مشفّر موثّقة';

  @override
  String get workbenchKeyInSecureStorage =>
      'تُحفظ مفاتيح المحتوى في مخزن بيانات الاعتماد الآمن للنظام';

  @override
  String get workbenchCodeNeverUploaded =>
      'لا يتم رفع رمز الاتصال المكوّن من 8 أحرف';

  @override
  String get workbenchNotConfirmed => 'لم يتم التأكيد بعد';

  @override
  String get workbenchRealtimeConnected => 'WebSocket متصل';

  @override
  String get workbenchRealtimeConnecting => 'جارٍ الاتصال';

  @override
  String get workbenchRealtimeReconnecting => 'جارٍ إعادة الاتصال';

  @override
  String get workbenchRealtimeIdle => 'في انتظار الاتصال';

  @override
  String workbenchNotificationStatus(String status) {
    return '$status · تعمل الإشعارات ما دام اتصال التطبيق في الخلفية نشطًا؛ ولا يُضمن وصولها بعد إنهاء النظام للتطبيق';
  }

  @override
  String get workbenchNotificationAllowed => 'مسموح';

  @override
  String get workbenchNotificationDisabled => 'متوقف';

  @override
  String get workbenchNotificationUnknown => 'غير معروف';

  @override
  String get workbenchClose => 'إغلاق';

  @override
  String get workbenchProjectConfiguration => 'إعدادات المشروع';

  @override
  String get workbenchProjectConfigurationTitle => 'إعدادات المشروع';

  @override
  String get workbenchProjectName => 'اسم المشروع';

  @override
  String get workbenchProjectNameHelp =>
      'يغيّر هذا الاسم الظاهر في التطبيق فقط، ولا يعيد تسمية المجلد على الكمبيوتر.';

  @override
  String get workbenchFullPath => 'المسار الكامل';

  @override
  String get workbenchProjectPathUnavailable =>
      'لم يرسل الكمبيوتر مسار المشروع';

  @override
  String workbenchSessionCount(int count) {
    return '$count جلسات';
  }

  @override
  String workbenchMoreSessions(int count) {
    return 'إظهار جلسات أخرى ($count)';
  }

  @override
  String get workbenchAgentRunning => 'Agent قيد التشغيل';

  @override
  String get workbenchAgentNotRunning => 'Agent غير مشغّل';

  @override
  String get workbenchRunning => 'قيد التشغيل';

  @override
  String get workbenchKimiSettings => 'إعدادات Kimi';

  @override
  String get workbenchEnableYoloTitle => 'تفعيل وضع YOLO؟';

  @override
  String get workbenchEnableAutoTitle => 'تفعيل وضع Auto؟';

  @override
  String get workbenchYoloWarning =>
      'سيوافق Kimi تلقائيًا على مزيد من استدعاءات الأدوات المحلية. فعّله فقط عندما تثق بالمهمة والمشروع.';

  @override
  String get workbenchAutoWarning =>
      'سيوافق Kimi تلقائيًا على استدعاءات الأدوات المعتادة، لكنه قد يطرح أسئلة.';

  @override
  String get workbenchConfirmEnable => 'تأكيد وتفعيل';

  @override
  String get workbenchUploadTooManyImages =>
      'يمكن إضافة 4 صور كحد أقصى لكل رسالة.';

  @override
  String workbenchUploadUnsupportedImages(String names) {
    return '$names غير مدعومة. اختر PNG أو JPEG أو WebP أو GIF أو AVIF.';
  }

  @override
  String get workbenchUploadTooLarge =>
      'لا يمكن أن يتجاوز مجموع مرفقات الرسالة 20 MiB.';

  @override
  String workbenchPreviewGenerateFailed(String name) {
    return 'تعذّر قراءة معاينة $name أو إنشاؤها. حاول مجددًا.';
  }

  @override
  String get workbenchKimiViewAgents => 'عرض الوكلاء الفرعيين';

  @override
  String get workbenchKimiViewAgentsDescription =>
      'افتح نافذة عمل Agent أعلى مربع الكتابة دون بدء مهمة نموذج جديدة.';

  @override
  String get workbenchKimiOpenNow => 'فتح الآن';

  @override
  String get workbenchKimiSessionStatus => 'حالة الجلسة';

  @override
  String get workbenchKimiSessionStatusDescription =>
      'اعرض المهمة والموافقات والسياق وحالة المزامنة المحلية.';

  @override
  String get workbenchKimiLocalStatus => 'الحالة المحلية';

  @override
  String get workbenchKimiModel => 'النموذج';

  @override
  String get workbenchKimiModelDescription =>
      'غيّر النموذج المستخدم في جلسة Kimi هذه.';

  @override
  String get workbenchKimiSessionSettings => 'إعدادات الجلسة';

  @override
  String get workbenchKimiPermissionMode => 'وضع الأذونات';

  @override
  String get workbenchKimiPermissionModeDescription =>
      'اعرض أو غيّر سياسة الموافقة على الأدوات المحلية.';

  @override
  String get workbenchKimiSecuritySettings => 'إعدادات الأمان';

  @override
  String get workbenchKimiPlanMode => 'وضع Plan';

  @override
  String get workbenchKimiPlanModeDescription =>
      'اطلب من Kimi التخطيط قبل تنفيذ المهمة.';

  @override
  String get workbenchKimiYoloMode => 'وضع YOLO';

  @override
  String get workbenchKimiYoloModeDescription =>
      'وافق تلقائيًا على مزيد من استدعاءات الأدوات؛ يلزم التأكيد قبل التفعيل.';

  @override
  String get workbenchKimiConfirmationRequired => 'التأكيد مطلوب';

  @override
  String get workbenchKimiSettingsDescription =>
      'افتح إعدادات النموذج وThinking والأذونات.';

  @override
  String workbenchKimiInputRequired(String hint) {
    return 'الإدخال مطلوب: $hint';
  }

  @override
  String get workbenchKimiNativeCommandDescription =>
      'أمر Kimi ACP أصلي يعمل كمهمة أمر فعلية.';

  @override
  String get workbenchKimiNativeCommand => 'أمر أصلي';

  @override
  String get workbenchKimiContextSyncing => 'السياق بانتظار المزامنة';

  @override
  String get workbenchKimiWaitingForSync => 'بانتظار المزامنة';

  @override
  String workbenchKimiContextUsage(int percent, String used, String size) {
    return 'السياق $percent% · $used/$size';
  }

  @override
  String workbenchKimiContextUsed(String used) {
    return 'السياق $used';
  }

  @override
  String get workbenchKimiContext => 'السياق';

  @override
  String get workbenchKimiModelSyncing => 'النموذج بانتظار المزامنة';

  @override
  String get workbenchKimiQuickCommands => 'أوامر سريعة';

  @override
  String get workbenchKimiNoMatchingCommands => 'لا توجد أوامر مطابقة';

  @override
  String get workbenchKimiTask => 'المهمة';

  @override
  String get workbenchKimiIdle => 'خامل';

  @override
  String get workbenchKimiSubagents => 'الوكلاء الفرعيون';

  @override
  String workbenchKimiActiveCount(int count) {
    return '$count نشط';
  }

  @override
  String get workbenchKimiApprovals => 'الموافقات';

  @override
  String workbenchKimiPendingCount(int count) {
    return '$count معلّق';
  }

  @override
  String get workbenchKimiSettingsOffline =>
      'لا يمكن تغيير إعدادات Kimi عندما يكون Relay غير متصل.';

  @override
  String get workbenchKimiSettingsRunning =>
      'أوقف مهمة Kimi الرئيسية قبل تغيير الإعدادات.';

  @override
  String get workbenchKimiNoOptions =>
      'لم يزامن الكمبيوتر أي خيارات قابلة للضبط بعد.';

  @override
  String get workbenchKimiEncryptedSettings =>
      'تُرسل الإعدادات بتشفير تام بين الطرفين إلى Kimi Code على كمبيوترك. لا يستطيع الخادم قراءتها.';

  @override
  String get workbenchKimiManualApproval => 'موافقة يدوية';

  @override
  String get workbenchSessionSettings => 'إعدادات الجلسة';

  @override
  String get workbenchSessionSettingsOffline =>
      'لا يمكن تغيير إعدادات الجلسة عندما يكون Relay غير متصل.';

  @override
  String get workbenchSessionSettingsRunning =>
      'أوقف المهمة الحالية قبل تغيير إعداداتها.';

  @override
  String get workbenchNoConfigOptions =>
      'لم يزامن الكمبيوتر أي خيارات قابلة للضبط بعد.';

  @override
  String workbenchEncryptedSessionSettings(String provider) {
    return 'تُرسل الإعدادات بتشفير تام بين الطرفين إلى $provider على كمبيوترك. لا يستطيع الخادم قراءتها.';
  }

  @override
  String get workbenchUnrestrictedPermissionsTitle =>
      'هل تريد تغيير وضع الأذونات؟';

  @override
  String get workbenchUnrestrictedPermissionsWarning =>
      'يغيّر هذا ما إذا كانت الأدوات المحلية مسموحة أو مرفوضة أو تتطلب موافقة. راجع الوضع المحدد قبل المتابعة.';

  @override
  String get workbenchCoworkCreateOnDesktop =>
      'أنشئ مهام Cowork أولًا في Claude Desktop؛ ويمكنك التحكم بالمهام الموجودة هنا.';

  @override
  String get workbenchProcessing => 'جارٍ العمل';

  @override
  String get workbenchProcess => 'العملية';

  @override
  String workbenchDurationMinutesSeconds(int minutes, int seconds) {
    return '$minutes د $seconds ث';
  }

  @override
  String workbenchDurationSeconds(int seconds) {
    return '$seconds ث';
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
  String get workbenchImageUrlUnavailable => 'عنوان الصورة غير متاح.';

  @override
  String workbenchFilePreviewAvailable(String kind) {
    return 'قابل للمعاينة · $kind · حتى 1 MB';
  }

  @override
  String get workbenchFilePreviewUnsupported =>
      'لا يمكن معاينة تنسيق الملف هذا';

  @override
  String workbenchImageReadFailed(String name) {
    return '$name\nتعذّرت قراءة الصورة';
  }

  @override
  String workbenchImageThumbnailLabel(String name) {
    return 'صورة مصغّرة لـ$name؛ اضغط لفتح المعاينة';
  }

  @override
  String get workbenchViewOriginal => 'عرض الصورة الأصلية';

  @override
  String get workbenchLoadingOriginal => 'جارٍ تحميل الصورة الأصلية بأمان…';

  @override
  String get workbenchOriginalReadFailed =>
      'تعذّرت قراءة الصورة الأصلية. حاول مجددًا.';

  @override
  String workbenchActivityFailed(String label) {
    return 'فشل $label';
  }

  @override
  String workbenchActivityCompleted(String label) {
    return 'اكتمل $label';
  }

  @override
  String workbenchActivityRunning(String label) {
    return 'جارٍ $label';
  }

  @override
  String get workbenchViewOutput => 'اضغط لعرض المخرجات';

  @override
  String get workbenchViewThumbnail => 'اضغط لعرض الصورة المصغّرة';

  @override
  String get workbenchSemanticSeparator => '، ';

  @override
  String workbenchCommandsRunning(int count) {
    return 'جارٍ تشغيل $count أوامر';
  }

  @override
  String workbenchCommandsFailed(int count) {
    return 'فشل بعض من $count أوامر';
  }

  @override
  String workbenchCommandsCompleted(int count) {
    return 'تم تشغيل $count أوامر';
  }

  @override
  String workbenchFilesReading(int count) {
    return 'جارٍ قراءة $count ملفات';
  }

  @override
  String workbenchFilesReadFailed(int count) {
    return 'تعذّرت قراءة بعض من $count ملفات';
  }

  @override
  String workbenchFilesRead(int count) {
    return 'تمت قراءة $count ملفات';
  }

  @override
  String workbenchFilesChanging(int count) {
    return 'جارٍ تغيير $count ملفات';
  }

  @override
  String workbenchFilesChangeFailed(int count) {
    return 'فشلت بعض تغييرات $count ملفات';
  }

  @override
  String workbenchFilesChanged(int count) {
    return 'تم تغيير $count ملفات';
  }

  @override
  String workbenchOperationsRunning(int count) {
    return 'جارٍ تنفيذ $count عمليات ملفات وأوامر';
  }

  @override
  String workbenchOperationsFailed(int count) {
    return 'فشل بعض من $count عمليات ملفات وأوامر';
  }

  @override
  String workbenchOperationsCompleted(int count) {
    return 'اكتملت $count عمليات ملفات وأوامر';
  }

  @override
  String get workbenchToolCommand => 'تشغيل أمر';

  @override
  String workbenchToolReadFilesSubject(int count, String subject) {
    return 'قراءة $count ملفات: $subject';
  }

  @override
  String workbenchToolReadFiles(int count) {
    return 'قراءة $count ملفات';
  }

  @override
  String workbenchToolReadFileSubject(String subject) {
    return 'قراءة ملف: $subject';
  }

  @override
  String get workbenchToolReadFile => 'قراءة ملف';

  @override
  String workbenchToolChangeFilesSubject(int count, String subject) {
    return 'تغيير $count ملفات: $subject';
  }

  @override
  String workbenchToolChangeFiles(int count) {
    return 'تغيير $count ملفات';
  }

  @override
  String workbenchToolChangeFileSubject(String subject) {
    return 'تغيير ملف: $subject';
  }

  @override
  String get workbenchToolChangeFile => 'تغيير ملف';

  @override
  String workbenchToolCallNamed(String name) {
    return 'استدعاء أداة: $name';
  }

  @override
  String get workbenchToolCall => 'استدعاء أداة';

  @override
  String workbenchToolWebSearchSubject(String subject) {
    return 'البحث في الويب: $subject';
  }

  @override
  String get workbenchToolWebSearch => 'البحث في الويب';

  @override
  String workbenchToolImageViewSubject(String subject) {
    return 'عرض صورة: $subject';
  }

  @override
  String get workbenchToolImageView => 'عرض صورة';

  @override
  String get workbenchToolImageGeneration => 'إنشاء صورة';

  @override
  String get workbenchToolContextCompaction => 'ضغط السياق تلقائيًا';

  @override
  String get workbenchToolWait => 'انتظار المهمة';

  @override
  String get workbenchLocalOperation => 'عملية محلية';

  @override
  String get workbenchDeliverySent => 'تم الإرسال';

  @override
  String get workbenchDeliverySending => 'جارٍ الإرسال';

  @override
  String get workbenchDeliveryFailed => 'فشل الإرسال';

  @override
  String workbenchAssistantRunningElapsed(String agent, String duration) {
    return '$agent قيد التشغيل؛ المدة $duration';
  }

  @override
  String workbenchAssistantRunning(String agent) {
    return '$agent قيد التشغيل';
  }

  @override
  String workbenchAssistantElapsed(String duration) {
    return '· المدة $duration';
  }

  @override
  String get workbenchCloseFilePreview => 'إغلاق معاينة الملف';

  @override
  String workbenchFileReadCompleted(String name) {
    return 'اكتملت قراءة الملف: $name';
  }

  @override
  String workbenchFileReading(String name) {
    return 'جارٍ قراءة الملف: $name';
  }

  @override
  String workbenchFileReadFailed(String message) {
    return 'فشلت قراءة الملف: $message';
  }

  @override
  String get workbenchFilePreviewFailed => 'فشلت معاينة الملف. حاول مجددًا.';

  @override
  String get workbenchFileKindTableText => 'نص جدولي';

  @override
  String get workbenchFileKindLog => 'سجل';

  @override
  String get workbenchFileKindPlainText => 'نص عادي';

  @override
  String get workbenchFileKindCodeOrConfig => 'رمز أو إعدادات';

  @override
  String workbenchAgentsWorking(int count) {
    return '$count وكلاء فرعيين يعملون بالتوازي';
  }

  @override
  String get workbenchAgentWindow => 'نافذة عمل Agent';

  @override
  String get workbenchAgentWindowDescription =>
      'تزامن حالة المهمة ونشاط الأدوات دون عرض التفكير الخاص';

  @override
  String workbenchMoreAgents(int count) {
    return '$count Agents أخرى · مرّر لأسفل للعرض';
  }

  @override
  String workbenchCurrentActivity(String activity) {
    return 'الحالي · $activity';
  }

  @override
  String get workbenchAllAgents => 'كل Agents';

  @override
  String get workbenchActivityTimeline => 'الخط الزمني للنشاط';

  @override
  String workbenchActivityCount(int count) {
    return '$count إدخالات';
  }

  @override
  String get workbenchAgentSyncing => 'جارٍ المزامنة من هذا الكمبيوتر…';

  @override
  String get workbenchNoPublicActivity =>
      'لا يوجد نشاط عام بعد. تتم مزامنة حالة المهمة ونشاط الأدوات فقط، وليس التفكير الخاص للنموذج.';

  @override
  String get workbenchLatestResult => 'أحدث نتيجة';

  @override
  String get workbenchWaitingForTask => 'بانتظار مهمة';

  @override
  String get controllerRestoreFailed =>
      'تعذّرت استعادة الاتصال الآمن. سجّل الدخول أو أعد الاقتران.';

  @override
  String get controllerAuthorizationRevoked =>
      'أُلغي تفويض هذا الهاتف. أعد توصيله.';

  @override
  String get controllerDeviceNotConnected =>
      'هذا الحساب غير متصل بهذا الكمبيوتر. ابدأ الاتصال مجددًا على الكمبيوتر.';

  @override
  String get controllerProjectNameRequired => 'اسم المشروع مطلوب.';

  @override
  String controllerProjectNameTooLong(int maximum) {
    return 'لا يمكن أن يتجاوز اسم المشروع $maximum حرفًا.';
  }

  @override
  String get controllerProjectNameSaveFailed =>
      'تعذّر حفظ اسم المشروع محليًا. حاول مجددًا.';

  @override
  String get controllerProjectNameUpdated => 'تم تحديث اسم المشروع.';

  @override
  String get controllerNewPairingLinkReceived =>
      'تم استلام رابط اتصال جديد. سجّل الخروج من الجهاز الحالي لإعادة الاتصال.';

  @override
  String get controllerPairingLinkRequired =>
      'أدخل رابط اتصال Relayune الظاهر في تطبيق سطح المكتب.';

  @override
  String get controllerPairingDiscoveryFailed =>
      'تعذّر العثور على أجهزة كمبيوتر تنتظر الاتصال. حاول لاحقًا.';

  @override
  String get controllerVerificationResent => 'أُعيد إرسال رسالة التحقق.';

  @override
  String get controllerSetPasswordFirst =>
      'عيّن كلمة مرور من رابط البريد أولًا، ثم عد إلى هنا.';

  @override
  String get controllerNoPendingComputer =>
      'لا يوجد كمبيوتر ينتظر الاتصال. اختر «توصيل عميل جديد» على الكمبيوتر أولًا.';

  @override
  String get controllerSelectComputer => 'اختر الكمبيوتر المراد توصيله.';

  @override
  String get controllerPairingFailed =>
      'فشل الاتصال الآمن. تحقق من رمز الاتصال وحاول مجددًا.';

  @override
  String get controllerHistoryReadFailed => 'تعذّرت قراءة السجل.';

  @override
  String get controllerAgentRefreshFailed =>
      'تعذّر تحديث نشاط هذا الوكيل الفرعي الآن.';

  @override
  String get controllerAttachmentTooLarge =>
      'لا يمكن معاينة الملفات الأكبر من 1 MB حاليًا.';

  @override
  String get controllerAttachmentUnsupported =>
      'لا يمكن معاينة تنسيق الملف هذا حاليًا.';

  @override
  String get controllerAttachmentGone =>
      'انتهت صلاحية الملف أو أُزيل من الكمبيوتر.';

  @override
  String get controllerAttachmentReadFailed => 'تعذّرت قراءة المرفق.';

  @override
  String controllerUploadTooMany(int maximum) {
    return 'يمكن رفع $maximum صور كحد أقصى لكل رسالة.';
  }

  @override
  String get controllerUploadTotalTooLarge =>
      'لا يمكن أن يتجاوز مجموع مرفقات الرسالة 20 MiB.';

  @override
  String get controllerUploadUnsupported =>
      'اختر صور PNG أو JPEG أو WebP أو GIF أو AVIF.';

  @override
  String get controllerSteeringUnsupported =>
      'لا تقبل هذه المهمة تعليمات إضافية. أوقفها أولًا.';

  @override
  String get controllerPreparingAgent =>
      'استلم الكمبيوتر الرسالة · جارٍ تجهيز الوكيل';

  @override
  String get controllerWaitingForAgent => 'بانتظار استلام Agent المحلي';

  @override
  String get controllerWaitingForComputer => 'بانتظار اتصال الكمبيوتر';

  @override
  String get controllerStopSent => 'تم إرسال طلب الإيقاف.';

  @override
  String get controllerApprovalExpired => 'انتهت صلاحية هذه الموافقة.';

  @override
  String get controllerApprovalOffline =>
      'لا يمكن معالجة الموافقات والكمبيوتر غير متصل.';

  @override
  String get controllerApprovalAllowedSent =>
      'تم إرسال السماح؛ بانتظار تأكيد الكمبيوتر.';

  @override
  String get controllerApprovalRejectedSent =>
      'تم إرسال الرفض؛ بانتظار تأكيد الكمبيوتر.';

  @override
  String controllerDelegatedTasks(int count) {
    return 'تم تفويض $count مهام متوازية.';
  }

  @override
  String get controllerSelectProject =>
      'اختر مشروعًا متزامنًا من الشريط الجانبي أولًا.';

  @override
  String get controllerCreateSessionOffline =>
      'الكمبيوتر غير متصل. لا يمكن إنشاء جلسة الآن.';

  @override
  String controllerSessionNameLength(int maximum) {
    return 'يجب أن يتكون اسم الجلسة من 1 إلى $maximum حرفًا.';
  }

  @override
  String get controllerSessionCreationBusy =>
      'لا تزال الجلسة السابقة قيد الإنشاء. انتظر.';

  @override
  String controllerSessionCreating(String name) {
    return 'جارٍ إنشاء «$name»…';
  }

  @override
  String get controllerSessionCreateFailed =>
      'تعذّر إنشاء الجلسة. حاول لاحقًا.';

  @override
  String get controllerDesktopSessionCreateFailed =>
      'تعذّر على تطبيق سطح المكتب إنشاء الجلسة.';

  @override
  String get controllerSessionCreateTimeout =>
      'انتهت مهلة انتظار إنشاء الجلسة. تحقق لاحقًا ولا تنشئ نسخة مكررة.';

  @override
  String controllerSessionCreated(String name) {
    return 'تم إنشاء «$name».';
  }

  @override
  String get controllerCoworkCreateOnDesktop =>
      'أنشئ مهمة Cowork أولًا في Claude Desktop، ثم تحكم بها هنا.';

  @override
  String get controllerDesktopConfigFailed =>
      'تعذّر على تطبيق سطح المكتب تطبيق إعدادات الجلسة.';

  @override
  String get controllerConfigApplied => 'تم تطبيق إعدادات الجلسة.';

  @override
  String get controllerConfigUpdateFailed =>
      'تعذّر تحديث إعدادات الجلسة. حاول لاحقًا.';

  @override
  String get controllerConfigTimeout =>
      'انتهت مهلة تطبيق إعدادات الجلسة. حدّث للتأكيد.';

  @override
  String get controllerInvalidEncryptedEvent =>
      'تعذّر التحقق من حدث مشفّر. تم إيقاف تقدم مؤشر المزامنة.';

  @override
  String get controllerApprovalNeeded => 'بانتظار موافقتك';

  @override
  String get controllerContinuing => 'جارٍ المتابعة';

  @override
  String get controllerApprovalProcessFailed =>
      'تعذّر على الكمبيوتر معالجة هذه الموافقة. حاول مجددًا.';

  @override
  String controllerAgentProcessing(String name) {
    return '$name قيد المعالجة';
  }

  @override
  String get controllerSummarizing => 'جارٍ تلخيص النتائج';

  @override
  String get controllerThinking => 'جارٍ التفكير';

  @override
  String get controllerLocalTaskFailed => 'فشلت المهمة المحلية.';

  @override
  String get controllerInterruptFailed => 'تعذّر إيقاف المهمة الحالية.';

  @override
  String get controllerReplying => 'جارٍ الرد';

  @override
  String get controllerFinishing => 'جارٍ الإنهاء';

  @override
  String get controllerOrganizingFileChanges => 'جارٍ تنظيم تغييرات الملفات';

  @override
  String controllerFilesModified(int count) {
    return 'تم تعديل $count ملفات.';
  }

  @override
  String get controllerUpdatingPlan => 'جارٍ تحديث الخطة';

  @override
  String get controllerMessageQueued =>
      'تم وضع الرسالة في قائمة الانتظار وستُرسل تلقائيًا لاحقًا.';

  @override
  String controllerSessionPersisted(String agent) {
    return 'تم حفظ الجلسة في $agent.';
  }

  @override
  String controllerLocalTool(String label) {
    return 'أداة محلية: $label';
  }

  @override
  String get controllerProcessingLocalResult => 'جارٍ معالجة النتيجة المحلية';

  @override
  String get controllerEncryptedResponseTimeout =>
      'انتهت مهلة انتظار الرد المشفّر من الكمبيوتر.';

  @override
  String get controllerPairingUsedOrExpired =>
      'استُخدم هذا الاتصال من قبل أو انتهت صلاحيته.';

  @override
  String get controllerPairingConfirmationTimeout =>
      'انتهت مهلة تأكيد تطبيق سطح المكتب. ابدأ الاتصال مجددًا.';

  @override
  String get controllerPairingConfirmationFailed =>
      'لم يؤكد الكمبيوتر الاتصال المشفّر. أعد الاتصال.';

  @override
  String get controllerDesktopOffline =>
      'تطبيق سطح المكتب غير متصل بعد. أبقِ Relayune مفتوحًا وحاول مجددًا.';

  @override
  String get workbenchDefault => 'افتراضي';

  @override
  String workbenchAgentToolCount(int count) {
    return '$count أداة';
  }

  @override
  String workbenchAgentTokenCount(String count) {
    return '$count رمز';
  }

  @override
  String get apiErrorNetworkUnavailable =>
      'تعذّر الاتصال بـ Relayune. تحقّق من الشبكة وحاول مجددًا.';

  @override
  String get apiErrorTimeout => 'انتهت مهلة الطلب. حاول مجددًا.';

  @override
  String get apiErrorInvalidResponse =>
      'تلقى Relayune استجابة غير صالحة من الخادم. حاول مجددًا.';

  @override
  String get apiErrorInvalidCredentials =>
      'البريد الإلكتروني أو كلمة المرور غير صحيحة.';

  @override
  String get apiErrorAuthentication =>
      'انتهت صلاحية تسجيل الدخول. سجّل الدخول مجددًا.';

  @override
  String get apiErrorService => 'Relayune غير متاح مؤقتًا. حاول لاحقًا.';

  @override
  String get apiErrorGeneric => 'حدث خطأ ما. حاول مجددًا.';

  @override
  String get controllerFileAccessDenied =>
      'لا يستطيع Relayune على الكمبيوتر قراءة بعض ملفات الجلسات. على Mac، اسمح بالوصول في إعدادات النظام ← الخصوصية والأمان ← الملفات والمجلدات، ثم أعد المحاولة. على الأجهزة الأخرى، تحقق من أذونات الملفات.';

  @override
  String get workbenchImageWaiting => 'بانتظار التحميل';

  @override
  String get workbenchImageLoading => 'جارٍ التحميل';

  @override
  String get feedbackTitle => 'ملاحظات';

  @override
  String get feedbackIntro => 'ما الذي يمكن تحسينه؟';

  @override
  String get feedbackSubtitle => 'شارك فكرة أو أخبرنا بمشكلة.';

  @override
  String get feedbackSuggestion => 'اقتراح';

  @override
  String get feedbackBug => 'الإبلاغ عن خلل';

  @override
  String get feedbackDescription => 'الوصف';

  @override
  String get feedbackSuggestionHint => 'ما الذي تود تحسينه وكيف سيساعدك؟';

  @override
  String get feedbackBugHint => 'ماذا فعلت، وماذا توقعت، وماذا حدث؟';

  @override
  String get feedbackInfo => 'المعلومات المرفقة';

  @override
  String get feedbackPrivacy =>
      'تُرفق معلومات الجهاز. لا تُرفع المحادثات والسجلات تلقائيًا.';

  @override
  String get feedbackVersion => 'إصدار التطبيق';

  @override
  String get feedbackModel => 'طراز الجهاز';

  @override
  String get feedbackSystem => 'نظام التشغيل';

  @override
  String get feedbackUnknown => 'غير متاح';

  @override
  String get feedbackLoading => 'جارٍ قراءة معلومات الجهاز…';

  @override
  String get feedbackSend => 'إرسال الملاحظات';

  @override
  String get feedbackFailed =>
      'تعذر الإرسال. ما كتبته لا يزال هنا. تحقق من الاتصال وحاول مجددًا.';

  @override
  String get feedbackEmpty => 'يرجى كتابة ملاحظاتك أولاً.';

  @override
  String get feedbackSending => 'جارٍ الإرسال…';

  @override
  String get feedbackSubmitNote =>
      'سيُحفظ وصفك وهذه المعلومات للتحقق والتحسين.';

  @override
  String get feedbackSuccess => 'تم استلام ملاحظاتك. شكرًا لمساعدتك.';

  @override
  String get feedbackReference => 'رقم الملاحظات';

  @override
  String get feedbackDone => 'تم';

  @override
  String get workbenchStoppingTask => 'جارٍ الإيقاف…';

  @override
  String get workbenchStopUnconfirmed =>
      'لم يتم تأكيد الإيقاف بعد. حاول مجددًا.';

  @override
  String get workbenchPreparingImages => 'جارٍ تجهيز الصور…';

  @override
  String get workbenchImagePickFailed => 'تعذّر فتح الصور. حاول مجددًا.';

  @override
  String get feedbackImages => 'الصور';

  @override
  String get feedbackOptional => 'اختياري';

  @override
  String get feedbackImageLimit => 'يمكنك إضافة 3 صور كحد أقصى.';

  @override
  String get feedbackImageFailed => 'تعذرت إضافة الصورة. جرّب صورة أخرى.';

  @override
  String get feedbackImagePreview => 'معاينة الصورة';

  @override
  String get feedbackRemoveImage => 'إزالة الصورة';

  @override
  String get feedbackPreparingImages => 'جارٍ تجهيز الصور…';

  @override
  String get feedbackAddImage => 'إضافة صور';

  @override
  String get feedbackImagesHint => 'أضف لقطات شاشة لمساعدتنا على الفهم.';

  @override
  String get feedbackContact => 'بيانات التواصل';

  @override
  String get feedbackEmail => 'البريد الإلكتروني';

  @override
  String get feedbackEmailHint => 'بريد حسابك؛ يمكنك تعديله أو تركه فارغًا';

  @override
  String get feedbackWechat => 'معرّف WeChat';

  @override
  String get feedbackWechatHint => 'أدخل معرّف WeChat';

  @override
  String get feedbackContactHint =>
      'للرد على هذه الملاحظات فقط. كلا الحقلين اختياري.';

  @override
  String get feedbackEmailInvalid => 'أدخل بريدًا صحيحًا أو اتركه فارغًا.';

  @override
  String get deviceAgents => 'الوكلاء';

  @override
  String get deviceAgentReady => 'متصل';

  @override
  String get deviceAgentRunning => 'قيد التشغيل';

  @override
  String get deviceAgentNotInstalled => 'غير مثبت';

  @override
  String get deviceAgentUnavailable => 'غير متاح';

  @override
  String get deviceAgentNotEnabled => 'غير مفعّل';

  @override
  String get deviceAgentUnknown => 'لم يتم الإبلاغ';

  @override
  String get deviceAgentOffline => 'الكمبيوتر غير متصل · آخر حالة مُبلّغ عنها';

  @override
  String get openingTitle => 'بعيدًا، وما زلت متصلًا.';

  @override
  String get openingSubtitle =>
      'تابع عمل الذكاء الاصطناعي على حاسوبك من أي مكان.';

  @override
  String get openingSkip => 'تخطي الحركة';

  @override
  String get deviceQuota => 'حدود الاشتراك';

  @override
  String get quotaFiveHour => '5 ساعات';

  @override
  String get quotaSevenDay => '7 أيام';

  @override
  String quotaUsed(String percent) {
    return 'تم استخدام $percent%';
  }

  @override
  String quotaResets(String time) {
    return 'إعادة التعيين $time';
  }

  @override
  String quotaUpdated(String time) {
    return 'آخر تحديث $time';
  }

  @override
  String get quotaPending => 'لم يتم الإبلاغ بعد';

  @override
  String get quotaExpired => 'بانتظار الحدود الجديدة';

  @override
  String get quotaLimitReached => 'تم بلوغ الحد';

  @override
  String get quotaSnapshot => 'آخر تقرير';

  @override
  String get quotaClaudeHint =>
      'يرسل Claude معلومات الحدود أثناء الجلسات. لا يتم تقدير البيانات غير المتاحة.';

  @override
  String get settingsHapticsTitle => 'استجابة لمسية';

  @override
  String get settingsHapticsSubtitle =>
      'اهتزاز خفيف عند تأكيد الاتصال أو القرار.';

  @override
  String get workbenchBackToLatest => 'العودة إلى الأحدث';

  @override
  String get settingsFontSize => 'حجم الخط';

  @override
  String get settingsFontSizeSmall => 'صغير';

  @override
  String get settingsFontSizeMedium => 'متوسط';

  @override
  String get settingsFontSizeLarge => 'كبير';

  @override
  String get settingsFontSizeSaveFailed =>
      'تم تغيير حجم الخط، ولكن تعذر حفظه. يرجى المحاولة مرة أخرى.';

  @override
  String get workbenchAgentOrderHint => 'المس مطولاً، ثم اسحب لتغيير الترتيب';

  @override
  String get workbenchAgentOrderSaveFailed =>
      'تم تغيير الترتيب، لكن تعذّر حفظه. يُرجى المحاولة مرة أخرى.';

  @override
  String get settingsBuildInfo => 'معلومات الإصدار';

  @override
  String get buildTime => 'وقت البناء';

  @override
  String get buildSourceCommit => 'معرّف تعديل المصدر';

  @override
  String get buildUnrecorded => 'غير مسجل';

  @override
  String get buildUncommitted => 'يتضمن تغييرات غير محفوظة في Git';

  @override
  String get agentTasksTitle => 'المهام الفرعية';

  @override
  String agentTasksCount(int count) {
    return '$count مهام فرعية';
  }

  @override
  String agentTasksViewAll(int count) {
    return 'عرض جميع المهام الفرعية ($count)';
  }

  @override
  String agentTasksRunning(int count) {
    return '$count قيد التشغيل';
  }

  @override
  String agentTasksFinished(int count) {
    return '$count منتهية';
  }

  @override
  String get agentTasksAttention => 'تحتاج إلى انتباهك';

  @override
  String get agentTasksInProgress => 'قيد التنفيذ';

  @override
  String get agentTasksEnded => 'منتهية';

  @override
  String get agentTaskPreparing => 'جارٍ التحضير';

  @override
  String get agentTaskUnknown => 'الحالة في انتظار المزامنة';

  @override
  String get agentTaskCompleted => 'مكتملة';

  @override
  String get agentTaskFailed => 'فشلت';

  @override
  String get agentTaskStopped => 'متوقفة';

  @override
  String get agentTaskAnswer => 'في انتظار إجابتك';

  @override
  String get agentTaskApprove => 'في انتظار موافقتك';

  @override
  String get agentTaskNoResult => 'لم تصل أي نتيجة بعد';

  @override
  String get agentTaskInstructions => 'تعليمات المهمة';

  @override
  String get agentTaskRuntime => 'معلومات التشغيل';

  @override
  String agentTaskParent(String name) {
    return 'من: $name';
  }

  @override
  String agentTaskUpdated(String time) {
    return 'تم التحديث $time';
  }

  @override
  String get agentTaskOffline => 'الكمبيوتر غير متصل · آخر حالة معروفة';

  @override
  String get agentTaskOpenConversation => 'فتح محادثة المهمة الفرعية';

  @override
  String get agentTaskEmpty => 'لا توجد مهام فرعية بعد';

  @override
  String get agentTaskFinishedResult => 'النتيجة';

  @override
  String get liveTaskRunning => 'قيد التنفيذ';

  @override
  String get liveTaskApproval => 'بانتظار الموافقة';

  @override
  String get liveTaskQuestion => 'بانتظار إجابة';

  @override
  String get liveTaskCompleted => 'اكتملت';

  @override
  String get liveTaskFailed => 'فشلت المهمة';

  @override
  String get liveTaskStopped => 'توقفت';

  @override
  String get liveTaskStale => 'تحقق من الحالة';

  @override
  String get liveTaskOpen => 'عرض المهمة';

  @override
  String get liveTaskReview => 'مراجعة';

  @override
  String get liveTaskElapsed => 'الوقت المنقضي';

  @override
  String get liveTaskUpdated => 'آخر مزامنة';

  @override
  String get androidPushDisclosure =>
      'Enable background alerts with JPush and, on supported devices, vivo Push. They process a push identifier, Android ID, device/system and network information for delivery. Task content and encryption keys are not sent to these providers. You can turn alerts off in system settings.';

  @override
  String get controllerSessionUnavailable =>
      'هذه المحادثة غير متاحة على الكمبيوتر المتصل. تأكد من تشغيل Agent ومن أن المحادثة ما زالت موجودة، ثم أعد المحاولة أو ابدأ محادثة جديدة.';

  @override
  String get settingsSidebarAgents => 'وكلاء الشريط الجانبي';

  @override
  String get settingsSidebarAgentsSubtitle =>
      'اختر الوكلاء الذين يظهرون في الشريط الجانبي';

  @override
  String get turnStatusRunning => 'جارٍ العمل';

  @override
  String get turnStatusCompleted => 'اكتملت الجولة';

  @override
  String get turnStatusInterrupted => 'لم تكتمل هذه الجولة';

  @override
  String get turnStatusUnknown => 'سجل النشاط';

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
  String get localWebForward => 'الصفحة التالية';

  @override
  String get localWebAddress => 'عنوان الصفحة';

  @override
  String get localWebLoading => 'جارٍ الاتصال بالكمبيوتر…';

  @override
  String get accountDeletionTitle => 'حذف الحساب';

  @override
  String get accountDeletionBody =>
      'سيُحذف حساب Relayune وأذونات الأجهزة والتفضيلات والملاحظات نهائيًا. ستفقد الأجهزة الوصول وستُحذف مفاتيح التخزين المؤقت لهذا الهاتف. لن تُحذف مشاريع الوكلاء وملفاتهم على الكمبيوتر.';

  @override
  String get accountDeletionPassword => 'تأكيد كلمة المرور';

  @override
  String get accountDeletionConfirm => 'حذف حسابي نهائيًا';

  @override
  String get accountDeletionBusy => 'جارٍ الحذف…';

  @override
  String get accountDeletionWrongPassword =>
      'كلمة المرور غير صحيحة. حاول مجددًا.';

  @override
  String get accountDeletionFailed =>
      'تعذر إكمال الحذف. تحقق من الاتصال وأعد المحاولة. إذا بدأ الحذف، يبقى الوصول الآخر معطلًا حتى يكتمل التنظيف.';

  @override
  String get accountDeletionDone => 'تم حذف حسابك.';

  @override
  String get controllerPendingInputSaveFailed =>
      'تعذر حفظ رسالتك على هذا الهاتف. أفرغ مساحة تخزين وحاول مرة أخرى.';

  @override
  String get workbenchHistoryRequestSending => 'جارٍ إرسال الطلب';

  @override
  String get workbenchHistoryWaitingComputer => 'في انتظار رد الكمبيوتر';

  @override
  String get workbenchHistoryReadingComputer =>
      'جارٍ قراءة سجل الرسائل على الكمبيوتر';

  @override
  String get workbenchHistoryPreparing => 'جارٍ تجهيز الرسائل';

  @override
  String workbenchHistoryElapsed(int seconds) {
    return 'الوقت المنقضي: $seconds ث';
  }

  @override
  String get workbenchHistoryTransferring => 'جارٍ نقل السجل';

  @override
  String workbenchHistorySourceRead(String read, String total) {
    return 'قرأ الكمبيوتر $read / $total';
  }

  @override
  String workbenchHistoryPendingTransfer(String size) {
    return 'حجم الصفحة بانتظار النقل: $size';
  }

  @override
  String workbenchHistoryReceived(String size) {
    return 'تم استلام $size';
  }

  @override
  String workbenchHistoryPendingReceive(String size) {
    return 'بانتظار الاستلام: $size';
  }

  @override
  String get workbenchHistoryReadingCache =>
      'جارٍ قراءة السجل المحفوظ على هذا الهاتف';

  @override
  String get localWebResources => 'موارد الصفحة';

  @override
  String get localWebGettingPage => 'جارٍ جلب صفحة الويب…';

  @override
  String get localWebLoadingPage => 'جارٍ تحميل الصفحة…';

  @override
  String localWebResourceSummary(int completed, int active) {
    return 'تم استلام $completed · $active قيد التنفيذ';
  }

  @override
  String localWebResourceFailures(int count) {
    return 'فشل $count';
  }

  @override
  String get localWebResourceWaiting => 'بانتظار الاستجابة';

  @override
  String get localWebResourceReceiving => 'جارٍ الاستلام';

  @override
  String get localWebResourcePreparing => 'جارٍ التجهيز';

  @override
  String get localWebResourceComplete => 'تم الاستلام';

  @override
  String get localWebResourceFailed => 'فشل';

  @override
  String get localWebResourceCancelled => 'متوقف';

  @override
  String get localWebResourceTransferNote =>
      'يشير التقدم إلى استلام الاستجابة. قد تطلب الصفحة المزيد من الموارد.';

  @override
  String get localWebResourceEmpty =>
      'ستظهر هنا الموارد التي تطلبها هذه الصفحة.';

  @override
  String localWebResourceRecent(int count) {
    return 'عرض أحدث $count موارد';
  }

  @override
  String localWebElapsed(String seconds) {
    return '$seconds ث';
  }

  @override
  String get localWebOpeningTitle => 'صفحة من جهاز الكمبيوتر';

  @override
  String get localWebOpeningHint =>
      'أبقِ الكمبيوتر وخدمة الويب قيد التشغيل. ستظهر الصفحة تلقائيًا.';

  @override
  String get replyBranchLabel => 'إنشاء تفرّع في دردشة جديدة';

  @override
  String get replyBranchSameDirectory => 'استخدام مجلد المشروع الأصلي';

  @override
  String get replyBranchSameDirectoryDescription =>
      'متابعة مشاركة ملفات المشروع';

  @override
  String get replyBranchWorktree => 'إنشاء worktree جديد';

  @override
  String get replyBranchWorktreeDescription =>
      'مجلد مستقل يستند إلى الإيداع الحالي';

  @override
  String get controllerReplyBranchOffline => 'اتصل بالكمبيوتر لإنشاء تفرّع';

  @override
  String get controllerReplyBranchCreating => 'جارٍ إنشاء دردشة جديدة…';

  @override
  String get controllerReplyBranchCreated =>
      'تم إنشاء دردشة متفرّعة باستخدام مجلد المشروع الأصلي.';

  @override
  String get controllerReplyBranchFailed =>
      'تعذّر إنشاء الدردشة الجديدة. حاول مرة أخرى.';

  @override
  String get controllerReplyBranchUnconfirmed =>
      'لم تُؤكَّد نتيجة التفرّع بعد. أبقِ الاتصال وأعد المحاولة للتحقق.';

  @override
  String get controllerReplyBranchUnavailable =>
      'لا يمكن إنشاء تفرّع من هذا الرد. حدّث المحادثة.';

  @override
  String get controllerReplyBranchBusy =>
      'هناك عملية دردشة أخرى قيد التنفيذ. حاول مجددًا بعد قليل.';

  @override
  String get controllerReplyBranchWorktreeFailed =>
      'تعذّر إنشاء worktree. تحقّق من المشروع على الكمبيوتر ثم أعد المحاولة.';

  @override
  String get controllerReplyBranchWorktreeCreated =>
      'تم إنشاء دردشة متفرّعة باستخدام worktree مستقل.';

  @override
  String agentTasksCompletedCount(int count) {
    return '$count مكتملة';
  }

  @override
  String agentTasksStoppedCount(int count) {
    return '$count متوقفة';
  }

  @override
  String agentTasksFailedCount(int count) {
    return '$count فاشلة';
  }

  @override
  String agentTasksPreparingCount(int count) {
    return '$count قيد التحضير';
  }

  @override
  String agentTasksUnknownCount(int count) {
    return '$count بانتظار المزامنة';
  }

  @override
  String get agentTasksSearch => 'البحث عن المهام أو الأسماء أو النماذج';

  @override
  String get agentTasksNoMatches => 'لا توجد مهام فرعية مطابقة';

  @override
  String get agentTaskModelConfiguration => 'إعدادات النموذج';
}
