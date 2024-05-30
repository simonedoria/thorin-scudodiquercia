const web3 = require('web3');
const abi = require('./abi.js');
const dexs = require('./dex/dexs.js');
const { Worker } = require('worker_threads');
const logs = require('./tools/logs.js');
const redisPool = require('./worker/redis');
const tokenUtils = require('./tools/token');
const { ethers } = require('ethers');
require('dotenv').config();
const wallet = require('./tools/wallet');

const express = require('express');
const app = express();

// Imposta EJS come motore di template
app.set('view engine', 'ejs');

const web3ws = new web3(new web3.providers.WebsocketProvider(process.env.PROVIDER_WS));
const web3Http = new web3(new web3.providers.HttpProvider(process.env.PROVIDER_HTTP));
const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_HTTP);
const addresses = [
    ['uniswap', '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'] // Uniswap V2: Router 2
];

let gasPriceInfo = null;
let balanceInWei = null;
let balanceInEth = null;
let candidates = [];
const workers = {};

const updateGasPriceInfo = async () => {
    try {
        const gasPrice = await web3Http.eth.getGasPrice();
        const block = await provider.getBlock('latest');
        const baseFee = block.baseFeePerGas;
        const network = await provider.getNetwork();
        const chainId = network.chainId;
        const coinbase = block.miner;
        gasPriceInfo = {
            gasPrice,
            baseFee: baseFee.toString(),
            blockNumber: block.number,
            chainId,
            coinbase
        };
    } catch (err) {
        console.error('Failed to update gas price info:', err);
    }
};

const getBalance = async () => {
    const account = web3Http.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
    web3Http.eth.accounts.wallet.add(account);
    web3Http.eth.defaultAccount = account.address;

    const balance = await web3Http.eth.getBalance(account.address);
    balanceInWei = balance;
    balanceInEth = web3Http.utils.fromWei(balance, 'ether');
};

const isTransactionOfType2 = (transaction) => transaction.type === 2;

const handleTransaction = async (transaction, candidate) => {
    if (isTransactionOfType2(transaction)) {
        console.log("######################################################");
        console.log("MEV CANDIDATE", transaction.hash);
        const token = candidate.inputData.tokenAcquistato;

        if (!workers[token]) {
            console.log(`[Worker] Creating worker ${Object.keys(workers).length + 1} for token ${token}`);
            const worker = new Worker('./worker/worker.js');
            workers[token] = worker;
            worker.on('message', (message) => {
                console.log(`Received message from worker for token ${token}: ${message}`);
            });
            worker.on('error', (error) => {
                console.error(`Worker for token ${token} encountered an error: ${error.message}`);
            });
            worker.on('exit', (code) => {
                if (code !== 0) {
                    console.error(`Worker for token ${token} stopped with exit code ${code}`);
                }
            });
            workers[token].postMessage(token);
        } else {
            const client = await redisPool.acquire();
            let tokenData = null;
            try {
                tokenData = await client.getAsync(token);
            } catch (error) {
                console.error("Redis error:", error);
            } finally {
                redisPool.release(client);
            }

            if (tokenData !== null) {
                tokenData = JSON.parse(tokenData);
                console.log("TOKEN DATA TROVATI, POSSIAMO PROCEDERE...", transaction.hash);
                console.log('CURRENT BALANCE', balanceInEth, 'ETH');
                console.log('CURRENT GAS PRICE:', gasPriceInfo);
                console.log('VICTIM TRANSACTION GAS PRICE:', transaction.gas, transaction.maxPriorityFeePerGas, transaction.maxFeePerGas);

                let isGoodCandidateByGasSpent = tokenUtils.compareGasPriceToAvg(gasPriceInfo, transaction.maxPriorityFeePerGas);
                if (!isGoodCandidateByGasSpent) {
                    console.log("The transaction is not a good candidate for front-running based on the gas price.");
                    return;
                }
                let gasFeesToPutInTransaction = tokenUtils.calculateGasFees(transaction, gasPriceInfo, "10000000000");
                let gasFeesToSpend = BigInt(gasFeesToPutInTransaction.maxFeePerGas) * BigInt(gasPriceInfo.baseFee) / BigInt(10e18);
                let amountOut1eth = tokenData.amountOut;
                let isGoodValue = tokenUtils.isTransactionValueAboveAverage(transaction, '50000000000000000');
                if (!isGoodValue) {
                    console.log("The transaction is not a good candidate for front-running based on the transaction value.");
                    return;
                }
                let isGoodDeadline = tokenUtils.deadlineCheck(candidate);
                if (!isGoodDeadline) {
                    console.log("The transaction is not a good candidate for front-running based on the deadline.");
                    return;
                }
                let reserveWeth = tokenData.liquidity[0];
                let reserveTokenB = tokenData.liquidity[1];
                console.log("RESERVE WETH", reserveWeth);
                console.log("RESERVE TOKEN B", reserveTokenB);
                let deltaX = transaction.value;
                let eth1 = "1000000000000000000";
                let deltaY = tokenUtils.calculateDeltaY(deltaX, amountOut1eth[0], eth1);
                let decimals = tokenData.amountOut[2];
                let newPrice = tokenUtils.calculateNewPrice(reserveWeth, reserveTokenB, deltaX, deltaY, parseInt(decimals.toString()));
                let tokensToBuy = tokenUtils.calculateTokensToBuy(BigInt('1000000000000000'), newPrice.toString(), gasFeesToSpend.toString());
                let isEnoughAmountOut = tokenUtils.isEnoughAmountOut(candidate.inputData.amountOutMinValueWei, deltaY);
                if (!isEnoughAmountOut) {
                    console.log("The transaction is not a good candidate for front-running based on the amountOutMin.", candidate.inputData.amountOutMinValueWei, deltaY.toString());
                    return;
                }
                let ethToInvest = tokenUtils.calculateEthToInvest(tokensToBuy, tokenData.tokenPrice.toString());
                let ethToEarn = tokenUtils.calculateEthToEarn(tokensToBuy, newPrice.toString());
                console.log('^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^');
                console.log("TOKEN ADDRESS", token);
                console.log("Amount Out for 1ETH", amountOut1eth[0], amountOut1eth[1]);
                console.log("Victim transaction value", transaction.value, `(${web3.utils.fromWei(transaction.value, 'ether')} ETH)`);
                console.log("Calculated AmountOut", deltaY, formatUnits(deltaY, parseInt(decimals.toString())));
                console.log('total reserves eth', reserveWeth, `(${reserveWeth.toString()} ETH)`);
                console.log('total reserves token', reserveTokenB);
                console.log('Price BEFORE Victim transaction', tokenData.tokenPrice.toString(), `(ETH) ${BigInt(tokenData.tokenPrice.toString()) / BigInt(1e18)}`);
                console.log('Price  AFTER Victim transaction', newPrice.toString(), `(ETH) ${BigInt(newPrice) / BigInt(1e18)}`);
                console.log("TRANSACTION HASH", transaction.hash);
                console.log('GAS FEES TO SPEND', gasFeesToSpend.toString());
                console.log('TOKENS TO BUY', tokensToBuy);
                console.log('ETH TO INVEST (ETH)', ethToInvest, `(${BigInt(ethToInvest) * BigInt(1e18)} WEI)`);
                console.log('ETH TO EARN (ETH)', BigInt(ethToEarn) / BigInt(1e18), `(${ethToEarn} WEI)`);
                console.log('^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^');
                console.log('$$$$$$$$$$$ WE ARE READY TO BUY THE TOKEN $$$$$$$$$$$', tokenData.symbol);
                console.log('TOKEN TO BUY', tokenData.symbol, `(${candidate.inputData.tokenAcquistato})`);
                console.log('NUMTOKENS TO BUY', tokensToBuy);
                console.log('ETH TO INVEST', ethToInvest, `(${BigInt(ethToInvest) * BigInt(1e18)} WEI)`);
                console.log('GAS FEE TO PUT IN TRANSACTION', gasFeesToPutInTransaction);
                console.log('ETH TO EARN (ETH)', BigInt(ethToEarn) / BigInt(1e18), `(${ethToEarn} WEI)`);
                console.log('$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$');
                candidates.push({
                    symbol: tokenData.symbol,
                    hash: transaction.hash,
                    amountOutMin: candidate.inputData.amountOutMinValueWei,
                    value: transaction.value,
                    maxFeePerGas: transaction.maxFeePerGas,
                    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
                    status: transaction.status,
                    blockNumber: transaction.blockNumber,
                    nonce: transaction.nonce
                });
                //bundler.performTransactions(candidate, tokensToBuy, ethToInvest, ethToEarn, gasFeesToPutInTransaction, gasPriceInfo, tokenData, '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'.toLowerCase(), abis[0].abi);
            }
        }
    }
};

const runBot = async () => {
    console.log("STARTING BOT...");
    await updateGasPriceInfo();
    await getBalance();
    const abis = await abi.getAllAbis(addresses);
    if (abis.length === 0) return;

    console.log("ABIS DOWNLOADED", abis);
    web3ws.eth.subscribe('pendingTransactions', async (error, transactionHash) => {
        if (error) {
            console.error('Error subscribing to pending transactions:', error);
            return;
        }
        let transaction = await web3ws.eth.getTransaction(transactionHash);
        for (let attempt = 0; attempt < 5 && !transaction; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            transaction = await web3ws.eth.getTransaction(transactionHash);
        }
        if (!transaction) return;

        const candidate = dexs.getCandidateForMev(web3Http, abis, transaction);
        if (candidate) {
            console.log('Candidate identified:', candidate);
            await handleTransaction(transaction, candidate);
        }
    });
};

runBot();
setInterval(updateGasPriceInfo, 5000);
setInterval(getBalance, 5000);

const getTokenBalance = async (tokenAddress, tokenAbi) => {
    try {
        const contract = new ethers.Contract(tokenAddress, tokenAbi, provider);
        const tokenBalance = await contract.balanceOf(process.env.MY_ADDRESS);
        return tokenBalance;
    } catch (err) {
        console.error(err);
        return 0;
    }
};

const getDashboardData = async () => {
    const client = await redisPool.acquire();
    let tokenDatas = {};
    for (let i = 0; i < Object.keys(workers).length; i++) {
        const token = Object.keys(workers)[i];
        console.log("TOKEN", token);
        let tokenData = null;
        try {
            tokenData = await client.getAsync(token);
            tokenDatas[token] = tokenData;
        } catch (error) {
            console.error("Redis error:", error);
        }
    }
    let tokensOwned = await wallet.getTokenBoughtList();
    redisPool.release(client);
    let tokensRunning = [];
    for (let token in tokenDatas) {
        let tokenData = tokenDatas[token];
        if (tokenData !== null) {
            tokenData = JSON.parse(tokenData);
            tokensRunning.push({
                symbol: tokenData.symbol,
                pairAddress: tokenData.pairAddress,
                liquidity: tokenData.liquidity,
                amountOut: tokenData.amountOut,
                tokenPrice: tokenData.tokenPrice,
                path: tokenData.path,
                hasAbi: tokenData.abi !== null
            });
        }
    }

    return {
        walletData: {
            balance: balanceInEth + ' eth',
            tokens: tokensOwned
        },
        tokensData: tokensRunning,
        transactionsData: candidates
    };
};

app.get('/dashboard', async (req, res) => {
    const data = await getDashboardData();
    res.render('dashboard', data);
});

app.get('/dashboard-data', async (req, res) => {
    const data = await getDashboardData();
    res.send(data);
});

app.get('/get-token-owned', async (req, res) => {
    const tokens = await wallet.getTokenBoughtList();
    res.send(tokens);
});

app.get('/add-token/:tokenAddress', async (req, res) => {
    const client = await redisPool.acquire();
    try {
        let currentTokens = await client.getAsync('tokens_watching');
        if (currentTokens === null) {
            currentTokens = [];
        } else {
            currentTokens = JSON.parse(currentTokens);
        }
        let tokenSymbol = await tokenUtils.getTokenSymbol(req.params.tokenAddress);
        if (currentTokens.find(t => t.address === req.params.tokenAddress)) {
            res.send({ error: 'Token già presente (' + tokenSymbol + ')' });
            return;
        }

        const balance = await getTokenBalance(req.params.tokenAddress, ['function balanceOf(address) view returns (uint256)']);
        const pairAddress = await tokenUtils.getPairAddressAsync(req.params.tokenAddress);
        const decimals = await tokenUtils.getDecimals(req.params.tokenAddress);
        const balanceFormatted = ethers.utils.formatUnits(balance, decimals);
        const tokenToAdd = { address: req.params.tokenAddress, pairAddress, symbol: tokenSymbol, balance: balance.toString(), balanceFormatted, decimals: parseInt(decimals.toString()) };
        currentTokens.push(tokenToAdd);
        await client.setAsync('tokens_watching', JSON.stringify(currentTokens));
        res.send(tokenToAdd);
    } catch (error) {
        console.error("Redis error:", error);
    } finally {
        redisPool.release(client);
    }
});

app.get('/remove-token/:tokenAddress', async (req, res) => {
    const tokensAfterRemove = await wallet.removeTokenFromList(req.params.tokenAddress);
    res.send(tokensAfterRemove);
});

app.get('/swap-token/:tokenAddress', async (req, res) => {
    const client = await redisPool.acquire();
    try {
        let currentTokens = await client.getAsync('tokens_watching');
        if (currentTokens === null) {
            currentTokens = [];
        } else {
            currentTokens = JSON.parse(currentTokens);
            let token = currentTokens.find(t => t.address === req.params.tokenAddress);
            if (token) {
                let receiptApproveSell = await wallet.approveSellToken(token);
                console.log('receiptApproveSell', receiptApproveSell);
                if (receiptApproveSell.status) {
                    const uniswapAbi = ['function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)'];
                    const uniswap = new ethers.Contract(uniswapAddress, uniswapAbi, signingWallet);
                    let ethAmountOut = await uniswap.getAmountsOut(tokenAmount, path);
                    let receiptSell = await wallet.sellToken(token, ethAmountOut);
                    console.log('receiptSell', receiptSell);
                    if (receiptSell.status) {
                        let dt = await getDashboardData();
                        res.send(dt);
                    }
                }
            }
        }
    } catch (error) {
        console.error(error);
    } finally {
        redisPool.release(client);
    }
});

app.listen(14789, () => {
    console.log('Server listening on port 14789');
});
