"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import type { Paginated, Project, Task, TaskStatus } from "@/lib/types";
import {
  Avatar,
  Badge,
  PRIORITY_STYLES,
  STATUS_DOT,
  TASK_COLUMNS,
  TASK_STATUS_LABELS,
} from "@/lib/ui";

export default function ProjectBoardPage() {
  const params = useParams<{ id: string }>();
  const projectId = Number(params.id);

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Task | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [adding, setAdding] = useState<TaskStatus | null>(null);
  const [newTitle, setNewTitle] = useState("");

  const load = useCallback(() => {
    Promise.all([
      apiFetch<Project>(`/projects/${projectId}/`),
      apiFetch<Paginated<Task>>(`/tasks/?project=${projectId}`),
    ])
      .then(([p, t]) => {
        setProject(p);
        setTasks(t.results);
      })
      .catch((err) => console.error("Error loading board data", err))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(load, [load]);

  async function moveTask(task: Task, status: TaskStatus) {
    if (task.status === status) return;
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status } : t))
    );
    await apiFetch(`/tasks/${task.id}/`, {
      method: "PATCH",
      body: { status },
    });
  }

  async function addTask(status: TaskStatus, e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const created = await apiFetch<Task>("/tasks/", {
      method: "POST",
      body: { project: projectId, title: newTitle, status, priority: "medium" },
    });
    setTasks((prev) => [...prev, created]);
    setNewTitle("");
    setAdding(null);
  }

  if (loading) return <div className="text-slate-400 flex h-64 items-center justify-center font-medium">Loading project board…</div>;
  if (!project) return <div className="text-slate-400 p-6 text-center">Project not found.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-800">{project.name}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {project.description || "No description."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {TASK_COLUMNS.map((col) => {
          const colTasks = tasks
            .filter((t) => t.status === col)
            .sort((a, b) => a.order - b.order);
          return (
            <div
              key={col}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                const task = tasks.find((t) => t.id === dragId);
                if (task) moveTask(task, col);
                setDragId(null);
              }}
              className="flex flex-col rounded-xl bg-slate-100 p-3 min-h-[400px]"
            >
              <div className="mb-3 flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[col]}`}
                  />
                  <span className="text-sm font-bold text-slate-700">
                    {TASK_STATUS_LABELS[col]}
                  </span>
                  <span className="text-xs font-semibold text-slate-400 bg-slate-200/60 px-1.5 py-0.5 rounded">
                    {colTasks.length}
                  </span>
                </div>
                <button
                  onClick={() => {
                    setAdding(adding === col ? null : col);
                    setNewTitle("");
                  }}
                  className="text-lg leading-none text-slate-400 hover:text-indigo-600 transition"
                  title="Create Ticket"
                >
                  +
                </button>
              </div>

              {adding === col && (
                <form onSubmit={(e) => addTask(col, e)} className="mb-2">
                  <input
                    autoFocus
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Ticket title..."
                    className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-indigo-500"
                  />
                </form>
              )}

              <div className="flex flex-1 flex-col gap-2">
                {colTasks.map((t) => (
                  <button
                    key={t.id}
                    draggable
                    onDragStart={() => setDragId(t.id)}
                    onClick={() => setSelected(t)}
                    className="cursor-pointer rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:shadow-md hover:border-slate-300"
                  >
                    <div className="mb-3 text-sm font-semibold text-slate-800">
                      {t.title}
                    </div>
                    <div className="flex items-center justify-between border-t border-slate-50 pt-2.5">
                      <Badge className={PRIORITY_STYLES[t.priority]}>
                        {t.priority}
                      </Badge>
                      {t.assignee_detail && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-slate-400 font-medium">{t.assignee_detail.name.split(" ")[0]}</span>
                          <Avatar
                            name={t.assignee_detail.name}
                            email={t.assignee_detail.email}
                            size={20}
                          />
                        </div>
                      )}
                    </div>
                  </button>
                ))}
                {colTasks.length === 0 && adding !== col && (
                  <div className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400 font-medium">
                    No tickets
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <TaskPanel
          task={selected}
          onClose={() => setSelected(null)}
          onChanged={(updated) => {
            setTasks((prev) =>
              prev.map((t) => (t.id === updated.id ? updated : t))
            );
            setSelected(updated);
          }}
        />
      )}
    </div>
  );
}

function TaskPanel({
  task,
  onClose,
  onChanged,
}: {
  task: Task;
  onClose: () => void;
  onChanged: (t: Task) => void;
}) {
  const [comment, setComment] = useState("");
  const [detail, setDetail] = useState<Task>(task);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    apiFetch<Task>(`/tasks/${task.id}/`).then(setDetail);
  }, [task.id]);

  async function updateStatus(status: TaskStatus) {
    const updated = await apiFetch<Task>(`/tasks/${task.id}/`, {
      method: "PATCH",
      body: { status },
    });
    setDetail((d) => ({ ...d, status: updated.status }));
    onChanged({ ...detail, status: updated.status });
  }

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    setPosting(true);
    try {
      await apiFetch(`/tasks/${task.id}/comments/`, {
        method: "POST",
        body: { body: comment },
      });
      const refreshed = await apiFetch<Task>(`/tasks/${task.id}/`);
      setDetail(refreshed);
      setComment("");
    } catch (err) {
      console.error(err);
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40 backdrop-blur-xs" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-auto bg-white p-6 shadow-xl border-l border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">{detail.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 transition"
          >
            ✕
          </button>
        </div>

        <div className="mb-6 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">Priority:</span>
            <Badge className={PRIORITY_STYLES[detail.priority]}>
              {detail.priority}
            </Badge>
          </div>
          {detail.assignee_detail && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-medium">Assignee:</span>
              <span className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold">
                <Avatar
                  name={detail.assignee_detail.name}
                  email={detail.assignee_detail.email}
                  size={20}
                />
                {detail.assignee_detail.name}
              </span>
            </div>
          )}
          {detail.created_by_detail && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-medium">Created by:</span>
              <span className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold">
                <Avatar
                  name={detail.created_by_detail.name}
                  email={detail.created_by_detail.email}
                  size={20}
                />
                {detail.created_by_detail.name}
              </span>
            </div>
          )}
        </div>

        {detail.description && (
          <div className="mb-6 p-3 bg-slate-50 border border-slate-100 rounded-lg">
            <label className="block text-xs font-semibold text-slate-400 mb-1">Description</label>
            <p className="whitespace-pre-wrap text-sm text-slate-600 leading-relaxed">
              {detail.description}
            </p>
          </div>
        )}

        <div className="mb-6 border-t border-slate-100 pt-4">
          <label className="mb-2 block text-xs font-bold text-slate-500 uppercase tracking-wider">
            Ticket Status
          </label>
          <div className="flex flex-wrap gap-1.5">
            {TASK_COLUMNS.map((s) => (
              <button
                key={s}
                onClick={() => updateStatus(s)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  detail.status === s
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {TASK_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">
            Activity Log & Comments ({detail.comments.length})
          </h3>
          <ul className="mb-4 space-y-3">
            {detail.comments.map((c) => (
              <li key={c.id} className="flex gap-2.5">
                <Avatar
                  name={c.author_detail?.name || ""}
                  email={c.author_detail?.email}
                  size={26}
                />
                <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-700">
                      {c.author_detail?.name || "System"}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(c.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="text-sm text-slate-600 mt-1">{c.body}</div>
                </div>
              </li>
            ))}
            {detail.comments.length === 0 && (
              <li className="text-sm text-slate-400 py-2">No comments yet.</li>
            )}
          </ul>
          <form onSubmit={addComment} className="flex gap-2">
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a comment..."
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={posting}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition"
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
