// Per-command flag shapes. commander hands `.action` a loosely-typed options
// object; these interfaces describe just the flags each command reads.

export interface GlobalOpts {
  claudeDir?: string;
  codexDir?: string;
  mask?: boolean;
  archived?: string; // "all" (default) | "only" | "none"
  programmatic?: string; // "all" (default) | "only" | "none"
}

export interface GrepOpts {
  regex?: boolean;
  caseSensitive?: boolean;
  agent?: string;
  tool?: string[];
  cwd?: string;
  source?: string;
  since?: string;
  until?: string;
  kind?: string;
  limit?: string;
  json?: boolean;
}

export interface ListOpts {
  agent?: string;
  project?: string;
  source?: string;
  since?: string;
  until?: string;
}

export interface ShowOpts {
  agent?: string;
  tools?: boolean;
}

export interface StatsOpts {
  agent?: string;
  project?: string;
}

export interface ServeOpts {
  port?: string;
}

export interface ExportOpts {
  agent?: string;
  out?: string;
  query?: string;
  tool?: string[];
  model?: string[];
  cwd?: string;
  since?: string;
  until?: string;
  kind?: string;
}

export interface ImportOpts {
  to?: string;
  overwrite?: boolean;
  name?: string;
}
