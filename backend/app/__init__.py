import os
from flask import Flask, request, make_response
from flask_jwt_extended import JWTManager
from flask_cors import CORS
import redis
import weaviate
import time
from datetime import timedelta

from app.config import Config
from app.utils.logger import setup_logger

# Initialize extensions
jwt = JWTManager()

# Initialize connections
redis_client = None
weaviate_client = None

def get_weaviate_client():
    """Get Weaviate client with lazy initialization and retry logic"""
    global weaviate_client
    if weaviate_client is None:
        try:
            from flask import current_app
            weaviate_client = weaviate.Client(
                url=current_app.config['WEAVIATE_URL'],
                additional_headers={
                    "X-OpenAI-Api-Key": current_app.config['OPENAI_API_KEY']
                }
            )
            current_app.logger.info("Weaviate client initialized successfully")
        except Exception as e:
            current_app.logger.warning(f"Failed to initialize Weaviate client: {str(e)}")
            # Return None if connection fails - services should handle this gracefully
            return None
    return weaviate_client

def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)
    
    # Configure JWT
    app.config['JWT_SECRET_KEY'] = app.config['SECRET_KEY']
    app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(days=7)
    app.config['JWT_TOKEN_LOCATION'] = ['headers']
    app.config['JWT_HEADER_NAME'] = 'Authorization'
    app.config['JWT_HEADER_TYPE'] = 'Bearer'
    app.config['JWT_ERROR_MESSAGE_KEY'] = 'error'
    
    # Initialize CORS with proper configuration
    CORS(app, 
         resources={
             r"/*": {
                 "origins": "*",  # Allow all origins for now, we'll validate in the headers
                 "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
                 "allow_headers": ["Content-Type", "Authorization", "Cache-Control", "X-Requested-With", "Accept", "Origin", "X-Force-Fast-Response", "X-No-Streaming"],
                 "supports_credentials": True,
                 "expose_headers": ["Content-Type", "Authorization", "Set-Cookie"],
                 "max_age": 3600,
                 "send_wildcard": False,
                 "vary_header": True,
                 "always_send": True
             }
         })
    
    # Add security headers
    @app.after_request
    def add_security_headers(response):
        # Get the origin from the request
        origin = request.headers.get('Origin')
        
        # Define allowed origins - prioritize localhost for development
        allowed_origins = [
            'http://localhost:3000',
            'http://localhost:3001',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:3001',
            'https://ragzy.onrender.com'
        ]
        
        # Set CORS headers for localhost development
        if origin and origin in allowed_origins:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, Accept, Origin, X-Requested-With, X-Force-Fast-Response, X-No-Streaming'
            response.headers['Access-Control-Allow-Credentials'] = 'true'
            response.headers['Access-Control-Max-Age'] = '86400'
        
        # Security headers (simplified for local development)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['X-XSS-Protection'] = '1; mode=block'
        
        return response
    
    # Handle OPTIONS requests
    @app.before_request
    def handle_preflight():
        if request.method == "OPTIONS":
            response = make_response()
            
            # Get the origin from the request
            origin = request.headers.get('Origin')
            
            # Define allowed origins
            allowed_origins = [
                'http://localhost:3000',
                'https://ragzy.onrender.com',
                'http://localhost:3001'
            ]
            
            # Check if origin is valid
            origin_allowed = False
            if origin:
                if origin in allowed_origins:
                    origin_allowed = True
                elif '.ngrok.io' in origin or '.ngrok-free.app' in origin:
                    origin_allowed = True
            
            # Set CORS headers
            if origin_allowed and origin:
                response.headers.add("Access-Control-Allow-Origin", origin)
            else:
                response.headers.add("Access-Control-Allow-Origin", "*")
                
            response.headers.add("Access-Control-Allow-Headers", "Content-Type, Authorization, Cache-Control, X-Requested-With, Accept, Origin, X-Force-Fast-Response, X-No-Streaming")
            response.headers.add("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
            response.headers.add("Access-Control-Allow-Credentials", "true")
            response.headers.add("Access-Control-Max-Age", "3600")
            response.headers.add("Vary", "Origin")
            
            # Don't add restrictive Cross-Origin policies for preflight
            return response
    
    # Initialize extensions with app
    jwt.init_app(app)
    
    # Setup logger
    setup_logger(app)
    
    # Initialize Redis with error handling
    global redis_client
    try:
        redis_client = redis.from_url(app.config['REDIS_URL'])
        # Test Redis connection
        redis_client.ping()
        app.logger.info("Redis client initialized successfully")
    except Exception as e:
        app.logger.warning(f"Failed to initialize Redis client: {str(e)}")
        redis_client = None
    
    # Don't initialize Weaviate here - use lazy loading instead
    app.logger.info("Weaviate client will be initialized on first use")
    
    # Register blueprints
    from app.routes.chat import chat_bp
    from app.routes.auth import auth_bp
    from app.routes.browser_tracking import browser_tracking_bp
    
    app.register_blueprint(chat_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(browser_tracking_bp)
    
    # Create logs directory if it doesn't exist
    os.makedirs(app.config['LOG_DIR'], exist_ok=True)
    
    app.logger.info("Application initialized successfully")
    
    return app
