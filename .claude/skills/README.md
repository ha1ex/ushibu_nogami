# Claude Code skill adapter

Claude Code auto-loads skills from this directory. Общие project skills являются относительными
symlink на канонические каталоги в [`skills/`](../../skills/); provider-specific расширения остаются
физическими каталогами только здесь.

| Skill | Source | License |
|---|---|---|
| `kb-ingest/` | [`skills/kb-ingest`](../../skills/kb-ingest/SKILL.md) | project |
| `decision-log/` | [`skills/decision-log`](../../skills/decision-log/SKILL.md) | project |
| `interviewer-agent/` | [`skills/interviewer-agent`](../../skills/interviewer-agent/SKILL.md), derived from cybos B-021/B-198/C-143/A-025 | derived |
| `mcp-builder/` | [anthropics/skills/mcp-builder](https://github.com/anthropics/skills/tree/main/skills/mcp-builder) | Apache-2.0 |
| `skill-creator/` | [anthropics/skills/skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) | Apache-2.0 |
| `claude-api/` | [anthropics/skills/claude-api](https://github.com/anthropics/skills/tree/main/skills/claude-api) | Apache-2.0 |

Полные тела + вспомогательные файлы оригинальных скилов — в `06_outputs/anthropics-skills/01-engineering-productivity/` (только SKILL.md) и в `.context/anthropics-skills-src/skills/<name>/` (полная upstream-структура с references/, scripts/ — gitignored).

Чтобы обновить Claude-specific копию из upstream:
```bash
cd .context/anthropics-skills-src && git pull --depth=1 origin main && cd ../..
cp .context/anthropics-skills-src/skills/<name>/SKILL.md .claude/skills/<name>/
```

Общие project skills меняются только в `skills/<name>/SKILL.md`; не заменяйте их symlink копиями.
