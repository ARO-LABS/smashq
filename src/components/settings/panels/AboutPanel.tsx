import { useEffect, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import { wrapInvoke } from "../../../utils/perfLogger";
import { logError, logWarn } from "../../../utils/errorLogger";
import { ICONS, ICON_SIZE } from "../../../utils/icons";
import { Button } from "../../ui/Button";

const ExternalLinkIcon = ICONS.action.externalLink;
const CopyIcon = ICONS.action.copy;
const CheckIcon = ICONS.tasks.check;

const REPO_URL = "https://github.com/ARO-LABS/smashq";
const ISSUES_URL = `${REPO_URL}/issues`;
const RELEASES_URL = `${REPO_URL}/releases`;

// Build-time constants injected by Vite (vite.config.ts); mirrored in
// vitest.config.integration.ts's `define` for tests.
const COMMIT = __GIT_HASH__;
const BUILD_DATE = __BUILD_DATE__.replace("T", " ");

/** Mirrors the Rust `OsInfo` (camelCase). */
interface OsInfo {
  os: string;
  arch: string;
}

/** Open an external URL via the shell plugin; failure is logged, never fatal. */
async function openUrl(url: string) {
  try {
    await open(url);
  } catch {
    logWarn("AboutPanel", `shell.open failed for: ${url}`);
  }
}

export function AboutPanel() {
  const [version, setVersion] = useState("—");
  const [platform, setPlatform] = useState("unbekannt");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Both reads below are Tauri IPC and only resolve inside a Tauri webview.
    // Outside Tauri (browser dev / jsdom without mockIPC) there is no backend.
    if (!("__TAURI_INTERNALS__" in window)) return;

    getVersion()
      .then(setVersion)
      .catch((err) => logError("AboutPanel.getVersion", err));

    // OS facts come from the backend (platform authority), mirroring SystemPanel.
    wrapInvoke<OsInfo>("get_os_info")
      .then((info) => setPlatform(`${info.os} · ${info.arch}`))
      .catch((err) => logError("AboutPanel.getOsInfo", err));
  }, []);

  const commitUrl = `${REPO_URL}/commit/${COMMIT}`;
  const diagnostics =
    `Smashq v${version}\n` +
    `Commit: ${COMMIT}\n` +
    `Build:  ${BUILD_DATE}\n` +
    `Plattform: ${platform}`;

  // Copy-to-clipboard with optimistic check feedback; failure silent (same
  // contract as KnowledgeSection — a toast is overkill for a Tauri-webview copy).
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(diagnostics);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // leave UI unchanged
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold text-neutral-200">Über Smashq</h3>
          <span className="text-xs font-mono text-neutral-500">v{version}</span>
        </div>
        <p className="text-xs text-neutral-500">
          Claude-CLI-Sessions verwalten und überwachen.
        </p>
      </header>

      <section className="rounded-md shadow-hairline p-4 flex flex-col gap-3 bg-surface-base">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wide">
          Build-Info
        </h4>
        <dl className="flex flex-col gap-2 text-sm">
          <InfoRow label="Version" value={version} />
          <InfoRow
            label="Commit"
            value={
              <button
                type="button"
                onClick={() => openUrl(commitUrl)}
                className="text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-xs"
              >
                {COMMIT}
              </button>
            }
          />
          <InfoRow label="Build-Datum" value={BUILD_DATE} />
          <InfoRow label="Plattform" value={platform} />
        </dl>
        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCopy}
            icon={
              copied ? (
                <CheckIcon className={`${ICON_SIZE.card} text-success`} />
              ) : (
                <CopyIcon className={ICON_SIZE.card} />
              )
            }
          >
            {copied ? "Kopiert" : "Diagnose kopieren"}
          </Button>
        </div>
      </section>

      <section className="rounded-md shadow-hairline p-4 flex flex-col gap-2 bg-surface-base">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wide">
          Links
        </h4>
        <LinkRow label="Repository" onClick={() => openUrl(REPO_URL)} />
        <LinkRow label="Problem melden" onClick={() => openUrl(ISSUES_URL)} />
        <LinkRow label="Releases / Changelog" onClick={() => openUrl(RELEASES_URL)} />
      </section>

      <p className="text-xs text-neutral-500">© 2026 ARO-LABS · MIT-Lizenz</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-neutral-400">{label}</dt>
      <dd className="text-neutral-200 font-mono truncate">{value}</dd>
    </div>
  );
}

function LinkRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 text-sm text-left text-neutral-300 hover:text-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-xs -mx-1 px-1 py-0.5"
    >
      <ExternalLinkIcon className={`${ICON_SIZE.card} shrink-0`} />
      <span>{label}</span>
    </button>
  );
}
