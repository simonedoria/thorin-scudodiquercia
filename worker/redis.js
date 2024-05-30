// redisPool.js
const poolModule = require('generic-pool');
const redis = require('redis');
const bluebird = require('bluebird');

// Promisify all the functions in the Redis client
bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

const redisPool = poolModule.createPool({
    create: function() {
        return new Promise((resolve, reject) => {
            const client = redis.createClient();
            client.on('connect', function() {
                resolve(client);
            });
            client.on('error', function(err) {
                reject(err);
            });
        });
    },
    destroy: function(client) {
        return new Promise((resolve, reject) => {
            client.on('end', function() {
                resolve();
            });
            client.quit();
        });
    }
}, {
    max: 200, // numero massimo di risorse da creare contemporaneamente
    min: 1  // numero minimo di risorse da mantenere nel pool in ogni momento
});

module.exports = redisPool;