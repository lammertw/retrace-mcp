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

export interface Project {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
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
    let version = this.getSchemaVersion();

    if (version < 1) {
      // Fresh install: create latest schema directly
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL DEFAULT (datetime('now')),
          category TEXT NOT NULL DEFAULT 'general',
          project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
          content TEXT NOT NULL,
          tags TEXT,
          source TEXT NOT NULL DEFAULT 'manual',
          people TEXT,
          refs TEXT,
          component TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_entries_timestamp ON entries(timestamp);
        CREATE INDEX IF NOT EXISTS idx_entries_category ON entries(category);
        CREATE INDEX IF NOT EXISTS idx_entries_project_id ON entries(project_id);
        CREATE INDEX IF NOT EXISTS idx_entries_component ON entries(component);
      `);

      // Full-text search index
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
          content, project, tags, people, refs, component,
          content_rowid=id
        );
      `);

      this.setSchemaVersion(2);
      version = 2;
    }

    if (version < 2) {
      // v1.0.0 migration: entries had 'project' TEXT column, no projects table.
      // Add projects table and project_id FK.
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      this.db.exec(`
        INSERT OR IGNORE INTO projects (name)
        SELECT DISTINCT project FROM entries WHERE project IS NOT NULL AND project != '';
      `);

      const columns = this.db.pragma("table_info(entries)") as { name: string }[];
      const hasProjectId = columns.some((c) => c.name === "project_id");
      if (!hasProjectId) {
        this.db.exec(`ALTER TABLE entries ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL`);
        this.db.exec(`UPDATE entries SET project_id = (SELECT id FROM projects WHERE name = entries.project) WHERE project IS NOT NULL`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_entries_project_id ON entries(project_id)`);
      }

      this.setSchemaVersion(2);
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
        SELECT e.id, e.content, COALESCE(p.name, ''), COALESCE(e.tags, ''), COALESCE(e.people, ''), COALESCE(e.refs, ''), COALESCE(e.component, '')
        FROM entries e LEFT JOIN projects p ON e.project_id = p.id
      `);
    }
  }

  private resolveProjectId(projectName?: string): number | null {
    if (!projectName) return null;
    const existing = this.db.prepare("SELECT id FROM projects WHERE name = ?").get(projectName) as { id: number } | undefined;
    if (existing) return existing.id;
    const info = this.db.prepare("INSERT INTO projects (name) VALUES (?)").run(projectName);
    return info.lastInsertRowid as number;
  }

  private getProjectName(projectId: number | null): string | null {
    if (!projectId) return null;
    const row = this.db.prepare("SELECT name FROM projects WHERE id = ?").get(projectId) as { name: string } | undefined;
    return row ? row.name : null;
  }

  private toJournalEntry(row: { id: number; timestamp: string; category: string; project_id: number | null; content: string; tags: string | null; source: string; people: string | null; refs: string | null; component: string | null }): JournalEntry {
    return {
      id: row.id,
      timestamp: row.timestamp,
      category: row.category,
      project: this.getProjectName(row.project_id),
      content: row.content,
      tags: row.tags,
      source: row.source,
      people: row.people,
      refs: row.refs,
      component: row.component,
    };
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
    const projectId = this.resolveProjectId(params.project);
    const stmt = this.db.prepare(`
      INSERT INTO entries (content, category, project_id, tags, source, timestamp, people, refs, component)
      VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?)
    `);
    const tagsStr = params.tags ? params.tags.join(",") : null;
    const peopleStr = params.people ? params.people.join(",") : null;
    const refsStr = params.refs ? params.refs.join(",") : null;
    const info = stmt.run(
      params.content,
      params.category || "general",
      projectId,
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

    const row = this.db.prepare("SELECT * FROM entries WHERE id = ?").get(id) as any;
    return this.toJournalEntry(row);
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
      conditions.push("project_id IN (SELECT id FROM projects WHERE name = ?)");
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

    const rows = this.db
      .prepare(
        `SELECT * FROM entries ${where} ORDER BY timestamp DESC LIMIT ?`
      )
      .all(...values, limit) as any[];
    return rows.map(r => this.toJournalEntry(r));
  }

  semanticSearch(query: string, limit?: number): JournalEntry[] {
    const ftsQuery = query.replace(/['"]/g, "").split(/\s+/).map(w => `"${w}"*`).join(" OR ");
    const maxResults = limit || 20;
    try {
      const rows = this.db.prepare(`
        SELECT e.* FROM entries e
        JOIN entries_fts fts ON e.id = fts.rowid
        WHERE entries_fts MATCH ?
        ORDER BY fts.rank
        LIMIT ?
      `).all(ftsQuery, maxResults) as any[];
      return rows.map(r => this.toJournalEntry(r));
    } catch {
      const rows = this.db.prepare(`
        SELECT * FROM entries
        WHERE content LIKE ? OR people LIKE ? OR refs LIKE ? OR component LIKE ? OR project_id IN (SELECT id FROM projects WHERE name LIKE ?)
        ORDER BY timestamp DESC LIMIT ?
      `).all(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, maxResults) as any[];
      return rows.map(r => this.toJournalEntry(r));
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
        SELECT e.people, e.content, e.timestamp FROM entries e
        LEFT JOIN projects p ON e.project_id = p.id
        WHERE (e.content LIKE ? OR e.component LIKE ? OR p.name LIKE ?) AND e.people IS NOT NULL AND e.people != ''
        ORDER BY e.timestamp DESC LIMIT 200
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
    const rows = this.db
      .prepare(
        `SELECT * FROM entries WHERE date(timestamp) = date(?) ORDER BY timestamp ASC`
      )
      .all(date) as any[];
    const entries = rows.map(r => this.toJournalEntry(r));

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

  listProjects(): Project[] {
    return this.db
      .prepare("SELECT * FROM projects ORDER BY name")
      .all() as Project[];
  }

  deleteEntry(id: number): boolean {
    const info = this.db.prepare("DELETE FROM entries WHERE id = ?").run(id);
    if (info.changes > 0) {
      this.db.prepare("DELETE FROM entries_fts WHERE rowid = ?").run(id);
    }
    return info.changes > 0;
  }
}
