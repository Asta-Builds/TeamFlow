"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import {
  ShieldCheck,
  Bot,
  Database,
  Kanban,
  Activity,
  Rocket,
  SearchCheck,
  Crown,
  Code2,
  GitPullRequest,
  CheckCircle2,
  ExternalLink,
  ArrowRight,
  Zap,
  Lock,
} from "lucide-react";

const KEYCLOAK_URL = process.env.NEXT_PUBLIC_KEYCLOAK_URL || "http://localhost:8080";
const KEYCLOAK_REALM = process.env.NEXT_PUBLIC_KEYCLOAK_REALM || "teamflow";
const KEYCLOAK_CLIENT_ID = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID || "teamflow-app";

const DEMO_STEPS = [
  {
    agent: "Tech Lead (Sarah Jenkins)",
    role: "Orchestrator",
    action: "RAG Context Query & Task Decomposition",
    detail: "Queried pgvector RAG store (ADR-001 JWT Auth). Dispatched API fix to Backend agent and tests to QA.",
    tokens: 420,
    cost: "$0.0042",
    node: "tech_lead",
    icon: Code2,
  },
  {
    agent: "Senior Backend (Marcus Aurelius)",
    role: "Backend Engineer",
    action: "Pull Request Created",
    detail: "Implemented mutex lock on refresh token endpoint. Opened GitHub PR #324 on branch `feat/jwt-mutex`.",
    tokens: 650,
    cost: "$0.0065",
    node: "backend",
    pr_url: "https://github.com/teamflow/teamflow/pull/324",
    icon: GitPullRequest,
  },
  {
    agent: "QA Gate (Alan Turing)",
    role: "QA Engineer",
    action: "Automated Test Suite Passed",
    detail: "Executed 18 integration tests with concurrency > 50 req/s. Verified zero race conditions. Approved for release.",
    tokens: 480,
    cost: "$0.0048",
    node: "qa",
    icon: ShieldCheck,
  },
  {
    agent: "DevOps Engineer (Joan of Arc)",
    role: "DevOps & Release",
    action: "Merged & Deployed to Staging",
    detail: "Squashed & merged PR #324 into `main`. Triggered CI/CD pipeline. Staging container live and health check passed (HTTP 200).",
    tokens: 390,
    cost: "$0.0039",
    node: "devops",
    icon: Rocket,
  },
];

const ROLE_PREVIEWS = {
  ceo: {
    title: "CEO & Executive Dashboard",
    subtitle: "High-level visibility into company velocity, project health, and autonomous agent token expenditure.",
    points: [
      "Real-time project completion % and sprint deliverables tracking",
      "Live LLM token consumption & USD budget control per project",
      "Zero critical blocker escalation dashboard",
      "Full GDPR-compliant JSON/CSV workspace data export",
    ],
    badge: "Executive Oversight",
    icon: Crown,
  },
  tech_lead: {
    title: "Tech Lead Action Center",
    subtitle: "Autonomous task decomposition, codebase architecture RAG, and automated Pull Request review queue.",
    points: [
      "LangGraph StateGraph orchestration distributing subtasks to specialists",
      "PostgreSQL + pgvector semantic search across architecture ADRs & code",
      "Automated code review and GitHub branch management",
      "Least-privilege governance: only Tech Lead can merge to main",
    ],
    badge: "Orchestration & Governance",
    icon: Code2,
  },
  qa: {
    title: "QA Automation & Decision Gate",
    subtitle: "Automated acceptance criteria verification with mandatory rejection feedback loop.",
    points: [
      "Strict 5-stage Kanban gate: tickets cannot close without QA sign-off",
      "Automated rejection cycle returning tickets to developer with root cause",
      "Full audit trail logged to TaskActivity stream",
      "Regression test suites integration with GitHub Actions CI",
    ],
    badge: "Quality Assurance Gate",
    icon: ShieldCheck,
  },
  devops: {
    title: "DevOps & Staging Release Pipelines",
    subtitle: "Continuous delivery, live build logs streaming, and instant 1-click rollback.",
    points: [
      "Automated release triggers upon QA validation approval",
      "Live container build and deployment logs viewer",
      "1-Click instant rollback to previous stable commit SHA",
      "Multi-environment support: Staging, Production, and Preview",
    ],
    badge: "Continuous Delivery",
    icon: Rocket,
  },
  seo: {
    title: "Technical SEO & Performance Audits",
    subtitle: "Core Web Vitals monitoring and 1-click automated engineering ticket generation.",
    points: [
      "LCP, FID, CLS, TTFB and FCP latency benchmarks",
      "Automated canonical tags, robots.txt, and sitemap detection",
      "1-Click conversion of SEO issues into prioritized engineering tasks",
      "Mobile and desktop performance scoring out-of-the-box",
    ],
    badge: "Core Web Vitals",
    icon: SearchCheck,
  },
};

export default function LandingPage() {
  const { user } = useAuth();
  const [activeStep, setActiveStep] = useState(0);
  const [activeRole, setActiveRole] = useState<keyof typeof ROLE_PREVIEWS>("tech_lead");

  useEffect(() => {
    // Purge legacy Clerk artifacts from URL and cookies
    if (typeof window !== "undefined") {
      if (window.location.search.includes("__clerk")) {
        const url = new URL(window.location.href);
        url.searchParams.delete("__clerk_handshake");
        url.searchParams.delete("__clerk_help");
        const cleanUrl = url.pathname + (url.search ? url.search : "");
        window.history.replaceState({}, document.title, cleanUrl);
      }
      const legacyCookies = ["__session", "__client_uat", "__clerk_db_jwt"];
      legacyCookies.forEach((name) => {
        document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;`;
        document.cookie = `${name}=; Path=/; Domain=${window.location.hostname}; Expires=Thu, 01 Jan 1970 00:00:01 GMT;`;
      });
    }
  }, []);

  function loginWithKeycloak() {
    const redirectUri = encodeURIComponent(`${window.location.origin}/auth/callback`);
    const authUrl = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth?client_id=${KEYCLOAK_CLIENT_ID}&response_type=code&redirect_uri=${redirectUri}&scope=openid%20profile%20email`;
    window.location.href = authUrl;
  }

  const ActiveRoleIcon = ROLE_PREVIEWS[activeRole].icon;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white">
      {/* Sticky Header */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-slate-950/80 border-b border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-xs font-extrabold text-white shadow-md shadow-indigo-600/40">
                TF
              </div>
              <span className="text-base font-black tracking-tight text-white">TeamFlow</span>
            </Link>

            <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-slate-400">
              <a href="#features" className="hover:text-white transition">Features</a>
              <a href="#agents" className="hover:text-white transition">Multi-Agent Swarm</a>
              <a href="#roles" className="hover:text-white transition">Role Portals</a>
              <a href="#pricing" className="hover:text-white transition">Pricing</a>
              <a href="http://localhost:8000/api/docs/" target="_blank" rel="noreferrer" className="hover:text-white transition flex items-center gap-1">
                <span>API Docs</span>
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {user ? (
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-500 transition"
              >
                <span>Dashboard</span>
                <ArrowRight className="h-3 w-3" />
              </Link>
            ) : (
              <>
                <button
                  onClick={loginWithKeycloak}
                  className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 transition cursor-pointer"
                  title="Sign in with Keycloak OpenID Connect SSO"
                >
                  <Lock className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Keycloak SSO</span>
                </button>

                <Link
                  href="/login"
                  className="rounded-xl bg-white px-4 py-1.5 text-xs font-bold text-slate-950 hover:bg-slate-200 transition"
                >
                  Sign In
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-16 pb-24 lg:pt-24 lg:pb-32 border-b border-slate-800/80">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-indigo-600/20 blur-[120px] rounded-full pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-8">
          {/* Announcement pill */}
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-950/40 px-3.5 py-1 text-xs font-semibold text-indigo-300 shadow-sm backdrop-blur-xs">
            <span className="flex h-2 w-2 rounded-full bg-indigo-400 animate-pulse"></span>
            <span>TeamFlow 2.0 : LangGraph Multi-Agent Orchestration & pgvector RAG</span>
          </div>

          {/* Main Headline */}
          <div className="max-w-4xl mx-auto space-y-4">
            <h1 className="text-4xl sm:text-6xl font-black tracking-tight text-white leading-[1.1]">
              Orchestrate Your Virtual Tech Company with{" "}
              <span className="bg-gradient-to-r from-indigo-400 via-indigo-200 to-white bg-clip-text text-transparent">
                Autonomous AI Agents
              </span>
            </h1>
            <p className="text-base sm:text-lg text-slate-400 max-w-2xl mx-auto font-normal leading-relaxed">
              Bridge human engineering with autonomous agent swarms across a 5-stage Kanban workflow, grounded by pgvector RAG and traced via Langfuse.
            </p>
          </div>

          {/* Action CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-3.5 pt-2">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-xs sm:text-sm font-bold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 transition cursor-pointer"
            >
              <Zap className="h-4 w-4" />
              <span>Launch Virtual Workspace</span>
            </Link>

            <button
              onClick={loginWithKeycloak}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/90 px-5 py-3 text-xs sm:text-sm font-bold text-slate-200 hover:bg-slate-800 transition cursor-pointer"
            >
              <Lock className="h-4 w-4 text-indigo-400" />
              <span>Sign in with Keycloak (SSO)</span>
            </button>
          </div>

          {/* Interactive Multi-Agent Swarm Simulator */}
          <div id="agents" className="max-w-4xl mx-auto pt-10 text-left">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-7 shadow-2xl space-y-6">
              {/* Simulator Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-3 w-3 gap-1.5">
                    <span className="h-3 w-3 rounded-full bg-rose-500/80"></span>
                    <span className="h-3 w-3 rounded-full bg-amber-500/80"></span>
                    <span className="h-3 w-3 rounded-full bg-emerald-500/80"></span>
                  </div>
                  <span className="text-xs font-mono text-slate-400">
                    ticket-124 : Fix JWT token refresh race condition under concurrency
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-[11px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 rounded-md">
                    LangGraph StateGraph Active
                  </span>
                </div>
              </div>

              {/* Multi-Agent Sequence Tabs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {DEMO_STEPS.map((step, idx) => {
                  const StepIcon = step.icon;
                  return (
                    <button
                      key={idx}
                      onClick={() => setActiveStep(idx)}
                      className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                        activeStep === idx
                          ? "border-indigo-500 bg-indigo-950/40 shadow-xs"
                          : "border-slate-800 bg-slate-950/50 hover:bg-slate-800/60"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-bold text-white truncate">
                        <StepIcon className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                        <span className="truncate">{step.role}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 truncate">{step.action}</div>
                    </button>
                  );
                })}
              </div>

              {/* Active Step Details */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">{DEMO_STEPS[activeStep].agent}</span>
                    <span className="text-[10px] font-semibold text-indigo-400 bg-indigo-950/80 border border-indigo-800/60 px-2 py-0.5 rounded-md">
                      {DEMO_STEPS[activeStep].role}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400">
                    <span>Tokens: <strong className="text-slate-200">{DEMO_STEPS[activeStep].tokens}</strong></span>
                    <span>Cost: <strong className="text-emerald-400">{DEMO_STEPS[activeStep].cost}</strong></span>
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed font-normal">
                  {DEMO_STEPS[activeStep].detail}
                </p>

                {DEMO_STEPS[activeStep].pr_url && (
                  <div className="pt-1">
                    <a
                      href={DEMO_STEPS[activeStep].pr_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[11px] font-bold text-indigo-400 bg-indigo-950/50 border border-indigo-800/40 px-2.5 py-1 rounded-md hover:text-indigo-300"
                    >
                      <GitPullRequest className="h-3.5 w-3.5" />
                      <span>GitHub PR #324</span>
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                )}
              </div>

              {/* Observability Footer */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-500 pt-1 border-t border-slate-800/80">
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                  <span>Langfuse Session: ticket-124-prod-trace</span>
                </div>
                <div className="flex items-center gap-4 text-[11px]">
                  <span>Total Tokens: <strong className="text-slate-300">1,940</strong></span>
                  <span>Total Latency: <strong className="text-slate-300">3.2s</strong></span>
                  <span className="text-indigo-400 font-semibold">100% Traced</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Metrics Bar */}
      <section className="py-12 border-b border-slate-800/80 bg-slate-950/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-6 lg:grid-cols-4 text-center">
            <div className="space-y-1">
              <div className="text-3xl sm:text-4xl font-black text-white">10x</div>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Feature Delivery Speed</div>
            </div>
            <div className="space-y-1">
              <div className="text-3xl sm:text-4xl font-black text-indigo-400">99.4%</div>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">QA Verification Gate Pass</div>
            </div>
            <div className="space-y-1">
              <div className="text-3xl sm:text-4xl font-black text-white">pgvector</div>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Architecture & Code RAG</div>
            </div>
            <div className="space-y-1">
              <div className="text-3xl sm:text-4xl font-black text-emerald-400">100%</div>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Langfuse Observability</div>
            </div>
          </div>
        </div>
      </section>

      {/* Core Features Grid */}
      <section id="features" className="py-20 lg:py-28 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="text-center max-w-3xl mx-auto space-y-3">
          <h2 className="text-xs font-extrabold uppercase tracking-widest text-indigo-400">
            Engineered for Production Scale
          </h2>
          <h3 className="text-2xl sm:text-4xl font-black tracking-tight text-white">
            Everything Required to Run a Complete Tech Organization
          </h3>
          <p className="text-sm text-slate-400 font-normal">
            From granular role permissions to automated QA gates, deployments, and SEO audits.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Card 1 */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-3 hover:border-slate-700 transition">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-950 text-indigo-400 border border-indigo-800/40">
              <Bot className="h-5 w-5" />
            </div>
            <h4 className="text-base font-bold text-white">LangGraph Multi-Agent Swarms</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              Stateful graph orchestration coordinating Tech Lead, Backend, Frontend, QA, DevOps, and SEO agents with automatic recursion limits and cycles.
            </p>
          </div>

          {/* Card 2 */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-3 hover:border-slate-700 transition">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-950 text-purple-400 border border-purple-800/40">
              <Database className="h-5 w-5" />
            </div>
            <h4 className="text-base font-bold text-white">PostgreSQL + pgvector RAG</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              Single datastore serving app tables and 384-dimensional vector embeddings. Ground agent PRs in ADRs, specs, and historical decisions.
            </p>
          </div>

          {/* Card 3 */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-3 hover:border-slate-700 transition">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-950 text-emerald-400 border border-emerald-800/40">
              <Kanban className="h-5 w-5" />
            </div>
            <h4 className="text-base font-bold text-white">5-Stage Kanban & QA Gate</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              Strict flow (todo → in_progress → in_review → qa → done). QA rejection requires mandatory reasoning and reverts tickets automatically.
            </p>
          </div>

          {/* Card 4 */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-3 hover:border-slate-700 transition">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-950 text-amber-400 border border-amber-800/40">
              <Activity className="h-5 w-5" />
            </div>
            <h4 className="text-base font-bold text-white">Langfuse Observability</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              Every LLM call, prompt version, tool invocation, token cost in USD, and latency traced with session_id = ticket_id.
            </p>
          </div>

          {/* Card 5 */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-3 hover:border-slate-700 transition">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-950 text-rose-400 border border-rose-800/40">
              <Rocket className="h-5 w-5" />
            </div>
            <h4 className="text-base font-bold text-white">Pipelines & 1-Click Rollback</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              Staging and Production release pipelines with live build logs viewer, duration tracking, and instant rollback to previous commit SHAs.
            </p>
          </div>

          {/* Card 6 */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-3 hover:border-slate-700 transition">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-950 text-cyan-400 border border-cyan-800/40">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h4 className="text-base font-bold text-white">Keycloak 26.1 Enterprise SSO</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              OpenID Connect authorization code flow, RBAC synchronization, custom Indigo/Inter theme, and user auto-provisioning.
            </p>
          </div>
        </div>
      </section>

      {/* Role-Tailored Portals */}
      <section id="roles" className="py-20 border-y border-slate-800/80 bg-slate-900/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center max-w-3xl mx-auto space-y-3">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-indigo-400">
              Role-Specific Action Centers
            </h2>
            <h3 className="text-2xl sm:text-4xl font-black tracking-tight text-white">
              Tailored Workspaces for Every Engineering Persona
            </h3>
          </div>

          {/* Role Pill Switcher */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {(Object.keys(ROLE_PREVIEWS) as Array<keyof typeof ROLE_PREVIEWS>).map((r) => {
              const RoleIcon = ROLE_PREVIEWS[r].icon;
              return (
                <button
                  key={r}
                  onClick={() => setActiveRole(r)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                    activeRole === r
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                      : "bg-slate-900 text-slate-400 border border-slate-800 hover:bg-slate-800 hover:text-slate-200"
                  }`}
                >
                  <RoleIcon className="h-3.5 w-3.5" />
                  <span>{ROLE_PREVIEWS[r].badge}</span>
                </button>
              );
            })}
          </div>

          {/* Role Detail Showcase Card */}
          <div className="max-w-4xl mx-auto rounded-2xl border border-slate-800 bg-slate-900/90 p-6 sm:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-indigo-950 border border-indigo-800/40 text-indigo-400">
                  <ActiveRoleIcon className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider block">
                    {ROLE_PREVIEWS[activeRole].badge}
                  </span>
                  <h3 className="text-xl font-bold text-white">{ROLE_PREVIEWS[activeRole].title}</h3>
                </div>
              </div>
              <span className="text-xs font-mono text-slate-400 bg-slate-950 px-3 py-1 rounded-lg border border-slate-800">
                Persona: {activeRole}
              </span>
            </div>

            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-normal">
              {ROLE_PREVIEWS[activeRole].subtitle}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              {ROLE_PREVIEWS[activeRole].points.map((pt, pIdx) => (
                <div key={pIdx} className="flex items-start gap-2.5 text-xs text-slate-300">
                  <CheckCircle2 className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
                  <span>{pt}</span>
                </div>
              ))}
            </div>

            <div className="pt-4 flex justify-end">
              <Link
                href="/login"
                className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-slate-950 hover:bg-slate-200 transition flex items-center gap-1.5"
              >
                <span>Experience {ROLE_PREVIEWS[activeRole].title.split(" ")[0]} View</span>
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 lg:py-28 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="text-center max-w-3xl mx-auto space-y-3">
          <h2 className="text-xs font-extrabold uppercase tracking-widest text-indigo-400">
            Simple & Predictable Pricing
          </h2>
          <h3 className="text-2xl sm:text-4xl font-black tracking-tight text-white">
            Empower Your Engineering Team at Any Scale
          </h3>
          <p className="text-sm text-slate-400 font-normal">
            Includes Stripe subscription checkout with automated webhook provisioning.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {/* Starter */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-7 space-y-6 flex flex-col justify-between">
            <div className="space-y-4">
              <div>
                <h4 className="text-base font-bold text-white">Starter</h4>
                <p className="text-xs text-slate-400 mt-1">Ideal for small teams exploring virtual management.</p>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-black text-white">$29</span>
                <span className="text-xs text-slate-500">/ month</span>
              </div>
              <ul className="space-y-2.5 text-xs text-slate-300 pt-2">
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> 5 Workspace Projects</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> 3 Autonomous Agent Seats</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> 5-Stage Kanban Board</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Staging Release Pipelines</li>
              </ul>
            </div>
            <Link
              href="/login"
              className="w-full text-center rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 transition block"
            >
              Get Started with Starter
            </Link>
          </div>

          {/* Growth (Featured) */}
          <div className="relative rounded-2xl border-2 border-indigo-500 bg-slate-900 p-7 space-y-6 flex flex-col justify-between shadow-2xl shadow-indigo-600/20">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-3 py-0.5 text-[10px] font-extrabold uppercase tracking-widest text-white">
              Most Popular
            </div>
            <div className="space-y-4">
              <div>
                <h4 className="text-base font-bold text-white">Growth</h4>
                <p className="text-xs text-slate-400 mt-1">Full swarm power for fast-scaling engineering teams.</p>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-black text-white">$79</span>
                <span className="text-xs text-slate-500">/ month</span>
              </div>
              <ul className="space-y-2.5 text-xs text-slate-300 pt-2">
                <li className="flex items-center gap-2 font-semibold text-white"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Unlimited Projects</li>
                <li className="flex items-center gap-2 font-semibold text-white"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> All 9 Specialist Agent Seats</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> pgvector Codebase & ADR RAG</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Production Deploys & Rollback</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Langfuse Tracing & Cost Logs</li>
              </ul>
            </div>
            <Link
              href="/login"
              className="w-full text-center rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-600/40 hover:bg-indigo-500 transition block"
            >
              Start Growth Trial
            </Link>
          </div>

          {/* Enterprise */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-7 space-y-6 flex flex-col justify-between">
            <div className="space-y-4">
              <div>
                <h4 className="text-base font-bold text-white">Enterprise</h4>
                <p className="text-xs text-slate-400 mt-1">Dedicated security, Keycloak SSO, and custom agents.</p>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-black text-white">$199</span>
                <span className="text-xs text-slate-500">/ month</span>
              </div>
              <ul className="space-y-2.5 text-xs text-slate-300 pt-2">
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Everything in Growth</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Keycloak OpenID Connect Realm</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Unlimited Langfuse Trace Retention</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Custom LLM Model Adapters</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> 99.9% Uptime SLA & Priority Support</li>
              </ul>
            </div>
            <Link
              href="/login"
              className="w-full text-center rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 transition block"
            >
              Contact Enterprise Sales
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-12 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-600 text-[10px] font-extrabold text-white">
              TF
            </div>
            <span className="font-bold text-slate-300">TeamFlow Inc.</span>
            <span>— Virtual Tech Company Management Platform</span>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <Link href="/login" className="hover:text-slate-300 transition">Login</Link>
            <button onClick={loginWithKeycloak} className="hover:text-slate-300 transition cursor-pointer">Keycloak SSO</button>
            <a href="http://localhost:8000/api/docs/" target="_blank" rel="noreferrer" className="hover:text-slate-300 transition">Swagger API</a>
            <a href="https://github.com/Asta-Builds/TeamFlow" target="_blank" rel="noreferrer" className="hover:text-slate-300 transition">GitHub</a>
            <span>v2.0 Standalone</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
