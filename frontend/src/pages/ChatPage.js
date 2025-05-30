import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  TextField,
  Typography,
  CircularProgress,
  Chip,
  IconButton,
  Avatar,
  Tooltip,
  useTheme,
  useMediaQuery,
  Snackbar,
  Alert,
  Button,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Paper
} from '@mui/material';
import {
  Send as SendIcon,
  Stop as StopIcon,
  Person as PersonIcon,
  SmartToy as SmartToyIcon,
  ContentCopy as ContentCopyIcon,
  AttachFile as AttachFileIcon,
  MoreVert as MoreVertIcon,
  Share as ShareIcon,
  Edit as EditIcon,
  Image as ImageIcon,
  Close as CloseIcon,
  Memory as MemoryIcon
} from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import axios from 'axios';
import { API_CONFIG } from '../config/api';
import { useAuth } from '../contexts/AuthContext';
import { useMemory } from '../contexts/MemoryContext';
import SubdirectoryArrowRightIcon from '@mui/icons-material/SubdirectoryArrowRight';
import ChatIcon from '@mui/icons-material/Chat';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import { ChatStorage } from '../utils/chatStorage';
import MemoryDashboard from '../components/MemoryDashboard';
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
    getConversationContext,
    isInitialized: memoryInitialized 
  } = useMemory();
  
  // Initialize ChatStorage with user ID
  const chatStorage = useRef(null);
  useEffect(() => {
    if (user?.id) {
      chatStorage.current = new ChatStorage(user.id);
      chatStorage.current.migrate(); // Migrate legacy storage
    }
  }, [user]);

  const [messages, setMessages] = useState(() => {
    try {
      const savedMessages = localStorage.getItem('chatMessages');
      return savedMessages ? JSON.parse(savedMessages) : [];
    } catch (error) {
      console.error('Error loading messages from localStorage:', error);
      return [];
    }
  });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [conversationId, setConversationId] = useState(() => {
    try {
      const savedId = localStorage.getItem('currentConversationId');
      // Ensure we don't use 'null' string or invalid values
      if (savedId && savedId !== 'null' && savedId !== 'undefined') {
        return savedId;
      }
      // Clear invalid values
      localStorage.removeItem('currentConversationId');
      return null;
    } catch (error) {
      console.error('Error loading conversationId from localStorage:', error);
      return null;
    }
  });
  
  // Enhanced state for sub-chat support
  const [isSubChat, setIsSubChat] = useState(false);
  const [parentChatId, setParentChatId] = useState(null);
  const [chatTitle, setChatTitle] = useState('');
  const [autoNamingPending, setAutoNamingPending] = useState(false);
  
  const [connectionStatus, setConnectionStatus] = useState('connected');
  const messagesEndRef = useRef(null);
  const abortControllerRef = useRef(null);
  const textFieldRef = useRef(null);

  // Copy functionality state
  const [copySnackbar, setCopySnackbar] = useState(false);

  // Memory dashboard state
  const [memoryDashboardOpen, setMemoryDashboardOpen] = useState(false);

  // Remove unused testing states
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [shareExpiresAt, setShareExpiresAt] = useState(null);

  const [menuAnchorEl, setMenuAnchorEl] = useState(null);
  const [selectedChatId, setSelectedChatId] = useState(null);

  // New state for image upload
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploadError, setUploadError] = useState('');
  
  // File input ref
  const fileInputRef = useRef(null);

  // Safe conversation ID setter
  const setSafeConversationId = (id) => {
    if (id && id !== 'null' && id !== 'undefined') {
      console.log('Setting conversation ID to:', id);
      setConversationId(id);
      localStorage.setItem('currentConversationId', id);
    } else {
      console.log('Clearing conversation ID, invalid value:', id);
      setConversationId(null);
      localStorage.removeItem('currentConversationId');
    }
  };

  // Enhanced function to determine chat type and parent
  const determineChathierarchy = useCallback(async (convId) => {
    try {
      const response = await axios.get(`${API_URL}/chat/conversations/${convId}/hierarchy`, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });
      
      if (response.data.success) {
        const hierarchy = response.data.hierarchy;
        setIsSubChat(!hierarchy.is_main_chat);
        setParentChatId(hierarchy.is_main_chat ? null : hierarchy.main_chat_id);
        return hierarchy;
      }
    } catch (error) {
      console.error('Error getting chat hierarchy:', error);
    }
    return null;
  }, [getAuthHeaders]);

  // Save messages to localStorage whenever they change
  useEffect(() => {
    try {
      if (messages && messages.length > 0 && conversationId && chatStorage.current) {
        // Use the new storage system
        chatStorage.current.saveChatMessages(conversationId, messages, isSubChat, parentChatId);
        
        // Keep legacy support for now
        localStorage.setItem('chatMessages', JSON.stringify(messages));
      }
    } catch (error) {
      console.error('Error saving messages to localStorage:', error);
    }
  }, [messages, conversationId, isSubChat, parentChatId]);

  // Save conversationId to localStorage whenever it changes
  useEffect(() => {
    try {
      if (conversationId && chatStorage.current) {
        localStorage.setItem('currentConversationId', conversationId);
        chatStorage.current.setCurrentChat(conversationId, isSubChat ? conversationId : null);
      }
    } catch (error) {
      console.error('Error saving conversationId to localStorage:', error);
    }
  }, [conversationId, isSubChat]);

  // Auto-rename chat based on first message
  const autoRenameChat = useCallback(async (convId, messages) => {
    if (!chatStorage.current || autoNamingPending) return;
    
    const firstUserMessage = messages.find(msg => msg.role === 'user');
    if (!firstUserMessage) return;
    
    const newTitle = chatStorage.current.generateChatTitle(messages);
    if (newTitle === 'New Chat' || newTitle === chatTitle) return;
    
    setAutoNamingPending(true);
    try {
      const response = await axios.put(`${API_URL}/chat/conversations/${convId}/rename`, {
        title: newTitle
      }, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });
      
      if (response.data.success) {
        setChatTitle(newTitle);
        // Update local storage
        if (isSubChat && parentChatId) {
          chatStorage.current.saveSubChat(parentChatId, {
            id: convId,
            title: newTitle
          });
        } else {
          chatStorage.current.saveMainChat({
            id: convId,
            title: newTitle
          });
        }
        
        // Notify sidebar to reload
        window.dispatchEvent(new CustomEvent('reloadConversations'));
      }
    } catch (error) {
      console.error('Error auto-renaming conversation:', error);
    } finally {
      setAutoNamingPending(false);
    }
  }, [chatTitle, getAuthHeaders, isSubChat, parentChatId, autoNamingPending]);

  // Load conversation messages with useCallback to prevent infinite re-renders
  const loadConversationMessages = useCallback(async (convId) => {
    try {
      console.log('Loading messages for conversation:', convId);
      setLoading(true);
      setConnectionStatus('connecting');
      
      // First determine chat hierarchy
      const hierarchy = await determineChathierarchy(convId);
      
      const response = await axios.get(`${API_URL}/chat/conversations/${convId}/messages`, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });
      console.log('API response:', response.data);
      
      if (response.data.success) {
        const formattedMessages = response.data.messages.map(msg => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          status: msg.role === 'user' ? 'sent' : undefined
        }));
        console.log('Formatted messages:', formattedMessages.length);
        
        // Always update messages from server for the specific conversation
        setMessages(formattedMessages);
        
        // Save with new storage system
        if (chatStorage.current) {
          chatStorage.current.saveChatMessages(convId, formattedMessages, isSubChat, parentChatId);
        }
        
        // Legacy storage
        localStorage.setItem('chatMessages', JSON.stringify(formattedMessages));
        localStorage.setItem('currentConversationId', convId);
        setConnectionStatus('connected');
        
        // Auto-rename if this is a new chat with messages
        if (formattedMessages.length > 0 && formattedMessages.length <= 2) {
          setTimeout(() => autoRenameChat(convId, formattedMessages), 1000);
        }
      } else {
        console.error('API returned error:', response.data.error);
        setConnectionStatus('error');
        // Clear invalid conversation data
        clearConversationData();
      }
    } catch (error) {
      console.error('Error loading conversation:', error);
      setConnectionStatus('error');
      
      // If conversation doesn't exist (404) or other errors, clear data and start fresh
      if (error.response?.status === 404) {
        console.log('Conversation not found, clearing data and starting fresh');
        clearConversationData();
        handleNewConversation();
        return;
      }
      
      // For other errors, show error message but don't clear existing messages
      const errorMessage = {
        id: 'error-' + Date.now(),
        role: 'assistant',
        content: `Sorry, I couldn't load this conversation. ${error.response?.status === 404 ? 'The conversation might have been deleted.' : 'Please try refreshing the page or check your connection.'}`,
        isError: true,
        timestamp: new Date().toISOString()
      };
      
      // Only add error message if we don't have existing messages
      setMessages(prev => prev.length === 0 ? [errorMessage] : prev);
      if (localStorage.getItem('chatMessages') === '[]' || !localStorage.getItem('chatMessages')) {
        localStorage.setItem('chatMessages', JSON.stringify([errorMessage]));
      }
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, determineChathierarchy, isSubChat, parentChatId, autoRenameChat]);

  // Helper function to clear all conversation data
  const clearConversationData = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setIsSubChat(false);
    setParentChatId(null);
    setChatTitle('');
    localStorage.removeItem('currentConversationId');
    localStorage.removeItem('chatMessages');
    
    // Enhanced cleanup: Clear all conversation-related localStorage data
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('chatMessages_') || 
          key.startsWith('conversation_') || 
          key.startsWith('user_') ||
          key.includes('conv') ||
          key.includes('chat') ||
          key.includes('message')) {
        localStorage.removeItem(key);
      }
    });
    
    // Clear sessionStorage as well
    sessionStorage.clear();
    
    // Update URL to remove conversation parameter
    window.history.pushState({}, '', '/');
  }, []);

  // Enhanced function to clear all user-specific data
  const clearAllUserData = useCallback(() => {
    // Clear React state
    setConversationId(null);
    setMessages([]);
    setIsSubChat(false);
    setParentChatId(null);
    setChatTitle('');
    
    // Use new storage system to clear all data
    if (chatStorage.current) {
      chatStorage.current.clearAll();
    }
    
    // Clear localStorage completely for user isolation
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (
        key.startsWith('chatMessages') ||
        key.startsWith('conversation') ||
        key.startsWith('currentConversation') ||
        key.startsWith('user_') ||
        key.startsWith('cached_') ||
        key.includes('conv') ||
        key.includes('chat') ||
        key.includes('message') ||
        key.includes('context')
      )) {
        keysToRemove.push(key);
      }
    }
    
    keysToRemove.forEach(key => localStorage.removeItem(key));
    
    // Clear sessionStorage completely
    sessionStorage.clear();
    
    // Update URL
    window.history.pushState({}, '', '/');
    
    console.log('Cleared all user-specific data:', keysToRemove.length, 'keys removed');
  }, []);

  // Clear localStorage when starting a new conversation
  const handleNewConversation = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      
      // Don't pass user_id - let the backend use JWT token
      const response = await axios.post(`${API_URL}/chat/conversations`, {
        title: "New Conversation" // Let backend auto-generate title from first message
      }, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        const newConversationId = response.data.conversation.id;
        window.history.pushState({}, '', `/?conversation=${newConversationId}`);
        setConversationId(newConversationId);
        setMessages([]);
        localStorage.setItem('currentConversationId', newConversationId);
        localStorage.setItem('chatMessages', JSON.stringify([]));
        
        // Reload conversations in sidebar
        window.dispatchEvent(new CustomEvent('reloadConversations'));
      }
    } catch (error) {
      console.error('Error creating new conversation:', error);
      setError('Failed to create new conversation');
      // If we can't create a new conversation, clear everything
      setConversationId(null);
      setMessages([]);
      setIsSubChat(false);
      setParentChatId(null);
      setChatTitle('');
      localStorage.removeItem('currentConversationId');
      localStorage.removeItem('chatMessages');
      window.history.pushState({}, '', '/');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Enhanced initial data loading with user authentication validation
    const initializeConversation = async () => {
      try {
        // First, validate we have proper authentication
        const authHeaders = getAuthHeaders();
        if (!authHeaders.Authorization) {
          console.log('No auth token, clearing all data');
          clearAllUserData();
          return;
        }

        // Check for conversation ID in URL params
        const urlParams = new URLSearchParams(window.location.search);
        const convId = urlParams.get('conversation');
        const savedConvId = localStorage.getItem('currentConversationId');
        
        console.log('Initial load - URL ConvId:', convId, 'Saved ConvId:', savedConvId);
        
        // Validate saved conversation belongs to current user by checking with backend
        if (convId) {
          // URL has conversation ID - validate and load it
          if (convId !== conversationId) {
            setConversationId(convId);
            await loadConversationMessages(convId);
          }
        } else if (savedConvId && savedConvId !== conversationId) {
          // No URL but we have saved conversation - validate it exists and belongs to user
          try {
            const response = await axios.get(`${API_URL}/chat/conversations/${savedConvId}/messages`, {
              headers: authHeaders
            });
            
            if (response.data.success) {
              setConversationId(savedConvId);
              await loadConversationMessages(savedConvId);
            } else {
              throw new Error('Invalid conversation');
            }
          } catch (error) {
            console.log('Saved conversation not valid, clearing and starting fresh');
            clearConversationData();
            // Don't auto-create new conversation - wait for user input
          }
        } else if (!convId && !savedConvId && !conversationId) {
          // No conversation anywhere - clear any stale data but don't auto-create
          clearConversationData();
          console.log('No conversations found, showing empty state');
        }
      } catch (error) {
        console.error('Error initializing conversation:', error);
        clearAllUserData();
      }
    };

    initializeConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enhanced effect to handle URL changes and location changes
  useEffect(() => {
    const handleLocationChange = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const convId = urlParams.get('conversation');
      console.log('Location change detected - Conversation ID:', convId, 'Current:', conversationId);
      
      if (convId !== conversationId) {
        if (convId) {
          console.log('Loading conversation:', convId);
          // Save current conversation messages before switching
          if (conversationId) {
            const currentMessages = JSON.parse(localStorage.getItem('chatMessages') || '[]');
            if (currentMessages.length > 0) {
              localStorage.setItem(`chatMessages_${conversationId}`, JSON.stringify(currentMessages));
            }
          }
          setConversationId(convId);
          // Always load from server to validate conversation exists
          loadConversationMessages(convId);
        } else {
          console.log('No conversation in URL, clearing state');
          // Save current conversation before clearing
          if (conversationId) {
            const currentMessages = JSON.parse(localStorage.getItem('chatMessages') || '[]');
            if (currentMessages.length > 0) {
              localStorage.setItem(`chatMessages_${conversationId}`, JSON.stringify(currentMessages));
            }
          }
          clearConversationData();
          // DON'T auto-create new conversation - let user decide
        }
      }
    };

    // Handle both popstate and custom navigation
    const handlePopState = handleLocationChange;
    
    // Also check immediately in case URL changed
    handleLocationChange();

    window.addEventListener('popstate', handlePopState);
    
    // Custom event listener for programmatic navigation
    window.addEventListener('conversationChange', handleLocationChange);
    
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('conversationChange', handleLocationChange);
    };
  }, [conversationId, loadConversationMessages, clearConversationData]);

  // Load sub-conversations when conversation changes
  useEffect(() => {
    if (conversationId) {
      loadSubConversations(conversationId);
    }
  }, [conversationId]);

  // Listen for conversation deletion events
  useEffect(() => {
    const handleConversationDeleted = (event) => {
      const deletedConversationId = event.detail?.conversationId;
      console.log('Conversation deleted:', deletedConversationId, 'Current:', conversationId);
      
      // If the currently active conversation was deleted
      if (deletedConversationId === conversationId) {
        console.log('Current conversation was deleted, clearing state and showing empty state');
        clearConversationData();
        // DON'T auto-create new conversation - show empty state
      }
      
      // Clean up any cached messages for the deleted conversation
      if (deletedConversationId) {
        localStorage.removeItem(`chatMessages_${deletedConversationId}`);
      }
    };

    const handleAllConversationsDeleted = () => {
      console.log('All conversations deleted, clearing everything and showing empty state');
      clearAllUserData();
      // DON'T auto-create new conversation - show empty state
    };

    window.addEventListener('conversationDeleted', handleConversationDeleted);
    window.addEventListener('allConversationsDeleted', handleAllConversationsDeleted);
    
    return () => {
      window.removeEventListener('conversationDeleted', handleConversationDeleted);
      window.removeEventListener('allConversationsDeleted', handleAllConversationsDeleted);
    };
  }, [conversationId, clearConversationData, clearAllUserData]);

  const loadSubConversations = async (convId) => {
    try {
      const response = await axios.get(`${API_URL}/chat/conversations/${convId}/sub-conversations`, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });
      if (response.data.success) {
        // Sub-conversations now handled in Layout component
      }
    } catch (error) {
      console.error('Error loading sub-conversations:', error);
    }
  };

  // Image upload handlers
  const handleImageSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp'];
    if (!allowedTypes.includes(file.type)) {
      setUploadError('Please select a valid image file (PNG, JPEG, GIF, WebP, BMP)');
      return;
    }

    // Validate file size (20MB limit)
    const maxSize = 20 * 1024 * 1024; // 20MB
    if (file.size > maxSize) {
      setUploadError('File size must be less than 20MB');
      return;
    }

    setSelectedImage(file);
    setUploadError('');

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target.result);
    };
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
    fileInputRef.current?.click();
  };

  // Updated send message handler to support images
  const handleSendMessage = async () => {
    if ((!message.trim() && !selectedImage) || loading) return;

    const userMessage = message.trim();
    const hasImage = selectedImage !== null;
    
    // Track user input in memory system
    if (memoryInitialized && userMessage) {
      trackInput(userMessage, 'chat_message');
    }
    
    setLoading(true);
    setError(''); // Clear any previous errors
    
    try {
      // If no conversation exists, create one first
      let currentConversationId = conversationId;
      if (!currentConversationId) {
        console.log('No conversation ID, creating new conversation...');
        try {
          // Generate title using memory system if available
          const conversationTitle = memoryInitialized && userMessage ? 
            generateConversationTitle([{ role: 'user', content: userMessage }]) : 
            "New Conversation";

          console.log('Creating conversation with title:', conversationTitle);
          const newConvResponse = await axios.post(`${API_URL}/chat/conversations`, {
            title: conversationTitle
          }, {
            headers: {
              ...getAuthHeaders(),
              'Content-Type': 'application/json'
            }
          });

          console.log('Conversation creation response:', newConvResponse.data);

          if (newConvResponse.data.success && newConvResponse.data.conversation && newConvResponse.data.conversation.id) {
            currentConversationId = newConvResponse.data.conversation.id;
            console.log('Extracted conversation ID:', currentConversationId);
            
            setSafeConversationId(currentConversationId);
            window.history.pushState({}, '', `/?conversation=${currentConversationId}`);
            
            // Reload conversations in sidebar
            window.dispatchEvent(new CustomEvent('reloadConversations'));
            console.log('New conversation created and set:', currentConversationId);
          } else {
            console.error('Invalid conversation creation response:', newConvResponse.data);
            throw new Error('Invalid response from server: ' + (newConvResponse.data.error || 'Missing conversation ID'));
          }
        } catch (error) {
          console.error('Error creating new conversation:', error);
          const errorMessage = error.response?.data?.error || error.message || 'Failed to create conversation';
          setError(`Failed to create conversation: ${errorMessage}`);
          setLoading(false);
          return;
        }
      }

      // Validate that we have a valid conversation ID before proceeding
      if (!currentConversationId || currentConversationId === 'null') {
        console.error('No valid conversation ID available:', currentConversationId);
        setError('Failed to get conversation ID. Please try again.');
        setLoading(false);
        return;
      }

      console.log('Sending message to conversation:', currentConversationId);
      let response;
      
      if (hasImage) {
        // Send message with image
        const formData = new FormData();
        formData.append('message', userMessage || '');
        formData.append('image', selectedImage);
        
        response = await fetch(`${API_URL}/chat/conversations/${currentConversationId}/messages/with-image`, {
          method: 'POST',
          headers: {
            ...getAuthHeaders()
          },
          body: formData
        });
      } else {
        // Send regular text message
        response = await fetch(`${API_URL}/chat/conversations/${currentConversationId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders()
          },
          body: JSON.stringify({ message: userMessage })
        });
      }

      console.log('Message send response status:', response.status);

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (parseError) {
          console.error('Failed to parse error response:', parseError);
          errorData = { error: `HTTP ${response.status}: ${response.statusText}` };
        }
        
        console.error('API Error Details:', {
          status: response.status,
          statusText: response.statusText,
          url: response.url,
          errorData: errorData
        });
        
        const errorMessage = errorData.error || `Failed to send message (${response.status})`;
        
        // Check for specific error types
        if (response.status === 401) {
          setError('Authentication failed. Please log in again.');
        } else if (response.status === 400 && errorMessage.includes('Conversation not found')) {
          // Conversation was deleted or doesn't exist, clear it and retry
          console.log('Conversation not found, clearing and retrying...');
          setSafeConversationId(null);
          setError('Conversation not found. Please try sending your message again.');
        } else {
          setError(errorMessage);
        }
        
        setLoading(false);
        return;
      }

      const data = await response.json();
      console.log('Message send successful:', data.success);
      
      if (data.success) {
        // Clear input and image
        setMessage('');
        handleRemoveImage();
        
        // Add user message to UI if it's not already there
        const userMessageObj = hasImage ? {
          id: Date.now(),
          role: 'user',
          content: userMessage || 'Shared an image',
          timestamp: new Date().toISOString(),
          hasImage: true
        } : {
          id: Date.now(),
          role: 'user',
          content: userMessage,
          timestamp: new Date().toISOString()
        };
        
        const updatedMessages = [...messages, userMessageObj];
        
        // Add AI response
        if (data.message) {
          updatedMessages.push(data.message);
        }
        
        setMessages(updatedMessages);
        
        // Save conversation to memory system
        if (memoryInitialized && trackConversation) {
          try {
            await trackConversation({
              id: currentConversationId,
              title: chatTitle || generateConversationTitle(updatedMessages),
              messages: updatedMessages,
              lastUpdated: new Date().toISOString()
            });
          } catch (memoryError) {
            console.warn('Failed to save conversation to memory:', memoryError);
          }
        }
        
        // Scroll to bottom
        setTimeout(scrollToBottom, 100);
      } else {
        setError(data.error || 'Failed to send message');
      }
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage = error.message || 'Failed to send message';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const cancelMessage = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleInputChange = (e) => {
    setMessage(e.target.value);
    
    // Auto-resize textarea with better constraints
    const textarea = e.target;
    textarea.style.height = 'auto';
    
    // Get responsive max heights based on screen size
    const isMobile = window.innerWidth < 600;
    const isTablet = window.innerWidth >= 600 && window.innerWidth < 900;
    
    let maxHeight;
    if (isMobile) {
      maxHeight = 84; // 4 lines on mobile
    } else if (isTablet) {
      maxHeight = 96; // 4 lines on tablet
    } else {
      maxHeight = 116; // 4 lines on desktop
    }
    
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = newHeight + 'px';
  };

  // Check if current message is a duplicate
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

  const handleRename = async () => {
    if (!conversationId || !newTitle.trim()) return;

    try {
      const response = await axios.put(
        `${API_URL}/chat/conversations/${conversationId}/rename`,
        { title: newTitle.trim() },
        {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.success) {
        // Update the conversation title in the UI
        setMessages(prev => prev.map(msg => ({
          ...msg,
          conversationTitle: newTitle.trim()
        })));
        setRenameDialogOpen(false);
        setNewTitle('');
      }
    } catch (error) {
      console.error('Error renaming conversation:', error);
    }
  };

  const handleShare = async () => {
    if (!conversationId) return;

    try {
      const response = await axios.post(
        `${API_URL}/chat/conversations/${conversationId}/share`,
        {},
        {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.success) {
        setShareUrl(response.data.share_url);
        setShareExpiresAt(response.data.expires_at);
        setShareDialogOpen(true);
      }
    } catch (error) {
      console.error('Error sharing conversation:', error);
    }
  };

  const copyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch (err) {
      console.error('Failed to copy share URL:', err);
    }
  };

  const handleRenameFromMenu = () => {
    if (selectedChatId) {
      setNewTitle(messages[0]?.conversationTitle || '');
      setRenameDialogOpen(true);
    }
    handleMenuClose();
  };

  const handleShareFromMenu = () => {
    if (selectedChatId) {
      handleShare();
    }
    handleMenuClose();
  };

  const handleMenuClose = () => {
    setMenuAnchorEl(null);
    setSelectedChatId(null);
  };

  const MessageBubble = ({ msg }) => {
    const isUser = msg.role === 'user';
    
    return (
      <Box sx={{ 
        py: { xs: 2, sm: 2.5 },
        px: 0,
        borderBottom: '1px solid #f0f0f0',
        '&:last-child': {
          borderBottom: 'none'
        },
        bgcolor: isUser ? '#ffffff' : '#f7f7f8'
      }}>
        <Box sx={{
          maxWidth: { xs: '100%', sm: '100%' },
          mx: 'auto',
          px: { xs: 2, sm: 3 },
          display: 'flex',
          gap: { xs: 2, sm: 2.5 },
          alignItems: 'flex-start',
          minHeight: '40px'
        }}>
          {/* User Message - Plain Text Right Side */}
          {isUser ? (
            <>
              {/* Empty left space to push content right */}
              <Box sx={{ flex: 1, display: { xs: 'none', sm: 'block' } }} />
              
              {/* User content taking right half */}
              <Box sx={{ 
                flex: { xs: 1, sm: 1 },
                display: 'flex',
                alignItems: 'flex-start',
                gap: { xs: 1.5, sm: 2 },
                justifyContent: 'flex-end',
                maxWidth: { xs: '100%', sm: '45%' },
                ml: 'auto'
              }}>
                <Box sx={{ 
                  flex: 1,
                  maxWidth: { xs: '100%', sm: '80%' },
                  textAlign: 'right'
                }}>
                  {/* Display image if message has one */}
                  {msg.hasImage && msg.content && (
                    <Box sx={{ mb: 1, textAlign: 'right' }}>
                      <Typography sx={{ 
                        color: '#2d3748',
                        fontSize: { xs: '14px', sm: '15px' },
                        lineHeight: 1.5,
                        wordBreak: 'break-word',
                        fontWeight: 400,
                        textAlign: 'right'
                      }}>
                        {msg.content !== 'Shared an image' ? msg.content : ''}
                      </Typography>
                    </Box>
                  )}
                  
                  {/* Display image placeholder if this message has an image */}
                  {msg.hasImage && (
                    <Box sx={{ 
                      mb: 1, 
                      display: 'flex', 
                      justifyContent: 'flex-end'
                    }}>
                      <Box sx={{
                        maxWidth: '200px',
                        border: '1px solid #e2e8f0',
                        borderRadius: 2,
                        p: 2,
                        bgcolor: '#f8fafc',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1
                      }}>
                        <ImageIcon sx={{ color: '#6b7280', fontSize: '20px' }} />
                        <Typography sx={{
                          fontSize: '12px',
                          color: '#6b7280'
                        }}>
                          Image shared
                        </Typography>
                      </Box>
                    </Box>
                  )}
                  
                  {/* Regular text message if no image */}
                  {!msg.hasImage && (
                    <Typography sx={{ 
                      color: '#2d3748',
                      fontSize: { xs: '14px', sm: '15px' },
                      lineHeight: 1.5,
                      wordBreak: 'break-word',
                      fontWeight: 400,
                      textAlign: 'right'
                    }}>
                      {msg.content}
                    </Typography>
                  )}

                  {/* Message status and indicators combined */}
                  <Box sx={{ mt: 0.5, textAlign: 'right' }}>
                    {msg.status && (
                      <Typography sx={{ 
                        fontSize: '10px', 
                        color: '#9ca3af', 
                        fontStyle: 'italic',
                        display: 'inline'
                      }}>
                        {msg.status === 'sending' && '⏳ Sending...'}
                        {msg.status === 'sent' && '✓ Sent'}
                        {msg.status === 'error' && '❌ Failed to send'}
                      </Typography>
                    )}
                    
                    {msg.isDuplicate && (
                      <Typography sx={{ 
                        fontSize: '10px', 
                        color: '#f59e0b', 
                        fontStyle: 'italic',
                        display: 'inline',
                        ml: msg.status ? 1 : 0
                      }}>
                        🔄 Similar question
                      </Typography>
                    )}

                    {/* Timestamp */}
                    <Typography sx={{ 
                      fontSize: '10px', 
                      color: '#9ca3af',
                      mt: 0.5,
                      display: 'block'
                    }}>
                      {new Date(msg.timestamp).toLocaleTimeString([], { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}
                    </Typography>
                  </Box>
                </Box>

                {/* User Avatar */}
                <Box sx={{ flexShrink: 0 }}>
                  <Avatar
                    sx={{ 
                      width: { xs: 28, sm: 30 }, 
                      height: { xs: 28, sm: 30 },
                      bgcolor: '#10a37f',
                      fontSize: { xs: '12px', sm: '13px' },
                      fontWeight: 600
                    }}
                  >
                    U
                  </Avatar>
                </Box>
              </Box>
            </>
          ) : (
            /* AI Response - Compact Left Side */
            <>
              {/* AI Avatar */}
              <Box sx={{ flexShrink: 0 }}>
                <Avatar
                  sx={{ 
                    width: { xs: 28, sm: 30 }, 
                    height: { xs: 28, sm: 30 },
                    bgcolor: '#6366f1',
                    fontSize: { xs: '12px', sm: '13px' },
                    fontWeight: 600
                  }}
                >
                  R
                </Avatar>
              </Box>

              {/* AI content taking available width */}
              <Box sx={{ 
                flex: 1,
                minWidth: 0,
                maxWidth: '100%',
                pr: { xs: 0, sm: 0 }
              }}>
                {msg.isTyping ? (
                  <Box sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 1.5,
                    py: 1
                  }}>
                    <CircularProgress size={16} sx={{ color: '#6366f1' }} />
                    <Typography sx={{ 
                      color: '#6b7280', 
                      fontSize: { xs: '14px', sm: '15px' },
                      fontWeight: 400
                    }}>
                      Ragzy is typing...
                    </Typography>
                  </Box>
                ) : (
                  <>
                    <Box sx={{ 
                      color: '#2d3748',
                      fontSize: { xs: '14px', sm: '15px' },
                      lineHeight: 1.6,
                      '& p': { 
                        margin: 0,
                        mb: 1.5,
                        '&:last-child': { mb: 0 }
                      },
                      '& ul, & ol': {
                        pl: 3,
                        my: 1.5
                      },
                      '& li': {
                        mb: 0.5,
                        lineHeight: 1.5
                      },
                      '& pre': {
                        bgcolor: '#1a1a1a',
                        border: '1px solid #333333',
                        borderRadius: 1,
                        p: 1.5,
                        my: 1.5,
                        overflow: 'auto',
                        fontSize: '12px',
                        lineHeight: 1.4,
                        maxHeight: '300px',
                        maxWidth: '85%',
                        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
                        color: '#e5e5e5',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word'
                      },
                      '& code': {
                        bgcolor: '#1a1a1a',
                        color: '#e5e5e5',
                        px: 0.75,
                        py: 0.25,
                        borderRadius: 0.5,
                        fontSize: { xs: '11px', sm: '12px' },
                        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
                        border: '1px solid #333333'
                      },
                      '& blockquote': {
                        borderLeft: '3px solid #6366f1',
                        pl: 2,
                        ml: 0,
                        my: 1.5,
                        color: '#64748b',
                        bgcolor: '#f8fafc',
                        py: 1,
                        borderRadius: '0 6px 6px 0'
                      },
                      '& h1, & h2, & h3, & h4, & h5, & h6': {
                        fontWeight: 600,
                        mt: 2,
                        mb: 1,
                        color: '#1e293b',
                        '&:first-of-type': { mt: 0 }
                      },
                      '& h1': { fontSize: { xs: '18px', sm: '20px' } },
                      '& h2': { fontSize: { xs: '16px', sm: '18px' } },
                      '& h3': { fontSize: { xs: '15px', sm: '16px' } },
                      '& table': {
                        width: '100%',
                        borderCollapse: 'collapse',
                        my: 2,
                        overflowX: 'auto',
                        display: { xs: 'block', sm: 'table' },
                        fontSize: '13px',
                        borderRadius: 1
                      },
                      '& th, & td': {
                        border: '1px solid #e2e8f0',
                        px: { xs: 1.5, sm: 2 },
                        py: 1,
                        textAlign: 'left',
                        fontSize: { xs: '12px', sm: '13px' }
                      },
                      '& th': {
                        bgcolor: '#f8fafc',
                        fontWeight: 600,
                        color: '#374151'
                      },
                      '& a': {
                        color: '#2563eb',
                        textDecoration: 'none',
                        '&:hover': {
                          textDecoration: 'underline'
                        }
                      }
                    }}>
                      <ReactMarkdown
                        components={{
                          code({ node, inline, className, children, ...props }) {
                            const match = /language-(\w+)/.exec(className || '');
                            return !inline && match ? (
                              <Box sx={{ position: 'relative', mb: 2 }}>
                                <SyntaxHighlighter
                                  style={oneDark}
                                  language={match[1]}
                                  PreTag="div"
                                  showLineNumbers={false}
                                  wrapLines={false}
                                  wrapLongLines={true}
                                  customStyle={{
                                    backgroundColor: '#1a1a1a',
                                    border: '1px solid #333333',
                                    borderRadius: '4px',
                                    padding: '12px',
                                    margin: '12px 0',
                                    overflow: 'auto',
                                    fontSize: '12px',
                                    lineHeight: 1.4,
                                    maxHeight: '300px',
                                    maxWidth: '85%',
                                    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
                                    boxShadow: 'none',
                                    outline: 'none'
                                  }}
                                  codeTagProps={{
                                    style: {
                                      backgroundColor: 'transparent',
                                      border: 'none',
                                      boxShadow: 'none',
                                      outline: 'none',
                                      fontFamily: 'inherit'
                                    }
                                  }}
                                  {...props}
                                >
                                  {String(children).replace(/\n$/, '')}
                                </SyntaxHighlighter>
                                <Tooltip title="Copy code">
                                  <IconButton
                                    size="small"
                                    onClick={() => copyToClipboard(String(children).replace(/\n$/, ''))}
                                    sx={{
                                      position: 'absolute',
                                      top: 8,
                                      right: 8,
                                      bgcolor: 'rgba(255, 255, 255, 0.1)',
                                      color: '#e5e5e5',
                                      width: 28,
                                      height: 28,
                                      '&:hover': {
                                        bgcolor: 'rgba(255, 255, 255, 0.2)',
                                        color: '#ffffff'
                                      },
                                      backdropFilter: 'blur(4px)',
                                      border: '1px solid rgba(255, 255, 255, 0.1)'
                                    }}
                                  >
                                    <ContentCopyIcon sx={{ fontSize: '14px' }} />
                                  </IconButton>
                                </Tooltip>
                              </Box>
                            ) : (
                              <code {...props}>
                                {children}
                              </code>
                            );
                          }
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </Box>

                    {/* Compact actions row for AI messages */}
                    <Box sx={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 1.5,
                      mt: 1.5,
                      pt: 1,
                      borderTop: '1px solid #f1f5f9'
                    }}>
                      <Tooltip title="Copy response">
                        <IconButton
                          size="small"
                          onClick={() => copyToClipboard(msg.content)}
                          sx={{ 
                            color: '#6b7280',
                            width: 28,
                            height: 28,
                            '&:hover': { 
                              color: '#374151',
                              bgcolor: '#f1f5f9'
                            }
                          }}
                        >
                          <ContentCopyIcon sx={{ fontSize: '16px' }} />
                        </IconButton>
                      </Tooltip>
                      
                      <Typography sx={{ 
                        fontSize: '11px', 
                        color: '#9ca3af',
                        fontWeight: 400
                      }}>
                        {new Date(msg.timestamp).toLocaleTimeString([], { 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}
                      </Typography>
                    </Box>
                  </>
                )}
              </Box>
            </>
          )}
        </Box>
      </Box>
    );
  };

  return (
    <Box sx={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      bgcolor: '#ffffff',
      position: 'relative'
    }}>
      {/* Status Bar - Only show on mobile or when there's an error */}
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
            {conversationId && !isMobile && (
              <Typography variant="caption" sx={{ color: '#64748b' }}>
                ID: {conversationId.substring(0, 8)}...
              </Typography>
            )}
          </Box>
          <Box className="status-bar-right">
            {loading && (
              <Tooltip title="Stop generation">
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
              </Tooltip>
            )}
          </Box>
        </Box>
      )}

      {/* Messages Area - Scrollable */}
      <Box sx={{
        flex: 1,
        overflow: 'auto',
        bgcolor: '#ffffff',
        pb: '180px'
      }}>
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
          <Box sx={{ 
            width: '100%',
            bgcolor: '#ffffff',
            pb: 2
          }}>
            {messages.map((msg, index) => (
              <MessageBubble key={index} msg={msg} />
            ))}
            <div ref={messagesEndRef} />
          </Box>
        ) : (
          <Box className="empty-state">
            <Box sx={{ 
              textAlign: 'center',
              py: 8,
              px: 4,
              maxWidth: '600px',
              mx: 'auto',
              mt: 10,
              mb: 4
            }}>
              <Box sx={{ 
                width: 64,
                height: 64,
                mx: 'auto',
                mb: 4,
                bgcolor: '#f7f7f8',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Avatar sx={{ 
                  width: 40, 
                  height: 40, 
                  bgcolor: '#6366f1',
                  fontSize: '18px',
                  fontWeight: 600
                }}>
                  R
                </Avatar>
              </Box>
              
              <Typography variant="h4" sx={{ 
                fontWeight: 600,
                color: '#2d3748',
                mb: 2,
                fontSize: { xs: '24px', sm: '28px' }
              }}>
                How can I help you today?
              </Typography>
              
              <Typography sx={{ 
                color: '#6b7280',
                fontSize: '16px',
                lineHeight: 1.5,
                mb: 4
              }}>
                I'm Ragzy, your AI assistant. Ask me anything!
              </Typography>

              {/* Example prompts */}
              <Box sx={{ 
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
                gap: 2,
                mt: 4
              }}>
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
                    sx={{
                      p: 2,
                      textAlign: 'left',
                      justifyContent: 'flex-start',
                      textTransform: 'none',
                      borderColor: '#e5e7eb',
                      color: '#374151',
                      backgroundColor: '#ffffff',
                      '&:hover': {
                        borderColor: prompt.color,
                        backgroundColor: '#f9fafb',
                        transform: 'translateY(-1px)',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                      },
                      transition: 'all 0.2s ease-in-out'
                    }}
                  >
                    <Box sx={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 2
                    }}>
                      <Box sx={{ 
                        fontSize: '20px',
                        filter: 'grayscale(20%)'
                      }}>
                        {prompt.icon}
                      </Box>
                      <Typography sx={{ 
                        fontSize: '14px',
                        fontWeight: 500
                      }}>
                        {prompt.text}
                      </Typography>
                    </Box>
                  </Button>
                ))}
              </Box>
            </Box>
          </Box>
        )}
      </Box>

      {/* Fixed Input Area at Bottom */}
      <Box sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        bgcolor: '#ffffff',
        borderTop: '1px solid #e5e7eb',
        zIndex: 1000,
        py: { xs: 1.5, sm: 2 },
        px: { xs: 2, sm: 3 }
      }}>
        <Box sx={{
          maxWidth: '750px',
          mx: 'auto',
          mr: { xs: 'auto', sm: '100px', md: '150px' },
          ml: { xs: 'auto', sm: 'auto' },
          display: 'flex',
          alignItems: 'flex-end',
          gap: 2,
          bgcolor: '#ffffff',
          border: '1px solid #d1d5db',
          borderRadius: 2,
          px: 2,
          py: 1,
          minHeight: '48px',
          maxHeight: '120px'
        }}>
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
            sx={{
              '& .MuiInputBase-root': {
                fontSize: '14px',
                lineHeight: 1.5,
                p: 0
              },
              '& .MuiInputBase-input': {
                py: 1
              }
            }}
            InputProps={{
              disableUnderline: true
            }}
          />
          
          {/* Attachment Button */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageSelect}
            style={{ display: 'none' }}
          />
          <IconButton
            size="small"
            disabled={loading}
            onClick={handleAttachmentClick}
            sx={{
              width: 32,
              height: 32,
              color: selectedImage ? '#3b82f6' : '#6b7280',
              backgroundColor: selectedImage ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
              '&:hover': {
                color: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)'
              },
              '&:disabled': {
                color: '#d1d5db'
              }
            }}
          >
            {selectedImage ? <ImageIcon fontSize="small" /> : <AttachFileIcon fontSize="small" />}
          </IconButton>
          
          {/* Send Button */}
          <IconButton
            onClick={handleSendMessage}
            disabled={loading || (!message.trim() && !selectedImage)}
            sx={{
              width: 32,
              height: 32,
              bgcolor: (message.trim() || selectedImage) && !loading ? '#2563eb' : '#f3f4f6',
              color: (message.trim() || selectedImage) && !loading ? '#ffffff' : '#9ca3af',
              '&:hover': {
                bgcolor: (message.trim() || selectedImage) && !loading ? '#1d4ed8' : '#f3f4f6'
              },
              '&:disabled': {
                bgcolor: '#f3f4f6',
                color: '#9ca3af'
              }
            }}
          >
            {loading ? (
              <CircularProgress size={16} sx={{ color: '#94a3b8' }} />
            ) : (
              <SendIcon fontSize="small" />
            )}
          </IconButton>
        </Box>
        
        {/* Image Preview */}
        {imagePreview && (
          <Box sx={{
            maxWidth: '750px',
            mx: 'auto',
            mr: { xs: 'auto', sm: '100px', md: '150px' },
            ml: { xs: 'auto', sm: 'auto' },
            mt: 1,
            p: 2,
            bgcolor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 2,
            position: 'relative'
          }}>
            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2
            }}>
              <Box
                component="img"
                src={imagePreview}
                alt="Preview"
                sx={{
                  width: 80,
                  height: 80,
                  objectFit: 'cover',
                  borderRadius: 1,
                  border: '1px solid #e2e8f0'
                }}
              />
              <Box sx={{ flex: 1 }}>
                <Typography sx={{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#374151',
                  mb: 0.5
                }}>
                  {selectedImage?.name}
                </Typography>
                <Typography sx={{
                  fontSize: '12px',
                  color: '#6b7280'
                }}>
                  {selectedImage && (selectedImage.size / 1024 / 1024).toFixed(2)} MB
                </Typography>
              </Box>
              <IconButton
                size="small"
                onClick={handleRemoveImage}
                sx={{
                  color: '#6b7280',
                  '&:hover': {
                    color: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)'
                  }
                }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
        )}
        
        {/* Upload Error */}
        {uploadError && (
          <Box sx={{
            maxWidth: '750px',
            mx: 'auto',
            mr: { xs: 'auto', sm: '100px', md: '150px' },
            ml: { xs: 'auto', sm: 'auto' },
            mt: 1,
            p: 1.5,
            bgcolor: '#fef2f2',
            borderRadius: 1,
            border: '1px solid #fecaca'
          }}>
            <Typography sx={{
              fontSize: '12px',
              color: '#dc2626',
              display: 'flex',
              alignItems: 'center',
              gap: 1
            }}>
              <Box component="span">⚠️</Box>
              {uploadError}
            </Typography>
          </Box>
        )}
        
        {/* Input Hints */}
        <Box sx={{
          maxWidth: '750px',
          mx: 'auto',
          mt: 1,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <Typography sx={{
            fontSize: '11px',
            color: '#9ca3af'
          }}>
            Press Enter to send, Shift+Enter for new line
          </Typography>
          
          {message.trim() && (
            <Typography sx={{
              fontSize: '11px',
              color: '#9ca3af'
            }}>
              {message.length} characters
            </Typography>
          )}
        </Box>
        
        {/* Duplicate message warning */}
        {isDuplicateMessage() && (
          <Box sx={{
            maxWidth: '750px',
            mx: 'auto',
            mt: 1,
            p: 1.5,
            bgcolor: '#fef3c7',
            borderRadius: 1,
            border: '1px solid #fbbf24'
          }}>
            <Typography sx={{
              fontSize: '12px',
              color: '#92400e',
              display: 'flex',
              alignItems: 'center',
              gap: 1
            }}>
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

      {/* Rename Dialog */}
      <Dialog 
        open={renameDialogOpen} 
        onClose={() => setRenameDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Rename Conversation</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="New Title"
            fullWidth
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            variant="outlined"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialogOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleRename}
            variant="contained"
            color="primary"
          >
            Rename
          </Button>
        </DialogActions>
      </Dialog>

      {/* Share Dialog */}
      <Dialog 
        open={shareDialogOpen} 
        onClose={() => setShareDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Share Conversation</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="textSecondary" gutterBottom>
            Share this link with others to let them view this conversation.
            Link expires on {new Date(shareExpiresAt).toLocaleString()}.
          </Typography>
          <Box sx={{ 
            display: 'flex', 
            gap: 1, 
            mt: 2,
            bgcolor: '#f8fafc',
            p: 2,
            borderRadius: 1
          }}>
            <Typography 
              variant="body2" 
              sx={{ 
                flex: 1,
                wordBreak: 'break-all',
                color: '#475569'
              }}
            >
              {shareUrl}
            </Typography>
            <IconButton 
              onClick={copyShareUrl}
              size="small"
              sx={{
                color: '#6366f1',
                '&:hover': {
                  bgcolor: 'rgba(99, 102, 241, 0.1)'
                }
              }}
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShareDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Add Menu component */}
      <Menu
        anchorEl={menuAnchorEl}
        open={Boolean(menuAnchorEl)}
        onClose={handleMenuClose}
        PaperProps={{
          elevation: 2,
          sx: {
            mt: 1,
            minWidth: 180,
            borderRadius: 2,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
          }
        }}
      >
        <MenuItem onClick={handleRenameFromMenu}>
          <ListItemIcon>
            <EditIcon fontSize="small" sx={{ color: '#6366f1' }} />
          </ListItemIcon>
          <ListItemText>Rename</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleShareFromMenu}>
          <ListItemIcon>
            <ShareIcon fontSize="small" sx={{ color: '#6366f1' }} />
          </ListItemIcon>
          <ListItemText>Share</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
}

export default ChatPage;