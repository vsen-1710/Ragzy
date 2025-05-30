/**
 * Memory System for AI Assistant
 * Tracks all user interactions, conversations, and provides advanced search/filter capabilities
 */

export class MemorySystem {
  constructor(userId) {
    this.userId = userId;
    this.storageKey = `memory_${userId}`;
    this.activityKey = `activity_${userId}`;
    this.conversationsKey = `conversations_${userId}`;
    this.searchIndexKey = `searchIndex_${userId}`;
    this.settingsKey = `memorySettings_${userId}`;
    
    // Initialize IndexedDB for large data storage
    this.initIndexedDB();
    
    // Track page visibility for accurate session tracking
    this.sessionStart = Date.now();
    this.setupPageVisibilityTracking();
    
    // Auto-save interval (every 30 seconds)
    this.autoSaveInterval = setInterval(() => {
      this.saveToStorage();
    }, 30000);

    // Replace any usage of screen with window.screen
    const screenWidth = window.screen.width;
    const screenHeight = window.screen.height;
  }

  /**
   * Initialize IndexedDB for large data storage
   */
  async initIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(`MemorySystem_${this.userId}`, 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Activity logs store
        if (!db.objectStoreNames.contains('activities')) {
          const activityStore = db.createObjectStore('activities', { keyPath: 'id', autoIncrement: true });
          activityStore.createIndex('timestamp', 'timestamp', { unique: false });
          activityStore.createIndex('type', 'type', { unique: false });
          activityStore.createIndex('sessionId', 'sessionId', { unique: false });
        }
        
        // Conversations store
        if (!db.objectStoreNames.contains('conversations')) {
          const conversationStore = db.createObjectStore('conversations', { keyPath: 'id' });
          conversationStore.createIndex('timestamp', 'timestamp', { unique: false });
          conversationStore.createIndex('title', 'title', { unique: false });
          conversationStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
          conversationStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
        }
        
        // Search index store
        if (!db.objectStoreNames.contains('searchIndex')) {
          const searchStore = db.createObjectStore('searchIndex', { keyPath: 'term' });
          searchStore.createIndex('frequency', 'frequency', { unique: false });
          searchStore.createIndex('lastUsed', 'lastUsed', { unique: false });
        }
        
        // User preferences and settings
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
    });
  }

  /**
   * Track user activity
   */
  trackActivity(type, data = {}) {
    const activity = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      data,
      timestamp: new Date().toISOString(),
      sessionId: this.getSessionId(),
      url: window.location.href,
      userAgent: navigator.userAgent,
      screenResolution: `${window.screen.width}x${window.screen.height}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`
    };

    // Store in memory for quick access
    this.addToMemoryCache('activities', activity);
    
    // Store in IndexedDB for persistence
    if (this.db) {
      const transaction = this.db.transaction(['activities'], 'readwrite');
      const store = transaction.objectStore('activities');
      store.add(activity);
    }

    // Update search index if it's a search activity
    if (type === 'search' && data.query) {
      this.updateSearchIndex(data.query);
    }

    console.log('Activity tracked:', activity);
    this.saveToStorage();
    return activity;
  }

  /**
   * Track specific types of activities
   */
  trackSearch(query, results = []) {
    return this.trackActivity('search', {
      query,
      resultsCount: results.length,
      results: results.slice(0, 10) // Store only first 10 results
    });
  }

  trackInput(input, context = '') {
    return this.trackActivity('input', {
      content: input,
      context,
      length: input.length,
      wordCount: input.split(/\s+/).filter(word => word.length > 0).length
    });
  }

  trackPageVisit(page, section = '') {
    return this.trackActivity('page_visit', {
      page,
      section,
      referrer: document.referrer,
      timeSpent: this.calculateTimeSpent()
    });
  }

  trackLinkClick(url, text = '', target = '') {
    return this.trackActivity('link_click', {
      url,
      text,
      target,
      internal: url.startsWith(window.location.origin)
    });
  }

  trackConversationStart(conversationId, title = '') {
    return this.trackActivity('conversation_start', {
      conversationId,
      title
    });
  }

  trackMessage(conversationId, message, role = 'user') {
    return this.trackActivity('message', {
      conversationId,
      message: message.substring(0, 500), // Store first 500 chars
      role,
      messageLength: message.length
    });
  }

  /**
   * Save conversation with enhanced metadata
   */
  async saveConversation(conversation) {
    const enhancedConversation = {
      ...conversation,
      id: conversation.id || this.generateId(),
      savedAt: new Date().toISOString(),
      lastUpdated: conversation.lastUpdated || new Date().toISOString(),
      messageCount: conversation.messages ? conversation.messages.length : 0,
      wordCount: this.calculateWordCount(conversation.messages || []),
      tags: conversation.tags || this.generateTags(conversation),
      summary: conversation.summary || this.generateSummary(conversation.messages || []),
      searchableContent: this.createSearchableContent(conversation)
    };

    // Store in IndexedDB
    if (this.db) {
      const transaction = this.db.transaction(['conversations'], 'readwrite');
      const store = transaction.objectStore('conversations');
      await store.put(enhancedConversation);
    }

    // Update memory cache
    this.addToMemoryCache('conversations', enhancedConversation);
    
    // Track the save activity
    this.trackActivity('conversation_saved', {
      conversationId: enhancedConversation.id,
      messageCount: enhancedConversation.messageCount,
      wordCount: enhancedConversation.wordCount
    });

    this.saveToStorage();
    return enhancedConversation;
  }

  /**
   * Search through memory
   */
  async searchMemory(query, filters = {}) {
    const results = {
      conversations: [],
      activities: [],
      total: 0
    };

    if (!this.db) return results;

    const queryLower = query.toLowerCase();
    
    // Search conversations
    const conversationTransaction = this.db.transaction(['conversations'], 'readonly');
    const conversationStore = conversationTransaction.objectStore('conversations');
    const conversationCursor = await conversationStore.openCursor();
    
    await this.processCursor(conversationCursor, (conversation) => {
      if (this.matchesQuery(conversation, queryLower, filters)) {
        results.conversations.push({
          ...conversation,
          relevanceScore: this.calculateRelevance(conversation, queryLower)
        });
      }
    });

    // Search activities
    const activityTransaction = this.db.transaction(['activities'], 'readonly');
    const activityStore = activityTransaction.objectStore('activities');
    const activityCursor = await activityStore.openCursor();
    
    await this.processCursor(activityCursor, (activity) => {
      if (this.matchesQuery(activity, queryLower, filters)) {
        results.activities.push({
          ...activity,
          relevanceScore: this.calculateRelevance(activity, queryLower)
        });
      }
    });

    // Sort by relevance
    results.conversations.sort((a, b) => b.relevanceScore - a.relevanceScore);
    results.activities.sort((a, b) => b.relevanceScore - a.relevanceScore);
    
    results.total = results.conversations.length + results.activities.length;

    // Track the search
    this.trackSearch(query, [...results.conversations, ...results.activities]);

    return results;
  }

  /**
   * Get conversation history with filters
   */
  async getConversationHistory(filters = {}) {
    if (!this.db) return [];

    const conversations = [];
    const transaction = this.db.transaction(['conversations'], 'readonly');
    const store = transaction.objectStore('conversations');
    
    let cursor;
    if (filters.sortBy === 'timestamp') {
      cursor = await store.index('timestamp').openCursor(null, 'prev');
    } else if (filters.sortBy === 'lastUpdated') {
      cursor = await store.index('lastUpdated').openCursor(null, 'prev');
    } else {
      cursor = await store.openCursor();
    }

    await this.processCursor(cursor, (conversation) => {
      if (this.matchesFilters(conversation, filters)) {
        conversations.push(conversation);
      }
    });

    return conversations;
  }

  /**
   * Get activity log with filters
   */
  async getActivityLog(filters = {}) {
    if (!this.db) return [];

    const activities = [];
    const transaction = this.db.transaction(['activities'], 'readonly');
    const store = transaction.objectStore('activities');
    
    let cursor;
    if (filters.type) {
      cursor = await store.index('type').openCursor(IDBKeyRange.only(filters.type));
    } else {
      cursor = await store.index('timestamp').openCursor(null, 'prev');
    }

    await this.processCursor(cursor, (activity) => {
      if (this.matchesFilters(activity, filters)) {
        activities.push(activity);
      }
    });

    return activities.slice(0, filters.limit || 1000);
  }

  /**
   * Delete conversation
   */
  async deleteConversation(conversationId) {
    if (!this.db) return false;

    const transaction = this.db.transaction(['conversations'], 'readwrite');
    const store = transaction.objectStore('conversations');
    await store.delete(conversationId);

    // Remove from memory cache
    this.removeFromMemoryCache('conversations', conversationId);
    
    // Track deletion
    this.trackActivity('conversation_deleted', { conversationId });

    this.saveToStorage();

    return true;
  }

  /**
   * Clear all memory data
   */
  async clearAllMemory() {
    if (!this.db) return false;

    const transaction = this.db.transaction(['activities', 'conversations', 'searchIndex'], 'readwrite');
    
    await transaction.objectStore('activities').clear();
    await transaction.objectStore('conversations').clear();
    await transaction.objectStore('searchIndex').clear();

    // Clear localStorage cache
    localStorage.removeItem(this.storageKey);
    localStorage.removeItem(this.activityKey);
    localStorage.removeItem(this.conversationsKey);
    localStorage.removeItem(this.searchIndexKey);

    // Track clear action
    this.trackActivity('memory_cleared', {});

    this.saveToStorage();

    return true;
  }

  /**
   * Export memory data
   */
  async exportMemoryData() {
    const data = {
      userId: this.userId,
      exportDate: new Date().toISOString(),
      conversations: await this.getConversationHistory(),
      activities: await this.getActivityLog({ limit: 10000 }),
      searchIndex: await this.getSearchIndex(),
      settings: await this.getSettings()
    };

    return data;
  }

  /**
   * Import memory data
   */
  async importMemoryData(data) {
    if (!this.db || !data) return false;

    const transaction = this.db.transaction(['activities', 'conversations', 'searchIndex', 'settings'], 'readwrite');
    
    // Import conversations
    if (data.conversations) {
      const conversationStore = transaction.objectStore('conversations');
      for (const conversation of data.conversations) {
        await conversationStore.put(conversation);
      }
    }

    // Import activities
    if (data.activities) {
      const activityStore = transaction.objectStore('activities');
      for (const activity of data.activities) {
        await activityStore.put(activity);
      }
    }

    // Import search index
    if (data.searchIndex) {
      const searchStore = transaction.objectStore('searchIndex');
      for (const term of data.searchIndex) {
        await searchStore.put(term);
      }
    }

    // Import settings
    if (data.settings) {
      const settingsStore = transaction.objectStore('settings');
      for (const setting of data.settings) {
        await settingsStore.put(setting);
      }
    }

    this.trackActivity('memory_imported', {
      conversationCount: data.conversations?.length || 0,
      activityCount: data.activities?.length || 0
    });

    this.saveToStorage();
    return true;
  }

  /**
   * Generate automatic tags for conversations
   */
  generateTags(conversation) {
    const tags = new Set();
    const content = this.createSearchableContent(conversation).toLowerCase();
    
    // Common topic keywords
    const topicKeywords = {
      'programming': ['code', 'programming', 'javascript', 'python', 'react', 'function', 'variable'],
      'ai': ['ai', 'artificial intelligence', 'machine learning', 'neural network'],
      'web': ['website', 'html', 'css', 'frontend', 'backend', 'api'],
      'design': ['design', 'ui', 'ux', 'interface', 'layout'],
      'help': ['help', 'problem', 'issue', 'error', 'fix'],
      'learning': ['learn', 'tutorial', 'guide', 'how to', 'explain']
    };

    for (const [tag, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some(keyword => content.includes(keyword))) {
        tags.add(tag);
      }
    }

    // Add length-based tags
    const messageCount = conversation.messages?.length || 0;
    if (messageCount > 20) tags.add('long-conversation');
    if (messageCount < 5) tags.add('short-conversation');

    return Array.from(tags);
  }

  /**
   * Generate conversation summary
   */
  generateSummary(messages) {
    if (!messages || messages.length === 0) return '';
    
    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length === 0) return '';

    const firstMessage = userMessages[0].content;
    return firstMessage.length > 100 ? 
      firstMessage.substring(0, 100) + '...' : 
      firstMessage;
  }

  /**
   * Auto-generate conversation title
   */
  generateConversationTitle(messages) {
    if (!messages || messages.length === 0) return 'New Conversation';
    
    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length === 0) return 'New Conversation';

    const firstMessage = userMessages[0].content;
    
    // Extract key topics/questions
    const words = firstMessage.split(' ').filter(word => word.length > 3);
    const title = words.slice(0, 4).join(' ');
    
    return title.length > 50 ? 
      title.substring(0, 47) + '...' : 
      title || 'New Conversation';
  }

  /**
   * Helper methods
   */
  generateId() {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getSessionId() {
    if (!this.sessionId) {
      this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    return this.sessionId;
  }

  calculateTimeSpent() {
    return Date.now() - this.sessionStart;
  }

  calculateWordCount(messages) {
    return messages.reduce((total, message) => {
      return total + message.content.split(/\s+/).filter(word => word.length > 0).length;
    }, 0);
  }

  createSearchableContent(conversation) {
    const parts = [];
    if (conversation.title) parts.push(conversation.title);
    if (conversation.summary) parts.push(conversation.summary);
    if (conversation.messages) {
      conversation.messages.forEach(msg => parts.push(msg.content));
    }
    if (conversation.tags) parts.push(conversation.tags.join(' '));
    return parts.join(' ').toLowerCase();
  }

  matchesQuery(item, query, filters) {
    const searchableContent = typeof item.searchableContent === 'string' ? 
      item.searchableContent : 
      this.createSearchableContent(item);
    
    const matchesText = searchableContent.toLowerCase().includes(query);
    return matchesText && this.matchesFilters(item, filters);
  }

  matchesFilters(item, filters) {
    if (filters.startDate && item.timestamp < filters.startDate) return false;
    if (filters.endDate && item.timestamp > filters.endDate) return false;
    if (filters.type && item.type !== filters.type) return false;
    if (filters.tags && item.tags && !filters.tags.some(tag => item.tags.includes(tag))) return false;
    return true;
  }

  calculateRelevance(item, query) {
    const content = this.createSearchableContent(item).toLowerCase();
    const queryWords = query.split(/\s+/);
    let score = 0;
    
    queryWords.forEach(word => {
      const count = (content.match(new RegExp(word, 'g')) || []).length;
      score += count;
    });
    
    // Boost score for title matches
    if (item.title && item.title.toLowerCase().includes(query)) {
      score += 10;
    }
    
    return score;
  }

  async processCursor(cursor, callback) {
    return new Promise((resolve) => {
      if (!cursor) {
        resolve();
        return;
      }

      cursor.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          callback(cursor.value);
          cursor.continue();
        } else {
          resolve();
        }
      };

      cursor.onerror = (event) => {
        console.error('Cursor error:', event.target.error);
        resolve();
      };
    });
  }

  updateSearchIndex(query) {
    if (!this.db) return;
    
    const transaction = this.db.transaction(['searchIndex'], 'readwrite');
    const store = transaction.objectStore('searchIndex');
    
    store.get(query).onsuccess = (event) => {
      const existing = event.target.result;
      const updated = existing ? {
        ...existing,
        frequency: existing.frequency + 1,
        lastUsed: new Date().toISOString()
      } : {
        term: query,
        frequency: 1,
        firstUsed: new Date().toISOString(),
        lastUsed: new Date().toISOString()
      };
      
      store.put(updated);
    };
  }

  addToMemoryCache(type, item) {
    const key = `${type}_cache_${this.userId}`;
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    existing.unshift(item);
    localStorage.setItem(key, JSON.stringify(existing.slice(0, 100))); // Keep only last 100 items
  }

  removeFromMemoryCache(type, id) {
    const key = `${type}_cache_${this.userId}`;
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    const filtered = existing.filter(item => item.id !== id);
    localStorage.setItem(key, JSON.stringify(filtered));
  }

  setupPageVisibilityTracking() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.trackActivity('page_hidden', { timeSpent: this.calculateTimeSpent() });
      } else {
        this.sessionStart = Date.now();
        this.trackActivity('page_visible', {});
      }
    });

    // Track page unload
    window.addEventListener('beforeunload', () => {
      this.trackActivity('page_unload', { timeSpent: this.calculateTimeSpent() });
      this.saveToStorage();
    });
  }

  async saveToStorage() {
    try {
      // Save to IndexedDB
      const tx = this.db.transaction(['activities', 'conversations', 'searchIndex', 'settings'], 'readwrite');
      
      // Save activities
      const activities = await this.getActivityLog();
      const activityStore = tx.objectStore('activities');
      for (const activity of activities) {
        await activityStore.put(activity);
      }
      
      // Save conversations
      const conversations = await this.getConversationHistory();
      const conversationStore = tx.objectStore('conversations');
      for (const conversation of conversations) {
        await conversationStore.put(conversation);
      }
      
      // Save search index
      const searchIndex = await this.getSearchIndex();
      const searchStore = tx.objectStore('searchIndex');
      for (const term of searchIndex) {
        await searchStore.put(term);
      }
      
      await tx.complete;
    } catch (error) {
      console.error('Error saving to storage:', error);
    }
  }

  async getSearchIndex() {
    if (!this.db) return [];
    
    const searchTerms = [];
    const transaction = this.db.transaction(['searchIndex'], 'readonly');
    const store = transaction.objectStore('searchIndex');
    const cursor = await store.openCursor();
    
    await this.processCursor(cursor, (term) => {
      searchTerms.push(term);
    });
    
    return searchTerms;
  }

  async getSettings() {
    if (!this.db) return {};
    
    const settings = {};
    const transaction = this.db.transaction(['settings'], 'readonly');
    const store = transaction.objectStore('settings');
    const cursor = await store.openCursor();
    
    await this.processCursor(cursor, (setting) => {
      settings[setting.key] = setting.value;
    });
    
    return settings;
  }

  /**
   * Cleanup resources
   */
  destroy() {
    // Clear auto-save interval
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    
    // Close IndexedDB connection
    if (this.db) {
      this.db.close();
    }
  }
}

export default MemorySystem; 