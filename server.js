const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// הגשת קבצים סטטיים
app.use(express.static(path.join(__dirname)));

// הגדרות המשחק
const TILES_PER_PLAYER = 7;
const LETTER_DISTRIBUTION = {
    'א': { count: 8, points: 1 },
    'ב': { count: 3, points: 3 },
    'ג': { count: 2, points: 4 },
    'ד': { count: 3, points: 3 },
    'ה': { count: 8, points: 1 },
    'ו': { count: 6, points: 2 },
    'ז': { count: 1, points: 8 },
    'ח': { count: 2, points: 4 },
    'ט': { count: 2, points: 4 },
    'י': { count: 8, points: 1 },
    'כ': { count: 4, points: 2 },
    'ל': { count: 6, points: 2 },
    'מ': { count: 6, points: 2 },
    'נ': { count: 6, points: 2 },
    'ס': { count: 2, points: 4 },
    'ע': { count: 2, points: 4 },
    'פ': { count: 2, points: 4 },
    'צ': { count: 1, points: 8 },
    'ק': { count: 1, points: 8 },
    'ר': { count: 6, points: 2 },
    'ש': { count: 3, points: 3 },
    'ת': { count: 6, points: 2 },
    '': { count: 2, points: 0 } // אותיות ריקות
};

const SPECIAL_CELLS = {
    'word-triple': [[0,0], [0,7], [0,14], [7,0], [7,14], [14,0], [14,7], [14,14]],
    'word-double': [[1,1], [2,2], [3,3], [4,4], [1,13], [2,12], [3,11], [4,10], [7,7], [10,4], [11,3], [12,2], [13,1], [13,13], [12,12], [11,11], [10,10]],
    'letter-triple': [[1,5], [1,9], [5,1], [5,5], [5,9], [5,13], [9,1], [9,5], [9,9], [9,13], [13,5], [13,9]],
    'letter-double': [[0,3], [0,11], [2,6], [2,8], [3,0], [3,7], [3,14], [6,2], [6,6], [6,8], [6,12], [7,3], [7,11], [8,2], [8,6], [8,8], [8,12], [11,0], [11,7], [11,14], [12,6], [12,8], [14,3], [14,11]]
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
        const player = {
            id: playerId,
            name: playerName,
            score: 0,
            tiles: [],
            ws: ws
        };
        
        this.players.set(playerId, player);
        this.turnOrder.push(playerId);
        
        // חלוקת אותיות התחלתיות
        this.dealTiles(playerId, TILES_PER_PLAYER);
        
        // התחלת המשחק אם יש לפחות שני שחקנים
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
            
            // עדכון אינדקס השחקן הנוכחי
            if (this.currentPlayerIndex >= this.turnOrder.length) {
                this.currentPlayerIndex = 0;
            }
        }
        
        return player;
    }
    
    startGame() {
        this.gameStarted = true;
        this.currentPlayerIndex = 0;
        console.log(`Game started in room ${this.roomId}`);
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
        
        // הצבת האותיות על הלוח
        tiles.forEach(tile => {
            this.board[tile.row][tile.col] = tile.letter;
        });
        
        // עדכון ניקוד
        player.score += score;
        
        // חלוקת אותיות חדשות
        const newTiles = this.dealTiles(playerId, tiles.length);
        
        // מעבר לשחקן הבא
        this.nextTurn();
        this.consecutivePasses = 0;
        
        return { 
            success: true, 
            newTiles: newTiles,
            score: score
        };
    }
    
    exchangeTiles(playerId, tileIndexes) {
        const player = this.players.get(playerId);
        if (!player || this.getCurrentPlayer() !== playerId) {
            return { success: false, error: 'לא התור שלך' };
        }
        
        if (this.tileBag.length < tileIndexes.length) {
            return { success: false, error: 'אין מספיק אותיות בשק' };
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
        
        return { success: true, newTiles: player.tiles };
    }
    
    passTurn(playerId) {
        if (this.getCurrentPlayer() !== playerId) {
            return { success: false, error: 'לא התור שלך' };
        }
        
        this.nextTurn();
        this.consecutivePasses++;
        
        // אם כל השחקנים דילגו פעמיים ברצף, סיום המשחק
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
            if (playerId !== excludeId && player.ws.readyState === WebSocket.OPEN) {
                player.ws.send(JSON.stringify(message));
            }
        }
    }
    
    sendToPlayer(playerId, message) {
        const player = this.players.get(playerId);
        if (player && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify(message));
        }
    }
}

// טיפול בחיבורי WebSocket
wss.on('connection', (ws) => {
    let playerId = null;
    let currentGame = null;
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received:', data);
            
            switch (data.type) {
                case 'join_room':
                    playerId = 'player_' + Math.random().toString(36).substring(2, 9);
                    const roomId = data.roomId;
                    
                    // יצירת משחק חדש אם לא קיים
                    if (!games.has(roomId)) {
                        games.set(roomId, new ScrabbleGame(roomId));
                    }
                    
                    currentGame = games.get(roomId);
                    const player = currentGame.addPlayer(playerId, data.playerName, ws);
                    
                    // שליחת אישור הצטרפות
                    ws.send(JSON.stringify({
                        type: 'room_joined',
                        playerId: playerId,
                        roomId: roomId,
                        myTiles: player.tiles,
                        ...currentGame.getGameState()
                    }));
                    
                    // הודעה לשאר השחקנים
                    currentGame.broadcastToAll({
                        type: 'player_joined',
                        player: { id: player.id, name: player.name, score: player.score }
                    }, playerId);
                    
                    console.log(`Player ${data.playerName} joined room ${roomId}`);
                    break;
                    
                case 'play_word':
                    if (!currentGame || !playerId) {
                        ws.send(JSON.stringify({ type: 'error', message: 'לא מחובר למשחק' }));
                        break;
                    }
                    
                    const wordResult = currentGame.playWord(playerId, data.tiles, data.score);
                    
                    if (wordResult.success) {
                        const player = currentGame.players.get(playerId);
                        
                        // עדכון כל השחקנים
                        currentGame.broadcastToAll({
                            type: 'word_played',
                            playerId: playerId,
                            playerName: player.name,
                            score: data.score,
                            ...currentGame.getGameState()
                        });
                        
                        // שליחת אותיות חדשות לשחקן
                        currentGame.sendToPlayer(playerId, {
                            type: 'word_played',
                            playerId: playerId,
                            playerName: player.name,
                            score: data.score,
                            newTiles: player.tiles,
                            ...currentGame.getGameState()
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
                            newTiles: exchangeResult.newTiles
                        }));
                        
                        // הודעה על שינוי תור
                        currentGame.broadcastToAll({
                            type: 'turn_changed',
                            currentPlayer: currentGame.getCurrentPlayer()
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
                            // המשחק הסתיים
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
            }
            
        } catch (error) {
            console.error('Error handling message:', error);
            ws.send(JSON.stringify({ type: 'error', message: 'שגיאה בשרת' }));
        }
    });
    
    ws.on('close', () => {
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
});

// הפעלת השרת
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🎯 שרת שבץ נא פועל על פורט ${PORT}`);
    console.log(`🌐 גש לכתובת: http://localhost:${PORT}`);
});

// ניקוי משחקים ישנים (כל שעה)
setInterval(() => {
    for (const [roomId, game] of games.entries()) {
        if (game.players.size === 0) {
            games.delete(roomId);
            console.log(`Cleaned up empty room: ${roomId}`);
        }
    }
}, 3600000); // שעה