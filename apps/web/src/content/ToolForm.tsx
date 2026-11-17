import { useId, useRef, type ChangeEvent, type ReactNode } from "react";
import { CheckCircleIcon, CloudArrowUpIcon, type Icon, XIcon } from "@phosphor-icons/react";

export function ToolFilePicker({ label, hint, accept, selected, linked, icon: Icon = CloudArrowUpIcon, compact, disabled, onPick, onClear }: {
  label: string;
  hint: string;
  accept: string;
  selected?: string;
  linked?: boolean;
  icon?: Icon;
  compact?: boolean;
  disabled?: boolean;
  onPick: (file: File) => void;
  onClear?: () => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  function change(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) onPick(file);
  }
  return (
    <div className="tool-file" data-compact={compact || undefined}>
      <label className="tool-file-label" htmlFor={id}>{label}</label>
      <div className="tool-file-tile" data-selected={Boolean(selected)}>
        <span className="tool-file-symbol" aria-hidden="true">
          {selected ? <CheckCircleIcon size={22} /> : <Icon size={22} />}
        </span>
        <span className="tool-file-text">
          <strong title={selected}>{selected || "选择文件"}</strong>
          {selected && linked && <small>已选历史结果</small>}
          <small id={id + "-hint"}>{hint}</small>
        </span>
        {selected && <span className="tool-file-replace" aria-hidden="true">更换</span>}
        <input ref={input} id={id} type="file" accept={accept} disabled={disabled} onChange={change}
          aria-describedby={id + "-hint"} />
        {selected && onClear && <button type="button" className="tool-file-remove" disabled={disabled}
          aria-label={"移除" + label} title={"移除" + label} onClick={() => { onClear(); input.current?.focus(); }}><XIcon size={16} aria-hidden="true" /></button>}
      </div>
      <span className="sr-only" role="status">{selected ? label + "：" + selected : ""}</span>
    </div>
  );
}

export function ToolPanelHeading({ title, icon: Icon }: { title: string; icon: Icon }) {
  return <header className="tool-panel-heading"><Icon size={19} aria-hidden="true" /><h2>{title}</h2></header>;
}

export function ToolEmpty({ icon: Icon, title, children }: { icon: Icon; title: string; children?: ReactNode }) {
  return <div className="tool-empty"><span aria-hidden="true"><Icon size={24} /></span><strong>{title}</strong>
    {children && <p>{children}</p>}
  </div>;
}
