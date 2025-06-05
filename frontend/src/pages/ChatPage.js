import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  TextField,
  Typography,
  CircularProgress,
  Chip,
  IconButton,
  useTheme,
  useMediaQuery,
  Snackbar,
  Alert,
  Button,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Fab,
  Tooltip,
  SpeedDial,
  SpeedDialAction,
  SpeedDialIcon
} from '@mui/material';
import {
  Send as SendIcon,
  Stop as StopIcon,
  AttachFile as AttachFileIcon,
  MoreVert as MoreVertIcon,
  Share as ShareIcon,
  Edit as EditIcon,
  Image as ImageIcon,
  Close as CloseIcon,
  Timeline as TimelineIcon,
  Assessment as AssessmentIcon,
  Settings as SettingsIcon,
  History as HistoryIcon
} from '@mui/icons-material';
import axios from 'axios';
import { API_CONFIG } from '../config/api';
import { useAuth } from '../contexts/AuthContext';
import { useMemory } from '../contexts/MemoryContext';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import { ChatStorage } from '../utils/chatStorage';
import { 
  getKeywordResponse, 
  calculateThinkingTime, 
  formatUserMessage,
  formatAssistantMessage,
  formatTypingMessage
} from '../utils/chatEnhancements';
import { BrowserActivityTracker } from '../utils/browserActivityTracker';
import MessageBubble from '../components/MessageBubble';
import BrowserTrackingToggle from '../components/BrowserTrackingToggle';
import BrowserTrackingHistory from '../components/BrowserTrackingHistory';
import './ChatPage.css';
import { ChatMemoryManager } from '../utils/chatMemoryManager';
import { ChatGPTIntegration } from '../utils/chatGPTIntegration';

const API_URL = API_CONFIG.BASE_URL;

function ChatPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { getAuthHeaders, user } = useAuth();
  const { 
    trackInput, 
    trackConversation, 
    generateConversationTitle, 
    isInitialized: memoryInitialized 
  } = useMemory();
  
  // Initialize storage and tracking
  const chatStorage = useRef(null);
  const browserTracker = useRef(null);
  const abortControllerRef = useRef(null);
  const textFieldRef = useRef(null);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  
  // Core state
  const [messages, setMessages] = useState(() => loadInitialMessages());
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [canCancel, setCanCancel] = useState(false);
  const [error, setError] = useState(null);
  const [conversationId, setConversationId] = useState(() => getInitialConversationId());
  
  // Browser tracking state
  const [showBrowserTrackingHistory, setShowBrowserTrackingHistory] = useState(false);
  const [isBrowserTrackingEnabled, setIsBrowserTrackingEnabled] = useState(false);
  
  // Recovery state for mid-response persistence
  const [currentRequestId, setCurrentRequestId] = useState(null);
  const [responseState, setResponseState] = useState(() => loadResponseState());
  
  // Chat hierarchy state
  const [isSubChat, setIsSubChat] = useState(false);
  const [parentChatId, setParentChatId] = useState(null);
  const [chatTitle, setChatTitle] = useState('');
  const [autoNamingPending, setAutoNamingPending] = useState(false);
  
  // UI state
  const [connectionStatus, setConnectionStatus] = useState('connected');
  const [copySnackbar, setCopySnackbar] = useState(false);
  const [scrollPosition, setScrollPosition] = useState(() => getInitialScrollPosition());
  const [showKeyboardHint, setShowKeyboardHint] = useState(false);
  const [success, setSuccess] = useState('');
  
  // Dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [shareExpiresAt, setShareExpiresAt] = useState(null);
  const [menuAnchorEl, setMenuAnchorEl] = useState(null);
  const [selectedChatId, setSelectedChatId] = useState(null);
  
  // File upload state
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploadError, setUploadError] = useState('');

  // Sub-chat/Thread functionality state
  const [showSubChatDialog, setShowSubChatDialog] = useState(false);
  const [selectedMessageForThread, setSelectedMessageForThread] = useState(null);
  const [threadTitle, setThreadTitle] = useState('');

  // Initialize ChatGPT integration
  const chatGPTIntegration = useRef(null);

  // Initialize storage and tracking
  useEffect(() => {
    if (user?.id) {
      chatStorage.current = new ChatStorage(user.id, user.email);
      chatStorage.current.migrate();
      
      // Initialize browser tracker
      browserTracker.current = new BrowserActivityTracker(user.id);
      
      // Get the actual tracking state from the tracker
      const isTrackingEnabled = browserTracker.current.isTrackingEnabled();
      setIsBrowserTrackingEnabled(isTrackingEnabled);
      
      console.log(`Browser tracking initialized: ${isTrackingEnabled}`);
      
      // Clean up legacy generic keys that might cause cross-chat contamination
      const cleanupLegacyKeys = () => {
        try {
          // Remove the generic chatMessages key to prevent new chats from showing old history
          localStorage.removeItem('chatMessages');
          console.log('Cleaned up legacy generic chatMessages key');
        } catch (error) {
          console.error('Error cleaning up legacy keys:', error);
        }
      };
      
      cleanupLegacyKeys();
    }
    
    return () => {
      if (browserTracker.current) {
        browserTracker.current.stopTracking();
      }
    };
  }, [user]);

  // Recovery logic for mid-response states
  useEffect(() => {
    if (responseState && responseState.conversationId === conversationId) {
      console.log('Recovering mid-response state:', responseState);
      
      // Restore UI state
      if (responseState.state.loading) {
        setLoading(true);
        setCanCancel(true);
      }
      if (responseState.state.isTyping) {
        setIsTyping(true);
      }
      
      // Set current request ID for potential recovery
      setCurrentRequestId(responseState.requestId);
      
      // Clear the state after recovery
      setTimeout(() => {
        clearResponseState();
        setLoading(false);
        setIsTyping(false);
        setCanCancel(false);
      }, 2000); // Give 2 seconds to complete recovery
    }
  }, [responseState, conversationId]);

  // Helper functions for initial state
  function loadInitialMessages() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const convId = urlParams.get('conversation');
      const savedConvId = localStorage.getItem('currentConversationId');
      const activeConvId = convId || savedConvId;
      
      // Only load messages if we have a specific conversation ID
      if (activeConvId) {
        const conversationMessages = localStorage.getItem(`chatMessages_${activeConvId}`);
        if (conversationMessages) {
          return JSON.parse(conversationMessages);
        }
        
        const backupMessages = localStorage.getItem(`conversation_backup_${activeConvId}`);
        if (backupMessages) {
          const backup = JSON.parse(backupMessages);
          localStorage.setItem(`chatMessages_${activeConvId}`, JSON.stringify(backup.messages));
          return backup.messages;
        }
      }
      
      // For new chats or chats without specific conversation ID, start with empty messages
      // Do NOT fall back to generic 'chatMessages' to prevent showing previous chat history
      return [];
    } catch (error) {
      console.error('Error loading messages:', error);
      return [];
    }
  }

  function getInitialConversationId() {
    try {
      // First, check URL parameters for conversation ID (highest priority)
      const urlParams = new URLSearchParams(window.location.search);
      const urlConvId = urlParams.get('conversation');
      
      if (urlConvId && urlConvId !== 'null' && urlConvId !== 'undefined') {
        // Update localStorage to match URL
        localStorage.setItem('currentConversationId', urlConvId);
        return urlConvId;
      }
      
      // Fallback to localStorage only if no URL parameter
      const savedId = localStorage.getItem('currentConversationId');
      if (savedId && savedId !== 'null' && savedId !== 'undefined') {
        return savedId;
      }
      
      // Clean up invalid entries
      localStorage.removeItem('currentConversationId');
      return null;
    } catch (error) {
      console.error('Error loading conversationId:', error);
      return null;
    }
  }

  function getInitialScrollPosition() {
    try {
      const saved = sessionStorage.getItem('chatScrollPosition');
      return saved ? parseInt(saved, 10) : 0;
    } catch {
      return 0;
    }
  }

  function validateMessagePairs(messages) {
    const validatedMessages = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'user') {
        const nextAssistantMsg = messages.find((m, idx) => 
          idx > i && m.role === 'assistant' && !m.isTyping
        );
        validatedMessages.push(msg);
        if (nextAssistantMsg && !validatedMessages.includes(nextAssistantMsg)) {
          validatedMessages.push(nextAssistantMsg);
        }
      } else if (msg.role === 'assistant' && !msg.isTyping && !validatedMessages.includes(msg)) {
        validatedMessages.push(msg);
      }
    }
    return validatedMessages;
  }

  const saveMessagesWithRedundancy = useCallback((conversationId, validatedMessages) => {
    try {
      if (chatStorage.current) {
        chatStorage.current.saveChatMessages(conversationId, validatedMessages, isSubChat, parentChatId);
      }
      
      // Only save to conversation-specific keys to prevent cross-chat contamination
      localStorage.setItem(`chatMessages_${conversationId}`, JSON.stringify(validatedMessages));
      localStorage.setItem(`conversation_backup_${conversationId}`, JSON.stringify({
        id: conversationId,
        messages: validatedMessages,
        timestamp: new Date().toISOString(),
        isSubChat,
        parentChatId
      }));
      localStorage.setItem(`lastMessageTime_${conversationId}`, new Date().toISOString());
      
      console.log(`Saved ${validatedMessages.length} validated messages for conversation ${conversationId}`);
    } catch (error) {
      console.error('Error saving messages:', error);
    }
  }, [isSubChat, parentChatId]);

  // Enhanced message persistence with validation
  useEffect(() => {
    if (messages?.length > 0 && conversationId && chatStorage.current) {
      const validatedMessages = validateMessagePairs(messages);
      saveMessagesWithRedundancy(conversationId, validatedMessages);
    }
  }, [messages, conversationId, isSubChat, parentChatId, saveMessagesWithRedundancy]);

  // Scroll management
  const scrollToBottom = useCallback((behavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Handle URL changes and reset state for new conversations
  useEffect(() => {
    const handleURLChange = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const urlConvId = urlParams.get('conversation');
      
      // If URL conversation ID differs from current state, reset everything
      if (urlConvId !== conversationId) {
        console.log('Conversation changed:', conversationId, '->', urlConvId);
        
        // Update conversation ID
        setConversationId(urlConvId);
        
        // Clear current messages and load new ones
        if (urlConvId) {
          // Load messages for the specific conversation
          const newMessages = (() => {
            try {
              const conversationMessages = localStorage.getItem(`chatMessages_${urlConvId}`);
              if (conversationMessages) {
                return JSON.parse(conversationMessages);
              }
              
              const backupMessages = localStorage.getItem(`conversation_backup_${urlConvId}`);
              if (backupMessages) {
                const backup = JSON.parse(backupMessages);
                localStorage.setItem(`chatMessages_${urlConvId}`, JSON.stringify(backup.messages));
                return backup.messages;
              }
              
              return [];
            } catch (error) {
              console.error('Error loading new conversation messages:', error);
              return [];
            }
          })();
          
          setMessages(newMessages);
          localStorage.setItem('currentConversationId', urlConvId);
        } else {
          // No conversation ID, start fresh
          setMessages([]);
          localStorage.removeItem('currentConversationId');
        }
        
        // Reset UI state
        setLoading(false);
        setIsTyping(false);
        setCanCancel(false);
        setError(null);
        clearResponseState();
      }
    };
    
    // Listen for browser navigation events
    window.addEventListener('popstate', handleURLChange);
    
    // Also check on mount
    handleURLChange();
    
    return () => {
      window.removeEventListener('popstate', handleURLChange);
    };
  }, [conversationId]);

  // Enhanced message sending with proper stop button handling
  const handleSendMessage = async () => {
    if ((!message.trim() && !selectedImage) || loading) return;

    // Send message regardless of tracking state - tracking only affects context
    await sendMessageInternal(message.trim(), selectedImage);
  };

  // Regenerate functionality - resend the same prompt
  const handleRegenerate = async (userMessage, hasImage = false) => {
    if (loading) return;
    
    // Set the message to the previous user message for regeneration
    await sendMessageInternal(userMessage, null, true);
  };

  // Internal message sending function used by both send and regenerate
  const sendMessageInternal = async (userMessage, imageFile = null, isRegenerate = false) => {
    const hasImage = imageFile !== null;
    const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    // Handle test commands
    const testResponse = handleTestCommands(userMessage);
    if (testResponse) {
      handleTestResponse(userMessage, testResponse, isRegenerate);
      return;
    }
    
    // Set up cancellation and show stop button immediately
    abortControllerRef.current = new AbortController();
    setCanCancel(true);
    setCurrentRequestId(requestId);
    
    // Get browser context (now respects tracking state)
    const contextualMessage = getBrowserContextualMessage(userMessage);
    
    // Track input
    if (memoryInitialized && userMessage) {
      trackInput(userMessage, 'chat_message');
    }
    
    // Add user message immediately (only if not regenerate)
    if (!isRegenerate) {
      const userMessageObj = formatUserMessage(userMessage, hasImage);
      setMessages(prev => [...prev, userMessageObj]);
    }
    
    // Save state for recovery
    saveResponseState(requestId, {
      userMessage: userMessage,
      loading: true,
      isTyping: false,
      stage: 'sending'
    });
    
    // Clear input (only if not regenerate)
    if (!isRegenerate) {
      setMessage('');
      handleRemoveImage();
      sessionStorage.removeItem('chatDraft');
    }
    
    // Show typing indicator
    setIsTyping(true);
    setLoading(true);
    setError('');
    
    const typingMessage = formatTypingMessage();
    setMessages(prev => [...prev, typingMessage]);
    setTimeout(() => scrollToBottom('auto'), 25);
    
    // Update state for typing phase
    saveResponseState(requestId, {
      userMessage: userMessage,
      loading: true,
      isTyping: true,
      stage: 'typing'
    });
    
    try {
      // Create conversation if needed
      let currentConversationId = conversationId;
      if (!currentConversationId) {
        currentConversationId = await createNewConversation(userMessage);
        if (!currentConversationId) return;
      }
      
      // Simulate thinking time
      const thinkingTime = Math.min(calculateThinkingTime(userMessage), 300);
      await new Promise(resolve => setTimeout(resolve, thinkingTime));
      
      // Update state for API call phase
      saveResponseState(requestId, {
        userMessage: userMessage,
        loading: true,
        isTyping: true,
        stage: 'api_call'
      });
      
      // Send message
      const response = await sendMessageToAPI(currentConversationId, contextualMessage, hasImage, imageFile);
      await handleAPIResponse(response, typingMessage.id, { role: 'user', content: userMessage, hasImage });
      
    } catch (error) {
      handleSendError(error, typingMessage.id, userMessage);
    } finally {
      setLoading(false);
      setIsTyping(false);
      setCanCancel(false);
      clearResponseState(); // Clear recovery state on completion
    }
  };

  function getBrowserContextualMessage(userMessage) {
    // Only add browser context if tracking is enabled
    if (!isBrowserTrackingEnabled || !browserTracker.current || !chatGPTIntegration.current) {
      return userMessage;
    }

    try {
      // Use the ChatGPT integration to generate intelligent context
      const { contextPrompt } = ChatMemoryManager.processMessage(userMessage);
      
      // Get search context specifically
      const searchContext = BrowserActivityTracker.getSearchContext(60); // Last hour
      const lastSearch = BrowserActivityTracker.getLastSearch();
      
      // Check if this is a contextual question
      const contextualKeywords = ['best', 'better', 'which', 'what', 'recommend', 'compare', 'vs', 'difference', 'choose', 'pick'];
      const isContextual = contextualKeywords.some(keyword => 
        userMessage.toLowerCase().includes(keyword)
      );
      
      // Enhanced message with search context
      let enhancedMessage = `[USER MESSAGE]: ${userMessage}\n\n`;
      
      if (searchContext?.lastQuery) {
        enhancedMessage += `🔍 [SEARCH CONTEXT]: User recently searched for "${searchContext.lastQuery}" on ${searchContext.lastDomain} (${searchContext.timeAgo})\n`;
        
        if (isContextual) {
          enhancedMessage += `💡 [CONTEXT HINT]: User is likely asking about "${searchContext.lastQuery}" - provide specific advice for this search topic\n`;
        }
        
        enhancedMessage += `📊 [RECENT SEARCHES]: ${searchContext.allQueries.slice(0, 3).join(', ')}\n\n`;
      }
      
      // Add browser activity summary (condensed)
      const activitySummary = browserTracker.current.getActivitySummary(15);
      if (activitySummary && !activitySummary.includes("No recent browser activity")) {
        // Extract just the search and context lines
        const lines = activitySummary.split('\n');
        const relevantLines = lines.filter(line => 
          line.includes('SEARCH') || 
          line.includes('most recent search') ||
          line.includes('which is best') ||
          line.includes('FOR AI ASSISTANT')
        ).slice(0, 5);
        
        if (relevantLines.length > 0) {
          enhancedMessage += `🧠 [AI CONTEXT]:\n${relevantLines.join('\n')}\n\n`;
        }
      }
      
      enhancedMessage += `[INSTRUCTIONS]: Behave like ChatGPT - friendly, helpful, and context-aware. If user asks contextual questions like "which is best?", refer to their recent search context above.`;
      
      return enhancedMessage;
    } catch (error) {
      console.error('Error getting enhanced context:', error);
      return userMessage;
    }
  }

  async function createNewConversation(userMessage) {
    try {
      const conversationTitle = memoryInitialized && userMessage ? 
        generateConversationTitle([{ role: 'user', content: userMessage }]) : 
        "New Conversation";

      const response = await axios.post(`${API_URL}/chat/conversations`, {
        title: conversationTitle
      }, {
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }
      });

      if (response.data.success && response.data.conversation?.id) {
        const newConversationId = response.data.conversation.id;
        setConversationId(newConversationId);
        localStorage.setItem('currentConversationId', newConversationId);
        window.history.pushState({}, '', `/?conversation=${newConversationId}`);
        window.dispatchEvent(new CustomEvent('reloadConversations'));
        return newConversationId;
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (error) {
      console.error('Error creating conversation:', error);
      setError(`Failed to create conversation: ${error.message}`);
      return null;
    }
  }

  async function sendMessageToAPI(conversationId, contextualMessage, hasImage, imageFile = null) {
    const fileToSend = imageFile || selectedImage;
    
    // Force fast, non-streaming responses
    const headers = { 
      ...getAuthHeaders(),
      'X-Force-Fast-Response': 'true',  // Custom header to force instant responses
      'X-No-Streaming': 'true'          // Explicitly disable streaming
    };
    
    if (hasImage && fileToSend) {
      const formData = new FormData();
      formData.append('message', contextualMessage || '');
      formData.append('image', fileToSend);
      
      return fetch(`${API_URL}/chat/conversations/${conversationId}/messages/with-image`, {
        method: 'POST',
        headers: headers,
        body: formData,
        signal: abortControllerRef.current.signal
      });
    } else {
      return fetch(`${API_URL}/chat/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          ...headers
        },
        body: JSON.stringify({ 
          message: contextualMessage,
          include_browser_context: isBrowserTrackingEnabled  // Tell backend to include context
        }),
        signal: abortControllerRef.current.signal
      });
    }
  }

  async function handleAPIResponse(response, typingMessageId, userMessageObj) {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data.success && data.message) {
      // Remove typing indicator
      setMessages(prev => prev.filter(msg => msg.id !== typingMessageId));
      setIsTyping(false);
      setCanCancel(false);
      
      // Add AI response for streaming with regenerate data
      const aiMessage = formatAssistantMessage(data.message.content, {
        id: data.message.id,
        isStreaming: true,
        timestamp: data.message.timestamp,
        regeneratePrompt: userMessageObj.content,
        regenerateHasImage: userMessageObj.hasImage || false
      });
      setMessages(prev => [...prev, aiMessage]);
      
      // Save conversation to memory
      if (memoryInitialized && trackConversation) {
        const finalMessages = [userMessageObj, data.message];
        trackConversation({
          id: conversationId,
          title: chatTitle || generateConversationTitle(finalMessages),
          messages: finalMessages,
          lastUpdated: new Date().toISOString()
        }).catch(console.warn);
      }
      
      setTimeout(scrollToBottom, 50);
    } else {
      throw new Error('API returned error');
    }
  }

  function handleSendError(error, typingMessageId, userMessage) {
    console.error('Error sending message:', error);
    
    if (error.name === 'AbortError') {
      return; // Cancel handled in cancelMessage
    }
    
    // Use keyword matching as fallback
    const keywordResponse = getKeywordResponse(userMessage);
    setMessages(prev => prev.filter(msg => msg.id !== typingMessageId));
    
    const fallbackMessage = formatAssistantMessage(keywordResponse, { 
      isFallback: true,
      regeneratePrompt: userMessage,
      regenerateHasImage: false
    });
    setMessages(prev => [...prev, fallbackMessage]);
    setTimeout(scrollToBottom, 50);
  }

  function handleTestResponse(userMessage, testResponse, isRegenerate = false) {
    if (!isRegenerate) {
      const userMsg = formatUserMessage(userMessage);
      setMessages(prev => [...prev, userMsg]);
    }
    
    setTimeout(() => {
      const testMsg = formatAssistantMessage(testResponse, {
        id: `test-${Date.now()}`,
        timestamp: new Date().toISOString(),
        regeneratePrompt: userMessage,
        regenerateHasImage: false
      });
      setMessages(prev => [...prev, testMsg]);
      
      if (chatStorage.current && conversationId) {
        if (!isRegenerate) {
          const userMsg = formatUserMessage(userMessage);
          chatStorage.current.saveMessage(conversationId, userMsg);
        }
        chatStorage.current.saveMessage(conversationId, testMsg);
      }
    }, 200);
    
    if (!isRegenerate) {
      setMessage('');
      setSelectedImage(null);
    }
    setTimeout(() => scrollToBottom('smooth'), 300);
  }

  // Handle test commands
  function handleTestCommands(userMessage) {
    const lowerMessage = userMessage.toLowerCase().trim();
    
    // Test search context functionality
    if (lowerMessage.startsWith('/test search ')) {
      const query = userMessage.slice(13).trim(); // Remove '/test search '
      if (query && browserTracker.current) {
        // Simulate the search
        browserTracker.current.simulateSearchQuery(query);
        return `🔍 **Simulated search for: "${query}"**\n\n` +
               `I've simulated that you searched for "${query}" on Google. ` +
               `Now try asking a contextual question like:\n` +
               `• "which is the best?"\n` +
               `• "what do you recommend?"\n` +
               `• "compare the options"\n\n` +
               `The AI should now understand you're referring to "${query}" based on your recent search context!`;
      } else {
        return "❌ Browser tracking is disabled or search query is empty. Enable tracking first.";
      }
    }
    
    // Quick test with predefined search
    if (lowerMessage === '/test context' || lowerMessage === '/demo') {
      if (browserTracker.current) {
        // Simulate a search for gaming laptops
        browserTracker.current.simulateSearchQuery('best gaming laptops 2024');
        return `🎮 **Demo: Search Context Test**\n\n` +
               `I've simulated that you just searched for "best gaming laptops 2024" on Google.\n\n` +
               `**Now ask me:** "which one is the best?" or "what do you recommend?"\n\n` +
               `The AI should understand you're asking about gaming laptops based on your search context! 🚀`;
      } else {
        return "❌ Browser tracking is disabled. Enable tracking to test search context.";
      }
    }
    
    // Show current search context
    if (lowerMessage === '/search status' || lowerMessage === '/context') {
      if (!browserTracker.current) {
        return "❌ Browser tracking is disabled.";
      }
      
      const searchContext = BrowserActivityTracker.getSearchContext(60);
      const recentSearches = BrowserActivityTracker.getRecentSearches(5);
      
      if (!searchContext) {
        return "📭 **No recent search context found.**\n\n" +
               "Try:\n" +
               "• `/test search [your query]` to simulate a search\n" +
               "• `/demo` for a quick gaming laptop demo\n" +
               "• Search on Google in another tab, then come back here";
      }
      
      let status = `🔍 **Current Search Context:**\n\n`;
      status += `**Last Search:** "${searchContext.lastQuery}"\n`;
      status += `**Domain:** ${searchContext.lastDomain}\n`;
      status += `**Time:** ${searchContext.timeAgo}\n\n`;
      
      if (recentSearches.length > 1) {
        status += `**Recent Searches:**\n`;
        recentSearches.slice(0, 3).forEach((search, idx) => {
          status += `${idx + 1}. "${search.query}" (${search.domain})\n`;
        });
      }
      
      status += `\n💡 **Try asking:** "which is best?" or "what do you recommend?"`;
      return status;
    }
    
    // Quick tracking history command
    if (lowerMessage === '/history' || lowerMessage === '/track history') {
      if (!isBrowserTrackingEnabled || !browserTracker.current) {
        return "❌ **Browser tracking is disabled.**\n\n" +
               "Enable tracking to view your activity history.\n" +
               "Use the toggle above or press **Ctrl+T** to enable.\n\n" +
               "🔗 **Quick Commands:**\n" +
               "• `/tracking help` - Show all tracking commands\n" +
               "• `/enable tracking` - Enable tracking quickly\n" +
               "• Press **Ctrl+H** to open full history dashboard";
      }
      
      setShowBrowserTrackingHistory(true);
      return "📊 **Opening tracking history dashboard...**\n\n" +
             "Your browser activity history is being displayed.\n\n" +
             "💡 **Pro tip:** Press **Ctrl+H** anytime to quickly access your history!";
    }
    
    // Enable tracking command
    if (lowerMessage === '/enable tracking' || lowerMessage === '/tracking on') {
      if (isBrowserTrackingEnabled) {
        return "✅ **Browser tracking is already enabled!**\n\n" +
               "Your activities are being tracked for smarter responses.\n\n" +
               "🔍 **Try these commands:**\n" +
               "• `/history` - View your activity history\n" +
               "• `/tracking stats` - See detailed statistics\n" +
               "• Press **Ctrl+H** for quick history access";
      }
      
      handleBrowserTrackingToggle(true);
      return "🚀 **Browser tracking enabled!**\n\n" +
             "I'll now provide more contextual and intelligent responses based on your browsing activity.\n\n" +
             "✨ **What's new:**\n" +
             "• Smarter responses based on your context\n" +
             "• Activity history tracking\n" +
             "• Press **Ctrl+H** to view history\n" +
             "• Press **Ctrl+T** to toggle tracking\n\n" +
             "Try asking me something related to what you've been working on!";
    }
    
    // Disable tracking command
    if (lowerMessage === '/disable tracking' || lowerMessage === '/tracking off') {
      if (!isBrowserTrackingEnabled) {
        return "ℹ️ **Browser tracking is already disabled.**\n\n" +
               "Use `/enable tracking` or press **Ctrl+T** to enable smart responses.";
      }
      
      handleBrowserTrackingToggle(false);
      return "⏸️ **Browser tracking disabled.**\n\n" +
             "I'll now provide basic responses without browsing context.\n\n" +
             "To re-enable: `/enable tracking` or press **Ctrl+T**";
    }
    
    // Tracking help command
    if (lowerMessage === '/tracking help' || lowerMessage === '/track help') {
      return "🎯 **Browser Tracking Commands & Shortcuts:**\n\n" +
             "**📱 Quick Commands:**\n" +
             "• `/history` - Open tracking history dashboard\n" +
             "• `/enable tracking` - Enable smart responses\n" +
             "• `/disable tracking` - Disable tracking\n" +
             "• `/tracking stats` - Show detailed statistics\n" +
             "• `/browser` - Browser activity test report\n" +
             "• `/clear activity` - Clear activity history\n" +
             "• `/test persistence` - Test if settings persist across refreshes\n\n" +
             "**⌨️ Keyboard Shortcuts:**\n" +
             "• **Ctrl+H** (Cmd+H on Mac) - Open history dashboard\n" +
             "• **Ctrl+T** (Cmd+T on Mac) - Toggle tracking on/off\n\n" +
             "**🔄 Auto-sync:** Activities sync every 30 seconds\n" +
             "**🔐 Privacy:** All data stays local unless you choose to sync\n\n" +
             "**💡 Smart Features:**\n" +
             "• Context-aware responses based on your activity\n" +
             "• Activity analytics and insights\n" +
             "• Real-time activity monitoring\n" +
             "• Engagement scoring for better recommendations";
    }
    
    // Test persistence across page refreshes
    if (lowerMessage === '/test persistence' || lowerMessage === '/persistence test') {
      if (!browserTracker.current) {
        return "❌ **Browser tracker not available**";
      }
      
      const currentState = browserTracker.current.isTrackingEnabled();
      const settingsKey = `browserTracker_${user?.id}_settings`;
      const storedSettings = localStorage.getItem(settingsKey);
      
      let response = "🧪 **Tracking Persistence Test:**\n\n";
      response += `**Current State:** ${currentState ? '✅ Enabled' : '❌ Disabled'}\n`;
      response += `**Settings Key:** \`${settingsKey}\`\n`;
      
      if (storedSettings) {
        try {
          const parsed = JSON.parse(storedSettings);
          response += `**Stored Settings:** ${JSON.stringify(parsed, null, 2)}\n`;
          response += `**Settings Match:** ${parsed.isEnabled === currentState ? '✅ Yes' : '❌ No'}\n\n`;
        } catch (e) {
          response += `**Stored Settings:** ❌ Invalid JSON\n\n`;
        }
      } else {
        response += `**Stored Settings:** ❌ None found\n\n`;
      }
      
      response += "**🔬 Test Instructions:**\n";
      response += "1. Toggle tracking on/off using the switch above\n";
      response += "2. Refresh the page (F5 or Ctrl+R)\n";
      response += "3. Run `/test persistence` again\n";
      response += "4. Check if the state persisted correctly\n\n";
      
      response += "**💡 Expected Behavior:**\n";
      response += "• Settings should persist across page refreshes\n";
      response += "• Your choice should be respected (not auto-enabled)\n";
      response += "• Backend should sync to match your preference\n";
      
      return response;
    }
    
    if (lowerMessage === '/test browser activity' || lowerMessage === '/browser') {
      if (!isBrowserTrackingEnabled) {
        return "❌ **Browser tracking is currently disabled.**\n\n" +
               "To test browser activity tracking:\n" +
               "1. Enable the Browser Tracking toggle above\n" +
               "2. Browse around for a few minutes\n" +
               "3. Run this command again\n\n" +
               "**Quick enable:** `/enable tracking` or press **Ctrl+T**\n\n" +
               "**Why enable tracking?**\n" +
               "• Get more relevant and contextual responses\n" +
               "• Better understanding of your current work\n" +
               "• Smarter assistance based on your browsing patterns\n" +
               "• All data stays private and local to your device";
      }
      
      if (browserTracker.current) {
        const activitySummary = browserTracker.current.getActivitySummary(30);
        const recentActivities = browserTracker.current.getRecentActivities(10);
        const trackingStats = browserTracker.current.getTrackingStats();
        
        let testResponse = "🔍 **Browser Activity Test Results:**\n\n";
        testResponse += "**📊 Tracking Status:**\n";
        testResponse += `• Status: ${trackingStats.isEnabled ? '✅ Enabled' : '❌ Disabled'}\n`;
        testResponse += `• Active: ${trackingStats.isTracking ? '🟢 Yes' : '🔴 No'}\n`;
        testResponse += `• Total Activities: ${trackingStats.totalActivities}\n`;
        testResponse += `• Recent (1h): ${trackingStats.recentActivities}\n`;
        testResponse += `• Storage: ${(trackingStats.storageSize / 1024).toFixed(1)} KB\n\n`;
        
        testResponse += "**🕒 Activity Summary:**\n" + activitySummary + "\n\n";
        
        if (recentActivities.length > 0) {
          testResponse += "**📝 Recent Activities (last 10 minutes):**\n";
          recentActivities.slice(0, 5).forEach((activity, idx) => {
            const time = new Date(activity.timestamp).toLocaleTimeString();
            const type = activity.type.replace('_', ' ').toUpperCase();
            testResponse += `${idx + 1}. [${time}] ${type}\n`;
          });
        } else {
          testResponse += "**📝 Recent Activities:** None detected\n";
        }
        
        testResponse += "\n**🎯 Available Commands:**\n";
        testResponse += "• `/history` - Open full tracking dashboard\n";
        testResponse += "• `/tracking help` - Show all commands & shortcuts\n";
        testResponse += "• `/tracking stats` - Show detailed statistics\n";
        testResponse += "• Press **Ctrl+H** for quick history access\n";
        
        return testResponse;
      }
      return "❌ Browser activity tracking is not initialized.";
    }
    
    if (lowerMessage === '/tracking stats') {
      if (!isBrowserTrackingEnabled || !browserTracker.current) {
        return "❌ Browser tracking is disabled. Enable it to see detailed statistics.\n\n" +
               "**Quick enable:** `/enable tracking` or press **Ctrl+T**";
      }
      
      const stats = browserTracker.current.getTrackingStats();
      const activities = browserTracker.current.getStoredActivities();
      
      // Calculate activity breakdown
      const breakdown = activities.reduce((acc, activity) => {
        acc[activity.type] = (acc[activity.type] || 0) + 1;
        return acc;
      }, {});
      
      let response = "📈 **Detailed Tracking Statistics:**\n\n";
      response += `🔹 **Status:** ${stats.isEnabled ? 'Enabled' : 'Disabled'} | `;
      response += `${stats.isTracking ? 'Active' : 'Inactive'}\n`;
      response += `🔹 **Session ID:** ${stats.sessionId}\n`;
      response += `🔹 **Total Activities:** ${stats.totalActivities}\n`;
      response += `🔹 **Recent (1h):** ${stats.recentActivities}\n`;
      response += `🔹 **Storage Used:** ${(stats.storageSize / 1024).toFixed(2)} KB\n`;
      
      if (stats.oldestActivity) {
        response += `🔹 **Tracking Since:** ${new Date(stats.oldestActivity).toLocaleString()}\n`;
      }
      if (stats.newestActivity) {
        response += `🔹 **Last Activity:** ${new Date(stats.newestActivity).toLocaleString()}\n`;
      }
      
      response += "\n**📊 Activity Breakdown:**\n";
      Object.entries(breakdown)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 8)
        .forEach(([type, count]) => {
          const emoji = {
            'click': '👆',
            'navigation': '🧭',
            'scroll': '📜',
            'tracking_started': '🚀',
            'visibility_change': '👀',
            'window_focus': '🎯',
            'key_navigation': '⌨️',
            'hash_change': '#️⃣'
          }[type] || '📊';
          response += `${emoji} ${type.replace('_', ' ')}: ${count}\n`;
        });
      
      response += "\n**🎯 Quick Actions:**\n";
      response += "• `/history` - View full activity timeline\n";
      response += "• `/clear activity` - Clear all stored data\n";
      response += "• Press **Ctrl+H** for visual dashboard\n";
      
      return response;
    }
    
    if (lowerMessage === '/clear activity') {
      if (browserTracker.current) {
        browserTracker.current.clearActivities();
        return "✅ **Browser activity history cleared.**\n\n" +
               "All stored activity data has been removed.\n" +
               "Tracking will continue to collect new activities.";
      }
      return "❌ Browser activity tracking is not available.";
    }
    
    // Quick tracking test command
    if (lowerMessage === '/track test' || lowerMessage === '/test tracking') {
      if (!isBrowserTrackingEnabled) {
        return "❌ **Browser tracking is disabled.**\n\n" +
               "**To test browser tracking:**\n" +
               "1. Enable tracking: `/enable tracking` or press **Ctrl+T**\n" +
               "2. Browse around for a few minutes\n" +
               "3. Run `/track test` again\n\n" +
               "**Why enable tracking?**\n" +
               "• Get contextual responses based on your browsing\n" +
               "• More relevant assistance for your current work\n" +
               "• Smart understanding of your workflow\n\n" +
               "Try asking questions related to what you're working on!";
      }
      
      if (browserTracker.current) {
        const stats = browserTracker.current.getTrackingStats();
        const activities = browserTracker.current.getStoredActivities();
        const recentActivities = browserTracker.current.getRecentActivities(10);
        const contextSummary = browserTracker.current.getActivitySummary(30);
        
        let response = "🧪 **Browser Tracking Test Results:**\n\n";
        
        response += "**📊 Tracking Status:**\n";
        response += `• **Enabled:** ${stats.isEnabled ? '✅ YES' : '❌ NO'}\n`;
        response += `• **Active:** ${stats.isTracking ? '🟢 Collecting Data' : '🔴 Not Collecting'}\n`;
        response += `• **Total Activities:** ${stats.totalActivities}\n`;
        response += `• **Recent (1h):** ${stats.recentActivities}\n`;
        response += `• **Storage:** ${(stats.storageSize / 1024).toFixed(2)} KB\n`;
        response += `• **Session ID:** ${stats.sessionId}\n\n`;
        
        if (stats.oldestActivity) {
          response += `• **First Activity:** ${new Date(stats.oldestActivity).toLocaleString()}\n`;
        }
        if (stats.newestActivity) {
          response += `• **Latest Activity:** ${new Date(stats.newestActivity).toLocaleString()}\n\n`;
        }
        
        response += "**🔍 Activity Context Summary:**\n";
        response += contextSummary + "\n\n";
        
        if (recentActivities.length > 0) {
          response += "**📝 Recent Activity Log:**\n";
          recentActivities.slice(0, 5).forEach((activity, idx) => {
            const time = new Date(activity.timestamp).toLocaleTimeString();
            const type = activity.type.replace('_', ' ').toUpperCase();
            const url = activity.data?.url || activity.data?.newUrl || '';
            const domain = url ? new URL(url).hostname.replace('www.', '') : '';
            response += `${idx + 1}. **[${time}]** ${type}`;
            if (domain) response += ` on ${domain}`;
            response += '\n';
          });
        } else {
          response += "**📝 Recent Activities:** No activities detected\n";
        }
        
        response += "\n**🎯 Test Your Context-Aware Chat:**\n";
        response += "Now ask me questions related to:\n";
        if (recentActivities.length > 0) {
          const domains = [...new Set(recentActivities
            .map(a => a.data?.url || a.data?.newUrl)
            .filter(url => url)
            .map(url => new URL(url).hostname.replace('www.', ''))
          )].slice(0, 3);
          
          domains.forEach(domain => {
            response += `• Something about ${domain}\n`;
          });
        }
        response += "• Your current work or research\n";
        response += "• Questions about what you've been browsing\n\n";
        
        response += "**💡 Commands:**\n";
        response += "• `/tracking stats` - Detailed analytics\n";
        response += "• `/history` - Open visual dashboard\n";
        response += "• Press **Ctrl+H** for quick history access\n";
        
        return response;
      }
      
      return "❌ Browser tracking system not initialized.";
    }
    
    return null;
  }

  // Cancel message generation
  const cancelMessage = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setLoading(false);
      setIsTyping(false);
      setCanCancel(false);
      
      setMessages(prev => prev.filter(msg => !msg.isTyping));
      
      const cancelMessage = {
        id: 'cancel-' + Date.now(),
        role: 'assistant',
        content: 'Response generation was cancelled.',
        timestamp: new Date().toISOString(),
        isCancelled: true
      };
      
      setMessages(prev => [...prev, cancelMessage]);
    }
  };

  // Input handling
  const handleKeyDown = (e) => {
    // Ctrl+H to open tracking history
    if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
      e.preventDefault();
      if (isBrowserTrackingEnabled) {
        setShowBrowserTrackingHistory(true);
      }
      return;
    }
    
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    setMessage(value);
    
    try {
      if (value.trim()) {
        sessionStorage.setItem('chatDraft', value);
      } else {
        sessionStorage.removeItem('chatDraft');
      }
    } catch (error) {
      console.error('Error saving draft:', error);
    }
    
    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = 'auto';
    
    const isSmallScreen = window.innerWidth < 600;
    const isTabletScreen = window.innerWidth >= 600 && window.innerWidth < 900;
    const maxHeight = isSmallScreen ? 84 : isTabletScreen ? 96 : 116;
    
    textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px';
  };

  // Image handling
  const handleImageSelect = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setUploadError('Please select a valid image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Image size must be less than 5MB');
      return;
    }

    setSelectedImage(file);
    setUploadError('');

    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target?.result);
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    setUploadError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleAttachmentClick = () => {
    if (selectedImage) {
      handleRemoveImage();
    } else {
      fileInputRef.current?.click();
    }
  };

  // Copy functionality
  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySnackbar(true);
    } catch (err) {
      console.error('Failed to copy text: ', err);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopySnackbar(true);
      } catch (fallbackErr) {
        console.error('Fallback copy failed: ', fallbackErr);
      }
      document.body.removeChild(textArea);
    }
  };

  // Utility functions
  const isDuplicateMessage = () => {
    if (!message.trim()) return false;
    const recentUserMessages = messages
      .filter(msg => msg.role === 'user')
      .slice(-5)
      .map(msg => msg.content.trim().toLowerCase());
    return recentUserMessages.includes(message.trim().toLowerCase());
  };

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return '#10a37f';
      case 'connecting': return '#f59e0b';
      case 'error': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const onStreamingComplete = () => {
    setTimeout(() => scrollToBottom('smooth'), 10);
  };

  function loadResponseState() {
    try {
      const saved = localStorage.getItem('activeResponseState');
      if (saved) {
        const state = JSON.parse(saved);
        // Check if the state is recent (within last 5 minutes)
        if (new Date() - new Date(state.timestamp) < 5 * 60 * 1000) {
          return state;
        }
        localStorage.removeItem('activeResponseState');
      }
      return null;
    } catch (error) {
      console.error('Error loading response state:', error);
      return null;
    }
  }

  function saveResponseState(requestId, state) {
    try {
      const responseStateData = {
        requestId,
        state,
        timestamp: new Date().toISOString(),
        conversationId,
        userMessage: state.userMessage || null,
        isTyping: state.isTyping || false,
        loading: state.loading || false
      };
      localStorage.setItem('activeResponseState', JSON.stringify(responseStateData));
    } catch (error) {
      console.error('Error saving response state:', error);
    }
  }

  function clearResponseState() {
    try {
      localStorage.removeItem('activeResponseState');
      setResponseState(null);
      setCurrentRequestId(null);
    } catch (error) {
      console.error('Error clearing response state:', error);
    }
  }

  // Enhanced browser tracking sync with backend
  const syncActivitiesWithBackend = useCallback(async () => {
    try {
      const activities = BrowserActivityTracker.getActivities();
      
      if (activities.length === 0) {
        return;
      }
      
      // Convert activities to backend format
      const formattedActivities = activities.map(activity => ({
        activity_type: activity.type,
        activity_data: activity.data,
        timestamp: activity.timestamp,
        session_id: activity.sessionId,
        url: activity.data?.url || activity.data?.newUrl || window.location.href,
        page_title: activity.data?.pageTitle || activity.data?.newTitle || document.title,
        engagement_score: Math.random() * 10 // Simplified for now
      }));
      
      // Send activities to backend
      const response = await fetch(`${API_URL}/api/browser-tracking/activities`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ activities: formattedActivities })
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log(`Synced ${result.stored_count} activities with backend`);
        
        // Clear synced activities from local storage
        BrowserActivityTracker.clearData();
      }
    } catch (error) {
      console.error('Failed to sync activities with backend:', error);
    }
  }, [getAuthHeaders]);

  // Render empty state
  const renderEmptyState = () => (
    <Box className="empty-state">
      <Box className="empty-state-content">
        <Box className="empty-state-avatar-container">
          <Box className="empty-state-avatar">R</Box>
        </Box>
        
        <Typography variant="h4" className="empty-state-title">
          How can I help you today?
        </Typography>
        
        <Typography className="empty-state-subtitle">
          I'm Ragzy, your AI assistant. Ask me anything!
        </Typography>

        <Box className="example-prompts">
          {[
            { icon: '💡', text: 'Explain quantum computing', color: '#fbbf24' },
            { icon: '📝', text: 'Write a professional email', color: '#34d399' },
            { icon: '🔍', text: 'Help me debug code', color: '#60a5fa' },
            { icon: '🎨', text: 'Create a project plan', color: '#f472b6' }
          ].map((prompt, index) => (
            <Button
              key={index}
              variant="outlined"
              onClick={() => setMessage(prompt.text)}
              className="example-prompt-button"
              sx={{
                '&:hover': {
                  borderColor: prompt.color,
                }
              }}
            >
              <Box className="example-prompt-content">
                <Box className="example-prompt-icon">{prompt.icon}</Box>
                <Typography className="example-prompt-text">{prompt.text}</Typography>
              </Box>
            </Button>
          ))}
        </Box>
      </Box>
    </Box>
  );

  // Enhanced browser tracking toggle with backend sync
  const handleBrowserTrackingToggle = useCallback(async (enabled) => {
    try {
      console.log(`Toggling browser tracking: ${enabled}`);
      setIsBrowserTrackingEnabled(enabled);
      
      // Update the tracker directly
      if (browserTracker.current) {
        if (enabled) {
          browserTracker.current.enableTracking();
        } else {
          browserTracker.current.disableTracking();
        }
      }
      
      // Update backend preference if available
      try {
        const endpoint = enabled ? '/enable' : '/disable';
        const response = await fetch(`${API_URL}/api/browser-tracking${endpoint}`, {
          method: 'POST',
          headers: getAuthHeaders()
        });
        
        if (response.ok) {
          console.log(`Backend tracking ${enabled ? 'enabled' : 'disabled'} successfully`);
          // Sync any pending activities if enabling
          if (enabled) {
            setTimeout(syncActivitiesWithBackend, 1000);
          }
        } else {
          console.warn('Backend update failed, but frontend state updated');
        }
      } catch (backendError) {
        console.warn('Backend unavailable, using local state only:', backendError);
      }
      
    } catch (error) {
      console.error('Failed to toggle browser tracking:', error);
      // Revert state on error
      setIsBrowserTrackingEnabled(!enabled);
    }
  }, [getAuthHeaders, syncActivitiesWithBackend]);
  
  // Handle tracking state changes from the toggle component
  const handleTrackingChange = useCallback((enabled) => {
    console.log(`Tracking state changed: ${enabled}`);
    setIsBrowserTrackingEnabled(enabled);
    
    // Ensure browserTracker is in sync
    if (browserTracker.current) {
      const trackerEnabled = browserTracker.current.isTrackingEnabled();
      if (trackerEnabled !== enabled) {
        if (enabled) {
          browserTracker.current.enableTracking();
        } else {
          browserTracker.current.disableTracking();
        }
      }
    }
  }, []);

  // Initialize browser tracking from backend on mount
  useEffect(() => {
    const initializeBrowserTracking = async () => {
      if (!user?.id || !browserTracker.current) return;
      
      try {
        // Get the user's stored preference (this is the source of truth)
        const localTrackingState = browserTracker.current.isTrackingEnabled();
        console.log(`🔧 User's stored tracking preference: ${localTrackingState}`);
        
        // Always respect the user's local preference - never override it
        setIsBrowserTrackingEnabled(localTrackingState);
        
        // Only start tracking if user has explicitly enabled it AND it's not already tracking
        if (localTrackingState && !browserTracker.current.isTracking) {
          console.log(`🚀 Starting tracking as per user's saved preference`);
          browserTracker.current.startTracking();
          browserTracker.current.startPeriodicSync();
          
          // Sync activities after starting
          setTimeout(syncActivitiesWithBackend, 1000);
        } else if (!localTrackingState) {
          console.log(`⏸️ Tracking disabled as per user's preference`);
          // Ensure tracking is stopped
          browserTracker.current.stopTracking();
        }
        
        // Optional: Sync preference with backend (but don't let backend override user choice)
        try {
          const endpoint = localTrackingState ? '/enable' : '/disable';
          await fetch(`${API_URL}/api/browser-tracking${endpoint}`, {
            method: 'POST',
            headers: getAuthHeaders()
          });
          console.log(`📡 Synced user preference with backend: ${localTrackingState}`);
        } catch (backendError) {
          console.log('📡 Backend sync failed, continuing with local preference');
        }
        
      } catch (error) {
        console.error('🚨 Error in tracking initialization:', error);
        // On any error, default to disabled for privacy
        setIsBrowserTrackingEnabled(false);
        browserTracker.current?.stopTracking();
      }
    };
    
    // Only initialize if we have a user and tracker
    if (user?.id && browserTracker.current) {
      initializeBrowserTracking();
    }
  }, [user?.id, getAuthHeaders, syncActivitiesWithBackend]);

  // Auto-sync activities periodically when tracking is enabled
  useEffect(() => {
    if (!isBrowserTrackingEnabled) return;
    
    const syncInterval = setInterval(() => {
      syncActivitiesWithBackend();
    }, 30000); // Sync every 30 seconds
    
    return () => clearInterval(syncInterval);
  }, [isBrowserTrackingEnabled, syncActivitiesWithBackend]);

  // Enhanced keyboard shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      // Only handle shortcuts if not typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }
      
      // Ctrl+H or Cmd+H to open tracking history
      if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault();
        if (isBrowserTrackingEnabled && browserTracker.current) {
          setShowBrowserTrackingHistory(true);
        }
      }
      
      // Ctrl+T or Cmd+T to toggle tracking
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault();
        if (browserTracker.current) {
          handleBrowserTrackingToggle(!isBrowserTrackingEnabled);
        }
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isBrowserTrackingEnabled, handleBrowserTrackingToggle]);

  // Show keyboard hint when tracking is first enabled
  useEffect(() => {
    if (isBrowserTrackingEnabled && browserTracker.current) {
      setShowKeyboardHint(true);
      const timer = setTimeout(() => {
        setShowKeyboardHint(false);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [isBrowserTrackingEnabled]);

  // Sub-chat/Thread functionality
  const handleCreateSubChat = (message) => {
    setSelectedMessageForThread(message);
    setThreadTitle(`Thread: ${message.content.substring(0, 50)}...`);
    setShowSubChatDialog(true);
  };

  const handleSubChatConfirm = async () => {
    if (!selectedMessageForThread || !threadTitle.trim()) return;
    
    try {
      setLoading(true);
      
      // Use the correct backend API endpoint for sub-conversations
      const response = await axios.post(`${API_URL}/chat/conversations/${conversationId}/sub-conversations`, {
        title: threadTitle.trim(),
        inherit_context: false // Fresh sub-chat for faster responses
      }, {
        headers: getAuthHeaders(),
        timeout: 10000 // 10 second timeout for fast response
      });

      if (response.data.success && response.data.conversation) {
        const newConversationId = response.data.conversation.id;
        
        // Navigate to new sub-chat conversation immediately
        window.location.href = `/?conversation=${newConversationId}`;
        
        // Show success message
        setSuccess(response.data.message || 'Thread created successfully! 🧵');
        
        // Close dialog immediately
        setShowSubChatDialog(false);
        setSelectedMessageForThread(null);
        setThreadTitle('');
      } else {
        throw new Error(response.data.error || 'Failed to create sub-chat');
      }
    } catch (error) {
      console.error('Error creating sub-chat:', error);
      
      // Show user-friendly error
      if (error.response?.status === 404) {
        setError('Sub-chat feature is currently unavailable. Please try again later.');
      } else if (error.response?.status === 401) {
        setError('Please log in to create threads.');
      } else {
        setError('Failed to create thread. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubChatCancel = () => {
    setShowSubChatDialog(false);
    setSelectedMessageForThread(null);
    setThreadTitle('');
  };

  // Initialize ChatGPT integration
  useEffect(() => {
    if (user && !chatGPTIntegration.current) {
      // Initialize ChatGPT integration with search context tracking
      chatGPTIntegration.current = ChatGPTIntegration.initialize(user.id);
      console.log('🤖 ChatGPT integration initialized for intelligent context-aware responses');
    }
  }, [user]);

  // Enhanced Browser Extension Integration - Cross-tab tracking
  useEffect(() => {
    if (!user?.id) return;

    // Create extension connector for communication with browser extension
    window.ragbotExtensionConnector = {
      requestConnection: async () => {
        try {
          const authToken = localStorage.getItem('authToken');
          if (!authToken) {
            console.warn('No auth token available for extension connection');
            return;
          }
          
          // Send credentials to extension
          const response = await window.chrome.runtime.sendMessage({
            action: 'setAuth',
            token: authToken,
            userId: user.id
          });
          
          if (response?.success) {
            // Show success notification
            setSuccess('🤖 Browser Extension Connected! Cross-site tracking is now active.');
            
            // Update tracking state if extension is connected
            setTimeout(() => {
              if (browserTracker.current) {
                browserTracker.current.setExtensionConnected(true);
              }
            }, 1000);
          } else {
            console.error('Extension connection failed:', response);
            setSuccess('❌ Failed to connect browser extension. Please try again.');
          }
          
        } catch (error) {
          console.error('Extension connection error:', error);
          // Extension might not be installed
          setSuccess('💡 Install the RagBot Browser Extension for enhanced cross-site tracking!');
        }
      },
      
      isExtensionAvailable: async () => {
        try {
          if (!window.chrome?.runtime) return false;
          await window.chrome.runtime.sendMessage({ action: 'getStatus' });
          return true;
        } catch {
          return false;
        }
      }
    };
    
    // Check if extension is available on load
    const checkExtension = async () => {
      try {
        const hasExtension = await window.ragbotExtensionConnector.isExtensionAvailable();
        if (hasExtension && user?.id) {
          console.log('🤖 RagBot Extension detected! Auto-connecting...');
          // Auto-connect if user is logged in
          setTimeout(() => {
            window.ragbotExtensionConnector.requestConnection();
          }, 2000);
        }
      } catch (error) {
        console.log('No browser extension detected');
      }
    };
    
    if (user?.id) {
      checkExtension();
    }
    
    return () => {
      // Cleanup
      if (window.ragbotExtensionConnector) {
        delete window.ragbotExtensionConnector;
      }
    };
  }, [user?.id]);

  return (
    <Box className="chat-page-container">
      {/* Status Bar */}
      {(isMobile || connectionStatus === 'error') && (
        <Box className="status-bar">
          <Box className="status-bar-left">
            <Chip 
              label={connectionStatus} 
              size="small"
              sx={{ 
                bgcolor: getConnectionStatusColor(),
                color: 'white',
                fontSize: '0.75rem',
                height: 24,
                fontWeight: 500
              }}
            />
          </Box>
          <Box className="status-bar-right">
            {canCancel && loading && (
              <IconButton 
                onClick={cancelMessage} 
                size="small"
                sx={{ 
                  color: '#ef4444',
                  '&:hover': { 
                    bgcolor: 'rgba(239, 68, 68, 0.1)',
                    transform: 'scale(1.1)'
                  }
                }}
              >
                <StopIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
        </Box>
      )}

      {/* Messages Area */}
      <Box className="messages-area">
        {/* Browser Tracking Toggle */}
        {user && (
          <Box sx={{ p: 2, pb: 0 }}>
            <BrowserTrackingToggle 
              browserTracker={browserTracker.current}
              onTrackingChange={handleTrackingChange}
            />
          </Box>
        )}

        {error && (
          <Box sx={{ 
            p: 2, 
            mb: 2, 
            bgcolor: '#fef2f2', 
            border: '1px solid #fecaca', 
            borderRadius: 2,
            mx: 2 
          }}>
            <Typography sx={{ color: '#dc2626', fontSize: '14px' }}>
              {error}
            </Typography>
          </Box>
        )}
        
        {messages.length > 0 ? (
          <Box className="messages-container">
            {messages.map((msg, index) => (
              <MessageBubble 
                key={index} 
                msg={msg} 
                onCopy={copyToClipboard}
                onStreamingComplete={onStreamingComplete}
                onRegenerate={handleRegenerate}
                setMessages={setMessages}
                setCanCancel={setCanCancel}
                onCreateSubChat={handleCreateSubChat}
              />
            ))}
            <div ref={messagesEndRef} />
          </Box>
        ) : (
          renderEmptyState()
        )}
      </Box>

      {/* Fixed Input Area */}
      <Box className="input-area">
        <Box className="input-container">
          <TextField
            ref={textFieldRef}
            fullWidth
            multiline
            maxRows={3}
            placeholder="Message Ragzy..."
            value={message}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={loading}
            variant="standard"
            className="input-field"
            InputProps={{ disableUnderline: true }}
          />
          
          {/* File input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageSelect}
            style={{ display: 'none' }}
          />
          
          {/* Attachment Button */}
          <IconButton
            size="small"
            disabled={loading}
            onClick={handleAttachmentClick}
            className={`attachment-button ${selectedImage ? 'selected' : ''}`}
          >
            {selectedImage ? <ImageIcon fontSize="small" /> : <AttachFileIcon fontSize="small" />}
          </IconButton>
          
          {/* Send/Stop Button Container */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {/* Stop Button - visible when loading and can cancel */}
            {canCancel && loading && (
              <IconButton 
                onClick={cancelMessage} 
                className="stop-button"
                sx={{
                  width: 32,
                  height: 32,
                  backgroundColor: '#ef4444 !important',
                  color: '#ffffff !important',
                  '&:hover': {
                    backgroundColor: '#dc2626 !important',
                    transform: 'scale(1.05)',
                  },
                  animation: 'stop-button-pulse 2s infinite',
                  border: '2px solid #ffffff',
                  boxShadow: '0 2px 8px rgba(239, 68, 68, 0.3)',
                }}
              >
                <StopIcon fontSize="small" />
              </IconButton>
            )}
            
            {/* Send Button */}
            <IconButton
              onClick={handleSendMessage}
              disabled={loading || (!message.trim() && !selectedImage)}
              className={`send-button ${(message.trim() || selectedImage) && !loading ? 'enabled' : ''}`}
              sx={{
                width: 32,
                height: 32,
              }}
            >
              {loading && !canCancel ? (
                <CircularProgress size={16} sx={{ color: '#94a3b8' }} />
              ) : (
                <SendIcon fontSize="small" />
              )}
            </IconButton>
          </Box>
        </Box>
        
        {/* Image Preview */}
        {imagePreview && (
          <Box className="image-preview-container">
            <Box className="image-preview-content">
              <Box component="img" src={imagePreview} alt="Preview" className="preview-image" />
              <Box className="image-info">
                <Typography className="image-name">{selectedImage?.name}</Typography>
                <Typography className="image-size">
                  {selectedImage && (selectedImage.size / 1024 / 1024).toFixed(2)} MB
                </Typography>
              </Box>
              <IconButton size="small" onClick={handleRemoveImage} className="remove-image-button">
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
        )}
        
        {/* Upload Error */}
        {uploadError && (
          <Box className="upload-error">
            <Typography className="upload-error-text">
              <Box component="span">⚠️</Box>
              {uploadError}
            </Typography>
          </Box>
        )}
        
        {/* Input Hints */}
        <Box className="input-hints">
          <Typography className="input-hint-text">
            **Press Enter to send, Shift+Enter for new line**
          </Typography>
          
          {/* Enhanced Browser Activity Indicator */}
          {browserTracker.current && (
            <Box className="browser-activity-indicator">
              {isBrowserTrackingEnabled ? (
                <>
                  <Box className="activity-pulse-dot" />
                  <Typography className="activity-text">
                    Smart responses active
                  </Typography>
                </>
              ) : (
                <>
                  <Box 
                    className="activity-pulse-dot" 
                    sx={{ bgcolor: '#ef4444', animation: 'none' }} 
                  />
                  <Typography className="activity-text" color="text.secondary">
                    Basic responses only
                  </Typography>
                </>
              )}
            </Box>
          )}
          
          {message.trim() && (
            <Typography className="character-count">{message.length} characters</Typography>
          )}
        </Box>
        
        {/* Duplicate message warning */}
        {isDuplicateMessage() && (
          <Box className="duplicate-warning">
            <Typography className="duplicate-warning-text">
              <Box component="span">🔄</Box>
              You've asked this question recently. I'll try to provide a different perspective!
            </Typography>
          </Box>
        )}
      </Box>

      {/* Copy Success Snackbar */}
      <Snackbar
        open={copySnackbar}
        autoHideDuration={2000}
        onClose={() => setCopySnackbar(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        className="copy-snackbar"
      >
        <Alert 
          onClose={() => setCopySnackbar(false)} 
          severity="success" 
          sx={{ 
            bgcolor: '#10b981',
            color: 'white',
            '& .MuiAlert-icon': { color: 'white' }
          }}
        >
          Response copied to clipboard!
        </Alert>
      </Snackbar>

      {/* Success Message Snackbar */}
      <Snackbar
        open={!!success}
        autoHideDuration={4000}
        onClose={() => setSuccess('')}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setSuccess('')} 
          severity="success" 
          sx={{ 
            bgcolor: '#059669',
            color: 'white',
            '& .MuiAlert-icon': { color: 'white' },
            fontWeight: 500
          }}
        >
          {success}
        </Alert>
      </Snackbar>

      {/* Floating Action Button for Tracking Features */}
      {browserTracker.current && isBrowserTrackingEnabled && (
        <Tooltip title="Tracking History (Ctrl+H)" placement="left">
          <Fab
            color="primary"
            size="medium"
            onClick={() => setShowBrowserTrackingHistory(true)}
            sx={{
              position: 'fixed',
              bottom: theme.spacing(10),
              right: theme.spacing(3),
              zIndex: 1000,
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              boxShadow: '0 4px 20px rgba(102, 126, 234, 0.4)',
              '&:hover': {
                background: 'linear-gradient(135deg, #5a67d8 0%, #6b46c1 100%)',
                transform: 'scale(1.1)',
                boxShadow: '0 6px 25px rgba(102, 126, 234, 0.6)',
              },
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              '&:active': {
                transform: 'scale(0.95)',
              }
            }}
          >
            <TimelineIcon />
          </Fab>
        </Tooltip>
      )}

      {/* Speed Dial for Advanced Tracking Features */}
      {browserTracker.current && (
        <SpeedDial
          ariaLabel="Browser Tracking Actions"
          sx={{
            position: 'fixed',
            bottom: theme.spacing(3),
            right: theme.spacing(3),
            zIndex: 999,
            '& .MuiFab-primary': {
              background: isBrowserTrackingEnabled 
                ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                : 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
              '&:hover': {
                background: isBrowserTrackingEnabled
                  ? 'linear-gradient(135deg, #059669 0%, #047857 100%)'
                  : 'linear-gradient(135deg, #4b5563 0%, #374151 100%)',
              }
            }
          }}
          icon={<SpeedDialIcon icon={<AssessmentIcon />} openIcon={<CloseIcon />} />}
          direction="up"
        >
          {isBrowserTrackingEnabled ? (
            [
              <SpeedDialAction
                key="history"
                icon={<HistoryIcon />}
                tooltipTitle="View History (Ctrl+H)"
                onClick={() => setShowBrowserTrackingHistory(true)}
                sx={{
                  bgcolor: 'primary.main',
                  color: 'white',
                  '&:hover': { bgcolor: 'primary.dark' }
                }}
              />,
              <SpeedDialAction
                key="toggle"
                icon={<SettingsIcon />}
                tooltipTitle="Toggle Tracking (Ctrl+T)"
                onClick={() => setShowBrowserTrackingHistory(true)}
                sx={{
                  bgcolor: 'secondary.main',
                  color: 'white',
                  '&:hover': { bgcolor: 'secondary.dark' }
                }}
              />
            ]
          ) : (
            <SpeedDialAction
              key="enable"
              icon={<SettingsIcon />}
              tooltipTitle="Enable Tracking (Ctrl+T)"
              onClick={() => handleBrowserTrackingToggle(true)}
              sx={{
                bgcolor: 'success.main',
                color: 'white',
                '&:hover': { bgcolor: 'success.dark' }
              }}
            />
          )}
        </SpeedDial>
      )}

      {/* Browser Tracking History Dialog */}
      {showBrowserTrackingHistory && (
        <BrowserTrackingHistory 
          open={showBrowserTrackingHistory}
          onClose={() => setShowBrowserTrackingHistory(false)}
          browserTracker={browserTracker.current}
        />
      )}

      {/* Sub-chat Creation Dialog */}
      <Dialog 
        open={showSubChatDialog} 
        onClose={handleSubChatCancel}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            background: 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(248,250,252,0.95) 100%)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.2)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.1)',
          }
        }}
      >
        <DialogTitle sx={{ 
          pb: 1,
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          fontWeight: 600,
          fontSize: '1.25rem'
        }}>
          🧵 Create New Thread
        </DialogTitle>
        
        <DialogContent sx={{ pt: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Create a new conversation thread starting from this message:
          </Typography>
          
          {selectedMessageForThread && (
            <Box sx={{ 
              p: 2, 
              bgcolor: 'rgba(102, 126, 234, 0.05)', 
              borderRadius: 2, 
              mb: 2,
              border: '1px solid rgba(102, 126, 234, 0.1)'
            }}>
              <Typography variant="body2" sx={{ 
                color: '#374151',
                fontStyle: 'italic',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical'
              }}>
                "{selectedMessageForThread.content.substring(0, 200)}..."
              </Typography>
            </Box>
          )}
          
          <TextField
            autoFocus
            fullWidth
            label="Thread Title"
            value={threadTitle}
            onChange={(e) => setThreadTitle(e.target.value)}
            variant="outlined"
            sx={{ mt: 1 }}
            placeholder="Enter a descriptive title for this thread..."
          />
        </DialogContent>
        
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button 
            onClick={handleSubChatCancel}
            sx={{ 
              color: '#6b7280',
              '&:hover': { bgcolor: 'rgba(107, 114, 128, 0.1)' }
            }}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleSubChatConfirm}
            disabled={!threadTitle.trim() || loading}
            variant="contained"
            sx={{
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              boxShadow: '0 4px 15px rgba(102, 126, 234, 0.4)',
              '&:hover': {
                background: 'linear-gradient(135deg, #5a67d8 0%, #6b46c1 100%)',
                boxShadow: '0 6px 20px rgba(102, 126, 234, 0.6)',
              },
              '&:disabled': {
                opacity: 0.6
              }
            }}
          >
            {loading ? <CircularProgress size={20} color="inherit" /> : 'Create Thread'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default ChatPage;