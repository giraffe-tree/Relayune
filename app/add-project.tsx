"use client";
import { useEffect, useRef, useState } from "react";
import type { SavedProjectRecord as ProjectRecord } from "./session-projects";
export type { AgentProvider as ProjectProvider } from "../shared/agent-order";
import type { AgentProvider as ProjectProvider } from "../shared/agent-order";
type SavedProjectRecord = Omit<ProjectRecord, "provider"> & {
  provider: ProjectProvider;
};

export const projectCopy = {
  title: ["新增项目", "Add project"],
  new: ["新建文件夹", "New folder"],
  existing: ["已有文件夹", "Existing folder"],
  name: ["项目名称", "Project name"],
  location: ["保存位置", "Save location"],
  parents: [
    "选择已有项目的父目录",
    "Choose a parent folder of an existing project",
  ],
  browse: ["浏览其他位置", "Browse locations"],
  refresh: ["刷新位置", "Refresh locations"],
  more: ["更多已有位置", "More locations"],
  create: ["创建项目", "Create project"],
  add: ["添加项目", "Add project"],
  cancel: ["关闭", "Close"],
  back: ["返回", "Back"],
  select: ["选择此文件夹", "Select this folder"],
  working: ["正在处理…", "Working…"],
  online: ["在线", "Online"],
  offline: [
    "电脑离线，连接后可创建",
    "Computer offline. Reconnect to create a project.",
  ],
  local: ["文件保存在这台电脑上", "Files stay on this computer"],
  empty: [
    "没有可用位置，请检查电脑上的文件夹是否存在及系统访问权限，然后刷新。",
    "No available locations. Check that the folders exist and the computer allows access, then refresh.",
  ],
  ready: ["项目已就绪", "Project ready"],
  coworkStart: ["请在 Claude Desktop 中选择此文件夹新建会话，再回到 Relayune 继续。", "Create a session with this folder in Claude Desktop, then return to Relayune."],
  prompt: [
    "想在这个项目里做什么？",
    "What would you like to do in this project?",
  ],
  start: ["开始任务", "Start task"],
  retry: ["重试并确认结果", "Retry and check result"],
  taskFailed: [
    "任务尚未确认，请到项目会话中查看后再试。",
    "Task not confirmed. Check the project's sessions before retrying.",
  ],
  unsupported: [
    "当前 Agent 或电脑版不支持新增项目，请更新电脑版后重试。",
    "This agent or desktop version does not support adding projects. Update the desktop app and retry.",
  ],
  invalid_name: [
    "请输入有效文件夹名称，不包含路径分隔符。",
    "Enter a valid folder name without path separators.",
  ],
  permission_denied: [
    "此位置没有所需权限，请选择其他位置。",
    "Permission unavailable. Choose another location.",
  ],
  location_unavailable: [
    "此位置不可用，请刷新或重新选择。",
    "Location unavailable. Refresh or choose another.",
  ],
  already_exists: [
    "已有同名文件夹，请切换到「已有文件夹」添加。",
    "A folder with this name exists. Add it using Existing folder.",
  ],
  creation_unconfirmed: [
    "目录可能已创建，请通过「已有文件夹」检查并添加。",
    "The folder may already exist. Check and add it using Existing folder.",
  ],
  save_failed_directory_created: [
    "文件夹已创建，项目尚未保存。可重试添加。",
    "Folder created, but project not saved. Retry to finish adding it.",
  ],
  save_failed: [
    "项目尚未保存，可重试添加。",
    "Project not saved. Retry to add it.",
  ],
  project_failed: [
    "暂未确认结果。可重试查询同一操作。",
    "Result not confirmed. Retry the same operation.",
  ],
  location_changed: [
    "文件夹位置发生变化，请重新选择。",
    "Folder location changed. Select it again.",
  ],
  noFolders: ["此目录没有子文件夹", "No subfolders here"],
  loadMore: ["加载更多", "Load more"],
} as const;
export type ProjectCopyKey = keyof typeof projectCopy;
export function projectText(locale: string, key: string) {
  return (projectCopy[key as ProjectCopyKey] ?? projectCopy.project_failed)[
    locale.startsWith("zh") ? 0 : 1
  ];
}
type Location = {
  path: string;
  name: string;
  projects: string[];
  available: boolean;
  writable: boolean;
  error_code?: string;
};
type Directory = { path: string; name: string };
export type ProjectReply = {
  type: string;
  request_id: string;
  error_code?: string;
  locations?: Location[];
  path?: string;
  parent?: string | null;
  directories?: Directory[];
  next_offset?: number | null;
  project?: SavedProjectRecord;
};
type Props = {
  open: boolean;
  locale: string;
  deviceName: string;
  provider: ProjectProvider;
  providerName: string;
  online: boolean;
  currentPath?: string;
  request: (
    type: string,
    payload: Record<string, unknown>,
  ) => Promise<ProjectReply>;
  onClose: () => void;
  onCreated: (project: SavedProjectRecord) => void;
  onStart: (project: SavedProjectRecord, content: string) => Promise<void>;
};

export function AddProject(props: Props) {
  const { locale, online, request, onCreated } = props;
  const t = (key: string) => projectText(locale, key);
  const dialog = useRef<HTMLDialogElement>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [mode, setMode] = useState("new");
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [browse, setBrowse] = useState<ProjectReply | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [project, setProject] = useState<SavedProjectRecord | null>(null);
  const [prompt, setPrompt] = useState("");
  const [taskAttempted, setTaskAttempted] = useState(false);
  const operation = useRef<{ signature: string; id: string } | null>(null);
  const mounted = useRef(true);
  function close() {
    if (project) {
      setProject(null);
      setName("");
      setPrompt("");
      setTaskAttempted(false);
      operation.current = null;
    }
    props.onClose();
  }
  async function run(work: () => Promise<void>) {
    if (busyRef.current || !online) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "project_failed");
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function rpc(type: string, payload: Record<string, unknown> = {}) {
    const result = await request(type, { ...payload, provider: props.provider });
    if (result.error_code) throw new Error(result.error_code);
    return result;
  }
  async function load() {
    const result = await rpc("project.locations");
    if (!mounted.current) return;
    const choices = result.locations ?? [];
    setLocations(choices);
    setPath(
      (previous) =>
        previous ||
        choices.find(
          (l) =>
            l.available &&
            l.writable &&
            props.currentPath
              ?.replaceAll("\\", "/")
              .startsWith(l.path.replaceAll("\\", "/") + "/"),
        )?.path ||
        choices.find((l) => l.available && l.writable)?.path ||
        "",
    );
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (props.open) {
      dialog.current?.showModal();
      if (!locations.length) void run(load);
    } else dialog.current?.close();
    // The parent remounts this dialog whenever the target device/provider changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);
  async function openDirectory(target: string, offset = 0) {
    const result = await rpc("project.browse", { path: target, offset });
    if (mounted.current)
      setBrowse((previous) =>
        offset
          ? {
              ...result,
              directories: [
                ...(previous?.directories ?? []),
                ...(result.directories ?? []),
              ],
            }
          : result,
      );
  }
  async function create() {
    const payload = {
      mode,
      path,
      ...(mode === "new" ? { name: name.trim() } : {}),
    };
    const signature = JSON.stringify(payload);
    if (operation.current?.signature !== signature)
      operation.current = { signature, id: `project_${crypto.randomUUID()}` };
    const result = await rpc("project.create", {
      ...payload,
      operation_id: operation.current.id,
    });
    if (
      !result.project ||
      result.project.provider !== props.provider ||
      !result.project.cwd
    )
      throw new Error("project_failed");
    onCreated(result.project);
    if (mounted.current) setProject(result.project);
  }
  const selected = locations.find((l) => l.path === path);
  const validName =
    name.trim() &&
    !/[\\/\u0000-\u001f]/.test(name) &&
    ![".", ".."].includes(name.trim());
  return (
    <dialog
      className="add-project-dialog"
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      aria-labelledby="add-project-title"
    >
      <div className="add-project-heading">
        <h2 id="add-project-title">{project ? t("ready") : t("title")}</h2>
        <button type="button" onClick={close}>
          {t("cancel")}
        </button>
      </div>
      <p>
        {props.deviceName} · {props.providerName} · {online ? t("online") : t("offline")}
      </p>
      <p className="add-project-muted">{t("local")}</p>
      {project ? (
        <>
          <h3>{project.name}</h3>
          <p className="add-project-path" dir="ltr">
            {project.cwd}
          </p>
          {props.provider === "claude-cowork" ? (
            <p>{t("coworkStart")}</p>
          ) : (
            <>
              <label>
                {t("prompt")}
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                />
              </label>
              <button
                className="add-project-primary"
                disabled={busy || !online || !prompt.trim() || taskAttempted}
                onClick={() =>
                  void run(async () => {
                    setTaskAttempted(true);
                    await props.onStart(project, prompt.trim());
                    close();
                  })
                }
              >
                {busy ? t("working") : t("start")}
              </button>
              {taskAttempted && !busy && <p>{t("taskFailed")}</p>}
            </>
          )}
        </>
      ) : browse ? (
        <>
          <button disabled={busy} onClick={() => setBrowse(null)}>
            {t("back")}
          </button>
          <p className="add-project-path" dir="ltr">
            {browse.path}
          </p>
          {browse.parent && (
            <button
              disabled={busy}
              onClick={() => void run(() => openDirectory(browse.parent!))}
            >
              ↑ {t("back")}
            </button>
          )}
          <div className="add-project-directories">
            {browse.directories?.map((d) => (
              <button
                disabled={busy}
                key={d.path}
                onClick={() => void run(() => openDirectory(d.path))}
              >
                {d.name} ›
              </button>
            ))}
          </div>
          {!browse.directories?.length && <p>{t("noFolders")}</p>}
          {browse.next_offset != null && (
            <button
              disabled={busy}
              onClick={() =>
                void run(() => openDirectory(browse.path!, browse.next_offset!))
              }
            >
              {t("loadMore")}
            </button>
          )}
          <button
            className="add-project-primary"
            disabled={busy || !online}
            onClick={() => {
              setPath(browse.path!);
              setBrowse(null);
            }}
          >
            {t("select")}
          </button>
        </>
      ) : (
        <>
          <div className="add-project-tabs">
            {["new", "existing"].map((value) => (
              <button
                key={value}
                disabled={busy}
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value);
                  setPath(
                    value === "new"
                      ? (locations.find((l) => l.available && l.writable)
                          ?.path ?? "")
                      : "",
                  );
                  setError("");
                }}
              >
                {t(value)}
              </button>
            ))}
          </div>
          {mode === "new" && (
            <label>
              {t("name")}
              <input
                autoComplete="off"
                value={name}
                maxLength={80}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          <fieldset disabled={busy || !online}>
            <legend>{t("location")}</legend>
            <p className="add-project-muted">{t("parents")}</p>
            {(showMore ? locations : locations.slice(0, 3)).map((l) =>
              mode === "new" ? (
                <label className="add-project-location" key={l.path}>
                  <input
                    type="radio"
                    name="project-parent"
                    checked={path === l.path}
                    disabled={!l.available || !l.writable}
                    onChange={() => setPath(l.path)}
                  />
                  <span>
                    {l.name}
                    <small dir="ltr">{l.path}</small>
                    <small>{l.projects.join(" · ")}</small>
                    {(!l.available || !l.writable) && (
                      <small>{t(l.error_code ?? "permission_denied")}</small>
                    )}
                  </span>
                </label>
              ) : (
                <button
                  className="add-project-location"
                  key={l.path}
                  disabled={!l.available}
                  onClick={() => void run(() => openDirectory(l.path))}
                >
                  <span>
                    {l.name}
                    <small dir="ltr">{l.path}</small>
                    <small>
                      {l.available
                        ? l.projects.join(" · ")
                        : t(l.error_code ?? "permission_denied")}
                    </small>
                  </span>
                  ›
                </button>
              ),
            )}
            {locations.length > 3 && !showMore && (
              <button onClick={() => setShowMore(true)}>{t("more")}</button>
            )}
            {!locations.some((l) => l.available) && <p>{t("empty")}</p>}
            <div className="add-project-actions">
              <button onClick={() => void run(load)}>{t("refresh")}</button>
              <button
                disabled={!locations.some((l) => l.available)}
                onClick={() =>
                  void run(() =>
                    openDirectory(
                      path || locations.find((l) => l.available)!.path,
                    ),
                  )
                }
              >
                {t("browse")}
              </button>
            </div>
          </fieldset>
          {path && (
            <p className="add-project-path" dir="ltr">
              {path}
              {mode === "new" && name.trim()
                ? `${path.endsWith("/") || path.endsWith("\\") ? "" : path.includes("\\") ? "\\" : "/"}${name.trim()}`
                : ""}
            </p>
          )}
          <button
            className="add-project-primary"
            disabled={
              busy ||
              !online ||
              !path ||
              (mode === "new" && (!validName || selected?.writable === false))
            }
            onClick={() => void run(create)}
          >
            {busy
              ? t("working")
              : error
                ? t("retry")
                : t(mode === "new" ? "create" : "add")}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="add-project-error">
          {t(error)}
        </p>
      )}
    </dialog>
  );
}
