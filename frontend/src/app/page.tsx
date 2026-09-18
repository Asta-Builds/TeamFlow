"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { toast } from "sonner";
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
  Sparkles,
  Palette,
  Layers,
  Monitor,
  Tablet,
  Smartphone,
  Copy,
  Check,
  Terminal,
  Sliders,
  Play,
  FileCode,
  Users,
  Eye,
} from "lucide-react";

const CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const API_DOCS_URL = process.env.NEXT_PUBLIC_API_DOCS_URL || "/api/docs/";
const SOURCE_REPOSITORY_URL = process.env.NEXT_PUBLIC_SOURCE_REPOSITORY_URL;

// Live Studio Mockup Agents
const STUDIO_AGENTS = [
  {
    role: "AI PM (Athena)",
    action: "Spec Decomposition",
    message: "Decomposed prompt into 4 UI components adhering to SuperDesign tokens.",
    color: "text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/60 border-violet-200 dark:border-violet-800/40",
    time: "10:42:01",
  },
  {
    role: "UI/UX Designer",
    action: "Design Token Sync",
    message: "Generated Obsidian Glass palette, 4px grid rhythm, and WCAG AA contrast tokens.",
    color: "text-pink-600 dark:text-pink-400 bg-pink-50 dark:bg-pink-950/60 border-pink-200 dark:border-pink-800/40",
    time: "10:42:03",
  },
  {
    role: "Senior Frontend",
    action: "React Component Scaffolding",
    message: "Scaffolded Next.js 16 App Router view with Lucide React icons and Sonner toasts.",
    color: "text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950/60 border-cyan-200 dark:border-cyan-800/40",
    time: "10:42:06",
  },
  {
    role: "QA Engineer Gate",
    action: "Acceptance Validation",
    message: "Validated 18 visual regression tests and zero raw emoji compliance. APPROVED.",
    color: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800/40",
    time: "10:42:09",
  },
];

const CODE_SNIPPET = `// Generated with TeamFlow SuperDesign Engine
import { Button, Card, Badge } from "@/components/ui";
import { Sparkles, ArrowRight, ShieldCheck } from "lucide-react";

export function MetricsWidget({ title, value, delta }: MetricProps) {
  return (
    <Card variant="glass" className="p-5 border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between mb-3">
        <Badge variant="cyan" size="sm">Live Telemetry</Badge>
        <Sparkles className="h-4 w-4 text-indigo-500" aria-hidden="true" />
      </div>
      <div className="text-3xl font-black text-slate-900 dark:text-white">{value}</div>
      <div className="flex items-center gap-1.5 text-xs text-emerald-600 mt-2 font-mono">
        <ShieldCheck className="h-3.5 w-3.5" />
        <span>{delta} verified by QA Gate</span>
      </div>
    </Card>
  );
}`;

const ROLE_PREVIEWS = {
  designer: {
    title: "UI/UX Designer Studio",
    badge: "Generative UI & Tokens",
    subtitle: "Define design systems, sync tokens with Figma, and inspect WCAG 2.1 AA accessibility in real time.",
    points: [
      "Dual-theme token engine (Obsidian Glass dark & Crisp Clean light)",
      "Zero raw emoji enforcement with automatic Lucide icon substitution",
      "Interactive component inspector with instant CSS/Tailwind export",
      "Automated contrast ratio validation (> 15:1 for headers, > 9:1 for body)",
    ],
    icon: Palette,
  },
  frontend: {
    title: "Senior Frontend Workspace",
    badge: "Next.js 16 & Micro-Interactions",
    subtitle: "Live component scaffolding, optimistic client UI, and real-time Server-Sent Events (SSE) hydration.",
    points: [
      "Modular components powered by Tailwind CSS v4 and CVA primitives",
      "Interactive feedback powered by Sonner non-blocking toasts",
      "Zero layout shifts with skeleton loaders and optimistic state updates",
      "Automated TypeScript typing generated directly from Django REST models",
    ],
    icon: Layers,
  },
  tech_lead: {
    title: "Tech Lead Orchestration Deck",
    badge: "Swarm Governance & RAG",
    subtitle: "Autonomous task decomposition, codebase architecture RAG, and automated Pull Request review queue.",
    points: [
      "LangGraph StateGraph orchestration distributing subtasks to specialists",
      "PostgreSQL + pgvector semantic search across architecture ADRs & code",
      "Automated code review and GitHub branch management",
      "Least-privilege governance: only Tech Lead can merge to main",
    ],
    icon: Code2,
  },
  qa: {
    title: "QA Automation & Decision Gate",
    badge: "Quality Assurance Gate",
    subtitle: "Automated acceptance criteria verification with mandatory rejection feedback loop.",
    points: [
      "Strict 5-stage Kanban gate: tickets cannot close without QA sign-off",
      "Automated rejection cycle returning tickets to developer with root cause",
      "Full audit trail logged to TaskActivity stream",
      "Regression test suites integration with GitHub Actions CI",
    ],
    icon: ShieldCheck,
  },
  devops: {
    title: "DevOps & Release Pipelines",
    badge: "Continuous Delivery",
    subtitle: "Continuous delivery, live build logs streaming, and instant 1-click rollback.",
    points: [
      "Automated release triggers upon QA validation approval",
      "Live container build and deployment logs viewer",
      "1-Click instant rollback to previous stable commit SHA",
      "Multi-environment support: Staging, Production, and Preview",
    ],
    icon: Rocket,
  },
  ceo: {
    title: "Executive & Founder Dashboard",
    badge: "Executive Oversight",
    subtitle: "High-level visibility into company velocity, project health, and autonomous agent token expenditure.",
    points: [
      "Real-time project completion % and sprint deliverables tracking",
      "Live LLM token consumption & USD budget control per project",
      "Zero critical blocker escalation dashboard",
      "Full GDPR-compliant JSON/CSV workspace data export",
    ],
    icon: Crown,
  },
};

export default function LandingPage() {
  const { user } = useAuth();
  const [activeRole, setActiveRole] = useState<keyof typeof ROLE_PREVIEWS>("designer");
  const [activeDevice, setActiveDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [canvasTheme, setCanvasTheme] = useState<"dark" | "light">("dark");
  const [copied, setCopied] = useState(false);
  const [studioTab, setStudioTab] = useState<"canvas" | "code" | "audit">("canvas");

  function loginWithClerk() {
    window.location.href = "/sign-in";
  }

  function handleCopyCode() {
    navigator.clipboard.writeText(CODE_SNIPPET);
    setCopied(true);
    toast.success("Component code copied to clipboard", {
      description: "Ready to paste into your Next.js project",
    });
    setTimeout(() => setCopied(false), 2000);
  }

  const ActiveRoleIcon = ROLE_PREVIEWS[activeRole].icon;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans selection:bg-indigo-500 selection:text-white">
      {/* Sticky Header */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-white/80 dark:bg-slate-950/80 border-b border-slate-200/80 dark:border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 text-xs font-extrabold text-white shadow-md shadow-indigo-600/30">
                TF
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-base font-black tracking-tight text-slate-900 dark:text-white">TeamFlow</span>
                <span className="hidden sm:inline-block rounded-md bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                  SuperDesign SaaS
                </span>
              </div>
            </Link>

            <nav className="hidden lg:flex items-center gap-6 text-xs font-semibold text-slate-600 dark:text-slate-400">
              <a href="#studio" className="hover:text-slate-900 dark:hover:text-white transition">Design Studio</a>
              <a href="#features" className="hover:text-slate-900 dark:hover:text-white transition">Features</a>
              <a href="#workflow" className="hover:text-slate-900 dark:hover:text-white transition">Swarm Workflow</a>
              <a href="#roles" className="hover:text-slate-900 dark:hover:text-white transition">Role Portals</a>
              <a href="#pricing" className="hover:text-slate-900 dark:hover:text-white transition">Pricing</a>
              <a href={API_DOCS_URL} target="_blank" rel="noreferrer" className="hover:text-slate-900 dark:hover:text-white transition flex items-center gap-1">
                <span>API Docs</span>
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />

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
                {Boolean(CLERK_PUBLISHABLE_KEY) && (
                  <button
                    onClick={loginWithClerk}
                    className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/30 bg-indigo-50/50 dark:bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-slate-800 transition cursor-pointer"
                    title="Sign in with Clerk Authentication"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
                    <span>Clerk Auth</span>
                  </button>
                )}

                <Link
                  href="/login"
                  className="rounded-xl bg-slate-900 dark:bg-white px-4 py-1.5 text-xs font-bold text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-slate-200 transition"
                >
                  Sign In
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-14 pb-20 lg:pt-20 lg:pb-28 border-b border-slate-200/80 dark:border-slate-800/80">
        {/* Ambient Glows */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[380px] bg-gradient-to-tr from-indigo-600/15 via-purple-600/15 to-cyan-500/15 dark:from-indigo-600/25 dark:via-purple-600/20 dark:to-cyan-400/20 blur-[130px] rounded-full pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-7">
          {/* Announcement pill */}
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-50/80 dark:bg-indigo-950/50 px-3.5 py-1 text-xs font-semibold text-indigo-700 dark:text-indigo-300 shadow-sm backdrop-blur-xs">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>TeamFlow 2.0 : Autonomous Design Studio & Generative UI Engine</span>
          </div>

          {/* Main Headline */}
          <div className="max-w-4xl mx-auto space-y-4">
            <h1 className="text-4xl sm:text-6xl font-black tracking-tight text-slate-900 dark:text-white leading-[1.1]">
              Where Human Vision Meets{" "}
              <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-500 dark:from-indigo-400 dark:via-purple-300 dark:to-cyan-300 bg-clip-text text-transparent">
                Autonomous Design Swarms
              </span>
            </h1>
            <p className="text-base sm:text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto font-normal leading-relaxed">
              Design, scaffold, review, and ship production-ready SaaS interfaces at 10x speed with collaborative AI agent specialists powered by LangGraph and pgvector RAG.
            </p>
          </div>

          {/* Action CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-3.5 pt-2">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 px-6 py-3 text-xs sm:text-sm font-bold text-white shadow-lg shadow-indigo-600/30 transition cursor-pointer"
            >
              <Zap className="h-4 w-4" />
              <span>Launch Design Studio Free</span>
            </Link>

            <a
              href="#studio"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3 text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition cursor-pointer"
            >
              <Play className="h-3.5 w-3.5 text-indigo-500" />
              <span>Explore Live Canvas</span>
            </a>
          </div>

          {/* Centerpiece: Interactive Live Design Studio Mockup */}
          <div id="studio" className="max-w-5xl mx-auto pt-8 text-left">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 shadow-2xl backdrop-blur-xl overflow-hidden transition-all duration-300">
              {/* Studio Toolbar Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-4 py-3 bg-slate-50/80 dark:bg-slate-950/60">
                <div className="flex items-center gap-3">
                  <div className="flex h-3 w-3 gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80"></span>
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80"></span>
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80"></span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-mono text-slate-600 dark:text-slate-400">
                    <Terminal className="h-3 w-3 text-indigo-500" />
                    <span className="font-semibold text-slate-900 dark:text-white">Studio Canvas</span>
                    <span className="text-slate-400 dark:text-slate-600">/</span>
                    <span className="truncate">project-65: TeamFlow MVP</span>
                  </div>
                </div>

                {/* Breakpoint Switcher & Controls */}
                <div className="flex items-center gap-2">
                  <div className="hidden sm:flex items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-0.5 text-xs">
                    <button
                      onClick={() => setActiveDevice("desktop")}
                      className={`p-1.5 rounded-md transition ${activeDevice === "desktop" ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-900 dark:hover:text-white"}`}
                      title="Desktop View (1280px)"
                    >
                      <Monitor className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setActiveDevice("tablet")}
                      className={`p-1.5 rounded-md transition ${activeDevice === "tablet" ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-900 dark:hover:text-white"}`}
                      title="Tablet View (768px)"
                    >
                      <Tablet className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setActiveDevice("mobile")}
                      className={`p-1.5 rounded-md transition ${activeDevice === "mobile" ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-900 dark:hover:text-white"}`}
                      title="Mobile View (375px)"
                    >
                      <Smartphone className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Mode switcher within mockup */}
                  <button
                    onClick={() => setCanvasTheme(canvasTheme === "dark" ? "light" : "dark")}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                  >
                    <Sliders className="h-3 w-3 text-indigo-500" />
                    <span>Canvas: {canvasTheme === "dark" ? "Obsidian" : "Light"}</span>
                  </button>

                  <div className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/40 px-2 py-0.5 rounded-md">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                    <span>4 Agents Syncing</span>
                  </div>
                </div>
              </div>

              {/* Studio Workspace 3-Column Layout */}
              <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[440px]">
                {/* Left Column: Autonomous Agent Feed */}
                <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 p-4 space-y-3 bg-slate-50/50 dark:bg-slate-950/40">
                  <div className="flex items-center justify-between pb-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Autonomous Swarm</span>
                    <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/80 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800/40">
                      LangGraph Live
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {STUDIO_AGENTS.map((ag, i) => (
                      <div
                        key={i}
                        className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-slate-900/80 p-3 space-y-1 shadow-2xs hover:border-slate-300 dark:hover:border-slate-700 transition"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${ag.color}`}>
                            {ag.role}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">{ag.time}</span>
                        </div>
                        <p className="text-xs text-slate-700 dark:text-slate-300 font-normal leading-relaxed pt-1">
                          {ag.message}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="p-2.5 rounded-xl border border-indigo-500/20 bg-indigo-50/60 dark:bg-indigo-950/30 flex items-center justify-between text-[11px] text-indigo-700 dark:text-indigo-300 font-medium">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                      <span>RAG ADR-002 Grounded</span>
                    </span>
                    <span className="font-mono text-[10px]">Cost: $0.0034</span>
                  </div>
                </div>

                {/* Center & Right Column: Interactive Canvas & Inspector */}
                <div className="lg:col-span-8 flex flex-col">
                  {/* View Tabs */}
                  <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4 py-2 bg-slate-50/30 dark:bg-slate-950/20">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setStudioTab("canvas")}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                          studioTab === "canvas"
                            ? "bg-indigo-600 text-white"
                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        }`}
                      >
                        <Eye className="h-3 w-3" />
                        <span>Visual Preview</span>
                      </button>
                      <button
                        onClick={() => setStudioTab("code")}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                          studioTab === "code"
                            ? "bg-indigo-600 text-white"
                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        }`}
                      >
                        <FileCode className="h-3 w-3" />
                        <span>React Code</span>
                      </button>
                      <button
                        onClick={() => setStudioTab("audit")}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                          studioTab === "audit"
                            ? "bg-indigo-600 text-white"
                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        }`}
                      >
                        <ShieldCheck className="h-3 w-3" />
                        <span>Design Audit</span>
                      </button>
                    </div>

                    {studioTab === "code" && (
                      <button
                        onClick={handleCopyCode}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:text-indigo-600 transition cursor-pointer"
                      >
                        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                        <span>{copied ? "Copied" : "Copy JSX"}</span>
                      </button>
                    )}
                  </div>

                  {/* Tab Body */}
                  <div className={`p-6 flex-1 flex flex-col justify-center transition-colors duration-200 ${
                    canvasTheme === "dark" ? "bg-slate-950 text-slate-100" : "bg-slate-100/70 text-slate-900"
                  }`}>
                    {studioTab === "canvas" && (
                      <div className={`mx-auto w-full transition-all duration-300 ${
                        activeDevice === "mobile" ? "max-w-[340px]" : activeDevice === "tablet" ? "max-w-[540px]" : "max-w-full"
                      }`}>
                        {/* Interactive Wireframe Preview Component */}
                        <div className={`rounded-2xl border p-5 space-y-4 shadow-xl relative transition-all ${
                          canvasTheme === "dark"
                            ? "bg-slate-900/90 border-indigo-500/40 shadow-indigo-500/10"
                            : "bg-white border-indigo-500/30 shadow-slate-200"
                        }`}>
                          {/* Selection indicator pill */}
                          <div className="absolute -top-2.5 left-4 px-2 py-0.5 rounded-md bg-indigo-600 text-[10px] font-mono text-white font-bold flex items-center gap-1 shadow-sm">
                            <span>Component: SwarmVelocityCard</span>
                            <span className="text-cyan-300">#selected</span>
                          </div>

                          <div className="flex items-center justify-between pt-1">
                            <div>
                              <div className="text-xs font-bold uppercase tracking-wider text-indigo-500">Live Telemetry</div>
                              <h3 className="text-lg font-black tracking-tight">Active Agent Throughput</h3>
                            </div>
                            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400">
                              <Zap className="h-4 w-4" />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                            <div className={`p-3 rounded-xl border ${canvasTheme === "dark" ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
                              <span className="text-[10px] text-slate-500 uppercase font-semibold">Delivery Velocity</span>
                              <div className="text-xl font-black mt-0.5">10.4x</div>
                              <span className="text-[10px] text-emerald-500 font-mono font-medium">+24% vs sprint 4</span>
                            </div>
                            <div className={`p-3 rounded-xl border ${canvasTheme === "dark" ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
                              <span className="text-[10px] text-slate-500 uppercase font-semibold">QA Gate Approval</span>
                              <div className="text-xl font-black mt-0.5 text-emerald-500">99.4%</div>
                              <span className="text-[10px] text-slate-500 font-mono">0 regressions</span>
                            </div>
                            <div className={`col-span-2 sm:col-span-1 p-3 rounded-xl border ${canvasTheme === "dark" ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
                              <span className="text-[10px] text-slate-500 uppercase font-semibold">Token USD Cost</span>
                              <div className="text-xl font-black mt-0.5 text-cyan-400">$0.042</div>
                              <span className="text-[10px] text-slate-500 font-mono">budget 12%</span>
                            </div>
                          </div>

                          {/* Action Preview */}
                          <div className="flex items-center justify-between pt-1 text-xs">
                            <span className="text-slate-500">Style tokens: Obsidian Glass / Round 8px</span>
                            <button className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-500 transition shadow-sm flex items-center gap-1">
                              <span>Generate Variation</span>
                              <Sparkles className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {studioTab === "code" && (
                      <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-300 overflow-x-auto max-h-[320px]">
                        <pre>{CODE_SNIPPET}</pre>
                      </div>
                    )}

                    {studioTab === "audit" && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg mx-auto w-full">
                        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">WCAG AA Contrast</span>
                            <span className="text-xs font-mono text-emerald-500 font-bold">15.2:1 (AAA)</span>
                          </div>
                          <p className="text-[11px] text-slate-500">Verified between slate-950 and white text.</p>
                        </div>
                        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">Raw Emojis Check</span>
                            <span className="text-xs font-mono text-emerald-500 font-bold">0 Detected</span>
                          </div>
                          <p className="text-[11px] text-slate-500">Strictly vector Lucide React icons in all elements.</p>
                        </div>
                        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">Keyboard Traversal</span>
                            <span className="text-xs font-mono text-emerald-500 font-bold">100% Accessible</span>
                          </div>
                          <p className="text-[11px] text-slate-500">Visible focus rings on all interactive tags.</p>
                        </div>
                        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">Interactive Feedback</span>
                            <span className="text-xs font-mono text-emerald-500 font-bold">Sonner Toasts</span>
                          </div>
                          <p className="text-[11px] text-slate-500">Non-blocking, accessible toast notifications.</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Studio Footer Info */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 px-4 py-2.5 bg-slate-50/80 dark:bg-slate-950/60 text-xs text-slate-500">
                    <div className="flex items-center gap-2 font-mono text-[11px]">
                      <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                      <span>Langfuse Session: ticket-65-canvas-trace</span>
                    </div>
                    <div className="flex items-center gap-4 text-[11px]">
                      <span>Style: <strong className="text-slate-700 dark:text-slate-300">SuperDesign 2.0</strong></span>
                      <span>Render: <strong className="text-slate-700 dark:text-slate-300">Next.js 16 App Router</strong></span>
                      <span className="text-indigo-600 dark:text-indigo-400 font-semibold">100% Traced</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Metrics Bar */}
      <section className="py-12 border-b border-slate-200 dark:border-slate-800/80 bg-slate-100/50 dark:bg-slate-950/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-6 lg:grid-cols-4 text-center">
            <div className="space-y-1">
              <div className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white">10x</div>
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Design-to-Code Speed</div>
            </div>
            <div className="space-y-1">
              <div className="text-3xl sm:text-4xl font-black text-indigo-600 dark:text-indigo-400">99.4%</div>
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">QA Gate Pass Rate</div>
            </div>
            <div className="space-y-1">
              <div className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white">384-Dim</div>
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">pgvector Codebase RAG</div>
            </div>
            <div className="space-y-1">
              <div className="text-3xl sm:text-4xl font-black text-emerald-600 dark:text-emerald-400">100%</div>
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Vector Lucide Icons</div>
            </div>
          </div>
        </div>
      </section>

      {/* How it Works: 4-Step Swarm Workflow */}
      <section id="workflow" className="py-20 lg:py-28 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="text-center max-w-3xl mx-auto space-y-3">
          <h2 className="text-xs font-extrabold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
            Autonomous Pipeline
          </h2>
          <h3 className="text-2xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">
            From Natural Prompt to Production Release
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 font-normal">
            Autonomous AI agent specialists coordinate seamlessly across a deterministic 4-stage delivery cycle.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Step 1 */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-6 space-y-4 hover:border-indigo-500/50 transition">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">Step 01</span>
              <div className="h-8 w-8 rounded-lg bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                <Bot className="h-4 w-4" />
              </div>
            </div>
            <h4 className="text-base font-bold text-slate-900 dark:text-white">Prompt & WBS Decomposition</h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Athena (AI PM) parses requirements, generates Work Breakdown Structure (WBS), estimates token budget, and assigns specialist tickets.
            </p>
          </div>

          {/* Step 2 */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-6 space-y-4 hover:border-pink-500/50 transition">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-pink-600 dark:text-pink-400">Step 02</span>
              <div className="h-8 w-8 rounded-lg bg-pink-50 dark:bg-pink-950 flex items-center justify-center text-pink-600 dark:text-pink-400">
                <Palette className="h-4 w-4" />
              </div>
            </div>
            <h4 className="text-base font-bold text-slate-900 dark:text-white">Generative UI & Token Sync</h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              UI/UX Designer generates SuperDesign dual-mode tokens, wireframe layouts, and verifies WCAG 2.1 AA accessibility standards.
            </p>
          </div>

          {/* Step 3 */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-6 space-y-4 hover:border-cyan-500/50 transition">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-cyan-600 dark:text-cyan-400">Step 03</span>
              <div className="h-8 w-8 rounded-lg bg-cyan-50 dark:bg-cyan-950 flex items-center justify-center text-cyan-600 dark:text-cyan-400">
                <Code2 className="h-4 w-4" />
              </div>
            </div>
            <h4 className="text-base font-bold text-slate-900 dark:text-white">Full-Stack Code & PR</h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Senior Frontend & Backend agents query pgvector RAG, implement Next.js 16 components and API endpoints, and open GitHub PRs.
            </p>
          </div>

          {/* Step 4 */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-6 space-y-4 hover:border-emerald-500/50 transition">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">Step 04</span>
              <div className="h-8 w-8 rounded-lg bg-emerald-50 dark:bg-emerald-950 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="h-4 w-4" />
              </div>
            </div>
            <h4 className="text-base font-bold text-slate-900 dark:text-white">QA Gate & 1-Click Rollback</h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              QA Gate enforces automated validation tests. Upon sign-off, DevOps triggers staging releases with instant 1-click rollback capability.
            </p>
          </div>
        </div>
      </section>

      {/* Core Features Bento Grid */}
      <section id="features" className="py-20 lg:py-28 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="text-center max-w-3xl mx-auto space-y-3">
          <h2 className="text-xs font-extrabold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
            SuperDesign Features
          </h2>
          <h3 className="text-2xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">
            Engineered for High-Velocity Product Teams
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 font-normal">
            Everything required to design, scaffold, test, and release modern SaaS applications.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Card 1 */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-6 space-y-3 hover:border-indigo-500/50 transition shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/40">
              <Sparkles className="h-5 w-5" />
            </div>
            <h4 className="text-base font-bold text-slate-900 dark:text-white">Generative UI Studio</h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Natural language prompts synthesized into clean React 19 + Tailwind CSS v4 code, adhering to tokenized SuperDesign primitives.
            </p>
          </div>

          {/* Card 2 */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-6 space-y-3 hover:border-purple-500/50 transition shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800/40">
              <Bot className="h-5 w-5" />
            </div>
            <h4 className="text-base font-bold text-slate-900 dark:text-white">LangGraph Multi-Agent Swarm</h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Stateful graph architecture coordinating Tech Lead, Backend, Frontend, QA, DevOps, and SEO agents with automatic loop controls.
            </p>
          </div>

          {/* Card 3 */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-6 space-y-3 hover:border-cyan-500/50 transition shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 dark:bg-cyan-950 text-cyan-600 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800/40">
              <Database className="h-5 w-5" />
            </div>
            <h4 className="text-base font-bold text-slate-900 dark:text-white">PostgreSQL + pgvector RAG</h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Single datastore serving relational app models and 384-dimensional vector embeddings. Ground agent PRs in architectural specs and ADRs.
            </p>
          </div>

          {/* Card 4 */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-6 space-y-3 hover:border-emerald-500/50 transition shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40">
              <Kanban className="h-5 w-5" />
            </div>
            <h4 className="text-base font-bold text-slate-900 dark:text-white">5-Stage Kanban & QA Gate</h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Enforce strict review gates (todo → in_progress → in_review → qa → done). QA rejection triggers automatic feedback with root cause logging.
            </p>
          </div>

          {/* Card 5 */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-6 space-y-3 hover:border-amber-500/50 transition shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40">
              <Activity className="h-5 w-5" />
            </div>
            <h4 className="text-base font-bold text-slate-900 dark:text-white">Langfuse Observability</h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Every LLM invocation, prompt revision, tool execution, token cost in USD, and latency traced with session_id = ticket_id.
            </p>
          </div>

          {/* Card 6 */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-6 space-y-3 hover:border-rose-500/50 transition shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-950 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/40">
              <Rocket className="h-5 w-5" />
            </div>
            <h4 className="text-base font-bold text-slate-900 dark:text-white">Pipelines & 1-Click Rollback</h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Staging and production deployment pipelines with live container log streaming and instant 1-click rollback to previous commit SHAs.
            </p>
          </div>
        </div>
      </section>

      {/* Role-Tailored Portals */}
      <section id="roles" className="py-20 border-y border-slate-200 dark:border-slate-800/80 bg-slate-100/40 dark:bg-slate-900/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center max-w-3xl mx-auto space-y-3">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
              Specialist Action Centers
            </h2>
            <h3 className="text-2xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">
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
                      : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200"
                  }`}
                >
                  <RoleIcon className="h-3.5 w-3.5" />
                  <span>{ROLE_PREVIEWS[r].badge}</span>
                </button>
              );
            })}
          </div>

          {/* Role Detail Showcase Card */}
          <div className="max-w-4xl mx-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 sm:p-8 space-y-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800/40 text-indigo-600 dark:text-indigo-400">
                  <ActiveRoleIcon className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider block">
                    {ROLE_PREVIEWS[activeRole].badge}
                  </span>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">{ROLE_PREVIEWS[activeRole].title}</h3>
                </div>
              </div>
              <span className="text-xs font-mono text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-950 px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-800">
                Active Seat: {activeRole}
              </span>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed font-normal">
              {ROLE_PREVIEWS[activeRole].subtitle}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              {ROLE_PREVIEWS[activeRole].points.map((pt, pIdx) => (
                <div key={pIdx} className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                  <CheckCircle2 className="h-4 w-4 text-indigo-500 dark:text-indigo-400 shrink-0 mt-0.5" />
                  <span>{pt}</span>
                </div>
              ))}
            </div>

            <div className="pt-4 flex justify-end">
              <Link
                href="/login"
                className="rounded-xl bg-slate-900 dark:bg-white px-4 py-2 text-xs font-bold text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-slate-200 transition flex items-center gap-1.5"
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
          <h2 className="text-xs font-extrabold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
            Simple & Predictable Pricing
          </h2>
          <h3 className="text-2xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">
            Scale Your Virtual Tech Organization
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 font-normal">
            Includes Stripe subscription checkout with automated webhook provisioning.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {/* Starter */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-7 space-y-6 flex flex-col justify-between shadow-sm">
            <div className="space-y-4">
              <div>
                <h4 className="text-base font-bold text-slate-900 dark:text-white">Starter</h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Ideal for indie developers and small projects.</p>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-black text-slate-900 dark:text-white">$29</span>
                <span className="text-xs text-slate-500">/ month</span>
              </div>
              <ul className="space-y-2.5 text-xs text-slate-700 dark:text-slate-300 pt-2">
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> 5 Workspace Projects</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> 3 Autonomous Agent Seats</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> SuperDesign Dark & Light Tokens</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> 5-Stage Kanban Board</li>
              </ul>
            </div>
            <Link
              href="/login"
              className="w-full text-center rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 py-2.5 text-xs font-bold text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition block"
            >
              Get Started with Starter
            </Link>
          </div>

          {/* Growth (Featured) */}
          <div className="relative rounded-2xl border-2 border-indigo-500 bg-white dark:bg-slate-900 p-7 space-y-6 flex flex-col justify-between shadow-2xl shadow-indigo-600/20">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-3 py-0.5 text-[10px] font-extrabold uppercase tracking-widest text-white">
              Most Popular
            </div>
            <div className="space-y-4">
              <div>
                <h4 className="text-base font-bold text-slate-900 dark:text-white">Growth</h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Full swarm velocity for fast-scaling engineering teams.</p>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-black text-slate-900 dark:text-white">$79</span>
                <span className="text-xs text-slate-500">/ month</span>
              </div>
              <ul className="space-y-2.5 text-xs text-slate-700 dark:text-slate-300 pt-2">
                <li className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> Unlimited Projects</li>
                <li className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> All 9 Specialist Agent Seats</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> Generative UI Studio & Token Sync</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> pgvector Codebase & ADR RAG</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> Staging Deploys & 1-Click Rollback</li>
              </ul>
            </div>
            <Link
              href="/login"
              className="w-full text-center rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-600/40 hover:bg-indigo-500 transition block"
            >
              Start Growth Plan
            </Link>
          </div>

          {/* Enterprise */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-7 space-y-6 flex flex-col justify-between shadow-sm">
            <div className="space-y-4">
              <div>
                <h4 className="text-base font-bold text-slate-900 dark:text-white">Enterprise</h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Dedicated security, Clerk SSO, and custom agent roles.</p>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-black text-slate-900 dark:text-white">$199</span>
                <span className="text-xs text-slate-500">/ month</span>
              </div>
              <ul className="space-y-2.5 text-xs text-slate-700 dark:text-slate-300 pt-2">
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> Everything in Growth</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> Clerk SSO & Multi-Tenant IAM</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> Dedicated Langfuse Trace Retention</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> 99.99% SLA & Priority Concierge</li>
              </ul>
            </div>
            <Link
              href="/login"
              className="w-full text-center rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 py-2.5 text-xs font-bold text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition block"
            >
              Contact Enterprise Sales
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800/80 bg-white dark:bg-slate-950 py-12 text-xs text-slate-600 dark:text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-tr from-indigo-600 to-cyan-500 text-[10px] font-extrabold text-white">
              TF
            </div>
            <span className="font-bold text-slate-900 dark:text-slate-300">TeamFlow Inc.</span>
            <span>— Autonomous Design & Engineering SaaS Platform</span>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2 font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
              <span>All Systems Operational</span>
            </div>
            <Link href="/login" className="hover:text-slate-900 dark:hover:text-slate-300 transition">Login</Link>
            <button onClick={loginWithClerk} className="hover:text-slate-900 dark:hover:text-slate-300 transition cursor-pointer">Clerk Auth</button>
            <a href={API_DOCS_URL} target="_blank" rel="noreferrer" className="hover:text-slate-900 dark:hover:text-slate-300 transition">Swagger API</a>
            {SOURCE_REPOSITORY_URL ? <a href={SOURCE_REPOSITORY_URL} target="_blank" rel="noreferrer" className="hover:text-slate-900 dark:hover:text-slate-300 transition">Source</a> : null}
            <span>SuperDesign v2.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
