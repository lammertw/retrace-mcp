import { JournalDB, JournalEntry } from "./db.js";
import { JournalBackend } from "./backend.js";

export class LocalBackend implements JournalBackend {
  private db: JournalDB;

  constructor(dbPath?: string) {
    this.db = new JournalDB(dbPath);
  }

  async logEntry(params: {
    content: string;
    category?: string;
    project?: string;
    tags?: string[];
    source?: string;
    timestamp?: string;
    people?: string[];
    refs?: string[];
    component?: string;
  }): Promise<JournalEntry> {
    return this.db.logEntry(params);
  }

  async query(params: {
    from?: string;
    to?: string;
    category?: string;
    project?: string;
    search?: string;
    person?: string;
    component?: string;
    limit?: number;
  }): Promise<JournalEntry[]> {
    return this.db.query(params);
  }

  async semanticSearch(query: string, limit?: number): Promise<JournalEntry[]> {
    return this.db.semanticSearch(query, limit);
  }

  async whoKnowsAbout(topic: string, limit?: number): Promise<{ person: string; entries: number; lastActive: string; sample: string }[]> {
    return this.db.whoKnowsAbout(topic, limit);
  }

  async getSummary(date: string): Promise<{
    categories: Record<string, number>;
    projects: Record<string, number>;
    entries: JournalEntry[];
  }> {
    return this.db.getSummary(date);
  }

  async listProjects(): Promise<string[]> {
    return this.db.listProjects();
  }

  async deleteEntry(id: number): Promise<boolean> {
    return this.db.deleteEntry(id);
  }
}
