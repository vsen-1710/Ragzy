import React, { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';

const ThinkingIndicator = () => {
  const [dots, setDots] = useState('');
  const [phase, setPhase] = useState('thinking'); // thinking, processing, responding

  useEffect(() => {
    let dotInterval;
    let phaseInterval;

    // Faster dot animation
    dotInterval = setInterval(() => {
      setDots(prev => {
        if (prev === '') return '.';
        if (prev === '.') return '..';
        if (prev === '..') return '...';
        return '';
      });
    }, 300);

    // Faster phase changes for more dynamic feel
    phaseInterval = setInterval(() => {
      setPhase(prev => {
        if (prev === 'thinking') return 'processing';
        if (prev === 'processing') return 'responding';
        return 'thinking';
      });
    }, 1500);

    return () => {
      clearInterval(dotInterval);
      clearInterval(phaseInterval);
    };
  }, []);

  const getPhaseText = () => {
    switch (phase) {
      case 'thinking': return 'thinking';
      case 'processing': return 'processing';
      case 'responding': return 'preparing response';
      default: return 'thinking';
    }
  };

  return (
    <Box className="thinking-indicator">
      <Box className="thinking-dots">
        {[0, 1, 2].map((index) => (
          <Box
            key={index}
            className="thinking-dot"
            sx={{
              animationDelay: `${index * 0.16}s`,
            }}
          />
        ))}
      </Box>
      <Typography className="thinking-text">
        Ragzy is {getPhaseText()}{dots}
      </Typography>
    </Box>
  );
};

export default ThinkingIndicator; 