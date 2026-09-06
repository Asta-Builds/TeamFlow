"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { ApiError, register } from "@/lib/api";
import { toast } from "sonner";
import { Lock, Sparkles, ShieldCheck } from "lucide-react";

const CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [user, loading, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "register") {
        await register({
          email,
          name,
          password,
          organization_name: organizationName || undefined,
        });
        toast.success("Account created successfully!");
      }
      await login(email, password);
      toast.success(`Welcome back, ${email}!`);
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError) {
        const data = err.data as Record<string, unknown> | null;
        const detail =
          (data && (data.detail as string)) ||
          (data && Object.values(data).flat().join(" ")) ||
          "Invalid credentials. Please try again.";
        toast.error(String(detail));
      } else {
        toast.error("Network error — please verify server status.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function loginWithClerk() {
    router.push(mode === "register" ? "/sign-up" : "/sign-in");
  }

  return (
    <div className="min-h-screen w-full lg:grid lg:grid-cols-2 bg-slate-950 text-slate-100">
      {/* Left hero pane */}
      <div className="relative hidden h-full flex-col justify-between bg-slate-950 p-10 lg:flex border-r border-slate-800">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/40 via-slate-950 to-slate-950 pointer-events-none" />

        {/* Brand Header */}
        <div className="relative z-20 flex items-center gap-2.5 text-lg font-bold tracking-tight">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-xs font-black text-white shadow-md shadow-indigo-600/30">
            TF
          </div>
          <span className="text-white">TeamFlow Inc.</span>
        </div>

        {/* Testimonial Quote */}
        <div className="relative z-20 max-w-md space-y-4">
          <blockquote className="space-y-2">
            <p className="text-sm text-slate-300 font-normal leading-relaxed">
              &ldquo;TeamFlow has completely transformed how our virtual tech teams ship production software, coordinate autonomous engineering roles, and manage sprint deliverables seamlessly.&rdquo;
            </p>
            <footer className="text-xs text-slate-400 font-medium pt-2">
              <span className="font-bold text-white block text-sm">Sarah Jenkins</span>
              VP of Engineering at CloudScale
            </footer>
          </blockquote>

          <div className="flex items-center gap-4 pt-4 text-xs text-slate-400">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>All systems operational</span>
            </div>
            <span>•</span>
            <div className="flex items-center gap-1.5 text-indigo-400">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Clerk Authentication Active</span>
            </div>
          </div>
        </div>

        {/* Footer Meta */}
        <div className="relative z-20 flex justify-between text-xs text-slate-500 font-mono">
          <span>Enterprise Virtual Tech Management</span>
          <span>v2.0 Standalone</span>
        </div>
      </div>

      {/* Right form pane */}
      <div className="flex min-h-screen flex-col items-center justify-center p-6 lg:p-12 bg-slate-900">
        <div className="w-full max-w-[360px] space-y-6">
          {/* Header */}
          <div className="flex flex-col space-y-1.5 text-center">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-sm font-black text-white shadow-md shadow-indigo-600/30 lg:hidden">
              TF
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white">
              {mode === "login" ? "Welcome back" : "Create an account"}
            </h1>
            <p className="text-xs text-slate-400">
              {mode === "login"
                ? "Enter your email or use Clerk to continue"
                : "Enter your workspace details to get started"}
            </p>
          </div>

          {/* Clerk SSO Button */}
          <div className="space-y-3">
            <button
              type="button"
              onClick={loginWithClerk}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-indigo-500/40 bg-gradient-to-r from-indigo-950/80 to-purple-950/80 px-4 text-xs font-bold text-white shadow-xs hover:border-indigo-400 hover:from-indigo-900 hover:to-purple-900 transition cursor-pointer"
            >
              <ShieldCheck className="h-4 w-4 text-indigo-400" />
              <span>{mode === "register" ? "Sign up with Clerk" : "Continue with Clerk"}</span>
            </button>

            <div className="relative flex items-center justify-center">
              <div className="w-full border-t border-slate-800"></div>
              <span className="bg-slate-900 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Or continue with email
              </span>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={onSubmit} className="space-y-3.5">
            {mode === "register" && (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-300">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Sarah Jenkins"
                    className="flex h-9 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-1 text-xs text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-300">
                    Company / Organization
                  </label>
                  <input
                    type="text"
                    required
                    value={organizationName}
                    onChange={(e) => setOrganizationName(e.target.value)}
                    placeholder="Acme Corp"
                    className="flex h-9 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-1 text-xs text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </>
            )}

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@teamflow.dev"
                className="flex h-9 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-1 text-xs text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="flex h-9 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-1 text-xs text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-9 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-50 transition cursor-pointer"
            >
              {submitting
                ? "Processing..."
                : mode === "login"
                ? "Sign in to Workspace"
                : "Create Account"}
            </button>
          </form>

          {/* Toggle Login / Register */}
          <div className="text-center text-xs text-slate-400">
            {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
              className="font-bold text-indigo-400 hover:underline cursor-pointer"
            >
              {mode === "login" ? "Sign up" : "Sign in"}
            </button>
          </div>

          {/* Terms Footer */}
          <p className="px-4 text-center text-[11px] text-slate-500 leading-relaxed">
            By clicking continue, you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}
