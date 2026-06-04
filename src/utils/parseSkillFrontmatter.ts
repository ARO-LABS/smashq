export interface SkillArg {
  name: string;
  description: string;
  required: boolean;
}

export interface SkillMetadata {
  name: string;
  description: string;
  userInvokable: boolean;
  args: SkillArg[];
}

export interface ParsedSkill {
  metadata: SkillMetadata;
  body: string;
}

function parseBoolean(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return trimmed === "true" || trimmed === "yes";
}

function parseArgs(lines: string[], startIndex: number): { args: SkillArg[]; endIndex: number } {
  const args: SkillArg[] = [];
  let i = startIndex;
  let current: Partial<SkillArg> | null = null;

  while (i < lines.length) {
    const line = lines[i];

    // End of args block: non-indented line that isn't empty
    if (line.length > 0 && !line.startsWith(" ") && !line.startsWith("\t")) {
      break;
    }

    const trimmed = line.trim();

    // New arg item (starts with "- name:")
    const itemMatch = trimmed.match(/^-\s+name:\s*(.+)/);
    if (itemMatch) {
      if (current?.name) {
        args.push({
          name: current.name,
          description: current.description ?? "",
          required: current.required ?? false,
        });
      }
      current = { name: itemMatch[1].trim() };
      i++;
      continue;
    }

    // Sub-keys of current arg
    if (current) {
      const descMatch = trimmed.match(/^description:\s*(.+)/);
      if (descMatch) {
        current.description = descMatch[1].trim();
        i++;
        continue;
      }
      const reqMatch = trimmed.match(/^required:\s*(.+)/);
      if (reqMatch) {
        current.required = parseBoolean(reqMatch[1]);
        i++;
        continue;
      }
    }

    i++;
  }

  // Push last arg
  if (current?.name) {
    args.push({
      name: current.name,
      description: current.description ?? "",
      required: current.required ?? false,
    });
  }

  return { args, endIndex: i };
}

export function parseSkillFrontmatter(content: string): ParsedSkill {
  const defaultMetadata: SkillMetadata = {
    name: "Unknown",
    description: "",
    userInvokable: false,
    args: [],
  };

  if (!content.startsWith("---")) {
    return { metadata: defaultMetadata, body: content };
  }

  // Find the closing ---
  const secondDelim = content.indexOf("\n---", 3);
  if (secondDelim === -1) {
    return { metadata: defaultMetadata, body: content };
  }

  const frontmatterBlock = content.substring(3, secondDelim).trim();
  const body = content.substring(secondDelim + 4).trim();

  const lines = frontmatterBlock.split("\n");
  const metadata: SkillMetadata = { ...defaultMetadata, args: [] };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    const kvMatch = trimmed.match(/^(\S[\w-]*):\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1];
      const value = kvMatch[2].trim();

      switch (key) {
        case "name":
          metadata.name = value;
          break;
        case "description":
          metadata.description = value;
          break;
        case "user-invokable":
          metadata.userInvokable = parseBoolean(value);
          break;
        case "args": {
          // args value is empty, items follow on next lines
          const result = parseArgs(lines, i + 1);
          metadata.args = result.args;
          i = result.endIndex;
          continue;
        }
      }
    }

    i++;
  }

  return { metadata, body };
}
