import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeftIcon, ArrowRightIcon } from "@phosphor-icons/react";
import { Field, PageTitle } from "../components";
import { useContent } from "./content-ui";
import { creationTools, toolPrompt, type CreationTool } from "./creation-tools";
import { CloudMediaTool } from "./CloudMediaTool";
import { LocalMediaTool } from "./LocalMediaTool";
import "./tools.css";

const categories = ["图片", "视频", "音频", "文案", "素材处理"] as const;
const featured = new Set(["product-scene", "video-script", "presenter-video", "auto-subtitles"]);

function ToolCards({ tools }: { tools: readonly CreationTool[] }) {
  const { prefix } = useContent();
  return (
    <div className="content-tool-cards">
      {tools.map(({ id, name, description, icon: Icon, category }) => (
        <Link key={id} to={prefix + "/tools/" + id} className="content-tool-card" data-category={category}>
          <span className="content-tool-icon"><Icon size={21} aria-hidden="true" /></span>
          <strong>{name}</strong>
          <span className="content-tool-description">{description}</span>
        </Link>
      ))}
    </div>
  );
}

export function FeaturedTools({ onTemplates, canUseTemplates }: {
  onTemplates: () => void;
  canUseTemplates: boolean;
}) {
  const { prefix } = useContent();
  return (
    <section className="content-featured-tools" aria-labelledby="content-featured-title">
      <div className="content-tools-heading">
        <h2 id="content-featured-title">常用工具</h2>
        <div>
          <button type="button" disabled={!canUseTemplates} onClick={onTemplates}>提示词模板</button>
          <Link to={prefix + "/tools"}>全部工具 <ArrowRightIcon size={15} aria-hidden="true" /></Link>
        </div>
      </div>
      <ToolCards tools={creationTools.filter((tool) => featured.has(tool.id))} />
    </section>
  );
}

export function ContentTools() {
  const [category, setCategory] = useState<"" | typeof categories[number]>("");
  useEffect(() => { document.title = "AI 工具 · 知行方舟"; }, []);
  return (
    <section className="content-tools-page">
      <PageTitle title="AI 工具" />
      <div className="content-tools-filters" role="group" aria-label="工具分类">
        {(["", ...categories] as const).map((item) => (
          <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)}>
            {item || "全部"}
          </button>
        ))}
      </div>
      <ToolCards tools={creationTools.filter((tool) => !category || tool.category === category)} />
    </section>
  );
}

export function ToolBack() {
  const { prefix } = useContent();
  return <Link className="content-tool-back" to={prefix + "/tools"}><ArrowLeftIcon size={16} aria-hidden="true" /> AI 工具</Link>;
}

export function StandaloneTool({ tool }: { tool: Exclude<CreationTool, { media: unknown }> }) {
  useEffect(() => { document.title = tool.name + " · 知行方舟"; }, [tool.name]);
  return (
    <section className="content-tools-page content-standalone-tool">
      <ToolBack />
      <PageTitle title={tool.name} />
      {"cloud" in tool ? <CloudMediaTool kind={tool.cloud} />
        : "operation" in tool ? <LocalMediaTool operation={tool.operation} /> : <WritingTool tool={tool} />}
    </section>
  );
}

function WritingTool({ tool }: { tool: Extract<CreationTool, { category: "文案" }> }) {
  const { prefix, meta } = useContent();
  const navigate = useNavigate();
  const draftKey = prefix + ":" + meta.membershipId + ":writing:" + tool.id;
  const [values, setValues] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(draftKey) ?? "[]");
      return Array.isArray(saved) && saved.every((value) => typeof value === "string") ? saved : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try { sessionStorage.setItem(draftKey, JSON.stringify(values)); }
    catch { /* The form still works when storage is unavailable. */ }
  }, [draftKey, values]);
  const allowed = meta.permissions.includes("content.ai.use");
  return (
    <form className="content-writing-form" onSubmit={(event) => {
      event.preventDefault();
      if (!allowed || tool.fields.some((field, index) => !field.optional && !values[index]?.trim())) return;
      navigate(prefix + "/ai?returnTo=" + encodeURIComponent(prefix + "/tools/" + tool.id), {
        state: { contentDraftPrompt: toolPrompt(tool, values) },
      });
    }}>
      <GuidedFields tool={tool} values={values} setValues={setValues} disabled={!allowed} />
      {!allowed && <p role="status">当前账号没有 AI 创作权限</p>}
      <button className="primary" disabled={!allowed}>在创作助手中继续</button>
    </form>
  );
}

export function GuidedFields({ tool, values, setValues, disabled }: {
  tool: Extract<CreationTool, { fields: readonly unknown[] }>;
  values: string[];
  setValues: (values: string[]) => void;
  disabled: boolean;
}) {
  return (
    <div className="content-guided-fields">
      {tool.fields.map((field, index) => (
        <Field key={field.label} label={field.label + (field.optional ? "（选填）" : "")}>
          <input required={!field.optional} disabled={disabled} maxLength={450}
            placeholder={field.placeholder} value={values[index] ?? ""} onChange={(event) =>
              setValues(tool.fields.map((_, i) => i === index ? event.target.value : values[i] ?? ""))
            } />
        </Field>
      ))}
    </div>
  );
}
