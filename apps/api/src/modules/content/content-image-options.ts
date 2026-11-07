export const imageRatios = [
  "1:1",
  "9:16",
  "16:9",
  "3:4",
  "4:3",
  "2:3",
  "3:2",
  "9:21",
  "21:9",
] as const;

export function referenceIds(request: {
  referenceAssetId?: string;
  referenceAssetIds?: string[];
}) {
  return (
    request.referenceAssetIds ??
    (request.referenceAssetId ? [request.referenceAssetId] : [])
  );
}

export function imageDimensions(ratio: string, resolution: "2K" | "4K") {
  const [horizontal, vertical] = ratio.split(":").map(Number);
  const pixels = resolution === "4K" ? 4096 ** 2 : 2048 ** 2;
  const unit = Math.floor(Math.sqrt(pixels / (horizontal * vertical)) / 8) * 8;
  return `${horizontal * unit}x${vertical * unit}`;
}

export function imageCapabilities(model: string) {
  const enhanced = /^doubao-seedream-4-5(?:-|$)/.test(model);
  return {
    ratios: enhanced ? imageRatios : ["1:1", "3:4", "9:16"],
    resolutions: enhanced ? ["2K", "4K"] : ["2K"],
    maxReferences: enhanced ? 4 : 1,
    maxCandidates: 3,
  };
}
