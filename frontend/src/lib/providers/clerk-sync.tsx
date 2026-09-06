"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { useAuth as useClerkAuth, useUser as useClerkUser, useClerk } from "@clerk/nextjs";
import { useAuth as useTeamflowAuth } from "@/lib/auth";
import { loginWithClerkSession, getToken } from "@/lib/api";
import { toast } from "sonner";
import { useRouter, usePathname } from "next/navigation";

interface ClerkSyncState {
  isSyncing: boolean;
}

const ClerkSyncContext = createContext<ClerkSyncState>({ isSyncing: false });

export function useClerkSync() {
  return useContext(ClerkSyncContext);
}

const CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

function ClerkAuthSyncBridge({ children }: { children: React.ReactNode }) {
  const { isLoaded: isClerkLoaded, isSignedIn, getToken: getClerkToken, userId } = useClerkAuth();
  const { user: clerkUser } = useClerkUser();
  const { signOut } = useClerk();
  const { user: tfUser, refreshUser, loading: tfLoading } = useTeamflowAuth();
  const [isSyncing, setIsSyncing] = useState(false);
  const syncingRef = useRef(false);
  const hasSyncedRef = useRef(false);
  const router = useRouter();
  const pathname = usePathname();

  // Listen for TeamFlow logout events to also sign out of Clerk
  useEffect(() => {
    function handleLogout() {
      hasSyncedRef.current = false;
      if (isSignedIn) {
        void signOut();
      }
    }
    window.addEventListener("teamflow:logout", handleLogout);
    return () => window.removeEventListener("teamflow:logout", handleLogout);
  }, [isSignedIn, signOut]);

  useEffect(() => {
    if (!isClerkLoaded) return;

    if (isSignedIn && userId && !syncingRef.current) {
      const currentToken = getToken();

      // Check if we already have an active TeamFlow session for this identity
      if (!currentToken || (!tfUser && !tfLoading && !hasSyncedRef.current)) {
        syncingRef.current = true;
        setIsSyncing(true);

        (async () => {
          try {
            const token = await getClerkToken();
            const email = clerkUser?.primaryEmailAddress?.emailAddress;
            const name =
              clerkUser?.fullName ||
              [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") ||
              clerkUser?.username ||
              undefined;
            const avatarUrl = clerkUser?.imageUrl;

            if (email || token) {
              await loginWithClerkSession({
                token: token || undefined,
                clerk_id: userId,
                email,
                name,
                avatar_url: avatarUrl,
              });
              hasSyncedRef.current = true;
              await refreshUser();
              toast.success("Successfully authenticated with Clerk SSO");

              if (
                pathname === "/login" ||
                pathname === "/sign-in" ||
                pathname.startsWith("/sign-in/") ||
                pathname === "/sign-up" ||
                pathname.startsWith("/sign-up/") ||
                pathname === "/"
              ) {
                router.replace("/dashboard");
              }
            }
          } catch (err: any) {
            console.error("Clerk session exchange failed:", err);
            toast.error(
              err?.data?.message || err?.message || "Failed to synchronize Clerk session with workspace."
            );
          } finally {
            syncingRef.current = false;
            setIsSyncing(false);
          }
        })();
      }
    }
  }, [
    isClerkLoaded,
    isSignedIn,
    userId,
    clerkUser,
    tfUser,
    tfLoading,
    getClerkToken,
    refreshUser,
    router,
    pathname,
  ]);

  return (
    <ClerkSyncContext.Provider value={{ isSyncing }}>
      {children}
    </ClerkSyncContext.Provider>
  );
}

export function ClerkSyncProvider({ children }: { children: React.ReactNode }) {
  if (!CLERK_PUBLISHABLE_KEY) {
    return (
      <ClerkSyncContext.Provider value={{ isSyncing: false }}>
        {children}
      </ClerkSyncContext.Provider>
    );
  }

  return <ClerkAuthSyncBridge>{children}</ClerkAuthSyncBridge>;
}
