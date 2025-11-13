// routes/auth.js - With Prisma
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const nodemailer = require('nodemailer');
const moment = require('moment');

const prisma = new PrismaClient();

// Send OTP Email Helper
async function sendOTPEmail(email, otp) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Your OTP Verification Code',
        html: `
            <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 20px; }
                        .email-container { background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); padding: 30px; max-width: 600px; margin: 0 auto; }
                        h1 { font-size: 24px; color: #333333; margin-bottom: 10px; }
                        p { font-size: 16px; color: #666666; }
                        .otp-code { display: inline-block; font-size: 40px; font-weight: bold; color: #ffffff; background-color: #4CAF50; padding: 10px 20px; border-radius: 8px; margin-top: 20px; }
                        .footer { font-size: 12px; color: #999999; margin-top: 30px; text-align: center; }
                    </style>
                </head>
                <body>
                    <div class="email-container">
                        <h1>Your OTP Verification Code</h1>
                        <p>Dear user,</p>
                        <p>We have received a request to verify your identity. Please use the OTP code below to complete the process:</p>
                        <div class="otp-code">${otp}</div>
                        <p>This OTP code will expire in 5 minutes. If you did not request this, please ignore this email.</p>
                        <div class="footer">
                            <p>Thank you for using our service!</p>
                            <p>If you have any questions, feel free to contact our support team.</p>
                        </div>
                    </div>
                </body>
            </html>
        `
    };

    await transporter.sendMail(mailOptions);
}

// Register Route
exports.register = async (req, res) => {
    try {
        const { username, email, password, referralCode } = req.body;

        // Validation
        if (!username || !email || !password) {
            return res.status(400).json({ message: 'All fields are required' });
        }

        // Check if user exists
        const existingUser = await prisma.user.findFirst({
            where: {
                OR: [
                    { username: username },
                    { email: email }
                ]
            }
        });

        if (existingUser) {
            return res.status(400).json({ message: 'Username or email already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiration = moment().add(5, 'minutes').toDate();

        // Create user
        const newUser = await prisma.user.create({
            data: {
                username,
                email,
                password: hashedPassword,
                referralCode: username, // Use username as referral code
                referredBy: referralCode || null,
                otp,
                otpExpiration
            }
        });

        // Handle referral
        if (referralCode) {
            const referrer = await prisma.user.findUnique({
                where: { referralCode: referralCode }
            });

            if (referrer) {
                await prisma.referral.create({
                    data: {
                        userId: referrer.id,
                        referredUsername: username,
                        hasDeposited: false
                    }
                });
            }
        }

        // Send OTP email
        try {
            await sendOTPEmail(email, otp);
        } catch (error) {
            console.error('Error sending OTP:', error);
        }

        res.status(201).json({ 
            message: 'User registered successfully. Please verify your email with the OTP sent.',
            userId: newUser.id 
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Server error during registration' });
    }
};

// Login Route
exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: 'Username and password are required' });
        }

        // Find user
        const user = await prisma.user.findUnique({
            where: { username }
        });

        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Check if verified
        if (!user.verified) {
            return res.status(403).json({ message: 'Please verify your email first' });
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Generate JWT
        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Set cookie
        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        res.json({
            message: 'Login successful',
            username: user.username,
            balance: user.balance,
            xp: user.xp
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error during login' });
    }
};

// Logout Route
exports.logout = (req, res) => {
    res.clearCookie('auth_token');
    res.json({ message: 'Logged out successfully' });
};