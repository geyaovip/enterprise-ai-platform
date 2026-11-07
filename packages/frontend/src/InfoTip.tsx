import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

/** Optional context only. Consequences and validation stay visible in the form. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const cancelClose = () => clearTimeout(timer.current);
  const show = () => { cancelClose(); setOpen(true); };
  const hide = () => { cancelClose(); setOpen(false); };
  const scheduleClose = () => {
    cancelClose();
    timer.current = setTimeout(() => { if (document.activeElement !== trigger.current) setOpen(false); }, 120);
  };
  useLayoutEffect(() => {
    if (!open || !trigger.current || !tip.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const box = tip.current.getBoundingClientRect();
    setPosition({
      left: Math.max(16, Math.min(anchor.left, window.innerWidth - box.width - 16)),
      top: anchor.bottom + box.height + 24 <= window.innerHeight ? anchor.bottom + 8 : Math.max(16, anchor.top - box.height - 8),
    });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hide(); } };
    const outside = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !tip.current?.contains(event.target as Node)) hide(); };
    document.addEventListener('keydown', escape, true);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', hide);
    // Fixed-position content must not stay behind when its trigger scrolls away.
    document.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', hide);
      document.removeEventListener('scroll', hide, true);
    };
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <span className="info-tip" onMouseEnter={show} onMouseLeave={scheduleClose}>
    <button ref={trigger} type="button" className="info-tip-trigger" aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined} onFocus={show} onBlur={hide} onClick={event => { event.preventDefault(); show(); }}><Info size={16} aria-hidden="true"/></button>
    {open && createPortal(<span ref={tip} id={id} role="tooltip" className="info-tip-content" style={position} onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>{children}</span>, trigger.current?.closest('dialog[open]') ?? document.body)}
  </span>;
}
