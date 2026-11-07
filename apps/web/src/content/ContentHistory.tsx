import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ChatCircleIcon,
  PlusIcon,
  SparkleIcon,
  CompassIcon,
  IdentificationCardIcon,
  FrameCornersIcon,
  ArrowsLeftRightIcon,
  CaretDownIcon,
  ImagesIcon,
} from "@phosphor-icons/react";
import { tenantApi } from "../api";
import { useApiData } from "../hooks";
export function ContentHistory({
  tenantKey,
  permissions = [],
}: {
  tenantKey: string;
  permissions: readonly string[];
}) {
  const [page, setPage] = useState(1);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [canvasesOpen, setCanvasesOpen] = useState(true);
  const path = `/t/${tenantKey}/content`,
    location = useLocation();
  const canRead = permissions.includes("content.read");
  const canCreate = permissions.includes("content.create");
  const canvases = useApiData<{
    items: { id: string; project: { name: string } }[];
  }>(canRead ? tenantApi(tenantKey, "/apps/content/canvases?page=1") : null);
  const rows = useApiData<{
    items: { id: string; name: string }[];
    total: number;
  }>(
    canRead
      ? tenantApi(tenantKey, `/apps/content/projects?page=${page}`)
      : null,
  );
  useEffect(() => {
    const f = () => {
      void rows.reload();
      void canvases.reload();
    };
    window.addEventListener("content-projects-changed", f);
    return () => window.removeEventListener("content-projects-changed", f);
  }, [rows.reload, canvases.reload]);
  if (!canRead) return null;
  return (
    <>
      <section className="studio-history" aria-label="创作记录">
        <div className="studio-history-heading">
          <button
            type="button"
            className="studio-history-toggle"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen(!historyOpen)}
          >
            <CaretDownIcon size={12} aria-hidden="true" />
            创作记录
          </button>
          {canCreate && (
            <Link to={path} aria-label="新建创作" title="新建创作">
              <PlusIcon size={17} aria-hidden="true" />
            </Link>
          )}
        </div>
        {historyOpen && (
          <>
            {rows.error && (
              <button onClick={() => void rows.reload()}>
                历史加载失败，重试
              </button>
            )}
            {rows.loading && !rows.data && <p>正在读取历史…</p>}
            <div className="studio-history-records">
              {rows.data?.items.map((p) => (
                <Link
                  key={p.id}
                  to={path + "/projects/" + p.id}
                  className={
                    location.pathname === path + "/projects/" + p.id
                      ? "active"
                      : ""
                  }
                  aria-current={
                    location.pathname === path + "/projects/" + p.id
                      ? "page"
                      : undefined
                  }
                >
                  <ChatCircleIcon size={17} aria-hidden="true" />
                  <span>{p.name}</span>
                </Link>
              ))}
            </div>
            {rows.data?.total === 0 && <p>暂无创作</p>}
            {(rows.data?.total ?? 0) > 20 && (
              <div className="studio-history-pages">
                <button
                  disabled={page === 1 || rows.loading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  上一页
                </button>
                <span>{page}</span>
                <button
                  disabled={
                    page * 20 >= (rows.data?.total ?? 0) || rows.loading
                  }
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </button>
              </div>
            )}
          </>
        )}
      </section>
      <section className="studio-history" aria-label="最近画布">
        <div className="studio-history-heading">
          <button
            type="button"
            className="studio-history-toggle"
            aria-expanded={canvasesOpen}
            onClick={() => setCanvasesOpen(!canvasesOpen)}
          >
            <CaretDownIcon size={12} aria-hidden="true" />
            画布
          </button>
          <div className="studio-history-heading-actions">
            <Link
              className="studio-history-all"
              to={path + "/assets/canvases"}
              aria-label="全部画布"
            >
              全部
            </Link>
            {canCreate && (
              <Link
                to={path + "/assets/canvases?new=1"}
                aria-label="新建画布"
                title="新建画布"
              >
                <PlusIcon size={17} aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
        {canvasesOpen && (
          <>
            {canvases.error && (
              <button onClick={() => void canvases.reload()}>
                画布加载失败，重试
              </button>
            )}
            {canvases.data?.items.slice(0, 4).map((board) => {
              const href = path + "/canvases/" + board.id;
              const current = location.pathname === href;
              return (
                <Link
                  key={board.id}
                  to={href}
                  className={current ? "active" : ""}
                  aria-current={current ? "page" : undefined}
                >
                  <FrameCornersIcon size={17} aria-hidden="true" />
                  <span>{board.project.name}</span>
                </Link>
              );
            })}
          </>
        )}
      </section>
    </>
  );
}

export function ContentNavIcon({ path }: { path: string }) {
  const Icon =
    (
      {
        explore: CompassIcon,
        products: IdentificationCardIcon,
        space: ArrowsLeftRightIcon,
        assets: ImagesIcon,
      } as Record<string, typeof SparkleIcon>
    )[path] ?? SparkleIcon;
  return <Icon size={19} aria-hidden="true" />;
}
