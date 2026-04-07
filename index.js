const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const SIGNER_SECRET = process.env.SIGNER_SECRET;
const SIGNER_URL = process.env.SIGNER_URL || 'https://signer.applynex.ai';

app.get('/', (req, res) => {
  res.json({ status: 'RantLogic backend running' });
});

function buildPlist(shortcutName, actions) {
  const actionXml = actions.map(action => {
    const params = Object.entries(action.parameters || {})
      .map(([k, v]) => `<key>${k}</key><string>${v}</string>`)
      .join('');
    return `
        <dict>
            <key>WFWorkflowActionIdentifier</key>
            <string>${action.identifier}</string>
            <key>WFWorkflowActionParameters</key>
            <dict>${params}</dict>
        </dict>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>WFWorkflowActions</key>
    <array>${actionXml}
    </array>
    <key>WFWorkflowClientVersion</key>
    <string>1300.0.0</string>
    <key>WFWorkflowMinimumClientVersion</key>
    <integer>900</integer>
    <key>WFWorkflowName</key>
    <string>${shortcutName}</string>
</dict>
</plist>`;
}

const PROMPT = (rant) => `You are RantLogic, an AI that converts user frustrations into iOS Shortcuts automations.
The user said: "${rant}"
Respond ONLY with a JSON object in this exact format, no other text:
{
  "summary": "One sentence describing what the shortcut does",
  "shortcut_name": "Short name for the shortcut",
  "actions": [
    {
      "identifier": "is.workflow.actions.showresult",
      "parameters": {}
    }
  ]
}
Use real iOS Shortcuts action identifiers.`;

async function callClaude(rant) {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: PROMPT(rant) }]
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
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

app.post('/generate', async (req, res) => {
  const { rant } = req.body;
  if (!rant) return res.status(400).json({ error: 'No rant provided' });
  try {
    const shortcutData = await callClaude(rant);
    res.json({ success: true, ...shortcutData });
  } catch (error) {
    console.error('Generate error:', error.message);
    res.status(500).json({ error: 'Failed to generate shortcut' });
  }
});

app.post('/sign', async (req, res) => {
  const { rant } = req.body;
  if (!rant) return res.status(400).json({ error: 'No rant provided' });
  try {
    const shortcutData = await callClaude(rant);
    const plist = buildPlist(shortcutData.shortcut_name, shortcutData.actions);
    const form = new FormData();
    form.append('shortcut', Buffer.from(plist), {
      filename: shortcutData.shortcut_name + '.shortcut',
      contentType: 'application/octet-stream'
    });
    const signerResponse = await axios.post(
      SIGNER_URL + '/sign',
      form,
      {
        headers: { ...form.getHeaders(), 'x-signer-secret': SIGNER_SECRET },
        responseType: 'arraybuffer',
        timeout: 15000
      }
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="' + shortcutData.shortcut_name + '.shortcut"');
    res.setHeader('X-Shortcut-Name', shortcutData.shortcut_name);
    res.setHeader('X-Shortcut-Summary', shortcutData.summary);
    res.send(Buffer.from(signerResponse.data));
  } catch (error) {
    console.error('Sign error:', error.message);
    res.status(500).json({ error: 'Failed to generate or sign shortcut' });
  }
});

app.listen(PORT, () => {
  console.log(`RantLogic backend running on port ${PORT}`);
});
