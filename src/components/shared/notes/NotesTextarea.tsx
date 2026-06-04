import type { JSX } from "react";

/**
 * The de-duplicated notes textarea, shared by the global- and project-notes
 * panes. Both previously inlined byte-identical markup save for `value`,
 * `placeholder` and `onChange`; this collapses them to one element so the
 * focus-ring/resize styling can never drift between the two tabs.
 */
export function NotesTextarea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}): JSX.Element {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full flex-1 min-h-0 p-3 bg-transparent text-sm text-neutral-200 placeholder-neutral-600 resize-none font-mono focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset rounded-b-md"
      autoFocus
    />
  );
}
