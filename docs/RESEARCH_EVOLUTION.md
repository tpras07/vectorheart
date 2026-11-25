# Research Evolution — first integration

The new project tab reads the scientific kernel's ordered event log. Journal saves, graph corrections, AI proposals, experiment operations, literature events, and autonomous investigation events appear automatically when those existing features commit events. New AI proposal-generated events are emitted in the same transaction as their validated proposal records. Events are polled every five seconds while the page is open. Historical records only appear if they were already logged by the kernel.

Checkpoint snapshots persist project title, description, question, research objects, relationships and canvas positions. They do not include a full database snapshot, conversations, execution artifacts, credentials or complete historical versions of all related data. They are read-only. Exploration lanes are a chronological grouping of activity in the shared workspace, not independent research states. Only one lane is active at a time; asynchronously completed activity is grouped by its commit order, not proven causal membership. Closing a lane records the researcher's assessment without changing objects or data. Returning to a checkpoint to begin a new tracking lane does not restore the workspace. True state isolation, branch-aware AI context, restoration and merging are intentionally not implemented yet.

## How to try later

Copy the changed/new files into the ui-redesign branch only, after reviewing the changes. The combined update includes the original stylesheet, scoped evolution styles, shared processing animation, and the earlier optional lavender homepage theme. Apply the patch only to a clean compatible working tree. No dependency or database migration changes are required. Restart both development servers, open a project, and select Research Evolution. Use a disposable test project first.

## Verification

Backend: 55 tests passed, 3 SDK adapter tests deselected because the OpenAI, Anthropic and Gemini SDK packages are unavailable here. The new tests exercise checkpoint immutability, cross-project access restrictions, lane lifecycle, AI proposal creation/acceptance with a deterministic provider, and real synthetic experiment event logging. Modified TSX files were syntax-transpiled with TypeScript; full frontend dependency installation, type checking, browser rendering and live AI provider tests were not performed. No existing scientific algorithm changed.
