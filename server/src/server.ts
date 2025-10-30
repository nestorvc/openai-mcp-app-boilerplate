// SERVER.TS
/**
 * MCP (Model Context Protocol) Server for OpenAI Apps.
 * 
 * This server:
 * - Handles MCP protocol requests from ChatGPT
 * - Serves React widget HTML to ChatGPT
 * - Manages widget lifecycle (invoking/invoked states)
 * - Provides tools that ChatGPT can call to display widgets
 * 
 * Endpoints:
 * - GET  /mcp - SSE stream for MCP protocol
 * - POST /mcp/messages - Message handling for MCP
 */

// ------------------------------------------------------------------------------------------------
// IMPORTS
// ------------------------------------------------------------------------------------------------
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

// ------------------------------------------------------------------------------------------------
// TYPES
// ------------------------------------------------------------------------------------------------
/**
 * Session management: Each ChatGPT connection gets its own MCP server instance.
 */
type SessionRecord = {
  server: McpServer;           // Isolated MCP server for this session
  transport: SSEServerTransport;  // SSE connection for this session
};

// ------------------------------------------------------------------------------------------------
// CONSTANTS
// ------------------------------------------------------------------------------------------------
// Calculate paths relative to this file location
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");  // Project root directory
const ASSETS_DIR = path.resolve(ROOT_DIR, "web", "dist");  // Where built components are stored

// Store active sessions by session ID
const sessions = new Map<string, SessionRecord>();

// HTTP endpoint paths
const ssePath = "/mcp";           // SSE stream endpoint (GET)
const postPath = "/mcp/messages"; // Message handling endpoint (POST)

// Server port
const portEnv = Number(process.env.PORT ?? 8000);
const port = Number.isFinite(portEnv) ? portEnv : 8000;

// ------------------------------------------------------------------------------------------------
// HELPER FUNCTIONS
// ------------------------------------------------------------------------------------------------
/**
 * Loads widget assets (JS and CSS) and constructs self-contained HTML.
 * Follows the official MCP pattern: read JS/CSS files directly and inline them.
 * 
 * @param componentName - Name of the component (e.g., "todo")
 * @returns Object containing JS, CSS, and constructed HTML
 * @throws Error if required assets cannot be found
 */
function loadWidgetAssets(componentName: string): {
  js: string;
  css: string;
  html: string;
} {
  if (!fs.existsSync(ASSETS_DIR)) {
    throw new Error(
      `Widget assets not found. Expected directory ${ASSETS_DIR}. Run "cd web && pnpm run build" before starting the server.`
    );
  }

  // Load JS file
  const jsPath = path.join(ASSETS_DIR, `${componentName}.js`);
  if (!fs.existsSync(jsPath)) {
    throw new Error(
      `Widget JS for "${componentName}" not found at ${jsPath}. Run "cd web && pnpm run build" to generate the assets.`
    );
  }
  const js = fs.readFileSync(jsPath, "utf8");

  // Load CSS file (optional)
  const cssPath = path.join(ASSETS_DIR, `${componentName}.css`);
  const css = (() => {
    try {
      return fs.readFileSync(cssPath, "utf8");
    } catch {
      return ""; // CSS optional
    }
  })();

  // Construct self-contained HTML (inline JS and CSS)
  const html = `
<div id="${componentName}-root"></div>
${css ? `<style>${css}</style>` : ""}
<script type="module">${js}</script>
  `.trim();

  return { js, css, html };
}

// ------------------------------------------------------------------------------------------------
// FUNCTIONS
// ------------------------------------------------------------------------------------------------
/**
 * Creates a new MCP server instance with all request handlers configured.
 * Uses McpServer with registerTool() and registerResource() methods.
 * This function is called for each ChatGPT session to create an isolated server instance.
 */
function createServerInstance(): McpServer {
  const server = new McpServer({
    name: "mcp-app-server",
    version: "1.0.0",
  });

  /**
   * In addition to returning structured data, each tool on your MCP server should also reference 
   * an HTML UI template in its descriptor. This HTML template will be rendered in an iframe by ChatGPT.
   */

  // ------------------------------------------------------------------------------------------------
  // ASSETS
  // ------------------------------------------------------------------------------------------------
  // Load widget assets (JS, CSS, HTML)
  const todoUri = "ui://widget/todo.html";
  const todoAssets = loadWidgetAssets("todo");

  // ------------------------------------------------------------------------------------------------
  // RESOURCES
  // ------------------------------------------------------------------------------------------------
  // Register resource: widget HTML template
  server.registerResource(
    "todo-widget",
    todoUri,
    {},
    async () => ({
      contents: [
        {
          uri: todoUri,
          mimeType: "text/html+skybridge",
          text: todoAssets.html,
          _meta: {
            "openai/widgetDescription": "A todo list widget",               // Component descriptions will be displayed to the model when a client renders a tool's component. It will help the model understand what is being displayed to help avoid the model from returning redundant content in its response. 
            "openai/widgetPrefersBorder": true,                             // Renders the widget within a rounded border and shadow. Otherwise, the HTML is rendered full-bleed in the conversation
            "openai/widgetDomain": 'https://chatgpt.com',                   // Assigns a subdomain for the HTML. When set, the HTML is rendered within `chatgpt-com.web-sandbox.oaiusercontent.com` It's also used to configure the base url for external links.
            'openai/widgetCSP': {                                           // Required to make external network requests from the HTML code. Also used to validate `openai.openExternal()` requests. 
              connect_domains: ['https://chatgpt.com'],                     // Maps to `connect-src` rule in the iframe CSP
              resource_domains: ['https://*.oaistatic.com'],                // Maps to style-src, style-src-elem, img-src, font-src, media-src etc. in the iframe CSP
            },
          },
        },
      ],
    })
  );

  // ------------------------------------------------------------------------------------------------
  // TOOLS
  // ------------------------------------------------------------------------------------------------
  // Register tool: Show Todo List
  server.registerTool(
    "show-todo",
    {
      title: "Show Todo List",
      description: "Display a todo list widget",
      inputSchema: {
        message: z.string().describe("A message to display with the widget."),
        userId: z.string().optional().describe("Optional user ID for personalization"),
      },
      _meta: {
        "openai/outputTemplate": todoUri,
        "openai/toolInvocation/invoking": "Creating a todo list",
        "openai/toolInvocation/invoked": "Todo list displayed",
      },
    },
    async ({ message, userId }: { message: string; userId?: string }) => {
      // Sample todo data - in a real app, this would come from a database
      const sampleTodos = [
        {
          id: "1",
          title: "Learn about ChatGPT Apps SDK",
          isComplete: false,
          note: "Study the window.openai API integration",
          dueDate: "2024-01-15"
        },
        {
          id: "2", 
          title: "Build an interactive widget",
          isComplete: true,
          note: "Implement two-way communication with ChatGPT",
          dueDate: "2024-01-10"
        },
        {
          id: "3",
          title: "Deploy to production",
          isComplete: false,
          note: "Test with real ChatGPT integration",
          dueDate: null
        }
      ];

      return {
        content: [
          {
            type: "text",
            text: `Rendered a todo list! ${message}`,
          },
        ],
        structuredContent: {
          // This data is injected into your component as window.openai.toolOutput
          lists: [
            {
              id: "main-list",
              title: "My Tasks",
              isCurrentlyOpen: true,
              todos: sampleTodos
            }
          ],
          message,
          userId: userId || "anonymous"
        },
        _meta: {
          messageLen: message.length,
          totalTodos: sampleTodos.length,
          completedTodos: sampleTodos.filter(t => t.isComplete).length
        },
      };
    }
  );

  // NEW: Register tool for refreshing todos from component
  // This demonstrates how components can call server tools
  server.registerTool(
    "refresh-todos",
    {
      title: "Refresh Todo List",
      description: "Refresh the todo list data from the server",
      inputSchema: {
        listId: z.string().optional().describe("ID of the list to refresh"),
        userId: z.string().optional().describe("User ID for personalization"),
      },
      _meta: {
        "openai/toolInvocation/invoking": "Refreshing todo list data",
        "openai/toolInvocation/invoked": "Todo list refreshed",
      },
    },
    async ({ listId, userId }: { listId?: string; userId?: string }) => {
      // In a real app, this would fetch fresh data from a database
      const refreshedTodos = [
        {
          id: "1",
          title: "Learn about ChatGPT Apps SDK",
          isComplete: false,
          note: "Study the window.openai API integration",
          dueDate: "2024-01-15"
        },
        {
          id: "2", 
          title: "Build an interactive widget",
          isComplete: true,
          note: "Implement two-way communication with ChatGPT",
          dueDate: "2024-01-10"
        },
        {
          id: "3",
          title: "Deploy to production",
          isComplete: false,
          note: "Test with real ChatGPT integration",
          dueDate: null
        },
        {
          id: "4",
          title: "Add new feature",
          isComplete: false,
          note: "This todo was added during refresh",
          dueDate: "2024-01-20"
        }
      ];

      return {
        content: [
          {
            type: "text",
            text: `Refreshed todo list data. Found ${refreshedTodos.length} todos.`,
          },
        ],
        structuredContent: {
          lists: [
            {
              id: listId || "main-list",
              title: "My Tasks",
              isCurrentlyOpen: true,
              todos: refreshedTodos
            }
          ],
          refreshedAt: new Date().toISOString(),
          userId: userId || "anonymous"
        },
        _meta: {
          totalTodos: refreshedTodos.length,
          refreshedAt: new Date().toISOString()
        },
      };
    }
  );

  // NEW: Register tool for saving todo state
  // This demonstrates how components can persist data back to the server
  server.registerTool(
    "save-todo-state",
    {
      title: "Save Todo State",
      description: "Save the current state of the todo list",
      inputSchema: {
        todos: z.array(z.object({
          id: z.string(),
          title: z.string(),
          isComplete: z.boolean(),
          note: z.string().optional(),
          dueDate: z.string().optional()
        })).describe("Array of todo items to save"),
        listId: z.string().optional().describe("ID of the list being saved"),
        userId: z.string().optional().describe("User ID for personalization"),
      },
      _meta: {
        "openai/toolInvocation/invoking": "Saving todo list state",
        "openai/toolInvocation/invoked": "Todo list state saved",
      },
    },
    async ({ todos, listId, userId }: { 
      todos: Array<{id: string; title: string; isComplete: boolean; note?: string; dueDate?: string}>;
      listId?: string;
      userId?: string;
    }) => {
      // In a real app, this would save to a database
      console.log(`Saving ${todos.length} todos for user ${userId || 'anonymous'}`);
      
      return {
        content: [
          {
            type: "text",
            text: `Saved ${todos.length} todos successfully.`,
          },
        ],
        structuredContent: {
          success: true,
          savedTodos: todos.length,
          listId: listId || "main-list",
          userId: userId || "anonymous",
          savedAt: new Date().toISOString()
        },
        _meta: {
          savedTodos: todos.length,
          savedAt: new Date().toISOString()
        },
      };
    }
  );

  return server;
}

/**
 * Handles incoming SSE (Server-Sent Events) connection from ChatGPT.
 * Creates a new MCP server instance and SSE transport for this session.
 * 
 * Flow:
 * 1. ChatGPT opens GET /mcp
 * 2. Server creates MCP server instance
 * 3. Server creates SSE transport
 * 4. Connection stays open for bidirectional communication
 */
async function handleSseRequest(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const server = createServerInstance();
  const transport = new SSEServerTransport(postPath, res);
  const sessionId = transport.sessionId;

  sessions.set(sessionId, { server, transport });

  transport.onclose = async () => {
    sessions.delete(sessionId);
    // Don't call server.close() here - it causes a circular call with transport.close()
    // The SDK handles cleanup internally
  };

  transport.onerror = (error) => {
    console.error("SSE transport error", error);
  };

  try {
    await server.connect(transport);
  } catch (error) {
    sessions.delete(sessionId);
    console.error("Failed to start SSE session", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to establish SSE connection");
    }
  }
}

/**
 * Handles POST requests from ChatGPT containing MCP protocol messages.
 * Each message is routed to the correct session based on sessionId.
 * 
 * Flow:
 * 1. ChatGPT sends POST /mcp/messages?sessionId=xxx
 * 2. Server looks up the session
 * 3. Message is forwarded to the session's MCP server via SSE transport
 * 4. Response is sent back through the SSE connection
 */
async function handlePostMessage(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    res.writeHead(400).end("Missing sessionId query parameter");
    return;
  }

  const session = sessions.get(sessionId);

  if (!session) {
    res.writeHead(404).end("Unknown session");
    return;
  }

  try {
    // Forward the message to the MCP server via SSE transport
    await session.transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("Failed to process message", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to process message");
    }
  }
}

// ------------------------------------------------------------------------------------------------
// MAIN
// ------------------------------------------------------------------------------------------------
/**
 * Main HTTP server that routes requests to MCP handlers.
 * 
 * Request flow:
 * 1. OPTIONS requests: CORS preflight handling
 * 2. GET /mcp: Open SSE connection (handleSseRequest)
 * 3. POST /mcp/messages: Forward MCP messages (handlePostMessage)
 * 4. Everything else: 404
 */
const httpServer = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    if (!req.url) {
      res.writeHead(400).end("Missing URL");
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    // CORS preflight handling
    if (
      req.method === "OPTIONS" &&
      (url.pathname === ssePath || url.pathname === postPath)
    ) {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type",
      });
      res.end();
      return;
    }

    // SSE connection endpoint
    if (req.method === "GET" && url.pathname === ssePath) {
      await handleSseRequest(res);
      return;
    }

    // MCP message handling endpoint
    if (req.method === "POST" && url.pathname === postPath) {
      await handlePostMessage(req, res, url);
      return;
    }

    res.writeHead(404).end("Not Found");
  }
);

// Error handling for malformed HTTP requests
httpServer.on("clientError", (err: Error, socket) => {
  console.error("HTTP client error", err);
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

// Start the HTTP server
httpServer.listen(port, () => {
  console.log(`MCP App server listening on http://localhost:${port}`);
  console.log(`  SSE stream: GET http://localhost:${port}${ssePath}`);
  console.log(
    `  Message post endpoint: POST http://localhost:${port}${postPath}?sessionId=...`
  );
});
