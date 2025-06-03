const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const http = require('http');
const { getAudioDurationInSeconds } = require('get-audio-duration');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Create uploads directory if it doesn't exist
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        // Accept only audio files
        const allowedMimes = [
            'audio/mpeg',
            'audio/mp3',
            'audio/wav',
            'audio/ogg',
            'audio/m4a',
            'audio/aac',
            'audio/flac'
        ];
        
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only audio files are allowed!'), false);
        }
    },
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    }
});

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(UPLOAD_DIR));

// Store songs metadata
let songs = [];
const SONGS_DB_FILE = path.join(__dirname, 'songs.json');

// Load existing songs from file
function loadSongs() {
    try {
        if (fs.existsSync(SONGS_DB_FILE)) {
            const data = fs.readFileSync(SONGS_DB_FILE, 'utf8');
            songs = JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading songs:', error);
        songs = [];
    }
}

// Save songs to file
function saveSongs() {
    try {
        fs.writeFileSync(SONGS_DB_FILE, JSON.stringify(songs, null, 2));
    } catch (error) {
        console.error('Error saving songs:', error);
    }
}

// Broadcast to all WebSocket clients
function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    
    ws.on('close', () => {
        console.log('WebSocket connection closed');
    });
});

// API Routes
app.get('/api/songs', (req, res) => {
    res.json(songs);
});

app.post('/api/upload', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file provided' });
        }

        const filePath = req.file.path;
        let duration = 0;

        try {
            duration = await getAudioDurationInSeconds(filePath);
        } catch (error) {
            console.warn('Could not get audio duration:', error.message);
        }

        const songData = {
            id: Date.now().toString(),
            name: req.body.name || req.file.originalname.replace(/\.[^/.]+$/, ""),
            artist: req.body.artist || 'Unknown Artist',
            filename: req.file.filename,
            originalName: req.file.originalname,
            duration: duration,
            uploadedAt: new Date().toISOString()
        };

        songs.push(songData);
        saveSongs();

        // Notify all connected clients
        broadcast({
            type: 'newSong',
            song: songData
        });

        res.json({
            success: true,
            message: 'Song uploaded successfully!',
            song: songData
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Failed to upload song' });
    }
});

app.delete('/api/songs/:id', (req, res) => {
    const songId = req.params.id;
    const songIndex = songs.findIndex(song => song.id === songId);
    
    if (songIndex === -1) {
        return res.status(404).json({ error: 'Song not found' });
    }
    
    const song = songs[songIndex];
    const filePath = path.join(UPLOAD_DIR, song.filename);
    
    // Delete file from disk
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
    
    // Remove from songs array
    songs.splice(songIndex, 1);
    saveSongs();
    
    // Notify all connected clients
    broadcast({
        type: 'songDeleted',
        songId: songId
    });
    
    res.json({ success: true, message: 'Song deleted successfully' });
});

// Initialize
loadSongs();

// Start server
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = { app, upload };
