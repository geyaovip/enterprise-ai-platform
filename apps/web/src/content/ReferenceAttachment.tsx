// Adapted from Loomic image-attachment-bar.tsx, commit 21206c30054572291b9df000d84568aeca97aeda.
// Copyright (c) 2026 Xinmin Zeng. MIT; see third-party/Loomic-LICENSE.
// Platform adaptation: one private asset ID, accessible remove, no Supabase or canvas dependency.
import { ImageIcon, XIcon } from "@phosphor-icons/react";
import { clipDefaults, type ClipOptions, type MediaMode } from "./MediaOptions";
export type ReferenceImage = { id: string; preview: string; name: string };
export function saveReferenceDraft(
  prefix: string,
  membershipId: string,
  image: ReferenceImage,
  projectId?: string,
  mode: MediaMode = "image",
) {
  const storageKey =
    prefix + ":" + membershipId + ":draft:" + (projectId || "new");
  let draft: {
    prompt: string;
    size: string;
    brandId: string;
    video?: { prompt: string; options: ClipOptions };
  } = { prompt: "", size: "square", brandId: "" };
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    if (
      saved &&
      typeof saved.prompt === "string" &&
      ["square", "portrait", "story"].includes(saved.size)
    )
      draft = saved;
  } catch {
    /* A damaged previous draft must not prevent selecting a reference. */
  }
  sessionStorage.setItem(
    storageKey,
    JSON.stringify(
      mode === "video"
        ? {
            ...draft,
            mode,
            video: {
              ...draft.video,
              prompt: draft.video?.prompt ?? "",
              frame: image,
              options: {
                ...(draft.video?.options ?? clipDefaults),
                ratio: "adaptive",
              },
            },
          }
        : {
            ...draft,
            mode,
            reference: image,
            extraReferences: [],
            region: undefined,
          },
    ),
  );
}
export function ReferenceAttachment({
  image,
  onRemove,
  disabled,
  label = "参考图",
}: {
  image: ReferenceImage;
  onRemove: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="studio-reference">
      <img src={image.preview} alt={label + "：" + image.name} />
      <span>
        <ImageIcon size={14} aria-hidden="true" />
        {label}
      </span>
      <button
        type="button"
        aria-label={"移除" + label}
        title={"移除" + label}
        disabled={disabled}
        onClick={onRemove}
      >
        <XIcon size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
