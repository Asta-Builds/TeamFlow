"use client";

import { Button, Card } from "@heroui/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";

export default function UserProfilePage() {
  const { loading, refreshUser, user } = useAuth();
  const router = useRouter();

  const handleRefreshSession = async () => {
    const sessionValid = await refreshUser();

    if (!sessionValid) {
      toast.error("Failed to refresh session. Please log in again.");
      router.push("/login");
      return;
    }

    toast.success("Session refreshed successfully!");
  };

  if (loading) return <div>Loading...</div>;

  if (!user) {
    return <div>Please log in to view your profile.</div>;
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <Card className="w-full max-w-md rounded-lg bg-slate-800 p-6 text-white shadow-lg">
        <div className="flex flex-col items-center">
          <h1 className="mb-4 text-2xl font-bold">User Profile</h1>
          <div className="mb-4">
            <p className="text-lg font-semibold">Name:</p>
            <p className="text-lg">{user.name}</p>
          </div>
          <div>
            <p className="text-lg font-semibold">Email:</p>
            <p className="text-lg">{user.email}</p>
          </div>
          <Button
            className="mt-6 bg-slate-600 font-semibold text-white hover:bg-slate-500"
            onPress={handleRefreshSession}
          >
            Refresh Session
          </Button>
        </div>
      </Card>
    </div>
  );
}
