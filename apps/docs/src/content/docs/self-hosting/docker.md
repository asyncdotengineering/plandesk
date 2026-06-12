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

## Securing the server

Docker sets `PLANDESK_HOST=0.0.0.0`. For any internet-facing deployment, set `PLANDESK_AUTH_PASSWORD` to enable HTTP auth on the UI and REST API. Without it, the server is open — fine on a trusted LAN, not for a public host.

## Data persistence

Data persists in the `plandesk-data` Docker volume (`PLANDESK_DATA_DIR=/data` in the container).

## Environment variables

| Variable                 | Default       | Purpose                                    |
| ------------------------ | ------------- | ------------------------------------------ |
| `PLANDESK_DATA_DIR`      | `/data` (Docker) | Workspace directory                     |
| `PLANDESK_HOST`          | `0.0.0.0`     | Bind address                               |
| `PLANDESK_AUTH_PASSWORD` | (unset)       | Enables HTTP auth; recommended for public hosts |
| `PLANDESK_MCP_TOKEN`     | (unset)       | Overrides the token read from `.plandesk/token` |
