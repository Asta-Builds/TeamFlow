import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 font-semibold rounded-md border shadow-2xs transition-colors",
  {
    variants: {
      variant: {
        default: "bg-slate-900 text-slate-300 border-slate-800",
        indigo: "bg-indigo-950/60 text-indigo-300 border-indigo-800/50",
        purple: "bg-purple-950/60 text-purple-300 border-purple-800/50",
        success: "bg-emerald-950/60 text-emerald-300 border-emerald-800/50",
        warning: "bg-amber-950/60 text-amber-300 border-amber-800/50",
        danger: "bg-rose-950/60 text-rose-300 border-rose-800/50",
        outline: "border-slate-800 bg-transparent text-slate-400",
      },
      size: {
        sm: "px-1.5 py-0.5 text-[10px]",
        md: "px-2 py-0.5 text-[11px]",
        lg: "px-2.5 py-1 text-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props} />
  );
}
