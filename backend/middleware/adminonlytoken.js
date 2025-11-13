// verifyAdminToken.js
const jwt = require('jsonwebtoken');
const secretKey = 'f71af9c9edc6131f708dc6a589a5562fa5fc602ddcdd99091495684674fd42bd';  // Replace with your actual secret key

// Middleware to verify token and check if the user is an admin
function verifyAdminToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1]; // Assuming token is passed as 'Bearer <token>'

    if (!token) {
        return res.status(403).json({ message: 'Token is required' });
    }

    // Verify the token
    jwt.verify(token, secretKey, (err, decoded) => {
        if (err) {
            return res.status(401).json({ message: 'Invalid or expired token' });
        }

        // Check if the user has the 'admin' role
        if (decoded.role !== 'admin') {
            return res.status(403).json({ message: 'You do not have admin privileges' });
        }

        req.user = decoded;  // Attach the decoded user info to the request
        next();  // Proceed to the next middleware/route handler
    });
}

module.exports = verifyAdminToken;
