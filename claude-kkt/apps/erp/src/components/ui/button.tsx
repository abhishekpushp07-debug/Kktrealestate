import { cva, type VariantProps } from "class-variance-authority";
import { Loader2, type LucideIcon } from "lucide-react";
import { Slot } from "radix-ui";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-colors focus-ring disabled:pointer-events-none disabled:opacity-55 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "border-navy-950 bg-navy-950 text-white hover:bg-navy-800 hover:border-navy-800 hover:text-white active:bg-navy-900",
        gold: "border-gold bg-gold text-navy-950 hover:bg-gold-hover hover:border-gold-hover hover:text-navy-950 active:bg-gold-hover",
        outline: "border-border-strong bg-card text-navy-950 hover:bg-navy-50 hover:text-navy-950 active:bg-navy-100",
        ghost: "border-transparent bg-transparent text-ink-muted hover:bg-navy-50 hover:text-navy-950 active:bg-navy-100",
        danger: "border-danger bg-danger text-white hover:bg-danger-hover hover:border-danger-hover hover:text-white",
        "danger-outline": "border-danger/40 bg-card text-danger-fg hover:bg-danger-bg hover:text-danger-fg",
        link: "border-transparent bg-transparent text-navy-700 underline-offset-4 hover:underline hover:text-navy-950 h-auto px-0",
      },
      size: {
        xs: "h-9 px-2 text-xs sm:h-7 [&_svg]:size-3.5",
        sm: "h-12 px-2.5 text-xs sm:h-8 [&_svg]:size-4",
        md: "h-12 px-3.5 text-sm sm:h-9 [&_svg]:size-4",
        lg: "h-12 px-5 text-base [&_svg]:size-5",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Shows a spinner, disables the button and keeps its width. */
  loading?: boolean;
  leftIcon?: LucideIcon;
  rightIcon?: LucideIcon;
  /** Render the child element instead of a <button> (e.g. a <Link>). */
  asChild?: boolean;
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
  "data-testid"?: string;
}

export function Button({
  className,
  variant,
  size,
  loading = false,
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
  asChild = false,
  disabled,
  children,
  type,
  ref,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      ref={ref}
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), loading && "relative text-transparent", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && (
            <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
              <Loader2 className={cn("animate-spin", variant === "primary" || variant === "danger" ? "text-white" : "text-navy-950")} />
            </span>
          )}
          {LeftIcon && <LeftIcon aria-hidden="true" />}
          {children}
          {RightIcon && <RightIcon aria-hidden="true" />}
        </>
      )}
    </Component>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, "leftIcon" | "rightIcon" | "children"> {
  icon: LucideIcon;
  /** Accessible name (required: there is no visible text). */
  label: string;
}

const ICON_SIZES = { xs: "size-9 sm:size-7", sm: "size-12 sm:size-8", md: "size-12 sm:size-9", lg: "size-12" } as const;

export function IconButton({ icon: Icon, label, className, size = "md", variant = "ghost", loading, ref, ...props }: IconButtonProps) {
  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      loading={loading}
      aria-label={label}
      title={label}
      className={cn("px-0", ICON_SIZES[size ?? "md"], className)}
      {...props}
    >
      <Icon aria-hidden="true" />
    </Button>
  );
}
