import { open } from "@tauri-apps/plugin-shell";
import { GitPullRequest, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";

interface CheckRun {
  name: string;
  status: string;
  conclusion: string;
}

export interface LinkedPR {
  number: number;
  title: string;
  state: string;
  url: string;
  checks: CheckRun[];
}

interface IssueLinkedPRsProps {
  linkedPRs: LinkedPR[];
}

function checkStyle(check: CheckRun): {
  className: string;
  icon: React.ReactNode;
} {
  const isSuccess =
    check.conclusion === "SUCCESS" || check.conclusion === "success";
  const isFailed =
    check.conclusion === "FAILURE" ||
    check.conclusion === "failure" ||
    check.conclusion === "ERROR" ||
    check.conclusion === "error";
  const isPending =
    check.status === "IN_PROGRESS" ||
    check.status === "QUEUED" ||
    check.status === "PENDING" ||
    check.status === "pending";

  if (isSuccess) {
    return {
      className:
        "bg-success/10 text-success border-success/20",
      icon: <CheckCircle2 className="w-2.5 h-2.5" />,
    };
  }
  if (isFailed) {
    return {
      className: "bg-error/10 text-error border-error/20",
      icon: <XCircle className="w-2.5 h-2.5" />,
    };
  }
  if (isPending) {
    return {
      className:
        "bg-warning/10 text-warning border-warning/20",
      icon: <Loader2 className="w-2.5 h-2.5 animate-spin" />,
    };
  }
  return {
    className:
      "bg-neutral-500/10 text-neutral-400 border-neutral-700/50",
    icon: <Clock className="w-2.5 h-2.5" />,
  };
}

export function IssueLinkedPRs({ linkedPRs }: IssueLinkedPRsProps) {
  if (linkedPRs.length === 0) return null;

  return (
    <div className="border-t border-neutral-700/50 pt-3 space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-neutral-400 font-medium">
        <GitPullRequest className="w-3.5 h-3.5" />
        Verknüpfte Pull Requests
      </div>
      {linkedPRs.map((pr) => (
        <div
          key={pr.number}
          className="bg-surface-raised rounded-md shadow-hairline p-3"
        >
          <div className="flex items-center justify-between mb-1">
            <button
              onClick={() => open(pr.url)}
              className="text-xs font-medium text-neutral-200 hover:text-accent transition-colors text-left"
            >
              #{pr.number} {pr.title}
            </button>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-sm font-medium ${
                pr.state === "MERGED"
                  ? "bg-cat-violet/20 text-cat-violet"
                  : pr.state === "CLOSED"
                    ? "bg-error/20 text-error"
                    : "bg-success/20 text-success"
              }`}
            >
              {pr.state === "MERGED"
                ? "Merged"
                : pr.state === "CLOSED"
                  ? "Closed"
                  : "Open"}
            </span>
          </div>
          {pr.checks.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {pr.checks.map((check, idx) => {
                const { className, icon } = checkStyle(check);
                return (
                  <span
                    key={`${check.name}-${idx}`}
                    className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm border font-medium ${className}`}
                  >
                    {icon}
                    {check.name}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
