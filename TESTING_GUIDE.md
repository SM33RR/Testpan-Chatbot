# Testing Guide - Testpan India Chatbot Improvements

## Quick Start

### 1. Start the Server
```bash
cd /Users/sm33r/testpan-bot
node server.js
```

**Expected Output:**
```
Knowledge base loaded: X pages indexed
Testpan India Chatbot Server running on http://localhost:8080
Test page available at http://localhost:8080/test.html
Health check: http://localhost:8080/health
```

### 2. Open the Chat Interface
Navigate to: **http://localhost:8080/test.html**

---

## Test Cases

### Test 1: RAG - ManpowerX Content Retrieval
**Objective:** Verify ManpowerX knowledge base content is properly indexed and retrieved

**Test Steps:**
1. Open chat at http://localhost:8080/test.html
2. Click the chat launcher button (bottom-right)
3. Send: `"What is ManpowerX?"`
4. Send: `"kya manpower services ke bare mein batao"`

**Expected Results:**
- ✅ Response contains actual ManpowerX details (not generic fallback)
- ✅ Mentions specific services: invigilation, administrative, technical manpower
- ✅ Includes contact information if available
- ✅ Hinglish query gets Hinglish response

**What to Look For:**
```
❌ BAD: "I'd be happy to help. Aap hamari support team se contact kar sakte hain"
✅ GOOD: Actual ManpowerX details about manpower services, types, deployment...
```

---

### Test 2: Typewriter Animation
**Objective:** Verify text appears with typewriter effect

**Test Steps:**
1. Send any question: `"Tell me about your services"`
2. Watch the bot response carefully

**Expected Results:**
- ✅ Typing indicator appears immediately (three bouncing dots)
- ✅ Text types out character-by-character
- ✅ Typing indicator disappears when typing completes
- ✅ Buttons appear after text is fully typed

**Animation Speed:**
- Characters appear every ~15 milliseconds (adjustable in code)
- Total typing time for 500 characters ≈ 7.5 seconds

---

### Test 3: Auto-Scroll to New Message Top
**Objective:** Verify viewport scrolls to message start, not end

**Test Steps:**
1. Send a long query: `"What are all your services?"`
2. Watch where viewport scrolls to
3. Observe bot response

**Expected Results:**
- ✅ Chat scrolls to TOP of new bot message (not bottom)
- ✅ Message beginning is visible when typing starts
- ✅ Smooth scroll animation (not instant jump)
- ✅ Can read the response from the beginning

**What to Look For:**
```
❌ BAD: Viewport jumps to bottom of 20-line response
✅ GOOD: Viewport shows first line of response, can see it type
```

---

### Test 4: Markdown Formatting
**Objective:** Verify markdown is rendered properly with correct styling

**Test Steps:**
1. Send: `"List your services"`
2. Send: `"What are the contact details?"`
3. Look for formatted output

**Expected Results:**
- ✅ **Bold text** appears in bold (darker blue color)
- ✅ Bullet points have proper indentation and spacing
- ✅ Line breaks create proper paragraph separation
- ✅ Contact info (phone/email) appears styled and clickable
- ✅ Line-height is generous (1.6) for readability

**Check List Items:**
- Proper margin between list items
- 24px left padding for indentation
- Bullet points visible and aligned
- Links are orange (#FF6B00) and clickable

**Check Text Formatting:**
- Headings are bold and in dark blue
- Regular text has 1.6 line-height
- Paragraphs have 12px margin-bottom
- Contact links are styled with background highlight

---

### Test 5: Testpan Brand Styling
**Objective:** Verify UI matches Testpan brand colors and professional design

**Test Steps:**
1. Open chat widget
2. Inspect all UI elements
3. Test button interactions

**Expected Results - Colors:**
- ✅ Header: Deep blue gradient (#0F2C59 → #1E40AF)
- ✅ Send button: Orange gradient (#FF6B00 → #E85D04)
- ✅ Quick reply buttons: Orange border with hover fill
- ✅ Bot message: White with subtle shadow
- ✅ User message: Orange gradient with white text
- ✅ Background: Soft gray (#F8FAFC)

**Expected Results - Interactions:**
- ✅ Buttons lift up on hover (translateY(-2px))
- ✅ Buttons depress on click (scale 0.95)
- ✅ Smooth transitions (0.2s ease)
- ✅ Shadows increase on hover
- ✅ Close button rotates smoothly

**Visual Checklist:**
- [ ] Header has professional gradient
- [ ] Status dot is green and glowing
- [ ] "Online" text is visible
- [ ] Send button matches orange theme
- [ ] Buttons have proper hover effects
- [ ] No harsh colors or poor contrast
- [ ] Typography is clear and modern

---

### Test 6: Hinglish Language Support
**Objective:** Verify bot responds in Hinglish when user queries in Hinglish

**Test Queries (Hinglish):**
1. `"Kya aap manpower services provide karte ho?"`
2. `"Kitne centres mein available ho?"`
3. `"Manpower kaise hire kar sakte hain?"`
4. `"Booking process kya hai?"`

**Expected Results:**
- ✅ Bot detects Hinglish
- ✅ Response is in Hinglish (Roman/Latin script)
- ✅ Natural conversational tone
- ✅ Uses phrases like "Haanji", "bilkul", "sakte hain", etc.

**Example Good Response:**
```
"Haanji, Testpan India manpower services provide karte hain. 
Hum invigilation, administrative, aur technical manpower supply karte hain. 
Aap hamari support team se +91 98101 47334 par contact kar sakte hain."
```

---

### Test 7: Knowledge Base Indexing
**Objective:** Verify knowledge base loads and contains expected pages

**Test Steps:**
1. Start server
2. Check console output
3. Send various queries to test different domains

**Expected Output:**
```
Knowledge base loaded: 6 pages indexed
```

**Sources to Verify:**
- [ ] testpanindia.com pages indexed
- [ ] bookmytestcenter.com pages indexed
- [ ] manpowerx.co.in pages indexed (NEW)

**Query Tests:**
- Send "Test Center Booking" → should find bookmytestcenter.com content
- Send "ManpowerX" → should find manpowerx.co.in content
- Send "Testpan services" → should find testpanindia.com content

---

## Advanced Testing

### Test Context Search Quality
**Steps:**
1. Open browser console (F12 → Console tab)
2. Send: `"What specific manpower roles does ManpowerX provide?"`
3. Check that response specifically mentions:
   - Invigilation manpower
   - Administrative manpower
   - Technical manpower (lab/IT support)
   - eProctors for virtual exams

**Verification:**
- Response should be specific to ManpowerX documentation
- Should NOT be generic manpower definition
- Should reference actual services offered

### Test Markdown Edge Cases
**Steps:**
1. Send: `"Tell me about **bold**, *italic*, and [links](https://example.com)"`
2. Send: Query with multiple line breaks
3. Send: Query with complex nested lists

**Expected:** All markdown renders correctly without HTML injection

### Test Performance
**Steps:**
1. Monitor network tab (F12 → Network)
2. Send multiple queries in quick succession
3. Monitor response times

**Expected:**
- First response: ~2-5 seconds (API call)
- Subsequent responses: Similar times
- No memory leaks or crashes
- Smooth animations throughout

---

## Troubleshooting

### Issue: "Knowledge base not loading"
**Solution:**
```bash
# Check if knowledgeBase.json exists
ls -la knowledgeBase.json

# Verify it's valid JSON
cat knowledgeBase.json | python3 -m json.tool
```

### Issue: "No typing indicator"
**Solution:**
- Ensure chatWidget.js is loaded (check F12 → Network)
- Verify `showTypingIndicator()` is called
- Check CSS animations are not disabled

### Issue: "Typewriter animation too slow/fast"
**Solution:**
- Edit `public/chatWidget.js` line ~220
- Adjust `const speed = 15;` (milliseconds per character)
- Lower = faster, Higher = slower

### Issue: "Markdown not rendering"
**Solution:**
- Verify marked.js CDN loads (F12 → Network)
- Check browser console for errors
- Fallback to line-break rendering if markdown fails

### Issue: "Links not clickable"
**Solution:**
- Verify bot response contains `[text](url)` format
- Check marked.js is rendering to HTML anchors
- Inspect element to see generated HTML

---

## Success Criteria

All 5 requirements should meet these criteria:

| Requirement | Status | Evidence |
|------------|--------|----------|
| ManpowerX data retrieval | ✅ | Specific content returned, not fallback |
| Typewriter animation | ✅ | Text types out char-by-char with indicator |
| Auto-scroll behavior | ✅ | Viewport scrolls to message TOP |
| Markdown & typography | ✅ | Proper formatting, links, lists, spacing |
| Testpan brand styling | ✅ | Orange buttons, deep blue headers |

---

## Command Reference

**Start Server:**
```bash
cd /Users/sm33r/testpan-bot && node server.js
```

**Health Check:**
```bash
curl http://localhost:8080/health
```

**View Knowledge Base:**
```bash
cat knowledgeBase.json | python3 -m json.tool | less
```

**Check Logs:**
```bash
# Server logs appear in terminal
# Client logs: F12 → Console tab in browser
```

**Stop Server:**
```bash
# Ctrl+C in terminal
# Or: pkill -f "node server.js"
```

---

**Last Updated:** September 1, 2026
**Test Date:** [Record here]
**Tester:** [Your name]
**Result:** [✅ All Pass / ❌ Issues Found]
