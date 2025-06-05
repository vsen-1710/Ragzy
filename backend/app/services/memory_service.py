import json
import re
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from app.services.redis_service import RedisServiceOptimized as RedisService
from app.services.weaviate_service import weaviate_service
from app.models.user import UserModel

logger = logging.getLogger(__name__)

class MemoryService:
    """
    Persistent memory service for storing user information across sessions.
    Supports global per-user memory with Redis caching and database fallback.
    """
    
    def __init__(self):
        self.redis_service = RedisService()
        
        # TTL settings
        self.memory_cache_ttl = 60 * 60 * 24 * 30  # 30 days for Redis cache
        self.memory_db_ttl = 60 * 60 * 24 * 365    # 1 year for database storage
        
        # Memory categories
        self.memory_categories = {
            'personal': ['name', 'nickname', 'age', 'location', 'occupation', 'relationship'],
            'preferences': ['language', 'timezone', 'communication_style', 'topics_of_interest'],
            'context': ['projects', 'goals', 'background', 'expertise', 'learning'],
            'facts': ['family', 'pets', 'hobbies', 'experiences', 'achievements']
        }
        
        # Pattern matching for extracting memory information
        self.memory_patterns = {
            'name': [
                r"(?i)(?:my name is|i'm|i am|call me|i go by)\s+([a-zA-Z\s]+)",
                r"(?i)(?:name's|name is)\s+([a-zA-Z\s]+)",
                r"(?i)you can call me\s+([a-zA-Z\s]+)"
            ],
            'nickname': [
                r"(?i)(?:call me|nickname is|nick is|everyone calls me)\s+([a-zA-Z\s]+)",
                r"(?i)(?:but|just) call me\s+([a-zA-Z\s]+)"
            ],
            'age': [
                r"(?i)(?:i'm|i am|my age is)\s+(\d+)\s*(?:years old|y\.?o\.?)?",
                r"(?i)(?:age|i'm)\s+(\d+)"
            ],
            'location': [
                r"(?i)(?:i live in|i'm from|i'm in|located in|i'm based in)\s+([a-zA-Z\s,]+)",
                r"(?i)(?:my location is|currently in)\s+([a-zA-Z\s,]+)"
            ],
            'occupation': [
                r"(?i)(?:i work as|i'm a|i am a|my job is|i work in|profession is)\s+([a-zA-Z\s]+)",
                r"(?i)(?:i'm|i am)\s+(?:a|an)\s+([a-zA-Z\s]+)(?:\s+by profession|$)"
            ],
            'preferences': [
                r"(?i)(?:i prefer|i like|i love|i enjoy|i'm interested in)\s+([^.!?]+)",
                r"(?i)(?:my favorite|i really like)\s+([^.!?]+)"
            ],
            'projects': [
                r"(?i)(?:i'm working on|working on|my project is|current project)\s+([^.!?]+)",
                r"(?i)(?:building|developing|creating)\s+([^.!?]+)"
            ],
            'goals': [
                r"(?i)(?:my goal is|i want to|i'm trying to|i hope to|i plan to)\s+([^.!?]+)",
                r"(?i)(?:goal|objective|aim) is to\s+([^.!?]+)"
            ],
            'expertise': [
                r"(?i)(?:i'm good at|i specialize in|expert in|experienced in)\s+([^.!?]+)",
                r"(?i)(?:my expertise is|skilled in)\s+([^.!?]+)"
            ],
            'family': [
                r"(?i)(?:i have|my)\s+(?:a\s+)?(?:wife|husband|partner|spouse|daughter|son|kids|children|parents|siblings?|brother|sister)\s+([^.!?]*)",
                r"(?i)(?:married|single|divorced|in a relationship)\s*(?:to|with)?\s*([^.!?]*)"
            ],
            'pets': [
                r"(?i)(?:i have|my)\s+(?:a\s+)?(?:dog|cat|pet|puppy|kitten|bird|fish)\s+(?:named|called)?\s*([^.!?]*)",
                r"(?i)(?:pet|dog|cat)\s+(?:is|named|called)\s+([a-zA-Z\s]+)"
            ]
        }
    
    def get_memory_key(self, user_id: str, category: str = 'all') -> str:
        """Generate Redis key for user memory"""
        return f"memory:{user_id}:{category}"
    
    def get_weaviate_memory_key(self, user_id: str) -> str:
        """Generate Weaviate class name for user memory"""
        return f"UserMemory_{user_id.replace('-', '_')}"
    
    def extract_memory_from_message(self, message: str) -> Dict[str, List[Dict[str, Any]]]:
        """
        Extract memory information from user message using pattern matching
        """
        extracted_memories = {}
        
        for category, patterns in self.memory_patterns.items():
            for pattern in patterns:
                matches = re.findall(pattern, message, re.IGNORECASE | re.MULTILINE)
                if matches:
                    if category not in extracted_memories:
                        extracted_memories[category] = []
                    
                    for match in matches:
                        if isinstance(match, tuple):
                            match = match[0] if match[0] else match[1] if len(match) > 1 else ''
                        
                        if match and len(match.strip()) > 1:
                            memory_item = {
                                'value': match.strip().title() if category in ['name', 'nickname'] else match.strip(),
                                'confidence': self._calculate_confidence(category, match, message),
                                'timestamp': datetime.utcnow().isoformat() + 'Z',
                                'source_message': message[:200] + '...' if len(message) > 200 else message
                            }
                            extracted_memories[category].append(memory_item)
        
        return extracted_memories
    
    def _calculate_confidence(self, category: str, match: str, full_message: str) -> float:
        """Calculate confidence score for extracted memory"""
        confidence = 0.7  # Base confidence
        
        # Increase confidence for explicit statements
        explicit_indicators = ['my name is', 'i am', 'call me', 'i work as', 'i live in']
        if any(indicator in full_message.lower() for indicator in explicit_indicators):
            confidence += 0.2
        
        # Increase confidence for longer, more detailed matches
        if len(match.strip()) > 10:
            confidence += 0.1
        
        # Decrease confidence for very short matches or single words
        if len(match.strip()) < 3:
            confidence -= 0.3
        
        # Category-specific adjustments
        if category in ['name', 'nickname'] and len(match.strip().split()) <= 3:
            confidence += 0.1
        
        return min(max(confidence, 0.1), 1.0)
    
    def store_memory(self, user_id: str, memory_data: Dict[str, Any], source: str = 'chat') -> bool:
        """
        Store memory data in both Redis (cache) and Weaviate (persistent)
        """
        try:
            timestamp = datetime.utcnow().isoformat() + 'Z'
            
            # Prepare memory entry
            memory_entry = {
                'user_id': user_id,
                'data': memory_data,
                'source': source,
                'created_at': timestamp,
                'updated_at': timestamp
            }
            
            # Store in Redis for fast access
            self._store_in_redis(user_id, memory_entry)
            
            # Store in Weaviate for persistence
            self._store_in_weaviate(user_id, memory_entry)
            
            logger.info(f"Memory stored successfully for user {user_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error storing memory for user {user_id}: {str(e)}")
            return False
    
    def _store_in_redis(self, user_id: str, memory_entry: Dict[str, Any]) -> bool:
        """Store memory in Redis cache"""
        try:
            # Get existing memory
            existing_memory = self.get_user_memory_from_redis(user_id) or {}
            
            # Merge new memory with existing
            for category, items in memory_entry['data'].items():
                if category not in existing_memory:
                    existing_memory[category] = []
                
                for item in items if isinstance(items, list) else [items]:
                    # Check for duplicates and update if newer
                    existing_item = None
                    for i, existing_item in enumerate(existing_memory[category]):
                        if self._is_similar_memory(existing_item, item):
                            existing_memory[category][i] = item  # Update with newer info
                            existing_item = True
                            break
                    
                    if not existing_item:
                        existing_memory[category].append(item)
            
            # Store updated memory
            memory_key = self.get_memory_key(user_id)
            return self.redis_service.redis.setex(
                memory_key, 
                self.memory_cache_ttl, 
                json.dumps(existing_memory)
            )
            
        except Exception as e:
            logger.error(f"Error storing memory in Redis: {str(e)}")
            return False
    
    def _store_in_weaviate(self, user_id: str, memory_entry: Dict[str, Any]) -> bool:
        """Store memory in Weaviate for persistence"""
        try:
            # Create memory object in Weaviate
            properties = {
                'user_id': user_id,
                'memory_data': json.dumps(memory_entry['data']),
                'source': memory_entry['source'],
                'created_at': memory_entry['created_at'],
                'updated_at': memory_entry['updated_at']
            }
            
            # Use a custom class for user memories
            memory_id = weaviate_service.create_object('UserMemory', properties)
            
            if memory_id:
                logger.info(f"Memory stored in Weaviate with ID: {memory_id}")
                return True
            
            return False
            
        except Exception as e:
            logger.error(f"Error storing memory in Weaviate: {str(e)}")
            return False
    
    def _is_similar_memory(self, existing: Dict[str, Any], new: Dict[str, Any]) -> bool:
        """Check if two memory items are similar (for deduplication)"""
        if 'value' in existing and 'value' in new:
            existing_val = existing['value'].lower().strip()
            new_val = new['value'].lower().strip()
            
            # Consider them similar if they're very close
            return (existing_val == new_val or 
                    existing_val in new_val or 
                    new_val in existing_val)
        
        return False
    
    def get_user_memory(self, user_id: str, category: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Retrieve user memory with Redis cache fallback to Weaviate
        """
        try:
            # Try Redis first (fast)
            memory_data = self.get_user_memory_from_redis(user_id)
            
            if memory_data:
                logger.debug(f"Memory retrieved from Redis for user {user_id}")
            else:
                # Fallback to Weaviate
                memory_data = self.get_user_memory_from_weaviate(user_id)
                if memory_data:
                    # Cache in Redis for future fast access
                    self._cache_memory_in_redis(user_id, memory_data)
                    logger.debug(f"Memory retrieved from Weaviate and cached for user {user_id}")
            
            # Filter by category if specified
            if memory_data and category:
                return memory_data.get(category, {})
            
            return memory_data
            
        except Exception as e:
            logger.error(f"Error retrieving memory for user {user_id}: {str(e)}")
            return None
    
    def get_user_memory_from_redis(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve memory from Redis cache"""
        try:
            memory_key = self.get_memory_key(user_id)
            memory_data = self.redis_service.redis.get(memory_key)
            
            if memory_data:
                return json.loads(memory_data)
            
            return None
            
        except Exception as e:
            logger.error(f"Error retrieving memory from Redis: {str(e)}")
            return None
    
    def get_user_memory_from_weaviate(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve memory from Weaviate database"""
        try:
            where_filter = {
                "path": ["user_id"],
                "operator": "Equal",
                "valueText": user_id
            }
            
            memories = weaviate_service.query_objects(
                'UserMemory', 
                where_filter=where_filter,
                limit=100  # Get all memory entries for user
            )
            
            if not memories:
                return None
            
            # Merge all memory entries
            merged_memory = {}
            for memory_obj in memories:
                try:
                    memory_data = json.loads(memory_obj.get('memory_data', '{}'))
                    for category, items in memory_data.items():
                        if category not in merged_memory:
                            merged_memory[category] = []
                        
                        if isinstance(items, list):
                            merged_memory[category].extend(items)
                        else:
                            merged_memory[category].append(items)
                
                except json.JSONDecodeError:
                    continue
            
            return merged_memory if merged_memory else None
            
        except Exception as e:
            logger.error(f"Error retrieving memory from Weaviate: {str(e)}")
            return None
    
    def _cache_memory_in_redis(self, user_id: str, memory_data: Dict[str, Any]) -> bool:
        """Cache memory data in Redis"""
        try:
            memory_key = self.get_memory_key(user_id)
            return self.redis_service.redis.setex(
                memory_key,
                self.memory_cache_ttl,
                json.dumps(memory_data)
            )
        except Exception as e:
            logger.error(f"Error caching memory in Redis: {str(e)}")
            return False
    
    def search_memory(self, user_id: str, query: str, category: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Search user memory for specific information
        """
        try:
            memory_data = self.get_user_memory(user_id)
            if not memory_data:
                return []
            
            results = []
            search_terms = query.lower().split()
            
            categories_to_search = [category] if category else memory_data.keys()
            
            for cat in categories_to_search:
                if cat in memory_data:
                    for item in memory_data[cat]:
                        if isinstance(item, dict) and 'value' in item:
                            item_text = item['value'].lower()
                            
                            # Check if any search term matches
                            if any(term in item_text for term in search_terms):
                                results.append({
                                    'category': cat,
                                    'item': item,
                                    'relevance': self._calculate_relevance(query, item['value'])
                                })
            
            # Sort by relevance
            results.sort(key=lambda x: x['relevance'], reverse=True)
            return results
            
        except Exception as e:
            logger.error(f"Error searching memory: {str(e)}")
            return []
    
    def _calculate_relevance(self, query: str, text: str) -> float:
        """Calculate relevance score for search results"""
        query_lower = query.lower()
        text_lower = text.lower()
        
        # Exact match
        if query_lower == text_lower:
            return 1.0
        
        # Contains full query
        if query_lower in text_lower:
            return 0.8
        
        # Word matches
        query_words = set(query_lower.split())
        text_words = set(text_lower.split())
        
        if query_words:
            overlap = len(query_words.intersection(text_words))
            return overlap / len(query_words)
        
        return 0.0
    
    def update_memory(self, user_id: str, category: str, old_value: str, new_value: str) -> bool:
        """Update specific memory entry"""
        try:
            memory_data = self.get_user_memory(user_id)
            if not memory_data or category not in memory_data:
                return False
            
            # Find and update the item
            for item in memory_data[category]:
                if isinstance(item, dict) and item.get('value', '').lower() == old_value.lower():
                    item['value'] = new_value
                    item['updated_at'] = datetime.utcnow().isoformat() + 'Z'
                    
                    # Update in both Redis and Weaviate
                    self._cache_memory_in_redis(user_id, memory_data)
                    self._store_in_weaviate(user_id, {
                        'data': {category: [item]},
                        'source': 'update',
                        'created_at': item['updated_at'],
                        'updated_at': item['updated_at']
                    })
                    
                    return True
            
            return False
            
        except Exception as e:
            logger.error(f"Error updating memory: {str(e)}")
            return False
    
    def delete_memory(self, user_id: str, category: Optional[str] = None) -> bool:
        """Delete user memory (category or all)"""
        try:
            if category:
                # Delete specific category
                memory_data = self.get_user_memory(user_id)
                if memory_data and category in memory_data:
                    del memory_data[category]
                    self._cache_memory_in_redis(user_id, memory_data)
            else:
                # Delete all memory
                memory_key = self.get_memory_key(user_id)
                self.redis_service.redis.delete(memory_key)
                
                # Delete from Weaviate
                where_filter = {
                    "path": ["user_id"],
                    "operator": "Equal",
                    "valueText": user_id
                }
                
                memories = weaviate_service.query_objects('UserMemory', where_filter=where_filter)
                for memory_obj in memories:
                    memory_id = memory_obj.get('_additional', {}).get('id')
                    if memory_id:
                        weaviate_service.delete_object('UserMemory', memory_id)
            
            return True
            
        except Exception as e:
            logger.error(f"Error deleting memory: {str(e)}")
            return False
    
    def get_memory_summary(self, user_id: str) -> str:
        """Generate a natural language summary of user memory"""
        try:
            memory_data = self.get_user_memory(user_id)
            if not memory_data:
                return "I don't have any stored information about you yet."
            
            summary_parts = []
            
            # Name information
            if 'name' in memory_data:
                names = [item['value'] for item in memory_data['name'] if isinstance(item, dict)]
                if names:
                    summary_parts.append(f"Your name is {', '.join(names)}")
            
            if 'nickname' in memory_data:
                nicknames = [item['value'] for item in memory_data['nickname'] if isinstance(item, dict)]
                if nicknames:
                    summary_parts.append(f"You prefer to be called {', '.join(nicknames)}")
            
            # Personal info
            if 'age' in memory_data:
                ages = [item['value'] for item in memory_data['age'] if isinstance(item, dict)]
                if ages:
                    summary_parts.append(f"You are {ages[-1]} years old")
            
            if 'location' in memory_data:
                locations = [item['value'] for item in memory_data['location'] if isinstance(item, dict)]
                if locations:
                    summary_parts.append(f"You live in {locations[-1]}")
            
            if 'occupation' in memory_data:
                occupations = [item['value'] for item in memory_data['occupation'] if isinstance(item, dict)]
                if occupations:
                    summary_parts.append(f"You work as {occupations[-1]}")
            
            # Projects and goals
            if 'projects' in memory_data:
                projects = [item['value'] for item in memory_data['projects'] if isinstance(item, dict)]
                if projects:
                    summary_parts.append(f"You're working on: {', '.join(projects[:2])}")
            
            if 'goals' in memory_data:
                goals = [item['value'] for item in memory_data['goals'] if isinstance(item, dict)]
                if goals:
                    summary_parts.append(f"Your goals include: {', '.join(goals[:2])}")
            
            if summary_parts:
                return "Here's what I remember about you: " + ". ".join(summary_parts) + "."
            else:
                return "I have some information stored about you, but it's not in a standard format."
                
        except Exception as e:
            logger.error(f"Error generating memory summary: {str(e)}")
            return "I'm having trouble accessing your stored information right now."
    
    def process_message_for_memory(self, user_id: str, message: str) -> Tuple[Dict[str, Any], bool]:
        """
        Process a user message to extract and store memory information
        Returns: (extracted_memory, was_memory_found)
        """
        try:
            extracted_memory = self.extract_memory_from_message(message)
            
            if extracted_memory:
                # Store the extracted memory
                success = self.store_memory(user_id, extracted_memory, source='chat')
                logger.info(f"Extracted and stored memory for user {user_id}: {list(extracted_memory.keys())}")
                return extracted_memory, success
            
            return {}, False
            
        except Exception as e:
            logger.error(f"Error processing message for memory: {str(e)}")
            return {}, False
    
    def get_context_for_response(self, user_id: str, current_message: str) -> str:
        """
        Get relevant memory context to include in AI response generation
        """
        try:
            # Check if the message is asking about stored information
            memory_queries = [
                'what\'s my name', 'what is my name', 'my name',
                'who am i', 'what do you know about me',
                'tell me about myself', 'what did i tell you',
                'what do you remember', 'do you remember',
                'what have i told you'
            ]
            
            message_lower = current_message.lower()
            is_memory_query = any(query in message_lower for query in memory_queries)
            
            if is_memory_query:
                # User is asking about their information
                return self.get_memory_summary(user_id)
            
            # For regular messages, provide relevant context
            memory_data = self.get_user_memory(user_id)
            if not memory_data:
                return ""
            
            context_parts = []
            
            # Include name for personalization
            if 'name' in memory_data or 'nickname' in memory_data:
                preferred_name = None
                if 'nickname' in memory_data:
                    nicknames = [item['value'] for item in memory_data['nickname'] if isinstance(item, dict)]
                    if nicknames:
                        preferred_name = nicknames[-1]
                
                if not preferred_name and 'name' in memory_data:
                    names = [item['value'] for item in memory_data['name'] if isinstance(item, dict)]
                    if names:
                        preferred_name = names[-1].split()[0]  # Use first name
                
                if preferred_name:
                    context_parts.append(f"User prefers to be called: {preferred_name}")
            
            # Include relevant context based on message content
            relevant_categories = []
            if any(word in message_lower for word in ['work', 'job', 'career']):
                relevant_categories.append('occupation')
            if any(word in message_lower for word in ['project', 'building', 'working on']):
                relevant_categories.append('projects')
            if any(word in message_lower for word in ['goal', 'want', 'trying', 'hope']):
                relevant_categories.append('goals')
            
            for category in relevant_categories:
                if category in memory_data:
                    items = [item['value'] for item in memory_data[category] if isinstance(item, dict)]
                    if items:
                        context_parts.append(f"User's {category}: {', '.join(items[:2])}")
            
            if context_parts:
                return "Context: " + "; ".join(context_parts)
            
            return ""
            
        except Exception as e:
            logger.error(f"Error getting context for response: {str(e)}")
            return ""

# Create global instance
memory_service = MemoryService() 