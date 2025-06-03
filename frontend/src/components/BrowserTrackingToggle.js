import React, { useState, useEffect } from 'react';
import {
  Box,
  Switch,
  Typography,
  Chip,
  IconButton,
  Tooltip,
  Card,
  CardContent,
  Collapse,
  Button,
  Alert,
  AlertTitle,
  Divider
} from '@mui/material';
import {
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Info as InfoIcon,
  Delete as DeleteIcon,
  Assessment as AssessmentIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  History as HistoryIcon,
  Timeline as TimelineIcon
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import BrowserTrackingHistory from './BrowserTrackingHistory';

const BrowserTrackingToggle = ({ browserTracker, onTrackingChange }) => {
  const { user } = useAuth();
  const [isEnabled, setIsEnabled] = useState(false);
  const [trackingStats, setTrackingStats] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Update state when tracker changes
  useEffect(() => {
    if (browserTracker) {
      const enabled = browserTracker.isTrackingEnabled();
      setIsEnabled(enabled);
      updateStats();
    }
  }, [browserTracker]);

  // Update stats periodically when tracking is enabled
  useEffect(() => {
    let interval;
    if (isEnabled && browserTracker) {
      interval = setInterval(updateStats, 10000); // Update every 10 seconds
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isEnabled, browserTracker]);

  const updateStats = () => {
    if (browserTracker) {
      const stats = browserTracker.getTrackingStats();
      setTrackingStats(stats);
    }
  };

  const handleToggleTracking = async () => {
    if (!browserTracker) return;

    const newState = !isEnabled;
    
    if (newState) {
      // Turning on - enable immediately
      browserTracker.enableTracking();
      setIsEnabled(true);
      updateStats();
      
      // Notify parent component
      if (onTrackingChange) {
        onTrackingChange(true);
      }
    } else {
      // Turning off - show confirmation
      setShowConfirm(true);
    }
  };

  const confirmDisableTracking = () => {
    if (browserTracker) {
      browserTracker.disableTracking();
      setIsEnabled(false);
      setTrackingStats(null);
      setShowConfirm(false);
      
      // Notify parent component
      if (onTrackingChange) {
        onTrackingChange(false);
      }
    }
  };

  const clearTrackingData = () => {
    if (browserTracker) {
      browserTracker.clearActivities();
      updateStats();
    }
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleString();
  };

  const getEngagementColor = (score) => {
    if (score >= 8) return '#10b981'; // Green
    if (score >= 6) return '#f59e0b'; // Yellow
    if (score >= 4) return '#f97316'; // Orange
    return '#ef4444'; // Red
  };

  const renderTrackingInfo = () => (
    <Box sx={{ mt: 2 }}>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        🔍 <strong>Browser tracking</strong> helps me provide more relevant responses by understanding your browsing context.
      </Typography>
      
      <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <Chip 
          label="✅ Privacy-first" 
          size="small" 
          variant="outlined" 
          color="success"
        />
        <Chip 
          label="📱 Local storage only" 
          size="small" 
          variant="outlined" 
          color="info"
        />
        <Chip 
          label="🎯 Better responses" 
          size="small" 
          variant="outlined" 
          color="primary"
        />
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        We track page visits, clicks, and navigation patterns to understand what you're working on. 
        No personal data, passwords, or sensitive information is collected.
      </Typography>
    </Box>
  );

  const renderTrackingStats = () => {
    if (!trackingStats || !isEnabled) return null;

    return (
      <Collapse in={showDetails}>
        <Divider sx={{ my: 2 }} />
        <Box>
          <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AssessmentIcon fontSize="small" />
            Tracking Statistics
          </Typography>
          
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 2, mt: 1 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">Total Activities</Typography>
              <Typography variant="h6" color="primary">
                {trackingStats.totalActivities}
              </Typography>
            </Box>
            
            <Box>
              <Typography variant="caption" color="text.secondary">Recent (1h)</Typography>
              <Typography variant="h6" color="warning.main">
                {trackingStats.recentActivities}
              </Typography>
            </Box>
            
            <Box>
              <Typography variant="caption" color="text.secondary">Storage Used</Typography>
              <Typography variant="h6" color="info.main">
                {formatBytes(trackingStats.storageSize)}
              </Typography>
            </Box>
          </Box>

          {trackingStats.newestActivity && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Last activity: {formatTimestamp(trackingStats.newestActivity)}
              </Typography>
            </Box>
          )}

          <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<HistoryIcon />}
              onClick={() => setShowHistory(true)}
              sx={{ flex: 1, minWidth: 'fit-content' }}
            >
              View History
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={clearTrackingData}
            >
              Clear Data
            </Button>
          </Box>
        </Box>
      </Collapse>
    );
  };

  if (!user) {
    return null; // Don't show if not logged in
  }

  return (
    <>
      <Card sx={{ mb: 2, borderRadius: 2 }}>
        <CardContent>
          {/* Confirmation Dialog */}
          {showConfirm && (
            <Alert 
              severity="warning" 
              sx={{ mb: 2 }}
              action={
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button 
                    size="small" 
                    onClick={() => setShowConfirm(false)}
                  >
                    Cancel
                  </Button>
                  <Button 
                    size="small" 
                    variant="contained" 
                    color="warning"
                    onClick={confirmDisableTracking}
                  >
                    Disable
                  </Button>
                </Box>
              }
            >
              <AlertTitle>Disable Browser Tracking?</AlertTitle>
              This will stop tracking your browser activity and may result in less contextual responses.
            </Alert>
          )}

          {/* Main Toggle */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {isEnabled ? (
                  <VisibilityIcon color="primary" />
                ) : (
                  <VisibilityOffIcon color="disabled" />
                )}
                <Box>
                  <Typography variant="subtitle1" fontWeight="medium">
                    Browser Tracking
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {isEnabled ? 'Active - Providing context for better responses' : 'Disabled - Limited context available'}
                  </Typography>
                </Box>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip
                label={isEnabled ? 'ON' : 'OFF'}
                color={isEnabled ? 'success' : 'default'}
                size="small"
                sx={{ fontWeight: 'bold', minWidth: 45 }}
              />
              <Switch
                checked={isEnabled}
                onChange={handleToggleTracking}
                color="primary"
              />
              {isEnabled && (
                <>
                  <Tooltip title="View detailed history">
                    <IconButton 
                      size="small" 
                      onClick={() => setShowHistory(true)}
                      sx={{ color: 'primary.main' }}
                    >
                      <TimelineIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={showDetails ? 'Hide details' : 'Show details'}>
                    <IconButton 
                      size="small" 
                      onClick={() => setShowDetails(!showDetails)}
                    >
                      {showDetails ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    </IconButton>
                  </Tooltip>
                </>
              )}
            </Box>
          </Box>

          {/* Info when disabled */}
          {!isEnabled && renderTrackingInfo()}

          {/* Stats when enabled */}
          {isEnabled && renderTrackingStats()}

          {/* Current status indicator */}
          {isEnabled && trackingStats && (
            <Box sx={{ mt: 2, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box 
                  component="span" 
                  sx={{ 
                    width: 8, 
                    height: 8, 
                    borderRadius: '50%', 
                    bgcolor: trackingStats.isTracking ? '#10b981' : '#ef4444' 
                  }} 
                />
                {trackingStats.isTracking ? 'Currently tracking' : 'Tracking paused'}
                {trackingStats.recentActivities > 0 && (
                  <Chip 
                    label={`${trackingStats.recentActivities} recent activities`}
                    size="small"
                    sx={{ ml: 1, height: 18, fontSize: '0.65rem' }}
                  />
                )}
              </Typography>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Browser Tracking History Dialog */}
      <BrowserTrackingHistory 
        open={showHistory}
        onClose={() => setShowHistory(false)}
        browserTracker={browserTracker}
      />
    </>
  );
};

export default BrowserTrackingToggle; 