const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Bot configuration
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const WEB_SERVER_URL = process.env.WEB_SERVER_URL || 'http://localhost:3000';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!BOT_TOKEN) {
    console.error('❌ DISCORD_BOT_TOKEN is required in .env file');
    process.exit(1);
}

// Slash Commands
const commands = [
    new SlashCommandBuilder()
        .setName('upload')
        .setDescription('Upload a song to the web player')
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('Audio file to upload')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('title')
                .setDescription('Song title')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('artist')
                .setDescription('Artist name')
                .setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('songs')
        .setDescription('List all uploaded songs'),
    
    new SlashCommandBuilder()
        .setName('player')
        .setDescription('Get the web player link'),
    
    new SlashCommandBuilder()
        .setName('delete')
        .setDescription('Delete a song from the playlist')
        .addStringOption(option =>
            option.setName('song')
                .setDescription('Song name to delete')
                .setRequired(true)
                .setAutocomplete(true)),
    
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show bot commands and usage')
];

// Register slash commands
async function registerCommands() {
    if (!CLIENT_ID) {
        console.warn('⚠️ DISCORD_CLIENT_ID not provided, skipping slash command registration');
        return;
    }

    try {
        const rest = new REST().setToken(BOT_TOKEN);
        console.log('🔄 Registering slash commands...');
        
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands }
        );
        
        console.log('✅ Slash commands registered successfully!');
    } catch (error) {
        console.error('❌ Error registering slash commands:', error);
    }
}

// Bot ready event
client.once('ready', async () => {
    console.log(`🤖 Discord bot logged in as ${client.user.tag}!`);
    console.log(`📊 Bot is in ${client.guilds.cache.size} servers`);
    
    // Set bot status
    client.user.setActivity('🎵 Managing music | /help', { type: 'PLAYING' });
    
    // Register slash commands
    await registerCommands();
});

// Handle slash commands
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    try {
        switch (commandName) {
            case 'upload':
                await handleSlashUpload(interaction);
                break;
            case 'songs':
                await handleSlashSongs(interaction);
                break;
            case 'player':
                await handleSlashPlayer(interaction);
                break;
            case 'delete':
                await handleSlashDelete(interaction);
                break;
            case 'help':
                await handleSlashHelp(interaction);
                break;
        }
    } catch (error) {
        console.error(`Error handling command ${commandName}:`, error);
        
        const errorEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Error')
            .setDescription('An error occurred while processing your command.')
            .setTimestamp();

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
        } else {
            await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
    }
});

// Handle autocomplete for delete command
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isAutocomplete()) return;

    if (interaction.commandName === 'delete') {
        try {
            const response = await axios.get(`${WEB_SERVER_URL}/api/songs`);
            const songs = response.data;
            
            const focusedValue = interaction.options.getFocused();
            const filtered = songs.filter(song => 
                song.name.toLowerCase().includes(focusedValue.toLowerCase())
            ).slice(0, 25);

            await interaction.respond(
                filtered.map(song => ({
                    name: `${song.name} - ${song.artist}`,
                    value: song.id
                }))
            );
        } catch (error) {
            console.error('Autocomplete error:', error);
            await interaction.respond([]);
        }
    }
});

// Handle legacy text commands (for backwards compatibility)
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Handle !upload command
    if (message.content.startsWith('!upload')) {
        await handleLegacyUpload(message);
    }
    
    // Handle other legacy commands
    if (message.content === '!songs') {
        await handleLegacySongs(message);
    }
    
    if (message.content === '!player') {
        await handleLegacyPlayer(message);
    }

    if (message.content === '!help') {
        await handleLegacyHelp(message);
    }
});

// Slash command handlers
async function handleSlashUpload(interaction) {
    await interaction.deferReply();

    const attachment = interaction.options.getAttachment('file');
    const title = interaction.options.getString('title');
    const artist = interaction.options.getString('artist');

    if (!attachment) {
        return interaction.editReply('❌ Please provide an audio file!');
    }

    await uploadSong(interaction, attachment, title, artist, true);
}

async function handleSlashSongs(interaction) {
    await interaction.deferReply();
    await showSongsList(interaction, true);
}

async function handleSlashPlayer(interaction) {
    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('🎵 Web Music Player')
        .setDescription(`**[🌐 Open Web Player](${WEB_SERVER_URL})**`)
        .addFields(
            { name: '📤 Upload Songs', value: 'Use `/upload` with an audio file', inline: true },
            { name: '📋 List Songs', value: 'Use `/songs` to see all uploaded songs', inline: true },
            { name: '🗑️ Delete Songs', value: 'Use `/delete` to remove songs', inline: true }
        )
        .setThumbnail(client.user.displayAvatarURL())
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

async function handleSlashDelete(interaction) {
    await interaction.deferReply();

    const songId = interaction.options.getString('song');

    try {
        const response = await axios.delete(`${WEB_SERVER_URL}/api/songs/${songId}`);
        
        if (response.data.success) {
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Song Deleted')
                .setDescription('Song has been successfully removed from the playlist!')
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } else {
            throw new Error('Delete request failed');
        }
    } catch (error) {
        console.error('Delete error:', error);
        
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Delete Failed')
            .setDescription('Could not delete the song. It may have already been removed.')
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }
}

async function handleSlashHelp(interaction) {
    const embed = new EmbedBuilder()
        .setColor(0x7289DA)
        .setTitle('🎵 Music Bot Help')
        .setDescription('Upload and manage songs for the web music player!')
        .addFields(
            { 
                name: '📤 `/upload`', 
                value: 'Upload an audio file to the web player\n`/upload file:[audio] title:[optional] artist:[optional]`', 
                inline: false 
            },
            { 
                name: '📋 `/songs`', 
                value: 'Display all uploaded songs in the playlist', 
                inline: false 
            },
            { 
                name: '🌐 `/player`', 
                value: 'Get the link to the web music player', 
                inline: false 
            },
            { 
                name: '🗑️ `/delete`', 
                value: 'Remove a song from the playlist', 
                inline: false 
            },
            { 
                name: '❓ `/help`', 
                value: 'Show this help message', 
                inline: false 
            }
        )
        .addFields(
            { 
                name: '🔗 Web Player', 
                value: `[Click here to open](${WEB_SERVER_URL})`, 
                inline: true 
            },
            { 
                name: '📁 Supported Formats', 
                value: 'MP3, WAV, OGG, M4A, AAC, FLAC', 
                inline: true 
            },
            { 
                name: '📏 File Size Limit', 
                value: '50MB maximum', 
                inline: true 
            }
        )
        .setThumbnail(client.user.displayAvatarURL())
        .setFooter({ text: 'Legacy commands (!upload, !songs, !player) also work' })
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

// Legacy command handlers (for backwards compatibility)
async function handleLegacyUpload(message) {
    if (message.attachments.size === 0) {
        return message.reply('❌ Please attach an audio file to upload! Use `/upload` for the new slash command.');
    }

    const attachment = message.attachments.first();
    
    // Parse command for song name and artist
    const quotedParts = message.content.match(/"([^"]+)"/g);
    let songName = null;
    let artist = null;

    if (quotedParts && quotedParts.length >= 1) {
        songName = quotedParts[0].replace(/"/g, '');
        if (quotedParts.length >= 2) {
            artist = quotedParts[1].replace(/"/g, '');
        }
    }

    await uploadSong(message, attachment, songName, artist, false);
}

async function handleLegacySongs(message) {
    await showSongsList(message, false);
}

async function handleLegacyPlayer(message) {
    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('🎵 Web Music Player')
        .setDescription(`**[🌐 Open Web Player](${WEB_SERVER_URL})**`)
        .addFields(
            { name: '📤 Upload Songs', value: 'Use `/upload` or `!upload` with an audio file', inline: true },
            { name: '📋 List Songs', value: 'Use `/songs` or `!songs`', inline: true }
        )
        .setFooter({ text: 'Try the new slash commands with /' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

async function handleLegacyHelp(message) {
    const embed = new EmbedBuilder()
        .setColor(0x7289DA)
        .setTitle('🎵 Music Bot Commands')
        .setDescription('**New Slash Commands (Recommended):**')
        .addFields(
            { name: '`/upload`', value: 'Upload audio files with metadata', inline: true },
            { name: '`/songs`', value: 'List all songs', inline: true },
            { name: '`/player`', value: 'Get web player link', inline: true },
            { name: '`/delete`', value: 'Delete songs', inline: true },
            { name: '`/help`', value: 'Show detailed help', inline: true }
        )
        .addFields(
            { name: '\u200B', value: '**Legacy Commands:**', inline: false },
            { name: '`!upload`', value: 'Upload with attachment', inline: true },
            { name: '`!songs`', value: 'List songs', inline: true },
            { name: '`!player`', value: 'Get player link', inline: true }
        )
        .setFooter({ text: 'Use slash commands (/) for the best experience!' });

    await message.reply({ embeds: [embed] });
}

// Shared functions
async function uploadSong(context, attachment, title, artist, isSlash) {
    // Validate file type
    const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];
    const fileExtension = path.extname(attachment.name).toLowerCase();
    
    if (!audioExtensions.includes(fileExtension)) {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Invalid File Type')
            .setDescription('Please upload a valid audio file!')
            .addFields({ name: 'Supported formats', value: 'MP3, WAV, OGG, M4A, AAC, FLAC' });

        if (isSlash) {
            return context.editReply({ embeds: [embed] });
        } else {
            return context.reply({ embeds: [embed] });
        }
    }

    // Check file size (50MB limit)
    if (attachment.size > 50 * 1024 * 1024) {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ File Too Large')
            .setDescription('Maximum file size is 50MB');

        if (isSlash) {
            return context.editReply({ embeds: [embed] });
        } else {
            return context.reply({ embeds: [embed] });
        }
    }

    try {
        // Create loading embed
        const loadingEmbed = new EmbedBuilder()
            .setColor(0xFFFF00)
            .setTitle('⏳ Uploading...')
            .setDescription('Processing your audio file...')
            .addFields({ name: 'File', value: attachment.name, inline: true })
            .setTimestamp();

        let loadingMessage;
        if (isSlash) {
            await context.editReply({ embeds: [loadingEmbed] });
        } else {
            loadingMessage = await context.reply({ embeds: [loadingEmbed] });
        }

        // Download the file
        const response = await axios.get(attachment.url, {
            responseType: 'stream',
            timeout: 30000 // 30 second timeout
        });

        // Prepare song metadata
        const songName = title || attachment.name.replace(/\.[^/.]+$/, "");
        const artistName = artist || 'Unknown Artist';

        // Create form data
        const formData = new FormData();
        formData.append('audio', response.data, {
            filename: attachment.name,
            contentType: attachment.contentType || 'audio/mpeg'
        });
        formData.append('name', songName);
        formData.append('artist', artistName);

        // Upload to web server
        const uploadResponse = await axios.post(`${WEB_SERVER_URL}/api/upload`, formData, {
            headers: {
                ...formData.getHeaders()
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 60000 // 60 second timeout
        });

        if (uploadResponse.data.success) {
            const song = uploadResponse.data.song;
            const successEmbed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Song Uploaded Successfully!')
                .setDescription(`**${songName}** has been added to the playlist`)
                .addFields(
                    { name: '🎵 Title', value: songName, inline: true },
                    { name: '🎤 Artist', value: artistName, inline: true },
                    { name: '📁 File', value: attachment.name, inline: true },
                    { name: '⏱️ Duration', value: song.duration ? formatDuration(song.duration) : 'Unknown', inline: true },
                    { name: '📊 File Size', value: formatFileSize(attachment.size), inline: true },
                    { name: '🌐 Web Player', value: `[Open Player](${WEB_SERVER_URL})`, inline: true }
                )
                .setThumbnail('https://cdn.discordapp.com/emojis/🎵.png')
                .setFooter({ text: `Uploaded by ${isSlash ? context.user.tag : context.author.tag}` })
                .setTimestamp();

            if (isSlash) {
                await context.editReply({ embeds: [successEmbed] });
            } else {
                await loadingMessage.edit({ embeds: [successEmbed] });
            }
        } else {
            throw new Error('Upload failed on server side');
        }

    } catch (error) {
        console.error('Upload error:', error);
        
        let errorMessage = 'An error occurred while uploading the song.';
        if (error.code === 'ECONNREFUSED') {
            errorMessage = 'Could not connect to the web server. Please try again later.';
        } else if (error.response?.status === 413) {
            errorMessage = 'File is too large. Maximum size is 50MB.';
        } else if (error.code === 'ENOTFOUND') {
            errorMessage = 'Web server is not accessible. Please check the server status.';
        }

        const errorEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Upload Failed')
            .setDescription(errorMessage)
            .addFields({ name: 'File', value: attachment.name })
            .setTimestamp();

        if (isSlash) {
            await context.editReply({ embeds: [errorEmbed] });
        } else {
            if (loadingMessage) {
                await loadingMessage.edit({ embeds: [errorEmbed] });
            } else {
                await context.reply({ embeds: [errorEmbed] });
            }
        }
    }
}

async function showSongsList(context, isSlash) {
    try {
        const response = await axios.get(`${WEB_SERVER_URL}/api/songs`);
        const songs = response.data;

        if (songs.length === 0) {
            const embed = new EmbedBuilder()
                .setColor(0x7289DA)
                .setTitle('🎵 Empty Playlist')
                .setDescription('No songs uploaded yet!')
                .addFields({ name: 'Get Started', value: 'Use `/upload` to add your first song!' })
                .setTimestamp();

            if (isSlash) {
                return context.editReply({ embeds: [embed] });
            } else {
                return context.reply({ embeds: [embed] });
            }
        }

        // Create pages for large playlists
        const songsPerPage = 10;
        const totalPages = Math.ceil(songs.length / songsPerPage);
        const currentPage = 1;
        
        const startIndex = (currentPage - 1) * songsPerPage;
        const endIndex = startIndex + songsPerPage;
        const currentSongs = songs.slice(startIndex, endIndex);

        const songList = currentSongs.map((song, index) => {
            const duration = song.duration ? formatDuration(song.duration) : 'Unknown';
            const uploadDate = new Date(song.uploadedAt).toLocaleDateString();
            return `**${startIndex + index + 1}.** ${song.name}\n` +
                   `└ *${song.artist}* • ${duration} • ${uploadDate}`;
        }).join('\n\n');

        const embed = new EmbedBuilder()
            .setColor(0x7289DA)
            .setTitle('🎵 Song Playlist')
            .setDescription(songList)
            .addFields(
                { name: '📊 Total Songs', value: songs.length.toString(), inline: true },
                { name: '📄 Page', value: `${currentPage}/${totalPages}`, inline: true },
                { name: '🌐 Web Player', value: `[Open Player](${WEB_SERVER_URL})`, inline: true }
            )
            .setFooter({ text: 'Use /delete to remove songs • /upload to add more' })
            .setTimestamp();

        if (isSlash) {
            await context.editReply({ embeds: [embed] });
        } else {
            await context.reply({ embeds: [embed] });
        }

    } catch (error) {
        console.error('Error fetching songs:', error);
        
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Error')
            .setDescription('Could not fetch songs from the web player.')
            .addFields({ name: 'Possible Issues', value: '• Web server is offline\n• Network connection issues' })
            .setTimestamp();

        if (isSlash) {
            await context.editReply({ embeds: [embed] });
        } else {
            await context.reply({ embeds: [embed] });
        }
    }
}

// Utility functions
function formatDuration(seconds) {
    if (isNaN(seconds)) return 'Unknown';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Error handling
client.on('error', (error) => {
    console.error('Discord client error:', error);
});

client.on('warn', (warning) => {
    console.warn('Discord client warning:', warning);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down Discord bot...');
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down Discord bot...');
    client.destroy();
    process.exit(0);
});

// Login to Discord
client.login(BOT_TOKEN).catch(error => {
    console.error('❌ Failed to login to Discord:', error);
    process.exit(1);
});

console.log('🚀 Starting Discord Music Bot...');
console.log(`🌐 Web Server URL: ${WEB_SERVER_URL}`);
