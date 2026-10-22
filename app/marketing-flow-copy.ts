import { zhMarketingFlowCopy } from "./marketing-flow-copy-zh";
import { enMarketingFlowCopy } from "./marketing-flow-copy-en";
import type { MarketingCopy, MarketingLocale } from "./marketing-copy";

type FlowCopy = { intro: string; accent: string; security: string; steps: readonly [string, string, string] };
// Complete catalog for localized page generation and the lazy workbench.
// Public Chinese and English entries import only their own flow module.
// Account sign-in and client authorization remain separate user actions.
export const marketingFlowCopy: Record<MarketingLocale, FlowCopy> = {
  "zh-CN": zhMarketingFlowCopy,
  "en": enMarketingFlowCopy,
  hi: {
    intro: "कंप्यूटर पर Relayune इंस्टॉल करें, ईमेल से लॉग इन करें, फिर कंप्यूटर के 8-अक्षर वाले कोड से ब्राउज़र या फ़ोन को अनुमति दें। लॉग इन के बाद हर नए क्लाइंट को अलग अनुमति चाहिए।",
    accent: "अपना काम आगे बढ़ाएँ।",
    security: "कार्य का विवरण केवल आपके कंप्यूटर और अधिकृत क्लाइंट पर खुलता है। Relayune सर्वर कार्य या कनेक्शन कोड नहीं पढ़ सकते; वे ईमेल और कनेक्शन के लिए आवश्यक जानकारी संभालते हैं।",
    steps: ["डेस्कटॉप ऐप कंप्यूटर पर Codex, Kimi Code और Claude Code के कार्य खोजता है।", "ईमेल से लॉग इन करके डेस्कटॉप ऐप को खाते से जोड़ें, फिर Relayune पर लौटें।", "ब्राउज़र या मोबाइल ऐप में कंप्यूटर का 8-अक्षर वाला कोड डालकर उस क्लाइंट को अलग अनुमति दें। स्कैन करना वैकल्पिक है।"],
  },
  es: {
    intro: "Instala Relayune en el ordenador, inicia sesión por correo y autoriza el navegador o teléfono con el código de 8 caracteres del ordenador. Cada cliente nuevo requiere su propia autorización tras iniciar sesión.",
    accent: "retoma tu tarea.",
    security: "El contenido solo se descifra en tu ordenador y los clientes autorizados. Los servidores de Relayune no pueden leer tareas ni códigos; gestionan tu correo y la información necesaria para conectar.",
    steps: ["La aplicación de escritorio encuentra tareas de Codex, Kimi Code y Claude Code en tu ordenador.", "Inicia sesión por correo para vincular la aplicación de escritorio a tu cuenta y vuelve a Relayune.", "Introduce el código de 8 caracteres del ordenador en el navegador o la app móvil para autorizar ese cliente por separado. También puedes escanearlo."],
  },
  ar: {
    intro: "ثبّت Relayune على الكمبيوتر، وسجّل الدخول بالبريد، ثم امنح المتصفح أو الهاتف الإذن برمز الكمبيوتر ذي 8 أحرف. يحتاج كل عميل جديد إلى إذن مستقل بعد تسجيل الدخول.",
    accent: "تابع مهمتك من حيث توقفت.",
    security: "لا يُفك تشفير محتوى المهام إلا على الكمبيوتر والعملاء الذين أذنت لهم. لا تستطيع خوادم Relayune قراءة المهام أو رموز الاتصال؛ تعالج بريدك والمعلومات اللازمة للاتصال فقط.",
    steps: ["يعثر تطبيق سطح المكتب على مهام Codex وKimi Code وClaude Code على الكمبيوتر.", "سجّل الدخول بالبريد لربط تطبيق سطح المكتب بحسابك، ثم عُد إلى Relayune.", "أدخل رمز الكمبيوتر ذي 8 أحرف في المتصفح أو تطبيق الهاتف لمنح هذا العميل إذنًا مستقلًا. يمكنك أيضًا المسح."],
  },
  fr: {
    intro: "Installez Relayune sur l’ordinateur, connectez-vous par e-mail, puis autorisez le navigateur ou le téléphone avec le code à 8 caractères de l’ordinateur. Chaque nouveau client nécessite une autorisation distincte après connexion.",
    accent: "reprenez votre tâche.",
    security: "Le contenu est déchiffré uniquement sur votre ordinateur et les clients autorisés. Les serveurs Relayune ne peuvent lire ni vos tâches ni vos codes ; ils traitent votre e-mail et les informations nécessaires à la connexion.",
    steps: ["L’application de bureau trouve les tâches Codex, Kimi Code et Claude Code sur votre ordinateur.", "Connectez-vous par e-mail pour associer l’application de bureau à votre compte, puis revenez à Relayune.", "Saisissez le code à 8 caractères de l’ordinateur dans le navigateur ou l’application mobile pour autoriser ce client séparément. Le scan reste facultatif."],
  },
  bn: {
    intro: "কম্পিউটারে Relayune ইনস্টল করে ইমেলে লগ ইন করুন, তারপর কম্পিউটারের 8 অক্ষরের কোড দিয়ে ব্রাউজার বা ফোনকে অনুমতি দিন। লগ ইন করার পর প্রতিটি নতুন ক্লায়েন্টকে আলাদা অনুমতি দিতে হবে।",
    accent: "আপনার কাজ এগিয়ে নিন।",
    security: "কাজের বিষয়বস্তু শুধু আপনার কম্পিউটার ও অনুমোদিত ক্লায়েন্টে ডিক্রিপ্ট হয়। Relayune সার্ভার কাজ বা সংযোগ কোড পড়তে পারে না; ইমেল ও সংযোগের প্রয়োজনীয় তথ্য সামলায়।",
    steps: ["ডেস্কটপ অ্যাপ কম্পিউটারের Codex, Kimi Code ও Claude Code-এর কাজ খুঁজে পায়।", "ইমেলে লগ ইন করে ডেস্কটপ অ্যাপটি অ্যাকাউন্টের সঙ্গে যুক্ত করুন, তারপর Relayune-এ ফিরুন।", "ব্রাউজার বা মোবাইল অ্যাপে কম্পিউটারের 8 অক্ষরের কোড দিয়ে সেই ক্লায়েন্টকে আলাদা অনুমতি দিন। স্ক্যান করাও ঐচ্ছিক উপায়।"],
  },
  pt: {
    intro: "Instale o Relayune no computador, entre com e-mail e autorize o navegador ou telefone com o código de 8 caracteres do computador. Cada novo cliente precisa de autorização própria após entrar.",
    accent: "retome sua tarefa.",
    security: "O conteúdo só é descriptografado no seu computador e nos clientes autorizados. Os servidores Relayune não podem ler tarefas nem códigos; processam seu e-mail e as informações necessárias à conexão.",
    steps: ["O aplicativo desktop encontra tarefas do Codex, Kimi Code e Claude Code no computador.", "Entre com e-mail para vincular o aplicativo desktop à sua conta e volte ao Relayune.", "Digite o código de 8 caracteres do computador no navegador ou aplicativo móvel para autorizar esse cliente separadamente. Escanear é opcional."],
  },
  id: {
    intro: "Instal Relayune di komputer, masuk dengan email, lalu izinkan browser atau ponsel menggunakan kode 8 karakter di komputer. Setiap klien baru memerlukan izin sendiri setelah masuk.",
    accent: "lanjutkan tugas Anda.",
    security: "Isi tugas hanya didekripsi di komputer dan klien yang Anda izinkan. Server Relayune tidak dapat membaca tugas atau kode koneksi; server menangani email dan informasi yang diperlukan untuk terhubung.",
    steps: ["Aplikasi desktop menemukan tugas Codex, Kimi Code, dan Claude Code di komputer Anda.", "Masuk dengan email untuk menghubungkan aplikasi desktop ke akun Anda, lalu kembali ke Relayune.", "Masukkan kode 8 karakter dari komputer di browser atau aplikasi seluler untuk mengizinkan klien itu secara terpisah. Pemindaian adalah pilihan tambahan."],
  },
  ur: {
    intro: "کمپیوٹر پر Relayune نصب کریں، ای میل سے سائن اِن کریں، پھر کمپیوٹر کے 8 حرفی کوڈ سے براؤزر یا فون کو اجازت دیں۔ سائن اِن کے بعد ہر نئے کلائنٹ کو الگ اجازت درکار ہے۔",
    accent: "اپنا کام آگے بڑھائیں۔",
    security: "کام کا مواد صرف آپ کے کمپیوٹر اور مجاز کلائنٹس پر کھلتا ہے۔ Relayune سرور کام یا کنکشن کوڈ نہیں پڑھ سکتے؛ وہ ای میل اور رابطے کی ضروری معلومات سنبھالتے ہیں۔",
    steps: ["ڈیسک ٹاپ ایپ کمپیوٹر پر Codex، Kimi Code اور Claude Code کے کام تلاش کرتی ہے۔", "ای میل سے سائن اِن کر کے ڈیسک ٹاپ ایپ کو اکاؤنٹ سے جوڑیں، پھر Relayune پر واپس آئیں۔", "براؤزر یا موبائل ایپ میں کمپیوٹر کا 8 حرفی کوڈ ڈال کر اس کلائنٹ کو الگ اجازت دیں۔ اسکین کرنا بھی اختیاری طریقہ ہے۔"],
  },
};

export function withMarketingFlowCopy(copy: MarketingCopy, locale: MarketingLocale): MarketingCopy {
  const flow = marketingFlowCopy[locale];
  return {
    ...copy,
    howDescription: flow.intro,
    howTitleAccent: flow.accent,
    securityDescription: flow.security,
    howSteps: copy.howSteps.map((step, index) => ({ ...step, scope: `0${index + 1}`, description: flow.steps[index] })),
  };
}
