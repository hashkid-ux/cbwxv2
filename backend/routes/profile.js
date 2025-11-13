const express = require('express');
const router = express.Router();
require('dotenv').config();
const bcrypt = require('bcryptjs');

// Import the feedback model

const User = require('../models/User'); // Adjust path as needed
const Feedback = require('../models/feedbackModel');
const { verifyToken } = require('../middleware/authtoken'); // Assuming you have an auth middleware for token verification

// XP Milestones data (defined for different XP thresholds)
const xpMilestones = [
    { xp: 1025, rewardAmount: 200 },
    { xp: 3075, rewardAmount: 300 },
    { xp: 9225, rewardAmount: 500 },
    { xp: 27675, rewardAmount: 3000 },
    { xp: 83025, rewardAmount: 12000 },
    { xp: 249075, rewardAmount: 43000 },
    { xp: 747225, rewardAmount: 65000 },
    { xp: 2241675, rewardAmount: 160000 },
    { xp: 6725025, rewardAmount: 230000 },
    { xp: 20175074, rewardAmount: 540000 }
];

// GET route to fetch profile data with user details
router.get('/profile/:username', async (req, res) => {
    const { username } = req.params;
    console.log('Fetching profile for username:', username);

    try {
        const user = await User.findOne({ username }).select('username xp balance level rewards profile');
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Filter rewards based on XP or claimed status
        const eligibleAndClaimedRewards = user.rewards.filter(reward => 
            user.xp >= reward.xpRequired || reward.claimed
        ).map(reward => ({
            ...reward.toObject(),
            eligible: user.xp >= reward.xpRequired && !reward.claimed // Eligibility check for unclaimed rewards
        }));

        // Send profile data, including profile picture (based on the pictureName field)
        res.json({
            username: user.username,
            xp: user.xp,
            balance: user.balance,
            xpProgress: (user.xp / user.levelRequired) * 100, // Example XP progress calculation
            profilePicture: user.profile.pictureName, // Send the picture name
            rewards: eligibleAndClaimedRewards
        });
    } catch (error) {
        console.error('Error fetching profile:', error);
        res.status(500).json({ message: 'Error fetching profile. Please try again later.' });
    }
});
// PUT route to update profile picture
router.post('/profile/image', verifyToken, async (req, res) => {
    try {
        // The username is extracted from the token by the verifyToken middleware
        const username = req.user.username; // Assuming `verifyToken` middleware adds `username` to `req.user`

        // Get the profile picture from the request body (which should be sent from the front-end)
        const { profilePicture } = req.body;

        // Check if the profile picture is provided
        if (!profilePicture) {
            return res.status(400).json({ message: 'Profile picture not provided' });
        }

        // Remove the file extension from the profile picture name (e.g., 'picture.jpg' -> 'picture')
        const profilePictureName = profilePicture.split('.').slice(0, -1).join('.'); // Remove extension (.jpg, .png, etc.)

        // Find the user by the username (which is set from the token)
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Update the user's profile picture name (without the extension)
        user.profile.pictureName = profilePictureName;

        // Save the updated user document
        await user.save();

        res.status(200).json({ message: 'Profile picture updated successfully' });
    } catch (error) {
        console.error('Error updating profile picture:', error);
        res.status(500).json({ message: 'Error updating profile picture' });
    }
});

// POST route for claiming a reward
router.post('/claim-reward', async (req, res) => {
    const { username, xpRequired } = req.body;
    
    try {
        // Find the user by username
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Check if the user's XP is sufficient to claim the reward
        if (user.xp < xpRequired) {
            return res.status(400).json({ message: `You need ${xpRequired} XP to claim this reward. You have only ${user.xp} XP.` });
        }

        // Find the reward associated with the required XP
        const reward = user.rewards.find(r => r.xpRequired === xpRequired);
        if (!reward) return res.status(400).json({ message: 'No reward available for this XP milestone.' });
        
        // Check if the reward has already been claimed
        if (reward.claimed) {
            return res.status(400).json({ message: 'Reward already claimed.' });
        }

        // Mark the reward as claimed and update the user's balance
        reward.claimed = true;
        user.balance += reward.rewardAmount;

        // Add a transaction entry for the reward
        user.transactions.push({
            amount: reward.rewardAmount,
            type: 'Reward',
            date: new Date()
        });

        // Save the updated user data
        await user.save();

        // Respond with the success message
        res.json({
            message: `Reward of Rs. ${reward.rewardAmount} claimed successfully!`,
            rewardAmount: reward.rewardAmount
        });
    } catch (error) {
        res.status(500).json({ message: 'Error claiming reward', error: error.message });
    }
});

// GET route to fetch user's XP and next reward milestone by username
router.get('/xp-status/:username', async (req, res) => {
    const { username } = req.params;
    
    try {
        const user = await User.findOne({ username }).select('xp');
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Find next XP milestone based on user's current XP
        const nextMilestone = xpMilestones.find(milestone => milestone.xp > user.xp);
        res.json({
            currentXp: user.xp,
            nextMilestone: nextMilestone || null // If no milestone exists, return null
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching XP status', error: error.message });
    }
});

// Route to handle feedback submission
router.post('/feedback', async (req, res) => {
    const { name, email, message } = req.body;

    try {
        // Create a new feedback entry
        const newFeedback = new Feedback({
            name,
            email,
            message
        });

        // Save feedback to the database
        await newFeedback.save();

        console.log('Received feedback:', { name, email, message });
        res.status(200).json({ message: 'Feedback submitted successfully' });
    } catch (error) {
        console.error('Error processing feedback:', error);
        res.status(500).json({ message: 'Error submitting feedback' });
    }
});
// Route to handle password reset (using current password and new password)
router.post('/reset-password', verifyToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    try {
        // Check if the current password and new password are the same
        if (currentPassword === newPassword) {
            return res.status(400).json({ message: 'New password cannot be the same as the current password' });
        }

        // Get the user from the token (user is attached in the verifyToken middleware)
        const user = await User.findById(req.user._id);  // req.user is populated by verifyToken
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Check if the current password matches the stored password
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Current password is incorrect' });
        }

        // Hash the new password before saving it
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;

        // Save the updated password
        await user.save();

        res.status(200).json({ message: 'Password reset successfully' });
    } catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({ message: 'Error resetting password. Please try again later.' });
    }
});

module.exports = router;
