const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const moment = require('moment-timezone');
const crypto = require('crypto');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3000;

// Replace with your bot token
const token = process.env.BOT_TOKEN || '6750160592:AAH-hbeHm6mmswN571d3UeSkoX5v1ntvceQ';

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, { polling: true });

bot.on('polling_error', (error) => {
    console.error('Polling error:', error.code);
});
bot.on('webhook_error', (error) => {
    console.error('Webhook error:', error.code);
});

// PostgreSQL Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
    },
});

// Connect to PostgreSQL
pool.connect((err, client, done) => {
    if (err) {
        throw err;
    }
    console.log('Connected to PostgreSQL...');
    done();
});

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Generate auth code
const generateAuthCode = () => {
    return crypto.randomBytes(8).toString('hex');
};

// Insert user and referral function
const insertUserAndReferral = async (username, referralLink, telegramId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const insertQuery = `
            INSERT INTO users (username, points, tickets, referral_link, friends_invited, telegram_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING user_id, points, tickets
        `;
        const insertValues = [username, 0, 100, referralLink, 0, telegramId];
        const insertResult = await client.query(insertQuery, insertValues);

        const userId = insertResult.rows[0].user_id;
        const userReferralLink = `ref${userId}`;
        const authCode = generateAuthCode();

        await client.query('UPDATE users SET referral_link = $1, auth_code = $2 WHERE user_id = $3', [userReferralLink, authCode, userId]);

        console.log(`New user created with ID: ${userId}, referral link: ${userReferralLink}, auth code: ${authCode}`);

        await client.query('COMMIT');
        return { ...insertResult.rows[0], authCode };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error in insertUserAndReferral:', error);
        throw error;
    } finally {
        client.release();
    }
};

// On bot start or message event, save user information
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username;

    try {
        const client = await pool.connect();
        const existingUser = await client.query('SELECT * FROM users WHERE username = $1', [username]);

        if (existingUser.rows.length === 0) {
            // User does not exist, insert new user
            const referralLink = ''; // No referral link on initial bot start
            await insertUserAndReferral(username, referralLink, chatId);
            console.log(`New user saved: ${username} (Telegram ID: ${chatId})`);
        } else {
            // User exists, update their Telegram ID if not already set
            const existingTelegramId = existingUser.rows[0].telegram_id;
            if (!existingTelegramId) {
                await client.query('UPDATE users SET telegram_id = $1 WHERE username = $2', [chatId, username]);
            }
        }

        client.release();
    } catch (error) {
        console.error('Error saving user on bot start or message event:', error);
    }
});

// Endpoint to fetch initial user data (points and tickets)
app.get('/getUserData', async (req, res) => {
    try {
        const { username, referralLink } = req.query;

        if (!username) {
            return res.status(400).json({ success: false, error: 'Username is required' });
        }

        const client = await pool.connect();
        const result = await client.query('SELECT user_id, points, tickets FROM users WHERE username = $1', [username]);

        if (result.rows.length > 0) {
            res.status(200).json({ success: true, points: result.rows[0].points, tickets: result.rows[0].tickets });
        } else {
            const newUser = await insertUserAndReferral(username, referralLink);
            res.status(200).json({ success: true, points: newUser.points, tickets: newUser.tickets });
        }

        client.release();
    } catch (err) {
        console.error('Error in getUserData endpoint:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Endpoint to fetch referral link
app.get('/getReferralLink', async (req, res) => {
    try {
        const { username } = req.query;

        if (!username) {
            return res.status(400).json({ success: false, error: 'Username is required' });
        }

        const client = await pool.connect();
        const result = await client.query('SELECT referral_link FROM users WHERE username = $1', [username]);

        if (result.rows.length > 0) {
            const referralLink = result.rows[0].referral_link;
            res.status(200).json({ success: true, referralLink });
        } else {
            res.status(404).json({ success: false, error: 'Referral link not found for the user' });
        }

        client.release();
    } catch (err) {
        console.error('Error fetching referral link:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Endpoint to fetch top users
app.get('/topUsers', async (req, res) => {
    try {
        const topUsers = await fetchTopUsersFromDatabase();
        res.status(200).json(topUsers);
    } catch (error) {
        console.error('Error fetching top users:', error);
        res.status(500).json({ error: 'Failed to fetch top users' });
    }
});

async function fetchTopUsersFromDatabase() {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT username, points FROM users ORDER BY points DESC LIMIT 10');
        return result.rows;
    } finally {
        client.release();
    }
}

// Endpoint to handle saving Telegram usernames and points
app.post('/saveUser', async (req, res) => {
    const { username, points } = req.body;

    if (!username || points === undefined) {
        return res.status(400).send('Username and points are required');
    }

    try {
        const client = await pool.connect();
        const existingUser = await client.query('SELECT * FROM users WHERE username = $1', [username]);

        if (existingUser.rows.length > 0) {
            // User exists, update points
            const updateQuery = 'UPDATE users SET points = points + $1 WHERE username = $2 RETURNING points, tickets';
            const updateValues = [points, username];
            const result = await client.query(updateQuery, updateValues);
            client.release();
            res.status(200).json({ success: true, points: result.rows[0].points, tickets: result.rows[0].tickets });

            // Notify user via Telegram
            bot.sendMessage(existingUser.rows[0].telegram_id, `Your points have been updated. Current points: ${result.rows[0].points}`);
        } else {
            // User does not exist, insert new user
            const insertQuery = 'INSERT INTO users (username, points, tickets) VALUES ($1, $2, $3) RETURNING points, tickets';
            const insertValues = [username, points, 100]; // Default tickets set to 100
            const result = await client.query(insertQuery, insertValues);
            client.release();
            res.status(200).json({ success: true, points: result.rows[0].points, tickets: result.rows[0].tickets });
        }
    } catch (err) {
        console.error('Error saving user:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Endpoint to update tickets
app.post('/updateTickets', async (req, res) => {
    const { username, tickets } = req.body;

    if (!username || tickets === undefined) {
        return res.status(400).send('Username and tickets are required');
    }

    try {
        const client = await pool.connect();
        const updateQuery = 'UPDATE users SET tickets = $1 WHERE username = $2 RETURNING *';
        const updateValues = [tickets, username];
        const result = await client.query(updateQuery, updateValues);
        client.release();

        if (result.rows.length > 0) {
            res.status(200).json({ success: true, data: result.rows[0] });

            // Notify user via Telegram
            bot.sendMessage(result.rows[0].telegram_id, `Your tickets have been updated. Current tickets: ${result.rows[0].tickets}`);
        } else {
            res.status(404).json({ success: false, error: 'User not found' });
        }
    } catch (err) {
        console.error('Error updating tickets:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Schedule a task to reset tickets every day at midnight
cron.schedule('0 0 * * *', async () => {
    try {
        const client = await pool.connect();
        const resetQuery = 'UPDATE users SET tickets = 100';
        await client.query(resetQuery);
        client.release();
        console.log('Tickets reset to 100 for all users');
    } catch (err) {
        console.error('Error resetting tickets:', err);
    }
});

bot.onText(/\/start (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const authCode = match[1];
    const username = msg.from.username; // Get the Telegram username of the current user

    console.log(`Received /start command with authCode: ${authCode} from chatId: ${chatId}`);

    try {
        const client = await pool.connect();
        const result = await client.query('SELECT user_id, referral_link, telegram_id, username FROM users WHERE auth_code = $1', [authCode]);

        if (result.rows.length > 0) {
            const newUser = result.rows[0];
            const userId = newUser.user_id;
            const referralLink = newUser.referral_link;
            const referrerTelegramId = newUser.telegram_id;
            const referrerUsername = newUser.username;

            // Check if the user already exists in the database
            const existingUser = await client.query('SELECT * FROM users WHERE username = $1', [username]);

            if (existingUser.rows.length > 0) {
                // User already exists, inform them that they cannot be referred
                bot.sendMessage(chatId, `You are already a registered user and cannot be referred.`);
            } else {
                // Update the user's Telegram ID
                await client.query('UPDATE users SET telegram_id = $1, username = $2 WHERE user_id = $3', [chatId, username, userId]);

                // Increment friends_invited for the referrer
                await client.query('UPDATE users SET friends_invited = friends_invited + 1 WHERE referral_link = $1', [referralLink]);
                console.log(`Incremented friends_invited for referrer with referral link: ${referralLink}`);

                // Send a personalized welcome message to the new user
                bot.sendMessage(chatId, `Welcome, ${username}! You've successfully joined via referral.`);

                // If there's a referrer, inform the new user about their referrer
                if (referrerTelegramId !== chatId) {
                    bot.sendMessage(chatId, `You were referred by someone with Telegram username: ${referrerUsername}`);
                }
            }
        } else {
            // If the auth code doesn't match, or if the user doesn't exist in the database
            bot.sendMessage(chatId, `Welcome! You've successfully joined.`);
        }

        client.release();
    } catch (error) {
        console.error('Error processing /start command:', error);
        bot.sendMessage(chatId, 'An error occurred while processing your request. Please try again later.');
    }
});


// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
