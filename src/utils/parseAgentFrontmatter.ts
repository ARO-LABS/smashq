export interface AgentMetadata {
  name: string;
  description: string;
  model: string;
  maxTurns: number | null;
  allowedTools: string[];
}

export interface ParsedAgent {
  metadata: AgentMetadata;
  body: string;
}

/**
 * Parse a `.claude/agents/*.md` file into structured metadata + body.
 *
 * Agent frontmatter uses YAML-like key-value pairs:
 * ```
 * ---
 * model: opus
 * max-turns: 20
 * allowed-tools: Read, Glob, Grep, Bash(ls *)
 * ---
 * ```
 */
export function parseAgentFrontmatter(
  content: string,
  fileName?: string,
): ParsedAgent {
  const fallbackName = fileName?.replace(/\.md$/i, "") ?? "Unknown";

  const defaultMetadata: AgentMetadata = {
    name: fallbackName,
    description: "",
    model: "",
    maxTurns: null,
    allowedTools: [],
  };

  if (!content.startsWith("---")) {
    return {
      metadata: { ...defaultMetadata, description: extractFirstHeadingOrLine(content) },
      body: content,
    };
  }

  const secondDelim = content.indexOf("\n---", 3);
  if (secondDelim === -1) {
    return {
      metadata: { ...defaultMetadata, description: extractFirstHeadingOrLine(content) },
      body: content,
    };
  }

  const frontmatterBlock = content.substring(3, secondDelim).trim();
  const body = content.substring(secondDelim + 4).trim();

  const metadata: AgentMetadata = { ...defaultMetadata };

  for (const line of frontmatterBlock.split("\n")) {
    const kvMatch = line.trim().match(/^([\w-]+):\s*(.*)/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const value = kvMatch[2].trim();

    switch (key) {
      case "model":
        metadata.model = value;
        break;
      case "max-turns": {
        const n = parseInt(value, 10);
        if (!isNaN(n)) metadata.maxTurns = n;
        break;
      }
      case "allowed-tools":
        metadata.allowedTools = value
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        break;
      case "name":
        metadata.name = value || fallbackName;
        break;
      case "description":
        metadata.description = value;
        break;
    }
  }

  // If no explicit description, derive from first heading or line of body
  if (!metadata.description && body) {
    metadata.description = extractFirstHeadingOrLine(body);
  }

  return { metadata, body };
}

/** Extract text from the first markdown heading, or the first non-empty line. */
function extractFirstHeadingOrLine(text: string): string {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Strip markdown heading markers
    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)/);
    if (headingMatch) return headingMatch[1].trim();
    return trimmed;
  }
  return "";
}
