import { ImageToolsDialog } from "./ImageToolsDialog";
import { ImageRegionDialog, type EditRegion } from "./ImageRegionDialog";
import { VideoFrameDialog } from "./VideoFrameDialog";
import {
  MediaOptions,
  pictureDefaults,
  constrainPicture,
  clipDefaults,
  mediaActive,
  legacyRatios,
  type MediaMode,
  type PictureOptions,
  type ClipOptions,
} from "./MediaOptions";
import { EntitySelect, Field } from "../components";
import { CreativeTabs } from "./CreativeTabs";
import { AddToCanvas } from "./ContentCanvas";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowUpIcon,
  ArrowLeftIcon,
  ImageIcon,
  PlusIcon,
  DownloadSimpleIcon,
  PencilSimpleIcon,
  ArrowCounterClockwiseIcon,
  SparkleIcon,
  TagIcon,
  XIcon,
  CheckIcon,
  DotsThreeIcon,
  FilmSlateIcon,
  CubeIcon,
  FolderOpenIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { api, ApiError, errorText } from "../api";
import { useApiData } from "../hooks";
import { Dialog, Notice, ConfirmDialog, PageTitle } from "../components";
import { DropdownSelect, InfoTip } from "@suite/frontend/components";
import {
  useContent,
  useAction,
  Result,
  Pager,
  key,
  status,
} from "./content-ui";
import { ArtworkPreview } from "./ArtworkPreview";
import { StudioDropdown } from "./StudioDropdown";
import {
  ReferenceAttachment,
  type ReferenceImage,
} from "./ReferenceAttachment";
import "./studio.css";

type Size = "square" | "portrait" | "story";
const ratios = { square: "1:1", portrait: "3:4", story: "9:16" };
const creationTypes = [
  { value: "image", label: "图片生成", icon: ImageIcon },
  { value: "video", label: "视频生成", icon: FilmSlateIcon },
  { value: "assistant", label: "创作助手", icon: SparkleIcon },
] as const;
const examples = [
  {
    title: "新品社媒图",
    useCase: "社媒推广",
    prompt:
      "为一款咖啡新品创作冬季社媒宣传图，暖色光线、简洁背景，突出产品，画面留出标题空间。",
  },
  {
    title: "电商产品图",
    useCase: "电商上新",
    prompt:
      "创作一张护肤品电商产品展示图，米白色背景，柔和自然光，质感干净，突出产品材质与细节。",
  },
  {
    title: "活动宣传图",
    useCase: "品牌活动",
    prompt:
      "创作一张秋日品牌活动宣传图，暖橙与米白配色，轻盈的植物元素，简洁构图，突出活动氛围。",
  },
];
const videoExamples = [
  {
    title: "产品卖点短片",
    useCase: "电商上新",
    prompt:
      "制作产品卖点短片。保留产品外观，使用干净背景与缓慢推镜，突出产品细节。",
  },
  {
    title: "商品静物运镜",
    useCase: "社媒推广",
    prompt:
      "以参考产品为视觉中心，从中景缓慢推近，展示材质和轮廓，保持产品形状、标签与背景一致。",
  },
  {
    title: "品牌活动短片",
    useCase: "品牌活动",
    prompt:
      "制作品牌活动短片。用固定机位拍摄，光线渐亮，画面保留标题空间和品牌主色。",
  },
];
const creationTemplates = [
  ...examples.map((example) => ({ ...example, mode: "image" as const })),
  ...videoExamples.map((example) => ({ ...example, mode: "video" as const })),
];
type Draft = {
  prompt: string;
  size: Size;
  brandId: string;
  brandVersion?: number;
  brandName?: string;
  reference?: ReferenceImage;
  extraReferences?: ReferenceImage[];
  region?: EditRegion;
  picture?: PictureOptions;
  mode?: MediaMode;
  video?: { prompt: string; frame?: ReferenceImage; options: ClipOptions };
};
const blank: Draft = { prompt: "", size: "square", brandId: "" };
function readDraft(storageKey: string): Draft {
  try {
    const d = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    return d &&
      typeof d.prompt === "string" &&
      d.prompt.length <= 2000 &&
      d.size in ratios
      ? d
      : { ...blank };
  } catch {
    return { ...blank };
  }
}
export function ContentExplore() {
  const c = useContent();
  const navigate = useNavigate();
  const action = useAction();
  const canCreate = c.meta.permissions.includes("content.create");
  const draftKey = c.prefix + ":" + c.meta.membershipId + ":draft:new";
  const [filter, setFilter] = useState<MediaMode>("image");
  const [useCase, setUseCase] = useState("");
  const [query, setQuery] = useState("");
  const entries = creationTemplates.filter(
    (entry) =>
      entry.mode === filter &&
      (!useCase || entry.useCase === useCase) &&
      (entry.title + entry.prompt).includes(query.trim()),
  );
  return (
    <section className="studio-explore">
      <PageTitle title="探索" />
      <Notice text={action.error} />
      <div className="content-asset-toolbar">
        <div className="form-actions" role="group" aria-label="模板类型">
          {(["image", "video"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={mode === filter}
              onClick={() => setFilter(mode)}
            >
              {mode === "image" ? "图片模板" : "视频模板"}
            </button>
          ))}
        </div>
        <DropdownSelect
          aria-label="模板用途"
          value={useCase}
          onChange={(event) => setUseCase(event.target.value)}
        >
          <option value="">全部用途</option>
          {["社媒推广", "电商上新", "品牌活动"].map((name) => (
            <option key={name}>{name}</option>
          ))}
        </DropdownSelect>
        <input
          type="search"
          aria-label="搜索创作模板"
          placeholder="搜索创作模板"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="content-grid">
        {entries.map(({ title, prompt, mode }) => (
          <article className="panel content-document" key={title}>
            <h2>{title}</h2>
            <p>{prompt}</p>
            {canCreate && (
              <button
                aria-label={`使用提示词：${title}`}
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    const draft = readDraft(draftKey);
                    const next =
                      mode === "image"
                        ? { ...draft, mode, prompt }
                        : {
                            ...draft,
                            mode,
                            video: {
                              ...(draft.video ?? { options: clipDefaults }),
                              prompt,
                            },
                          };
                    sessionStorage.setItem(draftKey, JSON.stringify(next));
                    navigate(c.prefix);
                  })
                }
              >
                使用提示词
              </button>
            )}
          </article>
        ))}
        {entries.length === 0 && <p role="status">没有匹配的创作模板</p>}
      </div>
    </section>
  );
}

export function CreationStudio() {
  const { id = "" } = useParams();
  return <StudioScreen key={id} id={id} />;
}
function StudioScreen({ id }: { id: string }) {
  const c = useContent(),
    nav = useNavigate(),
    action = useAction(),
    upload = useAction();
  const storageScope = c.prefix + ":" + c.meta.membershipId;
  const draftKey = storageScope + ":draft:" + (id || "new");
  const [draft, setDraft] = useState<Draft>(() => readDraft(draftKey));
  const mode = draft.mode === "video" ? "video" : "image";
  const imageMode = mode === "image";
  const video = draft.video ?? { prompt: "", options: clipDefaults };
  const picture = constrainPicture(
    draft.picture ?? { ...pictureDefaults, ratio: legacyRatios[draft.size] },
    c.meta.model.imageOptions,
  );
  const references = [draft.reference, ...(draft.extraReferences ?? [])].filter(
    (r): r is ReferenceImage => !!r,
  );
  const prompt = imageMode ? draft.prompt : video.prompt;
  const modelReady = imageMode
    ? c.meta.model.configured
    : c.meta.model.videoConfigured;
  const modelName: string = (imageMode ? c.meta.model.image : c.meta.model.video) ?? "";
  const modelSummary = modelName
    .replace(/^doubao-seedance-1-0-pro-fast(?:-\d+)?$/, "Seedance 1.0 Pro Fast")
    .replace(/^doubao-seedream-4-5(?:-\d+)?$/, "Seedream 4.5") || "企业模型";
  const modelDescription = modelReady ? modelName : "尚未配置";
  const maxReferences = c.meta.model.imageOptions.maxReferences;
  const [attachOpen, setAttachOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [assetScope, setAssetScope] = useState("shared");
  const [assetPage, setAssetPage] = useState(1);
  const [assetQuery, setAssetQuery] = useState("");
  const assets = useApiData<any>(
    attachOpen
      ? c.base +
          "/assets?media=image&page=" +
          assetPage +
          "&q=" +
          encodeURIComponent(assetQuery) +
          (assetScope === "project" && id ? "&projectId=" + id : "")
      : null,
  );
  const [artPage, setArtPage] = useState(1),
    [batchPage, setBatchPage] = useState(1);
  const [imageTools, setImageTools] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [regionImage, setRegionImage] = useState<ReferenceImage | null>(null);
  const [frameVideo, setFrameVideo] = useState<string | null>(null);
  const [compare, setCompare] = useState("");
  const activeRegion = references.length === 1 ? draft.region : undefined;
  const [detail, setDetail] = useState<any>(null),
    [feedback, setFeedback] = useState("");
  const [uncertain, setUncertain] = useState(
    () => !!sessionStorage.getItem(storageScope + ":outbox"),
  );
  const [showContext, setShowContext] = useState(false);
  const projectAction = useAction();
  const [renameOpen, setRenameOpen] = useState(false),
    [projectName, setProjectName] = useState(""),
    [archiveOpen, setArchiveOpen] = useState(false);
  const [brandQuery, setBrandQuery] = useState(""),
    [brandPage, setBrandPage] = useState(1);
  const createdProject = useRef<any>(null);
  const input = useRef<HTMLTextAreaElement>(null),
    uploadInput = useRef<HTMLInputElement>(null),
    resultEnd = useRef<HTMLDivElement>(null);
  const project = useApiData<any>(id ? c.base + "/projects/" + id : null);
  useEffect(() => { document.title = `${id ? project.data?.name ?? "创作记录" : imageMode ? "图片创作" : "视频创作"} · 知行方舟`; }, [id, project.data?.name, imageMode]);
  const arts = useApiData<any>(
    id ? c.base + `/projects/${id}/artifacts?page=${artPage}` : null,
  );
  const batches = useApiData<any>(
    id ? c.base + `/projects/${id}/batches?page=${batchPage}` : null,
  );
  const brands = useApiData<any>(
    c.base +
      `/documents/brand?page=${brandPage}&q=${encodeURIComponent(brandQuery)}`,
  );
  const canCreate = c.meta.permissions.includes("content.create"),
    canGenerate = canCreate && c.meta.permissions.includes("content.ai.use");
  const working = batches.data?.items.some((b: any) =>
    b.items.some((i: any) => mediaActive.includes(i.status)),
  );
  const pending = action.busy || upload.busy;
  const canAttach = canCreate && (!imageMode || references.length < maxReferences);
  const inputReferences = imageMode ? references : video.frame ? [video.frame] : [];
  const uploadLabel = !imageMode && video.frame ? "更换参考图" : "添加参考图";
  const patch = (v: Partial<Draft>) => setDraft((d) => ({ ...d, ...v }));
  const changeMode = (value: MediaMode | "assistant") => {
    if (value === "assistant") {
      const back = c.prefix + (id ? "/projects/" + id : "");
      nav(c.prefix + "/ai?returnTo=" + encodeURIComponent(back));
      return;
    }
    patch({ mode: value });
  };
  const patchVideo = (value: Partial<typeof video>) =>
    setDraft((d) => ({
      ...d,
      video: {
        ...(d.video ?? { prompt: "", options: clipDefaults }),
        ...value,
      },
    }));
  const mediaOptions = (
    <MediaOptions
      mode={mode}
      preserveSize={imageMode && !!activeRegion}
      picture={picture}
      clip={video.options}
      hasFrame={!!video.frame}
      dropdown={!id}
      disabled={pending}
      onPicture={(value) => patch({ picture: value })}
      onClip={(options) => patchVideo({ options })}
    />
  );
  const brandToggle = (
    <button
      type="button"
      className={"studio-context-toggle" + (draft.brandId || project.data?.brief.brandId ? " selected" : "")}
      disabled={pending}
      onClick={() => setShowContext((value) => !value)}
      aria-expanded={showContext}
      title={draft.brandName}
    >
      <TagIcon size={15} aria-hidden="true" />
      <span>{draft.brandName ?? "关联品牌"}</span>
    </button>
  );
  const referenceFrom = (id: string, name: string): ReferenceImage => ({
    id,
    name,
    preview: "/api/v1" + c.base + "/assets/" + id + "/thumbnail",
  });
  const attach = (...images: ReferenceImage[]) => {
    if (imageMode) {
      const newImages = images.filter((image) => !references.some((r) => r.id === image.id));
      if (!newImages.length) return;
      if (references.length + newImages.length > maxReferences)
        throw Error("当前模型的参考图已达到上限");
      const [reference, ...extraReferences] = [...references, ...newImages];
      patch({ reference, extraReferences, region: undefined });
    } else {
      patchVideo({
        frame: images[0],
        options: { ...video.options, ratio: "adaptive" },
      });
    }
    setAttachOpen(false);
  };
  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      /* In-memory draft remains usable if browser storage is unavailable. */
    }
  }, [draft, draftKey]);
  useEffect(() => {
    if (!working) return;
    const t = setInterval(
      () => void Promise.all([batches.reload(), arts.reload()]),
      3000,
    );
    return () => clearInterval(t);
  }, [working, batches.reload, arts.reload]);
  useEffect(() => {
    resultEnd.current?.scrollIntoView({ block: "end" });
  }, [arts.data?.items[0]?.id]);
  useEffect(() => {
    if (feedback) {
      const t = setTimeout(() => setFeedback(""), 5000);
      return () => clearTimeout(t);
    }
  }, [feedback]);
  // Match every paid submission to a persisted key. Unknown HTTP outcomes never cause automatic resubmission.
  const checkSubmission = () =>
    void action.run(async () => {
      const saved = JSON.parse(
        sessionStorage.getItem(storageScope + ":outbox") ?? "null",
      );
      if (!saved) {
        setUncertain(false);
        return;
      }
      const all = await api.get<any>(
        c.base + `/projects/${saved.projectId}/batches`,
      );
      if (!all.some((b: any) => b.requestKey === saved.requestKey)) {
        if (!saved.submission)
          throw Error("未找到提交记录，请联系企业管理员核对");
        // Explicit recovery uses the exact same idempotency key and preview; never creates a replacement request.
        try {
          await api.post(
            c.base + `/projects/${saved.projectId}/batches`,
            saved.submission,
            { timeoutMs: 30000 },
          );
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.status >= 400 &&
            error.status < 500
          ) {
            sessionStorage.removeItem(storageScope + ":outbox");
            setUncertain(false);
          }
          throw error;
        }
      }
      sessionStorage.removeItem(storageScope + ":outbox");
      setUncertain(false);
      setFeedback("原提交已恢复");
      nav(c.prefix + "/projects/" + saved.projectId);
      await batches.reload();
      await arts.reload();
    });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (
      !prompt.trim() ||
      !modelReady ||
      pending ||
      uncertain ||
      !canGenerate ||
      (id && !project.data)
    )
      return;
    void action.run(async () => {
      let p = project.data ?? createdProject.current;
      const brand =
        draft.brandId && draft.brandVersion
          ? { id: draft.brandId, version: draft.brandVersion }
          : undefined;
      if (draft.brandId && !brand)
        throw Error("请重新选择品牌，以确认品牌版本");
      if (!p) {
        p = await api.post<any>(c.base + "/projects", {
          name: prompt.trim().slice(0, 40),
          visibility: "private",
          participants: [],
          brief: {
            workflow: "studio",
            prompt: prompt.trim(),
            ...(brand
              ? { brandId: brand.id, brandVersion: brand.version }
              : {}),
            productIds: [],
            productVersions: {},
            sizes: [draft.size],
            variants: 1,
          },
        });
        createdProject.current = p;
        window.dispatchEvent(new Event("content-projects-changed"));
      }
      const request = {
        projectVersion: p.version,
        mode,
        instruction: prompt.trim(),
        ...(brand ? { brand } : {}),
        ...(imageMode
          ? {
              ...picture,
              ...(activeRegion ? { region: activeRegion } : {}),
              ...(references.length
                ? { referenceAssetIds: references.map((r) => r.id) }
                : {}),
            }
          : {
              video: video.options,
              ...(video.frame ? { referenceAssetId: video.frame.id } : {}),
            }),
      };
      const preview = await api.post<any>(
        c.base + `/projects/${p.id}/preview`,
        request,
      );
      const submission = {
        request,
        previewHash: preview.previewHash,
        expiresAt: preview.expiresAt,
        requestKey: key(),
      };
      sessionStorage.setItem(
        storageScope + ":outbox",
        JSON.stringify({
          projectId: p.id,
          requestKey: submission.requestKey,
          submission,
        }),
      );
      try {
        await api.post(c.base + `/projects/${p.id}/batches`, submission, {
          timeoutMs: 30000,
        });
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500
        )
          sessionStorage.removeItem(storageScope + ":outbox");
        else setUncertain(true);
        throw error;
      }
      sessionStorage.removeItem(storageScope + ":outbox");
      if (imageMode)
        patch({
          prompt: "",
          reference: undefined,
          extraReferences: [],
          region: undefined,
        });
      else patchVideo({ prompt: "" });
      setBatchPage(1);
      setArtPage(1);
      setFeedback("已提交，生成结果会自动保存在这里");
      if (!id) {
        sessionStorage.setItem(
          storageScope + ":draft:" + p.id,
          JSON.stringify(
            imageMode
              ? {
                  ...draft,
                  prompt: "",
                  reference: undefined,
                  extraReferences: [],
                  region: undefined,
                }
              : { ...draft, video: { ...video, prompt: "" } },
          ),
        );
        nav(c.prefix + "/projects/" + p.id);
      } else {
        await batches.reload();
        await arts.reload();
      }
    });
  };
  const attachFiles = (files: File[]) =>
    void upload.run(async () => {
      if (pending || !canAttach || !files.length) return;
      const remaining = imageMode ? maxReferences - references.length : 1;
      if (files.length > remaining)
        throw Error(`本次最多可选 ${remaining} 张图片`);
      for (const file of files) {
        if (!/^image\/(png|jpeg|webp)$/.test(file.type))
          throw Error(`${file.name}：请使用 PNG、JPEG 或 WebP 图片`);
        if (file.size > 8 * 1024 * 1024)
          throw Error(`${file.name}：单张图片最大 8 MiB`);
      }
      const uploaded: ReferenceImage[] = [];
      try {
        for (const file of files) {
          try {
            const data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result).split(",")[1]);
              reader.onerror = () => reject(Error("图片读取失败"));
              reader.readAsDataURL(file);
            });
            const asset = await api.post<{ id: string }>(c.base + "/assets", {
              filename: file.name,
              data,
              ...(id ? { projectId: id } : { draft: true }),
            });
            uploaded.push(referenceFrom(asset.id, file.name));
          } catch (error) {
            throw Error(`${file.name}：${errorText(error)}`);
          }
        }
      } finally {
        if (uploaded.length) attach(...uploaded);
      }
    });
  const useReference = (
    art: any,
    destination: MediaMode = "image",
    prompt?: string,
  ) => {
    const data = art.versions[0].data;
    if (!data.backgroundId) return;
    const ref = referenceFrom(data.backgroundId, art.name);
    if (destination === "image")
      patch({
        mode: "image",
        reference: ref,
        extraReferences: [],
        region: undefined,
        ...(prompt ? { prompt } : {}),
      });
    else
      patch({
        mode: "video",
        video: {
          ...video,
          frame: ref,
          options: { ...video.options, ratio: "adaptive" },
        },
      });
    setDetail(null);
    input.current?.focus();
  };
  const editAgain = (art: any) => {
    const source = art.versions[0].data.source;
    const restored = (
      source?.referenceAssetIds ??
      (source?.referenceAssetId ? [source.referenceAssetId] : [])
    )
      .slice(0, maxReferences)
      .map((id: string, index: number) =>
        referenceFrom(id, "参考图 " + (index + 1)),
      );
    const [reference, ...extraReferences] = restored;
    const options = c.meta.model.imageOptions;
    patch({
      mode: "image",
      prompt: source?.prompt || project.data?.brief.prompt || "",
      picture: {
        ratio: options.ratios.includes(source?.ratio)
          ? source.ratio
          : (legacyRatios[source?.size] ?? pictureDefaults.ratio),
        resolution: options.resolutions.includes(source?.resolution)
          ? source.resolution
          : pictureDefaults.resolution,
        candidates: source?.candidates ?? 1,
      },
      reference,
      extraReferences,
      region: source?.region,
      brandId: source?.brandId ?? "",
      brandVersion: source?.brandVersion,
      brandName: undefined,
    });
    setDetail(null);
    input.current?.focus();
  };
  const pictureReceipt = (art: any) => {
    const source = art.versions[0].data.source;
    return [
      source?.model,
      source?.region
        ? "局部改图"
        : (source?.ratio ?? ratios[source?.size as Size]),
      source?.region ? null : source?.resolution,
      source?.outputWidth && source?.outputHeight
        ? source.outputWidth + " × " + source.outputHeight
        : null,
      "v" + art.versions[0].version,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const media = (art: any, large = false) => {
    const data = art.versions[0].data;
    return data.source?.workflow === "studio" && data.backgroundId ? (
      <img
        className={large ? "studio-detail-image" : "studio-result-image"}
        src={"/api/v1" + c.base + "/assets/" + data.backgroundId + "/file"}
        alt={art.name}
        style={{
          aspectRatio:
            (data.source?.outputWidth ?? data.width) /
            (data.source?.outputHeight ?? data.height),
        }}
        loading={large ? "eager" : "lazy"}
      />
    ) : (
      <ArtworkPreview data={data} artifactId={art.id} thumbnail={!large} />
    );
  };
  const download = (art: any) =>
    art.versions[0].data.source?.workflow === "studio" &&
    art.versions[0].data.backgroundId ? (
      <a
        href={
          "/api/v1" +
          c.base +
          "/assets/" +
          art.versions[0].data.backgroundId +
          "/file"
        }
        download={art.name.slice(0, 40) + ".png"}
      >
        <DownloadSimpleIcon size={17} aria-hidden="true" />
        下载图片
      </a>
    ) : (
      <Link to={c.prefix + "/projects/" + id + "/manage"}>
        <DownloadSimpleIcon size={17} aria-hidden="true" />
        查看原作品交付
      </Link>
    );
  const hasResults = !!id;
  return (
    <div
      className={"creation-studio " + (hasResults ? "has-results" : "is-empty")}
    >
      {!hasResults && <CreativeTabs mode="generate" />}
      {hasResults && (
        <header className="studio-topline">
          <div>
            <Link
              to={c.prefix}
              className="studio-back"
              aria-label="返回创作首页"
            >
              <ArrowLeftIcon size={19} aria-hidden="true" />
            </Link>
            <h1>{project.data?.name ?? "创作记录"}</h1>
          </div>
          <CreativeTabs mode="generate" projectId={id} />
          <div className="studio-header-actions">
            <span className="studio-private">
              <CheckIcon size={14} aria-hidden="true" />
              {id && project.data?.visibility === "tenant"
                ? "企业共享"
                : "企业内私有"}
            </span>
            {id && project.data && canCreate && (
              <details className="studio-project-menu">
                <summary aria-label="创作操作">
                  <DotsThreeIcon size={22} aria-hidden="true" />
                </summary>
                <div className="studio-project-options">
                  <button
                    disabled={projectAction.busy}
                    onClick={() => {
                      setProjectName(project.data.name);
                      setRenameOpen(true);
                    }}
                  >
                    重命名
                  </button>
                  <button
                    disabled={projectAction.busy || working}
                    title={working ? "生成结束后可移入回收站" : undefined}
                    onClick={() => setArchiveOpen(true)}
                  >
                    移入回收站
                  </button>
                </div>
              </details>
            )}
          </div>
        </header>
      )}
      {hasResults ? (
        <div className="studio-timeline">
          <Result result={project}>
            {project.data && (
              <>
                {project.data.brief.brandId && (
                  <div className="studio-brand-context">
                    <TagIcon size={15} aria-hidden="true" />
                    <Link to={c.prefix + "/brands"}>
                      品牌规范 v{project.data.brief.brandVersion}
                    </Link>
                  </div>
                )}
                <Result result={arts}>
                  {[...(arts.data?.items ?? [])].reverse().map((art: any) => (
                    <article key={art.id} className="studio-result">
                      <div className="studio-result-prompt">
                        <p>
                          {art.versions[0].data.source?.prompt ||
                            project.data.brief.prompt}
                        </p>
                        <small>{pictureReceipt(art)}</small>
                      </div>
                      <button
                        className="studio-media-open"
                        onClick={() => {
                          setCompare("");
                          setDetail(art);
                        }}
                        aria-label={"查看图片：" + art.name}
                      >
                        {media(art)}
                      </button>
                      <div className="studio-result-actions">
                        {download(art)}
                        {canCreate && art.versions[0].data.backgroundId && (
                          <AddToCanvas
                            assetId={art.versions[0].data.backgroundId}
                            projectId={id}
                          />
                        )}
                        {canGenerate && (
                          <>
                            <button
                              onClick={() => useReference(art)}
                              disabled={
                                !art.versions[0].data.backgroundId || pending
                              }
                            >
                              <ImageIcon size={17} aria-hidden="true" />
                              用作参考图
                            </button>
                            {art.versions[0].data.backgroundId && (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => useReference(art, "video")}
                              >
                                生成视频
                              </button>
                            )}
                            {!art.versions[0].data.source?.operation && (
                              <button
                                onClick={() => editAgain(art)}
                                disabled={pending}
                              >
                                <PencilSimpleIcon
                                  size={17}
                                  aria-hidden="true"
                                />
                                重新编辑
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </article>
                  ))}
                  <Pager result={arts} page={artPage} setPage={setArtPage} />
                </Result>
                <Result result={batches}>
                  {batches.data?.items
                    .filter(
                      (b: any) =>
                        b.snapshot?.request?.mode === "video" ||
                        b.items.some((i: any) => i.status !== "succeeded"),
                    )
                    .map((b: any) => (
                      <section
                        className="studio-task"
                        key={b.id}
                        aria-label="生成状态"
                      >
                        <p>
                          {b.snapshot?.request?.instruction ||
                            project.data.brief.prompt}
                        </p>
                        {b.items.map((i: any) => (
                          <div key={i.id}>
                            <strong>{status(i.status)}</strong>
                            {b.snapshot?.request?.mode === "video" &&
                              i.status === "succeeded" &&
                              i.attempt?.resultAssetId && (
                                <div className="studio-video-result">
                                  <video
                                    controls
                                    preload="metadata"
                                    aria-label="生成视频"
                                    src={
                                      "/api/v1" +
                                      c.base +
                                      "/assets/" +
                                      i.attempt.resultAssetId +
                                      "/file"
                                    }
                                  />
                                  <small>
                                    {[
                                      b.snapshot.model,
                                      i.attempt.usage?.resolution,
                                      i.attempt.usage?.ratio,
                                      i.attempt.usage?.duration &&
                                        i.attempt.usage.duration + " 秒",
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </small>
                                  <a
                                    href={
                                      "/api/v1" +
                                      c.base +
                                      "/assets/" +
                                      i.attempt.resultAssetId +
                                      "/file"
                                    }
                                    download={project.data.name + ".mp4"}
                                  >
                                    下载 MP4
                                  </a>
                                  {canCreate && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setFrameVideo(i.attempt.resultAssetId)
                                      }
                                    >
                                      截取视频帧
                                    </button>
                                  )}

                                  {canGenerate && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const request = b.snapshot.request;
                                        patch({
                                          mode: "video",
                                          video: {
                                            prompt: request.instruction,
                                            options: request.video,
                                            frame: request.referenceAssetId
                                              ? referenceFrom(
                                                  request.referenceAssetId,
                                                  "视频首帧",
                                                )
                                              : undefined,
                                          },
                                        });
                                        input.current?.focus();
                                      }}
                                    >
                                      复用参数
                                    </button>
                                  )}
                                </div>
                              )}
                            {mediaActive.includes(i.status) && (
                              <span>生成完成后会自动显示，无需重复提交。</span>
                            )}
                            {i.status === "failed" && (
                              <span>
                                本次生成未完成。调整需求后可手动重新提交。
                              </span>
                            )}
                            {i.status === "needs_reconciliation" && (
                              <span>
                                原请求结果待核实，请联系企业管理员核对，避免重复费用。
                              </span>
                            )}
                            {i.status === "queued" && canGenerate && (
                              <button
                                disabled={action.busy}
                                onClick={() =>
                                  void action.run(async () => {
                                    await api.post(
                                      c.base + "/items/" + i.id + "/cancel",
                                    );
                                    await batches.reload();
                                  })
                                }
                              >
                                停止排队
                              </button>
                            )}
                          </div>
                        ))}
                      </section>
                    ))}
                  <Pager
                    result={batches}
                    page={batchPage}
                    setPage={setBatchPage}
                  />
                </Result>
                {arts.data?.total === 0 &&
                  !batches.data?.items.some((b: any) =>
                    b.items.some((i: any) => i.attempt?.resultAssetId),
                  ) &&
                  !working &&
                  !batches.loading && (
                    <div className="studio-no-results">
                      <SparkleIcon size={28} aria-hidden="true" />
                      <p>暂无生成结果</p>
                    </div>
                  )}
              </>
            )}
          </Result>
          <div ref={resultEnd} />
        </div>
      ) : (
        <section className="studio-welcome">
          <h1>{imageMode ? "图片创作" : "视频创作"}</h1>
        </section>
      )}
      <section className="studio-composer-wrap" aria-label="创作输入">
        <Notice text={action.error ?? upload.error} />
        {feedback && (
          <p className="studio-feedback" role="status">
            {feedback}
          </p>
        )}
        {uncertain && (
          <div className="studio-submission-warning" role="alert">
            上次提交状态待核实，已暂停新请求。恢复会沿用原请求编号。
            <button disabled={action.busy} onClick={checkSubmission}>
              恢复原提交
            </button>
          </div>
        )}
        <form className="studio-composer" onSubmit={submit}>
          <div className="studio-composer-input">
            {(canAttach || inputReferences.length > 0) && (
              <div className="studio-input-references">
                {inputReferences.map((image, index) => (
                  <ReferenceAttachment
                    key={image.id}
                    image={image}
                    disabled={pending}
                    onRemove={() => {
                      if (!imageMode) {
                        patchVideo({
                          frame: undefined,
                          options: { ...video.options, ratio: "16:9" },
                        });
                        return;
                      }
                      const [reference, ...extraReferences] = references.filter(
                        (_, n) => n !== index,
                      );
                      patch({ reference, extraReferences, region: undefined });
                    }}
                  />
                ))}
                {canAttach && (
                  <StudioDropdown
                    label={uploadLabel}
                    icon={<PlusIcon size={inputReferences.length ? 18 : 29} aria-hidden="true" />}
                    triggerClassName="studio-reference-trigger"
                    disabled={pending}
                  >
                    {(close) => (
                      <>
                        <button
                          type="button"
                          className="studio-dropdown-row"
                          onClick={() => {
                            close();
                            uploadInput.current?.click();
                          }}
                        >
                          <UploadSimpleIcon size={17} aria-hidden="true" />
                          <span>本地上传</span>
                        </button>
                        <button
                          type="button"
                          className="studio-dropdown-row"
                          onClick={() => {
                            close();
                            setAttachOpen(true);
                          }}
                        >
                          <FolderOpenIcon size={17} aria-hidden="true" />
                          <span>从素材库选择</span>
                        </button>
                        {!imageMode && (
                          <p className="studio-reference-menu-note">
                            此模型会将参考图用作起始画面。
                          </p>
                        )}
                      </>
                    )}
                  </StudioDropdown>
                )}
              </div>
            )}
            <textarea
              ref={input}
              aria-label="创作需求"
              maxLength={2000}
              disabled={pending || !canCreate}
              placeholder={
                imageMode
                  ? references.length
                    ? "描述修改要求…"
                    : "描述你想生成的画面，也可添加参考图…"
                  : "描述视频内容和镜头运动，也可添加参考图…"
              }
              value={prompt}
              onChange={(e) =>
                imageMode
                  ? patch({ prompt: e.target.value })
                  : patchVideo({ prompt: e.target.value })
              }
              onKeyDown={(e) => {
                if (
                  (e.metaKey || e.ctrlKey) &&
                  e.key === "Enter" &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </div>
          {imageMode && activeRegion && draft.reference && (
            <div className="studio-region-controls">
              <button
                type="button"
                disabled={pending}
                onClick={() => setRegionImage(draft.reference!)}
              >
                调整选区
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => patch({ region: undefined })}
              >
                清除选区
              </button>
            </div>
          )}
          <div className={id ? "studio-composer-tools" : "studio-composer-tools studio-home-toolbar"}>
            {!id ? (
              <div className="studio-parameters">
                <StudioDropdown
                  label="创作类型"
                  summary={imageMode ? "图片生成" : "视频生成"}
                  icon={imageMode
                    ? <ImageIcon size={16} aria-hidden="true" />
                    : <FilmSlateIcon size={16} aria-hidden="true" />}
                  disabled={pending}
                >
                  {(close) => creationTypes
                    .filter(({ value }) => value !== "assistant" || canGenerate)
                    .map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        type="button"
                        className="studio-dropdown-row"
                        aria-pressed={value === "assistant" ? undefined : mode === value}
                        onClick={() => {
                          close();
                          changeMode(value);
                        }}
                      >
                        <Icon size={17} aria-hidden="true" />
                        <span>{label}</span>
                        {mode === value && <CheckIcon size={16} aria-hidden="true" />}
                      </button>
                    ))}
                </StudioDropdown>
                <StudioDropdown
                  label="企业模型"
                  summary={modelReady ? modelSummary : "模型未配置"}
                  icon={<CubeIcon size={16} aria-hidden="true" />}
                  disabled={pending}
                >
                  {() => (
                    <>
                      <div className="studio-dropdown-row studio-model-detail">
                        <CubeIcon size={18} aria-hidden="true" />
                        <div>
                          <strong>{modelSummary}</strong>
                          <small>{modelDescription === modelSummary ? "当前企业模型" : modelDescription}</small>
                        </div>
                        {modelReady && <CheckIcon size={16} aria-hidden="true" />}
                      </div>
                      <p className="studio-model-note">参考图片会发送至企业配置的模型服务。</p>
                      {c.isTenantAdmin && (
                        <a className="studio-dropdown-row" href={c.adminUrl + "?tab=services#enterprise-models"}>
                          管理模型
                        </a>
                      )}
                    </>
                  )}
                </StudioDropdown>
                {mediaOptions}
                {brandToggle}
              </div>
            ) : (
              <div className="studio-parameters">
                <DropdownSelect
                  aria-label="创作类型"
                  value={mode}
                  disabled={pending}
                  onChange={(event) => changeMode(event.target.value as MediaMode | "assistant")}
                >
                  <option value="image">图片生成</option>
                  <option value="video">视频生成</option>
                  {canGenerate && <option value="assistant">创作助手</option>}
                </DropdownSelect>
                {mediaOptions}
                <button
                  type="button"
                  onClick={() => setSkillsOpen(true)}
                  disabled={pending || !canCreate}
                >
                  提示词模板
                </button>
                {brandToggle}
              </div>
            )}
            <button
              type="submit"
              className="studio-submit"
              disabled={
                !prompt.trim() ||
                pending ||
                uncertain ||
                !canGenerate ||
                !modelReady ||
                (id ? !project.data : false)
              }
              aria-label={
                upload.busy
                  ? "正在上传"
                  : action.busy
                    ? "正在提交"
                    : imageMode
                      ? "生成图片"
                      : "生成视频"
              }
              title="提交生成（⌘/Ctrl + Enter）"
            >
              <ArrowUpIcon size={22} weight="bold" aria-hidden="true" />
              <span>{imageMode ? "生成图片" : "生成视频"}</span>
            </button>
          </div>
          {showContext && (
            <div className="studio-context-panel">
              <label className="studio-brand-search">
                搜索品牌
                <input
                  aria-label="搜索品牌"
                  placeholder="品牌名称"
                  value={brandQuery}
                  onChange={(e) => {
                    setBrandQuery(e.target.value);
                    setBrandPage(1);
                  }}
                />
              </label>
              <label>
                关联品牌
                <DropdownSelect
                  aria-label="关联品牌"
                  disabled={pending || brands.loading}
                  value={draft.brandId}
                  onChange={(e) => {
                    const b = brands.data?.items.find(
                      (x: any) => x.id === e.target.value,
                    );
                    patch({
                      brandId: b?.id ?? "",
                      brandVersion: b?.publishedVersion,
                      brandName: b?.name,
                    });
                  }}
                >
                  <option value="">
                    {project.data?.brief.brandId ? "沿用项目品牌" : "暂不关联"}
                  </option>
                  {draft.brandId &&
                    !brands.data?.items.some(
                      (b: any) => b.id === draft.brandId,
                    ) && (
                      <option value={draft.brandId}>
                        {draft.brandName ?? "已选品牌"} · v{draft.brandVersion}
                      </option>
                    )}
                  {brands.data?.items
                    .filter((b: any) => b.publishedVersion)
                    .map((b: any) => (
                      <option key={b.id} value={b.id}>
                        {b.name} · v{b.publishedVersion}
                      </option>
                    ))}
                </DropdownSelect>
              </label>
              <Link to={c.prefix + "/brands"}>管理品牌资料</Link>
              <Pager result={brands} page={brandPage} setPage={setBrandPage} />
              {brands.error && (
                <span role="alert">
                  品牌读取失败，
                  <button type="button" onClick={() => void brands.reload()}>
                    重试
                  </button>
                </span>
              )}
            </div>
          )}
        </form>
        <input
          ref={uploadInput}
          className="studio-file-input"
          aria-label="上传参考图片"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple={imageMode && maxReferences - references.length > 1}
          disabled={pending || !canAttach}
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? []);
            e.currentTarget.value = "";
            attachFiles(files);
          }}
        />
        {(upload.busy || !canGenerate || !modelReady) && (
          <p className="studio-composer-footnote" role="status">
            {upload.busy
              ? "正在上传参考图…"
              : !canGenerate
                ? "当前账号没有生成权限"
                : c.isTenantAdmin
                  ? <>当前模式的模型未配置 · <a href={c.adminUrl + "?tab=services#enterprise-models"}>配置模型</a></>
                  : "当前模式的模型未配置，请联系企业管理员"}
          </p>
        )}
      </section>
      {!hasResults && (
        <section className="studio-examples" aria-label="创作灵感">
          <div className="studio-examples-heading">
            <h2>创作灵感</h2>
            <button type="button" disabled={pending || !canCreate} onClick={() => setSkillsOpen(true)}>
              提示词模板
            </button>
          </div>
          <div>
            {(mode === "video" ? videoExamples : examples).map((example) => (
              <button
                key={example.title}
                aria-label={"使用示例：" + example.title}
                disabled={pending || !canCreate}
                onClick={() => {
                  if (mode === "video")
                    patch({ video: { ...video, prompt: example.prompt } });
                  else patch({ mode: "image", prompt: example.prompt });
                  input.current?.focus();
                }}
              >
                <strong>{example.title}</strong>
                <PencilSimpleIcon size={18} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      )}
      <Dialog
        open={attachOpen}
        title="从素材库选择参考图"
        onClose={() => setAttachOpen(false)}
      >
        <div className="canvas-asset-scopes">
          <button
            type="button"
            aria-pressed={assetScope === "shared"}
            onClick={() => {
              setAssetScope("shared");
              setAssetPage(1);
            }}
          >
            企业资产
          </button>
          {id && (
            <button
              type="button"
              aria-pressed={assetScope === "project"}
              onClick={() => {
                setAssetScope("project");
                setAssetPage(1);
              }}
            >
              当前项目
            </button>
          )}
        </div>
        <EntitySelect<{ id: string; name: string; data: { imageId?: string } }>
          path={c.base + "/documents/product"}
          label="选择主体"
          value=""
          format={(product) => product.name}
          filter={(product) => !!product.data.imageId}
          onChange={(_, product) => {
            if (product?.data.imageId)
              attach(referenceFrom(product.data.imageId, product.name));
          }}
        />
        <input
          type="search"
          aria-label="搜索参考图片"
          placeholder="搜索参考图片"
          maxLength={100}
          value={assetQuery}
          onChange={(event) => {
            setAssetQuery(event.target.value);
            setAssetPage(1);
          }}
        />
        <Result result={assets}>
          <div className="canvas-asset-grid">
            {assets.data?.items.map((asset: any) => (
              <button
                type="button"
                key={asset.id}
                onClick={() => attach(referenceFrom(asset.id, asset.filename))}
              >
                <img
                  src={referenceFrom(asset.id, asset.filename).preview}
                  alt=""
                />
                <span>{asset.filename}</span>
              </button>
            ))}
          </div>
          {assets.data?.total === 0 && (
            <p role="status">
              {assetQuery ? "没有匹配的图片" : "暂无可选图片"}
            </p>
          )}
          <Pager result={assets} page={assetPage} setPage={setAssetPage} />
        </Result>
      </Dialog>
      <Dialog
        open={skillsOpen}
        title="提示词模板"
        onClose={() => setSkillsOpen(false)}
      >
        <Field label="搜索模板">
          <input
            value={skillQuery}
            onChange={(e) => setSkillQuery(e.target.value)}
          />
        </Field>
        {creationTemplates
          .filter((item) => item.title.includes(skillQuery.trim()))
          .map((item) => (
            <button
              type="button"
              key={item.title}
              onClick={() => {
                if (item.mode === "video")
                  patch({
                    mode: "video",
                    video: { ...video, prompt: item.prompt },
                  });
                else patch({ mode: "image", prompt: item.prompt });
                setSkillsOpen(false);
              }}
            >
              {item.title}
            </button>
          ))}
      </Dialog>
      {imageTools && (
        <ImageToolsDialog
          image={imageTools}
          projectId={id}
          onClose={() => setImageTools(null)}
          onSaved={async () => {
            setImageTools(null);
            setArtPage(1);
            await arts.reload();
            setFeedback("已保存为新图片");
          }}
        />
      )}
      {frameVideo && (
        <VideoFrameDialog
          assetId={frameVideo}
          projectId={id}
          onClose={() => setFrameVideo(null)}
          onSaved={(asset) => {
            patch({
              mode: "image",
              reference: referenceFrom(asset.id, asset.filename),
              extraReferences: [],
              region: undefined,
            });
            setFrameVideo(null);
            setFeedback("已保存视频帧并加入图片参考");
          }}
        />
      )}
      {regionImage && (
        <ImageRegionDialog
          image={{
            name: regionImage.name,
            url: "/api/v1" + c.base + "/assets/" + regionImage.id + "/file",
          }}
          initialRegion={
            regionImage.id === draft.reference?.id ? activeRegion : undefined
          }
          onClose={() => setRegionImage(null)}
          onSelect={(region) => {
            patch({
              mode: "image",
              reference: regionImage,
              extraReferences: [],
              region,
            });
            setRegionImage(null);
            setFeedback("已选定修改范围");
          }}
        />
      )}
      <Dialog
        open={!!detail}
        title="图片详情"
        size="large"
        onClose={() => setDetail(null)}
      >
        {detail && (
          <div className="studio-detail">
            <div className="studio-detail-preview">
              {compare ? (
                <div className="studio-image-compare">
                  <figure>
                    <img
                      src={"/api/v1" + c.base + "/assets/" + compare + "/file"}
                      alt="对比图"
                    />
                    <figcaption>对比图</figcaption>
                  </figure>
                  <figure>
                    {media(detail, true)}
                    <figcaption>当前结果</figcaption>
                  </figure>
                </div>
              ) : (
                media(detail, true)
              )}
            </div>
            <aside>
              <span className="studio-detail-label">图片提示词</span>
              <p>
                {detail.versions[0].data.source?.prompt ||
                  project.data?.brief.prompt}
              </p>
              <small>{pictureReceipt(detail)}</small>
              {detail.versions[0].data.backgroundId && (
                <Field label="对比图片">
                  <DropdownSelect
                    value={compare}
                    onChange={(event) => setCompare(event.target.value)}
                  >
                    <option value="">选择原图或候选图</option>
                    {(() => {
                      const source = detail.versions[0].data.source;
                      const original =
                        source?.referenceAssetIds?.[0] ??
                        source?.referenceAssetId;
                      return (
                        original && <option value={original}>原参考图</option>
                      );
                    })()}
                    {arts.data?.items
                      .filter(
                        (art: any) =>
                          art.id !== detail.id &&
                          art.versions[0].data.backgroundId,
                      )
                      .map((art: any) => (
                        <option
                          key={art.id}
                          value={art.versions[0].data.backgroundId}
                        >
                          {art.name}
                        </option>
                      ))}
                  </DropdownSelect>
                </Field>
              )}
              <div className="studio-detail-actions">
                {download(detail)}
                {canCreate &&
                  detail.versions[0].data.source?.workflow === "studio" &&
                  detail.versions[0].data.backgroundId && (
                    <button
                      type="button"
                      onClick={() => {
                        setImageTools({
                          id: detail.versions[0].data.backgroundId,
                          name: detail.name,
                        });
                        setDetail(null);
                      }}
                    >
                      图片工具
                    </button>
                  )}
                {canCreate && detail.versions[0].data.backgroundId && (
                  <AddToCanvas
                    assetId={detail.versions[0].data.backgroundId}
                    projectId={id}
                  />
                )}
                {canGenerate && (
                  <>
                    <button
                      onClick={() => useReference(detail)}
                      disabled={
                        !detail.versions[0].data.backgroundId || pending
                      }
                    >
                      <ImageIcon size={18} aria-hidden="true" />
                      用作参考图
                    </button>
                    {detail.versions[0].data.backgroundId && (
                      <>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            setRegionImage(
                              referenceFrom(
                                detail.versions[0].data.backgroundId,
                                detail.name,
                              ),
                            );
                            setDetail(null);
                          }}
                        >
                          局部改图
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => useReference(detail, "video")}
                        >
                          生成视频
                        </button>
                        <details className="studio-edit-presets">
                          <summary>改图模板</summary>
                          <button
                            type="button"
                            onClick={() =>
                              useReference(
                                detail,
                                "image",
                                "保留产品外观、位置和构图，将背景替换为干净的浅米色商业摄影背景。",
                              )
                            }
                          >
                            更换背景
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              useReference(
                                detail,
                                "image",
                                "保持产品外观与背景，改为柔和的左侧自然光，保留真实的阴影和材质。",
                              )
                            }
                          >
                            调整光线
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              useReference(
                                detail,
                                "image",
                                "保留商品型号、材质与标识，用四分之三视角呈现同一件产品。",
                              )
                            }
                          >
                            变换视角
                          </button>
                        </details>
                      </>
                    )}

                    {!detail.versions[0].data.source?.operation && (
                      <button
                        onClick={() => editAgain(detail)}
                        disabled={pending}
                      >
                        <ArrowCounterClockwiseIcon
                          size={18}
                          aria-hidden="true"
                        />
                        重新编辑提示词
                      </button>
                    )}
                  </>
                )}
              </div>
              <InfoTip label="修改图片的方式">
                用作参考图会添加当前图片；重新编辑会回填提示词。点击生成图片后才会产生新结果和模型费用，原图保留。
              </InfoTip>
            </aside>
          </div>
        )}
      </Dialog>
      <Dialog
        open={renameOpen}
        title="重命名创作"
        busy={projectAction.busy}
        dirtyCheck
        onClose={() => setRenameOpen(false)}
      >
        <form
          className="studio-rename"
          onSubmit={(e) => {
            e.preventDefault();
            void projectAction.run(async () => {
              const p = project.data;
              await api.put(c.base + "/projects/" + id, {
                version: p.version,
                name: projectName.trim(),
                visibility: p.visibility,
                participants: p.participants,
                brief: p.brief,
              });
              await project.reload();
              window.dispatchEvent(new Event("content-projects-changed"));
              setRenameOpen(false);
            });
          }}
        >
          <label>
            创作名称
            <input
              aria-label="创作名称"
              value={projectName}
              required
              maxLength={120}
              disabled={projectAction.busy}
              onChange={(e) => setProjectName(e.target.value)}
            />
          </label>
          <Notice text={projectAction.error} />
          <button
            className="primary"
            disabled={!projectName.trim() || projectAction.busy}
          >
            保存名称
          </button>
        </form>
      </Dialog>
      <ConfirmDialog
        open={archiveOpen}
        title="移入回收站？"
        description="创作记录和图片会保留，可从回收站恢复。"
        confirmLabel="移入回收站"
        busy={projectAction.busy}
        error={projectAction.error}
        onCancel={() => setArchiveOpen(false)}
        onConfirm={() =>
          void projectAction.run(async () => {
            await api.del(c.base + "/projects/" + id);
            window.dispatchEvent(new Event("content-projects-changed"));
            setArchiveOpen(false);
            nav(c.prefix);
          })
        }
      />
    </div>
  );
}
