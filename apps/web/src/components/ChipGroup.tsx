import type { ReactNode } from "react";

/** A row of toggle chips with a label for assistive technology. */
export function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="chips">
      <legend className="visually-hidden">{label}</legend>
      {children}
    </fieldset>
  );
}
