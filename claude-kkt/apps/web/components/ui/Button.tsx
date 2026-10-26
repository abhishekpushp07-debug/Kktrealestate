import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "outline" | "outline-light" | "ghost" | "ghost-light" | "link";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-gold-500 text-navy-950 hover:bg-gold-400 active:bg-gold-600 shadow-[0_8px_24px_-10px_rgb(201_162_39/0.7)]",
  secondary: "bg-navy-900 text-ivory-100 hover:bg-navy-700 active:bg-navy-950",
  outline: "border border-navy-900/25 text-navy-900 hover:bg-navy-900 hover:text-ivory-100",
  "outline-light": "border border-ivory-100/50 text-ivory-100 hover:bg-ivory-100 hover:text-navy-900",
  ghost: "text-navy-900 hover:bg-navy-900/5",
  "ghost-light": "text-ivory-100 hover:bg-ivory-100/10",
  link: "text-navy-900 underline decoration-gold-500 decoration-2 underline-offset-4 hover:text-gold-700 px-0",
};

const SIZES: Record<Size, string> = {
  sm: "min-h-12 px-4 text-sm",
  md: "min-h-12 px-6 text-[0.9375rem]",
  lg: "min-h-14 px-8 text-base",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold tracking-wide transition-[background-color,color,transform,box-shadow] duration-300 ease-luxe disabled:opacity-60 disabled:cursor-not-allowed select-none";

export function buttonClasses(variant: Variant = "primary", size: Size = "md", className = ""): string {
  return `${BASE} ${VARIANTS[variant]} ${variant === "link" ? "min-h-12" : SIZES[size]} ${className}`.trim();
}

interface CommonProps {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}

type ButtonAsButton = CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type ButtonAsLink = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string; external?: boolean; prefetch?: boolean };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

export function Button(props: ButtonProps) {
  if (props.href !== undefined) {
    const { variant = "primary", size = "md", className = "", children, href, external, prefetch, ...rest } = props;
    const classes = buttonClasses(variant, size, className);
    if (external || /^(https?:|tel:|mailto:)/.test(href)) {
      return (
        <a href={href} className={classes} {...rest}>
          {children}
        </a>
      );
    }
    return (
      <Link href={href} className={classes} prefetch={prefetch} {...rest}>
        {children}
      </Link>
    );
  }
  const { variant = "primary", size = "md", className = "", children, type = "button", ...rest } = props;
  return (
    <button type={type} className={buttonClasses(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}
