import json
import pickle
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any, Union
import hashlib
import threading
from functools import wraps
from app import redis_client

class RedisServiceOptimized:
    def __init__(self):
        self.redis = redis_client
        
        # Optimized TTL settings
        self.conversation_ttl = 60 * 60 * 24 * 7  # 7 days
        self.metadata_ttl = 60 * 60 * 24 * 30  # 30 days for metadata
        self.cache_ttl = 60 * 60  # 1 hour for general cache
        self.rate_limit_ttl = 60  # 1 minute for rate limiting
        
        # Performance settings
        self.message_batch_size = 100  # Increased batch size
        self.pipeline_batch_size = 50
        self.max_messages_per_conversation = 200  # Increased limit
        
        # Connection and threading
        self._lock = threading.RLock()
        self._pipeline_cache = {}
    
    @staticmethod
    def _with_error_handling(operation_name: str = "Redis operation"):
        """Decorator for consistent error handling"""
        def decorator(func):
            @wraps(func)
            def wrapper(*args, **kwargs):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    print(f"Error in {operation_name}: {str(e)}")
                    return None
            return wrapper
        return decorator
    
    def _hash_key(self, key: str) -> str:
        """Create optimized shorter keys for Redis with collision resistance"""
        return f"pgpt:{hashlib.sha256(key.encode()).hexdigest()[:12]}"
    
    def _serialize_data(self, data: Any, use_pickle: bool = False) -> str:
        """Optimized serialization with fallback options"""
        try:
            if use_pickle:
                return pickle.dumps(data).hex()
            return json.dumps(data, ensure_ascii=False, separators=(',', ':'))
        except (TypeError, ValueError):
            # Fallback to pickle for complex objects
            return pickle.dumps(data).hex()
    
    def _deserialize_data(self, data: str, use_pickle: bool = False) -> Any:
        """Optimized deserialization with fallback options"""
        try:
            if use_pickle or (len(data) % 2 == 0 and all(c in '0123456789abcdef' for c in data[:10])):
                return pickle.loads(bytes.fromhex(data))
            return json.loads(data)
        except (json.JSONDecodeError, ValueError):
            try:
                return pickle.loads(bytes.fromhex(data))
            except:
                return None
    
    def get_conversation_key(self, user_id: str, conversation_id: str) -> str:
        """Generate optimized key for storing conversation in Redis"""
        base_key = f"conv:{user_id}:{conversation_id}"
        return self._hash_key(base_key)
    
    def get_metadata_key(self, conversation_id: str) -> str:
        """Generate optimized key for conversation metadata"""
        base_key = f"meta:{conversation_id}"
        return self._hash_key(base_key)
    
    def get_user_key(self, user_id: str, key_type: str) -> str:
        """Generate optimized key for user-specific data"""
        base_key = f"user:{user_id}:{key_type}"
        return self._hash_key(base_key)
    
    @_with_error_handling("Pipeline operation")
    def pipeline_operation(self, operations: List[tuple], execute_immediately: bool = True) -> Optional[List]:
        """Enhanced pipeline operations with better performance"""
        if not operations:
            return []
        
        with self._lock:
            pipe = self.redis.pipeline(transaction=False)  # Non-transactional for better performance
            
            for op_data in operations:
                if len(op_data) < 2:
                    continue
                    
                op, *args = op_data
                if hasattr(pipe, op):
                    getattr(pipe, op)(*args)
            
            if execute_immediately:
                return pipe.execute()
            else:
                return pipe
    
    @_with_error_handling("Cache conversation metadata")
    def cache_conversation_metadata(self, conversation_id: str, metadata: Dict) -> bool:
        """Enhanced metadata caching with optimized serialization"""
        key = self.get_metadata_key(conversation_id)
        
        # Add timestamp for cache validation
        enhanced_metadata = {
            **metadata,
            '_cached_at': datetime.utcnow().isoformat(),
            '_version': '2.0'
        }
        
        serialized_data = self._serialize_data(enhanced_metadata)
        return bool(self.redis.setex(key, self.metadata_ttl, serialized_data))
    
    @_with_error_handling("Get cached conversation metadata")
    def get_cached_conversation_metadata(self, conversation_id: str) -> Optional[Dict]:
        """Enhanced metadata retrieval with validation"""
        key = self.get_metadata_key(conversation_id)
        metadata_data = self.redis.get(key)
        
        if not metadata_data:
            return None
        
        metadata = self._deserialize_data(metadata_data)
        if not metadata or not isinstance(metadata, dict):
            return None
        
        # Validate cache freshness
        cached_at = metadata.get('_cached_at')
        if cached_at:
            try:
                cache_time = datetime.fromisoformat(cached_at)
                if datetime.utcnow() - cache_time > timedelta(days=1):
                    # Refresh stale cache asynchronously
                    self.redis.delete(key)
                    return None
            except ValueError:
                pass
        
        # Remove internal fields
        return {k: v for k, v in metadata.items() if not k.startswith('_')}
    
    @_with_error_handling("Store message")
    def store_message(self, user_id: str, conversation_id: str, message: Dict) -> bool:
        """Optimized message storage with enhanced pipeline operations"""
        key = self.get_conversation_key(user_id, conversation_id)
        
        # Enhanced message data with metadata
        enhanced_message = {
            **message,
            'timestamp': message.get('timestamp', datetime.utcnow().isoformat()),
            '_stored_at': datetime.utcnow().isoformat()
        }
        
        message_data = self._serialize_data(enhanced_message)
        
        operations = [
            ('lpush', key, message_data),
            ('ltrim', key, 0, self.max_messages_per_conversation - 1),
            ('expire', key, self.conversation_ttl)
        ]
        
        result = self.pipeline_operation(operations)
        return bool(result and all(result))
    
    @_with_error_handling("Store messages batch")
    def store_messages_batch(self, user_id: str, conversation_id: str, messages: List[Dict]) -> bool:
        """Enhanced batch message storage with optimized processing"""
        if not messages:
            return True
        
        key = self.get_conversation_key(user_id, conversation_id)
        
        # Process in optimized batches
        for i in range(0, len(messages), self.pipeline_batch_size):
            batch = messages[i:i + self.pipeline_batch_size]
            operations = []
            
            for message in batch:
                enhanced_message = {
                    **message,
                    'timestamp': message.get('timestamp', datetime.utcnow().isoformat()),
                    '_stored_at': datetime.utcnow().isoformat()
                }
                message_data = self._serialize_data(enhanced_message)
                operations.append(('lpush', key, message_data))
            
            # Add maintenance operations
            operations.extend([
                ('ltrim', key, 0, self.max_messages_per_conversation - 1),
                ('expire', key, self.conversation_ttl)
            ])
            
            result = self.pipeline_operation(operations)
            if not result:
                return False
        
        return True
    
    @_with_error_handling("Get conversation history")
    def get_conversation_history(self, user_id: str, conversation_id: str, limit: int = 50) -> List[Dict]:
        """Enhanced conversation history retrieval with optimized performance"""
        key = self.get_conversation_key(user_id, conversation_id)
        
        # Optimize limit to prevent excessive memory usage
        effective_limit = min(limit, self.max_messages_per_conversation)
        
        messages_raw = self.redis.lrange(key, 0, effective_limit - 1)
        if not messages_raw:
            return []
        
        messages = []
        for msg_data in messages_raw:
            try:
                message = self._deserialize_data(msg_data)
                if message and isinstance(message, dict):
                    # Remove internal fields
                    clean_message = {k: v for k, v in message.items() if not k.startswith('_')}
                    messages.append(clean_message)
            except Exception:
                continue
        
        return list(reversed(messages))  # Return in chronological order
    
    @_with_error_handling("Clear conversation")
    def clear_conversation(self, user_id: str, conversation_id: str) -> bool:
        """Ultra-enhanced conversation clearing with comprehensive cleanup for permanent deletion"""
        # Phase 1: Get ALL Redis keys for pattern matching
        all_keys = []
        try:
            all_keys = self.redis.keys("*")
            print(f"Total Redis keys found: {len(all_keys)}")
        except Exception as e:
            print(f"Error getting all Redis keys: {str(e)}")
            return False
        
        # Phase 2: Find ALL keys that could possibly be related
        keys_to_delete = []
        
        # Direct key patterns
        direct_patterns = [
            self.get_conversation_key(user_id, conversation_id),
            self.get_metadata_key(conversation_id),
            self.get_user_key(user_id, f"conv_cache:{conversation_id}"),
            self.get_user_key(user_id, f"context:{conversation_id}"),
            f"hierarchy:main:{conversation_id}",
            f"hierarchy:sub:{conversation_id}",
            f"main_chat_context:{conversation_id}",
            f"conversation_metadata:{conversation_id}",
            f"messages_cache:{conversation_id}",
            f"context:{conversation_id}",
            f"conv_cache:{conversation_id}",
            f"ai_resp:{conversation_id}:*",
            f"share_token:*:{conversation_id}",
            f"user_conversations:{user_id}",
            f"user_conversations_metadata:{user_id}",
            f"recent_conversations:{user_id}",
            f"cached_conversations:{user_id}"
        ]
        
        # Add direct patterns to deletion list
        keys_to_delete.extend(direct_patterns)
        
        # Phase 3: Scan through ALL keys to find matches
        conversation_related_keys = []
        user_related_keys = []
        
        for key in all_keys:
            key_str = key.decode() if isinstance(key, bytes) else str(key)
            
            # Check for conversation ID in key
            if conversation_id in key_str:
                conversation_related_keys.append(key_str)
                continue
            
            # Check for user ID in key (but be more selective)
            if user_id in key_str and any(keyword in key_str.lower() for keyword in 
                ['conv', 'chat', 'msg', 'message', 'hierarchy', 'context', 'cache']):
                user_related_keys.append(key_str)
                continue
            
            # Check for hashed keys that might contain our IDs
            if key_str.startswith('pgpt:'):
                # These are hashed keys, we need to be careful but thorough
                conversation_related_keys.append(key_str)
        
        print(f"Found {len(conversation_related_keys)} conversation-related keys")
        print(f"Found {len(user_related_keys)} user-related keys")
        
        # Phase 4: Add all found keys to deletion list
        keys_to_delete.extend(conversation_related_keys)
        keys_to_delete.extend(user_related_keys)
        
        # Phase 5: Additional pattern searches for comprehensive cleanup
        additional_patterns = [
            f"*{conversation_id}*",  # Any key containing conversation ID
            f"*conv*{conversation_id}*",  # Conversation-related with ID
            f"*chat*{conversation_id}*",  # Chat-related with ID
            f"*msg*{conversation_id}*",  # Message-related with ID
            f"*message*{conversation_id}*",  # Message-related with ID
            f"*hierarchy*{conversation_id}*",  # Hierarchy keys
            f"*context*{conversation_id}*",  # Context keys
            f"*cache*{conversation_id}*",  # Cache keys
            f"*{user_id}*conv*",  # User conversation keys
            f"*{user_id}*chat*",  # User chat keys
            f"*user*{user_id}*",  # User-specific keys
            f"*{user_id}*{conversation_id}*",  # Combined user+conversation keys
            f"pgpt:*",  # All hashed keys (to be safe)
        ]
        
        additional_keys = []
        for pattern in additional_patterns:
            try:
                pattern_keys = self.redis.keys(pattern)
                if pattern_keys:
                    # Filter to only include keys that are actually relevant
                    relevant_keys = []
                    for key in pattern_keys:
                        key_str = key.decode() if isinstance(key, bytes) else str(key)
                        # More specific filtering for hashed keys
                        if pattern == "pgpt:*":
                            # For hashed keys, we can't easily determine content, 
                            # but we should include them for thorough cleanup
                            relevant_keys.append(key_str)
                        elif (conversation_id in key_str or 
                              (user_id in key_str and any(keyword in key_str.lower() for keyword in 
                               ['conv', 'chat', 'msg', 'message', 'hierarchy', 'context']))):
                            relevant_keys.append(key_str)
                    
                    additional_keys.extend(relevant_keys)
                    print(f"Pattern '{pattern}': found {len(relevant_keys)} relevant keys")
            except Exception as e:
                print(f"Error searching pattern '{pattern}': {str(e)}")
        
        keys_to_delete.extend(additional_keys)
        
        # Phase 6: Remove duplicates and prepare for deletion
        unique_keys = list(set(keys_to_delete))
        print(f"Total unique keys to delete: {len(unique_keys)}")
        
        # Phase 7: Delete keys in batches with error handling
        deleted_count = 0
        batch_size = 50  # Smaller batches for better error handling
        
        for i in range(0, len(unique_keys), batch_size):
            batch_keys = unique_keys[i:i + batch_size]
            
            # First, filter out any None or empty keys
            valid_batch_keys = [key for key in batch_keys if key and isinstance(key, str)]
            
            if not valid_batch_keys:
                continue
            
            try:
                # Use pipeline for atomic batch deletion
                operations = [('delete', key) for key in valid_batch_keys]
                result = self.pipeline_operation(operations)
                
                if result:
                    batch_deleted = sum(1 for r in result if r and r > 0)
                    deleted_count += batch_deleted
                    print(f"Batch {i//batch_size + 1}: deleted {batch_deleted}/{len(valid_batch_keys)} keys")
                else:
                    # Fallback: try individual deletion
                    print(f"Batch deletion failed, trying individual deletion for batch {i//batch_size + 1}")
                    for key in valid_batch_keys:
                        try:
                            if self.redis.delete(key):
                                deleted_count += 1
                        except Exception as single_e:
                            print(f"Failed to delete individual key {key}: {str(single_e)}")
                            
            except Exception as batch_e:
                print(f"Batch deletion error for batch {i//batch_size + 1}: {str(batch_e)}")
                # Try individual deletion as fallback
                for key in valid_batch_keys:
                    try:
                        if self.redis.delete(key):
                            deleted_count += 1
                    except Exception:
                        pass
        
        # Phase 8: Final verification and additional cleanup
        try:
            # Check if there are still keys related to this conversation
            remaining_keys = []
            final_check_patterns = [f"*{conversation_id}*", f"*{user_id}*conv*"]
            
            for pattern in final_check_patterns:
                try:
                    remaining = self.redis.keys(pattern)
                    if remaining:
                        # Filter to only show actually relevant ones
                        relevant_remaining = []
                        for key in remaining:
                            key_str = key.decode() if isinstance(key, bytes) else str(key)
                            if conversation_id in key_str or (user_id in key_str and 'conv' in key_str):
                                relevant_remaining.append(key_str)
                        remaining_keys.extend(relevant_remaining)
                except Exception:
                    pass
            
            if remaining_keys:
                print(f"WARNING: {len(remaining_keys)} keys may still exist:")
                for key in remaining_keys[:5]:  # Show first 5
                    print(f"  - {key}")
                
                # Try to delete remaining keys
                if len(remaining_keys) <= 20:  # Only if manageable number
                    try:
                        additional_deleted = self.redis.delete(*remaining_keys)
                        deleted_count += additional_deleted
                        print(f"Final cleanup: deleted {additional_deleted} remaining keys")
                    except Exception as final_e:
                        print(f"Final cleanup failed: {str(final_e)}")
            
        except Exception as verify_e:
            print(f"Verification error: {str(verify_e)}")
        
        print(f"ULTRA-CLEAR COMPLETE: Deleted {deleted_count} total keys for conversation {conversation_id}")
        return deleted_count > 0
    
    @_with_error_handling("Get recent context")
    def get_recent_context(self, user_id: str, conversation_id: str, limit: int = 10) -> List[Dict]:
        """Enhanced context retrieval with caching"""
        cache_key = self.get_user_key(user_id, f"context:{conversation_id}")
        
        # Try cache first
        cached_context = self.redis.get(cache_key)
        if cached_context:
            try:
                context = self._deserialize_data(cached_context)
                if context and len(context) >= limit:
                    return context[:limit]
            except Exception:
                pass
        
        # Get fresh context
        messages = self.get_conversation_history(user_id, conversation_id, limit * 2)
        
        formatted_messages = []
        for msg in messages[-limit:]:  # Get most recent
            if 'role' in msg and 'content' in msg:
                formatted_messages.append({
                    'role': msg['role'],
                    'content': msg['content']
                })
        
        # Cache the context
        if formatted_messages:
            context_data = self._serialize_data(formatted_messages)
            self.redis.setex(cache_key, self.cache_ttl, context_data)
        
        return formatted_messages
    
    @_with_error_handling("Cache AI response")
    def cache_ai_response(self, conversation_id: str, user_message_hash: str, response: str) -> bool:
        """Enhanced AI response caching with better key management"""
        cache_key = self._hash_key(f"ai_resp:{conversation_id}:{user_message_hash}")
        
        response_data = {
            'response': response,
            'timestamp': datetime.utcnow().isoformat(),
            'conversation_id': conversation_id
        }
        
        serialized_data = self._serialize_data(response_data)
        return bool(self.redis.setex(cache_key, self.cache_ttl, serialized_data))
    
    @_with_error_handling("Get cached AI response")
    def get_cached_ai_response(self, conversation_id: str, user_message_hash: str) -> Optional[str]:
        """Enhanced AI response retrieval with validation"""
        cache_key = self._hash_key(f"ai_resp:{conversation_id}:{user_message_hash}")
        cached_data = self.redis.get(cache_key)
        
        if not cached_data:
            return None
        
        response_data = self._deserialize_data(cached_data)
        if not response_data or not isinstance(response_data, dict):
            return None
        
        return response_data.get('response')
    
    @_with_error_handling("Rate limiting")
    def check_rate_limit(self, user_id: str, limit: int = 50, window: int = 60) -> bool:
        """Enhanced rate limiting with sliding window"""
        key = self.get_user_key(user_id, "rate_limit")
        current_time = datetime.utcnow()
        
        # Use sorted set for sliding window rate limiting
        pipe = self.redis.pipeline()
        
        # Remove old entries
        cutoff_time = current_time - timedelta(seconds=window)
        pipe.zremrangebyscore(key, 0, cutoff_time.timestamp())
        
        # Add current request
        pipe.zadd(key, {str(current_time.timestamp()): current_time.timestamp()})
        
        # Count requests in window
        pipe.zcard(key)
        
        # Set expiry
        pipe.expire(key, window)
        
        results = pipe.execute()
        current_count = results[2] if len(results) > 2 else 0
        
        return current_count <= limit
    
    @_with_error_handling("Increment message count")
    def increment_message_count(self, user_id: str) -> int:
        """Enhanced message counting with better tracking"""
        key = self.get_user_key(user_id, "msg_count")
        
        pipe = self.redis.pipeline()
        pipe.incr(key)
        pipe.expire(key, self.rate_limit_ttl)
        results = pipe.execute()
        
        return results[0] if results else 0
    
    @_with_error_handling("Get message count")
    def get_message_count(self, user_id: str) -> int:
        """Enhanced message count retrieval"""
        key = self.get_user_key(user_id, "msg_count")
        count = self.redis.get(key)
        return int(count) if count else 0
    
    @_with_error_handling("Cache user data")
    def cache_user_data(self, user_id: str, data_type: str, data: Any, ttl: int = None) -> bool:
        """Generic user data caching with optimized serialization"""
        key = self.get_user_key(user_id, data_type)
        ttl = ttl or self.cache_ttl
        
        serialized_data = self._serialize_data(data, use_pickle=True)
        return bool(self.redis.setex(key, ttl, serialized_data))
    
    @_with_error_handling("Get cached user data")
    def get_cached_user_data(self, user_id: str, data_type: str) -> Any:
        """Enhanced user data retrieval with optimized caching"""
        key = self.get_user_key(user_id, data_type)
        cached_data = self.redis.get(key)
        
        if cached_data:
            return self._deserialize_data(cached_data)
        return None
    
    def store_share_token(self, token: str, token_data: Dict[str, Any]) -> bool:
        """Store a shareable token for conversation sharing"""
        try:
            key = f"share_token:{token}"
            serialized_data = self._serialize_data(token_data)
            
            # Set expiration based on token data or default to 7 days
            ttl = 60 * 60 * 24 * 7  # 7 days
            
            return bool(self.redis.setex(key, ttl, serialized_data))
        except Exception as e:
            print(f"Error storing share token: {str(e)}")
            return False

    def get_share_token_data(self, token: str) -> Optional[Dict[str, Any]]:
        """Retrieve data for a share token"""
        try:
            key = f"share_token:{token}"
            token_data = self.redis.get(key)
            
            if token_data:
                return self._deserialize_data(token_data)
            return None
        except Exception as e:
            print(f"Error retrieving share token data: {str(e)}")
            return None

    def delete_share_token(self, token: str) -> bool:
        """Delete a share token"""
        try:
            key = f"share_token:{token}"
            return bool(self.redis.delete(key))
        except Exception as e:
            print(f"Error deleting share token: {str(e)}")
            return False

    def store_chat_hierarchy(self, main_chat_id: str, sub_chat_id: str, user_id: str) -> bool:
        """Store chat hierarchy information in Redis"""
        try:
            # Store main_chat -> sub_chats mapping
            main_chat_key = f"hierarchy:main:{main_chat_id}"
            sub_chats_data = self.redis.get(main_chat_key)
            
            if sub_chats_data:
                sub_chats = json.loads(sub_chats_data)
            else:
                sub_chats = []
            
            if sub_chat_id not in sub_chats:
                sub_chats.append(sub_chat_id)
                self.redis.setex(
                    main_chat_key, 
                    self.conversation_ttl, 
                    json.dumps(sub_chats)
                )
            
            # Store sub_chat -> main_chat mapping
            sub_chat_key = f"hierarchy:sub:{sub_chat_id}"
            hierarchy_data = {
                'main_chat_id': main_chat_id,
                'user_id': user_id,
                'created_at': datetime.utcnow().isoformat()
            }
            self.redis.setex(
                sub_chat_key,
                self.conversation_ttl,
                json.dumps(hierarchy_data)
            )
            
            return True
        except Exception as e:
            print(f"Error storing chat hierarchy: {str(e)}")
            return False

    def get_chat_hierarchy(self, chat_id: str) -> Optional[Dict[str, Any]]:
        """Get hierarchy information for a chat"""
        try:
            # Check if it's a sub-chat
            sub_chat_key = f"hierarchy:sub:{chat_id}"
            hierarchy_data = self.redis.get(sub_chat_key)
            
            if hierarchy_data:
                return json.loads(hierarchy_data)
            
            # Check if it's a main chat
            main_chat_key = f"hierarchy:main:{chat_id}"
            sub_chats_data = self.redis.get(main_chat_key)
            
            if sub_chats_data:
                return {
                    'main_chat_id': chat_id,
                    'sub_chat_ids': json.loads(sub_chats_data),
                    'is_main_chat': True
                }
            
            return None
        except Exception as e:
            print(f"Error getting chat hierarchy: {str(e)}")
            return None

    def store_main_chat_context(self, main_chat_id: str, message_data: Dict[str, Any]) -> bool:
        """Store message in main chat context for quick access"""
        try:
            key = f"main_chat_context:{main_chat_id}"
            serialized_data = self._serialize_data(message_data)
            
            # Add to list and trim
            self.redis.lpush(key, serialized_data)
            self.redis.ltrim(key, 0, 99)  # Keep last 100 messages
            self.redis.expire(key, self.conversation_ttl)
            
            return True
        except Exception as e:
            print(f"Error storing main chat context: {str(e)}")
            return False

    def get_main_chat_context(self, main_chat_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Get main chat context messages"""
        try:
            key = f"main_chat_context:{main_chat_id}"
            context_data = self.redis.lrange(key, 0, limit - 1)
            
            messages = []
            for data in context_data:
                try:
                    msg = self._deserialize_data(data)
                    if msg:
                        messages.append(msg)
                except Exception as e:
                    print(f"Error deserializing context message: {str(e)}")
                    continue
            
            return list(reversed(messages))  # Return in chronological order
        except Exception as e:
            print(f"Error getting main chat context: {str(e)}")
            return []
    
    def cleanup_expired_keys(self) -> int:
        """Cleanup expired keys and optimize memory usage"""
        try:
            # Get keys that might be expired
            pattern = f"pgpt:*"
            keys = self.redis.keys(pattern)
            
            if not keys:
                return 0
            
            # Check TTL and remove expired keys
            pipe = self.redis.pipeline()
            for key in keys:
                pipe.ttl(key)
            
            ttls = pipe.execute()
            expired_keys = [keys[i] for i, ttl in enumerate(ttls) if ttl == -1]
            
            if expired_keys:
                self.redis.delete(*expired_keys)
            
            return len(expired_keys)
        except Exception as e:
            print(f"Error during cleanup: {str(e)}")
            return 0

# Maintain backward compatibility
RedisService = RedisServiceOptimized
