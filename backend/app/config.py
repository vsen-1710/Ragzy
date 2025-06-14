import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev_key")
    
    # JWT configuration
    JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", SECRET_KEY)
    JWT_ACCESS_TOKEN_EXPIRES = 7 * 24 * 60 * 60  # 7 days in seconds
    JWT_TOKEN_LOCATION = ["headers"]
    JWT_HEADER_NAME = "Authorization"
    JWT_HEADER_TYPE = "Bearer"
    
    # Weaviate configuration - check if we're in Docker or local
    WEAVIATE_URL = os.environ.get("WEAVIATE_URL", "http://localhost:8080")
    WEAVIATE_API_KEY = os.environ.get("WEAVIATE_API_KEY")  # Optional for local setup
    
    # Redis configuration - support both Docker and local development
    REDIS_HOST = os.environ.get('REDIS_HOST', 'localhost')
    REDIS_PORT = os.environ.get('REDIS_PORT', '6379')
    REDIS_DB = os.environ.get('REDIS_DB', '0')
    REDIS_URL = f"redis://{REDIS_HOST}:{REDIS_PORT}/{REDIS_DB}"
    
    # OpenAI configuration
    OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
    
    # Default model to use
    DEFAULT_MODEL = "gpt-4"
    
    # Log configuration
    LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "logs")
    os.makedirs(LOG_DIR, exist_ok=True)
