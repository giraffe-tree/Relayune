// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Indonesian (`id`).
class AppLocalizationsId extends AppLocalizations {
  AppLocalizationsId([String locale = 'id']) : super(locale);

  @override
  String get workbenchStateAnswered => 'Sudah dijawab';

  @override
  String get workbenchTurnIncomplete => 'Proses ini belum selesai';

  @override
  String get controllerQueueUnconfirmed =>
      'Status pemrosesan pesan belum dikonfirmasi. Muat ulang percakapan.';

  @override
  String get homeGreetingMorning => 'Selamat pagi';

  @override
  String get homeGreetingNoon => 'Selamat siang';

  @override
  String get homeGreetingAfternoon => 'Selamat sore';

  @override
  String get homeGreetingEvening => 'Selamat malam';

  @override
  String get homeGreetingNight => 'Sudah larut';

  @override
  String get homeCareLongBreak =>
      'Sudah lama fokus. Boleh istirahat lebih lama kalau mau.';

  @override
  String get homeCarePause =>
      'Minum air, pandang kejauhan. Sejenak untuk dirimu.';

  @override
  String get homeCareNightWorking =>
      'Kalau masih bekerja, sisakan waktu istirahat malam ini.';

  @override
  String get homeCareNightQuiet =>
      'Tidak apa-apa menyisakan sedikit untuk besok.';

  @override
  String get homeCareBusyDay =>
      'Hari ini sudah cukup lama di sini. Sisakan waktu untuk dirimu.';

  @override
  String get homeCareDecision => 'Pikirkan dulu, putuskan sesuai ritmemu.';

  @override
  String get homeCareLongWait =>
      'Penantian agak lama. Sempatkan juga merawat diri.';

  @override
  String get homeCareWelcomeBack =>
      'Selamat datang kembali. Lanjutkan dengan ritmemu.';

  @override
  String get homeCareFirstIdea => 'Mulai dari satu ide, kapan pun kamu siap.';

  @override
  String get homeCareMeal => 'Belum makan? Luangkan waktu untuk makan dulu.';

  @override
  String get homeCareEasterEgg =>
      'Pencapaian rahasia: merawat diri, tanpa bilah progres.';

  @override
  String get homeCareWeekend =>
      'Akhir pekan sesuai ritmemu, dengan ruang untuk bersantai.';

  @override
  String get homeCareDailyProgress =>
      'Semoga ada kemajuan dan sedikit ketenangan hari ini.';

  @override
  String get homeCareDailySpace => 'Ide butuh ruang. Kamu juga.';

  @override
  String get homeCareDailyPace => 'Satu per satu, sisakan ruang untuk dirimu.';

  @override
  String get workbenchReturnHome => 'Kembali ke beranda';

  @override
  String get workbenchVisualization => 'Visualisasi';

  @override
  String get workbenchVisualizationUnavailable =>
      'Visualisasi ini belum tersedia.';

  @override
  String get workbenchDesktopVersionUnknown => 'Versi tidak diketahui';

  @override
  String get appTitle => 'Relayune';

  @override
  String get commonBack => 'Kembali';

  @override
  String get commonCancel => 'Batal';

  @override
  String get commonClose => 'Tutup';

  @override
  String get commonContinue => 'Lanjutkan';

  @override
  String get commonRetry => 'Coba lagi';

  @override
  String get commonSave => 'Simpan';

  @override
  String get commonSubmit => 'Kirim';

  @override
  String get commonSettings => 'Setelan';

  @override
  String get commonLogOut => 'Keluar';

  @override
  String get commonReject => 'Tolak';

  @override
  String get commonAllow => 'Izinkan';

  @override
  String get unavailableTitle => 'Relayune sementara tidak tersedia';

  @override
  String get clearLoginSession => 'Hapus sesi masuk';

  @override
  String get updateInstallerUnavailable =>
      'Tidak dapat membuka penginstal sistem. Coba lagi nanti.';

  @override
  String get updateReadyTitle => 'Pembaruan siap';

  @override
  String updateDownloaded(String version) {
    return 'Relayune $version telah diunduh dan diverifikasi dengan aman di latar belakang.';
  }

  @override
  String get updateLater => 'Nanti';

  @override
  String get updateInstall => 'Instal pembaruan';

  @override
  String get authSecurityBadge => 'Ruang kerja terenkripsi end-to-end';

  @override
  String get authEmailTitle => 'Lanjutkan tugas komputer dari ponsel';

  @override
  String get authPasswordTitle => 'Masuk atau buat akun';

  @override
  String get authVerificationTitle => 'Periksa email Anda';

  @override
  String get authEmailSubtitle =>
      'Setelah masuk, gunakan kode 8 karakter di desktop untuk membuat koneksi terenkripsi end-to-end.';

  @override
  String get authPasswordSubtitle =>
      'Masuk dengan kata sandi, atau verifikasi email terlebih dahulu jika baru pertama kali.';

  @override
  String get authVerificationSubtitle =>
      'Tautan verifikasi hanya dapat digunakan sekali dan segera kedaluwarsa.';

  @override
  String get authEmailLabel => 'Email';

  @override
  String get authInvalidEmail => 'Masukkan alamat email yang valid.';

  @override
  String get authContinue => 'Lanjutkan';

  @override
  String get authChangeEmail => 'Ganti email';

  @override
  String get authPasswordLabel => 'Kata sandi';

  @override
  String get authShowPassword => 'Tampilkan kata sandi';

  @override
  String get authHidePassword => 'Sembunyikan kata sandi';

  @override
  String get authPasswordRequired => 'Masukkan kata sandi.';

  @override
  String get authSignIn => 'Masuk';

  @override
  String get authVerifyEmailAction =>
      'Baru pertama kali atau lupa kata sandi? Verifikasi email';

  @override
  String get authVerificationInstructions =>
      'Buka email verifikasi dan atur kata sandi di halaman aman, lalu kembali ke sini.';

  @override
  String get authPasswordSet => 'Kata sandi sudah diatur';

  @override
  String get authResendEmail => 'Kirim ulang email';

  @override
  String get authSecurityNote =>
      'Server hanya meneruskan teks sandi. Kode koneksi dan kunci konten tidak pernah diunggah.';

  @override
  String get pairingExit => 'Keluar';

  @override
  String get pairingTitle => 'Pindai untuk menghubungkan komputer';

  @override
  String get pairingSubtitle => 'Bawa pekerjaan Anda ke mana saja.';

  @override
  String get pairingEnterCodeTitle => 'Atau masukkan kode 8 karakter';

  @override
  String get pairingEnterCodeHelp =>
      'Masukkan kode yang ditampilkan di komputer.';

  @override
  String get pairingSearching => 'Mencari komputer yang menunggu dihubungkan…';

  @override
  String get pairingComputerLabel => 'Komputer yang dihubungkan';

  @override
  String pairingWillConnect(String device) {
    return 'Menghubungkan ke: $device';
  }

  @override
  String get pairingStartOnDesktop =>
      'Pilih “Hubungkan klien baru” di desktop, lalu masukkan kode baru.';

  @override
  String get pairingSearchAgain => 'Cari lagi';

  @override
  String get pairingCodeLabel => 'Kode koneksi 8 karakter';

  @override
  String get pairingSecureConnect => 'Hubungkan dengan aman';

  @override
  String get pairingScanTitle => 'Di mana kode QR-nya?';

  @override
  String get pairingScanHelp =>
      'Buka Relayune di komputer dan pilih “Hubungkan klien baru”.\nPindai kode QR di jendela tersebut.';

  @override
  String get pairingOpenCamera => 'Pindai untuk terhubung';

  @override
  String get pairingPrivacyNote =>
      'Terenkripsi menyeluruh. Hanya perangkat Anda yang dapat membaca sesi.';

  @override
  String pairingMinimumDesktop(String version) {
    return 'Versi desktop minimum: $version';
  }

  @override
  String get pairingDeriving => 'Memverifikasi koneksi…';

  @override
  String get pairingWaitingDesktop => 'Menunggu konfirmasi komputer…';

  @override
  String get pairingActivating => 'Membuat saluran terenkripsi…';

  @override
  String get pairingDerivingDetail =>
      'Membuat share SPAKE2 dan kunci konten independen di perangkat ini.';

  @override
  String get pairingWaitingDesktopDetail =>
      'Biarkan Relayune tetap terbuka di komputer.';

  @override
  String get pairingActivatingDetail =>
      'Memverifikasi katalog sesi terenkripsi pertama.';

  @override
  String get scannerTitle => 'Pindai QR koneksi di komputer';

  @override
  String get scannerResume => 'Lanjutkan pemindaian';

  @override
  String get scannerInvalid =>
      'Ini bukan QR koneksi Relayune. Pindai kode terbaru dari desktop.';

  @override
  String get scannerHelp =>
      'Letakkan QR yang ditampilkan Relayune di komputer ke dalam bingkai.';

  @override
  String get scannerUnavailable =>
      'Kamera tidak tersedia. Izinkan Relayune memakai kamera di setelan sistem atau hubungkan secara manual.';

  @override
  String get settingsTitle => 'Setelan';

  @override
  String get settingsSignedInAccount => 'Akun yang masuk';

  @override
  String get settingsAccountSection => 'Akun';

  @override
  String get settingsPreferencesSection => 'Preferensi';

  @override
  String get settingsHelpLegalSection => 'Dukungan & hukum';

  @override
  String get settingsLanguage => 'Bahasa';

  @override
  String get settingsLanguageSystemDefault => 'Default (bahasa sistem)';

  @override
  String settingsLanguageSystemDefaultValue(String language) {
    return 'Default · $language';
  }

  @override
  String get settingsLanguageSaveFailed =>
      'Bahasa berubah, tetapi preferensi tidak dapat disimpan.';

  @override
  String get settingsReleaseNotes => 'Catatan rilis';

  @override
  String get settingsSupport => 'Dukungan';

  @override
  String get settingsTerms => 'Ketentuan Layanan';

  @override
  String get settingsPrivacy => 'Kebijakan Privasi';

  @override
  String get settingsLegalLanguage => 'Bahasa Indonesia';

  @override
  String get settingsOpenLinkFailed => 'Tidak dapat membuka tautan ini.';

  @override
  String get releaseTitle => 'Catatan rilis';

  @override
  String get releaseLoading => 'Memuat catatan rilis';

  @override
  String get releaseErrorTitle => 'Catatan rilis tidak tersedia';

  @override
  String get releaseErrorMessage => 'Periksa koneksi lalu coba lagi.';

  @override
  String get releaseEmptyTitle => 'Belum ada catatan rilis';

  @override
  String get releaseEmptyMessage => 'Pembaruan berikutnya akan muncul di sini.';

  @override
  String get releaseVersion => 'Versi';

  @override
  String get releaseWeb => 'Web';

  @override
  String get releaseServer => 'Server';

  @override
  String get notificationEnabledTitle => 'Notifikasi tugas aktif';

  @override
  String get notificationPrimerTitle =>
      'Tugas berjalan di komputer, jadi Anda tidak perlu terus melihat';

  @override
  String get notificationEnabledBody =>
      'Relayune memberi tahu saat tugas memerlukan perhatian atau selesai.';

  @override
  String get notificationPrimerBody =>
      'Tangani persetujuan dan pertanyaan, lalu lihat ringkasan setelah selesai.';

  @override
  String get notificationBenefitAction =>
      'Perlu perhatian: izinkan, tolak, atau buka jawaban dari notifikasi';

  @override
  String get notificationBenefitCompletion =>
      'Tugas selesai: lihat ringkasan sebelum membuka';

  @override
  String get notificationBenefitPrivacy =>
      'Notifikasi tidak pernah menampilkan perintah, jalur, kode, atau kunci';

  @override
  String get notificationPermissionRejected =>
      'Notifikasi sistem masih mati. Anda dapat mengizinkannya di setelan.';

  @override
  String get notificationGotIt => 'Mengerti';

  @override
  String get notificationOpenSettings => 'Buka setelan sistem';

  @override
  String get notificationEnable => 'Aktifkan notifikasi';

  @override
  String get notificationNotNow => 'Jangan sekarang';

  @override
  String get notificationSemanticsExample =>
      'Contoh notifikasi: persetujuan perlu perhatian, pertanyaan perlu jawaban, dan tugas Claude selesai dengan ringkasan';

  @override
  String get notificationNow => 'Sekarang';

  @override
  String get notificationSampleTask => 'Tingkatkan notifikasi seluler';

  @override
  String get notificationSampleBody =>
      'Panduan izin notifikasi dan ringkasan penyelesaian tugas sudah siap…';

  @override
  String get notificationApprovalTitle => 'Operasi menunggu konfirmasi';

  @override
  String get notificationQuestionTitle => 'Jawaban Anda diperlukan';

  @override
  String notificationTaskPaused(String provider) {
    return '$provider · tugas dijeda';
  }

  @override
  String notificationApprovalBody(int minutes) {
    return 'Izinkan atau tolak operasi ini dalam $minutes menit.';
  }

  @override
  String notificationQuestionBody(int minutes) {
    return 'Jawab dalam $minutes menit. Tugas akan berlanjut.';
  }

  @override
  String notificationTaskCompleted(String provider) {
    return 'Tugas $provider selesai';
  }

  @override
  String get notificationMainTask => 'Tugas utama';

  @override
  String get notificationMainResultReady =>
      'Hasil tugas utama siap. Ketuk untuk melihat.';

  @override
  String notificationNamedResultReady(String name) {
    return 'Hasil “$name” siap. Ketuk untuk melihat.';
  }

  @override
  String get notificationAllowOnce => 'Izinkan sekali';

  @override
  String get notificationAnswer => 'Jawab';

  @override
  String get notificationChannelAttention => 'Perlu perhatian';

  @override
  String get notificationChannelCompleted => 'Tugas selesai';

  @override
  String get notificationChannelAttentionDescription =>
      'Peringatan persetujuan dan pertanyaan Relayune';

  @override
  String get notificationChannelCompletedDescription =>
      'Peringatan penyelesaian tugas utama Relayune';

  @override
  String get notificationRedactedLink => '[tautan]';

  @override
  String get notificationRedactedPath => '[jalur]';

  @override
  String get notificationRedactedSecret => '[disembunyikan]';

  @override
  String get workbenchTitle => 'Ruang kerja';

  @override
  String get workbenchDevice => 'Perangkat';

  @override
  String get workbenchOpenNavigation => 'Buka navigasi';

  @override
  String workbenchPendingApprovals(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count persetujuan menunggu',
      one: '1 persetujuan menunggu',
    );
    return '$_temp0';
  }

  @override
  String get workbenchSessions => 'Sesi';

  @override
  String get workbenchOnline => 'Online';

  @override
  String get workbenchOffline => 'Offline';

  @override
  String get workbenchDeviceOnlineRealtime =>
      'Komputer online · sinkronisasi real-time';

  @override
  String get workbenchDeviceOfflineQueued =>
      'Komputer offline · hanya rekaman dalam cache';

  @override
  String get workbenchDeviceOnlineReconnecting =>
      'Komputer online · memulihkan koneksi real-time';

  @override
  String get workbenchDeviceOfflineReconnecting =>
      'Komputer offline · memulihkan koneksi real-time';

  @override
  String get workbenchDeviceOnlineWaiting =>
      'Komputer online · menunggu koneksi real-time';

  @override
  String get workbenchDeviceOfflineWaiting =>
      'Komputer offline · menunggu koneksi real-time';

  @override
  String get workbenchProjectsSessions => 'Proyek & sesi';

  @override
  String get workbenchNoSessionsSynced =>
      'Belum ada sesi yang disinkronkan dari komputer';

  @override
  String get workbenchSignedInAccount => 'Akun yang masuk';

  @override
  String get workbenchNotSignedIn => 'Belum masuk';

  @override
  String get workbenchNewSession => 'Sesi baru';

  @override
  String get workbenchDefaultSessionName => 'Sesi jarak jauh baru';

  @override
  String get workbenchHistoryFailed =>
      'Riwayat tidak dapat dimuat; konten saat ini mungkin tidak lengkap';

  @override
  String get workbenchLoadEarlier => 'Muat pesan sebelumnya';

  @override
  String get workbenchSendFirst => 'Kirim instruksi pertama untuk memulai';

  @override
  String get workbenchAtBeginning => 'Ini pesan pertama';

  @override
  String get workbenchAddAttachment => 'Tambah lampiran';

  @override
  String workbenchRemoveAttachment(String name) {
    return 'Hapus $name';
  }

  @override
  String get workbenchReadOnly => 'Sesi ini hanya-baca';

  @override
  String get workbenchOfflineQueued =>
      'Komputer offline · pengiriman tidak tersedia';

  @override
  String get workbenchSteerPlaceholder =>
      'Kirim instruksi baru untuk berhenti lalu lanjut…';

  @override
  String get workbenchSendPlaceholder => 'Kirim instruksi ke komputer…';

  @override
  String get workbenchStopTask => 'Hentikan tugas';

  @override
  String get workbenchSending => 'Mengirim';

  @override
  String get workbenchSend => 'Kirim';

  @override
  String get workbenchYou => 'Anda';

  @override
  String get workbenchLocalActivity => 'Aktivitas lokal';

  @override
  String get workbenchToday => 'Hari ini';

  @override
  String get workbenchYesterday => 'Kemarin';

  @override
  String get workbenchDayBeforeYesterday => 'Kemarin lusa';

  @override
  String get workbenchSystemNotice => 'Pemberitahuan sistem';

  @override
  String workbenchApprovalSource(String name) {
    return 'Sumber: $name';
  }

  @override
  String workbenchApprovalDirectory(String path) {
    return 'Direktori: $path';
  }

  @override
  String get workbenchApprovalPermission => 'Izin yang diminta';

  @override
  String get workbenchSelect => 'Pilih';

  @override
  String get workbenchOtherAnswer => 'Jawaban lain…';

  @override
  String get workbenchSkipAnswer => 'Jangan sekarang';

  @override
  String get workbenchHighRiskTitle => 'Izinkan operasi berisiko tinggi?';

  @override
  String get workbenchOperationOnComputer =>
      'Operasi ini akan dijalankan di komputer Anda.';

  @override
  String get workbenchConfirmAllow => 'Konfirmasi dan izinkan';

  @override
  String get workbenchAnswerLabel => 'Jawaban';

  @override
  String get workbenchAllowOnce => 'Izinkan sekali';

  @override
  String get workbenchAlwaysAllowSession => 'Selalu izinkan dalam sesi ini';

  @override
  String get workbenchAllowAndRemember => 'Izinkan dan ingat';

  @override
  String get workbenchAlwaysRejectSession => 'Selalu tolak dalam sesi ini';

  @override
  String get workbenchRejectAndRemember => 'Tolak dan ingat';

  @override
  String get workbenchSaveDecisionTitle => 'Ingat keputusan ini?';

  @override
  String get workbenchSaveDecisionMessage =>
      'Relayune akan menerapkan pilihan ini secara otomatis hanya pada operasi serupa dalam sesi saat ini.';

  @override
  String get workbenchConfirm => 'Konfirmasi';

  @override
  String get workbenchRejectAndStop => 'Tolak dan hentikan tugas';

  @override
  String get workbenchNotificationSettings => 'Notifikasi tugas';

  @override
  String get workbenchConnectAnother => 'Hubungkan komputer lain';

  @override
  String get workbenchConnectAnotherSubtitle =>
      'Hapus kunci konten dan otorisasi perangkat saat ini dari ponsel';

  @override
  String get workbenchConnectAnotherTitle => 'Hubungkan komputer lain?';

  @override
  String get workbenchConnectAnotherMessage =>
      'Kunci konten dan token otorisasi ponsel saat ini akan dihapus dari penyimpanan kredensial aman perangkat ini. Data di server dan komputer tidak akan dihapus.';

  @override
  String get workbenchNoSessions => 'Tidak ada sesi tersedia';

  @override
  String get workbenchNoSessionsHelp =>
      'Biarkan desktop online, atau buat sesi baru di direktori proyek pada komputer.';

  @override
  String get workbenchHistoryLoading => 'Memuat riwayat pesan';

  @override
  String get workbenchHistoryLoadingOlder => 'Memuat pesan sebelumnya…';

  @override
  String get workbenchHistoryLimit =>
      'Riwayat dimuat setelah sesi dibuka, maksimal 500 pesan setiap kali';

  @override
  String get workbenchFilePreviewRetry => 'Pratinjau file gagal. Coba lagi.';

  @override
  String get workbenchSecureFileReading => 'Membaca dengan aman dari komputer…';

  @override
  String get workbenchFileUnavailable =>
      'File kedaluwarsa atau dihapus dari komputer.';

  @override
  String get workbenchApprovalCommand => 'Jalankan perintah';

  @override
  String get workbenchApprovalFileChange => 'Ubah file';

  @override
  String get workbenchApprovalChoice => 'Pilihan Anda diperlukan';

  @override
  String get workbenchApprovalTool => 'Jalankan alat lokal';

  @override
  String get workbenchStatePending => 'Menunggu';

  @override
  String get workbenchStateDeciding => 'Mengirim';

  @override
  String get workbenchStateApproved => 'Disetujui';

  @override
  String get workbenchStateRejected => 'Ditolak';

  @override
  String get workbenchStateExpired => 'Kedaluwarsa';

  @override
  String get workbenchLocalRelay => 'Relay lokal';

  @override
  String get workbenchEncryptionProtocol => 'Protokol enkripsi';

  @override
  String get workbenchPairingProtocol => 'Protokol pemasangan';

  @override
  String get workbenchRealtimeChannel => 'Kanal real-time';

  @override
  String get workbenchTechnicalDetails => 'Detail teknis';

  @override
  String get workbenchRealtimeConnection => 'Koneksi real-time';

  @override
  String get workbenchHeartbeatPath => 'iPhone ↔ Server · WebSocket';

  @override
  String get workbenchHeartbeatHealthy => 'Heartbeat stabil';

  @override
  String get workbenchHeartbeatWaiting => 'Menunggu heartbeat pertama';

  @override
  String get workbenchLastHeartbeat => 'Heartbeat terakhir';

  @override
  String get workbenchRoundTrip => 'Pulang-pergi';

  @override
  String get workbenchWebSocketHeartbeat => 'Heartbeat WebSocket';

  @override
  String get workbenchDesktopHeartbeat => 'Heartbeat komputer';

  @override
  String get workbenchJustNow => 'Baru saja';

  @override
  String workbenchSecondsAgo(int seconds) {
    return '$seconds dtk lalu';
  }

  @override
  String workbenchMinutesAgo(int minutes) {
    return '$minutes mnt lalu';
  }

  @override
  String get workbenchStateVersion => 'Versi status';

  @override
  String get workbenchAwaitingConfirmation => 'Menunggu konfirmasi';

  @override
  String get workbenchLastConfirmed => 'Terakhir dikonfirmasi';

  @override
  String get workbenchEventAck => 'Konfirmasi peristiwa';

  @override
  String get workbenchOfflineQueue => 'Antrean offline';

  @override
  String get workbenchSecurityBoundary => 'Batas enkripsi ujung-ke-ujung';

  @override
  String get workbenchPhonePlaintextEndpoint =>
      'Ponsel adalah titik akhir teks biasa aplikasi';

  @override
  String get workbenchServerCiphertextOnly =>
      'Server hanya menyimpan amplop ciphertext terautentikasi';

  @override
  String get workbenchKeyInSecureStorage =>
      'Kunci konten disimpan di penyimpanan kredensial aman sistem';

  @override
  String get workbenchCodeNeverUploaded =>
      'Kode koneksi 8 karakter tidak pernah diunggah';

  @override
  String get workbenchNotConfirmed => 'Belum dikonfirmasi';

  @override
  String get workbenchRealtimeConnected => 'WebSocket terhubung';

  @override
  String get workbenchRealtimeConnecting => 'Menghubungkan';

  @override
  String get workbenchRealtimeReconnecting => 'Menghubungkan kembali';

  @override
  String get workbenchRealtimeIdle => 'Menunggu koneksi';

  @override
  String workbenchNotificationStatus(String status) {
    return '$status · notifikasi berfungsi selama koneksi latar belakang aplikasi tetap aktif; pengiriman tidak dijamin setelah sistem menghentikan aplikasi';
  }

  @override
  String get workbenchNotificationAllowed => 'Diizinkan';

  @override
  String get workbenchNotificationDisabled => 'Mati';

  @override
  String get workbenchNotificationUnknown => 'Tidak diketahui';

  @override
  String get workbenchClose => 'Tutup';

  @override
  String get workbenchProjectConfiguration => 'Setelan proyek';

  @override
  String get workbenchProjectConfigurationTitle => 'Setelan proyek';

  @override
  String get workbenchProjectName => 'Nama proyek';

  @override
  String get workbenchProjectNameHelp =>
      'Ini hanya mengubah nama di aplikasi, bukan nama folder di komputer.';

  @override
  String get workbenchFullPath => 'Jalur lengkap';

  @override
  String get workbenchProjectPathUnavailable =>
      'Komputer tidak memberikan jalur proyek';

  @override
  String workbenchSessionCount(int count) {
    return '$count sesi';
  }

  @override
  String workbenchMoreSessions(int count) {
    return 'Tampilkan sesi lainnya ($count)';
  }

  @override
  String get workbenchAgentRunning => 'Agent berjalan';

  @override
  String get workbenchAgentNotRunning => 'Agent tidak berjalan';

  @override
  String get workbenchRunning => 'Berjalan';

  @override
  String get workbenchKimiSettings => 'Setelan Kimi';

  @override
  String get workbenchEnableYoloTitle => 'Aktifkan mode YOLO?';

  @override
  String get workbenchEnableAutoTitle => 'Aktifkan mode Auto?';

  @override
  String get workbenchYoloWarning =>
      'Kimi akan menyetujui lebih banyak panggilan alat lokal secara otomatis. Aktifkan hanya untuk tugas dan proyek tepercaya.';

  @override
  String get workbenchAutoWarning =>
      'Kimi akan menyetujui panggilan alat rutin, tetapi mungkin tetap bertanya.';

  @override
  String get workbenchConfirmEnable => 'Konfirmasi dan aktifkan';

  @override
  String get workbenchUploadTooManyImages =>
      'Anda dapat menambahkan hingga 4 gambar per pesan.';

  @override
  String workbenchUploadUnsupportedImages(String names) {
    return '$names tidak didukung. Pilih PNG, JPEG, WebP, GIF, atau AVIF.';
  }

  @override
  String get workbenchUploadTooLarge =>
      'Total lampiran dalam satu pesan tidak boleh melebihi 20 MiB.';

  @override
  String workbenchPreviewGenerateFailed(String name) {
    return 'Pratinjau $name tidak dapat dibaca atau dibuat. Coba lagi.';
  }

  @override
  String get workbenchKimiViewAgents => 'Lihat sub-Agent';

  @override
  String get workbenchKimiViewAgentsDescription =>
      'Buka jendela kerja Agent di atas kolom pesan tanpa memulai tugas model baru.';

  @override
  String get workbenchKimiOpenNow => 'Buka sekarang';

  @override
  String get workbenchKimiSessionStatus => 'Status sesi';

  @override
  String get workbenchKimiSessionStatusDescription =>
      'Lihat tugas, persetujuan, konteks, dan status sinkronisasi lokal.';

  @override
  String get workbenchKimiLocalStatus => 'Status lokal';

  @override
  String get workbenchKimiModel => 'Model';

  @override
  String get workbenchKimiModelDescription =>
      'Ubah model yang dipakai sesi Kimi ini.';

  @override
  String get workbenchKimiSessionSettings => 'Setelan sesi';

  @override
  String get workbenchKimiPermissionMode => 'Mode izin';

  @override
  String get workbenchKimiPermissionModeDescription =>
      'Lihat atau ubah kebijakan persetujuan alat lokal.';

  @override
  String get workbenchKimiSecuritySettings => 'Setelan keamanan';

  @override
  String get workbenchKimiPlanMode => 'Mode Plan';

  @override
  String get workbenchKimiPlanModeDescription =>
      'Minta Kimi merencanakan sebelum menjalankan tugas.';

  @override
  String get workbenchKimiYoloMode => 'Mode YOLO';

  @override
  String get workbenchKimiYoloModeDescription =>
      'Setujui lebih banyak panggilan alat secara otomatis; konfirmasi diperlukan sebelum mengaktifkan.';

  @override
  String get workbenchKimiConfirmationRequired => 'Perlu konfirmasi';

  @override
  String get workbenchKimiSettingsDescription =>
      'Buka setelan model, Thinking, dan izin.';

  @override
  String workbenchKimiInputRequired(String hint) {
    return 'Input diperlukan: $hint';
  }

  @override
  String get workbenchKimiNativeCommandDescription =>
      'Perintah asli Kimi ACP yang dijalankan sebagai tugas perintah nyata.';

  @override
  String get workbenchKimiNativeCommand => 'Perintah asli';

  @override
  String get workbenchKimiContextSyncing => 'Konteks menunggu sinkronisasi';

  @override
  String get workbenchKimiWaitingForSync => 'Menunggu sinkronisasi';

  @override
  String workbenchKimiContextUsage(int percent, String used, String size) {
    return 'Konteks $percent% · $used/$size';
  }

  @override
  String workbenchKimiContextUsed(String used) {
    return 'Konteks $used';
  }

  @override
  String get workbenchKimiContext => 'Konteks';

  @override
  String get workbenchKimiModelSyncing => 'Model menunggu sinkronisasi';

  @override
  String get workbenchKimiQuickCommands => 'Perintah cepat';

  @override
  String get workbenchKimiNoMatchingCommands => 'Tidak ada perintah yang cocok';

  @override
  String get workbenchKimiTask => 'Tugas';

  @override
  String get workbenchKimiIdle => 'Tidak aktif';

  @override
  String get workbenchKimiSubagents => 'Sub-Agent';

  @override
  String workbenchKimiActiveCount(int count) {
    return '$count aktif';
  }

  @override
  String get workbenchKimiApprovals => 'Persetujuan';

  @override
  String workbenchKimiPendingCount(int count) {
    return '$count tertunda';
  }

  @override
  String get workbenchKimiSettingsOffline =>
      'Setelan Kimi tidak dapat diubah saat Relay offline.';

  @override
  String get workbenchKimiSettingsRunning =>
      'Hentikan tugas utama Kimi sebelum mengubah setelan.';

  @override
  String get workbenchKimiNoOptions =>
      'Komputer belum menyinkronkan opsi yang dapat dikonfigurasi.';

  @override
  String get workbenchKimiEncryptedSettings =>
      'Setelan dikirim dengan enkripsi menyeluruh ke Kimi Code di komputer Anda. Server tidak dapat membacanya.';

  @override
  String get workbenchKimiManualApproval => 'Persetujuan manual';

  @override
  String get workbenchSessionSettings => 'Setelan sesi';

  @override
  String get workbenchSessionSettingsOffline =>
      'Setelan sesi tidak dapat diubah saat Relay offline.';

  @override
  String get workbenchSessionSettingsRunning =>
      'Hentikan tugas saat ini sebelum mengubah setelannya.';

  @override
  String get workbenchNoConfigOptions =>
      'Komputer belum menyinkronkan opsi yang dapat dikonfigurasi.';

  @override
  String workbenchEncryptedSessionSettings(String provider) {
    return 'Setelan dikirim dengan enkripsi menyeluruh ke $provider di komputer Anda. Server tidak dapat membacanya.';
  }

  @override
  String get workbenchUnrestrictedPermissionsTitle => 'Ubah mode izin?';

  @override
  String get workbenchUnrestrictedPermissionsWarning =>
      'Ini mengubah apakah alat lokal diizinkan, ditolak, atau memerlukan persetujuan. Tinjau mode yang dipilih sebelum melanjutkan.';

  @override
  String get workbenchCoworkCreateOnDesktop =>
      'Buat tugas Cowork di Claude Desktop terlebih dahulu; tugas yang ada dapat dikontrol di sini.';

  @override
  String get workbenchProcessing => 'Memproses';

  @override
  String get workbenchProcess => 'Proses';

  @override
  String workbenchDurationMinutesSeconds(int minutes, int seconds) {
    return '$minutes mnt $seconds dtk';
  }

  @override
  String workbenchDurationSeconds(int seconds) {
    return '$seconds dtk';
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
  String get workbenchImageUrlUnavailable => 'Alamat gambar tidak tersedia.';

  @override
  String workbenchFilePreviewAvailable(String kind) {
    return 'Dapat dipratinjau · $kind · hingga 1 MB';
  }

  @override
  String get workbenchFilePreviewUnsupported =>
      'Format file ini tidak dapat dipratinjau';

  @override
  String workbenchImageReadFailed(String name) {
    return '$name\nGambar tidak dapat dibaca';
  }

  @override
  String workbenchImageThumbnailLabel(String name) {
    return 'Gambar mini $name; ketuk untuk membuka pratinjau';
  }

  @override
  String get workbenchViewOriginal => 'Lihat gambar asli';

  @override
  String get workbenchLoadingOriginal => 'Memuat gambar asli dengan aman…';

  @override
  String get workbenchOriginalReadFailed =>
      'Gambar asli tidak dapat dibaca. Coba lagi.';

  @override
  String workbenchActivityFailed(String label) {
    return '$label gagal';
  }

  @override
  String workbenchActivityCompleted(String label) {
    return '$label selesai';
  }

  @override
  String workbenchActivityRunning(String label) {
    return 'Menjalankan $label';
  }

  @override
  String get workbenchViewOutput => 'Ketuk untuk melihat keluaran';

  @override
  String get workbenchViewThumbnail => 'Ketuk untuk melihat gambar mini';

  @override
  String get workbenchSemanticSeparator => ', ';

  @override
  String workbenchCommandsRunning(int count) {
    return 'Menjalankan $count perintah';
  }

  @override
  String workbenchCommandsFailed(int count) {
    return 'Beberapa dari $count perintah gagal';
  }

  @override
  String workbenchCommandsCompleted(int count) {
    return 'Menjalankan $count perintah';
  }

  @override
  String workbenchFilesReading(int count) {
    return 'Membaca $count file';
  }

  @override
  String workbenchFilesReadFailed(int count) {
    return 'Beberapa dari $count file tidak dapat dibaca';
  }

  @override
  String workbenchFilesRead(int count) {
    return 'Membaca $count file';
  }

  @override
  String workbenchFilesChanging(int count) {
    return 'Mengubah $count file';
  }

  @override
  String workbenchFilesChangeFailed(int count) {
    return 'Beberapa perubahan pada $count file gagal';
  }

  @override
  String workbenchFilesChanged(int count) {
    return 'Mengubah $count file';
  }

  @override
  String workbenchOperationsRunning(int count) {
    return 'Memproses $count operasi file dan perintah';
  }

  @override
  String workbenchOperationsFailed(int count) {
    return 'Beberapa dari $count operasi file dan perintah gagal';
  }

  @override
  String workbenchOperationsCompleted(int count) {
    return 'Menyelesaikan $count operasi file dan perintah';
  }

  @override
  String get workbenchToolCommand => 'Jalankan perintah';

  @override
  String workbenchToolReadFilesSubject(int count, String subject) {
    return 'Baca $count file: $subject';
  }

  @override
  String workbenchToolReadFiles(int count) {
    return 'Baca $count file';
  }

  @override
  String workbenchToolReadFileSubject(String subject) {
    return 'Baca file: $subject';
  }

  @override
  String get workbenchToolReadFile => 'Baca file';

  @override
  String workbenchToolChangeFilesSubject(int count, String subject) {
    return 'Ubah $count file: $subject';
  }

  @override
  String workbenchToolChangeFiles(int count) {
    return 'Ubah $count file';
  }

  @override
  String workbenchToolChangeFileSubject(String subject) {
    return 'Ubah file: $subject';
  }

  @override
  String get workbenchToolChangeFile => 'Ubah file';

  @override
  String workbenchToolCallNamed(String name) {
    return 'Panggil alat: $name';
  }

  @override
  String get workbenchToolCall => 'Panggil alat';

  @override
  String workbenchToolWebSearchSubject(String subject) {
    return 'Cari di web: $subject';
  }

  @override
  String get workbenchToolWebSearch => 'Cari di web';

  @override
  String workbenchToolImageViewSubject(String subject) {
    return 'Lihat gambar: $subject';
  }

  @override
  String get workbenchToolImageView => 'Lihat gambar';

  @override
  String get workbenchToolImageGeneration => 'Buat gambar';

  @override
  String get workbenchToolContextCompaction => 'Padatkan konteks otomatis';

  @override
  String get workbenchToolWait => 'Tunggu tugas';

  @override
  String get workbenchLocalOperation => 'Operasi lokal';

  @override
  String get workbenchDeliverySent => 'Terkirim';

  @override
  String get workbenchDeliverySending => 'Mengirim';

  @override
  String get workbenchDeliveryFailed => 'Gagal mengirim';

  @override
  String workbenchAssistantRunningElapsed(String agent, String duration) {
    return '$agent sedang berjalan; durasi $duration';
  }

  @override
  String workbenchAssistantRunning(String agent) {
    return '$agent sedang berjalan';
  }

  @override
  String workbenchAssistantElapsed(String duration) {
    return '· durasi $duration';
  }

  @override
  String get workbenchCloseFilePreview => 'Tutup pratinjau file';

  @override
  String workbenchFileReadCompleted(String name) {
    return 'File selesai dibaca: $name';
  }

  @override
  String workbenchFileReading(String name) {
    return 'Membaca file: $name';
  }

  @override
  String workbenchFileReadFailed(String message) {
    return 'Gagal membaca file: $message';
  }

  @override
  String get workbenchFilePreviewFailed => 'Pratinjau file gagal. Coba lagi.';

  @override
  String get workbenchFileKindTableText => 'Teks tabel';

  @override
  String get workbenchFileKindLog => 'Log';

  @override
  String get workbenchFileKindPlainText => 'Teks biasa';

  @override
  String get workbenchFileKindCodeOrConfig => 'Kode atau konfigurasi';

  @override
  String workbenchAgentsWorking(int count) {
    return '$count sub-Agent bekerja paralel';
  }

  @override
  String get workbenchAgentWindow => 'Jendela kerja Agent';

  @override
  String get workbenchAgentWindowDescription =>
      'Menyinkronkan status tugas dan aktivitas alat tanpa menampilkan penalaran privat';

  @override
  String workbenchMoreAgents(int count) {
    return '$count Agent lagi · gulir ke bawah untuk melihat';
  }

  @override
  String workbenchCurrentActivity(String activity) {
    return 'Saat ini · $activity';
  }

  @override
  String get workbenchAllAgents => 'Semua Agent';

  @override
  String get workbenchActivityTimeline => 'Linimasa aktivitas';

  @override
  String workbenchActivityCount(int count) {
    return '$count entri';
  }

  @override
  String get workbenchAgentSyncing => 'Menyinkronkan dari komputer ini…';

  @override
  String get workbenchNoPublicActivity =>
      'Belum ada aktivitas publik. Hanya status tugas dan aktivitas alat yang disinkronkan; penalaran privat model tidak.';

  @override
  String get workbenchLatestResult => 'Hasil terbaru';

  @override
  String get workbenchWaitingForTask => 'Menunggu tugas';

  @override
  String get controllerRestoreFailed =>
      'Koneksi aman tidak dapat dipulihkan. Masuk atau pasangkan lagi.';

  @override
  String get controllerAuthorizationRevoked =>
      'Otorisasi ponsel ini dicabut. Hubungkan lagi.';

  @override
  String get controllerDeviceNotConnected =>
      'Akun ini tidak terhubung ke komputer ini. Mulai lagi koneksi di komputer.';

  @override
  String get controllerProjectNameRequired => 'Nama proyek wajib diisi.';

  @override
  String controllerProjectNameTooLong(int maximum) {
    return 'Nama proyek tidak boleh lebih dari $maximum karakter.';
  }

  @override
  String get controllerProjectNameSaveFailed =>
      'Nama proyek tidak dapat disimpan secara lokal. Coba lagi.';

  @override
  String get controllerProjectNameUpdated => 'Nama proyek diperbarui.';

  @override
  String get controllerNewPairingLinkReceived =>
      'Tautan koneksi baru diterima. Keluar dari perangkat saat ini untuk menghubungkan lagi.';

  @override
  String get controllerPairingLinkRequired =>
      'Masukkan tautan koneksi Relayune yang tampil di aplikasi desktop.';

  @override
  String get controllerPairingDiscoveryFailed =>
      'Komputer yang menunggu koneksi tidak ditemukan. Coba lagi nanti.';

  @override
  String get controllerVerificationResent => 'Email verifikasi dikirim ulang.';

  @override
  String get controllerSetPasswordFirst =>
      'Atur kata sandi dari tautan email terlebih dahulu, lalu kembali ke sini.';

  @override
  String get controllerNoPendingComputer =>
      'Tidak ada komputer yang menunggu koneksi. Pilih “Hubungkan klien baru” di komputer terlebih dahulu.';

  @override
  String get controllerSelectComputer =>
      'Pilih komputer yang akan dihubungkan.';

  @override
  String get controllerPairingFailed =>
      'Koneksi aman gagal. Periksa kode koneksi dan coba lagi.';

  @override
  String get controllerHistoryReadFailed => 'Riwayat tidak dapat dibaca.';

  @override
  String get controllerAgentRefreshFailed =>
      'Aktivitas sub-Agent ini belum dapat dimuat ulang.';

  @override
  String get controllerAttachmentTooLarge =>
      'File lebih dari 1 MB belum dapat dipratinjau.';

  @override
  String get controllerAttachmentUnsupported =>
      'Format file ini belum dapat dipratinjau.';

  @override
  String get controllerAttachmentGone =>
      'File kedaluwarsa atau dihapus dari komputer.';

  @override
  String get controllerAttachmentReadFailed => 'Lampiran tidak dapat dibaca.';

  @override
  String controllerUploadTooMany(int maximum) {
    return 'Anda dapat mengunggah hingga $maximum gambar per pesan.';
  }

  @override
  String get controllerUploadTotalTooLarge =>
      'Total lampiran satu pesan tidak boleh lebih dari 20 MiB.';

  @override
  String get controllerUploadUnsupported =>
      'Pilih gambar PNG, JPEG, WebP, GIF, atau AVIF.';

  @override
  String get controllerSteeringUnsupported =>
      'Tugas ini tidak menerima instruksi tambahan. Hentikan dahulu.';

  @override
  String get controllerPreparingAgent =>
      'Diterima di komputer · Menyiapkan Agent';

  @override
  String get controllerWaitingForAgent => 'Menunggu Agent lokal menerimanya';

  @override
  String get controllerWaitingForComputer => 'Menunggu komputer online';

  @override
  String get controllerStopSent => 'Permintaan berhenti dikirim.';

  @override
  String get controllerApprovalExpired => 'Persetujuan ini telah kedaluwarsa.';

  @override
  String get controllerApprovalOffline =>
      'Persetujuan tidak dapat ditangani saat komputer offline.';

  @override
  String get controllerApprovalAllowedSent =>
      'Izin dikirim; menunggu konfirmasi komputer.';

  @override
  String get controllerApprovalRejectedSent =>
      'Penolakan dikirim; menunggu konfirmasi komputer.';

  @override
  String controllerDelegatedTasks(int count) {
    return 'Mendelegasikan $count tugas paralel.';
  }

  @override
  String get controllerSelectProject =>
      'Pilih proyek tersinkron dari bilah samping terlebih dahulu.';

  @override
  String get controllerCreateSessionOffline =>
      'Komputer offline. Sesi belum dapat dibuat.';

  @override
  String controllerSessionNameLength(int maximum) {
    return 'Nama sesi harus terdiri dari 1–$maximum karakter.';
  }

  @override
  String get controllerSessionCreationBusy =>
      'Sesi sebelumnya masih dibuat. Harap tunggu.';

  @override
  String controllerSessionCreating(String name) {
    return 'Membuat “$name”…';
  }

  @override
  String get controllerSessionCreateFailed =>
      'Sesi tidak dapat dibuat. Coba lagi nanti.';

  @override
  String get controllerDesktopSessionCreateFailed =>
      'Aplikasi desktop tidak dapat membuat sesi.';

  @override
  String get controllerSessionCreateTimeout =>
      'Waktu tunggu pembuatan sesi habis. Periksa nanti; jangan buat duplikat.';

  @override
  String controllerSessionCreated(String name) {
    return '“$name” dibuat.';
  }

  @override
  String get controllerCoworkCreateOnDesktop =>
      'Buat tugas Cowork ini di Claude Desktop terlebih dahulu, lalu kontrol di sini.';

  @override
  String get controllerDesktopConfigFailed =>
      'Aplikasi desktop tidak dapat menerapkan setelan sesi.';

  @override
  String get controllerConfigApplied => 'Setelan sesi diterapkan.';

  @override
  String get controllerConfigUpdateFailed =>
      'Setelan sesi tidak dapat diperbarui. Coba lagi nanti.';

  @override
  String get controllerConfigTimeout =>
      'Waktu tunggu penerapan setelan habis. Muat ulang untuk memastikan.';

  @override
  String get controllerInvalidEncryptedEvent =>
      'Peristiwa terenkripsi tidak dapat diverifikasi. Kemajuan kursor sinkronisasi dihentikan.';

  @override
  String get controllerApprovalNeeded => 'Menunggu persetujuan Anda';

  @override
  String get controllerContinuing => 'Melanjutkan';

  @override
  String get controllerApprovalProcessFailed =>
      'Komputer tidak dapat menangani persetujuan ini. Coba lagi.';

  @override
  String controllerAgentProcessing(String name) {
    return '$name sedang memproses';
  }

  @override
  String get controllerSummarizing => 'Merangkum hasil';

  @override
  String get controllerThinking => 'Berpikir';

  @override
  String get controllerLocalTaskFailed => 'Tugas lokal gagal.';

  @override
  String get controllerInterruptFailed =>
      'Tugas saat ini tidak dapat dihentikan.';

  @override
  String get controllerReplying => 'Menjawab';

  @override
  String get controllerFinishing => 'Menyelesaikan';

  @override
  String get controllerOrganizingFileChanges => 'Mengatur perubahan file';

  @override
  String controllerFilesModified(int count) {
    return '$count file diubah.';
  }

  @override
  String get controllerUpdatingPlan => 'Memperbarui rencana';

  @override
  String get controllerMessageQueued =>
      'Pesan masuk antrean dan akan dikirim otomatis nanti.';

  @override
  String controllerSessionPersisted(String agent) {
    return 'Sesi disimpan ke $agent.';
  }

  @override
  String controllerLocalTool(String label) {
    return 'Alat lokal: $label';
  }

  @override
  String get controllerProcessingLocalResult => 'Memproses hasil lokal';

  @override
  String get controllerEncryptedResponseTimeout =>
      'Waktu tunggu respons terenkripsi dari komputer habis.';

  @override
  String get controllerPairingUsedOrExpired =>
      'Koneksi ini sudah digunakan atau kedaluwarsa.';

  @override
  String get controllerPairingConfirmationTimeout =>
      'Waktu tunggu konfirmasi desktop habis. Mulai lagi koneksi.';

  @override
  String get controllerPairingConfirmationFailed =>
      'Komputer tidak mengonfirmasi koneksi terenkripsi. Hubungkan lagi.';

  @override
  String get controllerDesktopOffline =>
      'Aplikasi desktop belum online. Biarkan Relayune terbuka dan coba lagi.';

  @override
  String get workbenchDefault => 'Bawaan';

  @override
  String workbenchAgentToolCount(int count) {
    return '$count alat';
  }

  @override
  String workbenchAgentTokenCount(String count) {
    return '$count token';
  }

  @override
  String get apiErrorNetworkUnavailable =>
      'Tidak dapat terhubung ke Relayune. Periksa jaringan lalu coba lagi.';

  @override
  String get apiErrorTimeout => 'Waktu permintaan habis. Coba lagi.';

  @override
  String get apiErrorInvalidResponse =>
      'Relayune menerima respons server yang tidak valid. Coba lagi.';

  @override
  String get apiErrorInvalidCredentials => 'Email atau kata sandi salah.';

  @override
  String get apiErrorAuthentication =>
      'Sesi masuk Anda telah berakhir. Masuk lagi.';

  @override
  String get apiErrorService =>
      'Relayune sementara tidak tersedia. Coba lagi nanti.';

  @override
  String get apiErrorGeneric => 'Terjadi kesalahan. Coba lagi.';

  @override
  String get controllerFileAccessDenied =>
      'Relayune di komputer tidak dapat membaca beberapa file sesi. Di Mac, izinkan akses di Pengaturan Sistem → Privasi & Keamanan → File dan Folder, lalu coba lagi. Di komputer lain, periksa izin file.';

  @override
  String get workbenchImageWaiting => 'Menunggu dimuat';

  @override
  String get workbenchImageLoading => 'Memuat';

  @override
  String get feedbackTitle => 'Umpan balik';

  @override
  String get feedbackIntro => 'Apa yang bisa ditingkatkan?';

  @override
  String get feedbackSubtitle => 'Bagikan ide atau laporkan masalah.';

  @override
  String get feedbackSuggestion => 'Saran';

  @override
  String get feedbackBug => 'Laporan bug';

  @override
  String get feedbackDescription => 'Deskripsi';

  @override
  String get feedbackSuggestionHint =>
      'Apa yang ingin ditingkatkan dan bagaimana manfaatnya?';

  @override
  String get feedbackBugHint =>
      'Apa yang Anda lakukan, harapkan, dan apa yang terjadi?';

  @override
  String get feedbackInfo => 'Informasi yang disertakan';

  @override
  String get feedbackPrivacy =>
      'Detail perangkat disertakan. Percakapan dan log tidak diunggah otomatis.';

  @override
  String get feedbackVersion => 'Versi aplikasi';

  @override
  String get feedbackModel => 'Model perangkat';

  @override
  String get feedbackSystem => 'Sistem operasi';

  @override
  String get feedbackUnknown => 'Tidak tersedia';

  @override
  String get feedbackLoading => 'Membaca informasi perangkat…';

  @override
  String get feedbackSend => 'Kirim umpan balik';

  @override
  String get feedbackFailed =>
      'Gagal mengirim. Isi tetap tersimpan di sini. Periksa koneksi dan coba lagi.';

  @override
  String get feedbackEmpty => 'Tuliskan umpan balik terlebih dahulu.';

  @override
  String get feedbackSending => 'Mengirim…';

  @override
  String get feedbackSubmitNote =>
      'Deskripsi dan informasi ini akan disimpan untuk penyelidikan dan perbaikan.';

  @override
  String get feedbackSuccess =>
      'Umpan balik diterima. Terima kasih atas bantuan Anda.';

  @override
  String get feedbackReference => 'Nomor referensi';

  @override
  String get feedbackDone => 'Selesai';

  @override
  String get workbenchStoppingTask => 'Menghentikan…';

  @override
  String get workbenchStopUnconfirmed =>
      'Penghentian belum dikonfirmasi. Coba lagi.';

  @override
  String get workbenchPreparingImages => 'Menyiapkan gambar…';

  @override
  String get workbenchImagePickFailed => 'Tidak dapat membuka foto. Coba lagi.';

  @override
  String get feedbackImages => 'Gambar';

  @override
  String get feedbackOptional => 'Opsional';

  @override
  String get feedbackImageLimit => 'Anda dapat menambahkan hingga 3 gambar.';

  @override
  String get feedbackImageFailed =>
      'Gagal menambahkan gambar. Coba gambar lain.';

  @override
  String get feedbackImagePreview => 'Pratinjau gambar';

  @override
  String get feedbackRemoveImage => 'Hapus gambar';

  @override
  String get feedbackPreparingImages => 'Menyiapkan gambar…';

  @override
  String get feedbackAddImage => 'Tambah gambar';

  @override
  String get feedbackImagesHint =>
      'Tambahkan tangkapan layar agar lebih mudah dipahami.';

  @override
  String get feedbackContact => 'Kontak';

  @override
  String get feedbackEmail => 'Email';

  @override
  String get feedbackEmailHint =>
      'Email akun Anda; dapat diubah atau dikosongkan';

  @override
  String get feedbackWechat => 'ID WeChat';

  @override
  String get feedbackWechatHint => 'Masukkan ID WeChat Anda';

  @override
  String get feedbackContactHint =>
      'Hanya untuk membalas masukan ini. Keduanya opsional.';

  @override
  String get feedbackEmailInvalid =>
      'Masukkan email yang valid atau kosongkan.';

  @override
  String get deviceAgents => 'Agen';

  @override
  String get deviceAgentReady => 'Terhubung';

  @override
  String get deviceAgentRunning => 'Berjalan';

  @override
  String get deviceAgentNotInstalled => 'Belum terpasang';

  @override
  String get deviceAgentUnavailable => 'Tidak tersedia';

  @override
  String get deviceAgentNotEnabled => 'Belum diaktifkan';

  @override
  String get deviceAgentUnknown => 'Belum dilaporkan';

  @override
  String get deviceAgentOffline => 'Komputer offline · Status terakhir';

  @override
  String get openingTitle => 'Tetap terhubung, di mana pun.';

  @override
  String get openingSubtitle =>
      'Lanjutkan pekerjaan AI di komputer Anda dari mana saja.';

  @override
  String get openingSkip => 'Lewati animasi';

  @override
  String get deviceQuota => 'Batas langganan';

  @override
  String get quotaFiveHour => '5 jam';

  @override
  String get quotaSevenDay => '7 hari';

  @override
  String quotaUsed(String percent) {
    return '$percent% terpakai';
  }

  @override
  String quotaResets(String time) {
    return 'Direset $time';
  }

  @override
  String quotaUpdated(String time) {
    return 'Diperbarui $time';
  }

  @override
  String get quotaPending => 'Belum dilaporkan';

  @override
  String get quotaExpired => 'Menunggu batas baru';

  @override
  String get quotaLimitReached => 'Batas tercapai';

  @override
  String get quotaSnapshot => 'Laporan terakhir';

  @override
  String get quotaClaudeHint =>
      'Claude melaporkan batas selama sesi. Data yang belum dilaporkan tidak diperkirakan.';

  @override
  String get settingsHapticsTitle => 'Umpan balik sentuhan';

  @override
  String get settingsHapticsSubtitle =>
      'Getaran lembut saat koneksi atau keputusan dikonfirmasi.';

  @override
  String get workbenchBackToLatest => 'Ke pesan terbaru';

  @override
  String get settingsFontSize => 'Ukuran teks';

  @override
  String get settingsFontSizeSmall => 'Kecil';

  @override
  String get settingsFontSizeMedium => 'Sedang';

  @override
  String get settingsFontSizeLarge => 'Besar';

  @override
  String get settingsFontSizeSaveFailed =>
      'Ukuran teks berubah, tetapi tidak dapat disimpan. Coba lagi.';

  @override
  String get workbenchAgentOrderHint =>
      'Sentuh dan tahan, lalu seret untuk mengubah urutan';

  @override
  String get workbenchAgentOrderSaveFailed =>
      'Urutan telah diubah, tetapi tidak dapat disimpan. Silakan coba lagi.';

  @override
  String get settingsBuildInfo => 'Informasi versi';

  @override
  String get buildTime => 'Waktu build';

  @override
  String get buildSourceCommit => 'Commit sumber';

  @override
  String get buildUnrecorded => 'Tidak tercatat';

  @override
  String get buildUncommitted => 'Menyertakan perubahan yang belum di-commit';

  @override
  String get agentTasksTitle => 'Subtugas';

  @override
  String agentTasksCount(int count) {
    return '$count subtugas';
  }

  @override
  String agentTasksViewAll(int count) {
    return 'Lihat semua $count subtugas';
  }

  @override
  String agentTasksRunning(int count) {
    return '$count berjalan';
  }

  @override
  String agentTasksFinished(int count) {
    return '$count berakhir';
  }

  @override
  String get agentTasksAttention => 'Memerlukan perhatian Anda';

  @override
  String get agentTasksInProgress => 'Sedang berlangsung';

  @override
  String get agentTasksEnded => 'Berakhir';

  @override
  String get agentTaskPreparing => 'Menyiapkan';

  @override
  String get agentTaskUnknown => 'Status menunggu sinkronisasi';

  @override
  String get agentTaskCompleted => 'Selesai';

  @override
  String get agentTaskFailed => 'Gagal';

  @override
  String get agentTaskStopped => 'Dihentikan';

  @override
  String get agentTaskAnswer => 'Menunggu jawaban Anda';

  @override
  String get agentTaskApprove => 'Menunggu persetujuan Anda';

  @override
  String get agentTaskNoResult => 'Belum ada hasil yang diterima';

  @override
  String get agentTaskInstructions => 'Instruksi tugas';

  @override
  String get agentTaskRuntime => 'Informasi proses';

  @override
  String agentTaskParent(String name) {
    return 'Dari: $name';
  }

  @override
  String agentTaskUpdated(String time) {
    return 'Diperbarui $time';
  }

  @override
  String get agentTaskOffline =>
      'Komputer offline · status terakhir yang diketahui';

  @override
  String get agentTaskOpenConversation => 'Buka percakapan subtugas';

  @override
  String get agentTaskEmpty => 'Belum ada subtugas';

  @override
  String get agentTaskFinishedResult => 'Hasil';

  @override
  String get liveTaskRunning => 'Sedang bekerja';

  @override
  String get liveTaskApproval => 'Perlu persetujuan';

  @override
  String get liveTaskQuestion => 'Perlu jawaban';

  @override
  String get liveTaskCompleted => 'Selesai';

  @override
  String get liveTaskFailed => 'Tugas gagal';

  @override
  String get liveTaskStopped => 'Dihentikan';

  @override
  String get liveTaskStale => 'Periksa status';

  @override
  String get liveTaskOpen => 'Lihat tugas';

  @override
  String get liveTaskReview => 'Tinjau';

  @override
  String get liveTaskElapsed => 'Waktu berlalu';

  @override
  String get liveTaskUpdated => 'Sinkron terakhir';

  @override
  String get androidPushDisclosure =>
      'Enable background alerts with JPush and, on supported devices, vivo Push. They process a push identifier, Android ID, device/system and network information for delivery. Task content and encryption keys are not sent to these providers. You can turn alerts off in system settings.';

  @override
  String get controllerSessionUnavailable =>
      'Percakapan ini tidak tersedia di komputer yang terhubung. Pastikan Agent berjalan dan percakapan masih ada, lalu coba lagi atau mulai percakapan baru.';

  @override
  String get settingsSidebarAgents => 'Agen bilah samping';

  @override
  String get settingsSidebarAgentsSubtitle =>
      'Pilih agen yang ditampilkan di bilah samping';

  @override
  String get turnStatusRunning => 'Memproses';

  @override
  String get turnStatusCompleted => 'Giliran selesai';

  @override
  String get turnStatusInterrupted => 'Giliran ini belum selesai';

  @override
  String get turnStatusUnknown => 'Catatan aktivitas';

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
  String get localWebForward => 'Halaman berikutnya';

  @override
  String get localWebAddress => 'Alamat halaman';

  @override
  String get localWebLoading => 'Menghubungkan ke komputer…';

  @override
  String get accountDeletionTitle => 'Hapus akun';

  @override
  String get accountDeletionBody =>
      'Akun Relayune, otorisasi perangkat, preferensi, dan masukan Anda akan dihapus permanen. Perangkat kehilangan akses dan kunci cache ponsel ini dihapus. Proyek dan berkas Agent di komputer tetap tersedia.';

  @override
  String get accountDeletionPassword => 'Konfirmasi kata sandi';

  @override
  String get accountDeletionConfirm => 'Hapus akun saya secara permanen';

  @override
  String get accountDeletionBusy => 'Menghapus…';

  @override
  String get accountDeletionWrongPassword => 'Kata sandi salah. Coba lagi.';

  @override
  String get accountDeletionFailed =>
      'Penghapusan belum selesai. Periksa koneksi dan coba lagi. Jika sudah dimulai, akses akun lain tetap dinonaktifkan sampai pembersihan selesai.';

  @override
  String get accountDeletionDone => 'Akun Anda telah dihapus.';

  @override
  String get controllerPendingInputSaveFailed =>
      'Pesan Anda tidak dapat disimpan di ponsel ini. Kosongkan penyimpanan lalu coba lagi.';

  @override
  String get workbenchHistoryRequestSending => 'Mengirim permintaan';

  @override
  String get workbenchHistoryWaitingComputer => 'Menunggu respons komputer';

  @override
  String get workbenchHistoryReadingComputer => 'Membaca riwayat di komputer';

  @override
  String get workbenchHistoryPreparing => 'Menyiapkan pesan';

  @override
  String workbenchHistoryElapsed(int seconds) {
    return 'Waktu berlalu: $seconds dtk';
  }

  @override
  String get workbenchHistoryTransferring => 'Mentransfer riwayat';

  @override
  String workbenchHistorySourceRead(String read, String total) {
    return 'Komputer membaca $read / $total';
  }

  @override
  String workbenchHistoryPendingTransfer(String size) {
    return 'Halaman menunggu transfer: $size';
  }

  @override
  String workbenchHistoryReceived(String size) {
    return 'Diterima $size';
  }

  @override
  String workbenchHistoryPendingReceive(String size) {
    return 'Menunggu diterima: $size';
  }

  @override
  String get workbenchHistoryReadingCache =>
      'Membaca riwayat yang tersimpan di ponsel ini';

  @override
  String get localWebResources => 'Sumber daya halaman';

  @override
  String get localWebGettingPage => 'Mengambil halaman…';

  @override
  String get localWebLoadingPage => 'Memuat halaman…';

  @override
  String localWebResourceSummary(int completed, int active) {
    return '$completed diterima · $active berlangsung';
  }

  @override
  String localWebResourceFailures(int count) {
    return '$count gagal';
  }

  @override
  String get localWebResourceWaiting => 'Menunggu respons';

  @override
  String get localWebResourceReceiving => 'Menerima';

  @override
  String get localWebResourcePreparing => 'Menyiapkan';

  @override
  String get localWebResourceComplete => 'Diterima';

  @override
  String get localWebResourceFailed => 'Gagal';

  @override
  String get localWebResourceCancelled => 'Dihentikan';

  @override
  String get localWebResourceTransferNote =>
      'Progres mengukur penerimaan respons. Halaman mungkin meminta sumber daya lain.';

  @override
  String get localWebResourceEmpty =>
      'Sumber daya yang diminta halaman ini akan muncul di sini.';

  @override
  String localWebResourceRecent(int count) {
    return 'Menampilkan $count sumber daya terbaru';
  }

  @override
  String localWebElapsed(String seconds) {
    return '$seconds dtk';
  }

  @override
  String get localWebOpeningTitle => 'Halaman dari komputer Anda';

  @override
  String get localWebOpeningHint =>
      'Biarkan komputer dan layanan web tetap berjalan. Halaman akan muncul secara otomatis.';

  @override
  String get replyBranchLabel => 'Cabangkan ke chat baru';

  @override
  String get replyBranchSameDirectory => 'Gunakan direktori proyek asal';

  @override
  String get replyBranchSameDirectoryDescription => 'Tetap berbagi file proyek';

  @override
  String get replyBranchWorktree => 'Buat worktree baru';

  @override
  String get replyBranchWorktreeDescription =>
      'Direktori terpisah, berdasarkan commit saat ini';

  @override
  String get controllerReplyBranchOffline =>
      'Hubungkan komputer untuk membuat cabang';

  @override
  String get controllerReplyBranchCreating => 'Membuat chat baru…';

  @override
  String get controllerReplyBranchCreated =>
      'Chat baru dicabangkan di direktori proyek asal.';

  @override
  String get controllerReplyBranchFailed =>
      'Chat baru tidak dapat dibuat. Coba lagi.';

  @override
  String get controllerReplyBranchUnconfirmed =>
      'Hasil cabang belum dikonfirmasi. Tetap terhubung dan coba periksa lagi.';

  @override
  String get controllerReplyBranchUnavailable =>
      'Balasan ini tidak dapat dicabangkan. Muat ulang percakapan.';

  @override
  String get controllerReplyBranchBusy =>
      'Operasi chat lain sedang berlangsung. Coba lagi sebentar lagi.';

  @override
  String get controllerReplyBranchWorktreeFailed =>
      'Worktree tidak dapat dibuat. Periksa proyek di komputer lalu coba lagi.';

  @override
  String get controllerReplyBranchWorktreeCreated =>
      'Chat baru dicabangkan di worktree terpisah.';

  @override
  String agentTasksCompletedCount(int count) {
    return '$count selesai';
  }

  @override
  String agentTasksStoppedCount(int count) {
    return '$count dihentikan';
  }

  @override
  String agentTasksFailedCount(int count) {
    return '$count gagal';
  }

  @override
  String agentTasksPreparingCount(int count) {
    return '$count disiapkan';
  }

  @override
  String agentTasksUnknownCount(int count) {
    return '$count menunggu sinkronisasi';
  }

  @override
  String get agentTasksSearch => 'Cari tugas, nama panggilan, atau model';

  @override
  String get agentTasksNoMatches => 'Tidak ada subtugas yang cocok';

  @override
  String get agentTaskModelConfiguration => 'Konfigurasi model';
}
