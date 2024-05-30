const redisPool = require('../worker/redis');
const { Wallet, ethers } = require('ethers')
const { ChainId, Token, TokenAmount, Pair, Route, Trade, Fetcher, TradeType, Percent } = require('@uniswap/sdk');
require('dotenv').config()

const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_HTTP)
const privateKey = process.env.PRIVATE_KEY;
const signingWallet = new Wallet(privateKey).connect(provider)
const wethAddress = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const uniswapAddress = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
module.exports = {
    getTokenBoughtList: async function () {
        const client = await redisPool.acquire();
        try {
            let currentTokens = await client.getAsync('tokens_watching');
            if (currentTokens === null) return [];
            currentTokens = JSON.parse(currentTokens);
            for (let token of currentTokens) {
                let tokenAbi = [
                    'function balanceOf(address account) external view returns (uint256)',
                    'function decimals() external view returns (uint8)'];
                const erc20 = new ethers.Contract(token.address, tokenAbi, signingWallet);
                const balance = await erc20.balanceOf(signingWallet.address);
                const decimals = await erc20.decimals();
                if (balance !== token.balance) {
                    token.balance = balance.toString();
                    token.balanceFormatted = ethers.formatUnits(balance, parseInt(decimals.toString()));
                }
            }
            await client.setAsync('tokens_watching', JSON.stringify(currentTokens));
            return currentTokens;
        }
        catch (e) {
            console.log(e);
            return [];
        } finally {
            redisPool.release(client);
        }
    },
    removeTokenFromList: async function (token) {
        const client = await redisPool.acquire();
        try {
            let currentTokens = await client.getAsync('tokens_watching');
            if (currentTokens === null) return;
            currentTokens = JSON.parse(currentTokens);
            let tokenToRemove = currentTokens.find(t => t.address === token);
            const index = currentTokens.indexOf(tokenToRemove);
            if (index > -1) {
                currentTokens.splice(index, 1);
            }
            await client.setAsync('tokens_watching', JSON.stringify(currentTokens));
            return currentTokens;
        }
        catch (e) {
            console.log(e);
        } finally {
            redisPool.release(client);
        }
    },
    approveSellToken: async (token) => {
        console.log('ççççççççççççççççç APPROVE çççççççççççççççççççççççç')
        console.log('nonce used', nonce)
        const erc20Abi = ['function approve(address spender, uint256 amount) public returns (bool)',
            'function balanceOf(address account) external view returns (uint256)'];
        const erc20 = new ethers.Contract(token.address, erc20Abi, signingWallet);
        const balance = await erc20.balanceOf(signingWallet.address);
        console.log('balance', balance.toString())
        console.log('inserisco la transazione di approve alla vendita......')
        const transaction = await erc20.approve(
            uniswapAddress,
            balance.toString(),
            { from: signingWallet.address }
        )
        console.log('transazione di approve alla vendita inserita con successo', transaction)
        return transaction;
    },
    sellToken: async function (token, ethAmountOut, maxFeePerGas = '26000000000', maxPriorityFeePerGas = '8000000000') {
        console.log('ççççççççççççççççç SELL çççççççççççççççççççççççç')
        const uniswapAbi = ['function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external',
            'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)'];
        const uniswap = new ethers.Contract(uniswapAddress, uniswapAbi, signingWallet);
        let tokenAbi = ['function balanceOf(address account) external view returns (uint256)'];
        const erc20 = new ethers.Contract(token.address, tokenAbi, signingWallet);
        const balance = await erc20.balanceOf(signingWallet.address);
        const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
        console.log('inserisco la transazione di vendita......')
        const transaction = await uniswap.swapExactTokensForETH(
            balance,
            ethAmountOut,
            [
                token.address,
                wethAddress,
            ],
            signingWallet.address,
            deadline,
            {
                value: '0',
                type: 2,
                maxFeePerGas: maxFeePerGas,
                maxPriorityFeePerGas: maxPriorityFeePerGas,
                gasLimit: '50000'
            }
        );
        console.log('Transazione di vendita inserita', transaction)
        return transaction;
    }
};