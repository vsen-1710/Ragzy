/**
 * Browser Activity Tracker
 * Tracks user browser interactions to provide context for chatbot responses
 */

class BrowserActivityTracker {
  constructor(userId) {
    this.userId = userId;
    this.storageKey = `browserActivity_${userId}`;
    this.maxActivities = 100; // Limit stored activities
    this.isTracking = false;
    this.activityBuffer = [];
    this.debounceTimeout = null;
    
    // Initialize tracking
    this.initializeTracking();
  }

  /**
   * Initialize event listeners for browser activity tracking
   */
  initializeTracking() {
    if (this.isTracking) return;
    
    this.isTracking = true;
    
    // Track page visibility changes
    document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
    
    // Track clicks
    document.addEventListener('click', this.handleClick.bind(this));
    
    // Track key navigation (but not keystrokes for privacy)
    document.addEventListener('keydown', this.handleKeydown.bind(this));
    
    // Track scroll behavior
    document.addEventListener('scroll', this.handleScroll.bind(this));
    
    // Track focus changes
    window.addEventListener('focus', this.handleFocus.bind(this));
    window.addEventListener('blur', this.handleBlur.bind(this));
    
    // Track URL changes (for SPAs)
    this.trackUrlChanges();
    
    // Initial page load activity
    this.logActivity('page_load', {
      url: window.location.href,
      title: document.title,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Track URL changes in Single Page Applications
   */
  trackUrlChanges() {
    let currentUrl = window.location.href;
    
    const checkUrlChange = () => {
      if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
        this.logActivity('navigation', {
          url: currentUrl,
          title: document.title,
          timestamp: new Date().toISOString()
        });
      }
    };
    
    // Check for URL changes periodically
    setInterval(checkUrlChange, 1000);
    
    // Also listen to popstate for back/forward navigation
    window.addEventListener('popstate', () => {
      setTimeout(checkUrlChange, 100);
    });
  }

  /**
   * Handle click events
   */
  handleClick(event) {
    const target = event.target;
    const tagName = target.tagName.toLowerCase();
    const className = target.className || '';
    const id = target.id || '';
    const text = target.textContent ? target.textContent.slice(0, 50) : '';
    
    // Don't track chat input clicks or sensitive elements
    if (target.closest('.chat-input') || target.closest('[data-no-track]')) {
      return;
    }
    
    this.logActivity('click', {
      element: tagName,
      className: className.toString(),
      id,
      text,
      url: window.location.href,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handle keydown events (track navigation keys only)
   */
  handleKeydown(event) {
    const navigationKeys = ['Tab', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    
    if (navigationKeys.includes(event.key)) {
      this.logActivity('key_navigation', {
        key: event.key,
        url: window.location.href,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle scroll events (debounced)
   */
  handleScroll() {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
    
    this.debounceTimeout = setTimeout(() => {
      const scrollPosition = window.pageYOffset || document.documentElement.scrollTop;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const scrollPercent = Math.round((scrollPosition / maxScroll) * 100);
      
      this.logActivity('scroll', {
        position: scrollPosition,
        percent: scrollPercent,
        url: window.location.href,
        timestamp: new Date().toISOString()
      });
    }, 500);
  }

  /**
   * Handle page visibility changes
   */
  handleVisibilityChange() {
    this.logActivity('visibility_change', {
      visible: !document.hidden,
      url: window.location.href,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handle window focus/blur
   */
  handleFocus() {
    this.logActivity('window_focus', {
      focused: true,
      url: window.location.href,
      timestamp: new Date().toISOString()
    });
  }

  handleBlur() {
    this.logActivity('window_focus', {
      focused: false,
      url: window.location.href,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log an activity to the buffer
   */
  logActivity(type, data) {
    const activity = {
      id: Date.now() + Math.random(),
      type,
      data,
      timestamp: new Date().toISOString()
    };
    
    this.activityBuffer.push(activity);
    
    // Periodically save to localStorage
    if (this.activityBuffer.length >= 10) {
      this.saveActivities();
    }
  }

  /**
   * Save activities to localStorage
   */
  saveActivities() {
    try {
      const existingActivities = this.getStoredActivities();
      const allActivities = [...existingActivities, ...this.activityBuffer];
      
      // Keep only the most recent activities
      const recentActivities = allActivities
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, this.maxActivities);
      
      localStorage.setItem(this.storageKey, JSON.stringify(recentActivities));
      this.activityBuffer = [];
    } catch (error) {
      console.error('Error saving browser activities:', error);
    }
  }

  /**
   * Get stored activities from localStorage
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
   * Get recent activities for chat context
   */
  getRecentActivities(minutesBack = 30) {
    const activities = this.getStoredActivities();
    const cutoffTime = new Date(Date.now() - minutesBack * 60 * 1000);
    
    return activities.filter(activity => 
      new Date(activity.timestamp) > cutoffTime
    );
  }

  /**
   * Get activity summary for chat context
   */
  getActivitySummary(minutesBack = 30) {
    const activities = this.getRecentActivities(minutesBack);
    
    if (activities.length === 0) {
      return "No recent browser activity detected.";
    }
    
    const summary = {
      totalActivities: activities.length,
      clicks: activities.filter(a => a.type === 'click').length,
      navigations: activities.filter(a => a.type === 'navigation').length,
      scrolls: activities.filter(a => a.type === 'scroll').length,
      currentPage: window.location.href,
      pageTitle: document.title,
      recentUrls: [...new Set(activities.map(a => a.data?.url).filter(Boolean))].slice(0, 5)
    };
    
    let contextText = `Recent browser activity (last ${minutesBack} minutes):\n`;
    contextText += `- Current page: ${summary.pageTitle} (${summary.currentPage})\n`;
    contextText += `- Total interactions: ${summary.totalActivities}\n`;
    contextText += `- Clicks: ${summary.clicks}, Navigation: ${summary.navigations}, Scrolling: ${summary.scrolls}\n`;
    
    if (summary.recentUrls.length > 1) {
      contextText += `- Recent pages visited: ${summary.recentUrls.slice(1).join(', ')}\n`;
    }
    
    return contextText;
  }

  /**
   * Stop tracking
   */
  stopTracking() {
    this.isTracking = false;
    this.saveActivities(); // Save any remaining activities
    
    // Remove event listeners
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    document.removeEventListener('click', this.handleClick);
    document.removeEventListener('keydown', this.handleKeydown);
    document.removeEventListener('scroll', this.handleScroll);
    window.removeEventListener('focus', this.handleFocus);
    window.removeEventListener('blur', this.handleBlur);
  }

  /**
   * Clear all stored activities
   */
  clearActivities() {
    localStorage.removeItem(this.storageKey);
    this.activityBuffer = [];
  }
}

export { BrowserActivityTracker }; 