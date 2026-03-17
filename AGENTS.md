# Fleet

> **A Multi-LLM Orchestration Kit**
>
> A custom extension fleet based on [pi-coding-agent](https://github.com/badlogic/pi-mono).
> The core purpose is to operate Claude Code, Codex CLI, and Gemini CLI integrated within a single interface.

## Structure

| Path | Description |
|------|-------------|
| `extensions/` | Collection of pi extensions and shared libraries (refer to its own `AGENTS.md`) |

> Currently, there is no `pi/` directory — symlink setup is not required.

## Git Guidelines

- **Commit Message Format:** Strictly adhere to the [Conventional Commits](https://www.conventionalcommits.org/) specification.
  - Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Language:** All commit messages **MUST be written in English**.
