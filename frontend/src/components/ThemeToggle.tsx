"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon, Laptop } from "lucide-react";
import { toast } from "sonner";

interface ThemeToggleProps {
  showLabel?: boolean;
  className?: string;
  variant?: "icon" | "segmented";
}

export function ThemeToggle({ showLabel = false, className = "", variant = "icon" }: ThemeToggleProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div
        className={`h-9 w-9 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900/50 animate-pulse ${className}`}
        aria-hidden="true"
      />
    );
  }

  const isDark = resolvedTheme === "dark";

  const handleToggle = () => {
    const nextTheme = isDark ? "light" : "dark";
    setTheme(nextTheme);
    toast.success(nextTheme === "light" ? "Mode clair activé" : "Mode sombre activé", {
      description: nextTheme === "light" ? "Palette claire SuperDesign" : "Palette sombre SuperDesign",
      duration: 2000,
    });
  };

  if (variant === "segmented") {
    return (
      <div
        role="radiogroup"
        aria-label="Sélection du thème d'affichage"
        className={`inline-flex items-center gap-1 p-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 ${className}`}
      >
        <button
          type="button"
          role="radio"
          aria-checked={theme === "light"}
          onClick={() => {
            setTheme("light");
            toast.success("Mode clair activé");
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            theme === "light"
              ? "bg-white text-indigo-600 shadow-sm border border-slate-200"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          <Sun className="h-3.5 w-3.5 text-amber-500" />
          <span>Clair</span>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={theme === "dark"}
          onClick={() => {
            setTheme("dark");
            toast.success("Mode sombre activé");
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            theme === "dark"
              ? "bg-slate-800 text-indigo-400 shadow-sm border border-slate-700"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          <Moon className="h-3.5 w-3.5 text-indigo-400" />
          <span>Sombre</span>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={theme === "system"}
          onClick={() => {
            setTheme("system");
            toast.success("Thème système synchronisé");
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            theme === "system"
              ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm border border-slate-200 dark:border-slate-700"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          <Laptop className="h-3.5 w-3.5" />
          <span>Système</span>
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={isDark ? "Passer en mode clair" : "Passer en mode sombre"}
      title={isDark ? "Mode clair (SuperDesign)" : "Mode sombre (SuperDesign)"}
      className={`relative inline-flex items-center justify-center h-9 w-9 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900 shadow-2xs backdrop-blur-xs transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${className}`}
    >
      {isDark ? (
        <Sun className="h-4 w-4 text-amber-400 transition-transform duration-200 hover:rotate-45" />
      ) : (
        <Moon className="h-4 w-4 text-indigo-600 transition-transform duration-200 hover:-rotate-12" />
      )}
      {showLabel && (
        <span className="ml-2 text-xs font-bold">
          {isDark ? "Mode clair" : "Mode sombre"}
        </span>
      )}
    </button>
  );
}

export default ThemeToggle;
