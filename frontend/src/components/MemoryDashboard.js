import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Card,
  CardContent,
  IconButton,
  Chip,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Divider,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tab,
  Tabs,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Alert,
  LinearProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Badge,
  Tooltip
} from '@mui/material';
import {
  Search as SearchIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  Upload as UploadIcon,
  Memory as MemoryIcon,
  History as HistoryIcon,
  Chat as ChatIcon,
  Timeline as TimelineIcon,
  FilterList as FilterIcon,
  ExpandMore as ExpandMoreIcon,
  Clear as ClearIcon,
  Insights as InsightsIcon,
  Tag as TagIcon,
  CloudSync as CloudSyncIcon,
  CloudOff as CloudOffIcon
} from '@mui/icons-material';
import { useMemory } from '../contexts/MemoryContext';

const MemoryDashboard = ({ open, onClose }) => {
  const {
    searchMemory,
    searchResults,
    recentActivities,
    conversationHistory,
    deleteConversation,
    exportMemoryData,
    importMemoryData,
    clearAllMemory,
    getMemoryStats,
    memorySystem
  } = useMemory();

  const [activeTab, setActiveTab] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFilters, setSearchFilters] = useState({
    type: '',
    startDate: '',
    endDate: '',
    tags: []
  });
  const [memoryStats, setMemoryStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({ open: false, action: '', data: null });
  const [notification, setNotification] = useState({ show: false, message: '', type: 'info' });
  const [syncStatus, setSyncStatus] = useState('checking');

  useEffect(() => {
    if (open) {
      loadMemoryStats();
      checkSyncStatus();
    }
  }, [open]);

  const checkSyncStatus = async () => {
    if (!memorySystem) {
      setSyncStatus('disabled');
      return;
    }

    try {
      const isSynced = await memorySystem.checkSyncStatus();
      setSyncStatus(isSynced ? 'synced' : 'syncing');
    } catch (error) {
      console.error('Error checking sync status:', error);
      setSyncStatus('error');
    }
  };

  const loadMemoryStats = async () => {
    try {
      setLoading(true);
      const stats = await getMemoryStats();
      setMemoryStats(stats);
    } catch (error) {
      console.error('Error loading memory stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    try {
      setLoading(true);
      await searchMemory(searchQuery, searchFilters);
    } catch (error) {
      showNotification('Search failed: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteConversation = async (conversationId) => {
    try {
      setLoading(true);
      const success = await deleteConversation(conversationId);
      if (success) {
        showNotification('Conversation deleted successfully', 'success');
        loadMemoryStats();
      } else {
        showNotification('Failed to delete conversation', 'error');
      }
    } catch (error) {
      showNotification('Error deleting conversation: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleExportData = async () => {
    try {
      setLoading(true);
      const data = await exportMemoryData();
      
      if (data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `memory-export-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showNotification('Memory data exported successfully', 'success');
      }
    } catch (error) {
      showNotification('Export failed: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleImportData = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      setLoading(true);
      const text = await file.text();
      const data = JSON.parse(text);
      
      const success = await importMemoryData(data);
      if (success) {
        showNotification('Memory data imported successfully', 'success');
        loadMemoryStats();
      } else {
        showNotification('Import failed', 'error');
      }
    } catch (error) {
      showNotification('Import failed: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleClearAllMemory = async () => {
    try {
      setLoading(true);
      const success = await clearAllMemory();
      if (success) {
        showNotification('All memory data cleared', 'success');
        loadMemoryStats();
      } else {
        showNotification('Failed to clear memory data', 'error');
      }
    } catch (error) {
      showNotification('Error clearing memory: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const showNotification = (message, type = 'info') => {
    setNotification({ show: true, message, type });
    setTimeout(() => setNotification({ show: false, message: '', type: 'info' }), 5000);
  };

  const formatDate = (dateString) => {
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return 'Invalid date';
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const MemoryStatsPanel = () => (
    <Grid container spacing={3}>
      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Box display="flex" alignItems="center" mb={2}>
              <ChatIcon color="primary" />
              <Typography variant="h6" ml={1}>Conversations</Typography>
            </Box>
            <Typography variant="h3" color="primary">
              {memoryStats?.conversationCount || 0}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Total words: {memoryStats?.totalWordCount?.toLocaleString() || 0}
            </Typography>
          </CardContent>
        </Card>
      </Grid>
      
      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Box display="flex" alignItems="center" mb={2}>
              <TimelineIcon color="secondary" />
              <Typography variant="h6" ml={1}>Activities</Typography>
            </Box>
            <Typography variant="h3" color="secondary">
              {memoryStats?.activityCount || 0}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Search terms: {memoryStats?.searchTermCount || 0}
            </Typography>
          </CardContent>
        </Card>
      </Grid>
      
      <Grid item xs={12}>
        <Card>
          <CardContent>
            <Typography variant="h6" mb={2}>Usage Timeline</Typography>
            {memoryStats?.oldestActivity && memoryStats?.newestActivity ? (
              <Box>
                <Typography variant="body2" color="textSecondary">
                  First activity: {formatDate(memoryStats.oldestActivity)}
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Latest activity: {formatDate(memoryStats.newestActivity)}
                </Typography>
                <LinearProgress 
                  variant="determinate" 
                  value={75} 
                  sx={{ mt: 1, height: 8, borderRadius: 1 }} 
                />
              </Box>
            ) : (
              <Typography variant="body2" color="textSecondary">
                No activity data available
              </Typography>
            )}
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );

  const SearchPanel = () => (
    <Box>
      <Box display="flex" gap={2} mb={3}>
        <TextField
          fullWidth
          placeholder="Search conversations and activities..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          InputProps={{
            endAdornment: (
              <IconButton onClick={handleSearch} disabled={!searchQuery.trim()}>
                <SearchIcon />
              </IconButton>
            )
          }}
        />
      </Box>

      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box display="flex" alignItems="center">
            <FilterIcon />
            <Typography ml={1}>Advanced Filters</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <FormControl fullWidth>
                <InputLabel>Type</InputLabel>
                <Select
                  value={searchFilters.type}
                  onChange={(e) => setSearchFilters(prev => ({ ...prev, type: e.target.value }))}
                >
                  <MenuItem value="">All Types</MenuItem>
                  <MenuItem value="conversation">Conversations</MenuItem>
                  <MenuItem value="search">Searches</MenuItem>
                  <MenuItem value="input">Inputs</MenuItem>
                  <MenuItem value="page_visit">Page Visits</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                type="date"
                label="Start Date"
                value={searchFilters.startDate}
                onChange={(e) => setSearchFilters(prev => ({ ...prev, startDate: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                type="date"
                label="End Date"
                value={searchFilters.endDate}
                onChange={(e) => setSearchFilters(prev => ({ ...prev, endDate: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {searchResults && (
        <Box mt={3}>
          <Typography variant="h6" mb={2}>
            Search Results ({searchResults.total} items found)
          </Typography>
          
          {searchResults.conversations.length > 0 && (
            <Box mb={3}>
              <Typography variant="subtitle1" mb={1} color="primary">
                Conversations ({searchResults.conversations.length})
              </Typography>
              <List>
                {searchResults.conversations.map((conv) => (
                  <ListItem key={conv.id} divider>
                    <ListItemText
                      primary={conv.title || 'Untitled Conversation'}
                      secondary={
                        <Box>
                          <Typography variant="body2" color="textSecondary">
                            {conv.summary}
                          </Typography>
                          <Box display="flex" gap={1} mt={1}>
                            {conv.tags?.map((tag) => (
                              <Chip key={tag} label={tag} size="small" />
                            ))}
                          </Box>
                          <Typography variant="caption" color="textSecondary">
                            {formatDate(conv.timestamp)} • {conv.messageCount} messages
                          </Typography>
                        </Box>
                      }
                    />
                    <ListItemSecondaryAction>
                      <IconButton
                        onClick={() => setConfirmDialog({
                          open: true,
                          action: 'delete',
                          data: conv.id
                        })}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
          
          {searchResults.activities.length > 0 && (
            <Box>
              <Typography variant="subtitle1" mb={1} color="secondary">
                Activities ({searchResults.activities.length})
              </Typography>
              <List>
                {searchResults.activities.slice(0, 20).map((activity) => (
                  <ListItem key={activity.id} divider>
                    <ListItemText
                      primary={
                        <Box display="flex" alignItems="center" gap={1}>
                          <Chip label={activity.type} size="small" color="secondary" />
                          <Typography variant="body2">
                            {activity.data.content || activity.data.query || activity.data.page || 'Activity'}
                          </Typography>
                        </Box>
                      }
                      secondary={formatDate(activity.timestamp)}
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );

  const ConversationHistoryPanel = () => (
    <Box>
      <Typography variant="h6" mb={2}>Recent Conversations</Typography>
      <List>
        {conversationHistory.map((conv) => (
          <ListItem key={conv.id} divider>
            <ListItemText
              primary={conv.title || 'Untitled Conversation'}
              secondary={
                <Box>
                  <Typography variant="body2" color="textSecondary">
                    {conv.summary}
                  </Typography>
                  <Box display="flex" gap={1} mt={1}>
                    {conv.tags?.map((tag) => (
                      <Chip key={tag} label={tag} size="small" />
                    ))}
                  </Box>
                  <Typography variant="caption" color="textSecondary">
                    {formatDate(conv.lastUpdated)} • {conv.messageCount} messages • {conv.wordCount} words
                  </Typography>
                </Box>
              }
            />
            <ListItemSecondaryAction>
              <IconButton
                onClick={() => setConfirmDialog({
                  open: true,
                  action: 'delete',
                  data: conv.id
                })}
              >
                <DeleteIcon />
              </IconButton>
            </ListItemSecondaryAction>
          </ListItem>
        ))}
      </List>
    </Box>
  );

  const ActivityLogPanel = () => (
    <Box>
      <Typography variant="h6" mb={2}>Recent Activities</Typography>
      <List>
        {recentActivities.map((activity) => (
          <ListItem key={activity.id} divider>
            <ListItemText
              primary={
                <Box display="flex" alignItems="center" gap={1}>
                  <Badge color="secondary" variant="dot">
                    <Chip label={activity.type} size="small" />
                  </Badge>
                  <Typography variant="body2">
                    {activity.type === 'search' && `Searched: "${activity.data.query}"`}
                    {activity.type === 'input' && `Input: "${activity.data.content?.substring(0, 50)}..."`}
                    {activity.type === 'page_visit' && `Visited: ${activity.data.page}`}
                    {activity.type === 'button_click' && `Clicked: ${activity.data.text}`}
                    {!['search', 'input', 'page_visit', 'button_click'].includes(activity.type) && 
                      `${activity.type}: ${JSON.stringify(activity.data).substring(0, 50)}...`}
                  </Typography>
                </Box>
              }
              secondary={
                <Typography variant="caption" color="textSecondary">
                  {formatDate(activity.timestamp)} • Session: {activity.sessionId?.substring(0, 8)}...
                </Typography>
              }
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );

  const DataManagementPanel = () => (
    <Box>
      <Typography variant="h6" mb={3}>Data Management</Typography>
      
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" mb={2}>Export Data</Typography>
              <Typography variant="body2" color="textSecondary" mb={2}>
                Download all your memory data as a JSON file for backup or transfer.
              </Typography>
              <Button
                variant="contained"
                startIcon={<DownloadIcon />}
                onClick={handleExportData}
                disabled={loading}
                fullWidth
              >
                Export All Data
              </Button>
            </CardContent>
          </Card>
        </Grid>
        
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" mb={2}>Import Data</Typography>
              <Typography variant="body2" color="textSecondary" mb={2}>
                Upload a previously exported JSON file to restore your memory data.
              </Typography>
              <input
                type="file"
                accept=".json"
                onChange={handleImportData}
                style={{ display: 'none' }}
                id="import-file-input"
              />
              <label htmlFor="import-file-input">
                <Button
                  variant="outlined"
                  component="span"
                  startIcon={<UploadIcon />}
                  disabled={loading}
                  fullWidth
                >
                  Import Data
                </Button>
              </label>
            </CardContent>
          </Card>
        </Grid>
        
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" mb={2} color="error">Danger Zone</Typography>
              <Typography variant="body2" color="textSecondary" mb={2}>
                Permanently delete all memory data. This action cannot be undone.
              </Typography>
              <Button
                variant="outlined"
                color="error"
                startIcon={<ClearIcon />}
                onClick={() => setConfirmDialog({
                  open: true,
                  action: 'clearAll',
                  data: null
                })}
                disabled={loading}
              >
                Clear All Memory Data
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );

  const tabPanels = [
    { label: 'Overview', icon: <InsightsIcon />, component: <MemoryStatsPanel /> },
    { label: 'Search', icon: <SearchIcon />, component: <SearchPanel /> },
    { label: 'Conversations', icon: <ChatIcon />, component: <ConversationHistoryPanel /> },
    { label: 'Activities', icon: <HistoryIcon />, component: <ActivityLogPanel /> },
    { label: 'Data Management', icon: <MemoryIcon />, component: <DataManagementPanel /> }
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          height: '90vh',
          maxHeight: '90vh'
        }
      }}
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">Memory Dashboard</Typography>
          <Box display="flex" alignItems="center" gap={1}>
            {syncStatus === 'synced' && (
              <Tooltip title="Synced with cloud">
                <CloudSyncIcon color="success" />
              </Tooltip>
            )}
            {syncStatus === 'syncing' && (
              <Tooltip title="Syncing with cloud">
                <CloudSyncIcon color="primary" />
              </Tooltip>
            )}
            {syncStatus === 'error' && (
              <Tooltip title="Sync error">
                <CloudOffIcon color="error" />
              </Tooltip>
            )}
            <IconButton onClick={onClose}>
              <ClearIcon />
            </IconButton>
          </Box>
        </Box>
      </DialogTitle>
      
      <DialogContent dividers>
        {notification.show && (
          <Alert 
            severity={notification.type} 
            sx={{ mb: 2 }}
            onClose={() => setNotification({ show: false, message: '', type: 'info' })}
          >
            {notification.message}
          </Alert>
        )}
        
        {loading && <LinearProgress sx={{ mb: 2 }} />}
        
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
          <Tabs value={activeTab} onChange={(e, newValue) => setActiveTab(newValue)}>
            {tabPanels.map((tab, index) => (
              <Tab 
                key={index}
                icon={tab.icon} 
                label={tab.label} 
                iconPosition="start"
              />
            ))}
          </Tabs>
        </Box>
        
        <Box sx={{ minHeight: 400 }}>
          {tabPanels[activeTab]?.component}
        </Box>
      </DialogContent>
      
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>

      {/* Confirmation Dialog */}
      <Dialog
        open={confirmDialog.open}
        onClose={() => setConfirmDialog({ open: false, action: '', data: null })}
      >
        <DialogTitle>Confirm Action</DialogTitle>
        <DialogContent>
          <Typography>
            {confirmDialog.action === 'delete' && 'Are you sure you want to delete this conversation? This action cannot be undone.'}
            {confirmDialog.action === 'clearAll' && 'Are you sure you want to clear ALL memory data? This action cannot be undone and will delete all conversations, activities, and search history.'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog({ open: false, action: '', data: null })}>
            Cancel
          </Button>
          <Button
            color="error"
            onClick={async () => {
              if (confirmDialog.action === 'delete') {
                await handleDeleteConversation(confirmDialog.data);
              } else if (confirmDialog.action === 'clearAll') {
                await handleClearAllMemory();
              }
              setConfirmDialog({ open: false, action: '', data: null });
            }}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
};

export default MemoryDashboard; 