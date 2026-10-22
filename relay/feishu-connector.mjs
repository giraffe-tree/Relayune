import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createLarkChannel,
  Domain,
  LoggerLevel,
} from "@larksuiteoapi/node-sdk";

const MAX_APP_ID_LENGTH = 128;
const MAX_APP_SECRET_LENGTH = 512;
const MAX_MESSAGE_LENGTH = 60_000;
const MAX_APPROVAL_ID_LENGTH = 256;
const MAX_APPROVAL_DISPLAY_LENGTH = 2_000;
const MAX_APPROVAL_OPTIONS = 12;
const DEFAULT_RESPONSE_TIMEOUT_MS = 30 * 60_000;
const APPROVAL_CARD_ACTION = "relayune.local_approval.v1";

const quietLogger = Object.freeze({
  fatal() {},
  error() {},
  warn() {},
  info() {},
  debug() {},
  trace() {},
});

export class FeishuConnectionError extends Error {
  constructor(code) {
    super(code);
    this.name = "FeishuConnectionError";
    this.code = code;
  }
}

export function normalizeFeishuConnection(value) {
  const platform = value?.platform === "lark" ? "lark" : "feishu";
  const appId = typeof value?.app_id === "string" ? value.app_id.trim() : "";
  const appSecret =
    typeof value?.app_secret === "string" ? value.app_secret.trim() : "";
  if (
    !appId ||
    appId.length > MAX_APP_ID_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(appId) ||
    !appSecret ||
    appSecret.length > MAX_APP_SECRET_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(appSecret)
  ) {
    throw new FeishuConnectionError("feishu_credentials_invalid");
  }
  return {
    platform,
    app_id: appId,
    app_secret: appSecret,
    bot_name: sanitizeLabel(value?.bot_name, 80),
  };
}

export function feishuConsoleUrl(platform, destination = "home") {
  const origin = platform === "lark"
    ? "https://open.larksuite.com"
    : "https://open.feishu.cn";
  if (destination === "apps") return `${origin}/app`;
  return origin;
}

export function feishuPermissionJson() {
  return JSON.stringify(
    {
      scopes: {
        tenant: [
          "im:message:send_as_bot",
          "im:message:readonly",
          "contact:user.id:readonly",
          "im:message.group_at_msg:readonly",
          "im:message.p2p_msg:readonly",
        ],
        user: [],
      },
    },
    null,
    2,
  );
}

export async function verifyFeishuCredentials(value, options = {}) {
  const connection = normalizeFeishuConnection(value);
  const origin = connection.platform === "lark"
    ? "https://open.larksuite.com"
    : "https://open.feishu.cn";
  let response;
  try {
    response = await (options.fetchImpl ?? fetch)(
      `${origin}/open-apis/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          app_id: connection.app_id,
          app_secret: connection.app_secret,
        }),
      },
    );
  } catch {
    throw new FeishuConnectionError("feishu_network_failed");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.code !== 0) {
    throw new FeishuConnectionError("feishu_credentials_invalid");
  }
  return { ok: true };
}

export async function verifyFeishuConnection(value, options = {}) {
  const connection = normalizeFeishuConnection(value);
  const channel = createChannel(connection, options.channelFactory);
  try {
    await channel.connect();
    return {
      ok: true,
      bot_name: sanitizeLabel(channel.botIdentity?.name, 80),
    };
  } catch (error) {
    const code = error?.code === "permission_denied"
      ? "feishu_credentials_invalid"
      : "feishu_connection_failed";
    throw new FeishuConnectionError(code);
  } finally {
    await channel.disconnect().catch(() => {});
  }
}

export class FeishuConnector {
  constructor(options) {
    this.connection = normalizeFeishuConnection(options);
    this.workspace = options.workspace;
    this.defaultProvider = options.defaultProvider ?? "codex";
    this.statePath = options.statePath ?? null;
    this.responseTimeoutMs =
      options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;
    this.channel = createChannel(this.connection, options.channelFactory);
    this.controller = null;
    this.closed = false;
    this.bindings = new Map();
    this.knownSessions = new Set();
    this.chatQueues = new Map();
    this.pendingByRequest = new Map();
    this.pendingByTurn = new Map();
    this.localApprovals = new Map();
    this.unsubscribers = [];
  }

  async start(controller) {
    this.controller = controller;
    await this.loadBindings();
    const sessions = await controller.listSessions().catch(() => []);
    this.knownSessions = new Set(
      sessions
        .map((session) => session?.id)
        .filter((id) => typeof id === "string" && id),
    );
    for (const [chatId, sessionId] of this.bindings) {
      if (!this.knownSessions.has(sessionId)) this.bindings.delete(chatId);
    }
    controller.registerLocalOnlySessions?.([...this.bindings.values()]);
    await this.saveBindings();

    this.unsubscribers.push(
      this.channel.on("message", (message) => {
        this.enqueueMessage(message);
      }),
      this.channel.on("cardAction", (event) => {
        void this.handleCardAction(event);
      }),
      this.channel.on("error", () => {
        controller.reportStatus?.("error");
      }),
      this.channel.on("reconnecting", () => {
        controller.reportStatus?.("reconnecting");
      }),
      this.channel.on("reconnected", () => {
        controller.reportStatus?.("connected");
      }),
    );
    await this.channel.connect();
    controller.reportStatus?.("connected", {
      botName: sanitizeLabel(this.channel.botIdentity?.name, 80),
    });
  }

  enqueueMessage(message) {
    if (this.closed || !validInboundMessage(message)) return;
    const previous = this.chatQueues.get(message.chatId) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => this.processMessage(message))
      .catch(() => {});
    this.chatQueues.set(message.chatId, next);
    void next.finally(() => {
      if (this.chatQueues.get(message.chatId) === next) {
        this.chatQueues.delete(message.chatId);
      }
    });
  }

  async processMessage(message) {
    const content = message.content.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!content) {
      await this.channel.send(
        message.chatId,
        { text: this.copy("text_only") },
        replyOptions(message),
      ).catch(() => {});
      return;
    }
    const sessionId = await this.sessionForMessage(message);
    const requestId = `req_feishu_${randomUUID().replaceAll("-", "")}`;
    const completion = new Promise((resolve) => {
      const pending = {
        requestId,
        sessionId,
        chatId: message.chatId,
        replyTo: message.messageId,
        replyInThread: Boolean(message.threadId),
        senderId: message.senderId,
        turnId: null,
        text: "",
        approvalIds: new Set(),
        resolve,
        timer: null,
      };
      pending.timer = setTimeout(
        () => this.finishPending(pending, this.copy("timeout")),
        this.responseTimeoutMs,
      );
      pending.timer.unref?.();
      this.pendingByRequest.set(requestId, pending);
    });

    try {
      const result = await this.controller.submitMessage({
        sessionId,
        requestId,
        content,
        source: "feishu",
      });
      const pending = this.pendingByRequest.get(requestId);
      if (pending && typeof result?.turnId === "string" && result.turnId) {
        this.attachTurn(pending, result.turnId);
      }
    } catch {
      const pending = this.pendingByRequest.get(requestId);
      if (pending) this.finishPending(pending, this.copy("failed"));
    }
    await completion;
  }

  async sessionForMessage(message) {
    const existing = this.bindings.get(message.chatId);
    if (existing && this.knownSessions.has(existing)) return existing;
    const session = await this.controller.createSession({
      cwd: this.workspace,
      name: sessionName(this.connection.platform, message),
      provider: this.defaultProvider,
    });
    if (!session?.id) throw new Error("Feishu session creation failed.");
    this.knownSessions.add(session.id);
    this.bindings.set(message.chatId, session.id);
    await this.saveBindings();
    return session.id;
  }

  handleAgentEvent(sessionId, event) {
    if (event?.kind === "turn.started") {
      const pending = this.pendingByRequest.get(event.request_id);
      if (pending && pending.sessionId === sessionId && event.turn_id) {
        this.attachTurn(pending, event.turn_id);
      }
      return;
    }
    const pending = event?.turn_id
      ? this.pendingByTurn.get(event.turn_id)
      : null;
    if (!pending || pending.sessionId !== sessionId) return;
    if (event.kind === "message.delta" && typeof event.text === "string") {
      pending.text += event.text;
      return;
    }
    if (event.kind === "message.completed") {
      const text = typeof event.text === "string" && event.text.trim()
        ? event.text.trim()
        : pending.text.trim();
      this.finishPending(pending, text || this.copy("completed"));
      return;
    }
    if (event.kind === "turn.failed") {
      this.finishPending(pending, this.copy("failed"));
      return;
    }
    if (event.kind === "turn.completed") {
      this.finishPending(
        pending,
        pending.text.trim() || this.copy("completed"),
      );
    }
  }

  async handleApproval(approval) {
    const approvalId = approval?.approval_id;
    const sessionId = approval?.local_session_id ??
      approval?.root_session_id ?? approval?.session_id;
    if (
      !validOpaqueId(approvalId, MAX_APPROVAL_ID_LENGTH) ||
      !validOpaqueId(sessionId, 256) ||
      typeof this.controller?.resolveLocalApproval !== "function"
    ) {
      return false;
    }
    if (this.localApprovals.has(approvalId)) return true;
    const pending = [...this.pendingByRequest.values()].find(
      (candidate) => candidate.sessionId === sessionId,
    );
    const expiresAt = Date.parse(approval?.expires_at);
    if (
      !pending ||
      !validOpaqueId(pending.senderId, 256) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      return false;
    }

    const record = {
      approvalId,
      sessionId,
      chatId: pending.chatId,
      authorizedSenderId: pending.senderId,
      cardMessageId: null,
      approval,
      state: "sending",
      confirmingOptionId: null,
      timer: null,
    };
    this.localApprovals.set(approvalId, record);
    try {
      const result = await this.channel.send(
        pending.chatId,
        { card: this.pendingApprovalCard(record) },
        { replyTo: pending.replyTo, replyInThread: pending.replyInThread },
      );
      if (!validOpaqueId(result?.messageId, 256)) {
        throw new Error("Feishu approval card message ID is missing.");
      }
      if (this.closed || this.localApprovals.get(approvalId) !== record) {
        throw new Error("Feishu approval card is no longer active.");
      }
      record.cardMessageId = result.messageId;
      record.state = "pending";
      pending.approvalIds.add(approvalId);
      record.timer = setTimeout(() => {
        void this.expireApprovalCard(approvalId);
      }, Math.max(1, expiresAt - Date.now()));
      record.timer.unref?.();
      return true;
    } catch {
      this.localApprovals.delete(approvalId);
      return false;
    }
  }

  async handleCardAction(event) {
    if (this.closed) return;
    const value = parseApprovalCardValue(event?.action?.value);
    if (!value) return;
    const record = this.localApprovals.get(value.approval_id);
    if (!record) {
      await this.sendCardActionNotice(event, this.copy("approvalUnavailable"));
      return;
    }
    if (
      record.state !== "pending" ||
      event.chatId !== record.chatId ||
      event.messageId !== record.cardMessageId ||
      value.session_id !== record.sessionId
    ) {
      await this.sendCardActionNotice(event, this.copy("approvalUnavailable"));
      return;
    }
    if (event?.operator?.openId !== record.authorizedSenderId) {
      await this.sendCardActionNotice(event, this.copy("approvalOwnerOnly"));
      return;
    }

    if (value.decision === "cancelled") {
      if (
        !record.confirmingOptionId ||
        record.confirmingOptionId !== value.option_id
      ) {
        await this.sendCardActionNotice(
          event,
          this.copy("approvalUnavailable"),
        );
        return;
      }
      record.confirmingOptionId = null;
      await this.channel.updateCard(
        record.cardMessageId,
        this.pendingApprovalCard(record),
      ).catch(() => {});
      return;
    }

    const selectedOption = approvalOption(
      record.approval,
      value.option_id,
    );
    const alwaysAllow =
      value.decision === "approved" &&
      String(selectedOption?.kind ?? "").startsWith("allow") &&
      String(selectedOption.kind).includes("always");
    if (record.confirmingOptionId) {
      if (
        !alwaysAllow ||
        !value.confirm_always ||
        record.confirmingOptionId !== value.option_id
      ) {
        await this.sendCardActionNotice(
          event,
          this.copy("approvalUnavailable"),
        );
        return;
      }
    } else if (alwaysAllow) {
      if (value.confirm_always) {
        await this.sendCardActionNotice(
          event,
          this.copy("approvalUnavailable"),
        );
        return;
      }
      record.confirmingOptionId = value.option_id;
      await this.channel.updateCard(
        record.cardMessageId,
        this.alwaysConfirmationCard(record, selectedOption),
      ).catch(() => {});
      return;
    } else if (value.confirm_always) {
      await this.sendCardActionNotice(event, this.copy("approvalUnavailable"));
      return;
    }

    record.state = "resolving";
    clearTimeout(record.timer);
    let result;
    try {
      result = await this.controller.resolveLocalApproval({
        approvalId: record.approvalId,
        sessionId: record.sessionId,
        decision: value.decision,
        optionId: value.option_id,
      });
    } catch {
      result = { status: "unavailable" };
    }
    const resolved = result?.status === value.decision;
    const status = resolved ? value.decision : result?.status === "expired"
      ? "expired"
      : "unavailable";
    record.state = status;
    this.localApprovals.delete(record.approvalId);
    await this.channel.updateCard(
      record.cardMessageId,
      this.resolvedApprovalCard(record, status, event.operator?.name),
    ).catch(() => {});
  }

  async expireApprovalCard(approvalId, status = "expired") {
    const record = this.localApprovals.get(approvalId);
    if (!record || record.state === "resolving") return;
    clearTimeout(record.timer);
    record.state = status;
    this.localApprovals.delete(approvalId);
    if (record.cardMessageId) {
      await this.channel.updateCard(
        record.cardMessageId,
        this.resolvedApprovalCard(record, status),
      ).catch(() => {});
    }
  }

  async sendCardActionNotice(event, text) {
    if (!validOpaqueId(event?.chatId, 256)) return;
    await this.channel.send(
      event.chatId,
      { text },
      validOpaqueId(event?.messageId, 256)
        ? { replyTo: event.messageId, replyInThread: false }
        : undefined,
    ).catch(() => {});
  }

  pendingApprovalCard(record) {
    return buildApprovalCard({
      approval: record.approval,
      sessionId: record.sessionId,
      copy: (key) => this.copy(key),
    });
  }

  resolvedApprovalCard(record, status, actorName) {
    return buildResolvedApprovalCard({
      approval: record.approval,
      status,
      actorName: sanitizeLabel(actorName, 80),
      copy: (key) => this.copy(key),
    });
  }

  alwaysConfirmationCard(record, option) {
    return buildAlwaysConfirmationCard({
      approval: record.approval,
      sessionId: record.sessionId,
      option,
      copy: (key) => this.copy(key),
    });
  }

  attachTurn(pending, turnId) {
    if (pending.turnId === turnId) return;
    if (pending.turnId) this.pendingByTurn.delete(pending.turnId);
    pending.turnId = turnId;
    this.pendingByTurn.set(turnId, pending);
  }

  finishPending(pending, text) {
    if (!this.pendingByRequest.has(pending.requestId)) return;
    this.pendingByRequest.delete(pending.requestId);
    if (pending.turnId) this.pendingByTurn.delete(pending.turnId);
    clearTimeout(pending.timer);
    for (const approvalId of pending.approvalIds) {
      void this.expireApprovalCard(approvalId, "unavailable");
    }
    void this.channel.send(
      pending.chatId,
      { markdown: text.slice(0, MAX_MESSAGE_LENGTH) },
      { replyTo: pending.replyTo, replyInThread: pending.replyInThread },
    ).catch(() => {}).finally(() => pending.resolve());
  }

  async disconnect() {
    this.closed = true;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    for (const pending of this.pendingByRequest.values()) {
      clearTimeout(pending.timer);
      pending.resolve();
    }
    this.pendingByRequest.clear();
    this.pendingByTurn.clear();
    for (const approval of this.localApprovals.values()) {
      clearTimeout(approval.timer);
    }
    this.localApprovals.clear();
    this.chatQueues.clear();
    await this.channel.disconnect().catch(() => {});
  }

  copy(key) {
    const english = this.connection.platform === "lark";
    const values = english
      ? {
          text_only: "Relayune currently accepts text messages in Lark.",
          timeout: "The local Agent is still running. Open Relayune to check its progress.",
          failed: "The local Agent could not finish this request. Open Relayune for details.",
          completed: "The local Agent finished without a text response.",
          approvalTitle: "Approval required",
          approvalAction: "Requested action",
          approvalHighRisk: "High risk",
          approvalMediumRisk: "Needs confirmation",
          approvalExpires: "Approve within {minutes} min. This decision stays on this computer and Lark.",
          approvalAllowOnce: "Allow once",
          approvalReject: "Reject",
          approvalApproved: "Approved",
          approvalRejected: "Rejected",
          approvalExpired: "Expired and rejected",
          approvalUnavailable: "This approval is no longer available.",
          approvalOwnerOnly: "Only the person who started this Agent request can approve it.",
          approvalResolvedBy: "Handled by {name}",
          approvalAlwaysTitle: "Confirm ongoing permission",
          approvalAlwaysDetail: "This choice can allow similar actions again in this Agent session. Confirm only if you trust the requested action.",
          approvalAlwaysConfirm: "Confirm ongoing access",
          approvalBack: "Back",
        }
      : {
          text_only: "Relayune 当前支持从飞书发送文字消息。",
          timeout: "本地 Agent 仍在运行，请打开 Relayune 查看进度。",
          failed: "本地 Agent 未能完成这次请求，请打开 Relayune 查看详情。",
          completed: "本地 Agent 已完成，但没有返回文字内容。",
          approvalTitle: "需要审批",
          approvalAction: "请求执行",
          approvalHighRisk: "高风险操作",
          approvalMediumRisk: "需要确认",
          approvalExpires: "请在 {minutes} 分钟内处理；审批只在飞书与本机之间流转。",
          approvalAllowOnce: "允许一次",
          approvalReject: "拒绝",
          approvalApproved: "已允许",
          approvalRejected: "已拒绝",
          approvalExpired: "已过期并拒绝",
          approvalUnavailable: "这条审批已失效或已处理。",
          approvalOwnerOnly: "只有发起这次 Agent 任务的人可以审批。",
          approvalResolvedBy: "由 {name} 处理",
          approvalAlwaysTitle: "确认持续授权",
          approvalAlwaysDetail: "该选择可能允许当前 Agent 会话再次执行同类操作。请确认你信任这项请求。",
          approvalAlwaysConfirm: "确认持续允许",
          approvalBack: "返回",
        };
    return values[key] ?? key;
  }

  async loadBindings() {
    if (!this.statePath) return;
    try {
      const parsed = JSON.parse(await readFile(this.statePath, "utf8"));
      if (parsed?.version !== 1 || typeof parsed.bindings !== "object") return;
      for (const [chatId, sessionId] of Object.entries(parsed.bindings)) {
        if (validBinding(chatId, sessionId)) this.bindings.set(chatId, sessionId);
      }
    } catch {}
  }

  async saveBindings() {
    if (!this.statePath) return;
    const temporary = `${this.statePath}.tmp`;
    await mkdir(dirname(this.statePath), { recursive: true, mode: 0o700 });
    const file = await open(temporary, "w", 0o600);
    try {
      await file.writeFile(JSON.stringify({
        version: 1,
        bindings: Object.fromEntries(this.bindings),
      }));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, this.statePath);
  }
}

function buildApprovalCard({ approval, sessionId, copy }) {
  const display = sanitizeCardText(
    approval?.action?.display,
    MAX_APPROVAL_DISPLAY_LENGTH,
  ) || copy("approvalAction");
  const risk = approval?.risk_level === "high"
    ? copy("approvalHighRisk")
    : copy("approvalMediumRisk");
  const expiresInMinutes = Math.max(
    1,
    Math.ceil((Date.parse(approval.expires_at) - Date.now()) / 60_000),
  );
  const elements = [
    cardText(`${copy("approvalAction")}\n${display}`),
    cardText(risk),
  ];
  const choices = approvalCardChoices(approval, copy);
  for (let index = 0; index < choices.length; index += 3) {
    elements.push({
      tag: "action",
      actions: choices.slice(index, index + 3).map((choice, choiceIndex) => ({
        tag: "button",
        type: choice.decision === "rejected"
          ? "danger"
          : index === 0 && choiceIndex === 0 ? "primary" : "default",
        text: { tag: "plain_text", content: choice.label },
        value: {
          action: APPROVAL_CARD_ACTION,
          approval_id: approval.approval_id,
          session_id: sessionId,
          decision: choice.decision,
          option_id: choice.optionId,
        },
      })),
    });
  }
  elements.push(cardText(formatCopy(copy("approvalExpires"), {
    minutes: expiresInMinutes,
  })));
  return {
    config: { wide_screen_mode: true },
    header: {
      template: approval?.risk_level === "high" ? "red" : "orange",
      title: { tag: "plain_text", content: copy("approvalTitle") },
    },
    elements,
  };
}

function buildResolvedApprovalCard({ approval, status, actorName, copy }) {
  const display = sanitizeCardText(
    approval?.action?.display,
    MAX_APPROVAL_DISPLAY_LENGTH,
  ) || copy("approvalAction");
  const statusKey = status === "approved"
    ? "approvalApproved"
    : status === "rejected"
      ? "approvalRejected"
      : status === "expired"
        ? "approvalExpired"
        : "approvalUnavailable";
  const elements = [
    cardText(`${copy("approvalAction")}\n${display}`),
  ];
  if (actorName) {
    elements.push(cardText(formatCopy(copy("approvalResolvedBy"), {
      name: actorName,
    })));
  }
  return {
    config: { wide_screen_mode: true },
    header: {
      template: status === "approved"
        ? "green"
        : status === "rejected" ? "red" : "grey",
      title: { tag: "plain_text", content: copy(statusKey) },
    },
    elements,
  };
}

function buildAlwaysConfirmationCard({
  approval,
  sessionId,
  option,
  copy,
}) {
  const display = sanitizeCardText(
    approval?.action?.display,
    MAX_APPROVAL_DISPLAY_LENGTH,
  ) || copy("approvalAction");
  const optionId = option.option_id;
  const value = {
    action: APPROVAL_CARD_ACTION,
    approval_id: approval.approval_id,
    session_id: sessionId,
    option_id: optionId,
  };
  return {
    config: { wide_screen_mode: true },
    header: {
      template: "red",
      title: { tag: "plain_text", content: copy("approvalAlwaysTitle") },
    },
    elements: [
      cardText(`${copy("approvalAction")}\n${display}`),
      cardText(copy("approvalAlwaysDetail")),
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            type: "primary",
            text: {
              tag: "plain_text",
              content: copy("approvalAlwaysConfirm"),
            },
            value: {
              ...value,
              decision: "approved",
              confirm_always: true,
            },
          },
          {
            tag: "button",
            type: "default",
            text: { tag: "plain_text", content: copy("approvalBack") },
            value: {
              ...value,
              decision: "cancelled",
              confirm_always: false,
            },
          },
        ],
      },
    ],
  };
}

function approvalCardChoices(approval, copy) {
  const options = Array.isArray(approval?.action?.options)
    ? approval.action.options
      .filter(
        (option) =>
          validOpaqueId(option?.option_id, 256) &&
          typeof option?.kind === "string",
      )
      .slice(0, MAX_APPROVAL_OPTIONS)
    : [];
  const choices = options.map((option) => ({
    decision: String(option.kind).startsWith("reject")
      ? "rejected"
      : "approved",
    optionId: option.option_id,
    label: sanitizeCardText(option.name, 38) ||
      (String(option.kind).startsWith("reject")
        ? copy("approvalReject")
        : copy("approvalAllowOnce")),
  }));
  if (!options.length) {
    choices.push({
      decision: "approved",
      optionId: null,
      label: copy("approvalAllowOnce"),
    });
  }
  if (!choices.some((choice) => choice.decision === "rejected")) {
    choices.push({
      decision: "rejected",
      optionId: null,
      label: copy("approvalReject"),
    });
  }
  return choices;
}

function approvalOption(approval, optionId) {
  if (optionId === null || !Array.isArray(approval?.action?.options)) {
    return null;
  }
  return approval.action.options.find(
    (option) => option?.option_id === optionId,
  ) ?? null;
}

function cardText(content) {
  return {
    tag: "div",
    text: { tag: "plain_text", content },
  };
}

function parseApprovalCardValue(raw) {
  let value = raw;
  if (typeof value === "string") {
    if (value.length > 2_000) return null;
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (
    value.action !== APPROVAL_CARD_ACTION ||
    !validOpaqueId(value.approval_id, MAX_APPROVAL_ID_LENGTH) ||
    !validOpaqueId(value.session_id, 256) ||
    !["approved", "rejected", "cancelled"].includes(value.decision) ||
    (value.confirm_always !== undefined &&
      typeof value.confirm_always !== "boolean") ||
    (value.option_id !== null && !validOpaqueId(value.option_id, 256))
  ) {
    return null;
  }
  return {
    approval_id: value.approval_id,
    session_id: value.session_id,
    decision: value.decision,
    option_id: value.option_id,
    confirm_always: value.confirm_always === true,
  };
}

function validOpaqueId(value, maximum) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function sanitizeCardText(value, maximum) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maximum);
}

function formatCopy(template, params) {
  return template.replace(/\{(\w+)\}/g, (placeholder, name) =>
    name in params ? String(params[name]) : placeholder,
  );
}

function createChannel(connection, channelFactory = createLarkChannel) {
  return channelFactory({
    appId: connection.app_id,
    appSecret: connection.app_secret,
    domain: connection.platform === "lark" ? Domain.Lark : Domain.Feishu,
    source: "relayune",
    logger: quietLogger,
    loggerLevel: LoggerLevel.error,
    handshakeTimeoutMs: 15_000,
    policy: {
      requireMention: true,
      dmMode: "open",
      respondToMentionAll: false,
    },
    safety: {
      chatQueue: { enabled: false },
      staleMessageWindowMs: 10 * 60_000,
    },
    outbound: {
      retry: { maxAttempts: 3, baseDelayMs: 350 },
    },
  });
}

function validInboundMessage(message) {
  return Boolean(
    message &&
      typeof message.chatId === "string" &&
      message.chatId &&
      typeof message.messageId === "string" &&
      message.messageId &&
      typeof message.content === "string",
  );
}

function validBinding(chatId, sessionId) {
  return (
    typeof chatId === "string" &&
    chatId.length > 0 &&
    chatId.length <= 256 &&
    typeof sessionId === "string" &&
    sessionId.length > 0 &&
    sessionId.length <= 256
  );
}

function replyOptions(message) {
  return {
    replyTo: message.messageId,
    replyInThread: Boolean(message.threadId),
  };
}

function sessionName(platform, message) {
  const brand = platform === "lark" ? "Lark" : "飞书";
  const surface = message.chatType === "group"
    ? platform === "lark" ? "group" : "群聊"
    : sanitizeLabel(message.senderName, 42) || (platform === "lark" ? "chat" : "会话");
  return `${brand} · ${surface}`.slice(0, 80);
}

function sanitizeLabel(value, maximum) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}
