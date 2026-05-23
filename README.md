# 📂 LinkVault Deployment Guide

LinkVault is a fully self-contained, offline-ready link archiving application powered by a React frontend, an Express API gateway, a persistent SQLite local database, and Google Gemini AI.

Because the app runs a backend server and reads/writes to a persistent SQLite database, it needs a hosting environment that supports Node.js or Docker containers (and not static hosts like GitHub Pages).

---

## 🚀 How to Export from AI Studio

1. **Open AI Studio Settings**: In the top-right corner of the AI Studio workspace, locate the **Settings / Menu** button.
2. **Download or Export**:
   - Tap **Export to GitHub** to automatically push the repository to your remote GitHub profile.
   - Tap **Download ZIP** to package the pristine codebase directly onto your computer.

---

## 💻 Running LinkVault Locally

Make sure you have [Node.js](https://nodejs.org) (v18+) installed.

1. **Decompress and Enter Directory**:
   ```bash
   unzip LinkVault.zip
   cd LinkVault
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Secret**:
   Create a `.env` file in the root directory:
   ```env
   GEMINI_API_KEY="your-actual-gemini-api-key"
   NODE_ENV="production"
   ```

4. **Build and Start Production Engine**:
   ```bash
   npm run build
   npm run start
   ```
   *Your app will launch locally on **http://localhost:3000**.*

---

## ☁️ Standalone Cloud Hosting Options

Here are excellent, secure, and developer-friendly platforms for hosting LinkVault with modern full-stack support:

### Option A: Google Cloud Run (Recommended & Free Tier Friendly)
Because Google Cloud Run specializes in container scale-to-zero compute, it's perfect for private utilities:
1. Initialize Google Cloud Build to compile a lightweight container.
2. Connect your exported GitHub repository for continuous builds.
3. Configure the environment variable `GEMINI_API_KEY` under Cloud Run configuration parameters.

### Option B: Railway.app or Render.com
Both platforms auto-detect the Node.js setup and persist SQLite directories reliably:
1. Link your exported GitHub repository.
2. Under environment settings, add your `GEMINI_API_KEY`.
3. Set the build command to `npm run build` and the start script to `npm run start`.

### Option C: GitHub Pages (Static Client Deploy)
We have added a configured **GitHub Actions** workflow under `.github/workflows/deploy.yml` that builds and deploys the static parts of the client directly to your `gh-pages` branch on every push.

Because GitHub Pages is a static file server, it executes in **Offline mode** utilizing your secure local browser cache (IndexedDB/localStorage) for saving links directly on your device.

**To activate GitHub Pages for your repository:**
1. Go to your repository on GitHub.
2. Select **Settings** (tab at the top of the repo page).
3. In the left-hand navigation bar, click on **Pages**.
4. Under **Build and deployment -> Branch**:
   - Change the source folder configuration dropdown from `None` to **`gh-pages`**.
   - Set the directory folder selector to **`/ (root)`**.
5. Save the configuration. GitHub will deploy and host your application at `https://<your-username>.github.io/<your-repository-name>/`.

