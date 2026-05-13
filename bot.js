/**
 * Whisper.cc Discord Bot
 * Features:
 *   - "Get Launcher" button in a channel
 *   - Modal to enter email + license key
 *   - Validates key against backend
 *   - Sends ephemeral message with download link
 *
 * Setup:
 *   npm install discord.js dotenv node-fetch
 *   node bot.js
 */

require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, Events,
} = require('discord.js');

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// ── Slash command to post the Get Launcher button (run once in your channel) ──
// Use: /setup-launcher in your target channel
client.on(Events.InteractionCreate, async (interaction) => {

  // ── /setup-launcher — posts the button embed ──
  if (interaction.isChatInputCommand() && interaction.commandName === 'setup-launcher') {
    const embed = new EmbedBuilder()
      .setColor(0xe0161a)
      .setTitle('⚡  WHISPER.CC LAUNCHER')
      .setDescription(
        '```\n// Secure · Licensed · Instant\n```\n\n' +
        'Click the button below to verify your license and receive your private download link via DM.\n\n' +
        '> You will need the **email** you purchased with and your **license key** from your confirmation email.'
      )
      .addFields(
        { name: '🔑  License Required', value: 'Purchase at whisper.cc — $1.99 one-time', inline: true },
        { name: '📬  Delivery',         value: 'Instant DM after verification',           inline: true },
      )
      .setFooter({ text: 'whisper.cc  ·  Do not share your license key' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('get_launcher')
        .setLabel('⚡  Get Launcher')
        .setStyle(ButtonStyle.Danger)  // red
    );

    await interaction.reply({ embeds: [embed], components: [row] });
    return;
  }

  // ── Button click — show modal ──
  if (interaction.isButton() && interaction.customId === 'get_launcher') {
    const modal = new ModalBuilder()
      .setCustomId('launcher_modal')
      .setTitle('Whisper.cc — Verify License');

    const emailInput = new TextInputBuilder()
      .setCustomId('email')
      .setLabel('Email Address')
      .setPlaceholder('The email you purchased with')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(254);

    const keyInput = new TextInputBuilder()
      .setCustomId('license_key')
      .setLabel('License Key')
      .setPlaceholder('WSP-XXXX-XXXX-XXXX-XXXX')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(32);

    modal.addComponents(
      new ActionRowBuilder().addComponents(emailInput),
      new ActionRowBuilder().addComponents(keyInput),
    );

    await interaction.showModal(modal);
    return;
  }

  // ── Modal submit — validate & respond ──
  if (interaction.isModalSubmit() && interaction.customId === 'launcher_modal') {
    await interaction.deferReply({ ephemeral: true });

    const email = interaction.fields.getTextInputValue('email').trim();
    const key   = interaction.fields.getTextInputValue('license_key').trim().toUpperCase();

    let result;
    try {
      const res = await fetch(`${BACKEND_URL}/validate-key`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, key }),
      });
      result = await res.json();
    } catch (err) {
      console.error('Backend error:', err);
      await interaction.editReply({
        content: '❌ Could not reach the license server. Please try again later or contact support.',
      });
      return;
    }

    if (!result.valid) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xff3333)
        .setTitle('❌  License Invalid')
        .setDescription(
          `\`\`\`\n${result.reason || 'License verification failed.'}\n\`\`\`\n` +
          'Make sure you entered the correct email and key from your Whisper.cc purchase email.\n\n' +
          '→ Need help? DM a staff member or email support@whisper.cc'
        )
        .setFooter({ text: 'whisper.cc' });

      await interaction.editReply({ embeds: [errorEmbed] });
      return;
    }

    // ── Valid — send DM with download ──
    const successEmbed = new EmbedBuilder()
      .setColor(0xe0161a)
      .setTitle('⚡  Access Granted — Whisper.cc')
      .setDescription(
        '```\n// License verified successfully\n```\n\n' +
        `Welcome, **${email}**.\n\n` +
        'Your private launcher download link is below. This link is for your use only — do not share it.'
      )
      .addFields(
        {
          name: '📥  Download Launcher',
          value: `[**Click here to download Whisper Launcher**](${result.downloadUrl})`,
        },
        {
          name: '🔑  Your License Key',
          value: `\`${key}\``,
          inline: true,
        },
        {
          name: '📅  Licensed Since',
          value: result.createdAt ? `<t:${Math.floor(new Date(result.createdAt).getTime() / 1000)}:D>` : 'N/A',
          inline: true,
        },
      )
      .addFields({
        name: '⚠️  Important',
        value:
          '• The launcher is bound to your machine (HWID)\n' +
          '• Do not share your key or this link\n' +
          '• HWID resets: contact support@whisper.cc',
      })
      .setFooter({ text: 'whisper.cc  ·  Thank you for your purchase' })
      .setTimestamp();

    try {
      await interaction.user.send({ embeds: [successEmbed] });
    } catch {
      // DMs are closed — fall back to ephemeral reply
      await interaction.editReply({
        content: '⚠️ I couldn\'t DM you (you may have DMs disabled). Here\'s your access:',
        embeds: [successEmbed],
      });
      return;
    }

    // Ephemeral confirmation in channel
    const confirmEmbed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('✅  Check Your DMs!')
      .setDescription('Your license has been verified. Your launcher download link has been sent to your DMs.')
      .setFooter({ text: 'whisper.cc' });

    await interaction.editReply({ embeds: [confirmEmbed] });
  }
});

client.once(Events.ClientReady, (c) => {
  console.log(`✓ Whisper bot online as ${c.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);