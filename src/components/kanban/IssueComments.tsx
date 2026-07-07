import { ICONS } from "../../utils/icons";
import { MarkdownBody } from "../editor/MarkdownPreview";

const MessageSquare = ICONS.git.comment;

export interface IssueComment {
  id: string;
  author: string;
  body: string;
  created_at: string;
}

interface IssueCommentsProps {
  comments: IssueComment[];
  formatDate: (iso: string) => string;
}

export function IssueComments({ comments, formatDate }: IssueCommentsProps) {
  if (comments.length === 0) return null;

  return (
    <div className="border-t border-neutral-700/50 pt-3 space-y-3">
      <div className="flex items-center gap-1.5 text-xs text-neutral-400 font-medium">
        <MessageSquare className="w-3.5 h-3.5" />
        {comments.length} {comments.length === 1 ? "Kommentar" : "Kommentare"}
      </div>
      {comments.map((comment) => (
        <div
          key={comment.id}
          className="bg-surface-raised rounded-md shadow-hairline p-3"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-neutral-300">
              {comment.author}
            </span>
            <span className="text-[10px] text-neutral-600">
              {formatDate(comment.created_at)}
            </span>
          </div>
          <MarkdownBody content={comment.body} className="ae-body-sm" />
        </div>
      ))}
    </div>
  );
}
