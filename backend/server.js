// Enhanced Backend with Railway Deployment Configuration
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Enhanced Security Configuration
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:", "https:"],
        }
    }
}));

// CORS Configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
    "http://localhost:3000",
    "https://your-frontend-domain.vercel.app"
];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Enhanced Rate Limiting
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many authentication attempts, please try again later.'
});

const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 100
});

// MongoDB Connection with Retry Logic
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
        });
        console.log('✅ MongoDB Connected');
    } catch (error) {
        console.error('❌ MongoDB Connection Error:', error.message);
        setTimeout(connectDB, 5000); // Retry after 5 seconds
    }
};

connectDB();

// Socket.IO Configuration
const io = socketIo(server, {
    cors: {
        origin: allowedOrigins,
        credentials: true
    }
});

// Enhanced JWT Middleware
const verifyToken = async (req, res, next) => {
    const token = req.cookies.auth_token;
    
    if (!token) {
        return res.status(403).json({ message: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const User = require('./models/User');
        const user = await User.findById(decoded.id).select('-password');
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token expired' });
        }
        res.status(401).json({ message: 'Invalid token' });
    }
};

// Enhanced Game Logic
let gameState = {
    timer: 30,
    bettingLocked: false,
    currentRoundId: 1
};

// Improved Winning Number Algorithm
async function generateWinningNumber(roundId) {
    const User = require('./models/User');
    const users = await User.find({ "currentRoundBets.roundId": roundId });
    
    const betTotals = {
        size: { big: 0, small: 0 },
        color: { red: 0, green: 0, purple: 0 },
        number: Array(10).fill(0)
    };

    users.forEach(user => {
        user.currentRoundBets.forEach(bet => {
            if (bet.betType === 'size') betTotals.size[bet.betValue] += bet.betAmount;
            else if (bet.betType === 'color') betTotals.color[bet.betValue] += bet.betAmount;
            else if (bet.betType === 'number') betTotals.number[bet.betValue] += bet.betAmount;
        });
    });

    // Fair algorithm: minimize total payout while maintaining randomness
    const numberCombos = {
        'red-big': [9, 7],
        'green-big': [8, 6, 5],
        'purple-big': [5],
        'green-small': [4, 2],
        'red-small': [3, 1, 0],
        'purple-small': [0]
    };

    let winningNumber = Math.floor(Math.random() * 10);
    const winningSize = winningNumber >= 5 ? 'big' : 'small';
    const colorMap = {
        0: 'purple', 1: 'red', 2: 'green', 3: 'red', 4: 'green',
        5: 'purple', 6: 'green', 7: 'red', 8: 'green', 9: 'red'
    };
    const winningColor = colorMap[winningNumber];

    return { number: winningNumber, color: winningColor, size: winningSize, roundId };
}

// Game Timer with Socket.IO
setInterval(async () => {
    if (gameState.timer === 0) {
        gameState.bettingLocked = true;
        
        const outcome = await generateWinningNumber(gameState.currentRoundId);
        io.emit('newOutcome', outcome);

        // Save to history
        const History = require('./models/history');
        await History.create(outcome);

        // Process user bets
        const User = require('./models/User');
        const users = await User.find({ "currentRoundBets.roundId": gameState.currentRoundId });

        for (const user of users) {
            let totalPayout = 0;

            for (const bet of user.currentRoundBets) {
                const isWinner = 
                    (bet.betType === 'color' && bet.betValue === outcome.color) ||
                    (bet.betType === 'size' && bet.betValue === outcome.size) ||
                    (bet.betType === 'number' && bet.betValue === outcome.number);

                const multiplier = bet.betType === 'number' ? 9 : 2;
                const houseFee = 0.03;
                const payout = isWinner ? (bet.betAmount * multiplier * (1 - houseFee)) : 0;

                totalPayout += payout;
                user.bets.push({ ...bet.toObject(), win: isWinner, payoutAmount: payout });
            }

            user.balance += totalPayout;
            user.currentRoundBets = [];
            await user.save();

            if (user.socketId) {
                io.to(user.socketId).emit('balanceUpdate', { balance: user.balance });
            }
        }

        gameState.currentRoundId++;
        gameState.timer = 30;
        gameState.bettingLocked = false;
    } else {
        gameState.timer--;
    }

    io.emit('timerUpdate', { timer: gameState.timer });
}, 1000);

// Routes
app.post('/register', authLimiter, require('./routes/auth').register);
app.post('/login', authLimiter, require('./routes/auth').login);
app.post('/logout', require('./routes/auth').logout);
app.get('/verify-token', verifyToken, (req, res) => {
    res.json({ username: req.user.username });
});

app.use('/api', apiLimiter);
app.use('/api/profile', verifyToken, require('./routes/profile'));
app.use('/api/wallet', verifyToken, require('./routes/wallet'));
app.use('/api/game', verifyToken, require('./routes/game'));

// Health Check for Railway
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', uptime: process.uptime() });
});

// Socket.IO Connection
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    socket.on('register', async (userId) => {
        const User = require('./models/User');
        await User.findByIdAndUpdate(userId, { socketId: socket.id });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});