import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium " +
    "transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline: "border border-input shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/* App kit looks (the .btn family in index.css is this Button's implementation for these variants). */
const KIT = {
  primary: "btn btn-primary",
  gold: "btn btn-gold",
  soft: "btn btn-secondary",
  quiet: "btn btn-ghost",
  danger: "btn btn-danger",
  plain: "btn",
};

const Button = React.forwardRef(
  ({ className, variant, size, asChild = false, why, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const cls = KIT[variant]
      ? cn(KIT[variant], size === "compact" && "btn-sm", className)
      : cn(buttonVariants({ variant, size, className }));
    const btn = <Comp className={cls} ref={ref} {...props} />;
    // REQ-216: a disabled button says why (tooltip on desktop, a line under it on phones)
    if (!props.disabled || !why) return btn;
    return (
      <span className="inline-block" title={why}>
        <span className="pointer-events-none block">{btn}</span>
        <span className="mt-1 block text-xs text-txt-muted md:sr-only">{why}</span>
      </span>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
