<h1 align="center">Firewhale</h1>

<p align="center">
  <img src="static/brand-icon.png" width="130" alt="Firewhale icon" />
</p>

<p align="center">
  <a href="https://github.com/Riddle06/tauri-firewhale/releases/latest">
    <img src="https://img.shields.io/badge/Download-Latest%20Release-f46a2a?style=for-the-badge&logo=github" alt="Download Latest Release" />
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/Riddle06/tauri-firewhale?display_name=tag&label=app%20version" alt="App version" />
  <img src="https://img.shields.io/github/license/Riddle06/tauri-firewhale?label=license" alt="License" />
  <img src="https://img.shields.io/badge/tauri-v2-24C8DB?logo=tauri&logoColor=white" alt="Tauri version" />
  <img src="https://img.shields.io/badge/svelte-v5-ff3e00?logo=svelte&logoColor=white" alt="Svelte version" />
  <a href="https://github.com/Riddle06/tauri-firewhale/actions/workflows/ci.yml">
    <img src="https://github.com/Riddle06/tauri-firewhale/actions/workflows/ci.yml/badge.svg" alt="CI status" />
  </a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-3c82f6" alt="Supported platforms" />
</p>

Firewhale is a desktop workspace for Firebase Firestore. Browse collections, run queries, inspect results, and edit documents in a focused, app-like experience.

## Features

- Connection-focused workspace with dedicated windows per project.
- Query editor with autocomplete, formatting, and quick run actions.
- Result table and JSON viewers/editors for fast document inspection.
- Built with Tauri + SvelteKit for a native-feeling desktop workflow.

## Query Examples

```js
db.collection('users')
  .where('active', '==', true)
  .select('name', 'email', 'profile.city')
  .get()

db.collection('users', 'u')
  .join('organization', 'o', 'o.id', '==', 'u.organization')
  .select('u.displayName', 'o.name')
  .get()

db.collection('users')
  .where('active', '==', true)
  .count()
```

Use `.select()` with `.get()` to choose the result fields. A join query can select fields by collection alias. In JSON, selected joined fields use column names such as `o.name` as keys and return arrays, with an empty array for a row that has no match. Use `__name__` to include a document ID. Opening the editor from a projected row fetches the full primary document.

The editor suggests known collections in `.join()` and recorded fields after an alias and dot in `.select()`. Successful queries record fields for each collection they read.

Use `.count()` as the last method to return the number of matching documents from one collection. An explicit `.limit(50)` caps the count at 50. Omit `.limit()` to count every match. An explicit `.orderBy()` counts only documents that have the sort field.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl + Enter` | Run active query |
| `Cmd/Ctrl + Shift + F` | Format active query |
| `Shift + Alt + F` | Alternative format shortcut |
| `Tab` | Insert two spaces in query editor |
| `Cmd/Ctrl + W` | Close active query tab in workspace |
| `Cmd/Ctrl + F` | Open search panel in document JSON editor |

## Architecture

```text
SvelteKit SPA (src/routes, src/lib/components)
        |
        v
Tauri v2 shell + multi-window runtime (src-tauri)
        |
        v
Firestore query engine + workspace state (src/lib/query, src/lib/stores)
```

## Tech Stack

| Layer | Stack |
| --- | --- |
| Frontend | SvelteKit 2, Svelte 5, Vite |
| Desktop Runtime | Tauri 2 |
| Language | TypeScript, Rust |
| Editor | CodeMirror 6 |
| Data/Domain | Firebase Firestore APIs |
| Package Manager | Bun |
| CI/CD | GitHub Actions + GitHub Releases |

## Screenshots

![Firewhale screenshot 1](screenshots/screenshot_1.jpg)
![Firewhale screenshot 2](screenshots/screenshot_2.jpg)
![Firewhale screenshot 3](screenshots/screenshot_3.jpg)

## Development

```bash
bun install
bun run dev
bun run tauri dev
```

## Author

- Cheng-Ju Li
- GitHub: [@Riddle06](https://github.com/Riddle06)
