import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", error, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        aria-invalid={error ? true : undefined}
        className={cn(
          "flex h-9 w-full rounded-xl border bg-slate-950 px-3.5 py-2 text-xs text-slate-100 placeholder:text-slate-500 transition-colors",
          "border-slate-800 hover:border-slate-700",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:border-indigo-500",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-rose-500/80 focus-visible:ring-rose-500 focus-visible:border-rose-500",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";
