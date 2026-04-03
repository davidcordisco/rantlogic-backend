const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'RantLogic backend running' });
});

// Generate endpoint — takes rant, returns shortcut plan + plist
app.post('/generate', async (req, res) => {
  const { rant } = req.body;

  if (!rant) {
    return res.status(400).json({ error: 'No rant provided' });
  }

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: `You are RantLogic, an AI that converts user frustrations into iOS Shortcuts automations.

The user said: "${rant}"

Respond ONLY with a JSON object in this exact format, no other text:
{
  "summary": "One sentence describing what the shortcut does",
  "shortcut_name": "Short name for the shortcut",
  "actions": [
    {
      "identifier": "is.workflow.actions.location",
      "parameters": {}
    }
  ]
}

Use real iOS Shortcuts action identifiers. Common ones:
- is.workflow.actions.location (Get Current Location)
- is.workflow.actions.gettraveltime (Get Travel Time)
- is.workflow.actions.sendmessage (Send Message)
- is.workflow.actions.setfocus (Set Focus Mode)
- is.workflow.actions.openapp (Open App)
- is.workflow.actions.setalarm (Set Alarm)
- is.workflow.actions.showresult (Show Result)
- is.workflow.actions.getbatterylife (Get Battery Level)`
        }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': CLAUDE_API_KEY
        }
      }
    );

    const raw = response.data.content[0].text;
    
    // Parse JSON response
    const clean = raw.replace(/```json|```/g, '').trim();
    const shortcutData = JSON.parse(clean);

    res.json({
      success: true,
      summary: shortcutData.summary,
      shortcut_name: shortcutData.shortcut_name,
      actions: shortcutData.actions
    });

  } catch (error) {
    console.error('Generate error:', error.message);
    res.status(500).json({ error: 'Failed to generate shortcut' });
  }
});

app.listen(PORT, () => {
  console.log(`RantLogic backend running on port ${PORT}`);
});