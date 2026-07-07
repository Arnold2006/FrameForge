// ── Web search via DuckDuckGo HTML endpoint ──────────────────────────────────
// Replaces the broken duck-duck-scrape library with direct HTML scraping.
// Uses https://html.duckduckgo.com/html/ which is designed for simple clients
// and is the most reliable DuckDuckGo scraping target.

const DDG_URL = "https://html.duckduckgo.com/html/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT_MS = 10000;

/**
 * Parse DuckDuckGo HTML search results into structured objects.
 * Exported for unit testing.
 */
export function parseDDGHTML(html) {
  const results = [];
  // DuckDuckGo HTML results are in elements with class "result"
  // Each result has: .result__a (link+title), .result__snippet (description), .result__url (display url)
  
  // Match each result block
  const resultBlocks = html.split(/class="result\s/g).slice(1);
  
  for (const block of resultBlocks) {
    if (results.length >= 8) break;
    
    // Extract title and URL from the result link
    const titleMatch = block.match(/class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    // Extract snippet
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|span|div)/);
    
    if (titleMatch) {
      let url = titleMatch[1] || "";
      const title = stripHTML(titleMatch[2] || "");
      const snippet = snippetMatch ? stripHTML(snippetMatch[1] || "") : "";
      
      // DuckDuckGo wraps URLs in a redirect - extract the actual URL
      if (url.includes("uddg=")) {
        const uddgMatch = url.match(/uddg=([^&]+)/);
        if (uddgMatch) {
          url = decodeURIComponent(uddgMatch[1]);
        }
      }
      
      if (title && url && url.startsWith("http")) {
        results.push({ title: title.trim(), url, snippet: snippet.trim() });
      }
    }
  }
  
  return results;
}

/** Strip HTML tags and decode common entities */
function stripHTML(str) {
  return str
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Perform a web search using DuckDuckGo's HTML endpoint.
 * Returns a formatted string of results or a "no results" message.
 */
export async function webSearch(query) {
  // Strategy 1: DuckDuckGo HTML endpoint (most reliable for scraping)
  try {
    const formData = new URLSearchParams({ q: query, b: "" });
    const res = await fetch(DDG_URL, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "text/html",
        "Accept-Language": "en-US,en;q=0.9"
      },
      body: formData.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow"
    });

    if (res.ok) {
      const html = await res.text();
      const results = parseDDGHTML(html);
      if (results.length > 0) {
        const snippets = results.slice(0, 6).map(r =>
          `[${r.title}](${r.url}): ${r.snippet || "No description available."}`
        );
        return `Web search results for "${query}":\n${snippets.map(s => `- ${s}`).join("\n")}`;
      }
      console.warn(`[web-search] DDG HTML returned no parseable results for: "${query}"`);
    } else {
      console.warn(`[web-search] DDG HTML returned status ${res.status} for: "${query}"`);
    }
  } catch (err) {
    console.warn(`[web-search] DDG HTML search failed for "${query}":`, err.message);
  }

  // Strategy 2: DuckDuckGo Instant Answer API (good for factual queries)
  try {
    const ddgApiUrl =
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(ddgApiUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      const data = await res.json();
      const parts = [];
      if (data.AbstractText) parts.push(data.AbstractText);
      if (data.Answer) parts.push(data.Answer);
      for (const topic of (data.RelatedTopics || []).slice(0, 5)) {
        if (topic.Text) parts.push(topic.Text);
      }
      if (parts.length > 0) {
        return `Web search results for "${query}":\n${parts.map(r => `- ${r}`).join("\n")}`;
      }
    }
  } catch (err) {
    console.warn(`[web-search] DDG Instant Answer API failed for "${query}":`, err.message);
  }

  // Strategy 3: DuckDuckGo Lite (alternative HTML endpoint)
  try {
    const liteUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const res = await fetch(liteUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html"
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (res.ok) {
      const html = await res.text();
      // Lite version uses table rows for results
      const linkMatches = [...html.matchAll(/<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
      const snippetMatches = [...html.matchAll(/class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g)];
      
      if (linkMatches.length > 0) {
        const results = linkMatches.slice(0, 6).map((m, i) => {
          const url = m[1];
          const title = stripHTML(m[2]);
          const snippet = snippetMatches[i] ? stripHTML(snippetMatches[i][1]) : "";
          return `[${title}](${url}): ${snippet || "No description available."}`;
        });
        return `Web search results for "${query}":\n${results.map(s => `- ${s}`).join("\n")}`;
      }
    }
  } catch (err) {
    console.warn(`[web-search] DDG Lite search failed for "${query}":`, err.message);
  }

  console.error(`[web-search] ALL search strategies failed for: "${query}"`);
  return `No web search results found for "${query}". All search strategies failed — please check your internet connection or try again later.`;
}
