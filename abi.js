const axios = require('axios');
const redis = require('./worker/redis');
let abis = [];
const getAbi = async (address) => {
    try {
        const client = await redis.acquire();
        const data = await client.getAsync("abi-" + address);
        redis.release(client);
        if (data != null && JSON.parse(data) != null) {
            return JSON.parse(data);
        }
        const url = `https://api.etherscan.io/api?module=contract&action=getabi&address=${address}&apikey=${process.env.ETHERSCAN_API_KEY}`;
        const response = await axios.get(url);
        let abi = JSON.parse(response.data.result);
        const client2 = await redis.acquire();
        await client2.setAsync("abi-" + address, JSON.stringify(abi));
        redis.release(client2);
        abis.push({ address, abi });
        return abi;
    }
    catch (e) {
        return null;
    }
}

module.exports = {
    getAllAbis: async (addresses) => {
        const abis = [];
        for (let address of addresses) {
            let abi = await getAbi(address[1]);
            if (abi != null) {
                address = address[1];
                abis.push({ address, abi });
            }
        }
        return abis;
    },
    getSingleAbi: async (address) => {
        let abi = abis.find(a => a.address === address);
        if (abi != null) {
            // console.log('Abi trovato in cache', address)
            return abi.abi;
        }
        // console.log('Abi non trovato in cache', address)
        return await getAbi(address);
    }
}