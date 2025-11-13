const express = require('express');
const router = express.Router();
require('dotenv').config();

const User = require('../models/User')
const { verifyToken } = require('../middleware/authtoken'); // Assuming you have an auth middleware for token verification
const verifyAdminToken = require('../middleware/adminonlytoken');  // Adjust the path as needed

// Route to get the user's notifications
router.get('/notifications', verifyToken, async (req, res) => {
    try {
        // `req.user` is populated after token verification
        const user = req.user;
        
        // Assuming notifications are stored in an array in the user model
        const notifications = user.notifications;

        // Return the notifications to the client
        res.json(notifications);
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ message: 'Server error, could not fetch notifications.' });
    }
});

// Example route to clear notifications for the user
router.post('/clear-notifications', verifyToken, async (req, res) => {
    try {
      const user = await User.findById(req.userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
  
      user.notifications = []; // Clear the notifications
      await user.save();
  
      return res.status(200).json({ message: 'Notifications cleared' });
    } catch (error) {
      console.error('Error clearing notifications:', error);
      return res.status(500).json({ message: 'Server error' });
    }
  });
  
// POST route to send notification
router.post('/only-admin/send-notification', async (req, res) => {
    const { username, message } = req.body;

    // Ensure both username and message are provided
    if (!username || !message) {
        return res.status(400).json({ message: 'Username and message are required.' });
    }

    try {
        // Find the user by username
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        // Add the notification to the user's notifications array
        user.notifications.push({
            message,
            date: new Date(),
        });

        // Save the user with the new notification
        await user.save();

        res.status(200).json({ message: 'Notification sent successfully.' });
    } catch (error) {
        console.error('Error sending notification:', error);
        res.status(500).json({ message: 'Error sending notification.' });
    }
}); 

module.exports = router;