import { APPEARANCE_KEY } from "./appearance-bootstrap";

export type Appearance = "light" | "dark" | "system";
const parse = (value: string | null | undefined): Appearance =>
  value === "light" || value === "dark" ? value : "system";
let preference: Appearance = "system";
const listeners = new Set<() => void>();
let initialized = false;
let system: MediaQueryList;

function apply() {
  const dark =
    preference === "dark" || (preference === "system" && system.matches);
  document.documentElement.dataset.appearance = preference;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#15171d" : "#f6f7fb");
  listeners.forEach((listener) => listener());
}

export function initializeAppearance() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  preference = parse(document.documentElement.dataset.appearance);
  try {
    preference = parse(localStorage.getItem(APPEARANCE_KEY));
  } catch {
    /* In-memory selection still works when device storage is blocked. */
  }
  system = window.matchMedia("(prefers-color-scheme: dark)");
  system.addEventListener("change", () => {
    if (preference === "system") apply();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== APPEARANCE_KEY && event.key !== null) return;
    preference = parse(event.newValue);
    apply();
  });
  apply();
}

export function setAppearance(value: Appearance) {
  initializeAppearance();
  preference = parse(value);
  try {
    localStorage.setItem(APPEARANCE_KEY, preference);
  } catch {
    /* No network or account settings write is needed. */
  }
  apply();
}
export const getAppearance = () => preference;
export const subscribeAppearance = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
initializeAppearance();
