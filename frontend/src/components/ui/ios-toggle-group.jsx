import React from "react";
import { cn } from "@/lib/utils";

function IosToggleGroup({
  value,
  options = [],
  onValueChange,
  disabled = false,
  ariaLabel,
  className,
  itemClassName,
  iconClassName,
}) {
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const count = Math.max(options.length, 1);

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "relative grid items-center rounded-full bg-white/70 p-[5px] shadow-[inset_0_0_0_1px_rgba(15,23,42,0.05),0_2px_8px_rgba(15,23,42,0.08)] backdrop-blur-md dark:bg-slate-950/50",
        disabled && "opacity-70",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-[5px] top-[5px] h-[calc(100%-10px)] rounded-full bg-purple-600 shadow-[0_1px_2px_rgba(88,28,135,0.22),0_8px_20px_rgba(147,51,234,0.24)] transition-transform will-change-transform motion-reduce:transition-none"
        style={{
          width: `calc((100% - 10px) / ${count})`,
          transform: `translateX(${activeIndex * 100}%)`,
          transitionDuration: "420ms",
          transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      />

      {options.map((option) => {
        const Icon = option.icon;
        const isActive = option.value === value;
        const isDisabled = disabled || option.disabled;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={isDisabled}
            onClick={() => {
              if (isDisabled || isActive) return;
              onValueChange?.(option.value);
            }}
            className={cn(
              "relative z-10 flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold leading-none text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed motion-reduce:transition-none",
              isActive && "text-white hover:text-white",
              itemClassName,
            )}
            style={{ transitionDuration: "260ms" }}
          >
            {Icon && <Icon className={cn("h-4 w-4 shrink-0", iconClassName)} />}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default IosToggleGroup;
