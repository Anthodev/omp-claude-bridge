import test from "node:test";
import assert from "node:assert/strict";

import { buildModels, buildVariantModels, resolveClaudeEffort, resolveModel } from "../src/models.ts";

// Reasoning-contract tests: buildModels must project the catalog `thinking`
// metadata (mode/efforts/effortMap) instead of fabricating reasoning config,
// Sonnet models keep the bridge's xhigh->max Claude Code translation, and
// resolveClaudeEffort turns an OMP thinking level into a Claude Agent SDK
// effort. These tests import src/models.ts directly, so they never load the
// extension runtime.

// Minimal stand-ins for pi-catalog model entries, deeply frozen so a mutation
// in buildModels throws (strict mode) instead of silently corrupting the
// catalog. Shape matches what buildModels reads: id, name, reasoning, input,
// contextWindow, maxTokens and (new contract) thinking.
const deepFreeze = (value) => {
	if (value != null && typeof value === "object") {
		for (const v of Object.values(value)) deepFreeze(v);
		Object.freeze(value);
	}
	return value;
};

const OPUS_THINKING = {
	mode: "effort",
	efforts: ["low", "medium", "high", "xhigh", "max"],
	effortMap: { xhigh: "xhigh" },
};

const SONNET_THINKING = {
	mode: "effort",
	efforts: ["low", "medium", "high", "xhigh"],
	defaultLevel: "high",
	effortMap: { low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
};

const entry = (id, name, extra = {}) => ({
	id,
	name,
	reasoning: true,
	input: ["text", "image"],
	contextWindow: 200_000,
	maxTokens: 64_000,
	...extra,
});

const CATALOG = deepFreeze([
	entry("claude-opus-4-7", "Opus 4.7", { contextWindow: 1_000_000, thinking: OPUS_THINKING }),
	entry("claude-sonnet-5", "Sonnet 5", { thinking: SONNET_THINKING }),
	entry("claude-sonnet-4-6", "Sonnet 4.6", {
		thinking: {
			mode: "effort",
			efforts: ["low", "medium", "high", "xhigh"],
			effortMap: { low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
		},
	}),
	entry("claude-haiku-4-5", "Haiku 4.5", { reasoning: false }),
]);

const buildCatalog = () => buildModels(CATALOG);
const settings = { plan: "pro", longContextExtraUsage: false, contextWindow: "auto" };

test("buildModels forwards the Opus catalog thinking verbatim, so xhigh resolves to the SDK effort xhigh", () => {
	const [opus] = buildCatalog().filter((m) => m.id === "claude-opus-4-7");
	assert.ok(opus, "opus-4-7 must be selected from the catalog");
	// Ordinary models pass thinking through unchanged: same fields, same values.
	assert.deepEqual(opus.thinking, OPUS_THINKING);
	assert.equal(resolveClaudeEffort("xhigh", opus.thinking.effortMap), "xhigh");
});

test("buildVariantModels preserves the Opus effortMap, so a context variant still resolves xhigh to xhigh", () => {
	const variants = buildVariantModels(buildCatalog(), settings);
	const variant = variants.find((m) => m.id === "claude-opus-4-7");
	assert.ok(variant, "opus-4-7 must keep at least one context-window entry");
	assert.deepEqual(variant.thinking, OPUS_THINKING);
	assert.equal(resolveClaudeEffort("xhigh", variant.thinking.effortMap), "xhigh");
});

for (const sonnetId of ["claude-sonnet-5", "claude-sonnet-4-6"]) {
	test(`buildModels translates only xhigh to max for ${sonnetId}, conserving the rest of the catalog thinking`, () => {
		const fixture = CATALOG.find((m) => m.id === sonnetId);
		const snapshot = structuredClone(fixture.thinking);

		const [model] = buildCatalog().filter((m) => m.id === sonnetId);
		assert.ok(model, `${sonnetId} must be selected from the catalog`);

		// Copy, not in-place override: the projected thinking and its effortMap
		// must be fresh objects, and the frozen catalog entry must be untouched.
		assert.notEqual(model.thinking, fixture.thinking);
		assert.notEqual(model.thinking.effortMap, fixture.thinking.effortMap);
		assert.deepEqual(fixture.thinking, snapshot);

		assert.deepEqual(model.thinking, {
			...fixture.thinking,
			effortMap: { ...fixture.thinking.effortMap, xhigh: "max" },
		});
		// The bridge's Claude Code translation must be visible to the SDK lookup.
		assert.equal(resolveClaudeEffort("xhigh", model.thinking.effortMap), "max");
		assert.equal(resolveClaudeEffort("high", model.thinking.effortMap), "high");
	});
}

test("a catalog model without thinking stays without any fabricated reasoning configuration", () => {
	const [haiku] = buildCatalog().filter((m) => m.id === "claude-haiku-4-5");
	assert.ok(haiku, "haiku-4-5 must be selected from the catalog");
	assert.equal(haiku.thinking, undefined);
	assert.ok(!("thinking" in haiku), "no thinking object may be fabricated");
	assert.ok(!("thinkingLevelMap" in haiku), "the removed thinkingLevelMap field must not resurface");
	assert.equal(resolveClaudeEffort(undefined, haiku.thinking?.effortMap), undefined);
});

test("resolveClaudeEffort maps every supported OMP level onto the Claude SDK effort table", () => {
	const levels = ["minimal", "low", "medium", "high", "xhigh", "max"];
	const expected = ["low", "low", "medium", "high", "max", "max"];
	for (const [level, effort] of levels.map((l, i) => [l, expected[i]])) {
		assert.equal(resolveClaudeEffort(level), effort, `${level} must resolve to ${effort} without a map`);
	}
});

test("resolveClaudeEffort returns no effort for off and missing reasoning", () => {
	assert.equal(resolveClaudeEffort(undefined), undefined);
	assert.equal(resolveClaudeEffort("off"), undefined);
});

test("resolveClaudeEffort lets a valid effortMap entry win over the default table", () => {
	// Opus-style map: xhigh stays xhigh even though the table would say max.
	assert.equal(resolveClaudeEffort("xhigh", { xhigh: "xhigh" }), "xhigh");
	assert.equal(resolveClaudeEffort("high", { high: "low" }), "low");
	assert.equal(resolveClaudeEffort("xhigh", { xhigh: "max" }), "max");
});

test("resolveClaudeEffort falls back to the default table when the map value is foreign to the SDK", () => {
	assert.equal(resolveClaudeEffort("xhigh", { xhigh: "ultrathink" }), "max");
});

test("resolveClaudeEffort returns no effort for an unknown reasoning level", () => {
	assert.equal(resolveClaudeEffort("turbo"), undefined);
	assert.equal(resolveClaudeEffort("turbo", { xhigh: "xhigh" }), undefined);
});

// --- Step 4: updated Claude model list --------------------------------------
// The bridge pins its supported models to MODEL_IDS_IN_ORDER. Three recent
// models (Claude Fable 5.1, Opus 5.5, Sonnet 5.5) are declared explicitly by
// the bridge because the published catalog may not carry them yet, and each
// keeps its native xhigh effort (no legacy Sonnet xhigh->max override).

const NEW_MODEL_IDS = ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5"];

const NEW_MODEL_NAMES = {
	"claude-fable-5-1": "Claude Fable 5.1",
	"claude-opus-5-5": "Claude Opus 5.5",
	"claude-sonnet-5-5": "Claude Sonnet 5.5",
};

// Deliberately hostile stand-ins: wrong window/token budget, missing xhigh
// effort, an xhigh->max map, reasoning:false. If a catalog entry leaked
// through instead of the explicit bridge declaration, the assertions below
// fail loudly.
const CATALOG_WITH_NEW_IDS = deepFreeze([
	...CATALOG,
	entry("claude-fable-5-1", "Fable 5.1 (catalog decoy)", {
		contextWindow: 500_000,
		maxTokens: 8_000,
		thinking: { mode: "effort", efforts: ["low", "high"], effortMap: { xhigh: "max" } },
	}),
	entry("claude-opus-5-5", "Opus 5.5 (catalog decoy)", { contextWindow: 500_000, maxTokens: 8_000, reasoning: false }),
	entry("claude-sonnet-5-5", "Sonnet 5.5 (catalog decoy)", { contextWindow: 500_000, maxTokens: 8_000 }),
]);

const assertExplicitBridgeModel = (model, id) => {
	assert.ok(model, `${id} must be registered`);
	assert.equal(model.name, NEW_MODEL_NAMES[id]);
	assert.equal(model.reasoning, true);
	assert.deepEqual(model.input, ["text", "image"]);
	assert.equal(model.contextWindow, 1_000_000);
	assert.equal(model.maxTokens, 128_000);
	assert.deepEqual(model.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
	assert.deepEqual(model.thinking, {
		mode: "effort",
		efforts: ["low", "medium", "high", "xhigh", "max"],
		effortMap: { xhigh: "xhigh" },
	});
	// xhigh resolves to the SDK effort xhigh: the legacy Sonnet xhigh->max
	// Claude Code translation must NOT apply to these models.
	assert.equal(resolveClaudeEffort("xhigh", model.thinking.effortMap), "xhigh");
};

test("buildModels registers the three new models with explicit bridge capabilities even when the catalog lacks them", () => {
	assert.ok(NEW_MODEL_IDS.every((id) => !CATALOG.some((m) => m.id === id)), "fixture precondition: CATALOG must lack the new ids");

	const byIdMap = Object.fromEntries(buildModels(CATALOG).map((m) => [m.id, m]));
	for (const id of NEW_MODEL_IDS) assertExplicitBridgeModel(byIdMap[id], id);

	// Picker order decides substring shortcuts, so each new generation must
	// precede its predecessor (both present in this catalog).
	const ids = buildModels(CATALOG).map((m) => m.id);
	assert.ok(ids.indexOf("claude-opus-5-5") < ids.indexOf("claude-opus-4-7"));
	assert.ok(ids.indexOf("claude-sonnet-5-5") < ids.indexOf("claude-sonnet-5"));
	// Contrast: the legacy Sonnet override still applies in the same build.
	assert.equal(byIdMap["claude-sonnet-5"].thinking.effortMap.xhigh, "max");
});

test("a catalog that already carries the new ids yields exactly one entry per id, with the explicit bridge declaration winning", () => {
	const registered = buildModels(CATALOG_WITH_NEW_IDS);
	for (const id of NEW_MODEL_IDS) {
		const matches = registered.filter((m) => m.id === id);
		assert.equal(matches.length, 1, `${id} must be registered exactly once, no duplicate`);
		assertExplicitBridgeModel(matches[0], id);
	}
});

const FULL_CATALOG = deepFreeze([
	...CATALOG,
	entry("claude-fable-5-1", "Claude Fable 5.1", { contextWindow: 1_000_000, maxTokens: 128_000 }),
	entry("claude-fable-5", "Claude Fable 5", { contextWindow: 1_000_000 }),
	entry("claude-opus-5-5", "Claude Opus 5.5", { contextWindow: 1_000_000, maxTokens: 128_000 }),
	entry("claude-sonnet-5-5", "Claude Sonnet 5.5", { contextWindow: 1_000_000, maxTokens: 128_000 }),
]);

test("resolveModel prefers an exact id match even when a newer successor id precedes it", () => {
	const models = buildModels(FULL_CATALOG);
	assert.equal(resolveModel(models, "claude-sonnet-5")?.id, "claude-sonnet-5", "sonnet-5-5 precedes sonnet-5 and contains it as a substring; the exact id must win");
	assert.equal(resolveModel(models, "claude-fable-5")?.id, "claude-fable-5", "fable-5-1 precedes fable-5 and contains it as a substring; the exact id must win");
	assert.equal(resolveModel(models, "CLAUDE-SONNET-5")?.id, "claude-sonnet-5", "exact matching is case-insensitive");
});

test("resolveModel shortcuts land on the newest generation, haiku stays on 4.5", () => {
	const models = buildModels(FULL_CATALOG);
	assert.equal(resolveModel(models, "fable")?.id, "claude-fable-5-1");
	assert.equal(resolveModel(models, "opus")?.id, "claude-opus-5-5");
	assert.equal(resolveModel(models, "sonnet")?.id, "claude-sonnet-5-5");
	assert.equal(resolveModel(models, "haiku")?.id, "claude-haiku-4-5");
});

test("resolveModel returns undefined for an unknown model", () => {
	assert.equal(resolveModel(buildModels(FULL_CATALOG), "totally-unknown"), undefined);
	assert.equal(resolveModel([], "sonnet"), undefined);
});
