import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";

export interface JournalEntry {
  id: number;
  timestamp: string;
  category: string;
  project: string | null;
  content: string;
  tags: string | null;
  source: string;
  people: string | null;
  refs: string | null;
  component: string | null;
}

export class JournalDB {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath =
      dbPath || path.join(os.homedir(), ".retrace", "journal.db");
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.db = new Database(resolvedPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private getSchemaVersion(): number {
    try {
      const row = this.db.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
      return row ? parseInt(row.value, 10) : 0;
    } catch {
      return 0;
    }
  }

  private setSchemaVersion(version: number): void {
    this.db.prepare("INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)").run(String(version));
  }

  private migrate(): void {
    const version = this.getSchemaVersion();

    if (version < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL DEFAULT (datetime('now')),
          category TEXT NOT NULL DEFAULT 'general',
          project TEXT,
          content TEXT NOT NULL,
          tags TEXT,
          source TEXT NOT NULL DEFAULT 'manual',
          people TEXT,
          refs TEXT,
          component TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_entries_timestamp ON entries(timestamp);
        CREATE INDEX IF NOT EXISTS idx_entries_category ON entries(category);
        CREATE INDEX IF NOT EXISTS idx_entries_project ON entries(project);
        CREATE INDEX IF NOT EXISTS idx_entries_component ON entries(component);
      `);

      // Full-text search index
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
          content, project, tags, people, refs, component,
          content_rowid=id
        );
      `);

      this.setSchemaVersion(1);
    }

    this.rebuildFtsIfNeeded();
  }

  private rebuildFtsIfNeeded(): void {
    const ftsCount = (this.db.prepare("SELECT COUNT(*) as cnt FROM entries_fts").get() as { cnt: number }).cnt;
    const entryCount = (this.db.prepare("SELECT COUNT(*) as cnt FROM entries").get() as { cnt: number }).cnt;
    if (ftsCount < entryCount) {
      this.db.exec("DELETE FROM entries_fts");
      this.db.exec(`
        INSERT INTO entries_fts (rowid, content, project, tags, people, refs, component)
        SELECT id, content, COALESCE(project, ''), COALESCE(tags, ''), COALESCE(people, ''), COALESCE(refs, ''), COALESCE(component, '')
        FROM entries
      `);
    }
  }

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
  }): JournalEntry {
    const stmt = this.db.prepare(`
      INSERT INTO entries (content, category, project, tags, source, timestamp, people, refs, component)
      VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?)
    `);
    const tagsStr = params.tags ? params.tags.join(",") : null;
    const peopleStr = params.people ? params.people.join(",") : null;
    const refsStr = params.refs ? params.refs.join(",") : null;
    const info = stmt.run(
      params.content,
      params.category || "general",
      params.project || null,
      tagsStr,
      params.source || "agent",
      params.timestamp || null,
      peopleStr,
      refsStr,
      params.component || null
    );

    // Update FTS index
    const id = info.lastInsertRowid;
    this.db.prepare(`
      INSERT INTO entries_fts (rowid, content, project, tags, people, refs, component)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, params.content, params.project || "", tagsStr || "", peopleStr || "", refsStr || "", params.component || "");

    return this.db
      .prepare("SELECT * FROM entries WHERE id = ?")
      .get(id) as JournalEntry;
  }

  query(params: {
    from?: string;
    to?: string;
    category?: string;
    project?: string;
    search?: string;
    person?: string;
    component?: string;
    limit?: number;
  }): JournalEntry[] {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (params.from) {
      conditions.push("timestamp >= ?");
      values.push(params.from);
    }
    if (params.to) {
      conditions.push("timestamp <= ?");
      values.push(params.to);
    }
    if (params.category) {
      conditions.push("category = ?");
      values.push(params.category);
    }
    if (params.project) {
      conditions.push("project = ?");
      values.push(params.project);
    }
    if (params.person) {
      conditions.push("people LIKE ?");
      values.push(`%${params.person}%`);
    }
    if (params.component) {
      conditions.push("component LIKE ?");
      values.push(`%${params.component}%`);
    }
    if (params.search) {
      conditions.push("id IN (SELECT rowid FROM entries_fts WHERE entries_fts MATCH ?)");
      const ftsQuery = params.search.replace(/['"]/g, "").split(/\s+/).map(w => `"${w}"*`).join(" OR ");
      values.push(ftsQuery);
    }

    const where = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";
    const limit = params.limit || 50;

    return this.db
      .prepare(
        `SELECT * FROM entries ${where} ORDER BY timestamp DESC LIMIT ?`
      )
      .all(...values, limit) as JournalEntry[];
  }

  semanticSearch(query: string, limit?: number): JournalEntry[] {
    const ftsQuery = query.replace(/['"]/g, "").split(/\s+/).map(w => `"${w}"*`).join(" OR ");
    const maxResults = limit || 20;
    try {
      return this.db.prepare(`
        SELECT e.* FROM entries e
        JOIN entries_fts fts ON e.id = fts.rowid
        WHERE entries_fts MATCH ?
        ORDER BY fts.rank
        LIMIT ?
      `).all(ftsQuery, maxResults) as JournalEntry[];
    } catch {
      return this.db.prepare(`
        SELECT * FROM entries
        WHERE content LIKE ? OR people LIKE ? OR refs LIKE ? OR component LIKE ? OR project LIKE ?
        ORDER BY timestamp DESC LIMIT ?
      `).all(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, maxResults) as JournalEntry[];
    }
  }

  whoKnowsAbout(topic: string, limit?: number): { person: string; entries: number; lastActive: string; sample: string }[] {
    const ftsQuery = topic.replace(/['"]/g, "").split(/\s+/).map(w => `"${w}"*`).join(" OR ");
    const maxResults = limit || 10;
    try {
      const entries = this.db.prepare(`
        SELECT e.people, e.content, e.timestamp FROM entries e
        JOIN entries_fts fts ON e.id = fts.rowid
        WHERE entries_fts MATCH ? AND e.people IS NOT NULL AND e.people != ''
        ORDER BY e.timestamp DESC
        LIMIT 200
      `).all(ftsQuery) as { people: string; content: string; timestamp: string }[];
      return this.aggregatePeople(entries, maxResults);
    } catch {
      const entries = this.db.prepare(`
        SELECT people, content, timestamp FROM entries
        WHERE (content LIKE ? OR component LIKE ? OR project LIKE ?) AND people IS NOT NULL AND people != ''
        ORDER BY timestamp DESC LIMIT 200
      `).all(`%${topic}%`, `%${topic}%`, `%${topic}%`) as { people: string; content: string; timestamp: string }[];
      return this.aggregatePeople(entries, maxResults);
    }
  }

  private aggregatePeople(entries: { people: string; content: string; timestamp: string }[], limit: number) {
    const peopleMap = new Map<string, { count: number; lastActive: string; sample: string }>();
    for (const e of entries) {
      const people = e.people.split(",").map(p => p.trim()).filter(Boolean);
      for (const person of people) {
        const existing = peopleMap.get(person);
        if (!existing) {
          peopleMap.set(person, { count: 1, lastActive: e.timestamp, sample: e.content });
        } else {
          existing.count++;
          if (e.timestamp > existing.lastActive) {
            existing.lastActive = e.timestamp;
            existing.sample = e.content;
          }
        }
      }
    }
    return Array.from(peopleMap.entries())
      .map(([person, data]) => ({ person, entries: data.count, lastActive: data.lastActive, sample: data.sample }))
      .sort((a, b) => b.entries - a.entries)
      .slice(0, limit);
  }

  getSummary(date: string): { categories: Record<string, number>; projects: Record<string, number>; entries: JournalEntry[] } {
    const entries = this.db
      .prepare(
        `SELECT * FROM entries WHERE date(timestamp) = date(?) ORDER BY timestamp ASC`
      )
      .all(date) as JournalEntry[];

    const categories: Record<string, number> = {};
    const projects: Record<string, number> = {};
    for (const e of entries) {
      categories[e.category] = (categories[e.category] || 0) + 1;
      if (e.project) {
        projects[e.project] = (projects[e.project] || 0) + 1;
      }
    }
    return { categories, projects, entries };
  }

  listProjects(): string[] {
    const rows = this.db
      .prepare("SELECT DISTINCT project FROM entries WHERE project IS NOT NULL ORDER BY project")
      .all() as { project: string }[];
    return rows.map((r) => r.project);
  }

  deleteEntry(id: number): boolean {
    const info = this.db.prepare("DELETE FROM entries WHERE id = ?").run(id);
    if (info.changes > 0) {
      this.db.prepare("DELETE FROM entries_fts WHERE rowid = ?").run(id);
    }
    return info.changes > 0;
  }
}
