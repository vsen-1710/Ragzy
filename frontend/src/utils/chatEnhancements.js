// Chat Enhancement Utilities
// Keyword matching system for smart responses
export const getKeywordResponse = (userInput) => {
  const input = userInput.toLowerCase();
  
  const keywordResponses = {
    // Greetings
    'hello|hi|hey|good morning|good afternoon|good evening': [
      "Hello! I'm Ragzy, your AI assistant. How can I help you today?",
      "Hi there! What can I assist you with?",
      "Hey! Great to see you. What would you like to explore today?"
    ],
    
    // Programming
    'code|programming|developer|coding|javascript|python|react|node|software|bug|debug': [
      "I'd be happy to help with your programming questions! Whether you need help debugging, writing new code, or understanding concepts, I'm here to assist.",
      "Programming is one of my strong suits! What specific coding challenge are you working on?",
      "Let's dive into some code! What programming language or framework are you working with?"
    ],
    
    // AI/ML
    'artificial intelligence|machine learning|ai|ml|neural network|deep learning|chatgpt|gpt': [
      "AI and machine learning are fascinating topics! I can help explain concepts, discuss latest trends, or assist with implementation questions.",
      "Great question about AI! I'm passionate about discussing artificial intelligence and its applications. What aspect interests you most?",
      "Machine learning is transforming how we solve problems. What specific area would you like to explore?"
    ],
    
    // Writing
    'write|writing|essay|article|blog|content|email|letter|document': [
      "I'm excellent at helping with writing tasks! Whether it's creative writing, technical documentation, or professional emails, I can assist.",
      "Writing is one of my core strengths. What type of content would you like help creating?",
      "I'd love to help you write something compelling! What's the purpose and audience for your writing?"
    ],
    
    // Math/Analysis
    'math|mathematics|calculate|analysis|statistics|data|numbers|equation|formula': [
      "Math and data analysis are right up my alley! I can help with calculations, explanations, or data interpretation.",
      "Numbers and analysis - let's dive in! What mathematical concept or problem can I help you with?",
      "I enjoy working with data and mathematical problems. What specific area would you like assistance with?"
    ],
    
    // Learning/Education
    'learn|study|education|teach|explain|understand|homework|assignment': [
      "I'm here to help you learn! I can explain complex concepts in simple terms and provide study guidance.",
      "Learning is exciting! What topic would you like to explore or understand better?",
      "I'd be happy to teach you about that! What specific aspect would you like me to explain?"
    ],
    
    // Business/Work
    'business|work|job|career|marketing|sales|strategy|management': [
      "I can help with business-related questions! Whether it's strategy, marketing, or career advice, I'm here to assist.",
      "Business and career topics are important! What specific area would you like guidance on?",
      "Let's discuss your business or work challenge. What do you need help with?"
    ],
    
    // General help
    'help|assist|support|question|problem|issue': [
      "I'm here to help with virtually anything! I can assist with coding, writing, analysis, creative projects, and much more.",
      "Happy to assist! I can help with a wide range of tasks from technical questions to creative projects. What do you need?",
      "I'm your AI assistant ready to help! Whether you need information, want to brainstorm, or need help solving problems, I'm here."
    ]
  };
  
  for (const [pattern, responses] of Object.entries(keywordResponses)) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(input)) {
      return responses[Math.floor(Math.random() * responses.length)];
    }
  }
  
  // Default responses for unmatched inputs
  const defaultResponses = [
    "That's an interesting question! Let me think about the best way to help you with that.",
    "I'd be happy to help you explore that topic. Could you provide a bit more context?",
    "Great question! I'm processing your request and will provide you with a detailed response.",
    "I understand what you're looking for. Let me provide you with a comprehensive answer.",
    "Interesting! I'm ready to dive into that topic with you. What specifically would you like to know?",
    "I'm here to help! Let me gather my thoughts on that and give you a thorough response."
  ];
  
  return defaultResponses[Math.floor(Math.random() * defaultResponses.length)];
};

// Calculate realistic thinking time based on message complexity
export const calculateThinkingTime = (message) => {
  const baseTime = 500; // minimum 500ms
  const maxTime = 2500; // maximum 2.5s
  const lengthFactor = message.length * 15; // 15ms per character
  const complexityBonus = (message.match(/[?!]/g) || []).length * 200; // 200ms per question/exclamation
  
  return Math.min(maxTime, Math.max(baseTime, lengthFactor + complexityBonus));
};

// Enhanced streaming speeds based on content type
export const getStreamingSpeed = (content) => {
  // Faster for short responses
  if (content.length < 100) return 20;
  
  // Slower for code blocks
  if (content.includes('```')) return 35;
  
  // Normal speed for regular text
  return 25;
};

// Message formatting utilities
export const formatUserMessage = (content, hasImage = false) => {
  return {
    id: Date.now(),
    role: 'user',
    content: hasImage && content === '' ? 'Shared an image' : content,
    timestamp: new Date().toISOString(),
    hasImage
  };
};

export const formatAssistantMessage = (content, options = {}) => {
  return {
    id: Date.now(),
    role: 'assistant',
    content,
    timestamp: new Date().toISOString(),
    isStreaming: options.isStreaming || false,
    isFallback: options.isFallback || false,
    ...options
  };
};

export const formatTypingMessage = () => {
  return {
    id: 'typing-' + Date.now(),
    role: 'assistant',
    content: '',
    isTyping: true,
    timestamp: new Date().toISOString()
  };
}; 