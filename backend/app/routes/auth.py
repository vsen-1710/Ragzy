from flask import Blueprint, request, jsonify, current_app, make_response
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity, get_jwt
from google.oauth2 import id_token
from google.auth.transport import requests
import json
import os
import uuid
import hashlib
from datetime import timedelta
from ..models.user import UserModel

# Change the URL prefix to match the frontend request
auth_bp = Blueprint('auth', __name__, url_prefix='/auth')

def get_cors_origin():
    """Get appropriate CORS origin based on request"""
    origin = request.headers.get('Origin')
    
    if not origin:
        return '*'
    
    allowed_origins = [
        'http://localhost:3000',
        'https://ragzy.onrender.com',
        'http://localhost:3001'
    ]
    
    # Check if origin is valid
    if origin in allowed_origins:
        return origin
    elif '.ngrok.io' in origin or '.ngrok-free.app' in origin:
        return origin
    else:
        return '*'  # Be more permissive

def add_cors_headers(response):
    """Add CORS headers to response"""
    cors_origin = get_cors_origin()
    response.headers.add("Access-Control-Allow-Origin", cors_origin)
    response.headers.add("Access-Control-Allow-Headers", "Content-Type, Authorization, Cache-Control, X-Requested-With, Accept, Origin")
    response.headers.add("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
    response.headers.add("Access-Control-Allow-Credentials", "true")
    response.headers.add("Access-Control-Max-Age", "3600")
    response.headers.add("Vary", "Origin")
    return response

def google_id_to_uuid(google_id: str) -> str:
    """Convert Google user ID to a deterministic UUID"""
    # Create a deterministic UUID from the Google ID using namespace UUID
    namespace = uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')  # DNS namespace
    return str(uuid.uuid5(namespace, f"google_user_{google_id}"))

# Load Google OAuth credentials
def load_google_credentials():
    """Load Google OAuth credentials from client_secret.json"""
    try:
        credentials_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'client_secret.json')
        with open(credentials_path, 'r') as f:
            credentials = json.load(f)
        return credentials['web']['client_id']
    except Exception as e:
        current_app.logger.error(f"Error loading Google credentials: {str(e)}")
        return None

@auth_bp.route('/google', methods=['POST', 'OPTIONS'])
def google_auth():
    """Verify Google ID token and create JWT"""
    if request.method == 'OPTIONS':
        response = make_response()
        add_cors_headers(response)
        return response
        
    try:
        current_app.logger.info("Processing Google authentication request")
        
        data = request.get_json()
        if not data or 'credential' not in data:
            current_app.logger.error("No credential provided in request")
            response = make_response(jsonify({'success': False, 'error': 'No credential provided'}), 400)
            response.headers['Content-Type'] = 'application/json'
            return add_cors_headers(response)
        
        token = data['credential']
        client_id = load_google_credentials()
        
        if not client_id:
            current_app.logger.error("Google credentials not configured")
            response = make_response(jsonify({'success': False, 'error': 'Google credentials not configured'}), 500)
            response.headers['Content-Type'] = 'application/json'
            return add_cors_headers(response)
        
        current_app.logger.info(f"Verifying Google token with client_id: {client_id[:20]}...")
        
        # Verify the Google ID token
        try:
            idinfo = id_token.verify_oauth2_token(
                token, 
                requests.Request(), 
                client_id
            )
            
            current_app.logger.info("Google token verified successfully")
            
            # Extract user information
            google_user_id = idinfo['sub']  # This is the unique Google user ID
            email = idinfo['email']
            name = idinfo['name']
            picture = idinfo.get('picture', '')
            
            # Convert Google ID to valid UUID
            user_uuid = google_id_to_uuid(google_user_id)
            
            current_app.logger.info(f"Google user info: id={google_user_id}, uuid={user_uuid}, email={email}, name={name}")
            
            # Check if user exists by UUID first, then by email
            current_app.logger.info(f"Checking if user exists with UUID: {user_uuid}")
            user = UserModel.get_by_id(user_uuid)
            
            if not user:
                current_app.logger.info(f"User not found by UUID, checking by email: {email}")
                # Try to find by email (for existing users)
                user = UserModel.get_by_email(email)
                if user:
                    current_app.logger.info(f"Found existing user by email, updating with UUID")
                    # Update existing user with UUID
                    user.id = user_uuid
                    user.google_id = google_user_id  # Store original Google ID
                    user.save()
                else:
                    current_app.logger.info(f"Creating new user with UUID: {user_uuid}")
                    # Create new user with UUID as the primary key
                    try:
                        user = UserModel.create_with_id(user_uuid, username=name, email=email, google_id=google_user_id)
                        if not user:
                            current_app.logger.error("Failed to create user - create_with_id returned None")
                            response = make_response(jsonify({'success': False, 'error': 'Failed to create user'}), 500)
                            response.headers['Content-Type'] = 'application/json'
                            return add_cors_headers(response)
                        current_app.logger.info(f"Successfully created new user: {user.id}")
                    except Exception as create_error:
                        current_app.logger.error(f"Exception during user creation: {str(create_error)}")
                        response = make_response(jsonify({'success': False, 'error': f'Failed to create user: {str(create_error)}'}), 500)
                        response.headers['Content-Type'] = 'application/json'
                        return add_cors_headers(response)
            else:
                current_app.logger.info(f"Found existing user with UUID: {user.id}")
            
            # Create JWT token with user info
            additional_claims = {
                'email': email,
                'name': name,
                'picture': picture,
                'google_id': google_user_id  # Include original Google ID in token
            }
            
            current_app.logger.info("Creating JWT token")
            access_token = create_access_token(
                identity=str(user.id),  # Use Google ID as identity
                additional_claims=additional_claims,
                expires_delta=timedelta(days=7)  # Token valid for 7 days
            )
            
            response = make_response(jsonify({
                'success': True,
                'access_token': access_token,
                'user': {
                    'id': str(user.id),  # This will be the Google ID
                    'email': user.email,
                    'name': user.username,
                    'picture': picture
                }
            }), 200)
            
            # Set content type explicitly
            response.headers['Content-Type'] = 'application/json'
            
            # Set secure cookie with the token
            response.set_cookie(
                'access_token',
                access_token,
                httponly=True,
                secure=False,  # Set to False for localhost
                samesite='Lax',  # Changed from None to Lax for better compatibility
                max_age=7 * 24 * 60 * 60,  # 7 days
                domain='localhost'
            )
            
            # Add CORS headers
            response = add_cors_headers(response)
            
            current_app.logger.info("Google authentication completed successfully")
            return response
            
        except ValueError as e:
            current_app.logger.error(f"Invalid Google token: {str(e)}")
            response = make_response(jsonify({'success': False, 'error': 'Invalid Google token'}), 401)
            response.headers['Content-Type'] = 'application/json'
            return add_cors_headers(response)
            
    except Exception as e:
        current_app.logger.error(f"Error in Google authentication: {str(e)}")
        import traceback
        current_app.logger.error(f"Traceback: {traceback.format_exc()}")
        response = make_response(jsonify({'success': False, 'error': 'Authentication failed'}), 500)
        response.headers['Content-Type'] = 'application/json'
        return add_cors_headers(response)

@auth_bp.route('/verify', methods=['GET', 'OPTIONS'])
@jwt_required()
def verify_token():
    """Verify JWT token and return user info"""
    if request.method == 'OPTIONS':
        response = make_response()
        add_cors_headers(response)
        return response

    try:
        # Get the authorization header
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'success': False, 'error': 'Invalid authorization header format'}), 422

        # Extract the token
        token = auth_header.split(' ')[1].strip()
        if not token:
            return jsonify({'success': False, 'error': 'Empty token'}), 422

        current_user = get_jwt_identity()
        if not current_user:
            return jsonify({'success': False, 'error': 'Invalid token'}), 401

        claims = get_jwt()
        if not claims:
            return jsonify({'success': False, 'error': 'Invalid token claims'}), 401
        
        # Get user from Weaviate to ensure they still exist
        user = UserModel.get_by_id(str(current_user))  # Ensure ID is a string
        if not user:
            return jsonify({'success': False, 'error': 'User not found'}), 401
        
        response = jsonify({
            'success': True,
            'user': {
                'id': str(user.id),  # Ensure ID is a string
                'email': user.email,
                'name': user.username,  # Using username as name
                'picture': claims.get('picture', '')  # Keep picture from claims
            }
        })
        
        # Add CORS headers
        response = add_cors_headers(response)
        
        return response
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
        from flask_jwt_extended import get_jwt
        claims = get_jwt()
        
        return jsonify({
            'success': True,
            'user': {
                'id': current_user_id,
                'email': claims.get('email'),
                'name': claims.get('name'),
                'picture': claims.get('picture')
            }
        })
        
    except Exception as e:
        current_app.logger.error(f"Error getting user info: {str(e)}")
        return jsonify({'success': False, 'error': 'Failed to get user info'}), 500 