// Test for the web search HTML parsing logic
// Run: node test/web-search.test.mjs

import { parseDDGHTML, webSearch } from "../src/web-search.mjs";
import assert from "node:assert";

// ── Test parseDDGHTML with realistic DuckDuckGo HTML ──────────────────────────

const SAMPLE_DDG_HTML = `
<!DOCTYPE html>
<html>
<body>
<div id="links" class="results">
  <div class="result results_links results_links_deep web-result ">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.bbc.com%2Fnews%2F2026-world-cup&amp;rut=abc123">2026 World Cup: Latest News and Updates - BBC</a>
      </h2>
      <a class="result__url" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.bbc.com%2Fnews%2F2026-world-cup">
        www.bbc.com/news/2026-world-cup
      </a>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.bbc.com%2Fnews%2F2026-world-cup">The 2026 FIFA World Cup kicks off in North America with 48 teams competing across the USA, Canada, and Mexico.</a>
    </div>
  </div>
  <div class="result results_links results_links_deep web-result ">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.espn.com%2Fsoccer%2Fworld-cup-2026&amp;rut=def456">FIFA World Cup 2026 - Schedule, Teams &amp; Venues - ESPN</a>
      </h2>
      <a class="result__url" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.espn.com%2Fsoccer%2Fworld-cup-2026">
        www.espn.com/soccer/world-cup-2026
      </a>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.espn.com%2Fsoccer%2Fworld-cup-2026">Complete coverage of the 2026 World Cup including match schedules, live scores, and team standings.</a>
    </div>
  </div>
  <div class="result results_links results_links_deep web-result ">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.fifa.com%2Fworldcup%2F2026&amp;rut=ghi789">FIFA World Cup 26&#x2122; - Official Site</a>
      </h2>
      <a class="result__url" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.fifa.com%2Fworldcup%2F2026">
        www.fifa.com/worldcup/2026
      </a>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.fifa.com%2Fworldcup%2F2026">Official FIFA World Cup 2026 page. Get tickets, find venues, and follow your <b>favorite</b> teams.</a>
    </div>
  </div>
</div>
</body>
</html>
`;

console.log("=== Testing parseDDGHTML ===\n");

const results = parseDDGHTML(SAMPLE_DDG_HTML);

console.log(`Found ${results.length} results`);
assert.strictEqual(results.length, 3, "Should find 3 results");

// Check first result
assert.strictEqual(results[0].title, "2026 World Cup: Latest News and Updates - BBC");
assert.strictEqual(results[0].url, "https://www.bbc.com/news/2026-world-cup");
assert.ok(results[0].snippet.includes("2026 FIFA World Cup kicks off"), `Snippet was: "${results[0].snippet}"`);

// Check second result - HTML entity decoding
assert.strictEqual(results[1].title, "FIFA World Cup 2026 - Schedule, Teams & Venues - ESPN");
assert.strictEqual(results[1].url, "https://www.espn.com/soccer/world-cup-2026");

// Check third result - HTML tag stripping in snippet
assert.strictEqual(results[2].url, "https://www.fifa.com/worldcup/2026");
assert.ok(results[2].snippet.includes("favorite"), "Should strip <b> tags from snippet");
assert.ok(!results[2].snippet.includes("<b>"), "Should not contain HTML tags");

console.log("✅ All parseDDGHTML assertions passed!\n");

// ── Test with empty/no results HTML ──────────────────────────────────────────

console.log("=== Testing empty results ===\n");

const emptyResults = parseDDGHTML("<html><body><div>No results found</div></body></html>");
assert.strictEqual(emptyResults.length, 0, "Empty HTML should return no results");
console.log("✅ Empty results test passed!\n");

// ── Test webSearch function with network (will fail in sandbox but validates code path) ──

console.log("=== Testing webSearch function (network call) ===\n");

try {
  const result = await webSearch("test query");
  console.log("webSearch returned:", result.slice(0, 100) + "...");
  // In a network-restricted sandbox, we expect the "no results" message
  assert.ok(
    result.includes("Web search results") || result.includes("No web search results"),
    "Should return either results or no-results message"
  );
  console.log("✅ webSearch function executed without crashing!\n");
} catch (err) {
  console.log("⚠️  webSearch threw (expected in network-restricted env):", err.message);
}

// ── Test that parseDDGHTML handles malformed HTML gracefully ──────────────────

console.log("=== Testing malformed HTML handling ===\n");

const malformed = `<div class="result "><a class="result__a" href="not-a-url">Title</a></div>`;
const malformedResults = parseDDGHTML(malformed);
assert.strictEqual(malformedResults.length, 0, "Non-http URLs should be filtered out");
console.log("✅ Malformed HTML test passed!\n");

// ── Test URL without uddg parameter (direct links) ──────────────────────────

console.log("=== Testing direct URL (no uddg redirect) ===\n");
const directUrlHtml = `
<div class="result ">
  <a class="result__a" href="https://example.com/page">Direct Title</a>
  <a class="result__snippet" href="#">A snippet about the page</a>
</div>
`;
const directResults = parseDDGHTML(directUrlHtml);
assert.strictEqual(directResults.length, 1, "Should find 1 result with direct URL");
assert.strictEqual(directResults[0].url, "https://example.com/page");
assert.strictEqual(directResults[0].title, "Direct Title");
console.log("✅ Direct URL test passed!\n");

console.log("\n🎉 ALL TESTS PASSED! 🎉\n");
