/**
 * ChatGPT-like Integration Example
 * Shows how to integrate ChatMemoryManager with your existing chat system
 * Preserves all your existing search tracking logic
 */

import { BrowserActivityTracker } from './browserActivityTracker.js';
import { ChatMemoryManager } from './chatMemoryManager.js';

class ChatGPTIntegration {
  constructor(userId) {
    this.userId = userId;
    
    // Initialize both systems
    BrowserActivityTracker.initialize(userId, true); // Enable search tracking
    ChatMemoryManager.initialize(userId);
    
    console.log('🤖 ChatGPT-like system initialized with search context tracking');
  }

  /**
   * Process user message with full context (main method to use)
   */
  async processUserMessage(userMessage, sendToAI = true) {
    try {
      console.log(`📝 Processing message: "${userMessage}"`);
      
      // Store message and generate context-aware prompt
      const { userMsgId, contextPrompt } = ChatMemoryManager.processMessage(userMessage);
      
      console.log('🔍 Generated context prompt:', contextPrompt);
      
      if (sendToAI) {
        // Here you would send the contextPrompt to your AI service
        // For now, we'll simulate an AI response
        const aiResponse = await this.sendToAI(contextPrompt);
        
        // Store AI response
        ChatMemoryManager.processAIResponse(aiResponse, userMsgId);
        
        return {
          userMessage,
          aiResponse,
          contextUsed: contextPrompt,
          messageId: userMsgId
        };
      } else {
        return {
          userMessage,
          contextPrompt,
          messageId: userMsgId
        };
      }
      
    } catch (error) {
      console.error('Error processing user message:', error);
      return {
        userMessage,
        aiResponse: "I'm sorry, I encountered an error processing your message.",
        error: error.message
      };
    }
  }

  /**
   * Simulate AI response (replace with your actual AI service)
   */
  async sendToAI(contextPrompt) {
    // This is where you'd integrate with your actual AI service
    // For example: OpenAI API, Claude API, or your custom AI endpoint
    
    console.log('🤖 Sending to AI service...');
    
    // Simulate AI processing time
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Extract the user message from the context prompt
    const userMessageMatch = contextPrompt.match(/User Message: "(.*?)"/);
    const userMessage = userMessageMatch ? userMessageMatch[1] : '';
    
    // Extract search context if available
    const searchContextMatch = contextPrompt.match(/Most Recent Search: "(.*?)"/);
    const searchQuery = searchContextMatch ? searchContextMatch[1] : null;
    
    // Generate contextual response based on patterns
    let response = this.generateContextualResponse(userMessage, searchQuery, contextPrompt);
    
    return response;
  }

  /**
   * Generate contextual responses based on search patterns
   */
  generateContextualResponse(userMessage, searchQuery, fullContext) {
    const message = userMessage.toLowerCase();
    
    // Context-dependent responses
    const contextualKeywords = ['best', 'better', 'which', 'what', 'recommend', 'compare', 'vs', 'choose', 'pick'];
    const isContextual = contextualKeywords.some(keyword => message.includes(keyword));
    
    if (searchQuery && isContextual) {
      if (message.includes('best') || message.includes('which')) {
        return `Based on your recent search for "${searchQuery}", I can help you find the best options. Here are some key factors to consider when choosing ${searchQuery}:\n\n1. **Quality and Reviews**: Look for items with high ratings and positive user feedback\n2. **Price Range**: Consider your budget and compare value for money\n3. **Features**: Identify which features are most important for your needs\n4. **Brand Reliability**: Research brands known for quality in this category\n\nWould you like me to help you compare specific options or provide recommendations for "${searchQuery}"?`;
      }
      
      if (message.includes('compare') || message.includes('vs')) {
        return `I see you're looking to compare options related to "${searchQuery}". To give you the most helpful comparison, could you tell me:\n\n• Which specific items or brands you're considering?\n• What factors are most important to you (price, quality, features, etc.)?\n• What's your intended use case?\n\nThis will help me provide a detailed comparison tailored to your needs for "${searchQuery}".`;
      }
      
      if (message.includes('recommend')) {
        return `For "${searchQuery}", I'd be happy to provide recommendations! To give you the most relevant suggestions, I'd need to know:\n\n• Your budget range\n• Your specific requirements or preferences\n• How you plan to use it\n• Any brands you prefer or want to avoid\n\nBased on current market trends and user feedback, I can then recommend the best options for "${searchQuery}" that match your criteria.`;
      }
    }
    
    // General helpful responses
    if (message.includes('help') || message.includes('how')) {
      let response = "I'm here to help! ";
      if (searchQuery) {
        response += `I noticed you recently searched for "${searchQuery}". `;
      }
      response += "What specific information or assistance are you looking for?";
      return response;
    }
    
    if (message.includes('thank')) {
      return "You're very welcome! I'm glad I could help. Feel free to ask if you need anything else!";
    }
    
    // Default contextual response
    let response = "I understand you're asking about ";
    if (searchQuery) {
      response += `"${searchQuery}". Let me help you with that!\n\n`;
      response += `Since you were searching for "${searchQuery}", I can provide specific information, recommendations, or comparisons. What would be most helpful to you?`;
    } else {
      response += `"${userMessage}". I'd be happy to help! Could you provide a bit more detail about what you're looking for?`;
    }
    
    return response;
  }

  /**
   * Get search context for manual use
   */
  getSearchContext() {
    return BrowserActivityTracker.getSearchContext(60);
  }

  /**
   * Get last search query
   */
  getLastSearch() {
    return BrowserActivityTracker.getLastSearch();
  }

  /**
   * Get memory statistics
   */
  getStats() {
    const memoryStats = ChatMemoryManager.getStats();
    const searchStats = BrowserActivityTracker.getStats();
    const searchContext = this.getSearchContext();
    
    return {
      memory: memoryStats,
      search: searchStats,
      currentContext: searchContext,
      integration: {
        isFullyIntegrated: true,
        trackingEnabled: BrowserActivityTracker.isEnabled(),
        memoryEnabled: !!ChatMemoryManager.getInstance()
      }
    };
  }

  /**
   * Example usage and testing
   */
  async runExample() {
    console.log('🚀 Running ChatGPT Integration Example...\n');
    
    // Simulate user workflow
    console.log('1. User searches for "best gaming laptops" on Google...');
    // (This would happen automatically when user visits search results)
    
    console.log('2. User asks contextual question...');
    const result1 = await this.processUserMessage("which one is the best?");
    console.log('   Response:', result1.aiResponse);
    
    console.log('\n3. User asks follow-up question...');
    const result2 = await this.processUserMessage("what about price range?");
    console.log('   Response:', result2.aiResponse);
    
    console.log('\n4. System stats:');
    console.log(this.getStats());
    
    return {
      example1: result1,
      example2: result2,
      stats: this.getStats()
    };
  }

  // Static methods for easy integration
  static instance = null;

  static initialize(userId) {
    if (!ChatGPTIntegration.instance) {
      ChatGPTIntegration.instance = new ChatGPTIntegration(userId);
    }
    return ChatGPTIntegration.instance;
  }

  static async processMessage(userMessage) {
    if (ChatGPTIntegration.instance) {
      return await ChatGPTIntegration.instance.processUserMessage(userMessage);
    }
    return { error: 'Integration not initialized' };
  }

  static getContext() {
    if (ChatGPTIntegration.instance) {
      return ChatGPTIntegration.instance.getSearchContext();
    }
    return null;
  }
}

// Example usage in your chat component:
/*

// Initialize the integration
const chatGPT = ChatGPTIntegration.initialize('user123');

// When user sends a message
const handleUserMessage = async (userMessage) => {
  const result = await chatGPT.processUserMessage(userMessage);
  
  // Display AI response to user
  displayMessage(result.aiResponse);
  
  // Log context used (for debugging)
  console.log('Context used:', result.contextUsed);
};

// Check current search context
const searchContext = chatGPT.getSearchContext();
if (searchContext) {
  console.log(`User last searched for: ${searchContext.lastQuery}`);
}

*/

export { ChatGPTIntegration }; 