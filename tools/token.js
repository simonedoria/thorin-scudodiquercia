const abi = require('../abi.js');
const axios = require('axios');
const moment = require('moment-timezone');
const web3 = require('web3');
const redis = require('../worker/redis');
const { ethers } = require('ethers');
require('dotenv').config();

const web3ws = new web3(new web3.providers.WebsocketProvider(process.env.PROVIDER_WS));
const web3Http = new web3(new web3.providers.HttpProvider(process.env.PROVIDER_HTTP));

const factoryAddress = '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f'; // The address of the Uniswap V2 factory contract
const uniswapEtherAddress = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'; // The address of WETH, which represents Ether in Uniswap
const uniswapRouterAddress = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'; // The address of the Uniswap V2 router contract

const getEstimatedEthForTokens = async (uniswapRouter, tokenAmount, path) => {
    try {
        const amounts = await uniswapRouter.methods.getAmountsOut(tokenAmount, path).call();
        return amounts[1]; // This is the estimated ETH amount
    } catch (error) {
        throw new Error(`Error estimating ETH for tokens: ${error.message}`);
    }
};

const getEstimateGas = async (web3http, tx) => {
    try {
        return await web3http.eth.estimateGas({
            from: tx.from,
            to: tx.to,
            data: tx.data,
            value: tx.value
        });
    } catch (error) {
        throw new Error(`Error estimating gas: ${error.message}`);
    }
};

const approveToken = async (web3, account, tokenAddress, uniswapRouterAddress, numTokensToApprove, maxPriorityFeePerGas, maxFeePerGas, gasLimit) => {
    const tokenContract = new web3.eth.Contract(ERC20_ABI, tokenAddress);

    const approvalTx = {
        from: account.address,
        to: tokenAddress,
        maxPriorityFeePerGas: maxPriorityFeePerGas,
        maxFeePerGas: maxFeePerGas,
        gasLimit: gasLimit,
        data: tokenContract.methods.approve(uniswapRouterAddress, numTokensToApprove).encodeABI()
    };

    const signedApprovalTx = await web3.eth.accounts.signTransaction(approvalTx, process.env.PRIVATE_KEY);
    return await web3.eth.sendSignedTransaction(signedApprovalTx.rawTransaction);
};

const getPairAddressAsync = async (tokenAddress) => {
    try {
        const factoryAbi = await abi.getAllAbis([["", factoryAddress]]);
        if (!factoryAbi[0]) return null;

        const factoryContract = new web3Http.eth.Contract(factoryAbi[0].abi, factoryAddress);

        const client = await redis.acquire();
        const cachedData = await client.getAsync(`pair-${tokenAddress}`);
        redis.release(client);
        if (cachedData) return cachedData;

        const pairAddress = await factoryContract.methods.getPair(uniswapEtherAddress, tokenAddress).call();
        return pairAddress;
    } catch (error) {
        console.error(`Error getting pair address: ${error.message}`);
        return null;
    }
};

const getTokenLiquidity = async (tokenAddress, pairAddress) => {
    try {
        const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_HTTP);
        const abiUni = [
            'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
            'function token0() external view returns (address)',
            'function token1() external view returns (address)',
            'function decimals() external view returns (uint8)'
        ];

        const uniswapPair = new ethers.Contract(pairAddress, abiUni, provider);
        const [reserves, token0Address] = await Promise.all([uniswapPair.getReserves(), uniswapPair.token0()]);

        return token0Address.toLowerCase() === tokenAddress.toLowerCase()
            ? [reserves.reserve1.toString(), reserves.reserve0.toString()]
            : [reserves.reserve0.toString(), reserves.reserve1.toString()];
    } catch (error) {
        console.error(`Error getting token liquidity: ${error.message}`);
        return null;
    }
};

const getDecimals = async (tokenAddress) => {
    try {
        const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_HTTP);
        const tokenContract = new ethers.Contract(tokenAddress, ['function decimals() public view returns (uint8)'], provider);
        const decimals = await tokenContract.decimals();
        return parseInt(decimals.toString());
    } catch (error) {
        console.error(`Error getting token decimals: ${error.message}`);
        return 0;
    }
};

const getAmountOut = async (uniswapRouter, path, amountIn) => {
    try {
        const abiUniswap = [
            'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)'
        ];
        const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_HTTP);
        const router = new ethers.Contract(uniswapRouter.toLowerCase(), abiUniswap, provider);
        const decimals = await getDecimals(path[1]);
        const amountOut = await router.getAmountsOut(amountIn, path);
        return [amountOut[1].toString(), ethers.formatUnits(amountOut[1], decimals), decimals];
    } catch (error) {
        console.error(`Error getting amount out: ${error.message}`);
        return null;
    }
};

const getTokenPrice = async (uniswapPairAddress, tokenAddress) => {
    try {
        const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_HTTP);
        const abiUni = [
            'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
            'function token0() external view returns (address)',
            'function token1() external view returns (address)',
            'function decimals() external view returns (uint8)'
        ];
        const uniswapPair = new ethers.Contract(uniswapPairAddress.toLowerCase(), abiUni, provider);
        const [reserves, token0Address] = await Promise.all([uniswapPair.getReserves(), uniswapPair.token0()]);
        const wethReserve = token0Address.toLowerCase() === tokenAddress.toLowerCase() ? reserves.reserve1 : reserves.reserve0;
        const tokenReserve = token0Address.toLowerCase() === tokenAddress.toLowerCase() ? reserves.reserve0 : reserves.reserve1;
        const tokenDecimals = await (new ethers.Contract(tokenAddress, ['function decimals() external view returns (uint8)'], provider)).decimals();
        const tokenPriceInWETH = BigInt(tokenReserve.toString()) / BigInt(wethReserve.toString()) / 10n ** BigInt(tokenDecimals.toString());

        return { price: tokenPriceInWETH.toString(), symbol: await (new ethers.Contract(tokenAddress, ['function symbol() external view returns (string memory)'], provider)).symbol() };
    } catch (error) {
        console.error(`Error getting token price: ${error.message}`);
        return null;
    }
};

module.exports = {
    getRequiredETH: async (tokenAddress, ethAmount, tokensToBuy) => { },
    getDecimals,
    getPairAddressAsync,
    getAmountOut,
    calculateDeltaY: (deltaX, amountOut1eth, eth1) => {
        console.log("deltaX: ", deltaX);
        console.log("amountOut1eth: ", amountOut1eth);
        console.log("eth1: ", eth1);
        const deltaYBN = BigInt(deltaX) * BigInt(amountOut1eth) / BigInt(eth1);
        console.log("deltaY: ", deltaYBN.toString());
        return deltaYBN.toString();
    },
    calculateProfitability: (currentPrice, newPrice, tokenBought, fixedSlippage) => {
        currentPrice = parseFloat(currentPrice);
        newPrice = parseFloat(newPrice);
        tokenBought = parseFloat(tokenBought);
        fixedSlippage = parseFloat(fixedSlippage);
        const priceIncrease = newPrice - currentPrice;
        const priceIncreasePercentage = (priceIncrease / currentPrice) * 100;
        const valueAtNewPrice = tokenBought * newPrice;
        const cost = tokenBought * currentPrice * (1 + fixedSlippage / 100);
        const profit = valueAtNewPrice - cost;
        const profitability = (profit / cost) * 100;
        return { profit, profitability, priceIncreasePercentage };
    },
    calculateTokensToBuy: (desiredProfit, transactionFees, predictedPrice, currentPrice) => {
        const tokensToBuy = (BigInt(desiredProfit) + BigInt(transactionFees)) / (BigInt(predictedPrice) - BigInt(currentPrice));
        return tokensToBuy.toString();
    },
    calculateNewPrice: (ethReserve, tokenReserve, ethSent, tokensReceived, tokenDecimals) => {
        const newEthReserve = (BigInt(ethReserve) + BigInt(ethSent)) / 10n ** 18n;
        const newTokenReserve = (BigInt(tokenReserve) - BigInt(tokensReceived)) / 10n ** BigInt(tokenDecimals);
        const tokenPriceInWETH = newEthReserve / newTokenReserve;
        console.log('New token price in WETH: ', tokenPriceInWETH.toString());
        return tokenPriceInWETH.toString();
    },
    updateTokenData: async (token) => {
        const [liquidity, amountOut, tokenPrice, abiToken] = await Promise.all([
            getTokenLiquidity(token, await getPairAddressAsync(token)),
            getAmountOut(uniswapRouterAddress, [uniswapEtherAddress, token], '500000000000000000'),
            getTokenPrice(await getPairAddressAsync(token), token),
            abi.getSingleAbi(token.toLowerCase())
        ]);
        if (!liquidity || !amountOut || !tokenPrice || !abiToken) return null;
        return {
            pairAddress: await getPairAddressAsync(token),
            liquidity,
            amountOut,
            tokenPrice: tokenPrice.price,
            symbol: tokenPrice.symbol,
            path: [uniswapEtherAddress, token],
            abi: abiToken
        };
    },
    getTokenSymbol: async (tokenAddress) => {
        const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_HTTP);
        const tokenContract = new ethers.Contract(tokenAddress, ['function symbol() external view returns (string memory)'], provider);
        return await tokenContract.symbol();
    },
    getTokenLiquidity,
    compareGasPriceToAvg: async (avgGasPrice, maxPriorityFeePerGas) => {
        if (!avgGasPrice || !maxPriorityFeePerGas) return true;
        return BigInt(maxPriorityFeePerGas) <= BigInt(avgGasPrice.gasPrice);
    },
    calculateGasFees: (transaction, gasPriceInfo, bribe) => {
        const maxFeePerGas = BigInt(transaction.maxFeePerGas) + BigInt(bribe);
        const maxPriorityFeePerGas = BigInt(transaction.maxPriorityFeePerGas) + BigInt(bribe);
        return {
            gas: gasPriceInfo.gasPrice,
            maxFeePerGas: maxFeePerGas.toString(),
            maxPriorityFeePerGas: maxPriorityFeePerGas.toString()
        };
    },
    isEnoughAmountOut: (amountOut, amountOutMin) => {
        return BigInt(amountOut) >= BigInt(amountOutMin);
    },
    calculateTotalGasFees: (gasFees) => {
        const gas = BigInt(gasFees.gas);
        const maxFeePerGas = BigInt(gasFees.maxFeePerGas);
        return (gas * maxFeePerGas).toString();
    },
    calculateGasFeesSpentByVictim: (candidate) => {
        const gas = BigInt(candidate.transaction.gas);
        const maxFeePerGas = BigInt(candidate.transaction.maxFeePerGas);
        const maxPriorityFeePerGas = BigInt(candidate.transaction.maxPriorityFeePerGas);
        return (gas * (maxFeePerGas + maxPriorityFeePerGas)).toString();
    },
    calculateAverageTransactionValue: (recentTransactions, maxTrxToFetch = 100) => {
        const values = recentTransactions.slice(0, maxTrxToFetch).map(tx => BigInt(tx.value)).sort();
        const medianValue = values.length % 2 === 0
            ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2n
            : values[Math.floor(values.length / 2)];
        return { medianValue: medianValue.toString(), count: values.length };
    },
    isTransactionValueAboveAverage: (transaction, average) => {
        return BigInt(transaction.value) > BigInt(average);
    },
    fetchTransactions: async (tokenAddress, startBlock, endBlock) => {
        const url = `https://api.etherscan.io/api?module=account&action=tokentx&contractaddress=${tokenAddress}&startblock=${startBlock}&endblock=${endBlock}&sort=desc&apikey=${process.env.ETHERSCAN_API_KEY}`;
        const response = await axios.get(url);
        return response.data.result;
    },
    deadlineCheck: (candidate, sec = 60) => {
        const deadLineValue = BigInt(candidate.inputData.deadlineValue._hex);
        const now = BigInt(moment().unix());
        return (deadLineValue - now) > BigInt(sec);
    },
    calcolaSlippage: (amountIn, amountOutMin, tokenLiquidity, ethLiquidity) => {
        const prezzoAttuale = ethLiquidity / tokenLiquidity;
        const slippage = ((amountOutMin / amountIn) - prezzoAttuale) / prezzoAttuale * 100;
        return slippage;
    },
    calculateNextPrice: (currentReserveEth, currentReserveToken, incomingEth, fixedSlippage) => {
        const reserveEth = BigInt(currentReserveEth);
        const reserveToken = BigInt(currentReserveToken);
        const incomingEthBN = BigInt(incomingEth);
        const newReserveEth = reserveEth + incomingEthBN;
        const newTokenReserve = reserveEth * reserveToken / newReserveEth;
        const nextPrice = newReserveEth / newTokenReserve;
        const numTokenBought = reserveToken - newTokenReserve;
        const numTokenBoughtWithoutSlippage = numTokenBought - (numTokenBought * BigInt(fixedSlippage * 100) / 100n);
        return nextPrice.toString();
    },
    calculateCurrentPrice: (reserveEth, reserveToken) => {
        if (reserveEth !== '0' && reserveToken !== '0') {
            const reserveEthBN = BigInt(reserveEth);
            const reserveTokenBN = BigInt(reserveToken);
            const currentPrice = reserveEthBN / reserveTokenBN;
            return currentPrice.toString();
        } else {
            return '0';
        }
    },
    calculateGasSpent: (gasFeesToPutInTransaction, baseGasFee) => {
        return (BigInt(gasFeesToPutInTransaction.maxFeePerGas) * BigInt(baseGasFee)).toString();
    },
    calculateTokensToBuy: (profitTarget, estimatedSellPrice, gasCosts) => {
        const tokensToBuy = (BigInt(profitTarget) + BigInt(gasCosts)) / BigInt(estimatedSellPrice);
        return tokensToBuy.toString();
    },
    calculateExpectedProfit: (numTokenToBuy, currentPriceWei, numTokenToSell, nextPriceWei, slippagePercent) => {
        const costOfBuyingWei = BigInt(numTokenToBuy) * BigInt(currentPriceWei);
        const slippageBN = BigInt(slippagePercent);
        const expectedSellingPriceBN = BigInt(nextPriceWei) - (BigInt(nextPriceWei) * slippageBN / 100n);
        const revenueFromSellingWei = BigInt(numTokenToSell) * expectedSellingPriceBN;
        const expectedProfitWei = revenueFromSellingWei - costOfBuyingWei;
        return expectedProfitWei.toString();
    },
    isGoodNumTokenToBuy: (numTokenToBuy, tokenLiquidity) => {
        const percentageOfLiquidity = (BigInt(numTokenToBuy) * 100n) / BigInt(tokenLiquidity);
        return percentageOfLiquidity < 10n;
    },
    executeTransaction: async (web3http, uniswapRouterAccount, candidate, weiToSpend, gasFees, uniswapRouterABI, numTokenToBuy) => {
        try {
            const account = web3http.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
            web3http.eth.accounts.wallet.add(account);
            web3http.eth.defaultAccount = account.address;

            const balance = await web3http.eth.getBalance(account.address);

            const totalCost = BigInt(weiToSpend) + BigInt(gasFees.maxFeePerGas);
            if (BigInt(balance) < totalCost) {
                console.log(`Not enough ETH in wallet to perform the transaction. Required: ${totalCost}, Available: ${balance}`);
                return null;
            }

            const uniswapRouter = new web3http.eth.Contract(uniswapRouterABI, candidate.transaction.to);
            const path = candidate.inputData.pathValue;
            const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

            let amountOutMin = await getAmountOut(uniswapRouterAccount, uniswapRouterABI, path, totalCost);
            amountOutMin = (BigInt(amountOutMin[0]) * 90n) / 100n;

            const maxPriorityFeePerGas = (BigInt(gasFees.maxPriorityFeePerGas) * 120n) / 100n;
            const maxFeePerGas = (BigInt(gasFees.maxFeePerGas) * 120n) / 100n;

            const tx = {
                from: account.address,
                to: uniswapRouterAccount,
                maxPriorityFeePerGas: web3http.utils.toHex(maxPriorityFeePerGas),
                maxFeePerGas: web3http.utils.toHex(maxFeePerGas),
                value: web3http.utils.toHex(weiToSpend),
                data: uniswapRouter.methods[candidate.inputData.method](amountOutMin.toString(), path, account.address, deadline).encodeABI()
            };

            const gasLimit = await getEstimateGas(web3http, tx);
            tx.gasLimit = web3http.utils.toHex(gasLimit);

            const signedTx = await web3http.eth.accounts.signTransaction(tx, process.env.PRIVATE_KEY);
            return await web3http.eth.sendSignedTransaction(signedTx.rawTransaction);
        } catch (error) {
            console.error(`Error executing transaction: ${error.message}`);
            return null;
        }
    },
    calculateEthToInvest: (numTokensToBuy, tokenPrice) => {
        const currentPrice = BigInt(tokenPrice);
        const ethToInvest = (BigInt(numTokensToBuy) * currentPrice) / 10n ** 18n;
        return ethToInvest.toString();
    },
    calculateEthToEarn: (numTokensToSell, tokenPrice) => {
        const currentPrice = BigInt(tokenPrice);
        const ethToEarn = (currentPrice * BigInt(numTokensToSell));
        return ethToEarn.toString();
    },
    executeSellTransaction: async (web3http, uniswapRouterAccount, candidate, numTokenToSell, gasFees, uniswapRouterABI) => {
        try {
            const account = web3http.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
            web3http.eth.accounts.wallet.add(account);
            web3http.eth.defaultAccount = account.address;

            const uniswapRouter = new web3http.eth.Contract(uniswapRouterABI, candidate.transaction.to);
            const path = [candidate.inputData.tokenAcquistato, '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'];
            const minEthToReceive = await getEstimatedEthForTokens(uniswapRouter, numTokenToSell, path);
            const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
            const amountOutMin = web3http.utils.toWei(minEthToReceive, 'ether');

            const maxPriorityFeePerGas = (BigInt(gasFees.maxPriorityFeePerGas) * 120n) / 100n;
            const maxFeePerGas = (BigInt(gasFees.maxFeePerGas) * 120n) / 100n;

            const tx = {
                from: account.address,
                to: uniswapRouterAccount,
                maxPriorityFeePerGas: web3http.utils.toHex(maxPriorityFeePerGas),
                maxFeePerGas: web3http.utils.toHex(maxFeePerGas),
                data: uniswapRouter.methods.swapExactTokensForETH(
                    numTokenToSell,
                    amountOutMin,
                    path,
                    account.address,
                    deadline
                ).encodeABI()
            };

            const gasLimit = await getEstimateGas(web3http, tx);
            tx.gasLimit = web3http.utils.toHex(gasLimit);

            const approveReceipt = await approveToken(web3http, account, candidate.inputData.tokenAcquistato, uniswapRouterAccount, numTokenToSell, maxPriorityFeePerGas, maxFeePerGas, gasLimit);
            console.log("Approve TX Receipt: ", approveReceipt);

            const signedTx = await web3http.eth.accounts.signTransaction(tx, process.env.PRIVATE_KEY);
            return await web3http.eth.sendSignedTransaction(signedTx.rawTransaction);
        } catch (error) {
            console.error(`Error executing sell transaction: ${error.message}`);
            return null;
        }
    }
};
