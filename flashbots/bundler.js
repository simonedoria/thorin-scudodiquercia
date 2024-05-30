const { Wallet, ethers } = require('ethers');
require('dotenv').config();

const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_HTTP);
const privateKey = process.env.PRIVATE_KEY;
const signingWallet = new Wallet(privateKey).connect(provider);

const wethAddress = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

let flashbotsProvider = null;

const init = async () => {
    console.log('Connecting to Flashbots relay...');
    // Assicurati di importare correttamente FlashbotsBundleProvider
    const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');
    flashbotsProvider = await FlashbotsBundleProvider.create(provider, signingWallet, process.env.FLASHBOTS_URL);
};
init();

const gasLimit = 300000;  // Parametro per il limite del gas
const tipAmount = ethers.utils.parseEther("0.00000005");  // Tip per il minatore

const calculateEthToInvest = async (percentageToInvest) => {
    const balance = await provider.getBalance(signingWallet.address);
    const balanceInEth = ethers.utils.formatEther(balance);
    return ethers.utils.parseUnits((balanceInEth * percentageToInvest).toString(), 'ether').toString();
};

module.exports = {
    performTransactions: async (candidate, tokensToBuy, gasToPutInTransaction, chainInfo, tokenData, uniswapAddress, uniswapAbi) => {
        try {
            const uniswap = new ethers.Contract(uniswapAddress, uniswapAbi, provider);
            const erc20Contract = new ethers.Contract(candidate.inputData.tokenAcquistato, tokenData.abi, provider);
            const deadline = Math.floor(Date.now() / 1000) + 60 * 2; // 2 mins from now

            // Calcolare dinamicamente ethToInvest e ethToEarn
            const ethToInvest = await calculateEthToInvest(0.1); // Investire il 10% del balance
            const ethToEarn = ethToInvest; // Come esempio, supponiamo che vogliamo guadagnare almeno quanto investiamo

            tokensToBuy = tokensToBuy.split('.')[0]; // Truncate to integer part

            gasToPutInTransaction.maxFeePerGas = ethers.utils.parseUnits(gasToPutInTransaction.maxFeePerGas, 'wei');
            gasToPutInTransaction.maxPriorityFeePerGas = ethers.utils.parseUnits(gasToPutInTransaction.maxPriorityFeePerGas, 'wei');

            const nonce = await provider.getTransactionCount(signingWallet.address, 'pending');
            const nonce1 = nonce;
            const nonce2 = nonce + 1;
            const nonce3 = nonce + 2;
            const nonce4 = nonce + 3;
            const nonce5 = nonce + 4;

            const [populateFirstTransaction, populateThirdTransaction, populateFourthTransaction] = await Promise.all([
                uniswap.populateTransaction.swapExactETHForTokens(
                    tokensToBuy,
                    [wethAddress, candidate.inputData.tokenAcquistato],
                    signingWallet.address,
                    deadline,
                    {
                        value: ethToInvest,
                        type: 2,
                        maxFeePerGas: gasToPutInTransaction.maxFeePerGas,
                        maxPriorityFeePerGas: gasToPutInTransaction.maxPriorityFeePerGas,
                        gasLimit: gasLimit,
                        nonce: nonce1
                    }
                ),
                erc20Contract.populateTransaction.approve(
                    uniswapAddress,
                    tokensToBuy,
                    {
                        value: '0',
                        type: 2,
                        maxFeePerGas: gasToPutInTransaction.maxFeePerGas,
                        maxPriorityFeePerGas: gasToPutInTransaction.maxPriorityFeePerGas,
                        gasLimit: gasLimit,
                        nonce: nonce2
                    }
                ),
                uniswap.populateTransaction.swapExactTokensForETH(
                    tokensToBuy,
                    ethToEarn,
                    [candidate.inputData.tokenAcquistato, wethAddress],
                    signingWallet.address,
                    deadline,
                    {
                        value: '0',
                        type: 2,
                        maxFeePerGas: gasToPutInTransaction.maxFeePerGas,
                        maxPriorityFeePerGas: gasToPutInTransaction.maxPriorityFeePerGas,
                        gasLimit: gasLimit,
                        nonce: nonce3
                    }
                )
            ]);


            const transactionsArray = [
                {
                    signer: signingWallet,
                    transaction: { ...populateFirstTransaction, chainId: chainInfo.chainId, nonce: nonce1 }
                },
                {
                    signedTransaction: ethers.utils.serializeTransaction({
                        chainId: chainInfo.chainId,
                        ...candidate.transaction,
                        nonce: candidate.transaction.nonce = 0,
                        gasLimit: gasLimit,
                        gasPrice: candidate.transaction.gasPrice,
                        data: candidate.transaction.data,
                        value: candidate.transaction.value,
                        type: 2,
                        maxPriorityFeePerGas: candidate.transaction.maxPriorityFeePerGas,
                        maxFeePerGas: candidate.transaction.maxFeePerGas,
                    }, {
                        r: candidate.transaction.r,
                        s: candidate.transaction.s,
                        v: candidate.transaction.v,
                    })
                },
                {
                    signer: signingWallet,
                    transaction: { ...populateThirdTransaction, chainId: chainInfo.chainId, nonce: nonce2 }
                },
                {
                    signer: signingWallet,
                    transaction: { ...populateFourthTransaction, chainId: chainInfo.chainId, nonce: nonce3 }
                }
            ];

            const signedTransactions = await flashbotsProvider.signBundle(transactionsArray);
            const blockNumber = chainInfo.blockNumber;

            console.log('Simulating...');
            const simulation = await flashbotsProvider.simulate(signedTransactions, blockNumber + 1);
            if (simulation.firstRevert) {
                return console.log('Simulation error', simulation.firstRevert);
            } else {
                console.log('Simulation success', simulation);
            }

            flashbotsProvider.sendRawBundle(signedTransactions, blockNumber + 1).then(bundleSubmission => {
                console.log('Bundle submitted', bundleSubmission.bundleHash);
                return bundleSubmission.wait();
            }).then(async waitResponse => {
                console.log('Wait response', FlashbotsBundleResolution[waitResponse]);
                if (waitResponse == FlashbotsBundleResolution.BundleIncluded) {
                    console.log('-------------------------------------------');
                    console.log('----------- Bundle Included ---------------');
                    console.log('-------------------------------------------');
                } else if (waitResponse == FlashbotsBundleResolution.AccountNonceTooHigh) {
                    console.log('The transaction has been confirmed already');
                } else {
                    console.log('Bundle hash', bundleSubmission.bundleHash);
                    try {
                        console.log({
                            bundleStats: await flashbotsProvider.getBundleStats(bundleSubmission.bundleHash, blockNumber + 1),
                            userStats: await flashbotsProvider.getUserStats(),
                        });
                    } catch (e) {
                        return false;
                    }
                }
            }).catch(e => {
                console.log('Bundle submission error', e);
            });
        } catch (e) {
            console.log("Errore nel bundle", e);
        }
    }
};
