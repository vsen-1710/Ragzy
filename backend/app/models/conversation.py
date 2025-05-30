from datetime import datetime
from typing import Optional, Dict, Any, List
from app.services.weaviate_service import weaviate_service

class ConversationModel:
    def __init__(self, conversation_id: str = None, user_id: str = None, title: str = None,
                 created_at: str = None, updated_at: str = None, parent_id: str = None,
                 metadata: Dict = None):
        self.id = conversation_id
        self.user_id = user_id
        self.title = title or 'New Conversation'
        self.created_at = created_at
        self.updated_at = updated_at
        self.parent_id = parent_id
        self.metadata = metadata or {}
    
    @classmethod
    def create(cls, user_id: str, title: str = None, parent_id: str = None, metadata: Dict = None) -> 'ConversationModel':
        """Create a new conversation"""
        now = datetime.utcnow().isoformat() + 'Z'  # RFC3339 format with Z suffix
        properties = {
            'user_id': str(user_id),  # Ensure user_id is always a string
            'title': title or 'New Conversation',
            'created_at': now,
            'updated_at': now,
            'parent_id': parent_id,
            'metadata': metadata or {}
        }
        conversation_id = weaviate_service.create_object('Conversation', properties)
        return cls(conversation_id=conversation_id, user_id=str(user_id), title=title,
                  created_at=now, updated_at=now, parent_id=parent_id, metadata=metadata)
    
    @classmethod
    def get_by_id(cls, conversation_id: str) -> Optional['ConversationModel']:
        """Get conversation by ID"""
        conversation_data = weaviate_service.get_object('Conversation', conversation_id)
        if conversation_data:
            props = conversation_data.get('properties', {})
            return cls(
                conversation_id=conversation_data.get('id'),
                user_id=props.get('user_id'),
                title=props.get('title'),
                created_at=props.get('created_at'),
                updated_at=props.get('updated_at'),
                parent_id=props.get('parent_id'),
                metadata=props.get('metadata', {})
            )
        return None
    
    @classmethod
    def get_by_user_id(cls, user_id: str) -> List['ConversationModel']:
        """Get all conversations for a user"""
        where_filter = {
            "path": ["user_id"],
            "operator": "Equal",
            "valueText": user_id
        }
        conversations = weaviate_service.query_objects('Conversation', where_filter=where_filter)
        return [
            cls(
                conversation_id=conv.get('_additional', {}).get('id'),
                user_id=conv.get('user_id'),
                title=conv.get('title'),
                created_at=conv.get('created_at'),
                updated_at=conv.get('updated_at'),
                parent_id=conv.get('parent_id'),
                metadata=conv.get('metadata', {})
            )
            for conv in conversations
        ]
    
    @classmethod
    def get_sub_conversations(cls, parent_id: str) -> List['ConversationModel']:
        """Get all sub-conversations for a parent conversation"""
        where_filter = {
            "path": ["parent_id"],
            "operator": "Equal",
            "valueText": parent_id
        }
        conversations = weaviate_service.query_objects('Conversation', where_filter=where_filter)
        return [
            cls(
                conversation_id=conv.get('_additional', {}).get('id'),
                user_id=conv.get('user_id'),
                title=conv.get('title'),
                created_at=conv.get('created_at'),
                updated_at=conv.get('updated_at'),
                parent_id=conv.get('parent_id'),
                metadata=conv.get('metadata', {})
            )
            for conv in conversations
        ]
    
    def save(self) -> bool:
        """Update conversation data"""
        if not self.id:
            return False
        
        self.updated_at = datetime.utcnow().isoformat() + 'Z'  # RFC3339 format with Z suffix
        properties = {
            'user_id': self.user_id,
            'title': self.title,
            'updated_at': self.updated_at,
            'parent_id': self.parent_id,
            'metadata': self.metadata
        }
        return weaviate_service.update_object('Conversation', self.id, properties)
    
    def delete(self) -> bool:
        """Delete conversation and all its messages with enhanced retry logic"""
        if not self.id:
            return False
        
        try:
            # Step 1: Delete all messages first with multiple attempts
            messages = MessageModel.get_by_conversation_id(self.id)
            print(f"Deleting {len(messages)} messages for conversation {self.id}")
            
            deleted_messages = 0
            for message in messages:
                # Try multiple deletion attempts for each message
                success = False
                for attempt in range(3):
                    try:
                        if message.delete():
                            success = True
                            break
                        else:
                            print(f"Message {message.id} deletion attempt {attempt + 1} returned False")
                    except Exception as msg_e:
                        print(f"Message {message.id} deletion attempt {attempt + 1} failed: {str(msg_e)}")
                
                if success:
                    deleted_messages += 1
                else:
                    print(f"Failed to delete message {message.id} after 3 attempts")
                    # Try direct Weaviate deletion as last resort
                    try:
                        direct_success = weaviate_service.delete_object('Message', message.id)
                        if direct_success:
                            deleted_messages += 1
                            print(f"Direct deletion succeeded for message {message.id}")
                        else:
                            print(f"Direct deletion also failed for message {message.id}")
                    except Exception as direct_e:
                        print(f"Direct deletion error for message {message.id}: {str(direct_e)}")
            
            print(f"Successfully deleted {deleted_messages}/{len(messages)} messages")
            
            # Step 2: Delete sub-conversations if this is a parent
            try:
                sub_conversations = self.get_sub_conversations(self.id)
                if sub_conversations:
                    print(f"Deleting {len(sub_conversations)} sub-conversations")
                    for sub_conv in sub_conversations:
                        try:
                            sub_conv.delete()
                        except Exception as sub_e:
                            print(f"Error deleting sub-conversation {sub_conv.id}: {str(sub_e)}")
                            # Try direct deletion
                            try:
                                weaviate_service.delete_object('Conversation', sub_conv.id)
                            except Exception:
                                pass
            except Exception as sub_check_e:
                print(f"Error checking/deleting sub-conversations: {str(sub_check_e)}")
            
            # Step 3: Multiple attempts to delete the conversation itself
            conversation_deleted = False
            for attempt in range(5):  # Try up to 5 times
                try:
                    success = weaviate_service.delete_object('Conversation', self.id)
                    if success:
                        conversation_deleted = True
                        print(f"Conversation {self.id} deleted successfully on attempt {attempt + 1}")
                        break
                    else:
                        print(f"Conversation deletion attempt {attempt + 1} returned False")
                except Exception as conv_e:
                    print(f"Conversation deletion attempt {attempt + 1} failed: {str(conv_e)}")
            
            # Step 4: Final verification
            if conversation_deleted:
                try:
                    # Verify deletion by trying to retrieve
                    verification = weaviate_service.get_object('Conversation', self.id)
                    if verification:
                        print(f"WARNING: Conversation {self.id} still exists after deletion!")
                        # One more deletion attempt
                        try:
                            final_delete = weaviate_service.delete_object('Conversation', self.id)
                            if not final_delete:
                                print(f"Final deletion attempt failed for conversation {self.id}")
                                conversation_deleted = False
                        except Exception:
                            conversation_deleted = False
                    else:
                        print(f"Verification passed: Conversation {self.id} is deleted")
                except Exception as verify_e:
                    # If verification throws an exception, the conversation might be gone
                    print(f"Verification check threw exception (likely deleted): {str(verify_e)}")
                    conversation_deleted = True
            
            return conversation_deleted
            
        except Exception as e:
            print(f"Error in enhanced conversation deletion for {self.id}: {str(e)}")
            # Last resort: try direct deletion
            try:
                return weaviate_service.delete_object('Conversation', self.id)
            except Exception as last_e:
                print(f"Last resort deletion failed: {str(last_e)}")
                return False
    
    def get_messages(self) -> List['MessageModel']:
        """Get all messages for this conversation"""
        return MessageModel.get_by_conversation_id(self.id)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            'id': self.id,
            'user_id': self.user_id,
            'title': self.title,
            'created_at': self.created_at,
            'updated_at': self.updated_at,
            'parent_id': self.parent_id,
            'metadata': self.metadata
        }
    
    def __repr__(self):
        return f'<ConversationModel {self.id} - {self.title}>'


class MessageModel:
    def __init__(self, message_id: str = None, conversation_id: str = None, role: str = None,
                 content: str = None, timestamp: str = None):
        self.id = message_id
        self.conversation_id = conversation_id
        self.role = role
        self.content = content
        self.timestamp = timestamp
    
    @classmethod
    def create(cls, conversation_id: str, role: str, content: str, timestamp: str = None) -> 'MessageModel':
        """Create a new message with optional custom timestamp"""
        message_timestamp = timestamp or datetime.utcnow().isoformat() + 'Z'  # RFC3339 format with Z suffix
        properties = {
            'conversation_id': str(conversation_id),  # Ensure conversation_id is always a string
            'role': role,
            'content': content,
            'timestamp': message_timestamp
        }
        message_id = weaviate_service.create_object('Message', properties)
        return cls(message_id=message_id, conversation_id=str(conversation_id), 
                  role=role, content=content, timestamp=message_timestamp)
    
    @classmethod
    def get_by_id(cls, message_id: str) -> Optional['MessageModel']:
        """Get message by ID"""
        message_data = weaviate_service.get_object('Message', message_id)
        if message_data:
            props = message_data.get('properties', {})
            return cls(
                message_id=message_data.get('id'),
                conversation_id=props.get('conversation_id'),
                role=props.get('role'),
                content=props.get('content'),
                timestamp=props.get('timestamp')
            )
        return None
    
    @classmethod
    def get_by_conversation_id(cls, conversation_id: str) -> List['MessageModel']:
        """Get all messages for a conversation"""
        where_filter = {
            "path": ["conversation_id"],
            "operator": "Equal",
            "valueText": conversation_id
        }
        messages = weaviate_service.query_objects('Message', where_filter=where_filter)
        return [
            cls(
                message_id=msg.get('_additional', {}).get('id'),
                conversation_id=msg.get('conversation_id'),
                role=msg.get('role'),
                content=msg.get('content'),
                timestamp=msg.get('timestamp')
            )
            for msg in messages
        ]
    
    def save(self) -> bool:
        """Update message data"""
        if not self.id:
            return False
        
        properties = {
            'conversation_id': self.conversation_id,
            'role': self.role,
            'content': self.content,
            'timestamp': self.timestamp
        }
        return weaviate_service.update_object('Message', self.id, properties)
    
    def delete(self) -> bool:
        """Delete message"""
        if not self.id:
            return False
        return weaviate_service.delete_object('Message', self.id)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            'id': self.id,
            'conversation_id': self.conversation_id,
            'role': self.role,
            'content': self.content,
            'timestamp': self.timestamp
        }
    
    def __repr__(self):
        return f'<MessageModel {self.id} - {self.role}>' 