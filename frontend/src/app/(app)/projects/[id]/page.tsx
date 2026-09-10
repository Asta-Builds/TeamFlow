"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  apiFetch,
  dispatchAgentSwarm,
  executeSwarmChain,
  getAgentEvents,
  getAgentTraces,
  ingestRAGKnowledge,
  normalizeList,
  streamAgentEvents,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { KanbanSkeleton } from "@/components/skeletons/KanbanSkeleton";
import type {
  AgentExecutionTrace,
  AgentEvent,
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
  AgentTypeBadge,
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
  ExternalLink,
  Calendar,
  X,
  Radio,
  Zap,
  RefreshCw,
  ShieldCheck,
  Clock,
  Terminal,
  Layers,
  Loader2,
  ChevronDown,
  ChevronUp,
  FolderGit2,
  Rocket,
  Lock,
  Globe,
} from "lucide-react";

interface PmGenerateTasksResponse {
  pm_summary?: string;
  tasks_created_count?: number;
}

interface TaskCommentResponse {
  agent_replies?: Array<{ agent_name?: string }>;
  agent_run?: AgentExecutionTrace;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
  const [showFeedModal, setShowFeedModal] = useState(false);

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
  const [showPmModal, setShowPmModal] = useState(false);
  const [pmPlanText, setPmPlanText] = useState("");
  const [generatingPmTasks, setGeneratingPmTasks] = useState(false);

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

  async function handlePmGenerateTasks(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!pmPlanText.trim()) {
      toast.error("Please provide a plan or feature roadmap");
      return;
    }
    setGeneratingPmTasks(true);
    try {
      const res = await apiFetch<PmGenerateTasksResponse>(`/projects/${projectId}/pm_generate_tasks/`, {
        method: "POST",
        body: { plan: pmPlanText.trim() },
      });
      toast.success(res.pm_summary ? "PM Athena created sprint tickets with assigned agents!" : `Created ${res.tasks_created_count || 3} tickets!`);
      setShowPmModal(false);
      setPmPlanText("");
      load();
    } catch (err) {
      toast.error(getErrorMessage(err) || "Failed to generate tasks with AI PM");
    } finally {
      setGeneratingPmTasks(false);
    }
  }

  // DevOps Repo Modal State
  const [showDevopsModal, setShowDevopsModal] = useState(false);
  const [devopsRepoName, setDevopsRepoName] = useState("");
  const [devopsRepoOrg, setDevopsRepoOrg] = useState("Asta-Builds");
  const [devopsRepoPrivate, setDevopsRepoPrivate] = useState(false);
  const [devopsCreatingRepo, setDevopsCreatingRepo] = useState(false);

  async function handleDevopsCreateRepo(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setDevopsCreatingRepo(true);
    try {
      const res = await apiFetch<{
        ok: boolean;
        repo_name?: string;
        html_url?: string;
        error?: string;
      }>(`/projects/${projectId}/devops_create_repo/`, {
        method: "POST",
        body: {
          repo_name: devopsRepoName.trim() || undefined,
          org: devopsRepoOrg.trim() || undefined,
          private: devopsRepoPrivate,
          description: project?.description || undefined,
        },
      });

      if (res.ok && res.html_url) {
        toast.success(
          <div className="flex flex-col gap-1">
            <span className="font-bold text-white">DevOps Agent provisioned GitHub repo!</span>
            <a
              href={res.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-sky-400 hover:underline inline-flex items-center gap-1 font-mono"
            >
              {res.repo_name || res.html_url}
              <ExternalLink className="h-3 w-3 inline" />
            </a>
          </div>
        );
        setShowDevopsModal(false);
        load();
      } else {
        toast.error(res.error || "DevOps Agent failed to provision repo");
      }
    } catch (err) {
      toast.error(getErrorMessage(err) || "Failed to create GitHub repository");
    } finally {
      setDevopsCreatingRepo(false);
    }
  }

  const load = useCallback(() => {
    Promise.all([
      apiFetch<Project>(`/projects/${projectId}/`),
      apiFetch<unknown>(`/tasks/?project=${projectId}`),
      apiFetch<unknown>("/users/"),
    ])
      .then(([p, t, u]) => {
        setProject(p);
        setTasks(normalizeList<Task>(t));
        setTeamMembers(normalizeList<User>(u));
      })
      .catch((err) => console.error("Error loading project board:", err))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function moveTask(task: Task, toStatus: TaskStatus) {
    if (task.status === toStatus) return;

    // Snapshot for rollback
    const previousTasks = [...tasks];

    // Optimistic UI update
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: toStatus } : t))
    );

    try {
      await apiFetch<Task>(`/tasks/${task.id}/`, {
        method: "PATCH",
        body: { status: toStatus },
      });
      toast.success(`Ticket déplacé vers : ${TASK_STATUS_LABELS[toStatus]}`);
    } catch (err) {
      // Instant rollback
      setTasks(previousTasks);
      toast.error(`Échec du déplacement : ${err instanceof Error ? err.message : "Erreur réseau"}`);
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
    return <KanbanSkeleton />;
  }
  if (!project) return <div className="p-6 text-center text-slate-400">Project not found.</div>;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Project Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Link href="/projects" className="text-xs text-indigo-400 hover:underline font-semibold flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" />
              <span>Projects</span>
            </Link>
            <span className="text-slate-600">/</span>
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest bg-slate-800 px-2 py-0.5 rounded-md">
              {project.status}
            </span>
            {project.github_repo && (
              <a
                href={`https://github.com/${project.github_repo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-sky-950/80 border border-sky-800/60 hover:border-sky-500 text-[10px] font-bold text-sky-300 hover:text-white transition font-mono"
                title="View linked GitHub repository"
              >
                <FolderGit2 className="h-3 w-3 text-sky-400" />
                <span>{project.github_repo}</span>
                <ExternalLink className="h-2.5 w-2.5 text-sky-400" />
              </a>
            )}
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white mt-1">
            {project.name}
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">{project.description || "No description provided."}</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setDevopsRepoName(project.name.toLowerCase().replace(/[^a-z0-9_-]/g, "-"));
              setShowDevopsModal(true);
            }}
            className="rounded-xl border border-sky-700/60 bg-sky-950/60 px-3.5 py-2 text-xs font-bold text-sky-200 hover:bg-sky-900/60 transition flex items-center gap-1.5 cursor-pointer shadow-xs focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
            title="DevOps Agent (Joan): Provision and link remote GitHub repository with CI/CD"
            aria-label="DevOps GitHub Provisioning"
            aria-haspopup="dialog"
          >
            <FolderGit2 className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
            <span>{project.github_repo ? "DevOps: Sync Repo" : "DevOps: Create Repo"}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowFeedModal(true)}
            className="rounded-xl border border-emerald-700/60 bg-emerald-950/60 px-3.5 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-900/60 transition flex items-center gap-1.5 cursor-pointer shadow-xs focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none"
            title="Flux de Communication en Direct : Observez les agents collaborer et dialoguer en direct"
            aria-label="Flux de Communication en Direct"
            aria-haspopup="dialog"
          >
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse motion-reduce:animate-none" aria-hidden="true"></span>
            <Radio className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
            <span>Flux de Communication</span>
          </button>

          <button
            type="button"
            onClick={() => setShowPmModal(true)}
            className="rounded-xl border border-violet-700/60 bg-violet-950/60 px-3.5 py-2 text-xs font-bold text-violet-200 hover:bg-violet-900/60 transition flex items-center gap-1.5 cursor-pointer shadow-xs focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:outline-none"
            title="AI Product Manager: Decompose plan into Kanban tickets and assign AI specialists"
            aria-label="Plan with AI Product Manager"
            aria-haspopup="dialog"
          >
            <Sparkles className="h-3.5 w-3.5 text-violet-400" aria-hidden="true" />
            <span>Plan with AI PM</span>
          </button>

          <button
            type="button"
            onClick={handleIngestRag}
            disabled={ingestingRag}
            className="rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none"
            title="Ingest architecture documents & codebase chunks into pgvector"
            aria-label="Ingest RAG Knowledge into pgvector"
          >
            <Database className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
            <span>{ingestingRag ? "Ingesting pgvector…" : "Ingest RAG Knowledge"}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setTargetColumn("todo");
              setShowCreateModal(true);
            }}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-indigo-600/30 hover:bg-indigo-500 transition flex items-center gap-1.5 cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none"
            aria-label="Create New Ticket"
            aria-haspopup="dialog"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>New Ticket</span>
          </button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="flex flex-wrap items-center gap-3 bg-slate-900/90 p-3.5 rounded-2xl border border-slate-800 shadow-xs">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search tickets by title..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search tickets by title"
            className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-8.5 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
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

      {/* AI Product Manager Planning & Task Breakdown Modal */}
      {showPmModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl rounded-2xl bg-slate-900 p-6 shadow-2xl border border-violet-800/50 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-violet-950 border border-violet-700/60 flex items-center justify-center text-violet-400">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                    <span>Athena (AI) · Autonomous Project Manager</span>
                  </h3>
                  <p className="text-xs text-violet-300/80">
                    Give a plan or feature vision — PM Athena will break it into a structured WBS, set scope boundaries, and assign specialist agents.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowPmModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handlePmGenerateTasks} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">
                  Feature Vision / Sprint Roadmap Plan
                </label>
                <textarea
                  required
                  rows={5}
                  value={pmPlanText}
                  onChange={(e) => setPmPlanText(e.target.value)}
                  placeholder="e.g. Build an end-to-end Stripe billing integration with webhook listener, checkout button, pricing table view, and automated QA load testing."
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3.5 text-xs text-slate-200 placeholder-slate-500 focus:border-violet-500 focus:outline-none leading-relaxed"
                />
              </div>

              {/* Quick Templates */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                  Quick Roadmap Templates:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "User Auth & Clerk SSO with session refresh",
                    "Stripe Subscription Billing & Webhook Dispatcher",
                    "Real-Time Slack Notifications & Incident Alerting",
                    "Automated CI/CD Deployment with Docker Staging & Rollbacks",
                  ].map((tpl) => (
                    <button
                      key={tpl}
                      type="button"
                      onClick={() => setPmPlanText(tpl)}
                      className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:border-violet-500 hover:text-violet-300 transition cursor-pointer"
                    >
                      {tpl}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Bot className="h-3.5 w-3.5 text-violet-400" />
                  <span>Auto-assigns Backend, Frontend & QA with team chat</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPmModal(false)}
                    className="px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={generatingPmTasks}
                    className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-violet-600/30 hover:bg-violet-500 transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>{generatingPmTasks ? "Decomposing & Creating Tickets…" : "Generate Tickets & Team Chat"}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DevOps Agent GitHub Provisioning Modal */}
      {showDevopsModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl rounded-2xl bg-slate-900 p-6 shadow-2xl border border-sky-800/50 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-sky-950 border border-sky-700/60 flex items-center justify-center text-sky-400">
                  <FolderGit2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                    <span>Joan of Arc (AI) · DevOps Specialist</span>
                    <span className="text-[10px] font-mono text-sky-400 bg-sky-950/80 border border-sky-800 px-1.5 py-0.5 rounded">
                      devops@teamflow.dev
                    </span>
                  </h3>
                  <p className="text-xs text-sky-300/80">
                    Autonomously provisions a remote repository on GitHub, commits CI/CD workflows, and links it to TeamFlow.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDevopsModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleDevopsCreateRepo} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Repository Name *
                </label>
                <input
                  required
                  value={devopsRepoName}
                  onChange={(e) => setDevopsRepoName(e.target.value)}
                  placeholder="e.g. teamflow-billing-service"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 font-mono focus:border-sky-500 focus:outline-none"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Letters, numbers, hyphens, and underscores only.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  GitHub Account or Organization
                </label>
                <input
                  value={devopsRepoOrg}
                  onChange={(e) => setDevopsRepoOrg(e.target.value)}
                  placeholder="Asta-Builds (leave empty for authenticated personal user)"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 font-mono focus:border-sky-500 focus:outline-none"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  DevOps Agent creates the repository under this account or organization.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Repository Visibility
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setDevopsRepoPrivate(false)}
                    className={`rounded-xl border p-3 text-left transition cursor-pointer flex items-start gap-2.5 ${
                      !devopsRepoPrivate
                        ? "border-sky-500 bg-sky-950/40 text-white"
                        : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <Globe className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-bold text-white">Public</div>
                      <div className="text-[10px] text-slate-400">Visible to everyone on GitHub</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDevopsRepoPrivate(true)}
                    className={`rounded-xl border p-3 text-left transition cursor-pointer flex items-start gap-2.5 ${
                      devopsRepoPrivate
                        ? "border-sky-500 bg-sky-950/40 text-white"
                        : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <Lock className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-bold text-white">Private</div>
                      <div className="text-[10px] text-slate-400">Only authorized members can view</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Automated checklist */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-1.5 text-xs text-slate-300">
                <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-1">
                  Automated DevOps Actions:
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-300">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span>Provisions remote repository on GitHub via REST API</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-300">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span>Bootstraps local repo with README.md & .gitignore</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-300">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span>Generates .github/workflows/ci.yml GitHub Actions pipeline</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-300">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span>Commits as asta-build and pushes initial scaffold to main</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-300">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span>Links remote repository directly to this TeamFlow project</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <ShieldCheck className="h-3.5 w-3.5 text-sky-400" />
                  <span>Uses configured GitHub PAT token</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDevopsModal(false)}
                    className="px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={devopsCreatingRepo}
                    className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-sky-600/30 hover:bg-sky-500 transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {devopsCreatingRepo ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>DevOps Provisioning Repo…</span>
                      </>
                    ) : (
                      <>
                        <Rocket className="h-3.5 w-3.5" />
                        <span>Provision GitHub Repository</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Swarm Live Communication Stream Modal */}
      {showFeedModal && (
        <SwarmLiveFeedModal
          projectId={projectId}
          projectName={project.name}
          onClose={() => setShowFeedModal(false)}
        />
      )}
    </div>
  );
}

function AgentReasoningTerminal({
  events,
  isStreaming,
  currentStatus,
  showIfEmpty = false,
}: {
  events: AgentEvent[];
  isStreaming: boolean;
  currentStatus?: string | null;
  showIfEmpty?: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    if (isExpanded) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [events, isStreaming, isExpanded]);

  if (events.length === 0 && !isStreaming && !showIfEmpty) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-indigo-800/40 bg-slate-950/90 shadow-xl overflow-hidden text-xs">
      {/* Terminal Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-gradient-to-r from-slate-900 via-indigo-950/60 to-slate-900 border-b border-indigo-900/40">
        <div className="flex items-center gap-2">
          <div className="relative flex h-2.5 w-2.5 items-center justify-center">
            {isStreaming ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
              </>
            ) : (
              <span className="inline-flex rounded-full h-2 w-2 bg-indigo-400"></span>
            )}
          </div>
          <Terminal className="h-3.5 w-3.5 text-indigo-400" />
          <span className="font-mono font-bold text-white text-[11px] uppercase tracking-wider">
            Athena · Live Reasoning Stream
          </span>
          {isStreaming ? (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-800/60 text-emerald-300 font-semibold flex items-center gap-1">
              <Loader2 className="h-2.5 w-2.5 animate-spin text-emerald-400" />
              <span>Streaming Live (SSE)</span>
            </span>
          ) : (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-medium">
              {events.length > 0 ? `${events.length} events logged` : "Awaiting agent prompt"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800/60 transition cursor-pointer"
            title={isExpanded ? "Collapse Terminal" : "Expand Terminal"}
          >
            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Terminal Content */}
      {isExpanded && (
        <div className="p-3 max-h-64 overflow-y-auto space-y-2 font-mono text-[11px] bg-slate-950/95">
          {events.length === 0 && !isStreaming && (
            <div className="text-center py-4 text-slate-500 font-mono text-xs">
              No live reasoning events yet. Mention @pm in comments or run swarm to trigger live thoughts.
            </div>
          )}

          {events.map((e) => {
            const isThought = e.event_type === "thought";
            const isTool = e.event_type === "tool_call";
            const isCompleted = e.event_type === "completed";
            const isFailed = e.event_type === "failed";

            return (
              <div
                key={e.id}
                className={`p-2.5 rounded-xl border transition-all ${
                  isThought
                    ? "bg-indigo-950/40 border-indigo-800/40 text-indigo-200"
                    : isTool
                    ? "bg-amber-950/30 border-amber-800/40 text-amber-200"
                    : isCompleted
                    ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-200"
                    : isFailed
                    ? "bg-rose-950/40 border-rose-800/50 text-rose-200"
                    : "bg-slate-900/60 border-slate-800 text-slate-300"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {isThought ? (
                      <Sparkles className="h-3 w-3 text-indigo-400 shrink-0" />
                    ) : isTool ? (
                      <Layers className="h-3 w-3 text-amber-400 shrink-0" />
                    ) : isCompleted ? (
                      <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                    ) : isFailed ? (
                      <XCircle className="h-3 w-3 text-rose-400 shrink-0" />
                    ) : (
                      <Bot className="h-3 w-3 text-slate-400 shrink-0" />
                    )}
                    <span className="font-bold text-[10px] uppercase tracking-wider text-white">
                      {e.sender_name || "Athena"} · {e.event_type}
                    </span>
                    {e.metadata && typeof e.metadata === "object" && "tool_name" in e.metadata && (
                      <span className="bg-amber-950 border border-amber-800/60 text-amber-300 px-1.5 py-0.5 rounded text-[9px] font-bold">
                        {String(e.metadata.tool_name)}
                      </span>
                    )}
                  </div>
                  <span className="text-[9px] text-slate-500 font-mono">
                    {new Date(e.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                </div>

                <div className="whitespace-pre-wrap leading-relaxed pl-4 font-sans text-xs">
                  {e.message}
                </div>

                {e.metadata && typeof e.metadata === "object" && "model" in e.metadata && (
                  <div className="mt-1.5 pt-1 border-t border-slate-800/40 flex items-center justify-between text-[9px] text-slate-400 font-mono">
                    <span>Model: {String(e.metadata.model)}</span>
                    {"tokens_used" in e.metadata && (
                      <span>Tokens: {String(e.metadata.tokens_used)}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {isStreaming && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-indigo-950/30 border border-indigo-800/30 text-indigo-300 text-xs animate-pulse">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400 shrink-0" />
              <span className="font-medium">{currentStatus || "Athena is reasoning & formulating WBS decomposition..."}</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
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
  const [activeTab, setActiveTab] = useState<"contract" | "comments" | "activity" | "agents">("contract");
  const [posting, setPosting] = useState(false);
  const [rejectModal, setRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [traces, setTraces] = useState<AgentExecutionTrace[]>([]);
  const [runningSwarm, setRunningSwarm] = useState(false);
  const [runningChain, setRunningChain] = useState(false);
  const [liveEvents, setLiveEvents] = useState<AgentEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
  const lastEventIdRef = useRef<number>(0);

  const refresh = useCallback(() => {
    apiFetch<Task>(`/tasks/${task.id}/`).then(setDetail);
    getAgentTraces(task.id).then(setTraces).catch(() => {});
  }, [task.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Fetch initial agent events for this task
  useEffect(() => {
    getAgentEvents({ taskId: task.id })
      .then((res) => {
        if (res.events && res.events.length > 0) {
          setLiveEvents(res.events);
          lastEventIdRef.current = res.last_event_id || res.events[res.events.length - 1].id;
        }
      })
      .catch(() => {});
  }, [task.id]);

  // Real-time SSE stream subscription for this task
  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function listen() {
      while (active && !controller.signal.aborted) {
        try {
          await streamAgentEvents(
            { taskId: task.id, after: lastEventIdRef.current },
            (event) => {
              if (!active) return;
              lastEventIdRef.current = Math.max(lastEventIdRef.current, event.id);
              setLiveEvents((prev) => {
                if (prev.some((e) => e.id === event.id)) return prev;
                return [...prev, event].slice(-100);
              });

              if (
                event.event_type === "thought" ||
                event.event_type === "tool_call" ||
                event.event_type === "progress" ||
                event.event_type === "started"
              ) {
                setIsStreaming(true);
                setStreamingStatus(event.message || "Athena is reasoning...");
              } else if (event.event_type === "completed" || event.event_type === "failed") {
                setIsStreaming(false);
                setStreamingStatus(null);
                refresh();
                if (event.event_type === "completed") {
                  toast.success(`${event.sender_name || "Athena (PM)"} completed execution.`);
                }
              }
            },
            controller.signal,
          );
        } catch {
          // Pause briefly before reconnecting
        }
        if (active && !controller.signal.aborted) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    void listen();

    return () => {
      active = false;
      controller.abort();
    };
  }, [task.id, refresh]);

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
    setIsStreaming(true);
    setStreamingStatus("Dispatching Athena PM & autonomous swarm...");
    try {
      const result = await dispatchAgentSwarm(detail.id);
      setTraces((current) => [result.trace, ...current]);
      setActiveTab("agents");
      toast.success("Autonomous swarm queued. Live updates will appear in the agent stream.");
    } catch (err) {
      toast.error("Error executing multi-agent swarm: " + String(err));
      setIsStreaming(false);
    } finally {
      setRunningSwarm(false);
    }
  }

  async function handleRunSwarmChain() {
    setRunningChain(true);
    setIsStreaming(true);
    setStreamingStatus("Running autonomous swarm chain...");
    try {
      const res = await executeSwarmChain(detail.id, comment.trim());
      setTraces((current) => [res.trace, ...current]);
      setActiveTab("agents");
      setComment("");
      toast.success("Flux autonome mis en file d’attente. Suivez son avancement dans le flux en direct.");
    } catch (err) {
      toast.error("Erreur lors de l'exécution du flux autonome : " + getErrorMessage(err));
      setIsStreaming(false);
    } finally {
      setRunningChain(false);
    }
  }

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    setPosting(true);
    const hasAgentMention = /@(pm|tech_lead|backend|frontend|qa|devops|designer|seo|all)/i.test(comment);
    const commentBody = comment.trim();
    if (hasAgentMention) {
      setIsStreaming(true);
      setStreamingStatus("Athena PM is analyzing prompt & querying RAG...");
      executeSwarmChain(task.id, commentBody).then((chainRes) => {
        setTraces((current) => [chainRes.trace, ...current]);
        toast.success("Athena PM has picked up your prompt and started execution.");
      }).catch(() => {});
    }
    try {
      const res = await apiFetch<TaskCommentResponse>(`/tasks/${task.id}/comments/`, {
        method: "POST",
        body: { body: comment },
      });
      const updated = await apiFetch<Task>(`/tasks/${task.id}/`);
      setDetail(updated);
      onChanged(updated);
      getAgentTraces(task.id).then(setTraces);
      setComment("");
      if (res.agent_replies && res.agent_replies.length > 0) {
        const agentName = res.agent_replies[0].agent_name || "AI Agent";
        toast.success(`${agentName} responded & updated status to ${updated.status}!`);
      } else if (res.agent_run) {
        setTraces((current) => [res.agent_run!, ...current]);
        toast.success("Agent prompt queued. The response will arrive in the live stream.");
      } else {
        toast.success("Comment added");
      }
    } catch (err) {
      toast.error("Failed to add comment: " + String(err));
      setIsStreaming(false);
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
    } catch {
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
    } catch {
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
                    Google Antigravity SDK & Swarm
                  </span>
                </div>
                <p className="text-xs text-slate-300 font-medium">
                  Autonomous agents grounded in pgvector RAG, traced with Langfuse and Antigravity SDK.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRunSwarmChain}
                  disabled={runningChain || runningSwarm}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-3.5 py-2 text-xs font-bold text-white shadow-md shadow-emerald-600/30 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-60 transition cursor-pointer"
                  title="Exécute la chaîne séquentielle complète : Tech Lead ➔ Backend ➔ Frontend ➔ QA ➔ Merge ➔ DevOps"
                >
                  <Zap className="h-3.5 w-3.5 text-emerald-200" />
                  <span>{runningChain ? "Flux en cours…" : "⚡ Flux Autonome"}</span>
                </button>

                <button
                  type="button"
                  onClick={handleRunSwarm}
                  disabled={runningSwarm || runningChain}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white shadow-md shadow-indigo-600/30 hover:bg-indigo-500 disabled:opacity-60 transition cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>{runningSwarm ? "Running Swarm…" : "Run Swarm"}</span>
                </button>
              </div>
            </div>

            {/* Live Streaming Indicator inside Banner */}
            {isStreaming && (
              <div className="mt-3 flex items-center justify-between p-2.5 rounded-xl bg-emerald-950/70 border border-emerald-700/60 text-emerald-300 text-xs">
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
                  </span>
                  <span className="font-bold shrink-0">Athena PM is reasoning</span>
                  <span className="text-[11px] text-emerald-400/80 font-mono truncate max-w-xs">{streamingStatus}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab("agents")}
                  className="shrink-0 text-[11px] font-bold text-emerald-200 underline hover:text-white cursor-pointer ml-2"
                >
                  View Stream
                </button>
              </div>
            )}
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
                onClick={() => setActiveTab("contract")}
                className={`pb-2 text-xs font-bold uppercase tracking-wider transition whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                  activeTab === "contract"
                    ? "border-b-2 border-emerald-500 text-emerald-400 font-extrabold"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                <span>Contrat de Validation ({detail.validation_contract?.length || 0})</span>
                {detail.contract_compliance_score !== undefined && detail.contract_compliance_score > 0 && (
                  <span className="ml-1 text-[10px] bg-emerald-950 border border-emerald-800/60 text-emerald-300 px-1.5 py-0.5 rounded-full">
                    {Math.round(detail.contract_compliance_score)}%
                  </span>
                )}
              </button>
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

            {/* TAB: Validation Contract (Factory Missions Definition of Done) */}
            {activeTab === "contract" && (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/60 via-slate-900 to-slate-950 border border-emerald-800/40 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-emerald-400" />
                      <h4 className="text-xs font-black text-white uppercase tracking-wider">
                        Contrat de Validation · Definition of Done
                      </h4>
                    </div>
                    <span className="text-xs font-bold text-emerald-300">
                      Score : {Math.round(detail.contract_compliance_score || 0)}%
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed font-medium">
                    Assertions objectives et indépendantes établies en amont lors de la phase de planification (avant tout code) et validées de manière holistique par l&apos;agent QA.
                  </p>
                  {/* Progress Bar */}
                  <div className="h-2 w-full rounded-full bg-slate-950 overflow-hidden border border-slate-800">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(0, detail.contract_compliance_score || 0))}%` }}
                    />
                  </div>
                </div>

                <div className="space-y-2.5">
                  {detail.validation_contract?.map((clause, idx) => {
                    const isPassed = clause.status === "PASSED";
                    return (
                      <div
                        key={clause.id || idx}
                        className={`p-3.5 rounded-2xl border transition space-y-2 ${
                          isPassed
                            ? "bg-slate-950/80 border-emerald-800/50 shadow-sm"
                            : "bg-slate-950/40 border-slate-800"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-mono font-extrabold text-slate-300 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-md">
                              {clause.id}
                            </span>
                            <span className="text-[11px] font-bold text-slate-400">
                              {clause.category}
                            </span>
                          </div>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 ${
                              isPassed
                                ? "bg-emerald-950 border border-emerald-800/60 text-emerald-300"
                                : "bg-amber-950 border border-amber-800/60 text-amber-300"
                            }`}
                          >
                            {isPassed ? (
                              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                            ) : (
                              <Clock className="h-3 w-3 text-amber-400" />
                            )}
                            <span>{clause.status}</span>
                          </span>
                        </div>
                        <p className="text-xs text-slate-200 font-medium leading-relaxed pl-1">
                          {clause.assertion}
                        </p>
                        {clause.evidence && (
                          <div className="text-[10px] text-emerald-400/90 font-mono bg-emerald-950/40 border border-emerald-900/50 p-2 rounded-xl">
                            ✓ {clause.evidence} {clause.verified_at && `(${new Date(clause.verified_at).toLocaleTimeString()})`}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {(!detail.validation_contract || detail.validation_contract.length === 0) && (
                    <div className="text-center py-8 space-y-1 bg-slate-950/40 rounded-2xl border border-slate-800/60">
                      <ShieldCheck className="h-6 w-6 text-slate-600 mx-auto" />
                      <p className="text-xs text-slate-400 font-semibold">Aucun contrat défini pour ce ticket.</p>
                      <p className="text-[11px] text-slate-500">
                        Lancez le flux autonome pour générer automatiquement les assertions du contrat de validation !
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB: Multi-Agent Workflow */}
            {activeTab === "agents" && (
              <div className="space-y-4">
                {/* Live Real-Time Athena Reasoning Terminal */}
                <AgentReasoningTerminal
                  events={liveEvents}
                  isStreaming={isStreaming}
                  currentStatus={streamingStatus}
                  showIfEmpty={true}
                />
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

                      {latestTrace.langfuse_url ? (
                        <div className="pt-1 flex justify-end">
                        <a
                          href={latestTrace.langfuse_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] font-bold text-indigo-400 hover:text-indigo-300 hover:underline inline-flex items-center gap-1"
                        >
                          <span>Open in Self-Hosted Langfuse</span>
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                        </div>
                      ) : null}
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
                <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
                  {detail.comments?.map((c) => {
                    const isAi = Boolean(c.author_detail?.is_ai_agent);
                    const isHandoff = c.body.includes("➔ @");
                    return (
                      <div
                        key={c.id}
                        className={`flex gap-3 text-xs p-3.5 rounded-2xl border transition ${
                          isHandoff
                            ? "bg-slate-950 border-indigo-800/60 shadow-md ring-1 ring-indigo-500/20"
                            : isAi
                            ? "bg-slate-950/80 border-indigo-900/40 shadow-xs ring-1 ring-indigo-500/10"
                            : "bg-slate-950/40 border-slate-800"
                        }`}
                      >
                        <Avatar
                          name={c.author_detail?.name || ""}
                          email={c.author_detail?.email}
                          size={32}
                        />
                        <div className="flex-1 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-white">{c.author_detail?.name || "System"}</span>
                              <AgentTypeBadge role={c.author_detail?.role} isAi={isAi} />
                              {isHandoff && (
                                <span className="text-[10px] font-extrabold text-indigo-300 bg-indigo-950 border border-indigo-700/60 px-2 py-0.5 rounded-md flex items-center gap-1">
                                  <Zap className="h-2.5 w-2.5 text-indigo-400" />
                                  <span>Passage de Relais Agent</span>
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {new Date(c.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <div className="text-slate-300 font-normal leading-relaxed whitespace-pre-wrap">
                            {c.body}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {(!detail.comments || detail.comments.length === 0) && (
                    <p className="text-xs text-slate-500 py-3 text-center">
                      No comments yet. Tag an agent with <code>@tech_lead</code> or <code>@backend</code> to prompt a response.
                    </p>
                  )}
                </div>

                {/* Live Athena Reasoning Terminal during comment prompt */}
                {(isStreaming || liveEvents.length > 0) && (
                  <div className="pt-2">
                    <AgentReasoningTerminal
                      events={liveEvents}
                      isStreaming={isStreaming}
                      currentStatus={streamingStatus}
                    />
                  </div>
                )}

                {/* CEO Agent Tag Mention Pills */}
                <div className="pt-2 border-t border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                      <Bot className="h-3 w-3 text-indigo-400" />
                      <span>Tag Autonomous Agent to Prompt</span>
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">Click to insert tag</span>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {[
                      { tag: "@pm", label: "PM (Planner)", color: "hover:border-violet-500 hover:text-violet-300" },
                      { tag: "@tech_lead", label: "Tech Lead", color: "hover:border-indigo-500 hover:text-indigo-300" },
                      { tag: "@backend", label: "Backend", color: "hover:border-blue-500 hover:text-blue-300" },
                      { tag: "@frontend", label: "Frontend", color: "hover:border-cyan-500 hover:text-cyan-300" },
                      { tag: "@qa", label: "QA Gate", color: "hover:border-emerald-500 hover:text-emerald-300" },
                      { tag: "@devops", label: "DevOps", color: "hover:border-orange-500 hover:text-orange-300" },
                      { tag: "@designer", label: "UI/UX", color: "hover:border-pink-500 hover:text-pink-300" },
                      { tag: "@seo", label: "SEO", color: "hover:border-teal-500 hover:text-teal-300" },
                      { tag: "@all", label: "All Swarm", color: "hover:border-purple-500 hover:text-purple-300" },
                    ].map((pill) => (
                      <button
                        key={pill.tag}
                        type="button"
                        onClick={() => {
                          setComment((prev) => (prev ? `${prev} ${pill.tag} ` : `${pill.tag} `));
                        }}
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border border-slate-800 bg-slate-950 text-slate-400 transition cursor-pointer ${pill.color}`}
                      >
                        {pill.tag}
                      </button>
                    ))}
                  </div>

                  <form onSubmit={addComment} className="flex gap-2 pt-1">
                    <input
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Prompt an agent, e.g.: @tech_lead break down the tasks..."
                      className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={posting}
                      className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-60 transition cursor-pointer flex items-center gap-1.5 shrink-0 shadow-xs"
                    >
                      {posting ? (
                        <span>Thinking…</span>
                      ) : (
                        <>
                          <Sparkles className="h-3 w-3" />
                          <span>Prompt / Send</span>
                        </>
                      )}
                    </button>
                  </form>
                </div>
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

function SwarmLiveFeedModal({
  projectId,
  projectName,
  onClose,
}: {
  projectId: number;
  projectName: string;
  onClose: () => void;
}) {
  const [feed, setFeed] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAgent, setFilterAgent] = useState("all");
  const [liveStream, setLiveStream] = useState(true);
  const [streamError, setStreamError] = useState("");
  const lastEventId = useRef(0);

  const fetchFeed = useCallback(() => {
    getAgentEvents({ projectId })
      .then((res) => {
        setFeed(res.events || []);
        lastEventId.current = res.last_event_id || 0;
      })
      .catch((err) => setStreamError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  useEffect(() => {
    if (!liveStream || loading) return;
    const controller = new AbortController();

    async function connect() {
      while (!controller.signal.aborted) {
        try {
          await streamAgentEvents(
            { projectId, after: lastEventId.current },
            (event) => {
              lastEventId.current = Math.max(lastEventId.current, event.id);
              setFeed((current) => {
                if (current.some((item) => item.id === event.id)) return current;
                return [...current, event].slice(-200);
              });
              setStreamError("");
            },
            controller.signal,
          );
        } catch (error) {
          if (!controller.signal.aborted) setStreamError(getErrorMessage(error));
        }
        if (!controller.signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    void connect();
    return () => controller.abort();
  }, [liveStream, loading, projectId]);

  const filteredFeed = feed.filter((item) => {
    if (filterAgent === "all") return true;
    return (
      item.sender_role?.toLowerCase().includes(filterAgent.toLowerCase()) ||
      item.sender_key?.toLowerCase().includes(filterAgent.toLowerCase()) ||
      item.sender_name?.toLowerCase().includes(filterAgent.toLowerCase())
    );
  });

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
      <div className="w-full max-w-4xl h-[85vh] rounded-2xl bg-slate-900 shadow-2xl border border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 p-4 bg-slate-950">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-emerald-950 border border-emerald-700/60 flex items-center justify-center text-emerald-400 shadow-xs">
              <Radio className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-extrabold text-white">
                  Flux de Communication en Direct · Swarm IA
                </h3>
                <span className="flex items-center gap-1 bg-emerald-950 border border-emerald-800/60 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                  {liveStream ? "LIVE STREAM" : "STREAM PAUSED"}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Projet : <span className="text-slate-200 font-semibold">{projectName}</span> · Dialogue et passages de relais entre agents
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchFeed()}
              className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white transition cursor-pointer"
              title="Rafraîchir maintenant"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:bg-slate-800 hover:text-white transition cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center justify-between gap-3 p-3 bg-slate-950/60 border-b border-slate-800 text-xs">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 mr-1">Filtrer :</span>
            {[
              { id: "all", label: "Tous les Agents" },
              { id: "lead", label: "Sarah (Tech Lead)" },
              { id: "backend", label: "Marcus (Backend)" },
              { id: "frontend", label: "Cleopatra (Frontend)" },
              { id: "qa", label: "Alan (QA)" },
              { id: "devops", label: "Joan (DevOps)" },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilterAgent(f.id)}
                className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
                  filterAgent === f.id
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1.5 text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={liveStream}
              onChange={(e) => setLiveStream(e.target.checked)}
              className="rounded accent-emerald-500"
            />
            <span className="text-[11px] font-medium">Authenticated live stream</span>
          </label>
        </div>

        {streamError && (
          <div className="border-b border-amber-900/60 bg-amber-950/40 px-4 py-2 text-[11px] text-amber-300">
            Live stream reconnecting: {streamError}
          </div>
        )}

        {/* Feed Messages Container */}
        <div
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label="Live Agent Communication Feed"
          className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-900/60"
        >
          {filteredFeed.map((item) => {
            const isHandoff = item.event_type === "handoff";
            const isDone = item.event_type === "completed";
            const isFailed = item.event_type === "failed" || item.event_type === "blocked";

            return (
              <div
                key={item.id}
                className={`p-4 rounded-2xl border transition space-y-2 ${
                  isHandoff
                    ? "bg-slate-950 border-indigo-800/50 shadow-md ring-1 ring-indigo-500/20"
                    : isFailed
                    ? "bg-slate-950 border-red-800/50"
                    : isDone
                    ? "bg-slate-950 border-emerald-800/50"
                    : "bg-slate-950/70 border-slate-800"
                }`}
              >
                <div className="flex items-center justify-between gap-2 border-b border-slate-800/60 pb-2">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={item.sender_name || "TeamFlow Orchestrator"} size={32} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">{item.sender_name || "TeamFlow Orchestrator"}</span>
                        {item.recipient_key && (
                          <span className="text-[11px] font-extrabold text-indigo-400 bg-indigo-950 border border-indigo-800/60 px-2 py-0.5 rounded-md flex items-center gap-1">
                            <span>➔</span>
                            <span>@{item.recipient_key}</span>
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 font-medium">
                        Ticket #{item.task} : {item.task_title}
                      </span>
                    </div>
                  </div>

                  <span className="text-[10px] text-slate-500 font-mono">
                    {new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                </div>

                <div className="text-xs text-slate-300 font-normal leading-relaxed whitespace-pre-wrap pl-1">
                  {item.message}
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-1 text-[10px]">
                  <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 font-bold uppercase tracking-wider text-slate-300">
                    {item.event_type}
                  </span>
                  {item.current_work && <span className="text-slate-400">Now: {item.current_work}</span>}
                </div>
                {item.remaining_work.length > 0 && (
                  <div className="pl-1 text-[10px] text-slate-500">
                    Remaining: {item.remaining_work.join(" · ")}
                  </div>
                )}
              </div>
            );
          })}

          {filteredFeed.length === 0 && !loading && (
            <div className="text-center py-16 space-y-2">
              <Bot className="h-8 w-8 text-slate-600 mx-auto" />
              <p className="text-xs text-slate-400">Aucun échange pour le moment.</p>
              <p className="text-[11px] text-slate-500">
                Lancez un flux autonome ou taguez un agent dans un ticket pour voir le dialogue live !
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

