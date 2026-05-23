import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import betterSqlite3 from 'better-sqlite3';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DB Setup
const db = new betterSqlite3('links.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    title TEXT,
    description TEXT,
    tags TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
  httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
});

const LinkSchema = z.object({
  url: z.string().url(),
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // API Routes
  app.get('/api/links', (req, res) => {
    const { q } = req.query;
    try {
      let stmt;
      if (q && typeof q === 'string') {
        stmt = db.prepare(`
          SELECT * FROM links 
          WHERE title LIKE ? OR description LIKE ? OR tags LIKE ? 
          ORDER BY created_at DESC
        `);
        const search = `%${q}%`;
        const links = stmt.all(search, search, search);
        res.json(links.map((l: any) => ({ ...l, tags: JSON.parse(l.tags || '[]') })));
      } else {
        stmt = db.prepare('SELECT * FROM links ORDER BY created_at DESC');
        const links = stmt.all();
        res.json(links.map((l: any) => ({ ...l, tags: JSON.parse(l.tags || '[]') })));
      }
    } catch (error) {
      console.error('DB Error:', error);
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.post('/api/links', async (req, res) => {
    try {
      const { url } = LinkSchema.parse(req.body);
      
      console.log('Processing URL:', url);

      // AI Processing
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: `Analyze this URL and provide metadata for a link-saving app.
URL: ${url}`,
        config: { 
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              title: { type: 'STRING', description: 'A concise, clear title for the link.' },
              description: { type: 'STRING', description: 'A search-friendly description (1-2 sentences).' },
              tags: { 
                type: 'ARRAY', 
                items: { type: 'STRING' },
                description: '3-5 relevant tags for categorization.' 
              }
            },
            required: ['title', 'description', 'tags']
          }
        }
      });

      const text = response.text || '{}';
      const analysis = JSON.parse(text);
      
      const stmt = db.prepare('INSERT INTO links (url, title, description, tags) VALUES (?, ?, ?, ?)');
      const info = stmt.run(url, analysis.title || url, analysis.description || '', JSON.stringify(analysis.tags || []));
      
      res.json({ 
        id: info.lastInsertRowid, 
        url,
        title: analysis.title || url,
        description: analysis.description || '',
        tags: analysis.tags || [],
        created_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('API Error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to process link' });
    }
  });

  app.delete('/api/links/:id', (req, res) => {
    const { id } = req.params;
    try {
      db.prepare('DELETE FROM links WHERE id = ?').run(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete link' });
    }
  });

  // Share Target API endpoint
  app.post('/api/share', (req, res) => {
    // When sharing from Android, the URL is often in 'text' or 'url'
    const { title, text, url } = req.body;
    console.log('Received shared content:', { title, text, url });
    
    // Most Android apps share the URL as 'text' if it's not in 'url'
    const sharedUrl = url || (text && text.match(/https?:\/\/[^\s]+/)?.[0]);
    
    if (sharedUrl) {
      // We'll redirect to the main app with the URL as a query param so the frontend can handle it
      // or we can process it directly.
      // Better to redirect so the user sees the result.
      res.redirect(`/?share_url=${encodeURIComponent(sharedUrl)}`);
    } else {
      res.redirect('/');
    }
  });

  // Vite middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Correct way for Express v4
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
