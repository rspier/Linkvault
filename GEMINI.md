# LinkVault Gemini AI Integration Guide

This document captures architectural decisions, configuration details, and lessons learned regarding the Gemini AI integration in LinkVault.

---

## 1. SDK & Model Choice

* **SDK**: Official new Google GenAI Go SDK (`google.golang.org/genai`).
* **Model**: `gemini-2.5-flash-lite`
  * Selected for its ultra-low latency, low cost, and high efficiency when analyzing text and webpage metadata in real-time.

---

## 2. Structured JSON Outputs

To guarantee that the Go backend receives reliable data fields for title, description, and tags, we configure a strict schema restriction directly on the request config.

### Implementation Pattern in Go
```go
import "google.golang.org/genai"

// Define the response schema structure
responseSchema := &genai.Schema{
    Type: genai.TypeObject,
    Properties: map[string]*genai.Schema{
        "title":       {Type: genai.TypeString, Description: "A concise, clear title for the link."},
        "description": {Type: genai.TypeString, Description: "A search-friendly, informative summary description (2-4 sentences)."},
        "tags": {
            Type: genai.TypeArray,
            Items: &genai.Schema{Type: genai.TypeString},
            Description: "3-5 relevant tags for categorization.",
        },
    },
    Required: []string{"title", "description", "tags"},
}

config := &genai.GenerateContentConfig{
    ResponseMIMEType: "application/json",
    ResponseSchema:   responseSchema,
}

result, err := client.Models.GenerateContent(
    ctx,
    "gemini-2.5-flash-lite",
    genai.Text(prompt),
    config,
)
```

---

## 3. Webpage Scraper & Edge Cases

When users submit links, we scrape target page metadata to feed into the Gemini context. This involves specific performance and structural patterns:

1. **User-Agent Masquerading**: Some websites block default Go HTTP clients. We explicitly set standard browser headers:
   ```http
   User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...
   ```
2. **Metadata Size Limit**: To avoid wasting bandwidth/memory on heavy pages, we restrict page body reading to `1.5 MB` and target extraction to `<head>...</head>` tags containing meta/open-graph info.
3. **YouTube Specific Workaround**: YouTube blocks standard scraper crawlers or returns JavaScript bootloaders without pre-rendered descriptions. To resolve this:
   * We intercept YouTube/YouTu.be URLs.
   * We query the public YouTube oEmbed endpoint:
     ```http
     https://www.youtube.com/oembed?url={URL}&format=json
     ```
   * We extract the high-quality metadata (video title, author channel, provider) and construct a rich prompt for Gemini rather than scraping the raw page.

---

## 4. Prompt Engineering & Target Output Length

To ensure high-quality, search-friendly summaries that capture user interest without being overly brief, we tuned the prompt length instructions:
* **Constraint**: Ask Gemini explicitly for `2-4 sentences` of descriptive summary context.
* **Fallbacks**: If a page fails to fetch or scrape due to server restrictions, the prompt falls back to raw URL-only inference (`URL-only analysis`).

---

## 5. Development & Deployment

### Local Development
To run the Go backend locally, define the `GEMINI_API_KEY` in your `.env` file and use the Makefile wrapper:
```bash
make dev-backend
```

### Production Deployment
The backend deploys to **Google Cloud Run** using Google Cloud Build.
* **Secret Management**: Ensure `GEMINI_API_KEY` is configured in your deployment environment as it is injected at compile/runtime into the Cloud Run service.
* **Cloud Build with Buildx**: If using multi-stage cached Docker builds, confirm that buildx support is enabled on the Cloud Build pool.
