# Contributing

Thanks for your interest in contributing to `rfd`! This guide covers local setup and how the project is organized.

## Prerequisites

- [Node.js](https://nodejs.org/) v24.15.0 or later
- [pnpm](https://pnpm.io/) (this is a pnpm workspace)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (included as a dependency)

## Getting Started

Clone the repo and install dependencies from the root:

```sh
git clone https://github.com/bombshell-dev/rfd.git
cd rfd
pnpm install
```

## Project Structure

This is a monorepo with three packages under `packages/`:

### `packages/lexicon`

AT Protocol lexicon definitions and generated TypeScript types. Lexicons describe the data schemas used across the platform (repos, pulls, issues, discussions).

**Key commands:**

```sh
pnpm --filter lexicon build     # generate types from lexicon definitions
pnpm --filter lexicon dev       # regenerate types on change
```

### `packages/www`

The web application. Built with [Astro](https://astro.build/) and deployed to [Cloudflare Workers](https://workers.cloudflare.com/) via the `@astrojs/cloudflare` adapter. Uses Cloudflare D1 for storage and an auxiliary Spacedust worker for background processing.

**Key commands:**

```sh
pnpm --filter www dev           # start the dev server at 127.0.0.1:4321
pnpm --filter www build         # production build
pnpm --filter www preview       # preview with wrangler
pnpm --filter www test          # run tests
pnpm --filter www generate-types # generate Cloudflare worker types
```

### `packages/cli`

Placeholder for a future CLI package. Currently empty.

## Development Workflow

1. **Install dependencies** from the root (`pnpm install`).
2. **Generate lexicon types** if you're working on schemas: `pnpm --filter lexicon build`.
3. **Start the dev server** for the web app: `pnpm --filter www dev`.
4. **Run tests** before submitting changes: `pnpm --filter www test`.

## What is this project?

`rfd` is an experimental, [AT Protocol](https://atproto.com/)-powered platform for Requests for Discussion. It indexes data from atproto repositories and provides a web interface for browsing and interacting with proposals, pull requests, issues, and discussions.

## Submitting Changes

- Open a pull request against `main`.
- Keep changes focused. Smaller PRs are easier to review.
- If you're proposing a significant change, consider opening an issue first to discuss the approach.
