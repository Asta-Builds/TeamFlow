import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";

export default function SignUpPage() {
  const isClerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  if (!isClerkConfigured) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 p-6 text-slate-100">
        <div className="max-w-md w-full rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center space-y-4 shadow-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-950 border border-indigo-500/30 text-indigo-400">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold text-white">Clerk Configuration Required</h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            To enable Clerk sign-up, please define{" "}
            <code className="bg-slate-950 px-1.5 py-0.5 rounded text-indigo-300 font-mono text-[11px]">
              NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
            </code>{" "}
            in your environment file or Docker Compose settings.
          </p>
          <div className="pt-2">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 transition cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Standard Registration</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <SignUp
        appearance={{
          elements: {
            rootBox: "mx-auto",
            card: "bg-slate-900 border border-slate-800 shadow-xl text-white",
          },
        }}
      />
    </div>
  );
}
