"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { ApiError, register } from "@/lib/api";

const KEYCLOAK_URL = process.env.NEXT_PUBLIC_KEYCLOAK_URL || "http://localhost:8080";
const KEYCLOAK_REALM = process.env.NEXT_PUBLIC_KEYCLOAK_REALM || "teamflow";
const KEYCLOAK_CLIENT_ID = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID || "teamflow-app";

const DEMO_ACCOUNTS = [
  { label: "👑 CEO", email: "ceo@teamflow.dev", name: "Abdelilah Dahou" },
  { label: "🎯 Tech Lead", email: "lead@teamflow.dev", name: "Sarah Jenkins" },
  { label: "🚀 DevOps", email: "devops@teamflow.dev", name: "Joan Arc" },
  { label: "🧪 QA", email: "qa@teamflow.dev", name: "Alan Turing" },
  { label: "🔍 SEO", email: "seo@teamflow.dev", name: "Ada Lovelace" },
];

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("lead@teamflow.dev");
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [password, setPassword] = useState("teamflow-demo-pw");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [user, loading, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "register") {
        await register({
          email,
          name,
          password,
          organization_name: organizationName || undefined,
        });
      }
      await login(email, password);
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError) {
        const data = err.data as Record<string, unknown> | null;
        const detail =
          (data && (data.detail as string)) ||
          (data && Object.values(data).flat().join(" ")) ||
          "Invalid credentials. Please try again.";
        setError(String(detail));
      } else {
        setError("Network error — please verify server status.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function loginWithKeycloak() {
    const redirectUri = encodeURIComponent(`${window.location.origin}/auth/callback`);
    const authUrl = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth?client_id=${KEYCLOAK_CLIENT_ID}&response_type=code&redirect_uri=${redirectUri}&scope=openid%20profile%20email`;
    window.location.href = authUrl;
  }

  return (
    <div className="min-h-screen w-full lg:grid lg:grid-cols-2">
      {/* Left hero pane (shadcn style) */}
      <div className="relative hidden h-full flex-col justify-between bg-zinc-950 p-10 text-white lg:flex border-r border-zinc-800">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/40 via-zinc-950 to-zinc-950 pointer-events-none" />
        
        {/* Subtle grid pattern background */}
        <div
          className="absolute inset-0 opacity-15"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)`,
            backgroundSize: "24px 24px",
          }}
        />

        {/* Brand Header */}
        <div className="relative z-20 flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white shadow-md shadow-indigo-600/30">
            TF
          </div>
          <span>TeamFlow Inc.</span>
        </div>

        {/* Testimonial Quote */}
        <div className="relative z-20 max-w-md space-y-4">
          <blockquote className="space-y-2">
            <p className="text-base text-zinc-300 font-normal leading-relaxed">
              &ldquo;TeamFlow has completely transformed how our virtual tech teams ship production software, coordinate autonomous engineering roles, and manage sprint deliverables seamlessly.&rdquo;
            </p>
            <footer className="text-xs text-zinc-400 font-medium pt-2">
              <span className="font-semibold text-white block text-sm">Sofia Davis</span>
              VP of Engineering at CloudScale
            </footer>
          </blockquote>

          <div className="flex items-center gap-4 pt-4 text-xs text-zinc-500">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>All systems operational</span>
            </div>
            <span>•</span>
            <div className="flex items-center gap-1">
              <span>🛡️ Keycloak SSO Active</span>
            </div>
          </div>
        </div>

        {/* Footer Meta */}
        <div className="relative z-20 flex justify-between text-xs text-zinc-500">
          <span>Enterprise Virtual Tech Management</span>
          <span>v2.0 Standalone</span>
        </div>
      </div>

      {/* Right form pane (shadcn form style) */}
      <div className="flex min-h-screen flex-col items-center justify-center p-6 lg:p-12 bg-white">
        <div className="w-full max-w-[360px] space-y-6">
          {/* Header */}
          <div className="flex flex-col space-y-1.5 text-center">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white shadow-md shadow-indigo-600/30 lg:hidden">
              TF
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
              {mode === "login" ? "Welcome back" : "Create an account"}
            </h1>
            <p className="text-xs text-zinc-500">
              {mode === "login"
                ? "Enter your email or use Single Sign-On to continue"
                : "Enter your workspace details to get started"}
            </p>
          </div>

          {/* Keycloak SSO Button */}
          <div className="space-y-3">
            <button
              type="button"
              onClick={loginWithKeycloak}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-xs font-semibold text-zinc-800 shadow-xs hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 transition"
            >
              <svg className="h-4 w-4 text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
              </svg>
              <span>Continue with Keycloak (SSO)</span>
            </button>

            <div className="relative flex items-center justify-center">
              <div className="w-full border-t border-zinc-200"></div>
              <span className="bg-white px-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Or continue with
              </span>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={onSubmit} className="space-y-3.5">
            {mode === "register" && (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-700 leading-none">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Sarah Jenkins"
                    className="flex h-9 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1 text-xs shadow-xs transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-600 focus:border-indigo-600"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-700 leading-none">
                    Company / Organization
                  </label>
                  <input
                    type="text"
                    required
                    value={organizationName}
                    onChange={(e) => setOrganizationName(e.target.value)}
                    placeholder="Acme Corp"
                    className="flex h-9 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1 text-xs shadow-xs transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-600 focus:border-indigo-600"
                  />
                </div>
              </>
            )}

            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-700 leading-none">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="flex h-9 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1 text-xs shadow-xs transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-600 focus:border-indigo-600"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-zinc-700 leading-none">
                  Password
                </label>
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="flex h-9 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1 text-xs shadow-xs transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-600 focus:border-indigo-600"
              />
            </div>

            {error && (
              <div className="rounded-md bg-rose-50 border border-rose-200 p-2.5 text-xs font-medium text-rose-700 animate-in fade-in duration-150">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-9 w-full items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-700 disabled:pointer-events-none disabled:opacity-50 transition cursor-pointer"
            >
              {submitting
                ? "Processing..."
                : mode === "login"
                ? "Sign in to Workspace"
                : "Create Account"}
            </button>
          </form>

          {/* Quick Demo Switcher (shadcn pill style) */}
          <div className="pt-2">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5 text-center">
              Quick Switch Demo Roles
            </span>
            <div className="flex flex-wrap items-center justify-center gap-1">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => {
                    setEmail(acc.email);
                    setPassword("teamflow-demo-pw");
                    setMode("login");
                  }}
                  className={`px-2 py-1 rounded-md text-[11px] font-medium border transition cursor-pointer ${
                    email === acc.email
                      ? "bg-indigo-50 text-indigo-700 border-indigo-200 shadow-2xs font-semibold"
                      : "bg-zinc-50 text-zinc-600 border-zinc-200 hover:bg-zinc-100"
                  }`}
                >
                  {acc.label}
                </button>
              ))}
            </div>
          </div>

          {/* Toggle Login / Register */}
          <div className="text-center text-xs text-zinc-500">
            {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError(null);
              }}
              className="font-semibold text-indigo-600 hover:underline cursor-pointer"
            >
              {mode === "login" ? "Sign up" : "Sign in"}
            </button>
          </div>

          {/* Terms Footer */}
          <p className="px-4 text-center text-[11px] text-zinc-400 leading-relaxed">
            By clicking continue, you agree to our{" "}
            <span className="underline hover:text-zinc-600 cursor-pointer">Terms of Service</span>{" "}
            and{" "}
            <span className="underline hover:text-zinc-600 cursor-pointer">Privacy Policy</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
