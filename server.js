import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import { processMessage, clearSession, updateSession } from './handlers/webHandler.js';
import Lead from './handlers/Lead.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);

// The MONGODB_URI must be set in the .env file for the application to work.
const MONGO_URI = process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error('❌ FATAL ERROR: MONGODB_URI is not defined in your .env file.');
  process.exit(1);
}

// Connect to MongoDB
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected successfully.'))
  .catch(err => {
    console.error('❌ MongoDB connection error. Please check if your database is running and the MONGODB_URI is correct.', err.message);
    process.exit(1);
  });

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Root route - redirect to test page
app.get('/', (req, res) => {
  res.redirect('/test.html');
});

// Serve the test page
app.get('/test.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'test.html'));
});

// Serve the dedicated widget page for iframe embedding
app.get('/widget.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'widget.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  const site = socket.handshake.query.site || 'testpan';
  socket.data.currentSite = site;
  console.log(`Client connected: ${socket.id} (${site})`);

  // Send initial welcome message by triggering the 'menu' command
  processMessage(socket.id, 'menu', site).then(response => socket.emit('bot_message', response));

  // Handle incoming messages from client
  socket.on('user_message', async (data) => {
    console.log(`Message from ${socket.id}:`, data);
    const handlerStart = Date.now();
    
    try {
      const message = typeof data === 'string' ? data : data?.message ?? data?.intent;
      if (typeof message !== 'string' || !message.trim()) {
        throw new Error('Received an invalid message payload');
      }

      // Confirm activity as soon as the event reaches the server
      socket.emit('bot_typing');
      
      // Process the message through the menu handler
      const response = await processMessage(socket.id, message, socket.data.currentSite);
      console.log(`[AI TIMING] "${message}" — processMessage() resolved in ${Date.now() - handlerStart}ms`);

      // Check if the response is valid and contains a stream to handle it differently
      if (response && response.source === 'ai' && response.stream) {
        const requestStart = response.timing?.requestStart ?? handlerStart;
        let firstChunkAt = null;
        let chunkCount = 0;

        // 1. Create an empty message bubble on the client
        socket.emit('bot_message', { text: '', buttons: [] });

        // 2. Stream chunks to the client to fill the bubble
        for await (const chunk of response.stream) {
          if (!firstChunkAt) {
            firstChunkAt = Date.now();
            console.log(`[AI TIMING] "${message}" — time to first chunk: ${firstChunkAt - requestStart}ms (from processAIQuery start)`);
          }
          chunkCount++;
          const chunkText = chunk.text();
          socket.emit('bot_chunk', { chunk: chunkText });
        }

        console.log(`[AI TIMING] "${message}" — stream complete: ${chunkCount} chunks, ${Date.now() - requestStart}ms end-to-end (query start -> last chunk)`);

        // 3. After the stream is complete, send the lead generation prompt
        const finalPrompt = {
          text: `\n\nBy the way, I'd love to share the complete details with you or have our team follow up. What's your name?`,
          buttons: [{ label: "⬅️ Back", value: "0" }, { label: "🏠 Main Menu", value: "menu" }]
        };
        socket.emit('bot_message', finalPrompt);
        
        // 4. Update the session state
        updateSession(socket.id, { state: 'LEAD_PROMPT', purpose: `AI Query: "${message}"` });

      } else {
        // Send a normal, non-streamed response
        socket.emit('bot_message', response);
      }
    } catch (error) {
      console.error('Error processing message:', error);
      socket.emit('bot_message', {
        text: 'Sorry, I encountered an error processing your message. Please try again.',
        buttons: [
          { label: "⬅️ Back", value: "0" },
          { label: "🏠 Main Menu", value: "menu" }
        ]
      });
    }
  });

  // Listen for lead data from the client
  socket.on('save_user_lead', async (leadData) => {
    // Validate that the required fields from the Mongoose schema are present.
    if (!leadData || !leadData.name || !leadData.phone) {
      console.error('❌ Invalid or incomplete lead data received. Aborting save.', leadData);
      return;
    }
    try {
      const lead = new Lead({
        name: leadData.name,
        phone: leadData.phone,
        purposeOfVisit: leadData.purposeOfVisit,
        websiteVisited: leadData.websiteVisited
      });
      await lead.save();
      console.log(`✅ Lead saved successfully for: ${lead.name}`);
    } catch (error) {
      // This will catch validation errors from the Mongoose schema.
      console.error('❌ Error saving lead to MongoDB:', error.message);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    clearSession(socket.id);
  });
});

const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
  console.log(`Testpan India Chatbot Server running on http://localhost:${PORT}`);
  console.log(`Test page available at http://localhost:${PORT}/test.html`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});