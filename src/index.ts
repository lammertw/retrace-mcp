#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { LocalBackend } from "./local-backend.js";

const dbPath = process.argv.includes("--db-path")
  ? process.argv[process.argv.indexOf("--db-path") + 1]
  : process.env.RETRACE_DB_PATH;

if (process.argv.includes("--version")) {
  const pkg = require("../package.json");
  console.log(`retrace-mcp v${pkg.version}`);
  process.exit(0);
}

if (process.argv.includes("--help")) {
  console.log(`retrace-mcp — AI work journal (local SQLite)

Usage:
  retrace-mcp [options]

Options:
  --db-path <path>  Path to SQLite database (default: ~/.retrace/journal.db)
  --version         Show version
  --help            Show this help

Environment variables:
  RETRACE_DB_PATH   Alternative to --db-path
`);
  process.exit(0);
}

const backend = new LocalBackend(dbPath);

const pkg = require("../package.json");
const server = new McpServer({
  name: "retrace",
  version: pkg.version,
});

// --- Tools ---

server.tool(
  "log_entry",
  `Log a work memory entry. Call this proactively whenever something meaningful happens during the session.

ALWAYS log:
- What was accomplished (the outcome, not just "edited files")
- WHY decisions were made ("chose Redis over Memcached because we need persistence")
- WHO was involved or mentioned (colleagues, reviewers, whoever came up in conversation)
- Root causes of bugs and how they were resolved
- Context switches between tasks
- Ticket/PR/issue references mentioned in conversation

Write entries as if helping your future self recall this 3 months from now. Include technical specifics — service names, error messages, architectural choices. A good entry answers: what happened, why, who was involved, and what system/component was affected.`,
  {
    content: z.string().describe("Rich description of what happened. Include the what, why, and how. Write for future recall — be specific about technical details, decisions, root causes, and outcomes."),
    category: z
      .enum(["coding", "debugging", "reviewing", "deploying", "meeting", "research", "planning", "general"])
      .optional()
      .describe("Category of work"),
    project: z.string().optional().describe("Project name (e.g. 'forbes-mobile', 'payment-service')"),
    tags: z.array(z.string()).optional().describe("Tags for the entry (e.g. ['caching', 'performance', 'redis'])"),
    people: z.array(z.string()).optional().describe("People involved or mentioned — colleagues, reviewers, reporters (e.g. ['Marcus', 'Sarah', 'Alex Chen'])"),
    refs: z.array(z.string()).optional().describe("External references — ticket IDs, PR numbers, doc links (e.g. ['MOB-1634', 'PR #287', 'RFC-12'])"),
    component: z.string().optional().describe("Specific system, service, or component affected (e.g. 'cache-layer', 'auth-service', 'iOS-networking')"),
    source: z.string().optional().describe("Source agent (e.g. 'copilot', 'cursor', 'manual')"),
  },
  async (params) => {
    const entry = await backend.logEntry(params);
    return {
      content: [
        {
          type: "text" as const,
          text: `Logged entry #${entry.id} at ${entry.timestamp}`,
        },
      ],
    };
  }
);

server.tool(
  "query_journal",
  `Search and filter work memory entries. Use this to recall past work, find decisions, understand what happened on a project, or answer questions like "when did I do X?" or "what was that problem with Y?".

Searches across content, people, references, components, and tags. Combine filters to narrow results.`,
  {
    from: z.string().optional().describe("Start date/time (ISO 8601)"),
    to: z.string().optional().describe("End date/time (ISO 8601)"),
    category: z.string().optional().describe("Filter by category"),
    project: z.string().optional().describe("Filter by project name"),
    search: z.string().optional().describe("Full-text search across all fields (content, people, refs, component, tags)"),
    person: z.string().optional().describe("Filter entries mentioning a specific person"),
    component: z.string().optional().describe("Filter by system/service/component"),
    limit: z.number().optional().describe("Max entries to return (default 50)"),
  },
  async (params) => {
    const entries = await backend.query(params);
    return {
      content: [
        {
          type: "text" as const,
          text:
            entries.length === 0
              ? "No entries found."
              : entries
                  .map(
                    (e) =>
                      `[#${e.id}] ${e.timestamp} [${e.category}]${e.project ? ` (${e.project})` : ""}${e.component ? ` [${e.component}]` : ""}: ${e.content}${e.people ? ` | People: ${e.people}` : ""}${e.refs ? ` | Refs: ${e.refs}` : ""}${e.tags ? ` | Tags: ${e.tags}` : ""}`
                  )
                  .join("\n"),
        },
      ],
    };
  }
);

server.tool(
  "get_summary",
  "Get a summary of work done on a specific date. Great for standups and daily recaps.",
  {
    date: z
      .string()
      .describe("Date to summarize (YYYY-MM-DD). Use 'today' or 'yesterday' as shortcuts."),
  },
  async (params) => {
    let date = params.date;
    const now = new Date();
    if (date === "today") {
      date = now.toISOString().split("T")[0];
    } else if (date === "yesterday") {
      now.setDate(now.getDate() - 1);
      date = now.toISOString().split("T")[0];
    }

    const summary = await backend.getSummary(date);
    if (summary.entries.length === 0) {
      return {
        content: [{ type: "text" as const, text: `No entries found for ${date}.` }],
      };
    }

    const lines = [
      `## Summary for ${date}`,
      `**${summary.entries.length} entries** across ${Object.keys(summary.categories).length} categories`,
      "",
      "### By Category",
      ...Object.entries(summary.categories).map(
        ([cat, count]) => `- ${cat}: ${count}`
      ),
    ];

    if (Object.keys(summary.projects).length > 0) {
      lines.push("", "### By Project");
      lines.push(
        ...Object.entries(summary.projects).map(
          ([proj, count]) => `- ${proj}: ${count}`
        )
      );
    }

    lines.push("", "### Entries");
    lines.push(
      ...summary.entries.map(
        (e) =>
          `- ${e.timestamp.split(" ")[1] || e.timestamp} [${e.category}]${e.project ? ` (${e.project})` : ""}: ${e.content}`
      )
    );

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  }
);

server.tool(
  "list_projects",
  "List all projects that have been logged in the journal.",
  {},
  async () => {
    const projects = await backend.listProjects();
    return {
      content: [
        {
          type: "text" as const,
          text:
            projects.length === 0
              ? "No projects logged yet."
              : projects.map(p => `- ${p.name}${p.description ? `: ${p.description}` : ""} (created ${p.created_at})`).join("\n"),
        },
      ],
    };
  }
);

server.tool(
  "delete_entry",
  "Delete a journal entry by ID.",
  {
    id: z.number().describe("Entry ID to delete"),
  },
  async (params) => {
    const deleted = await backend.deleteEntry(params.id);
    return {
      content: [
        {
          type: "text" as const,
          text: deleted
            ? `Deleted entry #${params.id}.`
            : `Entry #${params.id} not found.`,
        },
      ],
    };
  }
);

server.tool(
  "recall",
  `Search work memory using natural language. Unlike query_journal which uses structured filters, this tool finds entries by meaning — use it for fuzzy questions like "What was that caching problem in the mobile app?" or "When did we discuss the API redesign?"

This searches across all fields (content, people, refs, components, projects, tags) using full-text matching with ranking. Best for when you don't remember exact dates, project names, or categories.`,
  {
    query: z.string().describe("Natural language question or keywords to search for (e.g. 'caching issue Forbes mobile app', 'database migration problems')"),
    limit: z.number().optional().describe("Max entries to return (default 20)"),
  },
  async (params) => {
    const entries = await backend.semanticSearch(params.query, params.limit);
    return {
      content: [
        {
          type: "text" as const,
          text:
            entries.length === 0
              ? "No matching entries found."
              : entries
                  .map(
                    (e) =>
                      `[#${e.id}] ${e.timestamp} [${e.category}]${e.project ? ` (${e.project})` : ""}${e.component ? ` [${e.component}]` : ""}: ${e.content}${e.people ? ` | People: ${e.people}` : ""}${e.refs ? ` | Refs: ${e.refs}` : ""}${e.tags ? ` | Tags: ${e.tags}` : ""}`
                  )
                  .join("\n"),
        },
      ],
    };
  }
);

server.tool(
  "who_knows_about",
  `Find team members with experience in a specific topic, technology, or area. Use this to answer questions like "Who should pick up this ticket?", "Who has worked on the caching layer?", or "Who knows about the payment integration?"

Analyzes logged entries to find people who have been involved in work related to the given topic, ranked by relevance and recency.`,
  {
    topic: z.string().describe("Topic, technology, component, or area to find expertise for (e.g. 'Redis caching', 'iOS networking', 'payment integration')"),
    limit: z.number().optional().describe("Max people to return (default 10)"),
  },
  async (params) => {
    const results = await backend.whoKnowsAbout(params.topic, params.limit);
    return {
      content: [
        {
          type: "text" as const,
          text:
            results.length === 0
              ? "No people found with experience in this area. (Tip: make sure entries are logged with the 'people' field populated.)"
              : [
                  `## People with experience in "${params.topic}"`,
                  "",
                  ...results.map(
                    (r, i) =>
                      `${i + 1}. **${r.person}** — ${r.entries} related entries, last active ${r.lastActive}\n   Recent: ${r.sample}`
                  ),
                ].join("\n"),
        },
      ],
    };
  }
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Retrace v${pkg.version} — logging to ${dbPath || "~/.retrace/journal.db"}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
