from datetime import datetime
from typing import Optional, Dict, Any
from app.services.weaviate_service import weaviate_service

class UserModel:
    def __init__(self, user_id: str = None, username: str = None, email: str = None, 
                 google_id: str = None, created_at: str = None, is_active: bool = True):
        self.id = user_id
        self.username = username
        self.email = email
        self.google_id = google_id
        self.created_at = created_at
        self.is_active = is_active
    
    @classmethod
    def create(cls, username: str, email: str, google_id: str = None) -> 'UserModel':
        """Create a new user"""
        properties = {
            'username': username,
            'email': email,
            'is_active': True
        }
        if google_id:
            properties['google_id'] = google_id
        user_id = weaviate_service.create_object('User', properties)
        return cls(user_id=user_id, username=username, email=email, google_id=google_id, is_active=True)
    
    @classmethod
    def create_with_id(cls, user_id: str, username: str, email: str, google_id: str = None) -> 'UserModel':
        """Create a new user with a specific ID (for Google OAuth)"""
        properties = {
            'username': username,
            'email': email,
            'is_active': True
        }
        if google_id:
            properties['google_id'] = google_id
        success = weaviate_service.create_object_with_id('User', user_id, properties)
        if success:
            return cls(user_id=user_id, username=username, email=email, google_id=google_id, is_active=True)
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
                created_at=user_data.get('created_at'),
                is_active=user_data.get('is_active', True)
            )
        return None
    
    @classmethod
    def get_by_email(cls, email: str) -> Optional['UserModel']:
        """Get user by email"""
        where_filter = {
            "path": ["email"],
            "operator": "Equal",
            "valueText": email
        }
        users = weaviate_service.query_objects('User', where_filter=where_filter, limit=1)
        if users:
            user_data = users[0]
            return cls(
                user_id=user_data.get('_additional', {}).get('id'),
                username=user_data.get('username'),
                email=user_data.get('email'),
                google_id=user_data.get('google_id'),
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
            'created_at': self.created_at,
            'is_active': self.is_active
        }
    
    def __repr__(self):
        return f'<UserModel {self.username}>'
