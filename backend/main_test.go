package main

import (
	"strings"
	"testing"
)

func TestStripTags(t *testing.T) {
	input := `<div>Hello <script>console.log("world")</script> World <style>body {}</style>!</div>`
	
	// Strip script
	res := stripTags(input, "script")
	if strings.Contains(res, "console.log") {
		t.Errorf("Expected script tag to be stripped, got: %s", res)
	}

	// Strip style
	res = stripTags(res, "style")
	if strings.Contains(res, "body {}") {
		t.Errorf("Expected style tag to be stripped, got: %s", res)
	}

	expected := `<div>Hello  World !</div>`
	if strings.TrimSpace(res) != strings.TrimSpace(expected) {
		t.Errorf("Expected clean text, got: %q", res)
	}
}

func TestExtractMetaTags(t *testing.T) {
	html := `
	<html>
	<head>
		<title>Test Page Title</title>
		<meta name="title" content="Test Page Title">
		<meta name="description" content="This is a test description.">
		<meta property="og:title" content="OG Page Title">
		<meta property="og:description" content="OG description.">
		<meta name="keywords" content="test, golang, linkvault">
		<script>
			// Fake tag to ignore
			var s = '<meta name="title" content="Fake Title">';
		</script>
		<style>
			.meta { display: none; }
		</style>
	</head>
	<body></body>
	</html>
	`

	extracted := extractMetaTags(html)

	if !strings.Contains(extracted, "Title: Test Page Title") {
		t.Errorf("Expected title, got: %s", extracted)
	}

	if !strings.Contains(extracted, `name="title" content="Test Page Title"`) {
		t.Errorf("Expected meta title tag, got: %s", extracted)
	}

	if !strings.Contains(extracted, `name="description" content="This is a test description."`) {
		t.Errorf("Expected meta description tag, got: %s", extracted)
	}

	if !strings.Contains(extracted, `property="og:title" content="OG Page Title"`) {
		t.Errorf("Expected og:title, got: %s", extracted)
	}

	if strings.Contains(extracted, "Fake Title") {
		t.Errorf("Should not extract fake meta tag from script: %s", extracted)
	}
}

func TestIsYouTubeURL(t *testing.T) {
	tests := []struct {
		url      string
		expected bool
	}{
		{"https://www.youtube.com/watch?v=NNOERTEh1Bo", true},
		{"https://youtu.be/NNOERTEh1Bo", true},
		{"https://m.youtube.com/watch?v=NNOERTEh1Bo", true},
		{"https://youtube.com/embed/NNOERTEh1Bo", true},
		{"https://google.com", false},
		{"https://github.com/youtube/youtube", false},
	}

	for _, tc := range tests {
		res := isYouTubeURL(tc.url)
		if res != tc.expected {
			t.Errorf("isYouTubeURL(%q) = %t; want %t", tc.url, res, tc.expected)
		}
	}
}

