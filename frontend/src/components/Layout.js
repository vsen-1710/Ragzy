import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, Outlet } from 'react-router-dom';
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  List,
  Typography,
  IconButton,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Button,
  useMediaQuery,
  useTheme,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Avatar,
  Snackbar,
  Alert,
  Tooltip,
  Collapse,
  CircularProgress
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import AddIcon from '@mui/icons-material/Add';
import ChatIcon from '@mui/icons-material/Chat';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ShareIcon from '@mui/icons-material/Share';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import LogoutIcon from '@mui/icons-material/Logout';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import axios from 'axios';
import { API_CONFIG } from '../config/api';
import { useAuth } from '../contexts/AuthContext';
import { ChatStorage } from '../utils/chatStorage';

const drawerWidth = 280;
const API_URL = API_CONFIG.BASE_URL;

function Layout() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const location = useLocation();
  const { user, logout, getAuthHeaders } = useAuth();
  
  // Initialize ChatStorage with user ID
  const chatStorage = useRef(null);
  useEffect(() => {
    if (user?.id) {
      chatStorage.current = new ChatStorage(user.id);
    }
  }, [user]);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [subChats, setSubChats] = useState({});
  const [expandedConversations, setExpandedConversations] = useState({});
  const [loadingSubChats, setLoadingSubChats] = useState({});
  const [showAllConversations, setShowAllConversations] = useState(false);
  
  // Enhanced state for chat management
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [selectedSubChat, setSelectedSubChat] = useState(null);
  const [quickCreateParent, setQuickCreateParent] = useState(null);
  
  // Menu and dialog states
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [subChatMenuAnchor, setSubChatMenuAnchor] = useState(null);
  const [userMenuAnchor, setUserMenuAnchor] = useState(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [subChatDeleteConfirmOpen, setSubChatDeleteConfirmOpen] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  
  // Dialog states
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [subChatRenameDialogOpen, setSubChatRenameDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSubChatTitle, setNewSubChatTitle] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [shareExpiresAt, setShareExpiresAt] = useState(null);
  
  // Snackbar state
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

  const showSnackbar = (message, severity = 'info') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleDrawerToggle = () => setMobileOpen(!mobileOpen);

  // Get current conversation ID from URL
  const getCurrentConversationId = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('conversation');
  };

  const currentConversationId = getCurrentConversationId();

  // Handle URL changes to expand parent conversations when sub-chats are accessed
  useEffect(() => {
    const handleURLChange = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const currentConvId = urlParams.get('conversation');
      
      if (currentConvId && conversations.length > 0) {
        // Check if current conversation is a sub-chat by making an API call
        try {
          const response = await axios.get(`${API_URL}/chat/conversations/${currentConvId}/hierarchy`, {
            headers: {
              ...getAuthHeaders(),
              'Content-Type': 'application/json'
            }
          });
          
          if (response.data.success && response.data.hierarchy) {
            const hierarchy = response.data.hierarchy;
            
            // If it's a sub-chat, ensure its parent is expanded
            if (!hierarchy.is_main_chat && hierarchy.main_chat_id) {
              const parentId = hierarchy.main_chat_id;
              console.log(`Sub-chat ${currentConvId} detected, expanding parent ${parentId}`);
              
              // Expand the parent conversation
              setExpandedConversations(prev => ({ ...prev, [parentId]: true }));
              
              // Load sub-chats for the parent if not already loaded
              if (!subChats[parentId]) {
                await loadSubChats(parentId);
              }
            }
          }
        } catch (error) {
          console.error('Error checking conversation hierarchy:', error);
        }
      }
    };

    handleURLChange();
  }, [location, conversations, getAuthHeaders, subChats]);

  // Load conversations and custom context on mount
  useEffect(() => {
    loadConversations();
    
    // Listen for conversation reload events
    const handleReloadConversations = () => {
      loadConversations();
    };
    
    window.addEventListener('reloadConversations', handleReloadConversations);
    
    return () => {
      window.removeEventListener('reloadConversations', handleReloadConversations);
    };
  }, []);

  const loadConversations = async () => {
    try {
      // Ensure user is authenticated before loading conversations
      if (!user || !user.id) {
        console.log('No authenticated user found, skipping conversation load');
        setConversations([]);
        return;
      }
      
      console.log(`Loading conversations for user: ${user.id} (${user.email})`);
      
      const response = await axios.get(`${API_URL}/chat/conversations`, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });
      
      if (response.data.success) {
        const allConversations = response.data.conversations || [];
        console.log(`Loaded ${allConversations.length} total conversations for user ${user.id}`);
        
        // Filter out sub-chats - only show main chats in the sidebar
        const mainConversations = allConversations.filter(conv => {
          // A conversation is a main chat if it doesn't have a parent_id or parent_conversation_id
          return !conv.parent_id && !conv.parent_conversation_id && !conv.is_sub_chat;
        });
        
        console.log(`Filtered to ${mainConversations.length} main conversations (excluded ${allConversations.length - mainConversations.length} sub-chats)`);
        
        // Validate that all conversations belong to the current user
        const invalidConversations = mainConversations.filter(conv => 
          conv.user_id && conv.user_id !== user.id
        );
        
        if (invalidConversations.length > 0) {
          console.error('Found conversations not belonging to current user:', invalidConversations);
          // This should never happen with proper backend filtering, but adding as safety check
        }
        
        setConversations(mainConversations);
        
        // If no main conversations exist and we're on a conversation URL, check if it's a sub-chat
        if (mainConversations.length === 0) {
          const urlParams = new URLSearchParams(window.location.search);
          const currentConvId = urlParams.get('conversation');
          
          if (currentConvId) {
            // Check if the current conversation is a sub-chat
            const currentConv = allConversations.find(conv => conv.id === currentConvId);
            if (!currentConv) {
              // Conversation doesn't exist, redirect to home
              window.history.pushState({}, '', '/');
              window.dispatchEvent(new CustomEvent('allConversationsDeleted'));
            } else if (currentConv.parent_id || currentConv.parent_conversation_id || currentConv.is_sub_chat) {
              // Current conversation is a sub-chat, load its parent and expand it
              const parentId = currentConv.parent_id || currentConv.parent_conversation_id;
              const parentConv = allConversations.find(conv => conv.id === parentId);
              
              if (parentConv) {
                console.log(`Current conversation ${currentConvId} is a sub-chat of ${parentId}, loading parent`);
                setConversations([parentConv]);
                setExpandedConversations(prev => ({ ...prev, [parentId]: true }));
                await loadSubChats(parentId);
              } else {
                // Parent doesn't exist, redirect to home
                window.history.pushState({}, '', '/');
                window.dispatchEvent(new CustomEvent('allConversationsDeleted'));
              }
            } else {
              // It's a main conversation but not in our filtered list, redirect to home
              window.history.pushState({}, '', '/');
              window.dispatchEvent(new CustomEvent('allConversationsDeleted'));
            }
          }
        }
      } else {
        console.error('Failed to load conversations:', response.data);
        setConversations([]);
      }
    } catch (error) {
      console.error('Error loading conversations:', error);
      
      // If it's an authentication error, clear conversations
      if (error.response && error.response.status === 401) {
        console.log('Authentication error, clearing conversations');
        setConversations([]);
      }
    }
  };

  const handleDelete = async () => {
    if (!selectedConversation) return;
    
    // Extract conversationId outside try block so it's available in catch
    const conversationId = typeof selectedConversation === 'string' 
      ? selectedConversation 
      : selectedConversation.id;
    
    try {        
      console.log('Starting AGGRESSIVE deletion of conversation:', conversationId);
      console.log('Type of conversationId:', typeof conversationId);
      console.log('Selected conversation object:', selectedConversation);
      
      // Enhanced validation
      if (!conversationId || typeof conversationId !== 'string' || conversationId.trim() === '') {
        console.error('Invalid conversation ID:', conversationId);
        showSnackbar('Invalid conversation ID - cannot delete', 'error');
        return;
      }
      
      // Test auth headers before making the request
      const authHeaders = getAuthHeaders();
      console.log('Auth headers:', authHeaders);
      
      if (!authHeaders.Authorization) {
        console.error('No authorization header found');
        showSnackbar('Authentication required - please log in again', 'error');
        return;
      }
      
      // Test if conversation exists and is accessible first
      try {
        console.log('Testing conversation access...');
        const testResponse = await axios.get(`${API_URL}/chat/conversations`, {
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json'
          }
        });
        
        if (testResponse.data.success) {
          const userConversations = testResponse.data.conversations || [];
          const conversationExists = userConversations.find(conv => conv.id === conversationId);
          
          if (!conversationExists) {
            console.error('Conversation not found in user conversations:', conversationId);
            showSnackbar('Conversation not found or already deleted', 'warning');
            
            // Remove from local state anyway and reload conversations
            setConversations(prev => prev.filter(conv => conv.id !== conversationId));
            await loadConversations();
            setMenuAnchor(null);
            setSelectedConversation(null);
            setDeleteConfirmOpen(false);
            return;
          }
          
          console.log('Conversation exists and is accessible:', conversationExists.title);
        }
      } catch (testError) {
        console.error('Error testing conversation access:', testError);
        if (testError.response?.status === 401) {
          showSnackbar('Authentication expired - please log in again', 'error');
          return;
        }
        // Continue with deletion attempt even if test fails
        console.log('Continuing with deletion despite test failure...');
      }
      
      // STEP 1: Clear ALL localStorage BEFORE making the API call
      console.log('Clearing all localStorage entries...');
      const allKeys = Object.keys(localStorage);
      const clearedKeys = [];
      
      allKeys.forEach(key => {
        if (key.includes(conversationId) || 
            key === 'currentConversationId' || 
            key === 'chatMessages' ||
            key === 'userConversations' ||
            key === 'recentConversations' ||
            key.startsWith('chatMessages_') ||
            key.startsWith('conversationData_') ||
            key.startsWith('subChats_') ||
            key.startsWith('context_') ||
            key.includes('conv') ||
            key.includes('chat') ||
            key.includes('message')) {
          localStorage.removeItem(key);
          clearedKeys.push(key);
        }
      });
      
      console.log(`Cleared ${clearedKeys.length} localStorage keys:`, clearedKeys);
      
      // STEP 2: Make the API deletion call with enhanced debugging
      const deleteUrl = `${API_URL}/chat/conversations/${encodeURIComponent(conversationId)}`;
      const headers = {
        ...getAuthHeaders(),
        'Content-Type': 'application/json'
      };
      
      console.log('Making DELETE request to:', deleteUrl);
      console.log('Request headers:', headers);
      
      const response = await axios.delete(deleteUrl, {
        headers,
        timeout: 30000 // 30 second timeout
      });
      
      console.log('Delete API response:', response.data);
      
      if (response.data.success) {
        console.log('Server confirmed deletion, proceeding with cleanup...');
        
        // STEP 3: Additional localStorage cleanup (be extra sure)
        const additionalKeys = [
          `chatMessages_${conversationId}`,
          `conversationData_${conversationId}`,
          `subChats_${conversationId}`,
          `context_${conversationId}`,
          `hierarchy_${conversationId}`,
          `metadata_${conversationId}`,
          'currentConversationId',
          'chatMessages',
          'userConversations',
          'recentConversations',
          'cachedConversations'
        ];
        
        additionalKeys.forEach(key => {
          localStorage.removeItem(key);
        });
        
        // STEP 4: Close dialogs and reset state immediately
        setMenuAnchor(null);
        setSelectedConversation(null);
        setDeleteConfirmOpen(false);
        
        // STEP 5: Multiple attempts to reload conversations from server
        let freshConversations = [];
        let reloadSuccess = false;
        
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            console.log(`Reloading conversations attempt ${attempt}...`);
            
            // Add cache-busting parameters
            const freshResponse = await axios.get(`${API_URL}/chat/conversations?_t=${Date.now()}&_bust=${Math.random()}`, {
              headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
              }
            });
            
            if (freshResponse.data.success) {
              freshConversations = freshResponse.data.conversations || [];
              const conversationStillExists = freshConversations.find(conv => conv.id === conversationId);
              
              if (!conversationStillExists) {
                console.log(`Attempt ${attempt}: Conversation successfully removed from server`);
                setConversations(freshConversations);
                reloadSuccess = true;
                break;
              } else {
                console.log(`Attempt ${attempt}: Conversation still exists on server, trying again...`);
              }
            }
          } catch (reloadError) {
            console.error(`Reload attempt ${attempt} failed:`, reloadError);
          }
          
          // Wait before next attempt
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
        // STEP 6: If all reload attempts failed, force update local state
        if (!reloadSuccess) {
          console.log('All reload attempts failed, forcing local state update...');
          setConversations(prev => {
            const filtered = prev.filter(conv => conv.id !== conversationId);
            console.log(`Filtered conversations: ${prev.length} -> ${filtered.length}`);
            return filtered;
          });
        }
        
        // STEP 7: Clear sub-chats cache for this conversation
        setSubChats(prev => {
          const updated = { ...prev };
          delete updated[conversationId];
          return updated;
        });
        
        // STEP 8: Dispatch events for other components
        window.dispatchEvent(new CustomEvent('conversationDeleted', { 
          detail: { conversationId: conversationId } 
        }));
        
        // Check if no conversations remain
        if (freshConversations.length === 0) {
          window.dispatchEvent(new CustomEvent('allConversationsDeleted'));
          console.log('All conversations deleted - dispatched event');
        }
        
        // STEP 9: Show success message
        const successMessage = reloadSuccess 
          ? 'Conversation deleted and verified removed'
          : 'Conversation deleted (verification inconclusive)';
          
        showSnackbar(successMessage, reloadSuccess ? 'success' : 'warning');
        
        console.log('AGGRESSIVE DELETION COMPLETE:', successMessage);
        
      } else {
        console.error('Server deletion failed:', response.data);
        showSnackbar('Failed to delete conversation: ' + (response.data.error || 'Unknown error'), 'error');
      }
      
    } catch (error) {
      console.error('Error in aggressive conversation deletion:', error);
      
      // Check if this is a 400 error - try force delete as fallback
      if (error.response?.status === 400) {
        console.log('400 error detected, attempting force delete as fallback...');
        
        try {
          const forceDeleteUrl = `${API_URL}/chat/conversations/${encodeURIComponent(conversationId)}/force-delete`;
          console.log('Attempting force delete:', forceDeleteUrl);
          
          const forceResponse = await axios.delete(forceDeleteUrl, {
            headers: {
              ...getAuthHeaders(),
              'Content-Type': 'application/json'
            },
            timeout: 30000
          });
          
          if (forceResponse.data.success) {
            console.log('Force delete succeeded!');
            
            // Clear localStorage
            const allKeys = Object.keys(localStorage);
            allKeys.forEach(key => {
              if (key.includes(conversationId) || 
                  key.includes('conv') || 
                  key.includes('chat') || 
                  key.includes('message')) {
                localStorage.removeItem(key);
              }
            });
            
            // Reload conversations
            await loadConversations();
            
            // Reset state
            setMenuAnchor(null);
            setSelectedConversation(null);
            setDeleteConfirmOpen(false);
            
            showSnackbar('Conversation deleted successfully (used force delete)', 'success');
            
            return; // Exit successfully
          }
        } catch (forceError) {
          console.error('Force delete also failed:', forceError);
          // Continue to regular error handling below
        }
      }
      
      // Enhanced error reporting
      let errorMessage = 'Unknown error occurred';
      let errorDetails = '';
      
      if (error.response) {
        // Server responded with error status
        const status = error.response.status;
        const serverError = error.response.data?.error || error.response.data?.message || 'Server error';
        
        switch (status) {
          case 400:
            errorMessage = `Bad Request (400): ${serverError}`;
            errorDetails = 'This could be due to invalid conversation ID, malformed request, or validation error';
            break;
          case 401:
            errorMessage = 'Authentication expired - please log in again';
            errorDetails = 'Your session has expired';
            break;
          case 403:
            errorMessage = 'Permission denied - you may not own this conversation';
            errorDetails = 'This conversation may belong to another user';
            break;
          case 404:
            errorMessage = 'Conversation not found';
            errorDetails = 'The conversation may have already been deleted';
            break;
          case 500:
            errorMessage = `Server error (500): ${serverError}`;
            errorDetails = 'An internal server error occurred';
            break;
          default:
            errorMessage = `HTTP ${status}: ${serverError}`;
            errorDetails = `Unexpected server response`;
        }
        
        console.error('Server error details:', {
          status,
          statusText: error.response.statusText,
          data: error.response.data,
          headers: error.response.headers,
          config: error.config
        });
        
      } else if (error.request) {
        // Network error
        errorMessage = 'Network error - cannot reach server';
        errorDetails = 'Please check your internet connection';
        console.error('Network error:', error.request);
      } else {
        // Other error
        errorMessage = error.message || 'Unexpected error';
        errorDetails = 'An unexpected error occurred';
        console.error('Unexpected error:', error);
      }
      
      // Even if API call failed, clear localStorage anyway as emergency cleanup
      const emergencyCleanup = Object.keys(localStorage);
      emergencyCleanup.forEach(key => {
        if (key.includes(conversationId) || 
            key.includes('conv') || 
            key.includes('chat') || 
            key.includes('message')) {
          localStorage.removeItem(key);
        }
      });
      
      // Try to reload conversations in case the conversation was actually deleted
      try {
        await loadConversations();
        // Check if conversation still exists after reload
        const stillExists = conversations.find(conv => conv.id === conversationId);
        if (!stillExists) {
          errorMessage = 'Conversation was deleted but with errors';
          errorDetails = 'The conversation appears to have been removed despite the error';
        }
      } catch (reloadError) {
        console.error('Failed to reload conversations after error:', reloadError);
      }
      
      showSnackbar(`${errorMessage}${errorDetails ? ` - ${errorDetails}` : ''}`, 'error');
      
      // Reset dialog state
      setMenuAnchor(null);
      setSelectedConversation(null);
      setDeleteConfirmOpen(false);
    }
  };

  const createNewConversation = async () => {
    try {
      const response = await axios.post(`${API_URL}/chat/conversations`, {
        title: 'New Chat'
      }, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });
      
      if (response.data.success) {
        await loadConversations();
        // Navigate to the new conversation
        window.location.href = `/?conversation=${response.data.conversation.id}`;
      }
    } catch (error) {
      console.error('Error creating conversation:', error);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) return 'Today';
    if (diffDays === 2) return 'Yesterday';
    if (diffDays <= 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  // New function to group conversations by date
  const groupConversationsByDate = (conversations) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    const groups = {
      'Today': [],
      'Yesterday': [],
      'Previous 7 days': [],
      'Previous 30 days': [],
      'Older': []
    };

    conversations.forEach(conv => {
      const convDate = new Date(conv.created_at);
      const convDay = new Date(convDate.getFullYear(), convDate.getMonth(), convDate.getDate());

      if (convDay.getTime() === today.getTime()) {
        groups['Today'].push(conv);
      } else if (convDay.getTime() === yesterday.getTime()) {
        groups['Yesterday'].push(conv);
      } else if (convDate >= sevenDaysAgo) {
        groups['Previous 7 days'].push(conv);
      } else if (convDate >= thirtyDaysAgo) {
        groups['Previous 30 days'].push(conv);
      } else {
        groups['Older'].push(conv);
      }
    });

    return groups;
  };

  const conversationGroups = groupConversationsByDate(conversations);

  const displayedConversations = showAllConversations 
    ? conversations 
    : conversations.slice(0, 10);

  // Create groups for displayed conversations
  const displayedGroups = groupConversationsByDate(displayedConversations);
  
  // Filter out empty groups
  const nonEmptyGroups = Object.entries(displayedGroups).filter(([group, groupConversations]) => 
    groupConversations.length > 0
  );

  const renameConversation = async () => {
    if (!selectedConversation || !newTitle.trim()) return;
    
    try {
      const response = await axios.put(`${API_URL}/chat/conversations/${selectedConversation.id}/rename`, {
        title: newTitle.trim()
      }, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });
      
      if (response.data.success) {
        await loadConversations();
        setRenameDialogOpen(false);
        setNewTitle('');
        setSelectedConversation(null);
      }
    } catch (error) {
      console.error('Error renaming conversation:', error);
    }
  };

  const shareConversation = async (conversationId) => {
    try {
      const response = await axios.post(`${API_URL}/chat/conversations/${conversationId}/share`, {}, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });
      
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
      // You could add a toast notification here
    } catch (err) {
      console.error('Failed to copy URL:', err);
    }
  };

  const handleUserMenuOpen = (event) => {
    setUserMenuAnchor(event.currentTarget);
  };

  const handleUserMenuClose = () => {
    setUserMenuAnchor(null);
  };

  const handleLogout = async () => {
    await logout();
    setUserMenuAnchor(null);
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    setBulkDeleteConfirmOpen(false);
    
    try {
      console.log('Starting bulk delete of all conversations for current user');
      
      const response = await axios.delete(`${API_URL}/chat/conversations/bulk-delete`, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });
      
      if (response.data.success) {
        console.log('Bulk delete successful:', response.data);
        
        // Clear local state
        setConversations([]);
        setSubChats({});
        setExpandedConversations({});
        
        // Enhanced localStorage cleanup - remove ALL conversation-related data
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
            key.includes('context') ||
            key.includes('hierarchy') ||
            key.includes('metadata') ||
            key.includes('sub') ||
            key.includes('recent')
          )) {
            keysToRemove.push(key);
          }
        }
        
        keysToRemove.forEach(key => localStorage.removeItem(key));
        console.log('Cleared localStorage keys:', keysToRemove);
        
        // Clear sessionStorage completely for complete isolation
        sessionStorage.clear();
        
        // Navigate to clean home state
        window.history.pushState({}, '', '/');
        
        // Dispatch event to clear any cached conversation data in other components
        window.dispatchEvent(new CustomEvent('allConversationsDeleted'));
        
        // Force a complete page refresh to ensure no stale data remains
        setTimeout(() => {
          window.location.reload();
        }, 500);
        
        // Show success message
        showSnackbar(`Successfully deleted ${response.data.deleted_count} conversations. Page will refresh to ensure clean state.`, 'success');
        
        if (response.data.failed_count > 0) {
          console.warn(`${response.data.failed_count} conversations could not be deleted`);
          showSnackbar(`Deleted ${response.data.deleted_count} conversations, but ${response.data.failed_count} failed to delete. Page will refresh.`, 'warning');
        }
        
      } else {
        console.error('Bulk delete failed:', response.data);
        showSnackbar(response.data.error || 'Failed to delete conversations', 'error');
      }
      
    } catch (error) {
      console.error('Error during bulk delete:', error);
      showSnackbar('Error occurred while deleting conversations', 'error');
    } finally {
      setBulkDeleting(false);
      setUserMenuAnchor(null);
    }
  };

  const handleSubChatDelete = async () => {
    if (!selectedSubChat) return;
    
    try {
      const response = await axios.delete(`${API_URL}/chat/conversations/${selectedSubChat.id}`, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });
      
      if (response.data.success) {
        // Reload sub-chats for the parent conversation
        const parentId = selectedSubChat.parent_id;
        setSubChats(prev => ({ ...prev, [parentId]: [] })); // Clear cache
        await loadSubChats(parentId);
        
        setSubChatMenuAnchor(null);
        setSelectedSubChat(null);
      }
    } catch (error) {
      console.error('Error deleting sub-chat:', error);
    }
  };

  const createSubChat = async (parentId, title = null) => {
    try {
      const response = await axios.post(`${API_URL}/chat/conversations/${parentId}/sub-conversations`, {
        title: title || 'New Sub-chat',
        inherit_context: false  // Create fresh sub chat without parent history
      }, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });
      
      if (response.data.success) {
        const newSubChat = response.data.conversation;
        
        // Update local storage with new structured format
        if (chatStorage.current) {
          chatStorage.current.saveSubChat(parentId, {
            id: newSubChat.id,
            title: newSubChat.title,
            created_at: newSubChat.created_at,
            messages: []
          });
        }
        
        // Reload sub-chats for the parent
        setSubChats(prev => ({ ...prev, [parentId]: [] })); // Clear cache
        await loadSubChats(parentId);
        
        // Show success message
        showSnackbar(`Sub-chat "${newSubChat.title}" created successfully`, 'success');
        
        // Navigate to the new sub-chat
        window.location.href = `/?conversation=${newSubChat.id}`;
      }
    } catch (error) {
      console.error('Error creating sub-chat:', error);
      showSnackbar('Failed to create sub-chat. Please try again.', 'error');
    } finally {
      setQuickCreateParent(null);
    }
  };

  // Enhanced quick create sub-chat from main chat
  const quickCreateSubChat = (parentId, parentTitle) => {
    setQuickCreateParent({ id: parentId, title: parentTitle });
    // Auto-create with smart naming
    const subChatTitle = `${parentTitle} - Discussion`;
    createSubChat(parentId, subChatTitle);
  };

  // Enhanced sub-chat management
  const handleSubChatAction = (action, subChat, parentId) => {
    switch (action) {
      case 'rename':
        setSelectedSubChat({ ...subChat, parent_id: parentId });
        setNewSubChatTitle(subChat.title || '');
        setSubChatRenameDialogOpen(true);
        break;
      case 'delete':
        setSelectedSubChat({ ...subChat, parent_id: parentId });
        setSubChatDeleteConfirmOpen(true);
        break;
      case 'duplicate':
        createSubChat(parentId, `Copy of ${subChat.title}`);
        break;
      default:
        break;
    }
    setSubChatMenuAnchor(null);
  };

  const toggleConversationExpanded = (convId) => {
    setExpandedConversations(prev => {
      const newExpanded = { ...prev, [convId]: !prev[convId] };
      
      // If expanding and we don't have sub-chats loaded yet, load them
      if (newExpanded[convId] && !subChats[convId]) {
        loadSubChats(convId);
      }
      
      return newExpanded;
    });
  };

  // Sub-chat functions
  const loadSubChats = async (conversationId) => {
    if (subChats[conversationId] || loadingSubChats[conversationId]) return;
    
    setLoadingSubChats(prev => ({ ...prev, [conversationId]: true }));
    
    try {
      const response = await axios.get(`${API_URL}/chat/conversations/${conversationId}/sub-conversations`, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });
      
      if (response.data.success) {
        setSubChats(prev => ({
          ...prev,
          [conversationId]: response.data.conversations || []
        }));
      }
    } catch (error) {
      console.error('Error loading sub-chats:', error);
    } finally {
      setLoadingSubChats(prev => ({ ...prev, [conversationId]: false }));
    }
  };

  const renameSubChat = async () => {
    if (!selectedSubChat || !newSubChatTitle.trim()) return;
    
    try {
      const response = await axios.put(`${API_URL}/chat/conversations/${selectedSubChat.id}/rename`, {
        title: newSubChatTitle.trim()
      }, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });
      
      if (response.data.success) {
        // Reload sub-chats for the parent conversation
        const parentId = selectedSubChat.parent_id;
        setSubChats(prev => ({ ...prev, [parentId]: [] })); // Clear cache
        await loadSubChats(parentId);
        
        setSubChatRenameDialogOpen(false);
        setNewSubChatTitle('');
        setSelectedSubChat(null);
      }
    } catch (error) {
      console.error('Error renaming sub-chat:', error);
    }
  };

  const drawer = (
    <Box sx={{ 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column', 
      background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
      borderRight: '1px solid #e2e8f0'
    }}>
      {/* User Info Section */}
      <Box sx={{ p: 2, borderBottom: '1px solid #e2e8f0' }}>
        <Box 
          sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 1.5,
            p: 1.5,
            borderRadius: 2,
            bgcolor: 'rgba(255, 255, 255, 0.7)',
            border: '1px solid rgba(99, 102, 241, 0.1)',
            cursor: 'pointer',
            transition: 'all 0.2s ease-in-out',
            '&:hover': {
              bgcolor: 'rgba(255, 255, 255, 0.9)',
              transform: 'translateY(-1px)',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            }
          }}
          onClick={handleUserMenuOpen}
        >
          <Avatar 
            src={user?.picture} 
            alt={user?.name}
            sx={{ 
              width: 36, 
              height: 36,
              border: '2px solid #6366f1'
            }}
          >
            {user?.name?.charAt(0)}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography 
              variant="subtitle2" 
              sx={{ 
                fontWeight: 600,
                color: '#1f2937',
                fontSize: '14px',
                noWrap: true
              }}
            >
              {user?.name}
            </Typography>
            <Typography 
              variant="caption" 
              sx={{ 
                color: '#6b7280',
                fontSize: '12px',
                noWrap: true,
                display: 'block'
              }}
            >
              {user?.email}
            </Typography>
          </Box>
          <MoreVertIcon sx={{ color: '#9ca3af', fontSize: 20 }} />
        </Box>
      </Box>

      {/* Header */}
      <Box sx={{ p: 2, borderBottom: '1px solid #e2e8f0' }}>
        <Button
          fullWidth
          variant="contained"
          startIcon={<AddIcon />}
          onClick={createNewConversation}
          sx={{
            mb: 1.5,
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            color: '#ffffff',
            textTransform: 'none',
            fontWeight: 600,
            py: 1.2,
            boxShadow: '0 4px 6px -1px rgba(99, 102, 241, 0.3)',
            '&:hover': {
              background: 'linear-gradient(135deg, #5b5bd6 0%, #7c3aed 100%)',
              transform: 'translateY(-2px)',
              boxShadow: '0 8px 15px -3px rgba(99, 102, 241, 0.4)',
            }
          }}
        >
          New chat
        </Button>
      </Box>

      {/* Conversation History */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 1 }}>
        {conversations.length > 0 ? (
          <List dense sx={{ py: 0 }}>
            {nonEmptyGroups.map(([group, groupConversations]) => (
              <Box key={group} sx={{ mb: 2 }}>
                {/* Group Header */}
                <Typography 
                  variant="overline" 
                  sx={{ 
                    fontWeight: 600, 
                    fontSize: '11px',
                    color: '#64748b',
                    letterSpacing: '0.5px',
                    px: 1,
                    py: 1,
                    display: 'block'
                  }}
                >
                  {group}
                </Typography>
                
                {/* Conversations in this group */}
                {groupConversations.map((conv) => (
                  <Box key={conv.id}>
                    {/* Main Conversation - Folder Style */}
                    <ListItem disablePadding sx={{ mb: 0.5 }}>
                      <Box sx={{ width: '100%', display: 'flex', alignItems: 'center' }}>
                        {/* Folder Expand/Collapse Icon */}
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleConversationExpanded(conv.id);
                          }}
                          sx={{ 
                            minWidth: 28,
                            height: 28,
                            mr: 0.5,
                            color: '#64748b',
                            '&:hover': { 
                              color: '#475569',
                              bgcolor: 'rgba(100, 116, 139, 0.1)'
                            }
                          }}
                        >
                          {expandedConversations[conv.id] ? 
                            <KeyboardArrowDownIcon fontSize="small" /> : 
                            <KeyboardArrowRightIcon fontSize="small" />
                          }
                        </IconButton>

                        {/* Main Conversation Button with Folder Icon */}
                        <ListItemButton
                          component={Link}
                          to={`/?conversation=${conv.id}`}
                          onClick={() => {
                            if (isMobile) setMobileOpen(false);
                            setTimeout(() => {
                              window.dispatchEvent(new CustomEvent('conversationChange', { 
                                detail: { conversationId: conv.id } 
                              }));
                            }, 100);
                          }}
                          className={currentConversationId === conv.id ? 'active' : ''}
                          sx={{
                            borderRadius: 2,
                            py: 1,
                            px: 1.5,
                            color: '#475569',
                            flex: 1,
                            transition: 'all 0.2s ease-in-out',
                            '&:hover': {
                              bgcolor: '#f8fafc',
                              transform: 'translateX(2px)',
                              boxShadow: '0 2px 4px -1px rgba(0, 0, 0, 0.1)',
                            },
                            '&.active': {
                              bgcolor: '#eff6ff',
                              color: '#2563eb',
                              boxShadow: '0 2px 4px -1px rgba(37, 99, 235, 0.2)',
                            }
                          }}
                        >
                          <ListItemIcon sx={{ minWidth: 32 }}>
                            {expandedConversations[conv.id] ? 
                              <FolderOpenIcon sx={{ fontSize: 20, color: '#f59e0b' }} /> :
                              <FolderIcon sx={{ fontSize: 20, color: '#f59e0b' }} />
                            }
                          </ListItemIcon>
                          <ListItemText 
                            primary={conv.title || 'New Chat'}
                            secondary={formatDate(conv.created_at)}
                            primaryTypographyProps={{ 
                              fontSize: '14px',
                              fontWeight: 600,
                              noWrap: true
                            }}
                            secondaryTypographyProps={{ 
                              fontSize: '11px',
                              color: '#94a3b8'
                            }}
                          />
                        </ListItemButton>

                        {/* Add Sub-chat Button */}
                        <Tooltip title="Create Sub-chat" placement="top">
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              quickCreateSubChat(conv.id, conv.title);
                            }}
                            sx={{ 
                              minWidth: 28,
                              height: 28,
                              mr: 0.5,
                              color: '#10b981',
                              opacity: 0.7,
                              transition: 'all 0.2s ease-in-out',
                              '&:hover': { 
                                opacity: 1,
                                bgcolor: 'rgba(16, 185, 129, 0.1)',
                                transform: 'scale(1.1)'
                              }
                            }}
                          >
                            <CreateNewFolderIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>

                        {/* Main Chat Options Menu */}
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSelectedConversation(conv);
                            setMenuAnchor(e.currentTarget);
                          }}
                          sx={{ 
                            minWidth: 28,
                            height: 28,
                            color: '#64748b',
                            '&:hover': { 
                              color: '#475569',
                              bgcolor: 'rgba(100, 116, 139, 0.1)'
                            }
                          }}
                        >
                          <MoreVertIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    </ListItem>

                    {/* Sub-conversations - Collapsible */}
                    <Collapse in={expandedConversations[conv.id]} timeout="auto" unmountOnExit>
                      <Box sx={{ pl: 4, pr: 1, py: 0.5 }}>
                        {loadingSubChats[conv.id] ? (
                          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                            <CircularProgress size={20} />
                          </Box>
                        ) : (
                          <>
                            {/* Add New Sub-chat Option */}
                            <ListItem disablePadding sx={{ mb: 0.5 }}>
                              <ListItemButton
                                onClick={() => createSubChat(conv.id)}
                                sx={{
                                  borderRadius: 1.5,
                                  py: 0.8,
                                  px: 1.5,
                                  color: '#10b981',
                                  border: '1px dashed #10b981',
                                  opacity: 0.8,
                                  transition: 'all 0.2s ease-in-out',
                                  '&:hover': {
                                    opacity: 1,
                                    bgcolor: 'rgba(16, 185, 129, 0.05)',
                                    borderColor: '#059669',
                                    transform: 'translateX(4px)',
                                  }
                                }}
                              >
                                <ListItemIcon sx={{ minWidth: 28 }}>
                                  <AddIcon sx={{ fontSize: 16, color: '#10b981' }} />
                                </ListItemIcon>
                                <ListItemText 
                                  primary="New Sub-chat"
                                  primaryTypographyProps={{ 
                                    fontSize: '13px',
                                    fontWeight: 500,
                                    fontStyle: 'italic'
                                  }}
                                />
                              </ListItemButton>
                            </ListItem>

                            {/* Existing Sub-conversations */}
                            {subChats[conv.id] && subChats[conv.id].map((subChat) => (
                              <ListItem key={subChat.id} disablePadding sx={{ mb: 0.5 }}>
                                <Box sx={{ width: '100%', display: 'flex', alignItems: 'center' }}>
                                  {/* Sub-chat connector line with improved design */}
                                  <Box 
                                    sx={{ 
                                      width: 20,
                                      height: 1,
                                      bgcolor: '#cbd5e1',
                                      mr: 1,
                                      position: 'relative',
                                      '&::before': {
                                        content: '""',
                                        position: 'absolute',
                                        left: -12,
                                        top: -12,
                                        width: 1,
                                        height: 24,
                                        bgcolor: '#cbd5e1'
                                      },
                                      '&::after': {
                                        content: '""',
                                        position: 'absolute',
                                        right: 0,
                                        top: -2,
                                        width: 4,
                                        height: 4,
                                        bgcolor: '#6366f1',
                                        borderRadius: '50%'
                                      }
                                    }} 
                                  />
                                  
                                  <ListItemButton
                                    component={Link}
                                    to={`/?conversation=${subChat.id}`}
                                    onClick={() => {
                                      if (isMobile) setMobileOpen(false);
                                      setTimeout(() => {
                                        window.dispatchEvent(new CustomEvent('conversationChange', { 
                                          detail: { conversationId: subChat.id } 
                                        }));
                                      }, 100);
                                    }}
                                    className={currentConversationId === subChat.id ? 'active' : ''}
                                    sx={{
                                      borderRadius: 1.5,
                                      py: 1,
                                      px: 2,
                                      color: '#64748b',
                                      flex: 1,
                                      transition: 'all 0.2s ease-in-out',
                                      bgcolor: 'rgba(248, 250, 252, 0.7)',
                                      border: '1px solid rgba(226, 232, 240, 0.7)',
                                      position: 'relative',
                                      ml: 0.5,
                                      '&:hover': {
                                        bgcolor: '#f1f5f9',
                                        borderColor: '#cbd5e1',
                                        transform: 'translateX(6px)',
                                        boxShadow: '0 3px 6px -1px rgba(0, 0, 0, 0.1)',
                                        color: '#374151',
                                      },
                                      '&.active': {
                                        bgcolor: '#dbeafe',
                                        color: '#2563eb',
                                        borderColor: '#93c5fd',
                                        boxShadow: '0 3px 6px -1px rgba(37, 99, 235, 0.2)',
                                        '&::before': {
                                          content: '""',
                                          position: 'absolute',
                                          left: -3,
                                          top: 0,
                                          bottom: 0,
                                          width: 3,
                                          bgcolor: '#2563eb',
                                          borderRadius: '0 2px 2px 0'
                                        }
                                      }
                                    }}
                                  >
                                    <ListItemIcon sx={{ minWidth: 32 }}>
                                      <ChatBubbleOutlineIcon sx={{ fontSize: 18, color: '#6366f1' }} />
                                    </ListItemIcon>
                                    <ListItemText 
                                      primary={subChat.title || 'Untitled Sub-chat'}
                                      secondary={formatDate(subChat.created_at)}
                                      primaryTypographyProps={{ 
                                        fontSize: '13px',
                                        fontWeight: 500,
                                        noWrap: true
                                      }}
                                      secondaryTypographyProps={{ 
                                        fontSize: '10px',
                                        color: '#94a3b8'
                                      }}
                                    />
                                  </ListItemButton>

                                  {/* Sub-chat Options with improved design */}
                                  <Tooltip title="Rename sub-chat" placement="top">
                                    <IconButton
                                      size="small"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        handleSubChatAction('rename', subChat, conv.id);
                                      }}
                                      sx={{ 
                                        minWidth: 26,
                                        height: 26,
                                        mr: 0.5,
                                        color: '#64748b',
                                        opacity: 0.6,
                                        transition: 'all 0.2s ease-in-out',
                                        '&:hover': { 
                                          opacity: 1,
                                          bgcolor: 'rgba(100, 116, 139, 0.1)',
                                          color: '#374151',
                                          transform: 'scale(1.1)'
                                        }
                                      }}
                                    >
                                      <EditIcon sx={{ fontSize: 14 }} />
                                    </IconButton>
                                  </Tooltip>

                                  {/* Delete sub-chat option */}
                                  <Tooltip title="Delete sub-chat" placement="top">
                                    <IconButton
                                      size="small"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setSelectedSubChat(subChat);
                                        setSubChatDeleteConfirmOpen(true);
                                      }}
                                      sx={{ 
                                        minWidth: 26,
                                        height: 26,
                                        color: '#ef4444',
                                        opacity: 0.6,
                                        transition: 'all 0.2s ease-in-out',
                                        '&:hover': { 
                                          opacity: 1,
                                          bgcolor: 'rgba(239, 68, 68, 0.1)',
                                          transform: 'scale(1.1)'
                                        }
                                      }}
                                    >
                                      <DeleteIcon sx={{ fontSize: 14 }} />
                                    </IconButton>
                                  </Tooltip>
                                </Box>
                              </ListItem>
                            ))}
                          </>
                        )}
                      </Box>
                    </Collapse>
                  </Box>
                ))}
              </Box>
            ))}
            
            {conversations.length > 10 && !showAllConversations && (
              <ListItem>
                <Button
                  fullWidth
                  variant="text"
                  onClick={() => setShowAllConversations(true)}
                  sx={{
                    color: '#6366f1',
                    textTransform: 'none',
                    fontSize: '14px',
                    fontWeight: 500,
                    '&:hover': {
                      bgcolor: '#f0f4ff',
                    }
                  }}
                >
                  Show {conversations.length - 10} more
                </Button>
              </ListItem>
            )}
          </List>
        ) : (
          <Box sx={{ 
            textAlign: 'center', 
            py: 6,
            color: '#64748b'
          }}>
            <ChatIcon sx={{ fontSize: 48, mb: 2, opacity: 0.5 }} />
            <Typography variant="body2" sx={{ fontSize: '14px', fontWeight: 500 }}>
              No conversations yet
            </Typography>
            <Typography variant="body2" sx={{ fontSize: '12px', mt: 0.5, opacity: 0.7 }}>
              Start a new conversation to begin
            </Typography>
          </Box>
        )}
      </Box>

      {/* Footer */}
      <Box sx={{ 
        p: 2, 
        textAlign: 'center', 
        borderTop: '1px solid #e2e8f0',
        background: 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)'
      }}>
        <Typography variant="caption" sx={{ 
          color: '#64748b', 
          fontSize: '11px',
          fontWeight: 500,
          letterSpacing: '0.5px'
        }}>
          Personal GPT © {new Date().getFullYear()}
        </Typography>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: '#ffffff' }}>
      {/* AppBar - Only show on mobile */}
      {isMobile && (
        <AppBar
          position="fixed"
          elevation={0}
          sx={{
            zIndex: theme.zIndex.drawer + 1,
            bgcolor: '#ffffff',
            borderBottom: '1px solid #e5e5e7',
            color: '#374151'
          }}
        >
          <Toolbar>
            <IconButton
              color="inherit"
              aria-label="open drawer"
              edge="start"
              onClick={handleDrawerToggle}
              sx={{ mr: 2 }}
            >
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" noWrap component="div" sx={{ fontWeight: 600 }}>
              {location.pathname === '/logs' ? 'Daily Logs' : 'Personal GPT'}
            </Typography>
          </Toolbar>
        </AppBar>
      )}

      {/* Sidebar Drawer */}
      <Box
        component="nav"
        sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}
        aria-label="sidebar"
      >
        {/* Temporary drawer for mobile */}
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', md: 'none' },
            '& .MuiDrawer-paper': { 
              boxSizing: 'border-box', 
              width: drawerWidth,
              bgcolor: '#f9f9f9',
              borderRight: '1px solid #e5e5e7'
            }
          }}
        >
          {drawer}
        </Drawer>
        {/* Permanent drawer for desktop */}
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', md: 'block' },
            '& .MuiDrawer-paper': { 
              boxSizing: 'border-box', 
              width: drawerWidth,
              bgcolor: '#f9f9f9',
              borderRight: '1px solid #e5e5e7'
            }
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>

      {/* Main Content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { xs: '100%', md: `calc(100% - ${drawerWidth}px)` },
          mt: { xs: 8, md: 0 },
          minHeight: '100vh',
          bgcolor: '#ffffff'
        }}
      >
        <Outlet />
      </Box>

      {/* Menu for chat actions */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
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
        <MenuItem onClick={() => {
          setRenameDialogOpen(true);
          setMenuAnchor(null);
        }}>
          <ListItemIcon>
            <EditIcon fontSize="small" sx={{ color: '#6366f1' }} />
          </ListItemIcon>
          <ListItemText>Rename</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => shareConversation(selectedConversation?.id || selectedConversation)}>
          <ListItemIcon>
            <ShareIcon fontSize="small" sx={{ color: '#6366f1' }} />
          </ListItemIcon>
          <ListItemText>Share</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => {
          setDeleteConfirmOpen(true);
          setMenuAnchor(null);
        }}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" sx={{ color: '#ef4444' }} />
          </ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>

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
            onClick={renameConversation}
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

      {/* Sub-chat Menu */}
      <Menu
        anchorEl={subChatMenuAnchor}
        open={Boolean(subChatMenuAnchor)}
        onClose={() => setSubChatMenuAnchor(null)}
        PaperProps={{
          elevation: 2,
          sx: {
            mt: 1,
            minWidth: 160,
            borderRadius: 2,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
          }
        }}
      >
        <MenuItem onClick={() => {
          setSubChatRenameDialogOpen(true);
          setSubChatMenuAnchor(null);
        }}>
          <ListItemIcon>
            <EditIcon fontSize="small" sx={{ color: '#6366f1' }} />
          </ListItemIcon>
          <ListItemText>Rename</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => {
          setSubChatDeleteConfirmOpen(true);
          setSubChatMenuAnchor(null);
        }}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" sx={{ color: '#ef4444' }} />
          </ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>

      {/* Sub-chat Rename Dialog */}
      <Dialog 
        open={subChatRenameDialogOpen} 
        onClose={() => setSubChatRenameDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Rename Sub-chat</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="New Title"
            fullWidth
            value={newSubChatTitle}
            onChange={(e) => setNewSubChatTitle(e.target.value)}
            variant="outlined"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSubChatRenameDialogOpen(false)}>Cancel</Button>
          <Button 
            onClick={renameSubChat}
            variant="contained"
            color="primary"
          >
            Rename
          </Button>
        </DialogActions>
      </Dialog>

      {/* User Menu */}
      <Menu
        anchorEl={userMenuAnchor}
        open={Boolean(userMenuAnchor)}
        onClose={handleUserMenuClose}
        PaperProps={{
          elevation: 2,
          sx: {
            mt: 1,
            minWidth: 200,
            borderRadius: 2,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
          }
        }}
      >
        <Box sx={{ p: 2, borderBottom: '1px solid #e5e7eb' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#1f2937' }}>
            {user?.name}
          </Typography>
          <Typography variant="caption" sx={{ color: '#6b7280' }}>
            {user?.email}
          </Typography>
        </Box>
        <MenuItem onClick={() => {
          setBulkDeleteConfirmOpen(true);
          setUserMenuAnchor(null);
        }}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" sx={{ color: '#ef4444' }} />
          </ListItemIcon>
          <ListItemText>Delete All Conversations</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleLogout}>
          <ListItemIcon>
            <LogoutIcon fontSize="small" sx={{ color: '#ef4444' }} />
          </ListItemIcon>
          <ListItemText>Sign out</ListItemText>
        </MenuItem>
      </Menu>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Confirm Deletion</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="textSecondary" gutterBottom>
            Are you sure you want to delete this conversation? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
          <Button
            onClick={handleDelete}
            variant="contained"
            color="primary"
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Sub-chat Delete Confirmation Dialog */}
      <Dialog
        open={subChatDeleteConfirmOpen}
        onClose={() => setSubChatDeleteConfirmOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ color: '#ef4444' }}>Delete Sub-chat</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="textSecondary" gutterBottom>
            Are you sure you want to delete this sub-chat? This action cannot be undone.
          </Typography>
          {selectedSubChat && (
            <Typography variant="body2" sx={{ mt: 1, fontWeight: 500 }}>
              Sub-chat: "{selectedSubChat.title || 'Untitled Sub-chat'}"
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSubChatDeleteConfirmOpen(false)}>Cancel</Button>
          <Button
            onClick={handleSubChatDelete}
            variant="contained"
            color="error"
          >
            Delete Sub-chat
          </Button>
        </DialogActions>
      </Dialog>

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog
        open={bulkDeleteConfirmOpen}
        onClose={() => setBulkDeleteConfirmOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ color: '#ef4444' }}>Delete All Conversations</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="textSecondary" gutterBottom>
            <strong>Warning:</strong> This will permanently delete ALL of your conversations and chat history. 
            This action cannot be undone.
          </Typography>
          <Typography variant="body2" color="textSecondary" sx={{ mt: 2 }}>
            You currently have <strong>{conversations.length}</strong> conversations that will be deleted.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkDeleteConfirmOpen(false)}>Cancel</Button>
          <Button
            onClick={handleBulkDelete}
            variant="contained"
            color="error"
            disabled={bulkDeleting}
          >
            {bulkDeleting ? 'Deleting...' : 'Delete All Conversations'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Success/Error Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setSnackbar({ ...snackbar, open: false })} 
          severity={snackbar.severity} 
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default Layout;