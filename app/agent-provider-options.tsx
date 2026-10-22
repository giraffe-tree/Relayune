"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { AuthLocale } from "./auth-language";
import { moveAgent, normalizeAgentOrder, normalizeVisibleAgents, isBetaAgent, type AgentProvider } from "../shared/agent-order";

const text: Record<AuthLocale, { hint: string; saving: string; saved: string; failed: string; retry: string; loadingFailed: string }> = {
  "zh-CN": { hint: "长按拖动排序；键盘使用 Alt + ↑ / ↓", saving: "正在保存顺序…", saved: "顺序已保存", failed: "顺序保存失败，已恢复原顺序", retry: "重试", loadingFailed: "未能读取排序" },
  en: { hint: "Hold to reorder; use Alt + ↑ / ↓ with a keyboard", saving: "Saving order…", saved: "Order saved", failed: "Could not save. Previous order restored", retry: "Retry", loadingFailed: "Could not load order" },
  hi: { hint: "क्रम बदलने के लिए दबाकर रखें; कीबोर्ड पर Alt + ↑ / ↓", saving: "क्रम सहेजा जा रहा है…", saved: "क्रम सहेजा गया", failed: "सहेजा नहीं जा सका। पिछला क्रम बहाल हुआ", retry: "फिर कोशिश करें", loadingFailed: "क्रम लोड नहीं हुआ" },
  es: { hint: "Mantén pulsado para reordenar; teclado: Alt + ↑ / ↓", saving: "Guardando orden…", saved: "Orden guardado", failed: "No se pudo guardar. Se restauró el orden anterior", retry: "Reintentar", loadingFailed: "No se pudo cargar el orden" },
  ar: { hint: "اضغط مطولاً لإعادة الترتيب؛ لوحة المفاتيح: Alt + ↑ / ↓", saving: "جارٍ حفظ الترتيب…", saved: "تم حفظ الترتيب", failed: "تعذر الحفظ. تمت استعادة الترتيب السابق", retry: "إعادة المحاولة", loadingFailed: "تعذر تحميل الترتيب" },
  fr: { hint: "Appui long pour réordonner ; clavier : Alt + ↑ / ↓", saving: "Enregistrement…", saved: "Ordre enregistré", failed: "Échec de l’enregistrement. Ordre précédent rétabli", retry: "Réessayer", loadingFailed: "Impossible de charger l’ordre" },
  bn: { hint: "সাজাতে চেপে ধরে রাখুন; কীবোর্ডে Alt + ↑ / ↓", saving: "ক্রম সংরক্ষণ হচ্ছে…", saved: "ক্রম সংরক্ষিত", failed: "সংরক্ষণ হয়নি। আগের ক্রম ফিরিয়ে আনা হয়েছে", retry: "আবার চেষ্টা করুন", loadingFailed: "ক্রম লোড করা যায়নি" },
  pt: { hint: "Mantenha pressionado para reordenar; teclado: Alt + ↑ / ↓", saving: "Salvando ordem…", saved: "Ordem salva", failed: "Não foi possível salvar. Ordem anterior restaurada", retry: "Tentar novamente", loadingFailed: "Não foi possível carregar a ordem" },
  id: { hint: "Tekan lama untuk mengurutkan; keyboard: Alt + ↑ / ↓", saving: "Menyimpan urutan…", saved: "Urutan tersimpan", failed: "Gagal menyimpan. Urutan sebelumnya dipulihkan", retry: "Coba lagi", loadingFailed: "Gagal memuat urutan" },
  ur: { hint: "ترتیب بدلنے کے لیے دبا کر رکھیں؛ کی بورڈ: Alt + ↑ / ↓", saving: "ترتیب محفوظ ہو رہی ہے…", saved: "ترتیب محفوظ ہو گئی", failed: "محفوظ نہیں ہو سکا۔ پچھلی ترتیب بحال ہو گئی", retry: "دوبارہ کوشش", loadingFailed: "ترتیب لوڈ نہیں ہو سکی" },
};

type Option = { id: AgentProvider; label: string; shortLabel: string; icon: string };
type Gesture = { id: AgentProvider; pointerId: number; x: number; y: number; lastY: number; active: boolean; scrolling: boolean; before: AgentProvider[]; button: HTMLButtonElement };

export default function AgentProviderOptions({ options, selected, onSelect, locale, request }: {
  options: readonly Option[];
  selected: AgentProvider;
  onSelect: (id: AgentProvider) => void;
  locale: AuthLocale;
  request: (options: RequestInit) => Promise<{ agent_order: AgentProvider[]; visible_agents?: AgentProvider[] }>;
}) {
  const [order, setOrder] = useState(() => normalizeAgentOrder(null));
  const orderRef = useRef(order);
  const [visible, setVisible] = useState<AgentProvider[]>(() => normalizeVisibleAgents(null));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [visibilityFeedback, setVisibilityFeedback] = useState("");
  const settingsTitle = locale === "zh-CN" ? "侧边栏 Agent" : "Sidebar agents";
  const [dragged, setDragged] = useState<AgentProvider | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "saved" | "failed" | "loadingFailed">("loading");
  const [attempt, setAttempt] = useState(0);
  const busy = useRef(true);
  const list = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const saveRequest = useRef<AbortController | null>(null);
  const copy = text[locale];

  function updateOrder(next: AgentProvider[]) {
    orderRef.current = next;
    setOrder(next);
  }

  useEffect(() => {
    const controller = new AbortController();
    request({ signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      const next = normalizeAgentOrder(result.agent_order);
      orderRef.current = next;
      setOrder(next);
      setVisible(normalizeVisibleAgents(result.visible_agents));
      busy.current = false;
      setStatus("ready");
    }).catch(() => {
      if (!controller.signal.aborted) setStatus("loadingFailed");
    });
    return () => controller.abort();
  }, [request, attempt]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    gesture.current = null;
    saveRequest.current?.abort();
  }, []);

  function clearTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  async function save(next: AgentProvider[], before: AgentProvider[]) {
    if (next.every((id, index) => id === before[index])) return;
    busy.current = true;
    setStatus("saving");
    const controller = new AbortController();
    saveRequest.current = controller;
    try {
      const result = await request({ method: "PUT", body: JSON.stringify({ agent_order: next }), signal: controller.signal });
      if (controller.signal.aborted) return;
      updateOrder(normalizeAgentOrder(result.agent_order));
      setStatus("saved");
    } catch {
      if (controller.signal.aborted) return;
      updateOrder(before);
      setStatus("failed");
    } finally {
      if (!controller.signal.aborted) busy.current = false;
    }
  }

  // Keep the dragged item reachable even when the rail is shorter than the list.
  useEffect(() => {
    if (!dragged) return;
    let frame = 0;
    const tick = () => {
      const current = gesture.current;
      const container = list.current;
      if (!current?.active || !container) return;
      const bounds = container.getBoundingClientRect();
      const y = current.lastY;
      if (y < bounds.top + 30) container.scrollTop -= 5;
      else if (y > bounds.bottom - 30) container.scrollTop += 5;
      const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-agent-id]"));
      let closest = 0;
      let distance = Infinity;
      buttons.forEach((button, index) => {
        const rect = button.getBoundingClientRect();
        const delta = Math.abs(y - (rect.top + rect.height / 2));
        if (delta < distance) { distance = delta; closest = index; }
      });
      const targetId = buttons[closest]?.dataset.agentId as AgentProvider | undefined;
      const target = targetId ? orderRef.current.indexOf(targetId) : -1;
      if (target >= 0 && orderRef.current.indexOf(current.id) !== target) {
        const next = moveAgent(orderRef.current, current.id, target);
        orderRef.current = next;
        setOrder(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragged]);

  function finish(cancel: boolean) {
    clearTimer();
    const current = gesture.current;
    gesture.current = null;
    if (!current) return;
    if (current.button.hasPointerCapture(current.pointerId)) current.button.releasePointerCapture(current.pointerId);
    setDragged(null);
    if (!current.active) return;
    if (cancel) updateOrder(current.before);
    else void save(orderRef.current, current.before);
  }

  function start(event: PointerEvent<HTMLButtonElement>, id: AgentProvider) {
    if (event.button !== 0 || !event.isPrimary || gesture.current) return;
    suppressClick.current = false;
    clearTimer();
    const button = event.currentTarget;
    button.setPointerCapture(event.pointerId);
    gesture.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, lastY: event.clientY, active: false, scrolling: false, before: [...orderRef.current], button };
    if (busy.current) return;
    timer.current = setTimeout(() => {
      if (!gesture.current) return;
      gesture.current.active = true;
      suppressClick.current = true;
      setDragged(id);
    }, 420);
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const previousY = current.lastY;
    current.lastY = event.clientY;
    if (current.active) return;
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 8) {
      clearTimer();
      current.scrolling = true;
      suppressClick.current = true;
    }
    if (current.scrolling && list.current) list.current.scrollTop += previousY - event.clientY;
  }

  async function toggleVisible(id: AgentProvider) {
    if (busy.current || visibilitySaving) return;
    const next = visible.includes(id) ? visible.filter(value => value !== id) : [...visible, id];
    busy.current = true; setVisibilitySaving(true); setVisibilityFeedback("");
    try {
      const result = await request({ method: "PUT", body: JSON.stringify({ visible_agents: next }) });
      setVisible(normalizeVisibleAgents(result.visible_agents));
      setVisibilityFeedback(locale === "zh-CN" ? "已保存" : "Saved");
    } catch { setVisibilityFeedback(locale === "zh-CN" ? "保存失败，请重试" : "Could not save. Please retry."); }
    finally { busy.current = false; setVisibilitySaving(false); }
  }

  return <>
    <div ref={list} className={`agent-provider-rail-options ${dragged ? "is-reordering" : ""}`} aria-busy={status === "saving"}
      onKeyDown={(event) => { if (event.key === "Escape" && gesture.current) { event.preventDefault(); event.stopPropagation(); finish(true); } }}>
      {order.map((id) => {
        const option = options.find((item) => item.id === id);
        if (!option || !visible.includes(id)) return null;
        return <button key={id} type="button" data-agent-id={id}
          className={`${id === selected ? "active" : ""} ${id === dragged ? "is-dragging" : ""}`}
          aria-label={option.label} aria-pressed={id === selected} aria-describedby="agent-order-hint"
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" title={`${option.label} · ${copy.hint}`}
          onPointerDown={(event) => start(event, id)} onPointerMove={move}
          onPointerUp={(event) => { if (gesture.current?.pointerId === event.pointerId) finish(false); }}
          onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)}
          onContextMenu={(event) => event.preventDefault()}
          onClick={(event) => { if (event.detail !== 0 && suppressClick.current) { suppressClick.current = false; return; } onSelect(id); }}
          onKeyDown={(event) => {
            if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault();
            if (busy.current || gesture.current) return;
            const before = orderRef.current;
            const shown = before.filter(value => visible.includes(value));
            const neighbor = shown[shown.indexOf(id) + (event.key === "ArrowUp" ? -1 : 1)];
            if (!neighbor) return;
            const next = moveAgent(before, id, before.indexOf(neighbor));
            updateOrder(next);
            void save(next, before);
          }}>
          <span className="agent-provider-icon" aria-hidden="true" style={{ maskImage: `url(/brand/agents/${option.icon}.svg)` }} />
          <span className="agent-provider-label" aria-hidden="true">{option.shortLabel}</span>
          {isBetaAgent(id) && <small className="agent-beta-badge">Beta</small>}
        </button>;
      })}
    </div>
    <button type="button" className="agent-visibility-settings" aria-label={settingsTitle}
      aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>⚙</button>
    {settingsOpen && <div className="agent-visibility-panel" role="group" aria-label={settingsTitle}>
      <strong>{settingsTitle}</strong>
      <button type="button" aria-label={locale === "zh-CN" ? "关闭" : "Close"} onClick={() => setSettingsOpen(false)}>×</button>
      {order.map(id => {
        const option = options.find(value => value.id === id);
        return option && <label key={id}><input type="checkbox" checked={visible.includes(id)}
          disabled={status === "loading" || status === "loadingFailed" || status === "saving" || visibilitySaving}
          onChange={() => void toggleVisible(id)} />{option.label} {isBetaAgent(id) && <small>Beta</small>}</label>;
      })}
      <div role="status" aria-live="polite">{visibilityFeedback}</div>
    </div>}
    <span id="agent-order-hint" className="login-sr-only">{copy.hint}</span>
    <div className={`agent-order-status ${status === "failed" || status === "loadingFailed" ? "has-error" : ""}`} role="status" aria-live="polite">
      {status === "saving" ? copy.saving : status === "saved" ? copy.saved : status === "failed" ? copy.failed : status === "loadingFailed" ? copy.loadingFailed : null}
      {status === "loadingFailed" && <button type="button" onClick={() => { setStatus("loading"); setAttempt((value) => value + 1); }}>{copy.retry}</button>}
    </div>
  </>;
}
