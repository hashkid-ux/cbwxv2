// Import necessary modules
const jwt = require('jsonwebtoken');
const User = require('../models/User'); // Assuming you have a User model in the /models folder
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Replace the JWT_SECRET and MONGODB_URI with environment variables for better security
const JWT_SECRET = process.env.JWT_SECRET  // Fallback to hardcoded value if not found in .env

// Middleware for verifying JWT tokens
const verifyToken = async (req, res, next) => {
    const token = req.cookies.auth_token; // Retrieve token from cookies

    if (!token) {
        return res.status(403).json({ message: 'No token provided, authorization denied.' });
    }

    try {
        // Verify the JWT token using the secret key
        const decoded = jwt.verify(token, JWT_SECRET); 
        console.log('Decoded token:', decoded); // Log decoded token (you can remove this in production)

        // Attempt to find the user by decoded ID from the token
        const user = await User.findById(decoded.id); 
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        req.user = user;  // Attach the user object to the request for use in other routes
        next();  // Move to the next middleware or route handler
    } catch (error) {
        console.error('Token verification error:', error);

        // Handle specific JWT errors
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token expired. Please log in again.' });
        }

        // General JWT error
        res.status(401).json({ message: 'Token is not valid.' });
    }
};

module.exports = { verifyToken };
