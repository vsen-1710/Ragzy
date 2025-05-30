# Personal GPT

A self-hosted personal AI assistant built with Flask, Redis, Weaviate, and the OpenAI API.

## Features

- **Natural language conversation** with contextual memory
- **Parent-Child Chat Structure** - Main chats can have multiple sub-chats
- **Enhanced Context Awareness** - AI responses include context from all related sub-chats
- **Short-term memory** using Redis with hierarchy tracking
- **Long-term storage** with Weaviate vector database
- **Real-time context sharing** across chat hierarchies

## Tech Stack

- **Backend**: Flask, Redis, Weaviate
- **Database**: Weaviate (vector database), Redis (conversation context & hierarchy)
- **AI**: OpenAI GPT models
- **Deployment**: Docker, docker-compose

## Parent-Child Chat Architecture

### Core Concepts

1. **Main Chat (main_chat_id)**: Top-level conversation that can have multiple sub-chats
2. **Sub Chat (sub_chat_id)**: Child conversation under a main chat
3. **Hierarchy Tracking**: Redis stores the relationships between main and sub chats
4. **Context Inclusion**: When chatting in any sub-chat, the AI has access to context from:
   - All previous messages in the current sub-chat
   - All messages from other sub-chats under the same main chat
   - All messages from the main chat itself

### Data Storage

#### Redis Structure
```
# Hierarchy mappings
hierarchy:main:{main_chat_id} -> [sub_chat_id1, sub_chat_id2, ...]
hierarchy:sub:{sub_chat_id} -> {main_chat_id, user_id, created_at}

# Main chat context (for quick access)
main_chat_context:{main_chat_id} -> [recent_messages_from_all_sub_chats]

# Individual chat messages
conv:{user_id}:{chat_id} -> [messages_with_hierarchy_info]
```

#### Weaviate Structure
- **Conversation** objects with parent_id field for hierarchy
- **Message** objects linked to conversations
- **Enhanced metadata** for chat relationships

### Context Flow Example

```
Main Chat: "Planning vacation"
├── Sub Chat 1: "Flight bookings" 
│   ├── Messages about flight preferences
│   └── Flight booking confirmations
├── Sub Chat 2: "Hotel reservations"
│   ├── Hotel search criteria
│   └── Hotel booking details
└── Sub Chat 3: "Activity planning"
    ├── Tourist attractions research
    └── Activity bookings

# When asking in Sub Chat 3: "What's my total budget so far?"
# AI has context from ALL previous sub-chats:
# - Flight costs from Sub Chat 1
# - Hotel costs from Sub Chat 2  
# - Can provide comprehensive budget overview
```

## Setup and Installation

### Prerequisites

- Docker and docker-compose
- OpenAI API key

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/personal_gpt.git
   cd personal_gpt
   ```

2. Create a `.env` file with the following variables:
   ```
   # Flask Config
   FLASK_APP=run.py
   FLASK_ENV=development
   SECRET_KEY=your_secret_key_here

   # OpenAI API
   OPENAI_API_KEY=your_openai_api_key_here

   # Weaviate Config
   WEAVIATE_URL=http://weaviate:8080

   # Redis Config
   REDIS_URL=redis://redis:6379/0
   ```

3. Build and start the containers:
   ```bash
   docker-compose up -d
   ```

## API Endpoints

### Chat Management

#### Basic Operations
- `GET /api/chat/conversations` - Get all conversations
- `POST /api/chat/conversations` - Create a new conversation or sub-conversation
  ```json
  {
    "title": "Conversation Title",
    "parent_id": "parent_conversation_id"  // Optional: for sub-conversations
  }
  ```
- `GET /api/chat/conversations/{id}/messages` - Get messages for a conversation
- `POST /api/chat/conversations/{id}/messages` - Send a message and get a response

#### Hierarchy Management
- `POST /api/chat/conversations/{id}/sub-conversations` - Create a sub-conversation
- `GET /api/chat/conversations/{id}/sub-conversations` - Get all sub-conversations
- `GET /api/chat/conversations/{id}/hierarchy` - Get hierarchy statistics
- `GET /api/chat/conversations/{id}/main-chat-context` - Get comprehensive main chat context

#### Enhanced Context
- `GET /api/chat/conversations/{id}/context?include_all_sub_chats=true&limit=50` - Get enhanced context
- `GET /api/chat/conversations/{id}/all-messages?limit=200` - Get all messages from chat tree

### Response Examples

#### Creating a Sub-Conversation
```json
POST /api/chat/conversations/main_123/sub-conversations
{
  "title": "Flight Bookings"
}

Response:
{
  "success": true,
  "conversation": {
    "id": "sub_456",
    "title": "Flight Bookings", 
    "parent_id": "main_123",
    "is_sub_conversation": true,
    "main_chat_id": "main_123",
    "created_at": "2023-12-01T10:00:00Z"
  }
}
```

#### Getting Hierarchy Info
```json
GET /api/chat/conversations/sub_456/hierarchy

Response:
{
  "success": true,
  "hierarchy": {
    "conversation_id": "sub_456",
    "main_chat_id": "main_123", 
    "is_main_chat": false,
    "total_sub_chats": 3,
    "sub_chat_ids": ["sub_456", "sub_789", "sub_101"],
    "total_messages_in_tree": 45
  }
}
```

#### Enhanced Context Response
```json
GET /api/chat/conversations/sub_456/context?include_all_sub_chats=true

Response:
{
  "success": true,
  "context_messages": [
    {
      "role": "system",
      "content": "You are a helpful AI assistant with access to conversation history from multiple related chats..."
    },
    {
      "role": "system", 
      "content": "--- Messages from sub-chat: Hotel Reservations ---"
    },
    {
      "role": "user",
      "content": "What hotels are available in Paris?",
      "source_chat": "Hotel Reservations"
    },
    {
      "role": "assistant", 
      "content": "Here are some great hotels in Paris...",
      "source_chat": "Hotel Reservations"
    }
  ],
  "total_messages": 25
}
```

## Development

### Project Structure

```
personal_gpt/
├── app/
│   ├── models/          # Database models with hierarchy support
│   │   ├── conversation.py  # Enhanced with parent_id
│   │   └── user.py
│   ├── routes/          # API endpoints
│   │   └── chat.py      # Enhanced with hierarchy routes
│   ├── services/        # Business logic
│   │   ├── chat_service.py      # Enhanced hierarchy management
│   │   ├── redis_service.py     # Hierarchy tracking in Redis
│   │   ├── weaviate_service.py  # Vector storage
│   │   └── openai_service.py    # AI responses
│   ├── utils/           # Utilities
│   ├── __init__.py      # App initialization
│   └── config.py        # Configuration
├── docker-compose.yml
├── Dockerfile
├── .env
├── requirements.txt
└── run.py
```

### Key Features Implementation

#### 1. Hierarchy Tracking
- **Redis**: Fast lookup of main_chat ↔ sub_chat relationships
- **Weaviate**: Persistent storage with parent_id references
- **Cache**: Local caching for frequently accessed conversations

#### 2. Context Aggregation
- **Multi-source**: Combines messages from all related chats
- **Chronological ordering**: Messages sorted by timestamp across all chats
- **Smart boundaries**: Clear markers between different chat contexts
- **Efficient retrieval**: Redis-first with Weaviate fallback

#### 3. Enhanced AI Responses  
- **Full context awareness**: AI sees all related conversation history
- **Source attribution**: Can reference which chat previous discussions came from
- **Consistency**: Maintains coherent responses across the chat tree
- **Performance**: Optimized context loading with configurable limits

## Configuration Options

### Chat Service Settings
```python
# In chat_service.py
max_context_messages = 15           # Max messages in AI context
max_sub_chats_context = 50         # Max messages from all sub-chats  
context_merge_strategy = 'chronological'  # or 'priority'
max_context_depth = 3              # Maximum parent traversal depth
```

### Redis TTL Settings
```python
# In redis_service.py  
conversation_ttl = 60 * 60 * 24 * 7    # 7 days
metadata_ttl = 60 * 60 * 24 * 30       # 30 days
cache_ttl = 60 * 60                    # 1 hour
```

## Roadmap

### Phase 1 (Completed) ✅
- Basic chat with memory
- Parent-child chat structure  
- Enhanced context from all sub-chats
- Redis hierarchy tracking
- Weaviate integration

### Phase 2 (In Progress)
- Chat search across hierarchies
- Export/import chat trees
- Advanced context strategies
- Chat analytics and insights

### Phase 3 (Planned)  
- Screen/app monitoring integration
- Multi-user support with permissions
- Chat templates and workflows
- API rate limiting and quotas

## Performance Notes

- **Redis-first approach**: Chat hierarchy and recent messages stored in Redis for fast access
- **Weaviate fallback**: Long-term storage and advanced querying via vector database  
- **Lazy loading**: Sub-chat context loaded on-demand
- **Configurable limits**: Prevent memory issues with large chat trees
- **Connection pooling**: Optimized database connections
- **Async operations**: Non-blocking operations where possible

## Troubleshooting

### Common Issues

1. **Context not loading from sub-chats**
   - Check Redis connectivity: `docker logs personal_gpt_redis_1`
   - Verify hierarchy mapping: GET `/api/chat/conversations/{id}/hierarchy`

2. **AI responses missing context**
   - Check `include_all_sub_chats=true` parameter
   - Verify main_chat_id resolution in logs

3. **Performance issues with large chat trees**
   - Adjust `max_sub_chats_context` in chat_service.py
   - Consider implementing pagination for very large hierarchies

### Debug Endpoints

- `GET /api/chat/conversations/{id}/hierarchy` - Check hierarchy structure
- `GET /api/chat/conversations/{id}/context` - Inspect context loading  
- `GET /api/chat/conversations/{id}/all-messages` - View all related messages

## License

MIT
