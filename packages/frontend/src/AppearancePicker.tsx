import { useSyncExternalStore } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import {
  getAppearance,
  setAppearance,
  subscribeAppearance,
} from "./appearance";

export function AppearancePicker() {
  const selected = useSyncExternalStore(
    subscribeAppearance,
    getAppearance,
    () => "system",
  );
  return (
    <fieldset className="appearance-picker">
      <legend>外观</legend>
      <div>
        {(
          [
            { value: "light", label: "浅色", Icon: Sun },
            { value: "dark", label: "深色", Icon: Moon },
            { value: "system", label: "跟随系统", Icon: Monitor },
          ] as const
        ).map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={selected === value}
            onClick={() => setAppearance(value)}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
