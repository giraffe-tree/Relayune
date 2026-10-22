import Link from "next/link";
import type { LegalDocument } from "./legal-page";

const CONTACT = "giraffetree1@gmail.com";

export const zhTerms: LegalDocument = {
  locale: "zh-CN",
  kind: "terms",
  eyebrow: "LEGAL · RELAYUNE",
  title: "Relayune 服务条款",
  summary: "本条款约定您访问和使用 Relayune 网站、Web 应用及桌面端时，您与服务运营者之间的权利和责任。",
  effectiveLabel: "生效日期",
  effectiveDate: "2026 年 8 月 7 日",
  updatedLabel: "最后更新",
  updatedDate: "2026 年 10 月 22 日",
  versionLabel: "版本",
  version: "1.11",
  noticeTitle: "请在使用前阅读",
  notice: <p>使用 Relayune 即表示您同意本条款及我们的 <Link href="/zh/legal/privacy/">隐私政策</Link>。如果您不同意，请不要访问或使用服务。</p>,
  sections: [
    {
      id: "acceptance",
      title: "条款接受与运营者",
      content: <>
        <p>Relayune 由 Ernest / giraffe-tree（位于中国上海的个人开发者，以下简称“我们”或“运营者”）提供。本条款适用于 <a href="https://relayune.giraffetree.cn">relayune.giraffetree.cn</a>、Relayune 桌面应用及其相关服务（统称“服务”）。</p>
        <p>您必须年满 18 周岁，并具有订立有约束力协议的法律能力。代表组织使用服务时，您确认已获得代表该组织接受本条款的授权。</p>
      </>,
    },
    {
      id: "service",
      title: "服务说明",
      content: <>
        <p>Relayune 让您通过浏览器安全连接自己控制的 macOS 或 Windows 电脑，在远程界面中继续本机 Codex、Kimi Code、Claude Code 等兼容 Agent 的任务。桌面端运行 Agent 并保存密钥；服务器负责邮箱登录、设备路由、密文队列与在线状态。</p><p>本版本不设置 Relayune 付费功能或按使用期锁定。设备、网络和第三方 Agent 或模型服务的费用由您自行承担。项目自有源码采用仓库 LICENSE 中的 MIT 许可证，第三方组件保留各自许可。此处的托管服务条款不改变源码许可。</p>
        <p>服务目前向能够接收验证邮件的合法邮箱开放注册，并以测试版形式提供。为保护用户与服务安全，我们可能对注册和邮件发送进行限流，或暂停涉嫌滥用的账户。功能、支持平台和可用范围可能调整。我们不承诺服务在所有设备、网络、地区或第三方 Agent 版本上可用。</p>
      </>,
    },
    {
      id: "account-security",
      title: "账户、设备与安全",
      content: <>
        <p>您应提供准确的邮箱信息，为 Relayune 使用独立且安全的密码，并妥善保护登录会话、桌面设备、8 位一次性连接码和已授权客户端。您对自己账户和已授权设备发起的操作负责。</p>
        <ul>
          <li>不要共享密码、连接码或浏览器授权；</li>
          <li>仅在您信任并控制的设备上完成配对；</li>
          <li>发现未授权访问时，立即在桌面端撤销对应浏览器，并联系我们；</li>
          <li>您不得尝试绕过注册或登录限流、配对确认、加密或其他安全控制。</li>
        </ul>
      </>,
    },
    {
      id: "third-parties",
      title: "第三方 Agent 与服务",
      content: <>
        <p>Relayune 是连接工具，不提供 Codex、Kimi Code、Claude Code 或其底层模型。您选择的本机 Agent、模型、账户和相关订阅由对应第三方独立提供，并受其条款、隐私政策、许可和使用限制约束。Relayune 与这些第三方不存在代理、背书或保证关系。</p>
        <p>桌面端解密您的指令后，会把指令交给您选择并在本机运行的 Agent。该 Agent 如何处理输入、生成输出或连接其提供商，由您与该第三方之间的安排决定。您有责任确认自己有权使用这些工具和内容。</p>
      </>,
    },
    {
      id: "acceptable-use",
      title: "可接受使用",
      content: <>
        <p>您只能将服务用于合法、获得授权且符合第三方条款的目的。您不得使用服务：</p>
        <ul>
          <li>访问、控制或干扰您无权使用的电脑、账户、系统或数据；</li>
          <li>开发或传播恶意软件、钓鱼、凭据窃取、破坏性脚本或其他网络攻击能力；</li>
          <li>侵犯知识产权、隐私权、人格权，或生成、保存、传播违法内容；</li>
          <li>规避安全限制、探测生产系统、滥用接口，或对服务造成不合理负载；</li>
          <li>在没有合格人员复核与适当保障的情况下，将 Agent 输出直接用于医疗、法律、金融、人身安全或其他高风险决定；</li>
          <li>转售、出租或向不受您管理的第三方提供服务访问，除非我们书面同意。</li>
        </ul>
      </>,
    },
    {
      id: "content",
      title: "您的内容与操作",
      content: <>
        <p>在您与我们之间，您保留对自己提交内容及合法取得输出的权利。您授予我们一项有限、非独占、仅为提供服务所必需的许可，用于接收、保存和路由端到端加密的数据及必要元数据。该许可在相关数据删除后终止，但法律要求保留的情况除外。</p>
        <p>服务器无法读取业务内容，但您的浏览器、桌面端和所选本机 Agent 可以处理明文。您负责输入、命令、审批决定、输出使用以及由此对本机文件、代码库、云服务或第三方造成的后果。提交内容前，请确保您拥有必要权利并已备份重要数据。</p>
      </>,
    },
    {
      id: "privacy-security",
      title: "隐私与加密",
      content: <>
        <p>我们如何收集、使用和保存个人信息，详见 <Link href="/zh/legal/privacy/">Relayune 隐私政策</Link>。业务载荷采用端到端加密设计，服务器只保存密文及经过认证的路由元数据，不接收 8 位连接码或最终内容密钥。</p>
        <p>任何安全措施都无法保证绝对安全。当前 PAKE 依赖尚未完成独立密码学审计的第三方实现，因此在扩大正式使用范围前仍需进一步审计。请勿把 Relayune 作为处理国家秘密、受特别监管数据或无法承受泄露风险数据的唯一保护措施。</p>
      </>,
    },
    {
      id: "availability",
      title: "更新、可用性与测试版风险",
      content: <>
        <p>我们可以维护、更新、限制或停止部分服务，并会在合理可行时提前通知重大变化。安全更新可能需要您及时升级桌面端。旧版本、第三方接口变化、网络故障或本机 Agent 状态可能导致服务不可用。</p>
        <p>请为代码、文件和重要工作建立独立备份。Relayune 不是备份、归档、灾难恢复或持续可用性服务。</p>
      </>,
    },
    {
      id: "termination",
      title: "暂停、终止与删除",
      content: <>
        <p>您可以停止使用服务、在桌面端撤销浏览器授权，或发送邮件至 <a href={`mailto:${CONTACT}`}>{CONTACT}</a> 请求删除账户。若您违反本条款、危及服务安全、侵害他人权利，或法律要求我们采取行动，我们可以限制、暂停或终止访问。</p>
        <p>终止后，您继续受知识产权、责任限制、争议解决及其他按其性质应持续有效的条款约束。个人信息与加密数据的删除方式以隐私政策为准。</p>
      </>,
    },
    {
      id: "disclaimers",
      title: "免责声明",
      content: <>
        <p>在适用法律允许的最大范围内，服务按“现状”和“可用”提供。我们不保证服务无错误、不中断、适合特定目的，也不保证第三方 Agent 的输出准确、完整、安全、合法或不侵权。</p>
        <p>Agent 可能执行具有现实后果的命令。您应在执行前审阅高风险操作，并自行验证输出。法律不允许排除的消费者权利、法定保证或责任不受本条款影响。</p>
      </>,
    },
    {
      id: "liability",
      title: "责任限制",
      content: <>
        <p>在适用法律允许的最大范围内，我们不对利润、数据、商誉、业务机会损失或任何间接、附带、特殊、后果性损害承担责任。任何责任限制均以适用法律允许的范围为限，不排除法律规定不可排除的责任。</p>
        <p>上述限制不适用于故意或重大过失、人身伤害、欺诈，或法律禁止限制的其他责任。</p>
      </>,
    },
    {
      id: "law-changes-contact",
      title: "适用法律、条款变更与联系",
      content: <>
        <p>本条款受中华人民共和国法律管辖，但不影响您依据居住地强制性法律享有的权利。发生争议时，双方应先通过邮件善意协商；协商不成的，可向运营者所在地有管辖权的人民法院提起诉讼。</p>
        <p>我们可能更新本条款。重大变更通常会至少提前 15 天通过服务页面或注册邮箱通知；因法律或紧急安全原因需要立即生效的除外。更新后的版本会标明日期和版本号。</p>
        <p>问题或法律通知请发送至 <a href={`mailto:${CONTACT}`}>{CONTACT}</a>。中英文版本具有相同意图；如解释存在冲突，在适用法律允许范围内以简体中文版本为准。</p>
      </>,
    },
  ],
};

export const enTerms: LegalDocument = {
  locale: "en",
  kind: "terms",
  eyebrow: "LEGAL · RELAYUNE",
  title: "Relayune Terms of Service",
  summary: "These Terms govern the relationship between you and the service operator when you access the Relayune website, web app, or desktop app.",
  effectiveLabel: "Effective",
  effectiveDate: "August 7, 2026",
  updatedLabel: "Last updated",
  updatedDate: "October 22, 2026",
  versionLabel: "Version",
  version: "1.11",
  noticeTitle: "Please read before using Relayune",
  notice: <p>By using Relayune, you agree to these Terms and our <Link href="/en/legal/privacy/">Privacy Policy</Link>. If you do not agree, do not access or use the Service.</p>,
  sections: [
    {
      id: "acceptance",
      title: "Acceptance and operator",
      content: <>
        <p>Relayune is provided by Ernest / giraffe-tree, an individual developer based in Shanghai, China (&quot;we,&quot; &quot;us,&quot; or the &quot;operator&quot;). These Terms apply to <a href="https://relayune.giraffetree.cn">relayune.giraffetree.cn</a>, the Relayune desktop app, and related services (collectively, the &quot;Service&quot;).</p>
        <p>You must be at least 18 and legally capable of entering a binding agreement. If you use the Service for an organization, you confirm that you are authorized to accept these Terms for it.</p>
      </>,
    },
    {
      id: "service",
      title: "The Service",
      content: <>
        <p>Relayune lets you securely connect from a browser to a macOS or Windows computer you control and continue tasks in compatible local agents such as Codex, Kimi Code, and Claude Code. The desktop app runs the agent and stores keys; the server provides email authentication, device routing, encrypted queues, and presence.</p><p>This version has no Relayune paid features or access-period lock. You remain responsible for device, network, and third-party agent or model costs. Project-owned source is available under the MIT License in the repository LICENSE file; third-party components retain their own licenses. These hosted-service terms do not replace the source license.</p>
        <p>The Service currently permits registration with any valid email address that can receive a verification message and is offered as a beta. To protect users and the Service, we may rate-limit registration and email delivery or suspend accounts associated with abuse. Features, supported platforms, and availability may change. We do not promise compatibility with every device, network, location, or third-party agent version.</p>
      </>,
    },
    {
      id: "account-security",
      title: "Accounts, devices, and security",
      content: <>
        <p>You must provide an accurate email address, use a strong password unique to Relayune, and protect your sessions, desktop devices, one-time eight-character pairing codes, and authorized browsers. You are responsible for activity initiated through your account and authorized devices.</p>
        <ul>
          <li>Do not share passwords, pairing codes, or browser authorizations.</li>
          <li>Pair only devices you trust and control.</li>
          <li>If you suspect unauthorized access, revoke that browser in the desktop app and contact us promptly.</li>
          <li>Do not bypass registration or sign-in rate limits, pairing confirmations, encryption, or other security controls.</li>
        </ul>
      </>,
    },
    {
      id: "third-parties",
      title: "Third-party agents and services",
      content: <>
        <p>Relayune is a connection tool. It does not provide Codex, Kimi Code, Claude Code, or their underlying models. The local agents, model accounts, and subscriptions you choose are independently provided and governed by their own terms, privacy policies, licenses, and use restrictions. Relayune does not act as their agent and does not endorse or guarantee them.</p>
        <p>After decrypting your instruction, the desktop app passes it to the local agent you selected. How that agent processes inputs, produces outputs, or connects to its provider is governed by your relationship with that third party. You are responsible for ensuring that you may use those tools and materials.</p>
      </>,
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      content: <>
        <p>You may use the Service only for lawful, authorized purposes consistent with applicable third-party terms. You must not use it to:</p>
        <ul>
          <li>access, control, or interfere with computers, accounts, systems, or data you are not authorized to use;</li>
          <li>create or distribute malware, phishing, credential theft, destructive scripts, or other cyberattack capabilities;</li>
          <li>infringe intellectual property, privacy, or personality rights, or create, store, or distribute unlawful material;</li>
          <li>circumvent safeguards, probe production systems, abuse interfaces, or impose unreasonable loads;</li>
          <li>use agent output directly for medical, legal, financial, personal-safety, or other high-risk decisions without qualified review and appropriate safeguards; or</li>
          <li>resell, rent, or provide access to unmanaged third parties without our written permission.</li>
        </ul>
      </>,
    },
    {
      id: "content",
      title: "Your content and actions",
      content: <>
        <p>As between you and us, you retain rights in your inputs and in outputs you lawfully obtain. You grant us a limited, non-exclusive license only as necessary to receive, store, and route end-to-end encrypted data and required metadata. That license ends when the relevant data is deleted, except where retention is legally required.</p>
        <p>The server cannot read business content, but your browser, desktop app, and selected local agent can process plaintext. You are responsible for inputs, commands, approvals, output use, and resulting effects on local files, repositories, cloud services, or third parties. Confirm that you have the required rights and back up important data before submitting it.</p>
      </>,
    },
    {
      id: "privacy-security",
      title: "Privacy and encryption",
      content: <>
        <p>Our collection, use, and retention of personal data are described in the <Link href="/en/legal/privacy/">Relayune Privacy Policy</Link>. Business payloads are designed for end-to-end encryption. The server stores ciphertext and authenticated routing metadata and does not receive the pairing code or final content keys.</p>
        <p>No security measure is absolute. The current PAKE flow depends on a third-party implementation that has not completed an independent cryptographic audit, so further review is required before broader production use. Do not rely on Relayune as the sole safeguard for state secrets, specially regulated data, or data for which any disclosure would be unacceptable.</p>
      </>,
    },
    {
      id: "availability",
      title: "Updates, availability, and beta risk",
      content: <>
        <p>We may maintain, update, limit, or discontinue parts of the Service and will give advance notice of material changes where reasonably practicable. Security updates may require prompt desktop upgrades. Old versions, third-party interface changes, network failures, or local-agent status may make the Service unavailable.</p>
        <p>Maintain independent backups of code, files, and important work. Relayune is not a backup, archive, disaster recovery, or continuous-availability service.</p>
      </>,
    },
    {
      id: "termination",
      title: "Suspension, termination, and deletion",
      content: <>
        <p>You may stop using the Service, revoke browser access in the desktop app, or email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> to request account deletion. We may limit, suspend, or terminate access if you breach these Terms, threaten service security, infringe rights, or if required by law.</p>
        <p>After termination, provisions that by their nature should survive remain effective, including intellectual-property, liability, and dispute terms. The Privacy Policy explains deletion of personal data and encrypted records.</p>
      </>,
    },
    {
      id: "disclaimers",
      title: "Disclaimers",
      content: <>
        <p>To the fullest extent permitted by law, the Service is provided &quot;as is&quot; and &quot;as available.&quot; We do not warrant that it will be error-free, uninterrupted, or fit for a particular purpose, or that third-party agent output will be accurate, complete, secure, lawful, or non-infringing.</p>
        <p>Agents can execute commands with real-world effects. Review high-risk actions before execution and independently verify outputs. These Terms do not affect consumer rights, statutory warranties, or liabilities that cannot lawfully be excluded.</p>
      </>,
    },
    {
      id: "liability",
      title: "Limitation of liability",
      content: <>
        <p>To the fullest extent permitted by law, we are not liable for lost profits, data, goodwill, or opportunities, or for indirect, incidental, special, consequential, or punitive damages. Any limitation of liability applies only to the extent permitted by applicable law and does not exclude liability that cannot legally be excluded.</p>
        <p>These limits do not apply to intentional misconduct, gross negligence, personal injury, fraud, or any liability that applicable law does not permit us to limit.</p>
      </>,
    },
    {
      id: "law-changes-contact",
      title: "Governing law, changes, and contact",
      content: <>
        <p>These Terms are governed by the laws of the People&apos;s Republic of China, without reducing mandatory rights you have under the law where you live. Before filing a formal claim, the parties will try in good faith to resolve the dispute by email. Unresolved disputes may be brought before a competent court where the operator is located.</p>
        <p>We may update these Terms. Material changes will normally be announced through the Service or your registered email at least 15 days in advance, except where law or urgent security needs require immediate effect. Updated versions will identify their date and version.</p>
        <p>Send questions or legal notices to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. The Chinese and English versions share the same intent. If they conflict, the Simplified Chinese version controls to the extent permitted by law.</p>
      </>,
    },
  ],
};

export const zhPrivacy: LegalDocument = {
  locale: "zh-CN",
  kind: "privacy",
  eyebrow: "PRIVACY · RELAYUNE",
  title: "Relayune 隐私政策",
  summary: "本政策说明 Relayune 收集哪些个人信息、为什么使用、保存多久，以及您如何管理或删除这些信息。",
  effectiveLabel: "生效日期",
  effectiveDate: "2026 年 8 月 7 日",
  updatedLabel: "最后更新",
  updatedDate: "2026 年 8 月 31 日",
  versionLabel: "版本",
  version: "1.3",
  noticeTitle: "隐私设计摘要",
  notice: <p>浏览器与您的桌面端是业务内容的明文端点。Relayune 服务器只处理端到端加密的业务载荷和必要路由元数据，不接收 8 位连接码、最终内容密钥或业务明文。</p>,
  sections: [
    {
      id: "controller-scope",
      title: "运营者与适用范围",
      content: <>
        <p>本服务的个人信息处理者/数据控制者为 Ernest / giraffe-tree（以 Relayune 名义运营，位于中国上海的个人开发者）。联系邮箱：<a href={`mailto:${CONTACT}`}>{CONTACT}</a>。如适用法律要求邮寄地址，您可通过该邮箱在完成必要身份验证后索取。</p>
        <p>本政策适用于 Relayune 网站、Web 应用、桌面应用及与之直接相关的支持沟通。第三方 Codex、Kimi Code、Claude Code、模型提供商或外部链接有各自的隐私政策，本政策不替代它们。</p>
      </>,
    },
    {
      id: "data-collected",
      title: "我们收集的信息",
      content: <>
        <h3>您提供的信息</h3>
        <ul>
          <li><strong>账户信息：</strong>规范化邮箱、账户偏好，以及您设置的密码所生成的随机盐 scrypt 摘要；我们不保存密码明文。</li>
          <li><strong>支持信息：</strong>您主动发送的邮件、问题描述和为排障提供的材料。</li>
        </ul>
        <h3>服务产生的信息</h3>
        <ul>
          <li><strong>设备与配对元数据：</strong>随机用户、设备、浏览器、配对和请求编号，设备/浏览器名称，内容密钥标识符（不可用于恢复密钥），授权和最近使用时间。</li>
          <li><strong>认证与安全信息：</strong>登录和会话 token、设备及浏览器授权 token 的 SHA-256 摘要、配对公开 share 和双方确认值，以及登录尝试时邮箱与来源地址的短期哈希。Nginx 为建立网络连接会处理来源 IP；发生 TLS 或反向代理错误时，来源 IP 与请求 URI 可能进入受限的基础设施错误日志。</li>
          <li><strong>路由与运行元数据：</strong>密文方向、类型、大小、队列状态、时间、过期时间、序号、在线状态、延迟，以及请求方法、路由模板、状态码和耗时。</li>
          <li><strong>加密业务数据：</strong>消息、历史、附件、项目路径、会话信息、审批和 Agent 输出以 A256GCM envelope 形式保存或转发。服务器不能解密其内容。</li>
        </ul>
        <p>我们不主动收集精确位置、通讯录、支付卡或广告标识符，也不使用业务内容训练模型。</p>
      </>,
    },
    {
      id: "local-data",
      title: "仅保存在您设备上的信息",
      content: <>
        <p>浏览器在 IndexedDB 中保存不可导出的内容密钥、原始浏览器授权 token、随机设备编号和配对状态。桌面端在应用数据目录内经过认证加密的本机 vault 中保存设备 token 和每个浏览器独立的内容密钥，不使用 macOS Keychain 或 Windows Credential Manager。</p>
        <p>这些原始密钥和 token 不上传服务器，也不进入应用配置、日志或明文文件。清除浏览器站点数据、卸载桌面端或删除加密 vault 可能导致您失去访问能力；请按产品流程重新配对，不要复制密钥。</p>
      </>,
    },
    {
      id: "purposes-bases",
      title: "处理目的与法律依据",
      content: <>
        <div className="legal-table-wrap">
          <table>
            <thead><tr><th>目的</th><th>主要信息</th><th>法律依据</th></tr></thead>
            <tbody>
              <tr><td>创建账户、登录、配对和提供远程连接</td><td>邮箱、认证摘要、设备和路由元数据、密文</td><td>履行与您的服务合同</td></tr>
              <tr><td>防止滥用、排查故障、保护服务</td><td>短期网络哈希、安全事件、脱敏日志</td><td>履行合同与我们的合法利益</td></tr>
              <tr><td>响应支持、删除和权利请求</td><td>联系方式、沟通和验证信息</td><td>履行合同、同意或法律义务</td></tr>
              <tr><td>遵守有效法律要求</td><td>请求涉及的最少必要信息</td><td>法律义务</td></tr>
            </tbody>
          </table>
        </div>
        <p>我们目前不进行广告投放、行为画像或营销邮件，也不出售个人信息。若未来新增非必要分析或营销，我们会先更新政策并在法律要求时取得同意。</p>
      </>,
    },
    {
      id: "cookies-storage",
      title: "Cookie 与本地存储",
      content: <>
        <p>Web 应用只使用提供核心功能所必需的 HttpOnly 登录会话 Cookie。浏览器还使用 IndexedDB 保存配对和端到端加密所需的本地凭据。我们不使用第三方广告 Cookie、跨站追踪像素或分析 Cookie。</p>
        <p>拒绝或清除这些必要存储会使登录、配对或加密会话无法继续。中英文页面通过不同 URL 提供，不需要语言偏好 Cookie。</p>
      </>,
    },
    {
      id: "sharing",
      title: "共享、委托处理与第三方 Agent",
      content: <>
        <p>我们不出售您的个人信息，也不为跨场景行为广告共享个人信息。我们只在下列范围披露最少必要信息：</p>
        <ul>
          <li><strong>基础设施：</strong>阿里云承载位于中国的生产服务器。MongoDB 与私有密文 blob 均不公开，只通过本机 loopback 与应用通信。</li>
          <li><strong>邮件传输：</strong>邮件基础设施为完成验证邮件而处理收件邮箱、投递元数据和必要邮件内容。</li>
          <li><strong>法律要求：</strong>在收到具有法律效力的请求，或为保护用户、公众和服务安全确有必要时。</li>
          <li><strong>业务变更：</strong>若发生重组、合并或资产转移，接收方必须继续遵守本政策并在法律要求时提前通知您。</li>
        </ul>
        <p>当您通过 Relayune 使用本机 Codex、Kimi Code 或 Claude Code 时，桌面端会将解密后的指令交给您选择的 Agent。该处理发生在您控制的电脑和第三方账户环境中；对应提供商独立决定其处理活动，请查阅其政策和设置。</p>
      </>,
    },
    {
      id: "retention",
      title: "保存期限",
      content: <>
        <ul>
          <li>邮箱验证链接、密码设置会话和配对会话：最长 10 分钟；</li>
          <li>Web 登录会话：最长 8 小时；</li>
          <li>失败登录限流哈希：最长 15 分钟；</li>
          <li>基础设施错误日志：按日轮换，通常最长约 11 天；</li>
          <li>远程命令的有效投递期：最长 24 小时；到期后不再投递，去重记录在到期后 5 分钟进入清理；</li>
          <li>加密实时事件的可读取窗口为创建后 10 分钟，加密查询响应为创建后 5 分钟，重复上传不延长窗口；到期后由后台分批回收记录和响应文件，物理删除可能滞后；</li>
          <li>账户、设备、浏览器授权、最新加密目录和必要元数据：在账户或相关授权处于活动状态期间保留；撤销授权会停止后续访问与新数据写入，但历史密文可能保留到删除请求或例行清理；</li>
          <li>支持通信：通常不超过最后一次联系后 24 个月，法律争议需要更久保留的除外。</li>
        </ul>
        <p>经验证的删除请求通常在 30 天内从在线系统完成；备份副本（如有）在正常轮换中最长 90 天内覆盖，除非法律要求更长保留。超过必要期限后，我们会删除或去标识化信息。</p>
      </>,
    },
    {
      id: "security",
      title: "安全措施与限制",
      content: <>
        <p>我们采用 HTTPS、RFC 9382 SPAKE2 PAKE、HKDF 密钥分离、AES-256-GCM 业务 envelope、每浏览器独立密钥、token 摘要、最小权限 MongoDB 账户、loopback-only 服务和脱敏日志等措施。应用普通日志不记录请求体、Authorization、Cookie、连接码或业务明文；基础设施错误日志可能包含上一节披露的网络信息。</p>
        <p>没有任何系统绝对安全。服务器仍可见登录邮箱、随机标识符、密文大小、方向、时间和在线状态，因此流量分析不在端到端加密保护范围内。当前 PAKE 依赖尚未完成独立密码学审计；发现潜在安全问题请尽快发送至 <a href={`mailto:${CONTACT}`}>{CONTACT}</a>。</p>
        <p>本设计不保护已被控制的浏览器、桌面端、本机 Agent、浏览器扩展、依赖供应链或用户屏幕。Web 版从服务器加载前端脚本；如果强恶意服务器替换这些脚本，脚本可能在浏览器解密后外传内容。需要抵抗这一威胁时，应优先使用签名且可独立校验的原生客户端或扩展，并固定发布密钥与前端版本。</p>
      </>,
    },
    {
      id: "international",
      title: "跨境访问与传输",
      content: <>
        <p>生产服务器位于中国。您从其他国家或地区访问时，账户信息、路由元数据和密文可能跨境传输到中国。我们以合同履行、安全措施和适用法律要求作为处理基础，并仅传输提供服务所需的信息。</p>
        <p>您选择的 Codex、Kimi Code、Claude Code 或模型提供商可能在其他国家处理本机 Agent 收到的内容；这属于您与该第三方之间的处理关系，请查看其数据区域、跨境机制和账户设置。</p>
      </>,
    },
    {
      id: "rights",
      title: "您的权利与选择",
      content: <>
        <p>根据适用法律，您可以请求知情、访问、更正、复制、删除、限制或反对处理，撤回同意，并就我们的处理向主管机关投诉。撤回同意不影响撤回前处理的合法性。</p>
        <p>您可在桌面端单独撤销客户端授权，或清除浏览器站点数据移除本地凭据。手机 App 的账户设置提供「删除账户」：验证密码后，删除账户、设备授权、偏好、反馈及服务器关联的中转数据，并销毁本手机的历史缓存密钥；电脑上的 Agent 项目和文件不会被删除。清理中断时，账户访问会停止，后台会继续重试。</p>
        <p>如需账户级访问、更正或其他权利协助，请从注册邮箱联系 <a href={`mailto:${CONTACT}`}>{CONTACT}</a>。我们会验证身份，并通常在 30 天内回复；复杂请求可依法律延长并说明原因。我们不会仅因您行使隐私权而歧视您。</p>
      </>,
    },
    {
      id: "children",
      title: "未成年人",
      content: <p>Relayune 面向年满 18 周岁的用户。我们不会故意收集未满 18 周岁人士的个人信息。如您认为未成年人向我们提供了信息，请联系我们，我们会核查并在适用时删除。</p>,
    },
    {
      id: "changes-contact",
      title: "政策变更与联系我们",
      content: <>
        <p>我们可能更新本政策。重大变更通常会至少提前 15 天通过服务页面或注册邮箱通知；因法律或紧急安全原因需要立即生效的除外。我们会保留版本号和最后更新日期。</p>
        <p>隐私问题、安全报告或权利请求请发送至 <a href={`mailto:${CONTACT}`}>{CONTACT}</a>。中英文版本具有相同意图；如解释存在冲突，在适用法律允许范围内以简体中文版本为准。</p>
      </>,
    },
  ],
};

export const enPrivacy: LegalDocument = {
  locale: "en",
  kind: "privacy",
  eyebrow: "PRIVACY · RELAYUNE",
  title: "Relayune Privacy Policy",
  summary: "This Policy explains what personal data Relayune collects, why it is used, how long it is retained, and how you can manage or delete it.",
  effectiveLabel: "Effective",
  effectiveDate: "August 7, 2026",
  updatedLabel: "Last updated",
  updatedDate: "August 31, 2026",
  versionLabel: "Version",
  version: "1.3",
  noticeTitle: "Privacy design in brief",
  notice: <p>Your browser and desktop app are the plaintext endpoints for business content. The Relayune server processes only end-to-end encrypted payloads and necessary routing metadata. It does not receive the pairing code, final content keys, or business plaintext.</p>,
  sections: [
    {
      id: "controller-scope",
      title: "Controller and scope",
      content: <>
        <p>The controller/operator is Ernest / giraffe-tree, an individual developer based in Shanghai, China and operating as Relayune. Contact: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. Where applicable law requires a postal address, you may request it by email after necessary identity verification.</p>
        <p>This Policy applies to the Relayune website, web app, desktop app, and directly related support communications. Codex, Kimi Code, Claude Code, model providers, and external links have their own privacy policies, which this Policy does not replace.</p>
      </>,
    },
    {
      id: "data-collected",
      title: "Data we collect",
      content: <>
        <h3>Data you provide</h3>
        <ul>
          <li><strong>Account data:</strong> your normalized email address, account preferences, and a randomly salted scrypt digest of the password you set. We do not store plaintext passwords.</li>
          <li><strong>Support data:</strong> emails, issue descriptions, and troubleshooting materials you choose to send.</li>
        </ul>
        <h3>Data generated by the Service</h3>
        <ul>
          <li><strong>Device and pairing metadata:</strong> random user, device, browser, pairing, and request identifiers; device/browser labels; a content-key identifier that cannot recover the key; authorization and recent-use times.</li>
          <li><strong>Authentication and security data:</strong> SHA-256 digests of login/session tokens and device/browser-authorization tokens; public pairing shares and mutual confirmations; and short-lived hashes of email and source address for login attempts. Nginx processes source IP addresses to establish network connections; when TLS or reverse-proxy errors occur, a source IP and request URI may enter a restricted infrastructure error log.</li>
          <li><strong>Routing and operational metadata:</strong> ciphertext direction, type, size, queue state, timestamps, expiry, sequence, presence, latency, request method, route template, response status, and duration.</li>
          <li><strong>Encrypted business data:</strong> messages, history, attachments, project paths, session data, approvals, and agent output are stored or relayed as A256GCM envelopes. The server cannot decrypt their content.</li>
        </ul>
        <p>We do not intentionally collect precise location, contacts, payment-card data, or advertising identifiers, and we do not train models on business content.</p>
      </>,
    },
    {
      id: "local-data",
      title: "Data kept only on your devices",
      content: <>
        <p>The browser stores a non-exportable content key, the original browser-authorization token, a random device identifier, and pairing state in IndexedDB. The desktop app stores the device token and a separate content key for each browser in an authenticated encrypted vault in its application-data directory; it does not use macOS Keychain or Windows Credential Manager.</p>
        <p>These original keys and tokens are not uploaded to the server or written to app configuration, logs, or plaintext files. Clearing site data, uninstalling the desktop app, or deleting the encrypted vault may remove access. Re-pair through the product flow instead of copying keys.</p>
      </>,
    },
    {
      id: "purposes-bases",
      title: "Purposes and legal bases",
      content: <>
        <div className="legal-table-wrap">
          <table>
            <thead><tr><th>Purpose</th><th>Main data</th><th>Legal basis</th></tr></thead>
            <tbody>
              <tr><td>Create accounts, sign in, pair devices, and provide remote access</td><td>Email, authentication digests, device/routing metadata, ciphertext</td><td>Performance of our contract with you</td></tr>
              <tr><td>Prevent abuse, troubleshoot, and secure the Service</td><td>Short-lived network hashes, security events, redacted logs</td><td>Contract performance and our legitimate interests</td></tr>
              <tr><td>Answer support, deletion, and rights requests</td><td>Contact, communication, and verification data</td><td>Contract, consent, or legal obligation</td></tr>
              <tr><td>Comply with valid legal process</td><td>Minimum data relevant to the request</td><td>Legal obligation</td></tr>
            </tbody>
          </table>
        </div>
        <p>We currently do not run advertising, behavioral profiling, or marketing email and do not sell personal data. If non-essential analytics or marketing are introduced, we will update this Policy first and seek consent where required.</p>
      </>,
    },
    {
      id: "cookies-storage",
      title: "Cookies and local storage",
      content: <>
        <p>The web app uses only an HttpOnly session cookie required for core authentication. It also uses IndexedDB for local credentials required by pairing and end-to-end encryption. We do not use third-party advertising cookies, cross-site tracking pixels, or analytics cookies.</p>
        <p>Blocking or clearing this required storage will prevent login, pairing, or encrypted sessions from continuing. Chinese and English pages use separate URLs and do not require a language-preference cookie.</p>
      </>,
    },
    {
      id: "sharing",
      title: "Sharing, processors, and third-party agents",
      content: <>
        <p>We do not sell personal data or share it for cross-context behavioral advertising. We disclose only the minimum data needed in these circumstances:</p>
        <ul>
          <li><strong>Infrastructure:</strong> Alibaba Cloud hosts the production server in China. MongoDB and private ciphertext blobs are not public and communicate with the app over loopback only.</li>
          <li><strong>Email delivery:</strong> email infrastructure processes the recipient address, delivery metadata, and required message content to deliver verification emails.</li>
          <li><strong>Legal process:</strong> where required by a valid legal request or necessary to protect users, the public, or Service security.</li>
          <li><strong>Business change:</strong> in a reorganization, merger, or asset transfer, the recipient must continue this Policy and give notice where required.</li>
        </ul>
        <p>When you use local Codex, Kimi Code, or Claude Code through Relayune, the desktop app gives the decrypted instruction to your selected agent. That processing occurs on your computer and within your third-party account environment. The relevant provider independently determines its processing; review its policy and settings.</p>
      </>,
    },
    {
      id: "retention",
      title: "Retention",
      content: <>
        <ul>
          <li>Email-verification links, password-setup sessions, and pairing sessions: up to 10 minutes.</li>
          <li>Web login sessions: up to 8 hours.</li>
          <li>Failed-login rate-limit hashes: up to 15 minutes.</li>
          <li>Infrastructure error logs: rotated daily and normally retained for up to about 11 days.</li>
          <li>Remote-command delivery window: up to 24 hours. Expired commands are not delivered; deduplication records become eligible for cleanup five minutes after expiry.</li>
          <li>Encrypted live events remain readable for 10 minutes after creation, and encrypted query responses for five minutes. Retries do not extend these windows. Background cleanup reclaims expired records and response files in batches; physical deletion may lag.</li>
          <li>Account, device, browser authorization, latest encrypted catalogs, and required metadata: while the account or authorization remains active. Revocation stops further access and new writes, but historical ciphertext may remain until a deletion request or routine cleanup.</li>
          <li>Support communications: normally no more than 24 months after the last contact, unless a legal dispute requires longer retention.</li>
        </ul>
        <p>Verified deletion requests are normally completed in live systems within 30 days. Backup copies, if any, are overwritten through ordinary rotation within no more than 90 days unless longer retention is legally required. Data is deleted or de-identified when no longer necessary.</p>
      </>,
    },
    {
      id: "security",
      title: "Security measures and limits",
      content: <>
        <p>Measures include HTTPS, RFC 9382 SPAKE2 PAKE, HKDF key separation, AES-256-GCM business envelopes, a separate key per browser, token digests, least-privilege MongoDB access, loopback-only services, and redacted logs. Ordinary application logs do not record request bodies, Authorization, cookies, pairing codes, or business plaintext; infrastructure error logs may contain the network information disclosed above.</p>
        <p>No system is perfectly secure. The server can still see login email, random identifiers, ciphertext size and direction, timestamps, and presence, so traffic analysis is outside the end-to-end encryption boundary. The current PAKE dependency has not completed an independent cryptographic audit. Report potential security issues to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
        <p>This design does not protect a compromised browser, desktop app, local Agent, browser extension, dependency supply chain, or user screen. The web app loads frontend code from the server; a strongly malicious server that replaces that code could exfiltrate content after browser-side decryption. Users who must resist that threat should prefer a signed, independently verifiable native client or extension with pinned release keys and frontend versions.</p>
      </>,
    },
    {
      id: "international",
      title: "International access and transfers",
      content: <>
        <p>The production server is in China. If you access from another country or region, account data, routing metadata, and ciphertext may be transferred to China. We rely on contract performance, security safeguards, and applicable legal requirements and transfer only what is needed to provide the Service.</p>
        <p>Codex, Kimi Code, Claude Code, or model providers you choose may process content received by the local agent in other countries. That processing is between you and the third party. Review its data regions, transfer mechanisms, and account controls.</p>
      </>,
    },
    {
      id: "rights",
      title: "Your rights and choices",
      content: <>
        <p>Depending on applicable law, you may request information, access, correction, a copy, deletion, restriction, or objection; withdraw consent; and complain to a competent authority. Withdrawal does not affect processing already lawfully completed.</p>
        <p>You can revoke individual clients in the desktop app or clear site data to remove local browser credentials. Account settings in the mobile app offer “Delete account.” After password verification, this removes your account, device authorizations, preferences, feedback and associated relay data, and destroys history cache keys on this phone. Agent projects and files on your computers are not deleted. If cleanup is interrupted, account access stops while background cleanup retries. </p>
        <p>For account-level access, correction, or other rights assistance, email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> from your registered address. We will verify identity and normally respond within 30 days. Complex requests may be extended where law permits, with an explanation. We will not discriminate against you for exercising privacy rights.</p>
      </>,
    },
    {
      id: "children",
      title: "Children",
      content: <p>Relayune is intended for users 18 or older. We do not knowingly collect personal data from anyone under 18. If you believe a minor provided data, contact us so we can investigate and delete it where appropriate.</p>,
    },
    {
      id: "changes-contact",
      title: "Changes and contact",
      content: <>
        <p>We may update this Policy. Material changes will normally be announced through the Service or registered email at least 15 days in advance, except where law or urgent security needs require immediate effect. We maintain a version number and last-updated date.</p>
        <p>Send privacy questions, security reports, or rights requests to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. The Chinese and English versions share the same intent. If they conflict, the Simplified Chinese version controls to the extent permitted by law.</p>
      </>,
    },
  ],
};
