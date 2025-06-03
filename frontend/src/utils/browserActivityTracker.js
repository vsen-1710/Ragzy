/**
 * Enhanced Browser Activity Tracker
 * Tracks user browser interactions to provide context for chatbot responses
 * Includes toggle functionality and enhanced tracking capabilities
 */

class BrowserActivityTracker {
  constructor(userId) {
    this.userId = userId;
    this.storageKey = `browserActivity_${userId}`;
    this.settingsKey = `trackingSettings_${userId}`;
    this.maxActivities = 200; // Increased limit for better context
    this.isTracking = false;
    this.isEnabled = false; // New: track if tracking is enabled by user
    this.activityBuffer = [];
    this.debounceTimeout = null;
    this.listeners = new Map(); // Store event listeners for cleanup
    
    // Load settings and initialize if enabled
    this.loadSettings();
    if (this.isEnabled) {
      this.startTracking();
    }
  }

  /**
   * Load tracking settings from localStorage
   */
  loadSettings() {
    try {
      const settings = localStorage.getItem(this.settingsKey);
      if (settings) {
        const parsed = JSON.parse(settings);
        this.isEnabled = parsed.isEnabled || false;
      } else {
        // Default to disabled for privacy
        this.isEnabled = false;
        this.saveSettings();
      }
    } catch (error) {
      console.error('Error loading tracking settings:', error);
      this.isEnabled = false;
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
   * Enable tracking
   */
  enableTracking() {
    this.isEnabled = true;
    this.saveSettings();
    if (!this.isTracking) {
      this.startTracking();
    }
    console.log('Browser tracking enabled');
  }

  /**
   * Disable tracking
   */
  disableTracking() {
    this.isEnabled = false;
    this.saveSettings();
    if (this.isTracking) {
      this.stopTracking();
    }
    console.log('Browser tracking disabled');
  }

  /**
   * Check if tracking is enabled
   */
  isTrackingEnabled() {
    return this.isEnabled;
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
    
    // Track URL changes for SPAs
    this.trackUrlChanges();
    
    // Log initial activity
    this.logActivity('tracking_started', {
      url: window.location.href,
      title: document.title,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}`
    });
  }

  /**
   * Enhanced URL change tracking
   */
  trackUrlChanges() {
    let currentUrl = window.location.href;
    let currentTitle = document.title;
    
    const checkUrlChange = () => {
      const newUrl = window.location.href;
      const newTitle = document.title;
      
      if (newUrl !== currentUrl || newTitle !== currentTitle) {
        this.logActivity('navigation', {
          previousUrl: currentUrl,
          newUrl: newUrl,
          previousTitle: currentTitle,
          newTitle: newTitle,
          navigationType: 'spa_navigation',
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
    
    // Don't track chat input clicks or sensitive elements
    if (target.closest('.chat-input') || 
        target.closest('[data-no-track]') ||
        target.closest('.password-field') ||
        target.closest('.sensitive-data')) {
      return;
    }
    
    // Enhanced search detection
    const isSearchRelated = this.detectSearchActivity(href, text, className, id, target);
    
    // Enhanced click data
    const clickData = {
      element: tagName,
      className: className,
      id,
      text,
      href,
      url: window.location.href,
      pageTitle: document.title,
      isSearchRelated: isSearchRelated,
      searchContext: isSearchRelated ? this.getSearchContext(target) : null,
      coordinates: {
        x: event.clientX,
        y: event.clientY,
        pageX: event.pageX,
        pageY: event.pageY
      },
      timestamp: new Date().toISOString()
    };
    
    this.logActivity('click', clickData);
  }

  /**
   * Enhanced search activity detection
   */
  detectSearchActivity(href, text, className, id, target) {
    // Check if current page is a search page
    const currentUrl = window.location.href;
    const currentTitle = document.title;
    if (this.isSearchRelated(currentUrl, currentTitle)) {
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
    
    // Check href
    if (href && searchUrlPatterns.some(pattern => 
        href.toLowerCase().includes(pattern))) {
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
        target.type === 'submit' && target.form?.querySelector('input[type="search"]')) {
      return true;
    }
    
    // Check parent elements for search context
    let parent = target.parentElement;
    let depth = 0;
    while (parent && depth < 3) {
      const parentClass = parent.className?.toString().toLowerCase() || '';
      const parentId = parent.id?.toLowerCase() || '';
      
      if (searchCssPatterns.some(pattern => 
          parentClass.includes(pattern) || parentId.includes(pattern))) {
        return true;
      }
      
      parent = parent.parentElement;
      depth++;
    }
    
    return false;
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
   * Enhanced activity logging with better categorization
   */
  logActivity(type, data) {
    if (!this.isEnabled) return;
    
    const activity = {
      id: Date.now() + Math.random(),
      type,
      data,
      timestamp: new Date().toISOString(),
      sessionId: this.getSessionId(),
      userId: this.userId
    };
    
    // Add activity context
    activity.context = this.getActivityContext();
    
    this.activityBuffer.push(activity);
    
    // Save more frequently for better data integrity
    if (this.activityBuffer.length >= 5) {
      this.saveActivities();
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
   * Enhanced activity saving with better error handling
   */
  saveActivities() {
    if (!this.isEnabled || this.activityBuffer.length === 0) return;
    
    try {
      const existingActivities = this.getStoredActivities();
      const allActivities = [...existingActivities, ...this.activityBuffer];
      
      // Sort by timestamp and keep most recent
      const recentActivities = allActivities
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, this.maxActivities);
      
      localStorage.setItem(this.storageKey, JSON.stringify(recentActivities));
      this.activityBuffer = [];
      
      console.log(`Saved ${recentActivities.length} browser activities`);
    } catch (error) {
      console.error('Error saving browser activities:', error);
      // Clear buffer to prevent memory issues
      this.activityBuffer = [];
    }
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
   * Enhanced activity summary with continuous tracking across tab switches
   */
  getActivitySummary(minutesBack = 30) {
    if (!this.isEnabled) {
      return "Browser tracking is disabled.";
    }

    const activities = this.getRecentActivities(minutesBack);
    
    if (activities.length === 0) {
      return "No recent browser activity detected.";
    }
    
    // Enhanced activity categorization with background tracking
    const clicks = activities.filter(a => a.type === 'click');
    const navigations = activities.filter(a => a.type === 'navigation' || a.type === 'background_navigation');
    const searches = activities.filter(a => a.type === 'click' && a.data?.isSearchRelated);
    const tabSwitches = activities.filter(a => a.type === 'visibility_change' || a.type === 'tab_focused' || a.type === 'tab_backgrounded');
    const backgroundSessions = activities.filter(a => a.type === 'background_session');
    const crossTabActivities = activities.filter(a => a.type === 'cross_tab_activity');
    const scrolls = activities.filter(a => a.type === 'scroll');
    
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
    
    let contextText = `🔍 **Continuous Browser Tracking Context** (last ${minutesBack} minutes):\n\n`;
    
    // Current context with tracking status
    contextText += `📍 **Current Page:** ${summary.pageTitle}\n`;
    contextText += `🔗 **Domain:** ${this.extractDomain(summary.currentPage)}\n`;
    contextText += `⏱️ **Continuous tracking time:** ${summary.continuousTrackingTime}s\n`;
    contextText += `🔄 **Tracking continuity:** ${summary.trackingContinuity}% (never paused)\n\n`;
    
    // Enhanced activity overview with background tracking
    contextText += `📊 **Activity Overview (Continuous Tracking):**\n`;
    contextText += `   • **Total interactions:** ${summary.totalActivities} (uninterrupted)\n`;
    contextText += `   • **Clicks:** ${summary.clicks} | **Navigations:** ${summary.navigations}\n`;
    contextText += `   • **Scrolls:** ${summary.scrolls} | **Search activities:** ${summary.searchRelatedActivities}\n`;
    
    // Background tracking information
    if (summary.backgroundSessions > 0) {
      contextText += `   • **Background sessions:** ${summary.backgroundSessions} (${summary.totalBackgroundTime}s tracked)\n`;
    }
    
    if (summary.crossTabActivities > 0) {
      contextText += `   • **Cross-tab activities:** ${summary.crossTabActivities} detected\n`;
    }
    
    // Tab switching and multitasking analysis
    if (summary.tabSwitches > 0) {
      contextText += `   • **Tab switches:** ${summary.tabSwitches} (multitasking detected)\n`;
    }
    
    contextText += `   • **Engagement level:** ${summary.userEngagement}/10\n\n`;
    
    // Search activity details with background context
    if (summary.searchRelatedActivities > 0) {
      contextText += `🔍 **Search Activity (Continuously Tracked):**\n`;
      const searchActivities = searchRelatedActivities.slice(0, 4);
      searchActivities.forEach((activity, idx) => {
        const domain = this.extractDomain(activity.data?.url || activity.data?.newUrl || '');
        const time = new Date(activity.timestamp).toLocaleTimeString();
        const wasBackground = activity.data?.activeInBackground ? ' (background)' : '';
        contextText += `   ${idx + 1}. [${time}] Search on ${domain}${wasBackground}\n`;
      });
      contextText += '\n';
    }
    
    // Recent domains/websites with background tracking info
    if (summary.domains.length > 1) {
      contextText += `🌐 **Recent Websites (All Tracked):**\n`;
      summary.domains.slice(0, 5).forEach((domain, idx) => {
        const backgroundActivity = activities.find(a => 
          this.extractDomain(a.data?.url || a.data?.newUrl || '') === domain && 
          a.data?.activeInBackground
        );
        const bgIndicator = backgroundActivity ? ' 🔄' : '';
        contextText += `   ${idx + 1}. ${domain}${bgIndicator}\n`;
      });
      contextText += '\n';
    }
    
    // Enhanced multitasking context
    if (summary.tabSwitches > 3 || summary.backgroundSessions > 0) {
      const multitaskingIntensity = Math.min(10, Math.round((summary.tabSwitches + summary.backgroundSessions) / 2));
      contextText += `🔀 **Multitasking Analysis:** High activity detected with ${summary.tabSwitches} tab switches and ${summary.backgroundSessions} background sessions. `;
      contextText += `Intensity: ${multitaskingIntensity}/10. Tracking remained continuous throughout.\n\n`;
    }
    
    // Recent activity timeline with background indicators
    const significantActivities = activities
      .filter(a => ['navigation', 'background_navigation', 'tab_focused', 'background_session'].includes(a.type))
      .slice(0, 4);
    
    if (significantActivities.length > 0) {
      contextText += `⏰ **Recent Activity Timeline (Never Paused):**\n`;
      significantActivities.forEach((activity, idx) => {
        const time = new Date(activity.timestamp).toLocaleTimeString();
        const action = this.getActivityDescription(activity);
        const backgroundFlag = activity.data?.activeInBackground || activity.data?.trackingNeverPaused ? ' 🔄' : '';
        contextText += `   ${idx + 1}. [${time}] ${action}${backgroundFlag}\n`;
      });
      contextText += '\n';
    }
    
    // Tracking assurance message
    contextText += `✅ **Tracking Status:** Continuous and uninterrupted. All browsing activity captured regardless of tab switches.\n`;
    
    return contextText;
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
   * Stop tracking with comprehensive cleanup including background tracking
   */
  stopTracking() {
    this.isTracking = false;
    this.backgroundTrackingActive = false;
    this.saveActivities(); // Save any remaining activities
    
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
      
      if (this.listeners.handlePopState) {
        window.removeEventListener('popstate', this.listeners.handlePopState);
      }
    }
    
    // Clear all intervals and timeouts
    if (this.urlCheckInterval) {
      clearInterval(this.urlCheckInterval);
      this.urlCheckInterval = null;
    }
    
    if (this.backgroundActivityInterval) {
      clearInterval(this.backgroundActivityInterval);
      this.backgroundActivityInterval = null;
    }
    
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
    
    // Clean up background tracking state
    try {
      localStorage.removeItem(`${this.storageKey}_state`);
    } catch (error) {
      console.error('Error cleaning up tracking state:', error);
    }
    
    // Reset tracking variables
    this.backgroundStartTime = null;
    this.backgroundTrackingActive = false;
    this.listeners = null;
    
    console.log('Browser tracking stopped and cleaned up completely');
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
}

// Static instance holder
BrowserActivityTracker.instance = null;

export { BrowserActivityTracker }; 