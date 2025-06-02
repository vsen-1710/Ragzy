/**
 * Chat Storage Utility
 * Manages localStorage for the hierarchical chat system with user isolation
 */

export class ChatStorage {
  constructor(userId, userEmail = null) {
    this.userId = userId;
    this.userEmail = userEmail;
    this.storageKey = `chatData_${userId}`;
    this.emailKey = userEmail ? `chatData_email_${userEmail}` : null;
  }

  /**
   * Get the complete chat structure for the user with email fallback
   */
  getUserChatData() {
    try {
      // First try to get by userId
      let data = localStorage.getItem(this.storageKey);
      
      // If no data found and we have email, try email-based key
      if (!data && this.emailKey) {
        data = localStorage.getItem(this.emailKey);
        if (data) {
          // Migrate data to userId-based key
          localStorage.setItem(this.storageKey, data);
        }
      }
      
      return data ? JSON.parse(data) : {
        userId: this.userId,
        userEmail: this.userEmail,
        chats: [],
        currentChatId: null,
        currentSubChatId: null,
        lastUpdated: new Date().toISOString(),
        migrations: {
          emailToId: this.emailKey ? new Date().toISOString() : null
        }
      };
    } catch (error) {
      console.error('Error reading chat data from localStorage:', error);
      return {
        userId: this.userId,
        userEmail: this.userEmail,
        chats: [],
        currentChatId: null,
        currentSubChatId: null,
        lastUpdated: new Date().toISOString(),
        migrations: {}
      };
    }
  }

  /**
   * Save the complete chat structure with email backup
   */
  saveUserChatData(data) {
    try {
      const enrichedData = {
        ...data,
        userId: this.userId,
        userEmail: this.userEmail,
        lastUpdated: new Date().toISOString()
      };
      
      // Save to userId-based key
      localStorage.setItem(this.storageKey, JSON.stringify(enrichedData));
      
      // Also save to email-based key for backup/cross-device access
      if (this.emailKey) {
        localStorage.setItem(this.emailKey, JSON.stringify(enrichedData));
      }
      
      return true;
    } catch (error) {
      console.error('Error saving chat data to localStorage:', error);
      return false;
    }
  }

  /**
   * Save a main chat
   */
  saveMainChat(chat) {
    const data = this.getUserChatData();
    const existingIndex = data.chats.findIndex(c => c.chatId === chat.id);
    
    const chatData = {
      chatId: chat.id,
      title: chat.title || 'New Chat',
      created_at: chat.created_at || new Date().toISOString(),
      subChats: existingIndex >= 0 ? data.chats[existingIndex].subChats || [] : []
    };

    if (existingIndex >= 0) {
      data.chats[existingIndex] = chatData;
    } else {
      data.chats.push(chatData);
    }

    return this.saveUserChatData(data);
  }

  /**
   * Save a sub-chat under a parent chat
   */
  saveSubChat(parentId, subChat) {
    const data = this.getUserChatData();
    let parentChat = data.chats.find(c => c.chatId === parentId);
    
    if (!parentChat) {
      // Create parent chat if it doesn't exist
      parentChat = {
        chatId: parentId,
        title: 'Main Chat',
        created_at: new Date().toISOString(),
        subChats: []
      };
      data.chats.push(parentChat);
    }

    if (!parentChat.subChats) {
      parentChat.subChats = [];
    }

    const subChatData = {
      subChatId: subChat.id,
      title: subChat.title || 'New Sub-chat',
      created_at: subChat.created_at || new Date().toISOString(),
      messages: subChat.messages || []
    };

    const existingIndex = parentChat.subChats.findIndex(sc => sc.subChatId === subChat.id);
    if (existingIndex >= 0) {
      parentChat.subChats[existingIndex] = subChatData;
    } else {
      parentChat.subChats.push(subChatData);
    }

    return this.saveUserChatData(data);
  }

  /**
   * Save messages for a specific chat (main or sub)
   */
  saveChatMessages(chatId, messages, isSubChat = false, parentChatId = null) {
    if (isSubChat && parentChatId) {
      // Update sub-chat messages
      const data = this.getUserChatData();
      const parentChat = data.chats.find(c => c.chatId === parentChatId);
      
      if (parentChat && parentChat.subChats) {
        const subChat = parentChat.subChats.find(sc => sc.subChatId === chatId);
        if (subChat) {
          subChat.messages = messages;
          subChat.lastUpdated = new Date().toISOString();
          return this.saveUserChatData(data);
        }
      }
    }
    
    // For legacy support or main chat messages, also save in old format
    try {
      localStorage.setItem(`chatMessages_${chatId}`, JSON.stringify(messages));
      return true;
    } catch (error) {
      console.error('Error saving chat messages:', error);
      return false;
    }
  }

  /**
   * Set the current active chat and sub-chat
   */
  setCurrentChat(mainChatId, subChatId = null) {
    const data = this.getUserChatData();
    data.currentChatId = mainChatId;
    data.currentSubChatId = subChatId;
    return this.saveUserChatData(data);
  }

  /**
   * Generate a smart title based on conversation messages
   */
  generateChatTitle(messages) {
    if (!messages || messages.length === 0) return 'New Chat';
    
    const firstUserMessage = messages.find(msg => msg.role === 'user');
    if (!firstUserMessage) return 'New Chat';

    const content = firstUserMessage.content.trim();
    
    // Extract key topics or questions
    const title = content
      .substring(0, 50) // Limit length
      .replace(/[?!.]+$/, '') // Remove trailing punctuation
      .replace(/^\w/, c => c.toUpperCase()); // Capitalize first letter

    return title || 'New Chat';
  }

  /**
   * Get messages for a specific chat
   */
  getChatMessages(chatId, isSubChat = false, parentChatId = null) {
    if (isSubChat && parentChatId) {
      const data = this.getUserChatData();
      const parentChat = data.chats.find(c => c.chatId === parentChatId);
      
      if (parentChat && parentChat.subChats) {
        const subChat = parentChat.subChats.find(sc => sc.subChatId === chatId);
        return subChat ? subChat.messages || [] : [];
      }
    }
    
    // Fallback to legacy storage
    try {
      const messages = localStorage.getItem(`chatMessages_${chatId}`);
      return messages ? JSON.parse(messages) : [];
    } catch (error) {
      console.error('Error reading chat messages:', error);
      return [];
    }
  }

  /**
   * Delete a main chat and all its sub-chats
   */
  deleteMainChat(chatId) {
    const data = this.getUserChatData();
    data.chats = data.chats.filter(c => c.chatId !== chatId);
    
    // Also clean up legacy storage
    this.cleanupLegacyStorage(chatId);
    
    return this.saveUserChatData(data);
  }

  /**
   * Delete a specific sub-chat
   */
  deleteSubChat(parentChatId, subChatId) {
    const data = this.getUserChatData();
    const parentChat = data.chats.find(c => c.chatId === parentChatId);
    
    if (parentChat && parentChat.subChats) {
      parentChat.subChats = parentChat.subChats.filter(sc => sc.subChatId !== subChatId);
    }
    
    // Clean up legacy storage
    this.cleanupLegacyStorage(subChatId);
    
    return this.saveUserChatData(data);
  }

  /**
   * Clean up legacy localStorage entries
   */
  cleanupLegacyStorage(chatId) {
    try {
      localStorage.removeItem(`chatMessages_${chatId}`);
      localStorage.removeItem(`conversation_${chatId}`);
      
      // Remove any other chat-related keys
      Object.keys(localStorage).forEach(key => {
        if (key.includes(chatId)) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.error('Error cleaning up legacy storage:', error);
    }
  }

  /**
   * Clear all user data
   */
  clearAll() {
    try {
      // Remove structured data
      localStorage.removeItem(this.storageKey);
      
      // Clean up all user-related keys
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('chatMessages') ||
          key.startsWith('conversation') ||
          key.startsWith('currentConversation') ||
          key.startsWith(`chatData_${this.userId}`) ||
          key.includes('chat') ||
          key.includes('message')
        )) {
          keysToRemove.push(key);
        }
      }
      
      keysToRemove.forEach(key => localStorage.removeItem(key));
      
      return true;
    } catch (error) {
      console.error('Error clearing all data:', error);
      return false;
    }
  }

  /**
   * Migrate legacy localStorage data to new structure
   */
  migrate() {
    try {
      const existingData = this.getUserChatData();
      
      // If we already have structured data, skip migration
      if (existingData.chats && existingData.chats.length > 0) {
        return true;
      }

      // Look for legacy conversation data
      const currentConvId = localStorage.getItem('currentConversationId');
      const currentMessages = localStorage.getItem('chatMessages');
      
      if (currentConvId && currentMessages) {
        try {
          const messages = JSON.parse(currentMessages);
          const title = this.generateChatTitle(messages);
          
          // Create main chat from legacy data
          const mainChat = {
            chatId: currentConvId,
            title: title,
            created_at: new Date().toISOString(),
            subChats: []
          };

          existingData.chats = [mainChat];
          existingData.currentChatId = currentConvId;
          
          // Save messages in new format
          this.saveChatMessages(currentConvId, messages, false);
          
          // Save new structure
          this.saveUserChatData(existingData);
          
          console.log('Successfully migrated legacy chat data');
        } catch (error) {
          console.error('Error parsing legacy messages:', error);
        }
      }

      return true;
    } catch (error) {
      console.error('Error during migration:', error);
      return false;
    }
  }

  /**
   * Load chat history for user on login
   */
  loadUserChatHistory() {
    const data = this.getUserChatData();
    
    // Load all conversations and messages
    const conversations = data.chats || [];
    const loadedChats = [];
    
    conversations.forEach(chat => {
      const chatData = {
        id: chat.chatId,
        title: chat.title,
        created_at: chat.created_at,
        messages: []
      };
      
      // Load main chat messages
      const mainMessages = this.getChatMessages(chat.chatId);
      if (mainMessages.length > 0) {
        chatData.messages = mainMessages;
      }
      
      // Load sub-chat messages
      if (chat.subChats && chat.subChats.length > 0) {
        chatData.subChats = chat.subChats.map(subChat => ({
          id: subChat.subChatId,
          title: subChat.title,
          created_at: subChat.created_at,
          messages: subChat.messages || []
        }));
      }
      
      loadedChats.push(chatData);
    });
    
    return {
      chats: loadedChats,
      currentChatId: data.currentChatId,
      currentSubChatId: data.currentSubChatId,
      lastUpdated: data.lastUpdated
    };
  }
}

// Default export for backward compatibility
export default ChatStorage; 