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
    <key>WFWorkflowIcon</key>
    <dict>
        <key>WFWorkflowIconGlyphNumber</key>
        <integer>59511</integer>
        <key>WFWorkflowIconStartColor</key>
        <integer>431817727</integer>
    </dict>
</dict>
</plist>`;
}

const PROMPT = (rant) => `You are RantLogic, an AI that converts user frustrations into working iOS Shortcuts automations.

The user said: "${rant}"

You MUST respond ONLY with a valid JSON object. No other text, no markdown, no explanation.

CRITICAL RULES:
1. Only use action identifiers from the verified list below
2. Use EXACT parameter names as shown — wrong parameter names cause "Unknown Action" errors
3. For ETA/travel shortcuts: always include a real destination address in WFGetDirectionsActionDestination
4. For message shortcuts: include a real message in WFMessageContent
5. Build 2-4 actions maximum

VERIFIED ACTIONS:

GET CURRENT LOCATION:
{ "identifier": "is.workflow.actions.getcurrentlocation", "parameters": {} }

GET TRAVEL TIME (MUST include destination):
{ "identifier": "is.workflow.actions.gettraveltime", "parameters": { "WFGetDirectionsActionDestination": "123 Main St, New York, NY", "WFGetDirectionsActionMode": "Driving" } }

SEND MESSAGE:
{ "identifier": "is.workflow.actions.sendmessage", "parameters": { "WFSendMessageActionRecipients": "Wife", "WFMessageContent": "On my way! ETA is about 20 minutes." } }

ADD REMINDER:
{ "identifier": "is.workflow.actions.addnewreminder", "parameters": { "WFRemindMeTitleKey": "Charge your phone", "WFRemindMeDate": "10:00 PM" } }

SET ALARM:
{ "identifier": "is.workflow.actions.setalarm", "parameters": { "WFAlarmHour": "7", "WFAlarmMinute": "0", "WFAlarmLabel": "Wake up" } }

SET FOCUS MODE:
{ "identifier": "is.workflow.actions.setfocus", "parameters": { "WFFocusMode": "Do Not Disturb", "WFSetFocusEnabled": "1" } }

SHOW RESULT:
{ "identifier": "is.workflow.actions.showresult", "parameters": { "Text": "Done!" } }

PATTERN EXAMPLES:

For "text my wife my ETA when I leave work":
actions: [
  { identifier: "is.workflow.actions.getcurrentlocation", parameters: {} },
  { identifier: "is.workflow.actions.gettraveltime", parameters: { "WFGetDirectionsActionDestination": "Home", "WFGetDirectionsActionMode": "Driving" } },
  { identifier: "is.workflow.actions.sendmessage", parameters: { "WFSendMessageActionRecipients": "Wife", "WFMessageContent": "Leaving work now, on my way home!" } }
]

For "remind me to charge my phone at night":
actions: [
  { identifier: "is.workflow.actions.addnewreminder", parameters: { "WFRemindMeTitleKey": "Charge your phone", "WFRemindMeDate": "10:00 PM" } },
  { identifier: "is.workflow.actions.showresult", parameters: { "Text": "Reminder set to charge your phone at 10 PM!" } }
]

For "turn off focus mode when I get home":
actions: [
  { identifier: "is.workflow.actions.setfocus", parameters: { "WFFocusMode": "Do Not Disturb", "WFSetFocusEnabled": "0" } },
  { identifier: "is.workflow.actions.showresult", parameters: { "Text": "Focus mode turned off. Welcome home!" } }
]

Respond with ONLY this JSON:
{
  "summary": "One sentence describing what this shortcut does",
  "shortcut_name": "Short 2-3 word name, no numbers or special characters",
  "actions": [
    {
      "identifier": "is.workflow.actions.showresult",
      "parameters": { "Text": "example" }
    }
  ]
}`;

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

    // Clean the shortcut name — no numbers, no special chars
    const cleanName = shortcutData.shortcut_name
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .trim();
    shortcutData.shortcut_name = cleanName;

    const plist = buildPlist(cleanName, shortcutData.actions);

    const form = new FormData();
    form.append('shortcut', Buffer.from(plist), {
      filename: cleanName + '.shortcut',
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
    res.setHeader('Content-Disposition', 'attachment; filename="' + cleanName + '.shortcut"');
    res.setHeader('X-Shortcut-Name', cleanName);
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
