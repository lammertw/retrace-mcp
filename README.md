# retrace-mcp

**Your AI's work log — automatic, private, local.**

Retrace automatically logs what you work on — decisions, bugs, people, references — as you code. All stored locally in SQLite. No account, no cloud, no data leaving your machine.

Query your work history months later:
- "What was that caching bug last month?"
- "Who worked on the payment integration?"
- "Give me a standup summary for yesterday"

## Setup

No install needed — just add Retrace to your MCP client config. It downloads automatically on first run.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "retrace": {
      "command": "npx",
      "args": ["-y", "retrace-mcp"]
    }
  }
}
```

### VS Code (GitHub Copilot)

Add to your `.vscode/mcp.json`:

```json
{
  "servers": {
    "retrace": {
      "command": "npx",
      "args": ["-y", "retrace-mcp"]
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "retrace": {
      "command": "npx",
      "args": ["-y", "retrace-mcp"]
    }
  }
}
```

That's it. Start a coding session and Retrace will automatically begin logging your work.

> **Optional:** If you prefer a permanent install, run `npm install -g retrace-mcp`.

## How it works

1. **Add the config** — paste the snippet above, no account needed
2. **Code normally** — your AI agent automatically logs meaningful work entries
3. **Query anytime** — ask about past work, get perfect standups, find who knows what

The AI logs entries proactively as you work. You never need to open an app or write anything manually.

## Tools

| Tool | Description |
|------|-------------|
| `log_entry` | Log a work memory entry (the AI calls this automatically) |
| `query_journal` | Search and filter entries by date, project, category, person, component |
| `recall` | Natural language search across all entries |
| `get_summary` | Daily summary for standups |
| `list_projects` | List all logged projects |
| `who_knows_about` | Find people with experience in a topic |
| `delete_entry` | Remove an entry by ID |

## Data storage

All data is stored locally in SQLite at:

```
~/.retrace/journal.db
```

To use a custom path:

```bash
retrace-mcp --db-path /path/to/my/journal.db
```

Or set the environment variable:

```bash
RETRACE_DB_PATH=/path/to/my/journal.db
```

### Backup

Simply copy the database file:

```bash
cp ~/.retrace/journal.db ~/.retrace/journal.backup.db
```

## Cloud upgrade

Want multi-device sync, a web dashboard, team memory, and encrypted cloud storage? Connect your MCP client directly to the Retrace cloud endpoint — no local install needed.

Learn more at [retrace-zeta.vercel.app](https://retrace-zeta.vercel.app)

## Requirements

- Node.js 18+

## License

MIT
