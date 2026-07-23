# Changelog

Alle relevanten Änderungen an Smashq werden hier dokumentiert.
Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt
- Config-Panel: Neuer Tab „Aufgaben" — offene Aufgaben des Projekts direkt im Panel abhaken, per Eingabezeile anlegen und in die große Aufgaben-View springen; Zähler-Badge am Tab.
- Config-Panel History: Suche (Titel + Branch), Zeit-Gruppierung (Heute / Diese Woche / Älter), Original-Erstnachricht als Vorschau bei umbenannten Sessions, Inline-Umbenennen, Auswahl-Modus mit Sammel-Löschen (Bestätigungsstufe statt Undo), Skeleton-Ladezustand.
- Config-Panel History: Laufende Sessions sind als „Aktiv" markiert und vor Doppel-Resume und Löschen geschützt.
- Dokumentation „Betrieb hinter Corporate Proxy" im README: Proxy-Mechanismus und relevante Umgebungsvariablen für Auto-Updater, `gh`-Integration und Claude-CLI-Sessions, inkl. bekannter Lücken (kein OS-Proxy/PAC im Updater, macOS-GUI-Start ohne Shell-Profil-Variablen). (#25)
- **Session-Neustart-Icon** auf der Session-Kachel (Hover-Leiste): beendet die laufende Session und startet eine frische Session im selben Projektordner mit denselben Einstellungen (Shell, Permission-Modus). Bewusst ohne `--resume` — Fortsetzen bleibt ein eigener Flow. (#13)
- **„Im Terminal öffnen"-Button** an den Kanban-Auth-Fehlerkarten (Board und Board-Picker): öffnet das System-Terminal (Windows Terminal bzw. `cmd`, macOS Terminal.app, Linux best effort) direkt mit dem Fix-Befehl (`gh auth login` / `gh auth refresh -s read:project,project`), da diese Befehle interaktiv sind und ein echtes Terminal brauchen. Sicherheitsmodell: geschlossene Befehls-Allowlist im Rust-Backend — das Frontend sendet nur einen Diskriminator, nie einen Befehlsstring. (#38)
- **GitHub-Auth/Scope-Preflight** in den Einstellungen (System-Panel): zeigt Anmeldestatus, Konto und Token-Scopes des `gh` CLI; fehlt `read:project`, erscheint der Hinweis samt kopierbarem Fix-Befehl und „Im Terminal öffnen"-Button — bevor das Kanban-Board am fehlenden Scope scheitert. (#38, Follow-up zu #10)
- Neue Einstellung **„Automatisch nach Updates suchen"** (Einstellungen → System → Updates): schaltet den automatischen Update-Check (beim Start und alle 30 Minuten) ab. Standard ist **an** — Bestands-User behalten den Update-Kanal unverändert. Die manuelle Suche über das Versions-Badge in der Session-Leiste funktioniert unabhängig vom Schalter jederzeit. (#21)

### Geändert
- Aufgaben: Neue Aufgaben haben keinen automatischen Termin mehr — der Termin-Chip („überfällig"/„heute"/…) erscheint nur noch bei bewusst gesetztem Datum. Termin-Feld mit Leerzustand („Kein Termin") und „Termin entfernen"; Termin-Gruppierung mit Bucket „Ohne Termin"; „In Kalender" nur mit gesetztem Termin. Bestehende Aufgaben werden beim Update einmalig auf „kein Termin" zurückgesetzt.
- Seitenleisten-Rails (Navigation + Config-Panel): Klick klappt das geöffnete Panel jetzt auch zu — bisher öffnete Klick nur; Ziehen zum Anpassen bleibt unverändert (4px-Schwelle trennt Klick von Drag).

### Behoben
- Config-Panel History: ASCII-Ersatzformen in Oberflächentexten durch echte Umlaute ersetzt („Session löschen", „Session gelöscht", „für").

### Sicherheit
- Dependabot-High-Alerts behoben (#16): Build-Tooling `vite` auf 6.4.3 gehoben (inkl. `overrides`, damit auch die von vitest genutzten Kopien die gepatchte Version verwenden — schließt `server.fs.deny`-Bypass unter Windows und NTLMv2-Hash-Leak via launch-editor). Die Laufzeit-Abhängigkeit `linkify-it` (≥ 5.0.1, quadratische Komplexität in `match`) und `form-data` (≥ 4.0.6, CRLF-Injection) sind im Lockfile bereits auf gepatchten Versionen fixiert und wurden verifiziert.

## [1.0.24] — 2026-07-19

Einstellungen speichern jetzt zuverlässig (Sekundärfenster-Fix), der
Permission-Modus für neue Sessions ist wählbar — mit neuem, sicherem
Standard „Nachfragen" —, das Terminal läuft auf macOS sauber (Farben,
Zeichen, Schrift), und die Einstellungen haben eine „Über"-Sektion mit
Diagnose-Export. Kanban-Auth-Fehler zeigen ihren Fix-Befehl kopierbar an.

### Hinzugefügt
- Einstellbarer **Permission-Modus für neue Sessions** (Einstellungen → Sessions): Standard (Nachfragen), Auto, Plan oder Bypass / YOLO. Gilt für neue Sessions und Resumes. (#11)
- Neue Einstellungs-Sektion **„Über"**: zeigt App-Version, Build-Commit, Build-Datum und Plattform, mit „Diagnose kopieren" (für Bug-Reports) sowie Links zu Repository, Issues und Releases.

### Geändert
- **Verhaltensänderung:** Neue Sessions starten jetzt standardmäßig im Modus **Standard (Nachfragen)** statt wie bisher mit `--dangerously-skip-permissions`. Wer das bisherige Verhalten will, stellt den Modus einmalig auf **Bypass / YOLO** (Einstellungen → Sessions). (#11)

### Behoben
- Einstellungen aus dem Einstellungen-Fenster (Standard-Terminal, Standard-Projektordner, Permission-Modus, Benachrichtigungen, Sound) gingen beim Schließen des Fensters verloren, obwohl „Gespeichert" angezeigt wurde: das Einstellungen-Fenster ist ein Sekundärfenster ohne Schreibrecht auf die Settings-Datei, und diese Felder wurden — anders als Theme und Präferenz-Schalter — nie ans persistierende Hauptfenster gemeldet. Ein neuer `settingsSync`-Broadcast synchronisiert sie jetzt dorthin.
- Kanban-Fehlerkarte bei Auth-Problemen („GitHub-Scope fehlt", „Nicht bei GitHub angemeldet") ließ den User mit einem nutzlosen „Erneut versuchen" allein: Der Fix-Befehl (`gh auth refresh -s read:project,project` bzw. `gh auth login`) wird jetzt als kopierbarer Befehl mit Copy-Button angezeigt — in der Fehlerkarte und im Board-Picker. Die Befehle sind interaktiv (OAuth-Device-Flow) und müssen in einem echten Terminal laufen; „Erneut versuchen" bleibt als Weg zurück, nachdem der Befehl dort ausgeführt wurde. (#38)
- Terminal auf macOS zeigte keine Farben (#8): eine aus dem Finder/Dock gestartete App erbt keine `TERM`-Umgebungsvariable, weshalb Claude Code und CLI-Tools das Terminal als farblos einstuften. Die PTY-Sessions bekommen jetzt `TERM=xterm-256color` und `COLORTERM=truecolor` gesetzt (macOS/Linux) — passend zum von xterm.js emulierten Terminal.
- Terminal-Ausgabe war bei langen Sessions verstümmelt und Zeilen liefen ineinander (#8): Mehrbyte-Zeichen (z. B. Rahmenlinien) wurden an internen 4-KB-Lesegrenzen zerschnitten und dabei durch Ersatzzeichen ersetzt, was die Spaltenzählung verschob. Die PTY-Ausgabe wird jetzt an gültigen UTF-8-Grenzen zusammengesetzt, unvollständige Zeichen werden über Lesegrenzen hinweg gepuffert.
- Terminal auf macOS stellte einzelne Symbole als leere Kästchen dar (#8): die Schriftliste bestand nur aus Windows-Schriften (Cascadia Code/Fira Code/Consolas) und fiel auf einen generischen Font zurück. Sie beginnt jetzt mit macOS-System-Monospace (SF Mono/Menlo/Monaco); Windows/Linux bleiben unverändert.
- Terminal konnte beim Öffnen kurz falsch umbrochene Zeilen zeigen (#8): der PTY wird jetzt schon beim Einblenden sofort auf die echte Terminalgröße gesetzt, statt erst verzögert nachzuziehen.
- „Was ist neu"-Fenster erschien nach einem Update von Versionen vor 1.0.23 nicht — Bestands-Installationen wurden bei der Settings-Migration fälschlich als Neuinstallationen gewertet (fehlendes `lastSeenVersion` → null). Die Migration setzt jetzt einen Upgrade-Marker; echte Neuinstallationen bleiben unberührt.
- Die Layout-Mini-Map in der Session-Liste färbte die aktive Kachel immer azurblau statt in der zugewiesenen Session-Farbe (#9). Die aktive Kachel nutzt jetzt exakt die Farbe des Session-Punkts (inkl. Fehler-/Wartet-Status).

### Sicherheit
- Der Permission-Modus wird an jeder Grenze auf ein geschlossenes Enum validiert; die claude-Kommandozeile wird nur aus festen Literalen gebaut (kein Roh-Text erreicht die Shell). (#11)

## [1.0.23] — 2026-07-08

Session-Zuordnung repariert (richtige Session beim Restore, Umbenennen erreicht
den Verlauf), macOS voll lauffähig (Sessions starten, Auto-Updates signiert),
Seitenpanels skalierbar und einklappbar, Azure-Design mit klarerem Dark Mode,
Protokolle mit Scope/Sortierung — und ein „Was ist neu"-Fenster, das nach
jedem Update einmalig die wichtigsten Änderungen zeigt.

### Hinzugefügt
- „Was ist neu"-Fenster: öffnet einmalig nach einem Update und zeigt kuratierte Highlights plus Hinweise, worauf nach der Neuerung zu achten ist. Links auf das vollständige Changelog und die GitHub-Issues (Feedback und Pull Requests willkommen).
- Auto-Updates auf macOS: Builds sind signiert und notarisiert; Updates laufen über den eingebauten Updater wie unter Windows.
- Linke Navigation und Konfigurations-Panel lassen sich per Drag in der Breite anpassen und komplett einklappen.
- Tasks-Ansicht: eine konsolidierte Kopfleiste mit Projekt-Filter und „Ansicht"-Popover (Gruppierung, Sortierung); Grid-Kacheln und Fenster öffnen sich per Klick in der großen Ansicht.
- Protokolle: Scope-Umschalter (aktuelle Session / alle Einträge) und Sortier-Steuerung in der Kopfzeile.

### Behoben
- Session-Wiederherstellung startete nach dem App-Start manchmal die falsche Session desselben Projekts: ohne gespeicherte Zuordnung wurde bisher die neueste Session im Projektordner fortgesetzt. Jede Session-Kachel merkt sich jetzt ihren Startzeitpunkt und wird darüber der richtigen Claude-Session zugeordnet; ohne eindeutige Zuordnung startet die Session frisch, statt eine falsche fortzusetzen.
- Zwei gleichzeitig gestartete Sessions im selben Projekt konnten ihre Identität vertauschen — die Zuordnung wartet jetzt auf ein eindeutiges Ergebnis und verwirft doppelte Zuweisungen.
- Umbenennen einer Session erschien nicht in der Verlaufs-Ansicht des Konfigurations-Panels, wenn die Session frisch erstellt war; der neue Titel wird jetzt sofort übernommen.
- macOS: Sessions starteten nie — jeder Favorit war fest auf PowerShell eingestellt, die auf einem Standard-Mac fehlt, und der Fehler wurde ohne Meldung verschluckt. Shells fallen jetzt auf den Plattform-Standard zurück, Fehler zeigen einen Toast, und der PATH wird beim Start aus der Login-Shell geladen, damit `gh`/`git`/`claude` auch in der per Finder gestarteten App gefunden werden.
- Umbenennen: die Leertaste funktioniert wieder — die Tastatursteuerung für Drag & Drop fing Space/Enter aus dem Eingabefeld ab.
- Session-Liste: per Drag geänderte Reihenfolge sprang nach kurzer Zeit zurück; sie wird jetzt gespeichert.
- Protokolle: „Löschen" wirkt in allen offenen Fenstern; vorher tauchten gelöschte Einträge über die Fenster-Synchronisation wieder auf.
- Lange Session-Titel überlappten die Hover-Symbole der Kachel nicht mehr; der Titel kürzt sich dynamisch.
- Grid: Favoriten-Vorschau klappt beim Maximieren zu und leert sich; Mini-Map in der Session-Kachel vertikal zentriert; linke Navigation bleibt nach Drag-Zuklappen zu.
- Dunkle Flächen im Dark Mode sind wieder klar voneinander unterscheidbar (Kontrast der Flächen-Abstufungen messbar angehoben).

### Geändert
- Akzentfarbe der App wechselt von Cyan auf Azure; eine zuvor gewählte Cyan-Projektfarbe wird automatisch migriert.
- Terminal-Farben folgen dem App-Theme nur noch per Opt-in (Einstellungen → Darstellung) — laufende Programme behalten so ihre Farbwahl.
- Protokolle: der Papierkorb löscht die Log-Datei jetzt endgültig von der Platte (inklusive rotierter Dateien) — vorher wurde nur die Ansicht geleert.
- Favoriten merken sich keine feste Shell mehr, sondern nutzen „auto" (plattformabhängiger Standard); bestehende PowerShell-Favoriten fallen auf macOS automatisch zurück.

### Sicherheit
- Ausgelieferte Abhängigkeiten aktualisiert: `dompurify` (XSS, high), `markdown-it`/`linkify-it` (ReDoS) auf gepatchte Versionen.

## [1.0.21] — 2026-07-02

Härtung der Logging-Pipeline (Review-Sweep), Drag & Drop am ganzen Element statt
am Grip-Symbol, Library-Detailansichten und besser sichtbare Session-Farben.
Farbe pro Projekt per Rechtsklick — auf Sessions und Favoriten.

### Hinzugefügt
- Library: Hook-Karten öffnen per Klick eine Detailansicht mit vollständigem Befehl (Event, Matcher, Quelle, Geltungsbereich).
- Library: Memory-Dateien lassen sich über ein Papierkorb-Symbol mit Inline-Bestätigung löschen. Die Datei wandert in den Papierkorb des Betriebssystems, wird also nicht endgültig gelöscht.

### Behoben
- Logging: Frontend-Einträge erreichten die Log-Datei nicht, wenn nur „Log-Datei (NDJSON)" aktiv war — der Anzeige-Schalter blockierte fälschlich auch die Datei. Fehler, die vor der Initialisierung auftreten (z. B. Startup-Crashes), werden jetzt gepuffert statt verworfen.
- Logging: beim Schließen der App oder beim Deaktivieren der Datei-Protokollierung gingen noch nicht geschriebene Einträge verloren — der Abschluss-Flush wartet jetzt alle offenen Schreibvorgänge ab.
- Logging: Schreibfehler (volle Platte, Datei-Sperre) und fehlgeschlagene Rotation werden gemeldet statt still verschluckt; überlange Einträge werden begrenzt, statt das Rotations-Budget zu sprengen.
- Logging: Log-Aufrufe mit undefined-, Funktions- oder Symbol-Werten bringen die Pipeline nicht mehr zum Absturz.
- Logging: korrupte Logging-Einstellungen werden beim Laden bereinigt — der Schalter konnte sonst „an" anzeigen, während die Log-Datei leer blieb.
- Protokolle-Fenster: zeigt jetzt auch Frontend-Logs anderer Fenster (live und beim Öffnen); vorher blieb die Ansicht in der Standard-Konfiguration leer.
- Protokolle-Ansicht: übersteht korrupte Zeilen in der Log-Datei, zeigt nach einer Datei-Rotation weiterhin die Historie (liest rotierte Dateien nach) und blockiert die App beim Laden großer Dateien nicht mehr.
- Protokolle-Ansicht: Live-Modus lässt sich zuverlässig pausieren — ein Timing-Fehler konnte Updates trotz Pause weiterlaufen lassen.
- Favoriten-Gruppen: Ein-/Ausklapp-Zustand bleibt über App-Neustarts erhalten.
- Favoriten: der Ordnername in Klammern entfällt, wenn er mit der Beschriftung identisch ist.
- Sessions-Grid: Rahmen um die Grid-Zellen sind dicker und im hellen Theme sichtbar — die Rahmenfarbe folgt jetzt dem Theme statt fest dem Dark-Mode-Wert.
- Konfigurations-Panel: aktive Tabs und Icons übernehmen die Projekt-/Session-Farbe statt des globalen Cyan; die Markierung aktiver Tabs ist deutlicher.
- Session-Farbe per Rechtsklick: das Farbmenü öffnete nur bei Sessions mit bereits erkannter Claude-Session-ID (aktive/laufende), sonst passierte nichts. Die Farbe wird jetzt pro Projektordner gespeichert und lässt sich bei jeder Session ändern.
- Favoriten: Rechtsklick zeigte das native Browser-Kontextmenü (Zurück/Aktualisieren/Drucken) und bot keine Farbwahl. Favoriten haben jetzt dasselbe Farbmenü wie Sessions.
- Natives WebView-Kontextmenü wird app-weit unterdrückt — außer in Textfeldern, wo Kopieren/Einfügen erhalten bleibt.

### Geändert
- Akzentfarbe ist jetzt eine geteilte Projektfarbe: Favorit und alle Sessions desselben Ordners tragen dieselbe Farbe; einmal setzen wirkt überall (Sidebar-Punkt, Grid-Rahmen, Panel-Kopf).
- Drag & Drop: Favoriten, Favoriten-Gruppen und Session-Zeilen lassen sich am gesamten Element ziehen; das Grip-Symbol entfällt. Buttons, Eingabefelder und Links bleiben normal bedienbar, Rechtsklick startet keinen Drag.
- Library: Projekte ohne Konfiguration werden ausgeblendet; eine Fußnote nennt die Anzahl. Der globale Bereich bleibt immer sichtbar.

### Entfernt
- Der Button im Protokolle-Fenster, der ein weiteres, nicht synchronisiertes Protokolle-Fenster öffnete.

## [1.0.2] — 2026-07-01

Kanban-Overhaul Phase A+B — das Kanban-Board kann jetzt **Organisations-Boards** als
globales Board laden, nicht mehr nur die persönlichen Boards des angemeldeten Users.
Plus Notizen-Persistenz-Fixes und Entfernung der unzuverlässigen open-md-Sentinel-Erkennung.

### Hinzugefügt
- Globales Kanban: Boards von Organisationen wählbar. Der Picker hat ein Konto-Dropdown (eigenes Konto + Organisationen); das gewählte Board wird über seine global eindeutige ID geladen.
- Backend-Command `list_project_owners` (eigenes Konto + Organisationen für das Konto-Dropdown).

### Behoben
- Kanban zeigte bei einem gelöschten/unauffindbaren Board fälschlich „GitHub-Scope fehlt". Fehler werden jetzt ehrlich unterschieden (Board nicht gefunden / Scope fehlt / nicht angemeldet / kein Zugriff / Netzwerk / Rate-Limit) mit handlungsleitendem Hinweis.
- Ein gelöschtes globales Board führt nicht mehr in eine Sackgasse: ein Board-Auswahl-Dialog erscheint, statt still ein fremdes Board zu laden.
- Persistierte Board-Auswahl wird bei Korruption/veralteten Einträgen bereinigt (Schema-Migration + Rehydrate-Validierung).
- Notizen gingen beim Schließen der App verloren: zwei unabhängige `onCloseRequested`-Listener rasten um `destroy()` des Hauptfensters — zu einem konsolidierten Listener zusammengeführt, der alle Flushes abwartet.
- Projekt-Notizen verschwanden nach jedem Neustart (globale Notizen waren nicht betroffen): der Dateiname-Schlüssel für Notizen war verlustbehaftet kodiert und beim Laden nicht mehr rekonstruierbar. Auf reversibles Percent-Encoding umgestellt + Merge statt Replace beim Rehydrate.

### Geändert
- Board wird intern über die global eindeutige Projekt-ID adressiert (statt der pro-Konto wiederholten Projekt-Nummer) — verhindert Verwechslung gleichnummerierter Boards verschiedener Konten.
- Kanban vereinfacht: ein einziges, global gewähltes Board (per Konto-/Board-Picker wechselbar). Der Global/Projekt-Umschalter entfällt.

### Entfernt
- Der Kanban-Tab in der Session-Config-Sidebar. Kanban öffnet weiterhin als eigenes Fenster (SideNav). Der pro-Ordner-Board-Modus (Folder-Mode) ist damit entfallen.
- Die automatische «SMASHQ:open-md»-Sentinel-Erkennung im Session-Output (öffnete eine MD-Datei automatisch, wenn die Zeile im PTY-Output erschien). Zuverlässig nur mit rohem, unformatiertem Terminal-Output nutzbar — Claude Codes eigenes TUI-Rendering verpackt auch scheinbar sauberen Text in ANSI-Codes, wodurch die Erkennung in einer echten Claude-CLI-Session nie zuverlässig feuerte. Die manuelle Pfad-Eingabe (Session-Panel/Editor) bleibt unverändert bestehen und ist der empfohlene Weg, eine MD-Datei zu öffnen.

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
