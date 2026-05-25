package main

import (
	"context"
	"encoding/json"
	"fmt"
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

	prompt := fmt.Sprintf("Analyze this URL and provide metadata for a link-saving app.\nURL: %s", req.URL)

	log.Printf("Sending request to Gemini model for URL: %s", req.URL)
	result, err := client.Models.GenerateContent(
		ctx,
		"gemini-2.5-flash",
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
