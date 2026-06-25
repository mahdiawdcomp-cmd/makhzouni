# Project type & scope

- This is **mainly a Windows desktop accounting / invoice application** — `inventory-desktop-trial` (Tauri v2 + React) is the primary target. There is also a shared web build (`inventory-web`) and an Android client (`inventory-android`).
- Backend: `inventory-backend` (Node/Express + Prisma). **Database is PostgreSQL hosted on Railway** (migrated off Neon). Web → Vercel, backend → Railway, DNS → Cloudflare.
- **Multi-tenant SaaS:** the web/desktop/Android codebases are SHARED across all shops. Every fix/feature must work for current AND future tenants — never hardcode a tenant (no `mahdi`/`abomahdi` hardcode). Tenant is resolved from the subdomain. Respect per-tenant data isolation.
- **Cross-platform parity rule:** desktop may have extras the web lacks (leave those). But anything present in `inventory-web` and missing from `inventory-desktop-trial` should be completed there AND in `inventory-android` so all three match.
- **Do not mix web/mobile experiments with the desktop app unless explicitly asked.**

# Token-saving & memory workflow (MANDATORY)

This is a large, complex project. Conserve context aggressively:

- **Always use Serena before reading files.** Use `get_symbols_overview` for a file outline, `find_symbol` for a specific symbol, and `find_referencing_symbols` for usages — instead of reading whole files.
- **Prefer symbol search, references, and file outline over reading full files.**
- **Read only the minimum files needed for the current task.** Never read the whole repository.
- **Never re-analyze the whole project after every prompt.** Do not run broad scans unless required for a specific task.
- **Never touch unrelated files. Never fix unrelated issues without permission.**

## Before editing (every task)
- Write a short plan and list the **exact files likely needed**.

## After editing (every task)
- Report: **files changed, the reason, tests/build results, and a one-line memory summary.**
- **Save important decisions and progress to Memory Keeper** (`context_save`) after each task — project decisions, task progress, architecture notes, forbidden areas, and completed fixes.

# Library / API documentation

- **Use Context7 for all library/API documentation** — React, Tauri v2, PostgreSQL/Prisma, Kotlin, Android, and any other external package/API work. Resolve the library with `resolve-library-id`, then fetch docs with `query-docs` instead of guessing API surfaces.

# MCP tooling configured for this project

Configured in `.mcp.json` (loaded by Claude Code on startup; project MCP servers require user approval on first launch):
- **serena** — symbol-level navigation & editing (run via `uvx`).
- **memory-keeper** — persistent project memory (SQLite store at `.claude/memory-keeper/context.db`, via `DATA_DIR`).
- **context7** — up-to-date library/API docs.
