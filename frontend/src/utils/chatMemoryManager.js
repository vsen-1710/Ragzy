/**
 * ChatGPT-like Memory Manager
 * Integrates with BrowserActivityTracker to provide context-aware responses
 * Remembers user conversations, search queries, and preferences
 */

import { BrowserActivityTracker } from './browserActivityTracker.js';

class ChatMemoryManager {
  constructor(userId) {
    this.userId = userId;
    this.memoryKey = `chatMemory_${userId}`;
    this.conversationKey = `conversations_${userId}`;
    this.preferencesKey = `userPreferences_${userId}`;
    this.maxMemoryItems = 500;
    this.maxConversations = 50;
    
    // Initialize memory storage
    this.initializeMemory();
  }

  /**
   * Initialize memory storage
   */
  initializeMemory() {
    try {
      // Ensure memory storage exists
      if (!localStorage.getItem(this.memoryKey)) {
        localStorage.setItem(this.memoryKey, JSON.stringify([]));
      }
      
      if (!localStorage.getItem(this.conversationKey)) {
        localStorage.setItem(this.conversationKey, JSON.stringify([]));
      }
      
      if (!localStorage.getItem(this.preferencesKey)) {
        localStorage.setItem(this.preferencesKey, JSON.stringify({
          interests: [],
          preferences: {},
          frequently_asked: [],
          search_patterns: {}
        }));
      }
    } catch (error) {
      console.error('Error initializing chat memory:', error);
    }
  }

  /**
   * Store user message and context
   */
  storeUserMessage(message, context = {}) {
    try {
      const memoryItem = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'user_message',
        content: message,
        context: {
          ...context,
          timestamp: new Date().toISOString(),
          url: window.location.href,
          pageTitle: document.title,
          sessionId: this.getSessionId()
        },
        timestamp: new Date().toISOString(),
        searchContext: this.getCurrentSearchContext(),
        browserContext: this.getBrowserContext()
      };

      this.addToMemory(memoryItem);
      this.updateUserPreferences(message);
      
      return memoryItem.id;
    } catch (error) {
      console.error('Error storing user message:', error);
      return null;
    }
  }

  /**
   * Store AI response for context
   */
  storeAIResponse(message, userMessageId, context = {}) {
    try {
      const memoryItem = {
        id: `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'ai_response',
        content: message,
        relatedTo: userMessageId,
        context: {
          ...context,
          timestamp: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      };

      this.addToMemory(memoryItem);
      return memoryItem.id;
    } catch (error) {
      console.error('Error storing AI response:', error);
      return null;
    }
  }

  /**
   * Get current search context from browser tracker
   */
  getCurrentSearchContext() {
    try {
      const searchContext = BrowserActivityTracker.getSearchContext(60); // Last hour
      const recentSearches = BrowserActivityTracker.getRecentSearches(5);
      
      return {
        lastQuery: searchContext?.lastQuery || null,
        lastDomain: searchContext?.lastDomain || null,
        timeAgo: searchContext?.timeAgo || null,
        totalSearches: searchContext?.totalSearches || 0,
        recentQueries: recentSearches.map(s => s.query) || []
      };
    } catch (error) {
      console.warn('Error getting search context:', error);
      return null;
    }
  }

  /**
   * Get browser context for enhanced responses
   */
  getBrowserContext() {
    try {
      if (BrowserActivityTracker.isEnabled()) {
        const stats = BrowserActivityTracker.getStats();
        return {
          isTracking: stats.isEnabled,
          recentActivities: stats.recentActivities,
          engagement: stats.engagement || 0,
          sessionTime: stats.sessionTime || 0
        };
      }
      return null;
    } catch (error) {
      console.warn('Error getting browser context:', error);
      return null;
    }
  }

  /**
   * Add item to memory with size management
   */
  addToMemory(item) {
    try {
      const memory = this.getMemory();
      memory.unshift(item); // Add to beginning
      
      // Keep only recent items
      const trimmedMemory = memory.slice(0, this.maxMemoryItems);
      
      localStorage.setItem(this.memoryKey, JSON.stringify(trimmedMemory));
    } catch (error) {
      console.error('Error adding to memory:', error);
    }
  }

  /**
   * Get stored memory items
   */
  getMemory() {
    try {
      const stored = localStorage.getItem(this.memoryKey);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Error reading memory:', error);
      return [];
    }
  }

  /**
   * Find relevant memories based on current context
   */
  findRelevantMemories(currentMessage, limit = 10) {
    try {
      const memory = this.getMemory();
      const searchContext = this.getCurrentSearchContext();
      const relevantMemories = [];
      
      // Search for keyword matches
      const keywords = this.extractKeywords(currentMessage);
      
      for (const item of memory) {
        let relevanceScore = 0;
        
        // Check content similarity
        if (item.content) {
          const contentKeywords = this.extractKeywords(item.content);
          const intersection = keywords.filter(k => contentKeywords.includes(k));
          relevanceScore += intersection.length * 2;
        }
        
        // Boost score for search context matches
        if (searchContext?.lastQuery && item.searchContext?.lastQuery) {
          if (item.searchContext.lastQuery.toLowerCase().includes(searchContext.lastQuery.toLowerCase()) ||
              searchContext.lastQuery.toLowerCase().includes(item.searchContext.lastQuery.toLowerCase())) {
            relevanceScore += 10;
          }
        }
        
        // Recent memories are more relevant
        const timeScore = this.calculateTimeRelevance(item.timestamp);
        relevanceScore += timeScore;
        
        if (relevanceScore > 0) {
          relevantMemories.push({
            ...item,
            relevanceScore
          });
        }
      }
      
      // Sort by relevance and return top results
      return relevantMemories
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, limit);
        
    } catch (error) {
      console.error('Error finding relevant memories:', error);
      return [];
    }
  }

  /**
   * Extract keywords from text
   */
  extractKeywords(text) {
    if (!text) return [];
    
    const stopWords = new Set([
      'the', 'is', 'are', 'was', 'were', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'what', 'how', 'when', 'where', 'why', 'who', 'which', 'that', 'this', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they'
    ]);
    
    return text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word))
      .slice(0, 10); // Limit keywords
  }

  /**
   * Calculate time relevance score
   */
  calculateTimeRelevance(timestamp) {
    const now = Date.now();
    const time = new Date(timestamp).getTime();
    const diffHours = (now - time) / (1000 * 60 * 60);
    
    if (diffHours < 1) return 5;      // Very recent
    if (diffHours < 24) return 3;     // Today
    if (diffHours < 168) return 2;    // This week
    if (diffHours < 720) return 1;    // This month
    return 0;
  }

  /**
   * Generate context-aware prompt for AI
   */
  generateContextPrompt(userMessage) {
    try {
      const searchContext = this.getCurrentSearchContext();
      const relevantMemories = this.findRelevantMemories(userMessage, 5);
      const browserActivity = BrowserActivityTracker.isEnabled() ? 
        BrowserActivityTracker.getInstance()?.getActivitySummary(30) : null;
      
      let prompt = `User Message: "${userMessage}"\n\n`;
      
      // Add search context (your main requirement)
      if (searchContext?.lastQuery) {
        prompt += `🔍 SEARCH CONTEXT:\n`;
        prompt += `Most Recent Search: "${searchContext.lastQuery}" (${searchContext.timeAgo})\n`;
        prompt += `Recent Searches: ${searchContext.recentQueries.slice(0, 3).join(', ')}\n\n`;
        
        // Detect context-dependent questions
        const contextualKeywords = ['best', 'better', 'which', 'what', 'recommend', 'compare', 'vs', 'difference', 'choose', 'pick'];
        const isContextual = contextualKeywords.some(keyword => 
          userMessage.toLowerCase().includes(keyword)
        );
        
        if (isContextual) {
          prompt += `🎯 LIKELY CONTEXT: User is asking about "${searchContext.lastQuery}" based on recent search.\n\n`;
        }
      }
      
      // Add relevant conversation history
      if (relevantMemories.length > 0) {
        prompt += `📝 RELEVANT CONVERSATION HISTORY:\n`;
        relevantMemories.forEach((memory, idx) => {
          const timeAgo = this.getTimeAgo(memory.timestamp);
          const content = memory.content.substring(0, 100);
          prompt += `${idx + 1}. [${timeAgo}] ${memory.type}: "${content}..."\n`;
        });
        prompt += '\n';
      }
      
      // Add browser activity context (condensed)
      if (browserActivity) {
        const activityLines = browserActivity.split('\n').slice(0, 8); // First 8 lines
        prompt += `🌐 BROWSER CONTEXT:\n${activityLines.join('\n')}\n\n`;
      }
      
      prompt += `🤖 INSTRUCTIONS:\n`;
      prompt += `- Behave like ChatGPT: friendly, helpful, and smart\n`;
      prompt += `- Use the search context to understand what the user is referring to\n`;
      prompt += `- Reference previous conversations when relevant\n`;
      prompt += `- If the user asks "which is best?" or similar, assume they mean the most recent search\n`;
      prompt += `- Provide specific, actionable answers based on the context\n`;
      
      return prompt;
      
    } catch (error) {
      console.error('Error generating context prompt:', error);
      return `User Message: "${userMessage}"\n\nBehave like ChatGPT: friendly, helpful, and smart.`;
    }
  }

  /**
   * Update user preferences based on messages
   */
  updateUserPreferences(message) {
    try {
      const preferences = this.getUserPreferences();
      
      // Extract interests and topics
      const keywords = this.extractKeywords(message);
      keywords.forEach(keyword => {
        if (!preferences.interests.includes(keyword)) {
          preferences.interests.push(keyword);
        }
      });
      
      // Limit interests
      preferences.interests = preferences.interests.slice(0, 50);
      
      // Track search patterns
      const searchContext = this.getCurrentSearchContext();
      if (searchContext?.lastQuery) {
        const domain = searchContext.lastDomain || 'unknown';
        if (!preferences.search_patterns[domain]) {
          preferences.search_patterns[domain] = [];
        }
        preferences.search_patterns[domain].push(searchContext.lastQuery);
        
        // Limit search patterns per domain
        preferences.search_patterns[domain] = preferences.search_patterns[domain].slice(0, 20);
      }
      
      this.saveUserPreferences(preferences);
      
    } catch (error) {
      console.error('Error updating user preferences:', error);
    }
  }

  /**
   * Get user preferences
   */
  getUserPreferences() {
    try {
      const stored = localStorage.getItem(this.preferencesKey);
      return stored ? JSON.parse(stored) : {
        interests: [],
        preferences: {},
        frequently_asked: [],
        search_patterns: {}
      };
    } catch (error) {
      console.error('Error reading user preferences:', error);
      return { interests: [], preferences: {}, frequently_asked: [], search_patterns: {} };
    }
  }

  /**
   * Save user preferences
   */
  saveUserPreferences(preferences) {
    try {
      localStorage.setItem(this.preferencesKey, JSON.stringify(preferences));
    } catch (error) {
      console.error('Error saving user preferences:', error);
    }
  }

  /**
   * Get session ID
   */
  getSessionId() {
    return BrowserActivityTracker.getInstance()?.getSessionId() || `session_${Date.now()}`;
  }

  /**
   * Get time ago string
   */
  getTimeAgo(timestamp) {
    const now = Date.now();
    const time = new Date(timestamp).getTime();
    const diffMs = now - time;
    
    if (diffMs < 60000) return 'just now';
    if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
    if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
    return `${Math.floor(diffMs / 86400000)}d ago`;
  }

  /**
   * Clear memory (with confirmation)
   */
  clearMemory() {
    try {
      localStorage.removeItem(this.memoryKey);
      localStorage.removeItem(this.conversationKey);
      localStorage.removeItem(this.preferencesKey);
      this.initializeMemory();
      console.log('Chat memory cleared');
    } catch (error) {
      console.error('Error clearing memory:', error);
    }
  }

  /**
   * Get memory statistics
   */
  getMemoryStats() {
    try {
      const memory = this.getMemory();
      const preferences = this.getUserPreferences();
      const searchContext = this.getCurrentSearchContext();
      
      return {
        totalMemoryItems: memory.length,
        userInterests: preferences.interests.length,
        searchPatterns: Object.keys(preferences.search_patterns).length,
        currentSearchContext: searchContext?.lastQuery || 'None',
        memoryStorageSize: JSON.stringify(memory).length,
        isTrackingEnabled: BrowserActivityTracker.isEnabled()
      };
    } catch (error) {
      console.error('Error getting memory stats:', error);
      return {
        totalMemoryItems: 0,
        userInterests: 0,
        searchPatterns: 0,
        currentSearchContext: 'None',
        memoryStorageSize: 0,
        isTrackingEnabled: false
      };
    }
  }

  // Static methods for global usage
  static instance = null;

  static initialize(userId) {
    if (!ChatMemoryManager.instance) {
      ChatMemoryManager.instance = new ChatMemoryManager(userId);
    }
    return ChatMemoryManager.instance;
  }

  static getInstance() {
    return ChatMemoryManager.instance;
  }

  static processMessage(userMessage) {
    if (ChatMemoryManager.instance) {
      const userMsgId = ChatMemoryManager.instance.storeUserMessage(userMessage);
      const contextPrompt = ChatMemoryManager.instance.generateContextPrompt(userMessage);
      return { userMsgId, contextPrompt };
    }
    return { userMsgId: null, contextPrompt: userMessage };
  }

  static processAIResponse(aiResponse, userMsgId) {
    if (ChatMemoryManager.instance) {
      return ChatMemoryManager.instance.storeAIResponse(aiResponse, userMsgId);
    }
    return null;
  }

  static getStats() {
    if (ChatMemoryManager.instance) {
      return ChatMemoryManager.instance.getMemoryStats();
    }
    return null;
  }
}

export { ChatMemoryManager }; 