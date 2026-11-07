export const publicPaths: readonly string[];
export const retiredPublicRoutes: Readonly<Record<string,string>>;
export const legacyHashRoutes: Readonly<Record<string, Readonly<Record<string, string>>>>;
export function retiredPublicDestination(path:string, search?:string):string|null;
