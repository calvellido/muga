/**
 * Muga can be served at several paths of one site: `main` at the root, and stable major versions
 * at /1/, /2/, … (ADR 0018). Paths of one site share its storage, so each build keeps its data
 * under keys of its own: the root keeps `muga.<name>`, /1/ uses `muga/1.<name>`.
 */
export function storageKey(name: string, base: string = import.meta.env.BASE_URL): string {
  const path = base.replace(/^\/+|\/+$/g, "");
  return path ? `muga/${path}.${name}` : `muga.${name}`;
}
