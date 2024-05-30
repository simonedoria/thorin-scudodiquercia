const { parentPort } = require('worker_threads');
const redisPool = require('./redis');
const token = require('../tools/token');

// Ascolta messaggi dal thread principale
parentPort.on('message', async (message) => {
    let updatedTokenData = await token.updateTokenData(message);
    if (updatedTokenData === null) return;
    console.log(`Acquisisco dati su nuovo token: (${updatedTokenData.symbol})`, message);
    while (true) {
        updatedTokenData = await token.updateTokenData(message);
        if (updatedTokenData !== null) {
            //console.log('Token data updated:', updatedTokenData)
            const client = await redisPool.acquire();
            try {
                await client.setAsync(message, JSON.stringify(updatedTokenData));
            } catch (error) {
                console.error("Redis error:", error);
            } finally {
                redisPool.release(client);
            }
        } else {
            console.log("CHIAMATE FALLITE PER TOKEN: ", message);
            // stop worker
            break;
        }
        // Attesa per N millisecondi prima di chiamare di nuovo getTokenData
        //await new Promise(resolve => setTimeout(resolve, 500));
    }

});