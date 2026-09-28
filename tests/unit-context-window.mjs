import test from "node:test";
import assert from "node:assert/strict";

import { buildVariantModels, claudeCodeModelId, parseVariantId } from "../src/models.ts";

// Minimal stand-ins for pi-ai model entries (buildVariantModels reads id, name,
// contextWindow and spreads the rest through to each variant).
const MODELS = [
	{ id: "claude-fable-5-1", name: "Fable 5.1", contextWindow: 1_000_000 },
	{ id: "claude-fable-5", name: "Fable 5", contextWindow: 1_000_000 },
	{ id: "claude-opus-5-5", name: "Opus 5.5", contextWindow: 1_000_000 },
	{ id: "claude-opus-4-8", name: "Opus 4.8", contextWindow: 200_000 },
	{ id: "claude-opus-4-7", name: "Opus 4.7", contextWindow: 1_000_000 },
	{ id: "claude-opus-4-6", name: "Opus 4.6", contextWindow: 200_000 },
	{ id: "claude-sonnet-5-5", name: "Sonnet 5.5", contextWindow: 1_000_000 },
	{ id: "claude-sonnet-5", name: "Sonnet 5", contextWindow: 200_000 },
	{ id: "claude-sonnet-4-6", name: "Sonnet 4.6", contextWindow: 200_000 },
	{ id: "claude-haiku-4-5", name: "Haiku 4.5", contextWindow: 200_000 },
];

const settings = (contextWindow, extra = {}) => ({ plan: "pro", longContextExtraUsage: false, contextWindow, ...extra });
const variants = (contextWindow, extra) => buildVariantModels(MODELS, settings(contextWindow, extra));
const byId = (contextWindow, extra) => Object.fromEntries(variants(contextWindow, extra).map((m) => [m.id, m]));

test("auto (Pro): each model expands to its available windows with correct ids, windows, and labels", () => {
	const m = byId("auto");
	// Opus 4.8: default 1M unsuffixed + 200K alternate.
	assert.equal(m["claude-opus-4-8"].contextWindow, 1_000_000);
	assert.equal(m["claude-opus-4-8"].name, "Opus 4.8 (1M)");
	assert.equal(m["claude-opus-4-8-200k"].contextWindow, 200_000);
	assert.equal(m["claude-opus-4-8-200k"].name, "Opus 4.8 (200K)");
	// Opus 4.7: 1M only, no 200K variant.
	assert.equal(m["claude-opus-4-7"].contextWindow, 1_000_000);
	assert.ok(!m["claude-opus-4-7-200k"], "opus-4-7 has no 200K runtime");
	// Opus 4.6 (Pro): default 200K unsuffixed + 1M alternate.
	assert.equal(m["claude-opus-4-6"].contextWindow, 200_000);
	assert.equal(m["claude-opus-4-6-1m"].contextWindow, 1_000_000);
	// Fable 5: default 200K + 1M alternate.
	assert.equal(m["claude-fable-5"].contextWindow, 200_000);
	assert.equal(m["claude-fable-5-1m"].contextWindow, 1_000_000);
	// Sonnet 5: default 1M + 200K alternate.
	assert.equal(m["claude-sonnet-5"].contextWindow, 1_000_000);
	assert.equal(m["claude-sonnet-5-200k"].contextWindow, 200_000);
	// Sonnet 4.6: default 200K + 1M alternate.
	assert.equal(m["claude-sonnet-4-6"].contextWindow, 200_000);
	assert.equal(m["claude-sonnet-4-6-1m"].contextWindow, 1_000_000);
	// Haiku 4.5: 200K only, no 1M variant.
	assert.equal(m["claude-haiku-4-5"].contextWindow, 200_000);
	assert.ok(!m["claude-haiku-4-5-1m"], "haiku has no 1M runtime");
});

test("auto (Pro): 15 entries, and no base model emits two entries for the same window", () => {
	const list = variants("auto");
	assert.equal(list.length, 15);
	for (const base of MODELS.map((mm) => mm.id)) {
		// Suffix-aware grouping: an exact id like claude-fable-5-1 shares the
		// claude-fable-5- prefix but is its own model, not a -1m/-200k variant.
		const windows = list
			.filter((v) => v.id === base || (v.id.startsWith(`${base}-`) && ["1m", "200k"].includes(v.id.slice(base.length + 1))))
			.map((v) => v.contextWindow);
		assert.equal(new Set(windows).size, windows.length, `${base} has duplicate windows`);
	}
});

test("the default variant is listed before its suffixed alternate", () => {
	const ids = variants("auto").map((m) => m.id);
	assert.ok(ids.indexOf("claude-opus-4-8") < ids.indexOf("claude-opus-4-8-200k"));
	assert.ok(ids.indexOf("claude-sonnet-5") < ids.indexOf("claude-sonnet-5-200k"));
	assert.ok(ids.indexOf("claude-fable-5") < ids.indexOf("claude-fable-5-1m"));
});

test("auto (Max): Opus 4.6 default flips to 1M and 200K becomes the suffixed alternate", () => {
	const m = byId("auto", { plan: "max" });
	assert.equal(m["claude-opus-4-6"].contextWindow, 1_000_000);
	assert.equal(m["claude-opus-4-6-200k"].contextWindow, 200_000);
	assert.ok(!m["claude-opus-4-6-1m"], "1M is the default (unsuffixed) under Max");
});

test("200k config: unsuffixed prefers 200K, 1M stays available as -1m, Opus 4.7 falls back to 1M", () => {
	const m = byId("200k");
	assert.equal(m["claude-opus-4-8"].contextWindow, 200_000);
	assert.equal(m["claude-opus-4-8-1m"].contextWindow, 1_000_000);
	assert.ok(!m["claude-opus-4-8-200k"], "200K is the default here, so no suffixed duplicate");
	// Opus 4.7 has no 200K runtime, so its only window (1M) becomes the unsuffixed default.
	assert.equal(m["claude-opus-4-7"].contextWindow, 1_000_000);
	assert.ok(!m["claude-opus-4-7-1m"]);
	assert.equal(m["claude-haiku-4-5"].contextWindow, 200_000);
});

test("1m config: unsuffixed prefers 1M, 200K stays available as -200k, Haiku falls back to 200K", () => {
	const m = byId("1m");
	assert.equal(m["claude-opus-4-8"].contextWindow, 1_000_000);
	assert.equal(m["claude-opus-4-8-200k"].contextWindow, 200_000);
	assert.ok(!m["claude-opus-4-8-1m"], "1M is the default here, so no suffixed duplicate");
	// Haiku has no 1M runtime, so 200K stays the unsuffixed default.
	assert.equal(m["claude-haiku-4-5"].contextWindow, 200_000);
	assert.ok(!m["claude-haiku-4-5-200k"]);
	assert.equal(m["claude-opus-4-7"].contextWindow, 1_000_000);
});

test("parseVariantId splits window suffixes and leaves base ids intact", () => {
	assert.deepEqual(parseVariantId("claude-opus-4-8"), { baseId: "claude-opus-4-8" });
	assert.deepEqual(parseVariantId("claude-opus-4-8-200k"), { baseId: "claude-opus-4-8", forced: "200k" });
	assert.deepEqual(parseVariantId("claude-fable-5-1m"), { baseId: "claude-fable-5", forced: "1m" });
});

test("claudeCodeModelId: unsuffixed id follows the config default", () => {
	assert.equal(claudeCodeModelId({ id: "claude-fable-5" }, settings("auto")), "claude-fable-5");
	assert.equal(claudeCodeModelId({ id: "claude-fable-5" }, settings("1m")), "claude-fable-5[1m]");
	assert.equal(claudeCodeModelId({ id: "claude-opus-4-8" }, settings("auto")), "claude-opus-4-8[1m]");
	assert.equal(claudeCodeModelId({ id: "claude-opus-4-8" }, settings("200k")), "claude-opus-4-8");
});

test("claudeCodeModelId: a suffixed id forces its window regardless of config", () => {
	assert.equal(claudeCodeModelId({ id: "claude-opus-4-8-200k" }, settings("auto")), "claude-opus-4-8");
	assert.equal(claudeCodeModelId({ id: "claude-opus-4-8-200k" }, settings("1m")), "claude-opus-4-8");
	assert.equal(claudeCodeModelId({ id: "claude-fable-5-1m" }, settings("200k")), "claude-fable-5[1m]");
	assert.equal(claudeCodeModelId({ id: "claude-opus-4-6-1m" }, settings("auto")), "claude-opus-4-6[1m]");
});

test("claudeCodeModelId throws when a model has no runtime for the requested window", () => {
	assert.throws(() => claudeCodeModelId({ id: "claude-haiku-4-5-1m" }, settings("auto")));
	assert.throws(() => claudeCodeModelId({ id: "claude-opus-4-7-200k" }, settings("auto")));
});

test("a model with only one window remains usable under the opposite global preference", () => {
	assert.equal(claudeCodeModelId({ id: "claude-haiku-4-5" }, settings("1m")), "claude-haiku-4-5");
	assert.equal(claudeCodeModelId({ id: "claude-opus-4-7" }, settings("200k")), "claude-opus-4-7");
});

// The three 2.1.284-era models are natively 1M on direct Anthropic access:
// exactly one unsuffixed 1M entry per id under every config mode, and no
// 200K runtime at all.
const NEW_MODEL_IDS = ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5"];
const NEW_MODEL_BASE_NAMES = { "claude-fable-5-1": "Fable 5.1", "claude-opus-5-5": "Opus 5.5", "claude-sonnet-5-5": "Sonnet 5.5" };

test("new 1M-native models: exactly one unsuffixed 1M entry per id under every config mode", () => {
	for (const id of NEW_MODEL_IDS) {
		for (const mode of ["auto", "1m", "200k"]) {
			const entries = variants(mode).filter((v) => v.id === id || v.id.startsWith(`${id}-`));
			assert.equal(entries.length, 1, `${id} under ${mode}: exactly one registered entry`);
			assert.equal(entries[0].id, id, `${id} under ${mode}: bare id, no -1m/-200k suffix`);
			assert.equal(entries[0].contextWindow, 1_000_000, `${id} under ${mode}: native 1M window`);
			assert.equal(entries[0].name, `${NEW_MODEL_BASE_NAMES[id]} (1M)`, `${id} under ${mode}: 1M label`);
		}
	}
});

test("new 1M-native models: every registered bare id resolves to its 1M CLI runtime", () => {
	for (const id of NEW_MODEL_IDS) {
		for (const mode of ["auto", "1m", "200k"]) {
			const registered = variants(mode).find((v) => v.id === id);
			assert.equal(registered.contextWindow, 1_000_000);
			assert.equal(claudeCodeModelId(registered, settings(mode)), id, `${id}: ${mode} serves the bare CLI id`);
		}
	}
});

test("new 1M-native models: an explicit -200k id rejects because no 200K runtime exists", () => {
	for (const id of NEW_MODEL_IDS) {
		assert.throws(
			() => claudeCodeModelId({ id: `${id}-200k` }, settings("200k")),
			/model .* has no Claude Code runtime \(contextWindow=200k\)/,
		);
	}
});
