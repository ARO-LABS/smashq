# Changelog

Alle relevanten Änderungen an Smashq werden hier dokumentiert.
Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Geändert
- macOS ist jetzt ein erstklassiges Bundle-Ziel: `tauri.conf.json` deklariert
  `app`/`dmg` neben `nsis` und setzt macOS-Metadaten (`minimumSystemVersion`
  10.15, Kategorie „DeveloperTool"). Damit baut `npm run tauri build` lokal auf
  einem Mac ohne CLI-Overrides — die Release-Pipeline (`build-macos`) bleibt
  unverändert. Updater-Schlüssel (`pubkey`/`endpoints`/`createUpdaterArtifacts`)
  sind bewusst unberührt.

### CI
- Neuer `macOS Build Check`-Job (`cargo check` auf `macos-latest`) fängt
  Mac-spezifische Kompilier-Brüche auf PRs ab, statt erst im Release.

## [1.0.1] — 2026-06-09

Wartungs-Release: Bugfixes, Sicherheits- und A11y-Härtung aus einem umfassenden
Code-Review (20-Agenten-Audit + adversariale Verifikation). Keine neuen Features
— Session Manager bleibt feature-complete.

### Behoben
- Session-Restore: reiner Wechsel der aktiven Session wird wieder persistiert (App startete sonst auf der falschen Session).
- Frontend-Logs: bei temporärem IPC-Fehler wird der Batch erneut eingereiht statt verworfen.
- Sessions: `close_session` beendet Claude-/MCP-Child-Prozesse deterministisch (kein Prozess-Leak mehr).
- Kanban: kein Ruckeln mehr während Drag (Render-Guard); unvollständig geladene Boards werden gemeldet statt still abgeschnitten.
- Modal: echter Focus-Trap + Fokus-Wiederherstellung; kein `backdrop-blur` mehr.
- ErrorBoundary: deutsche Copy, Design-System-konform, echte Wiederherstellung des Subtrees.
- Persistierte UI-Flags: Korruptions-Recovery greift jetzt wirklich (Hydration-TDZ behoben).

### Sicherheit
- `rustls-webpki` auf 0.103.13 (behebt RUSTSEC-2026-0098/0099/0104 in der Auto-Updater-TLS-Kette).
- CI-Security-Audit schärft: echte Vulnerabilities lassen den Job jetzt fehlschlagen.

### Geändert
- Auto-Updater meldet Fehler bei Installation/Neustart jetzt sichtbar.
- Interne Logs, Kommentare und Test-Fixtures auf „Smashq" umbenannt (persistierte Daten-Keys bleiben kompatibel).

## [1.0.0] — 2026-06-04 — Initial Release

Erste Version von **Smashq** — Desktop-App zum Verwalten und Überwachen mehrerer
Claude-CLI-Sessions: Multi-Session-Terminal mit Projekt-Kontext, Favoriten-System
und Notizen. Gebaut mit Tauri v2 + React.

Smashq startet als eigenständiges Produkt (Neustart/Rebranding des vormaligen
AgenticExplorer-Projekts) unter neuer Identität: Bundle-ID `de.aj-labs.smashq`,
neues Blitz-Icon, Auto-Updater gegen `ARO-LABS/smashq`.
