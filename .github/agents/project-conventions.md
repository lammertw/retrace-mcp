# Project Conventions

This file defines project-specific patterns, tools, and conventions that the agents reference.
When copying agents to a new project, **this is the only file you need to customize**.

## Project

- **Name**: retrace-mcp
- **Type**: Standalone MCP server package (stdio + local SQLite)
- **Repo**: lammertw/retrace-mcp
- **Languages**: TypeScript, SQL
- **Runtime**: Node.js 18+
- **Module target**: CommonJS build in `dist/`

## Product Scope

- This repository is the local-first MCP server package published to npm.
- It is intentionally separate from the hosted web/cloud app repository.
- Keep this package focused on local journaling and MCP tool behavior.

## Related Repositories

- **Hosted web app**: Retrace web/cloud app in the `TechJournalMCP` workspace folder.
- Coordinate API/tool semantics with the hosted app when needed, but keep implementations independent.

## Workspace Structure

- `src/index.ts` bootstraps the MCP stdio server and registers tools.
- `src/backend.ts` defines backend contracts.
- `src/local-backend.ts` wires backend interface to the SQLite implementation.
- `src/db.ts` contains schema, migrations, and query logic.
- `src/exports.ts` is the package public export surface.

## Architecture Patterns

### MCP Server
- Use `@modelcontextprotocol/sdk` server + stdio transport.
- Tool schemas are declared with `zod`.
- Tool behavior should be deterministic and return clear, user-readable text.

### Backend Abstraction
- Keep business operations behind the `JournalBackend` interface.
- `LocalBackend` should remain a thin adapter to the DB layer.
- Avoid placing SQL logic directly in tool handlers.

### Database and Migrations
- SQLite database defaults to `~/.retrace/journal.db`.
- Respect `--db-path` and `RETRACE_DB_PATH` overrides.
- All schema changes must be migration-safe for existing users.
- Preserve WAL mode, FTS behavior, and project linkage semantics.

## Code Style and Implementation

- Follow existing TypeScript style in this repository.
- Keep imports explicit and avoid dead exports.
- Validate and sanitize user-provided query input before use.
- Prefer focused edits over broad refactors unless requested.

## Reliability and Data Safety

- Never perform destructive data changes without explicit user intent.
- Keep delete operations explicit and scoped (for example by entry ID only).
- Do not log secrets or sensitive local file-system details unnecessarily.

## Build and Verification

- Install deps: `npm install`
- Build: `npm run build`
- Run locally: `npm start`
- Verify CLI helper flags still work: `--help`, `--version`, `--db-path`
- Before release, ensure `dist/` output is regenerated from current `src/`.

## Affected Areas Checklist

When planning or reviewing features in this repository, check impact on:
- MCP tool names, params, and responses
- DB schema/migration compatibility for existing local databases
- Full-text search behavior and query performance
- npm package runtime compatibility (Node 18+)
- Public exports and backward compatibility for consumers
