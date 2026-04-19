BUN ?= bun
KEY ?= energy
DIRECTION ?= both
DEPTH ?= 3

.PHONY: help persona-sync persona-dashboard persona-causal-sync persona-causal-summary persona-causal-snapshot persona-causal-node persona-causal-trace persona-causal-memory persona-test

help:
	@printf '%s\n' \
		'make persona-sync             # Markdown -> SQLite/Kuzu を同期' \
		'make persona-dashboard        # ダッシュボードを起動' \
		'make persona-causal-sync      # causal-seeds.json -> Kuzu を同期' \
		'make persona-causal-summary   # Kuzu の件数サマリを表示' \
		'make persona-causal-snapshot  # Kuzu の全 nodes/edges を JSON 表示' \
		'make persona-causal-node KEY=energy' \
		'make persona-causal-trace KEY=energy DIRECTION=both DEPTH=3' \
		'make persona-causal-memory    # 因果と交差する記憶ヒントを生成' \
		'make persona-test             # persona 関連テストを実行'

persona-sync:
	$(BUN) .claude/scripts/persona-data.ts

persona-dashboard:
	$(BUN) .claude/scripts/persona-dashboard.ts

persona-causal-sync:
	$(BUN) .claude/scripts/causal-kuzu.ts

persona-causal-summary:
	$(BUN) .claude/scripts/causal-kuzu-inspect.ts summary

persona-causal-snapshot:
	$(BUN) .claude/scripts/causal-kuzu-inspect.ts snapshot

persona-causal-node:
	$(BUN) .claude/scripts/causal-kuzu-inspect.ts node $(KEY)

persona-causal-trace:
	$(BUN) .claude/scripts/causal-kuzu-inspect.ts trace $(KEY) --direction=$(DIRECTION) --depth=$(DEPTH)

persona-causal-memory:
	$(BUN) .claude/scripts/causal-memory-bridge.ts

persona-test:
	$(BUN) test ./.claude/scripts/causal-kuzu.test.ts ./.claude/scripts/causal-runtime.test.ts ./.claude/scripts/causal-hint-store.test.ts ./.claude/scripts/causal-hint.test.ts ./.claude/scripts/causal-memory-bridge.test.ts ./.claude/scripts/recall-lite.test.ts ./.claude/scripts/causal-graph.test.ts ./.claude/scripts/persona-data.test.ts ./.claude/scripts/environment-store.test.ts ./.claude/scripts/environment-tick.test.ts ./.claude/scripts/jma-weather.test.ts
