const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("../apps/web/node_modules/typescript");
const source = fs.readFileSync("apps/web/src/content/canvas-state.ts", "utf8");
// Test the actual pure merge function without loading browser-only API modules.
const pure = source
  .slice(
    source.indexOf("const canonical"),
    source.indexOf("export function useCanvasDraft"),
  )
  .replace("export function mergeCanvas", "function mergeCanvas");
const context = { mergeCanvas: null };
vm.runInNewContext(
  ts.transpileModule(pure, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText + "\nthis.mergeCanvas=mergeCanvas;",
  context,
);
const merge = (...args) => {
  const result = context.mergeCanvas(...args);
  return result && JSON.parse(JSON.stringify(result));
};
const image = {
  id: "image",
  type: "image",
  assetId: "asset",
  x: 0,
  y: 0,
  width: 320,
  height: 320,
};
const base = { nodes: [image], viewport: { x: 40, y: 40, zoom: 1 } };
const clone = (v) => structuredClone(v);
let checks = 0;
const eq = (a, b) => {
  assert.deepEqual(a, b);
  checks++;
};
eq(merge(base, base, base), base);
const local = clone(base);
local.nodes[0].x = 200;
const remote = clone(base);
remote.nodes.push({ ...image, id: "generated", assetId: "new-asset", x: 352 });
eq(merge(base, local, remote).nodes[0].x, 200);
eq(merge(base, local, remote).nodes[1].assetId, "new-asset");
const conflict = clone(base);
conflict.nodes[0].x = 300;
eq(merge(base, local, conflict), null);
eq(merge(base, local, local), local);
const removed = { ...base, nodes: [] };
eq(
  merge(base, removed, remote).nodes.map((n) => n.id),
  ["generated"],
);
eq(merge(base, removed, conflict), null);
const view = clone(base);
view.viewport.zoom = 0.5;
eq(merge(base, view, remote).viewport.zoom, 0.5);
const reordered = clone(base);
reordered.nodes[0] = Object.fromEntries(Object.entries(image).reverse());
eq(merge(base, local, reordered), local);
const left = clone(base);
left.nodes.push({ ...image, id: "note", type: "note", text: "保留杯子" });
eq(
  merge(base, left, remote).nodes.map((n) => n.id),
  ["image", "generated", "note"],
);
const large = {
  ...base,
  nodes: Array.from({ length: 100 }, (_, i) => ({ ...image, id: String(i) })),
};
eq(merge({ ...base, nodes: [] }, large, remote), null);
console.log(
  JSON.stringify({ suite: "content-canvas-state", checks, paidCalls: 0 }),
);
