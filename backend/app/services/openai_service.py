import os
import json
from openai import OpenAI
from flask import current_app
import hashlib
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any, Union
from functools import wraps, lru_cache
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from app import redis_client
import time
import random
import base64
import mimetypes

class OpenAIServiceOptimized:
    # OpenAI API configuration constants - ULTRA FAST OPTIMIZATION
    DEFAULT_MODEL = "gpt-3.5-turbo"  # Fastest model
    VISION_MODEL = "gpt-4o-mini"     # Faster vision model
    MAX_TOKENS = 200                 # Reduced for ultra-fast responses
    DEFAULT_TEMPERATURE = 0.3        # Lower for faster, more consistent responses
    CACHE_TTL = 7200                 # 2 hours - longer caching
    RATE_LIMIT_WINDOW = 60
    MAX_REQUESTS_PER_WINDOW = 150    # Increased for speed
    
    # Performance optimization constants - LIGHTNING FAST
    MAX_CONTEXT_MESSAGES = 4         # Minimal context for speed
    BATCH_SIZE = 2                   # Smaller batches
    CONNECTION_POOL_SIZE = 20        # More connections
    TIMEOUT_SECONDS = 10             # Ultra-short timeout for lightning responses
    
    def __init__(self):
        self.model = os.getenv("OPENAI_MODEL", self.DEFAULT_MODEL)
        self.redis = redis_client
        self.api_key = os.getenv("OPENAI_API_KEY")
        
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY environment variable is required")
        
        # Initialize the new OpenAI client
        self.client = OpenAI(api_key=self.api_key)
        
        # Initialize thread pool for async operations
        self._executor = ThreadPoolExecutor(max_workers=self.CONNECTION_POOL_SIZE)
        
        # Cache for frequently used prompts
        self._prompt_cache = {}
        
        # Rate limiting tracking
        self._rate_limits = {}
        self._rate_limit_lock = threading.Lock()

    @staticmethod
    def _cache_response(ttl: int = 3600):
        """Enhanced decorator for caching OpenAI responses with better key generation"""
        def decorator(func):
            @wraps(func)
            def wrapper(self, *args, **kwargs):
                # Create more specific cache key that includes actual message content
                cache_data = {
                    'func': func.__name__,
                    'model': self.model,
                    'timestamp_bucket': int(time.time() // 1800)  # 30-minute buckets instead of 5-minute
                }
                
                # For generate_response, include the actual user message content
                if func.__name__ == 'generate_response' and args:
                    messages = args[0] if args else []
                    if isinstance(messages, list) and messages:
                        # Get the last user message (the actual question)
                        user_messages = [msg for msg in messages if msg.get('role') == 'user']
                        if user_messages:
                            last_user_message = user_messages[-1].get('content', '')
                            # Include the full user message in cache key (truncated for size)
                            cache_data['user_message'] = last_user_message[:300]
                            
                            # Add randomness for repeated questions to prevent identical responses
                            if '[REPEAT QUESTION]' in last_user_message:
                                cache_data['variation_seed'] = int(time.time() % 100)  # Add variation
                        
                        # Include conversation context but with less weight
                        if len(messages) > 2:
                            context_summary = str([msg.get('role') for msg in messages[-3:]])
                            cache_data['context_roles'] = context_summary
                else:
                    # For other functions, include args as before
                    cache_data['args'] = str(args)[:200]
                    cache_data['kwargs'] = {k: str(v)[:100] for k, v in kwargs.items()}
                
                cache_key = f"openai_v5:{hashlib.sha256(str(cache_data).encode()).hexdigest()[:20]}"
                
                # Try to get from cache
                try:
                    cached = self.redis.get(cache_key)
                    if cached:
                        cached_response = json.loads(cached)
                        # Add debug info for cache hits
                        if func.__name__ == 'generate_response':
                            current_app.logger.info(f"Cache hit for message: {cache_data.get('user_message', '')[:50]}...")
                        return cached_response
                except (json.JSONDecodeError, Exception):
                    pass
                
                # Get fresh response
                result = func(self, *args, **kwargs)
                
                # Cache the response with appropriate TTL
                if result:
                    try:
                        cache_ttl = ttl
                        if func.__name__ == 'generate_response':
                            # Much shorter TTL for conversation responses to allow more variation
                            cache_ttl = min(ttl, 300)  # Max 5 minutes for conversation responses
                            
                            # Even shorter TTL for repeated questions
                            if 'variation_seed' in cache_data:
                                cache_ttl = 60  # Only 1 minute for repeated questions
                        
                        self._executor.submit(
                            self.redis.setex, 
                            cache_key, 
                            cache_ttl, 
                            json.dumps(result, ensure_ascii=False)
                        )
                        
                        if func.__name__ == 'generate_response':
                            current_app.logger.info(f"Cached new response for: {cache_data.get('user_message', '')[:50]}... (TTL: {cache_ttl}s)")
                    except Exception:
                        pass  # Don't fail if caching fails
                
                return result
            return wrapper
        return decorator

    def _check_rate_limit_optimized(self, user_id: str) -> bool:
        """Optimized rate limiting with better performance"""
        with self._rate_limit_lock:
            current_time = datetime.utcnow()
            
            # Clean old entries
            if user_id in self._rate_limits:
                self._rate_limits[user_id] = [
                    timestamp for timestamp in self._rate_limits[user_id]
                    if current_time - timestamp < timedelta(seconds=self.RATE_LIMIT_WINDOW)
                ]
            else:
                self._rate_limits[user_id] = []
            
            # Check limit
            if len(self._rate_limits[user_id]) >= self.MAX_REQUESTS_PER_WINDOW:
                return False
            
            # Add current request
            self._rate_limits[user_id].append(current_time)
            return True

    @lru_cache(maxsize=128)
    def _get_system_prompt(self, prompt_type: str = "default") -> str:
        """Cached system prompts for better performance"""
        prompts = {
            "default": "You are a helpful AI assistant. Be concise and direct in your responses."
        }
        return prompts.get(prompt_type, prompts["default"])

    def _optimize_messages_enhanced(self, messages: List[Dict], max_messages: int = None) -> List[Dict]:
        """Enhanced message optimization with better token management"""
        if not messages:
            return []
        
        max_messages = max_messages or self.MAX_CONTEXT_MESSAGES
        
        if len(messages) <= max_messages:
            return messages
        
        # Separate system messages and conversation messages
        system_messages = [msg for msg in messages if msg.get('role') == 'system']
        conversation_messages = [msg for msg in messages if msg.get('role') != 'system']
        
        # Keep most recent conversation messages
        recent_messages = conversation_messages[-(max_messages - len(system_messages)):]
        
        # Optimize content length for token efficiency
        optimized_messages = system_messages.copy()
        for msg in recent_messages:
            content = msg.get('content', '')
            if len(content) > 1000:  # Truncate very long messages
                content = content[:900] + "... [truncated]"
            optimized_messages.append({
                'role': msg['role'],
                'content': content
            })
        
        return optimized_messages

    def encode_image_to_base64(self, image_path: str) -> str:
        """Encode image to base64 string"""
        try:
            with open(image_path, "rb") as image_file:
                return base64.b64encode(image_file.read()).decode('utf-8')
        except Exception as e:
            current_app.logger.error(f"Error encoding image: {str(e)}")
            raise ValueError(f"Failed to encode image: {str(e)}")

    def get_image_mime_type(self, image_path: str) -> str:
        """Get MIME type of image"""
        mime_type, _ = mimetypes.guess_type(image_path)
        if mime_type and mime_type.startswith('image/'):
            return mime_type
        return 'image/jpeg'  # Default fallback

    def create_vision_message(self, text: str, image_path: str = None) -> Dict:
        """Create a message with vision support"""
        content = []
        
        # Add text content
        if text:
            content.append({
                "type": "text",
                "text": text
            })
        
        # Add image content if provided
        if image_path:
            base64_image = self.encode_image_to_base64(image_path)
            mime_type = self.get_image_mime_type(image_path)
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:{mime_type};base64,{base64_image}",
                    "detail": "high"  # Can be "low", "high", or "auto"
                }
            })
        
        return {
            "role": "user",
            "content": content
        }

    def has_vision_content(self, messages: List[Dict]) -> bool:
        """Check if any message contains image content"""
        for message in messages:
            content = message.get('content', '')
            if isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get('type') == 'image_url':
                        return True
        return False

    def encode_image(self, image_path: str) -> str:
        """Encode image to base64 for OpenAI API"""
        try:
            with open(image_path, "rb") as image_file:
                encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
                # Get MIME type
                mime_type, _ = mimetypes.guess_type(image_path)
                if not mime_type or not mime_type.startswith('image/'):
                    mime_type = 'image/jpeg'  # Default fallback
                return f"data:{mime_type};base64,{encoded_string}"
        except Exception as e:
            current_app.logger.error(f"Error encoding image: {str(e)}")
            raise ValueError(f"Failed to encode image: {str(e)}")

    def generate_response_with_vision(self, messages: List[Dict], user_text: str, image_path: str, user_id: str = "default") -> str:
        """Generate response with vision capabilities for image analysis"""
        try:
            # Rate limiting check
            if not self._check_rate_limit_optimized(user_id):
                return "Rate limit exceeded. Please try again later."
            
            # Encode the image
            base64_image = self.encode_image(image_path)
            
            # Create message with both text and image
            user_message = {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": user_text
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": base64_image,
                            "detail": "auto"  # Let OpenAI choose the detail level
                        }
                    }
                ]
            }
            
            # Optimize previous messages for context (text only)
            optimized_messages = self._optimize_messages_enhanced(messages, self.MAX_CONTEXT_MESSAGES - 1)
            
            # Add system message if not present
            if not any(msg.get('role') == 'system' for msg in optimized_messages):
                system_msg = {
                    'role': 'system',
                    'content': self._get_vision_system_prompt()
                }
                optimized_messages.insert(0, system_msg)
            
            # Add the new message with image
            optimized_messages.append(user_message)
            
            # Make API call with vision model
            for attempt in range(3):
                try:
                    response = self.client.chat.completions.create(
                        model=self.VISION_MODEL,
                        messages=optimized_messages,
                        max_tokens=self.MAX_TOKENS,
                        temperature=self.DEFAULT_TEMPERATURE,
                        timeout=self.TIMEOUT_SECONDS
                    )
                    
                    assistant_response = response.choices[0].message.content.strip()
                    
                    if not assistant_response:
                        return "I apologize, but I couldn't analyze the image properly. Please try again with a different image."
                    
                    return assistant_response
                    
                except Exception as e:
                    error_msg = str(e).lower()
                    if 'rate_limit' in error_msg:
                        if attempt < 2:
                            wait_time = (2 ** attempt) + random.uniform(0, 1)
                            current_app.logger.warning(f"Rate limit hit, waiting {wait_time:.2f} seconds...")
                            time.sleep(wait_time)
                            continue
                        else:
                            return "I'm currently experiencing high demand. Please try again in a few moments."
                    
                    elif 'content policy' in error_msg or 'safety' in error_msg:
                        return "I cannot analyze this image as it may violate content policies."
                    elif 'token' in error_msg:
                        return "The image or conversation is too large. Please try with a smaller image or start a new conversation."
                    elif 'vision' in error_msg or 'image' in error_msg:
                        return "I'm having trouble processing the image. Please try again with a different image format."
                    else:
                        current_app.logger.error(f"OpenAI Vision API error: {str(e)}")
                        if attempt < 2:
                            wait_time = (2 ** attempt) + random.uniform(0, 1)
                            current_app.logger.warning(f"Vision API error, retrying in {wait_time:.2f} seconds...")
                            time.sleep(wait_time)
                            continue
                        return "I'm having trouble analyzing the image. Please try again."
            
            return "I'm currently unable to process the image. Please try again later."
            
        except Exception as e:
            current_app.logger.error(f"Critical error in generate_response_with_vision: {str(e)}")
            return "I'm currently experiencing technical difficulties with image processing. Please try again."
        finally:
            # Clean up the uploaded image file if it exists
            try:
                if image_path and os.path.exists(image_path):
                    os.remove(image_path)
                    current_app.logger.info(f"Cleaned up uploaded image: {image_path}")
            except Exception as e:
                current_app.logger.warning(f"Failed to clean up image file {image_path}: {str(e)}")

    def _get_vision_system_prompt(self) -> str:
        """Get enhanced system prompt for vision-enabled conversations"""
        return """You are Ragzy, an intelligent and helpful AI assistant with vision capabilities. You can analyze images and provide detailed, accurate descriptions and insights.

When analyzing images:
- Provide clear, detailed descriptions of what you see
- Identify objects, people, text, scenes, and activities
- Note colors, composition, style, and notable features
- If asked specific questions about the image, focus your response accordingly
- Be helpful and informative while maintaining accuracy
- If you cannot clearly see something in the image, acknowledge this limitation

Respond in a conversational, friendly tone while being precise and informative."""

    @_cache_response(ttl=3600)  # AGGRESSIVE CACHE for ultra-fast responses
    def generate_response(self, messages: List[Dict], user_id: str = "default", has_images: bool = False) -> str:
        """LIGHTNING-FAST response generation - INSTANT FULL RESPONSES ONLY"""
        try:
            # Rate limiting check
            if not self._check_rate_limit_optimized(user_id):
                return "Rate limit exceeded. Please try again later."
            
            # ULTRA-AGGRESSIVE context optimization for maximum speed
            optimized_messages = self._optimize_messages_enhanced(messages, 3)  # Only 3 messages max
            
            # Force fastest model always
            model_to_use = self.DEFAULT_MODEL
            
            # Ultra-minimal system message for speed
            if not any(msg.get('role') == 'system' for msg in optimized_messages):
                system_msg = {
                    'role': 'system',
                    'content': "You are Ragzy AI. Be helpful and concise."  # Ultra-short prompt
                }
                optimized_messages.insert(0, system_msg)
            
            # LIGHTNING-FAST API call with ZERO STREAMING
            for attempt in range(1):  # Single attempt for speed
                try:
                    response = self.client.chat.completions.create(
                        model=model_to_use,
                        messages=optimized_messages,
                        max_tokens=self.MAX_TOKENS,
                        temperature=self.DEFAULT_TEMPERATURE,
                        timeout=self.TIMEOUT_SECONDS,
                        stream=False,           # ABSOLUTELY NO STREAMING
                        top_p=0.95,           # Optimized for speed
                        frequency_penalty=0,   # Faster processing
                        presence_penalty=0,    # Faster processing
                        user=user_id[:50]      # Truncated user ID for speed
                    )
                    
                    assistant_response = response.choices[0].message.content.strip()
                    
                    if not assistant_response:
                        return "I'll help you with that! Please ask me anything."
                    
                    # Log for speed monitoring
                    current_app.logger.info(f"LIGHTNING RESPONSE: {len(assistant_response)} chars")
                    
                    return assistant_response
                    
                except Exception as e:
                    error_msg = str(e).lower()
                    if 'rate_limit' in error_msg:
                        return "I'm experiencing high demand. Please try again."
                    elif 'token' in error_msg:
                        return "Request too long. Please try a shorter message."
                    else:
                        current_app.logger.error(f"OpenAI API error: {str(e)}")
                        return "I'm having connection issues. Please try again."
            
            return "I'm ready to help! Please try your request again."
            
        except Exception as e:
            current_app.logger.error(f"Critical error in generate_response: {str(e)}")
            return "I'm experiencing technical difficulties. Please try again."

    def cleanup(self):
        """Cleanup resources"""
        if hasattr(self, '_executor'):
            self._executor.shutdown(wait=True)

    def clear_cache(self, pattern: str = "openai_v*:*"):
        """Clear OpenAI response cache"""
        try:
            keys = self.redis.keys(pattern)
            if keys:
                self.redis.delete(*keys)
                current_app.logger.info(f"Cleared {len(keys)} cache entries")
                return len(keys)
            return 0
        except Exception as e:
            current_app.logger.error(f"Error clearing cache: {str(e)}")
            return 0

# Maintain backward compatibility
OpenAIService = OpenAIServiceOptimized
