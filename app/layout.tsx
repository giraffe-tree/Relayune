import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "Relayune — 随时回到你的本机 Agent";
const description =
  "安全连接电脑上的 Codex、Kimi Code 与 Claude Code，在浏览器继续本机任务。";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_RELAY_ORIGIN ??
      "https://relayune.giraffetree.cn",
  ),
  title,
  description,
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title,
    description,
    type: "website",
    images: [{ url: "/og.png", width: 1680, height: 941, alt: "Relayune" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" dir="ltr">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
