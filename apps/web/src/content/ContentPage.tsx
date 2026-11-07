import { PlayCircleIcon } from "@phosphor-icons/react";
import { mediaActive, type MediaMode } from "./MediaOptions";
import {
  Context,
  usePagedCollection,
  useContent,
  useAction,
  useDirty,
  Result,
  Pager,
  assetDownloadName,
  FileInput,
  status,
  key,
} from "./content-ui";
import { ArtworkPreview } from "./ArtworkPreview";
import { ArtifactEditor } from "./ArtifactEditor";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Routes,
  Route,
  Link,
  Navigate,
  useParams,
  useNavigate,
  useLocation,
  useBlocker,
} from "react-router-dom";
import { api, tenantApi, errorText } from "../api";
import { useApiData } from "../hooks";
import {
  RecordActions,
  PageTitle,
  Field,
  Notice,
  Empty,
  Loading,
  Dialog,
  DialogAction,
  ConfirmDialog,
  DataResult,
  EntitySelect,
  ChoiceSelect,
} from "../components";
import "./content.css";
import { ContentExplore, CreationStudio } from "./CreationStudio";
import { CanvasList, ContentCanvas, putImageOnCanvas } from "./ContentCanvas";
import { saveReferenceDraft } from "./ReferenceAttachment";
import { VideoFrameDialog } from "./VideoFrameDialog";
import { ImageToolsDialog } from "./ImageToolsDialog";
import { InfoTip } from "@suite/frontend/components";
import {
  AssetLibraryHeader,
  LibrarySearchActions,
  LibraryTimeSort,
} from "./AssetLibraryHeader";
function DocPicker({
  kind,
  value,
  onChange,
  label,
  selectedLabel,
  required = true,
  selectedVersion,
}: {
  kind: string;
  value: string;
  onChange: (d: any) => void;
  label: string;
  selectedLabel?: string;
  required?: boolean;
  selectedVersion?: number;
}) {
  const c = useContent();
  return (
    <EntitySelect<any>
      label={label}
      required={required}
      filter={kind === "brand" ? (d) => !!d.publishedVersion : undefined}
      value={value}
      selectedLabel={selectedLabel}
      selectedPath={
        value
          ? c.base +
            "/document/" +
            value +
            (selectedVersion ? "?version=" + selectedVersion : "")
          : null
      }
      path={c.base + "/documents/" + kind}
      format={(d) =>
        d.name +
        (kind === "brand"
          ? " · " +
            (d.publishedVersion ? "已发布 v" + d.publishedVersion : "未发布")
          : " · v" + d.version)
      }
      onChange={(_, d) => onChange(d)}
    />
  );
}
export function ContentPage({
  tenantKey,
  isTenantAdmin = false,
}: {
  tenantKey: string;
  permissions: readonly string[];
  isTenantAdmin?: boolean;
}) {
  const base = tenantApi(tenantKey, "/apps/content"),
    meta = useApiData<any>(base + "/metadata");
  return (
    <Context.Provider
      value={{
        base,
        isTenantAdmin,
        adminUrl: `${import.meta.env.VITE_TENANT_ADMIN_URL ?? 'http://127.0.0.1:4603'}/t/${encodeURIComponent(tenantKey)}`,
        prefix: `/t/${tenantKey}/content`,
        meta: meta.data,
        reload: meta.reload,
      }}
    >
      <div className="brand-content">
        <Result result={meta}>
          {meta.data && (
            <Routes>
              <Route index element={<CreationStudio />} />
              <Route path="canvases" element={<LegacyCanvasList />} />
              <Route path="canvases/:id" element={<ContentCanvas />} />
              <Route path="projects/:id" element={<ProjectEntry />} />
              <Route path="projects/:id/manage" element={<Project />} />
              <Route path="explore" element={<ContentExplore />} />
              <Route path="brands" element={<Documents kind="brand" />} />
              <Route path="products" element={<Documents kind="product" />} />
              <Route path="assets" element={<Assets />} />
              <Route path="assets/canvases" element={<CanvasList />} />
              <Route path="templates" element={<Templates />} />
              <Route path="settings" element={<Settings />} />
              <Route path="reviews" element={<Reviews />} />
              <Route path="trash" element={<Trash />} />
              <Route path="ai" element={<CreationStudio />} />
              <Route path="*" element={<Empty text="页面不存在" />} />
            </Routes>
          )}
        </Result>
      </div>
    </Context.Provider>
  );
}
const freshBrief = {
  brandId: "",
  brandVersion: 1,
  productIds: [] as string[],
  productVersions: {} as Record<string, number>,
  prompt: "",
  audience: "",
  channel: "",
  title: "",
  cta: "了解更多",
  template: "hero",
  sizes: ["square", "portrait", "story"],
  variants: 1,
  disclaimer: "",
};
function ProjectForm({
  open,
  onClose,
  project,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  project?: any;
  onSaved?: () => Promise<unknown>;
}) {
  const c = useContent(),
    nav = useNavigate(),
    a = useAction();
  const [name, setName] = useState(""),
    [brief, setBrief] = useState<any>(freshBrief),
    [product, setProduct] = useState<any>(null),
    [names, setNames] = useState<Record<string, string>>({}),
    [visibility, setVisibility] = useState("private"),
    [participants, setParticipants] = useState("");
  const [member, setMember] = useState("");
  const collaborators = useApiData<any>(
    open ? c.base + "/collaborators" : null,
  );
  useEffect(() => {
    if (open) {
      setName(project?.name ?? "");
      setBrief(project?.brief ?? { ...freshBrief });
      setVisibility(project?.visibility ?? "private");
      setParticipants((project?.participants ?? []).join("\n"));
      setProduct(null);
    }
  }, [open, project]);
  const change = (k: string, v: any) =>
    setBrief((b: any) => ({ ...b, [k]: v }));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={project ? "项目需求" : "新建创作项目"}
      busy={a.busy}
      dirtyCheck
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(async () => {
            const r: any = await api[project ? "put" : "post"](
              c.base + "/projects" + (project ? "/" + project.id : ""),
              {
                name,
                brief,
                visibility,
                participants: participants.split(/[\s,]+/).filter(Boolean),
                ...(project ? { version: project.version } : {}),
              },
            );
            onClose();
            if (onSaved) await onSaved();
            else nav(c.prefix + "/projects/" + r.id);
          });
        }}
      >
        <Field label="项目名称">
          <input
            required
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <DocPicker
          kind="brand"
          label="品牌规范"
          selectedVersion={brief.brandVersion}
          value={brief.brandId}
          onChange={(d) => {
            if (!d) return;
            if (!d.publishedVersion) return;
            setBrief((b: any) => ({
              ...b,
              brandId: d.id,
              brandVersion: d.publishedVersion,
            }));
          }}
        />
        {brief.brandVersion && <small>品牌规范 v{brief.brandVersion}</small>}
        <DocPicker
          kind="product"
          label="添加产品"
          required={false}
          value={product?.id ?? ""}
          onChange={(d) => {
            setProduct(d);
            if (d) {
              setNames((n) => ({ ...n, [d.id]: d.name }));
              setBrief((b: any) => ({
                ...b,
                productIds: [...new Set([...b.productIds, d.id])],
                productVersions: { ...b.productVersions, [d.id]: d.version },
              }));
            }
          }}
        />
        <div className="content-chips">
          {brief.productIds.map((p: string) => (
            <button
              type="button"
              key={p}
              onClick={() =>
                change(
                  "productIds",
                  brief.productIds.filter((x: string) => x !== p),
                )
              }
            >
              {names[p] ?? "产品"} v{brief.productVersions[p]} ×
            </button>
          ))}
        </div>
        <Field label="创作需求">
          <textarea
            required
            value={brief.prompt}
            maxLength={2000}
            placeholder="例如：新品上市，清爽自然的桌面场景"
            onChange={(e) => change("prompt", e.target.value)}
          />
        </Field>
        <div className="form-grid">
          <Field label="受众">
            <input
              value={brief.audience}
              onChange={(e) => change("audience", e.target.value)}
            />
          </Field>
          <Field label="渠道">
            <input
              value={brief.channel}
              onChange={(e) => change("channel", e.target.value)}
            />
          </Field>
          <Field label="标题（留空使用产品名）">
            <input
              value={brief.title}
              onChange={(e) => change("title", e.target.value)}
            />
          </Field>
          <Field label="行动语">
            <input
              value={brief.cta}
              onChange={(e) => change("cta", e.target.value)}
            />
          </Field>
        </div>
        <ChoiceSelect
          label="版式"
          value={brief.template}
          onChange={(e) => change("template", e.target.value)}
        >
          {["hero", "split", "minimal"].map((t) => (
            <option key={t} value={t}>
              {status(t)}
            </option>
          ))}
        </ChoiceSelect>
        <DocPicker
          kind="template"
          label="企业模板（可选）"
          required={false}
          value={brief.templateId ?? ""}
          onChange={(d) =>
            setBrief((b: any) => ({
              ...b,
              templateId: d?.id,
              templateVersion: d?.version,
            }))
          }
        />
        <fieldset className="content-sizes">
          <legend>交付尺寸</legend>
          {["square", "portrait", "story"].map((s) => (
            <label key={s}>
              <input
                type="checkbox"
                checked={brief.sizes.includes(s)}
                onChange={(e) =>
                  change(
                    "sizes",
                    e.target.checked
                      ? [...brief.sizes, s]
                      : brief.sizes.filter((x: string) => x !== s),
                  )
                }
              />
              {status(s)}
            </label>
          ))}
        </fieldset>
        <Field label="每个产品的创意变体数">
          <input
            type="number"
            min={1}
            max={3}
            value={brief.variants}
            onChange={(e) => change("variants", Number(e.target.value))}
          />
        </Field>
        <ChoiceSelect
          label="共享范围"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
        >
          <option value="private">仅负责人和指定参与人</option>
          <option value="tenant">企业有权成员</option>
        </ChoiceSelect>
        {visibility === "private" && (
          <>
            <EntitySelect<any>
              label="添加参与人"
              path={c.base + "/collaborators"}
              value={member}
              required={false}
              format={(m) => m.name}
              onChange={(id, m) => {
                setMember(id);
                if (m)
                  setParticipants((s) =>
                    [
                      ...new Set([...s.split(/[\s,]+/).filter(Boolean), id]),
                    ].join("\n"),
                  );
              }}
            />
            <div className="content-chips">
              {participants
                .split(/[\s,]+/)
                .filter(Boolean)
                .map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() =>
                      setParticipants((s) =>
                        s
                          .split(/[\s,]+/)
                          .filter((x) => x && x !== id)
                          .join("\n"),
                      )
                    }
                  >
                    {collaborators.data?.items?.find((x: any) => x.id === id)
                      ?.name ?? "已选参与人"}{" "}
                    ×
                  </button>
                ))}
            </div>
          </>
        )}
        <Notice text={a.error} />
        <DialogAction>
          <button
            className="primary"
            disabled={
              a.busy ||
              !brief.brandId ||
              brief.productIds.length === 0 ||
              brief.sizes.length === 0
            }
          >
            {a.busy ? "保存中…" : "保存项目"}
          </button>
        </DialogAction>
      </form>
    </Dialog>
  );
}
function Documents({ kind }: { kind: "brand" | "product" }) {
  const c = useContent(),
    [page, setPage] = useState(1),
    [q, setQ] = useState(""),
    [editing, setEditing] = useState<any>(undefined);
  const r = useApiData<any>(
      c.base + `/documents/${kind}?page=${page}&q=${encodeURIComponent(q)}`,
    ),
    a = useAction(),
    navigate = useNavigate();
  const writable = c.meta.permissions.includes(
    kind === "brand" ? "content.manage" : "content.create",
  );
  const canReference =
    writable && c.meta.permissions.includes("content.ai.use");
  return (
    <>
      <PageTitle
        title={kind === "brand" ? "品牌中心" : "主体"}
        action={
          <>
            {kind === "product" && (
              <Link to={c.prefix + "/brands"}>品牌中心</Link>
            )}
            {writable && (
              <button className="primary" onClick={() => setEditing(null)}>
                新建{kind === "brand" ? "品牌" : "主体"}
              </button>
            )}
          </>
        }
      />
      <input
        type="search"
        aria-label={kind === "brand" ? "搜索品牌" : "搜索主体"}
        placeholder={kind === "brand" ? "搜索品牌" : "搜索主体"}
        maxLength={100}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
      />
      <Notice text={a.error} />
      <Result result={r}>
        <div className="content-grid">
          {r.data?.items.map((d: any) => (
            <article className="panel content-document" key={d.id}>
              {(d.data.imageId || d.data.logoId) && (
                <img
                  src={
                    "/api/v1" +
                    c.base +
                    "/assets/" +
                    (d.data.imageId || d.data.logoId) +
                    "/file"
                  }
                  alt={d.name}
                />
              )}
              <h2>{d.name}</h2>
              <p>{kind === "brand" ? d.data.tone : d.data.sellingPoints}</p>
              {kind === "brand" && (
                <small>
                  v{d.version} ·{" "}
                  {d.publishedVersion
                    ? d.publishedVersion === d.version
                      ? "已发布"
                      : "已发布 v" + d.publishedVersion
                    : "未发布"}
                </small>
              )}
              <RecordActions>
                {kind === "product" && d.data.imageId && canReference && (
                  <button
                    disabled={a.busy}
                    onClick={() =>
                      void a.run(async () => {
                        const id = d.data.imageId;
                        saveReferenceDraft(c.prefix, c.meta.membershipId, {
                          id,
                          name: d.name,
                          preview:
                            "/api/v1" + c.base + "/assets/" + id + "/thumbnail",
                        });
                        navigate(c.prefix);
                      })
                    }
                  >
                    用作参考图
                  </button>
                )}
                {writable && (
                  <button onClick={() => setEditing(d)}>编辑</button>
                )}
                {kind === "brand" &&
                  writable &&
                  d.publishedVersion !== d.version && (
                    <button
                      disabled={a.busy}
                      onClick={() =>
                        void a.run(async () => {
                          await api.post(
                            c.base + "/document/" + d.id + "/publish",
                            { version: d.version },
                          );
                          await r.reload();
                        })
                      }
                    >
                      发布规范
                    </button>
                  )}
              </RecordActions>
            </article>
          ))}
        </div>
        {r.data?.items.length === 0 && (
          <Empty text={kind === "brand" ? "暂无品牌" : "暂无主体"} />
        )}
        <Pager result={r} page={page} setPage={setPage} />
      </Result>
      <DocumentForm
        kind={kind}
        open={editing !== undefined}
        document={editing}
        onClose={() => setEditing(undefined)}
        onSaved={r.reload}
      />
    </>
  );
}
const blankData = {
  color: "#6153cc",
  font: "sans",
  tone: "",
  forbiddenWords: [],
  sellingPoints: "",
  parameters: "",
  price: "",
  validUntil: "",
  disclaimer: "",
  template: "hero",
};
function DocumentForm({
  kind,
  open,
  document,
  onClose,
  onSaved,
  sourceImage,
}: {
  kind: string;
  open: boolean;
  document: any;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
  sourceImage?: { id: string; filename: string };
}) {
  const c = useContent(),
    a = useAction(),
    [name, setName] = useState(""),
    [data, setData] = useState<any>(blankData);
  useEffect(() => {
    if (open) {
      setName(
        document?.name ??
          sourceImage?.filename.replace(/\.[^.]+$/, "").slice(0, 120) ??
          "",
      );
      const { name: _, ...fields } = document?.data ?? blankData;
      setData(sourceImage ? { ...fields, imageId: sourceImage.id } : fields);
    }
  }, [open, document, sourceImage]);
  const field = (k: string, label: string, multi = false) => (
    <Field label={label} key={k}>
      {multi ? (
        <textarea
          maxLength={2000}
          value={data[k] ?? ""}
          onChange={(e) => setData((d: any) => ({ ...d, [k]: e.target.value }))}
        />
      ) : (
        <input
          maxLength={k === "price" || k === "validUntil" ? 80 : 120}
          value={data[k] ?? ""}
          onChange={(e) => setData((d: any) => ({ ...d, [k]: e.target.value }))}
        />
      )}
    </Field>
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        (document ? "编辑" : "新建") + (kind === "brand" ? "品牌" : "主体")
      }
      busy={a.busy}
      dirtyCheck
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(async () => {
            await api[document ? "put" : "post"](
              c.base +
                "/documents/" +
                kind +
                (document ? "/" + document.id : ""),
              {
                name,
                data,
                ...(document ? { version: document.version } : {}),
              },
            );
            await onSaved();
            onClose();
          });
        }}
      >
        <Field label="名称">
          <input
            required
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {kind === "brand" ? (
          <>
            <Field label="品牌色">
              <input
                type="color"
                value={data.color}
                onChange={(e) =>
                  setData((d: any) => ({ ...d, color: e.target.value }))
                }
              />
            </Field>
            {field("tone", "品牌语气与视觉风格", true)}
            <Field label="禁用词（每行一个）">
              <textarea
                value={data.forbiddenWords.join("\n")}
                onChange={(e) =>
                  setData((d: any) => ({
                    ...d,
                    forbiddenWords: e.target.value.split("\n").filter(Boolean),
                  }))
                }
              />
            </Field>
          </>
        ) : null}
        {kind === "product" && open && (
          <EntitySelect<{ id: string; filename: string }>
            label="选择企业图片"
            path={c.base + "/assets?media=image"}
            value={data.imageId ?? ""}
            selectedLabel={
              data.imageId === sourceImage?.id
                ? sourceImage?.filename
                : undefined
            }
            format={(asset) => asset.filename}
            onChange={(id) =>
              setData((previous: any) => ({
                ...previous,
                imageId: id || undefined,
              }))
            }
          />
        )}
        <FileInput
          label={kind === "brand" ? "上传Logo" : "上传参考图片"}
          onUpload={async (filename, b64) => {
            const r: any = await api.post(c.base + "/assets", {
              filename,
              data: b64,
              shared: true,
            });
            setData((d: any) => ({
              ...d,
              [kind === "brand" ? "logoId" : "imageId"]: r.id,
            }));
          }}
        />
        {(data.logoId || data.imageId) && (
          <img
            className="content-upload-preview"
            src={
              "/api/v1" +
              c.base +
              "/assets/" +
              (data.logoId || data.imageId) +
              "/file"
            }
            alt="当前参考图片"
          />
        )}
        {kind === "product" && (
          <details className="content-subject-details">
            <summary>产品信息</summary>
            {field("sellingPoints", "已核对卖点", true)}
            {field("parameters", "产品参数", true)}
            {field("price", "价格表述")}
            {field("validUntil", "活动有效期")}
            {field("disclaimer", "必要声明", true)}
          </details>
        )}
        <Notice text={a.error} />
        <DialogAction>
          <button className="primary" disabled={a.busy}>
            {a.busy
              ? "保存中…"
              : document
                ? "保存新版本"
                : kind === "brand"
                  ? "创建品牌"
                  : "创建主体"}
          </button>
        </DialogAction>
      </form>
    </Dialog>
  );
}
function ProjectEntry() {
  const query = new URLSearchParams(useLocation().search);
  // Preserve existing review/version deep links; ordinary creation always opens the studio.
  return query.has("artifact") || query.has("version") ? (
    <Project />
  ) : (
    <CreationStudio />
  );
}
function Project() {
  const { id = "" } = useParams();
  return <ProjectScreen key={id} />;
}
function ProjectScreen() {
  const { id = "" } = useParams(),
    c = useContent(),
    a = useAction();
  const [artQuery, setArtQuery] = useState("");
  const [artPage, setArtPage] = useState(1),
    [batchPage, setBatchPage] = useState(1),
    [exportPage, setExportPage] = useState(1);
  const p = useApiData<any>(c.base + "/projects/" + id),
    arts = usePagedCollection<any>(
      c.base +
        "/projects/" +
        id +
        "/artifacts?q=" +
        encodeURIComponent(artQuery),
      artPage,
    ),
    batches = usePagedCollection<any>(
      c.base + "/projects/" + id + "/batches",
      batchPage,
    ),
    exports = usePagedCollection<any>(
      c.base + "/projects/" + id + "/exports",
      exportPage,
    );
  const [selected, setSelected] = useState(
      new URLSearchParams(window.location.search).get("artifact") ?? "",
    ),
    [revision, setRevision] = useState<number | undefined>(
      Number(new URLSearchParams(window.location.search).get("version")) ||
        undefined,
    ),
    [projectForm, setProjectForm] = useState(false),
    [preview, setPreview] = useState<any>(null),
    [chosen, setChosen] = useState<Record<string, number>>({}),
    [draft, setDraft] = useState(false),
    [format, setFormat] = useState("png"),
    [tab, setTab] = useState("artworks"),
    [trashConfirm, setTrashConfirm] = useState(false),
    [download, setDownload] = useState("");
  const preparePreview = (v: any) =>
    setPreview({ ...v, clientRequestKey: key() });
  const nav = useNavigate();
  const [reconcile, setReconcile] = useState<any>(null);
  const [reconcileData, setReconcileData] = useState({
    outcome: "not_charged",
    cost: "0",
    billReference: "",
    note: "",
  });
  const canCreate = c.meta.permissions.includes("content.create");
  const reload = async () => {
    await Promise.all([
      p.reload(),
      arts.reload(),
      batches.reload(),
      exports.reload(),
    ]);
  };
  const pending =
    exports.data?.some((e) => ["queued", "preparing"].includes(e.status)) ||
    batches.data?.some((b) =>
      b.items.some((i: any) => mediaActive.includes(i.status)),
    );
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(
      () =>
        void Promise.all([batches.reload(), arts.reload(), exports.reload()]),
      3000,
    );
    return () => clearInterval(timer);
  }, [pending, batches.reload, arts.reload, exports.reload]);
  const selectedArtifact = useApiData<any>(
    selected && !arts.data?.some((x) => x.id === selected)
      ? c.base + "/artifacts/" + selected
      : null,
  );
  const art = selected
    ? (arts.data?.find((x) => x.id === selected) ??
      (selectedArtifact.data?.projectId === id
        ? selectedArtifact.data
        : undefined))
    : arts.data?.[0];
  const historical = useApiData<any>(
    art &&
      revision !== undefined &&
      !art.versions.some((v: any) => v.version === revision)
      ? c.base + "/artifacts/" + art.id + "/versions/" + revision
      : null,
  );
  const current =
    revision === undefined
      ? art?.versions[0]
      : (art?.versions.find((v: any) => v.version === revision) ??
        historical.data);
  useEffect(() => {
    if (art && revision === undefined) setRevision(art.versions[0]?.version);
  }, [art?.id, revision]);
  const selectedCount = Object.keys(chosen).length;
  return (
    <>
      <PageTitle
        title={p.data?.name ?? "创作项目"}
        back={<Link to={c.prefix}>返回项目</Link>}
        action={
          <div className="content-actions">
            {canCreate && (
              <button disabled={a.busy} onClick={() => setProjectForm(true)}>
                需求
              </button>
            )}
            {canCreate && (
              <button
                className="primary"
                disabled={a.busy || !c.meta.model.configured || !p.data}
                onClick={() =>
                  void a.run(async () =>
                    preparePreview(
                      await api.post(c.base + "/projects/" + id + "/preview", {
                        projectVersion: p.data.version,
                        mode: "background",
                      }),
                    ),
                  )
                }
              >
                生成素材包
              </button>
            )}
          </div>
        }
      />
      <Notice text={a.error} />
      <Notice text={historical.error ?? selectedArtifact.error} />
      <Result result={p}>
        {p.data && (
          <>
            <div className="content-project-summary">
              <p>{p.data.brief.prompt}</p>
              <span>
                品牌规范 v{p.data.brief.brandVersion} ·{" "}
                {p.data.brief.productIds.length} 个产品 ·{" "}
                {p.data.brief.sizes.length} 种尺寸
              </span>
            </div>
            <div className="content-tabs" role="tablist" aria-label="项目内容">
              {[
                ["artworks", "作品"],
                ["tasks", "生成任务"],
                ["assets", "项目素材"],
                ["delivery", "交付"],
              ].map(([t, label]) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "artworks" && (
              <Field label="搜索作品">
                <input
                  maxLength={100}
                  value={artQuery}
                  onChange={(e) => {
                    setArtQuery(e.target.value);
                    setArtPage(1);
                    setSelected("");
                    setRevision(undefined);
                  }}
                />
              </Field>
            )}
            {tab === "artworks" && (
              <Pager
                result={arts.pagination}
                page={artPage}
                setPage={setArtPage}
              />
            )}
            {tab === "tasks" && (
              <Pager
                result={batches.pagination}
                page={batchPage}
                setPage={setBatchPage}
              />
            )}
            {tab === "delivery" && (
              <Pager
                result={exports.pagination}
                page={exportPage}
                setPage={setExportPage}
              />
            )}
            {tab === "artworks" && (
              <Result result={arts}>
                {art && current ? (
                  <div className="content-workbench">
                    <aside
                      className="content-filmstrip"
                      aria-label="作品与版本"
                    >
                      {arts.data?.map((x) => (
                        <div
                          className={
                            "content-film-item " +
                            (art.id === x.id ? "active" : "")
                          }
                          key={x.id}
                        >
                          <button
                            onClick={() => {
                              setSelected(x.id);
                              setRevision(undefined);
                            }}
                          >
                            <ArtworkPreview
                              data={x.versions[0].data}
                              artifactId={x.id}
                              thumbnail
                            />
                            <strong>{x.name}</strong>
                            <small>
                              {status(x.versions[0].status)} · v
                              {x.versions[0].version}
                            </small>
                          </button>
                          <label>
                            <input
                              type="checkbox"
                              aria-label={"选择交付 " + x.name}
                              checked={chosen[x.id] !== undefined}
                              onChange={(e) =>
                                setChosen((v) => {
                                  const next = { ...v };
                                  if (e.target.checked)
                                    next[x.id] = x.versions[0].version;
                                  else delete next[x.id];
                                  return next;
                                })
                              }
                            />
                            加入交付
                          </label>
                        </div>
                      ))}
                    </aside>
                    <ArtifactEditor
                      key={art.id + ":" + current.version}
                      artifact={art}
                      current={current}
                      project={p.data}
                      onSaved={async () => {
                        await arts.reload();
                      }}
                      onPreview={preparePreview}
                      onVersion={setRevision}
                    />
                  </div>
                ) : historical.loading || selectedArtifact.loading ? (
                  <Loading />
                ) : art ? (
                  <Notice text={historical.error ?? "无法读取所选作品版本"} />
                ) : (
                  <section className="panel content-empty-creation">
                    <Empty
                      text={
                        artQuery
                          ? "没有匹配的作品"
                          : "从品牌和产品资料开始创作，可先建立版式预览。"
                      }
                    />
                    {canCreate && !artQuery && (
                      <div className="content-actions">
                        <button
                          disabled={a.busy}
                          onClick={() =>
                            void a.run(async () => {
                              for (const productId of p.data.brief.productIds)
                                for (const size of p.data.brief.sizes)
                                  await api.post(
                                    c.base + "/projects/" + id + "/artifacts",
                                    {
                                      name: "产品素材 · " + status(size),
                                      productId,
                                      size,
                                    },
                                  );
                              await arts.reload();
                            })
                          }
                        >
                          建立图文版式
                        </button>
                      </div>
                    )}
                  </section>
                )}
              </Result>
            )}
            {tab === "tasks" && (
              <Result result={batches}>
                {batches.data?.length === 0 && <Empty text="还没有生成任务" />}
                {batches.data?.map((b) => (
                  <section className="panel" key={b.id}>
                    <h2>{new Date(b.createdAt).toLocaleString()}</h2>
                    {b.items.map((i: any) => (
                      <div className="content-task-row" key={i.id}>
                        <div>
                          <strong>{status(i.status)}</strong>
                          <p>
                            {i.errorCode ? "请核对原请求或处理失败步骤。" : ""}
                            {i.cancelRequested && i.status !== "cancelled"
                              ? "已请求停止；已提交的生成可能产生费用。"
                              : ""}
                          </p>
                          <small>{status(i.usage?.status ?? "reserved")}</small>
                          <details>
                            <summary>请求记录</summary>
                            <p>请求号：{i.attempt?.id ?? i.id}</p>
                            {i.attempt?.externalId && (
                              <p>方舟日志号：{i.attempt.externalId}</p>
                            )}
                            <small>
                              {i.attempt?.model ?? b.snapshot.model}
                            </small>
                          </details>
                        </div>
                        <RecordActions>
                          {canCreate && mediaActive.includes(i.status) && (
                            <button
                              disabled={a.busy}
                              onClick={() =>
                                void a.run(async () => {
                                  await api.post(
                                    c.base + "/items/" + i.id + "/cancel",
                                    {},
                                  );
                                  await batches.reload();
                                })
                              }
                            >
                              停止
                            </button>
                          )}
                          {canCreate && i.status === "failed" && (
                            <button
                              disabled={a.busy}
                              onClick={() =>
                                void a.run(async () => {
                                  await api.post(
                                    c.base + "/items/" + i.id + "/retry",
                                    { requestKey: key() },
                                  );
                                  await batches.reload();
                                })
                              }
                            >
                              重新生成此项
                            </button>
                          )}
                          {c.meta.permissions.includes("content.manage") &&
                            i.status === "needs_reconciliation" && (
                              <>
                                <button
                                  disabled={a.busy}
                                  onClick={() =>
                                    void a.run(async () => {
                                      await api.post(
                                        c.base + "/items/" + i.id + "/recover",
                                        {},
                                      );
                                      await reload();
                                    })
                                  }
                                >
                                  恢复已保存结果
                                </button>
                                <button
                                  disabled={a.busy}
                                  onClick={() => {
                                    setReconcile(i);
                                    setReconcileData({
                                      outcome: "not_charged",
                                      cost: "0",
                                      billReference: "",
                                      note: "",
                                    });
                                  }}
                                >
                                  登记核对结果
                                </button>
                              </>
                            )}
                        </RecordActions>
                      </div>
                    ))}
                  </section>
                ))}
              </Result>
            )}
            {tab === "assets" && <Assets projectId={id} embedded />}
            {tab === "delivery" && (
              <section className="panel">
                <h2 className="content-heading-with-info">
                  打包交付{" "}
                  <InfoTip label="交付包内容">
                    包含图片、文案、可编辑图层和审核清单。
                  </InfoTip>
                </h2>
                <p>已选 {selectedCount} 个作品版本</p>
                <div className="content-chips">
                  {Object.entries(chosen).map(([aid, v]) => (
                    <span key={aid}>
                      {arts.data?.find((x) => x.id === aid)?.name ?? "作品"} v
                      {v}
                    </span>
                  ))}
                </div>
                <ChoiceSelect
                  label="图片格式"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  <option value="png">PNG</option>
                  <option value="jpeg">JPEG</option>
                  <option value="transparent">透明PNG（不包含背景）</option>
                </ChoiceSelect>
                {canCreate && (
                  <label>
                    <input
                      type="checkbox"
                      checked={draft}
                      onChange={(e) => setDraft(e.target.checked)}
                    />
                    下载带标记的草稿预览
                  </label>
                )}
                <div className="content-actions">
                  <button
                    className="primary"
                    disabled={a.busy || !selectedCount}
                    onClick={() =>
                      void a.run(async () => {
                        const r: any = await api.post(
                          c.base + "/projects/" + id + "/exports",
                          {
                            requestKey: key(),
                            items: Object.entries(chosen).map(
                              ([artifactId, version]) => ({
                                artifactId,
                                version,
                              }),
                            ),
                            format,
                            draft,
                          },
                        );
                        setDownload(
                          r.status === "ready"
                            ? "/api/v1" + c.base + "/exports/" + r.id + "/file"
                            : "",
                        );
                        setExportPage(1);
                        await exports.reload();
                      })
                    }
                  >
                    {a.busy ? "提交中…" : "生成交付包"}
                  </button>
                  {download && (
                    <a className="button" href={download} download>
                      下载交付包
                    </a>
                  )}
                </div>
                <small>正式交付须为已批准或免审版本。</small>
                <Result result={exports}>
                  {exports.data?.map((e) => (
                    <div className="content-task-row" key={e.id}>
                      <span>
                        {new Date(e.createdAt).toLocaleString()} ·{" "}
                        {e.manifest.draft ? "草稿" : "正式交付"}
                      </span>
                      {e.errorCode && (
                        <span>
                          {e.errorCode === "layout_overflow"
                            ? "文字溢出或图层超出画布，请修改作品并保存新版本后重新选择交付。"
                            : e.errorCode === "copy_mismatch"
                              ? "文字稿与画面不一致，请保存修正后的新版本再交付。"
                              : e.errorCode === "access_changed"
                                ? "项目或素材访问权限已变化"
                                : "打包未完成，作品和生成结果已保留"}
                        </span>
                      )}
                      {["failed", "expired"].includes(e.status) &&
                        !["layout_overflow", "copy_mismatch"].includes(
                          e.errorCode,
                        ) && (
                          <button
                            disabled={a.busy}
                            onClick={() =>
                              void a.run(async () => {
                                await api.post(
                                  c.base + "/exports/" + e.id + "/retry",
                                );
                                await exports.reload();
                              })
                            }
                          >
                            重新打包
                          </button>
                        )}
                      {e.status === "ready" ? (
                        <RecordActions>
                          <a
                            href={
                              "/api/v1" + c.base + "/exports/" + e.id + "/file"
                            }
                            download
                          >
                            下载
                          </a>
                          {e.manifest.items.length === 1 ? (
                            <a
                              href={
                                "/api/v1" +
                                c.base +
                                "/exports/" +
                                e.id +
                                "/images/0"
                              }
                              download
                            >
                              下载图片
                            </a>
                          ) : (
                            <details className="content-delivery-files">
                              <summary>单张下载</summary>
                              {e.manifest.items.map(
                                (item: any, index: number) => (
                                  <a
                                    key={item.artifactId + ":" + item.version}
                                    href={
                                      "/api/v1" +
                                      c.base +
                                      "/exports/" +
                                      e.id +
                                      "/images/" +
                                      index
                                    }
                                    download
                                  >
                                    {item.name} v{item.version}
                                  </a>
                                ),
                              )}
                            </details>
                          )}
                        </RecordActions>
                      ) : (
                        <span>
                          {e.status === "failed"
                            ? "打包失败，可重新打包"
                            : e.status === "expired"
                              ? "已过期"
                              : e.status === "queued"
                                ? "等待后台打包"
                                : e.status === "preparing"
                                  ? "正在打包，关闭页面后仍可取件"
                                  : e.status}
                        </span>
                      )}
                    </div>
                  ))}
                </Result>
              </section>
            )}
            {canCreate && (
              <details className="content-project-more">
                <summary>项目操作</summary>
                <button onClick={() => setTrashConfirm(true)}>
                  移入回收站
                </button>
              </details>
            )}
            <ProjectForm
              open={projectForm}
              onClose={() => setProjectForm(false)}
              project={p.data}
              onSaved={p.reload}
            />
          </>
        )}
      </Result>
      <Dialog
        open={!!preview}
        title="核对生成清单"
        onClose={() => setPreview(null)}
        busy={a.busy}
      >
        {preview && (
          <>
            <dl className="content-preview-facts">
              <dt>图片生成请求</dt>
              <dd>{preview.requests} 次</dd>
              <dt>交付项</dt>
              <dd>{preview.deliverables} 个</dd>
              <dt>模型</dt>
              <dd>{preview.model}</dd>
              <dt>费用</dt>
              <dd>方舟账单待核对</dd>
              <dt>范围</dt>
              <dd>
                {preview.request.mode === "local_edit"
                  ? "仅修改选定背景区域"
                  : "生成背景并复用于所选尺寸"}
              </dd>
            </dl>
            <Notice text={a.error} />
            <DialogAction>
              <button
                className="primary"
                disabled={a.busy}
                onClick={() =>
                  void a.run(async () => {
                    await api.post(c.base + "/projects/" + id + "/batches", {
                      request: preview.request,
                      previewHash: preview.previewHash,
                      expiresAt: preview.expiresAt,
                      requestKey: preview.clientRequestKey,
                    });
                    setPreview(null);
                    setTab("tasks");
                    await batches.reload();
                  })
                }
              >
                确认生成
              </button>
            </DialogAction>
          </>
        )}
      </Dialog>
      <Dialog
        open={!!reconcile}
        title="登记供应商核对结果"
        onClose={() => setReconcile(null)}
        busy={a.busy}
      >
        <p>先核对方舟原请求和账单。此操作不会再次生成图片。</p>
        <ChoiceSelect
          label="核对结果"
          value={reconcileData.outcome}
          onChange={(e) =>
            setReconcileData((d) => ({ ...d, outcome: e.target.value }))
          }
        >
          <option value="not_charged">确认未计费</option>
          <option value="charged">已计费但无可用结果</option>
        </ChoiceSelect>
        <Field label="实际费用（元）">
          <input
            value={reconcileData.cost}
            onChange={(e) =>
              setReconcileData((d) => ({ ...d, cost: e.target.value }))
            }
          />
        </Field>
        <Field label="原请求或账单依据">
          <input
            value={reconcileData.billReference}
            onChange={(e) =>
              setReconcileData((d) => ({ ...d, billReference: e.target.value }))
            }
          />
        </Field>
        <Field label="核对说明">
          <textarea
            value={reconcileData.note}
            onChange={(e) =>
              setReconcileData((d) => ({ ...d, note: e.target.value }))
            }
          />
        </Field>
        <Notice text={a.error} />
        <DialogAction>
          <button
            className="primary"
            disabled={
              a.busy ||
              reconcileData.note.trim().length < 10 ||
              reconcileData.billReference.trim().length < 5
            }
            onClick={() =>
              void a.run(async () => {
                await api.post(
                  c.base + "/items/" + reconcile.id + "/reconcile",
                  reconcileData,
                );
                setReconcile(null);
                await batches.reload();
              })
            }
          >
            保存核对记录
          </button>
        </DialogAction>
      </Dialog>
      <ConfirmDialog
        open={trashConfirm}
        title="移入回收站？"
        description="项目可恢复，尚未提交的生成任务将停止。"
        confirmLabel="移入回收站"
        onCancel={() => setTrashConfirm(false)}
        onConfirm={() =>
          void a.run(async () => {
            await api.del(c.base + "/projects/" + id);
            nav(c.prefix);
          })
        }
      />
    </>
  );
}
function LegacyCanvasList() {
  const { prefix } = useContent();
  const { search, hash } = useLocation();
  return <Navigate replace to={prefix + "/assets/canvases" + search + hash} />;
}

type AssetListItem = {
  id: string;
  filename: string;
  mime: string;
  bytes: number;
  shared: boolean;
};

function Assets({
  projectId: embeddedProjectId,
  embedded = false,
}: {
  projectId?: string;
  embedded?: boolean;
}) {
  const action = useAction(),
    navigate = useNavigate();
  const c = useContent(),
    [page, setPage] = useState(1),
    [media, setMedia] = useState(""),
    [days, setDays] = useState(""),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("newest"),
    [batchMode, setBatchMode] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [preview, setPreview] = useState<AssetListItem | null>(null),
    [subjectSource, setSubjectSource] = useState<{
      id: string;
      filename: string;
    }>(),
    [frameSource, setFrameSource] = useState<{
      id: string;
      projectId: string;
    }>(),
    [editSource, setEditSource] = useState<{
      id: string;
      name: string;
      projectId: string;
    }>(),
    [selectedProjectId, setSelectedProjectId] = useState(""),
    projectId = embeddedProjectId ?? (selectedProjectId || undefined),
    r = useApiData<{
      items: AssetListItem[];
      total: number;
      page: number;
      pageSize: number;
    }>(
      c.base +
        "/assets?page=" +
        page +
        (projectId ? "&projectId=" + projectId : "") +
        (media ? "&media=" + media : "") +
        (days ? "&days=" + days : "") +
        "&sort=" +
        sort +
        "&q=" +
        encodeURIComponent(query),
    );
  const resetPage = () => {
    setPage(1);
    setSelected([]);
  };
  const showNewAsset = async () => {
    setMedia("image");
    setDays("");
    setQuery("");
    setSort("newest");
    resetPage();
    if (media === "image" && !query && !days && sort === "newest" && page === 1)
      await r.reload();
  };
  const rows = r.data?.items ?? [];
  const selectedRows = rows.filter((asset) => selected.includes(asset.id));
  const activeAsset = selectedRows.length === 1 ? selectedRows[0] : undefined;
  const image = activeAsset?.mime === "image/png" ? activeAsset : undefined;
  const video = activeAsset?.mime === "video/mp4" ? activeAsset : undefined;
  const allSelected = rows.length > 0 && rows.length === selectedRows.length;
  const selectionTooLarge =
    selectedRows.length > 1 &&
    selectedRows.reduce((sum, asset) => sum + asset.bytes, 0) >
      80 * 1024 * 1024;
  const toggleAsset = (id: string) => {
    setBatchMode(true);
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id],
    );
  };
  const file = (id: string) => "/api/v1" + c.base + "/assets/" + id + "/file";
  const canCreate = c.meta.permissions.includes("content.create");
  const canGenerate =
    canCreate && c.meta.permissions.includes("content.ai.use");
  const useAsset = (asset: { id: string; filename: string }, mode: MediaMode) =>
    void action.run(async () => {
      saveReferenceDraft(
        c.prefix,
        c.meta.membershipId,
        {
          id: asset.id,
          name: asset.filename,
          preview: "/api/v1" + c.base + "/assets/" + asset.id + "/thumbnail",
        },
        projectId,
        mode,
      );
      navigate(projectId ? c.prefix + "/projects/" + projectId : c.prefix);
    });
  const tools = (
    <LibrarySearchActions
      label="搜索素材名称"
      query={query}
      onSearch={(value) => {
        setQuery(value);
        resetPage();
      }}
      selecting={batchMode}
      disabled={action.busy || (!batchMode && (r.loading || !rows.length))}
      onToggleSelection={() => {
        setBatchMode(!batchMode);
        setSelected([]);
      }}
    />
  );
  return (
    <>
      {embedded ? (
        <div className="content-library-header">{tools}</div>
      ) : (
        <AssetLibraryHeader>{tools}</AssetLibraryHeader>
      )}
      <Notice text={action.error} />
      <div className="content-library-filters">
        <div
          className="content-library-types"
          role="group"
          aria-label="素材类型"
        >
          {[
            ["", "全部"],
            ["image", "图片"],
            ["video", "视频"],
          ].map(([value, label]) => (
            <button
              type="button"
              key={label}
              aria-pressed={media === value}
              onClick={() => {
                setMedia(value);
                resetPage();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {!embedded && (
          <EntitySelect<{ id: string; name: string }>
            label="筛选资产范围"
            labelHidden
            emptyLabel="企业共享资产"
            path={c.base + "/projects"}
            value={selectedProjectId}
            format={(project) => project.name}
            onChange={(id) => {
              setSelectedProjectId(id);
              resetPage();
            }}
          />
        )}
        <LibraryTimeSort
          days={days}
          onDays={(value) => {
            setDays(value);
            resetPage();
          }}
          sort={sort}
          onSort={(value) => {
            setSort(value);
            resetPage();
          }}
        />
        {query && (
          <button
            type="button"
            className="content-library-search-term"
            aria-label={"清除搜索 " + query}
            onClick={() => {
              setQuery("");
              resetPage();
            }}
          >
            {query} ×
          </button>
        )}
        {canCreate && !batchMode && (
          <FileInput
            compact
            label={projectId ? "上传项目图片" : "上传共享图片"}
            onUpload={async (filename, data) => {
              await api.post(c.base + "/assets", {
                filename,
                data,
                projectId,
                shared: !projectId,
              });
              await r.reload();
            }}
          />
        )}
      </div>
      {batchMode && (
        <div className="content-asset-list-toolbar">
          <div
            className="content-asset-batch"
            role="group"
            aria-label="选中素材操作"
          >
            <label className="content-asset-select-all">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(element) => {
                  if (element)
                    element.indeterminate =
                      selectedRows.length > 0 && !allSelected;
                }}
                disabled={r.loading || !rows.length || action.busy}
                onChange={(event) =>
                  setSelected(
                    event.target.checked ? rows.map((asset) => asset.id) : [],
                  )
                }
              />
              全选本页
            </label>
            <span role="status">已选 {selectedRows.length} 项</span>
            <RecordActions
              label="选中素材"
              more={
                <>
                  {image && canGenerate && c.meta.model.videoConfigured && (
                    <button
                      disabled={action.busy}
                      onClick={() => useAsset(image, "video")}
                    >
                      用作视频首帧
                    </button>
                  )}
                  {image && canCreate && (
                    <button
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async () => {
                          const name =
                            image.filename
                              .replace(/\.[^.]+$/, "")
                              .trim()
                              .slice(0, 100) || "图片画布";
                          const boardId = await putImageOnCanvas(
                            c.base,
                            image.id,
                            projectId,
                            name,
                          );
                          navigate(c.prefix + "/canvases/" + boardId);
                        })
                      }
                    >
                      {projectId ? "放入项目画布" : "新建图片画布"}
                    </button>
                  )}
                  {image && projectId && canCreate && (
                    <button
                      onClick={() =>
                        setEditSource({
                          id: image.id,
                          name: image.filename,
                          projectId,
                        })
                      }
                    >
                      图片工具
                    </button>
                  )}
                  {image?.shared && canCreate && (
                    <button onClick={() => setSubjectSource(image)}>
                      新建主体
                    </button>
                  )}
                  {video && projectId && canCreate && (
                    <button
                      onClick={() =>
                        setFrameSource({ id: video.id, projectId })
                      }
                    >
                      截取视频帧
                    </button>
                  )}
                </>
              }
            >
              {activeAsset && (
                <button type="button" onClick={() => setPreview(activeAsset)}>
                  预览
                </button>
              )}
              {image && canGenerate && (
                <button
                  disabled={action.busy}
                  onClick={() => useAsset(image, "image")}
                >
                  用作参考图
                </button>
              )}
              {activeAsset ? (
                <a href={file(activeAsset.id)} download={assetDownloadName(activeAsset)}>
                  下载原文件
                </a>
              ) : selectedRows.length > 1 && !selectionTooLarge ? (
                <a
                  href={
                    "/api/v1" +
                    c.base +
                    "/assets/archive?ids=" +
                    encodeURIComponent(
                      selectedRows.map((asset) => asset.id).join(","),
                    )
                  }
                  download="内容资产.zip"
                >
                  打包下载
                </a>
              ) : (
                <button type="button" disabled>
                  下载
                </button>
              )}
            </RecordActions>
            {selectionTooLarge && (
              <span role="status">所选素材超过 80 MiB，请分批下载</span>
            )}
          </div>
        </div>
      )}
      <Result result={r}>
        <div className="content-asset-grid" data-selecting={batchMode}>
          {rows.map((asset) => {
            const checked = selected.includes(asset.id);
            return (
              <article
                className="content-asset-card"
                key={asset.id}
                data-selected={checked}
              >
                <div className="content-asset-tile">
                  <button
                    type="button"
                    className="content-asset-preview"
                    aria-label={
                      batchMode
                        ? (checked ? "取消选择 " : "选中 ") + asset.filename
                        : "预览 " + asset.filename
                    }
                    disabled={action.busy}
                    onClick={() =>
                      batchMode ? toggleAsset(asset.id) : setPreview(asset)
                    }
                  >
                    {asset.mime === "video/mp4" ? (
                      <PlayCircleIcon size={38} aria-hidden="true" />
                    ) : (
                      <img
                        src={
                          "/api/v1" +
                          c.base +
                          "/assets/" +
                          asset.id +
                          "/thumbnail"
                        }
                        loading="lazy"
                        alt=""
                      />
                    )}
                  </button>
                  <label className="content-asset-check">
                    <input
                      type="checkbox"
                      aria-label={"选择 " + asset.filename}
                      checked={checked}
                      disabled={action.busy}
                      onChange={() => toggleAsset(asset.id)}
                    />
                  </label>
                </div>
                <h3 title={asset.filename}>{asset.filename}</h3>
              </article>
            );
          })}
        </div>
        {r.data?.items.length === 0 && (
          <Empty
            text={query || media || days ? "没有匹配的素材" : "暂无素材"}
          />
        )}
        <Pager
          result={r}
          page={page}
          setPage={(next) => {
            setPage(next);
            setSelected([]);
          }}
        />
      </Result>
      <Dialog
        open={!!preview}
        title={preview?.filename ?? "素材预览"}
        size="large"
        onClose={() => setPreview(null)}
      >
        {preview && (
          <div className="content-asset-dialog">
            {preview.mime === "video/mp4" ? (
              <video
                controls
                preload="metadata"
                aria-label="素材视频"
                src={file(preview.id)}
              />
            ) : (
              <img src={file(preview.id)} alt={preview.filename} />
            )}
          </div>
        )}
      </Dialog>
      {subjectSource && (
        <DocumentForm
          kind="product"
          open
          document={null}
          sourceImage={subjectSource}
          onClose={() => setSubjectSource(undefined)}
          onSaved={async () => navigate(c.prefix + "/products")}
        />
      )}
      {frameSource && (
        <VideoFrameDialog
          assetId={frameSource.id}
          projectId={frameSource.projectId}
          onClose={() => setFrameSource(undefined)}
          onSaved={async () => {
            await showNewAsset();
            setFrameSource(undefined);
          }}
        />
      )}
      {editSource && (
        <ImageToolsDialog
          image={editSource}
          projectId={editSource.projectId}
          onClose={() => setEditSource(undefined)}
          onSaved={async () => {
            await showNewAsset();
            setEditSource(undefined);
          }}
        />
      )}
    </>
  );
}
function Templates() {
  const c = useContent(),
    r = useApiData<any>(c.base + "/documents/template");
  return (
    <>
      <PageTitle title="版式模板" />
      <Result result={r}>
        {r.data?.items.length > 0 && (
          <section className="panel">
            <h2>企业模板</h2>
            {r.data.items.map((d: any) => (
              <div className="content-task-row" key={d.id}>
                <strong>{d.name}</strong>
                <span>
                  v{d.version} · {d.data.layout?.length ?? 0} 个图层规则
                </span>
              </div>
            ))}
          </section>
        )}
      </Result>
      <div className="content-grid">
        {["hero", "split", "minimal"].map((t) => (
          <article className="panel content-template" key={t}>
            <div className={"content-template-preview " + t}>
              <b>品牌标题</b>
              <span>产品与背景</span>
              <i>行动语</i>
            </div>
            <h2>{status(t)}</h2>
          </article>
        ))}
      </div>
    </>
  );
}
function Trash() {
  const c = useContent(),
    [page, setPage] = useState(1),
    r = usePagedCollection<any>(c.base + "/trash", page),
    a = useAction();
  return (
    <>
      <PageTitle title="回收站" />
      <Notice text={a.error} />
      <Result result={r}>
        <Pager result={r.pagination} page={page} setPage={setPage} />
        {r.data?.length === 0 && <Empty text="回收站为空" />}
        {r.data?.map((p) => (
          <article className="panel content-task-row" key={p.id}>
            <div>
              <h2>{p.name}</h2>
              <small>{new Date(p.deletedAt).toLocaleString()}</small>
            </div>
            <button
              disabled={a.busy}
              onClick={() =>
                void a.run(async () => {
                  await api.post(c.base + "/projects/" + p.id + "/restore", {});
                  window.dispatchEvent(new Event("content-projects-changed"));
                  await r.reload();
                })
              }
            >
              恢复项目
            </button>
          </article>
        ))}
      </Result>
    </>
  );
}
function Settings() {
  const c = useContent(),
    a = useAction(),
    members = useApiData<any[]>(c.base + "/members"),
    [usagePage, setUsagePage] = useState(1),
    usage = usePagedCollection<any>(c.base + "/usage", usagePage),
    [settings, setSettings] = useState<any>(c.meta.settings),
    [confirm, setConfirm] = useState(false);
  const [bill, setBill] = useState<any>(null),
    [billData, setBillData] = useState({
      cost: "",
      billReference: "",
      note: "",
    });
  const save = () =>
    void a.run(async () => {
      await api.put(c.base + "/settings", {
        version: settings.version,
        reviewRequired: settings.reviewRequired,
        maxBatch: settings.maxBatch,
        monthlyImageLimit: settings.monthlyImageLimit,
      });
      setConfirm(false);
      await c.reload();
    });
  useEffect(() => setSettings(c.meta.settings), [c.meta.settings]);
  return (
    <>
      <PageTitle title="内容设置" />
      <Notice text={a.error} />
      <section className="panel">
        <h2 className="content-heading-with-info">
          生成规则{" "}
          <InfoTip label="图片模型信息">
            模型：{c.meta.model.image}；
            {c.meta.model.configured ? "已配置" : "未配置"}。
          </InfoTip>
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!settings.reviewRequired && c.meta.settings.reviewRequired)
              setConfirm(true);
            else save();
          }}
        >
          <label>
            <input
              type="checkbox"
              checked={settings.reviewRequired}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  reviewRequired: e.target.checked,
                }))
              }
            />
            正式交付需要他人审核
          </label>
          <div className="form-grid">
            <Field label="单批请求上限（次）">
              <input
                type="number"
                min={1}
                max={60}
                value={settings.maxBatch}
                onChange={(e) =>
                  setSettings((s: any) => ({
                    ...s,
                    maxBatch: Number(e.target.value),
                  }))
                }
              />
            </Field>
            <Field label="每月请求上限（次）">
              <input
                type="number"
                min={0}
                max={100000}
                value={settings.monthlyImageLimit}
                onChange={(e) =>
                  setSettings((s: any) => ({
                    ...s,
                    monthlyImageLimit: Number(e.target.value),
                  }))
                }
              />
            </Field>
          </div>
          <div className="content-actions">
            <button className="primary" disabled={a.busy}>
              保存设置
            </button>
          </div>
        </form>
        {!c.meta.model.configured && (
          <p role="status">图片模型未配置，请联系平台管理员。</p>
        )}
      </section>
      <section className="panel">
        <h2>成员岗位</h2>
        <Result result={members}>
          {members.data?.map((m) => (
            <div key={m.id} className="content-task-row content-member-row">
              <div>
                <strong>{m.user.name}</strong>
                <small>{m.role === "admin" ? "企业管理员" : ""}</small>
              </div>
              <ChoiceSelect
                label={m.user.name + "的内容岗位"}
                labelHidden
                disabled={m.role === "admin" || a.busy}
                value={m.contentRole || "none"}
                onChange={(e) =>
                  void a.run(async () => {
                    await api.put(c.base + "/members", {
                      membershipId: m.id,
                      role: e.target.value,
                    });
                    await members.reload();
                  })
                }
              >
                {[
                  ["none", "未授权"],
                  ["manager", "内容管理员"],
                  ["creator", "创作者"],
                  ["reviewer", "审核者"],
                  ["viewer", "查看者"],
                ].map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </ChoiceSelect>
            </div>
          ))}
        </Result>
      </section>
      <section className="panel">
        <h2>最近生成用量</h2>
        <Result result={usage}>
          <Pager
            result={usage.pagination}
            page={usagePage}
            setPage={setUsagePage}
          />
          {usage.data?.length === 0 && <Empty text="还没有生成用量" />}
          {usage.data?.map((x) => (
            <div key={x.id} className="content-task-row">
              <span>
                {new Date(x.createdAt).toLocaleString()} · {x.quantity} 张
              </span>
              <span>
                {status(x.status)}
                {x.cost ? " · ¥" + x.cost : ""}
              </span>
              {[
                "usage_reported_cost_pending",
                "usage_unknown_cost_pending",
                "settled",
              ].includes(x.status) && (
                <button
                  disabled={a.busy}
                  onClick={() => {
                    setBill(x);
                    setBillData({
                      cost: x.cost ?? "",
                      billReference: x.detail?.billReference ?? "",
                      note: "",
                    });
                  }}
                >
                  登记账单
                </button>
              )}
            </div>
          ))}
        </Result>
      </section>
      <Dialog
        open={!!bill}
        title="登记图片账单"
        onClose={() => setBill(null)}
        busy={a.busy}
      >
        <Field label="实际费用（元）">
          <input
            value={billData.cost}
            onChange={(e) =>
              setBillData((d) => ({ ...d, cost: e.target.value }))
            }
          />
        </Field>
        <Field label="供应商账单依据">
          <input
            value={billData.billReference}
            onChange={(e) =>
              setBillData((d) => ({ ...d, billReference: e.target.value }))
            }
          />
        </Field>
        <Field label="核对说明">
          <textarea
            value={billData.note}
            onChange={(e) =>
              setBillData((d) => ({ ...d, note: e.target.value }))
            }
          />
        </Field>
        <Notice text={a.error} />
        <DialogAction>
          <button
            className="primary"
            disabled={
              a.busy ||
              !billData.cost ||
              billData.billReference.length < 5 ||
              billData.note.length < 5
            }
            onClick={() =>
              void a.run(async () => {
                await api.put(c.base + "/usage/" + bill.id, {
                  ...billData,
                  expectedUpdatedAt: bill.updatedAt,
                });
                setBill(null);
                await usage.reload();
              })
            }
          >
            保存账单记录
          </button>
        </DialogAction>
      </Dialog>
      <ConfirmDialog
        open={confirm}
        title="允许免审交付？"
        description="创作者可明确选择免审交付，系统会记录操作者和当时的企业策略。"
        confirmLabel="保存策略"
        onCancel={() => setConfirm(false)}
        onConfirm={save}
      />
    </>
  );
}

function Reviews() {
  const c = useContent(),
    [page, setPage] = useState(1),
    r = useApiData<any>(c.base + "/reviews?page=" + page);
  return (
    <>
      <PageTitle title="审核任务" />
      <Result result={r}>
        {r.data?.items.length === 0 && <Empty text="没有待审核作品" />}
        <div className="content-grid">
          {r.data?.items.map((x: any) => (
            <Link
              key={x.id}
              className="content-project-card"
              to={
                c.prefix +
                "/projects/" +
                x.project.id +
                "?artifact=" +
                x.artifactId +
                "&version=" +
                x.version
              }
            >
              <ArtworkPreview data={x.data} />
              <h3>
                {x.artifact.name} · v{x.version}
              </h3>
              <p>{x.project.name}</p>
            </Link>
          ))}
        </div>
        <Pager result={r} page={page} setPage={setPage} />
      </Result>
    </>
  );
}
