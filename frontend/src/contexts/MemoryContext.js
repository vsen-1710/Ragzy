import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { MemorySystem } from '../utils/memorySystem';
import { useAuth } from './AuthContext';

const MemoryContext = createContext();

export const useMemory = () => {
  const context = useContext(MemoryContext);
  if (!context) {
    throw new Error('useMemory must be used within a MemoryProvider');
  }
  return context;
};

export const MemoryProvider = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const [memorySystem, setMemorySystem] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [recentActivities, setRecentActivities] = useState([]);
  const [conversationHistory, setConversationHistory] = useState([]);
  const trackingRef = useRef(false);

  // Initialize memory system when user logs in
  useEffect(() => {
    const initializeMemory = async () => {
      if (isAuthenticated && user?.id && !memorySystem) {
        try {
          console.log('Initializing memory system for user:', user.id);
          const memory = new MemorySystem(user.id);
          await memory.initIndexedDB();
          setMemorySystem(memory);
          setIsInitialized(true);
          
          // Track initial page visit
          memory.trackPageVisit(window.location.pathname, 'app_start');
          
          // Load recent data
          loadRecentData(memory);
          
          // Start tracking
          trackingRef.current = true;
          setupGlobalTracking(memory);
          
        } catch (error) {
          console.error('Failed to initialize memory system:', error);
        }
      }
    };

    initializeMemory();
  }, [isAuthenticated, user, memorySystem]);

  // Cleanup when user logs out
  useEffect(() => {
    if (!isAuthenticated && memorySystem) {
      memorySystem.destroy();
      setMemorySystem(null);
      setIsInitialized(false);
      setSearchResults(null);
      setRecentActivities([]);
      setConversationHistory([]);
      trackingRef.current = false;
    }
  }, [isAuthenticated, memorySystem]);

  const loadRecentData = async (memory) => {
    try {
      // Load recent activities
      const activities = await memory.getActivityLog({ limit: 50 });
      setRecentActivities(activities);
      
      // Load conversation history
      const conversations = await memory.getConversationHistory({ 
        sortBy: 'lastUpdated',
        limit: 20 
      });
      setConversationHistory(conversations);
    } catch (error) {
      console.error('Error loading recent data:', error);
    }
  };

  const setupGlobalTracking = (memory) => {
    // Track all clicks
    const clickHandler = (event) => {
      if (!trackingRef.current) return;
      
      const target = event.target;
      const tagName = target.tagName.toLowerCase();
      
      // Track link clicks
      if (tagName === 'a') {
        const href = target.href;
        const text = target.textContent.trim();
        memory.trackLinkClick(href, text, target.target);
      }
      
      // Track button clicks
      if (tagName === 'button' || target.role === 'button') {
        const text = target.textContent.trim();
        const action = target.getAttribute('data-action') || 'button_click';
        memory.trackActivity('button_click', {
          text,
          action,
          className: target.className
        });
      }
      
      // Track input focus
      if (['input', 'textarea'].includes(tagName)) {
        memory.trackActivity('input_focus', {
          type: target.type,
          placeholder: target.placeholder,
          name: target.name
        });
      }
    };

    // Track keyboard shortcuts
    const keyHandler = (event) => {
      if (!trackingRef.current) return;
      
      // Track specific keyboard shortcuts
      if (event.ctrlKey || event.metaKey) {
        const shortcuts = {
          'KeyS': 'save',
          'KeyF': 'search',
          'KeyN': 'new',
          'KeyZ': 'undo',
          'KeyY': 'redo'
        };
        
        if (shortcuts[event.code]) {
          memory.trackActivity('keyboard_shortcut', {
            shortcut: shortcuts[event.code],
            key: event.key,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey
          });
        }
      }
    };

    // Track scroll behavior
    let scrollTimer;
    const scrollHandler = () => {
      if (!trackingRef.current) return;
      
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        memory.trackActivity('scroll', {
          scrollY: window.scrollY,
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
          scrollPercentage: Math.round((window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100)
        });
      }, 500);
    };

    // Add event listeners
    document.addEventListener('click', clickHandler, true);
    document.addEventListener('keydown', keyHandler, true);
    window.addEventListener('scroll', scrollHandler, { passive: true });

    // Store cleanup function
    memory.globalCleanup = () => {
      document.removeEventListener('click', clickHandler, true);
      document.removeEventListener('keydown', keyHandler, true);
      window.removeEventListener('scroll', scrollHandler);
    };
  };

  // Context API methods
  const trackInput = (input, context = '') => {
    if (memorySystem && trackingRef.current) {
      return memorySystem.trackInput(input, context);
    }
  };

  const trackSearch = async (query, results = []) => {
    if (memorySystem && trackingRef.current) {
      const activity = memorySystem.trackSearch(query, results);
      
      // Update recent activities
      setRecentActivities(prev => [activity, ...prev.slice(0, 49)]);
      
      return activity;
    }
  };

  const trackConversation = async (conversation) => {
    if (memorySystem && trackingRef.current) {
      const savedConversation = await memorySystem.saveConversation(conversation);
      
      // Update conversation history
      setConversationHistory(prev => {
        const filtered = prev.filter(c => c.id !== savedConversation.id);
        return [savedConversation, ...filtered].slice(0, 19);
      });
      
      return savedConversation;
    }
  };

  const searchMemory = async (query, filters = {}) => {
    if (!memorySystem) return null;
    
    try {
      const results = await memorySystem.searchMemory(query, filters);
      setSearchResults(results);
      
      // Track the search
      trackSearch(query, [...results.conversations, ...results.activities]);
      
      return results;
    } catch (error) {
      console.error('Error searching memory:', error);
      return null;
    }
  };

  const getConversationContext = async (query) => {
    if (!memorySystem) return null;
    
    try {
      // Search for related conversations and activities
      const results = await memorySystem.searchMemory(query, {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() // Last 30 days
      });
      
      // Format context for AI
      const context = {
        relatedConversations: results.conversations.slice(0, 3).map(conv => ({
          title: conv.title,
          summary: conv.summary,
          tags: conv.tags,
          timestamp: conv.timestamp
        })),
        recentActivities: results.activities.slice(0, 5).map(activity => ({
          type: activity.type,
          data: activity.data,
          timestamp: activity.timestamp
        })),
        searchHistory: await getRecentSearches()
      };
      
      return context;
    } catch (error) {
      console.error('Error getting conversation context:', error);
      return null;
    }
  };

  const getRecentSearches = async () => {
    if (!memorySystem) return [];
    
    try {
      const activities = await memorySystem.getActivityLog({
        type: 'search',
        limit: 10
      });
      
      return activities.map(activity => ({
        query: activity.data.query,
        timestamp: activity.timestamp,
        resultsCount: activity.data.resultsCount
      }));
    } catch (error) {
      console.error('Error getting recent searches:', error);
      return [];
    }
  };

  const deleteConversation = async (conversationId) => {
    if (!memorySystem) return false;
    
    try {
      await memorySystem.deleteConversation(conversationId);
      
      // Update conversation history
      setConversationHistory(prev => prev.filter(c => c.id !== conversationId));
      
      return true;
    } catch (error) {
      console.error('Error deleting conversation:', error);
      return false;
    }
  };

  const exportMemoryData = async () => {
    if (!memorySystem) return null;
    
    try {
      return await memorySystem.exportMemoryData();
    } catch (error) {
      console.error('Error exporting memory data:', error);
      return null;
    }
  };

  const importMemoryData = async (data) => {
    if (!memorySystem) return false;
    
    try {
      const success = await memorySystem.importMemoryData(data);
      
      if (success) {
        // Reload recent data
        await loadRecentData(memorySystem);
      }
      
      return success;
    } catch (error) {
      console.error('Error importing memory data:', error);
      return false;
    }
  };

  const clearAllMemory = async () => {
    if (!memorySystem) return false;
    
    try {
      await memorySystem.clearAllMemory();
      
      // Clear state
      setSearchResults(null);
      setRecentActivities([]);
      setConversationHistory([]);
      
      return true;
    } catch (error) {
      console.error('Error clearing memory:', error);
      return false;
    }
  };

  const generateConversationTitle = (messages) => {
    if (!memorySystem) return 'New Conversation';
    return memorySystem.generateConversationTitle(messages);
  };

  const getMemoryStats = async () => {
    if (!memorySystem) return null;
    
    try {
      const [conversations, activities, searchIndex] = await Promise.all([
        memorySystem.getConversationHistory(),
        memorySystem.getActivityLog({ limit: 10000 }),
        memorySystem.getSearchIndex()
      ]);
      
      return {
        conversationCount: conversations.length,
        activityCount: activities.length,
        searchTermCount: searchIndex.length,
        totalWordCount: conversations.reduce((total, conv) => total + (conv.wordCount || 0), 0),
        oldestActivity: activities.length > 0 ? activities[activities.length - 1].timestamp : null,
        newestActivity: activities.length > 0 ? activities[0].timestamp : null
      };
    } catch (error) {
      console.error('Error getting memory stats:', error);
      return null;
    }
  };

  const value = {
    // State
    memorySystem,
    isInitialized,
    searchResults,
    recentActivities,
    conversationHistory,
    
    // Tracking methods
    trackInput,
    trackSearch,
    trackConversation,
    
    // Search and retrieval
    searchMemory,
    getConversationContext,
    getRecentSearches,
    
    // Management methods
    deleteConversation,
    exportMemoryData,
    importMemoryData,
    clearAllMemory,
    
    // Utility methods
    generateConversationTitle,
    getMemoryStats,
    
    // Manual activity tracking
    trackActivity: (type, data) => {
      if (memorySystem && trackingRef.current) {
        return memorySystem.trackActivity(type, data);
      }
    }
  };

  return (
    <MemoryContext.Provider value={value}>
      {children}
    </MemoryContext.Provider>
  );
};

export default MemoryContext; 