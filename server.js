const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const moment = require('moment-timezone');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3000;

// Replace with your bot token
const token = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, { polling: true });

// Replace with your image path or URL if hosted
const imagePath = path.join(__dirname, 'photo1.jpg');

// Replace with your mini-app link
const miniAppUrl = 'https://t.me/melodymint_bot/melodymint';

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

// Function to handle inserting a new user and updating referrer
const crypto = require('crypto');

const generateAuthCode = () => {
    return crypto.randomBytes(8).toString('hex');
};

const insertUserAndReferral = async (username, referralLink) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const insertQuery = `
            INSERT INTO users (username, points, tickets, referral_link, friends_invited)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING user_id, points, tickets
        `;
        const insertValues = [username, 0, 100, '', 0];
        const insertResult = await client.query(insertQuery, insertValues);

        const userId = insertResult.rows[0].user_id;
        const userReferralLink = `ref${userId}`;
        const authCode = generateAuthCode();

        await client.query('UPDATE users SET referral_link = $1, auth_code = $2 WHERE user_id = $3', [userReferralLink, authCode, userId]);

        if (referralLink) {
            const referrerId = parseInt(referralLink.replace('https://t.me/melodymint_bot/ref', ''), 10);
            if (!isNaN(referrerId)) {
                const referrerCheck = await client.query('SELECT user_id FROM users WHERE user_id = $1', [referrerId]);
                if (referrerCheck.rows.length > 0) {
                    await client.query('UPDATE users SET friends_invited = friends_invited + 1 WHERE user_id = $1', [referrerId]);
                    console.log(`Incremented friends_invited for referrer ID: ${referrerId}`);
                } else {
                    console.log(`Referrer ID ${referrerId} not found`);
                }
            }
        }

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
        const topUsers = await fetchTopUsersFromDatabase(); // Implement this function
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


// Telegram Bot Functionality

app.get('/generateReferralLink', async (req, res) => {
    try {
        const { username } = req.query;

        if (!username) {
            return res.status(400).json({ success: false, error: 'Username is required' });
        }

        const client = await pool.connect();
        const result = await client.query('SELECT auth_code FROM users WHERE username = $1', [username]);

        if (result.rows.length > 0) {
            const authCode = result.rows[0].auth_code;
            const referralLink = `https://t.me/melodymint_bot?start=${authCode}`;
            res.status(200).json({ success: true, referralLink });
        } else {
            res.status(404).json({ success: false, error: 'User not found' });
        }

        client.release();
    } catch (err) {
        console.error('Error generating referral link:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});




// Telegram Bot Functionality

// Handle /start command
bot.onText(/\/start (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const authCode = match[1];

    if (authCode) {
        try {
            const client = await pool.connect();
            const result = await client.query('SELECT user_id, username FROM users WHERE auth_code = $1', [authCode]);

            if (result.rows.length > 0) {
                const userId = result.rows[0].user_id;
                const username = result.rows[0].username;

                // Invalidate the auth code
                await client.query('UPDATE users SET auth_code = NULL WHERE user_id = $1', [userId]);

                bot.sendMessage(chatId, `Welcome, ${username}! You've successfully joined via referral.`);
            } else {
                bot.sendMessage(chatId, 'Invalid referral link.');
            }

            client.release();
        } catch (err) {
            console.error('Error handling /start command:', err);
            bot.sendMessage(chatId, 'An error occurred while processing your referral link.');
        }
    } else {
        bot.sendMessage(chatId, 'Invalid referral link.');
    }
});

// Daily Task: Increase tickets by 10 for every user
moment.tz.setDefault('Europe/Bucharest');

// Schedule cron job with timezone and adjusted time
cron.schedule('0 9 * * *', async () => {
    try {
        const client = await pool.connect();
        const updateQuery = 'UPDATE users SET tickets = tickets + 10 RETURNING *';
        const result = await client.query(updateQuery);
        client.release();

        console.log(`Increased tickets for ${result.rowCount} users.`);

        // Notify users via Telegram
        const users = await client.query('SELECT telegram_id FROM users');
        users.rows.forEach(user => {
            bot.sendMessage(user.telegram_id, `Your tickets have been updated. Current tickets: ${result.rows[0].tickets}`);
        });
    } catch (error) {
        console.error('Error increasing tickets:', error);
    }
}, {
    timezone: 'Europe/Bucharest'
});



// Log any errors
bot.on('polling_error', (error) => {
    console.log(error.code);  // => 'EFATAL'
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
