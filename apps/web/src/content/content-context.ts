import { createContext, useContext } from "react";
export const Context = createContext<{
  base: string;
  isTenantAdmin?: boolean;
  adminUrl?: string;
  prefix: string;
  meta: any;
  reload: () => Promise<unknown>;
}>({ base: "", prefix: "", meta: null, reload: async () => {} });
export const useContent = () => useContext(Context);
