"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, setTokens } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { User } from "@/lib/types";

interface KeycloakAuthResponse {
  access: string;
  refresh: string;
  user: User;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to exchange Keycloak session.";
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const { refreshUser } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function processAuth() {
      // 1. Check for error parameters in query string
      const searchParams = new URLSearchParams(window.location.search);
      const urlError = searchParams.get("error_description") || searchParams.get("error");
      if (urlError) {
        setError(`Keycloak Error: ${urlError}`);
        return;
      }

      // 2. Extract code from query params OR token from hash/query
      const code = searchParams.get("code");
      const hash = window.location.hash.substring(1);
      const hashParams = new URLSearchParams(hash);
      const token =
        hashParams.get("access_token") ||
        hashParams.get("id_token") ||
        searchParams.get("token") ||
        searchParams.get("access_token");

      if (!code && !token) {
        setError(
          "No authorization code or authentication token found in callback response. Please try signing in again."
        );
        return;
      }

      try {
        const redirectUri = `${window.location.origin}/auth/callback`;
        const res = await apiFetch<KeycloakAuthResponse>(
          "/auth/keycloak/",
          {
            method: "POST",
            body: {
              code: code || undefined,
              redirect_uri: redirectUri,
              token: token || undefined,
            },
            auth: false,
          }
        );

        setTokens(res.access, res.refresh);
        await refreshUser();
        router.replace("/dashboard");
      } catch (err) {
        console.error("Keycloak auth exchange error:", err);
        setError(getErrorMessage(err));
      }
    }

    processAuth();
  }, [router, refreshUser]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4 text-center">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xs border border-slate-200">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-lg font-bold text-white shadow-md shadow-indigo-600/30">
          TF
        </div>
        <h2 className="text-base font-bold text-slate-900">
          {error ? "SSO Authentication Notice" : "Authenticating with Keycloak..."}
        </h2>
        <p className="mt-2 text-xs text-slate-500 leading-relaxed">
          {error
            ? error
            : "Validating your identity and setting up your TeamFlow workspace session."}
        </p>

        {error && (
          <button
            onClick={() => router.replace("/login")}
            className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 transition shadow-sm"
          >
            Back to Login
          </button>
        )}
      </div>
    </div>
  );
}
