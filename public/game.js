document.addEventListener('DOMContentLoaded', async () => {
    const preloadImages = () => {
        const images = ['home.png', 'tasks.png', 'airdrop.png'];
        images.forEach((src) => {
            const img = new Image();
            img.src = src;
        });
    };
    preloadImages();

    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const backgroundMusic = new Audio('background-music.mp3');
    backgroundMusic.loop = true;
    backgroundMusic.volume = 0.5;

    const startScreen = document.getElementById('startScreen');
    const playButton = document.getElementById('playButton');
    const tasksButton = document.getElementById('tasksButton');
    const upgradeButton = document.getElementById('upgradeButton');
    const referralButton = document.getElementById('referralButton');
    const userInfo = document.getElementById('userInfo');
    const footer = document.getElementById('footer');
    const userPoints = document.getElementById('points');
    const userTickets = document.getElementById('ticketsInfo');
    const header = document.getElementById('header');

    // Initialize Telegram Web Apps API
    const tg = window.Telegram.WebApp;
    const user = tg.initDataUnsafe?.user;

    // Set username or fallback to "Username"
    if (user) {
        userInfo.textContent = user.username || ${user.first_name} ${user.last_name};
    } else {
        userInfo.textContent = 'Username';
    }

    let points = 0;
    let tickets = 0;
    let referralLink = '';

    // Fetch initial user data (points, tickets, referral link)
    const fetchUserData = async () => {
        try {
            const response = await fetch(/getUserData?username=${encodeURIComponent(userInfo.textContent)});
            const data = await response.json();
            if (data.success) {
                points = data.points;
                tickets = data.tickets;
                referralLink = data.referral_link;
                userPoints.textContent = ` ${points}`;
                userTickets.textContent = ` ${tickets}`;
            } else {
                console.error('Failed to fetch user data:', data.error);
            }
        } catch (error) {
            console.error('Error fetching user data:', error);
        }
    };

    fetchUserData();

    playButton.addEventListener('click', async () => {
        if (tickets > 0) {
            tickets--;
            userTickets.textContent = ` ${tickets}`;

            // Update tickets on the server
            try {
                const response = await fetch('/updateTickets', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username: userInfo.textContent, tickets }),
                });

                const result = await response.json();
                if (!result.success) {
                    console.error('Error updating tickets:', result.error);
                }
            } catch (error) {
                console.error('Error updating tickets:', error);
            }
        } else {
            alert('No more tickets available!');
            return;
        }

        startScreen.style.display = 'none';
        footer.style.display = 'none';
        header.style.display = 'none';
        startMusic();
        initGame();
        lastTimestamp = performance.now();
        requestAnimationFrame(gameLoop);
    });

    tasksButton.addEventListener('click', () => {
        alert('Tasks: Coming Soon!');
    });

    upgradeButton.addEventListener('click', () => {
        alert('Upgrade: Coming Soon!');
    });

    referralButton.addEventListener('click', () => {
        if (referralLink) {
            tg.openLink(referralLink);
        } else {
            alert('Referral link is not available.');
        }
    });

    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;

    const TILE_COLOR = '#2F3C7E';
    const BORDER_COLOR = '#FBEAEB';
    const SKY_BLUE = '#87CEEB';
    const SHADOW_COLOR = '#000080';

    const COLUMNS = 4;
    const SEPARATOR = 0; // No space between tiles
    const VERTICAL_GAP = 5;
    const TILE_WIDTH = (WIDTH - (COLUMNS - 1) * SEPARATOR) / COLUMNS;
    const TILE_HEIGHT = HEIGHT / 4 - VERTICAL_GAP;

    let TILE_SPEED;
    const SPEED_INCREMENT = 0.0018;

    let tiles = [];
    let score = 0;
    let gameRunning = true;

    class Tile {
        constructor(x, y) {
            this.x = x;
            this.y = y;
            this.width = TILE_WIDTH;
            this.height = TILE_HEIGHT;
            this.clicked = false;
            this.opacity = 1;
        }

        move(speed) {
            this.y += speed;
        }

        draw() {
            const gradient = ctx.createLinearGradient(this.x, this.y, this.x + this.width, this.y + this.height);
            gradient.addColorStop(0, '#2F3C7E');
            gradient.addColorStop(1, '#FF6F61');
            ctx.fillStyle = gradient;
            ctx.globalAlpha = this.opacity;
            ctx.fillRect(this.x, this.y, this.width, this.height);
            ctx.globalAlpha = 1;
        }

        isClicked(mouseX, mouseY) {
            return this.x <= mouseX && this.x + this.width >= mouseX &&
                   this.y <= mouseY && this.y + this.height >= mouseY;
        }

        isOutOfBounds() {
            return this.y + this.height >= HEIGHT && !this.clicked;
        }

        startDisappearing() {
            this.clicked = true;
            this.opacity -= 0.05;
        }

        updateOpacity() {
            if (this.clicked && this.opacity > 0) {
                this.opacity -= 0.05;
            }
        }
    }

    function initGame() {
        tiles = [];
        for (let i = 0; i < 4; i++) {
            const x = Math.floor(Math.random() * COLUMNS) * (TILE_WIDTH + SEPARATOR);
            const y = -(i * (TILE_HEIGHT + VERTICAL_GAP)) - TILE_HEIGHT;
            tiles.push(new Tile(x, y));
        }
        score = 0;
        TILE_SPEED = 4;
        gameRunning = true;

        backgroundMusic.play().catch(function(error) {
            console.error('Error playing audio:', error);
        });
    }

    function isMobileDevice() {
        return /Mobi|Android/i.test(navigator.userAgent);
    }

    function addNewTile() {
        const attempts = 100;
        const lastColumn = tiles.length > 0 ? Math.floor(tiles[tiles.length - 1].x / (TILE_WIDTH + SEPARATOR)) : -1;

        for (let i = 0; i < attempts; i++) {
            const x = Math.floor(Math.random() * COLUMNS) * (TILE_WIDTH + SEPARATOR);
            const y = -TILE_HEIGHT;

            if (Math.floor(x / (TILE_WIDTH + SEPARATOR)) !== lastColumn) {
                tiles.push(new Tile(x, y));
                break;
            }
        }
    }

    function startMusic() {
        backgroundMusic.play().catch(function(error) {
            console.error('Error playing audio:', error);
        });
    }

    let lastTimestamp = 0;

    function gameLoop(timestamp) {
        if (!gameRunning) return;

        const delta = timestamp - lastTimestamp;
        lastTimestamp = timestamp;

        ctx.clearRect(0, 0, WIDTH, HEIGHT);

        tiles.forEach(tile => {
            tile.move(TILE_SPEED);
            tile.updateOpacity();
            tile.draw();
        });

        if (tiles[tiles.length - 1].y >= TILE_HEIGHT + VERTICAL_GAP) {
            addNewTile();
            TILE_SPEED += SPEED_INCREMENT;
        }

        if (tiles[0].isOutOfBounds()) {
            endGame();
        }

        tiles = tiles.filter(tile => tile.opacity > 0);

        requestAnimationFrame(gameLoop);
    }

    function endGame() {
        gameRunning = false;
        alert(Game Over! Your score: ${score});

        backgroundMusic.pause();
        backgroundMusic.currentTime = 0;
    }

    canvas.addEventListener('click', (event) => {
        if (!gameRunning) return;

        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        for (let tile of tiles) {
            if (!tile.clicked && tile.isClicked(mouseX, mouseY)) {
                score++;
                tile.startDisappearing();
                break;
            }
        }
    });

    if (isMobileDevice()) {
        canvas.addEventListener('touchstart', (event) => {
            if (!gameRunning) return;

            const rect = canvas.getBoundingClientRect();
            const touchX = event.touches[0].clientX - rect.left;
            const touchY = event.touches[0].clientY - rect.top;

            for (let tile of tiles) {
                if (!tile.clicked && tile.isClicked(touchX, touchY)) {
                    score++;
                    tile.startDisappearing();
                    break;
                }
            }
        });
    }
});
