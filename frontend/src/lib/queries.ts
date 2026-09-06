"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  apiFetch,
  normalizeList,
  createSeoTask,
  rollbackDeployment,
  qaValidateTask,
  getAgentClusterStatus,
} from "./api";
import type {
  Project,
  Task,
  Deployment,
  SEOAudit,
  Notification,
  User,
  PulseDashboard,
  TaskStatus,
  ProjectStatus,
  Priority,
  TaskType,
  ActivityFeedItem,
  AgentClusterStatus,
  Organization,
} from "./types";
import { toast } from "sonner";

// --- Query Keys ---
export const queryKeys = {
  projects: ["projects"] as const,
  project: (id: number) => ["projects", id] as const,
  tasks: (projectId?: number) =>
    projectId ? (["tasks", { projectId }] as const) : (["tasks"] as const),
  task: (id: number) => ["tasks", "detail", id] as const,
  deployments: ["deployments"] as const,
  seoAudits: ["seo-audits"] as const,
  notifications: ["notifications"] as const,
  team: ["team"] as const,
  pulseDashboard: (date: string) => ["pulse", "dashboard", date] as const,
  activityFeed: ["activity-feed"] as const,
  currentOrganization: ["organization", "current"] as const,
  organizations: ["organizations", "list"] as const,
};

// --- Read Queries ---

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: async () => {
      const data = await apiFetch<unknown>("/projects/");
      return normalizeList<Project>(data);
    },
  });
}

export function useProject(id: number) {
  return useQuery({
    queryKey: queryKeys.project(id),
    queryFn: async () => {
      return apiFetch<Project>(`/projects/${id}/`);
    },
    enabled: Boolean(id) && !isNaN(id),
  });
}

export function useTasks(projectId?: number) {
  return useQuery({
    queryKey: queryKeys.tasks(projectId),
    queryFn: async () => {
      const path = projectId ? `/tasks/?project=${projectId}` : "/tasks/";
      const data = await apiFetch<unknown>(path);
      return normalizeList<Task>(data);
    },
    enabled: projectId === undefined || (!isNaN(projectId) && projectId > 0),
  });
}

export function useDeployments() {
  return useQuery({
    queryKey: queryKeys.deployments,
    queryFn: async () => {
      const data = await apiFetch<unknown>("/deployments/");
      return normalizeList<Deployment>(data);
    },
  });
}

export function useSeoAudits() {
  return useQuery({
    queryKey: queryKeys.seoAudits,
    queryFn: async () => {
      const data = await apiFetch<unknown>("/seo/audits/");
      return normalizeList<SEOAudit>(data);
    },
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: async () => {
      const data = await apiFetch<unknown>("/notifications/");
      return normalizeList<Notification>(data);
    },
  });
}

export function useTeamMembers() {
  return useQuery({
    queryKey: queryKeys.team,
    queryFn: async () => {
      const data = await apiFetch<unknown>("/users/");
      return normalizeList<User>(data);
    },
  });
}

export function usePulseDashboardQuery(date: string) {
  return useQuery({
    queryKey: queryKeys.pulseDashboard(date),
    queryFn: async () => {
      return apiFetch<PulseDashboard>(
        `/pulse/dashboard/?date=${encodeURIComponent(date)}`
      );
    },
    enabled: Boolean(date),
  });
}

export function useActivityFeed() {
  return useQuery({
    queryKey: queryKeys.activityFeed,
    queryFn: async () => {
      const data = await apiFetch<ActivityFeedItem[]>("/tasks/feed/").catch(() => []);
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 15000,
  });
}

export function useAgentClusterStatus() {
  return useQuery<AgentClusterStatus | null>({
    queryKey: ["agent-cluster"] as const,
    queryFn: async () => {
      return getAgentClusterStatus().catch(() => null);
    },
    refetchInterval: 30000,
  });
}

// --- Mutations with Optimistic Updates & Sonner Feedback ---

export function useUpdateTaskStatus(projectId?: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, status }: { taskId: number; status: TaskStatus }) => {
      return apiFetch<Task>(`/tasks/${taskId}/`, {
        method: "PATCH",
        body: { status },
      });
    },
    onMutate: async ({ taskId, status }) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: queryKeys.tasks(projectId) });

      const previousTasks = queryClient.getQueryData<Task[]>(
        queryKeys.tasks(projectId)
      );

      if (previousTasks) {
        queryClient.setQueryData<Task[]>(
          queryKeys.tasks(projectId),
          previousTasks.map((t) => (t.id === taskId ? { ...t, status } : t))
        );
      }

      return { previousTasks };
    },
    onError: (err, _vars, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(
          queryKeys.tasks(projectId),
          context.previousTasks
        );
      }
      toast.error(`Échec du déplacement de la tâche : ${err instanceof Error ? err.message : "Erreur inconnue"}`);
    },
    onSuccess: (data) => {
      toast.success(`Tâche déplacée vers : ${data.status.replace("_", " ")}`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
  });
}

export function useQaValidateTaskMutation(projectId?: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (taskId: number) => {
      return qaValidateTask(taskId);
    },
    onSuccess: (data) => {
      toast.success(`Porte QA validée avec succès pour le ticket #${data.id}`);
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.task(data.id) });
    },
    onError: (err) => {
      toast.error(`Échec de la validation QA : ${err instanceof Error ? err.message : "Erreur d'accès"}`);
    },
  });
}

export function useTriggerDeploymentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      project: number;
      environment: "staging" | "production";
      branch: string;
      commit_sha?: string;
    }) => {
      return apiFetch<Deployment>("/deployments/", {
        method: "POST",
        body: payload,
      });
    },
    onSuccess: (data) => {
      toast.success(`Déploiement #${data.id} (${data.environment}) réussi en ${data.duration_seconds || 12}s`);
      queryClient.invalidateQueries({ queryKey: queryKeys.deployments });
    },
    onError: (err) => {
      toast.error(`Échec du déploiement : ${err instanceof Error ? err.message : "Erreur pipeline"}`);
    },
  });
}

export function useRollbackDeploymentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (deploymentId: number) => {
      return rollbackDeployment(deploymentId);
    },
    onSuccess: (data) => {
      toast.success(`Rollback 1-Click #${data.id} exécuté avec succès vers ${data.target_commit || "version précédente"}`);
      queryClient.invalidateQueries({ queryKey: queryKeys.deployments });
    },
    onError: (err) => {
      toast.error(`Échec du rollback : ${err instanceof Error ? err.message : "Erreur d'inversion"}`);
    },
  });
}

export function useTriggerSeoAuditMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (url: string) => {
      return apiFetch<SEOAudit>("/seo/audits/", {
        method: "POST",
        body: { url },
      });
    },
    onSuccess: (data) => {
      toast.success(`Audit SEO #${data.id} terminé (Score: ${data.score}/100, ${data.issues?.length || 0} anomalies détectées)`);
      queryClient.invalidateQueries({ queryKey: queryKeys.seoAudits });
    },
    onError: (err) => {
      toast.error(`Échec de l'audit SEO : ${err instanceof Error ? err.message : "Erreur probe HTTP"}`);
    },
  });
}

export function useCreateSeoTaskMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      auditId,
      projectId,
      issueIndex,
    }: {
      auditId: number;
      projectId: number;
      issueIndex: number;
    }) => {
      return createSeoTask(auditId, {
        project_id: projectId,
        issue_index: issueIndex,
      });
    },
    onSuccess: (data) => {
      toast.success(`Ticket Kanban #${data.task_id} généré depuis l'audit SEO`);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (err) => {
      toast.error(`Impossible de créer le ticket : ${err instanceof Error ? err.message : "Erreur de conversion"}`);
    },
  });
}

export function useCreateProjectMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      name: string;
      description?: string;
      status?: ProjectStatus;
    }) => {
      return apiFetch<Project>("/projects/", {
        method: "POST",
        body: payload,
      });
    },
    onSuccess: (data) => {
      toast.success(`Projet "${data.name}" créé avec succès`);
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
    onError: (err) => {
      toast.error(`Échec de création du projet : ${err instanceof Error ? err.message : "Erreur inconnue"}`);
    },
  });
}

export function useCreateTaskMutation(projectId?: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      project: number;
      title: string;
      description?: string;
      status?: TaskStatus;
      priority?: Priority;
      task_type?: TaskType;
      assignee?: number | null;
    }) => {
      return apiFetch<Task>("/tasks/", {
        method: "POST",
        body: payload,
      });
    },
    onSuccess: (data) => {
      toast.success(`Tâche #${data.id} créée avec succès`);
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
    onError: (err) => {
      toast.error(`Échec de création de la tâche : ${err instanceof Error ? err.message : "Erreur inconnue"}`);
    },
  });
}

// --- Multi-Tenant Organization Hooks ---

export function useCurrentOrganization() {
  return useQuery({
    queryKey: queryKeys.currentOrganization,
    queryFn: async () => {
      return apiFetch<Organization>("/organizations/current/");
    },
    staleTime: 60 * 1000,
  });
}

export function useOrganizations() {
  return useQuery({
    queryKey: queryKeys.organizations,
    queryFn: async () => {
      const data = await apiFetch<unknown>("/organizations/");
      return normalizeList<Organization>(data);
    },
    staleTime: 60 * 1000,
  });
}

export function useUpdateOrganizationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { name: string }) => {
      return apiFetch<Organization>("/organizations/current/", {
        method: "PATCH",
        body: data,
      });
    },
    onSuccess: (data) => {
      toast.success(`Workspace renamed to "${data.name}"`);
      queryClient.invalidateQueries({ queryKey: queryKeys.currentOrganization });
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations });
    },
    onError: (err) => {
      toast.error(`Failed to update workspace: ${err instanceof Error ? err.message : "Unknown error"}`);
    },
  });
}

export function useCreateOrganizationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { name: string; tier?: string }) => {
      const res = await apiFetch<{
        organization: Organization;
        access: string;
        refresh: string;
        user: User;
      }>("/organizations/", {
        method: "POST",
        body: data,
      });
      if (res.access) {
        localStorage.setItem("teamflow_access", res.access);
        if (res.refresh) localStorage.setItem("teamflow_refresh", res.refresh);
      }
      return res;
    },
    onSuccess: (data) => {
      toast.success(`Workspace "${data.organization.name}" created successfully`);
      queryClient.invalidateQueries({ queryKey: queryKeys.currentOrganization });
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks() });
    },
    onError: (err) => {
      toast.error(`Failed to create workspace: ${err instanceof Error ? err.message : "Unknown error"}`);
    },
  });
}

export function useSwitchOrganizationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orgId: number) => {
      const res = await apiFetch<{
        message: string;
        organization: Organization;
        access: string;
        refresh: string;
        user: User;
      }>(`/organizations/switch/${orgId}/`, {
        method: "POST",
      });
      if (res.access) {
        localStorage.setItem("teamflow_access", res.access);
        if (res.refresh) localStorage.setItem("teamflow_refresh", res.refresh);
      }
      return res;
    },
    onSuccess: (data) => {
      toast.success(`Switched to workspace "${data.organization.name}"`);
      queryClient.invalidateQueries({ queryKey: queryKeys.currentOrganization });
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks() });
      queryClient.invalidateQueries({ queryKey: queryKeys.team });
    },
    onError: (err) => {
      toast.error(`Failed to switch workspace: ${err instanceof Error ? err.message : "Access denied"}`);
    },
  });
}

export function useInviteMemberMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { email: string; name?: string; role?: string }) => {
      return apiFetch<User>("/organizations/invite/", {
        method: "POST",
        body: data,
      });
    },
    onSuccess: (data) => {
      toast.success(`Invitation sent to ${data.email}`);
      queryClient.invalidateQueries({ queryKey: queryKeys.team });
      queryClient.invalidateQueries({ queryKey: queryKeys.currentOrganization });
    },
    onError: (err) => {
      toast.error(`Failed to invite member: ${err instanceof Error ? err.message : "Unknown error"}`);
    },
  });
}

