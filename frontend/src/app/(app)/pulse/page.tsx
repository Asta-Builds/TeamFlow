"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  LockKeyhole,
  Pause,
  Play,
  Plus,
  Save,
  SquareCheckBig,
  TimerReset,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  ApiError,
  apiFetch,
  createPulsePlanItem,
  deletePulsePlanItem,
  getPulseDashboard,
  savePulseNote,
  startPulseFocus,
  updatePulseFocus,
} from "@/lib/api";
import type {
  Priority,
  PulseDashboard,
  PulsePlanItem,
  PulseTimeBlock,
} from "@/lib/types";

const BLOCKS: Array<{
  id: PulseTimeBlock;
  label: string;
  range: string;
  description: string;
}> = [
  { id: "morning", label: "Morning segment", range: "08:00 — 12:00", description: "Build momentum" },
  { id: "afternoon", label: "Afternoon segment", range: "13:00 — 17:00", description: "Deep work" },
  { id: "evening", label: "Evening wrap", range: "17:00 — 19:00", description: "Close the loop" },
];

const PRIORITY_CLASSES: Record<Priority, string> = {
  low: "border-slate-700 bg-slate-800/70 text-slate-300",
  medium: "border-blue-800/50 bg-blue-950/50 text-blue-300",
  high: "border-amber-800/50 bg-amber-950/50 text-amber-300",
  urgent: "border-rose-800/50 bg-rose-950/50 text-rose-300",
};

function localDate(value = new Date()) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

function shiftDate(value: string, days: number) {
  const next = new Date(`${value}T12:00:00`);
  next.setDate(next.getDate() + days);
  return localDate(next);
}

function formatSelectedDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatFocusTotal(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function activeBlockForNow(selectedDate: string): PulseTimeBlock | null {
  if (selectedDate !== localDate()) return null;
  const hour = new Date().getHours();
  if (hour < 13) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 20) return "evening";
  return null;
}

function apiMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.data && typeof error.data === "object") {
    const data = error.data as { detail?: string };
    return data.detail || fallback;
  }
  return fallback;
}

export default function PulsePage() {
  const [selectedDate, setSelectedDate] = useState(() => localDate());
  const [dashboard, setDashboard] = useState<PulseDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingNote, setSavingNote] = useState(false);
  const [note, setNote] = useState("");
  const [addingTo, setAddingTo] = useState<PulseTimeBlock | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);
  const [working, setWorking] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPulseDashboard(selectedDate);
      setDashboard(data);
      setNote(data.note.body || "");
      setSelectedTaskId(data.candidate_tasks[0]?.id ?? null);
    } catch (error) {
      toast.error(apiMessage(error, "Pulse could not load your execution plan."));
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    const refresh = window.setTimeout(() => {
      void loadDashboard();
    }, 0);
    return () => window.clearTimeout(refresh);
  }, [loadDashboard]);

  useEffect(() => {
    if (dashboard?.current_session?.status !== "active") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [dashboard?.current_session?.status]);

  const activeBlock = activeBlockForNow(selectedDate);
  const session = dashboard?.current_session ?? null;
  const elapsed = useMemo(() => {
    if (!session) return 0;
    if (session.status !== "active" || !session.running_since) return session.elapsed_seconds;
    const running = Math.max(0, Math.floor((now - new Date(session.running_since).getTime()) / 1000));
    return session.elapsed_seconds + running;
  }, [now, session]);

  const plansByBlock = useMemo(() => {
    const grouped: Record<PulseTimeBlock, PulsePlanItem[]> = {
      morning: [],
      afternoon: [],
      evening: [],
    };
    dashboard?.plan_items.forEach((item) => grouped[item.time_block].push(item));
    return grouped;
  }, [dashboard]);

  async function addToPlan() {
    if (!addingTo || !selectedTaskId || !dashboard) return;
    setSavingPlan(true);
    try {
      await createPulsePlanItem({
        task: selectedTaskId,
        date: selectedDate,
        time_block: addingTo,
        position: plansByBlock[addingTo].length,
      });
      setAddingTo(null);
      toast.success("Task added to your execution plan.");
      await loadDashboard();
    } catch (error) {
      toast.error(apiMessage(error, "The task could not be added to Pulse."));
    } finally {
      setSavingPlan(false);
    }
  }

  async function removePlanItem(item: PulsePlanItem) {
    setWorking(true);
    try {
      await deletePulsePlanItem(item.id);
      toast.success("Task removed from this day.");
      await loadDashboard();
    } catch (error) {
      toast.error(apiMessage(error, "The task could not be removed."));
    } finally {
      setWorking(false);
    }
  }

  async function completeTask(item: PulsePlanItem) {
    if (!item.can_complete_task) return;
    setWorking(true);
    try {
      await apiFetch(`/tasks/${item.task}/`, { method: "PATCH", body: { status: "done" } });
      toast.success("Task marked as done.");
      await loadDashboard();
    } catch (error) {
      toast.error(apiMessage(error, "The task could not be marked complete."));
    } finally {
      setWorking(false);
    }
  }

  async function saveNote() {
    setSavingNote(true);
    try {
      const saved = await savePulseNote(selectedDate, note);
      setNote(saved.body);
      toast.success("Private scratchpad saved.");
    } catch (error) {
      toast.error(apiMessage(error, "The private scratchpad could not be saved."));
    } finally {
      setSavingNote(false);
    }
  }

  async function controlFocus() {
    setWorking(true);
    try {
      if (!session) {
        const firstOpen = dashboard?.plan_items.find((item) => item.task_status !== "done");
        await startPulseFocus(firstOpen?.id);
        toast.success(firstOpen ? `Focus started: ${firstOpen.task_title}` : "Focus session started.");
      } else if (session.status === "active") {
        await updatePulseFocus(session.id, "pause");
        toast.success("Focus session paused.");
      } else {
        await updatePulseFocus(session.id, "resume");
        toast.success("Focus session resumed.");
      }
      await loadDashboard();
    } catch (error) {
      toast.error(apiMessage(error, "The focus session could not be updated."));
    } finally {
      setWorking(false);
    }
  }

  async function finishFocus() {
    if (!session) return;
    setWorking(true);
    try {
      await updatePulseFocus(session.id, "complete");
      toast.success("Focus session completed.");
      await loadDashboard();
    } catch (error) {
      toast.error(apiMessage(error, "The focus session could not be completed."));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-8">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-6 lg:flex-row lg:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-indigo-400">
            <TimerReset className="h-3.5 w-3.5" />
            Personal execution layer
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
            {formatSelectedDate(selectedDate)}
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Turn the workspace plan into a deliberately focused day.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label="Previous day"
            onClick={() => setSelectedDate((value) => shiftDate(value, -1))}
            className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-400 transition hover:border-slate-700 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <label className="relative flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300">
            <CalendarDays className="h-3.5 w-3.5 text-indigo-400" />
            <span className="sr-only">Execution date</span>
            <input
              aria-label="Execution date"
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              className="w-[116px] bg-transparent text-xs text-slate-200 outline-none [color-scheme:dark]"
            />
          </label>
          <button
            type="button"
            onClick={() => setSelectedDate(localDate())}
            className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-300 transition hover:border-slate-700 hover:text-white"
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Next day"
            onClick={() => setSelectedDate((value) => shiftDate(value, 1))}
            className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-400 transition hover:border-slate-700 hover:text-white"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      {loading ? (
        <div className="flex h-72 items-center justify-center text-xs font-bold uppercase tracking-widest text-slate-500">
          Loading execution plan…
        </div>
      ) : !dashboard ? (
        <div className="rounded-2xl border border-rose-900/60 bg-rose-950/20 p-6 text-sm text-rose-200">
          Pulse could not load this execution day. Refresh the page to try again.
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
              <div className="flex items-center justify-between"><span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Execution plan</span><SquareCheckBig className="h-4 w-4 text-indigo-400" /></div>
              <p className="mt-2 text-2xl font-black tracking-tight text-white">{dashboard.summary.completed}/{dashboard.summary.planned}</p>
              <p className="mt-1 text-[11px] font-medium text-slate-400">{dashboard.summary.completion_percentage}% of planned tasks complete</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
              <div className="flex items-center justify-between"><span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Focus time</span><Clock3 className="h-4 w-4 text-emerald-400" /></div>
              <p className="mt-2 text-2xl font-black tracking-tight text-white">{formatFocusTotal(dashboard.summary.focused_seconds)}</p>
              <p className="mt-1 text-[11px] font-medium text-slate-400">Tracked in completed and active sessions</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
              <div className="flex items-center justify-between"><span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Ready to plan</span><Plus className="h-4 w-4 text-amber-400" /></div>
              <p className="mt-2 text-2xl font-black tracking-tight text-white">{dashboard.candidate_tasks.length}</p>
              <p className="mt-1 text-[11px] font-medium text-slate-400">Visible open tasks that fit this day</p>
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <section className="space-y-7">
              {BLOCKS.map((block) => {
                const items = plansByBlock[block.id];
                const isActive = activeBlock === block.id;
                return (
                  <section key={block.id} className="space-y-3">
                    <div className="flex items-end justify-between gap-4 border-b border-slate-800/80 pb-3">
                      <div className="flex items-center gap-3">
                        <span className={`flex h-7 w-7 items-center justify-center rounded-lg border text-[11px] font-black ${isActive ? "border-indigo-600 bg-indigo-600 text-white shadow-md shadow-indigo-600/30" : "border-slate-800 bg-slate-900 text-slate-400"}`}>
                          {block.id.slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <h2 className={`text-xs font-extrabold uppercase tracking-widest ${isActive ? "text-indigo-300" : "text-slate-400"}`}>{block.label}</h2>
                          <p className="mt-0.5 text-[11px] text-slate-500">{block.range} · {block.description}</p>
                        </div>
                      </div>
                      <span className="text-[11px] font-bold text-slate-500">{items.filter((item) => item.task_status === "done").length}/{items.length} done</span>
                    </div>

                    <div className="space-y-2">
                      {items.map((item) => {
                        const complete = item.task_status === "done";
                        const inFocus = session?.plan_item === item.id;
                        return (
                          <div key={item.id} className={`group flex items-center gap-3 rounded-xl border p-3 transition ${inFocus ? "border-indigo-700/70 bg-indigo-950/30" : "border-slate-800 bg-slate-900/70 hover:border-slate-700"}`}>
                            <button
                              type="button"
                              aria-label={complete ? `${item.task_title} is complete` : `Mark ${item.task_title} complete`}
                              disabled={complete || !item.can_complete_task || working}
                              onClick={() => void completeTask(item)}
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${complete ? "border-emerald-700 bg-emerald-500 text-slate-950" : item.can_complete_task ? "border-slate-600 text-transparent hover:border-indigo-400 hover:bg-indigo-500/10" : "cursor-not-allowed border-slate-800 text-transparent"}`}
                            >
                              <Check className="h-3.5 w-3.5 stroke-[3]" />
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Link href={`/projects/${item.project_id}`} className={`truncate text-xs font-bold transition hover:text-indigo-300 ${complete ? "text-slate-500 line-through" : "text-white"}`}>{item.task_title}</Link>
                                {inFocus && <span className="rounded-full border border-indigo-700/50 bg-indigo-950 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-indigo-300">In focus</span>}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-medium text-slate-500">
                                <span>{item.project_name}</span><span>·</span><span>{item.task_type}</span>{item.due_date && <><span>·</span><span>Due {item.due_date}</span></>}
                              </div>
                            </div>
                            <span className={`hidden rounded-md border px-2 py-0.5 text-[10px] font-bold sm:inline-flex ${PRIORITY_CLASSES[item.task_priority]}`}>{item.task_priority}</span>
                            <button type="button" aria-label={`Remove ${item.task_title} from the day`} disabled={working} onClick={() => void removePlanItem(item)} className="rounded-lg p-1.5 text-slate-600 opacity-0 transition hover:bg-rose-950/50 hover:text-rose-300 group-hover:opacity-100 focus:opacity-100">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                      {items.length === 0 && <p className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 px-3 py-4 text-center text-[11px] text-slate-500">No tasks in this segment yet.</p>}
                      <button type="button" onClick={() => setAddingTo(block.id)} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-800 px-3 py-2.5 text-[11px] font-bold text-slate-500 transition hover:border-indigo-700/70 hover:bg-indigo-950/20 hover:text-indigo-300">
                        <Plus className="h-3.5 w-3.5" /> Add task to {block.id}
                      </button>
                    </div>
                  </section>
                );
              })}

              {addingTo && (
                <div className="rounded-2xl border border-indigo-800/60 bg-slate-900 p-5 shadow-xl shadow-slate-950/40">
                  <div className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-bold text-white">Plan a visible task</h3><p className="mt-1 text-xs text-slate-400">Add it to the {addingTo} segment for {formatSelectedDate(selectedDate)}.</p></div><button type="button" onClick={() => setAddingTo(null)} className="text-xs font-semibold text-slate-400 hover:text-white">Cancel</button></div>
                  {dashboard.candidate_tasks.length ? <div className="mt-4 flex flex-col gap-3 sm:flex-row"><select aria-label="Task to add to Pulse" value={selectedTaskId ?? ""} onChange={(event) => setSelectedTaskId(Number(event.target.value))} className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500"><option value="" disabled>Select a task</option>{dashboard.candidate_tasks.map((task) => <option key={task.id} value={task.id}>{task.title} · {task.project_name}</option>)}</select><button type="button" disabled={!selectedTaskId || savingPlan} onClick={() => void addToPlan()} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-indigo-600/20 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60">{savingPlan ? "Adding…" : "Add to plan"}</button></div> : <p className="mt-4 rounded-xl border border-dashed border-slate-800 px-3 py-4 text-xs text-slate-500">No open, visible tasks are ready to add. Create or assign one from its project board.</p>}
                </div>
              )}
            </section>

            <aside className="space-y-5 xl:sticky xl:top-20 xl:self-start">
              <section className={`overflow-hidden rounded-2xl border p-5 ${session ? "border-indigo-800/70 bg-indigo-950/30" : "border-slate-800 bg-slate-900/90"}`}>
                <div className="flex items-center justify-between"><span className="text-[10px] font-extrabold uppercase tracking-widest text-indigo-300">Focus session</span><span className={`flex h-2 w-2 rounded-full ${session?.status === "active" ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} /></div>
                <p className="mt-5 font-mono text-4xl font-black tracking-tight text-white tabular-nums">{formatDuration(elapsed)}</p>
                <div className="mt-3 min-h-10"><p className="text-xs font-bold text-slate-200">{session?.task_title || "Ready when you are"}</p><p className="mt-0.5 text-[11px] text-slate-400">{session?.project_name || "Start with the next task in your execution plan."}</p></div>
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button type="button" disabled={working} onClick={() => void controlFocus()} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-600/30 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60">
                    {session?.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {session?.status === "active" ? "Pause" : session ? "Resume" : "Start"}
                  </button>
                  <button type="button" disabled={!session || working} onClick={() => void finishFocus()} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs font-bold text-slate-300 transition hover:border-emerald-700 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"><CheckCircle2 className="h-3.5 w-3.5" /> Finish</button>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
                <div className="flex items-center justify-between"><div className="flex items-center gap-2"><LockKeyhole className="h-3.5 w-3.5 text-slate-500" /><h2 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Private scratchpad</h2></div><span className="text-[10px] font-semibold text-slate-600">Only you</span></div>
                <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={7} placeholder="Capture decisions, distractions, or the next step…" className="mt-3 w-full resize-none rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs leading-relaxed text-slate-200 outline-none placeholder:text-slate-600 focus:border-indigo-500" />
                <button type="button" disabled={savingNote} onClick={() => void saveNote()} className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-300 transition hover:border-indigo-700 hover:text-white disabled:opacity-60"><Save className="h-3.5 w-3.5" />{savingNote ? "Saving…" : "Save scratchpad"}</button>
              </section>

              <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
                <div className="flex items-center justify-between"><h2 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Seven-day follow-through</h2><span className="text-[10px] font-bold text-emerald-400">{dashboard.summary.completion_percentage}% today</span></div>
                <div className="mt-5 flex h-20 items-end justify-between gap-1.5">
                  {dashboard.weekly_progress.map((day) => {
                    const percentage = day.total ? Math.max(12, Math.round((day.completed / day.total) * 100)) : 6;
                    const shortDay = new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(new Date(`${day.date}T12:00:00`));
                    return <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-1.5"><span className="w-full rounded-t-sm bg-indigo-500/80 transition-all" style={{ height: `${percentage}%` }} title={`${day.completed} of ${day.total} completed`} /><span className="text-[9px] font-bold text-slate-500">{shortDay}</span></div>;
                  })}
                </div>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
