# Changelog

Alle relevanten Änderungen an Smashq werden hier dokumentiert.
Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

Kanban-Overhaul Phase A+B — das Kanban-Board kann jetzt **Organisations-Boards** als
globales Board laden, nicht mehr nur die persönlichen Boards des angemeldeten Users.

### Hinzugefügt
- Globales Kanban: Boards von Organisationen wählbar. Der Picker hat ein Konto-Dropdown (eigenes Konto + Organisationen); das gewählte Board wird über seine global eindeutige ID geladen.
- Backend-Command `list_project_owners` (eigenes Konto + Organisationen für das Konto-Dropdown).

### Behoben
- Kanban zeigte bei einem gelöschten/unauffindbaren Board fälschlich „GitHub-Scope fehlt". Fehler werden jetzt ehrlich unterschieden (Board nicht gefunden / Scope fehlt / nicht angemeldet / kein Zugriff / Netzwerk / Rate-Limit) mit handlungsleitendem Hinweis.
- Ein gelöschtes globales Board führt nicht mehr in eine Sackgasse: ein Board-Auswahl-Dialog erscheint, statt still ein fremdes Board zu laden.
- Persistierte Board-Auswahl wird bei Korruption/veralteten Einträgen bereinigt (Schema-Migration + Rehydrate-Validierung).

### Geändert
- Board wird intern über die global eindeutige Projekt-ID adressiert (statt der pro-Konto wiederholten Projekt-Nummer) — verhindert Verwechslung gleichnummerierter Boards verschiedener Konten.
- Kanban vereinfacht: ein einziges, global gewähltes Board (per Konto-/Board-Picker wechselbar). Der Global/Projekt-Umschalter entfällt.

### Entfernt
- Der Kanban-Tab in der Session-Config-Sidebar. Kanban öffnet weiterhin als eigenes Fenster (SideNav). Der pro-Ordner-Board-Modus (Folder-Mode) ist damit entfallen.

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
