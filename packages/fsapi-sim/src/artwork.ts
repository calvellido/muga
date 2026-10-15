/** Made-up station logos, so apps and screenshots have artwork without real station images. */

/** FNV-1a with a final mix, so names that differ by one character get unrelated colours. */
function hue(name: string): number {
  let hash = 0x811c9dc5;
  for (const char of name) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) % 360;
}

function initials(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

const escapeXml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.codePointAt(0)};`);

/** A 500×500 SVG: a gradient picked from the name, radio waves, and the name's initials. */
export function artworkSvg(name: string): string {
  const h = hue(name);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="500" height="500">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${h} 70% 52%)"/><stop offset="1" stop-color="hsl(${(h + 45) % 360} 65% 30%)"/>
</linearGradient></defs>
<rect width="500" height="500" fill="url(#g)"/>
<g fill="none" stroke="#fff" stroke-opacity="0.16" stroke-width="16">
<circle cx="250" cy="250" r="125"/><circle cx="250" cy="250" r="190"/><circle cx="250" cy="250" r="255"/>
</g>
<text x="250" y="250" dy="0.35em" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="150" font-weight="700" fill="#fff">${escapeXml(initials(name))}</text>
</svg>
`;
}
