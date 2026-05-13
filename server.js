/**
 * Whisper.cc Backend Server
 * Handles: Stripe payments, license key generation, Nodemailer/Gmail email delivery, key validation
 *
 * Setup:
 *   npm install express stripe nodemailer cors dotenv
 *   node server.js
 */

require('dotenv').config();
const express      = require('express');
const Stripe       = require('stripe');
const nodemailer   = require('nodemailer');
const cors         = require('cors');
const crypto       = require('crypto');

const app    = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ── Gmail / Nodemailer transporter ──
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,      // e.g. you@gmail.com
    pass: process.env.GMAIL_APP_PASS,  // 16-char App Password (no spaces)
  },
});

app.use(cors({
  origin: 'https://whispercc.vercel.app',
  methods: ['GET', 'POST'],
}));

// Raw body needed for Stripe webhook signature verification
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ── In-memory license store (replace with a real DB for production) ──
// Structure: { [licenseKey]: { email, createdAt } }
const licenseStore = {};

// ── Generate a Whisper-style license key ──
function generateLicenseKey() {
  const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `WSP-${seg()}-${seg()}-${seg()}-${seg()}`;
}

// ── Send license email via Gmail ──
async function sendLicenseEmail(email, licenseKey) {
  await transporter.sendMail({
    from:    `"Whisper.cc" <${process.env.GMAIL_USER}>`,
    to:      email,
    subject: 'Whisper.cc — Your License Key',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    body { margin:0; padding:0; background:#080608; font-family:'Helvetica Neue',Arial,sans-serif; color:#f0eaea; }
    .wrap { max-width:560px; margin:40px auto; background:#110c0d; border:1px solid rgba(224,22,26,0.25); border-radius:8px; overflow:hidden; }
    .header { background:#e0161a; padding:36px 40px; text-align:center; }
    .header h1 { margin:0; font-size:32px; letter-spacing:4px; color:#fff; font-weight:900; }
    .header p  { margin:6px 0 0; font-size:12px; letter-spacing:2px; color:rgba(255,255,255,0.7); text-transform:uppercase; }
    .body { padding:40px; }
    .body p { font-size:15px; line-height:1.7; color:#a09090; margin:0 0 20px; }
    .body .hi { color:#f0eaea; font-size:17px; font-weight:600; }
    .key-box { background:#080608; border:1px solid rgba(224,22,26,0.35); border-radius:6px; padding:24px 28px; margin:28px 0; }
    .key-box .label { font-size:10px; letter-spacing:3px; text-transform:uppercase; color:#6b5a5b; margin-bottom:10px; }
    .key-box .email-val { font-size:14px; color:#a09090; margin-bottom:16px; font-family:monospace; }
    .key-box .key-val { font-size:22px; color:#e0161a; font-family:'Courier New',monospace; font-weight:700; letter-spacing:2px; word-break:break-all; }
    .note { font-size:12px; color:#6b5a5b; line-height:1.7; margin-top:28px; padding-top:20px; border-top:1px solid rgba(224,22,26,0.1); }
    .footer { padding:24px 40px; border-top:1px solid rgba(224,22,26,0.1); text-align:center; font-size:12px; color:#6b5a5b; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>WHISPER.CC</h1>
      <p>// Thank you for your purchase</p>
    </div>
    <div class="body">
      <p class="hi">Your license is ready.</p>
      <p>Welcome to Whisper.cc. Below are your credentials — keep them safe. Your license key is unique to you and cannot be transferred.</p>
      <div class="key-box">
        <div class="label">Your Email</div>
        <div class="email-val">[ ${email} ]</div>
        <div class="label" style="margin-top:16px;">License Key</div>
        <div class="key-val">[ ${licenseKey} ]</div>
      </div>
      <p>To download the launcher, join our Discord server and click the <strong style="color:#f0eaea;">Get Launcher</strong> button in the verify channel. Enter your email and license key to receive your private download link.</p>
      <div class="note">
        ⚠ This key is single-use per machine. Do not share it. If you need to reset your HWID, contact support. This purchase is non-refundable per our terms of service.
      </div>
    </div>
    <div class="footer">whisper.cc &nbsp;·&nbsp; support@whisper.cc &nbsp;·&nbsp; © 2025</div>
  </div>
</body>
</html>`,
  });
}

// ───────────────────────────────────────────
// ROUTES
// ───────────────────────────────────────────

// 1. Create PaymentIntent
app.post('/create-payment-intent', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const intent = await stripe.paymentIntents.create({
      amount:        199,
      currency:      'usd',
      metadata:      { email },
      receipt_email: email,
      description:   'Whisper.cc Launcher License',
    });
    res.json({ clientSecret: intent.client_secret });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Stripe Webhook (fires after successful payment)
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    const email  = intent.metadata.email;

    const key = generateLicenseKey();
    licenseStore[key] = { email, createdAt: new Date().toISOString() };

    console.log(`✓ License generated for ${email}: ${key}`);

    try {
      await sendLicenseEmail(email, key);
      console.log(`✓ Email sent to ${email}`);
    } catch (err) {
      console.error('Nodemailer error:', err.message);
    }
  }

  res.json({ received: true });
});

// 3. License validation (used by Discord bot)
app.post('/validate-key', (req, res) => {
  const { email, key } = req.body;
  if (!email || !key) return res.status(400).json({ valid: false, reason: 'Missing fields' });

  const record = licenseStore[key];

  if (!record)
    return res.json({ valid: false, reason: 'Invalid license key' });

  if (record.email.toLowerCase() !== email.toLowerCase())
    return res.json({ valid: false, reason: 'Email does not match license' });

  res.json({
    valid:       true,
    email:       record.email,
    createdAt:   record.createdAt,
    downloadUrl: process.env.LAUNCHER_DOWNLOAD_URL,
  });
});

// 4. Health check
app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Whisper.cc backend running on port ${PORT}`));
