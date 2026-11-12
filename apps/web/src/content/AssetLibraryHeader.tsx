import { DropdownSelect } from '@suite/frontend/components';
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  ListChecksIcon,
  MagnifyingGlassIcon,
  XIcon,
} from "@phosphor-icons/react";
import { RecordActions } from "../components";
import { useContent } from "./content-context";

export function AssetLibraryHeader({ children }: { children: ReactNode }) {
  const { prefix, meta } = useContent();
  const { pathname } = useLocation();
  useEffect(() => { document.title = `${pathname.endsWith("/canvases") ? "画布资产" : "生成历史"} · 知行方舟`; }, [pathname]);
  return (
    <header className="content-library-header">
      <h1 className="sr-only">资产</h1>
      <nav className="content-library-nav" aria-label="资产视图">
        <NavLink end to={prefix + "/assets"}>
          生成历史
        </NavLink>
        <NavLink end to={prefix + "/assets/canvases"}>
          画布
        </NavLink>
      </nav>
      <div className="content-library-actions">
        {children}
        <RecordActions
          label="资产管理"
          more={
            <>
              {meta.permissions.includes("content.review") && (
                <Link to={prefix + "/reviews"}>审核任务</Link>
              )}
              {meta.permissions.includes("content.create") && (
                <Link to={prefix + "/trash"}>回收站</Link>
              )}
            </>
          }
        />
      </div>
    </header>
  );
}

export function LibrarySearchActions({
  label,
  query,
  onSearch,
  selecting,
  onToggleSelection,
  disabled,
}: {
  label: string;
  query: string;
  onSearch: (query: string) => void;
  selecting: boolean;
  onToggleSelection: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const searchId = useId();
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className="content-library-search-actions">
      {open && !selecting && (
        <form
          id={searchId}
          className="content-library-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch(draft.trim());
            close();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
        >
          <input
            autoFocus
            type="search"
            aria-label={label}
            placeholder={label}
            maxLength={100}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit">搜索</button>
        </form>
      )}
      <div className="content-library-icon-group">
        <button
          ref={trigger}
          type="button"
          aria-label={label}
          title={label}
          aria-expanded={open && !selecting}
          aria-controls={open && !selecting ? searchId : undefined}
          disabled={selecting}
          onClick={() => {
            if (open) close();
            else {
              setDraft(query);
              setOpen(true);
            }
          }}
        >
          <MagnifyingGlassIcon size={19} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={selecting ? "取消选择" : "批量操作"}
          title={selecting ? "取消选择" : "批量操作"}
          aria-pressed={selecting}
          disabled={disabled}
          onClick={() => {
            setOpen(false);
            onToggleSelection();
          }}
        >
          {selecting ? (
            <XIcon size={19} aria-hidden="true" />
          ) : (
            <ListChecksIcon size={19} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}

export function LibraryTimeSort({
  days,
  onDays,
  sort,
  onSort,
  canvas = false,
}: {
  days: string;
  onDays: (days: string) => void;
  sort: string;
  onSort: (sort: string) => void;
  canvas?: boolean;
}) {
  return (
    <>
      <DropdownSelect
        className="content-library-select"
        aria-label={canvas ? "画布修改时间" : "素材添加时间"}
        value={days}
        onChange={(event) => onDays(event.target.value)}
      >
        <option value="">时间</option>
        <option value="7">近 7 天</option>
        <option value="30">近 30 天</option>
        <option value="90">近 90 天</option>
      </DropdownSelect>
      <DropdownSelect
        className="content-library-select"
        aria-label={canvas ? "画布排序" : "素材排序"}
        value={sort}
        onChange={(event) => onSort(event.target.value)}
      >
        <option value="newest">
          {canvas ? "排序 · 最近修改" : "排序 · 最近添加"}
        </option>
        <option value="oldest">{canvas ? "最早修改" : "最早添加"}</option>
        <option value="name">名称排序</option>
      </DropdownSelect>
    </>
  );
}
