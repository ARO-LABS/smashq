import { useState, useEffect } from "react";
import { useConfigDiscoveryStore } from "../../store/configDiscoveryStore";

// ── Content Preview Panel ────────────────────────────────────────────

interface ContentPreviewProps {
  title: string;
  contentKey: string;
  loader: () => Promise<string>;
}

export function ContentPreview({
  title,
  contentKey,
  loader,
}: ContentPreviewProps): JSX.Element {
  const loadContent = useConfigDiscoveryStore((s) => s.loadContent);
  const cached = useConfigDiscoveryStore((s) => s.contentCache[contentKey]);
  const isLoading = useConfigDiscoveryStore((s) => s.contentLoading[contentKey]);
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    if (cached !== undefined) {
      setContent(cached);
      return;
    }
    let cancelled = false;
    loadContent(contentKey, loader).then((c) => {
      if (!cancelled) setContent(c);
    });
    return () => {
      cancelled = true;
    };
  }, [contentKey, cached, loadContent, loader]);

  if (isLoading) {
    return (
      <div className="text-xs text-neutral-500 py-4 text-center">Lade...</div>
    );
  }

  const text = content ?? cached ?? "";

  if (!text) {
    return (
      <div className="text-xs text-neutral-500 py-4 text-center">
        Kein Inhalt
      </div>
    );
  }

  return (
    <div className="mt-2">
      <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">
        {title}
      </div>
      <pre className="text-xs text-neutral-300 whitespace-pre-wrap font-mono leading-relaxed bg-surface-base rounded-md shadow-hairline p-3 max-h-[40vh] overflow-auto">
        {text}
      </pre>
    </div>
  );
}
