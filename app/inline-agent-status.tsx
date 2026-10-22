"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { flowText } from "./flow-language";
import type { AuthLocale } from "./auth-language";
import { workbenchText } from "./workbench-language";
import { formatCompactNumber, formatDurationSeconds } from "./locale-format";

type InlineAgentStatusValue =
  | "unknown"
  | "pendingInit"
  | "running"
  | "interrupted"
  | "completed"
  | "errored"
  | "shutdown"
  | "notFound";

type InlineAgentActivity = {
  id: string;
  kind: "status" | "tool" | "command" | "progress";
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

export type InlineAgent = {
  id: string;
  name: string;
  role?: string | null;
  task: string;
  status: InlineAgentStatusValue;
  model?: string | null;
  reasoning_effort?: string | null;
  summary?: string | null;
  tool?: string | null;
  progress?: number;
  current_activity?: string | null;
  tool_count?: number | null;
  token_count?: number | null;
  context_tokens?: number | null;
  activity_log?: InlineAgentActivity[];
  started_at?: string;
  updated_at?: string;
};

type InlineAgentStatusProps = {
  agents: InlineAgent[];
  locale: AuthLocale;
  loading?: boolean;
  error?: string | null;
  openRequest?: number;
  onInspectAgent?: (agentId: string) => void;
};

const ACTIVE_STATUSES = new Set<InlineAgentStatusValue>([
  "pendingInit",
  "running",
]);

export default function InlineAgentStatus({
  agents,
  locale,
  loading = false,
  error = null,
  openRequest = 0,
  onInspectAgent,
}: InlineAgentStatusProps) {
  const [expanded, setExpanded] = useState(openRequest > 0);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [now, setNow] = useState(() => latestAgentTimestamp(agents));
  const toggleRef = useRef<HTMLButtonElement>(null);
  const lastOpenRequest = useRef(openRequest);
  const activeAgents = useMemo(
    () => agents.filter((agent) => ACTIVE_STATUSES.has(agent.status)),
    [agents],
  );

  useEffect(() => {
    if (!activeAgents.length) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [activeAgents.length]);

  useEffect(() => {
    if (openRequest > lastOpenRequest.current) {
      setExpanded(true);
      setSelectedAgentId(null);
    }
    lastOpenRequest.current = openRequest;
  }, [openRequest]);

  useEffect(() => {
    if (!expanded) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (selectedAgentId) {
        setSelectedAgentId(null);
      } else {
        setExpanded(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [expanded, selectedAgentId]);

  if (!agents.length) return null;
  const waveStartedAt = earliestStartedTimestamp(activeAgents);
  const waveDuration = formatDuration(
    waveStartedAt === null
      ? undefined
      : new Date(waveStartedAt).toISOString(),
    now,
    locale,
  );
  const visibleAgents = agents.slice(0, 3);
  const hiddenCount = agents.length - visibleAgents.length;
  const featuredAgent =
    activeAgents.find((agent) => agent.current_activity?.trim()) ??
    activeAgents[0] ?? agents[0];
  const featuredActivity = agentCurrentActivity(featuredAgent, locale) ?? featuredAgent.task;
  const selectedAgent = selectedAgentId
    ? (agents.find((agent) => agent.id === selectedAgentId) ?? null)
    : null;
  const disclosureId = `inline-agent-window-${agents
    .map((agent) => agent.id)
    .join("-")}`;

  return (
    <section
      className={`inline-agent-status ${activeAgents.length ? "running" : "settled"}${expanded ? " expanded" : ""}${selectedAgent ? " detail-open" : ""}`}
      data-agent-count={agents.length}
    >
      <div
        className="inline-agent-window"
        id={disclosureId}
        hidden={!expanded}
      >
        {selectedAgent ? (
          <InlineAgentDetail
            agent={selectedAgent}
            now={now}
            locale={locale}
            loading={loading}
            error={error}
            onBack={() => setSelectedAgentId(null)}
          />
        ) : (
          <>
            <div className="inline-agent-window-heading">
              <div>
                <strong>{workbenchText(locale, "inlineWindowTitle")}</strong>
                <small>{workbenchText(locale, "inlinePrivacy")}</small>
              </div>
              <span>{agents.length}</span>
            </div>
            <div className="inline-agent-list">
              {agents.map((agent) => (
                <InlineAgentRow
                  agent={agent}
                  now={now}
                  locale={locale}
                  onOpen={() => {
                    setSelectedAgentId(agent.id);
                    onInspectAgent?.(agent.id);
                  }}
                  key={agent.id}
                />
              ))}
            </div>
            {hiddenCount > 0 && (
              <p className="inline-agent-more">
                {workbenchText(locale, "inlineBackgroundAgents", {
                  count: hiddenCount,
                })}
              </p>
            )}
          </>
        )}
      </div>
      <button
        ref={toggleRef}
        className="inline-agent-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={disclosureId}
        onClick={() => {
          setExpanded((current) => !current);
          if (expanded) setSelectedAgentId(null);
        }}
      >
        <span className="inline-agent-summary-icon" aria-hidden="true">
          <i />
        </span>
        <span className="inline-agent-header-copy">
          <strong role="status" aria-live="polite" aria-atomic="true">
            {activeAgents.length
              ? workbenchText(locale, "inlineAgentsRunning", { count: activeAgents.length })
              : flowText(locale, "records", agents.length)}
          </strong>
          <small title={`${featuredAgent.name} · ${featuredActivity}`}>
            {activeAgents.length ? `${featuredAgent.name} · ${featuredActivity}` : flowText(locale, "review")}
          </small>
        </span>
        <span className="inline-agent-avatars" aria-hidden="true">
          {visibleAgents.map((agent) => (
            <span className="inline-agent-avatar" key={agent.id}>
              {agentInitial(agent.name)}
            </span>
          ))}
          {hiddenCount > 0 && (
            <span className="inline-agent-avatar more">+{hiddenCount}</span>
          )}
        </span>
        <span className="inline-agent-toggle-meta" aria-live="off">
          {!activeAgents.length ? workbenchText(locale, "taskEnded") : waveDuration
            ? workbenchText(locale, "runningElapsed", { elapsed: waveDuration })
            : workbenchText(locale, "inlineJustStarted")}
        </span>
        <span className="inline-agent-chevron" aria-hidden="true">
          ⌃
        </span>
      </button>
    </section>
  );
}

function InlineAgentRow({
  agent,
  now,
  locale,
  onOpen,
}: {
  agent: InlineAgent;
  now: number;
  locale: AuthLocale;
  onOpen: () => void;
}) {
  const duration = formatDuration(agent.started_at, agentDurationEnd(agent, now), locale);
  const activity = agentCurrentActivity(agent, locale);
  return (
    <button className={`inline-agent-row ${agent.status}`} onClick={onOpen}>
      <span className="inline-agent-row-avatar" aria-hidden="true">
        {agentInitial(agent.name)}
        <i />
      </span>
      <span className="inline-agent-row-body">
        <span className="inline-agent-row-title">
          <strong title={agent.task}>{agent.task.trim() || agent.name}</strong>
          <span>{agentStatusLabel(agent.status, locale)}</span>
          {duration && (
            <time aria-live="off">
              {workbenchText(locale, "runningElapsed", { elapsed: duration })}
            </time>
          )}
        </span>
        <small className="inline-agent-metadata">{agent.name}</small>
        {activity && (
          <span className="inline-agent-current" title={activity}>
            <b>{workbenchText(locale, "currentActivity")}</b>
            {activity}
          </span>
        )}
      </span>
      <span className="inline-agent-open" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

function InlineAgentDetail({
  agent,
  now,
  locale,
  loading,
  error,
  onBack,
}: {
  agent: InlineAgent;
  now: number;
  locale: AuthLocale;
  loading: boolean;
  error: string | null;
  onBack: () => void;
}) {
  const activities = agent.activity_log ?? [];
  const activity = agentCurrentActivity(agent, locale);
  const duration = formatDuration(agent.started_at, agentDurationEnd(agent, now), locale);
  const metrics = [
    agent.tool_count != null
      ? `${new Intl.NumberFormat(locale).format(agent.tool_count)} tools`
      : "",
    agent.token_count != null
      ? `${formatCompactNumber(agent.token_count, locale)} tok`
      : "",
    agent.context_tokens != null
      ? workbenchText(locale, "contextMetric", {
          value: formatCompactNumber(agent.context_tokens, locale),
        })
      : "",
  ].filter(Boolean);
  return (
    <div className="inline-agent-detail">
      <header>
        <button type="button" onClick={onBack}>
          ← {workbenchText(locale, "inlineBackToAgents")}
        </button>
        <span>{agentStatusLabel(agent.status, locale)}</span>
      </header>
      <div className="inline-agent-detail-scroll">
        <div className="inline-agent-detail-identity">
          <span>{agentInitial(agent.name)}</span>
          <div>
            <strong>{agent.name}</strong>
            <small>
              {[agent.role, agent.model, agent.reasoning_effort]
                .filter((value) => value?.trim())
                .join(" · ") || workbenchText(locale, "subagentRole")}
              {duration
                ? ` · ${workbenchText(locale, "runningElapsed", { elapsed: duration })}`
                : ""}
            </small>
          </div>
        </div>
        <section className="inline-agent-detail-task">
          <span>{workbenchText(locale, "agentTaskPrefix")}</span>
          <p>{agent.task}</p>
        </section>
        {activity && (
          <section className="inline-agent-detail-current">
            <span>{workbenchText(locale, "currentActivity")}</span>
            <p>{activity}</p>
          </section>
        )}
        {agent.summary?.trim() && (
          <section className="inline-agent-detail-result">
            <strong>{workbenchText(locale, "agentResultPrefix")}</strong>
            <p>{agent.summary}</p>
          </section>
        )}
        {metrics.length > 0 && (
          <div className="inline-agent-detail-metrics">
            {metrics.map((metric) => (
              <span key={metric}>{metric}</span>
            ))}
          </div>
        )}
        <section className="inline-agent-detail-timeline">
          <div>
            <strong>{workbenchText(locale, "agentActivityTitle")}</strong>
            {loading && (
              <small role="status">
                {workbenchText(locale, "agentActivityRefreshing")}
              </small>
            )}
          </div>
          {activities.map((activity) => (
            <article className={activity.kind} key={activity.id}>
              <span aria-hidden="true">
                {["tool", "command"].includes(activity.kind) ? "⌘" : "•"}
              </span>
              <p>{agentActivityLabel(activity, locale)}</p>
              <time>{formatTime(activity.occurred_at, locale)}</time>
            </article>
          ))}
          {!activities.length && !loading && !error && (
            <p className="inline-agent-detail-empty">
              {workbenchText(locale, "agentActivityEmpty")}
            </p>
          )}
          {error && <p className="inline-agent-detail-error">{error}</p>}
        </section>
      </div>
    </div>
  );
}

function agentCurrentActivity(agent: InlineAgent, locale: AuthLocale) {
  if (agent.current_activity?.trim()) return agent.current_activity.trim();
  const latest = agent.activity_log?.at(-1);
  return latest ? agentActivityLabel(latest, locale).trim() || null : null;
}

function agentActivityLabel(
  activity: InlineAgentActivity,
  locale: AuthLocale,
) {
  if (activity.code === "task_received") {
    return workbenchText(locale, "agentActivityTaskReceived");
  }
  if (activity.code === "started") {
    return workbenchText(locale, "agentActivityStarted");
  }
  if (activity.code === "plan_progress") {
    return workbenchText(locale, "agentActivityPlanProgress", {
      completed: activity.completed ?? 0,
      total: activity.total ?? 0,
    });
  }
  if (activity.code === "completed") {
    return workbenchText(locale, "agentActivityCompleted");
  }
  if (activity.code === "stopped") {
    return workbenchText(locale, "agentActivityStopped");
  }
  if (activity.code === "failed") {
    return workbenchText(locale, "agentActivityFailed");
  }
  if (activity.code === "step_completed") {
    return workbenchText(locale, "agentActivityStepCompleted");
  }
  return activity.label;
}

function agentStatusLabel(status: InlineAgentStatusValue, locale: AuthLocale) {
  if (status === "unknown") return workbenchText(locale, "agentStatusUnknown");
  if (status === "pendingInit") return workbenchText(locale, "agentPreparing");
  if (status === "running") return workbenchText(locale, "running");
  if (status === "completed") return workbenchText(locale, "agentCompleted");
  if (status === "shutdown") return workbenchText(locale, "agentClosed");
  if (status === "interrupted") return workbenchText(locale, "agentStopped");
  if (status === "notFound") return workbenchText(locale, "agentUnavailable");
  return workbenchText(locale, "agentFailed");
}

function earliestStartedTimestamp(agents: InlineAgent[]) {
  const timestamps = agents
    .map((agent) => parseTimestamp(agent.started_at))
    .filter((value): value is number => value !== null);
  return timestamps.length ? Math.min(...timestamps) : null;
}

function latestAgentTimestamp(agents: InlineAgent[]) {
  const timestamps = agents
    .flatMap((agent) => [
      parseTimestamp(agent.updated_at),
      parseTimestamp(agent.started_at),
    ])
    .filter((value): value is number => value !== null);
  return timestamps.length ? Math.max(...timestamps) : 0;
}

// Finished records keep their own end time even while siblings keep running.
function agentDurationEnd(agent: InlineAgent, now: number) {
  if (ACTIVE_STATUSES.has(agent.status)) return now;
  const end = [...(agent.activity_log ?? [])].reverse().find((activity) =>
    ["completed", "stopped", "failed"].includes(activity.code ?? ""),
  );
  return parseTimestamp(end?.occurred_at) ?? parseTimestamp(agent.updated_at) ?? parseTimestamp(agent.started_at) ?? 0;
}

function parseTimestamp(value?: string) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatDuration(
  startedAt: string | undefined,
  finishedAt: number,
  locale: AuthLocale,
) {
  const started = parseTimestamp(startedAt);
  if (started === null) return "";
  const seconds = Math.max(0, Math.floor((finishedAt - started) / 1_000));
  return formatDurationSeconds(seconds, locale);
}

function formatTime(value: string, locale: AuthLocale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function agentInitial(name: string) {
  return [...name.trim()][0]?.toUpperCase() ?? "A";
}
