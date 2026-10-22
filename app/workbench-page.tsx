"use client";

import "./workbench.css";
import { discoverInstance, instanceUserLabel, sameOriginApiUrl, type InstanceCapabilities, type InstanceUser } from "./instance-client";
import { InstanceLogin, InstancePublicLinks } from "./instance-login";
import { OnlineStream, ONLINE_READ_TYPES, readOnlineOrHttp, type StreamFrame } from "./online-stream";
import { browserClientIdentity } from "./client-identity";
import { sameMessageIdentity } from "./message-identity";
import { mergeLatestHistory } from "./history-reconciliation";
import { restoreFailedComposerDraft } from "./composer-draft-recovery.mjs";
import type { AttachmentPart } from "./attachment-ranges.mjs";
import "./workbench-flow.css";
import { AddProject, projectText, type ProjectReply } from "./add-project";

import {
  FormEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Link from "next/link";
import MarketingHome from "./marketing-home";
import { marketingCopy } from "./marketing-copy";
import { localizedMarketingCopy } from "./marketing-copy-localized";
import {
  clearStoredRelayKey,
  importRelayKey,
  loadStoredRelayKey,
  openJson,
  sealJson,
  storeRelayKey,
  type RelayAad,
  type RelayKey,
  type SealedEnvelope,
} from "./e2ee";

const MessageMarkdown = lazy(() => import("./message-markdown"));
import {
  pairingCodeInput,
  PAIRING_ID_PATTERN,
  PAIRING_PROTOCOL,
  randomRelayToken,
  respondToPairing,
  sha256Hex,
  verifyDesktopConfirmation,
  type PairingPublicState,
} from "../shared/pairing-pake";
import {
  isToolActivityEvent,
  toolActivityLabel,
  toolActivityMessageId,
  toolActivityStatus,
} from "./tool-activity.mjs";
import {
  isSessionStatusRunning,
  mergeCatalogSessionsWithDetails,
  retainActiveSessionEntries,
  settleInactiveSessionActivities,
} from "./session-running-state.mjs";
import InlineAgentStatus from "./inline-agent-status";
import SessionActivityIcon from "./session-activity-icon";
import { combineAbortSignals } from "../shared/abort-signal";
import {
  authBootstrapErrorText,
  authText,
  detectAuthLocale,
  readStoredAuthLocale,
  storeAuthLocale,
  type AuthBootstrapErrorKind,
  type AuthCopyKey,
  type AuthLocale,
} from "./auth-language";
import { workbenchText, type WorkbenchCopyKey } from "./workbench-language";
import { formatDurationSeconds } from "./locale-format";
import {
  applyDocumentLocale,
  LANGUAGE_PICKER_LABELS,
  LOCALE_DEFINITIONS,
  localePath,
  publicDocumentPath,
  SUPPORTED_LOCALES,
} from "./supported-locales";
import {
  authenticationErrorKey,
  hasAuthenticationEntry,
  isBrowserAuthorizationLost,
  pairingLinkErrorKey,
  logoutAfterConfirmation,
  isReviewAccountIsolated,
  type AuthenticationRequest,
} from "./workbench-entry";
import { waitForPairingCompletionHandoff } from "./pairing-completion";
import {
  hasMarketingReturnFocus,
  markMarketingReturnFocus,
  useMarketingReturnFocus,
} from "./marketing-return-focus";
import {
  RELAYUNE_ANDROID_RELEASE,
  RELAYUNE_MACOS_RELEASE_VERSION,
  RELAYUNE_RELEASE_ASSETS,
  RELAYUNE_WEB_RELEASE_VERSION,
} from "./release-assets";
import { RELAYUNE_COMPATIBILITY } from "../shared/release-compatibility";
import SystemReminderContent from "./system-reminder-content";
import { isSystemReminderOnlyContent } from "./system-reminder-segments";
import PairingScanner, { type ScannedPairing } from "./pairing-scanner";
import { createInvalidationQueue } from "./invalidation-queue";
import {
  consumeVerifiedFrames,
  INITIAL_REALTIME_DEVICE_STATE,
  projectBootstrapPresence,
  projectPresenceSignal,
  projectTransport,
  realtimeReconnectDelay,
  realtimeWebSocketUrl,
  type RealtimeDeviceState,
} from "./realtime-state";
import {
  preserveProjectSessionSelection,
  projectGroupsForProvider,
  projectGroupKey,
  rootSessionsForProvider,
} from "./session-projects";
import {
  readActiveSessionSelection,
  resolveActiveSessionSelection,
  storeActiveSessionSelection,
} from "./active-session-selection";
import { isConversationNearBottom } from "./conversation-auto-scroll.mjs";
import { ConversationViewport } from "./conversation-viewport";
import { FilePreviewDialog } from "./file-preview-dialog";
import { ComposerTextarea } from "./composer-textarea";
import { isComposerComposition } from "./composer-keyboard.mjs";
import { flowText } from "./flow-language";
import { ImageLoadQueue } from "./image-load-queue";

import type { AgentProvider } from "../shared/agent-order";
import AgentProviderOptions from "./agent-provider-options";

function requestAgentOrder(options: RequestInit) {
  return api<{ agent_order: AgentProvider[]; visible_agents?: AgentProvider[] }>("/api/account/agent-order", options);
}

type AgentProviderOption = {
  id: AgentProvider;
  label: string;
  shortLabel: string;
  icon: string;
};

const AGENT_PROVIDER_OPTIONS: readonly AgentProviderOption[] = [
  { id: "mcode", label: "MiniMax Code", shortLabel: "MiniMax", icon: "terminal" },
  { id: "pi", label: "Pi", shortLabel: "Pi", icon: "terminal" },
  { id: "zcode", label: "ZCode", shortLabel: "ZCode", icon: "terminal" },
  { id: "opencode", label: "OpenCode", shortLabel: "OpenCode", icon: "terminal" },
  { id: "codex", label: "Codex", shortLabel: "Codex", icon: "codex" },
  { id: "kimi", label: "Kimi Code", shortLabel: "Kimi", icon: "kimi" },
  { id: "claude", label: "Claude Code", shortLabel: "Claude Code", icon: "claude" },
  { id: "claude-cowork", label: "Claude Cowork", shortLabel: "Cowork", icon: "claude" },
];

type WorkbenchToastPresentation = {
  key: WorkbenchCopyKey;
  variables?: Record<string, string | number>;
};

type SessionConfigOption = {
  type: "select" | "boolean";
  id: "model" | "thinking" | "mode" | string;
  name: string;
  category?: string | null;
  description?: string | null;
  currentValue: string | boolean;
  options?: Array<{
    value: string;
    name: string;
    description?: string | null;
  }>;
};

type KimiCommand = {
  name: string;
  description: string;
  input_hint?: string | null;
};

type KimiQuickCommand = {
  name: string;
  label: string;
  description: string;
  badge: string;
  advertised?: boolean;
  inputHint?: string | null;
};

function kimiWebCommands(locale: AuthLocale): KimiQuickCommand[] {
  return [
    {
      name: "tasks",
      label: workbenchText(locale, "kimiTasksLabel"),
      description: workbenchText(locale, "kimiTasksDescription"),
      badge: workbenchText(locale, "openNow"),
    },
    {
      name: "status",
      label: workbenchText(locale, "kimiStatusLabel"),
      description: workbenchText(locale, "kimiStatusDescription"),
      badge: workbenchText(locale, "localStatus"),
    },
    {
      name: "model",
      label: workbenchText(locale, "kimiModelLabel"),
      description: workbenchText(locale, "kimiModelDescription"),
      badge: workbenchText(locale, "sessionSettingBadge"),
    },
    {
      name: "permission",
      label: workbenchText(locale, "kimiPermissionLabel"),
      description: workbenchText(locale, "kimiPermissionDescription"),
      badge: workbenchText(locale, "securitySettingBadge"),
    },
    {
      name: "plan",
      label: workbenchText(locale, "kimiPlanLabel"),
      description: workbenchText(locale, "kimiPlanDescription"),
      badge: workbenchText(locale, "sessionSettingBadge"),
    },
    {
      name: "yolo",
      label: workbenchText(locale, "kimiYoloLabel"),
      description: workbenchText(locale, "kimiYoloDescription"),
      badge: workbenchText(locale, "confirmationRequired"),
    },
    {
      name: "settings",
      label: workbenchText(locale, "kimiSettingsLabel"),
      description: workbenchText(locale, "kimiSettingsDescription"),
      badge: workbenchText(locale, "settingsBadge"),
    },
  ];
}

type SessionUsage = {
  used: number;
  size: number | null;
  total_tokens?: number | null;
};

type Session = {
  id: string;
  name: string;
  project: string;
  branch: string;
  cwd: string;
  status: "active" | "idle";
  updated_at: string;
  is_subagent?: boolean;
  parent_thread_id?: string | null;
  root_session_id?: string;
  agent_role?: string | null;
  sync_state?: "persisted";
  sync_verified_at?: string;
  provider?: AgentProvider;
  supports_steering?: boolean;
  running_started_at?: string | null;
  can_interrupt?: boolean;
  session_config_options?: SessionConfigOption[];
  kimi_config_options?: SessionConfigOption[];
  kimi_commands?: KimiCommand[];
  usage?: SessionUsage | null;
  model?: string | null;
  reasoning_effort?: string | null;
  permission_mode?: string | null;
  swarm_mode?: boolean | null;
};

type SavedProject = {
  id: string;
  name: string;
  cwd: string;
  updated_at: string;
  provider?: AgentProvider;
};

type MessageAttachment = {
  id: string;
  type: "image" | "file";
  name: string;
  mime_type: string;
  detail?: "auto" | "low" | "high" | "original" | null;
  preview_supported?: boolean;
  url?: string | null;
};

type PendingMessageAttachment = Omit<MessageAttachment, "type" | "url"> & {
  type: "image";
  base64: string;
  size: number;
  previewUrl: string;
};

const MAX_MESSAGE_ATTACHMENTS = 4;
const MAX_MESSAGE_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const SUPPORTED_MESSAGE_ATTACHMENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

type ToolActivityStatus = "running" | "completed" | "failed";

type Message = {
  id: string;
  clientMessageId?: string | null;
  role: "user" | "codex" | "system";
  content: string;
  kind?: string;
  meta: string;
  createdAt: string;
  source: "history" | "live";
  turnId?: string | null;
  attachments?: MessageAttachment[];
  toolActivity?: {
    label: string;
    detail: string;
    status: ToolActivityStatus;
    type?: string | null;
    name?: string | null;
    subject?: string | null;
    count?: number | null;
    command?: string | null;
  };
};

type HistoryMessage = {
  id: string;
  client_message_id?: string | null;
  role: "user" | "codex" | "system";
  content: string;
  created_at: string;
  turn_id: string | null;
  kind?: string;
  attachments?: MessageAttachment[];
  tool_activity_label?: string | null;
  tool_activity_type?: string | null;
  tool_activity_name?: string | null;
  tool_activity_subject?: string | null;
  tool_activity_count?: number | null;
  tool_activity_command?: string | null;
  tool_activity_detail?: string | null;
  tool_activity_status?: ToolActivityStatus | null;
};

type HistoryPage = {
  session_id: string;
  messages: HistoryMessage[];
  next_cursor: string | null;
  has_more: boolean;
  agents?: Agent[];
  sessions?: Session[];
  metadata_attachment?: MessageAttachment;
};

type HistoryPageState = {
  loading: boolean;
  loaded: boolean;
  nextCursor: string | null;
  hasMore: boolean;
  error?: true;
};

type Approval = {
  approval_id: string;
  session_id: string;
  root_session_id?: string;
  action: {
    type: string;
    display: string;
    cwd: string;
    command_hash: string;
    question_id?: string;
    header?: string;
    allows_freeform?: boolean;
    freeform_delivery?: "followup";
    is_secret?: boolean;
    options?: Array<{
      option_id: string;
      name: string;
      kind: string;
      description?: string;
    }>;
  };
  risk_level: "medium" | "high";
  state: "pending" | "deciding" | "approved" | "rejected" | "expired";
  requested_at: string;
  expires_at: string;
  source_thread_id?: string;
  source_agent_id?: string | null;
  source_agent_name?: string | null;
};

type Agent = {
  id: string;
  thread_id: string;
  parent_session_id: string;
  parent_thread_id: string | null;
  name: string;
  role: string | null;
  task: string;
  status:
    | "unknown"
  | "pendingInit"
    | "running"
    | "interrupted"
    | "completed"
    | "errored"
    | "shutdown"
    | "notFound";
  progress: number;
  summary: string | null;
  model: string | null;
  reasoning_effort: string | null;
  tool?: string | null;
  current_activity?: string | null;
  tool_count?: number | null;
  token_count?: number | null;
  context_tokens?: number | null;
  permission_mode?: string | null;
  swarm_mode?: boolean | null;
  activity_log?: AgentActivity[];
  can_open?: boolean;
  started_at?: string;
  updated_at?: string;
};

type AgentActivity = {
  id: string;
  kind: "status" | "tool" | "progress";
  code?:
    | "task_received"
    | "started"
    | "plan_progress"
    | "completed"
    | "stopped"
    | "failed"
    | "step_completed";
  label: string;
  completed?: number;
  total?: number;
  occurred_at: string;
};

type RelayEvent = {
  cursor: number;
  event_id: string;
  session_id: string;
  agent_id: string | null;
  created_at: string;
  event: {
    kind: string;
    turn_id?: string;
    item_id?: string;
    text?: string;
    command?: string;
    cwd?: string;
    activity_type?: string | null;
    activity_name?: string | null;
    activity_subject?: string | null;
    activity_count?: number | null;
    duration_ms?: number | null;
    approval_id?: string;
    session_id?: string;
    decision?: string;
    action?: Approval["action"];
    risk_level?: Approval["risk_level"];
    requested_at?: string;
    expires_at?: string;
    source_thread_id?: string;
    source_agent_id?: string | null;
    source_agent_name?: string | null;
    progress?: number;
    name?: string;
    task?: string;
    status?: string;
    error?: string;
    agent_status?: Agent["status"];
    thread_id?: string;
    parent_thread_id?: string;
    root_session_id?: string;
    role?: string;
    summary?: string;
    model?: string;
    reasoning_effort?: string;
    tool?: string;
    current_activity?: string;
    tool_count?: number;
    token_count?: number;
    context_tokens?: number;
    permission_mode?: string;
    swarm_mode?: boolean;
    activity_log?: AgentActivity[];
    attachments?: MessageAttachment[];
    started_at?: string;
    updated_at?: string;
    config_options?: SessionConfigOption[];
    can_open?: boolean;
    explanation?: string;
    plan?: Array<{
      step: string;
      status: "pending" | "inProgress" | "completed";
    }>;
    changes?: Array<{ path: string; kind: string }>;
    operation?: "thread" | "turn";
    mode?: string;
    client_message_id?: string;
    persisted?: boolean;
    verified_at?: string;
    project?: string;
    branch?: string;
  };
};

type Bootstrap = {
  user: InstanceUser;
  device: {
    id: string;
    name: string;
    online: boolean;
    codex_connected: boolean;
    latency_ms: number | null;
    last_seen_at: string | null;
  };
  sessions: Session[];
  projects: SavedProject[];
  approvals: Approval[];
  agents: Agent[];
  events: RelayEvent[];
  cursor: number;
  ack_seq: number;
  queued_commands: number;
};

type OpaqueFrame = {
  cursor?: number;
  event_id?: string;
  event_seq?: number | null;
  device_id: string;
  session_id: string | null;
  agent_id?: string | null;
  request_id: string | null;
  command_type?: string;
  created_at?: string;
  expires_at?: string | null;
  aad: RelayAad;
  envelope: SealedEnvelope;
};

type OnlineReadFallback = {
  requestId: string;
  key: RelayKey;
  deviceId: string;
  sessionId: string | null;
  responseTypes: string[];
};

type ServerBootstrap = {
  protocol_version: 2;
  online_transport_version?: number;
  user: InstanceUser;
  device: Bootstrap["device"];
  catalog: OpaqueFrame | null;
  events: OpaqueFrame[];
  cursor: number;
  ack_seq: number;
  queued_commands: number;
  pending_commands?: number;
};

type PendingBrowserPairing = {
  pairing_id: string;
  device_id: string;
  device_name: string;
  expires_at: string;
};

type PendingBrowserPairingDiscovery = {
  has_bound_computer: boolean;
  pairings: PendingBrowserPairing[];
};

const DESKTOP_LOGIN_ID_PATTERN = /^dlogin_[A-Za-z0-9_-]{43}$/;

type DesktopLoginApproval = {
  request_id: string;
  device_name: string;
  status: "waiting" | "approved";
  account_email: string;
  expires_at: string;
};

type CommandResult = {
  request_id: string;
  delivery: "delivered" | "queued";
  event_cursor?: number;
};

class RelayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "RelayApiError";
  }
}

class PairingCancelledError extends Error {}

type PairingFlowErrorKey = Extract<
  AuthCopyKey,
  | "pairingAlreadyUsed"
  | "desktopConfirmationTimeout"
  | "missingPairedDevice"
  | "desktopActivationFailed"
  | "noPendingBrowserPairing"
  | "choosePendingComputer"
>;

class PairingFlowError extends Error {
  constructor(readonly key: PairingFlowErrorKey) {
    super(key);
    this.name = "PairingFlowError";
  }
}

function authenticationErrorFor(
  request: AuthenticationRequest,
  error: unknown,
): AuthCopyKey {
  return error instanceof RelayApiError
    ? authenticationErrorKey(request, error.status, error.code)
    : authenticationErrorKey(request, -1, "unexpected_error");
}

const RELAY_REQUEST_TIMEOUT_MS = 15_000;
const HISTORY_REQUEST_TIMEOUT_MS = 60_000;

const API_BASE = process.env.NEXT_PUBLIC_RELAY_API_URL ?? "";
let activeBrowserAuthorizationToken = "";
let activeWorkbenchLocale: AuthLocale = "zh-CN";
const CONFIGURED_ADAPTER = process.env.NEXT_PUBLIC_RELAY_ADAPTER ?? "multi";
const MULTI_AGENT_ENABLED = CONFIGURED_ADAPTER === "multi";
const LOCAL_AGENT_ACTIVE_FRESHNESS_MS = 30 * 60_000;
const CONFIGURED_PROVIDER: AgentProvider =
  process.env.NEXT_PUBLIC_RELAY_DEFAULT_PROVIDER === "mcode" || CONFIGURED_ADAPTER === "mcode"
    ? "mcode" :
  process.env.NEXT_PUBLIC_RELAY_DEFAULT_PROVIDER === "pi" || CONFIGURED_ADAPTER === "pi"
    ? "pi" :
  process.env.NEXT_PUBLIC_RELAY_DEFAULT_PROVIDER === "zcode" || CONFIGURED_ADAPTER === "zcode"
    ? "zcode" :
  process.env.NEXT_PUBLIC_RELAY_DEFAULT_PROVIDER === "opencode" || CONFIGURED_ADAPTER === "opencode"
    ? "opencode" :
  process.env.NEXT_PUBLIC_RELAY_DEFAULT_PROVIDER === "codex" ||
  CONFIGURED_ADAPTER === "codex"
    ? "codex"
    : process.env.NEXT_PUBLIC_RELAY_DEFAULT_PROVIDER === "claude-cowork" ||
        CONFIGURED_ADAPTER === "claude-cowork"
      ? "claude-cowork"
    : process.env.NEXT_PUBLIC_RELAY_DEFAULT_PROVIDER === "claude" ||
        CONFIGURED_ADAPTER === "claude"
      ? "claude"
      : "kimi";
function agentNameForProvider(provider: AgentProvider) {
  return (
    AGENT_PROVIDER_OPTIONS.find((option) => option.id === provider)?.label ??
    provider
  );
}

function providerForSession(
  snapshot: Bootstrap | null,
  sessionId: string,
): AgentProvider {
  return (
    snapshot?.sessions.find((session) => session.id === sessionId)?.provider ??
    snapshot?.sessions[0]?.provider ??
    CONFIGURED_PROVIDER
  );
}

function Mark({ size = 18 }: { size?: number }) {
  return (
    <span
      className="brand-mark"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

function TechnicalValue({ children }: { children: ReactNode }) {
  return (
    <bdi className="technical-ltr" dir="ltr">
      {children}
    </bdi>
  );
}

function isolateTechnicalText(value: string) {
  return `\u2066${value}\u2069`;
}

function WorkbenchTextWithTechnicalValue({
  locale,
  copyKey,
  variable,
  value,
  variables = {},
}: {
  locale: AuthLocale;
  copyKey: WorkbenchCopyKey;
  variable: string;
  value: string | number;
  variables?: Record<string, string | number>;
}) {
  const marker = "__RELAYUNE_LTR_VALUE__";
  const localized = workbenchText(locale, copyKey, {
    ...variables,
    [variable]: marker,
  });
  const markerIndex = localized.indexOf(marker);
  if (markerIndex < 0) return localized;
  return (
    <>
      {localized.slice(0, markerIndex)}
      <TechnicalValue>{value}</TechnicalValue>
      {localized.slice(markerIndex + marker.length)}
    </>
  );
}

function LoginBrand({ locale, name }: { locale: AuthLocale; name: string }) {
  return (
    <Link
      className="login-brand"
      href={localePath(locale)}
      aria-label={`${authText(locale, "backHome")}: Relayune`}
    >
      <Mark size={22} />
      <span>{name}</span>
    </Link>
  );
}

function PublicSiteLinks({
  locale,
  note,
  selfHosted = false,
}: {
  locale: AuthLocale;
  note?: string;
  selfHosted?: boolean;
}) {
  if (selfHosted) return <InstancePublicLinks locale={locale} />;
  return (
    <footer className="login-footnote">
      {note && <span>{note}</span>}
      <p className="product-compatibility">
        <span>
          <WorkbenchTextWithTechnicalValue
            locale={locale}
            copyKey="productVersion"
            variable="version"
            value={RELAYUNE_WEB_RELEASE_VERSION}
            variables={{ platform: "Web" }}
          />
        </span>
        <span>
          <WorkbenchTextWithTechnicalValue
            locale={locale}
            copyKey="minimumDesktopVersion"
            variable="version"
            value={RELAYUNE_COMPATIBILITY.web.minimumDesktopVersion}
          />
        </span>
      </p>
      <nav aria-label={authText(locale, "publicNavLabel")}>
        <a href={publicDocumentPath(locale, "legal/terms")}>{authText(locale, "terms")}</a>
        <a href={publicDocumentPath(locale, "legal/privacy")}>{authText(locale, "privacy")}</a>
        <a href="mailto:giraffetree1@gmail.com">
          {authText(locale, "support")}: {" "}
          <TechnicalValue>giraffetree1@gmail.com</TechnicalValue>
        </a>
      </nav>
    </footer>
  );
}

function DesktopDownload({ locale }: { locale: AuthLocale }) {
  return (
    <div className="desktop-download">
      <div className="desktop-download-copy">
        <span className="desktop-download-icon">
          <Icon>↓</Icon>
        </span>
        <span>
          <strong>{authText(locale, "installDesktop")}</strong>
          <small>{authText(locale, "desktopAvailability")}</small>
        </span>
      </div>
      <div className="desktop-download-actions">
        <a
          href={RELAYUNE_RELEASE_ASSETS.macos.url}
          download={RELAYUNE_RELEASE_ASSETS.macos.fileName}
        >
          macOS {RELAYUNE_MACOS_RELEASE_VERSION}
        </a>
        <span className="windows-beta-link windows-download-unavailable">
          {authText(locale, "windowsBeta")}
        </span>
        <a
          href={RELAYUNE_RELEASE_ASSETS.android.url}
          download={RELAYUNE_RELEASE_ASSETS.android.fileName}
        >
          Android {RELAYUNE_ANDROID_RELEASE.version}
        </a>
      </div>
    </div>
  );
}

function AuthLanguageSwitch({
  locale,
  onToggle,
}: {
  locale: AuthLocale;
  onToggle: (locale: AuthLocale) => void;
}) {
  return (
    <label className="auth-language-switch">
      <span className="sr-only">{LANGUAGE_PICKER_LABELS[locale]}</span>
      <select
        value={locale}
        aria-label={LANGUAGE_PICKER_LABELS[locale]}
        onChange={(event) => onToggle(event.target.value as AuthLocale)}
      >
        {SUPPORTED_LOCALES.map((candidate) => (
          <option
            key={candidate}
            value={candidate}
            lang={candidate}
            dir={LOCALE_DEFINITIONS[candidate].dir}
          >
            {LOCALE_DEFINITIONS[candidate].nativeName}
          </option>
        ))}
      </select>
    </label>
  );
}

function Icon({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`icon ${className}`} aria-hidden="true">
      {children}
    </span>
  );
}

function SessionStatus({
  running,
  deviceOnline,
  startedAt,
  locale,
}: {
  running: boolean;
  deviceOnline: boolean;
  startedAt?: string | null;
  locale: AuthLocale;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);
  const elapsed = running ? formatRunningElapsed(startedAt, now, locale) : "";
  return (
    <span className={running ? "running-pill" : "idle-pill"}>
      <span />
      {running
        ? workbenchText(locale, "taskRunning", {
            elapsed: elapsed
              ? ` · ${workbenchText(locale, "runningElapsed", { elapsed })}`
              : "",
          })
        : deviceOnline
          ? workbenchText(locale, "idle")
          : workbenchText(locale, "deviceOffline")}
    </span>
  );
}


function ApprovalCard({
  approval,
  now,
  online,
  alwaysConfirmKey,
  onRequestAlwaysConfirm,
  onCancelAlwaysConfirm,
  onDecide,
  locale,
}: {
  approval: Approval;
  now: number;
  online: boolean;
  alwaysConfirmKey: string | null;
  onRequestAlwaysConfirm: (key: string) => void;
  onCancelAlwaysConfirm: () => void;
  onDecide: (
    decision: "approved" | "rejected",
    optionId?: string,
    answer?: string,
  ) => void;
  locale: AuthLocale;
}) {
  const expired =
    approval.state === "pending" && Date.parse(approval.expires_at) <= now;
  const state = expired ? "expired" : approval.state;
  const actionable = state === "pending" && online;
  const question = approval.action.type === "question.select";
  const options = approval.action.options ?? [];
  const titleId = `approval-${approval.approval_id}`;
  const actionButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const decisionStatusRef = useRef<HTMLDivElement>(null);
  const lastActionKeyRef = useRef<string | null>(null);
  const previousStateRef = useRef(state);
  const [freeformAnswer, setFreeformAnswer] = useState("");

  useEffect(() => {
    const previousState = previousStateRef.current;
    previousStateRef.current = state;
    if (state === "deciding") {
      const frame = window.requestAnimationFrame(() => {
        decisionStatusRef.current?.focus();
      });
      return () => window.cancelAnimationFrame(frame);
    }
    if (previousState === "deciding" && state === "pending") {
      const frame = window.requestAnimationFrame(() => {
        const actionKey = lastActionKeyRef.current;
        if (actionKey) actionButtonRefs.current.get(actionKey)?.focus();
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [state]);

  function rememberDecision(
    actionKey: string,
    decision: "approved" | "rejected",
    optionId?: string,
    answer?: string,
  ) {
    lastActionKeyRef.current = actionKey;
    onDecide(decision, optionId, answer);
  }

  function rememberActionButton(
    actionKey: string,
    button: HTMLButtonElement | null,
  ) {
    if (button) actionButtonRefs.current.set(actionKey, button);
    else actionButtonRefs.current.delete(actionKey);
  }
  return (
    <article
      className={`approval-card ${state} ${question ? "question" : ""}`}
      aria-busy={state === "deciding"}
      aria-labelledby={titleId}
    >
      <div className="approval-title">
        <span
          className={`risk-icon ${approval.risk_level === "high" ? "high" : ""}`}
        >
          !
        </span>
        <div>
          <div className="approval-title-line">
            <strong id={titleId}>
              {approvalTitle(approval.action.type, locale)}
            </strong>
            <span className={`risk-label ${approval.risk_level}`}>
              {workbenchText(
                locale,
                approval.risk_level === "high" ? "highRisk" : "mediumRisk",
              )}
            </span>
          </div>
          <small className="approval-expiry">
            {state === "pending"
              ? workbenchText(locale, "remaining", {
                  time: formatApprovalRemaining(approval.expires_at, now),
                })
              : formatApprovalState(state, locale)}
          </small>
        </div>
      </div>
      <dl className="approval-context">
        <div>
          <dt>{workbenchText(locale, "approvalSource")}</dt>
          <dd>
            {approval.source_agent_name ? (
              <TechnicalValue>{approval.source_agent_name}</TechnicalValue>
            ) : (
              workbenchText(locale, "kimiMainSession")
            )}
          </dd>
        </div>
        <div>
          <dt>{workbenchText(locale, "approvalDirectory")}</dt>
          <dd title={isolateTechnicalText(approval.action.cwd)}>
            <TechnicalValue>{approval.action.cwd}</TechnicalValue>
          </dd>
        </div>
      </dl>
      <code className="technical-ltr" dir="ltr">{approval.action.display}</code>
      {!online && state === "pending" && (
        <p className="approval-blocked-note">
          {workbenchText(locale, "relayOfflineApproval")}
        </p>
      )}
      {expired && (
        <p className="approval-blocked-note">
          {workbenchText(locale, "approvalExpiredRetry")}
        </p>
      )}
      {actionable && question ? (
        <div
          className="approval-actions question-options"
        >
          {options.map((option) => {
            return (
              <button
                type="button"
                className="question-option-button"
                key={option.option_id}
                ref={(button) => rememberActionButton(option.option_id, button)}
                onClick={() =>
                  rememberDecision(
                    option.option_id,
                    "approved",
                    option.option_id,
                  )
                }
              >
                <span>{approvalOptionLabel(option, true, locale)}</span>
                {option.description && <small>{option.description}</small>}
              </button>
            );
          })}
          {approval.action.allows_freeform && (
            <form
              className="question-answer-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!freeformAnswer.trim()) return;
                const answer = approval.action.is_secret
                  ? freeformAnswer
                  : freeformAnswer.trim();
                rememberDecision(
                  "question-freeform",
                  "approved",
                  undefined,
                  answer,
                );
              }}
            >
              <label htmlFor={`question-answer-${approval.approval_id}`}>
                {workbenchText(locale, "otherAnswer")}
              </label>
              {approval.action.freeform_delivery === "followup" && (
                <small>{workbenchText(locale, "answerAsFollowup")}</small>
              )}
              <div>
                <input
                  id={`question-answer-${approval.approval_id}`}
                  type={approval.action.is_secret ? "password" : "text"}
                  autoComplete="off"
                  value={freeformAnswer}
                  maxLength={4_000}
                  onChange={(event) => setFreeformAnswer(event.target.value)}
                />
                <button
                  type="submit"
                  className="question-option-button"
                  disabled={!freeformAnswer.trim()}
                >
                  {workbenchText(locale, "submitAnswer")}
                </button>
              </div>
            </form>
          )}
          <button
            type="button"
            className="question-skip-button"
            ref={(button) =>
              rememberActionButton("question-rejected", button)
            }
            onClick={() => rememberDecision("question-rejected", "rejected")}
          >
            {workbenchText(locale, "skipAnswer")}
          </button>
        </div>
      ) : actionable && options.length ? (
        <div className="approval-actions">
          {options.map((option) => {
            const rejecting = option.kind.startsWith("reject");
            const persistent =
              option.kind.includes("always") || option.kind.endsWith("policy");
            const confirmKey = `${approval.approval_id}:${option.option_id}`;
            return (
              <button
                type="button"
                className={
                  rejecting
                    ? "reject-button"
                    : persistent
                      ? "always-button"
                      : "approve-button"
                }
                key={option.option_id}
                ref={(button) => rememberActionButton(option.option_id, button)}
                onClick={() =>
                  persistent && alwaysConfirmKey !== confirmKey
                    ? onRequestAlwaysConfirm(confirmKey)
                    : rememberDecision(
                        option.option_id,
                        rejecting ? "rejected" : "approved",
                        option.option_id,
                      )
                }
              >
                {approvalOptionLabel(option, false, locale)}
              </button>
            );
          })}
        </div>
      ) : actionable ? (
        <div className="approval-actions">
          <button
            type="button"
            className="approve-button"
            ref={(button) => rememberActionButton("approved", button)}
            onClick={() => rememberDecision("approved", "approved")}
          >
            {workbenchText(locale, "allowOnce")}
          </button>
          <button
            type="button"
            className="reject-button"
            ref={(button) => rememberActionButton("rejected", button)}
            onClick={() => rememberDecision("rejected", "rejected")}
          >
            {workbenchText(locale, "reject")}
          </button>
        </div>
      ) : (
        <div
          className={`decision-label ${state}`}
          ref={decisionStatusRef}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          tabIndex={-1}
        >
          {formatApprovalState(state, locale)}
        </div>
      )}
      {alwaysConfirmKey?.startsWith(`${approval.approval_id}:`) &&
        state === "pending" && (
          <div className="approval-always-confirm" role="alert">
            <strong>{workbenchText(locale, "alwaysAllowTitle")}</strong>
            <p>{workbenchText(locale, "alwaysAllowDetail")}</p>
            <div>
              <button type="button" onClick={onCancelAlwaysConfirm}>
                {workbenchText(locale, "cancel")}
              </button>
              <button
                className="confirm"
                type="button"
                onClick={() => {
                  const optionId = alwaysConfirmKey.slice(
                    `${approval.approval_id}:`.length,
                  );
                  const option = options.find(
                    (candidate) => candidate.option_id === optionId,
                  );
                  rememberDecision(
                    optionId,
                    option?.kind.startsWith("reject")
                      ? "rejected"
                      : "approved",
                    optionId,
                  );
                }}
              >
                {workbenchText(locale, "confirmSessionAllow")}
              </button>
            </div>
          </div>
        )}
      <details className="approval-technical">
        <summary>{workbenchText(locale, "securityDetails")}</summary>
        <small>
          <WorkbenchTextWithTechnicalValue
            locale={locale}
            copyKey="commandDigest"
            variable="hash"
            value={approval.action.command_hash}
          />
        </small>
      </details>
    </article>
  );
}

function approvalTitle(type: string, locale: AuthLocale) {
  if (type === "command.execute")
    return workbenchText(locale, "approvalExecuteCommand");
  if (type === "file.change")
    return workbenchText(locale, "approvalChangeFile");
  if (type === "question.select")
    return workbenchText(locale, "approvalQuestion");
  return workbenchText(locale, "approvalRunTool");
}

function approvalOptionLabel(
  option: NonNullable<Approval["action"]["options"]>[number],
  question: boolean,
  locale: AuthLocale,
) {
  if (question) {
    return option.kind.startsWith("reject") && /^skip$/i.test(option.name)
      ? workbenchText(locale, "skipAnswer")
      : option.name;
  }
  if (option.kind === "reject_cancel")
    return workbenchText(locale, "rejectAndStop");
  if (option.kind === "reject_native") return option.name;
  if (option.kind === "allow_policy")
    return workbenchText(locale, "allowAndRemember");
  if (option.kind === "reject_policy")
    return workbenchText(locale, "rejectAndRemember");
  if (option.kind.includes("always") && option.kind.startsWith("allow")) {
    return workbenchText(locale, "alwaysAllowSession");
  }
  if (option.kind.startsWith("allow"))
    return workbenchText(locale, "allowOnce");
  if (option.kind.includes("always"))
    return workbenchText(locale, "alwaysRejectSession");
  return workbenchText(locale, "reject");
}

function formatApprovalRemaining(expiresAt: string, now: number) {
  const seconds = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatApprovalState(
  state: Approval["state"] | "expired",
  locale: AuthLocale,
) {
  if (state === "approved") return workbenchText(locale, "approvalApproved");
  if (state === "rejected") return workbenchText(locale, "approvalRejected");
  if (state === "deciding") return workbenchText(locale, "approvalSending");
  if (state === "pending") return workbenchText(locale, "approvalPending");
  return workbenchText(locale, "approvalInvalid");
}

function approvalBelongsToRoot(
  approval: Approval,
  rootSessionId: string,
  sessions: Session[],
) {
  if (!rootSessionId) return false;
  if (approval.root_session_id) {
    return approval.root_session_id === rootSessionId;
  }
  if (approval.session_id === rootSessionId) return true;
  const sourceSessionId = approval.source_thread_id ?? approval.session_id;
  const sourceSession = sessions.find(
    (session) => session.id === sourceSessionId,
  );
  return (
    sourceSession?.root_session_id === rootSessionId ||
    sourceSession?.parent_thread_id === rootSessionId
  );
}

function kimiCommandOptionId(commandName: string) {
  return `kimi-command-${commandName.replaceAll(":", "-")}`;
}

function KimiCommandPanel({
  view,
  commands,
  selectedIndex,
  configOptions,
  session,
  activeAgents,
  pendingApprovals,
  online,
  blocked,
  executingCommand,
  configuringKey,
  pendingConfirmation,
  settingsOnly = false,
  onClose,
  onViewChange,
  onRun,
  onConfigure,
  onConfirmConfiguration,
  onCancelConfirmation,
  locale,
}: {
  view: "commands" | "settings";
  commands: KimiQuickCommand[];
  selectedIndex: number;
  configOptions: SessionConfigOption[];
  session?: Session;
  activeAgents: number;
  pendingApprovals: number;
  online: boolean;
  blocked: boolean;
  executingCommand: string;
  configuringKey: string;
  pendingConfirmation: { configId: string; value: string } | null;
  settingsOnly?: boolean;
  onClose: () => void;
  onViewChange: (view: "commands" | "settings") => void;
  onRun: (command: KimiQuickCommand) => void;
  onConfigure: (configId: string, value: string) => void;
  onConfirmConfiguration: () => void;
  onCancelConfirmation: () => void;
  locale: AuthLocale;
}) {
  const configButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingConfigOption = pendingConfirmation
    ? configOptions
        .find((config) => config.id === pendingConfirmation.configId)
        ?.options?.find((option) => option.value === pendingConfirmation.value)
    : undefined;

  useEffect(() => {
    if (!configuringKey) return;
    const frame = window.requestAnimationFrame(() => {
      configButtonRefs.current.get(configuringKey)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [configuringKey]);

  return (
    <section
      className="kimi-command-panel"
      id="kimi-command-panel"
      aria-label={workbenchText(
        locale,
        settingsOnly ? "runtimeSettings" : "kimiPanelLabel",
      )}
      aria-busy={Boolean(executingCommand || configuringKey)}
    >
      <header>
        {settingsOnly ? (
          <strong>{workbenchText(locale, "runtimeSettings")}</strong>
        ) : (
          <div className="kimi-command-tabs">
            <button
              className={view === "commands" ? "active" : ""}
              type="button"
              aria-pressed={view === "commands"}
              aria-controls="kimi-command-list"
              onClick={() => onViewChange("commands")}
            >
              {workbenchText(locale, "quickCommands")}
            </button>
            <button
              className={view === "settings" ? "active" : ""}
              type="button"
              aria-pressed={view === "settings"}
              aria-controls="kimi-settings-body"
              onClick={() => onViewChange("settings")}
            >
              {workbenchText(locale, "sessionSettings")}
            </button>
          </div>
        )}
        <button
          className="kimi-command-close"
          type="button"
          onClick={onClose}
          aria-label={workbenchText(locale, "close")}
        >
          ×
        </button>
      </header>
      {view === "commands" ? (
        <div
          className="kimi-command-list"
          id="kimi-command-list"
          role="listbox"
          aria-label={workbenchText(locale, "kimiCommandsLabel")}
        >
          {commands.length ? (
            commands.map((command, index) => (
              <button
                className={index === selectedIndex ? "selected" : ""}
                id={kimiCommandOptionId(command.name)}
                role="option"
                aria-selected={index === selectedIndex}
                aria-disabled={Boolean(executingCommand) || undefined}
                aria-busy={executingCommand === command.name}
                type="button"
                key={command.name}
                onClick={() => {
                  if (!executingCommand) onRun(command);
                }}
              >
                <code className="technical-ltr" dir="ltr">/{command.name}</code>
                <span>
                  <strong>{command.label}</strong>
                  <small>{command.description}</small>
                </span>
                {executingCommand === command.name ? (
                  <i className="spinner" />
                ) : (
                  <em>{command.badge}</em>
                )}
              </button>
            ))
          ) : (
            <div className="kimi-command-empty">
              {workbenchText(locale, "noMatchingCommands")}
            </div>
          )}
        </div>
      ) : (
        <div
          className="kimi-settings-body"
          id="kimi-settings-body"
          aria-busy={Boolean(configuringKey)}
        >
          <div className="kimi-status-grid">
            <span>
              <small>{workbenchText(locale, "task")}</small>
              <strong>
                {workbenchText(
                  locale,
                  session?.status === "active" ? "running" : "idle",
                )}
              </strong>
            </span>
            <span>
              <small>{workbenchText(locale, "subagents")}</small>
              <strong>
                {workbenchText(locale, "activeAgentCount", {
                  count: activeAgents,
                })}
              </strong>
            </span>
            <span>
              <small>{workbenchText(locale, "approval")}</small>
              <strong>
                {workbenchText(locale, "pendingCount", {
                  count: pendingApprovals,
                })}
              </strong>
            </span>
            <span>
              <small>{workbenchText(locale, "context")}</small>
              <strong>
                {session?.usage
                  ? formatUsage(session.usage, locale)
                  : workbenchText(locale, "awaitingSync")}
              </strong>
            </span>
          </div>
          {!online && (
            <p className="kimi-setting-warning">
              {workbenchText(locale, "relayOfflineSettings")}
            </p>
          )}
          {blocked && (
            <p className="kimi-setting-warning">
              {workbenchText(
                locale,
                settingsOnly ? "runtimeSettingsRunning" : "kimiRunningSettings",
              )}
            </p>
          )}
          {configOptions.length ? (
            configOptions.map((config) => (
              <section className="kimi-setting-group" key={config.id}>
                <div>
                  <strong>{kimiConfigLabel(config, locale)}</strong>
                  <small>
                    {kimiConfigDescription(config, locale, settingsOnly)}
                  </small>
                  {config.id === "permissions" && <small role="status">
                    {workbenchText(locale, "desktopPermissionsFuture")}
                    {config.options?.find(option => option.value === config.currentValue)?.name ?? (config.currentValue === "custom" ? (workbenchText(locale, "customPermissions")) : (workbenchText(locale, "permissionsUnconfirmed")))}
                  </small>}
                </div>
                {config.type === "select" && config.options?.length ? (
                  <div
                    className={`kimi-setting-options ${config.id === "mode" ? "mode-options" : ""}`}
                  >
                    {config.options.map((option) => {
                      const key = `${config.id}:${option.value}`;
                      const active = config.currentValue === option.value;
                      return (
                        <button
                          className={`${active ? "active" : ""} ${[
                            "acceptEdits",
                            "auto",
                            "yolo",
                            "bypassPermissions",
                            "dontAsk",
                          ].includes(option.value) ? "dangerous" : ""}`}
                          type="button"
                          disabled={!online || blocked || active}
                          aria-disabled={Boolean(configuringKey) || undefined}
                          aria-busy={configuringKey === key}
                          key={option.value}
                          ref={(button) => {
                            if (button)
                              configButtonRefs.current.set(key, button);
                            else configButtonRefs.current.delete(key);
                          }}
                          onClick={() => {
                            if (!configuringKey)
                              onConfigure(config.id, option.value);
                          }}
                        >
                          <span>
                            {config.id === "mode"
                              ? settingsOnly
                                ? option.name
                                : kimiModeLabel(option.value, locale)
                              : option.name}
                          </span>
                          {configuringKey === key ? (
                            <i className="spinner" />
                          ) : active ? (
                            <i>✓</i>
                          ) : null}
                          {option.description && (
                            <small>
                              {config.id === "mode"
                                ? settingsOnly
                                  ? option.description
                                  : kimiModeDescription(option.value, locale)
                                : option.description}
                            </small>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <small className="kimi-setting-unavailable">
                    {workbenchText(locale, "optionUnavailableWeb")}
                  </small>
                )}
              </section>
            ))
          ) : (
            <div className="kimi-settings-empty">
              <strong>
                {workbenchText(
                  locale,
                  settingsOnly
                    ? "runtimeSettingsUnavailable"
                    : "waitingKimiConfig",
                )}
              </strong>
              <small>
                {workbenchText(
                  locale,
                  settingsOnly
                    ? "runtimeSettingsUnavailableDetail"
                    : "waitingKimiConfigDetail",
                )}
              </small>
            </div>
          )}
          {pendingConfirmation && (
            <div className="kimi-danger-confirm" role="alert">
              <strong>
                {workbenchText(locale, "confirmMode", {
                  mode: settingsOnly
                    ? (pendingConfigOption?.name ??
                      workbenchText(locale, "runtimeSettings"))
                    : kimiModeLabel(pendingConfirmation.value, locale),
                })}
              </strong>
              <p>
                {settingsOnly
                  ? (pendingConfigOption?.description ??
                    workbenchText(locale, "runtimeSettingsDescription"))
                  : workbenchText(locale, "currentKimiOnly", {
                      description: kimiModeDescription(
                        pendingConfirmation.value,
                        locale,
                      ),
                    })}
              </p>
              <div>
                <button type="button" onClick={onCancelConfirmation}>
                  {workbenchText(locale, "cancel")}
                </button>
                <button
                  className="confirm"
                  type="button"
                  onClick={onConfirmConfiguration}
                >
                  {workbenchText(locale, "confirmSwitch")}
                </button>
              </div>
            </div>
          )}
          <p className="kimi-settings-footnote">
            {workbenchText(
              locale,
              settingsOnly
                ? "encryptedRuntimeSettingsNote"
                : "encryptedSettingsNote",
            )}
          </p>
          <p
            className="login-sr-only"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {configuringKey
              ? workbenchText(locale, "updatingSessionSetting")
              : ""}
          </p>
        </div>
      )}
    </section>
  );
}

function kimiSettingValue(
  config: SessionConfigOption | undefined,
  fallback: string | null | undefined,
  empty: string,
) {
  const value = config?.currentValue;
  return typeof value === "string" && value ? value : fallback || empty;
}

function kimiConfigLabel(config: SessionConfigOption, locale: AuthLocale) {
  if (config.id === "model") return workbenchText(locale, "model");
  if (config.id === "thinking")
    return workbenchText(locale, "thinkingIntensity");
  if (config.id === "mode") return workbenchText(locale, "permissionMode");
  return config.name;
}

function kimiConfigDescription(
  config: SessionConfigOption,
  locale: AuthLocale,
  providerNeutral = false,
) {
  if (config.id === "model")
    return workbenchText(locale, "modelConfigDescription");
  if (config.id === "thinking")
    return workbenchText(locale, "thinkingConfigDescription");
  if (config.id === "mode")
    return providerNeutral
      ? (config.description ?? workbenchText(locale, "runtimeSettingsDescription"))
      : workbenchText(locale, "modeConfigDescription");
  return (
    config.description ??
    workbenchText(
      locale,
      providerNeutral ? "runtimeSettingsDescription" : "currentKimiConfig",
    )
  );
}

function kimiModeLabel(mode: string, locale: AuthLocale) {
  if (mode === "plan") return "Plan";
  if (mode === "auto") return "Auto";
  if (mode === "yolo") return "YOLO";
  if (mode === "manual") return workbenchText(locale, "manualApproval");
  if (mode === "acceptEdits") return "Accept edits";
  if (mode === "bypassPermissions") return "Bypass permissions";
  if (mode === "dontAsk") return "Don't ask";
  return mode || "Default";
}

function kimiModeDescription(mode: string, locale: AuthLocale) {
  if (mode === "plan") return workbenchText(locale, "planModeDescription");
  if (mode === "auto") return workbenchText(locale, "autoModeDescription");
  if (mode === "yolo") return workbenchText(locale, "yoloModeDescription");
  return workbenchText(locale, "manualModeDescription");
}

function formatUsage(usage: SessionUsage, locale: AuthLocale) {
  const used = formatCompactMetric(usage.used);
  if (usage.size && usage.size > 0) {
    const percent = Math.min(100, Math.round((usage.used / usage.size) * 100));
    return workbenchText(locale, "contextUsagePercent", {
      percent,
      used,
      size: formatCompactMetric(usage.size),
    });
  }
  return workbenchText(locale, "contextUsage", { value: used });
}

function formatCompactMetric(value: number | null | undefined) {
  if (!Number.isFinite(value)) return "—";
  const amount = Number(value);
  if (amount >= 1_000_000)
    return `${(amount / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (amount >= 1_000)
    return `${(amount / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(amount));
}

type ConversationGroup = {
  id: string;
  turnId: string | null;
  messages: Message[];
};

type AttachmentLoader = (attachment: MessageAttachment) => Promise<Blob>;

class AttachmentPreviewError extends Error {
  constructor(readonly code: string | null) {
    super(code ?? "attachment_read_failed");
    this.name = "AttachmentPreviewError";
  }
}

const conversationImageQueue = new ImageLoadQueue();

function ImageAttachment({
  attachment,
  load,
  locale,
}: {
  attachment: MessageAttachment;
  load?: AttachmentLoader;
  locale: AuthLocale;
}) {
  const preview = useRef<HTMLDivElement | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    const sourceUrl = attachment.url;
    if (!sourceUrl) {
      return () => controller.abort();
    }
    const request = conversationImageQueue.run(
      () => load
        ? load(attachment)
        : fetch(
          sourceUrl.startsWith("http")
            ? sourceUrl
            : `${API_BASE}${sourceUrl}`,
          {
            credentials: "include",
            signal: controller.signal,
          },
        ).then(async (response) => {
          if (!response.ok)
            throw new Error(
              `${workbenchText(locale, "imageReadFailed")} (${response.status})`,
            );
          return response.blob();
        }),
      () => {
        const element = preview.current;
        const images = element?.closest(".message-scroll")
          ?.querySelectorAll(".message-image-loading");
        return element && images ? Array.from(images).indexOf(element) : -1;
      },
      controller.signal,
    );
    void request
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch((error) => {
        if (!controller.signal.aborted && error?.name !== "AbortError") {
          setFailed(true);
        }
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment, load, locale]);

  if (failed || !attachment.url) {
    return (
      <div className="message-image-fallback">
        <Icon>▧</Icon>
        <span><TechnicalValue>{attachment.name}</TechnicalValue></span>
        <small>{workbenchText(locale, "imageReadFailed")}</small>
      </div>
    );
  }
  if (!imageUrl) {
    return (
      <div className="message-image-loading" ref={preview}>
        <span className="spinner" /> {workbenchText(locale, "readingImage")}
      </div>
    );
  }
  return (
    <a
      id={`message-attachment-${attachment.id}`}
      className="message-image"
      href={imageUrl}
      target="_blank"
      rel="noreferrer"
      title={workbenchText(locale, "openOriginalImage", {
        name: isolateTechnicalText(attachment.name),
      })}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt={attachment.name} loading="lazy" />
      <span><TechnicalValue>{attachment.name}</TechnicalValue></span>
    </a>
  );
}

function MessageAttachmentView({
  attachment,
  load,
  locale,
}: {
  attachment: MessageAttachment;
  load?: AttachmentLoader;
  locale: AuthLocale;
}) {
  if (
    attachment.type !== "image" ||
    !attachment.mime_type.startsWith("image/")
  ) {
    return <FileAttachment attachment={attachment} load={load} locale={locale} />;
  }
  return (
    <ImageAttachment attachment={attachment} load={load} locale={locale} />
  );
}

function FileAttachment({
  attachment,
  load,
  locale,
}: {
  attachment: MessageAttachment;
  load?: AttachmentLoader;
  locale: AuthLocale;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [errorKey, setErrorKey] = useState<WorkbenchCopyKey | null>(null);
  const supported =
    attachment.preview_supported === true && Boolean(attachment.url && load);

  useEffect(
    () => () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    },
    [pdfUrl],
  );

  const openPreview = async () => {
    if (!supported || !load || loading) return;
    setOpen(true);
    if (textContent !== null || pdfUrl) return;
    setLoading(true);
    setErrorKey(null);
    try {
      const blob = await load(attachment);
      if (attachment.mime_type === "application/pdf") {
        setPdfUrl(URL.createObjectURL(blob));
      } else {
        setTextContent(await blob.text());
      }
    } catch (error) {
      setErrorKey(
        error instanceof AttachmentPreviewError &&
          error.code === "attachment_too_large"
          ? "filePreviewTooLarge"
          : "filePreviewReadFailed",
      );
    } finally {
      setLoading(false);
    }
  };

  const cardContent = (
    <>
      <Icon>▧</Icon>
      <span className="message-file-copy">
        <strong><TechnicalValue>{attachment.name}</TechnicalValue></strong>
        <small>
          {supported
            ? workbenchText(locale, "filePreviewAvailable")
            : workbenchText(locale, "filePreviewUnsupported")}
        </small>
      </span>
    </>
  );

  return (
    <>
      {supported ? (
        <button
          id={`message-attachment-${attachment.id}`}
          className="message-file message-file-action"
          type="button"
          title={workbenchText(locale, "openFilePreview", {
            name: isolateTechnicalText(attachment.name),
          })}
          onClick={() => void openPreview()}
        >
          {cardContent}
        </button>
      ) : (
        <div
          id={`message-attachment-${attachment.id}`}
          className="message-file message-file-disabled"
          title={workbenchText(locale, "filePreviewUnsupported")}
          aria-disabled="true"
        >
          {cardContent}
        </div>
      )}
      {open && (
        <FilePreviewDialog
          labelledBy={`file-preview-title-${attachment.id}`}
          onDismiss={() => setOpen(false)}
        >
          <section
            className="file-preview-dialog"
          >
            <header>
              <h2 id={`file-preview-title-${attachment.id}`}>
                <TechnicalValue>{attachment.name}</TechnicalValue>
              </h2>
              <button
                type="button"
                className="file-preview-close"
                aria-label={workbenchText(locale, "closeFilePreview")}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="file-preview-content">
              {loading ? (
                <div className="file-preview-state" role="status">
                  <span className="spinner" />
                  {workbenchText(locale, "readingFile")}
                </div>
              ) : errorKey ? (
                <div className="file-preview-state file-preview-error" role="alert">
                  {workbenchText(locale, errorKey)}
                </div>
              ) : pdfUrl ? (
                <iframe
                  src={pdfUrl}
                  title={workbenchText(locale, "pdfPreviewTitle", {
                    name: isolateTechnicalText(attachment.name),
                  })}
                />
              ) : textContent !== null ? (
                attachment.mime_type === "text/markdown" ? (
                  <div className="file-preview-markdown message-markdown">
                    <MessageMarkdown locale={locale}>{textContent}</MessageMarkdown>
                  </div>
                ) : (
                  <pre className="file-preview-text technical-ltr" dir="ltr">{textContent}</pre>
                )
              ) : null}
            </div>
          </section>
        </FilePreviewDialog>
      )}
    </>
  );
}

function MessageRunningStatus({
  agentName,
  locale,
  startedAt,
}: {
  agentName: string;
  locale: AuthLocale;
  startedAt?: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  const elapsed =
    formatRunningElapsed(startedAt, now, locale) ||
    workbenchText(locale, "justStarted");

  return (
    <div className="message-running-status">
      <span className="message-running-dot" aria-hidden="true" />
      <span role="status" aria-live="polite" aria-atomic="true">
        {workbenchText(locale, "messageAgentRunning", { agent: agentName })}
      </span>
      <span className="message-running-elapsed" aria-hidden="true">
        · {workbenchText(locale, "runningElapsed", { elapsed })}
      </span>
    </div>
  );
}

function ToolActivityMessage({
  message,
  locale,
}: {
  message: Message;
  locale: AuthLocale;
}) {
  const activity = message.toolActivity!;
  const labelKey =
    activity.status === "failed"
      ? "toolActivityFailed"
      : activity.status === "completed"
        ? "toolActivityCompleted"
        : "toolActivityRunning";
  const detail = activity.detail.trim();

  return (
    <article
      className={`tool-activity-message ${activity.status}`}
      data-tool-activity-id={message.id}
      data-conversation-message-id={message.id}
    >
      <span className="tool-activity-state" aria-hidden="true">
        {activity.status === "running" ? (
          <span className="tool-activity-spinner" />
        ) : activity.status === "failed" ? (
          "!"
        ) : (
          "✓"
        )}
      </span>
      <div>
        <strong role="status" aria-live="polite">
          <WorkbenchTextWithTechnicalValue
            locale={locale}
            copyKey={labelKey}
            variable="command"
            value={activity.label}
          />
        </strong>
        {detail && (
          <details className="tool-activity-output">
            <summary>{workbenchText(locale, "toolActivityOutput")}</summary>
            <pre className="technical-ltr" dir="ltr">{detail}</pre>
          </details>
        )}
      </div>
    </article>
  );
}

function CompactToolActivityGroup({
  messages,
  locale,
}: {
  messages: Message[];
  locale: AuthLocale;
}) {
  const activities = messages.map((message) => message.toolActivity!);
  const running = activities.some((activity) => activity.status === "running");
  const failed = activities.some((activity) => activity.status === "failed");
  const types = new Set(activities.map((activity) => activity.type));
  const allCommands = types.size === 1 && types.has("command");
  const allReads = types.size === 1 && types.has("file_read");
  const allChanges = types.size === 1 && types.has("file_change");
  const fileCount = activities.reduce(
    (total, activity) => total + (activity.count ?? 1),
    0,
  );
  const preview = allCommands
    ? activities.at(-1)?.command ?? activities.at(-1)?.label ?? ""
    : [...new Set(activities.map((activity) => activity.subject).filter(Boolean))]
        .join("、");
  const title = compactToolActivityGroupTitle({
    locale,
    running,
    failed,
    allCommands,
    allReads,
    allChanges,
    count: allCommands ? messages.length : fileCount,
    operationCount: messages.length,
  });

  return (
    <details className={`tool-activity-group${allCommands ? " commands" : ""}${running ? " running" : ""}${failed && !allCommands ? " failed" : ""}`}>
      <summary>
        <span className="tool-activity-state" aria-hidden="true">
          {running ? <span className="tool-activity-spinner" /> : allCommands ? "›_" : failed ? "!" : "✓"}
        </span>
        <strong>{title}</strong>
        {preview && <small title={preview}>· {preview}</small>}
        <span className="tool-activity-group-chevron" aria-hidden="true">›</span>
      </summary>
      <div className="tool-activity-group-content">
        {messages.map((message) => (
          <ToolActivityMessage message={message} locale={locale} key={message.id} />
        ))}
      </div>
    </details>
  );
}

function compactToolActivityGroupTitle({
  locale,
  running,
  failed,
  allCommands,
  allReads,
  allChanges,
  count,
  operationCount,
}: {
  locale: AuthLocale;
  running: boolean;
  failed: boolean;
  allCommands: boolean;
  allReads: boolean;
  allChanges: boolean;
  count: number;
  operationCount: number;
}) {
  if (allCommands) {
    return workbenchText(
      locale,
      running
        ? "toolGroupCommandsRunning"
        : "toolGroupCommandsCompleted",
      { count },
    );
  }
  if (allReads) {
    return workbenchText(
      locale,
      running
        ? "toolGroupReadsRunning"
        : failed
          ? "toolGroupReadsFailed"
          : "toolGroupReadsCompleted",
      { count },
    );
  }
  if (allChanges) {
    return workbenchText(
      locale,
      running
        ? "toolGroupChangesRunning"
        : failed
          ? "toolGroupChangesFailed"
          : "toolGroupChangesCompleted",
      { count },
    );
  }
  return workbenchText(
    locale,
    running
      ? "toolGroupMixedRunning"
      : failed
        ? "toolGroupMixedFailed"
        : "toolGroupMixedCompleted",
    { count: operationCount },
  );
}

function compactToolActivityBlocks(messages: Message[]) {
  const blocks: Array<{ messages: Message[]; grouped: boolean }> = [];
  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    if (!isCollapsibleLocalToolActivity(message)) {
      blocks.push({ messages: [message], grouped: false });
      index += 1;
      continue;
    }
    const grouped = [message];
    index += 1;
    while (index < messages.length && isCollapsibleLocalToolActivity(messages[index])) {
      grouped.push(messages[index]);
      index += 1;
    }
    blocks.push({ messages: grouped, grouped: grouped.length > 1 });
  }
  return blocks;
}

function isCollapsibleLocalToolActivity(message: Message) {
  return Boolean(
    message.toolActivity &&
      ["command", "file_read", "file_change"].includes(
        message.toolActivity.type ?? "",
      ),
  );
}

function MessageArticle({
  message,
  email,
  loadAttachment,
  locale,
  runningAgentName,
  runningStartedAt,
}: {
  message: Message;
  email: string;
  loadAttachment?: AttachmentLoader;
  locale: AuthLocale;
  runningAgentName?: string;
  runningStartedAt?: string | null;
}) {
  const reminderOnly =
    !message.attachments?.length &&
    isSystemReminderOnlyContent(message.content);
  const messageMeta =
    message.role === "user"
      ? workbenchText(locale, "youMeta", {
          time: formatMessageTimestamp(message.createdAt, locale),
        })
      : message.meta;

  if (message.toolActivity) {
    return <ToolActivityMessage message={message} locale={locale} />;
  }

  return (
    <article
      data-conversation-message-id={message.id}
      className={`message ${message.role}${reminderOnly ? " message-reminder-only" : ""}`}
    >
      <div className="message-avatar">
        {message.role === "codex" ? (
          <Mark size={17} />
        ) : message.role === "user" ? (
          email.slice(0, 1).toUpperCase()
        ) : (
          <Icon>⌁</Icon>
        )}
      </div>
      <div className="message-body">
        <div className="message-meta">{messageMeta}</div>
        <div className="message-markdown">
          <Suspense
            fallback={
              <SystemReminderContent
                locale={locale}
                renderContent={(content) =>
                  content ? (
                    <span className="message-markdown-fallback">{content}</span>
                  ) : null
                }
              >
                {message.content || (message.attachments?.length ? "" : "…")}
              </SystemReminderContent>
            }
          >
            <MessageMarkdown
              locale={locale}
              referencedAttachments={message.attachments}
            >
              {message.content || (message.attachments?.length ? "" : "…")}
            </MessageMarkdown>
          </Suspense>
        </div>
        {!!message.attachments?.length && (
          <div className="message-attachments">
            {message.attachments.map((attachment) => (
              <MessageAttachmentView
                attachment={attachment}
                key={attachment.id}
                load={loadAttachment}
                locale={locale}
              />
            ))}
          </div>
        )}
        {message.role === "user" && !reminderOnly && (
          <span
            aria-label={workbenchText(locale, "messageDelivered")}
            className="message-delivery-indicator"
            role="img"
          >
            ✓
          </span>
        )}
        {runningAgentName && message.role === "codex" && (
          <MessageRunningStatus
            agentName={runningAgentName}
            locale={locale}
            startedAt={runningStartedAt ?? message.createdAt}
          />
        )}
      </div>
    </article>
  );
}

function ConversationTurn({
  group,
  email,
  active,
  agentName,
  runningStartedAt,
  loadAttachment,
  locale,
}: {
  group: ConversationGroup;
  email: string;
  active: boolean;
  agentName: string;
  runningStartedAt?: string | null;
  loadAttachment?: AttachmentLoader;
  locale: AuthLocale;
}) {
  const [activityOpen, setActivityOpen] = useState(active);
  const previousActive = useRef(active);
  useEffect(() => {
    if (previousActive.current !== active) {
      setActivityOpen(active);
      previousActive.current = active;
    }
  }, [active]);

  const userMessages = group.messages.filter(
    (message) => message.role === "user",
  );
  const assistantMessages = group.messages.filter(
    (message) => message.role !== "user",
  );
  const finalCodexIndex = assistantMessages.findLastIndex(
    (message) => message.role === "codex",
  );
  const finalMessage =
    finalCodexIndex >= 0 ? assistantMessages[finalCodexIndex] : null;
  const activityMessages = assistantMessages.filter(
    (_, index) => index !== finalCodexIndex,
  );
  const activityBlocks = compactToolActivityBlocks(activityMessages);
  const elapsed = formatElapsed(group.messages, active, locale);

  return (
    <section className={`conversation-turn ${active ? "active" : "completed"}`}>
      {userMessages.map((message) => (
        <MessageArticle
          message={message}
          email={email}
          key={message.id}
          loadAttachment={loadAttachment}
          locale={locale}
        />
      ))}
      {activityMessages.length > 0 && (
        <details
          className="turn-activity"
          open={activityOpen}
          onToggle={(event) => setActivityOpen(event.currentTarget.open)}
        >
          <summary>
            <span className={active ? "turn-pulse" : "turn-check"}>
              {active ? "·" : "✓"}
            </span>
            <strong>
              {workbenchText(
                locale,
                active ? "turnProcessing" : "turnProcessed",
              )}
            </strong>
            {elapsed && <small>{elapsed}</small>}
            <span className="turn-chevron">›</span>
          </summary>
          <div className="turn-activity-content">
            {activityBlocks.map((block) =>
              block.grouped ? (
                <CompactToolActivityGroup
                  messages={block.messages}
                  locale={locale}
                  key={`tool-group-${block.messages[0].id}`}
                />
              ) : (
                <MessageArticle
                  message={block.messages[0]}
                  email={email}
                  key={block.messages[0].id}
                  loadAttachment={loadAttachment}
                  locale={locale}
                />
              ),
            )}
          </div>
        </details>
      )}
      {finalMessage && (
        <MessageArticle
          message={finalMessage}
          email={email}
          loadAttachment={loadAttachment}
          locale={locale}
          runningAgentName={active ? agentName : undefined}
          runningStartedAt={active ? runningStartedAt : undefined}
        />
      )}
      {active && !finalMessage && (
        <div className="turn-running-status">
          <MessageRunningStatus
            agentName={agentName}
            locale={locale}
            startedAt={runningStartedAt}
          />
        </div>
      )}
    </section>
  );
}

function formatTime(value: string | null, locale: AuthLocale = "zh-CN") {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMessageTimestamp(
  value: string | null,
  locale: AuthLocale = "zh-CN",
  now = new Date(),
) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(parsed);
  const calendarDay = (date: Date) =>
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const daysAgo = Math.round(
    (calendarDay(now) - calendarDay(parsed)) / 86_400_000,
  );
  let dateLabel: string;
  if (daysAgo >= 0 && daysAgo <= 2) {
    dateLabel = new Intl.RelativeTimeFormat(locale, {
      numeric: "auto",
    }).format(-daysAgo, "day");
    if (locale === "en") {
      dateLabel = `${dateLabel.slice(0, 1).toUpperCase()}${dateLabel.slice(1)}`;
    }
  } else {
    dateLabel = new Intl.DateTimeFormat(locale, {
      ...(parsed.getFullYear() === now.getFullYear()
        ? {}
        : { year: "numeric" }),
      month: "short",
      day: "numeric",
    }).format(parsed);
  }
  return `${dateLabel} · ${time}`;
}

function formatElapsed(messages: Message[], active: boolean, locale: AuthLocale) {
  const timestamps = messages
    .map((message) => Date.parse(message.createdAt))
    .filter(Number.isFinite);
  if (!timestamps.length) return "";
  const started = Math.min(...timestamps);
  const finished = active ? Date.now() : Math.max(...timestamps);
  const seconds = Math.max(0, Math.round((finished - started) / 1_000));
  return seconds < 1 ? "" : formatDurationSeconds(seconds, locale);
}

function formatRunningElapsed(
  startedAt: string | null | undefined,
  now: number,
  locale: AuthLocale = "zh-CN",
) {
  if (!startedAt) return "";
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return "";
  const seconds = Math.max(0, Math.floor((now - started) / 1_000));
  return formatDurationSeconds(seconds, locale);
}

function earliestTimestamp(values: Array<string | null | undefined>) {
  const timestamps = values
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter(Number.isFinite);
  return timestamps.length
    ? new Date(Math.min(...timestamps)).toISOString()
    : null;
}

function groupConversationMessages(messages: Message[]) {
  const groups: ConversationGroup[] = [];
  const byTurn = new Map<string, ConversationGroup>();
  for (const message of messages) {
    const turnId = message.turnId ?? null;
    const key = turnId ? `turn:${turnId}` : `message:${message.id}`;
    let group = byTurn.get(key);
    if (!group) {
      group = { id: key, turnId, messages: [] };
      groups.push(group);
      byTurn.set(key, group);
    }
    group.messages.push(message);
  }
  return groups;
}


async function api<T>(
  path: string,
  options: RequestInit & { relayTimeoutMs?: number } = {},
) {
  const requestUrl = sameOriginApiUrl(path, API_BASE, window.location.origin);
  const { relayTimeoutMs = RELAY_REQUEST_TIMEOUT_MS, ...requestOptions } =
    options;
  const headers = new Headers(requestOptions.headers);
  headers.set("X-Relay-Client-Version", RELAYUNE_WEB_RELEASE_VERSION);
  headers.set("X-Relay-Client-Platform", "web");
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (activeBrowserAuthorizationToken && isBrowserAuthorizedPath(path)) {
    headers.set("X-Relay-Browser-Token", activeBrowserAuthorizationToken);
  }
  const timeout = new AbortController();
  const timeoutId = window.setTimeout(() => timeout.abort(), relayTimeoutMs);
  const combinedSignal = requestOptions.signal
    ? combineAbortSignals([requestOptions.signal, timeout.signal])
    : null;
  const signal = combinedSignal?.signal ?? timeout.signal;
  let response: Response;
  let body: T & { error?: { code?: string; message?: string } };
  try {
    try {
      response = await fetch(requestUrl, {
        ...requestOptions,
        credentials: "include",
        redirect: "error",
        headers,
        signal,
      });
      body = (await response.json().catch(error => {
        if (signal.aborted) throw error;
        return {};
      })) as T & { error?: { code?: string; message?: string } };
    } catch (error) {
      if (requestOptions.signal?.aborted) throw error;
      throw new RelayApiError(
        timeout.signal.aborted
          ? workbenchText(activeWorkbenchLocale, "networkTimeout")
          : workbenchText(activeWorkbenchLocale, "networkUnavailable"),
        0,
        timeout.signal.aborted ? "network_timeout" : "network_unavailable",
      );
    }
    if (!response.ok) {
      if (
        isBrowserAuthorizationLost(response.status, body.error?.code) &&
        typeof window !== "undefined"
      ) {
        window.dispatchEvent(new Event("relayune-browser-revoked"));
      }
      throw new RelayApiError(
        body.error?.message ??
          workbenchText(activeWorkbenchLocale, "relayRequestFailed", {
            status: response.status,
          }),
        response.status,
        body.error?.code ?? "request_failed",
      );
    }
    return body;
  } finally {
    combinedSignal?.dispose();
    window.clearTimeout(timeoutId);
  }
}

function isPendingRelayResponse(error: Error) {
  if (error instanceof RelayApiError) {
    return (
      error.status === 404 || /pending|waiting|not_found/i.test(error.code)
    );
  }
  return /pending|waiting|not found|404/i.test(error.message);
}

function isBrowserAuthorizedPath(path: string) {
  return (
    path === "/api/browser/pairings/activate" ||
    path.startsWith("/api/bootstrap") ||
    path.startsWith("/api/commands") ||
    path.startsWith("/api/events") ||
    path.startsWith("/api/responses/") ||
    path.startsWith("/api/relay/devices/")
  );
}

function browserDisplayName() {
  if (typeof navigator === "undefined")
    return workbenchText(activeWorkbenchLocale, "thisBrowser");
  const userAgent = navigator.userAgent;
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /CriOS\//.test(userAgent)
        ? "Chrome"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : workbenchText(activeWorkbenchLocale, "genericBrowser");
  const platform = /iPhone|iPad/.test(userAgent)
    ? "iPhone / iPad"
    : /Android/.test(userAgent)
      ? "Android"
      : /Macintosh/.test(userAgent)
        ? "Mac"
        : /Windows/.test(userAgent)
          ? "Windows"
          : workbenchText(activeWorkbenchLocale, "thisDevice");
  return `${browser} · ${platform}`;
}

async function decryptCatalog(
  frame: OpaqueFrame | null,
  key: RelayKey,
): Promise<{ sessions: Session[]; projects: SavedProject[]; supportsOnlineStream: boolean }> {
  if (!frame) return { sessions: [], projects: [], supportsOnlineStream: false };
  const payload = await openJson<{
    type: string;
    sessions: Session[];
    projects?: SavedProject[];
    desktop?: { transports?: string[] };
  }>(
    key,
    frame.envelope,
    frame.aad,
  );
  if (
    payload.type !== "relay.sync_sessions" ||
    !Array.isArray(payload.sessions)
  ) {
    throw new Error(
      workbenchText(activeWorkbenchLocale, "invalidEncryptedCatalog"),
    );
  }
  return {
    sessions: payload.sessions,
    projects: Array.isArray(payload.projects) ? payload.projects : [],
    supportsOnlineStream: payload.desktop?.transports?.includes("online-stream-v1") === true,
  };
}

async function decryptEventFrame(
  frame: OpaqueFrame,
  key: RelayKey,
): Promise<RelayEvent> {
  const payload = await openJson<{
    type: string;
    session_id: string;
    agent_id: string | null;
    request_id: string | null;
    event: RelayEvent["event"];
    created_at: string;
  }>(key, frame.envelope, frame.aad);
  if (
    payload.type !== "session.event" ||
    payload.session_id !== frame.session_id
  ) {
    throw new Error(
      workbenchText(activeWorkbenchLocale, "invalidEncryptedEventRoute"),
    );
  }
  return {
    cursor: frame.cursor ?? 0,
    event_id: frame.event_id ?? `evt_${frame.cursor ?? crypto.randomUUID()}`,
    session_id: payload.session_id,
    agent_id: payload.agent_id,
    created_at: payload.created_at,
    event: payload.event,
  };
}

export default function WorkbenchPage() {
  const [showLogin, setShowLogin] = useState(false);
  const marketingLoginEntryRef = useRef(false);
  const authRequestAbort = useRef<AbortController | null>(null);
  const loginRequested = useMemo(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("login") === "1";
  }, []);
  const passwordSetupRequested = useMemo(() => {
    if (typeof window === "undefined") return false;
    return (
      new URLSearchParams(window.location.search).get("auth") === "set-password"
    );
  }, []);
  const pairingParameter = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("pair");
  }, []);
  const desktopLoginParameter = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("desktop_login");
  }, []);
  const desktopLoginId =
    desktopLoginParameter &&
    DESKTOP_LOGIN_ID_PATTERN.test(desktopLoginParameter)
      ? desktopLoginParameter
      : null;
  const urlPairingId =
    pairingParameter && PAIRING_ID_PATTERN.test(pairingParameter)
      ? pairingParameter
      : null;
  const [pendingBrowserPairingId, setPendingBrowserPairingId] = useState<
    string | null
  >(null);
  const pairingId = urlPairingId ?? pendingBrowserPairingId;
  const invalidPairingEntry = pairingParameter !== null && !urlPairingId;
  const invalidDesktopLoginEntry =
    desktopLoginParameter !== null &&
    (!desktopLoginId || pairingParameter !== null);
  const clientReady = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [authLocaleOverride, setAuthLocaleOverride] =
    useState<AuthLocale | null>(null);
  const authLocale =
    authLocaleOverride ??
    (clientReady
      ? detectAuthLocale(navigator.languages, readStoredAuthLocale())
      : "zh-CN");
  const authenticationEntryRequested =
    showLogin ||
    (clientReady &&
      (loginRequested ||
        passwordSetupRequested ||
        pairingParameter !== null ||
        desktopLoginParameter !== null));

  const toggleAuthLocale = useCallback((next: AuthLocale) => {
    activeWorkbenchLocale = next;
    storeAuthLocale(next);
    setToast((current) => (typeof current === "string" ? "" : current));
    setAuthLocaleOverride(next);
  }, []);

  useEffect(() => {
    activeWorkbenchLocale = authLocale;
    applyDocumentLocale(authLocale);
  }, [authLocale]);
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [instance, setInstance] = useState<InstanceCapabilities | null>(null);
  const [instanceError, setInstanceError] = useState(false);
  const selfHostedInstance = instance?.auth_mode === "username";
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10_000);
    void discoverInstance(API_BASE, window.location.origin, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setInstance(value); })
      .catch(() => { if (live) setInstanceError(true); })
      .finally(() => window.clearTimeout(timer));
    return () => { live = false; window.clearTimeout(timer); controller.abort(); };
  }, []);
  useMarketingReturnFocus(!authenticationEntryRequested && !authenticated);

  useEffect(() => {
    if (authenticated) applyDocumentLocale(authLocale);
  }, [authenticated, authLocale]);
  const [bootstrapErrorKind, setBootstrapErrorKind] =
    useState<AuthBootstrapErrorKind | null>(null);
  const bootstrapError = bootstrapErrorKind
    ? authBootstrapErrorText(authLocale, bootstrapErrorKind)
    : "";
  const [pairingLinkError, setPairingLinkError] = useState<AuthCopyKey | null>(
    null,
  );
  const [syncInterrupted, setSyncInterrupted] = useState(false);
  const [retryingSync, setRetryingSync] = useState(false);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<AuthCopyKey | null>(null);
  const [emailFlowError, setEmailFlowError] = useState<AuthCopyKey | null>(
    null,
  );
  const [resendingVerification, setResendingVerification] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<AuthCopyKey | null>(null);
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [newPasswordError, setNewPasswordError] = useState<AuthCopyKey | null>(
    null,
  );
  const [passwordConfirmationError, setPasswordConfirmationError] =
    useState<AuthCopyKey | null>(null);
  const [passwordSetupError, setPasswordSetupError] =
    useState<AuthCopyKey | null>(null);
  const [loginState, setLoginState] = useState<
    | "idle"
    | "checking"
    | "password"
    | "authenticating"
    | "sending"
    | "sending-reset"
    | "sent"
    | "set-password"
    | "saving-password"
  >(() => (passwordSetupRequested ? "set-password" : "idle"));
  const [desktopLoginApproval, setDesktopLoginApproval] =
    useState<DesktopLoginApproval | null>(null);
  const [desktopLoginError, setDesktopLoginError] =
    useState<AuthCopyKey | null>(null);
  const [approvingDesktopLogin, setApprovingDesktopLogin] = useState(false);
  const [needsE2eeKey, setNeedsE2eeKey] = useState(false);
  const [pendingBrowserDiscovery, setPendingBrowserDiscovery] =
    useState<PendingBrowserPairingDiscovery | null>(null);
  const [checkingPendingBrowserPairings, setCheckingPendingBrowserPairings] =
    useState(false);
  const [pendingBrowserDiscoveryError, setPendingBrowserDiscoveryError] =
    useState<AuthCopyKey | null>(null);
  const [pairingCode, setPairingCode] = useState("");
  const [pairingFormError, setPairingFormError] = useState<AuthCopyKey | null>(
    null,
  );
  const [pairingPhase, setPairingPhase] = useState<
    "idle" | "deriving" | "waiting" | "activating" | "complete"
  >("idle");
  const [snapshot, setSnapshot] = useState<Bootstrap | null>(null);
  const [onlineStreamSupported, setOnlineStreamSupported] = useState(false);
  const onlineStream = useRef<OnlineStream | null>(null);
  const onlineResponses = useRef(new Map<string, Promise<{ value?: unknown; error?: unknown; fallback?: OnlineReadFallback }>>());
  const [projectPages, setProjectPages] = useState<Record<string, {
    sessions: Session[]; cursor: string | null; loaded: boolean; loading: boolean; failed: boolean;
  }>>({});
  const projectPagesInFlight = useRef(new Set<string>());
  const [addingProject, setAddingProject] = useState(false);
  const [realtimeDevice, setRealtimeDevice] = useState<RealtimeDeviceState>(
    INITIAL_REALTIME_DEVICE_STATE,
  );
  const deviceOnline = realtimeDevice.realtimeConfirmed
    ? realtimeDevice.online
    : Boolean(snapshot?.device.online);
  const deviceLastSeenAt = realtimeDevice.realtimeConfirmed
    ? realtimeDevice.lastSeenAt
    : (snapshot?.device.last_seen_at ?? null);
  const [activeSession, setActiveSession] = useState("");
  const [selectedProvider, setSelectedProvider] =
    useState<AgentProvider>(CONFIGURED_PROVIDER);
  const [messageMap, setMessageMap] = useState<Record<string, Message[]>>({});
  const [historyPageMap, setHistoryPageMap] = useState<
    Record<string, HistoryPageState>
  >({});
  const [activeTurnMap, setActiveTurnMap] = useState<Record<string, string>>(
    {},
  );
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set(),
  );
  const [draftMap, setDraftMap] = useState<Record<string, string>>({});
  const [pendingAttachmentMap, setPendingAttachmentMap] = useState<
    Record<string, PendingMessageAttachment[]>
  >({});
  const draft = activeSession ? (draftMap[activeSession] ?? "") : "";
  const pendingAttachments = activeSession
    ? (pendingAttachmentMap[activeSession] ?? [])
    : [];
  const pendingAttachmentMapRef = useRef(pendingAttachmentMap);
  useEffect(() => {
    pendingAttachmentMapRef.current = pendingAttachmentMap;
  }, [pendingAttachmentMap]);
  const setDraft = useCallback(
    (nextDraft: string | ((current: string) => string)) => {
      const sessionId = activeSession;
      if (!sessionId) return;
      setDraftMap((previous) => {
        const current = previous[sessionId] ?? "";
        const next =
          typeof nextDraft === "function" ? nextDraft(current) : nextDraft;
        if (next === current) return previous;
        if (!next) {
          const updated = { ...previous };
          delete updated[sessionId];
          return updated;
        }
        return { ...previous, [sessionId]: next };
      });
    },
    [activeSession],
  );
  const [sendingMessage, setSendingMessage] = useState(false);
  const [stoppingTurn, setStoppingTurn] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteView, setCommandPaletteView] = useState<
    "commands" | "settings"
  >("commands");
  const [commandSelection, setCommandSelection] = useState(0);
  const [executingKimiCommand, setExecutingKimiCommand] = useState("");
  const [configuringKey, setConfiguringKey] = useState("");
  const [pendingConfigConfirmation, setPendingConfigConfirmation] = useState<{
    configId: string;
    value: string;
  } | null>(null);
  const [approvalAlwaysConfirm, setApprovalAlwaysConfirm] = useState<
    string | null
  >(null);
  const [approvalNow, setApprovalNow] = useState(() => Date.now());
  const [creatingProject, setCreatingProject] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"workspace" | "activity">(
    "workspace",
  );
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const [agentWindowOpenRequest, setAgentWindowOpenRequest] = useState(0);
  const [inspectedAgentId, setInspectedAgentId] = useState<string | null>(null);
  const [agentActivityLoading, setAgentActivityLoading] = useState(false);
  const [agentActivityError, setAgentActivityError] = useState<string | null>(
    null,
  );
  const [toast, setToast] = useState<string | WorkbenchToastPresentation>("");
  const [authToastKey, setAuthToastKey] = useState<AuthCopyKey | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const visibleToast = authToastKey
    ? authText(authLocale, authToastKey)
    : typeof toast === "string"
      ? toast
      : workbenchText(authLocale, toast.key, toast.variables);
  const seenEvents = useRef(new Set<string>());
  const historyLoaded = useRef(new Set<string>());
  const activeSessionRef = useRef(activeSession);
  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);
  const historyInFlight = useRef(new Set<string>());
  const agentActivityInFlight = useRef(new Set<string>());
  const agentActivityViewRevision = useRef(0);
  const messageScroll = useRef<HTMLDivElement | null>(null);
  const messageScrollFollowsLatest = useRef(true);
  const historyStatusRef = useRef<HTMLDivElement | null>(null);
  const approvalSectionRef = useRef<HTMLElement | null>(null);
  const activeTurnIds = useRef(new Map<string, string>());
  const codexQueueStatuses = useRef(new Map<string, string>());
  const pendingUserMessages = useRef(new Map<string, string>());
  const relayKey = useRef<RelayKey | null>(null);
  const relayDeviceId = useRef<string | null>(null);
  const snapshotRef = useRef<Bootstrap | null>(null);
  const selectedProviderRef = useRef<AgentProvider>(CONFIGURED_PROVIDER);
  const opaqueCursor = useRef(0);
  const realtimeDeviceRef = useRef<RealtimeDeviceState>(
    INITIAL_REALTIME_DEVICE_STATE,
  );
  const eventCatchUpInFlight = useRef<Promise<void> | null>(null);
  const responseWaiters = useRef(new Set<() => void>());
  const projectDrawerTrigger = useRef<HTMLButtonElement | null>(null);
  const projectDrawerClose = useRef<HTMLButtonElement | null>(null);
  const accountMenuContainerRef = useRef<HTMLDivElement | null>(null);
  const accountMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const composerInput = useRef<HTMLTextAreaElement | null>(null);
  const composerComposing = useRef(false);
  const attachmentInput = useRef<HTMLInputElement | null>(null);
  const messageSendInFlight = useRef(false);
  const sessionCreateInFlight = useRef(false);
  const approvalDecisionsInFlight = useRef(new Set<string>());
  const turnInterruptInFlight = useRef(false);
  const stopTurnButtonRef = useRef<HTMLButtonElement | null>(null);
  const configurationInFlight = useRef(false);
  const workspaceTitleRef = useRef<HTMLHeadingElement | null>(null);
  const checkingAuthTitleRef = useRef<HTMLHeadingElement | null>(null);
  const bootstrapErrorTitleRef = useRef<HTMLHeadingElement | null>(null);
  const invalidPairingTitleRef = useRef<HTMLHeadingElement | null>(null);
  const pairingLinkErrorTitleRef = useRef<HTMLHeadingElement | null>(null);
  const verificationSentTitleRef = useRef<HTMLHeadingElement | null>(null);
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const passwordConfirmationInputRef = useRef<HTMLInputElement | null>(null);
  const passwordResetButtonRef = useRef<HTMLButtonElement | null>(null);
  const passwordSetupSubmitButtonRef = useRef<HTMLButtonElement | null>(null);
  const passwordSetupRecoveryButtonRef = useRef<HTMLButtonElement | null>(null);
  const pendingPairingDeviceSelectRef = useRef<HTMLSelectElement | null>(null);
  const pendingDiscoveryRetryButtonRef = useRef<HTMLButtonElement | null>(null);
  const pendingDiscoveryTitleRef = useRef<HTMLHeadingElement | null>(null);
  const pairingCodeInputRef = useRef<HTMLInputElement | null>(null);
  const pairingSubmitButtonRef = useRef<HTMLButtonElement | null>(null);
  const pairingRunId = useRef(0);
  const pairingAbort = useRef<AbortController | null>(null);
  const syncRetryInFlight = useRef(false);
  const logoutInFlight = useRef(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const logoutError = logoutFailed ? (
    <p className="login-field-error" role="alert">
      {authText(authLocale, "signOutFailed")}
    </p>
  ) : null;
  const updateRealtimeDevice = useCallback(
    (project: (current: RealtimeDeviceState) => RealtimeDeviceState) => {
      const current = realtimeDeviceRef.current;
      const next = project(current);
      if (next === current) return;
      realtimeDeviceRef.current = next;
      setRealtimeDevice(next);
    },
    [],
  );
  const workspaceReady =
    !checkingAuth &&
    !bootstrapErrorKind &&
    !invalidPairingEntry &&
    !pairingLinkError &&
    authenticated &&
    !pairingId &&
    !needsE2eeKey &&
    snapshot !== null;

  const discoverPendingBrowserPairings = useCallback(
    async (signal?: AbortSignal, restoreFocusOnResult = false) => {
      setCheckingPendingBrowserPairings(true);
      setPendingBrowserDiscoveryError(null);
      try {
        const discovery = await api<PendingBrowserPairingDiscovery>(
          "/api/browser/pairings/pending",
          { signal },
        );
        setPendingBrowserDiscovery(discovery);
        if (restoreFocusOnResult && !discovery.has_bound_computer) {
          window.requestAnimationFrame(() => {
            pendingDiscoveryTitleRef.current?.focus();
          });
        }
        setPendingBrowserPairingId((current) => {
          if (
            current &&
            discovery.pairings.some((pairing) => pairing.pairing_id === current)
          ) {
            return current;
          }
          return discovery.pairings.length === 1
            ? discovery.pairings[0].pairing_id
            : null;
        });
        return discovery;
      } catch (error) {
        if (!signal?.aborted) {
          setPendingBrowserDiscoveryError("pendingComputerDiscoveryFailed");
          if (restoreFocusOnResult) {
            window.requestAnimationFrame(() => {
              pendingDiscoveryRetryButtonRef.current?.focus();
            });
          }
        }
        throw error;
      } finally {
        setCheckingPendingBrowserPairings(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!authenticated || !needsE2eeKey || pairingParameter !== null) return;
    const controller = new AbortController();
    // Prefetch after the effect has synchronized. The discovery updates the
    // selected pending pairing only when its network response arrives; it does
    // not need a synchronous mirror state that causes an extra render here.
    const discoveryTimer = window.setTimeout(() => {
      void discoverPendingBrowserPairings(controller.signal).catch(() => {});
    }, 0);
    return () => {
      window.clearTimeout(discoveryTimer);
      controller.abort();
    };
  }, [
    authenticated,
    discoverPendingBrowserPairings,
    needsE2eeKey,
    pairingParameter,
  ]);

  useEffect(() => {
    const returnToMarketing = () => {
      if (
        (marketingLoginEntryRef.current || hasMarketingReturnFocus()) &&
        !hasAuthenticationEntry(window.location.search)
      ) {
        authRequestAbort.current?.abort();
        authRequestAbort.current = null;
        marketingLoginEntryRef.current = false;
        setLoginState("idle");
        setEmailError(null);
        setEmailFlowError(null);
        setResendingVerification(false);
        setPassword("");
        setPasswordError(null);
        setPasswordConfirmation("");
        setNewPasswordError(null);
        setPasswordConfirmationError(null);
        setPasswordSetupError(null);
        setAuthToastKey(null);
        setShowLogin(false);
      }
    };
    window.addEventListener("popstate", returnToMarketing);
    return () => window.removeEventListener("popstate", returnToMarketing);
  }, []);

  useEffect(() => () => authRequestAbort.current?.abort(), []);

  useEffect(() => {
    if (!checkingAuth || !authenticationEntryRequested) return;
    const frame = window.requestAnimationFrame(() => {
      checkingAuthTitleRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [authenticationEntryRequested, checkingAuth]);

  useEffect(() => {
    if (!bootstrapErrorKind) return;
    const frame = window.requestAnimationFrame(() => {
      bootstrapErrorTitleRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [bootstrapErrorKind]);

  useEffect(() => {
    if (!invalidPairingEntry || checkingAuth) return;
    const frame = window.requestAnimationFrame(() => {
      invalidPairingTitleRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [checkingAuth, invalidPairingEntry]);

  useEffect(() => {
    if (!pairingLinkError) return;
    const frame = window.requestAnimationFrame(() => {
      pairingLinkErrorTitleRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pairingLinkError]);

  useEffect(() => {
    if (loginState !== "sent") return;
    const frame = window.requestAnimationFrame(() => {
      verificationSentTitleRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loginState]);

  const closeProjectDrawer = useCallback(() => {
    setProjectDrawerOpen(false);
    window.requestAnimationFrame(() => projectDrawerTrigger.current?.focus());
  }, []);

  const openWorkspaceSession = useCallback((sessionId: string) => {
    setActiveSession(sessionId);
    storeActiveSessionSelection(relayDeviceId.current ?? "", sessionId);
    setProjectDrawerOpen(false);
    setMobilePanel("workspace");
    window.requestAnimationFrame(() => workspaceTitleRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!pairingId) return;
    let cancelled = false;
    const invalidatePairing = (errorKey: AuthCopyKey) => {
      if (urlPairingId) {
        setPairingLinkError(errorKey);
        return;
      }
      setPendingBrowserPairingId(null);
      setPairingFormError("pendingPairingExpired");
    };
    void api<PairingPublicState>(
      `/api/pairings/${encodeURIComponent(pairingId)}`,
    )
      .then((state) => {
        if (cancelled) return;
        if (state.protocol !== PAIRING_PROTOCOL || state.status !== "waiting") {
          invalidatePairing(
            state.status === "paired" ? "pairingUsed" : "pairingExpired",
          );
        }
      })
      .catch((error) => {
        if (cancelled || !(error instanceof RelayApiError)) return;
        const errorKey = pairingLinkErrorKey(error.status, error.code);
        if (errorKey) invalidatePairing(errorKey);
      });
    return () => {
      cancelled = true;
    };
  }, [pairingId, urlPairingId]);

  useEffect(() => {
    if (!projectDrawerOpen) return;
    projectDrawerClose.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (accountMenuOpen) return;
        closeProjectDrawer();
        return;
      }
      if (event.key !== "Tab") return;
      const drawer = document.querySelector<HTMLElement>("#project-drawer");
      if (!drawer) return;
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [accountMenuOpen, closeProjectDrawer, projectDrawerOpen]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const focusFrame = window.requestAnimationFrame(() => {
      accountMenuContainerRef.current
        ?.querySelector<HTMLElement>("button, a[href]")
        ?.focus();
    });
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !accountMenuContainerRef.current?.contains(target)) {
        setAccountMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAccountMenuOpen(false);
      window.requestAnimationFrame(() => accountMenuButtonRef.current?.focus());
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    const handleRevoked = () => {
      relayKey.current = null;
      relayDeviceId.current = null;
      activeBrowserAuthorizationToken = "";
      setSnapshot(null);
      setProjectPages({});
      updateRealtimeDevice(() => INITIAL_REALTIME_DEVICE_STATE);
      setNeedsE2eeKey(true);
      setAuthenticated(true);
      setBootstrapErrorKind(null);
      setAuthToastKey("browserRevoked");
      Object.values(pendingAttachmentMapRef.current)
        .flat()
        .forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
      setPendingAttachmentMap({});
      void clearStoredRelayKey();
    };
    window.addEventListener("relayune-browser-revoked", handleRevoked);
    return () =>
      window.removeEventListener("relayune-browser-revoked", handleRevoked);
  }, [updateRealtimeDevice]);

  const applyEvent = useCallback(
    (record: RelayEvent, eventSnapshot = snapshotRef.current) => {
      if (seenEvents.current.has(record.event_id)) return;
      seenEvents.current.add(record.event_id);
      const event = record.event;
      const turnId = event.turn_id ?? record.event_id;
      const timestamp = formatTime(record.created_at, authLocale);
      const localAgentName = agentNameForProvider(
        providerForSession(eventSnapshot, record.session_id),
      );

      if (
        event.kind === "approval.requested" &&
        event.approval_id &&
        event.action &&
        event.expires_at
      ) {
        const approval: Approval = {
          approval_id: event.approval_id,
          session_id: event.session_id ?? record.session_id,
          root_session_id: event.root_session_id ?? record.session_id,
          action: event.action,
          risk_level: event.risk_level ?? "high",
          state: "pending",
          requested_at: event.requested_at ?? record.created_at,
          expires_at: event.expires_at,
          source_thread_id: event.source_thread_id,
          source_agent_id: event.source_agent_id,
          source_agent_name: event.source_agent_name,
        };
        setSnapshot((previous) =>
          previous
            ? {
                ...previous,
                approvals: [
                  approval,
                  ...previous.approvals.filter(
                    (candidate) =>
                      candidate.approval_id !== approval.approval_id,
                  ),
                ],
              }
            : previous,
        );
        return;
      }
      if (event.kind === "approval.resolved" && event.approval_id) {
        setSnapshot((previous) =>
          previous
            ? {
                ...previous,
                approvals: previous.approvals.map((approval) =>
                  approval.approval_id === event.approval_id
                    ? {
                        ...approval,
                        state:
                          event.decision === "approved"
                            ? "approved"
                            : event.decision === "rejected"
                              ? "rejected"
                              : "expired",
                      }
                    : approval,
                ),
              }
            : previous,
        );
        return;
      }
      if (event.kind === "approval.failed" && event.approval_id) {
        setSnapshot((previous) =>
          previous
            ? {
                ...previous,
                approvals: previous.approvals.map((approval) =>
                  approval.approval_id === event.approval_id
                    ? {
                        ...approval,
                        state:
                          Date.parse(approval.expires_at) > Date.now()
                            ? "pending"
                            : "expired",
                      }
                    : approval,
                ),
              }
            : previous,
        );
        approvalDecisionsInFlight.current.delete(event.approval_id);
        setToast(
          typeof event.error === "string" && event.error
            ? event.error
            : workbenchText(authLocale, "approvalSubmitFailed"),
        );
        return;
      }
      if (event.kind === "session.config_updated" && event.config_options) {
        setSnapshot((previous) =>
          previous
            ? {
                ...previous,
                sessions: previous.sessions.map((session) =>
                  session.id === record.session_id
                    ? {
                        ...session,
                        session_config_options: event.config_options,
                        ...(session.provider === "kimi"
                          ? { kimi_config_options: event.config_options }
                          : {}),
                      }
                    : session,
                ),
              }
            : previous,
        );
        setToast(workbenchText(authLocale, "configSynced"));
        return;
      }
      if (event.kind === "session.config_failed") {
        setToast(event.error ?? workbenchText(authLocale, "configFailed"));
        return;
      }
      if (event.kind.startsWith("agent.") && record.agent_id) {
        const status =
          event.agent_status ??
          (event.kind === "agent.completed"
            ? "completed"
            : event.kind === "agent.failed"
              ? "errored"
              : event.kind === "agent.interrupted"
                ? "interrupted"
                : "running");
        setSnapshot((previous) => {
          if (!previous) return previous;
          const currentAgent = previous.agents.find(
            (agent) => agent.id === record.agent_id,
          );
          const nextAgent: Agent = {
            id: record.agent_id!,
            thread_id:
              event.thread_id ?? currentAgent?.thread_id ?? record.agent_id!,
            parent_session_id:
              event.root_session_id ??
              currentAgent?.parent_session_id ??
              record.session_id,
            parent_thread_id:
              event.parent_thread_id ?? currentAgent?.parent_thread_id ?? null,
            name: event.name ?? currentAgent?.name ?? record.agent_id!,
            role: event.role ?? currentAgent?.role ?? null,
            task:
              event.task ??
              currentAgent?.task ??
              workbenchText(authLocale, "agentFallbackTask", {
                agent: localAgentName,
              }),
            status,
            progress:
              event.progress ??
              (["completed", "errored", "interrupted", "shutdown"].includes(
                status,
              )
                ? 100
                : (currentAgent?.progress ?? 0)),
            summary: event.summary ?? currentAgent?.summary ?? null,
            model: event.model ?? currentAgent?.model ?? null,
            reasoning_effort:
              event.reasoning_effort ?? currentAgent?.reasoning_effort ?? null,
            tool: event.tool ?? currentAgent?.tool ?? null,
            current_activity:
              event.current_activity ?? currentAgent?.current_activity ?? null,
            tool_count: event.tool_count ?? currentAgent?.tool_count ?? null,
            token_count: event.token_count ?? currentAgent?.token_count ?? null,
            context_tokens:
              event.context_tokens ?? currentAgent?.context_tokens ?? null,
            permission_mode:
              event.permission_mode ?? currentAgent?.permission_mode ?? null,
            swarm_mode: event.swarm_mode ?? currentAgent?.swarm_mode ?? null,
            activity_log: event.activity_log ?? currentAgent?.activity_log,
            can_open: event.can_open ?? currentAgent?.can_open,
            started_at:
              event.started_at ?? currentAgent?.started_at ?? record.created_at,
            updated_at: event.updated_at ?? record.created_at,
          };
          return {
            ...previous,
            agents: mergeById(previous.agents, [nextAgent]),
          };
        });
        return;
      }

      if (event.kind === "turn.started") {
        activeTurnIds.current.set(record.session_id, turnId);
        setActiveTurnMap((previous) => ({
          ...previous,
          [record.session_id]: turnId,
        }));
        const pendingMessageId = pendingUserMessages.current.get(
          record.session_id,
        );
        if (pendingMessageId) {
          setMessageMap((previous) => ({
            ...previous,
            [record.session_id]: (previous[record.session_id] ?? []).map(
              (message) =>
                message.id === pendingMessageId
                  ? { ...message, turnId }
                  : message,
            ),
          }));
          pendingUserMessages.current.delete(record.session_id);
        }
        return;
      }
      if (event.kind === "turn.completed" || event.kind === "turn.failed") {
        activeTurnIds.current.delete(record.session_id);
        setActiveTurnMap((previous) => {
          const next = { ...previous };
          delete next[record.session_id];
          return next;
        });
        setMessageMap((previous) => ({
          ...previous,
          [record.session_id]: (previous[record.session_id] ?? []).map(
            (message) =>
              message.turnId === turnId &&
              message.toolActivity?.status === "running"
                ? {
                    ...message,
                    toolActivity: {
                      ...message.toolActivity,
                      status:
                        event.kind === "turn.failed" ? "failed" : "completed",
                    },
                  }
                : message,
          ),
        }));
        if (event.kind === "turn.failed") {
          upsertMessage(setMessageMap, record.session_id, {
            id: record.event_id,
            role: "system",
            content:
              event.error ??
              workbenchText(authLocale, "localTaskFailed", {
                agent: localAgentName,
              }),
            meta: workbenchText(authLocale, "systemMeta", { time: timestamp }),
            createdAt: record.created_at,
            source: "live",
            turnId,
          });
        }
        return;
      }
      if (event.kind === "user.message") {
        const activeTurnId =
          activeTurnIds.current.get(record.session_id) ?? null;
        if (!activeTurnId) {
          pendingUserMessages.current.set(record.session_id, event.item_id ?? record.event_id);
        }
        upsertMessage(setMessageMap, record.session_id, {
          id: event.item_id ?? record.event_id,
          clientMessageId: event.client_message_id,
          role: "user",
          content: event.text ?? "",
          meta: workbenchText(authLocale, "youMeta", {
            time: formatMessageTimestamp(record.created_at, authLocale),
          }),
          createdAt: record.created_at,
          source: "live",
          turnId: event.turn_id ?? activeTurnId,
          attachments: event.attachments ?? [],
        });
        return;
      }
      if (
        event.kind === "message.delta" ||
        event.kind === "message.completed"
      ) {
        upsertMessage(
          setMessageMap,
          record.session_id,
          {
            id: `codex_${turnId}`,
            role: "codex",
            content: event.text ?? "",
            meta: `${localAgentName} · ${timestamp}`,
            createdAt: record.created_at,
            source: "live",
            turnId,
          },
          event.kind === "message.delta",
        );
        return;
      }
      if (isToolActivityEvent(event)) {
        upsertToolActivityMessage(
          setMessageMap,
          record.session_id,
          event,
          turnId,
          record.created_at,
          workbenchText(authLocale, "localOperation"),
          workbenchText(authLocale, "toolActivityMeta", { time: timestamp }),
          authLocale,
        );
        return;
      }
      if (event.kind === "file.changed") {
        const count = event.changes?.length ?? 1;
        upsertMessage(setMessageMap, record.session_id, {
          id: record.event_id,
          role: "system",
          content: workbenchText(authLocale, "fileChanges", {
            agent: localAgentName,
            count,
          }),
          meta: workbenchText(authLocale, "localChangesMeta", {
            time: timestamp,
          }),
          createdAt: record.created_at,
          source: "live",
          turnId,
        });
        return;
      }
      if (event.kind === "plan.updated") {
        const planText = (event.plan ?? [])
          .map((item) => {
            const marker =
              item.status === "completed"
                ? "✓"
                : item.status === "inProgress"
                  ? "→"
                  : "○";
            return `${marker} ${item.step}`;
          })
          .join("\n");
        upsertMessage(setMessageMap, record.session_id, {
          id: event.item_id ?? `plan_${turnId}`,
          role: "system",
          content: [event.explanation, planText].filter(Boolean).join("\n"),
          meta: workbenchText(authLocale, "planMeta", { time: timestamp }),
          createdAt: record.created_at,
          source: "live",
          turnId,
        });
        return;
      }
      if (event.kind === "turn.interrupt_failed") {
        upsertMessage(setMessageMap, record.session_id, {
          id: record.event_id,
          role: "system",
          content:
            event.error ??
            workbenchText(authLocale, "stopFailed", { agent: localAgentName }),
          meta: workbenchText(authLocale, "systemMeta", { time: timestamp }),
          createdAt: record.created_at,
          source: "live",
          turnId,
        });
        return;
      }
      if (event.kind === "codex.queue.updated" ||
          (event.kind === "codex.persisted" && event.mode === "queued")) {
        const clientId = event.client_message_id;
        const key = `${record.session_id}/${clientId ?? "legacy"}`;
        const id = `codex_queue_${clientId ?? "legacy"}`;
        if (event.kind === "codex.persisted" && codexQueueStatuses.current.has(key)) return;
        const status = event.kind === "codex.queue.updated" ? event.status :
          event.persisted === false ? "unconfirmed" : "queued";
        if (event.kind === "codex.queue.updated" && status) {
          codexQueueStatuses.current.set(key, status);
          if (codexQueueStatuses.current.size > 1000) {
            codexQueueStatuses.current.delete(codexQueueStatuses.current.keys().next().value!);
          }
        }
        if (status === "queued" || status === "unconfirmed") {
          upsertMessage(setMessageMap, record.session_id, {
            id, role: "system", content: workbenchText(authLocale, status === "queued" ? "queueAccepted" : "queueUnconfirmed"),
            meta: workbenchText(authLocale, "systemMeta", { time: timestamp }),
            createdAt: record.created_at, source: "live",
          });
        } else {
          setMessageMap(previous => ({ ...previous,
            [record.session_id]: (previous[record.session_id] ?? []).filter(message => message.id !== id),
          }));
        }
        return;
      }
      if (event.kind === "codex.persisted") {
        setToast(
          event.persisted === false
            ? workbenchText(authLocale, "persistedPending", {
                agent: localAgentName,
              })
            : event.operation === "thread"
              ? workbenchText(authLocale, "sessionPersisted", {
                  agent: localAgentName,
                })
              : workbenchText(authLocale, "turnPersisted", {
                  agent: localAgentName,
                }),
        );
      }
    },
    [authLocale],
  );

  const reconcileCatalogRuntime = useCallback((sessions: Session[]) => {
    const activeSessionIds = new Set(
      sessions
        .filter((session) => isSessionStatusRunning(session))
        .map((session) => session.id),
    );
    for (const sessionId of activeTurnIds.current.keys()) {
      if (!activeSessionIds.has(sessionId)) {
        activeTurnIds.current.delete(sessionId);
      }
    }
    setActiveTurnMap((previous) =>
      retainActiveSessionEntries(previous, sessions),
    );
    setMessageMap((previous) =>
      settleInactiveSessionActivities(previous, sessions),
    );
  }, []);

  const sendEncryptedCommand = useCallback(
    async (
      type: string,
      sessionId: string | null,
      payload: Record<string, unknown> = {},
      ttlMs = 5 * 60_000,
      requestId = `req_${crypto.randomUUID()}`,
    ) => {
      const key = relayKey.current;
      const deviceId = snapshot?.device.id;
      if (!key || !deviceId) {
        throw new Error(workbenchText(authLocale, "e2eeKeyLocked"));
      }
      const sealCommand = async (id: string) => {
        const createdAt = new Date().toISOString();
        const expiresAt = new Date(Date.now() + ttlMs).toISOString();
        const aad: RelayAad = {
          direction: "web_to_relay", type, device_id: deviceId,
          session_id: sessionId, request_id: id, event_seq: null,
          created_at: createdAt, expires_at: expiresAt,
        };
        const envelope = await sealJson(key, {
          type, request_id: id, device_id: deviceId, session_id: sessionId,
          payload, issued_at: createdAt, expires_at: expiresAt,
        }, aad);
        return {
          device_id: deviceId, session_id: sessionId, request_id: id,
          command_type: type, created_at: createdAt, expires_at: expiresAt, aad, envelope,
        };
      };
      const sealedFrame = await sealCommand(requestId);
      const sendHttp = (frame = sealedFrame) => api<CommandResult>("/api/commands", {
        method: "POST",
        headers: { "Idempotency-Key": frame.request_id },
        relayTimeoutMs:
          type === "session.submit_message" &&
          Array.isArray(payload.attachments) &&
          payload.attachments.length
            ? 60_000
            : undefined,
        body: JSON.stringify(frame),
      });
      const stream = onlineStream.current;
      if (stream?.available && ONLINE_READ_TYPES.has(type) && onlineResponses.current.size < 8) {
        const responseTypes = type.startsWith("project.") ? ["project.result"] :
          type === "session.read_history" ? ["session.history", "session.history_error"] :
          type === "session.read_attachment" ? ["session.attachment", "session.attachment_error"] : ["session.agents", "session.agents_error"];
        let authorizationError: RelayApiError | undefined;
        const assertReadScope = () => {
          if (authorizationError) throw authorizationError;
          if (relayKey.current !== key || relayDeviceId.current !== deviceId || document.visibilityState === "hidden")
            throw new Error("request_cancelled");
        };
        const authenticateResponse = async (frame: OpaqueFrame) => {
          assertReadScope();
          if (frame.device_id !== deviceId || frame.session_id !== sessionId ||
              frame.request_id !== requestId || frame.aad?.direction !== "relay_to_web" ||
              frame.aad.device_id !== deviceId || frame.aad.session_id !== sessionId ||
              frame.aad.request_id !== requestId || frame.aad.event_seq !== null ||
              !responseTypes.includes(frame.aad.type)) throw new Error("online_response_route");
          const value = await openJson<Record<string, unknown>>(key, frame.envelope, frame.aad);
          assertReadScope();
          if (value.type !== frame.aad.type || value.request_id !== requestId || value.session_id !== sessionId) throw new Error("online_response_invalid");
          return value;
        };
        const pending = readOnlineOrHttp({
          assertActive: assertReadScope,
          isPending: error => error instanceof Error && isPendingRelayResponse(error),
          isFatal: error => {
            if (error instanceof RelayApiError && (error.status === 401 || error.status === 403)) {
              authorizationError = error;
              return true;
            }
            return false;
          },
          online: async signal => {
            const raw = await stream.request(sealedFrame, 8_000, signal);
            if (onlineStream.current !== stream) throw new Error("online_response_route");
            return authenticateResponse(raw as unknown as OpaqueFrame);
          },
          http: async (signal, remainingMs) => {
            // Relay may have uploaded this result after stream backpressure.
            // Fetch the original result; this GET never submits another command.
            const frame = await api<OpaqueFrame | { pending: true; request_id: string }>(
              `/api/responses/${encodeURIComponent(requestId)}?device_id=${encodeURIComponent(deviceId)}&wait_ms=${remainingMs}&pending_status=202`,
              { signal, relayTimeoutMs: remainingMs },
            );
            if (signal.aborted) throw new Error("request_cancelled");
            if (!("envelope" in frame)) {
              if (frame.pending !== true || frame.request_id !== requestId) throw new Error("online_response_route");
              throw new Error("response_pending");
            }
            return authenticateResponse(frame);
          },
        }).then(value => ({ value }), async () => {
          try {
            assertReadScope();
            // A late stream response belongs to that stream's original ID.
            // Only reads may retry with a fresh ID so HTTP receives its own result.
            const fallbackFrame = await sealCommand(`req_${crypto.randomUUID()}`);
            assertReadScope();
            await sendHttp(fallbackFrame);
            assertReadScope();
            return { fallback: { requestId: fallbackFrame.request_id, key, deviceId, sessionId, responseTypes } };
          } catch (error) { return { error }; }
        });
        onlineResponses.current.set(requestId, pending);
        // Callers consume once; abandoned requests must not retain responses indefinitely.
        window.setTimeout(() => { if (onlineResponses.current.get(requestId) === pending) onlineResponses.current.delete(requestId); }, 60_000);
        return { request_id: requestId, delivery: "delivered" } as CommandResult;
      }
      return sendHttp();
    },
    [authLocale, snapshot?.device.id],
  );

  const waitForEncryptedResponse = useCallback(
    async <T,>(requestId: string, timeoutMs = 20_000): Promise<T> => {
      const started = Date.now();
      const logicalRequestId = requestId;
      let fallback: OnlineReadFallback | undefined;
      const online = onlineResponses.current.get(requestId);
      onlineResponses.current.delete(requestId);
      if (online) {
        const result = await online;
        if (result.error) throw result.error;
        if (result.value) return result.value as T;
        fallback = result.fallback;
        if (fallback) requestId = fallback.requestId;
      }
      const assertReadScope = () => {
        if (fallback && (relayKey.current !== fallback.key || relayDeviceId.current !== fallback.deviceId || document.visibilityState === "hidden"))
          throw new Error("request_cancelled");
      };
      while (Date.now() - started < timeoutMs) {
        try {
          assertReadScope();
          const frame = await api<
            OpaqueFrame | { pending: true; request_id: string }
          >(
            `/api/responses/${encodeURIComponent(requestId)}?pending_status=202`,
          );
          assertReadScope();
          if (!("envelope" in frame)) {
            // Realtime invalidation wakes this waiter immediately. The timeout
            // is only a fallback for disconnected or older realtime clients.
          } else {
            const key = fallback?.key ?? relayKey.current;
            if (!key)
              throw new Error(
                workbenchText(authLocale, "e2eeKeyLocked"),
              );
            if (fallback && (frame.device_id !== fallback.deviceId || frame.session_id !== fallback.sessionId ||
                frame.request_id !== requestId || frame.aad.direction !== "relay_to_web" ||
                frame.aad.device_id !== fallback.deviceId || frame.aad.session_id !== fallback.sessionId ||
                frame.aad.request_id !== requestId || frame.aad.event_seq !== null || !fallback.responseTypes.includes(frame.aad.type)))
              throw new Error("online_response_route");
            const value = await openJson<T>(key, frame.envelope, frame.aad);
            assertReadScope();
            if (fallback) {
              const response = value as Record<string, unknown>;
              if (response.type !== frame.aad.type || response.request_id !== requestId || response.session_id !== fallback.sessionId)
                throw new Error("online_response_invalid");
              // Preserve the caller's logical identity after authenticating the retry.
              return { ...response, request_id: logicalRequestId } as T;
            }
            return value;
          }
        } catch (error) {
          if (error instanceof Error && !isPendingRelayResponse(error)) {
            throw error;
          }
        }
        await new Promise<void>((resolve) => {
          let timeoutId: number | null = null;
          const wake = () => {
            responseWaiters.current.delete(wake);
            if (timeoutId !== null) window.clearTimeout(timeoutId);
            resolve();
          };
          timeoutId = window.setTimeout(wake, 1_000);
          responseWaiters.current.add(wake);
        });
      }
      throw new Error(workbenchText(authLocale, "encryptedResponseTimeout"));
    },
    [authLocale],
  );

  const loadEncryptedAttachment = useCallback<AttachmentLoader>(
    async (attachment) => {
      if (!attachment.url)
        throw new Error(workbenchText(authLocale, "invalidEncryptedImage"));
      const match = attachment.url.match(
        /^\/api\/sessions\/([^/]+)\/attachments\/([^/]+)$/,
      );
      if (!match)
        throw new Error(workbenchText(authLocale, "invalidEncryptedImage"));
      const sessionId = decodeURIComponent(match[1]);
      const attachmentId = decodeURIComponent(match[2]);
      const key = relayKey.current;
      const deviceId = relayDeviceId.current;
      const assertScope = () => {
        if (!key || relayKey.current !== key || relayDeviceId.current !== deviceId)
          throw new Error("attachment_scope_changed");
      };
      const { readAttachmentRanges } = await import("./attachment-ranges.mjs");
      const { bytes, mimeType } = await readAttachmentRanges(async (offset, maxBytes) => {
        assertScope();
        const requestId = `attachment_${crypto.randomUUID()}`;
        await sendEncryptedCommand(
          "session.read_attachment",
          sessionId,
          { attachment_id: attachmentId, offset, max_bytes: maxBytes },
          30_000,
          requestId,
        );
        const result = await waitForEncryptedResponse<
          | (AttachmentPart & {
              type: "session.attachment";
              attachment_id?: string;
              session_id?: string;
            })
          | {
              type: "session.attachment_error";
              error_code?: string | null;
              error: string;
            }
        >(requestId, 30_000);
        assertScope();
        if (result.type === "session.attachment_error")
          throw new AttachmentPreviewError(result.error_code ?? null);
        if ((result.attachment_id && result.attachment_id !== attachmentId) ||
            (result.session_id && result.session_id !== sessionId))
          throw new Error("attachment_scope_changed");
        return result;
      });
      return new Blob([bytes], { type: mimeType });
    },
    [authLocale, sendEncryptedCommand, waitForEncryptedResponse],
  );

  const loadHistory = useCallback(
    async (
      sessionId: string,
      before: string | null = null,
      force = false,
      silent = false,
    ) => {
      const inFlightKey = `${sessionId}:${before ?? "latest"}`;
      if (historyInFlight.current.has(inFlightKey)) return;
      if (!before && !force && historyLoaded.current.has(sessionId)) return;
      historyInFlight.current.add(inFlightKey);
      if (!silent) {
        setHistoryPageMap((previous) => ({
          ...previous,
          [sessionId]: {
            loading: true,
            loaded: previous[sessionId]?.loaded ?? false,
            nextCursor: previous[sessionId]?.nextCursor ?? null,
            hasMore: previous[sessionId]?.hasMore ?? false,
          },
        }));
      }
      try {
        const requestId = `history_${crypto.randomUUID()}`;
        await sendEncryptedCommand(
          "session.read_history",
          sessionId,
          { limit: 100, before, max_bytes: 256 * 1024 },
          HISTORY_REQUEST_TIMEOUT_MS,
          requestId,
        );
        const response = await waitForEncryptedResponse<
          | ({ type: "session.history" } & HistoryPage)
          | {
              type: "session.history_error";
              error: string;
            }
        >(requestId, HISTORY_REQUEST_TIMEOUT_MS);
        if (response.type === "session.history_error") {
          throw new Error(response.error);
        }
        const page: HistoryPage = response;
        if (page.agents?.length || page.sessions?.length) {
          setSnapshot((previous) => {
            if (!previous) return previous;
            return {
              ...previous,
              agents: mergeById(previous.agents, page.agents ?? []),
              sessions: mergeCatalogSessionsWithDetails(
                previous.sessions,
                page.sessions ?? [],
              ),
            };
          });
        }
        const historyAgentName = agentNameForProvider(
          providerForSession(snapshotRef.current, sessionId),
        );
        const historicalMessages = page.messages.map((message) =>
          toHistoryMessage(message, historyAgentName, authLocale),
        );
        if (!historicalMessages.length && page.metadata_attachment) {
          historicalMessages.push({
            id: `metadata:${page.metadata_attachment.id}`,
            role: "system",
            kind: "session_metadata",
            content: "",
            meta: "",
            createdAt: "",
            source: "history",
            attachments: [page.metadata_attachment],
          });
        }
        setMessageMap((previous) => ({
          ...previous,
          [sessionId]: before
            ? prependHistory(historicalMessages, previous[sessionId] ?? [])
            : mergeLatestHistory(historicalMessages, previous[sessionId] ?? []),
        }));
        historyLoaded.current.add(sessionId);
        if (!silent) {
          setHistoryPageMap((previous) => ({
            ...previous,
            [sessionId]: {
              loading: false,
              loaded: true,
              nextCursor: page.next_cursor,
              hasMore: page.has_more,
            },
          }));
        }
      } catch {
        if (!silent) {
          setHistoryPageMap((previous) => ({
            ...previous,
            [sessionId]: {
              loading: false,
              loaded: previous[sessionId]?.loaded ?? false,
              nextCursor: previous[sessionId]?.nextCursor ?? null,
              hasMore: previous[sessionId]?.hasMore ?? false,
              error: true,
            },
          }));
          setToast({ key: "historyReadFailed" });
        }
      } finally {
        historyInFlight.current.delete(inFlightKey);
      }
    },
    [authLocale, sendEncryptedCommand, waitForEncryptedResponse],
  );

  const loadAgentActivity = useCallback(
    async (sessionId: string) => {
      if (agentActivityInFlight.current.has(sessionId)) return;
      const viewRevision = agentActivityViewRevision.current;
      agentActivityInFlight.current.add(sessionId);
      setAgentActivityLoading(true);
      setAgentActivityError(null);
      try {
        const requestId = `agents_${crypto.randomUUID()}`;
        await sendEncryptedCommand(
          "session.read_agents",
          sessionId,
          {},
          30_000,
          requestId,
        );
        const response = await waitForEncryptedResponse<
          | { type: "session.agents"; agents: Agent[] }
          | { type: "session.agents_error"; error: string }
        >(requestId, 30_000);
        if (response.type === "session.agents_error") {
          throw new Error(response.error);
        }
        setSnapshot((previous) =>
          previous
            ? {
                ...previous,
                agents: mergeById(previous.agents, response.agents ?? []),
              }
            : previous,
        );
      } catch {
        if (agentActivityViewRevision.current === viewRevision) {
          setAgentActivityError(
            workbenchText(authLocale, "agentActivityReadFailed"),
          );
        }
      } finally {
        agentActivityInFlight.current.delete(sessionId);
        if (agentActivityViewRevision.current === viewRevision) {
          setAgentActivityLoading(false);
        }
      }
    },
    [authLocale, sendEncryptedCommand, waitForEncryptedResponse],
  );

  const refresh = useCallback(async (mode: "full" | "catalog" = "full") => {
    const deviceId = relayDeviceId.current;
    const catalogOnly = mode === "catalog" && snapshotRef.current?.device.id === deviceId && Boolean(relayKey.current);
    const raw = await api<ServerBootstrap>(
        deviceId
          ? `/api/bootstrap?device_id=${encodeURIComponent(deviceId)}${catalogOnly ? "&include_events=0" : ""}`
          : "/api/bootstrap",
      );
    let next: Bootstrap;

    setAuthenticated(true);
    setEmail(instanceUserLabel(raw.user));
    updateRealtimeDevice((current) =>
      projectBootstrapPresence(current, {
        online: raw.device.online,
        lastSeenAt: raw.device.last_seen_at,
      }),
    );
    const key = relayKey.current;
    if (!key || !deviceId) {
      setNeedsE2eeKey(true);
      next = {
        user: raw.user,
        device: raw.device,
        sessions: [],
        projects: [],
        approvals: [],
        agents: [],
        events: [],
        cursor: raw.cursor,
        ack_seq: raw.ack_seq,
        queued_commands: raw.queued_commands,
      };
      setSnapshot(next);
      reconcileCatalogRuntime([]);
      return next;
    }
    if (raw.device.id !== deviceId) {
      throw new Error(workbenchText(authLocale, "wrongDevice"));
    }
    const [catalog, events] = await Promise.all([
      decryptCatalog(raw.catalog, key),
      Promise.all(raw.events.map((frame) => decryptEventFrame(frame, key))),
    ]);
    const { sessions, projects } = catalog;
    setOnlineStreamSupported(raw.online_transport_version === 1 && catalog.supportsOnlineStream);
    const previous = snapshotRef.current;
    next = {
      user: raw.user,
      device: raw.device,
      sessions,
      projects,
      approvals: previous?.approvals ?? [],
      agents: previous?.agents ?? [],
      events: catalogOnly ? previous?.events ?? [] : events,
      cursor: catalogOnly ? previous?.cursor ?? 0 : raw.cursor,
      ack_seq: raw.ack_seq,
      queued_commands: raw.queued_commands,
    };
    setNeedsE2eeKey(false);
    setSnapshot(next);
    setAuthenticated(true);
    setEmail(instanceUserLabel(next.user));
    for (const event of events) {
      // React has not committed setSnapshot yet; use this decrypted catalog
      // when attributing replayed messages to their actual provider.
      applyEvent(event, next);
    }
    // Catalog status is authoritative. Applying the event backlog first keeps
    // message history complete; reconciling last prevents an old turn.started
    // event from reviving a session that the same catalog declares idle.
    reconcileCatalogRuntime(sessions);
    opaqueCursor.current = Math.max(
      opaqueCursor.current,
      ...raw.events.map((frame) => frame.cursor ?? 0),
    );
    const rootSessions = rootSessionsForProvider(
      next.sessions,
      selectedProviderRef.current,
      CONFIGURED_PROVIDER,
    );
    const persistedSessionId = deviceId
      ? readActiveSessionSelection(deviceId)
      : "";
    setActiveSession((current) =>
      resolveActiveSessionSelection(
        next.sessions,
        rootSessions,
        current,
        persistedSessionId,
        selectedProviderRef.current,
        CONFIGURED_PROVIDER,
      ),
    );
    setExpandedProjects((previous) => {
      if (previous.size || !rootSessions[0]?.cwd) return previous;
      return new Set([
        projectGroupKey(rootSessions[0].cwd, rootSessions[0].project),
      ]);
    });
    return next;
  }, [
    applyEvent,
    authLocale,
    reconcileCatalogRuntime,
    updateRealtimeDevice,
  ]);

  const refreshWithStatus = useCallback(async (mode: "full" | "catalog" = "full") => {
    try {
      const next = await refresh(mode);
      setSyncInterrupted(false);
      return next;
    } catch (error) {
      setSyncInterrupted(true);
      throw error;
    }
  }, [refresh]);

  const retryInterruptedSync = useCallback(async () => {
    if (syncRetryInFlight.current) return;
    syncRetryInFlight.current = true;
    setRetryingSync(true);
    try {
      await refreshWithStatus();
      window.requestAnimationFrame(() => {
        workspaceTitleRef.current?.focus();
      });
    } catch {
      // The alert and its focused retry action remain mounted on failure.
    } finally {
      syncRetryInFlight.current = false;
      setRetryingSync(false);
    }
  }, [refreshWithStatus]);

  const bootstrapRefreshRef = useRef(refresh);
  useEffect(() => {
    bootstrapRefreshRef.current = refresh;
  }, [refresh]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (desktopLoginParameter !== null) {
        if (!desktopLoginId) {
          setCheckingAuth(false);
          return;
        }
        void api<DesktopLoginApproval>(
          `/api/desktop-login/${encodeURIComponent(desktopLoginId)}/approval`,
        )
          .then((approval) => {
            setDesktopLoginApproval(approval);
            setDesktopLoginError(null);
            setAuthenticated(true);
            setEmail(approval.account_email);
            setBootstrapErrorKind(null);
          })
          .catch((error) => {
            if (error instanceof RelayApiError && error.status === 401) {
              setAuthenticated(false);
              setDesktopLoginError(null);
              return;
            }
            setAuthenticated(true);
            setDesktopLoginError(
              error instanceof RelayApiError &&
                error.code === "desktop_login_expired"
                ? "desktopLoginExpired"
                : "desktopLoginFailed",
            );
          })
          .finally(() => setCheckingAuth(false));
        return;
      }
      void loadStoredRelayKey()
        .then(async (stored) => {
          if (stored && (!stored.browserToken || !stored.browserId)) {
            relayKey.current = null;
            relayDeviceId.current = null;
            activeBrowserAuthorizationToken = "";
            updateRealtimeDevice(() => INITIAL_REALTIME_DEVICE_STATE);
            await clearStoredRelayKey();
            setNeedsE2eeKey(true);
            setAuthenticated(true);
            setAuthToastKey("legacyCredentials");
            return;
          }
          relayKey.current = stored;
          relayDeviceId.current = stored?.deviceId ?? null;
          activeBrowserAuthorizationToken = stored?.browserToken ?? "";
          if (stored?.browserToken) {
            await api('/api/browser/pairings/activate', { method: 'POST', body: '{}' }).catch(() => {});
          }
          return bootstrapRefreshRef.current().then((value) => {
            setBootstrapErrorKind(null);
            return value;
          });
        })
        .catch((error) => {
          if (
            error instanceof RelayApiError &&
            isBrowserAuthorizationLost(error.status, error.code)
          ) {
            return;
          }
          if (error instanceof RelayApiError && error.status === 401) {
            setAuthenticated(false);
            setBootstrapErrorKind(null);
            return;
          }
          if (error instanceof RelayApiError && isReviewAccountIsolated(error.status, error.code)) {
            setAuthenticated(true);
            setBootstrapErrorKind("review-isolated");
            return;
          }
          if (error instanceof RelayApiError || error instanceof TypeError) {
            setBootstrapErrorKind("service-unavailable");
            return;
          }
          if (relayKey.current) {
            relayKey.current = null;
            relayDeviceId.current = null;
            updateRealtimeDevice(() => INITIAL_REALTIME_DEVICE_STATE);
            setNeedsE2eeKey(true);
            setAuthenticated(true);
            setAuthToastKey("savedKeyInvalid");
          } else {
            setBootstrapErrorKind("restore-failed");
          }
        })
        .finally(() => setCheckingAuth(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [desktopLoginId, desktopLoginParameter, updateRealtimeDevice]);

  useEffect(() => {
    if (!toast && !authToastKey) return;
    const timer = window.setTimeout(() => {
      setToast("");
      setAuthToastKey(null);
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [authToastKey, toast]);

  const catchUpEncryptedEvents = useCallback(async () => {
    const active = eventCatchUpInFlight.current;
    if (active) return active;
    const operation = (async () => {
      const deviceId = relayDeviceId.current;
      const key = relayKey.current;
      if (!deviceId || !key) return;
      while (true) {
        const startingCursor = opaqueCursor.current;
        const result = await api<{
          events: OpaqueFrame[];
          next_cursor: number;
          has_more: boolean;
          resync_required?: boolean;
        }>(
          `/api/events?device_id=${encodeURIComponent(
            deviceId,
          )}&cursor=${startingCursor}`,
        );
        if (relayDeviceId.current !== deviceId || relayKey.current !== key) return;
        if (result.resync_required) {
          if (!Number.isSafeInteger(result.next_cursor) || result.next_cursor < 0) throw new Error("invalid_event_cursor");
          historyLoaded.current.clear();
          const sessionId = activeSessionRef.current;
          if (sessionId) {
            await loadHistory(sessionId, null, true, true);
            if (relayDeviceId.current !== deviceId || relayKey.current !== key) return;
            if (!historyLoaded.current.has(sessionId)) throw new Error("history_resync_pending");
          }
          opaqueCursor.current = result.next_cursor;
          return;
        }
        const nextCursor = await consumeVerifiedFrames({
          frames: result.events ?? [],
          cursor: startingCursor,
          cursorFor: (frame) => frame.cursor ?? 0,
          verify: (frame) => decryptEventFrame(frame, key),
          apply: applyEvent,
        });
        opaqueCursor.current = Math.max(opaqueCursor.current, nextCursor);
        if (!result.has_more || nextCursor <= startingCursor) return;
      }
    })();
    eventCatchUpInFlight.current = operation;
    try {
      await operation;
    } finally {
      if (eventCatchUpInFlight.current === operation) {
        eventCatchUpInFlight.current = null;
      }
    }
  }, [applyEvent, loadHistory]);

  useEffect(() => {
    const key = relayKey.current;
    const deviceId = snapshot?.device.id;
    if (!onlineStreamSupported || !authenticated || needsE2eeKey || !key || !deviceId) return;
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let recovery: Promise<void> | null = null;
    let catalogReceived = false;
    let recoveryPending = true;
    let replaced = false;
    let retries = 0;
    const pendingResponses = onlineResponses.current;
    const control = async (stream: OnlineStream, type: string, payload: Record<string, unknown>, reply = true) => {
      const requestId = `req_${crypto.randomUUID()}`;
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 30_000).toISOString();
      const aad: RelayAad = { direction: "web_to_relay", type, device_id: deviceId, session_id: null, request_id: requestId, event_seq: null, created_at: createdAt, expires_at: expiresAt };
      const envelope = await sealJson(key, { type, device_id: deviceId, session_id: null, request_id: requestId, payload: { ...payload, connection_id: stream.connectionId }, issued_at: createdAt, expires_at: expiresAt }, aad);
      if (disposed || onlineStream.current !== stream) throw new Error("stream_cancelled");
      const frame = { device_id: deviceId, session_id: null, request_id: requestId, command_type: type, aad, envelope };
      if (!reply) { stream.send(frame); return; }
      const raw = await stream.request(frame);
      const response = raw as unknown as OpaqueFrame;
      if (response.device_id !== deviceId || response.request_id !== requestId || response.aad.direction !== "relay_to_web" || response.aad.device_id !== deviceId || response.aad.request_id !== requestId || response.aad.session_id !== null || response.aad.type !== "transport.ready") throw new Error("stream_resume_route");
      const value = await openJson<Record<string, unknown>>(key, response.envelope, response.aad);
      if (value.type !== "transport.ready" || value.request_id !== requestId || value.connection_id !== stream.connectionId) throw new Error("stream_resume_invalid");
    };
    const recover = (stream: OnlineStream) => {
      if (recovery || !recoveryPending || !catalogReceived || !stream.available || disposed || onlineStream.current !== stream) return;
      // Consume at entry. A pause arriving during recovery remains pending.
      recoveryPending = false;
      if (retry) clearTimeout(retry);
      retry = null;
      let failed = false;
      recovery = (async () => {
        const sessionId = activeSessionRef.current;
        historyLoaded.current.clear();
        if (sessionId) {
          await loadHistory(sessionId, null, true, true);
          if (!historyLoaded.current.has(sessionId)) throw new Error("history_resync_pending");
        }
        if (disposed || onlineStream.current !== stream) return;
        await control(stream, "transport.resume", {});
        const visibleSessionId = activeSessionRef.current;
        if (visibleSessionId) {
          historyLoaded.current.delete(visibleSessionId);
          await loadHistory(visibleSessionId, null, true, true);
          if (!historyLoaded.current.has(visibleSessionId)) throw new Error("history_resync_pending");
        }
        if (disposed || onlineStream.current !== stream) return;
        retries = 0;
      })().catch(() => {
        failed = true;
        recoveryPending = true;
        if (!disposed && onlineStream.current === stream) retry = setTimeout(() => recover(stream), Math.min(30_000, 1000 * 2 ** Math.min(retries++, 5) * (0.75 + Math.random() * 0.5)));
      }).finally(() => {
        recovery = null;
        const current = onlineStream.current;
        if (current && (current !== stream || (recoveryPending && !failed))) recover(current);
      });
    };
    const connect = () => {
      if (disposed || replaced || document.visibilityState === "hidden" || onlineStream.current) return;
      catalogReceived = false; recoveryPending = true;
      const stream = new OnlineStream({
        origin: window.location.origin, deviceId, browserToken: activeBrowserAuthorizationToken,
        onOnline: () => recover(stream),
        onPresence: (online) => {
          if (!online) { recoveryPending = true; catalogReceived = false; }
          updateRealtimeDevice(current => ({ ...current, online, realtimeConfirmed: true, transport: "connected" }));
        },
        onClosed: () => {
          if (onlineStream.current !== stream) return;
          onlineStream.current = null;
          if (!disposed) updateRealtimeDevice(current => ({ ...current, online: false, realtimeConfirmed: true, transport: "reconnecting" }));
          replaced = stream.closeCode === 4001;
          if (!disposed && !replaced && document.visibilityState !== "hidden") retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(retries++, 5) * (0.75 + Math.random() * 0.5)));
        },
        onFrame: async (raw: StreamFrame) => {
          if (disposed || onlineStream.current !== stream || relayKey.current !== key) return;
          const frame = raw as unknown as OpaqueFrame;
          if (frame.device_id !== deviceId || frame.aad.device_id !== deviceId || frame.aad.direction !== "relay_to_web" || (frame.session_id ?? null) !== frame.aad.session_id || (frame.request_id ?? null) !== frame.aad.request_id) throw new Error("stream_frame_route");
          if (raw.kind === "catalog" && frame.aad.type === "relay.sync_sessions") {
            const catalog = await decryptCatalog(frame, key);
            if (onlineStream.current !== stream) return;
            setSnapshot(previous => previous?.device.id === deviceId ? { ...previous, ...catalog } : previous);
            reconcileCatalogRuntime(catalog.sessions);
            catalogReceived = true;
            recover(stream);
          } else if (raw.kind === "event" && frame.aad.type === "session.event") {
            const createdAt = Date.parse(frame.aad.created_at);
            if (!frame.event_id || !Number.isSafeInteger(frame.event_seq) || frame.event_seq !== frame.aad.event_seq || !Number.isFinite(createdAt) || createdAt > Date.now() + 120_000 || Date.now() - createdAt >= 600_000) throw new Error("stream_event_route");
            const event = await decryptEventFrame(frame, key);
            if (onlineStream.current !== stream) return;
            applyEvent(event);
            await control(stream, "transport.event_ack", { event_id: frame.event_id, event_seq: frame.event_seq }, false);
          } else if (raw.kind === "response" && frame.aad.type === "transport.resync_required") {
            const value = await openJson<Record<string, unknown>>(key, frame.envelope, frame.aad);
            if (value.type !== "transport.resync_required" || value.connection_id !== stream.connectionId) throw new Error("stream_resync_invalid");
            recoveryPending = true; recover(stream);
          }
        },
      });
      onlineStream.current = stream; stream.connect();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") { if (retry) clearTimeout(retry); onlineStream.current?.close(); }
      else { replaced = false; connect(); }
    };
    const focus = () => { replaced = false; connect(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility); connect();
    return () => { disposed = true; if (retry) clearTimeout(retry); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("focus", focus); onlineStream.current?.close(); onlineStream.current = null; pendingResponses.clear(); };
  }, [onlineStreamSupported, authenticated, needsE2eeKey, snapshot?.device.id, applyEvent, loadHistory, reconcileCatalogRuntime, updateRealtimeDevice]);

  useEffect(() => {
    const deviceId = snapshot?.device.id;
    if (
      onlineStreamSupported ||
      !authenticated ||
      needsE2eeKey ||
      !deviceId ||
      !activeBrowserAuthorizationToken
    ) {
      updateRealtimeDevice((current) => projectTransport(current, "idle"));
      return;
    }
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;

    const updateTransport = (transport: RealtimeDeviceState["transport"]) => {
      updateRealtimeDevice((current) => projectTransport(current, transport));
    };
    const syncInvalidation = async (scopes: string[]) => {
      if (disposed) return;
      const unique = new Set(scopes);
      if (unique.has("responses")) {
        for (const wake of [...responseWaiters.current]) wake();
      }
      if (unique.has("events")) await catchUpEncryptedEvents();
      if (disposed) return;
      if (unique.has("catalog")) {
        await refreshWithStatus("catalog");
      } else if (unique.has("queue")) {
        const status = await api<ServerBootstrap>(
          `/api/bootstrap?device_id=${encodeURIComponent(deviceId)}&summary_only=1`,
        );
        if (disposed || status.device.id !== deviceId) return;
        // Summary cursor is the server head, not proof that any event was consumed.
        setSnapshot((previous) => previous?.device.id === deviceId ? {
          ...previous, ack_seq: status.ack_seq, queued_commands: status.queued_commands,
        } : previous);
      }
      if (!disposed) setSyncInterrupted(false);
    };
    const invalidationQueue = createInvalidationQueue({
      run: syncInvalidation,
      onError: () => { if (!disposed) setSyncInterrupted(true); },
    });
    const scheduleReconnect = () => {
      if (disposed || document.visibilityState === "hidden") return;
      updateTransport("reconnecting");
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      const delay = realtimeReconnectDelay(reconnectAttempt, Math.random());
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    };
    const connect = () => {
      if (
        disposed ||
        document.visibilityState === "hidden" ||
        socket?.readyState === WebSocket.OPEN ||
        socket?.readyState === WebSocket.CONNECTING
      ) {
        return;
      }
      updateTransport(reconnectAttempt ? "reconnecting" : "connecting");
      const nextSocket = new WebSocket(
        realtimeWebSocketUrl(window.location.origin),
      );
      socket = nextSocket;
      nextSocket.addEventListener("open", () => {
        nextSocket.send(
          JSON.stringify({
            type: "subscribe",
            device_id: deviceId,
            browser_token: activeBrowserAuthorizationToken,
          }),
        );
      });
      nextSocket.addEventListener("message", (event) => {
        if (disposed || typeof event.data !== "string") return;
        let signal: Record<string, unknown>;
        try {
          signal = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          nextSocket.close(4400, "invalid realtime signal");
          return;
        }
        if (signal.device_id !== deviceId) return;
        if (signal.type === "ready") {
          reconnectAttempt = 0;
          updateTransport("connected");
          invalidationQueue.enqueue([
            "events",
            "catalog",
            "queue",
            "responses",
          ]);
          return;
        }
        if (
          signal.type === "presence" &&
          typeof signal.online === "boolean" &&
          typeof signal.revision === "number" &&
          Number.isSafeInteger(signal.revision)
        ) {
          updateRealtimeDevice((current) =>
            projectPresenceSignal(current, {
              online: signal.online as boolean,
              lastSeenAt:
                typeof signal.last_seen_at === "string"
                  ? signal.last_seen_at
                  : null,
              revision: signal.revision as number,
            }),
          );
          return;
        }
        if (signal.type === "invalidate" && Array.isArray(signal.scopes)) {
          const scopes = signal.scopes.filter(
            (scope): scope is string => typeof scope === "string",
          );
          invalidationQueue.enqueue(scopes);
        }
      });
      nextSocket.addEventListener("close", (event) => {
        if (socket === nextSocket) socket = null;
        if (disposed) return;
        if (event.code === 4401) {
          window.dispatchEvent(new Event("relayune-browser-revoked"));
          return;
        }
        scheduleReconnect();
      });
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
        socket?.close(1000, "page hidden");
        socket = null;
        updateTransport("idle");
      } else {
        connect();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    connect();
    return () => {
      disposed = true;
      invalidationQueue.dispose();
      document.removeEventListener("visibilitychange", handleVisibility);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close(1000, "view changed");
    };
  }, [
    authenticated,
    onlineStreamSupported,
    catchUpEncryptedEvents,
    
    needsE2eeKey,
    refreshWithStatus,
    snapshot?.device.id,
    updateRealtimeDevice,
  ]);

  const allSessions = useMemo(
    () => {
      const sessions = new Map((snapshot?.sessions ?? []).map(s => [s.id, s]));
      for (const [key, page] of Object.entries(projectPages)) {
        if (!key.startsWith(`${snapshot?.device.id}:`)) continue;
        for (const session of page.sessions) if (!sessions.has(session.id)) sessions.set(session.id, session);
      }
      return [...sessions.values()];
    },
    [snapshot?.sessions, snapshot?.device.id, projectPages],
  );
  const sessions = useMemo(
    () =>
      rootSessionsForProvider(
        allSessions,
        selectedProvider,
        CONFIGURED_PROVIDER,
      ),
    [allSessions, selectedProvider],
  );
  const sessionGroups = useMemo(
    () =>
      projectGroupsForProvider(
        allSessions,
        selectedProvider,
        CONFIGURED_PROVIDER,
        snapshot?.projects ?? [],
      ),
    [allSessions, selectedProvider, snapshot?.projects],
  );
  const allApprovals = useMemo(
    () =>
      [...(snapshot?.approvals ?? [])].sort((left, right) => {
        const leftPending = ["pending", "deciding"].includes(left.state)
          ? 1
          : 0;
        const rightPending = ["pending", "deciding"].includes(right.state)
          ? 1
          : 0;
        if (leftPending !== rightPending) return rightPending - leftPending;
        return Date.parse(right.requested_at) - Date.parse(left.requested_at);
      }),
    [snapshot?.approvals],
  );
  const current = useMemo(
    () =>
      allSessions.find(
        (session) =>
          session.id === activeSession &&
          (session.provider ?? CONFIGURED_PROVIDER) === selectedProvider,
      ) ?? sessions[0],
    [activeSession, allSessions, selectedProvider, sessions],
  );
  const projectSelectedSession = preserveProjectSessionSelection(
    sessions,
    current?.root_session_id ?? current?.id ?? activeSession,
  );
  const provider = current?.provider ?? selectedProvider;
  const agentName = agentNameForProvider(provider);
  const relayName = MULTI_AGENT_ENABLED
    ? "Relayune"
    : provider === "pi"
      ? "Pi Relay"
    : provider === "mcode"
      ? "MiniMax Code Relay"
    : provider === "zcode"
      ? "ZCode Relay"
    : provider === "opencode"
      ? "OpenCode Relay"
    : provider === "kimi"
      ? "Kimi Relay"
      : provider === "claude-cowork"
        ? "Claude Cowork Relay"
      : provider === "claude"
        ? "Claude Relay"
        : "Codex Relay";
  const supportsSteering = current?.supports_steering ?? provider === "codex";
  const canInterrupt = current?.can_interrupt ?? true;
  const sessionConfigOptions =
    current?.session_config_options ?? current?.kimi_config_options ?? [];
  const codexPermissionConfig = sessionConfigOptions.find(option => option.id === "permissions");
  const kimiConfigOptions = provider === "codex"
    ? (codexPermissionConfig ? sessionConfigOptions.filter(option => option.id === "permissions") : [{
        id: "permissions", type: "select" as const, name: workbenchText(authLocale, "permissionsLabel"),
        currentValue: "unknown", options: [],
        description: workbenchText(authLocale, "desktopPermissionsUnconfirmedDetail"),
      }])
    : sessionConfigOptions;
  const kimiModeConfig = sessionConfigOptions.find(
    (option) => option.id === "mode",
  );
  const hasKimiCommands = provider === "kimi";
  const hasSessionSettings =
    hasKimiCommands || provider === "claude-cowork" || (provider === "codex" && !current?.is_subagent) ||
    (provider === "claude" && !current?.is_subagent && sessionConfigOptions.length > 0);
  const commandQuery = draft.startsWith("/")
    ? draft.slice(1).trim().toLowerCase()
    : "";
  const quickCommands = useMemo(() => {
    const builtInCommands = kimiWebCommands(authLocale);
    const builtInNames = new Set(
      builtInCommands.map((command) => command.name),
    );
    const advertised = (current?.kimi_commands ?? [])
      .filter((command) => !builtInNames.has(command.name))
      .map((command) => ({
        name: command.name,
        label: command.description,
        description: command.input_hint
          ? workbenchText(authLocale, "nativeCommandWithInput", {
              input: command.input_hint,
            })
          : workbenchText(authLocale, "nativeCommandDescription"),
        badge: workbenchText(authLocale, "nativeCommandBadge"),
        advertised: true,
        inputHint: command.input_hint,
      }));
    return [...builtInCommands, ...advertised].filter((command) =>
      commandQuery
        ? `${command.name} ${command.label} ${command.description}`
            .toLowerCase()
            .includes(commandQuery)
        : true,
    );
  }, [authLocale, commandQuery, current?.kimi_commands]);
  const activeQuickCommand =
    quickCommands[commandSelection] ?? quickCommands[0] ?? null;
  const rootSessionId = current?.root_session_id ?? current?.id ?? "";
  const approvals = useMemo(
    () =>
      allApprovals.filter((approval) =>
        approvalBelongsToRoot(approval, rootSessionId, allSessions),
      ),
    [allApprovals, allSessions, rootSessionId],
  );
  const agents = (snapshot?.agents ?? []).filter((agent) =>
    current?.is_subagent
      ? agent.parent_thread_id === current.id
      : !rootSessionId || agent.parent_session_id === rootSessionId,
  );
  const messages = useMemo(
    () => (current ? (messageMap[current.id] ?? []) : []),
    [current, messageMap],
  );
  const conversationGroups = useMemo(
    () => groupConversationMessages(messages),
    [messages],
  );
  const historyState = current ? historyPageMap[current.id] : undefined;
  const isRunning = current ? isSessionStatusRunning(current) : false;
  const activeAgents = isRunning
    ? agents.filter((agent) =>
        ["pendingInit", "running"].includes(agent.status),
      )
    : [];
  const freshActiveAgents = activeAgents
    .filter(isFreshActiveAgent)
    .sort(
      (left, right) =>
        (Date.parse(left.started_at ?? "") || 0) -
        (Date.parse(right.started_at ?? "") || 0),
    );
  const inlineAgents = agents.filter((agent) =>
    !["pendingInit", "running"].includes(agent.status) ||
    freshActiveAgents.some((active) => active.id === agent.id),
  );
  const freshActiveAgentSignature = freshActiveAgents
    .map((agent) => agent.id)
    .sort()
    .join(":");
  const inspectedAgent = inspectedAgentId
    ? ((snapshot?.agents ?? []).find(
        (agent) => agent.id === inspectedAgentId,
      ) ?? null)
    : null;
  const inspectedAgentSessionId = inspectedAgent?.parent_session_id ?? "";
  const inspectedAgentVisible = Boolean(
    inspectedAgent &&
    inlineAgents.some((agent) => agent.id === inspectedAgent.id),
  );
  const inspectedAgentActive = Boolean(
    inspectedAgentVisible &&
    inspectedAgent &&
    ["pendingInit", "running"].includes(inspectedAgent.status),
  );
  const openAgentActivity = useCallback((agent: Agent) => {
    setInspectedAgentId(agent.id);
    setAgentActivityError(null);
  }, []);
  const pendingCount = approvals.filter(
    (approval) =>
      approval.state === "pending" &&
      Date.parse(approval.expires_at) > approvalNow,
  ).length;

  function focusConversationApprovals() {
    const approvalSection = approvalSectionRef.current;
    if (!approvalSection) return;
    setMobilePanel("workspace");
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    window.requestAnimationFrame(() => {
      approvalSection.scrollIntoView({
        block: "center",
        behavior: reduceMotion ? "auto" : "smooth",
      });
      window.requestAnimationFrame(() => approvalSection.focus());
    });
  }

  const activeTurnId = current ? activeTurnMap[current.id] : undefined;
  const runningMessages = activeTurnId
    ? messages.filter((message) => message.turnId === activeTurnId)
    : (conversationGroups.at(-1)?.messages ?? []);
  const runningStartedAt = isRunning
    ? (current?.running_started_at ??
      earliestTimestamp([
        ...freshActiveAgents.map((agent) => agent.started_at),
        ...runningMessages.map((message) => message.createdAt),
      ]))
    : null;
  const hasCurrentAssistantActivity = messages.some((message) => {
    if (message.role === "user") return false;
    if (activeTurnId) return message.turnId === activeTurnId;
    if (!runningStartedAt) return false;
    return Date.parse(message.createdAt) >= Date.parse(runningStartedAt);
  });

  useEffect(() => {
    if (!pendingCount) return;
    const timer = window.setInterval(() => setApprovalNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [pendingCount]);

  useEffect(() => {
    if (!workspaceReady || !activeSession) return;
    const scrollElement = messageScroll.current;
    if (!scrollElement) return;

    // ConversationViewport restores each session before this observer starts.
    let scrollFrame: number | null = null;
    const observedChildren = new Set<Element>();
    const scrollToLatest = () => {
      if (!messageScrollFollowsLatest.current || scrollFrame !== null) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = null;
        if (!messageScrollFollowsLatest.current) return;
        scrollElement.scrollTo({
          top: scrollElement.scrollHeight,
          behavior: "auto",
        });
      });
    };
    const resizeObserver = new ResizeObserver(scrollToLatest);
    const observeMessageContent = () => {
      resizeObserver.observe(scrollElement);
      for (const child of scrollElement.children) {
        if (observedChildren.has(child)) continue;
        observedChildren.add(child);
        resizeObserver.observe(child);
      }
    };
    const mutationObserver = new MutationObserver(() => {
      observeMessageContent();
      scrollToLatest();
    });

    observeMessageContent();
    mutationObserver.observe(scrollElement, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    scrollToLatest();

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame);
    };
  }, [activeSession, workspaceReady]);

  useEffect(() => {
    if (!authenticated || !activeSession || !deviceOnline) return;
    const timer = window.setTimeout(() => void loadHistory(activeSession), 0);
    return () => window.clearTimeout(timer);
  }, [activeSession, authenticated, deviceOnline, loadHistory]);

  useEffect(() => {
    if (!freshActiveAgentSignature) return;
    if (!messageScrollFollowsLatest.current) return;
    const scrollElement = messageScroll.current;
    if (!scrollElement) return;
    const distanceFromBottom =
      scrollElement.scrollHeight -
      scrollElement.scrollTop -
      scrollElement.clientHeight;
    if (distanceFromBottom > 240) return;
    const frame = window.requestAnimationFrame(() => {
      if (!messageScrollFollowsLatest.current) return;
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      scrollElement.scrollTo({
        top: scrollElement.scrollHeight,
        behavior: reduceMotion ? "auto" : "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [freshActiveAgentSignature]);

  useEffect(() => {
    agentActivityViewRevision.current += 1;
    const reset = window.setTimeout(() => {
      setInspectedAgentId(null);
      setAgentActivityLoading(false);
      setAgentActivityError(null);
    }, 0);
    return () => window.clearTimeout(reset);
  }, [activeSession]);

  useEffect(() => {
    if (
      !inspectedAgentId ||
      !inspectedAgentVisible ||
      !inspectedAgentSessionId ||
      !deviceOnline
    )
      return;
    const initialRefresh = window.setTimeout(
      () => void loadAgentActivity(inspectedAgentSessionId),
      0,
    );
    const timer = inspectedAgentActive
      ? window.setInterval(
          () => void loadAgentActivity(inspectedAgentSessionId),
          2_500,
        )
      : null;
    return () => {
      window.clearTimeout(initialRefresh);
      if (timer !== null) window.clearInterval(timer);
    };
  }, [
    deviceOnline,
    inspectedAgentActive,
    inspectedAgentId,
    inspectedAgentSessionId,
    inspectedAgentVisible,
    activeSession,
    loadAgentActivity,
  ]);

  function beginAuthenticationRequest() {
    authRequestAbort.current?.abort();
    const controller = new AbortController();
    authRequestAbort.current = controller;
    return controller;
  }

  function finishAuthenticationRequest(controller: AbortController) {
    if (authRequestAbort.current === controller) {
      authRequestAbort.current = null;
    }
  }

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      setEmailFlowError(null);
      setEmailError("invalidEmail");
      emailInputRef.current?.focus();
      return;
    }
    setEmailError(null);
    setEmailFlowError(null);
    const normalizedEmail = email.trim().toLowerCase();
    setEmail(normalizedEmail);
    setLoginState("checking");
    const controller = beginAuthenticationRequest();
    try {
      await api<{
        next_action: "password";
      }>("/api/auth/email-status", {
        method: "POST",
        body: JSON.stringify({ email: normalizedEmail }),
        signal: controller.signal,
      });
      setLoginState("password");
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoginState("idle");
      setEmailFlowError(authenticationErrorFor("emailStatus", error));
      window.requestAnimationFrame(() => emailInputRef.current?.focus());
    } finally {
      finishAuthenticationRequest(controller);
    }
  }

  async function requestEmailVerification(
    nextEmail = email,
    fallbackState: "idle" | "password" = "idle",
  ) {
    const controller = beginAuthenticationRequest();
    setAuthToastKey(null);
    setLoginState(fallbackState === "password" ? "sending-reset" : "sending");
    try {
      await api<{ delivered: true }>("/api/auth/magic-link", {
        method: "POST",
        body: JSON.stringify({
          email: nextEmail.trim().toLowerCase(),
          pairing_id: pairingId ?? undefined,
          desktop_login_id: desktopLoginId ?? undefined,
          locale: authLocale,
        }),
        signal: controller.signal,
      });
      setLoginState("sent");
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoginState(fallbackState);
      const errorKey = authenticationErrorFor("magicLink", error);
      if (fallbackState === "idle") {
        setEmailFlowError(errorKey);
        window.requestAnimationFrame(() => emailInputRef.current?.focus());
      } else {
        setAuthToastKey(errorKey);
        window.requestAnimationFrame(() => {
          passwordResetButtonRef.current?.focus();
        });
      }
    } finally {
      finishAuthenticationRequest(controller);
    }
  }

  async function resendEmailVerification() {
    if (resendingVerification) return;
    setEmailFlowError(null);
    setAuthToastKey(null);
    setResendingVerification(true);
    const controller = beginAuthenticationRequest();
    try {
      await api<{ delivered: true }>("/api/auth/magic-link", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          pairing_id: pairingId ?? undefined,
          desktop_login_id: desktopLoginId ?? undefined,
          locale: authLocale,
        }),
        signal: controller.signal,
      });
      setAuthToastKey("verificationResent");
    } catch (error) {
      if (controller.signal.aborted) return;
      setEmailFlowError(authenticationErrorFor("magicLink", error));
    } finally {
      finishAuthenticationRequest(controller);
      setResendingVerification(false);
    }
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (!password) {
      setPasswordError("enterPassword");
      passwordInputRef.current?.focus();
      return;
    }
    setPasswordError(null);
    setLoginState("authenticating");
    const controller = beginAuthenticationRequest();
    try {
      await api<{ authenticated: true }>("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          pairing_id: pairingId ?? undefined,
          desktop_login_id: desktopLoginId ?? undefined,
        }),
        signal: controller.signal,
      });
      window.location.reload();
    } catch (error) {
      if (controller.signal.aborted) return;
      const invalidCredentials =
        error instanceof RelayApiError && error.code === "invalid_credentials";
      setLoginState("password");
      setPasswordError(authenticationErrorFor("password", error));
      window.requestAnimationFrame(() => {
        passwordInputRef.current?.focus();
        if (invalidCredentials) {
          passwordInputRef.current?.select();
        }
      });
    } finally {
      finishAuthenticationRequest(controller);
    }
  }

  async function submitNewPassword(event: FormEvent) {
    event.preventDefault();
    if (passwordSetupError === "passwordSetupExpired") {
      changeLoginEmail();
      return;
    }
    if (password.length < 8) {
      setNewPasswordError("passwordTooShort");
      setPasswordConfirmationError(null);
      setPasswordSetupError(null);
      passwordInputRef.current?.focus();
      return;
    }
    if (password !== passwordConfirmation) {
      setNewPasswordError(null);
      setPasswordConfirmationError("passwordsMismatch");
      setPasswordSetupError(null);
      passwordConfirmationInputRef.current?.focus();
      return;
    }
    setNewPasswordError(null);
    setPasswordConfirmationError(null);
    setPasswordSetupError(null);
    setLoginState("saving-password");
    const controller = beginAuthenticationRequest();
    try {
      await api<{ authenticated: true }>("/api/auth/set-password", {
        method: "POST",
        body: JSON.stringify({ password }),
        signal: controller.signal,
      });
      const destination = desktopLoginId
        ? `/?desktop_login=${encodeURIComponent(desktopLoginId)}`
        : pairingId
          ? `/?pair=${encodeURIComponent(pairingId)}`
          : "/";
      window.location.replace(destination);
    } catch (error) {
      if (controller.signal.aborted) return;
      const errorKey = authenticationErrorFor("setPassword", error);
      setLoginState("set-password");
      setPasswordSetupError(errorKey);
      window.requestAnimationFrame(() => {
        if (errorKey === "passwordSetupExpired") {
          passwordSetupRecoveryButtonRef.current?.focus();
        } else {
          passwordSetupSubmitButtonRef.current?.focus();
        }
      });
    } finally {
      finishAuthenticationRequest(controller);
    }
  }

  function returnToRelayuneDesktop() {
    if (!desktopLoginId) return;
    window.location.assign(
      `relayune://desktop-login-complete?request=${encodeURIComponent(
        desktopLoginId,
      )}`,
    );
  }

  async function approveDesktopLogin() {
    if (!desktopLoginId || approvingDesktopLogin) return;
    setApprovingDesktopLogin(true);
    setDesktopLoginError(null);
    try {
      const approval = await api<DesktopLoginApproval>(
        `/api/desktop-login/${encodeURIComponent(desktopLoginId)}/approve`,
        { method: "POST" },
      );
      setDesktopLoginApproval(approval);
      window.setTimeout(returnToRelayuneDesktop, 80);
    } catch (error) {
      setDesktopLoginError(
        error instanceof RelayApiError &&
          error.code === "desktop_login_expired"
          ? "desktopLoginExpired"
          : "desktopLoginFailed",
      );
    } finally {
      setApprovingDesktopLogin(false);
    }
  }

  function changeLoginEmail() {
    authRequestAbort.current?.abort();
    authRequestAbort.current = null;
    setPassword("");
    setEmailFlowError(null);
    setResendingVerification(false);
    setPasswordError(null);
    setPasswordConfirmation("");
    setNewPasswordError(null);
    setPasswordConfirmationError(null);
    setPasswordSetupError(null);
    setAuthToastKey(null);
    setLoginState("idle");
    window.requestAnimationFrame(() => emailInputRef.current?.focus());
  }

  async function logout() {
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;
    setLoggingOut(true);
    try {
      setLogoutFailed(false);
      await logoutAfterConfirmation(
        () => api("/api/auth/logout", { method: "POST" }),
        async () => {
          setAccountMenuOpen(false);
          storeActiveSessionSelection(relayDeviceId.current ?? "", "");
          relayKey.current = null;
          relayDeviceId.current = null;
          activeBrowserAuthorizationToken = "";
          await clearStoredRelayKey().catch(() => {});
          setSnapshot(null);
          setProjectPages({});
          updateRealtimeDevice(() => INITIAL_REALTIME_DEVICE_STATE);
          setAuthenticated(false);
          setNeedsE2eeKey(false);
          setPendingBrowserDiscovery(null);
          setPendingBrowserPairingId(null);
          Object.values(pendingAttachmentMapRef.current)
            .flat()
            .forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
          setPendingAttachmentMap({});
          setPassword("");
          setPasswordConfirmation("");
          setLoginState("idle");
          setBootstrapErrorKind(null);
          setEmail("");
        },
      );
    } catch {
      setLogoutFailed(true);
    } finally {
      logoutInFlight.current = false;
      setLoggingOut(false);
    }
  }

  async function retryBootstrap() {
    setCheckingAuth(true);
    setBootstrapErrorKind(null);
    try {
      await refresh();
    } catch (error) {
      if (
        error instanceof RelayApiError &&
        isBrowserAuthorizationLost(error.status, error.code)
      ) {
        return;
      }
      if (error instanceof RelayApiError && error.status === 401) {
        setAuthenticated(false);
        return;
      }
      setBootstrapErrorKind(
        error instanceof RelayApiError && isReviewAccountIsolated(error.status, error.code)
          ? "review-isolated"
          : "retry-service-unavailable",
      );
    } finally {
      setCheckingAuth(false);
    }
  }

  async function addAttachments(files: FileList | null) {
    if (!files?.length || !activeSession || current?.provider === "mcode") return;
    const selected = Array.from(files);
    if (attachmentInput.current) attachmentInput.current.value = "";
    if (pendingAttachments.length + selected.length > MAX_MESSAGE_ATTACHMENTS) {
      setToast(workbenchText(authLocale, "attachmentCountLimit"));
      return;
    }
    if (
      selected.some(
        (file) => !SUPPORTED_MESSAGE_ATTACHMENT_TYPES.has(file.type),
      )
    ) {
      setToast(workbenchText(authLocale, "attachmentTypeUnsupported"));
      return;
    }
    const totalBytes =
      pendingAttachments.reduce((sum, attachment) => sum + attachment.size, 0) +
      selected.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_MESSAGE_ATTACHMENT_BYTES) {
      setToast(workbenchText(authLocale, "attachmentTooLarge"));
      return;
    }
    try {
      const additions = await Promise.all(
        selected.map(async (file): Promise<PendingMessageAttachment> => ({
          id: `upload_${crypto.randomUUID()}`,
          type: "image",
          name: file.name,
          mime_type: file.type,
          detail: "auto",
          base64: await fileToBase64(file),
          size: file.size,
          previewUrl: URL.createObjectURL(file),
        })),
      );
      setPendingAttachmentMap((previous) => ({
        ...previous,
        [activeSession]: [...(previous[activeSession] ?? []), ...additions],
      }));
    } catch {
      setToast(workbenchText(authLocale, "attachmentReadFailed"));
    }
  }

  function removePendingAttachment(id: string) {
    if (!activeSession) return;
    setPendingAttachmentMap((previous) => {
      const current = previous[activeSession] ?? [];
      const removed = current.find((attachment) => attachment.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      const remaining = current.filter((attachment) => attachment.id !== id);
      const next = { ...previous };
      if (remaining.length) next[activeSession] = remaining;
      else delete next[activeSession];
      return next;
    });
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (messageSendInFlight.current) return;
    const submittedDraft = draft;
    const content = submittedDraft.trim();
    if (
      (!content && !pendingAttachments.length) ||
      !current ||
      current.is_subagent
    )
      return;
    if (isRunning && !supportsSteering) {
      setToast(
        canInterrupt
          ? workbenchText(authLocale, "runningStopBeforeSend", {
              agent: agentName,
            })
          : workbenchText(authLocale, "runningStopOnComputer", {
              agent: agentName,
            }),
      );
      return;
    }
    const steering = isRunning;
    messageSendInFlight.current = true;
    setSendingMessage(true);
    setDraft("");
    const outgoingAttachments = pendingAttachments;
    setPendingAttachmentMap((previous) => {
      const next = { ...previous };
      delete next[current.id];
      return next;
    });
    window.requestAnimationFrame(() => {
      composerInput.current?.focus();
    });
    let result: CommandResult;
    try {
      const requestId = `req_${crypto.randomUUID()}`;
      const messagePayload = {
        content,
        client_message_id: `msg_${crypto.randomUUID()}`,
        attachments: outgoingAttachments.map((attachment) => ({
          id: attachment.id,
          type: attachment.type,
          name: attachment.name,
          mime_type: attachment.mime_type,
          detail: attachment.detail ?? "auto",
          base64: attachment.base64,
        })),
      };
      result = await sendEncryptedCommand(
        "session.submit_message",
        current.id,
        messagePayload,
        deviceOnline ? 5 * 60_000 : 24 * 60 * 60_000,
        requestId,
      );
    } catch (error) {
      setDraft((nextDraft) => restoreFailedComposerDraft(submittedDraft, nextDraft));
      setPendingAttachmentMap((previous) => ({
        ...previous,
        [current.id]: [...outgoingAttachments, ...(previous[current.id] ?? [])],
      }));
      setToast(
        error instanceof Error
          ? error.message
          : workbenchText(authLocale, "messageSendFailed"),
      );
      return;
    } finally {
      messageSendInFlight.current = false;
      setSendingMessage(false);
    }
    outgoingAttachments.forEach((attachment) =>
      URL.revokeObjectURL(attachment.previewUrl),
    );
    setToast(
      result.delivery === "queued"
        ? { key: "messageQueued" }
        : steering
          ? { key: "messageSteered", variables: { agent: agentName } }
          : { key: "messageDelivered" },
    );
    try {
      await refreshWithStatus();
    } catch {
      setToast({ key: "messageSyncInterrupted" });
    }
  }

  async function sendKimiNativeCommand(command: KimiQuickCommand) {
    if (
      !current ||
      current.is_subagent ||
      provider !== "kimi" ||
      messageSendInFlight.current
    )
      return;
    if (!deviceOnline) {
      setToast(workbenchText(authLocale, "kimiCommandsNeedOnline"));
      return;
    }
    if (canInterrupt) {
      setToast(workbenchText(authLocale, "kimiTurnRunning"));
      return;
    }
    if (command.inputHint) {
      setDraft(`/${command.name} `);
      setCommandPaletteOpen(false);
      window.requestAnimationFrame(() => composerInput.current?.focus());
      return;
    }
    messageSendInFlight.current = true;
    setSendingMessage(true);
    setExecutingKimiCommand(command.name);
    const submittedDraft = draft;
    setDraft("");
    let delivered = false;
    try {
      await sendEncryptedCommand(
        "session.submit_message",
        current.id,
        {
          content: `/${command.name}`,
          client_message_id: `msg_${crypto.randomUUID()}`,
        },
        5 * 60_000,
      );
      setCommandPaletteOpen(false);
      setToast({
        key: "kimiCommandDelivered",
        variables: { command: isolateTechnicalText(command.name) },
      });
      delivered = true;
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : workbenchText(authLocale, "kimiCommandFailed"),
      );
      setDraft((nextDraft) => restoreFailedComposerDraft(submittedDraft, nextDraft));
    } finally {
      messageSendInFlight.current = false;
      setSendingMessage(false);
      setExecutingKimiCommand("");
      window.requestAnimationFrame(() => {
        const commandButton = document.getElementById(
          kimiCommandOptionId(command.name),
        );
        if (!delivered && commandButton instanceof HTMLButtonElement) {
          commandButton.focus();
        } else {
          composerInput.current?.focus();
        }
      });
    }
  }

  function runKimiQuickCommand(command: KimiQuickCommand) {
    if (command.name === "tasks") {
      setMobilePanel("workspace");
      setAgentWindowOpenRequest((request) => request + 1);
      setCommandPaletteOpen(false);
      setDraft("");
      return;
    }
    if (command.advertised) {
      void sendKimiNativeCommand(command);
      return;
    }
    setCommandPaletteView("settings");
    setCommandPaletteOpen(true);
    setDraft("");
  }

  async function configureKimiSession(configId: string, value: string) {
    if (!current || !deviceOnline || configurationInFlight.current)
      return;
    if (isRunning) {
      setToast(
        workbenchText(
          authLocale,
          provider === "kimi" ? "kimiConfigRunning" : "runtimeSettingsRunning",
        ),
      );
      return;
    }
    const key = `${configId}:${value}`;
    configurationInFlight.current = true;
    setConfiguringKey(key);
    setPendingConfigConfirmation(null);
    try {
      const requestId = `config_${crypto.randomUUID()}`;
      await sendEncryptedCommand(
        "session.configure",
        current.id,
        { config_id: configId, value },
        30_000,
        requestId,
      );
      const response = await waitForEncryptedResponse<
        | {
            type: "session.configure_result";
            request_id: string;
            session_id: string;
            config_id: string;
            config_options: SessionConfigOption[];
          }
        | {
            type: "session.configure_error";
            request_id: string;
            session_id: string;
            config_id: string;
            error: string;
          }
      >(requestId, 30_000);
      if (response.type === "session.configure_error") {
        throw new Error(response.error);
      }
      if (
        response.request_id !== requestId ||
        response.session_id !== current.id ||
        response.config_id !== configId ||
        !Array.isArray(response.config_options)
      ) {
        throw new Error(workbenchText(authLocale, "runtimeConfigFailedToast"));
      }
      setSnapshot((previous) =>
        previous
          ? {
              ...previous,
              sessions: previous.sessions.map((session) =>
                session.id === current.id
                  ? {
                      ...session,
                      session_config_options: response.config_options,
                      ...(session.provider === "kimi"
                        ? { kimi_config_options: response.config_options }
                        : {}),
                    }
                  : session,
              ),
            }
          : previous,
      );
      setToast(workbenchText(authLocale, "configSynced"));
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : workbenchText(
              authLocale,
              provider === "kimi"
                ? "kimiConfigFailedToast"
                : "runtimeConfigFailedToast",
            ),
      );
    } finally {
      configurationInFlight.current = false;
      setConfiguringKey("");
    }
  }

  function requestKimiConfiguration(configId: string, value: string) {
    if (configurationInFlight.current) return;
    if (provider === "codex" && configId === "permissions" && value === "full") {
      setPendingConfigConfirmation({ configId, value });
      return;
    }
    if (provider === "kimi") {
      if (configId === "mode" && ["auto", "yolo"].includes(value)) {
        setPendingConfigConfirmation({ configId, value });
        return;
      }
    }
    if (
      provider === "claude-cowork" &&
      configId === "mode" &&
      ["acceptEdits", "auto", "bypassPermissions", "dontAsk"].includes(value)
    ) {
      setPendingConfigConfirmation({ configId, value });
      return;
    }
    void configureKimiSession(configId, value);
  }

  async function interruptTurn() {
    if (
      !current ||
      current.is_subagent ||
      !isRunning ||
      !canInterrupt ||
      turnInterruptInFlight.current
    )
      return;
    turnInterruptInFlight.current = true;
    setStoppingTurn(true);
    try {
      await sendEncryptedCommand(
        "session.interrupt_turn",
        current.id,
        {},
        30_000,
      );
      setToast({ key: "stopRequested", variables: { agent: agentName } });
      window.requestAnimationFrame(() => composerInput.current?.focus());
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : workbenchText(authLocale, "stopTaskFailed"),
      );
      window.requestAnimationFrame(() => stopTurnButtonRef.current?.focus());
    } finally {
      turnInterruptInFlight.current = false;
      setStoppingTurn(false);
    }
  }

  async function decideApproval(
    approval: Approval,
    decision: "approved" | "rejected",
    optionId?: string,
    answer?: string,
  ) {
    if (approvalDecisionsInFlight.current.has(approval.approval_id)) return;
    if (
      approval.state !== "pending" ||
      !deviceOnline ||
      Date.parse(approval.expires_at) <= Date.now()
    ) {
      setToast(
        !deviceOnline
          ? workbenchText(authLocale, "approvalOffline")
          : workbenchText(authLocale, "approvalExpiredRetry"),
      );
      return;
    }
    approvalDecisionsInFlight.current.add(approval.approval_id);
    setApprovalAlwaysConfirm(null);
    setSnapshot((previous) =>
      previous
        ? {
            ...previous,
            approvals: previous.approvals.map((candidate) =>
              candidate.approval_id === approval.approval_id
                ? { ...candidate, state: "deciding" }
                : candidate,
            ),
          }
        : previous,
    );
    try {
      await sendEncryptedCommand(
        "approval.resolve",
        approval.session_id,
        {
          approval_id: approval.approval_id,
          device_id: snapshot?.device.id,
          session_id: approval.session_id,
          decision,
          command_hash: approval.action.command_hash,
          expires_at: approval.expires_at,
          nonce: crypto.randomUUID().replaceAll("-", ""),
          option_id: optionId ?? null,
          answer: answer ?? null,
        },
        30_000,
      );
    } catch (error) {
      setSnapshot((previous) =>
        previous
          ? {
              ...previous,
              approvals: previous.approvals.map((candidate) =>
                candidate.approval_id === approval.approval_id
                  ? { ...candidate, state: "pending" }
                  : candidate,
              ),
            }
          : previous,
      );
      setToast(
        error instanceof Error
          ? error.message
          : workbenchText(authLocale, "approvalSubmitFailed"),
      );
      approvalDecisionsInFlight.current.delete(approval.approval_id);
      return;
    }
    setToast(
      decision === "approved"
        ? workbenchText(authLocale, "approvalSent")
        : workbenchText(authLocale, "rejectionSent"),
    );
    try {
      await refreshWithStatus();
    } catch {
      setToast(workbenchText(authLocale, "approvalSyncInterrupted"));
    } finally {
      approvalDecisionsInFlight.current.delete(approval.approval_id);
    }
  }

  async function projectRequest(type: string, payload: Record<string, unknown>): Promise<ProjectReply> {
    if (!deviceOnline) throw new Error("offline");
    const deviceId = snapshot?.device.id;
    const requestId = `req_${crypto.randomUUID()}`;
    await sendEncryptedCommand(type, null, payload, 60_000, requestId);
    const reply = await waitForEncryptedResponse<ProjectReply>(requestId, 60_000);
    if (relayDeviceId.current !== deviceId || reply.type !== "project.result" || reply.request_id !== requestId) throw new Error("project_failed");
    return reply;
  }

  async function loadProjectPage(key: string, cwd: string) {
    if (projectPagesInFlight.current.has(key)) return;
    projectPagesInFlight.current.add(key);
    const previous = projectPages[key] ?? { sessions: [], cursor: null, loaded: false, loading: false, failed: false };
    setProjectPages(pages => ({ ...pages, [key]: { ...previous, loading: true, failed: false } }));
    try {
      const reply = await projectRequest("project.sessions", { provider: selectedProvider, cwd, cursor: previous.cursor }) as ProjectReply & { sessions: Session[]; next_cursor: string | null };
      if (reply.error_code || !Array.isArray(reply.sessions) || reply.sessions.some(s => s.provider !== selectedProvider || s.cwd !== cwd)) throw new Error("project_failed");
      const merged = new Map(previous.sessions.map(s => [s.id, s]));
      for (const session of reply.sessions) merged.set(session.id, session);
      setProjectPages(pages => ({ ...pages, [key]: { sessions: [...merged.values()], cursor: reply.next_cursor, loaded: true, loading: false, failed: false } }));
    } catch {
      setProjectPages(pages => ({ ...pages, [key]: { ...previous, loading: false, failed: true } }));
    } finally {
      projectPagesInFlight.current.delete(key);
    }
  }

  function acceptCreatedProject(project: SavedProject) {
    setSnapshot(previous => previous ? { ...previous, projects: [project, ...previous.projects.filter(p => p.id !== project.id)] } : previous);
    setExpandedProjects(previous => new Set(previous).add(projectGroupKey(project.cwd, project.name)));
    void refreshWithStatus().catch(() => {});
  }

  async function startProjectTask(project: SavedProject, content: string) {
    const deviceId = snapshot?.device.id;
    if (!deviceOnline) throw new Error("offline");
    const requestId = `req_${crypto.randomUUID()}`;
    await sendEncryptedCommand("session.create", null, { cwd: project.cwd, name: workbenchText(authLocale, "newRemoteSession"), provider: project.provider }, 60_000, requestId);
    const reply = await waitForEncryptedResponse<{ type: string; request_id: string; session?: Session }>(requestId, 60_000);
    if (relayDeviceId.current !== deviceId || reply.type !== "session.create_result" || reply.request_id !== requestId || !reply.session || reply.session.cwd !== project.cwd || reply.session.provider !== project.provider) throw new Error("taskFailed");
    const created = reply.session;
    setSnapshot(previous => previous ? { ...previous, sessions: [created, ...previous.sessions.filter(s => s.id !== created.id)] } : previous);
    setActiveSession(created.id);
    storeActiveSessionSelection(deviceId ?? "", created.id);
    setProjectDrawerOpen(false); setMobilePanel("workspace");
    await sendEncryptedCommand("session.submit_message", created.id, { content, client_message_id: `msg_${crypto.randomUUID()}`, attachments: [] });
    void refreshWithStatus().catch(() => {});
  }

  async function createSession(projectCwd: string) {
    if (selectedProvider === "claude-cowork") {
      setToast(workbenchText(authLocale, "coworkCreateInDesktop"));
      return;
    }
    if (!deviceOnline || !snapshot) {
      setToast(
        workbenchText(authLocale, "agentOfflineCreate", { agent: agentName }),
      );
      return;
    }
    if (sessionCreateInFlight.current) return;
    sessionCreateInFlight.current = true;
    const existingSessionIds = new Set(
      snapshot.sessions.map((session) => session.id),
    );
    setCreatingProject(projectCwd);
    let accepted = false;
    try {
      const payload = {
        cwd: projectCwd,
        name: workbenchText(authLocale, "newRemoteSession"),
        provider: selectedProvider,
      };
      await sendEncryptedCommand("session.create", null, payload, 60_000);
      accepted = true;
      setExpandedProjects((previous) =>
        new Set(previous).add(projectGroupKey(projectCwd, "")),
      );
      setToast(
        workbenchText(authLocale, "creatingSession", { agent: agentName }),
      );
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        const next = await refreshWithStatus();
        const created = next.sessions.find(
          (session) =>
            session.cwd === projectCwd &&
            (session.provider ?? CONFIGURED_PROVIDER) === selectedProvider &&
            !existingSessionIds.has(session.id),
        );
        if (created) {
          const projectDrawer = document.getElementById("project-drawer");
          const returnFocusToCreatedSession =
            projectDrawer?.getAttribute("role") === "dialog" &&
            projectDrawer.contains(document.activeElement);
          historyLoaded.current.add(created.id);
          setMessageMap((previous) => ({ ...previous, [created.id]: [] }));
          setHistoryPageMap((previous) => ({
            ...previous,
            [created.id]: {
              loading: false,
              loaded: true,
              nextCursor: null,
              hasMore: false,
            },
          }));
          setActiveSession(created.id);
          storeActiveSessionSelection(relayDeviceId.current ?? "", created.id);
          setProjectDrawerOpen(false);
          setMobilePanel("workspace");
          setToast(
            workbenchText(authLocale, "sessionCreated", { agent: agentName }),
          );
          if (returnFocusToCreatedSession) {
            window.requestAnimationFrame(() => {
              workspaceTitleRef.current?.focus();
            });
          }
          return;
        }
      }
      setToast(workbenchText(authLocale, "sessionPreparing"));
    } catch (error) {
      setToast(
        accepted
          ? workbenchText(authLocale, "sessionCreateSyncInterrupted")
          : error instanceof Error
            ? error.message
            : workbenchText(authLocale, "sessionCreateFailed"),
      );
    } finally {
      sessionCreateInFlight.current = false;
      setCreatingProject(null);
    }
  }

  async function connectMac(event: FormEvent) {
    event.preventDefault();
    await connectPair(pairingId, pairingCode);
  }

  function connectScannedPairing(pairing: ScannedPairing) {
    const formattedCode = pairingCodeInput(pairing.code);
    setPendingBrowserPairingId(pairing.pairingId);
    setPairingFormError(null);
    // Pass both scanned values explicitly. React state updates intentionally do
    // not participate in this handshake, so an immediate scan cannot pair with
    // the previous session or an empty code. The scanned code itself is never
    // copied into controlled input state or any other DOM-backed surface.
    void connectPair(pairing.pairingId, formattedCode);
  }

  async function connectPair(
    requestedPairingId: string | null,
    requestedPairingCode: string,
  ) {
    if (pairingAbort.current || pairingPhase !== "idle") return;
    setPairingFormError(null);
    const runId = pairingRunId.current + 1;
    pairingRunId.current = runId;
    const controller = new AbortController();
    pairingAbort.current = controller;
    const ensureActive = () => {
      if (pairingRunId.current !== runId) throw new PairingCancelledError();
    };
    const previousBrowserToken = activeBrowserAuthorizationToken;
    setPairingPhase("deriving");
    try {
      let targetPairingId = requestedPairingId;
      if (!targetPairingId) {
        const discovery = await discoverPendingBrowserPairings(
          controller.signal,
        );
        ensureActive();
        if (!discovery.pairings.length) {
          throw new PairingFlowError("noPendingBrowserPairing");
        }
        const selected = discovery.pairings.find(
          (pairing) => pairing.pairing_id === pendingBrowserPairingId,
        );
        if (!selected && discovery.pairings.length > 1) {
          throw new PairingFlowError("choosePendingComputer");
        }
        targetPairingId =
          selected?.pairing_id ?? discovery.pairings[0].pairing_id;
        setPendingBrowserPairingId(targetPairingId);
      }
      const pending = await api<PairingPublicState>(
        `/api/pairings/${encodeURIComponent(targetPairingId)}`,
        { signal: controller.signal },
      );
      ensureActive();
      if (
        pending.protocol !== PAIRING_PROTOCOL ||
        pending.status !== "waiting"
      ) {
        throw new PairingFlowError("pairingAlreadyUsed");
      }
      const result = await respondToPairing(
        targetPairingId,
        requestedPairingCode,
        pending.initiator_share,
      );
      const browserToken = randomRelayToken();
      const key = await importRelayKey(result.contentKey);
      await api(
        `/api/browser/pairings/${encodeURIComponent(targetPairingId)}/respond`,
        {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            protocol: PAIRING_PROTOCOL,
            responder_share: result.responderShare,
            responder_confirm: result.responderConfirm,
            browser_token_hash: await sha256Hex(browserToken),
            browser_key_id: key.kid,
            browser_name: browserDisplayName(),
            client_identity: await browserClientIdentity(),
          }),
        },
      );
      setPairingPhase("waiting");
      let completed: PairingPublicState | null = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        const current = await api<PairingPublicState>(
          `/api/pairings/${encodeURIComponent(targetPairingId)}`,
          { signal: controller.signal },
        );
        ensureActive();
        if (current.status === "paired") {
          completed = current;
          break;
        }
      }
      if (!completed) {
        throw new PairingFlowError("desktopConfirmationTimeout");
      }
      const completedDeviceId = completed.device_id;
      const completedBrowserId = completed.browser_id;
      if (!completedDeviceId || !completedBrowserId) {
        throw new PairingFlowError("missingPairedDevice");
      }
      verifyDesktopConfirmation(
        result.expectedDesktopConfirm,
        completed.desktop_confirm,
      );
      setPairingPhase("activating");
      activeBrowserAuthorizationToken = browserToken;
      let relayOnline = false;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const activated: ServerBootstrap = await api<ServerBootstrap>(
          `/api/bootstrap?device_id=${encodeURIComponent(completedDeviceId)}`,
          { signal: controller.signal },
        );
        ensureActive();
        if (
          activated.device.id === completedDeviceId &&
          activated.device.online
        ) {
          if (activated.catalog) {
            await decryptCatalog(activated.catalog, key);
            relayOnline = true;
            break;
          }
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      if (!relayOnline) {
        throw new PairingFlowError("desktopActivationFailed");
      }
      relayKey.current = key;
      relayDeviceId.current = completedDeviceId;
      await storeRelayKey(
        key,
        completedDeviceId,
        browserToken,
        completedBrowserId,
      );
      // The durable key is already committed. Retry cleanup on next startup if
      // the network or an older server cannot complete activation now.
      await api('/api/browser/pairings/activate', { method: 'POST', body: '{}' }).catch(() => {});
      setNeedsE2eeKey(false);
      setPairingPhase("complete");
      await waitForPairingCompletionHandoff();
      ensureActive();
      window.location.replace("/");
    } catch (error) {
      if (
        error instanceof PairingCancelledError ||
        pairingRunId.current !== runId ||
        controller.signal.aborted
      ) {
        return;
      }
      activeBrowserAuthorizationToken = previousBrowserToken;
      setPairingPhase("idle");
      const terminalPairingError: AuthCopyKey | null =
        error instanceof PairingFlowError
          ? error.key
          : error instanceof RelayApiError
            ? pairingLinkErrorKey(error.status, error.code)
            : null;
      if (terminalPairingError) {
        setPairingFormError(null);
        if (urlPairingId) {
          setPairingLinkError(terminalPairingError);
        } else if (terminalPairingError === "choosePendingComputer") {
          setPendingBrowserPairingId(null);
          setPairingFormError(terminalPairingError);
          window.requestAnimationFrame(() => {
            pendingPairingDeviceSelectRef.current?.focus();
          });
        } else {
          setPendingBrowserPairingId(null);
          setPendingBrowserDiscovery(null);
          setPendingBrowserDiscoveryError(
            terminalPairingError === "noPendingBrowserPairing"
              ? terminalPairingError
              : "pendingPairingExpired",
          );
          window.requestAnimationFrame(() => {
            pendingDiscoveryRetryButtonRef.current?.focus();
          });
        }
        return;
      }
      const pairingErrorKey: AuthCopyKey =
        error instanceof RelayApiError && error.status === 0
          ? "cannotReachRelay"
          : "secureConnectionFailed";
      setPairingFormError(pairingErrorKey);
      window.requestAnimationFrame(() => {
        if (pairingErrorKey === "secureConnectionFailed") {
          pairingCodeInputRef.current?.focus();
          pairingCodeInputRef.current?.select();
        } else {
          pairingSubmitButtonRef.current?.focus();
        }
      });
    } finally {
      if (pairingAbort.current === controller) pairingAbort.current = null;
    }
  }

  function cancelBrowserPairing() {
    if (pairingPhase === "idle" || pairingPhase === "complete") return;
    pairingRunId.current += 1;
    pairingAbort.current?.abort();
    pairingAbort.current = null;
    setPairingPhase("idle");
    setAuthToastKey("connectionCancelled");
    window.requestAnimationFrame(() => {
      pairingCodeInputRef.current?.focus();
      pairingCodeInputRef.current?.select();
    });
  }

  function switchProvider(nextProvider: AgentProvider) {
    selectedProviderRef.current = nextProvider;
    setSelectedProvider(nextProvider);
    const nextSession = allSessions.find(
      (session) =>
        !session.is_subagent &&
        (session.provider ?? CONFIGURED_PROVIDER) === nextProvider,
    );
    setActiveSession(nextSession?.id ?? "");
    storeActiveSessionSelection(
      relayDeviceId.current ?? "",
      nextSession?.id ?? "",
    );
    if (nextSession?.cwd) {
      setExpandedProjects((previous) =>
        new Set(previous).add(
          projectGroupKey(nextSession.cwd, nextSession.project),
        ),
      );
    }
    setMobilePanel("workspace");
    setCommandPaletteOpen(false);
    setPendingConfigConfirmation(null);
  }

  if (!authenticationEntryRequested && !authenticated && instance?.auth_mode !== "username") {
    return (
      <MarketingHome
        locale={authLocale}
        copy={
          authLocale === "zh-CN" || authLocale === "en"
            ? marketingCopy[authLocale]
            : localizedMarketingCopy(authLocale)
        }
        onLogin={() => {
          markMarketingReturnFocus();
          marketingLoginEntryRef.current = true;
          window.history.pushState(null, "", "/?login=1");
          setShowLogin(true);
          const reduceMotion = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches;
          window.scrollTo({
            top: 0,
            behavior: reduceMotion ? "auto" : "smooth",
          });
        }}
      />
    );
  }

  const marketingHomePath = localePath(authLocale);

  if (checkingAuth || (!instance && !instanceError)) {
    return (
      <main className="login-page">
        <AuthLanguageSwitch locale={authLocale} onToggle={toggleAuthLocale} />
        <section className="login-card login-sent" aria-live="polite">
          <div className="mail-orbit">
            <span className="spinner" />
          </div>
          <h1 ref={checkingAuthTitleRef} tabIndex={-1}>
            {authText(authLocale, "checkingTitle")}
          </h1>
          <p>{authText(authLocale, "checkingDetail")}</p>
        </section>
        <PublicSiteLinks selfHosted={selfHostedInstance} locale={authLocale} />
      </main>
    );
  }

  if (invalidDesktopLoginEntry) {
    return (
      <main className="login-page">
        <AuthLanguageSwitch locale={authLocale} onToggle={toggleAuthLocale} />
        <LoginBrand locale={authLocale} name={relayName} />
        <section
          className="login-card login-sent"
          aria-labelledby="invalid-desktop-login-title"
        >
          <div className="mail-orbit connection-error-icon" aria-hidden="true">
            !
          </div>
          <h1 id="invalid-desktop-login-title">
            {authText(authLocale, "invalidDesktopLoginTitle")}
          </h1>
          <p>{authText(authLocale, "invalidDesktopLoginDetail")}</p>
        </section>
        <PublicSiteLinks selfHosted={selfHostedInstance} locale={authLocale} />
      </main>
    );
  }

  if ((bootstrapError || instanceError) && !invalidPairingEntry && !(instance?.auth_mode === "username" && !authenticated)) {
    return (
      <main className="login-page">
        <AuthLanguageSwitch locale={authLocale} onToggle={toggleAuthLocale} />
        <LoginBrand locale={authLocale} name={relayName} />
        <section
          className="login-card login-sent"
          aria-labelledby="connection-error-title"
        >
          <div className="mail-orbit connection-error-icon" aria-hidden="true">
            !
          </div>
          <h1
            id="connection-error-title"
            ref={bootstrapErrorTitleRef}
            tabIndex={-1}
          >
            {authText(authLocale, bootstrapErrorKind === "review-isolated" ? "reviewIsolatedTitle" : "connectionErrorTitle")}
          </h1>
          <p>{bootstrapError || authText(authLocale, "connectionErrorTitle")}</p>
          <button
            className="primary-button login-button"
            type="button"
            disabled={loggingOut}
            aria-busy={loggingOut}
            onClick={() => { if (instanceError) window.location.reload(); else void (bootstrapErrorKind === "review-isolated" ? logout() : retryBootstrap()); }}
          >
            {authText(authLocale, bootstrapErrorKind === "review-isolated"
              ? (loggingOut ? "signingOut" : "signOut") : "retryConnection")}
          </button>
          {logoutError}
          <Link
            className="login-back-link"
            href={marketingHomePath}
            onClick={(event) => {
              event.preventDefault();
              window.location.assign(marketingHomePath);
            }}
          >
            {authText(authLocale, "backHome")}
          </Link>
        </section>
        <PublicSiteLinks selfHosted={selfHostedInstance}
          locale={authLocale}
          note={authText(authLocale, "publicInfoAvailable")}
        />
      </main>
    );
  }

  if (invalidPairingEntry) {
    return (
      <main className="login-page">
        <AuthLanguageSwitch locale={authLocale} onToggle={toggleAuthLocale} />
        <LoginBrand locale={authLocale} name={relayName} />
        <section
          className="login-card login-sent"
          aria-labelledby="invalid-pairing-title"
        >
          <div className="mail-orbit connection-error-icon" aria-hidden="true">
            !
          </div>
          <h1
            id="invalid-pairing-title"
            ref={invalidPairingTitleRef}
            tabIndex={-1}
          >
            {authText(authLocale, "invalidLinkTitle")}
          </h1>
          <p>{authText(authLocale, "invalidLinkDetail")}</p>
          <Link
            className="primary-button login-button button-link"
            href={marketingHomePath}
          >
            {authText(authLocale, "backHome")}
          </Link>
        </section>
        <PublicSiteLinks selfHosted={selfHostedInstance} locale={authLocale} />
      </main>
    );
  }

  if (pairingLinkError) {
    return (
      <main className="login-page">
        <AuthLanguageSwitch locale={authLocale} onToggle={toggleAuthLocale} />
        <LoginBrand locale={authLocale} name={relayName} />
        <section
          className="login-card login-sent"
          aria-labelledby="expired-pairing-title"
        >
          <div className="mail-orbit connection-error-icon" aria-hidden="true">
            !
          </div>
          <h1
            id="expired-pairing-title"
            ref={pairingLinkErrorTitleRef}
            tabIndex={-1}
          >
            {authText(authLocale, "expiredLinkTitle")}
          </h1>
          <p>{authText(authLocale, pairingLinkError)}</p>
          <Link
            className="primary-button login-button button-link"
            href={marketingHomePath}
          >
            {authText(authLocale, "backHome")}
          </Link>
        </section>
        <PublicSiteLinks selfHosted={selfHostedInstance} locale={authLocale} />
      </main>
    );
  }

  if (!authenticated) {
    if (instance?.auth_mode === "username") {
      return <main className="login-page">
        <AuthLanguageSwitch locale={authLocale} onToggle={toggleAuthLocale} />
        <LoginBrand locale={authLocale} name={relayName} />
        <InstanceLogin locale={authLocale} instance={instance} apiBase={API_BASE}
          pairingId={pairingId} desktopLoginId={desktopLoginId} />
        <InstancePublicLinks locale={authLocale} />
      </main>;
    }
    const isSettingPassword =
      loginState === "set-password" || loginState === "saving-password";
    const isPasswordLogin =
      loginState === "password" ||
      loginState === "authenticating" ||
      loginState === "sending-reset";
    const loginTitle = isSettingPassword
      ? authText(authLocale, "setPasswordTitle")
      : isPasswordLogin
        ? authText(authLocale, "welcomeBack")
        : desktopLoginId
          ? authText(authLocale, "desktopLoginTitle")
          : pairingId
            ? authText(authLocale, "connectLoginTitle")
            : authText(authLocale, "browserWorkTitle");
    const loginSubtitle = isSettingPassword
      ? authText(authLocale, "setPasswordSubtitle")
      : isPasswordLogin
        ? authText(authLocale, "passwordSubtitle")
        : desktopLoginId
          ? authText(authLocale, "desktopLoginSubtitle")
          : pairingId
            ? authText(authLocale, "connectLoginSubtitle")
            : `${authText(authLocale, "browserWorkPrefix")} ${
                MULTI_AGENT_ENABLED
                  ? authText(authLocale, "multiAgentNames")
                  : agentName
              } ${authText(authLocale, "taskSuffix")}`;
    return (
      <main className="login-page">
        <AuthLanguageSwitch locale={authLocale} onToggle={toggleAuthLocale} />
        <div className="login-ambient ambient-one" />
        <div className="login-ambient ambient-two" />
        <LoginBrand locale={authLocale} name={relayName} />
        <section className="login-card" aria-labelledby="login-title">
          <div className="login-eyebrow">
            <span className="online-dot" />
            {isSettingPassword
              ? authText(authLocale, "emailVerified")
              : authText(authLocale, "secureEmailLogin")}
          </div>
          <h1 id="login-title">{loginTitle}</h1>
          <p className="login-subtitle">{loginSubtitle}</p>
          {loginState === "sent" ? (
            <section
              className="login-sent"
              aria-labelledby="verification-sent-title"
            >
              <div className="mail-orbit">
                <Icon>✓</Icon>
              </div>
              <h2
                id="verification-sent-title"
                ref={verificationSentTitleRef}
                tabIndex={-1}
              >
                {authText(authLocale, "verifyEmailTitle")}
              </h2>
              <p>
                {authText(authLocale, "verifyEmailPrefix")}{" "}
                <strong><TechnicalValue>{email}</TechnicalValue></strong>
                {authText(authLocale, "verifyEmailSuffix")}
              </p>
              <p className="password-requirement">
                {authText(authLocale, "verificationExpiry")}
              </p>
              {emailFlowError && (
                <p
                  className="field-error"
                  id="verification-resend-error"
                  role="alert"
                >
                  {authText(authLocale, emailFlowError)}
                </p>
              )}
              <div className="verification-actions">
                <button
                  className="text-button"
                  type="button"
                  aria-disabled={resendingVerification}
                  onClick={() => void resendEmailVerification()}
                >
                  {resendingVerification
                    ? authText(authLocale, "sendingVerification")
                    : authText(authLocale, "resendEmail")}
                </button>
                <button
                  className="text-button"
                  type="button"
                  disabled={resendingVerification}
                  onClick={changeLoginEmail}
                >
                  {authText(authLocale, "useAnotherEmail")}
                </button>
              </div>
              <p
                className="login-sr-only"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {resendingVerification
                  ? authText(authLocale, "sendingVerification")
                  : ""}
              </p>
            </section>
          ) : isSettingPassword ? (
            <form
              className="login-form"
              onSubmit={submitNewPassword}
              noValidate
              aria-busy={loginState === "saving-password"}
            >
              <div className="field-group">
                <label htmlFor="new-password">
                  {authText(authLocale, "setPassword")}
                </label>
                <div className="email-field">
                  <Icon>⌁</Icon>
                  <input
                    ref={passwordInputRef}
                    id="new-password"
                    type="password"
                    dir="ltr"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (newPasswordError) setNewPasswordError(null);
                      if (
                        passwordSetupError &&
                        passwordSetupError !== "passwordSetupExpired"
                      ) {
                        setPasswordSetupError(null);
                      }
                    }}
                    placeholder={authText(authLocale, "passwordAtLeastEight")}
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    readOnly={loginState === "saving-password"}
                    aria-invalid={newPasswordError ? true : undefined}
                    aria-describedby={
                      newPasswordError
                        ? "new-password-requirement new-password-error"
                        : "new-password-requirement"
                    }
                    autoFocus
                  />
                </div>
                {newPasswordError && (
                  <p
                    className="field-error"
                    id="new-password-error"
                    role="alert"
                  >
                    {authText(authLocale, newPasswordError)}
                  </p>
                )}
              </div>
              <div className="field-group">
                <label htmlFor="confirm-password">
                  {authText(authLocale, "confirmPassword")}
                </label>
                <div className="email-field">
                  <Icon>✓</Icon>
                  <input
                    ref={passwordConfirmationInputRef}
                    id="confirm-password"
                    type="password"
                    dir="ltr"
                    value={passwordConfirmation}
                    onChange={(event) => {
                      setPasswordConfirmation(event.target.value);
                      if (passwordConfirmationError) {
                        setPasswordConfirmationError(null);
                      }
                      if (
                        passwordSetupError &&
                        passwordSetupError !== "passwordSetupExpired"
                      ) {
                        setPasswordSetupError(null);
                      }
                    }}
                    placeholder={authText(authLocale, "enterPasswordAgain")}
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    readOnly={loginState === "saving-password"}
                    aria-invalid={passwordConfirmationError ? true : undefined}
                    aria-describedby={
                      passwordConfirmationError
                        ? "confirm-password-error"
                        : undefined
                    }
                  />
                </div>
                {passwordConfirmationError && (
                  <p
                    className="field-error"
                    id="confirm-password-error"
                    role="alert"
                  >
                    {authText(authLocale, passwordConfirmationError)}
                  </p>
                )}
              </div>
              <p className="password-requirement" id="new-password-requirement">
                {authText(authLocale, "passwordRequirement")}
              </p>
              {passwordSetupError && (
                <p
                  className="field-error"
                  id="password-setup-error"
                  role="alert"
                >
                  {authText(authLocale, passwordSetupError)}
                </p>
              )}
              {passwordSetupError === "passwordSetupExpired" ? (
                <button
                  ref={passwordSetupRecoveryButtonRef}
                  className="primary-button login-button"
                  type="button"
                  onClick={changeLoginEmail}
                >
                  {authText(authLocale, "verifyEmailAgain")} <span>→</span>
                </button>
              ) : (
                <button
                  ref={passwordSetupSubmitButtonRef}
                  className="primary-button login-button"
                  type="submit"
                  disabled={loginState === "saving-password"}
                >
                  {loginState === "saving-password" ? (
                    <>
                      <span className="spinner" />{" "}
                      {authText(authLocale, "saving")}
                    </>
                  ) : (
                    <>
                      {authText(authLocale, "setPasswordContinue")}{" "}
                      <span>→</span>
                    </>
                  )}
                </button>
              )}
              <p
                className="login-sr-only"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {loginState === "saving-password"
                  ? authText(authLocale, "saving")
                  : ""}
              </p>
            </form>
          ) : isPasswordLogin ? (
            <form
              className="login-form"
              onSubmit={submitPassword}
              noValidate
              aria-busy={
                loginState === "authenticating" ||
                loginState === "sending-reset"
              }
            >
              <div className="auth-email-summary">
                <span>
                  <Icon>✉</Icon>
                  <TechnicalValue>{email}</TechnicalValue>
                </span>
                <button type="button" onClick={changeLoginEmail}>
                  {authText(authLocale, "change")}
                </button>
              </div>
              <div className="field-group">
                <label htmlFor="password">
                  {authText(authLocale, "password")}
                </label>
                <div className="email-field">
                  <Icon>⌁</Icon>
                  <input
                    ref={passwordInputRef}
                    id="password"
                    type="password"
                    dir="ltr"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (passwordError) setPasswordError(null);
                    }}
                    placeholder={authText(authLocale, "enterLoginPassword")}
                    autoComplete="current-password"
                    maxLength={128}
                    readOnly={
                      loginState === "authenticating" ||
                      loginState === "sending-reset"
                    }
                    aria-invalid={passwordError ? true : undefined}
                    aria-describedby={
                      passwordError ? "password-error" : undefined
                    }
                    autoFocus
                  />
                </div>
                {passwordError && (
                  <p className="field-error" id="password-error" role="alert">
                    {authText(authLocale, passwordError)}
                  </p>
                )}
              </div>
              <button
                className="primary-button login-button"
                type="submit"
                disabled={loginState !== "password"}
              >
                {loginState === "authenticating" ? (
                  <>
                    <span className="spinner" />{" "}
                    {authText(authLocale, "signingIn")}
                  </>
                ) : (
                  <>
                    {desktopLoginId
                      ? authText(authLocale, "signInMac")
                      : pairingId
                        ? authText(authLocale, "signInConnect")
                        : authText(authLocale, "signIn")}{" "}
                    <span>→</span>
                  </>
                )}
              </button>
              <button
                ref={passwordResetButtonRef}
                className="text-button login-secondary-action"
                type="button"
                disabled={loginState === "sending-reset"}
                onClick={() => void requestEmailVerification(email, "password")}
              >
                {loginState === "sending-reset"
                  ? authText(authLocale, "sendingVerification")
                  : authText(authLocale, "forgotPassword")}
              </button>
              <p
                className="login-sr-only"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {loginState === "authenticating"
                  ? authText(authLocale, "signingIn")
                  : loginState === "sending-reset"
                    ? authText(authLocale, "sendingVerification")
                    : ""}
              </p>
            </form>
          ) : (
            <form
              className="login-form"
              onSubmit={submitEmail}
              noValidate
              aria-busy={loginState === "checking" || loginState === "sending"}
            >
              <div className="field-group">
                <label htmlFor="email">
                  {authText(authLocale, "emailAddress")}
                </label>
                <div className="email-field">
                  <Icon>✉</Icon>
                  <input
                    ref={emailInputRef}
                    id="email"
                    type="email"
                    dir="ltr"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      if (emailError) setEmailError(null);
                      if (emailFlowError) setEmailFlowError(null);
                    }}
                    placeholder="you@company.com"
                    autoComplete="email"
                    readOnly={
                      loginState === "checking" || loginState === "sending"
                    }
                    aria-invalid={emailError ? true : undefined}
                    aria-describedby={
                      emailError
                        ? "email-error"
                        : emailFlowError
                          ? "email-flow-error"
                          : undefined
                    }
                    autoFocus
                  />
                </div>
                {emailError && (
                  <p className="field-error" id="email-error" role="alert">
                    {authText(authLocale, emailError)}
                  </p>
                )}
              </div>
              {emailFlowError && (
                <p className="field-error" id="email-flow-error" role="alert">
                  {authText(authLocale, emailFlowError)}
                </p>
              )}
              <button
                className="primary-button login-button"
                type="submit"
                disabled={loginState === "checking" || loginState === "sending"}
              >
                {loginState === "checking" ? (
                  <>
                    <span className="spinner" />{" "}
                    {authText(authLocale, "checking")}
                  </>
                ) : loginState === "sending" ? (
                  <>
                    <span className="spinner" />{" "}
                    {authText(authLocale, "sendingVerificationEmail")}
                  </>
                ) : (
                  <>
                    {authText(authLocale, "continue")} <span>→</span>
                  </>
                )}
              </button>
              <p
                className="login-sr-only"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {loginState === "checking"
                  ? authText(authLocale, "checking")
                  : loginState === "sending"
                    ? authText(authLocale, "sendingVerificationEmail")
                    : ""}
              </p>
            </form>
          )}
          <DesktopDownload locale={authLocale} />
          <div className="login-divider">
            <span />
            <small>{authText(authLocale, "safeLogin")}</small>
            <span />
          </div>
          <div className="trust-row">
            <span>
              <Icon>◇</Icon> {authText(authLocale, "oneSignIn")}
            </span>
            <span>
              <Icon>⌁</Icon> {authText(authLocale, "endToEndEncrypted")}
            </span>
            <span>
              <Icon>◎</Icon> {authText(authLocale, "tasksStayLocal")}
            </span>
          </div>
        </section>
        <PublicSiteLinks selfHosted={selfHostedInstance}
          locale={authLocale}
          note={authText(authLocale, "encryptedRelayNote")}
        />
        {visibleToast && (
          <div className="toast" role="status" aria-live="polite">
            {visibleToast}
          </div>
        )}
      </main>
    );
  }

  if (desktopLoginId) {
    const approved = desktopLoginApproval?.status === "approved";
    const errorKey = desktopLoginError;
    return (
      <main className="login-page">
        <AuthLanguageSwitch locale={authLocale} onToggle={toggleAuthLocale} />
        <div className="login-ambient ambient-one" />
        <div className="login-ambient ambient-two" />
        <LoginBrand locale={authLocale} name={relayName} />
        <section
          className="login-card login-sent"
          aria-labelledby="desktop-login-approval-title"
        >
          <div className="login-eyebrow">
            <span className="online-dot" />
            {authText(authLocale, "desktopLoginEyebrow")}
          </div>
          <div className="mail-orbit" aria-hidden="true">
            <Icon>{approved ? "✓" : "⌘"}</Icon>
          </div>
          <h1 id="desktop-login-approval-title">
            {authText(
              authLocale,
              approved
                ? "desktopLoginCompleteTitle"
                : "desktopLoginApproveTitle",
            )}
          </h1>
          <p className="login-subtitle">
            {authText(
              authLocale,
              approved
                ? "desktopLoginCompleteDetail"
                : "desktopLoginApproveDetail",
            )}
          </p>
          {desktopLoginApproval && !approved && (
            <div className="auth-email-summary desktop-login-summary">
              <span>
                <Icon>⌘</Icon>
                {desktopLoginApproval.device_name}
              </span>
              <small><TechnicalValue>{desktopLoginApproval.account_email}</TechnicalValue></small>
            </div>
          )}
          {errorKey && (
            <>
              <p className="field-error" role="alert">
                {authText(authLocale, errorKey)}
              </p>
              <button
                className="primary-button login-button"
                type="button"
                onClick={() =>
                  errorKey === "desktopLoginExpired"
                    ? returnToRelayuneDesktop()
                    : window.location.reload()
                }
              >
                {authText(
                  authLocale,
                  errorKey === "desktopLoginExpired"
                    ? "returnToMac"
                    : "retryConnection",
                )}{" "}
                <span>→</span>
              </button>
            </>
          )}
          {desktopLoginApproval && !errorKey && (
            <button
              className="primary-button login-button"
              type="button"
              disabled={approvingDesktopLogin}
              onClick={() =>
                approved
                  ? returnToRelayuneDesktop()
                  : void approveDesktopLogin()
              }
            >
              {approvingDesktopLogin && <span className="spinner" />} {" "}
              {authText(
                authLocale,
                approvingDesktopLogin
                  ? "approvingMac"
                  : approved
                    ? "returnToMac"
                    : "approveThisMac",
              )}{" "}
              {!approvingDesktopLogin && <span>→</span>}
            </button>
          )}
          <div className="login-divider">
            <span />
            <small>{authText(authLocale, "safeLogin")}</small>
            <span />
          </div>
          <p className="password-requirement">
            {authText(authLocale, "desktopLoginSubtitle")}
          </p>
        </section>
        <PublicSiteLinks selfHosted={selfHostedInstance}
          locale={authLocale}
          note={authText(authLocale, "encryptedRelayNote")}
        />
      </main>
    );
  }

  if (pairingId) {
    const pairingBusy = pairingPhase !== "idle";
    const pairingActionError =
      pairingFormError === "cannotReachRelay" ? pairingFormError : null;
    const pairingCodeError = pairingActionError ? null : pairingFormError;
    const pairingButtonLabel =
      pairingPhase === "deriving"
        ? authText(authLocale, "deriving")
        : pairingPhase === "waiting"
          ? authText(authLocale, "waiting")
          : pairingPhase === "activating"
            ? authText(authLocale, "activating")
            : pairingPhase === "complete"
              ? authText(authLocale, "complete")
              : authText(authLocale, "connectDevice");
    return (
      <main className="login-page">
        <AuthLanguageSwitch locale={authLocale} onToggle={toggleAuthLocale} />
        <div className="login-ambient ambient-one" />
        <div className="login-ambient ambient-two" />
        <LoginBrand locale={authLocale} name={relayName} />
        <section className="login-card" aria-labelledby="pairing-title">
          <div className="login-eyebrow">
            <span className="online-dot" />
            {authText(authLocale, "connectDevice")}
          </div>
          <h1 id="pairing-title">{authText(authLocale, "enterDeviceCode")}</h1>
          <p className="login-subtitle" id="pairing-code-help">
            {authText(authLocale, "codeSubtitle")}
          </p>
          <form
            className="login-form"
            onSubmit={connectMac}
            aria-busy={pairingBusy}
          >
            <label htmlFor="pairing-code">
              {authText(authLocale, "connectionCode")}
            </label>
            <div className="email-field pairing-code-field">
              <input
                ref={pairingCodeInputRef}
                id="pairing-code"
                type="text"
                dir="ltr"
                value={pairingCode}
                onChange={(event) => {
                  setPairingCode(pairingCodeInput(event.target.value));
                  if (pairingCodeError) setPairingFormError(null);
                }}
                placeholder="ABCD-EFGH"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={9}
                inputMode="text"
                aria-invalid={pairingCodeError ? true : undefined}
                aria-describedby={
                  pairingCodeError
                    ? "pairing-code-help pairing-code-error"
                    : "pairing-code-help"
                }
                autoFocus
                readOnly={pairingBusy}
              />
            </div>
            {pairingCodeError && (
              <p className="field-error" id="pairing-code-error" role="alert">
                {authText(authLocale, pairingCodeError)}
              </p>
            )}
            <button
              ref={pairingSubmitButtonRef}
              className="primary-button login-button"
              type="submit"
              disabled={pairingBusy || pairingCode.length !== 9}
              aria-describedby={
                pairingActionError ? "pairing-action-error" : undefined
              }
            >
              {pairingBusy && pairingPhase !== "complete" && (
                <span className="spinner" />
              )}
              {pairingButtonLabel}
              {!pairingBusy && <span>→</span>}
            </button>
            {pairingActionError && (
              <p className="field-error" id="pairing-action-error" role="alert">
                {authText(authLocale, pairingActionError)}
              </p>
            )}
            {pairingBusy && pairingPhase !== "complete" && (
              <button
                className="text-button pairing-cancel-button"
                type="button"
                onClick={cancelBrowserPairing}
              >
                {authText(authLocale, "cancelRetry")}
              </button>
            )}
            <p
              className="login-sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {pairingBusy ? pairingButtonLabel : ""}
            </p>
          </form>
          <div className="pairing-manual-divider">
            <span />
            <small>{authText(authLocale, "manualCodeFallback")}</small>
            <span />
          </div>
          <PairingScanner
            locale={authLocale}
            disabled={pairingBusy}
            onScan={connectScannedPairing}
          />
          <div className="login-divider">
            <span />
            <small>{authText(authLocale, "oneTimeConnection")}</small>
            <span />
          </div>
          <div className="trust-row">
            <span>
              <Icon>◇</Icon> {authText(authLocale, "codeNotUploaded")}
            </span>
            <span>
              <Icon>⌁</Icon> {authText(authLocale, "serverCannotDerive")}
            </span>
            <span>
              <Icon>◎</Icon> {authText(authLocale, "expiresTenMinutes")}
            </span>
          </div>
        </section>
        <PublicSiteLinks selfHosted={selfHostedInstance}
          locale={authLocale}
          note={authText(authLocale, "pairingCryptoNote")}
        />
        {visibleToast && (
          <div className="toast" role="status" aria-live="polite">
            {visibleToast}
          </div>
        )}
      </main>
    );
  }

  if (needsE2eeKey && pendingBrowserDiscovery?.has_bound_computer) {
    const pairingBusy = pairingPhase !== "idle";
    const pairingButtonLabel =
      pairingPhase === "deriving"
        ? authText(authLocale, "deriving")
        : pairingPhase === "waiting"
          ? authText(authLocale, "waiting")
          : pairingPhase === "activating"
            ? authText(authLocale, "activating")
            : pairingPhase === "complete"
              ? authText(authLocale, "complete")
              : authText(authLocale, "connectDevice");
    const chooseComputer = pendingBrowserDiscovery.pairings.length > 1;
    const computerSelectionError = pairingFormError === "choosePendingComputer";
    const pairingActionError =
      pairingFormError === "cannotReachRelay" ? pairingFormError : null;
    const pairingCodeError =
      pairingFormError && !computerSelectionError && !pairingActionError
        ? pairingFormError
        : null;
    return (
      <main className="login-page">
        <AuthLanguageSwitch locale={authLocale} onToggle={toggleAuthLocale} />
        <div className="login-ambient ambient-one" />
        <div className="login-ambient ambient-two" />
        <LoginBrand locale={authLocale} name={relayName} />
        <section className="login-card" aria-labelledby="direct-pairing-title">
          <div className="login-eyebrow">
            <span className="online-dot" />
            {authText(authLocale, "deviceNotConnected")}
          </div>
          <h1 id="direct-pairing-title">
            {authText(authLocale, "addBrowserCodeTitle")}
          </h1>
          <p className="login-subtitle" id="direct-pairing-code-help">
            {authText(authLocale, "addBrowserCodeHelp")}
          </p>
          <div className="pairing-guidance" role="note">
            <span className="pairing-guidance-number">1</span>
            <p>{authText(authLocale, "addBrowserStep")}</p>
            <span className="pairing-guidance-number">2</span>
            <p>{authText(authLocale, "enterCodeStep")}</p>
          </div>
          <form
            className="login-form"
            onSubmit={connectMac}
            aria-busy={pairingBusy}
          >
            {chooseComputer && (
              <div className="field-group">
                <label htmlFor="pending-pairing-device">
                  {authText(authLocale, "chooseComputer")}
                </label>
                <select
                  ref={pendingPairingDeviceSelectRef}
                  className="pairing-device-select"
                  id="pending-pairing-device"
                  autoFocus={chooseComputer}
                  required={chooseComputer}
                  value={pendingBrowserPairingId ?? ""}
                  onChange={(event) => {
                    setPendingBrowserPairingId(event.target.value || null);
                    setPairingFormError(null);
                  }}
                  disabled={pairingBusy}
                  aria-invalid={computerSelectionError ? true : undefined}
                  aria-describedby={
                    computerSelectionError
                      ? "pending-pairing-device-error"
                      : undefined
                  }
                >
                  <option value="">
                    {authText(authLocale, "chooseComputerPlaceholder")}
                  </option>
                  {pendingBrowserDiscovery.pairings.map((pairing) => (
                    <option key={pairing.pairing_id} value={pairing.pairing_id}>
                      {pairing.device_name}
                    </option>
                  ))}
                </select>
                {computerSelectionError && (
                  <p
                    className="field-error"
                    id="pending-pairing-device-error"
                    role="alert"
                  >
                    {authText(authLocale, pairingFormError)}
                  </p>
                )}
              </div>
            )}
            <label htmlFor="pairing-code">
              {authText(authLocale, "connectionCode")}
            </label>
            <div className="email-field pairing-code-field">
              <input
                ref={pairingCodeInputRef}
                id="pairing-code"
                type="text"
                dir="ltr"
                value={pairingCode}
                onChange={(event) => {
                  setPairingCode(pairingCodeInput(event.target.value));
                  if (pairingCodeError) setPairingFormError(null);
                }}
                placeholder="ABCD-EFGH"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={9}
                inputMode="text"
                aria-invalid={pairingCodeError ? true : undefined}
                aria-describedby={
                  pairingCodeError
                    ? "direct-pairing-code-help pairing-code-error"
                    : "direct-pairing-code-help"
                }
                autoFocus={!chooseComputer}
                readOnly={pairingBusy}
              />
            </div>
            {pairingCodeError && (
              <p className="field-error" id="pairing-code-error" role="alert">
                {authText(authLocale, pairingCodeError)}
              </p>
            )}
            <button
              ref={pairingSubmitButtonRef}
              className="primary-button login-button"
              type="submit"
              disabled={
                pairingBusy ||
                checkingPendingBrowserPairings ||
                (chooseComputer && !pendingBrowserPairingId) ||
                pairingCode.length !== 9
              }
              aria-describedby={
                pairingActionError ? "pairing-action-error" : undefined
              }
            >
              {pairingBusy && pairingPhase !== "complete" && (
                <span className="spinner" />
              )}
              {pairingButtonLabel}
              {!pairingBusy && <span>→</span>}
            </button>
            {pairingActionError && (
              <p className="field-error" id="pairing-action-error" role="alert">
                {authText(authLocale, pairingActionError)}
              </p>
            )}
            {pairingBusy && pairingPhase !== "complete" && (
              <button
                className="text-button pairing-cancel-button"
                type="button"
                onClick={cancelBrowserPairing}
              >
                {authText(authLocale, "cancelRetry")}
              </button>
            )}
            <p
              className="login-sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {pairingBusy ? pairingButtonLabel : ""}
            </p>
          </form>
          <div className="pairing-manual-divider">
            <span />
            <small>{authText(authLocale, "manualCodeFallback")}</small>
            <span />
          </div>
          <PairingScanner
            locale={authLocale}
            disabled={pairingBusy}
            onScan={connectScannedPairing}
          />
          <div className="trust-row">
            <span>
              <Icon>◇</Icon> {authText(authLocale, "codeNotUploaded")}
            </span>
            <span>
              <Icon>⌁</Icon> {authText(authLocale, "serverCannotDerive")}
            </span>
            <span>
              <Icon>◎</Icon> {authText(authLocale, "expiresTenMinutes")}
            </span>
          </div>
          <button
            className="text-button"
            type="button"
            aria-busy={loggingOut}
            disabled={loggingOut || pairingBusy}
            onClick={() => void logout()}
          >
            {authText(authLocale, loggingOut ? "signingOut" : "signOut")}
          </button>
          {logoutError}
        </section>
        <PublicSiteLinks selfHosted={selfHostedInstance}
          locale={authLocale}
          note={authText(authLocale, "pairingCryptoNote")}
        />
        {visibleToast && (
          <div className="toast" role="status" aria-live="polite">
            {visibleToast}
          </div>
        )}
      </main>
    );
  }

  if (needsE2eeKey) {
    const pairingBusy = pairingPhase !== "idle";
    return (
      <main className="login-page">
        <AuthLanguageSwitch locale={authLocale} onToggle={toggleAuthLocale} />
        <div className="login-ambient ambient-one" />
        <div className="login-ambient ambient-two" />
        <LoginBrand locale={authLocale} name={relayName} />
        <section className="login-card" aria-labelledby="e2ee-title">
          <div className="login-eyebrow">
            <span className="online-dot" />
            {authText(authLocale, "deviceNotConnected")}
          </div>
          <h1 ref={pendingDiscoveryTitleRef} id="e2ee-title" tabIndex={-1}>
            {authText(authLocale, "openDesktopFirst")}
          </h1>
          <p className="login-subtitle">
            {authText(authLocale, "openDesktopHelp")}
          </p>
          <PairingScanner
            locale={authLocale}
            disabled={pairingBusy || loggingOut}
            onScan={connectScannedPairing}
          />
          {checkingPendingBrowserPairings ? (
            <div
              className="pairing-discovery-status"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <span className="spinner" aria-hidden="true" />
              <span>
                <strong>
                  {authText(authLocale, "findingPendingComputer")}
                </strong>
                <small>
                  {authText(authLocale, "findingPendingComputerDetail")}
                </small>
              </span>
            </div>
          ) : pendingBrowserDiscoveryError ? (
            <div className="pairing-discovery-status is-error" role="alert">
              <span>{authText(authLocale, pendingBrowserDiscoveryError)}</span>
              <button
                ref={pendingDiscoveryRetryButtonRef}
                className="text-button"
                type="button"
                onClick={() => {
                  void discoverPendingBrowserPairings(undefined, true).catch(
                    () => {},
                  );
                }}
              >
                {authText(authLocale, "retryConnection")}
              </button>
            </div>
          ) : null}
          <div className="pairing-guidance" role="note">
            <span className="pairing-guidance-number">1</span>
            <p>{authText(authLocale, "openDesktopStep")}</p>
            <span className="pairing-guidance-number">2</span>
            <p>{authText(authLocale, "openBrowserStep")}</p>
          </div>
          <DesktopDownload locale={authLocale} />
          <div className="trust-row">
            <span>
              <Icon>◇</Icon> {authText(authLocale, "noKeysToCopy")}
            </span>
            <span>
              <Icon>⌁</Icon> {authText(authLocale, "serverHoldsNoKey")}
            </span>
            <span>
              <Icon>◎</Icon> {authText(authLocale, "connectOnce")}
            </span>
          </div>
          <button
            className="text-button"
            type="button"
            aria-busy={loggingOut}
            disabled={loggingOut}
            onClick={() => void logout()}
          >
            {authText(authLocale, loggingOut ? "signingOut" : "signOut")}
          </button>
          {logoutError}
          <p
            className="login-sr-only"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {loggingOut ? authText(authLocale, "signingOut") : ""}
          </p>
        </section>
        <PublicSiteLinks selfHosted={selfHostedInstance} locale={authLocale} />
        {visibleToast && (
          <div className="toast" role="status" aria-live="polite">
            {visibleToast}
          </div>
        )}
      </main>
    );
  }

  const agentOnline = deviceOnline;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <button
            ref={projectDrawerTrigger}
            className="mobile-project-trigger"
            type="button"
            aria-label={workbenchText(authLocale, "openProjectDrawer")}
            aria-controls="project-drawer"
            aria-expanded={projectDrawerOpen}
            onClick={() => {
              if (current?.cwd) {
                setExpandedProjects((previous) =>
                  new Set(previous).add(current.cwd),
                );
              }
              setProjectDrawerOpen(true);
            }}
          >
            <Icon>☰</Icon>
            <span>
              {current?.project ?? workbenchText(authLocale, "projectFallback")}
            </span>
          </button>
          <Mark />
          <span className="relay-name">{relayName}</span>
          <span className="beta-badge">E2EE</span>
        </div>
        <div className="machine-status">
          <span
            className={deviceOnline ? "online-dot" : "session-status idle"}
          />
          <span className="machine-name">{snapshot?.device.name}</span>
          <span className="muted">
            {realtimeDevice.transport === "connecting" ||
            realtimeDevice.transport === "reconnecting"
              ? workbenchText(authLocale, "reconnectingRealtime")
              : deviceOnline
                ? workbenchText(authLocale, "onlineLatency", {
                    latency: snapshot?.device.latency_ms ?? "—",
                  })
                : workbenchText(authLocale, "offline")}
          </span>
        </div>
        <div className="topbar-actions">
          <AuthLanguageSwitch locale={authLocale} onToggle={toggleAuthLocale} />
          <button
            className="icon-button"
            aria-label={workbenchText(authLocale, "approvalNotifications")}
            onClick={() => {
              setProjectDrawerOpen(false);
              setMobilePanel("activity");
            }}
          >
            <Icon>♢</Icon>
            {pendingCount > 0 && <span className="notification-dot" />}
          </button>
          <p
            className="login-sr-only"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {loggingOut ? authText(authLocale, "signingOut") : ""}
          </p>
        </div>
      </header>

      {syncInterrupted && (
        <div className="sync-error-banner" role="alert">
          <span>{workbenchText(authLocale, "syncInterrupted")}</span>
          <button
            type="button"
            aria-busy={retryingSync}
            aria-disabled={retryingSync}
            onClick={() => void retryInterruptedSync()}
          >
            {workbenchText(authLocale, retryingSync ? "retrying" : "retrySync")}
          </button>
        </div>
      )}

      <div className="workspace-grid">
        <aside
          id="project-drawer"
          className={`sidebar ${MULTI_AGENT_ENABLED ? "agent-rail-enabled" : ""} ${projectDrawerOpen ? "mobile-visible" : ""}`}
          aria-label={workbenchText(authLocale, "projectsAndSessions")}
          aria-modal={projectDrawerOpen ? true : undefined}
          role={projectDrawerOpen ? "dialog" : undefined}
        >
          {MULTI_AGENT_ENABLED && (
            <nav
              className="agent-provider-rail"
              aria-label={workbenchText(authLocale, "chooseProvider")}
            >
              <span className="agent-provider-rail-brand" aria-hidden="true">
                <Mark size={28} />
              </span>
              <span className="agent-provider-rail-divider" aria-hidden="true" />
              <AgentProviderOptions
                key={email}
                options={AGENT_PROVIDER_OPTIONS}
                selected={selectedProvider}
                onSelect={switchProvider}
                locale={authLocale}
                request={requestAgentOrder}
              />
            </nav>
          )}
          <div className="mobile-drawer-header">
            <div>
              <strong>{agentName}</strong>
              <small>
                {workbenchText(authLocale, "projectsAndSessions")}
              </small>
            </div>
            <button
              ref={projectDrawerClose}
              className="mobile-drawer-close"
              type="button"
              aria-label={workbenchText(authLocale, "closeProjectDrawer")}
              onClick={() => {
                closeProjectDrawer();
              }}
            >
              ×
            </button>
          </div>
          <div className="section-label project-section-label">
            <span>
              {workbenchText(authLocale, "localAgentProjects", {
                agent: agentName,
              })}
            </span>
            <span className="section-count">{sessionGroups.length}</span>
          </div>
          {selectedProvider === "claude-cowork" && (
            <p className="provider-project-note" role="note">
              {workbenchText(authLocale, "coworkCreateInDesktop")}
            </p>
          )}
          <button className="add-project-entry" type="button" onClick={() => setAddingProject(true)}>＋ {projectText(authLocale, "title")}</button>
          <AddProject key={`${snapshot?.device.id}:${selectedProvider}`} provider={selectedProvider} providerName={agentNameForProvider(selectedProvider)} open={addingProject} locale={authLocale} deviceName={snapshot?.device.name ?? ""} online={deviceOnline} currentPath={allSessions.find(s => s.id === activeSession)?.cwd} request={projectRequest} onCreated={acceptCreatedProject} onStart={startProjectTask} onClose={() => setAddingProject(false)} />
          <div className="session-list">
            {sessionGroups.length ? (
              sessionGroups.map((group, groupIndex) => {
                const expanded = expandedProjects.has(group.key);
                const pageKey = `${snapshot?.device.id}:${selectedProvider}:${group.key}`;
                const page = projectPages[pageKey];
                const newestLoaded = page?.sessions.reduce((latest, s) => s.updated_at > latest ? s.updated_at : latest, "") ?? "";
                const visibleSessions = page?.loaded
                  ? group.sessions.filter(s => page.sessions.some(p => p.id === s.id) || (newestLoaded && s.updated_at > newestLoaded))
                  : group.sessions.slice(0, 5);
                const projectSessionsId = `project-sessions-${groupIndex}`;
                return (
                  <section className="project-group" key={group.key}>
                    <div
                      className={`project-group-header ${expanded ? "expanded" : ""}`}
                    >
                      <button
                        className="project-toggle"
                        onClick={() => {
                          if (!expanded && !page?.loaded) void loadProjectPage(pageKey, group.cwd);
                          setExpandedProjects((previous) => {
                            const next = new Set(previous);
                            if (next.has(group.key)) next.delete(group.key);
                            else next.add(group.key);
                            return next;
                          });
                        }}
                        title={isolateTechnicalText(group.cwd)}
                        aria-expanded={expanded}
                        aria-controls={projectSessionsId}
                      >
                        <span className="project-chevron">›</span>
                        <span className="project-folder">▱</span>
                        <span className="project-name">
                          <TechnicalValue>{group.displayName}</TechnicalValue>
                        </span>
                      </button>
                      {selectedProvider !== "claude-cowork" && (
                        <button
                          className="project-add-button"
                          aria-label={workbenchText(
                            authLocale,
                            "createSessionInProject",
                            { project: group.name },
                          )}
                          title={workbenchText(
                            authLocale,
                            "createSessionInProject",
                            { project: group.name },
                          )}
                          onClick={() => void createSession(group.cwd)}
                          aria-busy={creatingProject === group.cwd}
                          aria-disabled={Boolean(creatingProject)}
                        >
                          {creatingProject === group.cwd ? "…" : "+"}
                        </button>
                      )}
                    </div>
                    {expanded && (
                      <div className="project-sessions" id={projectSessionsId}>
                        {visibleSessions.map((session) => {
                          const sessionRunning = isSessionRunning(
                            session,
                          );
                          return (
                            <button
                              className={`session-item ${
                                projectSelectedSession === session.id
                                  ? "selected"
                                  : ""
                              }`}
                              data-agent-running={sessionRunning}
                              key={session.id}
                              aria-current={
                                projectSelectedSession === session.id
                                  ? "page"
                                  : undefined
                              }
                              onClick={() => openWorkspaceSession(session.id)}
                            >
                              <SessionActivityIcon
                                running={sessionRunning}
                                label={workbenchText(
                                  authLocale,
                                  sessionRunning ? "running" : "idle",
                                )}
                              />
                              <span className="session-copy">
                                <strong>{session.name}</strong>
                                <small>
                                  {session.branch !== "—" && (
                                    <>
                                      {session.branch} <span>·</span>{" "}
                                    </>
                                  )}
                                  {formatTime(session.updated_at, authLocale)}
                                </small>
                              </span>
                            </button>
                          );
                        })}
                        {(!page?.loaded || page.cursor !== null) && (
                          <button className="session-item" disabled={page?.loading || !deviceOnline}
                            onClick={() => void loadProjectPage(pageKey, group.cwd)}>
                            {page?.loading ? workbenchText(authLocale, "loading") : page?.failed ? workbenchText(authLocale, "retry") : projectText(authLocale, "loadMore")}
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                );
              })
            ) : (
              <div className="empty-session-state">
                <strong>
                  {workbenchText(authLocale, "waitingForSessions")}
                </strong>
                <small>
                  {workbenchText(authLocale, "waitingForSessionsDetail", {
                    agent: agentName,
                  })}
                </small>
              </div>
            )}
          </div>
          <div className="sidebar-spacer" />
          <div className="relay-card">
            <div className="relay-card-top">
              <span className="device-icon">▱</span>
              <div>
                <strong>{workbenchText(authLocale, "localRelay")}</strong>
                <small>
                  {agentOnline
                    ? workbenchText(authLocale, "agentConnected", {
                        agent: agentName,
                      })
                    : deviceOnline
                      ? workbenchText(authLocale, "agentDisconnected", {
                          agent: agentName,
                        })
                      : workbenchText(authLocale, "waitingOutbound")}
                </small>
              </div>
              <span
                className={deviceOnline ? "online-dot" : "session-status idle"}
              />
            </div>
            <div className="relay-meter">
              <span style={{ width: deviceOnline ? "100%" : "8%" }} />
            </div>
            <p>
              {workbenchText(authLocale, "ackAndQueue", {
                ack: snapshot?.ack_seq ?? 0,
                count: snapshot?.queued_commands ?? 0,
              })}
            </p>
          </div>
          <footer className="sidebar-support-footer">
            <p className="product-compatibility">
              <span>
                <WorkbenchTextWithTechnicalValue
                  locale={authLocale}
                  copyKey="productVersion"
                  variable="version"
                  value={RELAYUNE_WEB_RELEASE_VERSION}
                  variables={{ platform: "Web" }}
                />
              </span>
              <span>
                <WorkbenchTextWithTechnicalValue
                  locale={authLocale}
                  copyKey="minimumDesktopVersion"
                  variable="version"
                  value={RELAYUNE_COMPATIBILITY.web.minimumDesktopVersion}
                />
              </span>
            </p>
            {instance?.auth_mode === "username" ? <InstancePublicLinks locale={authLocale} /> : <>
            <a href="mailto:giraffetree1@gmail.com">
              {workbenchText(authLocale, "support")}: {" "}
              <TechnicalValue>giraffetree1@gmail.com</TechnicalValue>
            </a>
            <nav aria-label={workbenchText(authLocale, "productLegalInfo")}>
              <a href={publicDocumentPath(authLocale, "legal/terms")}>
                {workbenchText(authLocale, "terms")}
              </a>
              <a href={publicDocumentPath(authLocale, "legal/privacy")}>
                {workbenchText(authLocale, "privacy")}
              </a>
            </nav>
            </>}
          </footer>
          <div className="account-menu-container sidebar-account" ref={accountMenuContainerRef}>
            <button
              ref={accountMenuButtonRef}
              className="avatar-button sidebar-account-button"
              type="button"
              aria-label={workbenchText(authLocale, "openAccountMenu")}
              aria-controls="account-menu"
              aria-expanded={accountMenuOpen}
              aria-haspopup="dialog"
              disabled={loggingOut}
              onClick={() => setAccountMenuOpen((open) => !open)}
            >
              <span className="sidebar-account-avatar" aria-hidden="true">{email.slice(0, 1).toUpperCase() || "R"}</span>
              <span className="sidebar-account-copy">
                <strong dir="ltr" title={email}>{email}</strong>
                <small>{workbenchText(authLocale, "accountMenu")}</small>
              </span>
              <span className="sidebar-account-chevron" aria-hidden="true">{accountMenuOpen ? "⌄" : "⌃"}</span>
            </button>
            {accountMenuOpen && (
              <div
                className="account-menu"
                id="account-menu"
                role="dialog"
                aria-label={workbenchText(authLocale, "accountMenu")}
              >
                <p className="account-menu-label" role="presentation">
                  {workbenchText(authLocale, "signedInAs")}
                </p>
                <p
                  className="account-menu-email technical-ltr"
                  role="presentation"
                  title={isolateTechnicalText(email)}
                  dir="ltr"
                >
                  {email}
                </p>
                <button
                  className="account-menu-sign-out"
                  type="button"
                  aria-busy={loggingOut}
                  disabled={loggingOut}
                  onClick={() => void logout()}
                >
                  {authText(authLocale, loggingOut ? "signingOut" : "signOut")}
                </button>
                {logoutError}
              </div>
            )}
          </div>
        </aside>

        {projectDrawerOpen && (
          <button
            className="mobile-drawer-backdrop"
            type="button"
            aria-label={workbenchText(authLocale, "closeProjectDrawer")}
            onClick={closeProjectDrawer}
          />
        )}

        <section
          className={`conversation ${mobilePanel === "workspace" ? "mobile-visible" : ""}`}
        >
          <header className="conversation-header">
            <div>
              {current?.is_subagent && current.root_session_id && (
                <button
                  className="agent-back-button"
                  onClick={() => openWorkspaceSession(current.root_session_id!)}
                >
                  {workbenchText(authLocale, "backToMainThread")}
                </button>
              )}
              <div className="conversation-title-row">
                <h1 ref={workspaceTitleRef} tabIndex={-1}>
                  {current?.name ??
                    workbenchText(authLocale, "waitingForRelay")}
                </h1>
                {current?.is_subagent && (
                  <span className="subagent-pill">
                    {current.agent_role ??
                      workbenchText(authLocale, "subagentRole")}
                  </span>
                )}
                {current && (
                  <span
                    className={`provider-pill ${provider}`}
                    title={agentName}
                  >
                    {agentName}
                  </span>
                )}
                <SessionStatus
                  key={isRunning ? (runningStartedAt ?? "running") : "idle"}
                  running={isRunning}
                  deviceOnline={deviceOnline}
                  startedAt={runningStartedAt}
                  locale={authLocale}
                />
                {current?.sync_state === "persisted" && (
                  <span
                    className="sync-pill"
                    title={workbenchText(authLocale, "persistedTitle", {
                      agent: agentName,
                    })}
                  >
                    {workbenchText(authLocale, "persisted", {
                      agent: agentName,
                    })}
                  </span>
                )}
              </div>
              <div className="repo-line">
                <span className="folder-icon">▱</span>
                <span>
                  {current?.cwd ? (
                    <TechnicalValue>{current.cwd}</TechnicalValue>
                  ) : (
                    workbenchText(authLocale, "workspaceNotSynced")
                  )}
                </span>
                {current && (
                  <>
                    <span className="repo-separator">/</span>
                    <span>⑂ <TechnicalValue>{current.branch}</TechnicalValue></span>
                  </>
                )}
              </div>
            </div>
            <div className="conversation-actions">
              <button
                className="icon-button"
                aria-label={workbenchText(authLocale, "refreshHistory")}
                onClick={() =>
                  current && void loadHistory(current.id, null, true)
                }
              >
                <Icon>↻</Icon>
              </button>
            </div>
          </header>

          <ConversationViewport
            sessionId={activeSession}
            viewportRef={messageScroll}
            followsLatest={messageScrollFollowsLatest}
            latestLabel={flowText(authLocale, "latest")}
            onScroll={(event) => {
              messageScrollFollowsLatest.current = isConversationNearBottom(
                event.currentTarget,
              );
            }}
          >
            <div
              className="history-toolbar"
              ref={historyStatusRef}
              tabIndex={-1}
              role={
                historyState?.error
                  ? "alert"
                  : historyState
                    ? "status"
                    : undefined
              }
              aria-live={
                historyState?.error
                  ? "assertive"
                  : historyState
                    ? "polite"
                    : undefined
              }
              aria-atomic={historyState ? true : undefined}
              aria-busy={historyState?.loading || undefined}
            >
              {historyState?.error ? (
                <span className="history-error">
                  {workbenchText(authLocale, "historyReadFailedBanner")}
                  <button
                    type="button"
                    onClick={() => {
                      if (!current) return;
                      void loadHistory(current.id, null, true);
                      window.requestAnimationFrame(() => {
                        historyStatusRef.current?.focus({ preventScroll: true });
                      });
                    }}
                    disabled={historyState.loading}
                  >
                    {workbenchText(
                      authLocale,
                      historyState.loading ? "retrying" : "retry",
                    )}
                  </button>
                </span>
              ) : historyState?.loading && !historyState.loaded ? (
                <span className="history-toolbar-loading">
                  <span className="history-loading-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  {workbenchText(authLocale, "readingRecentHistory", {
                    agent: agentName,
                  })}
                </span>
              ) : historyState?.hasMore ? (
                <button
                  onClick={() => {
                    if (!current || !historyState.nextCursor) return;
                    messageScrollFollowsLatest.current = false;
                    void loadHistory(current.id, historyState.nextCursor);
                    window.requestAnimationFrame(() => {
                      historyStatusRef.current?.focus({ preventScroll: true });
                    });
                  }}
                  disabled={historyState.loading}
                >
                  {workbenchText(
                    authLocale,
                    historyState.loading ? "loading" : "loadEarlierHistory",
                  )}
                </button>
              ) : historyState?.loaded ? (
                <span>
                  {workbenchText(authLocale, "availableHistoryShown")}
                </span>
              ) : (
                <span>{workbenchText(authLocale, "historyOnDemand")}</span>
              )}
            </div>
            <div className="day-divider">
              <span />
              <small>
                {workbenchText(authLocale, "sessionHistory", {
                  agent: agentName,
                })}
              </small>
              <span />
            </div>
            {messages.length ? (
              conversationGroups.map((group, index) => (
                <ConversationTurn
                  group={group}
                  email={email}
                  agentName={agentName}
                  runningStartedAt={runningStartedAt}
                  active={
                    isRunning &&
                    (activeTurnId
                      ? group.turnId === activeTurnId
                      : index === conversationGroups.length - 1)
                  }
                  loadAttachment={loadEncryptedAttachment}
                  locale={authLocale}
                  key={group.id}
                />
              ))
            ) : (
              <div
                className={`conversation-empty${
                  historyState?.loading ? " history-reading-state" : ""
                }`}
              >
                {historyState?.loading ? (
                  <span
                    className="history-loading-visual"
                    data-history-loading-visual
                    aria-hidden="true"
                  >
                    <span className="history-loading-orbit" />
                    <span className="history-loading-mark">
                      <Mark size={38} />
                    </span>
                  </span>
                ) : (
                  <span className="empty-mark">
                    <Mark size={28} />
                  </span>
                )}
                <h2>
                  {historyState?.error
                    ? workbenchText(authLocale, "historyUnavailable")
                    : historyState?.loading
                      ? workbenchText(authLocale, "readingHistory")
                      : workbenchText(authLocale, "linkReady")}
                </h2>
                <p>
                  {historyState?.error
                    ? workbenchText(authLocale, "historyRetryDetail", {
                        error: workbenchText(authLocale, "historyReadFailed"),
                      })
                    : historyState?.loading
                      ? workbenchText(authLocale, "historyLoadingDetail")
                      : workbenchText(authLocale, "linkReadyDetail")}
                </p>
                {historyState?.loading && (
                  <span className="history-loading-rail" aria-hidden="true">
                    <i />
                  </span>
                )}
              </div>
            )}
            {!!approvals.length && (
              <section
                className="conversation-approvals"
                id="conversation-approvals"
                ref={approvalSectionRef}
                tabIndex={-1}
                aria-label={workbenchText(authLocale, "approvalBoundary")}
              >
                <header>
                  <strong>{workbenchText(authLocale, "approvalBoundary")}</strong>
                  <small>
                    {workbenchText(authLocale, "pendingCount", {
                      count: pendingCount,
                    })}
                  </small>
                </header>
                <div className="approval-list">
                  {approvals.map((approval) => (
                    <ApprovalCard
                      approval={approval}
                      now={approvalNow}
                      online={deviceOnline}
                      alwaysConfirmKey={approvalAlwaysConfirm}
                      key={approval.approval_id}
                      onRequestAlwaysConfirm={setApprovalAlwaysConfirm}
                      onCancelAlwaysConfirm={() =>
                        setApprovalAlwaysConfirm(null)
                      }
                      onDecide={(decision, optionId, answer) =>
                        void decideApproval(
                          approval,
                          decision,
                          optionId,
                          answer,
                        )
                      }
                      locale={authLocale}
                    />
                  ))}
                </div>
              </section>
            )}
            {isRunning &&
              !freshActiveAgents.length &&
              !hasCurrentAssistantActivity && (
                <article className="message codex">
                  <div className="message-avatar">
                    <Mark size={17} />
                  </div>
                  <div className="message-body">
                    <div className="message-meta">
                      {agentName} · {workbenchText(authLocale, "processing")}
                    </div>
                    <div className="typing-indicator">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                </article>
              )}
          </ConversationViewport>

          <div className="composer-wrap">
            {pendingCount > 0 && (
              <button
                className="composer-approval-notice"
                type="button"
                aria-controls="conversation-approvals"
                onClick={focusConversationApprovals}
              >
                <span>!</span>
                <strong>
                  {workbenchText(authLocale, "approvalWaitingCount", {
                    count: pendingCount,
                  })}
                </strong>
                <small>{workbenchText(authLocale, "viewCommandRisk")}</small>
              </button>
            )}
            {hasSessionSettings && commandPaletteOpen && (
              <KimiCommandPanel
                view={hasKimiCommands ? commandPaletteView : "settings"}
                commands={quickCommands}
                selectedIndex={commandSelection}
                configOptions={kimiConfigOptions}
                session={current}
                activeAgents={freshActiveAgents.length}
                pendingApprovals={pendingCount}
                online={deviceOnline}
                blocked={isRunning}
                executingCommand={executingKimiCommand}
                configuringKey={configuringKey}
                pendingConfirmation={pendingConfigConfirmation}
                settingsOnly={!hasKimiCommands}
                locale={authLocale}
                onClose={() => {
                  setCommandPaletteOpen(false);
                  setPendingConfigConfirmation(null);
                  window.requestAnimationFrame(() => {
                    composerInput.current?.focus();
                  });
                }}
                onViewChange={(view) => {
                  setCommandPaletteView(view);
                  setCommandSelection(0);
                }}
                onRun={runKimiQuickCommand}
                onConfigure={requestKimiConfiguration}
                onConfirmConfiguration={() => {
                  if (pendingConfigConfirmation) {
                    void configureKimiSession(
                      pendingConfigConfirmation.configId,
                      pendingConfigConfirmation.value,
                    );
                  }
                }}
                onCancelConfirmation={() => setPendingConfigConfirmation(null)}
              />
            )}
            {current && inlineAgents.length > 0 && (
              <InlineAgentStatus
                agents={inlineAgents}
                locale={authLocale}
                loading={agentActivityLoading}
                error={agentActivityError}
                openRequest={agentWindowOpenRequest}
                key={current.id}
                onInspectAgent={(agentId) => {
                  const agent = inlineAgents.find(
                    (candidate) => candidate.id === agentId,
                  );
                  if (!agent) return;
                  openAgentActivity(agent);
                }}
              />
            )}
            <form
              className="composer"
              onSubmit={sendMessage}
              aria-busy={sendingMessage || stoppingTurn}
            >
              <input
                ref={attachmentInput}
                className="login-sr-only"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                multiple
                onChange={(event) => void addAttachments(event.target.files)}
                tabIndex={-1}
              />
              {!!pendingAttachments.length && (
                <div className="composer-attachments">
                  {pendingAttachments.map((attachment) => (
                    <span key={attachment.id}>
                      {/* Object URLs are local previews and cannot use the Next image optimizer. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={attachment.previewUrl} alt="" />
                      <b><TechnicalValue>{attachment.name}</TechnicalValue></b>
                      <button
                        type="button"
                        aria-label={workbenchText(
                          authLocale,
                          "removeAttachment",
                          {
                            name: isolateTechnicalText(attachment.name),
                          },
                        )}
                        onClick={() => removePendingAttachment(attachment.id)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <ComposerTextarea
                inputRef={composerInput}
                aria-describedby="composer-keyboard-hint"
                onCompositionStart={() => { composerComposing.current = true; }}
                onCompositionEnd={() => { composerComposing.current = false; }}
                aria-label={workbenchText(authLocale, "sendToAgent", {
                  agent: agentName,
                })}
                aria-controls={
                  hasKimiCommands
                    ? commandPaletteView === "commands"
                      ? "kimi-command-list"
                      : "kimi-command-panel"
                    : hasSessionSettings
                      ? "kimi-command-panel"
                    : undefined
                }
                aria-haspopup={hasKimiCommands ? "listbox" : undefined}
                aria-autocomplete={hasKimiCommands ? "list" : undefined}
                aria-activedescendant={
                  hasKimiCommands &&
                  commandPaletteOpen &&
                  commandPaletteView === "commands" &&
                  activeQuickCommand
                    ? kimiCommandOptionId(activeQuickCommand.name)
                    : undefined
                }
                placeholder={
                  current?.is_subagent
                    ? workbenchText(authLocale, "readonlySubagentPlaceholder")
                    : isRunning && !supportsSteering
                      ? workbenchText(authLocale, "runningNoSteerPlaceholder", {
                          agent: agentName,
                        })
                      : isRunning
                        ? workbenchText(authLocale, "runningSteerPlaceholder", {
                            agent: agentName,
                          })
                        : deviceOnline
                          ? workbenchText(
                              authLocale,
                              "onlineComposerPlaceholder",
                            )
                          : workbenchText(
                              authLocale,
                              "offlineComposerPlaceholder",
                            )
                }
                value={draft}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft(value);
                  if (hasKimiCommands && value.startsWith("/")) {
                    setCommandSelection(0);
                    setCommandPaletteView("commands");
                    setCommandPaletteOpen(true);
                  } else if (commandPaletteView === "commands") {
                    setCommandPaletteOpen(false);
                  }
                }}
                disabled={!current || current.is_subagent}
                onKeyDown={(event) => {
                  if (isComposerComposition(event.nativeEvent, composerComposing.current)) return;
                  if (
                    hasKimiCommands &&
                    commandPaletteOpen &&
                    commandPaletteView === "commands"
                  ) {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setCommandSelection((value) =>
                        Math.min(
                          value + 1,
                          Math.max(0, quickCommands.length - 1),
                        ),
                      );
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setCommandSelection((value) => Math.max(0, value - 1));
                      return;
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setCommandPaletteOpen(false);
                      return;
                    }
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      quickCommands.length
                    ) {
                      event.preventDefault();
                      runKimiQuickCommand(
                        quickCommands[commandSelection] ?? quickCommands[0],
                      );
                      return;
                    }
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <p id="composer-keyboard-hint" className="composer-keyboard-hint">{flowText(authLocale, "input")}</p>
              <div className="composer-footer">
                <div className="composer-tools">
                  <button
                    type="button"
                    className="slash-button"
                    aria-label={workbenchText(authLocale, "addAttachment")}
                    onClick={() => {
                      attachmentInput.current?.click();
                    }}
                    disabled={!current || current.is_subagent || current.provider === "mcode" || sendingMessage}
                  >
                    <Icon>＋</Icon>
                  </button>
                  {hasKimiCommands && (
                    <button
                      type="button"
                      className="slash-button"
                      aria-label={workbenchText(authLocale, "openKimiCommands")}
                      onClick={() => {
                        setCommandSelection(0);
                        setCommandPaletteView("commands");
                        setCommandPaletteOpen(
                          (open) => !open || commandPaletteView !== "commands",
                        );
                        window.requestAnimationFrame(() =>
                          composerInput.current?.focus(),
                        );
                      }}
                    >
                      <Icon>/</Icon>
                    </button>
                  )}
                  <button
                    type="button"
                    className="mode-button permission-mode-button"
                    onClick={() => {
                      if (hasSessionSettings) {
                        setCommandPaletteView("settings");
                        setCommandPaletteOpen(true);
                      } else {
                        setToast(
                          workbenchText(authLocale, "inheritedSecurityToast"),
                        );
                      }
                    }}
                  >
                    <Icon>◫</Icon>
                    {(provider === "codex" || provider === "claude") && hasSessionSettings
                      ? workbenchText(authLocale, "runtimeSettings")
                      : hasSessionSettings
                      ? kimiModeLabel(
                          kimiSettingValue(
                            kimiModeConfig,
                            current?.permission_mode,
                            "default",
                          ),
                          authLocale,
                        )
                      : workbenchText(
                          authLocale,
                          current?.is_subagent
                            ? "subagentThread"
                            : "mainThread",
                        )}
                    <span>
                      {(provider === "codex" || provider === "claude") && hasSessionSettings
                        ? (codexPermissionConfig?.options?.find(option => option.value === codexPermissionConfig.currentValue)?.name ?? (workbenchText(authLocale, "permissionsUnconfirmed")))
                        : hasSessionSettings
                        ? pendingCount
                          ? workbenchText(authLocale, "approvalCountShort", {
                              count: pendingCount,
                            })
                          : workbenchText(authLocale, "acpLive")
                        : workbenchText(authLocale, "inheritedPermissions")}
                    </span>
                  </button>
                </div>
                <div className="composer-actions">
                  {isRunning && canInterrupt && !current?.is_subagent && (
                    <button
                      className="stop-button"
                      type="button"
                      ref={stopTurnButtonRef}
                      onClick={() => void interruptTurn()}
                      aria-disabled={stoppingTurn || undefined}
                      aria-busy={stoppingTurn}
                      aria-label={workbenchText(
                        authLocale,
                        stoppingTurn ? "requestingStop" : "stopCurrentTask",
                      )}
                    >
                      ■
                    </button>
                  )}
                  <button
                    className="send-button"
                    type="submit"
                    disabled={
                      stoppingTurn ||
                      sendingMessage ||
                      (!draft.trim() && !pendingAttachments.length) ||
                      !current ||
                      current.is_subagent ||
                      (isRunning && !supportsSteering)
                    }
                    aria-busy={sendingMessage}
                    aria-label={workbenchText(
                      authLocale,
                      sendingMessage
                        ? "sendingMessage"
                        : isRunning
                          ? "steerCurrentTask"
                          : "send",
                    )}
                  >
                    ↑
                  </button>
                </div>
              </div>
            </form>
            <p
              className="login-sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {stoppingTurn
                ? workbenchText(authLocale, "requestingStop")
                : executingKimiCommand
                  ? workbenchText(authLocale, "runningKimiCommand", {
                      command: isolateTechnicalText(executingKimiCommand),
                    })
                  : sendingMessage
                    ? workbenchText(authLocale, "sendingMessage")
                    : ""}
            </p>
            <p className="composer-hint">
              {current?.is_subagent
                ? workbenchText(authLocale, "readonlySubagentHint", {
                    agent: agentName,
                  })
                : isRunning && !supportsSteering
                  ? provider === "kimi"
                    ? canInterrupt
                      ? workbenchText(authLocale, "kimiNoSteerHint")
                      : workbenchText(authLocale, "localKimiTaskHint")
                    : workbenchText(authLocale, "runningStopBeforeSend", {
                        agent: agentName,
                      })
                  : isRunning
                    ? workbenchText(authLocale, "steeringHint")
                    : workbenchText(authLocale, "idleComposerHint")}
            </p>
          </div>
        </section>

        <aside
          className={`activity-panel ${mobilePanel === "activity" ? "mobile-visible" : ""}`}
        >
          <button
            className="mobile-activity-back"
            type="button"
            onClick={() => setMobilePanel("workspace")}
          >
            ← {workbenchText(authLocale, "workspace")}
          </button>
            <div
              className="panel-content"
              id="right-panel-activity"
              tabIndex={0}
            >
              <div className="panel-heading">
                <span>{workbenchText(authLocale, "approvalBoundary")}</span>
                <small>
                  {workbenchText(authLocale, "pendingCount", {
                    count: pendingCount,
                  })}
                </small>
              </div>
              <div className="approval-list">
                {approvals.length ? (
                  <button
                    className="approval-conversation-link"
                    type="button"
                    aria-controls="conversation-approvals"
                    onClick={focusConversationApprovals}
                  >
                    <span>!</span>
                    <strong>
                      {workbenchText(authLocale, "approvalWaitingCount", {
                        count: pendingCount,
                      })}
                    </strong>
                    <small>
                      {workbenchText(
                        authLocale,
                        "viewApprovalInConversation",
                      )}
                    </small>
                  </button>
                ) : (
                  <div className="panel-empty">
                    <Icon>◇</Icon>
                    <strong>
                      {workbenchText(authLocale, "noPendingApprovals")}
                    </strong>
                    <small>
                      {workbenchText(authLocale, "approvalEmptyDetail")}
                    </small>
                  </div>
                )}
              </div>
              <div className="panel-heading recent-heading">
                <span>{workbenchText(authLocale, "reliabilityStatus")}</span>
              </div>
              <div className="timeline">
                <div className="timeline-item">
                  <span
                    className={`timeline-mark ${deviceOnline ? "success" : "neutral"}`}
                  >
                    {deviceOnline ? "✓" : "×"}
                  </span>
                  <div>
                    <strong>
                      {workbenchText(authLocale, "relayOutbound")}
                    </strong>
                    <p>
                      {workbenchText(
                        authLocale,
                        deviceOnline
                          ? "httpsAuthenticated"
                          : "currentlyOffline",
                      )}
                    </p>
                    <small>{formatTime(deviceLastSeenAt, authLocale)}</small>
                  </div>
                </div>
                <div className="timeline-item">
                  <span className="timeline-mark branch">↕</span>
                  <div>
                    <strong>
                      {workbenchText(authLocale, "eventAckCursor")}
                    </strong>
                    <p>ack_seq = {snapshot?.ack_seq ?? 0}</p>
                    <small>
                      {workbenchText(authLocale, "deviceSequenceDedup")}
                    </small>
                  </div>
                </div>
                <div className="timeline-item">
                  <span className="timeline-mark neutral">⌁</span>
                  <div>
                    <strong>
                      {workbenchText(authLocale, "offlineCommands")}
                    </strong>
                    <p>
                      {workbenchText(authLocale, "queuedCount", {
                        count: snapshot?.queued_commands ?? 0,
                      })}
                    </p>
                    <small>
                      {workbenchText(authLocale, "approvalsNeverQueued")}
                    </small>
                  </div>
                </div>
              </div>
            </div>
          <footer className="encryption-note">
            <Icon>◇</Icon>
            <div>
              <strong>
                {workbenchText(
                  authLocale,
                  deviceOnline ? "localLinkAuthenticated" : "waitingForRelay",
                )}
              </strong>
              <small>{workbenchText(authLocale, "encryptedLinkDetail")}</small>
            </div>
          </footer>
        </aside>
      </div>
      {visibleToast && (
        <div className="toast" role="status" aria-live="polite">
          {visibleToast}
        </div>
      )}
    </main>
  );
}

function upsertMessage(
  setter: React.Dispatch<React.SetStateAction<Record<string, Message[]>>>,
  sessionId: string,
  message: Message,
  append = false,
) {
  setter((previous) => {
    const messages = previous[sessionId] ?? [];
    const index = messages.findIndex(
      (candidate) => sameMessageIdentity(candidate, message),
    );
    if (index === -1) {
      return { ...previous, [sessionId]: [...messages, message] };
    }
    const next = [...messages];
    next[index] = {
      ...next[index],
      ...message,
      content: append
        ? `${next[index].content}${message.content}`
        : message.content,
    };
    return { ...previous, [sessionId]: next };
  });
}

const TOOL_ACTIVITY_DETAIL_LIMIT = 12_000;

function upsertToolActivityMessage(
  setter: React.Dispatch<React.SetStateAction<Record<string, Message[]>>>,
  sessionId: string,
  event: RelayEvent["event"],
  turnId: string,
  createdAt: string,
  fallbackLabel: string,
  meta: string,
  locale: AuthLocale,
) {
  const id = toolActivityMessageId(event, turnId);
  setter((previous) => {
    const messages = previous[sessionId] ?? [];
    const index = messages.findIndex((candidate) => candidate.id === id);
    const current = index >= 0 ? messages[index] : undefined;
    const status = toolActivityStatus(event) as ToolActivityStatus;
    const mergedActivity = {
      ...event,
      activity_type: event.activity_type ?? current?.toolActivity?.type,
      activity_name: event.activity_name ?? current?.toolActivity?.name,
      activity_subject:
        event.activity_subject ?? current?.toolActivity?.subject,
      activity_count: event.activity_count ?? current?.toolActivity?.count,
      command: event.command ?? current?.toolActivity?.command,
    };
    const incomingDetail = event.text ?? "";
    const previousDetail = current?.toolActivity?.detail ?? "";
    const detail = (
      status === "running"
        ? `${previousDetail}${incomingDetail}`
        : incomingDetail || previousDetail
    ).slice(-TOOL_ACTIVITY_DETAIL_LIMIT);
    const message: Message = {
      id,
      role: "system",
      content: "",
      kind: event.kind,
      meta: current?.meta ?? meta,
      createdAt: current?.createdAt ?? createdAt,
      source: "live",
      turnId,
      toolActivity: {
        label: toolActivityLabel(
          mergedActivity,
          current?.toolActivity?.label ?? fallbackLabel,
          locale,
        ),
        detail,
        status,
        type: mergedActivity.activity_type,
        name: mergedActivity.activity_name,
        subject: mergedActivity.activity_subject,
        count: mergedActivity.activity_count,
        command: mergedActivity.command,
      },
    };
    if (index < 0) {
      return { ...previous, [sessionId]: [...messages, message] };
    }
    const next = [...messages];
    next[index] = message;
    return { ...previous, [sessionId]: next };
  });
}

function toHistoryMessage(
  message: HistoryMessage,
  assistantName = "Codex",
  locale: AuthLocale = "zh-CN",
): Message {
  const historicalToolActivity =
    message.kind === "tool_activity" || message.tool_activity_label
      ? {
          label: toolActivityLabel(
            {
              activity_type: message.tool_activity_type,
              activity_name: message.tool_activity_name,
              activity_subject: message.tool_activity_subject,
              activity_count: message.tool_activity_count,
            },
            message.tool_activity_label ??
              workbenchText(locale, "localOperation"),
            locale,
          ),
          detail: message.tool_activity_detail ?? "",
          status: message.tool_activity_status ?? "completed",
          type: message.tool_activity_type,
          name: message.tool_activity_name,
          subject: message.tool_activity_subject,
          count: message.tool_activity_count,
          command: message.tool_activity_command,
        }
      : undefined;
  const author =
    message.role === "user"
      ? workbenchText(locale, "historyYou")
      : message.role === "system"
        ? workbenchText(locale, "historyPlan")
        : assistantName;
  return {
    id: message.id,
    clientMessageId: message.client_message_id,
    role: message.role,
    content: message.content,
    kind: message.kind,
    meta: historicalToolActivity
      ? workbenchText(locale, "toolActivityMeta", {
          time: formatTime(message.created_at, locale),
        })
      : `${author} · ${
          message.role === "user"
            ? formatMessageTimestamp(message.created_at, locale)
            : formatTime(message.created_at, locale)
        }`,
    createdAt: message.created_at,
    source: "history",
    turnId: message.turn_id,
    attachments: message.attachments ?? [],
    toolActivity: historicalToolActivity,
  };
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]) {
  const merged = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    merged.set(item.id, { ...merged.get(item.id), ...item });
  }
  return [...merged.values()];
}

function isSessionRunning(session: Session) {
  return isSessionStatusRunning(session);
}

function isFreshActiveAgent(agent: Agent) {
  if (!["pendingInit", "running"].includes(agent.status)) return false;
  const activityAt = agent.updated_at ?? agent.started_at;
  const updatedAt = activityAt ? Date.parse(activityAt) : Number.NaN;
  return (
    Number.isFinite(updatedAt) &&
    Date.now() - updatedAt <= LOCAL_AGENT_ACTIVE_FRESHNESS_MS
  );
}


function prependHistory(history: Message[], current: Message[]) {
  return dedupeMessages([...history, ...current]);
}

function dedupeMessages(messages: Message[]) {
  const ids = new Set<string>();
  return messages.filter((message) => {
    if (ids.has(message.id)) return false;
    ids.add(message.id);
    return true;
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("File read failed."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const separator = result.indexOf(",");
      if (separator < 0) {
        reject(new Error("File data URL is invalid."));
        return;
      }
      resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}
