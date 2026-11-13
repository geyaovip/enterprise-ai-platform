import { ImageToolsDialog } from "./ImageToolsDialog";
import { ImageRegionDialog, type EditRegion } from "./ImageRegionDialog";
import { VideoFrameDialog } from "./VideoFrameDialog";
import {
  MediaOptions,
  mediaActive,
  pictureDefaults,
  constrainPicture,
  clipDefaults,
  legacyRatios,
  type MediaMode,
  type PictureOptions,
  type ClipOptions,
} from "./MediaOptions";
import { EntitySelect } from "../components";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  PlusIcon,
  NoteIcon,
  ImageIcon,
  MinusIcon,
  ArrowsOutIcon,
  DownloadSimpleIcon,
  TrashIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  ArrowCounterClockwiseIcon,
  ArrowClockwiseIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { api, ApiError } from "../api";
import { useApiData } from "../hooks";
import {
  ConfirmDialog,
  Dialog,
  Field,
  Notice,
  RecordActions,
} from "../components";
import { DropdownSelect, InfoTip } from "@suite/frontend/components";
import {
  assetDownloadName,
  FileInput,
  Pager,
  Result,
  status,
  useAction,
  useContent,
  useDirty,
} from "./content-ui";
import { CreativeTabs } from "./CreativeTabs";
import {
  AssetLibraryHeader,
  LibrarySearchActions,
  LibraryTimeSort,
} from "./AssetLibraryHeader";
import {
  useCanvasDraft,
  type CanvasData,
  type CanvasNode,
  type CanvasRecipe,
} from "./canvas-state";
import "./canvas.css";

function CanvasWidthInput({
  width,
  disabled,
  onChange,
}: {
  width: number;
  disabled: boolean;
  onChange: (width: number) => void;
}) {
  const [text, setText] = useState(String(Math.round(width)));
  useEffect(() => setText(String(Math.round(width))), [width]);
  return (
    <input
      type="number"
      min={80}
      max={2000}
      aria-label="所选内容宽度"
      disabled={disabled}
      value={text}
      onChange={(event) => {
        const value = event.target.value;
        setText(value);
        const next = Number(value);
        // Keep partial input locally; only valid dimensions reach the saved canvas.
        if (value && next >= 80 && next <= 2000) onChange(next);
      }}
      onBlur={() => setText(String(Math.round(width)))}
    />
  );
}

export function CanvasList() {
  const c = useContent(),
    nav = useNavigate(),
    action = useAction();
  const [params, setParams] = useSearchParams();
  const canCreate = c.meta.permissions.includes("content.create");
  const [page, setPage] = useState(1),
    [q, setQ] = useState(""),
    [days, setDays] = useState(""),
    [sort, setSort] = useState("newest"),
    [visibility, setVisibility] = useState(""),
    [selecting, setSelecting] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [copied, setCopied] = useState(false),
    [open, setOpen] = useState(false);
  const rows = useApiData<{
    items: { id: string; updatedAt: string; project: { name: string } }[];
    total: number;
    page: number;
    pageSize: number;
  }>(
    c.base +
      `/canvases?page=${page}&q=${encodeURIComponent(q)}&sort=${sort}` +
      (days ? "&days=" + days : "") +
      (visibility ? "&visibility=" + visibility : ""),
  );
  const boards = rows.data?.items ?? [];
  const selectedBoards = boards.filter((board) => selected.includes(board.id));
  const allSelected =
    boards.length > 0 && selectedBoards.length === boards.length;
  const resetList = (nextPage = 1) => {
    setPage(nextPage);
    setSelected([]);
    setCopied(false);
  };
  const toggleBoard = (id: string) => {
    setSelecting(true);
    setCopied(false);
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id],
    );
  };
  const requested = params.get("new") === "1";
  const close = () => {
    if (action.busy) return;
    setOpen(false);
    if (requested) {
      const next = new URLSearchParams(params);
      next.delete("new");
      setParams(next, { replace: true });
    }
  };
  return (
    <>
      <AssetLibraryHeader>
        <LibrarySearchActions
          label="搜索画布"
          query={q}
          onSearch={(value) => {
            setQ(value);
            resetList();
          }}
          selecting={selecting}
          disabled={action.busy || (!selecting && (rows.loading || !boards.length))}
          onToggleSelection={() => {
            setSelecting(!selecting);
            setSelected([]);
            setCopied(false);
          }}
        />
      </AssetLibraryHeader>
      <div className="content-library-filters">
        <DropdownSelect
          className="content-library-select"
          aria-label="筛选画布范围"
          value={visibility}
          onChange={(event) => {
            setVisibility(event.target.value);
            resetList();
          }}
        >
          <option value="">筛选 · 全部范围</option>
          <option value="private">项目私有</option>
          <option value="tenant">企业共享</option>
        </DropdownSelect>
        <LibraryTimeSort
          canvas
          days={days}
          onDays={(value) => {
            setDays(value);
            resetList();
          }}
          sort={sort}
          onSort={(value) => {
            setSort(value);
            resetList();
          }}
        />
        {q && (
          <button
            type="button"
            className="content-library-search-term"
            aria-label={"清除搜索 " + q}
            onClick={() => {
              setQ("");
              resetList();
            }}
          >
            {q} ×
          </button>
        )}
      </div>
      {selecting && (
        <div className="content-asset-list-toolbar">
          <div
            className="content-asset-batch"
            role="group"
            aria-label="选中画布操作"
          >
            <label className="content-asset-select-all">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(element) => {
                  if (element)
                    element.indeterminate =
                      selectedBoards.length > 0 && !allSelected;
                }}
                disabled={rows.loading || !boards.length || action.busy}
                onChange={(event) => {
                  setSelected(
                    event.target.checked ? boards.map((board) => board.id) : [],
                  );
                  setCopied(false);
                }}
              />
              全选本页
            </label>
            <span role="status">
              已选 {selectedBoards.length} 项{copied ? " · 已复制链接" : ""}
            </span>
            <RecordActions>
              <button
                type="button"
                disabled={!selectedBoards.length || action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await navigator.clipboard.writeText(
                      selectedBoards
                        .map(
                          (board) =>
                            new URL(
                              c.prefix + "/canvases/" + board.id,
                              location.origin,
                            ).href,
                        )
                        .join("\n"),
                    );
                    setCopied(true);
                  })
                }
              >
                复制链接
              </button>
            </RecordActions>
          </div>
          <Notice text={action.error} />
        </div>
      )}
      <div className="canvas-library">
        <Result result={rows}>
          <div className="canvas-cards" data-selecting={selecting}>
            {canCreate && !selecting && (
              <button
                type="button"
                className="canvas-card canvas-create-card"
                onClick={() => setOpen(true)}
              >
                <span className="canvas-card-cover" aria-hidden="true">
                  <PlusIcon size={30} />
                </span>
                <strong>新建画布</strong>
              </button>
            )}
            {boards.map((board) => {
              const checked = selected.includes(board.id);
              const contents = (
                <>
                  <span className="canvas-card-cover" aria-hidden="true">
                    <ArrowsOutIcon size={30} />
                  </span>
                  <strong>{board.project.name}</strong>
                  <time dateTime={board.updatedAt}>
                    {new Date(board.updatedAt).toLocaleDateString("zh-CN")}
                  </time>
                </>
              );
              return (
                <article
                  key={board.id}
                  className="canvas-card-item"
                  data-selected={checked}
                >
                  {selecting ? (
                    <button
                      type="button"
                      className="canvas-card canvas-create-card"
                      aria-pressed={checked}
                      onClick={() => toggleBoard(board.id)}
                    >
                      {contents}
                    </button>
                  ) : (
                    <Link
                      to={c.prefix + "/canvases/" + board.id}
                      state={{ fromAssetLibrary: true }}
                      className="canvas-card"
                    >
                      {contents}
                    </Link>
                  )}
                  <label className="content-asset-check">
                    <input
                      type="checkbox"
                      aria-label={"选择 " + board.project.name}
                      checked={checked}
                      onChange={() => toggleBoard(board.id)}
                    />
                  </label>
                </article>
              );
            })}
          </div>
          {rows.data?.total === 0 && (!canCreate || selecting || q || days || visibility) && (
            <div className="canvas-empty">
              {q || days || visibility ? "未找到画布" : "暂无画布"}
            </div>
          )}
          <Pager result={rows} page={page} setPage={resetList} />
        </Result>
        {canCreate && (open || requested) && (
          <NewCanvasDialog onClose={close} onCreated={(id) =>
            nav(c.prefix + "/canvases/" + id, {
              replace: requested,
              state: { fromAssetLibrary: true },
            })
          } />
        )}
      </div>
    </>
  );
}

function NewCanvasDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { base } = useContent();
  const action = useAction();
  const [name, setName] = useState("");
  return (
    <Dialog open title="新建画布" busy={action.busy} onClose={onClose}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        void action.run(async () => {
          const board = await api.post<{ id: string }>(base + "/canvases", { name: name.trim() });
          window.dispatchEvent(new Event("content-projects-changed"));
          onCreated(board.id);
        });
      }}>
        <Field label="画布名称">
          <input autoFocus required maxLength={100} value={name}
            disabled={action.busy} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Notice text={action.error} />
        <button className="primary" disabled={action.busy || !name.trim()}>
          创建画布
        </button>
      </form>
    </Dialog>
  );
}

export function CanvasHome() {
  const { base, prefix, meta } = useContent();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const rows = useApiData<{
    items: { id: string; updatedAt: string; project: { name: string } }[];
    total: number;
  }>(base + `/canvases?page=${page}&q=${encodeURIComponent(query.trim())}`);
  const requested = params.get("new") === "1";
  useEffect(() => { document.title = "创作画布 · 知行方舟"; }, []);
  return (
    <div className="creation-studio canvas-home">
      <CreativeTabs mode="canvas" />
      <section className="canvas-home-projects" aria-labelledby="canvas-home-title">
        <header>
          <h1 id="canvas-home-title">创作画布</h1>
          {meta.permissions.includes("content.create") && (
            <button className="primary" onClick={() => setParams({ new: "1" }, { replace: true })}>
              <PlusIcon size={18} aria-hidden="true" /> 新建画布
            </button>
          )}
        </header>
        <input type="search" aria-label="搜索画布" placeholder="搜索画布"
          maxLength={100} value={query} onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }} />
        <Result result={rows}>
          {rows.data?.items.length ? (
            <div className="canvas-cards">
              {rows.data.items.map((board) => (
                <Link key={board.id} to={prefix + "/canvases/" + board.id} className="canvas-card">
                  <span className="canvas-card-cover" aria-hidden="true"><ArrowsOutIcon size={30} /></span>
                  <strong>{board.project.name}</strong>
                  <time dateTime={board.updatedAt}>{new Date(board.updatedAt).toLocaleDateString("zh-CN")}</time>
                </Link>
              ))}
            </div>
          ) : <p className="canvas-empty">{query.trim() ? "未找到画布" : "暂无画布"}</p>}
          <Pager result={rows} page={page} setPage={setPage} />
        </Result>
      </section>
      {requested && meta.permissions.includes("content.create") && (
        <NewCanvasDialog onClose={() => setParams({}, { replace: true })}
          onCreated={(id) => navigate(prefix + "/canvases/" + id, { replace: true })} />
      )}
    </div>
  );
}

/** Send a source image to a canvas through the guarded import endpoint. */
export async function putImageOnCanvas(
  base: string,
  assetId: string,
  projectId?: string,
  name = "图片画布",
) {
  const board = await api.post<any>(
    base + "/canvases",
    projectId ? { projectId } : { name },
  );
  if (!board.data.nodes.some((node: CanvasNode) => node.assetId === assetId))
    await api.post(base + "/canvases/" + board.id + "/images", {
      version: board.version,
      assetId,
      nodeId: crypto.randomUUID(),
      x: 0,
      y: 0,
    });
  window.dispatchEvent(new Event("content-projects-changed"));
  return board.id as string;
}

export function AddToCanvas({
  assetId,
  projectId,
}: {
  assetId: string;
  projectId?: string;
}) {
  const c = useContent(),
    nav = useNavigate(),
    action = useAction();
  return (
    <button
      disabled={action.busy}
      onClick={() =>
        void action.run(async () => {
          const boardId = await putImageOnCanvas(c.base, assetId, projectId);
          nav(c.prefix + "/canvases/" + boardId);
        })
      }
    >
      <ArrowsOutIcon size={17} aria-hidden="true" />
      放入画布{action.error && <span role="alert">{action.error}</span>}
    </button>
  );
}
export function ContentCanvas() {
  const { id = "" } = useParams();
  return <CanvasWorkspace key={id} id={id} />;
}
function CanvasWorkspace({ id }: { id: string }) {
  const fromAssetLibrary = useLocation().state?.fromAssetLibrary === true;
  const c = useContent(),
    nav = useNavigate(),
    action = useAction(),
    createAction = useAction();
  const editable = c.meta.permissions.includes("content.create"),
    canGenerate = editable && c.meta.permissions.includes("content.ai.use");
  const endpoint = c.base + "/canvases/" + id,
    cacheKey = `content-canvas:${c.base}:${c.meta.membershipId}:${id}`;
  const draft = useCanvasDraft(endpoint, cacheKey, editable),
    board = draft.snapshot;
  useEffect(() => { document.title = `${board?.project.name ?? "创作画布"} · 知行方舟`; }, [board?.project.name]);
  const [imageTools, setImageTools] = useState<{
    id: string;
    name: string;
    nodeId: string;
  } | null>(null);
  const [regionNode, setRegionNode] = useState<CanvasNode | null>(null);
  const [regionEdit, setRegionEdit] = useState<{
    assetId: string;
    region: EditRegion;
  }>();
  const [frameVideo, setFrameVideo] = useState<string | null>(null);
  const [composer] = useState(() => {
    try {
      const value = JSON.parse(
        sessionStorage.getItem(cacheKey + ":composer") ?? "null",
      );
      return value &&
        typeof value.instruction === "string" &&
        value.instruction.length <= 2000 &&
        ["square", "portrait", "story"].includes(value.size)
        ? value
        : null;
    } catch {
      return null;
    }
  });
  const [selected, setSelected] = useState(composer?.selected ?? ""),
    [instruction, setInstruction] = useState(composer?.instruction ?? ""),
    [size] = useState(composer?.size ?? "square"),
    [mode, setMode] = useState<MediaMode>("image"),
    [picture, setPicture] = useState<PictureOptions>({
      ...pictureDefaults,
      ratio: legacyRatios[size],
    }),
    [clip, setClip] = useState<ClipOptions>(clipDefaults),
    [videoPrompt, setVideoPrompt] = useState(""),
    [frameId, setFrameId] = useState<string>(),
    [extraNodes, setExtraNodes] = useState<string[]>([]),
    [brand, setBrand] = useState<{ id: string; version: number }>(),
    [receipt, setReceipt] = useState<any>(null),
    [assetsOpen, setAssetsOpen] = useState(false),
    [assetScope, setAssetScope] = useState("project"),
    [assetPage, setAssetPage] = useState(1),
    [assetSearch, setAssetSearch] = useState(""),
    [assetQuery, setAssetQuery] = useState(""),
    [renameOpen, setRenameOpen] = useState(false),
    [name, setName] = useState(""),
    [archiveOpen, setArchiveOpen] = useState(false),
    [discardOpen, setDiscardOpen] = useState(false);
  useEffect(() => {
    if (!editable) return;
    try {
      sessionStorage.setItem(
        cacheKey + ":composer",
        JSON.stringify({ selected, instruction, size }),
      );
    } catch {
      /* In-memory input remains usable. */
    }
  }, [selected, instruction, size, cacheKey, editable]);
  const [uncertain, setUncertain] = useState(
    () => !!sessionStorage.getItem(cacheKey + ":outbox"),
  );
  const [gesture, setGesture] = useState<CanvasData | null>(null);
  const [past, setPast] = useState<CanvasData[]>([]),
    [future, setFuture] = useState<CanvasData[]>([]);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const surface = useRef<HTMLDivElement>(null),
    pointer = useRef<any>(null);
  const view = gesture ?? draft.data,
    node = view?.nodes.find((n) => n.id === selected),
    refNode =
      node?.type === "image" && board?.assets[node.assetId!] ? node : null;
  const restoredRecipe = useRef(false);
  const applyRecipe = (recipe: CanvasRecipe) => {
    setMode(recipe.mode);
    setPicture(recipe.picture);
    setInstruction(recipe.picture.prompt);
    setSelected(recipe.picture.nodes[0] ?? "");
    setExtraNodes(recipe.picture.nodes.slice(1));
    const reference = (board?.data.nodes as CanvasNode[] | undefined)?.find(
      (node) => node.id === recipe.picture.nodes[0],
    );
    setRegionEdit(
      recipe.picture.region && reference?.assetId
        ? { assetId: reference.assetId, region: recipe.picture.region }
        : undefined,
    );
    setBrand(recipe.picture.brand);
    setClip(recipe.video.options);
    setVideoPrompt(recipe.video.prompt);
    setFrameId(recipe.video.node);
  };
  useEffect(() => {
    if (!board || restoredRecipe.current) return;
    restoredRecipe.current = true;
    if (board.data.recipe) applyRecipe(board.data.recipe);
  }, [board]);
  const imageNodes =
    view?.nodes.filter(
      (n) => n.type === "image" && board?.assets[n.assetId!],
    ) ?? [];
  const frame = imageNodes.find((n) => n.id === frameId);
  const usedImageNodes = [
    ...new Map(
      [refNode, ...extraNodes.map((id) => imageNodes.find((n) => n.id === id))]
        .filter((n): n is CanvasNode => !!n)
        .map((n) => [n.assetId, n]),
    ).values(),
  ];
  const activeRegion =
    usedImageNodes.length === 1 &&
    usedImageNodes[0].assetId === regionEdit?.assetId
      ? regionEdit?.region
      : undefined;
  const effectivePicture = constrainPicture(picture, c.meta.model.imageOptions);
  const imageMode = mode === "image";
  const prompt = imageMode ? instruction : videoPrompt;
  const effectiveClip =
    !frame && clip.ratio === "adaptive" ? { ...clip, ratio: "16:9" } : clip;
  const modelReady = imageMode
    ? c.meta.model.configured
    : c.meta.model.videoConfigured;
  const locked =
    !editable || draft.blocked || !board || action.busy || createAction.busy;
  const unsaved = useDirty(draft.dirty);
  const batches = useApiData<any>(
    board ? c.base + "/projects/" + board.projectId + "/batches?page=1" : null,
  );
  const assetRows = useApiData<any>(
    assetsOpen && board
      ? c.base +
          `/assets?media=image&page=${assetPage}` +
          "&q=" +
          encodeURIComponent(assetQuery) +
          (assetScope === "project" ? "&projectId=" + board.projectId : "")
      : null,
  );
  const running =
    batches.data?.items
      .flatMap((b: any) => (b.snapshot.canvas?.id === id ? b.items : []))
      .filter((i: any) =>
        [...mediaActive, "needs_reconciliation"].includes(i.status),
      ) ?? [];
  useEffect(() => {
    if (!board?.pending && !running.length) return;
    const timer = setInterval(() => {
      void draft.refresh();
      void batches.reload();
    }, 3000);
    return () => clearInterval(timer);
  }, [board?.pending, running.length, draft.refresh, batches.reload]);
  // Undo remains local to the current server snapshot; it never removes an asynchronously delivered image.
  useEffect(() => {
    setPast([]);
    setFuture([]);
  }, [draft.historyEpoch]);
  const change = (next: CanvasData) => {
    if (!draft.data || locked) return;
    setPast((p) => [...p.slice(-39), structuredClone(draft.data!)]);
    setFuture([]);
    draft.change(next);
  };
  const updateNode = (value: Partial<CanvasNode>) => {
    if (view)
      change({
        ...view,
        nodes: view.nodes.map((n) =>
          n.id === selected ? { ...n, ...value } : n,
        ),
      });
  };
  const anchor = () => {
    const v = draft.data?.viewport ?? { x: 0, y: 0, zoom: 1 };
    return {
      x: Math.max(-19000, Math.min(19000, (50 - v.x) / v.zoom)),
      y: Math.max(-19000, Math.min(19000, (60 - v.y) / v.zoom)),
    };
  };
  const addNote = () => {
    if (!view || locked || view.nodes.length >= 100) return;
    const note: CanvasNode = {
      id: crypto.randomUUID(),
      type: "note",
      text: "",
      ...anchor(),
      width: 260,
      height: 180,
    };
    change({ ...view, nodes: [...view.nodes, note] });
    setSelected(note.id);
  };
  const focusComposer = () => composerInput.current?.focus();
  const importImage = async (assetId: string, originNodeId?: string) => {
    const saved = await draft.flush();
    const nodeId = originNodeId ? assetId : crypto.randomUUID();
    const origin = draft.data?.nodes.find((node) => node.id === originNodeId);
    const position =
      origin && origin.x + origin.width + 32 <= 20000
        ? { x: origin.x + origin.width + 32, y: origin.y }
        : anchor();
    await api.post(endpoint + "/images", {
      version: saved.version,
      nodeId,
      assetId,
      ...position,
    });
    await draft.refresh();
    setSelected(nodeId);
    setAssetsOpen(false);
  };
  const zoom = (factor: number) => {
    if (!view || !surface.current) return;
    const { width, height } = surface.current.getBoundingClientRect(),
      old = view.viewport,
      next = Math.max(0.15, Math.min(3, old.zoom * factor));
    draft.change({
      ...view,
      viewport: {
        zoom: next,
        x: Math.max(
          -20000,
          Math.min(20000, ((old.x - width / 2) * next) / old.zoom + width / 2),
        ),
        y: Math.max(
          -20000,
          Math.min(
            20000,
            ((old.y - height / 2) * next) / old.zoom + height / 2,
          ),
        ),
      },
    });
  };
  const fit = () => {
    if (!view || !surface.current) return;
    if (!view.nodes.length) {
      draft.change({ ...view, viewport: { x: 40, y: 40, zoom: 1 } });
      return;
    }
    const minX = Math.min(...view.nodes.map((n) => n.x)),
      minY = Math.min(...view.nodes.map((n) => n.y)),
      maxX = Math.max(...view.nodes.map((n) => n.x + n.width)),
      maxY = Math.max(...view.nodes.map((n) => n.y + n.height));
    const { width, height } = surface.current.getBoundingClientRect(),
      z = Math.max(
        0.15,
        Math.min(
          1.3,
          (width - 100) / (maxX - minX),
          (height - 100) / (maxY - minY),
        ),
      );
    draft.change({
      ...view,
      viewport: {
        x: Math.max(
          -20000,
          Math.min(20000, (width - (maxX - minX) * z) / 2 - minX * z),
        ),
        y: Math.max(
          -20000,
          Math.min(20000, (height - (maxY - minY) * z) / 2 - minY * z),
        ),
        zoom: z,
      },
    });
  };
  const initialViewAdjusted = useRef(false);
  useEffect(() => {
    if (!draft.data || !surface.current || initialViewAdjusted.current) return;
    initialViewAdjusted.current = true;
    // A desktop viewport restored on a phone can otherwise put every image outside the visible surface.
    if (surface.current.clientWidth < 720) fit();
  }, [!!draft.data]);
  const startDrag = (e: ReactPointerEvent, nodeId?: string) => {
    if (
      !view ||
      (e.target as HTMLElement).closest("textarea,button,a,input") ||
      e.button > 0
    )
      return;
    if (nodeId) setSelected(nodeId);
    else setSelected("");
    if ((locked && nodeId) || draft.blocked || action.busy || createAction.busy)
      return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointer.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      data: structuredClone(view),
      nodeId,
    };
  };
  const move = (e: ReactPointerEvent) => {
    const p = pointer.current;
    if (!p || p.pointerId !== e.pointerId) return;
    const dx = e.clientX - p.startX,
      dy = e.clientY - p.startY,
      data = p.data as CanvasData;
    const clamp = (v: number) => Math.max(-20000, Math.min(20000, v));
    setGesture(
      p.nodeId
        ? {
            ...data,
            nodes: data.nodes.map((n) =>
              n.id === p.nodeId
                ? {
                    ...n,
                    x: clamp(n.x + dx / data.viewport.zoom),
                    y: clamp(n.y + dy / data.viewport.zoom),
                  }
                : n,
            ),
          }
        : {
            ...data,
            viewport: {
              ...data.viewport,
              x: clamp(data.viewport.x + dx),
              y: clamp(data.viewport.y + dy),
            },
          },
    );
  };
  const finishDrag = () => {
    if (gesture) {
      if (pointer.current?.nodeId) change(gesture);
      else draft.change(gesture);
    }
    pointer.current = null;
    setGesture(null);
  };
  const send = async (recovery = false) => {
    let envelope: any;
    if (recovery) {
      envelope = JSON.parse(
        sessionStorage.getItem(cacheKey + ":outbox") ?? "null",
      );
      if (!envelope) {
        setUncertain(false);
        return;
      }
    } else {
      const saved = await draft.flush(),
        p = await api.get<any>(c.base + "/projects/" + board.projectId);
      const origin = imageMode ? usedImageNodes[0] : frame;
      const request = {
        projectVersion: p.version,
        mode,
        instruction: prompt.trim(),
        ...(imageMode
          ? {
              ratio: effectivePicture.ratio,
              ...(activeRegion ? { region: activeRegion } : {}),
              resolution: effectivePicture.resolution,
              candidates: effectivePicture.candidates,
              ...(usedImageNodes.length
                ? {
                    referenceAssetIds: usedImageNodes.map(
                      (node) => node.assetId,
                    ),
                  }
                : {}),
            }
          : {
              video: effectiveClip,
              ...(frame ? { referenceAssetId: frame.assetId } : {}),
            }),
        ...(brand ? { brand } : {}),
      };
      const preview = await api.post<any>(
        c.base + `/projects/${p.id}/preview`,
        request,
      );
      envelope = {
        projectId: p.id,
        body: {
          request,
          previewHash: preview.previewHash,
          expiresAt: preview.expiresAt,
          requestKey: crypto.randomUUID(),
          canvas: {
            id,
            version: saved.version,
            ...(origin ? { originNodeId: origin.id } : {}),
            anchor: anchor(),
          },
        },
      };
      // A recoverable envelope must be stored before making a paid request.
      sessionStorage.setItem(cacheKey + ":outbox", JSON.stringify(envelope));
    }
    try {
      await api.post(
        c.base + `/projects/${envelope.projectId}/batches`,
        envelope.body,
      );
      sessionStorage.removeItem(cacheKey + ":outbox");
      setUncertain(false);
      if (imageMode) {
        setInstruction("");
        setRegionEdit(undefined);
      } else setVideoPrompt("");
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        sessionStorage.removeItem(cacheKey + ":outbox");
        setUncertain(false);
      } else setUncertain(true);
      throw e;
    }
    await Promise.all([draft.refresh(), batches.reload()]);
  };
  if (!board || !view)
    return (
      <div className="canvas-library">
        <CreativeTabs mode="canvas" />
        <Notice text={draft.error} />
        <button onClick={() => void draft.refresh()}>重新载入画布</button>
        {draft.state === "loading" && <div role="status">载入画布…</div>}
      </div>
    );
  return (
    <div className="creation-studio canvas-workspace">
      <header className="canvas-header">
        <div>
          <Link to={c.prefix + (fromAssetLibrary ? "/assets/canvases" : "/canvas")} aria-label="返回画布列表">
            <ArrowLeftIcon size={19} />
          </Link>
          <h1>{board.project.name}</h1>
        </div>
        <CreativeTabs mode="canvas" projectId={board.projectId} canvasId={id} />
        <div className="canvas-header-end">
          <span role="status" className="canvas-save-state">
            {
              {
                synced: "已保存",
                local: "待保存",
                saving: "保存中…",
                conflict: "保存冲突",
                error: "未同步",
              }[draft.state]
            }
          </span>
          {editable && (
            <details>
              <summary aria-label="画布操作">•••</summary>
              <div className="canvas-menu">
                <button
                  onClick={() => {
                    setName(board.project.name);
                    setRenameOpen(true);
                  }}
                >
                  重命名
                </button>
                {board.data.recipe && (
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() =>
                      void action.run(async () => {
                        await draft.flush();
                        const copy = await api.post<any>(c.base + "/canvases", {
                          name: board.project.name.slice(0, 95) + " · 副本",
                          sourceCanvasId: id,
                        });
                        window.dispatchEvent(
                          new Event("content-projects-changed"),
                        );
                        nav(c.prefix + "/canvases/" + copy.id);
                      })
                    }
                  >
                    复制设置到新画布
                  </button>
                )}
                <button onClick={() => setArchiveOpen(true)}>移入回收站</button>
              </div>
            </details>
          )}
        </div>
      </header>
      {(draft.error || action.error || createAction.error) && (
        <div className="canvas-errors">
          <Notice text={draft.error || action.error || createAction.error} />
          {draft.blocked ? (
            <button onClick={() => setDiscardOpen(true)}>重新载入</button>
          ) : (
            draft.state === "error" && (
              <button onClick={() => void action.run(() => draft.flush())}>
                重试保存
              </button>
            )
          )}
        </div>
      )}
      <div className="canvas-stage-wrap">
        <div className="canvas-tools" aria-label="画布工具">
          <button
            aria-label="添加图片"
            title="添加图片"
            disabled={locked}
            onClick={() => setAssetsOpen(true)}
          >
            <ImageIcon size={20} />
          </button>
          <button
            aria-label="添加备注"
            title="添加备注"
            disabled={locked || view.nodes.length >= 100}
            onClick={addNote}
          >
            <NoteIcon size={20} />
          </button>
          {canGenerate && view.nodes.length > 0 && (
            <button
              aria-label="打开生成输入"
              title="打开生成输入"
              disabled={locked || uncertain}
              onClick={focusComposer}
            >
              <SparkleIcon size={20} aria-hidden="true" />
            </button>
          )}
          <button
            aria-label="撤销"
            title="撤销"
            disabled={locked || !past.length}
            onClick={() => {
              const p = past[past.length - 1];
              setPast(past.slice(0, -1));
              setFuture((f) => [...f, structuredClone(view)]);
              draft.change(p);
            }}
          >
            <ArrowCounterClockwiseIcon size={20} aria-hidden="true" />
          </button>
          <button
            aria-label="重做"
            title="重做"
            disabled={locked || !future.length}
            onClick={() => {
              const n = future[future.length - 1];
              setFuture(future.slice(0, -1));
              setPast((p) => [...p, structuredClone(view)]);
              draft.change(n);
            }}
          >
            <ArrowClockwiseIcon size={20} aria-hidden="true" />
          </button>
        </div>
        <div
          ref={surface}
          className="canvas-surface"
          aria-label="创作画布"
          onPointerDown={(e) => startDrag(e)}
          onPointerMove={move}
          onPointerUp={finishDrag}
          onPointerCancel={() => {
            pointer.current = null;
            setGesture(null);
          }}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) zoom(e.deltaY > 0 ? 0.92 : 1.08);
          }}
        >
          <div
            className="canvas-world"
            style={{
              transform: `translate(${view.viewport.x}px,${view.viewport.y}px) scale(${view.viewport.zoom})`,
            }}
          >
            {view.nodes.map((n) => (
              <div
                key={n.id}
                className={`canvas-node canvas-${n.type} ${selected === n.id ? "is-selected" : ""}`}
                style={{
                  left: n.x,
                  top: n.y,
                  width: n.width,
                  height: n.height,
                }}
                tabIndex={0}
                role="group"
                aria-label={
                  n.type === "note"
                    ? "文字备注"
                    : (board.assets[n.assetId!]?.filename ?? "图片不可用")
                }
                onFocus={() => setSelected(n.id)}
                onPointerDown={(e) => startDrag(e, n.id)}
                onKeyDown={(e) => {
                  if (
                    locked ||
                    (e.target as HTMLElement).matches("textarea,input")
                  )
                    return;
                  const delta: Record<string, [number, number]> = {
                    ArrowLeft: [-1, 0],
                    ArrowRight: [1, 0],
                    ArrowUp: [0, -1],
                    ArrowDown: [0, 1],
                  };
                  if (delta[e.key]) {
                    e.preventDefault();
                    const [dx, dy] = delta[e.key],
                      step = e.shiftKey ? 10 : 1;
                    updateNode({
                      x: Math.max(-20000, Math.min(20000, n.x + dx * step)),
                      y: Math.max(-20000, Math.min(20000, n.y + dy * step)),
                    });
                  }
                }}
              >
                {n.type === "video" ? (
                  board.assets[n.assetId!] ? (
                    <video
                      controls
                      preload="metadata"
                      aria-label={board.assets[n.assetId!].filename}
                      onPointerDown={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                      src={
                        "/api/v1" + c.base + "/assets/" + n.assetId + "/file"
                      }
                    />
                  ) : (
                    <span>视频不可用</span>
                  )
                ) : n.type === "image" ? (
                  board.assets[n.assetId!] ? (
                    <img
                      src={
                        "/api/v1" +
                        c.base +
                        "/assets/" +
                        n.assetId +
                        "/thumbnail"
                      }
                      alt={board.assets[n.assetId!].filename}
                      draggable={false}
                    />
                  ) : (
                    <span>图片不可用</span>
                  )
                ) : (
                  <>
                    <div className="canvas-note-grip" aria-hidden="true">
                      ⋮⋮
                    </div>
                    <textarea
                      aria-label="备注内容"
                      readOnly={locked}
                      maxLength={2000}
                      placeholder="写下备注…"
                      value={n.text ?? ""}
                      onChange={(e) => {
                        setSelected(n.id);
                        change({
                          ...view,
                          nodes: view.nodes.map((node) =>
                            node.id === n.id
                              ? { ...node, text: e.target.value }
                              : node,
                          ),
                        });
                      }}
                    />
                  </>
                )}
              </div>
            ))}
          </div>
          {!view.nodes.length && (
            <div className="canvas-start">
              {editable ? (
                <div className="canvas-start-actions">
                  {canGenerate && (
                    <button
                      className="primary"
                      disabled={locked || uncertain}
                      onClick={focusComposer}
                    >
                      <SparkleIcon size={18} aria-hidden="true" />
                      开始生成
                    </button>
                  )}
                  <button disabled={locked} onClick={() => setAssetsOpen(true)}>
                    <ImageIcon size={18} aria-hidden="true" />
                    添加图片
                  </button>
                  <button disabled={locked} onClick={addNote}>
                    <NoteIcon size={18} aria-hidden="true" />
                    写备注
                  </button>
                </div>
              ) : (
                <span>暂无内容</span>
              )}
            </div>
          )}
        </div>
        {node && (
          <div className="canvas-selection" aria-label="所选内容操作">
            <span>
              {node.type !== "note"
                ? (board.assets[node.assetId!]?.filename ?? "素材不可用")
                : "备注"}
            </span>
            {node.type !== "note" && board.assets[node.assetId!] && (
              <a
                href={"/api/v1" + c.base + "/assets/" + node.assetId + "/file"}
                download={assetDownloadName(board.assets[node.assetId!])}
                aria-label={
                  node.type === "video" ? "下载所选视频" : "下载所选图片"
                }
              >
                <DownloadSimpleIcon size={19} />
              </a>
            )}
            {node.type === "image" && canGenerate && (
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  setMode("video");
                  setFrameId(node.id);
                  setClip({ ...clip, ratio: "adaptive" });
                  focusComposer();
                }}
              >
                生成视频
              </button>
            )}
            {node.type === "image" &&
              canGenerate &&
              board.assets[node.assetId!] && (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => setRegionNode(node)}
                >
                  局部改图
                </button>
              )}
            {node.type === "video" &&
              editable &&
              board.assets[node.assetId!] && (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => setFrameVideo(node.assetId!)}
                >
                  截取视频帧
                </button>
              )}
            {node.type === "image" &&
              editable &&
              board.assets[node.assetId!] && (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() =>
                    setImageTools({
                      id: node.assetId!,
                      name: board.assets[node.assetId!].filename,
                      nodeId: node.id,
                    })
                  }
                >
                  图片工具
                </button>
              )}
            {board.receipts?.[node.id]?.request && (
              <button
                type="button"
                onClick={() => setReceipt(board.receipts[node.id])}
              >
                生成参数
              </button>
            )}
            <label>
              宽度
              <CanvasWidthInput
                key={node.id}
                width={node.width}
                disabled={locked}
                onChange={(w) => {
                  updateNode({
                    width: w,
                    height:
                      node.type !== "note"
                        ? Math.max(
                            60,
                            Math.min(2000, (node.height * w) / node.width),
                          )
                        : node.height,
                  });
                }}
              />
            </label>
            <button
              aria-label="从画布移除所选内容"
              title="从画布移除，保留原素材"
              disabled={locked}
              onClick={() => {
                change({
                  ...view,
                  nodes: view.nodes.filter((n) => n.id !== selected),
                });
                setSelected("");
              }}
            >
              <TrashIcon size={18} />
            </button>
          </div>
        )}
        <div className="canvas-zoom">
          <button
            aria-label="缩小画布"
            disabled={draft.blocked}
            onClick={() => zoom(0.8)}
          >
            <MinusIcon />
          </button>
          <span>{Math.round(view.viewport.zoom * 100)}%</span>
          <button
            aria-label="放大画布"
            disabled={draft.blocked}
            onClick={() => zoom(1.25)}
          >
            <PlusIcon />
          </button>
          <button aria-label="适应画布" disabled={draft.blocked} onClick={fit}>
            <ArrowsOutIcon />
          </button>
          <InfoTip label="画布操作帮助">
            拖动空白处平移，选中图片后拖动排布；方向键微调，Shift +
            方向键移动10像素。
          </InfoTip>
        </div>
      </div>
      {canGenerate && (
        <section className="canvas-composer">
          {imageMode &&
            usedImageNodes.map((reference) => (
              <div className="canvas-reference" key={reference.id}>
                <img
                  src={
                    "/api/v1" +
                    c.base +
                    "/assets/" +
                    reference.assetId +
                    "/thumbnail"
                  }
                  alt="参考图片"
                />
                <span>{board.assets[reference.assetId!].filename}</span>
                <button
                  type="button"
                  onClick={() => {
                    if (selected === reference.id) setSelected("");
                    setExtraNodes(
                      extraNodes.filter((id) => id !== reference.id),
                    );
                  }}
                >
                  取消参考
                </button>
              </div>
            ))}
          {imageMode && activeRegion && (
            <button
              type="button"
              disabled={locked}
              onClick={() => setRegionEdit(undefined)}
            >
              清除选区
            </button>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createAction.run(() => send());
            }}
          >
            <textarea
              ref={composerInput}
              aria-label={
                imageMode
                  ? usedImageNodes.length
                    ? "参考改图要求"
                    : "图片生成要求"
                  : "视频生成要求"
              }
              placeholder={
                imageMode
                  ? usedImageNodes.length
                    ? "描述如何修改图片"
                    : "描述想生成的图片"
                  : "描述视频内容和镜头运动"
              }
              value={prompt}
              maxLength={2000}
              disabled={createAction.busy || uncertain || draft.blocked}
              onChange={(e) =>
                imageMode
                  ? setInstruction(e.target.value)
                  : setVideoPrompt(e.target.value)
              }
            />
            <div className="canvas-compose-actions">
              <DropdownSelect
                aria-label="创作类型"
                value={mode}
                disabled={locked}
                onChange={(e) => setMode(e.target.value as MediaMode)}
              >
                <option value="image">图片生成</option>
                <option value="video">视频生成</option>
              </DropdownSelect>
              <MediaOptions
                mode={mode}
                preserveSize={imageMode && !!activeRegion}
                picture={effectivePicture}
                clip={effectiveClip}
                hasFrame={!!frame}
                disabled={locked}
                onPicture={setPicture}
                onClip={setClip}
              />
              {imageMode ? (
                <DropdownSelect
                  aria-label="添加画布参考图"
                  value=""
                  disabled={
                    locked ||
                    usedImageNodes.length >=
                      c.meta.model.imageOptions.maxReferences
                  }
                  onChange={(event) =>
                    setExtraNodes([...extraNodes, event.target.value])
                  }
                >
                  <option value="">添加画布参考图</option>
                  {imageNodes
                    .filter(
                      (n) =>
                        !usedImageNodes.some((r) => r.assetId === n.assetId),
                    )
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {board.assets[n.assetId!].filename}
                      </option>
                    ))}
                </DropdownSelect>
              ) : (
                <DropdownSelect
                  aria-label="视频首帧"
                  value={frame?.id ?? ""}
                  disabled={locked}
                  onChange={(event) => {
                    setFrameId(event.target.value || undefined);
                    setClip({
                      ...clip,
                      ratio: event.target.value ? "adaptive" : "16:9",
                    });
                  }}
                >
                  <option value="">无首帧</option>
                  {imageNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {board.assets[n.assetId!].filename}
                    </option>
                  ))}
                </DropdownSelect>
              )}
              <EntitySelect<{
                id: string;
                name: string;
                publishedVersion?: number;
              }>
                label="品牌规范"
                path={c.base + "/documents/brand"}
                value={brand?.id ?? ""}
                selectedPath={
                  brand
                    ? c.base +
                      "/document/" +
                      brand.id +
                      "?version=" +
                      brand.version
                    : null
                }
                format={(item) => item.name}
                filter={(item) => !!item.publishedVersion}
                emptyLabel="沿用项目品牌"
                disabled={locked}
                onChange={(_, item) =>
                  setBrand(
                    item?.publishedVersion
                      ? { id: item.id, version: item.publishedVersion }
                      : undefined,
                  )
                }
              />
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  draft.change({
                    ...view,
                    recipe: {
                      mode,
                      picture: {
                        ratio: effectivePicture.ratio,
                        resolution: effectivePicture.resolution,
                        candidates: effectivePicture.candidates,
                        prompt: instruction,
                        nodes: usedImageNodes.map((n) => n.id),
                        ...(activeRegion ? { region: activeRegion } : {}),
                        brand,
                      },
                      video: {
                        prompt: videoPrompt,
                        options: effectiveClip,
                        node: frame?.id,
                      },
                    },
                  });
                }}
              >
                保存设置
              </button>
              <button
                type="submit"
                className="primary"
                disabled={
                  !prompt.trim() ||
                  !modelReady ||
                  locked ||
                  uncertain ||
                  running.length > 0 ||
                  view.nodes.length >= 100
                }
              >
                <ArrowUpIcon size={18} aria-hidden="true" />
                {createAction.busy
                  ? "提交中…"
                  : !imageMode
                    ? "生成视频"
                    : usedImageNodes.length
                      ? "参考改图"
                      : "生成图片"}
              </button>
            </div>
          </form>
          {!modelReady && <p className="canvas-model-status" role="status">{c.isTenantAdmin ? <>当前模式的模型未配置 · <a href={c.adminUrl + "?tab=services#enterprise-models"}>配置模型</a></> : "当前模式的模型未配置，请联系企业管理员"}</p>}
          {uncertain && (
            <div role="alert">
              提交结果尚未确认，请核对原提交，避免重复费用。
              <button
                disabled={createAction.busy}
                onClick={() => void createAction.run(() => send(true))}
              >
                恢复原提交
              </button>
            </div>
          )}
          {batches.error && <Notice text={batches.error} />}
          {batches.data?.items[0]?.items.some(
            (i: any) => i.status === "failed",
          ) && (
            <div role="alert">
              上次生成失败。
              <button
                onClick={() =>
                  setInstruction(
                    batches.data.items[0].snapshot.request.instruction,
                  )
                }
              >
                填入上次需求
              </button>
            </div>
          )}
          {running.map((i: any) => (
            <div key={i.id} role="status">
              {status(i.status)}
              {i.status === "queued" && (
                <button
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await api.post(c.base + "/items/" + i.id + "/cancel", {});
                      await Promise.all([batches.reload(), draft.refresh()]);
                    })
                  }
                >
                  取消生成
                </button>
              )}
              {i.status === "needs_reconciliation" &&
                "，请联系企业管理员核对原请求与费用。"}
            </div>
          ))}
        </section>
      )}
      {imageTools && (
        <ImageToolsDialog
          image={imageTools}
          projectId={board.projectId}
          onClose={() => setImageTools(null)}
          onSaved={async (asset) => {
            await importImage(asset.id, imageTools.nodeId);
            setImageTools(null);
          }}
        />
      )}
      {regionNode && board.assets[regionNode.assetId!] && (
        <ImageRegionDialog
          image={{
            url: "/api/v1" + c.base + "/assets/" + regionNode.assetId + "/file",
            name: board.assets[regionNode.assetId!].filename,
          }}
          initialRegion={
            regionEdit?.assetId === regionNode.assetId
              ? regionEdit?.region
              : undefined
          }
          onClose={() => setRegionNode(null)}
          onSelect={(region) => {
            setMode("image");
            setSelected(regionNode.id);
            setExtraNodes([]);
            setRegionEdit({ assetId: regionNode.assetId!, region });
            setRegionNode(null);
          }}
        />
      )}
      {frameVideo && (
        <VideoFrameDialog
          assetId={frameVideo}
          projectId={board.projectId}
          onClose={() => setFrameVideo(null)}
          onSaved={async (asset) => {
            await importImage(asset.id);
            setFrameVideo(null);
          }}
        />
      )}
      <Dialog
        open={!!receipt}
        title="生成参数"
        onClose={() => setReceipt(null)}
      >
        {receipt && (
          <div className="form-panel">
            <p>{receipt.model}</p>
            <p>{receipt.request.instruction}</p>
            <p>
              {[
                receipt.request.video?.ratio ??
                  receipt.request.ratio ??
                  legacyRatios[receipt.request.size],
                receipt.request.video?.resolution ?? receipt.request.resolution,
                receipt.request.video?.duration &&
                  receipt.request.video.duration + " 秒",
                receipt.request.candidates &&
                  receipt.request.candidates + " 张",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {canGenerate && (
              <button
                type="button"
                onClick={() => {
                  const request = receipt.request;
                  const ids =
                    request.referenceAssetIds ??
                    (request.referenceAssetId
                      ? [request.referenceAssetId]
                      : []);
                  const sources = ids
                    .map(
                      (id: string) =>
                        imageNodes.find((n) => n.assetId === id)?.id,
                    )
                    .filter(Boolean);
                  if (request.mode === "video") {
                    setMode("video");
                    setVideoPrompt(request.instruction);
                    setClip(request.video);
                    setFrameId(sources[0]);
                  } else {
                    setMode("image");
                    setInstruction(request.instruction);
                    setPicture({
                      ratio:
                        request.ratio ?? legacyRatios[request.size] ?? "1:1",
                      resolution: request.resolution ?? "2K",
                      candidates: request.candidates ?? 1,
                    });
                    setSelected(sources[0] ?? "");
                    setRegionEdit(
                      request.region && ids[0]
                        ? { assetId: ids[0], region: request.region }
                        : undefined,
                    );
                    setExtraNodes(sources.slice(1));
                  }
                  setBrand(request.brand);
                  setReceipt(null);
                }}
              >
                复用参数
              </button>
            )}
          </div>
        )}
      </Dialog>
      <Dialog
        open={assetsOpen}
        title="添加图片"
        size="large"
        onClose={() => !action.busy && setAssetsOpen(false)}
      >
        <div className="canvas-asset-scopes">
          <button
            aria-pressed={assetScope === "project"}
            onClick={() => {
              setAssetScope("project");
              setAssetPage(1);
            }}
          >
            当前项目
          </button>
          <button
            aria-pressed={assetScope === "shared"}
            onClick={() => {
              setAssetScope("shared");
              setAssetPage(1);
            }}
          >
            企业资产
          </button>
          <FileInput
            compact
            label="上传本地图片"
            onUpload={async (filename, data) => {
              const asset = await api.post<any>(c.base + "/assets", {
                filename,
                data,
                projectId: board.projectId,
              });
              await importImage(asset.id);
            }}
          />
        </div>
        <form
          className="content-asset-filters"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setAssetQuery(assetSearch.trim());
            setAssetPage(1);
          }}
        >
          <input
            type="search"
            aria-label="搜索图片名称"
            placeholder="搜索图片名称"
            maxLength={100}
            value={assetSearch}
            onChange={(event) => {
              setAssetSearch(event.target.value);
              if (!event.target.value) {
                setAssetQuery("");
                setAssetPage(1);
              }
            }}
          />
          <button type="submit">搜索</button>
        </form>
        <Result result={assetRows}>
          <div className="canvas-asset-grid">
            {assetRows.data?.items.map((a: any) => (
              <button
                key={a.id}
                disabled={action.busy}
                onClick={() => void action.run(() => importImage(a.id))}
              >
                <img
                  src={"/api/v1" + c.base + "/assets/" + a.id + "/thumbnail"}
                  alt=""
                />
                <span>{a.filename}</span>
              </button>
            ))}
          </div>
          {assetRows.data?.total === 0 && (
            <p>{assetQuery ? "没有匹配的图片" : "暂无可选图片"}</p>
          )}
          <Pager result={assetRows} page={assetPage} setPage={setAssetPage} />
        </Result>
        <Notice text={action.error} />
      </Dialog>
      <Dialog
        open={renameOpen}
        title="重命名画布"
        onClose={() => !action.busy && setRenameOpen(false)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await draft.flush();
              await api.put(c.base + "/projects/" + board.projectId, {
                ...{
                  name: name.trim(),
                  version: board.project.version,
                  brief: board.project.brief,
                  visibility: board.project.visibility,
                  participants: board.project.participants,
                },
              });
              await draft.refresh();
              window.dispatchEvent(new Event("content-projects-changed"));
              setRenameOpen(false);
            });
          }}
        >
          <Field label="画布名称">
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Notice text={action.error} />
          <button className="primary" disabled={action.busy || !name.trim()}>
            保存名称
          </button>
        </form>
      </Dialog>
      <ConfirmDialog
        open={discardOpen}
        title="重新载入画布？"
        description="将放弃本页面尚未保存的排布与备注，载入服务器最新内容。"
        confirmLabel="放弃修改并载入"
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() =>
          void action.run(async () => {
            await draft.discard();
            setDiscardOpen(false);
          })
        }
      />
      <ConfirmDialog
        open={archiveOpen}
        title="将画布移入回收站？"
        description="当前创作与画布将一同移入回收站，可在回收站恢复。进行中的生成会请求停止，已发生的模型费用仍需结算。"
        confirmLabel="移入回收站"
        onCancel={() => setArchiveOpen(false)}
        onConfirm={() =>
          void action.run(async () => {
            await draft.flush();
            await api.del(c.base + "/projects/" + board.projectId);
            window.dispatchEvent(new Event("content-projects-changed"));
            nav(c.prefix + (fromAssetLibrary ? "/assets/canvases" : "/canvas"));
          })
        }
      />
      {unsaved}
    </div>
  );
}
