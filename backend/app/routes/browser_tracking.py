from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.services.browser_tracking_service import browser_tracking_service
from app.models.user import UserModel
from app.utils.logger import get_logger

# Get logger instance
logger = get_logger()

# Create blueprint
browser_tracking_bp = Blueprint('browser_tracking', __name__, url_prefix='/api/browser-tracking')

@browser_tracking_bp.route('/status', methods=['GET'])
@jwt_required()
def get_tracking_status():
    """Get user's browser tracking status and preferences"""
    try:
        user_id = get_jwt_identity()
        if not user_id:
            return jsonify({'error': 'User not authenticated'}), 401
        
        # Get user preferences
        preferences = browser_tracking_service.get_user_preferences(user_id)
        
        # Get tracking stats
        stats = browser_tracking_service.get_tracking_stats(user_id)
        
        return jsonify({
            'success': True,
            'preferences': preferences,
            'stats': stats
        })
        
    except Exception as e:
        logger.error(f"Error getting tracking status: {str(e)}")
        return jsonify({'error': 'Failed to get tracking status'}), 500

@browser_tracking_bp.route('/enable', methods=['POST'])
@jwt_required()
def enable_tracking():
    """Enable browser tracking for user"""
    try:
        user_id = get_jwt_identity()
        if not user_id:
            return jsonify({'error': 'User not authenticated'}), 401
        
        result = browser_tracking_service.enable_tracking(user_id)
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error enabling tracking: {str(e)}")
        return jsonify({'error': 'Failed to enable tracking'}), 500

@browser_tracking_bp.route('/disable', methods=['POST'])
@jwt_required()
def disable_tracking():
    """Disable browser tracking for user"""
    try:
        user_id = get_jwt_identity()
        if not user_id:
            return jsonify({'error': 'User not authenticated'}), 401
        
        result = browser_tracking_service.disable_tracking(user_id)
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error disabling tracking: {str(e)}")
        return jsonify({'error': 'Failed to disable tracking'}), 500

@browser_tracking_bp.route('/settings', methods=['PUT'])
@jwt_required()
def update_tracking_settings():
    """Update user tracking settings"""
    try:
        user_id = get_jwt_identity()
        if not user_id:
            return jsonify({'error': 'User not authenticated'}), 401
        
        data = request.get_json()
        if not data or 'settings' not in data:
            return jsonify({'error': 'Settings data required'}), 400
        
        result = browser_tracking_service.update_tracking_settings(user_id, data['settings'])
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error updating tracking settings: {str(e)}")
        return jsonify({'error': 'Failed to update tracking settings'}), 500

@browser_tracking_bp.route('/activities', methods=['POST'])
@jwt_required()
def store_activities():
    """Store browser activities in bulk"""
    try:
        user_id = get_jwt_identity()
        if not user_id:
            return jsonify({'error': 'User not authenticated'}), 401
        
        data = request.get_json()
        if not data or 'activities' not in data:
            return jsonify({'error': 'Activities data required'}), 400
        
        activities = data['activities']
        if not isinstance(activities, list):
            return jsonify({'error': 'Activities must be a list'}), 400
        
        # Limit bulk size to prevent abuse
        if len(activities) > 100:
            return jsonify({'error': 'Too many activities in single request (max 100)'}), 400
        
        result = browser_tracking_service.store_activities(user_id, activities)
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error storing activities: {str(e)}")
        return jsonify({'error': 'Failed to store activities'}), 500

@browser_tracking_bp.route('/activities', methods=['GET'])
@jwt_required()
def get_activities():
    """Get user activities with filtering options"""
    try:
        user_id = get_jwt_identity()
        if not user_id:
            return jsonify({'error': 'User not authenticated'}), 401
        
        # Get query parameters
        hours_back = request.args.get('hours_back', 24, type=int)
        limit = request.args.get('limit', 100, type=int)
        
        # Validate parameters
        hours_back = min(hours_back, 168)  # Max 7 days
        limit = min(limit, 500)  # Max 500 activities
        
        activities = browser_tracking_service.get_user_activities(user_id, hours_back, limit)
        
        return jsonify({
            'success': True,
            'activities': activities,
            'count': len(activities),
            'hours_back': hours_back,
            'limit': limit
        })
        
    except Exception as e:
        logger.error(f"Error getting activities: {str(e)}")
        return jsonify({'error': 'Failed to get activities'}), 500

@browser_tracking_bp.route('/summary', methods=['GET'])
@jwt_required()
def get_activity_summary():
    """Get activity summary and analytics"""
    try:
        user_id = get_jwt_identity()
        if not user_id:
            return jsonify({'error': 'User not authenticated'}), 401
        
        hours_back = request.args.get('hours_back', 24, type=int)
        hours_back = min(hours_back, 168)  # Max 7 days
        
        summary = browser_tracking_service.get_activity_summary(user_id, hours_back)
        
        return jsonify({
            'success': True,
            'summary': summary
        })
        
    except Exception as e:
        logger.error(f"Error getting activity summary: {str(e)}")
        return jsonify({'error': 'Failed to get activity summary'}), 500

@browser_tracking_bp.route('/context', methods=['GET'])
@jwt_required()
def get_chat_context():
    """Get contextual information for chat enhancement"""
    try:
        user_id = get_jwt_identity()
        if not user_id:
            return jsonify({'error': 'User not authenticated'}), 401
        
        hours_back = request.args.get('hours_back', 2, type=int)
        hours_back = min(hours_back, 24)  # Max 24 hours for context
        
        context = browser_tracking_service.generate_chat_context(user_id, hours_back)
        
        return jsonify({
            'success': True,
            'context': context,
            'has_context': bool(context.strip())
        })
        
    except Exception as e:
        logger.error(f"Error getting chat context: {str(e)}")
        return jsonify({'error': 'Failed to get chat context'}), 500

@browser_tracking_bp.route('/clear', methods=['DELETE'])
@jwt_required()
def clear_activities():
    """Clear user activities"""
    try:
        user_id = get_jwt_identity()
        if not user_id:
            return jsonify({'error': 'User not authenticated'}), 401
        
        # Get query parameter for days old
        days_old = request.args.get('days_old', type=int)
        
        result = browser_tracking_service.clear_user_activities(user_id, days_old)
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error clearing activities: {str(e)}")
        return jsonify({'error': 'Failed to clear activities'}), 500

@browser_tracking_bp.route('/analytics', methods=['GET'])
@jwt_required()
def get_analytics():
    """Get detailed analytics and insights"""
    try:
        user_id = get_jwt_identity()
        if not user_id:
            return jsonify({'error': 'User not authenticated'}), 401
        
        # Get comprehensive tracking stats
        stats = browser_tracking_service.get_tracking_stats(user_id)
        
        # Get summaries for different time periods
        summary_24h = browser_tracking_service.get_activity_summary(user_id, 24)
        summary_7d = browser_tracking_service.get_activity_summary(user_id, 168)
        
        return jsonify({
            'success': True,
            'analytics': {
                'overall_stats': stats,
                'last_24_hours': summary_24h,
                'last_7_days': summary_7d
            }
        })
        
    except Exception as e:
        logger.error(f"Error getting analytics: {str(e)}")
        return jsonify({'error': 'Failed to get analytics'}), 500

# Health check endpoint
@browser_tracking_bp.route('/health', methods=['GET'])
def health_check():
    """Health check for browser tracking service"""
    return jsonify({
        'status': 'healthy',
        'service': 'browser-tracking',
        'timestamp': browser_tracking_service.__class__.__name__
    }) 