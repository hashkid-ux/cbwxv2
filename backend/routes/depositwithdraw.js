// depositWithdrawRoutes.js
const express = require('express');
const router = express.Router();
const Deposit = require('../models/deposit'); // Deposit model
const User = require('../models/User'); // User model

// Middleware to check admin token
const verifyAdminToken = require('../middleware/adminonlytoken')

// Route to get all deposits (for admin)
router.get('/admin/deposits', verifyAdminToken, async (req, res) => {
    try {
        const deposits = await Deposit.find();

        // Ensure each deposit has a screenshot object and include checked property
        const formattedDeposits = deposits.map(deposit => ({
            username: deposit.username,
            amount: deposit.amount,
            utn: deposit.utn,
            screenshot: deposit.screenshot || { data: '', contentType: '' }, // Provide default values
            checked: deposit.checked // Include the checked property
        }));

        return res.status(200).json(formattedDeposits);
    } catch (error) {
        console.error('Error fetching deposits:', error);
        return res.status(500).json({ error: 'An error occurred while fetching deposits.' });
    }
});
router.post('/admin/deposit', verifyAdminToken, async (req, res) => {
    const { username, amount } = req.body;

    if (!username || !amount) {
        return res.status(400).json({ error: "Username and amount are required." });
    }

    try {
        // Find the user making the deposit
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ error: "User not found." });
        }

        // Update user balance
        user.balance += amount;

        // Create a new transaction record for the deposit
        user.transactions.push({
            amount,
            type: 'Deposit',
            date: new Date()  // Using new Date() to store the current date and time
        });

        // Check if this is the user's first deposit
        if (!user.firstDeposit) {
            // Set first deposit flag
            user.firstDeposit = true;

            // Award XP for the first deposit
            user.xp += 1;

            // Initialize rewards for the user based on XP milestones
            user.initializeRewards();  // Call method to initialize rewards

            // Check if the user was referred
            if (user.referredBy) {
                const referrer = await User.findOne({ username: user.referredBy });
                if (referrer) {
                    // Update the referral status in the referrer's referrals array
                    const referral = referrer.referrals.find(r => r.referredUsername === username);
                    if (referral) {
                        referral.hasDeposited = true;  // Mark the referred user as deposited
                    }
                    referrer.balance += 5;  // Add reward directly to balance
                    referrer.transactions.push({
                        amount: 5,
                        type: 'Referral Reward'
                    });

                    // Save the referrer with updated referral status and reward
                    await referrer.save();
                }
            }
        }

        // Save the updated user document
        await user.save();

        return res.status(200).json({ message: "Deposit successful." });
    } catch (error) {
        console.error('Error processing the deposit:', error);
        return res.status(500).json({ error: "An error occurred while processing the deposit." });
    }
});

// Admin verification route
router.post('/admin/verify', verifyAdminToken, (req, res) => {
    // If the verifyAdminToken middleware is passed, the user is an admin
    return res.json({ isAdmin: true });
});

module.exports = router;
