// NetworkManager.js - PeerJS-based multiplayer networking

/**
 * NetworkManager handles all multiplayer functionality:
 * - Creating/joining game rooms with 4-digit codes
 * - Synchronizing player positions and race state
 * - Managing connected players
 */

// Message types for network communication
export const MSG_TYPE = {
    // Connection
    PLAYER_JOIN: 'player_join',
    PLAYER_LEAVE: 'player_leave',
    PLAYER_LIST: 'player_list',
    HOST_LEFT: 'host_left', // Host is closing the game

    // Character selection
    REQUEST_AVAILABLE_CHARACTERS: 'request_available_characters',
    AVAILABLE_CHARACTERS: 'available_characters',
    PLAYER_READY: 'player_ready',

    // Race state
    RACE_START: 'race_start',
    RACE_COUNTDOWN: 'race_countdown',
    RACE_FINISH: 'race_finish',
    RACE_RESTART: 'race_restart',

    // Player updates (sent frequently)
    PLAYER_UPDATE: 'player_update',

    // Chat/misc
    CHAT: 'chat',
    PING: 'ping',
    PONG: 'pong'
};

// Player data structure
export class NetworkPlayer {
    constructor(peerId, name, characterModel) {
        this.peerId = peerId;
        this.name = name || 'Player';
        this.characterModel = characterModel || null;
        this.distance = 0;
        this.lanePosition = 1;
        this.lane = 1;
        this.finished = false;
        this.finishTime = null;
        this.lastUpdate = Date.now();
        this.latency = 0;
        this.ready = false; // Whether player is ready to race
        this.isDefaultCharacter = false; // True if using fallback colored character
    }
}

export class NetworkManager {
    constructor() {
        this.peer = null;
        this.connections = new Map(); // peerId -> DataConnection
        this.players = new Map(); // peerId -> NetworkPlayer
        this.isHost = false;
        this.roomCode = null;
        this.localPlayer = null;
        this.callbacks = {};

        // Connection state
        this.connected = false;
        this.connecting = false;
        this.error = null;

        // Update rate limiting
        this.lastUpdateSent = 0;
        this.updateInterval = 1000 / 30; // 30 updates per second
    }

    /**
     * Generate a random 4-character room code
     */
    generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing chars
        let code = '';
        for (let i = 0; i < 4; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    }

    /**
     * Initialize PeerJS and create a room as host
     */
    async hostGame(playerName, characterModel) {
        this.isHost = true;
        this.roomCode = this.generateRoomCode();

        return new Promise((resolve, reject) => {
            this.connecting = true;

            // Create peer with room code as ID prefix for easier identification
            const peerId = `trackrunner-${this.roomCode}-host`;

            this.peer = new Peer(peerId, {
                debug: 1, // Minimal logging
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' }
                    ]
                }
            });

            this.peer.on('open', (id) => {
                console.log('Host peer opened with ID:', id);
                this.connected = true;
                this.connecting = false;

                // Create local player
                this.localPlayer = new NetworkPlayer(id, playerName, characterModel);
                this.players.set(id, this.localPlayer);

                resolve(this.roomCode);
            });

            this.peer.on('connection', (conn) => {
                this.handleIncomingConnection(conn);
            });

            this.peer.on('error', (err) => {
                console.error('Peer error:', err);
                this.error = err.type;
                this.connecting = false;

                if (err.type === 'unavailable-id') {
                    // Room code already taken, generate new one
                    this.roomCode = this.generateRoomCode();
                    this.peer.destroy();
                    this.hostGame(playerName, characterModel)
                        .then(resolve)
                        .catch(reject);
                } else {
                    reject(err);
                }
            });

            this.peer.on('disconnected', () => {
                console.log('Peer disconnected, attempting reconnect...');
                this.peer.reconnect();
            });
        });
    }

    /**
     * Join an existing game room
     */
    async joinGame(roomCode, playerName, characterModel) {
        this.isHost = false;
        this.roomCode = roomCode.toUpperCase();

        return new Promise((resolve, reject) => {
            this.connecting = true;

            // Generate unique peer ID for this player
            const peerId = `trackrunner-${this.roomCode}-${Date.now()}`;

            this.peer = new Peer(peerId, {
                debug: 1,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' }
                    ]
                }
            });

            this.peer.on('open', (id) => {
                console.log('Client peer opened with ID:', id);

                // Create local player
                this.localPlayer = new NetworkPlayer(id, playerName, characterModel);
                this.players.set(id, this.localPlayer);

                // Connect to host
                const hostId = `trackrunner-${this.roomCode}-host`;
                console.log('Connecting to host:', hostId);

                const conn = this.peer.connect(hostId, {
                    reliable: true,
                    serialization: 'json'
                });

                conn.on('open', () => {
                    console.log('Connected to host!');
                    this.connections.set(hostId, conn);
                    this.connected = true;
                    this.connecting = false;

                    // Send join message
                    this.send(hostId, {
                        type: MSG_TYPE.PLAYER_JOIN,
                        player: {
                            peerId: id,
                            name: playerName,
                            characterModel: characterModel
                        }
                    });

                    resolve(this.roomCode);
                });

                conn.on('data', (data) => {
                    this.handleMessage(hostId, data);
                });

                conn.on('close', () => {
                    console.log('Disconnected from host');
                    this.handlePlayerDisconnect(hostId);
                });

                conn.on('error', (err) => {
                    console.error('Connection error:', err);
                    reject(err);
                });

                // Timeout for connection
                setTimeout(() => {
                    if (!this.connected) {
                        reject(new Error('Connection timeout - room not found'));
                    }
                }, 10000);
            });

            this.peer.on('connection', (conn) => {
                // Other players connecting (for mesh network)
                this.handleIncomingConnection(conn);
            });

            this.peer.on('error', (err) => {
                console.error('Peer error:', err);
                this.error = err.type;
                this.connecting = false;

                if (err.type === 'peer-unavailable') {
                    reject(new Error('Room not found - check the code'));
                } else {
                    reject(err);
                }
            });
        });
    }

    /**
     * Handle incoming connection from another player
     */
    handleIncomingConnection(conn) {
        console.log('Incoming connection from:', conn.peer);

        conn.on('open', () => {
            console.log('Connection opened with:', conn.peer);
            this.connections.set(conn.peer, conn);

            // If we're host, send current player list
            if (this.isHost) {
                const playerList = Array.from(this.players.values()).map(p => ({
                    peerId: p.peerId,
                    name: p.name,
                    characterModel: p.characterModel,
                    lane: p.lane
                }));

                this.send(conn.peer, {
                    type: MSG_TYPE.PLAYER_LIST,
                    players: playerList
                });
            }
        });

        conn.on('data', (data) => {
            this.handleMessage(conn.peer, data);
        });

        conn.on('close', () => {
            console.log('Connection closed with:', conn.peer);
            this.handlePlayerDisconnect(conn.peer);
        });
    }

    /**
     * Handle incoming message from a peer
     */
    handleMessage(fromPeerId, data) {
        switch (data.type) {
            case MSG_TYPE.PLAYER_JOIN:
                this.handlePlayerJoin(fromPeerId, data.player);
                break;

            case MSG_TYPE.PLAYER_LEAVE:
                this.handlePlayerDisconnect(data.peerId);
                break;

            case MSG_TYPE.HOST_LEFT:
                console.log('Host has left the game');
                this.triggerCallback('onHostLeft');
                break;

            case MSG_TYPE.PLAYER_LIST:
                this.handlePlayerList(data.players);
                break;

            case MSG_TYPE.PLAYER_UPDATE:
                this.handlePlayerUpdate(fromPeerId, data);
                break;

            case MSG_TYPE.RACE_START:
                this.triggerCallback('onRaceStart', data);
                break;

            case MSG_TYPE.RACE_COUNTDOWN:
                this.triggerCallback('onCountdown', data.count);
                break;

            case MSG_TYPE.RACE_FINISH:
                this.handleRaceFinish(fromPeerId, data);
                break;

            case MSG_TYPE.RACE_RESTART:
                this.triggerCallback('onRaceRestart');
                break;

            case MSG_TYPE.REQUEST_AVAILABLE_CHARACTERS:
                this.handleRequestAvailableCharacters(fromPeerId);
                break;

            case MSG_TYPE.AVAILABLE_CHARACTERS:
                this.triggerCallback('onAvailableCharacters', data.characters);
                break;

            case MSG_TYPE.PLAYER_READY:
                this.handlePlayerReady(fromPeerId, data);
                break;

            case MSG_TYPE.PING:
                this.send(fromPeerId, { type: MSG_TYPE.PONG, timestamp: data.timestamp });
                break;

            case MSG_TYPE.PONG:
                this.handlePong(fromPeerId, data.timestamp);
                break;

            default:
                console.log('Unknown message type:', data.type);
        }
    }

    /**
     * Handle request for available characters (host only)
     */
    handleRequestAvailableCharacters(fromPeerId) {
        if (!this.isHost) return;

        // Get list of characters already taken
        const takenCharacters = [];
        this.players.forEach(player => {
            if (player.characterModel && !player.isDefaultCharacter) {
                takenCharacters.push(player.characterModel);
            }
        });

        // All available characters
        const allCharacters = ['trump', 'musk', 'stalin', 'skeleton', 'snowman', 'demon'];
        const availableCharacters = allCharacters.filter(c => !takenCharacters.includes(c));

        this.send(fromPeerId, {
            type: MSG_TYPE.AVAILABLE_CHARACTERS,
            characters: availableCharacters
        });
    }

    /**
     * Handle player ready status
     */
    handlePlayerReady(fromPeerId, data) {
        const player = this.players.get(fromPeerId);
        if (player) {
            player.ready = data.ready;
            player.characterModel = data.characterModel;
            player.isDefaultCharacter = data.isDefaultCharacter || false;

            // Broadcast updated player list
            if (this.isHost) {
                this.broadcastPlayerList();
            }

            this.triggerCallback('onPlayerReady', player);
        }
    }

    /**
     * Handle new player joining
     */
    handlePlayerJoin(peerId, playerData) {
        console.log('=== handlePlayerJoin ===');
        console.log('  peerId (from connection):', peerId);
        console.log('  playerData.peerId:', playerData.peerId);
        console.log('  playerData.name:', playerData.name);
        console.log('  Current players count:', this.players.size);
        console.log('  Player already exists?', this.players.has(peerId));

        const player = new NetworkPlayer(
            playerData.peerId,
            playerData.name,
            playerData.characterModel
        );

        // Assign lane (2-8 for joining players)
        const usedLanes = new Set(Array.from(this.players.values()).map(p => p.lane));
        for (let lane = 2; lane <= 8; lane++) {
            if (!usedLanes.has(lane)) {
                player.lane = lane;
                break;
            }
        }

        this.players.set(peerId, player);

        // If host, broadcast updated player list
        if (this.isHost) {
            this.broadcastPlayerList();
        }

        this.triggerCallback('onPlayerJoin', player);
    }

    /**
     * Handle player list from host
     */
    handlePlayerList(players) {
        for (const playerData of players) {
            if (playerData.peerId !== this.localPlayer.peerId) {
                const player = new NetworkPlayer(
                    playerData.peerId,
                    playerData.name,
                    playerData.characterModel
                );
                player.lane = playerData.lane;
                player.ready = playerData.ready || false;
                player.isDefaultCharacter = playerData.isDefaultCharacter || false;
                this.players.set(playerData.peerId, player);
            }
        }

        this.triggerCallback('onPlayerListUpdate', Array.from(this.players.values()));
    }

    /**
     * Handle player position update
     */
    handlePlayerUpdate(peerId, data) {
        const player = this.players.get(peerId);
        if (player) {
            player.distance = data.distance;
            player.lanePosition = data.lanePosition;
            player.finished = data.finished;
            player.finishTime = data.finishTime;
            player.lastUpdate = Date.now();

            this.triggerCallback('onPlayerUpdate', player);
        }
    }

    /**
     * Handle player disconnect
     */
    handlePlayerDisconnect(peerId) {
        const player = this.players.get(peerId);
        if (player) {
            console.log('Player disconnected:', player.name);
            this.players.delete(peerId);
            this.connections.delete(peerId);

            this.triggerCallback('onPlayerLeave', player);

            // If host, broadcast updated list
            if (this.isHost) {
                this.broadcastPlayerList();
            }
        }
    }

    /**
     * Handle race finish notification
     */
    handleRaceFinish(peerId, data) {
        const player = this.players.get(peerId);
        if (player) {
            player.finished = true;
            player.finishTime = data.time;

            this.triggerCallback('onPlayerFinish', player);
        }
    }

    /**
     * Handle pong response for latency measurement
     */
    handlePong(peerId, timestamp) {
        const player = this.players.get(peerId);
        if (player) {
            player.latency = Date.now() - timestamp;
        }
    }

    /**
     * Send message to a specific peer
     */
    send(peerId, data) {
        const conn = this.connections.get(peerId);
        if (conn && conn.open) {
            conn.send(data);
        }
    }

    /**
     * Broadcast message to all connected peers
     */
    broadcast(data) {
        for (const [peerId, conn] of this.connections) {
            if (conn.open) {
                conn.send(data);
            }
        }
    }

    /**
     * Broadcast updated player list (host only)
     */
    broadcastPlayerList() {
        if (!this.isHost) return;

        const playerList = Array.from(this.players.values()).map(p => ({
            peerId: p.peerId,
            name: p.name,
            characterModel: p.characterModel,
            lane: p.lane,
            ready: p.ready,
            isDefaultCharacter: p.isDefaultCharacter
        }));

        this.broadcast({
            type: MSG_TYPE.PLAYER_LIST,
            players: playerList
        });
    }

    /**
     * Send local player position update
     */
    sendPlayerUpdate(distance, lanePosition, finished = false, finishTime = null) {
        const now = Date.now();
        if (now - this.lastUpdateSent < this.updateInterval) {
            return; // Rate limit
        }
        this.lastUpdateSent = now;

        // Update local player
        if (this.localPlayer) {
            this.localPlayer.distance = distance;
            this.localPlayer.lanePosition = lanePosition;
            this.localPlayer.finished = finished;
            this.localPlayer.finishTime = finishTime;
        }

        this.broadcast({
            type: MSG_TYPE.PLAYER_UPDATE,
            distance,
            lanePosition,
            finished,
            finishTime
        });
    }

    /**
     * Start the race (host only)
     */
    startRace(raceMode, raceDistance, selectedMap = 'default') {
        if (!this.isHost) return;

        this.broadcast({
            type: MSG_TYPE.RACE_START,
            raceMode,
            raceDistance,
            selectedMap,
            timestamp: Date.now()
        });

        this.triggerCallback('onRaceStart', { raceMode, raceDistance, selectedMap });
    }

    /**
     * Restart the race (host only)
     */
    restartRace() {
        if (!this.isHost) return;

        this.broadcast({
            type: MSG_TYPE.RACE_RESTART
        });

        // Also trigger locally
        this.triggerCallback('onRaceRestart');
    }

    /**
     * Send countdown update (host only)
     */
    sendCountdown(count) {
        if (!this.isHost) return;

        this.broadcast({
            type: MSG_TYPE.RACE_COUNTDOWN,
            count
        });
    }

    /**
     * Notify that local player finished
     */
    sendFinish(time) {
        this.broadcast({
            type: MSG_TYPE.RACE_FINISH,
            time
        });
    }

    /**
     * Request available characters from host
     */
    requestAvailableCharacters() {
        // Send to host
        const hostId = `trackrunner-${this.roomCode}-host`;
        this.send(hostId, {
            type: MSG_TYPE.REQUEST_AVAILABLE_CHARACTERS
        });
    }

    /**
     * Send ready status with selected character
     */
    sendReady(characterModel, isDefaultCharacter = false) {
        if (this.localPlayer) {
            this.localPlayer.ready = true;
            this.localPlayer.characterModel = characterModel;
            this.localPlayer.isDefaultCharacter = isDefaultCharacter;
        }

        this.broadcast({
            type: MSG_TYPE.PLAYER_READY,
            ready: true,
            characterModel: characterModel,
            isDefaultCharacter: isDefaultCharacter
        });
    }

    /**
     * Get list of taken characters
     */
    getTakenCharacters() {
        const taken = [];
        this.players.forEach(player => {
            if (player.characterModel && !player.isDefaultCharacter) {
                taken.push(player.characterModel);
            }
        });
        return taken;
    }

    /**
     * Check if all players are ready
     */
    allPlayersReady() {
        for (const player of this.players.values()) {
            if (!player.ready) return false;
        }
        return this.players.size > 0;
    }

    /**
     * Register callback for network events
     */
    on(event, callback) {
        this.callbacks[event] = callback;
    }

    /**
     * Trigger a callback if registered
     */
    triggerCallback(event, data) {
        if (this.callbacks[event]) {
            this.callbacks[event](data);
        }
    }

    /**
     * Get list of all players including local
     */
    getAllPlayers() {
        return Array.from(this.players.values());
    }

    /**
     * Get list of remote players only
     */
    getRemotePlayers() {
        return Array.from(this.players.values()).filter(
            p => p.peerId !== this.localPlayer?.peerId
        );
    }

    /**
     * Get player count
     */
    getPlayerCount() {
        return this.players.size;
    }

    /**
     * Check if connected
     */
    isConnected() {
        return this.connected && this.peer && !this.peer.destroyed;
    }

    /**
     * Disconnect and cleanup
     */
    disconnect() {
        console.log('Disconnecting from network...');

        // If host is leaving, notify all clients the game is ending
        if (this.isHost) {
            this.broadcast({
                type: MSG_TYPE.HOST_LEFT
            });
        } else {
            // Regular player leaving
            this.broadcast({
                type: MSG_TYPE.PLAYER_LEAVE,
                peerId: this.localPlayer?.peerId
            });
        }

        // Close all connections
        for (const conn of this.connections.values()) {
            conn.close();
        }
        this.connections.clear();

        // Destroy peer
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }

        // Reset state
        this.connected = false;
        this.isHost = false;
        this.roomCode = null;
        this.players.clear();
        this.localPlayer = null;
    }

    /**
     * Ping all connected peers for latency
     */
    pingAll() {
        this.broadcast({
            type: MSG_TYPE.PING,
            timestamp: Date.now()
        });
    }
}

// Singleton instance
let networkManagerInstance = null;

export function getNetworkManager() {
    if (!networkManagerInstance) {
        networkManagerInstance = new NetworkManager();
    }
    return networkManagerInstance;
}
