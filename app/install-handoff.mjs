export const PUBLIC_INSTALL_URL = "https://relayune.giraffetree.cn/";

const INSTALL_HANDOFF_COPY = Object.freeze({
  en: Object.freeze({
    shareText: "Open Relayune on your computer, install the desktop app, and continue your local Agent tasks from your phone.",
    mailSubject: "Install Relayune on your computer",
    mailBody: `Open this address on your computer to install Relayune for desktop:\n\n${PUBLIC_INSTALL_URL}\n\nAfter installation, continue your local Agent tasks from your phone browser.`,
  }),
  "zh-CN": Object.freeze({
    shareText: "在电脑上打开 Relayune，安装桌面端后即可从手机继续本机 Agent 任务。",
    mailSubject: "在电脑上安装 Relayune",
    mailBody: `在电脑上打开下面的地址，安装 Relayune 桌面端：\n\n${PUBLIC_INSTALL_URL}\n\n安装后即可从手机浏览器继续本机 Agent 任务。`,
  }),
  hi: Object.freeze({
    shareText: "अपने कंप्यूटर पर Relayune खोलें, डेस्कटॉप ऐप इंस्टॉल करें और अपने फ़ोन से स्थानीय Agent के कार्य जारी रखें।",
    mailSubject: "अपने कंप्यूटर पर Relayune इंस्टॉल करें",
    mailBody: `Relayune का डेस्कटॉप ऐप इंस्टॉल करने के लिए इस पते को अपने कंप्यूटर पर खोलें:\n\n${PUBLIC_INSTALL_URL}\n\nइंस्टॉल करने के बाद अपने फ़ोन के ब्राउज़र से स्थानीय Agent के कार्य जारी रखें।`,
  }),
  es: Object.freeze({
    shareText: "Abre Relayune en tu ordenador, instala la aplicación de escritorio y continúa las tareas de tu Agent local desde el teléfono.",
    mailSubject: "Instala Relayune en tu ordenador",
    mailBody: `Abre esta dirección en tu ordenador para instalar Relayune para escritorio:\n\n${PUBLIC_INSTALL_URL}\n\nDespués de instalarlo, continúa las tareas de tu Agent local desde el navegador del teléfono.`,
  }),
  ar: Object.freeze({
    shareText: "افتح Relayune على جهاز الكمبيوتر، وثبّت تطبيق سطح المكتب، ثم تابع مهام Agent المحلية من هاتفك.",
    mailSubject: "ثبّت Relayune على جهاز الكمبيوتر",
    mailBody: `افتح هذا العنوان على جهاز الكمبيوتر لتثبيت تطبيق Relayune لسطح المكتب:\n\n${PUBLIC_INSTALL_URL}\n\nبعد التثبيت، تابع مهام Agent المحلية من متصفح هاتفك.`,
  }),
  fr: Object.freeze({
    shareText: "Ouvrez Relayune sur votre ordinateur, installez l’application de bureau et poursuivez les tâches de votre Agent local depuis votre téléphone.",
    mailSubject: "Installer Relayune sur votre ordinateur",
    mailBody: `Ouvrez cette adresse sur votre ordinateur pour installer l’application de bureau Relayune :\n\n${PUBLIC_INSTALL_URL}\n\nAprès l’installation, poursuivez les tâches de votre Agent local depuis le navigateur de votre téléphone.`,
  }),
  bn: Object.freeze({
    shareText: "আপনার কম্পিউটারে Relayune খুলুন, ডেস্কটপ অ্যাপ ইনস্টল করুন এবং ফোন থেকে স্থানীয় Agent-এর কাজ চালিয়ে যান।",
    mailSubject: "আপনার কম্পিউটারে Relayune ইনস্টল করুন",
    mailBody: `Relayune ডেস্কটপ অ্যাপ ইনস্টল করতে আপনার কম্পিউটারে এই ঠিকানাটি খুলুন:\n\n${PUBLIC_INSTALL_URL}\n\nইনস্টল করার পর ফোনের ব্রাউজার থেকে স্থানীয় Agent-এর কাজ চালিয়ে যান।`,
  }),
  pt: Object.freeze({
    shareText: "Abra o Relayune no computador, instale o aplicativo para desktop e continue as tarefas do seu Agent local pelo celular.",
    mailSubject: "Instale o Relayune no computador",
    mailBody: `Abra este endereço no computador para instalar o Relayune para desktop:\n\n${PUBLIC_INSTALL_URL}\n\nApós a instalação, continue as tarefas do seu Agent local pelo navegador do celular.`,
  }),
  id: Object.freeze({
    shareText: "Buka Relayune di komputer, instal aplikasi desktop, lalu lanjutkan tugas Agent lokal dari ponsel Anda.",
    mailSubject: "Instal Relayune di komputer Anda",
    mailBody: `Buka alamat ini di komputer untuk menginstal Relayune versi desktop:\n\n${PUBLIC_INSTALL_URL}\n\nSetelah terinstal, lanjutkan tugas Agent lokal dari browser ponsel Anda.`,
  }),
  ur: Object.freeze({
    shareText: "اپنے کمپیوٹر پر Relayune کھولیں، ڈیسک ٹاپ ایپ انسٹال کریں اور فون سے مقامی Agent کے کام جاری رکھیں۔",
    mailSubject: "اپنے کمپیوٹر پر Relayune انسٹال کریں",
    mailBody: `Relayune ڈیسک ٹاپ ایپ انسٹال کرنے کے لیے یہ پتہ اپنے کمپیوٹر پر کھولیں:\n\n${PUBLIC_INSTALL_URL}\n\nانسٹال کرنے کے بعد اپنے فون کے براؤزر سے مقامی Agent کے کام جاری رکھیں۔`,
  }),
});

export function installShareData(locale = "zh-CN") {
  const copy = INSTALL_HANDOFF_COPY[locale] ?? INSTALL_HANDOFF_COPY.en;
  return Object.freeze({
    title: "Relayune",
    text: copy.shareText,
    url: PUBLIC_INSTALL_URL,
  });
}

export function installHandoffMailto(locale = "zh-CN") {
  const copy = INSTALL_HANDOFF_COPY[locale] ?? INSTALL_HANDOFF_COPY.en;
  return `mailto:?subject=${encodeURIComponent(copy.mailSubject)}&body=${encodeURIComponent(copy.mailBody)}`;
}

export const INSTALL_SHARE_DATA = installShareData("zh-CN");

export const INSTALL_HANDOFF_MAILTO = installHandoffMailto("zh-CN");

/**
 * Hand an install link from a mobile browser to a desktop using the best
 * capability available. A cancelled native share is deliberately silent.
 *
 * @param {{
 *   locale?: "en" | "zh-CN" | "hi" | "es" | "ar" | "fr" | "bn" | "pt" | "id" | "ur",
 *   share?: ((data: typeof INSTALL_SHARE_DATA) => Promise<void>) | null,
 *   canShare?: ((data: typeof INSTALL_SHARE_DATA) => boolean) | null,
 *   writeClipboard?: ((text: string) => Promise<void>) | null,
 *   openEmail?: ((url: string) => void) | null,
 * }} adapters
 * @returns {Promise<"shared" | "copied" | "email" | "cancelled">}
 */
export async function handoffInstallLink({
  locale = "zh-CN",
  share = null,
  canShare = null,
  writeClipboard = null,
  openEmail = null,
} = {}) {
  const shareData = installShareData(locale);
  const mailto = installHandoffMailto(locale);
  let nativeShareAvailable = Boolean(share);

  if (nativeShareAvailable && canShare) {
    try {
      nativeShareAvailable = canShare(shareData);
    } catch {
      nativeShareAvailable = false;
    }
  }

  if (nativeShareAvailable && share) {
    try {
      await share(shareData);
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return "cancelled";
      }
    }
  }

  if (writeClipboard) {
    try {
      await writeClipboard(PUBLIC_INSTALL_URL);
      return "copied";
    } catch {
      // Clipboard access can be blocked outside a secure browser context.
    }
  }

  openEmail?.(mailto);
  return "email";
}
