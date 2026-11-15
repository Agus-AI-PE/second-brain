# Second Brain

Personal knowledge system driven by a Telegram bot. Save notes, links, photos, and documents; they get archived, OCR'd, embedded, and become searchable through an AI agent with memory and reminders.

## Quick start

```sh
cp .env.example .env   # fill in values
pnpm install
docker compose up -d
pnpm --dir apps/api run dev         # HTTP API + dashboard :3000
pnpm --dir apps/platform run dev    # Telegram bot
```

Full instructions: [`docs/guides/install-and-run.md`](docs/guides/install-and-run.md).

## Documentation

Project knowledge lives in [`docs/`](docs/README.md). AI agents and contributors: start from [`AGENTS.md`](AGENTS.md).

- [`docs/products/0001-system-reference.md`](docs/products/0001-system-reference.md) — how every part works
- [`docs/rules/`](docs/rules) — conventions everyone must follow
- [`docs/decision/`](docs/decision) — why things are the way they are
