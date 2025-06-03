import React from 'react';
import { Box, Typography, Avatar, IconButton, Tooltip } from '@mui/material';
import { 
  ContentCopy as ContentCopyIcon, 
  Image as ImageIcon,
  Refresh as RefreshIcon 
} from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ThinkingIndicator from './ThinkingIndicator';
import StreamingText from './StreamingText';

const MessageBubble = ({ msg, onCopy, onStreamingComplete, onRegenerate, setMessages, setCanCancel }) => {
  const isUser = msg.role === 'user';
  
  // Function to find the previous user message for regeneration
  const findPreviousUserMessage = () => {
    // This would need to be passed from parent or we need access to all messages
    // For now, we'll need to modify this to get the user message from context
    return null;
  };

  // Handle regenerate click
  const handleRegenerateClick = () => {
    if (onRegenerate) {
      // Find the user message that prompted this AI response
      // We'll need to pass this from the parent component
      onRegenerate(msg.regeneratePrompt || '', msg.regenerateHasImage || false);
    }
  };

  return (
    <Box className={`message-bubble ${isUser ? 'user-message' : 'ai-message'}`}>
      <Box className="message-content">
        {isUser ? (
          <>
            {/* Empty left space to push content right */}
            <Box className="message-spacer" />
            
            {/* User content taking right half */}
            <Box className="user-content">
              <Box className="user-text-content">
                {/* User message content without "You:" prefix */}
                <Typography className="user-message-text">
                  {msg.hasImage && msg.content !== 'Shared an image' ? msg.content : 
                   msg.hasImage ? 'Shared an image' : msg.content}
                </Typography>
                
                {/* Display image placeholder if this message has an image */}
                {msg.hasImage && (
                  <Box className="image-attachment">
                    <Box className="image-placeholder">
                      <ImageIcon className="image-icon" />
                      <Typography className="image-label">
                        Image attached
                      </Typography>
                    </Box>
                  </Box>
                )}
                
                {/* Timestamp */}
                <Typography className="message-timestamp user-timestamp">
                  {new Date(msg.timestamp).toLocaleTimeString([], { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  })}
                </Typography>
              </Box>

              <Box className="user-avatar-container">
                <Avatar className="user-avatar">
                  U
                </Avatar>
              </Box>
            </Box>
          </>
        ) : (
          /* AI Response - Enhanced with Streaming Support */
          <>
            {/* AI Avatar */}
            <Box className="ai-avatar-container">
              <Avatar className="ai-avatar">
                R
              </Avatar>
            </Box>

            {/* AI content taking available width */}
            <Box className="ai-content">
              {msg.isTyping ? (
                <ThinkingIndicator />
              ) : (
                <>
                  {/* Response content with streaming support */}
                  <Box className="ai-message-content">
                    {msg.isStreaming ? (
                      <StreamingText 
                        text={msg.content} 
                        onComplete={() => {
                          // Mark streaming as complete and scroll to show full response
                          setMessages(prev => prev.map(m => 
                            m.id === msg.id ? { ...m, isStreaming: false } : m
                          ));
                          setCanCancel(false); // Ensure stop button is hidden when streaming completes
                          if (onStreamingComplete) onStreamingComplete();
                        }}
                      />
                    ) : (
                      <ReactMarkdown
                        components={{
                          code({ node, inline, className, children, ...props }) {
                            const match = /language-(\w+)/.exec(className || '');
                            return !inline && match ? (
                              <Box className="code-block">
                                <SyntaxHighlighter
                                  style={oneDark}
                                  language={match[1]}
                                  PreTag="div"
                                  showLineNumbers={false}
                                  wrapLines={false}
                                  wrapLongLines={true}
                                  customStyle={{
                                    backgroundColor: '#1a1a1a',
                                    border: '1px solid #333333',
                                    borderRadius: '4px',
                                    padding: '12px',
                                    margin: '12px 0',
                                    overflow: 'auto',
                                    fontSize: '12px',
                                    lineHeight: 1.4,
                                    maxHeight: '300px',
                                    maxWidth: '85%',
                                    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
                                    boxShadow: 'none',
                                    outline: 'none'
                                  }}
                                  {...props}
                                >
                                  {String(children).replace(/\n$/, '')}
                                </SyntaxHighlighter>
                              </Box>
                            ) : (
                              <code className="inline-code" {...props}>
                                {children}
                              </code>
                            );
                          },
                          p({ children }) {
                            return (
                              <Typography className="markdown-paragraph">
                                {children}
                              </Typography>
                            );
                          }
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    )}
                  </Box>

                  {/* Fallback indicator for keyword-based responses */}
                  {msg.isFallback && (
                    <Box className="fallback-indicator">
                      <Box className="fallback-icon">⚡</Box>
                      <Typography className="fallback-text">
                        Quick response (keyword-based)
                      </Typography>
                    </Box>
                  )}

                  {/* Compact actions row for AI messages */}
                  <Box className="message-actions">
                    <Tooltip title="Copy response">
                      <IconButton
                        className="copy-button"
                        onClick={() => onCopy(msg.content)}
                      >
                        <ContentCopyIcon className="copy-icon" />
                      </IconButton>
                    </Tooltip>

                    {/* Regenerate Button - only show for completed AI responses */}
                    {!msg.isStreaming && !msg.isTyping && onRegenerate && msg.regeneratePrompt && (
                      <Tooltip title="Regenerate response">
                        <IconButton
                          className="regenerate-button"
                          onClick={handleRegenerateClick}
                          sx={{
                            color: '#6b7280',
                            width: 28,
                            height: 28,
                            '&:hover': {
                              color: '#374151',
                              backgroundColor: '#f1f5f9',
                              transform: 'rotate(180deg)',
                            },
                            transition: 'all 0.3s ease',
                          }}
                        >
                          <RefreshIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    
                    <Typography className="message-timestamp ai-timestamp">
                      {new Date(msg.timestamp).toLocaleTimeString([], { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}
                    </Typography>
                  </Box>
                </>
              )}
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
};

export default MessageBubble; 