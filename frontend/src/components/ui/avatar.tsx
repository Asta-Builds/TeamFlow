import * as React from "react";
import { cn } from "@/lib/utils";
import type { UserStatus } from "@/lib/types";

const AVATAR_GRADIENTS = [
  "from-indigo-600 to-indigo-800",
  "from-emerald-600 to-teal-700",
  "from-rose-600 to-pink-700",
  "from-amber-600 to-orange-700",
  "from-sky-600 to-blue-800",
  "from-violet-600 to-purple-800",
  "from-teal-600 to-emerald-800",
];

const STATUS_DOTS: Record<UserStatus, string> = {
  active: "bg-emerald-500",
  offline: "bg-slate-500",
  pending: "bg-amber-400",
  disabled: "bg-rose-500",
};

export function getInitials(name: string, email = ""): string {
  const source = name?.trim() || email;
  if (!source) return "?";
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export interface AvatarProps {
  name: string;
  email?: string;
  size?: number;
  showStatus?: boolean;
  status?: UserStatus;
  className?: string;
}

export function Avatar({
  name,
  email,
  size = 32,
  showStatus = false,
  status = "active",
  className,
}: AvatarProps) {
  const seed = (name || email || "?").charCodeAt(0) || 0;
  const gradient = AVATAR_GRADIENTS[seed % AVATAR_GRADIENTS.length];

  return (
    <div className={cn("relative inline-block shrink-0", className)}>
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-full text-white font-bold bg-gradient-to-br shadow-xs ring-1 ring-slate-800 select-none",
          gradient
        )}
        style={{ width: size, height: size, fontSize: Math.max(9, size * 0.38) }}
        title={name || email}
        aria-label={name || email || "User avatar"}
      >
        {getInitials(name, email)}
      </span>
      {showStatus && (
        <span
          className={cn(
            "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-slate-950",
            STATUS_DOTS[status] || "bg-emerald-500"
          )}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
