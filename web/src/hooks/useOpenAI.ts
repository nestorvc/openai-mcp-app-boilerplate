/**
 * React hooks for interacting with the ChatGPT App SDK window.openai API
 * 
 * These hooks provide a clean interface to the window.openai global object
 * that ChatGPT injects into your component iframe. They handle:
* - useToolOutput() - Read data from MCP server tool response
* - useToolInput() - Read parameters passed to your MCP tool
* - useWidgetState(initialState) - Persist state visible to ChatGPT
* - useCallTool() - Call MCP server tools from component
* - useSendFollowUpMessage() - Send messages to ChatGPT conversation
* - useRequestDisplayMode() - Request layout changes (inline/pip/fullscreen)
* - useOpenAIGlobals() - Access theme, device, and layout information
 */

import { useCallback, useEffect, useState } from 'react';

// Type definitions for the window.openai API
declare global {
  interface Window {
    openai?: {
      // Data from the MCP server
      toolInput: any;
      toolOutput: any;
      toolResponseMetadata: any;
      widgetState: any;
      
      // Layout and theme information
      theme: 'light' | 'dark';
      userAgent: {
        device: { type: 'mobile' | 'tablet' | 'desktop' | 'unknown' };
        capabilities: { hover: boolean; touch: boolean };
      };
      locale: string;
      maxHeight: number;
      displayMode: 'pip' | 'inline' | 'fullscreen';
      safeArea: {
        insets: { top: number; bottom: number; left: number; right: number };
      };
      
      // API methods
      callTool: (name: string, args: Record<string, unknown>) => Promise<any>;
      sendFollowUpMessage: (args: { prompt: string }) => Promise<void>;
      openExternal: (payload: { href: string }) => void;
      requestDisplayMode: (args: { mode: 'pip' | 'inline' | 'fullscreen' }) => Promise<{ mode: string }>;
      setWidgetState: (state: any) => Promise<void>;
    };
  }
}

/**
 * Hook to read data from the MCP server tool output
 * This is the main way to get data that your MCP server sends to the component
 * 
 * @returns The structured data from your MCP server's tool response
 * 
 * Example usage:
 * ```tsx
 * function MyComponent() {
 *   const toolOutput = useToolOutput();
 *   const todos = toolOutput?.todos || [];
 *   return <div>{todos.map(todo => <div key={todo.id}>{todo.title}</div>)}</div>;
 * }
 * ```
 */
export function useToolOutput() {
  const [toolOutput, setToolOutput] = useState(window.openai?.toolOutput || null);
  
  useEffect(() => {
    // Listen for updates to the tool output
    const handleGlobalUpdate = () => {
      setToolOutput(window.openai?.toolOutput || null);
    };
    
    // Listen for the custom event that ChatGPT fires when globals change
    window.addEventListener('openai:set_globals', handleGlobalUpdate);
    
    return () => {
      window.removeEventListener('openai:set_globals', handleGlobalUpdate);
    };
  }, []);
  
  return toolOutput;
}

/**
 * Hook to read the tool input (parameters passed to your MCP tool)
 * This contains the arguments that ChatGPT passed when calling your tool
 * 
 * @returns The input parameters from the tool call
 * 
 * Example usage:
 * ```tsx
 * function MyComponent() {
 *   const toolInput = useToolInput();
 *   const message = toolInput?.message || 'No message provided';
 *   return <div>Message: {message}</div>;
 * }
 * ```
 */
export function useToolInput() {
  const [toolInput, setToolInput] = useState(window.openai?.toolInput || null);
  
  useEffect(() => {
    const handleGlobalUpdate = () => {
      setToolInput(window.openai?.toolInput || null);
    };
    
    window.addEventListener('openai:set_globals', handleGlobalUpdate);
    
    return () => {
      window.removeEventListener('openai:set_globals', handleGlobalUpdate);
    };
  }, []);
  
  return toolInput;
}

/**
 * Hook to manage widget state that persists across user sessions
 * This state is scoped to this specific widget instance and is visible to ChatGPT
 * 
 * @param initialState - Default state if no persisted state exists
 * @returns [currentState, setState] - Similar to useState but persisted
 * 
 * Example usage:
 * ```tsx
 * function MyComponent() {
 *   const [favorites, setFavorites] = useWidgetState({ items: [] });
 *   
 *   const addFavorite = (item) => {
 *     setFavorites(prev => ({ 
 *       items: [...prev.items, item] 
 *     }));
 *   };
 *   
 *   return <div>Favorites: {favorites.items.length}</div>;
 * }
 * ```
 */
export function useWidgetState<T>(initialState: T) {
  const [state, setState] = useState<T>(() => {
    // Initialize with persisted state if available, otherwise use initial state
    return window.openai?.widgetState || initialState;
  });
  
  useEffect(() => {
    const handleGlobalUpdate = () => {
      if (window.openai?.widgetState !== undefined) {
        setState(window.openai.widgetState);
      }
    };
    
    window.addEventListener('openai:set_globals', handleGlobalUpdate);
    
    return () => {
      window.removeEventListener('openai:set_globals', handleGlobalUpdate);
    };
  }, []);
  
  // Custom setter that persists state to ChatGPT
  const setPersistedState = useCallback((newState: T | ((prev: T) => T)) => {
    setState(prevState => {
      const resolvedState = typeof newState === 'function' 
        ? (newState as (prev: T) => T)(prevState) 
        : newState;
      
      // Persist to ChatGPT - this makes the state visible to the model
      window.openai?.setWidgetState(resolvedState);
      
      return resolvedState;
    });
  }, []); // Remove state dependency to prevent infinite loop
  
  return [state, setPersistedState] as const;
}

/**
 * Hook to call MCP server tools from the component
 * This allows your component to trigger server actions like refreshing data
 * 
 * @returns Object with callTool function and loading state
 * 
 * Example usage:
 * ```tsx
 * function MyComponent() {
 *   const { callTool, isLoading } = useCallTool();
 *   
 *   const refreshData = async () => {
 *     try {
 *       const result = await callTool('refresh-todos', { userId: '123' });
 *       console.log('Refreshed:', result);
 *     } catch (error) {
 *       console.error('Failed to refresh:', error);
 *     }
 *   };
 *   
 *   return <button onClick={refreshData} disabled={isLoading}>
 *     {isLoading ? 'Refreshing...' : 'Refresh Data'}
 *   </button>;
 * }
 * ```
 */
export function useCallTool() {
  const [isLoading, setIsLoading] = useState(false);
  
  const callTool = useCallback(async (name: string, args: Record<string, unknown> = {}) => {
    if (!window.openai?.callTool) {
      throw new Error('window.openai.callTool is not available');
    }
    
    setIsLoading(true);
    try {
      const result = await window.openai.callTool(name, args);
      return result;
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  return { callTool, isLoading };
}

/**
 * Hook to send follow-up messages to ChatGPT
 * This allows your component to insert messages into the conversation
 * 
 * @returns Function to send follow-up messages
 * 
 * Example usage:
 * ```tsx
 * function MyComponent() {
 *   const sendMessage = useSendFollowUpMessage();
 *   
 *   const notifyCompletion = async () => {
 *     await sendMessage('I have completed all the tasks in my todo list!');
 *   };
 *   
 *   return <button onClick={notifyCompletion}>Mark Complete</button>;
 * }
 * ```
 */
export function useSendFollowUpMessage() {
  return useCallback(async (prompt: string) => {
    if (!window.openai?.sendFollowUpMessage) {
      throw new Error('window.openai.sendFollowUpMessage is not available');
    }
    
    await window.openai.sendFollowUpMessage({ prompt });
  }, []);
}

/**
 * Hook to request display mode changes
 * This allows your component to request different layouts (inline, pip, fullscreen)
 * 
 * @returns Function to request display mode changes
 * 
 * Example usage:
 * ```tsx
 * function MyComponent() {
 *   const requestDisplayMode = useRequestDisplayMode();
 *   
 *   const goFullscreen = async () => {
 *     const result = await requestDisplayMode('fullscreen');
 *     console.log('Display mode changed to:', result.mode);
 *   };
 *   
 *   return <button onClick={goFullscreen}>Go Fullscreen</button>;
 * }
 * ```
 */
export function useRequestDisplayMode() {
  return useCallback(async (mode: 'pip' | 'inline' | 'fullscreen') => {
    if (!window.openai?.requestDisplayMode) {
      throw new Error('window.openai.requestDisplayMode is not available');
    }
    
    return await window.openai.requestDisplayMode({ mode });
  }, []);
}

/**
 * Hook to get theme and layout information
 * This provides access to ChatGPT's theme, device info, and layout constraints
 * 
 * @returns Object with theme, device, and layout information
 * 
 * Example usage:
 * ```tsx
 * function MyComponent() {
 *   const { theme, device, maxHeight } = useOpenAIGlobals();
 *   
 *   return (
 *     <div className={theme === 'dark' ? 'dark-theme' : 'light-theme'}>
 *       <p>Device: {device.type}</p>
 *       <p>Max height: {maxHeight}px</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useOpenAIGlobals() {
  const [globals, setGlobals] = useState(() => ({
    theme: window.openai?.theme || 'light',
    userAgent: window.openai?.userAgent || { device: { type: 'unknown' }, capabilities: { hover: false, touch: false } },
    locale: window.openai?.locale || 'en',
    maxHeight: window.openai?.maxHeight || 400,
    displayMode: window.openai?.displayMode || 'inline',
    safeArea: window.openai?.safeArea || { insets: { top: 0, bottom: 0, left: 0, right: 0 } }
  }));
  
  useEffect(() => {
    const handleGlobalUpdate = () => {
      if (window.openai) {
        setGlobals({
          theme: window.openai.theme || 'light',
          userAgent: window.openai.userAgent || { device: { type: 'unknown' }, capabilities: { hover: false, touch: false } },
          locale: window.openai.locale || 'en',
          maxHeight: window.openai.maxHeight || 400,
          displayMode: window.openai.displayMode || 'inline',
          safeArea: window.openai.safeArea || { insets: { top: 0, bottom: 0, left: 0, right: 0 } }
        });
      }
    };
    
    window.addEventListener('openai:set_globals', handleGlobalUpdate);
    
    return () => {
      window.removeEventListener('openai:set_globals', handleGlobalUpdate);
    };
  }, []);
  
  return globals;
}
