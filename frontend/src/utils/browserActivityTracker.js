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
   * Enhanced click tracking
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
    
    // Enhanced click data
    const clickData = {
      element: tagName,
      className: className,
      id,
      text,
      href,
      url: window.location.href,
      pageTitle: document.title,
      coordinates: {
        x: event.clientX,
        y: event.clientY,
        pageX: event.pageX,
        pageY: event.pageY
      },
      timestamp: new Date().toISOString()
    };

    // Detect if it's a search or important action
    if (href.includes('search') || href.includes('query') || 
        text.toLowerCase().includes('search') || 
        className.includes('search')) {
      clickData.isSearchRelated = true;
    }
    
    this.logActivity('click', clickData);
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
   * Page visibility tracking
   */
  handleVisibilityChange() {
    if (!this.isEnabled) return;
    
    this.logActivity('visibility_change', {
      visible: !document.hidden,
      url: window.location.href,
      timeOnPage: this.calculateTimeOnPage(),
      timestamp: new Date().toISOString()
    });
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
   * Enhanced activity summary with better context
   */
  getActivitySummary(minutesBack = 30) {
    if (!this.isEnabled) {
      return "Browser tracking is disabled.";
    }

    const activities = this.getRecentActivities(minutesBack);
    
    if (activities.length === 0) {
      return "No recent browser activity detected.";
    }
    
    const summary = {
      totalActivities: activities.length,
      clicks: activities.filter(a => a.type === 'click').length,
      navigations: activities.filter(a => a.type === 'navigation').length,
      scrolls: activities.filter(a => a.type === 'scroll').length,
      searches: activities.filter(a => a.type === 'click' && a.data?.isSearchRelated).length,
      timeOnPage: this.calculateTimeOnPage(),
      currentPage: window.location.href,
      pageTitle: document.title,
      recentUrls: [...new Set(activities.map(a => a.data?.url || a.data?.newUrl).filter(Boolean))].slice(0, 5),
      userEngagement: this.calculateEngagementScore(activities)
    };
    
    let contextText = `🔍 Browser Activity Context (last ${minutesBack} minutes):\n\n`;
    contextText += `📍 Current: ${summary.pageTitle}\n`;
    contextText += `🔗 URL: ${summary.currentPage}\n`;
    contextText += `⏱️ Time on page: ${Math.round(summary.timeOnPage / 1000)}s\n`;
    contextText += `📊 Activity: ${summary.totalActivities} interactions\n`;
    contextText += `   • ${summary.clicks} clicks, ${summary.navigations} navigations\n`;
    contextText += `   • ${summary.scrolls} scrolls, ${summary.searches} search actions\n`;
    contextText += `📈 Engagement: ${summary.userEngagement}/10\n`;
    
    if (summary.recentUrls.length > 1) {
      contextText += `\n🏃‍♂️ Recent pages:\n`;
      summary.recentUrls.slice(1, 4).forEach((url, idx) => {
        const domain = this.extractDomain(url);
        contextText += `   ${idx + 1}. ${domain}\n`;
      });
    }
    
    return contextText;
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
   * Stop tracking with proper cleanup
   */
  stopTracking() {
    this.isTracking = false;
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
    
    // Clear intervals
    if (this.urlCheckInterval) {
      clearInterval(this.urlCheckInterval);
    }
    
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
    
    this.listeners = null;
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