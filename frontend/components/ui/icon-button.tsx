"use client";

import type { LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Icon-only control: the name lives in the tooltip and the accessible label. */
export function IconButton({
  label,
  icon: Icon,
  onClick,
  active,
  disabled,
  tone,
  size = "md",
  className,
  type = "button",
}: {
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  tone?: "danger" | "accent";
  size?: "sm" | "md" | "lg";
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type={type}
            aria-label={label}
            aria-pressed={active}
            disabled={disabled}
            onClick={onClick}
            className={cn(
              "grid shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-elevated hover:text-ink disabled:pointer-events-none disabled:opacity-30",
              size === "sm" ? "size-9" : size === "md" ? "size-11" : "size-14",
              active && "bg-elevated text-ink ring-1 ring-line",
              tone === "danger" && "text-error hover:bg-error/12 hover:text-error",
              tone === "accent" && "bg-aurora text-bg hover:bg-aurora/85 hover:text-bg",
              className,
            )}
          />
        }
      >
        <Icon className={size === "lg" ? "size-6" : size === "md" ? "size-5" : "size-4"} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
