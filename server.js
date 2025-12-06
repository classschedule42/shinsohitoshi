const { WebcastPushConnection } = require('tiktok-live-connector');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// ✅ แก้ PORT ให้รองรับ Render
const PORT = process.env.PORT || 3000;
const tiktokUsername = 'snowball_iak';

let tiktokLiveConnection;
let isLiveActive = false;
let liveStats = {
    isLive: false,
    viewerCount: 0,
    likeCount: 0,
    totalViewers: 0,
    startTime: null,
    roomId: null
};

const colors = {
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    cyan: '\x1b[36m',
    reset: '\x1b[0m',
    bright: '\x1b[1m'
};

// ✅ Serve static files (HTML/CSS/JS)
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Route หน้าหลัก
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Endpoint เพื่อดึงสถานะ
app.get('/api/live-status', (req, res) => {
    res.json({
        success: true,
        data: {
            ...liveStats,
            duration: liveStats.startTime ? Math.floor((Date.now() - liveStats.startTime) / 1000) : 0,
            username: tiktokUsername
        }
    });
});

// ✅ Health check endpoint สำหรับ Render
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        uptime: process.uptime(),
        isLive: liveStats.isLive 
    });
});

// WebSocket สำหรับ Real-time Updates
io.on('connection', (socket) => {
    console.log(`${colors.cyan}🔌 Client connected: ${socket.id}${colors.reset}`);
    
    socket.emit('liveStatus', {
        ...liveStats,
        duration: liveStats.startTime ? Math.floor((Date.now() - liveStats.startTime) / 1000) : 0,
        username: tiktokUsername
    });
    
    socket.on('disconnect', () => {
        console.log(`${colors.yellow}🔌 Client disconnected: ${socket.id}${colors.reset}`);
    });
});

function broadcastLiveStatus() {
    const statusData = {
        ...liveStats,
        duration: liveStats.startTime ? Math.floor((Date.now() - liveStats.startTime) / 1000) : 0,
        username: tiktokUsername
    };
    io.emit('liveStatus', statusData);
}

function connectToTikTokLive() {
    tiktokLiveConnection = new WebcastPushConnection(tiktokUsername, {
        processInitialData: true,
        enableExtendedGiftInfo: true,
        requestPollingIntervalMs: 1000
    });
    
    tiktokLiveConnection.connect().then(state => {
        isLiveActive = true;
        liveStats = {
            isLive: true,
            viewerCount: 0,
            likeCount: 0,
            totalViewers: 0,
            startTime: Date.now(),
            roomId: state.roomId
        };
        
        console.log(`${colors.green}✅ เชื่อมต่อกับ TikTok Live สำเร็จ!${colors.reset}`);
        console.log(`${colors.cyan}📺 Room ID: ${state.roomId}${colors.reset}`);
        console.log(`${colors.cyan}👤 Streamer: ${tiktokUsername}${colors.reset}`);
        
        broadcastLiveStatus();
        
    }).catch(err => {
        isLiveActive = false;
        liveStats.isLive = false;
        console.log(`${colors.yellow}⚠️ ยังไม่ได้ไลฟ์ - ลองใหม่ใน 30 วินาที${colors.reset}`);
        setTimeout(connectToTikTokLive, 30000);
    });
    
    tiktokLiveConnection.on('roomUser', (data) => {
        liveStats.viewerCount = data.viewerCount || 0;
        broadcastLiveStatus();
    });
    
    tiktokLiveConnection.on('like', (data) => {
        liveStats.likeCount += data.likeCount || 1;
        broadcastLiveStatus();
    });
    
    tiktokLiveConnection.on('member', (data) => {
        liveStats.totalViewers++;
        broadcastLiveStatus();
    });
    
    tiktokLiveConnection.on('streamEnd', () => {
        console.log(`${colors.red}🔴 ไลฟ์สตรีมจบแล้ว${colors.reset}`);
        
        isLiveActive = false;
        liveStats = {
            isLive: false,
            viewerCount: 0,
            likeCount: 0,
            totalViewers: 0,
            startTime: null,
            roomId: null
        };
        
        broadcastLiveStatus();
        setTimeout(connectToTikTokLive, 30000);
    });
    
    tiktokLiveConnection.on('error', err => {
        if (err && err.message && !err.message.includes('giftImage')) {
            console.error(`${colors.red}⚠️ Error:${colors.reset}`, err.message);
        }
    });
    
    tiktokLiveConnection.on('disconnect', () => {
        isLiveActive = false;
        liveStats.isLive = false;
        broadcastLiveStatus();
        console.log(`${colors.yellow}⚠️ ตัดการเชื่อมต่อ - ลองใหม่ใน 30 วินาที${colors.reset}`);
        setTimeout(connectToTikTokLive, 30000);
    });
}

// เริ่มต้น Server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`${colors.bright}${colors.cyan}🚀 Server running on port ${PORT}${colors.reset}`);
    console.log(`${colors.cyan}📱 Monitoring: @${tiktokUsername}${colors.reset}`);
    console.log(`${colors.cyan}🔌 WebSocket: Active${colors.reset}`);
    console.log('==========================================\n');
    
    connectToTikTokLive();
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log(`\n${colors.yellow}🛑 SIGTERM received, shutting down...${colors.reset}`);
    
    if (tiktokLiveConnection) {
        tiktokLiveConnection.disconnect();
    }
    
    server.close(() => {
        console.log(`${colors.green}✅ Server closed${colors.reset}`);
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log(`\n${colors.yellow}🛑 SIGINT received, shutting down...${colors.reset}`);
    
    if (tiktokLiveConnection) {
        tiktokLiveConnection.disconnect();
    }
    
    server.close(() => {
        console.log(`${colors.green}✅ Server closed${colors.reset}`);
        process.exit(0);
    });
});

process.on('unhandledRejection', (reason) => {
    if (reason && reason.message && !reason.message.includes('giftImage')) {
        console.error('Unhandled Rejection:', reason);
    }
});

process.on('uncaughtException', (error) => {
    if (error.message && !error.message.includes('giftImage')) {
        console.error('Uncaught Exception:', error);
    }
});
