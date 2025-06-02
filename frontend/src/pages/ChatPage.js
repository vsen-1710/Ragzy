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
import './ChatPage.css';

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

  // Initialize storage and tracking
  useEffect(() => {
    if (user?.id) {
      chatStorage.current = new ChatStorage(user.id, user.email);
      chatStorage.current.migrate();
      browserTracker.current = new BrowserActivityTracker(user.id);
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
      
      const savedMessages = localStorage.getItem('chatMessages');
      return savedMessages ? JSON.parse(savedMessages) : [];
    } catch (error) {
      console.error('Error loading messages:', error);
      return [];
    }
  }

  function getInitialConversationId() {
    try {
      const savedId = localStorage.getItem('currentConversationId');
      if (savedId && savedId !== 'null' && savedId !== 'undefined') {
        return savedId;
      }
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
      
      // Multiple storage layers for redundancy
      localStorage.setItem('chatMessages', JSON.stringify(validatedMessages));
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

  // Enhanced message sending with proper stop button handling
  const handleSendMessage = async () => {
    if ((!message.trim() && !selectedImage) || loading) return;

    const userMessage = message.trim();
    const hasImage = selectedImage !== null;
    const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    // Handle test commands
    const testResponse = handleTestCommands(userMessage);
    if (testResponse) {
      handleTestResponse(userMessage, testResponse);
      return;
    }
    
    // Set up cancellation and show stop button immediately
    abortControllerRef.current = new AbortController();
    setCanCancel(true);
    setCurrentRequestId(requestId);
    
    // Get browser context
    const contextualMessage = getBrowserContextualMessage(userMessage);
    
    // Track input
    if (memoryInitialized && userMessage) {
      trackInput(userMessage, 'chat_message');
    }
    
    // Add user message immediately
    const userMessageObj = formatUserMessage(userMessage, hasImage);
    setMessages(prev => [...prev, userMessageObj]);
    
    // Save state for recovery
    saveResponseState(requestId, {
      userMessage: userMessage,
      loading: true,
      isTyping: false,
      stage: 'sending'
    });
    
    // Clear input
    setMessage('');
    handleRemoveImage();
    sessionStorage.removeItem('chatDraft');
    
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
      const response = await sendMessageToAPI(currentConversationId, contextualMessage, hasImage);
      await handleAPIResponse(response, typingMessage.id, userMessageObj);
      
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
    if (browserTracker.current) {
      const activitySummary = browserTracker.current.getActivitySummary(15);
      if (activitySummary !== "No recent browser activity detected.") {
        return `${userMessage}\n\n[BROWSER CONTEXT]:\n${activitySummary}`;
      }
    }
    return userMessage;
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

  async function sendMessageToAPI(conversationId, contextualMessage, hasImage) {
    if (hasImage) {
      const formData = new FormData();
      formData.append('message', contextualMessage || '');
      formData.append('image', selectedImage);
      
      return fetch(`${API_URL}/chat/conversations/${conversationId}/messages/with-image`, {
        method: 'POST',
        headers: { ...getAuthHeaders() },
        body: formData,
        signal: abortControllerRef.current.signal
      });
    } else {
      return fetch(`${API_URL}/chat/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ message: contextualMessage }),
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
      
      // Add AI response for streaming
      const aiMessage = formatAssistantMessage(data.message.content, {
        id: data.message.id,
        isStreaming: true,
        timestamp: data.message.timestamp
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
    
    const fallbackMessage = formatAssistantMessage(keywordResponse, { isFallback: true });
    setMessages(prev => [...prev, fallbackMessage]);
    setTimeout(scrollToBottom, 50);
  }

  function handleTestResponse(userMessage, testResponse) {
    const userMsg = formatUserMessage(userMessage);
    setMessages(prev => [...prev, userMsg]);
    
    setTimeout(() => {
      const testMsg = formatAssistantMessage(testResponse, {
        id: `test-${Date.now()}`,
        timestamp: new Date().toISOString()
      });
      setMessages(prev => [...prev, testMsg]);
      
      if (chatStorage.current && conversationId) {
        chatStorage.current.saveMessage(conversationId, userMsg);
        chatStorage.current.saveMessage(conversationId, testMsg);
      }
    }, 200);
    
    setMessage('');
    setSelectedImage(null);
    setTimeout(() => scrollToBottom('smooth'), 300);
  }

  // Handle test commands
  function handleTestCommands(userMessage) {
    const lowerMessage = userMessage.toLowerCase().trim();
    
    if (lowerMessage === '/test browser activity' || lowerMessage === '/browser') {
      if (browserTracker.current) {
        const activitySummary = browserTracker.current.getActivitySummary(30);
        const recentActivities = browserTracker.current.getRecentActivities(10);
        
        let testResponse = "🔍 **Browser Activity Test Results:**\n\n";
        testResponse += "**Summary:**\n" + activitySummary + "\n\n";
        testResponse += "**Recent Activities (last 10 minutes):**\n";
        
        if (recentActivities.length > 0) {
          recentActivities.slice(0, 5).forEach((activity, idx) => {
            const time = new Date(activity.timestamp).toLocaleTimeString();
            testResponse += `${idx + 1}. [${time}] ${activity.type}: ${activity.data?.url || 'No URL'}\n`;
          });
        } else {
          testResponse += "No recent activities detected.\n";
        }
        
        testResponse += "\n**Available Commands:**\n";
        testResponse += "- `/browser` - Show this browser activity report\n";
        testResponse += "- `/clear activity` - Clear stored browser activity\n";
        testResponse += "- Type normally and browser context will be automatically included\n";
        
        return testResponse;
      }
      return "❌ Browser activity tracking is not initialized.";
    }
    
    if (lowerMessage === '/clear activity') {
      if (browserTracker.current) {
        browserTracker.current.clearActivities();
        return "✅ Browser activity history cleared.";
      }
      return "❌ Browser activity tracking is not available.";
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
                setMessages={setMessages}
                setCanCancel={setCanCancel}
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
          
          {/* Send/Stop Button */}
          {canCancel && loading ? (
            <IconButton onClick={cancelMessage} className="stop-button">
              <StopIcon fontSize="small" />
            </IconButton>
          ) : (
            <IconButton
              onClick={handleSendMessage}
              disabled={loading || (!message.trim() && !selectedImage)}
              className={`send-button ${(message.trim() || selectedImage) && !loading ? 'enabled' : ''}`}
            >
              {loading && !canCancel ? (
                <CircularProgress size={16} sx={{ color: '#94a3b8' }} />
              ) : (
                <SendIcon fontSize="small" />
              )}
            </IconButton>
          )}
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
          
          {/* Browser Activity Indicator */}
          {browserTracker.current && (
            <Box className="browser-activity-indicator">
              <Box className="activity-pulse-dot" />
              <Typography className="activity-text">Browser context active</Typography>
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
    </Box>
  );
}

export default ChatPage;