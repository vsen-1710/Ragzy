from datetime import datetime
from typing import Optional, Dict, Any
import bcrypt
from app.services.weaviate_service import weaviate_service
from app.utils.logger import get_logger

class UserModel:
    def __init__(self, user_id: str = None, username: str = None, email: str = None, 
                 google_id: str = None, password_hash: str = None, auth_provider: str = 'manual',
                 email_verified: bool = False, created_at: str = None, is_active: bool = True):
        self.id = user_id
        self.username = username
        self.email = email
        self.google_id = google_id
        self.password_hash = password_hash
        self.auth_provider = auth_provider  # 'manual', 'google'
        self.email_verified = email_verified
        self.created_at = created_at
        self.is_active = is_active
    
    def set_password(self, password: str) -> None:
        """Hash and set password"""
        if password:
            salt = bcrypt.gensalt()
            self.password_hash = bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')
            self.auth_provider = 'manual'
    
    def check_password(self, password: str) -> bool:
        """Verify password against hash"""
        if not self.password_hash or not password:
            return False
        return bcrypt.checkpw(password.encode('utf-8'), self.password_hash.encode('utf-8'))
    
    @classmethod
    def create(cls, username: str, email: str, password: str = None, google_id: str = None) -> 'UserModel':
        """Create a new user"""
        logger = get_logger()
        
        properties = {
            'username': username,
            'email': email,
            'is_active': True,
            'email_verified': bool(google_id),  # Google users are pre-verified
            'auth_provider': 'google' if google_id else 'manual'
        }
        
        # Handle password for manual auth
        if password and not google_id:
            salt = bcrypt.gensalt()
            password_hash = bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')
            properties['password_hash'] = password_hash
            logger.info(f"Created password hash for user {email}: length={len(password_hash)}, starts_with=${password_hash[:10]}")
        else:
            logger.info(f"No password hash created for user {email}: password={bool(password)}, google_id={bool(google_id)}")
        
        if google_id:
            properties['google_id'] = google_id
            
        logger.info(f"Properties being stored: {list(properties.keys())}")
        user_id = weaviate_service.create_object('User', properties)
        logger.info(f"User created with ID: {user_id}")
        
        return cls(
            user_id=user_id, 
            username=username, 
            email=email, 
            google_id=google_id,
            password_hash=properties.get('password_hash'),
            auth_provider=properties['auth_provider'],
            email_verified=properties['email_verified'],
            is_active=True
        )
    
    @classmethod
    def create_with_id(cls, user_id: str, username: str, email: str, password: str = None, google_id: str = None) -> 'UserModel':
        """Create a new user with a specific ID (for Google OAuth)"""
        properties = {
            'username': username,
            'email': email,
            'is_active': True,
            'email_verified': bool(google_id),  # Google users are pre-verified
            'auth_provider': 'google' if google_id else 'manual'
        }
        
        # Handle password for manual auth
        if password and not google_id:
            salt = bcrypt.gensalt()
            password_hash = bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')
            properties['password_hash'] = password_hash
            
        if google_id:
            properties['google_id'] = google_id
            
        success = weaviate_service.create_object_with_id('User', user_id, properties)
        if success:
            return cls(
                user_id=user_id, 
                username=username, 
                email=email, 
                google_id=google_id,
                password_hash=properties.get('password_hash'),
                auth_provider=properties['auth_provider'],
                email_verified=properties['email_verified'],
                is_active=True
            )
        return None
    
    @classmethod
    def get_by_id(cls, user_id: str) -> Optional['UserModel']:
        """Get user by ID"""
        user_data = weaviate_service.get_object('User', user_id)
        if user_data:
            props = user_data.get('properties', {})
            return cls(
                user_id=user_data.get('id'),
                username=props.get('username'),
                email=props.get('email'),
                google_id=props.get('google_id'),
                password_hash=props.get('password_hash'),
                auth_provider=props.get('auth_provider', 'manual'),
                email_verified=props.get('email_verified', False),
                created_at=props.get('created_at'),
                is_active=props.get('is_active', True)
            )
        return None
    
    @classmethod
    def get_by_username(cls, username: str) -> Optional['UserModel']:
        """Get user by username"""
        where_filter = {
            "path": ["username"],
            "operator": "Equal",
            "valueText": username
        }
        users = weaviate_service.query_objects('User', where_filter=where_filter, limit=1)
        if users:
            user_data = users[0]
            return cls(
                user_id=user_data.get('_additional', {}).get('id'),
                username=user_data.get('username'),
                email=user_data.get('email'),
                google_id=user_data.get('google_id'),
                password_hash=user_data.get('password_hash'),
                auth_provider=user_data.get('auth_provider', 'manual'),
                email_verified=user_data.get('email_verified', False),
                created_at=user_data.get('created_at'),
                is_active=user_data.get('is_active', True)
            )
        return None
    
    @classmethod
    def get_by_email(cls, email: str) -> Optional['UserModel']:
        """Get user by email"""
        logger = get_logger()
        
        where_filter = {
            "path": ["email"],
            "operator": "Equal",
            "valueText": email
        }
        users = weaviate_service.query_objects('User', where_filter=where_filter, limit=1)
        if users:
            user_data = users[0]
            logger.info(f"Retrieved user data for {email}: keys={list(user_data.keys())}")
            logger.info(f"Password hash retrieved: {bool(user_data.get('password_hash'))}")
            if user_data.get('password_hash'):
                logger.info(f"Password hash length: {len(user_data.get('password_hash'))}")
            
            return cls(
                user_id=user_data.get('_additional', {}).get('id'),
                username=user_data.get('username'),
                email=user_data.get('email'),
                google_id=user_data.get('google_id'),
                password_hash=user_data.get('password_hash'),
                auth_provider=user_data.get('auth_provider', 'manual'),
                email_verified=user_data.get('email_verified', False),
                created_at=user_data.get('created_at'),
                is_active=user_data.get('is_active', True)
            )
        return None
    
    def save(self) -> bool:
        """Update user data"""
        if not self.id:
            return False
        
        properties = {
            'username': self.username,
            'email': self.email,
            'google_id': self.google_id,
            'password_hash': self.password_hash,
            'auth_provider': self.auth_provider,
            'email_verified': self.email_verified,
            'is_active': self.is_active
        }
        return weaviate_service.update_object('User', self.id, properties)
    
    def delete(self) -> bool:
        """Delete user"""
        if not self.id:
            return False
        return weaviate_service.delete_object('User', self.id)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            'id': self.id,
            'username': self.username,
            'email': self.email,
            'google_id': self.google_id,
            'auth_provider': self.auth_provider,
            'email_verified': self.email_verified,
            'created_at': self.created_at,
            'is_active': self.is_active
        }
    
    def __repr__(self):
        return f'<UserModel {self.username}>'
