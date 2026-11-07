import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAction, useContent } from "./content-ui";
import "./canvas.css";
export function CreativeTabs({
  mode,
  projectId,
  canvasId,
}: {
  mode: "generate" | "canvas";
  projectId?: string;
  canvasId?: string;
}) {
  const c = useContent(),
    nav = useNavigate(),
    action = useAction();
  return (
    <div className="creative-mode-wrap">
      <nav className="creative-modes" aria-label="创作方式">
        <Link
          to={c.prefix + (projectId ? "/projects/" + projectId : "")}
          aria-current={mode === "generate" ? "page" : undefined}
        >
          生成
        </Link>
        {projectId &&
        mode === "generate" &&
        c.meta.permissions.includes("content.create") ? (
          <button
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const board = await api.post<any>(c.base + "/canvases", {
                  projectId,
                });
                window.dispatchEvent(new Event("content-projects-changed"));
                nav(c.prefix + "/canvases/" + board.id);
              })
            }
          >
            画布
          </button>
        ) : (
          <Link
            to={
              c.prefix +
              (canvasId ? "/canvases/" + canvasId : "/assets/canvases")
            }
            aria-current={mode === "canvas" ? "page" : undefined}
          >
            画布
          </Link>
        )}
      </nav>
      {action.error && <span role="alert">{action.error}</span>}
    </div>
  );
}
