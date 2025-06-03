from datetime import datetime
from typing import Optional, Dict, Any
from app.services.weaviate_service import weaviate_service
import json

class UserPreferencesModel:
    def __init__(self, pref_id: str = None, user_id: str = None, 
                 browser_tracking_enabled: bool = False, tracking_settings: Dict = None,
                 created_at: str = None, updated_at: str = None):
        self.id = pref_id
        self.user_id = user_id
        self.browser_tracking_enabled = browser_tracking_enabled
        self.tracking_settings = tracking_settings or {
            'track_clicks': True,
            'track_navigation': True,
            'track_scroll': True,
            'track_focus': True,
            'retention_days': 30,
            'max_activities_per_session': 200
        }
        self.created_at = created_at
        self.updated_at = updated_at
    
    @classmethod
    def create(cls, user_id: str, browser_tracking_enabled: bool = False, 
               tracking_settings: Dict = None) -> 'UserPreferencesModel':
        """Create user preferences"""
        default_settings = {
            'track_clicks': True,
            'track_navigation': True,
            'track_scroll': True,
            'track_focus': True,
            'retention_days': 30,
            'max_activities_per_session': 200
        }
        
        final_settings = {**default_settings, **(tracking_settings or {})}
        
        properties = {
            'user_id': user_id,
            'browser_tracking_enabled': browser_tracking_enabled,
            'tracking_settings': json.dumps(final_settings),
            'created_at': datetime.utcnow().isoformat(),
            'updated_at': datetime.utcnow().isoformat()
        }
        
        pref_id = weaviate_service.create_object('UserPreferences', properties)
        return cls(
            pref_id=pref_id,
            user_id=user_id,
            browser_tracking_enabled=browser_tracking_enabled,
            tracking_settings=final_settings,
            created_at=properties['created_at'],
            updated_at=properties['updated_at']
        )
    
    @classmethod
    def get_by_user_id(cls, user_id: str) -> Optional['UserPreferencesModel']:
        """Get user preferences by user ID"""
        where_filter = {
            "path": ["user_id"],
            "operator": "Equal",
            "valueText": user_id
        }
        
        preferences = weaviate_service.query_objects(
            'UserPreferences', 
            where_filter=where_filter, 
            limit=1,
            additional=['id']
        )
        
        if preferences:
            pref_data = preferences[0]
            tracking_settings = json.loads(pref_data.get('tracking_settings', '{}'))
            
            return cls(
                pref_id=pref_data.get('_additional', {}).get('id'),
                user_id=pref_data.get('user_id'),
                browser_tracking_enabled=pref_data.get('browser_tracking_enabled', False),
                tracking_settings=tracking_settings,
                created_at=pref_data.get('created_at'),
                updated_at=pref_data.get('updated_at')
            )
        
        return None
    
    @classmethod
    def get_or_create(cls, user_id: str) -> 'UserPreferencesModel':
        """Get existing preferences or create default ones"""
        preferences = cls.get_by_user_id(user_id)
        if preferences:
            return preferences
        
        # Create default preferences
        return cls.create(user_id)
    
    def update_tracking_enabled(self, enabled: bool) -> bool:
        """Update browser tracking enabled status"""
        self.browser_tracking_enabled = enabled
        self.updated_at = datetime.utcnow().isoformat()
        return self.save()
    
    def update_tracking_settings(self, settings: Dict) -> bool:
        """Update tracking settings"""
        self.tracking_settings.update(settings)
        self.updated_at = datetime.utcnow().isoformat()
        return self.save()
    
    def save(self) -> bool:
        """Save preferences"""
        if not self.id:
            return False
        
        properties = {
            'user_id': self.user_id,
            'browser_tracking_enabled': self.browser_tracking_enabled,
            'tracking_settings': json.dumps(self.tracking_settings),
            'created_at': self.created_at,
            'updated_at': self.updated_at
        }
        
        return weaviate_service.update_object('UserPreferences', self.id, properties)
    
    def delete(self) -> bool:
        """Delete preferences"""
        if not self.id:
            return False
        return weaviate_service.delete_object('UserPreferences', self.id)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            'id': self.id,
            'user_id': self.user_id,
            'browser_tracking_enabled': self.browser_tracking_enabled,
            'tracking_settings': self.tracking_settings,
            'created_at': self.created_at,
            'updated_at': self.updated_at
        }
    
    def __repr__(self):
        return f'<UserPreferencesModel for user {self.user_id}>' 