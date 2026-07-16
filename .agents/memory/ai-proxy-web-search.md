---
name: AI proxy web search
description: Replit OpenAI proxy supports the web_search tool via the Responses API at runtime
---

The Replit AI Integrations OpenAI proxy supports `tools: [{ type: "web_search" }]` on the Responses API (`openai.responses.create`), so the app server can do live web/news searches at runtime without an extra search API key.

**Why:** external-apis connectors (Exa, Brave…) are agent-sandbox-only callbacks; they cannot be called from the user's app at runtime. The proxy web_search tool is the runtime alternative.

**How to apply:** FACTA's brand-news endpoint uses it with a 7-day DB cache (`product_news` table) to limit billing; sanitize AI-returned URLs to http/https before rendering.
