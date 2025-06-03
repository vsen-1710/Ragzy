from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
from app.models.browser_activity import BrowserActivityModel
from app.models.user_preferences import UserPreferencesModel
from app.models.user import UserModel
import json

class BrowserTrackingService:
    """Service for managing browser activity tracking and context generation"""
    
    def __init__(self):
        self.max_context_activities = 50
        self.context_hours_back = 2  # Default to 2 hours for chat context
        
    def is_tracking_enabled(self, user_id: str) -> bool:
        """Check if tracking is enabled for user"""
        preferences = UserPreferencesModel.get_by_user_id(user_id)
        return preferences.browser_tracking_enabled if preferences else False
    
    def enable_tracking(self, user_id: str) -> Dict[str, Any]:
        """Enable browser tracking for user"""
        preferences = UserPreferencesModel.get_or_create(user_id)
        success = preferences.update_tracking_enabled(True)
        
        return {
            'success': success,
            'enabled': True,
            'message': 'Browser tracking enabled successfully'
        }
    
    def disable_tracking(self, user_id: str) -> Dict[str, Any]:
        """Disable browser tracking for user"""
        preferences = UserPreferencesModel.get_or_create(user_id)
        success = preferences.update_tracking_enabled(False)
        
        return {
            'success': success,
            'enabled': False,
            'message': 'Browser tracking disabled successfully'
        }
    
    def get_user_preferences(self, user_id: str) -> Dict[str, Any]:
        """Get user tracking preferences"""
        preferences = UserPreferencesModel.get_or_create(user_id)
        return preferences.to_dict()
    
    def update_tracking_settings(self, user_id: str, settings: Dict) -> Dict[str, Any]:
        """Update user tracking settings"""
        preferences = UserPreferencesModel.get_or_create(user_id)
        success = preferences.update_tracking_settings(settings)
        
        return {
            'success': success,
            'settings': preferences.tracking_settings,
            'message': 'Tracking settings updated successfully' if success else 'Failed to update settings'
        }
    
    def store_activities(self, user_id: str, activities: List[Dict]) -> Dict[str, Any]:
        """Store browser activities in bulk"""
        if not self.is_tracking_enabled(user_id):
            return {
                'success': False,
                'message': 'Tracking not enabled for this user',
                'stored_count': 0
            }
        
        # Validate and prepare activities
        valid_activities = []
        for activity in activities:
            if self._validate_activity(activity):
                activity['user_id'] = user_id
                valid_activities.append(activity)
        
        # Store activities
        stored_activities = BrowserActivityModel.create_bulk(valid_activities)
        
        return {
            'success': True,
            'stored_count': len(stored_activities),
            'message': f'Successfully stored {len(stored_activities)} activities'
        }
    
    def _validate_activity(self, activity: Dict) -> bool:
        """Validate activity data"""
        required_fields = ['activity_type', 'activity_data']
        return all(field in activity for field in required_fields)
    
    def get_user_activities(self, user_id: str, hours_back: int = 24, 
                           limit: int = 100) -> List[Dict[str, Any]]:
        """Get user activities within time frame"""
        if not self.is_tracking_enabled(user_id):
            return []
        
        activities = BrowserActivityModel.get_by_user(user_id, limit, hours_back)
        return [activity.to_dict() for activity in activities]
    
    def get_activity_summary(self, user_id: str, hours_back: int = 24) -> Dict[str, Any]:
        """Get detailed activity summary for user"""
        if not self.is_tracking_enabled(user_id):
            return {
                'tracking_enabled': False,
                'message': 'Browser tracking is disabled'
            }
        
        summary = BrowserActivityModel.get_activity_summary(user_id, hours_back)
        summary['tracking_enabled'] = True
        
        return summary
    
    def generate_chat_context(self, user_id: str, hours_back: int = None) -> str:
        """Generate contextual information for chat responses"""
        if not self.is_tracking_enabled(user_id):
            return ""
        
        hours_back = hours_back or self.context_hours_back
        activities = BrowserActivityModel.get_by_user(
            user_id, 
            limit=self.max_context_activities, 
            hours_back=hours_back
        )
        
        if not activities:
            return ""
        
        return self._build_context_string(activities, hours_back)
    
    def _build_context_string(self, activities: List[BrowserActivityModel], hours_back: int) -> str:
        """Build contextual information string from activities"""
        if not activities:
            return ""
        
        # Analyze activities
        context_data = self._analyze_activities(activities)
        
        # Build context string
        context_parts = [
            f"🔍 **User Browser Context** (last {hours_back} hours):",
            "",
            f"📊 **Activity Summary:**",
            f"• Total interactions: {context_data['total_activities']}",
            f"• Engagement level: {context_data['engagement_level']}",
            f"• Active sessions: {context_data['active_sessions']}"
        ]
        
        if context_data['current_focus']:
            context_parts.extend([
                "",
                f"🎯 **Current Focus:**",
                f"• Page: {context_data['current_focus']['title']}",
                f"• URL: {context_data['current_focus']['url'][:50]}{'...' if len(context_data['current_focus']['url']) > 50 else ''}",
                f"• Time on page: {context_data['current_focus']['time_spent']}m"
            ])
        
        if context_data['recent_searches']:
            context_parts.extend([
                "",
                f"🔍 **Recent Search Activity:**",
                *[f"• {search}" for search in context_data['recent_searches'][:3]]
            ])
        
        if context_data['navigation_pattern']:
            context_parts.extend([
                "",
                f"🧭 **Navigation Pattern:**",
                f"• Sites visited: {len(context_data['navigation_pattern'])}",
                *[f"• {site}" for site in context_data['navigation_pattern'][:3]]
            ])
        
        if context_data['interaction_insights']:
            context_parts.extend([
                "",
                f"💡 **User Behavior Insights:**",
                *[f"• {insight}" for insight in context_data['interaction_insights']]
            ])
        
        context_parts.extend([
            "",
            "💬 **Instructions:** Use this context to provide more relevant and personalized responses based on the user's current browsing behavior and interests."
        ])
        
        return "\n".join(context_parts)
    
    def _analyze_activities(self, activities: List[BrowserActivityModel]) -> Dict[str, Any]:
        """Analyze activities to extract meaningful insights"""
        if not activities:
            return {}
        
        # Group activities by type
        activity_types = {}
        search_activities = []
        navigation_activities = []
        urls = []
        sessions = set()
        total_engagement = 0
        
        for activity in activities:
            # Count activity types
            activity_type = activity.activity_type
            activity_types[activity_type] = activity_types.get(activity_type, 0) + 1
            
            # Track sessions
            if activity.session_id:
                sessions.add(activity.session_id)
            
            # Track URLs
            if activity.url:
                urls.append(activity.url)
            
            # Track engagement
            total_engagement += activity.engagement_score
            
            # Categorize activities
            if activity.activity_type == 'click' and activity.activity_data.get('isSearchRelated'):
                search_activities.append(activity)
            elif activity.activity_type == 'navigation':
                navigation_activities.append(activity)
        
        # Determine current focus (most recent navigation/page)
        current_focus = None
        if activities:
            recent_activity = activities[0]  # Most recent
            if recent_activity.url and recent_activity.page_title:
                # Calculate time spent (simplified)
                time_spent = 0
                if len(activities) > 1:
                    time_spent = max(1, round((datetime.now() - datetime.fromisoformat(recent_activity.timestamp.replace('Z', '+00:00'))).seconds / 60))
                
                current_focus = {
                    'title': recent_activity.page_title,
                    'url': recent_activity.url,
                    'time_spent': time_spent
                }
        
        # Extract search insights
        recent_searches = []
        for activity in search_activities[:5]:  # Last 5 search activities
            search_text = activity.activity_data.get('text', '').strip()
            if search_text and len(search_text) > 3:
                recent_searches.append(search_text[:50])
        
        # Navigation pattern
        unique_urls = list(dict.fromkeys(urls))  # Preserve order, remove duplicates
        navigation_pattern = []
        for url in unique_urls[:5]:
            try:
                from urllib.parse import urlparse
                domain = urlparse(url).netloc.replace('www.', '')
                if domain not in navigation_pattern:
                    navigation_pattern.append(domain)
            except:
                continue
        
        # Generate insights
        insights = []
        
        # Engagement level
        avg_engagement = total_engagement / len(activities) if activities else 0
        if avg_engagement > 7:
            engagement_level = "High"
            insights.append("User is highly engaged with current content")
        elif avg_engagement > 4:
            engagement_level = "Medium"
            insights.append("User is moderately engaged")
        else:
            engagement_level = "Low"
            insights.append("User appears to be browsing casually")
        
        # Activity patterns
        if activity_types.get('scroll', 0) > activity_types.get('click', 0) * 2:
            insights.append("User is in reading/consuming mode")
        elif activity_types.get('click', 0) > 10:
            insights.append("User is actively interacting and exploring")
        
        if len(search_activities) > 0:
            insights.append("User has been searching - may need information or assistance")
        
        if len(navigation_activities) > 5:
            insights.append("User is actively browsing between different pages")
        
        return {
            'total_activities': len(activities),
            'engagement_level': engagement_level,
            'active_sessions': len(sessions),
            'current_focus': current_focus,
            'recent_searches': recent_searches,
            'navigation_pattern': navigation_pattern,
            'interaction_insights': insights,
            'activity_breakdown': activity_types
        }
    
    def clear_user_activities(self, user_id: str, days_old: int = None) -> Dict[str, Any]:
        """Clear user activities"""
        if days_old is None:
            # Clear all activities
            preferences = UserPreferencesModel.get_by_user_id(user_id)
            days_old = 0 if preferences else 30
        
        deleted_count = BrowserActivityModel.delete_old_activities(user_id, days_old)
        
        return {
            'success': True,
            'deleted_count': deleted_count,
            'message': f'Cleared {deleted_count} activities older than {days_old} days'
        }
    
    def get_tracking_stats(self, user_id: str) -> Dict[str, Any]:
        """Get comprehensive tracking statistics"""
        preferences = UserPreferencesModel.get_by_user_id(user_id)
        if not preferences:
            return {
                'tracking_enabled': False,
                'message': 'No tracking preferences found'
            }
        
        # Get activity statistics
        activities_24h = BrowserActivityModel.get_by_user(user_id, limit=1000, hours_back=24)
        activities_7d = BrowserActivityModel.get_by_user(user_id, limit=5000, hours_back=168)  # 7 days
        
        return {
            'tracking_enabled': preferences.browser_tracking_enabled,
            'preferences': preferences.to_dict(),
            'stats': {
                'activities_last_24h': len(activities_24h),
                'activities_last_7d': len(activities_7d),
                'avg_daily_activities': len(activities_7d) / 7 if activities_7d else 0,
                'last_activity': activities_24h[0].timestamp if activities_24h else None,
                'tracking_since': preferences.created_at
            }
        }

# Global service instance
browser_tracking_service = BrowserTrackingService() 