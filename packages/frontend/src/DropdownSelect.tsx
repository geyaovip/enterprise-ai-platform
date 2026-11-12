import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type SelectHTMLAttributes } from 'react';

type Option = {
  label: string;
  group: string;
  selected: boolean;
  disabled: boolean;
  index: number;
};

function readOptions(select: HTMLSelectElement): Option[] {
  return Array.from(select.options).flatMap((option, index) => {
    const group = option.parentElement instanceof HTMLOptGroupElement ? option.parentElement : null;
    if (option.hidden || group?.hidden) return [];
    return [{
      label: option.label,
      group: group?.label ?? '',
      selected: option.selected,
      disabled: option.disabled || Boolean(group?.disabled),
      index,
    }];
  });
}

/** Keep the select as the source of form values, constraints and change events. */
export function DropdownSelect({
  className, style, id, title, disabled, required, multiple,
  tabIndex, value, onChange, children, 'aria-label': label, 'aria-labelledby': labelledBy,
  'aria-describedby': describedBy, ...native
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const listId = useId();
  const control = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState('');
  const typeahead = useRef({ query: '', time: 0 });
  const selected = options.filter(option => option.selected);
  const enabled = options.filter(option => !option.disabled);

  const refresh = (select: HTMLSelectElement) => {
    const next = readOptions(select);
    setOptions(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    if (select.validity.valid) setError('');
  };
  useLayoutEffect(() => {
    if (control.current) refresh(control.current);
  });
  useEffect(() => {
    const select = control.current;
    const form = select?.form;
    if (!select || !form) return;
    let frame = 0;
    const reset = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!select.isConnected) return;
        if (value != null) {
          if (multiple) {
            const values = new Set(Array.isArray(value) ? value.map(String) : [String(value)]);
            for (const option of select.options) option.selected = values.has(option.value);
          } else if (Array.from(select.options).some(option => option.value === String(value))) {
            select.value = String(value);
          }
        }
        refresh(select);
        setError('');
      });
    };
    form.addEventListener('reset', reset);
    return () => {
      cancelAnimationFrame(frame);
      form.removeEventListener('reset', reset);
    };
  }, [native.form, multiple, value]);

  const position = () => {
    if (!trigger.current || !panel.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const popup = panel.current;
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0;
    const left = viewport?.offsetLeft ?? 0;
    const height = viewport?.height ?? innerHeight;
    const width = viewport?.width ?? innerWidth;
    const margin = 10;
    const gap = 5;
    const popupWidth = Math.min(Math.max(rect.width, 158), width - 2 * margin);
    popup.style.width = `${popupWidth}px`;
    const below = top + height - rect.bottom - margin - gap;
    const above = rect.top - top - margin - gap;
    const desired = Math.min(300, popup.scrollHeight + 2);
    const flip = desired > below && above > below;
    popup.style.maxHeight = `${Math.max(0, Math.min(300, flip ? above : below))}px`;
    popup.style.top = `${flip ? rect.top - popup.offsetHeight - gap : rect.bottom + gap}px`;
    popup.style.left = `${Math.max(left + margin, Math.min(rect.left, left + width - popupWidth - margin))}px`;
  };

  useLayoutEffect(() => {
    if (!open) return;
    position();
    const viewport = window.visualViewport;
    const observer = new ResizeObserver(position);
    if (trigger.current) observer.observe(trigger.current);
    document.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    viewport?.addEventListener('resize', position);
    viewport?.addEventListener('scroll', position);
    return () => {
      observer.disconnect();
      document.removeEventListener('scroll', position, true);
      window.removeEventListener('resize', position);
      viewport?.removeEventListener('resize', position);
      viewport?.removeEventListener('scroll', position);
    };
  }, [open, options.length]);
  useEffect(() => {
    if (disabled) panel.current?.hidePopover();
  }, [disabled]);
  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const option = panel.current.querySelector<HTMLElement>('[data-active=true]');
    if (!option) return;
    const bounds = option.getBoundingClientRect();
    const viewport = panel.current.getBoundingClientRect();
    if (bounds.bottom > viewport.bottom) panel.current.scrollTop += bounds.bottom - viewport.bottom + 4;
    if (bounds.top < viewport.top) panel.current.scrollTop -= viewport.top - bounds.top + 4;
  }, [active, open]);

  const reveal = (index = selected.find(option => !option.disabled)?.index ?? enabled[0]?.index ?? -1) => {
    if (control.current?.matches(':disabled') || !panel.current) return;
    setActive(index);
    if (!panel.current.matches(':popover-open')) {
      panel.current.showPopover();
      position();
    }
  };
  const choose = (index: number) => {
    const select = control.current;
    const option = select?.options[index];
    if (!select || !option || select.matches(':disabled') || !enabled.some(row => row.index === index)) return;
    if (multiple) option.selected = !option.selected;
    else select.selectedIndex = index;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    if (!multiple) panel.current?.hidePopover();
  };
  const summary = selected.map(option => option.label).filter(Boolean).join('、');

  return <>
    <button
      ref={trigger}
      id={id}
      type="button"
      className={className ? `dropdown-select-trigger ${className}` : 'dropdown-select-trigger'}
      style={style}
      title={title ?? (multiple && summary ? summary : undefined)}
      disabled={disabled}
      tabIndex={tabIndex}
      role="combobox"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={[describedBy, error && `${listId}-error`].filter(Boolean).join(' ') || undefined}
      aria-required={required}
      aria-invalid={Boolean(error) || undefined}
      aria-expanded={open}
      aria-controls={listId}
      aria-activedescendant={open && enabled.some(option => option.index === active) ? `${listId}-${active}` : undefined}
      onClick={() => {
        trigger.current?.focus({ preventScroll: true });
        if (panel.current?.matches(':popover-open')) panel.current.hidePopover();
        else reveal();
      }}
      onBlur={() => panel.current?.hidePopover()}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          panel.current?.hidePopover();
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const cursor = enabled.findIndex(option => option.index === active);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 :
            event.key === 'ArrowUp' ? (cursor < 0 ? enabled.length - 1 : Math.max(0, cursor - 1)) :
              Math.min(enabled.length - 1, cursor + 1);
          if (open) setActive(enabled[next]?.index ?? -1);
          else if (event.key === 'Home' || event.key === 'End') reveal(enabled[next]?.index);
          else reveal();
        } else if (open && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          choose(active);
        } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const now = Date.now();
          const key = event.key.toLocaleLowerCase();
          const previous = now - typeahead.current.time < 600 ? typeahead.current.query : '';
          const query = previous === key ? key : previous + key;
          typeahead.current = { query, time: now };
          const cursor = enabled.findIndex(option => option.index === active);
          const order = query.length > 1 ? enabled : [...enabled.slice(cursor + 1), ...enabled.slice(0, cursor + 1)];
          const match = order.find(option => option.label.toLocaleLowerCase().startsWith(query));
          if (match) {
            event.preventDefault();
            reveal(match.index);
          }
        }
      }}
    >
      <span>{summary || '请选择'}</span>
      <ChevronDown size={16} aria-hidden="true" />
    </button>
    <select
      {...native}
      ref={control}
      hidden
      style={{ display: 'none' }}
      aria-hidden="true"
      tabIndex={-1}
      disabled={disabled}
      required={required}
      multiple={multiple}
      value={value}
      onChange={event => {
        refresh(event.currentTarget);
        onChange?.(event);
      }}
      onInvalid={event => {
        event.preventDefault();
        if (event.currentTarget.form?.querySelector('input:invalid, select:invalid, textarea:invalid') === event.currentTarget) {
          trigger.current?.focus();
          reveal();
        }
        setError(event.currentTarget.validationMessage);
      }}
    >{children}</select>
    <div
      ref={panel}
      id={listId}
      role="listbox"
      aria-labelledby={labelledBy}
      aria-label={label}
      aria-multiselectable={multiple || undefined}
      popover="auto"
      className="dropdown-select-popup search-select-options"
      onToggle={event => setOpen(event.newState === 'open')}
    >
      {open && options.map((option, index) => <div key={option.index} role="presentation">
        {option.group && option.group !== options[index - 1]?.group && <div className="dropdown-select-group">{option.group}</div>}
        <div
          id={`${listId}-${option.index}`}
          role="option"
          aria-selected={option.selected}
          aria-disabled={option.disabled || undefined}
          data-active={option.index === active && !option.disabled}
          onPointerDown={event => event.preventDefault()}
          onPointerMove={() => { if (!option.disabled) setActive(option.index); }}
          onClick={event => {
            event.preventDefault();
            choose(option.index);
          }}
        >
          <span>{option.label || '请选择'}</span>
          {option.selected && <Check size={15} aria-hidden="true" />}
        </div>
      </div>)}
      {open && options.length === 0 && <div className="search-select-feedback">暂无选项</div>}
    </div>
    {error && <small className="dropdown-select-error" id={`${listId}-error`} role="alert">{error}</small>}
  </>;
}
