import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, X } from 'lucide-react';

type Option = { value: string; label: string; disabled?: boolean };

/** Editable combobox: search text is temporary; only an option commits a value. */
export function SearchSelect({ label, labelHidden = false, value, selectedLabel, options, query, onQueryChange, onChange, onOpenChange, required = false, disabled = false, clearable = true, emptyLabel = '搜索并选择', loading = false, error, onRetry, hasMore = false, onMore }: {
  label: string; labelHidden?:boolean; value: string; selectedLabel?: string; options: Option[]; query: string;
  onQueryChange: (query: string) => void; onChange: (value: string) => void;
  onOpenChange?: (open:boolean) => void;
  required?: boolean; disabled?: boolean; clearable?: boolean; emptyLabel?: string; loading?: boolean; error?: string | null; onRetry?: () => void;
  hasMore?: boolean; onMore?: () => void;
}) {
  const id = useId(), root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 300 });
  const chosen = options.find(option => option.value === value)?.label ?? selectedLabel ?? '';
  const close = () => { setOpen(false); onQueryChange(''); };
  const choose = (option: Option) => { if (disabled || option.disabled) return; onChange(option.value); input.current?.focus({ preventScroll: true }); close(); };
  useEffect(() => { if (disabled) close(); }, [disabled]);
  useEffect(() => { input.current?.setCustomValidity(required && !value ? `请选择${label}` : ''); }, [label, required, value]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { if(open)setActive(0);onOpenChange?.(open); }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    setHost(root.current?.closest('dialog') ?? document.body);
    const positionPopup = () => {
      if (!root.current) return;
      const rect = root.current.querySelector('.search-select-control')!.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0, viewportLeft = viewport?.offsetLeft ?? 0;
      const width = Math.min(rect.width, (viewport?.width ?? innerWidth) - 24);
      const bottom = viewportTop + (viewport?.height ?? innerHeight);
      const below = bottom - rect.bottom - 12, above = rect.top - viewportTop - 12;
      const flip = below < 180 && above > below;
      const maxHeight = Math.max(80, Math.min(300, flip ? above : below));
      const height = Math.min(popup.current?.scrollHeight ?? maxHeight, maxHeight);
      setPosition({ left: Math.max(viewportLeft + 12, Math.min(rect.left, viewportLeft + (viewport?.width ?? innerWidth) - width - 12)), top: flip ? rect.top - height - 4 : rect.bottom + 4, width, maxHeight });
    };
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) close(); };
    positionPopup();
    const observer = new ResizeObserver(positionPopup);
    observer.observe(root.current!); if (popup.current) observer.observe(popup.current);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', positionPopup, true); window.addEventListener('resize', positionPopup);
    window.visualViewport?.addEventListener('resize', positionPopup); window.visualViewport?.addEventListener('scroll', positionPopup);
    return () => { observer.disconnect(); document.removeEventListener('pointerdown', outside); document.removeEventListener('scroll', positionPopup, true); window.removeEventListener('resize', positionPopup); window.visualViewport?.removeEventListener('resize', positionPopup); window.visualViewport?.removeEventListener('scroll', positionPopup); };
  }, [open, host]);
  useEffect(() => { if (open && !loading) popup.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active, open, loading, options.length]);
  const enabled = options.flatMap((option, i) => option.disabled ? [] : [i]);
  const index = enabled.includes(active) ? active : enabled.find(i => i >= active) ?? enabled.at(-1) ?? -1;
  return <div ref={root} className="field search-select" onBlur={event => { if (!root.current?.contains(event.relatedTarget as Node) && !popup.current?.contains(event.relatedTarget as Node)) close(); }}>
    <label htmlFor={id} className={labelHidden?'sr-only':undefined}>{label}{required && <span className="required-mark" aria-hidden="true"> *</span>}</label>
    <div className="search-select-control">
      <input ref={input} id={id} role="combobox" autoComplete="off" disabled={disabled} required={required && !value} aria-required={required} aria-autocomplete="list" aria-expanded={open} aria-controls={open ? `${id}-options` : undefined} aria-activedescendant={open && !loading && options[index] ? `${id}-option-${index}` : undefined}
        value={open ? query : chosen} placeholder={open && chosen ? chosen : emptyLabel}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onInvalid={() => setOpen(true)}
        onChange={event => { onQueryChange(event.target.value); setOpen(true); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
          else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!open) { setOpen(true); setActive(event.key === 'ArrowUp' ? enabled.at(-1) ?? 0 : enabled[0] ?? 0); } else if (!loading && event.key === 'ArrowDown' && (!enabled.length || index === enabled.at(-1)) && hasMore && onMore) { setActive(options.length); onMore(); } else { const cursor = enabled.indexOf(index), next = Math.max(0, Math.min(enabled.length - 1, cursor + (event.key === 'ArrowDown' ? 1 : -1))); setActive(enabled[next] ?? 0); } }
          else if (event.key === 'Enter' && open) { event.preventDefault(); if (!loading && options[index]) choose(options[index]); }
        }} />
      {value && clearable && <button className="search-select-clear" type="button" disabled={disabled} aria-label={`清除${label}`} onPointerDown={event => event.preventDefault()} onClick={() => { onChange(''); onQueryChange(''); input.current?.focus(); }}><X size={16} aria-hidden="true"/></button>}
      <button className="search-select-toggle" type="button" disabled={disabled} aria-label={open ? `收起${label}选项` : `展开${label}选项`} aria-expanded={open} tabIndex={-1} onPointerDown={event => event.preventDefault()} onClick={() => { if (open) close(); else { input.current?.focus(); setOpen(true); } }}><ChevronDown size={18} aria-hidden="true"/></button>
    </div>
    {open && host && createPortal(<div ref={popup} className="search-select-popup" style={position} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); input.current?.focus(); close(); } }}>
      <div id={`${id}-options`} role="listbox" aria-label={`${label}选项`} aria-busy={loading} className="search-select-options">
        {!loading && options.map((option, i) => <div role="option" id={`${id}-option-${i}`} key={option.value} aria-selected={option.value === value} aria-disabled={option.disabled || undefined} data-index={i} data-active={i === index && !option.disabled} onPointerDown={event => event.preventDefault()} onPointerMove={() => { if (!option.disabled) setActive(i); }} onClick={() => choose(option)}><span>{option.label}</span>{option.value === value && <Check size={15} aria-hidden="true"/>}</div>)}
      </div>
      {loading ? <div className="search-select-feedback" role="status">正在加载…</div> : error ? <div className="search-select-feedback" role="alert">{error}{onRetry && <button type="button" onClick={onRetry}>重试</button>}</div> : !options.length ? <div className="search-select-feedback" role="status">{hasMore?'当前批次无可选项':'无匹配结果'}</div> : null}
      {!loading && !error && hasMore && onMore && <button className="search-select-more" type="button" onPointerDown={event => event.preventDefault()} onClick={onMore}>加载更多</button>}
    </div>, host)}
  </div>;
}
