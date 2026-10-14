import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { RadioController } from "./controller.ts";
import type { RadioRegistry, RegistrySnapshot } from "./registry.ts";
import type { RadioSnapshot } from "./types.ts";

export const RegistryContext = createContext<RadioRegistry | null>(null);

export function useRegistry(): RadioRegistry {
  const registry = useContext(RegistryContext);
  if (!registry) throw new Error("useRegistry must be used inside <RegistryContext.Provider>");
  return registry;
}

export function useRegistrySnapshot(): RegistrySnapshot {
  const registry = useRegistry();
  return useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
}

const noSubscription = () => () => undefined;
const noSnapshot = () => undefined;

export function useRadio(
  id: string | undefined,
): { controller: RadioController; snapshot: RadioSnapshot } | undefined {
  const controller = useRegistry().controller(id);
  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? noSubscription,
    controller?.getSnapshot ?? noSnapshot,
    controller?.getSnapshot ?? noSnapshot,
  );
  return controller && snapshot ? { controller, snapshot } : undefined;
}

/** Tracks a CSS media query (false where matchMedia is unavailable). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener("change", onChange);
      return () => list?.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}

/** Current time, refreshed every `intervalMs` while `enabled` (for the playback position). */
export function useNow(intervalMs: number, enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, enabled]);
  return now;
}
