import { useState } from "react";
import { Dialog, Notice } from "../components";
import { api } from "../api";
import { useAction, useContent } from "./content-ui";
import { ImageRegionDialog, type EditRegion } from "./ImageRegionDialog";

type Asset = { id: string; filename: string };
type Operation =
  | { operation: "crop"; region: EditRegion }
  | { operation: "rotate" | "mirror" };

export function ImageToolsDialog({
  image,
  projectId,
  onClose,
  onSaved,
}: {
  image: { id: string; name: string };
  projectId: string;
  onClose: () => void;
  onSaved: (asset: Asset) => void | Promise<void>;
}) {
  const { base } = useContent();
  const [crop, setCrop] = useState(false);
  const [saved, setSaved] = useState<Asset>();
  const action = useAction();
  const url = "/api/v1" + base + "/assets/" + image.id + "/file";
  const save = (operation: Operation) =>
    void action.run(async () => {
      const asset = await api.post<Asset>(
        base + "/projects/" + projectId + "/assets/" + image.id + "/transform",
        operation,
      );
      setSaved(asset);
      await onSaved(asset);
    });
  if (crop && !saved)
    return (
      <ImageRegionDialog
        image={{ name: image.name, url }}
        title="裁剪图片"
        actionLabel="保存裁剪结果"
        busy={action.busy}
        error={action.error}
        onClose={() => setCrop(false)}
        onSelect={(region) => save({ operation: "crop", region })}
      />
    );
  return (
    <Dialog
      open
      title="图片工具"
      size="large"
      busy={action.busy}
      onClose={onClose}
    >
      <div className="content-asset-dialog">
        <img src={url} alt={image.name} />
      </div>
      <Notice text={action.error} />
      <div className="form-actions">
        {saved ? (
          <button
            type="button"
            disabled={action.busy}
            onClick={() =>
              void action.run(() => Promise.resolve(onSaved(saved)))
            }
          >
            继续使用已保存图片
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={action.busy}
              onClick={() => setCrop(true)}
            >
              裁剪
            </button>
            <button
              type="button"
              disabled={action.busy}
              onClick={() => save({ operation: "rotate" })}
            >
              顺时针旋转 90°
            </button>
            <button
              type="button"
              disabled={action.busy}
              onClick={() => save({ operation: "mirror" })}
            >
              水平镜像
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
