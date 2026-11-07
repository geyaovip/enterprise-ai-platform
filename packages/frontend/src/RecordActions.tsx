import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** Explicit row actions only. Forms and dialog actions keep their own hierarchy. */
export function RecordActions({
  children,
  more,
  label,
  className,
}: {
  children?: ReactNode;
  more?: ReactNode;
  label?: string;
  className?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const popover = panel.current;
    if (!popover) return;
    const update = () => {
      const hasActions = Boolean(popover.querySelector("button,a[href]"));
      setAvailable(hasActions);
      if (!hasActions && popover.matches(":popover-open"))
        popover.hidePopover();
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(popover, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [more]);

  useLayoutEffect(() => {
    if (!open) return;
    const close = () => panel.current?.hidePopover();
    window.addEventListener("resize", close);
    // A scroll inside the popover must not dismiss its own options.
    const onScroll = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <div
      className={className ? `record-actions ${className}` : "record-actions"}
    >
      {children}
      {more && (
        <>
          <button
            ref={trigger}
            type="button"
            className="record-actions-more"
            hidden={!available}
            popoverTarget={id}
            aria-expanded={open}
            aria-controls={id}
            aria-label={label ? `更多操作：${label}` : "更多操作"}
          >
            更多
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          <div
            ref={panel}
            id={id}
            popover="auto"
            className="record-actions-popover"
            role="group"
            aria-label={label ? `${label}的更多操作` : "更多操作"}
            onToggle={(event) => {
              const expanded = event.newState === "open";
              setOpen(expanded);
              if (!expanded || !trigger.current || !panel.current) return;
              const bounds = trigger.current.getBoundingClientRect();
              const popover = panel.current;
              const width = popover.offsetWidth,
                height = popover.offsetHeight;
              popover.style.left = `${Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8))}px`;
              popover.style.top = `${Math.max(8, bounds.bottom + height + 12 <= window.innerHeight ? bounds.bottom + 4 : bounds.top - height - 4)}px`;
              popover
                .querySelector<HTMLElement>(
                  "button:not(:disabled),a[href]:not([aria-disabled=true])",
                )
                ?.focus({ preventScroll: true });
            }}
            onClick={(event) => {
              const target = (event.target as Element).closest(
                "button,a[href]",
              );
              if (!target || target.matches(":disabled,[aria-disabled=true]"))
                return;
              panel.current?.hidePopover();
              // Dialogs opened by a row action restore focus to this visible invoker.
              trigger.current?.focus({ preventScroll: true });
            }}
          >
            {more}
          </div>
        </>
      )}
    </div>
  );
}
