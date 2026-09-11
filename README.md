# Testpan India Web Chatbot Widget

A full-stack, real-time website chatbot widget for Testpan India Private Limited, BookMyTestCenter, and ManpowerX. It uses Socket.IO for interactive web chat and natural-language responses.

## Features

- **Interactive Chat Widget**: Floating chat button with expandable drawer
- **Real-time Communication**: Socket.io for instant messaging
- **Natural Language Understanding**: Responds to questions like "What does Testpan do?"
- **Quick Reply Buttons**: Clickable options for easy navigation
- **Session Management**: Per-user session state tracking
- **Responsive Design**: Mobile-friendly with Testpan India branding (#1A73E8)
- **Easy Integration**: Simply add the widget script to any website

## Project Structure

```
testpan-web-chatbot/
├── server.js                 # Express server with Socket.io
├── package.json              # Dependencies and scripts
├── handlers/
│   ├── webHandler.js        # Socket.IO message processor
│   └── aiHandler.js         # Context-aware AI responses
├── config/
│   └── siteConfig.js        # Testpan / BMTC / ManpowerX profiles
└── public/
    ├── chatWidget.js       # Standalone widget client script
    ├── style.css           # Widget styling with Testpan branding
    └── test.html           # Test page for local development
```

## Installation

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

The server will run on `http://localhost:8080` by default.

## Usage

### Local Testing

1. Start the server: `npm start`
2. Open `http://localhost:8080/test.html` in your browser
3. Click the floating chat button to interact with the bot

### Website Integration

To integrate the widget into your website:

1. Add the Socket.io client library:
```html
<script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
```

2. Add the widget script:
```html
<script src="https://your-server.com/chatWidget.js"></script>
```

3. Add the widget styles:
```html
<link rel="stylesheet" href="https://your-server.com/style.css">
```

The widget will automatically inject a floating chat button into your page.

## API Endpoints

- `GET /` - Serve static files from public directory
- `GET /test.html` - Test page for local development
- `GET /health` - Health check endpoint

## Socket.io Events

### Client → Server

- `user_message`: Send user message to bot
  ```javascript
  socket.emit('user_message', { message: "Hello" });
  ```

### Server → Client

- `bot_message`: Receive bot response
  ```javascript
  socket.on('bot_message', (data) => {
    console.log(data.text);      // Message text
    console.log(data.buttons);    // Array of button options
  });
  ```

## Widget Configuration

The widget can be configured by modifying the `CONFIG` object in `public/chatWidget.js`:

```javascript
const CONFIG = {
  serverUrl: window.location.origin,  // Socket.io server URL
  primaryColor: '#1A73E8',           // Testpan India blue
  widgetTitle: 'Testpan India Support',
  widgetPosition: 'bottom-right',
  autoOpen: false,
  welcomeMessage: 'Hello! How can I help you today?'
};
```

## Natural Language Understanding

The bot understands various natural language queries:

- **Services**: "What services do you offer?", "I need test center booking"
- **Partner**: "How can I partner with you?", "I want to become a vendor"
- **About**: "What does Testpan do?", "Tell me about Testpan India"
- **FAQ**: "Where are you located?", "How do I book a test center?"
- **Support**: "Contact support", "I need help"

## Session Management

Each socket connection maintains its own session state including:
- Current menu position
- Navigation history
- Lead capture progress (for partner registration)
- User interaction state

## Development

### Start Development Server
```bash
npm start
```

### Health Check
```bash
curl http://localhost:8080/health
```

## Browser Compatibility

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support
- Mobile browsers: ✅ Responsive design included

## Customization

### Styling
Modify `public/style.css` to customize the widget appearance. The primary color is currently set to Testpan India's blue (#1A73E8).

### Bot Logic
Modify `handlers/webHandler.js` to change conversation flow and business logic.

## Troubleshooting

### Widget not appearing
- Check browser console for JavaScript errors
- Verify Socket.io client is loaded
- Ensure server is running and accessible

### Connection issues
- Check server logs for connection errors
- Verify CORS settings in server.js
- Ensure firewall allows WebSocket connections

### Messages not sending
- Check Socket.io connection status
- Verify server is processing messages
- Check browser console for errors

## License

UNLICENSED - Testpan India Private Limited

## Support

For issues or questions, contact the Testpan India development team.
