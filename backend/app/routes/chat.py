from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from functools import wraps
import traceback
import base64
import os
from werkzeug.utils import secure_filename
from typing import Dict, List, Optional, Any
from app.services.chat_service import ChatServiceOptimized as ChatService
from app.models.conversation import ConversationModel
from datetime import datetime

chat_bp = Blueprint('chat', __name__, url_prefix='/chat')
chat_service = ChatService()

# Configuration for file uploads
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'uploads')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB

# Ensure upload directory exists
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def allowed_file(filename):
    """Check if file has allowed extension"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def get_file_size(file):
    """Get file size"""
    file.seek(0, 2)  # Seek to end
    size = file.tell()
    file.seek(0)  # Reset to beginning
    return size

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
            return jsonify({
                'success': False,
                'error': 'Internal server error'
            }), 500
    return wrapper

def format_conversation(conv: Any) -> Dict:
    """Format conversation object for response"""
    return {
        'id': conv.id,
        'title': conv.title,
        'created_at': conv.created_at,
        'updated_at': conv.updated_at
    }

def format_message(msg: Any) -> Dict:
    """Format message object for response"""
    return {
        'id': msg.id,
        'role': msg.role,
        'content': msg.content,
        'timestamp': msg.timestamp
    }

def get_user_id() -> str:
    """Get user ID from JWT token"""
    return get_jwt_identity()

@chat_bp.route('/conversations', methods=['GET'])
@jwt_required()
@handle_errors
def get_conversations():
    """Get all conversations for a user"""
    user_id = get_user_id()
    conversations = chat_service.get_user_conversations(user_id)
    
    return jsonify({
        'success': True,
        'conversations': [format_conversation(conv) for conv in conversations]
    })

@chat_bp.route('/conversations', methods=['POST'])
@jwt_required()
@handle_errors
def create_conversation():
    """Create a new conversation or sub-conversation"""
    data = request.get_json()
    if not data:
        raise ValueError('No data provided')
    
    user_id = get_user_id()
    title = data.get('title')
    parent_id = data.get('parent_id')  # Support for creating sub-conversations
    
    conversation = chat_service.create_conversation(user_id, title, parent_id)
    
    # Enhanced response with hierarchy information
    response_data = format_conversation(conversation)
    if parent_id:
        response_data['parent_id'] = parent_id
        response_data['is_sub_conversation'] = True
        response_data['main_chat_id'] = chat_service._get_main_chat_id(conversation.id)
    
    return jsonify({
        'success': True,
        'conversation': response_data
    }), 201

@chat_bp.route('/conversations/<conversation_id>/messages', methods=['GET'])
@jwt_required()
@handle_errors
def get_messages(conversation_id: str):
    """Get messages for a conversation"""
    if not conversation_id:
        raise ValueError('Conversation ID is required')
    
    # Validate conversation ownership
    user_id = get_user_id()
    conversation = chat_service.get_conversation(conversation_id)
    if not conversation:
        raise ValueError('Conversation not found')
    
    if conversation.user_id != user_id:
        current_app.logger.warning(f"User {user_id} attempted to access messages for conversation {conversation_id} owned by {conversation.user_id}")
        raise ValueError('You can only access your own conversations')
        
    limit = request.args.get('limit', 50, type=int)
    messages = chat_service.get_conversation_messages(conversation_id, limit)
    
    return jsonify({
        'success': True,
        'messages': [format_message(msg) for msg in messages]
    })

@chat_bp.route('/conversations/<conversation_id>/messages', methods=['POST'])
@jwt_required()
@handle_errors
def send_message(conversation_id: str):
    """Send a message to a conversation and get a response"""
    if not conversation_id:
        raise ValueError('Conversation ID is required')
    
    # Validate conversation ownership
    user_id = get_user_id()
    conversation = chat_service.get_conversation(conversation_id)
    if not conversation:
        raise ValueError('Conversation not found')
    
    if conversation.user_id != user_id:
        current_app.logger.warning(f"User {user_id} attempted to send message to conversation {conversation_id} owned by {conversation.user_id}")
        raise ValueError('You can only send messages to your own conversations')
        
    data = request.get_json()
    if not data:
        raise ValueError('No data provided')
        
    message = data.get('message', '').strip()
    if not message:
        raise ValueError('Message is required')
    
    # Check if this is a history copy request
    is_history_copy = data.get('is_history_copy', False)
    
    if is_history_copy:
        # For history copying, just store the user message without generating AI response
        user_message = chat_service.add_message_to_conversation(conversation_id, 'user', message)
        return jsonify({
            'success': True,
            'message': format_message(user_message)
        })
    else:
        # Normal message flow with AI response
        response = chat_service.generate_response(conversation_id, message)
        if not response:
            raise ValueError('Conversation not found or error generating response')
        
        return jsonify({
            'success': True,
            'message': format_message(response)
        })

@chat_bp.route('/conversations/<conversation_id>/messages/with-image', methods=['POST'])
@jwt_required()
@handle_errors
def send_message_with_image(conversation_id: str):
    """Send a message with an image to a conversation and get a response"""
    if not conversation_id:
        raise ValueError('Conversation ID is required')
    
    # Validate conversation ownership
    user_id = get_user_id()
    conversation = chat_service.get_conversation(conversation_id)
    if not conversation:
        raise ValueError('Conversation not found')
    
    if conversation.user_id != user_id:
        current_app.logger.warning(f"User {user_id} attempted to send message to conversation {conversation_id} owned by {conversation.user_id}")
        raise ValueError('You can only send messages to your own conversations')
    
    # Get text message
    message = request.form.get('message', '').strip()
    
    # Get uploaded file
    image_path = None
    if 'image' in request.files:
        file = request.files['image']
        if file and allowed_file(file.filename):
            if get_file_size(file) <= MAX_FILE_SIZE:
                filename = secure_filename(file.filename)
                # Create unique filename to avoid collisions
                unique_filename = f"{user_id}_{conversation_id}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{filename}"
                image_path = os.path.join(UPLOAD_FOLDER, unique_filename)
                file.save(image_path)
            else:
                raise ValueError('File size exceeds the allowed limit')
        else:
            raise ValueError('Invalid file or file extension')
    
    if not message and not image_path:
        raise ValueError('Either message text or image is required')
    
    # Generate response with vision support
    response = chat_service.generate_response_with_vision(conversation_id, message or "What's in this image?", image_path)
    if not response:
        raise ValueError('Error generating response')
    
    return jsonify({
        'success': True,
        'message': response  # response is already a formatted dictionary
    })

@chat_bp.route('/conversations/<conversation_id>/messages/direct', methods=['POST'])
@jwt_required()
@handle_errors
def add_direct_message(conversation_id: str):
    """Add a message directly to a conversation without generating AI response"""
    if not conversation_id:
        raise ValueError('Conversation ID is required')
        
    data = request.get_json()
    if not data:
        raise ValueError('No data provided')
        
    role = data.get('role', '').strip()
    content = data.get('content', '').strip()
    timestamp = data.get('timestamp')
    
    if not role or not content:
        raise ValueError('Role and content are required')
    
    if role not in ['user', 'assistant']:
        raise ValueError('Role must be either "user" or "assistant"')
    
    # Add the message directly without AI processing
    message = chat_service.add_message_to_conversation(conversation_id, role, content, timestamp)
    
    return jsonify({
        'success': True,
        'message': format_message(message)
    })

@chat_bp.route('/cache/clear', methods=['POST'])
@jwt_required()
@handle_errors
def clear_cache():
    """Clear OpenAI response cache for debugging"""
    try:
        cleared_count = chat_service.openai_service.clear_cache()
        return jsonify({
            'success': True,
            'message': f'Cleared {cleared_count} cache entries'
        })
    except Exception as e:
        current_app.logger.error(f"Error clearing cache: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Failed to clear cache'
        }), 500

@chat_bp.route('/conversations/<conversation_id>', methods=['DELETE'])
@jwt_required()
def delete_conversation(conversation_id: str):
    """Delete a conversation with enhanced error handling and validation"""
    try:
        # Enhanced validation
        if not conversation_id or not conversation_id.strip():
            current_app.logger.error("Delete conversation called with empty conversation_id")
            raise ValueError('Conversation ID is required and cannot be empty')
        
        # Log the deletion attempt
        user_id = get_user_id()
        current_app.logger.info(f"User {user_id} attempting to delete conversation {conversation_id}")
        
        # Try to get conversation for validation, but don't fail if not found
        conversation = chat_service.get_conversation(conversation_id)
        if conversation:
            # If conversation exists, validate ownership
            if conversation.user_id != user_id:
                current_app.logger.error(f"User {user_id} attempted to delete conversation {conversation_id} belonging to {conversation.user_id}")
                raise ValueError('You can only delete your own conversations')
            
            current_app.logger.info(f"Starting deletion of conversation {conversation_id} (title: {conversation.title})")
        else:
            current_app.logger.warning(f"Conversation {conversation_id} not found for deletion - proceeding with cleanup anyway")
            current_app.logger.info(f"Starting cleanup deletion for conversation {conversation_id} (conversation not found)")
        
        # Attempt deletion - the service will handle cleanup even if conversation doesn't exist
        success = chat_service.delete_conversation(conversation_id)
        
        if not success:
            current_app.logger.error(f"Chat service returned False for deletion of conversation {conversation_id}")
            raise ValueError('Conversation could not be deleted - deletion service failed - This could be due to invalid conversation ID, malformed request, or validation error')
        
        current_app.logger.info(f"Successfully processed deletion for conversation {conversation_id}")
        
        return jsonify({
            'success': True,
            'message': 'Conversation deleted successfully',
            'conversation_id': conversation_id
        })
        
    except ValueError as ve:
        current_app.logger.error(f"ValueError in delete_conversation: {str(ve)}")
        return jsonify({
            'success': False,
            'error': str(ve)
        }), 400
    except Exception as e:
        current_app.logger.error(f"Unexpected error in delete_conversation for {conversation_id}: {str(e)}")
        current_app.logger.error(f"Full traceback: {traceback.format_exc()}")
        return jsonify({
            'success': False,
            'error': 'Internal server error during conversation deletion'
        }), 500

@chat_bp.route('/conversations/<conversation_id>/messages/<message_id>', methods=['DELETE'])
@jwt_required()
@handle_errors
def delete_message(conversation_id: str, message_id: str):
    """Delete a specific message from a conversation"""
    if not conversation_id or not message_id:
        raise ValueError('Conversation ID and Message ID are required')
    
    # For now, we'll just return success since messages are handled client-side
    # In a full implementation, you'd delete from Weaviate
    return jsonify({
        'success': True,
        'message': 'Message deleted successfully'
    })

@chat_bp.route('/conversations/<conversation_id>/clear', methods=['POST'])
@jwt_required()
@handle_errors
def clear_conversation_history(conversation_id: str):
    """Clear all messages from a conversation"""
    if not conversation_id:
        raise ValueError('Conversation ID is required')
    
    # For now, we'll just return success since messages are handled client-side
    # In a full implementation, you'd clear all messages from Weaviate
    return jsonify({
        'success': True,
        'message': 'Conversation history cleared successfully'
    })

@chat_bp.route('/conversations/<conversation_id>/sub-conversations', methods=['POST'])
@jwt_required()
@handle_errors
def create_sub_conversation(conversation_id: str):
    """Create a new sub-conversation under a parent conversation"""
    if not conversation_id:
        raise ValueError('Parent Conversation ID is required')
        
    data = request.get_json()
    if not data:
        raise ValueError('No data provided')
        
    user_id = get_user_id()
    title = data.get('title')
    inherit_context = data.get('inherit_context', False)  # Default to False for fresh sub-chats
    
    sub_conversation = chat_service.create_sub_conversation(
        conversation_id, user_id, title, inherit_context
    )
    if not sub_conversation:
        raise ValueError('Failed to create sub-conversation')
    
    response_data = format_conversation(sub_conversation)
    response_data['inherit_context'] = inherit_context
    
    return jsonify({
        'success': True,
        'conversation': response_data
    }), 201

@chat_bp.route('/conversations/<conversation_id>/sub-conversations', methods=['GET'])
@jwt_required()
@handle_errors
def get_sub_conversations(conversation_id: str):
    """Get all sub-conversations for a parent conversation"""
    if not conversation_id:
        raise ValueError('Parent Conversation ID is required')
    
    sub_conversations = chat_service.get_user_conversations(
        get_user_id(), 
        limit=100
    )
    
    # Filter for sub-conversations of the given parent
    filtered_subs = [
        conv for conv in sub_conversations 
        if hasattr(conv, 'parent_id') and conv.parent_id == conversation_id
    ]
    
    return jsonify({
        'success': True,
        'conversations': [format_conversation(conv) for conv in filtered_subs]
    })

@chat_bp.route('/conversations/<conversation_id>/context', methods=['GET'])
@jwt_required()
@handle_errors
def get_conversation_context(conversation_id: str):
    """Get enhanced conversation context including all related sub-chats"""
    if not conversation_id:
        raise ValueError('Conversation ID is required')
    
    include_all_sub_chats = request.args.get('include_all_sub_chats', 'true').lower() == 'true'
    limit = request.args.get('limit', 50, type=int)
    
    context_messages = chat_service.get_conversation_context(
        conversation_id,
        limit=limit,
        include_all_sub_chats=include_all_sub_chats
    )
    
    return jsonify({
        'success': True,
        'context_messages': context_messages,
        'total_messages': len(context_messages)
    })

@chat_bp.route('/conversations/<conversation_id>/hierarchy', methods=['GET'])
@jwt_required()
@handle_errors
def get_chat_hierarchy(conversation_id: str):
    """Get chat hierarchy information and statistics"""
    if not conversation_id:
        raise ValueError('Conversation ID is required')
    
    hierarchy_stats = chat_service.get_chat_hierarchy_stats(conversation_id)
    
    return jsonify({
        'success': True,
        'hierarchy': hierarchy_stats
    })

@chat_bp.route('/conversations/<conversation_id>/main-chat-context', methods=['GET'])
@jwt_required()
@handle_errors
def get_main_chat_context(conversation_id: str):
    """Get comprehensive context for the main chat tree"""
    if not conversation_id:
        raise ValueError('Conversation ID is required')
    
    # Get the main chat ID
    main_chat_id = chat_service._get_main_chat_id(conversation_id)
    limit = request.args.get('limit', 100, type=int)
    
    main_chat_context = chat_service.get_main_chat_context(main_chat_id, limit=limit)
    
    return jsonify({
        'success': True,
        'main_chat_context': main_chat_context
    })

@chat_bp.route('/conversations/<conversation_id>/all-messages', methods=['GET'])
@jwt_required()
@handle_errors
def get_all_messages_from_chat_tree(conversation_id: str):
    """Get all messages from main chat and all its sub-chats"""
    if not conversation_id:
        raise ValueError('Conversation ID is required')
    
    # Get the main chat ID
    main_chat_id = chat_service._get_main_chat_id(conversation_id)
    limit = request.args.get('limit', 200, type=int)
    
    all_messages = chat_service._get_all_messages_from_main_chat_tree(main_chat_id, limit=limit)
    
    return jsonify({
        'success': True,
        'main_chat_id': main_chat_id,
        'messages': all_messages,
        'total_messages': len(all_messages)
    })

@chat_bp.route('/conversations/<conversation_id>/rename', methods=['PUT'])
@jwt_required()
@handle_errors
def rename_conversation(conversation_id: str):
    """Rename a conversation"""
    if not conversation_id:
        raise ValueError('Conversation ID is required')
        
    data = request.get_json()
    if not data or 'title' not in data:
        raise ValueError('New title is required')
    
    conversation = chat_service.get_conversation(conversation_id)
    if not conversation:
        raise ValueError('Conversation not found')
    
    conversation.title = data['title']
    success = conversation.save()
    
    if not success:
        raise ValueError('Failed to rename conversation')
    
    return jsonify({
        'success': True,
        'conversation': format_conversation(conversation)
    })

@chat_bp.route('/conversations/<conversation_id>/share', methods=['POST'])
@jwt_required()
@handle_errors
def share_conversation(conversation_id: str):
    """Generate a shareable link for a conversation"""
    if not conversation_id:
        raise ValueError('Conversation ID is required')
    
    conversation = chat_service.get_conversation(conversation_id)
    if not conversation:
        raise ValueError('Conversation not found')
    
    # Generate a unique share token
    share_token = chat_service.generate_share_token(conversation_id)
    
    return jsonify({
        'success': True,
        'share_url': f"{request.host_url}share/{share_token}",
        'expires_at': share_token.get('expires_at')
    })

@chat_bp.route('/conversations/<conversation_id>/force-delete', methods=['DELETE'])
@jwt_required()
def force_delete_conversation(conversation_id: str):
    """Simplified delete with minimal validation for debugging"""
    try:
        current_app.logger.info(f"Force delete attempt for conversation: {conversation_id}")
        
        # Get user ID
        user_id = get_user_id()
        current_app.logger.info(f"User ID from token: {user_id}")
        
        # Simple validation
        if not conversation_id:
            return jsonify({
                'success': False,
                'error': 'Conversation ID is required'
            }), 400
        
        # Initialize chat service
        chat_service = ChatService()
        
        # Try to get conversation for ownership check, but don't fail if not found
        conversation = chat_service.get_conversation(conversation_id)
        if conversation:
            # Check ownership only if conversation exists
            if conversation.user_id != user_id:
                current_app.logger.warning(f"User {user_id} attempted to delete conversation {conversation_id} owned by {conversation.user_id}")
                return jsonify({
                    'success': False,
                    'error': 'Permission denied'
                }), 403
            
            current_app.logger.info(f"Found conversation {conversation_id}, proceeding with force deletion")
        else:
            current_app.logger.warning(f"Conversation {conversation_id} not found - proceeding with cleanup anyway")
        
        # Attempt deletion - the service will handle cleanup even if conversation doesn't exist
        current_app.logger.info(f"Starting force deletion of conversation {conversation_id}")
        success = chat_service.delete_conversation(conversation_id)
        
        if success:
            current_app.logger.info(f"Successfully force deleted conversation {conversation_id}")
            return jsonify({
                'success': True,
                'message': 'Conversation deleted successfully'
            })
        else:
            current_app.logger.error(f"Failed to force delete conversation {conversation_id}")
            return jsonify({
                'success': False,
                'error': 'Failed to delete conversation'
            }), 500
            
    except Exception as e:
        current_app.logger.error(f"Exception in force delete conversation {conversation_id}: {str(e)}")
        current_app.logger.error(f"Full traceback: {traceback.format_exc()}")
        return jsonify({
            'success': False,
            'error': f'Internal server error: {str(e)}'
        }), 500

@chat_bp.route('/conversations/bulk-delete', methods=['DELETE'])
@jwt_required()
def bulk_delete_conversations():
    """Delete all conversations for the current user"""
    try:
        user_id = get_user_id()
        current_app.logger.info(f"User {user_id} attempting bulk delete of all conversations")
        
        # Get all user conversations
        chat_service = ChatService()
        user_conversations = chat_service.get_user_conversations(user_id, limit=1000, include_sub_chats=True)
        
        if not user_conversations:
            current_app.logger.info(f"No conversations found for user {user_id}")
            return jsonify({
                'success': True,
                'message': 'No conversations to delete',
                'deleted_count': 0
            })
        
        current_app.logger.info(f"Found {len(user_conversations)} conversations to delete for user {user_id}")
        
        # Delete all conversations
        deleted_count = 0
        failed_deletions = []
        
        for conversation in user_conversations:
            try:
                current_app.logger.info(f"Deleting conversation {conversation.id} (title: {conversation.title})")
                success = chat_service.delete_conversation(conversation.id)
                if success:
                    deleted_count += 1
                    current_app.logger.info(f"Successfully deleted conversation {conversation.id}")
                else:
                    failed_deletions.append(conversation.id)
                    current_app.logger.warning(f"Failed to delete conversation {conversation.id}")
            except Exception as e:
                current_app.logger.error(f"Error deleting conversation {conversation.id}: {str(e)}")
                failed_deletions.append(conversation.id)
        
        # Clean up user-specific Redis cache
        try:
            from app.services.redis_service import RedisServiceOptimized
            redis_service = RedisServiceOptimized()
            
            # Clear user conversation cache
            user_cache_key = redis_service.get_user_key(user_id, "conversations")
            redis_service.redis.delete(user_cache_key)
            
            # Clear all user-related keys
            pattern = f"*{user_id}*"
            user_keys = redis_service.redis.keys(pattern)
            if user_keys:
                redis_service.redis.delete(*user_keys)
                current_app.logger.info(f"Cleared {len(user_keys)} user-related cache keys")
                
        except Exception as e:
            current_app.logger.warning(f"Error clearing user cache: {str(e)}")
        
        response_data = {
            'success': True,
            'message': f'Bulk delete completed. Deleted {deleted_count} out of {len(user_conversations)} conversations',
            'deleted_count': deleted_count,
            'total_conversations': len(user_conversations),
            'failed_deletions': failed_deletions
        }
        
        if failed_deletions:
            response_data['warning'] = f'{len(failed_deletions)} conversations could not be deleted'
            current_app.logger.warning(f"Failed to delete {len(failed_deletions)} conversations: {failed_deletions}")
        
        current_app.logger.info(f"Bulk delete completed for user {user_id}: {deleted_count}/{len(user_conversations)} deleted")
        return jsonify(response_data)
        
    except Exception as e:
        current_app.logger.error(f"Error in bulk delete for user {get_user_id()}: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Failed to delete conversations: {str(e)}'
        }), 500

@chat_bp.route('/conversations/upload', methods=['POST'])
@jwt_required()
@handle_errors
def upload_file():
    """Upload a file and process it for vision capabilities"""
    if 'file' not in request.files:
        raise ValueError('No file part')
    
    file = request.files['file']
    if not file or not allowed_file(file.filename):
        raise ValueError('Invalid file or file extension')
    
    if get_file_size(file) > MAX_FILE_SIZE:
        raise ValueError('File size exceeds the allowed limit')
    
    filename = secure_filename(file.filename)
    file_path = os.path.join(UPLOAD_FOLDER, filename)
    
    file.save(file_path)
    
    # Process the file for vision capabilities
    processed_file = chat_service.process_file(file_path)
    
    return jsonify({
        'success': True,
        'file_path': processed_file
    })
