export interface GitCommitInfo {
  hash: string;
  message: string;
  date: string;
}

export interface GitInfo {
  branch: string;
  last_commit: GitCommitInfo | null;
  remote_url: string;
}
