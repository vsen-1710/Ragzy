from datetime import datetime
from typing import Optional, Dict, Any, List
from app.services.weaviate_service import weaviate_service
import json
import uuid

class BrowserActivityModel:
    def __init__(self, activity_id: str = None, user_id: str = None, activity_type: str = None,
                 activity_data: Dict = None, url: str = None, page_title: str = None,
                 timestamp: str = None, session_id: str = None, engagement_score: float = 0.0):
        self.id = activity_id
        self.user_id = user_id
        self.activity_type = activity_type
        self.activity_data = activity_data or {}
        self.url = url
        self.page_title = page_title
        self.timestamp = timestamp or datetime.utcnow().isoformat() + 'Z'
        self.session_id = session_id
        self.engagement_score = engagement_score
    
    @classmethod
    def create(cls, user_id: str, activity_type: str, activity_data: Dict, 
               url: str = None, page_title: str = None, session_id: str = None,
               engagement_score: float = 0.0) -> 'BrowserActivityModel':
        """Create a new browser activity record"""
        properties = {
            'user_id': user_id,
            'activity_type': activity_type,
            'activity_data': json.dumps(activity_data),
            'url': url or '',
            'page_title': page_title or '',
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'session_id': session_id or str(uuid.uuid4()),
            'engagement_score': engagement_score
        }
        
        activity_id = weaviate_service.create_object('BrowserActivity', properties)
        return cls(
            activity_id=activity_id,
            user_id=user_id,
            activity_type=activity_type,
            activity_data=activity_data,
            url=url,
            page_title=page_title,
            timestamp=properties['timestamp'],
            session_id=properties['session_id'],
            engagement_score=engagement_score
        )
    
    @classmethod
    def get_by_user(cls, user_id: str, limit: int = 100, hours_back: int = 24) -> List['BrowserActivityModel']:
        """Get browser activities for a user within specified time frame"""
        from datetime import datetime, timedelta
        
        # Calculate cutoff time
        cutoff_time = (datetime.utcnow() - timedelta(hours=hours_back)).isoformat() + 'Z'
        
        where_filter = {
            "operator": "And",
            "operands": [
                {
                    "path": ["user_id"],
                    "operator": "Equal", 
                    "valueText": user_id
                },
                {
                    "path": ["timestamp"],
                    "operator": "GreaterThan",
                    "valueText": cutoff_time
                }
            ]
        }
        
        activities = weaviate_service.query_objects(
            'BrowserActivity', 
            where_filter=where_filter, 
            limit=limit,
            additional=['id']
        )
        
        result = []
        for activity_data in activities:
            activity_data_parsed = json.loads(activity_data.get('activity_data', '{}'))
            result.append(cls(
                activity_id=activity_data.get('_additional', {}).get('id'),
                user_id=activity_data.get('user_id'),
                activity_type=activity_data.get('activity_type'),
                activity_data=activity_data_parsed,
                url=activity_data.get('url'),
                page_title=activity_data.get('page_title'),
                timestamp=activity_data.get('timestamp'),
                session_id=activity_data.get('session_id'),
                engagement_score=activity_data.get('engagement_score', 0.0)
            ))
        
        return result
    
    @classmethod
    def get_activity_summary(cls, user_id: str, hours_back: int = 24) -> Dict[str, Any]:
        """Get activity summary for a user"""
        activities = cls.get_by_user(user_id, limit=500, hours_back=hours_back)
        
        if not activities:
            return {
                'total_activities': 0,
                'activity_types': {},
                'engagement_score': 0.0,
                'active_sessions': 0,
                'recent_urls': [],
                'time_period_hours': hours_back
            }
        
        # Calculate statistics
        activity_types = {}
        session_ids = set()
        urls = []
        total_engagement = 0.0
        
        for activity in activities:
            # Count activity types
            activity_type = activity.activity_type
            activity_types[activity_type] = activity_types.get(activity_type, 0) + 1
            
            # Track sessions
            if activity.session_id:
                session_ids.add(activity.session_id)
            
            # Track URLs
            if activity.url and activity.url not in urls:
                urls.append(activity.url)
            
            # Sum engagement scores
            total_engagement += activity.engagement_score
        
        return {
            'total_activities': len(activities),
            'activity_types': activity_types,
            'engagement_score': round(total_engagement / len(activities), 2) if activities else 0.0,
            'active_sessions': len(session_ids),
            'recent_urls': urls[:10],  # Last 10 unique URLs
            'time_period_hours': hours_back,
            'most_active_type': max(activity_types.items(), key=lambda x: x[1])[0] if activity_types else None
        }
    
    @classmethod
    def create_bulk(cls, activities: List[Dict]) -> List['BrowserActivityModel']:
        """Create multiple browser activities in bulk"""
        created_activities = []
        
        for activity_data in activities:
            try:
                activity = cls.create(
                    user_id=activity_data['user_id'],
                    activity_type=activity_data['activity_type'],
                    activity_data=activity_data['activity_data'],
                    url=activity_data.get('url'),
                    page_title=activity_data.get('page_title'),
                    session_id=activity_data.get('session_id'),
                    engagement_score=activity_data.get('engagement_score', 0.0)
                )
                created_activities.append(activity)
            except Exception as e:
                # Log error but continue with other activities
                print(f"Error creating activity: {str(e)}")
                continue
        
        return created_activities
    
    @classmethod
    def delete_old_activities(cls, user_id: str, days_old: int = 30) -> int:
        """Delete activities older than specified days"""
        try:
            from datetime import datetime, timedelta
            
            cutoff_time = (datetime.utcnow() - timedelta(days=days_old)).isoformat() + 'Z'
            
            where_filter = {
                "operator": "And",
                "operands": [
                    {
                        "path": ["user_id"],
                        "operator": "Equal",
                        "valueText": user_id
                    },
                    {
                        "path": ["timestamp"],
                        "operator": "LessThan",
                        "valueText": cutoff_time
                    }
                ]
            }
            
            try:
                # Get activities to delete
                old_activities = weaviate_service.query_objects(
                    'BrowserActivity',
                    where_filter=where_filter,
                    additional=['id']
                )
                
                # Delete each activity
                deleted_count = 0
                for activity in old_activities:
                    try:
                        activity_id = activity.get('_additional', {}).get('id')
                        if activity_id and weaviate_service.delete_object('BrowserActivity', activity_id):
                            deleted_count += 1
                    except Exception as delete_error:
                        print(f"Error deleting old activity {activity_id}: {delete_error}")
                        continue
                
                return deleted_count
                
            except Exception as query_error:
                print(f"Error querying old activities: {query_error}")
                return 0
                
        except Exception as e:
            print(f"Error in delete_old_activities: {e}")
            return 0
    
    @classmethod
    def clear_user_activities(cls, user_id: str, days_old: int = None) -> int:
        """Clear user activities - delete all or activities older than specified days"""
        try:
            if days_old is not None:
                # Delete activities older than specified days
                return cls.delete_old_activities(user_id, days_old)
            else:
                # Delete all activities for the user
                where_filter = {
                    "path": ["user_id"],
                    "operator": "Equal",
                    "valueText": user_id
                }
                
                try:
                    # Get all activities to delete
                    all_activities = weaviate_service.query_objects(
                        'BrowserActivity',
                        where_filter=where_filter,
                        additional=['id'],
                        limit=10000  # Large limit to get all activities
                    )
                    
                    # Delete each activity
                    deleted_count = 0
                    for activity in all_activities:
                        try:
                            activity_id = activity.get('_additional', {}).get('id')
                            if activity_id and weaviate_service.delete_object('BrowserActivity', activity_id):
                                deleted_count += 1
                        except Exception as delete_error:
                            # Log individual delete errors but continue
                            print(f"Error deleting individual activity {activity_id}: {delete_error}")
                            continue
                    
                    return deleted_count
                    
                except Exception as query_error:
                    print(f"Error querying activities for deletion: {query_error}")
                    # Return 0 if we can't query/delete, but don't raise an exception
                    return 0
                    
        except Exception as e:
            print(f"Error in clear_user_activities: {e}")
            # Don't raise the exception, return 0 to indicate no activities were cleared
            return 0
    
    def save(self) -> bool:
        """Update activity data"""
        if not self.id:
            return False
        
        properties = {
            'user_id': self.user_id,
            'activity_type': self.activity_type,
            'activity_data': json.dumps(self.activity_data),
            'url': self.url or '',
            'page_title': self.page_title or '',
            'timestamp': self.timestamp,
            'session_id': self.session_id,
            'engagement_score': self.engagement_score
        }
        
        return weaviate_service.update_object('BrowserActivity', self.id, properties)
    
    def delete(self) -> bool:
        """Delete activity"""
        if not self.id:
            return False
        return weaviate_service.delete_object('BrowserActivity', self.id)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            'id': self.id,
            'user_id': self.user_id,
            'activity_type': self.activity_type,
            'activity_data': self.activity_data,
            'url': self.url,
            'page_title': self.page_title,
            'timestamp': self.timestamp,
            'session_id': self.session_id,
            'engagement_score': self.engagement_score
        }
    
    def __repr__(self):
        return f'<BrowserActivityModel {self.activity_type} for user {self.user_id}>' 