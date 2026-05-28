import React, { useState, useEffect, useCallback } from 'react';
import { 
  Plus, 
  Search as SearchIcon, 
  X, 
  ExternalLink, 
  Hash, 
  Clock, 
  Trash2, 
  Loader2, 
  Share2, 
  LogOut, 
  User as UserIcon, 
  Activity, 
  CheckCircle,
  Database,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  signOut, 
  onAuthStateChanged,
  User,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy, 
  onSnapshot,
  updateDoc
} from 'firebase/firestore';

import { auth, db } from './lib/firebase';
import { Link } from './types';
import { cn } from './lib/utils';
import { Logo } from './components/Logo';

type TabType = 'library' | 'process' | 'explore' | 'prefs';

export default function App() {
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loadingAuthAction, setLoadingAuthAction] = useState(false);

  // Tab State
  const [activeTab, setActiveTab] = useState<TabType>('library');

  // App logic state
  const [links, setLinks] = useState<Link[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingLinks, setPendingLinks] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('pending_links');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [isProcessingPending, setIsProcessingPending] = useState(false);
  const [reprocessingLinkId, setReprocessingLinkId] = useState<string | null>(null);

  // Listen to network online status dynamically
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

  // Listen for Auth changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  // Synchronize Firestore links in real-time when logged in
  useEffect(() => {
    if (!user) {
      setLinks([]);
      return;
    }

    const q = query(
      collection(db, 'users', user.uid, 'links'),
      orderBy('created_at', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedLinks: Link[] = [];
      snapshot.forEach((doc) => {
        fetchedLinks.push({ id: doc.id, ...doc.data() } as Link);
      });
      setLinks(fetchedLinks);
    }, (err) => {
      console.error('Firestore subscription error:', err);
    });

    return unsubscribe;
  }, [user]);

  // Persist pending offline links
  useEffect(() => {
    try {
      localStorage.setItem('pending_links', JSON.stringify(pendingLinks));
    } catch (err) {
      console.error('Failed to save pending links to storage:', err);
    }
  }, [pendingLinks]);

  // Handle share target redirect & cache it if user is not logged in yet
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get('url');
    const textParam = params.get('text');
    
    // Find the URL (could be in urlParam, or in textParam)
    const rawUrl = urlParam || textParam || '';
    const match = rawUrl.match(/https?:\/\/[^\s]+/);
    const shared = match ? match[0] : '';

    if (shared) {
      localStorage.setItem('shared_url_pending', shared);
      // Clean up URL parameters
      window.history.replaceState({}, '', '/');
    }
  }, []);

  // Pop pending shared URL once user logs in
  useEffect(() => {
    if (user) {
      const pendingShared = localStorage.getItem('shared_url_pending');
      if (pendingShared) {
        setNewUrl(pendingShared);
        setIsAdding(true);
        localStorage.removeItem('shared_url_pending');
      }
    }
  }, [user]);

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setLoadingAuthAction(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error('Google Auth error:', err);
      if (err.code === 'auth/popup-closed-by-user') {
        setAuthError('Sign-in popup was closed before completing. Please try again.');
      } else {
        setAuthError(err.message || 'Failed to sign in with Google.');
      }
    } finally {
      setLoadingAuthAction(false);
    }
  };

  const handleSignOut = async () => {
    if (!confirm('Are you sure you want to sign out?')) return;
    try {
      await signOut(auth);
      setActiveTab('library');
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  const handleAddLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl || !user) return;
    
    setIsLoading(true);
    setError(null);

    // If offline, queue immediately in pending local storage
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
      // 1. Get Firebase ID token and call Go backend
      const idToken = await user.getIdToken();
      const resp = await fetch('/api/links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ url: newUrl })
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to analyze URL');
      }

      const analysis = await resp.json();

      // 2. Save directly to user's Firestore collection
      await addDoc(collection(db, 'users', user.uid, 'links'), {
        url: newUrl,
        title: analysis.title || newUrl,
        description: analysis.description || '',
        tags: analysis.tags || [],
        created_at: analysis.created_at || new Date().toISOString()
      });
      
      setNewUrl('');
      setIsAdding(false);
    } catch (err: any) {
      console.error('Failed to add link:', err);
      setError(err.message || 'Failed to process link. Saving as offline pending link.');
      // Fallback: Queue as offline pending link
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
    if (pendingLinks.length === 0 || !user) return;
    if (!navigator.onLine) {
      setError('You are currently offline. Please connect to the internet to process pending links!');
      return;
    }
    
    setIsProcessingPending(true);
    setError(null);
    const successfullyProcessed: string[] = [];
    
    const idToken = await user.getIdToken();
    for (const url of pendingLinks) {
      try {
        const resp = await fetch('/api/links', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({ url })
        });
        
        if (!resp.ok) {
          console.error(`Failed to process: ${url}`);
          continue;
        }

        const analysis = await resp.json();
        
        await addDoc(collection(db, 'users', user.uid, 'links'), {
          url,
          title: analysis.title || url,
          description: analysis.description || '',
          tags: analysis.tags || [],
          created_at: analysis.created_at || new Date().toISOString()
        });
        successfullyProcessed.push(url);
      } catch (err) {
        console.error(`Connection error processing: ${url}`, err);
        break; // Stop and retry later on subsequent connection
      }
    }
    
    setPendingLinks(prev => prev.filter(item => !successfullyProcessed.includes(item)));
    setIsProcessingPending(false);
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    if (!confirm('Are you sure you want to delete this link?')) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'links', id));
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const handleReprocess = async (link: Link) => {
    if (!user) return;
    if (!navigator.onLine) {
      alert('You are currently offline. Please connect to the internet to reprocess links!');
      return;
    }

    setReprocessingLinkId(link.id);
    try {
      const idToken = await user.getIdToken();
      const resp = await fetch('/api/links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ url: link.url })
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to reprocess link');
      }

      const analysis = await resp.json();

      await updateDoc(doc(db, 'users', user.uid, 'links', link.id), {
        title: analysis.title || link.url,
        description: analysis.description || '',
        tags: analysis.tags || []
      });
    } catch (err: any) {
      console.error('Failed to reprocess link:', err);
      alert(err.message || 'Failed to reprocess link.');
    } finally {
      setReprocessingLinkId(null);
    }
  };

  // Perform client-side filtering on links matching search query
  const filteredLinks = links.filter((link) => {
    const q = searchQuery.toLowerCase();
    return (
      link.title.toLowerCase().includes(q) ||
      link.description.toLowerCase().includes(q) ||
      link.tags.some(t => t.toLowerCase().includes(q)) ||
      link.url.toLowerCase().includes(q)
    );
  });

  // Calculate unique tags & counts for Explore tab
  const getTagsData = () => {
    const counts: { [key: string]: number } = {};
    links.forEach(l => {
      l.tags.forEach(tag => {
        const clean = tag.replace(/\s+/g, '').toLowerCase();
        counts[clean] = (counts[clean] || 0) + 1;
      });
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  };

  if (authLoading) {
    return (
      <div className="min-h-dvh bg-slate-50 flex flex-col items-center justify-center">
        <Logo size={48} className="animate-pulse" />
        <Loader2 className="animate-spin text-indigo-600 mt-6" size={24} />
      </div>
    );
  }

  // Authentication Interface
  if (!user) {
    return (
      <div className="min-h-dvh bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans px-4">
        <div className="sm:mx-auto sm:w-full sm:max-w-md flex flex-col items-center">
          <Logo size={48} className="mb-4" />
          <h2 className="text-center text-3xl font-black tracking-tight text-slate-800">
            Welcome to LinkVault
          </h2>
          <p className="mt-2 text-center text-sm text-slate-500 font-medium max-w-xs">
            Securely store and organize your links with Gemini AI analysis.
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-4 shadow-xl shadow-slate-200/50 rounded-2xl border border-slate-200/80 sm:px-10 flex flex-col items-center">
            
            {authError && (
              <div className="w-full text-rose-500 text-xs font-semibold bg-rose-50 p-3.5 rounded-xl border border-rose-100 flex items-start gap-2.5 mb-5">
                <span className="font-bold shrink-0">⚠️</span>
                <span>{authError}</span>
              </div>
            )}

            <button
              onClick={handleGoogleSignIn}
              disabled={loadingAuthAction}
              className="w-full bg-white hover:bg-slate-50 text-slate-700 font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-3 transition-all border border-slate-200/80 shadow-xs hover:shadow-md active:scale-[0.98] disabled:opacity-50"
            >
              {loadingAuthAction ? (
                <Loader2 className="animate-spin text-indigo-600" size={18} />
              ) : (
                <>
                  <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span className="text-sm tracking-wide text-slate-700 font-medium">
                    Sign in with Google
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Main Dashboard App
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
        
        {/* Search Bar - only shown on Library or Explore tabs */}
        {(activeTab === 'library' || activeTab === 'explore') && (
          <div className="mt-4 relative">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <SearchIcon className="w-4 h-4 text-slate-400" strokeWidth={2.5} />
            </div>
            <input 
              type="text" 
              placeholder={`Search ${links.length || ''} links...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-100 border-none rounded-lg py-2.5 pl-10 pr-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-shadow placeholder:text-slate-400 font-medium"
            />
          </div>
        )}
      </header>

      {/* Content Area */}
      <main className="flex-1 overflow-y-auto pb-24">
        {/* Connection Notifications */}
        {!isOnline && (
          <div className="mx-4 mt-4">
            <div className="bg-slate-800 rounded-xl p-4 flex items-center justify-between shadow-xs border border-slate-700/50">
              <div>
                <p className="text-white font-semibold text-sm">Offline Mode Active</p>
                <p className="text-slate-300 text-xs">Viewing cache; saves will be queued locally</p>
              </div>
              <div className="w-2.5 h-2.5 bg-amber-400 rounded-full animate-pulse" />
            </div>
          </div>
        )}

        {/* Global Pending Queue Banner (on Library) */}
        {activeTab === 'library' && pendingLinks.length > 0 && (
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
                    {isProcessingPending ? 'AI is generating metadata...' : 'Tap below to batch sync with Gemini AI'}
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

        {/* Dynamic Tab Views */}
        <AnimatePresence mode="wait">
          {activeTab === 'library' && (
            <motion.div
              key="library"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-6 px-4 space-y-4"
            >
              <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] px-1">
                {searchQuery ? 'Search Results' : 'Recent Saves'}
              </h2>
              
              <div className="space-y-4">
                <AnimatePresence mode="popLayout">
                  {filteredLinks.map((link) => (
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
                          </div>
                          <p className="text-[11px] font-medium text-slate-400 truncate mb-2">
                            {(() => {
                              try {
                                return new URL(link.url).hostname;
                              } catch {
                                return link.url;
                              }
                            })()}
                          </p>
                          <p className="text-sm text-slate-600 line-clamp-2 leading-relaxed font-normal">
                            {link.description}
                          </p>
                          <div className="flex flex-wrap gap-2 mt-4">
                            {link.tags.map((tag) => (
                              <span 
                                key={tag} 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSearchQuery(tag);
                                }}
                                className="text-[10px] font-bold bg-slate-100 hover:bg-indigo-50 text-slate-500 hover:text-indigo-600 px-2.5 py-1 rounded-md border border-slate-200/40 transition-colors"
                              >
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
                            title="Open link"
                          >
                            <ExternalLink size={18} />
                          </a>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleReprocess(link); }}
                            disabled={reprocessingLinkId === link.id}
                            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors disabled:opacity-50"
                            title="Reprocess with Gemini AI"
                          >
                            {reprocessingLinkId === link.id ? (
                              <Loader2 size={18} className="animate-spin text-indigo-600" />
                            ) : (
                              <RefreshCw size={18} />
                            )}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(link.id); }}
                            className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Delete link"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {filteredLinks.length === 0 && (
                  <div className="text-center py-20 bg-slate-100/50 rounded-2xl border border-dashed border-slate-200 mx-1">
                    <p className="text-slate-400 text-sm font-medium italic">
                      {searchQuery ? 'No matching records found' : 'Your link vault is currently empty'}
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'process' && (
            <motion.div
              key="process"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-6 px-4 space-y-5"
            >
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
                <h3 className="font-extrabold text-slate-800 text-lg mb-1 flex items-center gap-2">
                  <Database size={20} className="text-indigo-600" />
                  Offline Sync Queue
                </h3>
                <p className="text-slate-500 text-xs leading-relaxed font-medium">
                  When you save links without internet access, LinkVault queues them locally.
                  Once you reconnect, tap <b>Process Queue</b> below to trigger the Gemini AI title generation, summarizing, and tag generation pipeline.
                </p>
              </div>

              {pendingLinks.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      {pendingLinks.length} Queue Items
                    </span>
                    <button
                      onClick={processPendingLinks}
                      disabled={isProcessingPending}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black py-2 px-4 rounded-lg tracking-wider transition-colors active:scale-95 disabled:opacity-50"
                    >
                      {isProcessingPending ? 'SYNCING QUEUE...' : 'PROCESS QUEUE'}
                    </button>
                  </div>

                  <div className="space-y-3">
                    {pendingLinks.map((url, i) => (
                      <div 
                        key={url + i} 
                        className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between shadow-xs"
                      >
                        <div className="min-w-0 flex-1 pr-4">
                          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">Queue ID #{i+1}</p>
                          <p className="text-sm font-semibold text-slate-800 truncate leading-relaxed">{url}</p>
                        </div>
                        <button
                          onClick={() => setPendingLinks(prev => prev.filter((_, idx) => idx !== i))}
                          className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors shrink-0"
                        >
                          <X size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-20 bg-slate-100/50 rounded-2xl border border-dashed border-slate-200 mx-1 flex flex-col items-center justify-center p-6">
                  <CheckCircle size={36} className="text-emerald-500 mb-3" />
                  <p className="text-slate-700 font-bold text-sm">Everything is Synced</p>
                  <p className="text-slate-400 text-xs max-w-xs mt-1 leading-relaxed">
                    All your saved links have successfully been enriched by Gemini AI and synced to Google Firestore.
                  </p>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'explore' && (
            <motion.div
              key="explore"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-6 px-4 space-y-6"
            >
              {/* Stats Card */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Saves</span>
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="text-4xl font-black text-slate-800">{links.length}</span>
                    <span className="text-slate-400 text-xs font-semibold">Total</span>
                  </div>
                </div>
                
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tags</span>
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="text-4xl font-black text-slate-800">{getTagsData().length}</span>
                    <span className="text-slate-400 text-xs font-semibold">Unique</span>
                  </div>
                </div>
              </div>

              {/* Tag Cloud */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
                <h3 className="font-extrabold text-slate-800 text-sm uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Activity size={16} className="text-indigo-600" />
                  Tag Frequency Cloud
                </h3>
                
                {getTagsData().length > 0 ? (
                  <div className="flex flex-wrap gap-2.5">
                    {getTagsData().map(([tag, count]) => (
                      <button
                        key={tag}
                        onClick={() => {
                          setSearchQuery(tag);
                          setActiveTab('library');
                        }}
                        className="flex items-center gap-1.5 bg-slate-50 hover:bg-indigo-50 border border-slate-200/60 rounded-xl px-3.5 py-1.5 transition-all text-left"
                      >
                        <span className="text-xs font-bold text-slate-600 hover:text-indigo-700">#{tag}</span>
                        <span className="bg-slate-200/70 text-slate-500 text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                          {count}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-400 text-xs font-medium italic text-center py-6">
                    Save links with tags to build your Explore view.
                  </p>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'prefs' && (
            <motion.div
              key="prefs"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-6 px-4 space-y-6"
            >
              {/* User Profile Card */}
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs relative overflow-hidden">
                <div className="absolute right-0 top-0 w-24 h-24 bg-indigo-50 rounded-full translate-x-8 -translate-y-8 opacity-40 shrink-0" />
                <div className="flex items-center gap-4 relative z-10">
                  <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 shadow-sm shrink-0">
                    <UserIcon size={24} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-extrabold text-slate-800 text-lg truncate leading-snug">Active Account</h3>
                    <p className="text-slate-500 text-sm truncate font-medium mt-0.5">{user.email}</p>
                  </div>
                </div>

                <div className="mt-6 pt-5 border-t border-slate-100 grid grid-cols-2 gap-4 text-xs font-semibold">
                  <div>
                    <p className="text-slate-400 uppercase tracking-widest text-[9px]">User ID</p>
                    <p className="text-slate-700 font-bold truncate mt-1">{user.uid}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 uppercase tracking-widest text-[9px]">Auth Mode</p>
                    <p className="text-slate-700 font-bold mt-1">Firebase Core</p>
                  </div>
                </div>
              </div>

              {/* Cloud Sync Database Status */}
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
                <h4 className="font-black text-slate-800 text-sm uppercase tracking-wider">Cloud Data Source</h4>
                
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 font-semibold">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-slate-600">Google Firestore Storage</span>
                  </div>
                  <span className="bg-emerald-100 text-emerald-800 font-extrabold px-2 py-0.5 rounded text-[9px] uppercase tracking-wider">Connected</span>
                </div>

                <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-100">
                  <span className="text-slate-400 font-medium">Local Index Cache</span>
                  <span className="text-slate-700 font-bold uppercase tracking-wider">IndexedDB Persisted</span>
                </div>
              </div>

              {/* Actions Card */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center justify-center gap-2.5 bg-rose-50 hover:bg-rose-100/70 border border-rose-100 text-rose-600 font-extrabold py-3.5 rounded-xl transition-all active:scale-[0.98]"
                >
                  <LogOut size={18} />
                  <span className="uppercase tracking-widest text-xs">Sign Out of LinkVault</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Navigation */}
      <nav className="bg-white border-t border-slate-200 h-20 flex items-center justify-around px-6 fixed bottom-0 left-0 right-0 z-50 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <button 
          onClick={() => setActiveTab('library')}
          className={cn(
            "flex flex-col items-center gap-1.5 transition-transform active:scale-90",
            activeTab === 'library' ? "text-indigo-600 font-extrabold" : "text-slate-400"
          )}
        >
          <Clock size={22} strokeWidth={activeTab === 'library' ? 2.5 : 2} />
          <span className="text-[10px] font-bold uppercase tracking-wider">Library</span>
        </button>
        <button 
          onClick={() => setActiveTab('process')}
          className={cn(
            "flex flex-col items-center gap-1.5 transition-transform active:scale-90 relative",
            activeTab === 'process' ? "text-indigo-600 font-extrabold" : "text-slate-400"
          )}
        >
          <Share2 size={22} strokeWidth={activeTab === 'process' ? 2.5 : 2} />
          {pendingLinks.length > 0 && (
            <span className="absolute -top-1 -right-1.5 w-4 h-4 bg-indigo-600 text-white rounded-full flex items-center justify-center text-[9px] font-black animate-none">
              {pendingLinks.length}
            </span>
          )}
          <span className="text-[10px] font-bold uppercase tracking-wider">Process</span>
        </button>
        <button 
          onClick={() => setActiveTab('explore')}
          className={cn(
            "flex flex-col items-center gap-1.5 transition-transform active:scale-90",
            activeTab === 'explore' ? "text-indigo-600 font-extrabold" : "text-slate-400"
          )}
        >
          <SearchIcon size={22} strokeWidth={activeTab === 'explore' ? 2.5 : 2} />
          <span className="text-[10px] font-bold uppercase tracking-wider">Explore</span>
        </button>
        <button 
          onClick={() => setActiveTab('prefs')}
          className={cn(
            "flex flex-col items-center gap-1.5 transition-transform active:scale-90",
            activeTab === 'prefs' ? "text-indigo-600 font-extrabold" : "text-slate-400"
          )}
        >
          <Hash size={22} strokeWidth={activeTab === 'prefs' ? 2.5 : 2} />
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
