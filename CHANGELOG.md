# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] - 2026-09-28

### Added
- Claude Fable 5.1 (`claude-fable-5-1`), Claude Opus 5.5 (`claude-opus-5-5`), and
  Claude Sonnet 5.5 (`claude-sonnet-5-5`) in the model picker. All three are
  natively 1M-context: they register a single 1M entry (with a 1M fallback when
  `provider.contextWindow: "200k"`), and an explicit `<model>-200k` id is
  rejected as unsupported. AskClaude shortcuts now resolve to the newest model
  per family: `opus` → Opus 5.5, `sonnet` → Sonnet 5.5, `fable` → Fable 5.1
  (`haiku` stays on 4.5). Exact ids always win over substring shortcuts.

### Changed
- Requires Oh My Pi `>=18.4.2 <19`: the five `@oh-my-pi/*` packages are pinned
  to `18.4.2` (was `16.3.11`), the Claude Agent SDK to `0.3.284`, and the
  Anthropic SDK to `0.93.0` (`@modelcontextprotocol/sdk` and `zod` are now
  direct dependencies). Extension loading is restored against the removed
  `keybinding-hints` module via `keyHint` and direct use of the legacy
  pi-ai shim; AskClaude is registered with `loadMode: "essential"`.
- Reasoning metadata now projects the catalog's `thinking` contract
  (`efforts`/`effortMap`) instead of the retired `thinkingLevelMap`; Sonnet 5 /
  4.6 keep translating `xhigh` → `max`, while the 5.5-generation models accept
  `xhigh` natively. Usage accounting uses the canonical `reasoningTokens` field.

## [0.8.1] - 2026-07-07

### Fixed
- Spurious "Claude rate limit warning" toasts at trivial utilization. The Claude
  Agent SDK emits `allowed_warning` rate-limit events even at ~1% of the
  `seven_day` (weekly) limit; these are now surfaced only at ≥80% utilization.
  Hard-limit (`rejected`) notifications and the debug log are unchanged.

## [0.8.0] - 2026-07-07

### Added
- On-demand context-window variants in the `/model` picker: each model is now
  registered once per window it supports (1M and/or 200K) as a distinct,
  clearly-labeled entry (e.g. `Opus 4.8 (1M)` and `Opus 4.8 (200K)`). Switching
  a model's context window is a picker selection instead of a config edit plus
  reload.
- Suffixed model ids (`<model>-1m` / `<model>-200k`) that force a specific
  window regardless of the global default — usable from `modelRoles` and
  AskClaude short names. The unsuffixed id remains the config default, so
  existing `config.yml` roles keep working.

### Changed
- `provider.contextWindow` now sets the **default** window (which window the
  unsuffixed model id maps to) instead of hiding models that don't match it.
  Both windows stay pickable wherever a runtime exists.
- Each variant reports its true `contextWindow`, keeping the status bar and
  auto-compaction accurate for the selected window.

## [0.7.0] - 2026-07-06

First public release of the Oh My Pi port.

### Added
- `provider.contextWindow` setting with three modes:
  - `"auto"` (default) — per-model context policy based on measured SDK behavior.
  - `"1m"` — force the 1M context window; only 1M-capable models are registered.
  - `"200k"` — force the 200K context window; only 200K-capable models are registered.
- Models without a runtime for the selected forced window are hidden from the
  model picker instead of being misreported.
- `thinkingLevelMap` fallback so Sonnet 5 / Sonnet 4.6 expose `xhigh` (mapped to `max`).

### Changed
- Ported from Pi (`@earendil-works/*`) to Oh My Pi (`@oh-my-pi/*`): extension
  manifest (`omp.extensions`), provider registration, message conversion, and
  config directory resolution (`~/.omp/agent/claude-bridge.json`).
- Corrected the `claude-fable-5` context policy: the bare `claude-fable-5`
  runtime serves 200K (verified), while `claude-fable-5[1m]` serves 1M. In
  `"auto"` mode Fable 5 now registers at 200K.

### Credits
- Original `pi-claude-bridge` by [Eli Dickinson](https://github.com/elidickinson).
- Oh My Pi port and context-window controls by [Jonathan Borgwing](https://github.com/DevVig).
