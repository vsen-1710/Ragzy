import uuid
from datetime import datetime
from typing import List, Dict, Optional, Any, Union
import threading
from concurrent.futures import ThreadPoolExecutor
import logging
from functools import lru_cache, wraps
from app import get_weaviate_client

logger = logging.getLogger(__name__)

class WeaviateServiceOptimized:
    def __init__(self):
        self.client = None  # Will be initialized lazily
        self._executor = ThreadPoolExecutor(max_workers=5)
        self._schema_cache = {}
        self._cache_lock = threading.RLock()
        
        # Performance settings
        self.batch_size = 50
        self.max_retries = 3
        self.timeout_seconds = 30
        
        # Initialize schemas when client is available
        self._ensure_schemas()
    
    def _get_client(self):
        """Get Weaviate client with lazy initialization"""
        if self.client is None:
            self.client = get_weaviate_client()
        return self.client
    
    @staticmethod
    def _with_retry(max_retries: int = 3):
        """Decorator for retrying operations with exponential backoff"""
        def decorator(func):
            @wraps(func)
            def wrapper(*args, **kwargs):
                import time
                
                for attempt in range(max_retries):
                    try:
                        return func(*args, **kwargs)
                    except Exception as e:
                        if attempt == max_retries - 1:
                            logger.error(f"Failed after {max_retries} attempts: {str(e)}")
                            raise
                        
                        wait_time = (2 ** attempt) * 0.1  # Exponential backoff
                        logger.warning(f"Attempt {attempt + 1} failed, retrying in {wait_time}s: {str(e)}")
                        time.sleep(wait_time)
                
                return None
            return wrapper
        return decorator
    
    @staticmethod
    def _with_error_handling(operation_name: str = "Weaviate operation"):
        """Decorator for consistent error handling"""
        def decorator(func):
            @wraps(func)
            def wrapper(*args, **kwargs):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    logger.error(f"Error in {operation_name}: {str(e)}")
                    return None
            return wrapper
        return decorator
    
    @lru_cache(maxsize=32)
    def _get_schema_properties(self, class_name: str) -> List[str]:
        """Get cached schema properties for a class"""
        try:
            schema = self._get_client().schema.get(class_name)
            return [prop['name'] for prop in schema.get('properties', [])]
        except Exception as e:
            logger.warning(f"Could not get schema properties for {class_name}: {str(e)}")
            return []
    
    def _ensure_schemas(self):
        """Ensure all required schemas exist in Weaviate with optimized creation"""
        schemas = [
            {
                "class": "User",
                "description": "A user of the Personal GPT system",
                "properties": [
                    {"name": "username", "dataType": ["text"], "description": "Username"},
                    {"name": "email", "dataType": ["text"], "description": "Email address"},
                    {"name": "google_id", "dataType": ["text"], "description": "Original Google user ID"},
                    {"name": "created_at", "dataType": ["date"], "description": "Creation timestamp"},
                    {"name": "is_active", "dataType": ["boolean"], "description": "Whether user is active"},
                ],
                "vectorizer": "none"  # Disable vectorization for user data
            },
            {
                "class": "Conversation",
                "description": "A conversation session",
                "properties": [
                    {"name": "user_id", "dataType": ["text"], "description": "User ID"},
                    {"name": "title", "dataType": ["text"], "description": "Conversation title"},
                    {"name": "created_at", "dataType": ["date"], "description": "Creation timestamp"},
                    {"name": "updated_at", "dataType": ["date"], "description": "Last update timestamp"},
                    {"name": "parent_id", "dataType": ["text"], "description": "Parent conversation ID for sub-conversations"},
                    {"name": "metadata", "dataType": ["object"], "description": "Additional conversation metadata"}
                ],
                "vectorizer": "text2vec-transformers",
                "moduleConfig": {
                    "text2vec-transformers": {
                        "vectorizeClassName": False,
                        "vectorizePropertyName": False
                    }
                }
            },
            {
                "class": "Message",
                "description": "A message in a conversation",
                "properties": [
                    {"name": "conversation_id", "dataType": ["text"], "description": "Conversation ID"},
                    {"name": "role", "dataType": ["text"], "description": "Message role (user/assistant)"},
                    {"name": "content", "dataType": ["text"], "description": "Message content"},
                    {"name": "timestamp", "dataType": ["date"], "description": "Message timestamp"},
                ],
                "vectorizer": "text2vec-transformers",
                "moduleConfig": {
                    "text2vec-transformers": {
                        "vectorizeClassName": False,
                        "vectorizePropertyName": False
                    }
                }
            }
        ]
        
        try:
            client = self._get_client()
            if client is None:
                logger.warning("Weaviate client not available, skipping schema initialization")
                return
                
            existing_classes = set()
            try:
                schema_info = client.schema.get()
                existing_classes = {cls['class'] for cls in schema_info.get('classes', [])}
            except Exception as e:
                logger.warning(f"Could not get existing schema: {str(e)}")
            
            for schema in schemas:
                class_name = schema['class']
                if class_name not in existing_classes:
                    try:
                        client.schema.create_class(schema)
                        logger.info(f"Created schema for {class_name}")
                        
                        # Cache the schema properties
                        with self._cache_lock:
                            self._schema_cache[class_name] = [prop['name'] for prop in schema['properties']]
                    except Exception as e:
                        logger.error(f"Failed to create schema for {class_name}: {str(e)}")
                else:
                    # Cache existing schema properties
                    try:
                        properties = self._get_schema_properties(class_name)
                        with self._cache_lock:
                            self._schema_cache[class_name] = properties
                    except Exception:
                        pass
                        
        except Exception as e:
            logger.error(f"Error ensuring schemas: {str(e)}")
    
    @_with_retry(max_retries=3)
    @_with_error_handling("Create object")
    def create_object(self, class_name: str, properties: Dict[str, Any]) -> Optional[str]:
        """Create a new object in Weaviate with enhanced error handling"""
        try:
            # Validate class exists
            if class_name not in self._schema_cache:
                logger.warning(f"Class {class_name} not found in schema cache")
                return None
            
            # Prepare properties with timestamp
            enhanced_properties = properties.copy()
            if 'created_at' not in enhanced_properties:
                enhanced_properties['created_at'] = datetime.utcnow().isoformat() + 'Z'
            
            # Validate properties against schema
            valid_properties = self._schema_cache.get(class_name, [])
            filtered_properties = {
                k: v for k, v in enhanced_properties.items() 
                if k in valid_properties and v is not None
            }
            
            if not filtered_properties:
                logger.warning(f"No valid properties for {class_name}")
                return None
            
            result = self._get_client().data_object.create(
                data_object=filtered_properties,
                class_name=class_name
            )
            
            logger.debug(f"Created {class_name} object: {result}")
            return result
            
        except Exception as e:
            logger.error(f"Error creating {class_name}: {str(e)}")
            raise
    
    @_with_retry(max_retries=3)
    @_with_error_handling("Get object")
    def get_object(self, class_name: str, object_id: str) -> Optional[Dict]:
        """Get an object by ID with enhanced error handling"""
        try:
            result = self._get_client().data_object.get_by_id(
                object_id, 
                class_name=class_name,
                with_vector=False  # Don't fetch vector for better performance
            )
            return result
        except Exception as e:
            logger.error(f"Error getting {class_name} {object_id}: {str(e)}")
            return None
    
    @_with_retry(max_retries=3)
    @_with_error_handling("Query objects")
    def query_objects(self, class_name: str, where_filter: Optional[Dict] = None, 
                     limit: int = 100, offset: int = 0) -> List[Dict]:
        """Query objects with enhanced filtering and pagination"""
        try:
            # Get cached properties or fetch them
            properties = self._schema_cache.get(class_name)
            if not properties:
                properties = self._get_schema_properties(class_name)
                if properties:
                    with self._cache_lock:
                        self._schema_cache[class_name] = properties
            
            if not properties:
                logger.warning(f"No properties found for class {class_name}")
                return []
            
            # Build query
            query = self._get_client().query.get(class_name, properties)
            
            # Apply filters
            if where_filter:
                query = query.with_where(where_filter)
            
            # Apply pagination
            query = query.with_limit(min(limit, 1000))  # Cap at 1000 for performance
            if offset > 0:
                query = query.with_offset(offset)
            
            # Add object ID
            query = query.with_additional(['id'])
            
            result = query.do()
            objects = result.get('data', {}).get('Get', {}).get(class_name, [])
            
            logger.debug(f"Queried {len(objects)} {class_name} objects")
            return objects
            
        except Exception as e:
            logger.error(f"Error querying {class_name}: {str(e)}")
            return []
    
    @_with_retry(max_retries=3)
    @_with_error_handling("Update object")
    def update_object(self, class_name: str, object_id: str, properties: Dict[str, Any]) -> bool:
        """Update an object with enhanced validation"""
        try:
            # Validate properties against schema
            valid_properties = self._schema_cache.get(class_name, [])
            if not valid_properties:
                valid_properties = self._get_schema_properties(class_name)
            
            filtered_properties = {
                k: v for k, v in properties.items() 
                if k in valid_properties and v is not None
            }
            
            if not filtered_properties:
                logger.warning(f"No valid properties to update for {class_name} {object_id}")
                return False
            
            # Add update timestamp
            filtered_properties['updated_at'] = datetime.utcnow().isoformat() + 'Z'
            
            self._get_client().data_object.update(
                data_object=filtered_properties,
                class_name=class_name,
                uuid=object_id
            )
            
            logger.debug(f"Updated {class_name} {object_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error updating {class_name} {object_id}: {str(e)}")
            return False
    
    @_with_retry(max_retries=3)
    @_with_error_handling("Delete object")
    def delete_object(self, class_name: str, object_id: str) -> bool:
        """Delete an object with enhanced error handling"""
        try:
            self._get_client().data_object.delete(object_id, class_name=class_name)
            logger.debug(f"Deleted {class_name} {object_id}")
            return True
        except Exception as e:
            logger.error(f"Error deleting {class_name} {object_id}: {str(e)}")
            return False
    
    @_with_retry(max_retries=3)
    @_with_error_handling("Semantic search")
    def semantic_search(self, class_name: str, query: str, limit: int = 10, 
                       certainty: float = 0.7) -> List[Dict]:
        """Perform semantic search with enhanced parameters"""
        try:
            # Get properties for the class
            properties = self._schema_cache.get(class_name)
            if not properties:
                properties = self._get_schema_properties(class_name)
            
            if not properties:
                return []
            
            result = (
                self._get_client().query
                .get(class_name, properties)
                .with_near_text({
                    "concepts": [query],
                    "certainty": certainty
                })
                .with_limit(min(limit, 100))  # Cap for performance
                .with_additional(["certainty", "id"])
                .do()
            )
            
            objects = result.get('data', {}).get('Get', {}).get(class_name, [])
            logger.debug(f"Semantic search returned {len(objects)} results for '{query}'")
            return objects
            
        except Exception as e:
            logger.error(f"Error in semantic search for {class_name}: {str(e)}")
            return []
    
    def batch_create_objects(self, class_name: str, objects: List[Dict[str, Any]]) -> List[str]:
        """Create multiple objects in batch for better performance"""
        try:
            if not objects:
                return []
            
            created_ids = []
            
            # Process in batches
            for i in range(0, len(objects), self.batch_size):
                batch = objects[i:i + self.batch_size]
                
                with self._get_client().batch as batch_client:
                    batch_client.batch_size = len(batch)
                    
                    for obj in batch:
                        # Prepare object with timestamp
                        enhanced_obj = obj.copy()
                        if 'created_at' not in enhanced_obj:
                            enhanced_obj['created_at'] = datetime.utcnow().isoformat() + 'Z'
                        
                        # Validate properties
                        valid_properties = self._schema_cache.get(class_name, [])
                        filtered_obj = {
                            k: v for k, v in enhanced_obj.items() 
                            if k in valid_properties and v is not None
                        }
                        
                        if filtered_obj:
                            result = batch_client.add_data_object(
                                data_object=filtered_obj,
                                class_name=class_name
                            )
                            if result:
                                created_ids.append(result)
            
            logger.info(f"Batch created {len(created_ids)} {class_name} objects")
            return created_ids
            
        except Exception as e:
            logger.error(f"Error in batch create for {class_name}: {str(e)}")
            return []
    
    def batch_update_objects(self, class_name: str, updates: List[Dict[str, Any]]) -> int:
        """Update multiple objects in batch"""
        try:
            if not updates:
                return 0
            
            success_count = 0
            
            # Process updates in parallel for better performance
            def update_single(update_data):
                object_id = update_data.get('id')
                properties = {k: v for k, v in update_data.items() if k != 'id'}
                
                if object_id and properties:
                    return self.update_object(class_name, object_id, properties)
                return False
            
            # Use thread pool for parallel updates
            futures = []
            for update in updates:
                future = self._executor.submit(update_single, update)
                futures.append(future)
            
            # Collect results
            for future in futures:
                try:
                    if future.result(timeout=self.timeout_seconds):
                        success_count += 1
                except Exception as e:
                    logger.warning(f"Batch update failed for one object: {str(e)}")
            
            logger.info(f"Batch updated {success_count}/{len(updates)} {class_name} objects")
            return success_count
            
        except Exception as e:
            logger.error(f"Error in batch update for {class_name}: {str(e)}")
            return 0
    
    def get_object_count(self, class_name: str, where_filter: Optional[Dict] = None) -> int:
        """Get count of objects with optional filter"""
        try:
            query = self._get_client().query.aggregate(class_name).with_meta_count()
            
            if where_filter:
                query = query.with_where(where_filter)
            
            result = query.do()
            count = result.get('data', {}).get('Aggregate', {}).get(class_name, [{}])[0].get('meta', {}).get('count', 0)
            
            return count
            
        except Exception as e:
            logger.error(f"Error getting count for {class_name}: {str(e)}")
            return 0
    
    def cleanup_resources(self) -> None:
        """Cleanup service resources"""
        try:
            if hasattr(self, '_executor'):
                self._executor.shutdown(wait=True)
            
            with self._cache_lock:
                self._schema_cache.clear()
                
            logger.info("Weaviate service resources cleaned up")
        except Exception as e:
            logger.error(f"Error during cleanup: {str(e)}")
    
    def health_check(self) -> bool:
        """Check if Weaviate is healthy"""
        try:
            self._get_client().schema.get()
            return True
        except Exception as e:
            logger.error(f"Weaviate health check failed: {str(e)}")
            return False
    
    @_with_retry(max_retries=3)
    @_with_error_handling("Create object with ID")
    def create_object_with_id(self, class_name: str, object_id: str, properties: Dict[str, Any]) -> bool:
        """Create a new object with a specific ID in Weaviate"""
        try:
            logger.info(f"Attempting to create {class_name} object with ID {object_id}")
            logger.debug(f"Properties: {properties}")
            
            # Validate class exists
            if class_name not in self._schema_cache:
                logger.warning(f"Class {class_name} not found in schema cache")
                logger.info(f"Available classes in cache: {list(self._schema_cache.keys())}")
                return False
            
            # Prepare properties with timestamp
            enhanced_properties = properties.copy()
            if 'created_at' not in enhanced_properties:
                enhanced_properties['created_at'] = datetime.utcnow().isoformat() + 'Z'
            
            logger.debug(f"Enhanced properties: {enhanced_properties}")
            
            # Validate properties against schema
            valid_properties = self._schema_cache.get(class_name, [])
            logger.debug(f"Valid properties for {class_name}: {valid_properties}")
            
            filtered_properties = {
                k: v for k, v in enhanced_properties.items() 
                if k in valid_properties and v is not None
            }
            
            logger.debug(f"Filtered properties: {filtered_properties}")
            
            if not filtered_properties:
                logger.warning(f"No valid properties for {class_name}")
                return False
            
            # Check if Weaviate client is available
            client = self._get_client()
            if client is None:
                logger.error("Weaviate client is not available")
                return False
            
            logger.info(f"Creating {class_name} object with ID {object_id} and properties: {filtered_properties}")
            
            # Create object with specific ID
            self._get_client().data_object.create(
                data_object=filtered_properties,
                class_name=class_name,
                uuid=object_id
            )
            
            logger.info(f"Successfully created {class_name} object with ID {object_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error creating {class_name} with ID {object_id}: {str(e)}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return False

# Global instance with backward compatibility
weaviate_service = WeaviateServiceOptimized()

# Maintain backward compatibility
WeaviateService = WeaviateServiceOptimized 