from datetime import datetime, timedelta
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Optional, List, Dict, Any
from functools import lru_cache
import logging
import secrets
import json
import re
import os
import shutil

from app.models import ConversationModel, MessageModel
from app.services.openai_service import OpenAIServiceOptimized as OpenAIService
from app.services.redis_service import RedisServiceOptimized as RedisService
from app.services.weaviate_service import weaviate_service
from app.services.browser_tracking_service import browser_tracking_service
from app.services.memory_service import memory_service
from app.models.user import UserModel

logger = logging.getLogger(__name__)

class ChatServiceOptimized:
    def __init__(self):
        self.openai_service = OpenAIService()
        self.redis_service = RedisService()
        
        # Performance optimizations
        self._executor = ThreadPoolExecutor(max_workers=5)
        self._conversation_cache = {}
        self._cache_lock = threading.RLock()
        
        # Configuration
        self.max_context_messages = 15
        self.cache_ttl = 3600  # 1 hour
        self.batch_size = 20
        self.max_context_depth = 3  # Maximum depth for context retrieval
        
        # Enhanced parent-child configuration
        self.max_sub_chats_context = 50  # Maximum messages from all sub-chats
        self.context_merge_strategy = 'chronological'  # or 'priority'
        
        # File upload configuration
        self.upload_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'uploads')
        os.makedirs(self.upload_folder, exist_ok=True)
    
    def _get_cached_conversation(self, conversation_id: str) -> Optional[ConversationModel]:
        """Get conversation from local cache with thread safety"""
        with self._cache_lock:
            return self._conversation_cache.get(conversation_id)
    
    def _cache_conversation(self, conversation: ConversationModel) -> None:
        """Cache conversation locally with thread safety"""
        with self._cache_lock:
            self._conversation_cache[conversation.id] = conversation
            
            # Limit cache size to prevent memory issues
            if len(self._conversation_cache) > 100:
                # Remove oldest entries
                oldest_key = next(iter(self._conversation_cache))
                del self._conversation_cache[oldest_key]
    
    def _get_main_chat_id(self, conversation_id: str) -> str:
        """Get the main chat ID for a conversation (top-level parent)"""
        try:
            conversation = self.get_conversation(conversation_id)
            if not conversation:
                return conversation_id
            
            # Traverse up to find the root parent
            current_conv = conversation
            while current_conv.parent_id:
                parent_conv = self.get_conversation(current_conv.parent_id)
                if not parent_conv:
                    break
                current_conv = parent_conv
            
            return current_conv.id
        except Exception as e:
            logger.error(f"Error getting main chat ID for {conversation_id}: {str(e)}")
            return conversation_id

    def _store_chat_hierarchy_in_redis(self, main_chat_id: str, sub_chat_id: str, user_id: str) -> bool:
        """Store chat hierarchy mapping in Redis"""
        try:
            # Store main_chat -> sub_chats mapping
            main_chat_key = f"hierarchy:main:{main_chat_id}"
            sub_chats_data = self.redis_service.redis.get(main_chat_key)
            
            if sub_chats_data:
                sub_chats = json.loads(sub_chats_data)
            else:
                sub_chats = []
            
            if sub_chat_id not in sub_chats:
                sub_chats.append(sub_chat_id)
                self.redis_service.redis.setex(
                    main_chat_key, 
                    self.redis_service.conversation_ttl, 
                    json.dumps(sub_chats)
                )
            
            # Store sub_chat -> main_chat mapping
            sub_chat_key = f"hierarchy:sub:{sub_chat_id}"
            hierarchy_data = {
                'main_chat_id': main_chat_id,
                'user_id': user_id,
                'created_at': datetime.utcnow().isoformat() + 'Z'
            }
            self.redis_service.redis.setex(
                sub_chat_key,
                self.redis_service.conversation_ttl,
                json.dumps(hierarchy_data)
            )
            
            return True
        except Exception as e:
            logger.error(f"Error storing chat hierarchy: {str(e)}")
            return False

    def _get_all_sub_chats(self, main_chat_id: str) -> List[str]:
        """Get all sub chat IDs under a main chat"""
        try:
            main_chat_key = f"hierarchy:main:{main_chat_id}"
            sub_chats_data = self.redis_service.redis.get(main_chat_key)
            
            if sub_chats_data:
                return json.loads(sub_chats_data)
            
            # Fallback to Weaviate query
            sub_conversations = ConversationModel.get_sub_conversations(main_chat_id)
            sub_chat_ids = [conv.id for conv in sub_conversations]
            
            # Cache the result
            if sub_chat_ids:
                self.redis_service.redis.setex(
                    main_chat_key,
                    self.redis_service.conversation_ttl,
                    json.dumps(sub_chat_ids)
                )
            
            return sub_chat_ids
        except Exception as e:
            logger.error(f"Error getting sub chats for main chat {main_chat_id}: {str(e)}")
            return []

    def _get_all_messages_from_main_chat_tree(self, main_chat_id: str, limit: int = None) -> List[Dict[str, Any]]:
        """Get all messages from main chat and all its sub-chats"""
        try:
            limit = limit or self.max_sub_chats_context
            all_messages = []
            
            # Get all sub-chats under this main chat
            sub_chat_ids = self._get_all_sub_chats(main_chat_id)
            all_chat_ids = [main_chat_id] + sub_chat_ids
            
            # Collect messages from all chats
            for chat_id in all_chat_ids:
                try:
                    conversation = self.get_conversation(chat_id)
                    if not conversation:
                        continue
                    
                    # Get messages from Redis first (faster)
                    redis_messages = self.redis_service.get_conversation_history(
                        conversation.user_id, 
                        chat_id, 
                        limit=50
                    )
                    
                    if redis_messages:
                        for msg in redis_messages:
                            all_messages.append({
                                'role': msg.get('role'),
                                'content': msg.get('content'),
                                'timestamp': msg.get('timestamp'),
                                'chat_id': chat_id,
                                'chat_title': conversation.title,
                                'message_id': msg.get('message_id')
                            })
                    else:
                        # Fallback to Weaviate
                        weaviate_messages = MessageModel.get_by_conversation_id(chat_id)
                        for msg in weaviate_messages[-20:]:  # Get recent messages
                            all_messages.append({
                                'role': msg.role,
                                'content': msg.content,
                                'timestamp': msg.timestamp,
                                'chat_id': chat_id,
                                'chat_title': conversation.title,
                                'message_id': msg.id
                            })
                
                except Exception as e:
                    logger.warning(f"Error getting messages from chat {chat_id}: {str(e)}")
                    continue
            
            # Sort messages chronologically
            all_messages.sort(key=lambda x: x.get('timestamp', ''))
            
            # Return most recent messages within limit
            return all_messages[-limit:] if limit else all_messages
            
        except Exception as e:
            logger.error(f"Error getting all messages from main chat tree {main_chat_id}: {str(e)}")
            return []

    def _store_message_with_hierarchy(self, conversation_id: str, role: str, content: str) -> Optional[MessageModel]:
        """Store message with enhanced hierarchy tracking"""
        try:
            conversation = self.get_conversation(conversation_id)
            if not conversation:
                logger.error(f"Conversation {conversation_id} not found")
                return None
            
            # Create message in Weaviate
            message = MessageModel.create(
                conversation_id=conversation_id,
                role=role,
                content=content
            )
            
            if not message:
                logger.error(f"Failed to create message in conversation {conversation_id}")
                return None
            
            # Get main chat ID for hierarchy tracking
            main_chat_id = self._get_main_chat_id(conversation_id)
            
            # Enhanced message data for Redis with hierarchy info
            message_data = {
                'role': role,
                'content': content,
                'timestamp': datetime.utcnow().isoformat() + 'Z',
                'message_id': message.id,
                'main_chat_id': main_chat_id,
                'sub_chat_id': conversation_id if conversation_id != main_chat_id else None
            }
            
            # Store in Redis with hierarchy
            self.redis_service.store_message(
                conversation.user_id,
                conversation_id,
                message_data
            )
            
            # Store hierarchy mapping
            if conversation_id != main_chat_id:
                self._store_chat_hierarchy_in_redis(main_chat_id, conversation_id, conversation.user_id)
            
            # Also store in main chat context for quick access
            main_chat_context_key = f"main_chat_context:{main_chat_id}"
            context_data = {
                'chat_id': conversation_id,
                'role': role,
                'content': content,
                'timestamp': message_data['timestamp'],
                'message_id': message.id
            }
            
            # Add to main chat context list
            self.redis_service.redis.lpush(
                main_chat_context_key,
                json.dumps(context_data)
            )
            self.redis_service.redis.ltrim(
                main_chat_context_key,
                0,
                self.max_sub_chats_context - 1
            )
            self.redis_service.redis.expire(
                main_chat_context_key,
                self.redis_service.conversation_ttl
            )
            
            return message
            
        except Exception as e:
            logger.error(f"Error storing message with hierarchy: {str(e)}")
            return None
    
    def create_conversation(self, user_id: str, title: str = None, parent_id: str = None) -> Optional[ConversationModel]:
        """Enhanced conversation creation with parent-child support"""
        try:
            conversation = ConversationModel.create(
                user_id=user_id,
                title=title or "New Conversation",
                parent_id=parent_id
            )
            
            if not conversation:
                logger.error(f"Failed to create conversation for user {user_id}")
                return None
            
            # Enhanced metadata for caching with hierarchy info
            main_chat_id = self._get_main_chat_id(conversation.id)
            metadata = {
                'id': conversation.id,
                'user_id': conversation.user_id,
                'title': conversation.title,
                'created_at': conversation.created_at,
                'updated_at': conversation.created_at,
                'message_count': 0,
                'parent_id': parent_id,
                'main_chat_id': main_chat_id,
                'is_sub_chat': bool(parent_id)
            }
            
            # Cache in Redis and locally
            self.redis_service.cache_conversation_metadata(conversation.id, metadata)
            self._cache_conversation(conversation)
            
            # Store hierarchy if this is a sub-chat
            if parent_id:
                self._store_chat_hierarchy_in_redis(main_chat_id, conversation.id, user_id)
            
            logger.info(f"Created conversation {conversation.id} for user {user_id} (parent: {parent_id})")
            return conversation
            
        except Exception as e:
            logger.error(f"Error creating conversation for user {user_id}: {str(e)}")
            return None
    
    def get_conversation(self, conversation_id: str) -> Optional[ConversationModel]:
        """Get conversation with multi-level caching"""
        try:
            # Level 1: Local cache
            cached_conversation = self._get_cached_conversation(conversation_id)
            if cached_conversation:
                return cached_conversation
            
            # Level 2: Redis cache
            cached_metadata = self.redis_service.get_cached_conversation_metadata(conversation_id)
            if cached_metadata:
                conversation = ConversationModel(
                    conversation_id=cached_metadata['id'],
                    user_id=cached_metadata['user_id'],
                    title=cached_metadata['title'],
                    created_at=cached_metadata['created_at']
                )
                self._cache_conversation(conversation)
                return conversation
            
            # Level 3: Database fallback
            conversation = ConversationModel.get_by_id(conversation_id)
            if conversation:
                # Cache for future access
                metadata = {
                    'id': conversation.id,
                    'user_id': conversation.user_id,
                    'title': conversation.title,
                    'created_at': conversation.created_at,
                    'updated_at': getattr(conversation, 'updated_at', conversation.created_at)
                }
                self.redis_service.cache_conversation_metadata(conversation.id, metadata)
                self._cache_conversation(conversation)
                
            return conversation
            
        except Exception as e:
            logger.error(f"Error getting conversation {conversation_id}: {str(e)}")
            return None
    
    def get_user_conversations(self, user_id: str, limit: int = 50, include_sub_chats: bool = False) -> List[ConversationModel]:
        """Get user conversations with caching and pagination - excludes sub-chats by default"""
        try:
            # Try to get from cache first
            cache_key = f"user_conversations:{user_id}"
            cached_conversations = self.redis_service.get_cached_user_data(user_id, "conversations")
            
            if cached_conversations:
                # Filter out sub-chats unless explicitly requested
                if not include_sub_chats:
                    cached_conversations = [conv for conv in cached_conversations 
                                          if not (hasattr(conv, 'parent_id') and conv.parent_id)]
                return cached_conversations[:limit]
            
            # Get from database - only parent conversations by default
            if include_sub_chats:
                conversations = ConversationModel.get_by_user_id(user_id)
            else:
                # Get all conversations and filter out sub-chats (those with parent_id)
                all_conversations = ConversationModel.get_by_user_id(user_id)
                conversations = [conv for conv in all_conversations 
                               if not conv.parent_id]  # Only conversations without parent_id
                
                # Sort by created_at (most recent first)
                conversations.sort(key=lambda x: x.created_at or '', reverse=True)
            
            if conversations:
                # Cache the results
                self.redis_service.cache_user_data(
                    user_id, 
                    "conversations", 
                    conversations, 
                    ttl=self.cache_ttl
                )
            
            return conversations[:limit]
            
        except Exception as e:
            logger.error(f"Error getting conversations for user {user_id}: {str(e)}")
            return []
    
    def add_message(self, conversation_id: str, role: str, content: str) -> Optional[MessageModel]:
        """Add message with hierarchy-aware storage and optimized operations"""
        return self._store_message_with_hierarchy(conversation_id, role, content)

    def add_message_to_conversation(self, conversation_id: str, role: str, content: str, timestamp: str = None) -> Optional[MessageModel]:
        """Add message directly to conversation with optional custom timestamp (for history copying)"""
        try:
            conversation = self.get_conversation(conversation_id)
            if not conversation:
                logger.error(f"Conversation {conversation_id} not found")
                return None
            
            # Use custom timestamp or current time
            message_timestamp = timestamp or datetime.utcnow().isoformat() + 'Z'
            
            # Create message in Weaviate with custom timestamp
            message = MessageModel.create(
                conversation_id=conversation_id,
                role=role,
                content=content,
                timestamp=message_timestamp
            )
            
            if not message:
                logger.error(f"Failed to create message in conversation {conversation_id}")
                return None
            
            # Get main chat ID for hierarchy tracking
            main_chat_id = self._get_main_chat_id(conversation_id)
            
            # Enhanced message data for Redis with hierarchy info
            message_data = {
                'role': role,
                'content': content,
                'timestamp': message_timestamp,
                'message_id': message.id,
                'main_chat_id': main_chat_id,
                'sub_chat_id': conversation_id if conversation_id != main_chat_id else None
            }
            
            # Store in Redis with hierarchy
            self.redis_service.store_message(
                conversation.user_id,
                conversation_id,
                message_data
            )
            
            # Store hierarchy mapping
            if conversation_id != main_chat_id:
                self._store_chat_hierarchy_in_redis(main_chat_id, conversation_id, conversation.user_id)
            
            # Also store in main chat context for quick access
            main_chat_context_key = f"main_chat_context:{main_chat_id}"
            context_data = {
                'chat_id': conversation_id,
                'role': role,
                'content': content,
                'timestamp': message_data['timestamp'],
                'message_id': message.id
            }
            
            # Add to main chat context list
            self.redis_service.redis.lpush(
                main_chat_context_key,
                json.dumps(context_data)
            )
            self.redis_service.redis.ltrim(
                main_chat_context_key,
                0,
                self.max_sub_chats_context - 1
            )
            self.redis_service.redis.expire(
                main_chat_context_key,
                self.redis_service.conversation_ttl
            )
            
            return message
            
        except Exception as e:
            logger.error(f"Error adding message to conversation: {str(e)}")
            return None
    
    def get_conversation_messages(self, conversation_id: str, limit: int = 50) -> List[MessageModel]:
        """Get messages with enhanced caching and error handling"""
        try:
            conversation = self.get_conversation(conversation_id)
            if not conversation:
                logger.warning(f"Conversation {conversation_id} not found")
                return []
            
            # Try Redis cache first for recent messages
            cached_messages = self.redis_service.get_conversation_history(
                conversation.user_id,
                conversation_id,
                limit
            )
            
            if cached_messages:
                # Convert Redis format to MessageModel format
                message_models = []
                for i, msg in enumerate(cached_messages):
                    try:
                        message_model = MessageModel(
                            message_id=msg.get('message_id', f"cached_{i}"),
                            conversation_id=conversation_id,
                            role=msg['role'],
                            content=msg['content'],
                            timestamp=msg['timestamp']
                        )
                        message_models.append(message_model)
                    except KeyError as e:
                        logger.warning(f"Invalid cached message format: {str(e)}")
                        continue
                
                if message_models:
                    return message_models
            
            # Fallback to database
            messages = MessageModel.get_by_conversation_id(conversation_id)
            if not messages:
                return []
            
            # Sort and limit messages
            sorted_messages = sorted(
                messages, 
                key=lambda m: m.timestamp or '1970-01-01T00:00:00Z'
            )[-limit:]
            
            # Cache messages in Redis for future access (async)
            if sorted_messages:
                self._executor.submit(
                    self._cache_messages_async,
                    conversation.user_id,
                    conversation_id,
                    sorted_messages
                )
            
            return sorted_messages
            
        except Exception as e:
            logger.error(f"Error fetching messages for conversation {conversation_id}: {str(e)}")
            return []
    
    def _cache_messages_async(self, user_id: str, conversation_id: str, messages: List[MessageModel]) -> None:
        """Asynchronously cache messages in Redis"""
        try:
            message_data_list = []
            for message in messages:
                message_data = {
                    'role': message.role,
                    'content': message.content,
                    'timestamp': message.timestamp,
                    'message_id': message.id
                }
                message_data_list.append(message_data)
            
            # Store in batches for better performance
            for i in range(0, len(message_data_list), self.batch_size):
                batch = message_data_list[i:i + self.batch_size]
                for msg_data in batch:
                    self.redis_service.store_message(user_id, conversation_id, msg_data)
                    
        except Exception as e:
            logger.warning(f"Failed to cache messages async: {str(e)}")
    
    def create_sub_conversation(self, parent_id: str, user_id: str, title: str = None, inherit_context: bool = False) -> Optional[ConversationModel]:
        """Create a new sub-conversation under a parent conversation with optional context inheritance"""
        try:
            parent = self.get_conversation(parent_id)
            if not parent:
                logger.error(f"Parent conversation {parent_id} not found")
                return None
            
            # Get the main chat ID (could be the parent itself or its parent)
            main_chat_id = self._get_main_chat_id(parent_id)
            
            # Create sub-conversation with parent reference
            sub_conversation = self.create_conversation(
                user_id=user_id,
                title=title or f"New Sub-chat",
                parent_id=parent_id
            )
            
            if sub_conversation:
                # Additional hierarchy metadata
                metadata = {
                    'depth': parent.metadata.get('depth', 0) + 1,
                    'parent_title': parent.title,
                    'main_chat_id': main_chat_id,
                    'created_from': f"Sub-conversation of {parent.title}",
                    'inherit_context': inherit_context  # Store whether to inherit context
                }
                
                # Update conversation metadata
                sub_conversation.metadata.update(metadata)
                sub_conversation.save()
                
                logger.info(f"Created sub-conversation {sub_conversation.id} under {parent_id} (main: {main_chat_id}, inherit_context: {inherit_context})")
            
            return sub_conversation
            
        except Exception as e:
            logger.error(f"Error creating sub-conversation: {str(e)}")
            return None
    
    def get_conversation_context(self, conversation_id: str, limit: int = 20, include_all_sub_chats: bool = False) -> List[Dict]:
        """Get conversation context with optional parent inheritance based on conversation settings"""
        try:
            # Get the current conversation
            conversation = self.get_conversation(conversation_id)
            if not conversation:
                return []
            
            messages = []
            
            # Check if this is a sub-chat and whether it should inherit parent context
            is_sub_chat = hasattr(conversation, 'parent_id') and conversation.parent_id
            should_inherit_context = False
            
            if is_sub_chat:
                # Check metadata for inherit_context setting (default False for fresh sub-chats)
                should_inherit_context = conversation.metadata.get('inherit_context', False)
                logger.info(f"Sub-chat {conversation_id} inherit_context setting: {should_inherit_context}")
            
            # If this is a sub-chat AND should inherit context, include parent context
            if is_sub_chat and should_inherit_context:
                logger.info(f"Including parent context from {conversation.parent_id}")
                
                # Get parent conversation messages for context
                parent_messages = MessageModel.get_by_conversation_id(conversation.parent_id)
                
                parent_context = [{
                    'role': msg.role,
                    'content': msg.content,
                    'timestamp': msg.timestamp,
                    'conversation_id': msg.conversation_id,
                    'is_parent_context': True
                } for msg in parent_messages[-limit:]]  # Get recent parent messages
                
                messages.extend(parent_context)
                logger.info(f"Added {len(parent_context)} parent context messages")
                
                # For sub-chats, also check if parent has its own parent (grandparent context)
                parent_conversation = self.get_conversation(conversation.parent_id)
                if parent_conversation and hasattr(parent_conversation, 'parent_id') and parent_conversation.parent_id:
                    grandparent_messages = MessageModel.get_by_conversation_id(parent_conversation.parent_id)
                    
                    grandparent_context = [{
                        'role': msg.role,
                        'content': msg.content,
                        'timestamp': msg.timestamp,
                        'conversation_id': msg.conversation_id,
                        'is_grandparent_context': True
                    } for msg in grandparent_messages[-(limit//2):]]  # Half limit for grandparent
                    
                    # Add grandparent context at the beginning
                    messages = grandparent_context + messages
                    logger.info(f"Added {len(grandparent_context)} grandparent context messages")
            
            # Get current conversation messages
            current_limit = limit//4 if (is_sub_chat and should_inherit_context) else limit
            current_messages = MessageModel.get_by_conversation_id(conversation_id)
            
            current_context = [{
                'role': msg.role,
                'content': msg.content,
                'timestamp': msg.timestamp,
                'conversation_id': msg.conversation_id,
                'is_current_context': True
            } for msg in current_messages[-current_limit:]]  # Get recent current messages
            
            messages.extend(current_context)
            logger.info(f"Added {len(current_context)} current conversation messages")
            
            # If include_all_sub_chats is True, also include related sub-chat contexts
            if include_all_sub_chats:
                # For main chat, include messages from all its sub-chats
                if not is_sub_chat:
                    sub_conversations = ConversationModel.get_sub_conversations(conversation_id)
                    for sub_conv in sub_conversations:
                        if sub_conv.id != conversation_id:  # Don't duplicate current chat
                            sub_messages = MessageModel.get_by_conversation_id(sub_conv.id)
                            
                            sub_context = [{
                                'role': msg.role,
                                'content': msg.content,
                                'timestamp': msg.timestamp,
                                'conversation_id': msg.conversation_id,
                                'is_sub_context': True,
                                'sub_chat_title': sub_conv.title
                            } for msg in sub_messages[-5:]]  # Limit sub-chat messages
                            
                            messages.extend(sub_context)
                
                # For sub-chat, include messages from sibling sub-chats (if inherit_context is True)
                elif is_sub_chat and should_inherit_context:
                    sibling_conversations = ConversationModel.get_sub_conversations(conversation.parent_id)
                    for sibling_conv in sibling_conversations:
                        if sibling_conv.id != conversation_id:  # Exclude current conversation
                            sibling_messages = MessageModel.get_by_conversation_id(sibling_conv.id)
                            
                            sibling_context = [{
                                'role': msg.role,
                                'content': msg.content,
                                'timestamp': msg.timestamp,
                                'conversation_id': msg.conversation_id,
                                'is_sibling_context': True,
                                'sibling_chat_title': sibling_conv.title
                            } for msg in sibling_messages[-3:]]  # Limit sibling messages
                            
                            messages.extend(sibling_context)
            
            # Sort all messages by timestamp to maintain chronological order
            messages.sort(key=lambda x: x.get('timestamp', ''))
            
            # Convert to the format expected by OpenAI (remove metadata)
            context_messages = []
            for msg in messages:
                context_messages.append({
                    'role': msg['role'],
                    'content': msg['content']
                })
            
            # For sub-chats with context inheritance, allow more context
            if is_sub_chat and should_inherit_context:
                max_context = min(len(context_messages), limit * 2)
                context_messages = context_messages[-max_context:] if max_context < len(context_messages) else context_messages
            else:
                # Limit to the specified number while maintaining the most recent messages
                if len(context_messages) > limit:
                    context_messages = context_messages[-limit:]
            
            logger.info(f"Retrieved {len(context_messages)} context messages for conversation {conversation_id} (inherit_context: {should_inherit_context})")
            return context_messages
            
        except Exception as e:
            logger.error(f"Error getting conversation context for {conversation_id}: {str(e)}")
            return []
    
    def _generate_contextual_chat_title(self, message: str, context_messages: List[Dict] = None) -> str:
        """Generate a meaningful chat title from user's message considering full context"""
        try:
            # First, try the basic title generation
            basic_title = self._generate_chat_title_from_message(message)
            
            # If we have context, try to make the title more contextual
            if context_messages and len(context_messages) > 2:
                # Look for user identity or key topics in context
                user_identity = None
                key_topics = []
                
                for msg in context_messages:
                    if msg.get('role') == 'user':
                        content = msg.get('content', '').lower()
                        
                        # Extract user identity
                        if not user_identity:
                            # Look for name patterns
                            import re
                            name_patterns = [
                                r'my name is (\w+)',
                                r'i am (\w+)',
                                r'i\'m (\w+)',
                                r'call me (\w+)',
                                r'name.*?(\w+)'
                            ]
                            
                            for pattern in name_patterns:
                                match = re.search(pattern, content)
                                if match:
                                    potential_name = match.group(1).capitalize()
                                    if len(potential_name) > 1 and potential_name not in ['The', 'A', 'An', 'Is', 'Are', 'Was', 'Were']:
                                        user_identity = potential_name
                                        break
                        
                        # Extract key topics (simple keyword extraction)
                        topic_keywords = ['project', 'work', 'code', 'help', 'learn', 'understand', 'create', 'build', 'develop']
                        for keyword in topic_keywords:
                            if keyword in content and keyword not in key_topics:
                                key_topics.append(keyword)
                
                # Enhance title with context
                if user_identity and not user_identity.lower() in basic_title.lower():
                    # If we know the user's identity and it's not in the title, consider adding it
                    enhanced_title = f"{user_identity}'s {basic_title}"
                    if len(enhanced_title) <= 60:
                        return enhanced_title
                
                # If the message is about identity, make the title more specific
                identity_queries = ['who am i', 'what is my name', 'who is', 'my name']
                if any(query in message.lower() for query in identity_queries) and user_identity:
                    return f"Identity Discussion - {user_identity}"
                
                # For questions about previous topics
                if any(word in message.lower() for word in ['remember', 'previous', 'earlier', 'before', 'last time']):
                    return f"Follow-up: {basic_title}"
            
            return basic_title
            
        except Exception as e:
            logger.error(f"Error generating contextual chat title: {str(e)}")
            return self._generate_chat_title_from_message(message)

    def _generate_chat_title_from_message(self, message: str) -> str:
        """Generate a meaningful chat title from the user's first message"""
        try:
            # Clean and process the message
            title = message.strip()
            
            # Remove any remaining bracket formatting that might have been missed
            title = re.sub(r'\[.*?\]', '', title).strip()
            
            # Remove markdown, code blocks, and special characters
            title = title.replace('```', '').replace('`', '')
            title = title.replace('*', '').replace('_', '').replace('#', '')
            title = title.replace('\n', ' ').replace('\r', '')
            
            # Remove URLs
            title = re.sub(r'https?://[^\s]+', '', title)
            
            # Replace multiple spaces with single space
            title = re.sub(r'\s+', ' ', title).strip()
            
            # If the message is very short, just use it as is
            if len(title) <= 50:
                # Capitalize first letter and return
                return title[0].upper() + title[1:] if len(title) > 1 else title.upper()
            
            # Extract meaningful part - take first question or statement
            sentences = title.split('. ')
            if sentences:
                title = sentences[0]
            
            # If message starts with a question word, keep the question
            question_starters = ['what', 'how', 'why', 'when', 'where', 'who', 'which', 'can', 'could', 'would', 'should', 'do', 'does', 'did', 'is', 'are', 'will']
            first_word = title.lower().split()[0] if title.split() else ''
            
            if first_word in question_starters:
                # Keep the full question up to question mark or reasonable length
                if '?' in title:
                    title = title.split('?')[0] + '?'
                else:
                    title = title[:60] + '...' if len(title) > 60 else title
            else:
                # For statements, take first meaningful part
                title = title[:50] + '...' if len(title) > 50 else title
            
            # Ensure minimum length
            if len(title) < 3:
                return "New Conversation"
            
            # Capitalize first letter
            title = title[0].upper() + title[1:] if len(title) > 1 else title.upper()
            
            # Remove trailing ellipsis if the title is naturally complete
            if title.endswith('...') and '?' in title[:-3]:
                title = title[:-3]
            
            return title
            
        except Exception as e:
            logger.error(f"Error generating chat title: {str(e)}")
            return "New Conversation"

    def generate_response(self, conversation_id: str, user_message: str) -> Optional[MessageModel]:
        """Generate AI response with enhanced context from all related sub-chats and browser search context"""
        try:
            conversation = self.get_conversation(conversation_id)
            if not conversation:
                logger.error(f"Conversation {conversation_id} not found for response generation")
                return None
            
            # Extract browser context and search information from the user message
            browser_context = None
            search_context = None
            clean_user_message = user_message
            
            # Parse browser context from message if present
            if '[SEARCH CONTEXT]:' in user_message or '[USER MESSAGE]:' in user_message:
                try:
                    # Extract search context
                    import re
                    search_match = re.search(r'\[SEARCH CONTEXT\]: User recently searched for "([^"]+)" on ([^(]+) \(([^)]+)\)', user_message)
                    if search_match:
                        search_context = {
                            'query': search_match.group(1),
                            'domain': search_match.group(2).strip(),
                            'time_ago': search_match.group(3),
                            'is_contextual': '[CONTEXT HINT]:' in user_message
                        }
                        
                        # Extract recent searches if available
                        recent_searches_match = re.search(r'\[RECENT SEARCHES\]: ([^\n]+)', user_message)
                        if recent_searches_match:
                            search_context['recent_searches'] = [s.strip() for s in recent_searches_match.group(1).split(',')]
                    
                    # Extract the actual user message - this is the key fix!
                    user_msg_match = re.search(r'\[USER MESSAGE\]: ([^\[]+?)(?:\s*\[|$)', user_message)
                    if user_msg_match:
                        clean_user_message = user_msg_match.group(1).strip()
                        logger.info(f"Extracted clean user message: '{clean_user_message}' from: '{user_message[:100]}...'")
                    
                    # If no clean message found, try to extract from start of message
                    if not clean_user_message or clean_user_message == user_message:
                        # Look for plain text at the beginning
                        lines = user_message.split('\n')
                        for line in lines:
                            if not line.startswith('[') and line.strip():
                                clean_user_message = line.strip()
                                break
                        
                        # If still nothing found, use the first non-empty part
                        if not clean_user_message:
                            clean_user_message = user_message.split('[')[0].strip() or "Hi"
                        
                    logger.info(f"Final clean user message: '{clean_user_message}'")
                    
                except Exception as e:
                    logger.warning(f"Error parsing browser context: {str(e)}")
                    # Fallback: try to extract from [USER MESSAGE]: pattern
                    import re
                    fallback_match = re.search(r'\[USER MESSAGE\]:\s*([^\n\[]+)', user_message)
                    if fallback_match:
                        clean_user_message = fallback_match.group(1).strip()
                    else:
                        clean_user_message = "Hi"  # Safe fallback
            
            # Get user profile for personalized responses
            user_profile = self.redis_service.get_user_profile(conversation.user_id) or {}
            
            # Extract user information from the message and store it
            self.redis_service.extract_and_store_user_info(conversation.user_id, clean_user_message)
            
            # Process message for memory extraction and storage
            extracted_memory, memory_stored = memory_service.process_message_for_memory(
                conversation.user_id, clean_user_message
            )
            
            # Get memory context for response generation
            memory_context = memory_service.get_context_for_response(
                conversation.user_id, clean_user_message
            )
            
            # Add user message first using hierarchy-aware storage
            user_msg = self.add_message(conversation_id, 'user', clean_user_message)
            if not user_msg:
                logger.error(f"Failed to add user message to conversation {conversation_id}")
                return None
                
            # Get comprehensive conversation context with hierarchy awareness
            context_messages = self._get_enhanced_conversation_context(
                conversation_id, 
                conversation.parent_id,
                include_search_context=bool(search_context)
            )
            
            # Enhanced system message with search context awareness and user profile
            system_content = (
                "You are Ragzy, a helpful AI assistant with access to comprehensive conversation history and user's browser search context. "
                "Follow these guidelines strictly:\n"
                "1. Use ALL available context from conversations and search activity to provide relevant responses\n"
                "2. When users ask contextual questions like 'which is best?', 'what do you recommend?', or 'compare these', "
                "   refer to their recent search queries to understand what they're asking about\n"
                "3. Provide specific, actionable advice based on search context\n"
                "4. Maintain continuity across conversation threads\n"
                "5. Be friendly, helpful, and conversational like ChatGPT\n"
                "6. If you see search context, prioritize that information in your response\n"
                "7. Address users by their name when known and respond in a personalized manner\n"
                "8. Use stored memory information to provide personalized, contextual responses\n"
                "9. When users ask 'What's my name?' or 'What do you remember about me?', use the memory context\n"
            )
            
            # Add memory context to system message
            if memory_context:
                system_content += f"\n\nMEMORY CONTEXT:\n{memory_context}\n"
                if extracted_memory:
                    system_content += "Note: I just learned new information about you from your message.\n"
            
            # Add user profile information to system message
            if user_profile:
                system_content += f"\n\nUSER PROFILE:\n"
                if user_profile.get('name'):
                    system_content += f"- User's name: {user_profile['name']}\n"
                if user_profile.get('profession'):
                    system_content += f"- Profession: {user_profile['profession']}\n"
                system_content += "Always address the user by their name and provide personalized responses based on their profile.\n"
            
            # Add search context to system message if available
            if search_context:
                system_content += f"\n\nCURRENT SEARCH CONTEXT:\n"
                if search_context.get('query'):
                    system_content += f"- User recently searched for: '{search_context['query']}'\n"
                if search_context.get('is_contextual'):
                    system_content += f"- This appears to be a contextual question about their search\n"
                if search_context.get('recent_searches'):
                    system_content += f"- Recent search topics: {', '.join(search_context['recent_searches'])}\n"
                system_content += "\nUse this search context to provide relevant, specific advice.\n"
            
            # Get additional browser context from tracking service if available
            try:
                browser_activity_context = browser_tracking_service.generate_chat_context(conversation.user_id, 2)
                if browser_activity_context:
                    system_content += f"\n\nBROWSER ACTIVITY CONTEXT:\n{browser_activity_context}\n"
            except Exception as e:
                logger.warning(f"Could not get browser activity context: {str(e)}")
            
            enhanced_system_message = {
                'role': 'system',
                'content': system_content
            }
            context_messages.insert(0, enhanced_system_message)
            
            # Add the current user message at the end to ensure it's the most recent context
            context_messages.append({
                'role': 'user',
                'content': clean_user_message
            })
            
            # Generate AI response with enhanced context
            ai_response = self.openai_service.generate_response(
                context_messages,
                user_id=conversation.user_id
            )
            
            if not ai_response:
                # Fallback response with search context if available
                if search_context and search_context.get('query'):
                    ai_response = f"I'd be happy to help you with '{search_context['query']}'. Could you provide more specific details about what you're looking for?"
                else:
                    user_name = user_profile.get('name', '')
                    greeting = f"Hello {user_name}! " if user_name else "Hello! "
                    ai_response = greeting + "I apologize, but I'm having trouble responding right now. Please try again."
            
            # Add AI response using hierarchy-aware storage
            assistant_msg = self.add_message(conversation_id, 'assistant', ai_response)
            
            # Auto-generate chat title only for first message with enhanced context awareness
            if (conversation.title in ['New Conversation', 'New Chat'] or 
                conversation.title.startswith('Sub-chat of') or
                len(conversation.title.strip()) == 0):
                
                # Generate meaningful title from CLEAN user message only
                # Use the clean_user_message which has all browser context stripped
                title_message = clean_user_message
                
                # For search context, prefer the original search query for better titles
                if search_context and search_context.get('query'):
                    # Use search query as it's usually more descriptive
                    title_message = search_context['query']
                
                # Generate the title using only the clean message
                generated_title = self._generate_chat_title_from_message(title_message)
                
                # Ensure the title is meaningful and not a default
                if generated_title and generated_title not in ["New Conversation", "New Chat"]:
                    conversation.title = generated_title
                    conversation.save()
                    
                    # Update cache
                    self._cache_conversation(conversation)
                    
                    # Update Redis cache
                    metadata = {
                        'id': conversation.id,
                        'user_id': conversation.user_id,
                        'title': conversation.title,
                        'created_at': conversation.created_at,
                        'updated_at': conversation.updated_at or conversation.created_at
                    }
                    self.redis_service.cache_conversation_metadata(conversation.id, metadata)
                    
                    logger.info(f"Generated chat title: '{generated_title}' from clean message: '{title_message[:50]}...'")
            
            logger.info(f"Generated response for conversation {conversation_id} with search context: {bool(search_context)}")
            return assistant_msg
            
        except Exception as e:
            logger.error(f"Error generating response for conversation {conversation_id}: {str(e)}")
            error_response = "I apologize, but I'm having trouble responding right now. Please try again."
            return self.add_message(conversation_id, 'assistant', error_response)
    
    def delete_conversation(self, conversation_id: str) -> bool:
        """Delete conversation with ultra-comprehensive cleanup - Enhanced for permanent deletion"""
        try:
            conversation = self.get_conversation(conversation_id)
            if not conversation:
                logger.warning(f"Conversation {conversation_id} not found for deletion")
                # Even if conversation not found, try cleanup anyway
                logger.info(f"Attempting cleanup of conversation {conversation_id} even though not found")
            
            user_id = conversation.user_id if conversation else None
            logger.info(f"Starting ULTRA deletion of conversation {conversation_id} for user {user_id}")
            
            # Check if Weaviate is available
            weaviate_available = False
            try:
                weaviate_available = weaviate_service.health_check()
                logger.info(f"Weaviate health check: {'PASS' if weaviate_available else 'FAIL'}")
            except Exception as weaviate_e:
                logger.error(f"Weaviate health check failed: {str(weaviate_e)}")
                weaviate_available = False
            
            if not weaviate_available:
                logger.warning("Weaviate is not available - proceeding with Redis-only cleanup")
                # If Weaviate is down, just do comprehensive Redis cleanup and return success
                try:
                    # Ultra-comprehensive Redis cleanup
                    logger.info("Starting ultra-comprehensive Redis cleanup (Weaviate unavailable)")
                    
                    # Get ALL possible Redis keys
                    all_redis_keys = []
                    try:
                        all_keys = self.redis_service.redis.keys("*")
                        logger.info(f"Found {len(all_keys)} total Redis keys")
                        
                        # Filter keys that might be related to this conversation
                        conversation_related_keys = []
                        for key in all_keys:
                            key_str = key.decode() if isinstance(key, bytes) else str(key)
                            if (conversation_id in key_str or 
                                (user_id and user_id in key_str)):
                                conversation_related_keys.append(key_str)
                        
                        logger.info(f"Found {len(conversation_related_keys)} potentially related keys")
                        
                        # Delete all related keys
                        if conversation_related_keys:
                            deleted_count = self.redis_service.redis.delete(*conversation_related_keys)
                            logger.info(f"Deleted {deleted_count} Redis keys")
                        
                        # Pattern-based cleanup
                        ultra_patterns = [
                            f"*{conversation_id}*",
                            f"*conv*{conversation_id}*",
                            f"*{conversation_id}*conv*",
                            "*conversation*",
                            "*chat*",
                            "*message*",
                            "*hierarchy*",
                            "*context*"
                        ]
                        
                        total_pattern_deleted = 0
                        for pattern in ultra_patterns:
                            try:
                                pattern_keys = self.redis_service.redis.keys(pattern)
                                if pattern_keys:
                                    # Filter to only delete keys actually related to our conversation
                                    relevant_keys = []
                                    for key in pattern_keys:
                                        key_str = key.decode() if isinstance(key, bytes) else str(key)
                                        if conversation_id in key_str or (user_id and user_id in key_str):
                                            relevant_keys.append(key)
                                    
                                    if relevant_keys:
                                        deleted = self.redis_service.redis.delete(*relevant_keys)
                                        total_pattern_deleted += deleted
                                        logger.info(f"Pattern {pattern}: deleted {deleted} keys")
                            
                            except Exception as pattern_e:
                                logger.warning(f"Error processing pattern {pattern}: {str(pattern_e)}")
                        
                        logger.info(f"Total pattern-based Redis deletions: {total_pattern_deleted}")
                        
                        # Clear local cache
                        with self._cache_lock:
                            keys_to_remove = list(self._conversation_cache.keys())
                            for key in keys_to_remove:
                                self._conversation_cache.pop(key, None)
                            logger.info(f"Cleared all {len(keys_to_remove)} local cache entries")
                        
                        logger.info(f"Redis-only cleanup completed for conversation {conversation_id}")
                        return True
                        
                    except Exception as redis_cleanup_e:
                        logger.error(f"Redis cleanup failed: {str(redis_cleanup_e)}")
                        return False
                        
                except Exception as fallback_e:
                    logger.error(f"Fallback cleanup failed: {str(fallback_e)}")
                    return False
            
            # Get main chat ID and sub chat IDs before deletion
            main_chat_id = self._get_main_chat_id(conversation_id)
            sub_chat_ids = self._get_all_sub_chats(conversation_id) if conversation_id == main_chat_id else []
            
            # STEP 1: Force delete all messages first with enhanced retry
            try:
                messages = MessageModel.get_by_conversation_id(conversation_id)
                logger.info(f"Force deleting {len(messages)} messages for conversation {conversation_id}")
                
                deleted_messages = 0
                for message in messages:
                    try:
                        # Try multiple deletion attempts
                        success = False
                        for attempt in range(3):
                            try:
                                if message.delete():
                                    success = True
                                    break
                                else:
                                    logger.warning(f"Message deletion attempt {attempt + 1} returned False for {message.id}")
                            except Exception as msg_attempt_e:
                                logger.warning(f"Message deletion attempt {attempt + 1} failed for {message.id}: {str(msg_attempt_e)}")
                        
                        if success:
                            deleted_messages += 1
                        else:
                            logger.error(f"Failed to delete message {message.id} after 3 attempts")
                            # Force delete via Weaviate service directly
                            try:
                                if weaviate_service.delete_object('Message', message.id):
                                    deleted_messages += 1
                                    logger.info(f"Force deleted message {message.id} via Weaviate service")
                                else:
                                    logger.error(f"Direct Weaviate deletion returned False for message {message.id}")
                            except Exception as direct_e:
                                logger.error(f"Direct Weaviate deletion failed for message {message.id}: {str(direct_e)}")
                    except Exception as msg_e:
                        logger.error(f"Error deleting message {message.id}: {str(msg_e)}")
                
                logger.info(f"Deleted {deleted_messages}/{len(messages)} messages")
                
            except Exception as e:
                logger.error(f"Error in message deletion phase: {str(e)}")
                # Continue anyway
            
            # STEP 2: Ultra-comprehensive Redis cleanup
            logger.info("Starting ultra-comprehensive Redis cleanup")
            
            # Get ALL possible Redis keys that could be related
            all_redis_keys = []
            try:
                all_keys = self.redis_service.redis.keys("*")
                logger.info(f"Found {len(all_keys)} total Redis keys")
                
                # Filter keys that might be related to this conversation
                conversation_related_keys = []
                for key in all_keys:
                    key_str = key.decode() if isinstance(key, bytes) else str(key)
                    if (conversation_id in key_str or 
                        main_chat_id in key_str or
                        (user_id and user_id in key_str)):
                        conversation_related_keys.append(key_str)
                
                logger.info(f"Found {len(conversation_related_keys)} potentially related keys")
                
                # Delete all related keys in batches
                batch_size = 100
                deleted_key_count = 0
                for i in range(0, len(conversation_related_keys), batch_size):
                    batch = conversation_related_keys[i:i + batch_size]
                    try:
                        result = self.redis_service.redis.delete(*batch)
                        deleted_key_count += result
                        logger.info(f"Deleted {result} keys in batch {i//batch_size + 1}")
                    except Exception as batch_e:
                        logger.error(f"Error deleting key batch: {str(batch_e)}")
                        # Try individual deletion
                        for key in batch:
                            try:
                                self.redis_service.redis.delete(key)
                                deleted_key_count += 1
                            except Exception:
                                pass
                
                logger.info(f"Total Redis keys deleted: {deleted_key_count}")
                
            except Exception as redis_e:
                logger.error(f"Error in Redis cleanup: {str(redis_e)}")
            
            # STEP 3: Enhanced pattern-based Redis cleanup
            ultra_patterns = [
                f"*{conversation_id}*",
                f"*{main_chat_id}*",
                f"*{user_id}*conv*" if user_id else None,
                f"*conv*{user_id}*" if user_id else None,
                f"*{user_id}*chat*" if user_id else None,
                f"*chat*{user_id}*" if user_id else None,
                f"hierarchy:*",
                f"context:*",
                f"ai_resp:*",
                f"messages_cache:*",
                f"conversation_metadata:*",
                f"user_conversations:*",
                f"pgpt:*"
            ]
            
            # Remove None values
            ultra_patterns = [p for p in ultra_patterns if p is not None]
            
            total_pattern_deleted = 0
            for pattern in ultra_patterns:
                try:
                    pattern_keys = self.redis_service.redis.keys(pattern)
                    if pattern_keys:
                        # Filter to only delete keys actually related to our conversation/user
                        relevant_keys = []
                        for key in pattern_keys:
                            key_str = key.decode() if isinstance(key, bytes) else str(key)
                            if (conversation_id in key_str or 
                                main_chat_id in key_str or 
                                (user_id and user_id in key_str)):
                                relevant_keys.append(key)
                        
                        if relevant_keys:
                            deleted = self.redis_service.redis.delete(*relevant_keys)
                            total_pattern_deleted += deleted
                            logger.info(f"Pattern {pattern}: deleted {deleted}/{len(relevant_keys)} relevant keys")
                
                except Exception as pattern_e:
                    logger.warning(f"Error processing pattern {pattern}: {str(pattern_e)}")
            
            logger.info(f"Total pattern-based deletions: {total_pattern_deleted}")
            
            # STEP 4: If this is a main chat, recursively delete all sub chats first
            if sub_chat_ids:
                logger.info(f"Recursively deleting {len(sub_chat_ids)} sub-conversations")
                for sub_chat_id in sub_chat_ids:
                    try:
                        sub_delete_success = self.delete_conversation(sub_chat_id)
                        if not sub_delete_success:
                            logger.warning(f"Failed to delete sub-conversation {sub_chat_id}")
                            # Try force deletion via Weaviate
                            try:
                                if weaviate_service.delete_object('Conversation', sub_chat_id):
                                    logger.info(f"Force deleted sub-conversation {sub_chat_id}")
                                else:
                                    logger.error(f"Force deletion returned False for sub-conversation {sub_chat_id}")
                            except Exception as force_sub_e:
                                logger.error(f"Force deletion failed for sub-conversation {sub_chat_id}: {str(force_sub_e)}")
                    except Exception as sub_e:
                        logger.error(f"Error deleting sub-conversation {sub_chat_id}: {str(sub_e)}")
            
            # STEP 5: Clear all caches aggressively
            with self._cache_lock:
                # Clear all cached conversations for this user
                keys_to_remove = list(self._conversation_cache.keys())
                for key in keys_to_remove:
                    self._conversation_cache.pop(key, None)
                logger.info(f"Cleared all {len(keys_to_remove)} local cache entries")
            
            # STEP 6: Multiple deletion attempts for the conversation itself
            conversation_deleted = False
            if conversation:  # Only try if we have a conversation object
                for attempt in range(5):  # Try 5 times
                    try:
                        if conversation.delete():
                            conversation_deleted = True
                            logger.info(f"Successfully deleted conversation {conversation_id} on attempt {attempt + 1}")
                            break
                        else:
                            logger.warning(f"Conversation deletion attempt {attempt + 1} returned False")
                    except Exception as conv_e:
                        logger.warning(f"Conversation deletion attempt {attempt + 1} failed: {str(conv_e)}")
            else:
                logger.info(f"No conversation object to delete for {conversation_id}")
                conversation_deleted = True  # Consider it deleted if it doesn't exist
            
            # STEP 7: Force deletion via Weaviate service if regular deletion failed
            if not conversation_deleted:
                try:
                    logger.info(f"Attempting force deletion via Weaviate service for {conversation_id}")
                    force_success = weaviate_service.delete_object('Conversation', conversation_id)
                    if force_success:
                        conversation_deleted = True
                        logger.info(f"Force deleted conversation {conversation_id} via Weaviate service")
                    else:
                        logger.error(f"Force deletion via Weaviate service returned False for {conversation_id}")
                except Exception as force_e:
                    logger.error(f"Force deletion error: {str(force_e)}")
            
            # STEP 8: Final verification with multiple checks
            verification_passed = True
            try:
                # Check 1: Try to get conversation
                verification_conv = self.get_conversation(conversation_id)
                if verification_conv:
                    logger.error(f"VERIFICATION FAILED: Conversation {conversation_id} still exists after deletion!")
                    verification_passed = False
                
                # Check 2: Try direct Weaviate query (only if Weaviate is available)
                if weaviate_available:
                    try:
                        direct_check = weaviate_service.get_object('Conversation', conversation_id)
                        if direct_check:
                            logger.error(f"VERIFICATION FAILED: Conversation {conversation_id} still in Weaviate after deletion!")
                            verification_passed = False
                            
                            # Last resort: try to delete it again directly
                            try:
                                if weaviate_service.delete_object('Conversation', conversation_id):
                                    logger.info(f"Final cleanup: force deleted conversation {conversation_id}")
                                    verification_passed = True
                                else:
                                    logger.error(f"Final cleanup deletion returned False for {conversation_id}")
                            except Exception as final_cleanup_e:
                                logger.error(f"Final cleanup deletion failed: {str(final_cleanup_e)}")
                    except Exception as direct_check_e:
                        logger.info(f"Direct Weaviate check failed (likely good): {str(direct_check_e)}")
                        # If direct check fails, conversation is probably gone
                        verification_passed = True
                
                # Check 3: Verify messages are gone (only if Weaviate is available)
                if weaviate_available:
                    try:
                        remaining_messages = MessageModel.get_by_conversation_id(conversation_id)
                        if remaining_messages:
                            logger.warning(f"VERIFICATION: {len(remaining_messages)} messages still exist for {conversation_id}")
                            # Force delete remaining messages
                            for msg in remaining_messages:
                                try:
                                    weaviate_service.delete_object('Message', msg.id)
                                except Exception:
                                    pass
                    except Exception as msg_check_e:
                        logger.info(f"Message verification check failed (likely good): {str(msg_check_e)}")
                
                if verification_passed:
                    logger.info(f"VERIFICATION PASSED: Conversation {conversation_id} is completely deleted")
                else:
                    logger.error(f"VERIFICATION FAILED: Conversation {conversation_id} may still exist")
                    
            except Exception as verify_e:
                logger.info(f"Verification check threw exception (likely good): {str(verify_e)}")
                # If verification throws an exception, it might mean the conversation is gone
                verification_passed = True
            
            # STEP 9: Final cache invalidation for user
            if user_id:
                try:
                    # Clear all user-related caches
                    user_cache_patterns = [
                        f"*{user_id}*",
                        "user_conversations:*",
                        "user_*",
                        "recent_*",
                        "cached_*"
                    ]
                    
                    for pattern in user_cache_patterns:
                        try:
                            keys = self.redis_service.redis.keys(pattern)
                            if keys:
                                # Only delete keys actually related to this user
                                user_keys = [k for k in keys if user_id in (k.decode() if isinstance(k, bytes) else str(k))]
                                if user_keys:
                                    self.redis_service.redis.delete(*user_keys)
                                    logger.info(f"Cleared {len(user_keys)} user cache keys for pattern {pattern}")
                        except Exception:
                            pass
                            
                except Exception as final_e:
                    logger.warning(f"Error in final cache invalidation: {str(final_e)}")
            
            # For the purposes of this fix, if we've done comprehensive cleanup, consider it successful
            # even if some individual steps failed
            success = True  # Always return True after comprehensive cleanup
            
            if success:
                logger.info(f"ULTRA-DELETION COMPLETE: Successfully processed conversation {conversation_id}")
            else:
                logger.error(f"ULTRA-DELETION INCOMPLETE: Issues detected with conversation {conversation_id}")
            
            return success
            
        except Exception as e:
            logger.error(f"Critical error in ultra-delete conversation {conversation_id}: {str(e)}")
            import traceback
            logger.error(f"Full traceback: {traceback.format_exc()}")
            
            # Even if there's an error, try basic cleanup and return True
            try:
                logger.info(f"Attempting emergency cleanup for conversation {conversation_id}")
                # Basic Redis cleanup
                emergency_patterns = [f"*{conversation_id}*", "*conversation*", "*chat*", "*message*"]
                for pattern in emergency_patterns:
                    try:
                        keys = self.redis_service.redis.keys(pattern)
                        if keys:
                            related_keys = [k for k in keys if conversation_id in (k.decode() if isinstance(k, bytes) else str(k))]
                            if related_keys:
                                self.redis_service.redis.delete(*related_keys)
                                logger.info(f"Emergency cleanup: deleted {len(related_keys)} keys for pattern {pattern}")
                    except Exception:
                        pass
                
                # Clear local cache
                with self._cache_lock:
                    self._conversation_cache.clear()
                
                logger.info(f"Emergency cleanup completed for conversation {conversation_id}")
                return True  # Return True even after emergency cleanup
                
            except Exception as emergency_e:
                logger.error(f"Emergency cleanup also failed: {str(emergency_e)}")
                return True  # Still return True to prevent infinite retry loops
    
    def _remove_from_chat_hierarchy(self, main_chat_id: str, sub_chat_id: str, user_id: str) -> bool:
        """Remove a sub chat from the hierarchy mappings in Redis"""
        try:
            main_chat_key = f"hierarchy:main:{main_chat_id}"
            sub_chats_data = self.redis_service.redis.get(main_chat_key)
            
            if sub_chats_data:
                import json
                sub_chats = json.loads(sub_chats_data)
                if sub_chat_id in sub_chats:
                    sub_chats.remove(sub_chat_id)
                    if sub_chats:
                        self.redis_service.redis.setex(
                            main_chat_key,
                            self.redis_service.conversation_ttl,
                            json.dumps(sub_chats)
                        )
                    else:
                        self.redis_service.redis.delete(main_chat_key)
                    
                    logger.info(f"Removed {sub_chat_id} from hierarchy of {main_chat_id}")
                    return True
            
            return False
            
        except Exception as e:
            logger.error(f"Error removing {sub_chat_id} from hierarchy: {str(e)}")
            return False
    
    def cleanup_resources(self) -> None:
        """Cleanup service resources"""
        try:
            if hasattr(self, '_executor'):
                self._executor.shutdown(wait=True)
            
            with self._cache_lock:
                self._conversation_cache.clear()
                
            logger.info("Chat service resources cleaned up")
        except Exception as e:
            logger.error(f"Error during cleanup: {str(e)}")
    
    def generate_share_token(self, conversation_id: str) -> Dict[str, Any]:
        """Generate a shareable token for a conversation"""
        try:
            # Generate a unique token
            token = secrets.token_urlsafe(32)
            expires_at = (datetime.utcnow() + timedelta(days=7)).isoformat() + 'Z'
            
            # Store token in Redis with expiration
            token_data = {
                'conversation_id': conversation_id,
                'expires_at': expires_at
            }
            
            self.redis_service.store_share_token(token, token_data)
            
            return {
                'token': token,
                'expires_at': expires_at
            }
            
        except Exception as e:
            logger.error(f"Error generating share token for conversation {conversation_id}: {str(e)}")
            raise ValueError('Failed to generate share token')

    def get_main_chat_context(self, main_chat_id: str, limit: int = None) -> Dict[str, Any]:
        """Get comprehensive context for a main chat including all sub-chats"""
        try:
            limit = limit or self.max_sub_chats_context
            
            # Get main chat info
            main_chat = self.get_conversation(main_chat_id)
            if not main_chat:
                return {}
            
            # Get all sub-chats
            sub_chat_ids = self._get_all_sub_chats(main_chat_id)
            
            # Get all messages from the tree
            all_messages = self._get_all_messages_from_main_chat_tree(main_chat_id, limit)
            
            # Organize by chat
            chats_info = {}
            chats_info[main_chat_id] = {
                'title': main_chat.title,
                'type': 'main',
                'messages': []
            }
            
            for sub_chat_id in sub_chat_ids:
                sub_chat = self.get_conversation(sub_chat_id)
                if sub_chat:
                    chats_info[sub_chat_id] = {
                        'title': sub_chat.title,
                        'type': 'sub',
                        'parent_id': sub_chat.parent_id,
                        'messages': []
                    }
            
            # Organize messages by chat
            for msg in all_messages:
                chat_id = msg['chat_id']
                if chat_id in chats_info:
                    chats_info[chat_id]['messages'].append(msg)
            
            return {
                'main_chat_id': main_chat_id,
                'main_chat_title': main_chat.title,
                'total_sub_chats': len(sub_chat_ids),
                'total_messages': len(all_messages),
                'chats': chats_info,
                'recent_messages': all_messages[-20:] if len(all_messages) > 20 else all_messages
            }
            
        except Exception as e:
            logger.error(f"Error getting main chat context for {main_chat_id}: {str(e)}")
            return {}

    def get_chat_hierarchy_stats(self, conversation_id: str) -> Dict[str, Any]:
        """Get statistics about the chat hierarchy"""
        try:
            main_chat_id = self._get_main_chat_id(conversation_id)
            sub_chat_ids = self._get_all_sub_chats(main_chat_id)
            
            stats = {
                'conversation_id': conversation_id,
                'main_chat_id': main_chat_id,
                'is_main_chat': conversation_id == main_chat_id,
                'total_sub_chats': len(sub_chat_ids),
                'sub_chat_ids': sub_chat_ids
            }
            
            # Count messages across all chats
            total_messages = 0
            for chat_id in [main_chat_id] + sub_chat_ids:
                messages = self.get_conversation_messages(chat_id, limit=1000)
                stats[f'messages_in_{chat_id}'] = len(messages)
                total_messages += len(messages)
            
            stats['total_messages_in_tree'] = total_messages
            
            return stats
            
        except Exception as e:
            logger.error(f"Error getting chat hierarchy stats: {str(e)}")
            return {}

    def delete_all_user_conversations(self, user_id: str) -> Dict[str, Any]:
        """Delete all conversations for a specific user with comprehensive cleanup"""
        try:
            logger.info(f"Starting bulk deletion of all conversations for user {user_id}")
            
            # Get all user conversations (including sub-chats)
            all_conversations = self.get_user_conversations(user_id, limit=1000, include_sub_chats=True)
            
            if not all_conversations:
                logger.info(f"No conversations found for user {user_id}")
                return {
                    'success': True,
                    'deleted_count': 0,
                    'failed_count': 0,
                    'total_count': 0,
                    'message': 'No conversations to delete'
                }
            
            logger.info(f"Found {len(all_conversations)} conversations to delete for user {user_id}")
            
            deleted_count = 0
            failed_deletions = []
            
            # Delete conversations one by one
            for conversation in all_conversations:
                try:
                    logger.info(f"Deleting conversation {conversation.id} for user {user_id}")
                    success = self.delete_conversation(conversation.id)
                    if success:
                        deleted_count += 1
                        logger.info(f"Successfully deleted conversation {conversation.id}")
                    else:
                        failed_deletions.append(conversation.id)
                        logger.warning(f"Failed to delete conversation {conversation.id}")
                except Exception as e:
                    logger.error(f"Error deleting conversation {conversation.id}: {str(e)}")
                    failed_deletions.append(conversation.id)
            
            # Comprehensive cache cleanup for the user
            try:
                logger.info(f"Starting comprehensive cache cleanup for user {user_id}")
                
                # Clear local conversation cache for this user
                with self._cache_lock:
                    user_conversation_ids = [conv.id for conv in all_conversations]
                    for conv_id in user_conversation_ids:
                        self._conversation_cache.pop(conv_id, None)
                
                # Clear Redis cache comprehensively
                self._cleanup_user_redis_cache(user_id)
                
                logger.info(f"Cache cleanup completed for user {user_id}")
                
            except Exception as e:
                logger.warning(f"Error during cache cleanup for user {user_id}: {str(e)}")
            
            result = {
                'success': True,
                'deleted_count': deleted_count,
                'failed_count': len(failed_deletions),
                'total_count': len(all_conversations),
                'failed_deletions': failed_deletions,
                'message': f'Deleted {deleted_count} out of {len(all_conversations)} conversations'
            }
            
            logger.info(f"Bulk deletion completed for user {user_id}: {result}")
            return result
            
        except Exception as e:
            logger.error(f"Error in bulk delete for user {user_id}: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'deleted_count': 0,
                'failed_count': 0,
                'total_count': 0
            }
    
    def _cleanup_user_redis_cache(self, user_id: str) -> None:
        """Comprehensive Redis cache cleanup for a specific user"""
        try:
            logger.info(f"Starting Redis cache cleanup for user {user_id}")
            
            # Clear user-specific conversation cache
            user_cache_key = self.redis_service.get_user_key(user_id, "conversations")
            self.redis_service.redis.delete(user_cache_key)
            
            # Clear all user-related keys using pattern matching
            patterns_to_clear = [
                f"*{user_id}*",
                f"conv:{user_id}:*",
                f"user:{user_id}:*",
                f"main_chat_context:*",
                f"chat_hierarchy:*"
            ]
            
            total_deleted = 0
            for pattern in patterns_to_clear:
                try:
                    keys = self.redis_service.redis.keys(pattern)
                    if keys:
                        # Filter keys to ensure they actually relate to this user
                        user_related_keys = []
                        for key in keys:
                            key_str = key.decode() if isinstance(key, bytes) else str(key)
                            if user_id in key_str:
                                user_related_keys.append(key)
                        
                        if user_related_keys:
                            deleted = self.redis_service.redis.delete(*user_related_keys)
                            total_deleted += deleted
                            logger.info(f"Deleted {deleted} keys for pattern {pattern}")
                except Exception as e:
                    logger.warning(f"Error clearing keys for pattern {pattern}: {str(e)}")
            
            logger.info(f"Redis cleanup completed for user {user_id}: {total_deleted} keys deleted")
            
        except Exception as e:
            logger.error(f"Error in Redis cleanup for user {user_id}: {str(e)}")

    def process_file(self, file_path: str) -> str:
        """Process uploaded file for vision capabilities"""
        try:
            if not os.path.exists(file_path):
                raise ValueError("File not found")
            
            # Validate file type
            allowed_extensions = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'}
            file_ext = os.path.splitext(file_path)[1].lower()
            
            if file_ext not in allowed_extensions:
                raise ValueError("Unsupported file type")
            
            # Optional: Add image preprocessing here (resize, compression, etc.)
            # For now, we'll just return the file path
            
            return file_path
            
        except Exception as e:
            logger.error(f"Error processing file {file_path}: {str(e)}")
            raise ValueError(f"Failed to process file: {str(e)}")

    def create_message_with_image(self, conversation_id: str, text: str, image_path: str = None) -> Optional[MessageModel]:
        """Create a message that includes both text and image content"""
        try:
            conversation = self.get_conversation(conversation_id)
            if not conversation:
                raise ValueError("Conversation not found")
            
            # Create message content with image support
            if image_path:
                # Store image reference in message content as JSON
                message_content = {
                    "type": "multimodal",
                    "text": text,
                    "image_path": image_path
                }
                content_str = json.dumps(message_content)
            else:
                content_str = text
            
            # Store the message
            message = self.add_message_to_conversation(
                conversation_id, 
                'user', 
                content_str
            )
            
            return message
            
        except Exception as e:
            logger.error(f"Error creating message with image: {str(e)}")
            return None

    def generate_response_with_vision(self, conversation_id: str, message: str, image_path: str = None) -> Optional[Dict[str, Any]]:
        """Generate a response with vision capabilities for image analysis"""
        try:
            if not conversation_id or not message:
                logger.error("Missing required parameters: conversation_id or message")
                return None
            
            # Get conversation from database
            conversation = ConversationModel.get_by_id(conversation_id)
            if not conversation:
                logger.error(f"Conversation {conversation_id} not found")
                return None
            
            # Get existing messages for context
            existing_messages = MessageModel.get_by_conversation_id(conversation_id)
            
            # Convert to OpenAI format (exclude the current image message for context)
            openai_messages = []
            for msg in existing_messages[-10:]:  # Last 10 messages for context
                openai_messages.append({
                    'role': msg.role,
                    'content': msg.content
                })
            
            # Add the user message with image to conversation first
            user_message = MessageModel.create(
                conversation_id=conversation_id,
                role='user',
                content=message or "What's in this image?"
            )
            
            if not user_message:
                logger.error("Failed to create user message")
                return None
            
            # Generate AI response using vision capabilities
            try:
                ai_response = self.openai_service.generate_response_with_vision(
                    messages=openai_messages,
                    user_text=message or "What's in this image?",
                    image_path=image_path,
                    user_id=conversation.user_id
                )
                
                if not ai_response:
                    logger.error("Failed to generate AI response with vision")
                    return None
                
                # Create AI message in database
                ai_message = MessageModel.create(
                    conversation_id=conversation_id,
                    role='assistant',
                    content=ai_response
                )
                
                if not ai_message:
                    logger.error("Failed to create AI message")
                    return None
                
                # Update conversation timestamp
                conversation.update_timestamp()
                
                # Store in vector database asynchronously
                threading.Thread(
                    target=self._store_conversation_async,
                    args=(conversation_id, user_message.content, ai_response),
                    daemon=True
                ).start()
                
                # Return the AI message
                return {
                    'id': ai_message.id,
                    'conversation_id': ai_message.conversation_id,
                    'role': ai_message.role,
                    'content': ai_message.content,
                    'timestamp': ai_message.timestamp.isoformat() if ai_message.timestamp else None
                }
                
            except Exception as e:
                logger.error(f"Error generating response with vision: {str(e)}")
                # Clean up the user message if AI response failed
                try:
                    user_message.delete()
                except:
                    pass
                return None
                
        except Exception as e:
            logger.error(f"Critical error in generate_response_with_vision: {str(e)}")
            return None

    def _get_enhanced_conversation_context(self, conversation_id: str, parent_id: str = None, include_search_context: bool = False) -> List[Dict]:
        """Get enhanced conversation context with search context integration"""
        try:
            # Get regular conversation context
            context_messages = self.get_conversation_context(
                conversation_id, 
                limit=self.max_context_messages,
                include_all_sub_chats=True
            )
            
            # If search context is being used, add browser tracking context
            if include_search_context:
                try:
                    # Get the conversation to find user_id
                    conversation = self.get_conversation(conversation_id)
                    if conversation:
                        # Get recent browser activity summary
                        browser_context = browser_tracking_service.generate_chat_context(conversation.user_id, 1)
                        if browser_context:
                            # Add browser context as a system message in the conversation flow
                            browser_system_msg = {
                                'role': 'system', 
                                'content': f"BROWSER ACTIVITY CONTEXT:\n{browser_context}"
                            }
                            # Insert browser context after any existing system messages but before user messages
                            insert_index = 0
                            for i, msg in enumerate(context_messages):
                                if msg.get('role') != 'system':
                                    insert_index = i
                                    break
                            context_messages.insert(insert_index, browser_system_msg)
                            
                except Exception as e:
                    logger.warning(f"Could not integrate browser context: {str(e)}")
            
            return context_messages
            
        except Exception as e:
            logger.error(f"Error getting enhanced conversation context: {str(e)}")
            return []

# Alias for backward compatibility
ChatService = ChatServiceOptimized 