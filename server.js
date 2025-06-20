const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);

// **תיקון עיקרי לRender**: יצירת WebSocket Server על אותו שרת HTTP
const wss = new WebSocket.Server({ 
    server: server,  // חובה לRender - אותו שרת HTTP
    perMessageDeflate: false,
    clientTracking: true
});

// הגשת קבצים סטטיים
app.use(express.static(path.join(__dirname)));

// Headers לRender
app.use((req, res, next) => {
    res.header('Connection', 'keep-alive');
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// **תיקון**: Health check endpoint לRender
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        activeGames: games.size,
        totalConnections: wss.clients.size
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// הגדרות המשחק
const TILES_PER_PLAYER = 7;
const LETTER_DISTRIBUTION = {
    'א': { count: 6, points: 2 },
    'ב': { count: 4, points: 3 },
    'ג': { count: 2, points: 5 },
    'ד': { count: 4, points: 3 },
    'ה': { count: 8, points: 1 },
    'ו': { count: 12, points: 1 },
    'ז': { count: 1, points: 8 },
    'ח': { count: 3, points: 4 },
    'ט': { count: 1, points: 8 },
    'י': { count: 10, points: 1 },
    'כ': { count: 2, points: 5 },
    'ל': { count: 6, points: 2 },
    'מ': { count: 6, points: 2 },
    'נ': { count: 4, points: 3 },
    'ס': { count: 1, points: 8 },
    'ע': { count: 2, points: 5 },
    'פ': { count: 3, points: 4 },
    'צ': { count: 1, points: 8 },
    'ק': { count: 3, points: 4 },
    'ר': { count: 8, points: 1 },
    'ש': { count: 6, points: 2 },
    'ת': { count: 9, points: 1 },
    '': { count: 2, points: 0 } // Jokers
};


// משחקים פעילים
const games = new Map();

class ScrabbleGame {
    constructor(roomId) {
        this.roomId = roomId;
        this.players = new Map();
        this.board = Array(15).fill().map(() => Array(15).fill(null));
        this.tileBag = this.createTileBag();
        this.currentPlayerIndex = 0;
        this.turnOrder = [];
        this.gameStarted = false;
        this.consecutivePasses = 0;
        this.lastActivity = Date.now(); // **תיקון**: מעקב אחר פעילות
    }
    
    createTileBag() {
        const bag = [];
        for (const [letter, data] of Object.entries(LETTER_DISTRIBUTION)) {
            for (let i = 0; i < data.count; i++) {
                bag.push(letter);
            }
        }
        return this.shuffleArray(bag);
    }
    
    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }
    
    addPlayer(playerId, playerName, ws) {
        // **תיקון**: בדיקת מגבלת שחקנים
        if (this.players.size >= 4) {
            return null; // חדר מלא
        }

        const player = {
            id: playerId,
            name: playerName || 'שחקן אנונימי',
            score: 0,
            tiles: [],
            ws: ws,
            joinTime: Date.now()
        };
        
        this.players.set(playerId, player);
        this.turnOrder.push(playerId);
        this.lastActivity = Date.now();
        
        // חלוקת אותיות התחלתיות
        this.dealTiles(playerId, TILES_PER_PLAYER);
        
        // **תיקון**: התחלת המשחק אם יש לפחות שחקן אחד (למצב דמו) או שניים
        if (this.players.size >= 1 && !this.gameStarted) {
            this.startGame();
        }
        
        return player;
    }
    
    removePlayer(playerId) {
        const player = this.players.get(playerId);
        if (player) {
            // החזרת אותיות לשק
            this.tileBag.push(...player.tiles);
            this.tileBag = this.shuffleArray(this.tileBag);
            
            this.players.delete(playerId);
            this.turnOrder = this.turnOrder.filter(id => id !== playerId);
            
            // **תיקון**: עדכון אינדקס השחקן הנוכחי
            if (this.currentPlayerIndex >= this.turnOrder.length && this.turnOrder.length > 0) {
                this.currentPlayerIndex = 0;
            }
            
            this.lastActivity = Date.now();
        }
        
        return player;
    }
    
    startGame() {
        this.gameStarted = true;
        this.currentPlayerIndex = 0;
        this.lastActivity = Date.now();
        console.log(`Game started in room ${this.roomId} with ${this.players.size} players`);
    }
    
    getCurrentPlayer() {
        if (this.turnOrder.length === 0) return null;
        return this.turnOrder[this.currentPlayerIndex];
    }
    
    dealTiles(playerId, count) {
        const player = this.players.get(playerId);
        if (!player) return [];
        
        const newTiles = [];
        for (let i = 0; i < count && this.tileBag.length > 0; i++) {
            const tile = this.tileBag.pop();
            newTiles.push(tile);
            player.tiles.push(tile);
        }
        
        return newTiles;
    }
    
    playWord(playerId, tiles, score) {
        const player = this.players.get(playerId);
        if (!player || this.getCurrentPlayer() !== playerId) {
            return { success: false, error: 'לא התור שלך' };
        }
        
        // **תיקון**: בדיקת תקינות האותיות
        if (!tiles || tiles.length === 0) {
            return { success: false, error: 'לא הוגדרו אותיות' };
        }
        
        // **תיקון קריטי לג'וקרים**: הסרת האותיות שהשתמשו בהן מהשחקן
        console.log(`Player ${playerId} tiles before: ${player.tiles.length}`);
        console.log(`Removing ${tiles.length} tiles`);
        
        // ספירת כמה אותיות להסיר (כולל ג'וקרים)
        let tilesToRemove = tiles.length;
        let removed = 0;
        
        // הסרת האותיות על בסיס המיקום והתוכן
        tiles.forEach(playedTile => {
            if (removed >= tilesToRemove) return;
            
            let tileIndex = -1;
            
            // **תיקון מיוחד לג'וקרים**
            if (playedTile.isJoker) {
                // מצא ג'וקר במגש (אות ריקה או אובייקט עם letter: "")
                tileIndex = player.tiles.findIndex(tile => {
                    if (typeof tile === 'string') {
                        return tile === '';
                    }
                    if (typeof tile === 'object') {
                        return tile.letter === '' || tile.letter === null;
                    }
                    return false;
                });
                console.log(`Looking for joker, found at index: ${tileIndex}`);
            } else {
                // אות רגילה
                const targetLetter = playedTile.letter;
                tileIndex = player.tiles.findIndex(tile => {
                    if (typeof tile === 'string') {
                        return tile === targetLetter;
                    }
                    if (typeof tile === 'object') {
                        return tile.letter === targetLetter;
                    }
                    return false;
                });
                console.log(`Looking for letter '${targetLetter}', found at index: ${tileIndex}`);
            }
            
            if (tileIndex !== -1) {
                const removedTile = player.tiles.splice(tileIndex, 1)[0];
                removed++;
                console.log(`Removed tile at index ${tileIndex}:`, removedTile);
            } else {
                console.warn(`Could not find tile to remove:`, playedTile);
            }
        });
        
        console.log(`Player ${playerId} tiles after removal: ${player.tiles.length} (removed ${removed})`);
        
        // הצבת האותיות על הלוח
        tiles.forEach(tile => {
            if (tile.row >= 0 && tile.row < 15 && tile.col >= 0 && tile.col < 15) {
                this.board[tile.row][tile.col] = {
                    letter: tile.letter,
                    isJoker: tile.isJoker || false,
                    chosenLetter: tile.chosenLetter || null
                };
            }
        });
        
        // עדכון ניקוד
        player.score += score;
        
        // חלוקת אותיות חדשות (רק כמה שהסירו בפועל)
        const newTiles = this.dealTiles(playerId, removed);
        console.log(`Player ${playerId} got ${newTiles.length} new tiles, total now: ${player.tiles.length}`);
        
        // בדיקה שהמספר תקין
        if (player.tiles.length > 7) {
            console.error(`ERROR: Player has ${player.tiles.length} tiles, should be 7 or less!`);
        }
        
        // מעבר לשחקן הבא
        this.nextTurn();
        this.consecutivePasses = 0;
        this.lastActivity = Date.now();
        
        return { 
            success: true, 
            newTiles: player.tiles, // שליחת כל האותיות
            score: score
        };
    }
    
    exchangeTiles(playerId, tileIndexes) {
        const player = this.players.get(playerId);
        if (!player || this.getCurrentPlayer() !== playerId) {
            return { success: false, error: 'לא התור שלך' };
        }
        
        if (this.tileBag.length < 7) { // **תיקון**: בדיקה שיש מספיק אותיות
            return { success: false, error: 'אין מספיק אותיות בשק להחלפה' };
        }
        
        // **תיקון**: בדיקת תקינות האינדקסים
        if (!tileIndexes || tileIndexes.length === 0) {
            return { success: false, error: 'לא נבחרו אותיות להחלפה' };
        }
        
        // הסרת האותיות מהשחקן והחזרתן לשק
        const removedTiles = [];
        tileIndexes.sort((a, b) => b - a).forEach(index => {
            if (index >= 0 && index < player.tiles.length) {
                const tile = player.tiles.splice(index, 1)[0];
                removedTiles.push(tile);
            }
        });
        
        // ערבוב האותיות שהוחזרו לשק
        this.tileBag.push(...removedTiles);
        this.tileBag = this.shuffleArray(this.tileBag);
        
        // חלוקת אותיות חדשות
        const newTiles = this.dealTiles(playerId, removedTiles.length);
        
        // מעבר לשחקן הבא
        this.nextTurn();
        this.consecutivePasses = 0;
        this.lastActivity = Date.now();
        
        return { success: true, newTiles: player.tiles };
    }
    
    passTurn(playerId) {
        if (this.getCurrentPlayer() !== playerId) {
            return { success: false, error: 'לא התור שלך' };
        }
        
        this.nextTurn();
        this.consecutivePasses++;
        this.lastActivity = Date.now();
        
        // **תיקון**: סיום המשחק אם כל השחקנים דילגו פעמיים ברצף
        if (this.consecutivePasses >= this.players.size * 2) {
            this.endGame();
            return { success: true, gameEnded: true };
        }
        
        return { success: true };
    }
    
    nextTurn() {
        if (this.turnOrder.length > 0) {
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.turnOrder.length;
        }
    }
    
    endGame() {
        // חישוב ניקוד סופי
        let winner = null;
        let highestScore = -1;
        
        for (const [playerId, player] of this.players) {
            if (player.score > highestScore) {
                highestScore = player.score;
                winner = player;
            }
        }
        
        // שליחת הודעת סיום לכל השחקנים
        this.broadcastToAll({
            type: 'game_ended',
            winner: winner ? winner.name : 'אין מנצח',
            finalScores: Array.from(this.players.values()).map(p => ({
                name: p.name,
                score: p.score
            }))
        });
        
        this.gameStarted = false;
        return winner;
    }
    
    getGameState() {
        return {
            board: this.board,
            players: Object.fromEntries(
                Array.from(this.players.entries()).map(([id, player]) => [
                    id, 
                    { id: player.id, name: player.name, score: player.score }
                ])
            ),
            currentPlayer: this.getCurrentPlayer(),
            tilesLeft: this.tileBag.length,
            gameStarted: this.gameStarted
        };
    }
    
    broadcastToAll(message, excludeId = null) {
        for (const [playerId, player] of this.players) {
            if (playerId !== excludeId && player.ws && player.ws.readyState === WebSocket.OPEN) {
                try {
                    player.ws.send(JSON.stringify(message));
                } catch (error) {
                    console.error(`Error sending message to player ${playerId}:`, error);
                }
            }
        }
    }
    
    sendToPlayer(playerId, message) {
        const player = this.players.get(playerId);
        if (player && player.ws && player.ws.readyState === WebSocket.OPEN) {
            try {
                player.ws.send(JSON.stringify(message));
            } catch (error) {
                console.error(`Error sending message to player ${playerId}:`, error);
            }
        }
    }
}

// **תיקון**: טיפול בחיבורי WebSocket עם error handling טוב יותר
wss.on('connection', (ws, req) => {
    console.log('New WebSocket connection established');
    let playerId = null;
    let currentGame = null;
    
    // **תיקון**: Keep-alive mechanism
    const keepAlive = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        } else {
            clearInterval(keepAlive);
        }
    }, 30000); // ping כל 30 שניות
    
    ws.on('pong', () => {
        // Connection is alive
    });
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received message:', data.type, data.roomId || '');
            
            switch (data.type) {
                case 'join_room':
                    // **תיקון**: יצירת ID ייחודי יותר
                    playerId = 'player_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
                    const roomId = data.roomId || generateRoomId();
                    
                    // יצירת משחק חדש אם לא קיים
                    if (!games.has(roomId)) {
                        games.set(roomId, new ScrabbleGame(roomId));
                        console.log(`Created new game room: ${roomId}`);
                    }
                    
                    currentGame = games.get(roomId);
                    const player = currentGame.addPlayer(playerId, data.playerName, ws);
                    
                    if (!player) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'החדר מלא - מקסימום 4 שחקנים'
                        }));
                        break;
                    }
                    
                    // שליחת אישור הצטרפות
                    ws.send(JSON.stringify({
                        type: 'room_joined',
                        playerId: playerId,
                        roomId: roomId,
                        myTiles: player.tiles || [], // **תיקון**: וודא שיש ברירת מחדל
                        ...currentGame.getGameState()
                    }));
                    
                    // הודעה לשאר השחקנים
                    currentGame.broadcastToAll({
                        type: 'player_joined',
                        player: { id: player.id, name: player.name, score: player.score }
                    }, playerId);
                    
                    console.log(`Player ${data.playerName} joined room ${roomId} (${currentGame.players.size} players total)`);
                    break;
                    
                case 'play_word':
                    if (!currentGame || !playerId) {
                        ws.send(JSON.stringify({ type: 'error', message: 'לא מחובר למשחק' }));
                        break;
                    }
                    
                    const wordResult = currentGame.playWord(playerId, data.tiles, data.score);
                    
                    if (wordResult.success) {
                        const player = currentGame.players.get(playerId);
                        
                        // עדכון כל השחקנים על המהלך
                        currentGame.broadcastToAll({
                            type: 'word_played',
                            playerId: playerId,
                            playerName: player.name,
                            score: data.score,
                            board: currentGame.board,
                            players: Object.fromEntries(
                                Array.from(currentGame.players.entries()).map(([id, p]) => [
                                    id, { id: p.id, name: p.name, score: p.score }
                                ])
                            ),
                            tilesLeft: currentGame.tileBag.length
                        });
                        
                        // **תיקון קריטי**: שליחת אותיות חדשות רק לשחקן שביצע את המהלך
                        currentGame.sendToPlayer(playerId, {
                            type: 'new_tiles',
                            myTiles: player.tiles || [] // **תיקון**: וודא שיש ברירת מחדל
                        });
                        
                        // הודעה על שינוי תור
                        currentGame.broadcastToAll({
                            type: 'turn_changed',
                            currentPlayer: currentGame.getCurrentPlayer()
                        });
                        
                    } else {
                        ws.send(JSON.stringify({ type: 'error', message: wordResult.error }));
                    }
                    break;
                    
                case 'exchange_tiles':
                    if (!currentGame || !playerId) {
                        ws.send(JSON.stringify({ type: 'error', message: 'לא מחובר למשחק' }));
                        break;
                    }
                    
                    const exchangeResult = currentGame.exchangeTiles(playerId, data.tileIndexes);
                    
                    if (exchangeResult.success) {
                        // שליחת אותיות חדשות לשחקן
                        ws.send(JSON.stringify({
                            type: 'tiles_exchanged',
                            playerId: playerId,
                            newTiles: exchangeResult.newTiles || [] // **תיקון**: ברירת מחדל
                        }));
                        
                        // הודעה על שינוי תור
                        currentGame.broadcastToAll({
                            type: 'turn_changed',
                            currentPlayer: currentGame.getCurrentPlayer(),
                            tilesLeft: currentGame.tileBag.length
                        });
                        
                    } else {
                        ws.send(JSON.stringify({ type: 'error', message: exchangeResult.error }));
                    }
                    break;
                    
                case 'pass_turn':
                    if (!currentGame || !playerId) {
                        ws.send(JSON.stringify({ type: 'error', message: 'לא מחובר למשחק' }));
                        break;
                    }
                    
                    const passResult = currentGame.passTurn(playerId);
                    
                    if (passResult.success) {
                        if (passResult.gameEnded) {
                            console.log(`Game ended in room ${currentGame.roomId}`);
                        } else {
                            // הודעה על שינוי תור
                            currentGame.broadcastToAll({
                                type: 'turn_changed',
                                currentPlayer: currentGame.getCurrentPlayer()
                            });
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'error', message: passResult.error }));
                    }
                    break;
                    
                default:
                    console.log('Unknown message type:', data.type);
                    ws.send(JSON.stringify({ type: 'error', message: 'סוג הודעה לא מוכר' }));
            }
            
        } catch (error) {
            console.error('Error handling message:', error);
            ws.send(JSON.stringify({ type: 'error', message: 'שגיאה בעיבוד ההודעה' }));
        }
    });
    
    ws.on('close', (code, reason) => {
        console.log(`WebSocket connection closed: ${code} ${reason}`);
        clearInterval(keepAlive);
        
        if (currentGame && playerId) {
            const removedPlayer = currentGame.removePlayer(playerId);
            
            if (removedPlayer) {
                // הודעה לשאר השחקנים
                currentGame.broadcastToAll({
                    type: 'player_left',
                    playerId: playerId,
                    playerName: removedPlayer.name
                });
                
                console.log(`Player ${removedPlayer.name} left room ${currentGame.roomId}`);
                
                // מחיקת המשחק אם אין שחקנים
                if (currentGame.players.size === 0) {
                    games.delete(currentGame.roomId);
                    console.log(`Room ${currentGame.roomId} deleted`);
                }
            }
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clearInterval(keepAlive);
    });
});

// **תיקון**: פונקציה ליצירת ID חדר
function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// **תיקון**: הפעלת השרת על הפורט הנכון לRender
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🎯 שרת שבץ נא פועל על פורט ${PORT}`);
    console.log(`🌐 Server ready for WebSocket connections`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// **תיקון**: ניקוי משחקים ישנים (כל 30 דקות)
setInterval(() => {
    const now = Date.now();
    const maxInactivity = 30 * 60 * 1000; // 30 דקות
    
    for (const [roomId, game] of games.entries()) {
        if (game.players.size === 0 || (now - game.lastActivity) > maxInactivity) {
            // ניתוק כל החיבורים של המשחק
            for (const [playerId, player] of game.players) {
                if (player.ws && player.ws.readyState === WebSocket.OPEN) {
                    player.ws.close(1000, 'Game timeout');
                }
            }
            games.delete(roomId);
            console.log(`Cleaned up inactive room: ${roomId}`);
        }
    }
}, 30 * 60 * 1000);

// **תיקון**: Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, closing server gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
