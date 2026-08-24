import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

test("package exposes bunjang-assistant metadata and local binaries", async () => {
    const pkg = await readJson("package.json");

    assert.equal(pkg.name, "bunjang-assistant");
    assert.equal(pkg.version, "0.4.0");
    assert.equal(pkg.private, true);
    assert.deepEqual(pkg.bin, {
        "bunjang-assistant": "./install/bunjang-assistant-install.mjs",
        "bunjang-assistant-install": "./install/bunjang-assistant-install.mjs",
        "bunjang-assistant-run": "./src/index.js"
    });
    assert.equal(pkg.dependencies["bunjang-cli"], "0.2.1");
    assert.ok(pkg.files.includes("install/**"));
    assert.ok(pkg.files.includes("skills/bunjang/**"));
    assert.ok(pkg.files.includes("commands/**"));
    assert.ok(!pkg.files.includes("README.ko.md"));
    assert.ok(!pkg.files.includes("assets/**"));
    assert.ok(!pkg.files.includes("examples/**"));
    assert.ok(!pkg.files.includes("products/**"));
    assert.ok(!pkg.files.includes("skills/bunjang/references/ai-context.md"));
    assert.ok(!pkg.files.includes("skills/bunjang/references/template.md"));
});

test("root plugin metadata is scoped to Codex, Claude, and macOS", async () => {
    const plugin = await readJson("plugin.json");

    assert.equal(plugin.name, "bunjang-assistant");
    assert.equal(plugin.version, "0.4.0");
    assert.deepEqual(plugin.support.codex, ["codex"]);
    assert.deepEqual(plugin.support.claude, ["claude"]);
    assert.deepEqual(plugin.support.os, ["macos-intel", "macos-apple-silicon"]);
    assert.equal(plugin.commands, undefined);
    assert.equal(plugin.assets, undefined);
    assert.equal(plugin.examples, undefined);
    assert.deepEqual(Object.keys(plugin.entrypoints).sort(), [
        "claude",
        "claudeManifest",
        "claudeMarketplace",
        "codex",
        "codexMarketplace"
    ]);
});

test("public bunjang skill routes price and sales draft requests", async () => {
    const skill = await readText("skills/bunjang/SKILL.md");
    const marketplace = await readText("skills/bunjang/references/marketplace.md");
    const fixtureGuide = await readText("skills/bunjang/references/search-result-fixture.md");
    const fixture = await readJson("skills/bunjang/references/fixtures/search-result.json");
    const price = await readText("skills/bunjang/references/price.md");
    const sales = await readText("skills/bunjang/references/sales.md");
    const browser = await readText("skills/bunjang/references/browser.md");
    const aiContext = await readText("skills/bunjang/references/ai-context.md");
    const template = await readText("skills/bunjang/references/template.md");

    assert.match(skill, /price\.md/);
    assert.match(skill, /sales\.md/);
    assert.match(skill, /자연어 요청/);
    assert.match(skill, /`\/bunjang-assistant:bunjang \[작업\]`/);
    assert.match(marketplace, /search-result-fixture\.md/);
    assert.match(fixtureGuide, /fixtures\/search-result\.json/);
    assert.equal(fixture.items[0].listingId, "fixture-1");
    assert.match(price, /번개장터에서 A 상품 시세 알려줘/);
    assert.match(price, /시세 범위/);
    assert.match(sales, /번개장터 판매글 작성해줘/);
    assert.match(sales, /A 디렉토리의 상품들/);
    assert.match(sales, /저장소의 기본 상품 폴더를 가정하지 말고/);
    assert.match(sales, /등록하기/);
    assert.match(skill, /bypass 모드/);
    assert.match(sales, /bypass 모드/);
    assert.match(browser, /자동으로 다시 클릭하지/);
    assert.match(aiContext, /사용자가 지정한 상품 루트/);
    assert.match(aiContext, /스킬 내부 리소스/);
    assert.match(aiContext, /가격 근거 부족\(확인 필요\)/);
    assert.doesNotMatch(aiContext, /가격 근거 부족으로 보고하고 현재 상품 처리를 중단/);
    assert.match(template, /번개장터 판매글 템플릿/);
    assert.doesNotMatch(template, /\[USED\]/);
    assert.doesNotMatch(skill + sales + aiContext, /products\/ai-context|products\/template/);
});

test("installer metadata excludes unsupported surfaces", async () => {
    const installer = await readText("install/bunjang-assistant-install.mjs");
    const readme = await readText("README.md");
    const aiInstall = await readText("docs/ai-agent-installation.md");
    const installReadme = await readText("install/README.md");
    const cliUsage = await readText("skills/bunjang/docs/cli-usage.md");
    const claudePlugin = await readJson(".claude-plugin/plugin.json");
    const claudeManifest = await readJson(".claude-plugin/manifest.json");
    const claudeMarketplace = await readJson(".claude-plugin/marketplace.json");

    assert.match(installer, /--tool cli\|codex\|claude\|both/);
    assert.match(installer, /Cursor, Claude Desktop MCP, Windows, and Linux installers are intentionally out of scope/);
    assert.match(installReadme, /install-skills\.sh/);
    assert.doesNotMatch(installReadme, /install-cli\.sh|install-plugins\.sh|bootstrap-bunjang\.sh/);
    assert.equal(claudePlugin.commands, "./commands/");
    assert.equal(claudePlugin.version, "0.4.0");
    assert.equal(claudeManifest.commands, "./commands/");
    assert.equal(claudeManifest.version, "0.4.0");
    assert.deepEqual(claudeMarketplace.owner, {name: "kimchanhyung98"});
    assert.equal(claudeMarketplace.plugins[0].source, "./");
    assert.equal(claudeMarketplace.plugins[0].version, "0.4.0");
    assert.match(readme, /codex plugin marketplace add --ref main https:\/\/github\.com\/kimchanhyung98\/bunjang-assistant\.git/);
    assert.match(readme, /codex plugin add bunjang-assistant@bunjang-assistant/);
    assert.match(aiInstall, /codex plugin marketplace add --ref main https:\/\/github\.com\/kimchanhyung98\/bunjang-assistant\.git/);
    assert.match(aiInstall, /codex plugin add bunjang-assistant@bunjang-assistant/);
    assert.match(installReadme, /codex plugin marketplace add --ref main https:\/\/github\.com\/kimchanhyung98\/bunjang-assistant\.git/);
    assert.match(installReadme, /codex plugin add bunjang-assistant@bunjang-assistant/);
    assert.match(cliUsage, /codex plugin marketplace add --ref main/);
    assert.match(cliUsage, /codex plugin add bunjang-assistant@bunjang-assistant/);
    assert.match(cliUsage, /`--tool cli` 또는 `--install-cli`가 CLI 의존성을 설치합니다/);
    assert.match(cliUsage, /`\/bunjang-assistant:bunjang \[작업\]`/);
});

test("runtime docs use the package-selected runner command", async () => {
    const oldRunnerPattern = /npx -y github:kimchanhyung98\/bunjang-assistant bunjang-assistant-run/;
    const packageRunnerPattern = /npx -y --package=github:kimchanhyung98\/bunjang-assistant -- bunjang-assistant-run/;
    const docs = [
        "commands/bunjang.md",
        "docs/cli-toolkit-integration.md",
        "skills/bunjang/SKILL.md",
        "skills/bunjang/docs/capability-registry.md",
        "skills/bunjang/docs/cli-usage.md",
        "skills/bunjang/docs/execution-contract.md",
        "skills/bunjang/references/browser.md",
        "skills/bunjang/references/marketplace.md",
        "skills/bunjang/references/price.md"
    ];

    for (const path of docs) {
        const text = await readText(path);
        assert.doesNotMatch(text, oldRunnerPattern, path);
        assert.match(text, packageRunnerPattern, path);
    }
});

async function readJson(path) {
    return JSON.parse(await readText(path));
}

async function readText(path) {
    return readFile(resolve(process.cwd(), path), "utf8");
}
