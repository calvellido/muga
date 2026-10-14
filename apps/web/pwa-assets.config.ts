import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

const background = "#0e4f3c";

/** `pnpm --filter @muga/web icons` regenerates the PNG/ICO icons in public/ from icon.svg. */
export default defineConfig({
  headLinkOptions: { preset: "2023" },
  preset: {
    ...minimal2023Preset,
    // Full-bleed: the logo is already inside the maskable safe zone.
    maskable: { ...minimal2023Preset.maskable, padding: 0, resizeOptions: { background } },
    apple: { ...minimal2023Preset.apple, padding: 0, resizeOptions: { background } },
  },
  images: ["public/icon.svg"],
});
