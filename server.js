const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3000;

// Replace with your bot token
const token = process.env.BOT_TOKEN || '6750160592:AAH-hbeHm6mmswN571d3UeSkoX5v1ntvceQ';

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

// Endpoint to fetch initial user data (points and tickets)
app.get('/getUserData', async (req, res) => {
    try {
        const { username } = req.query;

        if (!username) {
            return res.status(400).json({ success: false, error: 'Username is required' });
        }

        const client = await pool.connect();
        const result = await client.query('SELECT points, tickets FROM users WHERE username = $1', [username]);

        if (result.rows.length > 0) {
            // User exists
            res.status(200).json({ success: true, points: result.rows[0].points, tickets: result.rows[0].tickets });
        } else {
            // User does not exist, insert new user with default values
            const insertQuery = 'INSERT INTO users (username, points, tickets) VALUES ($1, $2, $3) RETURNING points, tickets';
            const insertValues = [username, 0, 100];
            const insertResult = await client.query(insertQuery, insertValues);

            res.status(200).json({ success: true, points: insertResult.rows[0].points, tickets: insertResult.rows[0].tickets });
        }

        client.release();
    } catch (err) {
        console.error('Error in getUserData endpoint:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/topUsers', async (req, res) => {
    try {
        // Assuming you have a function to fetch top users from the database
        const topUsers = await fetchTopUsersFromDatabase(); // Implement this function
        
        // Respond with the top users data in JSON format
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
        return result.rows; // Assuming rows contain username and points
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
            const updateQuery = 'UPDATE users SET points = points + $1 WHERE username = $2 RETURNING *';
            const updateValues = [points, username];
            const result = await client.query(updateQuery, updateValues);
            client.release();
            res.status(200).json({ success: true, data: result.rows[0] });
        } else {
            // User does not exist, insert new user
            const insertQuery = 'INSERT INTO users (username, points) VALUES ($1, $2) RETURNING *';
            const insertValues = [username, points];
            const result = await client.query(insertQuery, insertValues);
            client.release();
            res.status(200).json({ success: true, data: result.rows[0] });
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
        } else {
            res.status(404).json({ success: false, error: 'User not found' });
        }
    } catch (err) {
        console.error('Error updating tickets:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Telegram Bot Functionality

// Handle /start command
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;

    const options = {
        caption: `🎵 MelodyMint Revolution 🎵

🌟 We are transforming how the world interacts with music by integrating it with Web3 technologies. 🌟

💥 What We're Doing:

Tokens: Earn and trade tokens by interacting with music like never before.
Web3 Integration: Transfer your music into the blockchain, giving sound a real money value.

🎟️ Don't forget: You earn 10 tickets every day for playing the game! 🎟️`,
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Play', url: miniAppUrl }]
            ]
        }
    };

    bot.sendPhoto(chatId, imagePath, options);
});

// Daily Task: Increase tickets by 10 for every user
cron.schedule('29 18 * * *', async () => {
    try {
        const client = await pool.connect();
        const updateQuery = 'UPDATE users SET tickets = tickets + 10 RETURNING *';
        const result = await client.query(updateQuery);
        client.release();

        console.log(`Increased tickets for ${result.rowCount} users.`);
    } catch (error) {
        console.error('Error increasing tickets:', error);
    }
});

// Log any errors
bot.on('polling_error', (error) => {
    console.log(error.code);  // => 'EFATAL'
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
