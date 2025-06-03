class SongPlayer {
    constructor() {
        this.audioPlayer = document.getElementById('audioPlayer');
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.prevBtn = document.getElementById('prevBtn');
        this.nextBtn = document.getElementById('nextBtn');
        this.progress = document.getElementById('progress');
        this.progressBar = document.querySelector('.progress-bar');
        this.currentTimeEl = document.getElementById('currentTime');
        this.durationEl = document.getElementById('duration');
        this.volumeSlider = document.getElementById('volumeSlider');
        this.songTitle = document.getElementById('songTitle');
        this.songArtist = document.getElementById('songArtist');
        this.songList = document.getElementById('songList');
        
        this.songs = [];
        this.currentSongIndex = 0;
        this.isPlaying = false;
        
        this.initializeEventListeners();
        this.loadSongs();
        this.connectWebSocket();
    }
    
    initializeEventListeners() {
        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.prevBtn.addEventListener('click', () => this.previousSong());
        this.nextBtn.addEventListener('click', () => this.nextSong());
        
        this.audioPlayer.addEventListener('timeupdate', () => this.updateProgress());
        this.audioPlayer.addEventListener('loadedmetadata', () => this.updateDuration());
        this.audioPlayer.addEventListener('ended', () => this.nextSong());
        
        this.progressBar.addEventListener('click', (e) => this.setProgress(e));
        this.volumeSlider.addEventListener('input', () => this.setVolume());
        
        // Set initial volume
        this.audioPlayer.volume = this.volumeSlider.value / 100;
    }
    
    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}`);
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'newSong') {
                this.loadSongs();
            }
        };
        
        ws.onopen = () => {
            console.log('WebSocket connected');
        };
        
        ws.onclose = () => {
            console.log('WebSocket disconnected, attempting to reconnect...');
            setTimeout(() => this.connectWebSocket(), 3000);
        };
    }
    
    async loadSongs() {
        try {
            const response = await fetch('/api/songs');
            this.songs = await response.json();
            this.renderSongList();
        } catch (error) {
            console.error('Error loading songs:', error);
        }
    }
    
    renderSongList() {
        if (this.songs.length === 0) {
            this.songList.innerHTML = '<p class="no-songs">No songs uploaded yet. Use Discord bot to upload!</p>';
            return;
        }
        
        this.songList.innerHTML = this.songs.map((song, index) => `
            <div class="song-item ${index === this.currentSongIndex ? 'active' : ''}" 
                 onclick="player.playSong(${index})">
                <div class="song-name">${song.name}</div>
                <div class="song-duration">${this.formatTime(song.duration || 0)}</div>
            </div>
        `).join('');
    }
    
    playSong(index) {
        if (index >= 0 && index < this.songs.length) {
            this.currentSongIndex = index;
            const song = this.songs[index];
            
            this.audioPlayer.src = `/uploads/${song.filename}`;
            this.songTitle.textContent = song.name;
            this.songArtist.textContent = song.artist || 'Unknown Artist';
            
            this.audioPlayer.play();
            this.isPlaying = true;
            this.playPauseBtn.textContent = '⏸️';
            
            this.renderSongList();
        }
    }
    
    togglePlayPause() {
        if (this.songs.length === 0) return;
        
        if (this.isPlaying) {
            this.audioPlayer.pause();
            this.playPauseBtn.textContent = '▶️';
        } else {
            if (!this.audioPlayer.src) {
                this.playSong(0);
                return;
            }
            this.audioPlayer.play();
            this.playPauseBtn.textContent = '⏸️';
        }
        this.isPlaying = !this.isPlaying;
    }
    
    previousSong() {
        const prevIndex = this.currentSongIndex > 0 ? this.currentSongIndex - 1 : this.songs.length - 1;
        this.playSong(prevIndex);
    }
    
    nextSong() {
        const nextIndex = this.currentSongIndex < this.songs.length - 1 ? this.currentSongIndex + 1 : 0;
        this.playSong(nextIndex);
    }
    
    updateProgress() {
        const { currentTime, duration } = this.audioPlayer;
        const progressPercent = (currentTime / duration) * 100;
        this.progress.style.width = `${progressPercent}%`;
        this.currentTimeEl.textContent = this.formatTime(currentTime);
    }
    
    updateDuration() {
        this.durationEl.textContent = this.formatTime(this.audioPlayer.duration);
    }
    
    setProgress(e) {
        const width = this.progressBar.clientWidth;
        const clickX = e.offsetX;
        const duration = this.audioPlayer.duration;
        this.audioPlayer.currentTime = (clickX / width) * duration;
    }
    
    setVolume() {
        this.audioPlayer.volume = this.volumeSlider.value / 100;
    }
    
    formatTime(time) {
        if (isNaN(time)) return '0:00';
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
}

// Initialize player when page loads
let player;
document.addEventListener('DOMContentLoaded', () => {
    player = new SongPlayer();
});
