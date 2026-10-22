import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "自建实例与数据说明 · Relayune",
  robots: { index: false, follow: false },
};

export default function InstanceInformation() {
  return <main style={{ maxWidth: 760, margin: "48px auto", padding: 24, lineHeight: 1.8 }}>
    <h1>自建实例与数据说明</h1>
    <p>这个 Relayune 实例由部署者运行。账户、设备路由、会话转发和反馈由当前服务器处理；
      Relayune 项目的作者不会仅因你使用自建实例而获得这些数据。</p>
    <p>登录凭据属于当前实例。电脑与每个手机、浏览器仍需分别配对授权。
      会话内容在客户端和电脑端加解密；账户、连接状态等路由元数据不属于会话密文。
      主动提交的反馈可能包含可读描述、选填联系方式和你主动附带的图片，接收方是本实例的部署者。</p>
    <p>请向部署者确认联系方式、数据保留、备份与删除方式。用户名模式的唯一管理员账户
      通过部署机器上的本地命令恢复密码；移除整个实例应由部署者处理。
      如果地址或证书发生变化，请先核实，不能通过忽略证书错误继续登录。</p>
    <p>项目自有代码及素材采用 MIT 许可。第三方许可、品牌边界与实际安全验证范围见随源码提供的说明。
      此页面介绍通用实现，不能代替部署者自己的服务和隐私说明。</p>
    <h2>Self-hosted instance information</h2>
    <p>This instance is operated by its deployer. Accounts, routing and feedback stay with this
      server. Session content is encrypted between clients and the computer; account and routing
      metadata are separate. Feedback you explicitly submit is readable by this instance operator.</p>
    <p>Ask the operator about support, retention, backups and deletion. A local owner account is
      recovered on the deployment machine. Verify address and certificate changes before signing in.
      This implementation summary does not replace the operator&apos;s own service and privacy notice.</p>
    <Link href="/?login=1">返回实例登录 / Return to instance sign-in</Link>
  </main>;
}
