import React, { createContext, useContext, useState, useEffect } from 'react';
import { API_CONFIG } from '../config/api';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user is already logged in
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const storedToken = localStorage.getItem('access_token');
      const storedUser = localStorage.getItem('user');

      if (!storedToken || !storedUser) {
        clearAuthData();
        setLoading(false);
        return;
      }

      // Ensure token is properly formatted
      const formattedToken = storedToken.trim();
      if (!formattedToken) {
        console.error('Empty token found');
        clearAuthData();
        setLoading(false);
        return;
      }

      // Try to parse stored user data first
      try {
        const userData = JSON.parse(storedUser);
        if (userData && userData.id) {
          // If we have valid stored user data, set it temporarily
          setUser(userData);
          setToken(formattedToken);
        }
      } catch (e) {
        console.error('Invalid stored user data:', e);
        clearAuthData();
        setLoading(false);
        return;
      }

      // Verify token with backend
      const response = await fetch(`${API_CONFIG.BASE_URL}/auth/verify`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${formattedToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Origin': window.location.origin
        },
        credentials: 'include',
        mode: 'cors'
      });

      const data = await response.json();

      if (response.ok && data.success && data.user) {
        // Ensure user ID is a string
        const userData = {
          ...data.user,
          id: String(data.user.id)
        };
        setUser(userData);
        setToken(formattedToken);
        localStorage.setItem('user', JSON.stringify(userData));
      } else {
        console.error('Token verification failed:', {
          status: response.status,
          error: data.error || 'Unknown error'
        });
        clearAuthData();
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      clearAuthData();
    } finally {
      setLoading(false);
    }
  };

  const clearAuthData = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    setUser(null);
    setToken(null);
  };

  const login = async (userData, accessToken) => {
    try {
      if (!userData || !accessToken) {
        throw new Error('Invalid login data');
      }
      // Ensure token is properly formatted and user ID is a string
      const formattedToken = accessToken.trim();
      const formattedUserData = {
        ...userData,
        id: String(userData.id)
      };
      setUser(formattedUserData);
      setToken(formattedToken);
      localStorage.setItem('access_token', formattedToken);
      localStorage.setItem('user', JSON.stringify(formattedUserData));
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  const logout = () => {
    clearAuthData();
  };

  const getAuthHeaders = () => {
    if (!token) {
      return {};
    }
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  };

  const value = {
    user,
    token,
    loading,
    login,
    logout,
    getAuthHeaders
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}; 