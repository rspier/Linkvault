import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Search as SearchIcon, X, ExternalLink, Hash, Clock, Trash2, Loader2, Share2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from './types';
import { cn } from './lib/utils';
import { Logo } from './components/Logo';

export default function App() {
  const [links, setLinks] = useState<Link[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingLinks, setPendingLinks] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('pending_links');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [isProcessingPending, setIsProcessingPending] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('pending_links', JSON.stringify(pendingLinks));
    } catch (err) {
      console.error('Failed to save pending links to storage:', err);
    }
  }, [pendingLinks]);

  const fetchLinks = useCallback(async (query = '') => {
    try {
      const resp = await fetch(`/api/links?q=${encodeURIComponent(query)}`);
      if (!resp.ok) throw new Error('Failed to fetch links');
      const data = await resp.json();
      setLinks(data);
      setIsOnline(navigator.onLine);
      if (!query) localStorage.setItem('cached_links', JSON.stringify(data));
    } catch (err) {
      console.error(err);
      setIsOnline(false);
      const cached = localStorage.getItem('cached_links');
      if (cached) {
        let allLinks = JSON.parse(cached) as Link[];
        if (query) {
          allLinks = allLinks.filter(l => 
            l.title.toLowerCase().includes(query.toLowerCase()) || 
            l.description.toLowerCase().includes(query.toLowerCase()) ||
            l.tags.some(t => t.toLowerCase().includes(query.toLowerCase()))
          );
        }
        setLinks(allLinks);
      }
    }
  }, []);

  // Monitor network online status dynamically
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);


  useEffect(() => {
    fetchLinks(searchQuery);
  }, [searchQuery, fetchLinks]);

  // Handle share target redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shared = params.get('share_url');
    if (shared) {
      setNewUrl(shared);
      setIsAdding(true);
      // Clean up URL
      window.history.replaceState({}, '', '/');
    }
  }, []);

  const handleAddLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl) return;
    
    setIsLoading(true);
    setError(null);

    // If offline, queue immediately without API call
    if (!navigator.onLine) {
      if (!pendingLinks.includes(newUrl)) {
        setPendingLinks(prev => [...prev, newUrl]);
      }
      setNewUrl('');
      setIsAdding(false);
      setIsLoading(false);
      return;
    }

    try {
      const resp = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl })
      });
      
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error || 'Failed to add link');
      }
      
      setNewUrl('');
      setIsAdding(false);
      fetchLinks();
    } catch (err) {
      console.error('Failed to add online link:', err);
      // Fallback: Queue as offline
      if (!pendingLinks.includes(newUrl)) {
        setPendingLinks(prev => [...prev, newUrl]);
      }
      setNewUrl('');
      setIsAdding(false);
    } finally {
      setIsLoading(false);
    }
  };

  const processPendingLinks = async () => {
    if (pendingLinks.length === 0) return;
    if (!navigator.onLine) {
      setError('You are currently offline. Please connect to internet to process pending links!');
      return;
    }
    
    setIsProcessingPending(true);
    setError(null);
    const successfullyProcessed: string[] = [];
    
    for (const url of pendingLinks) {
      try {
        const resp = await fetch('/api/links', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        if (resp.ok) {
          successfullyProcessed.push(url);
        } else {
          console.error(`Failed to process: ${url}`);
        }
      } catch (err) {
        console.error(`Connection error processing: ${url}`, err);
        break; // Stop and retry later on subsequent connection
      }
    }
    
    setPendingLinks(prev => prev.filter(item => !successfullyProcessed.includes(item)));
    setIsProcessingPending(false);
    fetchLinks();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this link?')) return;
    try {
      await fetch(`/api/links/${id}`, { method: 'DELETE' });
      fetchLinks();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 font-sans flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      {/* Header Section */}
      <header className="bg-white px-4 pt-6 pb-4 border-b border-slate-200 shadow-xs sticky top-0 z-40">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Logo size={28} />
            <h1 className="text-xl font-black tracking-tight text-slate-800">LinkVault</h1>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={() => setIsAdding(true)}
              className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-200 transition-colors active:scale-95 border border-slate-200/50"
            >
              <Plus size={20} strokeWidth={2.5} />
            </button>
          </div>
        </div>
        {/* Search Bar */}
        <div className="mt-4 relative">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
            <SearchIcon className="w-4 h-4 text-slate-400" strokeWidth={2.5} />
          </div>
          <input 
            type="text" 
            placeholder={`Search ${links.length || ''} ${!isOnline ? 'offline ' : ''}links...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-100 border-none rounded-lg py-2.5 pl-10 pr-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-shadow placeholder:text-slate-400 font-medium"
          />
        </div>
      </header>

      {/* Content Area */}
      <main className="flex-1 overflow-y-auto pb-24">
        {/* Connection & Sorting Notifications */}
        {!isOnline && (
          <div className="mx-4 mt-4">
            <div className="bg-slate-800 rounded-xl p-4 flex items-center justify-between shadow-xs border border-slate-700/50">
              <div>
                <p className="text-white font-semibold text-sm">Offline Mode Active</p>
                <p className="text-slate-300 text-xs">Viewing cached Library catalog offline</p>
              </div>
              <button 
                onClick={() => fetchLinks(searchQuery)}
                className="bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold py-2 px-4 rounded-lg transition-colors active:scale-95 uppercase tracking-wider"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {pendingLinks.length > 0 && (
          <div className="mx-4 mt-4">
            <div className="bg-indigo-600 rounded-xl p-4 flex items-center justify-between shadow-md">
              <div className="flex items-center gap-3">
                {isProcessingPending ? (
                  <Loader2 className="w-5 h-5 text-indigo-200 animate-spin" />
                ) : (
                  <div className="w-2.5 h-2.5 bg-amber-400 rounded-full animate-ping shrink-0" />
                )}
                <div>
                  <p className="text-white font-semibold text-sm leading-tight">
                    {pendingLinks.length} link{pendingLinks.length > 1 ? 's' : ''} pending process
                  </p>
                  <p className="text-indigo-100 text-xs mt-0.5">
                    {isProcessingPending ? 'AI is generating titles, tags & summaries...' : 'Tap below to batch sync with Gemini AI'}
                  </p>
                </div>
              </div>
              <button 
                onClick={processPendingLinks}
                disabled={isProcessingPending}
                className="bg-white/20 hover:bg-white/30 text-white text-[10px] font-bold py-2 px-4 rounded-lg backdrop-blur-sm transition-colors active:scale-95 uppercase tracking-wider disabled:opacity-50"
              >
                {isProcessingPending ? 'Syncing...' : 'PROCESS NOW'}
              </button>
            </div>
          </div>
        )}

        {/* Links List */}
        <div className="mt-6 px-4 space-y-4">
          <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] px-1">
            {searchQuery ? 'Search Results' : 'Recent Saves'}
          </h2>
          
          <AnimatePresence mode="popLayout">
            {links.map((link) => (
              <motion.div
                key={link.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="bg-white rounded-xl border border-slate-200 p-4 active:bg-slate-50 transition-colors cursor-pointer group shadow-xs border-b-2 border-b-slate-200/60"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-semibold text-slate-800 leading-tight truncate pr-2">
                        {link.title}
                      </h3>
                      {!isOnline && (
                        <span className="text-[9px] bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded shrink-0 uppercase tracking-wider">
                          OFFLINE
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-medium text-slate-400 truncate mb-2">
                      {new URL(link.url).hostname}
                    </p>
                    <p className="text-sm text-slate-600 line-clamp-2 leading-relaxed font-normal">
                      {link.description}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-4">
                      {link.tags.map(tag => (
                        <span key={tag} className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2.5 py-1 rounded-md border border-slate-200/40">
                          #{tag.replace(/\s+/g, '').toLowerCase()}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <a 
                      href={link.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    >
                      <ExternalLink size={18} />
                    </a>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(link.id); }}
                      className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {links.length === 0 && !isLoading && (
            <div className="text-center py-20 bg-slate-100/50 rounded-2xl border border-dashed border-slate-200 mx-1">
              <p className="text-slate-400 text-sm font-medium italic">
                {searchQuery ? 'No matching records found' : 'Your link vault is currently empty'}
              </p>
            </div>
          )}
        </div>
      </main>

      {/* Bottom Navigation */}
      <nav className="bg-white border-t border-slate-200 h-20 flex items-center justify-around px-6 fixed bottom-0 left-0 right-0 z-50 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <button className="flex flex-col items-center gap-1.5 text-indigo-600 transition-transform active:scale-90">
          <Clock size={22} strokeWidth={2.5} />
          <span className="text-[10px] font-bold uppercase tracking-wider">Library</span>
        </button>
        <button className="flex flex-col items-center gap-1.5 text-slate-400 transition-transform active:scale-90">
          <Share2 size={22} strokeWidth={2} />
          <span className="text-[10px] font-bold uppercase tracking-wider">Process</span>
        </button>
        <button className="flex flex-col items-center gap-1.5 text-slate-400 transition-transform active:scale-90">
          <SearchIcon size={22} strokeWidth={2} />
          <span className="text-[10px] font-bold uppercase tracking-wider">Explore</span>
        </button>
        <button className="flex flex-col items-center gap-1.5 text-slate-400 transition-transform active:scale-90">
          <Hash size={22} strokeWidth={2} />
          <span className="text-[10px] font-bold uppercase tracking-wider">Prefs</span>
        </button>
      </nav>

      {/* Add Modal */}
      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 z-[100] flex items-end">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isLoading && setIsAdding(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 400 }}
              className="relative w-full bg-white rounded-t-[32px] p-6 pb-12 shadow-2xl overflow-hidden"
            >
              <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-8 cursor-grab active:cursor-grabbing" />
              
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <Logo size={24} />
                  <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Archive Reference</h2>
                </div>
                <button 
                  disabled={isLoading}
                  onClick={() => setIsAdding(false)}
                  className="p-2 text-slate-400 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleAddLink} className="space-y-6">
                <div className="space-y-2">
                  <label htmlFor="url" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Universal Resource Link</label>
                  <div className="relative">
                    <input
                      id="url"
                      type="url"
                      placeholder="https://..."
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      required
                      autoFocus
                      className="w-full bg-slate-100 border-none rounded-xl py-4 px-4 text-base focus:ring-2 focus:ring-indigo-500 transition-all outline-none font-medium text-slate-800"
                    />
                  </div>
                </div>

                {error && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-rose-500 text-xs font-bold bg-rose-50 p-4 rounded-xl border border-rose-100 flex items-start gap-3"
                  >
                    <div className="w-5 h-5 rounded-full bg-rose-100 flex items-center justify-center shrink-0">!</div>
                    {error}
                  </motion.div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-indigo-600 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 disabled:bg-slate-300 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-100 active:scale-[0.97]"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />
                      <span className="uppercase tracking-widest text-xs">AI SYNTHESIZING...</span>
                    </>
                  ) : (
                    <span className="uppercase tracking-widest text-xs">ARCHIVE NOW</span>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
