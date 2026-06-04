import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getErrorMessage } from "../../utils/adpError";
import { MessageSquare } from "lucide-react";

interface IssueCommentFormProps {
  folder: string | null;
  /** `"owner/name"` — required when `folder` is null (global board mode). */
  repository: string | null;
  issueNumber: number;
  onCommentPosted: () => void;
}

export function IssueCommentForm({
  folder,
  repository,
  issueNumber,
  onCommentPosted,
}: IssueCommentFormProps) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submitComment() {
    if (!body.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await invoke("post_issue_comment", {
        folder,
        repo: repository,
        number: issueNumber,
        body,
      });
      setBody("");
      onCommentPosted();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submitComment();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      void submitComment();
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-neutral-700/50 pt-4 space-y-2"
    >
      <div className="flex items-center gap-1.5 text-xs text-neutral-400 font-medium mb-1">
        <MessageSquare className="w-3.5 h-3.5" />
        Kommentar hinzufügen
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={submitting}
        placeholder="Kommentar verfassen (Markdown, ⌘/Ctrl+Enter zum Senden)"
        rows={4}
        className="w-full rounded-md bg-surface-raised shadow-hairline p-2 text-sm text-neutral-200 placeholder:text-neutral-500 resize-y disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:shadow-lift focus:ring-1 focus:ring-accent focus:ring-inset transition-shadow duration-150"
      />
      {error && (
        <p className="text-xs text-error">{error}</p>
      )}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!body.trim() || submitting}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-neutral-950 shadow-hairline hover:bg-accent-light hover:shadow-lift disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition-shadow duration-200"
        >
          {submitting ? "Wird gesendet…" : "Kommentar posten"}
        </button>
      </div>
    </form>
  );
}
