"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, dispatchAgentSwarm, getAgentTraces, ingestRAGKnowledge } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type {
  AgentExecutionTrace,
  Paginated,
  Priority,
  Project,
  Task,
  TaskStatus,
  TaskType,
  User,
} from "@/lib/types";
import {
  Avatar,
  Badge,
  PRIORITY_STYLES,
  ROLE_LABELS,
  STATUS_DOT,
  TASK_COLUMNS,
  TASK_STATUS_LABELS,
  TASK_TYPE_STYLES,
} from "@/lib/ui";
import { toast } from "sonner";
import {
  ArrowLeft,
  Plus,
  Search,
  Bot,
  Sparkles,
  Database,
  CheckCircle2,
  XCircle,
  GitPullRequest,
  MessageSquare,
  Activity,
  AlertTriangle,
  ExternalLink,
  Code,
  Terminal,
  Cpu,
  Layers,
  Calendar,
  X,
} from "lucide-react";

export default function ProjectBoardPage() {
  const params = useParams<{ id: string }>();
  const projectId = Number(params.id);
  const { user } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Task | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAssignee, setFilterAssignee] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");

  // Create Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [targetColumn, setTargetColumn] = useState<TaskStatus>("todo");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newType, setNewType] = useState<TaskType>("feature");
  const [newPriority, setNewPriority] = useState<Priority>("medium");
  const [newAssignee, setNewAssignee] = useState<string>("");
  const [newDueDate, setNewDueDate] = useState<string>("");
  const [newPrUrl, setNewPrUrl] = useState<string>("");
  const [ingestingRag, setIngestingRag] = useState(false);

  async function handleIngestRag() {
    setIngestingRag(true);
    try {
      const res = await ingestRAGKnowledge(projectId);
      toast.success(res.message || "RAG knowledge indexed in pgvector");
    } catch (err) {
      toast.error("Error ingesting RAG knowledge: " + String(err));
    } finally {
      setIngestingRag(false);
    }
  }

  const load = useCallback(() => {
    Promise.all([
      apiFetch<Project>(`/projects/${projectId}/`),
      apiFetch<Paginated<Task>>(`/tasks/?project=${projectId}`),
      apiFetch<Paginated<User>>("/users/"),
    ])
      .then(([p, t, u]) => {
        setProject(p);
        setTasks(t.results || []);
        setTeamMembers(u.results || []);
      })
      .catch((err) => console.error("Error loading project board:", err))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function moveTask(task: Task, toStatus: TaskStatus) {
    if (task.status === toStatus) return;

    // Optimistic UI update
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: toStatus } : t))
    );

    try {
      await apiFetch<Task>(`/tasks/${task.id}/`, {
        method: "PATCH",
        body: { status: toStatus },
      });
      toast.info(`Moved ticket to ${TASK_STATUS_LABELS[toStatus]}`);
      load();
    } catch {
      toast.error("Failed to move ticket");
      load();
    }
  }

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      const created = await apiFetch<Task>("/tasks/", {
        method: "POST",
        body: {
          project: projectId,
          title: newTitle,
          description: newDescription,
          status: targetColumn,
          task_type: newType,
          priority: newPriority,
          assignee: newAssignee ? Number(newAssignee) : null,
          due_date: newDueDate || null,
          pr_url: newPrUrl || "",
        },
      });
      setTasks((prev) => [...prev, created]);
      setShowCreateModal(false);
      setNewTitle("");
      setNewDescription("");
      setNewPrUrl("");
      setNewDueDate("");
      toast.success("Created new ticket");
      load();
    } catch {
      toast.error("Failed to create ticket");
    }
  }

  // Filter tasks
  const filteredTasks = tasks.filter((t) => {
    if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (filterAssignee !== "all" && String(t.assignee) !== filterAssignee) {
      return false;
    }
    if (filterPriority !== "all" && t.priority !== filterPriority) {
      return false;
    }
    if (filterType !== "all" && t.task_type !== filterType) {
      return false;
    }
    return true;
  });

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-500 font-semibold text-xs tracking-wider uppercase">
        Loading SuperDesign Kanban Board…
      </div>
    );
  }
  if (!project) return <div className="p-6 text-center text-slate-400">Project not found.</div>;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Project Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/projects" className="text-xs text-indigo-400 hover:underline font-semibold flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" />
              <span>Projects</span>
            </Link>
            <span className="text-slate-600">/</span>
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest bg-slate-800 px-2 py-0.5 rounded-md">
              {project.status}
            </span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white mt-1">
            {project.name}
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">{project.description || "No description provided."}</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleIngestRag}
            disabled={ingestingRag}
            className="rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Ingest architecture documents & codebase chunks into pgvector"
          >
            <Database className="h-3.5 w-3.5 text-indigo-400" />
            <span>{ingestingRag ? "Ingesting pgvector…" : "Ingest RAG Knowledge"}</span>
          </button>

          <button
            onClick={() => {
              setTargetColumn("todo");
              setShowCreateModal(true);
            }}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-indigo-600/30 hover:bg-indigo-500 transition flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Ticket</span>
          </button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="flex flex-wrap items-center gap-3 bg-slate-900/90 p-3.5 rounded-2xl border border-slate-800 shadow-xs">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search tickets by title..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-8.5 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <select
          value={filterAssignee}
          onChange={(e) => setFilterAssignee(e.target.value)}
          className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-300 focus:outline-none focus:border-indigo-500"
        >
          <option value="all">All Assignees</option>
          {teamMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name || m.email}
            </option>
          ))}
        </select>

        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-300 focus:outline-none focus:border-indigo-500"
        >
          <option value="all">All Priorities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Critical</option>
        </select>

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-300 focus:outline-none focus:border-indigo-500"
        >
          <option value="all">All Types</option>
          <option value="feature">Feature</option>
          <option value="bug">Bug</option>
          <option value="task">Task</option>
        </select>

        {(searchQuery || filterAssignee !== "all" || filterPriority !== "all" || filterType !== "all") && (
          <button
            onClick={() => {
              setSearchQuery("");
              setFilterAssignee("all");
              setFilterPriority("all");
              setFilterType("all");
            }}
            className="text-xs font-bold text-rose-400 hover:underline px-2 cursor-pointer"
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* 5-Column Kanban Board */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 items-start">
        {TASK_COLUMNS.map((col) => {
          const colTasks = filteredTasks
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
              className="flex flex-col rounded-2xl bg-slate-900/80 border border-slate-800 p-3.5 min-h-[540px] shadow-sm"
            >
              <div className="mb-3.5 flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${STATUS_DOT[col]}`} />
                  <span className="text-xs font-extrabold text-white tracking-tight uppercase">
                    {TASK_STATUS_LABELS[col]}
                  </span>
                  <span className="text-[11px] font-black text-slate-400 bg-slate-950 px-2 py-0.5 rounded-md border border-slate-800">
                    {colTasks.length}
                  </span>
                </div>
                <button
                  onClick={() => {
                    setTargetColumn(col);
                    setShowCreateModal(true);
                  }}
                  className="h-6 w-6 rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 flex items-center justify-center font-bold text-sm shadow-xs transition cursor-pointer"
                  title={`Add ticket to ${TASK_STATUS_LABELS[col]}`}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex flex-1 flex-col gap-2.5">
                {colTasks.map((t) => {
                  const typeInfo = TASK_TYPE_STYLES[t.task_type || "task"];
                  const priorityInfo = PRIORITY_STYLES[t.priority || "medium"];

                  return (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={() => setDragId(t.id)}
                      onClick={() => setSelected(t)}
                      className={`cursor-pointer rounded-xl border p-3.5 text-left shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-600 ${
                        t.qa_rejected
                          ? "border-rose-800/60 bg-rose-950/20"
                          : "border-slate-800 bg-slate-950/90 hover:bg-slate-950"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-2">
                        <Badge className={typeInfo.style}>
                          <span className="mr-1">{typeInfo.icon}</span>
                          {typeInfo.label}
                        </Badge>
                        <Badge className={priorityInfo.style}>{priorityInfo.label}</Badge>
                      </div>

                      <div className="text-xs font-bold text-white leading-snug line-clamp-2 mb-2">
                        {t.title}
                      </div>

                      {t.qa_rejected && (
                        <div className="mb-2 rounded-lg bg-rose-950/60 border border-rose-800/40 px-2 py-1 text-[10px] text-rose-300 font-semibold flex items-center gap-1.5">
                          <XCircle className="h-3 w-3 text-rose-400 shrink-0" />
                          <span>QA Rejected</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between border-t border-slate-800/80 pt-2 text-[10px] text-slate-500">
                        <div className="flex items-center gap-2">
                          {t.pr_url && (
                            <span className="text-indigo-400 font-bold flex items-center gap-1" title="GitHub PR Linked">
                              <GitPullRequest className="h-3 w-3 inline" /> PR
                            </span>
                          )}
                          {t.comments?.length > 0 && (
                            <span className="flex items-center gap-1">
                              <MessageSquare className="h-3 w-3 inline" /> {t.comments.length}
                            </span>
                          )}
                        </div>
                        {t.assignee_detail ? (
                          <div className="flex items-center gap-1.5">
                            <span className="truncate max-w-[70px] text-slate-300 font-semibold">
                              {t.assignee_detail.name.split(" ")[0]}
                            </span>
                            <Avatar name={t.assignee_detail.name} email={t.assignee_detail.email} size={18} />
                          </div>
                        ) : (
                          <span className="text-slate-600 italic">Unassigned</span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {colTasks.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-800 py-10 text-center text-xs text-slate-600 font-medium">
                    Empty column
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Create Ticket Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 p-6 shadow-2xl border border-slate-800 animate-in fade-in zoom-in-95 duration-150 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h2 className="text-base font-bold text-white">Create New Ticket</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateTask} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Title *</label>
                <input
                  required
                  autoFocus
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Implement user login with JWT"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Description</label>
                <textarea
                  rows={3}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Requirements, acceptance criteria, context..."
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Type</label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as TaskType)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="feature">Feature</option>
                    <option value="bug">Bug</option>
                    <option value="task">Task</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Priority</label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as Priority)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Critical</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Assignee</label>
                  <select
                    value={newAssignee}
                    onChange={(e) => setNewAssignee(e.target.value)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">Unassigned</option>
                    {teamMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name || m.email} ({ROLE_LABELS[m.role] || m.role})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-500 transition cursor-pointer"
                >
                  Create Ticket
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Task Detail Drawer */}
      {selected && (
        <TaskDetailPanel
          task={selected}
          teamMembers={teamMembers}
          currentUserRole={user?.role}
          onClose={() => setSelected(null)}
          onChanged={(updated) => {
            setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
            setSelected(updated);
          }}
        />
      )}
    </div>
  );
}

function TaskDetailPanel({
  task,
  teamMembers,
  currentUserRole,
  onClose,
  onChanged,
}: {
  task: Task;
  teamMembers: User[];
  currentUserRole?: string;
  onClose: () => void;
  onChanged: (t: Task) => void;
}) {
  const [comment, setComment] = useState("");
  const [detail, setDetail] = useState<Task>(task);
  const [activeTab, setActiveTab] = useState<"comments" | "activity" | "agents">("comments");
  const [posting, setPosting] = useState(false);
  const [rejectModal, setRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [traces, setTraces] = useState<AgentExecutionTrace[]>([]);
  const [runningSwarm, setRunningSwarm] = useState(false);

  const refresh = useCallback(() => {
    apiFetch<Task>(`/tasks/${task.id}/`).then(setDetail);
    getAgentTraces(task.id).then(setTraces).catch(() => {});
  }, [task.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function updateField(patch: Partial<Task>) {
    const updated = await apiFetch<Task>(`/tasks/${task.id}/`, {
      method: "PATCH",
      body: patch,
    });
    setDetail(updated);
    onChanged(updated);
  }

  async function handleRunSwarm() {
    setRunningSwarm(true);
    try {
      const res = await dispatchAgentSwarm(detail.id);
      setTraces((prev) => [res.trace, ...prev.filter((t) => t.id !== res.trace.id)]);
      setActiveTab("agents");
      refresh();
      onChanged({ ...detail, status: res.task_status });
      toast.success("Autonomous multi-agent swarm completed!");
    } catch (err) {
      toast.error("Error executing multi-agent swarm: " + String(err));
    } finally {
      setRunningSwarm(false);
    }
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
      refresh();
      setComment("");
      toast.success("Comment added");
    } catch (err) {
      toast.error("Failed to add comment");
    } finally {
      setPosting(false);
    }
  }

  async function handleQaValidate() {
    try {
      const res = await apiFetch<Task>(`/tasks/${task.id}/qa_validate/`, { method: "POST" });
      setDetail(res);
      onChanged(res);
      toast.success("Ticket QA Approved and marked Done!");
    } catch (err) {
      toast.error("QA validation failed.");
    }
  }

  async function handleQaReject(e: React.FormEvent) {
    e.preventDefault();
    if (!rejectReason.trim()) return;
    try {
      const res = await apiFetch<Task>(`/tasks/${task.id}/qa_reject/`, {
        method: "POST",
        body: { reason: rejectReason },
      });
      setDetail(res);
      onChanged(res);
      setRejectModal(false);
      setRejectReason("");
      toast.warning("Ticket QA Rejected and sent back to In Progress.");
    } catch (err) {
      toast.error("QA rejection failed.");
    }
  }

  const typeInfo = TASK_TYPE_STYLES[detail.task_type || "task"];
  const priorityInfo = PRIORITY_STYLES[detail.priority || "medium"];
  const canPerformQa =
    currentUserRole === "qa" ||
    currentUserRole === "tech_lead" ||
    currentUserRole === "ceo" ||
    currentUserRole === "admin";

  const latestTrace = traces[0] || null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-xs" onClick={onClose}>
      <div
        className="h-full w-full max-w-xl overflow-y-auto bg-slate-900 p-6 shadow-2xl border-l border-slate-800 flex flex-col justify-between"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Badge className={typeInfo.style}>
                  <span className="mr-1">{typeInfo.icon}</span>
                  {typeInfo.label}
                </Badge>
                <Badge className={priorityInfo.style}>{priorityInfo.label}</Badge>
              </div>
              <h2 className="text-lg font-black text-white leading-tight">{detail.title}</h2>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Autonomous Multi-Agent Swarm Banner */}
          <div className="p-4 bg-gradient-to-r from-indigo-950 via-slate-900 to-slate-950 text-white rounded-2xl shadow-sm border border-indigo-800/40">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <Bot className="h-3.5 w-3.5 text-indigo-400" />
                  <span className="text-xs font-black uppercase tracking-wider text-indigo-300">
                    LangGraph Multi-Agent Swarm
                  </span>
                </div>
                <p className="text-xs text-slate-300 font-medium">
                  Decompose with Tech Lead, code with Backend/Frontend, QA test, and deploy.
                </p>
              </div>

              <button
                type="button"
                onClick={handleRunSwarm}
                disabled={runningSwarm}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white shadow-md shadow-indigo-600/30 hover:bg-indigo-500 disabled:opacity-60 transition cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>{runningSwarm ? "Running Swarm…" : "Run Swarm"}</span>
              </button>
            </div>
          </div>

          {/* QA Alert if Rejected */}
          {detail.qa_rejected && (
            <div className="p-3.5 bg-rose-950/60 border border-rose-800/50 rounded-xl text-xs text-rose-300 space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-rose-200">
                <XCircle className="h-3.5 w-3.5 text-rose-400" />
                <span>QA Review Rejection Note</span>
              </div>
              <p className="leading-relaxed font-medium">{detail.qa_rejection_reason || "Rejection reason specified in comments."}</p>
            </div>
          )}

          {/* QA Workflow Actions Bar */}
          {detail.status === "qa" && canPerformQa && (
            <div className="p-4 bg-purple-950/40 border border-purple-800/40 rounded-xl space-y-2">
              <span className="text-xs font-black text-purple-200 uppercase tracking-wider block">
                QA Engineer Decision Gate
              </span>
              <p className="text-xs text-slate-300">
                Verify this ticket against acceptance criteria and PR review before approval.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleQaValidate}
                  className="flex-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-500 transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Approve & Close</span>
                </button>
                <button
                  onClick={() => setRejectModal(true)}
                  className="flex-1 rounded-xl bg-rose-600 px-3 py-2 text-xs font-bold text-white shadow-xs hover:bg-rose-500 transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  <span>Reject to In Progress</span>
                </button>
              </div>
            </div>
          )}

          {/* Core Properties */}
          <div className="grid grid-cols-2 gap-4 text-xs bg-slate-950/70 p-4 rounded-xl border border-slate-800">
            <div>
              <span className="text-slate-400 block font-semibold mb-1">Assignee</span>
              <select
                value={detail.assignee || ""}
                onChange={(e) => updateField({ assignee: e.target.value ? Number(e.target.value) : null })}
                className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-white font-semibold focus:outline-none"
              >
                <option value="">Unassigned</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.email}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="text-slate-400 block font-semibold mb-1">Priority</span>
              <select
                value={detail.priority}
                onChange={(e) => updateField({ priority: e.target.value as Priority })}
                className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-white font-semibold focus:outline-none"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Critical</option>
              </select>
            </div>

            {detail.due_date && (
              <div>
                <span className="text-slate-400 block font-semibold mb-0.5">Due Date</span>
                <span className="font-bold text-slate-200 flex items-center gap-1">
                  <Calendar className="h-3 w-3 inline text-slate-400" /> {detail.due_date}
                </span>
              </div>
            )}

            {detail.pr_url && (
              <div>
                <span className="text-slate-400 block font-semibold mb-0.5">Pull Request</span>
                <a
                  href={detail.pr_url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold text-indigo-400 hover:underline inline-flex items-center gap-1"
                >
                  <GitPullRequest className="h-3 w-3" />
                  <span>GitHub PR</span>
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>
            )}
          </div>

          {/* Description */}
          {detail.description && (
            <div>
              <label className="block text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5">
                Description
              </label>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
                {detail.description}
              </div>
            </div>
          )}

          {/* Status Progression */}
          <div>
            <label className="block text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-2">
              Status Progression
            </label>
            <div className="flex flex-wrap gap-1.5">
              {TASK_COLUMNS.map((s) => (
                <button
                  key={s}
                  onClick={() => updateField({ status: s })}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                    detail.status === s
                      ? "bg-indigo-600 text-white shadow-xs"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                  }`}
                >
                  {TASK_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div className="border-t border-slate-800 pt-4">
            <div className="flex items-center gap-3 border-b border-slate-800 mb-4 overflow-x-auto">
              <button
                onClick={() => setActiveTab("comments")}
                className={`pb-2 text-xs font-bold uppercase tracking-wider transition whitespace-nowrap cursor-pointer ${
                  activeTab === "comments"
                    ? "border-b-2 border-indigo-500 text-indigo-400 font-extrabold"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                Comments ({detail.comments?.length || 0})
              </button>
              <button
                onClick={() => setActiveTab("activity")}
                className={`pb-2 text-xs font-bold uppercase tracking-wider transition whitespace-nowrap cursor-pointer ${
                  activeTab === "activity"
                    ? "border-b-2 border-indigo-500 text-indigo-400 font-extrabold"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                Audit Trail ({detail.activities?.length || 0})
              </button>
              <button
                onClick={() => setActiveTab("agents")}
                className={`pb-2 text-xs font-bold uppercase tracking-wider transition whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                  activeTab === "agents"
                    ? "border-b-2 border-indigo-500 text-indigo-400 font-extrabold"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <Bot className="h-3.5 w-3.5" />
                <span>Multi-Agent Traces ({traces.length})</span>
              </button>
            </div>

            {/* TAB: Multi-Agent Workflow */}
            {activeTab === "agents" && (
              <div className="space-y-4">
                {latestTrace ? (
                  <div className="space-y-4">
                    {/* Langfuse Observability Card */}
                    <div className="rounded-xl border border-indigo-800/40 bg-indigo-950/40 p-3.5 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-indigo-400"></span>
                          <span className="font-bold text-indigo-200 font-mono text-[11px]">
                            {latestTrace.session_id}
                          </span>
                        </div>
                        <span className="font-bold text-emerald-300 bg-emerald-950 border border-emerald-800/50 px-2 py-0.5 rounded-md text-[10px] uppercase tracking-wider">
                          {latestTrace.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2 pt-1 border-t border-indigo-800/40 text-[11px]">
                        <div>
                          <span className="text-indigo-400 block font-medium">Tokens</span>
                          <span className="font-bold text-white">{latestTrace.tokens_used.toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-indigo-400 block font-medium">Cost</span>
                          <span className="font-bold text-white">${Number(latestTrace.cost_usd).toFixed(4)}</span>
                        </div>
                        <div>
                          <span className="text-indigo-400 block font-medium">Duration</span>
                          <span className="font-bold text-white">{latestTrace.duration_seconds}s</span>
                        </div>
                      </div>

                      <div className="pt-1 flex justify-end">
                        <a
                          href={latestTrace.langfuse_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] font-bold text-indigo-400 hover:text-indigo-300 hover:underline inline-flex items-center gap-1"
                        >
                          <span>View Session in Langfuse</span>
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </div>
                    </div>

                    {/* Step-by-Step Multi-Agent Execution Timeline */}
                    <div className="space-y-2.5">
                      <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest block">
                        Agent Orchestration Timeline
                      </span>
                      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                        {latestTrace.steps?.map((step, idx) => (
                          <div
                            key={idx}
                            className="p-3 rounded-xl border border-slate-800 bg-slate-950 space-y-1.5 text-xs"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <Bot className="h-3.5 w-3.5 text-indigo-400" />
                                <span className="font-bold text-white">{step.agent_role}</span>
                              </div>
                              <span className="text-[10px] text-slate-500 font-mono">
                                {step.tokens ? `${step.tokens} tokens` : ""}
                              </span>
                            </div>

                            <p className="text-slate-300 leading-relaxed font-medium">
                              {step.message}
                            </p>

                            {step.pr_url && (
                              <div className="pt-1">
                                <a
                                  href={step.pr_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-400 bg-indigo-950/60 border border-indigo-800/40 px-2 py-0.5 rounded-md hover:text-indigo-300"
                                >
                                  <GitPullRequest className="h-3 w-3" />
                                  <span>{step.pr_url}</span>
                                </a>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* RAG Context Box */}
                    {latestTrace.graph_state?.retrieved_context && latestTrace.graph_state.retrieved_context.length > 0 && (
                      <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between text-slate-400 font-bold text-[10px] uppercase tracking-wider">
                          <span className="flex items-center gap-1.5">
                            <Database className="h-3 w-3 text-indigo-400" />
                            <span>RAG Context Retrieved ({latestTrace.graph_state.retrieved_context.length} chunks)</span>
                          </span>
                          <span className="font-mono">pgvector</span>
                        </div>
                        <div className="max-h-28 overflow-y-auto space-y-1 text-[11px] text-slate-400 font-mono bg-slate-900 p-2 rounded-lg border border-slate-800">
                          {latestTrace.graph_state.retrieved_context.map((chunk, cIdx) => (
                            <div key={cIdx} className="border-b border-slate-800 pb-1 last:border-0 last:pb-0">
                              {chunk}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-6 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 space-y-3">
                    <Bot className="h-8 w-8 text-slate-600 mx-auto" />
                    <h4 className="text-xs font-bold text-white">No Multi-Agent Swarm Executed Yet</h4>
                    <p className="text-xs text-slate-400 max-w-xs mx-auto">
                      Run the autonomous LangGraph swarm on this ticket to decompose tasks, write code, run QA, and trigger deployments.
                    </p>
                    <button
                      type="button"
                      onClick={handleRunSwarm}
                      disabled={runningSwarm}
                      className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-500 transition cursor-pointer flex items-center gap-1.5 mx-auto"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>{runningSwarm ? "Executing Swarm…" : "Trigger Autonomous Swarm Now"}</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* TAB: Comments */}
            {activeTab === "comments" && (
              <div className="space-y-4">
                <div className="max-h-60 overflow-y-auto space-y-3 pr-1">
                  {detail.comments?.map((c) => (
                    <div key={c.id} className="flex gap-2.5 text-xs">
                      <Avatar name={c.author_detail?.name || ""} email={c.author_detail?.email} size={26} />
                      <div className="rounded-xl bg-slate-950 border border-slate-800 p-2.5 flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white">{c.author_detail?.name || "System"}</span>
                          <span className="text-[10px] text-slate-500">
                            {new Date(c.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="mt-1 text-slate-300 font-medium">{c.body}</div>
                      </div>
                    </div>
                  ))}
                  {(!detail.comments || detail.comments.length === 0) && (
                    <p className="text-xs text-slate-500 py-2 text-center">No comments yet.</p>
                  )}
                </div>

                <form onSubmit={addComment} className="flex gap-2 pt-2">
                  <input
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Write a comment..."
                    className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={posting}
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-60 transition cursor-pointer"
                  >
                    Post
                  </button>
                </form>
              </div>
            )}

            {/* TAB: Audit Trail */}
            {activeTab === "activity" && (
              <div className="max-h-72 overflow-y-auto space-y-2.5 text-xs pr-1">
                {detail.activities?.map((a) => (
                  <div key={a.id} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-start gap-2.5">
                    <Activity className="h-4 w-4 text-slate-500 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white">{a.actor_detail?.name || "System"}</span>
                        <span className="text-[10px] text-slate-500">
                          {new Date(a.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <div className="text-slate-400 mt-0.5">
                        {a.action === "created"
                          ? "Created this ticket"
                          : a.action === "status_changed"
                          ? `Changed status to ${(a.details as { to?: string })?.to || ""}`
                          : a.action === "qa_validated"
                          ? "Approved QA testing"
                          : a.action === "qa_rejected"
                          ? `Rejected QA: ${(a.details as { reason?: string })?.reason || ""}`
                          : a.action}
                      </div>
                    </div>
                  </div>
                ))}
                {(!detail.activities || detail.activities.length === 0) && (
                  <p className="text-xs text-slate-500 py-2 text-center">No audit records yet.</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* QA Rejection Modal */}
        {rejectModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/70 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-slate-900 p-5 shadow-2xl border border-slate-800 space-y-3">
              <h3 className="text-sm font-bold text-white">Specify QA Rejection Reason</h3>
              <p className="text-xs text-slate-400">
                This explanation is required by the QA workflow and will be logged to the ticket.
              </p>
              <form onSubmit={handleQaReject} className="space-y-3">
                <textarea
                  required
                  rows={3}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Explain why this ticket failed testing..."
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-xs text-slate-200 focus:border-rose-500 focus:outline-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setRejectModal(false)}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-white cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-xl bg-rose-600 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-rose-500 cursor-pointer"
                  >
                    Submit Rejection
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
