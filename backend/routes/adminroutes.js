// adminRoutes.js
const express = require('express');
const jwt = require('jsonwebtoken');
const verifyAdminToken = require('../middleware/adminonlytoken');

const router = express.Router();
const secretKey = 'f71af9c9edc6131f708dc6a589a5562fa5fc602ddcdd99091495684674fd42bd';  // Replace with your actual secret key
const adminPassword = 'Dekhomat@2008#16Hashkid';  // Replace with the actual admin password

// Route for admin login and token generation
router.post('/login', (req, res) => {
    const { password } = req.body;

    // Check if the password is correct
    if (password === adminPassword) {
        // Generate JWT token with admin privileges
        const token = jwt.sign({ role: 'admin' }, secretKey, { expiresIn: '1h' });
        return res.json({ token });
    } else {
        return res.status(401).json({ message: 'Incorrect password' });
    }
});

// Example protected route for admin
router.get('/dashboard', verifyAdminToken, (req, res) => {
    res.json({ message: 'Welcome to the admin dashboard' });
});

module.exports = router;
