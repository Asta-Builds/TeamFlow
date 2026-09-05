import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:ring-indigo-500",
  {
    variants: {
      variant: {
        default:
          "bg-indigo-600 text-white shadow-md shadow-indigo-600/30 hover:bg-indigo-500 active:translate-y-0.5",
        secondary:
          "bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700/80 hover:text-white",
        outline:
          "border border-slate-800 bg-transparent text-slate-300 hover:bg-slate-900 hover:border-slate-700 hover:text-white",
        ghost:
          "text-slate-400 hover:bg-slate-900 hover:text-slate-200",
        danger:
          "bg-rose-600/20 border border-rose-700/60 text-rose-300 hover:bg-rose-600/30 hover:text-rose-100",
        success:
          "bg-emerald-600/20 border border-emerald-700/60 text-emerald-300 hover:bg-emerald-600/30 hover:text-emerald-100",
        purple:
          "bg-purple-600/20 border border-purple-700/60 text-purple-300 hover:bg-purple-600/30 hover:text-purple-100",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4 py-2 text-xs",
        lg: "h-11 px-5 text-sm",
        icon: "h-8 w-8 p-0 shrink-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, isLoading, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading && (
          <Loader2
            className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
