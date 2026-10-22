import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import styles from "./community.module.css";
import GroupQr from "./group-qr";

const COMMUNITY_URL = "https://relayune.giraffetree.cn/community/";
const WORKBENCH_IMAGE =
  "/community/assets/relayune-mobile-workbench-v1.webp";

export const metadata: Metadata = {
  title: "Relayune 用户内测群 - 在手机上继续本机 Agent",
  description:
    "加入 Relayune 用户内测群，在手机上继续电脑里的 Codex、Kimi Code 与 Claude Code 任务。",
  alternates: { canonical: COMMUNITY_URL },
  openGraph: {
    title: "Relayune 用户内测群",
    description:
      "离开电脑，任务不必停下。支持 Codex、Kimi Code 与 Claude Code。",
    url: COMMUNITY_URL,
    type: "website",
    images: [
      {
        url: "https://relayune.giraffetree.cn/og.png",
        width: 1680,
        height: 941,
        alt: "Relayune",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Relayune 用户内测群",
    description:
      "在手机上继续电脑里的 Codex、Kimi Code 与 Claude Code 任务。",
    images: ["https://relayune.giraffetree.cn/og.png"],
  },
};

const providers = ["Codex", "Kimi Code", "Claude Code"] as const;

export default function CommunityPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="返回 Relayune 首页">
          <Image
            src="/brand/relayune/relayune-eclipse-static.svg"
            alt=""
            width="42"
            height="42"
            unoptimized
          />
          <span>Relayune</span>
        </Link>
        <span className={styles.domain}>relayune.giraffetree.cn</span>
      </header>

      <main>
        <section className={styles.hero} aria-labelledby="community-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>RELAYUNE COMMUNITY</p>
            <h1 id="community-title">
              离开电脑，
              <span>任务不必停下。</span>
            </h1>
            <p className={styles.lede}>
              Relayune 把电脑上的本机 Agent 安全带到手机。查看进度、回复问题、处理审批，
              再让任务回到原来的项目里继续。
            </p>

            <div className={styles.providers} aria-label="Relayune 支持的 Agent">
              {providers.map((provider) => (
                <span key={provider}>{provider}</span>
              ))}
            </div>

            <ul className={styles.proofs}>
              <li>Agent 与项目上下文留在电脑</li>
              <li>手机直接接回任务，不传整块桌面</li>
              <li>浏览器与电脑之间端到端加密</li>
            </ul>
          </div>

          <aside className={styles.groupCard} aria-labelledby="group-title">
            <p className={styles.groupKicker}>加入用户内测群</p>
            <h2 id="group-title">一起把 Agent 带出电脑</h2>
            <GroupQr />
          </aside>
        </section>

        <section className={styles.productProof} aria-labelledby="product-proof-title">
          <div className={styles.proofCopy}>
            <p className={styles.eyebrow}>REAL PRODUCT · REAL TASKS</p>
            <h2 id="product-proof-title">不是远程桌面，是你的 Agent 工作台。</h2>
            <p>
              任务列表、运行状态、审批和用量都为手机重新排版。你看到的是正在发生的工作，
              不是一块缩小后难以操作的电脑屏幕。
            </p>
            <div className={styles.featureGrid}>
              <div>
                <strong>继续任务</strong>
                <span>查看输出并补充下一步指令</span>
              </div>
              <div>
                <strong>处理审批</strong>
                <span>离开电脑也能及时做决定</span>
              </div>
              <div>
                <strong>多 Agent</strong>
                <span>Codex、Kimi Code、Claude Code</span>
              </div>
              <div>
                <strong>本机执行</strong>
                <span>项目、分支和上下文不迁移</span>
              </div>
            </div>
          </div>

          <figure className={styles.phoneFigure}>
            <div className={styles.phoneViewport}>
              <Image
                src={WORKBENCH_IMAGE}
                alt="Relayune 在 iPhone 上显示 Codex、Kimi Code 与 Claude Code 的真实工作台界面"
                width="912"
                height="1834"
                unoptimized
              />
            </div>
            <figcaption>Relayune 手机工作台实拍</figcaption>
          </figure>
        </section>
      </main>

      <footer className={styles.footer}>
        <span>Relayune · Your local Agent, anywhere.</span>
        <Link href="/zh/">了解 Relayune</Link>
      </footer>
    </div>
  );
}
