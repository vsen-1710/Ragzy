import React, { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

const StreamingText = ({ text, onComplete }) => {
  const [displayedText, setDisplayedText] = useState('');
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    if (!text) return;

    let index = 0;
    setDisplayedText('');
    setIsComplete(false);

    // Much faster typing speed for real-time feel
    const baseSpeed = 15; // Base 15ms per character
    const maxSpeed = 40; // Max 40ms for complex text
    
    // Adjust speed based on text complexity
    const speed = Math.min(baseSpeed + (text.length > 500 ? 10 : 0), maxSpeed);

    const timer = setInterval(() => {
      if (index < text.length) {
        setDisplayedText(text.substring(0, index + 1));
        index++;
      } else {
        setIsComplete(true);
        clearInterval(timer);
        if (onComplete) onComplete();
      }
    }, speed);

    return () => clearInterval(timer);
  }, [text, onComplete]);

  return (
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
      {displayedText}
    </ReactMarkdown>
  );
};

export default StreamingText; 