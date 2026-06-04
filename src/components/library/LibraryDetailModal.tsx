import { type LucideIcon, Zap, Bot, Webhook, Brain, Scroll, BookText } from "lucide-react";
import { Modal } from "../ui/Modal";
import { LibraryDetailContent } from "./LibraryDetailContent";
import {
  useConfigDiscoveryStore,
  selectSelectedDetail,
  selectCloseDetail,
  type SelectedDetail,
} from "../../store/configDiscoveryStore";

// ── Header meta derivation ───────────────────────────────────────────

interface DetailMeta {
  Icon: LucideIcon;
  iconClass: string;
  title: string;
  scope?: string;
}

function getDetailMeta(detail: SelectedDetail): DetailMeta {
  switch (detail.category) {
    case "skills":
      return { Icon: Zap, iconClass: "text-accent", title: detail.item.name, scope: detail.item.scope };
    case "agents":
      return { Icon: Bot, iconClass: "text-purple-400", title: detail.item.name, scope: detail.item.scope };
    case "hooks":
      return { Icon: Webhook, iconClass: "text-amber-400", title: detail.item.event, scope: detail.item.scope };
    case "memory":
      return { Icon: Brain, iconClass: "text-green-400", title: detail.item.name };
    case "rules":
      return { Icon: Scroll, iconClass: "text-accent", title: detail.item.name, scope: "global" };
    case "knowledge":
      return { Icon: BookText, iconClass: "text-accent", title: detail.item.name, scope: detail.item.category };
  }
}

function DetailHeader({ detail }: { detail: SelectedDetail }): JSX.Element {
  const { Icon, iconClass, title, scope } = getDetailMeta(detail);
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Icon className={`w-4 h-4 shrink-0 ${iconClass}`} />
      <span className="text-sm font-semibold text-neutral-200 truncate">{title}</span>
      {scope && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-neutral-700 text-neutral-400 shrink-0">
          {scope}
        </span>
      )}
    </div>
  );
}

// ── LibraryDetailModal ───────────────────────────────────────────────

export function LibraryDetailModal(): JSX.Element {
  const selectedDetail = useConfigDiscoveryStore(selectSelectedDetail);
  const closeDetail = useConfigDiscoveryStore(selectCloseDetail);

  return (
    <Modal
      open={selectedDetail !== null}
      onClose={closeDetail}
      title={selectedDetail ? <DetailHeader detail={selectedDetail} /> : undefined}
      size="none"
      className="w-[min(1100px,90vw)] max-h-[85vh] flex flex-col"
    >
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {selectedDetail && (
          <LibraryDetailContent detail={selectedDetail} />
        )}
      </div>
    </Modal>
  );
}
