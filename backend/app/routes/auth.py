from flask import Blueprint, request, jsonify, current_app, make_response
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity, get_jwt
from google.oauth2 import id_token
from google.auth.transport import requests
import json
import os
import uuid
import hashlib
import traceback
import re
from datetime import timedelta
from ..models.user import UserModel

# Change the URL prefix to match the frontend request
auth_bp = Blueprint('auth', __name__, url_prefix='/auth')

# Constants
ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'https://ragzy.onrender.com',
    'http://localhost:3001'
]

CORS_HEADERS = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cache-Control, X-Requested-With, Accept, Origin, X-Force-Fast-Response, X-No-Streaming',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '3600',
    'Vary': 'Origin'
}

JWT_EXPIRY_DAYS = 7
COOKIE_MAX_AGE = 7 * 24 * 60 * 60  # 7 days in seconds

# Google OAuth namespace for UUID generation
GOOGLE_UUID_NAMESPACE = uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')

def get_cors_origin():
    """Get appropriate CORS origin based on request"""
    origin = request.headers.get('Origin')
    
    if not origin:
        return '*'
    
    # Check if origin is in allowed list
    if origin in ALLOWED_ORIGINS:
        return origin
    
    # Allow ngrok origins for development
    if '.ngrok.io' in origin or '.ngrok-free.app' in origin:
        return origin
    
    return '*'  # Be more permissive

def add_cors_headers(response):
    """Add CORS headers to response"""
    cors_origin = get_cors_origin()
    response.headers.add("Access-Control-Allow-Origin", cors_origin)
    
    # Add all CORS headers
    for header, value in CORS_HEADERS.items():
        response.headers.add(header, value)
    
    return response

def create_error_response(error_message, status_code=500):
    """Create standardized error response with CORS headers"""
    response = make_response(
        jsonify({'success': False, 'error': error_message}), 
        status_code
    )
    response.headers['Content-Type'] = 'application/json'
    return add_cors_headers(response)

def validate_email(email):
    """Validate email format"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def validate_password(password):
    """Validate password strength"""
    if len(password) < 6:
        return False, "Password must be at least 6 characters long"
    if len(password) > 128:
        return False, "Password must be less than 128 characters"
    return True, ""

def google_id_to_uuid(google_id: str) -> str:
    """Convert Google user ID to a deterministic UUID"""
    return str(uuid.uuid5(GOOGLE_UUID_NAMESPACE, f"google_user_{google_id}"))

def load_google_credentials():
    """Load Google OAuth credentials from client_secret.json"""
    try:
        credentials_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 
            'client_secret.json'
        )
        with open(credentials_path, 'r') as f:
            credentials = json.load(f)
        return credentials['web']['client_id']
    except Exception as e:
        current_app.logger.error(f"Error loading Google credentials: {str(e)}")
        return None

def verify_google_token(token, client_id):
    """Verify Google ID token and return user info"""
    try:
        idinfo = id_token.verify_oauth2_token(
            token, 
            requests.Request(), 
            client_id
        )
        
        return {
            'google_user_id': idinfo['sub'],
            'email': idinfo['email'],
            'name': idinfo['name'],
            'picture': idinfo.get('picture', '')
        }
    except ValueError as e:
        current_app.logger.error(f"Invalid Google token: {str(e)}")
        raise

def get_or_create_user(google_user_id, email, name):
    """Get existing user or create new one"""
    user_uuid = google_id_to_uuid(google_user_id)
    
    current_app.logger.info(f"Checking if user exists with UUID: {user_uuid}")
    user = UserModel.get_by_id(user_uuid)
    
    if not user:
        current_app.logger.info(f"User not found by UUID, checking by email: {email}")
        # Try to find by email (for existing users)
        user = UserModel.get_by_email(email)
        
        if user:
            current_app.logger.info("Found existing user by email, updating with UUID")
            # Update existing user with UUID
            user.id = user_uuid
            user.google_id = google_user_id
            user.auth_provider = 'google'
            user.email_verified = True
            user.save()
        else:
            current_app.logger.info(f"Creating new user with UUID: {user_uuid}")
            # Create new user
            user = UserModel.create_with_id(
                user_uuid, 
                username=name, 
                email=email, 
                google_id=google_user_id
            )
            
            if not user:
                raise Exception("Failed to create user - create_with_id returned None")
            
            current_app.logger.info(f"Successfully created new user: {user.id}")
    else:
        current_app.logger.info(f"Found existing user with UUID: {user.id}")
    
    return user

def create_jwt_token(user, google_user_id=None, email=None, name=None, picture=None):
    """Create JWT token with user info"""
    additional_claims = {
        'email': email or user.email,
        'name': name or user.username,
        'auth_provider': user.auth_provider,
        'email_verified': user.email_verified
    }
    
    if picture:
        additional_claims['picture'] = picture
    if google_user_id:
        additional_claims['google_id'] = google_user_id
    
    return create_access_token(
        identity=str(user.id),
        additional_claims=additional_claims,
        expires_delta=timedelta(days=JWT_EXPIRY_DAYS)
    )

def create_success_response(access_token, user, picture=None):
    """Create success response with token and user info"""
    response_data = {
        'success': True,
        'access_token': access_token,
        'user': {
            'id': str(user.id),
            'email': user.email,
            'name': user.username,
            'auth_provider': user.auth_provider,
            'email_verified': user.email_verified
        }
    }
    
    if picture:
        response_data['user']['picture'] = picture
    
    response = make_response(jsonify(response_data), 200)
    response.headers['Content-Type'] = 'application/json'
    
    # Set secure cookie with the token
    response.set_cookie(
        'access_token',
        access_token,
        httponly=True,
        secure=False,  # Set to False for localhost
        samesite='Lax',
        max_age=COOKIE_MAX_AGE,
        domain='localhost'
    )
    
    return add_cors_headers(response)

@auth_bp.route('/signup', methods=['POST', 'OPTIONS'])
def manual_signup():
    """Manual signup with email and password"""
    if request.method == 'OPTIONS':
        response = make_response()
        return add_cors_headers(response)
        
    try:
        current_app.logger.info("Processing manual signup request")
        data = request.get_json()
        
        if not data:
            return create_error_response('Request data is required', 400)
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        name = data.get('name', '').strip()
        
        # Validate required fields
        if not email or not password or not name:
            return create_error_response('Email, password, and name are required', 400)
        
        # Validate email format
        if not validate_email(email):
            return create_error_response('Invalid email format', 400)
        
        # Validate password
        is_valid_password, password_error = validate_password(password)
        if not is_valid_password:
            return create_error_response(password_error, 400)
        
        # Check if user already exists
        existing_user = UserModel.get_by_email(email)
        if existing_user:
            return create_error_response('User with this email already exists', 409)
        
        # Create new user
        user = UserModel.create(
            username=name,
            email=email,
            password=password
        )
        
        if not user:
            return create_error_response('Failed to create user account', 500)
        
        # Generate JWT token
        access_token = create_jwt_token(user)
        
        current_app.logger.info(f"Successfully created user: {user.id}")
        return create_success_response(access_token, user)
        
    except Exception as e:
        current_app.logger.error(f"Manual signup error: {str(e)}")
        current_app.logger.error(traceback.format_exc())
        return create_error_response('Signup failed. Please try again.', 500)

@auth_bp.route('/login', methods=['POST', 'OPTIONS'])
def manual_login():
    """Manual login with email and password"""
    if request.method == 'OPTIONS':
        response = make_response()
        return add_cors_headers(response)
        
    try:
        current_app.logger.info("Processing manual login request")
        data = request.get_json()
        
        if not data:
            return create_error_response('Request data is required', 400)
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        # Validate required fields
        if not email or not password:
            return create_error_response('Email and password are required', 400)
        
        # Validate email format
        if not validate_email(email):
            return create_error_response('Invalid email format', 400)
        
        # Find user by email
        user = UserModel.get_by_email(email)
        if not user:
            return create_error_response('Invalid email or password', 401)
        
        # Check if user uses manual authentication
        if user.auth_provider != 'manual':
            if user.auth_provider == 'google':
                return create_error_response('This account uses Google Sign-In. Please use the "Continue with Google" option.', 400)
            else:
                return create_error_response('This account uses a different authentication method', 400)
        
        # Verify password
        if not user.check_password(password):
            return create_error_response('Invalid email or password', 401)
        
        # Check if user is active
        if not user.is_active:
            return create_error_response('Account is disabled. Please contact support.', 403)
        
        # Generate JWT token
        access_token = create_jwt_token(user)
        
        current_app.logger.info(f"Successfully logged in user: {user.id}")
        return create_success_response(access_token, user)
        
    except Exception as e:
        current_app.logger.error(f"Manual login error: {str(e)}")
        current_app.logger.error(traceback.format_exc())
        return create_error_response('Login failed. Please try again.', 500)

@auth_bp.route('/google', methods=['POST', 'OPTIONS'])
def google_auth():
    """Verify Google ID token and create JWT"""
    if request.method == 'OPTIONS':
        response = make_response()
        return add_cors_headers(response)
        
    try:
        current_app.logger.info("Processing Google authentication request")
        
        # Validate request data
        data = request.get_json()
        if not data or 'credential' not in data:
            current_app.logger.error("No credential provided in request")
            return create_error_response('No credential provided', 400)
        
        token = data['credential']
        client_id = load_google_credentials()
        
        if not client_id:
            current_app.logger.error("Google credentials not configured")
            return create_error_response('Google credentials not configured', 500)
        
        current_app.logger.info(f"Verifying Google token with client_id: {client_id[:20]}...")
        
        # Verify Google token and extract user info
        try:
            user_info = verify_google_token(token, client_id)
            current_app.logger.info("Google token verified successfully")
            
            google_user_id = user_info['google_user_id']
            email = user_info['email']
            name = user_info['name']
            picture = user_info['picture']
            
            user_uuid = google_id_to_uuid(google_user_id)
            current_app.logger.info(f"Google user info: id={google_user_id}, uuid={user_uuid}, email={email}, name={name}")
            
            # Get or create user
            user = get_or_create_user(google_user_id, email, name)
            
            # Create JWT token
            current_app.logger.info("Creating JWT token")
            access_token = create_jwt_token(user, google_user_id, email, name, picture)
            
            # Create success response
            response = create_success_response(access_token, user, picture)
            
            current_app.logger.info("Google authentication completed successfully")
            return response
            
        except ValueError:
            return create_error_response('Invalid Google token', 401)
        except Exception as create_error:
            current_app.logger.error(f"Exception during user creation: {str(create_error)}")
            return create_error_response(f'Failed to create user: {str(create_error)}', 500)
            
    except Exception as e:
        current_app.logger.error(f"Error in Google authentication: {str(e)}")
        current_app.logger.error(f"Traceback: {traceback.format_exc()}")
        return create_error_response('Authentication failed', 500)

@auth_bp.route('/verify', methods=['GET', 'OPTIONS'])
@jwt_required()
def verify_token():
    """Verify JWT token and return user info"""
    if request.method == 'OPTIONS':
        response = make_response()
        return add_cors_headers(response)

    try:
        # Validate authorization header
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'success': False, 'error': 'Invalid authorization header format'}), 422

        # Extract and validate token
        token = auth_header.split(' ')[1].strip()
        if not token:
            return jsonify({'success': False, 'error': 'Empty token'}), 422

        current_user = get_jwt_identity()
        if not current_user:
            return jsonify({'success': False, 'error': 'Invalid token'}), 401

        claims = get_jwt()
        if not claims:
            return jsonify({'success': False, 'error': 'Invalid token claims'}), 401
        
        # Verify user still exists
        user = UserModel.get_by_id(str(current_user))
        if not user:
            return jsonify({'success': False, 'error': 'User not found'}), 401
        
        response_data = {
            'success': True,
            'user': {
                'id': str(user.id),
                'email': user.email,
                'name': user.username,
                'picture': claims.get('picture', '')
            }
        }
        
        response = jsonify(response_data)
        return add_cors_headers(response)
        
    except Exception as e:
        current_app.logger.error(f"Error verifying token: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 401

@auth_bp.route('/logout', methods=['POST'])
def logout():
    """Handle user logout"""
    response = jsonify({'success': True})
    response.delete_cookie('access_token')
    return response

@auth_bp.route('/user', methods=['GET'])
@jwt_required()
def get_user():
    """Get current user information"""
    try:
        current_user_id = get_jwt_identity()
        claims = get_jwt()
        
        user_data = {
            'success': True,
            'user': {
                'id': current_user_id,
                'email': claims.get('email'),
                'name': claims.get('name'),
                'picture': claims.get('picture')
            }
        }
        
        return jsonify(user_data)
        
    except Exception as e:
        current_app.logger.error(f"Error getting user info: {str(e)}")
        return jsonify({'success': False, 'error': 'Failed to get user info'}), 500 