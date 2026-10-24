import { Tooltip as Primitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const TooltipProvider = Primitive.Provider;

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: ComponentProps<typeof Primitive.Content>["side"];
  align?: ComponentProps<typeof Primitive.Content>["align"];
  /** Disable to render children only (e.g. when the sidebar is expanded). */
  disabled?: boolean;
  className?: string;
  delayDuration?: number;
}

/** Solid navy tooltip. Children must accept a ref (wrap text in a span). */
export function Tooltip({ content, children, side = "top", align = "center", disabled = false, className, delayDuration = 300 }: TooltipProps) {
  if (disabled || content === null || content === undefined || content === "") return <>{children}</>;
  return (
    <Primitive.Root delayDuration={delayDuration}>
      <Primitive.Trigger asChild>{children}</Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            "z-50 max-w-xs rounded-md bg-navy-950 px-2.5 py-1.5 text-xs font-medium text-white shadow-pop animate-fade-in",
            className,
          )}
        >
          {content}
          <Primitive.Arrow className="fill-navy-950" width={10} height={5} />
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
