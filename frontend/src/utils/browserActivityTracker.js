/**
 * Enhanced Browser Activity Tracker
 * Tracks user browser interactions to provide context for chatbot responses
 * Includes toggle functionality and enhanced tracking capabilities
 */

class BrowserActivityTracker {
  constructor(userId) {
    this.userId = userId;
    this.storageKey = `browserActivity_${userId}`;
    this.settingsKey = `browserTracker_${userId}_settings`;
    this.maxActivities = 200; // Increased limit for better context
    this.isTracking = false;
    this.isEnabled = false; // New: track if tracking is enabled by user
    this.activityBuffer = [];
    this.debounceTimeout = null;
    this.listeners = new Map(); // Store event listeners for cleanup
    this.syncTimeout = null; // For batching server syncs
    this.pendingSync = false; // Track if sync is in progress
    this.syncInterval = 30000; // Sync every 30 seconds
    this.lastSyncTime = 0;
    this.apiBaseUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000';
    
    // Cross-tab tracking enhancements
    this.tabId = this.generateTabId();
    this.sessionId = this.getSessionId();
    this.crossTabSyncKey = `crossTabSync_${userId}`;
    this.extensionConnected = false; // Track if browser extension is connected
    
    // Load settings but DO NOT auto-start tracking
    // User must explicitly enable tracking via the UI
    this.loadSettings();
    
    // Automatically cleanup old activities on startup to prevent accumulation
    setTimeout(() => {
      this.cleanupStoredActivities();
    }, 1000);
    
    console.log(`🔧 BrowserActivityTracker initialized for user ${userId}. Tracking enabled: ${this.isEnabled}, but NOT auto-starting.`);
    
    // Improved sync scheduling with max wait guarantee
    this.syncDebounceTimer = null;
    this.maxWaitTimer = null;
    this.syncDebounceDelay = 2000; // 2 seconds for efficiency
    this.maxSyncWait = 8000; // 8 seconds maximum wait (guaranteed sync)
    this.lastScheduledSyncTime = 0;
  }

  /**
   * Generate unique tab ID for cross-tab tracking
   */
  generateTabId() {
    return `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Load tracking settings from localStorage
   */
  loadSettings() {
    try {
      const settings = localStorage.getItem(this.settingsKey);
      if (settings) {
        const parsed = JSON.parse(settings);
        // Explicitly check for boolean true - anything else is disabled
        this.isEnabled = parsed.isEnabled === true;
        console.log(`📋 Loaded tracking preference: ${this.isEnabled} from ${this.settingsKey}`);
      } else {
        // Default to disabled for privacy - user must explicitly enable
        this.isEnabled = false;
        this.saveSettings();
        console.log(`📋 No tracking preference found, defaulting to disabled for privacy`);
      }
    } catch (error) {
      console.error('Error loading tracking settings:', error);
      // Always default to disabled on error
      this.isEnabled = false;
      this.saveSettings();
    }
  }

  /**
   * Save tracking settings to localStorage
   */
  saveSettings() {
    try {
      const settings = {
        isEnabled: this.isEnabled,
        lastUpdated: new Date().toISOString()
      };
      localStorage.setItem(this.settingsKey, JSON.stringify(settings));
    } catch (error) {
      console.error('Error saving tracking settings:', error);
    }
  }

  /**
   * Enable tracking with server sync
   */
  enableTracking() {
    this.isEnabled = true;
    this.saveSettings();
    
    // Force save to ensure persistence
    console.log(`🟢 Browser tracking enabled by user. Settings saved: ${JSON.stringify({
      isEnabled: this.isEnabled,
      userId: this.userId,
      settingsKey: this.settingsKey
    })}`);
    
    if (!this.isTracking) {
      this.startTracking();
      this.startPeriodicSync();
    }
    
    // Schedule a sync instead of immediate sync to prevent duplicates
    console.log('📅 Scheduling sync after tracking enabled');
    this.scheduleServerSync();
    
    console.log('Enhanced browser tracking with cross-tab support enabled');
  }

  /**
   * Disable tracking with final server sync
   */
  disableTracking() {
    this.isEnabled = false;
    this.saveSettings();
    
    // Force save to ensure persistence
    console.log(`🔴 Browser tracking disabled by user. Settings saved: ${JSON.stringify({
      isEnabled: this.isEnabled,
      userId: this.userId,
      settingsKey: this.settingsKey
    })}`);
    
    // Perform final sync before disabling
    if (this.isTracking) {
      this.syncWithServer().finally(() => {
        this.stopTracking();
      });
    }
    
    console.log('Enhanced browser tracking disabled');
  }

  /**
   * Check if tracking is enabled
   */
  isTrackingEnabled() {
    return this.isEnabled;
  }

  /**
   * Check if tracking is currently active (running)
   */
  get isTrackingActive() {
    return this.isTracking;
  }

  /**
   * Set extension connection status
   */
  setExtensionConnected(connected) {
    this.extensionConnected = connected;
    console.log(`🤖 Browser extension ${connected ? 'connected' : 'disconnected'}`);
    
    // If extension is connected, it will handle cross-site tracking
    // Local tracker can focus on current tab activities
    if (connected) {
      this.saveSettings(); // Save the extension connection state
    }
  }
  
  /**
   * Check if extension is connected
   */
  isExtensionConnected() {
    return this.extensionConnected;
  }

  /**
   * Start tracking activities
   */
  startTracking() {
    if (this.isTracking || !this.isEnabled) return;
    
    this.isTracking = true;
    
    // Create bound methods for proper cleanup
    const boundMethods = {
      handleVisibilityChange: this.handleVisibilityChange.bind(this),
      handleClick: this.handleClick.bind(this),
      handleKeydown: this.handleKeydown.bind(this),
      handleScroll: this.handleScroll.bind(this),
      handleFocus: this.handleFocus.bind(this),
      handleBlur: this.handleBlur.bind(this),
      handleHashChange: this.handleHashChange.bind(this),
      handleBeforeUnload: this.handleBeforeUnload.bind(this)
    };

    // Store bound methods for cleanup
    this.listeners = boundMethods;
    
    // Add event listeners
    document.addEventListener('visibilitychange', boundMethods.handleVisibilityChange);
    document.addEventListener('click', boundMethods.handleClick);
    document.addEventListener('keydown', boundMethods.handleKeydown);
    document.addEventListener('scroll', boundMethods.handleScroll, { passive: true });
    window.addEventListener('focus', boundMethods.handleFocus);
    window.addEventListener('blur', boundMethods.handleBlur);
    window.addEventListener('hashchange', boundMethods.handleHashChange);
    window.addEventListener('beforeunload', boundMethods.handleBeforeUnload);
    
    // Setup cross-tab tracking
    this.setupCrossTabListener();
    
    // Track URL changes for SPAs
    this.trackUrlChanges();
    
    // Log initial activity
    this.logActivity('tracking_started', {
      url: window.location.href,
      title: document.title,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      tab_id: this.tabId,
      session_id: this.sessionId
    });
  }

  /**
   * Enhanced URL change tracking with search query capture
   */
  trackUrlChanges() {
    let currentUrl = window.location.href;
    let currentTitle = document.title;
    
    // Check for search query on initial load
    const initialQuery = this.extractSearchQuery(currentUrl, currentTitle);
    if (initialQuery) {
      this.storeSearchQuery(initialQuery, currentUrl);
    }
    
    const checkUrlChange = () => {
      const newUrl = window.location.href;
      const newTitle = document.title;
      
      if (newUrl !== currentUrl || newTitle !== currentTitle) {
        // Check for search queries in the new URL
        const searchQuery = this.extractSearchQuery(newUrl, newTitle);
        if (searchQuery) {
          console.log(`🔍 Auto-captured search query from URL change: "${searchQuery}"`);
          this.storeSearchQuery(searchQuery, newUrl);
        }
        
        this.logActivity('navigation', {
          previousUrl: currentUrl,
          newUrl: newUrl,
          previousTitle: currentTitle,
          newTitle: newTitle,
          navigationType: 'spa_navigation',
          hasSearchQuery: !!searchQuery,
          searchQuery: searchQuery || null,
          timestamp: new Date().toISOString()
        });
        
        currentUrl = newUrl;
        currentTitle = newTitle;
      }
    };
    
    // Check for URL changes periodically
    this.urlCheckInterval = setInterval(checkUrlChange, 1000);
    
    // Also listen to popstate for back/forward navigation
    const handlePopState = () => {
      setTimeout(checkUrlChange, 100);
    };
    window.addEventListener('popstate', handlePopState);
    this.listeners.handlePopState = handlePopState;
  }

  /**
   * Enhanced click tracking with better search detection
   */
  handleClick(event) {
    if (!this.isEnabled) return;
    
    const target = event.target;
    const tagName = target.tagName.toLowerCase();
    const className = target.className ? target.className.toString() : '';
    const id = target.id || '';
    const text = target.textContent ? target.textContent.slice(0, 100) : '';
    const href = target.href || '';
    
    // Enhanced exclusion list for chat UI elements
    if (target.closest('.chat-input') || 
        target.closest('[data-no-track]') ||
        target.closest('.password-field') ||
        target.closest('.sensitive-data') ||
        target.closest('.message-bubble') ||
        target.closest('.message-actions') ||
        target.closest('.copy-button') ||
        target.closest('.regenerate-button') ||
        target.closest('.subchat-button') ||
        target.closest('.MuiIconButton-root') ||
        target.closest('.MuiButton-root') ||
        target.closest('.MuiDialog-root') ||
        target.closest('.MuiMenu-root') ||
        target.closest('.chat-interface') ||
        target.closest('[role="dialog"]') ||
        target.closest('[role="menu"]') ||
        className.includes('MuiIconButton') ||
        className.includes('MuiButton') ||
        className.includes('chat-') ||
        className.includes('message-') ||
        id.includes('chat') ||
        id.includes('message') ||
        // Exclude localhost/internal navigation
        (href && (href.includes('localhost') || href.startsWith('/') || href.startsWith('#')))) {
      console.log('🚫 Skipping internal UI click:', { tagName, className, id, text: text.slice(0, 30) });
      return;
    }
    
    // Only track external links and search-related activities
    const isExternalLink = href && (href.startsWith('http') && !href.includes('localhost'));
    const isSearchRelated = this.detectSearchActivity(href, text, className, id, target);
    
    // Skip non-search internal activities
    if (!isExternalLink && !isSearchRelated) {
      return;
    }
    
    // Enhanced click data for meaningful interactions only
    const clickData = {
      element: tagName,
      className: className,
      id,
      text,
      href,
      url: window.location.href,
      pageTitle: document.title,
      isSearchRelated: isSearchRelated,
      isExternalLink: isExternalLink,
      searchContext: isSearchRelated ? this.getSearchContext(target) : null,
      coordinates: {
        x: event.clientX,
        y: event.clientY,
        pageX: event.pageX,
        pageY: event.pageY
      },
      timestamp: new Date().toISOString()
    };
    
    console.log('✅ Tracking meaningful click:', { isSearchRelated, isExternalLink, href, text: text.slice(0, 30) });
    this.logActivity('click', clickData);
  }

  /**
   * Enhanced search activity detection with query extraction
   */
  detectSearchActivity(href, text, className, id, target) {
    // Check if current page is a search page and extract query
    const currentUrl = window.location.href;
    const currentTitle = document.title;
    const searchQuery = this.extractSearchQuery(currentUrl, currentTitle);
    
    if (searchQuery) {
      // Store the search query for context
      this.storeSearchQuery(searchQuery, currentUrl);
      return true;
    }
    
    // Search indicators in href
    const searchUrlPatterns = [
      'search', 'query', 'find', '?q=', '&q=', '?s=', '&s=',
      '?keyword=', '?term=', 'results', '/q/', 'google.com/search'
    ];
    
    // Search indicators in text
    const searchTextPatterns = [
      'search', 'find', 'look for', 'query', 'results', 'more info',
      'learn more', 'explore', 'discover', 'see more'
    ];
    
    // Search indicators in CSS classes/IDs
    const searchCssPatterns = [
      'search', 'query', 'find', 'lookup', 'explore', 'result',
      'suggestion', 'autocomplete', 'dropdown'
    ];
    
    // Check href and extract query if found
    if (href && searchUrlPatterns.some(pattern => 
        href.toLowerCase().includes(pattern))) {
      const queryFromHref = this.extractSearchQuery(href);
      if (queryFromHref) {
        this.storeSearchQuery(queryFromHref, href);
      }
      return true;
    }
    
    // Check text content
    if (text && searchTextPatterns.some(pattern => 
        text.toLowerCase().includes(pattern))) {
      return true;
    }
    
    // Check CSS classes and ID
    const cssString = (className + ' ' + id).toLowerCase();
    if (searchCssPatterns.some(pattern => cssString.includes(pattern))) {
      return true;
    }
    
    // Check if it's a search input or button
    if (target.type === 'search' || 
        (target.type === 'submit' && target.form?.querySelector('input[type="search"]'))) {
      return true;
    }
    
    // Check parent elements for search context
    let parent = target.parentElement;
    let depth = 0;
    while (parent && depth < 3) {
      const parentClass = parent.className?.toString().toLowerCase() || '';
      const parentId = parent.id?.toLowerCase() || '';
      
      if (searchCssPatterns.some(pattern => 
          (parentClass.includes(pattern) || parentId.includes(pattern)))) {
        return true;
      }
      
      parent = parent.parentElement;
      depth++;
    }
    
    return false;
  }

  /**
   * Extract search query from URL or page title
   */
  extractSearchQuery(url, title = '') {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.toLowerCase();
      
      // Google search
      if (domain.includes('google.com')) {
        const q = urlObj.searchParams.get('q');
        if (q) return q.trim();
      }
      
      // Bing search
      if (domain.includes('bing.com')) {
        const q = urlObj.searchParams.get('q');
        if (q) return q.trim();
      }
      
      // DuckDuckGo
      if (domain.includes('duckduckgo.com')) {
        const q = urlObj.searchParams.get('q');
        if (q) return q.trim();
      }
      
      // Yahoo search
      if (domain.includes('yahoo.com')) {
        const p = urlObj.searchParams.get('p') || urlObj.searchParams.get('q');
        if (p) return p.trim();
      }
      
      // Yandex
      if (domain.includes('yandex.com')) {
        const text = urlObj.searchParams.get('text');
        if (text) return text.trim();
      }
      
      // Generic search parameters
      const commonParams = ['q', 'query', 'search', 's', 'keyword', 'term', 'find'];
      for (const param of commonParams) {
        const value = urlObj.searchParams.get(param);
        if (value && value.trim()) {
          return value.trim();
        }
      }
      
      // Extract from title for search results pages
      if (title) {
        // Google: "search term - Google Search"
        const googleMatch = title.match(/^(.+?)\s*-\s*Google Search$/i);
        if (googleMatch) return googleMatch[1].trim();
        
        // Bing: "search term - Bing"
        const bingMatch = title.match(/^(.+?)\s*-\s*Bing$/i);
        if (bingMatch) return bingMatch[1].trim();
        
        // DuckDuckGo: "search term at DuckDuckGo"
        const duckMatch = title.match(/^(.+?)\s*at DuckDuckGo$/i);
        if (duckMatch) return duckMatch[1].trim();
        
        // Generic: "search term - Search Results"
        const genericMatch = title.match(/^(.+?)\s*-\s*(Search|Results)/i);
        if (genericMatch) return genericMatch[1].trim();
      }
      
    } catch (error) {
      console.warn('Error extracting search query:', error);
    }
    
    return null;
  }

  /**
   * Store search query for AI context
   */
  storeSearchQuery(query, url) {
    if (!query || query.length < 2) return;
    
    const searchEntry = {
      query: query,
      url: url,
      domain: this.extractDomain(url),
      timestamp: new Date().toISOString(),
      sessionId: this.getSessionId(),
      tabId: this.tabId
    };
    
    // Store in separate search queries storage
    try {
      const searchKey = `searchQueries_${this.userId}`;
      const existing = JSON.parse(localStorage.getItem(searchKey) || '[]');
      
      // Add new search query at the beginning
      existing.unshift(searchEntry);
      
      // Keep only last 50 search queries
      const recent = existing.slice(0, 50);
      
      localStorage.setItem(searchKey, JSON.stringify(recent));
      
      console.log(`🔍 Captured search query: "${query}" from ${searchEntry.domain}`);
      
      // Also log as special search activity
      this.logActivity('search_query_captured', {
        searchQuery: query,
        searchDomain: searchEntry.domain,
        searchUrl: url,
        extractedFrom: 'url_analysis',
        isMainSearchQuery: true,
        timestamp: searchEntry.timestamp
      });
      
    } catch (error) {
      console.error('Error storing search query:', error);
    }
  }

  /**
   * Get search context from the click target
   */
  getSearchContext(target) {
    // Try to find search input value
    const searchInput = target.form?.querySelector('input[type="search"]') ||
                       target.form?.querySelector('input[name*="search"]') ||
                       target.form?.querySelector('input[name*="q"]') ||
                       target.form?.querySelector('input[name*="query"]') ||
                       document.querySelector('input[type="search"]');
    
    if (searchInput && searchInput.value) {
      return {
        searchTerm: searchInput.value,
        searchType: 'form_search'
      };
    }
    
    // Check if it's a result link
    const linkText = target.textContent?.trim().slice(0, 100);
    if (linkText && target.href) {
      return {
        resultText: linkText,
        resultUrl: target.href,
        searchType: 'search_result_click'
      };
    }
    
    return {
      searchType: 'search_interaction'
    };
  }

  /**
   * Enhanced keydown tracking
   */
  handleKeydown(event) {
    if (!this.isEnabled) return;
    
    const importantKeys = [
      'Tab', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'
    ];
    
    // Track search-related key combinations
    const isSearchShortcut = (event.ctrlKey || event.metaKey) && 
                            (event.key === 'f' || event.key === 'F' || event.key === 'k' || event.key === 'K');
    
    if (importantKeys.includes(event.key) || isSearchShortcut) {
      this.logActivity('key_navigation', {
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        isSearchShortcut: isSearchShortcut,
        url: window.location.href,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Enhanced scroll tracking with reading progress
   */
  handleScroll() {
    if (!this.isEnabled) return;
    
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
    
    this.debounceTimeout = setTimeout(() => {
      const scrollPosition = window.pageYOffset || document.documentElement.scrollTop;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const scrollPercent = Math.round((scrollPosition / maxScroll) * 100);
      
      // Calculate reading speed/engagement
      const now = Date.now();
      const timeSinceLastScroll = this.lastScrollTime ? now - this.lastScrollTime : 0;
      this.lastScrollTime = now;
      
      this.logActivity('scroll', {
        position: scrollPosition,
        percent: scrollPercent,
        maxScroll: maxScroll,
        scrollSpeed: timeSinceLastScroll > 0 ? Math.abs(scrollPosition - (this.lastScrollPosition || 0)) / timeSinceLastScroll : 0,
        direction: scrollPosition > (this.lastScrollPosition || 0) ? 'down' : 'up',
        url: window.location.href,
        timestamp: new Date().toISOString()
      });
      
      this.lastScrollPosition = scrollPosition;
    }, 500);
  }

  /**
   * Enhanced visibility change handler - NEVER PAUSE TRACKING
   */
  handleVisibilityChange() {
    if (!this.isEnabled) return;
    
    const isVisible = !document.hidden;
    const timeOnPage = this.calculateTimeOnPage();
    
    // Always continue tracking, even when tab is hidden
    this.logActivity('visibility_change', {
      visible: isVisible,
      url: window.location.href,
      title: document.title,
      timeOnPage: timeOnPage,
      timestamp: new Date().toISOString(),
      tabSwitched: true,
      trackingContinuous: true // Flag indicating tracking never stops
    });
    
    if (isVisible) {
      // Tab became visible - user returned to this tab
      this.resumeActiveTracking();
      this.logActivity('tab_focused', {
        url: window.location.href,
        title: document.title,
        timestamp: new Date().toISOString(),
        returnedFromBackground: true,
        timeAwayFromTab: this.backgroundStartTime ? Date.now() - this.backgroundStartTime : 0
      });
      
      // Check if URL changed while tab was hidden
      this.checkForUrlChangeWhileHidden();
      
      // Sync any background activities that might have been collected
      this.syncBackgroundActivities();
    } else {
      // Tab became hidden - but DON'T PAUSE tracking
      this.backgroundStartTime = Date.now();
      this.logActivity('tab_backgrounded', {
        url: window.location.href,
        title: document.title,
        timeOnPage: timeOnPage,
        timestamp: new Date().toISOString(),
        switchedToBackground: true,
        trackingStillActive: true // Emphasize tracking continues
      });
      
      // Start enhanced background tracking
      this.startBackgroundTracking();
      
      // Save activities immediately when tab goes to background
      this.saveActivities();
    }
  }

  /**
   * Start enhanced background tracking when tab is hidden
   */
  startBackgroundTracking() {
    if (!this.isEnabled) return;
    
    // Mark background tracking as active
    this.backgroundTrackingActive = true;
    
    // Enhanced background activity detection
    this.backgroundActivityInterval = setInterval(() => {
      if (!this.isEnabled || !this.backgroundTrackingActive) {
        clearInterval(this.backgroundActivityInterval);
        return;
      }
      
      // Track background session activity
      this.logActivity('background_session', {
        sessionDuration: this.backgroundStartTime ? Date.now() - this.backgroundStartTime : 0,
        url: window.location.href,
        title: document.title,
        timestamp: new Date().toISOString(),
        activeInBackground: true,
        trackingNeverPaused: true
      });
      
      // Check for any URL changes in this tab while in background
      this.checkForUrlChangeWhileHidden();
      
    }, 5000); // Check every 5 seconds
    
    // Store background tracking state
    this.setBackgroundTrackingFlag(true);
  }

  /**
   * Resume active tracking when tab becomes visible
   */
  resumeActiveTracking() {
    this.backgroundTrackingActive = false;
    this.backgroundStartTime = null;
    
    if (this.backgroundActivityInterval) {
      clearInterval(this.backgroundActivityInterval);
      this.backgroundActivityInterval = null;
    }
    
    // Reset page timer for accurate time tracking
    this.pageLoadTime = Date.now();
    
    // Mark as actively tracking again
    this.setBackgroundTrackingFlag(false);
  }

  /**
   * Set background tracking flag in localStorage for persistence
   */
  setBackgroundTrackingFlag(isBackground) {
    try {
      const trackingState = {
        isBackground: isBackground,
        tabId: this.getTabId(),
        timestamp: new Date().toISOString(),
        sessionId: this.getSessionId()
      };
      localStorage.setItem(`${this.storageKey}_state`, JSON.stringify(trackingState));
    } catch (error) {
      console.error('Error setting background tracking flag:', error);
    }
  }

  /**
   * Sync background activities from other tabs/sessions
   */
  syncBackgroundActivities() {
    try {
      const allTabs = this.getAllTabTrackingStates();
      const backgroundActivities = [];
      
      allTabs.forEach(tabState => {
        if (tabState.isBackground && tabState.sessionId !== this.getSessionId()) {
          // This represents activity from other tabs
          backgroundActivities.push({
            type: 'cross_tab_activity',
            data: {
              fromTabId: tabState.tabId,
              fromSessionId: tabState.sessionId,
              timestamp: tabState.timestamp,
              detectedOnReturn: true
            }
          });
        }
      });
      
      // Add background activities to current session
      backgroundActivities.forEach(activity => {
        this.logActivity(activity.type, activity.data);
      });
      
    } catch (error) {
      console.error('Error syncing background activities:', error);
    }
  }

  /**
   * Get all tab tracking states
   */
  getAllTabTrackingStates() {
    const states = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes('_state') && key.includes('browserActivity_')) {
        try {
          const state = JSON.parse(localStorage.getItem(key));
          states.push(state);
        } catch (error) {
          // Ignore invalid states
        }
      }
    }
    return states;
  }

  /**
   * Get unique tab ID for this session
   */
  getTabId() {
    if (!this.tabId) {
      this.tabId = `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    return this.tabId;
  }

  /**
   * Check for URL changes that happened while tab was hidden
   */
  checkForUrlChangeWhileHidden() {
    const currentUrl = window.location.href;
    const currentTitle = document.title;
    
    if (this.lastKnownUrl && this.lastKnownUrl !== currentUrl) {
      this.logActivity('background_navigation', {
        previousUrl: this.lastKnownUrl,
        newUrl: currentUrl,
        previousTitle: this.lastKnownTitle || '',
        newTitle: currentTitle,
        timestamp: new Date().toISOString(),
        detectedOnFocus: true
      });
    }
    
    this.lastKnownUrl = currentUrl;
    this.lastKnownTitle = currentTitle;
  }

  /**
   * Window focus/blur tracking
   */
  handleFocus() {
    if (!this.isEnabled) return;
    
    this.focusStartTime = Date.now();
    this.logActivity('window_focus', {
      focused: true,
      url: window.location.href,
      timestamp: new Date().toISOString()
    });
  }

  handleBlur() {
    if (!this.isEnabled) return;
    
    const focusTime = this.focusStartTime ? Date.now() - this.focusStartTime : 0;
    this.logActivity('window_focus', {
      focused: false,
      focusTime: focusTime,
      url: window.location.href,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Hash change tracking
   */
  handleHashChange() {
    if (!this.isEnabled) return;
    
    this.logActivity('hash_change', {
      oldHash: this.previousHash || '',
      newHash: window.location.hash,
      url: window.location.href,
      timestamp: new Date().toISOString()
    });
    
    this.previousHash = window.location.hash;
  }

  /**
   * Before unload tracking
   */
  handleBeforeUnload() {
    if (!this.isEnabled) return;
    
    this.logActivity('page_unload', {
      url: window.location.href,
      timeOnPage: this.calculateTimeOnPage(),
      timestamp: new Date().toISOString()
    });
    
    // Force save any pending activities
    this.saveActivities();
  }

  /**
   * Calculate time spent on current page
   */
  calculateTimeOnPage() {
    if (!this.pageLoadTime) {
      this.pageLoadTime = Date.now();
    }
    return Date.now() - this.pageLoadTime;
  }

  /**
   * Validate activity structure before storage/sync
   */
  validateActivity(activity) {
    // Required fields check
    if (!activity || typeof activity !== 'object') {
      console.warn('🚫 Invalid activity: not an object');
      return false;
    }
    
    if (!activity.type || typeof activity.type !== 'string') {
      console.warn('🚫 Invalid activity: missing or invalid type', activity);
      return false;
    }
    
    if (!activity.data || typeof activity.data !== 'object') {
      console.warn('🚫 Invalid activity: missing or invalid data', activity);
      return false;
    }
    
    if (!activity.timestamp) {
      console.warn('🚫 Invalid activity: missing timestamp', activity);
      return false;
    }
    
    // Check for reasonable activity type
    const validTypes = [
      'click', 'scroll', 'navigation', 'visibility_change', 'search', 'key_navigation',
      'tracking_started', 'tracking_stopped', 'tab_focused', 'tab_backgrounded',
      'background_session', 'cross_tab_activity', 'window_focus', 'hash_change',
      'page_unload', 'search_query_captured', 'background_navigation'
    ];
    
    if (!validTypes.includes(activity.type)) {
      console.warn('🚫 Invalid activity: unknown type', { type: activity.type, valid: validTypes });
      return false;
    }
    
    // Validate data structure
    if (activity.data) {
      // URL should be a string if present
      if (activity.data.url && typeof activity.data.url !== 'string') {
        console.warn('🚫 Invalid activity: URL is not a string', activity);
        return false;
      }
      
      // Title should be a string if present
      if (activity.data.title && typeof activity.data.title !== 'string') {
        console.warn('🚫 Invalid activity: title is not a string', activity);
        return false;
      }
    }
    
    return true;
  }

  /**
   * Enhanced activity logging with improved sync scheduling
   */
  logActivity(type, data) {
    if (!this.isEnabled) return;
    
    const now = new Date();
    const activity = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      data: {
        ...data,
        tab_id: this.tabId,
        session_id: this.sessionId,
        is_cross_tab: true,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        user_agent: navigator.userAgent.substring(0, 100),
        url: data.url || window.location.href,
        title: data.title || document.title
      },
      timestamp: now.toISOString(),
      sessionId: this.sessionId,
      tabId: this.tabId,
      userId: this.userId
    };
    
    // Validate activity before storing
    if (!this.validateActivity(activity)) {
      console.error('🚫 Activity validation failed, not storing:', { type, dataKeys: Object.keys(data || {}) });
      return;
    }
    
    this.activityBuffer.push(activity);
    
    // Store locally immediately
    this.debounceActivity();
    
    // Use improved sync scheduling
    this.scheduleServerSync();
    
    // Cross-tab sync
    this.syncWithOtherTabs(activity);
  }

  /**
   * Sync activity with other tabs for cross-tab tracking
   */
  syncWithOtherTabs(activity) {
    try {
      // Store in shared storage for other tabs to pick up
      const crossTabData = {
        activity,
        timestamp: Date.now(),
        fromTabId: this.tabId
      };
      
      localStorage.setItem(this.crossTabSyncKey, JSON.stringify(crossTabData));
      
      // Trigger storage event for other tabs
      window.dispatchEvent(new StorageEvent('storage', {
        key: this.crossTabSyncKey,
        newValue: JSON.stringify(crossTabData),
        url: window.location.href
      }));
    } catch (error) {
      console.warn('Cross-tab sync failed:', error);
    }
  }

  /**
   * Listen for cross-tab activities
   */
  setupCrossTabListener() {
    const handleStorageChange = (event) => {
      if (event.key === this.crossTabSyncKey && event.newValue) {
        try {
          const crossTabData = JSON.parse(event.newValue);
          
          // Don't process our own activities
          if (crossTabData.fromTabId === this.tabId) return;
          
          // Store cross-tab activity locally
          const activity = crossTabData.activity;
          activity.data.from_other_tab = true;
          activity.data.original_tab_id = crossTabData.fromTabId;
          
          this.activityBuffer.push(activity);
          this.debounceActivity();
        } catch (error) {
          console.warn('Failed to process cross-tab activity:', error);
        }
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    this.listeners.handleStorageChange = handleStorageChange;
  }

  /**
   * Improved sync scheduling that prevents infinite rescheduling
   */
  scheduleServerSync() {
    if (!this.isEnabled || this.activityBuffer.length === 0) {
      return;
    }

    const now = Date.now();
    
    // If we already have a max wait timer running, don't reset it
    // This ensures sync will happen within maxSyncWait no matter what
    if (!this.maxWaitTimer) {
      this.lastScheduledSyncTime = now;
      
      // Set max wait timer - this will FORCE sync after maxSyncWait
      this.maxWaitTimer = setTimeout(() => {
        console.log('🚨 Max wait timer triggered - forcing sync');
        this.clearSyncTimers();
        this.syncToServer();
      }, this.maxSyncWait);
    }

    // Clear existing debounce timer
    if (this.syncDebounceTimer) {
      clearTimeout(this.syncDebounceTimer);
    }

    // Set new debounce timer for efficiency (shorter delay)
    this.syncDebounceTimer = setTimeout(() => {
      console.log('⚡ Debounce timer triggered - syncing normally');
      this.clearSyncTimers();
      this.syncToServer();
    }, this.syncDebounceDelay);

    console.log(`📅 Sync scheduled: debounce in ${this.syncDebounceDelay}ms, max wait in ${this.maxSyncWait}ms`);
  }

  /**
   * Clear all sync timers
   */
  clearSyncTimers() {
    if (this.syncDebounceTimer) {
      clearTimeout(this.syncDebounceTimer);
      this.syncDebounceTimer = null;
    }
    
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
  }

  /**
   * Enhanced sync to server with better error handling
   */
  async syncToServer() {
    if (this.pendingSync || this.activityBuffer.length === 0) {
      return;
    }

    this.pendingSync = true;
    
    try {
      // Clear timers since we're syncing now
      this.clearSyncTimers();
      
      const activitiesToSync = [...this.activityBuffer];
      console.log(`🔄 Syncing ${activitiesToSync.length} activities to server`);
      
      const response = await fetch('/api/browser/activities', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: this.userId,
          activities: activitiesToSync
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log(`✅ Successfully synced ${result.stored_count || activitiesToSync.length} activities`);
        
        // Clear successfully synced activities
        this.activityBuffer = [];
        this.lastSyncTime = Date.now();
        
        // Update storage
        this.saveActivitiesToStorage(this.getStoredActivities().map(activity => ({
          ...activity,
          synced: true,
          syncedAt: new Date().toISOString()
        })));
        
      } else {
        console.error('❌ Failed to sync activities:', response.status);
        // Keep activities for retry
      }
      
    } catch (error) {
      console.error('❌ Sync error:', error);
      // Keep activities for retry
    } finally {
      this.pendingSync = false;
      
      // If there are still activities to sync, schedule another sync
      if (this.activityBuffer.length > 0) {
        console.log('📋 Still have activities to sync, rescheduling...');
        setTimeout(() => this.scheduleServerSync(), 5000); // Retry in 5 seconds
      }
    }
  }

  /**
   * Force immediate sync (for cleanup, page unload, etc.)
   */
  forceSyncNow() {
    console.log('🚀 Force sync requested');
    this.clearSyncTimers();
    return this.syncToServer();
  }

  /**
   * Start periodic server synchronization with intelligent sync management
   */
  startPeriodicSync() {
    // Sync every 30 seconds but only if conditions are met
    setInterval(() => {
      if (this.isEnabled && !this.pendingSync && this.shouldSync()) {
        this.syncWithServer();
      }
    }, this.syncInterval);
  }

  /**
   * Synchronize activities with the backend server with proper batching and enhanced error handling
   */
  async syncWithServer() {
    if (!this.isEnabled || this.pendingSync) {
      if (this.pendingSync) {
        console.log('⏸️ Skipping sync - another sync already in progress');
      }
      return;
    }
    
    try {
      const activities = this.getStoredActivities();
      const unsyncedActivities = activities.filter(activity => !activity.synced);
      
      if (unsyncedActivities.length === 0) {
        console.log('✅ No unsynced activities, skipping sync');
        return;
      }
      
      this.pendingSync = true;
      console.log(`🚀 Starting sync for ${unsyncedActivities.length} unsynced activities`);
      
      // Get auth token from localStorage or context
      const authToken = this.getAuthToken();
      if (!authToken) {
        console.warn('🚫 No auth token available for server sync');
        return;
      }
      
      // Backend limit is 100 activities per request - implement batching
      const BATCH_SIZE = 100;
      const batches = [];
      
      for (let i = 0; i < unsyncedActivities.length; i += BATCH_SIZE) {
        batches.push(unsyncedActivities.slice(i, i + BATCH_SIZE));
      }
      
      console.log(`📦 Syncing ${unsyncedActivities.length} activities in ${batches.length} batch(es)...`);
      
      let totalSynced = 0;
      let syncedActivityIds = [];
      
      // Process each batch
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        
        try {
          // Format activities for backend with validation
          const formattedActivities = batch.map(activity => {
            // Validate required fields before sending
            if (!activity.type || !activity.data) {
              console.warn('⚠️ Invalid activity structure:', { 
                id: activity.id, 
                hasType: !!activity.type, 
                hasData: !!activity.data 
              });
              return null;
            }
            
            const formatted = {
              activity_type: activity.type,
              activity_data: activity.data || {},
              timestamp: activity.timestamp,
              session_id: activity.sessionId || activity.data?.session_id || 'unknown',
              url: activity.data?.url || window.location.href,
              page_title: activity.data?.title || document.title,
              engagement_score: this.calculateActivityEngagement(activity)
            };
            
            // Ensure activity_data has required cross-tab fields
            if (!formatted.activity_data.tab_id) {
              formatted.activity_data.tab_id = this.tabId;
            }
            if (!formatted.activity_data.session_id) {
              formatted.activity_data.session_id = this.sessionId;
            }
            
            return formatted;
          }).filter(Boolean); // Remove null activities
          
          if (formattedActivities.length === 0) {
            console.warn(`⚠️ Batch ${batchIndex + 1} has no valid activities, skipping...`);
            continue;
          }
          
          console.log(`🔄 Processing batch ${batchIndex + 1}/${batches.length} (${formattedActivities.length} activities)...`);
          
          // Log sample activity for debugging
          if (formattedActivities.length > 0) {
            console.log('📋 Sample activity structure:', {
              activity_type: formattedActivities[0].activity_type,
              has_activity_data: !!formattedActivities[0].activity_data,
              timestamp: formattedActivities[0].timestamp,
              session_id: formattedActivities[0].session_id,
              url_length: formattedActivities[0].url?.length || 0,
              page_title_length: formattedActivities[0].page_title?.length || 0
            });
          }
          
          const requestBody = { activities: formattedActivities };
          
          const response = await fetch(`${this.apiBaseUrl}/api/browser-tracking/activities`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(requestBody)
          });
          
          if (response.ok) {
            const result = await response.json();
            console.log(`✅ Batch ${batchIndex + 1} successful: ${result.stored_count} activities synced`);
            
            // Log any backend errors or warnings
            if (result.errors && result.errors.length > 0) {
              console.warn(`⚠️ Backend validation warnings:`, result.errors);
            }
            
            totalSynced += result.stored_count || formattedActivities.length;
            
            // Track which activities were successfully synced
            syncedActivityIds.push(...batch.map(a => a.id));
            
          } else {
            let errorData;
            try {
              errorData = await response.json();
            } catch (parseError) {
              errorData = { error: 'Failed to parse error response' };
            }
            
            console.error(`❌ Batch ${batchIndex + 1} failed:`, {
              status: response.status,
              statusText: response.statusText,
              error: errorData,
              batchSize: formattedActivities.length,
              requestUrl: `${this.apiBaseUrl}/api/browser-tracking/activities`,
              authTokenPresent: !!authToken,
              sampleActivity: formattedActivities[0] ? {
                type: formattedActivities[0].activity_type,
                hasData: !!formattedActivities[0].activity_data,
                timestamp: formattedActivities[0].timestamp,
                dataKeys: Object.keys(formattedActivities[0].activity_data || {})
              } : 'none'
            });
            
            // If it's a specific error, try to handle it
            if (response.status === 400 && errorData.error?.includes('Too many activities')) {
              console.log('🔧 Detected "too many activities" error - this should not happen with batching');
              // Force cleanup and retry with smaller batch
              this.forceCleanup();
              break; // Exit batch processing
            }
            
            // Continue with next batch even if this one fails
            continue;
          }
          
          // Add small delay between batches to avoid overwhelming the server
          if (batchIndex < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
        } catch (batchError) {
          console.error(`💥 Error processing batch ${batchIndex + 1}:`, {
            error: batchError.message,
            stack: batchError.stack?.substring(0, 200),
            batchSize: batch.length
          });
          // Continue with next batch
          continue;
        }
      }
      
      // Mark successfully synced activities
      if (syncedActivityIds.length > 0) {
        activities.forEach(activity => {
          if (syncedActivityIds.includes(activity.id)) {
            activity.synced = true;
            activity.syncedAt = new Date().toISOString();
          }
        });
        
        // Update local storage
        this.saveActivitiesToStorage(activities);
        this.lastSyncTime = Date.now();
        
        console.log(`🎯 Total sync complete: ${totalSynced}/${unsyncedActivities.length} activities synced successfully`);
      } else {
        console.warn('⚠️ No activities were successfully synced');
      }
      
    } catch (error) {
      console.error('💥 Failed to sync with server:', {
        error: error.message,
        stack: error.stack?.substring(0, 300),
        apiBaseUrl: this.apiBaseUrl,
        storageKey: this.storageKey
      });
    } finally {
      this.pendingSync = false;
      console.log('🔓 Sync lock released');
    }
  }

  /**
   * Get authentication token for API requests
   */
  getAuthToken() {
    // Try different places where the token might be stored
    const tokenSources = [
      () => localStorage.getItem('access_token'),
      () => localStorage.getItem('authToken'),
      () => localStorage.getItem('token'), // Added fallback for BrowserTrackingHistory compatibility
      () => sessionStorage.getItem('access_token'),
      () => {
        // Try to get from auth context if available
        const authData = localStorage.getItem('authData');
        if (authData) {
          const parsed = JSON.parse(authData);
          return parsed.access_token || parsed.token;
        }
        return null;
      }
    ];
    
    for (const getToken of tokenSources) {
      try {
        const token = getToken();
        if (token) {
          console.log('🔑 Auth token found for sync');
          return token;
        }
      } catch (error) {
        continue;
      }
    }
    
    console.warn('🚫 No auth token found for browser tracking sync');
    return null;
  }

  /**
   * Calculate engagement score for an activity
   */
  calculateActivityEngagement(activity) {
    const type = activity.type;
    const data = activity.data || {};
    
    // Base scores for different activity types
    const baseScores = {
      'click': 2.0,
      'type': 3.0,
      'scroll': 1.0,
      'navigation': 2.5,
      'search': 4.0,
      'focus': 0.5,
      'blur': 0.2,
      'visibility_change': 1.0,
      'tab_switch': 1.5
    };
    
    let score = baseScores[type] || 1.0;
    
    // Enhance score based on activity data
    if (data.isSearchRelated) score *= 1.5;
    if (data.duration && data.duration > 5000) score *= 1.3;
    if (data.is_cross_tab) score *= 1.2; // Cross-tab activities are more valuable
    
    return Math.min(score, 10.0); // Cap at 10
  }

  /**
   * Enhanced activity saving with sync tracking
   */
  saveActivitiesToStorage(activities) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(activities));
    } catch (error) {
      console.error('Failed to save activities to storage:', error);
    }
  }

  /**
   * Get current session ID
   */
  getSessionId() {
    if (!this.sessionId) {
      this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    return this.sessionId;
  }

  /**
   * Get activity context
   */
  getActivityContext() {
    return {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      screenResolution: `${window.screen.width}x${window.screen.height}`,
      devicePixelRatio: window.devicePixelRatio || 1,
      language: navigator.language,
      userAgent: navigator.userAgent,
      online: navigator.onLine,
      cookiesEnabled: navigator.cookieEnabled
    };
  }

  /**
   * Enhanced activity saving with better error handling, cleanup, and validation
   */
  saveActivities() {
    if (!this.isEnabled || this.activityBuffer.length === 0) return;
    
    try {
      const existingActivities = this.getStoredActivities();
      
      // Validate and filter activity buffer
      const validActivities = this.activityBuffer.filter(activity => {
        const isValid = this.validateActivity(activity);
        if (!isValid) {
          console.warn('🚫 Filtering out invalid activity from buffer:', { 
            type: activity?.type, 
            hasData: !!activity?.data 
          });
        }
        return isValid;
      });
      
      // Validate existing activities and filter out corrupted ones
      const validExistingActivities = existingActivities.filter(activity => {
        const isValid = this.validateActivity(activity);
        if (!isValid) {
          console.warn('🚫 Filtering out corrupted stored activity:', { 
            type: activity?.type, 
            timestamp: activity?.timestamp 
          });
        }
        return isValid;
      });
      
      const allActivities = [...validExistingActivities, ...validActivities];
      
      // Sort by timestamp and keep most recent
      const recentActivities = allActivities
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, this.maxActivities);
      
      // Clean up old synced activities to prevent storage bloat
      const cleanedActivities = this.cleanupOldActivities(recentActivities);
      
      this.saveActivitiesToStorage(cleanedActivities);
      this.activityBuffer = [];
      
      const filteredCount = this.activityBuffer.length - validActivities.length;
      const cleanedCount = allActivities.length - cleanedActivities.length;
      
      console.log(`💾 Saved ${cleanedActivities.length} browser activities (${cleanedActivities.filter(a => !a.synced).length} pending sync)${filteredCount > 0 ? `, filtered ${filteredCount} invalid` : ''}${cleanedCount > 0 ? `, cleaned ${cleanedCount} old` : ''}`);
    } catch (error) {
      console.error('💥 Error saving browser activities:', error);
      // Clear buffer to prevent memory issues
      this.activityBuffer = [];
    }
  }

  /**
   * Clean up old synced activities to prevent storage bloat
   */
  cleanupOldActivities(activities) {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    
    // Keep all unsynced activities regardless of age
    const unsyncedActivities = activities.filter(a => !a.synced);
    
    // Keep only recent synced activities (last 7 days) 
    const recentSyncedActivities = activities.filter(a => 
      a.synced && new Date(a.timestamp) > sevenDaysAgo
    );
    
    const cleanedActivities = [...unsyncedActivities, ...recentSyncedActivities];
    
    // Sort by timestamp (most recent first) and limit total count
    return cleanedActivities
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, this.maxActivities);
  }

  /**
   * Manually trigger cleanup of old activities
   */
  cleanupStoredActivities() {
    try {
      const activities = this.getStoredActivities();
      const cleanedActivities = this.cleanupOldActivities(activities);
      
      if (cleanedActivities.length < activities.length) {
        this.saveActivitiesToStorage(cleanedActivities);
        console.log(`🧹 Cleaned up ${activities.length - cleanedActivities.length} old activities`);
        return activities.length - cleanedActivities.length;
      }
      
      return 0;
    } catch (error) {
      console.error('Error cleaning up activities:', error);
      return 0;
    }
  }

  /**
   * Debounced activity saving to prevent too frequent localStorage writes
   */
  debounceActivity() {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
    
    this.debounceTimeout = setTimeout(() => {
      this.saveActivities();
      this.debounceTimeout = null;
    }, 1000); // Save after 1 second of inactivity
  }

  /**
   * Get stored activities with error handling
   */
  getStoredActivities() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Error reading browser activities:', error);
      return [];
    }
  }

  /**
   * Get recent activities for chat context with filtering
   */
  getRecentActivities(minutesBack = 30, activityTypes = null) {
    const activities = this.getStoredActivities();
    const cutoffTime = new Date(Date.now() - minutesBack * 60 * 1000);
    
    let filtered = activities.filter(activity => 
      new Date(activity.timestamp) > cutoffTime
    );
    
    // Filter by activity types if specified
    if (activityTypes && Array.isArray(activityTypes)) {
      filtered = filtered.filter(activity => 
        activityTypes.includes(activity.type)
      );
    }
    
    return filtered;
  }

  /**
   * Enhanced activity summary with prominent search query context
   */
  getActivitySummary(minutesBack = 30) {
    if (!this.isEnabled) {
      return "Browser tracking is disabled.";
    }

    const activities = this.getRecentActivities(minutesBack);
    const recentSearches = this.getSearchQueriesFromPeriod(minutesBack);
    
    if (activities.length === 0 && recentSearches.length === 0) {
      return "No recent browser activity detected.";
    }
    
    let contextText = `🔍 **RECENT SEARCH CONTEXT** (last ${minutesBack} minutes):\n\n`;
    
    // **PROMINENTLY DISPLAY RECENT SEARCH QUERIES FIRST**
    if (recentSearches.length > 0) {
      contextText += `📝 **WHAT USER RECENTLY SEARCHED FOR:**\n`;
      recentSearches.slice(0, 5).forEach((search, idx) => {
        const timeAgo = this.getTimeAgo(search.timestamp);
        const domain = search.domain || 'Unknown';
        contextText += `   ${idx + 1}. "${search.query}" on ${domain} (${timeAgo})\n`;
      });
      
      // Highlight the most recent search
      const lastSearch = recentSearches[0];
      contextText += `\n🎯 **MOST RECENT SEARCH:** "${lastSearch.query}" (${this.getTimeAgo(lastSearch.timestamp)})\n`;
      contextText += `   ➤ When user asks "which is best?" or similar, they likely mean: "${lastSearch.query}"\n\n`;
    } else {
      contextText += `❌ **No search queries captured in the last ${minutesBack} minutes**\n\n`;
    }
    
    // Enhanced activity categorization with background tracking
    const clicks = activities.filter(a => a.type === 'click');
    const navigations = activities.filter(a => a.type === 'navigation' || a.type === 'background_navigation');
    const searches = activities.filter(a => a.type === 'click' && a.data?.isSearchRelated);
    const tabSwitches = activities.filter(a => a.type === 'visibility_change' || a.type === 'tab_focused' || a.type === 'tab_backgrounded');
    const backgroundSessions = activities.filter(a => a.type === 'background_session');
    const crossTabActivities = activities.filter(a => a.type === 'cross_tab_activity');
    const scrolls = activities.filter(a => a.type === 'scroll');
    const searchQueriesActivities = activities.filter(a => a.type === 'search_query_captured');
    
    // Detect search-related activities by URL patterns
    const searchRelatedActivities = activities.filter(activity => {
      const url = activity.data?.url || activity.data?.newUrl || '';
      const title = activity.data?.title || activity.data?.newTitle || '';
      return this.isSearchRelated(url, title);
    });
    
    // Get unique domains visited (including background)
    const domains = [...new Set(activities
      .map(a => a.data?.url || a.data?.newUrl)
      .filter(Boolean)
      .map(url => this.extractDomain(url))
    )];
    
    // Calculate total background time
    const totalBackgroundTime = backgroundSessions.reduce((total, session) => {
      return total + (session.data?.sessionDuration || 0);
    }, 0);
    
    // Count tab switches and detect multitasking patterns
    const tabSwitchCount = tabSwitches.length;
    const backgroundSessionCount = backgroundSessions.length;
    const continuousTrackingTime = this.calculateContinuousTrackingTime(activities);
    
    const summary = {
      totalActivities: activities.length,
      clicks: clicks.length,
      navigations: navigations.length,
      scrolls: scrolls.length,
      searches: searches.length,
      searchRelatedActivities: searchRelatedActivities.length,
      searchQueriesActivities: searchQueriesActivities.length,
      tabSwitches: tabSwitchCount,
      backgroundSessions: backgroundSessionCount,
      crossTabActivities: crossTabActivities.length,
      totalBackgroundTime: Math.round(totalBackgroundTime / 1000), // Convert to seconds
      continuousTrackingTime: Math.round(continuousTrackingTime / 1000),
      currentPage: window.location.href,
      pageTitle: document.title,
      recentUrls: [...new Set(activities.map(a => a.data?.url || a.data?.newUrl).filter(Boolean))].slice(0, 7),
      domains: domains.slice(0, 6),
      userEngagement: this.calculateEngagementScore(activities),
      trackingContinuity: this.calculateTrackingContinuity(activities)
    };
    
    // Current context with tracking status
    contextText += `📍 **Current Page:** ${summary.pageTitle}\n`;
    contextText += `🔗 **Domain:** ${this.extractDomain(summary.currentPage)}\n`;
    contextText += `⏱️ **Session time:** ${summary.continuousTrackingTime}s\n\n`;
    
    // Activity overview with search focus
    contextText += `📊 **Activity Overview:**\n`;
    if (summary.searchQueriesActivities > 0) {
      contextText += `   🔍 **Search queries captured:** ${summary.searchQueriesActivities}\n`;
    }
    contextText += `   • **Total interactions:** ${summary.totalActivities}\n`;
    contextText += `   • **Clicks:** ${summary.clicks} | **Navigations:** ${summary.navigations}\n`;
    contextText += `   • **Search-related activities:** ${summary.searchRelatedActivities}\n`;
    
    // Background tracking information
    if (summary.backgroundSessions > 0) {
      contextText += `   • **Background tracking:** ${summary.backgroundSessions} sessions (${summary.totalBackgroundTime}s)\n`;
    }
    
    if (summary.tabSwitches > 0) {
      contextText += `   • **Tab switches:** ${summary.tabSwitches}\n`;
    }
    
    contextText += `   • **Engagement level:** ${summary.userEngagement}/10\n\n`;
    
    // Enhanced search query details
    if (recentSearches.length > 0) {
      contextText += `🔍 **DETAILED SEARCH HISTORY:**\n`;
      recentSearches.slice(0, 7).forEach((search, idx) => {
        const time = new Date(search.timestamp).toLocaleTimeString();
        const timeAgo = this.getTimeAgo(search.timestamp);
        contextText += `   ${idx + 1}. [${time}] "${search.query}" (${search.domain}) - ${timeAgo}\n`;
      });
      contextText += '\n';
      
      // Search patterns analysis
      const uniqueQueries = [...new Set(recentSearches.map(s => s.query.toLowerCase()))];
      if (uniqueQueries.length !== recentSearches.length) {
        contextText += `🔄 **Search Patterns:** User repeated some searches (${recentSearches.length} total, ${uniqueQueries.length} unique)\n\n`;
      }
    }
    
    // Recent domains/websites with search context
    if (summary.domains.length > 1) {
      contextText += `🌐 **Recent Websites:**\n`;
      summary.domains.slice(0, 5).forEach((domain, idx) => {
        const hasSearches = recentSearches.some(s => s.domain === domain);
        const searchIndicator = hasSearches ? ' 🔍' : '';
        contextText += `   ${idx + 1}. ${domain}${searchIndicator}\n`;
      });
      contextText += '\n';
    }
    
    // AI Context Instructions
    contextText += `🤖 **FOR AI ASSISTANT:**\n`;
    if (recentSearches.length > 0) {
      const lastQuery = recentSearches[0].query;
      contextText += `   ✓ User's most recent search: "${lastQuery}"\n`;
      contextText += `   ✓ When user asks "which is best?", "what do you recommend?", "compare these", etc.\n`;
      contextText += `     they likely refer to: "${lastQuery}"\n`;
      contextText += `   ✓ Provide context-aware responses based on this search intent\n`;
    } else {
      contextText += `   ⚠️ No recent search queries captured\n`;
      contextText += `   ⚠️ User may need to visit search engines for query tracking\n`;
    }
    
    return contextText;
  }

  /**
   * Get human-readable time ago string
   */
  getTimeAgo(timestamp) {
    const now = Date.now();
    const time = new Date(timestamp).getTime();
    const diffMs = now - time;
    
    if (diffMs < 60000) {
      return 'just now';
    } else if (diffMs < 3600000) {
      const minutes = Math.floor(diffMs / 60000);
      return `${minutes}m ago`;
    } else {
      const hours = Math.floor(diffMs / 3600000);
      return `${hours}h ago`;
    }
  }

  /**
   * Calculate continuous tracking time from activities
   */
  calculateContinuousTrackingTime(activities) {
    if (activities.length === 0) return 0;
    
    const sortedActivities = activities.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const firstActivity = sortedActivities[0];
    const lastActivity = sortedActivities[sortedActivities.length - 1];
    
    return new Date(lastActivity.timestamp) - new Date(firstActivity.timestamp);
  }

  /**
   * Calculate tracking continuity percentage
   */
  calculateTrackingContinuity(activities) {
    // Since we never pause tracking, continuity should always be near 100%
    const backgroundSessions = activities.filter(a => a.type === 'background_session').length;
    const tabSwitches = activities.filter(a => a.type === 'tab_backgrounded').length;
    
    // Higher background activity indicates better continuity
    let continuity = 95; // Base continuity
    
    if (backgroundSessions > 0) {
      continuity += Math.min(5, backgroundSessions); // Bonus for background tracking
    }
    
    // Tab switches also indicate continuous tracking
    if (tabSwitches > 0) {
      continuity += Math.min(2, tabSwitches); // Small bonus for tab switches
    }
    
    return Math.min(100, continuity);
  }

  /**
   * Check if URL/title indicates search activity
   */
  isSearchRelated(url, title = '') {
    const searchDomains = [
      'google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com', 'baidu.com',
      'yandex.com', 'ask.com', 'ecosia.org', 'startpage.com', 'searx.me'
    ];
    
    const searchPatterns = [
      '/search', '?q=', '?query=', '?s=', '&q=', '#q=',
      'search?', 'query=', 'find=', 'keyword='
    ];
    
    const searchTitlePatterns = [
      'search', 'results', 'find', 'query', '- Google Search', '- Bing'
    ];
    
    // Check domain
    const domain = this.extractDomain(url);
    if (searchDomains.some(searchDomain => domain.includes(searchDomain))) {
      return true;
    }
    
    // Check URL patterns
    if (searchPatterns.some(pattern => url.toLowerCase().includes(pattern))) {
      return true;
    }
    
    // Check title patterns
    if (searchTitlePatterns.some(pattern => title.toLowerCase().includes(pattern))) {
      return true;
    }
    
    return false;
  }

  /**
   * Get human-readable description of activity with background tracking support
   */
  getActivityDescription(activity) {
    const domain = this.extractDomain(activity.data?.url || activity.data?.newUrl || '');
    
    switch (activity.type) {
      case 'navigation':
        return `Navigated to ${domain}`;
      case 'background_navigation':
        return `Background navigation to ${domain}`;
      case 'tab_focused':
        const timeAway = activity.data?.timeAwayFromTab ? ` (away ${Math.round(activity.data.timeAwayFromTab / 1000)}s)` : '';
        return `Returned to tab (${domain})${timeAway}`;
      case 'tab_backgrounded':
        return `Switched away from ${domain} (tracking continued)`;
      case 'background_session':
        const duration = activity.data?.sessionDuration ? Math.round(activity.data.sessionDuration / 1000) : 0;
        return `Background session on ${domain} (${duration}s tracked)`;
      case 'cross_tab_activity':
        return `Cross-tab activity detected (continuous tracking)`;
      case 'click':
        return activity.data?.isSearchRelated ? `Search click on ${domain}` : `Clicked on ${domain}`;
      case 'visibility_change':
        const visible = activity.data?.visible ? 'visible' : 'hidden';
        const continuous = activity.data?.trackingContinuous ? ' (tracking continuous)' : '';
        return `Tab ${visible} on ${domain}${continuous}`;
      default:
        return `Activity on ${domain}`;
    }
  }

  /**
   * Calculate user engagement score based on activities
   */
  calculateEngagementScore(activities) {
    if (activities.length === 0) return 0;
    
    let score = Math.min(activities.length / 10, 5); // Base activity score (0-5)
    
    // Add points for variety of interactions
    const types = new Set(activities.map(a => a.type));
    score += types.size * 0.5; // Up to 2.5 points for variety
    
    // Add points for time spent
    const timeScore = Math.min(this.calculateTimeOnPage() / 60000, 2.5); // Up to 2.5 for time
    score += timeScore;
    
    return Math.round(Math.min(score, 10));
  }

  /**
   * Extract domain from URL
   */
  extractDomain(url) {
    try {
      const domain = new URL(url).hostname;
      return domain.replace('www.', '');
    } catch {
      return 'Unknown';
    }
  }

  /**
   * Stop tracking activities with enhanced cleanup
   */
  stopTracking() {
    if (!this.isTracking) return;
    
    this.isTracking = false;
    
    // Clear all timeouts
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
    
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
      this.syncTimeout = null;
    }
    
    if (this.urlCheckInterval) {
      clearInterval(this.urlCheckInterval);
      this.urlCheckInterval = null;
    }
    
    // Remove all event listeners
    if (this.listeners) {
      document.removeEventListener('visibilitychange', this.listeners.handleVisibilityChange);
      document.removeEventListener('click', this.listeners.handleClick);
      document.removeEventListener('keydown', this.listeners.handleKeydown);
      document.removeEventListener('scroll', this.listeners.handleScroll);
      window.removeEventListener('focus', this.listeners.handleFocus);
      window.removeEventListener('blur', this.listeners.handleBlur);
      window.removeEventListener('hashchange', this.listeners.handleHashChange);
      window.removeEventListener('beforeunload', this.listeners.handleBeforeUnload);
      
      // Remove cross-tab listener
      if (this.listeners.handleStorageChange) {
        window.removeEventListener('storage', this.listeners.handleStorageChange);
      }
      
      // Remove popstate listener
      if (this.listeners.handlePopState) {
        window.removeEventListener('popstate', this.listeners.handlePopState);
      }
      
      // Reset listeners (don't call clear since it's not a Map anymore)
      this.listeners = new Map();
    }
    
    // Save any remaining activities before stopping
    if (this.activityBuffer.length > 0) {
      this.saveActivities();
    }
    
    // Final server sync
    if (this.isEnabled) {
      this.syncWithServer();
    }
    
    // Log tracking stopped
    this.logActivity('tracking_stopped', {
      url: window.location.href,
      title: document.title,
      total_session_time: this.calculateTimeOnPage(),
      tab_id: this.tabId,
      session_id: this.sessionId
    });
  }

  /**
   * Clear all stored activities
   */
  clearActivities() {
    localStorage.removeItem(this.storageKey);
    this.activityBuffer = [];
  }

  /**
   * Get tracking statistics
   */
  getTrackingStats() {
    const activities = this.getStoredActivities();
    const recentActivities = this.getRecentActivities(60); // Last hour
    
    return {
      isEnabled: this.isEnabled,
      isTracking: this.isTracking,
      totalActivities: activities.length,
      recentActivities: recentActivities.length,
      oldestActivity: activities.length > 0 ? activities[activities.length - 1].timestamp : null,
      newestActivity: activities.length > 0 ? activities[0].timestamp : null,
      sessionId: this.getSessionId(),
      storageSize: JSON.stringify(activities).length
    };
  }

  // Static methods for global usage
  static initialize(userId, enabled = false) {
    if (!BrowserActivityTracker.instance) {
      BrowserActivityTracker.instance = new BrowserActivityTracker(userId);
    }
    
    if (enabled) {
      BrowserActivityTracker.instance.enableTracking();
    }
    
    return BrowserActivityTracker.instance.isTrackingEnabled();
  }

  static getInstance() {
    return BrowserActivityTracker.instance;
  }

  static enable() {
    if (BrowserActivityTracker.instance) {
      BrowserActivityTracker.instance.enableTracking();
    }
  }

  static disable() {
    if (BrowserActivityTracker.instance) {
      BrowserActivityTracker.instance.disableTracking();
    }
  }

  static getActivities() {
    if (BrowserActivityTracker.instance) {
      return BrowserActivityTracker.instance.getStoredActivities();
    }
    return [];
  }

  static clearData() {
    if (BrowserActivityTracker.instance) {
      BrowserActivityTracker.instance.clearActivities();
    }
  }

  static isEnabled() {
    if (BrowserActivityTracker.instance) {
      return BrowserActivityTracker.instance.isTrackingEnabled();
    }
    return false;
  }

  static getStats() {
    if (BrowserActivityTracker.instance) {
      return BrowserActivityTracker.instance.getTrackingStats();
    }
    return {
      isEnabled: false,
      isTracking: false,
      totalActivities: 0,
      recentActivities: 0,
      oldestActivity: null,
      newestActivity: null,
      sessionId: null,
      storageSize: 0
    };
  }

  /**
   * Get recent search queries for AI context
   */
  getRecentSearchQueries(limit = 10) {
    try {
      const searchKey = `searchQueries_${this.userId}`;
      const searches = JSON.parse(localStorage.getItem(searchKey) || '[]');
      return searches.slice(0, limit);
    } catch (error) {
      console.error('Error retrieving search queries:', error);
      return [];
    }
  }

  /**
   * Get the most recent search query
   */
  getLastSearchQuery() {
    const searches = this.getRecentSearchQueries(1);
    return searches.length > 0 ? searches[0] : null;
  }

  /**
   * Get search queries from specific time period
   */
  getSearchQueriesFromPeriod(minutesBack = 30) {
    const searches = this.getRecentSearchQueries(50);
    const cutoffTime = new Date(Date.now() - minutesBack * 60 * 1000);
    
    return searches.filter(search => 
      new Date(search.timestamp) > cutoffTime
    );
  }

  /**
   * Clear stored search queries
   */
  clearSearchQueries() {
    try {
      const searchKey = `searchQueries_${this.userId}`;
      localStorage.removeItem(searchKey);
      console.log('Search queries cleared');
    } catch (error) {
      console.error('Error clearing search queries:', error);
    }
  }

  /**
   * Manually add a search query for testing (simulates external search)
   */
  simulateSearchQuery(query, domain = 'google.com') {
    if (!query || query.length < 2) return;
    
    const searchEntry = {
      query: query,
      url: `https://${domain}/search?q=${encodeURIComponent(query)}`,
      domain: domain,
      timestamp: new Date().toISOString(),
      sessionId: this.getSessionId(),
      tabId: this.tabId,
      isSimulated: true // Mark as test data
    };
    
    // Store in search queries storage
    try {
      const searchKey = `searchQueries_${this.userId}`;
      const existing = JSON.parse(localStorage.getItem(searchKey) || '[]');
      
      // Add new search query at the beginning
      existing.unshift(searchEntry);
      
      // Keep only last 50 search queries
      const recent = existing.slice(0, 50);
      
      localStorage.setItem(searchKey, JSON.stringify(recent));
      
      console.log(`🔍 Simulated search query: "${query}" from ${domain}`);
      
      // Also log as special search activity
      this.logActivity('search_query_captured', {
        searchQuery: query,
        searchDomain: domain,
        searchUrl: searchEntry.url,
        extractedFrom: 'manual_simulation',
        isMainSearchQuery: true,
        isSimulated: true,
        timestamp: searchEntry.timestamp
      });
      
      return searchEntry;
      
    } catch (error) {
      console.error('Error storing simulated search query:', error);
      return null;
    }
  }

  static getRecentSearches(limit = 5) {
    if (BrowserActivityTracker.instance) {
      return BrowserActivityTracker.instance.getRecentSearchQueries(limit);
    }
    return [];
  }

  static getLastSearch() {
    if (BrowserActivityTracker.instance) {
      return BrowserActivityTracker.instance.getLastSearchQuery();
    }
    return null;
  }

  static getSearchContext(minutesBack = 30) {
    if (BrowserActivityTracker.instance) {
      const searches = BrowserActivityTracker.instance.getSearchQueriesFromPeriod(minutesBack);
      if (searches.length > 0) {
        const lastSearch = searches[0];
        return {
          lastQuery: lastSearch.query,
          lastDomain: lastSearch.domain,
          timeAgo: BrowserActivityTracker.instance.getTimeAgo(lastSearch.timestamp),
          totalSearches: searches.length,
          allQueries: searches.map(s => s.query)
        };
      }
    }
    return null;
  }

  static clearSearchHistory() {
    if (BrowserActivityTracker.instance) {
      BrowserActivityTracker.instance.clearSearchQueries();
    }
  }

  /**
   * Check if we should sync based on activity count and frequency
   */
  shouldSync() {
    const activities = this.getStoredActivities();
    const unsyncedActivities = activities.filter(activity => !activity.synced);
    
    // If too many unsynced activities, force cleanup first
    if (unsyncedActivities.length > 500) {
      console.log(`⚠️ Too many unsynced activities (${unsyncedActivities.length}). Running cleanup...`);
      this.cleanupStoredActivities();
      return false; // Skip this sync cycle
    }
    
    // Don't sync too frequently if we have many activities
    const timeSinceLastSync = Date.now() - this.lastSyncTime;
    const minSyncInterval = unsyncedActivities.length > 200 ? 60000 : this.syncInterval; // 1 minute vs 30 seconds
    
    return timeSinceLastSync >= minSyncInterval;
  }

  /**
   * Force cleanup of activities and reset sync state
   */
  forceCleanup() {
    try {
      console.log('🧹 Force cleanup initiated...');
      
      // Get current activities
      const activities = this.getStoredActivities();
      const beforeCount = activities.length;
      
      // Keep only last 50 activities and mark them as synced to prevent re-sync issues
      const recentActivities = activities
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 50)
        .map(activity => ({
          ...activity,
          synced: true,
          syncedAt: new Date().toISOString()
        }));
      
      // Save cleaned activities
      this.saveActivitiesToStorage(recentActivities);
      
      // Clear any pending buffer
      this.activityBuffer = [];
      
      // Reset sync state
      this.pendingSync = false;
      this.lastSyncTime = Date.now();
      
      console.log(`✅ Force cleanup complete: ${beforeCount} → ${recentActivities.length} activities`);
      return beforeCount - recentActivities.length;
      
    } catch (error) {
      console.error('Error in force cleanup:', error);
      return 0;
    }
  }

  /**
   * Enhanced cleanup that forces final sync
   */
  async cleanup() {
    console.log('🧹 Cleaning up activity tracker...');
    
    try {
      // Clear all timers
      this.clearSyncTimers();
      
      // Force final sync if we have pending activities
      if (this.activityBuffer.length > 0) {
        console.log('💾 Final sync before cleanup...');
        await this.forceSyncNow();
      }
      
      // Remove event listeners
      this.removeEventListeners();
      
      // Clear storage references
      this.activityBuffer = [];
      this.isEnabled = false;
      
      console.log('✅ Cleanup completed');
      
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
    }
  }

  /**
   * Before unload tracking with forced sync
   */
  handleBeforeUnload() {
    if (!this.isEnabled) return;
    
    this.logActivity('page_unload', {
      url: window.location.href,
      timeOnPage: this.calculateTimeOnPage(),
      timestamp: new Date().toISOString()
    });
    
    // Force immediate sync using sendBeacon for reliability
    if (this.activityBuffer.length > 0) {
      try {
        navigator.sendBeacon('/api/browser/activities', JSON.stringify({
          user_id: this.userId,
          activities: [...this.activityBuffer]
        }));
        console.log('📡 Emergency sync via sendBeacon');
      } catch (error) {
        console.error('❌ Emergency sync failed:', error);
      }
    }
  }
}

// Static instance holder
BrowserActivityTracker.instance = null;

export { BrowserActivityTracker }; 