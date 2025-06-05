from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
from app.models.browser_activity import BrowserActivityModel
from app.models.user_preferences import UserPreferencesModel
from app.models.user import UserModel
import json
import logging
from app.utils.logger import get_logger

# Get logger instance
logger = get_logger()

class BrowserTrackingService:
    """Service for managing browser activity tracking and context generation"""
    
    def __init__(self):
        self.max_context_activities = 100  # Increased for better cross-tab context
        self.context_hours_back = 4  # Increased to 4 hours for cross-tab context
        self.cross_tab_sync_interval = 5  # Sync interval in seconds
        
        # In-memory fallback storage when Weaviate is not available
        self.fallback_storage = {
            'activities': {},  # user_id: [activities]
            'preferences': {}  # user_id: preferences
        }
        self.use_fallback = False
        
    def _check_weaviate_available(self):
        """Check if Weaviate is available"""
        try:
            from app.services.weaviate_service import weaviate_service
            # Try a simple operation to check if Weaviate is working
            test_result = weaviate_service.query_objects('User', limit=1)
            return True
        except Exception as e:
            logger.warning(f"Weaviate not available, using fallback storage: {str(e)}")
            self.use_fallback = True
            return False
    
    def is_tracking_enabled(self, user_id: str) -> bool:
        """Check if tracking is enabled for user with fallback support"""
        if not self._check_weaviate_available():
            # Use fallback storage
            prefs = self._get_user_preferences_fallback(user_id)
            return prefs.get('browser_tracking_enabled', True)  # Default to True for testing
            
        try:
            preferences = UserPreferencesModel.get_by_user_id(user_id)
            return preferences.browser_tracking_enabled if preferences else True  # Default to True
        except Exception as e:
            logger.warning(f"Error checking tracking status, defaulting to enabled: {str(e)}")
            return True
    
    def get_user_preferences(self, user_id: str) -> Dict[str, Any]:
        """Get user tracking preferences with fallback support"""
        if not self._check_weaviate_available():
            return self._get_user_preferences_fallback(user_id)
            
        try:
            preferences = UserPreferencesModel.get_or_create(user_id)
            return preferences.to_dict() if preferences else {
                'browser_tracking_enabled': False,
                'tracking_settings': {},
                'user_id': user_id
            }
        except Exception as e:
            logger.error(f"Error getting user preferences: {str(e)}")
            return self._get_user_preferences_fallback(user_id)
    
    def _get_user_preferences_fallback(self, user_id: str) -> Dict[str, Any]:
        """Get user preferences from fallback storage"""
        if user_id in self.fallback_storage['preferences']:
            return self.fallback_storage['preferences'][user_id]
        
        # Return default preferences
        default_prefs = {
            'id': f'fallback_{user_id}',
            'user_id': user_id,
            'browser_tracking_enabled': True,  # Default to enabled for testing
            'tracking_settings': {
                'track_clicks': True,
                'track_navigation': True,
                'track_scroll': True,
                'track_focus': True,
                'retention_days': 30,
                'max_activities_per_session': 200
            },
            'created_at': datetime.utcnow().isoformat() + 'Z',
            'updated_at': datetime.utcnow().isoformat() + 'Z'
        }
        
        self.fallback_storage['preferences'][user_id] = default_prefs
        return default_prefs
    
    def enable_tracking(self, user_id: str) -> Dict[str, Any]:
        """Enable tracking for user with fallback support"""
        if not self._check_weaviate_available():
            return self._enable_tracking_fallback(user_id)
            
        try:
            preferences = UserPreferencesModel.get_or_create(user_id)
            preferences.update_tracking_enabled(True)
            
            return {
                'success': True,
                'message': 'Browser tracking enabled',
                'preferences': preferences.to_dict()
            }
        except Exception as e:
            logger.error(f"Error enabling tracking: {str(e)}")
            return self._enable_tracking_fallback(user_id)
    
    def _enable_tracking_fallback(self, user_id: str) -> Dict[str, Any]:
        """Enable tracking in fallback storage"""
        prefs = self._get_user_preferences_fallback(user_id)
        prefs['browser_tracking_enabled'] = True
        prefs['updated_at'] = datetime.utcnow().isoformat() + 'Z'
        self.fallback_storage['preferences'][user_id] = prefs
        
        return {
            'success': True,
            'message': 'Browser tracking enabled (fallback mode)',
            'preferences': prefs,
            'using_fallback': True
        }
    
    def disable_tracking(self, user_id: str) -> Dict[str, Any]:
        """Disable browser tracking for user"""
        preferences = UserPreferencesModel.get_or_create(user_id)
        success = preferences.update_tracking_enabled(False)
        
        return {
            'success': success,
            'enabled': False,
            'cross_tab_enabled': False,
            'message': 'Browser tracking disabled successfully'
        }
    
    def update_tracking_settings(self, user_id: str, settings: Dict) -> Dict[str, Any]:
        """Update user tracking settings"""
        preferences = UserPreferencesModel.get_or_create(user_id)
        
        # Handle cross-tab specific settings
        if 'cross_tab_tracking' in settings:
            settings['browser_tracking_enabled'] = settings['cross_tab_tracking']
        
        success = preferences.update_tracking_settings(settings)
        
        updated_settings = preferences.tracking_settings
        updated_settings['cross_tab_tracking'] = preferences.browser_tracking_enabled
        
        return {
            'success': success,
            'settings': updated_settings,
            'message': 'Enhanced tracking settings updated successfully' if success else 'Failed to update settings'
        }
    
    def store_activities(self, user_id: str, activities: List[Dict]) -> Dict[str, Any]:
        """Store browser activities with fallback support"""
        if not self._check_weaviate_available():
            return self._store_activities_fallback(user_id, activities)
            
        try:
            stored_count = 0
            errors = []
            validation_failures = 0
            
            logger.info(f"Processing {len(activities)} activities for user {user_id}")
            
            # Validate and store each activity
            for i, activity_data in enumerate(activities):
                try:
                    # Validate and enhance activity
                    validated_activity = self._validate_and_enhance_activity(user_id, activity_data)
                    if not validated_activity:
                        validation_failures += 1
                        errors.append(f"Activity {i}: validation failed")
                        logger.debug(f"Validation failed for activity {i}: {activity_data}")
                        continue
                    
                    # Create activity using model
                    activity = BrowserActivityModel.create(
                        user_id=user_id,
                        activity_type=validated_activity['activity_type'],
                        activity_data=validated_activity['activity_data'],
                        url=validated_activity.get('url'),
                        page_title=validated_activity.get('page_title'),
                        session_id=validated_activity.get('session_id'),
                        engagement_score=validated_activity.get('engagement_score', 0.0)
                    )
                    
                    if activity:
                        stored_count += 1
                    else:
                        errors.append(f"Activity {i}: failed to create in database")
                        
                except Exception as e:
                    errors.append(f"Activity {i}: error processing - {str(e)}")
                    logger.error(f"Error processing activity {i}: {str(e)}")
                    continue
            
            # Log success
            logger.info(f"Stored {stored_count}/{len(activities)} browser activities for user {user_id} (validation failures: {validation_failures})")
            
            return {
                'success': True,
                'stored_count': stored_count,
                'total_received': len(activities),
                'validation_failures': validation_failures,
                'errors': errors[:10] if errors else None,  # Limit errors for response size
                'has_errors': len(errors) > 0,
                'message': f'Successfully stored {stored_count} activities' if stored_count > 0 else 'No activities were stored'
            }
            
        except Exception as e:
            logger.error(f"Error storing activities for user {user_id}: {str(e)}", exc_info=True)
            return {
                'success': False,
                'error': 'Failed to store activities',
                'stored_count': 0,
                'total_received': len(activities),
                'message': str(e)
            }
    
    def _store_activities_fallback(self, user_id: str, activities: List[Dict]) -> Dict[str, Any]:
        """Store activities in fallback memory storage"""
        try:
            if user_id not in self.fallback_storage['activities']:
                self.fallback_storage['activities'][user_id] = []
            
            stored_count = 0
            errors = []
            
            for activity_data in activities:
                try:
                    # Validate and enhance activity
                    validated_activity = self._validate_and_enhance_activity(user_id, activity_data)
                    if validated_activity:
                        # Add to fallback storage
                        fallback_activity = {
                            'id': f"fallback_{datetime.utcnow().timestamp()}_{stored_count}",
                            'user_id': user_id,
                            'activity_type': validated_activity['activity_type'],
                            'activity_data': validated_activity['activity_data'],
                            'url': validated_activity.get('url'),
                            'page_title': validated_activity.get('page_title'),
                            'timestamp': validated_activity.get('timestamp', datetime.utcnow().isoformat() + 'Z'),
                            'session_id': validated_activity.get('session_id'),
                            'engagement_score': validated_activity.get('engagement_score', 0.0)
                        }
                        
                        self.fallback_storage['activities'][user_id].append(fallback_activity)
                        stored_count += 1
                        
                        # Keep only recent activities (last 1000)
                        if len(self.fallback_storage['activities'][user_id]) > 1000:
                            self.fallback_storage['activities'][user_id] = self.fallback_storage['activities'][user_id][-1000:]
                            
                except Exception as e:
                    errors.append(f"Error processing activity: {str(e)}")
                    continue
            
            logger.info(f"Stored {stored_count} activities in fallback storage for user {user_id}")
            
            return {
                'success': True,
                'stored_count': stored_count,
                'total_received': len(activities),
                'errors': errors[:5] if errors else None,
                'has_errors': len(errors) > 0,
                'using_fallback': True
            }
            
        except Exception as e:
            logger.error(f"Error in fallback storage for user {user_id}: {str(e)}")
            return {
                'success': False,
                'error': 'Failed to store activities in fallback',
                'stored_count': 0,
                'total_received': len(activities),
                'using_fallback': True
            }
    
    def _validate_and_enhance_activity(self, user_id: str, activity_data: Dict) -> Dict:
        """Validate and enhance activity data with cross-tab support"""
        try:
            # Ensure we have a valid dictionary
            if not isinstance(activity_data, dict):
                logger.warning(f"Invalid activity data type: {type(activity_data)}")
                return None
            
            # Log the raw activity data for debugging
            logger.debug(f"Raw activity data keys: {list(activity_data.keys())}")
            
            # Check required fields - be more flexible about structure
            activity_type = (activity_data.get('activity_type') or 
                           activity_data.get('type') or 
                           activity_data.get('activityType') or
                           'unknown_activity')
            
            data_content = (activity_data.get('activity_data') or 
                          activity_data.get('data') or 
                          activity_data.get('activityData') or 
                          {})
            
            # Ensure data_content is a dictionary
            if not isinstance(data_content, dict):
                if isinstance(data_content, str):
                    try:
                        import json
                        data_content = json.loads(data_content)
                    except:
                        data_content = {'raw_data': data_content}
                else:
                    data_content = {'content': str(data_content) if data_content is not None else ''}
            
            # Validate and set cross-tab specific fields with fallbacks
            tab_id = (activity_data.get('tab_id') or 
                     data_content.get('tab_id') or 
                     activity_data.get('tabId') or 
                     'default_tab')
            
            session_id = (activity_data.get('session_id') or 
                         data_content.get('session_id') or 
                         activity_data.get('sessionId') or 
                         'default_session')
            
            # Extract URL and page title from various possible locations
            url = (activity_data.get('url') or 
                   data_content.get('url') or 
                   data_content.get('current_url') or 
                   data_content.get('newUrl') or 
                   activity_data.get('current_url') or 
                   activity_data.get('href') or '')
            
            page_title = (activity_data.get('page_title') or 
                         data_content.get('page_title') or 
                         data_content.get('title') or 
                         data_content.get('newTitle') or 
                         activity_data.get('title') or 
                         activity_data.get('pageTitle') or '')
            
            # Ensure strings are not too long and are valid strings
            if url and not isinstance(url, str):
                url = str(url)
            if url and len(url) > 2000:
                url = url[:2000]
            
            if page_title and not isinstance(page_title, str):
                page_title = str(page_title)
            if page_title and len(page_title) > 500:
                page_title = page_title[:500]
            
            # Calculate engagement score
            engagement_score = activity_data.get('engagement_score', 0.0)
            if not isinstance(engagement_score, (int, float)):
                try:
                    engagement_score = float(engagement_score)
                except:
                    engagement_score = 0.0
            
            # Get timestamp
            timestamp = (activity_data.get('timestamp') or 
                        activity_data.get('created_at') or 
                        datetime.utcnow().isoformat() + 'Z')
            
            # Ensure timestamp is a string
            if not isinstance(timestamp, str):
                timestamp = datetime.utcnow().isoformat() + 'Z'
            
            # Build the validated activity
            validated_activity = {
                'activity_type': str(activity_type),
                'activity_data': data_content,
                'url': str(url) if url else '',
                'page_title': str(page_title) if page_title else '',
                'tab_id': str(tab_id),
                'session_id': str(session_id),
                'engagement_score': float(engagement_score),
                'timestamp': timestamp,
                'user_id': user_id,
                'is_cross_tab': True
            }
            
            logger.debug(f"Validated activity: {activity_type} for user {user_id}")
            return validated_activity
            
        except Exception as e:
            logger.error(f"Error validating activity: {e}")
            logger.debug(f"Failed activity data: {activity_data}")
            return None
    
    def get_user_activities(self, user_id: str, hours_back: int = 24, 
                           limit: int = 100, include_cross_tab: bool = True) -> List[Dict[str, Any]]:
        """Get user activities within time frame with cross-tab support"""
        if not self.is_tracking_enabled(user_id):
            return []
        
        activities = BrowserActivityModel.get_by_user(user_id, limit, hours_back)
        
        activity_list = []
        for activity in activities:
            activity_dict = activity.to_dict()
            
            # Add cross-tab metadata
            activity_data = activity_dict.get('activity_data', {})
            activity_dict['is_cross_tab'] = activity_data.get('is_cross_tab', True)
            activity_dict['tab_id'] = activity_data.get('tab_id', 'unknown')
            activity_dict['session_id'] = activity_data.get('session_id', 'unknown')
            
            activity_list.append(activity_dict)
        
        return activity_list
    
    def get_activity_summary(self, user_id: str, hours_back: int = 24) -> Dict[str, Any]:
        """Get detailed activity summary for user with cross-tab analytics"""
        if not self.is_tracking_enabled(user_id):
            return {
                'tracking_enabled': False,
                'cross_tab_enabled': False,
                'message': 'Browser tracking is disabled'
            }
        
        summary = BrowserActivityModel.get_activity_summary(user_id, hours_back)
        summary['tracking_enabled'] = True
        summary['cross_tab_enabled'] = True
        
        # Add cross-tab specific analytics
        activities = self.get_user_activities(user_id, hours_back, limit=500)
        
        # Analyze cross-tab patterns
        tab_analysis = self._analyze_cross_tab_patterns(activities)
        summary.update(tab_analysis)
        
        return summary
    
    def _analyze_cross_tab_patterns(self, activities: List[Dict]) -> Dict[str, Any]:
        """Analyze cross-tab usage patterns"""
        if not activities:
            return {
                'unique_tabs': 0,
                'unique_sessions': 0,
                'tab_switches': 0,
                'concurrent_tabs': 0,
                'most_active_tab': None,
                'session_distribution': {}
            }
        
        tab_ids = set()
        session_ids = set()
        tab_activity_count = {}
        session_activity_count = {}
        last_tab = None
        tab_switches = 0
        
        for activity in activities:
            tab_id = activity.get('tab_id', 'unknown')
            session_id = activity.get('session_id', 'unknown')
            
            tab_ids.add(tab_id)
            session_ids.add(session_id)
            
            tab_activity_count[tab_id] = tab_activity_count.get(tab_id, 0) + 1
            session_activity_count[session_id] = session_activity_count.get(session_id, 0) + 1
            
            if last_tab and last_tab != tab_id:
                tab_switches += 1
            last_tab = tab_id
        
        most_active_tab = max(tab_activity_count.items(), key=lambda x: x[1])[0] if tab_activity_count else None
        
        return {
            'unique_tabs': len(tab_ids),
            'unique_sessions': len(session_ids),
            'tab_switches': tab_switches,
            'concurrent_tabs': len(tab_ids),
            'most_active_tab': most_active_tab,
            'session_distribution': session_activity_count,
            'tab_distribution': tab_activity_count
        }
    
    def generate_chat_context(self, user_id: str, hours_back: int = None) -> str:
        """Generate enhanced contextual information for chat responses with cross-tab awareness"""
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
        
        return self._build_enhanced_context_string(activities, hours_back)
    
    def _build_enhanced_context_string(self, activities: List[BrowserActivityModel], hours_back: int) -> str:
        """Build enhanced contextual information string from cross-tab activities"""
        if not activities:
            return ""
        
        # Analyze activities with cross-tab awareness
        context_data = self._analyze_enhanced_activities(activities)
        
        # Build enhanced context string
        context_parts = [
            f"🌐 **Enhanced Browser Context** (last {hours_back} hours across all tabs):",
            "",
            f"📊 **Cross-Tab Activity Summary:**",
            f"• Total interactions: {context_data['total_activities']}",
            f"• Active tabs: {context_data['unique_tabs']}",
            f"• Tab switches: {context_data['tab_switches']}",
            f"• Engagement level: {context_data['engagement_level']}",
            f"• Multi-tasking score: {context_data['multitasking_score']}"
        ]
        
        if context_data['current_focus']:
            context_parts.extend([
                "",
                f"🎯 **Current Focus (Most Active Tab):**",
                f"• Page: {context_data['current_focus']['title']}",
                f"• URL: {context_data['current_focus']['url'][:60]}{'...' if len(context_data['current_focus']['url']) > 60 else ''}",
                f"• Time on page: {context_data['current_focus']['time_spent']}m",
                f"• Tab activity: {context_data['current_focus']['activity_count']} interactions"
            ])
        
        if context_data['concurrent_work']:
            context_parts.extend([
                "",
                f"🔄 **Concurrent Work Patterns:**",
                f"• Working across {len(context_data['concurrent_work'])} tabs",
                *[f"• {work['title'][:40]}... ({work['activity_count']} interactions)" 
                  for work in context_data['concurrent_work'][:3]]
            ])
        
        if context_data['recent_searches']:
            context_parts.extend([
                "",
                f"🔍 **Recent Search Activity (Cross-Tab):**",
                *[f"• {search}" for search in context_data['recent_searches'][:4]]
            ])
        
        if context_data['navigation_pattern']:
            context_parts.extend([
                "",
                f"🧭 **Multi-Tab Navigation Pattern:**",
                f"• Total sites: {len(context_data['navigation_pattern'])}",
                *[f"• {site}" for site in context_data['navigation_pattern'][:4]]
            ])
        
        if context_data['work_context']:
            context_parts.extend([
                "",
                f"💼 **Inferred Work Context:**",
                *[f"• {context}" for context in context_data['work_context']]
            ])
        
        if context_data['interaction_insights']:
            context_parts.extend([
                "",
                f"💡 **Enhanced Behavior Insights:**",
                *[f"• {insight}" for insight in context_data['interaction_insights']]
            ])
        
        context_parts.extend([
            "",
            "🤖 **AI Instructions:** Use this comprehensive cross-tab context to provide highly personalized, context-aware responses. Consider the user's multitasking patterns, current focus areas, and concurrent work activities."
        ])
        
        return "\n".join(context_parts)
    
    def _analyze_enhanced_activities(self, activities: List[BrowserActivityModel]) -> Dict[str, Any]:
        """Analyze activities with enhanced cross-tab awareness"""
        if not activities:
            return {}
        
        # Enhanced activity analysis with cross-tab data
        activity_types = {}
        search_activities = []
        navigation_activities = []
        urls = []
        tab_activities = {}
        session_activities = {}
        total_engagement = 0
        
        for activity in activities:
            # Parse activity data
            activity_type = activity.activity_type
            activity_types[activity_type] = activity_types.get(activity_type, 0) + 1
            
            try:
                activity_data = json.loads(activity.activity_data) if isinstance(activity.activity_data, str) else activity.activity_data
            except:
                activity_data = {}
            
            # Extract cross-tab information
            tab_id = activity_data.get('tab_id', 'unknown')
            session_id = activity_data.get('session_id', 'unknown')
            
            if tab_id not in tab_activities:
                tab_activities[tab_id] = {
                    'count': 0,
                    'urls': set(),
                    'titles': set(),
                    'last_activity': None,
                    'engagement_score': 0
                }
            
            tab_activities[tab_id]['count'] += 1
            tab_activities[tab_id]['last_activity'] = activity.timestamp
            
            # Track session activities
            if session_id not in session_activities:
                session_activities[session_id] = {'count': 0, 'tabs': set()}
            session_activities[session_id]['count'] += 1
            session_activities[session_id]['tabs'].add(tab_id)
            
            # Extract URL and search information
            url = activity_data.get('url', activity_data.get('current_url', ''))
            title = activity_data.get('title', activity_data.get('page_title', ''))
            
            if url:
                urls.append(url)
                tab_activities[tab_id]['urls'].add(url)
            if title:
                tab_activities[tab_id]['titles'].add(title)
            
            # Enhanced search detection
            if self._is_search_activity(activity_type, activity_data):
                search_text = self._extract_search_query(activity_data)
                if search_text:
                    search_activities.append(search_text)
            
            # Enhanced navigation tracking
            if activity_type in ['navigation', 'page_visit', 'tab_switch']:
                navigation_activities.append({
                    'url': url,
                    'title': title,
                    'tab_id': tab_id,
                    'timestamp': activity.timestamp
                })
            
            # Calculate engagement score
            engagement_score = self._calculate_activity_engagement(activity_type, activity_data)
            total_engagement += engagement_score
            tab_activities[tab_id]['engagement_score'] += engagement_score
        
        # Find most active tab (current focus)
        most_active_tab = None
        if tab_activities:
            most_active_tab_id = max(tab_activities.keys(), key=lambda x: tab_activities[x]['count'])
            most_active_tab_data = tab_activities[most_active_tab_id]
            
            if most_active_tab_data['urls'] and most_active_tab_data['titles']:
                most_active_tab = {
                    'tab_id': most_active_tab_id,
                    'url': list(most_active_tab_data['urls'])[-1],  # Most recent URL
                    'title': list(most_active_tab_data['titles'])[-1],  # Most recent title
                    'activity_count': most_active_tab_data['count'],
                    'time_spent': self._estimate_time_spent(most_active_tab_data),
                    'engagement_score': most_active_tab_data['engagement_score']
                }
        
        # Find concurrent work patterns
        concurrent_work = []
        for tab_id, tab_data in tab_activities.items():
            if tab_data['count'] > 5 and tab_data['urls'] and tab_data['titles']:  # Active tabs
                concurrent_work.append({
                    'tab_id': tab_id,
                    'title': list(tab_data['titles'])[-1],
                    'url': list(tab_data['urls'])[-1],
                    'activity_count': tab_data['count'],
                    'engagement_score': tab_data['engagement_score']
                })
        
        # Sort by activity count
        concurrent_work.sort(key=lambda x: x['activity_count'], reverse=True)
        
        # Calculate multitasking score
        multitasking_score = self._calculate_multitasking_score(tab_activities, session_activities)
        
        # Infer work context
        work_context = self._infer_work_context(navigation_activities, search_activities)
        
        # Generate insights
        insights = self._generate_enhanced_insights(
            tab_activities, 
            session_activities, 
            search_activities, 
            navigation_activities,
            multitasking_score
        )
        
        return {
            'total_activities': len(activities),
            'unique_tabs': len(tab_activities),
            'unique_sessions': len(session_activities),
            'tab_switches': self._count_tab_switches(activities),
            'engagement_level': self._categorize_engagement(total_engagement / len(activities) if activities else 0),
            'multitasking_score': multitasking_score,
            'current_focus': most_active_tab,
            'concurrent_work': concurrent_work,
            'recent_searches': list(set(search_activities))[-5:],  # Last 5 unique searches
            'navigation_pattern': list(set([self._extract_domain(url) for url in urls if url]))[-5:],
            'work_context': work_context,
            'interaction_insights': insights,
            'tab_distribution': {tab_id: data['count'] for tab_id, data in tab_activities.items()},
            'session_distribution': {session_id: data['count'] for session_id, data in session_activities.items()}
        }
    
    def _calculate_multitasking_score(self, tab_activities: Dict, session_activities: Dict) -> float:
        """Calculate a multitasking score based on tab and session patterns"""
        if not tab_activities:
            return 0.0
        
        # Base score from number of active tabs
        active_tabs = len([tab for tab, data in tab_activities.items() if data['count'] > 3])
        tab_score = min(active_tabs / 5.0, 1.0)  # Normalized to 0-1
        
        # Session complexity score
        session_complexity = len(session_activities) * 0.2
        
        # Tab switch frequency (estimated)
        total_activities = sum(data['count'] for data in tab_activities.values())
        switch_frequency = len(tab_activities) / total_activities if total_activities > 0 else 0
        
        # Combine scores
        multitasking_score = (tab_score * 0.5 + session_complexity * 0.3 + switch_frequency * 0.2) * 10
        return min(multitasking_score, 10.0)  # Cap at 10
    
    def _infer_work_context(self, navigation_activities: List[Dict], search_activities: List[str]) -> List[str]:
        """Infer work context from navigation and search patterns"""
        work_contexts = []
        
        # Analyze domains for work patterns
        domains = [self._extract_domain(nav.get('url', '')) for nav in navigation_activities]
        domain_counts = {}
        for domain in domains:
            if domain:
                domain_counts[domain] = domain_counts.get(domain, 0) + 1
        
        # Identify work-related domains
        work_domains = ['github.com', 'stackoverflow.com', 'docs.', 'atlassian.com', 'slack.com', 
                       'teams.microsoft.com', 'zoom.us', 'notion.so', 'figma.com', 'aws.amazon.com']
        
        for domain, count in domain_counts.items():
            if any(work_domain in domain for work_domain in work_domains) and count > 2:
                work_contexts.append(f"Active on {domain} ({count} visits)")
        
        # Analyze search queries for work-related content
        work_keywords = ['api', 'documentation', 'tutorial', 'how to', 'error', 'programming', 
                        'development', 'code', 'software', 'technical', 'framework', 'library']
        
        work_searches = [search for search in search_activities 
                        if any(keyword in search.lower() for keyword in work_keywords)]
        
        if work_searches:
            work_contexts.append(f"Technical searches: {len(work_searches)} queries")
        
        # Limit to most relevant contexts
        return work_contexts[:3]
    
    def _generate_enhanced_insights(self, tab_activities: Dict, session_activities: Dict, 
                                  search_activities: List[str], navigation_activities: List[Dict],
                                  multitasking_score: float) -> List[str]:
        """Generate enhanced behavioral insights"""
        insights = []
        
        # Multitasking insights
        if multitasking_score > 7:
            insights.append("Heavy multitasker - works across many tabs simultaneously")
        elif multitasking_score > 4:
            insights.append("Moderate multitasker - balances focused and multi-tab work")
        else:
            insights.append("Focused worker - prefers single-tab concentration")
        
        # Tab usage patterns
        active_tabs = len([tab for tab, data in tab_activities.items() if data['count'] > 5])
        if active_tabs > 5:
            insights.append(f"Managing {active_tabs} active workstreams concurrently")
        
        # Search behavior
        if len(search_activities) > 10:
            insights.append("High research activity - frequently seeking information")
        elif len(search_activities) > 5:
            insights.append("Moderate research activity - occasional information seeking")
        
        # Session complexity
        if len(session_activities) > 3:
            insights.append("Complex browsing sessions - likely working on multiple projects")
        
        return insights[:4]  # Limit to most relevant insights
    
    def _is_search_activity(self, activity_type: str, activity_data: Dict) -> bool:
        """Enhanced search activity detection"""
        if activity_type == 'search':
            return True
        
        url = activity_data.get('url', activity_data.get('current_url', ''))
        search_indicators = ['google.com/search', 'bing.com/search', 'duckduckgo.com', 
                           'stackoverflow.com/search', 'github.com/search']
        
        return any(indicator in url for indicator in search_indicators)
    
    def _extract_search_query(self, activity_data: Dict) -> str:
        """Extract search query from activity data"""
        # Try different possible fields for search query
        query_fields = ['search_query', 'query', 'q', 'search_term', 'search_text']
        
        for field in query_fields:
            if field in activity_data and activity_data[field]:
                return activity_data[field][:100]  # Limit length
        
        # Try to extract from URL
        url = activity_data.get('url', '')
        if 'q=' in url:
            try:
                import urllib.parse
                parsed_url = urllib.parse.urlparse(url)
                query_params = urllib.parse.parse_qs(parsed_url.query)
                if 'q' in query_params:
                    return query_params['q'][0][:100]
            except:
                pass
        
        return ""
    
    def _calculate_activity_engagement(self, activity_type: str, activity_data: Dict) -> float:
        """Calculate engagement score for an activity"""
        # Base scores for different activity types
        engagement_scores = {
            'click': 1.0,
            'scroll': 0.5,
            'type': 2.0,
            'search': 2.5,
            'navigation': 1.5,
            'page_visit': 1.0,
            'tab_switch': 0.8,
            'focus': 0.3,
            'blur': 0.1
        }
        
        base_score = engagement_scores.get(activity_type, 1.0)
        
        # Modify based on activity data
        if activity_data.get('duration', 0) > 30:  # Long duration
            base_score *= 1.5
        if activity_data.get('is_search_related', False):
            base_score *= 1.3
        
        return base_score
    
    def _estimate_time_spent(self, tab_data: Dict) -> int:
        """Estimate time spent on a tab based on activity"""
        # Simple estimation based on activity count
        activity_count = tab_data.get('count', 0)
        engagement_score = tab_data.get('engagement_score', 0)
        
        # Rough estimation: more activities = more time
        estimated_minutes = min(activity_count * 0.5 + engagement_score * 0.2, 120)  # Cap at 2 hours
        return max(int(estimated_minutes), 1)
    
    def _count_tab_switches(self, activities: List[BrowserActivityModel]) -> int:
        """Count tab switches in activity list"""
        if not activities:
            return 0
        
        tab_switches = 0
        last_tab = None
        
        for activity in activities:
            try:
                activity_data = json.loads(activity.activity_data) if isinstance(activity.activity_data, str) else activity.activity_data
                current_tab = activity_data.get('tab_id', 'unknown')
                
                if last_tab and last_tab != current_tab:
                    tab_switches += 1
                
                last_tab = current_tab
            except:
                continue
        
        return tab_switches
    
    def _categorize_engagement(self, avg_engagement: float) -> str:
        """Categorize engagement level"""
        if avg_engagement >= 2.5:
            return "Very High"
        elif avg_engagement >= 2.0:
            return "High"
        elif avg_engagement >= 1.5:
            return "Moderate"
        elif avg_engagement >= 1.0:
            return "Low"
        else:
            return "Very Low"
    
    def _extract_domain(self, url: str) -> str:
        """Extract domain from URL"""
        if not url:
            return ""
        
        try:
            import urllib.parse
            parsed = urllib.parse.urlparse(url)
            return parsed.netloc.lower()
        except:
            return ""

    def clear_user_activities(self, user_id: str, days_old: int = None) -> Dict[str, Any]:
        """Clear user activities with enhanced response"""
        if not self.is_tracking_enabled(user_id):
            return {
                'success': False,
                'message': 'Tracking not enabled for this user',
                'cleared_count': 0
            }
        
        # Clear activities
        cleared_count = BrowserActivityModel.clear_user_activities(user_id, days_old)
        
        return {
            'success': True,
            'cleared_count': cleared_count,
            'cross_tab_data_cleared': True,
            'message': f'Cleared {cleared_count} cross-tab activities'
        }
    
    def get_tracking_stats(self, user_id: str) -> Dict[str, Any]:
        """Get enhanced tracking statistics"""
        if not self.is_tracking_enabled(user_id):
            return {
                'enabled': False,
                'cross_tab_enabled': False,
                'message': 'Tracking is disabled'
            }
        
        # Get base stats
        activities = self.get_user_activities(user_id, hours_back=24, limit=1000)
        
        # Calculate enhanced stats
        stats = {
            'enabled': True,
            'cross_tab_enabled': True,
            'total_activities_24h': len(activities),
            'unique_tabs': len(set(act.get('tab_id', 'unknown') for act in activities)),
            'unique_sessions': len(set(act.get('session_id', 'unknown') for act in activities)),
            'tab_switches': self._count_tab_switches_from_dicts(activities),
            'last_activity': activities[0]['timestamp'] if activities else None,
            'multitasking_score': self._calculate_multitasking_from_activities(activities),
            'storage_estimate': len(str(activities)) if activities else 0
        }
        
        return stats
    
    def _count_tab_switches_from_dicts(self, activities: List[Dict]) -> int:
        """Count tab switches from activity dictionaries"""
        if not activities:
            return 0
        
        tab_switches = 0
        last_tab = None
        
        for activity in activities:
            current_tab = activity.get('tab_id', 'unknown')
            if last_tab and last_tab != current_tab:
                tab_switches += 1
            last_tab = current_tab
        
        return tab_switches
    
    def _calculate_multitasking_from_activities(self, activities: List[Dict]) -> float:
        """Calculate multitasking score from activity list"""
        if not activities:
            return 0.0
        
        unique_tabs = len(set(act.get('tab_id', 'unknown') for act in activities))
        unique_sessions = len(set(act.get('session_id', 'unknown') for act in activities))
        
        # Simple multitasking score
        return min((unique_tabs * 1.5 + unique_sessions * 0.5), 10.0)

# Create global instance
browser_tracking_service = BrowserTrackingService() 