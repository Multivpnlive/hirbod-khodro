# Hirbod Khodro Installer

This directory contains the customer-facing installation tooling.

## Current implementation stage

`preflight.sh` performs read-only checks before installation:

- Ubuntu 22.04 or 24.04 and x86_64 architecture
- CPU, memory, and available disk capacity
- Domain DNS pointing to the target server's public IPv4
- Availability of application and Supabase ports
- Protection against overwriting an existing `/opt/hirbod` installation
- Existing Docker and firewall state

Run:

    sudo bash installer/preflight.sh --domain app.example.com

The preflight script does not install packages, change firewall rules,
modify DNS, create files outside this installer directory, or start services.

## Installer design requirements

- Pin the self-hosted Supabase source to `self-hosted/v0.8.3`.
- Generate unique secrets on the customer's server.
- Never copy production `.env` files or production database contents.
- Never print generated secrets or use `run.sh secrets`.
- Keep Supabase's API gateway bound to localhost.
- Apply application migrations in order and provision the first admin
  before migrations that require an existing admin.
- Disable public signup after the initial administrator is created.
- Keep restore authorization and admin-role checks intact.
- Run the application with least privilege; privileged restore operations
  must use a narrowly scoped helper.
- Configure HTTPS and validate the installation with health checks.
