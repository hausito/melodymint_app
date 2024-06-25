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
        userInfo.textContent = user.username || `${user.first_name} ${user.last_name}`;
    } else {
        userInfo.textContent = 'Username';
    }

    let points = 0;
    let tickets = 0;
    let referralLink = ''; // Variable to hold referral link

    // Fetch initial user data (points, tickets, and referral link)
    const fetchUserData = async () => {
        try {
            const response = await fetch(`/getUserData?username=${encodeURIComponent(userInfo.textContent)}`);
            const data = await response.json();
            if (data.success) {
                points = data.points;
                tickets = data.tickets;
                referralLink = data.referral_link; // Assuming this is how referral link is retrieved
                userPoints.textContent = `Points: ${points}`;
                userTickets.textContent = `Tickets: ${tickets}`;
                // Update referral link in HTML
                updateReferralLink(referralLink);
            } else {
                console.error('Failed to fetch user data:', data.error);
            }
        } catch (error) {
            console.error('Error fetching user data:', error);
        }
    };

    fetchUserData();

    // Function to update referral link in HTML
    const updateReferralLink = (link) => {
        // Assuming there's an element with id 'referralLink' in your HTML
        const referralLinkElement = document.getElementById('referralLink');
        if (referralLinkElement) {
            referralLinkElement.textContent = link;
        }
    };

    playButton.addEventListener('click', async () => {
        if (tickets > 0) {
            tickets--;
            userTickets.textContent = `Tickets: ${tickets}`;

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
        TILE_SPEED = 1.5;
        gameRunning = true;
    }

    function drawBackground() {
        const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
        gradient.addColorStop(0, SKY_BLUE);
        gradient.addColorStop(1, '#FF6F61');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }

    function drawSeparator() {
        ctx.strokeStyle = BORDER_COLOR;
        ctx.lineWidth = SEPARATOR;
        for (let i = 1; i < COLUMNS; i++) {
            const x = i * TILE_WIDTH + (i - 1) * SEPARATOR + SEPARATOR / 2;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, HEIGHT);
            ctx.stroke();
        }
    }

    function drawScore() {
        ctx.fillStyle = SHADOW_COLOR;
        ctx.font = '20px Arial';
        ctx.textAlign = 'right';
        ctx.fillText(`Score: ${score}`, WIDTH - 10, 30);
    }

    let lastTimestamp;
    function gameLoop(timestamp) {
        const delta = timestamp - lastTimestamp;
        lastTimestamp = timestamp;

        drawBackground();
        drawSeparator();

        if (gameRunning) {
            tiles.forEach(tile => {
                tile.move(TILE_SPEED);
                tile.draw();
                tile.updateOpacity();

                if (tile.isOutOfBounds()) {
                    gameRunning = false;
                }
            });

            TILE_SPEED += SPEED_INCREMENT;
            if (tiles.length > 0 && tiles[tiles.length - 1].y > 0) {
                const x = Math.floor(Math.random() * COLUMNS) * (TILE_WIDTH + SEPARATOR);
                const y = -TILE_HEIGHT;
                tiles.push(new Tile(x, y));
            }

            if (!gameRunning) {
                alert(`Game over! Your score is ${score}`);
                saveGameResult(score);
                startScreen.style.display = 'block';
                footer.style.display = 'flex';
                header.style.display = 'flex';
                backgroundMusic.pause();
            }
        }

        drawScore();
        requestAnimationFrame(gameLoop);
    }

    canvas.addEventListener('click', (event) => {
        const mouseX = event.offsetX;
        const mouseY = event.offsetY;

        for (const tile of tiles) {
            if (tile.isClicked(mouseX, mouseY) && !tile.clicked) {
                tile.startDisappearing();
                score++;
                break;
            }
        }
    });

    const startMusic = () => {
        backgroundMusic.currentTime = 0;
        backgroundMusic.play();
    };

    const saveGameResult = async (score) => {
        try {
            const response = await fetch('/saveGameResult', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username: userInfo.textContent, score }),
            });

            const result = await response.json();
            if (!result.success) {
                console.error('Error saving game result:', result.error);
            } else {
                points += score; // Assuming score is added to points
                userPoints.textContent = `Points: ${points}`;
            }
        } catch (error) {
            console.error('Error saving game result:', error);
        }
    };

    // Modal functionality
    function showReferralLink() {
        const modal = document.getElementById('myModal');
        const modalContent = document.getElementById('modalContent');
        modalContent.textContent = referralLink;  // Use the referral link fetched from the server
        modal.style.display = 'block';
    }

    function closeModal() {
        const modal = document.getElementById('myModal');
        modal.style.display = 'none';
    }

    // Close the modal when clicking outside of it
    window.onclick = function(event) {
        const modal = document.getElementById('myModal');
        if (event.target == modal) {
            modal.style.display = 'none';
        }
    }
});
