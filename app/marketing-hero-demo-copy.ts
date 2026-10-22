import type { MarketingLocale } from "./marketing-copy";
import type { enHeroReplay } from "./marketing-hero-demo-copy-en";

type LocalizedMarketingLocale = Exclude<MarketingLocale, "zh-CN" | "en">;

type ReplayCopy = { [K in keyof typeof enHeroReplay]: K extends "steps" | "summaries" ? readonly string[] : string };

export const localizedHeroReplay: Record<LocalizedMarketingLocale, ReplayCopy> = {
  "hi": {
    "label": "काल्पनिक विकास उदाहरण",
    "title": "फ़ॉन्ट आकार सेटिंग जोड़ना",
    "disclosure": "काल्पनिक चीनी उदाहरण · ऑफ़लाइन UI डेमो · वास्तविक कार्य का इतिहास नहीं",
    "replay": "फिर चलाएँ",
    "play": "चलाएँ",
    "pause": "रोकें",
    "zoom": "बड़ा देखें",
    "web": "वेब",
    "phone": "मोबाइल",
    "close": "बंद करें",
    "steps": [
      "अनुरोध",
      "बदलाव",
      "जाँच",
      "उदाहरण परिणाम"
    ],
    "summaries": [
      "फ़ोन का टेक्स्ट बड़ा है। तीन फ़ॉन्ट आकार और नवीनतम संदेश पर लौटने के लिए छोटा आइकन जोड़ें।",
      "Codex सेटिंग और बातचीत के बटन ढूँढता है। आकार पूरे ऐप में लागू होगा और सहेजा जाएगा।",
      "उदाहरण में डिफ़ॉल्ट आकार, बहाली और बटन की जाँच सूची है; वास्तविक परीक्षण परिणाम नहीं।",
      "उदाहरण परिणाम: तीन आकार, डिफ़ॉल्ट छोटा और तीर बटन। किसी वास्तविक कमिट का उल्लेख नहीं।"
    ]
  },
  "es": {
    "label": "Ejemplo de desarrollo ficticio",
    "title": "Añadir ajustes de tamaño de texto",
    "disclosure": "Ejemplo ficticio en chino · Demo de interfaz sin conexión · No es un historial real",
    "replay": "Repetir",
    "play": "Reproducir",
    "pause": "Pausar",
    "zoom": "Ampliar",
    "web": "Web",
    "phone": "Móvil",
    "close": "Cerrar",
    "steps": [
      "Solicitud",
      "Cambios",
      "Verificación",
      "Resultado ilustrativo"
    ],
    "summaries": [
      "El texto del móvil es demasiado grande. Añadir tres tamaños y un icono compacto para volver al último mensaje.",
      "Codex localiza los ajustes y botones. El tamaño se aplicará a toda la app y se guardará.",
      "El ejemplo enumera comprobaciones de tamaño, persistencia e interacción; no presenta resultados de pruebas reales.",
      "Resultado del ejemplo: tres tamaños, pequeño por defecto y un botón de flecha. No representa un commit real."
    ]
  },
  "ar": {
    "label": "مثال تطوير افتراضي",
    "title": "إضافة إعدادات حجم الخط",
    "disclosure": "مثال صيني افتراضي · عرض واجهة دون اتصال · ليس سجل مهمة حقيقية",
    "replay": "إعادة العرض",
    "play": "تشغيل",
    "pause": "إيقاف مؤقت",
    "zoom": "تكبير",
    "web": "الويب",
    "phone": "الهاتف",
    "close": "إغلاق",
    "steps": [
      "الطلب",
      "التنفيذ",
      "التحقق",
      "نتيجة المثال"
    ],
    "summaries": [
      "نص الهاتف كبير جدًا. إضافة ثلاثة أحجام للخط وأيقونة صغيرة للعودة إلى أحدث رسالة.",
      "يحدد Codex الإعدادات وأزرار المحادثة. سيُطبق الحجم في التطبيق كله ويُحفظ.",
      "يسرد المثال فحوص الحجم الافتراضي والاستعادة والزر؛ ولا يعرض نتائج اختبارات حقيقية.",
      "نتيجة المثال: ثلاثة أحجام، الصغير افتراضيًا، وزر سهم. لا يمثل أي التزام برمجي حقيقي."
    ]
  },
  "fr": {
    "label": "Exemple de développement fictif",
    "title": "Ajouter des tailles de texte",
    "disclosure": "Exemple fictif en chinois · Démo hors ligne · Aucun historique de tâche réelle",
    "replay": "Rejouer",
    "play": "Lire",
    "pause": "Pause",
    "zoom": "Agrandir",
    "web": "Web",
    "phone": "Mobile",
    "close": "Fermer",
    "steps": [
      "Demande",
      "Modification",
      "Vérification",
      "Résultat illustratif"
    ],
    "summaries": [
      "Le texte du téléphone est trop grand. Ajouter trois tailles et une icône compacte pour revenir au dernier message.",
      "Codex repère les réglages et les boutons. La taille sera appliquée dans toute l’app et enregistrée.",
      "L’exemple énumère les contrôles de taille, de restauration et du bouton, sans résultats de tests réels.",
      "Résultat illustratif : trois tailles, petite par défaut, et un bouton fléché. Aucun commit réel."
    ]
  },
  "bn": {
    "label": "কাল্পনিক উন্নয়ন উদাহরণ",
    "title": "ফন্টের আকার সেটিং যোগ করা",
    "disclosure": "কাল্পনিক চীনা উদাহরণ · অফলাইন UI ডেমো · বাস্তব কাজের ইতিহাস নয়",
    "replay": "আবার চালান",
    "play": "চালান",
    "pause": "বিরতি",
    "zoom": "বড় করে দেখুন",
    "web": "ওয়েব",
    "phone": "মোবাইল",
    "close": "বন্ধ",
    "steps": [
      "অনুরোধ",
      "পরিবর্তন",
      "যাচাই",
      "উদাহরণের ফল"
    ],
    "summaries": [
      "ফোনের লেখা অনেক বড়। তিনটি ফন্টের আকার এবং সর্বশেষ বার্তায় ফেরার ছোট আইকন যোগ করুন।",
      "Codex সেটিং ও কথোপকথনের বোতাম খুঁজে পায়। আকার পুরো অ্যাপে প্রযোজ্য হবে ও সংরক্ষিত থাকবে।",
      "উদাহরণে আকার, পুনরুদ্ধার ও বোতামের যাচাই তালিকা আছে; বাস্তব পরীক্ষার ফলাফল নয়।",
      "উদাহরণের ফল: তিন আকার, ডিফল্ট ছোট এবং তীর বোতাম। কোনো বাস্তব কমিট নয়।"
    ]
  },
  "pt": {
    "label": "Exemplo de desenvolvimento fictício",
    "title": "Adicionar ajustes de tamanho do texto",
    "disclosure": "Exemplo fictício em chinês · Demo offline · Não é um histórico real",
    "replay": "Repetir",
    "play": "Reproduzir",
    "pause": "Pausar",
    "zoom": "Ampliar",
    "web": "Web",
    "phone": "Celular",
    "close": "Fechar",
    "steps": [
      "Pedido",
      "Alterações",
      "Verificação",
      "Resultado ilustrativo"
    ],
    "summaries": [
      "O texto do celular está grande demais. Adicionar três tamanhos e um ícone compacto para voltar à última mensagem.",
      "O Codex localiza os ajustes e botões. O tamanho será aplicado em todo o app e salvo.",
      "O exemplo lista verificações de tamanho, restauração e interação; não apresenta resultados de testes reais.",
      "Resultado ilustrativo: três tamanhos, pequeno por padrão e um botão de seta. Nenhum commit real."
    ]
  },
  "id": {
    "label": "Contoh pengembangan fiktif",
    "title": "Menambahkan pengaturan ukuran teks",
    "disclosure": "Contoh Mandarin fiktif · Demo UI offline · Bukan riwayat tugas nyata",
    "replay": "Putar ulang",
    "play": "Putar",
    "pause": "Jeda",
    "zoom": "Perbesar",
    "web": "Web",
    "phone": "Ponsel",
    "close": "Tutup",
    "steps": [
      "Permintaan",
      "Perubahan",
      "Verifikasi",
      "Hasil contoh"
    ],
    "summaries": [
      "Teks ponsel terlalu besar. Tambahkan tiga ukuran dan ikon ringkas untuk kembali ke pesan terbaru.",
      "Codex menemukan pengaturan dan tombol percakapan. Ukuran akan berlaku di seluruh aplikasi dan disimpan.",
      "Contoh ini memuat daftar pemeriksaan ukuran, pemulihan, dan tombol; bukan hasil pengujian nyata.",
      "Hasil contoh: tiga ukuran, kecil sebagai bawaan, dan tombol panah. Tidak mewakili commit nyata."
    ]
  },
  "ur": {
    "label": "فرضی ترقیاتی مثال",
    "title": "فونٹ سائز کی ترتیبات شامل کرنا",
    "disclosure": "فرضی چینی مثال · آف لائن انٹرفیس ڈیمو · حقیقی کام کی تاریخ نہیں",
    "replay": "دوبارہ چلائیں",
    "play": "چلائیں",
    "pause": "روکیں",
    "zoom": "بڑا دیکھیں",
    "web": "ویب",
    "phone": "موبائل",
    "close": "بند کریں",
    "steps": [
      "درخواست",
      "تبدیلی",
      "تصدیق",
      "مثالی نتیجہ"
    ],
    "summaries": [
      "فون کا متن بہت بڑا ہے۔ تین فونٹ سائز اور تازہ ترین پیغام پر واپس جانے کا چھوٹا آئیکن شامل کریں۔",
      "Codex ترتیبات اور گفتگو کے بٹن تلاش کرتا ہے۔ سائز پوری ایپ میں لاگو اور محفوظ ہوگا۔",
      "مثال میں سائز، بحالی اور بٹن کی جانچ کی فہرست ہے؛ حقیقی ٹیسٹ نتائج نہیں۔",
      "مثالی نتیجہ: تین سائز، چھوٹا بطور طے شدہ اور تیر کا بٹن۔ کسی حقیقی کمٹ کی نمائندگی نہیں۔"
    ]
  }
};
