package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	firebase "firebase.google.com/go/v4"
	"google.golang.org/genai"
)

var firebaseApp *firebase.App

func initFirebase() {
	ctx := context.Background()
	// Read Firebase Project ID from the environment (fallback to config)
	projectID := os.Getenv("VITE_FIREBASE_PROJECT_ID")
	if projectID == "" {
		projectID = os.Getenv("FIREBASE_PROJECT_ID")
	}

	var config *firebase.Config
	if projectID != "" {
		config = &firebase.Config{ProjectID: projectID}
		log.Printf("Initializing Firebase App with Project ID: %s", projectID)
	} else {
		log.Printf("Initializing Firebase App with default system credentials")
	}

	var err error
	firebaseApp, err = firebase.NewApp(ctx, config)
	if err != nil {
		log.Fatalf("Error initializing Firebase App: %v", err)
	}
}

func verifyToken(ctx context.Context, authHeader string) (string, error) {
	if authHeader == "" {
		return "", fmt.Errorf("no authorization header provided")
	}

	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
		return "", fmt.Errorf("invalid authorization header format (expected Bearer <token>)")
	}

	idToken := parts[1]

	client, err := firebaseApp.Auth(ctx)
	if err != nil {
		return "", fmt.Errorf("error getting firebase auth client: %v", err)
	}

	token, err := client.VerifyIDToken(ctx, idToken)
	if err != nil {
		return "", fmt.Errorf("error verifying id token: %v", err)
	}

	return token.UID, nil
}

type AnalyzeRequest struct {
	URL string `json:"url"`
}

type AnalyzeResponse struct {
	URL         string   `json:"url"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
	CreatedAt   string   `json:"created_at"`
}

func fetchPageMetadata(ctx context.Context, targetURL string) (string, error) {
	// Create client with timeout
	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	req, err := http.NewRequestWithContext(ctx, "GET", targetURL, nil)
	if err != nil {
		return "", err
	}

	// Use a standard browser User-Agent to avoid basic crawler blocks
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("bad status code: %d", resp.StatusCode)
	}

	// Limit reading to 1.5MB to support heavy pages like YouTube
	limitReader := io.LimitReader(resp.Body, 1536*1024)
	htmlContentBytes, err := io.ReadAll(limitReader)
	if err != nil {
		return "", err
	}
	htmlContent := string(htmlContentBytes)

	// Try to extract <head>...</head> content as it contains most metadata (title, og:description, etc.)
	lowerContent := strings.ToLower(htmlContent)
	headStart := strings.Index(lowerContent, "<head>")
	headEnd := strings.Index(lowerContent, "</head>")

	if headStart != -1 && headEnd != -1 && headEnd > headStart {
		return htmlContent[headStart : headEnd+7], nil
	}

	// If no head tag is found, fallback to the first 10KB of HTML body
	if len(htmlContent) > 10240 {
		return htmlContent[:10240], nil
	}
	return htmlContent, nil
}

func stripTags(html, tagName string) string {
	var sb strings.Builder
	sb.Grow(len(html))

	lowerHTML := strings.ToLower(html)
	startTag := "<" + tagName
	endTag := "</" + tagName + ">"

	idx := 0
	for {
		startIdx := strings.Index(lowerHTML[idx:], startTag)
		if startIdx == -1 {
			sb.WriteString(html[idx:])
			break
		}
		startPos := idx + startIdx
		sb.WriteString(html[idx:startPos])

		endIdx := strings.Index(lowerHTML[startPos:], endTag)
		if endIdx == -1 {
			idx = len(html)
			break
		}
		idx = startPos + endIdx + len(endTag)
	}
	return sb.String()
}

func extractMetaTags(html string) string {
	// Strip out scripts and styles to avoid noise and parsing issues
	html = stripTags(html, "script")
	html = stripTags(html, "style")

	var sb strings.Builder

	lowerHTML := strings.ToLower(html)
	titleStart := strings.Index(lowerHTML, "<title>")
	if titleStart != -1 {
		titleEnd := strings.Index(lowerHTML[titleStart:], "</title>")
		if titleEnd != -1 {
			titleText := html[titleStart+7 : titleStart+titleEnd]
			sb.WriteString(fmt.Sprintf("Title: %s\n", strings.TrimSpace(titleText)))
		}
	}

	idx := 0
	for {
		start := strings.Index(lowerHTML[idx:], "<meta")
		if start == -1 {
			break
		}
		startPos := idx + start
		end := strings.Index(html[startPos:], ">")
		if end == -1 {
			break
		}
		endPos := startPos + end + 1
		metaTag := html[startPos:endPos]
		idx = endPos

		lowerTag := strings.ToLower(metaTag)
		if strings.Contains(lowerTag, "title") ||
			strings.Contains(lowerTag, "description") ||
			strings.Contains(lowerTag, "keyword") ||
			strings.Contains(lowerTag, "og:") ||
			strings.Contains(lowerTag, "twitter:") {
			sb.WriteString(strings.TrimSpace(metaTag))
			sb.WriteString("\n")
		}
	}

	return sb.String()
}

func analyzeLinkHandler(w http.ResponseWriter, r *http.Request) {
	// CORS Headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()

	// 1. Verify User Authentication
	authHeader := r.Header.Get("Authorization")
	uid, err := verifyToken(ctx, authHeader)
	if err != nil {
		log.Printf("Authentication failed: %v", err)
		http.Error(w, fmt.Sprintf("Unauthorized: %v", err), http.StatusUnauthorized)
		return
	}
	log.Printf("User %s authorized successfully", uid)

	// 2. Parse Request URL
	var req AnalyzeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	if req.URL == "" {
		http.Error(w, "Field 'url' is required", http.StatusBadRequest)
		return
	}

	// 3. Retrieve Gemini API Key
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		log.Printf("GEMINI_API_KEY not configured in environment")
		http.Error(w, "Gemini API Key is not configured on the server", http.StatusInternalServerError)
		return
	}

	// 4. Initialize Gemini client
	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey:  apiKey,
		Backend: genai.BackendGeminiAPI,
	})
	if err != nil {
		log.Printf("Failed to create GenAI client: %v", err)
		http.Error(w, "Internal server error initializing AI client", http.StatusInternalServerError)
		return
	}

	// 5. Define schema for structured JSON output
	responseSchema := &genai.Schema{
		Type: genai.TypeObject,
		Properties: map[string]*genai.Schema{
			"title":       {Type: genai.TypeString, Description: "A concise, clear title for the link."},
			"description": {Type: genai.TypeString, Description: "A search-friendly description (1-2 sentences)."},
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

	var prompt string
	var resolvedByOEmbed bool

	if isYouTubeURL(req.URL) {
		log.Printf("YouTube URL detected. Attempting to fetch oEmbed metadata for: %s", req.URL)
		oEmbedData, oErr := fetchYouTubeOEmbed(ctx, req.URL)
		if oErr == nil {
			log.Printf("Successfully retrieved YouTube oEmbed metadata for URL: %s", req.URL)
			prompt = fmt.Sprintf("Analyze this YouTube video and generate metadata (concise title, search-friendly description, tags) for a link-saving app.\nVideo URL: %s\nVideo Title: %s\nChannel Name: %s\nProvider: %s", req.URL, oEmbedData.Title, oEmbedData.AuthorName, oEmbedData.ProviderName)
			resolvedByOEmbed = true
		} else {
			log.Printf("Warning: Failed to fetch YouTube oEmbed: %v. Falling back to page-scraping.", oErr)
		}
	}

	if !resolvedByOEmbed {
		// Try to fetch target webpage context
		pageContext, err := fetchPageMetadata(ctx, req.URL)
		if err != nil {
			log.Printf("Warning: Failed to fetch metadata for URL %s: %v. Falling back to URL-only analysis.", req.URL, err)
			prompt = fmt.Sprintf("Analyze this URL and provide metadata for a link-saving app.\nURL: %s", req.URL)
		} else {
			extractedMeta := extractMetaTags(pageContext)
			log.Printf("Successfully retrieved and extracted HTML metadata for URL: %s", req.URL)
			prompt = fmt.Sprintf("Analyze this URL and the provided HTML metadata tags to generate metadata for a link-saving app.\nURL: %s\n\nExtracted HTML Metadata:\n%s", req.URL, extractedMeta)
		}
	}

	log.Printf("Sending request to Gemini model for URL: %s", req.URL)
	result, err := client.Models.GenerateContent(
		ctx,
		"gemini-2.5-flash-lite",
		genai.Text(prompt),
		config,
	)
	if err != nil {
		log.Printf("Failed to generate content from Gemini: %v", err)
		http.Error(w, fmt.Sprintf("Gemini analysis failed: %v", err), http.StatusInternalServerError)
		return
	}

	// 6. Decode AI response
	if len(result.Candidates) == 0 || len(result.Candidates[0].Content.Parts) == 0 {
		http.Error(w, "No content generated from Gemini model", http.StatusInternalServerError)
		return
	}

	rawJSON := result.Candidates[0].Content.Parts[0].Text

	var aiResult struct {
		Title       string   `json:"title"`
		Description string   `json:"description"`
		Tags        []string `json:"tags"`
	}

	if err := json.Unmarshal([]byte(rawJSON), &aiResult); err != nil {
		log.Printf("Failed to unmarshal Gemini output: %v. Raw text: %s", err, rawJSON)
		// Fallback metadata if json parsing fails
		aiResult.Title = req.URL
		aiResult.Tags = []string{}
	}

	resp := AnalyzeResponse{
		URL:         req.URL,
		Title:       aiResult.Title,
		Description: aiResult.Description,
		Tags:        aiResult.Tags,
		CreatedAt:   time.Now().Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Printf("Failed to write response: %v", err)
	}
}

func main() {
	initFirebase()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	http.HandleFunc("/api/links", analyzeLinkHandler)

	log.Printf("Go server starting on port %s...", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Failed to start Go server: %v", err)
	}
}

type OEmbedResponse struct {
	Title        string `json:"title"`
	AuthorName   string `json:"author_name"`
	AuthorURL    string `json:"author_url"`
	Type         string `json:"type"`
	ProviderName string `json:"provider_name"`
}

func isYouTubeURL(targetURL string) bool {
	lower := strings.ToLower(targetURL)
	return strings.Contains(lower, "youtube.com") || strings.Contains(lower, "youtu.be")
}

func fetchYouTubeOEmbed(ctx context.Context, targetURL string) (*OEmbedResponse, error) {
	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	oEmbedURL := fmt.Sprintf("https://www.youtube.com/oembed?url=%s&format=json", strings.ReplaceAll(targetURL, "&", "%26"))
	req, err := http.NewRequestWithContext(ctx, "GET", oEmbedURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("oEmbed returned status: %d", resp.StatusCode)
	}

	var oResp OEmbedResponse
	if err := json.NewDecoder(resp.Body).Decode(&oResp); err != nil {
		return nil, err
	}

	return &oResp, nil
}

