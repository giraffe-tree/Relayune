export const NOT_FOUND_BOOTSTRAP = String.raw`
(() => {
  const pathname = window.location.pathname;
  let stored = null;
  try {
    stored = window.localStorage.getItem("relayune.webLocale");
  } catch {}
  const languages = navigator.languages ?? [navigator.language ?? "en"];
  const localePaths = { en: "en", zh: "zh-CN", hi: "hi", es: "es", ar: "ar", fr: "fr", bn: "bn", pt: "pt", id: "id", ur: "ur" };
  const supported = Object.values(localePaths);
  const fromPath = localePaths[pathname.split("/")[1]?.toLowerCase()];
  const normalize = (value) => {
    const tag = String(value ?? "").trim().replaceAll("_", "-").toLowerCase();
    if (tag === "zh" || tag === "zh-cn" || tag === "zh-hans" || tag.startsWith("zh-hans-")) return "zh-CN";
    if (tag.startsWith("zh-")) return null;
    if (tag === "in" || tag.startsWith("in-")) return "id";
    const base = tag.split("-")[0];
    return supported.includes(base) ? base : null;
  };
  const locale = fromPath ?? normalize(stored) ?? languages.map(normalize).find(Boolean) ?? "en";
  const copies = {
    en: {
      eyebrow: "404 · Page not found", heading: "This route doesn’t lead anywhere",
      description: "The link may be outdated or mistyped. Return home, or continue to the security terms.",
      home: "Back to Relayune home", terms: "Terms of Service", privacy: "Privacy Policy",
      brandLabel: "Relayune home", footerLabel: "Related pages", title: "Page not found | Relayune",
    },
    "zh-CN": {
      eyebrow: "404 · 页面未找到", heading: "这条路径没有连接到任何页面",
      description: "链接可能已过期或地址有误。你可以回到首页，或继续查看安全条款。",
      home: "回到 Relayune 首页", terms: "服务条款", privacy: "隐私政策",
      brandLabel: "Relayune 首页", footerLabel: "相关页面", title: "页面未找到 | Relayune",
    },
    hi: {
      eyebrow: "404 · पेज नहीं मिला", heading: "यह रास्ता किसी पेज तक नहीं जाता",
      description: "लिंक पुराना हो सकता है या पता गलत लिखा गया है। होम पर लौटें या सुरक्षा शर्तें देखें।",
      home: "Relayune होम पर लौटें", terms: "सेवा की शर्तें", privacy: "गोपनीयता नीति",
      brandLabel: "Relayune होम", footerLabel: "संबंधित पेज", title: "पेज नहीं मिला | Relayune",
    },
    es: {
      eyebrow: "404 · Página no encontrada", heading: "Esta ruta no lleva a ninguna página",
      description: "Puede que el enlace esté obsoleto o mal escrito. Vuelve al inicio o consulta las condiciones de seguridad.",
      home: "Volver al inicio de Relayune", terms: "Términos del servicio", privacy: "Política de privacidad",
      brandLabel: "Inicio de Relayune", footerLabel: "Páginas relacionadas", title: "Página no encontrada | Relayune",
    },
    ar: {
      eyebrow: "404 · الصفحة غير موجودة", heading: "هذا المسار لا يؤدي إلى أي صفحة",
      description: "قد يكون الرابط قديمًا أو مكتوبًا بطريقة غير صحيحة. عُد إلى الرئيسية أو اطّلع على شروط الأمان.",
      home: "العودة إلى رئيسية Relayune", terms: "شروط الخدمة", privacy: "سياسة الخصوصية",
      brandLabel: "رئيسية Relayune", footerLabel: "صفحات ذات صلة", title: "الصفحة غير موجودة | Relayune",
    },
    fr: {
      eyebrow: "404 · Page introuvable", heading: "Cette adresse ne mène à aucune page",
      description: "Le lien est peut-être obsolète ou mal saisi. Revenez à l’accueil ou consultez les conditions de sécurité.",
      home: "Retour à l’accueil Relayune", terms: "Conditions d’utilisation", privacy: "Politique de confidentialité",
      brandLabel: "Accueil Relayune", footerLabel: "Pages associées", title: "Page introuvable | Relayune",
    },
    bn: {
      eyebrow: "404 · পেজ পাওয়া যায়নি", heading: "এই পথটি কোনো পেজে যায় না",
      description: "লিংকটি পুরোনো হতে পারে বা ঠিকানায় ভুল আছে। হোমে ফিরুন অথবা নিরাপত্তার শর্ত দেখুন।",
      home: "Relayune হোমে ফিরুন", terms: "পরিষেবার শর্তাবলি", privacy: "গোপনীয়তা নীতি",
      brandLabel: "Relayune হোম", footerLabel: "সম্পর্কিত পেজ", title: "পেজ পাওয়া যায়নি | Relayune",
    },
    pt: {
      eyebrow: "404 · Página não encontrada", heading: "Este caminho não leva a nenhuma página",
      description: "O link pode estar desatualizado ou incorreto. Volte ao início ou consulte os termos de segurança.",
      home: "Voltar ao início do Relayune", terms: "Termos de Serviço", privacy: "Política de Privacidade",
      brandLabel: "Início do Relayune", footerLabel: "Páginas relacionadas", title: "Página não encontrada | Relayune",
    },
    id: {
      eyebrow: "404 · Halaman tidak ditemukan", heading: "Jalur ini tidak menuju halaman mana pun",
      description: "Tautan mungkin sudah usang atau salah ketik. Kembali ke beranda atau lanjutkan ke ketentuan keamanan.",
      home: "Kembali ke beranda Relayune", terms: "Ketentuan Layanan", privacy: "Kebijakan Privasi",
      brandLabel: "Beranda Relayune", footerLabel: "Halaman terkait", title: "Halaman tidak ditemukan | Relayune",
    },
    ur: {
      eyebrow: "404 · صفحہ نہیں ملا", heading: "یہ راستہ کسی صفحے تک نہیں جاتا",
      description: "لنک پرانا ہو سکتا ہے یا پتہ غلط لکھا گیا ہے۔ ہوم پر واپس جائیں یا حفاظتی شرائط دیکھیں۔",
      home: "Relayune ہوم پر واپس", terms: "سروس کی شرائط", privacy: "رازداری کی پالیسی",
      brandLabel: "Relayune ہوم", footerLabel: "متعلقہ صفحات", title: "صفحہ نہیں ملا | Relayune",
    },
  };
  const copy = copies[locale];
  const localePath = Object.entries(localePaths).find(([, value]) => value === locale)?.[0] ?? "en";
  const base = "/" + localePath + "/";
  const paths = {
    home: base,
    terms: base + "legal/terms/",
    privacy: base + "legal/privacy/",
  };

  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "ar" || locale === "ur" ? "rtl" : "ltr";
  document.title = copy.title;
  document.querySelector("[data-not-found-page]")?.setAttribute("lang", locale);
  for (const [key, value] of Object.entries(paths)) {
    document
      .querySelector('[data-not-found-link="' + key + '"]')
      ?.setAttribute("href", value);
  }
  for (const key of ["eyebrow", "heading", "description", "home", "terms", "privacy"]) {
    const target = document.querySelector('[data-not-found-copy="' + key + '"]');
    if (target) target.textContent = copy[key];
  }
  document
    .querySelector("[data-not-found-brand]")
    ?.setAttribute("aria-label", copy.brandLabel);
  document
    .querySelector("[data-not-found-footer]")
    ?.setAttribute("aria-label", copy.footerLabel);
  const heading = document.querySelector("[data-not-found-copy=\"heading\"]");
  if (document.activeElement === document.body) {
    heading?.focus({ preventScroll: true });
  }
})();
`;
