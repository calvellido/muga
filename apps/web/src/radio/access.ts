import { useEffect, useState } from "react";

/**
 * Whether this page can reach radios on the local network (ADR 0010). Radios answer over plain
 * HTTP:
 * - a page served over plain HTTP (at home, or from this computer) reaches them like any site;
 * - a secure (https) page only can in browsers with Local Network Access (Chrome, Edge), once the
 *   user allows it. Safari (every browser on iPhone and iPad) and Firefox block it as mixed content.
 */
export type LocalAccess = "open" | "ask" | "granted" | "denied" | "blocked";

export interface AccessEnvironment {
  protocol: string;
  permissions?: Pick<Permissions, "query"> | undefined;
}

const fromState = (state: PermissionState): LocalAccess =>
  state === "granted" ? "granted" : state === "denied" ? "denied" : "ask";

/** The access, and the permission to watch for changes when there is one. */
export async function localAccess(
  env: AccessEnvironment = {
    protocol: globalThis.location?.protocol ?? "http:",
    permissions: globalThis.navigator?.permissions,
  },
): Promise<{ access: LocalAccess; status?: PermissionStatus }> {
  if (env.protocol !== "https:") return { access: "open" };
  if (!env.permissions) return { access: "blocked" };
  try {
    // Only browsers with Local Network Access know this permission.
    const status = await env.permissions.query({ name: "local-network-access" as PermissionName });
    return { access: fromState(status.state), status };
  } catch {
    return { access: "blocked" };
  }
}

/** {@link localAccess}, kept current when the user changes the permission. */
export function useLocalAccess(): LocalAccess {
  const [access, setAccess] = useState<LocalAccess>("open");
  useEffect(() => {
    let cancelled = false;
    let status: PermissionStatus | undefined;
    const onChange = () => status && setAccess(fromState(status.state));
    void localAccess().then((result) => {
      if (cancelled) return;
      setAccess(result.access);
      status = result.status;
      status?.addEventListener("change", onChange);
    });
    return () => {
      cancelled = true;
      status?.removeEventListener("change", onChange);
    };
  }, []);
  return access;
}
