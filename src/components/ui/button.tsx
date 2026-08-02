import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-medium outline-none transition-[background-color,color,box-shadow,transform] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--panel)] disabled:pointer-events-none disabled:opacity-45 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-[var(--accent)] text-white shadow-sm hover:brightness-105",
        secondary: "bg-[var(--muted)] text-[var(--text)] hover:bg-[var(--muted-strong)]",
        ghost: "text-[var(--muted-text)] hover:bg-[var(--muted)] hover:text-[var(--text)]",
        destructive: "bg-[var(--danger)] text-white hover:brightness-105",
        outline:
          "border border-[var(--border)] bg-[var(--card)] text-[var(--text)] hover:bg-[var(--muted)]",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 rounded-lg px-3 text-xs",
        icon: "size-9 rounded-full",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = React.ComponentPropsWithRef<"button"> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ref, type = "button", ...props }: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
