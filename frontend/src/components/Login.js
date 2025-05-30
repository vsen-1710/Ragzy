import React, { useEffect, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Container,
  Fade,
  Slide,
  useTheme,
  useMediaQuery,
  IconButton,
  Tooltip,
  TextField,
  Divider,
  Link,
  InputAdornment
} from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import EmailIcon from '@mui/icons-material/Email';
import LockIcon from '@mui/icons-material/Lock';
import PersonIcon from '@mui/icons-material/Person';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { API_CONFIG } from '../config/api';
import { useAuth } from '../contexts/AuthContext';

const GOOGLE_CLIENT_ID = '277424078739-o7lt5017vnv653bnptfp0hqkcl68bbt3.apps.googleusercontent.com';

const Login = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [darkMode, setDarkMode] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const [isSignupMode, setIsSignupMode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    name: ''
  });
  const [formErrors, setFormErrors] = useState({});
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isTablet = useMediaQuery(theme.breakpoints.down('lg'));
  const { login } = useAuth();

  useEffect(() => {
    // Trigger content animation after component mounts
    const timer = setTimeout(() => setShowContent(true), 300);
    
    // Load Google Identity Services script
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = initializeGoogleSignIn;
    document.head.appendChild(script);

    return () => {
      clearTimeout(timer);
      const existingScript = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      if (existingScript) {
        document.head.removeChild(existingScript);
      }
    };
  }, [darkMode, isMobile, isTablet]);

  const initializeGoogleSignIn = () => {
    if (window.google) {
      try {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleCredentialResponse,
          auto_select: false,
          cancel_on_tap_outside: true,
          context: 'signin',
          ux_mode: 'popup',
          use_fedcm_for_prompt: false,  // Disable FedCM for better compatibility
          // Remove problematic origin configurations
          itp_support: true,
        });

        // Clear any existing button first
        const buttonContainer = document.getElementById('google-signin-button');
        if (buttonContainer) {
          buttonContainer.innerHTML = '';
        }

        // Render the sign-in button
        window.google.accounts.id.renderButton(
          document.getElementById('google-signin-button'),
          {
            theme: darkMode ? 'filled_black' : 'outline',
            size: 'large',
            width: isMobile ? 280 : isTablet ? 300 : 320,
            text: 'signin_with',
            shape: 'rectangular',
            logo_alignment: 'left',
            type: 'standard'
          }
        );
      } catch (error) {
        console.error('Error initializing Google Sign-In:', error);
        setError('Failed to initialize Google Sign-In. Please try refreshing the page.');
      }
    }
  };

  const handleCredentialResponse = async (response) => {
    setLoading(true);
    setError('');

    try {
      if (!response.credential) {
        throw new Error('No credential received from Google');
      }

      const result = await fetch(`${API_CONFIG.BASE_URL}/auth/google`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Origin': window.location.origin
        },
        credentials: 'include',
        mode: 'cors',
        body: JSON.stringify({
          credential: response.credential,
        }),
      });

      if (!result.ok) {
        const errorData = await result.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! status: ${result.status}`);
      }

      const data = await result.json();

      if (data.success && data.user && data.access_token) {
        await login(data.user, data.access_token);
        // Don't force a reload, let React Router handle navigation
        console.log('Login successful, user authenticated');
      } else {
        throw new Error(data.error || 'Authentication failed');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError(err.message || 'Network error. Please try again.');
      // Clear any stored invalid tokens
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
    } finally {
      setLoading(false);
    }
  };

  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
    // Re-initialize Google button with new theme
    setTimeout(initializeGoogleSignIn, 100);
  };

  const validateForm = () => {
    const errors = {};
    
    if (!formData.email) {
      errors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      errors.email = 'Email is invalid';
    }
    
    if (!formData.password) {
      errors.password = 'Password is required';
    } else if (formData.password.length < 6) {
      errors.password = 'Password must be at least 6 characters';
    }
    
    if (isSignupMode) {
      if (!formData.name) {
        errors.name = 'Name is required';
      }
      if (!formData.confirmPassword) {
        errors.confirmPassword = 'Please confirm your password';
      } else if (formData.password !== formData.confirmPassword) {
        errors.confirmPassword = 'Passwords do not match';
      }
    }
    
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleManualAuth = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const endpoint = isSignupMode ? '/auth/signup' : '/auth/login';
      const payload = isSignupMode 
        ? { email: formData.email, password: formData.password, name: formData.name }
        : { email: formData.email, password: formData.password };
      
      const result = await fetch(`${API_CONFIG.BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await result.json();

      if (data.success) {
        await login(data.user, data.access_token);
        // Force a page reload to ensure proper state update and navigation
        window.location.href = '/';
      } else {
        setError(data.error || `${isSignupMode ? 'Signup' : 'Login'} failed`);
      }
    } catch (err) {
      console.error('Auth error:', err);
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field) => (event) => {
    setFormData(prev => ({
      ...prev,
      [field]: event.target.value
    }));
    
    // Clear error for this field when user starts typing
    if (formErrors[field]) {
      setFormErrors(prev => ({
        ...prev,
        [field]: ''
      }));
    }
  };

  const toggleAuthMode = () => {
    setIsSignupMode(!isSignupMode);
    setFormData({ email: '', password: '', confirmPassword: '', name: '' });
    setFormErrors({});
    setError('');
  };

  const backgroundGradient = darkMode 
    ? 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)'
    : 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)';

  const cardBackground = darkMode ? '#1e1e1e' : '#ffffff';
  const textColor = darkMode ? '#ffffff' : '#333333';

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: backgroundGradient,
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          animation: 'float 20s ease-in-out infinite',
        },
        '@keyframes float': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
      }}
    >
      {/* Logo and Theme Toggle */}
      <Box
        sx={{
          position: 'absolute',
          top: { xs: 16, md: 24 },
          left: { xs: 16, md: 24 },
          right: { xs: 16, md: 24 },
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 10,
        }}
      >
        <Fade in={showContent} timeout={1000}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 2 } }}>
            <Box
              component="img"
              src="/logo512.png"
              alt="App Logo"
              sx={{
                width: { xs: 35, sm: 40, md: 50 },
                height: { xs: 35, sm: 40, md: 50 },
                borderRadius: '12px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                transition: 'transform 0.3s ease',
                '&:hover': {
                  transform: 'scale(1.1) rotate(5deg)',
                },
              }}
            />
            <Typography
              variant={isMobile ? "h6" : "h5"}
              sx={{
                fontWeight: 'bold',
                color: 'white',
                textShadow: '0 2px 4px rgba(0,0,0,0.3)',
                display: { xs: 'block', sm: 'block' },
                fontSize: { xs: '1.1rem', sm: '1.25rem', md: '1.5rem' },
              }}
            >
              Ragzy
            </Typography>
          </Box>
        </Fade>

        <Fade in={showContent} timeout={1200}>
          <Tooltip title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}>
            <IconButton
              onClick={toggleDarkMode}
              sx={{
                color: 'white',
                backgroundColor: 'rgba(255,255,255,0.1)',
                backdropFilter: 'blur(10px)',
                width: { xs: 40, md: 48 },
                height: { xs: 40, md: 48 },
                '&:hover': {
                  backgroundColor: 'rgba(255,255,255,0.2)',
                  transform: 'scale(1.1)',
                },
                transition: 'all 0.3s ease',
              }}
            >
              {darkMode ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Tooltip>
        </Fade>
      </Box>

      {/* Main Content */}
      <Container maxWidth="sm">
        <Box
          sx={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            py: { xs: 10, sm: 8, md: 4 },
            px: { xs: 2, sm: 3 },
          }}
        >
          <Slide direction="up" in={showContent} timeout={800}>
            <Paper
              elevation={24}
              sx={{
                p: { xs: 3, sm: 4, md: 5 },
                borderRadius: { xs: 3, md: 4 },
                textAlign: 'center',
                maxWidth: { xs: '100%', sm: 450 },
                width: '100%',
                backgroundColor: cardBackground,
                backdropFilter: 'blur(20px)',
                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.2)'}`,
                position: 'relative',
                overflow: 'hidden',
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: '4px',
                  background: 'linear-gradient(90deg, #667eea, #764ba2, #f093fb)',
                },
                transition: 'all 0.3s ease',
                '&:hover': {
                  transform: 'translateY(-5px)',
                  boxShadow: darkMode 
                    ? '0 20px 40px rgba(0,0,0,0.4)' 
                    : '0 20px 40px rgba(0,0,0,0.15)',
                },
              }}
            >
              <Fade in={showContent} timeout={1000}>
                <Box>
                  <Typography
                    variant={isMobile ? "h4" : "h3"}
                    component="h1"
                    gutterBottom
                    sx={{
                      fontWeight: 'bold',
                      color: textColor,
                      mb: 1.5,
                      background: darkMode 
                        ? 'linear-gradient(45deg, #667eea, #764ba2)' 
                        : 'linear-gradient(45deg, #667eea, #764ba2)',
                      backgroundClip: 'text',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      fontSize: { xs: '1.75rem', sm: '2.125rem', md: '3rem' },
                    }}
                  >
                    Welcome Back!
                  </Typography>
                  
                  <Typography
                    variant="body1"
                    sx={{ 
                      mb: 3, 
                      color: darkMode ? '#b0b0b0' : 'text.secondary',
                      fontSize: { xs: '0.9rem', sm: '0.95rem', md: '1.1rem' },
                      lineHeight: 1.6,
                      px: { xs: 0, sm: 1 },
                    }}
                  >
                    Sign in to continue your AI-powered conversations
                  </Typography>
                </Box>
              </Fade>

              {error && (
                <Fade in={!!error} timeout={500}>
                  <Alert 
                    severity="error" 
                    sx={{ 
                      mb: 2.5,
                      borderRadius: 2,
                      fontSize: { xs: '0.875rem', md: '1rem' },
                      '& .MuiAlert-icon': {
                        fontSize: '1.2rem',
                      },
                    }}
                  >
                    {error}
                  </Alert>
                </Fade>
              )}

              <Fade in={showContent} timeout={1200}>
                <Box sx={{ mb: 2.5 }}>
                  <div id="google-signin-button" style={{ 
                    display: 'flex', 
                    justifyContent: 'center',
                    marginBottom: '12px',
                  }}></div>
                </Box>
              </Fade>

              {/* Divider */}
              <Fade in={showContent} timeout={1400}>
                <Box sx={{ my: 3 }}>
                  <Divider sx={{ 
                    '&::before, &::after': { 
                      borderColor: darkMode ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.12)' 
                    } 
                  }}>
                    <Typography 
                      variant="body2" 
                      sx={{ 
                        color: darkMode ? '#888' : 'text.secondary',
                        px: 2,
                        fontWeight: 500,
                        fontSize: { xs: '0.75rem', md: '0.875rem' },
                      }}
                    >
                      OR
                    </Typography>
                  </Divider>
                </Box>
              </Fade>

              {/* Manual Login/Signup Form */}
              <Fade in={showContent} timeout={1600}>
                <Box component="form" onSubmit={handleManualAuth} sx={{ textAlign: 'left' }}>
                  {isSignupMode && (
                    <TextField
                      fullWidth
                      label="Full Name"
                      value={formData.name}
                      onChange={handleInputChange('name')}
                      error={!!formErrors.name}
                      helperText={formErrors.name}
                      sx={{ 
                        mb: 1.5,
                        '& .MuiInputBase-root': {
                          fontSize: { xs: '0.875rem', md: '1rem' },
                        },
                        '& .MuiInputLabel-root': {
                          fontSize: { xs: '0.875rem', md: '1rem' },
                        },
                      }}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <PersonIcon sx={{ 
                              color: darkMode ? '#667eea' : '#4285f4',
                              fontSize: { xs: '1.2rem', md: '1.5rem' },
                            }} />
                          </InputAdornment>
                        ),
                      }}
                    />
                  )}
                  
                  <TextField
                    fullWidth
                    label="Email Address"
                    type="email"
                    value={formData.email}
                    onChange={handleInputChange('email')}
                    error={!!formErrors.email}
                    helperText={formErrors.email}
                    sx={{ 
                      mb: 1.5,
                      '& .MuiInputBase-root': {
                        fontSize: { xs: '0.875rem', md: '1rem' },
                      },
                      '& .MuiInputLabel-root': {
                        fontSize: { xs: '0.875rem', md: '1rem' },
                      },
                    }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <EmailIcon sx={{ 
                            color: darkMode ? '#667eea' : '#4285f4',
                            fontSize: { xs: '1.2rem', md: '1.5rem' },
                          }} />
                        </InputAdornment>
                      ),
                    }}
                  />
                  
                  <TextField
                    fullWidth
                    label="Password"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={handleInputChange('password')}
                    error={!!formErrors.password}
                    helperText={formErrors.password}
                    sx={{ 
                      mb: isSignupMode ? 1.5 : 2.5,
                      '& .MuiInputBase-root': {
                        fontSize: { xs: '0.875rem', md: '1rem' },
                      },
                      '& .MuiInputLabel-root': {
                        fontSize: { xs: '0.875rem', md: '1rem' },
                      },
                    }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <LockIcon sx={{ 
                            color: darkMode ? '#667eea' : '#4285f4',
                            fontSize: { xs: '1.2rem', md: '1.5rem' },
                          }} />
                        </InputAdornment>
                      ),
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            onClick={() => setShowPassword(!showPassword)}
                            edge="end"
                            sx={{ 
                              color: darkMode ? '#667eea' : '#4285f4',
                              padding: { xs: '6px', md: '8px' },
                            }}
                          >
                            {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                  />
                  
                  {isSignupMode && (
                    <TextField
                      fullWidth
                      label="Confirm Password"
                      type={showPassword ? 'text' : 'password'}
                      value={formData.confirmPassword}
                      onChange={handleInputChange('confirmPassword')}
                      error={!!formErrors.confirmPassword}
                      helperText={formErrors.confirmPassword}
                      sx={{ 
                        mb: 2.5,
                        '& .MuiInputBase-root': {
                          fontSize: { xs: '0.875rem', md: '1rem' },
                        },
                        '& .MuiInputLabel-root': {
                          fontSize: { xs: '0.875rem', md: '1rem' },
                        },
                      }}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <LockIcon sx={{ 
                              color: darkMode ? '#667eea' : '#4285f4',
                              fontSize: { xs: '1.2rem', md: '1.5rem' },
                            }} />
                          </InputAdornment>
                        ),
                      }}
                    />
                  )}
                  
                  <Button
                    type="submit"
                    fullWidth
                    variant="contained"
                    disabled={loading}
                    sx={{
                      py: { xs: 1.2, md: 1.5 },
                      borderRadius: 3,
                      background: darkMode 
                        ? 'linear-gradient(45deg, #667eea, #764ba2)' 
                        : 'linear-gradient(45deg, #4285f4, #667eea)',
                      fontSize: { xs: '0.9rem', md: '1rem' },
                      fontWeight: 600,
                      textTransform: 'none',
                      boxShadow: '0 4px 15px rgba(102, 126, 234, 0.4)',
                      transition: 'all 0.3s ease',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                        boxShadow: '0 6px 20px rgba(102, 126, 234, 0.6)',
                      },
                      '&:disabled': {
                        opacity: 0.6,
                      },
                    }}
                  >
                    {loading ? (
                      <CircularProgress size={24} color="inherit" />
                    ) : (
                      isSignupMode ? 'Create Account' : 'Sign In'
                    )}
                  </Button>
                </Box>
              </Fade>

              {/* Toggle Auth Mode */}
              <Fade in={showContent} timeout={1800}>
                <Box sx={{ mt: 2.5, textAlign: 'center' }}>
                  <Typography
                    variant="body2"
                    sx={{ 
                      color: darkMode ? '#b0b0b0' : 'text.secondary',
                      fontSize: { xs: '0.8rem', md: '0.875rem' },
                    }}
                  >
                    {isSignupMode ? 'Already have an account?' : "Don't have an account?"}{' '}
                    <Link
                      component="button"
                      type="button"
                      onClick={toggleAuthMode}
                      sx={{
                        color: darkMode ? '#667eea' : '#4285f4',
                        fontWeight: 600,
                        textDecoration: 'none',
                        cursor: 'pointer',
                        fontSize: { xs: '0.8rem', md: '0.875rem' },
                        '&:hover': {
                          textDecoration: 'underline',
                        },
                      }}
                    >
                      {isSignupMode ? 'Sign In' : 'Sign Up'}
                    </Link>
                  </Typography>
                </Box>
              </Fade>

              <Fade in={showContent} timeout={2000}>
                <Typography
                  variant="caption"
                  display="block"
                  sx={{ 
                    mt: 3, 
                    color: darkMode ? '#888' : 'text.secondary',
                    fontSize: { xs: '0.75rem', md: '0.85rem' },
                    lineHeight: 1.4,
                    px: { xs: 0, sm: 1 },
                  }}
                >
                  By signing in, you agree to our{' '}
                  <Box component="span" sx={{ color: darkMode ? '#667eea' : '#4285f4', cursor: 'pointer' }}>
                    Terms of Service
                  </Box>
                  {' '}and{' '}
                  <Box component="span" sx={{ color: darkMode ? '#667eea' : '#4285f4', cursor: 'pointer' }}>
                    Privacy Policy
                  </Box>
                </Typography>
              </Fade>
            </Paper>
          </Slide>
        </Box>
      </Container>

      {/* Floating Elements - Hidden on mobile for better performance */}
      <Box
        sx={{
          position: 'absolute',
          top: '20%',
          right: '10%',
          width: { md: 100, lg: 120 },
          height: { md: 100, lg: 120 },
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.1)',
          animation: 'float 15s ease-in-out infinite',
          animationDelay: '2s',
          display: { xs: 'none', md: 'block' },
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          bottom: '30%',
          left: '5%',
          width: { md: 60, lg: 80 },
          height: { md: 60, lg: 80 },
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.08)',
          animation: 'float 12s ease-in-out infinite',
          animationDelay: '4s',
          display: { xs: 'none', md: 'block' },
        }}
      />
    </Box>
  );
};

export default Login; 