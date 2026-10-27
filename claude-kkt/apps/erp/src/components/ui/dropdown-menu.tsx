import { Check, ChevronRight } from "lucide-react";
import { DropdownMenu as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
export const DropdownMenuGroup = Primitive.Group;
export const DropdownMenuSub = Primitive.Sub;
export const DropdownMenuRadioGroup = Primitive.RadioGroup;

const contentClass =
  "z-50 min-w-44 overflow-hidden rounded-md border border-border bg-card p-1 text-ink shadow-pop animate-slide-down";

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(contentClass, className)}
        {...props}
      />
    </Primitive.Portal>
  );
}

export function DropdownMenuSubContent({ className, ...props }: ComponentProps<typeof Primitive.SubContent>) {
  return (
    <Primitive.Portal>
      <Primitive.SubContent className={cn(contentClass, className)} {...props} />
    </Primitive.Portal>
  );
}

const itemClass =
  "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-navy-50 data-[highlighted]:text-navy-950 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-subtle data-[highlighted]:[&_svg]:text-navy-950";

export interface DropdownMenuItemProps extends ComponentProps<typeof Primitive.Item> {
  destructive?: boolean;
  inset?: boolean;
}

export function DropdownMenuItem({ className, destructive, inset, ...props }: DropdownMenuItemProps) {
  return (
    <Primitive.Item
      className={cn(
        itemClass,
        inset && "pl-8",
        destructive &&
          "text-danger-fg data-[highlighted]:bg-danger-bg data-[highlighted]:text-danger-fg [&_svg]:text-danger-fg",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: ComponentProps<typeof Primitive.CheckboxItem>) {
  return (
    <Primitive.CheckboxItem className={cn(itemClass, "pl-8", className)} checked={checked} {...props}>
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <Primitive.ItemIndicator>
          <Check className="size-4 text-navy-950" aria-hidden="true" />
        </Primitive.ItemIndicator>
      </span>
      {children}
    </Primitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({ className, children, ...props }: ComponentProps<typeof Primitive.RadioItem>) {
  return (
    <Primitive.RadioItem className={cn(itemClass, "pl-8", className)} {...props}>
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <Primitive.ItemIndicator>
          <span className="size-2 rounded-full bg-navy-950" />
        </Primitive.ItemIndicator>
      </span>
      {children}
    </Primitive.RadioItem>
  );
}

export function DropdownMenuSubTrigger({ className, children, ...props }: ComponentProps<typeof Primitive.SubTrigger>) {
  return (
    <Primitive.SubTrigger className={cn(itemClass, "data-[state=open]:bg-navy-50", className)} {...props}>
      {children}
      <ChevronRight className="ml-auto" aria-hidden="true" />
    </Primitive.SubTrigger>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Primitive.Label>) {
  return <Primitive.Label className={cn("px-2 py-1.5 label-caps", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

export function DropdownMenuShortcut({ className, ...props }: ComponentProps<"span">) {
  return (
    <span className={cn("ml-auto pl-4 font-mono text-[10px] tracking-wider text-ink-subtle", className)} {...props} />
  );
}
