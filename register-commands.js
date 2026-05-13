/**
 * Run this ONCE to register the /setup-launcher slash command with Discord.
 * node register-commands.js
 */

require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('setup-launcher')
    .setDescription('Post the Get Launcher button embed in this channel')
    .setDefaultMemberPermissions('0') // Admin only
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
      { body: commands }
    );
    console.log('✓ Slash commands registered!');
  } catch (err) {
    console.error(err);
  }
})();