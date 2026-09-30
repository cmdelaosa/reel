# CLAUDE.md — reel

What the project is, how it was built and how to run it: [README.md](README.md). Architecture,
schema and RLS model: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). This file holds only what an
agent needs in every session and the README does not say.

## MCP

- `.mcp.json` registers `supabase-local` (`http://localhost:54321/mcp`), the MCP endpoint of the
  local stack that `supabase start` boots. Approved by name in `.claude/settings.json`, no
  permission prompt: the local DB is disposable (`supabase db reset` rebuilds it).
- **When to use it** (30-09-2026): to look at tables, RLS policies, rows or run SQL against the
  local stack, `supabase-local` comes **before** `supabase db query` or `psql`.
- **Check that 54321 is reel's stack first.** Every local Supabase project defaults to that port,
  and `tvtime` uses the defaults too: with its stack up, `supabase-local` talks to tvtime's
  database, not reel's. `supabase status` from the repo root must name this project; if another
  one holds the port, `supabase stop --project-id <that one>` and `supabase start` here.
- The hosted project never goes in the repo (it is public): it is added in local scope and
  read-only, as the README says. Production is never written through MCP.
