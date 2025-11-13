// middleware/authtoken.js - With Prisma
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');

dotenv.config();

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware for verifying JWT tokens
const verifyToken = async (req, res, next) => {
    const token = req.cookies.auth_token;

    if (!token) {
        return res.status(403).json({ message: 'No token provided, authorization denied.' });
    }

    try {
        // Verify the JWT token using the secret key
        const decoded = jwt.verify(token, JWT_SECRET);
        console.log('Decoded token:', decoded);

        // Find user by decoded ID
        const user = await prisma.user.findUnique({
            where: { id: decoded.id },
            select: {
                id: true,
                username: true,
                email: true,
                balance: true,
                xp: true,
                verified: true,
                referralCode: true,
                referredBy: true,
                firstDeposit: true,
                profilePictureName: true
            }
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Token verification error:', error);

        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token expired. Please log in again.' });
        }

        res.status(401).json({ message: 'Token is not valid.' });
    }
};

module.exports = { verifyToken };