// server.js - Game Backend with PostgreSQL
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const socketIo = require('socket.io');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();
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

// Database Connection Test
async function connectDB() {
    try {
        await prisma.$connect();
        console.log('✅ PostgreSQL Connected via Prisma');
    } catch (error) {
        console.error('❌ Database Connection Error:', error.message);
        setTimeout(connectDB, 5000);
    }
}

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
        const user = await prisma.user.findUnique({
            where: { id: decoded.id },
            select: {
                id: true,
                username: true,
                email: true,
                balance: true,
                xp: true,
                verified: true
            }
        });
        
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
    const users = await prisma.user.findMany({
        where: {
            currentRoundBets: {
                some: {
                    roundId: roundId
                }
            }
        },
        include: {
            currentRoundBets: {
                where: {
                    roundId: roundId
                }
            }
        }
    });
    
    const betTotals = {
        size: { big: 0, small: 0 },
        color: { red: 0, green: 0, purple: 0 },
        number: Array(10).fill(0)
    };

    users.forEach(user => {
        user.currentRoundBets.forEach(bet => {
            if (bet.betType === 'size') betTotals.size[bet.betValue] += bet.betAmount;
            else if (bet.betType === 'color') betTotals.color[bet.betValue] += bet.betAmount;
            else if (bet.betType === 'number') betTotals.number[parseInt(bet.betValue)] += bet.betAmount;
        });
    });

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
        await prisma.history.create({
            data: {
                roundId: outcome.roundId,
                number: outcome.number,
                color: outcome.color,
                size: outcome.size
            }
        });

        // Process user bets
        const users = await prisma.user.findMany({
            where: {
                currentRoundBets: {
                    some: {
                        roundId: gameState.currentRoundId
                    }
                }
            },
            include: {
                currentRoundBets: {
                    where: {
                        roundId: gameState.currentRoundId
                    }
                }
            }
        });

        for (const user of users) {
            let totalPayout = 0;

            for (const bet of user.currentRoundBets) {
                const isWinner = 
                    (bet.betType === 'color' && bet.betValue === outcome.color) ||
                    (bet.betType === 'size' && bet.betValue === outcome.size) ||
                    (bet.betType === 'number' && parseInt(bet.betValue) === outcome.number);

                const multiplier = bet.betType === 'number' ? 9 : 2;
                const houseFee = 0.03;
                const payout = isWinner ? (bet.betAmount * multiplier * (1 - houseFee)) : 0;

                totalPayout += payout;
                
                // Create bet history
                await prisma.bet.create({
                    data: {
                        userId: user.id,
                        betType: bet.betType,
                        betValue: bet.betValue,
                        betAmount: bet.betAmount,
                        win: isWinner,
                        payoutAmount: payout,
                        roundId: bet.roundId
                    }
                });
            }

            // Update user balance and clear current round bets
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    balance: {
                        increment: totalPayout
                    }
                }
            });

            await prisma.currentRoundBet.deleteMany({
                where: {
                    userId: user.id,
                    roundId: gameState.currentRoundId
                }
            });

            if (user.socketId) {
                const updatedUser = await prisma.user.findUnique({
                    where: { id: user.id },
                    select: { balance: true }
                });
                io.to(user.socketId).emit('balanceUpdate', { balance: updatedUser.balance });
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

// Make prisma and io available globally for routes
app.set('prisma', prisma);
app.set('io', io);

// Routes
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const walletRoutes = require('./routes/wallet');
const gameRoutes = require('./routes/game');
const withdrawalRoutes = require('./routes/Withdrawals');
const depositRoutes = require('./routes/depositwithdraw');
const notificationRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/adminroutes');
const otpRoutes = require('./routes/otp');
const resetPassRoutes = require('./routes/reset-pass');

app.post('/register', authLimiter, authRoutes.register);
app.post('/login', authLimiter, authRoutes.login);
app.post('/logout', authRoutes.logout);
app.get('/verify-token', verifyToken, (req, res) => {
    res.json({ username: req.user.username });
});

app.use('/api', apiLimiter);
app.use('/api/profile', profileRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/game', gameRoutes);
app.use('/api', withdrawalRoutes);
app.use('/api', depositRoutes);
app.use('/api', notificationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', otpRoutes);
app.use('/api', resetPassRoutes);

// Health Check for Railway
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        uptime: process.uptime(),
        database: 'postgresql',
        round: gameState.currentRoundId
    });
});

// Socket.IO Connection
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    socket.on('register', async (userId) => {
        await prisma.user.update({
            where: { id: userId },
            data: { socketId: socket.id }
        });
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

// Graceful shutdown
process.on('SIGTERM', async () => {
    await prisma.$disconnect();
    server.close();
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Game Server running on port ${PORT}`);
    console.log(`🎮 Current Round: ${gameState.currentRoundId}`);
    console.log(`🗄️  Database: PostgreSQL + Prisma`);
});