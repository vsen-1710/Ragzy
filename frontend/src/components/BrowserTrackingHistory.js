import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip,
  IconButton,
  Tooltip,
  Button,
  Grid,
  Divider,
  Collapse,
  Paper,
  LinearProgress,
  Alert,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Avatar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Tab,
  CircularProgress,
  useTheme,
  useMediaQuery
} from '@mui/material';
import {
  Timeline as TimelineIcon,
  Analytics as AnalyticsIcon,
  Mouse as MouseIcon,
  Visibility as VisibilityIcon,
  Navigation as NavigationIcon,
  Keyboard as KeyboardIcon,
  TouchApp as TouchIcon,
  AccessTime as TimeIcon,
  TrendingUp as TrendingUpIcon,
  DataUsage as DataUsageIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Delete as DeleteIcon,
  FileDownload as DownloadIcon,
  Close as CloseIcon,
  QueryStats as StatsIcon,
  ViewList as ViewListIcon,
  Assessment as ChartIcon
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';

const BrowserTrackingHistory = ({ open, onClose, browserTracker }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { user } = useAuth();
  
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [trackingData, setTrackingData] = useState({
    activities: [],
    summary: null,
    analytics: null
  });
  const [timeRange, setTimeRange] = useState(24); // hours
  const [expandedSections, setExpandedSections] = useState({
    overview: true,
    activities: false,
    analytics: false
  });

  // Activity type icons and colors
  const getActivityIcon = (type) => {
    const iconMap = {
      click: <MouseIcon />,
      scroll: <TouchIcon />,
      navigation: <NavigationIcon />,
      key_navigation: <KeyboardIcon />,
      visibility_change: <VisibilityIcon />,
      window_focus: <VisibilityIcon />,
      tracking_started: <TimelineIcon />
    };
    return iconMap[type] || <TimelineIcon />;
  };

  const getActivityColor = (type) => {
    const colorMap = {
      click: '#2196f3',
      scroll: '#4caf50',
      navigation: '#ff9800',
      key_navigation: '#9c27b0',
      visibility_change: '#795548',
      window_focus: '#607d8b',
      tracking_started: '#e91e63'
    };
    return colorMap[type] || '#757575';
  };

  // API helper functions
  const getAuthHeaders = () => {
    // Try different token sources to match the app's auth system
    const tokenSources = [
      () => localStorage.getItem('access_token'),
      () => localStorage.getItem('authToken'),
      () => localStorage.getItem('token'),
      () => sessionStorage.getItem('access_token')
    ];
    
    for (const getToken of tokenSources) {
      try {
        const token = getToken();
        if (token) {
          return { 'Authorization': `Bearer ${token}` };
        }
      } catch (error) {
        continue;
      }
    }
    
    console.warn('🚫 No auth token found in localStorage for BrowserTrackingHistory');
    return {};
  };

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

  // Fetch tracking data
  const fetchTrackingData = useCallback(async () => {
    if (!user) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // First, try to get data from local browserTracker if available
      if (browserTracker && browserTracker.isTrackingEnabled()) {
        const localActivities = browserTracker.getStoredActivities();
        const localStats = browserTracker.getTrackingStats();
        
        // Convert local activities to backend format
        const formattedActivities = localActivities.slice(0, 100).map(activity => ({
          id: activity.id,
          activity_type: activity.type,
          activity_data: activity.data,
          timestamp: activity.timestamp,
          session_id: activity.sessionId,
          url: activity.data?.url || activity.data?.newUrl || window.location.href,
          page_title: activity.data?.pageTitle || activity.data?.newTitle || document.title,
          engagement_score: Math.random() * 10 // Simplified for now
        }));
        
        // Generate local summary
        const localSummary = {
          total_activities: localActivities.length,
          activity_types: localActivities.reduce((acc, activity) => {
            acc[activity.type] = (acc[activity.type] || 0) + 1;
            return acc;
          }, {}),
          engagement_score: Math.round(localStats.totalActivities / 10),
          active_sessions: 1,
          recent_urls: [...new Set(localActivities.map(a => a.data?.url || a.data?.newUrl).filter(Boolean))].slice(0, 5),
          most_active_type: Object.entries(localActivities.reduce((acc, activity) => {
            acc[activity.type] = (acc[activity.type] || 0) + 1;
            return acc;
          }, {})).sort(([,a], [,b]) => b - a)[0]?.[0] || 'click'
        };
        
        // Generate local analytics
        const localAnalytics = {
          overall_stats: {
            stats: {
              activities_last_24h: localActivities.filter(a => 
                new Date(a.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000)
              ).length,
              activities_last_7d: localActivities.filter(a => 
                new Date(a.timestamp) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
              ).length
            }
          },
          last_24_hours: { engagement_score: Math.round(localStats.recentActivities / 5) },
          last_7_days: { engagement_score: Math.round(localStats.totalActivities / 20) }
        };
        
        setTrackingData({
          activities: formattedActivities,
          summary: localSummary,
          analytics: localAnalytics
        });
        
        setLoading(false);
        return;
      }
      
      // Try backend APIs
      try {
        // Fetch activities
        const activitiesResponse = await fetch(
          `${API_URL}/api/browser-tracking/activities?hours_back=${timeRange}&limit=100`,
          { headers: getAuthHeaders() }
        );
        
        // Fetch summary
        const summaryResponse = await fetch(
          `${API_URL}/api/browser-tracking/summary?hours_back=${timeRange}`,
          { headers: getAuthHeaders() }
        );
        
        // Fetch analytics
        const analyticsResponse = await fetch(
          `${API_URL}/api/browser-tracking/analytics`,
          { headers: getAuthHeaders() }
        );

        if (activitiesResponse.ok && summaryResponse.ok && analyticsResponse.ok) {
          const activitiesData = await activitiesResponse.json();
          const summaryData = await summaryResponse.json();
          const analyticsData = await analyticsResponse.json();

          setTrackingData({
            activities: activitiesData.activities || [],
            summary: summaryData.summary || null,
            analytics: analyticsData.analytics || null
          });
        } else {
          throw new Error('Backend APIs not available');
        }
      } catch (backendError) {
        console.warn('Backend APIs not available, using fallback data:', backendError);
        
        // Provide fallback empty data
        setTrackingData({
          activities: [],
          summary: {
            total_activities: 0,
            activity_types: {},
            engagement_score: 0,
            active_sessions: 0,
            recent_urls: [],
            most_active_type: null
          },
          analytics: {
            overall_stats: { stats: { activities_last_24h: 0, activities_last_7d: 0 } },
            last_24_hours: { engagement_score: 0 },
            last_7_days: { engagement_score: 0 }
          }
        });
      }
      
    } catch (err) {
      console.error('Error fetching tracking data:', err);
      setError('Unable to load tracking data. Please ensure tracking is enabled or try again later.');
    } finally {
      setLoading(false);
    }
  }, [user, timeRange, API_URL, browserTracker]);

  // Load data when component mounts or dependencies change
  useEffect(() => {
    if (open && user) {
      fetchTrackingData();
    }
  }, [open, user, fetchTrackingData]);

  // Clear tracking data
  const handleClearData = async () => {
    if (!user) return;
    
    try {
      const response = await fetch(`${API_URL}/api/browser-tracking/clear`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      
      if (response.ok) {
        await fetchTrackingData(); // Refresh data
        if (browserTracker) {
          browserTracker.clearActivities();
        }
      } else {
        throw new Error('Failed to clear data');
      }
    } catch (err) {
      console.error('Error clearing data:', err);
      setError('Failed to clear tracking data. Please try again.');
    }
  };

  // Export data (simplified JSON download)
  const handleExportData = () => {
    const dataToExport = {
      export_timestamp: new Date().toISOString(),
      time_range_hours: timeRange,
      activities: trackingData.activities,
      summary: trackingData.summary
    };
    
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `browser-tracking-data-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Format timestamp
  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleString();
  };

  // Format duration
  const formatDuration = (minutes) => {
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
  };

  // Render overview section
  const renderOverview = () => {
    const { summary } = trackingData;
    if (!summary) return null;

    return (
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <StatsIcon sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6">Activity Overview</Typography>
            <Chip 
              label={`Last ${timeRange}h`} 
              size="small" 
              sx={{ ml: 'auto' }}
              color="primary"
            />
          </Box>

          <Grid container spacing={2}>
            <Grid item xs={6} sm={3}>
              <Paper sx={{ p: 2, textAlign: 'center', bgcolor: 'primary.50' }}>
                <Typography variant="h4" color="primary.main" fontWeight="bold">
                  {summary.total_activities || 0}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Total Activities
                </Typography>
              </Paper>
            </Grid>
            
            <Grid item xs={6} sm={3}>
              <Paper sx={{ p: 2, textAlign: 'center', bgcolor: 'success.50' }}>
                <Typography variant="h4" color="success.main" fontWeight="bold">
                  {summary.active_sessions || 0}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Active Sessions
                </Typography>
              </Paper>
            </Grid>
            
            <Grid item xs={6} sm={3}>
              <Paper sx={{ p: 2, textAlign: 'center', bgcolor: 'warning.50' }}>
                <Typography variant="h4" color="warning.main" fontWeight="bold">
                  {summary.engagement_score || 0}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Engagement Score
                </Typography>
              </Paper>
            </Grid>
            
            <Grid item xs={6} sm={3}>
              <Paper sx={{ p: 2, textAlign: 'center', bgcolor: 'info.50' }}>
                <Typography variant="h4" color="info.main" fontWeight="bold">
                  {summary.recent_urls?.length || 0}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Unique URLs
                </Typography>
              </Paper>
            </Grid>
          </Grid>

          {summary.activity_types && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle2" gutterBottom>
                Activity Breakdown
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {Object.entries(summary.activity_types).map(([type, count]) => (
                  <Chip
                    key={type}
                    icon={getActivityIcon(type)}
                    label={`${type.replace('_', ' ')}: ${count}`}
                    size="small"
                    sx={{ 
                      bgcolor: getActivityColor(type) + '20',
                      color: getActivityColor(type),
                      border: `1px solid ${getActivityColor(type)}40`
                    }}
                  />
                ))}
              </Box>
            </Box>
          )}

          {summary.most_active_type && (
            <Alert severity="info" sx={{ mt: 2 }}>
              <Typography variant="body2">
                <strong>Most Active:</strong> {summary.most_active_type.replace('_', ' ')} 
                ({summary.activity_types[summary.most_active_type]} activities)
              </Typography>
            </Alert>
          )}
        </CardContent>
      </Card>
    );
  };

  // Render activities list
  const renderActivities = () => {
    const { activities } = trackingData;
    
    if (!activities || activities.length === 0) {
      return (
        <Card sx={{ mb: 2 }}>
          <CardContent sx={{ textAlign: 'center', py: 4 }}>
            <ViewListIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No Activities Found
            </Typography>
            <Typography variant="body2" color="text.secondary">
              No browser activities recorded in the selected time range.
            </Typography>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <ViewListIcon sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6">Recent Activities</Typography>
            <Chip 
              label={`${activities.length} activities`} 
              size="small" 
              sx={{ ml: 'auto' }}
            />
          </Box>

          <List sx={{ maxHeight: 400, overflow: 'auto' }}>
            {activities.map((activity, index) => (
              <ListItem key={index} divider={index < activities.length - 1}>
                <ListItemIcon>
                  <Avatar 
                    sx={{ 
                      bgcolor: getActivityColor(activity.activity_type) + '20',
                      color: getActivityColor(activity.activity_type),
                      width: 32,
                      height: 32
                    }}
                  >
                    {getActivityIcon(activity.activity_type)}
                  </Avatar>
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" fontWeight="medium">
                        {activity.activity_type.replace('_', ' ').toUpperCase()}
                      </Typography>
                      {activity.engagement_score > 0 && (
                        <Chip 
                          label={`${activity.engagement_score}★`}
                          size="small"
                          color="warning"
                          sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                      )}
                    </Box>
                  }
                  secondary={
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        {formatTimestamp(activity.timestamp)}
                      </Typography>
                      {activity.url && (
                        <Typography variant="caption" display="block" color="text.secondary">
                          {activity.url.length > 50 ? 
                            activity.url.substring(0, 50) + '...' : 
                            activity.url
                          }
                        </Typography>
                      )}
                      {activity.page_title && (
                        <Typography variant="caption" display="block" color="primary.main">
                          📄 {activity.page_title}
                        </Typography>
                      )}
                    </Box>
                  }
                />
              </ListItem>
            ))}
          </List>
        </CardContent>
      </Card>
    );
  };

  // Render analytics section
  const renderAnalytics = () => {
    const { analytics } = trackingData;
    if (!analytics) return null;

    return (
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <ChartIcon sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6">Detailed Analytics</Typography>
          </Box>

          {analytics.overall_stats && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" gutterBottom>
                Overall Statistics
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Paper sx={{ p: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                      Activities (24h)
                    </Typography>
                    <Typography variant="h5" color="primary.main">
                      {analytics.overall_stats.stats?.activities_last_24h || 0}
                    </Typography>
                  </Paper>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Paper sx={{ p: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                      Activities (7d)
                    </Typography>
                    <Typography variant="h5" color="success.main">
                      {analytics.overall_stats.stats?.activities_last_7d || 0}
                    </Typography>
                  </Paper>
                </Grid>
              </Grid>
            </Box>
          )}

          {analytics.last_24_hours && analytics.last_7_days && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Trend Comparison
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Paper sx={{ p: 2, flex: 1, minWidth: 200 }}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    24 Hour Engagement
                  </Typography>
                  <LinearProgress 
                    variant="determinate" 
                    value={Math.min((analytics.last_24_hours.engagement_score || 0) * 10, 100)} 
                    sx={{ mb: 1 }}
                  />
                  <Typography variant="caption">
                    Score: {analytics.last_24_hours.engagement_score || 0}/10
                  </Typography>
                </Paper>
                
                <Paper sx={{ p: 2, flex: 1, minWidth: 200 }}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    7 Day Average
                  </Typography>
                  <LinearProgress 
                    variant="determinate" 
                    value={Math.min((analytics.last_7_days.engagement_score || 0) * 10, 100)} 
                    sx={{ mb: 1 }}
                  />
                  <Typography variant="caption">
                    Score: {analytics.last_7_days.engagement_score || 0}/10
                  </Typography>
                </Paper>
              </Box>
            </Box>
          )}
        </CardContent>
      </Card>
    );
  };

  // Main render
  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      maxWidth="lg" 
      fullWidth
      fullScreen={isMobile}
      PaperProps={{
        sx: {
          minHeight: isMobile ? '100vh' : '80vh',
          maxHeight: isMobile ? '100vh' : '90vh'
        }
      }}
    >
      <DialogTitle sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        pb: 1
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TimelineIcon color="primary" />
          <Typography variant="h6">Browser Tracking History</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Refresh data">
            <IconButton onClick={fetchTrackingData} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Export data">
            <IconButton onClick={handleExportData}>
              <DownloadIcon />
            </IconButton>
          </Tooltip>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        {/* Time Range Selector */}
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Time Range:
            </Typography>
            {[1, 6, 24, 168].map((hours) => (
              <Button
                key={hours}
                size="small"
                variant={timeRange === hours ? 'contained' : 'outlined'}
                onClick={() => setTimeRange(hours)}
                sx={{ minWidth: 'auto' }}
              >
                {hours === 1 ? '1h' : hours === 6 ? '6h' : hours === 24 ? '24h' : '7d'}
              </Button>
            ))}
          </Box>
        </Box>

        {/* Tabs */}
        <Tabs 
          value={activeTab} 
          onChange={(e, newValue) => setActiveTab(newValue)}
          sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
        >
          <Tab label="Overview" />
          <Tab label="Activities" />
          <Tab label="Analytics" />
        </Tabs>

        {/* Content */}
        <Box sx={{ p: 2, overflow: 'auto', height: 'calc(100% - 120px)' }}>
          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          )}

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {!loading && !error && (
            <>
              {activeTab === 0 && renderOverview()}
              {activeTab === 1 && renderActivities()}
              {activeTab === 2 && renderAnalytics()}
            </>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
        <Button 
          onClick={handleClearData} 
          color="error" 
          startIcon={<DeleteIcon />}
          disabled={loading}
        >
          Clear All Data
        </Button>
        <Button onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BrowserTrackingHistory; 