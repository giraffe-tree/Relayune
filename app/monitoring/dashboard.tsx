'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import styles from './monitoring.module.css';
import Link from 'next/link';
import { discoverInstance, type InstanceCapabilities } from '../instance-client';
import routes from '../../shared/request-log-routes.json';
const routeOptions = [...new Set(routes.map(row => row.template))].filter(route => route.startsWith('/api/')).sort();

type Row = { time: number; requests: number; errors: number; p95_ms: number | null; p99_ms: number | null; users: number; request_method: string; request_uri: string; status: number; duration_ms: number; error: string; trace_id: string; user_ref: string; latest: number };
type ClientVersion = { version: string; seen_at: number };
function clientVersionLabel(sample?: ClientVersion) { return sample ? <span className={styles.clientVersion}><strong>{sample.version}</strong><time dateTime={new Date(sample.seen_at).toISOString()}>{new Date(sample.seen_at).toLocaleString("zh-CN", {hour12:false})}</time></span> : "暂无记录"; }
type ActiveUser = { client_versions?: Partial<Record<"macos" | "ios" | "android" | "web", ClientVersion>>; email: string | null; user_ref: string; latest: number; requests: number };
type Data = { logs_available?: boolean; log_source?: string; active_users: ActiveUser[]; active_users_status: string; recent_requests: Row[]; generated_at: number; from: number; to: number; summary: Row[]; trend: Row[]; endpoints: Row[]; errors: Row[]; ingestion: Row[]; runtime: { database_ok: boolean; process_uptime_s: number; process_memory_mb: number; host_memory_used_percent: number; load_1m: number; cpu_count: number } };
const ranges = [['15m', '15 分钟'], ['1h', '1 小时'], ['6h', '6 小时'], ['24h', '24 小时'], ['7d', '7 天'], ['30d', '30 天'], ['120d', '120 天']];
const fmt = (n: number | null | undefined, digits = 0) => n == null ? '—' : n.toLocaleString('zh-CN', { maximumFractionDigits: digits });
const clock = (n: number) => new Date(n * 1000).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });

function Chart({ data, metric, label, color }: { data: Data; metric: 'requests' | 'p95_ms'; label: string; color: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const rows = data.trend;
  const max = Math.max(1, ...rows.map(x => Number(x[metric] || 0)));
  const x = (t: number) => 38 + Math.max(0, Math.min(1, (t - data.from) / (data.to - data.from))) * 720;
  const labelTime = (t: number) => data.to - data.from > 86400 ? new Date(t * 1000).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : clock(t);
  const y = (v: number) => 160 - v / max * 132;
  const points = rows.map(r => `${x(r.time)},${y(Number(r[metric] || 0))}`).join(' ');
  return <div className={styles.chart}>
    <div className={styles.chartCaption}><span>{label}</span><span>{hover !== null && rows[hover] ? `${labelTime(rows[hover].time)} · ${fmt(rows[hover][metric], 2)} ${metric === 'p95_ms' ? 'ms' : '次'}` : '将指针移入图表查看数值'}</span></div>
    {!rows.length ? <div className={styles.emptyChart}>此时间段暂无请求</div> : <svg viewBox="0 0 780 200" role="img" aria-label={`${label}，${rows.length} 个时间桶`} onMouseLeave={() => setHover(null)}>
      {[0, .5, 1].map(v => <g key={v}><line x1="38" x2="758" y1={y(max * v)} y2={y(max * v)} stroke="#e7eae5" strokeDasharray="3 5" /><text x="30" y={y(max * v) + 4} textAnchor="end" fill="#818a7f" fontSize="10">{fmt(max * v)}</text></g>)}
      <polygon points={`${x(rows[0].time)},160 ${points} ${x(rows[rows.length - 1].time)},160`} fill={color} opacity=".07" />
      <polyline points={points} stroke={color} strokeWidth="2.3" strokeLinejoin="round" fill="none" />
      {rows.map((r, i) => <circle key={r.time} cx={x(r.time)} cy={y(Number(r[metric] || 0))} r={hover === i ? 5 : rows.length === 1 ? 3 : 9} fill={hover === i || rows.length === 1 ? color : 'transparent'} onMouseEnter={() => setHover(i)}><title>{clock(r.time)}: {fmt(r[metric], 2)}</title></circle>)}
      <text x="38" y="187" fill="#818a7f" fontSize="11">{labelTime(data.from)}</text><text x="758" y="187" textAnchor="end" fill="#818a7f" fontSize="11">{labelTime(data.to)}</text>
    </svg>}
  </div>;
}

export default function Dashboard() {
  const [range, setRange] = useState('1h');
  const [draftRef, setDraftRef] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [selectedEmail, setSelectedEmail] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [userRef, setUserRef] = useState('');
  const [route, setRoute] = useState('');
  const [method, setMethod] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState('loading');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(true);
  const [adminEmail, setAdminEmail] = useState('');
  const [instance, setInstance] = useState<InstanceCapabilities | null>(null);
  const [instanceFailed, setInstanceFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void discoverInstance('', window.location.origin, AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]))
      .then(value => { if (!abort.signal.aborted) setInstance(value); })
      .catch(() => { if (!abort.signal.aborted) setInstanceFailed(true); });
    return () => abort.abort();
  }, []);
  const [password, setPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [sort, setSort] = useState<'requests' | 'p95_ms' | 'errors'>('requests');
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    const id = ++sequence.current;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setBusy(true);
    try {
      const response = await fetch(`/api/monitoring?${new URLSearchParams({ range, ...(route ? {route} : {}), ...(method ? {method} : {}), ...(userRef ? { user_ref: userRef } : {}) })}`, { credentials: 'same-origin', cache: 'no-store', signal: abort.signal });
      const body = await response.json();
      if (id !== sequence.current) return;
      if ([401, 403].includes(response.status)) { setData(null); setNotice(''); setState(response.status === 401 ? 'login' : 'forbidden'); return; }
      if (!response.ok) { setState('failed'); setNotice(body.error?.code === 'monitoring_not_configured' ? '监控数据源尚未配置，请完成服务端 SLS 查询配置。' : '暂时无法读取监控数据，请稍后重试。'); return; }
      setData(body); setState('ready'); setNotice('');
    } catch (e) {
      if (id === sequence.current && (e as Error).name !== 'AbortError') { setState('failed'); setNotice('连接失败，请检查网络后重试。'); }
    } finally { if (id === sequence.current) setBusy(false); }
  }, [range, userRef, route, method]);
  const cancelLoad = useCallback(() => { ++sequence.current; controller.current?.abort(); }, []);
  useEffect(() => {
    const initial = setTimeout(() => { setData(null); void load(); }, 0);
    const timer = setInterval(() => { if (auto && document.visibilityState === 'visible') void load(); }, 30000);
    return () => { clearTimeout(initial); clearInterval(timer); cancelLoad(); };
  }, [load, auto, cancelLoad]);
  async function login(event: FormEvent) {
    event.preventDefault(); if (!instance) return; setLoginBusy(true); setNotice('');
    try {
      const response = await fetch('/api/auth/password', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, redirect: 'error', body: JSON.stringify({ ...(instance?.auth_mode === 'username' ? { username: adminEmail.trim() } : { email: adminEmail.trim() }), password }) });
      setPassword('');
      if (!response.ok) { setNotice(response.status === 429 ? '尝试次数过多，请稍后再试。' : '登录失败，请检查账户和密码。'); return; }
      await load();
    } catch { setNotice('登录连接失败，请稍后重试。'); }
    finally { setLoginBusy(false); }
  }
  async function logout() {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error();
      ++sequence.current; controller.current?.abort(); setData(null); setState('login'); setNotice('');
    } catch { setNotice('退出失败，请重试。'); }
  }
  function selectUser(ref: string, email: string | null) {
    setDraftRef(ref); setUserRef(ref); setSelectedEmail(email || ''); setEmailInput(email || '');
    setRange('120d'); setRoute(''); setMethod(''); setErrorsOnly(false); setNotice('');
  }
  async function searchEmail(event: FormEvent) {
    event.preventDefault(); setEmailBusy(true); setNotice('');
    try {
      const response = await fetch('/api/monitoring/resolve-user', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: emailInput.trim() }) });
      if (response.status === 401 || response.status === 403) { cancelLoad(); setData(null); setState(response.status === 401 ? 'login' : 'forbidden'); return; }
      if (!response.ok) { setNotice(response.status === 400 ? '请输入有效的完整邮箱。' : '暂时无法关联邮箱，请稍后重试。'); return; }
      const body = await response.json(); selectUser(body.user_ref, body.email);
    } catch { setNotice('邮箱搜索失败，请检查网络后重试。'); }
    finally { setEmailBusy(false); }
  }
  const logRows = data ? (errorsOnly ? data.errors : data.recent_requests) : [];
  const summary = data?.summary[0];
  const lag = data?.ingestion[0]?.latest ? Math.max(0, Math.floor(data.generated_at / 1000) - data.ingestion[0].latest) : null;
  const fresh = lag !== null && lag < 180;
  return <main className={styles.page}>
    <aside className={styles.sidebar}>
      <Link href="/" className={styles.brand}><span className={styles.logo}>r</span> relayune<span className={styles.brandDot}>.</span></Link>
      <div className={styles.consoleLabel}>OPERATIONS CONSOLE</div>
      <Link href="/monitoring/" className={styles.navActive}><span>◫</span> 服务端监控</Link>
      <Link href="/" className={styles.navLink}><span>↗</span> 返回 Relayune</Link>
      <div className={styles.sideBottom}><span className={styles.smallDot} /> 自托管服务<br /><span>日志与性能观测</span></div>
    </aside>
    <div className={styles.workspace}>
      <header className={styles.topbar}><span>Relayune <span className={styles.slash}>/</span> 服务端监控</span><span className={styles.private}>仅管理员可见</span></header>
      {(state === 'login' || state === 'forbidden') ? <section className={styles.login}>
        <div className={styles.eyebrow}>RESTRICTED ACCESS</div><h1>{state === 'forbidden' ? '此账号无访问权限' : '登录监控控制台'}</h1><p>仅允许指定管理员访问服务状态与日志数据。</p>
        {instanceFailed && <p role="alert">无法确认此实例的登录方式，请检查连接后刷新。</p>}{state === 'login' ? <form onSubmit={login}><label>{instance?.auth_mode === 'username' ? '管理员用户名' : '管理员邮箱'}<input type={instance?.auth_mode === 'username' ? 'text' : 'email'} value={adminEmail} onChange={e => setAdminEmail(e.target.value)} required autoComplete="username" /></label><label>账号密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" autoFocus /></label><button className={styles.primary} disabled={loginBusy || !instance}>{loginBusy ? '正在登录…' : '登录 →'}</button></form> : <button className={styles.primary} onClick={() => void logout()}>退出当前账号</button>}
        {notice && <p role="alert" className={styles.errorText}>{notice}</p>}
      </section> : <div className={styles.content}>
        <div className={styles.heading}><div><div className={styles.eyebrow}>OBSERVABILITY / OVERVIEW</div><h1>服务端监控<span className={styles.headingDot}>.</span></h1><p>从请求到响应，了解服务此刻的运行状态。</p></div><div className={styles.statusPill} data-ok={state === 'ready' && fresh}>{(state === 'loading' || (busy && !data)) ? '正在连接' : state === 'failed' ? '数据读取异常' : fresh ? '日志持续入库' : '日志入库延迟'}</div></div>
        <div className={styles.toolbar}><div className={styles.rangeGroup}>{ranges.map(([key, label]) => <button key={key} aria-pressed={range === key} onClick={() => setRange(key)}>{label}</button>)}</div><div className={styles.refresh}><label><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />每 30 秒刷新</label><button disabled={busy} onClick={() => void load()}>{busy ? '刷新中…' : '↻ 刷新'}</button><button onClick={() => void logout()}>退出</button></div></div>
        {notice && <div className={styles.notice} role="alert">{notice}{data && state === 'failed' && ' 以下保留上次成功读取的数据。'}</div>}
        {instance?.auth_mode !== 'username' && <form className={styles.emailSearch} onSubmit={searchEmail}><label htmlFor="monitor-email">搜索用户邮箱</label><input id="monitor-email" type="email" required value={emailInput} onChange={e => setEmailInput(e.target.value)} placeholder="输入完整 email，查看该用户的请求" autoComplete="off" list="active-user-emails" /><datalist id="active-user-emails">{data?.active_users?.filter(u => u.email).map(u => <option key={u.user_ref} value={u.email!} />)}</datalist><button disabled={emailBusy}>{emailBusy ? '搜索中…' : '查看请求'}</button></form>}
        {data?.logs_available === false && <p role="status">当前展示本实例的数据库与进程状态；日志数据源未配置，不会查询官方服务。</p>}{selectedEmail && <p className={styles.selectedUser}>当前用户：<strong>{selectedEmail}</strong> · 可继续缩小时间范围或筛选接口</p>}
        <div className={styles.endpointFilter}><label htmlFor="monitor-method">请求方法</label><select id="monitor-method" value={method} onChange={e => setMethod(e.target.value)}><option value="">全部方法</option>{['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','CONNECT','TRACE','UNKNOWN'].map(m => <option key={m}>{m}</option>)}</select><label htmlFor="monitor-route">接口</label><select id="monitor-route" value={route} onChange={e => setRoute(e.target.value)}><option value="">全部接口</option>{routeOptions.map(r => <option key={r}>{r}</option>)}</select>{(route || method) && <button onClick={() => {setRoute('');setMethod('');}}>清除接口筛选</button>}</div>
        <form className={styles.filter} onSubmit={e => { e.preventDefault(); if (draftRef && !/^v[1-9][0-9]{0,2}_[0-9a-f]{64}$/.test(draftRef.trim())) { setNotice('请输入完整的 user_ref，例如 v1_ 后跟 64 位摘要。'); return; } setNotice(''); setSelectedEmail(''); setUserRef(draftRef.trim()); }}><label htmlFor="user-ref">用户筛选</label><input id="user-ref" placeholder="输入完整 user_ref，查看单个用户的请求" value={draftRef} onChange={e => setDraftRef(e.target.value)} autoComplete="off" /><button type="submit">应用</button>{userRef && <button type="button" onClick={() => { setDraftRef(''); setUserRef(''); setSelectedEmail(''); setEmailInput(''); }}>清除</button>}</form>
        <section className={styles.cards} aria-label="关键指标">
          {[['API 请求', fmt(summary?.requests), '当前时间段 · 次'], ['5xx 错误率', summary?.requests ? `${fmt(summary.errors / summary.requests * 100, 2)}%` : '—', `${fmt(summary?.errors)} 次服务端错误`], ['P95 响应耗时', fmt(summary?.p95_ms, 2), `毫秒 · P99 ${fmt(summary?.p99_ms, 2)} ms`], ['活跃用户', fmt(summary?.users), '按 user_ref 近似去重']].map(([label, value, detail], i) => <article className={styles.card} key={label}><div><span>{label}</span><span className={styles.cardIndex}>0{i + 1}</span></div><strong>{value}</strong><small>{detail}</small></article>)}
        </section>
        {data ? <>
          <section className={styles.panel}><div className={styles.panelHead}><h2>最近活跃用户<span>{data.active_users?.length || 0} / 100</span></h2><span>最近 120 天 · 版本为各端最近上报值</span></div>{data.active_users_status !== 'ready' ? <p className={styles.empty}>暂时无法读取用户列表，请稍后刷新。</p> : !data.active_users.length ? <p className={styles.empty}>暂时没有带用户标识的活跃记录。</p> : <div className={`${styles.tableScroll} ${styles.userList}`}><table><thead><tr><th>邮箱</th><th>macOS 版本 / 上报时间</th><th>手机版本 / 上报时间</th><th>Web 版本 / 上报时间</th><th>最近请求</th><th>120 天请求量</th><th>操作</th></tr></thead><tbody>{data.active_users.map(u => <tr key={u.user_ref}><td>{u.email ? <button className={styles.userEmail} onClick={() => selectUser(u.user_ref,u.email)}>{u.email}</button> : <span title={u.user_ref}>无法关联邮箱（旧密钥或账户已删除）</span>}</td><td>{clientVersionLabel(u.client_versions?.macos)}</td><td>{u.client_versions?.ios || u.client_versions?.android ? <>{u.client_versions.ios && <div>iOS {clientVersionLabel(u.client_versions.ios)}</div>}{u.client_versions.android && <div>Android {clientVersionLabel(u.client_versions.android)}</div>}</> : "暂无记录"}</td><td>{clientVersionLabel(u.client_versions?.web)}</td><td>{new Date(u.latest * 1000).toLocaleString('zh-CN', {hour12:false})}</td><td>{fmt(u.requests)}</td><td><button className={styles.userButton} onClick={() => selectUser(u.user_ref,u.email)}>查看请求</button></td></tr>)}</tbody></table></div>}</section>
          <section className={styles.panel}><div className={styles.panelHead}><h2>流量与延迟</h2><span>{method || '全部方法'} · {route || '全部接口'}</span><span>已统一为毫秒 · 历史日志自动换算</span></div><div className={styles.charts}><Chart data={data} metric="requests" label="请求量 / 时间桶" color="#46754d" /><Chart data={data} metric="p95_ms" label="P95 响应耗时 / ms" color="#a87c44" /></div></section>
          <section className={styles.runtime}><span><i data-ok={data.runtime.database_ok} />MongoDB {data.runtime.database_ok ? '连接正常' : '连接异常'}</span><span>API 内存 <b>{data.runtime.process_memory_mb} MB</b></span><span>主机内存使用 <b>{data.runtime.host_memory_used_percent}%</b></span><span>1 分钟负载 <b>{fmt(data.runtime.load_1m, 2)} / {data.runtime.cpu_count} 核</b></span><span>API 已运行 <b>{fmt(data.runtime.process_uptime_s / 3600, 1)} 小时</b></span></section>
          <section className={styles.panel}><div className={styles.panelHead}><h2>接口性能<span>TOP 30</span></h2><label>排序 <select value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="requests">请求量</option><option value="p95_ms">P95 耗时</option><option value="errors">5xx 次数</option></select></label></div><div className={styles.tableScroll}><table><thead><tr><th>接口</th><th>请求量</th><th>P95 / ms</th><th>P99 / ms</th><th>5xx</th></tr></thead><tbody>{[...data.endpoints].sort((a,b) => Number(b[sort] || 0) - Number(a[sort] || 0)).map(r => <tr key={r.request_method+r.request_uri}><td><span className={styles.method}>{r.request_method}</span><code>{r.request_uri}</code></td><td>{fmt(r.requests)}</td><td>{fmt(r.p95_ms, 2)}</td><td>{fmt(r.p99_ms, 2)}</td><td className={r.errors ? styles.errorText : ''}>{fmt(r.errors)}</td></tr>)}</tbody></table>{!data.endpoints.length && <p className={styles.empty}>此时间范围内没有匹配的 API 请求。</p>}</div></section>
          <section className={styles.panel}><div className={styles.panelHead}><h2>请求记录<span>HTTP 状态与耗时</span></h2><label><input type="checkbox" checked={errorsOnly} onChange={e => setErrorsOnly(e.target.checked)} /> 仅错误</label><span>最近 {errorsOnly ? 50 : 100} 条 · 展开查看标识</span></div>{!logRows?.length ? <p className={styles.empty}>此筛选条件下没有请求记录。</p> : <div className={styles.errorList}>{logRows.map((r, i) => <details key={`${r.trace_id || "legacy"}-${i}`}><summary><time>{clock(r.time)}</time><span className={styles.statusCode} data-server={r.status >= 500} data-success={r.status < 400}>{r.status}</span><code>{r.request_method} {r.request_uri}</code><span>{r.error || (r.status < 400 ? '请求完成' : '未记录错误码')}</span><b>{fmt(r.duration_ms, 2)} ms</b></summary><div className={styles.errorDetail}><span>Trace ID <code>{r.trace_id || '历史日志未记录'}</code></span><span>User ref <code>{r.user_ref || '匿名或未记录'}</code></span></div></details>)}</div>}</section>
        </> : <div className={styles.loading} role="status">{busy ? '正在读取服务指标…' : '暂无可展示的监控数据'}</div>}
        <footer className={styles.footer}><span>SLS · 服务端配置的数据源{userRef ? ' · 已筛选用户' : ''}</span><span>{data ? `更新于 ${new Date(data.generated_at).toLocaleTimeString('zh-CN', { hour12: false })} · 最近入库 ${lag === null ? '未知' : `${lag} 秒前`}` : '等待数据'} · 时间为本机时区</span></footer>
      </div>}
    </div>
  </main>;
}
