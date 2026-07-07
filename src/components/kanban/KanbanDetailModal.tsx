import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { getErrorMessage } from "../../utils/adpError";
import { ExternalLink, RefreshCw, AlertCircle } from "lucide-react";
import { Modal } from "../ui/Modal";
import { IconButton } from "../ui/IconButton";
import type { KanbanLabel } from "./KanbanCard";
import { IssueBody } from "./IssueBody";
import { IssueComments, type IssueComment } from "./IssueComments";
import { IssueCommentForm } from "./IssueCommentForm";
import { IssueLinkedPRs, type LinkedPR } from "./IssueLinkedPRs";
import { IssueSidebar } from "./IssueSidebar";

// ============================================================================
// Types (matches Rust IssueDetail)
// ============================================================================

interface IssueDetail {
  number: number;
  title: string;
  body: string;
  state: string;
  author: string;
  created_at: string;
  updated_at: string;
  closed_at: string;
  labels: KanbanLabel[];
  assignees: string[];
  milestone: string | null;
  url: string;
  comments: IssueComment[];
}

// ============================================================================
// Props
// ============================================================================

interface KanbanDetailModalProps {
  open: boolean;
  /** Folder path for folder-mode boards; null in global-board mode. */
  folder: string | null;
  /** `"owner/name"` — required when folder is null (cross-repo global board). */
  repository: string | null;
  issueNumber: number;
  onClose: () => void;
  onIssueChanged?: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function formatDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ============================================================================
// Component
// ============================================================================

export function KanbanDetailModal({
  open: isOpen,
  folder,
  repository,
  issueNumber,
  onClose,
  onIssueChanged,
}: KanbanDetailModalProps) {
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [linkedPRs, setLinkedPRs] = useState<LinkedPR[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const mountedRef = useRef(true);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [issueResult, checksResult] = await Promise.all([
        invoke<IssueDetail>("get_issue_detail", { folder, repo: repository, number: issueNumber }),
        invoke<LinkedPR[]>("get_issue_checks", { folder, repo: repository, number: issueNumber }).catch(
          () => [] as LinkedPR[]
        ),
      ]);
      if (mountedRef.current) {
        setDetail(issueResult);
        setLinkedPRs(checksResult);
      }
    } catch (err) {
      if (mountedRef.current) setError(getErrorMessage(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [folder, repository, issueNumber]);

  useEffect(() => {
    mountedRef.current = true;
    void loadDetail();
    return () => {
      mountedRef.current = false;
    };
  }, [loadDetail]);

  function handleCommentPosted() {
    void loadDetail();
    onIssueChanged?.();
  }

  const headerTitle = (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <span className="text-sm font-mono text-neutral-500 shrink-0">
        #{issueNumber}
      </span>
      {detail?.title && (
        <h2 className="text-sm font-semibold text-neutral-100 truncate">
          {detail.title}
        </h2>
      )}
      {detail?.state && (
        <span
          className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-sm font-medium ${
            detail.state === "CLOSED"
              ? "bg-cat-violet/20 text-cat-violet"
              : "bg-success/20 text-success"
          }`}
        >
          {detail.state === "CLOSED" ? "Geschlossen" : "Offen"}
        </span>
      )}
      <div className="ml-auto flex items-center gap-1 shrink-0">
        <IconButton
          icon={<RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />}
          label="Neu laden"
          onClick={() => void loadDetail()}
          disabled={loading}
        />
        {detail?.url && (
          <IconButton
            icon={<ExternalLink className="w-4 h-4" />}
            label="Im Browser öffnen"
            onClick={() => open(detail.url)}
          />
        )}
      </div>
    </div>
  );

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={headerTitle}
      size="none"
      className="w-[960px] max-w-[95vw] max-h-[85vh]"
    >
      {loading ? (
        <div className="flex items-center justify-center py-12 text-neutral-500 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin mr-2" />
          Laden…
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <AlertCircle className="w-8 h-8 text-neutral-600" />
          <span className="text-error text-sm">{error}</span>
          <button
            onClick={() => void loadDetail()}
            className="px-3 py-1.5 text-xs rounded-md bg-surface-raised text-neutral-300 shadow-hairline hover:shadow-lift hover:bg-hover-overlay hover:text-neutral-100 transition-shadow duration-200"
          >
            Erneut versuchen
          </button>
        </div>
      ) : detail ? (
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Main content column */}
          <main className="flex-1 overflow-y-auto p-4 min-w-0 space-y-4">
            <IssueBody body={detail.body} />
            <IssueLinkedPRs linkedPRs={linkedPRs} />
            <IssueComments comments={detail.comments} formatDate={formatDate} />
            <IssueCommentForm
              folder={folder}
              repository={repository}
              issueNumber={issueNumber}
              onCommentPosted={handleCommentPosted}
            />
          </main>

          {/* Sidebar */}
          <aside className="w-[220px] shrink-0 border-l border-neutral-800 overflow-y-auto p-4 bg-surface-base">
            <IssueSidebar
              state={detail.state}
              author={detail.author}
              createdAt={detail.created_at}
              updatedAt={detail.updated_at}
              closedAt={detail.closed_at}
              assignees={detail.assignees}
              labels={detail.labels}
              milestone={detail.milestone}
              formatDate={formatDate}
            />
          </aside>
        </div>
      ) : null}
    </Modal>
  );
}
