---
title: Docker
description: Self-host Plan Desk with Docker Compose.
---

Build and run on port 3847:

```bash
export PLANDESK_AUTH_PASSWORD='choose-a-strong-password'
docker compose up --build
```

Open [http://127.0.0.1:3847](http://127.0.0.1:3847).

## Auth required for non-loopback bind

Docker sets `PLANDESK_HOST=0.0.0.0`. You must set `PLANDESK_AUTH_PASSWORD` (via `.env` or the environment) or the server refuses to start. Loopback dev (`plandesk serve` on `127.0.0.1`) does not require a password.

## Data persistence

Data persists in the `plandesk-data` Docker volume (`PLANDESK_DATA_DIR=/data` in the container).

## Environment variables

| Variable                 | Default       | Purpose                                    |
| ------------------------ | ------------- | ------------------------------------------ |
| `PLANDESK_DATA_DIR`      | `~/.plandesk` | Workspace directory                        |
| `PLANDESK_HOST`          | `127.0.0.1`   | Bind address                               |
| `PLANDESK_AUTH_PASSWORD` | (unset)       | Required when binding non-loopback         |
| `PLANDESK_MCP_TOKEN`     | (unset)       | Overrides the token read from `.plandesk/token` |
