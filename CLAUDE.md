@AGENTS.md

# Claude Code adapter

Все нормативные правила находятся в `AGENTS.md`; этот файл их только подключает.

- Permissions и lifecycle hooks: [`.claude/settings.json`](./.claude/settings.json).
- Project MCP: [`.mcp.json`](./.mcp.json); откройте `/mcp` и подтвердите доверие конфигурации.
- Project skills: [`.claude/skills/`](./.claude/skills/).
- После доверия репозиторию проверьте активные hooks командой `/hooks`.
