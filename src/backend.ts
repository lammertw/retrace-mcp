import { JournalEntry, Project } from "./db.js";

export interface JournalBackend {
  logEntry(params: {
    content: string;
    category?: string;
    project?: string;
    tags?: string[];
    source?: string;
    timestamp?: string;
    people?: string[];
    refs?: string[];
    component?: string;
  }): Promise<JournalEntry>;

  query(params: {
    from?: string;
    to?: string;
    category?: string;
    project?: string;
    search?: string;
    person?: string;
    component?: string;
    limit?: number;
  }): Promise<JournalEntry[]>;

  semanticSearch(query: string, limit?: number): Promise<JournalEntry[]>;

  whoKnowsAbout(topic: string, limit?: number): Promise<{ person: string; entries: number; lastActive: string; sample: string }[]>;

  getSummary(date: string): Promise<{
    categories: Record<string, number>;
    projects: Record<string, number>;
    entries: JournalEntry[];
  }>;

  listProjects(): Promise<Project[]>;

  deleteEntry(id: number): Promise<boolean>;
}
