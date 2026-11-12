import { CaretDownIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

export function StudioDropdown({
  label,
  icon,
  summary,
  disabled,
  wide = false,
  children,
}: {
  label: string;
  icon: ReactNode;
  summary?: string;
  disabled?: boolean;
  wide?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const positionPanel = useCallback(() => {
    const anchor = trigger.current;
    const popover = panel.current;
    if (!anchor || !popover) return;
    const edge = 12;
    const gap = 6;
    const bounds = anchor.getBoundingClientRect();
    const below = window.innerHeight - bounds.bottom - edge - gap;
    const above = bounds.top - edge - gap;
    const preferBelow = popover.scrollHeight + 2 <= below || below >= above;
    popover.style.maxHeight = `${Math.max(0, preferBelow ? below : above)}px`;
    const left = Math.min(bounds.left, window.innerWidth - popover.offsetWidth - edge);
    popover.style.left = `${Math.max(edge, left)}px`;
    popover.style.top = `${preferBelow ? bounds.bottom + gap : bounds.top - popover.offsetHeight - gap}px`;
  }, []);

  useEffect(() => {
    if (disabled) panel.current?.hidePopover();
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const onScroll = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) positionPanel();
    };
    window.addEventListener("resize", positionPanel);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", positionPanel);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open, positionPanel]);

  return (
    <div className="studio-dropdown">
      <button
        ref={trigger}
        type="button"
        className="studio-dropdown-trigger"
        aria-label={summary && summary !== label ? `${label}：${summary}` : label}
        aria-expanded={open}
        aria-controls={id}
        popoverTarget={id}
        disabled={disabled}
        title={summary ? undefined : label}
      >
        {icon}
        {summary && (
          <>
            <span className="studio-dropdown-summary">{summary}</span>
            <CaretDownIcon className="studio-dropdown-caret" size={13} aria-hidden="true" />
          </>
        )}
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        className={wide ? "studio-dropdown-panel studio-dropdown-panel-wide" : "studio-dropdown-panel"}
        role="group"
        aria-label={label}
        tabIndex={-1}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (next && next !== trigger.current && !event.currentTarget.contains(next)) {
            event.currentTarget.hidePopover();
          }
        }}
        onToggle={(event) => {
          const expanded = event.newState === "open";
          setOpen(expanded);
          if (!expanded) return;
          positionPanel();
          const first = event.currentTarget.querySelector<HTMLElement>("button[aria-pressed=true]:not(:disabled)") ??
            event.currentTarget.querySelector<HTMLElement>("button:not(:disabled), a[href]");
          (first ?? event.currentTarget).focus({ preventScroll: true });
        }}
      >
        {children(() => {
          panel.current?.hidePopover();
          trigger.current?.focus({ preventScroll: true });
        })}
      </div>
    </div>
  );
}
