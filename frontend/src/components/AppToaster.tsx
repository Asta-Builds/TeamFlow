"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Toaster as SonnerToaster } from "sonner";
import { useEffect, useState } from "react";

export function AppToaster() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const activeTheme = (mounted ? resolvedTheme : "dark") as "light" | "dark";

  return (
    <SonnerToaster
      position="top-right"
      richColors
      theme={activeTheme}
      closeButton
      toastOptions={{
        className: "font-sans text-xs font-semibold rounded-xl",
        style:
          activeTheme === "light"
            ? {
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                color: "#0f172a",
                boxShadow: "0 10px 25px -5px rgba(15, 23, 42, 0.08)",
              }
            : {
                background: "#0f172a",
                border: "1px solid #1e293b",
                color: "#f8fafc",
                boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
              },
      }}
    />
  );
}
