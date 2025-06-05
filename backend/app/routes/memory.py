from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from functools import wraps
import traceback
from typing import Dict, List, Optional, Any

from app.services.memory_service import memory_service

memory_bp = Blueprint('memory', __name__, url_prefix='/memory')

def handle_errors(f):
    """Decorator to handle common errors and format responses"""
    @wraps(f)
    def wrapper(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except ValueError as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 400
        except Exception as e:
            current_app.logger.error(f"Error in {f.__name__}: {str(e)}")
            current_app.logger.error(traceback.format_exc())
            return jsonify({
                'success': False,
                'error': 'Internal server error'
            }), 500
    return wrapper

def get_user_id() -> str:
    """Get user ID from JWT token"""
    return get_jwt_identity()

@memory_bp.route('/summary', methods=['GET'])
@jwt_required()
@handle_errors
def get_memory_summary():
    """Get a natural language summary of user's stored memory"""
    user_id = get_user_id()
    
    summary = memory_service.get_memory_summary(user_id)
    
    return jsonify({
        'success': True,
        'summary': summary
    })

@memory_bp.route('/data', methods=['GET'])
@jwt_required()
@handle_errors
def get_memory_data():
    """Get all memory data for the user"""
    user_id = get_user_id()
    category = request.args.get('category')
    
    memory_data = memory_service.get_user_memory(user_id, category)
    
    return jsonify({
        'success': True,
        'memory_data': memory_data or {},
        'category': category
    })

@memory_bp.route('/search', methods=['POST'])
@jwt_required()
@handle_errors
def search_memory():
    """Search user memory for specific information"""
    data = request.get_json()
    if not data:
        raise ValueError('No data provided')
    
    query = data.get('query', '').strip()
    if not query:
        raise ValueError('Search query is required')
    
    category = data.get('category')
    user_id = get_user_id()
    
    results = memory_service.search_memory(user_id, query, category)
    
    return jsonify({
        'success': True,
        'results': results,
        'query': query,
        'category': category
    })

@memory_bp.route('/store', methods=['POST'])
@jwt_required()
@handle_errors
def store_memory():
    """Manually store memory information"""
    data = request.get_json()
    if not data:
        raise ValueError('No data provided')
    
    memory_data = data.get('memory_data')
    if not memory_data:
        raise ValueError('Memory data is required')
    
    source = data.get('source', 'manual')
    user_id = get_user_id()
    
    success = memory_service.store_memory(user_id, memory_data, source)
    
    return jsonify({
        'success': success,
        'message': 'Memory stored successfully' if success else 'Failed to store memory'
    })

@memory_bp.route('/update', methods=['PUT'])
@jwt_required()
@handle_errors
def update_memory():
    """Update specific memory entry"""
    data = request.get_json()
    if not data:
        raise ValueError('No data provided')
    
    category = data.get('category')
    old_value = data.get('old_value')
    new_value = data.get('new_value')
    
    if not all([category, old_value, new_value]):
        raise ValueError('Category, old_value, and new_value are required')
    
    user_id = get_user_id()
    
    success = memory_service.update_memory(user_id, category, old_value, new_value)
    
    return jsonify({
        'success': success,
        'message': 'Memory updated successfully' if success else 'Failed to update memory'
    })

@memory_bp.route('/delete', methods=['DELETE'])
@jwt_required()
@handle_errors
def delete_memory():
    """Delete user memory (category or all)"""
    category = request.args.get('category')
    user_id = get_user_id()
    
    success = memory_service.delete_memory(user_id, category)
    
    message = f"Memory {'category' if category else 'data'} deleted successfully" if success else "Failed to delete memory"
    
    return jsonify({
        'success': success,
        'message': message,
        'category': category
    })

@memory_bp.route('/extract', methods=['POST'])
@jwt_required()
@handle_errors
def extract_memory_from_text():
    """Extract memory information from text without storing it"""
    data = request.get_json()
    if not data:
        raise ValueError('No data provided')
    
    text = data.get('text', '').strip()
    if not text:
        raise ValueError('Text is required')
    
    extracted_memory = memory_service.extract_memory_from_message(text)
    
    return jsonify({
        'success': True,
        'extracted_memory': extracted_memory,
        'text': text
    })

@memory_bp.route('/process', methods=['POST'])
@jwt_required()
@handle_errors
def process_message():
    """Process a message for memory extraction and storage"""
    data = request.get_json()
    if not data:
        raise ValueError('No data provided')
    
    message = data.get('message', '').strip()
    if not message:
        raise ValueError('Message is required')
    
    user_id = get_user_id()
    
    extracted_memory, was_stored = memory_service.process_message_for_memory(user_id, message)
    
    return jsonify({
        'success': True,
        'extracted_memory': extracted_memory,
        'was_stored': was_stored,
        'message': message
    })

@memory_bp.route('/context', methods=['POST'])
@jwt_required()
@handle_errors
def get_context():
    """Get memory context for a specific message"""
    data = request.get_json()
    if not data:
        raise ValueError('No data provided')
    
    message = data.get('message', '').strip()
    if not message:
        raise ValueError('Message is required')
    
    user_id = get_user_id()
    
    context = memory_service.get_context_for_response(user_id, message)
    
    return jsonify({
        'success': True,
        'context': context,
        'message': message
    })

@memory_bp.route('/categories', methods=['GET'])
@jwt_required()
@handle_errors
def get_memory_categories():
    """Get available memory categories and their descriptions"""
    return jsonify({
        'success': True,
        'categories': memory_service.memory_categories
    })

@memory_bp.route('/stats', methods=['GET'])
@jwt_required()
@handle_errors
def get_memory_stats():
    """Get memory statistics for the user"""
    user_id = get_user_id()
    
    memory_data = memory_service.get_user_memory(user_id)
    
    if not memory_data:
        stats = {
            'total_entries': 0,
            'categories': [],
            'latest_update': None
        }
    else:
        total_entries = sum(len(items) if isinstance(items, list) else 1 for items in memory_data.values())
        categories = list(memory_data.keys())
        
        # Find latest update
        latest_update = None
        for category, items in memory_data.items():
            if isinstance(items, list):
                for item in items:
                    if isinstance(item, dict) and 'timestamp' in item:
                        if not latest_update or item['timestamp'] > latest_update:
                            latest_update = item['timestamp']
        
        stats = {
            'total_entries': total_entries,
            'categories': categories,
            'category_counts': {cat: len(items) if isinstance(items, list) else 1 
                              for cat, items in memory_data.items()},
            'latest_update': latest_update
        }
    
    return jsonify({
        'success': True,
        'stats': stats
    }) 