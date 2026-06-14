use crate::error::{ADPError, ADPErrorCode};
use serde::Serialize;

use super::commands::{classify_gh_error, effective_cwd, ensure_gh, run_gh, validate_owner};

/// Fallback hex color for project-board labels with no color from `gh`.
const BOARD_LABEL_FALLBACK_COLOR: &str = "6b7280";

/// Hard cap on board pages. GitHub returns 100 items/page, so 100 pages =
/// 10 000 items — far beyond any realistic board. Acts as a backstop against
/// a pagination loop that never terminates.
const MAX_BOARD_PAGES: usize = 100;

// ── Types ────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct ProjectSummary {
    pub id: String,
    pub number: u32,
    pub title: String,
    pub items_total: u32,
}

/// An owner whose Projects v2 boards can be listed — the authenticated user
/// (`kind == "user"`) or an organization they belong to (`kind == "org"`).
#[derive(Serialize, Clone)]
pub struct ProjectOwner {
    pub login: String,
    /// `"user"` for the viewer themselves, `"org"` for an organization.
    pub kind: String,
}

#[derive(Serialize, Clone)]
pub struct ProjectLane {
    pub option_id: String,
    pub name: String,
    pub order: u32,
}

#[derive(Serialize, Clone)]
pub struct ProjectLabel {
    pub name: String,
    pub color: String,
}

#[derive(Serialize, Clone)]
pub struct ProjectItem {
    pub item_id: String,
    pub issue_number: u64,
    pub title: String,
    /// First assignee login — kept for frontend backwards compatibility.
    pub assignee: String,
    pub labels: Vec<ProjectLabel>,
    pub url: String,
    pub state: String,
    pub current_lane_option_id: Option<String>,
    /// `"owner/name"` of the source repository. `None` for Draft issues.
    /// Populated from GraphQL `repository { nameWithOwner }`.
    pub repository: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct ProjectBoard {
    pub project_id: String,
    pub status_field_id: String,
    pub lanes: Vec<ProjectLane>,
    pub items: Vec<ProjectItem>,
}

// ── GraphQL query ─────────────────────────────────────────────────────

/// Single-call GraphQL query for the board.
///
/// Fetches in one round trip:
/// - Status single-select field (id + options → lanes)
/// - All items with their current Status option id
/// - Per-item Issue content: number, title, url, state, repository,
///   labels (with hex color), assignees
///
/// Variables: `$id: ID!` (the board's global node id), `$cursor: String`
/// (optional, for paging).
///
/// Addresses the board by its global **node id** via `node(id:)`, NOT via
/// `viewer { projectV2(number:) }`. This makes the load owner-agnostic: a
/// user board and an organization board (e.g. an org Kanban) load through
/// the exact same path, since the node id is globally unique and not relative
/// to the authenticated viewer. The previous viewer-scoping made every org
/// board resolve to NOT_FOUND.
const PROJECT_BOARD_QUERY: &str = r#"query($id: ID!, $cursor: String) { node(id: $id) { __typename ... on ProjectV2 { id field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } } items(first: 100, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { id fieldValues(first: 20) { nodes { __typename ... on ProjectV2ItemFieldSingleSelectValue { optionId field { ... on ProjectV2FieldCommon { name } } } } } content { __typename ... on Issue { number title url state repository { nameWithOwner } labels(first: 10) { nodes { name color } } assignees(first: 5) { nodes { login } } } } } } } } }"#;

/// GraphQL query listing the viewer's own login plus the organizations they
/// belong to — the set of owners whose Projects v2 boards the user can browse
/// in the picker. Org logins are what makes `gh project list --owner <org>`
/// (and therefore org boards) reachable from the UI.
const PROJECT_OWNERS_QUERY: &str =
    r#"query { viewer { login organizations(first: 100) { nodes { login } } } }"#;

// ── Validation ───────────────────────────────────────────────────────

/// Validates that a Projects v2 ID contains only safe characters.
/// Prevents shell injection: IDs must be ASCII-alphanumeric + underscore +
/// hyphen. ASCII-only (matching `validate_repo`): real gh node ids are ASCII,
/// and a Unicode-aware check would needlessly admit `café`/`Ω123`.
fn validate_id(id: &str) -> Result<(), ADPError> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(ADPError::validation(format!("Invalid ID format: '{}'", id)));
    }
    Ok(())
}

// ── Parsing helpers ──────────────────────────────────────────────────

/// Extracts the Status single-select field id and lane definitions from a
/// GraphQL `projectV2` response node.
fn parse_status_field(project: &serde_json::Value) -> Result<(String, Vec<ProjectLane>), ADPError> {
    let field = &project["field"];

    let field_id = field["id"].as_str().ok_or_else(|| {
        ADPError::command_failed(
            "Project has no 'Status' single-select field. \
             Add one on github.com \u{2192} Project settings \u{2192} Fields."
                .to_string(),
        )
    })?;

    let empty_opts = vec![];
    let options = field["options"].as_array().unwrap_or(&empty_opts);

    let lanes: Vec<ProjectLane> = options
        .iter()
        .enumerate()
        .filter_map(|(i, opt)| {
            Some(ProjectLane {
                option_id: opt["id"].as_str()?.to_string(),
                name: opt["name"].as_str()?.to_string(),
                order: i as u32,
            })
        })
        .collect();

    Ok((field_id.to_string(), lanes))
}

/// Parses board items from a GraphQL `items.nodes` array.
///
/// Skips PRs, DraftIssues, and REDACTED items — only GitHub Issues are shown.
/// Labels and assignees are read directly from the GraphQL response, so
/// cross-repo items receive correct metadata without a second request.
fn parse_items_from_graphql(
    nodes: &[serde_json::Value],
    lanes: &[ProjectLane],
) -> Vec<ProjectItem> {
    nodes
        .iter()
        .filter_map(|node| {
            let content = &node["content"];
            if content["__typename"].as_str()? != "Issue" {
                return None;
            }

            let item_id = node["id"].as_str()?.to_string();
            let issue_number = content["number"].as_u64()?;
            let title = content["title"].as_str().unwrap_or("").to_string();
            let url = content["url"].as_str().unwrap_or("").to_string();
            let state = content["state"].as_str().unwrap_or("OPEN").to_string();
            let repository = content["repository"]["nameWithOwner"]
                .as_str()
                .map(String::from);

            let labels: Vec<ProjectLabel> = content["labels"]["nodes"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|l| {
                            Some(ProjectLabel {
                                name: l["name"].as_str()?.to_string(),
                                color: l["color"]
                                    .as_str()
                                    .unwrap_or(BOARD_LABEL_FALLBACK_COLOR)
                                    .to_string(),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();

            // First assignee login kept for frontend backwards compatibility.
            let assignee = content["assignees"]["nodes"]
                .as_array()
                .and_then(|arr| arr.first())
                .and_then(|a| a["login"].as_str())
                .unwrap_or("")
                .to_string();

            // Find the Status option_id from fieldValues — look for the
            // ProjectV2ItemFieldSingleSelectValue whose field name is "Status".
            let current_lane_option_id = node["fieldValues"]["nodes"]
                .as_array()
                .and_then(|fvs| {
                    fvs.iter().find(|fv| {
                        fv["__typename"].as_str() == Some("ProjectV2ItemFieldSingleSelectValue")
                            && fv["field"]["name"].as_str() == Some("Status")
                    })
                })
                .and_then(|fv| fv["optionId"].as_str())
                .and_then(|option_id| {
                    // Verify the option_id exists in our lanes so we never
                    // produce a dangling reference.
                    lanes
                        .iter()
                        .find(|l| l.option_id == option_id)
                        .map(|l| l.option_id.clone())
                });

            Some(ProjectItem {
                item_id,
                issue_number,
                title,
                assignee,
                labels,
                url,
                state,
                current_lane_option_id,
                repository,
            })
        })
        .collect()
}

/// Parses the `list_project_owners` GraphQL response into the viewer (first,
/// `kind == "user"`) followed by each organization (`kind == "org"`).
/// Org nodes missing a `login` are skipped. A response without a viewer login
/// yields an empty list.
fn parse_project_owners(val: &serde_json::Value) -> Vec<ProjectOwner> {
    let viewer = &val["data"]["viewer"];
    let Some(login) = viewer["login"].as_str() else {
        return Vec::new();
    };

    let mut owners = vec![ProjectOwner {
        login: login.to_string(),
        kind: "user".to_string(),
    }];

    if let Some(orgs) = viewer["organizations"]["nodes"].as_array() {
        for org in orgs {
            if let Some(org_login) = org["login"].as_str() {
                owners.push(ProjectOwner {
                    login: org_login.to_string(),
                    kind: "org".to_string(),
                });
            }
        }
    }

    owners
}

/// Fetches and parses a single board page from `gh api graphql`.
///
/// Builds the `gh` argument array in ONE place — the only difference between
/// the first page and subsequent pages is the optional `cursor=` argument.
/// Invokes `gh`, parses the JSON response, and surfaces GraphQL-level errors
/// (auth, scope, not found) as a structured `ADPError` via `classify_gh_error`
/// before returning the parsed value.
///
/// Returns the full parsed GraphQL response `Value`; the caller indexes into
/// `data.node` to extract the Status field and item nodes.
fn fetch_board_page(
    cwd_str: &str,
    query_arg: &str,
    id_arg: &str,
    cursor: Option<&str>,
) -> Result<serde_json::Value, ADPError> {
    let mut args: Vec<&str> = vec!["api", "graphql", "-f", query_arg, "-f", id_arg];
    let cursor_arg;
    if let Some(c) = cursor {
        cursor_arg = format!("cursor={}", c);
        args.push("-f");
        args.push(&cursor_arg);
    }

    let response = run_gh(cwd_str, &args)?;

    let val: serde_json::Value = serde_json::from_str(&response)
        .map_err(|e| ADPError::parse(format!("Failed to parse GraphQL response: {}", e)))?;

    // Surface GraphQL-level errors (auth, scope, not found) as distinguishable
    // structured errors instead of one opaque code — the `type` discriminator
    // (NOT_FOUND / INSUFFICIENT_SCOPES / FORBIDDEN) drives the classification.
    if let Some(errors) = val["errors"].as_array() {
        let first = errors.first();
        let msg = first
            .and_then(|e| e["message"].as_str())
            .unwrap_or("Unknown GraphQL error");
        let gql_type = first.and_then(|e| e["type"].as_str());
        return Err(classify_gh_error(msg, gql_type));
    }

    Ok(val)
}

// ── Tauri Commands ───────────────────────────────────────────────────

#[allow(clippy::module_inception)]
pub mod commands {
    use super::*;

    /// Returns the GitHub Projects (v2) owned by `owner`.
    ///
    /// `owner` is a GitHub login or the sentinel `@me` (the authenticated user,
    /// the default when `None`). Passing an organization login lists that org's
    /// boards — the path that makes org Kanban boards selectable. The owner is
    /// validated (`validate_owner`) before it reaches the `gh` argument list.
    ///
    /// `folder` is used as the working directory for the `gh` subprocess.
    /// Passing `None` is safe — `gh project list` does not require a git
    /// repository and falls back to `std::env::temp_dir()`.
    #[tauri::command]
    pub async fn list_user_projects(
        owner: Option<String>,
        folder: Option<String>,
    ) -> Result<Vec<ProjectSummary>, ADPError> {
        ensure_gh("gh CLI not found. Install from https://cli.github.com")?;

        let owner = owner.unwrap_or_else(|| "@me".to_string());
        validate_owner(&owner)?;

        let cwd = effective_cwd(folder.as_deref());
        let cwd_str = cwd.to_string_lossy().to_string();

        let output = run_gh(
            &cwd_str,
            &["project", "list", "--owner", &owner, "--format", "json"],
        )?;

        if output.is_empty() {
            return Ok(Vec::new());
        }

        let val: serde_json::Value = serde_json::from_str(&output)
            .map_err(|e| ADPError::parse(format!("Failed to parse project list: {}", e)))?;

        let empty = vec![];
        let projects = val["projects"].as_array().unwrap_or(&empty);

        Ok(projects
            .iter()
            .filter_map(|p| {
                Some(ProjectSummary {
                    id: p["id"].as_str()?.to_string(),
                    number: p["number"].as_u64()? as u32,
                    title: p["title"].as_str().unwrap_or("").to_string(),
                    items_total: p["items"]["totalCount"].as_u64().unwrap_or(0) as u32,
                })
            })
            .collect())
    }

    /// Loads the full Kanban board for a GitHub Project v2.
    ///
    /// Uses a single `gh api graphql` call per page instead of the former
    /// three parallel CLI calls. This fixes cross-repo label/assignee enrichment:
    /// all metadata is read directly from the GraphQL response regardless of which
    /// repository each issue belongs to.
    ///
    /// Paginates automatically — boards with more than 100 items require
    /// multiple round trips (GitHub caps `items(first:)` at 100).
    ///
    /// Required `gh` auth scope: `read:project` (for read) or `project` (for
    /// write). If missing: `gh auth refresh -s project,read:project`.
    #[tauri::command]
    pub async fn get_project_board(
        project_number: u32,
        project_id: String,
        folder: Option<String>,
    ) -> Result<ProjectBoard, ADPError> {
        ensure_gh("gh CLI not found. Install from https://cli.github.com")?;

        validate_id(&project_id)?;

        let cwd = effective_cwd(folder.as_deref());
        let cwd_str = cwd.to_string_lossy().to_string();
        let query_arg = format!("query={}", PROJECT_BOARD_QUERY);
        let id_arg = format!("id={}", project_id);

        let mut all_nodes: Vec<serde_json::Value> = Vec::new();
        let mut status_field_id = String::new();
        let mut lanes: Vec<ProjectLane> = Vec::new();
        let mut cursor: Option<String> = None;
        let mut first_page = true;
        let mut completed = false;

        for _ in 0..MAX_BOARD_PAGES {
            let val = fetch_board_page(&cwd_str, &query_arg, &id_arg, cursor.as_deref())?;

            // `node(id:)` resolves to null when the board was deleted, the id is
            // wrong, or the viewer lost access. A non-null node of the WRONG type
            // (a stale `PVTI_`/Issue id) silently lacks the ProjectV2 fields and
            // would otherwise fall through to a misleading "no Status field"
            // error — so a wrong `__typename` is treated as not-found too. Surface
            // both as a distinct "not found" (with the project number for context)
            // so the frontend can drop a stale selection instead of showing a
            // generic or misleading scope message.
            let project = &val["data"]["node"];
            if project.is_null() || project["__typename"].as_str() != Some("ProjectV2") {
                return Err(ADPError::new(
                    ADPErrorCode::ServiceRequestFailed,
                    format!(
                        "Projekt-Board #{} nicht gefunden — moeglicherweise geloescht, \
                         umbenannt oder kein Zugriff.",
                        project_number
                    ),
                )
                .with_details("not_found"));
            }

            // Parse Status field on the first page only — options don't change.
            if first_page {
                let (fid, ls) = parse_status_field(project)?;
                status_field_id = fid;
                lanes = ls;
                first_page = false;
            }

            let items = &project["items"];
            let empty = vec![];
            let nodes = items["nodes"].as_array().unwrap_or(&empty);
            all_nodes.extend(nodes.iter().cloned());

            if !items["pageInfo"]["hasNextPage"].as_bool().unwrap_or(false) {
                completed = true;
                break;
            }
            // hasNextPage is true: a usable endCursor is required to make
            // forward progress. A null/missing endCursor (GitHub edge case)
            // would otherwise refetch page 1 forever, hammering the API.
            let next_cursor = match items["pageInfo"]["endCursor"].as_str() {
                Some(c) => c.to_string(),
                None => break,
            };
            // No-forward-progress guard: identical cursor means the next fetch
            // would return the same page — stop instead of looping.
            if cursor.as_deref() == Some(next_cursor.as_str()) {
                break;
            }
            cursor = Some(next_cursor);
        }

        // Only a hasNextPage=false exit means the whole board was read. Every
        // other exit (page cap, null/duplicate endCursor) is a truncation —
        // surface it instead of silently returning a partial board on which
        // cards would appear to have vanished.
        if !completed {
            return Err(ADPError::command_failed(
                "Projekt-Board konnte nicht vollstaendig geladen werden \
                 (Pagination-Limit oder unerwartete GitHub-Antwort). Bitte erneut versuchen.",
            ));
        }

        let items = parse_items_from_graphql(&all_nodes, &lanes);

        Ok(ProjectBoard {
            project_id,
            status_field_id,
            lanes,
            items,
        })
    }

    /// Moves a project item to a new Status lane.
    ///
    /// Uses `gh project item-edit` — no label manipulation or issue close/reopen.
    /// GitHub Projects v2 is the single source of truth for lane assignment.
    #[tauri::command]
    pub async fn move_project_item(
        project_id: String,
        item_id: String,
        field_id: String,
        option_id: String,
        folder: Option<String>,
    ) -> Result<(), ADPError> {
        ensure_gh("gh CLI not found")?;

        validate_id(&project_id)?;
        validate_id(&item_id)?;
        validate_id(&field_id)?;
        validate_id(&option_id)?;

        let cwd = effective_cwd(folder.as_deref());
        let cwd_str = cwd.to_string_lossy().to_string();

        run_gh(
            &cwd_str,
            &[
                "project",
                "item-edit",
                "--project-id",
                &project_id,
                "--id",
                &item_id,
                "--field-id",
                &field_id,
                "--single-select-option-id",
                &option_id,
            ],
        )?;

        Ok(())
    }

    /// Lists the owners whose Projects v2 boards the user can browse: the
    /// authenticated viewer first (`kind == "user"`), then each organization
    /// they belong to (`kind == "org"`). Powers the picker's owner dropdown so
    /// org boards become discoverable instead of requiring a known number/id.
    ///
    /// Required `gh` auth scope: `read:org` (for the organization list).
    #[tauri::command]
    pub async fn list_project_owners(
        folder: Option<String>,
    ) -> Result<Vec<ProjectOwner>, ADPError> {
        ensure_gh("gh CLI not found. Install from https://cli.github.com")?;

        let cwd = effective_cwd(folder.as_deref());
        let cwd_str = cwd.to_string_lossy().to_string();
        let query_arg = format!("query={}", PROJECT_OWNERS_QUERY);

        let response = run_gh(&cwd_str, &["api", "graphql", "-f", &query_arg])?;

        let val: serde_json::Value = serde_json::from_str(&response)
            .map_err(|e| ADPError::parse(format!("Failed to parse GraphQL response: {}", e)))?;

        if let Some(errors) = val["errors"].as_array() {
            let first = errors.first();
            let msg = first
                .and_then(|e| e["message"].as_str())
                .unwrap_or("Unknown GraphQL error");
            let gql_type = first.and_then(|e| e["type"].as_str());
            return Err(classify_gh_error(msg, gql_type));
        }

        Ok(parse_project_owners(&val))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── validate_id ───────────────────────────────────────────────────

    #[test]
    fn validate_id_accepts_valid_ids() {
        assert!(validate_id("PVT_abc123-XY").is_ok());
        assert!(validate_id("PVTSSF_abc123").is_ok());
        assert!(validate_id("PVTI_issue1").is_ok());
    }

    #[test]
    fn validate_id_rejects_shell_chars() {
        assert!(validate_id("").is_err());
        assert!(validate_id("abc; rm -rf /").is_err());
        assert!(validate_id("abc$(whoami)").is_err());
        assert!(validate_id("../etc/passwd").is_err());
    }

    // ── parse_status_field ────────────────────────────────────────────

    fn make_graphql_project_node() -> serde_json::Value {
        serde_json::json!({
            "id": "PVT_kwABC",
            "field": {
                "id": "PVTSSF_abc123",
                "options": [
                    {"id": "opt_backlog", "name": "Backlog"},
                    {"id": "opt_ready",   "name": "Ready"},
                    {"id": "opt_done",    "name": "Done"}
                ]
            }
        })
    }

    // ── pagination loop-termination logic (finding 4) ─────────────────

    /// Mirrors the cursor-advance decision in get_project_board's loop so the
    /// termination logic is testable without shelling out to `gh`. Returns the
    /// next cursor to fetch, or `None` to stop the loop.
    fn next_board_cursor(page_info: &serde_json::Value, prev: Option<&str>) -> Option<String> {
        if !page_info["hasNextPage"].as_bool().unwrap_or(false) {
            return None;
        }
        let next = page_info["endCursor"].as_str()?;
        if prev == Some(next) {
            return None;
        }
        Some(next.to_string())
    }

    #[test]
    fn pagination_advances_with_valid_next_cursor() {
        let pi = serde_json::json!({"hasNextPage": true, "endCursor": "CUR2"});
        assert_eq!(
            next_board_cursor(&pi, Some("CUR1")),
            Some("CUR2".to_string())
        );
    }

    #[test]
    fn pagination_stops_when_next_page_true_but_cursor_null() {
        // The original infinite-loop bug: hasNextPage true, endCursor null →
        // must terminate (return None) instead of refetching page 1.
        let pi = serde_json::json!({"hasNextPage": true, "endCursor": null});
        assert_eq!(next_board_cursor(&pi, Some("CUR1")), None);
        // endCursor key entirely missing behaves the same way.
        let pi_missing = serde_json::json!({"hasNextPage": true});
        assert_eq!(next_board_cursor(&pi_missing, None), None);
    }

    #[test]
    fn pagination_stops_on_no_forward_progress() {
        // Same cursor returned again → stop to avoid an endless loop.
        let pi = serde_json::json!({"hasNextPage": true, "endCursor": "SAME"});
        assert_eq!(next_board_cursor(&pi, Some("SAME")), None);
    }

    #[test]
    fn pagination_stops_when_no_next_page() {
        let pi = serde_json::json!({"hasNextPage": false, "endCursor": "CUR9"});
        assert_eq!(next_board_cursor(&pi, None), None);
    }

    #[test]
    fn parse_status_field_extracts_lanes() {
        let project = make_graphql_project_node();
        let (field_id, lanes) = parse_status_field(&project).unwrap();
        assert_eq!(field_id, "PVTSSF_abc123");
        assert_eq!(lanes.len(), 3);
        assert_eq!(lanes[0].option_id, "opt_backlog");
        assert_eq!(lanes[1].name, "Ready");
        assert_eq!(lanes[2].order, 2);
    }

    #[test]
    fn parse_status_field_missing_returns_error() {
        let project = serde_json::json!({"id": "PVT_kwABC", "field": {}});
        assert!(parse_status_field(&project).is_err());
    }

    // ── parse_items_from_graphql ──────────────────────────────────────

    fn make_lanes() -> Vec<ProjectLane> {
        vec![
            ProjectLane {
                option_id: "opt_todo".to_string(),
                name: "Todo".to_string(),
                order: 0,
            },
            ProjectLane {
                option_id: "opt_done".to_string(),
                name: "Done".to_string(),
                order: 1,
            },
        ]
    }

    #[test]
    fn parse_items_filters_non_issues() {
        let lanes = make_lanes();
        let nodes = vec![
            serde_json::json!({
                "id": "PVTI_issue1",
                "fieldValues": {
                    "nodes": [{
                        "__typename": "ProjectV2ItemFieldSingleSelectValue",
                        "optionId": "opt_done",
                        "field": {"name": "Status"}
                    }]
                },
                "content": {
                    "__typename": "Issue",
                    "number": 42,
                    "title": "Fix bug",
                    "url": "https://github.com/owner/repo/issues/42",
                    "state": "OPEN",
                    "repository": {"nameWithOwner": "owner/repo"},
                    "labels": {"nodes": [{"name": "bug", "color": "d73a4a"}]},
                    "assignees": {"nodes": [{"login": "alice"}]}
                }
            }),
            serde_json::json!({
                "id": "PVTI_pr1",
                "fieldValues": {"nodes": []},
                "content": {
                    "__typename": "PullRequest",
                    "number": 43,
                    "url": "https://github.com/owner/repo/pull/43",
                    "state": "OPEN"
                }
            }),
        ];
        let items = parse_items_from_graphql(&nodes, &lanes);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].issue_number, 42);
        assert_eq!(
            items[0].current_lane_option_id,
            Some("opt_done".to_string())
        );
        assert_eq!(items[0].repository, Some("owner/repo".to_string()));
        assert_eq!(items[0].labels[0].name, "bug");
        assert_eq!(items[0].assignee, "alice");
    }

    #[test]
    fn parse_items_cross_repo_has_correct_metadata() {
        let lanes = make_lanes();
        let nodes = vec![
            serde_json::json!({
                "id": "PVTI_a",
                "fieldValues": {
                    "nodes": [{
                        "__typename": "ProjectV2ItemFieldSingleSelectValue",
                        "optionId": "opt_todo",
                        "field": {"name": "Status"}
                    }]
                },
                "content": {
                    "__typename": "Issue",
                    "number": 10,
                    "title": "Issue from repo-a",
                    "url": "https://github.com/org/repo-a/issues/10",
                    "state": "OPEN",
                    "repository": {"nameWithOwner": "org/repo-a"},
                    "labels": {"nodes": [{"name": "enhancement", "color": "84b6eb"}]},
                    "assignees": {"nodes": []}
                }
            }),
            serde_json::json!({
                "id": "PVTI_b",
                "fieldValues": {
                    "nodes": [{
                        "__typename": "ProjectV2ItemFieldSingleSelectValue",
                        "optionId": "opt_done",
                        "field": {"name": "Status"}
                    }]
                },
                "content": {
                    "__typename": "Issue",
                    "number": 55,
                    "title": "Issue from repo-b",
                    "url": "https://github.com/org/repo-b/issues/55",
                    "state": "CLOSED",
                    "repository": {"nameWithOwner": "org/repo-b"},
                    "labels": {"nodes": [{"name": "bug", "color": "d73a4a"}]},
                    "assignees": {"nodes": [{"login": "bob"}]}
                }
            }),
        ];
        let items = parse_items_from_graphql(&nodes, &lanes);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].repository, Some("org/repo-a".to_string()));
        assert_eq!(items[0].labels[0].name, "enhancement");
        assert_eq!(items[1].repository, Some("org/repo-b".to_string()));
        assert_eq!(items[1].assignee, "bob");
        assert_eq!(
            items[1].current_lane_option_id,
            Some("opt_done".to_string())
        );
    }

    #[test]
    fn parse_items_no_status_gives_none() {
        let nodes = vec![serde_json::json!({
            "id": "PVTI_no_status",
            "fieldValues": {"nodes": []},
            "content": {
                "__typename": "Issue",
                "number": 99,
                "title": "Triage me",
                "url": "",
                "state": "OPEN",
                "repository": {"nameWithOwner": "owner/repo"},
                "labels": {"nodes": []},
                "assignees": {"nodes": []}
            }
        })];
        let items = parse_items_from_graphql(&nodes, &[]);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].current_lane_option_id, None);
    }

    #[test]
    fn parse_items_draft_issue_is_skipped() {
        let nodes = vec![serde_json::json!({
            "id": "PVTI_draft",
            "fieldValues": {"nodes": []},
            "content": {
                "__typename": "DraftIssue",
                "title": "Draft item"
            }
        })];
        let items = parse_items_from_graphql(&nodes, &[]);
        assert_eq!(items.len(), 0);
    }

    // ── validate_id — additional edge cases ───────────────────────────

    #[test]
    fn validate_id_rejects_whitespace_and_unicode_chars() {
        assert!(validate_id("abc def").is_err());
        assert!(validate_id("abc\tdef").is_err());
        assert!(validate_id("abc\ndef").is_err());
        assert!(validate_id("abc/def").is_err());
        assert!(validate_id("abc.def").is_err());
        assert!(validate_id("abc=def").is_err());
        assert!(validate_id("abc&def").is_err());
        assert!(validate_id("abc|def").is_err());
    }

    #[test]
    fn validate_id_accepts_single_char_and_only_separators() {
        assert!(validate_id("a").is_ok());
        assert!(validate_id("0").is_ok());
        assert!(validate_id("_").is_ok());
        assert!(validate_id("-").is_ok());
        assert!(validate_id("___---").is_ok());
    }

    #[test]
    fn validate_id_error_message_includes_offending_id() {
        let err = validate_id("bad id").unwrap_err();
        // ADPError's Display surfaces the message; the offending id must be in it.
        let rendered = format!("{}", err);
        assert!(rendered.contains("bad id"), "got: {}", rendered);
    }

    #[test]
    fn validate_id_rejects_non_ascii_alphanumeric() {
        // ASCII-only (matches validate_repo): accented/Greek letters are rejected.
        assert!(validate_id("café").is_err());
        assert!(validate_id("Ω123").is_err());
    }

    // ── parse_status_field — additional cases ─────────────────────────

    #[test]
    fn parse_status_field_empty_options_yields_no_lanes() {
        let project = serde_json::json!({
            "id": "PVT_x",
            "field": {"id": "PVTSSF_x", "options": []}
        });
        let (field_id, lanes) = parse_status_field(&project).unwrap();
        assert_eq!(field_id, "PVTSSF_x");
        assert!(lanes.is_empty());
    }

    #[test]
    fn parse_status_field_options_absent_yields_no_lanes() {
        // `options` key missing entirely — as_array().unwrap_or default applies.
        let project = serde_json::json!({
            "id": "PVT_x",
            "field": {"id": "PVTSSF_x"}
        });
        let (field_id, lanes) = parse_status_field(&project).unwrap();
        assert_eq!(field_id, "PVTSSF_x");
        assert!(lanes.is_empty());
    }

    #[test]
    fn parse_status_field_skips_options_with_missing_keys() {
        // An option lacking `id` or `name` is dropped by filter_map; surviving
        // options keep their original enumeration index as `order`.
        let project = serde_json::json!({
            "id": "PVT_x",
            "field": {
                "id": "PVTSSF_x",
                "options": [
                    {"id": "opt_a", "name": "Alpha"},
                    {"name": "no-id"},
                    {"id": "opt_c", "name": "Gamma"}
                ]
            }
        });
        let (_, lanes) = parse_status_field(&project).unwrap();
        assert_eq!(lanes.len(), 2);
        assert_eq!(lanes[0].order, 0);
        // The third raw option keeps index 2 despite the dropped middle entry.
        assert_eq!(lanes[1].option_id, "opt_c");
        assert_eq!(lanes[1].order, 2);
    }

    #[test]
    fn parse_status_field_field_node_absent_returns_error() {
        // No `field` key at all — indexing yields Null, id lookup fails.
        let project = serde_json::json!({"id": "PVT_x"});
        assert!(parse_status_field(&project).is_err());
    }

    #[test]
    fn parse_status_field_non_string_id_returns_error() {
        let project = serde_json::json!({
            "id": "PVT_x",
            "field": {"id": 12345, "options": []}
        });
        assert!(parse_status_field(&project).is_err());
    }

    // ── parse_items_from_graphql — additional cases ───────────────────

    #[test]
    fn parse_items_empty_nodes_yields_empty() {
        let items = parse_items_from_graphql(&[], &make_lanes());
        assert!(items.is_empty());
    }

    #[test]
    fn parse_items_missing_content_typename_is_skipped() {
        // No __typename on content — the `as_str()?` short-circuits to None.
        let nodes = vec![serde_json::json!({
            "id": "PVTI_x",
            "fieldValues": {"nodes": []},
            "content": {"number": 1, "title": "x"}
        })];
        assert!(parse_items_from_graphql(&nodes, &[]).is_empty());
    }

    #[test]
    fn parse_items_redacted_content_is_skipped() {
        let nodes = vec![serde_json::json!({
            "id": "PVTI_redacted",
            "fieldValues": {"nodes": []},
            "content": {"__typename": "REDACTED"}
        })];
        assert!(parse_items_from_graphql(&nodes, &[]).is_empty());
    }

    #[test]
    fn parse_items_missing_issue_number_is_skipped() {
        // Issue content without a numeric `number` — as_u64()? bails out.
        let nodes = vec![serde_json::json!({
            "id": "PVTI_x",
            "fieldValues": {"nodes": []},
            "content": {
                "__typename": "Issue",
                "title": "no number",
                "url": "",
                "state": "OPEN"
            }
        })];
        assert!(parse_items_from_graphql(&nodes, &[]).is_empty());
    }

    #[test]
    fn parse_items_missing_node_id_is_skipped() {
        let nodes = vec![serde_json::json!({
            "fieldValues": {"nodes": []},
            "content": {
                "__typename": "Issue",
                "number": 7,
                "title": "t",
                "url": "",
                "state": "OPEN"
            }
        })];
        assert!(parse_items_from_graphql(&nodes, &[]).is_empty());
    }

    #[test]
    fn parse_items_applies_field_defaults_for_missing_optional_fields() {
        // title/url default to "", state defaults to "OPEN", repository to None.
        let nodes = vec![serde_json::json!({
            "id": "PVTI_min",
            "fieldValues": {"nodes": []},
            "content": {
                "__typename": "Issue",
                "number": 5
            }
        })];
        let items = parse_items_from_graphql(&nodes, &[]);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].issue_number, 5);
        assert_eq!(items[0].title, "");
        assert_eq!(items[0].url, "");
        assert_eq!(items[0].state, "OPEN");
        assert_eq!(items[0].repository, None);
        assert_eq!(items[0].assignee, "");
        assert!(items[0].labels.is_empty());
        assert_eq!(items[0].current_lane_option_id, None);
    }

    #[test]
    fn parse_items_label_missing_color_defaults_to_gray() {
        let nodes = vec![serde_json::json!({
            "id": "PVTI_x",
            "fieldValues": {"nodes": []},
            "content": {
                "__typename": "Issue",
                "number": 1,
                "title": "t",
                "url": "",
                "state": "OPEN",
                "labels": {"nodes": [{"name": "needs-triage"}]},
                "assignees": {"nodes": []}
            }
        })];
        let items = parse_items_from_graphql(&nodes, &[]);
        assert_eq!(items[0].labels.len(), 1);
        assert_eq!(items[0].labels[0].name, "needs-triage");
        assert_eq!(items[0].labels[0].color, "6b7280");
    }

    #[test]
    fn parse_items_label_missing_name_is_dropped() {
        // A label with no `name` is filtered out; valid labels survive.
        let nodes = vec![serde_json::json!({
            "id": "PVTI_x",
            "fieldValues": {"nodes": []},
            "content": {
                "__typename": "Issue",
                "number": 1,
                "title": "t",
                "url": "",
                "state": "OPEN",
                "labels": {"nodes": [
                    {"color": "ffffff"},
                    {"name": "bug", "color": "d73a4a"}
                ]},
                "assignees": {"nodes": []}
            }
        })];
        let items = parse_items_from_graphql(&nodes, &[]);
        assert_eq!(items[0].labels.len(), 1);
        assert_eq!(items[0].labels[0].name, "bug");
    }

    #[test]
    fn parse_items_first_assignee_chosen_among_many() {
        let nodes = vec![serde_json::json!({
            "id": "PVTI_x",
            "fieldValues": {"nodes": []},
            "content": {
                "__typename": "Issue",
                "number": 1,
                "title": "t",
                "url": "",
                "state": "OPEN",
                "labels": {"nodes": []},
                "assignees": {"nodes": [
                    {"login": "carol"},
                    {"login": "dave"}
                ]}
            }
        })];
        let items = parse_items_from_graphql(&nodes, &[]);
        assert_eq!(items[0].assignee, "carol");
    }

    #[test]
    fn parse_items_dangling_option_id_is_dropped() {
        // fieldValues references an optionId not present in lanes — the lane
        // verification step turns it into None to avoid a dangling reference.
        let lanes = make_lanes();
        let nodes = vec![serde_json::json!({
            "id": "PVTI_x",
            "fieldValues": {
                "nodes": [{
                    "__typename": "ProjectV2ItemFieldSingleSelectValue",
                    "optionId": "opt_ghost",
                    "field": {"name": "Status"}
                }]
            },
            "content": {
                "__typename": "Issue",
                "number": 1,
                "title": "t",
                "url": "",
                "state": "OPEN",
                "labels": {"nodes": []},
                "assignees": {"nodes": []}
            }
        })];
        let items = parse_items_from_graphql(&nodes, &lanes);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].current_lane_option_id, None);
    }

    #[test]
    fn parse_items_ignores_non_status_single_select_field() {
        // A single-select value for a field other than "Status" (e.g. Priority)
        // must not be picked up as the lane.
        let lanes = make_lanes();
        let nodes = vec![serde_json::json!({
            "id": "PVTI_x",
            "fieldValues": {
                "nodes": [{
                    "__typename": "ProjectV2ItemFieldSingleSelectValue",
                    "optionId": "opt_todo",
                    "field": {"name": "Priority"}
                }]
            },
            "content": {
                "__typename": "Issue",
                "number": 1,
                "title": "t",
                "url": "",
                "state": "OPEN",
                "labels": {"nodes": []},
                "assignees": {"nodes": []}
            }
        })];
        let items = parse_items_from_graphql(&nodes, &lanes);
        assert_eq!(items[0].current_lane_option_id, None);
    }

    #[test]
    fn parse_items_picks_status_among_multiple_field_values() {
        // Several fieldValues present — only the Status one drives the lane.
        let lanes = make_lanes();
        let nodes = vec![serde_json::json!({
            "id": "PVTI_x",
            "fieldValues": {
                "nodes": [
                    {"__typename": "ProjectV2ItemFieldTextValue", "text": "note"},
                    {
                        "__typename": "ProjectV2ItemFieldSingleSelectValue",
                        "optionId": "opt_todo",
                        "field": {"name": "Priority"}
                    },
                    {
                        "__typename": "ProjectV2ItemFieldSingleSelectValue",
                        "optionId": "opt_done",
                        "field": {"name": "Status"}
                    }
                ]
            },
            "content": {
                "__typename": "Issue",
                "number": 1,
                "title": "t",
                "url": "",
                "state": "OPEN",
                "labels": {"nodes": []},
                "assignees": {"nodes": []}
            }
        })];
        let items = parse_items_from_graphql(&nodes, &lanes);
        assert_eq!(
            items[0].current_lane_option_id,
            Some("opt_done".to_string())
        );
    }

    #[test]
    fn parse_items_closed_state_is_preserved() {
        let nodes = vec![serde_json::json!({
            "id": "PVTI_x",
            "fieldValues": {"nodes": []},
            "content": {
                "__typename": "Issue",
                "number": 1,
                "title": "t",
                "url": "",
                "state": "CLOSED",
                "labels": {"nodes": []},
                "assignees": {"nodes": []}
            }
        })];
        let items = parse_items_from_graphql(&nodes, &[]);
        assert_eq!(items[0].state, "CLOSED");
    }

    #[test]
    fn parse_items_mixed_batch_keeps_only_issues_in_order() {
        // PR, Issue, DraftIssue, Issue → result has the two issues, in order.
        let nodes = vec![
            serde_json::json!({
                "id": "PVTI_pr",
                "fieldValues": {"nodes": []},
                "content": {"__typename": "PullRequest", "number": 1}
            }),
            serde_json::json!({
                "id": "PVTI_i1",
                "fieldValues": {"nodes": []},
                "content": {
                    "__typename": "Issue", "number": 11, "title": "first",
                    "url": "", "state": "OPEN"
                }
            }),
            serde_json::json!({
                "id": "PVTI_draft",
                "fieldValues": {"nodes": []},
                "content": {"__typename": "DraftIssue", "title": "d"}
            }),
            serde_json::json!({
                "id": "PVTI_i2",
                "fieldValues": {"nodes": []},
                "content": {
                    "__typename": "Issue", "number": 22, "title": "second",
                    "url": "", "state": "OPEN"
                }
            }),
        ];
        let items = parse_items_from_graphql(&nodes, &[]);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].issue_number, 11);
        assert_eq!(items[1].issue_number, 22);
    }

    // ── ProjectSummary parsing (mirrors list_user_projects mapping) ───

    /// Replicates the mapping in `list_user_projects` so the pure logic is
    /// exercised without shelling out to `gh`.
    fn map_project_summaries(val: &serde_json::Value) -> Vec<ProjectSummary> {
        let empty = vec![];
        val["projects"]
            .as_array()
            .unwrap_or(&empty)
            .iter()
            .filter_map(|p| {
                Some(ProjectSummary {
                    id: p["id"].as_str()?.to_string(),
                    number: p["number"].as_u64()? as u32,
                    title: p["title"].as_str().unwrap_or("").to_string(),
                    items_total: p["items"]["totalCount"].as_u64().unwrap_or(0) as u32,
                })
            })
            .collect()
    }

    #[test]
    fn map_project_summaries_parses_full_entry() {
        let val = serde_json::json!({
            "projects": [{
                "id": "PVT_kw1",
                "number": 4,
                "title": "Roadmap",
                "items": {"totalCount": 17}
            }]
        });
        let summaries = map_project_summaries(&val);
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, "PVT_kw1");
        assert_eq!(summaries[0].number, 4);
        assert_eq!(summaries[0].title, "Roadmap");
        assert_eq!(summaries[0].items_total, 17);
    }

    #[test]
    fn map_project_summaries_applies_defaults_for_missing_optionals() {
        // title missing → "", items absent → 0. id + number are required.
        let val = serde_json::json!({
            "projects": [{"id": "PVT_kw2", "number": 9}]
        });
        let summaries = map_project_summaries(&val);
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].title, "");
        assert_eq!(summaries[0].items_total, 0);
    }

    #[test]
    fn map_project_summaries_skips_entries_missing_required_fields() {
        // First entry has no id, second has no number — both dropped.
        let val = serde_json::json!({
            "projects": [
                {"number": 1, "title": "no id"},
                {"id": "PVT_x", "title": "no number"},
                {"id": "PVT_ok", "number": 3, "title": "kept"}
            ]
        });
        let summaries = map_project_summaries(&val);
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, "PVT_ok");
    }

    #[test]
    fn map_project_summaries_empty_or_missing_array_yields_empty() {
        assert!(map_project_summaries(&serde_json::json!({"projects": []})).is_empty());
        assert!(map_project_summaries(&serde_json::json!({})).is_empty());
    }

    // ── ProjectBoard struct construction & serialization ──────────────

    #[test]
    fn project_board_serializes_with_camel_unchanged_snake_keys() {
        let board = ProjectBoard {
            project_id: "PVT_kw".to_string(),
            status_field_id: "PVTSSF_x".to_string(),
            lanes: make_lanes(),
            items: vec![],
        };
        let json = serde_json::to_value(&board).unwrap();
        assert_eq!(json["project_id"], "PVT_kw");
        assert_eq!(json["status_field_id"], "PVTSSF_x");
        assert_eq!(json["lanes"].as_array().unwrap().len(), 2);
        assert!(json["items"].as_array().unwrap().is_empty());
    }

    #[test]
    fn project_item_serializes_all_fields() {
        let item = ProjectItem {
            item_id: "PVTI_x".to_string(),
            issue_number: 42,
            title: "Title".to_string(),
            assignee: "alice".to_string(),
            labels: vec![ProjectLabel {
                name: "bug".to_string(),
                color: "d73a4a".to_string(),
            }],
            url: "https://example.com".to_string(),
            state: "OPEN".to_string(),
            current_lane_option_id: Some("opt_done".to_string()),
            repository: Some("owner/repo".to_string()),
        };
        let json = serde_json::to_value(&item).unwrap();
        assert_eq!(json["item_id"], "PVTI_x");
        assert_eq!(json["issue_number"], 42);
        assert_eq!(json["labels"][0]["color"], "d73a4a");
        assert_eq!(json["current_lane_option_id"], "opt_done");
        assert_eq!(json["repository"], "owner/repo");
    }

    #[test]
    fn project_item_none_optionals_serialize_as_null() {
        let item = ProjectItem {
            item_id: "PVTI_x".to_string(),
            issue_number: 1,
            title: "t".to_string(),
            assignee: String::new(),
            labels: vec![],
            url: String::new(),
            state: "OPEN".to_string(),
            current_lane_option_id: None,
            repository: None,
        };
        let json = serde_json::to_value(&item).unwrap();
        assert!(json["current_lane_option_id"].is_null());
        assert!(json["repository"].is_null());
    }

    #[test]
    fn parse_items_round_trips_through_serialization() {
        // Parse a GraphQL node, then serialize the result — exercises both
        // the parsing logic and the Serialize derive together.
        let lanes = make_lanes();
        let nodes = vec![serde_json::json!({
            "id": "PVTI_rt",
            "fieldValues": {
                "nodes": [{
                    "__typename": "ProjectV2ItemFieldSingleSelectValue",
                    "optionId": "opt_todo",
                    "field": {"name": "Status"}
                }]
            },
            "content": {
                "__typename": "Issue",
                "number": 8,
                "title": "Round trip",
                "url": "https://example.com/8",
                "state": "OPEN",
                "repository": {"nameWithOwner": "o/r"},
                "labels": {"nodes": [{"name": "x", "color": "abcdef"}]},
                "assignees": {"nodes": [{"login": "eve"}]}
            }
        })];
        let items = parse_items_from_graphql(&nodes, &lanes);
        let json = serde_json::to_value(&items[0]).unwrap();
        assert_eq!(json["issue_number"], 8);
        assert_eq!(json["assignee"], "eve");
        assert_eq!(json["current_lane_option_id"], "opt_todo");
    }

    // --- ProjectOwner parsing (list_project_owners) -------------------

    #[test]
    fn parse_project_owners_self_first_then_orgs() {
        let val = serde_json::json!({
            "data": { "viewer": {
                "login": "hossoOG",
                "organizations": { "nodes": [ {"login": "ARO-LABS"}, {"login": "OtherOrg"} ] }
            }}
        });
        let owners = parse_project_owners(&val);
        assert_eq!(owners.len(), 3);
        assert_eq!(owners[0].login, "hossoOG");
        assert_eq!(owners[0].kind, "user");
        assert_eq!(owners[1].login, "ARO-LABS");
        assert_eq!(owners[1].kind, "org");
        assert_eq!(owners[2].login, "OtherOrg");
    }

    #[test]
    fn parse_project_owners_no_orgs_yields_just_self() {
        let val = serde_json::json!({
            "data": { "viewer": { "login": "solo", "organizations": { "nodes": [] } } }
        });
        let owners = parse_project_owners(&val);
        assert_eq!(owners.len(), 1);
        assert_eq!(owners[0].login, "solo");
        assert_eq!(owners[0].kind, "user");
    }

    #[test]
    fn parse_project_owners_missing_viewer_yields_empty() {
        let val = serde_json::json!({ "data": {} });
        assert!(parse_project_owners(&val).is_empty());
    }

    #[test]
    fn parse_project_owners_skips_org_nodes_without_login() {
        let val = serde_json::json!({
            "data": { "viewer": {
                "login": "me",
                "organizations": { "nodes": [ {"id": 1}, {"login": "GoodOrg"} ] }
            }}
        });
        let owners = parse_project_owners(&val);
        assert_eq!(owners.len(), 2);
        assert_eq!(owners[1].login, "GoodOrg");
    }

    // --- board query is owner-agnostic: node(id), not viewer ----------

    #[test]
    fn project_board_query_uses_node_id_not_viewer() {
        assert!(
            PROJECT_BOARD_QUERY.contains("node(id:"),
            "board must be addressed by global node id"
        );
        assert!(
            !PROJECT_BOARD_QUERY.contains("viewer"),
            "viewer-scoping must be gone so org boards load"
        );
        assert!(PROJECT_BOARD_QUERY.contains("$id: ID!"));
    }
}
