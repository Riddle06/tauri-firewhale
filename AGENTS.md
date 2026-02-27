# AGENTS

Purpose: guidance for agentic coding in this repo.
Scope: SvelteKit frontend + Tauri (Rust) backend.

## Repository notes
- Package manager: bun (see README).
- Frontend: SvelteKit + Vite (SPA via adapter-static).
- Backend: Tauri 2 (Rust) in `src-tauri`.
- Tests: `bun:test` with `*.test.ts` files.
- No Cursor rules or Copilot instructions found.

## Commands
All commands run from repo root unless noted.

### Install
- `bun install`

### Development
- `bun run dev` (Vite dev server)
- `bun run tauri dev` (Tauri dev shell + Vite)

### Build
- `bun run build` (frontend build)
- `bun run tauri build` (Tauri app build)

### Typecheck / lint
- `bun run check` (svelte-check + tsconfig)
- `bun run check:watch` (watch mode)

### Tests
- `bun test` (run all tests)
- `bun test src/lib/query/parser.test.ts` (single file)
- `bun test -t "parseQueryChain" src/lib/query/parser.test.ts` (single test name)

### Rust (optional)
- `cargo test` (from `src-tauri`)
- `cargo fmt` (from `src-tauri` if formatting needed)

## Code style (TypeScript / Svelte)
Follow existing formatting and idioms in the repo.

### Formatting
- Indentation: 2 spaces.
- Quotes: double quotes for JS/TS strings.
- Trailing commas: use in multiline objects/arrays/params.
- Semicolons: use consistently (codebase uses them).
- Line length: keep readable; break long expressions.

### Imports
- Prefer `import type { ... }` for type-only imports.
- Group imports: external packages first, then `$lib`/app, then relative.
- Keep import lists alphabetized when editing.
- Avoid unused imports; remove when refactoring.

### Types
- `strict` TypeScript is enabled.
- Prefer explicit return types for exported functions.
- Use `type` aliases for shapes, unions, and utility types.
- Use `Record<string, unknown>` for generic object maps.
- Avoid `any`; use `unknown` and narrow.
- Favor narrow unions (e.g., literal strings) where possible.

### Naming
- Variables/functions: `camelCase`.
- Types/interfaces: `PascalCase`.
- Constants: `SCREAMING_SNAKE_CASE` if global or shared.
- Files: `kebab-case` (e.g., `document-json.ts`).
- Svelte components: `PascalCase.svelte`.

### Error handling
- Use `try/catch` for parsing or IO boundaries.
- Prefer returning `{ ok: true, value }` / `{ ok: false, error }` patterns
  when callers need to show errors.
- Throw only for truly unexpected states; surface friendly messages.
- Include positional info when parsing (see `QueryParseError`).

### Async patterns
- Use `async/await` instead of raw promises.
- Use `void` for fire-and-forget async calls.
- Avoid unhandled promise rejections.

### Svelte (Svelte 5 runes)
- Components use `lang="ts"`.
- Props are declared via `$props<{ ... }>()` with defaults.
- Use `$derived` and `$effect` for reactivity.
- Prefer stores in `src/lib/stores` with clear update helpers.
- Keep DOM bindings simple; avoid deep mutations.

### CSS / styling
- CSS lives in component `<style>` blocks or route styles.
- Use existing CSS variables under `:root` (e.g., `--fw-*`).
- Prefer subtle gradients and consistent color tokens.
- Keep layout styles localized to components.

## Code style (Rust / Tauri)
- Default Rust formatting (4 spaces, rustfmt).
- Commands exposed via `#[tauri::command]` in `src-tauri/src/lib.rs`.
- Keep `main.rs` minimal; call into lib.
- Use `Result<T, E>` for fallible command handlers.
- Prefer explicit error messages for `expect` only on startup.

## Testing guidelines
- Tests use `bun:test` (`describe`, `test`, `expect`).
- Name tests with clear behavior statements.
- Keep fixtures inline and small; avoid external IO.
- Prefer testing pure functions in `src/lib`.

## File organization
- `src/lib` for shared logic and types.
- `src/lib/utils` for pure helpers.
- `src/lib/stores` for Svelte stores.
- `src/routes` for SvelteKit pages/layouts.
- `src-tauri` for Rust backend.

## Practical tips for agents
- Run `bun run check` after TypeScript or Svelte changes.
- Keep changes focused; avoid unrelated formatting churn.
- Mirror existing patterns before introducing new ones.
- Add tests for new parsing or formatting logic.

## Missing tool configs
- No `.cursor/rules/`, `.cursorrules`, or `.github/copilot-instructions.md` found.
