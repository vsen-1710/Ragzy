// API Configuration
export const API_CONFIG = {
  BASE_URL: process.env.REACT_APP_API_URL || 'http://localhost:5000',
  TIMEOUT: 10000, // 10 seconds
  GOOGLE_CLIENT_ID: process.env.REACT_APP_GOOGLE_CLIENT_ID || '277424078739-o7lt5017vnv653bnptfp0hqkcl68bbt3.apps.googleusercontent.com'
};

// Ensure no trailing slash
if (API_CONFIG.BASE_URL.endsWith('/')) {
  API_CONFIG.BASE_URL = API_CONFIG.BASE_URL.slice(0, -1);
}

console.log('API Configuration:', { 
  BASE_URL: API_CONFIG.BASE_URL, 
  GOOGLE_CLIENT_ID: API_CONFIG.GOOGLE_CLIENT_ID.substring(0, 20) + '...' 
});
 
export default API_CONFIG; 