import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useApiData } from "../hooks";
import {
  EntitySelect,
  ChoiceSelect,
  Field,
  Notice,
  Dialog,
  DialogAction,
} from "../components";
import {
  useContent,
  useAction,
  useDirty,
  FileInput,
  status,
  key,
} from "./content-ui";
import { ArtworkPreview } from "./ArtworkPreview";
import { artworkHash, useEditorHistory, useWorkDraft } from "./editor-state";
import { InfoTip } from "@suite/frontend/components";
export function ArtifactEditor({
  artifact,
  current,
  project,
  onSaved,
  onPreview,
  onVersion,
}: {
  artifact: any;
  current: any;
  project: any;
  onSaved: () => Promise<unknown>;
  onPreview: (v: any) => void;
  onVersion: (n: number) => void;
}) {
  const c = useContent(),
    a = useAction(),
    [selected, setSelected] = useState(current.data.layers[0]?.id ?? ""),
    [compare, setCompare] = useState(false),
    [local, setLocal] = useState(false),
    [region, setRegion] = useState({ x: 0.1, y: 0.1, w: 0.4, h: 0.4 }),
    [instruction, setInstruction] = useState(""),
    [note, setNote] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateDialog, setTemplateDialog] = useState(false);
  const history = useEditorHistory(current.data),
    { data, setData } = history;
  const canCreate = c.meta.permissions.includes("content.create"),
    manager = c.meta.permissions.includes("content.manage");
  const latest = current.version === artifact.version;
  const draft = useWorkDraft({
    base: c.base,
    membershipId: c.meta.membershipId,
    artifact,
    current,
    project,
    data,
    reset: history.reset,
    enabled: canCreate && latest,
  });
  const canEdit =
    canCreate && latest && draft.ready && !draft.blocked && !a.busy;
  const dirty = JSON.stringify(data) !== JSON.stringify(current.data),
    guard = useDirty(canCreate && draft.unsynced);
  const l = data.layers.find((x: any) => x.id === selected);
  const patchLayer = (layerId: string, changes: any) =>
    setData((d: any) => ({
      ...d,
      layers: d.layers.map((x: any) =>
        x.id === layerId ? { ...x, ...changes } : x,
      ),
    }));
  const patch = (changes: any) => patchLayer(selected, changes);
  const nav = useNavigate();
  const [layout, setLayout] = useState<any>(null),
    [zoom, setZoom] = useState(100),
    [discard, setDiscard] = useState(false);
  const suggestions = useApiData<any[]>(
    canCreate
      ? c.base + "/artifacts/" + artifact.id + "/copy-suggestions"
      : null,
  );
  const [candidate, setCandidate] = useState<any>(null),
    [merge, setMerge] = useState<any>(null),
    [mergeFields, setMergeFields] = useState<Record<string, boolean>>({});
  const openMerge = () =>
    void a.run(async () => {
      const snapshot: any = await api.get(
        c.base + "/artifacts/" + artifact.id + "/draft",
      );
      const target =
        !snapshot.conflict && snapshot.draft
          ? snapshot.draft.data
          : snapshot.current.data;
      setMerge({ snapshot, target, local: structuredClone(data) });
      setMergeFields({});
    });
  const compareVersion = Math.max(1, current.version - 1 || artifact.version);
  const previous = useApiData<any>(
    compare && artifact.version > 1
      ? c.base + "/artifacts/" + artifact.id + "/versions/" + compareVersion
      : null,
  );
  useEffect(() => {
    const reload = () => void suggestions.reload();
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [suggestions.reload]);
  const save = () =>
    void a.run(async () => {
      history.end();
      const revision = await draft.flush();
      const result: any = await api.put(c.base + "/artifacts/" + artifact.id, {
        version: current.version,
        projectVersion: project.version,
        draftRevision: revision,
        data,
      });
      draft.clear();
      await onSaved();
      onVersion(result.version);
    });
  const draftLabels: Record<string, string> = {
    loading: "载入工作草稿…",
    history: "历史版本，仅查看",
    synced: dirty ? "工作草稿已同步 · 尚未保存正式版本" : "已同步",
    local: "修改待同步",
    syncing: "正在同步草稿…",
    offline: "尚未同步，已保留在本标签页",
    unavailable: "草稿载入失败",
    invalid: "草稿未同步，请修正输入",
    conflict: "版本冲突，当前编辑已保留",
    denied: "访问权限已变化",
  };
  const review = (action: string) =>
    void a.run(async () => {
      await api.post(c.base + "/artifacts/" + artifact.id + "/review", {
        version: current.version,
        action,
        note,
      });
      await onSaved();
    });
  return (
    <div
      className="content-editor"
      onKeyDown={(e) => {
        if (!canEdit || e.nativeEvent.isComposing || !(e.ctrlKey || e.metaKey))
          return;
        const target = e.target as HTMLElement;
        if (target.closest("input,textarea,[contenteditable=true]")) return;
        if (e.key.toLowerCase() === "z") {
          e.preventDefault();
          e.shiftKey ? history.redo() : history.undo();
        }
        if (e.key.toLowerCase() === "y") {
          e.preventDefault();
          history.redo();
        }
      }}
    >
      <div className="content-editor-toolbar">
        <div>
          <strong>{artifact.name}</strong>
          <span>
            {status(current.status)} · {data.width}×{data.height}
          </span>
        </div>
        <div className="content-actions">
          <EntitySelect<any>
            label="作品版本"
            clearable={false}
            value={current.id}
            selectedLabel={`v${current.version} · ${status(current.status)}`}
            path={c.base + "/artifacts/" + artifact.id + "/versions"}
            format={(v) => `v${v.version} · ${status(v.status)}`}
            onChange={(_, v) => {
              if (v)
                void a.run(async () => {
                  if (canCreate && latest) await draft.flush();
                  onVersion(v.version);
                });
            }}
          />
          <button
            onClick={() => setCompare(true)}
            disabled={artifact.version < 2}
          >
            对比版本
          </button>
        </div>
      </div>
      <div className="content-edit-controls">
        <div className="content-actions">
          <button
            disabled={!canEdit || !history.canUndo}
            onClick={history.undo}
          >
            撤销
          </button>
          <button
            disabled={!canEdit || !history.canRedo}
            onClick={history.redo}
          >
            重做
          </button>
          <ChoiceSelect
            label="作品尺寸"
            value={data.height}
            disabled={!canEdit}
            onChange={(e) =>
              setData((d: any) => ({
                ...d,
                width: 1080,
                height: Number(e.target.value),
              }))
            }
          >
            <option value={1080}>方图</option>
            <option value={1440}>竖版海报</option>
            <option value={1920}>全屏竖图</option>
          </ChoiceSelect>
          <ChoiceSelect
            label="预览缩放"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            <option value={100}>适应画布</option>
            <option value={150}>150%</option>
            <option value={200}>200%</option>
          </ChoiceSelect>
        </div>
        <span role="status" aria-live="polite">
          {draftLabels[draft.state]}
        </span>
        {canCreate &&
          latest &&
          ["offline", "unavailable"].includes(draft.state) && (
            <button
              onClick={() =>
                draft.state === "unavailable"
                  ? window.location.reload()
                  : void draft.retry().catch(() => {})
              }
            >
              重试同步
            </button>
          )}
        {canCreate && (draft.state === "conflict" || (!latest && dirty)) && (
          <button onClick={openMerge} disabled={a.busy}>
            比较并采用当前编辑
          </button>
        )}
        {canCreate && latest && (dirty || draft.blocked) && (
          <button onClick={() => setDiscard(true)}>舍弃工作草稿</button>
        )}
      </div>
      <Notice text={draft.error} />
      {layout?.error ? (
        <div>
          <Notice text={layout.error} />
          <button onClick={layout.retry}>重新核对排版</button>
        </div>
      ) : layout?.issues?.length > 0 ? (
        <div className="content-layout-issues" role="alert">
          {layout.issues.map((issue: any, i: number) => (
            <button key={i} onClick={() => setSelected(issue.id)}>
              {(
                {
                  title: "标题",
                  body: "卖点",
                  price: "价格",
                  date: "有效期",
                  disclaimer: "声明",
                  cta: "行动语",
                  product: "产品",
                  logo: "Logo",
                } as any
              )[data.layers.find((l: any) => l.id === issue.id)?.role] ??
                "图层"}
              ：{issue.message}
            </button>
          ))}
          <small>请修正版式后交付；无需重新生图。</small>
        </div>
      ) : (
        <span className="content-layout-state">
          {layout ? "排版已核对" : "排版校验中…"}
        </span>
      )}
      <div className="content-editor-body">
        <div className="content-preview-stage">
          <div
            className="content-zoom-surface"
            style={{ width: `${zoom}%`, ["--content-zoom" as any]: zoom / 100 }}
          >
            <ArtworkPreview
              data={data}
              artifactId={artifact.id}
              editable={canEdit}
              onPatch={patchLayer}
              onGesture={(phase) =>
                phase === "begin" ? history.begin() : history.end()
              }
              onLayout={setLayout}
              selected={local ? undefined : selected}
              onLayer={setSelected}
              region={local ? region : undefined}
              onRegion={local ? setRegion : undefined}
            />
          </div>
        </div>
        <aside className="content-inspector">
          <div className="content-actions">
            <button aria-pressed={!local} onClick={() => setLocal(false)}>
              图层
            </button>
            {canEdit && (
              <button
                aria-pressed={local}
                disabled={!data.backgroundId || dirty}
                onClick={() => setLocal(true)}
              >
                局部背景
              </button>
            )}
          </div>
          {!local ? (
            <>
              <ChoiceSelect
                label="选择图层"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                {data.layers.map((x: any) => (
                  <option key={x.id} value={x.id}>
                    {(
                      {
                        title: "标题",
                        body: "卖点",
                        price: "价格",
                        date: "有效期",
                        disclaimer: "声明",
                        cta: "行动语",
                        product: "产品",
                        logo: "Logo",
                      } as any
                    )[x.role] ?? x.role}
                    {x.locked ? " · 已锁定" : ""}
                  </option>
                ))}
              </ChoiceSelect>
              {l && (
                <fieldset
                  disabled={!canEdit || (l.locked && !manager)}
                  onFocusCapture={history.begin}
                  onBlurCapture={history.end}
                >
                  {l.type === "text" ? (
                    <>
                      <Field label="文字">
                        <textarea
                          value={l.text ?? ""}
                          maxLength={2000}
                          onChange={(e) => patch({ text: e.target.value })}
                        />
                      </Field>
                      <Field label="字号">
                        <input
                          type="number"
                          min={10}
                          max={150}
                          value={l.fontSize}
                          onChange={(e) =>
                            patch({ fontSize: Number(e.target.value) })
                          }
                        />
                      </Field>
                      <Field label="颜色">
                        <input
                          type="color"
                          value={l.color}
                          onChange={(e) => patch({ color: e.target.value })}
                        />
                      </Field>
                    </>
                  ) : (
                    <FileInput
                      label="替换图片"
                      onUpload={async (filename, b64) => {
                        const r: any = await api.post(c.base + "/assets", {
                          filename,
                          data: b64,
                          projectId: project.id,
                          shared: false,
                        });
                        patch({ assetId: r.id });
                      }}
                    />
                  )}
                  <div className="content-position-grid">
                    {["x", "y", "w", "h"].map((k) => (
                      <Field
                        key={k}
                        label={
                          (
                            {
                              x: "横向位置",
                              y: "纵向位置",
                              w: "宽度",
                              h: "高度",
                            } as any
                          )[k] + " %"
                        }
                      >
                        <input
                          type="number"
                          min={k === "w" || k === "h" ? 1 : 0}
                          max={100}
                          step={1}
                          value={Math.round(l[k] * 100)}
                          onChange={(e) =>
                            patch({ [k]: Number(e.target.value) / 100 })
                          }
                        />
                      </Field>
                    ))}
                  </div>
                  <div className="content-actions" aria-label="对齐图层">
                    <button disabled={l.locked} onClick={() => patch({ x: 0 })}>
                      左对齐
                    </button>
                    <button
                      disabled={l.locked}
                      onClick={() => patch({ x: (1 - l.w) / 2 })}
                    >
                      水平居中
                    </button>
                    <button
                      disabled={l.locked}
                      onClick={() => patch({ y: (1 - l.h) / 2 })}
                    >
                      垂直居中
                    </button>
                    <button
                      disabled={l.locked}
                      onClick={() => patch({ x: 1 - l.w })}
                    >
                      右对齐
                    </button>
                  </div>
                  <div className="content-actions" aria-label="图层顺序">
                    <button
                      disabled={
                        l.locked ||
                        data.layers.findIndex((x: any) => x.id === selected) ===
                          data.layers.length - 1
                      }
                      onClick={() =>
                        setData((d: any) => {
                          const layers = [...d.layers],
                            i = layers.findIndex((x: any) => x.id === selected);
                          [layers[i], layers[i + 1]] = [
                            layers[i + 1],
                            layers[i],
                          ];
                          return { ...d, layers };
                        })
                      }
                    >
                      上移一层
                    </button>
                    <button
                      disabled={
                        l.locked ||
                        data.layers.findIndex((x: any) => x.id === selected) ===
                          0
                      }
                      onClick={() =>
                        setData((d: any) => {
                          const layers = [...d.layers],
                            i = layers.findIndex((x: any) => x.id === selected);
                          [layers[i], layers[i - 1]] = [
                            layers[i - 1],
                            layers[i],
                          ];
                          return { ...d, layers };
                        })
                      }
                    >
                      下移一层
                    </button>
                  </div>
                  {l.type === "image" && (
                    <details>
                      <summary>图片裁剪</summary>
                      <div className="content-position-grid">
                        {["x", "y", "w", "h"].map((k) => (
                          <Field
                            key={k}
                            label={
                              (
                                {
                                  x: "裁剪左侧",
                                  y: "裁剪顶部",
                                  w: "保留宽度",
                                  h: "保留高度",
                                } as any
                              )[k] + " %"
                            }
                          >
                            <input
                              type="number"
                              min={k === "w" || k === "h" ? 1 : 0}
                              max={100}
                              value={Math.round(
                                (l.crop ?? { x: 0, y: 0, w: 1, h: 1 })[k] * 100,
                              )}
                              onChange={(e) => {
                                const crop = {
                                  ...(l.crop ?? { x: 0, y: 0, w: 1, h: 1 }),
                                  [k]: Number(e.target.value) / 100,
                                };
                                crop.x = Math.max(0, Math.min(0.99, crop.x));
                                crop.y = Math.max(0, Math.min(0.99, crop.y));
                                crop.w = Math.max(
                                  0.01,
                                  Math.min(1 - crop.x, crop.w),
                                );
                                crop.h = Math.max(
                                  0.01,
                                  Math.min(1 - crop.y, crop.h),
                                );
                                patch({ crop });
                              }}
                            />
                          </Field>
                        ))}
                      </div>
                      <button onClick={() => patch({ crop: undefined })}>
                        重置裁剪
                      </button>
                    </details>
                  )}
                  {manager && (
                    <label>
                      <input
                        type="checkbox"
                        checked={l.locked}
                        onChange={(e) => patch({ locked: e.target.checked })}
                      />
                      锁定图层
                    </label>
                  )}
                </fieldset>
              )}
              <details>
                <summary>交付文字稿</summary>
                <pre className="content-copy-preview">
                  {[data.copy.title, data.copy.body, data.copy.cta]
                    .filter(Boolean)
                    .join("\n\n")}
                </pre>
                <InfoTip label="文字稿的修改方式">
                  文字稿与画面文字同步，选择文字图层修改。
                </InfoTip>
              </details>
              {canCreate && latest && (
                <section className="content-copy-suggestions">
                  <button
                    disabled={
                      !canEdit || !c.meta.permissions.includes("content.ai.use")
                    }
                    onClick={() =>
                      void a.run(async () => {
                        await draft.flush();
                        const prompt = `请为当前引用作品《${artifact.name}》提供3个标题候选，按品牌语气表达，保存候选供我比较采用，保留价格、日期、规格和声明。`;
                        nav(
                          c.prefix +
                            "/ai?type=artifact&id=" +
                            artifact.id +
                            "&returnTo=" +
                            encodeURIComponent(
                              c.prefix +
                                "/projects/" +
                                project.id +
                                "?artifact=" +
                                artifact.id +
                                "&version=" +
                                current.version,
                            ) +
                            "&draftPrompt=" +
                            encodeURIComponent(prompt),
                        );
                      })
                    }
                  >
                    获取文案建议
                  </button>
                  <Notice text={suggestions.error} />
                  <button
                    disabled={suggestions.loading}
                    onClick={() => void suggestions.reload()}
                  >
                    刷新建议
                  </button>
                  {suggestions.data?.flatMap((s) =>
                    s.candidates.map((item: any, index: number) => (
                      <button
                        key={s.id + ":" + index}
                        disabled={!canEdit}
                        onClick={() =>
                          setCandidate({ suggestion: s, item, index })
                        }
                      >
                        {item.label} · 查看差异
                      </button>
                    )),
                  )}
                </section>
              )}
              {canEdit && (
                <button
                  className="primary"
                  disabled={!dirty || !canEdit || !layout || !!layout.error}
                  onClick={save}
                >
                  保存新版本
                </button>
              )}
            </>
          ) : (
            <>
              <InfoTip label="背景选区操作">
                拖动画面选择区域，或输入选区百分比。
              </InfoTip>
              <div className="content-position-grid">
                {["x", "y", "w", "h"].map((k) => (
                  <Field key={k} label={k + " %"}>
                    <input
                      type="number"
                      min={k === "w" || k === "h" ? 1 : 0}
                      max={100}
                      value={Math.round((region as any)[k] * 100)}
                      onChange={(e) =>
                        setRegion((r) => ({
                          ...r,
                          [k]: Number(e.target.value) / 100,
                        }))
                      }
                    />
                  </Field>
                ))}
              </div>
              <Field label="修改说明">
                <textarea
                  value={instruction}
                  maxLength={2000}
                  placeholder="例如：将选区背景换成浅色织物"
                  onChange={(e) => setInstruction(e.target.value)}
                />
              </Field>
              <button
                className="primary"
                disabled={a.busy || !instruction.trim()}
                onClick={() =>
                  void a.run(async () =>
                    onPreview(
                      await api.post(
                        c.base + "/projects/" + project.id + "/preview",
                        {
                          projectVersion: project.version,
                          mode: "local_edit",
                          artifactId: artifact.id,
                          artifactVersion: current.version,
                          region,
                          instruction,
                        },
                      ),
                    ),
                  )
                }
              >
                预览局部修改
              </button>
            </>
          )}

          <section className="content-review">
            {manager && (
              <button
                onClick={() => {
                  setTemplateName(artifact.name + "版式");
                  setTemplateDialog(true);
                }}
              >
                保存为企业模板
              </button>
            )}
            <h3>审核与交付</h3>
            <span>
              {status(current.status)} · v{current.version}
            </span>
            {current.reviewNote && <p>{current.reviewNote}</p>}
            <Field label="审核意见">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <div className="content-actions">
              {canEdit && ["draft", "rejected"].includes(current.status) && (
                <button
                  disabled={
                    a.busy ||
                    dirty ||
                    !layout ||
                    !!layout.error ||
                    !!layout.issues?.length
                  }
                  onClick={() => review("submit")}
                >
                  提交审核
                </button>
              )}
              {canEdit && current.status === "submitted" && (
                <button disabled={a.busy} onClick={() => review("withdraw")}>
                  撤回
                </button>
              )}
              {c.meta.permissions.includes("content.review") &&
                current.status === "submitted" && (
                  <>
                    <button
                      disabled={a.busy}
                      className="primary"
                      onClick={() => review("approve")}
                    >
                      通过
                    </button>
                    <button
                      disabled={a.busy || !note.trim()}
                      onClick={() => review("reject")}
                    >
                      退回
                    </button>
                  </>
                )}
              {canEdit &&
                !c.meta.settings.reviewRequired &&
                current.status === "draft" && (
                  <button
                    disabled={
                      a.busy ||
                      dirty ||
                      !layout ||
                      !!layout.error ||
                      !!layout.issues?.length
                    }
                    onClick={() => review("exempt")}
                  >
                    免审交付
                  </button>
                )}
            </div>
          </section>
          <Notice text={a.error} />
        </aside>
      </div>
      <Dialog
        open={compare}
        onClose={() => setCompare(false)}
        title="版本对比"
        size="large"
      >
        <div className="content-comparison">
          <div>
            <h3>当前 v{current.version}</h3>
            <ArtworkPreview data={current.data} artifactId={artifact.id} />
          </div>
          {previous.loading && <p>载入历史版本…</p>}
          <Notice text={previous.error} />
          {previous.data && (
            <div>
              <h3>历史 v{previous.data.version}</h3>
              <ArtworkPreview
                data={previous.data.data}
                artifactId={artifact.id}
              />
            </div>
          )}
        </div>
      </Dialog>
      <Dialog
        open={templateDialog}
        onClose={() => setTemplateDialog(false)}
        title="保存企业模板"
        busy={a.busy}
      >
        <Field label="模板名称">
          <input
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            maxLength={120}
          />
        </Field>
        <InfoTip label="企业模板的复用范围">
          仅复用图层位置、样式与锁定规则，文字和素材来自新项目的品牌与产品。
        </InfoTip>
        <Notice text={a.error} />
        <DialogAction>
          <button
            className="primary"
            disabled={a.busy || !templateName.trim()}
            onClick={() =>
              void a.run(async () => {
                await api.post(c.base + "/documents/template", {
                  name: templateName,
                  data: {
                    layout: data.layers.map(
                      ({ role, x, y, w, h, fontSize, color, locked }: any) => ({
                        role,
                        x,
                        y,
                        w,
                        h,
                        fontSize,
                        color,
                        locked,
                      }),
                    ),
                  },
                });
                setTemplateDialog(false);
              })
            }
          >
            保存模板
          </button>
        </DialogAction>
      </Dialog>
      <Dialog
        open={!!candidate}
        title="文案差异"
        onClose={() => setCandidate(null)}
        busy={a.busy}
      >
        {candidate && (
          <>
            {Object.entries(candidate.item.changes).map(([role, text]) => (
              <div key={role} className="content-copy-diff">
                <strong>
                  {
                    ({ title: "标题", body: "卖点", cta: "行动语" } as any)[
                      role
                    ]
                  }
                </strong>
                <p>
                  当前：{data.layers.find((l: any) => l.role === role)?.text}
                </p>
                <p>建议：{String(text)}</p>
              </div>
            ))}
            <Notice text={a.error} />
            <DialogAction>
              <button
                className="primary"
                disabled={!canEdit || a.busy}
                onClick={() =>
                  void a.run(async () => {
                    history.end();
                    const revision = await draft.flush();
                    const response: any = await api.post(
                      c.base + "/artifacts/" + artifact.id + "/adopt-copy",
                      {
                        suggestionId: candidate.suggestion.id,
                        candidate: candidate.index,
                        revision,
                        requestKey: key(),
                      },
                    );
                    setData(response.data);
                    draft.accept(response);
                    setCandidate(null);
                  })
                }
              >
                采用到工作草稿
              </button>
            </DialogAction>
          </>
        )}
      </Dialog>
      <Dialog
        open={!!merge}
        title="比较最新版本并逐项采用"
        onClose={() => setMerge(null)}
        busy={a.busy}
        size="large"
      >
        {merge && (
          <>
            <p>
              只采用勾选的图层属性，其余保留服务器最新内容。此操作更新工作草稿，需要另存正式版本。
            </p>
            {merge.local.layers.flatMap((layer: any) => {
              const target = merge.target.layers.find(
                (l: any) => l.id === layer.id,
              );
              if (!target) return [];
              return [
                "text",
                "assetId",
                "x",
                "y",
                "w",
                "h",
                "fontSize",
                "color",
                "crop",
                "locked",
              ]
                .filter(
                  (prop) =>
                    JSON.stringify(layer[prop]) !==
                    JSON.stringify(target[prop]),
                )
                .map((prop) => {
                  const key = layer.id + ":" + prop;
                  return (
                    <label key={key} className="content-merge-field">
                      <input
                        type="checkbox"
                        checked={!!mergeFields[key]}
                        onChange={(e) =>
                          setMergeFields((fields) => ({
                            ...fields,
                            [key]: e.target.checked,
                          }))
                        }
                      />
                      <span>
                        {(
                          {
                            title: "标题",
                            body: "卖点",
                            price: "价格",
                            date: "有效期",
                            disclaimer: "声明",
                            cta: "行动语",
                            product: "产品",
                            logo: "Logo",
                          } as any
                        )[layer.role] ?? "图层"}{" "}
                        ·{" "}
                        {
                          (
                            {
                              text: "文字",
                              assetId: "素材",
                              x: "横向位置",
                              y: "纵向位置",
                              w: "宽度",
                              h: "高度",
                              fontSize: "字号",
                              color: "颜色",
                              crop: "裁剪",
                              locked: "锁定",
                            } as any
                          )[prop]
                        }
                        <small>
                          服务器：{JSON.stringify(target[prop]) ?? "无"}
                        </small>
                        <small>
                          当前编辑：{JSON.stringify(layer[prop]) ?? "无"}
                        </small>
                      </span>
                    </label>
                  );
                });
            })}
            <Notice text={a.error} />
            <DialogAction>
              <button
                className="primary"
                disabled={a.busy || !Object.values(mergeFields).some(Boolean)}
                onClick={() =>
                  void a.run(async () => {
                    const changes = merge.local.layers
                      .map((layer: any) => ({
                        layerId: layer.id,
                        changes: Object.fromEntries(
                          Object.entries(layer).filter(
                            ([prop]) => mergeFields[layer.id + ":" + prop],
                          ),
                        ),
                      }))
                      .filter(
                        (change: any) => Object.keys(change.changes).length,
                      );
                    await api.post(
                      c.base + "/artifacts/" + artifact.id + "/draft/rebase",
                      {
                        revision: merge.snapshot.draft?.revision ?? 0,
                        targetVersion: merge.snapshot.currentVersion,
                        projectVersion: merge.snapshot.projectVersion,
                        targetHash: await artworkHash(merge.target),
                        requestKey: key(),
                        changes,
                      },
                    );
                    flushSync(() => {
                      draft.clear();
                      history.reset(current.data);
                    });
                    nav(
                      c.prefix +
                        "/projects/" +
                        project.id +
                        "?artifact=" +
                        artifact.id +
                        "&version=" +
                        merge.snapshot.currentVersion,
                      { replace: true },
                    );
                    await new Promise<void>((resolve) =>
                      requestAnimationFrame(() => resolve()),
                    );
                    window.location.reload();
                  })
                }
              >
                将选中修改采用到最新草稿
              </button>
            </DialogAction>
          </>
        )}
      </Dialog>
      <Dialog
        open={discard}
        title="舍弃工作草稿？"
        onClose={() => setDiscard(false)}
        busy={a.busy}
      >
        <p>正式版本保留。当前工作草稿和本标签页尚未同步的修改将被舍弃。</p>
        <Notice text={a.error} />
        <DialogAction>
          <button
            className="primary"
            disabled={a.busy}
            onClick={() =>
              void a.run(async () => {
                if (draft.revision.current > 0)
                  await api.post(
                    c.base + "/artifacts/" + artifact.id + "/draft/discard",
                    { revision: draft.revision.current },
                  );
                flushSync(() => {
                  draft.clear();
                  history.reset(current.data);
                });
                window.location.reload();
              })
            }
          >
            舍弃草稿
          </button>
        </DialogAction>
      </Dialog>
      {guard}
    </div>
  );
}
