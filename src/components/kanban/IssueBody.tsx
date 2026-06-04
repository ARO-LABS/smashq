import { MarkdownBody } from "../editor/MarkdownPreview";

interface IssueBodyProps {
  body: string;
}

export function IssueBody({ body }: IssueBodyProps) {
  if (!body) {
    return (
      <div className="border-t border-neutral-700/50 pt-3 text-xs text-neutral-500 italic">
        Keine Beschreibung
      </div>
    );
  }
  return (
    <div className="border-t border-neutral-700/50 pt-3">
      <MarkdownBody content={body} className="text-sm text-neutral-300" />
    </div>
  );
}
